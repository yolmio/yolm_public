import type { BoolEnumLikeConfig } from "../system";
import { sql } from "../sql_utils";
import type { Sql } from "../sql_utils";

export function enumLikeDisplayName(
  value: Sql,
  enumLike: BoolEnumLikeConfig,
) {
  const trueLiteral = sql.lit(enumLike.true);
  const falseLiteral = sql.lit(enumLike.false);
  return sql`case when ${value} then ${trueLiteral} when not ${value} then ${falseLiteral} else ${
    sql.lit(
      enumLike.null ?? "Unspecified",
    )
  } end`;
}
