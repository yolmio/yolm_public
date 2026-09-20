import { sql } from "../../std/sql_utils";
import { system } from "std/system";
import type { HelperEnumValue, System } from "std/system";

export function hasDatagridTables(_system: System) {
  const db = system.db;
  if (
    !db.hasTables([
      "datagrid_view_columns",
      "datagrid_views",
      "datagrid_view_filter_terms",
    ])
  ) {
    return false;
  }
  if (system.enums.datagrid_name === undefined) {
    return false;
  }
  return true;
}

export function validateDatagridViewTables(datagridName: string) {
  if (!hasDatagridTables(system)) {
    throw new Error("Datagrid View tables not found");
  }
  if (system.enums.datagrid_name.valuesMap.has(datagridName)) {
    return;
  }
  throw new Error(
    `Datagrid name '${datagridName}' not found in datagrid_name enum`,
  );
}

export function initializeDatagridTables() {
  if (hasDatagridTables(system)) {
    return;
  }
  datagridViewTablesAndEnums([]);
  if (system.previousMapping) {
    if (system.previousMapping.enums.datagrid_name) {
      for (
        const value of Object.keys(
          system.previousMapping.enums.datagrid_name.values,
        )
      ) {
        if (system.db.tables[value]) {
          system.addVariantToEnum("datagrid_name", value);
          continue;
        }
        const renamedTable = Object.values(system.db.tables).find(
          (t) => t.renameFrom === value,
        );
        if (renamedTable) {
          system.addVariantToEnum("datagrid_name", {
            name: renamedTable.name,
            renameFrom: value,
          });
        } else {
          system.addVariantToEnum("datagrid_name", value);
        }
      }
    }
  }
}

export function addDatagridNameEnumValue(value: string | HelperEnumValue) {
  if (
    system.enums.datagrid_name.valuesMap.has(
      typeof value === "string" ? value : value.name,
    )
  ) {
    return;
  }
  system.addVariantToEnum("datagrid_name", value);
}

function datagridViewTablesAndEnums(
  datagridNames: (string | HelperEnumValue)[],
) {
  system.enum_({
    name: "datagrid_name",
    values: datagridNames,
  });
  system.db.table("datagrid_views", (t) => {
    t.sampleData({
      skipSampleData: true,
    });
    t.string("name", 200).notNull();
    t.enum("datagrid_name").notNull();
    t.fk("sys_user_id", "sys_users");
    t.bool("root_filter_is_any").notNull();
    t.smallUint("row_height").notNull();
    t.ordering("ordering").notNull();
    t.unique([
      "name",
      { field: "sys_user_id", distinctNulls: false },
      "datagrid_name",
    ]);
    t.skipAutoApi();
  });
  system.db.table("datagrid_view_columns", (t) => {
    t.sampleData({
      skipSampleData: true,
    });
    t.fk("view_id", "datagrid_views").notNull();
    t.string("name", 200).notNull();
    t.bool("displaying").notNull();
    t.ordering("ordering").notNull();
    t.tinyUint("sort_index");
    t.bool("sort_asc");
    t.bool("pin_left");
    t.bool("pin_right");
    t.smallInt("width");
    t.skipAutoApi();
  });
  system.db.table("datagrid_view_filter_terms", (t) => {
    t.sampleData({
      skipSampleData: true,
    });
    t.fk("view_id", "datagrid_views").notNull();
    t.fk("group_id", "datagrid_view_filter_terms");
    t.ordering("ordering").notNull();
    t.bool("is_any");
    t.string("column_name", 200);
    t.enum("op", "dg_filter_op");
    t.string("value_1", 2000);
    t.string("value_2", 2000);
    t.string("value_3", 2000);
    t.skipAutoApi();
  });
  dgFilterOpAndFns();
}

