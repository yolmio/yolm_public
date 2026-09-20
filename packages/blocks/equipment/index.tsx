import { Alert } from "components/alert";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import { Each, Match, Show, Switch, useQueryParams } from "std/ui";
import type { EventsBlock } from "blocks/events";
import type { LocationsBlock } from "blocks/locations";

export interface EquipmentBlockOptions {
  events: EventsBlock;
  locations: LocationsBlock;
}

/** Durable physical identities, independent from their current location. */
export class EquipmentBlock implements Block {
  blockName = "EquipmentBlock";
  blockDisplayName = "Equipment";
  componentDependencies = ["EquipmentListPage", "EquipmentDetailPage"];
  description =
    "Equipment definitions, serialized instances, identifiers, composition, custody, restrictions, and state.";

  constructor(readonly opts: EquipmentBlockOptions) {}

  initialize() {
    for (
      const aggregate of [
        { name: "equipment_definition", displayName: "Equipment Definition" },
        { name: "equipment", displayName: "Equipment" },
      ]
    ) {
      this.opts.events.registerAggregateType(aggregate);
    }
    for (
      const event of [
        { name: "equipment.created", displayName: "Equipment Created" },
        {
          name: "equipment.location_changed",
          displayName: "Equipment Location Changed",
        },
        {
          name: "equipment.operability_changed",
          displayName: "Equipment Operability Changed",
        },
        {
          name: "equipment.custody_started",
          displayName: "Equipment Checked Out",
        },
        {
          name: "equipment.custody_ended",
          displayName: "Equipment Checked In",
        },
        {
          name: "equipment.component_installed",
          displayName: "Equipment Component Installed",
        },
        {
          name: "equipment.component_removed",
          displayName: "Equipment Component Removed",
        },
        {
          name: "equipment.restriction_started",
          displayName: "Equipment Restriction Started",
        },
        {
          name: "equipment.restriction_cleared",
          displayName: "Equipment Restriction Cleared",
        },
      ]
    ) {
      this.opts.events.registerEventType(event);
    }

    system.enum_({
      name: "equipment_lifecycle",
      values: [
        { name: "planned", displayName: "Planned" },
        { name: "commissioning", displayName: "Commissioning" },
        { name: "in_service", displayName: "In Service" },
        { name: "stored", displayName: "Stored" },
        { name: "retired", displayName: "Retired" },
      ],
    });
    system.enum_({
      name: "equipment_operability",
      values: [
        { name: "unknown", displayName: "Unknown" },
        { name: "operational", displayName: "Operational" },
        { name: "degraded", displayName: "Degraded" },
        { name: "unavailable", displayName: "Unavailable" },
      ],
    });
    system.enum_({
      name: "equipment_identifier_kind",
      values: [
        { name: "asset_tag", displayName: "Equipment Tag" },
        { name: "serial_number", displayName: "Serial Number" },
        { name: "qr", displayName: "QR Identifier" },
        { name: "customer_tag", displayName: "Customer Tag" },
        { name: "external", displayName: "External Identifier" },
      ],
    });
    system.enum_({
      name: "equipment_custody_type",
      values: [
        { name: "checkout", displayName: "Temporary Checkout" },
        { name: "assignment", displayName: "Long-term Assignment" },
        { name: "contractor_loan", displayName: "Contractor Loan" },
        { name: "rental", displayName: "Rental" },
      ],
    });
    system.enum_({
      name: "equipment_restriction_kind",
      values: [
        { name: "safety", displayName: "Safety" },
        { name: "calibration", displayName: "Calibration" },
        { name: "lockout", displayName: "Lockout / Tagout" },
        { name: "quality", displayName: "Quality" },
        { name: "administrative", displayName: "Administrative" },
      ],
    });

    system.db.table("equipment_definitions", (table) => {
      table.string("name", 240).notNull();
      table.string("category", 120);
      table.string("manufacturer", 200);
      table.string("model_number", 160);
      table.string("manufacturer_part_number", 160);
      table.json("attributes").notNull().default(sql`json_build_object()`);
      table.bool("active").notNull().default(sql`true`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.recordDisplayName(["name"], (name) => name);
      table.searchConfig({
        fieldGroups: [
          { fields: ["name", "model_number"], priority: 1 },
          { fields: ["manufacturer", "manufacturer_part_number"], priority: 2 },
        ],
      });
    });

    system.db.table("equipment", (table) => {
      table.fk("equipment_definitions").notNull().onDelete("Restrict");
      table.fk("locations").onDelete("Restrict");
      table.string("display_name", 240).notNull();
      table.enum("lifecycle", "equipment_lifecycle").notNull().default(
        sql.lit`planned`,
      );
      table.enum("operability", "equipment_operability").notNull().default(
        sql.lit`unknown`,
      );
      table.tinyUint("criticality").notNull().default(sql`0`);
      table.date("in_service_since");
      table.date("warranty_until");
      table.fk("current_custodian_user_id", "sys_users").onDelete("SetToNull");
      table.enum("current_custody_type", "equipment_custody_type");
      table.timestampUtc("custody_started_at");
      table.timestampUtc("due_back_at");
      table.string("external_system", 80);
      table.string("external_ref", 160);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.check({
        fields: ["criticality"],
        check: ([criticality]) => sql`${criticality} <= 100`,
        errorMessage: () => sql.lit`Criticality must be between 0 and 100.`,
      });
      table.check({
        fields: [
          "current_custodian_user_id",
          "current_custody_type",
          "custody_started_at",
          "due_back_at",
        ],
        check: ([custodian, custodyType, startedAt, dueBackAt]) =>
          sql`(${custodian} is null and ${custodyType} is null and ${startedAt} is null and ${dueBackAt} is null)
            or (${custodian} is not null and ${custodyType} is not null and ${startedAt} is not null)`,
        errorMessage: () =>
          sql.lit`Equipment custody projection is incomplete.`,
      });
      table.recordDisplayName(["display_name"], (name) => name);
      table.searchConfig({
        fieldGroups: [
          { fields: ["display_name"], priority: 1 },
          { fields: ["external_ref"], priority: 2 },
        ],
      });
    });

    system.db.table("equipment_identifiers", (table) => {
      table.fk("equipment").notNull().onDelete("Cascade");
      table.enum("kind", "equipment_identifier_kind").notNull();
      table.string("value", 240).notNull();
      table.bool("primary").notNull().default(sql`false`);
      table.timestampUtc("valid_from").notNull().default(sql`now()`);
      table.timestampUtc("valid_to");
      table.unique(["kind", "value"]);
      table.check({
        fields: ["valid_from", "valid_to"],
        check: ([validFrom, validTo]) =>
          sql`${validTo} is null or ${validTo} >= ${validFrom}`,
        errorMessage: () => sql.lit`Identifier validity range is invalid.`,
      });
    });

    system.db.table("equipment_components", (table) => {
      table.fk("parent_equipment_id", "equipment").notNull().onDelete(
        "Restrict",
      );
      table.fk("child_equipment_id", "equipment").notNull().unique().onDelete(
        "Restrict",
      );
      table.string("component_position", 160);
      table.timestampUtc("installed_at").notNull();
      table.check({
        fields: ["parent_equipment_id", "child_equipment_id"],
        check: ([parentId, childId]) => sql`${parentId} != ${childId}`,
        errorMessage: () => sql.lit`Equipment cannot contain itself.`,
      });
    });

    system.db.table("equipment_restrictions", (table) => {
      table.fk("equipment").notNull().onDelete("Cascade");
      table.enum("kind", "equipment_restriction_kind").notNull();
      table.string("reason", 1000).notNull().multiline();
      table.timestampUtc("effective_at").notNull();
      table.timestampUtc("cleared_at");
      table.fk("created_by_user_id", "sys_users").onDelete("SetToNull");
      table.fk("cleared_by_user_id", "sys_users").onDelete("SetToNull");
      table.check({
        fields: ["effective_at", "cleared_at"],
        check: ([effectiveAt, clearedAt]) =>
          sql`${clearedAt} is null or ${clearedAt} >= ${effectiveAt}`,
        errorMessage: () => sql.lit`Restriction dates are invalid.`,
      });
    });
  }

  populate() {
    this.registerMoveProcedure();
    this.registerOperabilityProcedure();
    this.registerCustodyProcedures();
  }

  private registerMoveProcedure() {
    system.storedProcedure({
      name: "equipment_move",
      transaction: "caller",
      inputScalars: [
        { name: "p_equipment_id", type: "BigInt" },
        { name: "p_location_id", type: "BigInt" },
        { name: "p_effective_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "moving_equipment",
          sql`select id, location_id, display_name from db.equipment where id = p_equipment_id`,
        );
        s.throwErrorIf(
          sql`moving_equipment.id is null`,
          sql.lit`Equipment was not found.`,
        );
        s.throwErrorIf(
          sql`p_location_id is not null and not exists(select 1 from db.locations where id = p_location_id and active)`,
          sql.lit`Destination location was not found or is inactive.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(
              sql`update db.equipment set location_id = p_location_id where id = p_equipment_id`,
            );
            this.opts.events.emit(s, {
              aggregateType: "equipment",
              aggregateId: sql`p_equipment_id`,
              eventType: "equipment.location_changed",
              effectiveAt: sql`p_effective_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`moving_equipment.display_name || ' moved to ' || coalesce((select name from db.locations where id = p_location_id), 'no location')`,
              payload:
                sql`json_build_object('from_location_id', moving_equipment.location_id, 'to_location_id', p_location_id)`,
              intoEventId: "move_event_id",
            });
            this.opts.events.appendPhysicalTrace(s, {
              eventId: sql`move_event_id`,
              subjectType: "equipment",
              subjectId: sql`p_equipment_id`,
              eventFamily: "movement",
              effectiveAt: sql`p_effective_at`,
              fromLocationId: sql`moving_equipment.location_id`,
              toLocationId: sql`p_location_id`,
            });
          },
        );
      },
    });
  }

  private registerOperabilityProcedure() {
    system.storedProcedure({
      name: "equipment_change_operability",
      transaction: "caller",
      inputScalars: [
        { name: "p_equipment_id", type: "BigInt" },
        {
          name: "p_operability",
          type: { type: "Enum", enum: "equipment_operability" },
        },
        { name: "p_reason", type: { type: "String", maxLength: 1000 } },
        { name: "p_effective_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "operability_equipment",
          sql`select id, display_name, operability from db.equipment where id = p_equipment_id`,
        );
        s.throwErrorIf(
          sql`operability_equipment.id is null`,
          sql.lit`Equipment was not found.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(
              sql`update db.equipment set operability = p_operability where id = p_equipment_id`,
            );
            this.opts.events.emit(s, {
              aggregateType: "equipment",
              aggregateId: sql`p_equipment_id`,
              eventType: "equipment.operability_changed",
              effectiveAt: sql`p_effective_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`operability_equipment.display_name || ' changed from ' || cast(operability_equipment.operability as string) || ' to ' || cast(p_operability as string)`,
              payload:
                sql`json_build_object('from', cast(operability_equipment.operability as string), 'to', cast(p_operability as string), 'reason', p_reason)`,
              intoEventId: "operability_event_id",
            });
          },
        );
      },
    });
  }

  private registerCustodyProcedures() {
    system.storedProcedure({
      name: "equipment_start_custody",
      transaction: "caller",
      inputScalars: [
        { name: "p_equipment_id", type: "BigInt" },
        { name: "p_custodian_user_id", type: "BigInt" },
        {
          name: "p_custody_type",
          type: { type: "Enum", enum: "equipment_custody_type" },
        },
        { name: "p_due_back_at", type: "TimestampTz" },
        { name: "p_effective_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "custody_equipment",
          sql`select id, display_name, location_id, current_custodian_user_id from db.equipment where id = p_equipment_id`,
        );
        s.throwErrorIf(
          sql`custody_equipment.id is null`,
          sql.lit`Equipment was not found.`,
        );
        s.throwErrorIf(
          sql`custody_equipment.current_custodian_user_id is not null and custody_equipment.current_custodian_user_id != p_custodian_user_id`,
          sql.lit`This equipment is already checked out to someone else.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.equipment
              set current_custodian_user_id = p_custodian_user_id,
                  current_custody_type = p_custody_type,
                  custody_started_at = p_effective_at,
                  due_back_at = p_due_back_at
              where id = p_equipment_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "equipment",
              aggregateId: sql`p_equipment_id`,
              eventType: "equipment.custody_started",
              effectiveAt: sql`p_effective_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary:
                sql`custody_equipment.display_name || ' checked out to user ' || cast(p_custodian_user_id as string)`,
              payload:
                sql`json_build_object('custodian_user_id', p_custodian_user_id, 'custody_type', cast(p_custody_type as string), 'due_back_at', p_due_back_at)`,
              bindings: [
                {
                  recordType: "sys_user",
                  recordId: sql`p_custodian_user_id`,
                  role: "custodian",
                },
              ],
              intoEventId: "custody_start_event_id",
            });
            this.opts.events.appendPhysicalTrace(s, {
              eventId: sql`custody_start_event_id`,
              subjectType: "equipment",
              subjectId: sql`p_equipment_id`,
              eventFamily: "custody",
              effectiveAt: sql`p_effective_at`,
              toLocationId: sql`custody_equipment.location_id`,
              toCustodianUserId: sql`p_custodian_user_id`,
            });
          },
        );
      },
    });

    system.storedProcedure({
      name: "equipment_end_custody",
      transaction: "caller",
      inputScalars: [
        { name: "p_equipment_id", type: "BigInt" },
        { name: "p_effective_at", type: "TimestampTz" },
        { name: "p_actor_user_id", type: "BigInt" },
        { name: "p_idempotency_key", type: "Uuid" },
      ],
      procedure: (s) => {
        s.defRecord(
          "return_equipment",
          sql`select id, display_name, location_id, current_custodian_user_id from db.equipment where id = p_equipment_id`,
        );
        s.throwErrorIf(
          sql`return_equipment.id is null`,
          sql.lit`Equipment was not found.`,
        );
        s.throwErrorIf(
          sql`return_equipment.current_custodian_user_id is null`,
          sql.lit`This equipment is not checked out.`,
        );
        s.if(
          sql`not exists(select 1 from db.events where idempotency_key = p_idempotency_key)`,
          (s) => {
            s.modify(sql`
              update db.equipment
              set current_custodian_user_id = null,
                  current_custody_type = null,
                  custody_started_at = null,
                  due_back_at = null
              where id = p_equipment_id
            `);
            this.opts.events.emit(s, {
              aggregateType: "equipment",
              aggregateId: sql`p_equipment_id`,
              eventType: "equipment.custody_ended",
              effectiveAt: sql`p_effective_at`,
              actorUserId: sql`p_actor_user_id`,
              idempotencyKey: sql`p_idempotency_key`,
              summary: sql`return_equipment.display_name || ' checked in'`,
              payload:
                sql`json_build_object('custodian_user_id', return_equipment.current_custodian_user_id)`,
              intoEventId: "custody_end_event_id",
            });
            this.opts.events.appendPhysicalTrace(s, {
              eventId: sql`custody_end_event_id`,
              subjectType: "equipment",
              subjectId: sql`p_equipment_id`,
              eventFamily: "custody",
              effectiveAt: sql`p_effective_at`,
              toLocationId: sql`return_equipment.location_id`,
              fromCustodianUserId:
                sql`return_equipment.current_custodian_user_id`,
            });
          },
        );
      },
    });
  }
}

