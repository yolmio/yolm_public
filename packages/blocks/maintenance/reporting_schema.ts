import { sql } from "std/sql_utils";
import { system } from "std/system";

/** Temporary upload staging plus final comment attachments. */
export function registerReportMessages() {
  system.db.table("maintenance_submission_drafts", (t) => {
    t.renameFrom("maintenance_report_messages");
    t.uuid("client_id").notNull().unique();
    // Disable accounts to revoke access; authored evidence must survive offboarding.
    t.fk("author_user_id", "sys_users").notNull().onDelete("Restrict");
    t.fk("equipment_id", "equipment");
    t.fk("location_id", "locations");
    t.check({
      fields: ["equipment_id", "location_id"],
      check: ([equipment, location]) =>
        sql`${equipment} is null or ${location} is null`,
      errorMessage: () =>
        sql.lit`Choose no more than one equipment item or location.`,
    });
    t.fk("maintenance_item_id", "maintenance_items").renameFrom(
      "maintenance_issue_id",
    );
    t.string("summary", 4000).notNull().default(sql.lit``);
    t.string("condition", 30);
    t.timestampUtc("created_at").notNull().default(sql`now()`);
    t.timestampUtc("submitted_at");
    // Last server upload activity; nullable until the first upload starts.
    t.timestampUtc("upload_touched_at");
  });
  system.db.table("maintenance_submission_media", (t) => {
    t.renameFrom("maintenance_report_media");
    t.uuid("client_id").notNull().unique();
    t.fk("message_id", "maintenance_submission_drafts").notNull();
    t.string("name", 255).notNull();
    t.string("content_type", 120).notNull();
    t.bigInt("size").notNull();
    t.blobRef("blob").notNull();
  });
  system.db.table("comment_attachments", (t) => {
    t.uuid("public_id").notNull().unique();
    t.fk("comment_id", "comments").notNull().onDelete("Cascade");
    t.string("name", 255).notNull();
    t.string("content_type", 120).notNull();
    t.blobRef("blob").notNull();
    t.timestampUtc("created_at").notNull().default(sql`now()`);
  });
}
