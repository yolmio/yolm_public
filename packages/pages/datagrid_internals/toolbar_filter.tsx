import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { CountrySelect } from "components/country_select";
import { DurationInput } from "components/duration_input";
import { EnumLikeSelect, EnumSelect } from "components/enum_select";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { TableRecordSelect } from "components/table_record_select";
import {
  CurrentRefetchICtxKey,
  DynamicDatagridICtxKey,
  FilterTermICtxKey,
} from "std/ictx";
import type {
  CurrentRefetchICtx,
  DynamicDatagridICtx,
  FilterTermICtx,
  FilterValue,
} from "std/ictx";
import { Data } from "std/data";
import { normalizeCase } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import { valuesRow } from "../../std/sql_utils";
import { BasicStatements } from "std/statements";
import type { DomStatements, IStatementsBase } from "std/statements";
import { createStyles, flexGrowStyles } from "std/style_utils";
import type { BoolEnumLikeConfig } from "std/system";
import {
  addCtx,
  Conditional,
  Each,
  Match,
  Recurse,
  Recursive,
  Show,
  Switch,
  useICtx,
  useState,
  useUniqueId,
} from "std/ui";
import type { ContextInstance, ICtxKey, Node } from "std/ui";
import { defaultOpForFieldType, eqFilterType } from "./dynamic_datagrid";
import type { Column, FilterType } from "./dynamic_datagrid";
import { styles as sharedStyles } from "./styles";
import { ToolbarPopover } from "./toolbar_popover";
import type { Color } from "components/types";

const styles = createStyles({
  checkboxWrapper: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    border: "1px solid",
    borderColor: "divider",
    borderRadius: "sm",
  },
  checkbox: {
    mx: 6,
  },
  groupHeaderRoot: {
    display: "flex",
    alignItems: "center",
    position: "relative",
  },
  groupHeaderText: {
    p: 0,
    m: 0,
    fontSize: "sm",
    color: "text-secondary",
  },
  termWrapper: { display: "flex", gap: 2 },
  isAnySelectorRoot: {
    width: 72,
    display: "flex",
    alignItems: "start",
    fontSize: "sm",
  },
  isAnyText: { pl: 2 },
  popoverMenu: {
    width: 200,
  },
  filterGroup: {
    backgroundColor: "neutral-100",
    dark: { backgroundColor: "neutral-700" },
    display: "flex",
    flexDirection: "column",
    borderRadius: "xs",
    px: 3,
    pb: 2,
    gap: 2,
    "&.leaf": {
      backgroundColor: "neutral-200",
      dark: { backgroundColor: "neutral-600" },
    },
  },
  termsWrapper: {
    py: 2,
    gap: 2,
    display: "flex",
    flexDirection: "column",
  },
  noTermsText: {
    mt: 0,
    mb: 2,
    color: "text-secondary",
    fontSize: "sm",
  },
  columnPickerButton: {
    minWidth: 220,
    maxWidth: 280,
    justifyContent: "space-between",
  },
  columnPickerButtonLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  columnPickerPopover: {
    width: 360,
  },
  columnPickerList: {
    maxHeight: 360,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 1,
    pt: 1,
  },
  columnPickerSection: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  columnPickerSectionHeader: {
    color: "text-tertiary",
    fontSize: "xs",
    fontWeight: "lg",
    textTransform: "uppercase",
    letterSpacing: 0,
    px: 1,
    pt: 1,
  },
  columnPickerOption: {
    appearance: "none",
    border: 0,
    backgroundColor: "transparent",
    borderRadius: "xs",
    color: "text-primary",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 2,
    minHeight: 34,
    px: 2,
    py: 1,
    textAlign: "left",
    width: "100%",
    "&:hover": {
      backgroundColor: "neutral-100",
      dark: { backgroundColor: "neutral-700" },
    },
    "&.selected": {
      backgroundColor: "primary-50",
      dark: { backgroundColor: "neutral-700" },
    },
    "&.highlighted": {
      backgroundColor: "neutral-100",
      dark: { backgroundColor: "neutral-700" },
    },
  },
  columnPickerOptionText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flexGrow: 1,
  },
  columnPickerOptionLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "sm",
  },
  columnPickerTypeBadge: {
    border: "1px solid",
    borderColor: "divider",
    borderRadius: "xs",
    color: "text-secondary",
    flexShrink: 0,
    fontSize: "xs",
    px: 1,
    py: "1px",
  },
  columnPickerCheck: {
    color: "primary-600",
    fontSize: "md",
    width: 20,
  },
});

const opsByType = {
  string: [
    <Select.Option value="str_eq">is</Select.Option>,
    <Select.Option value="str_ne">is not</Select.Option>,
    <Select.Option value="str_contains">contains</Select.Option>,
    <Select.Option value="str_not_contains">does not contain</Select.Option>,
    <Select.Option value="str_matches">matches</Select.Option>,
    <Select.Option value="str_not_matches">does not match</Select.Option>,
  ],
  number: [
    <Select.Option value="num_eq">=</Select.Option>,
    <Select.Option value="num_ne">≠</Select.Option>,
    <Select.Option value="num_lt">&lt;</Select.Option>,
    <Select.Option value="num_lte">≤</Select.Option>,
    <Select.Option value="num_gt">&gt;</Select.Option>,
    <Select.Option value="num_gte">≥</Select.Option>,
  ],
  date: [
    <Select.Option value="date_eq">is</Select.Option>,
    <Select.Option value="date_ne">is not</Select.Option>,
    <Select.Option value="date_lt">is before</Select.Option>,
    <Select.Option value="date_lte">is on or before</Select.Option>,
    <Select.Option value="date_gt">is after</Select.Option>,
    <Select.Option value="date_gte">is on or after</Select.Option>,
  ],
  timestamp: [
    <Select.Option value="timestamp_eq">is</Select.Option>,
    <Select.Option value="timestamp_ne">is not</Select.Option>,
    <Select.Option value="timestamp_lt">is before</Select.Option>,
    <Select.Option value="timestamp_lte">is on or before</Select.Option>,
    <Select.Option value="timestamp_gt">is after</Select.Option>,
    <Select.Option value="timestamp_gte">is on or after</Select.Option>,
  ],
  enum: [
    <Select.Option value="enum_eq">is</Select.Option>,
    <Select.Option value="enum_ne">is not</Select.Option>,
  ],
  table: [
    <Select.Option value="fk_eq">is</Select.Option>,
    <Select.Option value="fk_ne">is not</Select.Option>,
  ],
  bool: [
    <Select.Option value="bool_eq">is</Select.Option>,
    <Select.Option value="bool_ne">is not</Select.Option>,
  ],
  minutes_duration: [
    <Select.Option value="minute_duration_eq">=</Select.Option>,
    <Select.Option value="minute_duration_ne">≠</Select.Option>,
    <Select.Option value="minute_duration_lt">&lt;</Select.Option>,
    <Select.Option value="minute_duration_lte">≤</Select.Option>,
    <Select.Option value="minute_duration_gt">&gt;</Select.Option>,
    <Select.Option value="minute_duration_gte">≥</Select.Option>,
  ],
  enum_like_bool: [
    <Select.Option value="enum_like_bool_eq">is</Select.Option>,
  ],
};

