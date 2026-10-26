import type { SchedulingBlock } from "blocks/scheduling";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import { DateRangeCalendars } from "components/date_range";
import { EachSelect } from "components/each_select";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { DataTable } from "components/data_table";
import { timezoneLongNameExpr } from "components/select_timezone";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { InlineRecordDisplay } from "components/inline_record_display";
import { NavigationItemsSharedContext } from "std/shared_contexts";
import { sql } from "../../std/sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import type { DomStatements } from "std/statements";
import { containerStyles } from "std/style_utils";
import { system, useBlockNamed } from "std/system";
import { Each, Match, Route, Show, Switch, useSharedContext } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import type { ServerTransactionsProcExtensions } from "std/form";
import { Tabs } from "components/tabs";

interface AppointmentProps {
  forAllUsers?: boolean;
  onCancel?: ServerTransactionsProcExtensions<[NumericExpr]>;
  onNoShow?: ServerTransactionsProcExtensions<[NumericExpr]>;
  eventTypeTable?: string;
  appointmentTable: string;
  isDevDefined?: true;
  extraLabel?: Node;
  extraDetailContent?: Node;
}

interface AppointmentPageProps extends AppointmentProps {
  path: string;
}
const tabStyles = {
  py: 4,
  px: 6,
  fontWeight: "medium",
  flex: "initial",
};

const expandRowSx = {
  userSelect: "none",
  display: "flex",
  alignItems: "center",
  gap: 3,
  px: 2,
  py: 2,
  fontSize: "sm",
  fontWeight: "medium",
  textDecoration: "none",
  color: "text-secondary",
  borderRadius: "md",
  cursor: "pointer",
  "&:hover": {
    backgroundColor: "primary-50",
    dark: { backgroundColor: "primary-800" },
  },
  "&:active": {
    backgroundColor: "primary-100",
    dark: { backgroundColor: "primary-700" },
  },
} as const;

function appointmentInviteeName(tableName: string, record: Sql): Sql {
  const table = system.db.tables[tableName];
  if (table.fields.invitee_name) {
    return sql`coalesce(nullif(trim(${record}.invitee_name), ''), 'Invitee')`;
  }
  if (table.fields.invitee_first_name || table.fields.invitee_last_name) {
    const firstName = table.fields.invitee_first_name
      ? sql`coalesce(${record}.invitee_first_name, '')`
      : sql.lit``;
    const lastName = table.fields.invitee_last_name
      ? sql`coalesce(${record}.invitee_last_name, '')`
      : sql.lit``;
    const email = table.fields.invitee_email
      ? sql`${record}.invitee_email`
      : sql.null;
    return sql`coalesce(
      nullif(trim(${firstName} || ' ' || ${lastName}), ''),
      ${email},
      'Invitee'
    )`;
  }
  if (table.fields.invitee_email) {
    return sql`coalesce(${record}.invitee_email, 'Invitee')`;
  }
  return sql.lit`Invitee`;
}

function ExpandableAppointmentRow({
  label,
  children,
}: {
  label: Node;
  children: Node;
}) {
  return (
    <>
      <div
        sx={expandRowSx}
        onClick={(s) => {
          s.setScalar(
            "expanded_appointment_id",
            sql`case when expanded_appointment_id = appointment_record.id then null else appointment_record.id end`,
          );
        }}
      >
        {label}
        <div className="grow" />
        <Show
          when={sql`expanded_appointment_id = appointment_record.id`}
          fallback={
            <>
              Details
              <MaterialIcon icon="KeyboardArrowRight" />
            </>
          }
        >
          Details
          <MaterialIcon icon="KeyboardArrowDown" />
        </Show>
      </div>
      <Show when={sql`expanded_appointment_id = appointment_record.id`}>
        {children}
      </Show>
    </>
  );
}

