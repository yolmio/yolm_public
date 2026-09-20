import { Button } from "components/button";
import { type BooleanExpr, sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Data } from "std/data";
import { EventHandlers, type Node, Show } from "std/ui";

/** Options for a user-resizable inspector pane. */
export interface SplitViewResizable {
  /** Initial inspector width in px. Default 448. */
  initial?: number;
  /** Minimum inspector width in px when dragging. Default 320. */
  min?: number;
  /** Maximum inspector width in px when dragging. Default 720. */
  max?: number;
  /** Persist the chosen width in this cookie so it survives reloads. */
  cookieKey?: string;
}

/**
 * List-detail layout shell: a toolbar row on top, a main area (table / tree /
 * list) that grows to fill the row, and a collapsible Inspector pane on the
 * right. Collapsing the inspector lets the main area go full width.
 *
 * SplitView is intentionally stateless — it owns layout only, not data or
 * selection. The caller keeps its own `Data` scope around SplitView so the
 * toolbar, main, and inspector all share one set of scalars/temp tables and a
 * single `s.refetch()`. Pass the collapse flag in via `collapsed` and flip it
 * in `onToggleCollapsed`. (The one exception: `resizable` adds a private
 * local Data holding only the divider-drag state, mirroring the resizable
 * Sidebar.)
 */
export interface SplitViewProps {
  /** Controls rendered on the left of the toolbar row (view toggles, filters, search). */
  toolbar?: Node;
  /** Main content — table, tree, or list. Grows to fill; full width when the inspector is collapsed. */
  children: Node;
  /** Collapsible detail / edit pane shown beside the main content. */
  inspector?: Node;
  /** Which side the inspector sits on. Default "right". */
  inspectorSide?: "left" | "right";
  /** When this expression is true, the inspector is hidden and the main area is full width. */
  collapsed?: BooleanExpr;
  /**
   * Toggle handler for the collapse state. When provided together with
   * `inspector`, SplitView renders a standard wide/detail toggle button at the
   * right of the toolbar row.
   */
  onToggleCollapsed?: (s: DomStatements) => void;
  /**
   * Tailwind width classes for the inspector pane on large screens. Default
   * `lg:w-[28rem]`. Ignored when `resizable` is set (the dragged width wins).
   */
  inspectorClassName?: string;
  /**
   * When true, SplitView fills a definite-height ancestor on large screens:
   * the body row and both panes stretch to the container height and the
   * inspector scrolls internally, so the caller can make the main pane the
   * only shared scroll region. Below `lg` the layout stays natural-height
   * (the caller's container should scroll). Requires an ancestor that gives
   * SplitView a real height (e.g. `absolute inset-0`).
   */
  fill?: boolean;
  /**
   * Let the user drag the divider between inspector and main to resize the
   * inspector (large screens only; below `lg` the panes stack full width).
   */
  resizable?: SplitViewResizable;
  /** Toggle label while the inspector is visible. Default "Wide". */
  wideLabel?: string;
  /** Toggle label while the inspector is collapsed. Default "Show detail". */
  detailLabel?: string;
  /** Class for the outer container. */
  className?: string;
}

