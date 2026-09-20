import { Button } from "components/button";
import { Card } from "components/card";
import { Input } from "components/input";
import { Skeleton } from "components/skeleton";
import { Typography } from "components/typography";
import type {
  CurrentRefetchICtx,
  CurrentWatchKeyICtx,
  PageRefetchICtx,
  PageRefetchWatchKeyICtx,
  PageTableICtx,
} from "std/ictx";
import {
  CurrentRefetchICtxKey,
  PageRefetchICtxKey,
  PageRefetchWatchKeyICtxKey,
  PageTableICtxKey,
} from "std/ictx";
import { CurrentWatchKeyICtxKey } from "std/ictx";
import { singularize } from "std/inflectors";
import { buildSearchExpression } from "std/search_utils";
import { sql } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../std/sql_utils";
import type { IStatementsBase, StateStatements } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import type { Table } from "std/system";
import { Data } from "std/data";
import { addCtx, Each, QueryParams, Route, Show } from "std/ui";
import type { ContextInstance, ICtxKey, Node } from "std/ui";
import { getTableBaseUrl } from "std/utils/url";

/**
 * Layout styles for {@link SearchCard}: the centered content wrapper and the
 * two result containers (`eventTypeGrid` for grid display, `eventTypeTable`
 * for list display).
 */
export const styles = createStyles({
  contentWrapper: {
    maxWidth: "1200px",
    minWidth: "80%",

    padding: "2rem",
    mx: "auto",
  },

  eventTypeGrid: {
    display: "grid",
    mb: 4,
    width: "100%",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "1rem",
  },
  eventTypeTable: {
    display: "flex",
    mb: 4,
    width: "100%",
    flexDirection: "column",
    gap: "1rem",
  },
});

function SkeletonCard() {
  return (
    <Card variant="outlined">
      <div className="p-6">
        {/*Example_Skeleton_Start*/}
        <Skeleton level="h3" />
        {/*Example_Skeleton_End*/}
        <div className="flex items-center gap-4 mt-4">
          <Skeleton level="h3" variant="text" />
        </div>
        <div className="flex items-center gap-4 mt-4">
          <Skeleton level="h3" variant="text" />
        </div>
      </div>
      <div
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          p: 2,
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        <Skeleton level="h1" variant="text" />
      </div>
    </Card>
  );
}

