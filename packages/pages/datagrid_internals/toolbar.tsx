import { Alert } from "components/alert";
import { AutoInsertIconButton } from "components/auto_insert_dialog";
import type { AutoInsertIconButtonProps } from "components/auto_insert_dialog";
import { Button } from "components/button";
import type { ButtonProps } from "components/button";
import { ButtonGroup } from "components/button_group";
import { Chip } from "components/chip";
import { CircularProgress } from "components/circular_progress";
import { ConfirmDangerDialog } from "components/confirm_danger_dialog";
import {
  DeleteRecordsDialog,
  tableHasRestrictDeleteBlockers,
} from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { List, ListItemButton, ListItemDecorator } from "components/list";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { Snackbar } from "components/snackbar";
import { SvgIcon } from "components/svg_icon";
import { Typography } from "components/typography";
import { useUndoSnackbar } from "components/undo_snackbars";
import type { UndoSnackbar } from "components/undo_snackbars";
import {
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  CurrentWatchKeyICtxKey,
  DatagridViewsICtxKey,
  DynamicDatagridICtxKey,
  DynamicDatagridToolbarGatherICtxKey,
  ToolbarGatherICtxKey,
  useCurrentWatchState,
  useToolbarNode,
  useToolbarState,
} from "std/ictx";
import type {
  CurrentRefetchICtx,
  CurrentTableICtx,
  CurrentWatchKeyICtx,
  DynamicDatagridToolbarGatherICtx,
  ToolbarGatherICtx,
} from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { AnyExpr } from "../../std/sql_utils";
import type {
  DomStatements,
  IStatementsBase,
  StateStatements,
} from "std/statements";
import { createStyles, flexGrowStyles } from "std/style_utils";
import type { Table } from "std/system";
import { Data } from "std/data";
import {
  addCtx,
  Conditional,
  Each,
  gatherChildrenContextInfo,
  Match,
  Show,
  Switch,
  useApp,
  useICtx,
  useOptionalICtx,
  usePhase,
  useState,
} from "std/ui";
import type {
  ContextInstance,
  ICtxKey,
  Node,
  StatePropsWithoutChildren,
} from "std/ui";
import { DatagridActionDialog } from "./action_dialog_datagrid";
import type { DatagridActionDialogProps } from "./action_dialog_datagrid";
import { BulkUpdateDialog } from "./bulk_update";
import { ServerProcButton, ServerProcMenuItem } from "./shared";
import { ToolbarColumnsButton } from "./toolbar_columns";
import { ToolbarFilterButton } from "./toolbar_filter";
import { ToolbarSortButton } from "./toolbar_sort";
import { AddViewModal, DefaultViewItem, NewViewItem } from "./view_drawer";
import { Sidebar } from "components/sidebar";
import { SidebarPresenceICtxKey } from "std/ictx";
/**
 * Context used during the toolbar "gather" phase to collect the state
 * definitions and dialog nodes that toolbar children request, before the
 * toolbar renders. Lets items like the delete/export buttons register the
 * UI state and hidden dialogs they need (and flag `needsSelectable`).
 *
 * @category Helper
 */
export class DynamicDatagridGatherContext
  implements
    ContextInstance,
    ToolbarGatherICtx,
    DynamicDatagridToolbarGatherICtx,
    CurrentTableICtx,
    CurrentRefetchICtx,
    CurrentWatchKeyICtx {
  implementICtxs: ICtxKey<any>[] = [
    ToolbarGatherICtxKey,
    DynamicDatagridToolbarGatherICtxKey,
    CurrentTableICtxKey,
    CurrentRefetchICtxKey,
    CurrentWatchKeyICtxKey,
  ];
  states: StatePropsWithoutChildren[] = [];
  nodes: Node[] = [];
  needsSelectable = false;

  // these are just dummy values as the gather doesn't actually need them
  currentWatchKey: AnyExpr[] = [sql`dg_refresh_key`];
  triggerRefetch = <T extends IStatementsBase>(s: T) => {
    s.increment("dg_refresh_key");
  };

  constructor(public currentTable: Table) {}

  addToolbarState(
    f: ((s: StateStatements) => void) | StatePropsWithoutChildren,
  ) {
    this.states.push(typeof f === "function" ? { procedure: f } : f);
  }

  addToolbarNode(node: Node) {
    this.nodes.push(node);
  }
}

