import { Alert } from "./alert";
import { Button } from "./button";
import { ButtonGroup } from "./button_group";
import { Divider } from "./divider";
import { IconButton } from "./icon_button";
import { Input } from "./input";
import { MaterialIcon } from "./material_icon";
import { Slider } from "./slider";
import { Typography } from "./typography";
import { Data } from "std/data";
import { getModuleFileUrl, useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { createStyles } from "std/style_utils";
import { Each, Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";

export type GlbViewerProjection = "perspective" | "orthographic";
export type GlbViewerView =
  | "isometric"
  | "front"
  | "back"
  | "right"
  | "left"
  | "top"
  | "bottom";

export interface GlbViewerEvent {
  handle: Sql;
  payload: Sql;
}

export type GlbViewerEventHandler = (
  s: DomStatements,
  event: GlbViewerEvent,
) => void;

export interface GlbViewerProps {
  fileUrl: Sql | string;
  fileName?: Sql | string;
  handle?: Sql | string;
  height?: string;
  className?: string;
  moduleAssetUrl?: string;
  /** URL of the sibling Draco WASM decoder; defaults to the module sidecar. */
  dracoDecoderUrl?: string;
  backgroundColor?: string;
  initialProjection?: GlbViewerProjection;
  initialEdges?: boolean;
  maxBytes?: NumericExpr | number;
  /** Platform-shaped semantic index JSON joined to GLB node names by key. */
  modelIndexJson?: Sql | string;
  /** Initial cad_interact action/result envelopes used to enrich GLB identity. */
  initialCadInteractionsJson?: Sql | string;
  showToolbar?: boolean;
  showModelTree?: boolean;
  showInspector?: boolean;
  allowDownload?: boolean;
  /** Optional format-specific label for the model-browser toolbar control. */
  browserLabel?: string;
  toolbarLeading?: Node;
  onReady?: GlbViewerEventHandler;
  onSelectionChange?: GlbViewerEventHandler;
  onError?: GlbViewerEventHandler;
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
    gap: 1,
    padding: 1,
    borderBottom: "1px solid var(--palette-divider)",
    backgroundColor: "var(--palette-background-surface)",
  },
  workspace: {
    display: "flex",
    flexGrow: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: "0 0 22%",
    minWidth: "224px",
    maxWidth: "256px",
    minHeight: 0,
    backgroundColor: "var(--palette-background-surface)",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    minHeight: "38px",
    paddingX: 1.5,
    borderBottom: "1px solid var(--palette-divider)",
  },
  tree: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    paddingY: 0.5,
  },
  browserControls: {
    display: "grid",
    gap: 1,
    padding: 1,
    borderBottom: "1px solid var(--palette-divider)",
  },
  semanticRow: {
    display: "grid",
    gap: 0.25,
    width: "100%",
    padding: "7px 10px",
    border: 0,
    borderBottom: "1px solid var(--palette-divider)",
    background: "transparent",
    color: "var(--palette-text-primary)",
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
    "&:hover": {
      backgroundColor: "var(--palette-neutral-soft-hover-bg)",
    },
    "&[aria-selected='true']": {
      backgroundColor: "var(--palette-primary-soft-bg)",
    },
  },
  semanticMeta: {
    display: "flex",
    alignItems: "center",
    gap: 0.75,
    minWidth: 0,
    color: "var(--palette-text-secondary)",
    fontSize: "var(--text-xs)",
  },
  semanticBadge: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "18px",
    paddingX: 0.75,
    borderRadius: "var(--radius-xs)",
    backgroundColor: "var(--palette-neutral-soft-bg)",
    color: "var(--palette-neutral-soft-color)",
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.02em",
  },
  treeRow: {
    display: "flex",
    alignItems: "center",
    gap: 0.75,
    width: "100%",
    minHeight: "30px",
    paddingRight: 1,
    border: 0,
    background: "transparent",
    color: "var(--palette-text-primary)",
    cursor: "pointer",
    font: "inherit",
    fontSize: "var(--text-sm)",
    textAlign: "left",
    "&:hover": {
      backgroundColor: "var(--palette-neutral-soft-hover-bg)",
    },
    "&[aria-pressed='true']": {
      backgroundColor: "var(--palette-primary-soft-bg)",
      color: "var(--palette-primary-soft-color)",
    },
    "&:focus-visible": {
      outline: "2px solid var(--palette-focus-visible)",
      outlineOffset: "-2px",
    },
  },
  viewport: {
    position: "relative",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: "var(--palette-background-level1)",
  },
  mount: {
    position: "absolute",
    inset: 0,
  },
  loading: {
    position: "absolute",
    left: "50%",
    bottom: "20px",
    zIndex: 1,
    minWidth: "220px",
    transform: "translateX(-50%)",
    padding: "8px 12px",
    border: "1px solid var(--palette-divider)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--palette-background-surface)",
    boxShadow: "var(--shadow-md)",
    textAlign: "center",
  },
  inspectorBody: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "auto",
    padding: 1.5,
  },
  inspectorSection: {
    display: "grid",
    gap: 1,
    paddingBottom: 1.5,
    marginBottom: 1.5,
    borderBottom: "1px solid var(--palette-divider)",
  },
  propertyGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(72px, auto) minmax(0, 1fr)",
    gap: "6px 10px",
    fontSize: "var(--text-xs)",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    gap: 1,
  },
});

function toSql(value: Sql | string | number | undefined, fallback: string) {
  if (value === undefined) return sql.lit(fallback);
  if (typeof value === "string") return sql.lit(value);
  if (typeof value === "number") return sql`${value}`;
  return value;
}

function toJsonSql(value: Sql | string | undefined) {
  if (value === undefined) return sql.null;
  return typeof value === "string"
    ? sql`try_cast(${sql.lit(value)} as json)`
    : value;
}

function formatSelectedCadLength(value: Sql) {
  return sql`trim(
    round(${value}, 3)::string || ' ' ||
    case lower(coalesce(selected_source_unit, ''))
      when 'millimeter' then 'mm'
      when 'millimeters' then 'mm'
      when 'millimetre' then 'mm'
      when 'millimetres' then 'mm'
      when 'centimeter' then 'cm'
      when 'centimeters' then 'cm'
      when 'centimetre' then 'cm'
      when 'centimetres' then 'cm'
      when 'meter' then 'm'
      when 'meters' then 'm'
      when 'metre' then 'm'
      when 'metres' then 'm'
      when 'inch' then 'in'
      when 'inches' then 'in'
      when 'foot' then 'ft'
      when 'feet' then 'ft'
      else coalesce(selected_source_unit, '')
    end
  )`;
}

