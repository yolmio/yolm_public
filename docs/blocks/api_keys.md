---
title: API Keys Block
description: Adds an encrypted `api_keys` table, a key-management UI, and header-based authentication for external API endpoints.
tags:
  - blocks
  - api
  - authentication
  - api-keys
related:
  - blocks/solution_blocks.md
  - blocks/static_secrets.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# API Keys Block

`ApiKeyBlock` adds API key management to a system: an encrypted `api_keys`
table, a self-contained management UI, and a `validateApiKey` helper that
authenticates external API requests by a request header. Use it when you
expose API endpoints (`system.api(...)`) that third parties call with a
shared key, instead of hand-rolling a key table and validation logic.

```ts
import { ApiKeyBlock, useApiKeyBlock } from "blocks/api_keys";
```

## Minimal Setup

Register the block once in `core.tsx`. It takes no constructor options.

```tsx
import { ApiKeyBlock } from "blocks/api_keys";
import { system } from "std/system";

system.addBlock(new ApiKeyBlock());
```

This creates the `api_keys` table and registers the `ApiKeyManager`
component dependency. No encryption-key configuration is required — the block
owns its own encryption key name (`api_key_encryption`).

## Tables Created

| Table      | Purpose                                 |
| ---------- | --------------------------------------- |
| `api_keys` | Stores issued keys (encrypted at rest). |

Columns on `api_keys`:

| Column       | Type           | Notes                                                                          |
| ------------ | -------------- | ------------------------------------------------------------------------------ |
| `name`       | `string(100)`  | Required. Human label for the key. Used as the record display name.            |
| `key_value`  | `secret(1000)` | Required. Encrypted secret. Defaults to the encrypted form of a random 32-byte hex value. |
| `active`     | `bool`         | Required. Defaults to `true`. Set `false` to revoke without deleting.          |
| `created_at` | `timestamp`    | Required. Defaults to `now()`.                                                 |

`key_value` is stored **encrypted (reversible)**, not hashed — the UI decrypts
it for display and copy. Treat the table as sensitive.

## Authenticating API Requests

Call `validateApiKey(s)` at the top of an endpoint procedure. It is a method on
the block instance, obtained with `useApiKeyBlock()`.

```ts
import { useApiKeyBlock } from "blocks/api_keys";
import { system } from "std/system";

const api = system.api({ prefix: "/api", domain: "example.com" });

api.post("/contacts", {
  procedure: (s) => {
    useApiKeyBlock().validateApiKey(s);
    // Reached only when the key is present and active.
    // ... endpoint logic ...
  },
});
```

Behavior of `validateApiKey(s)`:

- Reads the key from the **`yolm-api-key`** request header.
- If the header is missing: sets HTTP status `401` and returns a JSON error
  (`error: "Missing API key"`), short-circuiting the procedure.
- If no active `api_keys` row matches the supplied value: sets HTTP `401` and
  returns a JSON error (`error: "Invalid API key"`), short-circuiting the
  procedure.
- On success, execution falls through to the rest of your procedure, and a
  `key_info` record (with the matching key's `id`) is available in procedure
  scope under that fixed name.

`validateApiKey` is generic over the endpoint statement builder
(`EndpointStatements`); pass the `s` your `procedure` receives. You do not
import `EndpointStatements` yourself.

## Components

### `ApiKeyManager`

A full-page UI for creating, copying, revoking, reactivating, and deleting
keys. It is not re-exported from the package index. Reach it two ways:

```tsx
import { ApiKeyBlock } from "blocks/api_keys";
// or:
import { ApiKeyManager } from "blocks/api_keys/pages/manager";
```

It takes **no props**. It is **not self-routing** — place it inside your own
`<Route>` (or other layout):

```tsx
<Route path="/api-keys">
  <ApiKeyBlock.ApiKeyManager />
</Route>
```

The component lets a user create a key (entering only a `name`), see the
generated value once in a dialog, copy any active key, toggle a key between
active/revoked, and delete keys.

## Exports

| Export              | Kind            | Purpose                                                              |
| ------------------- | --------------- | ------------------------------------------------------------------- |
| `ApiKeyBlock`       | class           | The block. Register with `system.addBlock(new ApiKeyBlock())`.      |
| `useApiKeyBlock()`  | function        | Returns the registered block instance (`system.block(ApiKeyBlock)`). |
| `validateApiKey(s)` | instance method | Authenticates an endpoint request by the `yolm-api-key` header.     |
| `ApiKeyManager`     | component       | The management UI (also `ApiKeyBlock.ApiKeyManager`).               |

## Common Mistakes

- Sending the key in the `Authorization` header. The block reads the
  **`yolm-api-key`** header (the built-in error message text mentioning
  "Authorization" is misleading).
- Calling `useApiKeyBlock()` or rendering `ApiKeyManager` without first
  registering `new ApiKeyBlock()` in `core.tsx`.
- Importing `ApiKeyManager` from `blocks/api_keys` — it is only available from
  `blocks/api_keys/pages/manager` or as `ApiKeyBlock.ApiKeyManager`.
- Wrapping `ApiKeyManager` as if it were self-routing — it is a plain
  component and must be placed inside a `<Route>` or layout you provide.
- Expecting one-way hashed keys. Values are stored encrypted and can be
  decrypted/re-copied from the UI; guard access to the page and table
  accordingly.
