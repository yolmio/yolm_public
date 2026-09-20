import { ImageSetFieldGroup } from "field_groups/image_set";
import { DatagridEditICtxKey } from "std/ictx";
import { normalizeCase, upcaseFirst } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr } from "../../std/sql_utils";
import { DomStatements } from "std/statements";
import type { DomStatementsOrFn } from "std/statements";
import type { Field, Table } from "std/system";
import { system } from "std/system";
import type { Node } from "std/ui";
import { useICtx } from "std/ui";
import type { DgCellHelper } from "./shared";
import { formatSecret } from "std/utils/secret";
import { FieldCell } from "./cells";
import type { FieldCellLink } from "./cells";
import { ColumnMenu } from "./column_menu";
import type { Column, FilterType, SortConfig } from "./dynamic_datagrid";
import { ResizeableSeperator } from "./shared";
import type { FieldEditProcConfig } from "./shared";
import { styles as sharedStyles } from "./styles";

type FieldFilterType = Exclude<FilterType, { type: "custom" }>;

export function filterTypeFromField(field: Field): FieldFilterType {
  switch (field.type) {
    case "BigInt":
    case "BigUint":
    case "Int":
    case "Uint":
    case "SmallInt":
    case "SmallUint":
    case "TinyInt":
    case "TinyUint":
    case "Double":
    case "Real":
    case "Decimal":
    case "Tx": {
      if ("usage" in field && field.usage) {
        if (field.usage.type === "Duration") {
          if (field.usage.size === "minutes") {
            return { type: "minutes_duration", notNull: field.notNull };
          }
          throw new Error("Only minute durations supported right now");
        }
      }
      return { type: "number", notNull: field.notNull };
    }
    case "String":
    case "Uuid":
    case "PhoneNumber":
      return { type: "string", notNull: field.notNull };
    case "Enum":
      return { type: "enum", enum: field.enum, notNull: field.notNull };
    case "ForeignKey":
      return { type: "table", table: field.table, notNull: field.notNull };
    case "TimestampNaive":
    case "TimestampTz":
    case "TimestampUtc":
      return { type: "timestamp", notNull: field.notNull };
    case "Date":
      return { type: "date", notNull: field.notNull };
    case "Bool":
      return field.enumLike
        ? {
          type: "enum_like_bool",
          config: field.enumLike,
          notNull: field.notNull,
        }
        : { type: "bool", notNull: field.notNull };
    case "Time":
    case "Ordering":
    case "Json":
    case "Bytes":
      throw new Error(`Filter not supported for type: ${field.type}`);
    default:
      throw new Error(`Unknown field type: ${(field as Field).type}`);
  }
}

function getFieldCellWidth(
  field: Field,
  table: string,
  headerBuffer: number,
): number {
  const charSize = 12;
  const cellBuffer = 20;
  const headerLength = field.displayName.length * charSize + headerBuffer;
  if (field.type === "Bytes" && field.group) {
    const tableModel = system.db.tables[table];
    const group = tableModel.fieldGroups[field.group];
    if (group instanceof ImageSetFieldGroup) {
      return 138;
    }
  }
  if (field.type === "Bool") {
    if (field.enumLike) {
      const maxValue = Math.max(
        field.enumLike.true.length,
        field.enumLike.false.length,
        (field.enumLike.null ?? "Unspecified").length,
      );
      const maxValueLength = maxValue * charSize + cellBuffer;
      return Math.max(maxValueLength, headerLength);
    }
    return headerLength;
  }
  if (field.type === "Enum") {
    const enum_ = system.enums[field.enum];
    const maxVariant = Math.max(
      ...Object.values(enum_.values).map((v) => v.displayName.length),
    );
    const maxVariantTotal = maxVariant * charSize + headerBuffer;
    return Math.max(maxVariantTotal, headerLength);
  }
  if (field.type === "Date") {
    return Math.max(120, headerLength);
  }
  if (field.type === "String") {
    return Math.min(250, Math.max(field.maxLength * charSize, headerLength));
  }
  return 250;
}

export const editWithCharCellKeydownHandler = new DomStatements()
  .if(sql`event.key = 'Enter'`, (s) => {
    s.modify(
      sql`update ui.focus_state set column = cell.column, row = cell.row, should_focus = false`,
    );
    s.modify(
      sql`update ui.editing_state set column = cell.column, row = cell.row, is_editing = true`,
    );
    s.setScalar("ui.start_edit_empty", false);
  })
  .if(
    sql`(char_length(event.key) = 1 and not event.ctrl_key and not event.meta_key and not event.alt_key) or
    (event.key = 'v' and (event.ctrl_key or event.meta_key))`,
    (s) => {
      s.modify(
        sql`update ui.focus_state set column = cell.column, row = cell.row, should_focus = false`,
      );
      s.modify(
        sql`update ui.editing_state set column = cell.column, row = cell.row, is_editing = true`,
      );
      s.setScalar("ui.start_edit_empty", true);
    },
  );

