import { sql } from "./sql_utils";
import type { NumericExpr, Sql } from "./sql_utils";
import type { Table } from "./system";
import { usePhase, useSharedContext } from "./ui";

/**
 * Per-app shared context that collects navigation entries declared by
 * pages and blocks. Use via `useSharedContext(NavigationItemsSharedContext)`
 * and call `.add({ label, url })` from a page (typically inside a
 * `<Navbar>` block) to contribute an entry.
 */
export class NavigationItemsSharedContext {
  items: { label: string; url: string }[] = [];

  /** Append a navigation entry (deduplicated by `url`). */
  add(item: { label: string; url: string }) {
    if (this.items.find((i) => i.url === item.url)) {
      return;
    }
    this.items.push(item);
  }
}

/**
 * Per-app shared context that collects every registered page. Used by
 * generated documentation and the studio nav UI.
 */
export class PagesSharedContext {
  pages: { path: string; label: string; source: string }[] = [];
  /** Register a page. `source` is the source-file path. */
  add(path: string, label: string, source: string) {
    this.pages.push({ path, label, source });
  }
}

/** One leaf entry inside a {@link SidebarGroupDef}. */
export interface SidebarItemDef {
  /** Display label. */
  label: string;
  /** Target URL. */
  href: string;
  /** Optional icon name. */
  icon?: string;
  /** Permission required to see this item. */
  requiredPermission?: string;
}

/** One group of items rendered in the sidebar. */
export interface SidebarGroupDef {
  /** Section heading. */
  section: string;
  /** Optional icon name. */
  icon?: string;
  /** Permission required to see the group. */
  requiredPermission?: string;
  /** Sort order (smaller = earlier). */
  order?: number;
  /** Leaf items belonging to this group. */
  items?: SidebarItemDef[];
}

/**
 * Per-app shared context for sidebar groups and items. Use
 * `useSharedContext(SidebarItemsSharedContext)` from inside a page or
 * block to contribute groups; the `<Sidebar>` component reads from it.
 */
export class SidebarItemsSharedContext {
  items: SidebarGroupDef[] = [];
  add(item: SidebarGroupDef) {
    const existingGroup = this.items.find((i) => i.section === item.section);
    if (existingGroup) {
      if (item.icon && !existingGroup.icon) {
        existingGroup.icon = item.icon;
      }
      if (item.requiredPermission && !existingGroup.requiredPermission) {
        existingGroup.requiredPermission = item.requiredPermission;
      }
      if (item.order !== undefined && existingGroup.order === undefined) {
        existingGroup.order = item.order;
      }
      const newItems = item.items ?? [];
      for (const newItem of newItems) {
        if (!existingGroup.items?.find((i) => i.href === newItem.href)) {
          existingGroup.items = existingGroup.items ?? [];
          existingGroup.items.push(newItem);
        }
      }
    } else {
      this.items.push(item);
    }
  }
}

/**
 * Per-app shared context that maps tables to their record-detail URLs.
 * Record pages register themselves here so that other components (chips,
 * inline-record displays, etc.) can build links to a record without
 * having to know its route.
 */
export class TableLinksSharedContext {
  /** URL builders keyed by table name. */
  tables: Record<string, { getUrl: (id: NumericExpr) => Sql }> = {};

  /** Register a URL builder for `table`. */
  add(table: Table, getUrl: (id: NumericExpr) => Sql) {
    this.tables[table.name] = { getUrl };
  }
}

/**
 * Return the URL to the record detail page for `id` of `table`, or
 * `undefined` if no record page is registered for it. Safe to call
 * during render or gather.
 */
export function getHrefToRecordOptional(table: Table, id: NumericExpr) {
  const tableLinks = useSharedContext(TableLinksSharedContext);
  return tableLinks.tables[table.name]?.getUrl?.(id);
}

/** True if a record page has been registered for `table`. */
export function isTableLinkable(table: Table) {
  return !!getHrefToRecordOptional(table, sql.lit`dummy`);
}

/**
 * Like {@link getHrefToRecordOptional} but throws if no record page is
 * registered. During the gather phase a placeholder is returned so the
 * tree can still be analyzed.
 */
export function getHrefToRecord(table: Table, id: NumericExpr) {
  if (usePhase() === "gather") {
    return sql.lit`dummy`;
  }
  const href = getHrefToRecordOptional(table, id);
  if (!href) {
    throw new Error(`Table ${table.name} is not linked to any page`);
  }
  return href;
}
