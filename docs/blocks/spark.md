---
title: SparkBlock
description: Conversational AI agent block for data analysis, what-if questions, and governed write actions, configured through per-role capabilities.
tags:
  - blocks
  - spark
  - ai
  - agent
  - llm
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
  - blocks/auth.md
  - blocks/drive.md
---

# SparkBlock

`SparkBlock` adds an in-system AI agent: a chat-style assistant that queries
your data, answers what-if questions, and performs governed write operations.
Reversible actions run immediately with generic transaction undo; other actions
use human approval. Developer-defined access is bundled into named
**capabilities** (read views/tables plus callable actions and functions); each
conversation is locked to a fixed capability set at creation. Use it instead
of building custom agent plumbing, prompt assembly, approval queues, and tool
dispatch by hand.

Spark requires one dedicated [Drive](drive.md) space. Its folders and raw
Markdown files are the behavior contract; code-defined capabilities remain the
security and tool contract. Humans edit the workspace through Spark admin, and
Spark admins also receive approval-gated workspace-management actions in chat.
Spark reads the current Markdown versions on every turn, so approved edits take
effect immediately and Drive's immutable versions provide audit and rollback
without a second prompt schema.

```tsx
import { SparkBlock } from "blocks/spark";
```

The block ships pre-built UI (`SparkPage`, `SparkPanel`), workspace management,
its tables, the agent reactors, and the tool runtime.

## Canonical setup

Do it all in **`core.tsx`**: pass the complete capability list when adding the
block. Spark validates and registers it through the normal block lifecycle, so
**no `reactors/` trigger file is needed**.

```tsx
// core.tsx
import { AuthBlock } from "blocks/auth";
import { DriveBlock } from "blocks/drive";
import {
  SparkBlock,
  type SparkCapability,
  sparkSpaceType,
} from "blocks/spark";
import { sql } from "std/sql_utils";
import { system } from "std/system";

const sparkWorkspace = sparkSpaceType({
  access: {
    read: (_space, _binding, userId) =>
      AuthBlock.userHasPermission(sql.lit`can_admin_spark`, userId),
    write: (_space, _binding, userId) =>
      AuthBlock.userHasPermission(sql.lit`can_admin_spark`, userId),
  },
});
const drive = new DriveBlock({ spaceTypes: [sparkWorkspace.spaceType] });
system.addBlock(drive);

const salesCapability: SparkCapability = {
  name: "sales_analysis",
  description: "Order analysis, revenue breakdowns, customer value",
  permission: "can_access_sales_app",
  views: ["spark_v_orders", "spark_v_customers"],
  tables: ["orders", "customers"],
  doc: `## Sales Analysis
Business rules, query conventions, and examples go here; readable schemas are generated.`,
};

system.addBlock(new SparkBlock({
  workspace: {
    drive,
    type: sparkWorkspace,
  },
  capabilities: [salesCapability],
}));
```

For large capabilities, put them in `shared/` modules that export
`SparkCapability` values or arrays, then combine those arrays in the
constructor. Do **not** register from an app file or a `reactors/` trigger.

Then mount the chat UI in an app — nothing to import beyond the block, since
`core.tsx` already supplied its capabilities:

```tsx
import { SparkBlock } from "blocks/spark";
import { AuthBlock } from "blocks/auth";
import { system } from "std/system";

system.app({
  ui: (
    <AuthBlock.DefaultEmailOtpAuth requiredPermission="can_access_user_app">
      <SparkBlock.SparkPage />
    </AuthBlock.DefaultEmailOtpAuth>
  ),
});
```

## Model and effort controls

Spark and Forge default to Luna. The compact composer menu adjusts reasoning
from Instant through Maximum; its Advanced row selects Luna, Terra, Sol, or
Astra. Astra starts at Low because it requires reasoning. Model choices persist
per conversation and apply to the next agent run; an existing run retains its
model while completing tool calls and retries. Historical conversations without
a model selection also default to Luna.

## Configuration

