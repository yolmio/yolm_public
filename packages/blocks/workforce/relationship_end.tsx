import { syncWorkforcePersonAccess, WorkforceBlock } from "./index";
import { ActionButton } from "std/action_button";
import { Button } from "components/button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";

export function registerWorkforceEndRelationship(workforce: WorkforceBlock) {
  system.storedProcedure({
    name: "workforce_end_relationship",
    transaction: "caller",
    inputScalars: [
      { name: "p_person_id", type: "BigInt" },
      { name: "p_relationship_id", type: "BigInt" },
      { name: "p_last_working_day", type: "Date" },
    ],
    procedure: (s) => {
      workforce.assertStaffPersonPermission(s, sql`p_person_id`);
      s.defScalar("end_date", sql`p_last_working_day + interval '1 day'`);
      s.validationErrorIf(
        sql`p_last_working_day is null or p_last_working_day < current_date() - interval '1 day'`,
        sql
          .lit`Choose yesterday to end immediately, today, or a future last working day. Use Correct history for an older correction.`,
      );
      s.validationErrorIf(
        sql`not exists (select 1 from db.${
          sql.ref(workforce.workerRelationshipsTable)
        }
          where id = p_relationship_id and person_id = p_person_id
            and effective_from < end_date
            and (effective_to is null or effective_to > current_date())
            and (effective_to is null or end_date <= effective_to))`,
        sql
          .lit`Choose a current relationship belonging to this person. Its last working day must be on or after its start and cannot extend an existing end date.`,
      );
      // Reject scheduled children before any writes; never silently erase them.
      s.validationErrorIf(
        sql`exists (select 1 from db.${sql.ref(workforce.assignmentsTable)}
          where worker_relationship_id = p_relationship_id and effective_from >= end_date)`,
        sql
          .lit`An assignment starts after the selected last working day. Review its dates with Correct history before ending this relationship.`,
      );
      if (workforce.reportingRelationshipsTable) {
        s.validationErrorIf(
          sql`exists (select 1 from db.${
            sql.ref(workforce.reportingRelationshipsTable)
          }
            where (worker_relationship_id = p_relationship_id or manager_worker_relationship_id = p_relationship_id)
              and effective_from >= end_date)`,
          sql
            .lit`A reporting relationship starts after the selected last working day. Review reporting dates before ending this relationship.`,
        );
        s.modify(sql`update db.${sql.ref(workforce.reportingRelationshipsTable)}
          set effective_to = end_date
          where (worker_relationship_id = p_relationship_id or manager_worker_relationship_id = p_relationship_id)
            and (effective_to is null or effective_to > end_date)`);
      }
      s.modify(sql`update db.${sql.ref(workforce.assignmentsTable)}
        set effective_to = end_date
        where worker_relationship_id = p_relationship_id
          and (effective_to is null or effective_to > end_date)`);
      s.modify(sql`update db.${sql.ref(workforce.workerRelationshipsTable)}
        set effective_to = end_date where id = p_relationship_id`);
      workforce.assertStaffPersonPermission(s, sql`p_person_id`);
      // The checks above validate every shortened period. Shortening cannot
      // introduce overlaps; unrelated historical errors must not block revocation.
      syncWorkforcePersonAccess(s, workforce, sql`p_person_id`);
    },
  });
}

export function WorkforceRelationshipEndAction(
  props: { relationshipId: Sql; description: Sql },
) {
  const block = system.block(WorkforceBlock);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("end_relationship_open", false);
        s.defScalar("last_working_day", sql`cast(current_date() as string)`);
      }}
    >
      <Button
        size="sm"
        variant="outlined"
        color="neutral"
        onClick={(s) => {
          s.setScalar(
            "last_working_day",
            sql`cast(current_date() as string)`,
          );
          s.setScalar("end_relationship_open", true);
        }}
      >
        End relationship
      </Button>
      <ModalDialog
        bindScalar="end_relationship_open"
        aria-label="End relationship"
        maxWidth="sm"
        className="p-5 space-y-4 whitespace-normal"
      >
        <Typography level="h4">End relationship</Typography>
        <Typography level="body-sm">{props.description}</Typography>
        <label className="block space-y-1">
          <Typography level="body-sm">Last working day</Typography>
          <Input
            type="date"
            aria-label="Last working day"
            bindScalar="last_working_day"
          />
        </label>
        <Typography level="body-sm">
          This relationship and its assignments end together after the selected
          day. Choose yesterday to end immediately. Their history is preserved.
        </Typography>
        <Typography level="body-sm">
          Work eligibility and access from this relationship stop the following
          day. Existing work stays assigned; review it before ending the
          relationship. The person remains enabled or disabled as before.
        </Typography>
        {block.opts.disableLoginWhenAccessIneligible && (
          <Typography level="body-sm">
            Login is disabled when no eligible relationship and primary
            assignment remain.
          </Typography>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="plain"
            onClick={(s) => s.setScalar("end_relationship_open", false)}
          >
            Cancel
          </Button>
          <ActionButton
            errorDisplay="inline"
            color="danger"
            action={(s) => {
              s.startTransaction();
              block.assertStaffPersonAccess(s, sql`ui.record_id`);
              s.callStoredProcedure("workforce_end_relationship", {
                inputScalars: {
                  p_person_id: sql`ui.record_id`,
                  p_relationship_id: props.relationshipId,
                  p_last_working_day:
                    sql`try_cast(ui.last_working_day as date)`,
                },
              });
              s.commitTransaction();
            }}
            afterSuccessClient={(s) => {
              s.setScalar("end_relationship_open", false);
              s.refetch();
            }}
          >
            Confirm end relationship
          </ActionButton>
        </div>
      </ModalDialog>
    </Data>
  );
}
