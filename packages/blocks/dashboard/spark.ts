import type { SparkCapability } from "blocks/spark";
import type {
  GeneralServerStatements,
  StateStatements,
  TestStatements,
  UiServerStatements,
} from "std/statements";
type SharedStatements =
  | GeneralServerStatements
  | UiServerStatements
  | StateStatements
  | TestStatements;
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DashboardBlock } from "./index";
import {
  parameterCompatible,
  resolveParameters,
  validateBindings,
} from "./parameters";
import { executeWidget } from "./query";

export function validateDashboardParameters<
  T extends import("std/statements").IServerBaseStatements,
>(
  s: T,
  b: DashboardBlock,
  id: Sql,
  parameters: Sql,
) {
  resolveParameters(
    s,
    b,
    parameters,
    sql`'{}'::json`,
    "configured_input",
  );
  s.throwErrorIf(
    sql`exists(select 1 from db.dashboard_widgets w join db.dashboard_sections section on section.id=w.section_id cross join json.object_each(coalesce(w.config->'bindings','{}'::json)) binding where section.dashboard_id=${id} and not exists(select 1 from json.array_each(${parameters}) p join json.array_each(w.config->'parameters') wp on wp.value->>'name'=binding.key where p.value->>'name'=binding.value #>> '{}' and ${
      parameterCompatible(sql`wp.value`, sql`p.value`)
    }))`,
    sql
      .lit`Update widget bindings before removing or changing an input’s allowed values.`,
  );
}

export function validateDashboardAudience(
  s: SharedStatements,
  b: DashboardBlock,
  audience: Sql,
) {
  const registered = sql.lit(JSON.stringify(b.capabilities.map((c) => c.name)));
  s.throwErrorIf(
    sql`coalesce(json_typeof(${audience}),'null') != 'array' or json_array_length(${audience}) > 30 or exists(select 1 from json.array_each(${audience}) a where not ${registered}::json @> json_build_array(a.value))`,
    sql.lit`Select registered audience capabilities.`,
  );
}

/** Query execution suspends, so validate before opening the mutation transaction. */
export function prepareWidget<
  T extends import("std/statements").IServerBaseStatements,
>(s: T, b: DashboardBlock, input: Sql) {
  s.defScalar(
    "prepared_widget_dashboard",
    sql`(select dashboard_id from db.dashboard_sections where id=try_cast(${input}->>'sectionId' as bigint))`,
  );
  b.require(s, "edit", sql`prepared_widget_dashboard`);
  executeWidget(s, b, {
    type: sql`${input}->>'type'`,
    query: sql`${input}->>'query'`,
    config: sql`${input}->'config'`,
    dashboardParameters:
      sql`(select parameters from db.dashboards where id=prepared_widget_dashboard)`,
  });
}

/** Caller owns the transaction; both the editor and Spark use this exact path. */
export function saveWidget<
  T extends import("std/statements").IServerBaseStatements,
>(
  s: T,
  b: DashboardBlock,
  input: Sql,
) {
  s.defRecord(
    "widget_section",
    sql`select section.id, section.dashboard_id, dashboard.parameters
    from db.dashboard_sections section join db.dashboards dashboard on dashboard.id = section.dashboard_id
    where section.id = try_cast(${input}->>'sectionId' as bigint)`,
  );
  b.require(s, "edit", sql`widget_section.dashboard_id`);
  validateBindings(
    s,
    sql`coalesce(${input}->'config','{}'::json)`,
    sql`widget_section.parameters`,
  );
  s.throwErrorIf(
    sql`length(trim(coalesce(${input}->>'title',''))) not between 1 and 160
    or coalesce(${input}->>'width','third') not in ('quarter','third','half','two_thirds','full')`,
    sql.lit`Enter a title and supported width.`,
  );
  s.if(sql`${input}->>'id' is not null`, (s) => {
    s.defScalar(
      "existing_widget_dashboard",
      sql`(select section.dashboard_id from db.dashboard_widgets widget join db.dashboard_sections section on section.id = widget.section_id where widget.id = try_cast(${input}->>'id' as bigint))`,
    );
    b.require(s, "edit", sql`existing_widget_dashboard`);
    s.throwErrorIf(
      sql`existing_widget_dashboard != widget_section.dashboard_id`,
      sql.lit`Move widgets within the same dashboard.`,
    );
    s.throwErrorIf(
      sql`${input}->>'updatedAt' is not null and not exists(select 1 from db.dashboard_widgets where id = cast(${input}->>'id' as bigint) and updated_at = try_cast(${input}->>'updatedAt' as timestamptz))`,
      sql.lit`This widget changed. Reload before saving.`,
    );
  });
  s.if(sql`${input}->>'id' is null`, (s) => {
    s.modify(
      sql`insert into db.dashboard_widgets(section_id, title, type, query, config, width, sort_order)
      values (widget_section.id, ${input}->>'title', cast(${input}->>'type' as enums.dashboard_widget_type), ${input}->>'query', coalesce(${input}->'config','{}'::json), cast(coalesce(${input}->>'width','third') as enums.dashboard_widget_width), ordering.new((select max(sort_order) from db.dashboard_widgets where section_id = widget_section.id)))`,
    );
  }).else((s) => {
    s.modify(
      sql`update db.dashboard_widgets set section_id = widget_section.id, title = ${input}->>'title', type = cast(${input}->>'type' as enums.dashboard_widget_type), query = ${input}->>'query', config = coalesce(${input}->'config','{}'::json), width = cast(coalesce(${input}->>'width','third') as enums.dashboard_widget_width), updated_at = now()
      where id = cast(${input}->>'id' as bigint)`,
    );
  });
}

