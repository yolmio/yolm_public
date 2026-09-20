import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { getUniqueUiId } from "components/utils";
import { Data } from "std/data";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import type { Style } from "std/style_types";
import { sql } from "std/sql_utils";

/** Link entry used in desktop mega menus and the mobile drawer. */
export interface MegaMenuLink {
  /** Visible link label. */
  label: Node;
  /** Plain-text label for aria text, generated ids, and test targeting when `label` is not a string. */
  ariaLabel?: string;
  /** Destination path or URL. */
  href: string;
  /** Optional supporting copy shown below the label in rich menu layouts. */
  description?: Node;
  /** Optional leading icon. */
  icon?: Node;
  /** Optional nested links shown below this link. */
  links?: MegaMenuLink[];
}

/** Highlight panel shown beside a menu column in {@link MegaMenuNavbar}. */
export interface MegaMenuPanel {
  /** Optional small label above the panel title. */
  eyebrow?: Node;
  /** Panel heading. */
  title: Node;
  /** Optional descriptive body copy. */
  description?: Node;
  /** Optional secondary links rendered inside the panel. */
  links?: MegaMenuLink[];
  /** Optional panel-level call to action. */
  cta?: {
    label: Node;
    /** Plain-text label for aria text when `label` is not a string. */
    ariaLabel?: string;
    href: string;
  };
}

/** Top-level navigation item for {@link MegaMenuNavbar}. */
export interface MegaMenuItem {
  /** Visible navigation label. */
  label: Node;
  /** Plain-text label for aria text and generated ids when `label` is not a string. */
  ariaLabel?: string;
  /** Destination for simple items that do not open a menu. */
  href?: string;
  /** Primary menu links shown when this item opens a menu. */
  links?: MegaMenuLink[];
  /** Optional rich panel shown beside the primary menu links. */
  panel?: MegaMenuPanel;
}

/**
 * Props for {@link MegaMenuNavbar}.
 *
 * The navbar is generic and app-themed through CSS variables, primarily the
 * `--site-nav-*` token family plus layout tokens such as
 * `--page-header-height` in consuming pages. It does not define a brand
 * palette or product-specific routes.
 */
export interface MegaMenuNavbarProps {
  /** Brand node shown at the left side of the navbar and mobile drawer. */
  logo: Node;
  /** Link target for the brand node. Defaults to `/`. */
  logoHref?: string;
  /** Top-level navigation items. */
  items: MegaMenuItem[];
  /** Stable id prefix for generated menu panel ids. */
  idPrefix?: string;
  /** Optional primary action shown on desktop and in the mobile drawer. */
  action?: {
    label: string;
    href: string;
  };
  /** Optional secondary contact link shown on desktop and in the mobile drawer. */
  phone?: {
    label: Node;
    href: string;
  };
  /** Optional style overrides for the fixed navbar shell. */
  sx?: Style;
}

function labelText(label: Node, fallback: string) {
  if (typeof label === "string") {
    return label;
  }
  if (typeof label === "number") {
    return `${label}`;
  }
  return fallback;
}