function createGlbViewerEvent(handle: Sql): GlbViewerEvent {
  return { handle, payload: sql`event.payload_json` };
}

function viewerCommand(
  handle: Sql,
  exportName: string,
  argJson: Sql = sql`json_build_object('handle', ${handle})`,
) {
  return (s: DomStatements) => {
    s.jsCall({
      module: "glb_viewer",
      exportName,
      handle,
      argJson,
    });
  };
}

function setView(handle: Sql, view: GlbViewerView) {
  return viewerCommand(
    handle,
    "setView",
    sql`json_build_object('handle', ${handle}, 'view', ${sql.lit(view)})`,
  );
}

function setSection(s: DomStatements, handle: Sql) {
  s.jsCall({
    module: "glb_viewer",
    exportName: "setSection",
    handle,
    argJson: sql`json_build_object(
      'handle', ${handle},
      'enabled', section_enabled,
      'axis', section_axis,
      'offset', section_offset,
      'reverse', section_reverse
    )`,
  });
}

function updateViewerState(s: DomStatements) {
  s.setScalar(
    "glb_ready",
    sql`coalesce(try_cast(event.payload_json->>'ready' as bool), glb_ready)`,
  );
  s.setScalar(
    "projection",
    sql`coalesce(event.payload_json->>'projection', projection)`,
  );
  s.setScalar(
    "current_view",
    sql`coalesce(event.payload_json->>'view', current_view)`,
  );
  s.setScalar(
    "edges_enabled",
    sql`coalesce(try_cast(event.payload_json->>'edges' as bool), edges_enabled)`,
  );
  s.setScalar(
    "explode_factor",
    sql`coalesce(try_cast(event.payload_json->>'explodeFactor' as double), explode_factor)`,
  );
  s.setScalar(
    "section_enabled",
    sql`coalesce(try_cast(event.payload_json->'section'->>'enabled' as bool), section_enabled)`,
  );
  s.setScalar(
    "section_axis",
    sql`coalesce(event.payload_json->'section'->>'axis', section_axis)`,
  );
  s.setScalar(
    "section_offset",
    sql`coalesce(try_cast(event.payload_json->'section'->>'offset' as double), section_offset)`,
  );
  s.setScalar(
    "section_reverse",
    sql`coalesce(try_cast(event.payload_json->'section'->>'reverse' as bool), section_reverse)`,
  );
  s.setScalar(
    "measurement_mode",
    sql`coalesce(try_cast(event.payload_json->>'measurementMode' as bool), measurement_mode)`,
  );
  s.setScalar(
    "measurement_distance",
    sql`try_cast(event.payload_json->'measurement'->>'distance' as double)`,
  );
  s.setScalar(
    "hidden_count",
    sql`coalesce(try_cast(event.payload_json->>'hiddenCount' as bigint), hidden_count)`,
  );
  s.setScalar(
    "isolated",
    sql`event.payload_json->>'isolated' is not null`,
  );
  s.setScalar("selected_key", sql`event.payload_json->'selected'->>'key'`);
  s.setScalar("selected_name", sql`event.payload_json->'selected'->>'name'`);
  s.setScalar("selected_kind", sql`event.payload_json->'selected'->>'kind'`);
  s.setScalar(
    "selected_definition_key",
    sql`event.payload_json->'selected'->'semantic'->>'definitionKey'`,
  );
  s.setScalar(
    "selected_object_key",
    sql`event.payload_json->'selected'->'semantic'->>'objectKey'`,
  );
  s.setScalar(
    "selected_semantic_name",
    sql`event.payload_json->'selected'->'semantic'->>'displayName'`,
  );
  s.setScalar(
    "selected_classification",
    sql`event.payload_json->'selected'->'semantic'->>'classification'`,
  );
  s.setScalar(
    "selected_designation",
    sql`event.payload_json->'selected'->'semantic'->>'designation'`,
  );
  s.setScalar(
    "selected_shape_type",
    sql`event.payload_json->'selected'->'semantic'->>'shapeType'`,
  );
  s.setScalar(
    "selected_material",
    sql`event.payload_json->'selected'->'semantic'->>'materialDesignation'`,
  );
  s.setScalar(
    "selected_source_unit",
    sql`event.payload_json->'selected'->'semantic'->>'sourceUnit'`,
  );
  for (const field of ["length", "width", "depth", "thickness"] as const) {
    s.setScalar(
      `selected_${field}`,
      sql`try_cast(event.payload_json->'selected'->'semantic'->>${
        sql.lit(field)
      } as double)`,
    );
  }
  s.setScalar(
    "selected_match_confidence",
    sql`try_cast(event.payload_json->'selected'->'semantic'->>'confidence' as double)`,
  );
  s.setScalar(
    "selected_hole_count",
    sql`try_cast(event.payload_json->'selected'->'semantic'->>'holeCount' as bigint)`,
  );
  s.setScalar(
    "selected_bevel_count",
    sql`try_cast(event.payload_json->'selected'->'semantic'->>'bevelCount' as bigint)`,
  );
  s.setScalar(
    "selected_occurrence_count",
    sql`try_cast(event.payload_json->'selected'->'semantic'->>'occurrenceCount' as bigint)`,
  );
  s.setScalar(
    "selected_mesh_count",
    sql`try_cast(event.payload_json->'selected'->>'meshCount' as bigint)`,
  );
  s.setScalar(
    "selected_triangle_count",
    sql`try_cast(event.payload_json->'selected'->>'triangleCount' as bigint)`,
  );
  s.setScalar(
    "selected_size_x",
    sql`try_cast(event.payload_json->'selected'->'bounds'->'size'->>0 as double)`,
  );
  s.setScalar(
    "selected_size_y",
    sql`try_cast(event.payload_json->'selected'->'bounds'->'size'->>1 as double)`,
  );
  s.setScalar(
    "selected_size_z",
    sql`try_cast(event.payload_json->'selected'->'bounds'->'size'->>2 as double)`,
  );
  s.setScalar(
    "scene_node_count",
    sql`coalesce(try_cast(event.payload_json->'summary'->>'nodeCount' as bigint), scene_node_count)`,
  );
  s.setScalar(
    "model_mesh_count",
    sql`coalesce(try_cast(event.payload_json->'summary'->>'meshCount' as bigint), model_mesh_count)`,
  );
  s.setScalar(
    "model_instance_count",
    sql`coalesce(try_cast(event.payload_json->'summary'->>'instanceCount' as bigint), model_instance_count)`,
  );
  s.setScalar(
    "model_triangle_count",
    sql`coalesce(try_cast(event.payload_json->'summary'->>'triangleCount' as bigint), model_triangle_count)`,
  );
  s.setScalar(
    "model_material_count",
    sql`coalesce(try_cast(event.payload_json->'summary'->>'materialCount' as bigint), model_material_count)`,
  );
}

