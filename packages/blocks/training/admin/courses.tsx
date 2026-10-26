import { Button } from "components/button";
import { currentUserHasPermission } from "blocks/auth";
import { Chip } from "components/chip";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { ActionMenuItem } from "std/action_button";
import { Form } from "std/form";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import { formatDateSql, trainingPermissions } from "../helpers";
import { courseDeletionBlockerSql } from "../course_lifecycle";
import { EmptyState, FormFieldWithLabel, PageShell } from "../shared";
import {
  adminCourseAssignHref,
  adminCourseHref,
  adminSectionTemplatesHref,
  adminSelectClass,
} from "./shared";

export function TrainingAdminCoursesPage(props: { block: TrainingBlock }) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_course_open", sql`false`);
        s.defScalar("course_search", sql.lit``);
        s.defScalar("course_type_filter", sql.lit`all`);
        s.defScalar("course_status_filter", sql.lit`active`);
        s.defScalar(
          "can_assign_training_courses",
          currentUserHasPermission(
            sql.lit(trainingPermissions.assignTraining),
          ),
        );
      }}
    >
      <TrainingCoursesWorkspace block={props.block} />
    </Data>
  );
}

export function TrainingCoursesWorkspace(props: { block: TrainingBlock }) {
  return (
    <PageShell
      title="Courses & programs"
      subtitle="Build the steps people complete, then assign each course to the people who need it."
      actions={
        <>
          <Button
            component="a"
            href={adminSectionTemplatesHref(props.block)}
            variant="outlined"
            color="neutral"
            startIcon="ViewAgenda"
          >
            Stored sections
          </Button>
          <Button
            startIcon="Add"
            onClick={(s) => s.setScalar("add_course_open", sql`true`)}
          >
            New course
          </Button>
        </>
      }
    >
      <div>
        <Data
          debounce={{ wait: 300 }}
          watch={[
            sql`course_search`,
            sql`course_type_filter`,
            sql`course_status_filter`,
          ]}
          procedure={(s) => {
            s.defTable(
              "courses",
              sql`select p.id, p.name, p.is_active,
                      exists (
                        select 1
                        from db.training_course_section_items i
                        join db.training_course_sections section
                          on section.id = i.training_course_section_id
                        where section.training_course_version_id =
                            p.current_training_course_version_id
                          and i.type = 'other_checklist'
                      ) as is_program,
                      (
                        select count(*)
                        from db.training_course_section_items i
                        join db.training_course_sections section
                          on section.id = i.training_course_section_id
                        where section.training_course_version_id =
                            p.current_training_course_version_id
                      ) as item_count,
                      (
                        select max(v.published_at)
                        from db.training_course_versions v
                        where v.training_course_id = p.id
                          and v.status = 'published'
                      ) as last_published_at,
                      (
                        select count(*)
                        from db.training_assignments a
                        where a.training_course_id = p.id
                          and a.status in
                            ('pending', 'in_progress', 'validation_pending')
                      ) as open_assignments
                     from db.training_courses p
                     where (ui.course_status_filter = 'all'
                       or p.is_active = (ui.course_status_filter = 'active'))
                       and (
                         nullif(trim(ui.course_search), '') is null
                         or lower(p.name) like
                           '%' || lower(trim(ui.course_search)) || '%'
                       )
                       and (
                         ui.course_type_filter = 'all'
                         or (ui.course_type_filter = 'program') = exists (
                           select 1
                           from db.training_course_section_items i
                           join db.training_course_sections section
                             on section.id = i.training_course_section_id
                           where section.training_course_version_id =
                               p.current_training_course_version_id
                             and i.type = 'other_checklist'
                         )
                       )
                     order by p.is_active desc, p.name`,
            );
          }}
        >
          <div>
            <div className="mb-3 flex flex-col md:flex-row md:items-end gap-3">
              <FormControl className="flex-1">
                <FormLabel>Search</FormLabel>
                <Input
                  value={sql`course_search`}
                  placeholder="Search courses and programs"
                  startIcon="Search"
                  onInput={(s) =>
                    s.setScalar("course_search", sql`target_value`)}
                />
              </FormControl>
              <FormControl>
                <FormLabel>Type</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`course_type_filter`}
                  onInput={(s) =>
                    s.setScalar("course_type_filter", sql`target_value`)}
                >
                  <Select.Option value="all">All types</Select.Option>
                  <Select.Option value="course">Courses</Select.Option>
                  <Select.Option value="program">Programs</Select.Option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Status</FormLabel>
                <Select
                  aria-label="Status"
                  className={adminSelectClass}
                  value={sql`course_status_filter`}
                  onInput={(s) =>
                    s.setScalar("course_status_filter", sql`target_value`)}
                >
                  <Select.Option value="active">Active</Select.Option>
                  <Select.Option value="archived">Archived</Select.Option>
                  <Select.Option value="all">All courses</Select.Option>
                </Select>
              </FormControl>
            </div>
            <Show
              when={sql`not exists (select 1 from courses)
                  and nullif(trim(course_search), '') is null
                  and course_type_filter = 'all'
                  and course_status_filter = 'active'`}
            >
              <EmptyState
                icon="Inventory2"
                title="No active courses"
                body="Create a course or choose Archived to restore an existing one."
              />
            </Show>
            <Show
              when={sql`not exists (select 1 from courses)
                  and (nullif(trim(course_search), '') is not null
                    or course_type_filter != 'all'
                    or course_status_filter != 'active')`}
            >
              <EmptyState
                icon="ManageSearch"
                title="No matches"
                body="No course or program matches the current search and filters."
              />
            </Show>
            <div
              className="bg-white border border-divider rounded-md overflow-hidden"
              dynamicClassNames={[{
                condition: sql`not exists (select 1 from courses)`,
                classNames: "hidden",
              }]}
            >
              <Each table="courses" recordName="course">
                <div className="w-full p-4 border-b border-divider last:border-b-0 hover:bg-neutral-50 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <button
                      type="button"
                      className="text-left flex-1 min-w-0"
                      onClick={(s) =>
                        s.navigate(
                          adminCourseHref(props.block, sql`course.id`),
                        )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography level="title-sm">
                          {sql`course.name`}
                        </Typography>
                        <Chip size="sm" variant="soft" color="neutral">
                          {sql`case when course.is_program then 'Program' else 'Course' end`}
                        </Chip>
                        <Show when={sql`not course.is_active`}>
                          <Chip size="sm" variant="soft" color="warning">
                            Archived
                          </Chip>
                        </Show>
                      </div>
                      <Typography
                        level="body-sm"
                        className="text-neutral-600 mt-1"
                      >
                        {sql`course.item_count::string ||
                          case when course.item_count = 1
                            then ' item' else ' items' end ||
                          coalesce(' · Published ' || ${
                          formatDateSql(sql`course.last_published_at`)
                        }, ' · Never published') ||
                          ' · ' || course.open_assignments::string ||
                          case when course.open_assignments = 1
                            then ' open assignment'
                            else ' open assignments' end`}
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
                            adminCourseHref(props.block, sql`course.id`),
                          )}
                      >
                        Edit
                      </Button>
                      <Show
                        when={sql`can_assign_training_courses and course.is_active`}
                      >
                        <Button
                          size="sm"
                          variant="soft"
                          startIcon="AssignmentInd"
                          onClick={(s) =>
                            s.navigate(
                              adminCourseAssignHref(
                                props.block,
                                sql`course.id`,
                              ),
                            )}
                        >
                          Assign
                        </Button>
                      </Show>
                      <Menu>
                        <Menu.IconButton
                          icon="MoreVert"
                          aria-label={sql`'Actions for ' || course.name`}
                          size="sm"
                          variant="plain"
                          color="neutral"
                        />
                        <Menu.Content>
                          {[true, false].map((active) => (
                            <Show
                              when={sql`course.is_active = ${
                                active ? sql`true` : sql`false`
                              }`}
                            >
                              <ActionMenuItem
                                icon={active ? "Archive" : "Unarchive"}
                                successMessage={active
                                  ? "Course archived"
                                  : "Course restored"}
                                action={(s) =>
                                  s.callStoredProcedure(
                                    "training_set_course_active",
                                    {
                                      inputScalars: {
                                        p_course_id: sql`course.id`,
                                        p_is_active: active
                                          ? sql`false`
                                          : sql`true`,
                                      },
                                    },
                                  )}
                              >
                                {active ? "Archive course" : "Restore course"}
                              </ActionMenuItem>
                            </Show>
                          ))}
                          <ActionMenuItem
                            icon="DeleteOutline"
                            successMessage="Course deleted"
                            confirm={{
                              confirmText: "Delete course",
                              prepare: (s) =>
                                s.defScalar(
                                  "course_delete_blocker",
                                  courseDeletionBlockerSql(
                                    props.block.opts,
                                    sql`course.id`,
                                  ),
                                ),
                              disabled: sql`course_delete_blocker is not null`,
                              description: (
                                <Typography>
                                  {sql`coalesce(course_delete_blocker,
                                    'Permanently delete "' || course.name || '" and all its versions, steps, and assignment rules? Supporting files and assessments will be kept. This cannot be undone.')`}
                                </Typography>
                              ),
                            }}
                            action={(s) =>
                              s.callStoredProcedure("training_delete_course", {
                                inputScalars: { p_course_id: sql`course.id` },
                              })}
                          >
                            Delete course
                          </ActionMenuItem>
                        </Menu.Content>
                      </Menu>
                    </div>
                  </div>
                </div>
              </Each>
            </div>
          </div>
        </Data>
        <ModalDialog bindScalar="add_course_open" maxWidth="lg">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Typography level="title-lg" startIcon="Inventory2">
                Add Course
              </Typography>
              <Typography level="body-sm" className="text-neutral-600 mt-1">
                Name the course — you will add its steps right after. It will
                appear as a program when it contains nested courses.
              </Typography>
            </div>
            <IconButton
              icon="Close"
              aria-label="Close"
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("add_course_open", sql`false`)}
            />
          </div>
          <Form
            defaultFieldComponent={FieldFormControl}
            beforeTransactionCommit={(s) => {
              s.defScalar(
                "new_course_id",
                sql`last_record_id(db.training_courses)`,
              );
            }}
            afterTransactionCommit={(s) => {
              s.navigate(adminCourseHref(props.block, sql`new_course_id`));
            }}
            afterSubmitClientSuccess={(s, ctx) => {
              ctx.reset(s);
              s.setScalar("add_course_open", sql`false`);
            }}
          >
            <Form.Insert table="training_courses">
              <div className="grid gap-3">
                <FormFieldWithLabel
                  field="name"
                  label="Name"
                  placeholder="Shop Onboarding"
                />
                <FormFieldWithLabel
                  field="description"
                  label="Purpose"
                  minRows={2}
                  placeholder="Who receives this course and when"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="plain"
                    color="neutral"
                    onClick={(s) => s.setScalar("add_course_open", sql`false`)}
                  >
                    Cancel
                  </Button>
                  <Form.SubmitButton startIcon="Add">
                    Create and add steps
                  </Form.SubmitButton>
                </div>
              </div>
            </Form.Insert>
          </Form>
        </ModalDialog>
      </div>
    </PageShell>
  );
}