function dgFilterOpAndFns() {
  if (system.enums.dg_filter_op) {
    return;
  }
  system.enum_({
    name: "dg_filter_op",
    values: [
      "empty",
      "not_empty",
      "num_eq",
      "num_ne",
      "num_lt",
      "num_lte",
      "num_gt",
      "num_gte",
      "str_eq",
      "str_ne",
      "str_contains",
      "str_not_contains",
      "str_matches",
      "str_not_matches",
      "date_eq",
      "date_ne",
      "date_lt",
      "date_lte",
      "date_gt",
      "date_gte",
      "timestamp_eq",
      "timestamp_ne",
      "timestamp_lt",
      "timestamp_lte",
      "timestamp_gt",
      "timestamp_gte",
      "enum_eq",
      "enum_ne",
      "fk_eq",
      "fk_ne",
      "bool_eq",
      "bool_ne",
      "enum_like_bool_eq",
      "minute_duration_eq",
      "minute_duration_ne",
      "minute_duration_lt",
      "minute_duration_lte",
      "minute_duration_gt",
      "minute_duration_gte",
      "custom",
    ],
    withBoolRulesFn: [
      {
        name: "is_string_filter_op",
        trues: [
          "str_eq",
          "str_ne",
          "str_contains",
          "str_not_contains",
          "str_matches",
          "str_not_matches",
        ],
      },
      {
        name: "is_number_filter_op",
        trues: ["num_eq", "num_ne", "num_lt", "num_lte", "num_gt", "num_gte"],
      },
      {
        name: "is_date_filter_op",
        trues: [
          "date_eq",
          "date_ne",
          "date_lt",
          "date_lte",
          "date_gt",
          "date_gte",
        ],
      },
      {
        name: "is_timestamp_filter_op",
        trues: [
          "timestamp_eq",
          "timestamp_ne",
          "timestamp_lt",
          "timestamp_lte",
          "timestamp_gt",
          "timestamp_gte",
        ],
      },
      {
        name: "is_enum_filter_op",
        trues: ["enum_eq", "enum_ne"],
      },
      {
        name: "is_fk_filter_op",
        trues: ["fk_eq", "fk_ne"],
      },
      {
        name: "is_minute_duration_filter_op",
        trues: [
          "minute_duration_eq",
          "minute_duration_ne",
          "minute_duration_lt",
          "minute_duration_lte",
          "minute_duration_gt",
          "minute_duration_gte",
        ],
      },
    ],
  });
  system.rulesFunction({
    name: "encode_date_dg_filter_param",
    parameters: [
      {
        name: "value_1",
        type: { type: "String", maxLength: 10_000 },
        notNull: false,
      },
      {
        name: "value_2",
        type: { type: "String", maxLength: 10_000 },
        notNull: false,
      },
    ],
    rules: [
      [sql`input.value_1`, sql`input.value_2`, sql`output`],
      [sql.lit`today`, sql.anyColumnValue, sql`literal.date(today())`],
      [sql.lit`tomorrow`, sql.anyColumnValue, sql`literal.date(tomorrow())`],
      [sql.lit`yesterday`, sql.anyColumnValue, sql`literal.date(yesterday())`],
      [
        sql.lit`week ago`,
        sql.anyColumnValue,
        sql`literal.date(date.add(week, -1, today()))`,
      ],
      [
        sql.lit`week from now`,
        sql.anyColumnValue,
        sql`literal.date(date.add(week, 1, today()))`,
      ],
      [
        sql.lit`month ago`,
        sql.anyColumnValue,
        sql`literal.date(date.add(month, -1, today()))`,
      ],
      [
        sql.lit`month from now`,
        sql.anyColumnValue,
        sql`literal.date(date.add(month, 1, today()))`,
      ],
      [
        sql.lit`number of days ago`,
        sql.columnExists,
        sql`literal.date(date.add(day, -try_cast(input.value_2 as int), today()))`,
      ],
      [
        sql.lit`number of days from now`,
        sql.columnExists,
        sql`literal.date(date.add(day, try_cast(input.value_2 as int), today()))`,
      ],
      [sql.lit`exact date`, sql.columnExists, sql`literal.date(input.value_2)`],
    ],
    returnType: "String",
  });
  system.rulesFunction({
    name: "encode_dg_filter_op",
    parameters: [
      {
        name: "op",
        type: { type: "Enum", enum: "dg_filter_op" },
        notNull: true,
      },
      {
        name: "expr",
        type: { type: "String", maxLength: 10_000 },
        notNull: true,
      },
      {
        name: "value_1",
        type: { type: "String", maxLength: 10_000 },
        notNull: false,
      },
      {
        name: "value_2",
        type: { type: "String", maxLength: 10_000 },
        notNull: false,
      },
      {
        name: "value_3",
        type: { type: "String", maxLength: 10_000 },
        notNull: false,
      },
      {
        name: "is_string",
        type: "Bool",
        notNull: true,
      },
    ],
    rules: [
      [sql`input.op`, sql`output`],
      [
        sql`input.op = 'empty' and input.is_string`,
        sql`'(' || input.expr || ' is null or ' || input.expr || ' = '''')'`,
      ],
      [
        sql`input.op = 'not_empty' and input.is_string`,
        sql`'(' || input.expr || ' is not null and ' || input.expr || ' != '''')'`,
      ],
      [
        sql.lit`empty`,
        sql`'(' || input.expr || ' is null)'`,
      ],
      [
        sql.lit`not_empty`,
        sql`'(' || input.expr || ' is not null)'`,
      ],
      // string. Note: `literal.string(null)` returns the SQL text 'null'
      // (not a SQL null), so the surrounding coalesce-to-'true' pattern
      // doesn't catch unset value_1 — explicit guard required.
      [
        sql.lit`str_eq`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '=' || literal.string(input.value_1) end`,
      ],
      [
        sql.lit`str_ne`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '!=' || literal.string(input.value_1) end`,
      ],
      [
        sql.lit`str_contains`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else concat('contains(', input.expr, ',', literal.string(input.value_1), ')') end`,
      ],
      [
        sql.lit`str_not_contains`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else concat('not contains(', input.expr, ',', literal.string(input.value_1), ')') end`,
      ],
      [
        sql.lit`str_matches`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else concat('regex.is_match(', input.expr, ',', literal.string(input.value_1), ')') end`,
      ],
      [
        sql.lit`str_not_matches`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else concat('not regex.is_match(', input.expr, ',', literal.string(input.value_1), ')') end`,
      ],
      // number — same `literal.number(null) = 'null'` pitfall as strings.
      [
        sql`input.op = 'num_eq' or input.op = 'minute_duration_eq'`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '=' || literal.number(input.value_1) end`,
      ],
      [
        sql`input.op = 'num_ne' or input.op = 'minute_duration_ne'`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '!=' || literal.number(input.value_1) end`,
      ],
      [
        sql`input.op = 'num_lt' or input.op = 'minute_duration_lt'`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '<' || literal.number(input.value_1) end`,
      ],
      [
        sql`input.op = 'num_lte' or input.op = 'minute_duration_lte'`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '<=' || literal.number(input.value_1) end`,
      ],
      [
        sql`input.op = 'num_gt' or input.op = 'minute_duration_gt'`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '>' || literal.number(input.value_1) end`,
      ],
      [
        sql`input.op = 'num_gte' or input.op = 'minute_duration_gte'`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '>=' || literal.number(input.value_1) end`,
      ],
      // date
      [
        sql.lit`date_eq`,
        sql`coalesce(input.expr || '=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`date_ne`,
        sql`coalesce(input.expr || '!=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`date_lt`,
        sql`coalesce(input.expr || '<' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`date_lte`,
        sql`coalesce(input.expr || '<=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`date_gt`,
        sql`coalesce(input.expr || '>' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`date_gte`,
        sql`coalesce(input.expr || '>=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      // timestamp
      [
        sql.lit`timestamp_eq`,
        sql`coalesce('cast(' || input.expr || ' as date) =' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`timestamp_ne`,
        sql`coalesce('cast(' || input.expr || ' as date) !=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`timestamp_lt`,
        sql`coalesce('cast(' || input.expr || ' as date) <' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`timestamp_lte`,
        sql`coalesce('cast(' || input.expr || ' as date) <=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`timestamp_gt`,
        sql`coalesce('cast(' || input.expr || ' as date) >' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      [
        sql.lit`timestamp_gte`,
        sql`coalesce('cast(' || input.expr || ' as date) >=' || fn.encode_date_dg_filter_param(input.value_1, input.value_2), 'true')`,
      ],
      // enum
      [
        sql.lit`enum_eq`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '=' || literal.string(input.value_1) end`,
      ],
      [
        sql.lit`enum_ne`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '!=' || literal.string(input.value_1) end`,
      ],
      // foreign keys
      [
        sql.lit`fk_eq`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '=' || literal.number(input.value_1) end`,
      ],
      [
        sql.lit`fk_ne`,
        sql`case when coalesce(input.value_1, '') = '' then 'true'
            else input.expr || '!=' || literal.number(input.value_1) end`,
      ],
      // bool
      [
        sql.lit`bool_eq`,
        sql`case
          when input.value_1 = 'true' then input.expr || '=true'
          else '(' || input.expr || ' is null or ' || input.expr || '=false)'
        end`,
      ],
      [
        sql.lit`bool_ne`,
        sql`case
          when input.value_1 = 'true' then '(' || input.expr || ' is null or ' || input.expr || '=false)'
          else input.expr || '=true'
        end`,
      ],
      [
        sql.lit`enum_like_bool_eq`,
        sql`case
          when coalesce(input.value_1, '') = '' then 'true'
          when input.value_1 = 'true' then input.expr || '=true'
          when input.value_1 = 'false' then input.expr || '=false'
          else input.expr || ' is null'
        end`,
      ],
      [sql.anyColumnValue, sql.lit`true`],
    ],
    returnType: "String",
  });
  system.rulesFunction({
    name: "positive_dg_relation_string_filter_op",
    parameters: [{
      name: "op",
      type: { type: "Enum", enum: "dg_filter_op" },
      notNull: true,
    }],
    rules: [
      [sql`input.op`, sql`output`],
      [sql.lit`str_ne`, sql.lit`str_eq`],
      [sql.lit`str_not_contains`, sql.lit`str_contains`],
      [sql.lit`str_not_matches`, sql.lit`str_matches`],
      [sql.lit`empty`, sql.lit`not_empty`],
      [sql.anyColumnValue, sql`input.op`],
    ],
    returnType: { type: "Enum", enum: "dg_filter_op" },
  });
  system.rulesFunction({
    name: "encode_dg_relation_string_filter",
    parameters: [
      {
        name: "op",
        type: { type: "Enum", enum: "dg_filter_op" },
        notNull: true,
      },
      {
        name: "from_expr",
        type: { type: "String", maxLength: 10_000 },
        notNull: true,
      },
      {
        name: "value_expr",
        type: { type: "String", maxLength: 10_000 },
        notNull: true,
      },
      {
        name: "where_expr",
        type: { type: "String", maxLength: 10_000 },
        notNull: true,
      },
      {
        name: "value_1",
        type: { type: "String", maxLength: 10_000 },
        notNull: false,
      },
    ],
    rules: [
      [sql`input.op`, sql`output`],
      [
        sql.anyColumnValue,
        sql`case
          when input.op in (
            'str_eq',
            'str_ne',
            'str_contains',
            'str_not_contains',
            'str_matches',
            'str_not_matches'
          ) and coalesce(input.value_1, '') = '' then 'true'
          else
            case when input.op in (
              'str_ne',
              'str_not_contains',
              'str_not_matches',
              'empty'
            ) then 'not ' else '' end ||
            'exists (select 1 from ' || input.from_expr ||
            ' where (' || input.where_expr || ') and (' ||
            fn.encode_dg_filter_op(
              op => fn.positive_dg_relation_string_filter_op(input.op),
              expr => input.value_expr,
              value_1 => input.value_1,
              value_2 => null,
              value_3 => null,
              is_string => true
            ) || '))'
          end`,
      ],
    ],
    returnType: "String",
  });
}
