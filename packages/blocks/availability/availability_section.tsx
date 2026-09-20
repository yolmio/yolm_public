import { FieldFormControl } from "components/field_form_control";
import { Typography } from "components/typography";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { Show, usePhase } from "std/ui";
import type { Node } from "std/ui";
import { Form, useCursorHelper } from "std/form";

const styles = createStyles({
  sectionWrapper: {
    p: 0,
    md: {
      p: 2,
    },
  },
  dayRow: {
    display: "flex",
    alignItems: "flex-start",
    mb: 4,
    flexDirection: "column",
    md: {
      flexDirection: "row",
    },
  },
  dayLabel: {
    display: "flex",
    alignItems: "center",
    pt: 2,
    minWidth: "80px",
    maxWidth: "80px",
  },
  slotsWrapper: {
    flex: 1,
    sm: {
      width: "100%",
    },
  },
  slotRow: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    lg: {
      gap: 4,
    },
  },
  slotActions: {
    display: "flex",
    mr: 1.4,
  },
  timeInput: {
    width: "auto",
  },
  errorText: {
    color: "red",
    mt: 2,
  },
});

interface AvailabilitySectionOpts {
  availabilityTable: string;
  availabilitySlotsTable: string;
}

/**
 A component that displays and manages availability settings for scheduling.

 @category UI Component

 */
