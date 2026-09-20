import { currentUserHasPermission } from "blocks/auth";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import {
  LogoutICtxKey,
  SidebarCtx,
  SidebarPresenceICtxKey,
  useDefaultColor,
} from "std/ictx";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type {
  DomStatements,
  IStatementsBase,
  StateStatementsOrFn,
} from "std/statements";
import type { Style } from "std/style_types";
import {
  createStyles,
  cssVar,
  flexGrowStyles,
  getVariantStyle,
} from "std/style_utils";
import type { ColorPaletteProp, Variant } from "std/theme";
import {
  addCtx,
  createICtxKey,
  Effect,
  EventHandlers,
  gatherChildrenContextInfo,
  Match,
  Show,
  Switch,
  useApp,
  useICtx,
  useOptionalICtx,
  useUniqueId,
} from "std/ui";
import type { ContextInstance, FloatingOpts, ICtxKey, Node } from "std/ui";
import { Alert } from "./alert";
import { Button } from "./button";
import type { ButtonProps } from "./button";
import { ButtonGroup } from "./button_group";
import { CircularProgress } from "./circular_progress";
import { Drawer } from "./drawer";
import { FormControl } from "./form_control";
import { FormLabel } from "./form_label";
import { GlobalSearchDialog } from "./global_search_dialog";
import type { GlobalSearchDialogProps } from "./global_search_dialog";
import { SidebarIcon } from "./icons/sidebar";
import { List, ListItem, ListItemButton } from "./list";
import { DisplayCurrentUser } from "./settings_drawer";
import { Data } from "std/data";
import { navigationText } from "./navigation_text";
import { Sheet } from "./sheet";
import type { Color, Size } from "./types";
import { getUniqueUiId } from "./utils";
import { Typography } from "./typography";
import { SidebarItemsSharedContext } from "std/shared_contexts";
import { useSharedContext } from "std/ui";

// Consta
const SIDEBAR_COOKIE_NAME = "sidebar-state";
// const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_OPEN_SCALAR = "sidebar_open";
const SIDEBAR_RESIZABLE_SCALAR = "sidebar_resizable";
const SIDEBAR_WIDTH_SCALAR = "sidebar_width";
const SIDEBAR_RESIZING_SCALAR = "sidebar_resizing";
const SIDEBAR_MIN_WIDTH_SCALAR = "sidebar_min_width";
const SIDEBAR_COLLAPSE_THRESHOLD_SCALAR = "sidebar_collapse_threshold";
const MOBILE_DRAWER_OPEN_SCALAR = "mobile_drawer_open";
const SIDEBAR_READ_REFRESH_KEY = "sidebar_read_refresh";

function hrefPathExpr(href: Sql) {
  return sql`case
    when position('?' in ${href}) > 0
      then substring(${href} from 1 for position('?' in ${href}) - 1)
    else ${href}
  end`;
}

// Types
type SidebarCollapsible = "always" | "icon";
const collapsibleCondition = (ctx: GatherOptionsICtx) =>
  sql.or(
    sql(SIDEBAR_OPEN_SCALAR),
    ctx.collapsible === "always" ? sql.true : sql.false,
    sql(MOBILE_DRAWER_OPEN_SCALAR),
  );

const collapsibleIconsCondition = (ctx: GatherOptionsICtx) =>
  sql.and(
    sql.not(sql(SIDEBAR_OPEN_SCALAR)),
    ctx.collapsible === "always" ? sql.false : sql.true,
    sql.not(sql(MOBILE_DRAWER_OPEN_SCALAR)),
  );

// Style definitions
const styles = createStyles({
  provider: {
    display: "flex",
    overflow: "hidden",
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    position: "relative",
    transition: "all 0.2s ease",
    overflow: "clip",
  },
  dropdownMenu: (app) => {
    return {
      viewTransitionName: "navbar-popover",
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      border: "1px solid",
      borderColor: "divider",

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
      padding: 2,
    };
  },
  header: {
    display: "flex",
    alignItems: "center",
    height: "4rem",
    padding: 2,
    flexShrink: 0,
    justifyContent: "center",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    height: "4rem",
    padding: 2,
    marginTop: "auto",
  },
  content: (_, color: ColorPaletteProp) => {
    return {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minHeight: 0,
      gap: "8px",
      padding: 2,
      scrollbarWidth: "thin",
      scrollbarColor: cssVar(`palette-${color}-200`) + " transparent",
      scrollBehavior: "smooth",
      overflowY: "auto",
    };
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: 1,
  },
  menuIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    flexShrink: 0,
  },
  menuSub: (_, color: ColorPaletteProp) => {
    return {
      display: "flex",
      flexDirection: "column",
      gap: "0px",
      borderLeft: "1.5px solid",
      borderColor: cssVar(`palette-${color}-200`),
      marginLeft: 3,
      paddingLeft: 3,
    };
  },
  collapsible: {
    width: "100%",
    borderRadius: "md",
  },
});

interface GatherOptionsICtx {
  variant: Variant;
  color: Color;
  collapsible: SidebarCollapsible;
}

const GatherOptionsICtxKey = createICtxKey<GatherOptionsICtx>(
  "GatherOptionsICtxKey",
);

class GatherOptionsCtx implements ContextInstance, GatherOptionsICtx {
  implementICtxs: ICtxKey<any>[] = [GatherOptionsICtxKey];
  variant: GatherOptionsICtx["variant"] = "plain";
  color: GatherOptionsICtx["color"] = "neutral";
  collapsible: SidebarCollapsible = "always";
}

/** Account presentation selected by the navigation shell at generation time. */
export interface SidebarAccountPresentation {
  compact: boolean;
  placement: FloatingOpts["placement"];
}

/** Supply compact artwork separately from a full logo with lettering. */
export interface SidebarBrand {
  name: string;
  /** Compact mark for the rail, mobile header, and app-title headers. */
  logo?: string | Sql;
  /** Full logo for an expanded header without an app title. Keeps its aspect ratio. */
  wordmark?: string | Sql;
  /** Compact fallback when no mark is available; defaults to the name's initials. */
  initials?: string;
}

/** Opt into shell-owned desktop rail, mobile header, and navigation controls. */
export interface SidebarShellOptions {
  brand: SidebarBrand;
  /** Render the system's account menu using the shell-selected presentation. */
  account: (presentation: SidebarAccountPresentation) => Node;
}

const SidebarShellICtxKey = createICtxKey<SidebarShellCtx>("SidebarShell");
class SidebarShellCtx implements ContextInstance, SidebarShellOptions {
  implementICtxs = [SidebarShellICtxKey];
  railTriggerId = getUniqueUiId();
  mobileHeaderId = getUniqueUiId();
  constructor(
    public brand: SidebarShellOptions["brand"],
    public account: SidebarShellOptions["account"],
  ) {}
}

/**
 A modern sidebar component that provides a responsive navigation menu.
 This is a namespace component that contains all the sidebar-related components.
 Use Sidebar.Provider to wrap your app and Sidebar.Root for the actual sidebar.

 @category UI Component
 @example

[Example](../../examples/chinook/apps/dashboard.tsx)
 */
export function Sidebar() {
  return null;
}

