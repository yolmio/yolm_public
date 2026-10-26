import { DeleteRecordsDialog } from "components/delete_record_dialog";
import { IconButton } from "components/icon_button";
import { Snackbar } from "components/snackbar";
import { DataTable } from "components/data_table";
import type {
  ActionsBuilder,
  ColumnsBuilder,
  DataTableProps,
} from "components/data_table";
import { singularize } from "std/inflectors";
import {
  getHrefToRecord,
  isTableLinkable,
  PagesSharedContext,
} from "std/shared_contexts";
import { CurrentTableICtxKey, ExtendedCurrentTableContext } from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import { system } from "std/system";
import {
  addCtx,
  DocumentTitle,
  Route,
  Show,
  useOptionalICtx,
  useSharedContext,
} from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { getTableBaseUrl } from "std/utils/url";

/** Props for {@link DataTablePage}; see that component for per-field documentation. */
export interface DataTablePageProps {
  table: string;
  path?: string;
  /** Document title. Defaults to the table display name. */
  title?: string;
  columns?: (b: ColumnsBuilder) => void;
  ignoreFields?: string[];
  showIdColumn?: boolean;
  selectable?: boolean;
  deletable?: boolean;
  bulkActions?: (selectedTable: string) => Node;
  viewButton?: boolean;
  viewButtonUrl?: (id: NumericExpr) => Sql;
  actions?: (b: ActionsBuilder) => void;
  toolbar?: Node;
  searchable?: boolean | string[] | { placeholder?: string };
  /** Search delay in milliseconds; defaults to 250. Use `0` or `false` for immediate search. */
  searchDebounceMs?: DataTableProps["searchDebounceMs"];
  filterable?: boolean;
  sortable?: boolean;
  defaultSort?: { column: string; direction?: "asc" | "desc" };
  pageSize?: number;
  download?: string | { fileName: string; label?: string };
  editable?: boolean;
  where?: BooleanExpr;
  variant?: "default" | "outlined" | "plain";
  size?: "sm" | "md" | "lg";
  emptyState?: Node | string;
  className?: string;
  minColumnWidth?: number;
}

/**
 * A page component that wraps {@link DataTable} with routing, page registration,
 * and convenience features like bulk delete and view navigation.
 *
 * **Self-routing: do NOT wrap in a Route component.**
 *
 * @category Page Component
 *
 * @prop table - The database table name to display.
 * @prop [path] - URL path for this page. Defaults to a pluralized, hyphenated form of the table name.
 * @prop [columns] - Custom columns builder callback. If omitted, columns are auto-inferred from the table.
 * @prop [ignoreFields] - Fields to exclude when auto-generating columns.
 * @prop [showIdColumn] - Whether to show the id column. Default: false.
 * @prop [selectable] - Enable row selection checkboxes.
 * @prop [deletable] - Enable bulk delete with confirmation dialog. Implies selectable.
 * @prop [bulkActions] - Custom bulk actions rendered when rows are selected.
 * @prop [viewButton] - Add row click navigation to the record page (auto-detected from page registration).
 * @prop [viewButtonUrl] - Custom URL generator for row click navigation.
 * @prop [actions] - Row actions builder callback (edit, delete, custom).
 * @prop [toolbar] - Custom toolbar content rendered alongside search/download.
 * @prop [searchable] - Enable search bar.
 * @prop [searchDebounceMs] - Search delay in milliseconds (default 250); `0` or `false` disables the delay.
 * @prop [filterable] - Enable per-column filters.
 * @prop [sortable] - Enable column sorting.
 * @prop [defaultSort] - Default sort column and direction.
 * @prop [pageSize] - Rows per page (enables pagination).
 * @prop [download] - Enable CSV download.
 * @prop [editable] - Enable inline editing.
 * @prop [where] - Additional WHERE clause.
 * @prop [variant] - Visual variant.
 * @prop [size] - Table size.
 * @prop [emptyState] - Content shown when no rows.
 * @prop [className] - CSS class for the outer container.
 *
 * @examples
 *
 * Basic usage with toolbar:
 * ```tsx
 * <DataTablePage
 *   table="todos"
 *   deletable
 *   toolbar={<AutoInsertIconButton />}
 * />
 * ```
 */
export function DataTablePage(props: DataTablePageProps) {
  const path = props.path ?? `/${getTableBaseUrl(props.table)}`;
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const title = props.title ?? table.displayName;
  useSharedContext(PagesSharedContext).add(path, path, "DataTablePage");
  return (
    <Route path={path}>
      <DocumentTitle>{title}</DocumentTitle>
      <DataTablePageInner {...props} />
    </Route>
  );
}

DataTablePage.getSource = (props: DataTablePageProps) =>
  `DataTablePage table=${props.table}`;

