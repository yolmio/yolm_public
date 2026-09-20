import { ButtonGroup } from "components/button_group";
import { CircularProgress } from "components/circular_progress";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type {
  DomStatements,
  StateStatements,
  UiServerStatements,
} from "std/statements";
import { Show } from "std/ui";
import { useGlobalState } from "std/system";

export const DATAGRID_RECORD_NAVIGATION_SOURCE =
  "datagrid_record_navigation_source";
export const DATAGRID_RECORD_NAVIGATION_QUERY_PREFIX =
  "datagrid_record_navigation_query_prefix";
export const DATAGRID_RECORD_NAVIGATION_COUNT_QUERY =
  "datagrid_record_navigation_count_query";
export const DATAGRID_RECORD_NAVIGATION_ROW_COUNT =
  "datagrid_record_navigation_row_count";
export const DATAGRID_RECORD_NAVIGATION_PAGE_SIZE =
  "datagrid_record_navigation_page_size";
export const DATAGRID_RECORD_NAVIGATION_CAPTURE_SOURCE =
  "datagrid_record_navigation_capture_source";
export const DATAGRID_RECORD_NAVIGATION_CAPTURE_QUERY_PREFIX =
  "datagrid_record_navigation_capture_query_prefix";
export const DATAGRID_RECORD_NAVIGATION_CAPTURE_COUNT_QUERY =
  "datagrid_record_navigation_capture_count_query";

export function useSeparatedDatagridRecordNavigationState() {
  useGlobalState({
    key: "separated_datagrid_record_navigation",
    procedure: (s) => {
      s.defScalar("datagrid_record_navigation_context", false);
      s.defScalar("datagrid_record_navigation_loading", false);
      s.defScalar("datagrid_record_navigation_load_failed", false);
      s.defScalar("datagrid_record_navigation_has_more", false);
      s.defScalar(DATAGRID_RECORD_NAVIGATION_SOURCE, {
        type: { type: "String", maxLength: 200 },
      });
      s.defScalar(DATAGRID_RECORD_NAVIGATION_QUERY_PREFIX, {
        type: { type: "String", maxLength: 1_000_000 },
      });
      s.defScalar(DATAGRID_RECORD_NAVIGATION_COUNT_QUERY, {
        type: { type: "String", maxLength: 1_000_000 },
      });
      s.defScalar(DATAGRID_RECORD_NAVIGATION_ROW_COUNT, {
        type: "BigUint",
      });
      s.defScalar(DATAGRID_RECORD_NAVIGATION_PAGE_SIZE, {
        type: "BigUint",
      });
      s.defTable("datagrid_record_navigation_rows", {
        fields: [
          { name: "position", notNull: true, type: "BigUint" },
          { name: "record_id", notNull: true, type: "BigUint" },
        ],
      });
    },
  });
}

export function withCurrentQuery(path: Sql): Sql {
  return sql`${path} || case
    when coalesce(location.query, '') = '' then ''
    else '?' || location.query
  end`;
}

export function datagridRecordUrl(path: string, id: NumericExpr): Sql {
  return withCurrentQuery(
    sql`${sql.lit(`${path}/`)} || cast(${id} as string)`,
  );
}

