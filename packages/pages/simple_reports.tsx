import { Report, ReportParameters } from "components/report";
import { Typography } from "components/typography";
import {
  type GatherReport,
  type ReportsGatherICtx,
  ReportsGatherICtxKey,
  SidebarPresenceICtxKey,
  type SimpleReportsGatherICtx,
  SimpleReportsGatherICtxKey,
} from "std/ictx";
import {
  NavigationItemsSharedContext,
  PagesSharedContext,
  SidebarItemsSharedContext,
} from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import { createStyles, cssVar } from "std/style_utils";
import {
  addCtx,
  type ContextInstance,
  gatherChildrenContextInfo,
  type Node,
  Route,
  Routes,
  useICtx,
  useOptionalICtx,
  usePhase,
  useSharedContext,
} from "std/ui";

/** Props for {@link SimpleReportsPage}. */
export interface SimpleReportsPageProps {
  /** Route path the reports page mounts at. Defaults to `/reports`. */
  path?: string;
  /**
   * Path prefix individual report routes are mounted under. Defaults to `path`
   * (or `/reports` when `path` is `/`). Set this to expose the report list at a
   * root path while keeping report URLs under a distinct prefix.
   */
  reportPathBase?: string;
  /** Report and section declarations ({@link SimpleReportsPage.Report} / {@link SimpleReportsPage.Section}). */
  children: Node;
}

interface SimpleReportsPageSection {
  header: string;
  reports: GatherReport[];
}

class SimpleReportsGatherContext
  implements ContextInstance, ReportsGatherICtx, SimpleReportsGatherICtx {
  implementICtxs = [ReportsGatherICtxKey, SimpleReportsGatherICtxKey];

  path?: string;
  sections: SimpleReportsPageSection[] = [];
  reportsWithoutSections: GatherReport[] = [];

  defaultReport?: GatherReport;

  get sectionName() {
    return this.sections.at(-1)?.header ?? "";
  }

  addSection = (header: string) => {
    this.sections.push({ header, reports: [] });
  };

  addReport = (report: GatherReport) => {
    if (report.default) {
      if (this.sections.at(-1)) {
        report.section = this.sectionName;
        this.sections.at(-1)!.reports.push(report);
      }
      this.defaultReport = report;
      return;
    }
    if (this.sections.at(-1)) {
      this.sections.at(-1)!.reports.push(report);
    } else {
      this.reportsWithoutSections.push(report);
    }
  };
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
  notFoundPage: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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
  pageHeader: {
    mb: 4,
  },
  parameters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    mb: 8,
  },
  pageWrapper: {
    py: 6,
    px: 6,
    display: "flex",
    flexDirection: "column",
    alignItems: "start",
  },
});

/**
Component that creates a page with various reports and data visualizations.

@category Page Component, Initial

@examples
[Example](../../examples/kitchen_sink/apps/kitchen-sink.yolmstaging.net.tsx)

 */
