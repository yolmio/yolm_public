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
import { CommentsBlock } from "blocks/comments";
import { singularize } from "std/inflectors";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { CrmBlock } from "./index";
import {
  logPipelineTaskCreatedProcedureName,
  movePipelineItemProcedureName,
  togglePipelineTaskProcedureName,
} from "./pipeline/stored_procedures";

/** Explicit organization-wide CRM management, including configured pipeline rules. */
export function crmSparkCapability(
  block: CrmBlock,
  opts: { permission: string },
): SparkCapability {
  const tools = blockToolset("crm", opts.permission);
  const entities = [
    {
      key: "people",
      table: block.peopleTableName,
      fields: ["first_name", "last_name", "email", "phone", "title"],
      comments: block.opts.people?.commentSection,
    },
    ...(system.db.tables[block.organizationsTableName]
      ? [{
        key: "organizations",
        table: block.organizationsTableName,
        fields: ["name", "website", "phone"],
        comments: block.opts.organizations?.commentSection,
      }]
      : []),
  ];
  const functions = [];
  const actions = [];
  for (const entity of entities) {
    const fields = entity.fields.filter((key) =>
      system.db.tables[entity.table].fields[key]?.type === "String"
    );
    if (fields.length) {
      functions.push(
        tools.read(
          `find_${entity.key}`,
          `Find ${entity.key} by their standard fields.`,
          "{query?:string;offset?:number;limit?:number}",
          (s) => {
            toolObject(s, ["query", "offset", "limit"]);
            toolString(s, "query", 200);
            toolPage(s);
            s.setScalar(
              "tool_output",
              sql`json_build_object('items',coalesce((select json_agg(json_build_object('id',id,${
                fields.flatMap((f) => [sql.lit(f), sql.ref(f)])
              })) from (select id,${fields.map((f) => sql.ref(f))} from db.${
                sql.ref(entity.table)
              } where ${
                sql.or(...fields.map((f) =>
                  sql`contains(lower(coalesce(${
                    sql.ref(f)
                  },'')),lower(coalesce(${toolValue("query")},'')))`
                ))
              } order by id limit tool_limit offset tool_offset)),'[]'::json))`,
            );
          },
        ),
      );
      actions.push(
        tools.action(
          `update_${entity.key}`,
          `Patch standard ${entity.key} fields; omitted fields are preserved.`,
          `{id:number;${fields.map((f) => `${f}?:string|null`).join(";")}}`,
          (s) => {
            toolObject(s, ["id", ...fields]);
            toolInteger(s, "id", true);
            for (const key of fields) {
              const field = system.db.tables[entity.table].fields[key];
              if (field.type === "String") {
                toolString(s, key, field.maxLength);
                if (field.notNull) {
                  s.throwErrorIf(
                    sql`p_input ? ${sql.lit(key)} and ${
                      toolValue(key)
                    } is null`,
                    sql.lit(`${key} cannot be null.`),
                  );
                }
              }
            }
            s.throwErrorIf(
              sql`not exists(select 1 from db.${
                sql.ref(entity.table)
              } where id=${toolId("id")})`,
              sql.lit`CRM record not found.`,
            );
            s.modify(
              sql`update db.${sql.ref(entity.table)} set ${
                fields.map((f) =>
                  sql`${sql.ref(f)}=case when p_input ? ${sql.lit(f)} then ${
                    toolValue(f)
                  } else ${sql.ref(f)} end`
                )
              },last_modified_at=now() where id=${toolId("id")}`,
            );
            s.setScalar(
              "tool_output",
              sql`json_build_object('id',${toolId("id")})`,
            );
          },
        ),
      );
    }
    if (entity.comments) {
      const comments = system.block(CommentsBlock);
      const fk = `${singularize(entity.table)}_id`;
      actions.push(
        tools.action(
          `log_${entity.key}_activity`,
          `Add an activity note to the record's discussion. This may notify subscribers.`,
          "{id:number;text:string}",
          (s) => {
            toolObject(s, ["id", "text"]);
            toolInteger(s, "id", true);
            toolString(s, "text", 4000, true);
            s.throwErrorIf(
              sql`not exists(select 1 from db.${
                sql.ref(entity.table)
              } where id=${toolId("id")})`,
              sql.lit`CRM record not found.`,
            );
            s.defScalar(
              "thread_id",
              sql`(select min(id) from db.comment_threads where ${
                sql.ref(fk)
              }=${toolId("id")})`,
            );
            s.defScalar(
              "comment_body",
              sql`lexical_simple_paragraph(${toolValue("text")})`,
            );
            s.if(sql`thread_id is null`, (s) =>
              comments.createThread(s, {
                values: { [fk]: toolId("id") },
                body: sql`comment_body`,
                intoThread: "new_thread_id",
              })).else((s) =>
                comments.post(s, {
                  threadId: sql`thread_id`,
                  body: sql`comment_body`,
                })
              );
            s.setScalar(
              "tool_output",
              sql`json_build_object('id',${toolId("id")},'recorded',true)`,
            );
          },
          true,
        ),
      );
    }
  }
  if (block.pipelines.length) {
    functions.push(
      tools.read(
        "pipeline_items",
        "List configured pipelines and their items.",
        "{offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["offset", "limit"]);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('pipelines',${
              sql.lit(
                JSON.stringify(
                  block.pipelines.map((p) => ({
                    name: p.name,
                    stages: p.stages.map((s) => s.name),
                  })),
                ),
              )
            }::json,'items',coalesce((select json_agg(json_build_object('id',id,'pipeline',pipeline_name,'stage',stage_name)) from (select id,pipeline_name,stage_name from db.${
              sql.ref(block.pipelineItemsTableName)
            } order by id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
    );
    actions.push(
      tools.action(
        "move_opportunity",
        "Move an existing pipeline item, enforcing exit criteria and automatic stage tasks.",
        "{id:number;stage:string}",
        (s) => {
          toolObject(s, ["id", "stage"]);
          toolInteger(s, "id", true);
          toolString(s, "stage", 100, true);
          s.defScalar(
            "pipeline",
            sql`(select pipeline_name::string from db.${
              sql.ref(block.pipelineItemsTableName)
            } where id=${toolId("id")})`,
          );
          s.throwErrorIf(
            sql`pipeline is null`,
            sql.lit`Pipeline item not found.`,
          );
          for (const pipeline of block.pipelines) {
            s.if(
              sql`pipeline=${sql.lit(pipeline.name)}`,
              (s) =>
                s.callStoredProcedure(
                  movePipelineItemProcedureName(block, pipeline.name),
                  {
                    inputScalars: {
                      p_item_id: toolId("id"),
                      p_stage: toolValue("stage"),
                      p_reorder: sql.false,
                      p_target_item_id: sql.null,
                      p_drop_position: sql.null,
                    },
                  },
                ),
            );
          }
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',${toolId("id")},'stage',${
              toolValue("stage")
            })`,
          );
        },
      ),
    );
  }
  if (block.pipelines.some((p) => block.hasPipelineTasksEnabled(p.name))) {
    functions.push(
      tools.read(
        "tasks",
        "List tasks for a pipeline item.",
        "{item_id:number;offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["item_id", "offset", "limit"]);
          toolInteger(s, "item_id", true);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('items',coalesce((select json_agg(json_build_object('id',id,'title',title,'description',description,'due_date',due_date,'completed',completed,'assigned_to',assigned_to)) from (select * from db.${
              sql.ref(block.pipelineTasksTableName)
            } where pipeline_item_id=${
              toolId("item_id")
            } order by id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
    );
    actions.push(
      tools.action(
        "create_task",
        "Create a task on an existing pipeline item and record its activity.",
        "{item_id:number;title:string;description?:string;assigned_to?:number;due_date?:string}",
        (s) => {
          toolObject(s, [
            "item_id",
            "title",
            "description",
            "assigned_to",
            "due_date",
          ]);
          toolInteger(s, "item_id", true);
          toolInteger(s, "assigned_to");
          toolString(s, "title", 255, true);
          toolString(s, "description", 2000);
          toolString(s, "due_date", 10);
          s.throwErrorIf(
            sql`${toolValue("due_date")} is not null and try_cast(${
              toolValue("due_date")
            } as date) is null`,
            sql.lit`Invalid due date.`,
          );
          s.throwErrorIf(
            sql`${
              toolId("assigned_to")
            } is not null and not exists(select 1 from sys_users where id=${
              toolId("assigned_to")
            } and not disabled)`,
            sql.lit`Assignee unavailable.`,
          );
          s.callStoredProcedure(logPipelineTaskCreatedProcedureName(block), {
            inputScalars: {
              p_item_id: toolId("item_id"),
              p_title: toolValue("title"),
            },
          });
          s.defScalar("saved_id", { type: "BigInt" });
          s.modify(
            sql`insert into db.${
              sql.ref(block.pipelineTasksTableName)
            }(pipeline_item_id,title,description,assigned_to,due_date,created_by) values(${
              toolId("item_id")
            },${toolValue("title")},${toolValue("description")},${
              toolId("assigned_to")
            },try_cast(${
              toolValue("due_date")
            } as date),current_user) returning id into saved_id`,
          );
          s.setScalar("tool_output", sql`json_build_object('id',saved_id)`);
        },
      ),
    );
    actions.push(
      tools.action(
        "set_task_completed",
        "Set completion explicitly; repeated calls do not toggle the task.",
        "{id:number;completed:boolean}",
        (s) => {
          toolObject(s, ["id", "completed"]);
          toolInteger(s, "id", true);
          toolBoolean(s, "completed");
          s.throwErrorIf(
            sql`not (p_input ? 'completed') or not exists(select 1 from db.${
              sql.ref(block.pipelineTasksTableName)
            } where id=${toolId("id")})`,
            sql.lit`Supply an existing task and completed boolean.`,
          );
          s.if(
            sql`(select completed from db.${
              sql.ref(block.pipelineTasksTableName)
            } where id=${toolId("id")}) is distinct from try_cast(${
              toolValue("completed")
            } as boolean)`,
            (s) =>
              s.callStoredProcedure(togglePipelineTaskProcedureName(block), {
                inputScalars: { p_task_id: toolId("id") },
              }),
          );
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',${toolId("id")},'completed',try_cast(${
              toolValue("completed")
            } as boolean))`,
          );
        },
      ),
    );
  }
  return {
    name: "crm",
    label: "CRM management",
    permission: opts.permission,
    description:
      "Find and update CRM records, log activities and manage pipeline tasks.",
    functions,
    actions,
    doc:
      "This capability grants organization-wide CRM management; use an administrator permission. Only standard contact/company fields are editable. Custom fields stay with their owning workflow. Activity tools exist only for configured CRM discussions and retain their access checks and notifications. Stage moves use the existing exit-criteria validation and task generation.",
  };
}