Spark's agent requests, automatic titles, and direct PDF-region processing attach local usage context
`{"conversationId":"<spark_conversations.id>"}`. The platform aggregates usage
under that conversation for Forge inspection; the context is not provider
metadata. This also covers programmatic `start()` runs. Polling a running agent
does not record another usage charge. Spark does not display usage charges yet.

`new SparkBlock(opts)` — `SparkBlockOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `workspace` | `SparkWorkspace` | Yes | Dedicated standalone Drive space created by `sparkSpaceType`; raw Markdown and no lifecycle. |
| `defaultReasoningEffort` | `SparkReasoningEffort` | No | Initial reasoning effort for new conversations. Defaults to `"low"`. |
| `controlledDocuments` | `SparkDriveKnowledge` | No | Optional governed publication library. Installs the `documents` capability and `loadDocument`; it is separate from Spark's own workspace. |
| `capabilities` | `SparkCapability[]` | Yes | Complete system-specific capability list. Pass `[]` when only built-in capabilities are needed; Spark adds those automatically. |
| `mockProcedure` | `EndpointStatementsOrFn` | No | Replaces the live LLM call for dev/tests. Must `s.return(json_build_object('text', ...))`. Queue canned multi-turn responses here. |
| `accessPermission` | `string` | No | Permission required to use Spark pages and conversation sharing. Default `"can_use_spark"`. |
| `adminPermission` | `string` | No | Permission required for Spark administration. Default `"can_admin_spark"`. |
| `enableDynamicUi` | `boolean` | No | Enables agent-generated `---UI---` cards. Default `true`; set `false` for markdown-only conversations. |
| `allowedCardJsModules` | `string[]` | No | Bundled JS module ids that dynamic UI cards may import and call. Empty by default. |
| `userDisplayName` | `(userIdExpr: Sql) => Sql` | No | Display-name resolver for the share picker. Null results fall back to `"User <id>"`. |
| `accountMenu` | `(props: SidebarAccountPresentation) => Node` | No | Shared account renderer; forward both `compact` and `placement` to the account menu. |
| `brand` | `SidebarBrand` | No | Shared branding (`name`, compact `logo`, optional `wordmark`/`initials`); defaults to Spark. |

### Navigation shell

SparkPage uses the shared [Sidebar shell](../ui/sidebar.md) for conversations
and management pages. It supplies New Chat, Search, and Chats rail shortcuts;
the shell owns collapse controls, mobile navigation, and account placement.
SparkPanel stays embedded and does not add application navigation.

The old `sidebarBrand({ compact })` renderer is replaced by `brand` metadata.
For example, pass `brand: { name: "Company", logo: getAssetUrl("logo.png") }`.
Account renderers should forward the entire presentation:
`accountMenu: (presentation) => <CompanyAccountMenu {...presentation} />`.
Identity data must be available above the shell or loaded inside the account
component, because the mobile header and sidebar are separate render locations.

## Attachments and spreadsheets

The composer accepts text, JSON, Markdown, Excel, DOCX, PDF, and common image
attachments. Uploads belong to the conversation and Spark cannot read an
attachment from another conversation.

Inside `exec`, `tools.listAttachments()` returns the available attachment
metadata and `tools.readAttachment(idOrName)` returns raw bytes. Spark also
provides two bounded Excel readers:

- `tools.inspectSpreadsheet(idOrName)` lists up to 50 sheets with dimensions
  and a bounded preview. Object input may set `previewRows` (maximum 20) and
  `previewColumns` (maximum 30).
- `tools.readSpreadsheet({ id?, name?, sheet?, headerRow?, offset?, limit? })`
  reads one sheet. `sheet` is an exact name or zero-based index, `headerRow` is
  one-based, and `limit` is capped at 1,000 rows. Use `nextOffset` to continue.

Rows expose `values`, `display`, and `kinds` keyed by unique column names. Raw
dates are ISO 8601 strings; raw percentages remain fractions while `display`
preserves visible formatting. Blank and duplicate headers receive stable
generated keys. Formulas expose their expression and cached result. These are
built-in Spark tools rather than capabilities: system capabilities remain
responsible only for domain mapping, validation, authorization, and writes.

Create the initial reserved files in a setup/import pipeline:

```tsx
system.block(SparkBlock).seedWorkspace(s, {
  instructions: "You are the company's operations assistant...",
  skills: [{
    name: "daily-report",
    description: "Prepare the standard daily operating report.",
    instructions: "Check yesterday's output, exceptions, and cash...",
  }],
});
```

`instructions` becomes the root `AGENTS.md`. Each skill becomes
`Skills/<name>/SKILL.md` with `name` and `description` YAML frontmatter followed
by the instructions. `seedWorkspace` is idempotent and throws at generation
time when a skill `name` is not lowercase hyphen-case (at most 64 characters)
or its `description` is empty, multi-line, longer than 1024 characters, or
contains angle brackets. The same content is editable through **Spark admin →
Spark workspace**, which also offers **Create skill** for authoring a standard
`SKILL.md` in place.

## Workspace contract

```text
Spark
├── AGENTS.md
├── Skills/
│   └── daily-report/
│       ├── SKILL.md
│       └── optional references
└── References/
    └── Finance Definitions
