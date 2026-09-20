import { Data } from "std/data";
import { Each, Show } from "std/ui";
import { sql } from "std/sql_utils";

/** External action activity remains reviewable after the chat client closes. */
export function SparkMcpActivity({ basePath }: { basePath: string }) {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "mcp_action_activity",
          sql`select r.id, r.action_name, r.status, r.result_json as result, session.id as session_id, session.label as client_name from db.spark_action_log r join db.spark_conversations session on session.id = r.spark_conversation_id where session.sys_user_id = current_user and session.source = 'mcp' order by r.id desc limit 100`,
        );
      }}
    >
      <section className="space-y-3">
        <h2 className="font-semibold">Recent assistant actions</h2>
        <p>
          Open the work session to review proposals, check results, or undo
          completed changes.
        </p>
        <Show when={sql`not exists(select 1 from mcp_action_activity)`}>
          <p>No external actions yet.</p>
        </Show>
        <Each table="mcp_action_activity" recordName="mcp_action">
          <article className="space-y-2 rounded-lg border p-4">
            <h3 className="font-semibold">
              <a
                href={sql`${
                  sql.lit(basePath)
                } || '/' || mcp_action.session_id::string`}
              >
                {sql`mcp_action.action_name`}
              </a>
            </h3>
            <p>
              {sql`mcp_action.client_name`} · Receipt{" "}
              {sql`mcp_action.id::string`} · {sql`mcp_action.status::string`}
            </p>
            <pre className="whitespace-pre-wrap break-all text-sm">{sql`coalesce(mcp_action.result::string, 'Awaiting an execution result')`}</pre>
          </article>
        </Each>
      </section>
    </Data>
  );
}