function MenuLink(props: {
  link: MegaMenuLink;
  menuKey: string;
  nested?: boolean;
}) {
  const hasNestedLinks = Boolean(props.link.links?.length);
  const linkText = props.link.ariaLabel ??
    labelText(props.link.label, props.menuKey);
  return (
    <div
      onMouseEnter={(s) => {
        if (hasNestedLinks) {
          s.setScalar("active_nested_menu_key", sql.lit(props.menuKey));
        } else if (!props.nested) {
          s.setScalar("active_nested_menu_key", sql.lit``);
        }
      }}
      sx={{
        display: "flex",
        flexDirection: "column",
        ml: props.nested ? "32px" : 0,
      }}
    >
      <div
        sx={{
          display: "flex",
          alignItems: "flex-start",
          borderRadius: "10px",
          transition: "background 0.15s ease",
          "&:hover": {
            background: "var(--site-nav-soft)",
          },
        }}
      >
        <a
          href={props.link.href}
          onFocusIn={(s) => {
            if (hasNestedLinks) {
              s.setScalar("active_nested_menu_key", sql.lit(props.menuKey));
            } else if (!props.nested) {
              s.setScalar("active_nested_menu_key", sql.lit``);
            }
          }}
          sx={{
            display: "flex",
            gap: "12px",
            alignItems: "flex-start",
            p: props.nested ? "8px 12px" : "12px",
            color: "var(--site-nav-text)",
            textDecoration: "none",
            minWidth: 0,
            flex: 1,
          }}
        >
          {props.link.icon && (
            <span
              sx={{
                mt: "2px",
                color: "var(--site-nav-accent)",
                display: "inline-flex",
              }}
            >
              {props.link.icon}
            </span>
          )}
          <span
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
            }}
          >
            <span
              sx={{
                fontSize: props.nested ? "13px" : "14px",
                fontWeight: 600,
              }}
            >
              {props.link.label}
            </span>
            {props.link.description && (
              <span
                sx={{
                  color: "var(--site-nav-muted)",
                  fontSize: "12px",
                  lineHeight: 1.45,
                }}
              >
                {props.link.description}
              </span>
            )}
          </span>
        </a>
        {hasNestedLinks && (
          <button
            type="button"
            aria-label={`Show ${linkText} links`}
            aria-expanded={sql`active_nested_menu_key = ${
              sql.lit(props.menuKey)
            }`}
            onClick={(s) => {
              s.event.preventDefault();
              s.event.stopPropagation();
              s.setScalar("active_nested_menu_key", sql.lit(props.menuKey));
            }}
            onFocusIn={(s) => {
              s.setScalar("active_nested_menu_key", sql.lit(props.menuKey));
            }}
            onKeyDown={(s) => {
              s.if(
                sql`event.key = 'ArrowRight' or event.key = 'Enter' or event.key = ' '`,
                (s) => {
                  s.event.preventDefault();
                  s.setScalar(
                    "active_nested_menu_key",
                    sql.lit(props.menuKey),
                  );
                },
              );
            }}
            sx={{
              alignSelf: "stretch",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "38px",
              border: "none",
              borderLeft: "1px solid var(--site-nav-border)",
              borderRadius: "0 10px 10px 0",
              background: "transparent",
              color: "var(--site-nav-muted)",
              cursor: "pointer",
              "&:hover": {
                color: "var(--site-nav-accent)",
                background: "var(--site-nav-soft)",
              },
            }}
          >
            <MaterialIcon icon="ChevronRight" sx={{ fontSize: "18px" }} />
          </button>
        )}
      </div>
      {hasNestedLinks && (
        <Show
          when={sql`active_nested_menu_key = ${sql.lit(props.menuKey)}`}
        >
          <div
            sx={{
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid var(--site-nav-border)",
              ml: props.nested ? "18px" : "24px",
              mt: "2px",
              pl: "8px",
            }}
          >
            {props.link.links?.map((link, index) => (
              <MenuLink
                link={link}
                menuKey={`${props.menuKey}-${index}`}
                nested
              />
            ))}
          </div>
        </Show>
      )}
    </div>
  );
}