/** Props for {@link DatagridToolbar}. Each `disable*` flag hides a built-in toolbar control. */
export interface ToolbarProps {
  disableFiltering?: boolean;
  disableSorting?: boolean;
  disableColumns?: boolean;
  disableViews?: boolean;
  disableRowHeight?: boolean;
  /** Hides the quick-search input even when the table has a search config. */
  disableSearch?: boolean;
  children?: Node;
}

/**
Renders the main toolbar for the datagrid component. Includes buttons for views, columns, filtering, sorting, and row height selection.
The toolbar adapts its layout based on screen size and shows loading states when data is being fetched.
Can ONLY be used inside a <Datagrid/>  (or <DatagridPage/>) component).

@category UI Component

@param props.disableViews - If true, hides the views button
@param props.disableColumns - If true, hides the columns button
@param props.disableFiltering - If true, hides the filtering button
@param props.disableSorting - If true, hides the sorting button
@param props.disableRowHeight - If true, hides the row height selector
@param props.disableSearch - If true, hides the search input even if the table has a search config
@param props.children - Additional toolbar items to render
*/

export function DatagridToolbar(props: ToolbarProps) {
  if (usePhase() === "gather") {
    return props.children;
  }
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  const dynamicDatagridCtx = useICtx(DynamicDatagridICtxKey);
  const ctx = new DynamicDatagridGatherContext(
    useICtx(CurrentTableICtxKey).currentTable,
  );
  const viewsCtx = useICtx(DatagridViewsICtxKey);
  // const { currentTable } = useICtx(CurrentTableICtxKey);
  // const hasSearchConfig = Boolean(currentTable.searchConfig);
  // const showSearch = hasSearchConfig && !props.disableSearch;
  // const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  addCtx(ctx);
  gatherChildrenContextInfo(props.children);
  for (const state of ctx.states) {
    useState(state);
  }
  useState((s) => {
    s.defScalar("drawer_refresh_key", 0);
    s.defScalar("proc_error", {
      type: { type: "String", maxLength: 2000 },
      expr: sql.null,
      allowNoRead: true,
    });
    s.defScalar("proc_in_progress", {
      expr: false,
      allowNoRead: true,
    });
  });

  return (
    <>
      <div className="overflow-x-auto shrink-0">
        <div
          sx={{
            px: 2,
            my: 1,
            gap: 1,
            md: {
              gap: 4,
              px: 4,
              my: 2,
            },
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            width: "100%",
            "& > *": {
              flexShrink: 0,
            },
          }}
        >
          <Conditional
            when={sql`(status = 'requested' or status = 'fallback_triggered') and not dg_has_data and dg_refresh_key = 0`}
            then={
              <>
                <div
                  sx={{
                    backgroundColor: "neutral-soft-hover-bg",
                    width: 80,
                    borderRadius: "sm",
                    my: 0.5,
                    height: 32,
                  }}
                />
                <div
                  sx={{
                    backgroundColor: "neutral-soft-hover-bg",
                    width: 200,
                    height: 32,
                    borderRadius: "sm",
                    my: 0.5,
                    ml: 0.5,
                  }}
                />
              </>
            }
            else={
              <>
                {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
                {dynamicDatagridCtx.viewsEnabled && !props.disableViews && (
                  <DatagridToolbar.ViewsButton />
                )}
                {!props.disableColumns && <ToolbarColumnsButton />}
                {dynamicDatagridCtx.quickSearch && !props.disableSearch && (
                  <Input
                    placeholder={dynamicDatagridCtx.quickSearch.placeholder}
                    startIcon="Search"
                    size="sm"
                    value={sql`coalesce(q, '')`}
                    onInput={(s) => {
                      s.setQueryParam("q", sql`target_value`, sql.true);
                    }}
                    sx={{ width: "min(300px, 100%)" }}
                  />
                )}
              </>
            }
          />
          <DatagridToolbar.LoadingAndErrors />
          <div sx={flexGrowStyles} />
          {props.children}
          {ctx.nodes}
        </div>
      </div>
      <Divider />
      <div className="overflow-x-auto shrink-0">
        <div
          sx={{
            px: 2,
            my: 1,
            gap: 1,
            md: {
              gap: 4,
              px: 4,
              my: 2,
            },
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            width: "100%",
            "& > *": {
              flexShrink: 0,
            },
          }}
        >
          <Conditional
            when={sql`(status = 'requested' or status = 'fallback_triggered') and not dg_has_data and dg_refresh_key = 0`}
            then={
              <>
                <div
                  sx={{
                    backgroundColor: "neutral-soft-hover-bg",
                    width: 80,
                    borderRadius: "sm",
                    my: 0.5,
                    height: 32,
                  }}
                />
                <div
                  sx={{
                    backgroundColor: "neutral-soft-hover-bg",
                    width: 200,
                    height: 32,
                    borderRadius: "sm",
                    my: 0.5,
                    ml: 0.5,
                  }}
                />
              </>
            }
            else={
              <>
                {dynamicDatagridCtx.filteringEnabled &&
                  !props.disableFiltering && <ToolbarFilterButton />}
                {!props.disableSorting && <ToolbarSortButton />}
                {!props.disableRowHeight && <DatagridToolbar.RowHeightSelect />}
              </>
            }
          />

          <div sx={flexGrowStyles} />
          {dynamicDatagridCtx.viewsEnabled && !props.disableViews && (
            <Data
              local
              procedure={(s) => {
                s.defScalar("adding", false);
              }}
            >
              <AddViewModal
                open={sql`adding`}
                onClose={(s) => s.setScalar("adding", false)}
              />
              <Data
                local
                procedure={(s) => {
                  s.defScalar("changes_available", false);
                  s.if(
                    sql`has_unsaved_view_changes or last_saved_state_hash != ${
                      dynamicDatagridCtx.viewStateHash(s)
                    }`,
                    (s) => {
                      s.setScalar("changes_available", true);
                    },
                  );
                  s.defScalar("popover_open", false);
                }}
                watch={[sql`has_changes_refresh_key`]}
              >
                <Show when={sql`changes_available`}>
                  <Button
                    variant="outlined"
                    color="primary"
                    size="sm"
                    onClick={(s) => {
                      s.increment("reset_key");
                      dynamicDatagridCtx.clearChangesInToolbar(s);
                    }}
                  >
                    Discard changes
                  </Button>

                  <Switch>
                    <Match when={sql`ui.view is null`}>
                      <Button
                        color="primary"
                        size="sm"
                        onClick={(s) => {
                          s.setScalar("adding", true);
                        }}
                      >
                        Save in new view
                      </Button>
                    </Match>
                    <Match when={sql.true}>
                      <ButtonGroup>
                        <Button
                          color="primary"
                          variant="solid"
                          size="sm"
                          onClick={(s) => {
                            s.event.stopPropagation();
                            s.setScalar("proc_in_progress", true);
                            s.setScalar("proc_error", sql.null);
                            s.commitUiTreeChanges();
                            s.tryServer({
                              body: (s) => {
                                s.startTransaction();
                                viewsCtx.saveCurrentToExistingView(
                                  s,
                                  sql`ui.view`,
                                );
                                s.commitTransaction();
                                s.increment("drawer_refresh_key");
                              },

                              errorName: "caught_error",
                              catch: (s) => {
                                s.setScalar(
                                  "proc_error",
                                  sql.lit`Error saving view`,
                                );
                              },
                              finally: (s) => {
                                s.increment("reset_key");
                                dynamicDatagridCtx.clearChangesInToolbar(s);
                                s.setScalar("proc_in_progress", false);
                              },
                            });
                          }}
                          loading={sql`proc_in_progress`}
                        >
                          Save changes
                        </Button>
                        <IconButton
                          color="primary"
                          size="sm"
                          variant="solid"
                          id="save-changes-button"
                          aria-label="Save changes"
                          onClick={(s) => {
                            s.setScalar("popover_open", true);
                          }}
                        >
                          <SvgIcon>
                            <path d="M7 10l5 5 5-5z" />
                          </SvgIcon>
                        </IconButton>
                      </ButtonGroup>
                      <Show when={sql`popover_open`}>
                        <div
                          sx={styles.popover()}
                          tabIndex={-1}
                          popover="auto"
                          yolmPopoverShowing={sql`popover_open`}
                          classes="skip-harmonize"
                          id={sql.concat("views-popover")}
                          floating={{
                            anchorEl: sql.lit`save-changes-button`,
                            placement: "bottom",
                            strategy: "fixed",
                            shift: { mainAxis: true, crossAxis: true },
                            offset: {
                              mainAxis: 4,
                              crossAxis: 0,
                            },
                            flip: { crossAxis: false, mainAxis: false },
                          }}
                          onClickAway={(s) => {
                            s.setScalar("popover_open", false);
                          }}
                          style={{ width: "20%" }}
                        >
                          <List
                            sx={{ maxHeight: 300, overflowY: "auto" }}
                            size="sm"
                          >
                            <ListItemButton
                              onClick={(s) => {
                                s.setScalar("popover_open", false);
                                s.setScalar("adding", true);
                              }}
                              size="sm"
                            >
                              Save in new view
                            </ListItemButton>
                          </List>
                        </div>
                      </Show>
                    </Match>
                  </Switch>
                </Show>
              </Data>
            </Data>
          )}
        </div>
      </div>
    </>
  );
}

const styles = createStyles({
  popover: (app) => {
    return {
      viewTransitionName: "navbar-popover",
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      border: "1px solid",
      borderColor: "divider",
      zIndex: 1400,
      opacity: 0,
      transform: "scaleY(0)",
      transformOrigin: "top",
      width: "inherit",
      "&:popover-open": {
        opacity: 1,
        transform: "none",
        "@starting-style": {
          "&": {
            opacity: 0,
            transform: "scaleY(0)",
          },
        },
      },
      margin: 0,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
  },
  viewsList: { mt: 2, p: 0 },
});

DatagridToolbar.ViewsButton = function ViewsButton() {
  const app = useApp();
  const ctx = useICtx(DatagridViewsICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("view_popover_open", false);
        s.defScalar("adding", false);
        s.defScalar("proc_error", {
          type: { type: "String", maxLength: 2000 },
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("proc_in_progress", {
          expr: false,
          allowNoRead: true,
        });
      }}
    >
      <Data
        watch={app.createFocusRefreshWatch(sql`drawer_refresh_key`)}
        procedure={(s) => {
          s.defTable(
            "datagrid_views",
            sql`select id, ordering, name, sys_user_id is not null as is_personal from db.datagrid_views where datagrid_name = ${
              sql.lit(ctx.datagridName)
            } and (sys_user_id is null or sys_user_id = current_user) order by sys_user_id is not null, ordering`,
          );
        }}
        statusScalar="drawer_status"
        hasDataScalar="drawer_has_data"
        pendingFallback={null}
        errorFallback={null}
      >
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          startIcon="Menu"
          onClick={(s) => {
            s.toggle("view_popover_open");
          }}
          id="views-button"
        >
          {sql`case when (select name from datagrid_views where id = ui.view) is null then 'Default View' else (select name from datagrid_views where id = ui.view) end`}
        </Button>
        <AddViewModal
          open={sql`adding`}
          onClose={(s) => s.setScalar("adding", false)}
        />
        <Divider orientation="vertical" />
        <Show when={sql`view_popover_open`}>
          <div
            sx={styles.popover()}
            tabIndex={-1}
            popover="auto"
            yolmPopoverShowing={sql`view_popover_open`}
            classes="skip-harmonize"
            id={sql.concat("views-popover")}
            floating={{
              anchorEl: sql.lit`views-button`,
              placement: "bottom-start",
              strategy: "fixed",
              shift: { mainAxis: true, crossAxis: true },
              offset: {
                mainAxis: 4,
                crossAxis: 0,
              },
              flip: { crossAxis: false, mainAxis: false },
            }}
            onClickAway={(s) => {
              s.setScalar("view_popover_open", false);
            }}
            style={{ width: "20%" }}
          >
            <List sx={{ maxHeight: 300, overflowY: "auto" }}>
              <Switch>
                <Match
                  when={sql`drawer_status in ('fallback_triggered', 'requested') and not drawer_has_data`}
                >
                  <CircularProgress size="lg" />
                </Match>
                <Match when={sql`drawer_status = 'failed'`}>
                  <Alert color="danger">Unable to get views</Alert>
                </Match>
                <Match when={sql`exists (select id from datagrid_views)`}>
                  <ul sx={styles.viewsList}>
                    <DefaultViewItem />
                    <Each
                      table="datagrid_views"
                      eachKey={sql`id`}
                      recordName="view_record"
                    >
                      <NewViewItem />
                    </Each>
                  </ul>
                </Match>
                <Match when>
                  <ul sx={styles.viewsList}>
                    <DefaultViewItem />
                  </ul>
                </Match>
              </Switch>
              <Divider />
              <Show when={sql`not adding`}>
                <ListItemButton
                  onClick={(s) => {
                    s.setScalar("view_popover_open", false);
                    s.setScalar("adding", true);
                  }}
                >
                  <MaterialIcon icon="Add" />
                  Create new view
                </ListItemButton>
              </Show>
            </List>
          </div>
        </Show>
      </Data>
    </Data>
  );
};

DatagridToolbar.RowHeightSelect = function RowHeightSelect() {
  const { triggerChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <Select
      size="sm"
      variant="plain"
      color="neutral"
      value={sql`row_height::string`}
      onChange={(s) => {
        s.setScalar("row_height", sql`target_value::bigint`);
        triggerChangesInToolbar(s);
      }}
      className="w-[150px]"
    >
      <Select.Option value="36">Extra Short Rows</Select.Option>
      <Select.Option value="44">Short Rows</Select.Option>
      <Select.Option value="56">Medium Rows</Select.Option>
      <Select.Option value="88">Tall Rows</Select.Option>
      <Select.Option value="128">Extra Tall Rows</Select.Option>
    </Select>
  );
};

DatagridToolbar.LoadingAndErrors = function LoadingAndErrors() {
  return (
    <>
      <Show
        when={sql`status = 'fallback_triggered' and (dg_refresh_key != 0 or (global_refetch_key != 0 and dg_has_data))`}
      >
        <Typography
          startDecorator={<CircularProgress size="sm" />}
          level="body-sm"
        >
          {sql`case when row_count = 100 then 'Reloading...' else 'Loading more rows...' end`}
        </Typography>
      </Show>
      <Show when={sql`saving_edit`}>
        <Typography
          startDecorator={<CircularProgress size="sm" />}
          level="body-sm"
        >
          Saving change...
        </Typography>
      </Show>
      <Show when={sql`display_error_message is not null`}>
        <Alert startIcon="Report" size="sm" color="danger" variant="solid">
          {sql`display_error_message`}
        </Alert>
      </Show>
      <Show when={sql`status = 'failed'`}>
        <Alert startIcon="Report" size="sm" color="danger" variant="solid">
          Failed to load data
        </Alert>
      </Show>
    </>
  );
};

DatagridToolbar.CountText = function CountText() {
  if (usePhase() === "gather") {
    return;
  }
  const ctx = useICtx(DynamicDatagridICtxKey);
  useCurrentWatchState((s) => {
    s.dynamicQuery({
      query: ctx.buildCountQuery(s),
      columnCount: 1,
      resultTable: "dyn_count",
    });
    s.defScalar("count", sql`cast((select field_0 from dyn_count) as bigint)`);
  });
  return sql`format.decimal(count)`;
};

DatagridToolbar.Count = function Count() {
  return (
    <Typography level="body-md">
      <DatagridToolbar.CountText /> records
    </Typography>
  );
};

DatagridToolbar.ShowCountText = function ShowCountText() {
  return (
    <Show when={sql`count_extension_shown`}>
      <DatagridToolbar.Count />
    </Show>
  );
};

interface ShowCountMenuItemProps {
  defaultOpen?: boolean;
}

DatagridToolbar.ShowCountMenuItem = function ShowCountMenuItem(
  props: ShowCountMenuItemProps,
) {
  useToolbarState((s) => {
    s.defScalar("count_extension_shown", props.defaultOpen ?? false);
  });
  return (
    <Menu.Item
      onClick={(s) => {
        s.toggle("count_extension_shown");
      }}
    >
      <ListItemDecorator>
        <MaterialIcon icon="Numbers" />
      </ListItemDecorator>
      {sql`case when count_extension_shown then 'Hide Count' else 'Show Count' end`}
    </Menu.Item>
  );
};

function DatagridDeleteDialog({
  undoSnackbar,
  openScalar,
}: {
  undoSnackbar: UndoSnackbar;
  openScalar: string;
}) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const ctx = useICtx(DynamicDatagridICtxKey);
  const { currentTable } = useICtx(CurrentTableICtxKey);
  if (!tableHasRestrictDeleteBlockers(currentTable)) {
    return (
      <ConfirmDangerDialog
        bindScalar={openScalar}
        description={
          <>
            Are you sure you want to delete{" "}
            <Show
              when={sql`selected_all`}
              fallback={sql`(select count(*) from selected_row)`}
            >
              <Data
                procedure={(s) => {
                  s.dynamicQuery({
                    query: ctx.buildCountQuery(s),
                    columnCount: 1,
                    resultTable: "dyn_count",
                  });
                }}
                pendingFallback={null}
                errorFallback={null}
              >
                ALL {sql`(select field_0 from dyn_count)`}
              </Data>
            </Show>{" "}
            records?
          </>
        }
        onConfirm={(s, close) => {
          s.returnIf(sql`dialog_waiting`);
          s.setScalar("dialog_waiting", true);
          s.setScalar("dialog_error", sql.null);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.conditional({
                condition: sql`selected_all`,
                then: (s) => {
                  s.dynamicQuery({
                    query: ctx.buildCountQuery(s),
                    columnCount: 1,
                    resultTable: "dyn_count",
                  });
                  s.setScalar(
                    "deleted_record_count",
                    sql`(select field_0 from dyn_count)::bigint`,
                  );
                  s.dynamicModify(
                    sql.concat(
                      `delete from ${currentTable.identWithDb.toSQL()} as record where `,
                      ctx.buildWherePart(s),
                    ),
                  );
                },
                else: (s) => {
                  s.setScalar(
                    "deleted_record_count",
                    sql`(select count(*) from ui.selected_row)`,
                  );
                  s.modify(
                    sql`delete from ${currentTable.identWithDb} where id in (select id from ui.selected_row)`,
                  );
                },
              });
              undoSnackbar.setUndoTx(s);
              s.commitTransaction();
              s.modify(sql`delete from ui.selected_row`);
              s.statements(triggerRefetch);
            },
            catch: (s) => {
              s.setScalar("dialog_error", sql.lit`Unable to delete records`);
              s.setScalar("dialog_waiting", false);
              s.return();
            },
          });
          s.statements(close, undoSnackbar.openSuccess);
        }}
      />
    );
  }
  const targetIdsQuery = sql`
    select id
    from ui.selected_row
    where not selected_all
    union all
    select field_0::bigint as id
    from delete_all_record_ids
    where selected_all
  `;
  return (
    <DeleteRecordsDialog
      bindScalar={openScalar}
      table={currentTable.name}
      targetIdsQuery={targetIdsQuery}
      prepareTargetIds={(s) => {
        s.dynamicQuery({
          query: sql`
            case
              when selected_all then ${ctx.buildIdsQuery(s)}
              else 'select null::bigint where false'
            end
          `,
          columnCount: 1,
          defResultTable: "delete_all_record_ids",
        });
      }}
      recordCount={
        <>
          <Show
            when={sql`selected_all`}
            fallback={sql`(select count(*) from ui.selected_row)`}
          >
            ALL {sql`(select count(*) from delete_all_record_ids)`}
          </Show>
        </>
      }
      deletedRecordCountScalar="deleted_record_count"
      beforeTransactionCommit={(s) => undoSnackbar.setUndoTx(s)}
      afterTransactionCommit={(s) => {
        s.modify(sql`delete from ui.selected_row`);
        s.statements(triggerRefetch);
      }}
      afterSubmitClient={undoSnackbar.openSuccess}
      disableAutoRefetch
    />
  );
}