```

Only the root `AGENTS.md` and `Skills/<skill>/SKILL.md` have reserved meaning.
`References` is a convention. A skill is a folder directly below `Skills`, so
its own reference material can live beside its `SKILL.md`.

`SKILL.md` opens with YAML frontmatter that Spark uses for discovery:

```markdown
---
name: daily-report
description: Prepare the standard daily operating report.
---

# Daily report

Check yesterday's output, exceptions, and cash...
```

`name` must be lowercase hyphen-case (at most 64 characters) and `description`
a single non-empty line of at most 1024 characters without angle brackets. A
skill folder whose `SKILL.md` is missing or has invalid frontmatter is ignored
by Spark and flagged in Spark admin.

The root `AGENTS.md` is eager for every run, chat and `start()` alike; a
workspace without one falls back to a generic built-in instruction. The prompt
also carries the skill index (each skill's `name`, `description`, and path) and
tells the agent to select the smallest set of skills that clearly applies, then
load each selected `SKILL.md` and any references lazily with `readFile(path)`
before acting. Skills are operational guidance available to every Spark
conversation, not an access boundary. The conversation's permission-filtered
capabilities remain authoritative for data access and callable actions;
Markdown can never grant a capability. Do not put secrets in the Spark
workspace. Workspace files are read on every turn, so an edit takes effect on
the next turn.

Workspaces created under the earlier `Instructions` / `Agents/` layout show a
setup warning in Spark admin. **Complete setup** creates `AGENTS.md` from the
legacy root `Instructions` document (or a placeholder), creates the `Skills`
folder, and trashes the legacy root `Instructions` file and `Agents` folder.
Existing skill folders are not converted: add a `SKILL.md` to each one. There
are no per-agent instruction documents any more; give a programmatic run its
guidance through the `task` text and, for reusable procedure, a skill.

### Built-in workspace management

Users holding the Spark admin permission automatically receive the
`workspace_management` capability in new chat conversations. It lets Spark
propose maintenance of its own Drive workspace through the same approval queue
as application actions:

- `workspace_management.create_folder` creates one folder below an existing
  parent.
- `workspace_management.create_markdown` creates an ordinary Markdown reference
  file.
- `workspace_management.update_markdown` appends a replacement version to an
  ordinary Markdown reference file.
- `workspace_management.set_instructions` creates or replaces the root
  `AGENTS.md` or a `Skills/<skill>/SKILL.md` and is always high-risk. It
  rejects every other path and a `SKILL.md` without valid frontmatter;
  `create_markdown` and `update_markdown` refuse those reserved paths.
- `workspace_management.rename_item` and
  `workspace_management.move_item` are always high-risk because changing a path
  can change skill discovery or behavior.

Every operation requires a conversation owner, rechecks the configured Spark
admin permission when proposed, and rechecks the workspace's Drive write access
when executed or undone. Ordinary content creation and updates are low-risk;
behavioral instructions, renames, and moves cannot inherit the default
low-risk auto-approval policy. Updates and undo operations preserve immutable
version history. Existing conversations keep their frozen capability set, so
the capability appears when a new conversation is created after deployment.

## Capabilities

A capability is a permission-gated read/write bundle for a role. Pass the
complete capability list to the `SparkBlock` constructor. A conversation's
capability list is fixed at creation. The prompt contains a compact capability
catalog; `tools.readCapability(name)` loads readable schemas, authored instructions, and tool
signatures together when needed. Its `views`/`tables`/`fieldWhitelist` become the query
whitelist, and its `actions`/`functions` become callable tools.

Schemas include table and field descriptions, exact types, nullability, primary
keys, foreign-key targets, and shared enum definitions. Views retain their SQL
definitions. Put field semantics in schema descriptions rather than repeating
them in capability prose.

Re-read one resource schema with
`tools.readCapability({ name, section: "schema", resource: "table_or_view" })`.
Only resources exposed by that capability are available. Shared query guidance
is in `System/SQL`; capability-file binding, PDF/image rendering, and Excel
examples are in `System/Files`. Keep authored docs focused on business rules and
recipes; generated schemas and shared references need not be duplicated.

`SparkCapability`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Capability id. Tools are namespaced `capabilityName.toolName`. |
| `description` | `string` | Yes | One-line summary shown in the prompt header. |
| `label` | `string` | No | Human-facing capability name shown on the Spark home/discovery UI. Falls back to `name`. |
| `permission` | `string` | No | One existing application permission granting the capability. |
| `permissions` | `{ any: [string, ...string[]] } \| { all: [string, ...string[]] }` | No | Multiple existing application permissions granting the capability. Mutually exclusive with `permission`; omit both for every user with Spark access. |
| `internal` | `boolean` | No | Excluded from chat conversations; only non-chat runs that list it in `start`'s `capabilities` get it. |
| `views` | `string[]` | No | Views the agent may `query()`. Preferred read surface. |
| `tables` | `string[]` | No | Tables readable from `query()` and agent-generated `---UI---` cards (as `db.<name>`). Keep minimal; this is also the compile-time UI whitelist. |
| `fieldWhitelist` | `SparkTableFields[]` | No | Column-level read access for sensitive tables. |
| `actions` | `SparkAction[]` | No | Governed write operations. |
| `functions` | `SparkFunction[]` | No | Read-only domain computations callable directly. |
| `fileSources` | `SparkFileSource[]` | No | Blob-backed files the agent may bind to SQL through `query({ sql, file })` or inspect through `readFileImage`. Sources may also provide annotated PDF rendering and structured `readFileMarkup` data. Each discovery relation must also be listed in `tables` or `views`; views require a custom `lookup`. |
| `doc` | `string` | Yes | Markdown guidance: business rules, conventions, examples. |

Use `permission` for the common single-permission case. Use `permissions.any`
when any listed permission grants access, or `permissions.all` when every
listed permission is required. Do not define both fields.

`SparkTableFields`: `{ table: string; fields: string[] }`.

`SparkFileSource`: `{ name: string; table: string; blobColumn?: string;
mimeColumn?: string; nameColumn?: string; lookup?: (id: Sql, context: {
sysUserId: Sql }) => Sql;
renderPdfPage?: (...args) => void; readPdfMarkup?: (...args) => void }`.
`blobColumn` and `mimeColumn` are required unless `lookup` returns joined
`bh`, `mime`, and `label` fields. The source supports PDF and spreadsheet SQL
functions; `readFileImage` additionally renders images and PDF pages. PDF
rendering defaults to `renderMode: "annotated"`; `"original"` bypasses the
custom renderer. `readFileMarkup({ source, id, page? })` is present when the
source provides structured markup.

For Drive-backed files, prefer `sparkDriveFileSource` from
`blocks/spark/drive`. It builds the authorized Drive lookup and can connect a
`PdfMarkupExtension` without system-specific rendering or markup queries.

### Actions

`SparkAction` — a side-effecting server-side operation. Approval-mode actions
are proposed for review; reversible actions execute immediately and retain a
transaction receipt for generic undo.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Action id; callable as `capabilityName.name`. |
| `description` | `string` | Yes | Shown in the prompt and approval card. |
| `inputType` | `string` | Yes | Compact TypeScript type shown to the agent for the input. Runtime validation belongs in `procedure`. |
| `permission` | `string` | No | One additional application permission required beyond the containing capability. |
| `permissions` | `{ any: [string, ...string[]] } \| { all: [string, ...string[]] }` | No | Multiple additional application permissions. Mutually exclusive with `permission`. |
| `danger` | `SparkDanger` | No | `"low"` \| `"high"` \| `"external"`. Defaults to `"low"`. Drives approval grouping and auto-approve policy tiers. |
| `mode` | `"approval" \| "reversible"` | No | Defaults to `"approval"`. Reversible actions run immediately in a Spark-owned transaction and use generic transaction undo. |
| `approvalUi` | `(props: { input: Sql }) => Node` | No | Renders one approval-card row. `input` is a `Sql` expression for the proposed `input_json`; may query live data for a before/after diff. Falls back to a stripped-JSON line. |
| `resultUi` | `(props: { result: Sql; status: Sql }) => Node` | No | Read-only completed-action presentation in chat and Changes. Uses recorded `result_json` and current receipt status, including `undone`. Falls back to generic result fields when omitted. |
| `procedure` | `(s: GeneralServerStatements) => void` | No | Spark-owned transaction body run after approval or immediately in reversible mode. Reads `action_input`; may set `action_result` to a compact JSON receipt. Do not start or commit a transaction. |
| `undo` | `(s: GeneralServerStatements) => void` | No | Spark-owned custom undo transaction body for approval-mode actions. Reads `action_input` and `action_result`. Reversible mode uses the committed transaction instead. |

```tsx
const inventoryCapability: SparkCapability = {
  name: "inventory",
  description: "Stock and reorder management",
  views: ["spark_v_products"],
  tables: ["products"],
  doc: "Reorder management docs...",
  actions: [
    {
      name: "update_reorder_level",
      description: "Update the reorder level for a product",
      danger: "low",
      inputType: "{ product_id: number; reorder_level: number }",
      procedure: (s) => {
        s.defScalar("rl_id", sql`(action_input->>'product_id')::bigint`);
        s.defScalar(
          "rl_old",
          sql`(select reorder_level from db.products where id = rl_id)`,
        );
        s.modify(sql`update db.products
          set reorder_level = (action_input->>'reorder_level')::smalluint
          where id = rl_id`);
        s.setScalar(
          "action_result",
          sql`json_build_object('old_level', rl_old)::string`,
        );
      },
      undo: (s) => {
        s.modify(sql`update db.products
          set reorder_level = (action_result::json->>'old_level')::smalluint
          where id = (action_input->>'product_id')::bigint`);
      },
    },
  ],
};
```

### Completed-action details

Use `resultUi` for a concrete target, before/after values, or navigation links.
The collapsed row uses the existing `title`/`name` result fields for its target
label. `resultUi` controls the expanded details. Persist the needed names and
historical values in `action_result` inside the
mutation transaction. Render those snapshots rather than querying today's
record to explain an older change. Only include fields appropriate for everyone
who can view the Spark session; raw results are also inspectable. Links must
point to permission-checked application routes. No new receipt schema is needed.

```tsx
resultUi: ({ result, status }) => (
  <div>
    <p>{sql`${result}->>'name'`}</p>
    <p>{sql`coalesce(${result}->>'before', 'Not recorded') || ' → ' || (${result}->>'after')`}</p>
    <Show when={sql`${status} = 'undone'`}>Undone</Show>
  </div>
),
```

The renderer runs at generation time, like `approvalUi`; it is application code,
not agent-authored UI. It should be read-only and tolerate historical results
that lack newly added fields. A null result uses the missing-result message.
Actions that omit `resultUi` retain the generic display. Technical details remain
available regardless of the renderer.

### Functions

Reversible actions can use `throwSparkActionValidationError` from
`blocks/spark/action_errors` for safe, application-authored validation messages.
Spark returns those tagged messages (limited to 1,000 characters), while
unexpected errors receive a generic rollback message. Never pass provider errors
or sensitive data to this helper.

PDF images emitted through `image(...)` include a `pdf_image_frame` caption
when source evidence and render dimensions are available. It identifies the
full-page coordinate frame, crop, and output dimensions. The SQL helper
`pdfRegionCrop` in `blocks/spark/pdf_source_region_validation` converts normalized
bottom-left PDF bounds to clamped top-left pixel crop coordinates.

`SparkFunction` — read-only domain computation the agent calls directly from
its sandbox script; runs immediately, returns JSON, no approval. Must be
idempotent by contract (if it writes, model it as an action instead).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Function id; callable as `capabilityName.name`. |
| `description` | `string` | Yes | Shown in the prompt. |
| `inputType` | `string` | No | Optional compact TypeScript input type shown to the agent. |
| `procedure` | `(s: GeneralServerStatements) => void` | Yes | Reads the `function_input` JSON scalar and **must** call `s.return(<json expr>)`. |

## Pages and Components

Both are exposed as named exports and as static members on `SparkBlock`
(`SparkBlock.SparkPage`, `SparkBlock.SparkPanel`). They read per-capability UI
metadata published automatically by the block lifecycle before app rendering.

### `SparkPage`

Import: `blocks/spark` (or `SparkBlock.SparkPage`). Full-screen Spark app:
conversation sidebar, timeline, composer, admin, and full-card
routes. It owns its internal `<AppRoutes>`; render it directly rather than
wrapping it in a route.

Shared conversations are transcript-only for recipients. Live generated cards
remain owner-only and recheck the owner's current Spark and capability
permissions on every frame request.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route path alias retained for callers that pass `path`; `basePath` controls route construction. |
| `basePath` | `string` | No | Base path for internal Spark routes. Default `""`. |

### `SparkPanel`

Import: `blocks/spark` (or `SparkBlock.SparkPanel`). The timeline + composer
without the sidebar chrome — embed it in another app and point it at one
conversation (the host owns conversation creation, typically via
`sparkBlock.start`).

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `conversationId` | `Sql` | Yes | The conversation id whose timeline to render. |
| `context` | `Sql` | No | Structured JSON context used when creating a new embedded conversation. |

## Block Methods

Get the instance with `const sparkBlock = system.block(SparkBlock);`.

| Method | Signature | Purpose |
| --- | --- | --- |
| `start` | `<T extends IServerBaseStatements>(s: T, opts: SparkStartOpts) => void` | Insert a non-chat run (conversation + agent + seed message). The existing plan reactor dispatches it. |

### Starting non-chat runs

`sparkBlock.start(s, opts)` inserts a run from any server-side statement
builder: scheduled procs, API endpoints, reactors, UI handlers, or parent
agents. **The caller must wrap it in `s.startTransaction()` /
`s.commitTransaction()`.** It sets scalars `spark_start_conversation_id` and
`spark_start_agent_id` for the caller to read afterward.

`SparkStartOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `task` | `Sql \| string` | Yes | Seed task; inserted as the first `user_message`. |
| `capabilities` | `string[]` | Yes | The run's fixed capability set (capability names). |
| `sysUserId` | `Sql` | No | Run owner. Omit (null) for runs with no interactive user. |
| `label` | `Sql \| string` | No | Label shown in admin run lists. |
| `source` | `Sql \| string` | No | Trigger tag, e.g. `"scheduled:daily_brief"`. |
| `policy` | `SparkPolicy` | No | Non-interactive blocker handling. See defaults below. |
| `context` | `Sql` | No | Structured JSON task context stored as `context_json` and surfaced to the agent. |

