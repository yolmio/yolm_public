import type { BooleanExpr, Sql } from "../std/sql_utils";
import { sql } from "../std/sql_utils";
import { Match, Switch } from "std/ui";
import type { Node } from "std/ui";
import { Alert } from "./alert";
import { CircularProgress } from "./circular_progress";
import type { IconName } from "./material_icon_names";

// Helper to convert JS booleans to SQL expressions
// This is needed because JSX shorthand props like `successCondition` (without a value)
// pass `true` as the value, which needs to be converted to `sql`true`` for proper evaluation
function normalizeCondition(
  condition: BooleanExpr | undefined,
  defaultExpr: Sql,
): Sql {
  if (condition === undefined) {
    return defaultExpr;
  }
  if (condition === true) {
    return sql`true`;
  }
  if (condition === false) {
    return sql`false`;
  }
  return condition;
}

export interface StateStatusSwitchProps {
  /**
       Content to display during loading or pending states
       */
  fallback?: Node;
  /**
       Message to show when an error occurs
       */
  errorMessage: string | Sql;
  /**
       Content to display when in success state
       */
  children: Node;
  /**
       Override the default status check with a custom SQL condition for fallback state
       */
  fallbackCondition?: BooleanExpr;
  /**
       Override the default status check with a custom SQL condition for error state
       */
  errorCondition?: BooleanExpr;
  /**
       Override the default status check with a custom SQL condition for success state
       */
  successCondition?: BooleanExpr;
  errorIcon?: IconName;
}

/**
 A component that conditionally renders content based on either a standard 'status' field or custom conditions.
 Requires either a 'status' and 'has_data' scalar in the data or custom conditions to be specified.

 When using the default "status" scalar:
 - 'failed' triggers error state
 - 'fallback_triggered' shows fallback content
 - 'received' shows success content

 @category Control Flow Component
 @example

[Example](../pages/search_card_page.tsx)
 */
export function StateStatusSwitch(props: StateStatusSwitchProps) {
  return (
    <Switch>
      <Match
        when={normalizeCondition(props.errorCondition, sql`status = 'failed'`)}
      >
        <Alert
          variant="soft"
          color="danger"
          startIcon={props.errorIcon ?? "Error"}
        >
          {props.errorMessage}
        </Alert>
      </Match>
      <Match
        when={normalizeCondition(
          props.fallbackCondition,
          sql`status = 'fallback_triggered'`,
        )}
      >
        {props.fallback ?? <CircularProgress size="sm" />}
      </Match>
      <Match
        when={normalizeCondition(
          props.successCondition,
          sql`status = 'received' and has_data`,
        )}
      >
        {props.children}
      </Match>
      <Match when={sql`true`}>
        {props.fallback ?? <CircularProgress size="sm" />}
      </Match>
    </Switch>
  );
}
