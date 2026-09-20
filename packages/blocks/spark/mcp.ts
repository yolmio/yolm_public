import {
  mcpMetadata,
  mcpResult as result,
  mcpToolError,
  parseMcpRequest,
} from "blocks/mcp/protocol";
import { sparkMcpSessions } from "./mcp_sessions";
import {
  authenticateMcp,
  mcpPermission,
  registerMcpOAuth,
  type TenantMcpOptions,
} from "blocks/mcp";
import { MCP_TOOL_SCHEMAS } from "blocks/mcp/tool_schemas";
import { type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import {
  buildCapabilityCatalogEntry,
  buildNativeSystemPrompt,
  type RegisterReactorsOpts,
  sparkDocumentIndexForUser,
  sparkRootInstructionsExpr,
  sparkSkillIndexExpr,
} from "./agent";
import { effectiveCapabilitiesJsonExpr } from "./query_policy";

export function sparkMcpOptions(
  opts: RegisterReactorsOpts,
  readOnly = false,
): RegisterReactorsOpts {
  return {
    ...opts,
    enableDynamicUi: false,
    capabilities: opts.capabilities.filter((c) => !c.internal).map((c) => ({
      ...c,
      actions: readOnly ? [] : c.actions,
    })),
  };
}
export function sparkMcpCapabilities(
  opts: RegisterReactorsOpts,
  user: Sql,
): Sql {
  const caps = opts.capabilities.filter((c) => !c.internal);
  return effectiveCapabilitiesJsonExpr(
    caps,
    sql`${sql.lit(JSON.stringify(caps.map((c) => c.name)))}::json`,
    user,
  );
}
function instructions(opts: RegisterReactorsOpts, readOnly = false): Sql {
  let catalog: Sql = sql`''`;
  for (const cap of opts.capabilities) {
    catalog =
      sql`${catalog} || case when spark_js_conv_capabilities @> json_build_array(${
        sql.lit(cap.name)
      }) then chr(10) || ${
        sql.lit(buildCapabilityCatalogEntry(cap))
      } else '' end`;
  }
  const core = buildNativeSystemPrompt(opts, true, readOnly);
  return sql`${
    sql.lit(core)
  } || chr(10) || 'Available capabilities:' || ${catalog} || chr(10) || ${
    sparkRootInstructionsExpr(opts.workspace)
  } || ${sparkSkillIndexExpr(opts.workspace)} || ${
    opts.knowledge
      ? sparkDocumentIndexForUser(opts.knowledge, sql`spark_js_owner_id`)
      : sql`''`
  } || chr(10) || 'Today: ' || current_date::string || chr(10) || 'This initialization is a snapshot. Read AGENTS.md and Skills/ files again when instructions change. This connection covers one system. Conversation stays in your client; actions retain Yolm receipts.'`;
}
const catalog = [
  {
    name: "list_sessions",
    description:
      "List your external Spark work sessions, optionally filtering by name.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      ...MCP_TOOL_SCHEMAS.spark.list_sessions,
      additionalProperties: false,
    },
  },
  {
    name: "create_session",
    description:
      "Create a named Spark work session for actions, approvals and saved results. Returns a session link. Each call creates a session; inspect before retrying a lost response.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      ...MCP_TOOL_SCHEMAS.spark.create_session,
      additionalProperties: false,
    },
  },
  ...["execRead", "exec"].map((name) => ({
    name,
    description: name === "execRead"
      ? "Read-only Spark JavaScript: tools.query, tools.readFile, tools.readCapability, permitted files, skills, read-only capability functions and tools.actionReceipt. No actions or saved artifacts. Emit text(value) or image(bytes). Optional sessionId loads that session's task context."
      : "Run Spark JavaScript with tools.*. Use relevant Skills/*/SKILL.md and capability docs first. Reuse one sessionId for the whole job across subagents. tools.saveArtifact({name,mimeType,bytes|text}) saves results to the session; tools.listArtifacts() and tools.readArtifact({id}) retrieve them. Reversible actions execute immediately; approval actions return proposals reviewed in the Spark session. Each action call creates a new receipt; inspect session activity before retrying a lost response. tools.actionReceipt and tools.undoReceipt use exact receipt IDs. For atomic bulk undo, use tools.previewUndo({receiptIds:[...]}); inspect the analysis, then tools.undoReceipts({preview}) with that exact preview. Scripts are not atomic. tools.createMessage({message}) optionally publishes an outcome after the work; actions and files are visible automatically. text(value) and image(bytes) return MCP content. Executions are recorded as external runs; no native inference is started.",
    annotations: {
      readOnlyHint: name === "execRead",
      openWorldHint: name !== "execRead",
    },
    inputSchema: {
      type: "object",
      ...MCP_TOOL_SCHEMAS.spark[name as "execRead" | "exec"],
      additionalProperties: false,
    },
  })),
];
const registered = new Set<string>();
export function registerSparkMcp(
  connection: TenantMcpOptions,
  original: RegisterReactorsOpts,
) {
  if (registered.has(connection.domain)) return;
  registered.add(connection.domain);
  registerMcpOAuth(connection);
  const opts = sparkMcpOptions(original);
  const api = system.api({
    domain: connection.domain,
    domainAliases: connection.domainAliases,
    prefix: "/api",
  });
  const endpointPath = "/spark/mcp";
  for (const method of ["get", "delete"] as const) {
    api[method](endpointPath, {
      procedure: (s) => {
        authenticateMcp(s, connection);
        s.setHttpStatus(405);
        s.setHeader("allow", sql.lit`POST`);
        s.return();
      },
    });
  }
  api.post(endpointPath, {
    textBodyScalar: "mcp_body_text",
    procedure: (s) => {
      authenticateMcp(s, connection);
      parseMcpRequest(s);
      s.defScalar("spark_js_owner_id", sql`mcp_user_id`);
      s.defScalar(
        "spark_js_conv_capabilities",
        effectiveCapabilitiesJsonExpr(
          opts.capabilities,
          sql`mcp_grant.capabilities`,
          sql`spark_js_owner_id`,
        ),
      );

      mcpMetadata(s, {
        name: "Yolm Spark",
        instructions: sql`case when mcp_grant.access = 'write' then ${
          instructions(opts)
        } else ${instructions(sparkMcpOptions(original, true), true)} end`,
        tools: sql`case when mcp_grant.access = 'write' then ${
          sql.lit(JSON.stringify(catalog))
        } else ${
          sql.lit(JSON.stringify(catalog.filter((t) =>
            t.name === "execRead" || t.name === "list_sessions"
          )))
        } end::json`,
      });
      s.try({
        body: (s) => {
          s.defScalar(
            "mcp_args",
            sql`coalesce(mcp_body->'params'->'arguments','{}'::json)`,
          );
          s.defScalar("mcp_tool_name", sql`mcp_body->'params'->>'name'`);
          s.if(
            sql`json_typeof(mcp_args) != 'object'`,
            (s) => s.throwError(sql.lit`Tool arguments must be an object.`),
          );
          sparkMcpSessions(s, connection, result);
          s.if(
            sql`mcp_tool_name not in ('exec','execRead') or coalesce(json_typeof(mcp_args->'code'),'') != 'string' or length(mcp_args->>'code') not between 1 and 262144 or mcp_args - 'code' - 'sessionId' != '{}'::json`,
            (s) =>
              s.throwError(
                sql
                  .lit`Use execRead or exec with {code, sessionId?}.`,
              ),
          );
          s.if(
            sql`mcp_tool_name = 'exec' and (mcp_grant.access != 'write' or not (${
              mcpPermission(connection, sql`mcp_user_id`, sql.lit`write`)
            }))`,
            (s) => s.throwError(sql.lit`This connection is read-only.`),
          );
          s.defScalar(
            "mcp_session_id",
            sql`try_cast(mcp_args->>'sessionId' as bigint)`,
          );
          s.if(
            sql`mcp_args ? 'sessionId' and (coalesce(json_typeof(mcp_args->'sessionId'),'') != 'number' or not regex.is_match(mcp_args->>'sessionId','^[0-9]+$') or mcp_session_id is null)`,
            (s) =>
              s.throwError(sql.lit`sessionId must be a nonnegative integer.`),
          );
          s.if(
            sql`mcp_tool_name = 'exec' and mcp_session_id is null`,
            (s) =>
              s.throwError(
                sql
                  .lit`Create or select a session and pass sessionId to exec. Use execRead for stateless reads.`,
              ),
          );
          s.if(
            sql`mcp_session_id is not null and not exists(select 1 from db.spark_conversations c where c.id = mcp_session_id and c.sys_user_id = mcp_user_id)`,
            (s) => s.throwError(sql.lit`Session not found.`),
          );
          s.defScalar(
            "mcp_effective_grant_capabilities",
            sql`case when mcp_session_id is null then mcp_grant.capabilities else coalesce((select json_array_agg(value) from json.array_each(mcp_grant.capabilities) where (select capabilities_json from db.spark_conversations where id = mcp_session_id) @> json_build_array(value)), '[]'::json) end`,
          );
          s.defScalar("spark_mcp_agent_id", { type: "BigInt" });
          s.defScalar("spark_mcp_event_id", { type: "BigInt" });
          s.defScalar("spark_mcp_result", { type: "Json" });
          s.if(sql`mcp_tool_name = 'exec'`, (s) => {
            s.startTransaction();
            s.if(
              sql`not exists(select 1 from db.spark_conversations c where c.id = mcp_session_id and c.sys_user_id = mcp_user_id and c.status = 'active' and not c.is_paused)`,
              (s) => s.throwError(sql.lit`Session is unavailable.`),
            );
            s.modify(
              sql`insert into db.spark_agents (spark_conversation_id, execution_mode, status) values (mcp_session_id, 'external', 'executing') returning id into spark_mcp_agent_id`,
            );
            s.modify(
              sql`insert into db.spark_agent_events (spark_agent_id, type, content, payload) values (spark_mcp_agent_id, 'execute_script_success', mcp_args->>'code', json_build_object('source','mcp','state','running')) returning id into spark_mcp_event_id`,
            );
            s.modify(
              sql`update db.spark_conversations set last_message_at = now() where id = mcp_session_id`,
            );
            s.commitTransaction();
          });
          s.try({
            body: (s) => {
              s.callStoredProcedure("spark_exec", {
                inputScalars: {
                  spark_external: sql`true`,
                  spark_read_only: sql`mcp_tool_name = 'execRead'`,
                  mcp_connection_id: sql`mcp_connection_id`,
                  spark_js_owner_id: sql`mcp_user_id`,
                  spark_js_conversation_id: sql`mcp_session_id`,
                  spark_js_agent_id: sql`spark_mcp_agent_id`,
                  spark_js_execution_event_id: sql`spark_mcp_event_id`,
                  spark_granted_capabilities:
                    sql`mcp_effective_grant_capabilities`,
                  spark_code: sql`mcp_args->>'code'`,
                },
                outputScalars: { output: "spark_mcp_result" },
              });
              s.if(sql`spark_mcp_event_id is not null`, (s) => {
                s.startTransaction();
                s.modify(
                  sql`update db.spark_agent_events set payload = json_build_object('source','mcp','state','completed') where id = spark_mcp_event_id`,
                );
                s.modify(
                  sql`update db.spark_agents set status = 'completed', completed_at = now() where id = spark_mcp_agent_id`,
                );
                s.commitTransaction();
              });
              s.if(
                sql`octet_length(spark_mcp_result::string) > 16777216`,
                (s) => s.throwError(sql.lit`Output exceeds 16 MiB.`),
              );
              result(
                s,
                sql`json_build_object('content',spark_mcp_result->'outputs')`,
              );
            },
            errorName: "spark_exec_error",
            catch: (s) => {
              s.rollbackTransaction();
              s.if(sql`spark_mcp_event_id is not null`, (s) => {
                s.startTransaction();
                s.modify(
                  sql`update db.spark_agent_events set type = 'execute_script_error', error_message = spark_exec_error.message, payload = json_build_object('source','mcp','state','failed') where id = spark_mcp_event_id`,
                );
                s.modify(
                  sql`update db.spark_agents set status = 'failed', completed_at = now() where id = spark_mcp_agent_id`,
                );
                s.commitTransaction();
              });
              s.throwError(sql`spark_exec_error.message`);
            },
          });
        },
        errorName: "spark_mcp_error",
        catch: (s) => mcpToolError(s, sql`spark_mcp_error.message`),
      });
    },
  });
}
