---
title: Email Templates Block
description: Solution block adding basic and advanced email templates with section/column/block layout, MJML rendering, and embedded image hosting.
tags:
  - blocks
  - email
  - templates
  - mjml
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - concepts/email_templates.md
---

# Email Templates Block

`EmailTemplatesBlock` adds an editable email-template store and its editing
UI. Templates are **basic** (one Lexical rich-text body) or **advanced**
(sections, columns, and blocks rendered through MJML). The block does not send
mail; [`MarketingEmailCampaignBlock`](./marketing_email_campaign.md) and CRM
composers consume `email_templates` and the renderer.

## Minimal Setup

Register the block in `core.tsx`:

```typescript
import { EmailTemplatesBlock } from "blocks/email_templates";

system.addBlock(new EmailTemplatesBlock());
```

Mount the editor pages among an app's routes. `EmailTemplatesBlock.Pages` is
self-routing; do not wrap it in your own `<Route>` or an outer runtime
component. Use `wrapper` for authorization or layout; it is rendered inside
each route:

```tsx
<EmailTemplatesBlock.Pages
  wrapper={(children) => <TemplatePermissionGuard>{children}</TemplatePermissionGuard>}
/>
```

This registers four routes and an "Email Templates" navigation entry:

| Route | Page |
| --- | --- |
| `/email-templates` | Template list (create / duplicate / enable / disable / delete) |
| `/email-templates/{record_id:id}` | Editor, dispatched by template `type` |
| `/email-templates/new-basic` | New basic template editor |
| `/email-templates/new-advanced` | New advanced template editor |

## Configuration

`recipientVariables` and `linkVariables` (`Record<string, string>`, see
`EmailTemplatesBlockOptions`) expose named variables to template authors in
both editors. The basic body field falls back to `{{email}}` / `{{name}}` when
no recipient variables are configured.

## Owned schema

Tables skip sample-data generation; the block seeds one basic and one advanced
sample template via `beforeGenerateSampleData`.

| Table | Purpose |
| --- | --- |
| `email_templates` | One row per template. `type` is `basic` or `advanced`; `body` (Lexical JSON) is used by **basic templates only**. |
| `email_sections` | Advanced layout rows. |
| `email_columns` | Columns within a section; `width` is a percentage. |
| `email_blocks` | Content blocks within a column (`email_block_type`: text, button, divider, spacer, image, sql). |
| `email_template_images` | Hosted inline images keyed by content hash. |

Enums are prefixed `email_template_`, `email_section_`, and `email_block_`,
plus `drop_target_location` for the editor.

## Pages and Components

For custom routing, the underlying components are exported from submodules.
The editors take `recordId: NumericExpr` (`sql.null` for a new template) and are
not self-routing; place them inside your own `<Route>`.

| Component | Import | Notes |
| --- | --- | --- |
| `EmailTemplateListPage` | `blocks/email_templates/email_template_list` | Takes `path` and optional `wrapper`; self-routing and adds a nav item. |
| `EmailEditor` | `blocks/email_templates/email_editor` | Renders the basic or advanced editor based on the record's `type`. |
| `BasicEmailEditorLexical` | `blocks/email_templates/lexical_basic_editor` | Basic single-body editor. |
| `AdvancedEmailEditorLexical` | `blocks/email_templates/lexical_advanced_editor` | Section/column/block drag-and-drop editor. |

## `registerEmailTemplateImagesApi`

Editor-uploaded images are stored in `email_template_images` with relative
URLs and must be served from your own domain so mail clients can fetch them.
Call this **once** from the app/API surface that should host them. Without it,
image URLs stay relative and break for recipients.

Register it after `EmailTemplatesBlock` but **before** adding any campaign
block or generating procedures that call `generateAdvancedTemplateBody`; the
renderer captures the host at generation time.

```typescript
import { registerEmailTemplateImagesApi } from "blocks/email_templates";

registerEmailTemplateImagesApi({ domain: "assets.example.com" });
```

| Option | Required | Meaning |
| --- | --- | --- |
| `domain` | yes | Public domain without scheme; `https://` is added. |
| `prefix` | no | API prefix. Default `"/api"`. |
| `route` | no | Route under the prefix. Default `"/email-template-images"`. |

It registers `GET {prefix}{route}/{hash_hex}`, which returns the stored bytes
with the saved `Content-Type` and `Cache-Control: max-age=31536000, immutable`,
or `404`. It returns `{ baseUrl, basePath }`.

## `generateAdvancedTemplateBody`

`generateAdvancedTemplateBody(s, templateId, opts?)` assembles the MJML for an
**advanced** template, renders it with `s.renderMjml`, and assigns the HTML to
an existing scalar (`merged_body` unless `opts.outputScalar` is set) with
`setScalar`, so the scalar must be defined first. `opts.prefix` namespaces the
helper's intermediate names. Render basic templates from their `body` JSON
directly.

```typescript
import { generateAdvancedTemplateBody } from "blocks/email_templates";

s.defScalar("merged_body", { type: { type: "String", maxLength: 10_000_000 } });
generateAdvancedTemplateBody(s, sql`template_id`);
```

Image URLs starting with `/` are absolutized against the registered host;
other URLs pass through, and with no registered host relative URLs stay as-is.
The editor preview and delivery share the same MJML builder; preview reads
unsaved form rows and delivery reads persisted rows.

## Variable insertion in custom editors

Use `VariableInsertMenu` from `components/variable_insert_menu` when a custom
editor needs template tokens without depending on EmailTemplatesBlock. Supply
`variables` containing `key`, `description`, and the exact `token`, then handle
`onInsert(s, variable)` with the editor's statement API. For example, plain
variables can use `{{name}}` while HTML variables use `{{{content}}}`. The menu
inserts nothing by itself: the callback owns placement and escaping semantics.

## Duplicate a template

Choose **Duplicate** in a template row’s three-dot menu. The copy opens in the
editor with ` (copy)` appended to its name. Basic content and the complete
advanced section/column/block layout are copied, including formatting, links,
and image references. Editing the copy does not change the original. The copy
retains the source’s active/disabled setting; templates used by scheduled
campaigns can also be duplicated without changing those campaigns.