export function SplitView(props: SplitViewProps) {
  const collapsed = props.collapsed ?? sql`false`;
  const hasInspector = !!props.inspector;
  const showToggle = hasInspector && !!props.onToggleCollapsed;
  const resizable = hasInspector ? props.resizable : undefined;
  const inspectorClassName = resizable
    ? "lg:w-[var(--sv-inspector-w)]"
    : props.inspectorClassName ?? "lg:w-[28rem]";
  const fill = props.fill ?? false;
  const rootClassName = [
    fill ? "flex flex-col lg:h-full lg:min-h-0" : "",
    props.className ?? "",
  ].filter(Boolean).join(" ");
  const bodyClassName = fill
    ? "flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch"
    : "flex flex-col gap-4 lg:flex-row lg:items-start";
  // pr keeps scrolling pane content from hugging its scrollbar.
  const paneFillClasses = fill
    ? " lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-2"
    : "";
  const inspectorSide = props.inspectorSide === "left" ? "left" : "right";

  const inspectorPane = hasInspector
    ? (
      <Show when={sql`not (${collapsed})`}>
        <div
          className={`w-full shrink-0 ${inspectorClassName}${paneFillClasses}`}
        >
          {props.inspector}
        </div>
        {resizable
          ? (
            <div
              role="separator"
              aria-label="Resize pane"
              className="hidden w-1 shrink-0 cursor-col-resize rounded self-stretch transition-colors hover:bg-primary-200 active:bg-primary-300 lg:block"
              sx={{
                backgroundColor: "divider",
                dark: {
                  "&:hover": { backgroundColor: "primary-700" },
                  "&:active": { backgroundColor: "primary-600" },
                },
              }}
              onMouseDown={(s) => {
                s.event.preventDefault();
                s.setScalar("sv_resizing", true);
                s.setScalar("sv_resize_start_x", sql`event.client_x`);
                s.setScalar("sv_resize_start_width", sql`sv_inspector_width`);
              }}
            />
          )
          : null}
      </Show>
    )
    : null;

  const layout = (
    <div
      className={rootClassName || undefined}
      style={resizable
        ? {
          "--sv-inspector-w": sql`cast(sv_inspector_width as string) || 'px'`,
          "user-select": sql`case when sv_resizing then 'none' else 'auto' end`,
        }
        : undefined}
    >
      {props.toolbar || showToggle
        ? (
          <div
            className={`mb-3 flex ${
              fill ? "shrink-0 " : ""
            }flex-wrap items-center justify-between gap-2`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {props.toolbar}
            </div>
            {showToggle
              ? (
                <Button
                  size="sm"
                  variant="outlined"
                  color="neutral"
                  startIcon="Fullscreen"
                  onClick={props.onToggleCollapsed}
                >
                  {sql`case when ${collapsed} then ${
                    sql.lit(props.detailLabel ?? "Show detail")
                  } else ${sql.lit(props.wideLabel ?? "Wide")} end`}
                </Button>
              )
              : null}
          </div>
        )
        : null}
      <div className={bodyClassName}>
        {inspectorSide === "left" ? inspectorPane : null}
        <div
          className={`min-w-0 lg:flex-1${fill ? " lg:h-full lg:min-h-0" : ""}`}
        >
          {props.children}
        </div>
        {inspectorSide === "right" ? inspectorPane : null}
      </div>
    </div>
  );

  if (!resizable) {
    return layout;
  }
  const initial = resizable.initial ?? 448;
  const min = resizable.min ?? 320;
  const max = resizable.max ?? 720;
  // Dragging the divider right grows a left inspector and shrinks a right
  // one.
  const deltaSign = inspectorSide === "left" ? sql`1` : sql`-1`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("sv_inspector_width", initial);
        s.defScalar("sv_resizing", false);
        s.defScalar("sv_resize_start_x", 0);
        s.defScalar("sv_resize_start_width", initial);
        if (resizable.cookieKey) {
          s.getCookie(sql.lit`${resizable.cookieKey}`, "sv_width_cookie");
          s.setScalar(
            "sv_inspector_width",
            sql`
              greatest(
                ${min},
                least(
                  coalesce(
                    try_cast(sv_width_cookie.value as bigint),
                    sv_inspector_width
                  ),
                  ${max}
                )
              )
            `,
          );
        }
      }}
    >
      <EventHandlers
        document={{
          mouseMove: (s) => {
            s.if(sql`sv_resizing`, (s) => {
              s.event.preventDefault();
              s.setScalar(
                "sv_inspector_width",
                sql`
                  greatest(
                    ${min},
                    least(
                      sv_resize_start_width
                        + ${deltaSign} * (event.client_x - sv_resize_start_x),
                      ${max}
                    )
                  )
                `,
              );
            });
          },
          mouseUp: (s) => {
            s.if(sql`sv_resizing`, (s) => {
              s.setScalar("sv_resizing", false);
              if (resizable.cookieKey) {
                s.setCookie(
                  sql.lit`${resizable.cookieKey}`,
                  sql`cast(sv_inspector_width as string)`,
                );
              }
            });
          },
        }}
      />
      {layout}
    </Data>
  );
}
