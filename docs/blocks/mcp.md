---
title: Tenant MCP connections
description: Connect external assistants to one Yolm Forge or Spark through tenant-owned OAuth and stateless JS execution.
tags:
  - mcp
  - authentication
  - spark
  - forge
---

# Tenant MCP connections

Each Forge instance and each system hosting Spark owns its grants. Clients can
connect through the public gateway or directly to a tenant endpoint.

## Public gateway

The remote Streamable HTTP endpoint is `https://mcp.yolm.ai/mcp`. Browser OAuth
connects the client, and each attached system requires its own tenant sign-in
and consent. A direct tenant connection does not grant gateway access.

`yolm_list_systems` lists attachments; `yolm_attach_system` returns a consent URL
for another system; `forge_inspect`/`spark_inspect` return API references and
capabilities. Routed calls take a `domain`, and tenant tools are prefixed
(`execRead` becomes `forge_exec_read` or `spark_exec_read`):

```json
{
  "name": "forge_exec_read",
  "arguments": {
    "domain": "example.yolmforge.ai",
    "code": "text(await searchDocs({query: 'forms'}));"
  }
}
```

[Public docs, packages and examples](https://github.com/yolmio/yolm_public)
need no login and may lag the deployed version; tenant schemas, source and data
require authorized MCP access. Setup and privacy: <https://yolm.ai/mcp>.

## Direct tenant endpoints

- Forge: `/api/forge/mcp`, setup and consent at `/settings/connected-assistants`.
- Spark: `/api/spark/mcp`, setup and consent at `<Spark basePath>/connected-assistants`.

The setup page shows the endpoint, available access, connected assistants
(grouped by assistant name) and revoke controls.
`TenantMcpOptions.capabilityLabels` maps stored capability names to the labels
shown there; Spark fills it from its capability labels. OAuth uses the
application's existing login and explicit consent UI. Yolm never receives the
client's model-provider credentials or selects the external model.

## Authentication and persistence

For direct tenant OAuth, `blocks/mcp` installs two tenant-owned tables:
`mcp_clients` (registered client metadata) and `mcp_connections` (pending
consent through code exchange to a live connection, holding the local user,
access, capability grant and hashes of opaque credentials). No per-tenant
signing secret is needed.

OAuth metadata is at `/.well-known/oauth-protected-resource/api/<surface>/mcp`
and `/.well-known/oauth-authorization-server/oauth/<surface>`; the issuer
`/oauth/<surface>` exposes `register`, `authorize`, `token` and `revoke`.
Registration accepts public clients (`token_endpoint_auth_method: none`) with
HTTPS, loopback HTTP or private-use app-scheme callbacks. Authorization requires
S256 PKCE and an exact registered redirect (loopback may use any port).
Replaying a rotated refresh token revokes the connection.

Current user permissions and revocation are checked at execution. Spark grants
snapshot the allowed capability names; newly available capabilities require a
new consented connection.

MCP transport is stateless (no transport session, SSE stream or MCP session
ID); the client conversation is not copied. An execution may complete earlier
operations before a later failure, so a timeout does not mean nothing happened.

## Access profiles

| Surface | Permissions | OAuth scopes |
| --- | --- | --- |
| Forge | `can_connect_mcp_read`, `can_connect_mcp_develop` (also needs `edit_code`) | `forge:read`, `forge:develop` |
| Spark | `can_connect_mcp_read`, `can_connect_mcp_act` | `spark:read`, `spark:act` |

Write permission implies read eligibility; existing application, capability
and action permissions still apply. Consent defaults to Read; Develop/Act is
selectable only when the client requests it and current permissions allow it.
Grants never expand implicitly, and revoking a permission blocks existing
grants on the next call.

Read grants expose `list_sessions` and `execRead` (`readOnlyHint: true`); write
grants add `create_session` and `exec` (`destructiveHint: true`). Spark
execution advertises `openWorldHint: true` even for reads because functions may
query external services. Mutating tools reject read-only execution at runtime.

## Forge

Forge behavior (sessions, versions, editing, validation, previews, deployment)
is documented in the Forge guides, for example
[Forge code](../ai/forge_code.md), [Forge versions](../ai/forge_versions.md)
and [Forge deployment planning](../ai/forge_deploy.md). MCP-specific contract:

- Use `list_sessions` / `create_session`; inside `exec({sessionId, code})` call
  `listVersions()` or `createVersion({parentVersionId?})`, where
  `parentVersionId: "live"` builds on production (see
  [Forge versions](../ai/forge_versions.md)). Source edits need
  both `sessionId` and a version ID; `applyPatch(operations)` is a JavaScript
  function, not an MCP tool. There is no mutable current version between calls
  and no expected tree hash.
- Source reads (`readFile`, `treeFiles`, `findFiles`, `grepFiles`,
  `inspectSystem`, `planProductionPipeline`) default to the live version when
  no version ID is given; mutating version tools require an explicit one.
- Read exposes the audited inspection subset; tests and previews require
  Develop. Deployment execution is absent. Production-affecting plans
  (`planDeploy`, `planProductionPipeline`, `planProductionSnapshot`,
  `planBackgroundAction` with `can_deploy`; `planEdgeAccess` with
  `manage_edge`, see [Forge Edge](../ai/forge_edge.md)) only return a Forge
  review link a person confirms. The only production coordination write is
  `resolveProductionPipelineReview`.
- Creation calls are not deduplicated; inspect sessions/versions before
  retrying a lost response.
- Native and MCP callers share the `forge_exec` stored procedure and one tool
  environment with runtime read-only guards. Externally created artifacts carry
  an `external` source. Initialization returns an API reference, the Yolm
  overview, design rules, and skill map shared with native Forge, and the Drive
  file index; it does not inject the native agent persona or
  `drive/context.md`, which remain readable as task data.

## Spark, sessions and skills

`execRead({code, sessionId?})` supports stateless analysis; supplying a session
loads its saved task context and capability subset. `exec({code, sessionId})`
requires a named external session. Create one with
`create_session({name, context?})`, which returns its durable review URL.
Session context is task input, not an authorization grant.

The runtime uses native `tools.*`, each capability's query policy
(`tables`/`views` and `fieldWhitelist`/`fieldBlacklist` column grants),
declared file sources, PDF/image tools, spreadsheet helpers and capability
functions. The processing-backed `outputWidth` PDF region renderer requires Act
access; ordinary page renders and pixel crops are read-only.

Functions are read-only by the Spark contract and are available in Read and Act
profiles, subject to capability permissions. Writes belong in actions, which
are unavailable in Read. Initialization returns a technical API reference,
permitted capability catalog, a "Connected as" line (display name and auth
roles), a note that Spark does not expose application source code, the
workspace root `AGENTS.md` labeled as
organization reference (omitted when absent), a skill catalog (name,
description and `SKILL.md` path of each valid skill) and governed document
index. The text is descriptive: it does not inject the native agent persona or
harness, or direct the client to follow skills. Clients read skills and other
workspace files through `tools.listFiles` and `tools.readFile`;
`tools.readCapability` returns schemas and operation contracts.
The catalog is an initialization snapshot; runtime permission checks apply to
every operation. Native Yolm agent guidance is unchanged.

Each action call is a new operation returning `action_id` and status;
`tools.actionReceipt({receiptId: action_id})` retrieves the outcome. There are
no action request keys or input hashes, and scripts are not atomic: inspect
work after a lost response before retrying.

Mutable execution records an external Spark run and execution event in the
session (submitted code, actions and saved artifacts attach to it); external
runs never enter the native reactors. Read-only calls create no session, run,
event or artifact.

Reversible actions use native preflight, transactional execution, receipt
recovery and Undo; `tools.undoReceipt({receiptId})` targets one reversible
action. Pending approvals use the application's `approvalUi` and session
controls and apply only to the displayed IDs and inputs. There is no
model-callable approval function and no automatic resumption of the external
chat.

Disconnecting an assistant prevents new requests but does not delete saved work
or proposals. Sessions belong to their user, not an OAuth connection, so
another authorized connection for that user can continue them.

Save deliverables with `tools.saveArtifact({name, mimeType, text | bytes})`
(immutable, Yolm blob storage, 16 MiB each); read them back with
`tools.listArtifacts()` and `tools.readArtifact({id})`. `text()` and `image()`
return MCP content without saving it.

## Spark opt-out and schema

Set `mcp: false` on `SparkBlock` to omit MCP endpoints, connection settings and
OAuth schema installation by that block; the session UI still shows existing
external work, and another block that installs MCP keeps the shared OAuth
tables. MCP-related schema: nullable `spark_agents.execution_mode` (`native` or
`external`; null means native), a Forge `external` artifact-source value and
nullable `artifacts.created_by`, plus the two OAuth tables. Removing MCP from a
deployed schema orphans its data under normal schema-removal rules; it is not
credential erasure.