export const opaqueCellKeydownHandler = new DomStatements().if(
  sql`event.key = 'Enter'`,
  (s) => {
    s.modify(
      sql`update ui.focus_state set column = cell.column, row = cell.row, should_focus = false`,
    );
    s.modify(
      sql`update ui.editing_state set column = cell.column, row = cell.row, is_editing = true`,
    );
    s.setScalar("ui.start_edit_empty", false);
  },
);

export const dynamicBooleanCellKeydownHandler = (
  s: DomStatements,
  col: number,
  sqlName: string,
  tableName: string,
) => {
  const editCtx = useICtx(DatagridEditICtxKey);
  s.if(sql`event.key = 'Enter'`, (s) => {
    s.defScalar(
      "row_id",
      sql`(select field_0 from ui.dg_table limit 1 offset cell.row - 1)`,
    );
    s.commitUiTreeChanges();
    s.defScalar(
      "prev_value",
      sql`(select field_${col} from ui.dg_table where field_0 = row_id)`,
    );
    s.modify(
      sql`update ui.dg_table set field_${col} = not (field_${col} = 'true') where field_0 = row_id`,
    );
    editCtx.updateFieldValueInDb(s, {
      dbValue:
        sql`(select field_${col} from ui.dg_table where field_0 = row_id) = 'true'`,
      fieldName: sqlName,
      recordId: sql`cast(row_id as bigint)`,
      tableName,
      resetValue: (s) =>
        s.modify(
          sql`update ui.dg_table set field_${col} = prev_value where field_0 = row_id`,
        ),
    });
  });
};

export interface SuperColumnFieldOpts extends FieldEditProcConfig {
  table: string;
  field: Field;
  dynIndex: number;
  columnIndex: number;
  canEdit?: BooleanExpr;
  initialWidth?: number;
  filter?: boolean;
  sort?: boolean;
  displayName?: string;
  pin?: "left" | "right";
  link?: FieldCellLink;
  /** Override the cell renderer (default uses the field-type-aware FieldCell). */
  cell?: ((props: { helper: DgCellHelper }) => Node) | Node;
}

function getFieldSort(
  field: Field,
  displayName: string,
): SortConfig | undefined {
  switch (field.type) {
    case "Date":
    case "BigInt":
    case "BigUint":
    case "Int":
    case "Uint":
    case "SmallInt":
    case "SmallUint":
    case "TinyInt":
    case "TinyUint":
    case "Double":
    case "Real":
    case "Decimal":
    case "TimestampUtc":
    case "TimestampNaive":
    case "TimestampTz": {
      return { type: "numeric", displayName };
    }
    case "Enum": {
      const enumModel = system.enums[field.enum];
      const firstValue = enumModel.valuesMap.entries().next().value![1];
      const lastValue = Array.from(enumModel.valuesMap.entries())[
        Object.keys(enumModel.values).length - 1
      ][1];
      return {
        type: "custom",
        displayName,
        ascText: sql.lit`${firstValue.displayName} → ${lastValue.displayName}`,
        descText: sql.lit`${lastValue.displayName} → ${firstValue.displayName}`,
        ascNode: sql.lit`${firstValue.displayName} → ${lastValue.displayName}`,
        descNode: sql.lit`${lastValue.displayName} → ${firstValue.displayName}`,
      };
    }
    case "String": {
      return { type: "string", displayName };
    }
    case "Bool": {
      if (field.enumLike) {
        const high = field.enumLike.true;
        const low = field.enumLike.false;
        const ascText = sql.lit`${low} → ${high}`;
        const descText = sql.lit`${high} → ${low}`;
        return {
          type: "custom",
          displayName,
          ascText,
          descText,
          ascNode: ascText,
          descNode: descText,
        };
      }
      return { type: "checkbox", displayName };
    }
  }
}