export interface SidebarProviderProps {
  /** Shared navigation shell; omit to preserve the existing page-owned controls. */
  shell?: SidebarShellOptions;
  children: Node;
  /** Whether the sidebar starts expanded; a `sidebar-state` cookie can override this. */
  defaultOpen?: boolean;
  /** Width of the expanded sidebar in pixels. */
  width?: number;
  /** Whether the expanded desktop sidebar can be resized by dragging its right edge. */
  resizable?: boolean;
  /** Minimum expanded sidebar width in pixels when resizing. */
  minWidth?: number;
  /** Maximum expanded sidebar width in pixels when resizing. */
  maxWidth?: number;
  /** Dragging below this width collapses the sidebar instead of resizing. */
  collapseThreshold?: number;
  /** Whether the sidebar registers itself as the app's automatic toggle trigger. */
  autoTrigger?: boolean;
}

/**
 Provider component for the Sidebar that manages state and configuration. Must wrap the entire application to enable sidebar functionality.

 @category UI Component
 @param props.children Child nodes to render inside the provider
 @param props.defaultOpen Whether the sidebar should be open by default
 @param props.width Width of the expanded sidebar in pixels
 */
Sidebar.Provider = function SidebarProvider(props: SidebarProviderProps) {
  const {
    children,
    defaultOpen = false,
    width = 300,
    resizable = false,
    minWidth = 240,
    maxWidth = 560,
    collapseThreshold = 220,
    autoTrigger = false,
    shell,
  } = props;
  const app = useApp();
  app.addGlobalStyle({
    ":root": {
      "--sidebar-background": "0 0% 98%",
      "--sidebar-foreground": "240 5.3% 26.1%",
      "--sidebar-primary": "240 5.9% 10%",
      "--sidebar-primary-foreground": "0 0% 98%",
      "--sidebar-accent": "240 4.8% 95.9%",
      "--sidebar-accent-foreground": "240 5.9% 10%",
      "--sidebar-border": "220 13% 91%",
      "--sidebar-width": `${width}px`,
      "--sidebar-collapsed-width": `${SIDEBAR_COLLAPSED_WIDTH}px`,
    },
    ".dark": {
      "--sidebar-background": "240 5.9% 10%",
      "--sidebar-foreground": "240 4.8% 95.9%",
      "--sidebar-primary": "224.3 76.3% 48%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent": "240 3.7% 15.9%",
      "--sidebar-accent-foreground": "240 4.8% 95.9%",
      "--sidebar-border": "240 3.7% 15.9%",
    },
  });

  addCtx(new SidebarCtx(true, shell ? false : autoTrigger));
  const shellCtx = shell
    ? new SidebarShellCtx(shell.brand, shell.account)
    : undefined;
  if (shellCtx) addCtx(shellCtx);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(SIDEBAR_OPEN_SCALAR, defaultOpen);
        s.defScalar(SIDEBAR_RESIZABLE_SCALAR, resizable);
        s.defScalar(SIDEBAR_WIDTH_SCALAR, width);
        s.defScalar(SIDEBAR_RESIZING_SCALAR, false);
        s.defScalar(SIDEBAR_MIN_WIDTH_SCALAR, minWidth);
        s.defScalar(SIDEBAR_COLLAPSE_THRESHOLD_SCALAR, collapseThreshold);
        s.defScalar("sidebar_resize_start_x", 0);
        s.defScalar("sidebar_resize_start_width", width);
        s.defScalar(MOBILE_DRAWER_OPEN_SCALAR, false);
        s.getCookie(SIDEBAR_COOKIE_NAME, "cookieValue");
        s.setScalar(
          "sidebar_open",
          sql`case
            when cookieValue.value = 'true' then true
            when cookieValue.value = 'false' then false
            else sidebar_open
          end`,
        );
        s.defScalar(SIDEBAR_READ_REFRESH_KEY, 0);
      }}
    >
      {shell && (
        <Effect
          watch={sql`location.pathname`}
          onChange={useSidebar().mobileDrawerClose}
        />
      )}
      {shellCtx && (
        <EventHandlers
          window={{
            resize: (s) => {
              s.returnIf(sql`not mobile_drawer_open`);
              s.element(sql.lit(shellCtx.mobileHeaderId)).getBoundingClientRect(
                "mobile_header_bounds",
              );
              s.if(sql`mobile_header_bounds.width = 0`, (s) => {
                useSidebar().mobileDrawerClose(s);
                s.commitUiTreeChanges();
                s.element(sql.lit("sidebar-root")).focus();
              });
            },
          }}
        />
      )}
      {resizable && (
        <EventHandlers
          document={{
            mouseMove: (s) => {
              s.if(sql`${sql(SIDEBAR_RESIZING_SCALAR)}`, (s) => {
                s.event.preventDefault();
                s.defScalar(
                  "sidebar_new_width",
                  sql`sidebar_resize_start_width + (event.client_x - sidebar_resize_start_x)`,
                );
                s.if(sql`sidebar_new_width < ${collapseThreshold}`, (s) => {
                  s.setScalar(SIDEBAR_OPEN_SCALAR, false);
                }).else((s) => {
                  s.setScalar(SIDEBAR_OPEN_SCALAR, true);
                  s.setScalar(
                    SIDEBAR_WIDTH_SCALAR,
                    sql`greatest(${minWidth}, least(sidebar_new_width, ${maxWidth}))`,
                  );
                });
              });
            },
            mouseUp: (s) => {
              s.if(sql`${sql(SIDEBAR_RESIZING_SCALAR)}`, (s) => {
                s.setScalar(SIDEBAR_RESIZING_SCALAR, false);
              });
            },
          }}
        />
      )}
      <div
        sx={styles.provider}
        style={{
          "--sidebar-width": sql`${sql(SIDEBAR_WIDTH_SCALAR)} || 'px'`,
          "user-select": sql`case when ${
            sql(SIDEBAR_RESIZING_SCALAR)
          } then 'none' else 'auto' end`,
        }}
      >
        {children}
      </div>
    </Data>
  );
};

export interface SidebarProps {
  children: Node;
  /** Pinned shortcuts in the collapsed shell, in the root's data scope. */
  rail?: Node;
  variant?: Variant;
  collapsible?: SidebarCollapsible;
  sx?: Style;
  color?: ColorPaletteProp | "harmonize";
  harmonize?: boolean;
  /** Data procedure evaluated once before the responsive sidebar branches. */
  procedure?: StateStatementsOrFn;
}

/**
 A root component for the Sidebar that contains the sidebar content. Handles collapsible behavior and mobile drawer.

 @category UI Component
 @param props.children Child nodes to render inside the sidebar
 @param props.variant Variant of the sidebar
 @param props.color Color palette of the sidebar
 @param props.collapsible Whether the sidebar should be collapsible
 @param props.sx Additional styles to apply
 @param props.harmonize Whether to harmonize with theme colors

 */
