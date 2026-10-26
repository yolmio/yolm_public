import { UserNotificationsBlock } from "blocks/user_notifications";
import { EquipmentBlock } from "blocks/equipment";
import type { UserNotificationSourceConfig } from "blocks/user_notifications";
import { AuthBlock } from "blocks/auth";
import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";

export interface MaintenanceBlockOptions {
  managePermission: string;
  reportPermission: string;
  /**
   Opt-in: preventive programs may target a location (an area, a building)
   instead of an equipment type. Adds nullable location columns to programs
   and schedules and `maintenance_save_location_program`.
   */
  locationPrograms?: boolean;
  /**
   Opt-in: people doing the work close it themselves, with each worker's
   hours. Managers assign work; assignees (or a manager) close it, and whoever
   reported a problem may close it while nobody is assigned (fixed on the
   spot). Adds `maintenance_item_time_entries`, `maintenance_take_item`
   (managers taking work themselves) and `maintenance_close_item`. Reopening
   stays with managers.
   */
  fieldCloseOut?: boolean;
  /**
   Opt-in, with `fieldCloseOut`: closed work waits for a manager, who approves
   it into history or sends it back to the people who did it. Adds the
   `awaiting_review` status, the `returned` activity and
   `maintenance_review_item`.
   */
  closeOutReview?: boolean;
  /**
   Opt-in: preventive items may exist without a program, for completed work
   history migrated from another system.
   */
  programlessHistory?: boolean;
}

/** One work-item model for reported problems and preventive maintenance. */
export class MaintenanceBlock implements Block {
  blockName = "MaintenanceBlock";
  blockDisplayName = "Maintenance";
  componentDependencies: string[] = [];
  description =
    "Reported problems and preventive maintenance with shared targets, assignees, discussion, and state history.";

  constructor(readonly opts: MaintenanceBlockOptions) {}

  private assignmentNotifications = false;

  activeEquipment(equipment: Sql): Sql {
    return system.block(EquipmentBlock).opts.shopFloor
      ? sql`${equipment}.active`
      : sql`${equipment}.lifecycle = 'in_service'`;
  }

  canManage(userId: Sql): Sql {
    return AuthBlock.userHasPermission(
      sql.lit(this.opts.managePermission),
      userId,
    );
  }

  canAccess(userId: Sql): Sql {
    return sql`(exists(select 1 from db.sys_users where id = ${userId} and not disabled)
      and (${this.canManage(userId)}
        or ${
      AuthBlock.userHasPermission(sql.lit(this.opts.reportPermission), userId)
    }))`;
  }

  /** Publish assignments through the shared Inbox; the consumer owns app routes. */
  notificationSource(
    itemHref: (itemId: Sql) => Sql,
  ): UserNotificationSourceConfig {
    this.assignmentNotifications = true;
    return {
      key: "maintenance.assignment",
      displayName: "Maintenance assignments",
      canUserAccess: ({ userId, recordKey }) =>
        sql`${this.canAccess(userId)}
        and exists(select 1 from db.maintenance_items where id = try_cast(${recordKey} as bigint))`,
      destination: {
        href: (notification) =>
          itemHref(sql`try_cast(${notification}.record_key as bigint)`),
      },
      email: { delivery: "disabled" },
    };
  }

  initialize() {
    system.enum_({
      name: "maintenance_item_kind",
      values: [
        { name: "reported_problem", displayName: "Reported problem" },
        {
          name: "preventive_maintenance",
          displayName: "Preventive maintenance",
        },
      ],
    });
    system.enum_({
      name: "maintenance_item_status",
      values: [
        { name: "open", displayName: "Open" },
        ...(this.opts.closeOutReview
          ? [{ name: "awaiting_review", displayName: "Awaiting review" }]
          : []),
        { name: "completed", displayName: "Completed" },
      ],
    });
    system.enum_({
      name: "maintenance_target_condition",
      values: [
        { name: "degraded", displayName: "Running with a problem" },
        { name: "unavailable", displayName: "Stopped" },
      ],
    });
    system.enum_({
      name: "maintenance_item_activity_type",
      values: [
        { name: "created", displayName: "Created" },
        { name: "assignee_added", displayName: "Assignee added" },
        { name: "assignee_removed", displayName: "Assignee removed" },
        { name: "status_changed", displayName: "Status changed" },
        { name: "target_condition_changed", displayName: "Condition changed" },
        { name: "target_linked", displayName: "Target linked" },
        ...(this.opts.closeOutReview
          ? [{ name: "returned", displayName: "Sent back" }]
          : []),
      ],
    });
    system.enum_({
      name: "maintenance_interval_unit",
      values: [
        { name: "months", displayName: "Months" },
        { name: "days", displayName: "Days" },
      ],
    });
    this.addTables();
  }

