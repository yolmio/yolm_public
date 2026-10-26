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
import type { GeneralServerStatements } from "std/statements";
import { sql } from "std/sql_utils";
import type { ConnectedAccountEmailDeliverySource } from "./index";

/** Source-scoped mail merge tools; provider credentials never enter tool results. */
export function connectedAccountEmailSparkCapability(
  source: ConnectedAccountEmailDeliverySource,
  opts: { permission: string },
): SparkCapability {
  const workflow = source.config.selectedRows;
  if (!workflow) {
    throw new Error("Connected email Spark requires a selected-rows workflow.");
  }
  const block = source.block;
  const name = `connected_email_${source.config.key}`;
  const tools = blockToolset(name, opts.permission);
  const inputType =
    "{sender_key:string;template_id:number;recipient_ids:number[]}";
  const prepare = (s: GeneralServerStatements) => {
    toolString(s, "sender_key", 1000, true);
    toolInteger(s, "template_id", true);
    s.throwErrorIf(
      sql`json_typeof(p_input->'recipient_ids') is distinct from 'array'`,
      sql.lit`recipient_ids must be an array.`,
    );
    s.defTable(
      "selected_ids",
      sql`select try_cast(value::string as bigint) as id from json.array_each(p_input->'recipient_ids')`,
    );
    s.throwErrorIf(
      sql`(select count(*) from selected_ids) not between 1 and ${block.opts.maxRecipientsPerDelivery} or exists(select 1 from json.array_each(p_input->'recipient_ids') where json_typeof(value) <> 'number' or try_cast(value::string as bigint) is null or try_cast(value::string as bigint) < 0 or try_cast(value::string as double) <> try_cast(value::string as bigint)::double) or exists(select id from selected_ids group by id having count(*) > 1)`,
      sql.lit`Select unique integer recipient IDs within the delivery limit.`,
    );
    const prepared = source.prepareSelectedRows(s, {
      senderKey: toolValue("sender_key"),
      templateId: toolId("template_id"),
      selectedIds: sql`selected_ids`,
    });
    s.defTable("recipients", prepared.recipientsQuery);
    s.throwErrorIf(
      sql`(select count(*) from recipients) <> (select count(*) from selected_ids) or exists(select 1 from recipients where not exists(select 1 from selected_ids where id=try_cast(recipients.source_recipient_key as bigint)))`,
      sql
        .lit`Every selected record must resolve to one eligible, unique email recipient.`,
    );
    s.defScalar(
      "fingerprint",
      sql`bytes.to_hex(crypto.sha256(string.to_utf8(json_build_object('user',current_user,'sender',${
        toolValue("sender_key")
      },'subject',${prepared.subjectTemplate},'html',${prepared.htmlTemplate},'recipients',(select json_agg(json_build_object('key',source_recipient_key,'email',email,'variables',variables) order by source_recipient_key) from recipients))::string)))`,
    );
    return prepared;
  };
  return {
    name,
    label: "Connected email",
    permission: opts.permission,
    description:
      "Preview and approve bounded mail merges through your connected account.",
    functions: [
      tools.read(
        "options",
        "List senders owned by the current user and available templates.",
        "{offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["offset", "limit"]);
          toolPage(s);
          if (workflow.authorize) {
            s.defTable("selected_ids", {
              fields: [{ name: "id", type: "BigInt" }],
            });
            workflow.authorize(s, { selectedIds: sql`selected_ids` });
          }
          s.setScalar(
            "tool_output",
            sql`json_build_object('senders',coalesce((select json_agg(json_build_object('key',integration_key || ':' || account_id::string || ':' || lower(trim(from_address)),'from',from_address)) from (${
              block.availableSendersQuery(sql`current_user`)
            }) senders),'[]'::json),'templates',coalesce((select json_agg(json_build_object('id',id,'name',name)) from (select id,name from (${workflow.templatesQuery}) available order by id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
      tools.read(
        "preview",
        "Render sample messages and return a fingerprint required for send approval. No mail is queued.",
        inputType,
        (s) => {
          toolObject(s, ["sender_key", "template_id", "recipient_ids"]);
          const prepared = prepare(s);
          s.defTable(
            "samples",
            sql`select email,
            ${
              renderEmailDeliveryTemplate(
                prepared.subjectTemplate,
                sql`variables || json_build_object('email',email)`,
                false,
              )
            } as subject,
            ${
              renderEmailDeliveryTemplate(
                prepared.htmlTemplate,
                sql`variables || json_build_object('email',email)`,
                true,
              )
            } as html
            from (select * from recipients order by source_recipient_key limit 3)`,
          );
          s.setScalar(
            "tool_output",
            sql`json_build_object('request_key',random.uuid(),'fingerprint',fingerprint,'from',${prepared.from},'recipient_count',(select count(*) from recipients),
            'samples',(select json_agg(json_build_object('email',email,'subject',subject,'html',substring(html from 1 for 8000),'truncated',length(html)>8000)) from samples))`,
          );
        },
      ),
      tools.read(
        "results",
        "Inspect this source's delivery using a mailbox available to the current user.",
        "{id:number;offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["id", "offset", "limit"]);
          toolInteger(s, "id", true);
          toolPage(s);
          s.throwErrorIf(
            sql`not exists(select 1 from db.connected_account_email_deliveries d join (${
              block.availableSendersQuery(sql`current_user`)
            }) sender on sender.integration_key=d.integration_key and sender.account_id=d.account_id and lower(trim(sender.from_address))=lower(trim(d.from_email)) where d.id=${
              toolId("id")
            } and d.source=${sql.lit(source.config.key)})`,
            sql.lit`Delivery unavailable for the current user.`,
          );
          if (workflow.authorize) {
            s.defTable(
              "selected_ids",
              sql`select try_cast(source_recipient_key as bigint) as id from (${
                source.recipientResultsQuery(toolId("id"))
              }) recipients`,
            );
            workflow.authorize(s, { selectedIds: sql`selected_ids` });
          }
          s.defRecord("summary", source.summaryQuery(toolId("id")));
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',summary.id,'status',summary.status,'recipient_count',summary.recipient_count,'sent_count',summary.sent_count,'failed_count',summary.failed_count,'send_unknown_count',summary.send_unknown_count,'recipients',(select json_agg(json_build_object('email',recipient_email,'status',status,'error',error)) from (select * from (${
              source.recipientResultsQuery(toolId("id"))
            }) results order by id limit tool_limit offset tool_offset)))`,
          );
        },
      ),
    ],
    actions: [
      tools.action(
        "send",
        "Approve sending the previewed emails through your connected mailbox. Queued messages cannot be undone.",
        "{sender_key:string;template_id:number;recipient_ids:number[];fingerprint:string;request_key:string}",
        (s) => {
          toolObject(s, [
            "sender_key",
            "template_id",
            "recipient_ids",
            "fingerprint",
            "request_key",
          ]);
          toolString(s, "fingerprint", 64, true);
          toolString(s, "request_key", 36, true);
          s.throwErrorIf(
            sql`try_cast(${toolValue("request_key")} as uuid) is null`,
            sql.lit`Use the request_key returned by preview.`,
          );
          const prepared = prepare(s);
          s.throwErrorIf(
            sql`fingerprint <> ${toolValue("fingerprint")}`,
            sql
              .lit`Recipients or content changed. Preview again before sending.`,
          );
          s.defScalar(
            "request_record_key",
            sql`'spark:' || current_user::string || ':' || try_cast(${
              toolValue("request_key")
            } as uuid)::string`,
          );
          s.defRecord(
            "previous_delivery",
            sql`select * from db.connected_account_email_deliveries where source=${
              sql.lit(source.config.key)
            } and source_record_key=request_record_key`,
          );
          s.if(sql`previous_delivery.id is not null`, (s) => {
            s.defScalar(
              "previous_fingerprint",
              sql`bytes.to_hex(crypto.sha256(string.to_utf8(json_build_object('user',current_user,'sender',previous_delivery.integration_key || ':' || previous_delivery.account_id::string || ':' || lower(trim(previous_delivery.from_email)),'subject',previous_delivery.subject_template,'html',previous_delivery.html_template,'recipients',(select json_agg(json_build_object('key',source_recipient_key,'email',recipient_email,'variables',variables) order by source_recipient_key) from db.connected_account_email_recipient_outbox where delivery_id=previous_delivery.id))::string)))`,
            );
            s.throwErrorIf(
              sql`previous_fingerprint <> fingerprint`,
              sql
                .lit`This request_key was already used for different content. Inspect its delivery before starting a new send.`,
            );
          });
          source.enqueue(s, {
            ...prepared,
            sourceRecordKey: sql`request_record_key`,
            deliveryIdScalar: "sent_delivery_id",
          });
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',sent_delivery_id,'recipient_count',(select count(*) from recipients))`,
          );
        },
        true,
      ),
    ],
    doc:
      "Use options, then preview, then send with the exact fingerprint and request_key. Sending requires human approval and revalidates sender access, recipients and content. Retries must reuse request_key; a new preview supplies a new key for a separately approved send. Reusing a key for changed content is rejected; uncertain outcomes must not be retried as new sends. Selected-row adapters must return exactly one recipient per selected ID with that ID as source_recipient_key. Results are scoped to currently accessible mailboxes. No OAuth tokens or provider credentials are exposed.",
  };
}
