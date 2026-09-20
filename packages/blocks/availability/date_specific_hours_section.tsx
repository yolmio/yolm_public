import { AutoInsertDialog } from "components/auto_insert_dialog";
import { Button } from "components/button";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { Each, Show } from "std/ui";

const styles = createStyles({
  sectionWrapper: {
    borderRadius: "lg",
    boxShadow: "sm",
    width: "100%",
    p: 4,
  },
  dateOverrideWrapper: {
    p: 2,
    borderRadius: "md",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    md: {
      width: "80%",
    },
  },
  dateOverrideRow: {
    p: 2,
    backgroundColor: "neutral-100",

    borderRadius: "md",
    display: "flex",
    flexDirection: "row",

    alignItems: "center",
  },
});

interface DateSpecificHoursSectionOpts {
  dateSpecificSlotsTable: string;
}

export function DateSpecificHoursSection(opts: DateSpecificHoursSectionOpts) {
  return (
    <div sx={styles.sectionWrapper}>
      <Typography level="h3">Date-specific Hours</Typography>

      <Data
        local
        procedure={(s) => {
          s.defScalar("isDialogOpen", sql`false`);
        }}
      >
        <div className="flex flex-row gap-4 items-center justify-between m-6">
          <Typography level="body-md" className="mb-4">
            Override your availability for specific dates.
          </Typography>

          <Button
            variant="outlined"
            color="neutral"
            startIcon="Add"
            sx={{
              mb: 4,
              alignSelf: "flex-end",
              borderRadius: 100,
              borderColor: "divider",
            }}
            onClick={(s) => {
              s.setScalar("isDialogOpen", sql`true`);
            }}
          >
            Hours
          </Button>
        </div>
        <Data
          procedure={(s) => {
            s.defTable(
              "date_specific_years",
              sql`select distinct date.part(year, date) as year from db.${
                sql.ref(opts.dateSpecificSlotsTable)
              } where sys_user_id = current_user`,
            );
            s.defTable(
              "date_specific_slots",
              sql`select * from db.${
                sql.ref(opts.dateSpecificSlotsTable)
              } where sys_user_id = current_user`,
            );
          }}
        >
          <Each table="date_specific_years" recordName="date_specific_year">
            <div className="font-bold mb-2 text-neutral-500 text-sm">
              {sql`date_specific_year.year`}
            </div>

            <div>
              <Each table="date_specific_slots" recordName="date_specific_slot">
                <Show
                  when={sql`date.part(year, date_specific_slot.date) = date_specific_year.year`}
                >
                  <div sx={styles.dateOverrideWrapper}>
                    <div>
                      <div sx={styles.dateOverrideRow}>
                        <div
                          sx={{
                            fontWeight: "bold",
                            alignItems: "center",
                            pl: 1,
                            flex: 1,
                            fontSize: "sm",
                            color: "black",
                          }}
                        >
                          {sql`concat(
                                case substring(date_specific_slot.date, 6, 2)
                                  when '01' then 'Jan'
                                  when '02' then 'Feb'
                                  when '03' then 'Mar'
                                  when '04' then 'Apr'
                                  when '05' then 'May'
                                  when '06' then 'Jun'
                                  when '07' then 'Jul'
                                  when '08' then 'Aug'
                                  when '09' then 'Sep'
                                  when '10' then 'Oct'
                                  when '11' then 'Nov'
                                  when '12' then 'Dec'
                                end,
                                ' ',
                                substring(date_specific_slot.date, 9, 2)
                              )`}
                        </div>
                        <div
                          sx={{
                            display: "flex",
                            flexDirection: "row",
                            justifyContent: "flex-end",
                            flex: 1,
                            mr: 2,
                          }}
                        >
                          <Typography
                            className="text-sm"
                            sx={{ color: "black" }}
                          >
                            {sql`substring(date_specific_slot.start_time, 1, 5)`}
                          </Typography>

                          <Typography
                            level="body-md"
                            className="mx-2"
                            sx={{ color: "black" }}
                          >
                            -
                          </Typography>
                          <Typography
                            className="text-sm"
                            sx={{ color: "black" }}
                          >
                            {sql`substring(date_specific_slot.end_time, 1, 5)`}
                          </Typography>
                        </div>
                        <DeleteRecordButton
                          table={opts.dateSpecificSlotsTable}
                          recordId={sql`date_specific_slot.id`}
                          size="sm"
                          variant="plain"
                          color="neutral"
                          aria-label="Delete date override"
                          label=""
                          afterSubmitClient={(s) => {
                            s.refetch();
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </Show>
              </Each>
            </div>
          </Each>
        </Data>
        <AutoInsertDialog
          table={opts.dateSpecificSlotsTable}
          afterTransactionCommit={(s) => {
            s.refetch();
          }}
          bindScalar="isDialogOpen"
          values={{
            sys_user_id: sql`current_user`,
          }}
        />
      </Data>
    </div>
  );
}
