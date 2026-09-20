/**
 * Helper functions for building exit criteria conditions that check stage-specific data.
 *
 * Stage data is stored in a separate table (crm_pipeline_stage_data) with one row per field.
 * These helpers generate subqueries that check field values for a given stage.
 *
 * Usage in pipeline config:
 * ```typescript
 * import { stageDataBool, stageDataNotEmpty } from "blocks/crm/pipeline/types";
 *
 * exitCriteria: [
 *   {
 *     name: "contract_signed",
 *     displayName: "Contract Signed",
 *     condition: stageDataBool("empower", "contract_signed"),
 *   },
 *   {
 *     name: "need_for_change",
 *     displayName: "Need for Change identified",
 *     condition: stageDataNotEmpty("listen", "need_for_change"),
 *   },
 * ]
 * ```
 */

import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

/**
 * Returns a SQL condition that checks if a boolean stage data field is true.
 *
 * @param stageName - The stage name (e.g., "listen", "inspire")
 * @param fieldName - The field name as defined in stage.fields
 * @param stageDataTable - Optional custom table name (defaults to "crm_pipeline_stage_data")
 */
export function stageDataBool(
  stageName: string,
  fieldName: string,
  stageDataTable = "crm_pipeline_stage_data",
): Sql {
  return sql`coalesce((
    select sd.bool_value
    from db.${sql.ref(stageDataTable)} sd
    where sd.pipeline_item_id = item.id
      and sd.stage_name = ${sql.lit(stageName)}
      and sd.field_name = ${sql.lit(fieldName)}
  ), false)`;
}

/**
 * Returns a SQL condition that checks if a text/string stage data field is not empty.
 *
 * @param stageName - The stage name (e.g., "listen", "inspire")
 * @param fieldName - The field name as defined in stage.fields
 * @param stageDataTable - Optional custom table name (defaults to "crm_pipeline_stage_data")
 */
export function stageDataNotEmpty(
  stageName: string,
  fieldName: string,
  stageDataTable = "crm_pipeline_stage_data",
): Sql {
  return sql`(
    select sd.string_value is not null and sd.string_value != ''
    from db.${sql.ref(stageDataTable)} sd
    where sd.pipeline_item_id = item.id
      and sd.stage_name = ${sql.lit(stageName)}
      and sd.field_name = ${sql.lit(fieldName)}
  )`;
}

/**
 * Returns a SQL condition that checks if a stage data field (any type) is not null.
 * Useful for date fields or required fields.
 *
 * @param stageName - The stage name (e.g., "listen", "inspire")
 * @param fieldName - The field name as defined in stage.fields
 * @param valueColumn - The column to check (string_value, bool_value, date_value, numeric_value)
 * @param stageDataTable - Optional custom table name (defaults to "crm_pipeline_stage_data")
 */
export function stageDataNotNull(
  stageName: string,
  fieldName: string,
  valueColumn: "string_value" | "bool_value" | "date_value" | "numeric_value" =
    "string_value",
  stageDataTable = "crm_pipeline_stage_data",
): Sql {
  return sql`(
    select sd.${sql.ref(valueColumn)} is not null
    from db.${sql.ref(stageDataTable)} sd
    where sd.pipeline_item_id = item.id
      and sd.stage_name = ${sql.lit(stageName)}
      and sd.field_name = ${sql.lit(fieldName)}
  )`;
}

/**
 * Returns a SQL condition that checks if a numeric/score stage data field meets a threshold.
 *
 * @param stageName - The stage name (e.g., "listen", "inspire")
 * @param fieldName - The field name as defined in stage.fields
 * @param operator - Comparison operator (>=, >, =, <, <=)
 * @param threshold - The threshold value to compare against
 * @param stageDataTable - Optional custom table name (defaults to "crm_pipeline_stage_data")
 */
export function stageDataNumeric(
  stageName: string,
  fieldName: string,
  operator: ">=" | ">" | "=" | "<" | "<=",
  threshold: number,
  stageDataTable = "crm_pipeline_stage_data",
): Sql {
  const op = operator === ">="
    ? sql`>=`
    : operator === ">"
    ? sql`>`
    : operator === "="
    ? sql`=`
    : operator === "<"
    ? sql`<`
    : sql`<=`;

  return sql`coalesce((
    select sd.numeric_value ${op} ${threshold}
    from db.${sql.ref(stageDataTable)} sd
    where sd.pipeline_item_id = item.id
      and sd.stage_name = ${sql.lit(stageName)}
      and sd.field_name = ${sql.lit(fieldName)}
  ), false)`;
}
