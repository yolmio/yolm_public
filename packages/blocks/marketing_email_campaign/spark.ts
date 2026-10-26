import type { SparkCapability } from "blocks/spark";
import {
  blockToolset,
  toolId,
  toolInteger,
  toolObject,
  toolPage,
  toolString,
  toolValue,
} from "blocks/spark/tool_contract";
import { renderEmailDeliveryTemplate } from "blocks/email_delivery_template";
import { system } from "std/system";
import { sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import type { MarketingEmailCampaignBlock } from "./index";

/** Campaign operations over the block's existing delivery lifecycle. */
export function marketingEmailCampaignSparkCapability(
  block: MarketingEmailCampaignBlock,
  opts: { permission: string },
): SparkCapability {
  const tools = blockToolset("marketing_campaigns", opts.permission);
  const preparePreview = (s: GeneralServerStatements) => {
    toolInteger(s, "template_id", true);
    toolString(s, "name", 200, true);
    toolString(s, "sender_key", 100, true);
    s.throwErrorIf(
      sql`${toolValue("sender_key")} not in (${
        Object.keys(block.opts.senders).map((k) => sql.lit(k))
      })`,
      sql.lit`Unknown sender.`,
    );
    s.defRecord(
      "campaign",
      sql`select 0 as id, ${toolValue("name")} as name,
      ${toolId("template_id")} as email_template_id, ${
        toolValue("sender_key")
      } as sender_key`,
    );
    s.defTable("audience", block.buildAudienceQuery(sql`campaign`));
    s.defScalar(
      "preview_fingerprint",
      sql`bytes.to_hex(crypto.sha256(string.to_utf8(json_build_object(
      'sender_config',${sql.lit(JSON.stringify(block.opts.senders))}::json,
      'campaign_variables',${
        sql.jsonBuildObject(
          Object.fromEntries(
            Object.entries(block.opts.audience.campaignVariables ?? {}).map((
              [key, variable],
            ) => [key, variable.expr(sql`campaign`)]),
          ),
        )
      },
      'id',campaign.id,'name',campaign.name,'sender',campaign.sender_key,'template',campaign.email_template_id,
      'template_source',(select ${
        sql.jsonBuildObject(
          Object.fromEntries(
            Object.keys(system.db.tables.email_templates.fields).map(
              (key) => [key, sql.ref(key)],
            ),
          ),
        )
      } from email_templates where id=campaign.email_template_id),
      'sections',(select json_agg(${
        sql.jsonBuildObject(
          Object.fromEntries(
            Object.keys(system.db.tables.email_sections.fields).map(
              (key) => [key, sql.ref("section", key)],
            ),
          ),
        )
      } order by section.id) from email_sections section where section.email_template_id=campaign.email_template_id),
      'columns',(select json_agg(${
        sql.jsonBuildObject(
          Object.fromEntries(
            Object.keys(system.db.tables.email_columns.fields).map(
              (key) => [key, sql.ref("col", key)],
            ),
          ),
        )
      } order by col.id) from email_columns col join email_sections section on section.id=col.email_section_id where section.email_template_id=campaign.email_template_id),
      'blocks',(select json_agg(${
        sql.jsonBuildObject(
          Object.fromEntries(
            Object.keys(system.db.tables.email_blocks.fields).map(
              (key) => [key, sql.ref("block", key)],
            ),
          ),
        )
      } order by block.id) from email_blocks block join email_columns col on col.id=block.email_column_id join email_sections section on section.id=col.email_section_id where section.email_template_id=campaign.email_template_id),
      'audience',(select json_agg(json_build_object('key',source_recipient_key,'email',email,'variables',variables,'from',from_address,'reply_to',reply_to) order by source_recipient_key,email) from audience)
    )::string)))`,
    );
  };
  return {
    name: "marketing_campaigns",
    label: "Marketing campaigns",
    permission: opts.permission,
    description: "Preview, schedule, cancel and inspect marketing campaigns.",
    functions: [
      tools.read(
        "list",
        "List campaigns, their status and configured senders.",
        "{offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["offset", "limit"]);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('senders',${
              sql.lit(JSON.stringify(block.opts.senders))
            }::json,'items',coalesce((select json_agg(json_build_object('id',id,'name',name,'template_id',email_template_id,'sender_key',sender_key,'status',status,'scheduled_at',scheduled_at,'delivery_id',delivery_id,'error',error)) from (select * from db.marketing_email_campaigns order by id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
      tools.read(
        "preview",
        "Preview current audience and rendered content for its first recipient. Does not schedule or send.",
        "{name:string;template_id:number;sender_key:string}",
        (s) => {
          toolObject(s, ["name", "template_id", "sender_key"]);
          preparePreview(s);
          const content = block.renderCampaign(s, sql`campaign`, "preview");
          s.defRecord(
            "sample",
            sql`select * from audience order by source_recipient_key limit 1`,
          );
          s.defScalar(
            "variables",
            sql`coalesce(sample.variables,'{}'::json) || json_build_object('email',sample.email)`,
          );
          s.defScalar(
            "sample_html",
            renderEmailDeliveryTemplate(content.html, sql`variables`, true),
          );
          s.setScalar(
            "tool_output",
            sql`json_build_object('sender_config',${
              sql.lit(JSON.stringify(block.opts.senders))
            }::json,
      'campaign_variables',${
              sql.jsonBuildObject(
                Object.fromEntries(
                  Object.entries(block.opts.audience.campaignVariables ?? {})
                    .map((
                      [key, variable],
                    ) => [key, variable.expr(sql`campaign`)]),
                ),
              )
            },
      'name',campaign.name,'fingerprint',preview_fingerprint,'audience_count',(select count(*) from audience),'sample_email',sample.email,'subject',${
              renderEmailDeliveryTemplate(
                content.subject,
                sql`variables`,
                false,
              )
            },'html',substring(sample_html from 1 for 16000),'truncated',length(sample_html)>16000)`,
          );
        },
      ),
      tools.read(
        "results",
        "Read actual delivery outcomes; submission is not proof of delivery.",
        "{id:number}",
        (s) => {
          toolObject(s, ["id"]);
          toolInteger(s, "id", true);
          s.throwErrorIf(
            sql`not exists(select 1 from db.marketing_email_campaigns where id=${
              toolId("id")
            })`,
            sql.lit`Campaign not found.`,
          );
          s.defRecord(
            "delivery",
            block.summaryQuery(toolId("id")),
          );
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',delivery.id,'status',delivery.status,'recipient_count',delivery.recipient_count,'submitted_count',delivery.submitted_count,'delivered_count',delivery.delivered_count,'failed_count',delivery.failed_count,'send_unknown_count',delivery.send_unknown_count,'excluded_count',delivery.excluded_count,'error',delivery.error)`,
          );
        },
      ),
    ],
    actions: [
      tools.action(
        "schedule",
        "Approve scheduling a campaign. This freezes the current audience and authorizes real email delivery.",
        "{name:string;template_id:number;sender_key:string;scheduled_at:string;fingerprint:string}",
        (s) => {
          toolObject(s, [
            "name",
            "template_id",
            "sender_key",
            "scheduled_at",
            "fingerprint",
          ]);
          toolString(s, "fingerprint", 64, true);
          preparePreview(s);
          s.throwErrorIf(
            sql`preview_fingerprint <> ${toolValue("fingerprint")}`,
            sql
              .lit`Campaign content or audience changed. Preview again before scheduling.`,
          );
          toolString(s, "scheduled_at", 50, true);
          s.defScalar(
            "schedule_time",
            sql`try_cast(${toolValue("scheduled_at")} as timestamptz)`,
          );
          s.throwErrorIf(
            sql`schedule_time is null or schedule_time < now()`,
            sql.lit`Supply a future timestamp with timezone.`,
          );
          block.createAndSchedule(s, {
            name: toolValue("name"),
            templateId: toolId("template_id"),
            senderKey: toolValue("sender_key"),
            scheduledAt: sql`schedule_time`,
            campaignIdScalar: "created_campaign_id",
          });
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',created_campaign_id,'status','scheduled')`,
          );
        },
        true,
      ),
      tools.action(
        "cancel",
        "Cancel a scheduled, still-held campaign and retain its history. Already released deliveries cannot be cancelled.",
        "{id:number}",
        (s) => {
          toolObject(s, ["id"]);
          toolInteger(s, "id", true);
          block.cancel(s, toolId("id"));
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',${toolId("id")},'status','cancelled')`,
          );
        },
        true,
      ),
    ],
    doc:
      "Preview before scheduling and pass its fingerprint unchanged. Scheduling requires approval and may send to real recipients. No automatic retry of failed or uncertain deliveries. Previews use the configured audience adapter; current audience previews are not historical delivery results. Send results must distinguish queued, submitted, delivered and failed.",
  };
}
