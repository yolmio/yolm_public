import {
  CurrentWatchKeyICtxKey,
  ParamsGatherICtxKey,
  ParamsICtxKey,
} from "std/ictx";
import type {
  CurrentWatchKeyICtx,
  GatherRecordParam,
  GatherScalarParam,
  GatherTableParam,
  ParamsGatherICtx,
  ParamsICtx,
  RecordParam,
  ScalarParam,
  TableParam,
} from "std/ictx";
import { normalizeCase } from "std/inflectors";
import { upcaseFirst } from "std/inflectors";
import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { Data } from "std/data";
import {
  addCtx,
  gatherChildrenContextInfo,
  useICtx,
  usePhase,
  useUniqueId,
} from "std/ui";
import type { ContextInstance, Node } from "std/ui";
import { DateRangeCalendars } from "./date_range";
import { EnumSelect } from "./enum_select";
import { FormControl } from "./form_control";
import { FormLabel } from "./form_label";
import { Input } from "./input";
import type { InputProps } from "./input";
import { TableRecordSelect } from "./table_record_select";
import type { TableRecordSelectProps } from "./table_record_select";
import { SwitchControl } from "./switch";
import { type HelperFieldType, system } from "std/system";
import type { GatherScalarForeignKeyParam } from "std/ictx";

class GatherContext implements ContextInstance, ParamsGatherICtx {
  implementICtxs = [ParamsGatherICtxKey];

  scalars: GatherScalarParam[] = [];
  tables: GatherTableParam[] = [];
  records: GatherRecordParam[] = [];
  scalarForeignKeys: GatherScalarForeignKeyParam[] = [];
}

interface ParamsProps {
  children: Node;
}

class ParamsContext
  implements ContextInstance, ParamsICtx, CurrentWatchKeyICtx {
  implementICtxs = [ParamsICtxKey, CurrentWatchKeyICtxKey];

  scalars: Record<string, ScalarParam> = {};
  tables: Record<string, TableParam> = {};
  records: Record<string, RecordParam> = {};
  scalarForeignKeys: GatherScalarForeignKeyParam[] = [];

  get currentWatchKey(): AnyExpr[] {
    return Object.values(this.scalars).map((s) => sql.ref(s.name));
  }
}

/**
 This is a wrapper around anything that has some parameters.

This is useful for dashboards, reports, or anything where you want to be able to easily define
parameters for other controls (for filtering, ordering, etc.).

Use <Params> to wrap everything and then use <Params.Date name="created_at"> or any other component

To import use `import { Params } from "components/params";`

@category Utility Component
 */
export function Params(props: ParamsProps) {
  const gatherContext = new GatherContext();
  addCtx(gatherContext);
  gatherChildrenContextInfo(props.children);
  const paramsContext = new ParamsContext();
  for (const c of gatherContext.scalars) {
    paramsContext.scalars[c.name] = c;
  }
  for (const c of gatherContext.tables) {
    paramsContext.tables[c.name] = c;
  }
  for (const c of gatherContext.records) {
    paramsContext.records[c.name] = c;
  }
  for (const c of gatherContext.scalarForeignKeys) {
    paramsContext.scalarForeignKeys.push(c);
  }
  addCtx(paramsContext);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        for (const c of gatherContext.scalars) {
          s.defScalar(c.name, {
            type: c.type,
            expr: c.initialValue,
          });
        }
        for (const c of gatherContext.tables) {
          s.defTable(c.name, {
            fields: c.fields,
          });
        }
        for (const c of gatherContext.records) {
          s.defRecord(c.name, {
            fields: c.fields,
          });
        }
      }}
    >
      {props.children}
    </Data>
  );
}

/** Date parameter: defines a `Date` scalar and renders a labeled date input. */
Params.Date = function ParamsDate(
  props: InputProps & {
    name: string;
    label?: Node;
    initialValue?: AnyExpr;
    sx?: Style;
    className?: string;
  },
) {
  const {
    initialValue,
    name,
    label = normalizeCase(name)
      .map((v, i) => (i === 0 ? upcaseFirst(v) : v.toLowerCase()))
      .join(" "),
    sx,
    className,
    ...rest
  } = props;
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name,
      type: "Date",
      initialValue: initialValue,
    });
    return;
  }
  const scalar = useICtx(ParamsICtxKey).scalars[name];
  if (!scalar) {
    throw new Error(`No scalar param found for ${name}`);
  }
  const id = useUniqueId();
  return (
    <FormControl sx={sx} className={className}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Input
        {...rest}
        id={id}
        type="date"
        value={sql.ref(name)}
        onInput={(s) => {
          s.setScalar(name, sql`try_cast(target_value as date)`);
        }}
      />
    </FormControl>
  );
};

/**
 * Date-range parameter: defines two `Date` scalars (`startName`/`endName`)
 * and renders linked range calendars that keep them in sync.
 */
