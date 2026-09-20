import {
  logPipelineTaskCreatedProcedureName,
  togglePipelineTaskProcedureName,
} from "../pipeline/stored_procedures";
import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { EachSelect } from "components/each_select";
import { IconButton } from "components/icon_button";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { RecordPage } from "pages/record_page";
import { singularize } from "std/inflectors";
import { type Sql, sql } from "std/sql_utils";
import type { NumericExpr } from "std/sql_utils";
import { system } from "std/system";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { Each, Route, Show } from "std/ui";
import { Form } from "std/form";
import { currentUserHasPermission } from "blocks/auth";
import { CrmBlock } from "../index";
import { ScoreAssessmentForm } from "../score_assessment";
import { TaskItemDisplay } from "../pipeline/task_item_display";

interface ProjectListPageProps {
  path?: string;
  onRowClick?: (recordId: NumericExpr) => void;
  toolbarRight?: Node;
}

/**
 * Datagrid-based list page for the CRM `projects` table. Requires the
 * {@link CrmBlock} to be configured with `projects: true`.
 */
export function ProjectListPage(props: ProjectListPageProps) {
  const block = system.block(CrmBlock);

  if (!block.hasProjectsEnabled()) {
    return null;
  }

  const projectsTable = block.projectsTableName;
  const orgsTable = block.organizationsTableName;
  const path = props.path ?? block.routes.projectsListPath;

  return (
    <Route path={path}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <MaterialIcon icon="Folder" className="text-2xl text-primary-500" />
            <Typography level="h3">Projects</Typography>
          </div>
          <div className="flex items-center gap-2">
            {props.toolbarRight}
            <Button
              variant="soft"
              color="primary"
              startIcon="Add"
              href={block.routes.projectNewPath}
            >
              New Project
            </Button>
          </div>
        </div>

        <Data
          procedure={(s) => {
            s.defTable(
              "projects",
              sql`
                select
                  p.*,
                  o.name as organization_name
                from db.${sql.ref(projectsTable)} p
                left join db.${sql.ref(orgsTable)} o on o.id = p.organization_id
                order by p.created_at desc
              `,
            );
          }}
        >
          <div className="grid gap-4">
            <Each table="projects" recordName="project">
              <Card
                variant="outlined"
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={(s) => {
                  if (props.onRowClick) {
                    props.onRowClick(sql`project.id`);
                  } else {
                    s.navigate(block.projectHref(sql`project.id`));
                  }
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Typography level="title-md">
                        {sql`project.name`}
                      </Typography>
                      <ProjectPhaseChip phase={sql`project.phase`} />
                    </div>
                    <Show when={sql`project.organization_name is not null`}>
                      <Typography
                        level="body-sm"
                        className="text-tertiary mb-2"
                      >
                        <MaterialIcon
                          icon="Business"
                          className="text-sm mr-1"
                        />
                        {sql`project.organization_name`}
                      </Typography>
                    </Show>
                    <div className="flex items-center gap-4 text-sm text-tertiary">
                      <Show when={sql`project.start_date is not null`}>
                        <span>
                          <MaterialIcon icon="Event" className="text-sm mr-1" />
                          Started{" "}
                          {sql`format.date(project.start_date, '%b %d, %Y')`}
                        </span>
                      </Show>
                      {block.hasAdoptionTrackingEnabled() && (
                        <Show when={sql`project.adoption_score is not null`}>
                          <span>
                            <MaterialIcon
                              icon="Speed"
                              className="text-sm mr-1"
                            />
                            Adoption: {sql`project.adoption_score`}%
                          </span>
                        </Show>
                      )}
                    </div>
                  </div>
                  <IconButton
                    variant="plain"
                    color="neutral"
                    onClick={(s) => {
                      s.event.stopPropagation();
                      s.navigate(block.projectHref(sql`project.id`));
                    }}
                  >
                    <MaterialIcon icon="ChevronRight" />
                  </IconButton>
                </div>
              </Card>
            </Each>
          </div>
        </Data>
      </div>
    </Route>
  );
}

// ==================== Project Detail Page ====================

interface ProjectDetailPageProps {
  path?: string;
}

/**
 * Detail page for a single project: project metadata, linked
 * organization, tasks, files, and activity timeline.
 */
export function ProjectDetailPage(props: ProjectDetailPageProps) {
  const block = system.block(CrmBlock);

  if (!block.hasProjectsEnabled()) {
    return null;
  }

  const projectsTable = block.projectsTableName;
  const path = props.path ?? block.routes.projectDetailPath;

  return (
    <RecordPage table={projectsTable} path={path}>
      <div className="container mx-auto p-6 max-w-4xl">
        <ProjectDetailContent block={block} />
      </div>
    </RecordPage>
  );
}

function ProjectDetailContent(props: { block: CrmBlock }) {
  const { block } = props;
  const projectsTable = block.projectsTableName;
  const orgsTable = block.organizationsTableName;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", 0);
        s.defScalar("edit_mode", false);
      }}
    >
      <Data
        procedure={(s) => {
          s.defRecord(
            "project",
            sql`
              select
                p.*,
                o.name as organization_name
              from db.${sql.ref(projectsTable)} p
              left join db.${sql.ref(orgsTable)} o on o.id = p.organization_id
              where p.id = ui.record_id
            `,
          );
          s.defScalar(
            "project_supports_tasks",
            block.pipelines.some((p) => block.hasPipelineTasksEnabled(p.name))
              ? block.pipelineItemSupportsTasks(sql`project.pipeline_item_id`)
              : sql`false`,
          );
        }}
        watch={[sql`refresh_key`]}
      >
        <Show when={sql`project.organization_id is not null`}>
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            startIcon="ArrowBack"
            onClick={(s) => {
              s.navigate(
                block.organizationHref(sql`project.organization_id`),
              );
            }}
            className="mb-2"
          >
            {sql`project.organization_name`}
          </Button>
        </Show>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <MaterialIcon icon="Folder" className="text-3xl text-primary-500" />
            <div>
              <Typography level="h3">{sql`project.name`}</Typography>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ProjectPhaseChip phase={sql`project.phase`} />
            <Button
              variant="outlined"
              color="neutral"
              startIcon="Edit"
              onClick={(s) => {
                s.setScalar("edit_mode", sql`not edit_mode`);
              }}
            >
              {sql`case when edit_mode then 'Cancel' else 'Edit' end`}
            </Button>
          </div>
        </div>

        <Show when={sql`edit_mode`}>
          <div className="grid gap-6">
            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="Edit" className="mr-2" />
                Edit Project
              </CardHeader>
              <div className="space-y-4 mt-4">
                <Form
                  defaultFieldComponent={LabelOnTopFormField}
                  afterTransactionCommit={(s) => {
                    s.increment("refresh_key");
                  }}
                  afterSubmitClientSuccess={(s) => {
                    s.setScalar("edit_mode", false);
                  }}
                >
                  <Form.Update
                    table={projectsTable}
                    where={sql`id = ui.record_id`}
                    setFields={{ last_modified_at: sql`now()` }}
                  >
                    <Form.Field field="name" />
                    {block.pipelines.length > 0 && (
                      <Form.Field field="pipeline_item_id" />
                    )}
                    <Form.Field field="start_date" />
                    <Form.Field field="phase" />
                    <Form.Field field="risks_issues" />
                    {block.hasAdoptionTrackingEnabled() && (
                      <>
                        <Form.Field field="usage_metrics" />
                        <Form.Field field="training_completion" />
                        <Form.Field field="champion_engagement" />
                        <Form.Field field="support_tickets" />
                      </>
                    )}
                    <Form.ErrorAlert className="mt-3" mode="all" />
                    <div className="flex justify-end gap-2 pt-4">
                      <Form.SubmitButton>Save</Form.SubmitButton>
                    </div>
                  </Form.Update>
                </Form>
              </div>
            </Card>
          </div>
        </Show>

        <Show when={sql`not edit_mode`}>
          <div className="grid gap-6">
            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="Info" className="mr-2" />
                Overview
              </CardHeader>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    Start Date
                  </Typography>
                  <Typography level="body-md">
                    {sql`coalesce(format.date(project.start_date, '%b %d, %Y'), 'Not set')`}
                  </Typography>
                </div>
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    Phase
                  </Typography>
                  <Typography level="body-md">
                    {sql`project.phase`}
                  </Typography>
                </div>
                {block.hasAdoptionTrackingEnabled() && (
                  <div>
                    <Typography level="body-xs" className="text-tertiary">
                      Adoption Score
                    </Typography>
                    <Typography level="body-md">
                      {sql`coalesce(cast(project.adoption_score as string) || '%', 'Not assessed')`}
                    </Typography>
                  </div>
                )}
              </div>
            </Card>

            {block.hasAdoptionTrackingEnabled() && (
              <ScoreAssessmentForm
                table={projectsTable}
                recordId={sql`ui.record_id`}
                score={sql`project.adoption_score`}
                assessedAt={sql`project.adoption_score_calculated_at`}
                title="Adoption assessment"
                editPermission="edit_projects"
              />
            )}
            {block.pipelines.some((p) =>
              block.hasPipelineTasksEnabled(p.name)
            ) && <ProjectTasksCard block={block} />}

            {block.hasRaciEnabled() && <RaciMatrixCard block={block} />}

            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="Warning" className="mr-2" />
                Risks & Issues
              </CardHeader>
              <div className="mt-4">
                <Show
                  when={sql`project.risks_issues is not null and project.risks_issues != ''`}
                  fallback={
                    <Typography level="body-sm" className="text-tertiary">
                      No risks or issues documented
                    </Typography>
                  }
                >
                  <Typography level="body-sm" className="whitespace-pre-wrap">
                    {sql`project.risks_issues`}
                  </Typography>
                </Show>
              </div>
            </Card>
          </div>
        </Show>
      </Data>
    </Data>
  );
}

