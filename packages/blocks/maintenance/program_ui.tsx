import { MaintenanceBlock } from "./index";
import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { system } from "std/system";
import { Each, Show } from "std/ui";

/** "Every week", "Every 3 months", ... from an interval value and unit. */
export const maintenanceIntervalText = (value: Sql, unit: Sql) =>
  sql`case
    when ${unit} = 'days' and ${value} = 7 then 'Every week'
    when ${unit} = 'days' and ${value} = 14 then 'Every 2 weeks'
    when ${unit} = 'days' and ${value} = 1 then 'Every day'
    when ${unit} = 'months' and ${value} = 1 then 'Every month'
    when ${unit} = 'months' and ${value} = 12 then 'Every year'
    when ${unit} = 'months' and ${value} % 12 = 0 then 'Every ' || (${value} / 12) || ' years'
    when ${unit} = 'days' and ${value} % 7 = 0 then 'Every ' || (${value} / 7) || ' weeks'
    else 'Every ' || ${value} || ' ' || cast(${unit} as string) end`;

const stepsPlaceholder =
  "Isolate and lock out\nCheck the seal for leaks\nRecord bearing temperature";

const presets = [
  { label: "Weekly", value: 7, unit: "days" },
  { label: "Every 2 weeks", value: 14, unit: "days" },
  { label: "Monthly", value: 1, unit: "months" },
  { label: "Quarterly", value: 3, unit: "months" },
  { label: "Every 6 months", value: 6, unit: "months" },
  { label: "Yearly", value: 12, unit: "months" },
];

const isPreset = sql`(${
  presets.map((p) =>
    sql`(ui.program_interval = ${p.value} and ui.program_unit = ${
      sql.lit(p.unit)
    })`
  ).reduce((a, b) => sql`${a} or ${b}`)
})`;

const oneIntervalFromToday = sql`cast(current_date() + case ui.program_unit
  when 'days' then interval '1 day' * ui.program_interval
  else interval '1 month' * ui.program_interval end as date)`;

// Units without their own date follow the shared first due date.
const firstDue =
  sql`coalesce(try_cast(nullif(ui.program_first_due, '') as date), ${oneIntervalFromToday})`;

/**
 Preventive maintenance on an equipment type: a readable list, and one dialog
 to add or edit a program with its steps, how often it repeats, and which units
 it covers.
 */
