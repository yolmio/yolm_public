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
  body: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    "@media (min-width: 768px)": { flexDirection: "row" },
  },
  // Phone: a sheet under the drawing. Tablet and desktop: a side panel.
  panel: {
    display: "grid",
    alignContent: "start",
    gap: 1.5,
    flexShrink: 0,
    maxHeight: "42%",
    overflow: "auto",
    padding: 1.5,
    borderTop: "1px solid var(--palette-divider)",
    backgroundColor: "var(--palette-background-surface)",
    "@media (min-width: 768px)": {
      width: "300px",
      maxHeight: "none",
      borderTop: 0,
      borderLeft: "1px solid var(--palette-divider)",
    },
  },
  factGrid: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: 1.5,
    rowGap: 0.5,
    margin: 0,
    "& dd": { margin: 0, textAlign: "right", overflowWrap: "anywhere" },
  },
  listButton: {
    justifyContent: "space-between",
    width: "100%",
    minWidth: 0,
  },
  toolbarTouch: {
    display: "contents",
    "@media (pointer: coarse)": {
      "& button": { minWidth: "40px", minHeight: "40px" },
    },
  },
  // Selection and measurement float over the drawing so panels never shift.
  card: {
    position: "absolute",
    left: "8px",
    right: "8px",
    bottom: "8px",
    zIndex: 1,
    display: "grid",
    gap: 0.5,
    maxWidth: "340px",
    padding: 1.25,
    border: "1px solid var(--palette-divider)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--palette-background-surface)",
    boxShadow: "var(--shadow-md)",
  },
  statusTop: { top: "12px", bottom: "auto" },
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

function setDisplay(s: DomStatements, handle: Sql, display: Sql) {
  s.jsCall({
    module: "cad_2d_viewer",
    exportName: "setDisplay",
    handle,
    argJson: sql`json_build_object('handle', ${handle}) || ${display}`,
  });
}

function FactRows(props: { table: string; recordName: string }) {
  return (
    <dl sx={styles.factGrid}>
      <Each table={props.table} recordName={props.recordName}>
        <dt>
          <Typography level="body-xs" color="neutral">
            {sql.ref(props.recordName, "label")}
          </Typography>
        </dt>
        <dd>
          <Typography level="body-sm">
            {sql.ref(props.recordName, "value")}
          </Typography>
        </dd>
      </Each>
    </dl>
  );
}

