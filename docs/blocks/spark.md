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
Developer-defined access is bundled into named **capabilities** (read grants
plus callable actions and functions); each conversation is locked to a fixed
capability set at creation. Actions default to approval mode (proposed for human
review); reversible mode runs immediately with generic transaction undo and is
recommended for ordinary database edits. Use it instead of building custom agent
plumbing, prompt assembly, approval queues, and tool dispatch by hand.

Spark requires one dedicated [Drive](drive.md) space. Its folders and raw
Markdown files are the behavior contract; code-defined capabilities remain the
security and tool contract. Spark reads the current Markdown versions on every
turn, so edits take effect immediately and Drive's immutable versions provide
audit and rollback.

```tsx
import { SparkBlock } from "blocks/spark";
```

Spark also reads Studio-maintained system help live through
`tools.searchHelp({query, limit?})` and `tools.readHelpDocument({documentId})`,
and native Spark shows help videos in the conversation with
`tools.showHelpMedia({documentId, mediaId, startMs?})`
(see [Studio help documents](../ai/studio_help_documents.md)).

## Canonical setup

Do it all in **`core.tsx`**: pass the complete capability list when adding the
block. Spark validates and registers it through the normal block lifecycle, so
**no `reactors/` trigger file is needed**. Use one system-wide `SparkBlock`;
model roles with capabilities, not additional blocks.

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

Put large capabilities in `shared/` modules and combine them in the
constructor. Then mount the chat UI in an app:

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

Spark defaults to Luna. The composer menu sets reasoning from Instant through
Maximum and selects Luna, Terra, Sol, or Astra (which starts at Low because it
requires reasoning). Choices persist per conversation and apply to the next
agent run.

## Configuration