  populate() {
    this.registerSetStatusProcedure();
    this.registerSetAssigneesProcedure();
    this.registerSetTargetConditionProcedure();
    this.registerLinkGeneralReportProcedure();
    this.registerDueItemsProcedure();
    this.registerReconcileSchedulesProcedure();
    this.registerSaveProgramProcedure();
    this.registerSetProgramActiveProcedure();
    if (this.opts.locationPrograms) this.registerSaveLocationProgramProcedure();
    if (this.opts.fieldCloseOut) {
      this.registerTakeItemProcedure();
      this.registerCloseItemProcedure();
    }
    if (this.opts.closeOutReview) this.registerReviewItemProcedure();
    system.scheduledProc({
      name: "maintenance_generate_due_items",
      schedule: "0 0 * * * *",
      procedure: (s) => {
        s.startTransaction();
        s.callStoredProcedure("maintenance_generate_due_items");
        s.commitTransaction();
      },
    });
  }

  private addTables() {
    const locationPrograms = this.opts.locationPrograms ?? false;
    system.db.table("maintenance_programs", (table) => {
      const definition = table.fk("equipment_definitions").onDelete("Restrict");
      if (!locationPrograms) definition.notNull();
      table.string("name", 240).notNull();
      table.string("instructions", 6000).notNull().multiline();
      table.smallUint("interval_value").renameFrom("interval_months").notNull();
      table.enum("interval_unit", "maintenance_interval_unit").notNull()
        .default(sql.lit`months`);
      table.bool("active").notNull().default(sql`true`);
      table.unique(["equipment_definition_id", "name"]);
      if (locationPrograms) {
        table.fk("location_id", "locations").onDelete("Restrict");
        table.unique(["location_id", "name"]);
        table.check({
          fields: ["equipment_definition_id", "location_id"],
          check: ([definition, location]) =>
            sql`(${definition} is null) <> (${location} is null)`,
          errorMessage: () =>
            sql.lit`A program covers an equipment type or a location.`,
        });
      }
      table.check({
        fields: ["interval_value"],
        check: ([value]) => sql`${value} > 0`,
        errorMessage: () =>
          sql.lit`The maintenance interval must be greater than zero.`,
      });
      table.recordDisplayName(["name"], (name) => name);
    });
    system.db.table("equipment_maintenance_schedules", (table) => {
      table.fk("maintenance_programs").notNull().onDelete("Cascade");
      const equipment = table.fk("equipment").onDelete("Cascade");
      if (!locationPrograms) equipment.notNull();
      table.date("next_due_on").notNull();
      // A location program has one schedule with no unit; its location is
      // the program's.
      table.unique(["maintenance_program_id", "equipment_id"]);
    });
    system.db.table("maintenance_items", (table) => {
      table.enum("kind", "maintenance_item_kind").notNull();
      table.enum("status", "maintenance_item_status").notNull().default(
        sql.lit`open`,
      );
      table.string("title", 300).notNull();
      table.fk("maintenance_program_id", "maintenance_programs").onDelete(
        "Restrict",
      );
      table.check({
        fields: ["kind", "maintenance_program_id"],
        check: ([kind, program]) =>
          this.opts.programlessHistory
            ? sql`${kind} = 'preventive_maintenance'
              or (${kind} = 'reported_problem' and ${program} is null)`
            : sql`(${kind} = 'preventive_maintenance' and ${program} is not null)
              or (${kind} = 'reported_problem' and ${program} is null)`,
        errorMessage: () =>
          sql.lit`Preventive maintenance requires a maintenance program.`,
      });
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.fk("created_by_user_id", "sys_users").onDelete("SetToNull");
      table.recordDisplayName(["title"], (title) => title);
    });
    if (this.opts.fieldCloseOut) {
      // One row per person who worked on the item.
      system.db.table("maintenance_item_time_entries", (table) => {
        table.fk("maintenance_item_id", "maintenance_items").notNull()
          .onDelete("Cascade");
        table.fk("sys_user_id", "sys_users").notNull().onDelete("Restrict");
        table.uint("minutes").notNull();
        table.fk("entered_by_user_id", "sys_users").onDelete("SetToNull");
        table.unique(["maintenance_item_id", "sys_user_id"]);
      });
    }
    system.db.table("maintenance_item_targets", (table) => {
      table.fk("maintenance_item_id", "maintenance_items").notNull().onDelete(
        "Cascade",
      );
      table.fk("equipment_id", "equipment").onDelete("Restrict");
      table.fk("location_id", "locations").onDelete("Restrict");
      table.fk(
        "equipment_maintenance_schedule_id",
        "equipment_maintenance_schedules",
      ).onDelete("Restrict");
      table.enum("condition", "maintenance_target_condition");
      table.date("due_on");
      table.check({
        fields: ["equipment_id", "location_id"],
        check: ([equipment, location]) =>
          sql`(${equipment} is not null and ${location} is null)
            or (${equipment} is null and ${location} is not null)`,
        errorMessage: () => sql.lit`Choose one equipment item or one location.`,
      });
      table.unique(["maintenance_item_id", "equipment_id"]);
      table.unique(["maintenance_item_id", "location_id"]);
      table.unique([
        "maintenance_item_id",
        "equipment_maintenance_schedule_id",
      ]);
    });
    system.db.table("maintenance_item_assignees", (table) => {
      table.fk("maintenance_item_id", "maintenance_items").notNull().onDelete(
        "Cascade",
      );
      table.fk("sys_user_id", "sys_users").notNull().onDelete("Restrict");
      table.unique(["maintenance_item_id", "sys_user_id"]);
    });
    system.db.table("maintenance_item_activities", (table) => {
      table.fk("maintenance_item_id", "maintenance_items").notNull().onDelete(
        "Cascade",
      );
      table.enum("activity_type", "maintenance_item_activity_type").notNull();
      table.fk("actor_user_id", "sys_users").onDelete("SetToNull");
      table.fk("target_id", "maintenance_item_targets").onDelete("SetToNull");
      table.fk("related_user_id", "sys_users").onDelete("SetToNull");
      table.string("new_value", 120);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
    });
  }

