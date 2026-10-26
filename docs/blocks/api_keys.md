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

`ApiKeyBlock` issues keys that third parties send to your `system.api(...)`
endpoints. It adds an encrypted `api_keys` table, a management UI, and a
`validateApiKey` helper, so you do not hand-roll key storage or validation.

## Minimal Setup

Register the block once in `core.tsx`. It takes no constructor options and
owns its encryption key name (`api_key_encryption`).

```tsx
import { ApiKeyBlock } from "blocks/api_keys";
import { system } from "std/system";

system.addBlock(new ApiKeyBlock());
```

## Owned Tables

| Table      | Purpose                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `api_keys` | Issued keys. `active = false` revokes a key without deleting the row. |

`key_value` is stored **encrypted (reversible)**, not hashed: the UI decrypts
it for display and copy. Guard access to the table and management page.

## Authenticating API Requests

Call `validateApiKey(s)` at the top of an endpoint procedure, passing the `s`
your `procedure` receives.

```ts
import { useApiKeyBlock } from "blocks/api_keys";
import { system } from "std/system";

const api = system.api({ prefix: "/api", domain: "example.com" });

api.post("/contacts", {
  procedure: (s) => {
    useApiKeyBlock().validateApiKey(s);
    // Reached only when the key is present and active.
  },
});
```

- Reads the key from the **`yolm-api-key`** request header, not
  `Authorization` (the built-in error message mentioning "Authorization" is
  misleading).
- Missing header: HTTP `401` with JSON `error: "Missing API key"`.
- No active matching row: HTTP `401` with JSON `error: "Invalid API key"`.
- On success, a `key_info` record holding the matching key's `id` is in
  procedure scope under that fixed name.

## Components

`ApiKeyManager` (no props) creates, copies, revokes, reactivates, and deletes
keys; a new key's value is shown once in a dialog after creation. It is not
exported from the package index: use `ApiKeyBlock.ApiKeyManager` or import it
from `blocks/api_keys/pages/manager`. It is not self-routing:

```tsx
<Route path="/api-keys">
  <ApiKeyBlock.ApiKeyManager />
</Route>
```

`useApiKeyBlock()` returns the registered instance; it and `ApiKeyManager`
require `new ApiKeyBlock()` to be registered first.
