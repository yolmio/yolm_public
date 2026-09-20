import { Alert } from "components/alert";
import { Card } from "components/card";
import { CircularProgress } from "components/circular_progress";
import { DateRangeFilter } from "components/date_range";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Snackbar } from "components/snackbar";
import { StatRow } from "components/stat_row";
import { Typography } from "components/typography";
import { WiseStatLineChart } from "components/wise_stat_line_chart";
import type {
  WiseStatDisplaySize,
  WiseStatValueFormat,
} from "components/wise_stat_line_chart";
import { Data } from "std/data";
import { Form } from "std/form";
import { createStyles } from "std/style_utils";
import { type NumericExpr, type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import { Each, Route, Show } from "std/ui";
import type { Node } from "std/ui";

export type ManualStatValueFormat =
  | "number"
  | "number_thousands"
  | "currency"
  | "percentage"
  | "ratio"
  | "duration";

export type ManualStatCadence = "daily" | "weekly" | "monthly";

export type ManualStatTargetDirection =
  | "higher_is_better"
  | "lower_is_better"
  | "target_is_best";

export interface ManualStatDefinition {
  name: string;
  displayName: string;
  description?: string;
  valueFormat?: ManualStatValueFormat;
  cadence?: ManualStatCadence;
  unit?: string;
  quota?: NumericExpr;
  graphLow?: NumericExpr;
  graphDivision?: NumericExpr;
  targetDirection?: ManualStatTargetDirection;
  ownerHeader?: string;
  ownerLabel?: string;
  sortOrder?: number;
  active?: boolean;
  renameFrom?: string;
}

export interface ManualStatsBlockOptions {
  name: string;
  stats: ManualStatDefinition[];
  enumName?: string;
  tableName?: string;
  trackEnteredBy?: boolean;
  includeNotes?: boolean;
  defaultEntryDate?: Sql;
  defaultStartDate?: Sql;
  defaultEndDate?: Sql;
  extendEntryTable?: (table: TableBuilder) => void;
}

export interface ManualStatsDateRange {
  startDate?: Sql;
  endDate?: Sql;
}

const styles = createStyles({
  page: {
    width: "100%",
    maxWidth: "1200px",
    mx: "auto",
    p: 6,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    md: {
      p: 10,
    },
  },
  entryPage: {
    maxWidth: "900px",
    p: 4,
    gap: 3,
    md: {
      p: 6,
    },
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    md: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 3,
    alignItems: "flex-end",
  },
  chartCard: {
    minWidth: 0,
    width: "100%",
    maxWidth: "734px",
    mx: "auto",
    p: "4px",
    overflowX: "auto",
    backgroundColor: "#f7f8fb",
  },
  graphGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 360px)",
    gap: "4px",
    alignItems: "start",
    justifyItems: "center",
    justifyContent: "center",
    md: {
      gridTemplateColumns: "repeat(2, minmax(320px, 360px))",
    },
  },
  emptyChartFrame: {
    width: "100%",
    minWidth: "320px",
    maxWidth: "360px",
    minHeight: "180px",
    mx: "auto",
    p: 4,
    border: "1px solid #9aa6bd",
    backgroundColor: "#ffffff",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.14)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
    justifyContent: "space-between",
  },
  entryList: {
    display: "grid",
    gap: 0,
  },
  entryTable: {
    p: 0,
    overflow: "hidden",
  },
  entryRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(110px, 160px)",
    gap: 2,
    px: 2,
    py: 1.5,
    alignItems: "center",
    borderBottom: "1px solid",
    borderColor: "divider",
    "&:last-child": {
      borderBottom: "none",
    },
    lg: {
      gridTemplateColumns: "minmax(260px, 1fr) 180px",
      gap: 3,
    },
  },
  entryToolbar: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 2,
    pb: 2,
    borderBottom: "1px solid",
    borderColor: "divider",
    backgroundColor: "background.surface",
  },
  weekSelector: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  weekControls: {
    display: "flex",
    alignItems: "center",
    gap: 1,
  },
  selectedWeek: {
    minWidth: "190px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 0.5,
  },
  weekBadge: {
    display: "flex",
    alignItems: "center",
    gap: 0.5,
    px: 1,
    py: 0.25,
    borderRadius: "999px",
    backgroundColor: "primary.softBg",
    color: "primary.softColor",
  },
  divisionHeader: {
    px: 2,
    py: 1.5,
    backgroundColor: "background.level1",
    borderBottom: "1px solid",
    borderColor: "divider",
  },
  recentList: {
    display: "grid",
    gap: 2,
  },
  recentHeader: {
    display: "none",
    md: {
      display: "grid",
      gridTemplateColumns: "120px minmax(180px, 1fr) 120px",
      gap: 3,
      px: 3,
      py: 2,
      borderBottom: "1px solid",
      borderColor: "divider",
      color: "text.tertiary",
      fontWeight: "lg",
    },
  },
  recentEntry: {
    display: "grid",
    gap: 1,
    px: 3,
    py: 3,
    borderBottom: "1px solid",
    borderColor: "divider",
    md: {
      gridTemplateColumns: "120px minmax(180px, 1fr) 120px",
      gap: 3,
      alignItems: "center",
      py: 2,
    },
  },
  recentCell: {
    display: "flex",
    justifyContent: "space-between",
    gap: 3,
    minWidth: 0,
    md: {
      display: "block",
    },
  },
  recentCellLabel: {
    color: "text.tertiary",
    fontSize: "sm",
    fontWeight: "md",
    flexShrink: 0,
    md: {
      display: "none",
    },
  },
  recentCellValue: {
    textAlign: "right",
    minWidth: 0,
    wordBreak: "break-word",
    md: {
      textAlign: "left",
    },
  },
});