export function equipmentStatusLabel(operability: Sql, lifecycle: Sql) {
  return sql`
    case
      when ${lifecycle} != 'in_service' then initcap(replace(cast(${lifecycle} as string), '_', ' '))
      when ${operability} = 'operational' then 'Operational'
      when ${operability} = 'degraded' then 'Needs attention'
      when ${operability} = 'unavailable' then 'Unavailable'
      else 'Unknown'
    end
  `;
}

export function EquipmentStatusChip(props: {
  operability: Sql;
  lifecycle: Sql;
  hasRestriction?: Sql;
}) {
  const restricted = props.hasRestriction ?? sql`false`;
  return (
    <Switch>
      <Match when={sql`${restricted} or ${props.operability} = 'unavailable'`}>
        <Chip size="sm" variant="soft" color="danger">Unavailable</Chip>
      </Match>
      <Match when={sql`${props.lifecycle} != 'in_service'`}>
        <Chip size="sm" variant="soft" color="neutral">
          {equipmentStatusLabel(props.operability, props.lifecycle)}
        </Chip>
      </Match>
      <Match when={sql`${props.operability} = 'degraded'`}>
        <Chip size="sm" variant="soft" color="warning">Needs attention</Chip>
      </Match>
      <Match when={sql`${props.operability} = 'operational'`}>
        <Chip size="sm" variant="soft" color="success">Operational</Chip>
      </Match>
      <Match when={sql`true`}>
        <Chip size="sm" variant="soft" color="neutral">Unknown</Chip>
      </Match>
    </Switch>
  );
}