const nullableOpts = [
  <Select.Option value="empty">is empty</Select.Option>,
  <Select.Option value="not_empty">is not empty</Select.Option>,
];

const dateOptions = [
  <Select.Option value="today">today</Select.Option>,
  <Select.Option value="tomorrow">tomorrow</Select.Option>,
  <Select.Option value="yesterday">yesterday</Select.Option>,
  <Select.Option value="week ago">week ago</Select.Option>,
  <Select.Option value="week from now">week from now</Select.Option>,
  <Select.Option value="month ago">month ago</Select.Option>,
  <Select.Option value="month from now">month from now</Select.Option>,
  <Select.Option value="number of days ago">
    number of days ago...
  </Select.Option>,
  <Select.Option value="number of days from now">
    number of days from now...
  </Select.Option>,
  <Select.Option value="exact date">exact date...</Select.Option>,
];

function typeSpecificOps(columns: Column[]): Node {
  const helper = useICtx(FilterTermICtxKey);
  interface TypeGenInfo {
    type: FilterType;
    notNull: boolean;
    columns: number[];
  }
  const genTypes: TypeGenInfo[] = [];
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (!column.filter || column.filter.type === "custom") {
      continue;
    }
    const prevInfo = genTypes.find((t) => eqFilterType(t.type, column.filter!));
    if (prevInfo) {
      prevInfo.columns.push(i);
      continue;
    }
    genTypes.push({
      type: column.filter,
      columns: [i],
      notNull: column.filter.notNull,
    });
  }
  genTypes.sort((a, b) => a.columns.length - b.columns.length);
  const switchCases: any[] = [];
  for (let i = 0; i < genTypes.length; i++) {
    const { columns, type, notNull } = genTypes[i];
    const caseExpr = i === genTypes.length - 1
      ? true
      : sql.inList(helper.columnId, columns);
    const opts: Node[] = [];
    if (type.type !== "custom") {
      opts.push(...opsByType[type.type]);
    }
    if (!notNull && type.type !== "enum_like_bool") {
      opts.push(...nullableOpts);
    }
    switchCases.push(<Match when={caseExpr}>{opts}</Match>);
  }
  return <Switch>{switchCases}</Switch>;
}

function ColumnFilter() {
  const { columns, triggerChangesInToolbar } = useICtx(
    DynamicDatagridICtxKey,
  );
  const filterTermHelper = new FilterTermHelper();
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  return (
    <>
      <FilterColumnPicker
        columns={columns}
        filterTermHelper={filterTermHelper}
      />
      <Show when={sql`${filterTermHelper.op} != 'custom'`}>
        <Select
          variant="outlined"
          color="neutral"
          size="sm"
          id={sql.concat(
            useUniqueId(),
            sql`filter_term_record.id || 'column_filter_op'`,
          )}
          value={sql`${filterTermHelper.op}::string`}
          onInput={(s) => {
            s.defScalar(
              "new_op",
              sql`cast(target_value as enums.dg_filter_op)`,
            );
            s.if(sql`${filterTermHelper.op} != new_op`, (s) => {
              s.modify(
                sql`update ui.filter_terms set op = new_op where id = ${filterTermHelper.id}`,
              );
              triggerRefetch(s);
            });
            triggerChangesInToolbar(s);
          }}
          className="w-[150px]"
        >
          {typeSpecificOps(columns)}
        </Select>
      </Show>
      <Switch>{filterInputSwitchCases(columns, filterTermHelper)}</Switch>
      <IconButton
        variant="plain"
        color="neutral"
        size="sm"
        aria-label="Delete filter"
        icon="Delete"
        onClick={(s) => {
          s.modify(sql`delete from filter_term_record`);
          triggerRefetch(s);
          triggerChangesInToolbar(s);
        }}
      />
    </>
  );
}

interface FilterColumnPickerProps {
  columns: Column[];
  filterTermHelper: FilterTermHelper;
}

interface FilterColumnPickerItem {
  id: number;
  label: string;
  typeLabel: string;
  customSection?: string;
  hasDisplayColumn: boolean;
}

function filterColumnPickerItems(columns: Column[]): FilterColumnPickerItem[] {
  return columns.flatMap((col, id) => {
    if (!col.filterDisplayName || !col.filter) {
      return [];
    }
    const customSection = col.filterOptGroup && col.filterOptGroup !== "Field"
      ? col.filterOptGroup
      : undefined;
    return [{
      id,
      label: col.filterDisplayName,
      typeLabel: filterTypeLabel(col.filter),
      customSection,
      hasDisplayColumn: Boolean(col.displayInfo),
    }];
  });
}

function filterTypeLabel(filter: FilterType) {
  switch (filter.type) {
    case "string":
      return "Text";
    case "number":
      return "Number";
    case "date":
      return "Date";
    case "timestamp":
      return "Time";
    case "enum":
      return "Select";
    case "table":
      return "Related";
    case "bool":
    case "enum_like_bool":
      return "Yes/no";
    case "minutes_duration":
      return "Duration";
    case "custom":
      return "Custom";
  }
}

function pickerSearchCondition(record: Sql): BooleanExpr {
  return sql`trim(filter_text) = '' or contains(lower(${record}.label || ' ' || ${record}.type_label), lower(trim(filter_text)))`;
}

function pickerSectionCondition(
  record: Sql,
  section: FilterColumnPickerSection,
  customSection?: string,
): BooleanExpr {
  if (section === "visible") {
    return sql`${record}.custom_section is null and ${record}.has_display_column and ${record}.is_displaying`;
  }
  if (section === "hidden") {
    return sql`${record}.custom_section is null and ${record}.has_display_column and not ${record}.is_displaying`;
  }
  if (section === "filter-only") {
    return sql`${record}.custom_section is null and not ${record}.has_display_column`;
  }
  return sql`${record}.custom_section = ${sql.lit(customSection ?? "")}`;
}

