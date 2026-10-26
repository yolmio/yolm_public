import { Button } from "components/button";
import { MaterialIcon } from "components/material_icon";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Effect, Show, useUniqueId } from "std/ui";

/** Video content types browsers can attempt to play inline. */
export function isPlayableVideoMime(mimeType: Sql) {
  return sql`lower(split_part(coalesce(${mimeType}, ''), ';', 1)) in (
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime'
  )`;
}

/** Seeks a mounted {@link VideoPlayer} and starts playback. */
export function seekVideoPlayer(s: DomStatements, handle: Sql, timeMs: Sql) {
  s.jsCall({
    module: "video_player",
    exportName: "seek",
    handle,
    argJson: sql`json_build_object('handle', ${handle}, 'value', ${timeMs})`,
  });
}

export interface VideoPlayerProps {
  src: Sql;
  title: Sql;
  /** JSON array of `{ timeMs, title }`, shown as segments on the time slider. */
  chapters?: Sql;
  /** Milliseconds to open at, without starting playback. */
  startMs?: Sql;
  /**
   * Stable handle for {@link seekVideoPlayer}; generated when omitted. Pass one
   * that is unique per row when rendering players in a list, since the
   * generated one is shared by every row.
   */
  handle?: Sql;
  /** Extra classes for the player frame, such as rounding. */
  className?: string;
  /**
   * CSS length capping the player's height. The frame keeps the video's
   * proportions, so a capped frame narrows instead of cropping. Defaults to
   * `70dvh`.
   */
  maxHeight?: string;
  /** Text for the fallback shown when the browser can't play the file. */
  labels?: { unplayable: Sql | string; download: Sql | string };
  /** Receives the active chapter's `timeMs`, or null before the first one. */
  onChapterChange?: (s: DomStatements, startMs: Sql) => void;
}

/**
 * Plays a video with Video.js controls. When the browser can't decode the
 * file, it offers a download instead.
 */
export function VideoPlayer(props: VideoPlayerProps) {
  useJsModule("video_player");
  const id = useUniqueId();
  const handle = props.handle ?? sql.concat(id, sql.lit`-video-player`);
  const mountId = sql.concat(handle, sql.lit`-mount`);
  const chapters = props.chapters ?? sql`json_build_array()`;
  const maxHeight = props.maxHeight ?? "70dvh";
  const labels = props.labels ?? {
    unplayable: "This video can't be played in this browser.",
    download: "Download video",
  };
  const initialize = (s: DomStatements) => {
    s.setScalar("video_player_failed", sql.false);
    s.jsCall({
      module: "video_player",
      exportName: "initialize",
      handle,
      argJson: sql`json_build_object(
        'handle', ${handle},
        'elementId', ${mountId},
        'src', ${props.src},
        'title', ${props.title},
        'chapters', ${chapters},
        'startMs', ${props.startMs ?? sql`null::bigint`}
      )`,
    });
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => s.defScalar("video_player_failed", sql.false)}
    >
      <div
        className={`relative mx-auto overflow-hidden bg-black ${
          props.className ?? ""
        }`}
        sx={{
          // The video_player module sets --video-aspect from the loaded video.
          aspectRatio: "var(--video-aspect, 16 / 9)",
          width: `min(100%, calc(${maxHeight} * var(--video-aspect, 1.7778)))`,
        }}
        js={{
          handles: [{ module: "video_player", cleanup: "cleanup", handle }],
          on: {
            "video_player.ready": (s) => {
              s.setScalar("video_player_failed", sql.false);
              s.commitUiTreeChanges();
            },
            "video_player.unplayable": (s) => {
              s.setScalar("video_player_failed", sql.true);
              s.commitUiTreeChanges();
            },
            ...(props.onChapterChange
              ? {
                "video_player.chapterChange": (s: DomStatements) =>
                  props.onChapterChange!(
                    s,
                    sql`try_cast(event.payload_json->>'startMs' as bigint)`,
                  ),
              }
              : {}),
          },
        }}
      >
        {/* Start from the mount itself so the module always finds it. */}
        <div id={mountId} className="absolute inset-0" onMount={initialize} />
        <Show when={sql`ui.video_player_failed`}>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 p-4 text-center text-sm text-white">
            <MaterialIcon icon="VideocamOff" />
            <span>{labels.unplayable}</span>
            <Button
              component="a"
              href={props.src}
              download=""
              size="sm"
              variant="solid"
              startIcon="Download"
            >
              {labels.download}
            </Button>
          </div>
        </Show>
        {/* Reload when an already mounted player switches videos. */}
        <Effect watch={props.src} onChange={initialize} />
      </div>
    </Data>
  );
}
