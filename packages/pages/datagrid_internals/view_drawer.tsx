import { Alert } from "components/alert";
import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { CircularProgress } from "components/circular_progress";
import { DeleteRecordDialog } from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { getUniqueUiId } from "components/utils";
import { DatagridViewsICtxKey, DynamicDatagridICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr } from "../../std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { Data } from "std/data";
import { Each, Match, Show, Switch, useApp, useICtx } from "std/ui";
import type { Color } from "components/types";

const styles = createStyles({
  root: () => {
    return {
      width: 300,
      height: "100%",
      p: 2,
      display: "flex",
      flexDirection: "column",
      gap: 2,
      borderTop: "1px solid",
      borderColor: "divider",
    };
  },
  header: {
    display: "flex",
    gap: 2,
  },
  addButtons: {
    display: "flex",
    gap: 2,
    alignItems: "center",
  },
  viewsList: { mt: 2, p: 0 },
  view: {
    display: "flex",
    alignItems: "center",
    borderRadius: "sm",
    px: 3,
    py: 1,
    textDecoration: "none",
    cursor: "pointer",
    "&.active": {
      backgroundColor: "primary-100",
      dark: {
        backgroundColor: "primary-900",
      },
    },
  },
  viewName: {
    color: "text-primary",
    fontWeight: "semibold",
    fontSize: "sm",
  },
  loadingWrapper: {
    mx: "auto",
    mt: 4,
  },
  emptyText: {
    fontSize: "lg",
  },
  menu: {
    width: 180,
  },
});

const viewIdBase = getUniqueUiId();

/**
 * Trims the entered name and stops the save with a message when it is blank.
 * `db.datagrid_views.name` has no minimum length, so without this a blank name
 * saves as an unreadable row and the next blank name hits the unique
 * constraint.
 */
function returnIfViewNameBlank(s: DomStatements) {
  s.setScalar("view_name", sql`trim(view_name)`);
  s.if(sql`view_name = ''`, (s) => {
    s.setScalar("error", sql.lit`Enter a name for the view`);
    s.return();
  });
}

/**
 * Stops the save with a message when the name is already taken, so the unique
 * constraint on (name, sys_user_id, datagrid_name) does not surface as the
 * generic "Unable to save view". Scoped the same way as
 * `DatagridViewsICtx.saveCurrentAsNewView` inserts.
 */
function returnIfViewNameTaken(s: UiServerStatements, datagridName: string) {
  s.if(
    sql`exists (
      select 1 from db.datagrid_views
      where name = view_name
        and datagrid_name = ${sql.lit(datagridName)}
        and case when personal then sys_user_id = current_user else sys_user_id is null end
    )`,
    (s) => {
      s.setScalar("waiting", false);
      s.setScalar(
        "error",
        sql.lit`A view with that name already exists. Choose another name.`,
      );
      s.return();
    },
  );
}

function setViewQueryParamIfReady(s: DomStatements, closeAdding?: boolean) {
  s.if(sql`nav_view_ready`, (s) => {
    s.setQueryParam("ui.view", sql`nav_view_id`);
    if (closeAdding) {
      s.setScalar("adding", false);
    }
  });
  s.setScalar("nav_view_ready", false);
}

function Header() {
  return (
    <div sx={styles.header}>
      <Typography level="body-lg">Views</Typography>
      <Show when={sql`proc_in_progress`}>
        <CircularProgress size="sm" />
      </Show>
      <div sx={flexGrowStyles} />
      <IconButton
        size="sm"
        variant="outlined"
        aria-label={sql`case when adding then 'Cancel' else 'Add view' end`}
        onClick={(s) => s.toggle("adding")}
      >
        <Show when={sql`adding`} fallback={<MaterialIcon icon="Add" />}>
          <MaterialIcon icon="Close" />
        </Show>
      </IconButton>
    </div>
  );
}

