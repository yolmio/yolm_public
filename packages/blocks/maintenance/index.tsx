import { Alert } from "components/alert";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { AttachmentsTableBlock } from "table_blocks/attachments";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import { Each, Match, Show, Switch, useQueryParams } from "std/ui";
import type { EquipmentBlock } from "blocks/equipment";
import type { EventsBlock } from "blocks/events";
import type { LocationsBlock } from "blocks/locations";

export interface MaintenanceBlockOptions {
  events: EventsBlock;
  equipment: EquipmentBlock;
  locations: LocationsBlock;
}

/**
 * Corrective work, inspections, and revisioned preventive-maintenance
 * programs. Observed issues deliberately remain distinct from work performed.
 */
export class MaintenanceBlock implements Block {
  blockName = "MaintenanceBlock";
  blockDisplayName = "Maintenance";
  componentDependencies = [
    "MaintenanceDashboardPage",
    "MaintenanceWorkDetailPage",
  ];
  description =
    "Maintenance issues, work execution, parts, classifications, and revisioned programs.";

  constructor(readonly opts: MaintenanceBlockOptions) {}

  initialize() {
    for (
      const aggregate of [
        { name: "maintenance_issue", displayName: "Maintenance Issue" },
        { name: "maintenance_work", displayName: "Maintenance Work" },
        { name: "maintenance_program", displayName: "Maintenance Program" },
      ]
    ) {
      this.opts.events.registerAggregateType(aggregate);
    }
    for (
      const event of [
        { name: "maintenance.issue_reported", displayName: "Issue Reported" },
        { name: "maintenance.issue_triaged", displayName: "Issue Triaged" },
        { name: "maintenance.issue_resolved", displayName: "Issue Resolved" },
        { name: "maintenance.work_created", displayName: "Work Created" },
        { name: "maintenance.work_released", displayName: "Work Released" },
        { name: "maintenance.work_started", displayName: "Work Started" },
        { name: "maintenance.work_blocked", displayName: "Work Blocked" },
        { name: "maintenance.part_used", displayName: "Part Used" },
        { name: "maintenance.work_completed", displayName: "Work Completed" },
        { name: "maintenance.work_reviewed", displayName: "Work Reported" },
        {
          name: "maintenance.work_returned",
          displayName: "Work Returned for Correction",
        },
        { name: "maintenance.work_verified", displayName: "Work Verified" },
        { name: "maintenance.work_cancelled", displayName: "Work Cancelled" },
        {
          name: "maintenance.checklist_updated",
          displayName: "Checklist Updated",
        },
        {
          name: "maintenance.program_revision_activated",
          displayName: "Maintenance Program Revision Activated",
        },
      ]
    ) {
      this.opts.events.registerEventType(event);
    }

    this.addEnums();
    this.addProgramTables();
    this.addIssueAndWorkTables();
  }

  populate() {
    this.registerReportIssueProcedure();
    this.registerReleaseWorkProcedure();
    this.registerStartWorkProcedure();
    this.registerBlockWorkProcedure();
    this.registerRecordWorkStepProcedure();
    this.registerPassRemainingWorkStepsProcedure();
    this.registerCompleteWorkProcedure();
    this.registerReviewWorkProcedure();
    this.registerReturnWorkProcedure();
    this.registerVerifyWorkProcedure();
    this.registerCancelWorkProcedure();
    this.registerActivateProgramProcedure();
  }

  private addEnums() {
    system.enum_({
      name: "maintenance_issue_status",
      values: [
        { name: "reported", displayName: "Reported" },
        { name: "triaged", displayName: "Triaged" },
        { name: "merged", displayName: "Merged" },
        { name: "dismissed", displayName: "Dismissed" },
        { name: "resolved", displayName: "Resolved" },
      ],
    });
    system.enum_({
      name: "maintenance_work_status",
      values: [
        { name: "planned", displayName: "Work Request" },
        { name: "ready", displayName: "Released" },
        { name: "in_progress", displayName: "In Progress" },
        { name: "blocked", displayName: "Blocked" },
        { name: "completed", displayName: "Work Done" },
        { name: "reviewed", displayName: "Reported" },
        { name: "verified", displayName: "Finished" },
        { name: "cancelled", displayName: "Cancelled" },
      ],
    });
    system.enum_({
      name: "maintenance_priority",
      values: [
        { name: "emergency", displayName: "Emergency" },
        { name: "high", displayName: "High" },
        { name: "normal", displayName: "Normal" },
        { name: "low", displayName: "Low" },
      ],
    });
    system.enum_({
      name: "maintenance_operational_impact",
      values: [
        { name: "none", displayName: "No Interruption" },
        { name: "partial", displayName: "Partial Interruption" },
        { name: "full", displayName: "Full Interruption" },
      ],
    });
    system.enum_({
      name: "maintenance_work_type",
      values: [
        { name: "corrective", displayName: "Corrective" },
        { name: "preventive", displayName: "Preventive" },
        { name: "inspection", displayName: "Inspection" },
        { name: "calibration", displayName: "Calibration" },
        { name: "commissioning", displayName: "Commissioning" },
      ],
    });
    system.enum_({
      name: "maintenance_target_result",
      values: [
        { name: "completed", displayName: "Completed" },
        { name: "issue_found", displayName: "Issue Found" },
        { name: "skipped", displayName: "Skipped" },
        { name: "not_applicable", displayName: "Not Applicable" },
      ],
    });
    system.enum_({
      name: "maintenance_step_response_type",
      values: [
        { name: "pass_fail", displayName: "Pass / Attention / Fail" },
        { name: "acknowledgement", displayName: "Acknowledgement" },
        { name: "number", displayName: "Number" },
        { name: "text", displayName: "Text" },
      ],
    });
    system.enum_({
      name: "maintenance_step_result",
      values: [
        { name: "pass", displayName: "Pass" },
        { name: "attention", displayName: "Needs Attention" },
        { name: "fail", displayName: "Fail" },
        { name: "not_applicable", displayName: "Not Applicable" },
      ],
    });
    system.enum_({
      name: "maintenance_report_type",
      values: [
        { name: "inspection_status", displayName: "Inspection Status" },
        { name: "open_work", displayName: "Open Work" },
        {
          name: "equipment_availability",
          displayName: "Equipment Availability",
        },
      ],
    });
    system.enum_({
      name: "maintenance_report_cadence",
      values: [
        { name: "daily", displayName: "Daily" },
        { name: "weekly", displayName: "Weekly" },
        { name: "monthly", displayName: "Monthly" },
      ],
    });
    system.enum_({
      name: "maintenance_program_status",
      values: [
        { name: "draft", displayName: "Draft" },
        { name: "active", displayName: "Active" },
        { name: "obsolete", displayName: "Obsolete" },
      ],
    });
    system.enum_({
      name: "maintenance_revision_status",
      values: [
        { name: "proposed", displayName: "Proposed" },
        { name: "active", displayName: "Active" },
        { name: "superseded", displayName: "Superseded" },
        { name: "rejected", displayName: "Rejected" },
      ],
    });
    system.enum_({
      name: "maintenance_trigger_type",
      values: [
        { name: "calendar", displayName: "Calendar" },
        { name: "counter", displayName: "Counter" },
        { name: "condition", displayName: "Condition" },
        { name: "event", displayName: "Event" },
        { name: "manual", displayName: "Manual" },
      ],
    });
    system.enum_({
      name: "maintenance_recurrence_basis",
      values: [
        { name: "fixed_calendar", displayName: "Fixed Calendar" },
        {
          name: "completion_relative",
          displayName: "Relative to Completion",
        },
      ],
    });
    system.enum_({
      name: "maintenance_classification_status",
      values: [
        { name: "proposed", displayName: "Spark Proposed" },
        { name: "confirmed", displayName: "Confirmed" },
        { name: "rejected", displayName: "Rejected" },
      ],
    });
  }

