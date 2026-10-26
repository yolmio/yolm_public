import { Button } from "components/button";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import { Effect, Show } from "std/ui";

/** Add these origins to frame-src in apps that render EmbeddedVideo. */
export const embeddedVideoFrameSources = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
];

/** Canonical player URLs are derived from recognized HTTPS video links only. */
export function ensureVideoEmbedFunction() {
  if (system.scalarFunctions["video_embed_url"]) return;
  system.scalarFunction({
    name: "video_embed_url",
    parameters: [{ name: "url", type: "String" }],
    returnType: "String",
    procedure: (s) => {
      s.defScalar("video_url", sql`trim(input.url)`);
      s.if(
        sql`video_url is null or length(video_url) > 2000
          or regex.is_match(video_url, '[\\x00-\\x20\\x7f-\\x9f\\\\]')`,
        (s) => s.return(sql.null),
      );
      s.setScalar("video_url", sql`split_part(video_url, '#', 1)`);
      s.defScalar("video_id", sql`cast(null as string)`);
      s.if(
        sql`regex.is_match(video_url, '(?i)^https://(www\\.|m\\.)?youtube\\.com/watch[?]')`,
        (s) =>
          s.setScalar(
            "video_id",
            sql`regex.capture(video_url, '[?&]v=([a-zA-Z0-9_-]{11})(?:[&#]|$)', 1)`,
          ),
      );
      s.setScalar(
        "video_id",
        sql`coalesce(video_id,
          regex.capture(video_url, '(?i)^https://(?:www\\.|m\\.)?youtube\\.com/(?:embed|shorts)/([a-zA-Z0-9_-]{11})(?:[?#].*)?$', 1),
          regex.capture(video_url, '(?i)^https://youtu\\.be/([a-zA-Z0-9_-]{11})(?:[?#].*)?$', 1),
          regex.capture(video_url, '(?i)^https://www\\.youtube-nocookie\\.com/embed/([a-zA-Z0-9_-]{11})(?:[?#].*)?$', 1))`,
      );
      s.if(
        sql`video_id is not null`,
        (s) =>
          s.return(sql`'https://www.youtube-nocookie.com/embed/' || video_id`),
      );
      s.setScalar(
        "video_id",
        sql`regex.capture(video_url,
          '(?i)^https://(?:(?:www\\.)?vimeo\\.com/|player\\.vimeo\\.com/video/)([0-9]{1,20})(?:/[a-zA-Z0-9]+)?(?:[?#].*)?$', 1)`,
      );
      s.if(sql`video_id is null`, (s) => s.return(sql.null));
      s.defScalar(
        "video_hash",
        sql`coalesce(
          regex.capture(video_url, '(?i)^https://[^/]+/(?:video/)?[0-9]+/([a-zA-Z0-9]+)(?:[?#]|$)', 1),
          regex.capture(video_url, '[?&]h=([a-zA-Z0-9]+)(?:[&#]|$)', 1))`,
      );
      s.if(
        sql`regex.is_match(video_url, '[?&]h=') and video_hash is null`,
        (s) => s.return(sql.null),
      );
      s.return(sql`'https://player.vimeo.com/video/' || video_id ||
        case when video_hash is null then '' else '?h=' || video_hash end`);
    },
  });
}

/** Loads a provider's player on demand, without autoplay or arbitrary HTML. */
export function EmbeddedVideo(props: {
  url: Sql;
  title: Sql;
  labels?: { play: Sql | string; unavailable: Sql | string };
}) {
  ensureVideoEmbedFunction();
  const labels = props.labels ?? {
    play: "Play video",
    unavailable:
      "If this video is unavailable, contact your training manager. The video owner must allow embedded playback.",
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => s.defScalar("embedded_video_loaded", sql.false)}
    >
      <div className="space-y-2">
        <div className="relative mx-auto aspect-video min-h-[200px] w-full max-w-4xl overflow-hidden rounded-md bg-black">
          <Show
            when={sql`embedded_video_loaded and fn.video_embed_url(${props.url}) is not null`}
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <Button
                  startIcon="PlayArrow"
                  disabled={sql`fn.video_embed_url(${props.url}) is null`}
                  onClick={(s) =>
                    s.setScalar("embedded_video_loaded", sql.true)}
                >
                  {labels.play}
                </Button>
              </div>
            }
          >
            <iframe
              title={props.title}
              src={sql`fn.video_embed_url(${props.url})`}
              className="absolute inset-0 h-full w-full border-0"
              allowFullScreen
            />
          </Show>
        </div>
        <Typography level="body-sm" className="text-secondary">
          {labels.unavailable}
        </Typography>
      </div>
      <Effect
        watch={[props.url]}
        onChange={(s) => s.setScalar("embedded_video_loaded", sql.false)}
      />
    </Data>
  );
}
