import { MaterialIcon } from "components/material_icon";
import { Button } from "components/button";
import { PdfMarkupViewer } from "components/pdf_markup";
import { MarkdownDisplay } from "components/markdown_display";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { Each, Show } from "std/ui";
import { visibleConversationId } from "./helpers";

function loadArtifact(s: UiServerStatements, id: Sql) {
  s.defRecord(
    "chosen_file",
    sql`select f.* from db.spark_attachments f join db.spark_agent_events e on e.id = f.spark_event_id
              join db.spark_agents a on a.id = e.spark_agent_id where f.id = ${id} and f.expires_at > now()
              and a.spark_conversation_id = ${
      visibleConversationId(sql`active_conversation_id`)
    }`,
  );
  s.if(
    sql`chosen_file.id is null`,
    (s) => s.throwError(sql.lit`File is unavailable.`),
  );
  s.if(
    sql`chosen_file.blob_hash is not null`,
    (s) =>
      s.readBlob(sql`chosen_file.blob_hash`, {
        setContentScalar: "ui.artifact_bytes",
      }),
    (s) =>
      s.setScalar(
        "ui.artifact_bytes",
        sql`string.to_utf8(chosen_file.text_content)`,
      ),
  );
  s.setScalar("ui.selected_artifact", sql`chosen_file.id`);
  s.setScalar("ui.artifact_name", sql`chosen_file.name`);
  s.setScalar("ui.artifact_mime", sql`chosen_file.mime_type`);
}

