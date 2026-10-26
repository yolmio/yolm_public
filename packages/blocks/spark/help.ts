import { sql } from "std/sql_utils";
import type { SparkTool } from "./agent";

/** Product documentation is system-wide knowledge, independent of capabilities. */
export const sparkHelpTools: SparkTool[] = [
  { name: "searchHelp", operation: "search" },
  { name: "readHelpDocument", operation: "read" },
].map(({ name, operation }) => ({
  name,
  statements: (s) => {
    s.serviceRequest({
      serviceType: sql.lit`help`,
      operation: sql.lit(operation),
      requestJson: sql`coalesce(tool_input->0, '{}'::json)`,
      defResultJsonScalar: "help_result",
      defErrorJsonScalar: "help_error",
    });
    s.if(
      sql`help_error is not null`,
      (s) => s.throwError(sql`help_error::string`),
    );
    s.return(sql`help_result`);
  },
}));

/**
 * Shows a help video or image from a help document as a card under the
 * current exec step. The media is re-read from the document so the card can
 * only show media that help actually contains, with its current chapters.
 */
export const sparkShowHelpMediaTool: SparkTool = {
  name: "showHelpMedia",
  statements: (s) => {
    s.defScalar(
      "show_help_input",
      sql`coalesce((tool_input->0)::json, '{}'::json)`,
    );
    s.defScalar(
      "show_help_document_id",
      sql`try_cast(show_help_input->>'documentId' as bigint)`,
    );
    s.defScalar(
      "show_help_media_id",
      sql`try_cast(show_help_input->>'mediaId' as bigint)`,
    );
    s.defScalar(
      "show_help_start_ms",
      sql`try_cast(show_help_input->>'startMs' as bigint)`,
    );
    s.if(
      sql`show_help_document_id is null or show_help_media_id is null`,
      (s) =>
        s.throwError(
          sql
            .lit`showHelpMedia needs documentId and mediaId from readHelpDocument`,
        ),
    );
    s.if(
      sql`show_help_start_ms < 0`,
      (s) => s.throwError(sql.lit`showHelpMedia startMs must be 0 or more`),
    );
    s.serviceRequest({
      serviceType: sql.lit`help`,
      operation: sql.lit`read`,
      requestJson: sql`json_build_object('documentId', show_help_document_id)`,
      defResultJsonScalar: "show_help_document",
      defErrorJsonScalar: "show_help_error",
    });
    s.if(
      sql`show_help_error is not null`,
      (s) => s.throwError(sql`show_help_error::string`),
    );
    s.defRecord(
      "show_help_media",
      sql`select
          try_cast(section.value->>'sectionId' as bigint) as section_id,
          section.value->>'title' as section_title,
          media.value as media
        from json.array_each(show_help_document->'sections') section,
          json.array_each(section.value->'media') media
        where try_cast(media.value->>'mediaId' as bigint) = show_help_media_id
        limit 1`,
    );
    s.if(
      sql`show_help_media.media is null`,
      (s) =>
        s.throwError(
          sql`'Help document ' || show_help_document_id::string ||
            ' has no media ' || show_help_media_id::string`,
        ),
    );
    s.if(
      sql`show_help_media.media->>'kind' not in ('video', 'image')`,
      (s) =>
        s.throwError(
          sql.lit`showHelpMedia can only show help videos and images`,
        ),
    );
    s.defScalar(
      "show_help_title",
      sql`coalesce(
        nullif(show_help_media.media->>'description', ''),
        show_help_media.section_title
      )`,
    );
    // Recorded on this exec step's payload, like file reads and emitted
    // images; the timeline renders one card per entry. Read-only MCP calls
    // have no exec step, so they only get the link.
    s.defScalar(
      "show_help_recorded",
      sql`exists(select 1 from db.spark_agent_events
        where id = spark_js_execution_event_id
          and spark_agent_id = spark_js_agent_id)`,
    );
    s.if(sql`show_help_recorded`, (s) => {
      s.startTransaction();
      s.modify(sql`
        update db.spark_agent_events
        set payload = coalesce(payload, '{}'::json) || json_build_object(
          'help_media',
          coalesce(payload->'help_media', '[]'::json) || json_build_array(
            json_build_object(
              'documentId', show_help_document_id,
              'documentTitle', show_help_document->>'title',
              'sectionId', show_help_media.section_id,
              'sectionTitle', show_help_media.section_title,
              'mediaId', show_help_media_id,
              'url', show_help_media.media->>'url',
              'kind', show_help_media.media->>'kind',
              'title', show_help_title,
              'chapters', coalesce(show_help_media.media->'chapters', '[]'::json),
              'startMs', case when show_help_media.media->>'kind' = 'video'
                then show_help_start_ms end
            )
          )
        )
        where id = spark_js_execution_event_id
          and spark_agent_id = spark_js_agent_id
      `);
      s.commitTransaction();
    });
    // MCP clients can't play the card, so they also get an absolute link that
    // opens the video at the chapter in the browser.
    s.return(sql`json_build_object(
      'recorded', show_help_recorded,
      'title', show_help_title,
      'kind', show_help_media.media->>'kind',
      'startMs', show_help_start_ms,
      'link', (http.request_info()->>'origin') || (show_help_media.media->>'url') ||
        case when show_help_start_ms > 0 and show_help_media.media->>'kind' = 'video'
          then '#t=' || (show_help_start_ms / 1000.0)::string else '' end
    )`);
  },
};
