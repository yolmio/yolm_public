import { AutoInsertButton } from "components/auto_insert_dialog";
import { AutoUpdateDialog } from "components/auto_update_dialog";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { DateRangeFilter } from "components/date_range";
import { DownloadButton } from "components/download_button";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { Select } from "components/select";
import { Table } from "components/table";
import { TableRecordSelect } from "components/table_record_select";
import type { IconName } from "components/material_icon_names";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Form, useCurrentTableHelper } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { HelperProcField, StateStatements } from "std/statements";
import { Each, Route, Show } from "std/ui";
import type { Node } from "std/ui";
import { ACCOUNT_TYPES } from "./accounts.ts";
import { AMOUNT_TYPE } from "./currency.ts";
import type { LedgerBlock, LedgerDimension } from "./index.tsx";
import { journalQuery } from "./reports.ts";
import {
  date,
  dimensionLabel,
  Page,
  recordLabelSql,
  titleCase,
  VoidControl,
} from "./ui_common.tsx";

export interface LedgerUiProps {
  block: LedgerBlock;
  /** Route prefix for every ledger page. Defaults to `/ledger`. */
  basePath?: string;
}

export interface LedgerNavItem {
  label: string;
  href: string;
  icon: IconName;
}

/** Navigation entries for the ledger pages, for the consumer's sidebar. */
export function ledgerNavItems(
  block: LedgerBlock,
  basePath = "/ledger",
): LedgerNavItem[] {
  const items: LedgerNavItem[] = [
    { label: "Overview", href: basePath, icon: "Dashboard" },
    { label: "Chart of accounts", href: `${basePath}/accounts`, icon: "List" },
    { label: "Journal", href: `${basePath}/journal`, icon: "MenuBook" },
  ];
  if (block.manualJournals) {
    items.push({
      label: "Journal entries",
      href: `${basePath}/manual-journals`,
      icon: "EditNote",
    });
  }
  items.push(
    {
      label: "Profit and loss",
      href: `${basePath}/reports/profit-and-loss`,
      icon: "TrendingUp",
    },
    {
      label: "Balance sheet",
      href: `${basePath}/reports/balance-sheet`,
      icon: "AccountBalance",
    },
    {
      label: "Trial balance",
      href: `${basePath}/reports/trial-balance`,
      icon: "Balance",
    },
    {
      label: "Cash flow",
      href: `${basePath}/reports/cash-flow`,
      icon: "WaterfallChart",
    },
    {
      label: "General ledger",
      href: `${basePath}/reports/general-ledger`,
      icon: "ViewList",
    },
  );
  if (block.settlements) {
    items.push({
      label: "Open items",
      href: `${basePath}/reports/open-items`,
      icon: "RequestQuote",
    });
  }
  items.push({ label: "Close books", href: `${basePath}/close`, icon: "Lock" });
  return items;
}

/** Every ledger page, mounted under `basePath`. */
export function LedgerRoutes(props: LedgerUiProps) {
  const base = props.basePath ?? "/ledger";
  const ctx = { block: props.block, base };
  return (
    <>
      <Route path={base} exact>
        <LedgerOverview {...ctx} />
      </Route>
      <Route path={`${base}/accounts`} exact>
        <ChartOfAccountsPage {...ctx} />
      </Route>
      <Route path={`${base}/accounts/{ledger_account_id:id}`}>
        <AccountRegisterPage {...ctx} />
      </Route>
      <Route path={`${base}/journal`} exact>
        <JournalPage {...ctx} />
      </Route>
      <Route path={`${base}/journal/{ledger_entry_id:id}`}>
        <EntryPage {...ctx} />
      </Route>
      {props.block.manualJournals
        ? (
          <>
            <Route path={`${base}/manual-journals`} exact>
              <ManualJournalsPage {...ctx} />
            </Route>
            <Route
              path={`${base}/manual-journals/{ledger_manual_journal_id:id}`}
            >
              <ManualJournalPage {...ctx} />
            </Route>
          </>
        )
        : null}
      <Route path={`${base}/reports/profit-and-loss`}>
        <ProfitAndLossPage {...ctx} />
      </Route>
      <Route path={`${base}/reports/balance-sheet`}>
        <BalanceSheetPage {...ctx} />
      </Route>
      <Route path={`${base}/reports/trial-balance`}>
        <TrialBalancePage {...ctx} />
      </Route>
      <Route path={`${base}/reports/cash-flow`}>
        <CashFlowPage {...ctx} />
      </Route>
      <Route path={`${base}/reports/general-ledger`}>
        <GeneralLedgerPage {...ctx} />
      </Route>
      {props.block.settlements
        ? (
          <Route path={`${base}/reports/open-items`}>
            <OpenItemsPage {...ctx} />
          </Route>
        )
        : null}
      <Route path={`${base}/close`}>
        <CloseBooksPage {...ctx} />
      </Route>
    </>
  );
}

interface PageCtx {
  block: LedgerBlock;
  base: string;
}

function href(base: string, path: Sql): Sql {
  return sql`${sql.lit(base)} || ${path}`;
}

function accountTypeLabelSql(type: Sql): Sql {
  return sql.caseWhen({
    conditions: ACCOUNT_TYPES.map((t) => ({
      condition: sql`${type} = cast(${
        sql.lit(t.name)
      } as enums.ledger_account_type)`,
      expr: sql.lit(t.displayName),
    })),
  });
}

function sourceLabelSql(block: LedgerBlock, source: Sql): Sql {
  return sql.caseWhen({
    conditions: block.sources.map((s) => ({
      condition: sql`${source} = ${s.enumLiteral()}`,
      expr: sql.lit(s.config.displayName ?? s.key),
    })),
    default: sql`cast(${source} as string)`,
  });
}

function sourceHrefSql(block: LedgerBlock, base: string, entry: Sql): Sql {
  const conditions = block.sources.flatMap((s) => {
    if (s === block.manualJournalSource) {
      return [{
        condition: sql`${entry}.source = ${s.enumLiteral()}`,
        expr: sql`${
          sql.lit(`${base}/manual-journals/`)
        } || ${entry}.source_record_id`,
      }];
    }
    return s.config.documentHref
      ? [{
        condition: sql`${entry}.source = ${s.enumLiteral()}`,
        expr: s.config.documentHref(sql`${entry}.source_record_id`),
      }]
      : [];
  });
  if (conditions.length === 0) return sql`cast(null as string)`;
  return sql`case when ${entry}.source_record_id is null then null else ${
    sql.caseWhen({ conditions })
  } end`;
}

function AmountHeader(props: { children: Node }) {
  return (
    <th>
      <div className="text-right">{props.children}</div>
    </th>
  );
}

function AmountCell(props: { block: LedgerBlock; amount: Sql }) {
  const block = props.block;
  return (
    <td className="text-right tabular-nums">
      {sql`case when ${props.amount} is null then '' else ${
        block.formatAmountSql(props.amount)
      } end`}
    </td>
  );
}

/**
 * Debit and credit columns derived in the cell from a signed amount. Nullable
 * decimal columns in UI tables currently read back as zero, so the null side
 * must be computed here rather than in the query.
 */
function DebitCreditCells(props: { block: LedgerBlock; amount: Sql }) {
  const block = props.block;
  return (
    <>
      <AmountCell
        block={block}
        amount={sql`case when ${props.amount} > 0 then ${props.amount} end`}
      />
      <AmountCell
        block={block}
        amount={sql`case when ${props.amount} < 0 then -${props.amount} end`}
      />
    </>
  );
}

function DateRange(props: { from: string; to: string }) {
  return (
    <DateRangeFilter
      size="sm"
      startDate={sql.ref(props.from)}
      endDate={sql.ref(props.to)}
      onStartDateChange={(s, value) => s.setScalar(props.from, value)}
      onEndDateChange={(s, value) => s.setScalar(props.to, value)}
    />
  );
}

const totalsFields: HelperProcField[] = [
  { name: "account_id", type: "BigInt" },
  { name: "number", type: { type: "String", maxLength: 20 } },
  { name: "name", type: { type: "String", maxLength: 200 } },
  { name: "type", type: { type: "Enum", enum: "ledger_account_type" } },
  { name: "account_class", type: { type: "String", maxLength: 20 } },
  { name: "normal_sign", type: "Int" },
  { name: "activity", type: AMOUNT_TYPE },
  { name: "balance", type: AMOUNT_TYPE },
  { name: "prior_years", type: AMOUNT_TYPE },
  { name: "sort_path", type: { type: "String", maxLength: 70 } },
  { name: "display_name", type: { type: "String", maxLength: 620 } },
  { name: "parent_path", type: { type: "String", maxLength: 50 } },
  { name: "parent_label", type: { type: "String", maxLength: 430 } },
];

/** Materializes account totals once so report sections reuse one scan. */
function loadTotals(
  s: StateStatements,
  block: LedgerBlock,
  opts: { asOf: Sql; from?: Sql; lineFilter?: Sql; book?: Sql },
) {
  s.defTable("ledger_totals", { fields: totalsFields });
  s.modify(sql`insert into ledger_totals
    select account_id, number, name, type, account_class, normal_sign,
      activity, balance, prior_years, sort_path, display_name, parent_path,
      parent_label
    from (${block.accountTotalsQuery(opts)}) totals`);
}

/**
 * Report lines: `kind` is header, account, total, or grand_total. Built as a
 * union of generation-time sections over the materialized totals.
 */
function reportLinesQuery(sections: Sql[]): Sql {
  return sql`select * from (${sql.unionAll(...sections)}) report_line
    order by sort, sort_key`;
}

/**
 * Header, account rows, parent subtotals, and a total per account type over
 * `table` (`ledger_totals`, or `pnl_activity` with a `period` column when
 * `byPeriod`). Rows are `sort, sort_key, kind, label, account_id,
 * [period,] amount`.
 */