export function captureDatagridRecordNavigation(
  s: DomStatements,
  opts?: { pageSize: number; rowCountScalar: string },
) {
  s.modify(sql`delete from ui.datagrid_record_navigation_rows`);
  s.modify(
    sql`insert into ui.datagrid_record_navigation_rows (position, record_id)
    select row_number() over (), cast(field_0 as bigint)
    from ui.dg_table`,
  );
  s.setScalar("ui.datagrid_record_navigation_context", true);
  s.setScalar("ui.datagrid_record_navigation_loading", false);
  s.setScalar("ui.datagrid_record_navigation_load_failed", false);
  s.setScalar(
    "ui.datagrid_record_navigation_has_more",
    sql`(
      ui.datagrid_record_navigation_has_more
      and (select count(*) from ui.datagrid_record_navigation_rows) >= ui.row_count
    ) or status != 'received'`,
  );
  if (opts) {
    s.setScalar(opts.rowCountScalar, sql`ui.row_count`);
    s.setScalar(
      `ui.${DATAGRID_RECORD_NAVIGATION_PAGE_SIZE}`,
      opts.pageSize,
    );
    s.setScalar(
      `ui.${DATAGRID_RECORD_NAVIGATION_SOURCE}`,
      sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_CAPTURE_SOURCE)}`,
    );
    s.setScalar(
      `ui.${DATAGRID_RECORD_NAVIGATION_QUERY_PREFIX}`,
      sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_CAPTURE_QUERY_PREFIX)}`,
    );
    s.setScalar(
      `ui.${DATAGRID_RECORD_NAVIGATION_COUNT_QUERY}`,
      sql`ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_CAPTURE_COUNT_QUERY)}`,
    );
  }
}

interface DatagridRecordNavigationProps {
  datagridName?: string;
  listPath: string;
  pageSize: NumericExpr;
  dynamicQuery:
    | Sql
    | ((s: StateStatements | UiServerStatements) => Sql);
  countQuery:
    | Sql
    | ((s: StateStatements | UiServerStatements) => Sql);
  columnCount: number;
  showExactResultCount: boolean;
  rowCount?: Sql;
  rowCountScalar?: string;
}

