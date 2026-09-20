import { Alert } from "components/alert";
import { Card } from "components/card";
import { CircularProgress } from "components/circular_progress";
import { DateRangeFilter } from "components/date_range";
import { Divider } from "components/divider";
import { FieldFormControl } from "components/field_form_control";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { EachSelect } from "components/each_select";
import { InlineRecordDisplay } from "components/inline_record_display";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import {
  Conditional,
  Each,
  type Node,
  Route,
  Show,
  useICtx,
  usePhase,
} from "std/ui";
import { Form } from "std/form";
import { FormICtxKey } from "std/ictx";

/*

Improvements:

- Add a date range picker to the filter
- Admin screen with filter by employee (not needed for now) and date range
- On admin screen entry should have employee on left and date on right in the header
- Later need to have employee table passed in and defined externally

*/

const styles = createStyles({
  pageContainer: {
    p: 6,
    width: "100%",
    md: {
      px: 12,
      width: "90%",
    },
    lg: {
      px: 16,
      maxWidth: "800px",
    },
    mx: "auto",
  },
  pageTitle: {
    mb: 6,
  },
  formButtonContainer: {
    mt: 6,
    display: "flex",
    justifyContent: "flex-end",
  },
  accomplishmentList: {
    listStyleType: "none",
    padding: 0,
    margin: 0,
  },
  accomplishmentItem: {
    display: "flex",
    alignItems: "center",
    mb: 4,
  },
  accomplishmentInput: {
    flexGrow: 1,
    mr: 2,
    md: {
      mr: 4,
    },
  },
  logEntriesContainer: {
    mt: 8,
  },
  logEntryCard: {
    mb: 6,
    boxShadow: "0 0 10px 0 rgba(0, 0, 0, 0.1)",
  },
  logEntryDate: {
    fontWeight: "bold",
    mb: 4,
  },
  logEntryContent: {
    mb: 4,
  },
  accomplishmentsList: {
    listStyleType: "disc",
    pl: 8,
    whiteSpace: "pre-wrap",
  },
  filterContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    mb: 6,
  },
  filterLabel: {
    mr: 4,
  },
  adminSection: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    mb: 4,
  },
});