export function columnFromField({
  table,
  field,
  dynIndex,
  columnIndex,
  canEdit,
  ...restOpts
}: SuperColumnFieldOpts): Column | undefined {
  let keydownHandler: DomStatementsOrFn = (_s: DomStatements) => {};
  let noFilter = typeof restOpts.filter === "boolean"
    ? !restOpts.filter
    : false;
  let noSort = typeof restOpts.sort === "boolean" ? !restOpts.sort : false;
  let displayName = restOpts.displayName ?? field.displayName;
  if (field.type === "Ordering" || field.type === "Time") {
    return;
  }
  if (field.group) {
    const tableModel = system.db.tables[table];
    const group = tableModel.fieldGroups[field.group];
    if (group instanceof ImageSetFieldGroup) {
      if (group.variants[field.name]?.usage !== "square_thumbnail") {
        return;
      }
    }
  }
  if (canEdit !== false) {
    switch (field.type) {
      case "BigInt":
      case "BigUint":
      case "Int":
      case "Uint":
      case "SmallInt":
      case "SmallUint":
      case "TinyInt":
      case "TinyUint":
      case "Double":
      case "Real":
      case "Decimal":
      case "String":
      case "ForeignKey":
      case "Tx": {
        keydownHandler = editWithCharCellKeydownHandler;
        break;
      }
      case "TimestampNaive":
      case "TimestampUtc":
      case "TimestampTz":
      case "Date":
      case "Enum": {
        keydownHandler = opaqueCellKeydownHandler;
        break;
      }
      case "Bytes": {
        if (field.group) {
          const tableModel = system.db.tables[table];
          const group = tableModel.fieldGroups[field.group];
          if (group instanceof ImageSetFieldGroup) {
            noFilter = true;
            noSort = true;
            displayName = upcaseFirst(normalizeCase(field.group).join(" "));
          }
        }
        keydownHandler = opaqueCellKeydownHandler;
        break;
      }
      case "Bool": {
        keydownHandler = field.enumLike
          ? opaqueCellKeydownHandler
          : (s) =>
            dynamicBooleanCellKeydownHandler(s, dynIndex, field.name, table);
        break;
      }
    }
  }
  let sort: SortConfig | undefined;
  if (!noSort) {
    sort = getFieldSort(field, displayName);
  }
  let exportExpr = sql.lit(sql`record.${sql.ref(field.name)}`.toSQL());
  switch (field.type) {
    case "ForeignKey": {
      if (!system.db.tables[field.table]) {
        throw new Error(
          `Table ${field.table} not found, defined on table ${table} field ${field.name}`,
        );
      }
      if (system.db.tables[field.table].recordDisplayName) {
        const table = system.db.tables[field.table];
        const displayNameExpr = table.recordDisplayName!.expr(
          ...table.recordDisplayName!.fields.map(
            (f) => sql`other_record.${sql.ref(f)}`,
          ),
        );
        exportExpr = sql.lit(
          sql`(select ${displayNameExpr} from ${table.identWithDb} as other_record where id = record.${
            sql.ref(field.name)
          })`.toSQL(),
        );
      }
      break;
    }
    case "Enum": {
      const displayFnName = `display_${field.enum}`;
      if (system.scalarFunctions[displayFnName]) {
        exportExpr = sql.lit(
          sql`fn.${sql.ref(displayFnName)}(record.${sql.ref(field.name)})`
            .toSQL(),
        );
      }
      break;
    }
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        exportExpr = sql.lit(
          formatSecret(
            sql`crypto.decrypt(record.${sql.ref(field.name)}, ${
              sql.lit(field.usage.encryptionKey)
            })`,
          ).toSQL(),
        );
      }
      break;
    }
  }
  let queryExpr = sql.lit(sql`record.${sql.ref(field.name)}`.toSQL());
  if (field.type === "Bytes" && field.usage?.type === "Secret") {
    queryExpr = sql.lit(
      formatSecret(
        sql`crypto.decrypt(record.${sql.ref(field.name)}, ${
          sql.lit(field.usage.encryptionKey)
        })`,
      ).toSQL(),
    );
  }
  return {
    columnsDisplayName: displayName,
    filterDisplayName: noFilter ? undefined : displayName,
    filterOptGroup: "Field",
    keydownCellHandler: keydownHandler,
    filter: noFilter ? undefined : filterTypeFromField(field),
    sort,
    displayInfo: {
      cell: restOpts.cell ?? (
        <FieldCell
          {...restOpts}
          canEdit={canEdit ?? true}
          tableName={table}
          field={field}
          stringified
        />
      ),
      initiallyDisplaying: true,
      initialWidth: restOpts.initialWidth ??
        getFieldCellWidth(field, table, 46),
      pin: restOpts.pin,
      header: (
        <>
          <span sx={sharedStyles.headerText}>{displayName}</span>
          <ColumnMenu columnIndex={columnIndex} sort={sort} />
          <ResizeableSeperator
            minWidth={50}
            setWidth={(s, width) => {
              s.modify(
                sql`update ui.column set width = ${width} where id = ${columnIndex}`,
              );
            }}
            width={sql`(select width from ui.column where id = ${columnIndex})`}
          />
        </>
      ),
    },
    queryGeneration: {
      expr: queryExpr,
      alwaysGenerate: false,
    },
    export: {
      name: displayName,
      expr: exportExpr,
    },
    viewStorageName: field.name,
    canReorder: true,
  };
}