const namePattern = /^[a-z][a-z0-9_]*$/;

function validateSqlName(kind: string, name: string) {
  if (!namePattern.test(name)) {
    throw new Error(
      `${kind} "${name}" must be snake_case and start with a lowercase letter.`,
    );
  }
}

function optionalSql(value: NumericExpr | undefined) {
  return value === undefined ? sql.null : sql.normalizeExpr(value);
}

function optionalLiteral(value: string | undefined) {
  return value === undefined ? sql`cast(null as string)` : sql.lit(value);
}

function formatManualStatValue(
  value: NumericExpr,
  valueFormat: Sql = sql.lit`number`,
) {
  return sql`
    case
      when ${valueFormat} = 'currency' then format.currency(coalesce(${value}, 0), 'USD')
      when ${valueFormat} = 'percentage' then format.decimal(coalesce(${value}, 0) * 100.0, maximum_fraction_digits => 2) || '%'
      when ${valueFormat} = 'duration'
        then fn.display_minutes_duration(cast(round(coalesce(${value}, 0)) as bigint))
      else format.decimal(coalesce(${value}, 0), maximum_fraction_digits => 2)
    end
  `;
}

function chartValueFormat(stat: ManualStatDefinition): WiseStatValueFormat {
  const format = stat.valueFormat ?? "number";
  return format === "ratio" ? "number" : format;
}

function PageHeader(props: {
  title: string;
  subtitle?: string;
  actions?: Node;
}) {
  return (
    <div sx={styles.header}>
      <div sx={styles.headerText}>
        <Typography level="h2">{props.title}</Typography>
        {props.subtitle && (
          <Typography level="body-md" color="neutral">
            {props.subtitle}
          </Typography>
        )}
      </div>
      {props.actions && <div sx={styles.actions}>{props.actions}</div>}
    </div>
  );
}

export class ManualStatsBlock implements Block {
  blockName = "ManualStatsBlock";
  blockDisplayName = "Manual Stats";
  componentDependencies = [
    "ManualStatsDashboardPage",
    "ManualStatsEntryPage",
    "ManualStatsLineChart",
    "ManualStatsDualLineChart",
  ];
  description =
    "Dev-defined manual stats with enum-backed entry rows and WISE-style line-chart helpers.";

  readonly enumName: string;
  readonly tableName: string;
  readonly trackEnteredBy: boolean;
  readonly defaultEntryDate: Sql;
  readonly defaultStartDate: Sql;
  readonly defaultEndDate: Sql;
  readonly stats: ManualStatDefinition[];

