import { Alert } from "components/alert";
import {
  type CurrentRecordICtx,
  CurrentRecordICtxKey,
  type CurrentRefetchICtx,
  CurrentRefetchICtxKey,
  type CurrentTableICtx,
  CurrentTableICtxKey,
  type CurrentWatchKeyICtx,
  CurrentWatchKeyICtxKey,
  type PageRecordICtx,
  PageRecordICtxKey,
  type PageRefetchICtx,
  PageRefetchICtxKey,
  type PageRefetchWatchKeyICtx,
  PageRefetchWatchKeyICtxKey,
  type PageTableICtx,
  PageTableICtxKey,
} from "std/ictx";
import { Data } from "std/data";
import { TableLinksSharedContext } from "std/shared_contexts";
import { sql } from "std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "std/sql_utils";
import type { IStatementsBase, StateStatementsOrFn } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import type { Table } from "std/system";
import type { ContextInstance, ICtxKey, Node, QueryParam } from "std/ui";
import {
  addCtx,
  DocumentTitle,
  Route,
  Show,
  useQueryParams,
  useSharedContext,
} from "std/ui";
import { getTableBaseUrl } from "std/utils/url";

const styles = createStyles({
  notContentWrapper: {
    display: "flex",
    justifyContent: "center",
    mt: 16,
  },
});

/**
 * Context published by {@link RecordPage} so that descendants (and the
 * record query itself) can read the current table, record id, and trigger
 * a refetch. Both the "current" and "page" context roles resolve to the
 * same single record this page renders.
 *
 * @category Helper
 */
export class Context
  implements
    ContextInstance,
    CurrentTableICtx,
    CurrentRecordICtx,
    PageTableICtx,
    PageRecordICtx,
    PageRefetchICtx,
    PageRefetchWatchKeyICtx,
    CurrentWatchKeyICtx,
    PageRefetchICtx,
    CurrentRefetchICtx {
  currentTable: Table;
  currentRecordId: NumericExpr;
  pageTable: Table;
  pageRecordId: NumericExpr;
  triggerPageRefetch: <T extends IStatementsBase>(s: T) => unknown;
  triggerRefetch: <T extends IStatementsBase>(s: T) => unknown;
  currentWatchKey: AnyExpr[];
  implementICtxs: ICtxKey<any>[] = [
    CurrentTableICtxKey,
    CurrentRecordICtxKey,
    PageTableICtxKey,
    PageRecordICtxKey,
    PageRefetchICtxKey,
    PageRefetchWatchKeyICtxKey,
    CurrentWatchKeyICtxKey,
    CurrentRefetchICtxKey,
  ];
  pageRefetchKey: AnyExpr[];

  constructor(
    table: Table,
    recordId: NumericExpr,
  ) {
    this.currentTable = table;
    this.currentRecordId = recordId;
    this.pageTable = table;
    this.pageRecordId = recordId;
    this.triggerPageRefetch = <T extends IStatementsBase>(s: T) => {
      s.increment("global_refetch_key");
    };
    this.triggerRefetch = <T extends IStatementsBase>(s: T) => {
      s.increment("global_refetch_key");
    };
    this.currentWatchKey = [];
    this.pageRefetchKey = [];
  }
}

/** Props for route-less record content rendered inside an existing record route. */
export interface RecordPageContentProps {
  table: string;
  /** Document title. Defaults to the record display name when configured. */
  title?: string | Sql;
  routeState?: StateStatementsOrFn;
  children: Node;
  sx?: Style;
  queryParams?: QueryParam[];
  /**
   * Node shown while data is loading. Defaults to Data's built-in `CircularProgress` spinner.
   * Pass `null` to disable the pending fallback entirely.
   */
  pendingFallback?: Node | null;
  /**
   * Node shown when the data fetch fails. Defaults to Data's built-in `Alert` component.
   * Pass `null` to disable the error fallback entirely.
   */
  errorFallback?: Node | null;
  /**
   * Name of the scalar that exposes the fetch status of the Data component.
   * Accessible in children as a `sys_state_status` enum value.
   */
  statusScalar?: string;
  /** Additional SQL condition applied while fetching the record. */
  recordWhere?: ReturnType<typeof sql>;
}

/** Props for {@link RecordPage}. */
export interface RecordPageProps extends RecordPageContentProps {
  path?: string;
  /** Wraps the route content. Useful for adding layout wrappers like sidebars. */
  wrapper?: (children: Node) => Node;
}

/**
 * Supplies the same record data and contexts as {@link RecordPage} without
 * registering a route. The surrounding route must expose `ui.record_id`.
 *
 * @category Page Component
 */
export function RecordPageContent(props: RecordPageContentProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  addCtx(
    new Context(
      table,
      sql`ui.record_id`,
    ),
  );
  if (props.queryParams) {
    useQueryParams(props.queryParams);
  }
  const recordWhere = props.recordWhere
    ? sql`${table.primaryKeyIdent} = ui.record_id and (${props.recordWhere})`
    : sql`${table.primaryKeyIdent} = ui.record_id`;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "record",
          table.recordDisplayName && !table.fields.display_name
            ? sql`select *, ${table.getRecordDisplayNameExpr()} as display_name from ${table.identWithDb} where ${recordWhere}`
            : sql`select * from ${table.identWithDb} where ${recordWhere}`,
        );
        s.defScalar(
          "record_exists",
          sql`record.${table.primaryKeyIdent} is not null`,
        );
        if (props.routeState) {
          s.statements(props.routeState);
        }
      }}
      statusScalar={props.statusScalar}
      pendingFallback={props.pendingFallback}
      errorFallback={props.errorFallback}
    >
      <Show when={sql`not record_exists`}>
        <div sx={styles.notContentWrapper}>
          <Alert color="danger" startIcon="Report">
            Unable to get {table.displayName}
          </Alert>
        </div>
      </Show>
      <Show when={sql`record_exists`}>
        {table.recordDisplayName && (
          <DocumentTitle>
            {props.title ?? sql`record.display_name`}
          </DocumentTitle>
        )}
        {!table.recordDisplayName && props.title && (
          <DocumentTitle>{props.title}</DocumentTitle>
        )}
        {props.sx ? <div sx={props.sx}>{props.children}</div> : props.children}
      </Show>
    </Data>
  );
}

/**
Component that displays detailed information about a single record of a table using a Data component for fetching.

A RecordPage cannot be empty, it must have children.
It includes a Data component that fetches the record and makes it available to the children.
The record fields are accessible as `sql\`record.field_name\`` (e.g., `sql\`record.name\``).

The path is automatically generated from the table name and record id and generally does not need to be specified.
It exposes a scalar "record_id" that can be used in expressions to refer to the current record.

Use the scalar "record_id" to refer to the current record in expressions via `sql\`ui.record_id\``.

**Self-routing: do NOT wrap in a Route component.**

@category Page Component
*/
export function RecordPage(props: RecordPageProps) {
  const path = props.path ?? `/${getTableBaseUrl(props.table)}/{record_id:id}`;
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const tableLinks = useSharedContext(TableLinksSharedContext);
  const [pathBeforeId, pathAfterId] = path.split("{record_id:id}");
  tableLinks.add(
    table,
    (id) =>
      pathAfterId === undefined
        ? sql.concat("/", getTableBaseUrl(props.table), "/", id)
        : sql.concat(pathBeforeId, id, pathAfterId),
  );
  const inner = <RecordPageContent {...props} />;
  const content = props.wrapper ? props.wrapper(inner) : inner;
  return (
    <Route path={path}>
      {content}
    </Route>
  );
}
