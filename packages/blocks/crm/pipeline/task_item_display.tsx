import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Match, Show, Switch } from "std/ui";
import type { Node } from "std/ui";

export interface TaskItemDisplayProps {
  /** The record name used in the Each loop (e.g., "task") */
  recordName: string;
  /** Callback when checkbox is toggled */
  onToggleComplete: (s: DomStatements) => void;
  /** Callback when delete is clicked */
  onDelete: (s: DomStatements) => void;
  /** Whether to show the assigned chip */
  showAssigned?: boolean;
  /** Additional menu items to render */
  additionalMenuItems?: Node;
}

/**
 * Shared task item display component used across pipeline tasks and project tasks.
 * Expects to be used within an Each loop with the specified recordName.
 */
export function TaskItemDisplay(props: TaskItemDisplayProps) {
  const {
    recordName,
    onToggleComplete,
    onDelete,
    showAssigned = true,
    additionalMenuItems,
  } = props;

  const task = (field: string): Sql =>
    sql`${sql.ref(recordName)}.${sql.ref(field)}`;

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-level1 transition-colors"
      style={{
        opacity: sql`case when ${task("completed")} then 0.6 else 1 end`,
      }}
    >
      <Checkbox
        size="sm"
        color="success"
        variant="solid"
        checked={task("completed")}
        onCheckboxChange={onToggleComplete}
        className="mt-0.5"
      />

      <div className="flex-1 min-w-0">
        <Typography
          level="body-sm"
          className="font-medium"
          style={{
            textDecoration: sql`case when ${
              task("completed")
            } then 'line-through' else 'none' end`,
          }}
        >
          {task("title")}
        </Typography>

        <Show
          when={sql`${task("description")} is not null and ${
            task("description")
          } != ''`}
        >
          <Typography level="body-xs" className="text-tertiary mt-1">
            {task("description")}
          </Typography>
        </Show>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Switch>
            <Match when={sql`${task("priority")} = 'high'`}>
              <Chip size="sm" variant="soft" color="danger">High</Chip>
            </Match>
            <Match when={sql`${task("priority")} = 'medium'`}>
              <Chip size="sm" variant="soft" color="warning">Medium</Chip>
            </Match>
            <Match when={sql`${task("priority")} = 'low'`}>
              <Chip size="sm" variant="soft" color="neutral">Low</Chip>
            </Match>
          </Switch>

          <Show when={sql`${task("due_date")} is not null`}>
            <Show
              when={sql`not ${task("completed")} and ${
                task("due_date")
              } < current_date()`}
            >
              <Chip
                size="sm"
                variant="soft"
                color="danger"
                startDecorator={<MaterialIcon icon="Event" />}
              >
                {sql`format.date(${task("due_date")}, '%b %d')`}
              </Chip>
            </Show>
            <Show
              when={sql`not ${task("completed")} and ${
                task("due_date")
              } = current_date()`}
            >
              <Chip
                size="sm"
                variant="soft"
                color="warning"
                startDecorator={<MaterialIcon icon="Event" />}
              >
                {sql`format.date(${task("due_date")}, '%b %d')`}
              </Chip>
            </Show>
            <Show
              when={sql`${task("completed")} or ${
                task("due_date")
              } > current_date()`}
            >
              <Chip
                size="sm"
                variant="soft"
                color="neutral"
                startDecorator={<MaterialIcon icon="Event" />}
              >
                {sql`format.date(${task("due_date")}, '%b %d')`}
              </Chip>
            </Show>
          </Show>

          {showAssigned && (
            <Show when={sql`${task("assigned_to")} is not null`}>
              <Chip
                size="sm"
                variant="soft"
                color="neutral"
                startDecorator={<MaterialIcon icon="Person" />}
              >
                Assigned
              </Chip>
            </Show>
          )}
        </div>
      </div>

      <Menu>
        <Menu.IconButton size="sm" variant="plain" color="neutral">
          <MaterialIcon icon="MoreVert" />
        </Menu.IconButton>
        <Menu.Content>
          <Menu.Item onClick={onToggleComplete}>
            <Show when={task("completed")}>Mark Incomplete</Show>
            <Show when={sql`not ${task("completed")}`}>Mark Complete</Show>
          </Menu.Item>
          {additionalMenuItems}
          <Menu.Item color="danger" onClick={onDelete}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu>
    </div>
  );
}