DatagridToolbar.AutoInsertButton = function AutoInsertButton(
  props: AutoInsertIconButtonProps,
) {
  return <AutoInsertIconButton {...props} />;
};

DatagridToolbar.DeleteButton = function DeleteButton() {
  if (usePhase() === "gather") {
    const gatherCtx = useOptionalICtx(DynamicDatagridToolbarGatherICtxKey);
    if (gatherCtx) {
      gatherCtx.needsSelectable = true;
    }
    return;
  }
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  useState((s) => {
    s.defScalar("deleted_record_count", { type: "BigUint" });
    s.defScalar("dialog_open", false);
  });
  const undoSnackbar = useUndoSnackbar({
    successSnackbarContent: sql.concat(
      "Deleted ",
      sql`deleted_record_count`,
      " records",
    ),
    afterUndo: triggerRefetch,
  });
  return (
    <>
      <IconButton
        variant="soft"
        size="sm"
        color="danger"
        aria-label="Delete"
        onClick={(s) => s.setScalar("dialog_open", true)}
        icon="DeleteOutline"
      />
      <DatagridDeleteDialog
        undoSnackbar={undoSnackbar}
        openScalar="dialog_open"
      />
    </>
  );
};

(DatagridToolbar.DeleteButton as any).getSource = () =>
  "DatagridToolbar.DeleteButton";