Sidebar.Root = function SidebarRoot(props: SidebarProps) {
  const {
    children: navigation,
    variant = "plain",
    color = "neutral",
    collapsible = "always",
    sx = {},
    harmonize = false,
    procedure,
  } = props;
  const shell = useOptionalICtx(SidebarShellICtxKey);
  const collapsedRail = shell
    ? {
      width: 48,
      content: <SidebarShellRail shortcuts={props.rail} />,
    }
    : undefined;
  const children = shell
    ? (
      <>
        {navigation}
        <Sidebar.Footer sx={{ height: "auto", p: 1 }}>
          {shell.account({ compact: false, placement: "top-start" })}
        </Sidebar.Footer>
      </>
    )
    : navigation;
  const gatherCtx = new GatherOptionsCtx();
  gatherCtx.variant = variant;
  gatherCtx.color = color;
  gatherCtx.collapsible = collapsedRail ? "always" : collapsible;
  addCtx(gatherCtx);
  const collapsibleWidth = collapsedRail
    ? `${collapsedRail.width}px`
    : collapsible === "icon"
    ? "var(--sidebar-collapsed-width)"
    : "0px";
  const collapsedLeft = collapsedRail || collapsible === "icon"
    ? "0px"
    : "calc(var(--sidebar-width) * -1)";
  return (
    <Data
      statusScalar="status"
      hasDataScalar="has_data"
      watch={[sql(SIDEBAR_READ_REFRESH_KEY)]}
      procedure={procedure ?? (() => {})}
      pendingFallback={null}
    >
      <Sheet
        variant={variant}
        color={color}
        harmonize={harmonize}
        id="sidebar-root"
        tabIndex={shell ? -1 : undefined}
        aria-label={shell ? navigationText("navigation") : undefined}
        sx={[styles.sidebar, sx, {
          display: "none",
          lg: { display: "flex" },
          md: { display: "flex" },
          ...(collapsedRail
            ? {
              flexShrink: 0,
              height: "calc(100dvh - var(--keyboard-inset, 0px))",
              transition: "width 280ms ease-in-out",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }
            : {}),
        }]}
        style={{
          ...(collapsedRail
            ? {
              "--sidebar-content-delay":
                sql`case when sidebar_open then '100ms' else '0ms' end`,
              "--sidebar-rail-delay":
                sql`case when sidebar_open then '0ms' else '180ms' end`,
            }
            : {}),
          left: sql`case ${
            sql(SIDEBAR_OPEN_SCALAR)
          } when true then '0px' else ${sql.lit(collapsedLeft)} end`,
          width: sql`case ${
            sql(SIDEBAR_OPEN_SCALAR)
          } when true then 'var(--sidebar-width)' else ${
            sql.lit(collapsibleWidth)
          } end`,
        }}
      >
        <Switch>
          <Match
            when={sql`not has_data and status = 'failed'`}
          >
            <Alert variant="soft" color="danger" startIcon="Error">
              Unable to load sidebar
            </Alert>
          </Match>
          <Match
            when={sql`not has_data and status in ('delayed', 'fallback_triggered')`}
          >
            <div
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
              }}
            >
              <CircularProgress size="md" />
            </div>
          </Match>
          <Match when={sql.true}>
            {collapsedRail
              ? (
                <div
                  aria-hidden={sql`not sidebar_open`}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    width: "var(--sidebar-width)",
                    height: "100%",
                    minHeight: 0,
                    flexShrink: 0,
                    transition:
                      "opacity 180ms ease-in var(--sidebar-content-delay), visibility 0s linear var(--sidebar-rail-delay)",
                    "@media (prefers-reduced-motion: reduce)": {
                      transition: "none",
                    },
                  }}
                  style={{
                    opacity: sql`case when sidebar_open then '1' else '0' end`,
                    visibility:
                      sql`case when sidebar_open then 'visible' else 'hidden' end`,
                    "pointer-events":
                      sql`case when sidebar_open then 'auto' else 'none' end`,
                  }}
                >
                  {children}
                </div>
              )
              : children}
          </Match>
        </Switch>
        {collapsedRail && (
          <div
            aria-hidden={sql`sidebar_open`}
            sx={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: collapsedRail.width,
              transition:
                "opacity 100ms ease var(--sidebar-rail-delay), visibility 0s linear var(--sidebar-content-delay)",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
            style={{
              opacity: sql`case when sidebar_open then '0' else '1' end`,
              visibility:
                sql`case when sidebar_open then 'hidden' else 'visible' end`,
              "pointer-events":
                sql`case when sidebar_open then 'none' else 'auto' end`,
            }}
          >
            {collapsedRail.content}
          </div>
        )}
        <Show
          when={sql`${sql(SIDEBAR_RESIZABLE_SCALAR)} and ${
            sql(SIDEBAR_OPEN_SCALAR)
          }`}
        >
          <div
            role="separator"
            aria-label="Resize sidebar"
            className="flex-shrink-0 cursor-col-resize hover:bg-primary-200 active:bg-primary-300 transition-colors"
            style={{
              width: "4px",
              position: "absolute",
              top: "0",
              right: "0",
              bottom: "0",
            }}
            sx={{
              backgroundColor: "divider",
              dark: {
                "&:hover": { backgroundColor: "primary-700" },
                "&:active": { backgroundColor: "primary-600" },
              },
            }}
            onMouseDown={(s) => {
              s.event.preventDefault();
              s.setScalar(SIDEBAR_RESIZING_SCALAR, true);
              s.setScalar("sidebar_resize_start_x", sql`event.client_x`);
              s.setScalar(
                "sidebar_resize_start_width",
                sql(SIDEBAR_WIDTH_SCALAR),
              );
            }}
          />
        </Show>
      </Sheet>
      <Show
        when={sql`${sql(SIDEBAR_RESIZABLE_SCALAR)} and not ${
          sql(SIDEBAR_OPEN_SCALAR)
        }`}
      >
        <div
          role="separator"
          aria-label="Resize sidebar"
          className="flex-shrink-0 cursor-col-resize hover:bg-primary-200 active:bg-primary-300 transition-colors"
          style={{
            width: "4px",
            height: "100vh",
          }}
          sx={{
            backgroundColor: "divider",
            dark: {
              "&:hover": { backgroundColor: "primary-700" },
              "&:active": { backgroundColor: "primary-600" },
            },
          }}
          onMouseDown={(s) => {
            s.event.preventDefault();
            s.setScalar(SIDEBAR_OPEN_SCALAR, true);
            s.setScalar(SIDEBAR_WIDTH_SCALAR, sql(SIDEBAR_MIN_WIDTH_SCALAR));
            s.setScalar(SIDEBAR_RESIZING_SCALAR, true);
            s.setScalar("sidebar_resize_start_x", sql`event.client_x`);
            s.setScalar(
              "sidebar_resize_start_width",
              sql(SIDEBAR_COLLAPSE_THRESHOLD_SCALAR),
            );
          }}
        />
      </Show>
      <Drawer
        bindScalar={MOBILE_DRAWER_OPEN_SCALAR}
        direction="left"
        className="w-[var(--sidebar-width)]"
        sx={{ width: "var(--sidebar-width)", minWidth: 0, padding: 0 }}
      >
        <Sheet
          sx={{
            ...styles.sidebar,
            ...sx,
            "--sidebar-width": "100%",
            width: "100%",
          }}
          variant={variant}
          color={color}
          harmonize={harmonize}
        >
          <Switch>
            <Match when={sql`not has_data and status = 'failed'`}>
              <Alert variant="soft" color="danger" startIcon="Error">
                Unable to load sidebar
              </Alert>
            </Match>
            <Match when={sql.true}>
              {children}
            </Match>
          </Switch>
        </Sheet>
      </Drawer>
    </Data>
  );
};

/**
 Bumps the sidebar's internal watch key from within a procedure, forcing
 {@link Sidebar.Root} (and any `Data` watching {@link Sidebar.watchKeySql}) to
 refetch. Call after a mutation that changes what the sidebar should show.

 @category UI Component
 */
