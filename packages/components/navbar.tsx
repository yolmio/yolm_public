import { Button, buttonSizeStyles } from "components/button";
import type { ButtonProps } from "components/button";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import type { Size } from "components/types";
import { HarmonizeICtxKey } from "std/ictx";
import { upcaseFirst } from "std/inflectors";
import { NavigationItemsSharedContext } from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import type { Style } from "std/style_types";
import {
  createHarmonizeVars,
  createStyles,
  cssVar,
  getVariantStyle,
} from "std/style_utils";
import type { ColorPaletteProp } from "std/theme";
import { Data } from "std/data";
import {
  Conditional,
  EventHandlers,
  omitICtxs,
  Show,
  useSharedContext,
} from "std/ui";
import { Divider } from "./divider";
import { Drawer } from "./drawer";
import { GlobalSearchDialog } from "./global_search_dialog";
import type { GlobalSearchDialogProps } from "./global_search_dialog";
import { List, ListItemButton } from "./list";
import { SettingsDrawer } from "./settings_drawer";
import { Typography } from "./typography";

interface LinkItem {
  label?: string;
  url: string;
  showIf?: BooleanExpr;
}

interface LinkItemWithChildren {
  label: string;
  showIf?: BooleanExpr;
  children: (string | LinkItem)[];
}

interface NavbarProps extends Omit<GlobalSearchDialogProps, "openScalar"> {
  variant?: "soft" | "solid";
  color?: ColorPaletteProp;
  size?: Size;
  links?: (string | LinkItem | LinkItemWithChildren)[];
  primaryActionButton?: ButtonProps;
  linkAlignment?: "left" | "center" | "right";
  manual?: boolean;
  className?: string;
  sx?: Style;
}