function pickerSectionOrder(record: Sql): Sql {
  return sql`case
    when ${record}.custom_section is not null then 3
    when ${record}.has_display_column and ${record}.is_displaying then 0
    when ${record}.has_display_column then 1
    else 2
  end`;
}

function pickerOrderBy(record: Sql): Sql {
  return sql`${
    pickerSectionOrder(record)
  }, coalesce(${record}.custom_section, ''), lower(${record}.label), ${record}.id`;
}

function defVisiblePickerColumns(s: DomStatements) {
  const record = sql.ref("filter_picker_column");
  s.defTable(
    "visible_filter_picker_columns",
    sql`select id,
          row_number() over (order by ${
      pickerOrderBy(record)
    }) - 1 as picker_index
        from filter_picker_column
        where ${pickerSearchCondition(record)}`,
  );
}

function refreshPickerColumnDisplayState<T extends IStatementsBase>(s: T) {
  s.modify(
    sql`update filter_picker_column set is_displaying = filter_picker_column.id in (select id from ui.column where displaying)`,
  );
}

function highlightFirstVisiblePickerColumn(s: DomStatements) {
  defVisiblePickerColumns(s);
  s.setScalar(
    "highlighted_column_id",
    sql`(select id from visible_filter_picker_columns order by picker_index limit 1)`,
  );
}

function highlightNextVisiblePickerColumn(s: DomStatements) {
  defVisiblePickerColumns(s);
  s.setScalar(
    "highlighted_column_id",
    sql`coalesce(
      (
        select id
        from visible_filter_picker_columns
        where picker_index > coalesce(
          (select picker_index from visible_filter_picker_columns where id = highlighted_column_id),
          -1
        )
        order by picker_index
        limit 1
      ),
      (select id from visible_filter_picker_columns order by picker_index limit 1)
    )`,
  );
}

function highlightPrevVisiblePickerColumn(s: DomStatements) {
  defVisiblePickerColumns(s);
  s.setScalar(
    "highlighted_column_id",
    sql`coalesce(
      (
        select id
        from visible_filter_picker_columns
        where picker_index < coalesce(
          (select picker_index from visible_filter_picker_columns where id = highlighted_column_id),
          (select count(*) from visible_filter_picker_columns)
        )
        order by picker_index desc
        limit 1
      ),
      (select id from visible_filter_picker_columns order by picker_index desc limit 1)
    )`,
  );
}

function setFilterColumnId(
  s: DomStatements,
  columnId: NumericExpr,
  filterTermHelper: FilterTermHelper,
  fns: DynamicDatagridICtx["fns"],
  triggerRefetch: CurrentRefetchICtx["triggerRefetch"],
  triggerChangesInToolbar: DynamicDatagridICtx["triggerChangesInToolbar"],
) {
  s.if(sql`${filterTermHelper.columnId} != ${columnId}`, (s) => {
    s.modify(
      sql`update filter_term_record set column_id = ${columnId}, op = ${
        fns.idToDefaultOp(columnId)
      }, value_1 = null, value_2 = null, value_3 = null`,
    );
    triggerRefetch(s);
  });
  triggerChangesInToolbar(s);
  s.setScalar("popover_open", false);
  s.setScalar("filter_text", sql.lit``);
}

function selectHighlightedFilterColumn(
  s: DomStatements,
  filterTermHelper: FilterTermHelper,
  fns: DynamicDatagridICtx["fns"],
  triggerRefetch: CurrentRefetchICtx["triggerRefetch"],
  triggerChangesInToolbar: DynamicDatagridICtx["triggerChangesInToolbar"],
) {
  s.returnIf(sql`highlighted_column_id is null`);
  setFilterColumnId(
    s,
    sql`highlighted_column_id`,
    filterTermHelper,
    fns,
    triggerRefetch,
    triggerChangesInToolbar,
  );
}

function columnPickerKeyDown(
  s: DomStatements,
  filterTermHelper: FilterTermHelper,
  fns: DynamicDatagridICtx["fns"],
  triggerRefetch: CurrentRefetchICtx["triggerRefetch"],
  triggerChangesInToolbar: DynamicDatagridICtx["triggerChangesInToolbar"],
) {
  s.returnIf(
    sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
  );
  s.if(sql`event.key = 'Escape'`, (s) => {
    s.event.preventDefault();
    s.setScalar("popover_open", false);
    s.return();
  });
  s.if(sql`event.key = 'ArrowDown'`, (s) => {
    s.event.preventDefault();
    highlightNextVisiblePickerColumn(s);
    s.return();
  });
  s.if(sql`event.key = 'ArrowUp'`, (s) => {
    s.event.preventDefault();
    highlightPrevVisiblePickerColumn(s);
    s.return();
  });
  s.if(sql`event.key = 'Enter'`, (s) => {
    s.event.preventDefault();
    selectHighlightedFilterColumn(
      s,
      filterTermHelper,
      fns,
      triggerRefetch,
      triggerChangesInToolbar,
    );
    s.return();
  });
}

