import { AutoInsertDialog } from "components/auto_insert_dialog";
import { Button } from "components/button";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import { Each } from "std/ui";

const styles = createStyles({
  sectionWrapper: {
    borderRadius: "lg",
    boxShadow: "sm",
    p: 4,
  },
  timeOffWrapper: {
    p: 6,
    backgroundColor: "neutral-100",
    borderRadius: "md",
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

interface TimeOffSectionProps {
  timeOffPeriodsTable: string;
}

/**
 TimeOffSection component for managing time off periods.
 Displays a list of existing time off periods and allows adding new ones.

 @category UI Component

*/
export function TimeOffSection(props: TimeOffSectionProps) {
  return (
    <div sx={styles.sectionWrapper}>
      <Typography level="h3" className="mb-6">
        Time Off
      </Typography>
      <Data
        local
        procedure={(s) => {
          s.defScalar("isDialogOpen", sql`false`);
        }}
      >
        <div className="flex justify-between items-center mb-8">
          <Typography level="body-md">
            Manage your time off periods
          </Typography>

          <Button
            variant="outlined"
            color="neutral"
            startIcon="Add"
            sx={{
              alignSelf: "flex-end",
              borderRadius: 100,
              borderColor: "divider",
            }}
            onClick={(s) => {
              s.setScalar("isDialogOpen", sql`true`);
            }}
          >
            Add Time Off
          </Button>
        </div>
        <div
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 3,
          }}
        >
          <Data
            procedure={(s) => {
              s.defTable(
                "time_off_periods",
                sql`select * from db.${
                  sql.ref(props.timeOffPeriodsTable)
                } where sys_user_id = current_user`,
              );
            }}
          >
            <Each table="time_off_periods" recordName="period">
              <div sx={styles.timeOffWrapper}>
                <div className="flex flex-col">
                  <div
                    className="font-bold mb-4 text-base"
                    sx={{ color: "black" }}
                  >
                    {sql`period.title`}
                  </div>
                  <div
                    className="flex flex-row gap-4 text-sm"
                    sx={{ color: "black" }}
                  >
                    {sql`period.start_date`}
                    <Typography level="body-md" sx={{ color: "black" }}>
                      -
                    </Typography>
                    {sql`period.end_date`}
                  </div>
                  <div className="mt-4 text-sm" sx={{ color: "black" }}>
                    {sql`period.notes`}
                  </div>
                </div>
                <div className="h-auto">
                  <DeleteRecordButton
                    table={props.timeOffPeriodsTable}
                    recordId={sql`period.id`}
                    size="sm"
                    variant="plain"
                    color="neutral"
                    aria-label="Delete time off period"
                    afterSubmitClient={(s) => {
                      s.refetch();
                    }}
                  />
                </div>
              </div>
            </Each>
          </Data>
        </div>
        <AutoInsertDialog
          table={props.timeOffPeriodsTable}
          bindScalar="isDialogOpen"
          afterTransactionCommit={(s) => {
            s.refetch();
          }}
          values={{
            sys_user_id: sql`current_user`,
          }}
        />
      </Data>
    </div>
  );
}
