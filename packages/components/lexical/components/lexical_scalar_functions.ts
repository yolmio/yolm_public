import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { BasicStatements } from "std/statements";
import type { System } from "std/system";

type ScalarFunctionRegistrar = Pick<
  System,
  "scalarFunction" | "scalarFunctions"
>;

function safeLexicalLinkUrl(rawUrl: Sql): Sql {
  const trimmedUrl = sql`trim(coalesce(${rawUrl}, ''))`;
  return sql`case
    when starts_with(lower(${trimmedUrl}), 'https://')
      or starts_with(lower(${trimmedUrl}), 'http://')
      or starts_with(lower(${trimmedUrl}), 'mailto:')
      or starts_with(lower(${trimmedUrl}), 'tel:')
      or starts_with(lower(${trimmedUrl}), 'sms:')
      or (starts_with(${trimmedUrl}, '/') and not starts_with(${trimmedUrl}, '//'))
      or starts_with(${trimmedUrl}, './')
      or starts_with(${trimmedUrl}, '../')
      or starts_with(${trimmedUrl}, '#')
    then string.html_escape(${trimmedUrl})
    else ''
  end`;
}

function safeLexicalTextStyle(rawStyle: Sql): Sql {
  return sql`coalesce((
    select string_agg(
      declaration.property || ': ' || string.html_escape(declaration.value),
      '; ' order by declaration.ordinal
    )
    from (
      select
        part.ordinal,
        lower(trim(split_part(part.value, ':', 1))) as property,
        trim(substring(part.value from position(':' in part.value) + 1)) as value
      from string.split(coalesce(${rawStyle}, ''), ';') part
      where position(':' in part.value) > 0
    ) declaration
    where (
      declaration.property in ('color', 'background-color')
      and (
        regex.is_match(
          declaration.value,
          '^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$'
        )
        or regex.is_match(
          declaration.value,
          '^rgba?\\([0-9.,% ]+\\)$'
        )
        or lower(declaration.value) = 'transparent'
      )
    ) or (
      declaration.property = 'font-size'
      and (
        regex.is_match(
          declaration.value,
          '^[0-9]{1,2}(\\.[0-9]+)?(px|pt)$'
        )
        or regex.is_match(
          declaration.value,
          '^[0-9](\\.[0-9]+)?(em|rem)$'
        )
      )
    ) or (
      declaration.property = 'font-family'
      and lower(declaration.value) in (
        'arial', 'courier new', 'georgia', 'helvetica', 'times new roman',
        'trebuchet ms', 'verdana', 'monospace'
      )
    ) or (
      declaration.property = 'font-weight'
      and (
        lower(declaration.value) in ('normal', 'bold')
        or regex.is_match(declaration.value, '^[1-9]00$')
      )
    ) or (
      declaration.property = 'font-style'
      and lower(declaration.value) in ('normal', 'italic', 'oblique')
    ) or (
      declaration.property in ('text-decoration', 'text-decoration-line')
      and lower(declaration.value) in (
        'none', 'underline', 'line-through',
        'underline line-through', 'line-through underline'
      )
    ) or (
      declaration.property = 'vertical-align'
      and lower(declaration.value) in ('baseline', 'sub', 'super')
    )
  ), '')`;
}

export function ensureLexicalRichTextFunctions(
  registrar: ScalarFunctionRegistrar,
) {
  if (!registrar.scalarFunctions?.["lexical_rich_text_to_html"]) {
    registerLexicalRichTextFunctions(registrar);
  }
}

