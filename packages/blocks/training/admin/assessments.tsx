import { Button } from "components/button";
import { currentUserHasPermission } from "blocks/auth";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Alert } from "components/alert";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import {
  currentEmployeeId,
  formatDateSql,
  trainingPermissions,
} from "../helpers";
import type { TrainingBlock } from "../index.tsx";
import { EmptyState, PageShell } from "../shared";
import {
  adminAssessmentHref,
  adminAssessmentReviewsHref,
  adminSelectClass,
} from "./shared";

export function assessmentKindChip(kind: Sql) {
  return (
    <Chip size="sm" variant="soft" color="neutral">
      {sql`case when ${kind} = 'evaluation' then 'Evaluation' else 'Test' end`}
    </Chip>
  );
}

export function assessmentExecutionModeLabelSql(mode: Sql) {
  return sql`case ${mode}::string
    when 'trainer_recorded' then 'Trainer recorded'
    when 'employee_submission_with_review' then 'Employee + review'
    else 'Employee attempt'
  end`;
}

export function TrainingAdminAssessmentsPage(
  props: { block: TrainingBlock },
) {
  const permissions = trainingPermissions;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_assessment_open", sql`false`);
        s.defScalar("assessment_search", sql.lit``);
        s.defScalar("assessment_show_archived", sql`false`);
        s.defScalar("new_assessment_name", sql.lit``);
        s.defScalar("new_assessment_description", sql.lit``);
        s.defScalar("new_assessment_kind", sql.lit`test`);
        s.defScalar("new_assessment_execution_mode", sql.lit`employee_attempt`);
        s.defScalar("assessment_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar(
          "can_review_training_assessments",
          sql`${
            currentUserHasPermission(sql.lit(permissions.reviewAssessments))
          }
            or ${
            currentUserHasPermission(sql.lit(permissions.recordEvaluations))
          }
            or ${
            currentUserHasPermission(
              sql.lit(permissions.overrideAssessmentOutcomes),
            )
          }`,
        );
      }}
    >
      <PageShell
        title="Assessments"
        subtitle="Reusable, versioned tests and evaluations. Add one to a course as an assessment step to assign it."
        actions={
          <>
            <Show when={sql`can_review_training_assessments`}>
              <Button
                component="a"
                href={adminAssessmentReviewsHref(props.block)}
                variant="outlined"
                color="neutral"
                startIcon="RateReview"
              >
                Review queue
              </Button>
            </Show>
            <Button
              startIcon="Add"
              onClick={(s) => s.setScalar("add_assessment_open", sql`true`)}
            >
              New assessment
            </Button>
          </>
        }
      >
        <div>
          <Show when={sql`assessment_error is not null`}>
            <Alert color="danger" startIcon="Error" className="mb-4">
              {sql`assessment_error`}
            </Alert>
          </Show>
          <Data
            debounce={{ wait: 300 }}
            watch={[
              sql`assessment_search`,
              sql`assessment_show_archived`,
            ]}
            procedure={(s) => {
              s.defTable(
                "assessments",
                sql`select assessment.id, assessment.name, assessment.kind,
                          assessment.execution_mode, assessment.is_active,
                          exists (
                            select 1
                            from db.training_assessment_versions v
                            where v.id =
                              assessment.current_training_assessment_version_id
                              and v.status = 'published'
                          ) as has_published_version,
                          exists (
                            select 1
                            from db.training_assessment_versions v
                            where v.training_assessment_id = assessment.id
                              and v.status = 'draft'
                          ) as has_draft_version,
                          (
                            select max(v.published_at)
                            from db.training_assessment_versions v
                            where v.training_assessment_id = assessment.id
                              and v.status = 'published'
                          ) as last_published_at,
                          (
                            select count(*)
                            from db.training_assessment_attempts att
                            join db.training_assessment_versions version
                              on version.id = att.training_assessment_version_id
                            where version.training_assessment_id = assessment.id
                              and att.status in
                                ('in_progress', 'review_pending')
                          ) as open_attempts
                        from db.training_assessments assessment
                        where (assessment.is_active
                            or ui.assessment_show_archived)
                          and (
                            nullif(trim(ui.assessment_search), '') is null
                            or lower(assessment.name) like
                              '%' || lower(trim(ui.assessment_search)) || '%'
                          )
                        order by assessment.is_active desc, assessment.name`,
              );
            }}
          >
            <div>
              <div className="mb-3 flex flex-col md:flex-row md:items-end gap-3">
                <FormControl className="flex-1">
                  <FormLabel>Search</FormLabel>
                  <Input
                    value={sql`assessment_search`}
                    placeholder="Search assessments"
                    startIcon="Search"
                    onInput={(s) =>
                      s.setScalar("assessment_search", sql`target_value`)}
                  />
                </FormControl>
                <Checkbox
                  className="md:pb-2"
                  checked={sql`assessment_show_archived`}
                  label="Include archived"
                  onCheckboxChange={(s) =>
                    s.setScalar(
                      "assessment_show_archived",
                      sql`target_checked`,
                    )}
                />
              </div>
              <Show
                when={sql`not exists (select 1 from assessments)`}
              >
                <EmptyState
                  icon="Grading"
                  title="No assessments yet"
                  body="Create an assessment, build its questions, publish it, then add it to a course as an assessment step."
                />
              </Show>
              <div
                className="bg-white border border-divider rounded-md overflow-hidden"
                dynamicClassNames={[{
                  condition: sql`not exists (select 1 from assessments)`,
                  classNames: "hidden",
                }]}
              >
                <Each table="assessments" recordName="assessment">
                  <div className="w-full p-4 border-b border-divider last:border-b-0 hover:bg-neutral-50 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <button
                        type="button"
                        className="text-left flex-1 min-w-0"
                        onClick={(s) =>
                          s.navigate(
                            adminAssessmentHref(
                              props.block,
                              sql`assessment.id`,
                            ),
                          )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Typography level="title-sm">
                            {sql`assessment.name`}
                          </Typography>
                          {assessmentKindChip(sql`assessment.kind`)}
                          <Chip size="sm" variant="soft" color="neutral">
                            {assessmentExecutionModeLabelSql(
                              sql`assessment.execution_mode`,
                            )}
                          </Chip>
                          <Show when={sql`assessment.has_draft_version`}>
                            <Chip size="sm" variant="soft" color="warning">
                              Draft
                            </Chip>
                          </Show>
                          <Show when={sql`not assessment.is_active`}>
                            <Chip size="sm" variant="soft" color="warning">
                              Archived
                            </Chip>
                          </Show>
                        </div>
                        <Typography
                          level="body-sm"
                          className="text-neutral-600 mt-1"
                        >
                          {sql`coalesce('Published ' || ${
                            formatDateSql(sql`assessment.last_published_at`)
                          }, 'Never published') ||
                              ' · ' || assessment.open_attempts::string ||
                              case when assessment.open_attempts = 1
                                then ' open attempt'
                                else ' open attempts' end`}
                        </Typography>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outlined"
                          color="neutral"
                          startIcon="Edit"
                          onClick={(s) =>
                            s.navigate(
                              adminAssessmentHref(
                                props.block,
                                sql`assessment.id`,
                              ),
                            )}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  </div>
                </Each>
              </div>
            </div>
          </Data>
          <ModalDialog bindScalar="add_assessment_open" maxWidth="lg">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Typography level="title-lg" startIcon="Grading">
                  Add Assessment
                </Typography>
                <Typography
                  level="body-sm"
                  className="text-neutral-600 mt-1"
                >
                  Name the assessment — you will build its questions right
                  after.
                </Typography>
              </div>
              <IconButton
                icon="Close"
                aria-label="Close"
                variant="plain"
                color="neutral"
                onClick={(s) => s.setScalar("add_assessment_open", sql`false`)}
              />
            </div>
            <div className="grid gap-3">
              <FormControl>
                <FormLabel>Name</FormLabel>
                <Input
                  bindScalar="new_assessment_name"
                  placeholder="Forklift Safety Exam"
                />
              </FormControl>
              <FormControl>
                <FormLabel>Purpose</FormLabel>
                <Textarea
                  bindScalar="new_assessment_description"
                  minRows={2}
                  placeholder="What this assessment verifies"
                />
              </FormControl>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormControl>
                  <FormLabel>Kind</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`new_assessment_kind`}
                    onInput={(s) => s.setScalar(
                      "new_assessment_kind",
                      sql`target_value`,
                    )}
                  >
                    <Select.Option value="test">Test</Select.Option>
                    <Select.Option value="evaluation">
                      Evaluation
                    </Select.Option>
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Who enters responses</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`new_assessment_execution_mode`}
                    onInput={(s) =>
                      s.setScalar(
                        "new_assessment_execution_mode",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="employee_attempt">
                      Employee attempt
                    </Select.Option>
                    <Select.Option value="employee_submission_with_review">
                      Employee submission with review
                    </Select.Option>
                    <Select.Option value="trainer_recorded">
                      Trainer recorded
                    </Select.Option>
                  </Select>
                </FormControl>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="plain"
                  color="neutral"
                  onClick={(s) =>
                    s.setScalar("add_assessment_open", sql`false`)}
                >
                  Cancel
                </Button>
                <Button
                  startIcon="Add"
                  onClick={(s) => {
                    s.setScalar("assessment_error", sql`null`);
                    s.if(
                      sql`nullif(trim(new_assessment_name), '') is null`,
                      (s) => {
                        s.setScalar(
                          "assessment_error",
                          sql
                            .lit`Enter the assessment name before creating it.`,
                        );
                        s.return();
                      },
                    );
                    s.tryServer({
                      body: (s) => {
                        s.defScalar("new_assessment_id", {
                          type: "BigInt",
                        });
                        s.startTransaction();
                        s.modify(sql`
                              insert into db.training_assessments
                                (name, description, kind, execution_mode,
                                 created_by_id)
                              values
                                (trim(ui.new_assessment_name),
                                 nullif(trim(ui.new_assessment_description), ''),
                                 ui.new_assessment_kind,
                                 ui.new_assessment_execution_mode,
                                 ${currentEmployeeId(props.block.opts)})
                              returning id into new_assessment_id
                            `);
                        s.modify(sql`
                              insert into db.training_assessment_versions
                                (training_assessment_id, version_label, status,
                                 created_by_id)
                              values
                                (new_assessment_id, 'Draft', 'draft',
                                 ${currentEmployeeId(props.block.opts)})
                            `);
                        s.commitTransaction();
                        s.setScalar("add_assessment_open", sql`false`);
                        s.setScalar("new_assessment_name", sql.lit``);
                        s.setScalar(
                          "new_assessment_description",
                          sql.lit``,
                        );
                        s.navigate(
                          adminAssessmentHref(
                            props.block,
                            sql`new_assessment_id`,
                          ),
                        );
                      },
                      catch: (s) => {
                        s.setScalar(
                          "assessment_error",
                          sql.lit`The assessment could not be created.`,
                        );
                      },
                    });
                  }}
                >
                  Create and add questions
                </Button>
              </div>
            </div>
          </ModalDialog>
        </div>
      </PageShell>
    </Data>
  );
}