function Appointments(props: AppointmentProps) {
  const {
    onCancel,
    onNoShow,
    forAllUsers,
    appointmentTable,
    eventTypeTable,
    isDevDefined = true,
    extraLabel,
    extraDetailContent,
  } = props;
  if (!(eventTypeTable || isDevDefined)) {
    throw new Error("eventTypeTable is required");
  }
  const timezoneLongName = timezoneLongNameExpr(sql`display_timezone`);
  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_tab", {
          expr: sql.lit`upcoming`,
          allowNoRead: true,
        });
        s.defScalar(
          "display_timezone",
          sql`(select timezone from sys_users where id = current_user)`,
        );
        s.defScalar("expanded_appointment_id", { type: "BigInt" });
        if (!forAllUsers) {
          s.defScalar("current_user_id", sql`current_user`);
        }
        if (forAllUsers) {
          s.defScalar("filter_agent_id", { type: "BigInt" });
          s.defScalar("filter_invitee_name", sql.lit``);
        }
      }}
    >
      <div
        sx={{
          ...containerStyles(),
          mt: 4,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          maxWidth: "1200px",
          mx: "auto",
        }}
      >
        <div className="flex justify-between items-start flex-col">
          <Typography level="h3" component="div" className="font-semibold">
            Meetings
            {!forAllUsers && (
              <>
                {" "}
                for{" "}
                <InlineRecordDisplay
                  tableName="sys_users"
                  id={sql`current_user_id`}
                />
              </>
            )}
          </Typography>
          <Typography level="body-sm">
            Times shown in {sql`${timezoneLongName}`}
          </Typography>
        </div>

        {
          /* <Show when={sql`status = 'failed'`}>
            <Alert
              color="danger"
              startDecorator={<MaterialIcon icon="Report" />}
            >
              Failed to load appointments
            </Alert>
          </Show>
          <Show when={sql`status != 'received' and status != 'failed'`}>
            <Skeleton variant="text" level="h1" className="mb-4 w-full" />
          </Show>
          <Show when={sql`status = 'received'`}> */
        }
        <Sheet
          variant="outlined"
          className="shadow-sm rounded-xl overflow-hidden"
        >
          {forAllUsers && (
            <div className="flex items-center justify-between gap-4 p-4 border-b border-divider">
              <div className="flex items-center gap-4">
                <Data
                  procedure={(s) => {
                    const { db } = system;
                    s.defTable(
                      "available_agents",
                      sql`select id, ${db.tables.sys_users.getRecordDisplayNameExpr()} as name
                          from sys_users
                          where id in (
                            select distinct sys_user_id
                            from ${sql.ref(appointmentTable)}
                          )
                          order by name`,
                    );
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Typography level="body-sm">
                      Filter by Agent:
                    </Typography>
                    <EachSelect
                      size="sm"
                      color="neutral"
                      variant="outlined"
                      value={sql`filter_agent_id`}
                      table="available_agents"
                      optionLabel="name"
                      optionValue="id"
                      placeholder="All agents"
                      watch={[sql`filter_agent_id`]}
                      onChange={(s) => {
                        s.setScalar(
                          "filter_agent_id",
                          sql`cast(target_value as bigint)`,
                        );
                      }}
                      className="min-w-[200px]"
                    />
                  </div>
                </Data>
                <div className="flex items-center gap-2">
                  <Typography level="body-sm">
                    Filter by Invitee:
                  </Typography>
                  <Input
                    size="sm"
                    placeholder="Search by name..."
                    value={sql`filter_invitee_name`}
                    onInput={(s) => {
                      s.setScalar("filter_invitee_name", sql`target_value`);
                    }}
                    className="min-w-[200px]"
                  />
                </div>
              </div>
              <Show
                when={sql`filter_agent_id is not null or filter_invitee_name != ''`}
              >
                <Button
                  variant="plain"
                  color="neutral"
                  size="sm"
                  startIcon="Clear"
                  onClick={(s) => {
                    s.setScalar("filter_agent_id", sql`null`);
                    s.setScalar("filter_invitee_name", sql.lit``);
                  }}
                >
                  Clear filters
                </Button>
              </Show>
            </div>
          )}
          <Tabs selectedTabScalar="selected_tab" defaultValue="upcoming">
            <Tabs.List
              sx={{
                "--tab-indicator-thickness": "3px",
                borderBottom: "1px solid",
                borderColor: "divider",
                px: 2,
              }}
            >
              <Tabs.Tab
                value="upcoming"
                sx={tabStyles}
                selectedColor="primary"
              >
                Upcoming
              </Tabs.Tab>
              <Tabs.Tab
                value="past"
                sx={tabStyles}
                selectedColor="primary"
              >
                Past
              </Tabs.Tab>
              <Tabs.Tab
                value="date_range"
                sx={tabStyles}
                selectedColor="primary"
              >
                Date Range
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="upcoming" className="p-4">
              <AppointmentList
                name="upcoming_appointments"
                appointmentTable={appointmentTable}
                filter={sql`start_time::date >= current_date()`}
                onCancel={onCancel}
                onNoShow={onNoShow}
                forAllUsers={forAllUsers}
                eventTypeTable={eventTypeTable!}
                isDevDefined={isDevDefined}
                order={sql`asc`}
                windowed="forward"
                filterAgentId={forAllUsers ? sql`filter_agent_id` : undefined}
                filterInviteeName={forAllUsers
                  ? sql`filter_invitee_name`
                  : undefined}
                extraLabel={extraLabel}
                extraDetailContent={extraDetailContent}
              />
            </Tabs.Panel>

            <Tabs.Panel value="past" className="p-4">
              <AppointmentList
                name="past_appointments"
                appointmentTable={appointmentTable}
                eventTypeTable={eventTypeTable!}
                filter={sql`start_time::date < current_date()`}
                onCancel={onCancel}
                onNoShow={onNoShow}
                forAllUsers={forAllUsers}
                isDevDefined={isDevDefined}
                order={sql`desc`}
                windowed="backward"
                filterAgentId={forAllUsers ? sql`filter_agent_id` : undefined}
                filterInviteeName={forAllUsers
                  ? sql`filter_invitee_name`
                  : undefined}
                extraLabel={extraLabel}
                extraDetailContent={extraDetailContent}
              />
            </Tabs.Panel>

            <Tabs.Panel value="date_range" className="p-4">
              <Data
                local
                procedure={(s) => {
                  s.defScalar("start_date", sql`current_date()`);
                  s.defScalar(
                    "end_date",
                    sql`date.add(day, 14, current_date())`,
                  );
                }}
              >
                <DateRangeCalendars
                  startDate={sql`start_date`}
                  endDate={sql`end_date`}
                  onStartDateChange={(s, newStartDate) => {
                    s.setScalar("start_date", newStartDate);
                  }}
                  onEndDateChange={(s, newEndDate) => {
                    s.setScalar("end_date", newEndDate);
                  }}
                  className="mt-4 mb-8"
                />
                <AppointmentList
                  name="date_range_appointments"
                  appointmentTable={appointmentTable}
                  watch={[sql`start_date`, sql`end_date`]}
                  filter={sql`start_time::date >= start_date and start_time::date <= end_date`}
                  onCancel={onCancel}
                  onNoShow={onNoShow}
                  forAllUsers={forAllUsers}
                  eventTypeTable={eventTypeTable!}
                  isDevDefined={isDevDefined}
                  order={sql`asc`}
                  filterAgentId={forAllUsers ? sql`filter_agent_id` : undefined}
                  filterInviteeName={forAllUsers
                    ? sql`filter_invitee_name`
                    : undefined}
                  extraLabel={extraLabel}
                />
              </Data>
            </Tabs.Panel>
          </Tabs>
        </Sheet>
        {/* </Show> */}
      </div>
    </Data>
  );
}