export function AddViewModal(props: {
  open: BooleanExpr;
  onClose: (s: DomStatements) => void;
}) {
  const ctx = useICtx(DatagridViewsICtxKey);
  const { clearChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("view_name", sql.lit``);
        s.defScalar("personal", false);
        s.defScalar("waiting", false);
        s.defScalar("error", {
          type: { type: "String", maxLength: 2000 },
        });
        s.defScalar("nav_view_id", { type: "BigUint" });
        s.defScalar("nav_view_ready", false);
      }}
    >
      <ModalDialog
        open={props.open}
        onClose={props.onClose}
        style={{ width: "20vw" }}
      >
        <Typography level="title-lg" className="pb-4">
          Create new view
        </Typography>
        <Input yolmFocusKey bindScalar="view_name" />
        <Show when={sql`error is not null`}>
          <Alert color="danger">{sql`error`}</Alert>
        </Show>
        <div>
          <Checkbox
            bindScalar="personal"
            variant="outlined"
            color="primary"
            label={sql.lit`Personal`}
            size="sm"
            id={sql.concat(viewIdBase, "-personal")}
            className="pt-4 pb-4"
          />
          <div sx={flexGrowStyles} />
          <div sx={styles.addButtons}>
            <Button
              size="sm"
              variant="soft"
              color="neutral"
              onClick={(s) => s.setScalar("adding", false)}
            >
              Cancel
            </Button>
            <Button
              loading={sql`waiting`}
              size="sm"
              onClick={(s) => {
                s.setScalar("error", sql.null);
                returnIfViewNameBlank(s);
                s.setScalar("waiting", true);
                s.commitUiTreeChanges();
                s.tryServer({
                  body: (s) => {
                    returnIfViewNameTaken(s, ctx.datagridName);
                    s.startTransaction();
                    ctx.saveCurrentAsNewView(s, sql`view_name`, sql`personal`);
                    s.commitTransaction();
                    s.increment("drawer_refresh_key");
                    s.setScalar("nav_view_id", sql`view_id`);
                    s.setScalar("nav_view_ready", true);
                  },
                  catch: (s) => {
                    s.setScalar("waiting", false);
                    s.setScalar("error", sql.lit`Unable to save view`);
                    s.return();
                  },
                  finally: (s) => {
                    s.if(sql`nav_view_ready`, clearChangesInToolbar);
                    setViewQueryParamIfReady(s, true);
                    s.setScalar("waiting", false);
                  },
                });
              }}
            >
              Add View
            </Button>
          </div>
        </div>
      </ModalDialog>
    </Data>
  );
}

export function AddView() {
  const ctx = useICtx(DatagridViewsICtxKey);
  const { clearChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("view_name", sql.lit``);
        s.defScalar("personal", false);
        s.defScalar("waiting", false);
        s.defScalar("error", {
          type: { type: "String", maxLength: 2000 },
        });
        s.defScalar("nav_view_id", { type: "BigUint" });
        s.defScalar("nav_view_ready", false);
      }}
    >
      <Input yolmFocusKey bindScalar="view_name" />
      <Show when={sql`error is not null`}>
        <Alert color="danger">{sql`error`}</Alert>
      </Show>
      <div sx={styles.addButtons}>
        <Checkbox
          bindScalar="personal"
          variant="outlined"
          color="primary"
          label={sql.lit`Personal`}
          size="sm"
          id={sql.concat(viewIdBase, "-personal")}
        />
        <div sx={flexGrowStyles} />
        <Button
          size="sm"
          variant="soft"
          color="neutral"
          onClick={(s) => s.setScalar("adding", false)}
        >
          Cancel
        </Button>
        <Button
          loading={sql`waiting`}
          size="sm"
          onClick={(s) => {
            s.setScalar("error", sql.null);
            returnIfViewNameBlank(s);
            s.setScalar("waiting", true);
            s.commitUiTreeChanges();
            s.tryServer({
              body: (s) => {
                returnIfViewNameTaken(s, ctx.datagridName);
                s.startTransaction();
                ctx.saveCurrentAsNewView(s, sql`view_name`, sql`personal`);
                s.commitTransaction();
                s.increment("drawer_refresh_key");
                s.setScalar("nav_view_id", sql`view_id`);
                s.setScalar("nav_view_ready", true);
              },
              catch: (s) => {
                s.setScalar("waiting", false);
                s.setScalar("error", sql.lit`Unable to save view`);
                s.return();
              },
              finally: (s) => {
                s.if(sql`nav_view_ready`, clearChangesInToolbar);
                setViewQueryParamIfReady(s, true);
                s.setScalar("waiting", false);
              },
            });
          }}
        >
          Add View
        </Button>
      </div>
    </Data>
  );
}

