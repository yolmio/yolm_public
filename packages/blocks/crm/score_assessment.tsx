import { AuthBlock, currentUserHasPermission } from "blocks/auth";
import { Card, CardHeader } from "components/card";
import { Input } from "components/input";
import { Typography } from "components/typography";
import { Form } from "std/form";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import { system } from "std/system";
import type { CrmBlock } from "./index";

/** Name of the shared manual-assessment procedure for a CRM score. */
export function scoreAssessmentProcedureName(table: string) {
  return `${table}_assess_score`;
}

/** Registers validated score writes without prescribing a customer's scoring formula. */
export function registerCrmScoreProcedures(block: CrmBlock) {
  const scores = [
    ...(block.hasAdoptionTrackingEnabled()
      ? [{ table: block.projectsTableName, field: "adoption_score" }]
      : []),
    ...(block.hasSuccessPlansEnabled()
      ? [{ table: block.successPlansTableName, field: "health_score" }]
      : []),
  ];
  for (const { table, field } of scores) {
    system.storedProcedure({
      name: scoreAssessmentProcedureName(table),
      transaction: "caller",
      inputScalars: [
        { name: "p_record_id", type: "BigInt", notNull: true },
        { name: "p_score", type: "Int" },
      ],
      procedure: (s) => {
        s.throwErrorIf(
          sql`p_score < 0 or p_score > 100`,
          sql.lit`Score must be between 0 and 100.`,
        );
        s.throwErrorIf(
          sql`not exists (select 1 from db.${
            sql.ref(table)
          } where id = p_record_id)`,
          sql.lit`Assessment record not found.`,
        );
        s.modify(sql`update db.${sql.ref(table)}
          set ${sql.ref(field)} = p_score,
              ${
          sql.ref(`${field}_calculated_at`)
        } = case when p_score is null then null else now() end,
              last_modified_at = now()
          where id = p_record_id`);
      },
    });
  }
}

/** Explicit manual score assessment, with a timestamp and shared server validation. */
export function ScoreAssessmentForm(props: {
  table: string;
  recordId: NumericExpr;
  score: NumericExpr;
  assessedAt: Sql;
  title: string;
  editPermission: string;
}) {
  return (
    <AuthBlock.PermissionCheck permission={props.editPermission}>
      <Card variant="outlined" className="p-4">
        <CardHeader>{props.title}</CardHeader>
        <Typography level="body-sm" className="mt-2 mb-3 text-tertiary">
          Record a manual assessment from 0 to 100. Leave blank to clear it.
          Last assessed:{" "}
          {sql`coalesce(format.date(${props.assessedAt}, '%b %d, %Y'), 'Never')`}
        </Typography>
        <Form
          afterTransactionStart={(s) => {
            s.throwErrorIf(
              sql`${
                currentUserHasPermission(sql.lit(props.editPermission))
              } is not true`,
              sql.lit`You do not have permission to edit this assessment.`,
            );
            s.callStoredProcedure(scoreAssessmentProcedureName(props.table), {
              inputScalars: {
                p_record_id: props.recordId,
                p_score: sql`ui.score_assessment.score`,
              },
            });
          }}
          afterSubmitClientSuccess={(s) => s.refetch()}
        >
          <Form.Temporary name="score_assessment">
            <Form.Field
              field="score"
              fieldType="Int"
              initialValue={props.score}
            >
              {(helper) => (
                <Input
                  aria-label={props.title}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={helper.value}
                  onInput={(s) =>
                    helper.setValue(
                      s,
                      sql`try_cast(nullif(target_value, '') as int)`,
                    )}
                />
              )}
            </Form.Field>
          </Form.Temporary>
          <Form.ErrorAlert mode="all" className="mt-2" />
          <Form.SubmitButton className="mt-3">
            Save assessment
          </Form.SubmitButton>
        </Form>
      </Card>
    </AuthBlock.PermissionCheck>
  );
}