/**
 * Self-routing page listing a host's (or, with `forAllUsers`, every host's)
 * appointments split into Upcoming / Past / Date Range tabs, with cancel,
 * no-show, reassign, reschedule, CSV export and notification-status actions.
 * Also registers itself as a navigation item. Mount it directly; do not wrap
 * it in a `<Route>`.
 *
 * @param props.path - Route path the page mounts at.
 * @param props.appointmentTable - Table storing appointment rows.
 * @param props.eventTypeTable - Table storing event types (omit only for
 *   dev-defined event types, where `isDevDefined` is set).
 *
 * @category Page Component
 */
export function AppointmentsPage(props: AppointmentPageProps) {
  useSharedContext(NavigationItemsSharedContext).add({
    label: "Appointments",
    url: props.path,
  });
  return (
    <Route path={props.path}>
      <Appointments {...props} />
    </Route>
  );
}

function AppointmentList({
  appointmentTable,
  filter,
  watch,
  onCancel,
  onNoShow,
  name,
  forAllUsers,
  order,
  windowed,
  filterAgentId,
  filterInviteeName,
  extraLabel,
  extraDetailContent,
}: {
  name: string;
  appointmentTable: string;
  eventTypeTable: string;
  filter: BooleanExpr;
  order: Sql;
  watch?: AnyExpr[];
  windowed?: "forward" | "backward";
  onCancel?: ServerTransactionsProcExtensions<[NumericExpr]>;
  onComplete?: ServerTransactionsProcExtensions<[NumericExpr]>;
  onNoShow?: ServerTransactionsProcExtensions<[NumericExpr]>;
  forAllUsers?: boolean;
  isDevDefined?: boolean;
  filterAgentId?: NumericExpr;
  filterInviteeName?: Sql;
  extraLabel?: Node;
  extraDetailContent?: Node;
}) {
  const userFilter = forAllUsers ? sql`` : sql`and sys_user_id = current_user`;

  // Build additional filters for agent and invitee name
  const agentFilter = filterAgentId
    ? sql` and (${filterAgentId} is null or sys_user_id = ${filterAgentId})`
    : sql``;
  const table = system.db.tables[appointmentTable];
  const hasFirstLastName = table.fields.invitee_first_name &&
    table.fields.invitee_last_name;
  const inviteeNameExpr = hasFirstLastName
    ? sql`coalesce(invitee_first_name, '') || ' ' || coalesce(invitee_last_name, '')`
    : table.fields.invitee_name
    ? sql`invitee_name`
    : table.fields.invitee_email
    ? sql`invitee_email`
    : sql.lit``;
  const inviteeNameFilter = filterInviteeName
    ? sql` and (${filterInviteeName} = '' or lower(${inviteeNameExpr}) like '%' || lower(${filterInviteeName}) || '%')`
    : sql``;
  const windowFilter = windowed === "forward"
    ? sql` and start_time::date < date.add(day, window_days, current_date())`
    : windowed === "backward"
    ? sql` and start_time::date >= date.add(day, -window_days, current_date())`
    : sql``;
  const additionalFilters =
    sql`${agentFilter}${inviteeNameFilter}${windowFilter}`;
  const { db } = system;
  const agentNameExpr = db.tables.sys_users.getRecordDisplayNameExpr();
  const agentNameSubquery =
    sql`(select ${agentNameExpr} from sys_users where sys_users.id = ${
      sql.ref(appointmentTable)
    }.sys_user_id)`;
  const appointmentRecordsQuery = sql`select ${
    sql.ref(appointmentTable)
  }.*, ${agentNameSubquery} as agent_name
      from ${sql.ref(appointmentTable)}
      where ${filter} ${userFilter}${additionalFilters}`;

  const inner = (
    <Data
      local
      watch={watch
        ? [
          ...watch,
          ...(filterAgentId ? [filterAgentId] : []),
          ...(filterInviteeName ? [filterInviteeName] : []),
          ...(windowed ? [sql`window_days` as AnyExpr] : []),
        ]
        : (filterAgentId || filterInviteeName || windowed
          ? [
            filterAgentId,
            filterInviteeName,
            windowed ? sql`window_days` : undefined,
          ].filter(Boolean) as AnyExpr[]
          : undefined)}
      procedure={(s) => {
        s.defScalar("appointment_status", sql.lit``);
      }}
    >
      <Data
        watch={watch
          ? [
            ...watch,
            ...(filterAgentId ? [filterAgentId] : []),
            ...(filterInviteeName ? [filterInviteeName] : []),
            ...(windowed ? [sql`window_days` as AnyExpr] : []),
          ]
          : (filterAgentId || filterInviteeName || windowed
            ? [
              filterAgentId,
              filterInviteeName,
              windowed ? sql`window_days` : undefined,
            ].filter(Boolean) as AnyExpr[]
            : undefined)}
        procedure={(s) => {
          s.defTable(
            `${name}_found`,
            appointmentRecordsQuery,
          );
        }}
      >
        <div>
          <Data
            watch={watch
              ? [
                ...watch,
                ...(filterAgentId ? [filterAgentId] : []),
                ...(filterInviteeName ? [filterInviteeName] : []),
              ]
              : (filterAgentId || filterInviteeName
                ? [filterAgentId, filterInviteeName].filter(
                  Boolean,
                ) as AnyExpr[]
                : undefined)}
            procedure={(s) => {
              s.defTable(
                name,
                sql`select distinct start_time::date as start_date
              from ${sql.ref(`${name}_found`)}
              order by start_date ${order}`,
              );
              s.defScalar(
                "exist_appointemnts",
                sql`exists (select 1 from ${sql.ref(name)})`,
              );
            }}
          >
            <Show
              when={sql`not exist_appointemnts`}
            >
              <div>No appointments found</div>
            </Show>
            <Each table={name} recordName="appointment_day">
              <div
                sx={{
                  borderBottom: "1px solid",
                  borderTop: "1px solid",
                  borderColor: "neutral-300",
                  padding: 2,
                  backgroundColor: "neutral-100",
                  dark: {
                    borderColor: "neutral-700",
                    backgroundColor: "neutral-800",
                  },
                }}
              >
                <Typography level="body-md" className="font-semibold ">
                  {sql`format.date(appointment_day.start_date, '%A, %B %-d, %Y')`}
                </Typography>
              </div>

              <Each
                table={`${name}_found`}
                recordName="appointment_record"
                where={sql`appointment_record.start_time >= appointment_day.start_date and appointment_record.start_time < date.add(day, 1, appointment_day.start_date)`}
                orderBy={sql`appointment_record.start_time asc, appointment_record.id asc`}
              >
                {
                  <DevDefinedAppointmentItem
                    onCancel={onCancel}
                    onNoShow={onNoShow}
                    forAllUsers={forAllUsers}
                    appointmentTable={appointmentTable}
                    extraLabel={extraLabel}
                    extraDetailContent={extraDetailContent}
                  />
                }
              </Each>
            </Each>
          </Data>
        </div>
      </Data>
    </Data>
  );
  if (!windowed) {
    return inner;
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("window_days", sql`15`);
      }}
    >
      {inner}
      <div className="flex justify-center mt-4">
        <Button
          variant="soft"
          color="neutral"
          size="sm"
          startIcon={windowed === "forward" ? "ChevronRight" : "History"}
          onClick={(s) => {
            s.setScalar("window_days", sql`window_days + 15`);
          }}
        >
          {windowed === "forward"
            ? "Load 15 more days forward"
            : "Load 15 more days back"}
          {" ("}
          {sql`window_days`} days{")"}
        </Button>
      </div>
    </Data>
  );
}