Sidebar.refresh = function SidebarRefresh<T extends IStatementsBase>(s: T) {
  s.increment(SIDEBAR_READ_REFRESH_KEY);
};

/** Name of the UI scalar the sidebar watches to trigger a refetch. */
Sidebar.watchKey = SIDEBAR_READ_REFRESH_KEY;
/** SQL reference to {@link Sidebar.watchKey}, for use in a `Data` `watch` array. */
Sidebar.watchKeySql = sql(SIDEBAR_READ_REFRESH_KEY);

export interface SidebarHeaderProps {
  /** App title beside the configured brand mark in shell mode. */
  title?: Node;
  /** Optional second line, such as the company name. */
  subtitle?: Node;
  /** Inline controls between the brand and collapse button. */
  actions?: Node;
  /** Extra controls below the branding row in shell mode. */
  children?: Node;
  sx?: Style;
  className?: string;
}

/**
 The header component for the Sidebar.
 Renders content at the top of the sidebar.
 Only visible when sidebar is expanded or in mobile drawer.

 @category UI Component
 @param props.children The content to render in the header
 @param props.sx Additional styles to apply to the header
 */
Sidebar.Header = function SidebarHeader(props: SidebarHeaderProps) {
  const { children, sx = {}, className } = props;
  const shell = useOptionalICtx(SidebarShellICtxKey);
  const ctx = useICtx(GatherOptionsICtxKey);
  return (
    <Show when={collapsibleCondition(ctx)}>
      <div
        sx={[styles.header, {
          width: "var(--sidebar-width)",
          ...(shell
            ? {
              flexDirection: "column",
              alignItems: "stretch",
              gap: "8px",
              pl: 4,
              pr: 2,
              py: 2,
              minHeight: 56,
              height: "auto",
            }
            : {}),
        }, sx]}
        className={className}
      >
        {shell
          ? (
            <>
              <div
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <SidebarBrandHeader
                  title={props.title}
                  subtitle={props.subtitle}
                />
                {props.actions}
                <SidebarShellControls />
              </div>
              {children}
            </>
          )
          : children}
      </div>
    </Show>
  );
};

export interface SidebarFooterProps {
  children?: Node;
  sx?: Style;
  className?: string;
}

/**
 The footer component for the Sidebar.
 Renders content at the bottom of the sidebar.
 Only visible when sidebar is expanded or in mobile drawer.

 @category UI Component
 @param props.children The content to render in the footer
 @param props.sx Additional styles to apply to the footer
 */
Sidebar.Footer = function SidebarFooter(props: SidebarFooterProps) {
  const { children, sx = {}, className } = props;
  const ctx = useICtx(GatherOptionsICtxKey);
  return (
    <Show when={collapsibleCondition(ctx)}>
      <div
        sx={[styles.footer, sx, { width: "var(--sidebar-width)" }]}
        className={className}
      >
        {children}
      </div>
    </Show>
  );
};

/**
 Renders the settings dropdown menu for the Sidebar,
 allowing users to change the color mode (light, system, dark) and log out if available.
 Only visible when color scheme is managed via cookies.

 @category UI Component
 */
Sidebar.Settings = function SidebarSettings() {
  const logout = useOptionalICtx(LogoutICtxKey);
  const ctx = useICtx(GatherOptionsICtxKey);
  const colorSchemeRecord = `sidebar_color_scheme_${getUniqueUiId()}`;
  return (
    <Show
      when={sql.or(
        sql(SIDEBAR_OPEN_SCALAR),
        ctx.collapsible === "always" ? sql.true : sql.false,
        sql(MOBILE_DRAWER_OPEN_SCALAR),
      )}
    >
      <Sidebar.DropdownMenu>
        <Sidebar.DropdownMenuTrigger>
          <Button
            variant="soft"
            startIcon="Settings"
            endIcon="KeyboardArrowRight"
            sx={{ width: "100%" }}
          >
            Settings
          </Button>
        </Sidebar.DropdownMenuTrigger>
        <Sidebar.DropdownMenuContent
          width={350}
          sx={{ padding: 3 }}
          placement="right-start"
        >
          {useApp().colorSchemeType === "cookie" && (
            <Data
              local
              watch={[sql`color_scheme_refresh_key`]}
              procedure={(s) => {
                s.getCookie(sql.lit`color_scheme`, colorSchemeRecord);
              }}
            >
              <FormControl>
                <FormLabel>Color mode</FormLabel>
                <ButtonGroup>
                  <Button
                    variant="outlined"
                    startIcon="LightMode"
                    sx={{
                      "&[aria-selected='true']": getVariantStyle(
                        "soft",
                        ctx.color,
                        "active",
                      ),
                    }}
                    aria-selected={sql`${
                      sql.ref(colorSchemeRecord)
                    }.value = 'light'`}
                    onClick={(s) => {
                      s.setCookie(sql.lit`color_scheme`, sql.lit`light`, {
                        expires: sql`date.add(year, 1, now())`,
                      });
                      s.increment("ui.color_scheme_refresh_key");
                    }}
                  >
                    Light
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon="SettingsBrightness"
                    sx={{
                      "&[aria-selected='true']": getVariantStyle(
                        "soft",
                        ctx.color,
                        "active",
                      ),
                    }}
                    aria-selected={sql`${
                      sql.ref(colorSchemeRecord)
                    }.value = 'system' or ${
                      sql.ref(colorSchemeRecord)
                    }.value is null`}
                    onClick={(s) => {
                      s.removeCookie(sql.lit`color_scheme`);
                      s.increment("ui.color_scheme_refresh_key");
                    }}
                  >
                    System
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon="DarkModeOutlined"
                    sx={{
                      "&[aria-selected='true']": getVariantStyle(
                        "soft",
                        ctx.color,
                        "active",
                      ),
                    }}
                    aria-selected={sql`${
                      sql.ref(colorSchemeRecord)
                    }.value = 'dark'`}
                    onClick={(s) => {
                      s.setCookie(sql.lit`color_scheme`, sql.lit`dark`, {
                        expires: sql`date.add(year, 1, now())`,
                      });
                      s.increment("ui.color_scheme_refresh_key");
                    }}
                  >
                    Dark
                  </Button>
                </ButtonGroup>
              </FormControl>
            </Data>
          )}
          <DisplayCurrentUser />
          {logout && (
            <div className="flex mt-2">
              <Button
                variant="soft"
                startIcon="Logout"
                size="sm"
                onClick={logout.logout}
              >
                Log out
              </Button>
            </div>
          )}
        </Sidebar.DropdownMenuContent>
      </Sidebar.DropdownMenu>
    </Show>
  );
};

export interface SidebarContentProps {
  children?: Node;
  sx?: Style;
}

/**
 The content component for the Sidebar.
 Renders the main content of the sidebar.

 @category UI Component
 @param props.children The content to render in the content
 @param props.sx Additional styles to apply to the content
 */