`SparkPolicy`:

| Field | Type | Values |
| --- | --- | --- |
| `onQuestions` | `SparkQuestionPolicy` | `"ask"` \| `"fail"` \| `"use_defaults"` |
| `onApprovalLow` | `SparkApprovalPolicy` | `"ask"` \| `"auto_approve"` \| `"fail"` |
| `onApprovalHigh` | `SparkApprovalPolicy` | `"ask"` \| `"auto_approve"` \| `"fail"` |
| `onApprovalExternal` | `SparkApprovalPolicy` | `"ask"` \| `"auto_approve"` \| `"fail"` |

For `sparkBlock.start()`, omitted fields default to autonomous-safe values:
`onQuestions: "use_defaults"`, `onApprovalLow: "auto_approve"`,
`onApprovalHigh: "fail"`, and `onApprovalExternal: "fail"`. You can still set
every field explicitly when the run needs stricter behavior:

```tsx
system.scheduledProc({
  name: "daily_sales_brief_kickoff",
  description: "Seeds a non-chat spark run that writes a daily brief.",
  schedule: "0 0 3 * * *",
  procedure: (s) => {
    s.startTransaction();
    sparkBlock.start(s, {
      task: "Summarize today's orders and flag low stock.",
      source: "scheduled:daily_sales_brief",
      label: "Daily sales brief",
      capabilities: ["sales_analysis", "inventory_management"],
      policy: {
        onQuestions: "fail",
        onApprovalLow: "auto_approve",
        onApprovalHigh: "fail",
        onApprovalExternal: "fail",
      },
    });
    s.commitTransaction();
  },
});
```

