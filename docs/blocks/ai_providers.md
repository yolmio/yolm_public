---
title: AI Providers Block
description: Configures OpenAI/Anthropic/Gemini-compatible AI providers with config tables, an admin page, and server helpers for text generation and file uploads.
tags:
  - blocks
  - ai
  - llm
  - integrations
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# AI Providers Block

`AiProvidersBlock` adds schema and runtime helpers for talking to OpenAI-,
Anthropic-, and Gemini-compatible LLM HTTP APIs. It creates the
`ai_providers`, `ai_models`, and `ai_provider_headers` tables, ships an admin
page for configuring endpoints and API keys at runtime, and exposes server
helpers that normalize each provider's message format so callers issue one
`generateText` / `uploadFileToProvider` call regardless of provider.

Use it when an app needs configurable, swappable LLM endpoints managed by
admins. Build custom schema only if you have a single hard-coded provider and
never let admins reconfigure it.

```ts
import {
  AiProvidersBlock,
  aiProviderTypes,
  type AiProvider,
  type AiProviderHeader,
  uploadFileToProvider,
  useAiProvidersBlock,
} from "blocks/ai_providers";
```

## Minimal Setup

Register the block in `core.tsx`. No options are required — providers are
added at runtime through the admin page.

```ts
import { system } from "std/system";
import { AiProvidersBlock } from "blocks/ai_providers";

system.addBlock(new AiProvidersBlock());
```

Then expose the configuration page in an app. Because the page is self-routing
by default, pass `withoutRoute` when you want it under your own `<Route>`:

```tsx
import { AiProvidersBlock } from "blocks/ai_providers";
import { AppRoutes, Route } from "std/ui";

<AppRoutes>
  <Route path="/providers">
    <AiProvidersBlock.ConfigureAiProvidersPage withoutRoute />
  </Route>
</AppRoutes>;
```

## Configuration

The constructor takes a single optional object.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `providers` | `AiProvider[]` | No | Provider definitions stored on the instance. Default `[]`. |

Providers are configured at runtime via `ConfigureAiProvidersPage` and
persisted in the `ai_providers` table; the example registers the block with no
arguments. The `providers` array is stored on the block instance only — it is
**not** seeded into the database by `initialize()`, so passing it has no
runtime effect today.

## Tables Created

| Table | Purpose |
| --- | --- |
| `ai_providers` | One row per endpoint. Columns: `provider_name` (string, unique), `base_url` (string), `api_key` (text), `provider_type` (`ai_provider_type` enum). Record display name: `provider_name`. |
| `ai_models` | Models per provider. FK `ai_provider_id`, `model_name`, `context_length` (int), `vision_support` (bool, default `false`), and per-million pricing decimals `input_cost_per_million`, `output_cost_per_million`, `cache_read_cost_per_million`, `cache_write_cost_per_million` (precision 10, scale 6). Unique on (`ai_provider_id`, `model_name`). |
| `ai_provider_headers` | Extra HTTP headers per provider. FK `ai_provider_id`, `header_key`, `header_value`. |

The block also defines the `ai_provider_type` enum with values
`open_ai_compatible`, `anthropic_compatible`, and `gemini_compatible`
(display helper `fn.display_ai_provider_type`).

## Pages

### `AiProvidersBlock.ConfigureAiProvidersPage`

Static page on the block class. Renders the full admin UI: add/edit/delete
providers, their models, and custom headers, plus a per-provider "Test
Connection" button.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route path. Default `"/ai-providers"`. Ignored when `withoutRoute` is set. |
| `withoutRoute` | `boolean` | No | When `true`, render the page body without its own `<Route>` wrapper; the caller supplies the surrounding route. |

By default the page is self-routing (it wraps itself in `<Route>`), so do not
nest it in another `<Route>` unless you pass `withoutRoute`.

## Helpers

