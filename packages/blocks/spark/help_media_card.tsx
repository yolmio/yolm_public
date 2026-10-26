import { Card } from "components/card";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { seekVideoPlayer, VideoPlayer } from "components/video_player";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";

function formatChapterTime(timeMs: Sql) {
  return sql`(${timeMs} / 60000)::string || ':' ||
    lpad(((${timeMs} % 60000) / 1000)::string, 2, '0')`;
}

/**
 * The help videos and images `tools.showHelpMedia` recorded on one exec step.
 * Each entry snapshots the document, section, and chapters, so rendering
 * needs no help request.
 */
export function HelpMediaCards(props: { eventId: Sql; entries: Sql }) {
  return (
    <Data
      local
      noRefetch
      // Rebuild only when a run adds an entry, so refetches don't remount.
      watch={[sql`json_array_length(${props.entries})`]}
      procedure={(s) =>
        s.defTable(
          "help_media_entries",
          sql`select entry.index as position, entry.value as payload
            from json.array_each(${props.entries}) entry
            order by entry.index`,
        )}
    >
      <div className="flex w-full flex-col gap-3">
        <Each
          table="help_media_entries"
          recordName="help_media_entry"
          eachKey={sql`help_media_entry.position::string`}
        >
          <HelpMediaCard
            handle={sql`'spark-help-media-' || ${props.eventId}::string ||
              '-' || help_media_entry.position::string`}
            payload={sql`help_media_entry.payload`}
          />
        </Each>
      </div>
    </Data>
  );
}

function HelpMediaCard(props: { handle: Sql; payload: Sql }) {
  const handle = props.handle;
  const isVideo = sql`${props.payload}->>'kind' = 'video'`;
  return (
    <Card variant="outlined" sx={{ p: 0, overflow: "hidden", width: "100%" }}>
      <div className="flex items-start gap-2 px-4 py-3">
        <MaterialIcon
          icon="MenuBook"
          className="mt-0.5 text-primary-600"
          fontSize="sm"
        />
        <div className="min-w-0">
          <Typography level="title-sm" className="break-words">
            {sql`${props.payload}->>'title'`}
          </Typography>
          <Typography level="body-xs" className="text-secondary break-words">
            {sql`concat_ws(' · ', ${props.payload}->>'documentTitle',
              ${props.payload}->>'sectionTitle')`}
          </Typography>
        </div>
      </div>
      <Show when={isVideo}>
        <Data
          local
          noRefetch
          procedure={(s) => {
            s.defScalar("help_media_active_ms", { type: "BigInt" });
            s.defTable(
              "help_media_chapters",
              sql`select
                  try_cast(chapter.value->>'timeMs' as bigint) as time_ms,
                  chapter.value->>'title' as title
                from json.array_each(
                  coalesce(${props.payload}->'chapters', '[]'::json)
                ) chapter
                order by time_ms`,
            );
          }}
        >
          <div className="bg-black">
            <VideoPlayer
              handle={handle}
              src={sql`${props.payload}->>'url'`}
              title={sql`${props.payload}->>'title'`}
              chapters={sql`${props.payload}->'chapters'`}
              startMs={sql`try_cast(${props.payload}->>'startMs' as bigint)`}
              maxHeight="60dvh"
              onChapterChange={(s, startMs) =>
                s.setScalar("help_media_active_ms", startMs)}
            />
          </div>
          <Show when={sql`exists(select 1 from help_media_chapters)`}>
            <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
              <Each table="help_media_chapters" recordName="help_chapter">
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full border border-divider px-2.5 py-1 text-xs text-primary-900 transition-colors hover:bg-level1"
                  dynamicClasses={[{
                    classes: "border-primary-400 bg-primary-50",
                    condition:
                      sql`help_chapter.time_ms = ui.help_media_active_ms`,
                  }]}
                  aria-label={sql`'Jump to ' || help_chapter.title`}
                  onClick={(s) =>
                    seekVideoPlayer(s, handle, sql`help_chapter.time_ms`)}
                >
                  <span className="font-mono text-[11px] text-primary-600">
                    {formatChapterTime(sql`help_chapter.time_ms`)}
                  </span>
                  <span>{sql`help_chapter.title`}</span>
                </button>
              </Each>
            </div>
          </Show>
        </Data>
      </Show>
      <Show when={sql`${props.payload}->>'kind' = 'image'`}>
        <img
          src={sql`${props.payload}->>'url'`}
          alt={sql`${props.payload}->>'title'`}
          className="block max-h-[60dvh] w-full bg-level1 object-contain"
        />
      </Show>
    </Card>
  );
}
