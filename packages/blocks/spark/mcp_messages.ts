import { sql } from "std/sql_utils";
import type { SparkTool } from "./agent";

/** External clients can explain recorded work without starting native inference. */
export function externalSparkMessageTools(): SparkTool[] {
  return [{
    name: "createMessage",
    statements: (s) => {
      s.defScalar("external_message", sql`tool_input->0->>'message'`);
      s.if(
        sql`coalesce(json_typeof(tool_input->0->'message'), '') != 'string'
          or length(trim(coalesce(external_message, ''))) = 0
          or length(external_message) > 10000`,
        (s) => s.throwError(sql.lit`message must contain 1–10,000 characters.`),
      );
      s.startTransaction();
      s.if(
        sql`not spark_external or not exists(select 1 from db.spark_conversations c
          join db.spark_agents a on a.spark_conversation_id = c.id
          where c.id = spark_js_conversation_id and c.sys_user_id = spark_js_owner_id
          and c.source = 'mcp' and c.status = 'active' and not c.is_paused
          and a.id = spark_js_agent_id and a.execution_mode = 'external')`,
        (s) =>
          s.throwError(
            sql.lit`Select your active external Spark session first.`,
          ),
      );
      s.defScalar("external_message_id", { type: "BigInt" });
      s.modify(
        sql`insert into db.spark_agent_events (spark_agent_id, type, content, payload)
        values (spark_js_agent_id, 'external_message', external_message,
          json_build_object('source', 'mcp', 'created_by', spark_js_owner_id))
        returning id into external_message_id`,
      );
      s.modify(sql`update db.spark_conversations set last_message_at = now()
        where id = spark_js_conversation_id`);
      s.commitTransaction();
      s.return(
        sql`json_build_object('eventId', external_message_id, 'sessionId', spark_js_conversation_id)`,
      );
    },
  }];
}