There is no per-run instruction document: every run loads the root `AGENTS.md`
and the skill index, so put run-specific guidance in `task` (and `context`) and
keep reusable procedure in a skill the agent can select.

## Optional governed Drive integration

Pass `controlledDocuments` only when Spark should also consume and propose
changes to a controlled publication library. The optional integration has
three parts:

- **Index in the prompt.** Every conversation's system prompt ends with a
  `# Company documents (index)` listing the id, title, content mode, and
  description of every published, active file the conversation owner can read
  through Drive. Ownerless runs see publications in organization-visible
  spaces only.
- **`loadDocument(id)` tool.** Loads content on demand: native documents as
  markdown (via `lexical_rich_text_to_markdown`), PDFs as extracted text (or
  one page rendered to vision with `loadDocument({ id, renderPage })`).
  Other uploaded file types are indexed but cannot currently be loaded.
  Authorization matches the index.
- **`documents` capability.** Registered only when `controlledDocuments` is
  configured and available when `"documents"` is in the conversation's fixed
  capability set. Its content
  actions — `documents.edit_document` and `documents.create_document` — are
  **draft-only**: execution creates a controlled revision or native Drive file,
  attributed to the conversation owner and authorized through Drive. Spark
  never publishes; humans review and publish through the controlled-file UI.
  `edit_document` is undoable. A third
  action, `documents.update_document_metadata` (title/description; proposal
  gated on `can_manage_controlled_files`), is the one non-draft exception:
  metadata has no draft stage, so it applies when approved and undo restores
  the prior values. To grant editing to a non-chat run, include `"documents"` in
  `SparkStartOpts.capabilities` and set `sysUserId` — ownerless runs cannot
  write Drive files.