  private addProgramTables() {
    system.db.table("maintenance_programs", (table) => {
      table.string("name", 240).notNull();
      table.fk("equipment_definition_id", "equipment_definitions").onDelete(
        "Restrict",
      );
      table.fk("equipment_id", "equipment").onDelete("Restrict");
      table.fk("location_id", "locations").onDelete("Restrict");
      table.enum("status", "maintenance_program_status").notNull().default(
        sql.lit`draft`,
      );
      table.string("description", 2000).multiline();
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.fk("created_by_user_id", "sys_users").onDelete("SetToNull");
      table.check({
        fields: ["equipment_definition_id", "equipment_id", "location_id"],
        check: ([definitionId, equipmentId, locationId]) =>
          sql`(${definitionId} is not null and ${equipmentId} is null and ${locationId} is null)
            or (${definitionId} is null and ${equipmentId} is not null and ${locationId} is null)
            or (${definitionId} is null and ${equipmentId} is null and ${locationId} is not null)`,
        errorMessage: () =>
          sql.lit`A maintenance program must have exactly one target.`,
      });
      table.recordDisplayName(["name"], (name) => name);
    });

    system.db.table("maintenance_program_revisions", (table) => {
      table.fk("maintenance_programs").notNull().onDelete("Cascade");
      table.smallUint("revision_no").notNull();
      table.enum("status", "maintenance_revision_status").notNull().default(
        sql.lit`proposed`,
      );
      table.string("generated_by", 80).notNull().default(sql.lit`human`);
      table.string("model_name", 160);
      table.string("source_summary", 2000).multiline();
      table.string("change_summary", 2000).multiline();
      table.json("source_file_versions").notNull().default(
        sql`json_build_array()`,
      );
      table.timestampUtc("proposed_at").notNull().default(sql`now()`);
      table.fk("proposed_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("activated_at");
      table.fk("activated_by_user_id", "sys_users").onDelete("SetToNull");
      table.unique(["maintenance_program_id", "revision_no"]);
    });

    system.db.table("maintenance_rules", (table) => {
      table.fk("maintenance_program_revisions").notNull().onDelete("Cascade");
      table.enum("work_type", "maintenance_work_type");
      table.string("name", 300).notNull();
      table.enum("trigger_type", "maintenance_trigger_type").notNull();
      table.decimal("interval_value", { precision: 16, scale: 3 });
      table.string("interval_unit", 40);
      table.enum("recurrence_basis", "maintenance_recurrence_basis");
      table.smallUint("lead_days").notNull().default(sql`7`);
      table.smallUint("tolerance_days").notNull().default(sql`0`);
      table.bool("allow_open_stacking").notNull().default(sql`false`);
      table.bool("supersedes_shorter_interval").notNull().default(sql`false`);
      table.date("valid_from");
      table.date("valid_to");
      table.smallUint("estimated_minutes");
      table.bool("blocks_usage").notNull().default(sql`false`);
      table.bool("generatable").notNull().default(sql`true`);
      table.enum("priority", "maintenance_priority").notNull().default(
        sql.lit`normal`,
      );
      table.string("maintenance_organization", 120);
      table.enum("operational_impact", "maintenance_operational_impact")
        .notNull().default(sql.lit`none`);
      table.fk("default_assigned_to_user_id", "sys_users").onDelete(
        "SetToNull",
      );
      table.string("contractor", 240);
      table.string("instructions", 6000).notNull().multiline();
      table.string("source_document", 400);
      table.string("source_page", 80);
      table.string("evidence", 2000).multiline();
      table.smallUint("sort_order").notNull().default(sql`0`);
      table.check({
        fields: ["valid_from", "valid_to"],
        check: ([validFrom, validTo]) =>
          sql`${validTo} is null or ${validFrom} is null or ${validTo} >= ${validFrom}`,
        errorMessage: () => sql.lit`Rule validity range is invalid.`,
      });
    });

    system.db.table("maintenance_rule_parts", (table) => {
      table.fk("maintenance_rules").notNull().onDelete("Cascade");
      table.string("part_number", 160);
      table.string("description", 300).notNull();
      table.decimal("quantity", { precision: 16, scale: 3 }).notNull();
      table.string("unit", 40).notNull();
    });

    system.db.table("maintenance_rule_steps", (table) => {
      table.fk("maintenance_rules").notNull().onDelete("Cascade");
      table.string("section", 160);
      table.string("prompt", 500).notNull();
      table.string("guidance", 2000).multiline();
      table.enum("response_type", "maintenance_step_response_type").notNull();
      table.bool("required").notNull().default(sql`true`);
      table.string("unit", 40);
      table.smallUint("sort_order").notNull().default(sql`0`);
    });
  }

  private addIssueAndWorkTables() {
    system.db.table("maintenance_issues", (table) => {
      table.addBlock(AttachmentsTableBlock);
      table.string("number", 40).unique();
      table.fk("equipment_id", "equipment").onDelete("Restrict");
      table.fk("location_id", "locations").onDelete("Restrict");
      table.enum("status", "maintenance_issue_status").notNull().default(
        sql.lit`reported`,
      );
      table.enum("priority", "maintenance_priority").notNull().default(
        sql.lit`normal`,
      );
      table.string("title", 300).notNull();
      table.string("description", 4000).notNull().multiline();
      table.string("discovery", 160);
      table.string("symptom", 240);
      table.string("source", 80).notNull().default(sql.lit`operator`);
      table.fk("reported_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("effective_at").notNull();
      table.timestampUtc("reported_at").notNull().default(sql`now()`);
      table.fk("merged_into_issue_id", "maintenance_issues").onDelete(
        "Restrict",
      );
      table.timestampUtc("resolved_at");
      table.string("external_system", 80);
      table.string("external_ref", 160);
      table.check({
        fields: ["equipment_id", "location_id"],
        check: ([equipmentId, locationId]) =>
          sql`(${equipmentId} is not null and ${locationId} is null)
            or (${equipmentId} is null and ${locationId} is not null)`,
        errorMessage: () =>
          sql
            .lit`A maintenance issue must target one equipment item or one location.`,
      });
      table.recordDisplayName(
        ["number", "title"],
        (number, title) => sql`coalesce(${number} || ' · ', '') || ${title}`,
      );
      table.searchConfig({
        fieldGroups: [
          { fields: ["number", "title"], priority: 1 },
          { fields: ["description"], priority: 2 },
        ],
      });
    });

    system.db.table("maintenance_work", (table) => {
      table.addBlock(AttachmentsTableBlock);
      table.string("number", 40).unique();
      table.enum("status", "maintenance_work_status").notNull().default(
        sql.lit`planned`,
      );
      table.enum("work_type", "maintenance_work_type").notNull();
      table.enum("priority", "maintenance_priority").notNull().default(
        sql.lit`normal`,
      );
      table.string("title", 300).notNull();
      table.string("description", 5000).multiline();
      table.fk("reported_by_user_id", "sys_users").onDelete("SetToNull");
      table.fk("assigned_to_user_id", "sys_users").onDelete("SetToNull");
      table.string("maintenance_organization", 120);
      table.string("contractor", 240);
      table.enum("operational_impact", "maintenance_operational_impact")
        .notNull().default(sql.lit`none`);
      table.smallUint("estimated_minutes");
      table.timestampUtc("target_start_at");
      table.timestampUtc("target_complete_at");
      table.timestampUtc("planned_start_at");
      table.timestampUtc("planned_end_at");
      table.bool("blocks_usage").notNull().default(sql`false`);
      table.timestampUtc("actual_started_at");
      table.timestampUtc("actual_completed_at");
      table.string("work_details", 6000).multiline();
      table.string("blocked_reason", 2000).multiline();
      table.string("review_notes", 2000).multiline();
      table.enum("result_operability", "equipment_operability");
      table.fk("completed_by_user_id", "sys_users").onDelete("SetToNull");
      table.fk("reviewed_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("reviewed_at");
      table.fk("verified_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("verified_at");
      table.fk("cancelled_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("cancelled_at");
      table.string("cancellation_reason", 2000).multiline();
      table.fk("maintenance_rule_id", "maintenance_rules").onDelete(
        "SetToNull",
      );
      table.fk(
        "maintenance_program_revision_id",
        "maintenance_program_revisions",
      )
        .onDelete("SetToNull");
      table.string("external_system", 80);
      table.string("external_ref", 160);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.recordDisplayName(
        ["number", "title"],
        (number, title) => sql`coalesce(${number} || ' · ', '') || ${title}`,
      );
      table.searchConfig({
        fieldGroups: [
          { fields: ["number", "title"], priority: 1 },
          { fields: ["description"], priority: 2 },
        ],
      });
    });

    system.db.table("maintenance_work_targets", (table) => {
      table.fk("maintenance_work").notNull().onDelete("Cascade");
      table.fk("equipment_id", "equipment").onDelete("Restrict");
      table.fk("location_id", "locations").onDelete("Restrict");
      table.enum("result", "maintenance_target_result");
      table.string("result_notes", 2000).multiline();
      table.timestampUtc("completed_at");
      table.check({
        fields: ["equipment_id", "location_id"],
        check: ([equipmentId, locationId]) =>
          sql`(${equipmentId} is not null and ${locationId} is null)
            or (${equipmentId} is null and ${locationId} is not null)`,
        errorMessage: () =>
          sql.lit`A work target must be one equipment item or one location.`,
      });
      table.unique(["maintenance_work_id", "equipment_id"]);
      table.unique(["maintenance_work_id", "location_id"]);
    });

    system.db.table("maintenance_issue_work", (table) => {
      table.fk("maintenance_issues").notNull().onDelete("Cascade");
      table.fk("maintenance_work").notNull().onDelete("Cascade");
      table.unique(["maintenance_issue_id", "maintenance_work_id"]);
    });

    system.db.table("maintenance_work_parts", (table) => {
      table.fk("maintenance_work").notNull().onDelete("Cascade");
      table.string("part_number", 160);
      table.string("description", 300).notNull();
      table.decimal("planned_quantity", { precision: 16, scale: 3 });
      table.decimal("used_quantity", { precision: 16, scale: 3 });
      table.string("unit", 40).notNull();
      table.timestampUtc("consumed_at");
    });

    system.db.table("maintenance_work_sessions", (table) => {
      table.fk("maintenance_work").notNull().onDelete("Cascade");
      table.fk("user_id", "sys_users").notNull().onDelete("Restrict");
      table.timestampUtc("started_at").notNull();
      table.timestampUtc("ended_at");
      table.smallUint("duration_minutes");
      table.string("notes", 1000).multiline();
      table.check({
        fields: ["started_at", "ended_at"],
        check: ([startedAt, endedAt]) =>
          sql`${endedAt} is null or ${endedAt} >= ${startedAt}`,
        errorMessage: () => sql.lit`Work session dates are invalid.`,
      });
    });

    system.db.table("maintenance_work_steps", (table) => {
      table.fk("maintenance_work").notNull().onDelete("Cascade");
      table.fk("source_rule_step_id", "maintenance_rule_steps").onDelete(
        "SetToNull",
      );
      table.string("section", 160);
      table.string("prompt", 500).notNull();
      table.string("guidance", 2000).multiline();
      table.enum("response_type", "maintenance_step_response_type").notNull();
      table.bool("required").notNull().default(sql`true`);
      table.string("unit", 40);
      table.smallUint("sort_order").notNull().default(sql`0`);
      table.enum("result", "maintenance_step_result");
      table.decimal("response_number", { precision: 18, scale: 4 });
      table.string("response_text", 2000).multiline();
      table.string("notes", 2000).multiline();
      table.fk("completed_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("completed_at");
    });

    system.db.table("maintenance_work_classifications", (table) => {
      table.fk("maintenance_work").notNull().onDelete("Cascade");
      table.enum("status", "maintenance_classification_status").notNull()
        .default(sql.lit`proposed`);
      table.string("observed_symptom", 500);
      table.string("affected_component", 300);
      table.string("failure_mode", 300);
      table.string("failure_mechanism", 300);
      table.string("cause", 500);
      table.string("cause_details", 2000).multiline();
      table.string("performed_action", 300);
      table.string("remedy", 1000).multiline();
      table.decimal("confidence", { precision: 5, scale: 4 });
      table.json("evidence").notNull().default(sql`json_build_array()`);
      table.string("model_name", 160);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.fk("reviewed_by_user_id", "sys_users").onDelete("SetToNull");
      table.timestampUtc("reviewed_at");
      table.check({
        fields: ["confidence"],
        check: ([confidence]) =>
          sql`${confidence} is null or (${confidence} >= 0 and ${confidence} <= 1)`,
        errorMessage: () => sql.lit`Confidence must be between 0 and 1.`,
      });
    });

    system.db.table("maintenance_saved_views", (table) => {
      table.fk("user_id", "sys_users").notNull().onDelete("Cascade");
      table.string("name", 160).notNull();
      table.json("filters").notNull();
      table.bool("default_view").notNull().default(sql`false`);
      table.unique(["user_id", "name"]);
    });

    system.db.table("maintenance_report_subscriptions", (table) => {
      table.fk("user_id", "sys_users").notNull().onDelete("Cascade");
      table.string("name", 200).notNull();
      table.enum("report_type", "maintenance_report_type").notNull();
      table.enum("cadence", "maintenance_report_cadence").notNull();
      table.fk("location_id", "locations").onDelete("SetToNull");
      table.email("delivery_email").notNull();
      table.timestampUtc("next_delivery_at");
      table.bool("enabled").notNull().default(sql`true`);
      table.unique(["user_id", "name"]);
    });
  }

  private registerReportIssueProcedure() {
    system.storedProcedure({
      name: "maintenance_report_issue",
      transaction: "caller",
      inputScalars: [
        { name: "p_equipment_id", type: "BigInt" },
        { name: "p_location_id", type: "BigInt" },
        {
          name: "p_priority",
          type: { type: "Enum", enum: "maintenance_priority" },
        },
        { name: "p_title", type: { type: "String", maxLength: 300 } },
        { name: "p_description", type: { type: "String", maxLength: 4000 } },
        { name: "p_discovery", type: { type: "String", maxLength: 160 } },
        { name: "p_symptom", type: { type: "String", maxLength: 240 } },
        {
          name: "p_maintenance_organization",
          type: { type: "String", maxLength: 120 },
        },
        { name: "p_create_work_request", type: "Bool" },
        {
          name: "p_operability",
          type: { type: "Enum", enum: "equipment_operability" },
        },
        { name: "p_effective_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      outputScalars: [
        { name: "p_issue_id", type: "BigInt" },
        { name: "p_work_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.throwErrorIf(
          sql`(p_equipment_id is null and p_location_id is null) or (p_equipment_id is not null and p_location_id is not null)`,
          sql.lit`Choose one equipment item or one location.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_title), '') is null or nullif(trim(p_description), '') is null`,
          sql.lit`Describe what happened before submitting.`,
        );
        s.defScalar(
          "existing_issue_id",
          sql`(select aggregate_id from db.events where idempotency_key = p_idempotency_key and aggregate_type = 'maintenance_issue' limit 1)`,
        );
        s.if(sql`existing_issue_id is not null`, (s) => {
          s.setScalar("p_issue_id", sql`existing_issue_id`);
          s.setScalar(
            "p_work_id",
            sql`(select link.maintenance_work_id from db.maintenance_issue_work link where link.maintenance_issue_id = p_issue_id order by link.id limit 1)`,
          );
        }).else((s) => {
          s.modify(sql`
            insert into db.maintenance_issues (
              equipment_id, location_id, priority, title, description,
              discovery, symptom, reported_by_user_id, effective_at
            ) values (
              p_equipment_id, p_location_id, p_priority, trim(p_title),
              trim(p_description), nullif(trim(p_discovery), ''),
              nullif(trim(p_symptom), ''), p_actor_user_id, p_effective_at
            ) returning id into p_issue_id
          `);
          s.modify(sql`
            update db.maintenance_issues
            set number = 'MI-' || lpad(cast(p_issue_id as string), 5, '0')
            where id = p_issue_id
          `);
          s.defScalar("issue_correlation_id", sql`gen_random_uuid()`);
          this.opts.events.emit(s, {
            aggregateType: "maintenance_issue",
            aggregateId: sql`p_issue_id`,
            eventType: "maintenance.issue_reported",
            effectiveAt: sql`p_effective_at`,
            actorUserId: sql`p_actor_user_id`,
            idempotencyKey: sql`p_idempotency_key`,
            correlationId: sql`issue_correlation_id`,
            summary: sql`'Problem reported: ' || trim(p_title)`,
            payload:
              sql`json_build_object('equipment_id', p_equipment_id, 'location_id', p_location_id, 'priority', cast(p_priority as string), 'description', trim(p_description))`,
            intoEventId: "issue_reported_event_id",
          });
          s.if(
            sql`p_equipment_id is not null and p_operability is not null`,
            (s) => {
              s.defRecord(
                "reported_equipment",
                sql`select display_name, operability from db.equipment where id = p_equipment_id`,
              );
              s.modify(sql`
              update db.equipment
              set operability = p_operability
              where id = p_equipment_id
            `);
              this.opts.events.emit(s, {
                aggregateType: "equipment",
                aggregateId: sql`p_equipment_id`,
                eventType: "equipment.operability_changed",
                effectiveAt: sql`p_effective_at`,
                actorUserId: sql`p_actor_user_id`,
                correlationId: sql`issue_correlation_id`,
                causationEventId: sql`issue_reported_event_id`,
                summary:
                  sql`reported_equipment.display_name || ' marked ' || cast(p_operability as string)`,
                payload:
                  sql`json_build_object('from', cast(reported_equipment.operability as string), 'to', cast(p_operability as string), 'reason', trim(p_description), 'maintenance_issue_id', p_issue_id)`,
                bindings: [{
                  recordType: "maintenance_issue",
                  recordId: sql`p_issue_id`,
                  role: "cause",
                }],
                intoEventId: "reported_operability_event_id",
              });
            },
          );
          s.if(sql`coalesce(p_create_work_request, false)`, (s) => {
            s.modify(sql`
              insert into db.maintenance_work (
                status, work_type, priority, title, description,
                reported_by_user_id, maintenance_organization,
                operational_impact, created_at
              ) values (
                'planned', 'corrective', p_priority, trim(p_title),
                trim(p_description), p_actor_user_id,
                nullif(trim(p_maintenance_organization), ''),
                case
                  when p_operability = 'unavailable' then 'full'
                  when p_operability = 'degraded' then 'partial'
                  else 'none'
                end,
                now()
              ) returning id into p_work_id
            `);
            s.modify(sql`
              update db.maintenance_work
              set number = 'MW-' || lpad(cast(p_work_id as string), 5, '0')
              where id = p_work_id
            `);
            s.modify(sql`
              insert into db.maintenance_work_targets (
                maintenance_work_id, equipment_id, location_id
              ) values (p_work_id, p_equipment_id, p_location_id)
            `);
            s.modify(sql`
              insert into db.maintenance_issue_work (
                maintenance_issue_id, maintenance_work_id
              ) values (p_issue_id, p_work_id)
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_created",
              effectiveAt: sql`p_effective_at`,
              actorUserId: sql`p_actor_user_id`,
              correlationId: sql`issue_correlation_id`,
              causationEventId: sql`issue_reported_event_id`,
              summary: sql`'Work request created: ' || trim(p_title)`,
              payload:
                sql`json_build_object('maintenance_issue_id', p_issue_id, 'maintenance_organization', nullif(trim(p_maintenance_organization), ''))`,
              bindings: [{
                recordType: "maintenance_issue",
                recordId: sql`p_issue_id`,
                role: "source_issue",
              }],
              intoEventId: "reported_work_created_event_id",
            });
          });
        });
      },
    });
  }

  private registerReleaseWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_release_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_assigned_to_user_id", type: "BigInt" },
        { name: "p_target_complete_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "releasing_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`releasing_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`releasing_work.status not in ('planned', 'ready', 'blocked')`,
          sql
            .lit`Only a work request, released or blocked item can be assigned.`,
        );
        s.throwErrorIf(
          sql`p_assigned_to_user_id is null`,
          sql.lit`Assign someone before releasing the work.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'ready', assigned_to_user_id = p_assigned_to_user_id,
                  target_complete_at = coalesce(p_target_complete_at, target_complete_at),
                  blocked_reason = null
              where id = p_work_id
            `);
            s.modify(sql`
              update db.maintenance_issues
              set status = 'triaged'
              where id in (
                select maintenance_issue_id from db.maintenance_issue_work
                where maintenance_work_id = p_work_id
              ) and status = 'reported'
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_released",
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(releasing_work.number || ' · ', '') || releasing_work.title || ' assigned and released'`,
              payload:
                sql`json_build_object('assigned_to_user_id', p_assigned_to_user_id, 'target_complete_at', p_target_complete_at)`,
              intoEventId: "work_released_event_id",
            });
          },
        );
      },
    });
  }

  private registerStartWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_start_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_started_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "starting_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`starting_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`starting_work.status not in ('ready', 'in_progress')`,
          sql.lit`This work cannot be started from its current state.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'in_progress',
                  assigned_to_user_id = coalesce(assigned_to_user_id, p_actor_user_id),
                  actual_started_at = coalesce(actual_started_at, p_started_at)
              where id = p_work_id
            `);
            s.if(
              sql`not exists(select 1 from db.maintenance_work_sessions where maintenance_work_id = p_work_id and ended_at is null)`,
              (s) =>
                s.modify(sql`
                insert into db.maintenance_work_sessions (
                  maintenance_work_id, user_id, started_at
                ) values (p_work_id, p_actor_user_id, p_started_at)
              `),
            );
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_started",
              effectiveAt: sql`p_started_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(starting_work.number || ' · ', '') || starting_work.title || ' started'`,
              payload:
                sql`json_build_object('started_by_user_id', p_actor_user_id)`,
              intoEventId: "work_started_event_id",
            });
          },
        );
      },
    });
  }

  private registerBlockWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_block_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_reason", type: { type: "String", maxLength: 2000 } },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_effective_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "blocking_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`blocking_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`blocking_work.status not in ('ready', 'in_progress')`,
          sql.lit`Only released or started work can be blocked.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_reason), '') is null`,
          sql.lit`Explain what the work is waiting for.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'blocked', blocked_reason = trim(p_reason)
              where id = p_work_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_blocked",
              effectiveAt: sql`p_effective_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(blocking_work.number || ' · ', '') || blocking_work.title || ' blocked'`,
              payload: sql`json_build_object('reason', trim(p_reason))`,
              intoEventId: "work_blocked_event_id",
            });
          },
        );
      },
    });
  }

  private registerRecordWorkStepProcedure() {
    system.storedProcedure({
      name: "maintenance_record_work_step",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_step_id", type: "BigInt" },
        {
          name: "p_result",
          type: { type: "Enum", enum: "maintenance_step_result" },
        },
        {
          name: "p_response_number",
          type: { type: "Decimal", precision: 18, scale: 4, signed: true },
        },
        { name: "p_response_text", type: { type: "String", maxLength: 2000 } },
        { name: "p_notes", type: { type: "String", maxLength: 2000 } },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_completed_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "recording_step",
          sql`
            select step.id, step.maintenance_work_id, step.prompt,
              step.response_type, work.status
            from db.maintenance_work_steps step
            join db.maintenance_work work on work.id = step.maintenance_work_id
            where step.id = p_work_step_id
          `,
        );
        s.throwErrorIf(
          sql`recording_step.id is null`,
          sql.lit`Checklist item was not found.`,
        );
        s.throwErrorIf(
          sql`recording_step.status not in ('ready', 'in_progress', 'blocked')`,
          sql.lit`This checklist can no longer be changed.`,
        );
        s.throwErrorIf(
          sql`recording_step.response_type in ('pass_fail', 'acknowledgement') and p_result is null`,
          sql.lit`Choose a result for this checklist item.`,
        );
        s.throwErrorIf(
          sql`recording_step.response_type = 'number' and p_response_number is null`,
          sql.lit`Enter the requested reading.`,
        );
        s.throwErrorIf(
          sql`recording_step.response_type = 'text' and nullif(trim(p_response_text), '') is null`,
          sql.lit`Enter the requested response.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work_steps
              set result = p_result,
                  response_number = p_response_number,
                  response_text = nullif(trim(p_response_text), ''),
                  notes = nullif(trim(p_notes), ''),
                  completed_by_user_id = p_actor_user_id,
                  completed_at = p_completed_at
              where id = p_work_step_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`recording_step.maintenance_work_id`,
              eventType: "maintenance.checklist_updated",
              effectiveAt: sql`p_completed_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`'Checklist: ' || recording_step.prompt || ' · ' || coalesce(initcap(replace(cast(p_result as string), '_', ' ')), 'response recorded')`,
              payload:
                sql`json_build_object('work_step_id', p_work_step_id, 'result', cast(p_result as string), 'response_number', p_response_number, 'response_text', nullif(trim(p_response_text), ''), 'notes', nullif(trim(p_notes), ''))`,
              intoEventId: "work_step_event_id",
            });
          },
        );
      },
    });
  }

  private registerPassRemainingWorkStepsProcedure() {
    system.storedProcedure({
      name: "maintenance_pass_remaining_work_steps",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_completed_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "passing_work_steps",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`passing_work_steps.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`passing_work_steps.status not in ('ready', 'in_progress', 'blocked')`,
          sql.lit`This checklist can no longer be changed.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.defScalar(
              "passed_step_count",
              sql`(select count(*) from db.maintenance_work_steps where maintenance_work_id = p_work_id and completed_at is null and response_type in ('pass_fail', 'acknowledgement'))`,
            );
            s.modify(sql`
              update db.maintenance_work_steps
              set result = 'pass', completed_by_user_id = p_actor_user_id,
                  completed_at = p_completed_at
              where maintenance_work_id = p_work_id
                and completed_at is null
                and response_type in ('pass_fail', 'acknowledgement')
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.checklist_updated",
              effectiveAt: sql`p_completed_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`cast(passed_step_count as string) || ' remaining checklist items passed'`,
              payload:
                sql`json_build_object('result', 'pass', 'updated_count', passed_step_count)`,
              intoEventId: "remaining_steps_event_id",
            });
          },
        );
      },
    });
  }

  private registerCompleteWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_complete_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_work_details", type: { type: "String", maxLength: 6000 } },
        {
          name: "p_result_operability",
          type: { type: "Enum", enum: "equipment_operability" },
        },
        { name: "p_duration_minutes", type: "Int" },
        { name: "p_completed_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "completing_work",
          sql`select id, number, title, status, work_type, completed_by_user_id, work_details from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`completing_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`completing_work.status not in ('ready', 'in_progress', 'blocked')`,
          sql.lit`This work cannot be completed from its current state.`,
        );
        s.throwErrorIf(
          sql`(completing_work.work_type not in ('preventive', 'inspection') or exists(select 1 from db.maintenance_work_steps where maintenance_work_id = p_work_id and result in ('attention', 'fail'))) and nullif(trim(p_work_details), '') is null`,
          sql.lit`Briefly describe the work performed.`,
        );
        s.throwErrorIf(
          sql`(completing_work.work_type not in ('preventive', 'inspection') and p_duration_minutes is null) or p_duration_minutes < 0`,
          sql.lit`Enter a valid duration.`,
        );
        s.throwErrorIf(
          sql`exists(select 1 from db.maintenance_work_parts where maintenance_work_id = p_work_id and (used_quantity is null or used_quantity < 0))`,
          sql
            .lit`Record actual quantities for each part, using zero for unused parts.`,
        );
        s.throwErrorIf(
          sql`exists(
            select 1
            from db.maintenance_work_steps step
            where step.maintenance_work_id = p_work_id
              and step.required
              and step.completed_at is null
          )`,
          sql.lit`Complete the required inspection checklist first.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.defScalar("completion_correlation_id", sql`gen_random_uuid()`);
            s.modify(sql`
              update db.maintenance_work
              set status = 'completed',
                  blocked_reason = null,
                  actual_started_at = coalesce(actual_started_at, p_completed_at),
                  actual_completed_at = p_completed_at,
                  work_details = trim(p_work_details),
                  result_operability = p_result_operability,
                  completed_by_user_id = p_actor_user_id
              where id = p_work_id
            `);
            s.modify(sql`
              update db.maintenance_work_targets
              set result = coalesce(result, 'completed'),
                  completed_at = coalesce(completed_at, p_completed_at)
              where maintenance_work_id = p_work_id
            `);
            s.if(
              sql`exists(select 1 from db.maintenance_work_sessions where maintenance_work_id = p_work_id and user_id = p_actor_user_id and ended_at is null)`,
              (s) =>
                s.modify(sql`
                update db.maintenance_work_sessions
                set ended_at = p_completed_at,
                    duration_minutes = p_duration_minutes
                where id = (
                  select id from db.maintenance_work_sessions
                  where maintenance_work_id = p_work_id and user_id = p_actor_user_id and ended_at is null
                  order by started_at desc, id desc limit 1
                )
              `),
            ).else((s) => {
              // A returned closeout corrects this technician's previous visit,
              // rather than counting the same reported labor a second time.
              s.if(
                sql`completing_work.completed_by_user_id = p_actor_user_id and exists(select 1 from db.maintenance_work_sessions where maintenance_work_id = p_work_id and user_id = p_actor_user_id)`,
                (s) =>
                  s.modify(sql`
                  update db.maintenance_work_sessions
                  set duration_minutes = p_duration_minutes
                  where id = (select id from db.maintenance_work_sessions where maintenance_work_id = p_work_id and user_id = p_actor_user_id order by id desc limit 1)
                `),
              ).else((s) =>
                s.if(sql`p_duration_minutes is not null`, (s) =>
                  s.modify(sql`
              insert into db.maintenance_work_sessions (
                maintenance_work_id, user_id, started_at, ended_at, duration_minutes
              ) values (
                p_work_id, p_actor_user_id, p_completed_at, p_completed_at,
                p_duration_minutes
              )
            `))
              );
            });
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_completed",
              effectiveAt: sql`p_completed_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              correlationId: sql`completion_correlation_id`,
              summary:
                sql`coalesce(completing_work.number || ' · ', '') || completing_work.title || ' completed'`,
              payload:
                sql`json_build_object('work_details', trim(p_work_details), 'duration_minutes', p_duration_minutes, 'result_operability', cast(p_result_operability as string))`,
              intoEventId: "work_completed_event_id",
            });
            s.forEachQuery(
              sql`select equipment_id from db.maintenance_work_targets where maintenance_work_id = p_work_id and equipment_id is not null`,
              "completed_target",
              (s) => {
                s.if(sql`p_result_operability is not null`, (s) => {
                  s.defRecord(
                    "completed_equipment",
                    sql`select display_name, operability from db.equipment where id = completed_target.equipment_id`,
                  );
                  s.modify(sql`
                    update db.equipment
                    set operability = p_result_operability
                    where id = completed_target.equipment_id
                  `);
                  this.opts.events.emit(s, {
                    aggregateType: "equipment",
                    aggregateId: sql`completed_target.equipment_id`,
                    eventType: "equipment.operability_changed",
                    effectiveAt: sql`p_completed_at`,
                    actorUserId: sql`p_actor_user_id`,
                    correlationId: sql`completion_correlation_id`,
                    causationEventId: sql`work_completed_event_id`,
                    summary:
                      sql`completed_equipment.display_name || ' marked ' || cast(p_result_operability as string)`,
                    payload:
                      sql`json_build_object('from', cast(completed_equipment.operability as string), 'to', cast(p_result_operability as string), 'maintenance_work_id', p_work_id)`,
                    bindings: [{
                      recordType: "maintenance_work",
                      recordId: sql`p_work_id`,
                      role: "cause",
                    }],
                    intoEventId: "completion_operability_event_id",
                  });
                });
              },
            );
            s.modify(sql`
              update db.maintenance_work_parts
              set consumed_at = p_completed_at
              where maintenance_work_id = p_work_id
                and coalesce(used_quantity, 0) > 0
                and consumed_at is null
            `);
          },
        );
      },
    });
  }

  private registerReviewWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_review_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_review_notes", type: { type: "String", maxLength: 2000 } },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_reviewed_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "reviewing_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`reviewing_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`reviewing_work.status != 'completed'`,
          sql.lit`Only Work Done items can be reported after review.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'reviewed', reviewed_at = p_reviewed_at,
                  reviewed_by_user_id = p_actor_user_id,
                  review_notes = nullif(trim(p_review_notes), '')
              where id = p_work_id
            `);
            // Administrative work review is not evidence confirming a diagnosis.
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_reviewed",
              effectiveAt: sql`p_reviewed_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(reviewing_work.number || ' · ', '') || reviewing_work.title || ' reviewed and reported'`,
              payload:
                sql`json_build_object('review_notes', nullif(trim(p_review_notes), ''))`,
              intoEventId: "work_reviewed_event_id",
            });
          },
        );
      },
    });
  }

  private registerReturnWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_return_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_reason", type: { type: "String", maxLength: 2000 } },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_returned_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "returning_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`returning_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`returning_work.status not in ('completed', 'reviewed')`,
          sql.lit`Only completed or reported work can be returned.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_reason), '') is null`,
          sql.lit`Explain what must be corrected.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'in_progress', review_notes = trim(p_reason),
                  reviewed_at = null, reviewed_by_user_id = null,
                  actual_completed_at = null
              where id = p_work_id
            `);
            // Returning work for correction does not rewrite diagnostic evidence.
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_returned",
              effectiveAt: sql`p_returned_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(returning_work.number || ' · ', '') || returning_work.title || ' returned for correction'`,
              payload: sql`json_build_object('reason', trim(p_reason))`,
              intoEventId: "work_returned_event_id",
            });
          },
        );
      },
    });
  }

  private registerVerifyWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_verify_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_verified_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "verifying_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`verifying_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`verifying_work.status != 'reviewed'`,
          sql.lit`Only manager-reviewed work can be finished.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'verified', verified_at = p_verified_at,
                  verified_by_user_id = p_actor_user_id
              where id = p_work_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_verified",
              effectiveAt: sql`p_verified_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(verifying_work.number || ' · ', '') || verifying_work.title || ' finished'`,
              payload:
                sql`json_build_object('verified_by_user_id', p_actor_user_id)`,
              intoEventId: "work_verified_event_id",
            });
            s.forEachQuery(
              sql`
                select issue.id, issue.number, issue.title
                from db.maintenance_issues issue
                join db.maintenance_issue_work link
                  on link.maintenance_issue_id = issue.id
                where link.maintenance_work_id = p_work_id
                  and issue.status not in ('resolved', 'dismissed', 'merged')
                  and not exists (
                    select 1
                    from db.maintenance_issue_work other_link
                    join db.maintenance_work other_work
                      on other_work.id = other_link.maintenance_work_id
                    where other_link.maintenance_issue_id = issue.id
                      and other_link.maintenance_work_id != p_work_id
                      and other_work.status not in ('verified', 'cancelled')
                  )
              `,
              "finished_issue",
              (s) => {
                s.modify(sql`
                  update db.maintenance_issues
                  set status = 'resolved', resolved_at = p_verified_at
                  where id = finished_issue.id
                `);
                this.opts.events.emit(s, {
                  aggregateType: "maintenance_issue",
                  aggregateId: sql`finished_issue.id`,
                  eventType: "maintenance.issue_resolved",
                  effectiveAt: sql`p_verified_at`,
                  actorUserId: sql`p_actor_user_id`,
                  causationEventId: sql`work_verified_event_id`,
                  summary:
                    sql`coalesce(finished_issue.number || ' · ', '') || finished_issue.title || ' resolved'`,
                  payload:
                    sql`json_build_object('maintenance_work_id', p_work_id)`,
                  bindings: [{
                    recordType: "maintenance_work",
                    recordId: sql`p_work_id`,
                    role: "resolution",
                  }],
                  intoEventId: "issue_resolved_event_id",
                });
              },
            );
          },
        );
      },
    });
  }

  private registerCancelWorkProcedure() {
    system.storedProcedure({
      name: "maintenance_cancel_work",
      transaction: "caller",
      inputScalars: [
        { name: "p_work_id", type: "BigInt" },
        { name: "p_reason", type: { type: "String", maxLength: 2000 } },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_cancelled_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "cancelling_work",
          sql`select id, number, title, status from db.maintenance_work where id = p_work_id`,
        );
        s.throwErrorIf(
          sql`cancelling_work.id is null`,
          sql.lit`Work was not found.`,
        );
        s.throwErrorIf(
          sql`cancelling_work.status in ('verified', 'cancelled')`,
          sql.lit`Finished or cancelled work cannot be cancelled.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_reason), '') is null`,
          sql.lit`Record why the work is being cancelled.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_work
              set status = 'cancelled', cancellation_reason = trim(p_reason),
                  cancelled_at = p_cancelled_at,
                  cancelled_by_user_id = p_actor_user_id
              where id = p_work_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_work",
              aggregateId: sql`p_work_id`,
              eventType: "maintenance.work_cancelled",
              effectiveAt: sql`p_cancelled_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`coalesce(cancelling_work.number || ' · ', '') || cancelling_work.title || ' cancelled'`,
              payload: sql`json_build_object('reason', trim(p_reason))`,
              intoEventId: "work_cancelled_event_id",
            });
          },
        );
      },
    });
  }

  private registerActivateProgramProcedure() {
    system.storedProcedure({
      name: "maintenance_activate_program_revision",
      transaction: "caller",
      inputScalars: [
        { name: "p_revision_id", type: "BigInt" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_activated_at", type: "TimestampTz" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "activating_revision",
          sql`
            select revision.id, revision.maintenance_program_id,
              revision.revision_no, revision.status, program.name
            from db.maintenance_program_revisions revision
            join db.maintenance_programs program
              on program.id = revision.maintenance_program_id
            where revision.id = p_revision_id
          `,
        );
        s.throwErrorIf(
          sql`activating_revision.id is null`,
          sql.lit`Program revision was not found.`,
        );
        s.throwErrorIf(
          sql`activating_revision.status != 'proposed'`,
          sql.lit`Only a proposed revision can be activated.`,
        );
        s.throwErrorIf(
          sql`not exists(select 1 from db.maintenance_rules where maintenance_program_revision_id = p_revision_id)`,
          sql.lit`Add at least one maintenance rule before activation.`,
        );
        s.throwErrorIf(
          sql`exists(select 1 from db.maintenance_rules where maintenance_program_revision_id = p_revision_id and nullif(trim(source_document), '') is null)`,
          sql.lit`Every proposed rule needs source evidence before activation.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.maintenance_program_revisions
              set status = 'superseded'
              where maintenance_program_id = activating_revision.maintenance_program_id
                and status = 'active'
            `);
            s.modify(sql`
              update db.maintenance_program_revisions
              set status = 'active', activated_at = p_activated_at,
                  activated_by_user_id = p_actor_user_id
              where id = p_revision_id
            `);
            s.modify(sql`
              update db.maintenance_programs
              set status = 'active'
              where id = activating_revision.maintenance_program_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "maintenance_program",
              aggregateId: sql`activating_revision.maintenance_program_id`,
              eventType: "maintenance.program_revision_activated",
              effectiveAt: sql`p_activated_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`activating_revision.name || ' revision ' || activating_revision.revision_no || ' activated'`,
              payload:
                sql`json_build_object('revision_id', p_revision_id, 'revision_no', activating_revision.revision_no)`,
              bindings: [{
                recordType: "maintenance_program_revision",
                recordId: sql`p_revision_id`,
                role: "activated_revision",
              }],
              intoEventId: "revision_activated_event_id",
            });
          },
        );
      },
    });
  }
}

export function MaintenancePriorityChip(
  props: { priority: ReturnType<typeof sql> },
) {
  return (
    <Switch>
      <Match when={sql`${props.priority} = 'emergency'`}>
        <Chip size="sm" color="danger" variant="solid">Emergency</Chip>
      </Match>
      <Match when={sql`${props.priority} = 'high'`}>
        <Chip size="sm" color="danger" variant="soft">High</Chip>
      </Match>
      <Match when={sql`${props.priority} = 'normal'`}>
        <Chip size="sm" color="warning" variant="soft">Normal</Chip>
      </Match>
      <Match when={sql`true`}>
        <Chip size="sm" color="neutral" variant="soft">Low</Chip>
      </Match>
    </Switch>
  );
}

/** Operations-first maintenance inbox; detail views can be supplied by an app. */
export function MaintenanceDashboardPage() {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "maintenance_queue",
          sql`
            select work.id, work.number, work.title, work.status, work.priority,
              work.work_type, work.target_complete_at,
              coalesce(e.display_name, l.name, 'Multiple targets') as target_name,
              e.operability,
              case
                when work.priority = 'emergency' then 400
                when work.priority = 'high' then 300
                when work.priority = 'normal' then 200
                else 100
              end
              + case when e.operability = 'unavailable' then 150 when e.operability = 'degraded' then 75 else 0 end
              + case when work.target_complete_at < now() then 100 else 0 end
              + coalesce(e.criticality, l.criticality, 0) as attention_score
            from db.maintenance_work work
            left join db.maintenance_work_targets target
              on target.id = (select min(t.id) from db.maintenance_work_targets t where t.maintenance_work_id = work.id)
            left join db.equipment e on e.id = target.equipment_id
            left join db.locations l on l.id = target.location_id
            where work.status not in ('verified', 'cancelled')
            order by attention_score desc, work.target_complete_at nulls last, work.id
          `,
        );
      }}
    >
      <div className="flex flex-col gap-3">
        <Show
          when={sql`exists(select 1 from maintenance_queue)`}
          fallback={<Alert color="success">No open maintenance work.</Alert>}
        >
          <Each table="maintenance_queue" recordName="work_row">
            <Card
              variant="outlined"
              className="cursor-pointer p-4"
              onClick={(s) =>
                s.navigate(
                  sql`'/maintenance/work/' || cast(work_row.id as string)`,
                )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Typography level="title-md">
                    {sql`coalesce(work_row.number || ' · ', '') || work_row.title`}
                  </Typography>
                  <Typography level="body-sm" color="neutral">
                    {sql`work_row.target_name || ' · ' || initcap(replace(cast(work_row.status as string), '_', ' '))`}
                  </Typography>
                </div>
                <MaintenancePriorityChip priority={sql`work_row.priority`} />
              </div>
              <Show when={sql`work_row.target_complete_at is not null`}>
                <Typography level="body-xs" color="neutral" className="mt-3">
                  {sql`case when work_row.target_complete_at < now() then 'Overdue · ' else 'Due · ' end || format.date(work_row.target_complete_at, '%b %-d, %Y')`}
                </Typography>
              </Show>
            </Card>
          </Each>
        </Show>
      </div>
    </Data>
  );
}

export function MaintenanceWorkDetailPage() {
  useQueryParams([{ name: "maintenance_work_id", type: { type: "BigInt" } }]);
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "maintenance_work_detail",
          sql`
            select work.*,
              coalesce(e.display_name, l.name, 'Multiple targets') as target_name
            from db.maintenance_work work
            left join db.maintenance_work_targets target
              on target.id = (select min(t.id) from db.maintenance_work_targets t where t.maintenance_work_id = work.id)
            left join db.equipment e on e.id = target.equipment_id
            left join db.locations l on l.id = target.location_id
            where work.id = maintenance_work_id
          `,
        );
        s.defTable(
          "maintenance_work_parts_view",
          sql`select * from db.maintenance_work_parts where maintenance_work_id = maintenance_work_id order by id`,
        );
      }}
    >
      <Show
        when={sql`maintenance_work_detail.id is not null`}
        fallback={<Alert color="danger">Maintenance work was not found.</Alert>}
      >
        <div className="flex flex-col gap-4">
          <Card variant="outlined" className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Typography level="h3">
                  {sql`coalesce(maintenance_work_detail.number || ' · ', '') || maintenance_work_detail.title`}
                </Typography>
                <Typography level="body-md" color="neutral">
                  {sql`maintenance_work_detail.target_name`}
                </Typography>
              </div>
              <MaintenancePriorityChip
                priority={sql`maintenance_work_detail.priority`}
              />
            </div>
            <Typography level="body-md" className="mt-4">
              {sql`coalesce(maintenance_work_detail.description, 'No additional instructions.')`}
            </Typography>
          </Card>
          <Card variant="outlined" className="p-5">
            <Typography level="title-md" startIcon="Inventory2">
              Parts
            </Typography>
            <Show
              when={sql`exists(select 1 from maintenance_work_parts_view)`}
              fallback={
                <Typography level="body-sm" color="neutral" className="mt-3">
                  No parts planned or recorded.
                </Typography>
              }
            >
              <div className="mt-3 flex flex-col gap-2">
                <Each
                  table="maintenance_work_parts_view"
                  recordName="work_part"
                >
                  <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
                    <Typography level="body-sm">
                      {sql`coalesce(work_part.part_number || ' · ', '') || work_part.description`}
                    </Typography>
                    <Typography level="body-sm" className="font-semibold">
                      {sql`coalesce(work_part.used_quantity, work_part.planned_quantity, 0) || ' ' || work_part.unit`}
                    </Typography>
                  </div>
                </Each>
              </div>
            </Show>
          </Card>
        </div>
      </Show>
    </Data>
  );
}