function semanticPartMatches(recordName?: string) {
  const field = (name: string) =>
    recordName ? sql.ref(recordName, name) : sql.ref(name);
  return sql`
    (semantic_kind = 'all' or ${field("classification")} = semantic_kind)
    and (
      trim(semantic_search) = ''
      or lower(${
    field("search_text")
  }) like '%' || lower(trim(semantic_search)) || '%'
    )
  `;
}

function applySemanticFilter(s: DomStatements, handle: Sql) {
  const active = sql`trim(semantic_search) <> '' or semantic_kind <> 'all'`;
  s.setScalar("semantic_filters_active", active);
  s.setScalar(
    "semantic_match_count",
    sql`(select count(*) from glb_semantic_parts where ${semanticPartMatches()})`,
  );
  s.jsCall({
    module: "glb_viewer",
    exportName: "setFilter",
    handle,
    argJson: sql`json_build_object(
      'handle', ${handle},
      'active', ${active},
      'mode', semantic_filter_mode,
      'definitionKeys', coalesce(
        (
          select json_array_agg(part_key order by part_name)
          from glb_semantic_parts
          where ${semanticPartMatches()}
        ),
        json_build_array()
      )
    )`,
  });
}

function updateSemanticCatalog(
  s: DomStatements,
  partCount: Sql,
  catalogTotal: Sql = partCount,
  catalogHasMore: Sql = sql`false`,
) {
  s.modify(sql`delete from glb_semantic_parts`);
  s.modify(sql`
    insert into glb_semantic_parts (
      part_index,
      part_key,
      part_name,
      classification,
      designation,
      material,
      occurrence_count,
      search_text
    )
    select
      row.index,
      row.value->>'definitionKey',
      coalesce(row.value->>'displayName', row.value->>'definitionKey'),
      coalesce(row.value->>'classification', 'unclassified'),
      row.value->>'designation',
      row.value->>'materialDesignation',
      coalesce(try_cast(row.value->>'occurrenceCount' as bigint), 0),
      lower(
        coalesce(row.value->>'displayName', '') || ' ' ||
        coalesce(row.value->>'definitionKey', '') || ' ' ||
        coalesce(row.value->>'designation', '') || ' ' ||
        coalesce(row.value->>'shapeType', '') || ' ' ||
        coalesce(row.value->>'materialDesignation', '')
      )
    from json.array_each(
      coalesce(event.payload_json->'semanticCatalog', json_build_array())
    ) row
  `);
  s.setScalar("semantic_part_count", partCount);
  s.setScalar("semantic_match_count", partCount);
  s.setScalar("semantic_catalog_total", catalogTotal);
  s.setScalar("semantic_catalog_has_more", catalogHasMore);
  s.setScalar("semantic_enabled", sql`${partCount} > 0`);
}

