import type { ControlledFileLifecycle } from "blocks/drive/controlled_lifecycle";
import type { DriveBlock, DriveSpaceType } from "blocks/drive";
import type { NativeDocumentExtension } from "blocks/drive/native_document";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

export interface SparkDriveKnowledge {
  files: DriveBlock;
  spaceType: DriveSpaceType;
  control: ControlledFileLifecycle;
  nativeDocuments: NativeDocumentExtension;
  createLocation: {
    spaceId: Sql;
    parentItemId?: Sql;
  };
}

export function sparkPublishedRevisionId(
  knowledge: SparkDriveKnowledge,
  fileItemId: Sql,
) {
  return knowledge.control.resolvePreferredPublishedRevision({
    fileItemId,
    preferredLanguage: sql.lit(knowledge.control.opts.defaultLanguage),
  });
}

export function sparkPublishedFileVersionId(
  knowledge: SparkDriveKnowledge,
  fileItemId: Sql,
) {
  return sql`(
    select revision.file_version_id
    from db.controlled_file_revisions revision
    where revision.id = ${
    sparkPublishedRevisionId(
      knowledge,
      fileItemId,
    )
  }
  )`;
}

export function canReadSparkKnowledgeFile(
  knowledge: SparkDriveKnowledge,
  sysUserId: Sql,
  fileItemId: Sql,
) {
  const versionId = sparkPublishedFileVersionId(knowledge, fileItemId);
  return sql`
    exists (
      select 1
      from db.file_items knowledge_item
      join db.file_spaces knowledge_space
        on knowledge_space.id = knowledge_item.file_space_id
      join db.file_versions knowledge_version
        on knowledge_version.id = ${versionId}
      where knowledge_item.id = ${fileItemId}
        and knowledge_item.item_kind = 'file'
        and knowledge_item.trashed_at is null
        and cast(knowledge_space.space_type as string) = ${
    sql.lit(knowledge.spaceType.name)
  }
        and ${
    knowledge.files.extensionEnabledSql(
      sql`knowledge_item.file_space_id`,
      knowledge.control.name,
    )
  }
        and ${
    knowledge.files.canReadVersionSql({
      spaceRecord: sql`knowledge_space`,
      itemRecord: sql`knowledge_item`,
      versionRecord: sql`knowledge_version`,
      sysUserId,
    })
  }
    )
  `;
}

export function canReadSparkKnowledgeForNullableOwner(
  knowledge: SparkDriveKnowledge,
  sysUserId: Sql,
  fileItemId: Sql,
) {
  return canReadSparkKnowledgeFile(knowledge, sysUserId, fileItemId);
}