function ProjectPhaseChip(props: { phase: Sql }) {
  const block = system.block(CrmBlock);
  const phases = block.projectPhases;

  return (
    <Chip
      size="sm"
      variant="soft"
      style={{
        backgroundColor: sql.caseWhen({
          conditions: phases.map((p) => ({
            condition: sql`${props.phase} = ${sql.lit(p.name)}`,
            expr: sql.lit`${(p.color ?? "#6B7280")}30`,
          })),
          default: sql.lit`#6B728030`,
        }),
        color: sql.caseWhen({
          conditions: phases.map((p) => ({
            condition: sql`${props.phase} = ${sql.lit(p.name)}`,
            expr: sql.lit`${p.color ?? "#6B7280"}`,
          })),
          default: sql.lit`#6B7280`,
        }),
      }}
    >
      {props.phase}
    </Chip>
  );
}

interface ProjectFormProps {
  path?: string;
}

/**
 * Create-project page. Renders the project form pre-bound to the
 * `projects` table and redirects to the detail page on submit.
 */
export function ProjectNewPage(props: ProjectFormProps) {
  const block = system.block(CrmBlock);

  if (!block.hasProjectsEnabled()) {
    return null;
  }

  const projectsTable = block.projectsTableName;
  const orgsTable = block.organizationsTableName;
  const path = props.path ?? block.routes.projectNewPath;

  return (
    <Route path={path}>
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <MaterialIcon icon="Add" className="text-3xl text-primary-500" />
          <Typography level="h3">New Project</Typography>
        </div>

        <Card variant="outlined" className="p-6">
          <Form
            defaultFieldComponent={LabelOnTopFormField}
            beforeTransactionCommit={(s) => {
              s.defScalar(
                "new_id",
                sql`last_record_id(${sql.ref(projectsTable)})`,
              );
            }}
            afterTransactionCommit={(s) => {
              s.navigate(block.projectHref(sql`new_id`));
            }}
          >
            <Form.Insert
              table={projectsTable}
              values={{ created_by: sql`current_user` }}
            >
              <div className="space-y-4">
                <Form.Field field="name" />
                <Form.Field field="organization_id">
                  {(helper) => (
                    <Data
                      procedure={(s) => {
                        s.defTable(
                          "orgs",
                          sql`select id, name from db.${
                            sql.ref(orgsTable)
                          } order by name`,
                        );
                      }}
                    >
                      <EachSelect
                        table="orgs"
                        value={helper.value}
                        onChange={(s, recordId) => helper.setValue(s, recordId)}
                        placeholder="Select organization..."
                        size="md"
                        className="bg-neutral-100 "
                        optionLabel="name"
                        optionValue="id"
                      />
                    </Data>
                  )}
                </Form.Field>
                {block.pipelines.length > 0 && (
                  <Form.Field field="pipeline_item_id" />
                )}
                <Form.Field field="start_date" />
                <Form.Field
                  field="phase"
                  initialValue={sql.lit(block.projectPhases[0].name)}
                />
                <Form.Field field="risks_issues" />
                {block.hasAdoptionTrackingEnabled() && (
                  <>
                    <Form.Field field="usage_metrics" />
                    <Form.Field field="training_completion" />
                    <Form.Field field="champion_engagement" />
                    <Form.Field field="support_tickets" />
                  </>
                )}
                <Form.ErrorAlert className="mt-3" mode="all" />
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outlined"
                    color="neutral"
                    href={block.routes.organizationsListPath}
                  >
                    Cancel
                  </Button>
                  <Form.SubmitButton
                    variant="solid"
                    color="primary"
                  >
                    Create Project
                  </Form.SubmitButton>
                </div>
              </div>
            </Form.Insert>
          </Form>
        </Card>
      </div>
    </Route>
  );
}