function AutoSaveOnBlur(props: { children: Node }) {
  if (usePhase() === "gather") {
    return props.children;
  }
  const ctx = useICtx(FormICtxKey);
  return (
    <div
      onFocusOut={(s) => {
        s.if(
          sql.and(
            sql.not(ctx.submitting),
            sql`last_saved_state_hash != ${ctx.stateHash()}`,
          ),
          (s) => ctx.submit(s),
        );
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * Self-routing page where the current user fills in today's log entry
 * (one row per user per day) plus its accomplishments, and browses their
 * own past entries filtered by date range. Auto-saves on blur.
 *
 * @param props.path Route path to mount on. Defaults to `/daily_log`.
 * @category Page Component
 */
export function DailyLogUserPage(props: { path?: string }) {
  return (
    <Route path={props.path ?? "/daily_log"}>
      <DailyLogUserPageInner />
    </Route>
  );
}

/**
 Manages the daily log page, allowing users to log their work and view previous entries.

 @category Page Component
 */
function DailyLogUserPageInner() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("start_date", sql`date.add(day, -30, current_date())`);
        s.defScalar("end_date", sql`current_date()`);
        s.debugExpr(sql`current_user`);
      }}
    >
      <div sx={styles.pageContainer}>
        <div>
          <Typography level="h3">Daily Log</Typography>
          <Typography level="body-lg">What did you work on today?</Typography>
          <Form
            defaultFieldComponent={FieldFormControl}
            beforeUnloadCheck
            refetchOnSuccess={false}
          >
            <Form.Merge
              table="daily_log_entries"
              values={{
                date: sql`current_date()`,
                sys_user_id: sql`current_user`,
              }}
            >
              <AutoSaveOnBlur>
                <Form.Field field="content" />
                <Form.Relation table="daily_log_accomplishments">
                  <Typography level="h3" className="my-4">
                    Accomplishments
                  </Typography>
                  <Form.Each>
                    <ul sx={styles.accomplishmentList}>
                      <div className="flex items-center mb-4">
                        <div className="grow">
                          <Form.Field field="content" />
                        </div>
                        <Form.DeleteRecordButton
                          variant="plain"
                          color="neutral"
                          size="sm"
                        >
                          <MaterialIcon icon="Delete" />
                        </Form.DeleteRecordButton>
                      </div>
                    </ul>
                  </Form.Each>
                  <Form.AddCurrentTableButton
                    startIcon="Add"
                    variant="outlined"
                    color="primary"
                    size="sm"
                    className="mt-2"
                  >
                    Add Accomplishment
                  </Form.AddCurrentTableButton>
                </Form.Relation>
                <div sx={styles.formButtonContainer}>
                  <Form.SubmitButton>Save Log Entry</Form.SubmitButton>
                </div>
              </AutoSaveOnBlur>
            </Form.Merge>
          </Form>
        </div>
      </div>
      <div sx={styles.pageContainer}>
        <Divider className="my-8" />
        <div sx={styles.logEntriesContainer}>
          <div sx={styles.filterContainer}>
            {/*Example_DateRangeFilter_Start*/}
            <DateRangeFilter
              startDate={sql`start_date`}
              endDate={sql`end_date`}
              onStartDateChange={(s, newStartDate) => {
                s.setScalar("start_date", newStartDate);
              }}
              onEndDateChange={(s, newEndDate) => {
                s.setScalar("end_date", newEndDate);
              }}
            />
            {/*Example_DateRangeFilter_End*/}
          </div>
          <Data
            watch={[sql`start_date`, sql`end_date`]}
            procedure={(s) => {
              s.defTable(
                "log_entries",
                sql`select * from db.daily_log_entries where sys_user_id = current_user and date between start_date and end_date and date != current_date() order by date desc`,
              );
              s.defTable(
                "all_accomplishments",
                sql`select a.* from db.daily_log_accomplishments a join log_entries e on a.daily_log_entry_id = e.id`,
              );
            }}
            pendingFallback={
              <div className="flex justify-center">
                <CircularProgress size="lg" />
              </div>
            }
            errorFallback={
              <Alert color="danger" startIcon="Report">
                Unable to get daily log entries
              </Alert>
            }
          >
            <Show when={sql`(select count(*) from log_entries) = 0`}>
              <div className="flex justify-center">
                <Alert color="neutral" startIcon="Info">
                  No log entries found
                </Alert>
              </div>
            </Show>
            <Each table="log_entries" recordName="log_entry_record">
              <Card sx={styles.logEntryCard} variant="outlined">
                <Typography level="h4" sx={styles.logEntryDate}>
                  {sql`log_entry_record.date`}
                </Typography>
                <div sx={styles.logEntryContent}>
                  {sql`log_entry_record.content`}
                </div>
                <div>
                  <Typography level="title-lg">
                    Accomplishments
                  </Typography>
                </div>
                <ul sx={styles.accomplishmentsList}>
                  <Each
                    table="all_accomplishments"
                    recordName="accomplishment"
                    where={sql`accomplishment.daily_log_entry_id = log_entry_record.id`}
                  >
                    <li>
                      {sql`accomplishment.content`}
                    </li>
                  </Each>
                </ul>
              </Card>
            </Each>
          </Data>
        </div>
      </div>
    </Data>
  );
}
/**
 * Self-routing admin page for reviewing every user's daily log entries,
 * with date-range and optional per-employee filtering.
 *
 * @param props.path Route path to mount on. Defaults to `/daily_log`.
 * @category Page Component
 */
export function DailyLogAdminPage(props: { path?: string }) {
  return (
    <Route path={props.path ?? "/daily_log"}>
      <DailyLogAdminPageInner />
    </Route>
  );
}

