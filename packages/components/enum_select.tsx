import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import type { DomStatementsOrFn } from "std/statements";
import { system } from "std/system";
import type { BoolEnumLikeConfig } from "std/system";
import { Each } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { Select } from "./select";
import type { ComponentOpts, Size } from "./types";
import type { SlottedComponentBaseProps } from "./utils";
import type { ChangeEventHandlerFn } from "std/event_utils";
import { getUniqueUiId } from "./utils";

interface EnumSelectProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      select: "select";
      startDecorator: "span";
      endDecorator: "span";
      icon: "span";
    }> {
  enum: string;
  fullWidth?: boolean;
  error?: BooleanExpr;
  startDecorator?: Node;
  endDecorator?: Node;
  placeholder?: Sql | string;
  onInput?: ChangeEventHandlerFn;
  onChange?: ChangeEventHandlerFn;
  value?: Sql | NumericExpr;
  id?: Sql | string;
  filterVariants?: (name: string) => boolean;
  /** Query-backed options with `value` and `label` columns. Replaces the enum's static variants when provided. */
  optionsQuery?: Sql;
  onClickAway?: DomStatementsOrFn;
  immediateFocus?: boolean;
  nullVariant?: Node;
}

/**
 * `Select` driven by an enum declared via `system.enum_({...})`.
 *
 * Pass the enum name; the component pulls the variants out of
 * `system.enums` and renders one option per variant using each
 * variant's display name. Selection is controlled via `value` +
 * `onChange` (same wiring as `Select`). Use `filterVariants` to hide
 * variants conditionally and `nullVariant` to render an explicit "no
 * value" option.
 *
 * @example
 * <EnumSelect
 *   enum="task_status"
 *   value={sql`record.status`}
 *   onChange={(s) => s.setScalar("ui.status", sql`target_value`)}
 * />
 */
export function EnumSelect(props: EnumSelectProps) {
  const {
    enum: enumName,
    filterVariants,
    nullVariant,
    optionsQuery,
    ...rest
  } = props;
  const enum_ = system.enums[enumName];
  if (!enum_) {
    throw new Error(`Enum ${enumName} not found`);
  }
  if (optionsQuery) {
    const optionsTable = `enum_select_options_${getUniqueUiId()}`;
    return (
      <Data
        procedure={(s) => s.defTable(optionsTable, optionsQuery)}
        pendingFallback={null}
      >
        <Select
          {...rest}
          enumName={enumName}
          immediateFocus={props.immediateFocus}
        >
          {nullVariant && <Select.Option value="">{nullVariant}</Select.Option>}
          <Each table={optionsTable} recordName="enum_select_option">
            <Select.Option
              value={sql`enum_select_option.value`}
              searchText={sql`enum_select_option.label`}
            >
              {sql`enum_select_option.label`}
            </Select.Option>
          </Each>
        </Select>
      </Data>
    );
  }
  const options = Object.values(enum_.values)
    .filter(
      (v) =>
        !v.hideFromUiControls && (!filterVariants || filterVariants(v.name)),
    )
    .map((v) => (
      <Select.Option value={v.name}>
        {v.displayName}
        {v.color && (
          <span
            sx={{
              display: "inline-block",
              width: "0.75em",
              height: "0.75em",
              borderRadius: "50%",
              backgroundColor: v.color,
              marginLeft: 1,
              verticalAlign: "middle",
            }}
          />
        )}
      </Select.Option>
    ));
  if (nullVariant) {
    options.unshift(<Select.Option value="">{nullVariant}</Select.Option>);
  }
  return (
    <Select
      {...rest}
      enumName={enumName}
      immediateFocus={props.immediateFocus}
    >
      {options}
    </Select>
  );
}

interface EnumLikeSelectProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      select: "select";
      startDecorator: "span";
      endDecorator: "span";
      icon: "span";
    }> {
  enumLike: BoolEnumLikeConfig;
  notNull: boolean;
  fullWidth?: boolean;
  error?: BooleanExpr;
  startDecorator?: Node;
  endDecorator?: Node;
  placeholder?: Sql | string;
  onInput?: ChangeEventHandlerFn;
  onChange?: ChangeEventHandlerFn;
  value?: Sql | NumericExpr;
  id?: Sql | string;
  inlineSaveComponent?: Node;
  immediateFocus?: boolean;
}

/**
 * `Select` for a boolean field presented as a three-way enum-like control
 * (true / false / null). Pass the field's `BoolEnumLikeConfig` as `enumLike`
 * to supply the labels for each state; set `notNull` to drop the null option.
 *
 * @category UI Component
 */
export function EnumLikeSelect(props: EnumLikeSelectProps) {
  const { enumLike, notNull, ...rest } = props;
  return (
    <Select
      {...rest}
      immediateFocus={props.immediateFocus}
      endDecorator={props.inlineSaveComponent}
    >
      {notNull ? null : <Select.Option value="">{enumLike.null}</Select.Option>}
      <Select.Option value="true">{enumLike.true}</Select.Option>
      <Select.Option value="false">{enumLike.false}</Select.Option>
    </Select>
  );
}
