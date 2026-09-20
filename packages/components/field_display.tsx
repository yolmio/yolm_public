import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import { sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import { Show } from "std/ui";
import type { Node } from "std/ui";

/**
 * Displays one of two Material icons for a SQL boolean expression.
 *
 * Use this in dense tables and detail panels when a compact visual true/false
 * indicator is clearer than raw `true` / `false` text. The expression is
 * evaluated at runtime, so pass SQL-backed values such as `sql`record.active``.
 */
export function BooleanIcon(props: {
  expr: BooleanExpr;
  trueIcon?: IconName;
  falseIcon?: IconName;
  trueClassName?: string;
  falseClassName?: string;
}) {
  return (
    <>
      <Show when={props.expr}>
        <MaterialIcon
          icon={props.trueIcon ?? "CheckBox"}
          className={props.trueClassName ?? "text-success-600 text-sm"}
        />
      </Show>
      <Show when={sql`not (${props.expr})`}>
        <MaterialIcon
          icon={props.falseIcon ?? "CheckBoxOutlineBlank"}
          className={props.falseClassName ?? "text-tertiary text-sm"}
        />
      </Show>
    </>
  );
}

/** Backward-compatible alias for older solution code. */
export const BoolIcon = BooleanIcon;

/**
 * Displays a label/value row for custom record detail layouts.
 *
 * Pass `value` or `children` for explicit content. For legacy record-page
 * helpers, `field` renders `record.<field>` using a dynamic SQL reference.
 */
export function FieldRow(props: {
  label: Node;
  value?: Node;
  field?: string;
  children?: Node;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className={props.className ?? "flex items-center gap-2 py-1"}>
      <span
        className={props.labelClassName ??
          "text-secondary text-sm min-w-[120px]"}
      >
        {props.label}:
      </span>
      <span className={props.valueClassName ?? "text-sm"}>
        {props.field ? sql`record.${sql.ref(props.field)}` : props.value ??
          props.children}
      </span>
    </div>
  );
}

/**
 * Displays a label and {@link BooleanIcon} for an arbitrary SQL boolean value.
 */
export function BoolDisplay(props: {
  label: Node;
  expr?: BooleanExpr;
  field?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-secondary text-sm">{props.label}:</span>
      <BooleanIcon
        expr={props.field ? sql`record.${sql.ref(props.field)}` : props.expr ??
          sql.false}
      />
    </div>
  );
}

/**
 * Displays a standard label row with a boolean icon for `record.<field>`.
 */
export function BoolFieldRow(props: {
  label: Node;
  field: string;
}) {
  return (
    <FieldRow label={props.label}>
      <BooleanIcon expr={sql`record.${sql.ref(props.field)}`} />
    </FieldRow>
  );
}