export function EquipmentListPage() {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "equipment_rows",
          sql`
            select
              e.id,
              e.display_name,
              e.lifecycle,
              e.operability,
              e.criticality,
              d.name as definition_name,
              d.manufacturer,
              d.model_number,
              l.name as location_name,
              coalesce((select value from db.equipment_identifiers i
                where i.equipment_id = e.id and i.kind = 'asset_tag' and i.valid_to is null
                order by i.primary desc, i.id limit 1), '') as asset_tag,
              exists(select 1 from db.equipment_restrictions r
                where r.equipment_id = e.id and r.cleared_at is null) as has_restriction
            from db.equipment e
            join db.equipment_definitions d on d.id = e.equipment_definition_id
            left join db.locations l on l.id = e.location_id
            order by
              case when e.operability = 'unavailable' then 0 when e.operability = 'degraded' then 1 else 2 end,
              e.criticality desc,
              e.display_name
          `,
        );
      }}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Each table="equipment_rows" recordName="equipment_row">
          <Card
            variant="outlined"
            className="cursor-pointer p-4"
            onClick={(s) =>
              s.navigate(
                sql`'/equipment/' || cast(equipment_row.id as string)`,
              )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Typography level="title-md">
                  {sql`coalesce(nullif(equipment_row.asset_tag, ''), equipment_row.display_name)`}
                </Typography>
                <Typography level="body-sm" color="neutral">
                  {sql`equipment_row.definition_name`}
                </Typography>
              </div>
              <EquipmentStatusChip
                lifecycle={sql`equipment_row.lifecycle`}
                operability={sql`equipment_row.operability`}
                hasRestriction={sql`equipment_row.has_restriction`}
              />
            </div>
            <div className="mt-4">
              <Typography level="body-xs" color="neutral">
                {sql`coalesce(equipment_row.location_name, 'No location') || ' · criticality ' || equipment_row.criticality`}
              </Typography>
            </div>
          </Card>
        </Each>
      </div>
    </Data>
  );
}

