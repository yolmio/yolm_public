import { AuthApiICtxKey } from "std/ictx";
import { kebabCase } from "std/inflectors";
import { sql, updateAssignment } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type {
  ImageResize,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import type { Table, TableBuilder } from "std/system";
import { useApi, useOptionalICtx } from "std/ui";

/**
 * Semantic role of an image variant in an {@link ImageSetFieldGroup}.
 * Components ask for the variant by usage rather than by name, which
 * lets the same image set serve different consumers (e.g. a header
 * thumbnail vs a full-page view).
 */
export type ImageUsage =
  | "dialog_full"
  | "general_full"
  | "square_thumbnail"
  | "general_thumbnail";

/** One variant inside an {@link ImageSetFieldGroup}. */
export interface ImageSetVariant {
  /** Optional resize applied at upload time. */
  resize?: ImageResize;
  /** Semantic usage tag used by display components. */
  usage?: ImageUsage;
}

/**
 * Field-group descriptor produced by {@link imageSetFieldGroup} /
 * {@link simpleImageSetFieldGroup}. Stored on the table builder so the
 * runtime knows how to expose image variants and serve their bytes.
 */
export class ImageSetFieldGroup {
  constructor(
    /** Field-group name (also the prefix of variant fields). */
    public name: string,
    /** Field name holding the source MIME type. */
    public contentType: string,
    /** Variants keyed by field name. */
    public variants: Record<string, ImageSetVariant>,
  ) {}
}

/** Options for {@link imageSetFieldGroup}. */
export interface ImageSetOpts {
  /** Field-group name. Defaults to `"image"`. */
  groupName?: string;
  /** Field name holding the source MIME type. Defaults to `"content_type"`. */
  contentTypeField?: string;
  /** Variants to add (one bytes field per entry). */
  variants: Record<string, ImageSetVariant>;
}

/**
 * Add an image-set field group to a table — one bytes field per variant
 * plus a content-type field. Use {@link simpleImageSetFieldGroup} for the
 * standard "full + thumb" pair.
 */
export function imageSetFieldGroup(table: TableBuilder, opts: ImageSetOpts) {
  const groupName = opts.groupName ?? "image";
  const contentTypeField = opts.contentTypeField ?? "content_type";
  table.fieldGroup(
    groupName,
    new ImageSetFieldGroup(groupName, contentTypeField, opts.variants),
  );
  for (const fieldName of Object.keys(opts.variants)) {
    table.blobRef(fieldName).group(groupName);
  }
}

/**
Adds a field group of two fields that integrates with the datagrid and record grid page header.

Creates a field group with the following fields:
- image_full: bytes(32) - hash of the full-size image blob
- image_thumb: bytes(32) - hash of the thumbnail image blob
- content_type: string - MIME type of the image

@category Field Group
 */
export function simpleImageSetFieldGroup(
  table: TableBuilder,
  groupName = "image",
  contentTypeField = "content_type",
) {
  table.fieldGroup(
    groupName,
    new ImageSetFieldGroup(groupName, contentTypeField, {
      image_full: { usage: "general_full" },
      image_thumb: {
        resize: { height: 180, width: 180, type: sql.lit`cover` },
        usage: "square_thumbnail",
      },
    }),
  );
  table.string(contentTypeField, 255).group(groupName);
  table.blobRef("image_full").group(groupName);
  table.blobRef("image_thumb").group(groupName);
}

/**
 * Register `GET /<table>/{record_id}/image_variant/<variant>/{blob_hash}`
 * endpoints on the current app for every variant in `fieldGroup`. Pair
 * with {@link imageVariantUrl} on the client side to build the matching
 * URLs. Idempotent — calling twice with the same variants is a no-op.
 */
export function createImageSetEndpointsForCurrentApp(
  tableName: string,
  fieldGroup: ImageSetFieldGroup,
) {
  const api = useApi();
  const authCtx = useOptionalICtx(AuthApiICtxKey);
  const table = system.db.tables[tableName];
  const contentTypeField = fieldGroup.contentType;
  for (const variantName of Object.keys(fieldGroup.variants)) {
    const path = `/${table.getBaseUrl()}/{record_id:id}/image_variant/${
      kebabCase(variantName)
    }/{blob_hash}`;
    if (api.hasEndpoint("GET", path)) {
      continue;
    }
    api.get(path, {
      procedure: (s) => {
        if (authCtx) {
          authCtx.authenticate(s);
        }
        s.defScalar("requested_blob_hash", sql`bytes.from_hex(blob_hash)`);
        s.defRecord(
          "blob",
          sql`select ${sql.ref(variantName)} as blob_hash, ${
            sql.ref(contentTypeField)
          } as content_type from db.${table.ident} where ${
            sql.ref(variantName)
          } = requested_blob_hash and ${table.primaryKeyIdent} = record_id`,
        );
        s.if(sql`blob.blob_hash is null`, (s) => {
          s.setHttpStatus(404);
          s.return();
        });
        s.setHeader(sql.lit`Content-Type`, sql`blob.content_type`);
        s.setHeader(
          sql.lit`Cache-Control`,
          sql.lit`max-age=31536000, immutable`,
        );
        s.returnBlob(sql`blob.blob_hash`);
      },
    });
  }
}

/**
 * Build the SQL expression for an image-variant URL on the current app.
 * Matches the route registered by
 * {@link createImageSetEndpointsForCurrentApp}.
 */
export function imageVariantUrl(
  table: Table,
  variantName: string,
  recordId: NumericExpr,
  blobId: Sql,
) {
  return sql.concat(
    "/api/",
    table.getBaseUrl(),
    "/",
    recordId,
    "/image_variant/",
    kebabCase(variantName),
    "/",
    sql`bytes.to_hex(${blobId})`,
  );
}

/**
 * Find the variant field name in `group` that matches `variant`. If none
 * matches, fall back through `fallbackVariants` in order. Returns the
 * matching field name, or `undefined` if no match is found.
 */
export function getVariantFromImageSet(
  group: ImageSetFieldGroup,
  variant: ImageUsage,
  fallbackVariants: ImageUsage[] = [],
) {
  const variants = Object.entries(group.variants);
  let fallbackIndex: number | undefined;
  let foundVariantName: string | undefined;
  for (const [name, v] of variants) {
    if (v.usage === variant) {
      return name;
    }
    if (!v.usage) {
      continue;
    }
    const newFallbackIndex = fallbackVariants.indexOf(v.usage);
    if (newFallbackIndex === -1) {
      continue;
    }
    if (newFallbackIndex === 0) {
      return name;
    }
    if (fallbackIndex === undefined || newFallbackIndex < fallbackIndex) {
      fallbackIndex = newFallbackIndex;
      foundVariantName = name;
    }
  }
  return foundVariantName;
}

/**
 * Returns `{ upload, updateDb }` helpers for handling an image-set
 * upload form. `upload` (UI server) reads the uploaded file and creates
 * one blob per variant; `updateDb` writes the resulting hashes back to
 * the row. Wire both into a `Form` for upload + persist.
 */
export function uploadImageSet(
  tableName: string,
  recordId: NumericExpr,
  group: ImageSetFieldGroup,
) {
  const variants = Object.entries(group.variants);
  return {
    upload: (s: UiServerStatements) => {
      s.readDomFile(sql`(select uuid from file)`, "file_content");
      for (let i = 0; i < variants.length; i++) {
        const [, _v] = variants[i];
        s.defScalar(`hash_${i}`, {
          type: { type: "Bytes", maxLength: 1000 },
        });
        // if (v.resize) {
        //   s.resizeImage({
        //     inBytes: sql`file_content`,
        //     outBytesScalar: "resized",
        //     imageType: sql`image_type`,
        //     resizeType: v.resize.type,
        //     width: v.resize.width,
        //     height: v.resize.height,
        //   });
        //   s.createBlob(sql`resized`, { setHashScalar: `hash_${i}` });
        // } else {
        s.createBlob(sql`file_content`, { setHashScalar: `hash_${i}` });
        // }
      }
    },
    updateDb: <T extends IServerBaseStatements>(s: T) => {
      const setFields = Object.keys(group.variants).map((fieldName, i) =>
        updateAssignment(fieldName, sql`hash_${sql(i)}`)
      );
      s.modify(
        sql`update db.${
          sql.ref(tableName)
        } set ${setFields} where id = ${recordId}`,
      );
    },
  };
}
