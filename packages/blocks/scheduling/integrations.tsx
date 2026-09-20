import type { CalendarIntegration } from "blocks/calendar_integrations";
import type { SchedulingBlock } from "blocks/scheduling";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { EachSelect } from "components/each_select";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
// import { IconButton } from "components/icon_button";
import {
  List,
  ListItem,
  ListItemContent,
  ListItemDecorator,
} from "components/list";
import { ModalDialog } from "components/modal";
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
import { Typography } from "components/typography";
import { NavigationItemsSharedContext } from "std/shared_contexts";
import { sql } from "../../std/sql_utils";
import type { AnyExpr } from "../../std/sql_utils";
import { flexGrowStyles } from "std/style_utils";
import { system, useBlock, useBlockNamed } from "std/system";
import {
  Each,
  Match,
  Route,
  Show,
  Switch,
  useApp,
  useQueryParams,
  useRoute,
  useSharedContext,
} from "std/ui";
import { Data } from "std/data";
import { Form } from "std/form";
import { IconButton } from "components/icon_button";

export function IntegrationsPage(props: { path?: string }) {
  const path = props.path ?? "/integrations";
  useRoute(path);
  useQueryParams([
    {
      name: "oauth_status",
      type: { type: "String", maxLength: 100 },
    },
    {
      name: "setup_error",
      type: { type: "String", maxLength: 5000 },
    },
  ]);
  useSharedContext(NavigationItemsSharedContext).add({
    label: "Integrations",
    url: path,
  });
  const scheduling = useBlockNamed<SchedulingBlock>("SchedulingBlock");
  for (const calendarIntegration of scheduling.opts.calendarIntegrations) {
    const block = useBlock(calendarIntegration.integration);
    const app = useApp();
    block.addOauthRedirect(app);
  }
  const accountExists = sql.or(
    ...scheduling.opts.calendarIntegrations.map((calendar) => {
      const block = system.block(calendar.integration);
      return sql`exists(select 1 from db.${
        sql.ref(block.accountTable)
      } where sys_user_id = current_user and ${block.isActiveAccount})`;
    }),
  );

  for (const meetingIntegration of scheduling.opts?.meetingIntegrations ?? []) {
    const block = useBlock(meetingIntegration.integration);
    const app = useApp();
    block.addOauthRedirect(app);
  }
  const meetingAccountExists = sql.or(
    sql`false`,
    ...(scheduling.opts?.meetingIntegrations ?? []).map((meeting) => {
      const block = useBlock(meeting.integration);
      return sql`exists(select 1 from db.${
        sql.ref(block.accountTable)
      } where sys_user_id = current_user and ${block.isActiveAccount})`;
    }),
  );

  return (
    <>
      <Data
        local
        procedure={(s) => {
          s.defScalar("refresh_key", 0);
        }}
      >
        <Data
          watch={[sql`refresh_key`]}
          statusScalar="status"
          hasDataScalar="has_data"
          procedure={(s) => {
            s.defScalar("account_exists", accountExists);
            s.defScalar("meeting_account_exists", meetingAccountExists);
            for (const calendar of scheduling.opts.calendarIntegrations) {
              const block = useBlock(calendar.integration);
              s.defTable(
                `${block.accountTable}_account_list`,
                sql`select * from db.${
                  sql.ref(block.accountTable)
                } where sys_user_id = current_user and ${block.isActiveAccount}`,
              );
              s.defTable(
                `${block.accountTable}_check_for_conflicts`,
                sql`select * from db.${
                  sql.ref(block.accountTable)
                } where sys_user_id = current_user and ${block.isActiveAccount}`,
              );
            }
            for (
              const meeting of scheduling.opts?.meetingIntegrations ?? []
            ) {
              const block = useBlock(meeting.integration);
              s.defTable(
                `${block.accountTable}_meeting_list`,
                sql`select * from db.${
                  sql.ref(block.accountTable)
                } where sys_user_id = current_user`,
              );
            }
          }}
        >
          <div className="max-w-[800px] mx-auto p-4">
            <Typography level="h3" className="mb-6">
              Integrations
            </Typography>

            <Show when={sql`oauth_status = 'connected_setup_failed'`}>
              <Alert
                variant="soft"
                color="warning"
                startIcon="Warning"
                className="mb-6"
              >
                Account connected, but calendar setup could not finish:{" "}
                {sql`coalesce(setup_error, 'Unknown setup error')`}
              </Alert>
            </Show>

            <Switch>
              <Match when={sql`status = 'failed'`}>
                <Alert variant="soft" color="danger" startIcon="Error">
                  Failed to load Integrations
                </Alert>
              </Match>
              <Match when={sql`status = 'received' and has_data`}>
                <Card variant="outlined" className="mb-12">
                  {scheduling.opts.calendarIntegrations.map((calendar, i) => {
                    const block = useBlock(calendar.integration);
                    const Icon = block.icon;
                    return (
                      <>
                        {i > 0 && <Divider />}
                        <div
                          className={`flex items-center gap-3 px-2 pt-${
                            i > 0 ? 4 : 0
                          } pb-4`}
                        >
                          <Icon className="w-[40px] h-[40px]" />
                          <div className="flex-1">
                            <Typography level="title-lg">
                              {block.integrationName}
                            </Typography>
                            <Typography level="body-sm">
                              Connect your {block.integrationName}{" "}
                              to check availability and manage events
                            </Typography>
                          </div>
                          <Button
                            variant="solid"
                            color="primary"
                            startIcon="Add"
                            size="sm"
                            className="w-[38%]"
                            onClick={(s) => {
                              block.navigateToOauth(s);
                            }}
                          >
                            Add {block.integrationName} Account
                          </Button>
                        </div>
                      </>
                    );
                  })}
                  {scheduling.opts?.meetingIntegrations?.map(
                    (meetingIntegration) => {
                      const block = useBlock(meetingIntegration.integration);
                      const Icon = block.icon;

                      return (
                        <>
                          <Divider />
                          <div className="flex items-center gap-3 px-2 pt-4 pb-4">
                            <Icon className="w-[40px] h-[40px]" />
                            <div className="flex-1">
                              <Typography level="title-lg">
                                {block.integrationName}
                              </Typography>
                              <Typography level="body-sm" className="w-[80%]">
                                Connect your {block.integrationName}{" "}
                                account to create automatic meetings for your
                                appointments
                              </Typography>
                            </div>
                            <Data
                              procedure={(s) => {
                                s.defScalar(
                                  "exists_account",
                                  sql`exists(select 1 from db.${
                                    sql.ref(block.accountTable)
                                  } where sys_user_id = current_user and ${block.isActiveAccount})`,
                                );
                              }}
                            >
                              <Show
                                when={sql`exists_account`}
                                fallback={
                                  <Button
                                    variant="solid"
                                    color="primary"
                                    startIcon="Add"
                                    size="sm"
                                    onClick={(s) => {
                                      block.navigateToOauth(s);
                                    }}
                                    className="w-[38%]"
                                  >
                                    Add {block.integrationName} Account
                                  </Button>
                                }
                              >
                                <Chip
                                  size="sm"
                                  variant="soft"
                                  color="success"
                                  startIcon="Check"
                                >
                                  Connected succesfully
                                </Chip>
                              </Show>
                            </Data>
                          </div>
                        </>
                      );
                    },
                  )}
                  <Divider />
                  <Show
                    when={sql`account_exists`}
                    fallback={
                      <Typography level="body-sm" className="pt-4 px-4">
                        No connected calendar accounts
                      </Typography>
                    }
                  >
                    <Divider />
                    {scheduling.opts.calendarIntegrations.map((calendar) => {
                      const block = useBlock(calendar.integration);
                      const Icon = block.icon;
                      return (
                        <List>
                          <Each
                            table={`${block.accountTable}_account_list`}
                            recordName="account"
                          >
                            <ListItem
                              endAction={
                                <Data
                                  local
                                  procedure={(s) => {
                                    s.defScalar("deleting", false);
                                  }}
                                >
                                  <ConfirmDangerDialog
                                    description={sql
                                      .lit`Are you sure you want to disconnect this account?`}
                                    bindScalar="deleting"
                                    onConfirm={(s) => {
                                      s.setScalar("dialog_waiting", true);
                                      s.commitUiTreeChanges();
                                      s.tryServer({
                                        body: (s) => {
                                          block.deleteAccount(s, {
                                            accountId: sql`account.id`,
                                          });
                                          s.increment("refresh_key");
                                          s.setScalar("deleting", false);
                                        },
                                        errorName: "error",
                                        catch: (s) => {
                                          s.setScalar(
                                            "dialog_error",
                                            sql`'Unable to disconnect account'`,
                                          );
                                        },
                                      });
                                    }}
                                  />
                                  <IconButton
                                    variant="plain"
                                    color="danger"
                                    icon="DeleteOutline"
                                    aria-label="Disconnect"
                                    size="sm"
                                    onClick={(s) => {
                                      s.setScalar("deleting", true);
                                    }}
                                  />
                                </Data>
                              }
                            >
                              <ListItemDecorator>
                                <Icon />
                              </ListItemDecorator>
                              <ListItemContent>
                                {block.accountDisplay}
                              </ListItemContent>
                            </ListItem>
                          </Each>
                        </List>
                      );
                    })}
                  </Show>
                  <Show
                    when={sql`meeting_account_exists`}
                    fallback={
                      <Typography level="body-sm" className="pt-4 px-4">
                        No connected meeting accounts
                      </Typography>
                    }
                  >
                    {scheduling.opts?.meetingIntegrations?.map(
                      (meetingIntegration) => {
                        const block = useBlock(meetingIntegration.integration);
                        const Icon = block.icon;

                        return (
                          <List>
                            <Each
                              table={`${block.accountTable}_meeting_list`}
                              recordName="account"
                            >
                              <ListItem>
                                <ListItemDecorator>
                                  <Icon />
                                </ListItemDecorator>
                                <ListItemContent>
                                  {block.accountDisplay}
                                </ListItemContent>
                              </ListItem>
                            </Each>
                          </List>
                        );
                      },
                    )}
                  </Show>
                </Card>
                <Show when={sql`account_exists`}>
                  <Typography level="h3" className="mb-6">
                    Calendar Configuration
                  </Typography>

                  <Card variant="outlined">
                    <div className="flex justify-between items-center mb-4">
                      <div>
                        <Typography level="title-lg" className="mb-2">
                          Check for conflicts
                        </Typography>
                        <Typography level="body-sm" color="neutral">
                          Set the calendar(s) to check for conflicts to prevent
                          double bookings.
                        </Typography>
                      </div>
                    </div>

                    {scheduling.opts.calendarIntegrations.map((calendar) => {
                      const block = useBlock(calendar.integration);
                      const accountField = getAccountField(block);
                      const Icon = block.icon;
                      return (
                        <List className="w-full">
                          <Each
                            table={`${block.accountTable}_check_for_conflicts`}
                            recordName="account"
                          >
                            <Data
                              local
                              procedure={(s) => {
                                s.defScalar("show_calendar_modal", false);
                              }}
                            >
                              <ListItem
                                endAction={
                                  <Button
                                    variant="soft"
                                    color="primary"
                                    size="sm"
                                    startIcon="Edit"
                                    onClick={(s) =>
                                      s.setScalar(
                                        "show_calendar_modal",
                                        true,
                                      )}
                                  >
                                    Edit
                                  </Button>
                                }
                                className="bg-surface rounded-md mb-2"
                              >
                                <ListItemContent>
                                  <Typography
                                    level="body-md"
                                    startDecorator={<Icon />}
                                  >
                                    Check {sql`account.email`}
                                  </Typography>
                                  <Data
                                    procedure={(s) => {
                                      s.defTable(
                                        "conflict_calendars",
                                        sql`select * from db.${
                                          sql.ref(block.calendarTable)
                                        } where ${accountField.ident} = account.id and check_for_conflicts`,
                                      );
                                    }}
                                  >
                                    <Each
                                      table="conflict_calendars"
                                      recordName="calendar"
                                    >
                                      <Typography
                                        level="body-sm"
                                        startIcon="CheckCircleOutline"
                                        className="ml-8"
                                      >
                                        {sql`calendar.summary`}
                                      </Typography>
                                    </Each>
                                  </Data>
                                </ListItemContent>
                              </ListItem>
                              <CalendarConflictModal
                                bindScalar="show_calendar_modal"
                                accountId={sql`account.id`}
                                block={block}
                              />
                            </Data>
                          </Each>
                        </List>
                      );
                    })}

                    <div>
                      <Typography level="title-lg" className="mb-2">
                        Add to calendar
                      </Typography>
                      <Typography
                        level="body-sm"
                        color="neutral"
                        className="mb-6"
                      >
                        Set the calendar you would like to add new events to as
                        they're scheduled.
                      </Typography>
                    </div>
                    <AddToCalendarDisplay />
                  </Card>
                </Show>
                <Show when={sql`meeting_account_exists`}>
                  <Typography level="h3" className="mb-6 mt-6">
                    Meeting Configuration
                  </Typography>

                  <Card variant="outlined">
                    {scheduling.opts?.meetingIntegrations?.map((meeting) => {
                      const block = useBlock(meeting.integration);
                      const Icon = block.icon;
                      return (
                        <List className="w-full">
                          <div className="flex justify-between items-center mb-4">
                            <div>
                              <Typography level="title-lg" className="mb-2">
                                Integrated Meetings accounts
                              </Typography>
                              <Typography level="body-sm" color="neutral">
                                Automatic meetings will be created in the
                                following accounts
                              </Typography>
                            </div>
                          </div>
                          <Each
                            table={`${block.accountTable}_meeting_list`}
                            recordName="account"
                          >
                            <ListItem
                              endAction={
                                <DeleteRecordButton
                                  table={block.accountTable}
                                  recordId={sql`account.id`}
                                  size="sm"
                                  globalUndoSnackbarKey="contact"
                                  description={
                                    <div className="mt-4">
                                      Are you sure you want to delete this
                                      account?
                                      <br />
                                      <div className="text-center">
                                        {sql`account.email`}
                                      </div>
                                    </div>
                                  }
                                  afterTransactionCommit={(s) => {
                                    s.try({
                                      body: (s) => {
                                        block.deleteAccount(s, {
                                          accountId: sql`account.id`,
                                        });
                                        s.increment("refresh_key");
                                      },
                                      errorName: "error",
                                      catch: (s) => {
                                        s.setScalar(
                                          "dialog_error",
                                          sql`'Unable to disconnect account'`,
                                        );
                                      },
                                    });
                                  }}
                                >
                                  Delete
                                </DeleteRecordButton>
                              }
                              className="bg-surface rounded-md mb-2"
                            >
                              <ListItemContent>
                                <Typography
                                  level="body-md"
                                  startDecorator={<Icon />}
                                >
                                  {sql`account.email`}
                                </Typography>
                              </ListItemContent>
                            </ListItem>
                          </Each>
                        </List>
                      );
                    })}
                  </Card>
                </Show>
              </Match>
              <Match when={sql`true`}>
                <Alert
                  variant="soft"
                  color="neutral"
                  startIcon="HourglassEmpty"
                  className="w-[500px]"
                >
                  Loading Integrations...
                </Alert>
              </Match>
            </Switch>
          </div>
        </Data>
      </Data>
    </>
  );
}

