import { type Sql, sql } from "./sql_utils";

/**
 * Coerces a JSON-typed expression to a JSON array.
 *
 * Returns the input unchanged if it is already an array, wraps a single
 * non-null value in `[value]`, and produces `[]` for `null`. Useful when
 * an upstream API returns either a single object or a list and downstream
 * SQL wants to iterate uniformly.
 *
 * @example
 * import { jsonNodeArray } from "std/json_utils";
 * import { sql } from "std/sql_utils";
 *
 * sql`select value
 *     from json_each(${jsonNodeArray(sql`response_payload->'items'`)})`;
 */
export function jsonNodeArray(node: Sql): Sql {
  return sql`case
    when json_typeof(${node}) = 'array' then ${node}
    when ${node} is not null then json_build_array(${node})
    else json_build_array()
  end`;
}
