import {
  logPipelineTaskCreatedProcedureName,
  togglePipelineTaskProcedureName,
} from "./stored_procedures";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { singularize } from "std/inflectors";
import { sql } from "std/sql_utils";
import type { NumericExpr } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import { Form } from "std/form";
import { CrmBlock } from "../index";
import { TaskItemDisplay } from "./task_item_display";

interface PipelineTaskListProps {
  block: CrmBlock;
  itemId: NumericExpr;
  onTaskChange?: (s: UiServerStatements) => void;
  showOnlyPending?: boolean;
  limit?: number;
}

/**
 * Renders the task list for a single pipeline item. Used on the
 * pipeline item detail page; can also be embedded in custom layouts.
 */
export function PipelineTaskList(props: PipelineTaskListProps) {
  const { block, itemId, showOnlyPending, limit } = props;
  if (!block.pipelines.some((p) => block.hasPipelineTasksEnabled(p.name))) {
    return null;
  }
  const tasksTable = block.pipelineTasksTableName;
  const itemFkColumn = block.pipelineItemFkColumnName;

  const whereClause = showOnlyPending
    ? sql`${sql.ref(itemFkColumn)} = ${itemId} and not completed`
    : sql`${sql.ref(itemFkColumn)} = ${itemId}`;

  let query = sql`select * from db.${sql.ref(tasksTable)}
    where ${whereClause}
    order by completed asc, due_date asc nulls last, created_at desc`;

  if (limit) {
    query = sql`${query} limit ${limit}`;
  }

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", 0);
      }}
    >
      <Data
        procedure={(s) => {
          s.defTable("tasks", query);
          s.defScalar("show_add_form", false);
          s.defScalar(
            "item_supports_tasks",
            block.pipelineItemSupportsTasks(itemId),
          );
        }}
        watch={[sql`refresh_key`]}
      >
        <Show when={sql`item_supports_tasks`}>
          <div className="space-y-2">
            <Show when={sql`(select count(*) from tasks) = 0`}>
              <div className="text-center py-6 text-tertiary">
                <MaterialIcon
                  icon="TaskAlt"
                  className="text-3xl mb-2 opacity-50"
                />
                <Typography level="body-sm">No tasks yet</Typography>
              </div>
            </Show>
            <Each
              table="tasks"
              recordName="task"
            >
              <TaskItem
                block={block}
                onTaskChange={(s) => {
                  s.increment("refresh_key");
                  if (props.onTaskChange) {
                    props.onTaskChange(s);
                  }
                }}
              />
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
            <AddTaskForm
              block={block}
              itemId={itemId}
              onSave={(s) => {
                s.increment("refresh_key");
                if (props.onTaskChange) {
                  props.onTaskChange(s);
                }
              }}
              onCancel={(s) => {
                s.setScalar("show_add_form", false);
              }}
            />
          </Show>
        </Show>
      </Data>
    </Data>
  );
}

interface TaskItemProps {
  block: CrmBlock;
  onTaskChange: (s: UiServerStatements) => void;
}

function TaskItem(props: TaskItemProps) {
  const { block } = props;
  const tasksTable = block.pipelineTasksTableName;

  function toggleComplete(s: DomStatements) {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.callStoredProcedure(togglePipelineTaskProcedureName(block), {
          inputScalars: { p_task_id: sql`task.id` },
        });
        s.commitTransaction();
        props.onTaskChange(s);
      },
    });
  }

  function deleteTask(s: DomStatements) {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`delete from db.${sql.ref(tasksTable)} where id = task.id`);
        s.commitTransaction();
        props.onTaskChange(s);
      },
    });
  }

  return (
    <TaskItemDisplay
      recordName="task"
      onToggleComplete={toggleComplete}
      onDelete={deleteTask}
      showAssigned
    />
  );
}

interface AddTaskFormProps {
  block: CrmBlock;
  itemId: NumericExpr;
  onSave: (s: UiServerStatements) => void;
  onCancel: (s: DomStatements) => void;
}