export function AvailabilitySection(opts: AvailabilitySectionOpts) {
  const availabilityTableIdent = sql.ref(opts.availabilityTable);
  const availabilityStateTableIdent = sql.ref(
    `write_${opts.availabilityTable}`,
  );
  const slotsTableIdent = sql.ref(opts.availabilitySlotsTable);
  const slotsStateTableIdent = sql.ref(
    `write_${opts.availabilitySlotsTable}`,
  );
  const slotsInitialIdsStateTableIdent = sql.ref(
    `write_${opts.availabilitySlotsTable}_initial_db_ids`,
  );
  return (
    <div sx={styles.sectionWrapper}>
      <Typography level="h3" className="mb-6">
        Available hours
      </Typography>

      <Typography level="body-md" className="mb-4">
        Manage the hours you're usually available for meetings
      </Typography>
      <Form
        defaultFieldComponent={FieldFormControl}
        afterTransactionStart={(s) => {
          s.if(
            sql`exists (
              select 1
              from ui.${availabilityStateTableIdent} as submitted_day
              left join db.${availabilityTableIdent} as persisted_day
                on persisted_day.id = submitted_day.write_db_id
              where persisted_day.sys_user_id is null
                or persisted_day.sys_user_id != current_user
                or submitted_day.day != persisted_day.day
            ) or exists (
              select 1
              from ui.${slotsStateTableIdent} as submitted_slot
              left join db.${slotsTableIdent} as persisted_slot
                on persisted_slot.id = submitted_slot.write_db_id
              left join ui.${availabilityStateTableIdent} as submitted_day
                on submitted_day.write_ui_id = submitted_slot.parent_write_ui_id
              left join db.${availabilityTableIdent} as persisted_day
                on persisted_day.id = submitted_day.write_db_id
              where submitted_slot.write_db_id is not null
                and (
                  persisted_slot.availability_day_id is null
                  or persisted_day.sys_user_id is null
                  or persisted_day.sys_user_id != current_user
                  or persisted_slot.availability_day_id != persisted_day.id
                )
            ) or exists (
              select 1
              from db.${slotsTableIdent} as current_slot
              join db.${availabilityTableIdent} as current_day
                on current_day.id = current_slot.availability_day_id
              join ui.${availabilityStateTableIdent} as submitted_day
                on submitted_day.write_db_id = current_day.id
              left join ui.${slotsInitialIdsStateTableIdent} as initial_slot
                on initial_slot.id = current_slot.id
              left join ui.${slotsStateTableIdent} as submitted_slot
                on submitted_slot.write_db_id = current_slot.id
              where current_day.sys_user_id = current_user
                and initial_slot.id is null
                and submitted_slot.write_db_id is null
            )`,
            (s) => {
              s.throwError(
                sql
                  .lit`Your availability session is out of date. Refresh the page and try again.`,
              );
            },
          );
          s.if(
            sql`exists (
              select 1
              from ui.${slotsStateTableIdent} as submitted_slot
              where submitted_slot.start_time >= submitted_slot.end_time
            ) or exists (
              select 1
              from ui.${slotsStateTableIdent} as first_slot
              join ui.${slotsStateTableIdent} as second_slot
                on second_slot.parent_write_ui_id = first_slot.parent_write_ui_id
                and second_slot.write_ui_id > first_slot.write_ui_id
                and first_slot.start_time < second_slot.end_time
                and first_slot.end_time > second_slot.start_time
            )`,
            (s) => {
              s.throwError(
                sql
                  .lit`Availability slots must have a start time before their end time and must not overlap.`,
              );
            },
          );
        }}
      >
        <Form.UpdateMany
          table={opts.availabilityTable}
          fields={["day"]}
          where={sql`sys_user_id = current_user`}
        >
          <Form.Each recordName="day">
            <div sx={styles.dayRow}>
              <div sx={styles.dayLabel}>
                <Form.CheckboxField
                  field="enabled"
                  label={sql`upper(day.day)`}
                  variant="outlined"
                />
              </div>
              <div sx={styles.slotsWrapper}>
                <AvailabilitySlotsTableComponent
                  availabilitySlotsTable={opts.availabilitySlotsTable}
                >
                  <Form.Relation
                    table={opts.availabilitySlotsTable}
                    deleteBehavior="initial"
                  >
                    <Form.Each recordName="time_slot">
                      <div sx={styles.slotRow}>
                        <div sx={styles.timeInput}>
                          <Form.Field field="start_time" />
                        </div>
                        <div sx={styles.timeInput}>
                          <Form.Field field="end_time" />
                        </div>
                        <div sx={styles.slotActions}>
                          <Form.DeleteRecordIconButton
                            aria-label={sql`'Remove time slot ' || day.day`}
                            icon="Close"
                            size="sm"
                            variant="plain"
                            color="neutral"
                          />
                          <Show
                            when={sql`not exists (
                                select 1
                                from write_${
                              sql.ref(opts.availabilitySlotsTable)
                            } as first_slot
                                where first_slot.parent_write_ui_id = day.write_ui_id
                                and first_slot.write_ui_id < time_slot.write_ui_id
                              )`}
                          >
                            <Form.AddCurrentTableButton
                              size="sm"
                              variant="plain"
                              color="neutral"
                              startIcon="Add"
                              //added label for testing purposes
                              aria-label={sql`'Add time slot ' || day.day`}
                            />
                          </Show>
                        </div>
                      </div>
                      <Show
                        // when={true}
                        when={sql`exists (
                           select 1
                            from write_${
                          sql.ref(opts.availabilitySlotsTable)
                        } as other_slot
                            where parent_write_ui_id = day.write_ui_id
                              and (
                                (other_slot.start_time < time_slot.end_time and other_slot.end_time > time_slot.start_time)
                                or (other_slot.start_time = time_slot.start_time and other_slot.end_time = time_slot.end_time)
                              )
                                 and other_slot.write_ui_id != time_slot.write_ui_id
                          )`}
                      >
                        <Typography sx={styles.errorText}>
                          This slot overlaps with another slot
                        </Typography>
                      </Show>
                      <Show
                        when={sql`time_slot.start_time >= time_slot.end_time`}
                      >
                        <Typography sx={styles.errorText}>
                          Start time must be before end time
                        </Typography>
                      </Show>
                    </Form.Each>
                    <Show
                      when={sql`not exists (
                             select 1
                             from write_${
                        sql.ref(opts.availabilitySlotsTable)
                      } as slot
                             where slot.parent_write_ui_id = day.write_ui_id
                           )`}
                    >
                      <div sx={styles.slotRow}>
                        <Form.AddCurrentTableButton
                          //added label for testing purposes
                          aria-label={sql`'Add time slot ' || day.day`}
                          size="sm"
                          variant="plain"
                          color="neutral"
                          startIcon="Add"
                        />
                      </div>
                    </Show>
                  </Form.Relation>
                </AvailabilitySlotsTableComponent>
              </div>
            </div>
          </Form.Each>

          <Form.ErrorAlert />
          <Form.SubmitButton>Save</Form.SubmitButton>
        </Form.UpdateMany>
      </Form>
    </div>
  );
}

function AvailabilitySlotsTableComponent(props: {
  availabilitySlotsTable: string;
  children: Node;
}) {
  if (usePhase() === "gather") {
    return props.children;
  }
  const cursor = useCursorHelper();
  const enabled = cursor.field("enabled").value;
  return (
    <div sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <Show
        when={enabled}
        fallback={
          <Typography level="body-md" sx={{ height: 40, ml: 3, color: "grey" }}>
            Unavailable
          </Typography>
        }
      >
        {props.children}
      </Show>
    </div>
  );
}
