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

`EmailTemplatesBlock` adds an editable email-template store plus all the
editing UI to your system. Templates come in two flavors (the
`email_template_type` enum):

- **basic** — a single Lexical rich-text body (stored as JSON) for short
  transactional emails.
- **advanced** — a structured layout of sections → columns → blocks
  (text, button, image, divider, spacer, raw HTML/SQL), edited block by block.

The block owns the schema and the editor pages. It does not send mail; it
renders **advanced** templates to MJML/HTML via `generateAdvancedTemplateBody`,
and exposes an HTTP API for hosting images embedded in templates. It is the
provider for `MarketingEmailCampaignBlock` and CRM composers, which consume
both the `email_templates` table and the renderer.

Use this block instead of building custom schema whenever you need
user-editable, reusable email layouts.

```typescript
import {
  EmailTemplatesBlock,
  registerEmailTemplateImagesApi,
  generateAdvancedTemplateBody,
} from "blocks/email_templates";
```

## Minimal Setup

Register the block in `core.tsx`:

```typescript
import { EmailTemplatesBlock } from "blocks/email_templates";

system.addBlock(new EmailTemplatesBlock());
```

Mount the editor pages inside an app's route tree. `EmailTemplatesBlock.Pages`
is a self-routing static — do not wrap it in your own `<Route>`:

```tsx
import { EmailTemplatesBlock } from "blocks/email_templates";

// ...placed among the app's routes:
<EmailTemplatesBlock.Pages />
```

Use `wrapper` when every template route needs the same authorization or page
guard. The wrapper is rendered inside each route, so the self-routing pages
must still remain direct children of the app route tree:

```tsx
<EmailTemplatesBlock.Pages
  wrapper={(children) => <TemplatePermissionGuard>{children}</TemplatePermissionGuard>}
/>
```

This registers four routes and an "Email Templates" navigation entry:

| Route | Page |
| --- | --- |
| `/email-templates` | Template list (create / enable / disable / delete) |
| `/email-templates/{record_id:id}` | Editor, dispatched by template `type` |
| `/email-templates/new-basic` | New basic template editor |
| `/email-templates/new-advanced` | New advanced template editor |

## Configuration

`new EmailTemplatesBlock(opts?)` accepts optional variable maps used by the
editor and rendering helpers:

| Option | Type | Meaning |
| --- | --- | --- |
| `recipientVariables` | `Record<string, string>` | Named recipient variables exposed to template authors and resolved from the configured recipient record. |
| `linkVariables` | `Record<string, string>` | Named link variables exposed to template authors and resolved when rendering links. |

Image-hosting configuration is supplied separately through
`registerEmailTemplateImagesApi` (see below), which sets the block's
`imageHost` / `imageBasePath` fields used when absolutizing inline image URLs
during rendering.

## Tables Created

All tables skip sample-data generation by default; the block seeds one basic
and one advanced sample template via `beforeGenerateSampleData`.

| Table | Purpose / key columns |
| --- | --- |
| `email_templates` | One row per template. `name`, `subject`, `preview_text`, `background_color`, `type` (`email_template_type`), `is_active` (default `true`), `body` (JSON Lexical content, **basic templates only**). |
| `email_sections` | Advanced layout rows. `email_template_id` fk, `order`, `full_width`, background (`background_type`, `background_color`, `background_image_url`, `background_behavior`), `vertical_align`, `mobile_display`, border (`border_style`/`border_color`/`border_width`), `padding_*`. |
| `email_columns` | `email_section_id` fk, `order`, `width` (percentage). |
| `email_blocks` | `email_column_id` fk, `order`, `type` (`email_block_type`), `background_color`, `padding_*`, plus type-specific columns: `button_*`, `image_*`, `divider_*`, `spacer_height`, `raw_html`, and `text_content` (JSON Lexical for text blocks). |
| `email_template_images` | Hosted inline images. `blob_hash` (`blobRef`, unique), `content_type`. |

## Enums Created

| Enum | Values |
| --- | --- |
| `email_template_type` | `basic`, `advanced` |
| `email_section_background_type` | `color`, `image` |
| `email_section_vertical_align` | `top`, `middle`, `bottom` |
| `email_section_mobile_display` | `normal`, `reversed`, `no-stack` |
| `email_section_border_style` | `solid`, `dashed`, `dotted`, `double` |
| `email_section_background_behavior` | `stretch`, `no-repeat`, `repeat-x`, `repeat-y`, `repeat` |
| `email_block_type` | `text`, `button`, `divider`, `spacer`, `image`, `sql` |
| `email_block_button_align` | `left`, `center`, `right` |
| `email_block_image_align` | `left`, `center`, `right` |
| `email_block_image_shape` | `square`, `circle`, `rounded` |
| `email_block_divider_border_style` | `solid`, `dashed`, `dotted`, `double` |
| `drop_target_location` | `top`, `bottom` |

## Pages and Components

