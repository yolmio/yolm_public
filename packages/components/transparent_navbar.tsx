import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { Typography } from "components/typography";
import { sql } from "../std/sql_utils";
import type { NumericExpr } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { Data } from "std/data";
import { Conditional, EventHandlers, Show, useApp } from "std/ui";
import type { Node } from "std/ui";
import { MaterialIcon } from "./material_icon";
import { List, ListItemButton } from "./list";
import { getUniqueUiId } from "./utils";

interface TransparentNavbarProps {
  logoIcon: ({ sx, className }: { sx?: Style; className?: string }) => Node;
  logoText?: Node;
  links: Array<{
    label: string;
    href?: string;
    children?: { label: string; href: string }[];
  }>;
  primaryActionButton?: {
    label: string;
    href: string;
    variant?: "solid" | "outlined" | "soft";
  };
  positionFixed?: boolean;
  /** Override the text color for logo and link buttons */
  textColor?: string;
  /** Override the nav z-index (default: 1100) */
  navZIndex?: number;
  /** Override the nav background color */
  navBackground?: string;
  /** Prefix for element IDs to avoid collisions when multiple navbars exist */
  idPrefix?: string;
  /** Extra content rendered after links and primary action button on desktop */
  extraDesktopContent?: Node;
  /** Hide navbar when scrolling down, show when scrolling up */
  hideOnScrollDown?: boolean;
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
 * Marketing-style navbar that starts transparent over a hero image and
 * fades to a solid surface as the user scrolls. Use on landing pages
 * paired with {@link Footer}; for in-app navigation use {@link Navbar}.
 */
export function TransparentNavbar(props: TransparentNavbarProps) {
  const colorSchemeType = useApp().colorSchemeType;
  const colorSchemeRecord =
    `transparent_navbar_color_scheme_${getUniqueUiId()}`;

  const LogoIcon = props.logoIcon;
  const links = props.links;
  const primaryActionButton = props.primaryActionButton;
  const idPfx = props.idPrefix ? `${props.idPrefix}-` : "";
  useApp().addGlobalStyle({
    ":root": {
      "--page-header-height": "64px",
    },
  });

  // Helper function to get link ID
  function getLinkId(linkIndex: NumericExpr, childIndex?: NumericExpr) {
    if (childIndex !== undefined) {
      return sql.concat(`${idPfx}nav-links-`, linkIndex, "-", childIndex);
    }
    return sql.concat(`${idPfx}nav-links-`, linkIndex);
  }

  // Keyboard navigation handler
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
        if (resolvedChildCount > 0) {
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
        }
      },
      arrowup: (s) => {
        s.event.preventDefault();
        if (resolvedChildCount > 0) {
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
        }
      },
      arrowright: (s) => {
        s.event.preventDefault();
        s.setScalar("currently_focused_link_child", sql`null`);
        s.element(sql.lit`${idPfx}nav-links-${linkIndex + 1}`).focus();
      },
      arrowleft: (s) => {
        s.event.preventDefault();
        s.setScalar("currently_focused_link_child", sql`null`);
        if (linkIndex > 0) {
          s.element(sql.lit`${idPfx}nav-links-${linkIndex - 1}`).focus();
        }
      },
      tab: (s) => {
        // Close popover on tab

        s.setScalar("popover_open", false);
      },
    });
    s.if(sql`event.key = ' ' or event.key = 'Enter'`, (s) => {
      if (linkUrl) {
        s.navigate(sql.lit`${linkUrl}`);
      }
    });
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("showing_mobile_menu", false);
        s.defScalar("is_scrolled", {
          type: "Bool",
          expr: false,
          allowNoRead: true,
        });
        s.defScalar("nav_hidden", false);
        s.defScalar("last_scroll_y", sql`0`);
        s.defScalar("currently_focused_link", {
          type: "SmallUint",
        });
        s.defScalar("currently_focused_link_child", {
          type: "SmallUint",
        });
      }}
    >
      <nav
        sx={{
          position: props.positionFixed || props.hideOnScrollDown
            ? "fixed"
            : "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: props.navZIndex ?? 1100,
          transition:
            "background-color 0.3s, backdrop-filter 0.3s, transform 0.35s ease",
          backgroundColor: props.navBackground ?? "transparent",
          backdropFilter: "none",
          borderBottom: "none",
          "&.is-scrolled": {
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            dark: {
              backgroundColor: "rgba(10, 10, 10, 0.9)",
            },
            // backdropFilter: "blur(10px)",
            borderBottom: "1px solid var(--palette-divider)",
          },
        }}
        {...(props.hideOnScrollDown
          ? {
            style: {
              transform:
                sql`case when nav_hidden then 'translateY(-100%)' else 'translateY(0)' end`,
            },
          }
          : {})}
        dynamicClass={{
          classes: "is-scrolled",
          condition: sql.and(
            sql`is_scrolled`,
            props.positionFixed ? sql`false` : sql`true`,
          ),
        }}
      >
        <EventHandlers
          window={{
            scroll: (s) => {
              s.window.getScrollY("scroll_y");
              s.setScalar("is_scrolled", sql`scroll_y > 20`);
              if (props.hideOnScrollDown) {
                s.if(sql`scroll_y > last_scroll_y and scroll_y > 80`, (s) => {
                  s.setScalar("nav_hidden", true);
                });
                s.if(sql`scroll_y < last_scroll_y`, (s) => {
                  s.setScalar("nav_hidden", false);
                });
                s.setScalar("last_scroll_y", sql`scroll_y`);
              }
            },
          }}
        />
        <div
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: { xs: 4, sm: 8 },
            py: 2,
            maxWidth: "1400px",
            mx: "auto",
            gap: 2,
          }}
        >
          {/* Logo */}
          <a
            href="/"
            aria-label="Home Page"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              textDecoration: "none",
              color: props.textColor ?? "text.primary",
            }}
          >
            <LogoIcon className="text-2xl" />
            <Typography
              level="title-lg"
              component="span"
              sx={{
                display: { xs: "none", sm: "block" },
                fontWeight: "bold",
              }}
            >
              {props.logoText}
            </Typography>
          </a>

          {/* Desktop Navigation Links */}
          <div
            sx={{
              display: "none",
              md: { display: "flex" },
              gap: 4,
              alignItems: "center",
            }}
          >
            {links.map((link, i) => {
              const linkId = sql.lit`${idPfx}nav-links-${i}`;
              const popoverId = sql.concat(sql.lit`${idPfx}popover-`, i);
              const hasChildren = link.children && link.children.length > 0;

              return (
                <div className="relative">
                  {hasChildren && (
                    <Data
                      local
                      noRefetch
                      procedure={(s) => {
                        s.defScalar("popover_open", false);
                      }}
                    >
                      <Button
                        variant="plain"
                        color="neutral"
                        id={linkId}
                        tabIndex={sql`case when currently_focused_link = ${i} then 0 else -1 end`}
                        sx={{
                          fontWeight: "semibold",
                          color: props.textColor ?? "text.primary",
                          "&:hover": {
                            backgroundColor: "transparent",
                            color: props.textColor
                              ? props.textColor
                              : "primary.600",
                          },
                        }}
                        onMouseEnter={(s) => s.setScalar("popover_open", true)}
                        onMouseMove={(s) => s.setScalar("popover_open", true)}
                        onFocusIn={(s) => {
                          s.setScalar("popover_open", true);
                          s.setScalar("currently_focused_link", i);
                        }}
                        onClick={(s) => s.setScalar("popover_open", true)}
                        onKeyDown={(s) =>
                          handleLinkKeyDown(
                            s,
                            i,
                            link.children?.length ?? 0,
                            !hasChildren ? link.href : undefined,
                          )}
                        aria-haspopup="true"
                        aria-expanded={sql`popover_open`}
                        endDecorator={
                          <Conditional
                            when={sql`popover_open`}
                            then={<MaterialIcon icon="ExpandLessOutlined" />}
                            else={<MaterialIcon icon="ExpandMoreOutlined" />}
                          />
                        }
                      >
                        {link.label}
                      </Button>

                      <Show when={sql`popover_open`}>
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
                                  s.setScalar("popover_open", false);
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
                        yolmPopoverShowing={sql`popover_open`}
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
                          s.setScalar("popover_open", false);
                        }}
                      >
                        <List>
                          {link.children?.map((child, b) => {
                            const childId = sql
                              .lit`${idPfx}nav-links-${i}-${b}`;
                            return (
                              <ListItemButton
                                id={childId}
                                tabIndex={sql`case when currently_focused_link_child == ${b} then 0 else -1 end`}
                                href={child.href}
                                variant="plain"
                                onClick={(s) => {
                                  s.setScalar("popover_open", false);
                                }}
                                onKeyDown={(s) =>
                                  handleLinkKeyDown(
                                    s,
                                    i,
                                    link.children?.length ?? 0,
                                    child.href,
                                  )}
                              >
                                {child.label}
                              </ListItemButton>
                            );
                          })}
                        </List>
                      </div>
                    </Data>
                  )}

                  {!hasChildren && (
                    <Button
                      variant="plain"
                      color="neutral"
                      id={linkId}
                      tabIndex={sql`case when currently_focused_link = ${i} then 0 else -1 end`}
                      href={link.href}
                      sx={{
                        fontWeight: "semibold",
                        color: "text.primary",
                        "&:hover": {
                          backgroundColor: "transparent",
                          color: "primary.600",
                        },
                      }}
                      onFocusIn={(s) => {
                        s.setScalar("currently_focused_link", i);
                      }}
                    >
                      {link.label}
                    </Button>
                  )}
                </div>
              );
            })}
            {primaryActionButton && (
              <Button
                variant={primaryActionButton.variant ?? "solid"}
                color="primary"
                href={primaryActionButton.href}
                size="sm"
                className="ml-4"
              >
                {primaryActionButton.label}
              </Button>
            )}
            {props.extraDesktopContent}
          </div>

          {/* Mobile Menu Button */}
          <div sx={{ display: "flex", md: { display: "none" } }}>
            <IconButton
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("showing_mobile_menu", true)}
              icon="Menu"
              aria-label="Menu"
            />
          </div>

          {colorSchemeType === "cookie" && (
            <Data
              local
              noRefetch
              watch={[sql`color_scheme_refresh_key`]}
              procedure={(s) => {
                s.getCookie(sql.lit`color_scheme`, colorSchemeRecord);
              }}
            >
              <IconButton
                variant="plain"
                color="neutral"
                sx={{ display: { xs: "none", md: "block" } }}
                onClick={(s) => {
                  s.conditional({
                    condition: sql`${
                      sql.ref(colorSchemeRecord)
                    }.value = 'dark'`,
                    then: (s) => {
                      s.setCookie(sql.lit`color_scheme`, sql.lit`light`, {
                        expires: sql`date.add(year, 1, now())`,
                      });
                    },
                    else: (s) => {
                      s.setCookie(sql.lit`color_scheme`, sql.lit`dark`, {
                        expires: sql`date.add(year, 1, now())`,
                      });
                    },
                  });
                  s.increment("color_scheme_refresh_key");
                }}
                aria-label={sql`case when ${
                  sql.ref(colorSchemeRecord)
                }.value = 'dark' then 'Switch to light mode' else 'Switch to dark mode' end`}
              >
                <Conditional
                  when={sql`${sql.ref(colorSchemeRecord)}.value = 'dark'`}
                  then={<MaterialIcon icon="LightMode" />}
                  else={<MaterialIcon icon="DarkMode" />}
                />
              </IconButton>
            </Data>
          )}
        </div>
      </nav>
      {/* Mobile Menu Drawer */}
      <div
        sx={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "300px",
          backgroundColor: "background.surface",
          transform: "translateX(100%)",
          transition: "transform 0.3s ease-in-out",
          boxShadow: "lg",
          zIndex: 1200,
          p: 4,
          display: { md: "none" },
          "&.showing_mobile_menu": {
            transform: "translateX(0)",
          },
        }}
        dynamicClass={{
          classes: "showing_mobile_menu",
          condition: sql`showing_mobile_menu`,
        }}
      >
        <div className="flex justify-between mb-8">
          <Typography level="h4">Menu</Typography>
          <IconButton
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("showing_mobile_menu", false)}
            aria-label="Close"
            icon="Close"
          />
        </div>
        <div className="flex flex-col gap-4">
          {links.map((link) => {
            const hasChildren = link.children && link.children.length > 0;

            return (
              <div className="flex flex-col">
                {hasChildren && (
                  <Data
                    local
                    noRefetch
                    procedure={(s) => {
                      s.defScalar("drawer_open", true);
                    }}
                  >
                    <Button
                      variant="plain"
                      color="neutral"
                      onClick={(s) => {
                        s.toggle("drawer_open");
                      }}
                      endDecorator={
                        <Conditional
                          when={sql`drawer_open`}
                          then={<MaterialIcon icon="ExpandLessOutlined" />}
                          else={<MaterialIcon icon="ExpandMoreOutlined" />}
                        />
                      }
                    >
                      {link.label}
                    </Button>

                    <Show when={sql`drawer_open`}>
                      <div className="flex flex-col pl-4">
                        {link.children?.map((child) => (
                          <Button
                            variant="plain"
                            color="neutral"
                            href={child.href}
                            onClick={(s) =>
                              s.setScalar("showing_mobile_menu", false)}
                            className="font-light"
                          >
                            {child.label}
                          </Button>
                        ))}
                      </div>
                    </Show>
                  </Data>
                )}

                {!hasChildren && (
                  <Button
                    variant="plain"
                    color="neutral"
                    href={link.href}
                    onClick={(s) => s.setScalar("showing_mobile_menu", false)}
                  >
                    {link.label}
                  </Button>
                )}
              </div>
            );
          })}
          {primaryActionButton && (
            <Button
              variant={primaryActionButton.variant ?? "solid"}
              color="primary"
              href={primaryActionButton.href}
              onClick={(s) => s.setScalar("showing_mobile_menu", false)}
            >
              {primaryActionButton.label}
            </Button>
          )}
        </div>
      </div>
    </Data>
  );
}
