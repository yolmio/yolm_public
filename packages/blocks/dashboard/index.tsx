import { addMinuteDurationFns, system } from "std/system";
import type { Block } from "std/system";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { SparkBlock } from "blocks/spark";
import type { ManualMeasurementsBlock } from "blocks/manual_measurements";
import { hasSparkPermissionGate } from "blocks/spark/permissions";
import type { DashboardRecordSource } from "./parameters";
export type { DashboardRecordSource } from "./parameters";
import { dashboardCapability } from "./spark";

export { DashboardListPage, DashboardPage, DashboardWidget } from "./page";
export { executeWidget } from "./query";
export const widgetTypes = [
  "wise",
  "line",
  "bar",
  "number",
  "table",
  "manual_entry",
] as const;
export const widgetWidths = [
  "quarter",
  "third",
  "half",
  "two_thirds",
  "full",
] as const;

export class DashboardBlock implements Block {
  blockName = "DashboardBlock";
  componentDependencies = [
    "DashboardPage",
    "DashboardListPage",
    "DashboardWidget",
  ];
  constructor(
    readonly opts: {
      spark: () => SparkBlock;
      /** Link to Spark with an editable prompt, possibly in another app. */
      sparkHref: (prompt: Sql) => Sql;
      measurements?: ManualMeasurementsBlock;
      permissions: { create: Sql; admin: Sql };
      recordSources?: readonly DashboardRecordSource[];
      basePath?: string;
    },
  ) {}
  get capabilities() {
    return this.opts.spark().capabilities.filter((capability) =>
      !capability.internal
    );
  }
  get sparkCapability() {
    return dashboardCapability(this);
  }
  get basePath() {
    return this.opts.basePath ?? "/dashboards";
  }
  initialize() {
    addMinuteDurationFns();
    system.enum_({ name: "dashboard_layout", values: ["scrolling", "tabs"] });
    system.enum_({ name: "dashboard_widget_type", values: [...widgetTypes] });
    system.enum_({ name: "dashboard_widget_width", values: [...widgetWidths] });
    system.db.table("dashboards", (t) => {
      t.string("key", 120).unique();
      t.string("name", 160).notNull();
      t.fk("owner_id", "sys_users");
      t.enum("layout", "dashboard_layout").notNull().default(
        sql.lit`scrolling`,
      );
      t.json("parameters").notNull().default(sql`'[]'::json`);
      t.recordDisplayName(["name"], (name) => name);
      t.check({
        fields: ["name"],
        check: ([name]) => sql`length(trim(${name})) > 0`,
        errorMessage: () => sql.lit`Enter a dashboard name.`,
      });
    });
    system.db.table("dashboard_capabilities", (t) => {
      t.fk("dashboard_id", "dashboards").notNull().onDelete("Cascade");
      t.string("capability", 120).notNull();
      t.unique(["dashboard_id", "capability"]);
    });
    system.db.table("dashboard_sections", (t) => {
      t.fk("dashboard_id", "dashboards").notNull().onDelete("Cascade");
      t.string("name", 160);
      t.check({
        fields: ["name"],
        check: ([name]) => sql`${name} is null or length(trim(${name})) > 0`,
        errorMessage: () => sql.lit`Enter a section name.`,
      });
      t.ordering("sort_order").notNull().default(sql`ordering.new()`);
      t.recordDisplayName(["name"], (name) => name);
    });
    system.db.table("dashboard_widgets", (t) => {
      t.fk("section_id", "dashboard_sections").notNull().onDelete("Cascade");
      t.string("title", 160).notNull();
      t.enum("type", "dashboard_widget_type").notNull();
      t.string("query", 30000).multiline();
      t.json("config").notNull().default(sql`'{}'::json`);
      t.enum("width", "dashboard_widget_width").notNull().default(
        sql.lit`third`,
      );
      t.ordering("sort_order").notNull().default(sql`ordering.new()`);
      t.timestampUtc("updated_at").notNull().default(sql`now()`);
    });
  }
  canView(id: Sql) {
    let permitted: Sql = sql.false;
    for (const capability of this.capabilities) {
      permitted = sql`(${permitted}) or (case when audience_cap.capability=${
        sql.lit(capability.name)
      } then (${
        hasSparkPermissionGate(
          capability.permission,
          capability.permissions,
          sql`current_user`,
        )
      }) else false end)`;
    }
    return sql`current_user is not null and exists(select 1 from db.dashboards access_dashboard where access_dashboard.id = ${id} and
      (access_dashboard.owner_id = current_user or (access_dashboard.owner_id is null and ((${this.opts.permissions.admin}) or exists(select 1 from db.dashboard_capabilities audience_cap where audience_cap.dashboard_id=access_dashboard.id and (${permitted}))))))`;
  }
  selectedAudience(id: Sql) {
    return sql`coalesce((select json_agg(selected_cap.capability order by selected_cap.capability) from db.dashboard_capabilities selected_cap where selected_cap.dashboard_id=${id}),'[]'::json)`;
  }
  /** Caller validates selections and owns the transaction. */
  setAudience<T extends import("std/statements").IStatementsBase>(
    s: T,
    id: Sql,
    values: Sql,
  ) {
    s.modify(
      sql`delete from db.dashboard_capabilities where dashboard_id=${id}`,
    );
    s.modify(
      sql`insert into db.dashboard_capabilities(dashboard_id,capability) select ${id},value #>> '{}' from json.array_each(${values}) group by value #>> '{}'`,
    );
  }
  canManage(id: Sql) {
    return sql`current_user is not null and exists(select 1 from db.dashboards access_dashboard where access_dashboard.id = ${id} and
      (access_dashboard.owner_id = current_user or (access_dashboard.owner_id is null and (${this.opts.permissions.admin}))))`;
  }
  canEdit(id: Sql) {
    return this.canManage(id);
  }
  require<T extends import("std/statements").IStatementsBase>(
    s: T,
    action: "view" | "edit" | "manage",
    id: Sql,
  ) {
    const allowed = action === "view"
      ? this.canView(id)
      : action === "edit"
      ? this.canEdit(id)
      : this.canManage(id);
    s.throwErrorIf(
      sql`not coalesce((${allowed}), false)`,
      sql
        .lit`This dashboard is unavailable or you do not have permission for this action.`,
    );
  }
}
