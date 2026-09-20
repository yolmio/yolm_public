import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IStatementsBase } from "std/statements";

/**
 * Shared MJML generation for unsaved editor state and persisted delivery rows.
 * Queries retain the template fields and normalize section/column identities
 * to `render_id`, with children linked by `parent_render_id`. Defines
 * `${prefix}mjml`; the caller chooses browser or server HTML rendering.
 */
export function generateAdvancedTemplateMjml<T extends IStatementsBase>(
  s: T,
  opts: {
    templateQuery: Sql;
    sectionsQuery: Sql;
    columnsQuery: Sql;
    blocksQuery: Sql;
    prefix?: string;
    imageUrl?: (url: Sql) => Sql;
  },
) {
  const prefix = opts.prefix ?? "";
  const template = sql.ref(prefix + "template");
  const section = sql.ref(prefix + "section");
  const column = sql.ref(prefix + "column");
  const block = sql.ref(prefix + "block");
  const mjml = sql.ref(prefix + "mjml");
  const blockAttrs = sql.ref(prefix + "block_attrs");
  const imageUrl = opts.imageUrl ?? ((url: Sql) => url);
  s.defTable(prefix + "render_sections", opts.sectionsQuery);
  s.defTable(prefix + "render_columns", opts.columnsQuery);
  s.defTable(prefix + "render_blocks", opts.blocksQuery);
  s.defRecord(prefix + "template", opts.templateQuery);
  s.defScalar(
    prefix + "mjml",
    sql.concat(
      "<mjml><mj-head>",
      "<mj-title>",
      sql`coalesce(${template}.name, '')`,
      "</mj-title>",
      "<mj-preview>",
      sql`coalesce(${template}.preview_text, '')`,
      "</mj-preview>",
      '<mj-attributes><mj-all font-family="Helvetica" /></mj-attributes>',
      "</mj-head><mj-body",
      sql`case when ${template}.background_color is not null
     then concat(' background-color="', ${template}.background_color, '"')
     else ''
   end`,
      ">",
    ),
  );
  s.forEachTableWithOpts({
    table: prefix + "render_sections",
    orderBy: sql`order`,
    cursorName: prefix + "section",
    body: (s) => {
      s.setScalar(
        prefix + "mjml",
        sql.concat(
          mjml,
          "<mj-section",
          sql`case when ${section}.full_width then ' full-width="true"' else '' end`,
          sql`case when ${section}.background_type = 'color' and ${section}.background_color is not null
         then concat(' background-color="', ${section}.background_color, '"')
         else ''
       end`,
          sql`case when ${section}.background_type = 'image' and ${section}.background_image_url is not null
         then concat(' background-url="', ${
            imageUrl(sql`${section}.background_image_url`)
          }, '"',
                    ' background-repeat="', ${section}.background_behavior, '"')
         else ''
       end`,
          sql`case when ${section}.mobile_display = 'reversed'
          then ' direction="rtl"'
          else ''
        end`,
          ' padding="',
          sql`${section}.padding_top`,
          "px ",
          sql`${section}.padding_right`,
          "px ",
          sql`${section}.padding_bottom`,
          "px ",
          sql`${section}.padding_left`,
          'px"',
          sql`case when ${section}.border_width::int > 0
            then concat(' border="', ${section}.border_width, 'px ', ${section}.border_style, ' ', ${section}.border_color, '"')
            else ''
          end`,
          ">",
        ),
      );
      function handleColumn(s: T) {
        s.setScalar(
          prefix + "mjml",
          sql.concat(
            mjml,
            '<mj-column width="',
            sql`${column}.width`,
            '%"',
            ' vertical-align="',
            sql`${section}.vertical_align`,
            '">',
          ),
        );
        s.forEachTableWithOpts({
          table: prefix + "render_blocks",
          orderBy: sql`order`,
          where: sql`parent_render_id = ${column}.render_id`,
          cursorName: prefix + "block",
          body: (s) => {
            s.defScalar(
              prefix + "block_attrs",
              sql.concat(
                ' padding="',
                sql`${block}.padding_top`,
                "px ",
                sql`${block}.padding_right`,
                "px ",
                sql`${block}.padding_bottom`,
                "px ",
                sql`${block}.padding_left`,
                'px"',
                sql`case when ${block}.background_color is not null
                 then concat(' background-color="', ${block}.background_color, '"')
                 else ''
               end`,
              ),
            );
            s.if(sql`${block}.type = 'text'`, (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  "<mj-text",
                  blockAttrs,
                  ">",
                  sql`lexical_rich_text_to_html_email(${block}.text_content)`,
                  "</mj-text>",
                ),
              );
            });
            s.if(sql`${block}.type = 'button'`, (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  "<mj-button",
                  blockAttrs,
                  sql`case when ${block}.button_full_width then ' width="100%"' else '' end`,
                  sql`case when ${block}.button_align is not null
                    then concat(' align="', ${block}.button_align, '"')
                    else ''
                  end`,
                  sql`case when ${block}.button_background_color is not null
                    then concat(' background-color="', ${block}.button_background_color, '"')
                    else ''
                  end`,
                  sql`case when ${block}.button_border_radius::int > 0
                    then concat(' border-radius="', ${block}.button_border_radius, 'px"')
                    else ''
                  end`,
                  sql`case when ${block}.button_href is not null
                    then concat(' href="', ${block}.button_href, '"')
                    else ''
                  end`,
                  ' inner-padding="',
                  sql`${block}.button_padding_top`,
                  "px ",
                  sql`${block}.button_padding_right`,
                  "px ",
                  sql`${block}.button_padding_bottom`,
                  "px ",
                  sql`${block}.button_padding_left`,
                  'px"',
                  sql`case when ${block}.button_font_family is not null
                    then concat(' font-family="', ${block}.button_font_family, '"')
                    else ''
                  end`,
                  sql`case when ${block}.button_font_size is not null
                    then concat(' font-size="', ${block}.button_font_size, 'px"')
                    else ''
                  end`,
                  sql`case when ${block}.button_font_color is not null
                    then concat(' color="', ${block}.button_font_color, '"')
                    else ''
                  end`,
                  sql`case when ${block}.button_text_align is not null
                    then concat(' text-align="', ${block}.button_text_align, '"')
                    else ''
                  end`,
                  sql`case when ${block}.button_border_width::int > 0
                    then concat(' border="', ${block}.button_border_width, 'px ', ${block}.button_border_style, ' ', ${block}.button_border_color, '"')
                    else ''
                  end`,
                  ">",
                  sql`string.html_escape(${block}.button_label)`,
                  "</mj-button>",
                ),
              );
            });
            s.if(sql`${block}.type = 'divider'`, (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  "<mj-divider",
                  blockAttrs,
                  ' width="',
                  sql`${block}.divider_width`,
                  '%"',
                  ' border-width="',
                  sql`${block}.divider_border_width`,
                  'px"',
                  ' border-style="',
                  sql`${block}.divider_border_style`,
                  '"',
                  sql`case when ${block}.divider_border_color is not null
                   then concat(' border-color="', ${block}.divider_border_color, '"')
                   else ''
                 end`,
                  "/>",
                ),
              );
            });
            s.if(sql`${block}.type = 'spacer'`, (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  '<mj-spacer height="',
                  sql`${block}.spacer_height`,
                  'px"',
                  blockAttrs,
                  "/>",
                ),
              );
            });
            s.if(sql`${block}.type = 'image'`, (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  "<mj-image",
                  blockAttrs,
                  sql`case when ${block}.image_src is not null
                 then concat(' src="', ${
                    imageUrl(sql`${block}.image_src`)
                  }, '"')
                 else ''
               end`,
                  sql`case when ${block}.image_alt is not null
                 then concat(' alt="', ${block}.image_alt, '"')
                 else ''
               end`,
                  sql`case when ${block}.image_href is not null
                 then concat(' href="', ${block}.image_href, '"')
                 else ''
               end`,
                  sql`case when ${block}.image_width::int > 0
                 then concat(' width="', ${block}.image_width, 'px"')
                 else ''
               end`,
                  sql`case when ${block}.image_shape = 'circle'
                 then ' border-radius="50%"'
                 when ${block}.image_shape = 'rounded' and ${block}.image_border_radius::int > 0
                 then concat(' border-radius="', ${block}.image_border_radius, 'px"')
                 else ''
               end`,
                  sql`case when ${block}.image_align is not null
                 then concat(' align="', ${block}.image_align, '"')
                 else ''
               end`,
                  sql`case when ${block}.image_full_width_mobile
                 then ' fluid-on-mobile="true"'
                 else ''
               end`,
                  "/>",
                ),
              );
            });
            s.if(sql`${block}.type = 'sql'`, (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  "<mj-raw>",
                  sql`${block}.raw_html`,
                  "</mj-raw>",
                ),
              );
            });
          },
        });
        s.setScalar(
          prefix + "mjml",
          sql.concat(mjml, "</mj-column>"),
        );
      }
      s.conditional({
        condition: sql`${section}.mobile_display = 'reversed'`,
        then: (s) => {
          s.forEachTableWithOpts({
            table: prefix + "render_columns",
            orderBy: sql`order desc`,
            where: sql`parent_render_id = ${section}.render_id`,
            cursorName: prefix + "column",
            body: handleColumn,
          });
        },
        else: (s) => {
          s.if(
            sql`${section}.mobile_display = 'no-stack'`,
            (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(
                  mjml,
                  '<mj-group vertical-align="',
                  sql`${section}.vertical_align`,
                  '">',
                ),
              );
            },
          );
          s.forEachTableWithOpts({
            table: prefix + "render_columns",
            orderBy: sql`order`,
            where: sql`parent_render_id = ${section}.render_id`,
            cursorName: prefix + "column",
            body: handleColumn,
          });
          s.if(
            sql`${section}.mobile_display = 'no-stack'`,
            (s) => {
              s.setScalar(
                prefix + "mjml",
                sql.concat(mjml, "</mj-group>"),
              );
            },
          );
        },
      });
      s.setScalar(
        prefix + "mjml",
        sql.concat(mjml, "</mj-section>"),
      );
    },
  });
  s.setScalar(
    prefix + "mjml",
    sql.concat(mjml, "</mj-body></mjml>"),
  );
}