export interface FkVirtualColumnFromFieldOpts {
  mainTable: Table;
  fkTable: Table;
  field: Field;
  fkField: Field;
  dynIndex: number;
  columnIndex: number;
  canEdit?: BooleanExpr;
  initialWidth?: number;
  filter?: boolean;
  sort?: boolean;
  displayName?: string;
  pin?: "left" | "right";
}

export function fkVirtualColumnFromField({
  fkTable,
  field,
  fkField,
  columnIndex,
  ...restOpts
}: FkVirtualColumnFromFieldOpts): Column | undefined {
  const noFilter = typeof restOpts.filter === "boolean"
    ? !restOpts.filter
    : false;
  const noSort = typeof restOpts.sort === "boolean" ? !restOpts.sort : false;
  const displayName = restOpts.displayName ?? field.displayName;
  if (field.type === "Ordering" || field.type === "Time") {
    return;
  }
  let sort: SortConfig | undefined;
  if (!noSort) {
    sort = getFieldSort(field, displayName);
  }
  const baseExpr =
    sql`(select ${field.ident} from ${fkTable.identWithDb} where id = record.${fkField.ident})`;
  let exportExpr = sql.lit(baseExpr.toSQL());
  switch (field.type) {
    case "ForeignKey": {
      if (system.db.tables[field.table].recordDisplayName) {
        const table = system.db.tables[field.table];
        const displayNameExpr = table.recordDisplayName!.expr(
          ...table.recordDisplayName!.fields.map(
            (f) => sql`other_record.${sql.ref(f)}`,
          ),
        );
        exportExpr = sql.lit(
          sql`(select ${displayNameExpr} from ${table.identWithDb} as other_record where id = ${baseExpr})`
            .toSQL(),
        );
      }
      break;
    }
    case "Enum": {
      const displayFnName = `display_${field.enum}`;
      if (system.scalarFunctions[displayFnName]) {
        exportExpr = sql.lit(
          sql`fn.${sql.ref(displayFnName)}(${baseExpr})`.toSQL(),
        );
      }
      break;
    }
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        exportExpr = sql.lit(
          formatSecret(
            sql`crypto.decrypt(${baseExpr}, ${
              sql.lit(field.usage.encryptionKey)
            })`,
          ).toSQL(),
        );
      }
      break;
    }
  }
  let queryExpr = sql.lit(baseExpr.toSQL());
  if (field.type === "Bytes" && field.usage?.type === "Secret") {
    queryExpr = sql.lit(
      formatSecret(
        sql`crypto.decrypt(${baseExpr}, ${sql.lit(field.usage.encryptionKey)})`,
      ).toSQL(),
    );
  }
  return {
    columnsDisplayName: displayName,
    filterDisplayName: noFilter ? undefined : displayName,
    filterOptGroup: "Field",
    filter: noFilter ? undefined : filterTypeFromField(field),
    sort,
    displayInfo: {
      cell: (
        <FieldCell
          {...restOpts}
          canEdit={false}
          tableName={fkTable.name}
          field={field}
          stringified
        />
      ),
      initiallyDisplaying: true,
      initialWidth: restOpts.initialWidth ??
        getFieldCellWidth(field, fkTable.name, 46),
      pin: restOpts.pin,
      header: (
        <>
          <span sx={sharedStyles.headerText}>{displayName}</span>
          <ColumnMenu columnIndex={columnIndex} sort={sort} />
          <ResizeableSeperator
            minWidth={50}
            setWidth={(s, width) => {
              s.modify(
                sql`update ui.column set width = ${width} where id = ${columnIndex}`,
              );
            }}
            width={sql`(select width from ui.column where id = ${columnIndex})`}
          />
        </>
      ),
    },
    queryGeneration: {
      expr: queryExpr,
      alwaysGenerate: false,
    },
    export: {
      name: displayName,
      expr: exportExpr,
    },
    viewStorageName: field.name,
    canReorder: true,
  };
}