export function DatagridRecordNavigation(
  props: DatagridRecordNavigationProps,
) {
  const resolveQuery = (
    query:
      | Sql
      | ((s: StateStatements | UiServerStatements) => Sql),
    s: StateStatements | UiServerStatements,
  ) => typeof query === "function" ? query(s) : query;
  const rowCount = props.rowCount ?? sql`ui.row_count`;
  const rowCountScalar = props.rowCountScalar ?? "ui.row_count";
  const currentPosition =
    sql`(select position from ui.datagrid_record_navigation_rows where record_id = ui.record_id)`;
  const previousRecordId =
    sql`(select record_id from ui.datagrid_record_navigation_rows where position = ${currentPosition} - 1)`;
  const nextRecordId =
    sql`(select record_id from ui.datagrid_record_navigation_rows where position = ${currentPosition} + 1)`;
  const cachedRowCount =
    sql`(select count(*) from ui.datagrid_record_navigation_rows)`;
  const hasContext = props.datagridName
    ? sql`ui.datagrid_record_navigation_context
        and ui.${sql.ref(DATAGRID_RECORD_NAVIGATION_SOURCE)} = ${
      sql.lit(props.datagridName)
    }
        and ${currentPosition} is not null`
    : sql`ui.datagrid_record_navigation_context and ${currentPosition} is not null`;
  const nextDisabled =
    sql`ui.datagrid_record_navigation_loading or (${nextRecordId} is null and not ui.datagrid_record_navigation_has_more)`;

  const progressivePositionText = () => (
    <Typography level="body-xs" color="neutral">
      {sql`cast(${currentPosition} as string) || ' of ' || cast(${cachedRowCount} as string) || case when ui.datagrid_record_navigation_has_more then '+' else '' end`}
    </Typography>
  );

  const positionText = props.showExactResultCount
    ? (
      <Data
        procedure={(s) => {
          s.dynamicQuery({
            resultTable: "datagrid_record_navigation_count",
            query: resolveQuery(props.countQuery, s),
            columnCount: 1,
          });
        }}
        pendingFallback={progressivePositionText()}
        errorFallback={progressivePositionText()}
      >
        <Typography level="body-xs" color="neutral">
          {sql`cast(${currentPosition} as string) || ' of ' || cast((select field_0 from datagrid_record_navigation_count) as string) || ' entries'`}
        </Typography>
      </Data>
    )
    : progressivePositionText();

  return (
    <Show when={hasContext}>
      <nav
        aria-label="Record navigation"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          minHeight: 36,
          px: 1.5,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <IconButton
          icon="Close"
          aria-label="Close record"
          tooltip="Close record"
          variant="plain"
          color="neutral"
          size="xs"
          onClick={(s) => {
            s.setScalar("ui.datagrid_record_navigation_context", false);
            s.navigate(
              withCurrentQuery(sql.lit(props.listPath)),
              sql.true,
            );
          }}
        />
        <ButtonGroup size="xs" variant="outlined" color="neutral">
          <IconButton
            icon="KeyboardArrowUp"
            aria-label="Previous record"
            tooltip="Previous record"
            disabled={sql`${previousRecordId} is null`}
            onClick={(s) => {
              s.navigate(
                datagridRecordUrl(props.listPath, previousRecordId),
                sql.true,
              );
            }}
          />
          <IconButton
            aria-label="Next record"
            tooltip="Next record"
            disabled={nextDisabled}
            onClick={(s) => {
              s.defScalar("next_record_id", nextRecordId);
              s.if(sql`next_record_id is not null`, (s) => {
                s.navigate(
                  datagridRecordUrl(props.listPath, sql`next_record_id`),
                  sql.true,
                );
                s.return();
              });
              s.returnIf(
                sql`ui.datagrid_record_navigation_loading or not ui.datagrid_record_navigation_has_more`,
              );
              s.defScalar(
                "previous_datagrid_record_navigation_row_count",
                rowCount,
              );
              s.setScalar("ui.datagrid_record_navigation_loading", true);
              s.setScalar("ui.datagrid_record_navigation_load_failed", false);
              s.setScalar(
                rowCountScalar,
                sql`greatest(${rowCount}, ${cachedRowCount} + ${props.pageSize})`,
              );
              s.commitUiTreeChanges();
              s.tryServer({
                body: (s) => {
                  s.dynamicQuery({
                    resultTable: "datagrid_record_navigation_page",
                    query: resolveQuery(props.dynamicQuery, s),
                    columnCount: props.columnCount,
                    rowCap: rowCount,
                    setHasMoreScalar: "ui.datagrid_record_navigation_has_more",
                  });
                  s.modify(
                    sql`delete from ui.datagrid_record_navigation_rows`,
                  );
                  s.modify(
                    sql`insert into ui.datagrid_record_navigation_rows (position, record_id)
                      select row_number() over (), cast(field_0 as bigint)
                      from datagrid_record_navigation_page`,
                  );
                },
                errorName: "error",
                catch: (s) => {
                  s.setScalar(
                    rowCountScalar,
                    sql`previous_datagrid_record_navigation_row_count`,
                  );
                  s.setScalar(
                    "ui.datagrid_record_navigation_load_failed",
                    true,
                  );
                },
                finally: (s) => {
                  s.setScalar(
                    "ui.datagrid_record_navigation_loading",
                    false,
                  );
                },
              });
              s.returnIf(sql`ui.datagrid_record_navigation_load_failed`);
              s.defScalar(
                "loaded_next_record_id",
                sql`(select record_id from ui.datagrid_record_navigation_rows where position = ${currentPosition} + 1)`,
              );
              s.if(sql`loaded_next_record_id is not null`, (s) => {
                s.navigate(
                  datagridRecordUrl(
                    props.listPath,
                    sql`loaded_next_record_id`,
                  ),
                  sql.true,
                );
              });
            }}
          >
            <Show
              when={sql`ui.datagrid_record_navigation_loading`}
              fallback={<MaterialIcon icon="KeyboardArrowDown" />}
            >
              <CircularProgress size="xs" />
            </Show>
          </IconButton>
        </ButtonGroup>
        {positionText}
        <Show when={sql`ui.datagrid_record_navigation_load_failed`}>
          <Typography level="body-xs" color="danger">
            Unable to load more records. Try again.
          </Typography>
        </Show>
      </nav>
    </Show>
  );
}
