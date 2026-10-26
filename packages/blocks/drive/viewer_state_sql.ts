import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DriveBlockContract } from "./types.ts";

export function fileViewerStateSql(
  files: DriveBlockContract,
  fileItemId: Sql,
  fileVersionId: Sql,
  useCurrentVersion: Sql,
  retainedVersion: Sql,
): Sql {
  // Item and version IDs are non-null keys. Null-safe comparisons preserve
  // their equality semantics while permitting a literal NULL version input.
  // The scalar authorization subquery runs after the selected item/version.
  return sql`
    select
      item.id as file_item_id,
      item.file_space_id,
      case when ${useCurrentVersion} then item.name
        else version.file_name end as name,
      version.id as file_version_id,
      version.version_number,
      space.space_type,
      version.content_type,
      version.byte_length,
      blob.blob_hash
    from db.file_items item
    join db.file_spaces space on space.id = item.file_space_id
    join db.file_versions version
      on version.file_item_id = item.id
      and (version.id is not distinct from case when ${useCurrentVersion}
        then item.current_file_version_id else ${fileVersionId} end)
    left join db.file_version_blobs blob
      on blob.file_version_id = version.id
    where (item.id is not distinct from ${fileItemId})
      and item.item_kind = 'file'
      and (item.trashed_at is null
        or (${retainedVersion} and not ${useCurrentVersion}))
      and (select ${
    files.canReadVersionSql({
      spaceRecord: sql`space`,
      itemRecord: sql`item`,
      versionRecord: sql`version`,
      sysUserId: sql`current_user`,
    })
  })
  `;
}