function DeleteMenuItemDialog() {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  useState((s) => {
    s.defScalar("deleted_record_count", { type: "BigUint" });
  });
  const undoSnackbar = useUndoSnackbar({
    successSnackbarContent: sql.concat(
      "Deleted ",
      sql`deleted_record_count`,
      " records",
    ),
    afterUndo: triggerRefetch,
  });
  return (
    <DatagridDeleteDialog
      undoSnackbar={undoSnackbar}
      openScalar="dialog_open"
    />
  );
}

DatagridToolbar.DeleteMenuItem = function DeleteMenuItem() {
  useToolbarState((s) => {
    s.defScalar("dialog_open", false);
  });
  useToolbarNode(<DeleteMenuItemDialog />);
  return (
    <Menu.Item
      onClick={(s) => {
        s.setScalar("dialog_open", true);
      }}
    >
      <ListItemDecorator>
        <MaterialIcon icon="DeleteOutline" />
      </ListItemDecorator>
      Delete
    </Menu.Item>
  );
};

function BulkUpdateMenuItemDialog() {
  if (usePhase() === "gather") {
    return;
  }
  return (
    <BulkUpdateDialog
      open={sql`bulk_update_dialog_open`}
      onClose={(s) => s.setScalar("bulk_update_dialog_open", false)}
    />
  );
}

