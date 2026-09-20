import { sql } from "std/sql_utils";
import type { SparkTool } from "./agent";

/** Saved work uses the same blob-backed attachments as native Spark. */
export function externalSparkArtifactTools(): SparkTool[] {
  return ["listArtifacts", "readArtifact", "saveArtifact"].map((name) => ({
    name,
    statements: (s) => {
      s.if(
        sql`not exists(select 1 from db.spark_conversations c where c.id = spark_js_conversation_id and c.sys_user_id = spark_js_owner_id)`,
        (s) => s.throwError(sql.lit`Select your external Spark session first.`),
      );
      if (name === "listArtifacts") {
        s.return(
          sql`coalesce((select json_array_agg(json_build_object('id',id,'name',name,'mimeType',mime_type,'size',file_size)) from (select id,name,mime_type,file_size from db.spark_attachments where spark_event_id in (select e.id from db.spark_agent_events e join db.spark_agents a on a.id = e.spark_agent_id where a.spark_conversation_id = spark_js_conversation_id) and expires_at > now() order by id desc limit 100)), '[]'::json)`,
        );
      } else if (name === "readArtifact") {
        s.defRecord(
          "artifact",
          sql`select id,name,mime_type,blob_hash,file_size from db.spark_attachments where id = try_cast(tool_input->0->>'id' as bigint) and spark_event_id in (select e.id from db.spark_agent_events e join db.spark_agents a on a.id = e.spark_agent_id where a.spark_conversation_id = spark_js_conversation_id) and expires_at > now()`,
        );
        s.if(
          sql`artifact.id is null`,
          (s) => s.throwError(sql.lit`Artifact not found in this session.`),
        );
        s.readBlob(sql`artifact.blob_hash`, {
          defContentScalar: "artifact_bytes",
        });
        s.setJsBytes(sql`artifact_bytes`, { defIdScalar: "artifact_bytes_id" });
        s.return(
          sql`json_build_object('__sparkBytesId',artifact_bytes_id,'name',artifact.name,'mimeType',artifact.mime_type)`,
        );
      } else {
        s.defScalar("artifact_name", sql`tool_input->0->>'name'`);
        s.defScalar("artifact_mime", sql`tool_input->0->>'mimeType'`);
        s.if(
          sql`coalesce(length(artifact_name),0) not between 1 and 500 or coalesce(length(artifact_mime),0) not between 1 and 200`,
          (s) => s.throwError(sql.lit`Supply a name and MIME type.`),
        );
        s.getJsBytes(sql`try_cast(tool_input->0->>'bytesId' as bigint)`, {
          defBytesScalar: "artifact_bytes",
        });
        s.if(
          sql`octet_length(artifact_bytes) > 16777216`,
          (s) => s.throwError(sql.lit`Saved artifacts are limited to 16 MiB.`),
        );
        s.createBlob(sql`artifact_bytes`, { defHashScalar: "artifact_hash" });
        s.startTransaction();
        s.if(
          sql`not exists(select 1 from db.spark_conversations c where c.id = spark_js_conversation_id and c.sys_user_id = spark_js_owner_id and c.status = 'active' and not c.is_paused)`,
          (s) =>
            s.throwError(
              sql.lit`This session is not writable through this connection.`,
            ),
        );
        s.defScalar("artifact_event_id", { type: "BigInt" });
        s.modify(
          sql`insert into db.spark_agent_events (spark_agent_id, type, payload)
          values (spark_js_agent_id, 'artifact_saved', json_build_object('source', 'mcp'))
          returning id into artifact_event_id`,
        );
        s.defScalar("artifact_id", { type: "BigInt" });
        s.modify(
          sql`insert into db.spark_attachments (spark_event_id,name,mime_type,file_size,blob_hash) values (artifact_event_id,artifact_name,artifact_mime,octet_length(artifact_bytes),artifact_hash) returning id into artifact_id`,
        );
        s.commitTransaction();
        s.return(
          sql`json_build_object('id',artifact_id,'sessionId',spark_js_conversation_id,'name',artifact_name,'mimeType',artifact_mime,'size',octet_length(artifact_bytes))`,
        );
      }
    },
  }));
}
