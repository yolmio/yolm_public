import { Card } from "components/card";
import { DownloadButton } from "components/download_button";
import { Select } from "components/select";
import { Table as TableComponent } from "components/table";
import { Graph } from "std/graph";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { IStatementsBase } from "std/statements";
import type { Style } from "std/style_types";
import { cssVar } from "std/style_utils";
import { system } from "std/system";
import { Data } from "std/data";
import { Each, Match, Show, Switch } from "std/ui";
import type { Node } from "std/ui";
import { Alert } from "./alert";
import { CircularProgress } from "./circular_progress";
import { Divider } from "./divider";
import { FormControl } from "./form_control";
import { FormLabel } from "./form_label";
import { InlineFieldDisplay } from "./inline_field_display";

system.enum_({
  name: "pivot_table_join_type",
  values: ["Inner", "Left"],
});

export interface TableRelationship {
  from: string;
  to: string;
  key: string;
  joinType?: "Inner" | "Left";
}

export interface FieldInfo {
  /** Friendly name of the field */
  name: string;
  /** Name of the field in the database. Empty if expression is used */
  fieldName?: string;
  tables: string[];
  /**
         Only used for virtual fields. If used, fieldName is ignored.
         */
  expression?: string;
  involvedFields?: string[];
}

interface GenerateTableRelationshipsConfig {
  from: string;
  to: string;
  key: string;
}

export function generateTableRelationships(
  config: { excludeTables?: string[]; includeOnly?: string[] } = {},
): GenerateTableRelationshipsConfig[] {
  const relationships: TableRelationship[] = [];
  const { db } = system;

  function shouldIncludeTable(tableName: string): boolean {
    if (config.excludeTables?.includes(tableName)) {
      return false;
    }
    if (config.includeOnly) {
      return config.includeOnly.includes(tableName);
    }
    return true;
  }

  // Iterate through all tables
  for (const [tableName, table] of Object.entries(db.tables)) {
    if (!shouldIncludeTable(tableName)) {
      continue;
    }

    // Check each field for foreign key relationships
    for (const [fieldName, field] of Object.entries(table.fields)) {
      if (field.type === "ForeignKey") {
        const targetTable = field.table;
        if (!shouldIncludeTable(targetTable)) {
          continue;
        }

        relationships.push({
          from: tableName,
          to: targetTable,
          key: fieldName,
        });
      }
    }
  }

  // Sort relationships to ensure consistent order
  // This maintains the same behavior as createSortedTableRelationships
  return relationships.sort((a, b) => {
    if (a.from === b.from) {
      if (a.to === b.to) {
        return a.key.localeCompare(b.key);
      }
      return a.to.localeCompare(b.to);
    }
    return a.from.localeCompare(b.from);
  });
}

export function createSortedTableRelationships(
  tableRelationshipsUnsorted: TableRelationship[],
): TableRelationship[] {
  const graph = new Graph();

  // Add edges directly - the Graph class automatically handles nodes
  for (const relationship of tableRelationshipsUnsorted) {
    graph.addEdge(relationship.from, relationship.to);
  }

  // Get sorted tables
  const sortedTables = graph.topologicalSort();
  if (!sortedTables) {
    throw new Error("Circular dependency detected in table relationships");
  }

  // Create sorted relationships based on the topological order
  const tableRelationships: TableRelationship[] = [];
  for (const from of sortedTables) {
    const relationships = tableRelationshipsUnsorted.filter(
      (r) => r.from === from,
    );
    tableRelationships.push(...relationships);
  }

  return tableRelationships;
}