Create the helper instance with `useAiProvidersBlock()`. `generateText` and
`uploadFileToProvider` run in server scope (`IServerBaseStatements`, e.g.
inside `s.tryServer`). `insertAttachment` runs in client (DOM) scope and calls
the server internally.

### `generateText(s, opts)`

Call as `useAiProvidersBlock().generateText(s, opts)`. Builds the
provider-appropriate request body from a messages query and writes the
generated text into the `opts.resultScalar` string scalar.

This helper does **not** create the structured result record — define it
yourself before calling (see the result-record fields below). It does define
the result scalar for you.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `providerType` | `Sql` | Yes | One of `'open_ai_compatible'`, `'anthropic_compatible'`, `'gemini_compatible'`. |
| `model` | `Sql` | Yes | Model name. |
| `messagesQuery` | `Sql` | Yes | Query returning `role` (String), `content` (String), `message_id` (BigInt), optional `cache_marker` (Bool), optional `files` (Json). |
| `resultScalar` | `string` | Yes | Name of the string scalar to receive the generated text. |
| `apiKey` | `Sql` | Yes | Provider API key. |
| `resultRecord` | `string` | No | Structured-result record name. Default `"llm_result"`. |
| `baseUrl` | `Sql` | No | Endpoint URL. Defaults to the provider's standard URL. |
| `systemInstruction` | `Sql` | No | System prompt. |
| `attachmentsQuery` | `Sql` | No | Query returning `message_id` (BigInt), `mime_type` (String), `content` (String, base64) for inline image attachments. |
| `enableCaching` | `boolean` | No | Enable prompt caching (Anthropic only). |
| `pricing` | `{ inputCostPerMillion: Sql; outputCostPerMillion: Sql; cacheReadCostPerMillion: Sql; cacheWriteCostPerMillion: Sql }` | No | Per-million-token pricing used to compute `total_cost`. |

`role` values are `'user'`, `'assistant'`, `'model'`, or `'system'`. For
OpenAI a `'system'` row is mapped to a system message; for Anthropic and
Gemini non-user roles map to the assistant/model role.

The option type also accepts `headers?: AiProviderHeader[]` and
`headersQuery?: Sql`, but neither is forwarded to the provider request in the
current implementation (the underlying services build their own headers, e.g.
the API key), so they have no effect — omit them.

You must define the structured result record before calling. The default name
is `llm_result` with these fields: `success` (Bool), `http_status` (Int),
`error_message` (String), `is_rate_limit` (Bool), `content` (String),
`input_tokens` (Int), `output_tokens` (Int), `cache_read_tokens` (Int),
`cache_write_tokens` (Int), and `total_cost` (Decimal, precision 10 scale 6).

```ts
// Runs in server scope (e.g. inside s.tryServer). `providerId` is in scope.
const ai = useAiProvidersBlock();

// generateText does not create the structured result record — define it first.
s.defRecord("llm_result", {
  fields: [
    { name: "success", type: "Bool" },
    { name: "http_status", type: "Int" },
    { name: "error_message", type: "String" },
    { name: "is_rate_limit", type: "Bool" },
    { name: "content", type: "String" },
    { name: "input_tokens", type: "Int" },
    { name: "output_tokens", type: "Int" },
    { name: "cache_read_tokens", type: "Int" },
    { name: "cache_write_tokens", type: "Int" },
    {
      name: "total_cost",
      type: { type: "Decimal", precision: 10, scale: 6, signed: true },
    },
  ],
  allowNoRead: true,
});

ai.generateText(s, {
  providerType:
    sql`(select provider_type from ai_providers where id = ${providerId})`,
  model:
    sql`(select model_name from ai_models where ai_provider_id = ${providerId})`,
  messagesQuery:
    sql`select role, content, message_id from chat_messages order by message_id`,
  apiKey: sql`(select api_key from ai_providers where id = ${providerId})`,
  baseUrl: sql`(select base_url from ai_providers where id = ${providerId})`,
  resultScalar: "answer",
});
// `answer` holds the generated text; `llm_result` holds the structured result.
```

