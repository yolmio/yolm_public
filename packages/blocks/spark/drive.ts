import type { DriveBlockContract, DriveSpaceType } from "blocks/drive";
import type { PdfMarkupExtension } from "blocks/drive/pdf_markup";
import { sql } from "std/sql_utils";
import type { SparkFileSource } from "./index.tsx";

export interface SparkDriveFileSourceOpts {
  /** Agent-facing source name passed to readFileImage(). */
  name: string;
  files: DriveBlockContract;
  /** Exact Drive space types this capability may expose. */
  spaceTypes: readonly DriveSpaceType[];
  /** Adds default annotated rendering and structured readFileMarkup data. */
  pdfMarkup?: PdfMarkupExtension;
}

/**
 * Build a Drive-backed Spark file source with Drive read authorization. The
 * optional PDF markup extension owns context resolution and page composition.
 */
export function sparkDriveFileSource(
  opts: SparkDriveFileSourceOpts,
): SparkFileSource {
  if (opts.spaceTypes.length === 0) {
    throw new Error("sparkDriveFileSource requires at least one space type.");
  }
  for (const spaceType of opts.spaceTypes) {
    if (!opts.files.spaceTypes.includes(spaceType)) {
      throw new Error(
        `Spark Drive source "${opts.name}" received an unattached space type ` +
          `"${spaceType.name}".`,
      );
    }
    if (opts.pdfMarkup && !spaceType.extensions.includes(opts.pdfMarkup)) {
      throw new Error(
        `Spark Drive source "${opts.name}" enables PDF markup, but space ` +
          `type "${spaceType.name}" does not use that extension.`,
      );
    }
  }
  const spaceTypeFilter = opts.spaceTypes.slice(1).reduce(
    (condition, spaceType) =>
      sql`${condition} or cast(space.space_type as string) = ${
        sql.lit(spaceType.name)
      }`,
    sql`cast(space.space_type as string) = ${sql.lit(opts.spaceTypes[0].name)}`,
  );
  const pdfMarkup = opts.pdfMarkup;
  return {
    name: opts.name,
    table: opts.files.versionTable,
    lookup: (id, context) =>
      sql`
        select
          blob.blob_hash as bh,
          version.content_type as mime,
          version.file_name as label
        from db.${sql.ref(opts.files.versionTable)} version
        join db.${sql.ref(opts.files.itemTable)} item
          on item.id = version.file_item_id
        join db.${sql.ref(opts.files.spaceTable)} space
          on space.id = item.file_space_id
        join db.${sql.ref(opts.files.versionBlobTable)} blob
          on blob.file_version_id = version.id
        where version.id = ${id}
          and item.trashed_at is null
          and (${spaceTypeFilter})
          and ${
        opts.files.canReadVersionSql({
          spaceRecord: sql`space`,
          itemRecord: sql`item`,
          versionRecord: sql`version`,
          sysUserId: context.sysUserId,
        })
      }
      `,
    renderPdfPage: pdfMarkup
      ? (s, render) =>
        pdfMarkup.renderPage(s, {
          fileVersionId: render.fileId,
          pdf: render.pdf,
          page: render.page,
          pageWidth: render.pageWidth,
          pageHeight: render.pageHeight,
          renderWidth: render.renderWidth,
          defOutputScalar: render.defOutputScalar,
        })
      : undefined,
    readPdfMarkup: pdfMarkup
      ? (s, read) => {
        s.defScalar(
          read.defOutputScalar,
          pdfMarkup.readMarkupJson({
            fileVersionId: read.fileId,
            page: read.page,
          }),
        );
      }
      : undefined,
  };
}