Sidebar.Content = function SidebarContent(props: SidebarContentProps) {
  const { children, sx = {} } = props;
  const ctx = useICtx(GatherOptionsICtxKey);
  const sidebarItems = useSharedContext(SidebarItemsSharedContext);
  return (
    <div
      sx={[styles.content(ctx.color as ColorPaletteProp), sx, {
        width: "var(--sidebar-width)",
      }]}
    >
      {children}
      {sidebarItems.items.length > 0 &&
        [...sidebarItems.items]
          .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
          .map((group) => (
            <Sidebar.Group
              label={group.section}
              requiredPermission={group.requiredPermission}
            >
              <Sidebar.Menu>
                {group.items?.map((item) => (
                  <Sidebar.MenuItem
                    requiredPermission={item.requiredPermission}
                  >
                    <Sidebar.MenuButton
                      href={item.href}
                      icon={item.icon as IconName}
                    >
                      {item.label}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                ))}
              </Sidebar.Menu>
            </Sidebar.Group>
          ))}
    </div>
  );
};

export interface SidebarGroupProps {
  children?: Node;
  label?: Node;
  sx?: Style;
  requiredPermission?: string;
  className?: string;
}

/**
 The group component for the Sidebar.
 Renders a group of menu items with an optional label.

 @category UI Component
 @param props.children The content to render in the group
 @param props.label The label to display for the group
 @param props.sx Additional styles to apply to the group
 @param props.requiredPermission The permission required to access the group
 */
Sidebar.Group = function SidebarGroup(props: SidebarGroupProps) {
  const { children, label, sx = {}, requiredPermission, className } = props;
  const ctx = useICtx(GatherOptionsICtxKey);
  const content = (
    <div sx={[styles.group, sx]} className={className}>
      {label && (
        <Show
          when={sql.or(
            sql(SIDEBAR_OPEN_SCALAR),
            ctx.collapsible === "always" ? sql.true : sql.false,
            sql(MOBILE_DRAWER_OPEN_SCALAR),
          )}
        >
          <Typography
            level="body-sm"
            sx={{ paddingLeft: "1.2rem", fontWeight: 600 }}
            color={ctx.color}
            variant={ctx.variant}
          >
            {label}
          </Typography>
        </Show>
      )}
      {children}
    </div>
  );
  if (!requiredPermission) {
    return content;
  }
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "has_perm",
          currentUserHasPermission(sql.lit(requiredPermission)),
        );
      }}
      pendingFallback={null}
      errorFallback={null}
    >
      <Show when={sql`has_perm`}>{content}</Show>
    </Data>
  );
};

export interface SidebarMenuProps {
  children?: Node;
  sx?: Style;
  /** Whether item icons remain visible when the sidebar is collapsed to icon width. */
  showIconsInCollapsed?: boolean;
}

export interface SidebarMenuSubProps {
  children?: Node;
  sx?: Style;
}

/**
 The submenu component for the Sidebar.
 Renders a submenu of menu items.

 @category UI Component
 @param props.children The content to render in the submenu
 @param props.sx Additional styles to apply to the submenu
 */
Sidebar.MenuSub = function SidebarMenuSub(props: SidebarMenuSubProps) {
  const { children, sx = {} } = props;
  const ctx = useICtx(GatherOptionsICtxKey);
  return (
    <List
      sx={[styles.menuSub(ctx.color as ColorPaletteProp), sx]}
      variant={ctx.variant}
      color={ctx.color}
      size="sm"
    >
      {children}
    </List>
  );
};

export interface SidebarMenuSubItemProps {
  children?: Node;
  sx?: Style;
}

/**
 The submenu item component for the Sidebar.
 Renders a single menu item within a submenu.

 @category UI Component
 @param props.children The content to render in the submenu item
 @param props.sx Additional styles to apply to the submenu item
 */
Sidebar.MenuSubItem = function SidebarMenuSubItem(
  props: SidebarMenuSubItemProps,
) {
  const { children, sx = {} } = props;
  return (
    <ListItem sx={sx} size="sm">
      {children}
    </ListItem>
  );
};

export interface SidebarMenuSubButtonProps {
  children?: Node;
  icon?: IconName;
  href?: Sql | string;
  active?: BooleanExpr;
  onClick?: (s: DomStatements) => void;
  sx?: Style;
}

/**
 The submenu button component for the Sidebar.
 Renders a button that navigates to a different route or works as simple button with onClick.

 @category UI Component
 @param props.children The content to render in the submenu button
 @param props.icon The icon to display in the submenu button
 @param props.href The href to navigate to when the button is clicked
 @param props.active Whether the button is active
 @param props.onClick The function to call when the button is clicked
 @param props.sx Additional styles to apply to the submenu button
 */
Sidebar.MenuSubButton = function SidebarMenuSubButton(
  props: SidebarMenuSubButtonProps,
) {
  const { children, icon, href, active, onClick: originalOnClick, sx = {} } =
    props;
  const onClick = sidebarNavigationClick(href, originalOnClick);
  const ctx = useICtx(GatherOptionsICtxKey);
  const hrefExpr = typeof href === "string"
    ? sql.lit(href)
    : (href ?? sql.lit("href"));
  const activeHrefExpr = hrefPathExpr(hrefExpr);
  return (
    <ListItemButton
      href={href}
      onClick={onClick}
      sx={{
        ...sx,
        fontSize: "sm",
        borderRadius: "md",
        "&[aria-selected='true']": getVariantStyle("soft", ctx.color, "active"),
      }}
      aria-selected={active ??
        sql`uri.is_match(location.pathname, ${activeHrefExpr})`}
      variant={ctx.variant}
      color={ctx.color}
      size="sm"
    >
      {icon && (
        <div sx={styles.menuIcon}>
          <MaterialIcon icon={icon} />
        </div>
      )}
      <span>{children}</span>
    </ListItemButton>
  );
};

/**
 The menu component for the Sidebar.
 Renders a list of menu items.

 @category UI Component
 @param props.children The content to render in the menu
 @param props.sx Additional styles to apply to the menu
 */
Sidebar.Menu = function SidebarMenu(props: SidebarMenuProps) {
  const { children, sx = {} } = props;
  return (
    <List sx={{ padding: 0, ...sx }} size="sm">
      {children}
    </List>
  );
};

export interface SidebarMenuItemProps {
  children?: Node;
  sx?: Style;
  requiredPermission?: string;
}

/**
 The menu item component for the Sidebar.
 Renders a single menu item.

 @category UI Component
 @param props.children The content to render in the menu item
 @param props.sx Additional styles to apply to the menu item
 @param props.requiredPermission The permission required to access the menu item
 */
Sidebar.MenuItem = function SidebarMenuItem(props: SidebarMenuItemProps) {
  const { children, sx = {}, requiredPermission } = props;
  const content = (
    <ListItem
      sx={{ paddingTop: 1, paddingBottom: 1, display: "block", ...sx }}
      size="sm"
    >
      {children}
    </ListItem>
  );
  if (!requiredPermission) {
    return content;
  }
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "has_perm",
          currentUserHasPermission(sql.lit(requiredPermission)),
        );
      }}
      pendingFallback={null}
      errorFallback={null}
    >
      <Show when={sql`has_perm`}>{content}</Show>
    </Data>
  );
};

export interface SidebarMenuButtonProps {
  children?: Node;
  icon?: IconName;
  href?: Sql | string;
  active?: BooleanExpr;
  onClick?: (s: DomStatements) => void;
  sx?: Style;
  color?: ColorPaletteProp;
  variant?: Variant;
  /** Render a non-link action with native button semantics. */
  component?: "button";
}