function createFieldTable<T extends IStatementsBase>(
  s: T,
  tableName: string,
  fields: Map<string, FieldInfo>,
  involvedFieldsTableName?: string,
) {
  s.defTable(tableName, {
    fields: [
      { name: "name", type: "String" },
      { name: "column_name", type: "String" },
      { name: "expression", type: "String" },
    ],
  });
  if (involvedFieldsTableName) {
    s.defTable(involvedFieldsTableName, {
      fields: [
        { name: "involved_field_name", type: "String" },
        { name: "field_name", type: "String" },
      ],
    });
  }
  s.defTable(`${tableName}_tables`, {
    fields: [
      { name: "field_name", type: "String", notNull: true },
      { name: "table_name", type: "String", notNull: true },
    ],
  });
  for (const [name, fieldInfo] of fields.entries()) {
    const columnName = fieldInfo.fieldName
      ? sql.lit`${fieldInfo.fieldName}`
      : sql`null`;
    const expression = fieldInfo.expression
      ? sql.lit`${fieldInfo.expression}`
      : sql`null`;
    s.modify(
      sql`insert into ${
        sql.ref(tableName)
      } (name, column_name, expression) values (${sql
        .lit`${name}`}, ${columnName}, ${expression})`,
    );
    for (const table of fieldInfo.tables) {
      const tableIdentifier = sql.ref(`${tableName}_tables`);
      s.modify(
        sql`insert into ${tableIdentifier} values (${sql.lit`${name}`}, ${sql
          .lit`${table}`})`,
      );
    }
    for (const involvedField of fieldInfo.involvedFields ?? []) {
      if (involvedFieldsTableName) {
        s.modify(
          sql`insert into ${sql.ref(involvedFieldsTableName)} values (${sql
            .lit`${involvedField}`}, ${sql.lit`${name}`})`,
        );
      }
    }
  }
}

function createRelationshipTable<T extends IStatementsBase>(
  s: T,
  relationships: TableRelationship[],
) {
  s.defTable("pivot_relationships", {
    fields: [
      { name: "source_table", type: "String", notNull: true },
      { name: "target_table", type: "String", notNull: true },
      { name: "key", type: "String", notNull: true },
      { name: "join_type", type: "String", notNull: true },
      { name: "relationship_order", type: "Int", notNull: true },
    ],
  });
  let count = 0;
  for (const relationship of relationships) {
    count++;
    const joinType = relationship.joinType === undefined
      ? sql.lit`Inner`
      : sql.lit`${relationship.joinType}`;
    const order = sql`${count}`;
    s.modify(
      sql`insert into pivot_relationships values (${sql
        .lit`${relationship.from}`}, ${sql
        .lit`${relationship.to}`}, ${sql
        .lit`${relationship.key}`}, ${joinType}, ${order})`,
    );
  }
}

/*
  Fill in missing tables by iteratively building paths. Example: If the user selected an order_detail table field, and a category table field,
  then this function will add the product table to the query. order_detail -> product -> category.
 */
export function fillInMissingTables<T extends IStatementsBase>(s: T) {
  // Create a table to store all tables, initialize with used tables
  s.defTable("all_tables", sql`select distinct table_name from used_tables`);

  s.block((s) => {
    s.defTable("added_tables", {
      fields: [{ name: "table_name", type: "String" }],
    });
    s.defTable("path", {
      fields: [
        { name: "source", type: "String" },
        { name: "target", type: "String" },
        { name: "path", type: { type: "String", maxLength: 65535 } },
        { name: "depth", type: "Int" },
      ],
    });
    s.defScalar("added", true);
    s.while(sql`added`, (s) => {
      s.setScalar("added", false);
      s.modify(sql`delete from added_tables`);
      s.modify(sql`delete from path`);

      // Initialize path with direct relationships
      s.modify(sql`
        insert into path (source, target, path, depth)
        select
          r.source_table,
          r.target_table,
          r.source_table || ',' || r.target_table,
          1
        from pivot_relationships r
        join all_tables a on r.source_table = a.table_name
      `);

      // Iteratively build paths
      s.defScalar("max_depth", 1);
      s.while(sql`max_depth < 15`, (s) => {
        // Limit to depth 10 to prevent infinite loops
        s.modify(sql`
          insert into path (source, target, path, depth)
          select distinct
            p.source,
            r.target_table,
            p.path || ',' || r.target_table,
            p.depth + 1
          from path p
          join pivot_relationships r on p.target = r.source_table
          where p.depth = max_depth
            and position(',' || r.target_table || ',' in ',' || p.path || ',') = 0
        `);
        s.setScalar("max_depth", sql`max_depth + 1`);
        s.breakIf(sql`(select count(*) from path where depth = max_depth) = 0`);
      });

      // Add missing intermediate tables
      // Calculate the maximum number of comma-separated parts in any path
      s.defScalar(
        "max_parts",
        sql`(
          select coalesce(max(length(p.path) - length(replace(p.path, ',', '')) + 1), 0)
          from path as p
          where p.source in (select table_name from all_tables)
            and p.target in (select table_name from all_tables)
            and p.depth > 1
        )`,
      );

      // Extract each table from the path by iterating through positions
      s.defScalar("position", 1);
      s.while(sql`position <= max_parts`, (s) => {
        s.modify(sql`
          insert into added_tables (table_name)
          select distinct split_part(p.path, ',', position) as table_name
          from path as p
          where p.source in (select table_name from all_tables)
            and p.target in (select table_name from all_tables)
            and p.depth > 1
            and split_part(p.path, ',', position) != ''
            and split_part(p.path, ',', position) not in (select table_name from all_tables)
        `);
        s.setScalar("position", sql`position + 1`);
      });
      // Add the new tables to all_tables

      s.modify(sql`
        insert into all_tables (table_name)
        select table_name from added_tables
      `);

      // Check if any tables were added
      s.setScalar("added", sql`(select count(*) from added_tables) > 0`);
    });
  });
}