export function copyDashboard<
  T extends import("std/statements").IServerBaseStatements,
>(s: T, b: DashboardBlock, id: Sql) {
  b.require(s, "view", id);
  s.throwErrorIf(
    sql`current_user is null or not coalesce((${b.opts.permissions.create}),false)`,
    sql.lit`You cannot create dashboards.`,
  );
  s.modify(
    sql`insert into db.dashboards(name,owner_id,layout,parameters) select left(name,150) || ' (copy)',current_user,layout,parameters from db.dashboards where id=${id} returning id into copied_dashboard_id`,
  );
  s.forEachQuery(
    sql`select id,name,sort_order from db.dashboard_sections where dashboard_id=${id} order by sort_order,id`,
    "copy_section",
    (s) => {
      s.modify(
        sql`insert into db.dashboard_sections(dashboard_id,name,sort_order) values(copied_dashboard_id,copy_section.name,copy_section.sort_order) returning id into copied_section_id`,
      );
      s.modify(
        sql`insert into db.dashboard_widgets(section_id,title,type,query,config,width,sort_order) select copied_section_id,title,type,query,config,width,sort_order from db.dashboard_widgets where section_id=copy_section.id order by sort_order,id`,
      );
    },
  );
}

export function dashboardCapability(b: DashboardBlock): SparkCapability {
  return {
    name: "dashboards",
    label: "Dashboards",
    description:
      "Create, test and arrange persistent dashboards with fixed widgets.",
    functions: [{
      name: "lookupRecords",
      inputType: "{source:string;search?:string}",
      description:
        "Search developer-registered record sources in your permission scope; at most 50 choices.",
      procedure: (s, context) => {
        s.setCurrentUser(context.sysUserId);
        s.throwErrorIf(
          sql`current_user is null`,
          sql.lit`Sign in to search records.`,
        );
        for (const source of b.opts.recordSources ?? []) {
          s.if(sql`function_input->>'source'=${sql.lit(source.name)}`, (s) => {
            s.throwErrorIf(
              sql`not coalesce((${source.permission}),false)`,
              sql.lit`This record source is unavailable.`,
            );
            s.return(
              sql`(select coalesce(json_agg(json_build_object('id',id,'label',label)),'[]'::json) from (select id,label from (${source.query}) choices where contains(lower(label),lower(left(coalesce(function_input->>'search',''),100))) order by label,id limit 50) bounded_choices)`,
            );
          });
        }
        s.throwError(sql.lit`Choose a registered record source.`);
      },
    }, {
      name: "list",
      inputType: "{}",
      description:
        "List dashboards you can view, whether you can edit each, and their sections/widgets.",
      procedure: (s, context) => {
        s.setCurrentUser(context.sysUserId);
        s.defTable(
          "visible_dashboards",
          sql`select d.*,${
            b.selectedAudience(sql`d.id`)
          } as audience from db.dashboards d where ${b.canView(sql`d.id`)}`,
        );
        s.return(
          sql`json_build_object('dashboards',(select coalesce(json_agg(json_build_object('id',d.id,'name',d.name,'layout',d.layout::string,'audience',d.audience,'parameters',d.parameters,'personal',d.owner_id is not null,'canEdit',${
            b.canEdit(sql`d.id`)
          })),'[]'::json) from visible_dashboards d),
          'sections',(select coalesce(json_agg(json_build_object('id',section.id,'dashboardId',section.dashboard_id,'name',section.name) order by section.sort_order,section.id),'[]'::json) from db.dashboard_sections section where section.dashboard_id in (select id from visible_dashboards)),
          'widgets',(select coalesce(json_agg(json_build_object('id',widget.id,'sectionId',widget.section_id,'title',widget.title,'type',widget.type::string,'query',widget.query,'config',widget.config,'width',widget.width::string,'updatedAt',widget.updated_at) order by widget.sort_order,widget.id),'[]'::json) from db.dashboard_widgets widget join db.dashboard_sections section on section.id=widget.section_id where section.dashboard_id in (select id from visible_dashboards)))`,
        );
      },
    }, {
      name: "testWidget",
      inputType: "DashboardWidgetTestInput",
      description:
        "Read-only compilation, permission, parameter and chart-contract test. Returns diagnostics and a bounded sample.",
      procedure: (s, context) => {
        s.setCurrentUser(context.sysUserId);
        s.try({
          body: (s) => {
            s.if(sql`function_input->>'dashboardId' is not null`, (s) => {
              b.require(
                s,
                "view",
                sql`cast(function_input->>'dashboardId' as bigint)`,
              );
            });
            executeWidget(s, b, {
              type: sql`function_input->>'type'`,
              query: sql`function_input->>'query'`,
              config: sql`function_input->'config'`,
              parameters:
                sql`coalesce(function_input->'parameters','{}'::json)`,
              dashboardParameters:
                sql`case when function_input->>'dashboardId' is not null then (select parameters from db.dashboards where id=try_cast(function_input->>'dashboardId' as bigint)) else coalesce(function_input->'dashboardParameters','[]'::json) end`,
              dashboardValues:
                sql`coalesce(function_input->'dashboardValues','{}'::json)`,
            });
            s.return(sql`widget_diagnostics`);
          },
          errorName: "widget_test_error",
          catch: (s) =>
            s.return(
              sql`json_build_object('valid',false,'error',widget_test_error.message)`,
            ),
        });
      },
    }],
    actions: [{
      name: "removeDashboard",
      mode: "reversible",
      inputType: "{dashboardId:number}",
      description:
        "Delete a dashboard and its sections/widgets. Manual measurements remain.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        b.require(
          s,
          "manage",
          sql`try_cast(action_input->>'dashboardId' as bigint)`,
        );
        s.modify(
          sql`delete from db.dashboards where id=cast(action_input->>'dashboardId' as bigint)`,
        );
      },
    }, {
      name: "removeSection",
      mode: "reversible",
      inputType: "{sectionId:number}",
      description:
        "Delete a section and its widgets. Manual measurements remain.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        b.require(
          s,
          "edit",
          sql`(select dashboard_id from db.dashboard_sections where id=try_cast(action_input->>'sectionId' as bigint))`,
        );
        s.modify(
          sql`delete from db.dashboard_sections where id=cast(action_input->>'sectionId' as bigint)`,
        );
      },
    }, {
      name: "copy",
      mode: "reversible",
      inputType: "{dashboardId:number}",
      description:
        "Make an owner-only personal copy of a visible dashboard. Does not copy audience or grant data access.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        copyDashboard(
          s,
          b,
          sql`try_cast(action_input->>'dashboardId' as bigint)`,
        );
        s.setScalar(
          "action_result",
          sql`json_build_object('dashboardId',copied_dashboard_id,'href',${
            sql.lit(b.basePath)
          } || '/' || copied_dashboard_id::string)::string`,
        );
      },
    }, {
      name: "create",
      mode: "reversible",
      inputType: "DashboardCreateInput",
      description:
        "Create a private dashboard with validated sections and widgets in one transaction.",
      preflight: (s) => {
        s.setCurrentUser(sql`action_sys_user_id`);
        resolveParameters(
          s,
          b,
          sql`coalesce(action_input->'parameters','[]'::json)`,
          sql`'{}'::json`,
          "create_input",
        );
        s.forEachQuery(
          sql`select value from json.array_each(action_input->'sections')`,
          "validate_section",
          (s) => {
            s.forEachQuery(
              sql`select value from json.array_each(coalesce(validate_section.value->'widgets','[]'::json))`,
              "validate_widget",
              (s) => {
                executeWidget(s, b, {
                  type: sql`validate_widget.value->>'type'`,
                  query: sql`validate_widget.value->>'query'`,
                  config: sql`validate_widget.value->'config'`,
                  dashboardParameters:
                    sql`coalesce(action_input->'parameters','[]'::json)`,
                });
              },
            );
          },
        );
      },
      procedure: (s) => {
        s.throwErrorIf(
          sql`current_user is null or not coalesce((${b.opts.permissions.create}),false)`,
          sql.lit`You cannot create dashboards.`,
        );
        s.throwErrorIf(
          sql`length(trim(coalesce(action_input->>'name',''))) not between 1 and 160 or coalesce(action_input->>'layout','scrolling') not in ('scrolling','tabs')
        or coalesce(json_typeof(action_input->'sections'),'null') != 'array' or json_array_length(action_input->'sections') not between 1 and 30`,
          sql.lit`Supply a dashboard name, layout and 1–30 sections.`,
        );
        s.throwErrorIf(
          sql`coalesce(try_cast(action_input->>'shared' as bool),false) and not coalesce((${b.opts.permissions.admin}),false)`,
          sql.lit`Only dashboard admins can create shared dashboards.`,
        );
        validateDashboardAudience(
          s,
          b,
          sql`coalesce(action_input->'audience','[]'::json)`,
        );
        resolveParameters(
          s,
          b,
          sql`coalesce(action_input->'parameters','[]'::json)`,
          sql`'{}'::json`,
          "create_saved_input",
        );
        s.modify(
          sql`insert into db.dashboards(name,owner_id,layout,parameters) values(action_input->>'name',case when coalesce(try_cast(action_input->>'shared' as bool),false) then null else current_user end,cast(coalesce(action_input->>'layout','scrolling') as enums.dashboard_layout),coalesce(action_input->'parameters','[]'::json)) returning id into created_dashboard_id`,
        );
        b.setAudience(
          s,
          sql`created_dashboard_id`,
          sql`case when coalesce(try_cast(action_input->>'shared' as bool),false) then coalesce(action_input->'audience','[]'::json) else '[]'::json end`,
        );
        s.forEachQuery(
          sql`select index as ordinal, value from json.array_each(action_input->'sections') order by index`,
          "new_section",
          (s) => {
            s.throwErrorIf(
              sql`length(coalesce(new_section.value->>'name','')) > 160 or json_typeof(coalesce(new_section.value->'widgets','[]'::json)) != 'array' or json_array_length(coalesce(new_section.value->'widgets','[]'::json)) > 50`,
              sql.lit`Supply a section name and at most 50 widgets.`,
            );
            s.modify(
              sql`insert into db.dashboard_sections(dashboard_id,name,sort_order) values(created_dashboard_id,nullif(trim(new_section.value->>'name'),''),ordering.n_after(new_section.ordinal)) returning id into created_section_id`,
            );
            s.forEachQuery(
              sql`select value from json.array_each(coalesce(new_section.value->'widgets','[]'::json)) order by index`,
              "new_widget",
              (s) => {
                saveWidget(
                  s,
                  b,
                  sql`new_widget.value || json_build_object('sectionId',created_section_id,'id',null)`,
                );
              },
            );
          },
        );
        s.setScalar(
          "action_result",
          sql`json_build_object('dashboardId', created_dashboard_id, 'href', ${
            sql.lit(b.basePath)
          } || '/' || created_dashboard_id::string)::string`,
        );
      },
    }, {
      name: "saveWidget",
      mode: "reversible",
      inputType: "DashboardWidgetSaveInput",
      description:
        "Add or update a validated widget. Use list to get the current ID, section and updatedAt.",
      preflight: (s) => {
        s.setCurrentUser(sql`action_sys_user_id`);
        prepareWidget(s, b, sql`action_input`);
      },
      procedure: (s) => {
        saveWidget(s, b, sql`action_input`);
        s.setScalar("action_result", sql.lit`{"saved":true}`);
      },
    }, {
      name: "removeWidget",
      mode: "reversible",
      inputType: "{ id: number }",
      description: "Remove a widget without deleting manual observations.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        b.require(
          s,
          "edit",
          sql`(select section.dashboard_id from db.dashboard_widgets widget join db.dashboard_sections section on section.id=widget.section_id where widget.id=try_cast(action_input->>'id' as bigint))`,
        );
        s.modify(
          sql`delete from db.dashboard_widgets where id=cast(action_input->>'id' as bigint)`,
        );
      },
    }, {
      name: "saveSection",
      mode: "reversible",
      inputType:
        "{dashboardId:number;id?:number;name?:string;beforeId?:number}",
      description:
        "Add, rename or move a section before another section; omit beforeId to put it last.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        s.defScalar(
          "layout_dashboard",
          sql`try_cast(action_input->>'dashboardId' as bigint)`,
        );
        b.require(s, "edit", sql`layout_dashboard`);
        s.throwErrorIf(
          sql`length(coalesce(action_input->>'name',''))>160`,
          sql.lit`Use a section name of at most 160 characters.`,
        );
        s.throwErrorIf(
          sql`action_input->>'id' is not null and not exists(select 1 from db.dashboard_sections where id=try_cast(action_input->>'id' as bigint) and dashboard_id=layout_dashboard)`,
          sql.lit`Section is unavailable.`,
        );
        s.throwErrorIf(
          sql`action_input->>'beforeId' is not null and not exists(select 1 from db.dashboard_sections where id=try_cast(action_input->>'beforeId' as bigint) and dashboard_id=layout_dashboard and id!=coalesce(try_cast(action_input->>'id' as bigint),-1))`,
          sql.lit`Choose another section in this dashboard.`,
        );
        s.defScalar(
          "layout_before",
          sql`(select sort_order from db.dashboard_sections where id=try_cast(action_input->>'beforeId' as bigint))`,
        );
        s.defScalar(
          "layout_order",
          sql`ordering.new((select max(sort_order) from db.dashboard_sections where dashboard_id=layout_dashboard and (layout_before is null or sort_order<layout_before)),layout_before)`,
        );
        s.if(
          sql`action_input->>'id' is null`,
          (s) =>
            s.modify(
              sql`insert into db.dashboard_sections(dashboard_id,name,sort_order) values(layout_dashboard,nullif(trim(action_input->>'name'),''),layout_order)`,
            ),
        ).else((s) =>
          s.modify(
            sql`update db.dashboard_sections set name=nullif(trim(action_input->>'name'),''),sort_order=layout_order where id=cast(action_input->>'id' as bigint)`,
          )
        );
      },
    }, {
      name: "moveWidget",
      mode: "reversible",
      inputType: "{id:number;sectionId:number;beforeId?:number}",
      description:
        "Move a widget within a dashboard, before another widget or to the end.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        s.defScalar(
          "move_dashboard",
          sql`(select dashboard_id from db.dashboard_sections where id=try_cast(action_input->>'sectionId' as bigint))`,
        );
        b.require(s, "edit", sql`move_dashboard`);
        s.throwErrorIf(
          sql`not exists(select 1 from db.dashboard_widgets w join db.dashboard_sections section on section.id=w.section_id where w.id=try_cast(action_input->>'id' as bigint) and section.dashboard_id=move_dashboard)`,
          sql.lit`Widget is unavailable in this dashboard.`,
        );
        s.throwErrorIf(
          sql`action_input->>'beforeId' is not null and not exists(select 1 from db.dashboard_widgets where id=try_cast(action_input->>'beforeId' as bigint) and section_id=try_cast(action_input->>'sectionId' as bigint) and id!=try_cast(action_input->>'id' as bigint))`,
          sql.lit`Choose another widget in the destination section.`,
        );
        s.defScalar(
          "move_before",
          sql`(select sort_order from db.dashboard_widgets where id=try_cast(action_input->>'beforeId' as bigint))`,
        );
        s.defScalar(
          "move_order",
          sql`ordering.new((select max(sort_order) from db.dashboard_widgets where section_id=try_cast(action_input->>'sectionId' as bigint) and (move_before is null or sort_order<move_before)),move_before)`,
        );
        s.modify(
          sql`update db.dashboard_widgets set section_id=cast(action_input->>'sectionId' as bigint),sort_order=move_order,updated_at=now() where id=cast(action_input->>'id' as bigint)`,
        );
      },
    }, {
      name: "configure",
      mode: "reversible",
      inputType:
        "{id:number;name:string;layout:'scrolling'|'tabs';audience:string[];parameters:DashboardParameter[]}",
      description:
        "Update dashboard settings, inputs and audience. Owner or dashboard admin only.",
      preflight: (s) => s.setCurrentUser(sql`action_sys_user_id`),
      procedure: (s) => {
        b.require(s, "manage", sql`try_cast(action_input->>'id' as bigint)`);
        s.throwErrorIf(
          sql`length(trim(coalesce(action_input->>'name',''))) not between 1 and 160 or coalesce(action_input->>'layout','') not in ('scrolling','tabs')`,
          sql.lit`Supply valid dashboard settings.`,
        );
        validateDashboardAudience(s, b, sql`action_input->'audience'`);
        validateDashboardParameters(
          s,
          b,
          sql`try_cast(action_input->>'id' as bigint)`,
          sql`action_input->'parameters'`,
        );
        s.modify(
          sql`update db.dashboards set name=action_input->>'name',parameters=action_input->'parameters',layout=cast(action_input->>'layout' as enums.dashboard_layout) where id=cast(action_input->>'id' as bigint)`,
        );
        b.setAudience(
          s,
          sql`try_cast(action_input->>'id' as bigint)`,
          sql`case when (select owner_id from db.dashboards where id=try_cast(action_input->>'id' as bigint)) is null then action_input->'audience' else '[]'::json end`,
        );
      },
    }],
    doc:
      `Dashboards store fixed widgets, never generated UI. Spark is the dashboard authoring interface. Dashboard links prefill an editable prompt with the saved dashboard ID and current filters. Use list to load the dashboard and check editing access. Use copy when a viewer wants a personal version. Use removeSection or removeDashboard for requested deletion. Use list, testWidget, then create or saveWidget. New dashboards are personal and owner-only. Only dashboard admins create or edit shared dashboards. Shared audience is a separate any-match list of capabilities; empty means admins only. Audience never grants data access. Saved SQL always uses all registered Spark data capabilities currently permitted to the viewer; no dashboard data selection is needed. Declare dashboard parameters and widget config.parameters separately. config.bindings maps a widget input name to a dashboard input name of the same type (and source for records). Only bound values are passed to that widget. Use current_context()->'parameters' for query values; date_range values contain start/end. Changing an input is not authorization. Defaults may be last_12_weeks (12 completed Monday–Sunday weeks, excluding the current week) for date_range or current for record sources supporting it. Optional missing values are null. Use lookupRecords for viewer-scoped choices. Registered sources: ${
        JSON.stringify(
          (b.opts.recordSources ?? []).map((source) => ({
            name: source.name,
            label: source.label,
            supportsCurrent: !!source.currentValue,
          })),
        )
      }. Never interpolate input into query text. Chart queries return x (date for line/wise, category for bar) and value (numeric/null), one row per x. Number returns one value row. Table allows arbitrary columns. Empty data is valid; more than 1,000 rows is rejected. Query only documented capability data. WISE requires Sunday week ends. Manual entry uses config.measurementId and the separate measurement permission. Return the created dashboard href so the user can open the fixed renderer. Do not generate saved UI source.
\n\`\`\`ts
interface DashboardParameter {name:string;label:string;type:'text'|'number'|'date'|'date_range'|'enum'|'record';default?:unknown;optional?:boolean;options?:string[];source?:string;}
interface DashboardWidgetConfig { format?: 'number'|'number_thousands'|'currency'|'percentage'|'duration'; unit?: string; inverse?: boolean; height?: 'small'|'medium'|'large'; missingValues?: 'gap'|'zero'; measurementId?: number; parameters?: DashboardParameter[]; bindings?:Record<string,string>; }
interface DashboardWidgetTestInput { dashboardId?:number; type:'wise'|'line'|'bar'|'number'|'table'|'manual_entry';query?:string;config?:DashboardWidgetConfig;parameters?:Record<string,unknown>;dashboardParameters?:DashboardParameter[];dashboardValues?:Record<string,unknown>; }
interface DashboardWidgetSaveInput extends DashboardWidgetTestInput { id?:number;sectionId:number;title:string;width?:'quarter'|'third'|'half'|'two_thirds'|'full';updatedAt?:string; }
interface DashboardCreateInput {name:string;shared?:boolean;audience?:string[];parameters?:DashboardParameter[];layout?:'scrolling'|'tabs';sections:{name?:string;widgets:Omit<DashboardWidgetSaveInput,"sectionId">[]}[];}
\`\`\``,
  };
}
