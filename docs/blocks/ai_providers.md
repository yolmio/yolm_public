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

`AiProvidersBlock` stores admin-configurable OpenAI-, Anthropic- and
Gemini-compatible LLM endpoints and exposes server helpers that normalize each
provider's message format behind one `generateText` / `uploadFileToProvider`
call. Exports: `AiProvidersBlock`, `useAiProvidersBlock`,
`uploadFileToProvider`, `aiProviderTypes`, and types `AiProvider`,
`AiProviderHeader` (all from `blocks/ai_providers`).

## Minimal Setup

Register the block in `core.tsx`; providers are added at runtime through the
admin page.

```ts
import { system } from "std/system";
import { AiProvidersBlock } from "blocks/ai_providers";

system.addBlock(new AiProvidersBlock());
```

The configuration page is self-routing (default path `/ai-providers`); pass
`withoutRoute` to place it under your own `<Route>`:

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

The constructor accepts `{ providers?: AiProvider[] }`. The array is kept on
the instance only and is not seeded into the database: it has no effect.

## Tables Created

| Table | Purpose |
| --- | --- |
| `ai_providers` | One row per endpoint: name, base URL, API key and `ai_provider_type` (`open_ai_compatible`, `anthropic_compatible`, `gemini_compatible`). |
| `ai_models` | Models per provider with context length, vision flag and per-million-token pricing. |
| `ai_provider_headers` | Extra HTTP headers per provider, editable on the admin page. They are not sent by `generateText` or the Test Connection button. |

`ai_providers.api_key` is a plain text column readable by anyone with table
access. For long-lived keys prefer storing them as encrypted server-side static
secrets that are never seeded, and pass
`getStaticSecret(...)` as the `apiKey` option of `generateText` /
`uploadFileToProvider`.

## Pages

`AiProvidersBlock.ConfigureAiProvidersPage` (props `path?`, `withoutRoute?`)
renders the admin UI for providers, models and headers, with a per-provider
"Test Connection" button.

## Helpers

`useAiProvidersBlock()` returns a block instance for calling `generateText` and
`insertAttachment`. `generateText` and `uploadFileToProvider` require server
scope (`IServerBaseStatements`, e.g. inside `s.tryServer`); `insertAttachment`
runs in client (DOM) scope.

### `generateText(s, opts)`

Builds the provider-specific request from a messages query, defines and fills
the `resultScalar` string scalar, and fills the structured result record
(`success`, `http_status`, `error_message`, `is_rate_limit`, token counts,
`total_cost`). It does **not** define that record: declare it first, exactly as
in the example below.

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

The option type also accepts `headers` and `headersQuery`; they have no effect.

```ts
// Runs in server scope (e.g. inside s.tryServer). `providerId` is in scope.
const ai = useAiProvidersBlock();

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

Standalone export (not a block method). Uploads to the provider's Files API
for Anthropic and Gemini only; other provider types yield a failure row. It
defines its own result record.

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `providerType` | `Sql` | Yes | `'anthropic_compatible'` or `'gemini_compatible'`. |
| `apiKey` | `Sql` | Yes | Provider API key. |
| `fileContent` | `Sql` | Yes | File bytes. |
| `filename` | `Sql` | Yes | File name. |
| `mimeType` | `Sql` | Yes | MIME type. |
| `resultRecord` | `string` | No | Result record name. Default `"file_upload_result"`. |

Result fields include `success`, `provider_file_id`, `error_message` and
`expires_at` (Gemini only).

### `insertAttachment(s, opts)`

Reads transferred DOM files, accepts `image/png`, `image/jpeg`, `image/jpg`
and `application/pdf`, base64-encodes each one and calls
`onUploadSuccessServer(s, file)` with the encoded content. Optional
`beforeSubmitClient` and `onUploadErrorClient` run client-side. The required
`providerType`, `model` and `attachmentsQuery` options have no effect.

## External-Service Options

`externalServiceOptions`: `generate_text` and `upload_files`.

## Gotchas

- Unqualified table names resolve against the scope order, and `generateText`
  defines procedure tables of its own (for example `headersQuery` defines a
  local `ai_provider_headers`). Qualify persistent tables as `db.ai_providers`
  when a procedure-local or `ui.*` name could shadow them; bare names are
  equally valid otherwise.
- `messagesQuery` must return `role`, `content` and `message_id`;
  `cache_marker` and `files` are optional.
- Check `success` / `error_message` on the result record, not just the result
  scalar.