function MultipleSkeletonCards() {
  return (
    <div
      sx={{
        opacity: 0.5,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "1rem",
      }}
    >
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
interface SearchCardProps {
  table: string;
  header?: Node;
  card: Node;
  searchPlaceholder?: string;
  recordName?: string;
  display?: "grid" | "list";
  search?: boolean;
  placeholder?: string;
  where?: BooleanExpr;
  stateStatements?: (s: StateStatements) => void;
  watch?: AnyExpr[];
  gridSx?: Style;
  orderBy?: Sql;
  pageSize?: number;
}

interface SearchCardPageProps extends SearchCardProps {
  path?: string;
}

class Context
  implements
    ContextInstance,
    PageTableICtx,
    PageRefetchICtx,
    PageRefetchWatchKeyICtx,
    CurrentWatchKeyICtx,
    CurrentRefetchICtx {
  pageTable: Table;
  triggerPageRefetch: <T extends IStatementsBase>(s: T) => unknown;
  triggerRefetch: <T extends IStatementsBase>(s: T) => unknown;
  currentWatchKey: AnyExpr[];
  implementICtxs: ICtxKey<any>[] = [
    PageTableICtxKey,
    PageRefetchICtxKey,
    PageRefetchWatchKeyICtxKey,
    CurrentWatchKeyICtxKey,
    CurrentRefetchICtxKey,
  ];
  pageRefetchKey: AnyExpr[];

  constructor(
    table: Table,
    pageRefreshKey: string,
    pageRefreshWatchKey: AnyExpr[],
  ) {
    this.pageTable = table;
    this.triggerPageRefetch = <T extends IStatementsBase>(s: T) => {
      s.increment(pageRefreshKey);
    };
    this.triggerRefetch = <T extends IStatementsBase>(s: T) => {
      s.increment(pageRefreshKey);
    };
    this.currentWatchKey = pageRefreshWatchKey;
    this.pageRefetchKey = pageRefreshWatchKey;
  }
}

/**
 * Inner content of {@link SearchCardPage}: an optional fuzzy-search input plus a
 * grid or list of record cards, with optional query-based paging. Renders its
 * own local `Data` scopes and provides the page-table refetch context, but does
 * NOT create a route — use it when embedding the search-card UI inside an
 * existing route; otherwise prefer {@link SearchCardPage}.
 *
 * @category UI Component
 */
export function SearchCard(props: SearchCardProps) {
  const {
    table,
    header,
    card,
    recordName,
    display,
    search,
    searchPlaceholder,
    placeholder,
    where,
    watch,
    gridSx,
    orderBy,
    pageSize,
  } = props;
  const tableModel = system.db.tables[table];
  if (!tableModel) {
    throw new Error(`Table ${table} not found`);
  }
  addCtx(new Context(tableModel, "refresh_key", [sql`refresh_key`]));
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", 0);
        s.defScalar("page", 1);
        props.stateStatements?.(s);
      }}
    >
      <div sx={styles.contentWrapper}>
        {header}
        <Show when={search ?? true}>
          <div className="w-full mb-4">
            <Input
              placeholder={placeholder ?? searchPlaceholder ?? sql.lit`Search`}
              bindScalar="search_query"
              startIcon="Search"
              className="md:w-[30%] my-auto"
            />
          </div>
        </Show>
        <Data
          watch={[
            sql`refresh_key`,
            sql`search_query`,
            sql`page`,
            ...(watch ?? []),
          ]}
          pendingFallback={<MultipleSkeletonCards />}
          procedure={(s) => {
            const whereExpr = where ?? true;
            if (search ?? true) {
              const searchConfig = tableModel.getSearchConfig();
              if (!searchConfig) {
                throw new Error(
                  `Table ${table} does not have searchConfig`,
                );
              }
              const searchExpr = buildSearchExpression(searchConfig, table);
              s.defTable(table, {
                inferQuery: sql`select * from ${tableModel.identWithDb}`,
              });
              s.defScalar("total_count", sql`0`);
              s.conditional({
                condition: sql`trim(search_query) != ''`,
                then: (s) => {
                  const conditions: BooleanExpr[] = [];
                  if (searchConfig.filterExpr) {
                    conditions.push(searchConfig.filterExpr);
                  }
                  if (where) conditions.push(where);
                  conditions.push(
                    sql`fuzzy_match(search_query, ${searchExpr})`,
                  );
                  const searchWhere = sql.and(...conditions);
                  const searchOrderBy = orderBy
                    ? sql` order by ${orderBy}`
                    : sql` order by fuzzy_rank_key(search_query, ${searchExpr}), ${tableModel.primaryKeyIdentWithTable}`;
                  s.modify(
                    sql`insert into ${sql.ref(table)}
                      select * from ${tableModel.identWithDb}
                      where ${searchWhere}
                      ${searchOrderBy}
                      limit ${pageSize ?? 100000} offset ${
                      pageSize ? sql`(page - 1) * ${pageSize}` : 0
                    }`,
                  );
                  const searchExprForCount = buildSearchExpression(
                    searchConfig,
                    table,
                  );
                  const countConditions: BooleanExpr[] = [];
                  if (searchConfig.filterExpr) {
                    countConditions.push(searchConfig.filterExpr);
                  }
                  if (where) countConditions.push(where);
                  countConditions.push(
                    sql`fuzzy_match(search_query, ${searchExprForCount})`,
                  );
                  const countWhere = sql.and(...countConditions);
                  s.setScalar(
                    "total_count",
                    sql`(select count(*) from ${tableModel.identWithDb} where ${countWhere})`,
                  );
                },
                else: (s) => {
                  s.modify(
                    sql`insert into ${sql.ref(table)}
                      select * from ${tableModel.identWithDb}
                      where ${whereExpr}
                      ${orderBy ? sql`order by ${orderBy}` : sql``}
                      ${
                      pageSize
                        ? sql`limit ${pageSize} offset (page - 1) * ${pageSize}`
                        : sql``
                    }`,
                  );
                  s.setScalar(
                    "total_count",
                    sql`(select count(*) from ${tableModel.identWithDb} where ${whereExpr})`,
                  );
                },
              });
            } else {
              s.defTable(
                table,
                sql`select * from ${tableModel.identWithDb}
                  where ${whereExpr}
                  ${orderBy ? sql`order by ${orderBy}` : sql``}
                  ${
                  pageSize
                    ? sql`limit ${pageSize} offset (page - 1) * ${pageSize}`
                    : sql``
                }`,
              );
              s.defScalar(
                "total_count",
                sql`(select count(*) from ${tableModel.identWithDb} where ${whereExpr})`,
              );
            }
          }}
        >
          <Show
            when={sql`not exists (select 1 from ${sql.ref(table)})`}
          >
            <Typography
              level="title-lg"
              className="text-center text-neutral-500 mt-10"
            >
              No results currently found
            </Typography>
          </Show>
          <div
            sx={[
              display === "grid" ? styles.eventTypeGrid : styles.eventTypeTable,
              gridSx,
            ]}
          >
            <Each
              table={table}
              recordName={recordName ?? `${singularize(table)}_record`}
            >
              {card}
            </Each>
          </div>
          <Show when={pageSize !== undefined}>
            <div className="pt-2 gap-1 hidden md:flex">
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                startIcon="KeyboardArrowLeft"
                disabled={sql`page <= 1`}
                onClick={(s) => s.decrement("page")}
              >
                Previous
              </Button>
              <div className="flex-1" />
              <Typography level="body-sm">
                {sql`'Page ' || page || ' of ' || (case when total_count = 0 then 1 else ((total_count - 1) / ${
                  pageSize ?? 25
                } + 1) end) || ' (' || total_count || ' records)'`}
              </Typography>
              <div className="flex-1" />

              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                startIcon="KeyboardArrowRight"
                onClick={(s) => s.increment("page")}
                disabled={sql`page >= ceil(cast(total_count as real) / ${
                  pageSize ?? 25
                })`}
              >
                Next
              </Button>
            </div>
          </Show>
        </Data>
      </div>
    </Data>
  );
}

