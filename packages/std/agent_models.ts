import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

/** Models exposed by Spark and Forge, in picker order. */
export const agentModels = [
  { id: "gpt-5.6-luna", label: "Luna" },
  { id: "gpt-5.6-terra", label: "Terra" },
  { id: "gpt-5.6-sol", label: "Sol" },
  { id: "gpt-6-astra", label: "Astra" },
];

/** Null and legacy selections use Luna, including noninteractive runs. */
export function agentModelExpr(model: Sql): Sql {
  return sql`case when ${model} in (${
    agentModels.map((model) => sql.lit(model.id))
  })
    then ${model} else 'gpt-5.6-luna' end`;
}

/** Astra requires reasoning; its lowest supported effort is low. */
export function agentReasoningEffortExpr(model: Sql, effort: Sql): Sql {
  return sql`case when ${model} = 'gpt-6-astra' and ${effort} = 'none'
    then 'low' else ${effort} end`;
}