export function SimpleReportsPage(props: SimpleReportsPageProps) {
  const gatherContext = new SimpleReportsGatherContext();
  addCtx(gatherContext);
  gatherChildrenContextInfo(props.children);
  const navigationItems = useSharedContext(NavigationItemsSharedContext);
  if (props.path !== "/") {
    navigationItems.add({
      label: "Reports",
      url: props.path ?? "/reports",
    });
  }
  useSharedContext(PagesSharedContext).add(
    props.path ?? "/reports",
    "Reports",
    "SimpleReportsPage",
  );
  const reportPathBase = props.reportPathBase ??
    (props.path === "/" ? "/reports" : props.path) ??
    "/reports";
  const path = props.path ?? "/reports";
  const unsectionedDefaultReport = gatherContext.defaultReport?.section
    ? undefined
    : gatherContext.defaultReport;
  const routes: any[] = [];
  for (
    const report of [
      ...(unsectionedDefaultReport ? [unsectionedDefaultReport] : []),
      ...gatherContext.sections.flatMap((section) => section.reports),
      ...gatherContext.reportsWithoutSections,
    ]
  ) {
    routes.push(
      <Route
        path={`${reportPathBase}/${report.urlName}`}
        title={report.name}
      >
        {report.node}
      </Route>,
    );
  }
  routes.push(
    <Route path="*">
      {gatherContext.defaultReport
        ? (
          gatherContext.defaultReport.node
        )
        : (
          <div sx={styles.notFoundPage}>
            <Typography level="h4">
              Click on a report to see it here!
            </Typography>
          </div>
        )}
    </Route>,
  );
  function ReportLink(props: { report: GatherReport }) {
    const { report } = props;
    const reportPath = `${reportPathBase}/${report.urlName}`;
    const isDefault = report === gatherContext.defaultReport;
    return (
      <a
        href={reportPath}
        sx={styles.link}
        dynamicClasses={[
          {
            classes: "active",
            condition: isDefault
              ? sql.and(
                [
                  ...gatherContext.sections.flatMap((s) => s.reports),
                  ...gatherContext.reportsWithoutSections,
                ]
                  .filter((r) => !r.default)
                  .map((r) => {
                    const rPath = `${reportPathBase}/${r.urlName}`;
                    return sql`not uri.is_match(location.pathname, ${
                      sql.lit(rPath)
                    })`;
                  }),
              )
              : sql`uri.is_match(location.pathname, ${sql.lit(reportPath)})`,
          },
        ]}
      >
        {report.name}
      </a>
    );
  }
  if (usePhase() === "gather") {
    const sidebarItems = useSharedContext(SidebarItemsSharedContext);
    if (unsectionedDefaultReport) {
      sidebarItems.add({
        section: "Overview",
        order: 90,
        items: [{
          label: unsectionedDefaultReport.name,
          href: `${reportPathBase}/${unsectionedDefaultReport.urlName}`,
        }],
      });
    }
    for (const section of gatherContext.sections) {
      sidebarItems.add({
        section: section.header,
        order: 90,
        items: section.reports.map((report) => ({
          label: report.name,
          href: `${reportPathBase}/${report.urlName}`,
        })),
      });
    }
    if (gatherContext.reportsWithoutSections.length > 0) {
      sidebarItems.add({
        section: "Reports",
        order: 90,
        items: gatherContext.reportsWithoutSections.map((report) => ({
          label: report.name,
          href: `${reportPathBase}/${report.urlName}`,
        })),
      });
    }
  }
  const overviewSection = gatherContext.sections.find((section) =>
    section.header === "Overview"
  );
  const leftSection = (
    <div sx={styles.links}>
      {(unsectionedDefaultReport || overviewSection) && (
        <div>
          <Typography level="body-lg" sx={styles.sectionHeader}>
            Overview
          </Typography>
          <div sx={styles.sectionLinks}>
            {unsectionedDefaultReport && (
              <ReportLink report={unsectionedDefaultReport} />
            )}
            {overviewSection?.reports.map((report) => (
              <ReportLink report={report} />
            ))}
          </div>
        </div>
      )}
      {gatherContext.reportsWithoutSections.length > 0 && (
        <div>
          <Typography level="body-lg" sx={styles.sectionHeader}>
            Reports
          </Typography>
          <div sx={styles.sectionLinks}>
            {gatherContext.reportsWithoutSections.map((report) => (
              <ReportLink report={report} />
            ))}
          </div>
        </div>
      )}
      {gatherContext.sections
        .filter((s) => s.header !== "Overview")
        .map((section) => (
          <div>
            <Typography level="body-lg" sx={styles.sectionHeader}>
              {section.header}
            </Typography>
            <div sx={styles.sectionLinks}>
              {section.reports.map((report) => <ReportLink report={report} />)}
            </div>
          </div>
        ))}
    </div>
  );
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  if (reportPathBase !== path) {
    return (
      <>
        <Route path={reportPathBase} title="Reports">
          <div sx={styles.root}>
            {!hasSidebar?.presence && leftSection}
            <div sx={styles.routeContainer}>
              <Routes>{routes}</Routes>
            </div>
          </div>
        </Route>
        <Route path={path} title="Reports">
          <div sx={styles.root}>
            {!hasSidebar?.presence && leftSection}
            <div sx={styles.routeContainer}>
              <Routes>{routes}</Routes>
            </div>
          </div>
        </Route>
      </>
    );
  }
  return (
    <Route path={path} title="Reports">
      <div sx={styles.root}>
        {!hasSidebar?.presence && leftSection}
        <div sx={styles.routeContainer}>
          <Routes>{routes}</Routes>
        </div>
      </div>
    </Route>
  );
}

SimpleReportsPage.Section = function SimpleReportsPageSection(props: {
  header: string;
  children: Node;
}) {
  const { header, children } = props;
  const gatherContext = useICtx(SimpleReportsGatherICtxKey);
  gatherContext.addSection(header);
  gatherChildrenContextInfo(children);
  return null;
};

/**
 A component that defines a report in the system.

 This component is used to create a report with a name, optional URL name, and content.
 It adds the report to the system's report collection and renders its content within a
 structured layout.

 @category UI Component

 @param props.name The name of the report
 @param props.urlName Optional URL-friendly name for the report
 @param props.children The content of the report
 @param props.sx
 @param props.disableHeader Whether to disable the default header of the report

 @examples
 [Example](../../examples/kitchen_sink/apps/kitchen-sink.yolmstaging.net.tsx)
 */
SimpleReportsPage.Report = Report;
SimpleReportsPage.ReportParameters = ReportParameters;
