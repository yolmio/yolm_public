import type { IServerBaseStatements } from "std/statements";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import {
  defQueryWhitelists,
  effectiveCapabilitiesJsonExpr,
} from "blocks/spark/query_policy";
import { validateFormats } from "./format";
import { resolveParameters, validateBindings } from "./parameters";
import type { DashboardBlock } from "./index";

/** Used by preview, save, Spark testWidget and every widget data request.
 * Result is executed_widget_rows (JSON). Inputs are values, never substituted into SQL.
 * The caller establishes dashboard access; this enforces the separate data policy. */
function executeWidgetProcedure<T extends IServerBaseStatements>(
  s: T,
  block: DashboardBlock,
  input: {
    type: Sql;
    query: Sql;
    config: Sql;
    parameters?: Sql;
    dashboardParameters?: Sql;
    dashboardValues?: Sql;
  },
) {
  s.throwErrorIf(
    sql`current_user is null`,
    sql.lit`Sign in to view dashboard data.`,
  );
  s.defScalar("widget_type", input.type);
  s.defScalar("widget_config", sql`coalesce(${input.config}, '{}'::json)`);
  s.throwErrorIf(
    sql`widget_type is null or widget_type not in ('wise', 'line', 'bar', 'number', 'table', 'manual_entry') or json_typeof(widget_config) != 'object'`,
    sql.lit`Choose a supported widget type and configuration object.`,
  );
  s.throwErrorIf(
    sql`coalesce(widget_config->>'height','medium') not in ('small','medium','large')
    or coalesce(widget_config->>'missingValues','gap') not in ('gap','zero')
    or coalesce(widget_config->>'weekEnding','sunday') not in ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')
    or (widget_config->'inverse' is not null and json_typeof(widget_config->'inverse') != 'boolean')
    or (widget_config->'series2Inverse' is not null and json_typeof(widget_config->'series2Inverse') != 'boolean')
    or (widget_config->'series2Label' is not null and json_typeof(widget_config->'series2Label') != 'string')
    or (widget_config->'ownerHeader' is not null and json_typeof(widget_config->'ownerHeader') != 'string')
    or (widget_config->'ownerLabel' is not null and json_typeof(widget_config->'ownerLabel') != 'string')
    or exists(select 1 from (values(widget_config->'graphLow'),(widget_config->'graphDivision'),(widget_config->'series2GraphLow'),(widget_config->'series2GraphDivision')) candidate(value) where value is not null and try_cast(value #>> '{}' as double) is null)`,
    sql.lit`Invalid widget display configuration.`,
  );
  validateFormats(s, sql`widget_config`);
  s.defScalar(
    "widget_effective_capabilities",
    effectiveCapabilitiesJsonExpr(
      block.capabilities,
      sql.lit(
        JSON.stringify(block.capabilities.map((capability) => capability.name)),
      ),
      sql`current_user`,
    ),
  );
  defQueryWhitelists(
    s,
    block.capabilities,
    sql`widget_effective_capabilities`,
    "widget_policy",
  );
  resolveParameters(
    s,
    block,
    input.dashboardParameters ?? sql`'[]'::json`,
    input.dashboardValues ?? sql`'{}'::json`,
    "dashboard_input",
  );
  s.defScalar(
    "widget_bindings",
    sql`coalesce(widget_config->'bindings','{}'::json)`,
  );
  validateBindings(s, sql`widget_config`, sql`dashboard_input_definitions`);
  s.defScalar(
    "widget_supplied_parameters",
    input.parameters ?? sql`'{}'::json`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from json.object_each(widget_supplied_parameters) p where widget_bindings->p.key is not null)`,
    sql.lit`Change bound inputs on the dashboard.`,
  );
  s.defScalar(
    "widget_binding_values",
    sql`widget_supplied_parameters || coalesce((select json_object_agg(binding.key,dashboard_input_resolved->(binding.value #>> '{}')) from json.object_each(widget_bindings) binding),'{}'::json)`,
  );
  resolveParameters(
    s,
    block,
    sql`coalesce(widget_config->'parameters','[]'::json)`,
    sql`widget_binding_values`,
    "widget_input",
  );
  // No conversation or creator context is inherited. Data-scope views use current_user.
  s.setContext(
    sql`json_build_object('parameters', widget_input_resolved)`,
  );
  s.defScalar("executed_widget_rows", sql`'[]'::json`);
  s.if(sql`widget_type = 'manual_entry'`, (s) => {
    if (!block.opts.measurements) {
      s.throwError(sql.lit`Manual measurements are not installed.`);
      return;
    }
    block.opts.measurements.requirePermission(s, "view");
    s.throwErrorIf(
      sql`not exists(select 1 from db.manual_stats where id = try_cast(widget_config->>'measurementId' as bigint) and active)`,
      sql.lit`Select an active manual measurement.`,
    );
  });
  s.if(sql`widget_type != 'manual_entry'`, (s) => {
    s.throwErrorIf(
      sql`widget_policy_view_whitelist = '[]' and widget_policy_table_whitelist = '[]' and widget_policy_field_whitelist = '{}'`,
      sql.lit`You do not have data access for this widget.`,
    );
    s.throwErrorIf(
      sql`${input.query} is null or length(trim(${input.query})) = 0 or length(${input.query}) > 30000`,
      sql.lit`Supply a query of at most 30,000 characters.`,
    );
    const policy = {
      viewWhitelist: sql`widget_policy_view_whitelist`,
      tableWhitelist: sql`widget_policy_table_whitelist`,
      fieldWhitelist: sql`widget_policy_field_whitelist`,
    };
    s.validateDynamicQuery(input.query, "widget_query_check", policy);
    s.throwErrorIf(
      sql`coalesce(widget_query_check.message, widget_query_check.description) is not null`,
      sql`coalesce(widget_query_check.message, widget_query_check.description)`,
    );
    s.dynamicQueryToJson(input.query, {
      ...policy,
      rowCap: 1000,
      defHasMoreScalar: "widget_more",
      defScalar: "widget_query_rows",
    });
    s.setScalar("executed_widget_rows", sql`widget_query_rows`);
    s.throwErrorIf(
      sql`widget_more`,
      sql
        .lit`This widget returns more than 1,000 rows. Aggregate or narrow the query.`,
    );
    s.throwErrorIf(
      sql`exists(select 1 from json.object_each(coalesce(widget_config->'columnFormats','{}'::json)) c
        where (json_array_length(executed_widget_rows)>0 and not exists(select 1 from json.object_each(executed_widget_rows->0) f where f.key=c.key))
        or (c.value->>'type' != 'text' and exists(select 1 from json.array_each(executed_widget_rows) r
          where r.value->>c.key is not null and not coalesce(try_cast(r.value->>c.key as double) between cast('-1e308' as double) and cast('1e308' as double),false))))`,
      sql
        .lit`Column formats must refer to returned columns; numeric formats require numeric JSON values.`,
    );
    // Fixed renderer contract: chart queries return x, value; number returns value.
    // A table may return any approved columns. Null numbers remain gaps.
    s.throwErrorIf(
      sql`widget_type != 'table' and exists(select 1 from json.array_each(executed_widget_rows) r where
      not exists(select 1 from json.object_each(r.value) f where f.key = 'value')
      or (widget_config->>'series2Label' is not null and not exists(select 1 from json.object_each(r.value) f where f.key = 'value2'))
      or (r.value->>'value' is not null and not coalesce(try_cast(r.value->>'value' as double) between cast('-1e308' as double) and cast('1e308' as double),false))
      or (r.value->>'value2' is not null and not coalesce(try_cast(r.value->>'value2' as double) between cast('-1e308' as double) and cast('1e308' as double),false))
      or (widget_type != 'number' and r.value->>'x' is null)
      or (widget_type in ('wise','line') and try_cast(r.value->>'x' as date) is null))`,
      sql
        .lit`Chart queries must return x and numeric value columns; x must be a date for line and WISE charts. Number widgets require value.`,
    );
    s.throwErrorIf(
      sql`widget_type = 'number' and json_array_length(executed_widget_rows) > 1`,
      sql.lit`Number widgets must return at most one row.`,
    );
    s.throwErrorIf(
      sql`widget_type in ('wise','line','bar') and exists(select 1 from json.array_each(executed_widget_rows) r group by r.value->>'x' having count(*) > 1)`,
      sql.lit`Duplicate chart points. Aggregate to one row per x value.`,
    );
    s.throwErrorIf(
      sql`widget_type = 'wise' and exists(select 1 from json.array_each(executed_widget_rows) r where extract(dow from cast(r.value->>'x' as date)) != case coalesce(widget_config->>'weekEnding','sunday') when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3 when 'thursday' then 4 when 'friday' then 5 else 6 end)`,
      sql.lit`WISE chart dates must match the configured week-ending day.`,
    );
  });
  s.defScalar(
    "executed_widget_diagnostics",
    sql`json_build_object('valid', true, 'rowCount', json_array_length(executed_widget_rows), 'empty', json_array_length(executed_widget_rows) = 0, 'sample', (select coalesce(json_agg(r.value),'[]'::json) from (select value from json.array_each(executed_widget_rows) limit 5) r), 'capabilities', widget_effective_capabilities)`,
  );
}

export function executeWidget<T extends IServerBaseStatements>(
  s: T,
  block: DashboardBlock,
  input: {
    type: Sql;
    query: Sql;
    config: Sql;
    parameters?: Sql;
    dashboardParameters?: Sql;
    dashboardValues?: Sql;
    returnErrors?: boolean;
  },
) {
  s.defScalar("previous_widget_context", sql`current_context()`);
  s.defScalar("widget_rows", sql`'[]'::json`);
  s.defScalar("widget_diagnostics", sql`'{}'::json`);
  s.try({
    body: (s) => {
      executeWidgetProcedure(s, block, input);
      s.setScalar("widget_rows", sql`executed_widget_rows`);
      s.setScalar("widget_diagnostics", sql`executed_widget_diagnostics`);
      s.setContext(sql`previous_widget_context`);
    },
    errorName: "widget_execution_error",
    catch: (s) => {
      s.setContext(sql`previous_widget_context`);
      if (input.returnErrors) {
        s.setScalar(
          "widget_diagnostics",
          sql`json_build_object('valid',false,'error',widget_execution_error.message)`,
        );
      } else s.throwError(sql`widget_execution_error.message`);
    },
  });
  s.throwErrorIf(
    sql`widget_diagnostics->>'valid' = 'true' and coalesce(json_array_length(widget_rows),-1) != try_cast(widget_diagnostics->>'rowCount' as bigint)`,
    sql.lit`Widget result validation failed.`,
  );
}