`new SparkBlock(opts)` — `SparkBlockOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `workspace` | `SparkWorkspace` | Yes | Dedicated standalone Drive space created by `sparkSpaceType`; raw Markdown and no lifecycle. |
| `capabilities` | `SparkCapability[]` | Yes | Complete system-specific capability list. Pass `[]` when only built-in capabilities are needed; Spark adds those automatically. |
| `defaultReasoningEffort` | `SparkReasoningEffort` | No | Initial reasoning effort for new conversations. Defaults to `"low"`. |
| `controlledDocuments` | `SparkDriveKnowledge` | No | Optional governed publication library. Installs the `documents` capability and `loadDocument`; separate from Spark's own workspace. |
| `mcp` | `boolean` | No | Set `false` to omit MCP schema, endpoints, and connection settings. Default `true`. |
| `mockProcedure` | `EndpointStatementsOrFn` | No | Replaces the live LLM call for dev/tests. Must `s.return(json_build_object('text', ...))`. Queue canned multi-turn responses here. |
| `accessPermission` | `string` | No | Permission required to use Spark pages and conversation sharing. Default `"can_use_spark"`. |
| `adminPermission` | `string` | No | Permission required for Spark administration. Default `"can_admin_spark"`. |
| `enableDynamicUi` | `boolean` | No | Enables agent-generated `---UI---` cards. Default `true`; set `false` for markdown-only conversations. |
| `allowedCardJsModules` | `string[]` | No | Bundled JS module ids that dynamic UI cards may import and call. Empty by default. |
| `userDisplayName` | `(userIdExpr: Sql) => Sql` | No | Display-name resolver for the share picker and the current-user line in native prompts and the MCP reference. Null results fall back to `"User <id>"`. |
| `accountMenu` | `(props: SidebarAccountPresentation) => Node` | No | Shared account renderer; forward both `compact` and `placement` to the account menu. |
| `brand` | `SidebarBrand` | No | Shared branding (`name`, compact `logo`, optional `wordmark`/`initials`); defaults to Spark. |

Agent requests, titles, and PDF-region processing (including `start()` runs)
attach local usage context `{"conversationId":"<spark_conversations.id>"}`, so
Forge can aggregate usage per conversation.

### Navigation shell

SparkPage uses the shared [Sidebar shell](../ui/sidebar.md). Pass branding as
metadata, for example
`brand: { name: "Company", logo: getAssetUrl("logo.png") }`, and forward the
whole presentation from account renderers:
`accountMenu: (presentation) => <CompanyAccountMenu {...presentation} />`.
Identity data must be available above the shell or loaded inside the account
component, because the mobile header and sidebar are separate render locations.

## Attachments and spreadsheets

The composer accepts text, JSON, Markdown, Excel, DOCX, PDF, and common image
attachments. Uploads belong to the conversation; Spark cannot read an attachment
from another conversation.

Inside `exec`, `tools.listAttachments()` returns attachment metadata and
`tools.readAttachment(idOrName)` returns raw bytes. Two bounded Excel readers
are built in:

- `tools.inspectSpreadsheet(idOrName)` lists up to 50 sheets with dimensions
  and a bounded preview. Object input may set `previewRows` (maximum 20) and
  `previewColumns` (maximum 30).
- `tools.readSpreadsheet({ id?, name?, sheet?, headerRow?, offset?, limit? })`
  reads one sheet. `sheet` is an exact name or zero-based index, `headerRow` is
  one-based, and `limit` is capped at 1,000 rows. Use `nextOffset` to continue.

Rows expose `values`, `display`, and `kinds` keyed by unique column names. Raw
dates are ISO 8601 strings; raw percentages remain fractions while `display`
preserves visible formatting. Blank and duplicate headers receive stable
generated keys. Formulas expose their expression and cached result.

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
its own reference material can live beside its `SKILL.md`, which opens with
YAML frontmatter used for discovery:

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
skill whose `SKILL.md` is missing or has invalid frontmatter is ignored by Spark
and flagged in Spark admin.

Create the initial reserved files in a setup/import pipeline. `seedWorkspace`
is idempotent and enforces the same frontmatter rules at generation time:

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

The same content is editable through **Spark admin → Spark workspace**, which
also offers **Create skill**.

Every native prompt names the conversation owner (via `userDisplayName`) and
their auth roles, and states that Spark cannot read application source code.
The root `AGENTS.md` is eager for every run, chat and `start()` alike; without
one Spark uses a generic built-in instruction. The prompt also carries the skill
index (`name`, `description`, path) and tells the agent to load the smallest
applicable set of `SKILL.md` files and references lazily with `readFile(path)`.
Skills are guidance, not an access boundary: the conversation's
permission-filtered capabilities remain authoritative, and Markdown can never
grant a capability. Do not put secrets in the Spark workspace.

Workspaces still using the earlier `Instructions` / `Agents/` layout show a
setup warning; **Complete setup** in Spark admin migrates them. There are no
per-agent instruction documents.

### Built-in workspace management

Spark admins automatically receive the `workspace_management` capability in
new chat conversations. Its approval-mode actions are `create_folder`,
`create_markdown`, and `update_markdown` (ordinary reference files; reserved
paths refused), `set_instructions` (the root `AGENTS.md` or a valid
`Skills/<skill>/SKILL.md` only), and `rename_item` / `move_item`.
`set_instructions`, renames, and moves are always high-risk because they can
change behavior or skill discovery.

Every operation requires a conversation owner, rechecks the Spark admin
permission when proposed, and rechecks Drive write access when executed or
undone. Ordinary content changes are low-risk; the high-risk operations never
inherit low-risk auto-approval. Updates and undo preserve version history.

## Capabilities

A capability is a permission-gated read/write bundle for a role. A
conversation's capability list is fixed at creation, so a new capability
appears in conversations created after deployment. The prompt contains a
compact capability catalog; `tools.readCapability(name)` loads readable schemas,
authored instructions, and tool signatures together when needed. Re-read one
resource schema with
`tools.readCapability({ name, section: "schema", resource: "table_or_view" })`.

Generated schemas include table and field descriptions, exact types,
nullability, primary keys, foreign-key targets, virtual fields, and shared enum
definitions; column-restricted tables list only readable columns, and views
retain their SQL. A `tables` grant also makes the table's virtual fields
readable; a virtual field is omitted when it reads a relation the capability
does not grant as a whole table. A table schema read adds virtual field SQL,
unique and check constraints, the record display name, and enum value
descriptions. Put field and enum value semantics in schema descriptions. Shared query guidance is in
`System/SQL`; file binding, PDF/image rendering, and Excel examples are in
`System/Files`. Keep authored `doc` text to business rules and recipes.

`SparkCapability`:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Capability id; a valid JavaScript identifier. Tools are namespaced `capabilityName.toolName`. |
| `description` | `string` | Yes | One-line summary shown in the prompt header. |
| `label` | `string` | No | Human-facing name on the Spark home/discovery UI. Falls back to `name`. |
| `permission` | `string` | No | One existing application permission granting the capability. |
| `permissions` | `{ any: [string, ...string[]] } \| { all: [string, ...string[]] }` | No | Multiple existing permissions. Mutually exclusive with `permission`; omit both for every user with Spark access. |
| `internal` | `boolean` | No | Excluded from chat conversations; only non-chat runs that list it in `start`'s `capabilities` get it. |
| `tables` | `string[]` | No | Tables readable whole (every column and row) from `query()` and `---UI---` cards (as `db.<name>`). Preferred read surface. |
| `fieldWhitelist` | `SparkTableFields[]` | No | Tables readable through only the listed columns. |
| `fieldBlacklist` | `SparkTableFields[]` | No | Tables readable through every real column except the listed ones. |
| `views` | `string[]` | No | Views readable from `query()`. Use for row scoping or derived data. |
| `actions` | `SparkAction[]` | No | Governed write operations. |
| `functions` | `SparkFunction[]` | No | Read-only domain computations callable directly. |
| `fileSources` | `SparkFileSource[]` | No | Blob-backed files the agent may bind to SQL through `query({ sql, file })` or inspect through `readFileImage`. Each discovery relation must also be readable through this capability; views require a custom `lookup`. |
| `doc` | `string` | Yes | Markdown guidance: business rules, conventions, examples. |

`SparkTableFields`: `{ table: string; fields: string[] }`. Use `permissions.any`
when any listed permission grants access and `permissions.all` when every listed
permission is required.

### Read access

Choose the first form that fits, in this order:

1. `tables` — the default. The agent sees the real schema and joins freely.
2. `fieldWhitelist` — a few readable columns on a table with sensitive data.
3. `fieldBlacklist` — a table where only a few columns are sensitive.
4. `views` — rows must be scoped, or the data needs logic a query over granted
   tables cannot reasonably express.
5. `functions` — logic SQL cannot express at all, such as service calls or
   multi-step computation.

Step down only for a concrete reason: sensitive columns, row scoping, or logic a
query cannot express. Views are not a preferred surface; they hide the real
schema and must be maintained beside it.

A table or column grant exposes **every row** to every holder. When records must
be limited per user, grant a view that filters with `current_user` and do not
grant the underlying table in any capability those users hold: a view does not
grant its underlying tables, but a table grant bypasses the view's filter.

Within one capability, a table in `fieldBlacklist` may not also appear in
`tables` or `fieldWhitelist`; generation fails otherwise. A table in both
`tables` and `fieldWhitelist` is restricted to the whitelist; prefer listing it
once. Field lists
must name real columns: virtual columns are never readable under a column
restriction. Across the capabilities a conversation holds, grants merge:

- A wholesale `tables` grant wins over any column restriction on that table.
- Otherwise the readable columns are the union of every held whitelist and
  blacklist-derived column set (a blacklist resolves to the table's real columns
  minus the listed ones).
- Views and tables are unioned.

Agent-generated UI cards compile against the union of all registered grants;
preflight narrows each card to its conversation's grants.

### File sources

`SparkFileSource`: `{ name: string; table: string; blobColumn?: string;
mimeColumn?: string; nameColumn?: string; lookup?: (id: Sql, context: {
sysUserId: Sql }) => Sql; renderPdfPage?: (...args) => void; readPdfMarkup?:
(...args) => void }`. `blobColumn` and `mimeColumn` are required unless `lookup`
returns joined `bh`, `mime`, and `label` fields. Sources support PDF and
spreadsheet SQL functions; `readFileImage` additionally renders images and PDF
pages. PDF rendering defaults to `renderMode: "annotated"`; `"original"` bypasses
the custom renderer. `readFileMarkup({ source, id, page? })` is present when the
source provides structured markup.

PDF images include a `pdf_image_frame` caption identifying the full-page
coordinate frame, crop, and output dimensions when available. `pdfRegionCrop`
in `blocks/spark/pdf_source_region_validation` converts normalized bottom-left
PDF bounds to clamped top-left pixel crops.

For Drive-backed files, prefer `sparkDriveFileSource` from `blocks/spark/drive`.
It builds the authorized Drive lookup and can connect a `PdfMarkupExtension`.

### Actions

`SparkAction` is a side-effecting server-side operation run in a Spark-owned
transaction with a durable receipt.

Prefer **`mode: "reversible"`**: the action runs immediately and generic
transaction undo restores its changes. Set-based actions that create, update,
or delete many rows are fine — and preferred over one-row tools — when schema
constraints and state guards make an invalid result impossible. Design the
schema for it: keep critical data in a working/released split, put invariants in
constraints, and check editable state at the top of the procedure. Keep the
default `"approval"` mode for external effects (mail, notifications, provider
calls), changes to released or otherwise critical state, and anything
transaction undo cannot restore.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Action id; callable as `capabilityName.name`. |
| `description` | `string` | Yes | Shown in the prompt and approval card. |
| `inputType` | `string` | Yes | Compact TypeScript type shown to the agent. Runtime validation belongs in `procedure`. |
| `permission` | `string` | No | One additional permission beyond the containing capability. |
| `permissions` | `{ any: [...] } \| { all: [...] }` | No | Multiple additional permissions. Mutually exclusive with `permission`. |
| `mode` | `"approval" \| "reversible"` | No | Defaults to `"approval"`. Reversible actions require `procedure` and cannot define `approvalUi`. |
| `danger` | `SparkDanger` | No | Approval mode only: `"low"` (default) \| `"high"` \| `"external"`. Drives approval grouping and `SparkPolicy` tiers. |
| `approvalUi` | `(props: { input: Sql }) => Node` | No | Approval mode only. Renders one approval-card row from the proposed `input_json`; may query live data for a before/after diff. |
| `preflight` | `(s: GeneralServerStatements) => void` | No | Reversible mode only. Read-only validation run immediately before Spark opens the transaction, so it may make service requests. Reads `action_input` and `action_sys_user_id`; its declarations are visible to `procedure`. |
| `procedure` | `(s: GeneralServerStatements) => void` | No | Transaction body run after approval or immediately in reversible mode. Reads `action_input`; may set `action_result` to a compact JSON string. Never starts or commits a transaction. |
| `validateUndo` | `(s: GeneralServerStatements, result: Sql) => void` | No | Checks restored invariants inside every reversible undo (single, bulk, and batch). Throw to roll back the whole undo; no external effects. |
| `undo` | `(s: GeneralServerStatements) => void` | No | Custom undo body for approval-mode actions. Reads `action_input` and `action_result`. |
| `resultUi` | `(props: { result: Sql; status: Sql }) => Node` | No | Read-only completed-action presentation in chat and Changes. |

This reversible action edits any number of lines of a draft order. The guard
rejects released orders, and table constraints reject invalid values:

```tsx
actions: [{
  name: "update_lines",
  description: "Update quantity or price on lines of one draft order.",
  mode: "reversible",
  inputType:
    "{ order_id: number; changes: { line_id: number; quantity?: number; unit_price?: number }[] }",
  procedure: (s) => {
    s.defScalar("ul_order", sql`try_cast(action_input->>'order_id' as bigint)`);
    s.if(
      sql`not exists (select 1 from db.orders
        where id = ul_order and status = 'draft')`,
      (s) => throwSparkActionValidationError(s, "Only draft orders can change."),
    );
    s.defTable(
      "ul_changes",
      sql`select try_cast(value->>'line_id' as bigint) as line_id,
        try_cast(value->>'quantity' as int) as quantity,
        try_cast(value->>'unit_price' as decimal(10,2)) as unit_price
      from json.array_each(action_input->'changes')`,
    );
    s.try({
      body: (s) =>
        s.modify(sql`merge into db.order_lines as line
          using ul_changes as change
          on line.id = change.line_id and line.order_id = ul_order
          when matched then update set
            quantity = coalesce(change.quantity, line.quantity),
            unit_price = coalesce(change.unit_price, line.unit_price)`),
      errorName: "ul_error",
      catch: (s) => rethrowSparkActionError(s, "ul_error"),
    });
  },
}],
```

Validation messages from `throwSparkActionValidationError` (in
`blocks/spark/action_errors`) are returned to the agent, limited to 1,000
characters; other errors produce a generic rollback message. Inside a `try`,
`rethrowSparkActionError(s, errorName)` keeps messages from `throwError` and
declared table checks. Never pass provider errors or sensitive data to either.

Block-provided capabilities build their tools with `blockToolset(namespace,
permission)` from `blocks/spark/tool_contract`. It rechecks the permission and
active user inside every call, makes ordinary actions reversible, and makes
actions flagged external approval-mode with `danger: "external"`.

### Completed-action details

Use `resultUi` for a concrete target, before/after values, or navigation links.
The collapsed row labels the target from `title`/`name` result fields;
`resultUi` controls the expanded details. Persist names and historical values in
`action_result` inside the mutation transaction and render those snapshots, not
today's record. Include only fields appropriate for everyone who can view the
session, and link only to permission-checked application routes.

```tsx
resultUi: ({ result, status }) => (
  <div>
    <p>{sql`${result}->>'name'`}</p>
    <p>{sql`coalesce(${result}->>'before', 'Not recorded') || ' → ' || (${result}->>'after')`}</p>
    <Show when={sql`${status} = 'undone'`}>Undone</Show>
  </div>
),
```

The renderer is generation-time application code. Keep it read-only and
tolerant of older results that lack newer fields.

### Functions

`SparkFunction` — read-only domain computation the agent calls directly from
its sandbox script; runs immediately, returns JSON, no approval. It must be
idempotent; anything that writes must be an action.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Function id; callable as `capabilityName.name`. |
| `description` | `string` | Yes | Shown in the prompt. |
| `inputType` | `string` | No | Optional compact TypeScript input type shown to the agent. |
| `procedure` | `(s: GeneralServerStatements) => void` | Yes | Reads the `function_input` JSON scalar and returns JSON with `s.return(result)`. |

```tsx
import { sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";

const echo = {
  name: "echo",
  description: "Return the supplied JSON value",
  inputType: "unknown",
  procedure: (s: GeneralServerStatements) => {
    s.return(sql`function_input`);
  },
};
```

`s.return()` returns no result; JSON `null` is a result, while SQL NULL and
falling through produce none. Early returns and `try/catch/finally` keep their
normal procedure semantics. The JavaScript byte bridge needs no capability
declaration; its buffers stay scoped to the owning execution.

### Procedure size

Each action, function, and native tool is its own stored-procedure entry,
compiled on demand. Keep each entry small and move substantial reusable stages
into ordinary [stored procedures](../concepts/stored_procedures.md) with
explicit inputs and outputs; TypeScript helpers do not create compilation
boundaries. A unit-budget error calls for such a helper boundary, never for
splitting one atomic action into separate commits.

## Pages and Components

Both are named exports and static members on `SparkBlock`
(`SparkBlock.SparkPage`, `SparkBlock.SparkPanel`).

### `SparkPage`

Full-screen Spark app: conversation sidebar, timeline, composer, admin, and
full-card routes. It owns its internal `<AppRoutes>`. Shared conversations are
transcript-only for recipients; live generated cards remain owner-only and
recheck the owner's current permissions on every frame request.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | `string` | No | Route path alias retained for callers that pass `path`; `basePath` controls route construction. |
| `basePath` | `string` | No | Base path for internal Spark routes. Default `""`. |

### `SparkPanel`

The timeline and composer without sidebar chrome. Embed it in another app and
point it at one conversation; the host owns conversation creation, typically
through `sparkBlock.start`.

| Prop | Type | Required | Meaning |
| --- | --- | --- | --- |
| `conversationId` | `Sql` | Yes | The conversation id whose timeline to render. |
| `context` | `Sql` | No | Structured JSON context used when creating a new embedded conversation. |

## Starting non-chat runs

Get the instance with `const sparkBlock = system.block(SparkBlock);`.
`sparkBlock.start(s, opts)` inserts a run (conversation, agent, and seed
message) from any server-side statement builder: scheduled procs, API
endpoints, reactors, UI handlers, or parent agents. **The caller must wrap it in
`s.startTransaction()` / `s.commitTransaction()`.** It sets
`spark_start_conversation_id` and `spark_start_agent_id` for the caller.

`SparkStartOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `task` | `Sql \| string` | Yes | Seed task; inserted as the first `user_message`. |
| `capabilities` | `string[]` | Yes | The run's fixed capability set (capability names). |
| `sysUserId` | `Sql` | No | Run owner. Omit (null) for runs with no interactive user. |
| `label` | `Sql \| string` | No | Label shown in admin run lists. |
| `source` | `Sql \| string` | No | Trigger tag, e.g. `"scheduled:daily_brief"`. |
| `policy` | `SparkPolicy` | No | Non-interactive blocker handling. |
| `context` | `Sql` | No | Structured JSON task context stored as `context_json` and surfaced to the agent. |

`SparkPolicy`:

| Field | Type | Values |
| --- | --- | --- |
| `onQuestions` | `SparkQuestionPolicy` | `"ask"` \| `"fail"` \| `"use_defaults"` |
| `onApprovalLow` | `SparkApprovalPolicy` | `"ask"` \| `"auto_approve"` \| `"fail"` |
| `onApprovalHigh` | `SparkApprovalPolicy` | `"ask"` \| `"auto_approve"` \| `"fail"` |
| `onApprovalExternal` | `SparkApprovalPolicy` | `"ask"` \| `"auto_approve"` \| `"fail"` |

Omitted fields default to `onQuestions: "use_defaults"`,
`onApprovalLow: "auto_approve"`, `onApprovalHigh: "fail"`, and
`onApprovalExternal: "fail"`.

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
      policy: { onQuestions: "fail" },
    });
    s.commitTransaction();
  },
});
```

Every run loads the root `AGENTS.md` and the skill index; put run-specific
guidance in `task` (and `context`) and reusable procedure in a skill.

## Optional governed Drive integration

Pass `controlledDocuments` only when Spark should also consume and propose
changes to a controlled publication library:

- **Index in the prompt.** The system prompt ends with a
  `# Company documents (index)` listing the id, title, content mode, and
  description of every published, active file the conversation owner can read
  through Drive. Ownerless runs see organization-visible spaces only.