  constructor(public opts: ManualStatsBlockOptions) {
    validateSqlName("ManualStatsBlock name", opts.name);
    this.enumName = opts.enumName ?? `${opts.name}_manual_stat_type`;
    this.tableName = opts.tableName ?? `${opts.name}_manual_stat_entries`;
    this.trackEnteredBy = opts.trackEnteredBy ?? true;
    this.defaultEntryDate = opts.defaultEntryDate ?? sql`current_date()`;
    this.defaultStartDate = opts.defaultStartDate ??
      sql`date.add(day, -84, current_date())`;
    this.defaultEndDate = opts.defaultEndDate ?? sql`current_date()`;
    this.stats = opts.stats.filter((stat) => stat.active ?? true);

    validateSqlName("manual stats enumName", this.enumName);
    validateSqlName("manual stats tableName", this.tableName);
    if (opts.stats.length === 0) {
      throw new Error(
        "ManualStatsBlock requires at least one stat definition.",
      );
    }
    if (this.stats.length === 0) {
      throw new Error(
        "ManualStatsBlock requires at least one active stat definition.",
      );
    }

    const names = new Set<string>();
    for (const stat of opts.stats) {
      validateSqlName("manual stat name", stat.name);
      if (names.has(stat.name)) {
        throw new Error(`Duplicate manual stat definition: ${stat.name}`);
      }
      names.add(stat.name);
    }
  }

  initialize() {
    system.enum_({
      name: this.enumName,
      values: this.opts.stats.map((stat) => ({
        name: stat.name,
        displayName: stat.displayName,
        description: stat.description,
        renameFrom: stat.renameFrom,
      })),
    });

    system.db.table(this.tableName, (table) => {
      table.description(
        "Manual stat values keyed by a developer-defined stat type and reporting period.",
      );
      table.enum("stat_type", this.enumName).notNull();
      table.date("period_start_date").notNull();
      table.decimal("value", { precision: 18, scale: 4 });
      if (this.opts.includeNotes ?? true) {
        table.string("notes", 2000).multiline();
      }
      if (this.trackEnteredBy) {
        table.fk("entered_by", "sys_users");
      }
      table.timestampUtc("entered_at").notNull().default(sql`now()`);
      table.unique(["stat_type", "period_start_date"]);
      table.recordDisplayName(
        ["stat_type", "period_start_date"],
        (statType, periodStartDate) =>
          sql`${statType}::string || ' - ' || format.date(${periodStartDate}, '%b %d, %Y')`,
      );
      this.opts.extendEntryTable?.(table);
    });
  }

  stat(name: string) {
    const stat = this.opts.stats.find((candidate) => candidate.name === name);
    if (!stat) {
      throw new Error(`Manual stat "${name}" is not defined.`);
    }
    return stat;
  }

  statTypeExpr(name: string) {
    this.stat(name);
    return sql`cast(${sql.lit(name)} as enums.${sql.ref(this.enumName)})`;
  }

  entriesTableRef() {
    return sql.ref(`db.${this.tableName}`);
  }

  statDefinitionsQuery() {
    return sql.unionAll(
      ...this.stats.map((stat, index) => {
        const valueFormat = stat.valueFormat ?? "number";
        const cadence = stat.cadence ?? "weekly";
        const targetDirection = stat.targetDirection ?? "higher_is_better";
        return sql`
          select
            ${this.statTypeExpr(stat.name)} as stat_type,
            ${sql.lit(stat.displayName)} as display_name,
            ${optionalLiteral(stat.description)} as description,
            ${sql.lit(valueFormat)} as value_format,
            ${sql.lit(cadence)} as cadence,
            ${optionalLiteral(stat.unit)} as unit,
            ${optionalSql(stat.quota)} as quota,
            ${optionalSql(stat.graphLow)} as graph_low,
            ${optionalSql(stat.graphDivision)} as graph_division,
            ${sql.lit(targetDirection)} as target_direction,
            ${optionalLiteral(stat.ownerHeader)} as owner_header,
            ${optionalLiteral(stat.ownerLabel)} as owner_label,
            ${stat.sortOrder ?? index} as sort_order
        `;
      }),
    );
  }