  private requireManager(s: GeneralServerStatements, actor: Sql) {
    s.throwErrorIf(
      sql`not ${
        AuthBlock.userHasPermission(sql.lit(this.opts.managePermission), actor)
      }`,
      sql.lit`Maintenance management permission is required.`,
    );
  }

  /**
   Status change on `p_item_id` by `p_actor_user_id`: to the `p_status` scalar,
   or straight to completed when `completing` is set.
   */
  private changeStatus(
    s: GeneralServerStatements,
    completing = false,
    completedStatus: "completed" | "awaiting_review" = "completed",
  ) {
    const status = completing ? sql.lit(completedStatus) : sql`p_status`;
    s.defRecord(
      "changed_item",
      sql`select * from db.maintenance_items where id = p_item_id`,
    );
    s.throwErrorIf(
      sql`changed_item.id is null`,
      sql.lit`Maintenance item not found.`,
    );
    s.returnIf(sql`changed_item.status = ${status}`);
    const complete = (s: GeneralServerStatements) =>
      s.modify(sql`update db.equipment_maintenance_schedules schedule
        set next_due_on = cast(current_date() + case program.interval_unit
          when 'days' then interval '1 day' * program.interval_value
          else interval '1 month' * program.interval_value end as date)
        from db.maintenance_programs program
        where program.id = changed_item.maintenance_program_id
          and schedule.id in (select equipment_maintenance_schedule_id from completion_targets)`);
    const reopen = (s: GeneralServerStatements) => {
      s.throwErrorIf(
        sql`exists(select 1 from db.maintenance_item_targets later
        join completion_targets target
          on target.equipment_maintenance_schedule_id = later.equipment_maintenance_schedule_id
        where later.maintenance_item_id > p_item_id)`,
        sql
          .lit`A later maintenance cycle exists. Add a follow-up instead of reopening this cycle.`,
      );
      s.modify(sql`update db.equipment_maintenance_schedules schedule
        set next_due_on = target.due_on from completion_targets target
        where schedule.id = target.equipment_maintenance_schedule_id`);
    };
    s.if(sql`changed_item.kind = 'preventive_maintenance'`, (s) => {
      s.defTable(
        "completion_targets",
        sql`select * from db.maintenance_item_targets
        where maintenance_item_id = p_item_id`,
      );
      s.throwErrorIf(
        sql`not exists(select 1 from completion_targets)`,
        sql.lit`This maintenance item has no equipment.`,
      );
      if (completing) complete(s);
      else s.if(sql`p_status = 'completed'`, complete).else(reopen);
    });
    s.modify(sql`update db.maintenance_items set status = ${status}
      where id = p_item_id`);
    s.modify(sql`insert into db.maintenance_item_activities
      (maintenance_item_id, activity_type, actor_user_id, new_value)
      values (p_item_id, 'status_changed', p_actor_user_id, ${
      completing ? sql.lit(completedStatus) : sql`cast(p_status as string)`
    })`);
  }