/** One bend or bevel callout in the details panel; focuses it on tap. */
function MarkButton(props: { handle: Sql; color: "primary" | "danger" }) {
  return (
    <Button
      size="sm"
      variant="plain"
      color={props.color}
      sx={styles.listButton}
      onClick={(s) => {
        focusCad2dViewerObject(s, props.handle, sql`cad2d_mark.object_key`);
      }}
    >
      {sql`cad2d_mark.label`}
    </Button>
  );
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
        s.defScalar("cad2d_shop", false);
        s.defScalar("cad2d_shop_title", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("cad2d_units", sql.lit`in`);
        s.defScalar("cad2d_dimensions", true);
        s.defScalar("cad2d_measuring", false);
        s.defScalar("cad2d_panel_open", true);
        s.defScalar("cad2d_panel_sized", false);
        s.defScalar("cad2d_detail_title", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("cad2d_measure_text", {
          type: { type: "String", maxLength: 100 },
        });
        const labelRows = sql`select
            row.value->>'label' as label,
            row.value->>'value' as value
          from json.array_each(json_build_array()) row`;
        s.defTable("cad2d_facts", labelRows);
        s.defTable("cad2d_detail_rows", labelRows);
        s.defTable("cad2d_measure_rows", labelRows);
        s.defTable(
          "cad2d_hole_groups",
          sql`select
            row.value->>'label' as label,
            coalesce(try_cast(row.value->>'count' as int), 0) as count,
            row.value->'keys' as keys
          from json.array_each(json_build_array()) row`,
        );
        s.defTable(
          "cad2d_marks",
          sql`select
            row.value->>'key' as object_key,
            row.value->>'role' as role,
            row.value->>'label' as label
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
            "cad_2d_viewer.shopChanged": (s) => {
              const shop = sql`event.payload_json`;
              s.setScalar(
                "cad2d_shop",
                sql`coalesce(try_cast(${shop}->>'enabled' as bool), false)`,
              );
              s.setScalar("cad2d_shop_title", sql`${shop}->>'title'`);
              s.setScalar(
                "cad2d_units",
                sql`coalesce(${shop}->'display'->>'units', 'in')`,
              );
              s.setScalar(
                "cad2d_dimensions",
                sql`coalesce(try_cast(${shop}->'display'->>'dimensions' as bool), true)`,
              );
              s.setScalar(
                "cad2d_measuring",
                sql`coalesce(try_cast(${shop}->'display'->>'measuring' as bool), false)`,
              );
              // Phones open with the drawing full height; the sheet is one tap away.
              s.if(sql`not cad2d_panel_sized`, (s) => {
                s.setScalar("cad2d_panel_sized", true);
                s.setScalar(
                  "cad2d_panel_open",
                  sql`not coalesce(try_cast(${shop}->'display'->>'narrow' as bool), false)`,
                );
              });
              s.setScalar(
                "cad2d_detail_title",
                sql`${shop}->'details'->>'title'`,
              );
              s.setScalar(
                "cad2d_measure_text",
                sql`${shop}->'measure'->>'text'`,
              );
              for (
                const [table, path] of [
                  ["cad2d_facts", sql`${shop}->'facts'`],
                  ["cad2d_detail_rows", sql`${shop}->'details'->'rows'`],
                  ["cad2d_measure_rows", sql`${shop}->'measure'->'rows'`],
                ] as const
              ) {
                s.modify(sql`delete from ${sql.ref(table)}`);
                s.modify(sql`insert into ${sql.ref(table)} (label, value)
                  select row.value->>'label', row.value->>'value'
                  from json.array_each(coalesce(${path}, json_build_array())) row`);
              }
              s.modify(sql`delete from cad2d_hole_groups`);
              s.modify(sql`insert into cad2d_hole_groups (label, count, keys)
                select
                  row.value->>'label',
                  coalesce(try_cast(row.value->>'count' as int), 0),
                  row.value->'keys'
                from json.array_each(coalesce(${shop}->'holeGroups', json_build_array())) row`);
              s.modify(sql`delete from cad2d_marks`);
              s.modify(sql`insert into cad2d_marks (object_key, role, label)
                select
                  row.value->>'key',
                  row.value->>'role',
                  row.value->>'label'
                from json.array_each(coalesce(${shop}->'marks', json_build_array())) row`);
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
          <Show
            when={props.format === "dstv"
              ? sql`false`
              : sql`exists (select 1 from cad2d_layers)`}
          >
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
          <Show when={sql`cad2d_shop`}>
            <div sx={styles.toolbarTouch}>
              <IconButton
                size="sm"
                variant="outlined"
                color="neutral"
                icon="Straighten"
                aria-label="Measure distance"
                tooltip="Measure: tap two points"
                aria-pressed={sql`cad2d_measuring`}
                disabled={sql`not cad2d_ready`}
                onClick={(s) =>
                  setDisplay(
                    s,
                    handle,
                    sql`json_build_object('measuring', not cad2d_measuring)`,
                  )}
              />
              <IconButton
                size="sm"
                variant="outlined"
                color="neutral"
                icon="SquareFoot"
                aria-label="Show dimensions and callouts"
                tooltip="Dimensions and callouts"
                aria-pressed={sql`cad2d_dimensions`}
                disabled={sql`not cad2d_ready`}
                onClick={(s) =>
                  setDisplay(
                    s,
                    handle,
                    sql`json_build_object('dimensions', not cad2d_dimensions)`,
                  )}
              />
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                aria-label="Switch units"
                disabled={sql`not cad2d_ready`}
                onClick={(s) =>
                  setDisplay(
                    s,
                    handle,
                    sql`json_build_object('units', case when cad2d_units = 'mm' then 'in' else 'mm' end)`,
                  )}
              >
                {sql`case when cad2d_units = 'mm' then 'mm' else 'in' end`}
              </Button>
            </div>
          </Show>
          <div className="hidden items-center gap-1.5 sm:flex">
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
          </div>
          <div className="grow" />
          <Show when={sql`cad2d_shop`}>
            <div sx={styles.toolbarTouch}>
              <IconButton
                size="sm"
                variant="outlined"
                color="neutral"
                icon="Info"
                aria-label="Part details"
                tooltip="Part details"
                aria-pressed={sql`cad2d_panel_open`}
                onClick={(s) =>
                  s.setScalar("cad2d_panel_open", sql`not cad2d_panel_open`)}
              />
            </div>
          </Show>
          <Show when={sql`not cad2d_shop and cad2d_selected_key is not null`}>
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
        <div sx={styles.body}>
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
            <Show when={sql`cad2d_measuring and cad2d_measure_text is null`}>
              <div role="status" sx={[styles.status, styles.statusTop]}>
                <Typography level="body-sm">
                  Tap two points. Corners and hole centers snap.
                </Typography>
              </div>
            </Show>
            <Show
              when={sql`cad2d_shop and (cad2d_measure_text is not null
    or cad2d_detail_title is not null)`}
            >
              <section sx={styles.card} aria-live="polite">
                <Show
                  when={sql`cad2d_measure_text is not null`}
                  fallback={
                    <>
                      <Typography level="title-sm">
                        {sql`cad2d_detail_title`}
                      </Typography>
                      <FactRows
                        table="cad2d_detail_rows"
                        recordName="cad2d_detail_row"
                      />
                    </>
                  }
                >
                  <Typography level="title-sm" color="primary">
                    {sql`'Measured ' || cad2d_measure_text`}
                  </Typography>
                  <FactRows
                    table="cad2d_measure_rows"
                    recordName="cad2d_measure_row"
                  />
                </Show>
              </section>
            </Show>
          </main>
          <Show when={sql`cad2d_shop and cad2d_panel_open`}>
            <aside sx={styles.panel} aria-label="Part details">
              <Typography level="title-sm">{sql`cad2d_shop_title`}</Typography>
              <FactRows table="cad2d_facts" recordName="cad2d_fact" />
              <Show when={sql`exists (select 1 from cad2d_hole_groups)`}>
                <Divider />
                <Typography level="title-sm">Holes</Typography>
                <div>
                  <Each table="cad2d_hole_groups" recordName="cad2d_hole_group">
                    <Button
                      size="sm"
                      variant="plain"
                      color="neutral"
                      sx={styles.listButton}
                      endDecorator={sql`'× ' || cad2d_hole_group.count::string`}
                      onClick={(s) => {
                        s.jsCall({
                          module: "cad_2d_viewer",
                          exportName: "selectObjects",
                          handle,
                          argJson: sql`json_build_object(
                          'handle', ${handle},
                          'objectKeys', cad2d_hole_group.keys
                        )`,
                        });
                      }}
                    >
                      {sql`cad2d_hole_group.label`}
                    </Button>
                  </Each>
                </div>
              </Show>
              <Show when={sql`exists (select 1 from cad2d_marks)`}>
                <Divider />
                <Typography level="title-sm">Bends and bevels</Typography>
                <div>
                  <Each table="cad2d_marks" recordName="cad2d_mark">
                    <Show
                      when={sql`cad2d_mark.role = 'bevel'`}
                      fallback={<MarkButton handle={handle} color="primary" />}
                    >
                      <MarkButton handle={handle} color="danger" />
                    </Show>
                  </Each>
                </div>
              </Show>
            </aside>
          </Show>
        </div>
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
