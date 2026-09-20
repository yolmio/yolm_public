import { registerSparkBulkUndo } from "./bulk_undo";
import { userHasPermission } from "blocks/auth";
import { mcpPermission } from "blocks/mcp";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import {
  createSparkTools,
  type RegisterReactorsOpts,
  sparkExecScriptExpr,
} from "./agent";
import { effectiveCapabilitiesJsonExpr } from "./query_policy";

/** Native Spark and both MCP access modes share one compiled tool environment. */
export function registerSparkExecutor(opts: RegisterReactorsOpts) {
  registerSparkBulkUndo(opts);
  const actions = new Set(
    opts.capabilities.flatMap((c) =>
      (c.actions ?? []).map((a) => `${c.name}.${a.name}`)
    ),
  );
  const internal = new Set(
    opts.capabilities.filter((c) => c.internal).flatMap((c) =>
      [...(c.actions ?? []), ...(c.functions ?? [])].map((f) =>
        `${c.name}.${f.name}`
      )
    ),
  );
  const permission = (user: import("std/sql_utils").Sql) =>
    userHasPermission(sql.lit(opts.accessPermission ?? "can_use_spark"), user);
  system.storedProcedure({
    name: "spark_exec_access",
    transaction: "caller",
    inputScalars: [
      { name: "spark_external", type: "Bool" },
      { name: "spark_read_only", type: "Bool" },
      { name: "mcp_connection_id", type: "BigInt" },
      { name: "spark_js_owner_id", type: "BigInt" },
      { name: "spark_js_conversation_id", type: "BigInt" },
      { name: "spark_granted_capabilities", type: "Json" },
    ],
    outputScalars: [{ name: "capabilities", type: "Json" }],
    procedure: (s) => {
      if (opts.mcp !== false) {
        s.if(sql`spark_external`, (s) => {
          s.if(
            sql`not exists(select 1 from db.mcp_connections c join db.sys_users u on u.id = c.sys_user_id where c.id = mcp_connection_id and c.sys_user_id = spark_js_owner_id and c.surface = 'spark' and c.revoked_at is null and not u.disabled and (spark_read_only or c.access = 'write') and (${
              mcpPermission(
                {
                  surface: "spark",
                  domain: "",
                  path: "",
                  settingsPath: "",
                  permission,
                  capabilities: () => sql`'[]'::json`,
                },
                sql`u.id`,
                sql`case when spark_read_only then 'read' else 'write' end`,
              )
            }))`,
            (s) => s.throwError(sql.lit`This connection no longer has access.`),
          );
          s.if(
            sql`spark_js_conversation_id is not null and not exists(select 1 from db.spark_conversations c where c.id = spark_js_conversation_id and c.sys_user_id = spark_js_owner_id and (spark_read_only or (c.status = 'active' and not c.is_paused)))`,
            (s) => s.throwError(sql.lit`Session is unavailable.`),
          );
        });
      }
      s.setScalar(
        "capabilities",
        effectiveCapabilitiesJsonExpr(
          opts.capabilities,
          sql`case when spark_js_conversation_id is null then spark_granted_capabilities else coalesce((select json_array_agg(value) from json.array_each(spark_granted_capabilities) where (select capabilities_json from db.spark_conversations where id = spark_js_conversation_id) @> json_build_array(value)), '[]'::json) end`,
          sql`spark_js_owner_id`,
        ),
      );
    },
  });
  system.storedProcedure({
    name: "spark_exec",
    transaction: "standalone",
    inputScalars: [
      { name: "spark_external", type: "Bool" },
      { name: "spark_read_only", type: "Bool" },
      { name: "mcp_connection_id", type: "BigInt" },
      { name: "spark_js_owner_id", type: "BigInt" },
      { name: "spark_js_conversation_id", type: "BigInt" },
      { name: "spark_js_agent_id", type: "BigInt" },
      { name: "spark_js_execution_event_id", type: "BigInt" },
      { name: "spark_granted_capabilities", type: "Json" },
      { name: "spark_code", type: "String" },
    ],
    outputScalars: [{ name: "output", type: "Json" }],
    procedure: (s) => {
      s.defScalar("spark_js_conv_capabilities", { type: "Json" });
      refreshSparkExecAccess(s);
      s.setCurrentUser(sql`spark_js_owner_id`);
      s.setContext(
        sql`(select context_json from db.spark_conversations where id = spark_js_conversation_id)`,
      );
      s.runJavascript({
        script: sql`case when spark_external then ${
          sparkExecScriptExpr(
            {
              ...opts,
              capabilities: opts.capabilities.filter((c) => !c.internal),
            },
            sql`spark_code`,
            true,
          )
        } else ${sparkExecScriptExpr(opts, sql`spark_code`)} end`,
        resultScalar: "spark_result",
        includeLibs: sql`json_build_array('mammoth', 'xlsx')`,
        tools: createSparkTools(opts, true).map((tool) => ({
          ...tool,
          statements: (s) => {
            refreshSparkExecAccess(s);
            if (
              actions.has(tool.name) ||
              [
                "undoReceipt",
                "previewUndo",
                "undoReceipts",
                "saveArtifact",
                "createMessage",
                "askQuestions",
                "undoLastChanges",
              ]
                .includes(tool.name)
            ) {
              s.if(sql`spark_read_only`, (s) =>
                s.throwError(
                  sql
                    .lit`This operation is unavailable in read-only execution.`,
                ));
            }
            if (
              internal.has(tool.name) ||
              [
                "askQuestions",
                "undoLastChanges",
                "listAttachments",
                "readAttachment",
                "readPdfText",
                "renderPdfPage",
              ].includes(tool.name)
            ) {
              s.if(sql`spark_external`, (s) =>
                s.throwError(
                  sql.lit`This operation is unavailable through MCP.`,
                ));
            }
            tool.statements(s);
          },
        })),
      });
      s.setScalar("output", sql`spark_result`);
    },
  });
}

export const refreshSparkExecAccess = (
  s: import("std/statements").GeneralServerStatements,
) =>
  s.callStoredProcedure("spark_exec_access", {
    inputScalars: {
      spark_external: sql`spark_external`,
      spark_read_only: sql`spark_read_only`,
      mcp_connection_id: sql`mcp_connection_id`,
      spark_js_owner_id: sql`spark_js_owner_id`,
      spark_js_conversation_id: sql`spark_js_conversation_id`,
      spark_granted_capabilities: sql`spark_granted_capabilities`,
    },
    outputScalars: { capabilities: "spark_js_conv_capabilities" },
  });
