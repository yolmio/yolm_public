import { sql } from "std/sql_utils";
import type { StyleObject } from "std/style_types";
import type { Node } from "std/ui";
import { Show } from "std/ui";
import { Data } from "std/data";
import { MaterialIcon } from "./material_icon";

const styles = {
  expandable: {
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    gap: 3,
    px: 2,
    py: 2,
    fontSize: "sm",
    fontWeight: "medium",
    textDecoration: "none",
    color: "text-secondary",
    borderRadius: "md",
    cursor: "pointer",
    "&:hover": {
      backgroundColor: "primary-50",
      dark: {
        backgroundColor: "primary-800",
      },
    },
    "&.active": {
      color: "primary-plain-color",
      backgroundColor: "primary-50",
      dark: {
        backgroundColor: "primary-800",
      },
    },
    "&:active": {
      backgroundColor: "primary-100",
      dark: {
        backgroundColor: "primary-700",
      },
    },
  },
  viewExpandable: {
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    gap: 3,
    px: 2,
    py: 2,
    fontSize: "sm",
    fontWeight: "medium",
    textDecoration: "none",
    color: "text-secondary",
    borderRadius: "md",
    cursor: "pointer",
    "&:hover": {
      backgroundColor: "secondary-50",
      dark: {
        backgroundColor: "secondary-800",
      },
    },
    "&.active": {
      color: "secondary-plain-color",
      backgroundColor: "secondary-50",
      dark: {
        backgroundColor: "secondary-800",
      },
    },
    "&:active": {
      backgroundColor: "secondary-100",
      dark: {
        backgroundColor: "secondary-700",
      },
    },
  },
};

/**
 * Expand/collapse wrapper for a block of content with a clickable label
 * and customisable "see more" / "see less" affordances.
 *
 * Renders the children inside a region that is hidden by default and
 * toggles open when the label is clicked. The `type` prop tunes the
 * styling: `"table"` (default) for collapses inside data tables,
 * `"view"` for standalone view-style sections.
 */
export function CollapseControl({
  label,
  children,
  seeMore,
  seeLess,
  sx,
  className,
  type = "table",
}: {
  label: Node;
  children: Node;
  seeMore?: Node;
  seeLess?: Node;
  sx?: StyleObject;
  className?: string;
  type?: "view" | "table";
}) {
  const styleToUse = type === "view"
    ? styles.viewExpandable
    : styles.expandable;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("open", false);
      }}
    >
      <div
        sx={[styleToUse, sx]}
        dynamicClasses={[{ classes: "active", condition: sql`open` }]}
        onClick={(s) => s.toggle("open")}
        className={className}
      >
        {label}
        <div className="grow" />

        <Show
          when={sql`open`}
          fallback={seeMore ?? <MaterialIcon icon="KeyboardArrowRight" />}
        >
          {seeLess ?? <MaterialIcon icon="KeyboardArrowDown" />}
        </Show>
      </div>
      <Show when={sql`open`}>{children}</Show>
    </Data>
  );
}
