import { AutoInsertButton } from "components/auto_insert_dialog";
import { AutoUpdateButton } from "components/auto_update_dialog";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import { FormICtxKey } from "std/ictx";
import type { DomStatements } from "std/statements";
import { Alert } from "components/alert";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Form } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Effect, Route, Show, useICtx, usePhase } from "std/ui";
import type { ManualMeasurementsBlock } from "./index";
function ValueField(
  props: { field: string; format: Sql; label: Sql; caption?: string },
) {
  return (
    <Form.Field field={props.field}>
      {(field) => (
        <div className="min-w-0">
          <label>
            {props.caption && (
              <Typography level="body-xs" className="mb-1">
                {props.caption}
              </Typography>
            )}
            <Input
              size="sm"
              startDecorator={
                <Show when={sql`${props.format}='currency'`}>$</Show>
              }
              type="number"
              inputMode="decimal"
              aria-label={props.label}
              value={sql`case when ${field.value} is null then '' when ${props.format} = 'percentage' then (try_cast(${field.value} as double) * 100)::string else try_cast(${field.value} as double)::string end`}
              endDecorator={
                <Show when={sql`${props.format} = 'percentage'`}>%</Show>
              }
              onInput={(s) =>
                field.setValue(
                  s,
                  sql`case when target_value = '' then null when ${props.format} = 'percentage' then (try_cast(target_value as decimal(18,4)) / 100.0)::string else target_value end`,
                )}
              onBlur={(s) => field.setTouched(s, true)}
              error={field.hasError}
            />
          </label>
          <Show when={field.hasError}>
            <Typography color="danger">{field.error}</Typography>
          </Show>
        </div>
      )}
    </Form.Field>
  );
}

function EntryNavigationGuard() {
  if (usePhase() === "gather") return null;
  const form = useICtx(FormICtxKey);
  const clearRequest = (s: DomStatements) => {
    s.setScalar("stats_requested_date", sql`null::date`);
  };
  const navigate = (s: DomStatements) => {
    s.setScalar("entry_date", sql`coalesce(stats_requested_date, entry_date)`);
    s.setScalar("stats_saved", false);
    clearRequest(s);
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => s.defScalar("stats_discard_open", false)}
    >
      <Effect
        watch={[sql`stats_requested_date`]}
        onChange={(s) => {
          s.if(
            sql`stats_requested_date is not null and stats_requested_date != entry_date`,
            (s) => {
              s.conditional({
                condition: sql`last_saved_state_hash != ${form.stateHash()}`,
                then: (s) => s.setScalar("stats_discard_open", true),
                else: navigate,
              });
            },
          );
        }}
      />
      <ConfirmDangerDialog
        open={sql`stats_discard_open`}
        onClose={(s) => {
          s.setScalar("stats_discard_open", false);
          clearRequest(s);
        }}
        description="You have unsaved values. Discard them and continue?"
        confirmButtonText="Discard changes"
        onConfirm={(s) => {
          s.setScalar("stats_discard_open", false);
          navigate(s);
        }}
      />
    </Data>
  );
}

