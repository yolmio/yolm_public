import { normalizeCase, pluralize, upcaseFirst } from "std/inflectors";
import { getHrefToRecordOptional } from "std/shared_contexts";
import { selectColumn, sql } from "../std/sql_utils";
import type { BooleanExpr, SelectColumn, Sql } from "../std/sql_utils";
import { buildRankedSearchTargets } from "std/search_utils";
import { DomStatements } from "std/statements";
import type { DomStatementsOrFn, RankedSearchTable } from "std/statements";
import { createStyles, cssVar } from "std/style_utils";
import { system } from "std/system";
import type { Table } from "std/system";
import { Data } from "std/data";
import {
  analyzeScalarTypeToSqlCast,
  yomFieldTypeToAnalyzeType,
} from "std/ictx";
import { Each, Match, Mode, Show, Switch, usePhase } from "std/ui";
import type { Node } from "std/ui";
import { SequentialIDGenerator } from "std/utils/sequential_id_generator";
import type * as yom from "std/yom";
import { Checkbox } from "./checkbox";
import { Chip } from "./chip";
import { Divider } from "./divider";
import { IconButton } from "./icon_button";
import { InlineFieldDisplay } from "./inline_field_display";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";
import { styles as modalStyles } from "./modal";
import { Typography } from "./typography";
import { getUniqueUiId } from "./utils";

// waiting to polish these

export interface TableSearchDisplay {
  expr: (record: Sql) => Sql;
  name: string;
  label?: Sql;
  type: yom.FieldType;
}

interface PreparedTableSearchDisplay {
  expr: (record: Sql) => Sql;
  name: string;
  label: Sql;
  type: yom.FieldType;
  display: (props: { value: Sql }) => Node;
}

interface TableSearchDialogProps {
  open: BooleanExpr;
  onClose: DomStatementsOrFn;
  table: string;
  displayValues?: (string | TableSearchDisplay)[];
}

const DEFAULT_FUZZY_CONFIG = sql.lit`null`;

function buildBestRankExpr(rankExprs: Sql[]): Sql {
  if (rankExprs.length === 0) {
    return sql.null;
  }
  let best = rankExprs[0];
  for (let i = 1; i < rankExprs.length; i++) {
    best = sql`case
      when ${best} is null then ${rankExprs[i]}
      when ${rankExprs[i]} is null then ${best}
      when ${best} <= ${rankExprs[i]} then ${best}
      else ${rankExprs[i]}
    end`;
  }
  return best;
}

const styles = createStyles({
  dialog: () => {
    return {
      ...modalStyles.modalLayoutStyles("fullscreenOnMobile"),
      boxSizing: "border-box",
      boxShadow: "md",
      fontFamily: cssVar("font-family-body"),
      lineHeight: cssVar("leading-normal"),
      padding: 0,
      outline: 0,
      border: "none",
      background: cssVar("palette-background-body"),
      md: {
        borderRadius: "lg",
        borderStyle: "solid",
        borderWidth: 1,
        borderColor: cssVar("palette-divider"),
        width: 700,
        minWidth: 700,
        minHeight: "initial",
        height: "min-content",
        mx: "auto",
        mt: 20,
        mb: "auto",
      },
    };
  },
  dialogInner: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  header: {
    display: "flex",
    height: 56,
    minHeight: 56,
    my: 2,
    mx: 4,
    alignItems: "center",
  },
  searchIcon: {
    color: "primary-500",
  },
  input: {
    appearance: "none",
    background: "transparent",
    border: 0,
    flexGrow: 1,
    fontSize: "1.2em",
    pl: 4,
    outline: "none",
    color: cssVar("palette-neutral-plain-color"),
  },
  listbox: {
    py: 2,
    px: 2,
    overflowY: "auto",
    maxHeight: "calc(100vh - 59px)",
    md: {
      maxHeight: "70vh",
    },
  },
  multiTableListbox: {
    px: 2,
  },
  resultsContainer: {
    py: 2,
    px: 2,
    overflowY: "auto",
    maxHeight: "calc(100vh - 59px)",
    md: {
      maxHeight: "70vh",
    },
  },
  option: {
    py: 3,
    px: 6,
    listStyle: "none",
    borderColor: "transparent",
    borderBottomColor: cssVar("palette-divider"),
    borderWidth: "1px",
    borderStyle: "solid",
    cursor: "pointer",
    display: "flex",
    gap: 2,
    justifyContent: "space-between",
    '&[aria-selected="true"]': {
      backgroundColor: cssVar("palette-primary-50"),
      borderColor: cssVar("palette-primary-500"),
      dark: {
        backgroundColor: cssVar("palette-primary-900"),
      },
      borderRadius: "10px",
      borderWidth: "1px",
      borderStyle: "solid",
    },
  },
  optionLabel: {
    fontSize: "base",
    fontWeight: "medium",
  },
  optionLabelContainer: {
    display: "flex",
    flexDirection: "column",
  },
  optionLeft: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  displayValues: {
    display: "flex",
    flexWrap: "wrap",
    gap: 2,
  },
  optionExtraData: {
    display: "flex",
    fontSize: "sm",
  },
  optionExtraDataLabel: {
    mr: 1,
    color: "text-secondary",
    my: 0,
    alignSelf: "flex-end",
  },
});

function SearchModal({
  onClose,
  open,
  children,
}: {
  onClose: DomStatementsOrFn;
  open: BooleanExpr;
  children: Node;
}) {
  return (
    <Show when={open}>
      <dialog
        sx={styles.dialog()}
        classes="skip-harmonize"
        yolmModalShowing={open}
        onClose={onClose}
        onDialogBackdropClick={onClose}
        onCancel={onClose}
      >
        {children}
      </dialog>
    </Show>
  );
}

