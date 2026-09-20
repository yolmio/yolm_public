import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { QueryCombobox } from "components/query_combobox";
import { Select } from "components/select";
import { Sheet } from "components/sheet";
import { TableRecordSelect } from "components/table_record_select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { system } from "std/system";
import { Form } from "std/form";
import { type Sql, sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { Each, Show, useUniqueId } from "std/ui";
import { currentUserHasPermission } from "blocks/auth";
import type { TrainingBlock } from "../index.tsx";
import {
  activeCourseVersionSql,
  cancelOpenAssessmentAttemptsForCourseAssignmentsSql,
  currentEmployeeId,
  insertCourseSectionFromTemplateSql,
  insertCourseSectionItemDocumentsFromTemplateSql,
  insertCourseSectionItemsFromTemplateSql,
  insertCurrentCourseAssignmentTasksSql,
  insertTaskItemDocumentSnapshotsSql,
  replaceOpenCourseAssignmentTasksSql,
  setCurrentCourseVersionSql,
  trainingFeatureEnabled,
  trainingPermissions,
} from "../helpers";
import { EmptyState } from "../shared";
import {
  adminCourseAssignHref,
  adminCoursesHref,
  adminSelectClass,
  LabeledFormField,
  TrainingAdminFrame,
} from "./shared";

function draftCourseVersionSql(courseId: Sql) {
  return sql`(
    select v.id
    from db.training_course_versions v
    where v.training_course_id = ${courseId}
      and v.status = 'draft'
    order by v.created_at desc, v.id desc
    limit 1
  )`;
}

function editorCourseVersionSql(courseId: Sql) {
  return sql`coalesce(
    ${draftCourseVersionSql(courseId)},
    ${activeCourseVersionSql(courseId)}
  )`;
}

/**
 * Ensures the course has an open draft version via the
 * `training_ensure_course_draft` stored procedure, which atomically returns
 * the existing draft or clones the published version into a new one.
 * Declares `draft_course_version_id` and `source_course_version_id` in the
 * current scope.
 */
function ensureCourseDraftVersion(
  s: UiServerStatements,
  args: { block: TrainingBlock; courseId: Sql },
) {
  s.callStoredProcedure("training_ensure_course_draft", {
    inputScalars: { p_course_id: args.courseId },
    outputScalars: {
      draft_course_version_id: "draft_course_version_id",
      source_course_version_id: "source_course_version_id",
    },
  });
}

/**
 * Maps a section shown in the editor (possibly from the published version
 * the draft was cloned from) to its row in the draft version via the stable
 * clone key. Run after ensureCourseDraftVersion. Rows created before
 * `source_section_id` existed have null keys and simply match nothing.
 */
function mapCourseSectionToDraftSql(sectionId: Sql) {
  return sql`coalesce(
    (
      select current_section.id
      from db.training_course_sections current_section
      where current_section.id = ${sectionId}
        and current_section.training_course_version_id =
          draft_course_version_id
    ),
    (
      select new_section.id
      from db.training_course_sections new_section
      where new_section.training_course_version_id =
          draft_course_version_id
        and new_section.source_section_id = ${sectionId}
      limit 1
    )
  )`;
}

/** Same mapping for items. Run after ensureCourseDraftVersion. */
function mapCourseItemToDraftSql(itemId: Sql) {
  return sql`coalesce(
    (
      select current_item.id
      from db.training_course_section_items current_item
      join db.training_course_sections current_section
        on current_section.id = current_item.training_course_section_id
      where current_item.id = ${itemId}
        and current_section.training_course_version_id =
          draft_course_version_id
    ),
    (
      select new_item.id
      from db.training_course_section_items new_item
      join db.training_course_sections new_section
        on new_section.id = new_item.training_course_section_id
      where new_section.training_course_version_id =
          draft_course_version_id
        and new_item.source_item_id = ${itemId}
      limit 1
    )
  )`;
}

/**
 * The draft section next to `target_new_course_section_id` in the draft's
 * (ordinal, id) ordering, or null at the edge.
 */
function adjacentDraftSectionSql(direction: "up" | "down") {
  const beforeWhere = direction === "up"
    ? sql`other_section.ordinal < target_section.ordinal
        or (
          other_section.ordinal = target_section.ordinal
          and other_section.id < target_section.id
        )`
    : sql`other_section.ordinal > target_section.ordinal
        or (
          other_section.ordinal = target_section.ordinal
          and other_section.id > target_section.id
        )`;
  const order = direction === "up"
    ? sql`other_section.ordinal desc, other_section.id desc`
    : sql`other_section.ordinal, other_section.id`;
  return sql`(
    select other_section.id
    from db.training_course_sections other_section
    join db.training_course_sections target_section
      on target_section.id = target_new_course_section_id
    where other_section.training_course_version_id = draft_course_version_id
      and (${beforeWhere})
    order by ${order}
    limit 1
  )`;
}

/**
 * The draft item next to `target_new_course_item_id` in the draft's
 * (section ordinal, sort_order, id) ordering, or null at the edge.
 */
function adjacentDraftItemSql(direction: "up" | "down") {
  const beforeWhere = direction === "up"
    ? sql`other_section.ordinal < target_section.ordinal
        or (
          other_section.ordinal = target_section.ordinal
          and (
            other_item.sort_order < target_item.sort_order
            or (
              other_item.sort_order = target_item.sort_order
              and other_item.id < target_item.id
            )
          )
        )`
    : sql`other_section.ordinal > target_section.ordinal
        or (
          other_section.ordinal = target_section.ordinal
          and (
            other_item.sort_order > target_item.sort_order
            or (
              other_item.sort_order = target_item.sort_order
              and other_item.id > target_item.id
            )
          )
        )`;
  const order = direction === "up"
    ? sql`other_section.ordinal desc, other_item.sort_order desc,
        other_item.id desc`
    : sql`other_section.ordinal, other_item.sort_order, other_item.id`;
  return sql`(
    select other_item.id
    from db.training_course_section_items other_item
    join db.training_course_sections other_section
      on other_section.id = other_item.training_course_section_id
    join db.training_course_section_items target_item
      on target_item.id = target_new_course_item_id
    join db.training_course_sections target_section
      on target_section.id = target_item.training_course_section_id
    where other_section.training_course_version_id = draft_course_version_id
      and (${beforeWhere})
    order by ${order}
    limit 1
  )`;
}

function MoveCourseSectionButton(
  props: { courseId: Sql; direction: "up" | "down" },
) {
  const beforeWhere = props.direction === "up"
    ? sql`other.ordinal < section.ordinal
        or (other.ordinal = section.ordinal and other.id < section.id)`
    : sql`other.ordinal > section.ordinal
        or (other.ordinal = section.ordinal and other.id > section.id)`;
  return (
    <Show
      when={sql`exists (
        select 1
        from course_sections other
        where ${beforeWhere}
      )`}
    >
      <IconButton
        icon={props.direction === "up"
          ? "KeyboardArrowUp"
          : "KeyboardArrowDown"}
        aria-label={props.direction === "up"
          ? "Move section up"
          : "Move section down"}
        tooltip={props.direction === "up"
          ? "Move section up"
          : "Move section down"}
        variant="plain"
        color="neutral"
        onClick={(s) => {
          s.event.stopPropagation();
          s.setScalar("course_edit_error", sql`null`);
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.callStoredProcedure("training_move_course_section", {
                inputScalars: {
                  p_course_id: props.courseId,
                  p_record_id: sql`section.id`,
                  p_move_up: sql`${props.direction === "up"}`,
                },
              });
              s.commitTransaction();
              s.setScalar("add_step_section_id", sql.lit``);
              s.refetch();
            },
          });
        }}
      />
    </Show>
  );
}

