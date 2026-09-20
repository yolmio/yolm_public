import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";

export function formatSchedulingDuration(duration: NumericExpr): Sql {
  return sql`case
    when ${duration} < 60 then ${duration} || ' minute' ||
      case when ${duration} != 1 then 's' else '' end
    else (${duration} / 60) || ' hour' ||
      case when ${duration} / 60 != 1 then 's' else '' end ||
      case when ${duration} % 60 > 0
        then ' ' || (${duration} % 60) || ' minute' ||
          case when ${duration} % 60 != 1 then 's' else '' end
        else ''
      end
  end`;
}