// Convert builder output to field info
export function convertBuilderConfigToFieldInfo<T extends IStatementsBase>(
  s: T,
  config: ReturnType<typeof PivotTableBuilder.prototype.getConfig>,
): {
  rowColumnFields: Map<string, FieldInfo>;
  valueFields: Map<string, FieldInfo>;
} {
  const rowColumnFields = new Map<string, FieldInfo>();
  const valueFields = new Map<string, FieldInfo>();

  // Process regular fields
  for (const option of [...config.rowOptions, ...config.columnOptions]) {
    if (!option.value.includes(".")) {
      continue; // Skip virtual fields
    }
    const [tableName, fieldName] = option.value.split(".");
    rowColumnFields.set(option.value, {
      name: option.value,
      fieldName,
      tables: [tableName],
    });
  }

  for (const option of config.valueOptions) {
    if (!option.value.includes(".")) {
      continue; // Skip virtual fields
    }
    const [tableName, fieldName] = option.value.split(".");
    valueFields.set(option.value, {
      name: option.value,
      fieldName,
      tables: [tableName],
    });
  }

  // Process virtual fields
  for (const field of config.virtualFields) {
    s.validateQueryExpr(
      sql.concatTemplate`select ${field.expression} from ${
        field.tables.join(", ")
      }`,
      `virtual field ${field.name}`,
    );
    const fieldInfo: FieldInfo = {
      name: field.name,
      tables: field.tables,
      expression: field.expression,
      involvedFields: field.involvedFields,
    };

    // Add to appropriate collection based on where it's used
    if (
      [...config.rowOptions, ...config.columnOptions].some(
        (o) => o.value === field.name,
      )
    ) {
      rowColumnFields.set(field.name, fieldInfo);
    }
    if (config.valueOptions.some((o) => o.value === field.name)) {
      valueFields.set(field.name, fieldInfo);
    }
  }

  return { rowColumnFields, valueFields };
}

/**
 Generate the SQL query for the pivot table.

 @param s - The statements object
 @param selectedRowField - The selected row field to pivot by (runtime provided)
 @param selectedColumnField - The selected column field to pivot by (runtime provided)
 @param selectedValueField - The selected value field to aggregate (runtime provided)
 @param selectedAggregateFunction - The aggregate function to use for the value field (runtime provided)
 @param builderConfig - The builder configuration
 @param tableRelationships - The table relationships that were defined by the developer

 @category Pivot Table Component
 */