export function EquipmentDetailPage() {
  useQueryParams([{ name: "equipment_id", type: { type: "BigInt" } }]);
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "equipment_detail",
          sql`
            select
              e.*,
              d.name as definition_name,
              d.manufacturer,
              d.model_number,
              d.manufacturer_part_number,
              l.name as location_name,
              coalesce((select value from db.equipment_identifiers i
                where i.equipment_id = e.id and i.kind = 'asset_tag' and i.valid_to is null
                order by i.primary desc, i.id limit 1), '') as asset_tag,
              coalesce((select value from db.equipment_identifiers i
                where i.equipment_id = e.id and i.kind = 'serial_number' and i.valid_to is null
                order by i.primary desc, i.id limit 1), '') as serial_number,
              exists(select 1 from db.equipment_restrictions r
                where r.equipment_id = e.id and r.cleared_at is null) as has_restriction
            from db.equipment e
            join db.equipment_definitions d on d.id = e.equipment_definition_id
            left join db.locations l on l.id = e.location_id
            where e.id = equipment_id
          `,
        );
        s.defTable(
          "equipment_activity",
          sql`
            select ev.id, ev.event_type, ev.summary, ev.effective_at, ev.recorded_at
            from db.events ev
            join db.event_bindings binding on binding.event_id = ev.id
            where binding.record_type = 'equipment'
              and binding.record_id = equipment_id
            order by ev.effective_at desc, ev.id desc
            limit 25
          `,
        );
      }}
    >
      <Show
        when={sql`equipment_detail.id is not null`}
        fallback={
          <Alert color="danger" variant="soft">Equipment was not found.</Alert>
        }
      >
        <div className="flex flex-col gap-5">
          <Card variant="outlined" className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Typography level="h3">
                  {sql`coalesce(nullif(equipment_detail.asset_tag, ''), equipment_detail.display_name)`}
                </Typography>
                <Typography level="body-md" color="neutral">
                  {sql`equipment_detail.definition_name || coalesce(' · ' || equipment_detail.manufacturer || ' ' || equipment_detail.model_number, '')`}
                </Typography>
              </div>
              <EquipmentStatusChip
                lifecycle={sql`equipment_detail.lifecycle`}
                operability={sql`equipment_detail.operability`}
                hasRestriction={sql`equipment_detail.has_restriction`}
              />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Typography level="body-xs" color="neutral">
                  Location
                </Typography>
                <Typography level="body-sm">
                  {sql`coalesce(equipment_detail.location_name, 'Not assigned')`}
                </Typography>
              </div>
              <div>
                <Typography level="body-xs" color="neutral">
                  Serial number
                </Typography>
                <Typography level="body-sm">
                  {sql`coalesce(nullif(equipment_detail.serial_number, ''), 'Not recorded')`}
                </Typography>
              </div>
              <div>
                <Typography level="body-xs" color="neutral">
                  Criticality
                </Typography>
                <Typography level="body-sm">
                  {sql`equipment_detail.criticality || ' / 100'`}
                </Typography>
              </div>
              <div>
                <Typography level="body-xs" color="neutral">
                  Warranty
                </Typography>
                <Typography level="body-sm">
                  {sql`coalesce(cast(equipment_detail.warranty_until as string), 'Not recorded')`}
                </Typography>
              </div>
            </div>
          </Card>

          <Card variant="outlined" className="p-5">
            <Typography level="title-md" startIcon="History">
              Activity
            </Typography>
            <div className="mt-3 flex flex-col">
              <Each table="equipment_activity" recordName="activity">
                <div className="flex gap-3 border-b border-slate-200 py-3 last:border-b-0">
                  <MaterialIcon icon="Event" className="text-primary-600" />
                  <div className="min-w-0">
                    <Typography level="body-sm">
                      {sql`activity.summary`}
                    </Typography>
                    <Typography level="body-xs" color="neutral">
                      {sql`initcap(replace(cast(activity.event_type as string), '.', ' · ')) || ' · ' || format.date(activity.effective_at, '%b %-d, %Y %I:%M %p')`}
                    </Typography>
                  </div>
                </div>
              </Each>
            </div>
          </Card>
        </div>
      </Show>
    </Data>
  );
}