function FilterColumnPicker(props: FilterColumnPickerProps) {
  const { fns, triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const pickerItems = filterColumnPickerItems(props.columns);
  const pickerItemValues = pickerItems.map((item) =>
    valuesRow(
      item.id,
      sql.lit(item.label),
      sql.lit(item.typeLabel),
      item.customSection ? sql.lit(item.customSection) : sql.null,
      item.hasDisplayColumn,
      false,
    )
  );
  const customSections = Array.from(
    new Set(
      pickerItems
        .map((item) => item.customSection)
        .filter((section): section is string => Boolean(section)),
    ),
  );
  const pickerButtonId = sql.concat(
    useUniqueId(),
    sql`filter_term_record.id || 'filter_column_picker'`,
  );
  const listboxId = sql.concat(pickerButtonId, "_listbox");
  const setColumn = (s: DomStatements, columnId: NumericExpr) =>
    setFilterColumnId(
      s,
      columnId,
      props.filterTermHelper,
      fns,
      triggerRefetch,
      triggerChangesInToolbar,
    );
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defTable("filter_picker_column", {
          fields: [
            { name: "id", type: "SmallUint", notNull: true },
            { name: "label", type: { type: "String", maxLength: 200 } },
            { name: "type_label", type: { type: "String", maxLength: 50 } },
            {
              name: "custom_section",
              type: { type: "String", maxLength: 200 },
            },
            { name: "has_display_column", type: "Bool", notNull: true },
            { name: "is_displaying", type: "Bool", notNull: true },
          ],
        });
        s.modify(
          sql`insert into filter_picker_column (id, label, type_label, custom_section, has_display_column, is_displaying) values ${pickerItemValues}`,
        );
        refreshPickerColumnDisplayState(s);
        s.defScalar("popover_open", false);
        s.defScalar("filter_text", sql.lit``);
        s.defScalar("highlighted_column_id", {
          type: "SmallUint",
        });
        s.defScalar("input_focus_key", {
          type: "BigInt",
        });
      }}
    >
      <Button
        variant="outlined"
        color="neutral"
        size="sm"
        id={pickerButtonId}
        endIcon="KeyboardArrowDown"
        sx={styles.columnPickerButton}
        onClick={(s) => {
          s.if(sql`popover_open`, (s) => {
            s.setScalar("popover_open", false);
            s.return();
          });
          s.setScalar("popover_open", true);
          refreshPickerColumnDisplayState(s);
          highlightFirstVisiblePickerColumn(s);
          s.setScalar(
            "input_focus_key",
            sql`coalesce(input_focus_key + 1, 0)`,
          );
        }}
      >
        <span sx={styles.columnPickerButtonLabel}>
          {fns.idToFilterDisplayName(props.filterTermHelper.columnId)}
        </span>
      </Button>
      <Show when={sql`popover_open`}>
        <ToolbarPopover
          openScalar={sql.ref("ui.popover_open")}
          buttonId={pickerButtonId}
        >
          <div sx={styles.columnPickerPopover}>
            <Input
              variant="outlined"
              color="neutral"
              size="sm"
              value={sql`filter_text`}
              placeholder="Find a column..."
              startIcon="Search"
              role="combobox"
              aria-controls={listboxId}
              aria-expanded={sql`popover_open`}
              aria-activedescendant={sql`case when highlighted_column_id is null then null else 'filter_column_picker_opt_' || highlighted_column_id end`}
              yolmFocusKey={sql`input_focus_key`}
              onKeyDown={(s) => {
                columnPickerKeyDown(
                  s,
                  props.filterTermHelper,
                  fns,
                  triggerRefetch,
                  triggerChangesInToolbar,
                );
              }}
              onInput={(s) => {
                s.setScalar("filter_text", sql`target_value`);
                highlightFirstVisiblePickerColumn(s);
              }}
            />
            <div
              sx={styles.columnPickerList}
              id={listboxId}
              role="listbox"
            >
              <FilterColumnPickerSection
                title="Visible columns"
                section="visible"
                filterTermHelper={props.filterTermHelper}
                setColumn={setColumn}
              />
              <FilterColumnPickerSection
                title="Hidden columns"
                section="hidden"
                filterTermHelper={props.filterTermHelper}
                setColumn={setColumn}
              />
              <FilterColumnPickerSection
                title="Filter-only fields"
                section="filter-only"
                filterTermHelper={props.filterTermHelper}
                setColumn={setColumn}
              />
              {customSections.map((section) => (
                <FilterColumnPickerSection
                  title={section}
                  section="custom"
                  filterTermHelper={props.filterTermHelper}
                  setColumn={setColumn}
                />
              ))}
              <Show
                when={sql`not exists (select 1 from filter_picker_column where ${
                  pickerSearchCondition(sql.ref("filter_picker_column"))
                })`}
              >
                <p sx={styles.noTermsText}>No matching columns</p>
              </Show>
            </div>
          </div>
        </ToolbarPopover>
      </Show>
    </Data>
  );
}

type FilterColumnPickerSection =
  | "visible"
  | "hidden"
  | "filter-only"
  | "custom";

interface FilterColumnPickerSectionProps {
  title: string;
  section: FilterColumnPickerSection;
  filterTermHelper: FilterTermHelper;
  setColumn: (s: DomStatements, columnId: NumericExpr) => void;
}

function FilterColumnPickerSection(props: FilterColumnPickerSectionProps) {
  const pickerColumn = sql.ref("filter_picker_column");
  const sectionCondition = pickerSectionCondition(
    pickerColumn,
    props.section,
    props.title,
  );
  const visibleCondition = sql.and(
    sectionCondition,
    pickerSearchCondition(pickerColumn),
  );
  return (
    <Show
      when={sql`exists (select 1 from filter_picker_column where ${visibleCondition})`}
    >
      <div sx={styles.columnPickerSection}>
        <div sx={styles.columnPickerSectionHeader}>{props.title}</div>
        <Each
          table="filter_picker_column"
          where={visibleCondition}
          orderBy={pickerOrderBy(pickerColumn)}
          eachKey={sql`id`}
          recordName="filter_picker_column"
        >
          <>
            <button
              type="button"
              className="listbox-item"
              sx={styles.columnPickerOption}
              dynamicClasses={[
                {
                  classes: "selected",
                  condition:
                    sql`${props.filterTermHelper.columnId} = filter_picker_column.id`,
                },
                {
                  classes: "highlighted",
                  condition:
                    sql`highlighted_column_id = filter_picker_column.id`,
                },
              ]}
              role="option"
              id={sql`'filter_column_picker_opt_' || filter_picker_column.id`}
              aria-selected={sql`${props.filterTermHelper.columnId} = filter_picker_column.id`}
              aria-label={sql`filter_picker_column.label`}
              value={sql`filter_picker_column.id`}
              onMouseEnter={(s) => {
                s.setScalar(
                  "highlighted_column_id",
                  sql`filter_picker_column.id`,
                );
              }}
              onClick={(s) => props.setColumn(s, sql`filter_picker_column.id`)}
            >
              <span sx={styles.columnPickerOptionText}>
                <span sx={styles.columnPickerOptionLabel}>
                  {sql`filter_picker_column.label`}
                </span>
              </span>
              <span sx={styles.columnPickerTypeBadge}>
                {sql`filter_picker_column.type_label`}
              </span>
              <span sx={styles.columnPickerCheck}>
                <Show
                  when={sql`${props.filterTermHelper.columnId} = filter_picker_column.id`}
                >
                  <MaterialIcon icon="Check" />
                </Show>
              </span>
            </button>
          </>
        </Each>
      </div>
    </Show>
  );
}