function prepareDisplayValue(
  table: Table,
  value: string | TableSearchDisplay,
): PreparedTableSearchDisplay {
  if (typeof value === "string") {
    const field = table.fields[value];
    if (!field) {
      throw new Error(`Field ${value} does not exist on table ${table.name}`);
    }
    if (field.type === "ForeignKey") {
      const toTable = system.db.tables[field.table];
      if (toTable.recordDisplayName) {
        const nameExpr = toTable.recordDisplayName.expr(
          ...toTable.recordDisplayName.fields.map((f) =>
            sql`other.${sql.ref(f)}`
          ),
        );
        return {
          expr: (record) => {
            return sql`(select ${nameExpr} from ${toTable.identWithDb} as other where other.id = ${record}.${
              sql.ref(value)
            })`;
          },
          name: value,
          label: sql.lit(field.displayName),
          type: { type: "String", maxLength: 2000 },
          display: ({ value }) => value,
        };
      }
    }
    const type: yom.FieldType =
      field.type === "Tx" || field.type === "ForeignKey"
        ? { type: "BigUint" }
        : field.generateYomFieldType();
    return {
      expr: (record) => sql`${record}.${sql.ref(value)}`,
      name: value,
      label: sql.lit(field.displayName),
      type,
      display: (props) => (
        <InlineFieldDisplay field={field} value={props.value} />
      ),
    };
  }
  return {
    expr: value.expr,
    name: value.name,
    label: value.label ??
      sql.lit(upcaseFirst(normalizeCase(value.name).join(" "))),
    type: value.type,
    display: (props) => props.value,
  };
}

