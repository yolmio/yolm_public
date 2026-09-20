import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import { system } from "std/system";

const RENDER_FUNCTION = "email_delivery_render_template";
const MAX_TEMPLATE_BYTES = 10_000_000;
const MAX_TEMPLATE_PLACEHOLDERS = 10_000;
const MAX_RENDERED_OUTPUT_BYTES = 10_000_000;
const PLACEHOLDER_PATTERN = String
  .raw`(?s)\{\{\{.*?\}\}\}|\{\{\}\}|\{\{[^\{].*?\}\}|\{\{\{.*$|\{\{.*$`;

export function registerEmailDeliveryTemplateRenderer() {
  if (system.scalarFunctions[RENDER_FUNCTION]) return;

  system.scalarFunction({
    name: RENDER_FUNCTION,
    description:
      "Render double- and triple-brace email variables in one left-to-right pass.",
    parameters: [
      {
        name: "template",
        type: { type: "String", maxLength: 10_000_000 },
      },
      { name: "variables", type: "Json", notNull: true },
      { name: "escape_html", type: "Bool", notNull: true },
    ],
    returnType: "String",
    procedure: (s) => {
      s.returnIf(sql`input.template is null`, sql`null`);
      s.throwErrorIf(
        sql`octet_length(string.to_utf8(input.template)) > ${MAX_TEMPLATE_BYTES}`,
        sql.lit`Email template exceeds the 10 MB rendering limit`,
      );
      s.throwErrorIf(
        sql`(select count(*) from (
          select 1
          from regex.matches(
            input.template,
            ${sql.lit(PLACEHOLDER_PATTERN)}
          )
          limit ${MAX_TEMPLATE_PLACEHOLDERS + 1}
        ) bounded_placeholders) > ${MAX_TEMPLATE_PLACEHOLDERS}`,
        sql.lit`Email template exceeds the 10000 placeholder rendering limit`,
      );
      const renderedChunks = sql`
          select part.ordinal * 2 as sort_order, part.value as piece
          from regex.split(
            input.template,
            ${sql.lit(PLACEHOLDER_PATTERN)}
          ) part
          union all
          select placeholder.ordinal * 2 + 1,
            case
              when not placeholder.complete then placeholder.value
              when input.variables ? placeholder.variable_name then
                case
                  when input.escape_html and not placeholder.raw_variable
                    then string.html_escape(coalesce(
                      input.variables ->> placeholder.variable_name,
                      ''
                    ))
                  else coalesce(
                    input.variables ->> placeholder.variable_name,
                    ''
                  )
                end
              else placeholder.value
            end
          from (
            select match.value, match.ordinal,
              starts_with(match.value, '{{{') as raw_variable,
              case when starts_with(match.value, '{{{')
                  then ends_with(match.value, '}}}')
                else ends_with(match.value, '}}')
              end as complete,
              case
                when starts_with(match.value, '{{{') and
                    ends_with(match.value, '}}}')
                  then substring(
                    match.value from 4 for char_length(match.value) - 6
                  )
                when not starts_with(match.value, '{{{') and
                    ends_with(match.value, '}}')
                  then substring(
                    match.value from 3 for char_length(match.value) - 4
                  )
                else null
              end as variable_name
            from regex.matches(
              input.template,
              ${sql.lit(PLACEHOLDER_PATTERN)}
            ) match
          ) placeholder
      `;
      s.defScalar(
        "rendered_output_bytes",
        sql`(select coalesce(sum(octet_length(string.to_utf8(piece))), 0)
          from (${renderedChunks}) chunks)`,
      );
      s.throwErrorIf(
        sql`rendered_output_bytes > ${MAX_RENDERED_OUTPUT_BYTES}`,
        sql.lit`Rendered email template exceeds the 10 MB output limit`,
      );
      s.return(sql`(
        select coalesce(string_agg(piece, '' order by sort_order), '')
        from (${renderedChunks}) chunks
      )`);
    },
  });
}

export function renderEmailDeliveryTemplate(
  template: Sql,
  variables: Sql,
  escapeHtml: boolean,
) {
  return sql`fn.email_delivery_render_template(
    ${template}, ${variables}, ${escapeHtml}
  )`;
}