DatagridToolbar.BulkUpdateMenuItem = function BulkUpdateMenuItem() {
  useToolbarState((s) => {
    s.defScalar("bulk_update_dialog_open", false);
  });
  useToolbarNode(<BulkUpdateMenuItemDialog />);
  return (
    <Menu.Item
      onClick={(s) => {
        s.setScalar("bulk_update_dialog_open", true);
      }}
    >
      <ListItemDecorator>
        <MaterialIcon icon="Edit" />
      </ListItemDecorator>
      Update
    </Menu.Item>
  );
};

function doExport(s: DomStatements) {
  const dyn = useICtx(DynamicDatagridICtxKey);
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const filename = sql.concat(currentTable.displayName, ".csv");
  s.conditional({
    condition: sql`exists (select 1 from selected_row)`,
    then: (s) => {
      const inIdList = sql.concat(
        currentTable.primaryKeyIdent.toSQL(),
        " in (",
        sql`(select string_agg(id, ',') from selected_row)`,
        ")",
      );
      s.downloadDynamicQueryCsv(filename, dyn.downloadQuery(inIdList), {
        skipAutoRowCap: sql`true`,
      });
    },
    else: (s) => {
      s.downloadDynamicQueryCsv(filename, dyn.downloadQuery(), {
        skipAutoRowCap: sql`true`,
      });
    },
  });
}