export function TableSearchDialog(props: TableSearchDialogProps) {
  if (usePhase() === "gather") {
    return;
  }
  const tableModel = system.db.tables[props.table];
  if (!tableModel.recordDisplayName) {
    throw new Error(
      `tableSearchDialog expects recordDisplayName to exist on table ${tableModel.name}`,
    );
  }
  if (!getHrefToRecordOptional(tableModel, sql`0`)) {
    throw new Error(
      `tableSearchDialog expects getHrefToRecord to exist on table ${tableModel.name}`,
    );
  }
  const displayValues = props.displayValues?.map((value) =>
    prepareDisplayValue(tableModel, value)
  );
  // todo - add KV functionality for local persistence (recent searches)
  const nameExpr = tableModel.recordDisplayName.expr(
    ...tableModel.recordDisplayName.fields.map((f) =>
      sql`record.${sql.ref(f)}`
    ),
  );
  const inputId = sql.lit(getUniqueUiId());
  const listboxId = sql.lit(getUniqueUiId());
  const optionId = (id: Sql) => sql.concat(inputId, "-", id);
  const fieldNameGenerator = new SequentialIDGenerator();
  const extraValuesIds: string[] = [];
  const tableFields = displayValues?.map((v): yom.ProcTableField => {
    const name = fieldNameGenerator.next();
    extraValuesIds.push(name);
    return { name, type: v.type };
  });
  // todo - add KV functionality for local persistence (selectFromDevice / selectToDevice for recent searches)
  const searchConfig = tableModel.getSearchConfig();
  if (!searchConfig) {
    throw new Error(`Table ${tableModel.name} does not have searchConfig`);
  }
  function scrollToItem(alignToTop: boolean, s: DomStatements) {
    return s.block((s) => {
      s.element(listboxId).getBoundingClientRect("container_rect");
      s.element(
        optionId(sql`(select id from ui.result where active)`),
      ).getBoundingClientRect("item_rect");
      s.unless(
        sql`item_rect.top >= container_rect.top and item_rect.bottom <= container_rect.bottom`,
        (s) => {
          s.element(
            optionId(sql`(select id from ui.result where active)`),
          ).scrollIntoView({
            block: alignToTop ? sql.lit`start` : sql.lit`end`,
          });
        },
      );
    });
  }
  return (
    <SearchModal onClose={props.onClose} open={props.open}>
      <div sx={styles.dialogInner}>
        <Data
          local
          noRefetch
          procedure={(s) => s.defScalar("query", sql.lit``)}
        >
          <Data
            watch={[sql`query`]}
            procedure={(s) => {
              s.defTable("result", {
                fields: [
                  {
                    name: "label",
                    type: { type: "String", maxLength: 1000 },
                    notNull: true,
                  },
                  { name: "id", type: "BigInt", notNull: true },
                  { name: "index", type: "BigInt", notNull: true },
                  { name: "active", type: "Bool", notNull: true },
                  { name: "is_recent", type: "Bool", notNull: true },
                  ...(tableFields ?? []),
                ],
              });
              // todo - add KV functionality for local persistence (load recent searches when query is empty)
              s.if(sql`trim(query) != ''`, (s) => {
                const searchTargets = buildRankedSearchTargets(
                  searchConfig,
                  "record",
                );
                const rankExpressions = searchTargets.map((target) => {
                  const matchesTarget =
                    sql`fuzzy_match(query, ${target.expr}, ${DEFAULT_FUZZY_CONFIG})`;
                  const rankForTarget =
                    sql`fuzzy_rank_key(query, ${target.expr}, ${DEFAULT_FUZZY_CONFIG}, ${target.priority})`;
                  return sql`case when ${matchesTarget} then ${rankForTarget} else null end`;
                });
                const bestRankExpr = buildBestRankExpr(rankExpressions);

                // Build select columns
                const selectColumns: SelectColumn[] = [
                  selectColumn(nameExpr, "label"),
                  selectColumn(
                    sql`rank() over (order by ${bestRankExpr}, record.${tableModel.primaryKeyIdent}) = 1`,
                    "active",
                  ),
                  selectColumn(
                    sql`rank() over (order by ${bestRankExpr}, record.${tableModel.primaryKeyIdent})`,
                    "index",
                  ),
                  selectColumn(sql.false, "is_recent"),
                  selectColumn(
                    sql`record.${tableModel.primaryKeyIdent}`,
                    "id",
                  ),
                ];

                // Add display value columns if they exist
                if (displayValues && displayValues.length > 0) {
                  displayValues.forEach((v, i) => {
                    selectColumns.push(
                      selectColumn(
                        v.expr(sql.ref("record")),
                        extraValuesIds[i],
                      ),
                    );
                  });
                }

                s.modify(sql`insert into result
                  select ${selectColumns}
                  from ${tableModel.identWithDb} as record
                  where ${bestRankExpr} is not null
                  order by ${bestRankExpr}, record.${tableModel.primaryKeyIdent}
                  limit 10
                `);
              });
            }}
          >
            <header sx={styles.header}>
              <label htmlFor={inputId} sx={styles.searchIcon}>
                <MaterialIcon icon="Search" fontSize="3xl" />
              </label>
              <Mode render={sql.lit`immediate`}>
                <input
                  sx={styles.input}
                  id={inputId}
                  placeholder="Search…"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  aria-controls={listboxId}
                  aria-expanded="true"
                  aria-activedescendant={optionId(
                    sql`(select id from ui.result where active)`,
                  )}
                  type="text"
                  spellCheck="false"
                  autoComplete="off"
                  autoCapitalize="off"
                  role="combobox"
                  value={sql`query`}
                  onInput={(s) => {
                    s.setScalar("ui.query", sql`target_value`);
                    s.modify(sql`update ui.result set active = false`);
                  }}
                  onKeyDown={(s) => {
                    s.if(sql`event.key = 'Escape'`, props.onClose);
                    s.returnIf(
                      sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
                    );
                    s.if(sql`event.key = 'Enter' or event.key = 'Tab'`, (s) => {
                      s.defScalar(
                        "result_id",
                        sql`(select id from ui.result where active)`,
                      );
                      s.if(sql`result_id is not null`, (s) => {
                        s.event.preventDefault();
                        // todo - add KV functionality for local persistence (updateRecentSearch)
                        s.navigate(
                          getHrefToRecordOptional(tableModel, sql`result_id`),
                        );
                        s.statements(props.onClose);
                      });
                      s.return();
                    });
                    s.if(sql`event.key = 'ArrowDown'`, (s) => {
                      s.event.preventDefault();
                      s.returnIf(sql`not exists (select id from ui.result)`);
                      s.defScalar(
                        "next_index",
                        sql`(select index from ui.result where active) + 1`,
                      );
                      s.modify(sql`update ui.result set active = false`);
                      s.conditional({
                        condition:
                          sql`exists (select id from ui.result where index = next_index)`,
                        then: (s) =>
                          s.modify(
                            sql`update ui.result set active = true where index = next_index`,
                          ),
                        else: (s) =>
                          s.modify(
                            sql`update ui.result set active = true where index = 1`,
                          ),
                      });
                      s.statements((s) => scrollToItem(false, s));
                      s.return();
                    });
                    s.if(sql`event.key = 'ArrowUp'`, (s) => {
                      s.event.preventDefault();
                      s.returnIf(sql`not exists (select index from ui.result)`);
                      s.defScalar(
                        "next_index",
                        sql`(select index from ui.result where active) - 1`,
                      );
                      s.modify(sql`update ui.result set active = false`);
                      s.conditional({
                        condition:
                          sql`exists (select id from ui.result where index = next_index)`,
                        then: (s) =>
                          s.modify(
                            sql`update ui.result set active = true where index = next_index`,
                          ),
                        else: (s) =>
                          s.modify(
                            sql`update ui.result set active = true where index = (select max(index) from ui.result)`,
                          ),
                      });
                      s.statements((s) => scrollToItem(true, s));
                      s.return();
                    });
                  }}
                />
              </Mode>
              <IconButton
                variant="plain"
                color="neutral"
                onClick={props.onClose}
                aria-label="Close search dialog"
              >
                <MaterialIcon icon="Close" />
              </IconButton>
            </header>
            <Divider />
            <ul id={listboxId} role="listbox" sx={styles.listbox}>
              <Each table="result" recordName="record" eachKey={sql`id`}>
                <li
                  id={optionId(sql`record.id`)}
                  role="option"
                  aria-selected={sql`record.active`}
                  tabIndex={0}
                  sx={styles.option}
                  onClick={(s) => {
                    // todo - add KV functionality for local persistence (updateRecentSearch)
                    s.navigate(
                      getHrefToRecordOptional(tableModel, sql`record.id`),
                    );
                    s.statements(props.onClose);
                  }}
                >
                  <div sx={styles.optionLeft}>
                    <Show when={sql`record.is_recent`}>
                      <MaterialIcon icon="History" fontSize="2xl" />
                    </Show>
                    <div sx={styles.optionLabelContainer}>
                      <span sx={styles.optionLabel}>{sql`record.label`}</span>
                      {displayValues && (
                        <div sx={styles.displayValues}>
                          {displayValues.map((v, i) => {
                            const value = sql`record.${
                              sql.ref(extraValuesIds[i])
                            }`;
                            const Component = v.display;
                            return (
                              <Show when={sql.isNotNull(value)}>
                                <div sx={styles.optionExtraData}>
                                  <p sx={styles.optionExtraDataLabel}>
                                    {sql.concat(v.label, ":")}
                                  </p>
                                  <span>
                                    <Component value={value} />
                                  </span>
                                </div>
                              </Show>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <Show when={sql`record.is_recent`}>
                    <IconButton
                      variant="plain"
                      size="sm"
                      onClick={(s) => {
                        s.event.stopPropagation();
                        // todo - add KV functionality for local persistence (delete recent search)
                        s.modify(
                          sql`delete from ui.result where id = record.id`,
                        );
                      }}
                      aria-label="Remove recent search"
                    >
                      <MaterialIcon icon="Close" />
                    </IconButton>
                  </Show>
                </li>
              </Each>
            </ul>
          </Data>
        </Data>
      </div>
    </SearchModal>
  );
}

export interface MultiTableSearchDialogTable {
  name: string;
  displayValues?: (string | TableSearchDisplay)[];
  icon: IconName;
}

interface PreparedMultiTableSearchDialogTable {
  name: string;
  tableModel: Table;
  icon: IconName;
  displayValues?: PreparedTableSearchDisplay[];
}

function fieldTypeToSqlCast(type: yom.FieldType): string {
  if (type.type === "PhoneNumber") return "phone_number";
  return analyzeScalarTypeToSqlCast(yomFieldTypeToAnalyzeType(type));
}

// Build configuration for multi-table search
function calcMultiTable(tables: PreparedMultiTableSearchDialogTable[]) {
  const extraRecordFields: yom.ProcTableField[] = [];
  const fieldTypes: Record<string, yom.FieldType> = {};
  const tableConfigs: RankedSearchTable[] = [];
  const fieldNameGenerator = new SequentialIDGenerator();
  const displayValueNames: Record<string, string[]> = {};
  let urlExpr = sql`case`;

  for (const table of tables) {
    const tableModel = system.db.tables[table.name];
    if (!tableModel.recordDisplayName) {
      throw new Error(
        `multiTableSearchDialog expects recordDisplayName to exist on table ${tableModel.name}`,
      );
    }
    if (!getHrefToRecordOptional(tableModel, sql`0`)) {
      throw new Error(
        `multiTableSearchDialog expects getHrefToRecord to exist, missing on ${tableModel.name}`,
      );
    }
    if (!tableModel.getSearchConfig()) {
      throw new Error(`Table ${tableModel.name} does not have searchConfig`);
    }
    if (table.displayValues) {
      displayValueNames[table.name] = [];
      for (const value of table.displayValues) {
        const name = fieldNameGenerator.next();
        displayValueNames[table.name].push(name);
        extraRecordFields.push({ name, type: value.type });
        fieldTypes[name] = value.type;
      }
    }
    const baseSearchConfig = tableModel.getSearchConfig();
    if (!baseSearchConfig) {
      throw new Error(`Table ${tableModel.name} does not have searchConfig`);
    }

    tableConfigs.push({
      ...baseSearchConfig,
      table: tableModel.name,
      disabled: sql.ref(`${table.name}_disabled`),
    });
    urlExpr = sql`${urlExpr} when record.table = ${sql.lit(table.name)} then ${
      getHrefToRecordOptional(tableModel, sql`record.id`)
    }`;
  }
  urlExpr = sql`${urlExpr} end`;
  return {
    extraRecordFields,
    fieldTypes,
    tableConfigs,
    urlExpr,
    displayValueNames,
  };
}

interface MultiTableSearchDialogProps {
  open: BooleanExpr;
  onClose: DomStatementsOrFn;
  tables: MultiTableSearchDialogTable[];
}

export function MultiTableSearchDialog(props: MultiTableSearchDialogProps) {
  if (usePhase() === "gather") {
    return null;
  }
  const inputId = sql.lit(getUniqueUiId());
  const listboxId = sql.lit(getUniqueUiId());
  const containerId = sql.lit(getUniqueUiId());
  const optionId = (id: Sql) => sql.concat(inputId, "-", id);
  const tables = props.tables.map((t): PreparedMultiTableSearchDialogTable => {
    const tableModel = system.db.tables[t.name];
    if (!tableModel) {
      throw new Error(`Table ${t.name} does not exist`);
    }
    return {
      name: t.name,
      icon: t.icon,
      tableModel,
      displayValues: t.displayValues?.map((v) =>
        prepareDisplayValue(tableModel, v)
      ),
    };
  });
  // todo - add KV functionality for local persistence (recent multi-table searches)
  const {
    extraRecordFields,
    fieldTypes,
    tableConfigs,
    displayValueNames,
    urlExpr,
  } = calcMultiTable(tables);
  function scrollToItem(alignToTop: boolean, s: DomStatements) {
    return s.block((s) => {
      s.element(containerId).getBoundingClientRect("container_rect");
      s.defScalar(
        "option_id",
        optionId(
          sql`(select table from ui.result where active) || '_' || (select id from ui.result where active)`,
        ),
      );
      s.element(sql`option_id`).getBoundingClientRect("item_rect");
      s.unless(
        sql`item_rect.top >= container_rect.top and item_rect.bottom <= container_rect.bottom`,
        (s) => {
          s.element(sql`option_id`).scrollIntoView({
            block: alignToTop ? sql.lit`start` : sql.lit`end`,
          });
        },
      );
    });
  }
  const tableFilters = (
    <div className="flex p-2 gap-2 flex-wrap">
      {/*Example_Typography_Start*/}
      <Typography level="body-sm">Filter results:</Typography>
      {/*Example_Typography_End*/}
      {props.tables.map((t) => (
        ////Example_Chip_Start
        <Chip
          color="neutral"
          variant="plain"
          size="sm"
          conditionalVariants={[
            {
              when: sql`not ${sql(t.name)}_disabled`,
              variant: "soft",
              color: "primary",
            },
          ]}
          startDecorator={
            <Show when={sql`not ${sql(t.name)}_disabled`}>
              <MaterialIcon icon="Check" />
            </Show>
          }
        >
          {/*Example_Checkbox_Start*/}
          <Checkbox
            size="sm"
            checked={sql`not ${sql(t.name)}_disabled`}
            label={sql.lit(pluralize(system.db.tables[t.name].displayName))}
            id={sql.lit`${t.name}_disabled`}
            color="neutral"
            variant="outlined"
            checkedVariation={{
              color: "primary",
              variant: "outlined",
            }}
            disableIcon
            overlay
            onChange={(s) => s.toggle(`${t.name}_disabled`)}
          />
          {/*Example_Checkbox_End*/}
        </Chip>
        ////Example_Chip_End
      ))}
    </div>
  );
  return (
    <SearchModal onClose={props.onClose} open={props.open}>
      <div sx={styles.dialogInner}>
        <Data
          local
          noRefetch
          procedure={(s) => {
            s.defScalar("query", sql.lit``);
            s.mapArrayToStatements(props.tables, (table, s) =>
              s.defScalar(`${table.name}_disabled`, false));
          }}
        >
          <Data
            watch={[
              sql`query`,
              ...props.tables.map((t) =>
                sql`${sql(t.name)}_disabled`
              ),
            ]}
            procedure={(s) => {
              s.defTable("result", {
                fields: [
                  {
                    name: "label",
                    type: { type: "String", maxLength: 1000 },
                    notNull: true,
                  },
                  { name: "id", type: "BigInt", notNull: true },
                  {
                    name: "table",
                    type: { type: "Enum", enum: "sys_db_table" },
                    notNull: true,
                  },
                  { name: "index", type: "BigInt", notNull: true },
                  { name: "active", type: "Bool", notNull: true },
                  { name: "is_recent", type: "Bool", notNull: true },
                  ...extraRecordFields,
                ],
              });
              // todo - add KV functionality for local persistence (load recent multi-table searches when query is empty)
              s.if(sql`trim(query) != ''`, (s) => {
                const unionParts: Sql[] = [];

                for (const tc of tableConfigs) {
                  const tableName = typeof tc.table === "string"
                    ? tc.table
                    : tc.table.toSQL();
                  const tableModel = system.db.tables[tableName];
                  if (!tableModel) continue;

                  const searchTargets = buildRankedSearchTargets(tc, tableName);
                  const rankExpressions = searchTargets.map((target) => {
                    const matchesTarget =
                      sql`fuzzy_match(query, ${target.expr}, ${DEFAULT_FUZZY_CONFIG})`;
                    const rankForTarget =
                      sql`fuzzy_rank_key(query, ${target.expr}, ${DEFAULT_FUZZY_CONFIG}, ${target.priority})`;
                    return sql`case when ${matchesTarget} then ${rankForTarget} else null end`;
                  });
                  const bestRankExpr = buildBestRankExpr(rankExpressions);
                  const whereConditions: BooleanExpr[] = [];

                  if (tc.disabled) {
                    whereConditions.push(sql`not ${tc.disabled}`);
                  }
                  if (tc.filterExpr) whereConditions.push(tc.filterExpr);
                  whereConditions.push(sql`${bestRankExpr} is not null`);

                  const whereClause = whereConditions.reduce((acc, cond, i) =>
                    i === 0 ? cond : sql`${acc} and ${cond}`
                  );

                  const nameExpr = tableModel.recordDisplayName!.expr(
                    ...tableModel.recordDisplayName!.fields.map((f) =>
                      sql`${sql.ref(tableName)}.${sql.ref(f)}`
                    ),
                  );

                  // Build extra values for this table
                  const tableInfo = tables.find((t) => t.name === tableName);
                  const extraColumns: Sql[] = [];
                  if (tableInfo && displayValueNames[tableName]) {
                    const displayVals = tableInfo.displayValues?.map((v, i) => {
                      const preparedVal = prepareDisplayValue(
                        tableModel,
                        v,
                      );
                      return sql`${preparedVal.expr(sql.ref(tableName))} as ${
                        sql.ref(displayValueNames[tableName][i])
                      }`;
                    }) ?? [];
                    extraColumns.push(...displayVals);
                  }
                  // Fill in typed nulls for other tables' extra columns
                  for (
                    const [otherTable, otherNames] of Object.entries(
                      displayValueNames,
                    )
                  ) {
                    if (otherTable !== tableName) {
                      extraColumns.push(...otherNames.map((name) => {
                        const ft = fieldTypes[name];
                        if (ft) {
                          return sql`cast(null as ${
                            sql(fieldTypeToSqlCast(ft))
                          }) as ${sql.ref(name)}`;
                        }
                        return sql`null as ${sql.ref(name)}`;
                      }));
                    }
                  }

                  unionParts.push(sql`
                    select
                      cast(${
                    sql.lit(tableName)
                  } as enums.sys_db_table) as table,
                      ${sql.ref(tableName)}.${tableModel.primaryKeyIdent} as id,
                      ${nameExpr} as label,
                      ${bestRankExpr} as rank_key
                      ${extraColumns.length ? sql`, ${extraColumns}` : sql``}
                    from ${tableModel.identWithDb} as ${sql.ref(tableName)}
                    where ${whereClause}
                  `);
                }

                if (unionParts.length > 0) {
                  const unionQuery = unionParts.reduce((acc, part, index) => {
                    if (index === 0) return part;
                    return sql`${acc} union all ${part}`;
                  });

                  s.modify(sql`
                    insert into result
                    select
                      label,
                      rank() over (order by rank_key, id) = 1 as active,
                      rank() over (order by rank_key, id) as index,
                      false as is_recent,
                      table,
                      id
                      ${
                    extraRecordFields.length > 0
                      ? sql`, ${extraRecordFields.map((f) => sql.ref(f.name))}`
                      : sql``
                  }
                    from (
                      ${unionQuery}
                    ) as search_results
                    order by rank_key, id
                    limit 20
                  `);
                }
              });
            }}
          >
            <header sx={styles.header}>
              <label sx={styles.searchIcon} htmlFor={inputId}>
                <MaterialIcon icon="Search" fontSize="3xl" />
              </label>
              <input
                sx={styles.input}
                id={inputId}
                placeholder="Search…"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-expanded="true"
                aria-activedescendant={optionId(
                  sql`(select id from ui.result where active)`,
                )}
                type="text"
                spellCheck="false"
                autoComplete="off"
                autoCapitalize="off"
                role="combobox"
                value={sql`query`}
                onInput={(s) => {
                  s.setScalar("ui.query", sql`target_value`);
                  s.modify(sql`update ui.result set active = false`);
                }}
                onKeyDown={(s) => {
                  s.if(sql`event.key = 'Escape'`, props.onClose);
                  s.if(
                    sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
                    (s) => {
                      s.return();
                    },
                  );
                  s.if(sql`event.key = 'Enter' or event.key = 'Tab'`, (s) => {
                    s.defRecord(
                      "record",
                      sql`select id, table from ui.result where active`,
                    );
                    s.if(sql`record.id is not null`, (s) => {
                      s.event.preventDefault();
                      // todo - add KV functionality for local persistence (updateRecentSearch)
                      s.navigate(urlExpr);
                      s.statements(props.onClose);
                    });
                    s.return();
                  });
                  s.if(sql`event.key = 'ArrowDown'`, (s) => {
                    s.event.preventDefault();
                    s.returnIf(sql`not exists (select id from ui.result)`);
                    s.defScalar(
                      "next_index",
                      sql`(select index from ui.result where active) + 1`,
                    );
                    s.modify(sql`update ui.result set active = false`);
                    s.conditional({
                      condition:
                        sql`exists (select id from ui.result where index = next_index)`,
                      then: (s) =>
                        s.modify(
                          sql`update ui.result set active = true where index = next_index`,
                        ),
                      else: (s) =>
                        s.modify(
                          sql`update ui.result set active = true where index = 1`,
                        ),
                    });
                    s.statements((s) => scrollToItem(false, s));
                    s.return();
                  });
                  s.if(sql`event.key = 'ArrowUp'`, (s) => {
                    s.event.preventDefault();
                    s.returnIf(sql`not exists (select index from ui.result)`);
                    s.defScalar(
                      "next_index",
                      sql`(select index from ui.result where active) - 1`,
                    );
                    s.modify(sql`update ui.result set active = false`);
                    s.conditional({
                      condition:
                        sql`exists (select id from ui.result where index = next_index)`,
                      then: (s) =>
                        s.modify(
                          sql`update ui.result set active = true where index = next_index`,
                        ),
                      else: (s) =>
                        s.modify(
                          sql`update ui.result set active = true where index = (select max(index) from ui.result)`,
                        ),
                    });
                    s.statements((s) => scrollToItem(true, s));
                    s.return();
                  });
                }}
              />
              <IconButton
                variant="plain"
                color="neutral"
                onClick={props.onClose}
                aria-label="Close search dialog"
                icon="Close"
              />
            </header>
            <Divider />
            <div sx={styles.resultsContainer} id={containerId}>
              {tableFilters}
              <ul id={listboxId} role="listbox" sx={styles.multiTableListbox}>
                <Each
                  table="result"
                  recordName="record"
                  eachKey={sql`table || '_' || id`}
                >
                  <li
                    id={optionId(sql`record.table || '_' || record.id`)}
                    role="option"
                    aria-selected={sql`record.active`}
                    tabIndex={0}
                    sx={styles.option}
                    onClick={(s) => {
                      s.navigate(urlExpr);
                      // todo - add KV functionality for local persistence (updateRecentSearch)
                      s.statements(props.onClose);
                    }}
                  >
                    <div sx={styles.optionLeft}>
                      <Show when={sql`record.is_recent`}>
                        <MaterialIcon icon="History" fontSize="2xl" />
                      </Show>
                      <div sx={styles.optionLabelContainer}>
                        <span sx={styles.optionLabel}>{sql`record.label`}</span>
                        <Switch>
                          {tables
                            .filter((t) => t.displayValues)
                            .map((t) => {
                              const displayValueIds = displayValueNames[t.name];
                              return (
                                <Match
                                  when={sql`record.table = ${sql.lit(t.name)}`}
                                >
                                  <div sx={styles.displayValues}>
                                    {t.displayValues?.map((v, i) => {
                                      const value = sql`record.${
                                        sql.ref(displayValueIds[i])
                                      }`;
                                      const Component = v.display;
                                      return (
                                        <Show when={sql.isNotNull(value)}>
                                          <div sx={styles.optionExtraData}>
                                            <p sx={styles.optionExtraDataLabel}>
                                              {sql.concat(v.label, ":")}
                                            </p>
                                            <Component value={value} />
                                          </div>
                                        </Show>
                                      );
                                    })}
                                  </div>
                                </Match>
                              );
                            })}
                        </Switch>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch>
                        {props.tables.map((t) => (
                          <Match when={sql`record.table = ${sql.lit(t.name)}`}>
                            <MaterialIcon icon={t.icon} fontSize="xl" />
                          </Match>
                        ))}
                      </Switch>
                      <Show when={sql`record.is_recent`}>
                        <IconButton
                          variant="plain"
                          size="sm"
                          onClick={(s) => {
                            s.event.stopPropagation();
                            // todo - add KV functionality for local persistence (delete recent multi-table search)
                            s.modify(
                              sql`delete from ui.result where id = record.id`,
                            );
                          }}
                          aria-label="Remove recent search"
                        >
                          <MaterialIcon icon="Close" />
                        </IconButton>
                      </Show>
                    </div>
                  </li>
                </Each>
              </ul>
            </div>
          </Data>
        </Data>
      </div>
    </SearchModal>
  );
}

interface RecordSelectDialogProps {
  table: string;
  displayValues?: TableSearchDisplay[];
  onSelect: (id: Sql, label: Sql) => DomStatementsOrFn;
  open: BooleanExpr;
  onClose: DomStatementsOrFn;
  placeholder?: Sql;
}

/**
 RecordSelectDialog component for selecting a record from a table.

 This component displays a modal dialog with a search input and a list of records
 from the specified table. Users can search for records and select one.

 @category Dialog Component

 @param props.table The name of the table to select records from
 @param props.displayValues Array of additional values to display for each record
 @param props.onSelect Callback function called when a record is selected, receives the selected record's ID and label
 @param props.open Boolean expression to control the visibility of the dialog
 @param props.onClose
 @param props.placeholder

 @examples
[Example](../pages/datagrid_internals/cells.tsx)
*/
export function RecordSelectDialog(props: RecordSelectDialogProps) {
  if (!props.table) {
    throw new Error(
      `RecordSelectDialog: table prop is required but got: ${props.table}`,
    );
  }
  const tableModel = system.db.tables[props.table];
  if (!tableModel) {
    throw new Error(
      `RecordSelectDialog: table '${props.table}' not found in system.db.tables`,
    );
  }
  if (!tableModel.recordDisplayName) {
    throw new Error(
      `RecordSelectDialog: table '${props.table}' expects recordDisplayName to exist`,
    );
  }
  const displayValues = props.displayValues?.map((value) =>
    prepareDisplayValue(tableModel, value)
  );
  const nameExpr = tableModel.recordDisplayName.expr(
    ...tableModel.recordDisplayName.fields.map((f) =>
      sql`record.${sql.ref(f)}`
    ),
  );
  const inputId = sql.lit(getUniqueUiId());
  const listboxId = sql.lit(getUniqueUiId());
  const optionId = (id: Sql) => sql.concat(inputId, "-", id);
  const fieldNameGenerator = new SequentialIDGenerator();
  const extraValuesIds: string[] = [];
  const tableFields = displayValues?.map((v): yom.ProcTableField => {
    const name = fieldNameGenerator.next();
    extraValuesIds.push(name);
    return { name, type: v.type };
  });
  // Extra values are now built inline in the SQL query
  const searchConfig = tableModel.getSearchConfig();
  if (!searchConfig) {
    throw new Error(`Table ${tableModel.name} does not have searchConfig`);
  }

  // Helper to build extra columns SQL safely
  const buildExtraColumns = () => {
    if (
      !displayValues || displayValues.length === 0 ||
      extraValuesIds.length === 0
    ) {
      return "";
    }
    const columns = displayValues.map((v, i) => {
      const expr = v.expr(sql.ref("record")).toSQL();
      const colName = extraValuesIds[i];
      if (!colName) {
        throw new Error(`Missing column name for display value at index ${i}`);
      }
      return `${expr} as ${colName}`;
    }).join(", ");
    return columns ? `, ${columns}` : "";
  };
  function scrollToItem(alignToTop: boolean) {
    return new DomStatements().block((s) => {
      s.element(listboxId).getBoundingClientRect("container_rect");
      s.element(
        optionId(sql`(select id from ui.result where active)`),
      ).getBoundingClientRect("item_rect");
      s.unless(
        sql`item_rect.top >= container_rect.top and item_rect.bottom <= container_rect.bottom`,
        (s) => {
          s.element(
            optionId(sql`(select id from ui.result where active)`),
          ).scrollIntoView({
            block: alignToTop ? sql.lit`start` : sql.lit`end`,
          });
        },
      );
    });
  }
  return (
    <SearchModal open={props.open} onClose={props.onClose}>
      <Data local noRefetch procedure={(s) => s.defScalar("query", sql.lit``)}>
        <Data
          watch={[sql`query`]}
          procedure={(s) => {
            s.defTable("result", {
              fields: [
                {
                  name: "label",
                  type: { type: "String", maxLength: 1000 },
                },
                { name: "id", type: "BigInt" },
                { name: "index", type: "BigInt" },
                { name: "active", type: "Bool" },
                ...(tableFields ?? []),
              ],
            });
            s.conditional({
              condition: sql`trim(query) = ''`,
              then: (s) =>
                s.modify(sql`insert into result
                select
                  ${nameExpr} as label,
                  rank() over () = 1 as active,
                  rank() over () as index,
                  record.id as id
                  ${sql(buildExtraColumns())}
                from ${tableModel.identWithDb} as record
                limit 15`),
              else: (s) => {
                const searchTargets = buildRankedSearchTargets(
                  searchConfig,
                  "record",
                );
                const rankExpressions = searchTargets.map((target) => {
                  const matchesTarget =
                    sql`fuzzy_match(query, ${target.expr}, ${DEFAULT_FUZZY_CONFIG})`;
                  const rankForTarget =
                    sql`fuzzy_rank_key(query, ${target.expr}, ${DEFAULT_FUZZY_CONFIG}, ${target.priority})`;
                  return sql`case when ${matchesTarget} then ${rankForTarget} else null end`;
                });
                const bestRankExpr = buildBestRankExpr(rankExpressions);
                s.modify(sql`insert into result
                  select
                    ${nameExpr} as label,
                    rank() over (order by ${bestRankExpr}, record.${tableModel.primaryKeyIdent}) = 1 as active,
                    rank() over (order by ${bestRankExpr}, record.${tableModel.primaryKeyIdent}) as index,
                    record.${tableModel.primaryKeyIdent} as id
                    ${sql(buildExtraColumns())}
                  from ${tableModel.identWithDb} as record
                  where ${bestRankExpr} is not null
                  order by ${bestRankExpr}, record.${tableModel.primaryKeyIdent}
                  limit 10
                `);
              },
            });
          }}
        >
          <header sx={styles.header}>
            <label htmlFor={inputId} sx={styles.searchIcon}>
              <MaterialIcon icon="Search" fontSize="3xl" />
            </label>
            <Mode render="immediate">
              <input
                sx={styles.input}
                id={inputId}
                placeholder={props.placeholder ?? "Select a record…"}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-controls={listboxId}
                aria-expanded="true"
                aria-activedescendant={optionId(
                  sql`(select id from ui.result where active)`,
                )}
                type="text"
                spellCheck="false"
                autoComplete="off"
                autoCapitalize="off"
                role="combobox"
                value={sql`query`}
                onInput={(s) => {
                  s.setScalar("ui.query", sql`target_value`);
                  s.modify(sql`update ui.result set active = false`);
                }}
                onKeyDown={{
                  detachedFromNode: true,
                  procedure: (s) => {
                    s.if(sql`event.key = 'Escape'`, props.onClose);
                    s.returnIf(
                      sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key`,
                    );
                    s.if(sql`event.key = 'Enter' or event.key = 'Tab'`, (s) => {
                      s.defRecord(
                        "selected_record",
                        sql`select id, label from ui.result where active`,
                      );
                      s.if(sql`selected_record.id is not null`, (s) => {
                        s.event.preventDefault();
                        s.statements(
                          props.onSelect(
                            sql`selected_record.id`,
                            sql`selected_record.label`,
                          ),
                        );
                      });
                      s.return();
                    });
                    s.if(sql`event.key = 'ArrowDown'`, (s) => {
                      s.event.preventDefault();
                      s.returnIf(sql`not exists (select id from ui.result)`);
                      s.defScalar(
                        "next_index",
                        sql`(select index from ui.result where active) + 1`,
                      );
                      s.modify(sql`update ui.result set active = false`);
                      s.conditional({
                        condition:
                          sql`exists (select id from ui.result where index = next_index)`,
                        then: (s) => {
                          s.modify(
                            sql`update ui.result set active = true where index = next_index`,
                          );
                        },
                        else: (s) => {
                          s.modify(
                            sql`update ui.result set active = true where index = 1`,
                          );
                        },
                      });
                      s.statements(scrollToItem(false));
                      s.return();
                    });
                    s.if(sql`event.key = 'ArrowUp'`, (s) => {
                      s.event.preventDefault();
                      s.returnIf(sql`not exists (select index from ui.result)`);
                      s.defScalar(
                        "next_index",
                        sql`(select index from ui.result where active) - 1`,
                      );
                      s.modify(sql`update ui.result set active = false`);
                      s.conditional({
                        condition:
                          sql`exists (select id from ui.result where index = next_index)`,
                        then: (s) =>
                          s.modify(
                            sql`update ui.result set active = true where index = next_index`,
                          ),
                        else: (s) =>
                          s.modify(
                            sql`update ui.result set active = true where index = (select max(index) from ui.result)`,
                          ),
                      });
                      s.statements(scrollToItem(true));
                      s.return();
                    });
                  },
                }}
              />
            </Mode>
            <IconButton
              variant="plain"
              color="neutral"
              onClick={props.onClose}
              aria-label="Close search dialog"
            >
              <MaterialIcon icon="Close" />
            </IconButton>
          </header>
          <Divider />
          <ul id={listboxId} role="listbox" sx={styles.listbox}>
            <Each table="result" recordName="search_record" eachKey={sql`id`}>
              <li
                id={optionId(sql`search_record.id`)}
                role="option"
                aria-selected={sql`search_record.active`}
                tabIndex={0}
                sx={styles.option}
                onClick={{
                  detachedFromNode: true,
                  procedure: props.onSelect(
                    sql`search_record.id`,
                    sql`search_record.label`,
                  ),
                }}
              >
                <span sx={styles.optionLabel}>{sql`search_record.label`}</span>
                {displayValues && (
                  <div className="flex gap-2">
                    {displayValues.map((v, i) => {
                      const value = sql`search_record.${
                        sql.ref(extraValuesIds[i])
                      }`;
                      return (
                        <Show when={sql.isNotNull(value)}>
                          <div sx={styles.optionExtraData}>
                            <p sx={styles.optionExtraDataLabel}>
                              {sql.concat(v.label, ":")}
                            </p>
                            <span>{value}</span>
                          </div>
                        </Show>
                      );
                    })}
                  </div>
                )}
              </li>
            </Each>
          </ul>
        </Data>
      </Data>
    </SearchModal>
  );
}
