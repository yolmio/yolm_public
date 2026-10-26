import { Button } from "components/button";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import {
  mcpRelativeTime,
  mcpSettingsStyles as styles,
} from "blocks/mcp/settings";
import { Data } from "std/data";
import { Each, Show } from "std/ui";
import { sql } from "std/sql_utils";

/** Work sessions assistants opened over MCP, most recently active first. */
export function SparkMcpActivity({ basePath }: { basePath: string }) {
  return (
    <Data
      local
      procedure={(s) => s.defScalar("mcp_session_limit", sql`20::bigint`)}
    >
      <Data
        watch={[sql`mcp_session_limit`]}
        procedure={(s) => {
          // One extra row tells us whether older sessions exist without
          // counting them all.
          s.defTable(
            "mcp_sessions",
            sql`select session.id, session.label, session.last_message_at, session.status::string = 'archived' as archived, (select count(*) from db.spark_action_log r where r.spark_conversation_id = session.id and r.status = 'proposed') as pending_count from db.spark_conversations session where session.sys_user_id = current_user and session.source = 'mcp' order by session.last_message_at desc, session.id desc limit mcp_session_limit + 1`,
          );
          s.defScalar(
            "mcp_sessions_have_more",
            sql`(select count(*) from mcp_sessions) > mcp_session_limit`,
          );
          s.defScalar(
            "mcp_sessions_overflow_id",
            sql`case when mcp_sessions_have_more then (select id from mcp_sessions order by last_message_at, id limit 1) end`,
          );
        }}
      >
        <section className="flex flex-col gap-1.5">
          <Typography level="title-md">Assistant work sessions</Typography>
          <Typography level="body-sm" sx={styles.secondary}>
            Open a session to review proposals, check results, or undo completed
            changes.
          </Typography>
          <Show when={sql`not exists(select 1 from mcp_sessions)`}>
            <div sx={[styles.empty, { mt: 0.5 }]}>
              <MaterialIcon icon="History" fontSize="3xl" />
              <Typography level="title-sm" sx={styles.secondary}>
                No assistant sessions yet
              </Typography>
              <Typography level="body-sm">
                Work assistants do in Spark will appear here.
              </Typography>
            </div>
          </Show>
          <Show when={sql`exists(select 1 from mcp_sessions)`}>
            <div sx={[styles.list, { mt: 0.5 }]}>
              <Each
                table="mcp_sessions"
                recordName="mcp_session"
                where={sql`mcp_sessions_overflow_id is null or mcp_session.id != mcp_sessions_overflow_id`}
              >
                <a
                  sx={[styles.row, styles.linkRow]}
                  href={sql`${
                    sql.lit(basePath)
                  } || '/' || mcp_session.id::string`}
                >
                  <div sx={styles.rowBody}>
                    <div sx={styles.rowTitle}>
                      <Typography level="title-sm">
                        {sql`coalesce(nullif(mcp_session.label, ''), 'Untitled session')`}
                      </Typography>
                      <Show when={sql`mcp_session.pending_count > 0`}>
                        <Chip size="sm" variant="soft" color="warning">
                          {sql`mcp_session.pending_count::string`}{" "}
                          awaiting approval
                        </Chip>
                      </Show>
                      <Show when={sql`mcp_session.archived`}>
                        <Chip size="sm" variant="soft" color="neutral">
                          Archived
                        </Chip>
                      </Show>
                    </div>
                    <Typography level="body-sm" sx={styles.muted}>
                      Active {mcpRelativeTime(sql`mcp_session.last_message_at`)}
                    </Typography>
                  </div>
                  <MaterialIcon
                    icon="ChevronRight"
                    sx={[styles.muted, { alignSelf: "center" }]}
                  />
                </a>
              </Each>
            </div>
            <Show when={sql`mcp_sessions_have_more`}>
              <Button
                variant="plain"
                color="neutral"
                size="sm"
                sx={{ alignSelf: "center", mt: 0.5 }}
                onClick={(s) =>
                  s.setScalar("mcp_session_limit", sql`mcp_session_limit + 20`)}
              >
                Show older sessions
              </Button>
            </Show>
          </Show>
        </section>
      </Data>
    </Data>
  );
}
