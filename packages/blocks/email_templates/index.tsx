import type { SampleDataScriptContext } from "std/sample_data";
import { sql } from "../../std/sql_utils";
import type { AnyExpr } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";
import { Route } from "std/ui";
import type { Node } from "std/ui";
import { EmailEditor } from "./email_editor";
import { EmailTemplateListPage } from "./email_template_list";
import { BasicEmailEditorLexical } from "./lexical_basic_editor";
import { AdvancedEmailEditorLexical } from "./lexical_advanced_editor";
import { generateAdvancedTemplateMjml } from "./advanced_template_mjml";
import { ensureLexicalRichTextFunctions } from "components/lexical/components/lexical_scalar_functions";

export interface EmailTemplatesBlockOptions {
  recipientVariables?: Record<string, string>;
  linkVariables?: Record<string, string>;
}

export interface EmailTemplatePagesProps {
  wrapper?: (children: Node) => Node;
}

function wrapPage(
  wrapper: EmailTemplatePagesProps["wrapper"],
  content: Node,
) {
  return wrapper ? wrapper(content) : content;
}

/**
 * Solution block that adds the `email_templates` table, two editors
 * (basic + advanced/Lexical), and the email-template list page. Add via
 * `system.addBlock(new EmailTemplatesBlock())` in core.tsx, then mount
 * the editor routes in an app's UI.
 *
 * See {@link https://docs.yolm.io/blocks/email_templates | Email templates}.
 */
export class EmailTemplatesBlock implements Block {
  blockName = "EmailTemplatesBlock";
  componentDependencies: string[] = [];
  description: string | undefined;
  /** CDN host used for inline image references in advanced templates. */
  imageHost?: string;
  /** Base path under `imageHost` for resolving inline image references. */
  imageBasePath?: string;

  constructor(readonly opts: EmailTemplatesBlockOptions = {}) {}

  getRecipientVariables() {
    return this.opts.recipientVariables;
  }

  getLinkVariables() {
    return this.opts.linkVariables;
  }

  initialize() {
    const { db } = system;
    ensureLexicalRichTextFunctions(system);

    system.enum_({
      name: "email_template_type",
      values: ["basic", "advanced"],
    });

    db.table("email_templates", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.string("name", 200).notNull();
      table.string("subject", 200);
      table.string("preview_text", 500).multiline();
      table.hexColor("background_color");
      table.enum("type", "email_template_type").notNull();
      table.bool("is_active").notNull().default(sql`true`);
      // only relevant for basic templates
      table.json("body");
    });

    system.enum_({
      name: "email_section_background_type",
      values: ["color", "image"],
    });

    system.enum_({
      name: "email_section_vertical_align",
      values: ["top", "middle", "bottom"],
    });

    system.enum_({
      name: "email_section_mobile_display",
      values: ["normal", "reversed", "no-stack"],
    });

    system.enum_({
      name: "email_section_border_style",
      values: ["solid", "dashed", "dotted", "double"],
    });

    system.enum_({
      name: "email_section_background_behavior",
      values: ["stretch", "no-repeat", "repeat-x", "repeat-y", "repeat"],
    });