function ProjectTasksCard(props: { block: CrmBlock }) {
  const { block } = props;
  const tasksTable = block.pipelineTasksTableName;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("tasks_refresh_key", 0);
      }}
    >
      <Card variant="outlined" className="p-4">
        <CardHeader>
          <MaterialIcon icon="Task" className="mr-2" />
          Tasks
        </CardHeader>

        <Show
          when={sql`project_supports_tasks`}
          fallback={
            <div className="mt-4 text-center py-6">
              <MaterialIcon
                icon="LinkOff"
                className="text-3xl text-neutral-300 mb-2"
              />
              <Typography level="body-sm" className="text-tertiary">
                Link a pipeline item with tasks enabled to manage tasks.
              </Typography>
            </div>
          }
        >
          <Data
            procedure={(s) => {
              s.defTable(
                "project_tasks",
                sql`
                  select t.*
                  from db.${sql.ref(tasksTable)} t
                  where t.pipeline_item_id = project.pipeline_item_id
                  order by t.completed asc, t.due_date asc nulls last, t.created_at desc
                `,
              );
              s.defScalar("show_add_form", false);
            }}
            watch={[sql`tasks_refresh_key`]}
          >
            <div className="mt-4 space-y-2">
              <Show when={sql`(select count(*) from project_tasks) = 0`}>
                <div className="text-center py-6 text-tertiary">
                  <MaterialIcon
                    icon="TaskAlt"
                    className="text-3xl mb-2 opacity-50"
                  />
                  <Typography level="body-sm">No tasks yet</Typography>
                </div>
              </Show>
              <Each table="project_tasks" recordName="task">
                <ProjectTaskItem block={block} />
              </Each>
            </div>

            <Show
              when={sql`show_add_form`}
              fallback={
                <Button
                  size="sm"
                  variant="soft"
                  color="primary"
                  startIcon="Add"
                  className="mt-4"
                  onClick={(s) => s.setScalar("show_add_form", true)}
                >
                  Add Task
                </Button>
              }
            >
              <div className="mt-4 p-4 bg-level1 rounded-lg">
                <Typography level="title-sm" className="mb-3">
                  Add New Task
                </Typography>
                <Form
                  defaultFieldComponent={LabelOnTopFormField}
                  beforeTransactionCommit={(s) => {
                    const formRecord = `ui.write_${singularize(tasksTable)}`;
                    s.callStoredProcedure(
                      logPipelineTaskCreatedProcedureName(block),
                      {
                        inputScalars: {
                          p_item_id: sql`project.pipeline_item_id`,
                          p_title: sql`${sql.ref(formRecord)}.title`,
                        },
                      },
                    );
                  }}
                  afterTransactionCommit={(s) => {
                    s.increment("tasks_refresh_key");
                  }}
                  afterSubmitClientSuccess={(s, ctx) => {
                    s.setScalar("show_add_form", false);
                    ctx.reset(s);
                  }}
                >
                  <Form.Insert
                    table={tasksTable}
                    values={{
                      pipeline_item_id: sql`project.pipeline_item_id`,
                      created_by: sql`current_user`,
                    }}
                  >
                    <div className="space-y-3">
                      <Form.Field field="title" />
                      <Form.Field field="description" />
                      <div className="grid grid-cols-2 gap-3">
                        <Form.Field field="due_date" />
                        <Form.Field
                          field="priority"
                          initialValue={sql.lit`medium`}
                        />
                      </div>
                    </div>
                    <Form.ErrorAlert className="mt-3" mode="all" />
                    <div className="flex justify-end gap-2 mt-4">
                      <Button
                        variant="plain"
                        color="neutral"
                        size="sm"
                        onClick={(s) => s.setScalar("show_add_form", false)}
                      >
                        Cancel
                      </Button>
                      <Form.SubmitButton
                        variant="solid"
                        color="primary"
                        size="sm"
                      >
                        Add Task
                      </Form.SubmitButton>
                    </div>
                  </Form.Insert>
                </Form>
              </div>
            </Show>
          </Data>
        </Show>
      </Card>
    </Data>
  );
}