function typeSections(
  types: readonly (typeof ACCOUNT_TYPES)[number][],
  amount: Sql,
  sortBase: number,
  opts: {
    total?: boolean;
    alwaysHeader?: boolean;
    table?: string;
    byPeriod?: boolean;
  } = {},
): Sql[] {
  const table = sql.ref(opts.table ?? "ledger_totals");
  const period = (column: Sql) => opts.byPeriod ? sql`${column},` : sql``;
  const byPeriod = (column: Sql) =>
    opts.byPeriod ? sql`group by ${column}` : sql``;
  return types.flatMap((type, index) => {
    const sort = sortBase + index * 3;
    const where = sql`type = cast(${
      sql.lit(type.name)
    } as enums.ledger_account_type) and ${amount} <> 0`;
    const lines = [
      sql`select ${sort} as sort, '' as sort_key, 'header' as kind,
          ${sql.lit(type.displayName)} as label,
          cast(null as bigint) as account_id, ${period(TOTAL_PERIOD)}
          cast(null as decimal(18, 4)) as amount
        ${
        opts.alwaysHeader
          ? sql``
          : sql`where exists (select 1 from ${table} where ${where})`
      }`,
      sql`select ${sort + 1}, sort_path, 'account',
          number || ' ' || display_name, account_id, ${period(sql`period`)}
          ${amount}
        from ${table} where ${where}`,
      // Subtotal after each parent's sub-accounts, rolling up descendants.
      sql`select ${sort + 1}, parents.path || '.~', 'total',
          'Total ' || parents.label, cast(null as bigint),
          ${period(sql`row.period`)} sum(row.${amount})
        from (select parent_path as path, max(parent_label) as label
          from ${table} where ${where} and parent_path is not null
          group by parent_path) parents
        join ${table} row on (row.sort_path = parents.path
          or row.sort_path like parents.path || '.%') and row.${where}
        group by parents.path, parents.label ${
        opts.byPeriod ? sql`, row.period` : sql``
      }`,
    ];
    if (opts.total !== false) {
      lines.push(sql`select ${sort + 2}, '', 'total',
          ${sql.lit(`Total ${type.displayName}`)}, cast(null as bigint),
          ${period(sql`period`)} sum(${amount})
        from ${table} where ${where} ${byPeriod(sql`period`)}
        ${opts.byPeriod ? sql`` : sql`having count(*) > 0`}`);
    }
    return lines;
  });
}

/** A computed line shown like an account row, without a drill-down link. */
function computedLine(
  sort: number,
  sortKey: string,
  label: string,
  amount: Sql,
) {
  return sql`select ${sort}, ${sql.lit(sortKey)}, 'account', ${sql.lit(label)},
    cast(null as bigint), cast(${amount} as decimal(18, 4))`;
}

/**
 * A bold summary row. With `perPeriodFrom`, `amount` aggregates that table
 * and the row repeats per period.
 */
function summaryLine(
  sort: number,
  label: string,
  amount: Sql,
  perPeriodFrom?: string,
): Sql {
  return perPeriodFrom
    ? sql`select ${sort}, '', 'grand_total', ${sql.lit(label)},
        cast(null as bigint), period, cast(${amount} as decimal(18, 4))
      from ${sql.ref(perPeriodFrom)} group by period`
    : sql`select ${sort}, '', 'grand_total', ${sql.lit(label)},
        cast(null as bigint), cast(${amount} as decimal(18, 4))`;
}

function sumWhere(amount: Sql, types: string[]): Sql {
  return sql`coalesce((select sum(${amount}) from ledger_totals
    where cast(type as string) in (${types.map((t) => sql.lit(t))})), 0)`;
}

/** Row kind, row class, and label class of report lines. */
const REPORT_ROW_KINDS: [string, string, string][] = [
  ["header", "font-semibold", ""],
  ["account", "", "pl-8"],
  ["total", "font-semibold border-t border-divider", ""],
  ["grand_total", "font-bold border-t-2 border-divider", ""],
];

/** A report row's label, linking account rows to their register. */
function ReportLabel(props: { base: string; row: string }) {
  const row = sql.ref(props.row);
  return (
    <Show
      when={sql`${row}.account_id is not null`}
      fallback={sql`${row}.label`}
    >
      <a
        href={href(props.base, sql`'/accounts/' || ${row}.account_id`)}
        className="text-primary-600 hover:underline"
      >
        {sql`${row}.label`}
      </a>
    </Show>
  );
}

function ReportLines(
  props: { block: LedgerBlock; base: string; fileName: string },
) {
  const block = props.block;
  const label = <ReportLabel base={props.base} row="report_line" />;
  const kinds = REPORT_ROW_KINDS;
  return (
    <>
      <ExportButton
        fileName={props.fileName}
        query={sql`select label, ${csvAmount(sql`amount`)} as amount
          from report_lines order by sort, sort_key`}
      />
      <Card variant="outlined" className="p-0 overflow-x-auto">
        <Table borderAxis="none" hoverRow>
          <tbody>
            <Each table="report_lines" recordName="report_line">
              {kinds.map(([kind, rowClass, labelClass]) => (
                <Show when={sql`report_line.kind = ${sql.lit(kind)}`}>
                  <tr className={rowClass}>
                    <td>
                      <div className={labelClass}>{label}</div>
                    </td>
                    <AmountCell
                      block={block}
                      amount={sql`report_line.amount`}
                    />
                  </tr>
                </Show>
              ))}
            </Each>
          </tbody>
        </Table>
      </Card>
    </>
  );
}

/** Blank rather than `NULL` for empty amounts in CSV exports. */
function csvAmount(expr: Sql): Sql {
  return sql`coalesce(cast(${expr} as string), '')`;
}

function ExportButton(props: { fileName: string; query: Sql }) {
  return (
    <div className="flex justify-end">
      <DownloadButton
        size="sm"
        variant="plain"
        fileName={props.fileName}
        query={props.query}
      >
        Export CSV
      </DownloadButton>
    </div>
  );
}

const PNL_TYPES = [
  "income",
  "cost_of_goods_sold",
  "expense",
  "other_income",
  "other_expense",
];

function typesOf(names: string[]) {
  return ACCOUNT_TYPES.filter((type) => names.includes(type.name));
}

/**
 * Period of the total column. UI tables do not keep NULL dates, so the total
 * uses a sentinel date rather than NULL.
 */
const TOTAL_PERIOD = sql`date '1900-01-01'`;

const pnlActivityFields: HelperProcField[] = [
  { name: "account_id", type: "BigInt" },
  { name: "number", type: { type: "String", maxLength: 20 } },
  { name: "display_name", type: { type: "String", maxLength: 620 } },
  { name: "sort_path", type: { type: "String", maxLength: 70 } },
  { name: "parent_path", type: { type: "String", maxLength: 50 } },
  { name: "parent_label", type: { type: "String", maxLength: 430 } },
  { name: "type", type: { type: "Enum", enum: "ledger_account_type" } },
  { name: "period", type: "Date" },
  { name: "amount", type: AMOUNT_TYPE },
];

const reportCellFields: HelperProcField[] = [
  { name: "sort", type: "Int" },
  { name: "sort_key", type: { type: "String", maxLength: 70 } },
  { name: "kind", type: { type: "String", maxLength: 20 } },
  { name: "label", type: { type: "String", maxLength: 650 } },
  { name: "account_id", type: "BigInt" },
  { name: "period", type: "Date" },
  { name: "amount", type: AMOUNT_TYPE },
];

/**
 * Profit-and-loss report cells over `pnl_activity` (amounts already in
 * presentation sign), one per row and period; `TOTAL_PERIOD` is the total
 * column.
 */
function profitAndLossCellsQuery(): Sql {
  const amount = sql`amount`;
  const section = (types: string[], sortBase: number) =>
    typeSections(typesOf(types), amount, sortBase, {
      table: "pnl_activity",
      byPeriod: true,
    });
  const net = (label: string, sort: number, types: [string, number][]) =>
    summaryLine(
      sort,
      label,
      sql`sum(${
        sql.caseWhen({
          conditions: types.map(([type, sign]) => ({
            condition: sql`cast(type as string) = ${sql.lit(type)}`,
            expr: sql`${sign} * amount`,
          })),
          default: sql`0`,
        })
      })`,
      "pnl_activity",
    );
  const grossProfit: [string, number][] = [
    ["income", 1],
    ["cost_of_goods_sold", -1],
  ];
  const operating: [string, number][] = [...grossProfit, ["expense", -1]];
  return sql.unionAll(
    ...section(["income", "cost_of_goods_sold"], 0),
    net("Gross profit", 10, grossProfit),
    ...section(["expense"], 20),
    net("Net operating income", 30, operating),
    ...section(["other_income", "other_expense"], 40),
    net("Net income", 50, [
      ...operating,
      ["other_income", 1],
      ["other_expense", -1],
    ]),
  );
}

/**
 * Report scope: an optional book plus dimension filters, held in
 * `<prefix>_book` and `<prefix>_<key>_id` scalars.
 */
