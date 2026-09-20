import { type Sql, sql } from "std/sql_utils";
import type { EndpointStatements } from "std/statements";

export function mcpResult(s: EndpointStatements, result: Sql) {
  s.return(
    sql`json_build_object('jsonrpc', '2.0', 'id', mcp_body->'id', 'result', ${result})`,
  );
}
export function mcpError(s: EndpointStatements, code: number, message: string) {
  s.return(
    sql`json_build_object('jsonrpc', '2.0', 'id', case when json_typeof(mcp_body->'id') in ('string','number') then mcp_body->'id' else null end, 'error',
    json_build_object('code', ${code}, 'message', ${sql.lit(message)}))`,
  );
}

/** Shared stateless JSON-RPC framing, after tenant authentication. */
export function parseMcpRequest(s: EndpointStatements) {
  s.setHeader("content-type", sql.lit`application/json`);
  s.defScalar("mcp_body", sql`try_cast(mcp_body_text as json)`);
  s.if(sql`octet_length(mcp_body_text) > 1048576`, (s) => {
    s.setHttpStatus(413);
    mcpError(s, -32600, "Request exceeds 1 MiB");
  });
  s.if(sql`coalesce(json_typeof(mcp_body), '') = ''`, (s) => {
    s.setHttpStatus(400);
    mcpError(s, -32700, "Parse error");
  });
  s.if(
    sql`coalesce(json_typeof(mcp_body), '') != 'object'
    or coalesce(mcp_body->>'jsonrpc', '') != '2.0'
    or coalesce(json_typeof(mcp_body->'method'), '') != 'string'
    or (mcp_body ? 'id' and coalesce(json_typeof(mcp_body->'id'), '') not in ('string', 'number'))`,
    (s) => {
      s.setHttpStatus(400);
      mcpError(s, -32600, "Invalid request");
    },
  );
  s.getHeader(sql.lit`mcp-protocol-version`, { defScalar: "mcp_protocol" });
  s.if(
    sql`nullif(mcp_protocol, '') is not null and mcp_protocol not in ('2025-03-26', '2025-06-18', '2025-11-25')`,
    (s) => {
      s.setHttpStatus(400);
      mcpError(s, -32600, "Unsupported MCP protocol version");
    },
  );
  s.if(sql`not (mcp_body ? 'id')`, (s) => {
    s.setHttpStatus(202);
    s.return();
  });
}

/** Handles metadata methods; the caller then dispatches tools/call in its own scope. */
export function mcpMetadata(
  s: EndpointStatements,
  opts: { name: string; instructions: Sql; tools: Sql },
) {
  s.if(
    sql`mcp_body->>'method' = 'initialize'`,
    (s) =>
      mcpResult(
        s,
        sql`json_build_object('protocolVersion', case when mcp_body->'params'->>'protocolVersion'
      in ('2025-03-26', '2025-06-18', '2025-11-25') then mcp_body->'params'->>'protocolVersion' else '2025-11-25' end,
      'capabilities', json_build_object('tools', json_build_object()),
      'serverInfo', json_build_object('name', ${
          sql.lit(opts.name)
        }, 'version', '0.1.0'),
      'instructions', ${opts.instructions})`,
      ),
  );
  s.if(
    sql`mcp_body->>'method' = 'ping'`,
    (s) => mcpResult(s, sql`json_build_object()`),
  );
  s.if(
    sql`mcp_body->>'method' = 'tools/list'`,
    (s) => mcpResult(s, sql`json_build_object('tools', ${opts.tools})`),
  );
  s.if(
    sql`mcp_body->>'method' != 'tools/call'`,
    (s) => mcpError(s, -32601, "Method not found"),
  );
  s.if(
    sql`coalesce(json_typeof(mcp_body->'params'), '') != 'object'
    or coalesce(json_typeof(mcp_body->'params'->'name'), '') != 'string'
    or (mcp_body->'params' ? 'arguments' and coalesce(json_typeof(mcp_body->'params'->'arguments'), '') != 'object')`,
    (s) => mcpError(s, -32602, "Supply a tool name and object arguments"),
  );
}

export function mcpToolError(s: EndpointStatements, message: Sql) {
  mcpResult(
    s,
    sql`json_build_object('isError', true, 'content', json_build_array(json_build_object('type', 'text', 'text', ${message})))`,
  );
}