const styles = createStyles({
  root: (app, variant: "soft" | "solid", color: ColorPaletteProp) => {
    app.addGlobalStyle({
      "::view-transition-new(navbar)": {
        animation: "none",
      },
      ":root": {
        "--page-header-height": "64px",
      },
    });
    return {
      ...getVariantStyle(variant, color),
      ...createHarmonizeVars(variant, color),
      display: "flex",
      position: "relative",
      alignItems: "center",
      px: 2,
      py: 4,
      sm: { px: 4 },
      lg: { px: 6 },
      viewTransitionName: "navbar",
    };
  },
  menuIcon: {
    display: "block",
    flexGrow: 1,
    lg: { display: "none" },
  },
  links: ({ theme }, linkAlignment: "left" | "center" | "right") => {
    return {
      display: "none",
      flexGrow: 1,
      gap: 3,
      "&:focus-visible": theme.focus.default,
      lg: {
        display: "flex",
        justifyContent: linkAlignment === "center"
          ? "center"
          : linkAlignment === "right"
          ? "flex-end"
          : "flex-start",
      },
    };
  },
  navRight: {
    display: "flex",
    gap: 3,
  },
  searchButton: ({ theme }, size: Size) => {
    return {
      appearance: "none",
      "--icon-margin-top": "initial", // reset the icon's margin.
      "--icon-margin-right": "initial",
      "--icon-margin-bottom": "initial",
      "--icon-margin-left": "initial",
      WebkitTapHighlightColor: "transparent",
      borderRadius: cssVar("radius-sm"),
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      fontFamily: cssVar("font-family-body"),
      fontWeight: "semibold",
      lineHeight: 1,
      "&:focus-visible": theme.focus.default,
      "&:hover": getVariantStyle("soft", "harmonize", "hover"),
      "&:active": getVariantStyle("soft", "harmonize", "active"),
      ...getVariantStyle("soft", "harmonize"),
      ...buttonSizeStyles(size),
      fontSize: size === "xs" ? "xs" : size === "sm" ? "sm" : "md",
      border: "1px solid",
      borderColor: "divider",
      sm: {
        paddingRight: "0.75rem",
      },
    };
  },
  searchButtonStartIcon: {
    display: "inherit",
    sm: { marginRight: "0.5rem" },
  },
  searchButtonLabel: {
    display: "none",
    sm: { display: "inline" },
  },
  linksHeader: {
    display: "flex",
    justifyContent: "space-between",
  },
  linkActive: (app) => {
    app.addGlobalStyle({
      'html[data-yolm-transition-type*="navigate"]::view-transition-group(navbar-link-active)':
        {
          animationDuration: app.theme.transitionDurations.navigation,
          animationTimingFunction: app.theme.transitionEasing.navigation,
        },
      'html[data-yolm-transition-type*="navigate"]::view-transition-new(navbar-link-active)':
        {
          height: "100%",
          zIndex: 1,
        },
      'html[data-yolm-transition-type*="navigate"]::view-transition-old(navbar-link-active)':
        {
          height: "100%",
          zIndex: 1,
        },
    });
    return {
      position: "absolute",
      inset: 0,
      borderRadius: "sm",
      ...getVariantStyle("soft", "harmonize"),
      pointerEvents: "none",
      viewTransitionName: "navbar-link-active",
      zIndex: -1,
    };
  },
  // todo move this styling into a proper component
  // probably popover, or because it is basically a menu, extending dropdown/menu to handle hover would be good
  popover: (app) => {
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
});

/**
A responsive navigation bar component that supports desktop and mobile layouts and has built-in support for search and multi-table search.

@category UI Component, Initial

@param {'solid' | 'soft'} [props.variant='solid'] - The visual variant style
@param {'neutral' | 'primary' | 'success' | 'warning' | 'danger'} [props.color='neutral'] - The color theme
@param {'xs' | 'sm' | 'md' | 'lg'} [props.size='sm'] - The size variant
@param {'left' | 'center' | 'right'} [props.linkAlignment='left'] - Horizontal alignment of nav links
@param {Array<NavLink>} [props.links] - Array of navigation link items
@param {boolean} [props.manual=false] - Whether to manually control navigation items
@param {Object} [props.searchDialog] - Configuration for search dialog
@param {Object} [props.multiTableSearchDialog] - Configuration for multi-table search
@param {Object} [props.primaryActionButton] - Primary action button configuration
*/
export function Navbar(props: NavbarProps) {
  const variant = props.variant ?? "solid";
  const color = props.color ?? "neutral";
  const size = props.size ?? "sm";
  const linkAlignment = props.linkAlignment ?? "left";
  const normalizedLabels = props.links?.map((link) => {
    function getLabelFromUrl(url: string) {
      return url.split(/-|\//).filter(Boolean).map(upcaseFirst).join(" ");
    }
    if (typeof link === "string") {
      return { url: link, label: getLabelFromUrl(link) };
    }
    if ("children" in link) {
      const children = link.children.map((child) =>
        typeof child === "string"
          ? { url: child, label: getLabelFromUrl(child) }
          : child
      );
      return {
        label: link.label,
        showIf: link.showIf,
        children,
        hasChildren: children.length > 0,
      };
    }
    let label = link.label;
    if (!label) {
      if ("url" in link) {
        label = getLabelFromUrl(link.url as string);
      } else {
        throw new Error("Navbar link must have a label or url");
      }
    }
    return {
      url: "url" in link ? (link.url as string) : undefined,
      label,
      showIf: link.showIf,
    };
  }) ?? [];
  if (!props.manual) {
    const sharedContext = useSharedContext(NavigationItemsSharedContext);
    for (const link of sharedContext.items) {
      // Check if the URL already exists in normalizedLabels
      const urlExists = normalizedLabels.some(
        (existingLink) =>
          "url" in existingLink && existingLink.url === link.url,
      );
      if (!urlExists) {
        normalizedLabels.push({
          label: link.label,
          url: link.url,
        });
      }
    }
  }
  if (props.multiTableSearchDialog && props.searchDialog) {
    throw new Error("Cannot have both multiSearchDialog and search_dialog");
  }
  const hasSearchDialog = Boolean(props.searchDialog) ||
    Boolean(props.multiTableSearchDialog);
  const stateProc = (s: StateStatements) => {
    s.defScalar("showing_mobile_menu", false);
    s.defScalar("showing_settings", false);
    s.defScalar("currently_focused_link", {
      type: "SmallUint",
      expr: sql.null,
    });
    s.defScalar("currently_focused_link_child", {
      type: "SmallUint",
      expr: sql.null,
    });
    if (hasSearchDialog) {
      s.defScalar("searching", false);
    }
    for (let i = 0; i < normalizedLabels.length; i++) {
      s.defScalar(`popover_open_${i}`, false);
      s.defScalar(`drawer_open_${i}`, false);
    }
  };
  function getLinkId(linkIndex: NumericExpr, childIndex?: NumericExpr) {
    if (childIndex !== undefined) {
      return sql.concat("nav-links-", linkIndex, "-", childIndex);
    }
    return sql.concat("nav-links-", linkIndex);
  }
  const handleLinkKeyDown = (
    s: DomStatements,
    linkIndex: number,
    childCount: number | undefined,
    linkUrl?: string,
  ) => {
    const resolvedChildCount = childCount ?? 0;
    s.switchKeyboardEvent({
      arrowdown: (s) => {
        s.event.preventDefault();
        s.setScalar(
          "currently_focused_link_child",
          sql`coalesce(case when currently_focused_link_child + 1 >= ${resolvedChildCount} then 0 else currently_focused_link_child + 1 end, 0)`,
        );
        s.element(
          getLinkId(
            sql`currently_focused_link`,
            sql`currently_focused_link_child`,
          ),
        ).focus();
      },
      arrowup: (s) => {
        s.event.preventDefault();
        s.setScalar(
          "currently_focused_link_child",
          sql`coalesce(case when currently_focused_link_child - 1 < 0 then ${
            resolvedChildCount - 1
          } else currently_focused_link_child - 1 end, 0)`,
        );
        s.element(
          getLinkId(
            sql`currently_focused_link`,
            sql`currently_focused_link_child`,
          ),
        ).focus();
      },
      arrowright: (s) => {
        s.event.preventDefault();
        s.setScalar("currently_focused_link_child", sql`null`);
        s.element(sql.lit`nav-links-${linkIndex + 1}`).focus();
        if (normalizedLabels?.[linkIndex]?.hasChildren) {
          s.setScalar(`ui.popover_open_${linkIndex}`, false);
        }
      },
      arrowleft: (s) => {
        s.event.preventDefault();
        s.setScalar("currently_focused_link_child", sql`null`);
        s.element(sql.lit`nav-links-${linkIndex - 1}`).focus();
        s.if(linkIndex === 0, (s) => {
          s.element(sql.lit`nav-home`).focus();
        });
        if (normalizedLabels?.[linkIndex]?.hasChildren) {
          s.setScalar(`ui.popover_open_${linkIndex}`, false);
        }
      },
      tab: (s) => {
        if (normalizedLabels?.[linkIndex]?.hasChildren) {
          s.setScalar(`ui.popover_open_${linkIndex}`, false);
        }
      },
    });
    s.if(sql`event.key = ' ' or event.key = 'Enter'`, (s) => {
      if (linkUrl) {
        s.navigate(sql.lit`${linkUrl}`);
      }
    });
  };
  const handleMobileLinkKeyDown = (
    s: DomStatements,
    linkUrl?: string,
    previous?: Sql,
    next?: Sql,
  ) => {
    s.switchKeyboardEvent({
      arrowdown: (s) => {
        s.event.preventDefault();
        s.element(next ?? sql.null).focus();
      },
      arrowup: (s) => {
        s.event.preventDefault();
        s.element(previous ?? sql.null).focus();
      },
    });
    s.if(sql`event.key == 'Enter' or event.key == ' '`, (s) => {
      if (linkUrl) {
        s.navigate(sql.lit`${linkUrl}`);
        s.setScalar("ui.showing_mobile_menu", false);
      }
    });
  };
  const rootStyles = styles.root(variant, color);
  return (
    <Data local noRefetch procedure={stateProc}>
      <nav sx={[rootStyles, props.sx]} className={props.className}>
        <div sx={styles.menuIcon}>
          <IconButton
            variant="soft"
            color="harmonize"
            size={size}
            aria-label="Open Menu"
            icon="Menu"
            onClick={(s) => s.setScalar("ui.showing_mobile_menu", true)}
          />
        </div>
        <div sx={styles.links(linkAlignment)}>
          <div className="relative">
            <IconButton
              variant="plain"
              color="harmonize"
              size={size}
              aria-label="Home"
              tabIndex={0}
              href="/"
              icon="Home"
              onClick={(s) => {
                s.event.preventDefault();
                s.location.assign(sql.lit`/`);
              }}
              id="nav-home"
              onKeyDown={(s) => handleLinkKeyDown(s, -1, 0, "/")}
            />
            <Show when={sql`location.pathname = '/'`}>
              <div sx={styles.linkActive()} />
            </Show>
          </div>
          {normalizedLabels.map((link, i) => {
            const linkId = getLinkId(i);
            const popoverId = sql.concat("popover-", linkId);
            return (
              <Show when={link.showIf ?? sql`true`}>
                <div className="relative">
                  <Button
                    href={link.url}
                    variant="plain"
                    color="harmonize"
                    size={size}
                    sx={{
                      fontWeight: "semibold",
                      fontSize: size === "xs"
                        ? "xs"
                        : size === "sm"
                        ? "sm"
                        : "md",
                    }}
                    tabIndex={sql`case when currently_focused_link == ${i} then 0 else -1 end`}
                    id={linkId}
                    onMouseEnter={(s) =>
                      s.setScalar(`ui.popover_open_${i}`, true)}
                    // This shouldn't be necessary, but onMouseEnter doesn't always fire
                    onMouseMove={(s) => {
                      s.setScalar(`ui.popover_open_${i}`, true);
                    }}
                    onFocusIn={(s) => {
                      s.setScalar(`ui.popover_open_${i}`, true);
                      s.setScalar("currently_focused_link", i);
                    }}
                    onClick={(s) => {
                      s.setScalar(`ui.popover_open_${i}`, true);
                      if (link.url && !link.hasChildren) {
                        s.event.preventDefault();
                        s.location.assign(sql.lit`${link.url}`);
                      }
                    }}
                    aria-haspopup={link.hasChildren ? "true" : "false"}
                    aria-expanded={sql`ui.popover_open_${i}`}
                    onKeyDown={(s) =>
                      handleLinkKeyDown(
                        s,
                        i,
                        link.children?.length ?? 0,
                        link.hasChildren ? undefined : link.url,
                      )}
                    endDecorator={link.hasChildren && (
                      <Conditional
                        when={sql`ui.popover_open_${i}`}
                        then={<MaterialIcon icon="ExpandLessOutlined" />}
                        else={<MaterialIcon icon="ExpandMoreOutlined" />}
                      />
                    )}
                  >
                    {link.label}
                  </Button>
                  <Show
                    when={link?.url
                      ? sql`uri.is_match(location.pathname, ${
                        sql.lit(link.url)
                      })`
                      : sql.or(
                        ...(link.children ?? []).map(
                          (child) =>
                            sql`uri.is_match(location.pathname, ${
                              sql.lit(child.url)
                            })`,
                        ),
                      )}
                  >
                    <div sx={styles.linkActive()} />
                  </Show>
                  {link.hasChildren && (
                    <>
                      <Show when={sql`ui.popover_open_${i}`}>
                        <EventHandlers
                          window={{
                            mouseMove: (s) => {
                              s.element(linkId).getBoundingClientRect(
                                "button_rect",
                              );
                              s.element(popoverId).getBoundingClientRect(
                                "popover_rect",
                              );
                              s.defScalar(
                                "button_mid_y",
                                sql`(button_rect.top + button_rect.bottom) / 2`,
                              );
                              s.defScalar(
                                "left_slope",
                                sql`(popover_rect.top - button_mid_y) / (popover_rect.left - button_rect.left)`,
                              );
                              s.defScalar(
                                "right_slope",
                                sql`(popover_rect.top - button_mid_y) / (popover_rect.right - button_rect.right)`,
                              );
                              // we draw a quadrilateral from the middle of the button sides to the top of the popover
                              // and check if the mouse is in that quadrilateral this makes it so that the popover stays open when the
                              // mouse moves from the button to the popover
                              s.defScalar(
                                "in_quadrilateral",
                                sql`event.client_y >= button_mid_y and
                                event.client_y <= popover_rect.top and
                                event.client_x >= button_rect.left + (event.client_y - button_mid_y) / left_slope and
                                event.client_x <= button_rect.right + (event.client_y - button_mid_y) / right_slope`,
                              );
                              s.defScalar(
                                "in_button",
                                sql`event.client_y <= button_rect.bottom and
                                event.client_y >= button_rect.top and
                                event.client_x >= button_rect.left and
                                event.client_x <= button_rect.right`,
                              );
                              s.defScalar(
                                "in_popover",
                                sql`event.client_y <= popover_rect.bottom and
                                event.client_y >= popover_rect.top and
                                event.client_x >= popover_rect.left and
                                event.client_x <= popover_rect.right`,
                              );
                              s.unless(
                                sql`in_quadrilateral or in_button or in_popover`,
                                (s) => {
                                  s.setScalar(`ui.popover_open_${i}`, false);
                                },
                              );
                            },
                          }}
                        />
                      </Show>
                      <div
                        sx={styles.popover()}
                        tabIndex={-1}
                        popover="auto"
                        yolmPopoverShowing={sql`ui.popover_open_${i}`}
                        classes="skip-harmonize"
                        id={popoverId}
                        floating={{
                          anchorEl: linkId,
                          placement: "bottom",
                          strategy: "fixed",
                          shift: { mainAxis: true, crossAxis: true },
                          offset: {
                            mainAxis: 4,
                            crossAxis: 0,
                          },
                          flip: { crossAxis: false, mainAxis: false },
                        }}
                        onToggleHide={(s) => {
                          s.setScalar(`ui.popover_open_${i}`, false);
                        }}
                      >
                        <List size={size}>
                          {link.children?.map((child, b) => {
                            const linksChildId = sql.lit`nav-links-${i}-${b}`;
                            omitICtxs([HarmonizeICtxKey]);
                            return (
                              <Show when={child.showIf ?? sql`true`}>
                                <ListItemButton
                                  tabIndex={sql`case when currently_focused_link_child == ${b} then 0 else -1 end`}
                                  href={child.url}
                                  variant="plain"
                                  id={linksChildId}
                                  onClick={(s) => {
                                    s.setScalar(`ui.popover_open_${i}`, false);
                                  }}
                                  onKeyDown={(s) =>
                                    handleLinkKeyDown(
                                      s,
                                      i,
                                      link.children?.length ?? 0,
                                      child.url,
                                    )}
                                >
                                  {child.label}
                                </ListItemButton>
                              </Show>
                            );
                          })}
                        </List>
                      </div>
                    </>
                  )}
                </div>
              </Show>
            );
          })}
        </div>
        <div sx={styles.navRight}>
          {props.primaryActionButton && (
            <Button size={size} {...props.primaryActionButton} />
          )}
          {hasSearchDialog && (
            <button
              sx={styles.searchButton(size)}
              onClick={(s) => s.setScalar("ui.searching", true)}
              type="button"
            >
              <span sx={styles.searchButtonStartIcon}>
                <MaterialIcon icon="Search" />
              </span>
              <span sx={styles.searchButtonLabel}>
                {props.searchDialog
                  ? `Find ${props.searchDialog.table}…`
                  : "Search…"}
              </span>
            </button>
          )}
          <IconButton
            color="harmonize"
            variant="soft"
            size={size}
            aria-label="Open Settings"
            onClick={(s) => s.setScalar("ui.showing_settings", true)}
            icon="Settings"
          />
        </div>
        <Drawer
          bindScalar="showing_mobile_menu"
          direction="left"
          className="w-[360px]"
        >
          <div sx={styles.linksHeader}>
            <Typography level="h4">Links</Typography>
            <IconButton
              color="neutral"
              variant="plain"
              size={size}
              aria-label="Close Menu"
              onClick={(s) => s.setScalar("ui.showing_mobile_menu", false)}
              icon="Close"
            />
          </div>
          <Divider className="my-2" />
          {props.primaryActionButton && (
            <Button
              size={size}
              {...props.primaryActionButton}
              color={color}
              onClick={(s) => s.setScalar("ui.showing_mobile_menu", false)}
            />
          )}
          <Button
            size={size}
            startIcon="Home"
            variant="plain"
            href="/"
            id="nav-home-mobile"
            onKeyDown={(s) => {
              s.if(sql`event.key = 'ArrowDown'`, (s) => {
                s.element(sql.lit`nav-links-mobile-0`).focus();
              });
              s.if(sql`event.key == 'Enter' or event.key == ' '`, (s) => {
                s.navigate(sql.lit`/`);
              });
            }}
            tabIndex={0}
            onClick={(s) => s.setScalar("ui.showing_mobile_menu", false)}
          >
            Home
          </Button>
          {normalizedLabels.map((link, i) => {
            const navlinks = sql.lit`nav-links-mobile-${i}`;
            const previous = i === 0
              ? sql.lit`nav-home-mobile`
              : sql`case when drawer_open_${i - 1} and ${
                normalizedLabels[i - 1]?.hasChildren ? sql`true` : sql`false`
              } then 'nav-child-links-mobile-${i - 1}-${
                (normalizedLabels[i - 1]?.children?.length ?? 0) - 1
              }' else 'nav-links-mobile-${i - 1}' end`;
            const next = i === normalizedLabels.length - 1
              ? sql.null
              : sql`case when drawer_open_${i} and  ${
                normalizedLabels[i].hasChildren ? sql`true` : sql`false`
              } then 'nav-child-links-mobile-${i}-0' else 'nav-links-mobile-${
                i + 1
              }' end`;
            return (
              <Show when={link.showIf ?? sql`true`}>
                <Button
                  size={size}
                  variant="plain"
                  {...(link.hasChildren
                    ? {
                      onClick: (s) => {
                        s.toggle(`drawer_open_${i}`);
                      },
                    }
                    : {
                      href: link.url,
                      onClick: (s) => {
                        s.setScalar("ui.showing_mobile_menu", false);
                        s.toggle(`drawer_open_${i}`);
                      },
                    })}
                  id={navlinks}
                  tabIndex={sql`case when currently_focused_link == ${i} then 0 else -1 end`}
                  onKeyDown={(s) =>
                    handleMobileLinkKeyDown(
                      s,
                      link.hasChildren ? undefined : link.url,
                      previous,
                      next,
                    )}
                  endDecorator={link.hasChildren && (
                    <Conditional
                      when={sql`drawer_open_${i}`}
                      then={<MaterialIcon icon="ExpandLessOutlined" />}
                      else={<MaterialIcon icon="ExpandMoreOutlined" />}
                    />
                  )}
                >
                  {link.label}
                </Button>
                {link.children && (
                  <Show when={sql`ui.drawer_open_${i}`}>
                    <div className="flex flex-col">
                      {link.children?.map((child, childIndex) => {
                        const childId = sql
                          .lit`nav-child-links-mobile-${i}-${childIndex}`;
                        return (
                          <Show when={child.showIf ?? sql`true`}>
                            <Button
                              size={size}
                              variant="plain"
                              href={child.url}
                              id={childId}
                              tabIndex={sql`case when currently_focused_link_child == ${childIndex} then 0 else -1 end`}
                              onKeyDown={(s) =>
                                handleMobileLinkKeyDown(
                                  s,
                                  child.url,
                                  childIndex === 0
                                    ? sql.lit`nav-links-mobile-${i}`
                                    : sql.lit`nav-child-links-mobile-${i}-${
                                      childIndex - 1
                                    }`,
                                  link.children?.length === childIndex + 1
                                    ? sql.lit`nav-links-mobile-${i + 1}`
                                    : sql.lit`nav-child-links-mobile-${i}-${
                                      childIndex + 1
                                    }`,
                                )}
                              onClick={(s) =>
                                s.setScalar("ui.showing_mobile_menu", false)}
                              className="font-light"
                            >
                              {child.label}
                            </Button>
                          </Show>
                        );
                      })}
                    </div>
                  </Show>
                )}
              </Show>
            );
          })}
        </Drawer>
        <SettingsDrawer bindScalar="showing_settings" />
        {/*Example_GlobalSearchDialog_Start*/}
        <GlobalSearchDialog {...props} openScalar="searching" />
        {/*Example_GlobalSearchDialog_End*/}
      </nav>
    </Data>
  );
}