Action procedures that need the acting user can read the
`action_sys_user_id` scalar (the conversation owner recorded on the proposal;
null for ownerless runs). It is defined in both the execute and undo reactors.

## Built-in `auth_activity` capability

Registered automatically and granted to users holding the Spark admin
permission: read access to login/session activity (`auth_session_tokens`
sys_user/issued and `auth_login_failures` identifier/reason) so admins can ask
"has X logged in today?". Session token values, password/2FA material,
IP addresses, user agents, and the platform's transaction/version history are
deliberately not queryable through any Spark capability.

## Tables Created

All created inside `initialize()`; you do not declare them.

| Table | Purpose |
| --- | --- |
| `spark_conversations` | One row per run (chat or non-chat). Holds `sys_user_id`, optional `agent_key`, `label`, `source`, status, and `capabilities_json` (the fixed capability set). |
| `spark_agents` | Agent run state machines (`status`, `retry_count`, policy columns). |
| `spark_agent_events` | Canonical ordered event ledger for both the LLM and user-visible timeline. |
| `spark_attachments` | Bodies and metadata for uploaded or generated files, linked to their canonical event. |
| `spark_agent_pending_images` | One-turn retry queue for uploaded images to inline as vision. Successful responses consume the rows. |
| `spark_action_log` | Compact write receipts. Approval proposals retain `input_json`; immediately reversible actions retain their result and committed transaction id instead. |
| `spark_conversation_shares` | Targeted conversation shares. Organization-wide visibility lives on `spark_conversations.visibility`. |

