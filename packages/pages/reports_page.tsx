import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "../std/sql_utils";
import { createStyles, cssVar } from "std/style_utils";
import type { Node } from "std/ui";
import { Route, Routes, Show } from "std/ui";

export interface ReportsPageLink {
  label: string;
  path: string;
}

export interface ReportsPageSection {
  header: string;
  reports: ReportsPageLink[];
}

export interface ReportsPageProps {
  /** URL path for this reports page. The component creates its own Route. */
  path: string;
  sections: ReportsPageSection[] | ReportsPageLink[];
  /** Default report sub-path to navigate to when no specific report is selected. */
  defaultPath: string;
  children: Node;
}

const styles = createStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    md: { flexDirection: "row" },
  },
  links: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "divider",
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: "divider",
    p: 4,
    gap: 4,
    md: { width: 300, minWidth: 300 },
  },
  routeContainer: {
    flexGrow: 1,
    height: "100%",
  },
  sectionHeader: {
    mb: 3,
  },
  sectionLinks: {
    display: "flex",
    flexDirection: "column",
  },
  link: {
    pl: 3,
    py: 2,
    textDecoration: "none",
    color: cssVar("palette-neutral-600"),
    dark: {
      color: cssVar("palette-neutral-200"),
    },
    fontWeight: "semibold",
    borderRadius: "sm",
    "&.active": {
      color: cssVar("palette-primary-soft-color"),
      dark: {
        color: cssVar("palette-primary-soft-color"),
      },
      bgcolor: cssVar("palette-primary-soft-bg"),
    },
  },
  mobileToggle: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    p: 2,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "divider",
    md: { display: "none" },
  },
  desktopSidebar: {
    display: "none",
    md: { display: "flex" },
  },
  mobileSidebar: {
    md: { display: "none" },
  },
});

function isSections(
  items: ReportsPageSection[] | ReportsPageLink[],
): items is ReportsPageSection[] {
  return items.length > 0 && "header" in items[0];
}

function renderLinks(
  items: ReportsPageSection[] | ReportsPageLink[],
  basePath: string,
) {
  if (isSections(items)) {
    return items.map((section) => (
      <div>
        <Typography level="body-lg" sx={styles.sectionHeader}>
          {section.header}
        </Typography>
        <div sx={styles.sectionLinks}>
          {section.reports.map((link) => (
            <a
              href={`${basePath}/${link.path}`}
              sx={styles.link}
              dynamicClasses={[
                {
                  classes: "active",
                  condition: sql`uri.is_match(location.pathname, ${
                    sql.lit(`${basePath}/${link.path}`)
                  })`,
                },
              ]}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    ));
  }
  return (
    <div sx={styles.sectionLinks}>
      {items.map((link) => (
        <a
          href={`${basePath}/${link.path}`}
          sx={styles.link}
          dynamicClasses={[
            {
              classes: "active",
              condition: sql`uri.is_match(location.pathname, ${
                sql.lit(`${basePath}/${link.path}`)
              })`,
            },
          ]}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}

/**
 * A reports page component with a sidebar navigation and content area.
 *
 * Provides a two-column layout: sidebar (300px on md+) with report links,
 * and a content area rendered via Routes. On mobile, the sidebar is toggled
 * via a menu button. Creates its own Route at the given path.
 *
 * @param props.path URL path for this page (creates a Route)
 * @param props.sections Either an array of sections with headers and links, or a flat array of links
 * @param props.defaultPath Default report sub-path to navigate to when no specific report is selected
 * @param props.children Route children for the content area
 *
 * @example
 * ```tsx
 * <ReportsPage
 *   path="/reports"
 *   defaultPath="overview"
 *   sections={[
 *     { header: "Sales", reports: [
 *       { label: "Monthly Sales", path: "monthly-sales" },
 *       { label: "Revenue", path: "revenue" },
 *     ]},
 *   ]}
 * >
 *   <Route path="monthly-sales"><MonthlySalesReport /></Route>
 *   <Route path="revenue"><RevenueReport /></Route>
 * </ReportsPage>
 * ```
 */
export function ReportsPage(props: ReportsPageProps) {
  const { path, sections, defaultPath, children } = props;
  // Normalize path to avoid double slashes when path is "/"
  const basePath = path === "/" ? "" : path;
  const sidebar = renderLinks(sections, basePath);
  return (
    <Route path={path} title="Reports">
      <div sx={styles.root}>
        <Data local procedure={(s) => s.defScalar("sidebar_open", sql`false`)}>
          <div sx={styles.mobileToggle}>
            <IconButton
              variant="plain"
              color="neutral"
              size="sm"
              onClick={(s) =>
                s.setScalar("sidebar_open", sql`not sidebar_open`)}
            >
              <MaterialIcon icon="Menu" />
            </IconButton>
            <Typography level="title-md">Reports</Typography>
          </div>
          <Show when={sql`sidebar_open`}>
            <div sx={[styles.links, styles.mobileSidebar]}>{sidebar}</div>
          </Show>
        </Data>
        <div sx={[styles.links, styles.desktopSidebar]}>{sidebar}</div>
        <div sx={styles.routeContainer}>
          <Routes>
            {children}
            <Route path="*">
              <div
                onMount={(s) =>
                  s.navigate(
                    sql.lit`${basePath}/${defaultPath}`,
                    sql`true`,
                  )}
              />
            </Route>
          </Routes>
        </div>
      </div>
    </Route>
  );
}
