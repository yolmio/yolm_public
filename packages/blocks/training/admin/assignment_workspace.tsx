import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import type { HelperProcField, StateStatements } from "std/statements";
import { system } from "std/system";
import { Each, type Node, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import type { TrainingBlockOpts } from "../types.ts";
import {
  activeVersionIdSql,
  assignableCourseItemCountSql,
  assignmentLanguageSql,
  audienceMatchesEmployeeSql,
  employeeName,
  missingActiveVersionCountSql,
  openTrainingAssignmentWhereSql,
  personLanguageSql,
  personPrimaryJobProfileSql,
  personTable,
  personTypeSql,
} from "../helpers";
import { EmptyState } from "../shared";
import {
  adminSelectClass,
  AudienceMultiSelect,
  defineAssignmentGroupScalars,
  defineAssignmentGroupTables,
  EmployeeAssignmentCombobox,
} from "./shared";

/**
 * Defines the UI state scalars shared by both assignment workspaces.
 * Prefixes must match what the enclosing pages already registered
 * (document: `direct_assign_*` / `doc_rule_*`, course: `assign_*` /
 * `rule_*`) so UI state stays wire-compatible.
 */
export function defineAssignmentWorkspaceState(
  s: StateStatements,
  opts: {
    block: TrainingBlock;
    assignScalarPrefix: string;
    ruleScalarPrefix: string;
    dueDateExpr?: Sql;
  },
) {
  const p = opts.assignScalarPrefix;
  const rp = opts.ruleScalarPrefix;
  s.defScalar(`${p}_mode`, sql.lit`ongoing`);
  s.defScalar(`${rp}_audience_ids`, sql.lit``);
  s.defScalar(`${rp}_language`, sql.lit``);
  s.defScalar(`${rp}_renewal_interval_days`, sql.lit``);
  s.defScalar(
    `${p}_due_date`,
    opts.dueDateExpr === undefined
      ? { type: "Date" }
      : { type: "Date", expr: opts.dueDateExpr },
  );
  s.defScalar(`${p}_reason`, sql.lit``);
  s.defScalar(`${p}_notify`, sql`true`);
  s.defScalar(`${p}_person_id`, { type: "BigInt" });
  defineAssignmentGroupScalars(s, {
    prefix: `${p}_group`,
    block: opts.block,
  });
  s.defScalar(`${p}_message`, {
    type: { type: "String", maxLength: 1000 },
  });
  s.defScalar(`${p}_error`, {
    type: { type: "String", maxLength: 1000 },
  });
}

/**
 * The shared admin assignment workspace used for both training documents
 * and training courses/programs: mode toggle, one-time assignment (single
 * person and by group), ongoing rule creation, and the active rules list.
 * Side-specific panels are passed as `children` and their query tables via
 * `extraDataProcedure` so they share this workspace's `Data` scope (and
 * therefore its `s.refetch()`).
 */
export function AssignmentWorkspace(props: {
  block: TrainingBlock;
  kind: "document" | "course";
  targetId: Sql;
  assignScalarPrefix: string;
  ruleScalarPrefix: string;
  extraDataProcedure?: (s: StateStatements) => void;
  children?: Node;
}) {
  const block = props.block;
  const targetId = props.targetId;
  const isDoc = props.kind === "document";
  const p = props.assignScalarPrefix;
  const rp = props.ruleScalarPrefix;
  const g = `${p}_group`;
  const hasGroupAssignByJob =
    block.opts.workforce.personPrimaryJobProfileId !== undefined;

  const mode = sql.ref(`${p}_mode`);
  const message = sql.ref(`${p}_message`);
  const error = sql.ref(`${p}_error`);
  const uiMessage = `ui.${p}_message`;
  const uiError = `ui.${p}_error`;
  const uiDueDate = sql`ui.${sql.ref(`${p}_due_date`)}`;
  const uiReason = sql`ui.${sql.ref(`${p}_reason`)}`;
  const uiNotify = sql`ui.${sql.ref(`${p}_notify`)}`;
  const uiPersonId = sql`ui.${sql.ref(`${p}_person_id`)}`;
  const groupTarget = sql.ref(`${g}_target`);
  const groupAudienceId = sql.ref(`${g}_audience_id`);
  const groupJobProfile = sql.ref(`${g}_job_profile`);
  const groupPersonType = sql.ref(`${g}_person_type`);
  const groupLanguage = sql.ref(`${g}_language`);
  const uiGroupTarget = sql`ui.${groupTarget}`;
  const uiGroupAudienceId = sql`ui.${groupAudienceId}`;
  const uiGroupJobProfile = sql`ui.${groupJobProfile}`;
  const uiGroupPersonType = sql`ui.${groupPersonType}`;
  const uiGroupLanguage = sql`ui.${groupLanguage}`;
  const uiRuleAudienceIds = sql`ui.${sql.ref(`${rp}_audience_ids`)}`;
  const uiRuleLanguage = sql`ui.${sql.ref(`${rp}_language`)}`;
  const uiRuleRenewal = sql`ui.${sql.ref(`${rp}_renewal_interval_days`)}`;

  const ruleColumn = sql.ref(isDoc ? "document_id" : "training_course_id");
  const targetRecord = isDoc ? sql`assign_document` : sql`selected_course`;
  const programOrCourse =
    sql`case when selected_course.is_program then 'program' else 'course' end`;

  const onceFormFields = isDoc
    ? (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <FormControl>
          <FormLabel>Due date</FormLabel>
          <Input type="date" bindScalar={`${p}_due_date`} />
        </FormControl>
        <FormControl className="md:col-span-2">
          <FormLabel>Assignment reason</FormLabel>
          <Input
            bindScalar={`${p}_reason`}
            placeholder="Policy update, onboarding, supervisor request"
          />
        </FormControl>
        <label className="flex items-start gap-3 rounded-md border border-divider bg-neutral-50 p-3 md:col-span-3">
          <span className="pt-0.5 shrink-0">
            <Checkbox bindScalar={`${p}_notify`} />
          </span>
          <span className="text-sm text-neutral-700">
            Notify selected people
          </span>
        </label>
      </div>
    )
    : (
      <>
        <FormControl>
          <FormLabel>Due date</FormLabel>
          <Input type="date" bindScalar={`${p}_due_date`} />
        </FormControl>
        <FormControl className="mt-4">
          <FormLabel>Assignment reason</FormLabel>
          <Textarea
            bindScalar={`${p}_reason`}
            minRows={2}
            placeholder="Onboarding, annual renewal, policy revision, retraining, supervisor request"
          />
        </FormControl>
        <label className="mt-3 flex items-start gap-3 rounded-md border border-divider bg-neutral-50 p-3">
          <span className="pt-0.5 shrink-0">
            <Checkbox bindScalar={`${p}_notify`} />
          </span>
          <span className="text-sm text-neutral-700">
            Notify employee
          </span>
        </label>
      </>
    );

  return (
    <Data
      procedure={(s) => {
        if (isDoc) {
          s.defRecord(
            "assign_document",
            sql`select document.title,
                         coalesce(training_settings.due_within_days, 7)
                           as due_within_days
                  from db.training_content_documents document
                  left join db.training_document_settings training_settings
                    on training_settings.document_id = document.id
                  where document.id = ${targetId}
                    and ${
              block.opts.content.canReadDocument(
                sql`document.id`,
                sql`current_user`,
              )
            }`,
          );
        } else {
          s.defRecord(
            "selected_course",
            sql`select c.id, c.name, c.description,
                       c.current_training_course_version_id,
                       c.due_within_days,
                       c.is_active,
                       exists (
                         select 1
                         from db.training_course_section_items i
                         join db.training_course_sections section
                           on section.id = i.training_course_section_id
                         where section.training_course_version_id =
                             c.current_training_course_version_id
                           and i.type = 'other_checklist'
                       ) as is_program
                from db.training_courses c
                where c.id = ${targetId}`,
          );
        }
        defineAssignmentGroupTables(s, {
          tablePrefix: g,
          block,
        });
        s.defTable(
          "assignment_rules",
          sql`select r.id, ${targetRecord}.due_within_days,
                  r.renewal_interval_days,
                  coalesce(
                    (
                      select string_agg(audience.name, ', ' order by audience.name)
                      from db.training_requirement_audiences requirement_audience
                      join db.training_audiences audience
                        on audience.id = requirement_audience.training_audience_id
                      where requirement_audience.training_requirement_id = r.id
                    ),
                    'All people'
                  ) as audience_name,
                  coalesce(lang.name, 'Employee language') as language_name
              from db.training_requirements r
              left join db.training_content_languages lang
                on lang.code = r.training_language
              where r.${ruleColumn} = ${targetId}
                and r.is_active
              order by ${
            isDoc ? sql`audience_name` : sql`audience_name, r.name`
          }`,
        );
        props.extraDataProcedure?.(s);
      }}
    >
      <Card variant="outlined">
        <CardHeader>
          <div>
            <Typography level="title-lg" startIcon="AssignmentInd">
              {isDoc
                ? "Assign Document"
                : sql`'Assign ' || selected_course.name`}
            </Typography>
            <Typography level="body-sm" className="text-neutral-600">
              {isDoc
                ? "Assign this document once, or create an ongoing rule that keeps the right people assigned automatically. Each task uses the person's language when an active version exists."
                : sql`case when selected_course.is_program
                    then 'Choose who receives this program and how they stay assigned.'
                    else 'Choose who receives this course and how they stay assigned.'
                  end`}
            </Typography>
          </div>
        </CardHeader>
        <CardContent>
          <Show when={sql`${message} is not null`}>
            <Alert color="success" startIcon="CheckCircle" className="mb-4">
              {message}
            </Alert>
          </Show>
          <Show when={sql`${error} is not null`}>
            <Alert color="danger" startIcon="Error" className="mb-4">
              {error}
            </Alert>
          </Show>
          <div className="mb-5 flex flex-col gap-2">
            <Typography level="title-sm">
              How should people be assigned?
            </Typography>
            <div
              role="radiogroup"
              aria-label="Assignment method"
              className="grid grid-cols-1 gap-2 md:grid-cols-2"
            >
              {[
                {
                  value: "ongoing",
                  icon: "Autorenew" as const,
                  title: "Keep assigned automatically",
                  body: isDoc
                    ? "An ongoing audience rule. The scheduled job keeps matching people assigned, including future hires, renewals, and new versions."
                    : "An ongoing assignment rule. The scheduled job keeps matching people assigned, including future hires, renewals, and new versions.",
                },
                {
                  value: "once",
                  icon: "GroupAdd" as const,
                  title: "Assign once",
                  body: "Choose people or a group and assign them right now.",
                },
              ].map((option) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={sql`case when ${mode} = ${
                    sql.lit(option.value)
                  } then 'true' else 'false' end`}
                  className="flex items-start gap-3 rounded-md border border-divider bg-white p-3 text-left transition-colors hover:border-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                  dynamicClassNames={[{
                    condition: sql`${mode} = ${sql.lit(option.value)}`,
                    classNames:
                      "border-primary-500 bg-primary-50 hover:border-primary-500",
                  }]}
                  onClick={(s) => {
                    s.setScalar(`${p}_mode`, sql.lit(option.value));
                    s.setScalar(`${p}_error`, sql`null`);
                  }}
                >
                  <MaterialIcon
                    icon={option.icon}
                    className="mt-0.5 text-primary-600"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <Typography level="title-sm">{option.title}</Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      {option.body}
                    </Typography>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Show when={sql`${mode} = 'once'`}>
            {onceFormFields}
            <div className="mt-4 rounded-md border border-divider bg-neutral-50 p-3">
              <Typography level="title-md" startIcon="Groups">
                Assign by group
              </Typography>
              <Typography level="body-sm" className="text-neutral-600">
                {isDoc
                  ? "Manually create document assignments for everyone matching a dynamic audience, job, role, or all people."
                  : "Manually create assignments for everyone matching a dynamic audience, job, role, or all people."}
              </Typography>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <FormControl>
                  <FormLabel>Target</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={groupTarget}
                    onInput={(s) => {
                      s.setScalar(`${g}_target`, sql`target_value`);
                      s.setScalar(`${g}_audience_id`, sql.lit``);
                      if (hasGroupAssignByJob) {
                        s.setScalar(`${g}_job_profile`, sql.lit``);
                      }
                      s.setScalar(`${g}_person_type`, sql.lit``);
                    }}
                  >
                    <Select.Option value="audience">
                      Dynamic audience
                    </Select.Option>
                    {hasGroupAssignByJob && (
                      <Select.Option value="job">Job</Select.Option>
                    )}
                    <Select.Option value="role">
                      Role / person type
                    </Select.Option>
                    <Select.Option value="all">All people</Select.Option>
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Language</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={groupLanguage}
                    onInput={(s) => {
                      s.setScalar(`${g}_language`, sql`target_value`);
                    }}
                  >
                    <Select.Option value="">Employee language</Select.Option>
                    <Each table={`${g}_languages`} recordName="language">
                      <Select.Option value={sql`language.code`}>
                        {sql`language.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
                <Show when={sql`${groupTarget} = 'audience'`}>
                  <FormControl className="md:col-span-2">
                    <FormLabel>Dynamic audience</FormLabel>
                    <Select
                      className={adminSelectClass}
                      value={groupAudienceId}
                      onInput={(s) => {
                        s.setScalar(`${g}_audience_id`, sql`target_value`);
                      }}
                    >
                      <Select.Option value="">Choose audience</Select.Option>
                      <Each table={`${g}_audiences`} recordName="audience">
                        <Select.Option value={sql`audience.id`}>
                          {sql`audience.name`}
                        </Select.Option>
                      </Each>
                    </Select>
                  </FormControl>
                </Show>
                {hasGroupAssignByJob && (
                  <Show when={sql`${groupTarget} = 'job'`}>
                    <FormControl className="md:col-span-2">
                      <FormLabel>Job</FormLabel>
                      <Select
                        className={adminSelectClass}
                        value={groupJobProfile}
                        onInput={(s) => {
                          s.setScalar(`${g}_job_profile`, sql`target_value`);
                        }}
                      >
                        <Select.Option value="">Choose job</Select.Option>
                        <Each table={`${g}_job_profiles`} recordName="job">
                          <Select.Option value={sql`job.job_profile`}>
                            {sql`job.job_profile`}
                          </Select.Option>
                        </Each>
                      </Select>
                    </FormControl>
                  </Show>
                )}
                <Show when={sql`${groupTarget} = 'role'`}>
                  <FormControl className="md:col-span-2">
                    <FormLabel>Role / person type</FormLabel>
                    <Select
                      className={adminSelectClass}
                      value={groupPersonType}
                      onInput={(s) => {
                        s.setScalar(`${g}_person_type`, sql`target_value`);
                      }}
                    >
                      <Select.Option value="">Choose role</Select.Option>
                      <Each
                        table={`${g}_person_types`}
                        recordName="person_type"
                      >
                        <Select.Option value={sql`person_type.person_type`}>
                          {sql`person_type.person_type`}
                        </Select.Option>
                      </Each>
                    </Select>
                  </FormControl>
                </Show>
              </div>
              <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <Typography level="body-sm" className="text-neutral-600">
                  {isDoc
                    ? "Matching people are resolved when you assign."
                    : "Assigns the people who match right now — people who match later are not included."}
                </Typography>
                <Button
                  startIcon="GroupAdd"
                  onClick={(s) => {
                    s.setScalar(`${p}_message`, sql`null`);
                    s.setScalar(`${p}_error`, sql`null`);
                    s.tryServer({
                      body: (s) => {
                        block.assertCanAssignTraining(s);
                        if (isDoc) {
                          s.throwErrorUnless(
                            block.opts.content.canReadDocument(
                              targetId,
                              sql`current_user`,
                            ),
                            sql.lit`You cannot assign this document.`,
                          );
                        }
                        s.if(
                          sql`${uiGroupTarget} = 'audience'
                          and ${uiGroupAudienceId} = ''`,
                          (s) => {
                            s.setScalar(
                              uiError,
                              sql
                                .lit`Choose a dynamic audience before assigning by group.`,
                            );
                            s.return();
                          },
                        );
                        if (hasGroupAssignByJob) {
                          s.if(
                            sql`${uiGroupTarget} = 'job'
                            and ${uiGroupJobProfile} = ''`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`Choose a job before assigning by group.`,
                              );
                              s.return();
                            },
                          );
                        }
                        s.if(
                          sql`${uiGroupTarget} = 'role'
                          and ${uiGroupPersonType} = ''`,
                          (s) => {
                            s.setScalar(
                              uiError,
                              sql
                                .lit`Choose a role before assigning by group.`,
                            );
                            s.return();
                          },
                        );
                        if (isDoc) {
                          s.callStoredProcedure(
                            "training_group_assign_document_people",
                            {
                              inputScalars: {
                                p_target_id: targetId,
                                p_group_target: uiGroupTarget,
                                p_group_audience_id: uiGroupAudienceId,
                                ...(hasGroupAssignByJob
                                  ? { p_group_job_profile: uiGroupJobProfile }
                                  : {}),
                                p_group_person_type: uiGroupPersonType,
                                p_group_language: uiGroupLanguage,
                              },
                              outputTables: {
                                group_assign_people: "group_assign_people",
                              },
                            },
                          );
                          s.if(
                            sql`not exists (select 1 from group_assign_people)`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`No eligible people match that group. They may already have an open assignment or lack an active version in the selected language.`,
                              );
                              s.return();
                            },
                          );
                        } else {
                          s.callStoredProcedure(
                            "training_group_assign_course_people",
                            {
                              inputScalars: {
                                p_target_id: targetId,
                                p_group_target: uiGroupTarget,
                                p_group_audience_id: uiGroupAudienceId,
                                ...(hasGroupAssignByJob
                                  ? { p_group_job_profile: uiGroupJobProfile }
                                  : {}),
                                p_group_person_type: uiGroupPersonType,
                                p_group_language: uiGroupLanguage,
                              },
                              outputTables: {
                                group_assign_people: "group_assign_people",
                              },
                            },
                          );
                          s.if(
                            sql`not exists (select 1 from group_assign_people)`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`No eligible people match that group. They may already have this course/program based on the duplicate assignment policy.`,
                              );
                              s.return();
                            },
                          );
                          s.if(
                            sql`trim(${uiReason}) = ''
                              and exists (
                                select 1
                                from group_assign_people
                                where prior_course_assignments > 0
                              )`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`At least one matching person has received this course/program before. Enter an assignment reason before assigning the group.`,
                              );
                              s.return();
                            },
                          );
                          s.defTable(
                            "group_course_languages",
                            sql`select distinct ${
                              assignmentLanguageSql(block.opts, sql`language`)
                            } as language from group_assign_people`,
                          );
                          s.defScalar("group_missing_course_versions", sql`0`);
                          s.defScalar("group_course_task_count", sql`1`);
                          s.defScalar(
                            "group_language_count",
                            sql`(select count(*) from group_course_languages)`,
                          );
                          s.defScalar("group_language_index", sql`0`);
                          s.while(
                            sql`group_language_index < group_language_count`,
                            (s) => {
                              s.defRecord(
                                "group_language",
                                sql`select language from group_course_languages order by language limit 1 offset group_language_index`,
                              );
                              s.callStoredProcedure(
                                "training_course_missing_version_count",
                                {
                                  inputScalars: {
                                    p_course_id: targetId,
                                    p_language: sql`group_language.language`,
                                  },
                                  outputScalars: {
                                    p_count: "language_missing_versions",
                                  },
                                },
                              );
                              s.callStoredProcedure(
                                "training_course_assignable_item_count",
                                {
                                  inputScalars: {
                                    p_course_id: targetId,
                                    p_language: sql`group_language.language`,
                                  },
                                  outputScalars: {
                                    p_count: "language_task_count",
                                  },
                                },
                              );
                              s.setScalar(
                                "group_missing_course_versions",
                                sql`greatest(group_missing_course_versions, language_missing_versions)`,
                              );
                              s.setScalar(
                                "group_course_task_count",
                                sql`least(group_course_task_count, language_task_count)`,
                              );
                              s.increment("group_language_index");
                            },
                          );
                          s.if(
                            sql`group_missing_course_versions > 0`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`Every course item needs an active published version in each matching language or the default language before group assignment.`,
                              );
                              s.return();
                            },
                          );
                          s.if(
                            sql`group_course_task_count = 0`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`Add at least one assignable training item before assigning this course/program.`,
                              );
                              s.return();
                            },
                          );
                        }
                        s.defScalar(
                          "group_assignment_count",
                          sql`(select count(*) from group_assign_people)`,
                        );
                        s.startTransaction();
                        // Index-driven loop instead of a table cursor: the
                        // loop body suspends into a stored procedure call,
                        // which breaks resumable cursors in this loop.
                        s.defScalar("group_assign_index", sql`0`);
                        s.while(
                          sql`group_assign_index < group_assignment_count`,
                          (s) => {
                            s.defRecord(
                              "group_person",
                              sql`select id
                                  from group_assign_people
                                  order by id
                                  limit 1 offset group_assign_index`,
                            );
                            s.callStoredProcedure(
                              isDoc
                                ? "training_assign_document"
                                : "training_assign_course",
                              {
                                inputScalars: isDoc
                                  ? {
                                    p_person_id: sql`group_person.id`,
                                    p_document_id: targetId,
                                    p_language: sql`nullif(
                                      ${uiGroupLanguage},
                                      ''
                                    )`,
                                    p_due_date: uiDueDate,
                                    p_reason: sql`coalesce(
                                      nullif(trim(${uiReason}), ''),
                                      'Manual group document assignment'
                                    )`,
                                    p_source: sql.lit`manual_group`,
                                    p_notify: uiNotify,
                                  }
                                  : {
                                    p_person_id: sql`group_person.id`,
                                    p_course_id: targetId,
                                    p_language: sql`nullif(
                                      ${uiGroupLanguage},
                                      ''
                                    )`,
                                    p_due_date: uiDueDate,
                                    p_reason: sql`coalesce(
                                      nullif(trim(${uiReason}), ''),
                                      'Manual group course assignment'
                                    )`,
                                    p_source: sql.lit`manual_group`,
                                    p_notify: uiNotify,
                                  },
                                outputScalars: {
                                  assigned_training_assignment_id:
                                    "assigned_training_assignment_id",
                                },
                              },
                            );
                            s.setScalar(
                              "group_assign_index",
                              sql`group_assign_index + 1`,
                            );
                          },
                        );
                        s.commitTransaction();
                        s.setScalar(
                          uiMessage,
                          isDoc
                            ? sql`'Document assigned to ' || group_assignment_count::string || ' people.'`
                            : sql`'Assigned training ' || ${programOrCourse} || ' to ' || group_assignment_count::string || ' people.'`,
                        );
                        s.setScalar(`ui.${p}_reason`, sql.lit``);
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          `${p}_error`,
                          sql
                            .lit`Group assignment failed. No training tasks were created.`,
                        );
                      },
                    });
                  }}
                >
                  Assign matching people
                </Button>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-divider bg-white p-3">
              <Typography level="title-md" startIcon="PersonAdd">
                Assign one person
              </Typography>
              {isDoc && (
                <Typography level="body-sm" className="text-neutral-600">
                  Search by employee name or language, then create one direct
                  document assignment.
                </Typography>
              )}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 md:items-end">
                <FormControl>
                  <FormLabel>Employee</FormLabel>
                  <EmployeeAssignmentCombobox
                    block={block}
                    selectedPersonScalar={`${p}_person_id`}
                  />
                </FormControl>
                <Button
                  startIcon="PersonAdd"
                  disabled={sql`${sql.ref(`${p}_person_id`)} is null`}
                  onClick={(s) => {
                    s.setScalar(`${p}_message`, sql`null`);
                    s.setScalar(`${p}_error`, sql`null`);
                    s.tryServer({
                      body: (s) => {
                        block.assertCanAssignTraining(s);
                        if (isDoc) {
                          s.throwErrorUnless(
                            block.opts.content.canReadDocument(
                              targetId,
                              sql`current_user`,
                            ),
                            sql.lit`You cannot assign this document.`,
                          );
                        }
                        s.if(sql`${uiPersonId} is null`, (s) => {
                          s.setScalar(
                            uiError,
                            sql.lit`Choose a person before assigning.`,
                          );
                          s.return();
                        });
                        if (isDoc) {
                          s.defRecord(
                            "employee",
                            sql`select e.id,
                                     ${
                              employeeName(block.opts, sql`e`)
                            } as name,
                                     ${
                              personLanguageSql(block.opts, sql`e`)
                            } as language
                              from db.${sql.ref(personTable(block.opts))} e
                              where e.id = ${uiPersonId}`,
                          );
                          s.if(
                            sql`exists (
                            select 1
                            from db.training_employee_tasks t
                            join db.training_assignments a
                              on a.id = t.training_assignment_id
                            where a.person_id = employee.id
                              and a.document_id = ${targetId}
                              and a.training_course_id is null
                              and t.status not in ('completed', 'waived')
                          )`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql`employee.name || ' already has an open assignment for this document.'`,
                              );
                              s.return();
                            },
                          );
                          s.defScalar("employee_active_version_id", {
                            type: "BigInt",
                          });
                          s.callStoredProcedure(
                            "training_document_active_version_id",
                            {
                              inputScalars: {
                                p_document_id: targetId,
                                p_language: sql`employee.language`,
                              },
                              outputScalars: {
                                p_version_id: "employee_active_version_id",
                              },
                            },
                          );
                          s.if(
                            sql`employee_active_version_id is null`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql
                                  .lit`This person does not have an active published version in their language or the default language.`,
                              );
                              s.return();
                            },
                          );
                          s.startTransaction();
                          s.callStoredProcedure("training_assign_document", {
                            inputScalars: {
                              p_person_id: sql`employee.id`,
                              p_document_id: targetId,
                              p_language: sql`null`,
                              p_due_date: uiDueDate,
                              p_reason: sql`nullif(
                                trim(${uiReason}),
                                ''
                              )`,
                              p_source: sql`null`,
                              p_notify: uiNotify,
                            },
                            outputScalars: {
                              assigned_training_assignment_id:
                                "assigned_training_assignment_id",
                            },
                          });
                          s.commitTransaction();
                          s.setScalar(
                            uiMessage,
                            sql`'Assigned document to ' || employee.name || '.'`,
                          );
                          s.setScalar(`ui.${p}_reason`, sql.lit``);
                          s.setScalar(`ui.${p}_person_id`, sql`null`);
                          s.refetch();
                        } else {
                          s.defRecord(
                            "employee",
                            sql`select e.id,
                                     ${
                              employeeName(block.opts, sql`e`)
                            } as name,
                                     ${
                              personLanguageSql(block.opts, sql`e`)
                            } as language,
                                     (
                                       select count(*)
                                       from db.training_assignments a
                                       where a.person_id = e.id
                                         and a.training_course_id = ${targetId}
                                     ) as prior_course_assignments,
                                     (
                                       select count(*)
                                       from db.training_assignments a
                                       where a.person_id = e.id
                                         and a.training_course_id = ${targetId}
                                         and ${
                              openTrainingAssignmentWhereSql(sql`a`)
                            }
                                     ) as active_course_assignments
                              from db.${sql.ref(personTable(block.opts))} e
                              where e.id = ${uiPersonId}`,
                          );
                          s.if(
                            sql`employee.active_course_assignments > 0`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql`employee.name || ' already has an active assignment for this ' || ${programOrCourse} || '. Complete or waive the existing tasks before assigning it again.'`,
                              );
                              s.return();
                            },
                          );
                          s.if(
                            sql`employee.prior_course_assignments > 0 and trim(${uiReason}) = ''`,
                            (s) => {
                              s.setScalar(
                                uiError,
                                sql`employee.name || ' has received this ' || ${programOrCourse} || ' before. Enter an assignment reason before assigning it again.'`,
                              );
                              s.return();
                            },
                          );
                          s.defScalar("missing_course_versions", {
                            type: "BigInt",
                          });
                          s.callStoredProcedure(
                            "training_course_missing_version_count",
                            {
                              inputScalars: {
                                p_course_id: targetId,
                                p_language: sql`employee.language`,
                              },
                              outputScalars: {
                                p_count: "missing_course_versions",
                              },
                            },
                          );
                          s.if(sql`missing_course_versions > 0`, (s) => {
                            s.setScalar(
                              uiError,
                              sql
                                .lit`Every course item needs an active published version in the employee language or the default language before assignment.`,
                            );
                            s.return();
                          });
                          s.defScalar("course_task_count", {
                            type: "BigInt",
                          });
                          s.callStoredProcedure(
                            "training_course_assignable_item_count",
                            {
                              inputScalars: {
                                p_course_id: targetId,
                                p_language: sql`employee.language`,
                              },
                              outputScalars: { p_count: "course_task_count" },
                            },
                          );
                          s.if(sql`course_task_count = 0`, (s) => {
                            s.setScalar(
                              uiError,
                              sql
                                .lit`Add at least one assignable training item before assignment.`,
                            );
                            s.return();
                          });
                          s.startTransaction();
                          s.callStoredProcedure("training_assign_course", {
                            inputScalars: {
                              p_person_id: sql`employee.id`,
                              p_course_id: targetId,
                              p_language: sql`null`,
                              p_due_date: uiDueDate,
                              p_reason: sql`coalesce(
                                nullif(trim(${uiReason}), ''),
                                case
                                  when selected_course.is_program
                                  then 'Manual program assignment'
                                  else 'Manual course assignment'
                                end
                              )`,
                              p_source: sql`null`,
                              p_notify: uiNotify,
                            },
                            outputScalars: {
                              assigned_training_assignment_id:
                                "assigned_training_assignment_id",
                            },
                          });
                          s.commitTransaction();
                          s.setScalar(`ui.${p}_reason`, sql.lit``);
                          s.setScalar(`ui.${p}_person_id`, sql`null`);
                          s.setScalar(
                            uiMessage,
                            sql`'Assigned training ' || ${programOrCourse} || ' to ' || employee.name || ' and created ' || course_task_count::string || ' training task(s).'`,
                          );
                          s.refetch();
                        }
                      },
                      catch: (s) => {
                        s.setScalar(
                          `${p}_error`,
                          isDoc
                            ? sql
                              .lit`Assignment failed. No training task was created.`
                            : sql
                              .lit`Assignment failed. No training tasks were created.`,
                        );
                      },
                    });
                  }}
                >
                  Assign person
                </Button>
              </div>
            </div>
          </Show>
          <Show when={sql`${mode} = 'ongoing'`}>
            <div className="rounded-md border border-divider bg-neutral-50 p-3">
              <Typography level="title-md" startIcon="Autorenew">
                {isDoc ? "New ongoing rule" : "New ongoing assignment rule"}
              </Typography>
              {isDoc && (
                <Typography level="body-sm" className="text-neutral-600">
                  Matching people are assigned immediately. Daily reconciliation
                  adds future matches and handles renewals; publication applies
                  new revisions immediately.
                </Typography>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <FormControl>
                  <FormLabel>Audience</FormLabel>
                  <AudienceMultiSelect
                    selectedIdsScalar={`${rp}_audience_ids`}
                    availableItemsQuery={sql`select id, name, description
                      from db.training_audiences
                      where is_active
                      order by name`}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Language</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql.ref(`${rp}_language`)}
                    onInput={(s) =>
                      s.setScalar(`${rp}_language`, sql`target_value`)}
                  >
                    <Select.Option value="">Employee language</Select.Option>
                    <Each table={`${g}_languages`} recordName="language">
                      <Select.Option value={sql`language.code`}>
                        {sql`language.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Renew every days</FormLabel>
                  <Input
                    type="number"
                    bindScalar={`${rp}_renewal_interval_days`}
                    placeholder="Optional — empty means no renewal"
                  />
                </FormControl>
              </div>
              <div className="mt-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <Typography level="body-sm" className="text-neutral-600">
                  {isDoc
                    ? "Takes effect immediately for everyone who currently matches."
                    : "Takes effect on the next scheduled assignment run."}
                </Typography>
                <Button
                  startIcon="Save"
                  onClick={(s) => {
                    s.setScalar(`${p}_message`, sql`null`);
                    s.setScalar(`${p}_error`, sql`null`);
                    s.tryServer({
                      body: (s) => {
                        s.if(
                          sql`exists (
                            select 1
                            from db.training_requirements r
                            where r.${ruleColumn} = ${targetId}
                              and r.is_active
                              and (
                                (nullif(${uiRuleAudienceIds}, '') is null
                                 and not exists (
                                   select 1
                                   from db.training_requirement_audiences ra
                                   where ra.training_requirement_id = r.id
                                 ))
                                or exists (
                                  select 1
                                  from string.split(${uiRuleAudienceIds}, ',') selected
                                  where selected.value != ''
                                    and exists (
                                      select 1
                                      from db.training_requirement_audiences ra
                                      where ra.training_requirement_id = r.id
                                        and ra.training_audience_id = selected.value::bigint
                                    )
                                )
                              )
                              and (
                                (nullif(${uiRuleLanguage}, '') is null
                                 and r.training_language is null)
                                or r.training_language =
                                  nullif(${uiRuleLanguage}, '')
                              )
                          )`,
                          (s) => {
                            s.setScalar(
                              uiError,
                              isDoc
                                ? sql
                                  .lit`That audience and language already have an active rule for this document.`
                                : sql
                                  .lit`That audience and language already have an active rule for this course/program.`,
                            );
                            s.return();
                          },
                        );
                        s.startTransaction();
                        block.assertCanAssignTraining(s);
                        if (isDoc) {
                          s.throwErrorUnless(
                            block.opts.content.canReadDocument(
                              targetId,
                              sql`current_user`,
                            ),
                            sql.lit`You cannot assign this document.`,
                          );
                        }
                        s.modify(sql`
                          insert into db.training_requirements
                            (name, description,
                             ${ruleColumn},
                             training_language,
                             renewal_interval_days)
                          values
                            (
                              ${targetRecord}.${
                          isDoc ? sql`title` : sql`name`
                        } || ' · ' || coalesce(
                                (
                                  select string_agg(a.name, ', ' order by a.name)
                                  from db.training_audiences a
                                  join string.split(${uiRuleAudienceIds}, ',') selected
                                    on selected.value != ''
                                   and selected.value::bigint = a.id
                                ),
                                'All people'
                              ),
                              ${
                          isDoc
                            ? sql.lit`Training document audience requirement`
                            : sql.lit`Training course audience requirement`
                        },
                              ${targetId},
                              nullif(${uiRuleLanguage}, ''),
                              nullif(trim(${uiRuleRenewal}), '')::uint
                            )
                          returning id into new_requirement_id
                        `);
                        s.modify(sql`
                          insert into db.training_requirement_audiences
                            (training_requirement_id, training_audience_id)
                          select new_requirement_id, selected.value::bigint
                          from string.split(${uiRuleAudienceIds}, ',') selected
                          where selected.value != ''
                        `);
                        if (isDoc) {
                          block.syncAutomaticAssignmentsForDocument(
                            s,
                            targetId,
                          );
                        }
                        s.commitTransaction();
                        s.setScalar(`ui.${rp}_audience_ids`, sql.lit``);
                        s.setScalar(`ui.${rp}_language`, sql.lit``);
                        s.setScalar(
                          `ui.${rp}_renewal_interval_days`,
                          sql.lit``,
                        );
                        s.setScalar(
                          uiMessage,
                          isDoc
                            ? sql
                              .lit`Ongoing rule created. Matching people were assigned immediately.`
                            : sql
                              .lit`Ongoing rule created. Matching people are assigned on the next scheduled run.`,
                        );
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          `${p}_error`,
                          isDoc
                            ? sql
                              .lit`The ongoing rule could not be created.`
                            : sql
                              .lit`The ongoing assignment rule could not be created.`,
                        );
                      },
                    });
                  }}
                >
                  {isDoc
                    ? "Create ongoing rule"
                    : "Create ongoing assignment rule"}
                </Button>
              </div>
            </div>
            <Typography level="title-md" className="mt-6 mb-2">
              {isDoc ? "Active rules" : "Ongoing assignment rules"}
            </Typography>
            <div className="flex flex-col gap-2">
              <Show when={sql`not exists (select 1 from assignment_rules)`}>
                <EmptyState
                  icon="Autorenew"
                  title={isDoc
                    ? "No ongoing rules yet"
                    : "No ongoing assignment rules yet"}
                  body={isDoc
                    ? "Create a rule above to keep the right people assigned to this document automatically."
                    : sql`'Create a rule above to keep the right people assigned to this ' || ${programOrCourse} || ' automatically.'`}
                />
              </Show>
              <Each table="assignment_rules" recordName="rule">
                <div className="p-3 border border-divider rounded-md bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="min-w-0">
                    <Typography level="title-sm">
                      {sql`rule.audience_name`}
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      {sql`rule.language_name || ' · Due in ' ||
                        rule.due_within_days::string ||
                        case when rule.due_within_days = 1 then ' day' else ' days' end ||
                        case
                          when rule.renewal_interval_days is null then ' · No renewal'
                          else ' · Renews every ' || rule.renewal_interval_days::string || ' days'
                        end`}
                    </Typography>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Chip size="sm" variant="soft" color="primary">
                      Auto assign
                    </Chip>
                    <IconButton
                      icon="RemoveCircleOutline"
                      aria-label={isDoc
                        ? "Remove ongoing rule"
                        : "Remove ongoing assignment rule"}
                      variant="plain"
                      color="danger"
                      onClick={(s) => {
                        s.setScalar(`${p}_message`, sql`null`);
                        s.setScalar(`${p}_error`, sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            block.assertCanAssignTraining(s);
                            if (isDoc) {
                              s.throwErrorUnless(
                                block.opts.content.canReadDocument(
                                  targetId,
                                  sql`current_user`,
                                ),
                                sql.lit`You cannot assign this document.`,
                              );
                            }
                            s.modify(sql`
                              update db.training_requirements
                              set is_active = false
                              where id = rule.id
                                and ${ruleColumn} = ${targetId}
                            `);
                            s.commitTransaction();
                            s.setScalar(
                              uiMessage,
                              sql
                                .lit`Ongoing rule removed. Existing assignments are not affected.`,
                            );
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              `${p}_error`,
                              sql.lit`The rule could not be removed.`,
                            );
                          },
                        });
                      }}
                    />
                  </div>
                </div>
              </Each>
            </div>
          </Show>
          {props.children}
        </CardContent>
      </Card>
    </Data>
  );
}