export function generatePivotTableQuery<T extends IStatementsBase>(
  s: T,
  selectedRowField: Sql,
  selectedColumnField: Sql,
  selectedValueField: Sql,
  selectedAggregateFunction: Sql,
  builderConfig: ReturnType<typeof PivotTableBuilder.prototype.getConfig>,
  tableRelationships: TableRelationship[],
) {
  const { rowColumnFields, valueFields } = convertBuilderConfigToFieldInfo(
    s,
    builderConfig,
  );

  s.defScalar("generated_query", sql.lit`select `);
  s.defScalar(
    "invalid",
    sql`selected_value is null and (selected_row is not null or selected_column is not null)`,
  );
  s.returnIf(
    sql`invalid`,
    sql.lit`Please select a row and/or column, and a value to pivot by.`,
  );

  s.block((s) => {
    // Create tables to store field and relationship info
    createFieldTable(s, "value_fields", valueFields);
    createFieldTable(
      s,
      "row_column_fields",
      rowColumnFields,
      "involved_fields",
    );

    createRelationshipTable(s, tableRelationships);

    // Get field information with fully qualified names
    s.defRecord(
      "row_field",
      sql`select * from row_column_fields where name = ${selectedRowField}`,
    );
    s.defRecord(
      "column_field",
      sql`select * from row_column_fields where name = ${selectedColumnField}`,
    );
    s.defRecord(
      "value_field",
      sql`select * from value_fields where name = ${selectedValueField}`,
    );

    // Prepare select fields with fully qualified names
    s.defScalar(
      "row_select",
      sql`case
        when row_field.expression is not null then row_field.expression
        else row_field.name
      end`,
    );
    s.defScalar(
      "column_select",
      sql`case
        when column_field.expression is not null then column_field.expression
        else column_field.name
      end`,
    );
    s.defScalar(
      "value_select",
      sql`case
        when value_field.expression is not null then
          concat(${selectedAggregateFunction}, '(', value_field.expression, ')')
        else
          concat(${selectedAggregateFunction}, '(', value_field.name, ')')
      end`,
    );

    // Get tables used in the selected fields
    s.defTable(
      "used_tables",
      sql`
      select distinct table_name from
        (select distinct table_name from row_column_fields_tables where field_name in (${selectedRowField}, ${selectedColumnField})
        union
        select distinct table_name from value_fields_tables where field_name in (${selectedValueField})
      ) as used_tables
      `,
    );

    // Fill in missing intermediate tables needed for joins
    fillInMissingTables(s);

    // Find root table by analyzing the relationships
    s.defScalar(
      "root_table",
      sql`(
        SELECT pr.source_table
        FROM pivot_relationships pr
        JOIN used_tables ut ON
          ut.table_name = pr.source_table OR
          ut.table_name = pr.target_table
        LIMIT 1
      )`,
    );

    // Initialize from clause with root table
    s.defScalar("from_clause", sql`root_table`);

    // Get relationships filtered and ordered properly
    s.defTable(
      "filtered_relationships",
      sql`
      -- Get required relationships between used tables
      SELECT DISTINCT
        pr.source_table,
        pr.target_table,
        pr.join_type,
        pr.relationship_order as "order"
      FROM pivot_relationships pr
      JOIN all_tables ut ON

        ut.table_name = pr.target_table
      WHERE NOT EXISTS (  -- Add this subquery to prevent duplicate joins
        SELECT 1
        FROM pivot_relationships pr2
        WHERE pr2.relationship_order < pr.relationship_order
        AND pr2.target_table = pr.target_table
      )
      ORDER BY "order"
      `,
    );

    // Build joins using filtered relationships
    s.forEachTable("filtered_relationships", "next_join", (s) => {
      s.setScalar(
        "from_clause",
        sql`from_clause || ' ' ||
          case
            when next_join.join_type = 'Left' then ' LEFT JOIN '
            else ' auto join '
          end ||
          next_join.target_table`,
      );
    });

    // Generate the final query with fully qualified column names
    s.setScalar(
      "generated_query",
      sql.concat(
        "SELECT ",
        sql`row_select`,
        " AS pivot_row, ",
        sql`column_select`,
        " AS pivot_column, ",
        sql`value_select`,
        " AS pivot_value FROM ",
        sql`from_clause`,
        " GROUP BY ",
        sql`case
          when row_field.expression is not null then (
            select string_agg(involved_field_name, ', ')
            from involved_fields
            where field_name = ${sql`row_field.name`}
          )
          else ${sql`row_select`}
        end`,
        sql`case when ${sql`column_select`} is not null then
          ', ' || case
            when column_field.expression is not null then (
              select string_agg(involved_field_name, ', ')
              from involved_fields
              where field_name = ${sql`column_field.name`}
            )
            else ${sql`column_select`}
          end
        end`,
        " ORDER BY ",
        sql`row_select`,
        sql`case when ${sql`column_select`} is not null then
          ', ' || ${sql`column_select`}
        end`,
      ),
    );
  });
}

const baseCell = {
  padding: 2,
  whiteSpace: "nowrap",
  width: "auto",
  maxWidth: "none",
  overflow: "visible",
  textOverflow: "clip",
};