// Helper component for consistent field display
function InfoField({
  label,
  value,
}: {
  label: string;
  value: AnyExpr;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
        {label}
      </Typography>
      <Typography level="body-md">
        {value}
      </Typography>
    </div>
  );
}

function DevDefinedAppointmentItem({
  onCancel,
  onNoShow,
  forAllUsers,
  appointmentTable,
  extraLabel,
  extraDetailContent,
}: {
  forAllUsers?: boolean;
  onCancel?: ServerTransactionsProcExtensions<[NumericExpr]>;
  onNoShow?: ServerTransactionsProcExtensions<[NumericExpr]>;
  appointmentTable: string;
  extraLabel?: Node;
  extraDetailContent?: Node;
}) {
  const schedulingBlock = useBlockNamed<SchedulingBlock>("SchedulingBlock");
  const eventType = schedulingBlock.getDevDefinedEventType(appointmentTable);
  const table = system.db.tables[appointmentTable];

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("reassign_appointment", false);
        s.defScalar("changing_status", false);
      }}
    >
      <ExpandableAppointmentRow
        label={
          <AppointmentCollapseLabel
            forAllUsers={forAllUsers}
            eventTypeName={eventType?.displayName ?? ""}
            isDevDefined
            inviteeName={appointmentInviteeName(
              appointmentTable,
              sql.ref("appointment_record"),
            )}
            extraLabel={extraLabel}
          />
        }
      >
        <div
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            gap: 3,
            p: 4,
            borderRadius: "md",
            boxShadow: "sm",
          }}
        >
          <div sx={{ gridColumnSpan: 12 }}>
            <Switch>
              <Match
                when={sql`${
                  sql.ref("appointment_record")
                }.start_time at time zone ${
                  sql.ref("display_timezone")
                } <= now() at time zone ${sql.ref("display_timezone")}
                  and appointment_record.status = 'scheduled'`}
              >
                <div className="flex gap-4">
                  <Button
                    variant="soft"
                    color="danger"
                    startIcon="Cancel"
                    onClick={(s) => {
                      s.setScalar("appointment_status", sql.lit`no_show`);
                      s.setScalar("changing_status", true);
                    }}
                  >
                    Mark as No Show
                  </Button>
                </div>
              </Match>
              <Match
                when={sql`appointment_record.status = 'scheduled' and appointment_record.start_time > now()`}
              >
                <div className="flex gap-4">
                  <Button
                    variant="soft"
                    color="danger"
                    startIcon="Cancel"
                    onClick={(s) => {
                      s.setScalar(
                        "appointment_status",
                        sql.lit`cancelled_by_host`,
                      );
                      s.setScalar("changing_status", true);
                    }}
                    className="w-[15%]"
                  >
                    Cancel
                  </Button>
                  <Show when={forAllUsers ? sql`true` : sql`false`}>
                    <Button
                      variant="soft"
                      color="neutral"
                      startIcon="PersonOutline"
                      onClick={(s) => {
                        s.setScalar("reassign_appointment", true);
                      }}
                      className="mx-4 w-[15%]"
                    >
                      Reassign
                    </Button>
                  </Show>
                  <Data
                    procedure={(s) => {
                      s.defRecord(
                        "full_appointment_record",
                        sql`select * from db.${
                          sql.ref(appointmentTable)
                        } where id = appointment_record.id`,
                      );
                    }}
                  >
                    <Button
                      variant="soft"
                      color="primary"
                      startIcon="CalendarMonth"
                      onClick={(s) => {
                        s.location.assign(
                          sql.concat(
                            "https://",
                            eventType?.schedulingDomain,
                            eventType?.schedulingPath,
                            sql.lit`/`,
                            sql`full_appointment_record.public_id`,
                            sql.lit`/reschedule`,
                          ),
                        );
                      }}
                      className="w-[15%]"
                    >
                      Reschedule
                    </Button>
                  </Data>
                </div>
              </Match>
            </Switch>

            {/* TODO there seems to be a rust bug where the appointment_record.id is always 0 when put just below the read.each */}
            <Data
              local
              procedure={(s) => {
                s.defScalar("reason_scalar", sql.lit``);
              }}
            >
              <ConfirmDangerDialog
                bindScalar="changing_status"
                description={
                  <>
                    <span className="mb-4">
                      Are you sure you want to
                      {sql`case when appointment_status = 'cancelled_by_host' then ' cancel this appointment?'
                  when appointment_status = 'no_show' then ' mark this appointment as no show?'

                  end`}
                    </span>
                    <Input
                      placeholder={sql.lit`Enter reason for cancellation`}
                      bindScalar="reason_scalar"
                      className="mt-4"
                    />
                  </>
                }
                onConfirm={(s) => {
                  s.setScalar("dialog_waiting", true);
                  s.commitUiTreeChanges();
                  s.defScalar("appointment_id", {
                    type: "BigInt",
                    expr: sql`appointment_record.id`,
                    allowNoRead: true,
                  });

                  s.if(
                    sql`appointment_status = 'cancelled_by_host' or appointment_status = 'cancelled_by_admin'`,
                    (s) => {
                      onCancel?.beforeSubmitClient?.(s, sql`appointment_id`);
                      s.tryServer({
                        body: (s) => {
                          onCancel?.beforeTransactionStart?.(
                            s,
                            sql`appointment_id`,
                          );
                          s.startTransaction();
                          onCancel?.afterTransactionStart?.(
                            s,
                            sql`appointment_id`,
                          );

                          s.if(
                            sql`not exists(
                              select 1 from db.${sql.ref(appointmentTable)}
                              where id = appointment_id
                                and status = 'scheduled'
                            )`,
                            (s) => {
                              s.throwError(
                                sql
                                  .lit`This appointment can no longer be cancelled.`,
                              );
                            },
                          );

                          s.modify(
                            sql`update db.${
                              sql.ref(appointmentTable)
                            } set status = appointment_status ::enums.scheduling_appointment_status,
                                cancel_reason = reason_scalar,
                                cancelled_at = now()
                              where id = appointment_id
                                and status = 'scheduled'`,
                          );
                          schedulingBlock
                            .retirePendingAppointmentMutationTasks(s, {
                              appointmentTable,
                              appointmentId: sql`appointment_id`,
                            });
                          onCancel?.beforeTransactionCommit?.(
                            s,
                            sql`appointment_id`,
                          );
                          if (eventType) {
                            schedulingBlock.enqueueDevDefinedAppointmentTasks(
                              s,
                              {
                                eventType,
                                appointmentId: sql`appointment_id`,
                                change: "cancelled",
                                insideTransaction: true,
                              },
                            );
                          } else {
                            for (
                              const taskType of [
                                "calendar_delete",
                                "meeting_delete",
                              ]
                            ) {
                              schedulingBlock.enqueueBackgroundTask(s, {
                                taskType,
                                appointmentTable,
                                appointmentId: sql`appointment_id`,
                                insideTransaction: true,
                              });
                            }
                          }
                          s.commitTransaction();
                          onCancel?.afterTransactionCommit?.(
                            s,
                            sql`appointment_id`,
                          );
                          s.refetch();
                        },
                        errorName: "change_status_error",
                        catch: (s) => {
                          s.setScalar("dialog_error", sql.lit`Cancel failed`);
                        },
                      });
                    },
                  );

                  s.if(sql`appointment_status = 'no_show'`, (s) => {
                    onNoShow?.beforeSubmitClient?.(s, sql`appointment_id`);
                    s.tryServer({
                      body: (s) => {
                        onNoShow?.beforeTransactionStart?.(
                          s,
                          sql`appointment_id`,
                        );
                        s.startTransaction();
                        onNoShow?.afterTransactionStart?.(
                          s,
                          sql`appointment_id`,
                        );
                        s.defScalar(
                          "is_early",
                          sql`(
                            select
                              (
                                select count(*) * 24 < 48
                                from series.daily(
                                  appointment_record.start_time::date,
                                  date.diff(day, appointment_record.start_time::date, current_date())
                                ) as dates
                                where extract(dow from dates.value) between 1 and 5
                                and dates.value <= current_date()
                              )
                              and extract(dow from appointment_record.start_time) between 1 and 5
                          )`,
                        );
                        s.conditional({
                          condition: sql`is_early`,
                          then: (s) => {
                            s.modify(
                              sql`update db.${
                                sql.ref(appointmentTable)
                              } set status = 'no_show_early'
                                where id = appointment_id
                                  and status = 'scheduled'`,
                            );
                          },
                          else: (s) => {
                            s.modify(
                              sql`update db.${
                                sql.ref(appointmentTable)
                              } set status = 'no_show'
                                where id = appointment_id
                                  and status = 'scheduled'`,
                            );
                            // if (schedulingBlock.opts.webhooks) {
                            //   system.block(OutgoingWebhooksBlock).trigger(s, {
                            //     recordId: sql`appointment_id`,
                            //     type: "appointment_no_show",
                            //   });
                            // }
                          },
                        });
                        s.if(
                          sql`not exists(
                            select 1 from db.${sql.ref(appointmentTable)}
                            where id = appointment_id
                              and status in ('no_show', 'no_show_early')
                          )`,
                          (s) => {
                            s.throwError(
                              sql
                                .lit`This appointment can no longer be marked as no show.`,
                            );
                          },
                        );

                        onNoShow?.beforeTransactionCommit?.(
                          s,
                          sql`appointment_id`,
                        );
                        s.commitTransaction();
                        onNoShow?.afterTransactionCommit?.(
                          s,
                          sql`appointment_id`,
                        );
                        s.refetch();
                      },
                      errorName: "change_status_error",
                      catch: (s) => {
                        s.setScalar("dialog_error", sql.lit`Cancel failed`);
                      },
                    });
                  });
                  s.setScalar("dialog_waiting", false);
                  s.setScalar("changing_status", false);
                }}
              />
            </Data>
            <Show when={forAllUsers ? sql`reassign_appointment` : sql`false`}>
              <Data
                procedure={(s) => {
                  const { db } = system;
                  s.defScalar("reassign_reason_scalar", sql.lit``);
                  s.defScalar("selected_user_id", {
                    type: "BigInt",
                  });
                  s.defRecord(
                    "full_appointment_record",
                    sql`select * from db.${
                      sql.ref(appointmentTable)
                    } where id = appointment_record.id`,
                  );
                  s.defScalar(
                    "reassignment_timezone",
                    sql`date.part(timezone, full_appointment_record.start_time)`,
                  );
                  s.defScalar(
                    "reassignment_start",
                    sql`full_appointment_record.start_time at time zone reassignment_timezone`,
                  );

                  schedulingBlock.getAvailableSlotsForDay(s, {
                    date: sql`reassignment_start::date`,
                    slotsTable: "available_slots_for_day",
                    filterUserId: (userId) =>
                      eventType?.sysUserFilter
                        ? sql`${userId} in (select id from sys_users where ${
                          eventType.sysUserFilter(sql.ref("sys_users"))
                        })`
                        : sql.true,
                    userTimezone: sql`reassignment_timezone`,
                    bufferBefore: sql`${eventType?.bufferBefore ?? 0}`,
                    bufferAfter: sql`${eventType?.bufferAfter ?? 0}`,
                    minNotice: sql`${eventType?.minNotice ?? 0}`,
                    maxNotice: sql`${eventType?.maxNotice ?? 0}`,
                    duration: sql`${eventType?.duration ?? 0}`,
                    timeSlotsInterval: sql`${
                      eventType?.timeSlotsInterval ?? 30
                    }`,
                  });
                  s.defTable(
                    "available_agents",
                    sql`select id,(
                      ${db.tables.sys_users.getRecordDisplayNameExpr()}
                    ) as name
                    from sys_users
                    where id in (
                      select sys_user_id from available_slots_for_day
                      where start_time = reassignment_start
                        and date = reassignment_start::date
                    )
                    and full_appointment_record.sys_user_id != id`,
                  );
                }}
              >
                <ConfirmDangerDialog
                  bindScalar="reassign_appointment"
                  description={
                    <Show
                      when={sql`(exists(select 1 from available_agents))`}
                      fallback={
                        <Typography level="body-md" sx={{ color: "darkred" }}>
                          No agents available at the appointment time
                        </Typography>
                      }
                    >
                      <span className="mb-4">
                        Are you sure you want to reassign this appointment?
                      </span>
                      <EachSelect
                        size="md"
                        color="neutral"
                        variant="outlined"
                        id="selected_user_id"
                        value={sql`selected_user_id`}
                        table="available_agents"
                        optionLabel="name"
                        optionValue="id"
                        onChange={(s) => {
                          s.setScalar(
                            "selected_user_id",
                            sql`cast(target_value as bigint)`,
                          );
                        }}
                        className="mt-4"
                      />
                      <Input
                        placeholder={sql.lit`Enter reason for reassignment`}
                        bindScalar="reassign_reason_scalar"
                        className="mt-4"
                      />
                    </Show>
                  }
                  disableConfirmButton={sql`not exists(select 1 from available_agents)`}
                  onConfirm={(s) => {
                    s.conditional({
                      condition: sql`selected_user_id is null`,
                      then: (s) => {
                        s.setScalar("dialog_error", sql.lit`No agent selected`);
                      },
                      else: (s) => {
                        s.setScalar("dialog_waiting", true);
                        s.commitUiTreeChanges();
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.defRecord(
                              "dev_reassignment_appointment",
                              sql`select * from db.${sql.ref(appointmentTable)}
                                where id = appointment_record.id
                                  and status = 'scheduled'`,
                            );
                            s.if(
                              sql`dev_reassignment_appointment.id is null`,
                              (s) => {
                                s.throwError(
                                  sql
                                    .lit`This appointment can no longer be reassigned.`,
                                );
                              },
                            );
                            schedulingBlock.assertDevDefinedUserAvailable(s, {
                              appointmentTable,
                              appointmentId:
                                sql`dev_reassignment_appointment.id`,
                              userId: sql`selected_user_id`,
                              selectedTime:
                                sql`dev_reassignment_appointment.start_time at time zone date.part(timezone, dev_reassignment_appointment.start_time)`,
                              selectedDate:
                                sql`(dev_reassignment_appointment.start_time at time zone date.part(timezone, dev_reassignment_appointment.start_time))::date`,
                              userTimezone:
                                sql`date.part(timezone, dev_reassignment_appointment.start_time)`,
                            });
                            schedulingBlock.transferDevDefinedAppointmentHost(
                              s,
                              {
                                eventType: eventType!,
                                appointmentRecord: sql.ref(
                                  "dev_reassignment_appointment",
                                ),
                                newUserId: sql`selected_user_id`,
                                reason: sql`reassign_reason_scalar`,
                              },
                            );
                            if (
                              eventType?.notifications?.inviteeRescheduleEmail
                            ) {
                              schedulingBlock.enqueueBackgroundTask(s, {
                                taskType: "email_dev",
                                appointmentTable,
                                appointmentId:
                                  sql`dev_reassignment_appointment.id`,
                                emailType: "invitee_reschedule_email",
                                externalResourceId:
                                  sql`(select cast(public_id as string) from db.${
                                    sql.ref(appointmentTable)
                                  } where id = dev_reassignment_appointment.id)`,
                                insideTransaction: true,
                              });
                            }
                            if (eventType?.notifications?.hostRescheduleEmail) {
                              schedulingBlock.enqueueBackgroundTask(s, {
                                taskType: "email_dev",
                                appointmentTable,
                                appointmentId:
                                  sql`dev_reassignment_appointment.id`,
                                emailType: "host_reschedule_email",
                                targetUserId: sql`(select sys_user_id from db.${
                                  sql.ref(appointmentTable)
                                } where id = dev_reassignment_appointment.id)`,
                                externalResourceId:
                                  sql`(select cast(public_id as string) from db.${
                                    sql.ref(appointmentTable)
                                  } where id = dev_reassignment_appointment.id)`,
                                insideTransaction: true,
                              });
                            }
                            s.commitTransaction();
                            s.refetch();
                            s.setScalar("dialog_waiting", false);
                            s.setScalar("reassign_appointment", false);
                          },
                          errorName: "reassign_error",
                          catch: (s) => {
                            s.setScalar(
                              "dialog_error",
                              sql.lit`Reassign failed`,
                            );
                          },
                        });
                      },
                    });
                  }}
                />
              </Data>
            </Show>
          </div>

          <div
            sx={{
              gridColumnSpan: 12,
              md: { gridColumnSpan: 6 },
            }}
          >
            <Typography level="title-md" sx={{ mb: 2, color: "primary.main" }}>
              Contact Information
            </Typography>

            <div className="flex flex-col gap-6">
              {(table.fields.invitee_name ||
                table.fields.invitee_first_name ||
                table.fields.invitee_last_name) && (
                <InfoField
                  label="Invitee Name"
                  value={appointmentInviteeName(
                    appointmentTable,
                    sql.ref("appointment_record"),
                  )}
                />
              )}
              {table.fields.invitee_email && (
                <InfoField
                  label="Email"
                  value={sql`coalesce(appointment_record.invitee_email, 'Not provided')`}
                />
              )}
              {table.fields.invitee_phone && (
                <InfoField
                  label="Phone"
                  value={sql`coalesce(cast(appointment_record.invitee_phone as string), 'Not provided')`}
                />
              )}
              {table.fields.reason && (
                <InfoField
                  label="Reason"
                  value={sql`coalesce(appointment_record.reason, 'Not provided')`}
                />
              )}
            </div>
          </div>

          <div
            sx={{
              gridColumnSpan: 12,
              md: { gridColumnSpan: 6 },
            }}
          >
            <Typography level="title-md" sx={{ mb: 2, color: "primary.main" }}>
              Appointment Details
            </Typography>

            <div className="flex flex-col gap-6">
              {/* <InfoField label="Event Type" value="event_type_id.displayName" /> */}

              <div className="flex flex-col gap-2 w-fit">
                <Typography level="body-sm" sx={{ color: "text.tertiary" }}>
                  Status
                </Typography>
                <Switch>
                  <Match
                    when={sql`appointment_record.status = 'cancelled_by_invitee'`}
                  >
                    <Chip variant="soft" color="danger">
                      Cancelled by Invitee
                    </Chip>
                    <Show
                      when={sql`appointment_record.cancel_reason is not null`}
                    >
                      <Typography level="body-sm" sx={{ color: "darkred" }}>
                        Reason: {sql`appointment_record.cancel_reason`}
                      </Typography>
                    </Show>
                  </Match>
                  <Match
                    when={sql`appointment_record.status = 'cancelled_by_host'`}
                  >
                    <div className="w-fit">
                      <Chip variant="soft" color="danger">
                        Cancelled by Host
                      </Chip>
                    </div>
                    <Show
                      when={sql`appointment_record.cancel_reason is not null`}
                    >
                      <Typography level="body-sm" sx={{ color: "darkred" }}>
                        Reason: {sql`appointment_record.cancel_reason`}
                      </Typography>
                    </Show>
                  </Match>

                  <Match when={sql`appointment_record.status = 'no_show'`}>
                    <Chip variant="soft" color="danger">
                      No Show
                    </Chip>
                  </Match>
                  <Match
                    when={sql`appointment_record.status = 'no_show_early'`}
                  >
                    <Chip variant="soft" color="warning">
                      No Show - Marked Early
                    </Chip>
                  </Match>
                  <Match
                    when={sql`appointment_record.status = 'scheduled' and appointment_record.start_time > now()`}
                  >
                    <div className="w-fit">
                      <Chip variant="soft" color="neutral">
                        Scheduled
                      </Chip>
                    </div>

                    <Show
                      when={sql`appointment_record.reschedule_reason is not null`}
                    >
                      <Typography level="body-sm" sx={{ color: "darkgreen" }}>
                        Rescheduled Reason:{" "}
                        {sql`appointment_record.reschedule_reason`}
                      </Typography>
                    </Show>
                  </Match>
                </Switch>
              </div>
            </div>
          </div>
          {extraDetailContent && (
            <div sx={{ gridColumnSpan: 12 }}>
              {extraDetailContent}
            </div>
          )}
        </div>
      </ExpandableAppointmentRow>
    </Data>
  );
}