The recommended entry point is the `EmailTemplatesBlock.Pages` static shown
above. The underlying components are also exported from their submodules if you
need custom routing. `EmailTemplateListPage` takes a `path` and is self-routing
(it registers its own `<Route>` and nav item). The three editor components take
a `recordId` (`NumericExpr`) — pass `sql.null` for the "create new" form — and
are not self-routing, so place them inside your own `<Route>` (as
`EmailTemplatesBlock.Pages` does).

| Component | Import | Prop | Type | Meaning |
| --- | --- | --- | --- | --- |
| `EmailTemplateListPage` | `blocks/email_templates/email_template_list` | `path` | `string` | Route path; also adds a nav item with this URL. Self-routing. |
| `EmailEditor` | `blocks/email_templates/email_editor` | `recordId` | `NumericExpr` | Loads the record and renders the basic or advanced editor based on its `type`. |
| `BasicEmailEditorLexical` | `blocks/email_templates/lexical_basic_editor` | `recordId` | `NumericExpr` | Basic single-body editor (`sql.null` for a new template). |
| `AdvancedEmailEditorLexical` | `blocks/email_templates/lexical_advanced_editor` | `recordId` | `NumericExpr` | Section/column/block drag-and-drop editor (`sql.null` for new). |

Both editors read recipient and link variables configured directly on
`EmailTemplatesBlock`. The basic body field uses a minimal `{{email}}` /
`{{name}}` fallback when no recipient variables are available.

## `registerEmailTemplateImagesApi`

Images inlined by the editor are stored in `email_template_images` and served
from your own domain so mail clients can fetch them. Call this **once** from
the app/API surface where the images should be hosted; it registers the
read endpoint and records the absolute host the renderer uses to absolutize
relative image URLs.

Register it after `EmailTemplatesBlock`, but **before** adding any campaign
block or generating procedures that call `generateAdvancedTemplateBody`.
The renderer captures the host at generation time; registering it later in an
app file does not update an already-generated campaign worker.

```typescript
import { registerEmailTemplateImagesApi } from "blocks/email_templates";

registerEmailTemplateImagesApi({ domain: "assets.example.com" });
// optional overrides:
// registerEmailTemplateImagesApi({
//   domain: "api.example.com",
//   prefix: "/api",                       // default
//   route: "/email-template-images",      // default
// });
```

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `domain` | `string` | yes | Public domain images are served from (no scheme; `https://` is added). |
| `prefix` | `string` | no | API prefix. Default `"/api"`. |
| `route` | `string` | no | Route under the prefix. Default `"/email-template-images"`. |

It registers `GET {prefix}{route}/{hash_hex}`, which returns the stored bytes
with the saved `Content-Type` and `Cache-Control: max-age=31536000, immutable`,
or `404` when no image matches the content hash. It returns
`{ baseUrl, basePath }` for reuse elsewhere and sets the block's `imageHost`
so `generateAdvancedTemplateBody` can rewrite relative URLs.

## `generateAdvancedTemplateBody`

Server-side helper that assembles the MJML for an **advanced** template,
renders it to HTML (via `s.renderMjml`), and writes the result into a procedure
scalar named `merged_body`. Call it from a procedure (for example an outbox
reactor's `setup`) before sending.

The editor preview and delivery share the same MJML builder, including button
full width and inner padding, column alignment, and reversed/no-stack mobile
layouts. Preview reads unsaved form rows; delivery reads persisted rows and
resolves uploaded image URLs against the registered host.

```typescript
import { generateAdvancedTemplateBody } from "blocks/email_templates";

// The helper writes into `merged_body` with setScalar, so it MUST already exist:
s.defScalar("merged_body", { type: { type: "String", maxLength: 10_000_000 } });

generateAdvancedTemplateBody(s, sql`template_id`);
// `merged_body` now holds the rendered HTML body.
```

Signature: `generateAdvancedTemplateBody(s, templateId)` where `s` is an
`IServerBaseStatements` builder and `templateId` is an `AnyExpr` resolving to
an `email_templates.id`. Image URLs that start with `/` are absolutized against
the host captured by `registerEmailTemplateImagesApi`; URLs that do not (e.g.
already-absolute `https://` URLs) pass through unchanged. If no image host was
registered, relative URLs are left as-is. This helper handles advanced
templates only — render basic templates from their `body` JSON directly.

## Common Mistakes

- Wrapping `EmailTemplatesBlock.Pages` or `EmailTemplateListPage` in your own
  `<Route>` or an outer runtime component — they are self-routing. Use their
  `wrapper` prop for authorization or layout around the route contents.
- Calling `generateAdvancedTemplateBody` without first defining the
  `merged_body` scalar — the helper uses `setScalar` and will fail if the
  scalar does not already exist.
- Skipping `registerEmailTemplateImagesApi`: editor-uploaded images are stored
  with relative URLs, so without a registered host they stay relative and break
  for email recipients.
- Expecting the block to send email. It only produces HTML; deliver it through
  a service (e.g. [Postmark](../services/postmark.md)) or via
  `BulkEmailDeliveryBlock` or `ConnectedAccountEmailDeliveryBlock` through an
  owning campaign/composer workflow.
- Mixing storage: basic templates use `email_templates.body`; advanced
  templates use the `email_sections` / `email_columns` / `email_blocks` tree.