function RemoveCourseSectionButton(
  props: { block: TrainingBlock; courseId: Sql },
) {
  return (
    <IconButton
      icon="RemoveCircleOutline"
      aria-label="Remove section"
      tooltip="Remove section"
      variant="plain"
      color="danger"
      onClick={(s) => {
        s.event.stopPropagation();
        s.setScalar("course_edit_error", sql`null`);
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            ensureCourseDraftVersion(s, {
              block: props.block,
              courseId: props.courseId,
            });
            s.defScalar(
              "target_new_course_section_id",
              mapCourseSectionToDraftSql(sql`section.id`),
            );
            s.modify(sql`
              delete from db.training_course_section_item_documents
              where training_course_section_item_id in (
                select item.id
                from db.training_course_section_items item
                where item.training_course_section_id =
                  target_new_course_section_id
              )
            `);
            s.modify(sql`
              delete from db.training_course_section_items
              where training_course_section_id = target_new_course_section_id
            `);
            s.modify(sql`
              delete from db.training_course_sections
              where id = target_new_course_section_id
            `);
            s.commitTransaction();
            s.setScalar("add_step_section_id", sql.lit``);
            s.refetch();
          },
          catch: (s) => {
            s.setScalar(
              "course_edit_error",
              sql.lit`Section could not be removed from this course.`,
            );
          },
        });
      }}
    />
  );
}

export function TrainingAdminCoursePage(props: { block: TrainingBlock }) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("course_edit_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("course_settings_open", false);
        s.defScalar("add_course_item_section_template_id", sql.lit``);
        s.defScalar("add_course_section_name", sql.lit``);
        s.defScalar("add_course_section_description", sql.lit``);
        s.defScalar("add_step_section_id", sql.lit``);
        s.defScalar("edit_course_section_id", sql.lit``);
        s.defScalar("edit_course_section_name", sql.lit``);
        s.defScalar("edit_course_section_description", sql.lit``);
        s.defScalar("add_step_mode", sql.lit`section`);
        s.defScalar("add_step_content", sql.lit``);
        s.defScalar("add_step_type", sql.lit`practical`);
        s.defScalar("add_step_requires_essay", sql`false`);
        s.defScalar("add_step_essay_prompt", sql.lit``);
        s.defScalar("add_step_support_document_id", { type: "BigInt" });
        s.defScalar("add_step_assessment_id", { type: "BigInt" });
        s.defScalar(
          "can_publish_training_courses",
          currentUserHasPermission(
            sql.lit(trainingPermissions.publishTraining),
          ),
        );
        s.defScalar(
          "can_assign_training_courses",
          currentUserHasPermission(
            sql.lit(trainingPermissions.assignTraining),
          ),
        );
      }}
    >
      <TrainingAdminFrame>
        <CourseEditorWorkspace block={props.block} courseId={sql`course_id`} />
      </TrainingAdminFrame>
    </Data>
  );
}