const styles = {
  queryResultsTableHeader: {
    ...baseCell,
    backgroundColor: "primary-50",
    color: "text-primary",
    position: "sticky",
    top: 0,
    zIndex: 2,
  },
  tableCell: {
    ...baseCell,
  },
  tableRow: {
    "&:hover": {
      backgroundColor: "primary-50",
      dark: { backgroundColor: "primary-800" },
    },
    "& td:first-of-type": {
      position: "sticky",
      left: 0,
      backgroundColor: "background-surface",
      zIndex: 3,
      borderRight: "1px solid",
      borderColor: "divider",
    },
    "& td:last-of-type": {
      position: "sticky",
      right: 0,
      backgroundColor: "background-surface",
      zIndex: 3,
      borderLeft: "1px solid",
      borderColor: "divider",
    },
  },
  tableWrapper: {
    position: "relative",
    height: "100%",
    width: "100%",
    overflow: "auto",
  },
  stickyCorner: {
    position: "sticky",
    top: 0,
    left: 0,
    backgroundColor: "primary-50",
    zIndex: 3,
  },
  stickyTotal: {
    position: "sticky",
    bottom: 0,
    backgroundColor: "background-surface",
    zIndex: 1,
    borderTop: "1px solid",
    borderColor: "divider",
  },
  stickyTotalCorner: {
    position: "sticky",
    bottom: 0,
    left: 0,
    backgroundColor: "background-surface",
    zIndex: 2,
    borderTop: "1px solid",
    borderColor: "divider",
  },
  stickyTotalRight: {
    position: "sticky",
    bottom: 0,
    right: 0,
    backgroundColor: "background-surface",
    zIndex: 2,
    borderTop: "1px solid",
    borderColor: "divider",
  },
};

export class PivotTableBuilder {
  #rowFields: Array<{
    value: string;
    label: string;
    formatHeader?: (props: { value: Sql }) => Node;
  }> = [];
  #columnFields: Array<{
    value: string;
    label: string;
    formatHeader?: (props: { value: Sql }) => Node;
  }> = [];
  #valueFields: Array<{
    value: string;
    label: string;
  }> = [];
  #virtualFields: Array<{
    name: string;
    involvedFields: string[];
    expression: string;
    tables: string[];
  }> = [];

  // Helper function to convert camelCase/snake_case to Title Case
  #inferLabel(name: string): string {
    // Handle snake_case and camelCase
    const words = name.split(/[_\s]|(?=[A-Z])/);
    return words
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  /**
         Add a simple field that can be used as row or column
         @param tableName - The name of the table that contains the field
         @param fieldName - The name of the field to add
         @param label - The label to display for the field
         */
  field({
    tableName,
    fieldName,
    label,
    formatHeader,
  }: {
    tableName: string;
    fieldName: string;
    label?: string;
    formatHeader?: (props: { value: Sql }) => Node;
  }) {
    const table = system.db.tables[tableName];
    if (!table) {
      throw new Error(`Table ${tableName} not found`);
    }
    const field = table.fields[fieldName];
    if (!field) {
      throw new Error(`Field ${fieldName} not found in table ${tableName}`);
    }
    const value = `${tableName}.${fieldName}`;
    const fieldOption = {
      value,
      label: label ?? field.displayName,
      formatHeader: formatHeader ??
        ((props) => {
          const value = field.castToType(props.value);
          return <InlineFieldDisplay field={field} value={value} />;
        }),
    };
    this.#rowFields.push(fieldOption);
    this.#columnFields.push(fieldOption);
  }

  /**
         Add a virtual field that can be used as row or column
         @param name - The name of the virtual field
         @param expression - The expression to use for the virtual field
         @param involvedFields - The fields that are involved in the virtual field
         @param tables - The tables that are involved in the virtual field
         @param label - The label to display for the virtual field
         */
  virtualField({
    name,
    expression,
    involvedFields,
    tables,
    label,
  }: {
    name: string;
    expression: string;
    involvedFields: string[];
    tables: string[];
    label?: string;
  }) {
    this.#virtualFields.push({
      name,
      expression,
      involvedFields,
      tables,
    });
    const fieldOption = {
      value: name,
      label: label ?? this.#inferLabel(name),
    };
    this.#rowFields.push(fieldOption);
    this.#columnFields.push(fieldOption);
  }

  /**
         Add a value field that can be aggregated
         @param tableName - The name of the table that contains the field
         @param fieldName - The name of the field to add
         @param label - The label to display for the field
         */
  valueField({
    tableName,
    fieldName,
    label,
  }: {
    tableName: string;
    fieldName: string;
    label?: string;
  }) {
    this.#valueFields.push({
      value: `${tableName}.${fieldName}`,
      label: label ?? this.#inferLabel(fieldName),
    });
  }

  /**
         Add a calculated value field or a virtual field that can be used as a value field
         @param name - The name of the calculated value field
         @param expression - The expression to use for the calculated value field
         @param involvedFields - The fields that are involved in the calculated value field
         @param tables - The tables that are involved in the calculated value field
         @param label - The label to display for the calculated value field
         */
  calculatedValueField({
    name,
    expression,
    involvedFields,
    tables,
    label,
  }: {
    name: string;
    expression: string;
    involvedFields: string[];
    tables: string[];
    label?: string;
  }) {
    this.#virtualFields.push({
      name,
      expression,
      involvedFields,
      tables,
    });
    this.#valueFields.push({
      value: name,
      label: label ?? this.#inferLabel(name),
    });
  }

  /**
         Add a simple count of records
         @param tableName The table to count records from
         @param label Optional custom label
         */
  simpleCount(tableName: string, label?: string) {
    this.calculatedValueField({
      name: `${tableName}_count`,
      expression: `case when ${tableName}.id is null then 0 else 1 end`,
      involvedFields: ["id"],
      tables: [tableName],
      label: label ?? `${this.#inferLabel(tableName)} Count`,
    });
  }

  /**
         Add a count of related records through a foreign key relationship
         @param fromTable The table containing the foreign key
         @param toTable The referenced table
         @param throughField Optional field name
         */
  relatedCount(params: {
    countTable: string;
    parentTable: string;
    throughField?: string;
  }) {
    // Verify the relationship exists
    const countTable = system.db.tables[params.countTable];
    if (!countTable) {
      throw new Error(`Table ${params.countTable} not found`);
    }
    const parentTable = system.db.tables[params.parentTable];
    if (!parentTable) {
      throw new Error(`Table ${params.parentTable} not found`);
    }
    let fkField = params.throughField
      ? countTable.fields[params.throughField]
      : undefined;
    if (!fkField) {
      for (const field of Object.values(countTable.fields)) {
        if (field.type === "ForeignKey" && field.table === parentTable.name) {
          fkField = field;
          break;
        }
      }
    }
    if (!fkField) {
      throw new Error(
        `Foreign key field ${params.throughField} not found in table ${countTable.name}`,
      );
    }

    this.calculatedValueField({
      name: `${countTable.name}_count`,
      expression:
        `(select count(*) from ${countTable.name} where ${countTable.name}.${fkField.name} = ${parentTable.name}.id)`,
      involvedFields: ["id"],
      tables: [parentTable.name],
    });
  }

  getConfig() {
    return {
      rowOptions: this.#rowFields,
      columnOptions: this.#columnFields,
      valueOptions: this.#valueFields,
      virtualFields: this.#virtualFields,
    };
  }
}