function AppointmentCollapseLabel({
  forAllUsers,
  eventTypeName,
  inviteeName,
  extraLabel,
}: {
  forAllUsers?: boolean;
  eventTypeName: string;
  inviteeName: Sql;
  isDevDefined?: boolean;
  extraLabel?: Node;
}) {
  return (
    <div
      sx={{
        display: "flex",
        justifyContent: "space-between",
        py: 2,
        px: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <div className="flex gap-6 items-center">
        <Typography
          level="body-md"
          sx={{
            minWidth: "150px",
            color: "primary.main",

            fontWeight: "medium",
          }}
        >
          {sql`concat(
              format.date(
                (appointment_record.start_time at time zone display_timezone),
                '%-I:%M%P'
              ),
              ' - ',
              format.date(
                date.add(minute, appointment_record.duration, (appointment_record.start_time at time zone display_timezone)),
                '%-I:%M%P'
              )
            )`}
          {" "}
        </Typography>

        <div className="flex flex-col gap-2">
          <Typography level="body-md" className="font-semibold" component="div">
            {inviteeName}
            {forAllUsers
              ? (
                <span
                  sx={{ color: "text.tertiary", fontWeight: "normal", ml: 1 }}
                >
                  with {sql`appointment_record.agent_name`}
                </span>
              )
              : (
                <span
                  sx={{ color: "text.tertiary", fontWeight: "normal", ml: 1 }}
                >
                  with you
                </span>
              )}
          </Typography>

          <div className="flex items-center gap-4">
            {extraLabel}
            <div className="flex items-center">
              <Typography
                level="body-sm"
                sx={{ mr: 1, color: "text.tertiary" }}
              >
                Event type
              </Typography>
              <Typography
                level="body-sm"
                className="font-medium"
                component="div"
              >
                {eventTypeName}
              </Typography>
            </div>
          </div>
        </div>

        <Show
          when={sql`appointment_record.status in ('cancelled_by_invitee', 'cancelled_by_host', 'cancelled_by_admin')`}
        >
          <Chip color="danger" variant="soft">
            Cancelled
          </Chip>
        </Show>
        <Show when={sql`appointment_record.status = 'no_show'`}>
          <Chip color="warning" variant="soft">
            No Show
          </Chip>
        </Show>
        <Show when={sql`appointment_record.status = 'no_show_early'`}>
          <Chip color="warning" variant="soft">
            No Show - Marked Early
          </Chip>
        </Show>
      </div>
    </div>
  );
}

/**
 * Modal dialog showing the delivery status (and any error) of every email/SMS
 * notification for a single appointment. Open/close is driven by the boolean
 * UI scalar named in `bindScalar`.
 *
 * @category UI Component
 */
export function NotificationsDialog({
  bindScalar,
  onClose,
  appointmentId,
}: {
  bindScalar: string;
  onClose: (s: DomStatements) => void;
  appointmentId: NumericExpr;
}) {
  return (
    <ModalDialog bindScalar={bindScalar} className="p-5">
      <Show
        when={sql`${appointmentId} is not null`}
        fallback={<>Error loading notifications</>}
      >
        <DataTable
          watch={[appointmentId]}
          header={
            <Typography level="title-md" sx={{ p: 1 }}>
              Status of email and sms notifications
            </Typography>
          }
          variant="outlined"
          query={sql`
                   select sn.scheduling_appointment_id,
                  sn.status,
                  sn.type,
                  sn.error,
                  sn.created_at as tx_timestamp
                  from scheduling_appointment_notifications_status sn
                  where sn.scheduling_appointment_id = ${appointmentId}
                  order by tx_timestamp desc, sn.id desc
                  `}
          columns={(b) => {
            b.simpleColumn("status");
            b.simpleColumn("type");
            b.simpleColumn("error");
            b.column("Transaction time", ({ record }) => {
              return (
                <Typography level="body-md">
                  {sql`format.date(${record}.tx_timestamp, '%Y-%m-%d %H:%M:%S')`}
                </Typography>
              );
            });
          }}
        />
      </Show>
      <Button variant="soft" color="neutral" onClick={onClose} className="mt-4">
        Close
      </Button>
    </ModalDialog>
  );
}