    db.table("email_sections", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("email_templates").notNull();
      table.ordering("order").notNull();
      table.bool("full_width").notNull().default(sql`false`);
      table.enum("background_type", "email_section_background_type");
      table.hexColor("background_color");
      table.string("background_image_url", 500);
      table.enum("background_behavior", "email_section_background_behavior");
      table
        .enum("vertical_align", "email_section_vertical_align")
        .notNull()
        .default(sql`'top'`);
      table
        .enum("mobile_display", "email_section_mobile_display")
        .notNull()
        .default(sql`'normal'`);
      // Border properties
      table
        .enum("border_style", "email_section_border_style")
        .notNull()
        .default(sql`'solid'`);
      table.hexColor("border_color");
      table.smallUint("border_width").notNull().default(sql`0`);
      // Padding
      table.smallUint("padding_top").notNull().default(sql`20`);
      table.smallUint("padding_right").notNull().default(sql`0`);
      table.smallUint("padding_bottom").notNull().default(sql`20`);
      table.smallUint("padding_left").notNull().default(sql`0`);
    });

    db.table("email_columns", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("email_sections").notNull();
      table.ordering("order").notNull();
      table.tinyUint("width").notNull(); // Percentage width
    });
    system.enum_({
      name: "email_block_type",
      values: ["text", "button", "divider", "spacer", "image", "sql"],
    });

    system.enum_({
      name: "email_block_button_align",
      values: ["left", "center", "right"],
    });

    system.enum_({
      name: "email_block_image_align",
      values: ["left", "center", "right"],
    });

    system.enum_({
      name: "email_block_image_shape",
      values: ["square", "circle", "rounded"],
    });

    system.enum_({
      name: "email_block_divider_border_style",
      values: ["solid", "dashed", "dotted", "double"],
    });

    system.enum_({
      name: "drop_target_location",
      values: ["top", "bottom"],
    });

    db.table("email_template_images", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.blobRef("blob_hash").notNull().unique();
      table.string("content_type", 100).notNull();
    });

    db.table("email_blocks", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("email_columns").notNull();
      table.ordering("order").notNull();
      table.enum("type", "email_block_type").notNull();
      table.hexColor("background_color");
      // Common content properties
      table.smallUint("padding_top").notNull();
      table.smallUint("padding_right").notNull();
      table.smallUint("padding_bottom").notNull();
      table.smallUint("padding_left").notNull();
      // Button specific
      table.enum("button_align", "email_block_button_align");
      table.hexColor("button_background_color");
      table.smallUint("button_border_radius");
      table.bool("button_full_width");
      table.string("button_href", 500);
      table.smallUint("button_padding_top");
      table.smallUint("button_padding_right");
      table.smallUint("button_padding_bottom");
      table.smallUint("button_padding_left");
      table.enum("button_border_style", "email_block_divider_border_style");
      table.hexColor("button_border_color");
      table.smallUint("button_border_width");
      table.string("button_font_family", 50);
      table.smallUint("button_font_size").notNull().default(sql`14`);
      table.hexColor("button_font_color").notNull().default(sql`'#ffffff'`);
      table.enum("button_text_align", "email_block_button_align"); // reuse existing enum
      table.string("button_label", 50);
      // Image specific
      table.enum("image_align", "email_block_image_align");
      table.string("image_alt", 500);
      table.string("image_href", 500);
      table.string("image_src", 500);
      table.smallUint("image_width");
      table.enum("image_shape", "email_block_image_shape");
      table.smallUint("image_border_radius"); // For Rounded shape
      table.bool("image_full_width_mobile");
      // Divider specific
      table.enum("divider_border_style", "email_block_divider_border_style");
      table.hexColor("divider_border_color");
      table.smallUint("divider_border_width");
      table.smallUint("divider_width"); // Percentage
      // Spacer specific
      table.smallUint("spacer_height");
      // Raw
      table.string("raw_html", 10_000).multiline();
      // text
      table.json("text_content");
    });
    this.componentDependencies = ["EmailTemplatesPage"];
    this.description = "Provides a way to create and manage email templates.";
  }

  beforeGenerateSampleData(
    s: IServerBaseStatements,
    ctx: SampleDataScriptContext,
  ) {
    s.startTransaction();
    s.modify(
      sql`insert into email_templates (name, subject, preview_text, background_color, type, is_active, body) values
      ('Sample Basic Template', 'Sample basic template', 'Sample basic template', '#000000', 'basic', true, lexical_from_markdown('# Dear {{contact.first_name}}!

This is a sample email template to demonstrate the EmailTemplatesBlock.'))
      `,
    );
    ctx.incrementRecordCount("email_templates", 1);
    s.commitTransaction();
    s.startTransaction();
    s.modify(
      sql`insert into email_templates (name, subject, preview_text, background_color, type, is_active) values
      ('Sample advanced template', 'Greetings from Yolm!', null, null, 'advanced', true)`,
    );
    s.modify(
      sql`insert into email_sections (email_template_id, "order", full_width, background_type, background_color, background_image_url, background_behavior, vertical_align, mobile_display, border_style, border_width, padding_top, padding_right, padding_bottom, padding_left) values
      (1, ordering.n_after(0), false, null, null, null, null, 'top', 'normal', 'solid', 0, 20, 0, 20, 0),
      (1, ordering.n_after(1), false, null, null, null, null, 'top', 'normal', 'solid', 0, 20, 0, 20, 0),
      (1, ordering.n_after(2), false, null, null, null, null, 'top', 'normal', 'solid', 0, 20, 0, 20, 0),
      (1, ordering.n_after(3), false, null, null, null, null, 'top', 'normal', 'solid', 0, 20, 0, 20, 0)`,
    );
    s.modify(
      sql`insert into email_columns (email_section_id, "order", width) values
      (0, ordering.n_after(0), 100),
      (1, ordering.n_after(0), 25),
      (1, ordering.n_after(1), 75),
      (2, ordering.n_after(0), 75),
      (2, ordering.n_after(1), 25),
      (3, ordering.n_after(0), 100)`,
    );
    s.modify(
      sql`insert into email_blocks (email_column_id, "order", type, background_color, padding_top, padding_right, padding_bottom, padding_left, button_align, button_background_color, button_border_radius, button_full_width, button_href, button_padding_top, button_padding_right, button_padding_bottom, button_padding_left, button_border_style, button_border_color, button_border_width, button_font_family, button_font_size, button_font_color, button_text_align, button_label, image_align, image_alt, image_href, image_src, image_width, image_shape, image_border_radius, image_full_width_mobile, divider_border_style, divider_border_color, divider_border_width, divider_width, spacer_height, raw_html, text_content) values
      (0, ordering.n_after(0), 'text', null, 0, 25, 0, 25, null, null, 0, false, null, 0, 0, 0, 0, null, null, 0, null, 14, '#ffffff', null, null, null, null, null, null, 0, null, 0, false, null, null, 0, 0, 0, null, lexical_from_markdown('# Dear {{contact.first_name}}!')),
      (1, ordering.n_after(0), 'image', null, 0, 0, 0, 0, null, null, 0, false, null, 0, 0, 0, 0, null, null, 0, null, 14, '#ffffff', null, null, 'center', null, null, 'https://yolmcdn.net/global/logo/favicon.PGYEisaWWkrY_JMza_oRx67kgTS-b9Uol60X2C6zc2Y.svg', 150, 'square', 0, false, null, null, 0, 0, 0, null, null),
      (2, ordering.n_after(0), 'text', null, 0, 25, 0, 25, null, null, 0, false, null, 0, 0, 0, 0, null, null, 0, null, 14, '#ffffff', null, null, null, null, null, null, 0, null, 0, false, null, null, 0, 0, 0, null, lexical_simple_paragraph('This is a sample email template to demonstrate the EmailTemplatesBlock.')),
      (3, ordering.n_after(0), 'text', null, 0, 25, 0, 25, null, null, 0, false, null, 0, 0, 0, 0, null, null, 0, null, 14, '#ffffff', null, null, null, null, null, null, 0, null, 0, false, null, null, 0, 0, 0, null, lexical_simple_paragraph('Did you know that in Yolm Blocks can define database tables, scheduled procs, api endpoints, webhooks, pages, full applications and even sample data generation to make development that much faster!')),
      (4, ordering.n_after(0), 'image', null, 0, 0, 0, 0, null, null, 0, false, null, 0, 0, 0, 0, null, null, 0, null, 14, '#ffffff', null, null, 'center', null, null, 'https://placehold.co/150', 150, 'square', 0, false, null, null, 0, 0, 0, null, null),
      (5, ordering.n_after(0), 'text', null, 0, 25, 0, 25, null, null, 0, false, null, 0, 0, 0, 0, null, null, 0, null, 14, '#ffffff', null, null, null, null, null, null, 0, null, 0, false, null, null, 0, 0, 0, null, lexical_simple_paragraph('Click the Call to action!')),
      (5, ordering.n_after(1), 'button', null, 10, 25, 10, 25, 'center', '#414141', 3, false, 'https://www.yolm.ai', 10, 25, 10, 25, 'solid', '#ffffff', 0, 'Arial', 24, '#ffffff', 'center', 'Click here', null, null, null, null, 0, null, 0, false, null, null, 0, 0, 0, null, null)`,
    );
    ctx.incrementRecordCount("email_templates", 1);
    ctx.incrementRecordCount("email_sections", 4);
    ctx.incrementRecordCount("email_columns", 6);
    ctx.incrementRecordCount("email_blocks", 7);
    s.commitTransaction();
  }

  static Pages = (props: EmailTemplatePagesProps = {}) => (
    <>
      <EmailTemplateListPage
        path="/email-templates"
        wrapper={props.wrapper}
      />
      <Route path="/email-templates/{record_id:id}">
        {wrapPage(
          props.wrapper,
          <EmailEditor recordId={sql`record_id`} />,
        )}
      </Route>
      <Route path="/email-templates/new-basic">
        {wrapPage(
          props.wrapper,
          <BasicEmailEditorLexical recordId={sql.null} />,
        )}
      </Route>
      <Route path="/email-templates/new-advanced">
        {wrapPage(
          props.wrapper,
          <AdvancedEmailEditorLexical recordId={sql.null} />,
        )}
      </Route>
    </>
  );
}