DatagridToolbar.ExportButton = function ExportButton(
  props: Omit<ButtonProps, "children"> & {
    children?: Node;
  },
) {
  const {
    children = "Export",
    size = "sm",
    variant = "soft",
    color = "neutral",
    ...rest
  } = props;
  return (
    <Button
      {...rest}
      size={size}
      variant={variant}
      color={color}
      onClick={doExport}
    >
      {children}
    </Button>
  );
};

// DatagridToolbar.Search = function Search() {
//   const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);

//   return (
//     <Input
//       size="sm"
//       startIcon="Search"
//       placeholder="Search..."
//       id="dg-search-input"
//       value={sql`dg_search_query`}
//       onInput={(s) => {
//         s.setScalar("dg_search_query", sql`target_value`);

//         triggerRefetch(s);
//       }}
//       className="ml-4"
//     />
//   );
// };

DatagridToolbar.ExportMenuItem = function ExportMenuItem() {
  return (
    <Menu.Item onClick={doExport}>
      <ListItemDecorator>
        <MaterialIcon icon="FileDownload" />
      </ListItemDecorator>
      Export
    </Menu.Item>
  );
};

DatagridToolbar.ActionButton = function ActionButton(
  props: Omit<ButtonProps, "children"> & {
    children?: Node;
  } & {
    modalProps?: Omit<DatagridActionDialogProps, "open" | "onClose">;
  },
) {
  const {
    children = "Action",
    size = "sm",
    variant = "soft",
    color = "neutral",
    modalProps,
    ...rest
  } = props;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("action_modal_open", false);
      }}
    >
      <Button
        {...rest}
        size={size}
        variant={variant}
        color={color}
        onClick={(s) => {
          s.setScalar("action_modal_open", true);
        }}
      >
        {children}
      </Button>
      <DatagridActionDialog
        {...modalProps}
        open={sql`action_modal_open`}
        onClose={(s) => {
          s.setScalar("action_modal_open", false);
        }}
        title={modalProps?.title ?? "Action"}
      />
    </Data>
  );
};

