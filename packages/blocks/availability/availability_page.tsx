import { AvailabilityBlock } from "./availability_block";
import { AvailabilitySection } from "blocks/availability/availability_section";
import { TimeOffSection } from "blocks/availability/time_off_section";
import { Button } from "components/button";
import { Divider } from "components/divider";
import { SelectTimeZone } from "components/select_timezone";
import { Sheet } from "components/sheet";
import { Alert } from "components/alert";
import { Skeleton } from "components/skeleton";
import { Typography } from "components/typography";
import { NavigationItemsSharedContext } from "std/shared_contexts";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import { Match, Route, Show, Switch, useSharedContext } from "std/ui";
import { Data } from "std/data";
import { DateSpecificHoursSection } from "./date_specific_hours_section";

const styles = createStyles({
  contentWrapper: {
    maxWidth: "90%",
    lg: {
      minWidth: "70%",
    },
    mx: "auto",
    mt: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  mainCard: {
    borderRadius: 10,
    margin: "auto",
    lg: {
      p: 6,
    },

    minWidth: "80%",
  },

  timezoneSection: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    sql: 2,
    mb: 8,
  },
  availabilityContent: {
    display: "flex",
    gap: 4,
    flexDirection: "column",
    sql: 2,
    lg: {
      flexDirection: "row",
    },
  },
  availabilityColumn: {
    flex: 1,
  },
  columnDivider: {
    display: "none",
    lg: {
      display: "block",
      height: "auto",
    },
  },
  rowDivider: {
    display: "block",
    my: 6,
    lg: {
      display: "none",
    },
  },
});

function Availability() {
  const availability = system.blockOptional(AvailabilityBlock);
  if (!availability) {
    throw new Error(
      "Availability block is not enabled, it must be enabled to use AvailabilityPage",
    );
  }
  return (
    <Data
      pendingFallback={null}
      errorFallback={null}
      hasDataScalar="avail_page_has_data"
      statusScalar="avail_page_status"
      procedure={(s) => {
        s.defScalar(
          "selected_timezone",
          sql`(select timezone from sys_users where id = current_user)`,
        );
        s.defScalar("current_user_id", sql`current_user`);
        s.defScalar("refresh_key", sql`0`);
      }}
    >
      <Switch>
        <Match
          when={sql`avail_page_status = 'failed' and not avail_page_has_data`}
        >
          <Alert variant="soft" color="danger" startIcon="Report">
            Failed to load availability data
          </Alert>
        </Match>
        <Match when={sql`avail_page_has_data`}>
          <div sx={styles.contentWrapper}>
            <Sheet sx={styles.mainCard} variant="outlined">
              <div sx={styles.timezoneSection}>
                <div className="w-full">
                  <Typography level="body-sm">Time zone</Typography>
                  <div className="flex flex-row gap-2 justify-between">
                    <Show when={sql`selected_timezone is not null`}>
                      {/*Example_SelectTimeZone_Start*/}
                      <SelectTimeZone
                        value={sql`selected_timezone`}
                        onInput={(s) => {
                          s.tryServer({
                            body: (s) => {
                              s.startTransaction();
                              s.modify(
                                sql`update db.sys_users set timezone = target_value::enums.sys_timezone where id = current_user`,
                              );
                              s.commitTransaction();
                            },
                            finally: (s) => s.increment("refresh_key"),
                          });
                        }}
                        className="md:w-[40%]"
                        popoverPlacement="bottom"
                      />
                      {/*Example_SelectTimeZone_End*/}
                    </Show>
                    <Button
                      variant="soft"
                      color="neutral"
                      size="sm"
                      sx={{ my: "auto", ml: 1 }}
                      href={sql.concat(
                        "/availability-preview/",
                        sql`current_user_id`,
                      )}
                    >
                      Preview your availability
                    </Button>
                  </div>
                </div>
              </div>
              <div sx={styles.availabilityContent}>
                <div sx={styles.availabilityColumn}>
                  {/*Example_AvailabilitySection_Start*/}
                  <AvailabilitySection
                    availabilityTable="availability_days"
                    availabilitySlotsTable="availability_slots"
                  />
                  {/*Example_AvailabilitySection_End*/}
                </div>
                <Divider sx={styles.columnDivider} />
                <Divider sx={styles.rowDivider} />
                <div sx={styles.availabilityColumn}>
                  <DateSpecificHoursSection dateSpecificSlotsTable="availability_date_specific_slots" />
                  <Divider className="my-6" />
                  <TimeOffSection timeOffPeriodsTable="availability_time_off_periods" />
                </div>
              </div>
            </Sheet>
          </div>
        </Match>
        <Match when={sql`true`}>
          <Skeleton variant="text" level="h1" className="mb-4 w-full" />
        </Match>
      </Switch>
    </Data>
  );
}

interface AvailabilityPageProps {
  path?: string;
}

/**
Renders the Availability page component.
This component displays the user's availability settings, including time zone,
availability slots, date-specific hours, and time off periods.
 It also handles the state for event types and provides a dialog for selecting them.

 @category Page Component

 */
export function AvailabilityPage(props: AvailabilityPageProps) {
  const path = props.path ?? "/availability";
  useSharedContext(NavigationItemsSharedContext).add({
    label: "Availability",
    url: path,
  });
  return (
    <Route path={path}>
      <Availability />
    </Route>
  );
}