function filterInputSwitchCases(
  columns: Column[],
  filterTermHelper: FilterTermHelper,
) {
  const cases: JSX.Element[] = [];
  if (columns.some((col) => col.filter?.type === "string")) {
    cases.push(
      <Match when={sql`fn.is_string_filter_op(${filterTermHelper.op})`}>
        <FilterStringInput />
      </Match>,
    );
  }
  if (columns.some((col) => col.filter?.type === "number")) {
    cases.push(
      <Match when={sql`fn.is_number_filter_op(${filterTermHelper.op})`}>
        <FilterNumberInput />
      </Match>,
    );
  }
  if (
    columns.some(
      (col) => col.filter?.type === "date" || col.filter?.type === "timestamp",
    )
  ) {
    cases.push(
      <Match
        when={sql`fn.is_date_filter_op(${filterTermHelper.op}) or fn.is_timestamp_filter_op(${filterTermHelper.op})`}
      >
        <FilterDateInput />
      </Match>,
    );
  }
  if (columns.some((col) => col.filter?.type === "enum")) {
    cases.push(
      <Match when={sql`fn.is_enum_filter_op(${filterTermHelper.op})`}>
        {enumSelect(columns, filterTermHelper)}
      </Match>,
    );
  }
  if (columns.some((col) => col.filter?.type === "table")) {
    cases.push(
      <Match when={sql`fn.is_fk_filter_op(${filterTermHelper.op})`}>
        {tableInput(columns, filterTermHelper)}
      </Match>,
    );
  }
  if (columns.some((col) => col.filter?.type === "bool")) {
    cases.push(
      <Match
        when={sql`${filterTermHelper.op} in ('bool_eq', 'bool_ne')`}
      >
        <CheckboxFilter />
      </Match>,
    );
  }
  if (columns.some((col) => col.filter?.type === "enum_like_bool")) {
    cases.push(
      <Match when={sql`${filterTermHelper.op} = 'enum_like_bool_eq'`}>
        {enumLikeBoolSelect(columns, filterTermHelper)}
      </Match>,
    );
  }
  if (columns.some((col) => col.filter?.type === "minutes_duration")) {
    cases.push(
      <Match
        when={sql`fn.is_minute_duration_filter_op(${filterTermHelper.op})`}
      >
        <FilterDurationInput />
      </Match>,
    );
  }
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.filter?.type === "custom" && col.filter.node) {
      cases.push(
        <Match when={sql`${filterTermHelper.columnId} = ${i}`}>
          {col.filter.node(filterTermHelper)}
        </Match>,
      );
    }
  }
  return cases;
}

function enumSelect(columns: Column[], filterTermHelper: FilterTermHelper) {
  const columnsByEnum: Record<string, number[]> = {};
  const customOptionCases: Node[] = [];
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column.filter?.type === "enum") {
      if (column.filter.optionsQuery) {
        customOptionCases.push(
          <Match when={sql`${filterTermHelper.columnId} = ${i}`}>
            <FilterEnumSelect
              enum={column.filter.enum}
              optionsQuery={column.filter.optionsQuery}
            />
          </Match>,
        );
        continue;
      }
      const enumName = column.filter.enum;
      if (!columnsByEnum[enumName]) {
        columnsByEnum[enumName] = [];
      }
      columnsByEnum[enumName].push(i);
    }
  }
  return (
    <Switch>
      {customOptionCases}
      {Object.entries(columnsByEnum).map(([enumName, cols]) => (
        <Match when={sql.inList(filterTermHelper.columnId, cols)}>
          <FilterEnumSelect enum={enumName} />
        </Match>
      ))}
    </Switch>
  );
}

function enumLikeBoolSelect(
  columns: Column[],
  filterTermHelper: FilterTermHelper,
) {
  const cols = [];
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].filter?.type === "enum_like_bool") {
      cols.push(i);
    }
  }
  return (
    <Switch>
      {cols.map((i) => {
        const col = columns[i];
        if (col.filter?.type !== "enum_like_bool") {
          throw new Error("impossible");
        }
        return (
          <Match when={sql`${filterTermHelper.columnId} = ${i}`}>
            <FilterEnumLikeBool
              enumLike={col.filter.config}
              notNull={col.filter.notNull}
            />
          </Match>
        );
      })}
    </Switch>
  );
}

function tableInput(columns: Column[], filterTermHelper: FilterTermHelper) {
  const columnsByTable: Record<string, number[]> = {};
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    if (column.filter?.type === "table") {
      const tableName = column.filter.table;
      if (!columnsByTable[tableName]) {
        columnsByTable[tableName] = [];
      }
      columnsByTable[tableName].push(i);
    }
  }
  return (
    <Switch>
      {Object.entries(columnsByTable).map(([tableName, cols]) => (
        <Match when={sql.inList(filterTermHelper.columnId, cols)}>
          <FkFilter table={tableName} />
        </Match>
      ))}
    </Switch>
  );
}

function IsAnySelector() {
  const isAny = sql`case
    when filter_term_record.recursion_depth = 0
      then ui.root_filter_is_any
    else (select is_any from filter_terms where id = filter_term_record.group_id) end`;
  return (
    <div sx={styles.isAnySelectorRoot}>
      <Switch>
        <Match when={sql`filter_term_record.iteration_index = 0`}>
          <span sx={styles.isAnyText}>Where</span>
        </Match>
        <Match when={sql`filter_term_record.iteration_index = 1`}>
          <Select
            variant="outlined"
            color="neutral"
            id={sql.concat(
              useUniqueId(),
              sql`filter_term_record.id || 'is_any_selector'`,
            )}
            size="sm"
            value={sql`${isAny}::string`}
            onInput={(s) => {
              s.conditional({
                condition: sql`filter_term_record.recursion_depth = 0`,
                then: (s) => {
                  s.setScalar(
                    "ui.root_filter_is_any",
                    sql`target_value = 'true'`,
                  );
                },
                else: (s) => {
                  s.modify(
                    sql`update filter_terms set is_any = target_value = 'true' where id = filter_term_record.group_id`,
                  );
                },
              });
              s.increment("ui.dg_refresh_key");
            }}
          >
            <Select.Option value="false">and</Select.Option>
            <Select.Option value="true">or</Select.Option>
          </Select>
        </Match>
        <Match when={sql`true`}>
          <span sx={styles.isAnyText}>
            {sql`case when ${isAny} then 'or' else 'and' end`}
          </span>
        </Match>
      </Switch>
    </div>
  );
}

