import { Button } from "components/button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";

export interface HierarchyProps {
  /** Rows with id, parent_id, name, path_label, active, and subtitle columns. */
  query: Sql;
  label: string | Sql;
  emptyMessage: string | Sql;
  /** URL parameter used to preserve expanded branches across navigation. */
  expansionParam: string;
  rootId?: Sql;
  mobile?: boolean;
  searchLabel?: string | Sql;
  searchPlaceholder?: string | Sql;
  noMatchesMessage?: string | Sql;
  expandPrefix?: Sql;
  collapsePrefix?: Sql;
  header?: Node;
  headerActions?: Node;
  beforeRows?: (search: Sql) => Node;
  footer?: Node;
  rowAttributes?: (id: Sql) => Record<`data-${string}`, string | Sql>;
  rowActions?: (id: Sql, name: Sql) => Node;
  renderName?: (id: Sql, name: Sql) => Node;
}

/** Searchable, expandable hierarchy. IDs, rather than display names, identify branches. */
export function Hierarchy(props: HierarchyProps) {
  const expanded = sql.ref(props.expansionParam);
  return (
    <Data
      local
      noRefetch
      watch={props.rootId ? [props.rootId] : []}
      queryParams={{
        [props.expansionParam]: {
          type: { type: "String", maxLength: 8000 },
          default: sql.lit`|`,
        },
      }}
      procedure={(s) => {
        s.defScalar("hierarchy_search", sql.lit``);
        s.defScalar("hierarchy_root", props.rootId ?? sql`-1`);
      }}
    >
      <section aria-label={props.label} className="space-y-4">
        {props.header}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            aria-label={props.searchLabel ??
              `Search ${
                typeof props.label === "string"
                  ? props.label.toLowerCase()
                  : "hierarchy"
              }`}
            placeholder={props.searchPlaceholder ?? "Search by name or parent…"}
            value={sql`hierarchy_search`}
            startDecorator={<MaterialIcon icon="Search" />}
            onInput={(s) => s.setScalar("hierarchy_search", sql`target_value`)}
          />
          {props.headerActions}
        </div>
        <Data procedure={(s) => s.defTable("hierarchy_nodes", props.query)}>
          <Data
            watch={[sql`hierarchy_search`, expanded, sql`hierarchy_root`]}
            procedure={(s) => {
              s.defTable(
                "hierarchy_rows",
                sql`with recursive tree as (
              select n.*, 0 as depth, n.path_label as path, n.name || '|' || n.id as sort_path,
                '|' as ancestor_ids, hierarchy_root = -1 as visible
              from hierarchy_nodes n where parent_id is null
              union all
              select n.*, case when p.id = hierarchy_root then 0 else p.depth + 1 end,
                p.path || ' / ' || n.path_label,
                p.sort_path || '/' || n.name || '|' || n.id,
                p.ancestor_ids || p.id || '|',
                p.id = hierarchy_root or (p.visible and strpos(${expanded}, '|' || p.id || '|') > 0)
              from hierarchy_nodes n join tree p on p.id = n.parent_id
            ) select t.*, exists(select 1 from hierarchy_nodes c where c.parent_id = t.id) as has_children
              from tree t where case when trim(hierarchy_search) = '' then visible
                else (hierarchy_root = -1 or strpos(ancestor_ids, '|' || hierarchy_root || '|') > 0)
                  and strpos(lower(path || ' ' || coalesce(subtitle, '')), lower(trim(hierarchy_search))) > 0 end
              order by sort_path`,
              );
            }}
          >
            {props.beforeRows?.(sql`hierarchy_search`)}
            <div className="divide-y divide-divider">
              <Each
                table="hierarchy_rows"
                recordName="hierarchy_row"
                orderBy={sql`hierarchy_row.sort_path`}
              >
                <article
                  data-testid="hierarchy-row"
                  data-record-id={sql`hierarchy_row.id`}
                  data-nested={sql`hierarchy_row.depth > 0 and trim(hierarchy_search) = ''`}
                  {...props.rowAttributes?.(sql`hierarchy_row.id`)}
                  className="relative flex min-h-14 min-w-0 items-center gap-2 px-2 py-2"
                  sx={{
                    "&[data-nested=true]::before": {
                      content: '""',
                      position: "absolute",
                      left: props.mobile ? "8px" : "-8px",
                      top: "0px",
                      width: "12px",
                      height: "28px",
                      borderLeft: "1px solid",
                      borderBottom: "1px solid",
                      borderColor: "neutral.200",
                      pointerEvents: "none",
                    },
                    "&:hover": { backgroundColor: "primary.50" },
                  }}
                  style={{
                    "margin-left":
                      sql`case when trim(hierarchy_search) = '' then least(hierarchy_row.depth, 6) * ${
                        props.mobile ? 16 : 32
                      } else 0 end || 'px'`,
                  }}
                >
                  <Show
                    when={sql`hierarchy_row.has_children and trim(hierarchy_search) = ''`}
                    fallback={<span className="w-8 shrink-0" />}
                  >
                    <Button
                      size="sm"
                      variant="plain"
                      sx={{
                        width: "32px",
                        minWidth: "32px",
                        padding: 0,
                        flexShrink: 0,
                      }}
                      aria-label={sql`case when strpos(${expanded}, '|' || hierarchy_row.id || '|') > 0 then ${
                        props.collapsePrefix ?? sql.lit`Collapse `
                      } else ${
                        props.expandPrefix ?? sql.lit`Expand `
                      } end || hierarchy_row.name`}
                      aria-expanded={sql`strpos(${expanded}, '|' || hierarchy_row.id || '|') > 0`}
                      onClick={(s) =>
                        s.setQueryParam(
                          props.expansionParam,
                          sql`case when strpos(${expanded}, '|' || hierarchy_row.id || '|') > 0 then replace(${expanded}, '|' || hierarchy_row.id || '|', '|') else ${expanded} || hierarchy_row.id || '|' end`,
                        )}
                    >
                      <Show
                        when={sql`strpos(${expanded}, '|' || hierarchy_row.id || '|') > 0`}
                        fallback={<MaterialIcon icon="ChevronRight" />}
                      >
                        <MaterialIcon icon="ExpandMore" />
                      </Show>
                    </Button>
                  </Show>
                  <div className="min-w-0 flex-1">
                    {props.renderName?.(
                      sql`hierarchy_row.id`,
                      sql`hierarchy_row.name`,
                    ) ?? (
                      <span className="font-medium">
                        {sql`hierarchy_row.name`}
                      </span>
                    )}
                    <Show
                      when={sql`trim(hierarchy_search) != '' and hierarchy_row.parent_id is not null`}
                    >
                      <p className="text-xs text-secondary">
                        {sql`hierarchy_row.path`}
                      </p>
                    </Show>
                    <p className="text-xs text-secondary">
                      {sql`hierarchy_row.subtitle`}
                    </p>
                  </div>
                  <Show when={sql`not hierarchy_row.active`}>
                    <span className="text-xs text-secondary">Inactive</span>
                  </Show>
                  {props.rowActions?.(
                    sql`hierarchy_row.id`,
                    sql`hierarchy_row.name`,
                  )}
                </article>
              </Each>
            </div>
            <Show when={sql`not exists(select 1 from hierarchy_rows)`}>
              <p className="py-8 text-center text-secondary">
                {sql`case when trim(hierarchy_search) = '' then ${
                  typeof props.emptyMessage === "string"
                    ? sql.lit(props.emptyMessage)
                    : props.emptyMessage
                } else ${
                  typeof props.noMatchesMessage === "string"
                    ? sql.lit(props.noMatchesMessage)
                    : props.noMatchesMessage ??
                      sql.lit`No matches. Try another name.`
                } end`}
              </p>
            </Show>
          </Data>
        </Data>
        {props.footer}
      </section>
    </Data>
  );
}