/**
 Gets the account field from a calendar table that references the account table
 @param block The calendar integration block
 @returns The account field or throws an error if not found
 */
function getAccountField(block: CalendarIntegration) {
  const table = system.db.tables[block.calendarTable];
  const accountField = Object.values(table.fields).find(
    (field) =>
      field.type === "ForeignKey" && field.table === block.accountTable,
  );

  if (!accountField) {
    throw new Error(
      `Account field not found in calendar table ${block.calendarTable}`,
    );
  }

  return accountField;
}

function AddToCalendarDisplay() {
  const scheduling = useBlockNamed<SchedulingBlock>("SchedulingBlock");
  const foundCalendar = sql.or(
    ...scheduling.opts.calendarIntegrations.map((calendar) => {
      const block = system.block(calendar.integration);
      return sql`exists(
        select 1 from db.${sql.ref(block.accountTable)}
        auto join ${sql.ref(block.calendarTable)}
        where ${sql.ref(block.accountTable)}.sys_user_id = current_user
        and ${sql.ref(block.calendarTable)}.add_to_calendar
      )`;
    }),
  );
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_to_calendar_modal", false);
      }}
    >
      <Data
        procedure={(s) => {
          s.defScalar("found_calendar", foundCalendar);
          for (const calendar of scheduling.opts.calendarIntegrations) {
            const block = useBlock(calendar.integration);
            const accountField = getAccountField(block);
            s.defTable(
              `${block.calendarTable}_add_to_calendar`,
              sql`select ${sql.ref(block.calendarTable)}.*, ${
                sql.ref(block.accountTable)
              }.email as account_email from db.${
                sql.ref(block.calendarTable)
              } join db.${sql.ref(block.accountTable)} on ${
                sql.ref(block.accountTable)
              }.id = ${
                sql.ref(block.calendarTable)
              }.${accountField.ident} where ${
                sql.ref(block.calendarTable)
              }.add_to_calendar and ${
                sql.ref(block.accountTable)
              }.sys_user_id = current_user`,
            );
          }
        }}
      >
        <Show
          when={sql`found_calendar`}
          fallback={
            <div className="flex items-center gap-4 px-2">
              <Typography level="body-sm">
                Not adding to any calendar
              </Typography>
              <div sx={flexGrowStyles} />
              <Button
                variant="soft"
                size="sm"
                startIcon="Add"
                onClick={(s) => s.setScalar("add_to_calendar_modal", true)}
              >
                Add Calendar
              </Button>
            </div>
          }
        >
          {scheduling.opts.calendarIntegrations.map((calendar) => {
            const block = useBlock(calendar.integration);
            const Icon = block.icon;
            return (
              <Each
                table={`${block.calendarTable}_add_to_calendar`}
                recordName="calendar"
              >
                <div className="flex items-center gap-4 px-2">
                  <div className="flex flex-col gap-2">
                    <Typography startDecorator={<Icon />}>
                      Add to {sql`calendar.account_email`}
                    </Typography>
                    <Typography
                      level="body-sm"
                      startIcon="CheckCircleOutline"
                      className="ml-8"
                    >
                      {sql`calendar.summary`}
                    </Typography>
                  </div>
                  <div sx={flexGrowStyles} />
                  <Button
                    variant="soft"
                    size="sm"
                    startIcon="Edit"
                    onClick={(s) => s.setScalar("add_to_calendar_modal", true)}
                  >
                    Edit
                  </Button>
                </div>
              </Each>
            );
          })}
        </Show>
      </Data>
      <AddToCalendarModal bindScalar="add_to_calendar_modal" />
    </Data>
  );
}

