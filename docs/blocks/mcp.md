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
for another system. `forge_inspect` and `spark_inspect` return API references and
available capabilities. Routed calls take a `domain`. Tenant execution tools
are prefixed `forge_` or `spark_`; `execRead` becomes `forge_exec_read` or
`spark_exec_read`. For example:

```json
{
  "name": "forge_exec_read",
  "arguments": {
    "domain": "example.yolmforge.ai",
    "code": "text(await searchDocs({query: 'forms'}));"
  }
}
```

[Public documentation and packages](https://github.com/yolmio/yolm_public)
can be read or cloned without a Yolm login. Documentation search stays available
through Forge MCP; tenant-specific schemas, source, references and business data
require authorized MCP access. The public mirror may lag the deployed version.
Setup and privacy information: <https://yolm.ai/mcp>.

## Direct tenant endpoints

- Forge: `/api/forge/mcp`, setup and consent at `/settings/connected-assistants`.
- Spark: `/api/spark/mcp`, setup and consent at `<Spark basePath>/connected-assistants`.

The setup page displays the endpoint, current available access, connected
assistants, and revoke controls. Add that endpoint in the client's MCP settings.
OAuth opens the same application's existing login and explicit consent UI.
Opening the page alone does not grant access. Provider authentication remains
with the user's client; Yolm does not receive subscription credentials or
select the external model.

## Authentication and persistence

For direct tenant OAuth, shared code in `blocks/mcp` installs two tenant-owned tables: `mcp_clients`
contains registered client metadata; `mcp_connections` progresses from pending
consent through authorization-code exchange to a live connection. It stores the
local user, access, capability grant, and hashes of opaque credentials. No
per-tenant signing secret is needed.

Authorization codes require S256 PKCE, an exact registered redirect, a matching
client and resource, and expire after two minutes following consent. Access
tokens last an hour. Refresh tokens rotate and expire after 30 days; spent
refresh hashes remain on the connection until expiry so replay revokes the
connection. Replay history is bounded to 1,024 entries, after which reconnecting
is required. Expired pending connections and orphaned registrations are cleaned
up during setup requests. Anonymous setup is limited to 32 registrations per
ten minutes, 32 pending requests per client, and 1,024 pending requests per
system. These limits return HTTP 429 and do not affect existing execution.

OAuth metadata is exposed at:

- `/.well-known/oauth-protected-resource/api/<surface>/mcp`
- `/.well-known/oauth-authorization-server/oauth/<surface>`

The issuer `/oauth/<surface>` exposes `register`, `authorize`, `token`, and
`revoke`. Registration supports public clients using `token_endpoint_auth_method:
none`, HTTPS redirects, and loopback HTTP callbacks. It does not fetch client
metadata URLs. Each request is bound to the tenant endpoint's origin/resource.
Current user permissions and revocation are checked at execution. Spark grants
snapshot the allowed capability names; newly available capabilities require a
new consented connection.

MCP transport is stateless: no selected system or session in transport memory,
no SSE stream or MCP session ID. OAuth grants and action receipts are durable
application state. The client conversation is not copied automatically. Spark
write executions record submitted code and execution events; explicitly saved
work, actions and notes persist in the tenant. An execution may complete earlier operations before a later failure;
a timeout does not mean nothing happened.

## Access profiles

Each application declares two connection permissions. Forge uses
`can_connect_mcp_read` and `can_connect_mcp_develop`; Spark uses
`can_connect_mcp_read` and `can_connect_mcp_act`. Develop also requires
`edit_code`. Existing application, capability and action permissions continue
to apply. Write permission includes eligibility for a read connection.

OAuth scopes are `forge:read`, `forge:develop`, `spark:read`, and `spark:act`.
Consent defaults to Read. Users can select Develop or Act only when requested
by the client and allowed by their current permissions. Grants never expand
implicitly. Revoking a permission also blocks existing grants on subsequent
calls and action execution.

Both surfaces expose `list_sessions` and `execRead` to read grants. Write grants
add `create_session` and `exec`. `execRead` has `readOnlyHint: true`.
Session listing and creation are closed-world operations. Forge read execution
is bounded to tenant resources; Spark read functions may query external
services, so Spark execution advertises `openWorldHint: true` even for reads.
Write execution advertises `destructiveHint: true`. These annotations are backed by checks at tool
execution boundaries. Mutating tools reject read-only execution before running
their procedures; query and file tools retain their existing input restrictions.
Temporary query processing and binary scratch storage remain available.
Client confirmation policies remain under the client's control.

## Forge

Use `list_sessions` / `create_session`. Inside `exec({sessionId, code})`, call
`listVersions()` or `createVersion({parentVersionId?})`. Source work includes
both sessionId and versionId. `applyPatch(operations)` is a JavaScript function,
not another MCP tool. There is no mutable current version between calls.

Sessions, versions, diffs and previews remain in Forge. Develop exposes
production inspection, usage, issues, permitted Edge operations, documentation,
references, validation, tests and preview functions under their existing
permissions. Read exposes the audited inspection subset. Tests and previews
require Develop because they create execution state. Deployment is absent.
There is no expected tree hash. Creation calls are not deduplicated; inspect
sessions/versions before retrying a lost creation response. Coordinate clients
editing the same version or create independent child versions.

The native reactor and MCP API call the same `forge_exec` stored procedure.
It contains one tool environment. Each tool checks the execution context at
runtime; read-only calls reject mutation. Source reads without a session default
to the live version. Supplying a version ID resolves its owning session.
`createArtifact`, `listArtifacts`, `showArtifact`, `showPreview`, and `recordDemo`
reuse the native session artifact and timeline implementations. Externally
created artifacts carry an external source; no synthetic Forge agent is needed.
Initialization returns an API reference and the system's reference-file index.
It does not inject the native agent persona or the content of
`references/context.md`. Reference files remain readable as requested task data.

## Spark, sessions and skills

`execRead({code, sessionId?})` supports stateless analysis; supplying a session
loads its saved task context and capability subset. `exec({code, sessionId})`
requires a named external session. Create one with
`create_session({name, context?})`, which returns its durable review URL.
Session context is task input, not an authorization grant.

The runtime uses native `tools.*`, query whitelist/column policy, declared file
sources, PDF/image tools, spreadsheet helpers and capability functions.
Read-only PDF access supports ordinary page renders and pixel crops. The
processing-backed `outputWidth` region renderer requires Act access.

Functions are read-only by the Spark contract and are available in Read and Act
profiles, subject to capability permissions. Writes belong in actions, which
are unavailable in Read. Initialization returns a technical API reference,
permitted capability catalog and governed document index. It does not inject
the native agent persona, workspace `AGENTS.md`, or skill-following directives.
Workspace files remain readable as task data through `tools.listFiles` and
`tools.readFile`; `tools.readCapability` returns schemas and operation contracts.
The catalog is an initialization snapshot; runtime permission checks apply to
every operation. Native Yolm agent guidance is unchanged.

Each action call is a new operation. Actions return `action_id` and status;
`tools.actionReceipt({receiptId: action_id})` retrieves the outcome. There are
no action request keys or input hashes. Scripts are not atomic: inspect work
after a lost response before retrying.

Mutable execution creates an external Spark run and execution event in the
selected session. Actions use the native proposal/receipt implementation, and
saved artifacts attach to that event. External runs cannot enter the native
planning or execution reactors. Native and external callers share `spark_exec`,
with one compiled tool environment and runtime read-only guards. Read-only
calls create no session, run, execution event, or saved artifact.

Reversible actions use native preflight, transactional execution, receipt
recovery and Undo. `tools.undoReceipt({receiptId})` targets one reversible
action. The existing session UI's Undo targets the displayed execution's
changes. Current application permissions and transaction-history conflict rules
apply. Pending approvals use the existing application-authored `approvalUi` and
session controls. Approval applies to the displayed IDs and inputs; proposals
added later are excluded. The action executor rechecks current application
permissions and records completion or failure. There is no model-callable
approval function and no automatic resumption of the external chat.

Disconnecting an assistant prevents new requests. It does not delete saved work
or prevent an authorized user from reviewing proposals and using Undo in Yolm.
Sessions belong to their user, not an OAuth connection; another authorized
connection for that user can continue working in them. Application actions
remain responsible for validating live business facts at execution.

Save deliverables with `tools.saveArtifact({name, mimeType, text})` or
`tools.saveArtifact({name, mimeType, bytes})`. Artifacts are immutable attachment
records backed by Yolm blob storage, limited to 16 MiB each. Use
`tools.listArtifacts()` and `tools.readArtifact({id})`; reads return bytes inside
the isolate. The session page offers authenticated downloads. `text()` and
`image()` return MCP content without automatically saving every intermediate
result or copying the external conversation.

## Spark opt-out and schema compatibility

Set `mcp: false` on `SparkBlock` to omit MCP endpoints, connection settings and
OAuth schema installation by that block. The ordinary session UI still displays
existing external work. If another block installs MCP, its shared OAuth tables
remain available for that block.

Relative to the original native schema, Spark adds a nullable
`spark_agents.execution_mode` (`native` or `external`) with no default. Null
means native, so existing rows need no backfill. MCP explicitly writes `external`.
Existing action and attachment event ownership remains required. It adds no conversation connection
FK, action request key, or input hash. Forge adds an `external` artifact-source
enum value and a nullable `artifacts.created_by` user FK. Existing artifacts keep
a null creator; new artifacts retain the authenticated execution identity when
available. These Forge additions are compatible and require no backfill. OAuth
adds two tables. No deployment is performed here.

This replaces the earlier local, unreleased four-table/eventless MCP prototype.
A local database populated by that prototype should be recreated for testing;
existing eventless prototype actions are not silently assigned invented events.
Removing MCP from a deployed schema leaves its physical data orphaned under
Yolm's normal schema-removal rules; it is not credential erasure.
