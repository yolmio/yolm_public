import type { SparkCapability } from "blocks/spark";
import {
  blockToolset,
  toolBoolean,
  toolId,
  toolInteger,
  toolObject,
  toolPage,
  toolString,
  toolValue,
} from "blocks/spark/tool_contract";
import { sql } from "std/sql_utils";
import { assertEmailTemplateEditable } from "./editing";
import {
  type EmailTemplatesBlock,
  generateAdvancedTemplateBody,
} from "./index";

/** Author basic templates as text; render both basic and advanced templates. */
export function emailTemplatesSparkCapability(
  block: EmailTemplatesBlock,
  opts: { permission: string },
): SparkCapability {
  const tools = blockToolset("email_templates", opts.permission);
  return {
    name: "email_templates",
    label: "Email templates",
    permission: opts.permission,
    description:
      "Inspect, draft, edit and preview email templates without sending mail.",
    functions: [
      tools.read(
        "list",
        "List templates and supported variables.",
        "{offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["offset", "limit"]);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('variables', ${
              sql.lit(
                JSON.stringify({
                  ...block.getRecipientVariables(),
                  ...block.getLinkVariables(),
                }),
              )
            }::json, 'items', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'subject', subject, 'type', type, 'is_active', is_active)) from (select id,name,subject,type,is_active from db.email_templates order by id limit tool_limit offset tool_offset)), '[]'::json))`,
          );
        },
      ),
      tools.read(
        "preview",
        "Render a template without delivering it. Merge placeholders remain visible.",
        "{id:number}",
        (s) => {
          toolObject(s, ["id"]);
          toolInteger(s, "id", true);
          s.defRecord(
            "template",
            sql`select * from db.email_templates where id = ${toolId("id")}`,
          );
          s.throwErrorIf(
            sql`template.id is null`,
            sql.lit`Template not found.`,
          );
          s.defScalar("merged_body", {
            type: { type: "String", maxLength: 10_000_000 },
          });
          s.if(
            sql`template.type = 'basic'`,
            (s) =>
              s.setScalar(
                "merged_body",
                sql`lexical_rich_text_to_html_email(template.body)`,
              ),
          ).else((s) => generateAdvancedTemplateBody(s, sql`template.id`));
          s.setScalar(
            "tool_output",
            sql`json_build_object('id', template.id, 'name', template.name, 'subject', template.subject, 'html', substring(merged_body from 1 for 16000), 'truncated', length(merged_body)>16000)`,
          );
        },
      ),
    ],
    actions: [
      tools.action(
        "save_draft",
        "Create or edit a basic template using plain-text content. Advanced layouts must be edited in the template editor.",
        "{id?:number;name:string;subject:string;text:string;is_active?:boolean}",
        (s) => {
          toolObject(s, ["id", "name", "subject", "text", "is_active"]);
          toolInteger(s, "id");
          toolString(s, "name", 200, true);
          toolString(s, "subject", 200, true);
          toolString(s, "text", 20000, true);
          toolBoolean(s, "is_active");
          s.defScalar("saved_id", toolId("id"));
          assertEmailTemplateEditable(s, sql`saved_id`);
          s.defScalar(
            "body_json",
            sql`lexical_simple_paragraph(${toolValue("text")})`,
          );
          s.if(sql`saved_id is null`, (s) =>
            s.modify(
              sql`insert into db.email_templates(name,subject,type,body,is_active) values(trim(${
                toolValue("name")
              }),${toolValue("subject")},'basic',body_json,coalesce(try_cast(${
                toolValue("is_active")
              } as boolean),true)) returning id into saved_id`,
            )).else((s) => {
              s.throwErrorIf(
                sql`not exists(select 1 from db.email_templates where id=saved_id and type='basic')`,
                sql.lit`Editable basic template not found.`,
              );
              s.modify(
                sql`update db.email_templates set name=trim(${
                  toolValue("name")
                }), subject=${
                  toolValue("subject")
                }, body=body_json, is_active=coalesce(try_cast(${
                  toolValue("is_active")
                } as boolean),is_active) where id=saved_id`,
              );
            });
          s.setScalar("tool_output", sql`json_build_object('id',saved_id)`);
        },
        false,
        (s, result) => {
          assertEmailTemplateEditable(
            s,
            sql`try_cast(${result}->>'id' as bigint)`,
          );
        },
      ),
    ],
    doc:
      "Template changes do not send email. Editing templates used by scheduled or submitting campaigns is rejected; create a separate template instead. save_draft replaces all authored text and supports basic templates only; it never flattens an advanced layout.",
  };
}