function CalendarConflictModal({
  bindScalar,
  accountId,
  block,
}: {
  bindScalar: string;
  accountId: AnyExpr;
  block: CalendarIntegration;
}) {
  const accountField = getAccountField(block);
  return (
    <ModalDialog bindScalar={bindScalar} maxWidth="xs">
      <Form
        afterTransactionCommit={(s) => {
          s.increment("refresh_key");
          s.setScalar(bindScalar, false);
        }}
      >
        <Typography level="h3" className="mb-6">
          Select Calendars to Check for Conflicts
        </Typography>
        <Form.UpdateMany
          table={block.calendarTable}
          where={sql`${accountField.ident} = ${accountId}`}
          fields={["summary"]}
        >
          <div className="flex flex-col gap-4 pl-4">
            <Form.Each recordName="calendar">
              <Form.CheckboxField
                field="check_for_conflicts"
                variant="outlined"
                label={sql`calendar.summary`}
              />
            </Form.Each>
          </div>
        </Form.UpdateMany>

        <Form.ErrorAlert className="mt-3" mode="all" />
        <div className="flex justify-end gap-4 mt-8">
          <Button
            variant="soft"
            onClick={(s) => s.setScalar(bindScalar, false)}
          >
            Close
          </Button>
          <Form.SubmitButton>Save</Form.SubmitButton>
        </div>
      </Form>
    </ModalDialog>
  );
}

