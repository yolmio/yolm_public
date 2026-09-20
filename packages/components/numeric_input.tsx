import type { ChangeEventHandlerFn } from "std/event_utils";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Input } from "./input";
import type { InputProps } from "./input";

export type NumericInputProps =
  & Omit<
    InputProps,
    "value" | "bindScalar" | "bindRecordField" | "onInput" | "onChange" | "type"
  >
  & {
    /** Caller-owned raw text, not a parsed or formatted numeric value. */
    value: Sql;
    /** Store this text unchanged; parse separately for calculations or saving. */
    onChange: ChangeEventHandlerFn;
  };

/** Stateless numeric text input. The caller owns editing, resets, and validation. */
export function NumericInput(props: NumericInputProps) {
  const { onChange, ...inputProps } = props;
  return (
    <Input
      inputMode="decimal"
      pattern="^-?[0-9]*,?[0-9]*\.?\d*$"
      {...inputProps}
      type="text"
      onInput={(s) => onChange(s, sql`target_value`)}
    />
  );
}