  statQuery(name: string, range: ManualStatsDateRange = {}) {
    const startDate = range.startDate ?? this.defaultStartDate;
    const endDate = range.endDate ?? this.defaultEndDate;
    return sql`
      select
        period_start_date,
        avg(value)::double as value
      from ${this.entriesTableRef()}
      where stat_type = ${this.statTypeExpr(name)}
        and period_start_date between ${startDate} and ${endDate}
        and value is not null
      group by period_start_date
      order by period_start_date
    `;
  }
}

export function ManualStatsLineChart(props: {
  block: ManualStatsBlock;
  stat: string;
  startDate?: Sql;
  endDate?: Sql;
  title?: Node;
  ownerHeader?: Node;
  ownerLabel?: Node;
  emptyFallback?: Node;
  errorFallback?: Node;
  pendingFallback?: Node;
  viewHref?: Sql | string;
  displaySize?: WiseStatDisplaySize;
}) {
  const stat = props.block.stat(props.stat);
  const title = props.title ?? stat.displayName;
  return (
    <WiseStatLineChart
      title={title}
      valueFormat={chartValueFormat(stat)}
      unit={stat.unit}
      ownerHeader={props.ownerHeader ??
        (stat.ownerHeader === undefined
          ? undefined
          : sql.lit(stat.ownerHeader))}
      ownerLabel={props.ownerLabel ??
        (stat.ownerLabel === undefined ? undefined : sql.lit(stat.ownerLabel))}
      reverseAxis={stat.targetDirection === "lower_is_better"}
      graphLow={stat.graphLow === undefined
        ? undefined
        : sql.normalizeExpr(stat.graphLow)}
      graphDivision={stat.graphDivision === undefined
        ? undefined
        : sql.normalizeExpr(stat.graphDivision)}
      query={props.block.statQuery(props.stat, {
        startDate: props.startDate,
        endDate: props.endDate,
      })}
      emptyFallback={props.emptyFallback ?? (
        <div sx={styles.emptyChartFrame}>
          <div>
            <Typography level="title-sm" color="primary">
              {title}
            </Typography>
            <Typography level="body-xs" color="neutral">
              {stat.description ?? "No graph values in this date range."}
            </Typography>
          </div>
          <Alert color="neutral" startIcon="Info">
            No graph values in this date range.
          </Alert>
        </div>
      )}
      errorFallback={props.errorFallback}
      pendingFallback={props.pendingFallback}
      viewHref={props.viewHref}
      displaySize={props.displaySize}
    />
  );
}

/**
 * Two manual stats on one WISE graph (e.g. Cash/Bills). The first stat draws
 * solid against the left axis; the second draws dashed against its own
 * right-hand axis. Both stats must use the same value format.
 */