DatagridToolbar.ServerProcButton = ServerProcButton;
DatagridToolbar.ServerProcMenuItem = ServerProcMenuItem;

/**
 * One action shown in the {@link BulkActionsSnackbar} for the current row
 * selection. Provide either `dialog` (a dialog opened via the given
 * `openScalar`) or `action` (statements run directly on click).
 */
export interface SnackbarBulkAction {
  startIcon: IconName;
  label: string;
  /** Dialog opened when the action is clicked, bound to the provided open scalar. */
  dialog?: (props: { openScalar: string }) => Node;
  /** Statements run directly on click (use instead of `dialog`). */
  action?: (s: DomStatements) => void;
}

/** Props for {@link BulkActionsSnackbar}. */
export interface BulkActionsSnackbarProps {
  /** Custom actions to offer in addition to the built-in flags below. */
  actions: SnackbarBulkAction[];
  /** Include the built-in delete action. */
  delete?: boolean;
  /** Include the built-in bulk-update action. */
  update?: boolean;
  /** Include the built-in CSV export action. */
  export?: boolean;
  /** Show a warning chip once this many rows are selected. */
  maxSelectedRows?: number;
}

/**
 * Bottom snackbar shown while datagrid rows are selected, offering bulk
 * actions (delete/update/export plus any custom {@link SnackbarBulkAction}s).
 * Renders nothing unless the datagrid is selectable and at least one action
 * is available. Must be used inside a selectable datagrid.
 *
 * @category UI Component
 */