function ProjectTaskItem(props: { block: CrmBlock }) {
  const { block } = props;
  const tasksTable = block.pipelineTasksTableName;

  return (
    <TaskItemDisplay
      recordName="task"
      showAssigned={false}
      onToggleComplete={(s) => {
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.callStoredProcedure(togglePipelineTaskProcedureName(block), {
              inputScalars: { p_task_id: sql`task.id` },
            });
            s.commitTransaction();
            s.increment("tasks_refresh_key");
          },
        });
      }}
      onDelete={(s) => {
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.modify(
              sql`delete from db.${sql.ref(tasksTable)} where id = task.id`,
            );
            s.commitTransaction();
            s.increment("tasks_refresh_key");
          },
        });
      }}
    />
  );
}

function RaciMatrixCard(props: { block: CrmBlock }) {
  const { block } = props;
  const tasksTable = block.pipelineTasksTableName;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("raci_refresh_key", 0);
        s.defScalar("raci_edit_mode", false);
      }}
    >
      <Card variant="outlined" className="p-4">
        <div className="flex items-center justify-between">
          <CardHeader>
            <MaterialIcon icon="People" className="mr-2" />
            RACI Matrix
          </CardHeader>
          <Show
            when={sql`project_supports_tasks`}
          >
            <Show when={sql`not raci_edit_mode`}>
              <Button
                size="sm"
                variant="plain"
                color="primary"
                startIcon="Edit"
                onClick={(s) => s.setScalar("raci_edit_mode", true)}
              >
                Edit
              </Button>
            </Show>
            <Show when={sql`raci_edit_mode`}>
              <Button
                size="sm"
                variant="plain"
                color="primary"
                startIcon="Close"
                onClick={(s) => s.setScalar("raci_edit_mode", false)}
              >
                Done
              </Button>
            </Show>
          </Show>
        </div>

        <Show
          when={sql`project_supports_tasks`}
          fallback={
            <div className="mt-4 text-center py-4">
              <Typography level="body-sm" className="text-tertiary">
                Link a pipeline item with tasks enabled to define RACI
                assignments.
              </Typography>
            </div>
          }
        >
          <Data
            procedure={(s) => {
              s.defTable(
                "raci_tasks",
                sql`
                  select t.id, t.title, t.completed
                  from db.${sql.ref(tasksTable)} t
                  where t.pipeline_item_id = project.pipeline_item_id
                  order by t.completed asc, t.due_date asc nulls last, t.created_at desc
                `,
              );
              s.defTable(
                "raci_entries",
                sql`
                  select
                    r.id,
                    r.pipeline_task_id,
                    r.role,
                    r.user_id,
                    u.display_name_virtual as user_name
                  from db.crm_project_raci r
                  join db.sys_users u on u.id = r.user_id
                  where r.project_id = ui.record_id
                    and r.pipeline_task_id is not null
                  order by r.role, user_name
                `,
              );
            }}
            watch={[sql`raci_refresh_key`]}
          >
            <Show
              when={sql`(select count(*) from raci_tasks) > 0`}
              fallback={
                <div className="mt-4 text-center py-4">
                  <Typography level="body-sm" className="text-tertiary">
                    Add tasks first to define RACI assignments.
                  </Typography>
                </div>
              }
            >
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-divider">
                      <th className="text-left py-2 pr-4 min-w-[200px]">
                        <Typography
                          level="body-xs"
                          className="text-tertiary font-semibold"
                        >
                          Task
                        </Typography>
                      </th>
                      <th className="text-left py-2 px-3 min-w-[140px]">
                        <Typography
                          level="body-xs"
                          className="font-semibold"
                          style={{ color: "#3B82F6" }}
                        >
                          Responsible
                        </Typography>
                      </th>
                      <th className="text-left py-2 px-3 min-w-[140px]">
                        <Typography
                          level="body-xs"
                          className="font-semibold"
                          style={{ color: "#8B5CF6" }}
                        >
                          Accountable
                        </Typography>
                      </th>
                      <th className="text-left py-2 px-3 min-w-[140px]">
                        <Typography
                          level="body-xs"
                          className="font-semibold"
                          style={{ color: "#10B981" }}
                        >
                          Consulted
                        </Typography>
                      </th>
                      <th className="text-left py-2 px-3 min-w-[140px]">
                        <Typography
                          level="body-xs"
                          className="font-semibold"
                          style={{ color: "#6B7280" }}
                        >
                          Informed
                        </Typography>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <Each table="raci_tasks" recordName="task">
                      <tr className="border-b border-divider last:border-b-0">
                        <td className="py-2 pr-4">
                          <Typography
                            level="body-sm"
                            style={{
                              textDecoration:
                                sql`case when task.completed then 'line-through' else 'none' end`,
                              opacity:
                                sql`case when task.completed then 0.6 else 1 end`,
                            }}
                          >
                            {sql`task.title`}
                          </Typography>
                        </td>
                        <RaciMatrixCell role="responsible" />
                        <RaciMatrixCell role="accountable" />
                        <RaciMatrixCell role="consulted" />
                        <RaciMatrixCell role="informed" />
                      </tr>
                    </Each>
                  </tbody>
                </table>
              </div>
            </Show>
          </Data>
        </Show>
      </Card>
    </Data>
  );
}

