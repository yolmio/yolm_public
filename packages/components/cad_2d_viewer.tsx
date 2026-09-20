import { Alert } from "./alert";
import { Button } from "./button";
import { ButtonGroup } from "./button_group";
import { Divider } from "./divider";
import { IconButton } from "./icon_button";
import { Input } from "./input";
import { Menu } from "./menu";
import { Typography } from "./typography";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { createStyles } from "std/style_utils";
import { Each, Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";

export interface Cad2dViewerEvent {
  handle: Sql;
  payload: Sql;
}

export type Cad2dViewerEventHandler = (
  s: DomStatements,
  event: Cad2dViewerEvent,
) => void;

export interface Cad2dViewerProps {
  fileUrl: Sql | string;
  fileName: Sql | string;
  format: "dwg" | "dxf" | "dstv";
  handle?: Sql | string;
  height?: string;
  className?: string;
  moduleAssetUrl?: string;
  initialObjectKey?: Sql;
  toolbarLeading?: Node;
  onReady?: Cad2dViewerEventHandler;
  onSelectionChange?: Cad2dViewerEventHandler;
  onError?: Cad2dViewerEventHandler;
}

const styles = createStyles({
  frame: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    border: "1px solid var(--palette-divider)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--palette-background-surface)",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 0.75,
    minHeight: "42px",
    paddingX: 1,
    borderBottom: "1px solid var(--palette-divider)",
  },
  layerPopover: {
    width: "min(360px, calc(100vw - 24px))",
    maxHeight: "min(420px, 70vh)",
    overflow: "hidden",
    gap: 1,
    padding: 1,
    margin: 0,
    border: "1px solid var(--palette-divider)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--palette-background-popup)",
    boxShadow: "var(--shadow-md)",
    zIndex: 1400,
    "&:popover-open": {
      display: "grid",
    },
  },
  layerList: {
    display: "grid",
    minHeight: 0,
    overflow: "auto",
  },
  layerButton: {
    justifyContent: "flex-start",
    minWidth: 0,
    width: "100%",
    overflow: "hidden",
  },
  layerName: {
    display: "block",
    flexGrow: 1,
    minWidth: 0,
    width: "100%",
    overflow: "hidden",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  layerRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 0.5,
  },
  viewport: {
    position: "relative",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: "var(--palette-background-level1)",
  },
  mount: {
    position: "absolute",
    inset: 0,
  },
  status: {
    position: "absolute",
    left: "50%",
    bottom: "16px",
    zIndex: 1,
    transform: "translateX(-50%)",
    padding: "6px 10px",
    border: "1px solid var(--palette-divider)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--palette-background-surface)",
  },
});

function toSql(value: Sql | string): Sql {
  return typeof value === "string" ? sql.lit(value) : value;
}

function viewerEvent(handle: Sql): Cad2dViewerEvent {
  return { handle, payload: sql`event.payload_json` };
}

function command(
  handle: Sql,
  exportName: string,
  extra: Sql = sql`json_build_object()`,
) {
  return (s: DomStatements) => {
    s.jsCall({
      module: "cad_2d_viewer",
      exportName,
      handle,
      argJson: sql`json_build_object('handle', ${handle}) || ${extra}`,
    });
  };
}

function setAllLayers(
  s: DomStatements,
  handle: Sql,
  visible: boolean,
) {
  s.jsCall({
    module: "cad_2d_viewer",
    exportName: "setLayerVisibilityBatch",
    handle,
    argJson: sql`json_build_object(
      'handle', ${handle},
      'layers', coalesce(
        (
          select json_array_agg(
            json_build_object('name', name, 'visible', ${visible})
            order by name
          )
          from cad2d_layers
        ),
        json_build_array()
      )
    )`,
  });
  s.modify(sql`update cad2d_layers set visible = ${visible}`);
}

function isolateLayer(s: DomStatements, handle: Sql, layer: Sql) {
  s.jsCall({
    module: "cad_2d_viewer",
    exportName: "setLayerVisibilityBatch",
    handle,
    argJson: sql`json_build_object(
      'handle', ${handle},
      'layers', coalesce(
        (
          select json_array_agg(
            json_build_object('name', name, 'visible', name = ${layer})
            order by name
          )
          from cad2d_layers
        ),
        json_build_array()
      )
    )`,
  });
  s.modify(sql`update cad2d_layers set visible = (name = ${layer})`);
}