export function ManualStatsDualLineChart(props: {
  block: ManualStatsBlock;
  stat: string;
  stat2: string;
  title: Node;
  startDate?: Sql;
  endDate?: Sql;
  ownerHeader?: Node;
  ownerLabel?: Node;
  emptyFallback?: Node;
  errorFallback?: Node;
  pendingFallback?: Node;
}) {
  const stat = props.block.stat(props.stat);
  const stat2 = props.block.stat(props.stat2);
  if ((stat.valueFormat ?? "number") !== (stat2.valueFormat ?? "number")) {
    throw new Error(
      `Dual stat chart "${props.stat}"/"${props.stat2}" requires matching value formats.`,
    );
  }
  const range = { startDate: props.startDate, endDate: props.endDate };
  return (
    <WiseStatLineChart
      title={props.title}
      valueFormat={chartValueFormat(stat)}
      unit={stat.unit}
      ownerHeader={props.ownerHeader ??
        (stat.ownerHeader === undefined
          ? undefined
          : sql.lit(stat.ownerHeader))}
      ownerLabel={props.ownerLabel ??
        (stat.ownerLabel === undefined ? undefined : sql.lit(stat.ownerLabel))}
      reverseAxis={stat.targetDirection === "lower_is_better"}
      graphLow={stat.graphLow === undefined
        ? undefined
        : sql.normalizeExpr(stat.graphLow)}
      graphDivision={stat.graphDivision === undefined
        ? undefined
        : sql.normalizeExpr(stat.graphDivision)}
      query={props.block.statQuery(props.stat, range)}
      seriesLabel={stat.displayName}
      series2={{
        query: props.block.statQuery(props.stat2, range),
        label: stat2.displayName,
        graphLow: stat2.graphLow === undefined
          ? undefined
          : sql.normalizeExpr(stat2.graphLow),
        graphDivision: stat2.graphDivision === undefined
          ? undefined
          : sql.normalizeExpr(stat2.graphDivision),
        reverseAxis: stat2.targetDirection === "lower_is_better",
      }}
      emptyFallback={props.emptyFallback ?? (
        <div sx={styles.emptyChartFrame}>
          <div>
            <Typography level="title-sm" color="primary">
              {props.title}
            </Typography>
            <Typography level="body-xs" color="neutral">
              No graph values in this date range.
            </Typography>
          </div>
          <Alert color="neutral" startIcon="Info">
            No graph values in this date range.
          </Alert>
        </div>
      )}
      errorFallback={props.errorFallback}
      pendingFallback={props.pendingFallback}
    />
  );
}

export function ManualStatsDashboardPage(props: {
  block: ManualStatsBlock;
  path?: string;
  title?: string;
  subtitle?: string;
}) {
  return (
    <Route path={props.path ?? "/manual-stats"}>
      <ManualStatsDashboardPageInner
        block={props.block}
        title={props.title}
        subtitle={props.subtitle}
      />
    </Route>
  );
}