export function MaintenancePrograms(props: {
  definitionId: Sql;
  /** Short unit name in the dialog, e.g. an asset tag. Defaults to the display name. */
  unitLabel?: (equipment: Sql) => Sql;
  /** Link each program to a page of its items. */
  programHref?: (programId: Sql) => Sql;
}) {
  const maintenance = system.block(MaintenanceBlock);
  const unitLabel = props.unitLabel ?? ((e: Sql) => sql`${e}.display_name`);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("program_dialog_open", sql.false);
        s.defScalar("program_dialog_id", sql`cast(null as bigint)`);
      }}
    >
      <Data
        procedure={(s) => {
          s.defScalar(
            "programs_can_manage",
            maintenance.canManage(sql`current_user`),
          );
          s.defTable(
            "type_programs",
            sql`select program.id, program.name, program.active,
                program.interval_value, program.interval_unit,
                (select trim(value) from string.split(program.instructions, chr(10))
                  where trim(value) <> '' order by ordinal limit 1) as first_step,
                (select count(*) from string.split(program.instructions, chr(10))
                  where trim(value) <> '') as step_count,
                (select count(*) from db.equipment_maintenance_schedules schedule
                  where schedule.maintenance_program_id = program.id) as unit_count,
                (select min(next_due_on) from db.equipment_maintenance_schedules schedule
                  where schedule.maintenance_program_id = program.id) as next_due_on,
                (select count(*) from db.maintenance_items item
                  where item.maintenance_program_id = program.id
                    and item.status = 'open') as open_count
              from db.maintenance_programs program
              where program.equipment_definition_id = ${props.definitionId}
              order by program.active desc, program.name`,
          );
        }}
      >
        <div className="rounded-xl border border-divider bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <div>
              <h3 className="font-semibold">Preventive maintenance</h3>
              <p className="text-xs text-secondary">
                Defined once for this type. Each unit keeps its own due date.
              </p>
            </div>
            <Show when={sql`programs_can_manage`}>
              <Button
                size="sm"
                startIcon="Add"
                onClick={(s) => {
                  s.setScalar("program_dialog_id", sql`null`);
                  s.setScalar("program_dialog_open", sql.true);
                }}
              >
                Add
              </Button>
            </Show>
          </div>
          <Show when={sql`not exists(select 1 from type_programs)`}>
            <p className="p-4 text-sm text-secondary">
              No preventive maintenance for this type yet.
            </p>
          </Show>
          <Each table="type_programs" recordName="program">
            <div className="flex items-start border-b border-divider last:border-0">
              <button
                type="button"
                className="block min-w-0 flex-1 px-4 py-3 text-left enabled:hover:bg-neutral-50"
                disabled={sql`not programs_can_manage`}
                onClick={(s) => {
                  s.setScalar("program_dialog_id", sql`program.id`);
                  s.setScalar("program_dialog_open", sql.true);
                }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex items-center gap-2">
                    <strong>{sql`program.name`}</strong>
                    <Show when={sql`not program.active`}>
                      <Chip size="sm" variant="soft" color="neutral">
                        Paused
                      </Chip>
                    </Show>
                  </span>
                  <span className="text-sm font-medium">
                    {maintenanceIntervalText(
                      sql`program.interval_value`,
                      sql`program.interval_unit`,
                    )}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-secondary">
                  {sql`coalesce(program.first_step, '') || case when program.step_count > 1
                    then ' · +' || (program.step_count - 1) || case when program.step_count = 2 then ' more step' else ' more steps' end
                    else '' end`}
                </p>
                <p className="mt-1 text-xs text-secondary">
                  {sql`program.unit_count || case when program.unit_count = 1 then ' unit' else ' units' end
                    || coalesce(' · next due ' || format.date(program.next_due_on, '%b %-d'), '')
                    || case when program.open_count > 0 then ' · ' || program.open_count || ' open' else '' end`}
                  <Show
                    when={sql`program.active and program.next_due_on < current_date()`}
                  >
                    <span className="ml-1 font-semibold text-danger-600">
                      · overdue
                    </span>
                  </Show>
                </p>
              </button>
              {props.programHref && (
                <a
                  className="shrink-0 px-4 py-3 text-sm text-primary-600 hover:underline"
                  href={props.programHref(sql`program.id`)}
                >
                  Items
                </a>
              )}
            </div>
          </Each>
        </div>
        <ModalDialog
          open={sql`program_dialog_open`}
          maxWidth="sm"
          onClose={(s) => s.setScalar("program_dialog_open", sql.false)}
        >
          <ProgramDialog
            definitionId={props.definitionId}
            unitLabel={unitLabel}
          />
        </ModalDialog>
      </Data>
    </Data>
  );
}

function IntervalChip(props: {
  label: string;
  selected: Sql;
  onClick: (s: DomStatements) => void;
}) {
  return (
    <Show
      when={props.selected}
      fallback={
        <Button
          size="sm"
          variant="outlined"
          color="neutral"
          onClick={props.onClick}
        >
          {props.label}
        </Button>
      }
    >
      <Button size="sm" variant="solid" color="primary" aria-pressed="true">
        {props.label}
      </Button>
    </Show>
  );
}