export interface SimplePivotTableProps {
  builder: (b: PivotTableBuilder) => void;
  cardSx?: Style;
  defaultAggregateFunction?: string;
  layout?: "horizontal" | "vertical";
  hideConfigCard?: boolean;
  /** Tables to omit when automatically discovering relationships. */
  excludeTables?: string[];
  aggregateOptions?: {
    value: string;
    label: string;
  }[];
}

/**
 A component that creates a configurable pivot table with row and column aggregations.

 The pivot table allows users to:
 - Select row and column fields for grouping
 - Choose values to aggregate
 - Apply different aggregation functions (sum, avg, min, max)
 - Download results
 - View row and column totals

 @category UI Component
  @example
 [Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)

 @param props.config.rowColumnConfig Configuration for fields that can be used as row/column headers
 @param props.config.valueConfig Configuration for fields that can be aggregated
 @param props.config.options Optional custom options for dropdowns
 @param props.config.options.row Custom options for row field selection
 @param props.config.options.column Custom options for column field selection
 @param props.config.options.value Custom options for value field selection
 @param props.config.options.aggregate Required options for aggregate functions
 @param props.config.defaults Default selected values for the pivot table
 @param props.layout.cardPosition Position of the config card relative to results ("row" | "column")
 @param props.layout.hideConfigCard Whether to hide the configuration card
 @param props.layout.cardSx Styles for the configuration card
 @param props.excludeTables Tables to omit when automatically discovering relationships
 */