function MegaPanel(props: {
  item: MegaMenuItem;
  index: number;
  panelId: string;
}) {
  const panel = props.item.panel;
  const itemText = props.item.ariaLabel ??
    labelText(props.item.label, `menu-${props.index}`);
  return (
    <div
      id={props.panelId}
      className="site-mega-menu"
      aria-label={itemText}
      onMouseEnter={(s) => {
        s.setScalar("menu_hovering", true);
        s.setScalar("active_menu_index", props.index);
      }}
      onKeyDown={(s) => {
        s.if(sql`event.key = 'Escape'`, (s) => {
          s.setScalar("active_menu_index", -1);
          s.setScalar("menu_hovering", false);
        });
      }}
      style={{
        opacity:
          sql`case when active_menu_index = ${props.index} then '1' else '0' end`,
        "pointer-events":
          sql`case when active_menu_index = ${props.index} then 'auto' else 'none' end`,
        transform:
          sql`case when active_menu_index = ${props.index} then 'translateX(-50%) translateY(0)' else 'translateX(-50%) translateY(-4px)' end`,
      }}
      sx={{
        position: "absolute",
        top: "calc(100% + 10px)",
        left: "50%",
        transform: "translateX(-50%) translateY(-4px)",
        width: panel ? "min(880px, calc(100vw - 48px))" : "320px",
        transition: "opacity 0.16s ease, transform 0.16s ease",
        background: "var(--site-nav-surface)",
        border: "1px solid var(--site-nav-border)",
        borderRadius: "14px",
        boxShadow: "0 18px 60px var(--site-nav-shadow)",
        p: "10px",
        zIndex: 50,
      }}
    >
      <div
        sx={{
          display: "grid",
          gridTemplateColumns: panel ? "minmax(260px, 0.9fr) 1.1fr" : "1fr",
          gap: "10px",
        }}
      >
        <div sx={{ display: "flex", flexDirection: "column" }}>
          {props.item.links?.map((link, index) => (
            <MenuLink
              link={link}
              menuKey={`${props.panelId}-primary-${index}`}
            />
          ))}
        </div>
        {panel && (
          <div
            sx={{
              background: "var(--site-nav-soft)",
              border: "1px solid var(--site-nav-border)",
              borderRadius: "12px",
              p: "20px",
            }}
          >
            {panel.eyebrow && (
              <Typography
                level="body-xs"
                sx={{
                  color: "var(--site-nav-accent)",
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  mb: "8px",
                }}
              >
                {panel.eyebrow}
              </Typography>
            )}
            <Typography
              level="h3"
              sx={{
                color: "var(--site-nav-text)",
                fontSize: "1.35rem",
                fontWeight: 650,
                mb: "8px",
              }}
            >
              {panel.title}
            </Typography>
            {panel.description && (
              <Typography
                level="body-sm"
                sx={{
                  color: "var(--site-nav-muted)",
                  lineHeight: 1.6,
                  mb: "14px",
                }}
              >
                {panel.description}
              </Typography>
            )}
            {panel.links && (
              <div
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "8px 12px",
                  mb: panel.cta ? "16px" : 0,
                }}
              >
                {panel.links.map((link) => (
                  <a
                    href={link.href}
                    sx={{
                      color: "var(--site-nav-text)",
                      fontSize: "13px",
                      fontWeight: 600,
                      textDecoration: "none",
                      "&:hover": { color: "var(--site-nav-accent)" },
                    }}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
            {panel.cta && (
              <a
                href={panel.cta.href}
                sx={{
                  color: "var(--site-nav-accent)",
                  fontSize: "13px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                {panel.cta.label} →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Fixed responsive website navbar with desktop mega menus and a mobile drawer.
 *
 * Menus open on hover, focus, or click; close on outside click, Escape, or
 * after a short pointer-leave delay. Styling is intentionally token-driven so
 * each app can supply its own palette through CSS variables.
 */
export function MegaMenuNavbar(props: MegaMenuNavbarProps) {
  const idPrefix = props.idPrefix ?? `site-mega-menu-${getUniqueUiId()}`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("mobile_menu_open", false);
        s.defScalar("active_menu_index", -1);
        s.defScalar("menu_hovering", false);
        s.defScalar("active_nested_menu_key", sql.lit``);
      }}
    >
      <nav
        sx={[
          {
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1200,
            height: "68px",
            background: "var(--site-nav-bg)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid var(--site-nav-border)",
          },
          props.sx,
        ]}
      >
        <div
          sx={{
            maxWidth: "1240px",
            height: "100%",
            mx: "auto",
            px: "18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
            md: { px: "32px" },
          }}
        >
          <a
            href={props.logoHref ?? "/"}
            aria-label="Home"
            onFocusIn={(s) => {
              s.setScalar("active_menu_index", -1);
              s.setScalar("menu_hovering", false);
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            {props.logo}
          </a>
          <div
            sx={{
              display: "none",
              md: {
                display: "flex",
                alignItems: "center",
                gap: "4px",
              },
            }}
          >
            {props.items.map((item, index) => {
              const itemText = item.ariaLabel ??
                labelText(item.label, `nav-${index}`);
              const hasMenu = Boolean(
                (item.links && item.links.length > 0) || item.panel,
              );
              const panelId = `${idPrefix}-${index}`;
              return (
                <div
                  onMouseEnter={(s) => {
                    if (hasMenu) {
                      s.setScalar("menu_hovering", true);
                      s.setScalar("active_menu_index", index);
                      s.setScalar("active_nested_menu_key", sql.lit``);
                    }
                  }}
                  onMouseMove={(s) => {
                    if (hasMenu) {
                      s.setScalar("menu_hovering", true);
                      s.setScalar("active_menu_index", index);
                    }
                  }}
                  onMouseLeave={(s) => {
                    if (hasMenu) {
                      s.setScalar("menu_hovering", false);
                      s.startTaskWithOpts({
                        detached: true,
                        procedure: (s) => {
                          s.sleep(700);
                          s.if(sql`not menu_hovering`, (s) => {
                            s.setScalar("active_menu_index", -1);
                            s.commitUiTreeChanges();
                          });
                        },
                      });
                    }
                  }}
                  sx={{
                    position: "relative",
                  }}
                >
                  {hasMenu
                    ? (
                      <button
                        type="button"
                        aria-label={itemText}
                        aria-expanded={sql`active_menu_index = ${index}`}
                        aria-controls={panelId}
                        onFocusIn={(s) => {
                          s.setScalar("active_menu_index", index);
                          s.setScalar("menu_hovering", true);
                          s.setScalar("active_nested_menu_key", sql.lit``);
                        }}
                        onClick={(s) => {
                          s.setScalar("active_menu_index", index);
                          s.setScalar("menu_hovering", true);
                          s.setScalar("active_nested_menu_key", sql.lit``);
                        }}
                        onKeyDown={(s) => {
                          s.if(sql`event.key = 'Escape'`, (s) => {
                            s.setScalar("active_menu_index", -1);
                            s.setScalar("menu_hovering", false);
                          });
                        }}
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          px: "13px",
                          py: "9px",
                          border: "none",
                          borderRadius: "9px",
                          background: "transparent",
                          color: "var(--site-nav-muted)",
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: "14px",
                          fontWeight: 600,
                          textDecoration: "none",
                          transition: "background 0.15s ease, color 0.15s ease",
                          "&:hover": {
                            background: "var(--site-nav-soft)",
                            color: "var(--site-nav-text)",
                          },
                        }}
                      >
                        {item.label}
                        <MaterialIcon
                          icon="KeyboardArrowDown"
                          sx={{ fontSize: "18px" }}
                        />
                      </button>
                    )
                    : (
                      <a
                        href={item.href ?? "#"}
                        aria-label={itemText}
                        onFocusIn={(s) => {
                          s.setScalar("active_menu_index", -1);
                          s.setScalar("menu_hovering", false);
                        }}
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          px: "13px",
                          py: "9px",
                          borderRadius: "9px",
                          color: "var(--site-nav-muted)",
                          fontSize: "14px",
                          fontWeight: 600,
                          textDecoration: "none",
                          transition: "background 0.15s ease, color 0.15s ease",
                          "&:hover": {
                            background: "var(--site-nav-soft)",
                            color: "var(--site-nav-text)",
                          },
                        }}
                      >
                        {item.label}
                      </a>
                    )}
                  {hasMenu && (
                    <Show when={sql`active_menu_index = ${index}`}>
                      <MegaPanel
                        item={item}
                        index={index}
                        panelId={panelId}
                      />
                    </Show>
                  )}
                </div>
              );
            })}
          </div>
          <div
            sx={{
              display: "none",
              md: { display: "flex", alignItems: "center", gap: "14px" },
            }}
          >
            {props.phone && (
              <a
                href={props.phone.href}
                onFocusIn={(s) => {
                  s.setScalar("active_menu_index", -1);
                  s.setScalar("menu_hovering", false);
                }}
                sx={{
                  display: "none",
                  lg: { display: "inline-block" },
                  color: "var(--site-nav-muted)",
                  fontSize: "13px",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  "&:hover": { color: "var(--site-nav-text)" },
                }}
              >
                {props.phone.label}
              </a>
            )}
            {props.action && (
              <Button
                href={props.action.href}
                size="sm"
                onFocusIn={(s) => {
                  s.setScalar("active_menu_index", -1);
                  s.setScalar("menu_hovering", false);
                }}
                sx={{
                  background: "var(--site-nav-accent)",
                  color: "var(--site-nav-surface)",
                  borderRadius: "9px",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  "&:hover": {
                    hoverEnabled: {
                      background: "var(--site-nav-accent-strong)",
                      color: "var(--site-nav-surface)",
                    },
                  },
                }}
              >
                {props.action.label}
              </Button>
            )}
          </div>
          <div sx={{ display: "flex", md: { display: "none" } }}>
            <IconButton
              icon="Menu"
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("mobile_menu_open", true)}
            />
          </div>
        </div>
      </nav>
      <Show when={sql`active_menu_index >= 0`}>
        <div
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 1199,
            background: "transparent",
          }}
          onMouseEnter={(s) => {
            s.setScalar("menu_hovering", false);
            s.startTaskWithOpts({
              detached: true,
              procedure: (s) => {
                s.sleep(700);
                s.if(sql`not menu_hovering`, (s) => {
                  s.setScalar("active_menu_index", -1);
                  s.commitUiTreeChanges();
                });
              },
            });
          }}
          onClick={(s) => {
            s.setScalar("active_menu_index", -1);
            s.setScalar("menu_hovering", false);
          }}
        />
      </Show>
      <Show when={sql`mobile_menu_open`}>
        <div
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            background: "var(--site-nav-overlay)",
          }}
          onClick={(s) => s.setScalar("mobile_menu_open", false)}
        />
        <aside
          sx={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 1301,
            width: "min(380px, 92vw)",
            background: "var(--site-nav-surface)",
            borderLeft: "1px solid var(--site-nav-border)",
            boxShadow: "0 24px 80px var(--site-nav-shadow-strong)",
            p: "20px",
            overflowY: "auto",
          }}
        >
          <div className="flex items-center justify-between mb-6">
            {props.logo}
            <IconButton
              icon="Close"
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("mobile_menu_open", false)}
            />
          </div>
          <div sx={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {props.items.map((item, itemIndex) => {
              const itemText = item.ariaLabel ??
                labelText(item.label, `mobile-nav-${itemIndex}`);
              return (
                <div>
                  <Typography
                    level="body-xs"
                    sx={{
                      color: "var(--site-nav-accent)",
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      mb: "8px",
                    }}
                  >
                    {item.label}
                  </Typography>
                  <div sx={{ display: "flex", flexDirection: "column" }}>
                    {item.links?.map((link, index) => (
                      <MenuLink
                        link={link}
                        menuKey={`mobile-${itemText}-primary-${index}`}
                      />
                    ))}
                    {item.panel?.links?.map((link, index) => (
                      <MenuLink
                        link={link}
                        menuKey={`mobile-${itemText}-panel-${index}`}
                      />
                    ))}
                    {item.panel?.cta && (
                      <MenuLink
                        link={item.panel.cta}
                        menuKey={`mobile-${itemText}-cta`}
                      />
                    )}
                    {!item.links && item.href && (
                      <MenuLink
                        link={{
                          label: item.label,
                          ariaLabel: itemText,
                          href: item.href,
                        }}
                        menuKey={`mobile-${itemText}-self`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {props.phone && (
              <MenuLink link={props.phone} menuKey="mobile-phone" />
            )}
            {props.action && (
              <Button
                href={props.action.href}
                onClick={(s) => s.setScalar("mobile_menu_open", false)}
                sx={{
                  background: "var(--site-nav-accent)",
                  color: "var(--site-nav-surface)",
                  borderRadius: "9px",
                  "&:hover": {
                    hoverEnabled: {
                      background: "var(--site-nav-accent-strong)",
                      color: "var(--site-nav-surface)",
                    },
                  },
                }}
              >
                {props.action.label}
              </Button>
            )}
          </div>
        </aside>
      </Show>
    </Data>
  );
}