function GlbModelTree(props: { handle: Sql; hasSemanticIndex: Sql }) {
  return (
    <aside sx={styles.panel} aria-label="Model browser">
      <div sx={styles.panelHeader}>
        <Typography level="title-sm">
          {sql`case when ${props.hasSemanticIndex} then 'Steel browser' else 'Model browser' end`}
        </Typography>
        <div className="grow" />
        <Typography level="body-xs" color="neutral">
          {sql`
            case when ${props.hasSemanticIndex}
              then semantic_match_count::string || ' of ' ||
                case when semantic_catalog_has_more
                  then semantic_catalog_total::string
                  else semantic_part_count::string
                end
              else scene_node_count::string ||
                case when scene_node_count = 1 then ' node' else ' nodes' end
            end
          `}
        </Typography>
      </div>
      <Show when={props.hasSemanticIndex}>
        <>
          <div sx={styles.browserControls}>
            <ButtonGroup size="sm" buttonFlex={1}>
              <Button
                aria-pressed={sql`browser_tab = 'parts'`}
                onClick={(s) => s.setScalar("browser_tab", sql.lit`parts`)}
              >
                Parts
              </Button>
              <Button
                aria-pressed={sql`browser_tab = 'assembly'`}
                onClick={(s) => s.setScalar("browser_tab", sql.lit`assembly`)}
              >
                Assembly
              </Button>
            </ButtonGroup>
            <Show when={sql`browser_tab = 'parts'`}>
              <Input
                size="sm"
                value={sql`semantic_search`}
                placeholder="Search parts…"
                aria-label="Search by mark, shape, or grade"
                startIcon="Search"
                fullWidth
                onInput={(s) => {
                  s.setScalar("semantic_search", sql`target_value`);
                  applySemanticFilter(s, props.handle);
                }}
              />
              <ButtonGroup size="sm" buttonFlex={1}>
                {([
                  ["all", "All"],
                  ["linear_member", "Members"],
                  ["plate", "Plates"],
                ] as const).map(([value, label]) => (
                  <Button
                    aria-pressed={sql`semantic_kind = ${sql.lit(value)}`}
                    onClick={(s) => {
                      s.setScalar("semantic_kind", sql.lit(value));
                      applySemanticFilter(s, props.handle);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </ButtonGroup>
              <ButtonGroup size="xs" buttonFlex={1}>
                <Button
                  aria-label="Hide unmatched parts"
                  title="Hide parts that do not match the filter"
                  aria-pressed={sql`semantic_filter_mode = 'hide'`}
                  onClick={(s) => {
                    s.setScalar("semantic_filter_mode", sql.lit`hide`);
                    applySemanticFilter(s, props.handle);
                  }}
                >
                  Hide
                </Button>
                <Button
                  aria-label="Ghost unmatched parts"
                  title="Show unmatched parts as transparent"
                  aria-pressed={sql`semantic_filter_mode = 'ghost'`}
                  onClick={(s) => {
                    s.setScalar("semantic_filter_mode", sql.lit`ghost`);
                    applySemanticFilter(s, props.handle);
                  }}
                >
                  Ghost
                </Button>
                <Button
                  aria-label="Fit filtered parts"
                  disabled={sql`not semantic_filters_active`}
                  onClick={viewerCommand(props.handle, "fitVisible")}
                >
                  Fit
                </Button>
                <Button
                  aria-label="Reset parts filter"
                  disabled={sql`not semantic_filters_active`}
                  onClick={(s) => {
                    s.setScalar("semantic_search", sql.lit``);
                    s.setScalar("semantic_kind", sql.lit`all`);
                    s.setScalar("semantic_filter_mode", sql.lit`hide`);
                    applySemanticFilter(s, props.handle);
                  }}
                >
                  Reset
                </Button>
              </ButtonGroup>
            </Show>
          </div>
          <Show when={sql`browser_tab = 'parts'`}>
            <div sx={styles.tree} role="listbox" aria-label="Steel parts">
              <Each table="glb_semantic_parts" recordName="glb_semantic_part">
                <Show when={semanticPartMatches("glb_semantic_part")}>
                  <button
                    type="button"
                    role="option"
                    sx={styles.semanticRow}
                    aria-selected={sql`glb_semantic_part.part_key = selected_definition_key`}
                    onClick={(s) => {
                      s.jsCall({
                        module: "glb_viewer",
                        exportName: "selectDefinition",
                        handle: props.handle,
                        argJson: sql`json_build_object(
                          'handle', ${props.handle},
                          'definitionKey', glb_semantic_part.part_key
                        )`,
                      });
                    }}
                  >
                    <span className="truncate text-sm font-medium">
                      {sql`glb_semantic_part.part_name`}
                    </span>
                    <span sx={styles.semanticMeta}>
                      <span sx={styles.semanticBadge}>
                        {sql`
                          case glb_semantic_part.classification
                            when 'linear_member' then 'MEMBER'
                            when 'plate' then 'PLATE'
                            else 'OTHER'
                          end
                        `}
                      </span>
                      <Show
                        when={sql`glb_semantic_part.designation is not null`}
                      >
                        <span className="truncate">
                          {sql`glb_semantic_part.designation`}
                        </span>
                      </Show>
                      <Show when={sql`glb_semantic_part.material is not null`}>
                        <span className="truncate">
                          {sql`glb_semantic_part.material`}
                        </span>
                      </Show>
                      <Show when={sql`glb_semantic_part.occurrence_count > 1`}>
                        <span>
                          {sql`'×' || glb_semantic_part.occurrence_count::string`}
                        </span>
                      </Show>
                    </span>
                  </button>
                </Show>
              </Each>
            </div>
          </Show>
        </>
      </Show>
      <Data
        local
        noRefetch
        watch={[sql`scene_graph_json`]}
        procedure={(s) => {
          s.defTable(
            "glb_scene_nodes",
            sql`
              select
                row.index as node_index,
                row.value->>'key' as key,
                coalesce(row.value->>'displayName', row.value->>'name') as name,
                row.value->>'kind' as kind,
                coalesce(try_cast(row.value->>'depth' as bigint), 0) as depth,
                coalesce(try_cast(row.value->>'meshCount' as bigint), 0) as mesh_count
              from json.array_each(
                coalesce(scene_graph_json->'nodes', json_build_array())
              ) row
              order by row.index
            `,
          );
        }}
      >
        <Show
          when={sql`not ${props.hasSemanticIndex} or browser_tab = 'assembly'`}
        >
          <div sx={styles.tree} role="tree">
            <Each table="glb_scene_nodes" recordName="glb_scene_node">
              <button
                type="button"
                role="treeitem"
                sx={styles.treeRow}
                style={{
                  paddingLeft:
                    sql`(8 + least(glb_scene_node.depth, 12) * 14)::string || 'px'`,
                }}
                aria-level={sql`glb_scene_node.depth + 1`}
                aria-pressed={sql`glb_scene_node.key = selected_key`}
                title={sql`glb_scene_node.name`}
                onClick={(s) => {
                  s.jsCall({
                    module: "glb_viewer",
                    exportName: "selectNode",
                    handle: props.handle,
                    argJson: sql`json_build_object(
                      'handle', ${props.handle},
                      'key', glb_scene_node.key
                    )`,
                  });
                }}
              >
                <MaterialIcon
                  icon="ViewInAr"
                  fontSize="sm"
                  color="inherit"
                />
                <span className="min-w-0 grow truncate">
                  {sql`glb_scene_node.name`}
                </span>
                <Show when={sql`glb_scene_node.mesh_count > 1`}>
                  <span className="text-xs text-secondary">
                    {sql`glb_scene_node.mesh_count`}
                  </span>
                </Show>
              </button>
            </Each>
          </div>
        </Show>
      </Data>
    </aside>
  );
}

function GlbInspector(props: { handle: Sql }) {
  const updateSection = (s: DomStatements) => setSection(s, props.handle);
  return (
    <aside sx={styles.panel} aria-label="Model details">
      <div sx={styles.panelHeader}>
        <Typography level="title-sm">Details</Typography>
      </div>
      <div sx={styles.inspectorBody}>
        <section sx={styles.inspectorSection}>
          <Typography level="title-sm">Selection</Typography>
          <Show
            when={sql`selected_key is not null`}
            fallback={
              <Typography level="body-xs" color="neutral">
                Click geometry or choose a model-tree node.
              </Typography>
            }
          >
            <Typography level="body-sm" className="break-words font-medium">
              {sql`coalesce(selected_semantic_name, selected_name)`}
            </Typography>
            <ButtonGroup size="xs" buttonFlex={1}>
              <Button
                startIcon="CenterFocusStrong"
                onClick={viewerCommand(props.handle, "fitSelection")}
              >
                Fit
              </Button>
              <Button
                startIcon="VisibilityOff"
                onClick={viewerCommand(props.handle, "hideSelection")}
              >
                Hide
              </Button>
              <Button
                startIcon="SelectAll"
                onClick={viewerCommand(props.handle, "isolateSelection")}
              >
                Isolate
              </Button>
            </ButtonGroup>
            <div sx={styles.propertyGrid}>
              <Show when={sql`selected_definition_key is not null`}>
                <span className="text-secondary">Class</span>
                <span>
                  {sql`
                    case selected_classification
                      when 'linear_member' then 'Linear member'
                      when 'plate' then 'Plate'
                      when 'assembly' then 'Assembly'
                      else 'Unclassified'
                    end
                  `}
                </span>
                <Show when={sql`selected_designation is not null`}>
                  <span className="text-secondary">Designation</span>
                  <span>{sql`selected_designation`}</span>
                </Show>
                <Show when={sql`selected_shape_type is not null`}>
                  <span className="text-secondary">Shape</span>
                  <span>{sql`selected_shape_type`}</span>
                </Show>
                <Show when={sql`selected_material is not null`}>
                  <span className="text-secondary">Grade</span>
                  <span>{sql`selected_material`}</span>
                </Show>
                <Show when={sql`selected_length is not null`}>
                  <span className="text-secondary">Length</span>
                  <span>{formatSelectedCadLength(sql`selected_length`)}</span>
                </Show>
                <Show when={sql`selected_width is not null`}>
                  <span className="text-secondary">Width</span>
                  <span>{formatSelectedCadLength(sql`selected_width`)}</span>
                </Show>
                <Show when={sql`selected_depth is not null`}>
                  <span className="text-secondary">Depth</span>
                  <span>{formatSelectedCadLength(sql`selected_depth`)}</span>
                </Show>
                <Show when={sql`selected_thickness is not null`}>
                  <span className="text-secondary">Thickness</span>
                  <span>
                    {formatSelectedCadLength(sql`selected_thickness`)}
                  </span>
                </Show>
                <Show when={sql`coalesce(selected_hole_count, 0) > 0`}>
                  <span className="text-secondary">Holes</span>
                  <span>{sql`selected_hole_count`}</span>
                </Show>
                <Show when={sql`coalesce(selected_bevel_count, 0) > 0`}>
                  <span className="text-secondary">Bevels</span>
                  <span>{sql`selected_bevel_count`}</span>
                </Show>
                <Show when={sql`coalesce(selected_occurrence_count, 0) > 1`}>
                  <span className="text-secondary">Occurrences</span>
                  <span>{sql`selected_occurrence_count`}</span>
                </Show>
                <Show when={sql`selected_match_confidence is not null`}>
                  <span className="text-secondary">Shape match</span>
                  <span>
                    {sql`round(selected_match_confidence * 100, 1)::string || '%'`}
                  </span>
                </Show>
              </Show>
              <span className="text-secondary">Type</span>
              <span>
                {sql`
                  case selected_kind
                    when 'occurrence' then 'Part occurrence'
                    when 'definition' then
                      case when selected_classification = 'assembly'
                        then 'Assembly definition'
                        else 'Part definition'
                      end
                    when 'mesh' then 'Mesh'
                    when 'group' then 'Group'
                    when 'scene' then 'Model'
                    else replace(selected_kind, '_', ' ')
                  end
                `}
              </span>
              <span className="text-secondary">Meshes</span>
              <span>{sql`selected_mesh_count`}</span>
              <span className="text-secondary">Triangles</span>
              <span>{sql`selected_triangle_count`}</span>
              <span className="text-secondary">Size X</span>
              <span>{sql`round(selected_size_x, 6)::string || ' m'`}</span>
              <span className="text-secondary">Size Y</span>
              <span>{sql`round(selected_size_y, 6)::string || ' m'`}</span>
              <span className="text-secondary">Size Z</span>
              <span>{sql`round(selected_size_z, 6)::string || ' m'`}</span>
              <Show when={sql`selected_object_key is not null`}>
                <span className="text-secondary">Object ID</span>
                <span
                  className="truncate font-mono"
                  title={sql`selected_object_key`}
                >
                  {sql`selected_object_key`}
                </span>
              </Show>
              <Show when={sql`selected_definition_key <> selected_object_key`}>
                <span className="text-secondary">Definition ID</span>
                <span
                  className="truncate font-mono"
                  title={sql`selected_definition_key`}
                >
                  {sql`selected_definition_key`}
                </span>
              </Show>
            </div>
          </Show>
          <Show
            when={sql`
              hidden_count > 0 or isolated or semantic_filters_active
            `}
          >
            <Button
              size="sm"
              variant="outlined"
              color="neutral"
              startIcon="Visibility"
              onClick={(s) => {
                s.setScalar("semantic_search", sql.lit``);
                s.setScalar("semantic_kind", sql.lit`all`);
                s.setScalar("semantic_filter_mode", sql.lit`hide`);
                s.setScalar("semantic_filters_active", false);
                s.setScalar("semantic_match_count", sql`semantic_part_count`);
                viewerCommand(props.handle, "showAll")(s);
              }}
            >
              Show all
            </Button>
          </Show>
        </section>
        <section sx={styles.inspectorSection}>
          <Typography level="title-sm">Model</Typography>
          <div sx={styles.propertyGrid}>
            <span className="text-secondary">Meshes</span>
            <span>{sql`model_mesh_count`}</span>
            <span className="text-secondary">Instances</span>
            <span>{sql`model_instance_count`}</span>
            <span className="text-secondary">Triangles</span>
            <span>{sql`model_triangle_count`}</span>
            <span className="text-secondary">Materials</span>
            <span>{sql`model_material_count`}</span>
          </div>
        </section>
        <section sx={styles.inspectorSection}>
          <div sx={styles.controlRow}>
            <div>
              <Typography level="title-sm">Section cut</Typography>
              <Typography level="body-xs" color="neutral">
                Look inside the model
              </Typography>
            </div>
            <div className="grow" />
            <Button
              size="sm"
              variant="outlined"
              color="neutral"
              aria-pressed={sql`section_enabled`}
              onClick={(s) => {
                s.setScalar("section_enabled", sql`not section_enabled`);
                updateSection(s);
              }}
            >
              {sql`case when section_enabled then 'Disable' else 'Enable' end`}
            </Button>
          </div>
          <Show when={sql`section_enabled`}>
            <ButtonGroup size="sm" buttonFlex={1}>
              {(["x", "y", "z"] as const).map((axis) => (
                <Button
                  aria-pressed={sql`section_axis = ${sql.lit(axis)}`}
                  onClick={(s) => {
                    s.setScalar("section_axis", sql.lit(axis));
                    updateSection(s);
                  }}
                >
                  {axis.toUpperCase()}
                </Button>
              ))}
            </ButtonGroup>
            <div
              onMouseDown={updateSection}
              onMouseMove={(s) => {
                s.if(sql`(event.buttons & 1) = 1`, updateSection);
              }}
            >
              <Slider
                size="sm"
                min={-1}
                max={1}
                step={0.01}
                bindScalar="section_offset"
              />
            </div>
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startIcon="Flip"
              onClick={(s) => {
                s.setScalar("section_reverse", sql`not section_reverse`);
                updateSection(s);
              }}
            >
              Reverse direction
            </Button>
          </Show>
        </section>
        <Show when={sql`measurement_distance is not null`}>
          <section sx={styles.inspectorSection}>
            <Typography level="title-sm">Measurement</Typography>
            <Typography level="body-sm" className="font-mono">
              {sql`round(measurement_distance, 6)::string || ' m'`}
            </Typography>
            <Button
              size="sm"
              variant="outlined"
              color="neutral"
              onClick={viewerCommand(props.handle, "clearMeasurements")}
            >
              Clear measurement
            </Button>
          </section>
        </Show>
      </div>
    </aside>
  );
}

function GlbViewerToolbar(props: {
  handle: Sql;
  allowDownload: boolean;
  browserLabel?: string;
  toolbarLeading?: Node;
}) {
  return (
    <div sx={styles.toolbar} role="toolbar" aria-label="3D viewer tools">
      {props.toolbarLeading}
      {props.toolbarLeading && <Divider orientation="vertical" />}
      <ButtonGroup size="sm" spacing={0}>
        {props.browserLabel
          ? (
            <Button
              startIcon="ViewSidebar"
              aria-pressed={sql`show_tree`}
              onClick={(s) => s.setScalar("show_tree", sql`not show_tree`)}
            >
              {props.browserLabel}
            </Button>
          )
          : (
            <IconButton
              icon="ViewSidebar"
              aria-label="Toggle model browser"
              tooltip="Model browser"
              aria-pressed={sql`show_tree`}
              onClick={(s) => s.setScalar("show_tree", sql`not show_tree`)}
            />
          )}
      </ButtonGroup>
      <Divider orientation="vertical" />
      <ButtonGroup size="sm" spacing={0}>
        <IconButton
          icon="FitScreen"
          aria-label="Fit model"
          tooltip="Fit model (F)"
          disabled={sql`not glb_ready`}
          onClick={viewerCommand(props.handle, "fit")}
        />
        <IconButton
          icon="ThreeDRotation"
          aria-label="Toggle orthographic projection"
          tooltip="Perspective / orthographic"
          disabled={sql`not glb_ready`}
          aria-pressed={sql`projection = 'orthographic'`}
          onClick={(s) => {
            s.jsCall({
              module: "glb_viewer",
              exportName: "setProjection",
              handle: props.handle,
              argJson: sql`json_build_object(
                'handle', ${props.handle},
                'projection', case
                  when projection = 'orthographic' then 'perspective'
                  else 'orthographic'
                end
              )`,
            });
          }}
        />
      </ButtonGroup>
      <ButtonGroup size="sm" spacing={0}>
        <Button
          disabled={sql`not glb_ready`}
          aria-pressed={sql`current_view = 'front'`}
          onClick={setView(props.handle, "front")}
        >
          Front
        </Button>
        <Button
          disabled={sql`not glb_ready`}
          aria-pressed={sql`current_view = 'right'`}
          onClick={setView(props.handle, "right")}
        >
          Right
        </Button>
        <Button
          disabled={sql`not glb_ready`}
          aria-pressed={sql`current_view = 'top'`}
          onClick={setView(props.handle, "top")}
        >
          Top
        </Button>
        <Button
          disabled={sql`not glb_ready`}
          aria-pressed={sql`current_view = 'isometric'`}
          onClick={setView(props.handle, "isometric")}
        >
          Isometric
        </Button>
      </ButtonGroup>
      <Divider orientation="vertical" />
      <ButtonGroup size="sm" spacing={0}>
        <IconButton
          icon="GridOn"
          aria-label="Toggle technical edges"
          tooltip="Technical edges"
          disabled={sql`not glb_ready`}
          aria-pressed={sql`edges_enabled`}
          onClick={(s) => {
            s.jsCall({
              module: "glb_viewer",
              exportName: "setEdges",
              handle: props.handle,
              argJson: sql`json_build_object(
                'handle', ${props.handle},
                'enabled', not edges_enabled
              )`,
            });
          }}
        />
        <IconButton
          icon="Straighten"
          aria-label="Measure distance"
          tooltip="Measure between two points"
          disabled={sql`not glb_ready`}
          aria-pressed={sql`measurement_mode`}
          onClick={(s) => {
            s.jsCall({
              module: "glb_viewer",
              exportName: "setMeasurementMode",
              handle: props.handle,
              argJson: sql`json_build_object(
                'handle', ${props.handle},
                'enabled', not measurement_mode
              )`,
            });
          }}
        />
      </ButtonGroup>
      <div className="grow" />
      <IconButton
        size="sm"
        variant="outlined"
        color="neutral"
        icon="Info"
        aria-label="Toggle details"
        tooltip="Details"
        aria-pressed={sql`show_inspector`}
        onClick={(s) => s.setScalar("show_inspector", sql`not show_inspector`)}
      />
      <Show when={sql`${props.allowDownload ? 1 : 0} = 1`}>
        <IconButton
          size="sm"
          variant="outlined"
          color="neutral"
          icon="Download"
          aria-label="Download GLB"
          tooltip="Download GLB"
          disabled={sql`not glb_ready`}
          onClick={viewerCommand(props.handle, "download")}
        />
      </Show>
    </div>
  );
}

/**
 * GLB inspection surface with CAD navigation, named views, contextual
 * visibility controls, sectioning, measurement, model browser, and details.
 * The browser module owns only the WebGL canvas; this component owns all
 * application DOM and styling.
 */
export function GlbViewer(props: GlbViewerProps) {
  useJsModule("glb_viewer", { assetUrl: props.moduleAssetUrl });
  const id = useUniqueId();
  const handle = props.handle
    ? (typeof props.handle === "string" ? sql.lit(props.handle) : props.handle)
    : sql.concat(id, sql.lit`-glb-viewer`);
  const mountId = sql.concat(id, sql.lit`-glb-viewer-mount`);
  const initialProjection = props.initialProjection ?? "perspective";
  const modelIndex = toJsonSql(props.modelIndexJson);
  const initialCadInteractions = toJsonSql(props.initialCadInteractionsJson);
  const dracoDecoderUrl = props.dracoDecoderUrl ?? getModuleFileUrl(
    "glb_viewer",
    "draco/draco_decoder.wasm",
  );

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("glb_ready", sql`false`);
        s.defScalar("glb_error", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("loading_percent", sql`0`);
        s.defScalar("loading_stage", sql.lit`download`);
        s.defScalar("projection", sql.lit(initialProjection));
        s.defScalar("current_view", sql.lit`isometric`);
        s.defScalar("edges_enabled", sql`${props.initialEdges ?? false}`);
        s.defScalar("explode_factor", sql`0.0`);
        s.defScalar("section_enabled", sql`false`);
        s.defScalar("section_axis", sql.lit`x`);
        s.defScalar("section_offset", sql`0.0`);
        s.defScalar("section_reverse", sql`false`);
        s.defScalar("measurement_mode", sql`false`);
        s.defScalar("measurement_distance", { type: "Double" });
        s.defScalar("hidden_count", sql`0`);
        s.defScalar("isolated", sql`false`);
        s.defScalar("show_tree", sql`${props.showModelTree ?? true}`);
        s.defScalar("show_inspector", sql`${props.showInspector ?? true}`);
        s.defScalar("browser_tab", sql.lit`parts`);
        s.defScalar("semantic_search", sql.lit``);
        s.defScalar("semantic_kind", sql.lit`all`);
        s.defScalar("semantic_filter_mode", sql.lit`hide`);
        s.defScalar("semantic_filters_active", sql`false`);
        s.defScalar("semantic_enabled", sql`false`);
        s.defScalar("semantic_catalog_has_more", sql`false`);
        s.defScalar("semantic_catalog_total", sql`0`);
        s.defScalar("selected_key", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("selected_name", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("selected_kind", {
          type: { type: "String", maxLength: 40 },
        });
        for (
          const name of [
            "selected_definition_key",
            "selected_object_key",
            "selected_semantic_name",
            "selected_classification",
            "selected_designation",
            "selected_shape_type",
            "selected_material",
            "selected_source_unit",
          ]
        ) {
          s.defScalar(name, {
            type: { type: "String", maxLength: 1000 },
          });
        }
        for (
          const name of [
            "selected_length",
            "selected_width",
            "selected_depth",
            "selected_thickness",
            "selected_match_confidence",
          ]
        ) {
          s.defScalar(name, { type: "Double" });
        }
        s.defScalar("selected_hole_count", { type: "BigInt" });
        s.defScalar("selected_bevel_count", { type: "BigInt" });
        s.defScalar("selected_occurrence_count", { type: "BigInt" });
        s.defScalar("selected_mesh_count", { type: "BigInt" });
        s.defScalar("selected_triangle_count", { type: "BigInt" });
        s.defScalar("selected_size_x", { type: "Double" });
        s.defScalar("selected_size_y", { type: "Double" });
        s.defScalar("selected_size_z", { type: "Double" });
        s.defScalar("scene_node_count", sql`0`);
        s.defScalar("model_mesh_count", sql`0`);
        s.defScalar("model_instance_count", sql`0`);
        s.defScalar("model_triangle_count", sql`0`);
        s.defScalar("model_material_count", sql`0`);
        s.defScalar("scene_graph_json", { type: "Json" });
        s.defTable(
          "glb_semantic_parts",
          sql`
            select
              row.index as part_index,
              row.value->>'definitionKey' as part_key,
              coalesce(row.value->>'displayName', row.value->>'definitionKey') as part_name,
              coalesce(row.value->>'classification', 'unclassified') as classification,
              row.value->>'designation' as designation,
              row.value->>'materialDesignation' as material,
              coalesce(try_cast(row.value->>'occurrenceCount' as bigint), 0) as occurrence_count,
              lower(
                coalesce(row.value->>'displayName', '') || ' ' ||
                coalesce(row.value->>'definitionKey', '') || ' ' ||
                coalesce(row.value->>'designation', '') || ' ' ||
                coalesce(row.value->>'shapeType', '') || ' ' ||
                coalesce(row.value->>'materialDesignation', '')
              ) as search_text
            from json.array_each(json_build_array()) row
            order by part_name, part_key
          `,
        );
        s.defScalar(
          "semantic_part_count",
          sql`(select count(*) from glb_semantic_parts)`,
        );
        s.defScalar(
          "semantic_match_count",
          sql`(select count(*) from glb_semantic_parts)`,
        );
      }}
    >
      <div
        sx={[styles.frame, { height: props.height ?? "min(780px, 80vh)" }]}
        className={props.className}
        js={{
          handles: [{
            module: "glb_viewer",
            cleanup: "cleanup",
            handle,
          }],
          on: {
            "glb_viewer.progress": (s) => {
              s.if(
                sql`event.payload_json->>'stage' = 'download'
                  and coalesce(try_cast(event.payload_json->>'loaded' as bigint), 0) = 0`,
                (s) => {
                  s.setScalar("glb_ready", false);
                  s.setScalar("glb_error", sql.null);
                  s.setScalar("loading_percent", 0);
                },
              );
              s.setScalar(
                "loading_percent",
                sql`coalesce(try_cast(event.payload_json->>'percent' as bigint), loading_percent)`,
              );
              s.setScalar(
                "loading_stage",
                sql`coalesce(event.payload_json->>'stage', loading_stage)`,
              );
            },
            "glb_viewer.ready": (s) => {
              s.setScalar("glb_ready", true);
              s.setScalar("glb_error", sql.null);
              updateSemanticCatalog(
                s,
                sql`coalesce(try_cast(event.payload_json->'semantics'->>'partCount' as bigint), 0)`,
                sql`coalesce(try_cast(event.payload_json->'semantics'->>'catalogTotal' as bigint), 0)`,
                sql`coalesce(try_cast(event.payload_json->'semantics'->>'catalogHasMore' as bool), false)`,
              );
              s.setScalar("semantic_search", sql.lit``);
              s.setScalar("semantic_kind", sql.lit`all`);
              s.setScalar("semantic_filter_mode", sql.lit`hide`);
              s.setScalar("semantic_filters_active", sql`false`);
              s.setScalar("browser_tab", sql.lit`parts`);
              s.setScalar(
                "scene_node_count",
                sql`coalesce(try_cast(event.payload_json->'summary'->>'nodeCount' as bigint), 0)`,
              );
              s.setScalar(
                "model_mesh_count",
                sql`coalesce(try_cast(event.payload_json->'summary'->>'meshCount' as bigint), 0)`,
              );
              s.setScalar(
                "model_instance_count",
                sql`coalesce(try_cast(event.payload_json->'summary'->>'instanceCount' as bigint), 0)`,
              );
              s.setScalar(
                "model_triangle_count",
                sql`coalesce(try_cast(event.payload_json->'summary'->>'triangleCount' as bigint), 0)`,
              );
              s.setScalar(
                "model_material_count",
                sql`coalesce(try_cast(event.payload_json->'summary'->>'materialCount' as bigint), 0)`,
              );
              updateViewerState(s);
              s.jsCall({
                module: "glb_viewer",
                exportName: "getSceneGraph",
                handle,
                argJson: sql`json_build_object(
                  'handle', ${handle},
                  'offset', 0,
                  'limit', 2000
                )`,
                resultJsonScalar: "glb_scene_graph_payload",
              });
              s.setScalar(
                "scene_graph_json",
                sql`coalesce(glb_scene_graph_payload->'json', glb_scene_graph_payload)`,
              );
              if (props.onReady) {
                props.onReady(s, createGlbViewerEvent(handle));
              }
            },
            "glb_viewer.stateChanged": updateViewerState,
            "glb_viewer.semanticsChanged": (s) => {
              updateSemanticCatalog(
                s,
                sql`coalesce(try_cast(event.payload_json->>'partCount' as bigint), 0)`,
                sql`coalesce(try_cast(event.payload_json->>'catalogTotal' as bigint), 0)`,
                sql`coalesce(try_cast(event.payload_json->>'catalogHasMore' as bool), false)`,
              );
              s.setScalar("semantic_search", sql.lit``);
              s.setScalar("semantic_kind", sql.lit`all`);
              s.setScalar("semantic_filter_mode", sql.lit`hide`);
              s.setScalar("semantic_filters_active", sql`false`);
            },
            "glb_viewer.selectionChanged": (s) => {
              if (props.onSelectionChange) {
                props.onSelectionChange(s, createGlbViewerEvent(handle));
              }
            },
            "glb_viewer.error": (s) => {
              s.setScalar("glb_ready", false);
              s.setScalar(
                "glb_error",
                sql`coalesce(event.payload_json->>'message', 'Unable to open the 3D model.')`,
              );
              if (props.onError) {
                props.onError(s, createGlbViewerEvent(handle));
              }
            },
            "glb_viewer.contextLost": (s) => {
              s.setScalar(
                "glb_error",
                sql
                  .lit`The graphics context was interrupted. Restoring the model…`,
              );
            },
            "glb_viewer.contextRestored": (s) => {
              s.setScalar("glb_error", sql.null);
            },
          },
        }}
      >
        {props.showToolbar !== false && (
          <GlbViewerToolbar
            handle={handle}
            allowDownload={props.allowDownload !== false}
            browserLabel={props.browserLabel}
            toolbarLeading={props.toolbarLeading}
          />
        )}
        <Show when={sql`glb_error is not null`}>
          <Alert color="danger" variant="soft" className="m-2">
            {sql`glb_error`}
          </Alert>
        </Show>
        <div sx={styles.workspace}>
          <Show when={sql`show_tree`}>
            <GlbModelTree
              handle={handle}
              hasSemanticIndex={sql`semantic_enabled`}
            />
            <Divider orientation="vertical" />
          </Show>
          <main sx={styles.viewport} aria-label="3D model viewport">
            <div
              id={mountId}
              sx={styles.mount}
              onMount={(s) => {
                s.sleep(100);
                s.jsCall({
                  module: "glb_viewer",
                  exportName: "initialize",
                  handle,
                  argJson: sql`json_build_object(
                    'handle', ${handle},
                    'elementId', ${mountId},
                    'fileUrl', ${toSql(props.fileUrl, "")},
                    'fileName', ${toSql(props.fileName, "model.glb")},
                    'dracoDecoderUrl', ${sql.lit(dracoDecoderUrl)},
                    'backgroundColor', ${
                    sql.lit(props.backgroundColor ?? "#e9edf2")
                  },
                    'projection', ${sql.lit(initialProjection)},
                    'edges', ${props.initialEdges ?? false},
                    'modelIndex', ${modelIndex},
                    'cadInteractions', ${initialCadInteractions},
                    'maxBytes', ${props.maxBytes ?? 536870912}
                  )`,
                });
              }}
            />
            <Show when={sql`not glb_ready and glb_error is null`}>
              <div sx={styles.loading} role="status" aria-live="polite">
                <Typography level="body-sm">
                  {sql`
                    case
                      when loading_stage = 'parse' then 'Preparing model…'
                      when loading_percent > 0 then 'Loading model… ' || loading_percent::string || '%'
                      else 'Loading model…'
                    end
                  `}
                </Typography>
              </div>
            </Show>
          </main>
          <Show when={sql`show_inspector`}>
            <Divider orientation="vertical" />
            <GlbInspector handle={handle} />
          </Show>
        </div>
      </div>
    </Data>
  );
}

/** Replace the active model without remounting the viewer or its controls. */
export function setGlbViewerModel(
  s: DomStatements,
  handle: Sql | string,
  fileUrl: Sql | string,
  fileName?: Sql | string,
  modelIndexJson?: Sql | string,
  cadInteractionsJson?: Sql | string,
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  s.jsCall({
    module: "glb_viewer",
    exportName: "setModel",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'fileUrl', ${toSql(fileUrl, "")},
      'fileName', ${toSql(fileName, "model.glb")},
      'modelIndex', ${toJsonSql(modelIndexJson)},
      'cadInteractions', ${toJsonSql(cadInteractionsJson)}
    )`,
  });
}

/** Replace semantic metadata without downloading or remounting the GLB. */
export function setGlbViewerModelIndex(
  s: DomStatements,
  handle: Sql | string,
  modelIndexJson: Sql | string,
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  s.jsCall({
    module: "glb_viewer",
    exportName: "setModelIndex",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'modelIndex', ${toJsonSql(modelIndexJson)}
    )`,
  });
}

/** Apply a cad_interact action/response pair or a pre-composed envelope. */
export function applyGlbViewerCadInteraction(
  s: DomStatements,
  handle: Sql | string,
  interactionOrActionJson: Sql | string,
  responseJson?: Sql | string,
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  const interaction = responseJson === undefined
    ? toJsonSql(interactionOrActionJson)
    : sql`json_build_object(
      'action', ${toJsonSql(interactionOrActionJson)},
      'response', ${toJsonSql(responseJson)}
    )`;
  s.jsCall({
    module: "glb_viewer",
    exportName: "applyCadInteraction",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'interaction', ${interaction}
    )`,
  });
}

/** Select and fit the scene object identified by a stable CAD object key. */
export function focusGlbViewerObject(
  s: DomStatements,
  handle: Sql | string,
  objectKey: Sql | string,
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  s.jsCall({
    module: "glb_viewer",
    exportName: "focusObject",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'objectKey', ${toSql(objectKey, "")}
    )`,
  });
}
