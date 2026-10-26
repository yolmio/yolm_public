import type {
  DriveBlock,
  DriveBlockContract,
  DriveSpaceType,
} from "blocks/drive";
import type { NativeDocumentExtension } from "blocks/drive/native_document";
import type { PdfMarkupExtension } from "blocks/drive/pdf_markup";
import { type Sql, sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";
import type {
  SparkAction,
  SparkCapability,
  SparkFileSource,
  SparkFunction,
} from "./index.tsx";
import { rethrowSparkActionError } from "./action_errors.ts";
import type { SparkPermissionRequirement } from "./permissions.ts";

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

export interface SparkDriveCapabilityOpts {
  /** Capability id; tools are called as `tools.<name>.<tool>`. */
  name: string;
  label?: string;
  description?: string;
  files: DriveBlock;
  /** Exact Drive space types these tools may reach. */
  spaceTypes: readonly DriveSpaceType[];
  /** Adds Markdown save/read tools for native rich-text documents. */
  nativeDocuments?: NativeDocumentExtension;
  /** Adds a readFileImage/query file source over the same space types. */
  fileSource?: { name: string; pdfMarkup?: PdfMarkupExtension };
  permission?: string;
  permissions?: SparkPermissionRequirement;
  /** System-specific guidance appended to the generic tool reference. */
  doc?: string;
}

let driveProceduresRegistered = false;
let registeredDocumentExtension: NativeDocumentExtension | undefined;

const driveProcedureScalars = [
  { name: "p_space_types", type: "Json" },
  { name: "p_input", type: "Json" },
] as const;
const driveProcedureResult = [
  { name: "spark_drive_result", type: "Json" },
] as const;

// Every capability instance shares these procedures and passes its allowed
// space types plus the tool's JSON input, so another Drive surface adds only
// thin tool wrappers. Drive's own procedures perform every mutation.
function registerSparkDriveProcedures(
  files: DriveBlock,
  nativeDocuments?: NativeDocumentExtension,
) {
  const allowedSpace = (spaceId: Sql) =>
    sql`exists (
      select 1 from db.${sql.ref(files.spaceTable)} allowed_space
      where allowed_space.id = ${spaceId}
        and p_space_types @> json_build_array(
          cast(allowed_space.space_type as string)
        )
    )`;
  const inputId = (key: string) =>
    sql`try_cast(p_input->>${sql.lit(key)} as bigint)`;
  const inputText = (key: string) =>
    sql`nullif(trim(p_input->>${sql.lit(key)}), '')`;
  const procedure = (
    name: string,
    body: (s: GeneralServerStatements) => void,
  ) =>
    system.storedProcedure({
      name,
      inputScalars: [...driveProcedureScalars],
      outputScalars: [...driveProcedureResult],
      procedure: body,
    });
  if (!driveProceduresRegistered) {
    driveProceduresRegistered = true;
    procedure("spark_drive_spaces", (s) => {
      s.defScalar(
        "drive_limit",
        sql`least(coalesce(try_cast(p_input->>'limit' as int), 200), 2000)`,
      );
      s.defTable(
        "drive_space_rows",
        sql`
          select space.id, cast(space.space_type as string) as type,
            space.name, space.description
          from db.${sql.ref(files.spaceTable)} space
          where p_space_types @> json_build_array(
              cast(space.space_type as string)
            )
            and (${inputText("type")} is null
              or cast(space.space_type as string) = ${inputText("type")})
            and (${inputText("query")} is null
              or lower(space.name) like
                '%' || lower(${inputText("query")}) || '%')
            and fn.drive_space_access(space.id, current_user, 'read')
          order by space.name, space.id
          limit drive_limit + 1
        `,
      );
      s.setScalar(
        "spark_drive_result",
        sql`json_build_object(
          'spaces', coalesce((
            select json_array_agg(json_build_object(
              'space_id', row.id,
              'type', row.type,
              'name', row.name,
              'description', row.description,
              'can_write', fn.drive_space_access(row.id, current_user, 'write')
            ) order by row.name, row.id)
            from (
              select * from drive_space_rows
              order by name, id
              limit drive_limit
            ) row
          ), '[]'::json),
          'truncated', (select count(*) from drive_space_rows) > drive_limit
        )`,
      );
    });
    procedure("spark_drive_items", (s) => {
      s.defScalar("drive_space_id", inputId("space_id"));
      s.defScalar("drive_folder_id", inputId("folder_id"));
      s.defScalar("drive_query", inputText("query"));
      s.defScalar(
        "drive_trashed",
        sql`coalesce(try_cast(p_input->>'trashed' as bool), false)`,
      );
      s.defScalar(
        "drive_recursive",
        sql`coalesce(try_cast(p_input->>'recursive' as bool), false)
          or drive_query is not null or drive_trashed`,
      );
      s.defScalar(
        "drive_limit",
        sql`least(coalesce(try_cast(p_input->>'limit' as int), 500), 5000)`,
      );
      s.throwErrorIf(
        sql`not ${allowedSpace(sql`drive_space_id`)}
          or not fn.drive_space_access(drive_space_id, current_user, 'read')`,
        sql.lit`The file space is unavailable.`,
      );
      s.defTable(
        "drive_tree",
        sql`
          with recursive tree as (
            select item.id, item.parent_file_item_id as parent_id,
              item.item_kind, item.name, item.description,
              item.current_file_version_id, item.trashed_at,
              item.name as path, 1 as depth
            from db.${sql.ref(files.itemTable)} item
            where item.file_space_id = drive_space_id
              and item.parent_file_item_id is null
              and (drive_trashed or item.trashed_at is null)

            union all

            select child.id, child.parent_file_item_id,
              child.item_kind, child.name, child.description,
              child.current_file_version_id, child.trashed_at,
              tree.path || '/' || child.name, tree.depth + 1
            from tree
            join db.${sql.ref(files.itemTable)} child
              on child.parent_file_item_id = tree.id
            where child.file_space_id = drive_space_id
              and (drive_trashed or child.trashed_at is null)
              and tree.depth < 64
          )
          select * from tree
        `,
      );
      s.defScalar(
        "drive_folder_path",
        sql`(select path from drive_tree
          where id = drive_folder_id and item_kind = 'folder')`,
      );
      s.throwErrorIf(
        sql`drive_folder_id is not null and drive_folder_path is null`,
        sql.lit`The folder is unavailable.`,
      );
      // Trash lists only the top item of each trashed subtree, since
      // restoring it restores everything trashed with it.
      s.defTable(
        "drive_rows",
        sql`
          select tree.*, version.version_number, version.file_name,
            version.content_type, version.byte_length,
            version.created_at as updated_at
          from drive_tree tree
          left join db.${sql.ref(files.versionTable)} version
            on version.id = tree.current_file_version_id
          where (drive_folder_id is null
              or left(tree.path, length(drive_folder_path) + 1) =
                drive_folder_path || '/')
            and (drive_recursive
              or tree.parent_id = drive_folder_id
              or (tree.parent_id is null and drive_folder_id is null))
            and (drive_query is null
              or lower(tree.name) like '%' || lower(drive_query) || '%')
            and case when drive_trashed
              then tree.trashed_at is not null and not exists (
                select 1 from drive_tree parent
                where parent.id = tree.parent_id
                  and parent.trashed_at = tree.trashed_at
              )
              else tree.trashed_at is null end
            and (tree.item_kind = 'folder' or fn.drive_can_read_version(
              tree.id, tree.current_file_version_id, current_user
            ))
          order by tree.path, tree.id
          limit drive_limit + 1
        `,
      );
      s.setScalar(
        "spark_drive_result",
        sql`json_build_object(
          'space_id', drive_space_id,
          'folder_path', drive_folder_path,
          'items', coalesce((
            select json_array_agg(json_build_object(
              'item_id', row.id,
              'parent_id', row.parent_id,
              'kind', row.item_kind,
              'name', row.name,
              'path', row.path,
              'description', row.description,
              'version_id', row.current_file_version_id,
              'version_number', row.version_number,
              'file_name', row.file_name,
              'content_type', row.content_type,
              'byte_length', row.byte_length,
              'updated_at', row.updated_at,
              'trashed_at', row.trashed_at
            ) order by row.path, row.id)
            from (
              select * from drive_rows order by path, id limit drive_limit
            ) row
          ), '[]'::json),
          'truncated', (select count(*) from drive_rows) > drive_limit
        )`,
      );
    });
    procedure("spark_drive_item", (s) => {
      s.defRecord(
        "drive_item",
        sql`
          select item.id, item.file_space_id, item.parent_file_item_id,
            item.item_kind, item.name, item.description,
            item.current_file_version_id, item.trashed_at
          from db.${sql.ref(files.itemTable)} item
          where item.id = ${inputId("item_id")}
            and ${allowedSpace(sql`item.file_space_id`)}
            and fn.drive_space_access(item.file_space_id, current_user, 'read')
        `,
      );
      s.throwErrorIf(
        sql`drive_item.id is null`,
        sql.lit`The file or folder is unavailable.`,
      );
      s.setScalar(
        "spark_drive_result",
        sql`json_build_object(
          'item_id', drive_item.id,
          'space_id', drive_item.file_space_id,
          'parent_id', drive_item.parent_file_item_id,
          'kind', drive_item.item_kind,
          'name', drive_item.name,
          'path', (
            with recursive ancestors as (
              select item.id, item.parent_file_item_id, item.name as path
              from db.${sql.ref(files.itemTable)} item
              where item.id = drive_item.id
              union all
              select parent.id, parent.parent_file_item_id,
                parent.name || '/' || ancestors.path
              from ancestors
              join db.${sql.ref(files.itemTable)} parent
                on parent.id = ancestors.parent_file_item_id
            )
            select path from ancestors where parent_file_item_id is null
          ),
          'description', drive_item.description,
          'version_id', drive_item.current_file_version_id,
          'trashed_at', drive_item.trashed_at,
          'versions', coalesce((
            select json_array_agg(json_build_object(
              'version_id', version.id,
              'version_number', version.version_number,
              'file_name', version.file_name,
              'content_type', version.content_type,
              'byte_length', version.byte_length,
              'note', version.note,
              'created_at', version.created_at
            ) order by version.version_number desc)
            from db.${sql.ref(files.versionTable)} version
            where version.file_item_id = drive_item.id
              and fn.drive_can_read_version(
                version.file_item_id, version.id, current_user
              )
          ), '[]'::json)
        )`,
      );
    });
    procedure("spark_drive_create_folder", (s) => {
      s.defScalar("drive_space_id", inputId("space_id"));
      s.defScalar("drive_path", inputText("path"));
      s.throwErrorIf(
        sql`not ${allowedSpace(sql`drive_space_id`)}
          or not fn.drive_space_access(drive_space_id, current_user, 'write')`,
        sql.lit`You cannot change files in this space.`,
      );
      s.throwErrorIf(
        sql`drive_path is null or exists (
          select 1 from string.split(drive_path, '/') where trim(value) = ''
        )`,
        sql
          .lit`Use a folder path such as "Safety/Forms" without empty segments.`,
      );
      s.defScalar("drive_folder_id", inputId("parent_id"));
      s.defScalar("drive_created", sql`'[]'::json`);
      s.defTable(
        "drive_segments",
        sql`select trim(value) as name, ordinal
          from string.split(drive_path, '/') order by ordinal`,
      );
      s.forEachTable("drive_segments", "segment", (s) => {
        s.defScalar(
          "drive_existing_folder_id",
          sql`(
            select folder.id
            from db.${sql.ref(files.itemTable)} folder
            where folder.file_space_id = drive_space_id
              and folder.item_kind = 'folder'
              and folder.trashed_at is null
              and (folder.parent_file_item_id = drive_folder_id
                or (folder.parent_file_item_id is null
                  and drive_folder_id is null))
              and folder.name = segment.name collate nocase
            order by folder.id
            limit 1
          )`,
        );
        s.if(sql`drive_existing_folder_id is not null`, (s) => {
          s.setScalar("drive_folder_id", sql`drive_existing_folder_id`);
        }, (s) => {
          files.createFolder(s, {
            spaceId: sql`drive_space_id`,
            parentItemId: sql`drive_folder_id`,
            name: sql`segment.name`,
            into: "drive_new_folder_id",
          });
          s.setScalar("drive_folder_id", sql`drive_new_folder_id`);
          s.setScalar(
            "drive_created",
            sql`drive_created || json_build_array(drive_new_folder_id)`,
          );
        });
      });
      s.setScalar(
        "spark_drive_result",
        sql`json_build_object(
          'item_id', drive_folder_id,
          'created_item_ids', drive_created
        )`,
      );
    });
    procedure("spark_drive_update_item", (s) => {
      s.defRecord(
        "drive_before",
        sql`
          select item.id, item.file_space_id, item.parent_file_item_id,
            item.name, item.description, item.trashed_at
          from db.${sql.ref(files.itemTable)} item
          where item.id = ${inputId("item_id")}
            and ${allowedSpace(sql`item.file_space_id`)}
        `,
      );
      s.throwErrorIf(
        sql`drive_before.id is null`,
        sql.lit`The file or folder is unavailable.`,
      );
      s.defScalar(
        "drive_trashed",
        sql`try_cast(p_input->>'trashed' as bool)`,
      );
      s.throwErrorIf(
        sql`not (p_input ? 'name' or p_input ? 'description'
          or p_input ? 'folder_id' or drive_trashed is not null)`,
        sql.lit`Pass name, description, folder_id, or trashed.`,
      );
      const item = {
        p_space_id: sql`drive_before.file_space_id`,
        p_item_id: sql`drive_before.id`,
      };
      s.if(sql`drive_trashed = false and drive_before.trashed_at is not null`, (
        s,
      ) => s.callStoredProcedure("files_restore_item", { inputScalars: item }));
      s.if(sql`p_input ? 'name' or p_input ? 'description'`, (s) => {
        s.callStoredProcedure("files_update_item_metadata", {
          inputScalars: {
            ...item,
            p_name: sql`coalesce(p_input->>'name', drive_before.name)`,
            p_description: sql`case when p_input ? 'description'
              then p_input->>'description' else drive_before.description end`,
          },
        });
      });
      s.if(sql`p_input ? 'folder_id'`, (s) => {
        s.callStoredProcedure("files_move_item", {
          inputScalars: {
            ...item,
            p_destination_parent_id: inputId("folder_id"),
          },
        });
      });
      s.if(sql`drive_trashed and drive_before.trashed_at is null`, (s) => {
        s.callStoredProcedure("files_trash_item", { inputScalars: item });
      });
      s.setScalar(
        "spark_drive_result",
        sql`(
          select json_build_object(
            'item_id', item.id,
            'name', item.name,
            'previous_name', drive_before.name,
            'parent_id', item.parent_file_item_id,
            'previous_parent_id', drive_before.parent_file_item_id,
            'trashed', item.trashed_at is not null
          )
          from db.${sql.ref(files.itemTable)} item
          where item.id = drive_before.id
        )`,
      );
    });
  }
  if (!nativeDocuments) return;
  if (registeredDocumentExtension) {
    if (registeredDocumentExtension !== nativeDocuments) {
      throw new Error(
        "Spark Drive capabilities must share one NativeDocumentExtension.",
      );
    }
    return;
  }
  registeredDocumentExtension = nativeDocuments;
  procedure("spark_drive_save_document", (s) => {
    s.defScalar("drive_item_id", inputId("item_id"));
    s.defScalar("drive_markdown", sql`p_input->>'markdown'`);
    s.throwErrorIf(
      sql`drive_markdown is null`,
      sql.lit`markdown is required.`,
    );
    // Markdown retains managed image URLs, not Lexical's blobHash field.
    // Resolve only this item's registered images; never borrow another item's
    // blobs or silently append a version whose images cannot be exported.
    s.defScalar(
      "drive_document_content",
      sql`fn.native_document_restore_image_hashes(lexical_from_markdown(drive_markdown), drive_item_id)`,
    );
    s.throwErrorIf(
      sql`exists (select 1 from json.array_each(lexical_extract_nodes(drive_document_content, 'image')) image
      where nullif(image.value->>'blobHash', '') is null)`,
      sql
        .lit`Keep the registered image URLs returned by read_document. Upload new images through the document editor or policy import before saving.`,
    );
    s.if(sql`drive_item_id is null`, (s) => {
      s.defScalar("drive_space_id", inputId("space_id"));
      s.throwErrorIf(
        sql`not ${allowedSpace(sql`drive_space_id`)}`,
        sql.lit`The file space is unavailable.`,
      );
      nativeDocuments.createDocument(s, {
        spaceId: sql`drive_space_id`,
        parentItemId: inputId("parent_id"),
        name: sql`p_input->>'name'`,
        description: inputText("description"),
        content: sql`drive_document_content`,
        sysUserId: sql`current_user`,
        intoItem: "drive_document_item_id",
        intoVersion: "drive_document_version_id",
      });
      s.setScalar("drive_item_id", sql`drive_document_item_id`);
    }, (s) => {
      s.throwErrorIf(
        sql`not exists (
          select 1 from db.${sql.ref(files.itemTable)} item
          where item.id = drive_item_id
            and ${allowedSpace(sql`item.file_space_id`)}
        )`,
        sql.lit`The document is unavailable.`,
      );
      nativeDocuments.saveDocument(s, {
        fileItemId: sql`drive_item_id`,
        content: sql`drive_document_content`,
        sysUserId: sql`current_user`,
        note: inputText("note"),
        imageBlobHashes:
          sql`coalesce((select json_array_agg(image.value->>'blobHash')
          from json.array_each(lexical_extract_nodes(drive_document_content, 'image')) image), '[]'::json)`,
        intoVersion: "drive_document_version_id",
      });
    });
    s.setScalar(
      "spark_drive_result",
      sql`json_build_object(
        'item_id', drive_item_id,
        'version_id', (select current_file_version_id
          from db.${sql.ref(files.itemTable)} where id = drive_item_id)
      )`,
    );
  });
  procedure("spark_drive_read_document", (s) => {
    s.defRecord(
      "drive_document",
      sql`
        select item.id, item.name, content.file_version_id,
          content.rich_content
        from db.${sql.ref(files.itemTable)} item
        join db.${sql.ref(files.versionTable)} version
          on version.file_item_id = item.id
            and version.id = coalesce(
              ${inputId("version_id")}, item.current_file_version_id
            )
        join db.${sql.ref(nativeDocuments.contentTable)} content
          on content.file_version_id = version.id
        where item.id = ${inputId("item_id")}
          and ${allowedSpace(sql`item.file_space_id`)}
          and fn.drive_can_read_version(item.id, version.id, current_user)
      `,
    );
    s.throwErrorIf(
      sql`drive_document.id is null`,
      sql.lit`The native document version is unavailable.`,
    );
    s.setScalar(
      "spark_drive_result",
      sql`json_build_object(
        'item_id', drive_document.id,
        'name', drive_document.name,
        'version_id', drive_document.file_version_id,
        'markdown', lexical_rich_text_to_markdown(drive_document.rich_content)
      )`,
    );
  });
}

const SPARK_DRIVE_DOC = `For native document edits, keep image URLs returned by
read_document unchanged to preserve registered images. Removing an image removes
it only from the new version. New images must be uploaded through the editor or
policy import first; image URLs from other documents cannot be reused.

Drive tools manage folders and files in the listed
space types. Drive access rules still decide every read and write.

- Find a space with \`list_spaces\`, then browse with \`list_items\`. Set
  \`recursive: true\` for a whole subtree; \`query\` searches names in the
  subtree and \`trashed: true\` lists restorable trashed items. Results are
  capped; \`truncated: true\` means narrow the request.
- \`create_folder\` accepts a slash-separated \`path\` below \`parent_id\` (or
  the space root) and reuses existing folders, like \`mkdir -p\`.
- \`update_item\` changes one item: pass any of \`name\`, \`description\`
  (null clears it), \`folder_id\` (null is the space root), or \`trashed\`.
  Trashing a folder trashes its contents; restoring brings them back.
- Actions run immediately. Each returns an \`action_id\` receipt that
  \`tools.undoReceipt({ receiptId })\` can undo. Loop over items for bulk
  changes and report each outcome.
- Upload bytes with \`tools.prepareDriveUpload({ spaceId, parentId, filename,
  mimeType })\` and POST the raw file to the returned URL, or pass \`itemId\`
  instead of \`spaceId\` to add a new version. Download an exact version with
  \`tools.downloadDriveFile({ versionId })\`.`;

const SPARK_DRIVE_DOCUMENT_DOC = `
- Native documents are rich text. \`save_document\` creates one (with
  \`space_id\`, \`name\`, optional \`parent_id\`) or replaces an existing one's
  whole content (with \`item_id\`). Markdown supports headings, paragraphs,
  **bold**, *italic*, flat bullet and numbered lists, block quotes, and pipe
  tables. \`read_document\` returns stored content as Markdown.
- In controlled spaces a new file starts as a draft, and saving a published
  file requires an open draft revision.`;

/**
 * Generic Spark tools for browsing and organizing Drive spaces. Mutations run
 * through Drive's own procedures and authorization, and every change is a
 * reversible Spark action with a transaction receipt.
 */
export function sparkDriveCapability(
  opts: SparkDriveCapabilityOpts,
): SparkCapability {
  if (opts.spaceTypes.length === 0) {
    throw new Error("sparkDriveCapability requires at least one space type.");
  }
  for (const spaceType of opts.spaceTypes) {
    if (!opts.files.spaceTypes.includes(spaceType)) {
      throw new Error(
        `Spark Drive capability "${opts.name}" received an unattached ` +
          `space type "${spaceType.name}".`,
      );
    }
  }
  const spaceTypes = sql`${
    sql.lit(JSON.stringify(opts.spaceTypes.map((type) => type.name)))
  }::json`;
  const call = (s: GeneralServerStatements, procedure: string, input: Sql) => {
    // Spark builds tools after Drive attaches its extensions; capability
    // modules can be imported before that.
    registerSparkDriveProcedures(opts.files, opts.nativeDocuments);
    s.callStoredProcedure(procedure, {
      inputScalars: { p_space_types: spaceTypes, p_input: input },
      outputScalars: { spark_drive_result: "spark_drive_tool_result" },
    });
  };
  const fn = (
    name: string,
    procedure: string,
    description: string,
    inputType: string,
  ): SparkFunction => ({
    name,
    description,
    inputType,
    procedure: (s) => {
      call(s, procedure, sql`function_input`);
      s.return(sql`spark_drive_tool_result`);
    },
  });
  const action = (
    name: string,
    description: string,
    inputType: string,
  ): SparkAction => ({
    name,
    description,
    inputType,
    mode: "reversible",
    procedure: (s) =>
      s.try({
        body: (s) => {
          call(s, `spark_drive_${name}`, sql`action_input`);
          s.setScalar("action_result", sql`spark_drive_tool_result::string`);
        },
        errorName: "spark_drive_error",
        catch: (s) => rethrowSparkActionError(s, "spark_drive_error"),
      }),
  });
  const functions = [
    fn(
      "list_spaces",
      "spark_drive_spaces",
      "List readable file spaces, optionally filtered by type or name.",
      "{ type?: string; query?: string; limit?: number }",
    ),
    fn(
      "list_items",
      "spark_drive_items",
      "List folders and files with full paths in a space or folder.",
      "{ space_id: number; folder_id?: number; recursive?: boolean; query?: string; trashed?: boolean; limit?: number }",
    ),
    fn(
      "get_item",
      "spark_drive_item",
      "Read one file or folder with its path and readable version history.",
      "{ item_id: number }",
    ),
  ];
  const actions = [
    action(
      "create_folder",
      "Create a folder path below parent_id or the space root, reusing folders that already exist.",
      "{ space_id: number; parent_id?: number; path: string }",
    ),
    action(
      "update_item",
      "Rename, describe, move, trash, or restore one file or folder.",
      "{ item_id: number; name?: string; description?: string | null; folder_id?: number | null; trashed?: boolean }",
    ),
  ];
  if (opts.nativeDocuments) {
    functions.push(fn(
      "read_document",
      "spark_drive_read_document",
      "Read a native document version as Markdown; defaults to the working version.",
      "{ item_id: number; version_id?: number }",
    ));
    actions.push(action(
      "save_document",
      "Create a native rich-text document from Markdown, or replace an existing document's content.",
      "{ item_id?: number; space_id?: number; parent_id?: number; name?: string; description?: string; markdown: string; note?: string }",
    ));
  }
  const fileSource = opts.fileSource;
  return {
    name: opts.name,
    label: opts.label,
    description: opts.description ??
      "Browse and organize Drive folders and files",
    permission: opts.permission,
    permissions: opts.permissions,
    tables: fileSource ? [opts.files.versionTable] : undefined,
    fileSources: fileSource
      ? [sparkDriveFileSource({
        name: fileSource.name,
        files: opts.files,
        spaceTypes: opts.spaceTypes,
        pdfMarkup: fileSource.pdfMarkup,
      })]
      : undefined,
    functions,
    actions,
    doc: [
      SPARK_DRIVE_DOC,
      opts.nativeDocuments ? SPARK_DRIVE_DOCUMENT_DOC : "",
      fileSource
        ? `\n- File source \`${fileSource.name}\` reads these files by version_id with readFileImage and query({ sql, file }).`
        : "",
      opts.doc ? `\n\n${opts.doc}` : "",
    ].join(""),
  };
}