/**
 * Registers the HTTP endpoint that serves images embedded in email
 * templates and tells the `EmailTemplatesBlock` which absolute URL
 * prefix to inline into rendered HTML.
 *
 * Call once from the API where you want the images hosted (usually
 * the same API that handles transactional email webhooks).
 *
 * @param opts.domain  Public domain the images will be served from
 *                     (no scheme; `https://` is added automatically).
 * @param opts.prefix  API prefix; defaults to `"/api"`.
 * @param opts.route   Route path under the prefix; defaults to
 *                     `"/email-template-images"`.
 * @returns `{ baseUrl, basePath }` for re-use elsewhere.
 *
 * @example
 * registerEmailTemplateImagesApi({ domain: "api.example.com" });
 * // serves GET https://api.example.com/api/email-template-images/{hash_hex}
 *
 * @see docs/blocks/email_templates.md
 */
export function registerEmailTemplateImagesApi(opts: {
  domain: string;
  prefix?: string;
  route?: string;
}): { baseUrl: string; basePath: string } {
  const prefix = opts.prefix ?? "/api";
  const route = opts.route ?? "/email-template-images";
  const api = system.api({ prefix, domain: opts.domain });
  api.get(`${route}/{hash_hex}`, {
    procedure: (s) => {
      s.defScalar("queried_hash", sql`bytes.from_hex(hash_hex)`);
      s.defRecord(
        "img",
        sql`select blob_hash, content_type from db.email_template_images where blob_hash = queried_hash limit 1`,
      );
      s.if(sql`img.blob_hash is null`, (s) => {
        s.setHttpStatus(404);
        s.return();
      });
      s.setHeader(sql.lit`Content-Type`, sql`img.content_type`);
      s.setHeader(
        sql.lit`Cache-Control`,
        sql.lit`max-age=31536000, immutable`,
      );
      s.returnBlob(sql`img.blob_hash`);
    },
  });
  const baseUrl = `https://${opts.domain}${prefix}${route}`;
  const basePath = `${prefix}${route}`;
  const block = system.block(EmailTemplatesBlock);
  block.imageHost = `https://${opts.domain}`;
  block.imageBasePath = basePath;
  return { baseUrl, basePath };
}