/**
A page component that displays a grid or list of cards with search functionality.

Use this when a table it is useful to show individual records as cards, such as when there are many
fields (physical or virtual) to display.

**Self-routing: do NOT wrap in a Route component.** Defaults the route path to the
table's base URL when `path` is omitted.

@param {boolean} [search] - Whether to show the search input field. Defaults to true.
@param {string} table - The database table to search and display records from
@param {Node} header - Header content to display above the search
@param {Node} card - Card template to render for each record
@param {'grid'|'list'} [display='grid'] - Whether to display results in a grid or list layout
@param {string} [searchPlaceholder] - Placeholder text for the search input
@param {string} [recordName] - Name to use for each record in the Each loop
@param {BooleanExpr} [where] - Additional WHERE clause to filter results
@param {(s: StateStatements) => void} [stateStatements] - Additional state setup
@param {AnyExpr[]} [watch] - Additional expressions to watch for updates
@param {Style} [gridSx] - Additional styles for the grid container
@param {Sql} [orderBy] - ORDER BY clause for results; defaults to fuzzy-rank order when searching
@param {number} [pageSize] - Records per page. When set, enables Previous/Next paging; omit to show all matches
@param {string} [placeholder] - Placeholder text for the search input
@param {string} [path] - Custom route path (defaults to the table's base URL)

@category Page Component
 */
export function SearchCardPage(props: SearchCardPageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const path = props.path ?? getTableBaseUrl(table.name);
  return (
    <Route path={path}>
      <QueryParams params={[{ name: "search_query", type: "String" }]}>
        <SearchCard {...props} />
      </QueryParams>
    </Route>
  );
}
