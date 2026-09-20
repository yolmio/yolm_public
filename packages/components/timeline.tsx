import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { SimplifiedPaletteVars, Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import {
  addCtx,
  createICtxKey,
  Each,
  EventHandlers,
  Match,
  Show,
  Switch,
  useOptionalICtx,
} from "std/ui";
import type { Node } from "std/ui";
import { MaterialIcon } from "./material_icon";
import type { IconName } from "./material_icon_names";

/**
 * Configuration for a single source in the Timeline union query.
 */
export interface TimelineSource {
  /** A unique type name for this source (used as the discriminator value) */
  type: string;
  /**
   * SQL query selecting `id` and the order field (e.g. `date`) from this source.
   * Do NOT include a `type` column — it's added automatically from the `type` prop.
   */
  query: Sql;
  /** Content to render for events of this type. Typically wraps a nested Data + Timeline.Item. */
  children: Node;
}

export interface TimelineProps {
  sx?: Style;
  className?: string;
  /** Name of the timeline table in state (default: "timeline") */
  name?: string;
  /** Name of the record variable when iterating (default: "event") */
  recordName?: string;
  /** Name of the order/date field in each source query (default: "date") */
  orderField?: string;
  /** Order direction (default: "desc") */
  orderDirection?: "asc" | "desc";
  /** Number of rows per page for infinite scroll (default: 50) */
  rowCount?: number;
  /** The union sources: each contributes a query and its render content */
  sources: TimelineSource[];
}

const TimelineICtxKey = createICtxKey<
  { name: string; recordName: string; orderField: string }
>("Timeline");

/**
 * Timeline component that uses the Data component pattern for union timelines.
 *
 * Instead of Read.Union + Read.SourceMatch, this uses a top-level Data component
 * to fetch a union query of `id`, `type`, and an order field. Each source type
 * then uses its own nested Data to fetch details.
 *
 * The component provides:
 * - Automatic union query construction from source configs
 * - Switch/Match routing by type discriminator
 * - Infinite scroll support
 * - Consistent timeline styling via Timeline.Item
 *
 * Inside each source's children, the parent record is available as `{recordName}.id`
 * and `{recordName}.date` (or whatever orderField you specify).
 *
 * @example
 * ```tsx
 * <Timeline
 *   sources={[
 *     {
 *       type: "closed_matter",
 *       query: sql`select id, close_date as date from db.matters where contact_id = record_id and close_date is not null`,
 *       children: (
 *         <Data procedure={(s) => {
 *           s.defRecord("matter", sql`select name, type from db.matters where id = event.id`);
 *         }}>
 *           <Timeline.Item icon="Done" iconColor="success-500">
 *             <Typography level="body-lg">Closed matter: {sql`matter.name`}</Typography>
 *           </Timeline.Item>
 *         </Data>
 *       ),
 *     },
 *     {
 *       type: "payment",
 *       query: sql`select id, date from db.payments where contact_id = record_id`,
 *       children: (
 *         <Data procedure={(s) => {
 *           s.defRecord("payment", sql`select cost from db.payments where id = event.id`);
 *         }}>
 *           <Timeline.Item icon="Receipt" iconColor="success-300">
 *             <Typography level="body-lg">Payment: {sql`format.currency(payment.cost, 'USD')`}</Typography>
 *           </Timeline.Item>
 *         </Data>
 *       ),
 *     },
 *   ]}
 * />
 * ```
 */
export function Timeline(props: TimelineProps) {
  const name = props.name ?? "timeline";
  const recordName = props.recordName ?? "event";
  const orderField = props.orderField ?? "date";
  const orderDirection = props.orderDirection ?? "desc";
  const rowCount = props.rowCount ?? 50;
  const sources = props.sources;
  const ctx = {
    implementICtxs: [TimelineICtxKey],
    name,
    recordName,
    orderField,
  };
  addCtx(ctx);

  if (sources.length === 0) {
    throw new Error("Timeline requires at least one source");
  }

  // Build the union query from all sources
  const unionParts = sources.map(
    (source) =>
      sql`select id, ${sql.lit(source.type)} as type, ${
        sql.ref(orderField)
      } as ${sql.ref(orderField)} from (${source.query})`,
  );

  const unionQuery = unionParts.reduce((acc, part, i) =>
    i === 0 ? part : sql`${acc} union all ${part}`
  );

  const fullQuery = sql`${unionQuery} order by ${sql.ref(orderField)} ${
    sql(orderDirection)
  }`;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("row_count", rowCount);
      }}
    >
      <Data
        procedure={(s) => {
          s.defTable(name, sql`${fullQuery} limit row_count`);
        }}
      >
        <EventHandlers
          document={{
            scroll: (s) => {
              s.returnIf(
                sql`(select count(*) from ${sql.ref(name)}) < row_count`,
              );
              s.window.getScrollY("scroll_y");
              s.window.getInnerHeight("height");
              s.documentBodyElement.getScrollHeight("doc_scroll_height");
              s.if(sql`doc_scroll_height - scroll_y - height < 500`, (s) => {
                s.increment("row_count", rowCount);
              });
            },
          }}
        />
        <div
          sx={[{ display: "flex", flexDirection: "column" }, props.sx]}
          className={props.className}
        >
          <Each table={name} recordName={recordName}>
            <Switch>
              {sources.map((source) => (
                <Match
                  when={sql`${sql.ref(recordName)}.type = ${
                    sql.lit(source.type)
                  }`}
                >
                  {source.children}
                </Match>
              ))}
            </Switch>
          </Each>
        </div>
      </Data>
    </Data>
  );
}

