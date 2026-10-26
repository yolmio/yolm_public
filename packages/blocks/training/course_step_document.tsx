import { Button } from "components/button";
import { EmbeddedVideo } from "components/embedded_video";
import { videoLinkContentType } from "blocks/drive/external_link";
import type { TrainingDriveExtension } from "./drive_documents";
import { Typography } from "components/typography";
import { isPlayableVideoMime, VideoPlayer } from "components/video_player";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Show } from "std/ui";
import { employeeText } from "./helpers";

/** The same supporting-document presentation for learners and course previews. */
export function CourseStepDocument(props: {
  document: Sql;
  content: TrainingDriveExtension;
  controlledRevisionId: Sql;
  nativePdfHref?: Sql;
  language: Sql;
  fileHref: Sql;
  externalHref: Sql;
  imageSrcPrefixRewrite?: { prefix: Sql; replacement: Sql };
}) {
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-divider bg-neutral-50 px-3 py-2">
        <Typography
          level="title-sm"
          className="min-w-0"
        >
          {sql`${props.document}.title`}
        </Typography>
        <div className="flex gap-2">
          <Show
            when={sql`${props.document}.external_url is not null
              and ${props.document}.content_type is distinct from ${
              sql.lit(videoLinkContentType)
            }`}
          >
            <Button
              component="a"
              href={props.externalHref}
              target="_blank"
              variant="outlined"
              color="neutral"
              size="sm"
              startIcon="OpenInNew"
            >
              {employeeText(
                props.language,
                { en: "Open", es: "Abrir" },
              )}
            </Button>
          </Show>
          <Show
            when={sql`${props.document}.blob_hash is not null
              and lower(${props.document}.content_type) not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
              and not ${
              isPlayableVideoMime(sql`${props.document}.content_type`)
            }`}
          >
            <Button
              component="a"
              href={props.fileHref}
              target="_blank"
              variant="outlined"
              color="neutral"
              size="sm"
              startIcon="OpenInNew"
            >
              {employeeText(
                props.language,
                { en: "Open", es: "Abrir" },
              )}
            </Button>
          </Show>
        </div>
      </div>
      <Show
        when={sql`${props.document}.content_type = ${
          sql.lit(videoLinkContentType)
        }
        and ${props.document}.external_url is not null`}
      >
        <EmbeddedVideo
          url={sql`${props.document}.external_url`}
          title={sql`${props.document}.title`}
          labels={{
            play: employeeText(props.language, {
              en: "Play video",
              es: "Reproducir video",
            }),
            unavailable: employeeText(props.language, {
              en:
                "If this video is unavailable, contact your training manager. The video owner must allow embedded playback.",
              es:
                "Si el video no está disponible, contacta a tu responsable de capacitación. El propietario debe permitir la reproducción integrada.",
            }),
          }}
        />
      </Show>
      <Show
        when={sql`lower(${props.document}.content_type) in ('image/png', 'image/jpeg', 'image/gif', 'image/webp') and ${props.document}.blob_hash is not null`}
      >
        <img
          src={props.fileHref}
          alt={sql`${props.document}.title`}
          className="h-auto max-w-full rounded-md"
          loading="lazy"
        />
      </Show>
      <Show
        when={sql`${
          isPlayableVideoMime(sql`${props.document}.content_type`)
        } and ${props.document}.blob_hash is not null`}
      >
        <VideoPlayer
          handle={sql`'training-video-' || bytes.to_hex(${props.document}.blob_hash)`}
          src={props.fileHref}
          title={sql`${props.document}.title`}
          className="rounded-md"
          labels={{
            unplayable: employeeText(props.language, {
              en: "This video can't be played in this browser.",
              es: "Este video no se puede reproducir en este navegador.",
            }),
            download: employeeText(props.language, {
              en: "Download video",
              es: "Descargar video",
            }),
          }}
        />
      </Show>
      <Show
        when={sql`${props.document}.rich_content is not null`}
      >
        {props.content.renderNativeDocument({
          versionId: props.controlledRevisionId,
          value: sql`${props.document}.rich_content`,
          imageSrcPrefixRewrite: props.imageSrcPrefixRewrite,
          pdfHref: props.nativePdfHref,
        })}
      </Show>
    </>
  );
}