function EditView() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("view_name", sql`view_record.name`);
      }}
    >
      <Input
        bindScalar="view_name"
        fullWidth
        size="sm"
        yolmFocusKey
        onClick={(s) => {
          s.event.stopPropagation();
        }}
        onBlur={(s) => {
          s.setScalar("view_name", sql`trim(view_name)`);
          s.if(sql`view_name = view_record.name or view_name = ''`, (s) => {
            s.setScalar("editing", false);
            s.return();
          });
          s.setScalar("proc_in_progress", true);
          s.setScalar("proc_error", sql.null);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.modify(
                sql`update db.datagrid_views set name = view_name where id = view_record.id`,
              );
              s.commitTransaction();
              s.increment("drawer_refresh_key");
              s.setQueryParam("ui.view", sql`view_record.id`);
            },
            catch: (s) => {
              s.setScalar(
                "proc_error",
                sql.lit`Unable to change view name at this time`,
              );
            },
          });
          s.setScalar("proc_in_progress", false);
          s.setScalar("editing", false);
        }}
        onKeyDown={(s) => {
          s.returnUnless(sql`event.key = 'Enter'`);
          s.setScalar("view_name", sql`trim(view_name)`);
          s.if(sql`view_name = view_record.name or view_name = ''`, (s) => {
            s.setScalar("editing", false);
            s.return();
          });
          s.setScalar("proc_in_progress", true);
          s.setScalar("proc_error", sql.null);
          s.commitUiTreeChanges();
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.modify(
                sql`update db.datagrid_views set name = view_name where id = view_record.id`,
              );
              s.commitTransaction();
              s.increment("drawer_refresh_key");
              s.setQueryParam("ui.view", sql`view_record.id`);
            },
            catch: (s) => {
              s.setScalar(
                "proc_error",
                sql.lit`Unable to change view name at this time`,
              );
            },
          });
          s.setScalar("proc_in_progress", false);
          s.setScalar("editing", false);
        }}
      />
    </Data>
  );
}

export function DefaultViewItem() {
  const { clearChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <li
      sx={{ ...styles.view, height: 48 }}
      onClick={(s) => {
        s.if(sql`ui.view is not null`, (s) => {
          s.setQueryParam("ui.view", sql.null);
          s.setScalar("view_popover_open", false);
        });
        clearChangesInToolbar(s);
      }}
      dynamicClass={{
        classes: "active",
        condition: sql`ui.view is null`,
      }}
    >
      <span sx={styles.viewName}>Default View</span>
    </li>
  );
}

export function ViewItem() {
  const ctx = useICtx(DatagridViewsICtxKey);
  const { clearChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("deleting", false);
        s.defScalar("editing", false);
        s.defScalar("nav_view_id", { type: "BigUint" });
        s.defScalar("nav_view_ready", false);
      }}
    >
      <li
        sx={styles.view}
        onClick={(s) => {
          s.returnIf(sql`deleting`);
          s.if(sql`ui.view is null or ui.view != view_record.id`, (s) => {
            s.setQueryParam("ui.view", sql`view_record.id`);
          });
          clearChangesInToolbar(s);
        }}
        dynamicClass={{
          classes: "active",
          condition: sql`view_record.id = view`,
        }}
      >
        <Show when={sql`not editing`} fallback={<EditView />}>
          <span sx={styles.viewName}>{sql`view_record.name`}</span>
          <div sx={flexGrowStyles} />
          <Show when={sql`view_record.is_personal`}>
            <MaterialIcon icon="PersonOutline" />
          </Show>
          <Menu>
            <Menu.IconButton
              variant="plain"
              color={"neutral" as Color}
              aria-label="Open Actions Menu"
              icon="MoreVert"
              onClick={(s) => {
                s.event.stopPropagation();
              }}
            />
            <Menu.Content>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("editing", true);
                }}
              >
                Rename
              </Menu.Item>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("proc_in_progress", true);
                  s.setScalar("proc_error", sql.null);
                  s.commitUiTreeChanges();
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      ctx.duplicateView(s, sql`view_record.id`);
                      s.commitTransaction();
                      s.increment("drawer_refresh_key");
                      s.setScalar("nav_view_id", sql`new_view_id`);
                      s.setScalar("nav_view_ready", true);
                    },
                    catch: (s) => {
                      s.setScalar(
                        "proc_error",
                        sql.lit`Unable to duplicate view at this time`,
                      );
                    },
                    finally: (s) => {
                      setViewQueryParamIfReady(s);
                      s.setScalar("proc_in_progress", false);
                    },
                  });
                }}
              >
                Duplicate
              </Menu.Item>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("proc_in_progress", true);
                  s.setScalar("proc_error", sql.null);
                  s.commitUiTreeChanges();
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      ctx.saveCurrentToExistingView(s, sql`view_record.id`);
                      s.commitTransaction();
                      s.increment("drawer_refresh_key");
                      s.setQueryParam("ui.view", sql`view_record.id`);
                    },
                    errorName: "caught_error",
                    catch: (s) => {
                      s.setScalar("proc_error", sql.lit`Error saving view`);
                    },
                  });
                  s.setScalar("proc_in_progress", false);
                }}
              >
                Save to
              </Menu.Item>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("deleting", true);
                }}
              >
                Delete
              </Menu.Item>
            </Menu.Content>
          </Menu>
          {/*Example_DeleteRecordDialog_Start*/}
          <DeleteRecordDialog
            bindScalar="deleting"
            table="datagrid_views"
            recordId={sql`view_record.id`}
            afterTransactionCommit={(s) => {
              s.if(sql`view_record.id = ui.view`, (s) => {
                s.setQueryParam("ui.view", sql.null);
              });
              s.increment("drawer_refresh_key");
            }}
            description={sql.concat(
              "Are you sure you want to delete ",
              sql`view_record.name`,
              "?",
            )}
          />
          {/*Example_DeleteRecordDialog_End*/}
        </Show>
      </li>
    </Data>
  );
}

