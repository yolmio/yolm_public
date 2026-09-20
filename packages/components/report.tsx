import {
  CurrentWatchKeyICtxKey,
  ExtendedWatchKeyContext,
  ParamsICtxKey,
  ReportsGatherICtxKey,
  SidebarPresenceICtxKey,
} from "std/ictx";
import { normalizeCase } from "std/inflectors";
import { sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { baseGridStyles, createStyles } from "std/style_utils";
import {
  addCtx,
  DocumentTitle,
  useICtx,
  useOptionalICtx,
  usePhase,
} from "std/ui";
import type { Node } from "std/ui";
import { Params } from "./params";
import { Typography } from "./typography";
import { Sidebar } from "./sidebar";

interface ReportProps {
  name: string;
  urlName?: string;
  children: Node;
  sx?: Style;
  disableHeader?: boolean;
  grid?: boolean;
  default?: boolean;
}

const styles = createStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    py: 3,
    px: 4,
    height: "100%",
  },
  parameters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 2,
  },
  gridRoot: (app) => ({
    ...baseGridStyles,
    py: 4,
    gap: 2,
    px: 2,
    sm: {
      px: 4,
    },
    md: {
      px: 6,
      gap: 4,
    },
    xl: {
      maxWidth: app.theme.tokens.breakpoints.xl,
    },
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    mb: 3,
  },
  headerTitle: {
    flex: 1,
  },
});

/**
 * Declares a single report within a reports section (gathered via
 * {@link ReportsGatherICtxKey}). Wraps its children in a {@link Params}
 * scope so child parameter controls drive the report's watch key, and
 * registers a URL-addressable entry under the surrounding section.
 *
 * Renders nothing directly — it only registers the report during the
 * gather phase. Use `default` to mark the report shown when no specific
 * report is selected, and `grid` to lay children out on the standard
 * page grid.
 *
 * @category UI Component
 */
export function Report(props: ReportProps) {
  const {
    name,
    urlName,
    children,
    sx,
    disableHeader,
    grid,
    default: isDefault,
  } = props;
  const { addReport, sectionName } = useICtx(ReportsGatherICtxKey);
  const baseSx = grid ? styles.gridRoot() : styles.root;
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  addReport({
    name,
    default: isDefault,
    urlName: urlName ??
      normalizeCase(`${sectionName} ${name}`.split(" ").join("-"))
        .map((v) => v.toLowerCase())
        .join("-"),
    node: (
      <Params>
        <DocumentTitle>{name}</DocumentTitle>
        <ExtendWatchKeyWithParams>
          <div sx={sx ? [baseSx, sx] : baseSx}>
            {!disableHeader && hasSidebar?.autoTrigger && (
              <div
                sx={grid
                  ? [styles.header, { gridColumnSpan: 12 }]
                  : styles.header}
              >
                <Sidebar.Trigger />
                <Typography
                  sx={styles.headerTitle}
                  level="title-lg"
                >
                  {name}
                </Typography>
              </div>
            )}
            {!disableHeader && !hasSidebar?.autoTrigger && (
              <Typography
                sx={grid ? { gridColumnSpan: 12 } : {}}
                level="title-lg"
              >
                {name}
              </Typography>
            )}
            {children}
          </div>
        </ExtendWatchKeyWithParams>
      </Params>
    ),
  });
  return null;
}

function ExtendWatchKeyWithParams(props: { children: Node }) {
  if (usePhase() === "gather") {
    return props.children;
  }
  const params = useICtx(ParamsICtxKey);
  const prevCtx = useOptionalICtx(CurrentWatchKeyICtxKey);
  addCtx(
    new ExtendedWatchKeyContext(
      prevCtx,
      Object.keys(params.scalars).map((s) => sql.ref(s)),
    ),
  );
  return props.children;
}

interface ReportParametersProps {
  children: Node;
}

/**
 * Layout wrapper that arranges report parameter controls in a wrapping
 * flex row. Place {@link Params} controls inside it within a {@link Report}.
 *
 * @category UI Component
 */
export function ReportParameters(props: ReportParametersProps) {
  const { children } = props;
  return <div sx={styles.parameters}>{children}</div>;
}