export function registerLexicalRichTextFunctions(
  registrar: ScalarFunctionRegistrar,
) {
  registrar.scalarFunction({
    name: "lexical_video_html",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.defScalar("raw_url", sql`coalesce(input.node->>'url', '')`);
      s.if(
        sql`not (
        regex.is_match(raw_url, '^https://www[.]youtube[.]com/watch[?]v=[a-zA-Z0-9_-]{11}$')
        or regex.is_match(raw_url, '^https://vimeo[.]com/[0-9]+(/[a-zA-Z0-9]+)?$')
        or regex.is_match(raw_url, '(?i)^https://[^/@:?#]+(/[^?#]*)?[.](mp4|webm)([?][^#]*)?(#.*)?$')
      )`,
        (s) => s.return(sql.lit``),
      );
      s.defScalar("url", sql`string.html_escape(raw_url)`);
      s.defScalar(
        "width",
        sql`least(652.8, greatest(80, coalesce(try_cast(input.node->>'width' as double), 652.8)))`,
      );
      s.defScalar(
        "align",
        sql`case when input.node->>'align' in ('left', 'center', 'right') then input.node->>'align' else 'left' end`,
      );
      s.defScalar(
        "thumbnail",
        sql`coalesce(input.node->'thumbnail'->>'src', '')`,
      );
      s.defScalar("image", sql.lit``);
      s.if(
        sql`regex.is_match(thumbnail, '^/api/files/versions/[0-9]+/content$')`,
        (s) => {
          s.setScalar(
            "image",
            sql`'<img alt="Video thumbnail" src="' || string.html_escape(thumbnail) || '" style="display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover" />'`,
          );
        },
      );
      s.return(
        sql`'<figure class="lexical-image lexical-video" style="width:100%;margin:0 0 6pt;line-height:1.56;text-align:' || align || '">'
        || '<a target="_blank" rel="noopener noreferrer" aria-label="Watch video" href="' || url || '" style="display:inline-block;position:relative;vertical-align:top;line-height:0;max-width:100%;width:' || cast(width as string) || 'px;aspect-ratio:16/9;background:#e8edf2">'
        || image
        || '<span aria-hidden="true" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:72px;height:50.667px;max-width:60%;max-height:60%;border-radius:6.667px;background:#18212b;display:grid;place-items:center"><span style="width:20px;height:24px;max-width:60%;max-height:60%;background:white;clip-path:polygon(0 0,0 100%,100% 50%)"></span></span></a><br>'
        || '<a target="_blank" rel="noopener noreferrer" href="' || url || '">Watch video: ' || url || '</a></figure>'`,
      );
    },
  });

  registrar.scalarFunction({
    name: "lexical_rich_text_to_html",
    description: "Convert Lexical rich text to HTML",
    parameters: [{ name: "rich_text", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      // Handle null input
      s.if(sql`input.rich_text is null`, (s) => {
        s.return(sql.lit``);
      });

      // Get root node's children
      s.defScalar(
        "root_children",
        sql`input.rich_text -> 'root' -> 'children'`,
      );
      s.if(sql`root_children is null`, (s) => {
        s.return(sql.lit``);
      });

      // Result accumulator
      s.defScalar("html_result", sql.lit``);

      // Process each block node in root.children
      s.defTable(
        "block_nodes",
        sql`select value as node, index as idx from json.array_each(root_children)`,
      );
      s.forEachTable("block_nodes", "block", (s) => {
        s.defScalar(
          "block_html",
          sql`fn.lexical_process_block_node(
            block.node,
            cast(null as string),
            cast(null as string)
          )`,
        );
        s.setScalar("html_result", sql`html_result || block_html`);
      });

      // Return just the plain HTML content
      s.return(sql`html_result`);
    },
  });

  registrar.scalarFunction({
    name: "lexical_rich_text_to_html_with_image_src_prefix",
    description:
      "Convert Lexical rich text to HTML while rewriting image-node source prefixes",
    parameters: [
      { name: "rich_text", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.rich_text is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar(
        "root_children",
        sql`input.rich_text -> 'root' -> 'children'`,
      );
      s.if(sql`root_children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("html_result", sql.lit``);
      s.defTable(
        "block_nodes",
        sql`select value as node, index as idx from json.array_each(root_children)`,
      );
      s.forEachTable("block_nodes", "block", (s) => {
        s.defScalar(
          "block_html",
          sql`fn.lexical_process_block_node(
            block.node,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.setScalar("html_result", sql`html_result || block_html`);
      });
      s.return(sql`html_result`);
    },
  });

  // Email version - outputs HTML with inline styles on every element
  // Use this for emails where CSS classes/style tags are not reliably supported
  registrar.scalarFunction({
    name: "lexical_rich_text_to_html_email",
    description:
      "Convert Lexical rich text to HTML with inline styles (for emails)",
    parameters: [{ name: "rich_text", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      // Handle null input
      s.if(sql`input.rich_text is null`, (s) => {
        s.return(sql.lit``);
      });

      // Get root node's children
      s.defScalar(
        "root_children",
        sql`input.rich_text -> 'root' -> 'children'`,
      );
      s.if(sql`root_children is null`, (s) => {
        s.return(sql.lit``);
      });

      // Result accumulator
      s.defScalar("html_result", sql.lit``);

      // Process each block node in root.children (inline_styles = true)
      s.defTable(
        "block_nodes",
        sql`select value as node, index as idx from json.array_each(root_children)`,
      );
      s.forEachTable("block_nodes", "block", (s) => {
        s.defScalar(
          "block_html",
          sql`fn.lexical_process_block_node_email(block.node)`,
        );
        s.setScalar("html_result", sql`html_result || block_html`);
      });

      // Wrap in div with inline wrapper styles
      s.defScalar(
        "wrapper_style",
        sql
          .lit`box-sizing: border-box; line-height: 1.5; overflow-wrap: break-word; word-break: break-word;`,
      );
      s.return(
        sql`'<div style="' || wrapper_style || '">' || html_result || '</div>'`,
      );
    },
  });

  // Create a simple paragraph in Lexical JSON format
  registrar.scalarFunction({
    name: "lexical_simple_paragraph",
    description: "Create a simple paragraph in Lexical JSON format",
    parameters: [{ name: "text", type: "String" }],
    returnType: "Json",
    procedure: (s) => {
      s.if(sql`input.text is null`, (s) => {
        s.return(
          sql`'{"root":{"type":"root","version":1,"direction":"ltr","format":"","indent":0,"children":[{"type":"paragraph","version":1,"direction":"ltr","format":"","indent":0,"textFormat":0,"textStyle":"","children":[]}]}}'`,
        );
      });
      s.return(
        sql`json_build_object(
          'root', json_build_object(
            'type', 'root',
            'version', 1,
            'direction', 'ltr',
            'format', '',
            'indent', 0,
            'children', json_build_array(
              json_build_object(
                'type', 'paragraph',
                'version', 1,
                'direction', 'ltr',
                'format', '',
                'indent', 0,
                'textFormat', 0,
                'textStyle', '',
                'children', json_build_array(
                  json_build_object('type', 'text', 'version', 1, 'text', input.text, 'format', 0, 'style', '', 'detail', 0, 'mode', 'normal')
                )
              )
            )
          )
        )`,
      );
    },
  });

  // Convert markdown to Lexical JSON format
  // Supports: # headings, **bold**, *italic*, hard line breaks, standalone
  // images, flat bullet/numbered lists, block quotes, pipe tables, and
  // paragraphs separated by \n\n.
  registrar.scalarFunction({
    name: "lexical_from_markdown",
    description: "Convert markdown text to Lexical JSON format",
    parameters: [{ name: "markdown", type: "String" }],
    returnType: "Json",
    procedure: (s) => {
      s.if(sql`input.markdown is null or input.markdown = ''`, (s) => {
        s.return(
          sql`'{"root":{"type":"root","version":1,"direction":"ltr","format":"","indent":0,"children":[]}}'`,
        );
      });

      s.defScalar(
        "normalized_markdown",
        sql`replace(replace(input.markdown, e'\r\n', e'\n'), e'\r', e'\n')`,
      );

      // Split into blocks by double newline
      s.defTable(
        "blocks",
        sql`select value as block_text, ordinal as idx from string.split(normalized_markdown, e'\n\n')`,
      );

      // Build array of block nodes
      s.defScalar("children_array", sql`'[]'::json`);

      s.forEachTable("blocks", "block", (s) => {
        s.defScalar("trimmed", sql`trim(block.block_text)`);

        // Skip empty blocks
        s.if(sql`trimmed = ''`, (s) => {
          s.continue();
        });

        s.defScalar("image_separator", sql`position('](' in trimmed)`);
        s.if(
          sql`substring(trimmed from 1 for 2) = '!['
            and image_separator > 2
            and substring(trimmed from length(trimmed) for 1) = ')'`,
          (s) => {
            s.defScalar(
              "image_alt",
              sql`substring(trimmed from 3 for image_separator - 3)`,
            );
            s.defScalar(
              "image_src",
              sql`substring(
                trimmed
                from image_separator + 2
                for length(trimmed) - image_separator - 2
              )`,
            );
            s.defScalar(
              "image_asset_key",
              sql`case
                when image_src like '/api/issue-asset/%'
                  then substring(
                    image_src
                    from length('/api/issue-asset/') + 1
                  )
                else null
              end`,
            );
            s.setScalar(
              "children_array",
              sql`children_array || json_build_array(
                json_build_object(
                  'type', 'image',
                  'version', 1,
                  'children', json_build_array(),
                  'direction', null,
                  'format', '',
                  'indent', 0,
                  'src', image_src,
                  'altText', image_alt,
                  'width', 720,
                  'height', null,
                  'align', 'center',
                  'blobHash', null,
                  'assetKey', image_asset_key,
                  'contentType', null
                )
              )`,
            );
            s.continue();
          },
        );

        // Lists, block quotes, and pipe tables occupy every line of a block.
        s.defTable(
          "block_lines",
          sql`select value as line, ordinal
            from string.split(trimmed, e'\n') order by ordinal`,
        );
        s.defScalar(
          "list_type",
          sql`case
            when not exists (
              select 1 from block_lines
              where not regex.is_match(line, '^\\s*[-*+]\\s+')
            ) then 'bullet'
            when not exists (
              select 1 from block_lines
              where not regex.is_match(line, '^\\s*[0-9]+[.)]\\s+')
            ) then 'number'
          end`,
        );
        s.if(sql`list_type is not null`, (s) => {
          s.setScalar(
            "children_array",
            sql`children_array || json_build_array(json_build_object(
              'type', 'list',
              'version', 1,
              'listType', list_type,
              'start', case when list_type = 'number' then coalesce(try_cast(
                regex.capture(trimmed, '^\\s*([0-9]+)', 1) as int), 1) else 1 end,
              'tag', case when list_type = 'number' then 'ol' else 'ul' end,
              'direction', 'ltr',
              'format', '',
              'indent', 0,
              'children', (
                select json_array_agg(json_build_object(
                  'type', 'listitem',
                  'version', 1,
                  'value', list_line.ordinal - (
                    select min(ordinal) from block_lines
                  ) + 1,
                  'direction', 'ltr',
                  'format', '',
                  'indent', 0,
                  'children', fn.lexical_parse_inline_markdown(
                    'paragraph',
                    null,
                    regexp_replace(
                      list_line.line,
                      '^\\s*([-*+]|[0-9]+[.)])\\s+',
                      ''
                    )
                  ) -> 0 -> 'children'
                ) order by list_line.ordinal)
                from block_lines list_line
              )
            ))`,
          );
          s.continue();
        });
        s.if(
          sql`not exists (
            select 1 from block_lines where not regex.is_match(line, '^\\s*>')
          )`,
          (s) => {
            s.defScalar(
              "quote_text",
              sql`(
                select string_agg(
                  regexp_replace(line, '^\\s*>\\s?', ''), e'\n'
                  order by ordinal
                )
                from block_lines
              )`,
            );
            s.setScalar(
              "children_array",
              sql`children_array || json_build_array(json_build_object(
                'type', 'quote',
                'version', 1,
                'direction', 'ltr',
                'format', '',
                'indent', 0,
                'children', fn.lexical_parse_inline_markdown(
                  'paragraph', null, quote_text
                ) -> 0 -> 'children'
              ))`,
            );
            s.continue();
          },
        );
        s.defScalar(
          "table_separator_ordinal",
          sql`(
            select ordinal from block_lines
            order by ordinal limit 1 offset 1
          )`,
        );
        s.if(
          sql`table_separator_ordinal is not null
            and not exists (
              select 1 from block_lines where not regex.is_match(line, '^\\s*[|]')
            )
            and regex.is_match(
              (select line from block_lines
                where ordinal = table_separator_ordinal),
              '^\\s*[|]?(\\s*:?-+:?\\s*[|])+\\s*(:?-+:?\\s*)?$'
            )`,
          (s) => {
            s.defScalar("table_rows", sql`'[]'::json`);
            s.forEachTable("block_lines", "table_line", (s) => {
              s.continueIf(sql`table_line.ordinal = table_separator_ordinal`);
              s.defScalar(
                "table_cells",
                sql`(
                  select json_array_agg(json_build_object(
                    'type', 'tablecell',
                    'version', 1,
                    'direction', 'ltr',
                    'format', '',
                    'indent', 0,
                    'headerState', case
                      when table_line.ordinal < table_separator_ordinal
                        then 1 else 0 end,
                    'colSpan', 1,
                    'rowSpan', 1,
                    'backgroundColor', null,
                    'children', fn.lexical_parse_inline_markdown(
                      'paragraph', null, trim(cell.value)
                    )
                  ) order by cell.ordinal)
                  from string.split(
                    regexp_replace(
                      regexp_replace(trim(table_line.line), '^[|]', ''),
                      '[|]$',
                      ''
                    ),
                    '|'
                  ) cell
                )`,
              );
              s.setScalar(
                "table_rows",
                sql`table_rows || json_build_array(json_build_object(
                  'type', 'tablerow',
                  'version', 1,
                  'direction', 'ltr',
                  'format', '',
                  'indent', 0,
                  'children', coalesce(table_cells, '[]'::json)
                ))`,
              );
            });
            s.setScalar(
              "children_array",
              sql`children_array || json_build_array(json_build_object(
                'type', 'table',
                'version', 1,
                'direction', 'ltr',
                'format', '',
                'indent', 0,
                'children', table_rows
              ))`,
            );
            s.continue();
          },
        );

        // Check for headings (# to ######)
        s.defScalar("is_h1", sql`trimmed like '# %'`);
        s.defScalar("is_h2", sql`trimmed like '## %'`);
        s.defScalar("is_h3", sql`trimmed like '### %'`);
        s.defScalar("is_h4", sql`trimmed like '#### %'`);
        s.defScalar("is_h5", sql`trimmed like '##### %'`);
        s.defScalar("is_h6", sql`trimmed like '###### %'`);

        s.if(sql`is_h6`, (s) => {
          s.defScalar("heading_text", sql`substring(trimmed from 8)`);
          s.defScalar(
            "block_node",
            sql`fn.lexical_parse_inline_markdown('heading', 'h6', heading_text)`,
          );
          s.setScalar("children_array", sql`children_array || block_node`);
        }, (s) => {
          s.if(sql`is_h5`, (s) => {
            s.defScalar("heading_text", sql`substring(trimmed from 7)`);
            s.defScalar(
              "block_node",
              sql`fn.lexical_parse_inline_markdown('heading', 'h5', heading_text)`,
            );
            s.setScalar("children_array", sql`children_array || block_node`);
          }, (s) => {
            s.if(sql`is_h4`, (s) => {
              s.defScalar("heading_text", sql`substring(trimmed from 6)`);
              s.defScalar(
                "block_node",
                sql`fn.lexical_parse_inline_markdown('heading', 'h4', heading_text)`,
              );
              s.setScalar("children_array", sql`children_array || block_node`);
            }, (s) => {
              s.if(sql`is_h3`, (s) => {
                s.defScalar("heading_text", sql`substring(trimmed from 5)`);
                s.defScalar(
                  "block_node",
                  sql`fn.lexical_parse_inline_markdown('heading', 'h3', heading_text)`,
                );
                s.setScalar(
                  "children_array",
                  sql`children_array || block_node`,
                );
              }, (s) => {
                s.if(sql`is_h2`, (s) => {
                  s.defScalar("heading_text", sql`substring(trimmed from 4)`);
                  s.defScalar(
                    "block_node",
                    sql`fn.lexical_parse_inline_markdown('heading', 'h2', heading_text)`,
                  );
                  s.setScalar(
                    "children_array",
                    sql`children_array || block_node`,
                  );
                }, (s) => {
                  s.if(sql`is_h1`, (s) => {
                    s.defScalar("heading_text", sql`substring(trimmed from 3)`);
                    s.defScalar(
                      "block_node",
                      sql`fn.lexical_parse_inline_markdown('heading', 'h1', heading_text)`,
                    );
                    s.setScalar(
                      "children_array",
                      sql`children_array || block_node`,
                    );
                  }, (s) => {
                    // Regular paragraph
                    s.defScalar(
                      "block_node",
                      sql`fn.lexical_parse_inline_markdown('paragraph', null, trimmed)`,
                    );
                    s.setScalar(
                      "children_array",
                      sql`children_array || block_node`,
                    );
                  });
                });
              });
            });
          });
        });
      });

      s.return(
        sql`json_build_object(
          'root', json_build_object(
            'type', 'root',
            'version', 1,
            'direction', 'ltr',
            'format', '',
            'indent', 0,
            'children', children_array
          )
        )`,
      );
    },
  });

  // Helper function to parse inline markdown (bold, italic) and create a block node
  registrar.scalarFunction({
    name: "lexical_parse_inline_markdown",
    description: "Parse inline markdown and create a Lexical block node",
    parameters: [
      { name: "block_type", type: "String" }, // 'paragraph' or 'heading'
      { name: "tag", type: "String" }, // 'h1', 'h2', etc. for headings, null for paragraph
      { name: "text", type: "String" },
    ],
    returnType: "Json",
    procedure: (s) => {
      // For simplicity, we'll parse **bold** and *italic* patterns
      // This is a simplified parser - handles basic cases

      s.defScalar("remaining", sql`input.text`);
      s.defScalar("inline_nodes", sql`'[]'::json`);

      // Simple state machine to parse inline formatting
      s.defScalar("current_text", sql.lit``);
      s.defScalar("i", sql`1`);
      s.defScalar("text_len", sql`length(input.text)`);

      s.while(sql`i <= text_len`, (s) => {
        s.defScalar("char", sql`substring(remaining from i for 1)`);
        s.defScalar("next_char", sql`substring(remaining from i + 1 for 1)`);

        // Check for hard line break
        s.if(sql`char = e'\n'`, (s) => {
          // Flush current text if any
          s.if(sql`current_text != ''`, (s) => {
            s.setScalar(
              "inline_nodes",
              sql`inline_nodes || json_build_array(json_build_object('type', 'text', 'version', 1, 'text', rtrim(current_text), 'format', 0, 'style', '', 'detail', 0, 'mode', 'normal'))`,
            );
            s.setScalar("current_text", sql.lit``);
          });
          s.setScalar(
            "inline_nodes",
            sql`inline_nodes || json_build_array(json_build_object('type', 'linebreak', 'version', 1))`,
          );
          s.setScalar("i", sql`i + 1`);
        }, (s) => {
          // Check for ** (bold)
          s.if(sql`char = '*' and next_char = '*'`, (s) => {
            // Flush current text if any
            s.if(sql`current_text != ''`, (s) => {
              s.setScalar(
                "inline_nodes",
                sql`inline_nodes || json_build_array(json_build_object('type', 'text', 'version', 1, 'text', current_text, 'format', 0, 'style', '', 'detail', 0, 'mode', 'normal'))`,
              );
              s.setScalar("current_text", sql.lit``);
            });

            // Find closing **
            s.defScalar(
              "close_pos",
              sql`position('**' in substring(remaining from i + 2))`,
            );
            s.if(sql`close_pos > 0`, (s) => {
              s.defScalar(
                "bold_text",
                sql`substring(remaining from i + 2 for close_pos - 1)`,
              );
              s.setScalar(
                "inline_nodes",
                sql`inline_nodes || json_build_array(json_build_object('type', 'text', 'version', 1, 'text', bold_text, 'format', 1, 'style', '', 'detail', 0, 'mode', 'normal'))`,
              );
              s.setScalar("i", sql`i + 2 + close_pos + 1`);
            }, (s) => {
              // No closing **, treat as regular text
              s.setScalar("current_text", sql`current_text || char`);
              s.setScalar("i", sql`i + 1`);
            });
          }, (s) => {
            // Check for single * (italic) - but not **
            s.if(sql`char = '*' and next_char != '*'`, (s) => {
              // Flush current text if any
              s.if(sql`current_text != ''`, (s) => {
                s.setScalar(
                  "inline_nodes",
                  sql`inline_nodes || json_build_array(json_build_object('type', 'text', 'version', 1, 'text', current_text, 'format', 0, 'style', '', 'detail', 0, 'mode', 'normal'))`,
                );
                s.setScalar("current_text", sql.lit``);
              });

              // Find closing * (not **)
              s.defScalar("search_from", sql`i + 1`);
              s.defScalar("found_close", sql`false`);
              s.defScalar("close_idx", sql`0`);

              s.defScalar("j", sql`search_from`);
              s.while(sql`j <= text_len and not found_close`, (s) => {
                s.defScalar("c", sql`substring(remaining from j for 1)`);
                s.defScalar(
                  "c_next",
                  sql`substring(remaining from j + 1 for 1)`,
                );
                s.if(sql`c = '*' and c_next != '*'`, (s) => {
                  // Check previous char is not *
                  s.defScalar(
                    "c_prev",
                    sql`substring(remaining from j - 1 for 1)`,
                  );
                  s.if(sql`c_prev != '*'`, (s) => {
                    s.setScalar("found_close", sql`true`);
                    s.setScalar("close_idx", sql`j`);
                  });
                });
                s.setScalar("j", sql`j + 1`);
              });

              s.if(sql`found_close`, (s) => {
                s.defScalar(
                  "italic_text",
                  sql`substring(remaining from i + 1 for close_idx - i - 1)`,
                );
                s.setScalar(
                  "inline_nodes",
                  sql`inline_nodes || json_build_array(json_build_object('type', 'text', 'version', 1, 'text', italic_text, 'format', 2, 'style', '', 'detail', 0, 'mode', 'normal'))`,
                );
                s.setScalar("i", sql`close_idx + 1`);
              }, (s) => {
                // No closing *, treat as regular text
                s.setScalar("current_text", sql`current_text || char`);
                s.setScalar("i", sql`i + 1`);
              });
            }, (s) => {
              // Regular character
              s.setScalar("current_text", sql`current_text || char`);
              s.setScalar("i", sql`i + 1`);
            });
          });
        });
      });

      // Flush remaining text
      s.if(sql`current_text != ''`, (s) => {
        s.setScalar(
          "inline_nodes",
          sql`inline_nodes || json_build_array(json_build_object('type', 'text', 'version', 1, 'text', current_text, 'format', 0, 'style', '', 'detail', 0, 'mode', 'normal'))`,
        );
      });

      // Build the block node with all required Lexical fields
      s.if(sql`input.block_type = 'heading'`, (s) => {
        s.return(
          sql`json_build_array(json_build_object(
            'type', 'heading',
            'version', 1,
            'tag', input.tag,
            'direction', 'ltr',
            'format', '',
            'indent', 0,
            'children', inline_nodes
          ))`,
        );
      }, (s) => {
        s.return(
          sql`json_build_array(json_build_object(
            'type', 'paragraph',
            'version', 1,
            'direction', 'ltr',
            'format', '',
            'indent', 0,
            'textFormat', 0,
            'textStyle', '',
            'children', inline_nodes
          ))`,
        );
      });
    },
  });

  // Process a block-level node (paragraph, heading, quote, list, listitem)
  registrar.scalarFunction({
    name: "lexical_process_block_node",
    description: "Process a Lexical block node to HTML",
    parameters: [
      { name: "node", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.node is null`, (s) => {
        s.return(sql.lit``);
      });

      s.defScalar("node_type", sql`input.node ->> 'type'`);
      s.defScalar("children_json", sql`input.node -> 'children'`);

      // Get alignment/format for block elements
      s.defScalar("format", sql`coalesce(input.node ->> 'format', '')`);
      s.defScalar(
        "style_attr",
        sql`
        case
          when format = 'center' then ' style="text-align: center;"'
          when format = 'right' then ' style="text-align: right;"'
          when format = 'justify' then ' style="text-align: justify;"'
          else ''
        end
      `,
      );

      // Handle indent
      s.defScalar(
        "indent",
        sql`coalesce(cast(input.node ->> 'indent' as int), 0)`,
      );
      s.if(sql`indent > 0`, (s) => {
        s.setScalar(
          "style_attr",
          sql`
          case
            when style_attr = '' then ' style="margin-left: ' || (indent * 40) || 'px;"'
            else replace(style_attr, 'style="', 'style="margin-left: ' || (indent * 40) || 'px; ')
          end
        `,
        );
      });

      s.if(sql`node_type = 'video'`, (s) => {
        s.return(sql`fn.lexical_video_html(input.node)`);
      });
      s.if(sql`node_type = 'image'`, (s) => {
        s.defScalar(
          "raw_src",
          sql`coalesce(input.node ->> 'src', '')`,
        );
        s.if(
          sql`
            input.image_src_prefix is not null
            and starts_with(raw_src, input.image_src_prefix)
          `,
          (s) => {
            s.setScalar(
              "raw_src",
              sql`
                input.image_src_replacement ||
                substring(
                  raw_src
                  from length(input.image_src_prefix) + 1
                )
              `,
            );
          },
        );
        s.defScalar(
          "src",
          sql`string.html_escape(raw_src)`,
        );
        s.defScalar(
          "alt_text",
          sql`string.html_escape(coalesce(input.node ->> 'altText', ''))`,
        );
        s.defScalar(
          "width",
          sql`coalesce(cast(input.node ->> 'width' as int), 480)`,
        );
        s.defScalar(
          "align",
          sql`case
            when input.node ->> 'align' in ('left', 'center', 'right')
              then input.node ->> 'align'
            else 'center'
          end`,
        );
        s.defScalar(
          "image_style",
          sql`case align
            when 'left' then
              'box-sizing: border-box; float: left; margin: 0 16px 12px 0; max-width: 100%; text-align: left; width: fit-content;'
            when 'right' then
              'box-sizing: border-box; float: right; margin: 0 0 12px 16px; max-width: 100%; text-align: right; width: fit-content;'
            else
              'box-sizing: border-box; clear: both; float: none; margin: 0 0 12px 0; max-width: 100%; text-align: center; width: 100%;'
          end`,
        );
        s.return(
          sql`'<figure class="lexical-image" style="' || image_style || '">' ||
              '<img src="' || src || '" alt="' || alt_text || '" style="max-width: 100%; height: auto; width: ' || width || 'px;" />' ||
              '</figure>'`,
        );
      });

      // Paragraph - children are inline nodes (text, link, etc.)
      s.if(sql`node_type = 'paragraph'`, (s) => {
        // An empty paragraph keeps one line of height, as in the editor;
        // otherwise blank lines typed beside a floated image collapse and
        // the following text wraps next to it.
        s.defScalar(
          "children_html",
          sql`coalesce(nullif(fn.lexical_process_inline_nodes(
            children_json,
            input.image_src_prefix,
            input.image_src_replacement
          ), ''), '<br>')`,
        );
        s.if(sql`style_attr != ''`, (s) => {
          s.return(
            sql`'<p class="lexical-paragraph"' || style_attr || '>' || children_html || '</p>'`,
          );
        });
        s.return(
          sql`'<p class="lexical-paragraph">' || children_html || '</p>'`,
        );
      });

      // Heading - children are inline nodes
      s.if(sql`node_type = 'heading'`, (s) => {
        s.defScalar(
          "tag",
          sql`case
            when input.node ->> 'tag' in ('h1','h2','h3','h4','h5','h6')
              then input.node ->> 'tag'
            else 'h1'
          end`,
        );
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes(
            children_json,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.defScalar("heading_class", sql`'lexical-heading-' || tag`);
        s.if(sql`style_attr != ''`, (s) => {
          s.return(
            sql`'<' || tag || ' class="' || heading_class || '"' || style_attr || '>' || children_html || '</' || tag || '>'`,
          );
        });
        s.return(
          sql`'<' || tag || ' class="' || heading_class || '">' || children_html || '</' || tag || '>'`,
        );
      });

      // Quote - children are inline nodes
      s.if(sql`node_type = 'quote'`, (s) => {
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes(
            children_json,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.if(sql`style_attr != ''`, (s) => {
          s.return(
            sql`'<blockquote class="lexical-quote"' || style_attr || '>' || children_html || '</blockquote>'`,
          );
        });
        s.return(
          sql`'<blockquote class="lexical-quote">' || children_html || '</blockquote>'`,
        );
      });

      // List - children are listitem nodes, NOT inline nodes
      s.if(sql`node_type = 'list'`, (s) => {
        s.defScalar("list_type", sql`input.node ->> 'listType'`);
        s.defScalar(
          "list_tag",
          sql`case when list_type = 'number' then 'ol' else 'ul' end`,
        );
        s.defScalar(
          "list_class",
          sql`case when list_type = 'number' then 'lexical-list-ol' else 'lexical-list-ul' end`,
        );
        s.defScalar(
          "list_children_html",
          sql`fn.lexical_process_list_items(
            children_json,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.return(
          sql`'<' || list_tag || ' class="' || list_class || '">' || list_children_html || '</' || list_tag || '>'`,
        );
      });

      // Listitem - children can be inline nodes OR nested lists
      s.if(sql`node_type = 'listitem'`, (s) => {
        // Check if this listitem contains a nested list
        s.defScalar(
          "has_nested_list",
          sql`
          exists(
            select 1 from json.array_each(children_json)
            where value ->> 'type' = 'list'
          )
        `,
        );
        s.defScalar(
          "li_class",
          sql`case when has_nested_list then 'lexical-listitem lexical-nested-list-item' else 'lexical-listitem' end`,
        );
        s.if(sql`has_nested_list`, (s) => {
          // Process mixed content (text + nested list)
          s.defScalar(
            "li_content",
            sql`fn.lexical_process_listitem_children(
              children_json,
              input.image_src_prefix,
              input.image_src_replacement
            )`,
          );
          s.return(
            sql`'<li class="' || li_class || '">' || li_content || '</li>'`,
          );
        });
        // Normal listitem - children are inline nodes
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes(
            children_json,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.return(
          sql`'<li class="' || li_class || '">' || children_html || '</li>'`,
        );
      });

      s.if(sql`node_type = 'table'`, (s) => {
        s.defScalar("rows_html", sql.lit``);
        s.defTable(
          "table_rows",
          sql`select value as node from json.array_each(children_json)`,
        );
        s.forEachTable("table_rows", "row", (s) => {
          s.setScalar(
            "rows_html",
            sql`rows_html || fn.lexical_process_block_node(
              row.node,
              input.image_src_prefix,
              input.image_src_replacement
            )`,
          );
        });
        s.return(
          sql`'<table class="lexical-table"><tbody>' || rows_html || '</tbody></table>'`,
        );
      });

      s.if(sql`node_type = 'tablerow'`, (s) => {
        s.defScalar("cells_html", sql.lit``);
        s.defTable(
          "table_cells",
          sql`select value as node from json.array_each(children_json)`,
        );
        s.forEachTable("table_cells", "cell", (s) => {
          s.setScalar(
            "cells_html",
            sql`cells_html || fn.lexical_process_block_node(
              cell.node,
              input.image_src_prefix,
              input.image_src_replacement
            )`,
          );
        });
        s.return(
          sql`'<tr class="lexical-table-row">' || cells_html || '</tr>'`,
        );
      });

      s.if(sql`node_type = 'tablecell'`, (s) => {
        s.defScalar(
          "cell_tag",
          sql`case when coalesce(cast(input.node ->> 'headerState' as int), 0) != 0 then 'th' else 'td' end`,
        );
        s.defScalar(
          "cell_class",
          sql`case when cell_tag = 'th' then 'lexical-table-cell lexical-table-cell-header' else 'lexical-table-cell' end`,
        );
        s.defScalar("cell_html", sql.lit``);
        s.defTable(
          "cell_blocks",
          sql`select value as node from json.array_each(children_json)`,
        );
        s.forEachTable("cell_blocks", "cell_block", (s) => {
          s.setScalar(
            "cell_html",
            sql`cell_html || fn.lexical_process_block_node(
              cell_block.node,
              input.image_src_prefix,
              input.image_src_replacement
            )`,
          );
        });
        s.return(
          sql`'<' || cell_tag || ' class="' || cell_class || '">' || cell_html || '</' || cell_tag || '>'`,
        );
      });

      // Unknown block type - try processing as inline nodes
      s.defScalar(
        "children_html",
        sql`fn.lexical_process_inline_nodes(
          children_json,
          input.image_src_prefix,
          input.image_src_replacement
        )`,
      );
      s.return(sql`children_html`);
    },
  });

  // Process list items
  registrar.scalarFunction({
    name: "lexical_process_list_items",
    description: "Process list items to HTML",
    parameters: [
      { name: "children", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });

      s.return(sql`coalesce((
        select string_agg(
          fn.lexical_process_block_node(
            item.value,
            input.image_src_prefix,
            input.image_src_replacement
          ),
          '' order by item.index
        )
        from json.array_each(input.children) item
      ), '')`);
    },
  });

  // Process listitem children (which may contain nested lists)
  registrar.scalarFunction({
    name: "lexical_process_listitem_children",
    description: "Process listitem children which may include nested lists",
    parameters: [
      { name: "children", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.return(sql`coalesce((
        select string_agg(
          case when child.value ->> 'type' = 'list'
            then fn.lexical_process_block_node(
              child.value,
              input.image_src_prefix,
              input.image_src_replacement
            )
            else fn.lexical_process_inline_node(
              child.value,
              input.image_src_prefix,
              input.image_src_replacement
            )
          end,
          '' order by child.index
        )
        from json.array_each(input.children) child
      ), '')`);
    },
  });

  // Process inline nodes array (text, link, etc.)
  registrar.scalarFunction({
    name: "lexical_process_inline_nodes",
    description: "Process an array of inline nodes to HTML",
    parameters: [
      { name: "children", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("result", sql.lit``);
      s.defTable(
        "inline_nodes",
        sql`select value as node from json.array_each(input.children)`,
      );
      s.forEachTable("inline_nodes", "inline", (s) => {
        s.defScalar(
          "inline_html",
          sql`fn.lexical_process_inline_node(
            inline.node,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.setScalar("result", sql`result || inline_html`);
      });
      s.return(sql`result`);
    },
  });

  // Link children use their own walker so rendering a link cannot disturb the
  // cursor of the surrounding inline-node array. Lexical links cannot nest.
  registrar.scalarFunction({
    name: "lexical_process_link_children",
    description: "Process the non-link inline children of a link to HTML",
    parameters: [
      { name: "children", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("result", sql.lit``);
      s.defTable(
        "link_children",
        sql`select value as node from json.array_each(input.children)`,
      );
      s.forEachTable("link_children", "link_child", (s) => {
        s.defScalar(
          "child_html",
          sql`fn.lexical_process_inline_node(
            link_child.node,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.setScalar("result", sql`result || child_html`);
      });
      s.return(sql`result`);
    },
  });

  // Process a single inline node (text, link, linebreak)
  registrar.scalarFunction({
    name: "lexical_process_inline_node",
    description: "Process a single inline node to HTML",
    parameters: [
      { name: "node", type: "Json" },
      { name: "image_src_prefix", type: { type: "String", maxLength: 2000 } },
      {
        name: "image_src_replacement",
        type: { type: "String", maxLength: 4000 },
      },
    ],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.node is null`, (s) => {
        s.return(sql.lit``);
      });

      s.defScalar("node_type", sql`input.node ->> 'type'`);

      // Line break
      s.if(sql`node_type = 'linebreak'`, (s) => {
        s.return(sql.lit`<br>`);
      });

      // Tab
      s.if(sql`node_type = 'tab'`, (s) => {
        s.return(sql.lit`&emsp;`);
      });

      // Mention node — renders an inline pill with data attributes so
      // client code can attach behaviors (highlight, click, etc.).
      s.if(sql`node_type = 'mention'`, (s) => {
        s.defScalar(
          "mention_text",
          sql`string.html_escape(coalesce(input.node ->> 'text', ''))`,
        );
        s.defScalar(
          "mention_id",
          sql`string.html_escape(coalesce(input.node ->> 'mentionId', ''))`,
        );
        s.defScalar(
          "mention_trigger",
          sql`string.html_escape(coalesce(input.node ->> 'mentionTrigger', '@'))`,
        );
        s.defScalar(
          "mention_kind",
          sql`string.html_escape(coalesce(input.node ->> 'mentionKind', 'mention'))`,
        );
        s.defScalar(
          "mention_url",
          safeLexicalLinkUrl(sql`input.node ->> 'mentionUrl'`),
        );
        s.if(sql`mention_url != ''`, (s) => {
          s.return(
            sql`'<a class="lexical-mention lexical-reference" data-lexical-mention="true" data-mention-id="' || mention_id || '" data-mention-trigger="' || mention_trigger || '" data-mention-kind="' || mention_kind || '" href="' || mention_url || '">' || mention_text || '</a>'`,
          );
        });
        s.return(
          sql`'<span class="lexical-mention" data-lexical-mention="true" data-mention-id="' || mention_id || '" data-mention-trigger="' || mention_trigger || '" data-mention-kind="' || mention_kind || '">' || mention_text || '</span>'`,
        );
      });

      s.if(sql`node_type = 'video'`, (s) => {
        s.return(sql`fn.lexical_video_html(input.node)`);
      });
      s.if(sql`node_type = 'image'`, (s) => {
        s.defScalar(
          "raw_src",
          sql`coalesce(input.node ->> 'src', '')`,
        );
        s.if(
          sql`
            input.image_src_prefix is not null
            and starts_with(raw_src, input.image_src_prefix)
          `,
          (s) => {
            s.setScalar(
              "raw_src",
              sql`
                input.image_src_replacement ||
                substring(
                  raw_src
                  from length(input.image_src_prefix) + 1
                )
              `,
            );
          },
        );
        s.defScalar(
          "src",
          sql`string.html_escape(raw_src)`,
        );
        s.defScalar(
          "alt_text",
          sql`string.html_escape(coalesce(input.node ->> 'altText', ''))`,
        );
        s.defScalar(
          "width",
          sql`coalesce(cast(input.node ->> 'width' as int), 480)`,
        );
        s.defScalar(
          "align",
          sql`case
            when input.node ->> 'align' in ('left', 'center', 'right')
              then input.node ->> 'align'
            else 'center'
          end`,
        );
        s.return(
          sql`'<span class="lexical-image" style="display: block; margin: 0 0 12px 0; text-align: ' || align || ';">' ||
              '<img src="' || src || '" alt="' || alt_text || '" style="max-width: 100%; height: auto; width: ' || width || 'px;" />' ||
              '</span>'`,
        );
      });

      // Text node
      s.if(sql`node_type = 'text'`, (s) => {
        s.defScalar(
          "text_content",
          sql`string.html_escape(coalesce(input.node ->> 'text', ''))`,
        );
        s.defScalar(
          "format_flags",
          sql`coalesce(cast(input.node ->> 'format' as int), 0)`,
        );
        s.defScalar(
          "style",
          safeLexicalTextStyle(sql`input.node ->> 'style'`),
        );

        // Build style attribute from node style
        s.defScalar(
          "style_attr",
          sql`
          case when style != '' then ' style="' || style || '"' else '' end
        `,
        );

        // Apply formatting based on bit flags
        // Lexical format bits: bold=1, italic=2, strikethrough=4,
        // underline=8, code=16, subscript=32, superscript=64.
        // Using (x / bit) % 2 = 1 to check if bit is set (since bitwise AND is not supported)

        // Build opening and closing tags with classes based on format
        s.defScalar("open_tags", sql.lit``);
        s.defScalar("close_tags", sql.lit``);

        // Bold (bit 0 = 1)
        s.if(sql`(format_flags / 1) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<strong class="lexical-text-bold">'`,
          );
          s.setScalar("close_tags", sql`'</strong>' || close_tags`);
        });

        // Italic (bit 1 = 2)
        s.if(sql`(format_flags / 2) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<em class="lexical-text-italic">'`,
          );
          s.setScalar("close_tags", sql`'</em>' || close_tags`);
        });

        // Strikethrough (bit 2 = 4)
        s.if(sql`(format_flags / 4) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<s class="lexical-text-strikethrough">'`,
          );
          s.setScalar("close_tags", sql`'</s>' || close_tags`);
        });

        // Underline (bit 3 = 8)
        s.if(sql`(format_flags / 8) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<u class="lexical-text-underline">'`,
          );
          s.setScalar("close_tags", sql`'</u>' || close_tags`);
        });

        // Code (bit 4 = 16)
        s.if(sql`(format_flags / 16) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<code class="lexical-text-code">'`,
          );
          s.setScalar("close_tags", sql`'</code>' || close_tags`);
        });

        // Subscript (bit 5 = 32)
        s.if(sql`(format_flags / 32) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<sub class="lexical-text-subscript">'`,
          );
          s.setScalar("close_tags", sql`'</sub>' || close_tags`);
        });

        // Superscript (bit 6 = 64)
        s.if(sql`(format_flags / 64) % 2 = 1`, (s) => {
          s.setScalar(
            "open_tags",
            sql`open_tags || '<sup class="lexical-text-superscript">'`,
          );
          s.setScalar("close_tags", sql`'</sup>' || close_tags`);
        });

        // If there's a style attribute, wrap in a span
        s.if(sql`style_attr != ''`, (s) => {
          s.return(
            sql`'<span' || style_attr || '>' || open_tags || text_content || close_tags || '</span>'`,
          );
        });

        s.return(sql`open_tags || text_content || close_tags`);
      });

      // Link node
      s.if(sql`node_type = 'link'`, (s) => {
        s.defScalar(
          "url",
          safeLexicalLinkUrl(sql`input.node ->> 'url'`),
        );
        s.defScalar("title", sql`input.node ->> 'title'`);
        s.defScalar("target", sql`input.node ->> 'target'`);
        s.defScalar("rel", sql`input.node ->> 'rel'`);

        // Process link children (usually text nodes)
        s.defScalar("link_children", sql`input.node -> 'children'`);
        s.defScalar(
          "link_content",
          sql`fn.lexical_process_link_children(
            link_children,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.if(sql`url = ''`, (s) => s.return(sql`link_content`));

        // Build attributes with class
        s.defScalar("attrs", sql`' class="lexical-link" href="' || url || '"'`);
        s.if(sql`title is not null and title != ''`, (s) => {
          s.setScalar(
            "attrs",
            sql`attrs || ' title="' || string.html_escape(title) || '"'`,
          );
        });
        s.if(sql`target is not null and target != ''`, (s) => {
          s.setScalar(
            "attrs",
            sql`attrs || ' target="' || string.html_escape(target) || '"'`,
          );
        });
        s.if(sql`rel is not null and rel != ''`, (s) => {
          s.setScalar(
            "attrs",
            sql`attrs || ' rel="' || string.html_escape(rel) || '"'`,
          );
        });

        s.return(sql`'<a' || attrs || '>' || link_content || '</a>'`);
      });

      // Auto-link node (similar to link)
      s.if(sql`node_type = 'autolink'`, (s) => {
        s.defScalar(
          "url",
          safeLexicalLinkUrl(sql`input.node ->> 'url'`),
        );
        s.defScalar("link_children", sql`input.node -> 'children'`);
        s.defScalar(
          "link_content",
          sql`fn.lexical_process_link_children(
            link_children,
            input.image_src_prefix,
            input.image_src_replacement
          )`,
        );
        s.if(sql`url = ''`, (s) => s.return(sql`link_content`));
        s.return(
          sql`'<a class="lexical-link" href="' || url || '">' || link_content || '</a>'`,
        );
      });

      // Unknown type - return empty
      s.return(sql.lit``);
    },
  });

  // ============================================
  // MARKDOWN VERSION
  // Converts Lexical rich text to CommonMark, for rendering to PDF via the
  // platform `#markdown(..)` Typst function. Emits only the round-trippable
  // subset (headings, bold/italic/strike/code, links, lists, quote, code);
  // underline/sub/superscript/tables have no CommonMark equivalent and are
  // dropped. Images retain their alt text and source URL.
  // ============================================

  registrar.scalarFunction({
    name: "lexical_rich_text_to_markdown",
    description: "Convert Lexical rich text to CommonMark markdown",
    parameters: [{ name: "rich_text", type: "Json" }],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.if(sql`input.rich_text is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });
      s.defScalar(
        "root_children",
        sql`input.rich_text -> 'root' -> 'children'`,
      );
      s.if(sql`root_children is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });

      s.defScalar("result", sql.lit``);
      s.defTable(
        "md_blocks",
        sql`select value as node from json.array_each(root_children)`,
      );
      s.forEachTable("md_blocks", "block", (s: BasicStatements) => {
        s.defScalar("block_md", sql`fn.lexical_block_to_markdown(block.node)`);
        // Skip empty blocks so we don't accumulate stray blank lines.
        s.if(sql`block_md != ''`, (s: BasicStatements) => {
          s.setScalar(
            "result",
            sql`case when result = '' then block_md else result || e'\n\n' || block_md end`,
          );
        });
      });
      s.return(sql`result`);
    },
  });

  // Escape CommonMark punctuation in a text run so it renders literally.
  // Backslash MUST be replaced first so the escapes we add are not re-escaped.
  registrar.scalarFunction({
    name: "lexical_md_escape",
    description: "Escape markdown punctuation in a text run",
    parameters: [{ name: "text", type: "String" }],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.return(
        sql`replace(replace(replace(replace(replace(replace(replace(replace(replace(
          coalesce(input.text, ''),
          '\\', '\\\\'),
          '\`', '\\\`'),
          '*', '\\*'),
          '_', '\\_'),
          '[', '\\['),
          ']', '\\]'),
          '#', '\\#'),
          '<', '\\<'),
          '~', '\\~')`,
      );
    },
  });

  // Dispatch a block node to its markdown form.
  registrar.scalarFunction({
    name: "lexical_block_to_markdown",
    description: "Convert a Lexical block node to markdown",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.if(sql`input.node is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });
      s.defScalar("node_type", sql`input.node ->> 'type'`);
      s.defScalar("children", sql`input.node -> 'children'`);

      s.if(sql`node_type = 'video'`, (s) => {
        s.return(
          sql`'[Watch video](' || coalesce(input.node->>'url', '') || ')'`,
        );
      });
      s.if(sql`node_type = 'image'`, (s: BasicStatements) => {
        s.defScalar(
          "image_alt",
          sql`fn.lexical_md_escape(
            coalesce(nullif(input.node ->> 'altText', ''), 'Image')
          )`,
        );
        s.defScalar("image_src", sql`coalesce(input.node ->> 'src', '')`);
        s.return(sql`'![' || image_alt || '](' || image_src || ')'`);
      });

      s.if(sql`node_type = 'paragraph'`, (s: BasicStatements) => {
        s.defScalar(
          "paragraph_md",
          sql`fn.lexical_inlines_to_markdown(children)`,
        );
        s.return(
          sql`case when paragraph_md = '' then chr(8203) else paragraph_md end`,
        );
      });

      s.if(sql`node_type = 'heading'`, (s: BasicStatements) => {
        s.defScalar("tag", sql`coalesce(input.node ->> 'tag', 'h1')`);
        s.defScalar(
          "hashes",
          sql`case tag
            when 'h1' then '#'
            when 'h2' then '##'
            when 'h3' then '###'
            when 'h4' then '####'
            when 'h5' then '#####'
            when 'h6' then '######'
            else '#'
          end`,
        );
        s.return(
          sql`hashes || ' ' || fn.lexical_inlines_to_markdown(children)`,
        );
      });

      s.if(sql`node_type = 'quote'`, (s: BasicStatements) => {
        s.return(sql`'> ' || fn.lexical_inlines_to_markdown(children)`);
      });

      s.if(sql`node_type = 'list'`, (s: BasicStatements) => {
        s.return(sql`fn.lexical_list_to_markdown(input.node)`);
      });

      s.if(sql`node_type = 'table'`, (s: BasicStatements) => {
        s.defScalar("table_md", sql.lit``);
        s.defTable(
          "md_table_rows",
          sql`select value as node, index as idx from json.array_each(children)`,
        );
        s.forEachTable("md_table_rows", "tr", (s: BasicStatements) => {
          s.defScalar("row_md", sql.lit`|`);
          s.defScalar("row_cell_count", sql`0`);
          s.defTable(
            "md_table_cells",
            sql`select value as node from json.array_each(tr.node -> 'children')`,
          );
          s.forEachTable("md_table_cells", "td", (s: BasicStatements) => {
            s.defScalar(
              "cell_md",
              sql`coalesce((
                select string_agg(
                  fn.lexical_inlines_to_markdown(value -> 'children'), '<br>'
                )
                from json.array_each(td.node -> 'children')
              ), '')`,
            );
            s.setScalar(
              "row_md",
              sql`row_md || ' ' || replace(replace(cell_md, e'\n', ' '),
                '|', chr(92) || '|') || ' |'`,
            );
            s.setScalar("row_cell_count", sql`row_cell_count + 1`);
          });
          s.setScalar(
            "table_md",
            sql`case when table_md = '' then row_md
              else table_md || e'\n' || row_md end`,
          );
          s.if(sql`tr.idx = 0`, (s: BasicStatements) => {
            s.setScalar(
              "table_md",
              sql`table_md || e'\n|' || repeat(' --- |', row_cell_count)`,
            );
          });
        });
        s.return(sql`table_md`);
      });

      s.if(sql`node_type = 'code'`, (s: BasicStatements) => {
        s.defScalar("code_text", sql.lit``);
        s.defTable(
          "code_children",
          sql`select value as node from json.array_each(children)`,
        );
        s.forEachTable("code_children", "c", (s: BasicStatements) => {
          s.if(sql`c.node ->> 'type' = 'linebreak'`, (s: BasicStatements) => {
            s.setScalar("code_text", sql`code_text || e'\n'`);
          }, (s: BasicStatements) => {
            s.setScalar(
              "code_text",
              sql`code_text || coalesce(c.node ->> 'text', '')`,
            );
          });
        });
        s.return(sql`'\`\`\`' || e'\n' || code_text || e'\n' || '\`\`\`'`);
      });

      // Unknown block: best-effort inline rendering of its children.
      s.return(sql`fn.lexical_inlines_to_markdown(children)`);
    },
  });

  // Render an array of inline nodes to markdown.
  registrar.scalarFunction({
    name: "lexical_inlines_to_markdown",
    description: "Convert an array of Lexical inline nodes to markdown",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.if(sql`input.children is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });
      s.defScalar("result", sql.lit``);
      s.defScalar("pending_text", sql.lit``);
      s.defScalar("pending_flags", sql`0`);
      s.defScalar("pending_text_active", sql`false`);
      s.defTable(
        "inline_nodes",
        sql`select value as node from json.array_each(input.children)`,
      );
      s.forEachTable("inline_nodes", "n", (s: BasicStatements) => {
        s.if(
          sql`n.node ->> 'type' = 'text'`,
          (s: BasicStatements) => {
            s.defScalar(
              "raw_node_flags",
              sql`coalesce(cast(n.node ->> 'format' as int), 0)`,
            );
            // Styles and unsupported format bits do not exist in Markdown.
            // Merge adjacent runs whose emitted formatting is therefore the
            // same before adding delimiters around the combined text.
            s.defScalar(
              "node_markdown_flags",
              sql`
                case when (raw_node_flags / 1) % 2 = 1 then 1 else 0 end
                + case when (raw_node_flags / 2) % 2 = 1 then 2 else 0 end
                + case when (raw_node_flags / 4) % 2 = 1 then 4 else 0 end
                + case when (raw_node_flags / 16) % 2 = 1 then 16 else 0 end
              `,
            );
            s.if(
              sql`pending_text_active
                and pending_flags = node_markdown_flags`,
              (s: BasicStatements) => {
                s.setScalar(
                  "pending_text",
                  sql`pending_text || coalesce(n.node ->> 'text', '')`,
                );
              },
              (s: BasicStatements) => {
                s.if(sql`pending_text_active`, (s: BasicStatements) => {
                  s.setScalar(
                    "result",
                    sql`result || fn.lexical_inline_to_markdown(
                      json_build_object(
                        'type', 'text',
                        'text', pending_text,
                        'format', pending_flags
                      )
                    )`,
                  );
                });
                s.setScalar(
                  "pending_text",
                  sql`coalesce(n.node ->> 'text', '')`,
                );
                s.setScalar("pending_flags", sql`node_markdown_flags`);
                s.setScalar("pending_text_active", sql`true`);
              },
            );
          },
          (s: BasicStatements) => {
            s.if(sql`pending_text_active`, (s: BasicStatements) => {
              s.setScalar(
                "result",
                sql`result || fn.lexical_inline_to_markdown(
                  json_build_object(
                    'type', 'text',
                    'text', pending_text,
                    'format', pending_flags
                  )
                )`,
              );
              s.setScalar("pending_text", sql.lit``);
              s.setScalar("pending_flags", sql`0`);
              s.setScalar("pending_text_active", sql`false`);
            });
            s.setScalar(
              "result",
              sql`result || fn.lexical_inline_to_markdown(n.node)`,
            );
          },
        );
      });
      s.if(sql`pending_text_active`, (s: BasicStatements) => {
        s.setScalar(
          "result",
          sql`result || fn.lexical_inline_to_markdown(
            json_build_object(
              'type', 'text',
              'text', pending_text,
              'format', pending_flags
            )
          )`,
        );
      });
      s.return(sql`result`);
    },
  });

  // Render a single inline node to markdown.
  registrar.scalarFunction({
    name: "lexical_inline_to_markdown",
    description: "Convert a single Lexical inline node to markdown",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.if(sql`input.node is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });
      s.defScalar("node_type", sql`input.node ->> 'type'`);

      // Hard line break: two trailing spaces + newline (CommonMark). Keep the
      // following line non-empty so consecutive linebreak nodes are not
      // collapsed into a paragraph boundary by the CommonMark parser.
      s.if(sql`node_type = 'linebreak'`, (s: BasicStatements) => {
        s.return(sql`'  ' || e'\n' || chr(8203)`);
      });
      s.if(sql`node_type = 'tab'`, (s: BasicStatements) => {
        s.return(sql`' '`);
      });

      s.if(sql`node_type = 'text'`, (s: BasicStatements) => {
        s.defScalar("raw_text", sql`coalesce(input.node ->> 'text', '')`);
        s.defScalar(
          "flags",
          sql`coalesce(cast(input.node ->> 'format' as int), 0)`,
        );
        // CommonMark delimiters cannot open next to leading whitespace or
        // close next to trailing whitespace. Keep that whitespace outside the
        // delimiters so pasted runs such as bold "Payment Terms: " remain
        // formatted instead of rendering their ** markers literally.
        s.defScalar("trimmed_text", sql`trim(raw_text)`);
        s.if(sql`trimmed_text = ''`, (s: BasicStatements) => {
          s.return(sql`fn.lexical_md_escape(raw_text)`);
        });
        s.defScalar(
          "leading_whitespace",
          sql`substring(raw_text, 1, length(raw_text) - length(ltrim(raw_text)))`,
        );
        s.defScalar(
          "trailing_whitespace",
          sql`substring(raw_text, length(rtrim(raw_text)) + 1)`,
        );
        s.if(
          sql`(flags / 1) % 2 = 0
            and (flags / 2) % 2 = 0
            and (flags / 4) % 2 = 0
            and (flags / 16) % 2 = 0`,
          (s: BasicStatements) => {
            s.return(
              sql`leading_whitespace
                || fn.lexical_md_escape(trimmed_text)
                || trailing_whitespace`,
            );
          },
        );
        // CommonMark emphasis cannot open on a slash immediately following a
        // word (for example: 8**/05/2026**). Keep a leading date slash outside
        // the delimiters; the visible text stays exact while the formatting is
        // valid for the substantive text.
        s.defScalar(
          "leading_punctuation",
          sql`coalesce(
            regex.capture(trimmed_text, '^(/+)', 1),
            ''
          )`,
        );
        s.defScalar(
          "without_leading_punctuation",
          sql`substring(trimmed_text, length(leading_punctuation) + 1)`,
        );
        s.defScalar("formatted_text", sql`without_leading_punctuation`);
        s.if(sql`formatted_text = ''`, (s: BasicStatements) => {
          s.return(sql`fn.lexical_md_escape(raw_text)`);
        });
        // Lexical format bits: bold=1, italic=2, strikethrough=4, underline=8,
        // code=16, subscript=32, superscript=64. Yolm SQL has no bitwise AND,
        // so test with (flags / bit) % 2 = 1. Underline/sub/superscript have no
        // markdown equivalent and are dropped.
        //
        // Code is innermost: its content is kept verbatim (no markdown escape).
        s.defScalar(
          "content",
          sql`case
            when (flags / 16) % 2 = 1 then '\`' || formatted_text || '\`'
            else fn.lexical_md_escape(formatted_text)
          end`,
        );
        s.if(sql`(flags / 4) % 2 = 1`, (s: BasicStatements) => {
          s.setScalar("content", sql`'~~' || content || '~~'`);
        });
        s.if(sql`(flags / 2) % 2 = 1`, (s: BasicStatements) => {
          s.setScalar("content", sql`'_' || content || '_'`);
        });
        s.if(sql`(flags / 1) % 2 = 1`, (s: BasicStatements) => {
          s.setScalar("content", sql`'**' || content || '**'`);
        });
        s.return(
          sql`leading_whitespace
            || fn.lexical_md_escape(leading_punctuation)
            || content
            || trailing_whitespace`,
        );
      });

      s.if(
        sql`node_type = 'link' or node_type = 'autolink'`,
        (s: BasicStatements) => {
          s.defScalar("url", sql`coalesce(input.node ->> 'url', '')`);
          s.defScalar(
            "label",
            sql`fn.lexical_inlines_to_markdown(input.node -> 'children')`,
          );
          s.return(sql`'[' || label || '](' || url || ')'`);
        },
      );

      s.if(sql`node_type = 'mention'`, (s: BasicStatements) => {
        s.defScalar(
          "mention_label",
          sql`fn.lexical_md_escape(coalesce(input.node ->> 'text', ''))`,
        );
        s.defScalar(
          "mention_url",
          sql`coalesce(input.node ->> 'mentionUrl', '')`,
        );
        s.if(sql`mention_url != ''`, (s: BasicStatements) => {
          s.return(sql`'[' || mention_label || '](' || mention_url || ')'`);
        });
        s.return(sql`mention_label`);
      });

      // Unknown inline types are dropped.
      s.return(sql.lit``);
    },
  });

  // Render a list node (bullet or ordered) to markdown.
  registrar.scalarFunction({
    name: "lexical_list_to_markdown",
    description: "Convert a Lexical list node to markdown",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.if(sql`input.node is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });
      s.defScalar("ordered", sql`input.node ->> 'listType' = 'number'`);
      s.defScalar(
        "start",
        sql`coalesce(cast(input.node ->> 'start' as int), 1)`,
      );
      s.defScalar("result", sql.lit``);
      s.defTable(
        "list_items",
        sql`select value as node, index as idx from json.array_each(input.node -> 'children')`,
      );
      s.forEachTable("list_items", "li", (s: BasicStatements) => {
        s.defScalar(
          "marker",
          sql`case when ordered then cast((start + li.idx) as string) || '. ' else '- ' end`,
        );
        s.defScalar(
          "item_md",
          sql`fn.lexical_listitem_to_markdown(li.node, marker)`,
        );
        s.if(sql`item_md != ''`, (s: BasicStatements) => {
          s.setScalar(
            "result",
            sql`case when result = '' then item_md else result || e'\n' || item_md end`,
          );
        });
      });
      s.return(sql`result`);
    },
  });

  // Render a single list item. A nested list is indented two spaces per level;
  // a wrapper item (one whose only child is a nested list) emits just the
  // nested list with no marker line.
  registrar.scalarFunction({
    name: "lexical_listitem_to_markdown",
    description: "Convert a Lexical listitem node to markdown",
    parameters: [
      { name: "node", type: "Json" },
      { name: "marker", type: "String" },
    ],
    returnType: "String",
    procedure: (s: BasicStatements) => {
      s.if(sql`input.node is null`, (s: BasicStatements) => {
        s.return(sql.lit``);
      });
      s.defScalar("inline_md", sql.lit``);
      s.defScalar("nested_md", sql.lit``);
      s.defTable(
        "li_children",
        sql`select value as node from json.array_each(input.node -> 'children')`,
      );
      s.forEachTable("li_children", "child", (s: BasicStatements) => {
        s.if(sql`child.node ->> 'type' = 'list'`, (s: BasicStatements) => {
          s.defScalar(
            "nested_raw",
            sql`fn.lexical_list_to_markdown(child.node)`,
          );
          s.if(sql`nested_raw != ''`, (s: BasicStatements) => {
            s.defScalar(
              "nested_indented",
              sql`'  ' || replace(nested_raw, e'\n', e'\n  ')`,
            );
            s.setScalar(
              "nested_md",
              sql`case when nested_md = '' then nested_indented else nested_md || e'\n' || nested_indented end`,
            );
          });
        }, (s: BasicStatements) => {
          s.setScalar(
            "inline_md",
            sql`inline_md || fn.lexical_inline_to_markdown(child.node)`,
          );
        });
      });
      // Wrapper item: only nested content, no marker line.
      s.if(sql`inline_md = '' and nested_md != ''`, (s: BasicStatements) => {
        s.return(sql`nested_md`);
      });
      s.if(sql`nested_md = ''`, (s: BasicStatements) => {
        s.return(sql`input.marker || inline_md`);
      });
      s.return(sql`input.marker || inline_md || e'\n' || nested_md`);
    },
  });

  // ============================================
  // EMAIL VERSIONS (with inline styles)
  // ============================================

  // Process a block-level node for email (with inline styles)
  registrar.scalarFunction({
    name: "lexical_process_block_node_email",
    description:
      "Process a Lexical block node to HTML with inline styles for email",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.node is null`, (s) => {
        s.return(sql.lit``);
      });

      s.defScalar("node_type", sql`input.node ->> 'type'`);
      s.defScalar("children_json", sql`input.node -> 'children'`);

      // Get alignment/format for block elements
      s.defScalar("format", sql`coalesce(input.node ->> 'format', '')`);

      // Handle indent
      s.defScalar(
        "indent",
        sql`coalesce(cast(input.node ->> 'indent' as int), 0)`,
      );

      // Build base style with alignment and indent
      s.defScalar(
        "align_style",
        sql`
        case
          when format = 'center' then 'text-align: center; '
          when format = 'right' then 'text-align: right; '
          when format = 'justify' then 'text-align: justify; '
          else ''
        end
      `,
      );
      s.defScalar(
        "indent_style",
        sql`case when indent > 0 then 'margin-left: ' || (indent * 40) || 'px; ' else '' end`,
      );

      s.if(sql`node_type = 'video'`, (s) => {
        s.return(sql`fn.lexical_video_html(input.node)`);
      });
      s.if(sql`node_type = 'image'`, (s) => {
        s.defScalar(
          "src",
          sql`string.html_escape(coalesce(input.node ->> 'src', ''))`,
        );
        s.defScalar(
          "alt_text",
          sql`string.html_escape(coalesce(input.node ->> 'altText', ''))`,
        );
        s.defScalar(
          "width",
          sql`coalesce(cast(input.node ->> 'width' as int), 480)`,
        );
        s.defScalar(
          "align",
          sql`case
            when input.node ->> 'align' in ('left', 'center', 'right')
              then input.node ->> 'align'
            else 'center'
          end`,
        );
        s.return(
          sql`'<div style="box-sizing: border-box; margin: 0 0 12px 0; text-align: ' || align || ';">' ||
              '<img src="' || src || '" alt="' || alt_text || '" style="max-width: 100%; height: auto; width: ' || width || 'px;" />' ||
              '</div>'`,
        );
      });

      // Paragraph - inline styles: margin: 0 0 0.5em 0;
      s.if(sql`node_type = 'paragraph'`, (s) => {
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes_email(children_json)`,
        );
        s.defScalar(
          "p_style",
          sql`'box-sizing: border-box; margin: 0 0 0.5em 0; ' || align_style || indent_style`,
        );
        s.return(
          sql`'<p style="' || p_style || '">' || children_html || '</p>'`,
        );
      });

      // Heading - inline styles based on tag
      s.if(sql`node_type = 'heading'`, (s) => {
        s.defScalar(
          "tag",
          sql`case
            when input.node ->> 'tag' in ('h1','h2','h3','h4','h5','h6')
              then input.node ->> 'tag'
            else 'h1'
          end`,
        );
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes_email(children_json)`,
        );
        s.defScalar(
          "heading_style",
          sql`
          'box-sizing: border-box; font-weight: bold; line-height: 1.2; margin-bottom: 0.5em; ' ||
          case tag
            when 'h1' then 'font-size: 2em; '
            when 'h2' then 'font-size: 1.5em; '
            when 'h3' then 'font-size: 1.17em; '
            when 'h4' then 'font-size: 1em; '
            when 'h5' then 'font-size: 0.83em; '
            when 'h6' then 'font-size: 0.67em; '
            else 'font-size: 2em; '
          end || align_style || indent_style
        `,
        );
        s.return(
          sql`'<' || tag || ' style="' || heading_style || '">' || children_html || '</' || tag || '>'`,
        );
      });

      // Quote - inline styles: border-left, margin, padding
      s.if(sql`node_type = 'quote'`, (s) => {
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes_email(children_json)`,
        );
        s.defScalar(
          "quote_style",
          sql`'box-sizing: border-box; border: 0 solid; border-left-width: 0.3em; border-color: #ccc; margin-left: 0.3em; padding-left: 0.6em; margin-bottom: 0.5em; ' || align_style || indent_style`,
        );
        s.return(
          sql`'<blockquote style="' || quote_style || '">' || children_html || '</blockquote>'`,
        );
      });

      // List - inline styles for ol/ul
      s.if(sql`node_type = 'list'`, (s) => {
        s.defScalar("list_type", sql`input.node ->> 'listType'`);
        s.defScalar(
          "list_tag",
          sql`case when list_type = 'number' then 'ol' else 'ul' end`,
        );
        s.defScalar(
          "list_style",
          sql`'box-sizing: border-box; margin: 0 0 0.5em 0; padding-left: 1.5em; ' ||
          case when list_type = 'number' then 'list-style-type: decimal; ' else 'list-style-type: disc; ' end`,
        );
        s.defScalar(
          "list_children_html",
          sql`fn.lexical_process_list_items_email(children_json)`,
        );
        s.return(
          sql`'<' || list_tag || ' style="' || list_style || '">' || list_children_html || '</' || list_tag || '>'`,
        );
      });

      // Listitem - inline styles
      s.if(sql`node_type = 'listitem'`, (s) => {
        s.defScalar(
          "li_style",
          sql.lit`box-sizing: border-box; margin: 0; margin-left: 1em;`,
        );
        // Check if this listitem contains a nested list
        s.defScalar(
          "has_nested_list",
          sql`
          exists(
            select 1 from json.array_each(children_json)
            where value ->> 'type' = 'list'
          )
        `,
        );
        s.if(sql`has_nested_list`, (s) => {
          // Process mixed content (text + nested list)
          s.defScalar(
            "li_content",
            sql`fn.lexical_process_listitem_children_email(children_json)`,
          );
          s.return(
            sql`'<li style="' || li_style || '">' || li_content || '</li>'`,
          );
        });
        // Normal listitem - children are inline nodes
        s.defScalar(
          "children_html",
          sql`fn.lexical_process_inline_nodes_email(children_json)`,
        );
        s.return(
          sql`'<li style="' || li_style || '">' || children_html || '</li>'`,
        );
      });

      // Unknown block type - try processing as inline nodes
      s.defScalar(
        "children_html",
        sql`fn.lexical_process_inline_nodes_email(children_json)`,
      );
      s.return(sql`children_html`);
    },
  });

  // Process list items for email
  registrar.scalarFunction({
    name: "lexical_process_list_items_email",
    description: "Process list items to HTML with inline styles for email",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });

      s.return(sql`coalesce((
        select string_agg(
          fn.lexical_process_block_node_email(item.value),
          '' order by item.index
        )
        from json.array_each(input.children) item
      ), '')`);
    },
  });

  // Process listitem children for email (which may contain nested lists)
  registrar.scalarFunction({
    name: "lexical_process_listitem_children_email",
    description: "Process listitem children with inline styles for email",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.return(sql`coalesce((
        select string_agg(
          case when child.value ->> 'type' = 'list'
            then fn.lexical_process_block_node_email(child.value)
            else fn.lexical_process_inline_node_email(child.value)
          end,
          '' order by child.index
        )
        from json.array_each(input.children) child
      ), '')`);
    },
  });

  // Process inline nodes array for email
  registrar.scalarFunction({
    name: "lexical_process_inline_nodes_email",
    description:
      "Process an array of inline nodes to HTML with inline styles for email",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("result", sql.lit``);
      s.defTable(
        "inline_nodes",
        sql`select value as node from json.array_each(input.children)`,
      );
      s.forEachTable("inline_nodes", "inline", (s) => {
        s.defScalar(
          "inline_html",
          sql`fn.lexical_process_inline_node_email(inline.node)`,
        );
        s.setScalar("result", sql`result || inline_html`);
      });
      s.return(sql`result`);
    },
  });

  registrar.scalarFunction({
    name: "lexical_process_link_children_email",
    description:
      "Process the non-link inline children of a link to email-safe HTML",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("result", sql.lit``);
      s.defTable(
        "link_children",
        sql`select value as node from json.array_each(input.children)`,
      );
      s.forEachTable("link_children", "link_child", (s) => {
        s.defScalar(
          "child_html",
          sql`fn.lexical_process_inline_node_email(link_child.node)`,
        );
        s.setScalar("result", sql`result || child_html`);
      });
      s.return(sql`result`);
    },
  });

  // Process a single inline node for email (with inline styles)
  registrar.scalarFunction({
    name: "lexical_process_inline_node_email",
    description:
      "Process a single inline node to HTML with inline styles for email",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.node is null`, (s) => {
        s.return(sql.lit``);
      });

      s.defScalar("node_type", sql`input.node ->> 'type'`);

      // Line break
      s.if(sql`node_type = 'linebreak'`, (s) => {
        s.return(sql.lit`<br>`);
      });

      // Tab
      s.if(sql`node_type = 'tab'`, (s) => {
        s.return(sql.lit`&emsp;`);
      });

      // Mention node — email-safe inline-styled pill.
      s.if(sql`node_type = 'mention'`, (s) => {
        s.defScalar(
          "mention_text",
          sql`string.html_escape(coalesce(input.node ->> 'text', ''))`,
        );
        s.defScalar(
          "mention_id",
          sql`string.html_escape(coalesce(input.node ->> 'mentionId', ''))`,
        );
        s.defScalar(
          "mention_url",
          safeLexicalLinkUrl(sql`input.node ->> 'mentionUrl'`),
        );
        s.if(sql`mention_url != ''`, (s) => {
          s.return(
            sql`'<a href="' || mention_url || '" style="display: inline-block; color: #2451b7; font-weight: 500; text-decoration: underline;">' || mention_text || '</a>'`,
          );
        });
        s.return(
          sql`'<span data-mention-id="' || mention_id || '" style="display: inline-block; background-color: #e0eaff; color: #2451b7; border-radius: 4px; padding: 0 0.25rem; font-weight: 500;">' || mention_text || '</span>'`,
        );
      });

      s.if(sql`node_type = 'video'`, (s) => {
        s.return(sql`fn.lexical_video_html(input.node)`);
      });
      s.if(sql`node_type = 'image'`, (s) => {
        s.defScalar(
          "src",
          sql`string.html_escape(coalesce(input.node ->> 'src', ''))`,
        );
        s.defScalar(
          "alt_text",
          sql`string.html_escape(coalesce(input.node ->> 'altText', ''))`,
        );
        s.defScalar(
          "width",
          sql`coalesce(cast(input.node ->> 'width' as int), 480)`,
        );
        s.defScalar(
          "align",
          sql`case
            when input.node ->> 'align' in ('left', 'center', 'right')
              then input.node ->> 'align'
            else 'center'
          end`,
        );
        s.return(
          sql`'<span style="display: block; box-sizing: border-box; margin: 0 0 12px 0; text-align: ' || align || ';">' ||
              '<img src="' || src || '" alt="' || alt_text || '" style="max-width: 100%; height: auto; width: ' || width || 'px;" />' ||
              '</span>'`,
        );
      });

      // Text node - apply inline styles for formatting
      s.if(sql`node_type = 'text'`, (s) => {
        s.defScalar(
          "text_content",
          sql`string.html_escape(coalesce(input.node ->> 'text', ''))`,
        );
        s.defScalar(
          "format_flags",
          sql`coalesce(cast(input.node ->> 'format' as int), 0)`,
        );
        s.defScalar(
          "node_style",
          safeLexicalTextStyle(sql`input.node ->> 'style'`),
        );

        // Build inline style string based on format flags
        s.defScalar("inline_style", sql`node_style`);

        // Bold (bit 0 = 1) - font-weight: bold
        s.if(sql`(format_flags / 1) % 2 = 1`, (s) => {
          // Google Docs can set the semantic bold bit on an outer wrapper
          // while using an explicit 400/700 weight on each text run. Keep the
          // explicit run style last so normal and bold text remain distinct.
          s.setScalar(
            "inline_style",
            sql`case when inline_style = '' then 'font-weight: bold;' else 'font-weight: bold; ' || inline_style end`,
          );
        });

        // Italic (bit 1 = 2) - font-style: italic
        s.if(sql`(format_flags / 2) % 2 = 1`, (s) => {
          s.setScalar(
            "inline_style",
            sql`case when inline_style = '' then 'font-style: italic;' else 'font-style: italic; ' || inline_style end`,
          );
        });

        // Keep underline and strikethrough in one declaration so they do not
        // override each other when both format bits are set.
        s.if(
          sql`(format_flags / 4) % 2 = 1 or (format_flags / 8) % 2 = 1`,
          (s) => {
            s.defScalar(
              "format_text_decoration",
              sql`case
                when (format_flags / 4) % 2 = 1
                  and (format_flags / 8) % 2 = 1
                  then 'underline line-through'
                when (format_flags / 4) % 2 = 1 then 'line-through'
                else 'underline'
              end`,
            );
            s.setScalar(
              "inline_style",
              sql`case
                when inline_style = ''
                  then 'text-decoration: ' || format_text_decoration || ';'
                else 'text-decoration: ' || format_text_decoration || '; ' || inline_style
              end`,
            );
          },
        );

        // Code (bit 4 = 16) - font-family: monospace
        s.if(sql`(format_flags / 16) % 2 = 1`, (s) => {
          s.setScalar(
            "inline_style",
            sql`case when inline_style = '' then 'font-family: monospace;' else 'font-family: monospace; ' || inline_style end`,
          );
        });

        // Subscript (bit 5 = 32) - font-size: 0.8em; vertical-align: sub
        s.if(sql`(format_flags / 32) % 2 = 1`, (s) => {
          s.setScalar(
            "inline_style",
            sql`case when inline_style = '' then 'font-size: 0.8em; vertical-align: sub;' else inline_style || ' font-size: 0.8em; vertical-align: sub;' end`,
          );
        });

        // Superscript (bit 6 = 64) - font-size: 0.8em; vertical-align: super
        s.if(sql`(format_flags / 64) % 2 = 1`, (s) => {
          s.setScalar(
            "inline_style",
            sql`case when inline_style = '' then 'font-size: 0.8em; vertical-align: super;' else inline_style || ' font-size: 0.8em; vertical-align: super;' end`,
          );
        });

        // If there are styles, wrap in a span
        s.if(sql`inline_style != ''`, (s) => {
          s.return(
            sql`'<span style="' || inline_style || '">' || text_content || '</span>'`,
          );
        });

        s.return(sql`text_content`);
      });

      // Link node - inline styles: color: #0066cc; text-decoration: underline
      s.if(sql`node_type = 'link'`, (s) => {
        s.defScalar(
          "url",
          safeLexicalLinkUrl(sql`input.node ->> 'url'`),
        );
        s.defScalar("title", sql`input.node ->> 'title'`);
        s.defScalar("target", sql`input.node ->> 'target'`);
        s.defScalar("rel", sql`input.node ->> 'rel'`);

        // Process link children (usually text nodes)
        s.defScalar("link_children", sql`input.node -> 'children'`);
        s.defScalar(
          "link_content",
          sql`fn.lexical_process_link_children_email(link_children)`,
        );
        s.if(sql`url = ''`, (s) => s.return(sql`link_content`));

        // Build attributes with inline style
        s.defScalar(
          "attrs",
          sql`' href="' || url || '" style="color: #0066cc; text-decoration: underline;"'`,
        );
        s.if(sql`title is not null and title != ''`, (s) => {
          s.setScalar(
            "attrs",
            sql`attrs || ' title="' || string.html_escape(title) || '"'`,
          );
        });
        s.if(sql`target is not null and target != ''`, (s) => {
          s.setScalar(
            "attrs",
            sql`attrs || ' target="' || string.html_escape(target) || '"'`,
          );
        });
        s.if(sql`rel is not null and rel != ''`, (s) => {
          s.setScalar(
            "attrs",
            sql`attrs || ' rel="' || string.html_escape(rel) || '"'`,
          );
        });

        s.return(sql`'<a' || attrs || '>' || link_content || '</a>'`);
      });

      // Auto-link node (similar to link)
      s.if(sql`node_type = 'autolink'`, (s) => {
        s.defScalar(
          "url",
          safeLexicalLinkUrl(sql`input.node ->> 'url'`),
        );
        s.defScalar("link_children", sql`input.node -> 'children'`);
        s.defScalar(
          "link_content",
          sql`fn.lexical_process_link_children_email(link_children)`,
        );
        s.if(sql`url = ''`, (s) => s.return(sql`link_content`));
        s.return(
          sql`'<a href="' || url || '" style="color: #0066cc; text-decoration: underline;">' || link_content || '</a>'`,
        );
      });

      // Unknown type - return empty
      s.return(sql.lit``);
    },
  });

  // ============================================
  // PLAIN TEXT
  // ============================================

  registrar.scalarFunction({
    name: "lexical_link_children_to_plain_text",
    description: "Concatenate the non-link inline children of a link",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.return(sql`coalesce((
        select string_agg(
          case child.value ->> 'type'
            when 'text' then coalesce(child.value ->> 'text', '')
            when 'mention' then coalesce(child.value ->> 'text', '')
            when 'image' then coalesce(
              nullif(child.value ->> 'altText', ''),
              '[Image]'
            )
            when 'linebreak' then e'\n'
            when 'tab' then e'\t'
            else ''
          end,
          '' order by child.index
        )
        from json.array_each(input.children) child
      ), '')`);
    },
  });

  registrar.scalarFunction({
    name: "lexical_inline_node_to_plain_text",
    description: "Convert one Lexical inline node to plain text",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.node is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("ntype", sql`input.node ->> 'type'`);
      s.if(sql`ntype in ('text', 'mention')`, (s) => {
        s.return(sql`coalesce(input.node ->> 'text', '')`);
      });
      s.if(sql`ntype = 'image'`, (s) => {
        s.return(
          sql`coalesce(nullif(input.node ->> 'altText', ''), '[Image]')`,
        );
      });
      s.if(sql`ntype = 'linebreak'`, (s) => s.return(sql`e'\n'`));
      s.if(sql`ntype = 'tab'`, (s) => s.return(sql`e'\t'`));
      s.if(sql`ntype in ('link', 'autolink')`, (s) => {
        s.return(
          sql`fn.lexical_link_children_to_plain_text(input.node -> 'children')`,
        );
      });
      s.return(sql.lit``);
    },
  });

  // Walks an array of inline nodes (text, link, autolink, linebreak, tab)
  // and concatenates their textual content.
  registrar.scalarFunction({
    name: "lexical_inline_nodes_to_plain_text",
    description: "Concatenate plain text from an array of Lexical inline nodes",
    parameters: [{ name: "children", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.return(sql`coalesce((
        select string_agg(
          fn.lexical_inline_node_to_plain_text(inline.value),
          '' order by inline.index
        )
        from json.array_each(input.children) inline
      ), '')`);
    },
  });

  // Processes a block-level node (paragraph, heading, quote, list, listitem)
  // into plain text. Lists join their items with newlines; listitems may
  // contain nested lists which are recursively rendered.
  registrar.scalarFunction({
    name: "lexical_block_node_to_plain_text",
    description: "Convert a Lexical block node to plain text",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.node is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("ntype", sql`input.node ->> 'type'`);
      s.defScalar("children_json", sql`input.node -> 'children'`);

      s.if(sql`ntype = 'image'`, (s) => {
        s.return(
          sql`coalesce(nullif(input.node ->> 'altText', ''), '[Image]')`,
        );
      });

      s.if(sql`ntype = 'list'`, (s) => {
        s.return(sql`coalesce((
          select string_agg(
            fn.lexical_block_node_to_plain_text(item.value),
            e'\n' order by item.index
          )
          from json.array_each(children_json) item
        ), '')`);
      });

      s.if(sql`ntype = 'listitem'`, (s) => {
        s.return(sql`coalesce((
          select string_agg(
            case when child.value ->> 'type' = 'list'
              then e'\n' || fn.lexical_block_node_to_plain_text(child.value)
              else fn.lexical_inline_node_to_plain_text(child.value)
            end,
            '' order by child.index
          )
          from json.array_each(children_json) child
        ), '')`);
      });

      s.if(sql`ntype in ('table', 'tablerow', 'tablecell')`, (s) => {
        s.defScalar("table_result", sql.lit``);
        s.defTable(
          "table_children",
          sql`select value as node from json.array_each(children_json)`,
        );
        s.forEachTable("table_children", "table_child", (s) => {
          s.if(sql`length(table_result) > 0`, (s) => {
            s.setScalar("table_result", sql`table_result || e'\n'`);
          });
          s.setScalar(
            "table_result",
            sql`table_result || fn.lexical_block_node_to_plain_text(table_child.node)`,
          );
        });
        s.return(sql`table_result`);
      });

      // paragraph / heading / quote / anything else with inline children
      s.return(sql`fn.lexical_inline_nodes_to_plain_text(children_json)`);
    },
  });

  registrar.scalarFunction({
    name: "lexical_rich_text_to_plain_text",
    description: "Convert Lexical rich text JSON to plain text",
    parameters: [{ name: "rich_text", type: "Json" }],
    returnType: "String",
    procedure: (s) => {
      s.if(sql`input.rich_text is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar(
        "root_children",
        sql`input.rich_text -> 'root' -> 'children'`,
      );
      s.if(sql`root_children is null`, (s) => {
        s.return(sql.lit``);
      });
      s.defScalar("result", sql.lit``);
      s.defTable(
        "block_nodes",
        sql`select value as node from json.array_each(root_children)`,
      );
      s.forEachTable("block_nodes", "block", (s) => {
        s.if(sql`length(result) > 0`, (s) => {
          s.setScalar("result", sql`result || e'\n'`);
        });
        s.setScalar(
          "result",
          sql`result || fn.lexical_block_node_to_plain_text(block.node)`,
        );
      });
      s.return(sql`result`);
    },
  });

  // ============================================
  // STRUCTURED NODE EXTRACTION
  // ============================================

  // Return complete nodes so callers can apply domain-specific validation to
  // any structured Lexical node without defining their own tree traversal.
  // Walk one tree level at a time without recursive UDF calls. Each frontier
  // entry carries its document path so the final result remains depth-first
  // document order even though traversal is breadth-first.
  registrar.scalarFunction({
    name: "lexical_extract_nodes",
    description:
      "Extract all nodes of a given type from a Lexical rich-text JSON value",
    parameters: [
      { name: "rich_text", type: "Json" },
      { name: "node_type", type: { type: "String", maxLength: 100 } },
    ],
    returnType: "Json",
    procedure: (s) => {
      s.if(sql`input.rich_text is null`, (s) => {
        s.return(sql`'[]'::json`);
      });
      s.defScalar(
        "root_children",
        sql`input.rich_text -> 'root' -> 'children'`,
      );
      s.if(sql`root_children is null`, (s) => {
        s.return(sql`'[]'::json`);
      });
      s.defScalar("matching_nodes", sql`'[]'::json`);
      s.defScalar(
        "node_frontier",
        sql`coalesce((
          select json_array_agg(
            json_build_object(
              'node', root_node.value,
              'path', lpad(root_node.index::string, 10, '0')
            )
            order by root_node.index
          )
          from json.array_each(root_children) root_node
        ), '[]'::json)`,
      );
      s.while(sql`json_array_length(node_frontier) > 0`, (s) => {
        s.setScalar(
          "matching_nodes",
          sql`matching_nodes || coalesce((
            select json_array_agg(frontier_entry.value order by frontier_entry.value->>'path')
            from json.array_each(node_frontier) frontier_entry
            where frontier_entry.value->'node'->>'type' = input.node_type
          ), '[]'::json)`,
        );
        s.setScalar(
          "node_frontier",
          sql`coalesce((
            select json_array_agg(
              json_build_object(
                'node', child.value,
                'path', frontier_entry.value->>'path' || '.' ||
                  lpad(child.index::string, 10, '0')
              )
              order by frontier_entry.value->>'path', child.index
            )
            from json.array_each(node_frontier) frontier_entry,
              json.array_each(
                coalesce(frontier_entry.value->'node'->'children', '[]'::json)
              ) child
          ), '[]'::json)`,
        );
      });

      s.return(sql`coalesce((
        select json_array_agg(match.value->'node' order by match.value->>'path')
        from json.array_each(matching_nodes) match
      ), '[]'::json)`);
    },
  });

  // ============================================
  // MENTIONS EXTRACTION
  // ============================================

  // Extracts all mention ids from a Lexical rich-text JSON document and
  // returns them as a JSON array. The ids' original JSON type is
  // preserved (number for numeric ids, string for uuid/text ids).
  //
  // Iterate with `json.array_each(...)`:
  //
  //   s.defTable(
  //     "new_mention_ids",
  //     sql`select cast(value as bigint) as user_id
  //         from json.array_each(lexical_extract_mention_ids(NEW.body))`,
  //   );
  //
  registrar.scalarFunction({
    name: "lexical_extract_mention_ids",
    description: "Extract all mention ids from a Lexical rich-text JSON value",
    parameters: [{ name: "rich_text", type: "Json" }],
    returnType: "Json",
    procedure: (s) => {
      s.defScalar("result", sql`'[]'::json`);
      s.defTable(
        "mention_nodes",
        sql`select value as node
          from json.array_each(
            fn.lexical_extract_nodes(input.rich_text, 'mention')
          )`,
      );
      s.forEachTable("mention_nodes", "mention_node", (s) => {
        s.if(
          sql`coalesce(mention_node.node ->> 'mentionKind', 'mention') = 'mention'`,
          (s) => {
            s.defScalar("mention_id", sql`mention_node.node -> 'mentionId'`);
            s.if(sql`mention_id is not null`, (s) => {
              s.setScalar(
                "result",
                sql`result || json_build_array(mention_id)`,
              );
            });
          },
        );
      });

      s.return(sql`result`);
    },
  });
}

export function ensureLexicalStandardDocumentFunction(
  registrar: ScalarFunctionRegistrar,
) {
  if (registrar.scalarFunctions?.["lexical_standard_document"]) return;
  // Semantic document formatting: typography comes from the shared page styles,
  // never from pasted inline CSS. Preserve text, emphasis, structure, and media.
  registrar.scalarFunction({
    name: "lexical_standard_document",
    parameters: [{ name: "node", type: "Json" }],
    returnType: "Json",
    procedure: (s) => {
      s.defScalar(
        "result",
        sql`input.node - 'style' - 'textStyle' - 'backgroundColor' - 'lineHeight'`,
      );
      s.if(sql`input.node->'root' is not null`, (s) => {
        s.setScalar(
          "result",
          sql`result || json_build_object('root', fn.lexical_standard_document(input.node->'root'))`,
        );
      });
      s.if(sql`input.node->'children' is not null`, (s) => {
        s.setScalar(
          "result",
          sql`result || json_build_object('children', coalesce((
          select json_array_agg(fn.lexical_standard_document(child.value) order by child.index)
          from json.array_each(input.node->'children') child
        ), '[]'::json))`,
        );
      });
      s.return(sql`result`);
    },
  });
}