function ManualStatsDashboardPageInner(props: {
  block: ManualStatsBlock;
  title?: string;
  subtitle?: string;
}) {
  const tableRef = props.block.entriesTableRef();
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("start_date", props.block.defaultStartDate);
        s.defScalar("end_date", props.block.defaultEndDate);
      }}
    >
      <div sx={styles.page}>
        <PageHeader
          title={props.title ?? "Manual Stats"}
          subtitle={props.subtitle ??
            "Review manually entered stat trends and recent submissions."}
          actions={
            <DateRangeFilter
              size="sm"
              startDate={sql`start_date`}
              endDate={sql`end_date`}
              onStartDateChange={(s, value) => {
                s.setScalar("start_date", value);
                s.refetch();
              }}
              onEndDateChange={(s, value) => {
                s.setScalar("end_date", value);
                s.refetch();
              }}
            />
          }
        />

        <Data
          procedure={(s) => {
            s.defTable(
              "manual_stat_definitions",
              props.block.statDefinitionsQuery(),
            );
            s.defTable(
              "manual_stat_recent_entries",
              sql`
                with stat_defs as (${props.block.statDefinitionsQuery()})
                select
                  e.period_start_date,
                  sd.display_name,
                  ${
                formatManualStatValue(sql`e.value`, sql`sd.value_format`)
              } as formatted_value
                from ${tableRef} e
                join stat_defs sd on sd.stat_type = e.stat_type
                where e.period_start_date between start_date and end_date
                  and e.value is not null
                order by e.period_start_date desc, sd.sort_order, e.id desc
                limit 25
              `,
            );
          }}
          pendingFallback={
            <div className="flex justify-center py-8">
              <CircularProgress size="lg" />
            </div>
          }
          errorFallback={
            <Alert color="danger" startIcon="Report">
              Unable to load manual stats
            </Alert>
          }
        >
          <StatRow
            header="Snapshot"
            stats={[
              {
                title: "Manual Stats",
                value: sql`(select count(*) from manual_stat_definitions)`,
              },
              {
                title: "Entries In Range",
                value: sql`
                  (
                    select count(*)
                    from ${tableRef}
                    where period_start_date between start_date and end_date
                      and value is not null
                  )
                `,
              },
              {
                title: "Latest Period",
                value: sql`
                  coalesce((
                    select max(period_start_date)
                    from ${tableRef}
                    where period_start_date between start_date and end_date
                      and value is not null
                  ), end_date)
                `,
                formatValue: (value) => sql`format.date(${value}, '%b %d, %Y')`,
              },
            ]}
          />

          <Card variant="outlined" sx={styles.chartCard}>
            <div sx={styles.graphGrid}>
              {props.block.stats.map((stat) => (
                <ManualStatsLineChart
                  block={props.block}
                  stat={stat.name}
                  startDate={sql`start_date`}
                  endDate={sql`end_date`}
                />
              ))}
            </div>
          </Card>

          <Card variant="outlined" sx={{ p: 0 }}>
            <Typography level="title-md" sx={{ p: 3 }}>
              Recent Entries
            </Typography>
            <Show
              when={sql`not exists (select 1 from manual_stat_recent_entries)`}
            >
              <Alert color="neutral" startIcon="Info" sx={{ m: 3 }}>
                No manual stat entries in this range.
              </Alert>
            </Show>
            <Show when={sql`exists (select 1 from manual_stat_recent_entries)`}>
              <div sx={styles.recentHeader}>
                <Typography level="body-sm">Period</Typography>
                <Typography level="body-sm">Stat</Typography>
                <Typography level="body-sm">Value</Typography>
              </div>
              <div sx={styles.recentList}>
                <Each table="manual_stat_recent_entries" recordName="entry">
                  <div sx={styles.recentEntry}>
                    <div sx={styles.recentCell}>
                      <Typography sx={styles.recentCellLabel}>
                        Period
                      </Typography>
                      <Typography level="body-sm" sx={styles.recentCellValue}>
                        {sql`format.date(entry.period_start_date, '%b %d, %Y')`}
                      </Typography>
                    </div>
                    <div sx={styles.recentCell}>
                      <Typography sx={styles.recentCellLabel}>Stat</Typography>
                      <Typography level="body-sm" sx={styles.recentCellValue}>
                        {sql`entry.display_name`}
                      </Typography>
                    </div>
                    <div sx={styles.recentCell}>
                      <Typography sx={styles.recentCellLabel}>Value</Typography>
                      <Typography level="body-sm" sx={styles.recentCellValue}>
                        {sql`entry.formatted_value`}
                      </Typography>
                    </div>
                  </div>
                </Each>
              </div>
            </Show>
          </Card>
        </Data>
      </div>
    </Data>
  );
}

export function ManualStatsEntryPage(props: {
  block: ManualStatsBlock;
  path?: string;
  title?: string;
  subtitle?: string;
  wrapper?: (children: Node) => Node;
  periodSelection?: "date" | "week";
  groupByOwnerHeader?: boolean;
  successSnackbar?: boolean;
}) {
  const content = (
    <ManualStatsEntryPageInner
      block={props.block}
      title={props.title}
      subtitle={props.subtitle}
      periodSelection={props.periodSelection}
      groupByOwnerHeader={props.groupByOwnerHeader}
      successSnackbar={props.successSnackbar}
    />
  );
  return (
    <Route path={props.path ?? "/manual-stats/entries"}>
      {props.wrapper ? props.wrapper(content) : content}
    </Route>
  );
}

