import type { BooleanExpr } from "../std/sql_utils";
import { sql } from "../std/sql_utils";
import type { Variant } from "std/theme";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import { Chip } from "./chip";
import type { Color, Size } from "./types";

/**
 * One conditional status branch for {@link StatusChip}.
 *
 * Cases should be mutually exclusive so the chip renders one label and one
 * visual variant for each row.
 */
export interface StatusChipCase {
  /** Runtime condition that selects this case's label and visual variant. */
  when: BooleanExpr;
  /**
   * Label rendered when `when` is true. Defaults to the parent
   * `fallbackLabel`.
   */
  label?: Node;
  /** Optional chip variant for this case. Defaults to the parent variant. */
  variant?: Variant;
  /** Optional chip color for this case. Defaults to the parent color. */
  color?: Color;
}

function noCaseMatches(cases: StatusChipCase[]): BooleanExpr {
  if (cases.length === 0) {
    return sql.true;
  }
  let expr = sql`not coalesce((${cases[0].when}), false)`;
  for (let i = 1; i < cases.length; i++) {
    expr = sql`${expr} and not coalesce((${cases[i].when}), false)`;
  }
  return expr;
}

/**
 * Renders a chip whose label, color, and variant are driven by SQL conditions.
 *
 * This is useful for status enums and workflow states where several pages need
 * consistent chip styling but the status vocabulary remains app-specific.
 * Define mutually exclusive cases; if no case matches, `fallbackLabel` is
 * rendered with the parent chip variant/color.
 */
export function StatusChip(props: {
  cases: StatusChipCase[];
  fallbackLabel?: Node;
  size?: Size;
  variant?: Variant;
  color?: Color;
  startDecorator?: Node;
  endDecorator?: Node;
}) {
  return (
    <Chip
      size={props.size ?? "sm"}
      variant={props.variant ?? "soft"}
      color={props.color ?? "neutral"}
      startDecorator={props.startDecorator}
      endDecorator={props.endDecorator}
      conditionalVariants={props.cases.map((statusCase) => ({
        when: statusCase.when,
        variant: statusCase.variant,
        color: statusCase.color,
      }))}
    >
      {props.cases.map((statusCase) => (
        <Show when={statusCase.when}>
          {statusCase.label ?? props.fallbackLabel ?? ""}
        </Show>
      ))}
      <Show when={noCaseMatches(props.cases)}>
        {props.fallbackLabel ?? ""}
      </Show>
    </Chip>
  );
}
