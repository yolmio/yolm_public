import { type Sql, sql } from "std/sql_utils";

function headTailExpr(
  output: Sql,
  headChars: number,
  tailChars: number,
  warning = "Warning: truncated output for prompt context.",
): Sql {
  const maxChars = headChars + tailChars;
  return sql`case
    when ${output} is null or ${output} = '' then ${output}
    when char_length(${output}) <= ${maxChars} then ${output}
    else
      ${sql.lit(warning)} || chr(10) ||
      'Original chars: ' || char_length(${output})::string || chr(10) ||
      chr(10) ||
      left(${output}, ${headChars}) ||
      chr(10) || '[...' ||
      (char_length(${output}) - ${maxChars})::string ||
      ' chars truncated ...]' || chr(10) ||
      substring(${output} from char_length(${output}) - ${tailChars} + 1)
  end`;
}

export function sparkPersistedToolOutputExpr(output: Sql): Sql {
  return headTailExpr(
    output,
    24000,
    15000,
    "Warning: tool output truncated before conversation storage.",
  );
}

export function sparkPersistedToolOutputJsonExpr(output: Sql): Sql {
  return sql`case
    when char_length(coalesce(${output}, '[]'::json)::string) <= 40000
      then coalesce(${output}, '[]'::json)
    else json_build_array(json_build_object(
      'type', 'text',
      'text', ${
    sparkPersistedToolOutputExpr(
      sql`coalesce(${output}, '[]'::json)::string`,
    )
  }
    ))
  end`;
}

export function sparkPromptConsoleExpr(output: Sql): Sql {
  return headTailExpr(output, 6000, 6000);
}

export function sparkPromptFullResponseExpr(output: Sql): Sql {
  return headTailExpr(output, 24000, 16000);
}

export function sparkPromptErrorExpr(output: Sql): Sql {
  return headTailExpr(output, 12000, 8000);
}