The `spark_timeline` view derives the user-visible transcript from
`spark_agent_events`; it does not store a second copy of messages, scripts, or
tool output. Query the tables directly for administrative reporting and expose
your own views if application users need another curated read surface.

## Enums Created

`spark_conversation_status`, `spark_agent_status`, `spark_agent_event_type`,
`spark_danger_level`, `spark_action_status`, `spark_question_policy`,
`spark_approval_policy`, `spark_ai_reasoning_effort`,
`spark_ai_queue_preference`,
`spark_conversation_visibility`.

## Exported Types

From `blocks/spark`: `SparkBlock`, `SparkBlockOpts`, `SparkCapability`,
`SparkAction`, `SparkFunction`, `SparkTableFields`, `SparkStartOpts`,
`SparkPolicy`, `SparkDanger`, `SparkQuestionPolicy`, `SparkApprovalPolicy`,
`SparkFileSource`, plus the `SparkPage` / `SparkPanel`
components.

Low-level submodules under `blocks/spark/*` also export helpers used by Spark
itself. Application code should normally use `SparkBlock`, `SparkPage`,
`SparkPanel`, capabilities, actions, functions, and `start()` from
`blocks/spark`.

## Relationships

- Requires a governed [`DriveBlock`](drive.md) composition as the
  company-knowledge source. Register Drive and controlled-file permissions
  with Auth.