/** Preset intervals plus a custom days/months input, bound to ui program scalars. */
function IntervalPicker(props: { editing: Sql; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">How often</span>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <IntervalChip
            label={preset.label}
            selected={sql`not ui.program_custom
                and ui.program_interval = ${preset.value}
                and ui.program_unit = ${sql.lit(preset.unit)}`}
            onClick={(s) => {
              s.setScalar("program_custom", sql.false);
              s.setScalar("program_interval", sql`${preset.value}`);
              s.setScalar("program_unit", sql.lit(preset.unit));
            }}
          />
        ))}
        <IntervalChip
          label="Custom"
          selected={sql`ui.program_custom or not ${isPreset}`}
          onClick={(s) => s.setScalar("program_custom", sql.true)}
        />
      </div>
      <Show when={sql`ui.program_custom or not ${isPreset}`}>
        <div className="flex items-center gap-2 text-sm">
          Every
          <Input
            type="number"
            className="w-20"
            value={sql`cast(ui.program_interval as string)`}
            onChange={(s) =>
              s.if(
                sql`try_cast(target_value as int) between 1 and 999`,
                (s) =>
                  s.setScalar(
                    "program_interval",
                    sql`try_cast(target_value as int)`,
                  ),
              )}
          />
          <Select
            value={sql`ui.program_unit`}
            onChange={(s) => s.setScalar("program_unit", sql`target_value`)}
          >
            <Select.Option value="days">days</Select.Option>
            <Select.Option value="months">months</Select.Option>
          </Select>
        </div>
      </Show>
      <Show when={props.editing}>
        <span className="text-xs text-secondary">{props.note}</span>
      </Show>
    </div>
  );
}