function groupMatchConditionSql(opts: TrainingBlockOpts) {
  const hasGroupAssignByJob =
    opts.workforce.personPrimaryJobProfileId !== undefined;
  return sql`(
    p_group_target = 'all'
    or (
      p_group_target = 'audience'
      and p_group_audience_id != ''
      and exists (
        select 1
        from db.training_audiences a
        where a.id = nullif(p_group_audience_id, '')::bigint
          and a.is_active
          and ${audienceMatchesEmployeeSql(opts, sql`a`, sql`e`)}
      )
    )
    ${
    hasGroupAssignByJob
      ? sql`or (
      p_group_target = 'job'
      and p_group_job_profile != ''
      and lower(${personPrimaryJobProfileSql(opts, sql`e`)}) =
        lower(p_group_job_profile)
    )`
      : sql``
  }
    or (
      p_group_target = 'role'
      and p_group_person_type != ''
      and lower(${personTypeSql(opts, sql`e`)}) =
        lower(p_group_person_type)
    )
  )`;
}

/**
 * The assignment workspace's matching and readiness queries. Every route
 * that renders the workspace compiles its click handlers, so these stored
 * procedures keep the queries out of every route.
 */
export function registerAssignmentWorkspaceStoredProcedures(
  opts: TrainingBlockOpts,
) {
  const groupInputScalars: HelperProcField[] = [
    { name: "p_target_id", type: "BigInt" },
    { name: "p_group_target", type: "String" },
    { name: "p_group_audience_id", type: "String" },
    ...(opts.workforce.personPrimaryJobProfileId !== undefined
      ? [{ name: "p_group_job_profile", type: "String" } as const]
      : []),
    { name: "p_group_person_type", type: "String" },
    { name: "p_group_language", type: "String" },
  ];
  const groupMatchCondition = groupMatchConditionSql(opts);
  system.storedProcedure({
    name: "training_group_assign_document_people",
    transaction: "caller",
    inputScalars: groupInputScalars,
    outputTables: [
      {
        name: "group_assign_people",
        fields: [
          { name: "id", type: "BigInt", notNull: true },
          {
            name: "name",
            type: { type: "String", maxLength: 400 },
          },
          {
            name: "language",
            type: { type: "String", maxLength: 30 },
          },
          { name: "active_version_id", type: "BigInt" },
        ],
      },
    ],
    procedure: (s) => {
      s.modify(sql`
                            insert into group_assign_people
                              (id, name, language, active_version_id)
                            select id, name, language, active_version_id
                              from (
                                select e.id,
                                       ${employeeName(opts, sql`e`)} as name,
                                       coalesce(nullif(p_group_language, ''), ${
        personLanguageSql(opts, sql`e`)
      }) as language,
                                       ${
        activeVersionIdSql(
          sql`p_target_id`,
          sql`coalesce(nullif(p_group_language, ''), ${
            personLanguageSql(opts, sql`e`)
          })`,
          opts,
        )
      } as active_version_id
                                from db.${sql.ref(personTable(opts))} e
                                where ${groupMatchCondition}
                              ) group_person_source
                              where active_version_id is not null
                                and not exists (
                                  select 1
                                  from db.training_employee_tasks t
                                  join db.training_assignments a
                                    on a.id = t.training_assignment_id
                                  where a.person_id = group_person_source.id
                                    and a.document_id = p_target_id
                                    and a.training_course_id is null
                                    and t.status not in ('completed', 'waived')
                                )
                              order by name
                          `);
    },
  });
  system.storedProcedure({
    name: "training_group_assign_course_people",
    transaction: "caller",
    inputScalars: groupInputScalars,
    outputTables: [
      {
        name: "group_assign_people",
        fields: [
          { name: "id", type: "BigInt", notNull: true },
          {
            name: "name",
            type: { type: "String", maxLength: 400 },
          },
          {
            name: "language",
            type: { type: "String", maxLength: 30 },
          },
          {
            name: "prior_course_assignments",
            type: "BigInt",
            notNull: true,
          },
          {
            name: "active_course_assignments",
            type: "BigInt",
            notNull: true,
          },
        ],
      },
    ],
    procedure: (s) => {
      s.modify(sql`
                            insert into group_assign_people
                              (id, name, language, prior_course_assignments,
                               active_course_assignments)
                            select id, name, language,
                                   prior_course_assignments,
                                   active_course_assignments
                              from (
                                select e.id, ${
        employeeName(opts, sql`e`)
      } as name,
                                  coalesce(nullif(p_group_language, ''), ${
        personLanguageSql(opts, sql`e`)
      }) as language,
                                  (
                                    select count(*)
                                    from db.training_assignments a
                                    where a.person_id = e.id
                                      and a.training_course_id = p_target_id
                                  ) as prior_course_assignments,
                                  (
                                    select count(*)
                                    from db.training_assignments a
                                    where a.person_id = e.id
                                      and a.training_course_id = p_target_id
                                      and ${
        openTrainingAssignmentWhereSql(sql`a`)
      }
                                  ) as active_course_assignments
                                from db.${sql.ref(personTable(opts))} e
                                where ${groupMatchCondition}
                              ) group_person_source
                              where active_course_assignments = 0
                              order by name
                          `);
    },
  });
  system.storedProcedure({
    name: "training_course_missing_version_count",
    transaction: "caller",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }, {
      name: "p_language",
      type: "String",
    }],
    outputScalars: [{ name: "p_count", type: "BigInt" }],
    procedure: (s) => {
      s.setScalar(
        "p_count",
        missingActiveVersionCountSql(
          sql`p_course_id`,
          assignmentLanguageSql(opts, sql`p_language`),
        ),
      );
    },
  });
  system.storedProcedure({
    name: "training_course_assignable_item_count",
    transaction: "caller",
    inputScalars: [{ name: "p_course_id", type: "BigInt" }, {
      name: "p_language",
      type: "String",
    }],
    outputScalars: [{ name: "p_count", type: "BigInt" }],
    procedure: (s) => {
      s.setScalar(
        "p_count",
        assignableCourseItemCountSql(
          sql`p_course_id`,
          assignmentLanguageSql(opts, sql`p_language`),
        ),
      );
    },
  });
  system.storedProcedure({
    name: "training_document_active_version_id",
    transaction: "caller",
    inputScalars: [
      { name: "p_document_id", type: "BigInt" },
      { name: "p_language", type: "String" },
    ],
    outputScalars: [{ name: "p_version_id", type: "BigInt" }],
    procedure: (s) => {
      s.setScalar(
        "p_version_id",
        activeVersionIdSql(sql`p_document_id`, sql`p_language`, opts),
      );
    },
  });
}