function RaciMatrixCell(props: { role: string }) {
  const { role } = props;

  return (
    <td className="py-2 px-3 align-top">
      <Show when={sql`not raci_edit_mode`}>
        <div className="space-y-1">
          <Each
            table="raci_entries"
            recordName="raci_entry"
            where={sql`raci_entry.pipeline_task_id = task.id and raci_entry.role = ${
              sql.lit(role)
            }`}
          >
            <Typography level="body-xs">{sql`raci_entry.user_name`}</Typography>
          </Each>
          <Show
            when={sql`(select count(*) from raci_entries re where re.pipeline_task_id = task.id and re.role = ${
              sql.lit(role)
            }) = 0`}
          >
            <Typography level="body-xs" className="text-tertiary">
              -
            </Typography>
          </Show>
        </div>
      </Show>
      <Show when={sql`raci_edit_mode`}>
        <div className="space-y-1">
          <Each
            table="raci_entries"
            recordName="raci_entry"
            where={sql`raci_entry.pipeline_task_id = task.id and raci_entry.role = ${
              sql.lit(role)
            }`}
          >
            <div className="flex items-center gap-1">
              <Typography level="body-xs" className="flex-1">
                {sql`raci_entry.user_name`}
              </Typography>
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={(s) => {
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      s.modify(
                        sql`delete from db.crm_project_raci where id = raci_entry.id`,
                      );
                      s.commitTransaction();
                      s.increment("raci_refresh_key");
                    },
                  });
                }}
              >
                <MaterialIcon icon="Close" />
              </IconButton>
            </div>
          </Each>
          <RaciCellAddUser role={role} />
        </div>
      </Show>
    </td>
  );
}