export function SimplePivotTable(props: SimplePivotTableProps) {
  const { builder, excludeTables, ...otherProps } = props;

  const builderInstance = new PivotTableBuilder();
  builder(builderInstance);
  const config = builderInstance.getConfig();
  if (
    !config.rowOptions.length || !config.columnOptions.length ||
    !config.valueOptions.length
  ) {
    throw new Error("SimplePivotTable requires row, column, and value options");
  }

  const {
    cardSx,
    hideConfigCard,
    defaultAggregateFunction = "sum",
    aggregateOptions = [
      { value: "sum", label: "Sum" },
      { value: "avg", label: "Average" },
      { value: "min", label: "Minimum" },
      { value: "max", label: "Maximum" },
    ],
    layout = "horizontal",
  } = otherProps;

  const tableRelationships = createSortedTableRelationships(
    generateTableRelationships({ excludeTables }),
  );

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("selected_row", sql.lit(config.rowOptions[0].value));
        s.defScalar(
          "selected_column",
          sql.lit((config.columnOptions[1] ?? config.columnOptions[0]).value),
        );
        s.defScalar("selected_value", sql.lit(config.valueOptions[0].value));
        s.defScalar("selected_aggregate", sql.lit`${defaultAggregateFunction}`);
      }}
    >
      <div
        sx={{
          display: "flex",
          gap: 2,
          flexDirection: layout === "horizontal" ? "row" : "column",
          height: "100%",
          width: "100%",
          overflowX: "hidden",
          minWidth: 0,
        }}
      >
        <Data
          watch={[
            sql`selected_row`,
            sql`selected_column`,
            sql`selected_value`,
            sql`selected_aggregate`,
          ]}
          procedure={(s) => {
            generatePivotTableQuery(
              s,
              sql`selected_row`,
              sql`selected_column`,
              sql`selected_value`,
              sql`selected_aggregate`,
              config,
              tableRelationships,
            );
            s.dynamicQuery({
              resultTable: "dyn_result",
              query: sql`generated_query`,
              columnCount: 35,
            });
            s.defTable(
              "result_rows",
              sql`select distinct field_0 as row_name from dyn_result order by row_name`,
            );
            s.defTable(
              "result_columns",
              sql`select distinct field_1 as column_name from dyn_result order by column_name`,
            );
          }}
          statusScalar="status"
          hasDataScalar="has_data"
        >
          {!hideConfigCard && (
            <Card
              sx={[{ p: 4 }, cardSx]}
              variant="outlined"
              orientation="horizontal"
            >
              <div
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: 2,
                  width: "100%",
                }}
              >
                <FormControl fullWidth>
                  <FormLabel>Row</FormLabel>
                  <Select
                    value={sql`selected_row`}
                    onChange={(s) => {
                      s.setScalar("selected_row", sql`target_value`);
                    }}
                    placeholder="Select Row Field"
                  >
                    {config.rowOptions.map((option) => (
                      <Select.Option value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <FormLabel>Column</FormLabel>
                  <Select
                    value={sql`selected_column`}
                    onChange={(s) =>
                      s.setScalar("selected_column", sql`target_value`)}
                    placeholder="Select Column Field"
                  >
                    {config.columnOptions.map((option) => (
                      <Select.Option value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <FormLabel>Value</FormLabel>
                  <Select
                    value={sql`selected_value`}
                    onChange={(s) =>
                      s.setScalar("selected_value", sql`target_value`)}
                    placeholder="Select Value Field"
                  >
                    {config.valueOptions.map((option) => (
                      <Select.Option value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <FormLabel>Aggregate Function</FormLabel>
                  <Select
                    value={sql`selected_aggregate`}
                    onChange={(s) =>
                      s.setScalar("selected_aggregate", sql`target_value`)}
                    placeholder="Select Aggregate"
                  >
                    {aggregateOptions?.map((option) => (
                      <Select.Option value={option.value}>
                        {option.label}
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>
              </div>
              <Divider orientation="vertical" className="mx-4" />
              <DownloadButton
                variant="solid"
                color="neutral"
                sx={{ alignSelf: "flex-end" }}
                query={sql`
    with distinct_columns as (
      select distinct field_1
      from dyn_result
      where field_1 is not null
      order by field_1
    ),
    header_row as (
      select
        selected_row::text as first_col,
        string_agg(field_1::text, ',' order by field_1) as columns
    from distinct_columns
    ),
    data_rows as (
      select
        field_0 as first_col,
        string_agg(field_2::text, ',' order by field_1) as columns
      from dyn_result
      where field_2 is not null
      group by field_0
      order by field_0
    )
    select
      first_col || ',' || columns as row
    from header_row
    union all
    select
      first_col || ',' || columns as row
    from data_rows`}
                fileName="pivot_table_export.csv"
                disabled={sql`not has_data`}
              >
                Export
              </DownloadButton>
            </Card>
          )}
          <Show
            when={sql`status = 'failed'`}
          >
            <Alert color="danger">
              Failed to get information from server. Please try again
            </Alert>
          </Show>
          <Show
            when={sql`status != 'received' and status != 'failed'`}
          >
            <div className="flex justify-center items-center p-4">
              <CircularProgress />
            </div>
          </Show>
          <Show when={sql`status = 'received'`}>
            <div
              sx={{
                height: "100%",
                width: "100%",
                position: "relative",
                minWidth: 0,
              }}
            >
              <div
                sx={{
                  overflowX: "auto",
                  position: "absolute",
                  inset: 0,
                }}
              >
                <TableComponent
                  sx={{
                    borderRadius: "md",
                    border: "1px solid",
                    borderColor: "divider",
                    tableLayout: "auto",
                    width: "100%",
                    "--table-cell-data-background": cssVar(
                      "palette-background-body",
                    ),
                  }}
                >
                  <thead>
                    <tr>
                      <th
                        sx={[
                          styles.queryResultsTableHeader,
                          styles.stickyCorner,
                        ]}
                      />
                      <Switch>
                        {config.columnOptions.map((col) => {
                          let header: Node;
                          if (col.formatHeader) {
                            const Component = col.formatHeader;
                            header = (
                              <Component value={sql`column.column_name`} />
                            );
                          } else {
                            header = sql`column.column_name`;
                          }

                          return (
                            <Match
                              when={sql`selected_column = ${
                                sql.lit(col.value)
                              }`}
                            >
                              <Each table="result_columns" recordName="column">
                                <th sx={styles.queryResultsTableHeader}>
                                  {header}
                                </th>
                              </Each>
                            </Match>
                          );
                        })}
                      </Switch>
                      <th
                        sx={[
                          styles.queryResultsTableHeader,
                          {
                            position: "sticky",
                            right: 0,
                            backgroundColor: "primary-50",
                            zIndex: 3,
                          },
                        ]}
                      >
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <Each table="result_rows" recordName="row">
                      <tr sx={styles.tableRow}>
                        <Switch>
                          {config.rowOptions.map((row) => {
                            let header: Node;
                            if (row.formatHeader) {
                              const Component = row.formatHeader;
                              header = <Component value={sql`row.row_name`} />;
                            } else {
                              header = sql`row.row_name`;
                            }
                            return (
                              <Match
                                when={sql`selected_row = ${sql.lit(row.value)}`}
                              >
                                <td sx={styles.tableCell}>{header}</td>
                              </Match>
                            );
                          })}
                        </Switch>
                        <Each table="result_columns" recordName="column">
                          <td sx={styles.tableCell}>
                            {sql`format.decimal((select field_2 from dyn_result
              where field_0 = ${sql`row.row_name`}
              and field_1 = ${sql`column.column_name`}
              limit 1)::decimal(18,8))`}
                          </td>
                        </Each>
                        <td sx={styles.tableCell}>
                          {sql`format.decimal((select sum(cast(field_2 as decimal(18,8))) from dyn_result
            where field_0 = ${sql`row.row_name`}))`}
                        </td>
                      </tr>
                    </Each>
                    <tr sx={styles.tableRow}>
                      <td sx={styles.stickyTotalCorner}>
                        <strong>Total</strong>
                      </td>
                      <Each table="result_columns" recordName="column">
                        <td sx={styles.stickyTotal}>
                          {sql`format.decimal((select sum(cast(field_2 as decimal(18,8))) from dyn_result
            where field_1 = ${sql`column.column_name`}))`}
                        </td>
                      </Each>
                      <td sx={styles.stickyTotalRight}>
                        {sql`format.decimal((select sum(cast(field_2 as decimal(18,8))) from dyn_result))`}
                      </td>
                    </tr>
                  </tbody>
                </TableComponent>
              </div>
            </div>
          </Show>
        </Data>
      </div>
    </Data>
  );
}
