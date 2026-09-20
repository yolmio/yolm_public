import { type Sql, sql } from "std/sql_utils";
import type { EndpointStatements } from "std/statements";
import { mcpPermission, type TenantMcpOptions } from "blocks/mcp";

/** Session discovery/creation has no native agent or model execution. */
export function sparkMcpSessions(
  s: EndpointStatements,
  connection: TenantMcpOptions,
  result: (s: EndpointStatements, value: Sql) => void,
) {
  const text = (s: EndpointStatements, value: Sql) =>
    result(
      s,
      sql`json_build_object('content', json_build_array(json_build_object('type','text','text',(${value})::string)))`,
    );
  const basePath = connection.settingsPath.slice(
    0,
    connection.settingsPath.lastIndexOf("/"),
  );
  s.if(sql`mcp_tool_name = 'list_sessions'`, (s) => {
    s.if(
      sql`mcp_args - 'search' != '{}'::json or (mcp_args ? 'search' and (json_typeof(mcp_args->'search') != 'string' or length(mcp_args->>'search') > 255))`,
      (s) => s.throwError(sql.lit`Use {search?: string}.`),
    );
    text(
      s,
      sql`coalesce((select json_array_agg(json_build_object('sessionId',id,'name',label,'status',status,'url',mcp_origin || ${
        sql.lit(basePath)
      } || '/' || id::string) order by id desc) from (select id,label,status from db.spark_conversations where sys_user_id = mcp_user_id and source = 'mcp' and (nullif(mcp_args->>'search','') is null or position(lower(mcp_args->>'search') in lower(label)) > 0) order by id desc limit 50)), '[]'::json)`,
    );
  });
  s.if(sql`mcp_tool_name = 'create_session'`, (s) => {
    s.if(
      sql`mcp_grant.access != 'write' or not (${
        mcpPermission(connection, sql`mcp_user_id`, sql.lit`write`)
      })`,
      (s) =>
        s.throwError(sql.lit`This connection cannot create work sessions.`),
    );
    s.if(
      sql`mcp_args - 'name' - 'context' != '{}'::json or coalesce(json_typeof(mcp_args->'name'),'') != 'string' or length(trim(mcp_args->>'name')) not between 1 and 500 or (mcp_args ? 'context' and json_typeof(mcp_args->'context') != 'object') or octet_length(coalesce((mcp_args->'context')::string,'')) > 16384`,
      (s) =>
        s.throwError(
          sql
            .lit`Supply {name: string, context?: object}; context is limited to 16 KiB.`,
        ),
    );
    s.defScalar("created_session", { type: "BigInt" });
    s.startTransaction();
    s.modify(
      sql`insert into db.spark_conversations (sys_user_id,label,source,capabilities_json,context_json) values (mcp_user_id,trim(mcp_args->>'name'),'mcp',spark_js_conv_capabilities,mcp_args->'context') returning id into created_session`,
    );
    s.commitTransaction();
    text(
      s,
      sql`json_build_object('sessionId',created_session,'url',mcp_origin || ${
        sql.lit(basePath)
      } || '/' || created_session::string)`,
    );
  });
}
