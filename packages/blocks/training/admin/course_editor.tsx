import {
  translationApprovedSql,
  translationReviewIdSql,
  translationReviewLockedSql,
} from "../translation_reviews";
import {
  TrainingLanguageControls,
  TrainingLanguageSwitch,
} from "./language_controls";
import { CourseIntroductionEditor } from "./course_introduction";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { Card, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { QueryCombobox } from "components/query_combobox";
import { Select } from "components/select";
import { TableRecordSelect } from "components/table_record_select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { system } from "std/system";
import { Form } from "std/form";
import { type Sql, sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { Each, Show, useUniqueId } from "std/ui";
import { currentUserHasPermission } from "blocks/auth";
import type { TrainingBlock } from "../index.tsx";
import {
  activeCourseVersionSql,
  insertCourseSectionFromTemplateSql,
  insertCourseSectionItemDocumentsFromTemplateSql,
  insertCourseSectionItemsFromTemplateSql,
  trainingFeatureEnabled,
  trainingPermissions,
} from "../helpers";
import { BackLink, EmptyState } from "../shared";
import {
  adminCourseAssignHref,
  adminCourseHref,
  adminCoursesHref,
  LabeledFormField,
  TrainingAdminFrame,
} from "./shared";

function CourseLibraryResourceSelect(props: {
  block: TrainingBlock;
  id?: Sql;
  value: Sql;
  onChange: (s: DomStatements, value: Sql) => void;
}) {
  return (
    <Data
      watch={[props.value]}
      procedure={(s) =>
        s.defScalar(
          "course_resource_name",
          sql`coalesce((select title from db.training_content_documents
            where id = ${props.value}), '')`,
        )}
    >
      <QueryCombobox
        id={props.id}
        placeholder="Choose a policy or company file"
        clearOnSelect={false}
        initialInputText={sql`course_resource_name`}
        populateResultTable={(s, query, resultTable) => {
          s.modify(sql`
            insert into ${resultTable}
            select document.title || ' · ' || document.source_name as label, rank() over () - 1 as index,
                   document.id
            from db.training_content_documents document
            where document.is_active
              and ${
            props.block.opts.content.canReadDocument(
              sql`document.id`,
              sql`current_user`,
            )
          }
              and exists (
                select 1 from db.training_content_language_variants variant
                where variant.document_id = document.id
                  and variant.current_document_version_id is not null
              )
              and (trim(${query}) = '' or fuzzy_match(${query}, document.title))
            order by case when trim(${query}) = '' then 0 else 1 end,
                     fuzzy_rank_key(${query}, document.title), document.title
            limit 20
          `);
        }}
        onSelect={(s, result) => props.onChange(s, sql`${result}.id`)}
        onClear={(s) => props.onChange(s, sql.null)}
        onBlur={() => {}}
      />
    </Data>
  );
}

function draftCourseVersionSql(courseId: Sql) {
  return sql`(
    select v.id
    from db.training_course_versions v
    where v.training_course_id = ${courseId}
      and v.status = 'draft' and v.language = ui.editor_language
    order by v.created_at desc, v.id desc
    limit 1
  )`;
}

function editorCourseVersionSql(courseId: Sql) {
  return sql`coalesce(
    ${draftCourseVersionSql(courseId)},
    ${activeCourseVersionSql(courseId, sql`ui.editor_language`, true)}
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
  s.callStoredProcedure("training_ensure_course_draft_language", {
    inputScalars: {
      p_course_id: args.courseId,
      p_language: sql`ui.editor_language`,
      p_source_version: sql`null`,
    },
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
    <IconButton
      disabled={sql`not exists (
          select 1
          from course_sections other
          where ${beforeWhere}
        )`}
      icon={props.direction === "up" ? "KeyboardArrowUp" : "KeyboardArrowDown"}
      aria-label={props.direction === "up"
        ? "Move section up"
        : "Move section down"}
      tooltip={props.direction === "up"
        ? "Move section up"
        : "Move section down"}
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
      size="sm"
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
      queryParams={{
        content_language: {
          default: sql.lit(props.block.opts.content.opts.defaultLanguage),
          type: "String",
        },
      }}
    >
      <Data
        local
        watch={[sql`content_language`]}
        hoistKey={sql`content_language`}
        procedure={(s) => {
          s.defScalar("editor_language", sql`content_language`);
          s.defScalar("course_edit_error", {
            type: { type: "String", maxLength: 1000 },
          });
          s.defScalar("language_details_open", false);
          s.defScalar("edit_course_task_open", false);
          s.defScalar("edit_course_task_id", { type: "BigInt" });
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
          <CourseEditorWorkspace
            block={props.block}
            courseId={sql`course_id`}
          />
        </TrainingAdminFrame>
      </Data>
    </Data>
  );
}

export function CourseEditorWorkspace(
  props: { block: TrainingBlock; courseId: Sql },
) {
  const courseId = props.courseId;
  const taskInputId = useUniqueId();
  const taskTitleInputId = useUniqueId();
  const taskPromptInputId = useUniqueId();
  const taskResourceInputId = useUniqueId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-ml-2">
          <BackLink
            href={adminCoursesHref(props.block)}
            label="Back to courses & programs"
          />
        </div>
        <TrainingLanguageSwitch block={props.block} />
      </div>
      <Data
        procedure={(s) => {
          s.defRecord(
            "selected_course",
            sql`select c.id, coalesce((select localized_name from db.training_course_versions where id = ${
              editorCourseVersionSql(courseId)
            }), c.name) as name, case when (select localized_name from db.training_course_versions where id = ${
              editorCourseVersionSql(courseId)
            }) is null then c.description else (select localized_description from db.training_course_versions where id = ${
              editorCourseVersionSql(courseId)
            }) end as description,
                       (select introduction from db.training_course_versions where id = ${
              editorCourseVersionSql(courseId)
            }) as introduction,
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
          s.defScalar(
            "translation_edit_locked",
            translationReviewLockedSql(
              "course",
              sql`selected_course.editor_training_course_version_id`,
            ),
          );
          s.defScalar(
            "translation_is_approved",
            translationApprovedSql(
              "course",
              sql`selected_course.draft_training_course_version_id`,
            ),
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
        <TrainingLanguageControls
          block={props.block}
          kind="course"
          recordId={courseId}
          versionId={sql`selected_course.editor_training_course_version_id`}
        />
        <Show
          when={sql`selected_course.editor_training_course_version_id is not null or ui.editor_language = ${
            sql.lit(props.block.opts.content.opts.defaultLanguage)
          }`}
        >
          <div className="flex flex-col gap-4">
            <Card variant="outlined">
              <CardHeader>
                <div className="flex flex-col gap-3 w-full">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Typography level="h4" className="text-balance">
                        {sql`selected_course.name`}
                      </Typography>
                      <IconButton
                        icon="Edit"
                        size="sm"
                        variant="plain"
                        color="neutral"
                        disabled={sql`translation_edit_locked`}
                        aria-label="Edit title and description"
                        tooltip="Edit title and description"
                        onClick={(s) =>
                          s.setScalar("language_details_open", sql`true`)}
                      />
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`case when selected_course.is_program then 'Program' else 'Course' end`}
                      </Chip>
                      <Show when={sql`not selected_course.is_active`}>
                        <Chip size="sm" variant="soft" color="warning">
                          Archived
                        </Chip>
                      </Show>
                      <Show
                        when={sql`selected_course.draft_training_course_version_id is not null`}
                      >
                        <Chip
                          size="sm"
                          variant="soft"
                          color="warning"
                          startIcon="Edit"
                        >
                          Unpublished changes
                        </Chip>
                      </Show>
                    </div>
                    <Typography
                      level="body-sm"
                      className="text-neutral-600 mt-0.5"
                    >
                      {sql`coalesce(
                      nullif(trim(selected_course.description), ''),
                      case
                        when selected_course.is_program
                        then 'Add the courses and training items people must complete when this program is assigned.'
                        else 'Add the controlled documents and training items people must complete when this course is assigned.'
                      end
                    )`}
                    </Typography>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Show
                      when={sql`selected_course.draft_training_course_version_id is not null`}
                    >
                      <Show when={sql`can_publish_training_courses`}>
                        <Button
                          size="sm"
                          disabled={sql`ui.editor_language != ${
                            sql.lit(
                              props.block.opts.content.opts.defaultLanguage,
                            )
                          } and not translation_is_approved`}
                          startIcon="Publish"
                          onClick={(s) => {
                            s.setScalar("course_edit_error", sql`null`);
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                s.callStoredProcedure(
                                  "training_publish_course_draft_language",
                                  {
                                    inputScalars: {
                                      p_course_id: courseId,
                                      p_language: sql`ui.editor_language`,
                                    },
                                  },
                                );
                                s.commitTransaction();
                                s.setScalar("add_step_section_id", sql.lit``);
                                s.setScalar(
                                  "edit_course_section_id",
                                  sql.lit``,
                                );
                                s.refetch();
                              },
                              errorName: "course_publish_failure",
                              catch: (s) => {
                                s.setScalar(
                                  "course_edit_error",
                                  sql`coalesce(course_publish_failure.message,
                                  'Changes could not be published.')`,
                                );
                              },
                            });
                          }}
                        >
                          Publish changes
                        </Button>
                      </Show>
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        disabled={sql`translation_edit_locked`}
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
                              s.callStoredProcedure(
                                "training_discard_course_draft",
                                {
                                  inputScalars: {
                                    p_draft_course_version_id:
                                      sql`draft_course_version_id`,
                                  },
                                },
                              );
                              s.commitTransaction();
                              s.setScalar("add_step_section_id", sql.lit``);
                              s.setScalar("edit_course_section_id", sql.lit``);
                              s.refetch();
                            },
                            catch: (s) => {
                              s.setScalar(
                                "course_edit_error",
                                sql.lit`Changes could not be discarded.`,
                              );
                            },
                          });
                        }}
                      >
                        Discard changes
                      </Button>
                    </Show>
                    <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                      <Button
                        component="a"
                        href={sql`${
                          adminCourseHref(props.block, courseId)
                        } || '/preview?content_language=' || ui.editor_language`}
                        size="sm"
                        variant="outlined"
                        color="neutral"
                        startIcon="Visibility"
                      >
                        Preview course
                      </Button>
                      <Show when={sql`can_assign_training_courses`}>
                        <Button
                          component="a"
                          href={adminCourseAssignHref(props.block, courseId)}
                          size="sm"
                          variant="outlined"
                          startIcon="AssignmentInd"
                        >
                          {sql`case when selected_course.is_program then 'Assign program' else 'Assign course' end`}
                        </Button>
                      </Show>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>
            <fieldset
              disabled={sql`translation_edit_locked`}
              className="min-w-0 flex flex-col gap-4 xl:flex-row xl:items-start"
            >
              <nav
                aria-label="Course outline"
                className="hidden flex-col gap-1 rounded-md border border-divider bg-white p-3 xl:sticky xl:top-4 xl:flex xl:max-h-[90dvh] xl:w-56 xl:shrink-0 xl:overflow-y-auto"
              >
                <Typography
                  level="body-xs"
                  className="px-2 pb-1 uppercase tracking-wide text-neutral-600"
                >
                  Outline
                </Typography>
                <Show when={sql`not exists (select 1 from course_sections)`}>
                  <Typography level="body-sm" className="px-2 text-neutral-600">
                    No sections yet.
                  </Typography>
                </Show>
                <Each table="course_sections" recordName="outline_section">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-semibold hover:bg-neutral-100"
                      onClick={(s) =>
                        s.element(
                          sql`'training-course-section-' || outline_section.id::string`,
                        ).scrollIntoView({ block: sql.lit`start` })}
                    >
                      <span className="min-w-0 flex-1">
                        {sql`outline_section.name`}
                      </span>
                      <span className="shrink-0 text-xs font-normal text-neutral-600">
                        {sql`outline_section.item_count::string`}
                      </span>
                    </button>
                    <Each
                      table="course_items"
                      recordName="outline_item"
                      where={sql`outline_item.section_id = outline_section.id`}
                    >
                      <button
                        type="button"
                        className="flex min-h-9 w-full min-w-0 flex-col rounded-md py-1.5 pl-4 pr-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
                        title={sql`outline_item.title`}
                        dynamicClassNames={[{
                          condition:
                            sql`edit_course_task_open and edit_course_task_id = outline_item.id`,
                          classNames: "bg-primary-50",
                        }]}
                        onClick={(s) => {
                          s.setScalar(
                            "edit_course_task_id",
                            sql`outline_item.id`,
                          );
                          s.setScalar("edit_course_task_open", sql`true`);
                          s.element(
                            sql`'training-course-item-' || outline_item.id::string`,
                          ).scrollIntoView({ block: sql.lit`center` });
                        }}
                      >
                        <span className="w-full truncate">
                          {sql`outline_item.title`}
                        </span>
                        <span className="text-xs text-neutral-600">
                          {sql`outline_item.kind`}
                        </span>
                      </button>
                    </Each>
                  </div>
                </Each>
              </nav>
              <div className="min-w-0 rounded-md border border-divider bg-white p-4 xl:flex-1">
                <Show when={sql`course_edit_error is not null`}>
                  <Alert color="danger" startIcon="Error" className="mb-4">
                    {sql`course_edit_error`}
                  </Alert>
                </Show>
                {trainingFeatureEnabled(
                  props.block.opts,
                  "courseIntroduction",
                ) &&
                  (
                    <CourseIntroductionEditor
                      block={props.block}
                      courseId={courseId}
                      content={sql`selected_course.introduction`}
                    />
                  )}
                <div className="flex flex-col gap-3">
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
                    <div
                      id={sql`'training-course-section-' || section.id::string`}
                      className="border border-divider rounded-md overflow-hidden"
                    >
                      <div className="px-4 py-2.5 bg-neutral-50 border-b border-divider">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <Typography level="title-md">
                                {sql`section.name`}
                              </Typography>
                              <Typography
                                level="body-xs"
                                className="text-neutral-600"
                              >
                                {sql`section.item_count::string ||
                                    case when section.item_count = 1
                                      then ' item' else ' items' end`}
                              </Typography>
                            </div>
                            <Show
                              when={sql`nullif(trim(coalesce(section.description, '')), '') is not null`}
                            >
                              <Typography
                                level="body-sm"
                                className="text-neutral-600"
                              >
                                {sql`section.description`}
                              </Typography>
                            </Show>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <ButtonGroup
                              variant="outlined"
                              color="neutral"
                              size="sm"
                            >
                              <MoveCourseSectionButton
                                courseId={courseId}
                                direction="up"
                              />
                              <MoveCourseSectionButton
                                courseId={courseId}
                                direction="down"
                              />
                            </ButtonGroup>
                            <IconButton
                              icon="Edit"
                              aria-label="Edit section"
                              tooltip="Edit section"
                              size="sm"
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
                        <div className="px-4 py-2.5 border-b border-divider">
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
                        <div
                          id={sql`'training-course-item-' || item.id::string`}
                          className="cursor-pointer px-4 py-2 border-b border-divider bg-white hover:bg-neutral-50"
                          dynamicClassNames={[{
                            condition:
                              sql`edit_course_task_open and edit_course_task_id = item.id`,
                            classNames:
                              "bg-primary-50 ring-1 ring-inset ring-primary-300",
                          }]}
                          // The whole row selects the step; its move and
                          // remove buttons stop propagation.
                          onClick={(s) => {
                            s.setScalar("edit_course_task_id", sql`item.id`);
                            s.setScalar("edit_course_task_open", sql`true`);
                            // Below xl the inspector stacks under the course,
                            // so bring the step editor into view.
                            s.element(sql.lit`training-course-inspector`)
                              .scrollIntoView({ block: sql.lit`nearest` });
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              aria-label={sql`'Edit task: ' || item.title`}
                            >
                              <div className="flex flex-wrap items-center gap-x-2">
                                <Typography level="title-sm">
                                  {sql`item.title`}
                                </Typography>
                                <Show
                                  when={sql`item.requires_essay and item.type != 'essay'`}
                                >
                                  <Chip
                                    size="sm"
                                    variant="soft"
                                    color="neutral"
                                  >
                                    Written response
                                  </Chip>
                                </Show>
                              </div>
                              <Typography
                                level="body-xs"
                                className="text-neutral-600"
                              >
                                {sql`item.kind`}
                              </Typography>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <ButtonGroup
                                variant="outlined"
                                color="neutral"
                                size="sm"
                              >
                                <IconButton
                                  disabled={sql`not exists (
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
                                  icon="KeyboardArrowUp"
                                  aria-label="Move item up"
                                  tooltip="Move item up"
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
                                <IconButton
                                  disabled={sql`not exists (
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
                                  icon="KeyboardArrowDown"
                                  aria-label="Move item down"
                                  tooltip="Move item down"
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
                              </ButtonGroup>
                              <IconButton
                                icon="RemoveCircleOutline"
                                aria-label="Remove step"
                                tooltip="Remove step"
                                size="sm"
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
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                        when={sql`not (add_step_section_id = section.id::string
                            and add_step_mode = 'task')`}
                      >
                        <div className="px-2 py-1 bg-white">
                          <Button
                            size="sm"
                            variant="plain"
                            startIcon="Add"
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
                              s.setScalar("add_step_essay_prompt", sql.lit``);
                              s.setScalar(
                                "add_step_support_document_id",
                                sql`null`,
                              );
                            }}
                          >
                            Add task
                          </Button>
                        </div>
                      </Show>
                      <Show
                        when={sql`add_step_section_id = section.id::string
                            and add_step_mode = 'task'`}
                      >
                        <div className="bg-white px-4 py-3">
                          <Typography level="title-sm">
                            Add task or check
                          </Typography>
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <FormControl size="sm">
                              <FormLabel>Step type</FormLabel>
                              <Select
                                size="sm"
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
                              <FormControl size="sm">
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
                              <FormControl size="sm">
                                <FormLabel>Supporting file</FormLabel>
                                <CourseLibraryResourceSelect
                                  block={props.block}
                                  value={sql`add_step_support_document_id`}
                                  onChange={(s, value) =>
                                    s.setScalar(
                                      "add_step_support_document_id",
                                      value,
                                    )}
                                />
                                <Typography
                                  level="body-xs"
                                  className="text-neutral-600 mt-1"
                                >
                                  Upload videos, PDFs, or images to Company
                                  files, then choose them here. Videos play
                                  inside the course.
                                </Typography>
                              </FormControl>
                            </Show>
                            <FormControl size="sm" className="md:col-span-2">
                              <FormLabel>Task</FormLabel>
                              <Textarea
                                size="sm"
                                bindScalar="add_step_content"
                                minRows={2}
                                placeholder="Describe what the employee must do or answer"
                              />
                            </FormControl>
                            <Show
                              when={sql`add_step_requires_essay or add_step_type = 'essay'`}
                            >
                              <FormControl size="sm" className="md:col-span-2">
                                <FormLabel>Response prompt</FormLabel>
                                <Textarea
                                  size="sm"
                                  bindScalar="add_step_essay_prompt"
                                  minRows={2}
                                  placeholder="Prompt shown to the employee"
                                />
                              </FormControl>
                            </Show>
                          </div>
                          <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <Checkbox
                              size="sm"
                              checked={sql`add_step_requires_essay`}
                              label="Requires written response"
                              onCheckboxChange={(s) => {
                                s.setScalar(
                                  "add_step_requires_essay",
                                  sql`target_checked`,
                                );
                              }}
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="plain"
                                color="neutral"
                                onClick={(s) => {
                                  s.setScalar(
                                    "add_step_section_id",
                                    sql.lit``,
                                  );
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
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
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
                                        mapCourseSectionToDraftSql(
                                          sql`section.id`,
                                        )
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
                                          s.throwErrorIf(
                                            sql`not exists (select 1 from db.training_content_documents document
                                        where document.id = ui.add_step_support_document_id
                                          and document.is_active
                                          and ${
                                              props.block.opts.content
                                                .canReadDocument(
                                                  sql`document.id`,
                                                  sql`current_user`,
                                                )
                                            }
                                          and exists (select 1 from db.training_content_language_variants variant
                                            where variant.document_id = document.id and variant.current_document_version_id is not null))`,
                                            sql
                                              .lit`Choose an active, published library resource.`,
                                          );
                                          s.modify(sql`
                                          insert into db.training_course_section_item_documents
                                            (training_course_section_item_id,
                                             document_id, sort_order, label)
                                          select last_record_id(db.training_course_section_items),
                                                 d.id, 10, d.title
                                          from db.training_content_documents d
                                          where d.id = ui.add_step_support_document_id
                                            and ${
                                            props.block.opts.content
                                              .canReadDocument(
                                                sql`d.id`,
                                                sql`current_user`,
                                              )
                                          }
                                        `);
                                        },
                                      );
                                      s.commitTransaction();
                                      s.setScalar(
                                        "add_step_section_id",
                                        sql.lit``,
                                      );
                                      s.setScalar(
                                        "add_step_content",
                                        sql.lit``,
                                      );
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
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Each>
                </div>
                <div className="mt-4 rounded-md border border-dashed border-divider px-4 py-3">
                  <Typography level="title-sm">Add a section</Typography>
                  <div className="mt-2 flex flex-col md:flex-row md:items-end gap-2">
                    <FormControl size="sm" className="flex-1 min-w-0">
                      <FormLabel>Section name</FormLabel>
                      <Input
                        size="sm"
                        bindScalar="add_course_section_name"
                        placeholder="Company Policy"
                      />
                    </FormControl>
                    <FormControl size="sm" className="flex-1 min-w-0">
                      <FormLabel>Subtitle</FormLabel>
                      <Input
                        size="sm"
                        bindScalar="add_course_section_description"
                        placeholder="Policies and acknowledgements for this part"
                      />
                    </FormControl>
                    <Button
                      size="sm"
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
                  </div>
                  <Show
                    when={sql`exists (select 1 from course_section_templates)`}
                  >
                    <div className="mt-3 flex flex-col md:flex-row md:items-end gap-2">
                      <FormControl size="sm" className="flex-1 min-w-0">
                        <FormLabel>Or reuse a stored section</FormLabel>
                        <Select
                          size="sm"
                          aria-label="Or reuse a stored section"
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
                        size="sm"
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
                              s.throwErrorIf(
                                sql`exists (
                                select 1 from db.training_course_section_template_items
                                where training_course_section_template_id =
                                  ui.add_course_item_section_template_id::bigint
                                  and (type = 'external_link'
                                    or nullif(trim(external_url), '') is not null)
                              )`,
                                sql
                                  .lit`This stored section contains external links. Edit the stored section and replace those steps with uploaded files before adding it.`,
                              );
                              ensureCourseDraftVersion(s, {
                                block: props.block,
                                courseId,
                              });
                              s.modify(insertCourseSectionFromTemplateSql({
                                courseVersionId: sql`draft_course_version_id`,
                                templateId:
                                  sql`ui.add_course_item_section_template_id::bigint`,
                              }));
                              s.modify(
                                insertCourseSectionItemsFromTemplateSql({
                                  courseVersionId: sql`draft_course_version_id`,
                                  templateId:
                                    sql`ui.add_course_item_section_template_id::bigint`,
                                }),
                              );
                              s.modify(
                                insertCourseSectionItemDocumentsFromTemplateSql(
                                  {
                                    courseVersionId:
                                      sql`draft_course_version_id`,
                                    templateId:
                                      sql`ui.add_course_item_section_template_id::bigint`,
                                  },
                                ),
                              );
                              s.commitTransaction();
                              s.setScalar(
                                "add_course_item_section_template_id",
                                sql.lit``,
                              );
                              s.refetch();
                            },
                            errorName: "course_section_template_failure",
                            catch: (s) => {
                              s.setScalar(
                                "course_edit_error",
                                sql`coalesce(course_section_template_failure.message,
                                'Stored section could not be added to this course.')`,
                              );
                            },
                          });
                        }}
                      >
                        Append section steps
                      </Button>
                    </div>
                  </Show>
                </div>
              </div>
              <aside
                id="training-course-inspector"
                aria-label="Course inspector"
                className="xl:sticky xl:top-4 xl:w-80 xl:shrink-0"
              >
                <Show
                  when={sql`edit_course_task_open`}
                  fallback={
                    <section
                      aria-label="Course settings"
                      className="rounded-md border border-divider bg-white p-4"
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
                    </section>
                  }
                >
                  <section
                    aria-label="Edit task"
                    className="rounded-md border border-primary-300 bg-white p-4"
                  >
                    <Typography level="title-md">Edit task</Typography>
                    <Typography
                      level="body-sm"
                      className="text-neutral-600 mt-1 mb-4"
                    >
                      Save your changes, then publish the course when it is
                      ready.
                    </Typography>
                    <Data
                      watch={[sql`edit_course_task_id`]}
                      procedure={(s) =>
                        s.defRecord(
                          "edit_course_task_source",
                          sql`select task.id, task.content, task.external_title,
                           task.type, task.requires_essay, task.essay_prompt,
                           (select document_id
                            from db.training_course_section_item_documents
                            where training_course_section_item_id = task.id
                            order by sort_order, id limit 1) as document_id
                    from db.training_course_section_items task
                    join db.training_course_sections section
                      on section.id = task.training_course_section_id
                    join db.training_course_versions version
                      on version.id = section.training_course_version_id
                    where task.id = ui.edit_course_task_id
                      and version.training_course_id = ${courseId}`,
                        )}
                    >
                      <Form
                        watch={[sql`edit_course_task_source.id`]}
                        afterTransactionStart={(s) => {
                          s.throwErrorIf(
                            sql`not ${
                              currentUserHasPermission(
                                sql.lit(trainingPermissions.manageLibrary),
                              )
                            }`,
                            sql
                              .lit`You do not have permission to edit courses.`,
                          );
                          s.throwErrorIf(
                            sql`nullif(trim(ui.edit_course_task.content), '') is null`,
                            sql.lit`Enter the task before saving.`,
                          );
                          ensureCourseDraftVersion(s, {
                            block: props.block,
                            courseId,
                          });
                          s.defScalar(
                            "editable_task_id",
                            mapCourseItemToDraftSql(
                              sql`ui.edit_course_task_id`,
                            ),
                          );
                          s.throwErrorIf(
                            sql`editable_task_id is null`,
                            sql
                              .lit`This task has changed. Close the editor and refresh the course.`,
                          );
                          s.modify(sql`
                    update db.training_course_section_items
                    set content = trim(ui.edit_course_task.content),
                        external_title = nullif(trim(ui.edit_course_task.external_title), ''),
                        requires_essay = type = 'essay' or ui.edit_course_task.requires_essay,
                        essay_prompt = nullif(trim(ui.edit_course_task.essay_prompt), '')
                    where id = editable_task_id
                  `);
                          s.if(
                            sql`ui.edit_course_task.document_id is distinct from
                      ui.edit_course_task_source.document_id`,
                            (s) => {
                              s.throwErrorIf(
                                sql`ui.edit_course_task.document_id is not null
                          and not exists (
                            select 1 from db.training_content_documents document
                            where document.id = ui.edit_course_task.document_id
                              and ${
                                  props.block.opts.content.canReadDocument(
                                    sql`document.id`,
                                    sql`current_user`,
                                  )
                                }
                              and document.is_active
                              and exists (
                                select 1 from db.training_content_language_variants variant
                                where variant.document_id = document.id
                                  and variant.current_document_version_id is not null
                              )
                          )`,
                                sql
                                  .lit`Choose an active, published library resource.`,
                              );
                              s.modify(sql`
                        delete from db.training_course_section_item_documents
                        where training_course_section_item_id = editable_task_id
                      `);
                              s.modify(sql`
                        insert into db.training_course_section_item_documents
                          (training_course_section_item_id, document_id, sort_order)
                        select editable_task_id, ui.edit_course_task.document_id, 0
                        where ui.edit_course_task.document_id is not null
                      `);
                            },
                          );
                        }}
                        afterSubmitClientSuccess={(s) =>
                          s.setScalar("edit_course_task_open", sql`false`)}
                      >
                        <Form.Temporary name="edit_course_task">
                          <div className="grid grid-cols-1 gap-3">
                            <FormControl inputId={taskInputId}>
                              <FormLabel>Task</FormLabel>
                              <Form.Field
                                field="content"
                                fieldType={{ type: "String", maxLength: 255 }}
                                required
                                initialValue={sql`edit_course_task_source.content`}
                              >
                                {(field) => (
                                  <Textarea
                                    id={taskInputId}
                                    value={field.value}
                                    maxLength={255}
                                    minRows={2}
                                    onInput={(s) =>
                                      field.setValue(s, sql`target_value`)}
                                  />
                                )}
                              </Form.Field>
                            </FormControl>
                            <Show
                              when={sql`edit_course_task_source.external_title is not null`}
                            >
                              <FormControl inputId={taskTitleInputId}>
                                <FormLabel>Display title</FormLabel>
                                <Form.Field
                                  field="external_title"
                                  fieldType={{
                                    type: "String",
                                    maxLength: 255,
                                  }}
                                  initialValue={sql`edit_course_task_source.external_title`}
                                >
                                  {(field) => (
                                    <Input
                                      id={taskTitleInputId}
                                      value={field.value}
                                      maxLength={255}
                                      onInput={(s) =>
                                        field.setValue(s, sql`target_value`)}
                                    />
                                  )}
                                </Form.Field>
                              </FormControl>
                            </Show>
                            <Show
                              when={sql`edit_course_task_source.type != 'essay'`}
                            >
                              <Form.Field
                                field="requires_essay"
                                fieldType="Bool"
                                initialValue={sql`edit_course_task_source.requires_essay`}
                              >
                                {(field) => (
                                  <Checkbox
                                    checked={field.value}
                                    label="Requires written response"
                                    onCheckboxChange={(s) =>
                                      field.setValue(s, sql`target_checked`)}
                                  />
                                )}
                              </Form.Field>
                            </Show>
                            <Show
                              when={sql`edit_course_task.requires_essay or edit_course_task_source.type = 'essay'`}
                            >
                              <FormControl inputId={taskPromptInputId}>
                                <FormLabel>Response prompt</FormLabel>
                                <Form.Field
                                  field="essay_prompt"
                                  fieldType={{
                                    type: "String",
                                    maxLength: 1000,
                                  }}
                                  initialValue={sql`edit_course_task_source.essay_prompt`}
                                >
                                  {(field) => (
                                    <Textarea
                                      id={taskPromptInputId}
                                      value={field.value}
                                      maxLength={1000}
                                      minRows={2}
                                      onInput={(s) =>
                                        field.setValue(s, sql`target_value`)}
                                    />
                                  )}
                                </Form.Field>
                              </FormControl>
                            </Show>
                            <Show
                              when={sql`edit_course_task_source.type != 'signature'`}
                            >
                              <FormControl inputId={taskResourceInputId}>
                                <FormLabel>Supporting file</FormLabel>
                                <Form.Field
                                  field="document_id"
                                  fieldType="BigInt"
                                  initialValue={sql`edit_course_task_source.document_id`}
                                >
                                  {(field) => (
                                    <CourseLibraryResourceSelect
                                      block={props.block}
                                      id={taskResourceInputId}
                                      value={field.value}
                                      onChange={(s, value) =>
                                        field.setValue(s, value)}
                                    />
                                  )}
                                </Form.Field>
                              </FormControl>
                            </Show>
                            <Form.ErrorAlert mode="all" />
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="plain"
                                color="neutral"
                                onClick={(s) =>
                                  s.setScalar(
                                    "edit_course_task_open",
                                    sql`false`,
                                  )}
                              >
                                Cancel
                              </Button>
                              <Form.SubmitButton>Save task</Form.SubmitButton>
                            </div>
                          </div>
                        </Form.Temporary>
                      </Form>
                    </Data>
                  </section>
                </Show>
              </aside>
            </fieldset>
          </div>
        </Show>
      </Data>
    </div>
  );
}