- **`loadDocument(id)` tool.** Loads native documents as Markdown and PDFs as
  extracted text, or one page as vision with `loadDocument({ id, renderPage })`.
  Other file types are indexed but cannot be loaded. Authorization matches the
  index.
- **`documents` capability.** `documents.edit_document` and
  `documents.create_document` are **draft-only**: they create a controlled
  revision or native Drive file attributed to the conversation owner; humans
  publish through the controlled-file UI. `edit_document` is undoable.
  `documents.update_document_metadata` (title/description, gated on
  `can_manage_controlled_files`) applies when approved, and undo restores the
  prior values. Non-chat runs need `"documents"` in their capabilities and a
  `sysUserId`; ownerless runs cannot write Drive files.

Action procedures read the acting user from `action_sys_user_id` (the
conversation owner; null for ownerless runs) during execution and undo.

## Drive tools

`sparkDriveCapability` from `blocks/spark/drive` builds a reusable capability
for browsing and organizing Drive spaces. Pass the Drive block and the exact
space types the tools may reach; add the factory again for another surface.

```tsx
import { sparkDriveCapability } from "blocks/spark/drive";

const files = sparkDriveCapability({
  name: "drive",
  files: drive,
  spaceTypes: [companyFiles, projectFiles],
  nativeDocuments, // optional: save_document and read_document
});
```