export function CourseEditorWorkspace(
  props: { block: TrainingBlock; courseId: Sql },
) {
  const courseId = props.courseId;
  const settingsButtonId = useUniqueId();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button
          component="a"
          href={adminCoursesHref(props.block)}
          variant="plain"
          color="neutral"
          startIcon="ArrowBack"
        >
          Back to courses & programs
        </Button>
      </div>
      <Data
        procedure={(s) => {
          s.defRecord(
            "selected_course",
            sql`select c.id, c.name, c.description,
                       c.due_within_days, c.reminder_after_days,
                       c.reminder_repeat_every_days, c.overdue_after_days,
                       c.overdue_repeat_every_days,
                       c.current_training_course_version_id,
                       ${draftCourseVersionSql(courseId)}
                         as draft_training_course_version_id,
                       ${editorCourseVersionSql(courseId)}
                         as editor_training_course_version_id,
                       c.is_active,
                       exists (
                         select 1
                         from db.training_course_section_items i
                         join db.training_course_sections section
                           on section.id = i.training_course_section_id
                         where section.training_course_version_id =
                             ${editorCourseVersionSql(courseId)}
                           and i.type = 'other_checklist'
                       ) as is_program
                from db.training_courses c
                where c.id = ${courseId}`,
          );
          s.defTable(
            "course_sections",
            sql`select section.id, section.name, section.description,
                       section.ordinal,
                       (
                         select count(*)
                         from db.training_course_section_items i
                         where i.training_course_section_id = section.id
                       ) as item_count
                from db.training_course_sections section
                where section.training_course_version_id = ${
              editorCourseVersionSql(courseId)
            }
                order by section.ordinal, section.id`,
          );
          s.defTable(
            "course_items",
            sql`select i.id, i.content, i.sort_order, i.requires_essay,
                    coalesce(nested_course.name, item_assessment.name,
                      i.external_title, i.content) as title,
                    section.id as section_id,
                    section.name as section_name,
                    section.description as section_description,
                    section.ordinal as section_ordinal,
                    case
                      when i.type = 'external_link' then 'External link'
                      when i.type = 'essay' then 'Essay'
                      when i.type = 'other_checklist' then 'Nested course'
                      when i.type = 'signature' then 'Signature'
                      when i.type = 'assessment' then 'Assessment'
                      else 'Practical'
                    end as kind,
                    i.type,
                    exists (
                      select 1
                      from db.training_employee_tasks t
                      where t.training_course_section_item_id = i.id
                    ) as has_assigned_tasks
                 from db.training_course_section_items i
                 join db.training_course_sections section
                   on section.id = i.training_course_section_id
                 left join db.training_courses nested_course
                   on nested_course.id = i.other_course_id
                 left join db.training_assessments item_assessment
                   on item_assessment.id = i.training_assessment_id
                 where section.training_course_version_id = ${
              editorCourseVersionSql(courseId)
            }
                 order by section.ordinal, i.sort_order, i.id`,
          );
          s.defTable(
            "course_item_documents",
            sql`select item_doc.id,
                       item_doc.training_course_section_item_id,
                       item_doc.document_id,
                       coalesce(item_doc.label, d.title) as title,
                       case (
                         select version.content_mode::string
                         from db.training_content_language_variants variant
                         join db.training_content_versions version
                           on version.id = variant.current_document_version_id
                          and version.document_language_variant_id = variant.id
                         where variant.document_id = d.id
                         order by case when variant.language = ${
              sql.lit(
                props.block.opts.content.opts.defaultLanguage,
              )
            } then 0 else 1 end
                         limit 1
                       )
                         when 'external_link' then 'External link'
                         when 'native_yolm' then 'Document'
                         when 'pdf_attachment' then 'PDF attachment'
                         else 'Document'
                       end as kind
                from db.training_course_section_item_documents item_doc
                join db.training_content_documents d
                  on d.id = item_doc.document_id
                where item_doc.training_course_section_item_id in (
                  select i.id
                  from db.training_course_section_items i
                  join db.training_course_sections section
                    on section.id = i.training_course_section_id
                  where section.training_course_version_id = ${
              editorCourseVersionSql(courseId)
            }
                )
                order by item_doc.training_course_section_item_id,
                         item_doc.sort_order, item_doc.id`,
          );
          s.defTable(
            "course_section_templates",
            sql`select id, name
                from db.training_course_section_templates
                where is_active
                order by name`,
          );
        }}
      >
        <div className="flex flex-col gap-5">
          <Card variant="outlined">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                <div className="min-w-0">
                  <Typography level="title-lg">
                    {sql`case when selected_course.is_program then 'Training Program: ' else 'Training Course: ' end || selected_course.name`}
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    {sql`case
                      when selected_course.is_program
                      then 'Add the courses and training items people must complete when this program is assigned.'
                      else 'Add the controlled documents and training items people must complete when this course is assigned.'
                    end`}
                  </Typography>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:shrink-0">
                  <Show
                    when={sql`selected_course.draft_training_course_version_id is not null`}
                  >
                    <Button
                      variant="outlined"
                      color="neutral"
                      startIcon="Delete"
                      onClick={(s) => {
                        s.setScalar("course_edit_error", sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.defScalar(
                              "draft_course_version_id",
                              draftCourseVersionSql(courseId),
                            );
                            s.if(
                              sql`draft_course_version_id is null`,
                              (s) => s.return(),
                            );
                            s.startTransaction();
                            s.modify(sql`
                              delete from db.training_course_section_item_documents
                              where training_course_section_item_id in (
                                select item.id
                                from db.training_course_section_items item
                                join db.training_course_sections section
                                  on section.id = item.training_course_section_id
                                where section.training_course_version_id =
                                    draft_course_version_id
                              )
                            `);
                            s.modify(sql`
                              delete from db.training_course_section_items
                              where training_course_section_id in (
                                select section.id
                                from db.training_course_sections section
                                where section.training_course_version_id =
                                  draft_course_version_id
                              )
                            `);
                            s.modify(sql`
                              delete from db.training_course_sections
                              where training_course_version_id =
                                draft_course_version_id
                            `);
                            s.modify(sql`
                              delete from db.training_course_versions
                              where id = draft_course_version_id
                                and status = 'draft'
                            `);
                            s.commitTransaction();
                            s.setScalar("add_step_section_id", sql.lit``);
                            s.setScalar("edit_course_section_id", sql.lit``);
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              "course_edit_error",
                              sql.lit`Draft changes could not be discarded.`,
                            );
                          },
                        });
                      }}
                    >
                      Discard draft
                    </Button>
                    <Show when={sql`can_publish_training_courses`}>
                      <Button
                        startIcon="Publish"
                        onClick={(s) => {
                          s.setScalar("course_edit_error", sql`null`);
                          s.tryServer({
                            body: (s) => {
                              s.if(
                                sql`not ${
                                  currentUserHasPermission(
                                    sql.lit(
                                      trainingPermissions
                                        .publishTraining,
                                    ),
                                  )
                                }`,
                                (s) => {
                                  s.throwError(
                                    "You do not have permission to publish training.",
                                  );
                                },
                              );
                              s.defScalar(
                                "draft_course_version_id",
                                draftCourseVersionSql(courseId),
                              );
                              s.defScalar(
                                "published_course_version_id",
                                activeCourseVersionSql(courseId),
                              );
                              s.if(
                                sql`draft_course_version_id is null`,
                                (s) => s.return(),
                              );
                              s.startTransaction();
                              s.modify(sql`
                              update db.training_course_versions
                              set status = 'archived',
                                  archived_at = coalesce(archived_at, now())
                              where id = published_course_version_id
                            `);
                              s.modify(sql`
                              update db.training_course_versions
                              set status = 'published',
                                  version_label = 'Rev ' || (
                                    select coalesce(count(*), 0) + 1
                                    from db.training_course_versions
                                    where training_course_id = ${courseId}
                                      and status != 'draft'
                                  ),
                                  published_by_id = ${
                                currentEmployeeId(props.block.opts)
                              },
                                  published_at = now()
                              where id = draft_course_version_id
                                and status = 'draft'
                            `);
                              s.modify(setCurrentCourseVersionSql({
                                courseId,
                                courseVersionId: sql`draft_course_version_id`,
                              }));
                              s.modify(
                                cancelOpenAssessmentAttemptsForCourseAssignmentsSql(
                                  {
                                    courseId,
                                    cancelledById: currentEmployeeId(
                                      props.block.opts,
                                    ),
                                  },
                                ),
                              );
                              s.modify(replaceOpenCourseAssignmentTasksSql({
                                courseId,
                              }));
                              s.modify(insertCurrentCourseAssignmentTasksSql({
                                courseId,
                                newCourseVersionId:
                                  sql`draft_course_version_id`,
                              }));
                              s.modify(insertTaskItemDocumentSnapshotsSql(
                                props.block.opts,
                                sql`exists (
                                  select 1
                                  from db.training_course_section_items task_item
                                  join db.training_course_sections task_section
                                    on task_section.id = task_item.training_course_section_id
                                  where task_item.id = t.training_course_section_item_id
                                    and task_section.training_course_version_id =
                                      draft_course_version_id
                                )`,
                              ));
                              s.commitTransaction();
                              s.setScalar("add_step_section_id", sql.lit``);
                              s.setScalar("edit_course_section_id", sql.lit``);
                              s.refetch();
                            },
                            catch: (s) => {
                              s.setScalar(
                                "course_edit_error",
                                sql.lit`Draft changes could not be published.`,
                              );
                            },
                          });
                        }}
                      >
                        Publish changes
                      </Button>
                    </Show>
                  </Show>
                  <Show when={sql`can_assign_training_courses`}>
                    <Button
                      component="a"
                      href={adminCourseAssignHref(props.block, courseId)}
                      startIcon="AssignmentInd"
                    >
                      {sql`case when selected_course.is_program then 'Assign program' else 'Assign course' end`}
                    </Button>
                  </Show>
                  <Button
                    id={settingsButtonId}
                    variant="outlined"
                    color="neutral"
                    startIcon="Settings"
                    onClick={(s) => s.toggle("course_settings_open")}
                  >
                    Settings
                  </Button>
                  <Show when={sql`course_settings_open`}>
                    <Sheet
                      variant="outlined"
                      popover="auto"
                      yolmPopoverShowing={sql`course_settings_open`}
                      floating={{
                        anchorEl: settingsButtonId,
                        placement: "bottom-end",
                        strategy: "absolute",
                        shift: { mainAxis: true, crossAxis: true },
                        offset: { mainAxis: 4, crossAxis: 0 },
                      }}
                      sx={{
                        mt: 1,
                        p: 2,
                        width: "min(22rem, calc(100vw - 2rem))",
                        zIndex: 1100,
                        boxShadow: "md",
                        borderRadius: "md",
                        backgroundColor: "background-surface",
                      }}
                      onToggleHide={(s) =>
                        s.setScalar("course_settings_open", false)}
                    >
                      <Form defaultFieldComponent={FieldFormControl}>
                        <Form.Update
                          table="training_courses"
                          where={sql`id = ${courseId}`}
                        >
                          <div className="flex flex-col gap-3">
                            <Typography level="title-sm" startIcon="Settings">
                              Course settings
                            </Typography>
                            <LabeledFormField
                              field="due_within_days"
                              label="Due after days"
                              required
                            />
                            <LabeledFormField
                              field="reminder_after_days"
                              label="Reminder after days"
                              required
                            />
                            <LabeledFormField
                              field="reminder_repeat_every_days"
                              label="Repeat reminders every days"
                            />
                            <LabeledFormField
                              field="overdue_after_days"
                              label="Overdue notice after days"
                              required
                            />
                            <LabeledFormField
                              field="overdue_repeat_every_days"
                              label="Repeat overdue notices every days"
                            />
                            {trainingFeatureEnabled(
                              props.block.opts,
                              "compliance",
                            ) && (
                              <LabeledFormField
                                field="certification_expires_after_days"
                                label="Certification expires after days"
                              />
                            )}
                            <div className="flex justify-end">
                              <Form.SubmitButton>
                                Save settings
                              </Form.SubmitButton>
                            </div>
                          </div>
                        </Form.Update>
                      </Form>
                    </Sheet>
                  </Show>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Show when={sql`course_edit_error is not null`}>
                <Alert color="danger" startIcon="Error" className="mb-4">
                  {sql`course_edit_error`}
                </Alert>
              </Show>
              <Show
                when={sql`selected_course.draft_training_course_version_id is not null`}
              >
                <Alert color="warning" startIcon="Edit" className="mb-4">
                  Draft changes are not assigned until you publish them.
                </Alert>
              </Show>
              <div className="flex flex-col gap-2 mb-5">
                <Typography level="body-sm" className="text-neutral-600">
                  Build the course from reusable sections, manual tasks/checks,
                  and library resources. External links are added to the library
                  first, then linked here like a file.
                </Typography>
                <Show
                  when={sql`not exists (select 1 from course_sections)`}
                >
                  <EmptyState
                    icon="PlaylistAdd"
                    title="This course is empty"
                    body="Add sections, library resources, or practical checks before assigning it."
                  />
                </Show>
                <Each table="course_sections" recordName="section">
                  <div className="border border-divider rounded-md bg-neutral-50">
                    <div className="px-4 py-3 border-b border-divider">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div>
                          <Typography level="title-md">
                            {sql`section.name`}
                          </Typography>
                          <Show
                            when={sql`nullif(trim(coalesce(section.description, '')), '') is not null`}
                          >
                            <Typography
                              level="body-sm"
                              className="text-neutral-600 mt-1"
                            >
                              {sql`section.description`}
                            </Typography>
                          </Show>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Chip size="sm" variant="soft" color="neutral">
                            {sql`section.item_count::string ||
                                  case when section.item_count = 1
                                    then ' item' else ' items' end`}
                          </Chip>
                          <MoveCourseSectionButton
                            courseId={courseId}
                            direction="up"
                          />
                          <MoveCourseSectionButton
                            courseId={courseId}
                            direction="down"
                          />
                          <IconButton
                            icon="Add"
                            aria-label="Add task to section"
                            tooltip="Add task to section"
                            variant="plain"
                            color="primary"
                            onClick={(s) => {
                              s.setScalar(
                                "add_step_section_id",
                                sql`section.id::string`,
                              );
                              s.setScalar("add_step_mode", sql.lit`task`);
                              s.setScalar("add_step_content", sql.lit``);
                              s.setScalar(
                                "add_step_type",
                                sql.lit`practical`,
                              );
                              s.setScalar(
                                "add_step_requires_essay",
                                sql`false`,
                              );
                              s.setScalar(
                                "add_step_essay_prompt",
                                sql.lit``,
                              );
                              s.setScalar(
                                "add_step_support_document_id",
                                sql`null`,
                              );
                            }}
                          />
                          <IconButton
                            icon="Edit"
                            aria-label="Edit section"
                            tooltip="Edit section"
                            variant="plain"
                            color="neutral"
                            onClick={(s) => {
                              s.setScalar(
                                "edit_course_section_id",
                                sql`section.id::string`,
                              );
                              s.setScalar(
                                "edit_course_section_name",
                                sql`section.name`,
                              );
                              s.setScalar(
                                "edit_course_section_description",
                                sql`coalesce(section.description, '')`,
                              );
                            }}
                          />
                          <RemoveCourseSectionButton
                            block={props.block}
                            courseId={courseId}
                          />
                        </div>
                      </div>
                      <Show
                        when={sql`edit_course_section_id = section.id::string`}
                      >
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormControl>
                            <FormLabel>Section name</FormLabel>
                            <Input bindScalar="edit_course_section_name" />
                          </FormControl>
                          <FormControl>
                            <FormLabel>Subtitle</FormLabel>
                            <Input bindScalar="edit_course_section_description" />
                          </FormControl>
                          <div className="md:col-span-2 flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="plain"
                              color="neutral"
                              onClick={(s) => {
                                s.setScalar(
                                  "edit_course_section_id",
                                  sql.lit``,
                                );
                                s.setScalar(
                                  "edit_course_section_name",
                                  sql.lit``,
                                );
                                s.setScalar(
                                  "edit_course_section_description",
                                  sql.lit``,
                                );
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              startIcon="Save"
                              onClick={(s) => {
                                s.setScalar("course_edit_error", sql`null`);
                                s.if(
                                  sql`nullif(trim(edit_course_section_name), '') is null`,
                                  (s) => {
                                    s.setScalar(
                                      "course_edit_error",
                                      sql
                                        .lit`Enter the section name before saving it.`,
                                    );
                                    s.return();
                                  },
                                );
                                s.tryServer({
                                  body: (s) => {
                                    s.startTransaction();
                                    ensureCourseDraftVersion(s, {
                                      block: props.block,
                                      courseId,
                                    });
                                    s.defScalar(
                                      "target_new_course_section_id",
                                      mapCourseSectionToDraftSql(
                                        sql`section.id`,
                                      ),
                                    );
                                    s.modify(sql`
                                          update db.training_course_sections
                                          set name = trim(ui.edit_course_section_name),
                                              description = nullif(
                                                trim(ui.edit_course_section_description),
                                                ''
                                              )
                                          where id = target_new_course_section_id
                                        `);
                                    s.commitTransaction();
                                    s.setScalar(
                                      "edit_course_section_id",
                                      sql.lit``,
                                    );
                                    s.setScalar(
                                      "edit_course_section_name",
                                      sql.lit``,
                                    );
                                    s.setScalar(
                                      "edit_course_section_description",
                                      sql.lit``,
                                    );
                                    s.setScalar(
                                      "add_step_section_id",
                                      sql.lit``,
                                    );
                                    s.refetch();
                                  },
                                });
                              }}
                            >
                              Save section
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                    <Show when={sql`section.item_count = 0`}>
                      <div className="px-4 py-3">
                        <Typography
                          level="body-sm"
                          className="text-neutral-600"
                        >
                          No steps in this section yet.
                        </Typography>
                      </div>
                    </Show>
                    <Each
                      table="course_items"
                      recordName="item"
                      where={sql`item.section_id = section.id`}
                    >
                      <div className="p-3 border-b border-divider bg-white last:border-b-0">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <Typography level="title-sm">
                              {sql`item.title`}
                            </Typography>
                            <Typography
                              level="body-sm"
                              className="text-neutral-600"
                            >
                              {sql`item.section_name || ' · ' || item.kind`}
                            </Typography>
                          </div>
                          <div className="flex gap-2">
                            <Show when={sql`item.requires_essay`}>
                              <Chip
                                size="sm"
                                variant="soft"
                                color="warning"
                              >
                                Essay
                              </Chip>
                            </Show>
                            <Show
                              when={sql`exists (
                              select 1
                              from course_items other
                              where other.section_ordinal < item.section_ordinal
                                or (
                                  other.section_ordinal = item.section_ordinal
                                  and (
                                    other.sort_order < item.sort_order
                                    or (
                                      other.sort_order = item.sort_order
                                      and other.id < item.id
                                    )
                                  )
                                )
                            )`}
                            >
                              <IconButton
                                icon="KeyboardArrowUp"
                                aria-label="Move item up"
                                variant="plain"
                                color="neutral"
                                onClick={(s) => {
                                  s.event.stopPropagation();
                                  s.setScalar(
                                    "course_edit_error",
                                    sql`null`,
                                  );
                                  s.tryServer({
                                    body: (s) => {
                                      s.startTransaction();
                                      s.callStoredProcedure(
                                        "training_move_course_item",
                                        {
                                          inputScalars: {
                                            p_course_id: courseId,
                                            p_record_id: sql`item.id`,
                                            p_move_up: sql`true`,
                                          },
                                        },
                                      );
                                      s.commitTransaction();
                                      s.refetch();
                                    },
                                  });
                                }}
                              />
                            </Show>
                            <Show
                              when={sql`exists (
                              select 1
                              from course_items other
                              where other.section_ordinal > item.section_ordinal
                                or (
                                  other.section_ordinal = item.section_ordinal
                                  and (
                                    other.sort_order > item.sort_order
                                    or (
                                      other.sort_order = item.sort_order
                                      and other.id > item.id
                                    )
                                  )
                                )
                            )`}
                            >
                              <IconButton
                                icon="KeyboardArrowDown"
                                aria-label="Move item down"
                                variant="plain"
                                color="neutral"
                                onClick={(s) => {
                                  s.event.stopPropagation();
                                  s.setScalar(
                                    "course_edit_error",
                                    sql`null`,
                                  );
                                  s.tryServer({
                                    body: (s) => {
                                      s.startTransaction();
                                      s.callStoredProcedure(
                                        "training_move_course_item",
                                        {
                                          inputScalars: {
                                            p_course_id: courseId,
                                            p_record_id: sql`item.id`,
                                            p_move_up: sql`false`,
                                          },
                                        },
                                      );
                                      s.commitTransaction();
                                      s.refetch();
                                    },
                                  });
                                }}
                              />
                            </Show>
                            <IconButton
                              icon="RemoveCircleOutline"
                              aria-label="Remove document from course"
                              variant="plain"
                              color="danger"
                              onClick={(s) => {
                                s.event.stopPropagation();
                                s.setScalar("course_edit_error", sql`null`);
                                s.tryServer({
                                  body: (s) => {
                                    s.startTransaction();
                                    ensureCourseDraftVersion(s, {
                                      block: props.block,
                                      courseId,
                                    });
                                    s.defScalar(
                                      "target_new_course_item_id",
                                      mapCourseItemToDraftSql(
                                        sql`item.id`,
                                      ),
                                    );
                                    s.modify(sql`
                                          delete from db.training_course_section_item_documents
                                          where training_course_section_item_id =
                                            target_new_course_item_id
                                        `);
                                    s.modify(sql`
                                          delete from db.training_course_section_items
                                          where id = target_new_course_item_id
                                        `);
                                    s.commitTransaction();
                                    s.refetch();
                                  },
                                });
                              }}
                            >
                            </IconButton>
                          </div>
                        </div>
                        <Show
                          when={sql`exists (
                          select 1
                          from course_item_documents doc
                          where doc.training_course_section_item_id = item.id
                        )`}
                        >
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Each
                              table="course_item_documents"
                              recordName="doc"
                              where={sql`doc.training_course_section_item_id = item.id`}
                            >
                              <Chip
                                size="sm"
                                variant="soft"
                                color="neutral"
                              >
                                {sql`doc.title || ' · ' || doc.kind`}
                              </Chip>
                            </Each>
                          </div>
                        </Show>
                      </div>
                    </Each>
                    <Show
                      when={sql`add_step_section_id = section.id::string
                            and add_step_mode = 'task'`}
                    >
                      <div className="border-t border-divider bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <Typography level="title-sm">
                            Add task or check
                          </Typography>
                          <IconButton
                            icon="Close"
                            aria-label="Close add task"
                            tooltip="Close"
                            variant="plain"
                            color="neutral"
                            onClick={(s) => {
                              s.setScalar("add_step_section_id", sql.lit``);
                              s.setScalar("add_step_content", sql.lit``);
                              s.setScalar(
                                "add_step_essay_prompt",
                                sql.lit``,
                              );
                              s.setScalar(
                                "add_step_support_document_id",
                                sql`null`,
                              );
                              s.setScalar(
                                "add_step_assessment_id",
                                sql`null`,
                              );
                            }}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormControl>
                            <FormLabel>Step type</FormLabel>
                            <Select
                              className={adminSelectClass}
                              value={sql`add_step_type`}
                              onInput={(s) => {
                                s.setScalar(
                                  "add_step_type",
                                  sql`target_value`,
                                );
                                s.if(
                                  sql`target_value = 'signature'`,
                                  (s) =>
                                    s.setScalar(
                                      "add_step_support_document_id",
                                      sql`null`,
                                    ),
                                );
                                s.if(
                                  sql`target_value != 'assessment'`,
                                  (s) =>
                                    s.setScalar(
                                      "add_step_assessment_id",
                                      sql`null`,
                                    ),
                                );
                                s.if(
                                  sql`target_value = 'essay'`,
                                  (s) =>
                                    s.setScalar(
                                      "add_step_requires_essay",
                                      sql`true`,
                                    ),
                                  (s) => {
                                    s.setScalar(
                                      "add_step_requires_essay",
                                      sql`false`,
                                    );
                                    s.setScalar(
                                      "add_step_essay_prompt",
                                      sql.lit``,
                                    );
                                  },
                                );
                              }}
                            >
                              <Select.Option value="practical">
                                Practical check
                              </Select.Option>
                              <Select.Option value="essay">
                                Written response
                              </Select.Option>
                              <Select.Option value="signature">
                                Signature
                              </Select.Option>
                              <Select.Option value="assessment">
                                Assessment
                              </Select.Option>
                            </Select>
                          </FormControl>
                          <Show when={sql`add_step_type = 'assessment'`}>
                            <FormControl>
                              <FormLabel>Assessment</FormLabel>
                              <TableRecordSelect
                                tableName="training_assessments"
                                value={sql`add_step_assessment_id`}
                                disableOnClear={false}
                                placeholder="Choose an assessment"
                                where={sql`is_active
                                  and archived_at is null`}
                                onSelectValue={(s, assessmentId) => {
                                  s.setScalar(
                                    "add_step_assessment_id",
                                    assessmentId,
                                  );
                                }}
                              />
                            </FormControl>
                          </Show>
                          <Show when={sql`add_step_type != 'signature'`}>
                            <FormControl>
                              <FormLabel>Supporting file or link</FormLabel>
                              <Data
                                watch={[sql`add_step_support_document_id`]}
                                procedure={(s) => {
                                  s.defScalar(
                                    "add_step_support_document_name",
                                    sql`coalesce((
                                      select document.title
                                      from db.training_content_documents document
                                      where document.id =
                                        ui.add_step_support_document_id
                                    ), '')`,
                                  );
                                }}
                              >
                                <QueryCombobox
                                  placeholder="Optional library resource"
                                  clearOnSelect={false}
                                  initialInputText={sql`add_step_support_document_name`}
                                  populateResultTable={(
                                    s,
                                    query,
                                    resultTable,
                                  ) => {
                                    s.modify(sql`
                                    insert into ${resultTable}
                                      select document.title as label,
                                             rank() over () - 1 as index,
                                             document.id
                                      from db.training_content_documents document
                                      where document.is_active
                                        and exists (
                                          select 1
                                          from db.training_content_language_variants variant
                                          where variant.document_id =
                                            document.id
                                            and variant.current_document_version_id
                                              is not null
                                        )
                                        and (
                                          trim(${query}) = ''
                                          or fuzzy_match(
                                            ${query},
                                            document.title
                                          )
                                        )
                                      order by
                                        case
                                          when trim(${query}) = '' then 0
                                          else 1
                                        end,
                                        fuzzy_rank_key(
                                          ${query},
                                          document.title
                                        ),
                                        document.title
                                      limit 20
                                    `);
                                  }}
                                  onSelect={(s, result) => {
                                    s.setScalar(
                                      "add_step_support_document_id",
                                      sql`${result}.id`,
                                    );
                                  }}
                                  onClear={(s) =>
                                    s.setScalar(
                                      "add_step_support_document_id",
                                      sql`null`,
                                    )}
                                  onBlur={() => {}}
                                />
                              </Data>
                            </FormControl>
                          </Show>
                          <FormControl className="md:col-span-2">
                            <FormLabel>Task</FormLabel>
                            <Textarea
                              bindScalar="add_step_content"
                              minRows={2}
                              placeholder="Describe what the employee must do or answer"
                            />
                          </FormControl>
                          <Show
                            when={sql`add_step_requires_essay or add_step_type = 'essay'`}
                          >
                            <FormControl className="md:col-span-2">
                              <FormLabel>Response prompt</FormLabel>
                              <Textarea
                                bindScalar="add_step_essay_prompt"
                                minRows={2}
                                placeholder="Prompt shown to the employee"
                              />
                            </FormControl>
                          </Show>
                        </div>
                        <div className="mt-3 flex flex-col sm:flex-row gap-3">
                          <Checkbox
                            checked={sql`add_step_requires_essay`}
                            label="Requires written response"
                            onCheckboxChange={(s) => {
                              s.setScalar(
                                "add_step_requires_essay",
                                sql`target_checked`,
                              );
                            }}
                          />
                        </div>
                        <Button
                          className="mt-3"
                          startIcon="PlaylistAdd"
                          onClick={(s) => {
                            s.setScalar("course_edit_error", sql`null`);
                            s.if(
                              sql`nullif(trim(add_step_content), '') is null`,
                              (s) => {
                                s.setScalar(
                                  "course_edit_error",
                                  sql
                                    .lit`Enter the task before adding the step.`,
                                );
                                s.return();
                              },
                            );
                            s.if(
                              sql`add_step_type = 'assessment'
                                and add_step_assessment_id is null`,
                              (s) => {
                                s.setScalar(
                                  "course_edit_error",
                                  sql
                                    .lit`Choose the assessment before adding the step.`,
                                );
                                s.return();
                              },
                            );
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                ensureCourseDraftVersion(s, {
                                  block: props.block,
                                  courseId,
                                });
                                s.modify(sql`
                                      insert into db.training_course_section_items
                                        (training_course_section_id, sort_order,
                                         requires_essay,
                                         essay_prompt, content, type,
                                         training_assessment_id)
                                      values
                                        ((${
                                  mapCourseSectionToDraftSql(sql`section.id`)
                                }),
                                         (
                                           select coalesce(max(sort_order), 0) + 10
                                           from db.training_course_section_items draft_item
                                           join db.training_course_sections draft_section
                                             on draft_section.id =
                                               draft_item.training_course_section_id
                                           where draft_section.training_course_version_id =
                                               draft_course_version_id
                                         ),
                                         ui.add_step_requires_essay
                                           or ui.add_step_type = 'essay',
                                         nullif(trim(ui.add_step_essay_prompt), ''),
                                         trim(ui.add_step_content),
                                         ui.add_step_type,
                                         case
                                           when ui.add_step_type = 'assessment'
                                             then ui.add_step_assessment_id
                                           else null
                                         end)
                                    `);
                                s.if(
                                  sql`ui.add_step_type != 'signature'
                                    and ui.add_step_support_document_id is not null`,
                                  (s) => {
                                    s.modify(sql`
                                          insert into db.training_course_section_item_documents
                                            (training_course_section_item_id,
                                             document_id, sort_order, label)
                                          select last_record_id(db.training_course_section_items),
                                                 d.id, 10, d.title
                                          from db.training_content_documents d
                                          where d.id = ui.add_step_support_document_id
                                        `);
                                  },
                                );
                                s.commitTransaction();
                                s.setScalar(
                                  "add_step_section_id",
                                  sql.lit``,
                                );
                                s.setScalar("add_step_content", sql.lit``);
                                s.setScalar(
                                  "add_step_type",
                                  sql.lit`practical`,
                                );
                                s.setScalar(
                                  "add_step_requires_essay",
                                  sql`false`,
                                );
                                s.setScalar(
                                  "add_step_essay_prompt",
                                  sql.lit``,
                                );
                                s.setScalar(
                                  "add_step_support_document_id",
                                  sql`null`,
                                );
                                s.setScalar(
                                  "add_step_assessment_id",
                                  sql`null`,
                                );
                                s.refetch();
                              },
                            });
                          }}
                        >
                          Add task step
                        </Button>
                      </div>
                    </Show>
                  </div>
                </Each>
              </div>
              <div className="border-t border-divider pt-4">
                <div>
                  <Typography level="title-md">Add a section</Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    Create a course section or append a reusable stored section.
                  </Typography>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormControl>
                  <FormLabel>Section name</FormLabel>
                  <Input
                    bindScalar="add_course_section_name"
                    placeholder="Company Policy"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Subtitle</FormLabel>
                  <Input
                    bindScalar="add_course_section_description"
                    placeholder="Policies and acknowledgements for this part"
                  />
                </FormControl>
              </div>
              <Button
                className="mt-3"
                variant="outlined"
                startIcon="Add"
                onClick={(s) => {
                  s.setScalar("course_edit_error", sql`null`);
                  s.if(
                    sql`nullif(trim(add_course_section_name), '') is null`,
                    (s) => {
                      s.setScalar(
                        "course_edit_error",
                        sql.lit`Enter the section name before adding it.`,
                      );
                      s.return();
                    },
                  );
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      ensureCourseDraftVersion(s, {
                        block: props.block,
                        courseId,
                      });
                      s.modify(sql`
                            insert into db.training_course_sections
                              (training_course_version_id, name, description,
                               ordinal)
                            values
                              (draft_course_version_id,
                               trim(ui.add_course_section_name),
                               nullif(trim(ui.add_course_section_description), ''),
                               (
                                 select coalesce(max(ordinal), 0) + 10
                                 from db.training_course_sections
                                 where training_course_version_id =
                                   draft_course_version_id
                               ))
                          `);
                      s.commitTransaction();
                      s.setScalar("add_course_section_name", sql.lit``);
                      s.setScalar(
                        "add_course_section_description",
                        sql.lit``,
                      );
                      s.refetch();
                    },
                  });
                }}
              >
                Add section
              </Button>
              <div className="mt-5 border-t border-divider pt-4">
                <Typography level="title-sm">
                  Reuse stored section
                </Typography>
                <Typography level="body-sm" className="text-neutral-600">
                  Append a saved section and its reusable steps.
                </Typography>
              </div>
              <FormControl className="mt-3">
                <FormLabel>Reuse stored section</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`add_course_item_section_template_id`}
                  onInput={(s) =>
                    s.setScalar(
                      "add_course_item_section_template_id",
                      sql`target_value`,
                    )}
                >
                  <Select.Option value="">Choose section</Select.Option>
                  <Each
                    table="course_section_templates"
                    recordName="section_template"
                  >
                    <Select.Option value={sql`section_template.id`}>
                      {sql`section_template.name`}
                    </Select.Option>
                  </Each>
                </Select>
              </FormControl>
              <Button
                className="mt-3"
                variant="outlined"
                startIcon="ViewAgenda"
                onClick={(s) => {
                  s.setScalar("course_edit_error", sql`null`);
                  s.if(
                    sql`nullif(ui.add_course_item_section_template_id, '') is null`,
                    (s) => {
                      s.setScalar(
                        "course_edit_error",
                        sql
                          .lit`Choose a stored section before adding it to the course.`,
                      );
                      s.return();
                    },
                  );
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      ensureCourseDraftVersion(s, {
                        block: props.block,
                        courseId,
                      });
                      s.modify(insertCourseSectionFromTemplateSql({
                        courseVersionId: sql`draft_course_version_id`,
                        templateId:
                          sql`ui.add_course_item_section_template_id::bigint`,
                      }));
                      s.modify(insertCourseSectionItemsFromTemplateSql({
                        courseVersionId: sql`draft_course_version_id`,
                        templateId:
                          sql`ui.add_course_item_section_template_id::bigint`,
                      }));
                      s.modify(
                        insertCourseSectionItemDocumentsFromTemplateSql({
                          courseVersionId: sql`draft_course_version_id`,
                          templateId:
                            sql`ui.add_course_item_section_template_id::bigint`,
                        }),
                      );
                      s.commitTransaction();
                      s.setScalar(
                        "add_course_item_section_template_id",
                        sql.lit``,
                      );
                      s.refetch();
                    },
                    catch: (s) => {
                      s.setScalar(
                        "course_edit_error",
                        sql
                          .lit`Stored section could not be added to this course.`,
                      );
                    },
                  });
                }}
              >
                Append section steps
              </Button>
            </CardContent>
          </Card>
        </div>
      </Data>
    </div>
  );
}