/** Registers draft-aware course reordering shared by both movement directions. */
export function registerCourseEditorStoredProcedures() {
  // Keeps the discard-draft deletes out of the course editor route.
  system.storedProcedure({
    name: "training_discard_course_draft",
    transaction: "caller",
    inputScalars: [{ name: "p_draft_course_version_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorUnless(
        sql`${
          currentUserHasPermission(sql.lit(trainingPermissions.manageLibrary))
        } and exists (
        select 1 from db.training_course_versions where id = p_draft_course_version_id and status = 'draft')`,
        sql.lit`This draft is no longer editable. Refresh the page.`,
      );
      s.throwErrorIf(
        translationReviewLockedSql("course", sql`p_draft_course_version_id`),
        sql
          .lit`Withdraw the translation review before discarding these changes.`,
      );
      s.if(
        sql`${
          translationReviewIdSql("course", sql`p_draft_course_version_id`)
        } is not null`,
        (s) => {
          s.modify(
            sql`update db.training_course_versions set status = 'archived', archived_at = now() where id = p_draft_course_version_id`,
          );
          s.return();
        },
      );
      s.modify(sql`
                              delete from db.training_course_section_item_documents
                              where training_course_section_item_id in (
                                select item.id
                                from db.training_course_section_items item
                                join db.training_course_sections section
                                  on section.id = item.training_course_section_id
                                where section.training_course_version_id =
                                    p_draft_course_version_id
                              )
                            `);
      s.modify(sql`
                              delete from db.training_course_section_items
                              where training_course_section_id in (
                                select section.id
                                from db.training_course_sections section
                                where section.training_course_version_id =
                                  p_draft_course_version_id
                              )
                            `);
      s.modify(sql`
                              delete from db.training_course_sections
                              where training_course_version_id =
                                p_draft_course_version_id
                            `);
      s.modify(sql`
                              delete from db.training_course_versions
                              where id = p_draft_course_version_id
                                and status = 'draft'
                            `);
    },
  });
  system.storedProcedure({
    name: "training_move_course_section",
    transaction: "caller",
    inputScalars: [
      { name: "p_course_id", type: "BigInt" },
      { name: "p_record_id", type: "BigInt" },
      { name: "p_move_up", type: "Bool" },
    ],
    procedure: (s) => {
      s.callStoredProcedure("training_ensure_course_draft_language", {
        inputScalars: {
          p_course_id: sql`p_course_id`,
          p_language:
            sql`(select v.language from db.training_course_versions v join db.training_course_sections section on section.training_course_version_id = v.id where section.id = p_record_id)`,
          p_source_version: sql`null`,
        },
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
      s.callStoredProcedure("training_ensure_course_draft_language", {
        inputScalars: {
          p_course_id: sql`p_course_id`,
          p_language:
            sql`(select v.language from db.training_course_versions v join db.training_course_sections section on section.training_course_version_id = v.id join db.training_course_section_items item on item.training_course_section_id = section.id where item.id = p_record_id)`,
          p_source_version: sql`null`,
        },
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