Params.DateRange = function ParamsDateRange(props: {
  sx?: Style;
  startName: string;
  endName: string;
  label: Node;
  initialStartValue?: AnyExpr;
  initialEndValue?: AnyExpr;
  className?: string;
}) {
  const { initialStartValue, initialEndValue, sx, className } = props;
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name: props.startName,
      type: "Date",
      initialValue: initialStartValue,
    });
    c.scalars.push({
      name: props.endName,
      type: "Date",
      initialValue: initialEndValue,
    });
    return;
  }
  const startScalar = useICtx(ParamsICtxKey).scalars[props.startName];
  const endScalar = useICtx(ParamsICtxKey).scalars[props.endName];
  if (!(startScalar && endScalar)) {
    throw new Error(
      `No scalar param found for ${props.startName} or ${props.endName}`,
    );
  }
  return (
    <FormControl
      component="fieldset"
      sx={[{ border: 0, p: 0, m: 0, minWidth: 0 }, sx]}
      className={className}
    >
      <FormLabel
        component="legend"
        slotProps={{ root: { htmlFor: undefined } }}
      >
        {props.label}
      </FormLabel>
      <DateRangeCalendars
        startDate={sql.ref(props.startName)}
        endDate={sql.ref(props.endName)}
        onStartDateChange={(s, newStartDate) => {
          s.setScalar(props.startName, newStartDate);
        }}
        onEndDateChange={(s, newEndDate) => {
          s.setScalar(props.endName, newEndDate);
        }}
      />
    </FormControl>
  );
};
/**
 * Foreign-key parameter: defines a record-id scalar and renders a
 * {@link TableRecordSelect} for picking a related record.
 */
Params.Fk = function ParamsFk(
  props: Omit<TableRecordSelectProps, "value" | "onSelectValue"> & {
    name: string;
    label?: Node;
    initialValue?: AnyExpr;
    sx?: Style;
    className?: string;
  },
) {
  const {
    // deno-lint-ignore no-unused-vars
    initialValue,
    name,
    label = normalizeCase(name).map((v, i) =>
      i === 0 ? upcaseFirst(v) : v.toLowerCase()
    ).join(" "),
    sx,
    className,
    ...rest
  } = props;
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name: props.name,
      type: "BigUint",
      initialValue: props.initialValue,
    });
    return;
  }
  const scalar = useICtx(ParamsICtxKey).scalars[props.name];
  if (!scalar) {
    throw new Error(`No scalar param found for ${props.name}`);
  }
  const id = useUniqueId();
  return (
    <FormControl sx={sx} className={className}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <TableRecordSelect
        {...rest}
        id={id}
        value={sql.ref(props.name)}
        onSelectValue={(s, value) => {
          s.setScalar(props.name, value);
        }}
      />
    </FormControl>
  );
};

/**
 * Enum parameter: defines an enum-typed scalar and renders an
 * {@link EnumSelect}. `nullVariant` supplies the "no selection" option.
 */
Params.Enum = function ParamsEnum(props: {
  name: string;
  enum: string;
  label: Node;
  initialValue?: AnyExpr;
  nullVariant?: Node;
  sx?: Style;
  className?: string;
}) {
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name: props.name,
      type: { type: "Enum", enum: props.enum },
      initialValue: props.initialValue,
    });
    return;
  }
  const scalar = useICtx(ParamsICtxKey).scalars[props.name];
  if (!scalar) {
    throw new Error(`No scalar param found for ${props.name}`);
  }
  const id = useUniqueId();
  return (
    <FormControl sx={props.sx} className={props.className}>
      <FormLabel htmlFor={id}>{props.label}</FormLabel>
      <EnumSelect
        enum={props.enum}
        id={id}
        value={sql.ref(props.name)}
        nullVariant={props.nullVariant}
        onInput={(s) => {
          s.setScalar(
            props.name,
            sql`try_cast(target_value as enums.${sql.ref(props.enum)})`,
          );
        }}
      />
    </FormControl>
  );
};

/** Boolean parameter: defines a `Bool` scalar and renders a labeled switch. */
Params.Boolean = function ParamsBoolean(props: {
  name: string;
  label: Node;
  initialValue?: AnyExpr;
  sx?: Style;
  className?: string;
}) {
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name: props.name,
      type: { type: "Bool" },
      initialValue: props.initialValue,
    });
    return;
  }
  const scalar = useICtx(ParamsICtxKey).scalars[props.name];
  if (!scalar) {
    throw new Error(`No scalar param found for ${props.name}`);
  }
  const id = useUniqueId();
  return (
    <FormControl sx={props.sx} className={props.className}>
      <FormLabel htmlFor={id}>{props.label}</FormLabel>
      <SwitchControl
        id={id}
        checked={sql.ref(props.name)}
        onCheckboxChange={(s) => {
          s.setScalar(props.name, sql`target_checked`);
        }}
      />
    </FormControl>
  );
};

/**
 * Headless scalar parameter: defines a scalar of the given `type` with no
 * rendered control. Use when you provide your own input bound to the scalar.
 */
Params.Scalar = function ParamsScalar(props: {
  name: string;
  type: HelperFieldType;
  initialValue?: AnyExpr;
}) {
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name: props.name,
      type: props.type,
      initialValue: props.initialValue,
    });
    return;
  }
  const scalar = useICtx(ParamsICtxKey).scalars[props.name];
  if (!scalar) {
    throw new Error(`No scalar param found for ${props.name}`);
  }
  return null;
};

/**
 * Headless foreign-key parameter: defines an id scalar and registers it as
 * a foreign key to `tableName` (so consumers can resolve the related record),
 * without rendering a control.
 */
Params.ScalarForeignKey = function ParamsScalarForeignKey(props: {
  name: string;
  tableName: string;
  initialValue?: AnyExpr;
}) {
  if (usePhase() === "gather") {
    const c = useICtx(ParamsGatherICtxKey);
    c.scalars.push({
      name: props.name,
      type: "BigInt",
      initialValue: props.initialValue,
    });
    c.scalarForeignKeys.push({
      name: props.name,
      tableName: props.tableName,
    });
    return;
  }
  const table = system.db.tables[props.tableName];
  if (!table) {
    throw new Error(`Table ${props.tableName} not found`);
  }
  const scalar = useICtx(ParamsICtxKey).scalars[props.name];
  if (!scalar) {
    throw new Error(`No scalar param found for ${props.name}`);
  }
  return null;
};