export function BulkActionsSnackbar(props: BulkActionsSnackbarProps) {
  const ctx = useICtx(DynamicDatagridICtxKey);
  if (!ctx.selectable) {
    return;
  }
  const actions = props.actions.slice();
  if (props.update) {
    actions.push(updateAction);
  }
  if (props.delete) {
    actions.push(deleteAction);
  }
  if (props.export) {
    actions.push(exportAction);
  }
  if (actions.length === 0) {
    return;
  }
  return (
    <Data
      local
      procedure={(s) => {
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          if (action.dialog) {
            s.defScalar(`action_${i}_dialog_open`, false);
          }
        }
      }}
    >
      <Show when={sql`exists (select 1 from selected_row) or selected_all`}>
        <Snackbar
          variant="soft"
          color="neutral"
          anchorOrigin={{
            vertical: "bottom",
            horizontal: "center",
            verticalOffset: 16,
          }}
          harmonize
        >
          <div className="flex items-center gap-2">
            <Conditional
              when={sql`selected_all`}
              then={<Chip variant="soft">All</Chip>}
              else={
                <Chip variant="soft">
                  {sql`(select count(*) from selected_row)`}
                </Chip>
              }
            />
            records selected
            {props.maxSelectedRows !== undefined && (
              <Show
                when={sql`not selected_all and (select count(*) from selected_row) >= ${props.maxSelectedRows}`}
              >
                <Chip variant="soft" color="warning">
                  Maximum {props.maxSelectedRows} records
                </Chip>
              </Show>
            )}
          </div>
          <div className="grow" />
          {actions.map((action, i) => {
            const Dialog = action.dialog;
            return (
              <Button
                variant="outlined"
                size="sm"
                startIcon={action.startIcon}
                onClick={(s) => {
                  if (Dialog) {
                    s.setScalar(`action_${i}_dialog_open`, true);
                  } else {
                    action.action?.(s);
                  }
                }}
              >
                {action.label}
              </Button>
            );
          })}
        </Snackbar>
      </Show>
      {actions.map((action, i) => {
        const Dialog = action.dialog;
        if (Dialog) {
          return <Dialog openScalar={`action_${i}_dialog_open`} />;
        }
        return null;
      })}
    </Data>
  );
}

const deleteAction: SnackbarBulkAction = {
  startIcon: "Delete",
  label: "Delete",
  dialog: ({ openScalar }) => {
    const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
    useState((s) => {
      s.defScalar("deleted_record_count", { type: "BigUint" });
    });
    const undoSnackbar = useUndoSnackbar({
      successSnackbarContent: sql.concat(
        "Deleted ",
        sql`deleted_record_count`,
        " records",
      ),
      afterUndo: triggerRefetch,
    });
    return (
      <DatagridDeleteDialog
        openScalar={openScalar}
        undoSnackbar={undoSnackbar}
      />
    );
  },
};

const updateAction: SnackbarBulkAction = {
  startIcon: "Edit",
  label: "Update",
  dialog: ({ openScalar }) => {
    return (
      <BulkUpdateDialog
        open={sql.ref(openScalar)}
        onClose={(s) => s.setScalar(openScalar, false)}
      />
    );
  },
};

const exportAction: SnackbarBulkAction = {
  startIcon: "FileDownload",
  label: "Export",
  action: doExport,
};