export function NewViewItem() {
  const ctx = useICtx(DatagridViewsICtxKey);
  const { clearChangesInToolbar } = useICtx(DynamicDatagridICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("deleting", false);
        s.defScalar("editing", false);
        s.defScalar("nav_view_id", { type: "BigUint" });
        s.defScalar("nav_view_ready", false);
      }}
    >
      <li
        sx={styles.view}
        onClick={(s) => {
          s.returnIf(sql`deleting`);
          s.if(sql`ui.view is null or ui.view != view_record.id`, (s) => {
            s.setQueryParam("ui.view", sql`view_record.id`);
            s.setScalar("view_popover_open", false);
          });
          clearChangesInToolbar(s);
        }}
        dynamicClass={{
          classes: "active",
          condition: sql`view_record.id = view`,
        }}
      >
        <Show when={sql`not editing`} fallback={<EditView />}>
          <span sx={styles.viewName}>{sql`view_record.name`}</span>
          <div sx={flexGrowStyles} />
          <Show when={sql`view_record.is_personal`}>
            <MaterialIcon icon="PersonOutline" />
          </Show>
          <Menu>
            <Menu.IconButton
              variant="plain"
              color={"neutral" as Color}
              aria-label="Open Actions Menu"
              icon="MoreVert"
              onClick={(s) => {
                s.event.stopPropagation();
              }}
            />
            <Menu.Content>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("editing", true);
                }}
              >
                Rename
              </Menu.Item>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("proc_in_progress", true);
                  s.setScalar("proc_error", sql.null);
                  s.commitUiTreeChanges();
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      ctx.duplicateView(s, sql`view_record.id`);
                      s.commitTransaction();
                      s.increment("drawer_refresh_key");
                      s.setScalar("nav_view_id", sql`new_view_id`);
                      s.setScalar("nav_view_ready", true);
                    },
                    catch: (s) => {
                      s.setScalar(
                        "proc_error",
                        sql.lit`Unable to duplicate view at this time`,
                      );
                    },
                    finally: (s) => {
                      setViewQueryParamIfReady(s);
                      s.setScalar("proc_in_progress", false);
                    },
                  });
                }}
              >
                Duplicate
              </Menu.Item>
              <Menu.Item
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("deleting", true);
                }}
              >
                Delete
              </Menu.Item>
            </Menu.Content>
          </Menu>
          {/*Example_DeleteRecordDialog_Start*/}
          <DeleteRecordDialog
            bindScalar="deleting"
            table="datagrid_views"
            recordId={sql`view_record.id`}
            afterTransactionCommit={(s) => {
              s.if(sql`view_record.id = ui.view`, (s) => {
                s.setQueryParam("ui.view", sql.null);
              });
              s.increment("drawer_refresh_key");
            }}
            description={sql.concat(
              "Are you sure you want to delete ",
              sql`view_record.name`,
              "?",
            )}
          />
          {/*Example_DeleteRecordDialog_End*/}
        </Show>
      </li>
    </Data>
  );
}

function DrawerContent() {
  const app = useApp();
  const ctx = useICtx(DatagridViewsICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("drawer_refresh_key", 0);
        s.defScalar("adding", false);
        s.defScalar("proc_error", {
          type: { type: "String", maxLength: 2000 },
        });
        s.defScalar("proc_in_progress", false);
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
        <div sx={styles.root()}>
          <Header />
          <Show when={sql`adding`}>
            <AddView />
          </Show>
          <Divider />
          <Show when={sql`proc_error is not null`}>
            <Alert color="danger">{sql`proc_error`}</Alert>
          </Show>
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
                <Each
                  table="datagrid_views"
                  eachKey={sql`id`}
                  recordName="view_record"
                >
                  <ViewItem />
                </Each>
              </ul>
            </Match>
            <Match when>
              <Typography level="body-sm">No views</Typography>
            </Match>
          </Switch>
        </div>
      </Data>
    </Data>
  );
}

export function ViewDrawer() {
  return (
    <Show when={sql`view_drawer_open`}>
      <DrawerContent />
    </Show>
  );
}