Functions: `list_spaces`, `list_items` (full paths, `recursive`, name `query`,
and `trashed` listings), and `get_item` (path and readable version history).
Reversible actions: `create_folder` (a slash-separated path that reuses existing
folders) and `update_item` (any of `name`, `description`, `folder_id`, or
`trashed` on one item). With `nativeDocuments`, `save_document` creates or
replaces a native document from Markdown and `read_document` returns an exact
version as Markdown (headings, emphasis, flat lists, block quotes, pipe tables).

Mutations run Drive's own procedures, so access, naming, cycle, extension, and
lifecycle rules still apply. File bytes use the built-in
`tools.prepareDriveUpload` and `tools.downloadDriveFile`. The optional
`fileSource` adds noticeable JIT work; omit it when external clients read files
locally.

## Built-in `auth_activity` capability

Registered automatically for Spark admins: `auth_session_tokens`
sys_user/issued and `auth_login_failures` identifier/reason columns, so admins
can ask "has X logged in today?". Session tokens, password/2FA material, IP
addresses, user agents, and transaction/version history are not queryable
through any Spark capability.

## Tables Created

Created inside `initialize()`; you do not declare them.

| Table | Purpose |
| --- | --- |
| `spark_conversations` | One row per run (chat or non-chat): `sys_user_id`, `label`, `source`, status, and `capabilities_json` (the fixed capability set). |
| `spark_agents` | Agent run state machines (`status`, `retry_count`, policy columns). |
| `spark_agent_events` | Canonical ordered event ledger for both the LLM and user-visible timeline. |
| `spark_attachments` | Bodies and metadata for uploaded or generated files, linked to their canonical event. |
| `spark_agent_pending_images` | One-turn retry queue for uploaded images to inline as vision. |
| `spark_action_log` | Compact write receipts. Approval proposals retain `input_json`; reversible actions retain their result and committed transaction id. |
| `spark_conversation_shares` | Targeted conversation shares. Organization-wide visibility lives on `spark_conversations.visibility`. |