/** Files are evidence: undo never deletes a saved deliverable. */
export function SparkArtifactsPanel({ basePath }: { basePath?: string }) {
  return (
    <Data
      local
      watch={[sql`active_conversation_id`]}
      procedure={(s) => {
        s.defScalar("selected_artifact", sql`null::bigint`);
        s.defScalar("artifact_bytes", {
          type: { type: "Bytes", maxLength: 16777216 },
        });
        s.defScalar("artifact_name", sql.lit``);
        s.defScalar("artifact_mime", sql.lit``);
      }}
    >
      <div
        onMount={(s) =>
          s.if(sql`requested_artifact_id is not null`, (s) => {
            s.tryServer({
              body: (s) => loadArtifact(s, sql`requested_artifact_id`),
            });
          })}
      />
      <Show when={sql`selected_artifact is null`}>
        <Data
          watch={[sql`refresh_key`]}
          procedure={(s) => {
            s.defTable(
              "artifacts",
              sql`select f.id, f.name, f.mime_type, f.file_size, e.created_at,
        'Request ' || a.id::string as execution_title,
        exists(select 1 from db.spark_action_log r join db.spark_agent_events re on re.id = r.execution_event_id
          join db.spark_agents ra on ra.id = re.spark_agent_id
          where ra.spark_conversation_id = a.spark_conversation_id and r.status = 'undone'
          and ra.id = a.id) as has_undone_work
        from db.spark_attachments f join db.spark_agent_events e on e.id = f.spark_event_id
        join db.spark_agents a on a.id = e.spark_agent_id
        where a.spark_conversation_id = ${
                visibleConversationId(sql`active_conversation_id`)
              } and f.expires_at > now()
        order by f.id desc`,
            );
          }}
        >
          <Show when={sql`not exists(select 1 from artifacts)`}>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <MaterialIcon
                icon="FolderOpen"
                sx={{ fontSize: 32 }}
                className="text-secondary"
              />
              <h3 className="text-sm font-medium">No saved files yet.</h3>
              <p className="max-w-xs text-sm text-secondary">
                Files created or attached in this session will appear here.
              </p>
            </div>
          </Show>
          <Show when={sql`exists(select 1 from artifacts)`}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium">Saved files</h3>
              <span className="text-xs text-secondary">
                {sql`(select count(*) from artifacts)::string || ' files'`}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-divider">
              <Each table="artifacts" recordName="artifact">
                <div data-work-file="true">
                  <div data-work-file-icon="true">
                    <Show when={sql`artifact.mime_type = 'application/pdf'`}>
                      <MaterialIcon icon="PictureAsPdf" fontSize="sm" />
                    </Show>
                    <Show when={sql`artifact.mime_type like 'image/%'`}>
                      <MaterialIcon icon="Image" fontSize="sm" />
                    </Show>
                    <Show
                      when={sql`artifact.mime_type != 'application/pdf' and artifact.mime_type not like 'image/%'`}
                    >
                      <MaterialIcon icon="Description" fontSize="sm" />
                    </Show>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium break-words">
                      {sql`artifact.name`}
                    </h3>
                    <p className="my-1 text-xs text-secondary">
                      {sql`case when artifact.mime_type = 'application/pdf' then 'PDF' when artifact.mime_type like 'image/%' then 'Image' when artifact.mime_type = 'text/markdown' then 'Markdown' else 'Document' end || ' · ' || case when artifact.file_size < 1024 then artifact.file_size::string || ' B' else (artifact.file_size / 1024)::string || ' KB' end || ' · ' || format.date(artifact.created_at, '%b %d, %H:%M')`}
                    </p>
                    <p className="mt-1 truncate text-xs text-secondary">
                      {sql`artifact.execution_title`}
                    </p>
                    <Show when={sql`artifact.has_undone_work`}>
                      <p className="mt-2 text-xs text-secondary">
                        This execution includes undone changes. File retained
                        for reference.
                      </p>
                    </Show>
                    <ActionButton
                      variant="plain"
                      color="neutral"
                      size="sm"
                      refetch={false}
                      errorDisplay="inline"
                      action={(s) => {
                        loadArtifact(s, sql`artifact.id`);
                      }}
                    >
                      Open file
                    </ActionButton>
                  </div>
                </div>
              </Each>
            </div>
          </Show>
        </Data>
        {basePath !== undefined
          ? (
            <Data
              watch={[sql`refresh_key`]}
              procedure={(s) =>
                s.defTable(
                  "saved_cards",
                  sql`select e.id, e.created_at
        from db.spark_agent_events e join db.spark_agents a on a.id = e.spark_agent_id
        where a.spark_conversation_id = ${
                    visibleConversationId(sql`active_conversation_id`)
                  } and e.type = 'card_displayed' order by e.id desc`,
                )}
            >
              <Each table="saved_cards" recordName="saved_card">
                <a
                  className="my-3 flex items-center gap-3 rounded-lg border border-divider p-4 text-sm font-medium text-primary-600"
                  href={sql`${
                    sql.lit(basePath)
                  } || '/' || active_conversation_id::string || '/card/' || saved_card.id::string`}
                >
                  <MaterialIcon icon="Dashboard" fontSize="sm" />
                  {sql`'Interactive card · ' || format.date(saved_card.created_at, '%b %d, %H:%M')`}
                </a>
              </Each>
            </Data>
          )
          : null}
      </Show>
      <Show when={sql`selected_artifact is not null`}>
        <Button
          variant="plain"
          color="neutral"
          startDecorator={<MaterialIcon icon="ArrowBack" fontSize="sm" />}
          size="sm"
          sx={{ alignSelf: "flex-start", mb: 2 }}
          onClick={(s) => s.setScalar("selected_artifact", sql`null`)}
        >
          Back to files
        </Button>
        <section className="overflow-hidden rounded-lg border border-divider">
          <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <h3 className="min-w-0 text-sm font-semibold break-words">
              {sql`artifact_name`}
            </h3>
            <Button
              variant="outlined"
              color="neutral"
              startDecorator={<MaterialIcon icon="Download" fontSize="sm" />}
              size="sm"
              onClick={(s) =>
                s.download(
                  sql`artifact_name`,
                  sql`artifact_bytes`,
                  sql`artifact_mime`,
                )}
            >
              Download
            </Button>
          </div>
          <Show
            when={sql`artifact_mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`}
          >
            <img
              className="mx-auto max-w-full p-4"
              alt={sql`artifact_name`}
              src={sql`'data:' || artifact_mime || ';base64,' || encode.base64(artifact_bytes)`}
            />
          </Show>
          <Show when={sql`artifact_mime = 'text/markdown'`}>
            <MarkdownDisplay
              className="p-5"
              content={sql`string.from_utf8(artifact_bytes)`}
            />
          </Show>
          <Show
            when={sql`artifact_mime in ('text/plain', 'text/csv', 'application/json')`}
          >
            <pre className="m-0 min-h-48 overflow-auto whitespace-pre-wrap break-words bg-level1 p-5 text-sm leading-relaxed">{sql`string.from_utf8(artifact_bytes)`}</pre>
          </Show>
          <Show when={sql`artifact_mime = 'application/pdf'`}>
            <PdfMarkupViewer
              fileName={sql`artifact_name`}
              height="min(640px, calc(100dvh - 260px))"
              fileUrl={sql`'/api/spark/attachments/' || selected_artifact::string || '/pdf'`}
            />
          </Show>
          <Show
            when={sql`artifact_mime not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/markdown', 'text/plain', 'text/csv', 'application/json', 'application/pdf')`}
          >
            <p className="p-5 text-sm text-secondary">
              Download this file to view it in its application.
            </p>
          </Show>
        </section>
      </Show>
    </Data>
  );
}