function RaciCellAddUser(props: { role: string }) {
  const { role } = props;

  return (
    <Data
      procedure={(s) => {
        s.defScalar("adding_raci", false);
        s.defScalar("raci_selected_user_id", { type: "BigInt" });
        s.defTable(
          "raci_available_users",
          sql`
            select sys_users.id, sys_users.display_name_virtual as name
            from db.sys_users
            where sys_users.id not in (
              select user_id from db.crm_project_raci
              where project_id = ui.record_id
                and pipeline_task_id = task.id
                and role = ${sql.lit(role)}
            )
            order by name, sys_users.id
          `,
        );
      }}
      watch={[sql`raci_refresh_key`]}
    >
      <Show when={sql`not adding_raci`}>
        <Button
          size="sm"
          variant="plain"
          color="primary"
          startIcon="Add"
          onClick={(s) => s.setScalar("adding_raci", true)}
        >
          Add
        </Button>
      </Show>
      <Show when={sql`adding_raci`}>
        <div className="space-y-1">
          <EachSelect
            table="raci_available_users"
            value={sql`raci_selected_user_id`}
            onChange={(s, recordId) =>
              s.setScalar("raci_selected_user_id", recordId)}
            placeholder="Select..."
            size="sm"
            optionLabel="name"
            optionValue="id"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="solid"
              color="primary"
              disabled={sql`raci_selected_user_id is null`}
              onClick={(s) => {
                s.tryServer({
                  body: (s) => {
                    s.startTransaction();
                    s.modify(sql`
                      insert into db.crm_project_raci (project_id, pipeline_task_id, user_id, role)
                      values (ui.record_id, task.id, ui.raci_selected_user_id, ${
                      sql.lit(role)
                    })
                    `);
                    s.commitTransaction();
                    s.setScalar("adding_raci", false);
                    s.setScalar("raci_selected_user_id", sql`null`);
                    s.increment("raci_refresh_key");
                  },
                });
              }}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              onClick={(s) => {
                s.setScalar("adding_raci", false);
                s.setScalar("raci_selected_user_id", sql`null`);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Show>
    </Data>
  );
}

// ==================== Organization Tab ====================

interface ProjectOrganizationTabProps {
  editPermission?: string;
  newProjectHref?: string;
}

/**
 * Tab content rendered inside an organization detail page that lists
 * projects belonging to that organization.
 */
export function ProjectOrganizationTab(props: ProjectOrganizationTabProps) {
  const block = system.block(CrmBlock);

  if (!block.hasProjectsEnabled()) {
    return null;
  }

  const projectsTable = block.projectsTableName;
  const editPermission = props.editPermission ?? "edit_projects";
  const newProjectHref = props.newProjectHref ?? block.routes.projectNewPath;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(
          "can_edit_projects",
          currentUserHasPermission(sql.lit(editPermission)),
        );
      }}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <Typography level="title-lg">Projects</Typography>
          <Show when={sql`can_edit_projects`}>
            <Button
              variant="soft"
              color="primary"
              startIcon="Add"
              href={newProjectHref}
            >
              New Project
            </Button>
          </Show>
        </div>

        <Data
          procedure={(s) => {
            s.defTable(
              "projects",
              sql`
              select p.*
              from db.${sql.ref(projectsTable)} p
              where p.organization_id = record_id
              order by p.created_at desc
            `,
            );
          }}
        >
          <Show
            when={sql`(select count(*) from projects) > 0`}
            fallback={
              <Card variant="soft" className="p-6 text-center">
                <MaterialIcon
                  icon="Folder"
                  className="text-4xl text-neutral-300 mb-2"
                />
                <Typography level="body-md" className="text-tertiary">
                  No projects for this account yet
                </Typography>
              </Card>
            }
          >
            <div className="space-y-3">
              <Each table="projects" recordName="project">
                <Card
                  variant="outlined"
                  className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={(s) =>
                    s.navigate(block.projectHref(sql`project.id`))}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <Typography level="title-md">
                        {sql`project.name`}
                      </Typography>
                      <div className="flex items-center gap-3 mt-1 text-sm text-tertiary">
                        <ProjectPhaseChip phase={sql`project.phase`} />
                        <Show when={sql`project.start_date is not null`}>
                          <span>
                            <MaterialIcon
                              icon="Event"
                              className="text-sm mr-1"
                            />
                            {sql`format.date(project.start_date, '%b %d, %Y')`}
                          </span>
                        </Show>
                      </div>
                    </div>
                    <MaterialIcon
                      icon="ChevronRight"
                      className="text-neutral-400"
                    />
                  </div>
                </Card>
              </Each>
            </div>
          </Show>
        </Data>
      </div>
    </Data>
  );
}
