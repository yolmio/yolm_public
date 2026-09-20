import {
  CurrentRecordICtxKey,
  CurrentTableICtxKey,
  SidebarPresenceICtxKey,
} from "std/ictx";
import { getHrefToRecord } from "std/shared_contexts";
import { sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { useICtx, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { Button } from "./button";
import { DeleteRecordButton } from "./delete_record_dialog";
import { Sidebar } from "./sidebar";
import { Typography } from "./typography";

interface PageHeaderProps {
  sx?: Style;
  children: Node;
  className?: string;
}

const styles = createStyles({
  root: {
    gridColumnSpan: "full",
    display: "flex",
    gap: 4,
    alignItems: "center",
    flexDirection: "column",
    md: {
      alignItems: "flex-start",
      flexDirection: "row",
    },
  },
  actions: {
    display: "flex",
    gap: 2,
  },
  grow: {
    display: "none",
    md: {
      flexGrow: 1,
      display: "block",
    },
  },
  chips: {
    display: "flex",
    gap: 2,
  },
  column: {
    display: "flex",
    gap: 1,
    flexDirection: "column",
  },
});

/**
 * Standard page-header layout: title, optional subtitle/description, and
 * a trailing action slot. Aware of the surrounding sidebar so spacing
 * matches the rest of the app.
 *
 * See {@link https://docs.yolm.io/ui/page_header | Page header}.
 */
export function PageHeader(props: PageHeaderProps) {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  return (
    <header
      sx={props.sx ? [styles.root, props.sx] : styles.root}
      className={props.className}
    >
      {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
      {props.children}
    </header>
  );
}

/**
 * Standard title/action header for custom pages.
 *
 * This wraps {@link PageHeader} with a Typography title, optional trailing
 * actions, and sidebar trigger support inherited from `PageHeader`. Use it for
 * app-specific pages that are not using a higher-level page template.
 */
export function PageTitleHeader(props: {
  title: Node;
  actions?: Node;
  className?: string;
  level?: "h1" | "h2" | "h3" | "h4" | "title-lg" | "title-md" | "title-sm";
}) {
  return (
    <PageHeader className={props.className ?? "mb-6"}>
      <Typography level={props.level ?? "h3"}>{props.title}</Typography>
      <PageHeader.Grow />
      {props.actions
        ? <PageHeader.Actions>{props.actions}</PageHeader.Actions>
        : undefined}
    </PageHeader>
  );
}

/** Flexible spacer that pushes following header content to the right (md+ only). */
PageHeader.Grow = function PageHeaderGrow() {
  return <div sx={styles.grow} />;
};

/** Trailing action slot; lays out its buttons in a gapped row. */
PageHeader.Actions = function PageHeaderActions(props: { children: Node }) {
  return <div sx={styles.actions}>{props.children}</div>;
};

interface DefaultActionsProps {
  /** Omit the Edit button. */
  disableEdit?: boolean;
  /** Omit the Delete button. */
  disableDelete?: boolean;
}

/**
 * Standard Edit + Delete actions for a record page. Reads the current
 * table/record from context; Edit links to the record's edit page and
 * Delete uses {@link DeleteRecordButton} with undo, navigating back to
 * the table on commit.
 */
PageHeader.DefaultActions = function PageHeaderDefaultActions(
  props: DefaultActionsProps,
) {
  const table = useICtx(CurrentTableICtxKey).currentTable;
  const recordId = useICtx(CurrentRecordICtxKey).currentRecordId;
  return (
    <PageHeader.Actions>
      {!props.disableEdit && (
        <Button
          variant="soft"
          color="neutral"
          startIcon="Edit"
          size="sm"
          href={sql.concat(getHrefToRecord(table, recordId), "/edit")}
        >
          Edit
        </Button>
      )}
      {!props.disableDelete && (
        <DeleteRecordButton
          size="sm"
          globalUndoSnackbarKey={`page_header_${table.name}_undo`}
          afterTransactionCommit={(s) =>
            s.navigate(sql.lit`/${table.getBaseUrl()}`)}
        >
          Delete
        </DeleteRecordButton>
      )}
    </PageHeader.Actions>
  );
};

/** Row of chips/badges for the header (e.g. status, tags). */
PageHeader.Chips = function PageHeaderChips(props: { children: Node }) {
  return <div sx={styles.chips}>{props.children}</div>;
};

/** Stacks header content vertically (e.g. title over subtitle). */
PageHeader.Column = function PageHeaderColumn(props: { children: Node }) {
  return <div sx={styles.column}>{props.children}</div>;
};