/**
 The menu button component for the Sidebar.
 Renders a button that navigates to a different route or works as simple button with onClick.

 @category UI Component
 @param props.children The content to render in the menu button
 @param props.icon The icon to display in the menu button
 @param props.href The href to navigate to when the button is clicked
 @param props.active Whether the button is active
 @param props.onClick The function to call when the button is clicked
 @param props.sx Additional styles to apply to the menu button
 @param props.color The color of the menu button
 @param props.variant The variant of the menu button
 */
Sidebar.MenuButton = function SidebarMenuButton(props: SidebarMenuButtonProps) {
  const {
    children,
    icon,
    href,
    active,
    onClick: originalOnClick,
    sx = {},
    color,
    variant,
    component,
  } = props;
  const onClick = sidebarNavigationClick(href, originalOnClick);
  const ctx = useICtx(GatherOptionsICtxKey);
  const hrefExpr = typeof href === "string"
    ? sql.lit(href)
    : (href ?? sql.lit("href"));
  const activeHrefExpr = hrefPathExpr(hrefExpr);
  return (
    <>
      {icon && (
        <Show when={collapsibleIconsCondition(ctx)}>
          <IconButton
            icon={icon}
            tooltip={children}
            variant={ctx.variant}
            href={href}
            color={ctx.color}
            onClick={onClick}
            tooltipProps={{
              placement: "right",
            }}
          />
        </Show>
      )}
      <Show when={collapsibleCondition(ctx)}>
        <ListItemButton
          component={component}
          href={href}
          onClick={onClick}
          sx={{
            ...sx,
            borderRadius: "md",
            "&[aria-selected='true']": getVariantStyle(
              "soft",
              ctx.color,
              "active",
            ),
          }}
          aria-selected={active ??
            sql`uri.is_match(location.pathname, ${activeHrefExpr})`}
          variant={variant ?? ctx.variant}
          color={color ?? ctx.color}
          size="sm"
        >
          {icon && (
            <div sx={styles.menuIcon}>
              <MaterialIcon icon={icon} />
            </div>
          )}
          {children}
        </ListItemButton>
      </Show>
    </>
  );
};

export interface SidebarTriggerProps {
  icon?: IconName;
  size?: Size;
  sx?: Style;
  /** Optional condition for rendering the desktop trigger. Mobile behavior is unchanged. */
  desktopWhen?: BooleanExpr;
}

/**
 * Renders the sidebar trigger only when the surrounding provider enables
 * `autoTrigger`. Outside a sidebar provider, it renders nothing.
 */
Sidebar.AutoTrigger = function SidebarAutoTrigger() {
  const sidebar = useOptionalICtx(SidebarPresenceICtxKey);
  return sidebar?.autoTrigger ? <Sidebar.Trigger /> : null;
};

/**
 The trigger component for the Sidebar.
 Renders a button to toggle the sidebar.

 @category UI Component
 @param props.icon The icon to display in the trigger
 @param props.size The size of the trigger
 @param props.sx Additional styles to apply to the trigger
 */
Sidebar.Trigger = function SidebarTrigger(props: SidebarTriggerProps) {
  if (useOptionalICtx(SidebarShellICtxKey)) return null;
  const { icon, size = "sm", sx = {}, desktopWhen = sql.true } = props;
  return (
    <>
      <Show when={desktopWhen}>
        {icon
          ? (
            <IconButton
              icon={icon}
              variant="plain"
              color={useDefaultColor("neutral")}
              size={size}
              onClick={useSidebar().sidebarToggle}
              sx={{
                ...sx,
                display: "none",
                lg: { display: "block" },
                md: { display: "block" },
              }}
              aria-label="Toggle sidebar"
            />
          )
          : (
            <IconButton
              variant="plain"
              color={useDefaultColor("neutral")}
              size={size}
              onClick={useSidebar().sidebarToggle}
              sx={{
                ...sx,
                display: "none",
                lg: { display: "block" },
                md: { display: "block" },
              }}
              aria-label="Toggle sidebar"
            >
              <SidebarIcon
                fontSize={size === "lg" ? "lg" : "inherit"}
              />
            </IconButton>
          )}
      </Show>
      <IconButton
        icon="Menu"
        variant="plain"
        color="neutral"
        size={size}
        onClick={useSidebar().mobileDrawerToggle}
        sx={{
          ...sx,
          display: "block",
          lg: { display: "none" },
          md: { display: "none" },
        }}
        aria-label="Toggle sidebar"
      />
    </>
  );
};

export interface SidebarCollapsibleProps {
  label: Node;
  children: Node;
  defaultOpen?: Sql<boolean>;
  icon?: IconName;
}

/**
 The collapsible component for the Sidebar.
 Renders a collapsible section with a label and an icon.

 @category UI Component
 @param props.label The label to display in the collapsible section
 @param props.children The content to render in the collapsible section
 @param props.icon The icon to display in the collapsible section
 */
Sidebar.Collapsible = function SidebarCollapsible(
  props: SidebarCollapsibleProps,
) {
  const { children, label, icon, defaultOpen = false } = props;
  const ctx = useICtx(GatherOptionsICtxKey);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("open", { type: "Bool", expr: defaultOpen });
      }}
    >
      {icon && (
        <Show when={collapsibleIconsCondition(ctx)}>
          <IconButton
            icon={icon}
            tooltip={label}
            variant={ctx.variant}
            color={ctx.color}
            onClick={(s) => s.toggle("open")}
            tooltipProps={{
              placement: "right",
            }}
          />
        </Show>
      )}
      <Show when={collapsibleCondition(ctx)}>
        <div sx={styles.collapsible}>
          <ListItemButton
            onClick={(s) => s.toggle("open")}
            onKeyDown={(s) => {
              s.if(sql`event.key = 'Enter' or event.key = ' '`, (s) => {
                s.toggle("open");
              });
            }}
            variant={ctx.variant}
            color={ctx.color}
            sx={styles.collapsible}
          >
            {icon && (
              <div sx={styles.menuIcon}>
                <MaterialIcon icon={icon} />
              </div>
            )}
            {label}
            <div sx={flexGrowStyles} />
            <Show
              when={sql`open`}
              fallback={<MaterialIcon icon="KeyboardArrowRight" />}
            >
              <MaterialIcon icon="KeyboardArrowDown" />
            </Show>
          </ListItemButton>
          <Show when={sql`open`}>
            <div>{children}</div>
          </Show>
        </div>
      </Show>
    </Data>
  );
};

type DropdownMenuProps = {
  children: Node;
};

type DropdownMenuTriggerProps = {
  children: Node;
};

type DropdownMenuContentProps = {
  children: Node;
  sx?: Style;
  width?: number;
  placement?: FloatingOpts["placement"];
  className?: string;
};

/**
 The dropdown menu component for the Sidebar.
 Renders a dropdown menu.

 @category UI Component
 @param props.children The content to render in the dropdown menu
 */
Sidebar.DropdownMenu = function DropdownMenu(props: DropdownMenuProps) {
  const { children } = props;
  gatherChildrenContextInfo(children);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("dropdown_open", false);
        s.defScalar("dropdown_anchor", useUniqueId());
      }}
    >
      <div
        style={{
          position: "relative",
          display: "block",
          width: "100%",
        }}
      >
        {children}
      </div>
    </Data>
  );
};

/**
 The dropdown menu trigger component for the Sidebar.
 Renders a trigger for the dropdown menu.

 @category UI Component
 @param props.children The content to render in the dropdown menu trigger
 */