export function ManualEntry(
  props: {
    block: ManualMeasurementsBlock;
    statId?: Sql;
    /** Compact weekly entry with guarded previous/next navigation. */
    weekly?: boolean;
    /** One row per stat_id, with group_name and numeric sort_order. */
    statGroups?: Sql;
  },
) {
  const b = props.block;
  const eligible = sql`stat.active and (${
    props.statId ? sql`stat.id = ${props.statId}` : sql`true`
  })`;
  const groups = props.statGroups ??
    sql`select null::bigint as stat_id,null::string as group_name,null::bigint as sort_order where false`;
  const period =
    sql`case when stat.frequency = 'weekly' then date.end_of_week(entry_date) else entry_date end`;
  return (
    <ServerShow
      when={sql`(${b.opts.permissions.view}) and (${b.opts.permissions.enter})`}
      fallback={<Alert color="danger">You cannot enter stats.</Alert>}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("entry_date", sql`date.end_of_week(current_date())`);
          s.defScalar("stats_saved", false);
          s.defScalar("stats_requested_date", sql`null::date`);
        }}
      >
        <ServerShow
          when={sql`not exists(select 1 from db.manual_stats stat where ${eligible})`}
        >
          <Alert>No active manual stats.</Alert>
        </ServerShow>
        <Form
          watch={sql`entry_date`}
          beforeUnloadCheck
          afterTransactionStart={(s) => {
            b.validateEntries(
              s,
              sql`select stat_id, period_date, try_cast(value as decimal(18,4)) as value from ui.stats_entry_rows`,
            );
            s.throwErrorIf(
              sql`exists(select 1 from ui.stats_entry_rows input where input.write_db_id is not null and not exists(select 1 from ${
                b.ref(b.entriesTable)
              } entry where entry.id = input.write_db_id and entry.stat_id = input.stat_id and entry.period_date = input.period_date and entry.entered_at = cast(input.entered_at as timestamptz)))`,
              sql.lit`The entry changed. Reload before saving.`,
            );
            s.modify(
              sql`update ui.stats_entry_rows set entered_by = current_user, entered_at = now()`,
            );
          }}
          beforeSubmitClient={(s) => s.setScalar("stats_saved", false)}
          afterSubmitClientSuccess={(s) => {
            s.setScalar("stats_saved", true);
            s.refetch();
          }}
        >
          <div className="sticky top-0 z-10 bg-surface flex flex-wrap items-center justify-between gap-3 py-3 border-b border-divider">
            {props.weekly
              ? (
                <div className="flex items-center gap-2">
                  <IconButton
                    icon="ChevronLeft"
                    aria-label="Previous week"
                    variant="plain"
                    onClick={(s) =>
                      s.setScalar(
                        "stats_requested_date",
                        sql`date.add(day,-7,entry_date)`,
                      )}
                  />
                  <div
                    className="text-center"
                    data-testid="manual-stats-selected-week"
                  >
                    <Typography level="title-sm">
                      {sql`case when entry_date=date.end_of_week(current_date()) then 'This Week' else 'Previous Week' end`}
                    </Typography>
                    <Typography level="body-sm">
                      {sql`'Ending Sunday, ' || format.date(entry_date,'%b %-d, %Y')`}
                    </Typography>
                  </div>
                  <IconButton
                    icon="ChevronRight"
                    aria-label="Next week"
                    variant="plain"
                    disabled={sql`entry_date >= date.end_of_week(current_date())`}
                    onClick={(s) =>
                      s.setScalar(
                        "stats_requested_date",
                        sql`date.add(day,7,entry_date)`,
                      )}
                  />
                </div>
              )
              : (
                <label className="block max-w-xs">
                  Reporting date
                  <Input
                    type="date"
                    aria-label="Reporting date"
                    value={sql`coalesce(stats_requested_date,entry_date)`}
                    onChange={(s) =>
                      s.if(
                        sql`try_cast(target_value as date) is not null`,
                        (s) =>
                          s.setScalar(
                            "stats_requested_date",
                            sql`cast(target_value as date)`,
                          ),
                      )}
                  />
                </label>
              )}
            <Form.SubmitButton>Save values</Form.SubmitButton>
          </div>
          <EntryNavigationGuard />
          <Form.MergeMany
            table={b.entriesTable}
            deleteBehavior="initial"
            stateName="stats_entry_rows"
            fields={[
              "stat_id",
              "period_date",
              "value",
              "note",
              "entered_by",
              "entered_at",
            ]}
            where={sql`stat_id in (select stat.id from db.manual_stats stat where ${eligible}) and period_date = (select case when stat.frequency = 'weekly' then date.end_of_week(entry_date) else entry_date end from db.manual_stats stat where stat.id = stat_id)`}
            initializeSource={sql`select entry.id, stat.id as stat_id, ${period} as period_date, entry.value, entry.note, entry.entered_by, coalesce(entry.entered_at, now()) as entered_at
              from db.manual_stats stat left join db.manual_stat_entries entry on entry.stat_id = stat.id and entry.period_date = ${period}
              where ${eligible} order by (select sort_order from (${groups}) stat_group where stat_group.stat_id=stat.id) nulls last, stat.name, stat.id`}
            filterBeforeSubmit={sql`value is not null or note is not null or write_db_id is not null`}
          >
            <Form.Each recordName="entry">
              <Data
                procedure={(s) =>
                  s.defRecord(
                    "entry_stat",
                    sql`select stat.name, stat.value_format, stat.unit,
                      (select group_name from (${groups}) stat_group where stat_group.stat_id=stat.id) as group_name,
                      not exists(select 1 from (${groups}) earlier join db.manual_stats active_stat on active_stat.id=earlier.stat_id where active_stat.active and earlier.group_name=(select group_name from (${groups}) current_group where current_group.stat_id=stat.id) and earlier.sort_order < (select sort_order from (${groups}) current_group where current_group.stat_id=stat.id)) as starts_group
                      from ${
                      b.ref(b.statsTable)
                    } stat where stat.id = entry.stat_id`,
                  )}
              >
                <Show
                  when={sql`entry_stat.group_name is not null and entry_stat.starts_group`}
                >
                  <div className="px-4 py-3 bg-level1 border-b border-divider">
                    <Typography level="title-sm" color="primary">
                      {sql`entry_stat.group_name`}
                    </Typography>
                  </div>
                </Show>
                <div
                  sx={props.weekly
                    ? {
                      gridTemplateColumns: "minmax(0,1fr) minmax(110px,180px)",
                    }
                    : undefined}
                  className={props.weekly
                    ? "grid items-center gap-3 border-b border-divider px-4 py-2"
                    : "grid gap-3 md:grid-cols-3 border-b border-divider py-4"}
                >
                  <div>
                    <Typography className="break-words">
                      {sql`entry_stat.name`}
                    </Typography>
                    {!props.weekly && (
                      <Typography level="body-xs">
                        {sql`case when entry_stat.value_format = 'duration' then 'Minutes' when entry_stat.value_format = 'currency' then 'Currency amount' else entry_stat.unit end`}
                      </Typography>
                    )}
                  </div>
                  <ValueField
                    field="value"
                    caption={props.weekly ? undefined : "Value"}
                    format={sql`entry_stat.value_format`}
                    label={sql`'Value for ' || entry_stat.name`}
                  />
                  {!props.weekly && (
                    <Form.Field field="note">
                      {(field) => (
                        <label className="min-w-0">
                          <Typography level="body-xs" className="mb-1">
                            Note (optional)
                          </Typography>
                          <Input
                            aria-label={sql`'Note for ' || entry_stat.name`}
                            value={field.value}
                            onInput={(s) =>
                              field.setValue(s, sql`nullif(target_value, '')`)}
                            onBlur={(s) => field.setTouched(s, true)}
                          />
                        </label>
                      )}
                    </Form.Field>
                  )}
                </div>
              </Data>
            </Form.Each>
            <Form.ErrorAlert mode="all" />
          </Form.MergeMany>
        </Form>
        <Show when={sql`stats_saved`}>
          <Alert color="success">Values saved.</Alert>
        </Show>
      </Data>
    </ServerShow>
  );
}