/**
 * Build the rendered HTML body of an advanced (Lexical) email template,
 * absolutizing any relative image URLs against the registered image host.
 * Call from a server-side procedure (e.g. inside an outbox reactor's
 * `setup`) to assemble the body before sending the email.
 */
export function generateAdvancedTemplateBody<T extends IServerBaseStatements>(
  s: T,
  templateId: AnyExpr,
  opts: { prefix?: string; outputScalar?: string } = {},
) {
  const prefix = opts.prefix ?? "";
  const imageHost = system.block(EmailTemplatesBlock).imageHost;
  generateAdvancedTemplateMjml(s, {
    prefix,
    templateQuery: sql`select * from email_templates where id = ${templateId}`,
    sectionsQuery: sql`select *, id as render_id from email_sections
      where email_template_id = ${templateId}`,
    columnsQuery:
      sql`select *, id as render_id, email_section_id as parent_render_id
      from email_columns where email_section_id in (
        select id from email_sections where email_template_id = ${templateId})`,
    blocksQuery: sql`select *, email_column_id as parent_render_id
      from email_blocks where email_column_id in (
        select id from email_columns where email_section_id in (
          select id from email_sections where email_template_id = ${templateId}))`,
    imageUrl: (url) =>
      imageHost
        ? sql`case when ${url} like '/%' then ${
          sql.lit(imageHost)
        } || ${url} else ${url} end`
        : url,
  });
  s.renderMjml({
    mjml: sql.ref(prefix + "mjml"),
    defOutputScalar: prefix + "rendered_html",
  });
  s.setScalar(
    opts.outputScalar ?? "merged_body",
    sql.ref(prefix + "rendered_html"),
  );
}
