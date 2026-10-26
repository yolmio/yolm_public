import { AuthBlock } from "blocks/auth";
import { AuthApiICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { useApp, useICtx } from "std/ui";
import type { EndpointStatements } from "std/statements";
import type { MaintenanceReportingOptions } from "./reporting_options";

const domains = new Set<string>();

export function useReportMessageApi(options: MaintenanceReportingOptions) {
  const app = useApp();
  const domain = app.domain;
  if (domains.has(domain)) return;
  // Local camera/file previews use object URLs; keep the remaining app policy intact.
  const policy = app.securityHeaders.contentSecurityPolicy;
  if (policy !== false) {
    const configured = typeof policy === "object" ? policy : {};
    app.securityHeaders.contentSecurityPolicy = {
      ...configured,
      additionalSources: {
        ...configured.additionalSources,
        "img-src": [
          ...(configured.additionalSources?.["img-src"] ?? []),
          "blob:",
        ],
        "media-src": [
          ...(configured.additionalSources?.["media-src"] ?? []),
          "'self'",
          "blob:",
        ],
      },
    };
  }
  const auth = useICtx(AuthApiICtxKey);
  domains.add(domain);
  const api = system.api({ domain, prefix: "/api" });
  function authenticate(s: EndpointStatements) {
    auth.authenticate(s);
    s.if(
      sql`not (${
        AuthBlock.userHasPermission(
          sql.lit(options.reportPermission),
          sql`user_id`,
        )
      } or ${
        AuthBlock.userHasPermission(
          sql.lit(options.managePermission),
          sql`user_id`,
        )
      })`,
      (s) => {
        s.setHttpStatus(403);
        s.return(
          sql`json_build_object('error', 'Maintenance access required.')`,
        );
      },
    );
  }
  api.post("/problem-messages/start", {
    jsonBodyScalar: "body",
    procedure: (s) => {
      authenticate(s);
      s.defScalar("key", sql`try_cast(body->>'client_id' as uuid)`);
      s.defScalar("equipment", sql`try_cast(body->>'equipment_id' as bigint)`);
      s.defScalar(
        "report_location",
        sql`try_cast(body->>'location_id' as bigint)`,
      );
      s.defScalar("issue", sql`try_cast(body->>'issue_id' as bigint)`);
      s.if(
        sql`(body->>'equipment_id' is not null and equipment is null)
          or (body->>'location_id' is not null and report_location is null)
          or (body->>'issue_id' is not null and issue is null)
          or (body->'files' is not null and json_typeof(body->'files') <> 'array')`,
        (s) => {
          s.setHttpStatus(400);
          s.return(
            sql`json_build_object('error', 'Invalid report reference or file list.')`,
          );
        },
      );
      // The item owns follow-up context; Operations may have linked it since the page opened.
      s.if(
        sql`issue is not null and exists(select 1 from db.maintenance_items where id = issue)`,
        (s) => {
          s.setScalar(
            "equipment",
            sql`(select equipment_id from db.maintenance_item_targets where maintenance_item_id = issue order by id limit 1)`,
          );
          s.setScalar(
            "report_location",
            sql`(select location_id from db.maintenance_item_targets where maintenance_item_id = issue order by id limit 1)`,
          );
        },
      );
      s.if(
        sql`key is null or (equipment is not null and report_location is not null) or (equipment is not null and not exists(select 1 from db.equipment where id = equipment)) or (report_location is not null and not exists(select 1 from db.locations where id = report_location)) or char_length(coalesce(body->>'summary', '')) > 4000 or (issue is not null and not exists(select 1 from db.maintenance_items item where item.id = issue and ((equipment is null and report_location is null and not exists(select 1 from db.maintenance_item_targets target where target.maintenance_item_id = item.id)) or exists(select 1 from db.maintenance_item_targets target where target.maintenance_item_id = item.id and (target.equipment_id is not distinct from equipment) and (target.location_id is not distinct from report_location)))))`,
        (s) => {
          s.setHttpStatus(400);
          s.return(
            sql`json_build_object('error', 'Check the equipment or location, report and summary.')`,
          );
        },
      );
      s.startTransaction();
      s.defRecord(
        "existing",
        sql`select * from db.maintenance_submission_drafts where client_id = key`,
      );
      s.if(
        sql`existing.id is not null and (
          existing.author_user_id <> user_id
          or (existing.submitted_at is null and (existing.maintenance_item_id is distinct from issue))
          or (issue is not null and (existing.maintenance_item_id is distinct from issue))
          or (issue is null and ((existing.equipment_id is distinct from equipment) or (existing.location_id is distinct from report_location)))
        )`,
        (s) => {
          s.setHttpStatus(403);
          s.return(
            sql`json_build_object('error', 'This draft belongs to another report or user.')`,
          );
        },
      );
      s.defScalar("draft_id", sql`existing.id`);
      s.if(sql`draft_id is null`, (s) => {
        s.modify(
          sql`insert into db.maintenance_submission_drafts (client_id, author_user_id, equipment_id, location_id, maintenance_item_id, summary, condition, upload_touched_at) values (key, user_id, equipment, report_location, issue, coalesce(body->>'summary', ''), body->>'condition', now()) returning id into draft_id`,
        );
      }).else((s) => {
        s.modify(
          sql`update db.maintenance_submission_drafts set upload_touched_at = now(), equipment_id = equipment, location_id = report_location, summary = coalesce(body->>'summary', ''), condition = body->>'condition' where id = draft_id and submitted_at is null`,
        );
      });
      s.if(
        sql`existing.submitted_at is null and body->'files' is not null`,
        (s) => {
          s.modify(
            sql`delete from db.maintenance_submission_media where message_id = draft_id and cast(client_id as string) not in (select value #>> '{}' from json.array_each(body->'files'))`,
          );
        },
      );
      s.commitTransaction();
      s.return(
        sql`json_build_object('id', draft_id, 'received', existing.submitted_at is not null, 'issue_id', existing.maintenance_item_id, 'files', coalesce((select json_array_agg(cast(client_id as string)) from db.maintenance_submission_media where message_id = draft_id), '[]'::json))`,
      );
    },
  });
  function ownPendingMessage(s: EndpointStatements) {
    authenticate(s);
    s.if(
      sql`not exists(select 1 from db.maintenance_submission_drafts where id = upload_message_id and author_user_id = user_id and submitted_at is null)`,
      (s) => {
        s.setHttpStatus(403);
        s.return(
          sql`json_build_object('error', 'This upload is not an editable draft.')`,
        );
      },
    );
  }
  api.post("/problem-messages/{upload_message_id:id}/files/{file_key}", {
    query: [{ name: "name", type: { type: "String", maxLength: 255 } }, {
      name: "type",
      type: { type: "String", maxLength: 120 },
    }],
    blobBody: {
      scalar: "uploaded_blob",
      sizeScalar: "uploaded_size",
      maxSize: 100 * 1024 * 1024,
      authorize: ownPendingMessage,
    },
    procedure: (s) => {
      s.startTransaction();
      ownPendingMessage(s);
      s.if(
        sql`try_cast(file_key as uuid) is null or nullif(trim(name), '') is null`,
        (s) => {
          s.setHttpStatus(400);
          s.return(
            sql`json_build_object('error', 'Invalid file identity or name.')`,
          );
        },
      );
      s.modify(
        sql`update db.maintenance_submission_drafts set upload_touched_at = now() where id = upload_message_id and submitted_at is null`,
      );
      s.if(
        sql`exists(select 1 from db.maintenance_submission_media where client_id = cast(file_key as uuid) and message_id <> upload_message_id)`,
        (s) => {
          s.setHttpStatus(409);
          s.return(
            sql`json_build_object('error', 'File belongs to a different report.')`,
          );
        },
      );
      s.if(
        sql`not exists(select 1 from db.maintenance_submission_media where client_id = cast(file_key as uuid))`,
        (s) => {
          s.if(
            sql`(select count(*) from db.maintenance_submission_media where message_id = upload_message_id) >= 20 or coalesce((select sum(size) from db.maintenance_submission_media where message_id = upload_message_id), 0) + uploaded_size > 300 * 1024 * 1024`,
            (s) => {
              s.setHttpStatus(413);
              s.return(
                sql`json_build_object('error', 'Use at most 20 files and 300 MB per report.')`,
              );
            },
          );
          s.modify(
            sql`insert into db.maintenance_submission_media (client_id, message_id, name, content_type, size, blob) values (cast(file_key as uuid), upload_message_id, name, coalesce(type, 'application/octet-stream'), uploaded_size, uploaded_blob)`,
          );
        },
      );
      s.commitTransaction();
      s.return(sql`json_build_object('ok', true)`);
    },
  });
  api.post("/problem-messages/{submit_message_id:id}/send", {
    jsonBodyScalar: "body",
    procedure: (s) => {
      authenticate(s);
      s.startTransaction();
      s.callStoredProcedure("submit_maintenance_message", {
        inputScalars: {
          p_message_id: sql`submit_message_id`,
          p_actor_id: sql`user_id`,
          p_file_ids: sql`body->'files'`,
        },
        outputScalars: {
          p_issue_id: "sent_issue_id",
        },
      });
      s.commitTransaction();
      s.return(
        sql`json_build_object('received', true, 'issue_id', sent_issue_id)`,
      );
    },
  });
  api.post("/problem-messages/{discard_client_id}/discard", {
    procedure: (s) => {
      authenticate(s);
      s.startTransaction();
      s.defRecord(
        "discard_message",
        sql`select id, author_user_id, submitted_at, maintenance_item_id
        from db.maintenance_submission_drafts
        where client_id = try_cast(discard_client_id as uuid)`,
      );
      s.if(
        sql`discard_message.id is not null and discard_message.author_user_id <> user_id`,
        (s) => {
          s.setHttpStatus(403);
          s.return(
            sql`json_build_object('error', 'This draft belongs to another user.')`,
          );
        },
      );
      s.callStoredProcedure("discard_maintenance_upload", {
        inputScalars: {
          p_client_id: sql`try_cast(discard_client_id as uuid)`,
          p_actor_id: sql`user_id`,
        },
      });
      s.commitTransaction();
      s.return(
        sql`json_build_object('discarded', discard_message.submitted_at is null, 'received', discard_message.submitted_at is not null, 'issue_id', discard_message.maintenance_item_id)`,
      );
    },
  });
  api.get("/problem-media/{media_id:id}", {
    procedure: (s) => {
      authenticate(s);
      s.defRecord(
        "media",
        sql`select media.* from db.maintenance_submission_media media join db.maintenance_submission_drafts message on message.id = media.message_id where media.id = media_id and (message.submitted_at is not null or message.author_user_id = user_id)`,
      );
      s.if(sql`media.id is null`, (s) => {
        s.setHttpStatus(404);
        s.return();
      });
      s.setHeader(
        sql.lit`Content-Type`,
        sql`case when media.content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp4', 'audio/mpeg', 'audio/webm', 'application/pdf') then media.content_type else 'application/octet-stream' end`,
      );
      s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
      s.returnBlob(sql`media.blob`);
    },
  });
  api.get("/comment-attachments/{attachment_key:uuid}", {
    procedure: (s) => {
      authenticate(s);
      s.defRecord(
        "attachment",
        sql`select attachment.* from db.comment_attachments attachment
          join db.comments comment on comment.id = attachment.comment_id
          join db.comment_threads thread on thread.id = comment.comment_thread_id
          where attachment.public_id = attachment_key
            and thread.maintenance_item_id is not null`,
      );
      s.if(sql`attachment.id is null`, (s) => {
        s.setHttpStatus(404);
        s.return();
      });
      s.setHeader(
        sql.lit`Content-Type`,
        sql`case when attachment.content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp4', 'audio/mpeg', 'audio/webm', 'application/pdf') then attachment.content_type else 'application/octet-stream' end`,
      );
      s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
      s.returnBlob(sql`attachment.blob`);
    },
  });
}