### `uploadFileToProvider(s, opts)`

Standalone exported function (not a block method). Uploads a file to the
provider's Files API and normalizes the response. Supports Anthropic and
Gemini provider types only. Unlike `generateText`, it defines its own result
record.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `providerType` | `Sql` | Yes | `'anthropic_compatible'` or `'gemini_compatible'`. |
| `apiKey` | `Sql` | Yes | Provider API key. |
| `fileContent` | `Sql` | Yes | File bytes. |
| `filename` | `Sql` | Yes | File name. |
| `mimeType` | `Sql` | Yes | MIME type. |
| `resultRecord` | `string` | No | Result record name. Default `"file_upload_result"`. |

The result record contains: `success` (Bool), `provider_file_id` (String),
`size_bytes` (Int), `filename` (String), `mime_type` (String), `downloadable`
(Bool), `created_at` (String), `expires_at` (String, Gemini only), and
`error_message` (String). Any other provider type yields a failure row with an
explanatory `error_message`.

### `insertAttachment(s, opts)`

Call as `useAiProvidersBlock().insertAttachment(s, opts)`. Client-side
(`DomStatements`) helper that reads transferred DOM files, validates the type
(`image/png`, `image/jpeg`, `image/jpg`, `application/pdf`), base64-encodes
each accepted file, and invokes your server callback with the encoded content.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `providerType` | `Sql` | Yes | Provider type (part of the type signature; not used by the current implementation). |
| `model` | `Sql` | Yes | Model name (part of the type signature; not used by the current implementation). |
| `attachmentsQuery` | `Sql` | Yes | Attachments query (part of the type signature; not used by the current implementation). |
| `beforeSubmitClient` | `(s: DomStatements) => void` | No | Runs client-side before upload. |
| `onUploadSuccessServer` | `(s: UiServerStatements, file: Sql) => void` | No | Server callback; `file` is the base64 content of each accepted file. |
| `onUploadErrorClient` | `(s: DomStatements) => void` | No | Client-side error callback. |

### `useAiProvidersBlock()`

Returns a fresh `AiProvidersBlock` instance for calling its instance methods
(`generateText`, `insertAttachment`) from procedure code.

## Exported Types and Constants

- `AiProvider` — `{ name, displayName, baseUrl, apiKey, model, contextLength, providerType, headers? }`, where `providerType` is one of `'open_ai_compatible'`, `'anthropic_compatible'`, `'gemini_compatible'`. Shape for the constructor `providers` option.
- `AiProviderHeader` — `{ headerKey, headerValue }`.
- `aiProviderTypes` — array of `{ name, displayName }` for the three supported provider types; backs the `ai_provider_type` enum.

## External-Service Options

The block declares two `externalServiceOptions` (used by Yolm's external
service access controls):

- `generate_text` — "Generate text via AI APIs".
- `upload_files` — "Upload files to AI providers".

## Common Mistakes

- Wrapping `ConfigureAiProvidersPage` in your own `<Route>` without passing `withoutRoute` — it is self-routing by default, producing nested routes.
- Expecting the constructor `providers` array to seed the database. It is not seeded; configure providers at runtime through the admin page.
- Calling `generateText` without first defining the structured result record (default `llm_result`). The helper populates it but does not create it.
- Prefixing db tables with `db.` inside `generateText` SQL. These helpers run in server scope, where db tables are referenced bare (e.g. `select api_key from ai_providers ...`).
- Omitting required `messagesQuery` columns. `role`, `content`, and `message_id` are mandatory; `cache_marker` and `files` are optional.
- Calling `uploadFileToProvider` with an OpenAI-compatible provider — only Anthropic and Gemini are supported; other types return a failure row.
- Reading only `resultScalar` and ignoring the structured result record, which carries `success`, `error_message`, token counts, and cost.
- Calling `generateText` or `uploadFileToProvider` outside server scope; both require `IServerBaseStatements` (run them inside `s.tryServer`/server statements).