export function ManualMeasurementsPage(
  props: {
    block: ManualMeasurementsBlock;
    path?: string;
    /** Compact weekly entry with guarded previous/next navigation. */
    weekly?: boolean;
    /** One row per stat_id, with group_name and numeric sort_order. */
    statGroups?: Sql;
  },
) {
  const b = props.block;
  return (
    <Route path={props.path ?? "/measurements"}>
      <main
        className="w-full mx-auto p-4 md:p-6"
        sx={{ maxWidth: props.weekly ? "900px" : "1280px" }}
      >
        <Typography level="h2">
          Enter Stats
        </Typography>
        <ManualEntry
          block={b}
          weekly={props.weekly}
          statGroups={props.statGroups}
        />
      </main>
    </Route>
  );
}

export function ManualMeasurementsSetupPage(
  props: {
    block: ManualMeasurementsBlock;
    path?: string;
    /** Create weekly stats without showing a frequency selector. */
    weekly?: boolean;
  },
) {
  const b = props.block;
  return (
    <Route path={props.path ?? "/measurements/setup"}>
      <main className="w-full max-w-7xl mx-auto p-4 md:p-6">
        <Data
          procedure={(s) => {
            b.requirePermission(s, "manage");
            s.defTable(
              "measurements",
              sql`select * from db.manual_stats order by name,id`,
            );
          }}
        >
          <ServerShow when={b.opts.permissions.manage}>
            <div className="flex items-center justify-between gap-3 mb-5">
              <Typography level="h2">Stats</Typography>
              <AutoInsertButton
                table="manual_stats"
                ignoreFields={["active"]}
                values={props.weekly
                  ? { frequency: sql.lit`weekly` }
                  : undefined}
                beforeTransactionStart={(s) => b.requirePermission(s, "manage")}
              >
                Add stat
              </AutoInsertButton>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <Each
                table="measurements"
                recordName="stat"
                eachKey={sql`stat.id`}
              >
                <div className="border border-divider rounded-lg p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Typography level="title-md">
                      {sql`stat.name || case when stat.active then '' else ' (Archived)' end`}
                    </Typography>
                    <Typography level="body-xs">
                      {sql`stat.frequency::string || ' · ' || stat.value_format::string`}
                    </Typography>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <AutoUpdateButton
                      table="manual_stats"
                      recordId={sql`stat.id`}
                      fields={["name", "description"]}
                      variant="plain"
                      size="sm"
                      color="neutral"
                      beforeTransactionStart={(s) =>
                        b.requirePermission(s, "manage")}
                    >
                      Edit
                    </AutoUpdateButton>
                    <ActionButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      action={(s) => {
                        b.requirePermission(s, "manage");
                        s.startTransaction();
                        s.modify(
                          sql`update db.manual_stats set active = not active where id = stat.id`,
                        );
                        s.commitTransaction();
                      }}
                    >
                      {sql`case when stat.active then 'Archive' else 'Restore' end`}
                    </ActionButton>
                  </div>
                </div>
              </Each>
            </div>
          </ServerShow>
        </Data>
      </main>
    </Route>
  );
}

function ServerShow(
  props: {
    when: Sql;
    children: import("std/ui").Node;
    fallback?: import("std/ui").Node;
  },
) {
  return (
    <Data procedure={(s) => s.defScalar("server_visible", props.when)}>
      <Show when={sql`server_visible`} fallback={props.fallback}>
        {props.children}
      </Show>
    </Data>
  );
}