function ManualStatsEntryPageInner(props: {
  block: ManualStatsBlock;
  title?: string;
  subtitle?: string;
  periodSelection?: "date" | "week";
  groupByOwnerHeader?: boolean;
  successSnackbar?: boolean;
}) {
  const tableRef = props.block.entriesTableRef();
  const enteredByField = props.block.trackEnteredBy
    ? [{ field: "entered_by", initialValue: sql`current_user` }]
    : [];
  const entryStatQuery = props.groupByOwnerHeader
    ? sql`
      with stat_defs as (${props.block.statDefinitionsQuery()})
      select
        stat_defs.*,
        not exists (
          select 1
          from stat_defs previous_stat
          where previous_stat.sort_order < stat_defs.sort_order
            and coalesce(previous_stat.owner_header, '') =
              coalesce(stat_defs.owner_header, '')
        ) as starts_owner_group
      from stat_defs
      where stat_defs.stat_type = entry.stat_type
    `
    : sql`
      select *
      from (${props.block.statDefinitionsQuery()}) stat_defs
      where stat_type = entry.stat_type
    `;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("entry_date", props.block.defaultEntryDate);
        if (props.periodSelection === "week") {
          s.defScalar("entry_week_label", sql.lit`This Week`);
        }
        if (props.successSnackbar) {
          s.defScalar("save_succeeded", false);
        }
      }}
    >
      <div sx={[styles.page, styles.entryPage]}>
        <div sx={styles.headerText}>
          <Typography level="h3">
            {props.title ?? "Enter Manual Stats"}
          </Typography>
          {props.subtitle && (
            <Typography level="body-sm" color="neutral">
              {props.subtitle}
            </Typography>
          )}
        </div>

        <Form
          watch={sql`entry_date`}
          beforeUnloadCheck
          submitOnDocumentEnterPlusCtrlOrCmd
          beforeSubmitClient={(s) => {
            if (props.successSnackbar) {
              s.setScalar("save_succeeded", false);
            }
          }}
          afterSubmitClientSuccess={(s) => {
            if (props.successSnackbar) {
              s.setScalar("save_succeeded", true);
            } else {
              s.refetch();
            }
          }}
        >
          <Form.MergeMany
            table={props.block.tableName}
            fields={[
              "stat_type",
              "period_start_date",
              "value",
              ...enteredByField,
            ]}
            where={sql`
              period_start_date = entry_date
                and stat_type in (
                  select stat_type
                  from (${props.block.statDefinitionsQuery()}) stat_defs
                )
            `}
            initializeSource={sql`
              with stat_defs as (${props.block.statDefinitionsQuery()})
              select
                e.id,
                sd.stat_type,
                entry_date as period_start_date,
                e.value
                ${
              props.block.trackEnteredBy
                ? sql`, coalesce(e.entered_by, current_user) as entered_by`
                : sql``
            }
              from stat_defs sd
              left join ${tableRef} e
                on e.stat_type = sd.stat_type
                and e.period_start_date = entry_date
              order by sd.sort_order
            `}
            filterBeforeSubmit={sql`value is not null`}
          >
            <div sx={styles.entryToolbar}>
              {props.periodSelection === "week"
                ? (
                  <div sx={styles.weekSelector}>
                    <div sx={styles.weekControls}>
                      <IconButton
                        aria-label="Previous week"
                        tooltip="Previous week"
                        size="sm"
                        variant="outlined"
                        color="neutral"
                        icon="ChevronLeft"
                        onClick={(s) => {
                          s.setScalar(
                            "entry_date",
                            sql`date.add(day, -7, entry_date)`,
                          );
                          s.setScalar(
                            "entry_week_label",
                            sql.lit`Previous Week`,
                          );
                          s.setScalar("save_succeeded", false);
                        }}
                      />
                      <div
                        sx={styles.selectedWeek}
                        data-testid="manual-stats-selected-week"
                      >
                        <div sx={styles.weekBadge}>
                          <MaterialIcon icon="CalendarToday" fontSize="sm" />
                          <Typography level="body-xs">
                            {sql`entry_week_label`}
                          </Typography>
                        </div>
                        <Typography level="body-sm">
                          {sql`
                            'Ending Sunday, ' || format.date(entry_date, '%b %-d')
                          `}
                        </Typography>
                      </div>
                      <IconButton
                        aria-label="Next week"
                        tooltip="Next week"
                        size="sm"
                        variant="outlined"
                        color="neutral"
                        icon="ChevronRight"
                        disabled={sql`entry_date >= ${props.block.defaultEntryDate}`}
                        onClick={(s) =>
                          s.if(
                            sql`entry_date < ${props.block.defaultEntryDate}`,
                            (s) => {
                              s.setScalar(
                                "entry_week_label",
                                sql`
                                  case
                                    when date.add(day, 7, entry_date) =
                                      ${props.block.defaultEntryDate}
                                      then 'This Week'
                                    else 'Previous Week'
                                  end
                                `,
                              );
                              s.setScalar(
                                "entry_date",
                                sql`date.add(day, 7, entry_date)`,
                              );
                              s.setScalar("save_succeeded", false);
                            },
                          )}
                      />
                    </div>
                  </div>
                )
                : (
                  <FormControl size="sm">
                    <FormLabel>Period</FormLabel>
                    <Input
                      size="sm"
                      type="date"
                      value={sql`entry_date`}
                      onChange={(s) =>
                        s.if(
                          sql`
                            try_cast(target_value as date) between date '2000-01-01'
                              and date.add(year, 1, current_date())
                          `,
                          (s) =>
                            s.setScalar(
                              "entry_date",
                              sql`try_cast(target_value as date)`,
                            ),
                        )}
                    />
                  </FormControl>
                )}
              <Form.SubmitButton size="sm" startIcon="Save">
                Save
              </Form.SubmitButton>
            </div>

            <Form.ErrorAlert mode="all" />

            <Card variant="outlined" sx={styles.entryTable}>
              <div sx={styles.entryList}>
                <Form.Each recordName="entry">
                  <Data
                    procedure={(s) => {
                      s.defRecord(
                        "entry_stat",
                        entryStatQuery,
                      );
                    }}
                    pendingFallback={null}
                    errorFallback={null}
                  >
                    {props.groupByOwnerHeader && (
                      <Show
                        when={sql`
                          entry_stat.starts_owner_group
                            and entry_stat.owner_header is not null
                        `}
                      >
                        <div sx={styles.divisionHeader}>
                          <Typography level="title-sm" color="primary">
                            {sql`entry_stat.owner_header`}
                          </Typography>
                        </div>
                      </Show>
                    )}
                    <div sx={styles.entryRow}>
                      <div>
                        <Typography level="title-sm">
                          {sql`entry_stat.display_name`}
                        </Typography>
                      </div>
                      <Form.Field field="value">
                        {(field) => (
                          <FormControl
                            size="sm"
                            error={field.hasError}
                          >
                            <Input
                              aria-label={sql`
                                'Value for ' || entry_stat.display_name
                              `}
                              size="sm"
                              type="number"
                              inputMode="decimal"
                              fullWidth
                              placeholder="0"
                              error={field.hasError}
                              value={sql`
                                case
                                  when ${field.value} is null then ''
                                  when entry_stat.value_format = 'percentage'
                                    then (try_cast(${field.value} as double) * 100.0)::string
                                  else try_cast(${field.value} as double)::string
                                end
                              `}
                              startDecorator={
                                <Show
                                  when={sql`entry_stat.value_format = 'currency'`}
                                >
                                  <span>$</span>
                                </Show>
                              }
                              endDecorator={
                                <Show
                                  when={sql`entry_stat.value_format = 'percentage'`}
                                >
                                  <span>%</span>
                                </Show>
                              }
                              onInput={(s) =>
                                field.setValue(
                                  s,
                                  sql`
                                    case
                                      when target_value = '' then null
                                      when entry_stat.value_format = 'percentage'
                                        then (try_cast(target_value as decimal(18,4)) / 100.0)::string
                                      else target_value
                                    end
                                  `,
                                )}
                              onBlur={(s) => field.setTouched(s, true)}
                            />
                            <Show when={field.hasError}>
                              <Typography level="body-xs" color="danger">
                                {field.error}
                              </Typography>
                            </Show>
                          </FormControl>
                        )}
                      </Form.Field>
                    </div>
                  </Data>
                </Form.Each>
              </div>
            </Card>
          </Form.MergeMany>
        </Form>
        {props.successSnackbar && (
          <Show when={sql`save_succeeded`}>
            <Snackbar
              startIcon="CheckCircle"
              color="success"
              variant="soft"
              anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
              onMount={(s) => {
                s.sleep(4000);
                s.setScalar("save_succeeded", false);
              }}
            >
              {sql`
                'Stats saved for week ending ' ||
                  format.date(entry_date, '%B %-d')
              `}
            </Snackbar>
          </Show>
        )}
      </div>
    </Data>
  );
}