export function Cad2dViewer(props: Cad2dViewerProps) {
  useJsModule("cad_2d_viewer", { assetUrl: props.moduleAssetUrl });
  const id = useUniqueId();
  const layerButtonId = sql.concat(id, sql.lit`-cad-2d-layers-button`);
  const layerPopoverId = sql.concat(id, sql.lit`-cad-2d-layers-popover`);
  const fitLabel = props.format === "dstv"
    ? "Fit operations"
    : props.format === "dxf"
    ? "Fit geometry"
    : "Fit drawing";
  const layerLabel = props.format === "dstv" ? "Operation layers" : "Layers";
  const handle = props.handle
    ? (typeof props.handle === "string" ? sql.lit(props.handle) : props.handle)
    : sql.concat(id, sql.lit`-cad-2d-viewer`);
  const mountId = sql.concat(id, sql.lit`-cad-2d-mount`);
  const objectKey = props.initialObjectKey ?? sql.lit``;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("cad2d_ready", false);
        s.defScalar("cad2d_layers_open", false);
        s.defScalar("cad2d_layer_search", sql.lit``);
        s.defScalar("cad2d_view_key", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("cad2d_error", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("cad2d_selected_key", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("cad2d_selected_type", {
          type: { type: "String", maxLength: 100 },
        });
        s.defScalar("cad2d_selected_layer", {
          type: { type: "String", maxLength: 500 },
        });
        s.defTable(
          "cad2d_layers",
          sql`select
            row.value->>'name' as name,
            coalesce(try_cast(row.value->>'visible' as bool), true) as visible
          from json.array_each(json_build_array()) row`,
        );
        s.defTable(
          "cad2d_layouts",
          sql`select
            row.value->>'viewKey' as view_key,
            coalesce(row.value->>'name', row.value->>'viewKey') as name
          from json.array_each(json_build_array()) row`,
        );
      }}
    >
      <div
        sx={[styles.frame, { height: props.height ?? "min(780px, 80vh)" }]}
        className={props.className}
        js={{
          handles: [{
            module: "cad_2d_viewer",
            cleanup: "cleanup",
            handle,
          }],
          on: {
            "cad_2d_viewer.ready": (s) => {
              s.setScalar("cad2d_ready", true);
              s.setScalar("cad2d_error", sql.null);
              s.modify(sql`delete from cad2d_layers`);
              s.modify(sql`insert into cad2d_layers (name, visible)
                select
                  row.value->>'name',
                  coalesce(try_cast(row.value->>'visible' as bool), true)
                from json.array_each(event.payload_json->'layers') row`);
              s.modify(sql`delete from cad2d_layouts`);
              s.modify(sql`insert into cad2d_layouts (view_key, name)
                select
                  row.value->>'viewKey',
                  coalesce(row.value->>'name', row.value->>'viewKey')
                from json.array_each(event.payload_json->'layouts') row`);
              s.setScalar("cad2d_view_key", sql.null);
              s.if(sql`exists (select 1 from cad2d_layouts)`, (s) => {
                s.setScalar(
                  "cad2d_view_key",
                  sql`(
                    select view_key
                    from cad2d_layouts
                    order by
                      case
                        when view_key = event.payload_json->>'defaultViewKey' then 0
                        when lower(name) = 'model' then 1
                        else 2
                      end,
                      __row_id
                    limit 1
                  )`,
                );
                s.jsCall({
                  module: "cad_2d_viewer",
                  exportName: "setView",
                  handle,
                  argJson: sql`json_build_object(
                    'handle', ${handle},
                    'viewKey', cad2d_view_key
                  )`,
                });
              });
              s.setScalar(
                "cad2d_selected_key",
                sql`event.payload_json->'selected'->>'objectKey'`,
              );
              if (props.onReady) props.onReady(s, viewerEvent(handle));
            },
            "cad_2d_viewer.selectionChanged": (s) => {
              s.setScalar(
                "cad2d_selected_key",
                sql`event.payload_json->'selected'->>'objectKey'`,
              );
              s.setScalar(
                "cad2d_selected_type",
                sql`event.payload_json->'selected'->>'type'`,
              );
              s.setScalar(
                "cad2d_selected_layer",
                sql`event.payload_json->'selected'->>'layer'`,
              );
              if (props.onSelectionChange) {
                props.onSelectionChange(s, viewerEvent(handle));
              }
            },
            "cad_2d_viewer.stateChanged": (s) => {
              s.setScalar("cad2d_error", sql.null);
              s.setScalar(
                "cad2d_view_key",
                sql`event.payload_json->>'viewKey'`,
              );
            },
            "cad_2d_viewer.error": (s) => {
              s.setScalar("cad2d_ready", false);
              s.setScalar(
                "cad2d_error",
                sql`coalesce(
                  event.payload_json->>'message',
                  'Unable to open the CAD drawing.'
                )`,
              );
              if (props.onError) props.onError(s, viewerEvent(handle));
            },
          },
        }}
      >
        <div sx={styles.toolbar}>
          {props.toolbarLeading}
          <Show when={sql`exists (select 1 from cad2d_layouts)`}>
            <Menu>
              <Menu.Button
                size="sm"
                variant="outlined"
                color="neutral"
                endIcon="ArrowDropDown"
                disabled={sql`not cad2d_ready`}
              >
                {sql`
                  case
                    when ${sql.lit(props.format)} = 'dstv' then
                      'Face: ' || coalesce(
                        (select name from cad2d_layouts where view_key = cad2d_view_key),
                        'All'
                      )
                    when lower(coalesce(
                      (select name from cad2d_layouts where view_key = cad2d_view_key),
                      'model'
                    )) = 'model' then 'Model'
                    else 'Sheet: ' || coalesce(
                      (select name from cad2d_layouts where view_key = cad2d_view_key),
                      'Drawing'
                    )
                  end
                `}
              </Menu.Button>
              <Menu.Content floating={{ placement: "bottom-start" }}>
                <Each table="cad2d_layouts" recordName="cad2d_layout">
                  <Menu.Item
                    onClick={(s) => {
                      s.setScalar(
                        "cad2d_view_key",
                        sql`cad2d_layout.view_key`,
                      );
                      s.jsCall({
                        module: "cad_2d_viewer",
                        exportName: "setView",
                        handle,
                        argJson: sql`json_build_object(
                          'handle', ${handle},
                          'viewKey', cad2d_layout.view_key
                        )`,
                      });
                    }}
                  >
                    {sql`case
                      when cad2d_view_key = cad2d_layout.view_key then '✓ '
                      else ''
                    end || cad2d_layout.name`}
                  </Menu.Item>
                </Each>
              </Menu.Content>
            </Menu>
          </Show>
          <Show when={sql`exists (select 1 from cad2d_layers)`}>
            <Button
              id={layerButtonId}
              size="sm"
              variant="outlined"
              color="neutral"
              endIcon="ArrowDropDown"
              aria-haspopup="true"
              aria-expanded={sql`cad2d_layers_open`}
              aria-controls={sql`case when cad2d_layers_open then ${layerPopoverId} end`}
              disabled={sql`not cad2d_ready`}
              onClick={(s) => {
                s.setScalar("cad2d_layers_open", sql`not cad2d_layers_open`);
              }}
            >
              {sql`${sql.lit(layerLabel)} || ' ' ||
                (select count(*)::string from cad2d_layers)`}
            </Button>
            <div
              id={layerPopoverId}
              role="dialog"
              aria-label={`${layerLabel} controls`}
              sx={styles.layerPopover}
              tabIndex={-1}
              popover="auto"
              yolmPopoverShowing={sql`cad2d_layers_open`}
              floating={{
                anchorEl: layerButtonId,
                placement: "bottom-start",
                strategy: "fixed",
                shift: { mainAxis: true, crossAxis: true },
                offset: { mainAxis: 4, crossAxis: 0 },
                flip: { mainAxis: false, crossAxis: false },
              }}
              onToggleHide={(s) => {
                s.setScalar("cad2d_layers_open", false);
              }}
            >
              <div className="flex items-center gap-2">
                <Typography level="title-sm">{layerLabel}</Typography>
                <div className="grow" />
                <Typography level="body-xs" color="neutral">
                  {sql`(select count(*) from cad2d_layers where visible)::string ||
                    ' of ' || (select count(*) from cad2d_layers)::string`}
                </Typography>
              </div>
              <Input
                size="sm"
                value={sql`cad2d_layer_search`}
                placeholder="Search layers…"
                aria-label={`Search ${layerLabel.toLowerCase()}`}
                startIcon="Search"
                fullWidth
                onInput={(s) => {
                  s.setScalar("cad2d_layer_search", sql`target_value`);
                }}
              />
              <ButtonGroup size="xs" buttonFlex={1}>
                <Button onClick={(s) => setAllLayers(s, handle, true)}>
                  Show all
                </Button>
                <Button onClick={(s) => setAllLayers(s, handle, false)}>
                  Hide all
                </Button>
              </ButtonGroup>
              <Divider />
              <div sx={styles.layerList}>
                <Each
                  table="cad2d_layers"
                  recordName="cad2d_layer"
                  where={sql`trim(cad2d_layer_search) = '' or
                    lower(cad2d_layer.name) like
                      '%' || lower(trim(cad2d_layer_search)) || '%'`}
                  orderBy={sql`cad2d_layer.name`}
                >
                  <div sx={styles.layerRow}>
                    <Button
                      size="sm"
                      variant="plain"
                      color="neutral"
                      sx={styles.layerButton}
                      aria-pressed={sql`cad2d_layer.visible`}
                      title={sql`cad2d_layer.name`}
                      onClick={(s) => {
                        s.jsCall({
                          module: "cad_2d_viewer",
                          exportName: "setLayerVisibility",
                          handle,
                          argJson: sql`json_build_object(
                            'handle', ${handle},
                            'layer', cad2d_layer.name,
                            'visible', not cad2d_layer.visible
                          )`,
                        });
                        s.modify(sql`update cad2d_layers
                          set visible = not visible
                          where name = cad2d_layer.name`);
                      }}
                    >
                      <span sx={styles.layerName}>
                        {sql`case when cad2d_layer.visible then '● ' else '○ ' end
                          || cad2d_layer.name`}
                      </span>
                    </Button>
                    <Button
                      size="xs"
                      variant="plain"
                      color="neutral"
                      aria-label={sql`'Isolate ' || cad2d_layer.name`}
                      onClick={(s) => {
                        isolateLayer(s, handle, sql`cad2d_layer.name`);
                      }}
                    >
                      Only
                    </Button>
                  </div>
                </Each>
              </div>
            </div>
          </Show>
          <Show
            when={sql`exists (select 1 from cad2d_layouts)
              or exists (select 1 from cad2d_layers)`}
          >
            <Divider orientation="vertical" />
          </Show>
          <IconButton
            size="sm"
            variant="outlined"
            color="neutral"
            icon="FitScreen"
            aria-label={fitLabel}
            tooltip={fitLabel}
            disabled={sql`not cad2d_ready`}
            onClick={command(handle, "fit")}
          />
          <IconButton
            size="sm"
            variant="outlined"
            color="neutral"
            icon="Add"
            aria-label="Zoom in"
            tooltip="Zoom in"
            disabled={sql`not cad2d_ready`}
            onClick={command(
              handle,
              "zoom",
              sql`json_build_object('factor', 1.25)`,
            )}
          />
          <IconButton
            size="sm"
            variant="outlined"
            color="neutral"
            icon="Remove"
            aria-label="Zoom out"
            tooltip="Zoom out"
            disabled={sql`not cad2d_ready`}
            onClick={command(
              handle,
              "zoom",
              sql`json_build_object('factor', 0.8)`,
            )}
          />
          <div className="grow" />
          <Show when={sql`cad2d_selected_key is not null`}>
            <div className="min-w-0 text-right">
              <Typography level="body-sm">
                {sql`cad2d_selected_key`}
              </Typography>
              <Typography level="body-xs" color="neutral">
                {sql`coalesce(cad2d_selected_type, 'object') || ' · ' ||
                  coalesce(cad2d_selected_layer, '0')`}
              </Typography>
            </div>
          </Show>
        </div>
        <Show when={sql`cad2d_error is not null`}>
          <Alert color="danger" variant="soft" className="m-2">
            {sql`cad2d_error`}
          </Alert>
        </Show>
        <main sx={styles.viewport} aria-label="2D CAD viewport">
          <div
            id={mountId}
            sx={styles.mount}
            onMount={(s) => {
              s.jsCall({
                module: "cad_2d_viewer",
                exportName: "initialize",
                handle,
                argJson: sql`json_build_object(
                    'handle', ${handle},
                    'elementId', ${mountId},
                    'fileUrl', ${toSql(props.fileUrl)},
                    'fileName', ${toSql(props.fileName)},
                    'format', ${sql.lit(props.format)},
                    'objectKey', nullif(trim(${objectKey}), '')
                  )`,
              });
            }}
          />
          <Show when={sql`not cad2d_ready and cad2d_error is null`}>
            <div role="status" sx={styles.status}>
              <Typography level="body-sm">Preparing drawing…</Typography>
            </div>
          </Show>
        </main>
      </div>
    </Data>
  );
}

export function focusCad2dViewerObject(
  s: DomStatements,
  handle: Sql,
  objectKey: Sql,
) {
  s.jsCall({
    module: "cad_2d_viewer",
    exportName: "focusObject",
    handle,
    argJson: sql`json_build_object(
      'handle', ${handle},
      'objectKey', ${objectKey}
    )`,
  });
}