function DataTablePageInner(props: DataTablePageProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }

  // Provide CurrentTableICtx so toolbar children (e.g. AutoInsertIconButton) can resolve the table
  const parentTableCtx = useOptionalICtx(CurrentTableICtxKey);
  addCtx(new ExtendedCurrentTableContext(parentTableCtx, table));

  const selectable = props.deletable || props.selectable || false;
  const query = sql`select * from ${table.identWithDb}`;

  // Resolve view button URL
  const hasViewButton = typeof props.viewButtonUrl === "function" ||
    props.viewButton ||
    isTableLinkable(table);
  const recName = singularize(table.name);
  let onRowClick:
    | ((s: import("std/statements").DomStatements) => void)
    | undefined;
  // Only use onRowClick when NOT selectable and NOT editable — otherwise clicking
  // a row navigates instead of toggling selection or starting inline editing.
  // When selectable or editable, we add a view action instead.
  if (hasViewButton && !selectable && !props.editable) {
    const urlFn = typeof props.viewButtonUrl === "function"
      ? props.viewButtonUrl
      : (recordId: NumericExpr) => getHrefToRecord(table, recordId);
    onRowClick = (s) => {
      s.navigate(urlFn(sql`${sql.ref(recName)}.${table.primaryKeyIdent}`));
    };
  }

  // Resolve columns
  let columnsFn = props.columns;
  if (!columnsFn && props.ignoreFields?.length) {
    const ignoreFields = props.ignoreFields;
    columnsFn = (b) => {
      for (const field of Object.values(table.fields)) {
        if (ignoreFields.includes(field.name)) {
          continue;
        }
        b.field(field.name);
      }
    };
  }

  // Resolve bulk actions (deletable creates a delete bulk action)
  let bulkActions = props.bulkActions;
  if (props.deletable && !bulkActions) {
    bulkActions = (selectedTable) => (
      <DeleteBulkAction
        tableName={props.table}
        selectedTable={selectedTable}
      />
    );
  }

  // When selectable or editable + viewButton, prepend a view button as the first column
  if (hasViewButton && (selectable || props.editable)) {
    const urlFn = typeof props.viewButtonUrl === "function"
      ? props.viewButtonUrl
      : (recordId: NumericExpr) => getHrefToRecord(table, recordId);
    const userColumnsFn = columnsFn;
    const showId = props.showIdColumn;
    columnsFn = (b) => {
      b.column(
        "",
        (colProps) => (
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            icon="OpenInNew"
            aria-label="View record"
            href={urlFn(sql`${colProps.record}.${table.primaryKeyIdent}`)}
          />
        ),
        { width: 40 },
      );
      if (userColumnsFn) {
        userColumnsFn(b);
      } else {
        // Replicate auto-column generation so DataTable doesn't see an empty columns list
        for (const field of Object.values(table.fields)) {
          if (!showId && field.name === "id") continue;
          b.field(field.name);
        }
      }
    };
  }

  const showDeleteSnackbar = props.deletable && !props.bulkActions;

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        if (showDeleteSnackbar) {
          s.defScalar("dt_page_delete_success", false);
        }
      }}
    >
      <DataTable
        query={query}
        primaryTable={props.table}
        columns={columnsFn}
        showIdColumn={props.showIdColumn}
        selectable={selectable}
        bulkActions={bulkActions}
        onRowClick={onRowClick}
        actions={props.actions}
        toolbar={props.toolbar}
        searchable={props.searchable}
        searchDebounceMs={props.searchDebounceMs}
        filterable={props.filterable}
        sortable={props.sortable}
        defaultSort={props.defaultSort}
        pageSize={props.pageSize}
        download={props.download}
        editable={props.editable}
        where={props.where}
        variant={props.variant}
        size={props.size}
        emptyState={props.emptyState}
        className={props.className}
        minColumnWidth={props.minColumnWidth}
      />
      {showDeleteSnackbar && (
        <Show when={sql`dt_page_delete_success`}>
          <div
            onMount={(s) => {
              s.sleep(3500);
              s.setScalar("dt_page_delete_success", false);
            }}
          >
            <Snackbar
              startIcon="CheckCircle"
              color="success"
              variant="soft"
              anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
            >
              Records deleted
            </Snackbar>
          </div>
        </Show>
      )}
    </Data>
  );
}

function DeleteBulkAction(
  { tableName, selectedTable }: {
    tableName: string;
    selectedTable: string;
  },
) {
  const table = system.db.tables[tableName];
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("confirming_delete", false);
      }}
    >
      <IconButton
        size="sm"
        color="danger"
        variant="soft"
        icon="DeleteOutline"
        aria-label="Delete selected records"
        onClick={(s) => {
          s.setScalar("confirming_delete", true);
        }}
      />
      <DeleteRecordsDialog
        bindScalar="confirming_delete"
        table={table.name}
        targetIdsQuery={sql`select id from ui.${sql.ref(selectedTable)}`}
        recordCount={sql`(select count(*) from ui.${sql.ref(selectedTable)})`}
        afterTransactionCommit={(s) => s.refetch()}
        afterSubmitClient={(s) => {
          s.modify(sql`delete from ${sql.ref(selectedTable)}`);
          s.setScalar("dt_page_delete_success", true);
        }}
        disableAutoRefetch
      />
    </Data>
  );
}