function reportScope(
  block: LedgerBlock,
  prefix: string,
  dimensions: LedgerDimension[],
) {
  const bookScalar = `${prefix}_book`;
  const dimScalar = (d: LedgerDimension) => `${prefix}_${d.key}_id`;
  // Lines without an entity belong to the home entity.
  const conditions: Sql[] = [
    ...dimensions.map((d) =>
      sql`(${sql.ref(dimScalar(d))} is null or ${
        d.key === "entity"
          ? block.entityFilterSql(sql.ref(dimScalar(d)))
          : sql`${sql.ref(`${d.key}_id`)} = ${sql.ref(dimScalar(d))}`
      })`
    ),
  ];
  return {
    defineScalars(s: StateStatements) {
      if (block.books.length) {
        s.defScalar(bookScalar, {
          type: { type: "Enum", enum: "ledger_book" },
        });
      }
      for (const d of dimensions) {
        s.defScalar(dimScalar(d), { type: "BigInt" });
      }
    },
    watch: [
      ...(block.books.length ? [sql.ref(bookScalar)] : []),
      ...dimensions.map((d) => sql.ref(dimScalar(d))),
    ],
    lineFilter: conditions.length
      ? conditions.reduce((a, b) => sql`${a} and ${b}`)
      : undefined,
    book: block.books.length ? sql.ref(bookScalar) : undefined,
    filters: (
      <>
        {block.books.length
          ? (
            <FormControl className="min-w-[160px]">
              <FormLabel>Book</FormLabel>
              <Select
                size="sm"
                value={sql`coalesce(cast(${
                  sql.ref(bookScalar)
                } as string), '')`}
                onChange={(s) =>
                  s.setScalar(
                    bookScalar,
                    sql`case when target_value = '' then null
                      else cast(target_value as enums.ledger_book) end`,
                  )}
              >
                <Select.Option value="">Base</Select.Option>
                {block.books.map((book) => (
                  <Select.Option value={book.key}>
                    {book.displayName ?? titleCase(book.key)}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
          )
          : null}
        {dimensions.map((d) => (
          <FormControl className="min-w-[200px]">
            <FormLabel>{dimensionLabel(d)}</FormLabel>
            <TableRecordSelect
              tableName={d.table}
              value={sql.ref(dimScalar(d))}
              onSelectValue={(s, value) => s.setScalar(dimScalar(d), value)}
              placeholder="All"
            />
          </FormControl>
        ))}
      </>
    ),
  };
}

/** Entity filter for balance reports when entities are enabled. */
function entityDimensions(block: LedgerBlock) {
  return block.dimensions.filter((d) => d.key === "entity");
}

function ProfitAndLossPage(props: PageCtx) {
  const block = props.block;
  const scope = reportScope(block, "pnl", block.dimensions);
  const lineFilter = scope.lineFilter;
  const cell = (row: Sql, period: Sql) =>
    sql`(select amount from report_cells cell
      where cell.sort = ${row}.sort and cell.sort_key = ${row}.sort_key
        and ${period})`;
  const kinds = REPORT_ROW_KINDS;
  return (
    <Page block={block} title="Profit and loss">
      <Data
        procedure={(s) => {
          s.defScalar("pnl_from", {
            type: "Date",
            expr: block.fiscalYearStartSql(sql`current_date()`),
          });
          s.defScalar("pnl_to", { type: "Date", expr: sql`current_date()` });
          s.defScalar("pnl_columns", sql.lit`total`);
          scope.defineScalars(s);
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <DateRange from="pnl_from" to="pnl_to" />
          <FormControl className="min-w-[160px]">
            <FormLabel>Columns</FormLabel>
            <Select
              size="sm"
              value={sql`pnl_columns`}
              onChange={(s) => s.setScalar("pnl_columns", sql`target_value`)}
            >
              <Select.Option value="total">Total only</Select.Option>
              <Select.Option value="months">Months</Select.Option>
              <Select.Option value="prior_year">
                Compare to prior year
              </Select.Option>
            </Select>
          </FormControl>
          {scope.filters}
        </div>
        <Data
          watch={[
            sql`pnl_from`,
            sql`pnl_to`,
            sql`pnl_columns`,
            ...scope.watch,
          ]}
          procedure={(s) => {
            s.defTable("pnl_activity", { fields: pnlActivityFields });
            s.modify(sql`insert into pnl_activity
              select account_id, number, display_name, sort_path, parent_path,
                parent_label, type, coalesce(period, ${TOTAL_PERIOD}) as period,
                amount * normal_sign as amount
              from (${
              block.profitAndLossActivityQuery({
                from: sql`pnl_from`,
                to: sql`pnl_to`,
                byMonth: sql`pnl_columns = 'months'`,
                lineFilter,
                book: scope.book,
              })
            }) activity`);
            // The same dates a year earlier, as a column dated then.
            s.if(sql`pnl_columns = 'prior_year'`, (s) => {
              s.modify(sql`insert into pnl_activity
                select account_id, number, display_name, sort_path,
                  parent_path, parent_label, type,
                  date.subtract(year, 1, pnl_from) as period,
                  amount * normal_sign as amount
                from (${
                block.profitAndLossActivityQuery({
                  from: sql`date.subtract(year, 1, pnl_from)`,
                  to: sql`date.subtract(year, 1, pnl_to)`,
                  byMonth: sql`false`,
                  lineFilter,
                  book: scope.book,
                })
              }) activity`);
            });
            // Month columns also get a total column (null period).
            s.if(sql`pnl_columns = 'months'`, (s) => {
              s.modify(sql`insert into pnl_activity
                select account_id, number, display_name, sort_path,
                  parent_path, parent_label, type, ${TOTAL_PERIOD} as period,
                  sum(amount) as amount
                from pnl_activity
                group by account_id, number, display_name, sort_path,
                  parent_path, parent_label, type`);
            });
            s.defTable("report_cells", { fields: reportCellFields });
            s.modify(
              sql`insert into report_cells ${profitAndLossCellsQuery()}`,
            );
            s.defTable(
              "report_rows",
              sql`select distinct sort, sort_key, kind, label, account_id
                from report_cells order by sort, sort_key`,
            );
            // The prior-year column shows even when that year has no activity.
            s.defTable(
              "report_periods",
              sql`select distinct period from (select period from report_cells
                  where period <> ${TOTAL_PERIOD}
                  union all select date.subtract(year, 1, pnl_from)
                  where pnl_columns = 'prior_year') periods
                order by period`,
            );
          }}
        >
          <ExportButton
            fileName="profit-and-loss.csv"
            query={sql`select label,
                case when period = ${TOTAL_PERIOD} then 'Total'
                  else format.date(period, '%Y-%m') end as period,
                ${csvAmount(sql`amount`)} as amount
              from report_cells order by sort, sort_key, period`}
          />
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table borderAxis="none" hoverRow>
              <thead>
                <tr>
                  <th className="w-72" />
                  <Each table="report_periods" recordName="report_period">
                    <AmountHeader>
                      {sql`case when pnl_columns = 'prior_year'
                        then 'Prior year'
                        else format.date(report_period.period, '%b %Y') end`}
                    </AmountHeader>
                  </Each>
                  <AmountHeader>
                    {sql`case when pnl_columns = 'prior_year'
                      then 'This period' else 'Total' end`}
                  </AmountHeader>
                </tr>
              </thead>
              <tbody>
                <Each table="report_rows" recordName="report_row">
                  {kinds.map(([kind, rowClass, labelClass]) => (
                    <Show when={sql`report_row.kind = ${sql.lit(kind)}`}>
                      <tr className={rowClass}>
                        <td>
                          <div className={labelClass}>
                            <ReportLabel base={props.base} row="report_row" />
                          </div>
                        </td>
                        <Each table="report_periods" recordName="report_period">
                          <AmountCell
                            block={block}
                            amount={cell(
                              sql`report_row`,
                              sql`cell.period = report_period.period`,
                            )}
                          />
                        </Each>
                        <AmountCell
                          block={block}
                          amount={cell(
                            sql`report_row`,
                            sql`cell.period = ${TOTAL_PERIOD}`,
                          )}
                        />
                      </tr>
                    </Show>
                  ))}
                </Each>
              </tbody>
            </Table>
          </Card>
        </Data>
      </Data>
    </Page>
  );
}

function BalanceSheetPage(props: PageCtx) {
  const block = props.block;
  const bsScope = reportScope(block, "bs", entityDimensions(block));
  const amount = sql`balance * normal_sign`;
  const assetTypes = ACCOUNT_TYPES.filter((t) => t.class === "asset");
  const liabilityTypes = ACCOUNT_TYPES.filter((t) => t.class === "liability");
  const allAssets = sumWhere(amount, assetTypes.map((t) => t.name));
  const allLiabilities = sumWhere(amount, liabilityTypes.map((t) => t.name));
  const equity = sumWhere(amount, ["equity"]);
  const retained =
    sql`-coalesce((select sum(prior_years) from ledger_totals), 0)`;
  const netIncome = sql`-${sumWhere(sql`balance`, PNL_TYPES)}`;
  return (
    <Page block={props.block} title="Balance sheet">
      <Data
        procedure={(s) => {
          s.defScalar("bs_as_of", { type: "Date", expr: sql`current_date()` });
          bsScope.defineScalars(s);
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <FormControl className="max-w-[200px]">
            <FormLabel>As of</FormLabel>
            <Input
              size="sm"
              type="date"
              value={sql`bs_as_of`}
              onInput={(s, value) =>
                s.setScalar("bs_as_of", sql`try_cast(${value} as date)`)}
            />
          </FormControl>
          {bsScope.filters}
        </div>
        <Data
          watch={[sql`bs_as_of`, ...bsScope.watch]}
          procedure={(s) => {
            loadTotals(s, props.block, {
              asOf: sql`bs_as_of`,
              lineFilter: bsScope.lineFilter,
              book: bsScope.book,
            });
            s.defTable(
              "report_lines",
              reportLinesQuery([
                ...typeSections(assetTypes, amount, 0),
                summaryLine(20, "Total assets", allAssets),
                ...typeSections(liabilityTypes, amount, 30),
                summaryLine(50, "Total liabilities", allLiabilities),
                ...typeSections(typesOf(["equity"]), amount, 60, {
                  total: false,
                  alwaysHeader: true,
                }),
                computedLine(61, "~1", "Retained earnings", retained),
                computedLine(61, "~2", "Net income", netIncome),
                sql`select 62, '', 'total', 'Total equity', cast(null as bigint),
                  cast(${equity} + ${retained} + ${netIncome} as decimal(18, 4))`,
                summaryLine(
                  70,
                  "Total liabilities and equity",
                  sql`${allLiabilities} + ${equity} + ${retained} + ${netIncome}`,
                ),
              ]),
            );
          }}
        >
          <ReportLines
            block={block}
            base={props.base}
            fileName="balance-sheet.csv"
          />
        </Data>
      </Data>
    </Page>
  );
}

function TrialBalancePage(props: PageCtx) {
  const block = props.block;
  const tbScope = reportScope(block, "tb", entityDimensions(block));
  return (
    <Page block={props.block} title="Trial balance">
      <Data
        procedure={(s) => {
          s.defScalar("tb_as_of", { type: "Date", expr: sql`current_date()` });
          tbScope.defineScalars(s);
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <FormControl className="max-w-[200px]">
            <FormLabel>As of</FormLabel>
            <Input
              size="sm"
              type="date"
              value={sql`tb_as_of`}
              onInput={(s, value) =>
                s.setScalar("tb_as_of", sql`try_cast(${value} as date)`)}
            />
          </FormControl>
          {tbScope.filters}
        </div>
        <Data
          watch={[sql`tb_as_of`, ...tbScope.watch]}
          procedure={(s) => {
            loadTotals(s, props.block, {
              asOf: sql`tb_as_of`,
              lineFilter: tbScope.lineFilter,
              book: tbScope.book,
            });
            s.defTable(
              "tb_rows",
              sql`select account_id, number, name, balance from ledger_totals
                where balance <> 0
                union all
                select cast(null as bigint), '', 'Retained earnings',
                  sum(prior_years) from ledger_totals
                having sum(prior_years) <> 0
                order by number`,
            );
            s.defScalar(
              "tb_debits",
              sql`(select sum(case when balance > 0 then balance else 0 end)
                from tb_rows)`,
            );
            s.defScalar(
              "tb_credits",
              sql`(select sum(case when balance < 0 then -balance else 0 end)
                from tb_rows)`,
            );
          }}
        >
          <ExportButton
            fileName="trial-balance.csv"
            query={sql`select number, name,
                ${
              csvAmount(sql`case when balance > 0 then balance end`)
            } as debit,
                ${
              csvAmount(sql`case when balance < 0 then -balance end`)
            } as credit
              from tb_rows`}
          />
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <th>Account</th>
                  <AmountHeader>Debit</AmountHeader>
                  <AmountHeader>Credit</AmountHeader>
                </tr>
              </thead>
              <tbody>
                <Each table="tb_rows" recordName="tb_row">
                  <tr>
                    <td>
                      <Show
                        when={sql`tb_row.account_id is not null`}
                        fallback={sql`tb_row.name`}
                      >
                        <a
                          href={href(
                            props.base,
                            sql`'/accounts/' || tb_row.account_id`,
                          )}
                          className="text-primary-600 hover:underline"
                        >
                          {sql`tb_row.number || ' ' || tb_row.name`}
                        </a>
                      </Show>
                    </td>
                    <AmountCell
                      block={block}
                      amount={sql`case when tb_row.balance > 0 then tb_row.balance end`}
                    />
                    <AmountCell
                      block={block}
                      amount={sql`case when tb_row.balance < 0 then -tb_row.balance end`}
                    />
                  </tr>
                </Each>
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td>Total</td>
                  <AmountCell
                    block={block}
                    amount={sql`coalesce(tb_debits, 0)`}
                  />
                  <AmountCell
                    block={block}
                    amount={sql`coalesce(tb_credits, 0)`}
                  />
                </tr>
              </tfoot>
            </Table>
          </Card>
        </Data>
      </Data>
    </Page>
  );
}

function ChartOfAccountsPage(props: PageCtx) {
  const block = props.block;
  return (
    <Page
      block={props.block}
      title="Chart of accounts"
      actions={
        <AutoInsertButton
          table="ledger_accounts"
          ignoreFields={["is_active"]}
          beforeTransactionStart={(s) => props.block.requireManage(s)}
          startIcon="Add"
        >
          New account
        </AutoInsertButton>
      }
    >
      <Data
        procedure={(s) => {
          s.defScalar("edit_account_open", sql`false`);
          s.defScalar("edit_used_account_open", sql`false`);
          s.defScalar("edit_account_id", { type: "BigInt" });
          s.defTable(
            "accounts",
            sql`select account.id, account.number, account.name, account.type,
                account.is_active,
                coalesce(totals.balance * totals.normal_sign, 0) as balance,
                used.account_id is not null as is_used,
                case when account.parent_id is null then 0
                  when parent.parent_id is null then 1 else 2 end as depth
              from db.ledger_accounts account
              left join db.ledger_accounts parent
                on parent.id = account.parent_id
              left join (${
              props.block.accountTotalsQuery({ asOf: sql`current_date()` })
            }) totals on totals.account_id = account.id
              left join (select distinct account_id from db.ledger_lines) used
                on used.account_id = account.id
              order by account.number`,
          );
        }}
      >
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table hoverRow>
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Type</th>
                <AmountHeader>Balance</AmountHeader>
                <th />
              </tr>
            </thead>
            <tbody>
              <Each table="accounts" recordName="account">
                <tr>
                  <td>{sql`account.number`}</td>
                  <td>
                    {([[0, ""], [1, "pl-6"], [2, "pl-12"]] as const).map((
                      [depth, indent],
                    ) => (
                      <Show when={sql`account.depth = ${depth}`}>
                        <div className={indent}>
                          <a
                            href={href(
                              props.base,
                              sql`'/accounts/' || account.id`,
                            )}
                            className="text-primary-600 hover:underline"
                          >
                            {sql`account.name`}
                          </a>
                        </div>
                      </Show>
                    ))}
                  </td>
                  <td>
                    {accountTypeLabelSql(sql`account.type`)}
                    <Show when={sql`not account.is_active`}>
                      <Chip size="sm" color="neutral" className="ml-2">
                        Inactive
                      </Chip>
                    </Show>
                  </td>
                  <AmountCell block={block} amount={sql`account.balance`} />
                  <td className="text-right">
                    <Show when={sql`ledger_can_manage`}>
                      <Button
                        size="sm"
                        variant="plain"
                        onClick={(s) => {
                          s.setScalar("edit_account_id", sql`account.id`);
                          s.if(
                            sql`account.is_used`,
                            (s) => s.setScalar("edit_used_account_open", true),
                            (s) => s.setScalar("edit_account_open", true),
                          );
                        }}
                      >
                        Edit
                      </Button>
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
        <AutoUpdateDialog
          bindScalar="edit_account_open"
          table="ledger_accounts"
          recordId={sql`edit_account_id`}
          beforeTransactionStart={(s) => props.block.requireManage(s)}
        />
        {
          /* Number and type are fixed once lines post: code looks accounts up
            by number, and retyping would move history between statements. */
        }
        <AutoUpdateDialog
          bindScalar="edit_used_account_open"
          table="ledger_accounts"
          recordId={sql`edit_account_id`}
          ignoreFields={["number", "type"]}
          beforeTransactionStart={(s) => props.block.requireManage(s)}
        />
      </Data>
    </Page>
  );
}

function AccountRegisterPage(props: PageCtx) {
  const block = props.block;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "register_account",
          sql`select id, number, name, type from db.ledger_accounts
            where id = ledger_account_id
              and ${block.canViewSql(sql`current_user`)}`,
        );
        s.defScalar("register_from", {
          type: "Date",
          expr: block.fiscalYearStartSql(sql`current_date()`),
        });
        s.defScalar("register_to", { type: "Date", expr: sql`current_date()` });
      }}
    >
      <Page
        block={props.block}
        title={sql`register_account.number || ' ' || register_account.name`}
      >
        <DateRange from="register_from" to="register_to" />
        <Data
          watch={[sql`register_from`, sql`register_to`]}
          procedure={(s) => {
            s.defScalar(
              "register_opening",
              block.openingBalanceSql(
                sql`ledger_account_id`,
                sql`register_from`,
              ),
            );
            s.defTable(
              "register_lines",
              sql`select * from (${
                block.accountRegisterQuery({
                  accountId: sql`ledger_account_id`,
                  from: sql`register_from`,
                  to: sql`register_to`,
                })
              }) register order by posting_date desc, line_id desc limit 500`,
            );
          }}
        >
          <ExportButton
            fileName="account-register.csv"
            query={sql`select posting_date,
                coalesce(memo, description) as description,
                ${
              csvAmount(sql`case when amount > 0 then amount end`)
            } as debit,
                ${
              csvAmount(sql`case when amount < 0 then -amount end`)
            } as credit,
                balance
              from (${
              block.accountRegisterQuery({
                accountId: sql`ledger_account_id`,
                from: sql`register_from`,
                to: sql`register_to`,
              })
            }) register
              where ${block.canViewSql(sql`current_user`)}
              order by posting_date, line_id`}
          />
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Description</th>
                  <AmountHeader>Debit</AmountHeader>
                  <AmountHeader>Credit</AmountHeader>
                  <AmountHeader>Balance</AmountHeader>
                </tr>
              </thead>
              <tbody>
                <Each table="register_lines" recordName="register_line">
                  <tr>
                    <td>
                      <a
                        href={href(
                          props.base,
                          sql`'/journal/' || register_line.entry_id`,
                        )}
                        className="text-primary-600 hover:underline"
                      >
                        {date(sql`register_line.posting_date`)}
                      </a>
                    </td>
                    <td>{sourceLabelSql(block, sql`register_line.source`)}</td>
                    <td>
                      {sql`coalesce(register_line.memo, register_line.description, '')`}
                    </td>
                    <DebitCreditCells
                      block={block}
                      amount={sql`register_line.amount`}
                    />
                    <AmountCell
                      block={block}
                      amount={sql`register_line.balance`}
                    />
                  </tr>
                </Each>
                <tr className="font-semibold">
                  <td colSpan={5}>Opening balance</td>
                  <AmountCell block={block} amount={sql`register_opening`} />
                </tr>
              </tbody>
            </Table>
          </Card>
        </Data>
      </Page>
    </Data>
  );
}

function JournalPage(props: PageCtx) {
  const block = props.block;
  return (
    <Page block={props.block} title="Journal">
      <Data
        procedure={(s) => {
          s.defScalar("journal_from", {
            type: "Date",
            expr: sql`date.subtract(day, 90, current_date())`,
          });
          s.defScalar("journal_to", {
            type: "Date",
            expr: sql`current_date()`,
          });
        }}
      >
        <DateRange from="journal_from" to="journal_to" />
        <Data
          watch={[sql`journal_from`, sql`journal_to`]}
          procedure={(s) => {
            s.defTable(
              "journal_entries",
              sql`select * from (${
                journalQuery(block, {
                  from: sql`journal_from`,
                  to: sql`journal_to`,
                })
              }) entry order by posting_date desc, entry_id desc limit 500`,
            );
          }}
        >
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Description</th>
                  <AmountHeader>Amount</AmountHeader>
                  <th />
                </tr>
              </thead>
              <tbody>
                <Each table="journal_entries" recordName="journal_entry">
                  <tr>
                    <td>
                      <a
                        href={href(
                          props.base,
                          sql`'/journal/' || journal_entry.entry_id`,
                        )}
                        className="text-primary-600 hover:underline"
                      >
                        {date(sql`journal_entry.posting_date`)}
                      </a>
                    </td>
                    <td>{sourceLabelSql(block, sql`journal_entry.source`)}</td>
                    <td>
                      {sql`coalesce(journal_entry.document_number || ' · ', '')
                        || coalesce(journal_entry.description, '')`}
                    </td>
                    <AmountCell
                      block={block}
                      amount={sql`journal_entry.debits`}
                    />
                    <td>
                      <Show when={sql`journal_entry.book is not null`}>
                        <Chip size="sm" color="primary">
                          {sql`initcap(journal_entry.book) || ' book'`}
                        </Chip>
                      </Show>
                      <Show when={sql`journal_entry.is_reversed`}>
                        <Chip size="sm" color="neutral">Reversed</Chip>
                      </Show>
                      <Show
                        when={sql`journal_entry.reverses_entry_id is not null`}
                      >
                        <Chip size="sm" color="warning">Reversal</Chip>
                      </Show>
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Data>
      </Data>
    </Page>
  );
}

function EntryPage(props: PageCtx) {
  const block = props.block;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "entry",
          sql`select entry.id, entry.posting_date, entry.source,
              entry.source_record_id, entry.description,
              entry.document_number, entry.reverses_entry_id, entry.posted_at,
              ${
            block.books.length
              ? sql`cast(entry.book as string) as book,`
              : sql`cast(null as string) as book,`
          }
              (select id from db.ledger_entries reversal
                where reversal.reverses_entry_id is not null
                  and reversal.reverses_entry_id = entry.id) as reversed_by_id,
              ${recordLabelSql("sys_users", sql`entry.posted_by`)}
                as posted_by,
              ${sourceHrefSql(block, props.base, sql`entry`)} as document_href
            from db.ledger_entries entry where entry.id = ledger_entry_id
              and ${block.canViewSql(sql`current_user`)}`,
        );
        s.defTable(
          "entry_lines",
          sql`select line.id, account.number || ' ' || account.name as account,
              line.account_id, line.amount, line.memo,
              ${
            block.multiCurrency
              ? sql`line.currency || ' ' || cast(line.amount_txn as string)`
              : sql`cast(null as string)`
          } as foreign_amount
              ${
            block.dimensions.length
              ? sql`, ${
                block.dimensions.map((d) =>
                  sql`${
                    recordLabelSql(
                      d.table,
                      sql`line.${sql.ref(`${d.key}_id`)}`,
                    )
                  } as ${sql.ref(`${d.key}_label`)}`
                )
              }`
              : sql``
          }
            from db.ledger_lines line
            join db.ledger_accounts account on account.id = line.account_id
            where line.entry_id = ledger_entry_id
              and ${block.canViewSql(sql`current_user`)}
            order by line.id`,
        );
      }}
    >
      <Page
        block={props.block}
        title={sql`'Journal entry ' || ${date(sql`entry.posting_date`)}`}
        aside={
          <Show when={sql`entry.document_href is not null`}>
            <Button
              variant="outlined"
              size="sm"
              href={sql`entry.document_href`}
            >
              Open document
            </Button>
          </Show>
        }
      >
        <Card variant="outlined" className="p-4 flex flex-col gap-1">
          <Typography level="body-md">
            {sql`${sourceLabelSql(block, sql`entry.source`)}
              || coalesce(' ' || entry.document_number, '')
              || coalesce(' · ' || entry.description, '')
              || coalesce(' · ' || entry.book || ' book', '')`}
          </Typography>
          <Typography level="body-sm" className="text-secondary">
            {sql`'Posted ' || format.date(entry.posted_at, '%m/%d/%Y %I:%M %p')
              || coalesce(' by ' || entry.posted_by, '')`}
          </Typography>
          <Show when={sql`entry.reverses_entry_id is not null`}>
            <a
              href={href(
                props.base,
                sql`'/journal/' || entry.reverses_entry_id`,
              )}
              className="text-primary-600 hover:underline"
            >
              Reverses an earlier entry
            </a>
          </Show>
          <Show when={sql`entry.reversed_by_id is not null`}>
            <a
              href={href(props.base, sql`'/journal/' || entry.reversed_by_id`)}
              className="text-primary-600 hover:underline"
            >
              Reversed by a later entry
            </a>
          </Show>
        </Card>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <th>Account</th>
                <AmountHeader>Debit</AmountHeader>
                <AmountHeader>Credit</AmountHeader>
                <th>Memo</th>
                {block.multiCurrency ? <th>Transaction amount</th> : null}
                {block.dimensions.map((d) => <th>{dimensionLabel(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              <Each table="entry_lines" recordName="entry_line">
                <tr>
                  <td>
                    <a
                      href={href(
                        props.base,
                        sql`'/accounts/' || entry_line.account_id`,
                      )}
                      className="text-primary-600 hover:underline"
                    >
                      {sql`entry_line.account`}
                    </a>
                  </td>
                  <DebitCreditCells
                    block={block}
                    amount={sql`entry_line.amount`}
                  />
                  <td>{sql`coalesce(entry_line.memo, '')`}</td>
                  {block.multiCurrency
                    ? <td>{sql`coalesce(entry_line.foreign_amount, '')`}</td>
                    : null}
                  {block.dimensions.map((d) => (
                    <td>
                      {sql`coalesce(entry_line.${
                        sql.ref(`${d.key}_label`)
                      }, '')`}
                    </td>
                  ))}
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Page>
    </Data>
  );
}

function ManualJournalsPage(props: PageCtx) {
  const block = props.block;
  return (
    <Page
      block={props.block}
      title="Journal entries"
      actions={
        <>
          <ActionButton
            variant="outlined"
            action={(s) => {
              props.block.requireManage(s);
              s.startTransaction();
              props.block.runRecurringJournals(s, sql`current_date()`);
              s.commitTransaction();
            }}
            successMessage="Due recurring entries posted"
          >
            Post due recurring entries
          </ActionButton>
          <ActionButton
            startIcon="Add"
            action={(s) => {
              props.block.requireManage(s);
              s.defScalar("new_journal_id", { type: "BigInt" });
              s.startTransaction();
              s.modify(sql`insert into db.ledger_manual_journals
              (journal_date, description)
              values (current_date(), 'Journal entry')
              returning id into new_journal_id`);
              s.commitTransaction();
              s.navigate(
                sql`${
                  sql.lit(`${props.base}/manual-journals/`)
                } || new_journal_id`,
              );
            }}
          >
            New journal entry
          </ActionButton>
        </>
      }
    >
      <Data
        procedure={(s) => {
          s.defTable(
            "manual_journals",
            sql`select journal.id, journal.journal_date, journal.description,
                ${block.manualJournalStatusSql(sql`journal.id`)} as status,
                (select sum(debit) from db.ledger_manual_journal_lines line
                  where line.manual_journal_id = journal.id) as total
              from db.ledger_manual_journals journal
              order by journal.journal_date desc, journal.id desc
              limit 500`,
          );
        }}
      >
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table hoverRow>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <AmountHeader>Amount</AmountHeader>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <Each table="manual_journals" recordName="journal">
                <tr>
                  <td>
                    <a
                      href={href(
                        props.base,
                        sql`'/manual-journals/' || journal.id`,
                      )}
                      className="text-primary-600 hover:underline"
                    >
                      {date(sql`journal.journal_date`)}
                    </a>
                  </td>
                  <td>{sql`journal.description`}</td>
                  <AmountCell block={block} amount={sql`journal.total`} />
                  <td>
                    <StatusChip status={sql`journal.status`} />
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Data>
    </Page>
  );
}

function StatusChip(props: { status: Sql }) {
  return (
    <>
      <Show when={sql`${props.status} = 'posted'`}>
        <Chip size="sm" color="success">Posted</Chip>
      </Show>
      <Show when={sql`${props.status} = 'void'`}>
        <Chip size="sm" color="neutral">Void</Chip>
      </Show>
      <Show when={sql`${props.status} = 'draft'`}>
        <Chip size="sm" color="warning">Draft</Chip>
      </Show>
      <Show when={sql`${props.status} = 'recurring'`}>
        <Chip size="sm" color="primary">Recurring</Chip>
      </Show>
    </>
  );
}

function ManualJournalPage(props: PageCtx) {
  const block = props.block;
  const source = block.manualJournalSource!;
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "journal_status",
          block.manualJournalStatusSql(sql`ledger_manual_journal_id`),
        );
        s.defScalar(
          "journal_entry_id",
          source.activeEntryId(sql`ledger_manual_journal_id`),
        );
        s.defScalar(
          "journal_repeat_error",
          sql`(select repeat_error from db.ledger_manual_journals
            where id = ledger_manual_journal_id)`,
        );
      }}
    >
      <Page
        block={props.block}
        title="Journal entry"
        aside={
          <>
            <StatusChip status={sql`journal_status`} />
            <Show when={sql`journal_repeat_error is not null`}>
              <Chip size="sm" color="danger">
                {sql`'Last run failed: ' || journal_repeat_error`}
              </Chip>
            </Show>
            <Show when={sql`journal_entry_id is not null`}>
              <Button
                size="sm"
                variant="outlined"
                href={href(props.base, sql`'/journal/' || journal_entry_id`)}
              >
                View posting
              </Button>
            </Show>
          </>
        }
        actions={
          <>
            <Show when={sql`journal_status = 'draft'`}>
              <ActionButton
                size="sm"
                color="danger"
                variant="outlined"
                confirm={{ description: "Delete this draft journal entry?" }}
                action={(s) => {
                  props.block.requireManage(s);
                  s.startTransaction();
                  // Checked here, not only by the button's visibility: a
                  // journal posted in another tab keeps its entry.
                  s.throwErrorIf(
                    sql`exists (select 1 from db.ledger_entries
                      where source = ${
                      block.manualJournalSource!.enumLiteral()
                    } and source_record_id = ledger_manual_journal_id)`,
                    sql
                      .lit`Only a draft that was never posted can be deleted; void it instead`,
                  );
                  s.modify(sql`delete from db.ledger_manual_journals
                    where id = ledger_manual_journal_id`);
                  s.commitTransaction();
                  s.navigate(sql.lit(`${props.base}/manual-journals`));
                }}
              >
                Delete draft
              </ActionButton>
            </Show>
            <Show when={sql`journal_status = 'posted'`}>
              <VoidControl
                block={block}
                name="journal"
                description="Voiding posts a reversal on the chosen date, or on the original entry date when none is chosen."
                action={(s, date) =>
                  block.voidManualJournal(
                    s,
                    sql`ledger_manual_journal_id`,
                    date,
                  )}
              />
            </Show>
          </>
        }
      >
        <Form
          defaultFieldComponent={LabelOnTopFormField}
          watch={[sql`ledger_manual_journal_id`]}
          beforeTransactionStart={(s) => block.requireManage(s)}
          beforeTransactionCommit={(s) => {
            // Saving a journal posts it; editing a posted journal reposts.
            // Recurring templates are saved as-is and post their occurrences;
            // a journal that was ever posted cannot become one.
            s.throwErrorIf(
              sql`(select repeat_months from db.ledger_manual_journals
                  where id = ledger_manual_journal_id) is not null
                and exists (select 1 from db.ledger_entries
                  where source = ${block.manualJournalSource!.enumLiteral()}
                    and source_record_id = ledger_manual_journal_id)`,
              sql
                .lit`A posted journal cannot become recurring; create a new journal as the template`,
            );
            s.if(
              sql`(select repeat_months from db.ledger_manual_journals
                where id = ledger_manual_journal_id) is null`,
              (s) => block.postManualJournal(s, sql`ledger_manual_journal_id`),
            );
          }}
          afterSubmitClientSuccess={(s) => s.refetch()}
        >
          <Form.Update
            table="ledger_manual_journals"
            where={sql`id = ledger_manual_journal_id`}
          >
            <Card variant="outlined" className="p-4 flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                <Form.Field field="journal_date" />
                <Form.Field field="description" />
                <Form.Field field="reverse_on" />
                <Form.Field field="repeat_months" />
                <Form.Field field="repeat_next" />
                <Form.Field field="repeat_until" />
                {block.books.length ? <Form.Field field="book" /> : null}
              </div>
              <Form.Relation table="ledger_manual_journal_lines">
                <div className="overflow-x-auto">
                  <Table borderAxis="none">
                    <thead>
                      <tr>
                        <th className="min-w-[280px]">Account</th>
                        <th className="w-[140px]">Debit</th>
                        <th className="w-[140px]">Credit</th>
                        <th>Memo</th>
                        {block.dimensions.map((d) => (
                          <th>{dimensionLabel(d)}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      <Form.Each>
                        <tr>
                          <td className="min-w-[280px]">
                            <Form.Field field="account_id">
                              <FieldFormControl aria-label="Account" />
                            </Form.Field>
                          </td>
                          <td>
                            <Form.Field field="debit">
                              <FieldFormControl aria-label="Debit" />
                            </Form.Field>
                          </td>
                          <td>
                            <Form.Field field="credit">
                              <FieldFormControl aria-label="Credit" />
                            </Form.Field>
                          </td>
                          <td>
                            <Form.Field field="memo">
                              <FieldFormControl aria-label="Memo" />
                            </Form.Field>
                          </td>
                          {block.dimensions.map((d) => (
                            <td>
                              <Form.Field field={`${d.key}_id`}>
                                <FieldFormControl
                                  aria-label={dimensionLabel(d)}
                                />
                              </Form.Field>
                            </td>
                          ))}
                          <td>
                            <Form.DeleteRecordIconButton
                              icon="Close"
                              aria-label="Remove line"
                              variant="plain"
                              size="sm"
                            />
                          </td>
                        </tr>
                      </Form.Each>
                    </tbody>
                  </Table>
                </div>
                <JournalTotals block={block} />
                <div>
                  <Form.AddCurrentTableButton
                    startIcon="Add"
                    variant="outlined"
                    size="sm"
                  >
                    Add line
                  </Form.AddCurrentTableButton>
                </div>
              </Form.Relation>
              <Form.ErrorAlert mode="all" />
              <Show
                when={sql`ledger_can_manage and journal_status <> 'void'`}
              >
                <div className="flex justify-end">
                  <Form.SubmitButton>Save and post</Form.SubmitButton>
                </div>
              </Show>
            </Card>
          </Form.Update>
        </Form>
      </Page>
    </Data>
  );
}

/** Live debit and credit totals for the journal lines being edited. */
function JournalTotals(props: { block: LedgerBlock }) {
  const block = props.block;
  const lines = useCurrentTableHelper().tableIdent;
  // Form state keeps numeric fields as edited text.
  const total = (field: string) =>
    sql`coalesce((select sum(try_cast(${
      sql.ref(field)
    } as decimal(18, 4))) from ${lines}), 0)`;
  const debits = total("debit");
  const credits = total("credit");
  return (
    <div className="flex flex-wrap justify-end gap-6 text-sm">
      <span>{sql`'Debits ' || ${block.formatAmountSql(debits)}`}</span>
      <span>{sql`'Credits ' || ${block.formatAmountSql(credits)}`}</span>
      <Show when={sql`${debits} <> ${credits}`}>
        <span className="text-danger-600 font-semibold">
          {sql`'Out of balance by ' || ${
            block.formatAmountSql(sql`abs(${debits} - ${credits})`)
          }`}
        </span>
      </Show>
    </div>
  );
}

function OpenItemsPage(props: PageCtx) {
  const block = props.block;
  const buckets: [string, (age: Sql) => Sql][] = [
    ["Current", (age) => sql`${age} <= 0`],
    ["1-30", (age) => sql`${age} > 0 and ${age} <= 30`],
    ["31-60", (age) => sql`${age} > 30 and ${age} <= 60`],
    ["61-90", (age) => sql`${age} > 60 and ${age} <= 90`],
    ["Over 90", (age) => sql`${age} > 90`],
  ];
  // Owed amounts read positive: receivable debits and payable credits.
  // Unapplied payments and credits read negative.
  const owed = sql`case when item.account_type = cast('accounts_payable'
      as enums.ledger_account_type) then -1 else 1 end
    * case when item.amount > 0 then 1 else -1 end * item.open_amount`;
  const items = sql`(select item.*, ${owed} as owed,
      date.diff(day, item.due_date, open_as_of) as age_days
    from (${block.openItemsQuery({ asOf: sql`open_as_of` })}) item)`;
  const bucketSums = (alias: string) =>
    buckets.map(([, when], index) =>
      sql`sum(case when ${when(sql`${sql.ref(alias)}.age_days`)}
        then ${sql.ref(alias)}.owed else 0 end) as ${
        sql.ref(`bucket_${index}`)
      }`
    );
  const summaryLabel = sql.caseWhen({
    conditions: block.dimensions.map((d) => ({
      condition: sql`open_group_by = ${sql.lit(d.key)}`,
      expr: sql`coalesce(${
        recordLabelSql(d.table, sql`grouped.${sql.ref(`${d.key}_id`)}`)
      }, 'Unassigned')`,
    })),
    default: sql.lit`All`,
  });
  return (
    <Page block={props.block} title="Open items">
      <Data
        procedure={(s) => {
          s.defScalar("open_as_of", {
            type: "Date",
            expr: sql`current_date()`,
          });
          s.defScalar("open_group_by", sql.lit``);
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <FormControl className="max-w-[200px]">
            <FormLabel>As of</FormLabel>
            <Input
              size="sm"
              type="date"
              value={sql`open_as_of`}
              onInput={(s, value) =>
                s.setScalar("open_as_of", sql`try_cast(${value} as date)`)}
            />
          </FormControl>
          {block.dimensions.length
            ? (
              <FormControl className="min-w-[180px]">
                <FormLabel>Summarize by</FormLabel>
                <Select
                  size="sm"
                  value={sql`open_group_by`}
                  onChange={(s) =>
                    s.setScalar("open_group_by", sql`target_value`)}
                >
                  <Select.Option value="">Each item</Select.Option>
                  {block.dimensions.map((d) => (
                    <Select.Option value={d.key}>
                      {dimensionLabel(d)}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
            )
            : null}
        </div>
        <Data
          watch={[sql`open_as_of`, sql`open_group_by`]}
          procedure={(s) => {
            s.defTable(
              "open_items",
              sql`select item.line_id, item.entry_id, item.posting_date,
                  item.source, item.document_number, item.owed, item.age_days,
                  account.number || ' ' || account.name as account
                  ${
                block.dimensions.length
                  ? sql`, ${
                    block.dimensions.map((d) =>
                      sql`${
                        recordLabelSql(
                          d.table,
                          sql`item.${sql.ref(`${d.key}_id`)}`,
                        )
                      } as ${sql.ref(`${d.key}_label`)}`
                    )
                  }`
                  : sql``
              }
                from ${items} item
                join db.ledger_accounts account on account.id = item.account_id
                where open_group_by = ''
                order by account.number, item.posting_date
                limit 1000`,
            );
            // Summaries and totals come from every open item.
            s.defTable(
              "open_summary",
              sql`select account.number || ' ' || account.name as account,
                  ${summaryLabel} as party, ${bucketSums("grouped")}
                from ${items} grouped
                join db.ledger_accounts account
                  on account.id = grouped.account_id
                where open_group_by <> ''
                group by account.number, account.name, ${summaryLabel}
                order by account.number, party`,
            );
            s.defTable(
              "open_item_totals",
              sql`select account.number || ' ' || account.name as account,
                  ${bucketSums("totals")}
                from ${items} totals
                join db.ledger_accounts account on account.id = totals.account_id
                group by account.number, account.name
                order by account.number`,
            );
          }}
        >
          <ExportButton
            fileName="open-items.csv"
            query={sql`select account.number || ' ' || account.name
                as account,
                format.date(item.posting_date, '%Y-%m-%d') as date,
                coalesce(format.date(item.due_date, '%Y-%m-%d'), '') as due,
                coalesce(item.document_number, '') as document
                ${
              block.dimensions.length
                ? sql`, ${
                  block.dimensions.map((d) =>
                    sql`coalesce(${
                      recordLabelSql(
                        d.table,
                        sql`item.${sql.ref(`${d.key}_id`)}`,
                      )
                    }, '') as ${sql.ref(d.key)}`
                  )
                }`
                : sql``
            },
                ${csvAmount(sql`item.owed`)} as open_amount,
                item.age_days as days_past_due
              from ${items} item
              join db.ledger_accounts account on account.id = item.account_id
              where ${block.canViewSql(sql`current_user`)}
              order by account.number, item.posting_date`}
          />
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <Show
                    when={sql`open_group_by = ''`}
                    fallback={
                      <>
                        <th>Account</th>
                        <th>
                          {sql`initcap(replace(open_group_by, '_', ' '))`}
                        </th>
                      </>
                    }
                  >
                    <th>Date</th>
                    <th>Account</th>
                    <th>Document</th>
                    {block.dimensions.map((d) => <th>{dimensionLabel(d)}</th>)}
                  </Show>
                  {buckets.map(([label]) => <AmountHeader>{label}
                  </AmountHeader>)}
                </tr>
              </thead>
              <tbody>
                <Each table="open_items" recordName="open_item">
                  <tr>
                    <td>
                      <a
                        href={href(
                          props.base,
                          sql`'/journal/' || open_item.entry_id`,
                        )}
                        className="text-primary-600 hover:underline"
                      >
                        {date(sql`open_item.posting_date`)}
                      </a>
                    </td>
                    <td>{sql`open_item.account`}</td>
                    <td>
                      {sql`coalesce(open_item.document_number, ${
                        sourceLabelSql(block, sql`open_item.source`)
                      })`}
                    </td>
                    {block.dimensions.map((d) => (
                      <td>
                        {sql`coalesce(open_item.${
                          sql.ref(`${d.key}_label`)
                        }, '')`}
                      </td>
                    ))}
                    {buckets.map(([, when]) => (
                      <AmountCell
                        block={block}
                        amount={sql`case when ${
                          when(sql`open_item.age_days`)
                        } then open_item.owed end`}
                      />
                    ))}
                  </tr>
                </Each>
                <Each table="open_summary" recordName="open_group">
                  <tr>
                    <td>{sql`open_group.account`}</td>
                    <td>{sql`open_group.party`}</td>
                    {buckets.map((_, index) => (
                      <AmountCell
                        block={block}
                        amount={sql`open_group.${sql.ref(`bucket_${index}`)}`}
                      />
                    ))}
                  </tr>
                </Each>
              </tbody>
              <tfoot>
                <Each table="open_item_totals" recordName="open_total">
                  <tr className="font-bold">
                    <td>{sql`'Total ' || open_total.account`}</td>
                    <Show
                      when={sql`open_group_by = ''`}
                      fallback={<td />}
                    >
                      <td colSpan={1 + block.dimensions.length} />
                    </Show>
                    {buckets.map((_, index) => (
                      <AmountCell
                        block={block}
                        amount={sql`open_total.${sql.ref(`bucket_${index}`)}`}
                      />
                    ))}
                  </tr>
                </Each>
              </tfoot>
            </Table>
          </Card>
        </Data>
      </Data>
    </Page>
  );
}

function CloseBooksPage(props: PageCtx) {
  const block = props.block;
  return (
    <Page block={props.block} title="Close books">
      <Data
        procedure={(s) => {
          // With entities, each entity's close in force.
          s.defScalar("closed_status", {
            type: { type: "String", maxLength: 2000 },
            expr: block.entities
              ? sql`(select string_agg(${date(sql`closed.through`)}
                  || ' (' || closed.name || ')', ', ')
                from (select entity.name,
                    ${block.closedThroughSql(sql`entity.id`)} as through
                  from db.ledger_entities entity) closed
                where closed.through is not null)`
              : date(block.closedThroughSql()),
          });
          s.defScalar("close_entity_id", { type: "BigInt" });
          s.defScalar("close_date", {
            type: "Date",
            expr:
              sql`date.subtract(day, 1, date.start_of_month(current_date()))`,
          });
          s.defTable("integrity_checks", block.integrityQuery());
          s.defScalar("ledger_can_close", block.canCloseSql(sql`current_user`));
          s.defTable(
            "closings",
            sql`select closing.id, closing.closed_through, closing.note,
                closing.closed_at,
                ${
              block.entities
                ? sql`coalesce(${
                  recordLabelSql("ledger_entities", sql`closing.entity_id`)
                }, 'All entities')`
                : sql`''`
            } as scope,
                ${recordLabelSql("sys_users", sql`closing.closed_by`)}
                  as closed_by
              from db.ledger_closings closing order by id desc limit 50`,
          );
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-col gap-4">
          <Typography level="body-md">
            {sql`case when closed_status is null
              then 'The books are open. Any date can be posted.'
              else 'The books are closed through ' || closed_status
                || '. Entries on or before that date are rejected.' end`}
          </Typography>
          <div className="flex flex-wrap items-end gap-3">
            {block.entities
              ? (
                <FormControl className="min-w-[200px]">
                  <FormLabel>Entity</FormLabel>
                  <TableRecordSelect
                    tableName="ledger_entities"
                    value={sql`close_entity_id`}
                    onSelectValue={(s, value) =>
                      s.setScalar("close_entity_id", value)}
                    placeholder="All entities"
                  />
                </FormControl>
              )
              : null}
            <FormControl>
              <FormLabel>Close through</FormLabel>
              <Input
                size="sm"
                type="date"
                value={sql`close_date`}
                onInput={(s, value) =>
                  s.setScalar("close_date", sql`try_cast(${value} as date)`)}
              />
            </FormControl>
            <ActionButton
              size="sm"
              startIcon="Lock"
              action={(s) => {
                props.block.requireClose(s);
                s.throwErrorIf(
                  sql`close_date is null`,
                  sql.lit`Choose a closing date`,
                );
                s.throwErrorIf(
                  sql`exists (select 1 from (${block.integrityQuery()}) checks
                    where issue_count <> 0)`,
                  sql.lit`Resolve the integrity checks before closing`,
                );
                s.startTransaction();
                block.closeBooks(s, {
                  through: sql`close_date`,
                  entityId: block.entities ? sql`close_entity_id` : undefined,
                });
                s.commitTransaction();
              }}
              successMessage="Books closed"
            >
              Close books
            </ActionButton>
            <Show when={sql`closed_status is not null and ledger_can_close`}>
              <ActionButton
                size="sm"
                variant="outlined"
                color="warning"
                confirm={{
                  description: block.entities
                    ? "Reopening allows entries to post into previously closed periods of the chosen entity, or of every entity when none is chosen."
                    : "Reopening allows entries to post into previously closed periods.",
                }}
                action={(s) => {
                  props.block.requireClose(s);
                  s.startTransaction();
                  block.closeBooks(s, {
                    through: sql`cast(null as date)`,
                    note: sql.lit`Reopened`,
                    entityId: block.entities ? sql`close_entity_id` : undefined,
                  });
                  s.commitTransaction();
                }}
                successMessage="Books reopened"
              >
                Reopen
              </ActionButton>
            </Show>
          </div>
          <Data
            watch={[sql`close_date`]}
            procedure={(s) =>
              s.defTable(
                "close_checks",
                block.closeChecksQuery(sql`close_date`),
              )}
          >
            <div className="flex flex-col gap-1">
              <Typography level="title-sm">Before closing</Typography>
              <Each table="close_checks" recordName="close_check">
                <div className="flex justify-between gap-4">
                  <span>{sql`close_check.check_name`}</span>
                  <Show
                    when={sql`close_check.issue_count = 0`}
                    fallback={
                      <Chip size="sm" color="warning">
                        {sql`cast(close_check.issue_count as string)`}
                      </Chip>
                    }
                  >
                    <Chip size="sm" color="success">None</Chip>
                  </Show>
                </div>
              </Each>
            </div>
          </Data>
        </Card>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                {block.entities ? <th>Entity</th> : null}
                <th>Closed through</th>
                <th>Note</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              <Each table="closings" recordName="closing">
                <tr>
                  {block.entities ? <td>{sql`closing.scope`}</td> : null}
                  <td>
                    {sql`coalesce(${
                      date(sql`closing.closed_through`)
                    }, 'Open')`}
                  </td>
                  <td>{sql`coalesce(closing.note, '')`}</td>
                  <td>
                    {sql`format.date(closing.closed_at, '%m/%d/%Y %I:%M %p')
                      || coalesce(' by ' || closing.closed_by, '')`}
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
        <Card variant="outlined" className="p-4 flex flex-col gap-2">
          <Typography level="title-md">Integrity checks</Typography>
          <Each table="integrity_checks" recordName="integrity_check">
            <div className="flex justify-between gap-4">
              <span>{sql`integrity_check.check_name`}</span>
              <Show
                when={sql`integrity_check.issue_count = 0`}
                fallback={
                  <Chip size="sm" color="danger">
                    {sql`integrity_check.issue_count || ' found'`}
                  </Chip>
                }
              >
                <Chip size="sm" color="success">OK</Chip>
              </Show>
            </div>
          </Each>
        </Card>
      </Data>
    </Page>
  );
}

/**
 * Every posted line in a date range by account, with each account's
 * opening balance and running balance: the detail accountants tie out.
 * Shows the first 2,000 lines; the export has all of them.
 */
function GeneralLedgerPage(props: PageCtx) {
  const block = props.block;
  const lines = sql`select account.number, account.name,
      line.account_id, line.id as line_id, line.posting_date,
      entry.id as entry_id, entry.source, entry.document_number,
      coalesce(line.memo, entry.description) as description, line.amount,
      coalesce(opening.amount, 0) + sum(line.amount) over (
        partition by line.account_id order by line.posting_date, line.id
        rows between unbounded preceding and current row) as balance
    from db.ledger_lines line
    join db.ledger_entries entry on entry.id = line.entry_id
    join db.ledger_accounts account on account.id = line.account_id
    left join (select opening_line.account_id,
        sum(opening_line.amount) as amount
      from db.ledger_lines opening_line
      join db.ledger_accounts opening_account
        on opening_account.id = opening_line.account_id
      where opening_line.posting_date < gl_from
        and (opening_account.account_class
            in ('asset', 'liability', 'equity')
          or opening_line.posting_date >= ${
    block.fiscalYearStartSql(sql`gl_from`)
  })
        ${block.books.length ? sql`and opening_line.book is null` : sql``}
      group by opening_line.account_id) opening
      on opening.account_id = line.account_id
    where line.posting_date between gl_from and gl_to
      and (gl_account_id is null or line.account_id = gl_account_id)
      ${block.books.length ? sql`and line.book is null` : sql``}
      and ${block.canViewSql(sql`current_user`)}`;
  return (
    <Page block={block} title="General ledger">
      <Data
        procedure={(s) => {
          s.defScalar("gl_from", {
            type: "Date",
            expr: sql`date.start_of_month(current_date())`,
          });
          s.defScalar("gl_to", { type: "Date", expr: sql`current_date()` });
          s.defScalar("gl_account_id", { type: "BigInt" });
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <DateRange from="gl_from" to="gl_to" />
          <FormControl className="min-w-[240px]">
            <FormLabel>Account</FormLabel>
            <TableRecordSelect
              tableName="ledger_accounts"
              value={sql`gl_account_id`}
              onSelectValue={(s, value) => s.setScalar("gl_account_id", value)}
              placeholder="All accounts"
            />
          </FormControl>
        </div>
        <Data
          watch={[sql`gl_from`, sql`gl_to`, sql`gl_account_id`]}
          procedure={(s) =>
            s.defTable(
              "gl_lines",
              sql`select * from (${lines}) gl
                order by number, posting_date, line_id limit 2000`,
            )}
        >
          <ExportButton
            fileName="general-ledger.csv"
            query={sql`select number as account_number, name as account,
                format.date(posting_date, '%Y-%m-%d') as date,
                entry_id, cast(source as string) as source,
                coalesce(document_number, '') as document,
                coalesce(description, '') as description,
                ${csvAmount(sql`case when amount > 0 then amount end`)}
                  as debit,
                ${csvAmount(sql`case when amount < 0 then -amount end`)}
                  as credit,
                ${csvAmount(sql`balance`)} as balance
              from (${lines}) gl order by number, posting_date, line_id`}
          />
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Description</th>
                  <AmountHeader>Debit</AmountHeader>
                  <AmountHeader>Credit</AmountHeader>
                  <AmountHeader>Balance</AmountHeader>
                </tr>
              </thead>
              <tbody>
                <Each table="gl_lines" recordName="gl_line">
                  <tr>
                    <td>{sql`gl_line.number || ' ' || gl_line.name`}</td>
                    <td>
                      <a
                        href={href(
                          props.base,
                          sql`'/journal/' || gl_line.entry_id`,
                        )}
                        className="text-primary-600 hover:underline"
                      >
                        {date(sql`gl_line.posting_date`)}
                      </a>
                    </td>
                    <td>
                      {sql`${sourceLabelSql(block, sql`gl_line.source`)}
                        || coalesce(' ' || gl_line.document_number, '')`}
                    </td>
                    <td>{sql`coalesce(gl_line.description, '')`}</td>
                    <DebitCreditCells
                      block={block}
                      amount={sql`gl_line.amount`}
                    />
                    <AmountCell block={block} amount={sql`gl_line.balance`} />
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Data>
      </Data>
    </Page>
  );
}

/** Cash flow sections by account type (indirect method). */
const CASH_FLOW_SECTIONS: [string, string[]][] = [
  ["Operating activities", [
    "accounts_receivable",
    "other_current_asset",
    "accounts_payable",
    "credit_card",
    "other_current_liability",
  ]],
  ["Investing activities", ["fixed_asset", "other_asset"]],
  ["Financing activities", ["long_term_liability", "equity"]],
];

/**
 * Statement of cash flows, indirect method: net income, then the change in
 * each non-cash balance sheet account in the period, grouped by section.
 * Cash is the bank accounts; the sections add up to their change.
 */
function CashFlowPage(props: PageCtx) {
  const block = props.block;
  const scope = reportScope(block, "cf", entityDimensions(block));
  const pnlTypes = PNL_TYPES.map((t) => sql.lit(t));
  return (
    <Page block={block} title="Cash flow">
      <Data
        procedure={(s) => {
          s.defScalar("cf_from", {
            type: "Date",
            expr: block.fiscalYearStartSql(sql`current_date()`),
          });
          s.defScalar("cf_to", { type: "Date", expr: sql`current_date()` });
          scope.defineScalars(s);
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <DateRange from="cf_from" to="cf_to" />
          {scope.filters}
        </div>
        <Data
          watch={[sql`cf_from`, sql`cf_to`, ...scope.watch]}
          procedure={(s) => {
            loadTotals(s, block, {
              asOf: sql`cf_to`,
              from: sql`cf_from`,
              lineFilter: scope.lineFilter,
              book: scope.book,
            });
            s.defTable("cf_lines", {
              fields: [
                { name: "sort", type: "Int" },
                { name: "kind", type: { type: "String", maxLength: 20 } },
                { name: "label", type: { type: "String", maxLength: 650 } },
                { name: "account_id", type: "BigInt" },
                { name: "amount", type: AMOUNT_TYPE },
              ],
            });
            s.modify(sql`insert into cf_lines
              select 0, 'account', 'Net income', cast(null as bigint),
                coalesce(-sum(activity), 0)
              from ledger_totals
              where cast(type as string) in (${pnlTypes})`);
            CASH_FLOW_SECTIONS.forEach(([label, types], index) => {
              const inSection = sql`cast(type as string) in (${
                types.map((t) => sql.lit(t))
              })`;
              const sort = (index + 1) * 10;
              s.modify(sql`insert into cf_lines
                select ${sort}, 'header', ${sql.lit(label)},
                  cast(null as bigint), cast(null as decimal(18, 4))
                union all
                select ${sort + 1}, 'account', number || ' ' || display_name,
                  account_id, -activity
                from ledger_totals where ${inSection} and activity <> 0
                union all
                select ${sort + 2}, 'total', ${
                sql.lit(`Net cash from ${label.toLowerCase()}`)
              },
                  cast(null as bigint),
                  coalesce(-sum(activity), 0)
                    + ${
                index === 0
                  ? sql`(select amount from cf_lines
                      where sort = 0)`
                  : sql`0`
              }
                from ledger_totals where ${inSection}`);
            });
            s.modify(sql`insert into cf_lines
              select 90, 'grand_total', 'Net change in cash',
                cast(null as bigint), coalesce(sum(activity), 0)
              from ledger_totals
              where type = cast('bank' as enums.ledger_account_type)
              union all
              select 91, 'account', 'Cash at end of period',
                cast(null as bigint), coalesce(sum(balance), 0)
              from ledger_totals
              where type = cast('bank' as enums.ledger_account_type)`);
          }}
        >
          <ExportButton
            fileName="cash-flow.csv"
            query={sql`select label, ${csvAmount(sql`amount`)} as amount
              from cf_lines order by sort, label`}
          />
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table borderAxis="none" hoverRow>
              <tbody>
                <Each table="cf_lines" recordName="cf_line">
                  {REPORT_ROW_KINDS.map(([kind, rowClass, labelClass]) => (
                    <Show when={sql`cf_line.kind = ${sql.lit(kind)}`}>
                      <tr className={rowClass}>
                        <td>
                          <div className={labelClass}>
                            <ReportLabel base={props.base} row="cf_line" />
                          </div>
                        </td>
                        <AmountCell
                          block={block}
                          amount={sql`cf_line.amount`}
                        />
                      </tr>
                    </Show>
                  ))}
                </Each>
              </tbody>
            </Table>
          </Card>
        </Data>
      </Data>
    </Page>
  );
}

function LedgerOverview(props: PageCtx) {
  const block = props.block;
  const tiles: [string, Sql][] = [
    [
      "Cash",
      sql`(select coalesce(sum(balance), 0) from ledger_totals
        where type = cast('bank' as enums.ledger_account_type))`,
    ],
    [
      "Receivables",
      sql`(select coalesce(sum(balance), 0) from ledger_totals
        where type = cast('accounts_receivable' as enums.ledger_account_type))`,
    ],
    [
      "Payables",
      sql`(select coalesce(-sum(balance), 0) from ledger_totals
        where type = cast('accounts_payable' as enums.ledger_account_type))`,
    ],
    [
      "Net income, year to date",
      sql`(select coalesce(-sum(balance), 0) from ledger_totals
        where account_class in ('income', 'expense'))`,
    ],
  ];
  return (
    <Page block={props.block} title="Accounting">
      <Data
        procedure={(s) => {
          loadTotals(s, block, { asOf: sql`current_date()` });
          tiles.forEach(([, expr], index) =>
            s.defScalar(`overview_tile_${index}`, expr)
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map(([label], index) => (
            <Card variant="outlined" className="p-4">
              <Typography level="body-sm" className="text-secondary">
                {label}
              </Typography>
              <Typography level="h3">
                {block.formatAmountSql(sql.ref(`overview_tile_${index}`))}
              </Typography>
            </Card>
          ))}
        </div>
      </Data>
      <Data
        procedure={(s) => {
          s.defTable(
            "overview_months",
            sql`select period,
                sum(case when normal_sign = -1 then -amount else 0 end)
                  as income,
                sum(case when normal_sign = 1 then amount else 0 end)
                  as expenses,
                -sum(amount) as net
              from (${
              block.profitAndLossActivityQuery({
                from: block.fiscalYearStartSql(sql`current_date()`),
                to: sql`current_date()`,
                byMonth: sql`true`,
              })
            }) activity
              group by period order by period desc`,
          );
        }}
      >
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table hoverRow>
            <thead>
              <tr>
                <th>Month</th>
                <AmountHeader>Income</AmountHeader>
                <AmountHeader>Expenses</AmountHeader>
                <AmountHeader>Net income</AmountHeader>
              </tr>
            </thead>
            <tbody>
              <Each table="overview_months" recordName="overview_month">
                <tr>
                  <td>{sql`format.date(overview_month.period, '%B %Y')`}</td>
                  <AmountCell
                    block={block}
                    amount={sql`overview_month.income`}
                  />
                  <AmountCell
                    block={block}
                    amount={sql`overview_month.expenses`}
                  />
                  <AmountCell block={block} amount={sql`overview_month.net`} />
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Data>
    </Page>
  );
}