/** Registers draft-aware course reordering shared by both movement directions. */
export function registerCourseEditorStoredProcedures() {
  system.storedProcedure({
    name: "training_move_course_section",
    transaction: "caller",
    inputScalars: [
      { name: "p_course_id", type: "BigInt" },
      { name: "p_record_id", type: "BigInt" },
      { name: "p_move_up", type: "Bool" },
    ],
    procedure: (s) => {
      s.callStoredProcedure("training_ensure_course_draft", {
        inputScalars: { p_course_id: sql`p_course_id` },
        outputScalars: {
          draft_course_version_id: "draft_course_version_id",
          source_course_version_id: "source_course_version_id",
        },
      });
      s.defScalar(
        "target_new_course_section_id",
        mapCourseSectionToDraftSql(sql`p_record_id`),
      );
      s.defScalar(
        "adjacent_new_course_section_id",
        sql`case when p_move_up then ${adjacentDraftSectionSql("up")} else ${
          adjacentDraftSectionSql("down")
        } end`,
      );
      s.defScalar(
        "target_new_course_section_ordinal",
        sql`(
                  select ordinal
                  from db.training_course_sections
                  where id = target_new_course_section_id
                )`,
      );
      s.defScalar(
        "adjacent_new_course_section_ordinal",
        sql`(
                  select ordinal
                  from db.training_course_sections
                  where id = adjacent_new_course_section_id
                )`,
      );
      s.modify(sql`
                update db.training_course_sections
                set ordinal = adjacent_new_course_section_ordinal
                where id = target_new_course_section_id
              `);
      s.modify(sql`
                update db.training_course_sections
                set ordinal = target_new_course_section_ordinal
                where id = adjacent_new_course_section_id
              `);
    },
  });
  system.storedProcedure({
    name: "training_move_course_item",
    transaction: "caller",
    inputScalars: [
      { name: "p_course_id", type: "BigInt" },
      { name: "p_record_id", type: "BigInt" },
      { name: "p_move_up", type: "Bool" },
    ],
    procedure: (s) => {
      s.callStoredProcedure("training_ensure_course_draft", {
        inputScalars: { p_course_id: sql`p_course_id` },
        outputScalars: {
          draft_course_version_id: "draft_course_version_id",
          source_course_version_id: "source_course_version_id",
        },
      });
      s.defScalar(
        "target_new_course_item_id",
        mapCourseItemToDraftSql(
          sql`p_record_id`,
        ),
      );
      s.defScalar(
        "adjacent_new_course_item_id",
        sql`case when p_move_up then ${adjacentDraftItemSql("up")} else ${
          adjacentDraftItemSql("down")
        } end`,
      );
      s.defRecord(
        "target_new_course_item",
        sql`select training_course_section_id,
                                                 sort_order
                                          from db.training_course_section_items
                                          where id = target_new_course_item_id`,
      );
      s.defRecord(
        "adjacent_new_course_item",
        sql`select training_course_section_id,
                                                 sort_order
                                          from db.training_course_section_items
                                          where id = adjacent_new_course_item_id`,
      );
      s.modify(sql`
                                      update db.training_course_section_items
                                      set training_course_section_id =
                                            target_new_course_item.training_course_section_id,
                                          sort_order =
                                            target_new_course_item.sort_order
                                      where id = adjacent_new_course_item_id
                                    `);
      s.modify(sql`
                                      update db.training_course_section_items
                                      set training_course_section_id =
                                            adjacent_new_course_item.training_course_section_id,
                                          sort_order =
                                            adjacent_new_course_item.sort_order
                                      where id = target_new_course_item_id
                                    `);
    },
  });
}