  private registerSetStatusProcedure() {
    system.storedProcedure({
      name: "maintenance_set_item_status",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        {
          name: "p_status",
          type: { type: "Enum", enum: "maintenance_item_status" },
        },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        // Reporters report and comment; field close-out has its own
        // assignment, time and review rules for closing work.
        if (!this.opts.fieldCloseOut) {
          s.throwErrorUnless(
            this.canAccess(sql`p_actor_user_id`),
            sql.lit`Maintenance access is required.`,
          );
        }
        this.requireManager(s, sql`p_actor_user_id`);
        this.changeStatus(s);
      },
    });
  }

  private registerSetAssigneesProcedure() {
    system.storedProcedure({
      name: "maintenance_set_item_assignees",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        { name: "p_user_ids", type: "Json" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.throwErrorIf(
          sql`not exists(select 1 from db.maintenance_items where id = p_item_id)`,
          sql.lit`Maintenance item not found.`,
        );
        s.defTable(
          "chosen_assignees",
          sql`select distinct try_cast(value #>> '{}' as bigint) as user_id
            from json.array_each(p_user_ids)`,
        );
        s.throwErrorIf(
          sql`coalesce(json_typeof(p_user_ids), '') <> 'array'
            or exists(select 1 from chosen_assignees where user_id is null)
            or (select count(*) from chosen_assignees) > 50
            or exists(select 1 from chosen_assignees chosen
              where not exists(select 1 from db.sys_users app_user where app_user.id = chosen.user_id and ${
            this.canAccess(sql`app_user.id`)
          }))`,
          sql.lit`Choose valid assignees.`,
        );
        if (this.assignmentNotifications) {
          s.defTable(
            "added_assignees",
            sql`select user_id from chosen_assignees chosen
            where not exists(select 1 from db.maintenance_item_assignees existing
              where existing.maintenance_item_id = p_item_id and existing.sys_user_id = chosen.user_id)`,
          );
        }
        s.modify(sql`insert into db.maintenance_item_activities
          (maintenance_item_id, activity_type, actor_user_id, related_user_id)
          select p_item_id, 'assignee_removed', p_actor_user_id, existing.sys_user_id
          from db.maintenance_item_assignees existing
          where existing.maintenance_item_id = p_item_id
            and existing.sys_user_id not in (select user_id from chosen_assignees)`);
        s.modify(sql`insert into db.maintenance_item_activities
          (maintenance_item_id, activity_type, actor_user_id, related_user_id)
          select p_item_id, 'assignee_added', p_actor_user_id, chosen.user_id
          from chosen_assignees chosen
          where not exists(select 1 from db.maintenance_item_assignees existing
            where existing.maintenance_item_id = p_item_id
              and existing.sys_user_id = chosen.user_id)`);
        s.modify(sql`delete from db.maintenance_item_assignees
          where maintenance_item_id = p_item_id
            and sys_user_id not in (select user_id from chosen_assignees)`);
        s.modify(sql`insert into db.maintenance_item_assignees
          (maintenance_item_id, sys_user_id)
          select p_item_id, user_id from chosen_assignees
          on conflict (maintenance_item_id, sys_user_id) do nothing`);
        s.modify(sql`insert into db.comment_thread_subscriptions
          (comment_thread_id, sys_user_id)
          select thread.id, chosen.user_id
          from chosen_assignees chosen
          join db.comment_threads thread on thread.maintenance_item_id = p_item_id
          on conflict (comment_thread_id, sys_user_id) do nothing`);
        if (this.assignmentNotifications) {
          system.block(UserNotificationsBlock).source("maintenance.assignment")
            .publish(s, {
              recordKey: sql`p_item_id`,
              recipientsQuery:
                sql`select user_id as recipient_user_id from added_assignees where user_id <> p_actor_user_id`,
              title:
                sql`'Assigned to #' || (p_item_id + 1) || ': ' || (select title from db.maintenance_items where id = p_item_id)`,
            });
        }
      },
    });
  }

  private registerSetTargetConditionProcedure() {
    system.storedProcedure({
      name: "maintenance_set_target_condition",
      transaction: "caller",
      inputScalars: [
        { name: "p_target_id", type: "BigInt" },
        {
          name: "p_condition",
          type: { type: "Enum", enum: "maintenance_target_condition" },
        },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.defRecord(
          "changed_target",
          sql`select target.*, item.status as item_status
            from db.maintenance_item_targets target
            join db.maintenance_items item on item.id = target.maintenance_item_id
            where target.id = p_target_id`,
        );
        s.throwErrorIf(
          sql`changed_target.id is null or changed_target.equipment_id is null
            or changed_target.item_status <> 'open'`,
          sql.lit`Equipment target not found.`,
        );
        s.returnIf(
          sql`changed_target.condition is not distinct from p_condition`,
        );
        s.modify(
          sql`update db.maintenance_item_targets set condition = p_condition where id = p_target_id`,
        );
        s.modify(sql`insert into db.maintenance_item_activities
          (maintenance_item_id, activity_type, actor_user_id, target_id, new_value)
          values (changed_target.maintenance_item_id, 'target_condition_changed',
            p_actor_user_id, p_target_id, cast(p_condition as string))`);
      },
    });
  }

  private registerLinkGeneralReportProcedure() {
    system.storedProcedure({
      name: "maintenance_link_general_report",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        { name: "p_equipment_id", type: "BigInt" },
        { name: "p_location_id", type: "BigInt" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.throwErrorIf(
          sql`not exists(select 1 from db.maintenance_items item
            where item.id = p_item_id and item.kind = 'reported_problem'
              and item.status = 'open')
            or exists(select 1 from db.maintenance_item_targets
              where maintenance_item_id = p_item_id)`,
          sql.lit`Only open general reports can be linked.`,
        );
        s.throwErrorIf(
          sql`(p_equipment_id is null and p_location_id is null)
            or (p_equipment_id is not null and p_location_id is not null)
            or (p_equipment_id is not null and not exists(
              select 1 from db.equipment equipment where id = p_equipment_id
                and ${
            system.block(EquipmentBlock).opts.shopFloor
              ? sql`equipment.active`
              : sql`true`
          }))
            or (p_location_id is not null and not exists(
              select 1 from db.locations where id = p_location_id and active))`,
          sql.lit`Choose one active equipment item or location.`,
        );
        s.modify(sql`insert into db.maintenance_item_targets
          (maintenance_item_id, equipment_id, location_id)
          values (p_item_id, p_equipment_id, p_location_id)`);
        s.modify(sql`insert into db.maintenance_item_activities
          (maintenance_item_id, activity_type, actor_user_id, new_value)
          values (p_item_id, 'target_linked', p_actor_user_id,
            coalesce((select display_name from db.equipment where id = p_equipment_id),
              (select name from db.locations where id = p_location_id)))`);
      },
    });
  }

  private registerReconcileSchedulesProcedure() {
    system.storedProcedure({
      name: "maintenance_reconcile_equipment_schedules",
      transaction: "caller",
      inputScalars: [{ name: "p_equipment_id", type: "BigInt" }, {
        name: "p_actor_user_id",
        type: "BigInt",
      }],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.modify(sql`insert into db.equipment_maintenance_schedules
          (maintenance_program_id, equipment_id, next_due_on)
          select program.id as program_id, equipment.id as equipment_id,
            cast(current_date() + case program.interval_unit
              when 'days' then interval '1 day' * program.interval_value
              else interval '1 month' * program.interval_value end as date)
          from db.equipment equipment
          join db.maintenance_programs program on program.equipment_definition_id = equipment.equipment_definition_id
          where equipment.id = p_equipment_id and ${
          this.activeEquipment(sql`equipment`)
        } and program.active
            and not exists(select 1 from db.equipment_maintenance_schedules schedule
              where schedule.equipment_id = equipment.id and schedule.maintenance_program_id = program.id)
          on conflict (maintenance_program_id, equipment_id) do nothing`);
      },
    });
  }

  /** Create or edit a type's program and choose which units it schedules. */
  private registerSaveProgramProcedure() {
    system.storedProcedure({
      name: "maintenance_save_program",
      transaction: "caller",
      inputScalars: [
        { name: "p_program_id", type: "BigInt" },
        { name: "p_definition_id", type: "BigInt" },
        { name: "p_name", type: { type: "String", maxLength: 240 } },
        { name: "p_instructions", type: { type: "String", maxLength: 6000 } },
        { name: "p_interval_value", type: "Int" },
        { name: "p_interval_unit", type: { type: "String", maxLength: 20 } },
        // [{ equipment_id, next_due_on }] for every unit the program covers.
        { name: "p_units", type: "Json" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      outputScalars: [{ name: "p_saved_program_id", type: "BigInt" }],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.throwErrorIf(
          sql`p_program_id is not null and not exists(select 1 from db.maintenance_programs
            where id = p_program_id and equipment_definition_id = p_definition_id)`,
          sql.lit`Maintenance program not found.`,
        );
        s.throwErrorIf(
          sql`not exists(select 1 from db.equipment_definitions where id = p_definition_id)`,
          sql.lit`Equipment type not found.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_name), '') is null`,
          sql.lit`Enter a name.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_instructions), '') is null`,
          sql.lit`Enter at least one step.`,
        );
        s.throwErrorIf(
          sql`coalesce(p_interval_value, 0) < 1 or p_interval_value > 999
            or coalesce(p_interval_unit, '') not in ('days', 'months')`,
          sql.lit`Choose how often it repeats.`,
        );
        s.throwErrorIf(
          sql`exists(select 1 from db.maintenance_programs
            where equipment_definition_id = p_definition_id
              and lower(name) = lower(trim(p_name))
              and id is distinct from p_program_id)`,
          sql.lit`This type already has maintenance with that name.`,
        );
        s.defTable(
          "program_units",
          sql`select try_cast(value->>'equipment_id' as bigint) as equipment_id,
            try_cast(value->>'next_due_on' as date) as next_due_on
            from json.array_each(case when json_typeof(p_units) = 'array'
              then p_units else json_build_array() end)`,
        );
        s.throwErrorIf(
          sql`coalesce(json_typeof(p_units), '') <> 'array'
            or exists(select 1 from program_units unit
              where unit.next_due_on is null or not exists(
                select 1 from db.equipment equipment
                where equipment.id = unit.equipment_id
                  and equipment.equipment_definition_id = p_definition_id))
            or (select count(*) from program_units)
              <> (select count(distinct equipment_id) from program_units)`,
          sql.lit`Choose units of this type, each with a due date.`,
        );
        s.if(sql`p_program_id is null`, (s) => {
          s.modify(sql`insert into db.maintenance_programs
            (equipment_definition_id, name, instructions, interval_value, interval_unit)
            values (p_definition_id, trim(p_name), trim(p_instructions),
              p_interval_value, cast(p_interval_unit as enums.maintenance_interval_unit))
            returning id into p_saved_program_id`);
        }).else((s) => {
          s.setScalar("p_saved_program_id", sql`p_program_id`);
          s.modify(sql`update db.maintenance_programs
            set name = trim(p_name), instructions = trim(p_instructions),
              interval_value = p_interval_value,
              interval_unit = cast(p_interval_unit as enums.maintenance_interval_unit)
            where id = p_program_id`);
        });
        // Removed units keep their item history; only the schedule goes.
        s.defTable(
          "removed_schedules",
          sql`select id from db.equipment_maintenance_schedules
            where maintenance_program_id = p_saved_program_id
              and equipment_id not in (select equipment_id from program_units)`,
        );
        s.modify(sql`update db.maintenance_item_targets
          set equipment_maintenance_schedule_id = null
          where equipment_maintenance_schedule_id in (select id from removed_schedules)`);
        s.modify(sql`delete from db.equipment_maintenance_schedules
          where id in (select id from removed_schedules)`);
        s.modify(sql`update db.equipment_maintenance_schedules schedule
          set next_due_on = unit.next_due_on
          from program_units unit
          where schedule.maintenance_program_id = p_saved_program_id
            and schedule.equipment_id = unit.equipment_id
            and schedule.next_due_on <> unit.next_due_on`);
        s.modify(sql`insert into db.equipment_maintenance_schedules
          (maintenance_program_id, equipment_id, next_due_on)
          select p_saved_program_id as maintenance_program_id,
            unit.equipment_id, unit.next_due_on
          from program_units unit
          where not exists(select 1 from db.equipment_maintenance_schedules schedule
            where schedule.maintenance_program_id = p_saved_program_id
              and schedule.equipment_id = unit.equipment_id)`);
      },
    });
  }

  /** A location program has one schedule on its location. Opt-in. */
  private registerSaveLocationProgramProcedure() {
    system.storedProcedure({
      name: "maintenance_save_location_program",
      transaction: "caller",
      inputScalars: [
        { name: "p_program_id", type: "BigInt" },
        { name: "p_location_id", type: "BigInt" },
        { name: "p_name", type: { type: "String", maxLength: 240 } },
        { name: "p_instructions", type: { type: "String", maxLength: 6000 } },
        { name: "p_interval_value", type: "Int" },
        { name: "p_interval_unit", type: { type: "String", maxLength: 20 } },
        { name: "p_next_due_on", type: "Date" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      outputScalars: [{ name: "p_saved_program_id", type: "BigInt" }],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.throwErrorIf(
          sql`not exists(select 1 from db.locations where id = p_location_id)`,
          sql.lit`Location not found.`,
        );
        s.throwErrorIf(
          sql`p_program_id is not null and not exists(select 1 from db.maintenance_programs
            where id = p_program_id and location_id = p_location_id)`,
          sql.lit`Maintenance program not found.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_name), '') is null`,
          sql.lit`Enter a name.`,
        );
        s.throwErrorIf(
          sql`nullif(trim(p_instructions), '') is null`,
          sql.lit`Enter at least one step.`,
        );
        s.throwErrorIf(
          sql`coalesce(p_interval_value, 0) < 1 or p_interval_value > 999
            or coalesce(p_interval_unit, '') not in ('days', 'months')`,
          sql.lit`Choose how often it repeats.`,
        );
        s.throwErrorIf(
          sql`p_next_due_on is null`,
          sql.lit`Choose when it is next due.`,
        );
        s.throwErrorIf(
          sql`exists(select 1 from db.maintenance_programs
            where location_id = p_location_id
              and lower(name) = lower(trim(p_name))
              and id is distinct from p_program_id)`,
          sql.lit`This location already has maintenance with that name.`,
        );
        s.if(sql`p_program_id is null`, (s) => {
          s.modify(sql`insert into db.maintenance_programs
            (location_id, name, instructions, interval_value, interval_unit)
            values (p_location_id, trim(p_name), trim(p_instructions),
              p_interval_value, cast(p_interval_unit as enums.maintenance_interval_unit))
            returning id into p_saved_program_id`);
          s.modify(sql`insert into db.equipment_maintenance_schedules
            (maintenance_program_id, next_due_on)
            values (p_saved_program_id, p_next_due_on)`);
        }).else((s) => {
          s.setScalar("p_saved_program_id", sql`p_program_id`);
          s.modify(sql`update db.maintenance_programs
            set name = trim(p_name), instructions = trim(p_instructions),
              interval_value = p_interval_value,
              interval_unit = cast(p_interval_unit as enums.maintenance_interval_unit)
            where id = p_program_id`);
          s.modify(sql`update db.equipment_maintenance_schedules
            set next_due_on = p_next_due_on
            where maintenance_program_id = p_program_id`);
        });
      },
    });
  }

  /** Whether a user may close an item under field close-out. */
  canClose(item: Sql, userId: Sql): Sql {
    return sql`(${this.canAccess(userId)} and (${this.canManage(userId)}
      or exists(select 1 from db.maintenance_item_assignees assignee
        where assignee.maintenance_item_id = ${item}.id
          and assignee.sys_user_id = ${userId})
      or (${item}.kind = 'reported_problem' and ${item}.created_by_user_id = ${userId}
        and not exists(select 1 from db.maintenance_item_assignees assignee
          where assignee.maintenance_item_id = ${item}.id))))`;
  }

  /** A manager adds themselves to an open item; others are assigned. */
  private registerTakeItemProcedure() {
    system.storedProcedure({
      name: "maintenance_take_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.throwErrorIf(
          sql`not ${this.canManage(sql`p_actor_user_id`)}`,
          sql.lit`Work is assigned by a manager.`,
        );
        s.throwErrorIf(
          sql`not exists(select 1 from db.maintenance_items
            where id = p_item_id and status = 'open')`,
          sql.lit`This item is not open.`,
        );
        s.returnIf(sql`exists(select 1 from db.maintenance_item_assignees
          where maintenance_item_id = p_item_id and sys_user_id = p_actor_user_id)`);
        this.addAssignee(s);
      },
    });
  }

  /** Adds p_actor_user_id to p_item_id, with the activity and thread subscription. */
  private addAssignee(s: GeneralServerStatements) {
    s.modify(sql`insert into db.maintenance_item_assignees
      (maintenance_item_id, sys_user_id) values (p_item_id, p_actor_user_id)`);
    s.modify(sql`insert into db.maintenance_item_activities
      (maintenance_item_id, activity_type, actor_user_id, related_user_id)
      values (p_item_id, 'assignee_added', p_actor_user_id, p_actor_user_id)`);
    s.modify(sql`insert into db.comment_thread_subscriptions
      (comment_thread_id, sys_user_id)
      select id, p_actor_user_id from db.comment_threads
      where maintenance_item_id = p_item_id
      on conflict (comment_thread_id, sys_user_id) do nothing`);
  }

  /**
   Replaces the hours on p_item_id with p_time_entries, a JSON array of
   `{ "userId": <sys_users.id>, "minutes": <1..1440> }`.
   */
  private saveTimeEntries(s: GeneralServerStatements) {
    s.defTable(
      "entered_time",
      sql`select try_cast(value->>'userId' as bigint) as user_id,
          try_cast(value->>'minutes' as int) as minutes
        from json.array_each(coalesce(p_time_entries, '[]'::json))`,
    );
    s.throwErrorIf(
      sql`coalesce(json_typeof(p_time_entries), 'array') <> 'array'
        or exists(select 1 from entered_time where user_id is null
          or minutes is null or minutes < 1 or minutes > 1440)
        or (select count(*) from entered_time)
          <> (select count(distinct user_id) from entered_time)`,
      sql.lit`Enter each person's time once, between 1 minute and 24 hours.`,
    );
    s.throwErrorIf(
      sql`exists(select 1 from entered_time entry
        where not exists(select 1 from db.sys_users app_user
          where app_user.id = entry.user_id and ${
        this.canAccess(sql`app_user.id`)
      }))`,
      sql.lit`Choose people who work on maintenance.`,
    );
    s.modify(sql`delete from db.maintenance_item_time_entries
      where maintenance_item_id = p_item_id`);
    s.modify(sql`insert into db.maintenance_item_time_entries
      (maintenance_item_id, sys_user_id, minutes, entered_by_user_id)
      select p_item_id, user_id, minutes, p_actor_user_id from entered_time`);
    // Everyone who logged time worked on it.
    s.modify(sql`insert into db.maintenance_item_assignees
      (maintenance_item_id, sys_user_id)
      select p_item_id, user_id from entered_time
      on conflict (maintenance_item_id, sys_user_id) do nothing`);
  }

  /**
   Close an item with each worker's time; the close-out note is a comment.
   With `closeOutReview` it then waits for a manager.
   */
  private registerCloseItemProcedure() {
    system.storedProcedure({
      name: "maintenance_close_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        { name: "p_time_entries", type: "Json" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.defRecord(
          "closing_item",
          sql`select * from db.maintenance_items where id = p_item_id`,
        );
        s.throwErrorIf(
          sql`closing_item.id is null or closing_item.status <> 'open'`,
          sql.lit`This item is not open.`,
        );
        s.throwErrorIf(
          sql`not ${this.canAccess(sql`p_actor_user_id`)}`,
          sql.lit`You cannot close maintenance work.`,
        );
        s.throwErrorIf(
          sql`not ${this.canClose(sql`closing_item`, sql`p_actor_user_id`)}`,
          sql
            .lit`This work is assigned to someone else. Ask them or a manager to close it.`,
        );
        // A reporter closing their own problem did the work.
        s.if(
          sql`not exists(select 1 from db.maintenance_item_assignees
            where maintenance_item_id = p_item_id)`,
          (s) => this.addAssignee(s),
        );
        this.saveTimeEntries(s);
        this.changeStatus(
          s,
          true,
          this.opts.closeOutReview ? "awaiting_review" : "completed",
        );
      },
    });
  }

  /**
   A manager approves closed work into history (`p_approve`), optionally
   correcting the hours, or sends it back to be finished; the reason is a
   comment the caller posts.
   */
  private registerReviewItemProcedure() {
    system.storedProcedure({
      name: "maintenance_review_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        { name: "p_approve", type: "Bool" },
        { name: "p_time_entries", type: "Json" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.throwErrorIf(
          sql`not exists(select 1 from db.maintenance_items
            where id = p_item_id and status = 'awaiting_review')`,
          sql.lit`This item is not waiting for review.`,
        );
        s.if(sql`p_time_entries is not null`, (s) => this.saveTimeEntries(s));
        s.modify(sql`update db.maintenance_items
          set status = case when p_approve then 'completed' else 'open' end
          where id = p_item_id`);
        s.modify(sql`insert into db.maintenance_item_activities
          (maintenance_item_id, activity_type, actor_user_id, new_value)
          values (p_item_id,
            case when p_approve then 'status_changed' else 'returned' end,
            p_actor_user_id,
            case when p_approve then 'completed' else 'open' end)`);
      },
    });
  }

  private registerSetProgramActiveProcedure() {
    system.storedProcedure({
      name: "maintenance_set_program_active",
      transaction: "caller",
      inputScalars: [
        { name: "p_program_id", type: "BigInt" },
        { name: "p_active", type: "Bool" },
        { name: "p_actor_user_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.requireManager(s, sql`p_actor_user_id`);
        s.throwErrorIf(
          sql`not exists(select 1 from db.maintenance_programs where id = p_program_id)`,
          sql.lit`Maintenance program not found.`,
        );
        s.modify(sql`update db.maintenance_programs set active = p_active
          where id = p_program_id`);
      },
    });
  }

  private registerDueItemsProcedure() {
    system.storedProcedure({
      name: "maintenance_generate_due_items",
      transaction: "caller",
      procedure: (s) => {
        const openCycle =
          sql`exists(select 1 from db.maintenance_item_targets target
          join db.maintenance_items item on item.id = target.maintenance_item_id
          where target.equipment_maintenance_schedule_id = schedule.id
            and item.status = 'open')`;
        s.defTable(
          "due_schedules",
          sql`select schedule.id, schedule.equipment_id,
          cast(null as bigint) as location_id,
          schedule.maintenance_program_id, schedule.next_due_on
          from db.equipment_maintenance_schedules schedule
          join db.maintenance_programs program on program.id = schedule.maintenance_program_id
          join db.equipment equipment on equipment.id = schedule.equipment_id
          where program.active and ${this.activeEquipment(sql`equipment`)}
            and equipment.equipment_definition_id = program.equipment_definition_id
            and schedule.next_due_on <= current_date()
            and not ${openCycle}${
            this.opts.locationPrograms
              ? sql`
          union all
          select schedule.id, cast(null as bigint) as equipment_id, program.location_id,
            schedule.maintenance_program_id, schedule.next_due_on
          from db.equipment_maintenance_schedules schedule
          join db.maintenance_programs program on program.id = schedule.maintenance_program_id
          join db.locations location on location.id = program.location_id
          where program.active and location.active and schedule.equipment_id is null
            and schedule.next_due_on <= current_date()
            and not ${openCycle}`
              : sql``
          }`,
        );
        s.defTable(
          "due_programs",
          sql`select distinct maintenance_program_id from due_schedules`,
        );
        s.forEachTable("due_programs", "due_program", (s) => {
          s.defScalar("generated_item", sql`cast(null as bigint)`);
          s.modify(sql`insert into db.maintenance_items
            (kind, title, maintenance_program_id)
            select 'preventive_maintenance', name, id from db.maintenance_programs
            where id = due_program.maintenance_program_id
            returning id into generated_item`);
          s.modify(sql`insert into db.maintenance_item_targets
            (maintenance_item_id, equipment_id, location_id, equipment_maintenance_schedule_id, due_on)
            select generated_item, equipment_id, location_id, id, next_due_on from due_schedules
            where maintenance_program_id = due_program.maintenance_program_id`);
          s.modify(
            sql`insert into db.maintenance_item_activities (maintenance_item_id, activity_type)
            values (generated_item, 'created')`,
          );
          s.modify(
            sql`insert into db.comment_threads (maintenance_item_id) values (generated_item)`,
          );
        });
      },
    });
  }
}