function FilterPopover() {
  const { columns, triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  addCtx(new FilterTermHelper());
  return (
    <>
      <Show
        when={sql`exists (select 1 from ui.filter_terms)`}
        fallback={<p sx={styles.noTermsText}>No filters</p>}
      >
        <Recursive
          table="filter_terms"
          where={sql`group_id is null`}
          recursiveKey={sql`id`}
          recordName="filter_term_record"
          orderBy={sql`ordering`}
        >
          <div sx={styles.termWrapper}>
            <IsAnySelector />
            <Show
              when={sql`filter_term_record.is_any is null`}
              fallback={<FilterGroup />}
            >
              <ColumnFilter />
            </Show>
          </div>
        </Recursive>
      </Show>
      <div sx={sharedStyles.popoverButtons}>
        <Button
          variant="outlined"
          color="primary"
          size="sm"
          onClick={(s) => {
            insertFilter(s, columns);
            triggerChangesInToolbar(s);
          }}
        >
          Add condition
        </Button>
        <Button
          variant="outlined"
          color="primary"
          size="sm"
          onClick={(s) => {
            insertFilterGroup(s, columns);
            triggerChangesInToolbar(s);
          }}
        >
          Add condition group
        </Button>
      </div>
    </>
  );
}

function FilterGroup() {
  const { columns } = useICtx(DynamicDatagridICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  return (
    <div
      sx={styles.filterGroup}
      dynamicClasses={[
        {
          condition: sql`filter_term_record.recursion_depth = 1`,
          classes: "leaf",
        },
      ]}
    >
      <div sx={styles.groupHeaderRoot}>
        <p sx={styles.groupHeaderText}>
          {sql`case when filter_term_record.is_any then 'Any' else 'All' end || ' of the following are true...'`}
        </p>
        <div sx={flexGrowStyles} />
        <Conditional
          when={sql`filter_term_record.recursion_depth = 0`}
          then={
            <Menu>
              <Menu.IconButton
                icon="Add"
                aria-label="Add filter"
                variant="plain"
                color={"neutral" as Color}
                size="sm"
              />
              {/*Example_Menu_Start*/}
              <Menu.Content sx={styles.popoverMenu}>
                <Menu.Item
                  onClick={(s) =>
                    insertFilter(s, columns, sql`filter_term_record.id`)}
                >
                  Add condition
                </Menu.Item>
                <Menu.Item
                  onClick={(s) =>
                    insertFilterGroup(s, columns, sql`filter_term_record.id`)}
                >
                  Add condition group
                </Menu.Item>
              </Menu.Content>
              {/*Example_Menu_End*/}
            </Menu>
          }
          else={
            <IconButton
              variant="plain"
              color={"neutral" as Color}
              size="sm"
              aria-label="Add filter"
              icon="Add"
              onClick={(s) =>
                insertFilter(s, columns, sql`filter_term_record.id`)}
            />
          }
        />
        <IconButton
          variant="plain"
          color={"neutral" as Color}
          size="sm"
          aria-label="Delete filter group"
          icon="Delete"
          onClick={(s) => {
            s.defTable(
              "all_filters",
              sql`select id from filter_terms where group_id = filter_term_record.id union select filter_term_record.id`,
            );
            s.modify(
              sql`delete from filter_terms where id in (select id from all_filters) or group_id in (select id from all_filters)`,
            );
            triggerRefetch(s);
          }}
        />
      </div>
      <Recurse
        where={sql`recurse_record.group_id = filter_term_record.id`}
        recordName="recurse_record"
      />
    </div>
  );
}

function insertFilter(
  s: DomStatements,
  columns: Column[],
  parentGroup?: NumericExpr,
) {
  const columnId = columns.findIndex((col) => Boolean(col.filter));
  const defaultOp = defaultOpForFieldType(
    columns.find((col) => col.filter)!.filter!,
  );
  s.modify(
    parentGroup
      ? sql`insert into ui.filter_terms (id, column_id, group_id, ordering, op)
        values (
          ui.next_filter_id,
          ${columnId},
          ${parentGroup},
          ordering.n_after(ui.next_filter_id::bigint),
          ${sql.lit(defaultOp)}
        )`
      : sql`insert into ui.filter_terms (id, column_id, ordering, op)
        values (
          ui.next_filter_id,
          ${columnId},
          ordering.n_after(ui.next_filter_id::bigint),
          ${sql.lit(defaultOp)}
        )`,
  );
  s.increment("ui.next_filter_id");
}

function insertFilterGroup(
  s: DomStatements,
  columns: Column[],
  parentGroup?: NumericExpr,
) {
  const columnId = columns.findIndex((col) => Boolean(col.filter));
  const defaultOp = defaultOpForFieldType(
    columns.find((col) => col.filter)!.filter!,
  );
  s.modify(
    sql.insertValues(
      "ui.filter_terms",
      ["id", parentGroup ? "group_id" : undefined, "ordering", "is_any"],
      [
        sql`ui.next_filter_id`,
        parentGroup,
        sql`ordering.n_after(ui.next_filter_id::bigint)`,
        true,
      ],
    ),
  );
  s.modify(
    sql`insert into ui.filter_terms (group_id, id, ordering, column_id, op)
          values
        (
          ui.next_filter_id,
          ui.next_filter_id + 1,
          ordering.n_after((ui.next_filter_id + 1)::bigint),
          ${columnId},
          ${sql.lit(defaultOp)}
        )`,
  );
  s.setScalar("ui.next_filter_id", sql`ui.next_filter_id + 2`);
}

/**
 * Context instance + helper for a single filter term row. Exposes the
 * term's column/op/value scalars (backed by the current `filter_term_record`)
 * plus statement helpers to mutate them, and re-exports the per-type filter
 * input components so custom `filter.node` renderers can reuse them.
 *
 * @category Helper
 */
export class FilterTermHelper implements ContextInstance, FilterTermICtx {
  implementICtxs: ICtxKey<any>[] = [FilterTermICtxKey];

  id = sql.ref("filter_term_record.id");
  columnId = sql.ref("filter_term_record.column_id");
  op = sql.ref("filter_term_record.op");
  value1 = sql.ref("filter_term_record.value_1");
  value2 = sql.ref("filter_term_record.value_2");
  value3 = sql.ref("filter_term_record.value_3");

  setOp = <T extends IStatementsBase>(s: T, value: Sql) => {
    s.modify(sql`update filter_term_record set op = ${value}`);
  };

  setColumnId(value: NumericExpr) {
    return new BasicStatements().modify(
      sql`update filter_term_record set column_id = ${value}`,
    );
  }

  setValue1 = <T extends IStatementsBase>(s: T, value: AnyExpr) => {
    s.modify(sql`update filter_term_record set value_1 = ${value}`);
  };

  setValue2 = <T extends IStatementsBase>(s: T, value: AnyExpr) => {
    s.modify(sql`update filter_term_record set value_2 = ${value}`);
  };

  setValue3 = <T extends IStatementsBase>(s: T, value: AnyExpr) => {
    s.modify(sql`update filter_term_record set value_3 = ${value}`);
  };

  getValue(value: FilterValue = 1) {
    if (value === 1) {
      return this.value1;
    }
    if (value === 2) {
      return this.value2;
    }
    return this.value3;
  }

  setValue = <T extends IStatementsBase>(
    s: T,
    filterValue: FilterValue,
    expr: AnyExpr,
  ) => {
    if (filterValue === 1) {
      return this.setValue1(s, expr);
    }
    if (filterValue === 2) {
      return this.setValue2(s, expr);
    }
    return this.setValue3(s, expr);
  };

  DateInput = FilterDateInput;
  EnumInput = FilterEnumSelect;
  EnumLikeInput = FilterEnumLikeBool;
  NumberInput = FilterNumberInput;
  DurationInput = FilterDurationInput;
  StringInput = FilterStringInput;
  CheckboxInput = CheckboxFilter;
  FkInput = FkFilter;
}

/**
 * Hook for free-text filter inputs that should not refetch on every
 * keystroke. Returns an input handler that debounces {@link CurrentRefetchICtx}
 * refetch by 500ms and a blur handler that flushes any pending refetch
 * immediately. Defines the backing `debounce_handle` state.
 *
 * @category Hook
 */
export function useDebouncedRefetch() {
  useState((s) => {
    s.defScalar("debounce_handle", {
      type: "BigUint",
    });
    s.defScalar("did_trigger_refresh", false);
  });
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  return {
    debounceInputTriggerRefresh: (s: DomStatements) => {
      s.setScalar("did_trigger_refresh", false);
      s.if(
        sql`debounce_handle is not null`,
        (s) => s.cancelTask(sql`debounce_handle`),
      );
      s.startTaskWithOpts({
        detached: true,
        handleScalar: "task_handle",
        procedure: (s) => {
          s.sleep(500);
          triggerRefetch(s);
          s.setScalar("did_trigger_refresh", true);
          s.setScalar("debounce_handle", sql.null);
          s.commitUiTreeChanges();
        },
      });
      s.setScalar("debounce_handle", sql`task_handle`);
      return s;
    },
    debounceBlurHandler: (s: DomStatements) => {
      s.returnIf(sql`did_trigger_refresh`);
      s.if(sql`debounce_handle is not null`, (s) => {
        s.cancelTask(sql`debounce_handle`);
        s.setScalar("debounce_handle", sql.null);
        triggerRefetch(s);
      });
      return s;
    },
  };
}

export interface FilterStringInputProps {
  /** Which of the term's three value slots to bind to (defaults to 1). */
  value?: FilterValue;
}

/**
 * Debounced text input for a string filter term. Used as the value editor
 * for string-typed datagrid filter conditions.
 *
 * @category UI Component
 */
export function FilterStringInput(props: FilterStringInputProps) {
  const { debounceInputTriggerRefresh, debounceBlurHandler } =
    useDebouncedRefetch();
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const valueIdx = props.value ?? 1;
  const ctx = useICtx(FilterTermICtxKey);
  return (
    <Input
      size="sm"
      value={ctx.getValue(valueIdx)}
      onInput={(s) => {
        ctx.setValue(
          s,
          valueIdx,
          sql`case when target_value = '' then null else target_value end`,
        );
        debounceInputTriggerRefresh(s);
        triggerChangesInToolbar(s);
      }}
      onBlur={debounceBlurHandler}
    />
  );
}

/**
 * Value editor for an enum (or `country`) filter term. Renders the
 * appropriate select for the enum and refetches on change.
 *
 * @category UI Component
 */
export function FilterEnumSelect(props: FilterHelperEnumSelectProps) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const ctx = useICtx(FilterTermICtxKey);
  const valueIdx = props.value ?? 1;
  if (props.enum === "country") {
    return (
      <CountrySelect
        size="sm"
        id={sql.concat(
          useUniqueId(),
          sql`filter_term_record.id || 'country_filter'`,
        )}
        value={ctx.getValue(valueIdx)}
        onInput={(s, newValue) => {
          ctx.setValue(s, valueIdx, newValue);
          triggerRefetch(s);
          triggerChangesInToolbar(s);
        }}
      />
    );
  }
  return (
    <EnumSelect
      fullWidth
      size="sm"
      enum={props.enum}
      optionsQuery={props.optionsQuery}
      id={sql.concat(
        useUniqueId(),
        sql`filter_term_record.id || 'enum_filter'`,
      )}
      placeholder={sql.concat("Select a ", normalizeCase(props.enum).join(" "))}
      onInput={(s) => {
        ctx.setValue(s, valueIdx, sql`target_value`);
        triggerRefetch(s);
        triggerChangesInToolbar(s);
      }}
      value={ctx.getValue(valueIdx)}
    />
  );
}

export interface FilterHelperEnumSelectProps {
  /** Name of the enum whose values populate the select. */
  enum: string;
  /** Query-backed options with `value` and `label` columns. */
  optionsQuery?: Sql;
  /** Optional label for an explicit "no value" option. */
  emptyOption?: Sql;
  /** Which of the term's three value slots to bind to (defaults to 1). */
  value?: FilterValue;
}

/**
 * Value editor for a date/timestamp filter term. Offers relative presets
 * (today, week ago, etc.) plus exact-date and N-days inputs, writing the
 * preset into value 1 and the operand into value 2.
 *
 * @category UI Component
 */
export function FilterDateInput() {
  const ctx = useICtx(FilterTermICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <>
      <Select
        size="sm"
        value={sql`coalesce(${ctx.value1}, 'exact date')::string`}
        onInput={(s) => {
          s.if(
            sql`${ctx.value1} is null or ${ctx.value1} != target_value`,
            (s) => {
              s.defScalar(
                "new_value_2",
                sql`case
                  when ${ctx.value1} = 'exact date' or target_value = 'exact date' then null
                  when (${ctx.value1} like 'number%') != (target_value like 'number%') then null
                  else ${ctx.value2}
                end`,
              );
              ctx.setValue1(s, sql`target_value`);
              ctx.setValue2(s, sql`new_value_2`);
              triggerRefetch(s);
              triggerChangesInToolbar(s);
            },
          );
        }}
        className="w-[30%]"
      >
        {dateOptions}
      </Select>
      <Switch>
        <Match
          when={sql`${ctx.value1} in ('number of days ago', 'number of days from now')`}
        >
          <Input
            size="sm"
            value={ctx.value2}
            onInput={(s) => {
              s.if(sql`try_cast(target_value as int) is not null`, (s) => {
                ctx.setValue2(s, sql`target_value`);
              });
            }}
            onBlur={(s) => triggerRefetch(s)}
          />
        </Match>
        <Match
          when={sql`${ctx.value1} is null or ${ctx.value1} = 'exact date'`}
        >
          <Input
            size="sm"
            type="date"
            value={ctx.value2}
            onInput={(s) => {
              s.if(sql`literal.date(target_value) is not null`, (s) => {
                ctx.setValue1(s, sql.lit`exact date`);
                ctx.setValue2(s, sql`target_value`);
              });
            }}
            onBlur={(s) => triggerRefetch(s)}
          />
        </Match>
      </Switch>
    </>
  );
}

interface CheckboxFilterProps {
  value?: FilterValue;
}

/**
 * Value editor for a boolean filter term, rendered as a single checkbox.
 *
 * @category UI Component
 */
export function CheckboxFilter(props: CheckboxFilterProps) {
  const helper = useICtx(FilterTermICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const valueIdx = props.value ?? 1;
  return (
    <div sx={styles.checkboxWrapper}>
      <Checkbox
        variant="outlined"
        sx={styles.checkbox}
        checked={sql`${helper.getValue(valueIdx)} = 'true'`}
        onCheckboxChange={(s) => {
          helper.setValue(s, valueIdx, sql`cast(target_checked as string)`);
          triggerRefetch(s);
          triggerChangesInToolbar(s);
        }}
      />
    </div>
  );
}

/**
 * Debounced numeric value editor for a number filter term. Rejects
 * non-numeric input.
 *
 * @category UI Component
 */
export function FilterNumberInput(props: { value?: FilterValue }) {
  const { debounceInputTriggerRefresh, debounceBlurHandler } =
    useDebouncedRefetch();
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const ctx = useICtx(FilterTermICtxKey);
  const valueIdx = props.value ?? 1;
  return (
    <Input
      size="sm"
      value={ctx.getValue(valueIdx)}
      onInput={(s) => {
        s.if(
          sql`target_value = '' or try_cast(target_value as double) is not null`,
          (s) => {
            ctx.setValue(
              s,
              valueIdx,
              sql`case when target_value = '' then null else target_value end`,
            );
            debounceInputTriggerRefresh(s);
            triggerChangesInToolbar(s);
          },
        );
      }}
      onBlur={debounceBlurHandler}
    />
  );
}

/**
 * Debounced minutes-duration value editor for a `minutes_duration` filter
 * term.
 *
 * @category UI Component
 */
export function FilterDurationInput(props: { value?: FilterValue }) {
  const { debounceInputTriggerRefresh, debounceBlurHandler } =
    useDebouncedRefetch();
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const ctx = useICtx(FilterTermICtxKey);
  const valueIdx = props.value ?? 1;
  return (
    ////Example_DurationInput_Start
    <DurationInput
      size="sm"
      value={ctx.getValue(valueIdx)}
      onChange={(s, value) => {
        ctx.setValue(s, valueIdx, value);
        debounceInputTriggerRefresh(s);
        triggerChangesInToolbar(s);
      }}
      onBlur={debounceBlurHandler}
    />
    ////Example_DurationInput_End
  );
}

/**
 * Value editor for an "enum-like boolean" filter term (a boolean field
 * presented with custom labels via {@link BoolEnumLikeConfig}).
 *
 * @category UI Component
 */
export function FilterEnumLikeBool(props: {
  value?: FilterValue;
  /** Labels/config describing how the boolean is presented as enum-like options. */
  enumLike: BoolEnumLikeConfig;
  /** Whether the underlying field is non-nullable (drops the empty option). */
  notNull: boolean;
}) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  const ctx = useICtx(FilterTermICtxKey);
  const valueIdx = props.value ?? 1;
  return (
    <EnumLikeSelect
      size="sm"
      enumLike={props.enumLike}
      notNull={props.notNull}
      onInput={(s) => {
        ctx.setValue(
          s,
          valueIdx,
          sql`case when target_value = '' then null else target_value end`,
        );
        triggerRefetch(s);
        triggerChangesInToolbar(s);
      }}
      value={ctx.getValue(valueIdx)}
    />
  );
}

/**
 * Datagrid toolbar button that opens the filter builder popover. The label
 * reflects how many distinct fields are currently filtered. Rendered by
 * {@link DatagridToolbar} when filtering is enabled.
 *
 * @category UI Component
 */
export function ToolbarFilterButton() {
  useState((s) => {
    s.defScalar("popover_open", false);
  });
  const filterButtonId = useUniqueId();
  const buttonText = sql`case
    when filter_field_count = 0 then 'Filter'
    when filter_field_count = 1 then 'Filtered by 1 field'
    else 'Filtered by ' || filter_field_count || ' fields'
  end`;
  return (
    <>
      <Data
        local
        procedure={(s) => {
          s.defScalar("filter_field_count", {
            type: "BigInt",
            expr: sql`(select count(distinct column_id) from filter_terms)`,
          });
        }}
        watch={[sql`has_changes_refresh_key`]}
      >
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          startIcon="FilterAltOutlined"
          onClick={(s) => s.toggle("popover_open")}
          id={filterButtonId}
        >
          {buttonText}
        </Button>
      </Data>
      <ToolbarPopover
        openScalar={sql.ref("ui.popover_open")}
        buttonId={filterButtonId}
      >
        <FilterPopover />
      </ToolbarPopover>
    </>
  );
}

interface FkFilterProps {
  /** Name of the referenced table whose records are searched. */
  table: string;
}

/**
 * Value editor for a foreign-key (`table`) filter term. Renders a
 * {@link TableRecordSelect} and stores the chosen id in value 1 and its
 * display label in value 2.
 *
 * @category UI Component
 */
export function FkFilter(props: FkFilterProps) {
  const helper = useICtx(FilterTermICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    ////Example_TableRecordSelect_Start
    <TableRecordSelect
      variant="outlined"
      color="neutral"
      size="sm"
      id={sql.concat(useUniqueId(), sql`filter_term_record.id || 'fk_filter'`)}
      tableName={props.table}
      value={sql`try_cast(${helper.value1} as bigint)`}
      initialInputText={sql`coalesce(${helper.value2}, '')`}
      onComboboxSelectValue={(s, value, label) => {
        s.if(
          sql`${helper.value1} is null or ${helper.value1} != cast(${value} as string) or ${value} is null`,
          (s) => {
            helper.setValue1(s, sql`cast(${value} as string)`);
            helper.setValue2(s, label);
            triggerRefetch(s);
            triggerChangesInToolbar(s);
          },
        );
      }}
      onSelectValue={(s, value) => {
        s.if(
          sql`${helper.value1} is null or ${helper.value1} != cast(${value} as string)`,
          (s) => {
            helper.setValue1(s, sql`cast(${value} as string)`);
            triggerRefetch(s);
            triggerChangesInToolbar(s);
          },
        );
      }}
    />
    ////Example_TableRecordSelect_End
  );
}