The `spark_timeline` view derives the user-visible transcript from
`spark_agent_events` without a second copy of messages or tool output.

## Enums Created

`spark_conversation_status`, `spark_agent_status`, `spark_agent_event_type`,
`spark_danger_level`, `spark_action_status`, `spark_question_policy`,
`spark_approval_policy`, `spark_ai_reasoning_effort`,
`spark_ai_queue_preference`, `spark_conversation_visibility`.

## Exported Types

From `blocks/spark`: `SparkBlock`, `SparkBlockOpts`, `SparkCapability`,
`SparkAction`, `SparkFunction`, `SparkTableFields`, `SparkStartOpts`,
`SparkPolicy`, `SparkDanger`, `SparkQuestionPolicy`, `SparkApprovalPolicy`,
`SparkFileSource`, plus the `SparkPage` / `SparkPanel` components. Submodules
under `blocks/spark/*` export lower-level helpers; application code normally
needs only `blocks/spark` and the helpers named on this page.

## Relationships

- Requires a [`DriveBlock`](drive.md) hosting the dedicated Spark workspace.
  The optional `controlledDocuments` library is a separate governed Drive
  composition whose controlled-file permissions must be registered with Auth.
- Pairs with [`AuthBlock`](auth.md): capability and action permissions reuse
  existing application permissions rather than parallel Spark-specific data
  permissions, and the app page is normally wrapped in an auth guard.
- Block-provided capabilities are listed in
  [Block Spark management tools](spark_management_tools.md).

## Common Mistakes

- Granting the same data through a view and its raw table. The table grant makes
  the view's column or row filtering moot.
- Using approval mode with a hand-written `undo` for an ordinary database edit.
  Make it reversible and let constraints and state guards reject bad input.
- Wrapping `SparkPage` in `<Route>`; render it directly.
- Assuming chat uses `start()`'s blocker defaults. Interactive chat always waits
  for a human.