Sidebar.DropdownMenuTrigger = function DropdownMenuTrigger({
  children,
}: DropdownMenuTriggerProps) {
  return (
    <div
      style={{ cursor: "pointer", width: "100%" }}
      onClick={(s) => s.setScalar("dropdown_open", true)}
      id={sql`dropdown_anchor`}
    >
      {children}
    </div>
  );
};

/**
 The dropdown menu content component for the Sidebar.
 Renders the content of the dropdown menu.

 @category UI Component
 @param props.children The content to render in the dropdown menu content
 @param props.width The width of the dropdown menu content
 @param props.sx Additional styles to apply to the dropdown menu content
 @param props.placement The placement of the dropdown menu content
 */
Sidebar.DropdownMenuContent = function DropdownMenuContent(
  props: DropdownMenuContentProps,
) {
  const {
    children,
    width = 200,
    sx = {},
    placement = "right-start",
    className,
  } = props;
  return (
    <div
      sx={[styles.dropdownMenu(), sx, { width }]}
      className={className}
      tabIndex={-1}
      popover="auto"
      yolmPopoverShowing={sql`dropdown_open`}
      classes="skip-harmonize"
      floating={{
        anchorEl: sql`dropdown_anchor`,
        placement: placement,
        strategy: "fixed",
        shift: { mainAxis: true, crossAxis: true },
        offset: {
          mainAxis: 10,
          crossAxis: 0,
        },
        flip: { crossAxis: false, mainAxis: false },
      }}
      onToggleHide={(s) => {
        s.setScalar("dropdown_open", false);
      }}
    >
      {children}
    </div>
  );
};

interface SidebarSearchTableButtonProps extends Omit<ButtonProps, "children"> {
  searchDialog: GlobalSearchDialogProps["searchDialog"];
  children: Node;
}

/**
 The search table button component for the Sidebar.
 Renders a button that opens a search dialog.

 @category UI Component
 @param props.children The content to render in the search table button
 @param props.searchDialog The search dialog to open when the button is clicked
 */
Sidebar.SearchTableButton = function SidebarSearchTableButton(
  props: SidebarSearchTableButtonProps,
) {
  const ctx = useICtx(GatherOptionsICtxKey);
  const {
    searchDialog,
    children,
    size = "sm",
    variant = "outlined",
    ...rest
  } = props;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("search_open", false);
      }}
    >
      <Show
        when={sql.or(
          sql(SIDEBAR_OPEN_SCALAR),
          ctx.collapsible === "always" ? sql.true : sql.false,
          sql(MOBILE_DRAWER_OPEN_SCALAR),
        )}
      >
        <Button
          size={size}
          variant={variant}
          onClick={(s) => {
            s.setScalar("search_open", true);
          }}
          {...rest}
        >
          {children}
        </Button>
        <GlobalSearchDialog
          openScalar="search_open"
          searchDialog={searchDialog}
        />
      </Show>
    </Data>
  );
};

interface SidebarMultiTableSearchButtonProps
  extends Omit<ButtonProps, "children"> {
  multiTableSearchDialog: GlobalSearchDialogProps["multiTableSearchDialog"];
  children: Node;
}

/**
 The multi table search button component for the Sidebar.
 Renders a button that opens a multi table search dialog.

 @category UI Component
 @param props.children The content to render in the multi table search button
 @param props.multiTableSearchDialog The multi table search dialog to open when the button is clicked
 */
Sidebar.MultiTableSearchButton = function SidebarMultiTableSearchButton(
  props: SidebarMultiTableSearchButtonProps,
) {
  const ctx = useICtx(GatherOptionsICtxKey);
  const {
    multiTableSearchDialog,
    children,
    size = "sm",
    variant = "outlined",
    ...rest
  } = props;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("search_open", false);
      }}
    >
      <Show
        when={sql.or(
          sql(SIDEBAR_OPEN_SCALAR),
          ctx.collapsible === "always" ? sql.true : sql.false,
          sql(MOBILE_DRAWER_OPEN_SCALAR),
        )}
      >
        <Button
          size={size}
          variant={variant}
          onClick={(s) => {
            s.setScalar("search_open", true);
          }}
          {...rest}
        >
          {children}
        </Button>
        <GlobalSearchDialog
          openScalar="search_open"
          multiTableSearchDialog={multiTableSearchDialog}
        />
      </Show>
    </Data>
  );
};

/**
 The main screen component for the Sidebar.
 Renders the main content area of the app.

 @category UI Component
 @param props.children The content to render in the main screen
 */
