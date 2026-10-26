import { CommentsBlock } from "blocks/comments";
import { AuthBlock } from "blocks/auth";
import { EquipmentBlock } from "blocks/equipment";
import type { MaintenanceReportingOptions } from "./reporting_options";
import { sql } from "std/sql_utils";
import { system } from "std/system";

export function registerReportMessageProcedure(
  options: MaintenanceReportingOptions,
) {
  system.storedProcedure({
    name: "submit_maintenance_message",
    transaction: "caller",
    inputScalars: [
      { name: "p_message_id", type: "BigInt" },
      { name: "p_actor_id", type: "BigInt" },
      { name: "p_file_ids", type: "Json" },
    ],
    outputScalars: [{ name: "p_issue_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorIf(
        sql`not (${
          AuthBlock.userHasPermission(
            sql.lit(options.reportPermission),
            sql`p_actor_id`,
          )
        } or ${
          AuthBlock.userHasPermission(
            sql.lit(options.managePermission),
            sql`p_actor_id`,
          )
        })`,
        sql.lit`Maintenance permission is required.`,
      );
      s.defRecord(
        "message",
        sql`select * from db.maintenance_submission_drafts
          where id = p_message_id and author_user_id = p_actor_id`,
      );
      s.throwErrorIf(
        sql`message.id is null`,
        sql.lit`Report draft not found.`,
      );
      s.setScalar("p_issue_id", sql`message.maintenance_item_id`);
      s.returnIf(sql`message.submitted_at is not null`);
      s.throwErrorIf(
        sql`coalesce(json_typeof(p_file_ids), '') <> 'array'`,
        sql.lit`An attachment list is required.`,
      );
      s.defTable(
        "wanted_files",
        sql`select distinct try_cast(value #>> '{}' as uuid) as client_id
          from json.array_each(p_file_ids)`,
      );
      s.throwErrorIf(
        sql`exists(select 1 from wanted_files where client_id is null)
          or (select count(*) from wanted_files) > 20
          or exists(select 1 from wanted_files wanted where not exists(
            select 1 from db.maintenance_submission_media media
            where media.message_id = p_message_id
              and media.client_id = wanted.client_id))`,
        sql.lit`Some files have not arrived. Retry the upload before sending.`,
      );
      s.throwErrorIf(
        sql`trim(message.summary) = '' and not exists(select 1 from wanted_files)`,
        sql.lit`Add a description, photo, video or file.`,
      );
      s.throwErrorIf(
        // "unknown" is the composer's "not sure": no condition recorded.
        sql`coalesce(message.condition, '') not in
          ('', 'unknown', 'operational', 'degraded', 'unavailable')`,
        sql.lit`Choose a valid observation.`,
      );
      s.modify(sql`delete from db.maintenance_submission_media
        where message_id = p_message_id
          and client_id not in (select client_id from wanted_files)`);
      s.defScalar("maintenance_thread_id", sql`cast(null as bigint)`);
      s.if(sql`p_issue_id is null`, (s) => {
        // Recheck at submission: equipment can be deleted after a draft starts.
        // Follow-ups and retries on historical items remain available.
        s.throwErrorIf(
          sql`(message.equipment_id is not null and not exists(
            select 1 from db.equipment equipment where id = message.equipment_id
              and ${
            system.block(EquipmentBlock).opts.shopFloor
              ? sql`equipment.active`
              : sql`true`
          }))
            or (message.location_id is not null and not exists(
              select 1 from db.locations where id = message.location_id and active))`,
          sql
            .lit`Choose active equipment or a location before sending a new report.`,
        );
        s.modify(sql`insert into db.maintenance_items
          (kind, status, title, created_by_user_id)
          values ('reported_problem', 'open',
            case when trim(message.summary) = '' then 'Photo report'
              else substring(trim(message.summary) from 1 for 80) end,
            p_actor_id)
          returning id into p_issue_id`);
        s.if(
          sql`message.equipment_id is not null or message.location_id is not null`,
          (s) => {
            s.modify(sql`insert into db.maintenance_item_targets
              (maintenance_item_id, equipment_id, location_id, condition)
              values (p_issue_id, message.equipment_id, message.location_id,
                cast(case when message.equipment_id is not null
                    and message.condition in ('degraded', 'unavailable')
                  then message.condition else null end
                  as enums.maintenance_target_condition))`);
          },
        );
        s.modify(sql`insert into db.maintenance_item_activities
          (maintenance_item_id, activity_type, actor_user_id)
          values (p_issue_id, 'created', p_actor_id)`);
        s.modify(sql`insert into db.comment_threads (maintenance_item_id)
          values (p_issue_id) returning id into maintenance_thread_id`);
        options.onReportCreated?.(s, {
          itemId: sql`p_issue_id`,
          actorId: sql`p_actor_id`,
        });
      }).else((s) => {
        s.setScalar(
          "maintenance_thread_id",
          sql`(select id from db.comment_threads
            where maintenance_item_id = p_issue_id)`,
        );
        s.throwErrorIf(
          sql`maintenance_thread_id is null`,
          sql.lit`Report discussion not found.`,
        );
      });
      s.defScalar("maintenance_comment_actor", sql`current_user`);
      s.setCurrentUser(sql`p_actor_id`);
      system.block(CommentsBlock).post(s, {
        threadId: sql`maintenance_thread_id`,
        body: sql`lexical_simple_paragraph(case
          when trim(message.summary) = '' then 'Photo or video attached.'
          else trim(message.summary) end)`,
        intoComment: "maintenance_comment_id",
      });
      s.setCurrentUser(sql`maintenance_comment_actor`);
      s.modify(sql`insert into db.comment_attachments
        (public_id, comment_id, name, content_type, blob)
        select media.client_id, maintenance_comment_id, media.name,
          media.content_type, media.blob
        from db.maintenance_submission_media media
        where media.message_id = p_message_id
          and media.client_id in (select client_id from wanted_files)`);
      s.modify(sql`update db.maintenance_submission_drafts
        set maintenance_item_id = p_issue_id, submitted_at = now()
        where id = p_message_id`);
    },
  });

  system.storedProcedure({
    name: "discard_maintenance_upload",
    transaction: "caller",
    inputScalars: [
      { name: "p_client_id", type: "Uuid" },
      { name: "p_actor_id", type: "BigInt" },
    ],
    procedure: (s) => {
      s.defRecord(
        "discard_draft",
        sql`select id, author_user_id, submitted_at
          from db.maintenance_submission_drafts where client_id = p_client_id`,
      );
      s.throwErrorIf(
        sql`discard_draft.id is not null
          and discard_draft.author_user_id <> p_actor_id`,
        sql.lit`This draft belongs to another user.`,
      );
      s.if(sql`discard_draft.submitted_at is null`, (s) => {
        s.modify(sql`delete from db.maintenance_submission_media
          where message_id = discard_draft.id`);
        s.modify(sql`delete from db.maintenance_submission_drafts
          where id = discard_draft.id and submitted_at is null`);
      });
    },
  });

  system.storedProcedure({
    name: "expire_maintenance_uploads",
    transaction: "caller",
    procedure: (s) => {
      s.defTable(
        "expired_uploads",
        sql`select id from db.maintenance_submission_drafts
          where (submitted_at is null and
            coalesce(upload_touched_at, created_at) < now() - interval '7 days')
            or (submitted_at < now() - interval '1 day' and (summary <> '' or condition is not null or upload_touched_at is not null))
          order by coalesce(submitted_at, upload_touched_at, created_at), id
          limit 100`,
      );
      s.modify(sql`delete from db.maintenance_submission_media
        where message_id in (select id from expired_uploads)`);
      // Keep delivery identity and context for arbitrarily delayed phone retries.
      s.modify(sql`update db.maintenance_submission_drafts
        set summary = '', condition = null, upload_touched_at = null
        where id in (select id from expired_uploads) and submitted_at is not null`);
      s.modify(sql`delete from db.maintenance_submission_drafts
        where id in (select id from expired_uploads) and submitted_at is null`);
    },
  });
  system.scheduledProc({
    name: "expire_maintenance_uploads",
    description: "Remove expired maintenance upload staging.",
    schedule: "0 17 * * * *",
    procedure: (s) => {
      s.startTransaction();
      s.callStoredProcedure("expire_maintenance_uploads", {});
      s.commitTransaction();
    },
  });
}