const styles = createStyles({
  item: {
    display: "flex",
    minHeight: 80,
  },
  date: {
    display: "flex",
    flexDirection: "column",
    mx: 2,
    mt: 2,
    color: "text-secondary",
    alignItems: "center",
    fontSize: "sm",
    minWidth: 60,
  },
  iconWrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  line: {
    width: 2,
    backgroundColor: "neutral-100",
    flexGrow: 1,
    dark: {
      backgroundColor: "neutral-700",
    },
  },
  itemContent: {
    ml: 4,
    flexGrow: 1,
    display: "flex",
    alignItems: "start",
  },
  itemLeft: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
  },
  icon: {
    display: "flex",
    alignSelf: "baseline",
    color: "white",
    borderRadius: "50%",
    my: 2,
    p: 2,
    "--icon-font-size": "1.5rem",
  },
});

export interface TimelineItemProps {
  icon: Node | IconName;
  iconColor: SimplifiedPaletteVars;
  /** Optional date expression override. Defaults to `event.date`. */
  dateExpr?: Sql;
  /** Optional action node (e.g. dropdown menu) shown to the right of content. */
  action?: Node;
  children: Node;
}

/**
 * Renders an individual item in the Timeline.
 * Displays a date, icon with connecting line, content, and optional action.
 *
 * Inherits the parent Timeline's table, record, and date field names.
 * Override the displayed date with `dateExpr`.
 */
Timeline.Item = function TimelineItem(props: TimelineItemProps) {
  const ctx = useOptionalICtx(TimelineICtxKey);
  const recordName = ctx?.recordName ?? "event";
  const name = ctx?.name ?? "timeline";
  const dateExpr = props.dateExpr ??
    sql.ref(recordName, ctx?.orderField ?? "date");
  return (
    <div sx={styles.item}>
      <div sx={styles.date}>
        <span>{sql`format.date(${dateExpr}, '%-d %b')`}</span>
        <span>{sql`format.date(${dateExpr}, '%Y')`}</span>
      </div>
      <div sx={styles.iconWrapper}>
        <span sx={{ ...styles.icon, bgcolor: props.iconColor }}>
          {typeof props.icon === "string"
            ? <MaterialIcon icon={props.icon as IconName} />
            : props.icon}
        </span>
        <Show
          when={sql`${
            sql.ref(recordName)
          }.iteration_index != (select count(*) from ${sql.ref(name)}) - 1`}
        >
          <div sx={styles.line} />
        </Show>
      </div>
      <div sx={styles.itemContent}>
        <div sx={styles.itemLeft}>{props.children}</div>
        {props.action}
      </div>
    </div>
  );
};
