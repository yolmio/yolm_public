import { sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";

/** Uses Drive's own endpoints so extension policy and normal file records remain authoritative. */
export const sparkDriveTransferTools = [
  {
    name: "downloadDriveFile",
    statements: (s: GeneralServerStatements) => {
      s.defScalar(
        "transfer_version",
        sql`try_cast(tool_input->0->>'versionId' as bigint)`,
      );
      s.if(
        sql`not exists(select 1 from db.file_versions v where v.id = transfer_version
        and fn.drive_can_read_version(v.file_item_id, v.id, current_user))`,
        (s) => {
          s.throwError(sql.lit`File version not found or access denied.`);
        },
      );
      s.defScalar(
        "transfer_url",
        sql`http.sign_request('GET', (http.request_info()->>'origin') || '/api/files/versions/' || transfer_version::string || '/content',
        json_build_object('_user', current_user), now() + interval '30 minutes')`,
      );
      s.if(
        sql`transfer_url is null`,
        (s) => s.throwError(sql.lit`Unable to prepare download.`),
      );
      s.return(
        sql`json_build_object('url', transfer_url, 'method', 'GET', 'expiresAt', now() + interval '30 minutes')`,
      );
    },
  },
  {
    name: "prepareDriveUpload",
    statements: (s: GeneralServerStatements) => {
      s.if(
        sql`spark_read_only`,
        (s) => s.throwError(sql.lit`Uploads require write access.`),
      );
      s.defScalar(
        "transfer_space",
        sql`try_cast(tool_input->0->>'spaceId' as bigint)`,
      );
      s.defScalar(
        "transfer_item",
        sql`try_cast(tool_input->0->>'itemId' as bigint)`,
      );
      s.if(
        sql`transfer_item is not null`,
        (s) =>
          s.setScalar(
            "transfer_space",
            sql`(select file_space_id from db.file_items where id = transfer_item)`,
          ),
      );
      s.defScalar(
        "transfer_parent",
        sql`try_cast(tool_input->0->>'parentId' as bigint)`,
      );
      s.defScalar("transfer_name", sql`tool_input->0->>'filename'`);
      s.defScalar(
        "transfer_mime",
        sql`coalesce(tool_input->0->>'mimeType', 'application/octet-stream')`,
      );
      s.if(
        sql`not coalesce(case when transfer_item is not null
          then fn.drive_can_create_version(transfer_space, transfer_item, current_user)
          else fn.drive_can_create_file(transfer_space, transfer_parent, current_user) end, false)
        or transfer_name is null or length(transfer_name) not between 1 and 500`,
        (s) => {
          s.throwError(
            sql.lit`Upload location is unavailable or filename is invalid.`,
          );
        },
      );
      s.defScalar(
        "transfer_url",
        sql`http.sign_request('POST', (http.request_info()->>'origin') || case when transfer_item is not null
          then '/api/files/items/' || transfer_item::string || '/versions/upload'
          else '/api/files/spaces/' || transfer_space::string || '/items/upload' end,
        json_build_object('_user', current_user, 'parent_id', coalesce(transfer_parent::string, ''),
          'file_name', transfer_name, 'content_type', transfer_mime), now() + interval '30 minutes')`,
      );
      s.if(
        sql`transfer_url is null`,
        (s) => s.throwError(sql.lit`Unable to prepare upload.`),
      );
      s.return(
        sql`json_build_object('url', transfer_url, 'method', 'POST', 'body', 'raw file bytes', 'expiresAt', now() + interval '30 minutes')`,
      );
    },
  },
];