Sidebar.MainScreen = function MainScreen(props: { children: Node }) {
  const { children } = props;
  const shell = useOptionalICtx(SidebarShellICtxKey);
  if (shell) {
    return (
      <div
        sx={{
          flex: 1,
          minWidth: 0,
          height: "calc(100dvh - var(--keyboard-inset, 0px))",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          id={shell.mobileHeaderId}
          aria-label={navigationText("mobileNavigation")}
          sx={{
            display: "flex",
            md: { display: "none" },
            alignItems: "center",
            flexShrink: 0,
            height: 48,
            px: 1,
            gap: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
            backgroundColor: "background-body",
          }}
        >
          <IconButton
            icon="Menu"
            aria-label={navigationText("openNavigation")}
            variant="plain"
            color="neutral"
            onClick={useSidebar().mobileDrawerToggle}
            sx={{ width: 44, height: 44, "--icon-font-size": "18px" }}
          />
          <SidebarBrandMark size={20} />
          <div sx={{ marginLeft: "auto" }}>
            {shell.account({ compact: true, placement: "bottom-end" })}
          </div>
        </header>
        <div
          scrollRestoration="route"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div
      scrollRestoration="route"
      className="w-full overflow-auto flex flex-col"
      sx={{
        // The dynamic viewport unit tracks mobile URL-bar collapse (100vh
        // overflows the visible area on iOS). --keyboard-inset defaults to
        // 0px and lets apps that mirror the on-screen keyboard height into
        // it (via the chat_viewport JS module) shrink the shell above the
        // keyboard.
        height: "calc(100dvh - var(--keyboard-inset, 0px))",
        maxHeight: "calc(100dvh - var(--keyboard-inset, 0px))",
      }}
    >
      {children}
    </div>
  );
};

/**
 The useSidebar hook for the Sidebar.

 @category UI Component
 @returns The useSidebar hook
 */
export function useSidebar() {
  return {
    sidebarToggle: (s: DomStatements) => {
      s.if(
        sql`${sql(SIDEBAR_OPEN_SCALAR)} = true`,
        (s) => {
          s.setScalar(SIDEBAR_OPEN_SCALAR, false);
          s.setCookie(sql.lit`${SIDEBAR_COOKIE_NAME}`, sql`false`);
        },
        (s) => {
          s.setScalar(SIDEBAR_OPEN_SCALAR, true);
          s.setCookie(sql.lit`${SIDEBAR_COOKIE_NAME}`, sql`true`);
        },
      );
    },
    sidebarOpen: (s: DomStatements) => {
      s.setScalar(SIDEBAR_OPEN_SCALAR, true);
      s.setCookie(sql.lit`${SIDEBAR_COOKIE_NAME}`, sql`true`);
      s.setScalar(MOBILE_DRAWER_OPEN_SCALAR, true);
    },
    sidebarClose: (s: DomStatements) => {
      s.setScalar(SIDEBAR_OPEN_SCALAR, false);
      s.setCookie(sql.lit`${SIDEBAR_COOKIE_NAME}`, sql`false`);
      s.setScalar(MOBILE_DRAWER_OPEN_SCALAR, false);
    },
    mobileDrawerToggle: (s: DomStatements) => {
      s.if(
        sql`${sql(MOBILE_DRAWER_OPEN_SCALAR)} = true`,
        (s) => {
          s.setScalar(MOBILE_DRAWER_OPEN_SCALAR, false);
        },
        (s) => {
          s.setScalar(MOBILE_DRAWER_OPEN_SCALAR, true);
        },
      );
    },
    mobileDrawerClose: (s: DomStatements) => {
      s.setScalar(MOBILE_DRAWER_OPEN_SCALAR, false);
    },
    refreshSidebar: (s: DomStatements) => {
      s.increment(SIDEBAR_READ_REFRESH_KEY);
    },
  };
}

export interface SidebarRailButtonProps {
  label: string | Sql;
  icon: IconName;
  href?: string | Sql;
  onClick?: (s: DomStatements) => void;
  active?: BooleanExpr;
}

/** A pinned rail destination or action. Compose with Show for permissions. */
Sidebar.RailButton = function SidebarRailButton(props: SidebarRailButtonProps) {
  const href = typeof props.href === "string"
    ? sql.lit(props.href)
    : props.href;
  const active = props.active ??
    (href ? sql`location.pathname = ${hrefPathExpr(href)}` : sql.false);
  return (
    <IconButton
      icon={props.icon}
      aria-label={props.label}
      aria-current={sql`case when ${active} then 'page' else null end`}
      tooltip={props.label}
      tooltipProps={{ placement: "right" }}
      href={props.href}
      onClick={props.onClick}
      variant="plain"
      color="neutral"
      sx={{
        width: 36,
        height: 36,
        minWidth: 36,
        minHeight: 36,
        flexShrink: 0,
        "--icon-font-size": "18px",
        '&[aria-current="page"]': getVariantStyle("soft", "neutral", "active"),
      }}
    />
  );
};

function SidebarShellRail(props: { shortcuts?: Node }) {
  const shell = useICtx(SidebarShellICtxKey);
  return (
    <nav
      aria-label={navigationText("collapsedNavigation")}
      sx={{
        display: "none",
        md: { display: "flex" },
        flexDirection: "column",
        alignItems: "center",
        width: 48,
        flexShrink: 0,
        height: "100%",
        backgroundColor: "background-surface",
        borderRight: "1px solid",
        borderColor: "divider",
        py: 1,
      }}
    >
      <IconButton
        id={shell.railTriggerId}
        aria-expanded={sql.false}
        aria-controls="sidebar-root"
        aria-label={navigationText("expandNavigation")}
        tooltip={navigationText("expandNavigation")}
        variant="plain"
        color="neutral"
        tooltipProps={{ placement: "right" }}
        sx={{
          width: 40,
          height: 40,
          "&:hover > [data-sidebar-brand], &:focus-visible > [data-sidebar-brand]":
            {
              opacity: 0,
            },
          "&:hover > svg, &:focus-visible > svg": {
            opacity: 1,
          },
        }}
        onClick={(s) => {
          useSidebar().sidebarToggle(s);
          s.commitUiTreeChanges();
          s.element(sql.lit("sidebar-root")).focus();
        }}
      >
        <SidebarBrandMark size={20} decorative />
        <SidebarIcon
          sx={{
            width: 18,
            height: 18,
            position: "absolute",
            opacity: 0,
          }}
        />
      </IconButton>
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
          mt: 2,
          minHeight: 0,
          overflowY: "auto",
          flex: 1,
        }}
      >
        {props.shortcuts}
      </div>
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
          pt: 1,
        }}
      >
        {shell.account({ compact: true, placement: "right-end" })}
      </div>
    </nav>
  );
}

function SidebarShellControls() {
  const shell = useICtx(SidebarShellICtxKey);
  return (
    <>
      <IconButton
        size="sm"
        aria-label={navigationText("collapseNavigation")}
        tooltip={navigationText("collapseNavigation")}
        variant="plain"
        color="neutral"
        onClick={(s) => {
          useSidebar().sidebarToggle(s);
          s.commitUiTreeChanges();
          // Let the newly visible rail enter the rendered tree before focusing it.
          s.sleep(16);
          s.returnIf(sql`sidebar_open`);
          s.element(sql.lit(shell.railTriggerId)).focus();
        }}
        sx={{
          display: "none",
          md: { display: "inline-flex" },
          width: 32,
          height: 32,
        }}
      >
        <SidebarIcon sx={{ width: 18, height: 18 }} />
      </IconButton>
      <IconButton
        icon="Close"
        aria-label={navigationText("closeNavigation")}
        variant="plain"
        color="neutral"
        onClick={useSidebar().mobileDrawerClose}
        sx={{
          display: "inline-flex",
          md: { display: "none" },
          width: 44,
          height: 44,
        }}
      />
    </>
  );
}

function sidebarNavigationClick(
  href: string | Sql | undefined,
  onClick: ((s: DomStatements) => void) | undefined,
) {
  if (!useOptionalICtx(SidebarShellICtxKey) || !href) return onClick;
  return (s: DomStatements) => {
    onClick?.(s);
    useSidebar().mobileDrawerClose(s);
  };
}

function SidebarBrandMark(props: { size: number; decorative?: boolean }) {
  const { brand } = useICtx(SidebarShellICtxKey);
  const initials = brand.initials ??
    brand.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("")
      .toUpperCase();
  return (
    <span
      data-sidebar-brand="mark"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: props.size,
        height: props.size,
        flexShrink: 0,
      }}
    >
      {brand.logo
        ? (
          <img
            src={brand.logo}
            alt={props.decorative ? "" : brand.name}
            sx={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        )
        : (
          <span
            role={props.decorative ? undefined : "img"}
            aria-label={props.decorative ? undefined : brand.name}
            aria-hidden={props.decorative ? sql.true : undefined}
            sx={{ fontSize: "11px", fontWeight: 600, lineHeight: 1 }}
          >
            {initials}
          </span>
        )}
    </span>
  );
}

function SidebarBrandHeader(props: { title?: Node; subtitle?: Node }) {
  const { brand } = useICtx(SidebarShellICtxKey);
  return (
    <div
      sx={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        minWidth: 0,
        flex: 1,
      }}
    >
      {brand.wordmark && props.title === undefined
        ? (
          <div sx={{ minWidth: 0 }}>
            <img
              src={brand.wordmark}
              alt={brand.name}
              sx={{
                height: 32,
                width: "auto",
                maxWidth: "100%",
                objectFit: "contain",
                objectPosition: "left center",
                minWidth: 0,
              }}
            />
            {props.subtitle && (
              <div className="truncate text-xs text-tertiary">
                {props.subtitle}
              </div>
            )}
          </div>
        )
        : (
          <>
            <SidebarBrandMark size={24} decorative />
            <div sx={{ minWidth: 0 }}>
              <div
                sx={{
                  fontSize: "16px",
                  fontWeight: 600,
                  lineHeight: "24px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {props.title ?? brand.name}
              </div>
              {props.subtitle && (
                <div
                  sx={{
                    fontSize: "12px",
                    lineHeight: "16px",
                    color: "text-tertiary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {props.subtitle}
                </div>
              )}
            </div>
          </>
        )}
    </div>
  );
}