function ProgramDialog(props: {
  definitionId: Sql;
  unitLabel: (equipment: Sql) => Sql;
}) {
  const maintenance = system.block(MaintenanceBlock);
  return (
    <Data
      noRefetch
      procedure={(s) => {
        s.defRecord(
          "editing_program",
          sql`select * from db.maintenance_programs
            where id = ui.program_dialog_id
              and equipment_definition_id = ${props.definitionId}`,
        );
        s.defScalar("program_name", sql`coalesce(editing_program.name, '')`);
        s.defScalar(
          "program_steps",
          sql`coalesce(editing_program.instructions, '')`,
        );
        s.defScalar(
          "program_interval",
          sql`coalesce(cast(editing_program.interval_value as int), 1)`,
        );
        s.defScalar(
          "program_unit",
          sql`coalesce(cast(editing_program.interval_unit as string), 'months')`,
        );
        s.defScalar(
          "program_custom",
          sql`editing_program.id is not null and not ${sql`(${
            presets.map((p) =>
              sql`(editing_program.interval_value = ${p.value}
                  and editing_program.interval_unit = ${sql.lit(p.unit)})`
            ).reduce((a, b) => sql`${a} or ${b}`)
          })`}`,
        );
        s.defScalar("program_first_due", sql.lit``);
        // Every active unit of the type, plus any unit the program already covers.
        s.defTable(
          "program_units",
          sql`select equipment.id as equipment_id,
              ${props.unitLabel(sql`equipment`)} as label,
              location.name as location_name,
              case when editing_program.id is null then true
                else schedule.id is not null end as selected,
              schedule.next_due_on as due
            from db.equipment equipment
            left join db.locations location on location.id = equipment.location_id
            left join db.equipment_maintenance_schedules schedule
              on schedule.equipment_id = equipment.id
              and schedule.maintenance_program_id = editing_program.id
            where equipment.equipment_definition_id = ${props.definitionId}
              and (${
            maintenance.activeEquipment(sql`equipment`)
          } or schedule.id is not null)
            order by label`,
        );
      }}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h2 className="text-lg font-semibold">
            {sql`case when editing_program.id is null
              then 'Add preventive maintenance' else 'Edit preventive maintenance' end`}
          </h2>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            aria-label="Close"
            onClick={(s) => s.setScalar("program_dialog_open", sql.false)}
          >
            <MaterialIcon icon="Close" />
          </Button>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <Input
              bindScalar="program_name"
              placeholder="For example, Monthly seal inspection"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Steps
            <Textarea
              bindScalar="program_steps"
              minRows={4}
              placeholder={stepsPlaceholder}
            />
            <span className="text-xs font-normal text-secondary">
              One step per line. Technicians see them as numbered steps.
            </span>
          </label>
          <IntervalPicker
            editing={sql`editing_program.id is not null`}
            note="A new interval applies after each unit's next due date."
          />
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="text-sm font-medium">Units</span>
              <Show when={sql`editing_program.id is null`}>
                <label className="flex items-center gap-2 text-sm">
                  First due
                  <Input
                    type="date"
                    size="sm"
                    value={sql`cast(${firstDue} as string)`}
                    onChange={(s) =>
                      s.setScalar("program_first_due", sql`target_value`)}
                  />
                </label>
              </Show>
            </div>
            <Show when={sql`not exists(select 1 from program_units)`}>
              <p className="text-sm text-secondary">
                No units of this type yet. New units get this maintenance when
                they are added.
              </p>
            </Show>
            <div className="rounded-lg border border-divider">
              <Each table="program_units" recordName="program_unit">
                <div className="flex items-center gap-3 border-b border-divider px-3 py-2 last:border-0">
                  <Checkbox
                    checked={sql`program_unit.selected`}
                    aria-label={sql`'Include ' || program_unit.label`}
                    onChange={(s) =>
                      s.modify(
                        sql`update program_units set selected = not selected
                        where equipment_id = program_unit.equipment_id`,
                      )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {sql`program_unit.label`}
                    </p>
                    <p className="truncate text-xs text-secondary">
                      {sql`coalesce(program_unit.location_name, 'No location')`}
                    </p>
                  </div>
                  <Show when={sql`program_unit.selected`}>
                    <Input
                      type="date"
                      size="sm"
                      aria-label={sql`'Due date for ' || program_unit.label`}
                      value={sql`cast(coalesce(program_unit.due, ${firstDue}) as string)`}
                      onChange={(s) =>
                        s.modify(sql`update program_units
                          set due = try_cast(target_value as date)
                          where equipment_id = program_unit.equipment_id`)}
                    />
                  </Show>
                </div>
              </Each>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-divider px-5 py-3">
          <p className="mr-auto text-sm text-secondary">
            {sql`(select count(*) from program_units where selected)
              || case when (select count(*) from program_units where selected) = 1
                then ' unit' else ' units' end
              || coalesce(' · first due ' || format.date((select min(coalesce(due, ${firstDue}))
                from program_units where selected), '%b %-d, %Y'), '')`}
          </p>
          <Show when={sql`editing_program.id is not null`}>
            <ActionButton
              variant="plain"
              color="neutral"
              errorDisplay="inline"
              action={(s) => {
                s.startTransaction();
                s.callStoredProcedure("maintenance_set_program_active", {
                  inputScalars: {
                    p_program_id: sql`editing_program.id`,
                    p_active: sql`not editing_program.active`,
                    p_actor_user_id: sql`current_user`,
                  },
                });
                s.commitTransaction();
              }}
              afterSuccessClient={(s) =>
                s.setScalar("program_dialog_open", sql.false)}
            >
              {sql`case when editing_program.active then 'Pause' else 'Resume' end`}
            </ActionButton>
          </Show>
          <ActionButton
            errorDisplay="inline"
            action={(s) => {
              s.startTransaction();
              s.callStoredProcedure("maintenance_save_program", {
                inputScalars: {
                  p_program_id: sql`editing_program.id`,
                  p_definition_id: props.definitionId,
                  p_name: sql`ui.program_name`,
                  p_instructions: sql`ui.program_steps`,
                  p_interval_value: sql`ui.program_interval`,
                  p_interval_unit: sql`ui.program_unit`,
                  p_units:
                    sql`(select coalesce(json_array_agg(json_build_object(
                      'equipment_id', equipment_id,
                      'next_due_on', cast(coalesce(due, ${firstDue}) as string))),
                    json_build_array())
                    from ui.program_units where selected)`,
                  p_actor_user_id: sql`current_user`,
                },
                outputScalars: { p_saved_program_id: "saved_program_id" },
              });
              s.commitTransaction();
            }}
            afterSuccessClient={(s) =>
              s.setScalar("program_dialog_open", sql.false)}
          >
            {sql`case when editing_program.id is null then 'Add' else 'Save' end`}
          </ActionButton>
        </div>
      </div>
    </Data>
  );
}

/**
 Preventive maintenance on a location (an area, a building, a whole plant):
 tasks such as "inspect all butterfly valves" that cover no single equipment
 type. Requires `MaintenanceBlock({ locationPrograms: true })`.
 */
export function LocationMaintenancePrograms(props: { locationId: Sql }) {
  const maintenance = system.block(MaintenanceBlock);
  if (!maintenance.opts.locationPrograms) {
    throw new Error(
      "LocationMaintenancePrograms requires MaintenanceBlock locationPrograms.",
    );
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("program_dialog_open", sql.false);
        s.defScalar("program_dialog_id", sql`cast(null as bigint)`);
      }}
    >
      <Data
        procedure={(s) => {
          s.defScalar(
            "programs_can_manage",
            maintenance.canManage(sql`current_user`),
          );
          // Bound first so the caller's expression cannot resolve to a
          // program column inside the query below.
          s.defScalar("programs_location_id", props.locationId);
          s.defTable(
            "location_programs",
            sql`select program.id, program.name, program.active,
                program.interval_value, program.interval_unit,
                (select trim(value) from string.split(program.instructions, chr(10))
                  where trim(value) <> '' order by ordinal limit 1) as first_step,
                (select count(*) from string.split(program.instructions, chr(10))
                  where trim(value) <> '') as step_count,
                (select min(next_due_on) from db.equipment_maintenance_schedules schedule
                  where schedule.maintenance_program_id = program.id) as next_due_on
              from db.maintenance_programs program
              where program.location_id = programs_location_id
              order by program.active desc, program.name`,
          );
        }}
      >
        <div className="rounded-xl border border-divider bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <div>
              <h3 className="font-semibold">Area maintenance</h3>
              <p className="text-xs text-secondary">
                Recurring tasks for this location as a whole.
              </p>
            </div>
            <Show when={sql`programs_can_manage`}>
              <Button
                size="sm"
                startIcon="Add"
                onClick={(s) => {
                  s.setScalar("program_dialog_id", sql`null`);
                  s.setScalar("program_dialog_open", sql.true);
                }}
              >
                Add
              </Button>
            </Show>
          </div>
          <Show when={sql`not exists(select 1 from location_programs)`}>
            <p className="p-4 text-sm text-secondary">
              No recurring tasks for this location.
            </p>
          </Show>
          <Each table="location_programs" recordName="program">
            <button
              type="button"
              className="block w-full border-b border-divider px-4 py-3 text-left last:border-0 enabled:hover:bg-neutral-50"
              disabled={sql`not programs_can_manage`}
              onClick={(s) => {
                s.setScalar("program_dialog_id", sql`program.id`);
                s.setScalar("program_dialog_open", sql.true);
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="flex items-center gap-2">
                  <strong>{sql`program.name`}</strong>
                  <Show when={sql`not program.active`}>
                    <Chip size="sm" variant="soft" color="neutral">
                      Paused
                    </Chip>
                  </Show>
                </span>
                <span className="text-sm font-medium">
                  {maintenanceIntervalText(
                    sql`program.interval_value`,
                    sql`program.interval_unit`,
                  )}
                </span>
              </div>
              <p className="mt-0.5 truncate text-sm text-secondary">
                {sql`coalesce(program.first_step, '') || case when program.step_count > 1
                  then ' · +' || (program.step_count - 1) || case when program.step_count = 2 then ' more step' else ' more steps' end
                  else '' end`}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {sql`coalesce('Next due ' || format.date(program.next_due_on, '%b %-d, %Y'), '')`}
                <Show
                  when={sql`program.active and program.next_due_on < current_date()`}
                >
                  <span className="ml-1 font-semibold text-danger-600">
                    · overdue
                  </span>
                </Show>
              </p>
            </button>
          </Each>
        </div>
        <ModalDialog
          open={sql`program_dialog_open`}
          maxWidth="sm"
          onClose={(s) => s.setScalar("program_dialog_open", sql.false)}
        >
          <LocationProgramDialog locationId={props.locationId} />
        </ModalDialog>
      </Data>
    </Data>
  );
}

function LocationProgramDialog(props: { locationId: Sql }) {
  return (
    <Data
      noRefetch
      procedure={(s) => {
        s.defScalar("dialog_location_id", props.locationId);
        s.defRecord(
          "editing_program",
          sql`select program.*,
              (select min(next_due_on) from db.equipment_maintenance_schedules schedule
                where schedule.maintenance_program_id = program.id) as next_due_on
            from db.maintenance_programs program
            where program.id = ui.program_dialog_id
              and program.location_id = dialog_location_id`,
        );
        s.defScalar("program_name", sql`coalesce(editing_program.name, '')`);
        s.defScalar(
          "program_steps",
          sql`coalesce(editing_program.instructions, '')`,
        );
        s.defScalar(
          "program_interval",
          sql`coalesce(cast(editing_program.interval_value as int), 1)`,
        );
        s.defScalar(
          "program_unit",
          sql`coalesce(cast(editing_program.interval_unit as string), 'months')`,
        );
        s.defScalar(
          "program_custom",
          sql`editing_program.id is not null and not ${sql`(${
            presets.map((p) =>
              sql`(editing_program.interval_value = ${p.value}
                  and editing_program.interval_unit = ${sql.lit(p.unit)})`
            ).reduce((a, b) => sql`${a} or ${b}`)
          })`}`,
        );
        s.defScalar(
          "program_first_due",
          sql`coalesce(cast(editing_program.next_due_on as string), '')`,
        );
      }}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h2 className="text-lg font-semibold">
            {sql`case when editing_program.id is null
              then 'Add area maintenance' else 'Edit area maintenance' end`}
          </h2>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            aria-label="Close"
            onClick={(s) => s.setScalar("program_dialog_open", sql.false)}
          >
            <MaterialIcon icon="Close" />
          </Button>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <Input
              bindScalar="program_name"
              placeholder="For example, Inspect all butterfly valves"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Steps
            <Textarea
              bindScalar="program_steps"
              minRows={4}
              placeholder={stepsPlaceholder}
            />
            <span className="text-xs font-normal text-secondary">
              One step per line. Technicians see them as numbered steps.
            </span>
          </label>
          <IntervalPicker
            editing={sql`editing_program.id is not null`}
            note="A new interval applies after the next due date."
          />
          <label className="flex items-center gap-2 text-sm font-medium">
            Next due
            <Input
              type="date"
              size="sm"
              value={sql`cast(${firstDue} as string)`}
              onChange={(s) =>
                s.setScalar("program_first_due", sql`target_value`)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-divider px-5 py-3">
          <Show when={sql`editing_program.id is not null`}>
            <ActionButton
              variant="plain"
              color="neutral"
              errorDisplay="inline"
              action={(s) => {
                s.startTransaction();
                s.callStoredProcedure("maintenance_set_program_active", {
                  inputScalars: {
                    p_program_id: sql`editing_program.id`,
                    p_active: sql`not editing_program.active`,
                    p_actor_user_id: sql`current_user`,
                  },
                });
                s.commitTransaction();
              }}
              afterSuccessClient={(s) =>
                s.setScalar("program_dialog_open", sql.false)}
            >
              {sql`case when editing_program.active then 'Pause' else 'Resume' end`}
            </ActionButton>
          </Show>
          <ActionButton
            errorDisplay="inline"
            action={(s) => {
              s.startTransaction();
              s.callStoredProcedure("maintenance_save_location_program", {
                inputScalars: {
                  p_program_id: sql`editing_program.id`,
                  p_location_id: sql`dialog_location_id`,
                  p_name: sql`ui.program_name`,
                  p_instructions: sql`ui.program_steps`,
                  p_interval_value: sql`ui.program_interval`,
                  p_interval_unit: sql`ui.program_unit`,
                  p_next_due_on: firstDue,
                  p_actor_user_id: sql`current_user`,
                },
                outputScalars: { p_saved_program_id: "saved_program_id" },
              });
              s.commitTransaction();
            }}
            afterSuccessClient={(s) =>
              s.setScalar("program_dialog_open", sql.false)}
          >
            {sql`case when editing_program.id is null then 'Add' else 'Save' end`}
          </ActionButton>
        </div>
      </div>
    </Data>
  );
}