- Pairs with [`AuthBlock`](auth.md): capability- and action-level `permissions`
  reuse existing application permissions, and the app page is
  normally wrapped in an `AuthBlock` auth guard. Spark capabilities should
  reuse domain authorization rather than introduce parallel Spark-specific
  data permissions.

## Common Mistakes

- Omitting a capability from the constructor. Spark's capability list is
  immutable after the block is added; define it in `core.tsx`, not an app file.
- Calling `sparkBlock.start()` without wrapping it in
  `s.startTransaction()` / `s.commitTransaction()`. It writes three tables; a
  partial run is meaningless.
- Modeling a write as a `SparkFunction`. Functions must be read-only and run
  without approval; anything that writes must be a `SparkAction`.
- Starting or committing a transaction inside an action or custom undo.
  Spark owns the transaction so the side effect and its receipt are atomic.
- In an action `procedure`, reading the wrong scalars. Read `action_input`
  (and `action_result` in `undo`); a function `procedure` reads
  `function_input` and must `s.return(...)`.
- Wrapping `SparkPage` in `<Route>`. It owns its internal routes; render it
  directly.
- Assuming chat and `start()` have the same blocker defaults. Interactive chat
  waits for a human; `start()` defaults omitted policies to proceed on
  questions/low-risk actions and fail on high/external approvals.
- Over-broadening `tables` on a capability. It is also the compile-time UI-card
  whitelist; use `fieldWhitelist` for sensitive tables.