function DailyLogAdminPageInner() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("start_date", sql`date.add(day, -30, current_date())`);
        s.defScalar("end_date", sql`current_date()`);
        s.defScalar("employee_selected", {
          type: "BigInt",
        });
        s.defScalar("filter_on_employee", false);
      }}
    >
      <div sx={styles.pageContainer}>
        <div>
          <Typography level="h3">Daily Log Admin</Typography>
          <DateRangeFilter
            startDate={sql`start_date`}
            endDate={sql`end_date`}
            onStartDateChange={(s, newStartDate) => {
              s.setScalar("start_date", newStartDate);
            }}
            onEndDateChange={(s, newEndDate) => {
              s.setScalar("end_date", newEndDate);
            }}
          />
          <Conditional
            when={sql`filter_on_employee`}
            then={
              <div className="flex items-center">
                <div sx={flexGrowStyles} />
                <Data
                  procedure={(s) => {
                    s.defTable(
                      "sys_users_list",
                      sql`select id, display_name_virtual as label from db.sys_users`,
                    );
                  }}
                  pendingFallback={null}
                  errorFallback={null}
                >
                  <EachSelect
                    table="sys_users_list"
                    placeholder="Select Employee"
                    optionLabel="label"
                    optionValue="id"
                    onChange={(s) => {
                      s.setScalar("employee_selected", sql`target_value`);
                    }}
                  />
                </Data>
                <IconButton
                  icon="Close"
                  variant="plain"
                  aria-label="Clear Employee Filter"
                  color="neutral"
                  size="sm"
                  onClick={(s) => {
                    s.setScalar("filter_on_employee", false);
                    s.setScalar("employee_selected", sql.null);
                  }}
                  className="ml-2"
                />
              </div>
            }
            else={
              <div className="flex items-center">
                <div sx={flexGrowStyles} />
                <IconButton
                  icon="FilterAltOutlined"
                  variant="plain"
                  aria-label="Filter on Employee"
                  color="neutral"
                  onClick={(s) => s.setScalar("filter_on_employee", true)}
                />
              </div>
            }
          />
        </div>
        <Divider className="my-4" />
        <div sx={styles.logEntriesContainer}>
          <Data
            watch={[
              sql`employee_selected`,
              sql`filter_on_employee`,
              sql`start_date`,
              sql`end_date`,
            ]}
            procedure={(s) => {
              s.defTable(
                "admin_log_entries",
                sql`select * from db.daily_log_entries where case
                  when filter_on_employee and employee_selected is not null then sys_user_id = employee_selected
                  else true
                end and date between start_date and end_date order by date desc`,
              );
              s.defTable(
                "admin_accomplishments",
                sql`select a.* from db.daily_log_accomplishments a join admin_log_entries e on a.daily_log_entry_id = e.id`,
              );
            }}
            pendingFallback={
              <div className="flex justify-center">
                <CircularProgress size="lg" />
              </div>
            }
            errorFallback={
              <Alert color="danger" startIcon="Report">
                Unable to get daily log entries
              </Alert>
            }
          >
            <Show when={sql`(select count(*) from admin_log_entries) = 0`}>
              <div className="flex justify-center">
                <Alert color="neutral" startIcon="Info">
                  No log entries found
                </Alert>
              </div>
            </Show>
            <Each table="admin_log_entries" recordName="log_entry_record">
              <Card sx={styles.logEntryCard} variant="outlined">
                <div sx={styles.adminSection}>
                  <Typography level="h3">
                    <InlineRecordDisplay
                      tableName="sys_users"
                      id={sql`log_entry_record.sys_user_id`}
                    />
                  </Typography>
                  <Typography level="h4">
                    {sql`log_entry_record.date`}
                  </Typography>
                </div>
                <div sx={styles.logEntryContent}>
                  {sql`log_entry_record.content`}
                </div>
                <div>
                  <Typography level="title-lg">Accomplishments:</Typography>
                  <ul sx={styles.accomplishmentsList}>
                    <Each
                      table="admin_accomplishments"
                      recordName="accomplishment"
                      where={sql`accomplishment.daily_log_entry_id = log_entry_record.id`}
                    >
                      <li>
                        {sql`accomplishment.content`}
                      </li>
                    </Each>
                  </ul>
                </div>
              </Card>
            </Each>
          </Data>
        </div>
      </div>
    </Data>
  );
}

/**
 * Solution block that adds a per-user daily log: each user gets a single
 * `daily_log_entries` row per day with a free-form note. Includes a
 * ready-made entry form, history page, and admin views.
 *
 * Add to `core.tsx`:
 *
 * ```ts
 * system.addBlock(new DailyLogBlock());
 * ```
 */
export class DailyLogBlock implements Block {
  blockName = "DailyLogBlock";
  componentDependencies: string[] = [];
  description: string | undefined;
  initialize() {
    const db = system.db;
    db.table("daily_log_entries", (table) => {
      table.fk("sys_users").notNull();
      table.date("date").notNull();
      table.string("content", 5000).multiline();
      table.unique(["sys_user_id", "date"]);
    });

    db.table("daily_log_accomplishments", (table) => {
      table.fk("daily_log_entries");
      table.string("content", 1000).multiline();
    });
    this.componentDependencies = ["DailyLogAdminPage", "DailyLogUserPage"];
    this.description =
      "Provides a way to log daily work and view previous entries.";
  }
  static AdminPage(props: { path?: string }) {
    return <DailyLogAdminPage path={props.path} />;
  }
  static UserPage(props: { path?: string }) {
    return <DailyLogUserPage path={props.path} />;
  }
}