function AddToCalendarModal({ bindScalar }: { bindScalar: string }) {
  const scheduling = useBlockNamed<SchedulingBlock>("SchedulingBlock");
  return (
    <ModalDialog bindScalar={bindScalar} maxWidth="xs">
      <Data
        procedure={(s) => {
          s.defTable("calendar_options", {
            fields: [
              { name: "id", type: "Int" },
              { name: "account_id", type: "Int" },
              { name: "account_type", type: "SmallUint" },
              { name: "summary", type: "String" },
              { name: "add_to_calendar", type: "Bool" },
            ],
          });
          for (
            let i = 0;
            i < scheduling.opts.calendarIntegrations.length;
            i++
          ) {
            const calendar = scheduling.opts.calendarIntegrations[i];
            const block = useBlock(calendar.integration);
            s.modify(
              sql`insert into calendar_options (id,account_id, summary, add_to_calendar, account_type)
                select ${sql.ref(block.calendarTable)}.id,
                ${sql.ref(block.accountTable)}.id as account_id,
                ${sql.ref(block.calendarTable)}.summary,
                ${sql.ref(block.calendarTable)}.add_to_calendar,
                ${i}
                from ${sql.ref(block.calendarTable)}
                auto join ${sql.ref(block.accountTable)}
                where sys_user_id = current_user`,
            );
            s.defTable(
              `account_${i}`,
              sql`select id, email from ${
                sql.ref(block.accountTable)
              } where sys_user_id = current_user and ${block.isActiveAccount}`,
            );
          }
          s.defScalar("selected_calendar_id", {
            type: "BigUint",
            expr: sql`(select id from calendar_options where add_to_calendar)`,
          });
          s.defScalar(
            "selected_account_id",
            sql`(select account_id from calendar_options where add_to_calendar)`,
          );
          s.defScalar(
            "selected_account_type",
            sql`(select account_type from calendar_options where add_to_calendar)`,
          );
        }}
      >
        <Form
          beforeTransactionCommit={(s) => {
            for (
              let i = 0;
              i < scheduling.opts.calendarIntegrations.length;
              i++
            ) {
              const calendar = scheduling.opts.calendarIntegrations[i];
              const block = useBlock(calendar.integration);
              const accountField = getAccountField(block);

              s.block((s) => {
                s.defScalar(
                  "old_calendar_id",
                  sql`(select id from ${sql.ref(block.calendarTable)}
                      where add_to_calendar and
                      id != selected_calendar_id and
                      (${accountField.ident} != selected_account_id or ${i} != selected_account_type) and
                      ${accountField.ident} in (select id from ${
                    sql.ref(block.accountTable)
                  } where sys_user_id = current_user))`,
                );
                s.if(sql`old_calendar_id is not null`, (s) => {
                  scheduling.enqueueBackgroundTask(s, {
                    taskType: "calendar_cleanup",
                    appointmentTable: "",
                    calendarId: sql`old_calendar_id`,
                    calendarTable: block.calendarTable,
                    insideTransaction: true,
                  });
                });
              });
              s.modify(sql`update ${sql.ref(block.calendarTable)}
                  set add_to_calendar = coalesce(
                    (id = selected_calendar_id) and selected_account_type = ${i} and selected_account_id = ${accountField.ident},
                    false
                  )
                  where ${accountField.ident} in (select id from ${
                sql.ref(block.accountTable)
              } where sys_user_id = current_user)`);
            }
          }}
          afterTransactionCommit={(s) => {
            s.increment("refresh_key");
            s.setScalar(bindScalar, false);
          }}
        >
          <Typography level="h3" className="mb-6">
            Which calendar would you like to add events to?
          </Typography>
          <RadioGroup>
            {scheduling.opts.calendarIntegrations.map((calendar, i) => {
              const block = useBlock(calendar.integration);
              const Icon = block.icon;
              return (
                <Each table={`account_${i}`} recordName="account">
                  <Radio
                    value={sql`account.id`}
                    checked={sql`selected_account_id = account.id and selected_account_type = ${i}`}
                    slotProps={{
                      label: {
                        className: "flex items-center gap-1",
                      },
                    }}
                    onClick={(s) => {
                      s.setScalar("selected_account_id", sql`account.id`);
                      s.setScalar("selected_account_type", i);
                      s.setScalar("selected_calendar_id", sql.null);
                    }}
                    label={
                      <>
                        <Icon />
                        {sql`account.email`}
                      </>
                    }
                  />
                </Each>
              );
            })}
            <Radio
              value={sql.lit`none`}
              checked={sql`selected_account_id is null`}
              onClick={(s) => {
                s.setScalar("selected_account_id", sql.null);
                s.setScalar("selected_account_type", sql.null);
                s.setScalar("selected_calendar_id", sql.null);
              }}
              label="Do not add new events to a calendar"
            />
          </RadioGroup>
          <Show when={sql`selected_account_id is not null`}>
            <FormControl className="mt-4">
              <FormLabel>Add to calendar</FormLabel>
              <EachSelect
                watch={[sql`selected_account_id`, sql`selected_account_type`]}
                table="calendar_options"
                value={sql`selected_calendar_id`}
                onChange={(s) => {
                  s.setScalar("selected_calendar_id", sql`target_value::int`);
                }}
                optionLabel="summary"
                optionValue="id"
                where={sql`account_id = selected_account_id and account_type = selected_account_type`}
              />
            </FormControl>
          </Show>
          <Form.ErrorAlert className="mt-3" mode="all" />
          <div className="flex justify-end gap-4 mt-4">
            <Button
              variant="soft"
              onClick={(s) => s.setScalar(bindScalar, false)}
            >
              Close
            </Button>
            <Form.SubmitButton>Save</Form.SubmitButton>
          </div>
        </Form>
      </Data>
    </ModalDialog>
  );
}

export function ErrorIntegrationsPage() {
  return (
    <Route path="/oauth-error">
      <ErrorIntegrationsPageInner />
    </Route>
  );
}

function ErrorIntegrationsPageInner() {
  useQueryParams([
    {
      name: "error_msg",
      type: { type: "String", maxLength: 5000 },
    },
  ]);
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-primary-200 text-primary-700 text-center p-4">
      <h1>Error integrating your account</h1>
      <p className="text-lg mb-[20px]">
        Looks like there was an error when trying to connect your account.
      </p>
      <p>{sql`coalesce(error_msg, 'Unknown error')`}</p>
      <p>If the problem persists, please contact support.</p>
      <Button startIcon="ArrowBack" variant="outlined" href="/integrations">
        Go back to integrations page
      </Button>
    </div>
  );
}