function AddTaskForm(props: AddTaskFormProps) {
  const { block, itemId } = props;
  const tasksTable = block.pipelineTasksTableName;

  return (
    <div className="mt-4 p-4 bg-level1 rounded-lg">
      <Typography level="title-sm" className="mb-3">Add New Task</Typography>

      <Form
        defaultFieldComponent={LabelOnTopFormField}
        beforeTransactionCommit={(s) => {
          const formRecord = `ui.write_${singularize(tasksTable)}`;
          s.callStoredProcedure(logPipelineTaskCreatedProcedureName(block), {
            inputScalars: {
              p_item_id: itemId,
              p_title: sql`${sql.ref(formRecord)}.title`,
            },
          });
        }}
        afterTransactionCommit={(s) => {
          props.onSave(s);
        }}
        afterSubmitClientSuccess={(s, ctx) => {
          s.setScalar("show_add_form", false);
          ctx.reset(s);
        }}
      >
        <Form.Insert
          table={tasksTable}
          values={{
            pipeline_item_id: itemId,
            created_by: sql`current_user`,
          }}
        >
          <div className="space-y-3">
            <Form.Field field="title" />
            <Form.Field field="description" />
            <div className="grid grid-cols-2 gap-3">
              <Form.Field field="due_date" />
              <Form.Field field="priority" initialValue={sql.lit`medium`} />
            </div>
          </div>

          <Form.ErrorAlert className="mt-3" mode="all" />

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              onClick={props.onCancel}
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
  );
}

interface OverdueTasksAlertProps {
  block?: CrmBlock;
  pipelineName?: string;
  limit?: number;
}

/**
 * Dismissible alert listing tasks past their due date for the current
 * user (optionally scoped to a specific `pipelineName`). Use on
 * dashboards to nudge users towards overdue work.
 */
export function OverdueTasksAlert(props: OverdueTasksAlertProps) {
  const block = props.block ?? system.block(CrmBlock);
  const { pipelineName, limit = 5 } = props;
  if (
    pipelineName
      ? !block.hasPipelineTasksEnabled(pipelineName)
      : !block.pipelines.some((p) => block.hasPipelineTasksEnabled(p.name))
  ) return null;
  const tasksTable = block.pipelineTasksTableName;
  const itemsTable = block.pipelineItemsTableName;
  const organizationsTable = block.organizationsTableName;
  const peopleTable = block.peopleTableName;

  const whereClause = pipelineName
    ? sql`t.due_date < current_date() and not t.completed and i.pipeline_name = ${
      sql.lit(pipelineName)
    }`
    : sql`t.due_date < current_date() and not t.completed and ${
      block.pipelineItemSupportsTasks(sql`i.id`)
    }`;

  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "overdue_tasks",
          sql`select
                t.*,
                i.entity_type,
                i.organization_id,
                i.person_id,
                case
                  when i.entity_type = 'organization' then ${
            system.db.tables[organizationsTable]
              ? sql`org.name`
              : sql`cast(null as string)`
          }
                  else concat(person.first_name, ' ', person.last_name)
                end as entity_name
              from db.${sql.ref(tasksTable)} t
              join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
              ${
            system.db.tables[organizationsTable]
              ? sql`left join db.${
                sql.ref(organizationsTable)
              } org on org.id = i.organization_id`
              : sql``
          }
              left join db.${
            sql.ref(peopleTable)
          } person on person.id = i.person_id
              where ${whereClause}
              order by t.due_date asc
              limit ${limit}`,
        );
        s.defScalar("overdue_count", sql`(select count(*) from overdue_tasks)`);
      }}
    >
      <Show when={sql`overdue_count > 0`}>
        <Alert
          color="warning"
          startDecorator={<MaterialIcon icon="Schedule" />}
        >
          <div>
            <Typography level="title-sm">
              {sql`overdue_count`}{" "}
              Overdue
              Task{sql`case when overdue_count > 1 then 's' else '' end`}
            </Typography>
            <div className="mt-2 space-y-1">
              <Each table="overdue_tasks" recordName="task">
                <div className="flex items-center gap-2 text-sm">
                  <MaterialIcon icon="Circle" className="text-xs" />
                  <span className="font-medium">{sql`task.title`}</span>
                  <span className="text-tertiary">
                    ({sql`task.entity_name`})
                  </span>
                  <Chip size="sm" variant="soft" color="danger">
                    {sql`format.date(task.due_date, '%b %d')`}
                  </Chip>
                </div>
              </Each>
            </div>
          </div>
        </Alert>
      </Show>
    </Data>
  );
}
