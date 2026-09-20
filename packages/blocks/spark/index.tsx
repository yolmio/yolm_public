import {
  SparkActionResult,
  type SparkActionResultRenderer,
} from "./action_result";
import type { SparkFunctionContext } from "./function_context";
export type { SparkFunctionContext } from "./function_context";
import { initializeMcpConnections, type TenantMcpOptions } from "blocks/mcp";
import { McpSettings } from "blocks/mcp/settings";
import { registerSparkMcp, sparkMcpCapabilities } from "./mcp";
import {
  actionActivitySubject,
  actionActivityTitle,
  ExternalActionRow,
  SparkChangesPanel,
} from "./action_activity";
import { SparkMcpActivity } from "./mcp_activity";
import { AgentControls } from "components/agent_controls";
import { agentModelExpr, agentReasoningEffortExpr } from "std/agent_models";
import { Button } from "components/button";
import { Card } from "components/card";
import { CircularProgress } from "components/circular_progress";
import { MarkdownDisplay } from "components/markdown_display";
import { Chip } from "components/chip";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Sidebar } from "components/sidebar";
import type {
  SidebarAccountPresentation,
  SidebarBrand,
} from "components/sidebar";
import { AccountMenu } from "components/account_menu";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import {
  resetVirtualizedChatTimeline,
  VirtualizedChatTimeline,
} from "components/virtualized_chat_timeline";
import {
  CreateMarkdownDocumentButton,
  DriveBlock,
  DriveWorkspace,
  MarkdownDocumentEditor,
} from "blocks/drive";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import type {
  AuthorizeStatements,
  DomStatements,
  EndpointStatementsOrFn,
  GeneralServerStatements,
  ServerStatementsBase,
} from "std/statements";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { cssVar } from "std/style_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import {
  AppRoutes,
  DocumentTitle,
  DynamicNode,
  Each,
  Effect,
  EventHandlers,
  Listen,
  type Node,
  Route,
  Show,
  useUniqueId,
} from "std/ui";
import { AuthBlock, userHasPermission } from "../auth/index";
import { useJsModule } from "std/js_modules";
import { type RegisterReactorsOpts, registerSparkReactors } from "./agent";
let registeredMcpEnabled = true;
let registeredMcpOptions: RegisterReactorsOpts | undefined;
import {
  hasSparkPermissionGate,
  type SparkPermissionRequirement,
} from "./permissions.ts";
export type { SparkPermissionRequirement } from "./permissions.ts";
import {
  canReadSparkKnowledgeFile,
  type SparkDriveKnowledge,
  sparkPublishedFileVersionId,
} from "./drive_knowledge.ts";
import {
  sparkSkillDefinitionFieldsValid,
  sparkSkillDocumentContent,
  sparkSkillFrontmatterValid,
  sparkSkillRenderedContent,
  type SparkWorkspace,
} from "./workspace.ts";
export {
  sparkSpaceType,
  type SparkWorkspace,
  type SparkWorkspaceType,
} from "./workspace.ts";
import { styles } from "./styles";
import { undoSparkActionBatch } from "./action_undo";
import {
  conversationListQuery,
  conversationVisibleTo,
  defConversationScalars,
  sparkCardPath,
  sparkConvPath,
  sparkListPath,
  visibleConversationId,
} from "./helpers";

// JSON-array of the capabilities a fresh chat conversation gets: every
// non-internal capability whose permission requirement the user satisfies (a
// capability with no requirement is available to anyone with Spark access).
function chatCapabilitiesJsonExpr(): Sql {
  const visible = registeredCapabilitiesMeta.filter((sk) => !sk.internal);
  if (visible.length === 0) return sql`'[]'::json`;
  let items: Sql = sql`''`;
  for (const sk of visible) {
    const lit = sql.lit(`"${sk.name}",`);
    const permitted = sk.permission !== undefined || sk.permissions
      ? hasSparkPermissionGate(
        sk.permission,
        sk.permissions,
        sql`current_user`,
      )
      : sql`true`;
    items = sql`${items} || case when ${permitted} then ${lit} else '' end`;
  }
  // items is '"a","b",…,' with a trailing comma — strip it with left()
  // (Yolm's rtrim is single-argument).
  return sql`(case when (${items}) = '' then '[]'
    else '[' || left(${items}, length(${items}) - 1) || ']' end)::json`;
}

// ---------------------------------------------------------------------------
// Module-level registries populated by the block lifecycle before app
// rendering. The static `SparkPage` / `SparkPanel` components read these.
// ---------------------------------------------------------------------------

// Approval-card renderers for actions that define `approvalUi`.
const registeredActionRenderers: Array<{
  qualifiedName: string;
  render: (
    props: { input: import("../../std/sql_utils").Sql },
  ) => import("std/ui").Node;
}> = [];
const registeredResultRenderers: SparkActionResultRenderer[] = [];
const registeredReversibleActions: string[] = [];
const registeredUndoActions: string[] = [];

function registeredReversibleActionCondition(actionName: Sql): Sql {
  if (registeredReversibleActions.length === 0) return sql`false`;
  return sql`(${
    registeredReversibleActions.slice(1).reduce(
      (condition, name) =>
        sql`${condition} or ${actionName} = ${sql.lit(name)}`,
      sql`${actionName} = ${sql.lit(registeredReversibleActions[0])}`,
    )
  })`;
}

function registeredUndoActionCondition(actionName: Sql): Sql {
  if (registeredUndoActions.length === 0) return sql`false`;
  return sql`(${
    registeredUndoActions.slice(1).reduce(
      (condition, name) =>
        sql`${condition} or ${actionName} = ${sql.lit(name)}`,
      sql`${actionName} = ${sql.lit(registeredUndoActions[0])}`,
    )
  })`;
}

// Union of every skill's `views`/`tables` — the compile-time access policy for
// agent-generated render_ui cards. Per-conversation narrowing is enforced by UI
// preflight, but DynamicNode's policy is fixed at compile time, so the render
// boundary is the union across all registered capabilities.
const registeredUiViews: string[] = [];
const registeredUiTables: string[] = [];
const registeredUiFieldWhitelist: SparkTableFields[] = [];

// Optional consumer-provided display-name resolver for the share picker
// (SparkBlockOpts.userDisplayName), set during block population. The block can't
// name a `sys_users` id — no name column is guaranteed across auth types — so
// it falls back to `User <id>`.
let registeredUserDisplayName: ((userIdExpr: Sql) => Sql) | undefined;
function sparkUserNameExpr(userIdExpr: Sql): Sql {
  const custom = registeredUserDisplayName?.(userIdExpr);
  return custom
    ? sql`coalesce(${custom}, 'User ' || ${userIdExpr}::string)`
    : sql`'User ' || ${userIdExpr}::string`;
}

// Capability metadata for chat conversation creation (which capabilities a new chat
// conversation gets) — internal skills are excluded; permission-gated capabilities
// are checked against the creating user.
const registeredCapabilitiesMeta: Array<{
  name: string;
  description: string;
  label?: string;
  permission?: string;
  permissions?: SparkPermissionRequirement;
  internal?: boolean;
}> = [];

const defaultSparkAccessPermission = "can_use_spark";
const defaultSparkAdminPermission = "can_admin_spark";
let registeredSparkAccessPermission = defaultSparkAccessPermission;
let registeredSparkAdminPermission = defaultSparkAdminPermission;
let registeredSparkWorkspace: SparkWorkspace | undefined;
let registeredSparkDefaultReasoningEffort: SparkReasoningEffort = "low";
let registeredSparkAuthenticateDynamicRequest:
  | ((s: AuthorizeStatements) => void)
  | undefined;
let registeredSparkOnCardEvent: ((s: DomStatements) => void) | undefined;
let registeredSparkAccountMenu:
  | ((props: SidebarAccountPresentation) => Node)
  | undefined;
let registeredSparkBrand: SidebarBrand | undefined;

function canAdminSpark(): Sql {
  return userHasPermission(
    sql.lit(registeredSparkAdminPermission),
    sql`current_user`,
  );
}

function canAccessSpark(userExpr: Sql): Sql {
  return userHasPermission(sql.lit(registeredSparkAccessPermission), userExpr);
}

function canRenderSparkCard(ownerId: Sql, capabilities: Sql): Sql {
  let retainedCapabilities = sql`true`;
  for (const capability of registeredCapabilitiesMeta) {
    if (capability.permission === undefined && !capability.permissions) {
      continue;
    }
    const permitted = hasSparkPermissionGate(
      capability.permission,
      capability.permissions,
      sql`current_user`,
    );
    retainedCapabilities = sql`${retainedCapabilities} and (
      not ${capabilities} @> json_build_array(${sql.lit(capability.name)})
      or ${permitted}
    )`;
  }
  return sql`${ownerId} = current_user
    and ${canAccessSpark(sql`current_user`)}
    and ${retainedCapabilities}`;
}

// File types the composer accepts — file picker, paste, and drop all share it.
const sparkAttachmentAccept =
  ".csv,.tsv,.txt,.json,.md,.xlsx,.xls,.docx,.pdf,.png,.jpg,.jpeg,.gif,.webp";

// Text bodies above this are staged as binary attachments instead of being
// inlined — the user message content column caps at 50,000 chars and the
// inline body must leave room for the message text + markers.
const sparkAttachmentMaxInlineTextBytes = 45000;

// Hard cap on a single uploaded attachment.
const sparkAttachmentMaxUploadBytes = 25 * 1024 * 1024;

const sparkAttachmentUploadPath = "/spark/attachments/upload";

// Domains whose upload endpoint is already registered — the composer
// auto-registers for its rendering app's domain, and manual
// registerSparkAttachmentUploadApi() calls record here too, so the endpoint
// is registered exactly once per domain.
const sparkUploadApiDomains = new Set<string>();

/**
 * Register the attachment upload endpoint (`POST /api/spark/attachments/upload`)
 * for a domain that hosts SparkPage / SparkPanel. The composer auto-registers
 * this for its app's domain (with the default `y-t` session cookie) when it
 * renders, so calling this is only needed when the domain's auth flow uses a
 * custom cookie name — call it before the app's UI is constructed.
 */
export function registerSparkAttachmentUploadApi(opts: {
  domain: string;
  /** Alternate domains routed to the app (defaults to none). */
  domainAliases?: string[];
  /** Session cookie name used by the app's AuthBlock (defaults to `y-t`). */
  cookieName?: Sql;
}) {
  if (sparkUploadApiDomains.has(opts.domain)) {
    return;
  }
  sparkUploadApiDomains.add(opts.domain);
  const api = system.api({
    prefix: "/api",
    domain: opts.domain,
    domainAliases: opts.domainAliases,
  });
  api.get("/spark/attachments/{preview_attachment_id:id}/pdf", {
    procedure: (s) => {
      AuthBlock.validateApi(s, opts.cookieName ?? sql.lit`y-t`);
      s.defScalar("preview_user", sql`coalesce(auth_user_id, current_user)`);
      s.if(sql`preview_user is null`, (s) => {
        s.setHttpStatus(401);
        s.return(sql.lit`Not authenticated`);
      });
      s.if(
        sql`not (${
          canAccessSpark(sql`preview_user`)
        }) or not exists(select 1 from db.sys_users where id = preview_user and not disabled)`,
        (s) => {
          s.setHttpStatus(403);
          s.return(sql.lit`Not authorized`);
        },
      );
      s.defScalar(
        "preview_hash",
        sql`(select f.blob_hash from db.spark_attachments f
        join db.spark_agent_events e on e.id = f.spark_event_id
        join db.spark_agents a on a.id = e.spark_agent_id
        join db.spark_conversations c on c.id = a.spark_conversation_id
        where f.id = preview_attachment_id and f.expires_at > now()
        and f.mime_type = 'application/pdf' and (${
          conversationVisibleTo(sql`c`, sql`preview_user`)
        }))`,
      );
      s.if(sql`preview_hash is null`, (s) => {
        s.setHttpStatus(404);
        s.return(sql.lit`File unavailable`);
      });
      s.setHeader("content-type", sql.lit`application/pdf`);
      s.setHeader("x-content-type-options", sql.lit`nosniff`);
      s.setHeader("cache-control", sql.lit`private, no-store`);
      s.returnBlob(sql`preview_hash`);
    },
  });
  api.post(sparkAttachmentUploadPath, {
    query: [
      { name: "file_name", type: { type: "String", maxLength: 500 } },
      { name: "content_type", type: { type: "String", maxLength: 200 } },
      { name: "file_size", type: { type: "BigInt" } },
    ],
    bytesBodyScalar: "file_bytes",
    procedure: (s) => {
      AuthBlock.validateApi(s, opts.cookieName ?? sql.lit`y-t`);
      // current_user is populated on API requests only by the local dev
      // server's auth override (auto-login / user-selector); in production it
      // is always null here, so the session cookie is the only way in.
      s.defScalar("upload_user", sql`coalesce(auth_user_id, current_user)`);
      s.if(sql`upload_user is null`, (s) => {
        s.setHttpStatus(401);
        s.return(sql.lit`Not authenticated`);
      });
      s.if(sql`not ${canAccessSpark(sql`upload_user`)}`, (s) => {
        s.setHttpStatus(403);
        s.return(sql.lit`Not authorized`);
      });
      s.defScalar(
        "upload_name",
        sql`nullif(trim(coalesce(file_name, '')), '')`,
      );
      s.if(sql`upload_name is null`, (s) => {
        s.setHttpStatus(400);
        s.return(sql.lit`Missing file name`);
      });
      s.if(sql`octet_length(file_bytes) = 0`, (s) => {
        s.setHttpStatus(400);
        s.return(sql.lit`Empty file upload`);
      });
      s.if(
        sql`file_size is not null and file_size <> octet_length(file_bytes)`,
        (s) => {
          s.setHttpStatus(400);
          s.return(sql.lit`Upload size did not match selected file size`);
        },
      );
      s.if(
        sql`octet_length(file_bytes) > ${sparkAttachmentMaxUploadBytes}`,
        (s) => {
          s.setHttpStatus(400);
          s.return(sql.lit`File is too large`);
        },
      );
      s.defScalar(
        "upload_mime",
        sql`lower(coalesce(nullif(trim(coalesce(content_type, '')), ''),
          'application/octet-stream'))`,
      );
      s.defScalar(
        "upload_is_text",
        sql`(upload_mime like 'text/%'
            or upload_mime in ('application/json', 'application/x-ndjson'))
          and octet_length(file_bytes) <= ${sparkAttachmentMaxInlineTextBytes}`,
      );
      s.setHeader("content-type", sql.lit`application/json`);
      s.if(sql`upload_is_text`, (s) => {
        s.return(sql`json_build_object(
          'kind', 'text',
          'name', upload_name,
          'mimeType', upload_mime,
          'size', octet_length(file_bytes),
          'body', string.from_utf8(file_bytes))`);
      });
      s.createBlob(sql`file_bytes`, { defHashScalar: "upload_blob_hash" });
      s.return(sql`json_build_object(
        'kind', case
          when upload_mime like 'image/%' or upload_mime = 'application/pdf'
            then 'image'
          else 'binary'
        end,
        'name', upload_name,
        'mimeType', upload_mime,
        'size', octet_length(file_bytes),
        'blobHashHex', bytes.to_hex(upload_blob_hash))`);
    },
  });
}

// Returns a SQL fragment that excludes action names with custom approval
// renderers from the JSON fallback path. Empty when the registry is empty.
function notRenderedActionCondition(): Sql {
  if (registeredActionRenderers.length === 0) return sql``;
  const lits = registeredActionRenderers.map((e) => sql.lit(e.qualifiedName));
  let list = lits[0];
  for (let i = 1; i < lits.length; i++) {
    list = sql`${list}, ${lits[i]}`;
  }
  return sql`and action.action_name not in (${list})`;
}

//
// Types
//

export type SparkDanger = "low" | "high" | "external";

/** A governed side effect. Spark owns the transaction around every procedure
 * and its durable receipt. */
export interface SparkAction {
  name: string;
  description: string;
  /** TypeScript type shown to the agent for this action's input. */
  inputType: string;
  /** One additional permission required beyond the containing capability. */
  permission?: string;
  /** Additional any/all permissions. Mutually exclusive with `permission`. */
  permissions?: SparkPermissionRequirement;
  /** Approval tier for approval-mode actions. */
  danger?: SparkDanger;
  /**
   * `reversible` actions execute without approval, inside a transaction owned
   * by Spark, and use the committed transaction as their undo receipt.
   * Reversible actions cannot define `approvalUi` because they never enter the
   * approval flow.
   * Defaults to `approval`, preserving the proposal flow.
   */
  mode?: "approval" | "reversible";
  /**
   * Renders one row in the pending-actions approval card. Receives `input`
   * as a Sql expression resolving to the proposed `input_json`. The render
   * runs at generation time and may query the db (e.g. to show a
   * before/after diff against live data) — the agent cannot influence what
   * the approver sees here. Falls back to a stripped-JSON one-liner.
   */
  approvalUi?: (
    props: { input: import("../../std/sql_utils").Sql },
  ) => import("std/ui").Node;
  /**
   * Optional read-only presentation of a recorded result in chat and Changes.
   * Receives the persisted result_json and current receipt status (including
   * undone). Capture target names and before/after values in action_result;
   * do not reconstruct historical facts from live records. Handle older result
   * shapes gracefully. A null result uses the missing-result fallback; actions
   * without this renderer use the generic field list and technical details.
   */
  resultUi?: (props: { result: Sql; status: Sql }) => import("std/ui").Node;
  /**
   * Optional read-only validation for reversible actions. Runs immediately
   * before Spark opens the transaction, so it may perform service requests.
   * Reads `action_input` and `action_sys_user_id`; declarations remain visible
   * to `procedure`.
   */
  preflight?: (
    s: import("std/statements").GeneralServerStatements,
  ) => void;
  /**
   * Runs server-side after approval or immediately for reversible actions.
   * Reads `action_input`; may set `action_result` to a compact JSON string.
   * The procedure is a transaction body: do not start or commit a transaction.
   */
  procedure?: (
    s: import("std/statements").GeneralServerStatements,
  ) => void;
  /** Custom transaction body for approval-mode undo. Reversible mode uses transaction undo. */
  undo?: (
    s: import("std/statements").GeneralServerStatements,
  ) => void;
}

/**
 * A function: read-only domain computation the agent can call directly from
 * SCRIPT — no approval, runs immediately, returns JSON. The procedure reads
 * the `function_input` JSON scalar and must call `s.return(<json expr>)`.
 * MUST be read-only/idempotent by contract: if it writes, it's an action.
 */
export interface SparkFunction {
  name: string;
  description: string;
  /** TypeScript type shown to the agent for this function's input. */
  inputType?: string;
  /** Maximum wall time while JavaScript waits for this function. */
  timeoutMs?: number;
  procedure: (
    s: import("std/statements").GeneralServerStatements,
    context: SparkFunctionContext,
  ) => void;
}

export interface SparkTableFields {
  table: string;
  fields: string[];
}

/**
 * A capability: a permission-gated tool bundle for a role. The capability list
 * of a conversation is fixed at creation (static loading) — its docs go in
 * the system prompt, its views/tables become the query whitelist, and its
 * actions/functions become callable tools.
 */
export interface SparkCapability {
  /** Stable key for the capability (used in assignments, doc scoping, JSON). */
  name: string;
  description: string;
  /** Human-facing name shown in the admin capability-assignment UI. */
  label?: string;
  /**
   * One permission required for this capability. Omit both permission fields
   * to make it available to anyone with Spark access.
   */
  permission?: string;
  /** Any/all permissions. Mutually exclusive with `permission`. */
  permissions?: SparkPermissionRequirement;
  /**
   * Internal skills are excluded from chat conversations; only non-chat runs
   * that list them in `SparkStartOpts.capabilities` get them.
   */
  internal?: boolean;
  /** Views queryable via `tools.query()`. Preferred read surface. */
  views?: string[];
  /**
   * Tables the agent may read WHOLE (all columns) via `tools.query()` and from
   * render_ui cards (as db.<name>). Also the DynamicNode compile-time whitelist;
   * keep it minimal. A table listed here but NOT in `fieldWhitelist` is a
   * wholesale grant, and that wins over any column restriction another held
   * capability places on the same table.
   */
  tables?: string[];
  /**
   * Column-level read access for a table (`tools.query()` + render_ui). Use for
   * tables with sensitive fields. Caveat: once a table appears here it is capped
   * to these columns for the ENTIRE query, unioned across every held capability
   * that restricts it — UNLESS some held capability grants the same table
   * wholesale via `tables` (which wins). So do not list a table in both `tables`
   * and `fieldWhitelist` within one capability expecting whole access — the
   * restriction applies; pick one.
   */
  fieldWhitelist?: SparkTableFields[];
  actions?: SparkAction[];
  functions?: SparkFunction[];
  /**
   * System-file sources the agent may read as vision. The block exposes
   * `readFileImage({ source, id })` to read PNG, JPEG, or WebP, or accepts
   * `{ source, id, page, width, renderMode? }` to render one PDF page.
   * PDF rendering defaults to `annotated`;
   * `original` requests the untouched source page. This is how an agent sees
   * live system files (project drawings, contracts, …) without copying them
   * into the conversation.
   */
  fileSources?: SparkFileSource[];
  /** Guidance markdown: schemas, conventions, examples, gotchas. */
  doc: string;
}

/**
 * A readable file source the agent can pull blobs from as vision via
 * `readFileImage`. A capability may expose its ids through a bounded function
 * instead of granting direct relation access.
 */
export interface SparkFileSource {
  /** Key the agent passes to readFileImage(), e.g. "drawings". */
  name: string;
  /** Backing relation for the file lookup. */
  table: string;
  /** blobRef column holding the file bytes. Required without `lookup`. */
  blobColumn?: string;
  /** String column holding the MIME type. Required without `lookup`. */
  mimeColumn?: string;
  /** Optional string column used to label the image in the transcript. */
  nameColumn?: string;
  /**
   * Optional joined lookup for normalized file records. The query must return
   * `bh` (blob hash), `mime`, and `label` for the supplied source id. Use this
   * when bytes and metadata live in separate tables, as with Drive versions.
   * The context identifies the user who owns the Spark conversation.
   */
  lookup?: (id: Sql, context: SparkFileSourceLookupContext) => Sql;
  /**
   * Optional server-side PDF page renderer. Use this when the vision image
   * needs source-specific overlays or transforms before Spark sees it. The
   * callback runs only for the default `annotated` mode and must declare
   * `defOutputScalar` as PNG, JPEG, or WebP bytes. `original` bypasses it.
   */
  renderPdfPage?: (
    s: GeneralServerStatements,
    opts: SparkFileSourcePdfPageRenderOptions,
  ) => void;
  /** Optional structured saved-markup reader exposed as readFileMarkup(). */
  readPdfMarkup?: (
    s: GeneralServerStatements,
    opts: SparkFileSourcePdfMarkupReadOptions,
  ) => void;
}

export interface SparkFileSourceLookupContext {
  /** User who owns the Spark conversation executing the file tool. */
  sysUserId: Sql;
}

export interface SparkFileSourcePdfPageRenderOptions {
  /** Source row id passed to readFileImage(). */
  fileId: Sql;
  /** Original PDF bytes. */
  pdf: Sql;
  /** Requested one-based page number. */
  page: Sql;
  /** Effective page width and height in PDF points. */
  pageWidth: Sql;
  pageHeight: Sql;
  /** Requested output width in pixels. */
  renderWidth: Sql;
  /** Name the callback must use when declaring its output bytes scalar. */
  defOutputScalar: string;
}

export interface SparkFileSourcePdfMarkupReadOptions {
  /** Source row id passed to readFileMarkup(). */
  fileId: Sql;
  /** Optional one-based page number; null requests the complete document. */
  page: Sql;
  /** Name the callback must use when declaring its JSON output scalar. */
  defOutputScalar: string;
}

export type SparkQuestionPolicy = "ask" | "fail" | "use_defaults";
export type SparkApprovalPolicy = "ask" | "auto_approve" | "fail";
export type SparkReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * Per-agent policy for non-interactive blocker handling. Any field left
 * unset defaults to `"ask"`, which preserves the chat-style "wait for human"
 * behavior. A non-chat run typically sets every field so the agent never
 * stalls waiting on a human.
 */
export interface SparkPolicy {
  onQuestions?: SparkQuestionPolicy;
  onApprovalLow?: SparkApprovalPolicy;
  onApprovalHigh?: SparkApprovalPolicy;
  onApprovalExternal?: SparkApprovalPolicy;
}

/**
 * Options for `sparkBlock.start(s, opts)`. Any server-side statement builder
 * (UI event handler, API endpoint, scheduled proc, reactor, parent agent) can
 * insert a spark run using this helper; the existing reactors dispatch it.
 */
export interface SparkStartOpts {
  /** Seed task. Inserted as the first `user_message` agent event. */
  task: Sql | string;
  /**
   * Owner of the run. Null (the default) is correct for runs with no
   * interactive user — scheduled jobs, API callers without auth, reactors.
   */
  sysUserId?: Sql;
  /** Human-facing label shown in admin run lists. */
  label?: Sql | string;
  /** Freeform trigger tag ("scheduled:daily_brief", "api:/foo", etc.). */
  source?: Sql | string;
  /**
   * The run's static skill set. Fixed for the conversation's lifetime: docs
   * go in the system prompt, views/tables become the query whitelist, and
   * the skills' actions/functions become callable.
   */
  capabilities: string[];
  /** Non-interactive policy; safe autonomous defaults when unset. */
  policy?: SparkPolicy;
  /**
   * Structured task context (a JSON Sql expression) stored on the conversation
   * as context_json — surfaced to the agent and validated by capability
   * actions. E.g. sql`json_build_object('revision_id', 12, 'project_id', 226)`.
   */
  context?: Sql;
}

export interface SparkWorkspaceSeedOpts {
  instructions: Sql | string;
  /** Defaults to the first system user; setup must create a user first. */
  createdByUserId?: Sql;
  skills?: Array<{
    name: string;
    description: string;
    instructions: Sql | string;
  }>;
}

export interface SparkBlockOpts {
  /** Set false to omit MCP schema, endpoints, and connection settings. */
  mcp?: boolean;
  /** Spark's dedicated, standalone Markdown Drive workspace. */
  workspace: SparkWorkspace;
  /** Reasoning effort for new conversations. Defaults to `low`. */
  defaultReasoningEffort?: SparkReasoningEffort;
  /**
   * Optional governed document library. Supplying it installs the controlled
   * documents capability; Spark's own workspace never requires a lifecycle.
   */
  controlledDocuments?: SparkDriveKnowledge;
  capabilities: SparkCapability[];
  /**
   * Permission that grants access to Spark pages and conversation sharing.
   * Defaults to the original Spark block permission for existing systems.
   */
  accessPermission?: string;
  /**
   * Permission that grants Spark workspace administration.
   */
  adminPermission?: string;
  /** Resolve the request's session and set current_user for dynamic cards.
   * Dynamic requests do not inherit ancestor page authorization. Ownership
   * and Spark/capability permission checks still run after this hook.
   */
  authenticateDynamicRequest?: (s: AuthorizeStatements) => void;
  /** Handle application-specific card events in the host (e.g. source navigation).
   * Unhandled events continue through Spark's normal event logging.
   */
  onCardEvent?: (s: DomStatements) => void;
  /**
   * Allow the agent to call `render_ui` with DynamicNode TSX. On by default.
   * Dynamic-UI rendering needs the framework packages available to the
   * compiler: the deployed studio packages artifact in production, or the repo
   * `packages/` via the `YOLM_PACKAGES_DIR` env var in local dev. A card that
   * still fails to compile is returned as tool feedback so the agent can fix it
   * or answer without a card. Set to
   * `false` to disable the UI rendering tool.
   */
  enableDynamicUi?: boolean;
  /**
   * Bundled JS-module ids (e.g. `"listbox_nav"`) that rendered cards may
   * import + `jsCall` into. Empty (default) = no client JS. Passed to the
   * dynamic-UI preflight as the capability allowlist; only add vetted,
   * repo-shipped modules, since this widens the same-origin card sandbox.
   * `listbox_nav` unlocks `select` / `tabs` / `menu`.
   */
  allowedCardJsModules?: string[];
  /**
   * Resolves a human display name for a `sys_users` id, used by the share
   * picker. `sys_users` has no guaranteed name column (username/email exist only
   * for those auth types), so the generic block falls back to `User <id>`. A
   * consumer whose people live elsewhere passes a name expression — e.g.
   * `(id) => sql\`(select display_name from db.workforce_people wp join
   * db.sys_users su on su.workforce_person_id = wp.id where su.id = ${id})\``.
   * A null result falls back to `User <id>`.
   */
  userDisplayName?: (userIdExpr: Sql) => Sql;
  /** Account renderer for expanded, rail, and mobile-header presentations. */
  accountMenu?: (props: SidebarAccountPresentation) => Node;
  /** Shared shell branding; defaults to Spark when omitted. */
  brand?: SidebarBrand;
  /**
   * Dev/test-only stand-in for the native OpenAI harness, used instead of a
   * real OpenAI call. See `generateNativeSparkResponse`'s `mockProcedure`
   * (in `native_llm.ts`) for the required response shape.
   */
  mockProcedure?: EndpointStatementsOrFn;
}

//
// Styles
//

//
// UI Components
//

// Per-conversation status indicator for the sidebar (studio-style). Reads the
// derived booleans on the `conv` record. Precedence: paused > needs-attention
// (pending question / proposed action) > actively working.
function ConversationStatusBadge() {
  return (
    <>
      <Show when={sql`conv.is_paused`}>
        <MaterialIcon
          icon="PauseCircleOutline"
          fontSize="sm"
          sx={{ color: cssVar("palette-warning-500") }}
        />
      </Show>
      <Show when={sql`not conv.is_paused and conv.needs_attention`}>
        <MaterialIcon
          icon="HelpOutline"
          fontSize="sm"
          sx={{ color: cssVar("palette-primary-500") }}
        />
      </Show>
      <Show
        when={sql`not conv.is_paused and not conv.needs_attention and conv.is_working`}
      >
        <span
          aria-label="Working"
          className="h-1.5 w-1.5 rounded-full bg-neutral-400 motion-safe:animate-pulse"
        />
      </Show>
    </>
  );
}

function SparkSidebarAccount(props: SidebarAccountPresentation) {
  if (registeredSparkAccountMenu) return registeredSparkAccountMenu(props);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("spark_account_name", sparkUserNameExpr(sql`current_user`));
      }}
    >
      <AccountMenu
        {...props}
        userName={sql`spark_account_name`}
        userInitials={sql`upper(
        substring(trim(spark_account_name) from 1 for 1)
        || case when position(' ' in trim(spark_account_name)) > 0
          then substring(trim(spark_account_name) from position(' ' in trim(spark_account_name)) + 1 for 1)
          else '' end)`}
        apps={[]}
      />
    </Data>
  );
}

function sparkSidebarShell() {
  return {
    brand: registeredSparkBrand ?? { name: "Spark", initials: "S" },
    account: (presentation: SidebarAccountPresentation) => (
      <SparkSidebarAccount {...presentation} />
    ),
  };
}

function SparkConversationSearch() {
  const inputId = useUniqueId();
  const inputExpr = typeof inputId === "string" ? sql.lit(inputId) : inputId;
  return (
    <div sx={styles.sidebarSearch}>
      <Input
        id={inputId}
        size="sm"
        placeholder="Search chats"
        value={sql`conv_search`}
        onInput={(s) => s.setScalar("conv_search", sql`target_value`)}
        startDecorator={
          <MaterialIcon
            icon="Search"
            sx={{ fontSize: "sm", color: cssVar("palette-text-tertiary") }}
          />
        }
      />
      <Effect
        triggerOnMount
        watch={sql`sidebar_search_focus_key`}
        onChange={(s) => {
          // Wait for the expanded branch to be rendered, then focus only its visible input.
          s.sleep(16);
          s.element(inputExpr).getBoundingClientRect("spark_search_bounds");
          s.if(
            sql`spark_search_bounds.width > 0`,
            (s) => s.element(inputExpr).focus(),
          );
        }}
      />
    </div>
  );
}

function ConversationListPanel(props: { basePath?: string }) {
  const basePath = props.basePath ?? "";
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("conv_search", sql.lit``);
        s.defScalar("sidebar_search_open", false);
        s.defScalar("sidebar_search_focus_key", 0);
      }}
    >
      <Sidebar.Root
        variant="plain"
        color="neutral"
        rail={
          <>
            <Sidebar.RailButton
              icon="Create"
              label="New chat"
              href={sparkListPath(basePath)}
            />
            <Sidebar.RailButton
              icon="Search"
              label="Search chats"
              onClick={(s) => {
                s.setScalar("sidebar_open", true);
                s.setScalar("sidebar_search_open", true);
                s.increment("sidebar_search_focus_key");
              }}
            />
            <Sidebar.RailButton
              icon="ChatBubbleOutline"
              label="Open chats"
              onClick={(s) => s.setScalar("sidebar_open", true)}
            />
          </>
        }
      >
        <Sidebar.Header
          title="Spark"
          actions={
            <IconButton
              icon="Search"
              variant="plain"
              color="neutral"
              size="sm"
              aria-label="Search chats"
              tooltip="Search chats"
              sx={{ "--icon-font-size": "18px" }}
              onClick={(s) => {
                s.setScalar("sidebar_search_open", true);
                s.increment("sidebar_search_focus_key");
              }}
            />
          }
        />
        <Sidebar.Content
          sx={{
            display: "flex",
            flexDirection: "column",
            padding: 0,
            flex: 1,
            minHeight: 0,
          }}
        >
          <Data
            local
            procedure={(s) => s.defScalar("sb_can_admin", canAdminSpark())}
          >
            <Sidebar.Menu sx={{ px: 1, pt: 1, pb: 0.5, flexGrow: 0 }}>
              <Sidebar.MenuItem sx={{ py: 0 }}>
                <Sidebar.MenuButton
                  icon="Create"
                  href={sparkListPath(basePath)}
                >
                  New chat
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
              {registeredMcpEnabled && (
                <Sidebar.MenuItem sx={{ py: 0 }}>
                  <Sidebar.MenuButton
                    icon="Link"
                    href={sql.lit(`${basePath}/connected-assistants`)}
                  >
                    Connected assistants
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              )}
              <Show when={sql`sb_can_admin`}>
                <Sidebar.MenuItem sx={{ py: 0 }}>
                  <Sidebar.MenuButton
                    icon="AdminPanelSettings"
                    href={sql.lit(`${basePath}/admin`)}
                  >
                    Spark admin
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Show>
            </Sidebar.Menu>
          </Data>
          <Show when={sql`sidebar_search_open`}>
            <SparkConversationSearch />
          </Show>
          <div sx={styles.sidebarSectionLabel}>Chats</div>
          <div sx={styles.sidebarList}>
            <Listen
              query={sql`select
                  c.id as conversation_id,
                  c.label,
                  c.last_message_at,
                  c.is_paused,
                  agent.id as agent_id,
                  agent.status as agent_status,
                  action.id as action_id,
                  action.status as action_status
                from db.spark_conversations c
                left join db.spark_agents agent
                  on agent.spark_conversation_id = c.id
                  and agent.status in (
                    'awaiting_plan', 'awaiting_execute', 'executing',
                    'waiting_on_questions', 'failed_retrying_plan'
                  )
                left join db.spark_action_log action
                  on action.spark_conversation_id = c.id
                  and action.status = 'proposed'
                where c.sys_user_id = current_user
                  and c.status = 'active'`}
              onChange={(s) => s.increment("refresh_key")}
            />
            <Data
              watch={[sql`refresh_key`, sql`conv_search`]}
              procedure={(s) => {
                s.defTable(
                  "conversations",
                  conversationListQuery(sql`c.sys_user_id = current_user`),
                );
              }}
            >
              <Sidebar.Menu>
                <Each table="conversations" recordName="conv">
                  <Sidebar.MenuItem sx={{ py: 0 }}>
                    <Sidebar.MenuButton
                      href={sparkConvPath(basePath, sql`conv.id`)}
                    >
                      <div sx={styles.sidebarItemRow}>
                        <span sx={styles.sidebarItemTitle}>
                          {sql`coalesce(nullif(conv.label, ''), 'New conversation')`}
                        </span>
                        <div sx={styles.sidebarItemBadge}>
                          <ConversationStatusBadge />
                        </div>
                      </div>
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                </Each>
              </Sidebar.Menu>
            </Data>
            <Data
              watch={[sql`refresh_key`, sql`conv_search`]}
              procedure={(s) => {
                s.defTable(
                  "shared_conversations",
                  conversationListQuery(
                    sql`(c.sys_user_id is null
                        or c.sys_user_id != current_user)
                      and ${conversationVisibleTo(sql`c`, sql`current_user`)}`,
                  ),
                );
                s.defScalar(
                  "shared_count",
                  sql`(select count(*) from shared_conversations)`,
                );
              }}
            >
              <Show when={sql`shared_count > 0`}>
                <div sx={styles.sidebarSectionLabel}>Shared with me</div>
                <Sidebar.Menu>
                  <Each table="shared_conversations" recordName="conv">
                    <Sidebar.MenuItem sx={{ py: 0 }}>
                      <Sidebar.MenuButton
                        href={sparkConvPath(basePath, sql`conv.id`)}
                      >
                        <div sx={styles.sidebarItemRow}>
                          <span sx={styles.sidebarItemTitle}>
                            {sql`coalesce(nullif(conv.label, ''), 'Conversation')`}
                          </span>
                          <div sx={styles.sidebarItemBadge}>
                            <ConversationStatusBadge />
                          </div>
                        </div>
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                  </Each>
                </Sidebar.Menu>
              </Show>
            </Data>
          </div>
        </Sidebar.Content>
      </Sidebar.Root>
    </Data>
  );
}

/**
 * The agent-generated UI card, rendered through DynamicNode. Shared by the
 * inline timeline card (`sizing="fit"`) and the full-page artifact view
 * (`sizing="fill"`). Table/field access is enforced at compile time by the
 * registered whitelist; the authorize proc gates every frame/data request.
 * `active_conversation_id` must be in scope (both call sites define it).
 */
function SparkCardNode(
  props: {
    sourceExpr: Sql;
    metaEventIdExpr: Sql;
    ownerIdExpr: Sql;
    capabilitiesExpr: Sql;
    sizing?: "fit" | "fill";
  },
) {
  return (
    <DynamicNode
      source={props.sourceExpr}
      sizing={props.sizing ?? "fit"}
      accessPolicy={{
        viewWhitelist: registeredUiViews,
        tableWhitelist: registeredUiTables,
        fieldWhitelist: registeredUiFieldWhitelist,
      }}
      meta={sql`json_build_object(
        'conversation_id', active_conversation_id,
        'event_id', ${props.metaEventIdExpr},
        'owner_id', ${props.ownerIdExpr},
        'capabilities', ${props.capabilitiesExpr})`}
      authorize={(s) => {
        registeredSparkAuthenticateDynamicRequest?.(s);
        // The host derives this signed metadata; every frame request still
        // rechecks the requester's current Spark and capability authorization.
        s.return(
          canRenderSparkCard(
            sql`try_cast(dynamic_node.meta->>'owner_id' as bigint)`,
            sql`coalesce(dynamic_node.meta->'capabilities', '[]'::json)`,
          ),
        );
      }}
      onInternalEvent={(s) => {
        registeredSparkOnCardEvent?.(s);
        // Surface child-card events on the timeline so they are auditable and
        // visible to the agent. `event.*` here is the dynamic internal event
        // from the card, not a timeline row. The reserved spark.request event
        // represents an explicit user click and starts a normal agent turn;
        // capability actions still become host-owned approval proposals.
        s.defScalar("spark_ui_event_name", sql`event.name`);
        s.defScalar(
          "spark_ui_event_payload",
          sql`coalesce(event.payload_json::string, '')`,
        );
        s.defScalar(
          "spark_ui_event_payload_json",
          sql`coalesce(
            try_cast(spark_ui_event_payload as json),
            json_build_object()
          )`,
        );
        s.tryServer({
          body: (s) => {
            s.startTransaction();
            s.if(
              sql`spark_ui_event_name = 'spark.request'`,
              (s) => {
                s.defScalar(
                  "spark_ui_request_message",
                  sql`spark_ui_event_payload_json->>'message'`,
                );
                s.if(sql`spark_ui_request_message is null`, (s) => {
                  s.throwError(
                    sql.lit`This card action needs a request message.`,
                  );
                });
                s.if(
                  sql`not exists (
                    select 1 from db.spark_conversations c
                    where c.id = active_conversation_id
                      and c.sys_user_id = current_user
                  )`,
                  (s) => {
                    s.throwError(
                      sql.lit`The conversation owner can use this card action.`,
                    );
                  },
                );
                s.defScalar(
                  "spark_ui_request_agent_id",
                  sql`(select id from db.spark_agents
                    where spark_conversation_id = active_conversation_id
                      and status not in ('completed', 'failed')
                    limit 1)`,
                );
                s.if(sql`spark_ui_request_agent_id is null`, (s) => {
                  s.modify(sql`insert into db.spark_agents
                    (spark_conversation_id, status)
                    values (active_conversation_id, 'awaiting_plan')
                    returning id into spark_ui_request_agent_id`);
                });
                s.modify(sql`
                  insert into db.spark_agent_events
                    (spark_agent_id, type, content, payload, created_at)
                  values (
                    spark_ui_request_agent_id,
                    'user_message',
                    spark_ui_request_message,
                    json_build_object(
                      'action', 'ui_request',
                      'name', spark_ui_event_name,
                      'payload', spark_ui_event_payload_json
                    ),
                    now()
                  )`);
                s.modify(sql`
                  update db.spark_conversations
                  set last_message_at = now(), is_paused = false
                  where id = active_conversation_id`);
                s.modify(sql`
                  update db.spark_agents
                  set status = 'awaiting_plan', retry_count = 0,
                      retry_at = null::timestamp
                  where id = spark_ui_request_agent_id
                    and status in ('completed', 'waiting_on_questions',
                      'waiting_on_approval')`);
              },
              (s) => {
                s.defScalar(
                  "spark_ui_event_agent_id",
                  sql`(select id from db.spark_agents
                    where spark_conversation_id = active_conversation_id
                    order by id desc limit 1)`,
                );
                s.modify(sql`
                  insert into db.spark_agent_events
                    (spark_agent_id, type, content, payload, created_at)
                  values (
                    spark_ui_event_agent_id,
                    'blocker_resolved',
                    'UI event: ' || spark_ui_event_name,
                    json_build_object('action', 'ui_event',
                      'name', spark_ui_event_name,
                      'payload', spark_ui_event_payload_json),
                    now()
                  )`);
              },
            );
            s.commitTransaction();
            // The mounted timeline <Listen> sees the new event row and
            // refetches the conversation tree.
          },
        });
      }}
    />
  );
}

/** One compact native-tool activity row. `event.*` is the timeline row. */
function SparkDataActivityTurn() {
  return (
    <div sx={styles.activityRow}>
      <MaterialIcon icon="Search" fontSize="sm" color="neutral" />
      <Typography level="body-sm" sx={{ color: "neutral" }}>
        {sql`case
          when coalesce(event.payload->>'status', '') = 'error'
            then 'Analysis failed'
          else 'Analyzed data'
        end`}
      </Typography>
    </div>
  );
}

function SparkWorkSummary() {
  return (
    <button
      type="button"
      sx={styles.workSummary}
      aria-expanded={sql`case
        when timeline_expanded_activity_turn = event.turn_number then 'true'
        else 'false'
      end`}
      onClick={(s) => {
        s.setScalar(
          "timeline_expanded_activity_turn",
          sql`case
            when timeline_expanded_activity_turn = event.turn_number then null
            else event.turn_number
          end`,
        );
        s.refetch();
      }}
    >
      <span>
        {sql`case when coalesce(event.work_duration_seconds, 0) < 1 then case when event.turn_failed or event.payload->>'state' = 'failed' then 'Work failed' else 'Activity' end else case when event.turn_failed or event.payload->>'state' = 'failed' then 'Failed after ' else 'Worked for ' end || case
          when event.work_duration_seconds < 60
            then event.work_duration_seconds::string || 's'
          else (event.work_duration_seconds / 60)::string || 'm ' ||
            (event.work_duration_seconds % 60)::string || 's'
        end end`}
      </span>
      <Show
        when={sql`timeline_expanded_activity_turn = event.turn_number`}
      >
        <MaterialIcon
          icon="ChevronRight"
          fontSize="sm"
          color="neutral"
          sx={{ transform: "rotate(90deg)" }}
        />
      </Show>
      <Show
        when={sql`timeline_expanded_activity_turn is distinct from event.turn_number`}
      >
        <MaterialIcon icon="ChevronRight" fontSize="sm" color="neutral" />
      </Show>
    </button>
  );
}

function EventAttachments() {
  return (
    <Data
      procedure={(s) => {
        s.defTable("event_attachments", {
          query: sql`select id as idx, name, mime_type, blob_hash,
                    coalesce(text_content, '') as body
                  from db.spark_attachments
                  where spark_event_id = event.source_event_id and expires_at > now()`,
        });
      }}
    >
      <Show when={sql`exists (select 1 from event_attachments)`}>
        <div sx={styles.userAttachmentRow}>
          <Each
            table="event_attachments"
            recordName="event_att"
            orderBy={sql`idx`}
          >
            <button
              type="button"
              aria-label={sql`'Open file ' || event_att.name`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1.5,
                width: 280,
                maxWidth: "100%",
                minWidth: 0,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 10,
                backgroundColor: "background-surface",
                color: "text-primary",
                textAlign: "left",
                cursor: "pointer",
                "&:hover": { backgroundColor: "background-level1" },
              }}
              onClick={(s) => {
                s.setScalar("requested_artifact_id", sql`event_att.idx`);
                s.setScalar("work_tab", sql.lit`artifacts`);
                s.setScalar("changes_panel_open", true);
              }}
            >
              <span
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 40,
                  flexShrink: 0,
                  borderRadius: 6,
                  backgroundColor: "background-level1",
                }}
              >
                <Show
                  when={sql`event_att.mime_type = 'application/pdf'`}
                  fallback={
                    <MaterialIcon icon="InsertDriveFile" fontSize="sm" />
                  }
                >
                  <MaterialIcon icon="PictureAsPdf" fontSize="sm" />
                </Show>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {sql`event_att.name`}
                </span>
                <span className="mt-1 block text-xs text-secondary">
                  {sql`case when event_att.mime_type = 'application/pdf' then 'PDF' when event_att.mime_type like 'image/%' then 'Image' when event_att.mime_type = 'text/markdown' then 'Markdown' else 'Document' end`}
                </span>
              </span>
              <MaterialIcon
                icon="ChevronRight"
                fontSize="sm"
                className="text-secondary"
              />
            </button>
          </Each>
        </div>
      </Show>
    </Data>
  );
}

function TimelineEventCard(props: { basePath?: string }) {
  const basePath = props.basePath;
  return (
    <>
      <Show when={sql`event.event_type = 'user_message'`}>
        <div sx={styles.messageUserWrap} data-spark-user-message="true">
          <EventAttachments />
          <Show when={sql`coalesce(trim(event.message_content), '') != ''`}>
            <Data
              local
              procedure={(s) => s.defScalar("user_message_expanded", false)}
            >
              <div sx={styles.messageUser}>
                <Typography level="body-md">
                  {sql`case
                    when length(coalesce(event.message_content, '')) > 640
                      and not user_message_expanded
                    then left(event.message_content, 640) || '…'
                    else event.message_content
                  end`}
                </Typography>
                <Show
                  when={sql`length(coalesce(event.message_content, '')) > 640`}
                >
                  <button
                    type="button"
                    sx={styles.messageExpand}
                    onClick={(s) =>
                      s.setScalar(
                        "user_message_expanded",
                        sql`not user_message_expanded`,
                      )}
                  >
                    {sql`case when user_message_expanded then 'Show less' else 'Show full prompt' end`}
                  </button>
                </Show>
              </div>
            </Data>
          </Show>
        </div>
      </Show>

      <Show when={sql`event.event_type = 'artifact_saved'`}>
        <EventAttachments />
      </Show>
      <Show when={sql`event.event_type = 'external_message'`}>
        <div className="my-4" data-external-message="true">
          <p className="mb-2 text-xs text-secondary">External message</p>
          <MarkdownDisplay
            content={sql`coalesce(event.message_content, '')`}
            sx={styles.markdownBody}
          />
        </div>
      </Show>

      <Show when={sql`event.event_type = 'assistant_message'`}>
        <div sx={styles.messageAssistant}>
          <MarkdownDisplay
            content={sql`coalesce(event.message_content, '')`}
            sx={styles.markdownBody}
          />
        </div>
      </Show>

      <Show when={sql`event.event_type = 'tool_activity'`}>
        <Show when={sql`event.payload->>'source' = 'mcp'`}>
          <EventAttachments />
        </Show>
        <Show
          when={sql`event.turn_is_terminal and event.is_first_activity
            and not event.is_external`}
        >
          <SparkWorkSummary />
        </Show>
        <Show
          when={sql`not event.is_external and (not event.turn_is_terminal
            or timeline_expanded_activity_turn = event.turn_number)`}
        >
          <Show
            when={sql`event.payload->>'action' = 'native_tools'`}
          >
            <SparkDataActivityTurn />
          </Show>
          <Show
            when={sql`coalesce(event.payload->>'action', '') not in
              ('native_tools')`}
          >
            <div sx={styles.activityRow}>
              <MaterialIcon icon="Bolt" fontSize="sm" />
              <Typography level="body-sm" sx={{ color: "neutral" }}>
                <span
                  dynamicClassNames={[{
                    condition: sql`not event.turn_is_terminal`,
                    classNames: "motion-safe:animate-pulse",
                  }]}
                >
                  {sql`event.message_content`}
                </span>
              </Typography>
            </div>
          </Show>
        </Show>
      </Show>

      {
        /* Agent-generated UI card. The TSX source the agent emitted is
          compiled and rendered through DynamicNode: table/field access is
          enforced at compile time by the registered whitelist, and the
          authorize proc gates every frame/data request. The card queries
          live data — pixels are never the approval object (the action
          batch is), so live rendering is always safe. */
      }
      <Show when={sql`event.event_type = 'card_displayed'`}>
        <div sx={styles.cardEvent}>
          <Card variant="outlined" sx={styles.dynamicCard}>
            {basePath !== undefined
              ? (
                <IconButton
                  size="sm"
                  variant="soft"
                  color="neutral"
                  sx={styles.cardExpandButton}
                  onClick={(s) => {
                    s.navigate(
                      sparkCardPath(
                        basePath,
                        sql`active_conversation_id`,
                        sql`event.source_event_id`,
                      ),
                    );
                  }}
                >
                  <MaterialIcon icon="OpenInFull" fontSize="sm" />
                </IconButton>
              )
              : null}
            <SparkCardNode
              sourceExpr={sql`event.payload->>'source'`}
              metaEventIdExpr={sql`event.source_event_id`}
              ownerIdExpr={sql`active_conv_owner_id`}
              capabilitiesExpr={sql`active_conv_capabilities`}
            />
          </Card>
        </div>
      </Show>

      <Show when={sql`event.event_type = 'action_proposed'`}>
        <Data
          procedure={(s) =>
            s.defRecord(
              "proposal_activity",
              sql`select action_name, status from db.spark_action_log where id = event.action_id and spark_conversation_id = active_conversation_id`,
            )}
        >
          <Show when={sql`proposal_activity.status = 'proposed'`}>
            <div className="my-2 rounded-lg border border-divider p-3 text-sm">
              <span className="font-semibold">Needs approval ·</span>
              {actionActivityTitle(sql`proposal_activity.action_name`)}
            </div>
          </Show>
        </Data>
      </Show>

      <Show
        when={sql`event.event_type in ('action_executed', 'action_undone') and event.is_external`}
      >
        {registeredMcpOptions
          ? <ExternalActionRow renderers={registeredResultRenderers} />
          : null}
      </Show>
      <Show
        when={sql`event.event_type = 'action_executed' and not event.is_external`}
      >
        <Data
          watch={[sql`refresh_key`]}
          procedure={(s) => {
            s.defRecord(
              "action_receipt",
              sql`select id, action_name, execution_event_id, result_json,
                  cast(status as string) as status
                from db.spark_action_log
                where id = event.action_id`,
            );
            s.defRecord(
              "action_receipt_batch",
              sql`select min(action.id) as head_id,
                  count(*) as action_count,
                  coalesce(sum(try_cast(
                    action.result_json->>'inserted_count' as bigint)), 0)
                    as inserted_count,
                  coalesce(sum(try_cast(
                    action.result_json->>'updated_count' as bigint)), 0)
                    as updated_count,
                  coalesce(sum(try_cast(
                    action.result_json->>'deleted_count' as bigint)), 0)
                    as deleted_count
                from db.spark_action_log action
                where action.spark_conversation_id = active_conversation_id
                  and action.status = 'executed'
                  and action.execution_event_id = action_receipt.execution_event_id
              `,
            );
            s.defScalar(
              "action_still_undoable",
              registeredUndoActionCondition(sql`action_receipt.action_name`),
            );
            s.defScalar(
              "action_is_reversible",
              registeredReversibleActionCondition(
                sql`action_receipt.action_name`,
              ),
            );
            s.defScalar(
              "action_agent_busy",
              sql`exists (
                select 1 from db.spark_agents agent
                where agent.spark_conversation_id = active_conversation_id
                  and agent.status in (
                    'awaiting_plan', 'awaiting_execute', 'executing',
                    'failed_retrying_plan'
                  )
              )`,
            );
            s.defScalar(
              "action_receipt_summary",
              sql`nullif(concat_ws(', ',
                case when action_receipt_batch.inserted_count > 0 then
                  action_receipt_batch.inserted_count::string || ' created' end,
                case when action_receipt_batch.updated_count > 0 then
                  action_receipt_batch.updated_count::string || ' updated' end,
                case when action_receipt_batch.deleted_count > 0 then
                  action_receipt_batch.deleted_count::string || ' deleted' end
              ), '')`,
            );
          }}
        >
          <Show
            when={sql`action_receipt.status = 'executed'
              and action_receipt.id = action_receipt_batch.head_id`}
          >
            <div className="my-3 flex flex-wrap items-center gap-2 rounded-lg border border-divider p-3 text-sm">
              <MaterialIcon
                icon="CheckCircle"
                fontSize="sm"
                color="success"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {sql`case when action_receipt_batch.action_count > 1 then action_receipt_batch.action_count::string || ' actions completed' else ${
                    actionActivityTitle(sql`action_receipt.action_name`)
                  } end`}
                </p>
                <p className="text-secondary">
                  {sql`case when action_receipt_batch.action_count > 1 then 'View the affected items and recorded results' else ${
                    actionActivitySubject(
                      sql`action_receipt.result_json`,
                      sql`action_receipt.action_name`,
                    )
                  } end`}
                </p>
              </div>
              <Button
                variant="plain"
                size="sm"
                onClick={(s) => {
                  s.setScalar(
                    "changes_execution_id",
                    sql`action_receipt.execution_event_id`,
                  );
                  s.setScalar("requested_artifact_id", sql`null`);
                  s.setScalar("work_tab", sql.lit`changes`);
                  s.setScalar("changes_panel_open", true);
                }}
              >
                View changes
              </Button>
              {registeredMcpOptions
                ? (
                  <Show when={sql`action_receipt_batch.action_count = 1`}>
                    <details className="w-full text-sm">
                      <summary className="cursor-pointer text-secondary">
                        Details
                      </summary>
                      <SparkActionResult
                        renderers={registeredResultRenderers}
                        actionName={sql`action_receipt.action_name`}
                        result={sql`action_receipt.result_json`}
                        status={sql`action_receipt.status`}
                      />
                    </details>
                  </Show>
                )
                : null}
              <Show when={sql`action_receipt_summary is not null`}>
                <span sx={styles.actionPillName}>
                  {sql`'· ' || action_receipt_summary`}
                </span>
              </Show>
              <Show
                when={sql`action_still_undoable and active_conv_is_owner
                  and not action_agent_busy`}
              >
                <ActionButton
                  variant="plain"
                  color="neutral"
                  size="sm"
                  startIcon="Undo"
                  sx={{ ml: "auto" }}
                  action={(s) => {
                    s.if(
                      sql`action_is_reversible`,
                      (s) => {
                        s.defRecord(
                          "undo_action",
                          sql`select action.spark_conversation_id,
                                  action.execution_event_id
                                from db.spark_action_log action
                                join db.spark_conversations conversation
                                  on conversation.id = action.spark_conversation_id
                                where action.id = event.action_id
                                  and action.status = 'executed'
                                  and conversation.sys_user_id = current_user`,
                        );
                        s.if(
                          sql`undo_action.execution_event_id is null`,
                          (s) => {
                            s.throwError(
                              sql
                                .lit`These Spark changes are no longer available to undo.`,
                            );
                          },
                        );
                        undoSparkActionBatch(s, {
                          conversationId:
                            sql`undo_action.spark_conversation_id`,
                          executionEventId: sql`undo_action.execution_event_id`,
                          actionId: sql`event.action_id`,
                          actionFilter: registeredReversibleActionCondition(
                            sql`action_name`,
                          ),
                        });
                      },
                    ).else((s) => {
                      s.startTransaction();
                      s.modify(
                        sql`update db.spark_action_log
                              set status = 'undo_requested'
                              where id = event.action_id
                                and status = 'executed'
                                and spark_conversation_id in (
                                  select id from db.spark_conversations
                                  where sys_user_id = current_user)`,
                      );
                      s.commitTransaction();
                    });
                  }}
                >
                  Undo
                </ActionButton>
              </Show>
            </div>
          </Show>
        </Data>
      </Show>

      <Show
        when={sql`event.event_type = 'action_undone' and not event.is_external`}
      >
        <div sx={styles.actionPillMuted}>
          <MaterialIcon icon="Undo" fontSize="sm" color="neutral" />
          <span sx={styles.actionPillLabel}>Undone</span>
          <span sx={styles.actionPillName}>
            {sql`replace(event.message_content, 'Undone: ', '')`}
          </span>
        </div>
      </Show>

      <Show
        when={sql`event.event_type = 'action_cancelled' and not event.is_external`}
      >
        <div sx={styles.actionPillMuted}>
          <MaterialIcon icon="Cancel" fontSize="sm" color="neutral" />
          <span sx={styles.actionPillLabel}>Cancelled</span>
          <span sx={styles.actionPillName}>
            {sql`replace(event.message_content, 'Cancelled: ', '')`}
          </span>
        </div>
      </Show>

      <Show when={sql`event.event_type = 'question_created'`}>
        <div sx={styles.cardEvent}>
          <Card variant="outlined" sx={styles.questionCard}>
            <div className="flex items-center gap-2 mb-1">
              <MaterialIcon
                icon="HelpOutline"
                fontSize="sm"
                color="neutral"
              />
              <Typography level="title-sm">Questions</Typography>
            </div>
            <Typography level="body-sm">
              {sql`event.message_content`}
            </Typography>
          </Card>
        </div>
      </Show>

      <Show when={sql`event.event_type = 'error_occurred'`}>
        <div sx={styles.errorRow}>
          <MaterialIcon icon="ErrorOutline" fontSize="sm" />
          <Typography level="body-sm" sx={styles.errorText}>
            {sql`event.message_content`}
          </Typography>
        </div>
      </Show>
    </>
  );
}

function SparkAiControlMenu() {
  const updateConversationField = (
    s: import("std/statements").DomStatements,
    assignment: Sql,
  ) => {
    s.if(sql`active_conversation_id is not null`, (s) => {
      s.tryServer({
        body: (s) => {
          s.startTransaction();
          s.modify(sql`update db.spark_conversations set ${assignment}
            where id = active_conversation_id and sys_user_id = current_user`);
          s.commitTransaction();
        },
      });
      s.refetch();
    });
  };
  return (
    <Data
      watch={[sql`refresh_key`, sql`active_conversation_id`]}
      procedure={(s) => {
        s.defRecord(
          "ai_conv",
          sql`select reasoning_effort, model
          from db.spark_conversations where id = active_conversation_id`,
        );
        s.defScalar(
          "selected_reasoning_effort",
          sql`coalesce(ai_conv.reasoning_effort::text, pending_reasoning_effort)`,
        );
        s.defScalar(
          "selected_model",
          agentModelExpr(
            sql`case when active_conversation_id is null then pending_model else ai_conv.model end`,
          ),
        );
        s.setScalar(
          "selected_reasoning_effort",
          agentReasoningEffortExpr(
            sql`selected_model`,
            sql`selected_reasoning_effort`,
          ),
        );
      }}
    >
      <AgentControls
        effort={sql`selected_reasoning_effort`}
        model={sql`selected_model`}
        onEffortChange={(s, effort) => {
          s.setScalar("selected_reasoning_effort", effort);
          s.setScalar(
            "pending_reasoning_effort",
            sql`selected_reasoning_effort`,
          );
          updateConversationField(
            s,
            sql`reasoning_effort = selected_reasoning_effort::enums.spark_ai_reasoning_effort`,
          );
        }}
        onModelChange={(s, model) => {
          s.setScalar("selected_model", agentModelExpr(model));
          s.setScalar("pending_model", sql`selected_model`);
          s.setScalar(
            "selected_reasoning_effort",
            agentReasoningEffortExpr(
              sql`selected_model`,
              sql`selected_reasoning_effort`,
            ),
          );
          s.setScalar(
            "pending_reasoning_effort",
            sql`selected_reasoning_effort`,
          );
          updateConversationField(
            s,
            sql`model = selected_model, reasoning_effort = selected_reasoning_effort::enums.spark_ai_reasoning_effort`,
          );
        }}
      />
    </Data>
  );
}

function ConversationTimeline(
  props: { basePath?: string },
) {
  const saveTitle = (s: import("std/statements").DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(
          sql`update db.spark_conversations
            set
              label = nullif(trim(title_draft), ''),
              auto_title_pending = false
            where id = active_conversation_id
              and sys_user_id = current_user`,
        );
        s.commitTransaction();
      },
    });
    s.setScalar("editing_title", false);
    s.refetch();
  };
  const cancelTitle = (s: import("std/statements").DomStatements) => {
    s.setScalar("editing_title", false);
  };
  return (
    <Show when={sql`active_conversation_id is not null`}>
      <Listen
        query={sql`select 'timeline' as kind,
          coalesce(max(id), 0) as id,
          count(*)::string as state
          from db.spark_timeline
          where spark_conversation_id = active_conversation_id
        union all
        select 'agent', id, status::string || ':' || retry_count::string
          from db.spark_agents
          where spark_conversation_id = active_conversation_id
        union all
        select 'action', id, status::string
          from db.spark_action_log
          where spark_conversation_id = active_conversation_id
        union all
        select 'conversation', id,
          coalesce(label, '') || ':' || is_paused::string
          from db.spark_conversations
          where id = active_conversation_id`}
        onChange={(s) => s.increment("refresh_key")}
      />
      <div sx={styles.mainHeader}>
        <div sx={styles.mainHeaderLeft}>
          <Data
            watch={[sql`refresh_key`]}
            procedure={(s) => {
              s.defScalar(
                "header_label",
                sql`(select coalesce(nullif(label, ''), 'New conversation')
                     from db.spark_conversations
                     where id = active_conversation_id)`,
              );
              s.defScalar(
                "raw_label",
                sql`coalesce((select label from db.spark_conversations
                     where id = active_conversation_id), '')`,
              );
            }}
          >
            <DocumentTitle includeAppName={false}>
              {sql`coalesce(header_label, 'New conversation')`}
            </DocumentTitle>
            <div sx={styles.mainHeaderTitle}>
              <Show
                when={sql`editing_title`}
                fallback={
                  <>
                    <span sx={styles.mainHeaderTitleText}>
                      {sql`coalesce(header_label, 'Conversation')`}
                    </span>
                    <Show
                      when={sql`active_conv_is_owner and active_conv_is_shared`}
                    >
                      <Chip
                        size="sm"
                        variant="soft"
                        color="primary"
                        startDecorator={
                          <MaterialIcon icon="Share" fontSize="sm" />
                        }
                      >
                        Shared
                      </Chip>
                    </Show>
                    <Show when={sql`not active_conv_is_owner`}>
                      <Chip
                        size="sm"
                        variant="soft"
                        color="neutral"
                        startDecorator={
                          <MaterialIcon icon="Visibility" fontSize="sm" />
                        }
                      >
                        {sql`'Shared with you · ' || active_conv_access_label`}
                      </Chip>
                    </Show>
                    <Show when={sql`active_conv_is_owner`}>
                      <IconButton
                        icon="Edit"
                        variant="plain"
                        color="neutral"
                        size="sm"
                        aria-label="Rename conversation"
                        sx={{
                          color: cssVar("palette-text-tertiary"),
                          "& svg": { fontSize: "1rem" },
                        }}
                        onClick={(s) => {
                          s.setScalar("title_draft", sql`raw_label`);
                          s.setScalar("editing_title", true);
                        }}
                      />
                    </Show>
                  </>
                }
              >
                <Input
                  size="sm"
                  value={sql`title_draft`}
                  onInput={(s) => s.setScalar("title_draft", sql`target_value`)}
                  sx={{ maxWidth: 360 }}
                  onKeyDown={(s) => {
                    s.if(sql`event.key = 'Enter'`, (s) => {
                      s.event.preventDefault();
                      saveTitle(s);
                    });
                    s.if(sql`event.key = 'Escape'`, (s) => {
                      s.event.preventDefault();
                      cancelTitle(s);
                    });
                  }}
                />
                <IconButton
                  icon="Check"
                  variant="plain"
                  color="success"
                  size="sm"
                  aria-label="Save name"
                  onClick={(s) => saveTitle(s)}
                />
                <IconButton
                  icon="Close"
                  variant="plain"
                  color="neutral"
                  size="sm"
                  aria-label="Cancel rename"
                  onClick={(s) => cancelTitle(s)}
                />
              </Show>
            </div>
          </Data>
        </div>
        <div sx={styles.mainHeaderRight}>
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            onClick={(s) => {
              s.setScalar("changes_execution_id", sql`null`);
              s.setScalar("requested_artifact_id", sql`null`);
              s.setScalar("work_tab", sql.lit`changes`);
              s.setScalar("changes_panel_open", true);
            }}
          >
            Changes
          </Button>
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            onClick={(s) => {
              s.setScalar("requested_artifact_id", sql`null`);
              s.setScalar("work_tab", sql.lit`artifacts`);
              s.setScalar("changes_execution_id", sql`null`);
              s.setScalar("changes_panel_open", true);
            }}
          >
            Artifacts
          </Button>
          <IconButton
            icon="Search"
            variant="plain"
            color="neutral"
            size="sm"
            aria-label="Search conversation"
            onClick={(s) => s.setScalar("timeline_search_open", true)}
          />
          <Show when={sql`active_conv_is_owner`}>
            <Menu>
              <Menu.IconButton
                icon="MoreVert"
                variant="plain"
                color="neutral"
                size="sm"
                aria-label="Conversation options"
              />
              <Menu.Content>
                <Menu.Item
                  onClick={(s) => {
                    s.setScalar("share_dialog_open", true);
                  }}
                >
                  <MaterialIcon icon="Share" />
                  Share
                </Menu.Item>
                <Menu.Item
                  onClick={(s) => {
                    s.setScalar("archive_dialog_open", true);
                  }}
                >
                  <MaterialIcon icon="Archive" />
                  Archive
                </Menu.Item>
              </Menu.Content>
            </Menu>
          </Show>
        </div>
      </div>
      {registeredMcpOptions
        ? (
          <SparkChangesPanel
            options={registeredMcpOptions}
            resultRenderers={registeredResultRenderers}
            basePath={props.basePath}
          />
        )
        : null}
      <VirtualizedChatTimeline
        sourceQuery={sql`select id, case when payload->>'source' = 'mcp' and event_type = 'tool_activity' then 'user_message' else event_type::text end as event_type,
            message_content, created_at as occurred_at
          from db.spark_timeline
          where spark_conversation_id = active_conversation_id`}
        procedure={(s) => {
          s.defScalar(
            "timeline_window_start_created_at",
            sql`(select created_at from db.spark_agent_events
              where id = timeline_window_start_event_id / 10)`,
          );
          s.defScalar(
            "timeline_window_after_created_at",
            sql`(select created_at from db.spark_agent_events
              where id = timeline_window_after_event_id / 10)`,
          );
          s.defTable(
            "events",
            sql`with window_events as (
                select id, source_event_id, event_type, message_content,
                  payload, action_id, agent_id, created_at, is_external,
                  timeline_window_start_turn - 1 +
                    sum(case when (event_type = 'user_message' or (event_type = 'tool_activity' and payload->>'source' = 'mcp'))
                    then 1 else 0 end)
                    over (order by created_at, id
                      rows between unbounded preceding and current row)
                    as turn_number
                from db.spark_timeline
                where spark_conversation_id = active_conversation_id
                  and (timeline_window_start_event_id is null
                    or created_at > timeline_window_start_created_at
                    or (created_at = timeline_window_start_created_at
                      and id >= timeline_window_start_event_id))
                  and (timeline_window_after_event_id is null
                    or created_at < timeline_window_after_created_at
                    or (created_at = timeline_window_after_created_at
                      and id < timeline_window_after_event_id))
              ), turn_rows as (
                select *,
                  sum(case when event_type = 'tool_activity'
                    then 1 else 0 end) over (
                      partition by turn_number order by created_at, id
                      rows between unbounded preceding and current row)
                    as activity_position,
                  sum(case when event_type = 'assistant_message'
                    then 1 else 0 end) over (
                      partition by turn_number order by created_at desc, id desc
                      rows between unbounded preceding and current row)
                    as assistant_rank,
                  max(agent_id) over (partition by turn_number)
                    as turn_agent_id,
                  max(case when (event_type = 'user_message' or (event_type = 'tool_activity' and payload->>'source' = 'mcp'))
                    then created_at end) over (partition by turn_number)
                    as turn_started_at,
                  max(case when (event_type = 'user_message' or (event_type = 'tool_activity' and payload->>'source' = 'mcp'))
                    then id end) over (partition by turn_number)
                    as turn_start_event_id,
                  max(created_at) over (partition by turn_number)
                    as turn_last_event_at
                from window_events
              ), ranked as (
                select turn_rows.*,
                  coalesce(turn_rows.turn_number < timeline_total_turns
                    or turn_agent.status in ('completed', 'failed'), false)
                    as turn_is_terminal,
                  coalesce(turn_rows.turn_number < timeline_total_turns
                    or turn_agent.status = 'completed', false)
                    as turn_is_complete,
                  coalesce(turn_rows.turn_number = timeline_total_turns
                    and turn_agent.status = 'failed', false)
                    as turn_failed,
                  case when turn_rows.turn_number < timeline_total_turns
                    then turn_rows.turn_last_event_at
                    else turn_agent.completed_at end as turn_completed_at
                from turn_rows
                left join db.spark_agents turn_agent
                  on turn_agent.id = turn_rows.turn_agent_id
              )
              select id, source_event_id, event_type, message_content,
                payload, action_id, agent_id, created_at, is_external,
                coalesce(timeline_window_end_event_id::string, 'tail')
                  as window_token,
                turn_number,
                event_type = 'tool_activity' and activity_position = 1
                  as is_first_activity,
                turn_is_terminal, turn_is_complete, turn_failed,
                greatest(0, date.diff(
                  'second', turn_started_at, turn_completed_at
                )) as work_duration_seconds
              from ranked
              where (event_type != 'tool_activity'
                  and (event_type != 'assistant_message'
                    or not turn_is_complete
                    or assistant_rank = 1
                    or timeline_expanded_activity_turn = turn_number))
                or (event_type = 'tool_activity' and (
                  timeline_expanded_activity_turn = turn_number
                  or (turn_is_terminal and activity_position = 1)
                  or not turn_is_terminal
                ))
              order by created_at, id`,
          );
        }}
        eventsTable="events"
        watch={[sql`refresh_key`]}
        scrollContainerId="spark-timeline-scroll"
        eventIdPrefix="spark-timeline-event-"
        searchInputId="spark-timeline-search"
        anchorTallEventStart={sql`event.event_type = 'assistant_message'`}
        showSearchButton={false}
        enableCodeCopy={false}
        scrollSx={styles.timelineScroll}
        eventsSx={styles.timeline}
        jumpLatestSx={{ bottom: 112 }}
        afterEvents={
          <>
            <ThinkingIndicator />
            <Show when={sql`active_conv_is_owner`}>
              <div sx={styles.pendingPanelsWrap}>
                <PendingPanels />
              </div>
            </Show>
          </>
        }
      >
        <TimelineEventCard basePath={props.basePath} />
      </VirtualizedChatTimeline>
      <div sx={styles.composerWrap}>
        <Show when={sql`active_conv_is_owner`}>
          <Data
            procedure={(s) =>
              s.defScalar(
                "composer_external_session",
                sql`exists(select 1 from db.spark_conversations where id = active_conversation_id and source = 'mcp')`,
              )}
          >
            <Show when={sql`not composer_external_session`}>
              <MessageComposerInner basePath={props.basePath} />
            </Show>
          </Data>
        </Show>
        <Show when={sql`not active_conv_is_owner`}>
          <Typography
            level="body-sm"
            sx={{
              textAlign: "center",
              py: 2,
              color: cssVar("palette-text-tertiary"),
            }}
          >
            Shared with you — read-only. Only the owner can send messages.
          </Typography>
        </Show>
      </div>
    </Show>
  );
}

function ThinkingIndicator() {
  const isVisible = sql`not conv_is_paused and agent_working_status in
    ('awaiting_plan', 'awaiting_execute', 'executing', 'failed_retrying_plan')`;
  return (
    <Data
      watch={[sql`refresh_key`]}
      procedure={(s) => {
        s.defScalar(
          "agent_working_status",
          sql`(select status from db.spark_agents
                where spark_conversation_id = active_conversation_id
                order by id desc limit 1)`,
        );
        s.defScalar(
          "conv_is_paused",
          sql`coalesce(
            (select is_paused from db.spark_conversations
              where id = active_conversation_id), false)`,
        );
        s.defScalar("current_phase", sql.lit("Thinking…"));
        s.if(isVisible, (s) => {
          // Hidden indicators need no timeline statistics.
          // Count tool steps without exposing workflow-specific details.
          s.defRecord(
            "last_user_msg",
            sql`select id, created_at
            from db.spark_timeline
            where spark_conversation_id = active_conversation_id
              and event_type = 'user_message'
            order by created_at desc, id desc
            limit 1`,
          );
          s.defScalar(
            "tool_steps_this_turn",
            sql`(select count(*) from db.spark_timeline
                where spark_conversation_id = active_conversation_id
                  and event_type = 'tool_activity'
                  and payload->>'action' = 'native_tools'
                  and (
                    created_at > last_user_msg.created_at
                    or (created_at = last_user_msg.created_at
                      and id > last_user_msg.id)
                  ))`,
          );
          s.setScalar(
            "current_phase",
            sql`case
            when tool_steps_this_turn > 0 then 'Working with project data…'
            else 'Thinking…'
          end`,
          );
        });
      }}
    >
      <Show when={isVisible}>
        <div sx={styles.thinkingLive} aria-live="polite">
          <div sx={styles.thinkingRow}>
            <MaterialIcon icon="Search" fontSize="sm" color="neutral" />
            <span
              sx={styles.thinkingLabel}
              className="motion-safe:animate-pulse"
            >
              {sql`current_phase`}
            </span>
          </div>
        </div>
      </Show>
    </Data>
  );
}

function EmptyConversationState(props: { basePath?: string }) {
  return (
    <Show when={sql`active_conversation_id is null`}>
      <div
        sx={styles.emptyState}
        style={{
          "padding-bottom": sql`case when composer_expanded
            then '0' else '24vh' end`,
        }}
      >
        <Show when={sql`not composer_expanded`}>
          <div sx={styles.emptyStateCopy}>
            <Typography
              level="h3"
              sx={{ color: "text.primary", fontWeight: 400 }}
            >
              What can I help with?
            </Typography>
          </div>
        </Show>
        <div sx={styles.emptyStateComposer}>
          <Data
            procedure={(s) =>
              s.defScalar(
                "composer_external_session",
                sql`exists(select 1 from db.spark_conversations where id = active_conversation_id and source = 'mcp')`,
              )}
          >
            <Show when={sql`not composer_external_session`}>
              <MessageComposerInner basePath={props.basePath} />
            </Show>
          </Data>
        </div>
      </div>
    </Show>
  );
}

function PendingPanels() {
  return (
    <Data
      watch={[sql`refresh_key`]}
      procedure={(s) => {
        s.defScalar(
          "has_pending_actions",
          sql`(select exists (
            select 1 from db.spark_action_log
            where spark_conversation_id = active_conversation_id
              and status = 'proposed'
          ))`,
        );
        s.defScalar(
          "has_pending_questions",
          sql`(select exists (
            select 1 from db.spark_agents
            where spark_conversation_id = active_conversation_id
              and status = 'waiting_on_questions'
          ))`,
        );
        s.defTable(
          "pending_actions",
          // Window-function `partition by` on string columns is silently
          // unpartitioned in the current Yolm SQL implementation, so the
          // header-grouping math runs through correlated subqueries
          // instead. Each pending row carries:
          //   group_pos    — rank of this action within its action group
          //   group_size   — total actions in this group
          //   group_min_id — id of the first action in this group, used
          //                  as the cross-group sort key so groups stay
          //                  in the order the agent produced them
          sql`select a.id, a.action_name, a.danger, a.input_json,
            (select count(*) from db.spark_action_log b
              where b.spark_conversation_id = active_conversation_id
                and b.status = 'proposed'
                and b.action_name = a.action_name
                and b.id <= a.id) as group_pos,
            (select count(*) from db.spark_action_log b
              where b.spark_conversation_id = active_conversation_id
                and b.status = 'proposed'
                and b.action_name = a.action_name) as group_size,
            (select min(b.id) from db.spark_action_log b
              where b.spark_conversation_id = active_conversation_id
                and b.status = 'proposed'
                and b.action_name = a.action_name) as group_min_id
            from db.spark_action_log a
            where a.spark_conversation_id = active_conversation_id
              and a.status = 'proposed'
            order by group_min_id asc, a.id asc`,
        );
      }}
    >
      <Show when={sql`has_pending_actions`}>
        <Card variant="outlined" sx={styles.pendingPanel}>
          <div sx={styles.pendingPanelHeader}>
            <div sx={styles.pendingPanelTitle}>
              <MaterialIcon icon="PendingActions" fontSize="sm" />
              <span>Pending actions</span>
              <span sx={styles.pendingPanelCount}>
                {sql`(select count(*) from pending_actions)::string`}
              </span>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outlined"
                color="neutral"
                size="sm"
                onClick={(s) => {
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      s.defScalar(
                        "cancel_action_agent_id",
                        sql`(select ba.id from db.spark_agents ba
                          where ba.spark_conversation_id = active_conversation_id
                            and ba.status = 'waiting_on_approval'
                          limit 1)`,
                      );
                      s.modify(
                        sql`update db.spark_action_log
                          set status = 'cancelled'
                          where spark_conversation_id = active_conversation_id
                            and status = 'proposed'
                            and exists(select 1 from ui.pending_actions displayed where displayed.id = db.spark_action_log.id and displayed.input_json = db.spark_action_log.input_json)
                            and exists(select 1 from db.spark_conversations c
                              where c.id = active_conversation_id
                                and c.sys_user_id = current_user)`,
                      );
                      s.if(sql`cancel_action_agent_id is not null`, (s) => {
                        s.modify(
                          sql`insert into db.spark_agent_events
                            (spark_agent_id, type, content, created_at)
                            values (cancel_action_agent_id,
                              'action_cancelled', 'Actions cancelled', now()),
 (cancel_action_agent_id, 'blocker_resolved', 'Actions cancelled by user', now())`,
                        );
                        s.modify(
                          sql`update db.spark_agents
                            set status = 'awaiting_plan', retry_count = 0, retry_at = null::timestamp
                            where id = cancel_action_agent_id`,
                        );
                      });
                      s.commitTransaction();
                      s.refetch();
                    },
                  });
                  s.increment("refresh_key");
                }}
              >
                Cancel all
              </Button>
              <Button
                variant="solid"
                color="primary"
                size="sm"
                startIcon="Check"
                onClick={(s) => {
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      s.modify(
                        sql`update db.spark_action_log
                          set status = 'approved'
                          where spark_conversation_id = active_conversation_id
                            and status = 'proposed'
                            and exists(select 1 from ui.pending_actions displayed where displayed.id = db.spark_action_log.id and displayed.input_json = db.spark_action_log.input_json)
                            and exists(select 1 from db.spark_conversations c
                              where c.id = active_conversation_id
                                and c.sys_user_id = current_user)`,
                      );
                      s.commitTransaction();
                      s.refetch();
                    },
                  });
                  s.increment("refresh_key");
                }}
              >
                Approve all
              </Button>
            </div>
          </div>
          <div sx={styles.pendingActionList}>
            <Each table="pending_actions" recordName="action">
              {
                /* Group header: shown only on the first row of each
                  same-action streak. Strips the skill prefix and shows
                  count "Update product · 3" for repeated actions. */
              }
              <Show when={sql`action.group_pos = 1`}>
                {
                  /* Two flavors so we can swap background/foreground for
                    high-danger groups without dynamic sx (the Yolm style
                    typing doesn't accept Sql values inside an sx array). */
                }
                <Show
                  when={sql`action.danger = 'low' or action.danger is null`}
                >
                  <div sx={styles.pendingGroupHeader}>
                    <MaterialIcon
                      icon="Edit"
                      fontSize="sm"
                      sx={{ color: cssVar("palette-text-tertiary") }}
                    />
                    <span>
                      {
                        /* Strip the "skill_name." prefix, then turn the
                          action half into Title Case ("update_product"
                          → "Update product"). */
                      }
                      {sql`initcap(replace(
                            substr(action.action_name,
                              position('.' in action.action_name) + 1),
                            '_', ' '))`}
                    </span>
                    <Show when={sql`action.group_size > 1`}>
                      <span>
                        {sql`'· ' || cast(action.group_size as string)`}
                      </span>
                    </Show>
                  </div>
                </Show>
                <Show when={sql`action.danger in ('high', 'external')`}>
                  <div
                    sx={{
                      ...styles.pendingGroupHeader,
                      ...styles.pendingGroupHeaderDanger,
                    }}
                  >
                    <Show when={sql`action.danger = 'high'`}>
                      <MaterialIcon
                        icon="Warning"
                        fontSize="sm"
                        sx={{ color: cssVar("palette-warning-500") }}
                      />
                    </Show>
                    <Show when={sql`action.danger = 'external'`}>
                      <MaterialIcon
                        icon="Public"
                        fontSize="sm"
                        sx={{ color: cssVar("palette-warning-500") }}
                      />
                    </Show>
                    <span>
                      {sql`initcap(replace(
                            substr(action.action_name,
                              position('.' in action.action_name) + 1),
                            '_', ' '))`}
                    </span>
                    <Show when={sql`action.group_size > 1`}>
                      <span>
                        {sql`'· ' || cast(action.group_size as string)`}
                      </span>
                    </Show>
                  </div>
                </Show>
              </Show>
              <div sx={styles.pendingActionRow}>
                <div sx={styles.pendingActionMain}>
                  {
                    /* Per-action custom approval render — the registered
                      renderer reads live db state and the proposed
                      input_json to show the diff that will actually apply.
                      The agent cannot influence what the user sees here, so
                      it cannot misrepresent the effect of the action. */
                  }
                  {registeredActionRenderers.map((entry) => (
                    <Show
                      when={sql`action.action_name = ${
                        sql.lit(entry.qualifiedName)
                      }`}
                    >
                      {entry.render({ input: sql`action.input_json` })}
                    </Show>
                  ))}
                  {
                    /* Fallback for skills whose author hasn't written a
                      renderer yet — show a stripped JSON one-liner so the
                      user can at least eyeball the input. The action
                      should be given an approvalUi before going to
                      production. */
                  }
                  <Show
                    when={sql`action.input_json is not null
                      ${notRenderedActionCondition()}`}
                  >
                    <span sx={styles.pendingActionArgs}>
                      {sql`replace(replace(replace(
                            action.input_json::string,
                            '"', ''), '{', ''), '}', '')`}
                    </span>
                  </Show>
                </div>
                {
                  /* Per-row reject — flips just this action to cancelled.
                    The plan reactor picks up the agent again once no
                    proposed/approved actions remain in the conversation. */
                }
                <IconButton
                  aria-label="Reject this action"
                  icon="Close"
                  variant="plain"
                  color="neutral"
                  size="sm"
                  sx={styles.rejectButton}
                  onClick={(s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(
                          sql`update db.spark_action_log
                              set status = 'cancelled'
                              where id = action.id
                                and spark_conversation_id in (
                                  select id from db.spark_conversations
                                  where sys_user_id = current_user)`,
                        );
                        s.modify(
                          sql`insert into db.spark_agent_events
                              (spark_agent_id, type, content, action_id, created_at)
                            values (
                              (select event.spark_agent_id
                                from db.spark_action_log action_log
                                join db.spark_agent_events event
                                  on event.id = action_log.execution_event_id
                                where action_log.id = action.id),
                              'action_cancelled',
                              'Rejected: ' || (select action_name from db.spark_action_log where id = action.id),
                              action.id, now())`,
                        );
                        s.commitTransaction();
                        s.refetch();
                      },
                    });
                    s.increment("refresh_key");
                  }}
                />
              </div>
            </Each>
          </div>
        </Card>
      </Show>

      <Show when={sql`has_pending_questions`}>
        <Card variant="outlined" sx={styles.pendingQuestionPanel}>
          <Data
            procedure={(s) => {
              s.defRecord(
                "pending_question",
                sql`select event.id, event.content as prompt,
                    event.payload->'questions' as questions_json
                  from db.spark_agent_events event
                  join db.spark_agents agent
                    on agent.id = event.spark_agent_id
                  where agent.spark_conversation_id = active_conversation_id
                    and agent.status = 'waiting_on_questions'
                    and event.type = 'question_created'
                  order by event.id desc
                  limit 1`,
              );
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <MaterialIcon
                icon="HelpOutline"
                fontSize="sm"
                color="primary"
              />
              <Typography level="title-sm">
                {sql`pending_question.prompt`}
              </Typography>
            </div>
            <Show
              when={sql`pending_question.questions_json is not null
                and json_array_length(pending_question.questions_json) > 0`}
            >
              <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
                {sql`(select string_agg(
                  coalesce(q.value->>'question', q.value->>'header', ''),
                  chr(10)
                ) from json.array_each(pending_question.questions_json) q)`}
              </Typography>
            </Show>
            <Typography level="body-sm" sx={{ color: "neutral" }}>
              Please answer in the message input below.
            </Typography>
          </Data>
        </Card>
      </Show>
    </Data>
  );
}

function sendMessageProcedure(
  s: import("std/statements").UiServerStatements,
) {
  // Only the conversation's owner may post a message / run the agent. A viewer
  // of a shared or organization-visible conversation is strictly read-only —
  // otherwise they could run the agent under the OWNER's capabilities (e.g.
  // execute finance queries they cannot access themselves). New conversations
  // (active_conversation_id null) are created owned by current_user below.
  s.if(
    sql`active_conversation_id is not null and not exists(
      select 1 from db.spark_conversations
      where id = active_conversation_id and sys_user_id = current_user )`,
    (s) => s.return(),
  );
  s.startTransaction();
  s.if(sql`active_conversation_id is null`, (s) => {
    s.modify(
      sql`insert into db.spark_conversations
        (sys_user_id, status, is_paused, capabilities_json, label,
         auto_title_pending, reasoning_effort, model,
         context_json, last_message_at)
        values (current_user, 'active', false, ${chatCapabilitiesJsonExpr()},
          'New chat',
          true, pending_reasoning_effort::enums.spark_ai_reasoning_effort, pending_model,
          pending_conversation_context, now())
        returning id into active_conversation_id`,
    );
  });
  s.defTable("sent_attachments", {
    fields: [
      { name: "sort", type: "BigInt", notNull: true },
      { name: "name", type: { type: "String", maxLength: 500 }, notNull: true },
      { name: "mime", type: { type: "String", maxLength: 200 }, notNull: true },
      { name: "size", type: "BigInt", notNull: true },
      { name: "kind", type: { type: "String", maxLength: 20 }, notNull: true },
      { name: "body", type: { type: "String", maxLength: 50000 } },
      { name: "blob_hash_hex", type: { type: "String", maxLength: 64 } },
      { name: "attachment_id", type: "BigInt" },
    ],
  });
  s.modify(
    sql`insert into sent_attachments
        (sort, name, mime, size, kind, body, blob_hash_hex)
      select id, name, mime, size, kind, body, blob_hash_hex
      from ui.staged_attachments`,
  );
  s.modify(
    sql`update db.spark_conversations
      set last_message_at = now(), is_paused = false
      where id = active_conversation_id`,
  );
  // Find or create the conversation agent.
  s.defScalar(
    "main_agent_id",
    sql`(select id from db.spark_agents
      where spark_conversation_id = active_conversation_id
        and status not in ('completed', 'failed')
      limit 1)`,
  );
  s.if(sql`main_agent_id is null`, (s) => {
    s.modify(
      sql`insert into db.spark_agents
        (spark_conversation_id, status)
        values (active_conversation_id, 'awaiting_plan')
        returning id into main_agent_id`,
    );
  });
  s.defScalar("user_event_id", { type: "BigInt" });
  s.modify(
    sql`insert into db.spark_agent_events
      (spark_agent_id, type, content, created_at)
      values (main_agent_id, 'user_message', message_input, now())
      returning id into user_event_id`,
  );
  s.forEachQuery(
    sql`select sort, name, mime, size, kind, body, blob_hash_hex
      from sent_attachments order by sort`,
    "sent_attachment",
    (s) => {
      s.defScalar("sent_attachment_id", { type: "BigInt" });
      s.if(sql`sent_attachment.kind = 'text'`, (s) => {
        s.modify(sql`insert into db.spark_attachments
            (spark_event_id, name, mime_type, file_size, text_content)
          values (user_event_id, sent_attachment.name, sent_attachment.mime,
            sent_attachment.size, sent_attachment.body)
          returning id into sent_attachment_id`);
      }).else((s) => {
        s.modify(sql`insert into db.spark_attachments
            (spark_event_id, name, mime_type, file_size, blob_hash)
          values (user_event_id, sent_attachment.name, sent_attachment.mime,
            sent_attachment.size, bytes.from_hex(sent_attachment.blob_hash_hex))
          returning id into sent_attachment_id`);
      });
      s.modify(sql`update sent_attachments
        set attachment_id = sent_attachment_id
        where sort = sent_attachment.sort`);
      s.if(
        sql`sent_attachment.kind = 'image'
          and sent_attachment.mime like 'image/%'`,
        (s) =>
          s.modify(sql`insert into db.spark_agent_pending_images
              (spark_agent_id, spark_attachment_id, requested_at)
            values (main_agent_id, sent_attachment_id, now())`),
      );
    },
  );
  s.modify(
    sql`update db.spark_agent_events
      set payload = case when exists (select 1 from sent_attachments)
        then json_build_object('hasAttachments', true)
        else null::json end
      where id = user_event_id`,
  );
  s.modify(
    sql`update db.spark_agents
      set status = 'awaiting_plan', retry_count = 0, retry_at = null::timestamp
      where id = main_agent_id
        and status in ('completed', 'waiting_on_questions',
          'waiting_on_approval')`,
  );
  s.commitTransaction();
  s.refetch();
}

function MessageComposerInner(props: { basePath?: string }) {
  const basePath = props.basePath ?? "";
  // Attachments upload over HTTP to this app's /api prefix. Registered here
  // (render time) so every domain that mounts the composer gets the endpoint
  // without per-app wiring; a manual registerSparkAttachmentUploadApi() call
  // beforehand wins when the domain needs a custom session cookie name.
  const renderingApp = system.renderingApp;
  if (renderingApp) {
    registerSparkAttachmentUploadApi({
      domain: renderingApp.domain,
      domainAliases: renderingApp.domainAliases,
    });
  }
  useJsModule("http_file_upload");
  const uploadUid = useUniqueId();
  const uploadHandle = sql.concat(uploadUid, sql.lit`-spark-upload`);
  const composerDomId = sql.concat(sql.lit`spark-composer-`, uploadUid);
  // Stage every successfully uploaded file from the module's event payload
  // (`results[i].response` is the upload endpoint's JSON). Shared between the
  // filesUploaded and uploadError handlers — a partial failure still stages
  // the files that made it.
  const stageUploadedResults = (
    s: import("std/statements").DomStatements,
  ) => {
    s.defScalar(
      "staged_base_id",
      sql`coalesce((select max(id) from ui.staged_attachments), 0)`,
    );
    s.modify(sql`insert into ui.staged_attachments
        (id, name, mime, size, kind, body, blob_hash_hex)
      select staged_base_id + r.index + 1,
        r.value->'response'->>'name',
        r.value->'response'->>'mimeType',
        cast(r.value->'response'->>'size' as bigint),
        r.value->'response'->>'kind',
        coalesce(r.value->'response'->>'body', ''),
        coalesce(r.value->'response'->>'blobHashHex', '')
      from json.array_each(coalesce(event.payload_json->'results', '[]'::json)) r
      where r.value->>'ok' = 'true'
        and r.value->'response'->>'kind' is not null`);
  };
  const submit = (s: import("std/statements").DomStatements) => {
    s.if(
      sql`trim(message_input) != ''
        or exists (select 1 from ui.staged_attachments)`,
      (s) => {
        // sendMessageProcedure sets active_conversation_id (via `returning into`)
        // when it creates a fresh conversation. Capture whether this was a new
        // conversation so we can navigate to its route afterwards.
        s.defScalar(
          "was_new_conversation",
          sql`active_conversation_id is null`,
        );
        s.tryServer({ body: sendMessageProcedure });
        s.setScalar("message_input", sql.lit``);
        s.setScalar("attachment_upload_error", sql.lit``);
        resetVirtualizedChatTimeline(s, "spark-timeline-scroll");
        s.modify(sql`delete from ui.staged_attachments`);
        s.if(
          sql`was_new_conversation and active_conversation_id is not null`,
          (s) => {
            // New conversation: move to its URL so it is deep-linkable; the
            // detail route mounts the timeline fresh.
            s.navigate(sparkConvPath(basePath, sql`active_conversation_id`));
          },
        ).else((s) => {
          s.refetch();
        });
      },
    );
  };
  // Pause / resume the agent by toggling the conversation's is_paused flag —
  // the agent reactors all filter on `not is_paused`, so this stops/restarts
  // the run loop (matches studio's stop/play controls).
  const setPaused = (
    s: import("std/statements").DomStatements,
    paused: boolean,
  ) => {
    s.if(sql`active_conversation_id is not null`, (s) => {
      s.tryServer({
        body: (s) => {
          s.startTransaction();
          s.modify(
            sql`update db.spark_conversations
              set is_paused = ${paused ? sql`true` : sql`false`}
              where id = active_conversation_id
                and sys_user_id = current_user`,
          );
          if (!paused) {
            s.modify(sql`update db.spark_agents
              set status = 'failed_retrying_plan', retry_at = now()
              where spark_conversation_id = active_conversation_id
                and status = 'awaiting_plan'
                and openai_run_id is null`);
          }
          s.commitTransaction();
        },
      });
      s.refetch();
    });
  };
  const composerBody = (
    <Data
      watch={[sql`refresh_key`, sql`active_conversation_id`]}
      procedure={(s) => {
        s.defScalar(
          "agent_busy",
          sql`exists(select 1 from db.spark_agents a
            where a.spark_conversation_id = active_conversation_id
              and a.status in (
                'awaiting_plan', 'awaiting_execute', 'executing',
                'failed_retrying_plan'))`,
        );
        s.defScalar(
          "conv_is_paused",
          sql`coalesce(
            (select is_paused from db.spark_conversations
              where id = active_conversation_id), false)`,
        );
        s.defScalar(
          "composer_multiline",
          sql`composer_expanded
            or position(chr(10) in message_input) > 0
            or length(message_input) > 72`,
        );
        s.defScalar("composer_window_width", 0);
      }}
    >
      <Show when={sql`attachment_upload_error != ''`}>
        <div sx={styles.attachmentChipRow}>
          <Typography level="body-xs" sx={styles.attachmentUploadError}>
            {sql`attachment_upload_error`}
          </Typography>
        </div>
      </Show>
      <Show
        when={sql`attachment_uploading
          or exists (select 1 from ui.staged_attachments)`}
      >
        <div sx={styles.attachmentChipRow}>
          <Each
            table="staged_attachments"
            recordName="staged_att"
            orderBy={sql`id`}
          >
            <Chip
              size="sm"
              variant="soft"
              color="neutral"
              startDecorator={<MaterialIcon icon="AttachFile" fontSize="sm" />}
              endDecorator={<MaterialIcon icon="Close" fontSize="sm" />}
              onClick={(s) => {
                s.modify(
                  sql`delete from ui.staged_attachments
                    where id = staged_att.id`,
                );
              }}
            >
              {sql`staged_att.name`}
            </Chip>
          </Each>
          <Show when={sql`attachment_uploading`}>
            <Chip
              size="sm"
              variant="soft"
              color="neutral"
              startDecorator={
                <CircularProgress
                  size="sm"
                  sx={{ "--CircularProgress-size": "14px" }}
                />
              }
            >
              Uploading...
            </Chip>
          </Show>
        </div>
      </Show>
      <div
        sx={styles.composerRow}
        style={{
          "grid-template-columns": sql`case when composer_multiline
            then 'minmax(0, 1fr) auto'
            else 'auto minmax(0, 1fr) auto' end`,
          "align-items": sql`case when composer_multiline
            then 'end' else 'center' end`,
          height: sql`case when composer_expanded then '100%' else 'auto' end`,
          "min-height": sql`case when composer_multiline
            then '152px' else '52px' end`,
          "padding-bottom": sql`case when composer_multiline
            then '10px' else '3px' end`,
        }}
      >
        <IconButton
          variant="plain"
          color="neutral"
          size="sm"
          aria-label="Attach file"
          sx={styles.composerAttachButton}
          style={{
            "grid-column": sql`'1'`,
            "grid-row": sql`case when composer_multiline then '2' else '1' end`,
          }}
          onClick={(s) => {
            s.jsCall({
              module: "http_file_upload",
              exportName: "selectFiles",
              handle: uploadHandle,
              argJson: sql`json_build_object(
                'handle', ${uploadHandle},
                'accept', ${sql.lit(sparkAttachmentAccept)},
                'multiple', true)`,
            });
          }}
        >
          <MaterialIcon icon="Add" />
        </IconButton>
        <div
          sx={styles.composerInputSlot}
          style={{
            "grid-column":
              sql`case when composer_multiline then '1 / 3' else '2' end`,
            "grid-row": sql`'1'`,
          }}
        >
          <Textarea
            placeholder={sql.lit`Type a message...`}
            bindScalar="message_input"
            minRows={1}
            variant="plain"
            sx={styles.composerTextarea}
            style={{
              height:
                sql`case when composer_expanded then '100%' else 'auto' end`,
              "--spark-composer-textarea-right": sql`case
                when composer_multiline then '2.75rem'
                else 'var(--textarea-padding-x)'
              end`,
            }}
            onKeyDown={(s) => {
              s.if(
                sql`event.key = 'Escape' and trim(message_input) = ''
                  and agent_busy and not conv_is_paused`,
                (s) => {
                  s.event.preventDefault();
                  setPaused(s, true);
                },
              );
              s.if(sql`event.key = 'Enter'`, (s) => {
                // Enter (no shift) sends — desktop only. On narrow (touch)
                // viewports there is no Shift key, so Enter inserts a
                // newline and sending is the send button's job.
                s.window.getInnerWidth("composer_window_width");
                s.if(
                  sql`not event.shift_key and composer_window_width >= 640`,
                  (s) => {
                    s.event.preventDefault();
                    submit(s);
                  },
                );
              });
            }}
          />
          <Show when={sql`composer_expanded`}>
            <div
              aria-hidden="true"
              sx={{ height: "calc(min(72dvh, 640px) - 136px)" }}
            />
          </Show>
        </div>
        <div
          sx={styles.composerButtons}
          style={{
            "grid-column":
              sql`case when composer_multiline then '2' else '3' end`,
            "grid-row": sql`case when composer_multiline then '2' else '1' end`,
          }}
        >
          <SparkAiControlMenu />
          {/* Stop: idle prompt, agent running, not already paused. */}
          <Show
            when={sql`trim(message_input) = '' and agent_busy and not conv_is_paused`}
          >
            <IconButton
              aria-label="Stop agent"
              icon="Stop"
              variant="solid"
              color="neutral"
              size="sm"
              onClick={(s) => setPaused(s, true)}
            />
          </Show>
          {/* Play: idle prompt, conversation paused — resume the loop. */}
          <Show
            when={sql`trim(message_input) = '' and conv_is_paused`}
          >
            <IconButton
              aria-label="Resume agent"
              icon="PlayArrow"
              variant="solid"
              color="success"
              size="sm"
              onClick={(s) => setPaused(s, false)}
            />
          </Show>
          {/* Send: there is input, or the agent is idle and not paused. */}
          <Show
            when={sql`trim(message_input) != ''
              or exists (select 1 from ui.staged_attachments)
              or (not agent_busy and not conv_is_paused)`}
          >
            <IconButton
              aria-label="Send message"
              icon="ArrowUpward"
              variant="solid"
              color="primary"
              size="sm"
              sx={styles.composerSendButton}
              style={{
                "background-color": sql`case
                  when trim(message_input) = ''
                    and not exists (select 1 from ui.staged_attachments)
                    then '#e6eef7'
                  else '#2f80ed'
                end`,
                color: sql`case
                  when trim(message_input) = ''
                    and not exists (select 1 from ui.staged_attachments)
                    then '#a4aab1'
                  else '#ffffff'
                end`,
              }}
              disabled={sql`trim(message_input) = ''
                and not exists (select 1 from ui.staged_attachments)`}
              onClick={(s) => submit(s)}
            />
          </Show>
        </div>
      </div>
    </Data>
  );
  return (
    <div sx={styles.composerColumn}>
      <div
        sx={styles.composerCard}
        id={composerDomId}
        onMount={(s) => {
          s.jsCall({
            module: "http_file_upload",
            exportName: "enableCapture",
            handle: uploadHandle,
            argJson: sql`json_build_object(
              'handle', ${uploadHandle},
              'targetId', ${composerDomId},
              'accept', ${sql.lit(sparkAttachmentAccept)},
              'sources', json_build_array('paste', 'drop'))`,
          });
        }}
        js={{
          handles: [
            {
              module: "http_file_upload",
              cleanup: "cleanup",
              handle: uploadHandle,
            },
          ],
          on: {
            "http_file_upload.filesSelected": (s) => {
              s.setScalar("attachment_upload_error", sql.lit``);
              s.setScalar("attachment_uploading", true);
              s.commitUiTreeChanges();
              s.jsCall({
                module: "http_file_upload",
                exportName: "upload",
                handle: uploadHandle,
                argJson: sql`json_build_object(
                  'handle', ${uploadHandle},
                  'endpoint', ${sql.lit("/api" + sparkAttachmentUploadPath)},
                  'concurrency', 4)`,
              });
            },
            "http_file_upload.filesUploaded": (s) => {
              s.setScalar("attachment_uploading", false);
              stageUploadedResults(s);
            },
            "http_file_upload.uploadError": (s) => {
              s.setScalar("attachment_uploading", false);
              stageUploadedResults(s);
              s.setScalar(
                "attachment_upload_error",
                sql`coalesce(event.payload_json->>'error', 'Upload failed')`,
              );
            },
            "http_file_upload.filesRejected": (s) => {
              s.setScalar(
                "attachment_upload_error",
                sql.lit`Unsupported file type`,
              );
            },
            "http_file_upload.dragStateChanged": (s) => {
              s.setScalar(
                "composer_drag_active",
                sql`coalesce(event.payload_json->>'active', 'false') = 'true'`,
              );
            },
          },
        }}
      >
        <Show
          when={sql`composer_expanded
            or position(chr(10) in message_input) > 0
            or length(message_input) > 72`}
        >
          <Show
            when={sql`not composer_expanded`}
            fallback={
              <IconButton
                icon="CloseFullscreen"
                variant="plain"
                color="neutral"
                size="sm"
                aria-label="Collapse composer"
                sx={styles.composerExpand}
                onClick={(s) => s.setScalar("composer_expanded", false)}
              />
            }
          >
            <IconButton
              icon="OpenInFull"
              variant="plain"
              color="neutral"
              size="sm"
              aria-label="Expand composer"
              sx={styles.composerExpand}
              onClick={(s) => s.setScalar("composer_expanded", true)}
            />
          </Show>
        </Show>
        <Show when={sql`composer_drag_active`}>
          <div sx={styles.composerDropOverlay}>
            <Typography level="body-sm">Drop files to attach</Typography>
          </div>
        </Show>
        {composerBody}
      </div>
    </div>
  );
}

function ArchiveDialog(props: { basePath?: string }) {
  const basePath = props.basePath ?? "";
  return (
    <ModalDialog
      open={sql`archive_dialog_open`}
      onClose={(s) => {
        s.setScalar("archive_dialog_open", false);
      }}
    >
      <div className="p-4 flex flex-col gap-3 min-w-[300px]">
        <Typography level="h4">Archive Conversation</Typography>
        <Typography level="body-sm">
          Are you sure you want to archive this conversation?
        </Typography>
        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="outlined"
            color="neutral"
            onClick={(s) => {
              s.setScalar("archive_dialog_open", false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            color="danger"
            onClick={(s) => {
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  s.modify(
                    sql`update db.spark_conversations
                      set status = 'archived'
                      where id = active_conversation_id
                        and sys_user_id = current_user`,
                  );
                  s.commitTransaction();
                },
              });
              s.setScalar("archive_dialog_open", false);
              // Leave the archived conversation's route for the list.
              s.navigate(sparkListPath(basePath));
            }}
          >
            Archive
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
}

// Owner-only sharing controls: conversation visibility (private / organization)
// plus targeted per-user shares. Every mutation re-checks ownership on the
// server (`c.sys_user_id = current_user`) so the controls can't be spoofed.
function ShareDialog() {
  return (
    <ModalDialog
      open={sql`share_dialog_open`}
      onClose={(s) => s.setScalar("share_dialog_open", false)}
    >
      <Data
        watch={[sql`share_dialog_open`, sql`refresh_key`]}
        procedure={(s) => {
          s.defScalar(
            "share_owner_id",
            sql`(select sys_user_id from db.spark_conversations
                 where id = active_conversation_id)`,
          );
          s.defScalar("share_is_owner", sql`share_owner_id = current_user`);
          s.defScalar(
            "share_visibility",
            sql`coalesce((select visibility::string from db.spark_conversations
                 where id = active_conversation_id), 'private')`,
          );
          s.defScalar("share_user_pick", sql.lit``);
          s.defTable(
            "share_current",
            sql`select sh.id,
                  ${sparkUserNameExpr(sql`sh.shared_with_sys_user_id`)} as name
                from db.spark_conversation_shares sh
                where sh.spark_conversation_id = active_conversation_id
                order by name`,
          );
          s.defTable(
            "share_candidates",
            sql`select su.id,
                  ${sparkUserNameExpr(sql`su.id`)} as name
                from db.sys_users su
                where su.id != coalesce(share_owner_id, -1)
                  and ${canAccessSpark(sql`su.id`)}
                  and not exists(select 1 from db.spark_conversation_shares sh
                    where sh.spark_conversation_id = active_conversation_id
                      and sh.shared_with_sys_user_id = su.id)
                order by name`,
          );
        }}
      >
        <div className="p-4 flex flex-col gap-3 min-w-[400px]">
          <Typography level="h4">Share conversation</Typography>
          <Show
            when={sql`share_is_owner`}
            fallback={
              <Typography level="body-sm">
                This conversation was shared with you — only its owner can
                change sharing.
              </Typography>
            }
          >
            <Typography level="body-sm">Visibility</Typography>
            <Select
              value={sql`share_visibility`}
              onChange={(s) => {
                s.tryServer({
                  body: (s) => {
                    s.startTransaction();
                    s.modify(sql`update db.spark_conversations
                      set visibility =
                        target_value::enums.spark_conversation_visibility
                      where id = active_conversation_id
                        and sys_user_id = current_user`);
                    s.commitTransaction();
                  },
                });
                s.increment("refresh_key");
              }}
              sx={{ width: "100%" }}
            >
              <Select.Option value="private">
                Private — only you and people you add
              </Select.Option>
              <Select.Option value="organization">
                Organization — anyone who can use Spark
              </Select.Option>
            </Select>

            <Typography level="body-sm" sx={{ mt: 1 }}>
              People with access
            </Typography>
            <Each table="share_current" recordName="sh">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{sql`sh.name`}</span>
                <IconButton
                  icon="Close"
                  variant="plain"
                  color="neutral"
                  size="sm"
                  aria-label="Remove access"
                  onClick={(s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(sql`delete from db.spark_conversation_shares
                          where id = sh.id
                            and exists(select 1 from db.spark_conversations c
                              where c.id = active_conversation_id
                                and c.sys_user_id = current_user)`);
                        s.commitTransaction();
                      },
                    });
                    s.increment("refresh_key");
                  }}
                />
              </div>
            </Each>

            <div className="flex gap-2">
              <Select
                value={sql`share_user_pick`}
                onChange={(s) =>
                  s.setScalar("share_user_pick", sql`target_value`)}
                sx={{ flex: 1 }}
              >
                <Select.Option value="">Add a person…</Select.Option>
                <Each table="share_candidates" recordName="cand">
                  <Select.Option value={sql`cand.id::string`}>
                    {sql`cand.name`}
                  </Select.Option>
                </Each>
              </Select>
              <Button
                variant="solid"
                onClick={(s) => {
                  s.if(sql`share_user_pick != ''`, (s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(sql`insert into db.spark_conversation_shares
                          (spark_conversation_id, shared_with_sys_user_id,
                           shared_by_sys_user_id)
                          select active_conversation_id,
                            try_cast(share_user_pick as bigint), current_user
                          where exists(select 1 from db.spark_conversations c
                            where c.id = active_conversation_id
                              and c.sys_user_id = current_user)`);
                        s.commitTransaction();
                      },
                    });
                    s.setScalar("share_user_pick", sql.lit``);
                    s.increment("refresh_key");
                  });
                }}
              >
                Add
              </Button>
            </div>
          </Show>

          <div className="flex justify-end mt-2">
            <Button
              variant="outlined"
              color="neutral"
              onClick={(s) => s.setScalar("share_dialog_open", false)}
            >
              Done
            </Button>
          </div>
        </div>
      </Data>
    </ModalDialog>
  );
}

/**
 * The Spark conversation shell — sidebar + timeline + composer. Rendered by
 * both SparkPage routes; `activeConversationExpr` is the route-derived active
 * conversation id (null on the list route, the path param on the detail route).
 */
function SparkShell(
  props: {
    basePath: string;
    activeConversationExpr: Sql;
    initialMessage?: Sql;
  },
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(
          "active_conversation_id",
          visibleConversationId(props.activeConversationExpr),
        );
        defConversationScalars(s);
        s.setScalar(
          "pending_reasoning_effort",
          sql.lit(registeredSparkDefaultReasoningEffort),
        );
        if (props.initialMessage) {
          s.setScalar("message_input", props.initialMessage);
        }
      }}
    >
      <Sidebar.Provider defaultOpen width={260} shell={sparkSidebarShell()}>
        <ConversationListPanel basePath={props.basePath} />
        <Sidebar.MainScreen>
          <div sx={styles.mainAreaRoot}>
            <EmptyConversationState basePath={props.basePath} />
            <ConversationTimeline basePath={props.basePath} />
          </div>
        </Sidebar.MainScreen>
        <ArchiveDialog basePath={props.basePath} />
        <ShareDialog />
        <AttachmentPreviewDialog />
      </Sidebar.Provider>
    </Data>
  );
}

/**
 * Full-page "artifact" view of a single agent card, rendered with
 * `sizing="fill"` so the card covers the page. Reached from the expand
 * affordance on an inline card; deep-linkable at
 * `${base}/{conv}/card/{event}`.
 */
function SparkCardArtifact(
  props: {
    basePath: string;
    activeConversationExpr: Sql;
    cardEventExpr: Sql;
  },
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(
          "active_conversation_id",
          visibleConversationId(props.activeConversationExpr),
        );
        s.defScalar("artifact_event_id", props.cardEventExpr);
        s.defRecord(
          "artifact_conversation",
          sql`select sys_user_id, capabilities_json
            from db.spark_conversations
            where id = active_conversation_id`,
        );
        s.defScalar(
          "artifact_card_source",
          sql`(select event.payload->>'source'
            from db.spark_agent_events event
            join db.spark_agents agent on agent.id = event.spark_agent_id
            where event.id = artifact_event_id
              and agent.spark_conversation_id = active_conversation_id
              and event.type = 'card_displayed')`,
        );
      }}
    >
      <div sx={styles.artifactRoot}>
        <div sx={styles.artifactHeader}>
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onClick={(s) => {
              s.navigate(
                sql`case when active_conversation_id is not null
                  then ${
                  sparkConvPath(props.basePath, sql`active_conversation_id`)
                }
                  else ${sparkListPath(props.basePath)} end`,
              );
            }}
          >
            <MaterialIcon icon="ArrowBack" />
          </IconButton>
          <span sx={styles.artifactTitle}>Card</span>
        </div>
        <div sx={styles.artifactBody}>
          <Show when={sql`artifact_card_source is not null`}>
            <SparkCardNode
              sourceExpr={sql`artifact_card_source`}
              metaEventIdExpr={sql`artifact_event_id`}
              ownerIdExpr={sql`artifact_conversation.sys_user_id`}
              capabilitiesExpr={sql`artifact_conversation.capabilities_json`}
              sizing="fill"
            />
          </Show>
          <Show when={sql`artifact_card_source is null`}>
            <div sx={styles.artifactMissing}>
              This card is no longer available.
            </div>
          </Show>
        </div>
      </div>
    </Data>
  );
}

// ============================================================================
// Management surfaces
// ============================================================================

// Non-conversation page wrapper: keeps the sidebar so users can get back to
// chats, with a titled main area.
function ManagementShell(
  props: {
    basePath: string;
    title?: string;
    document?: boolean;
    flush?: boolean;
    children: import("std/ui").Node;
  },
) {
  return (
    <Data
      local
      procedure={(s) => {
        // No active conversation in the management shell; define the scalar so
        // defConversationScalars' owner check resolves (to true, unused here).
        s.defScalar("active_conversation_id", sql`null::bigint`);
        defConversationScalars(s);
      }}
    >
      <Sidebar.Provider defaultOpen width={260} shell={sparkSidebarShell()}>
        <ConversationListPanel basePath={props.basePath} />
        <Sidebar.MainScreen>
          <div sx={styles.mainAreaRoot}>
            {props.document || props.flush ? null : (
              <div sx={styles.mainHeader}>
                <div sx={styles.mgmtHeaderInner}>
                  <Typography level="title-md">{props.title}</Typography>
                </div>
              </div>
            )}
            <div
              sx={props.document
                ? styles.mgmtDocumentBody
                : props.flush
                ? styles.mgmtFlushBody
                : styles.mgmtBody}
            >
              {props.document || props.flush
                ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    {props.children}
                  </div>
                )
                : props.children}
            </div>
          </div>
        </Sidebar.MainScreen>
      </Sidebar.Provider>
    </Data>
  );
}

function SparkWorkspaceDefinitionButton(props: {
  basePath: string;
  parentFolderId: Sql;
}) {
  const workspace = registeredSparkWorkspace!;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("spark_definition_open", false);
        s.defScalar("spark_definition_name", sql.lit``);
        s.defScalar("spark_definition_description", sql.lit``);
        s.defScalar("spark_definition_instructions", sql.lit``);
        s.defScalar("spark_definition_error", sql.lit``);
      }}
    >
      <Button
        size="sm"
        variant="solid"
        startIcon="AutoAwesome"
        onClick={(s) => s.setScalar("spark_definition_open", true)}
      >
        Create skill
      </Button>
      <ModalDialog
        open={sql`ui.spark_definition_open`}
        onClose={(s) => s.setScalar("spark_definition_open", false)}
      >
        <div className="flex w-[min(42rem,90vw)] flex-col gap-4 p-4">
          <div>
            <Typography level="title-lg">Create skill</Typography>
            <p className="mt-1 text-sm text-secondary">
              Spark will create a standard SKILL.md with discovery frontmatter.
            </p>
          </div>
          <label className="text-sm font-medium">
            Name
            <Input
              className="mt-1 w-full"
              value={sql`ui.spark_definition_name`}
              onInput={(s) =>
                s.setScalar("spark_definition_name", sql`target_value`)}
              placeholder="estimate-bom"
              autoFocus
            />
          </label>
          <label className="text-sm font-medium">
            When should Spark use this skill?
            <Input
              className="mt-1 w-full"
              value={sql`ui.spark_definition_description`}
              onInput={(s) =>
                s.setScalar(
                  "spark_definition_description",
                  sql`target_value`,
                )}
              placeholder="A short description Spark can use to decide when this applies."
            />
          </label>
          <label className="text-sm font-medium">
            Instructions
            <Textarea
              className="mt-1 font-mono"
              fullWidth
              minRows={12}
              bindScalar="spark_definition_instructions"
              placeholder="Write the guidance this skill should follow."
            />
          </label>
          <Show when={sql`ui.spark_definition_error <> ''`}>
            <p className="text-sm text-danger">
              {sql`ui.spark_definition_error`}
            </p>
          </Show>
          <div className="flex justify-end gap-2">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("spark_definition_open", false)}
            >
              Cancel
            </Button>
            <Button
              disabled={sql`
                trim(ui.spark_definition_name) = ''
                or trim(ui.spark_definition_description) = ''
                or trim(ui.spark_definition_instructions) = ''
                or not (${
                sparkSkillDefinitionFieldsValid({
                  name: sql`ui.spark_definition_name`,
                  description: sql`ui.spark_definition_description`,
                  instructions: sql`ui.spark_definition_instructions`,
                })
              })
              `}
              onClick={(s) => {
                s.setScalar("spark_definition_error", sql.lit``);
                s.tryServer({
                  body: (s) => {
                    s.if(sql`not ${canAdminSpark()}`, (s) => {
                      s.throwError(
                        sql.lit`You don't have access to manage Spark.`,
                      );
                    });
                    s.if(sql`${props.parentFolderId} is null`, (s) => {
                      s.throwError(
                        sql.lit`Complete the Spark workspace setup first.`,
                      );
                    });
                    s.if(
                      sql`not (${
                        sparkSkillDefinitionFieldsValid({
                          name: sql`ui.spark_definition_name`,
                          description: sql`ui.spark_definition_description`,
                          instructions: sql`ui.spark_definition_instructions`,
                        })
                      })`,
                      (s) =>
                        s.throwError(
                          sql
                            .lit`Use a lowercase hyphen-case name (up to 64 characters) and a single-line description.`,
                        ),
                    );
                    s.startTransaction();
                    workspace.drive.createFolder(s, {
                      spaceId: sql`spark_workspace_id`,
                      parentItemId: props.parentFolderId,
                      name: sql`ui.spark_definition_name`,
                      into: "spark_created_definition_folder_id",
                    });
                    workspace.type.markdown.createDocument(s, {
                      spaceId: sql`spark_workspace_id`,
                      parentItemId: sql`spark_created_definition_folder_id`,
                      name: sql.lit`SKILL.md`,
                      content: sparkSkillDocumentContent({
                        name: sql`ui.spark_definition_name`,
                        description: sql`ui.spark_definition_description`,
                        instructions: sql`ui.spark_definition_instructions`,
                      }),
                      sysUserId: sql`current_user`,
                      intoItem: "spark_created_definition_skill_file_id",
                    });
                    s.commitTransaction();
                    s.navigate(
                      sql`${
                        sql.lit(props.basePath + "/admin/files/")
                      } || cast(spark_created_definition_skill_file_id as string)
                      || '?folder='
                      || cast(spark_created_definition_folder_id as string)`,
                    );
                  },
                  errorName: "spark_definition_create_failure",
                  catch: (s) =>
                    s.setScalar(
                      "spark_definition_error",
                      sql`coalesce(
                        spark_definition_create_failure.message,
                        ${sql.lit(`Could not create the skill.`)}
                      )`,
                    ),
                });
              }}
            >
              Create and edit
            </Button>
          </div>
        </div>
      </ModalDialog>
    </Data>
  );
}

function SparkWorkspaceRepairButton(props: { spaceId: Sql }) {
  const workspace = registeredSparkWorkspace!;
  return (
    <Button
      size="sm"
      variant="outlined"
      startIcon="Build"
      onClick={(s) => {
        s.tryServer({
          body: (s) => {
            s.if(sql`not ${canAdminSpark()}`, (s) => {
              s.throwError(sql.lit`You don't have access to manage Spark.`);
            });
            s.startTransaction();
            s.defScalar(
              "spark_repair_skills_folder_id",
              sql`(
                select id from db.file_items
                where file_space_id = ${props.spaceId}
                  and parent_file_item_id is null
                  and item_kind = 'folder'
                  and trashed_at is null
                  and name = 'Skills'
                order by id limit 1
              )`,
            );
            s.if(sql`spark_repair_skills_folder_id is null`, (s) => {
              workspace.drive.createFolder(s, {
                spaceId: props.spaceId,
                name: sql.lit`Skills`,
                into: "spark_repair_created_skills_folder_id",
              });
              s.setScalar(
                "spark_repair_skills_folder_id",
                sql`spark_repair_created_skills_folder_id`,
              );
            });
            s.if(
              sql`not exists (
                select 1
                from db.file_items item
                join db.markdown_file_versions markdown
                  on markdown.file_version_id = item.current_file_version_id
                where item.file_space_id = ${props.spaceId}
                  and item.parent_file_item_id is null
                  and item.item_kind = 'file'
                  and item.trashed_at is null
                  and item.name = 'AGENTS.md'
              )`,
              (s) => {
                workspace.type.markdown.createDocument(s, {
                  spaceId: props.spaceId,
                  name: sql.lit`AGENTS.md`,
                  content: sql`coalesce((
                    select markdown.content
                    from db.file_items legacy
                    join db.markdown_file_versions markdown
                      on markdown.file_version_id =
                        legacy.current_file_version_id
                    where legacy.file_space_id = ${props.spaceId}
                      and legacy.parent_file_item_id is null
                      and legacy.item_kind = 'file'
                      and legacy.trashed_at is null
                      and legacy.name = 'Instructions'
                    order by legacy.id limit 1
                  ), ${sql
                    .lit`# Spark instructions\n\nAdd organization-wide guidance for every Spark run here.`})`,
                  sysUserId: sql`current_user`,
                });
              },
            );
            s.forEachQuery(
              sql`select id
                from db.file_items
                where file_space_id = ${props.spaceId}
                  and parent_file_item_id is null
                  and trashed_at is null
                  and (
                    (item_kind = 'file' and name = 'Instructions')
                    or (item_kind = 'folder' and name = 'Agents')
                  )`,
              "spark_legacy_workspace_item",
              (s) => {
                s.callStoredProcedure("files_trash_item", {
                  inputScalars: {
                    p_space_id: props.spaceId,
                    p_item_id: sql`spark_legacy_workspace_item.id`,
                  },
                });
              },
            );
            s.commitTransaction();
            s.refetch();
          },
        });
      }}
    >
      Complete setup
    </Button>
  );
}

function SparkWorkspaceAdmin(
  props: { basePath: string; initialFolderId: Sql },
) {
  const workspace = registeredSparkWorkspace;
  if (!workspace) {
    throw new Error("Spark workspace was not registered before SparkPage.");
  }
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "spark_workspace_id",
          sql`(
            select id
            from db.file_spaces
            where cast(space_type as string) = ${
            sql.lit(workspace.type.spaceType.name)
          }
            order by id
            limit 1
          )`,
        );
        s.defScalar(
          "spark_workspace_has_instructions",
          sql`exists (
            select 1
            from db.file_items item
            join db.markdown_file_versions markdown
              on markdown.file_version_id = item.current_file_version_id
            where item.file_space_id = spark_workspace_id
              and item.parent_file_item_id is null
              and item.item_kind = 'file'
              and item.trashed_at is null
              and item.name = 'AGENTS.md'
          )`,
        );
        s.defScalar(
          "spark_workspace_has_skills",
          sql`exists (
            select 1 from db.file_items item
            where item.file_space_id = spark_workspace_id
              and item.parent_file_item_id is null
              and item.item_kind = 'folder'
              and item.trashed_at is null
              and item.name = 'Skills'
          )`,
        );
        s.defScalar(
          "spark_workspace_skills_folder_id",
          sql`(
            select id from db.file_items item
            where item.file_space_id = spark_workspace_id
              and item.parent_file_item_id is null
              and item.item_kind = 'folder'
              and item.trashed_at is null
              and item.name = 'Skills'
            order by id limit 1
          )`,
        );
        s.defScalar(
          "spark_workspace_invalid_definition_count",
          sql`(
            select count(*)
            from db.file_items root
            join db.file_items definition
              on definition.file_space_id = spark_workspace_id
              and definition.parent_file_item_id = root.id
              and definition.item_kind = 'folder'
              and definition.trashed_at is null
            where root.file_space_id = spark_workspace_id
              and root.parent_file_item_id is null
              and root.item_kind = 'folder'
              and root.trashed_at is null
              and root.name = 'Skills'
              and not exists (
                select 1
                from db.file_items skill_file
                join db.markdown_file_versions markdown
                  on markdown.file_version_id =
                    skill_file.current_file_version_id
                where skill_file.file_space_id = spark_workspace_id
                  and skill_file.parent_file_item_id = definition.id
                  and skill_file.item_kind = 'file'
                  and skill_file.trashed_at is null
                  and skill_file.name = 'SKILL.md'
                  and ${sparkSkillFrontmatterValid(sql`markdown.content`)}
              )
          )`,
        );
      }}
    >
      <Show
        when={sql`spark_workspace_id is not null`}
        fallback={
          <div className="flex flex-col items-start gap-3">
            <Typography level="body-md">
              The Spark workspace has not been initialized.
            </Typography>
            <Button
              variant="solid"
              color="primary"
              startIcon="Add"
              onClick={(s) => {
                s.tryServer({
                  body: (s) => {
                    s.if(sql`not ${canAdminSpark()}`, (s) => {
                      s.throwError(
                        sql.lit`You don't have access to initialize Spark.`,
                      );
                    });
                    s.startTransaction();
                    s.modify(sql`
                      insert into db.file_spaces (space_type, name)
                      select ${sql.lit(workspace.type.spaceType.name)}, 'Spark'
                      where not exists (
                        select 1 from db.file_spaces
                        where cast(space_type as string) =
                          ${sql.lit(workspace.type.spaceType.name)}
                      )
                    `);
                    s.defScalar(
                      "spark_initialize_workspace_id",
                      sql`(
                        select id from db.file_spaces
                        where cast(space_type as string) = ${
                        sql.lit(workspace.type.spaceType.name)
                      }
                        order by id limit 1
                      )`,
                    );
                    s.if(
                      sql`not exists (
                        select 1 from db.file_items
                        where file_space_id = spark_initialize_workspace_id
                          and parent_file_item_id is null
                          and item_kind = 'folder'
                          and trashed_at is null
                          and name = 'Skills'
                      )`,
                      (s) => {
                        workspace.drive.createFolder(s, {
                          spaceId: sql`spark_initialize_workspace_id`,
                          name: sql.lit`Skills`,
                        });
                      },
                    );
                    s.if(
                      sql`not exists (
                        select 1 from db.file_items
                        where file_space_id = spark_initialize_workspace_id
                          and parent_file_item_id is null
                          and item_kind = 'file'
                          and trashed_at is null
                          and name = 'AGENTS.md'
                      )`,
                      (s) => {
                        workspace.type.markdown.createDocument(s, {
                          spaceId: sql`spark_initialize_workspace_id`,
                          name: sql.lit`AGENTS.md`,
                          content: sql
                            .lit`# Spark instructions\n\nAdd organization-wide guidance for every Spark run here.`,
                          sysUserId: sql`current_user`,
                        });
                      },
                    );
                    s.commitTransaction();
                    s.refetch();
                  },
                });
              }}
            >
              Initialize Spark workspace
            </Button>
          </div>
        }
      >
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-divider px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Typography level="title-md">Spark admin</Typography>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Show when={sql`spark_workspace_skills_folder_id is not null`}>
              <SparkWorkspaceDefinitionButton
                basePath={props.basePath}
                parentFolderId={sql`spark_workspace_skills_folder_id`}
              />
            </Show>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Show
            when={sql`
              not spark_workspace_has_instructions
              or not spark_workspace_has_skills
            `}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-300 bg-warning-50 p-3 text-sm">
              <span>
                Spark expects a root <b>AGENTS.md</b> and a <b>Skills</b>{" "}
                folder.
              </span>
              <SparkWorkspaceRepairButton spaceId={sql`spark_workspace_id`} />
            </div>
          </Show>
          <Show when={sql`spark_workspace_invalid_definition_count > 0`}>
            <div className="mb-3 rounded-md border border-warning-300 bg-warning-50 p-3 text-sm">
              {sql`cast(spark_workspace_invalid_definition_count as string)`}
              {" "}
              skill folder
              {sql`case
                when spark_workspace_invalid_definition_count = 1 then ''
                else 's'
              end`}{" "}
              will not be available to Spark because its SKILL.md is missing or
              its name/description frontmatter is invalid.
            </div>
          </Show>
          <DriveWorkspace
            files={workspace.drive}
            type={workspace.type.spaceType}
            spaceId={sql`spark_workspace_id`}
            initialFolderId={props.initialFolderId}
            folderQueryParam="folder"
            title="Spark workspace"
            allowUploads={false}
            selectable
            canTrashItem={(itemId) =>
              sql`not exists (
                select 1 from db.file_items item
                where item.id = ${itemId}
                  and item.file_space_id = spark_workspace_id
                  and item.parent_file_item_id is null
                  and item.trashed_at is null
                  and (
                    (item.item_kind = 'file' and item.name = 'AGENTS.md')
                    or (
                      item.item_kind = 'folder'
                      and item.name = 'Skills'
                    )
                  )
              )`}
            fileHref={(itemId) =>
              sql`${sql.lit(props.basePath + "/admin/files/")} ||
                cast(${itemId} as string) || case
                  when ui.files_folder_id is null then ''
                  else '?folder=' || cast(ui.files_folder_id as string)
                end`}
            fileVersionHref={(itemId, versionId) =>
              sql`${sql.lit(props.basePath + "/admin/files/")} ||
                cast(${itemId} as string) || '/versions/' ||
                cast(${versionId} as string) || case
                  when ui.files_folder_id is null then ''
                  else '?folder=' || cast(ui.files_folder_id as string)
                end`}
            createFile={({ spaceId, parentItemId }) => (
              <CreateMarkdownDocumentButton
                documents={workspace.type.markdown}
                spaceId={spaceId}
                parentItemId={parentItemId}
              />
            )}
          />
        </div>
      </Show>
    </Data>
  );
}

function SparkAdminScreen(props: { basePath: string }) {
  return (
    <ManagementShell basePath={props.basePath} flush>
      <Data
        local
        queryParams={{
          folder: {
            type: { type: "BigInt" },
            default: sql`null::bigint`,
          },
        }}
        procedure={(s) => s.defScalar("is_spark_admin", canAdminSpark())}
      >
        <Show when={sql`is_spark_admin`}>
          <SparkWorkspaceAdmin
            basePath={props.basePath}
            initialFolderId={sql`folder`}
          />
        </Show>
        <Show when={sql`not is_spark_admin`}>
          <Typography level="body-md">
            You don't have access to Spark admin.
          </Typography>
        </Show>
      </Data>
    </ManagementShell>
  );
}

function sparkWorkspaceAdminHref(basePath: string, folderId: Sql): Sql {
  return sql`${sql.lit(basePath + "/admin")} || case
    when ${folderId} is null then ''
    else '?folder=' || cast(${folderId} as string)
  end`;
}

function SparkWorkspaceDocument(props: {
  basePath: string;
  historical?: boolean;
}) {
  const workspace = registeredSparkWorkspace!;
  return (
    <Data
      local
      queryParams={{
        folder: {
          type: { type: "BigInt" },
          default: sql`null::bigint`,
        },
      }}
      procedure={() => {}}
    >
      <ManagementShell basePath={props.basePath} document>
        <MarkdownDocumentEditor
          files={workspace.drive}
          documents={workspace.type.markdown}
          fileItemId={sql`try_cast(spark_file_item_id as bigint)`}
          fileVersionId={props.historical
            ? sql`try_cast(spark_file_version_id as bigint)`
            : undefined}
          readOnly={props.historical}
          workspaceLayout
          renderContent={sparkSkillRenderedContent}
          backHref={sparkWorkspaceAdminHref(props.basePath, sql`folder`)}
        />
      </ManagementShell>
    </Data>
  );
}

/**
 * The main Spark app page component. Owns per-conversation URL routing: the
 * list lives at `basePath` (default "/") and each conversation at
 * `basePath/{id}`, so conversations are deep-linkable and survive refresh.
 * A single card can be opened full-page at `basePath/{id}/card/{event}`.
 * Mount as `<SparkBlock.SparkPage />` (the app's whole body); it renders its
 * own `<AppRoutes>`.
 */
export function SparkPage(props: {
  path?: string;
  basePath?: string;
  /** App-owned handoff/document routes, before the conversation catch-all. */
  additionalRoutes?: Node;
}) {
  const basePath = props.basePath ?? "";
  const app = system.renderingApp;
  const mcpOptions = registeredMcpEnabled ? registeredMcpOptions : undefined;
  const connection: TenantMcpOptions | undefined = app && mcpOptions
    ? {
      domain: app.domain,
      domainAliases: app.domainAliases,
      surface: "spark",
      path: "/api/spark/mcp",
      settingsPath: `${basePath}/connected-assistants`,
      permission: canAccessSpark,
      capabilities: (user) => sparkMcpCapabilities(mcpOptions, user),
    }
    : undefined;
  if (connection && mcpOptions) registerSparkMcp(connection, mcpOptions);
  return (
    <>
      {mcpOptions?.workspace && (
        <DriveBlock.Endpoints files={mcpOptions.workspace.drive} />
      )}
      {
        /* Spark keeps its shell visually stable while a newly-created chat
          acquires its canonical URL. The app-level root crossfade otherwise
          overlays the empty and active shells for 275ms, producing a ghosted
          full-page loading frame exactly when the first live status arrives. */
      }
      <style>
        {`html[data-yolm-transition-type*="navigate"]::view-transition-group(root) {
          animation-duration: 0ms;
        }
        html[data-yolm-transition-type*="navigate"]::view-transition-new(root),
        html[data-yolm-transition-type*="navigate"]::view-transition-old(root) {
          animation: none;
        }`}
      </style>
      <EventHandlers
        document={{
          // Ctrl/Cmd+Shift+O opens a fresh chat (the base list path is the
          // new-chat page). Mirrors Studio's global new-session shortcut.
          keydown: (s) =>
            s.if(
              sql`(event.ctrl_key or event.meta_key) and event.shift_key and lower(event.key) = 'o'`,
              (s) => {
                s.event.preventDefault();
                s.navigate(sparkListPath(basePath));
              },
            ),
        }}
      />
      <AppRoutes>
        {connection && (
          <Route path={`${basePath}/connected-assistants`}>
            <McpSettings options={connection}>
              <SparkMcpActivity basePath={basePath} />
            </McpSettings>
          </Route>
        )}
        {props.additionalRoutes}
        <Route path={basePath === "" ? "/" : basePath} exact>
          <Data
            local
            queryParams={{
              prompt: {
                type: { type: "String", maxLength: 5000 },
                default: sql.lit``,
              },
            }}
            procedure={() => {}}
          >
            <SparkShell
              basePath={basePath}
              activeConversationExpr={sql`null::bigint`}
              initialMessage={sql`prompt`}
            />
          </Data>
        </Route>
        <Route
          path={`${basePath}/admin/files/{spark_file_item_id}/versions/{spark_file_version_id}`}
        >
          <SparkWorkspaceDocument basePath={basePath} historical />
        </Route>
        <Route
          path={`${basePath}/admin/files/{spark_file_item_id}`}
        >
          <SparkWorkspaceDocument basePath={basePath} />
        </Route>
        <Route path={`${basePath}/admin`} exact>
          <SparkAdminScreen basePath={basePath} />
        </Route>
        <Route path={`${basePath}/{route_conv_id}/card/{route_card_id}`}>
          <SparkCardArtifact
            basePath={basePath}
            activeConversationExpr={sql`try_cast(route_conv_id as bigint)`}
            cardEventExpr={sql`try_cast(route_card_id as bigint)`}
          />
        </Route>
        <Route path={`${basePath}/{route_conv_id}`}>
          <SparkShell
            basePath={basePath}
            activeConversationExpr={sql`try_cast(route_conv_id as bigint)`}
          />
        </Route>
      </AppRoutes>
    </>
  );
}

/**
 * Embeddable Spark conversation panel — the timeline + composer without the
 * sidebar chrome. Mount it inside any app (e.g. a workspace tab) and point
 * it at a conversation id; the host owns conversation creation (typically
 * via `sparkBlock.start` with a context-seeded task and a role skill set).
 */
export function SparkPanel(props: { conversationId: Sql; context?: Sql }) {
  return (
    <Data
      local
      procedure={(s) => {
        // Gate the embedded conversation through the same visibility check as
        // SparkPage: bind the id only when the current user may see it, else
        // null (empty panel). A consumer embedding this in a client portal must
        // not be able to surface another tenant's conversation by passing its
        // id — this closes that direct-object-reference read.
        s.defScalar(
          "active_conversation_id",
          visibleConversationId(props.conversationId),
        );
        defConversationScalars(s);
        // Stamp new conversations created from this panel with the caller's
        // context (e.g. a tenant/record scope), so a client portal's messages
        // run bound to that scope.
        if (props.context) {
          s.setScalar("pending_conversation_context", props.context);
        }
      }}
    >
      <div sx={styles.panelRoot}>
        <ConversationTimeline />
      </div>
      <ArchiveDialog />
      <AttachmentPreviewDialog />
    </Data>
  );
}

function AttachmentPreviewDialog() {
  return (
    <ModalDialog
      open={sql`attachment_preview_open`}
      onClose={(s) => {
        s.setScalar("attachment_preview_open", false);
      }}
      className="max-w-[720px]"
    >
      <div className="p-4 flex flex-col gap-2 min-w-[480px] max-w-[720px]">
        <div className="flex items-center gap-2">
          <MaterialIcon icon="AttachFile" fontSize="sm" />
          <Typography level="title-md">
            {sql`attachment_preview_name`}
          </Typography>
        </div>
        <pre sx={styles.attachmentPreviewBody}>
          {sql`attachment_preview_body`}
        </pre>
      </div>
    </ModalDialog>
  );
}

//
// Built-in Spark workspace capability
//

const SPARK_WORKSPACE_CAPABILITY_DOC = `The Spark workspace is the live,
human-maintained behavior and reference library. Use listFiles() and readFile()
before proposing changes so you preserve the current structure and content.

- Workspace paths are relative, for example \`References/Finance Definitions\`.
- \`create_folder\` creates one folder whose parent already exists.
- \`create_markdown\` and \`update_markdown\` manage ordinary reference
  material. Updates are full replacements, not patches.
- Root \`AGENTS.md\` and \`Skills/<skill>/SKILL.md\` control Spark behavior.
  Change those only through the high-risk \`set_instructions\` action.
- Renaming or moving an item is high-risk because paths can affect skills,
  discovery, and references.
- Every action is only a proposal until an authorized human approves it. After
  proposing, say what is awaiting approval; never claim the workspace already
  changed.`;

function sparkWorkspaceSpaceIdExpr(workspace: SparkWorkspace): Sql {
  return sql`(
    select id
    from db.file_spaces
    where cast(space_type as string) = ${sql.lit(workspace.type.spaceType.name)}
    order by id
    limit 1
  )`;
}

function sparkWorkspaceItemIdExpr(
  workspace: SparkWorkspace,
  path: Sql,
  kind?: "file" | "folder",
): Sql {
  return sql`(
    with recursive workspace_paths as (
      select item.id, item.item_kind, item.name as path
      from db.file_items item
      where item.file_space_id = ${sparkWorkspaceSpaceIdExpr(workspace)}
        and item.parent_file_item_id is null
        and item.trashed_at is null

      union all

      select child.id, child.item_kind,
        parent.path || '/' || child.name
      from db.file_items child
      join workspace_paths parent
        on parent.id = child.parent_file_item_id
      where child.file_space_id = ${sparkWorkspaceSpaceIdExpr(workspace)}
        and child.trashed_at is null
    )
    select id
    from workspace_paths
    where path = ${path} collate nocase
      ${kind ? sql`and item_kind = ${sql.lit(kind)}` : sql``}
    limit 1
  )`;
}

function sparkReservedInstructionsPath(path: Sql): Sql {
  return sql`
    ${path} = 'AGENTS.md' collate nocase
    or (
      ${path} like 'Skills/%/SKILL.md' collate nocase
      and length(${path}) - length(replace(${path}, '/', '')) = 2
    )
  `;
}

function sparkCanonicalInstructionsPath(path: Sql): Sql {
  return sql`
    ${path} = 'AGENTS.md'
    or (
      ${path} like 'Skills/%/SKILL.md'
      and length(${path}) - length(replace(${path}, '/', '')) = 2
    )
  `;
}

function prepareSparkWorkspaceAction(
  s: GeneralServerStatements,
  workspace: SparkWorkspace,
) {
  s.if(
    sql`action_sys_user_id is null`,
    (s) =>
      s.throwError(
        sql.lit`Managing the Spark workspace requires a conversation owner.`,
      ),
  );
  s.defScalar(
    "spark_workspace_action_space_id",
    sparkWorkspaceSpaceIdExpr(workspace),
  );
  s.if(
    sql`spark_workspace_action_space_id is null`,
    (s) => s.throwError(sql.lit`The Spark workspace is unavailable.`),
  );
  s.if(
    sql`not (${
      workspace.drive.runtimeAccessSql(
        sql`spark_workspace_action_space_id`,
        sql`action_sys_user_id`,
        "write",
      )
    })`,
    (s) =>
      s.throwError(
        sql.lit`You do not have permission to manage the Spark workspace.`,
      ),
  );
}

function prepareSparkWorkspacePath(
  s: GeneralServerStatements,
  workspace: SparkWorkspace,
  path: Sql,
  opts?: { resolveTarget?: boolean },
) {
  s.defScalar("spark_workspace_action_path", sql`trim(coalesce(${path}, ''))`);
  s.if(
    sql`
      spark_workspace_action_path = ''
      or spark_workspace_action_path like '/%'
      or spark_workspace_action_path like '%/'
      or spark_workspace_action_path like '%//%'
      or spark_workspace_action_path = '.'
      or spark_workspace_action_path = '..'
      or spark_workspace_action_path like './%'
      or spark_workspace_action_path like '../%'
      or spark_workspace_action_path like '%/./%'
      or spark_workspace_action_path like '%/../%'
      or spark_workspace_action_path like '%/.'
      or spark_workspace_action_path like '%/..'
      or position(chr(92) in spark_workspace_action_path) > 0
      or position(chr(10) in spark_workspace_action_path) > 0
      or position(chr(13) in spark_workspace_action_path) > 0
    `,
    (s) =>
      s.throwError(
        sql
          .lit`Use a valid workspace-relative path without empty, dot, or parent segments.`,
      ),
  );
  if (opts?.resolveTarget === false) {
    return;
  }
  s.defScalar(
    "spark_workspace_action_last_slash",
    sql`position('/' in reverse(spark_workspace_action_path))`,
  );
  s.defScalar(
    "spark_workspace_action_parent_path",
    sql`case
      when spark_workspace_action_last_slash = 0 then ''
      else left(
        spark_workspace_action_path,
        length(spark_workspace_action_path) - spark_workspace_action_last_slash
      )
    end`,
  );
  s.defScalar(
    "spark_workspace_action_name",
    sql`case
      when spark_workspace_action_last_slash = 0
        then spark_workspace_action_path
      else right(
        spark_workspace_action_path,
        spark_workspace_action_last_slash - 1
      )
    end`,
  );
  s.defScalar(
    "spark_workspace_action_parent_id",
    sql`case
      when spark_workspace_action_parent_path = '' then null::bigint
      else ${
      sparkWorkspaceItemIdExpr(
        workspace,
        sql`spark_workspace_action_parent_path`,
        "folder",
      )
    }
    end`,
  );
  s.if(
    sql`spark_workspace_action_parent_path <> ''
      and spark_workspace_action_parent_id is null`,
    (s) =>
      s.throwError(
        sql`'No workspace folder exists at "' ||
          spark_workspace_action_parent_path || '".'`,
      ),
  );
}

function SparkWorkspacePathApproval(props: {
  title: string;
  input: Sql;
  detail?: "new_name" | "destination_folder";
  highRisk?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div sx={{ fontWeight: 600, fontSize: "0.85rem" }}>{props.title}</div>
      <div sx={{ fontSize: "0.78rem" }}>
        {sql`coalesce(${props.input}->>'path', '(path missing)')`}
      </div>
      {props.detail
        ? (
          <div sx={{ fontSize: "0.75rem", color: "secondary" }}>
            {sql`${
              sql.lit(
                props.detail === "new_name" ? "New name: " : "Destination: ",
              )
            } || coalesce(nullif(${props.input}->>${
              sql.lit(props.detail)
            }, ''), '(workspace root)')`}
          </div>
        )
        : null}
      <div sx={{ fontSize: "0.72rem", color: "tertiary" }}>
        {props.highRisk
          ? "High-risk workspace change; applies only after approval."
          : "Applies only after approval; undoable."}
      </div>
    </div>
  );
}

function SparkWorkspaceMarkdownApproval(props: {
  title: string;
  input: Sql;
  highRisk?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div sx={{ fontWeight: 600, fontSize: "0.85rem" }}>{props.title}</div>
      <div sx={{ fontSize: "0.78rem" }}>
        {sql`coalesce(${props.input}->>'path', '(path missing)')`}
      </div>
      <Show
        when={sql`nullif(trim(coalesce(${props.input}->>'change_summary', '')), '') is not null`}
      >
        <div sx={{ fontSize: "0.75rem", color: "secondary" }}>
          {sql`${props.input}->>'change_summary'`}
        </div>
      </Show>
      <div className="max-h-[260px] overflow-y-auto rounded-md border p-2">
        <MarkdownDisplay
          content={sql`coalesce(${props.input}->>'markdown', '')`}
          sx={styles.markdownBody}
        />
      </div>
      <div sx={{ fontSize: "0.72rem", color: "tertiary" }}>
        {props.highRisk
          ? "Replaces behavioral instructions after high-risk approval; undoable."
          : "Full Markdown content that will apply after approval; undoable."}
      </div>
    </div>
  );
}

function buildSparkWorkspaceCapability(
  workspace: SparkWorkspace,
  adminPermission: string,
): SparkCapability {
  return {
    name: "workspace_management",
    label: "Workspace management",
    description:
      "Propose approved maintenance of Spark references, folders, and instructions",
    permission: adminPermission,
    doc: SPARK_WORKSPACE_CAPABILITY_DOC,
    actions: [
      {
        name: "create_folder",
        description:
          "Create one folder at a workspace-relative path whose parent already exists.",
        danger: "low",
        inputType: "{ path: string }",
        approvalUi: ({ input }) => (
          <SparkWorkspacePathApproval
            title="Create workspace folder"
            input={input}
          />
        ),
        procedure: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          prepareSparkWorkspacePath(s, workspace, sql`action_input->>'path'`);
          workspace.drive.createFolder(s, {
            spaceId: sql`spark_workspace_action_space_id`,
            parentItemId: sql`spark_workspace_action_parent_id`,
            name: sql`spark_workspace_action_name`,
            into: "spark_workspace_created_folder_id",
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'item_id', spark_workspace_created_folder_id,
              'parent_id', spark_workspace_action_parent_id,
              'name', spark_workspace_action_name
            )::string`,
          );
        },
        undo: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          s.defScalar(
            "spark_workspace_undo_item_id",
            sql`try_cast(action_result::json->>'item_id' as bigint)`,
          );
          s.if(
            sql`not exists (
              select 1
              from db.file_items item
              where item.id = spark_workspace_undo_item_id
                and item.file_space_id = spark_workspace_action_space_id
                and item.item_kind = 'folder'
                and coalesce(cast(item.parent_file_item_id as string), '') =
                  coalesce(action_result::json->>'parent_id', '')
                and item.name = action_result::json->>'name'
                and item.trashed_at is null
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`The created folder changed after this action and cannot be undone.`,
              ),
          );
          s.if(
            sql`exists (
              select 1
              from db.file_items child
              where child.parent_file_item_id = spark_workspace_undo_item_id
                and child.trashed_at is null
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`The created folder is no longer empty and cannot be undone.`,
              ),
          );
          s.modify(sql`
            update db.file_items
            set trashed_at = now(),
                trashed_by_user_id = action_sys_user_id
            where id = spark_workspace_undo_item_id
              and file_space_id = spark_workspace_action_space_id
              and trashed_at is null
          `);
        },
      },
      {
        name: "create_markdown",
        description:
          "Create an ordinary Markdown reference file. Behavioral AGENTS.md and SKILL.md paths are rejected.",
        danger: "low",
        inputType: "{ path: string; markdown: string; description?: string }",
        approvalUi: ({ input }) => (
          <SparkWorkspaceMarkdownApproval
            title="Create workspace reference"
            input={input}
          />
        ),
        procedure: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          prepareSparkWorkspacePath(s, workspace, sql`action_input->>'path'`);
          s.if(
            sparkReservedInstructionsPath(sql`spark_workspace_action_path`),
            (s) =>
              s.throwError(
                sql
                  .lit`Use workspace_management.set_instructions for behavioral AGENTS.md and SKILL.md files.`,
              ),
          );
          s.defScalar(
            "spark_workspace_markdown_content",
            sql`action_input->>'markdown'`,
          );
          s.if(
            sql`spark_workspace_markdown_content is null`,
            (s) => s.throwError(sql.lit`markdown is required.`),
          );
          workspace.type.markdown.createDocument(s, {
            spaceId: sql`spark_workspace_action_space_id`,
            parentItemId: sql`spark_workspace_action_parent_id`,
            name: sql`spark_workspace_action_name`,
            description: sql`action_input->>'description'`,
            content: sql`spark_workspace_markdown_content`,
            sysUserId: sql`action_sys_user_id`,
            intoItem: "spark_workspace_created_markdown_item_id",
            intoVersion: "spark_workspace_created_markdown_version_id",
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'item_id', spark_workspace_created_markdown_item_id,
              'version_id', spark_workspace_created_markdown_version_id,
              'parent_id', spark_workspace_action_parent_id,
              'name', spark_workspace_action_name
            )::string`,
          );
        },
        undo: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          s.defScalar(
            "spark_workspace_undo_item_id",
            sql`try_cast(action_result::json->>'item_id' as bigint)`,
          );
          s.defScalar(
            "spark_workspace_undo_version_id",
            sql`try_cast(action_result::json->>'version_id' as bigint)`,
          );
          s.if(
            sql`not exists (
              select 1
              from db.file_items item
              where item.id = spark_workspace_undo_item_id
                and item.file_space_id = spark_workspace_action_space_id
                and item.item_kind = 'file'
                and item.current_file_version_id = spark_workspace_undo_version_id
                and coalesce(cast(item.parent_file_item_id as string), '') =
                  coalesce(action_result::json->>'parent_id', '')
                and item.name = action_result::json->>'name'
                and item.trashed_at is null
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`The created file changed after this action and cannot be undone.`,
              ),
          );
          s.modify(sql`
            update db.file_items
            set trashed_at = now(),
                trashed_by_user_id = action_sys_user_id
            where id = spark_workspace_undo_item_id
              and file_space_id = spark_workspace_action_space_id
              and current_file_version_id = spark_workspace_undo_version_id
              and trashed_at is null
          `);
        },
      },
      {
        name: "update_markdown",
        description:
          "Replace an ordinary Markdown reference file with complete new content. Behavioral AGENTS.md and SKILL.md paths are rejected.",
        danger: "low",
        inputType: "{ path: string; markdown: string; change_summary: string }",
        approvalUi: ({ input }) => (
          <SparkWorkspaceMarkdownApproval
            title="Update workspace reference"
            input={input}
          />
        ),
        procedure: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          prepareSparkWorkspacePath(s, workspace, sql`action_input->>'path'`, {
            resolveTarget: false,
          });
          s.if(
            sparkReservedInstructionsPath(sql`spark_workspace_action_path`),
            (s) =>
              s.throwError(
                sql
                  .lit`Use workspace_management.set_instructions for behavioral AGENTS.md and SKILL.md files.`,
              ),
          );
          s.defScalar(
            "spark_workspace_markdown_item_id",
            sparkWorkspaceItemIdExpr(
              workspace,
              sql`spark_workspace_action_path`,
              "file",
            ),
          );
          s.if(
            sql`spark_workspace_markdown_item_id is null`,
            (s) => s.throwError(sql.lit`The Markdown file is unavailable.`),
          );
          s.defScalar(
            "spark_workspace_old_version_id",
            sql`(select current_file_version_id
              from db.file_items
              where id = spark_workspace_markdown_item_id)`,
          );
          s.defScalar(
            "spark_workspace_markdown_content",
            sql`action_input->>'markdown'`,
          );
          s.if(
            sql`spark_workspace_markdown_content is null`,
            (s) => s.throwError(sql.lit`markdown is required.`),
          );
          workspace.type.markdown.saveDocument(s, {
            fileItemId: sql`spark_workspace_markdown_item_id`,
            content: sql`spark_workspace_markdown_content`,
            note: sql`action_input->>'change_summary'`,
            sysUserId: sql`action_sys_user_id`,
            intoVersion: "spark_workspace_updated_markdown_version_id",
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'item_id', spark_workspace_markdown_item_id,
              'old_version_id', spark_workspace_old_version_id,
              'new_version_id', spark_workspace_updated_markdown_version_id,
              'parent_id', (select parent_file_item_id
                from db.file_items
                where id = spark_workspace_markdown_item_id),
              'name', (select name
                from db.file_items
                where id = spark_workspace_markdown_item_id)
            )::string`,
          );
        },
        undo: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          s.defScalar(
            "spark_workspace_undo_item_id",
            sql`try_cast(action_result::json->>'item_id' as bigint)`,
          );
          s.defScalar(
            "spark_workspace_undo_old_version_id",
            sql`try_cast(action_result::json->>'old_version_id' as bigint)`,
          );
          s.defScalar(
            "spark_workspace_undo_new_version_id",
            sql`try_cast(action_result::json->>'new_version_id' as bigint)`,
          );
          s.if(
            sql`not exists (
              select 1
              from db.file_items item
              where item.id = spark_workspace_undo_item_id
                and item.file_space_id = spark_workspace_action_space_id
                and item.current_file_version_id = spark_workspace_undo_new_version_id
                and coalesce(cast(item.parent_file_item_id as string), '') =
                  coalesce(action_result::json->>'parent_id', '')
                and item.name = action_result::json->>'name'
                and item.trashed_at is null
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`The file changed after this action and cannot be undone.`,
              ),
          );
          s.defScalar(
            "spark_workspace_undo_old_content",
            sql`(select content
              from db.markdown_file_versions
              where file_version_id = spark_workspace_undo_old_version_id)`,
          );
          s.if(
            sql`spark_workspace_undo_old_content is null`,
            (s) =>
              s.throwError(
                sql.lit`The previous Markdown version is unavailable.`,
              ),
          );
          workspace.type.markdown.saveDocument(s, {
            fileItemId: sql`spark_workspace_undo_item_id`,
            content: sql`spark_workspace_undo_old_content`,
            note: sql.lit`Undo Spark workspace update`,
            sysUserId: sql`action_sys_user_id`,
            intoVersion: "spark_workspace_undo_restored_version_id",
          });
        },
      },
      {
        name: "set_instructions",
        description:
          "Create or replace root AGENTS.md or a skill SKILL.md. This changes Spark behavior and is high-risk.",
        danger: "high",
        inputType: "{ path: string; markdown: string; change_summary: string }",
        approvalUi: ({ input }) => (
          <SparkWorkspaceMarkdownApproval
            title="Change Spark instructions"
            input={input}
            highRisk
          />
        ),
        procedure: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          prepareSparkWorkspacePath(s, workspace, sql`action_input->>'path'`);
          s.if(
            sql`not (${
              sparkCanonicalInstructionsPath(
                sql`spark_workspace_action_path`,
              )
            })`,
            (s) =>
              s.throwError(
                sql
                  .lit`set_instructions only accepts root AGENTS.md or Skills/<skill>/SKILL.md.`,
              ),
          );
          s.defScalar(
            "spark_workspace_instruction_item_id",
            sparkWorkspaceItemIdExpr(
              workspace,
              sql`spark_workspace_action_path`,
              "file",
            ),
          );
          s.defScalar(
            "spark_workspace_instruction_content",
            sql`action_input->>'markdown'`,
          );
          s.if(
            sql`spark_workspace_instruction_content is null`,
            (s) => s.throwError(sql.lit`markdown is required.`),
          );
          s.if(
            sql`spark_workspace_action_path like 'Skills/%/SKILL.md'
              and not (${
              sparkSkillFrontmatterValid(
                sql`spark_workspace_instruction_content`,
              )
            })`,
            (s) =>
              s.throwError(
                sql
                  .lit`SKILL.md requires non-empty name and description YAML frontmatter.`,
              ),
          );
          s.if(sql`spark_workspace_instruction_item_id is null`, (s) => {
            workspace.type.markdown.createDocument(s, {
              spaceId: sql`spark_workspace_action_space_id`,
              parentItemId: sql`spark_workspace_action_parent_id`,
              name: sql`spark_workspace_action_name`,
              content: sql`spark_workspace_instruction_content`,
              sysUserId: sql`action_sys_user_id`,
              intoItem: "spark_workspace_created_instruction_item_id",
              intoVersion: "spark_workspace_created_instruction_version_id",
            });
            s.setScalar(
              "action_result",
              sql`json_build_object(
                'mode', 'created',
                'item_id', spark_workspace_created_instruction_item_id,
                'new_version_id', spark_workspace_created_instruction_version_id,
                'parent_id', spark_workspace_action_parent_id,
                'name', spark_workspace_action_name
              )::string`,
            );
          });
          s.if(sql`spark_workspace_instruction_item_id is not null`, (s) => {
            s.defScalar(
              "spark_workspace_old_instruction_version_id",
              sql`(select current_file_version_id
                from db.file_items
                where id = spark_workspace_instruction_item_id)`,
            );
            workspace.type.markdown.saveDocument(s, {
              fileItemId: sql`spark_workspace_instruction_item_id`,
              content: sql`spark_workspace_instruction_content`,
              note: sql`action_input->>'change_summary'`,
              sysUserId: sql`action_sys_user_id`,
              intoVersion: "spark_workspace_updated_instruction_version_id",
            });
            s.setScalar(
              "action_result",
              sql`json_build_object(
                'mode', 'updated',
                'item_id', spark_workspace_instruction_item_id,
                'old_version_id', spark_workspace_old_instruction_version_id,
                'new_version_id', spark_workspace_updated_instruction_version_id,
                'parent_id', (select parent_file_item_id
                  from db.file_items
                  where id = spark_workspace_instruction_item_id),
                'name', (select name
                  from db.file_items
                  where id = spark_workspace_instruction_item_id)
              )::string`,
            );
          });
        },
        undo: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          s.defScalar(
            "spark_workspace_undo_mode",
            sql`action_result::json->>'mode'`,
          );
          s.defScalar(
            "spark_workspace_undo_item_id",
            sql`try_cast(action_result::json->>'item_id' as bigint)`,
          );
          s.defScalar(
            "spark_workspace_undo_new_version_id",
            sql`try_cast(action_result::json->>'new_version_id' as bigint)`,
          );
          s.if(
            sql`not exists (
              select 1
              from db.file_items item
              where item.id = spark_workspace_undo_item_id
                and item.file_space_id = spark_workspace_action_space_id
                and item.current_file_version_id = spark_workspace_undo_new_version_id
                and coalesce(cast(item.parent_file_item_id as string), '') =
                  coalesce(action_result::json->>'parent_id', '')
                and item.name = action_result::json->>'name'
                and item.trashed_at is null
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`The behavior file changed after this action and cannot be undone.`,
              ),
          );
          s.if(sql`spark_workspace_undo_mode = 'created'`, (s) => {
            s.modify(sql`
              update db.file_items
              set trashed_at = now(),
                  trashed_by_user_id = action_sys_user_id
              where id = spark_workspace_undo_item_id
                and file_space_id = spark_workspace_action_space_id
                and current_file_version_id = spark_workspace_undo_new_version_id
                and trashed_at is null
            `);
          });
          s.if(sql`spark_workspace_undo_mode = 'updated'`, (s) => {
            s.defScalar(
              "spark_workspace_undo_old_version_id",
              sql`try_cast(action_result::json->>'old_version_id' as bigint)`,
            );
            s.defScalar(
              "spark_workspace_undo_old_content",
              sql`(select content
                from db.markdown_file_versions
                where file_version_id = spark_workspace_undo_old_version_id)`,
            );
            s.if(
              sql`spark_workspace_undo_old_content is null`,
              (s) =>
                s.throwError(
                  sql.lit`The previous behavior file version is unavailable.`,
                ),
            );
            workspace.type.markdown.saveDocument(s, {
              fileItemId: sql`spark_workspace_undo_item_id`,
              content: sql`spark_workspace_undo_old_content`,
              note: sql.lit`Undo Spark behavior change`,
              sysUserId: sql`action_sys_user_id`,
              intoVersion: "spark_workspace_undo_instruction_version_id",
            });
          });
        },
      },
      {
        name: "rename_item",
        description:
          "Rename a workspace file or folder. High-risk because reserved paths can change behavior.",
        danger: "high",
        inputType: "{ path: string; new_name: string }",
        approvalUi: ({ input }) => (
          <SparkWorkspacePathApproval
            title="Rename workspace item"
            input={input}
            detail="new_name"
            highRisk
          />
        ),
        procedure: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          prepareSparkWorkspacePath(s, workspace, sql`action_input->>'path'`, {
            resolveTarget: false,
          });
          s.defScalar(
            "spark_workspace_rename_item_id",
            sparkWorkspaceItemIdExpr(
              workspace,
              sql`spark_workspace_action_path`,
            ),
          );
          s.if(
            sql`spark_workspace_rename_item_id is null`,
            (s) => s.throwError(sql.lit`The workspace item is unavailable.`),
          );
          s.defRecord(
            "spark_workspace_rename_old",
            sql`select name, description
              from db.file_items
              where id = spark_workspace_rename_item_id`,
          );
          s.defScalar(
            "spark_workspace_rename_new_name",
            sql`trim(coalesce(action_input->>'new_name', ''))`,
          );
          s.if(
            sql`spark_workspace_rename_new_name = ''`,
            (s) => s.throwError(sql.lit`new_name is required.`),
          );
          workspace.drive.updateItemMetadata(s, {
            spaceId: sql`spark_workspace_action_space_id`,
            itemId: sql`spark_workspace_rename_item_id`,
            name: sql`spark_workspace_rename_new_name`,
            description: sql`spark_workspace_rename_old.description`,
            sysUserId: sql`action_sys_user_id`,
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'item_id', spark_workspace_rename_item_id,
              'old_name', spark_workspace_rename_old.name,
              'parent_id', (select parent_file_item_id
                from db.file_items
                where id = spark_workspace_rename_item_id)
            )::string`,
          );
        },
        undo: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          s.defScalar(
            "spark_workspace_undo_item_id",
            sql`try_cast(action_result::json->>'item_id' as bigint)`,
          );
          s.defRecord(
            "spark_workspace_undo_rename_item",
            sql`select name, description
              from db.file_items
              where id = spark_workspace_undo_item_id
                and file_space_id = spark_workspace_action_space_id
                and trashed_at is null`,
          );
          s.if(
            sql`spark_workspace_undo_rename_item.name is null
              or spark_workspace_undo_rename_item.name <>
                trim(action_input->>'new_name') collate nocase
              or coalesce(cast((select parent_file_item_id
                from db.file_items
                where id = spark_workspace_undo_item_id) as string), '') <>
                coalesce(action_result::json->>'parent_id', '')`,
            (s) =>
              s.throwError(
                sql
                  .lit`The item was renamed again after this action and cannot be undone.`,
              ),
          );
          workspace.drive.updateItemMetadata(s, {
            spaceId: sql`spark_workspace_action_space_id`,
            itemId: sql`spark_workspace_undo_item_id`,
            name: sql`action_result::json->>'old_name'`,
            description: sql`spark_workspace_undo_rename_item.description`,
            sysUserId: sql`action_sys_user_id`,
          });
        },
      },
      {
        name: "move_item",
        description:
          "Move a workspace file or folder to an existing destination folder. High-risk because paths can change behavior.",
        danger: "high",
        inputType: "{ path: string; destination_folder: string }",
        approvalUi: ({ input }) => (
          <SparkWorkspacePathApproval
            title="Move workspace item"
            input={input}
            detail="destination_folder"
            highRisk
          />
        ),
        procedure: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          prepareSparkWorkspacePath(s, workspace, sql`action_input->>'path'`, {
            resolveTarget: false,
          });
          s.defScalar(
            "spark_workspace_move_item_id",
            sparkWorkspaceItemIdExpr(
              workspace,
              sql`spark_workspace_action_path`,
            ),
          );
          s.if(
            sql`spark_workspace_move_item_id is null`,
            (s) => s.throwError(sql.lit`The workspace item is unavailable.`),
          );
          s.defScalar(
            "spark_workspace_move_destination_path",
            sql`trim(coalesce(action_input->>'destination_folder', ''))`,
          );
          s.if(
            sql`
              spark_workspace_move_destination_path like '/%'
              or spark_workspace_move_destination_path like '%/'
              or spark_workspace_move_destination_path like '%//%'
              or spark_workspace_move_destination_path = '.'
              or spark_workspace_move_destination_path = '..'
              or spark_workspace_move_destination_path like './%'
              or spark_workspace_move_destination_path like '../%'
              or spark_workspace_move_destination_path like '%/./%'
              or spark_workspace_move_destination_path like '%/../%'
              or spark_workspace_move_destination_path like '%/.'
              or spark_workspace_move_destination_path like '%/..'
              or position(chr(92) in spark_workspace_move_destination_path) > 0
              or position(chr(10) in spark_workspace_move_destination_path) > 0
              or position(chr(13) in spark_workspace_move_destination_path) > 0
            `,
            (s) =>
              s.throwError(
                sql
                  .lit`Use a valid workspace-relative destination folder path.`,
              ),
          );
          s.defScalar(
            "spark_workspace_move_destination_id",
            sql`case
              when spark_workspace_move_destination_path = '' then null::bigint
              else ${
              sparkWorkspaceItemIdExpr(
                workspace,
                sql`spark_workspace_move_destination_path`,
                "folder",
              )
            }
            end`,
          );
          s.if(
            sql`spark_workspace_move_destination_path <> ''
              and spark_workspace_move_destination_id is null`,
            (s) =>
              s.throwError(
                sql.lit`The destination workspace folder is unavailable.`,
              ),
          );
          s.defScalar(
            "spark_workspace_move_old_parent_id",
            sql`(select parent_file_item_id
              from db.file_items
              where id = spark_workspace_move_item_id)`,
          );
          s.if(
            sql`coalesce(cast(spark_workspace_move_old_parent_id as string), '') =
              coalesce(cast(spark_workspace_move_destination_id as string), '')`,
            (s) => s.throwError(sql.lit`The item is already in that folder.`),
          );
          workspace.drive.moveItem(s, {
            spaceId: sql`spark_workspace_action_space_id`,
            itemId: sql`spark_workspace_move_item_id`,
            destinationParentItemId: sql`spark_workspace_move_destination_id`,
            sysUserId: sql`action_sys_user_id`,
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'item_id', spark_workspace_move_item_id,
              'old_parent_id', spark_workspace_move_old_parent_id,
              'new_parent_id', spark_workspace_move_destination_id,
              'name', (select name
                from db.file_items
                where id = spark_workspace_move_item_id)
            )::string`,
          );
        },
        undo: (s) => {
          prepareSparkWorkspaceAction(s, workspace);
          s.defScalar(
            "spark_workspace_undo_item_id",
            sql`try_cast(action_result::json->>'item_id' as bigint)`,
          );
          s.defScalar(
            "spark_workspace_undo_old_parent_id",
            sql`try_cast(action_result::json->>'old_parent_id' as bigint)`,
          );
          s.defScalar(
            "spark_workspace_undo_new_parent_id",
            sql`try_cast(action_result::json->>'new_parent_id' as bigint)`,
          );
          s.if(
            sql`not exists (
              select 1
              from db.file_items item
              where item.id = spark_workspace_undo_item_id
                and item.file_space_id = spark_workspace_action_space_id
                and item.trashed_at is null
                and coalesce(cast(item.parent_file_item_id as string), '') =
                  coalesce(cast(spark_workspace_undo_new_parent_id as string), '')
                and item.name = action_result::json->>'name'
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`The item moved again after this action and cannot be undone.`,
              ),
          );
          workspace.drive.moveItem(s, {
            spaceId: sql`spark_workspace_action_space_id`,
            itemId: sql`spark_workspace_undo_item_id`,
            destinationParentItemId: sql`spark_workspace_undo_old_parent_id`,
            sysUserId: sql`action_sys_user_id`,
          });
        },
      },
    ],
  };
}

//
// Built-in Documents capability
//

// Guidance for the built-in `documents` capability. The company-document
// index and loadDocument() are available when the optional controlled library
// is configured; this capability adds draft-proposing actions and their ground
// rules.
const SPARK_DOCUMENTS_CAPABILITY_DOC = `Company documents are governed content:
authored, reviewed, and published through the controlled Drive. You can propose
changes, but nothing you do publishes anything — every change becomes a DRAFT
that a human reviews and publishes through the normal controlled-file workflow.

- Read before editing: always loadDocument(id) first and base your edit on the
  CURRENT content. \`documents.edit_document\` replaces the whole document —
  send the complete new markdown, not a fragment or diff.
- Only native documents (mode "document" in the index) can be edited; uploaded
  files such as PDFs are read-only.
- After proposing, tell the user a draft was created for review — never say
  the document was updated or published.
- \`documents.update_document_metadata\` (title/description) is the one
  exception to drafting: metadata has no draft stage, so it applies when the
  approver accepts it (and is undoable). Say "updated on approval", never
  "already updated".`;

// The built-in `documents` capability: draft-proposing actions over governed
// Drive files. Spark never publishes — edit_document / create_document
// produce drafts that flow through the controlled review/publish workflow, so
// approval here gates draft creation only. Execution runs in the action
// reactor with no request user; the Drive methods authorize against the
// conversation owner (`action_sys_user_id`), so ownerless runs cannot write.
function buildSparkDocumentsCapability(
  knowledge: SparkDriveKnowledge,
): SparkCapability {
  const preferredLanguage = sql.lit(
    knowledge.control.opts.defaultLanguage,
  );
  return {
    name: "documents",
    label: "Documents",
    description:
      "Propose edits to governed company documents as drafts for review",
    doc: SPARK_DOCUMENTS_CAPABILITY_DOC,
    actions: [
      {
        name: "edit_document",
        description:
          "Propose a full-content replacement of a native company document. " +
          "Creates a DRAFT revision for human review — nothing is published.",
        danger: "low",
        inputType:
          "{ document_id: number; markdown: string; change_summary: string }",
        approvalUi: ({ input }) => (
          <Data
            procedure={(s) => {
              s.defScalar(
                "doc_edit_prev_id",
                sql`try_cast(${input}->>'document_id' as bigint)`,
              );
              // Gate every read on the VIEWER's document access — the card
              // must not disclose a restricted document's title or content
              // when the agent proposes an id the approver cannot read.
              s.defScalar(
                "doc_edit_prev_readable",
                sql`doc_edit_prev_id is not null and ${
                  canReadSparkKnowledgeFile(
                    knowledge,
                    sql`current_user`,
                    sql`doc_edit_prev_id`,
                  )
                }`,
              );
              s.defScalar(
                "doc_edit_prev_title",
                sql`case when doc_edit_prev_readable then
                  (select name from db.file_items
                    where id = doc_edit_prev_id) end`,
              );
              // Diff the CURRENT published markdown against the proposal so
              // the approver reviews the change, not the whole document. Two-
              // way diff via the three-way analyzer (base = left = current):
              // every hunk in the `unified` output's second section is a
              // proposed change.
              s.defScalar(
                "doc_edit_prev_old_md",
                sql`case when doc_edit_prev_readable then
                  (select lexical_rich_text_to_markdown(rich_content)
                  from db.native_document_file_versions
                  where file_version_id = ${
                  sparkPublishedFileVersionId(
                    knowledge,
                    sql`doc_edit_prev_id`,
                  )
                }) end`,
              );
              s.defScalar(
                "doc_edit_prev_diff",
                sql`case when doc_edit_prev_old_md is not null then
                  split_part(
                    string.diff3_analyze(doc_edit_prev_old_md,
                      doc_edit_prev_old_md,
                      coalesce(${input}->>'markdown', ''))->>'unified',
                    '--- base' || chr(10) || '+++ v2' || chr(10), 2)
                end`,
              );
              s.defTable(
                "doc_edit_prev_diff_lines",
                sql`select value as line, ordinal
                  from string.split(coalesce(doc_edit_prev_diff, ''), chr(10))
                  where value != ''
                  order by ordinal`,
              );
              s.defScalar(
                "doc_edit_prev_added",
                sql`(select count(*) from doc_edit_prev_diff_lines
                  where left(line, 1) = '+')`,
              );
              s.defScalar(
                "doc_edit_prev_removed",
                sql`(select count(*) from doc_edit_prev_diff_lines
                  where left(line, 1) = '-')`,
              );
            }}
          >
            <div
              sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 1,
                fontSize: "0.85rem",
              }}
            >
              <span sx={{ fontWeight: 600 }}>
                {sql`'Draft edit: ' || coalesce(doc_edit_prev_title,
                  '(unknown document #'
                    || coalesce(doc_edit_prev_id::string, '?') || ')')`}
              </span>
              <Show when={sql`doc_edit_prev_diff is not null`}>
                <span
                  sx={{
                    fontSize: "0.72rem",
                    fontFamily:
                      "ui-monospace, Menlo, Monaco, Consolas, monospace",
                  }}
                >
                  <span sx={{ color: "var(--palette-success-700)" }}>
                    {sql`'+' || doc_edit_prev_added::string`}
                  </span>{" "}
                  <span sx={{ color: "var(--palette-danger-700)" }}>
                    {sql`'−' || doc_edit_prev_removed::string`}
                  </span>
                </span>
              </Show>
            </div>
            <div
              sx={{
                fontSize: "0.75rem",
                color: "var(--palette-text-secondary)",
              }}
            >
              {sql`coalesce(${input}->>'change_summary', '')`}
            </div>
            <Show
              when={sql`doc_edit_prev_diff is not null
                and doc_edit_prev_added + doc_edit_prev_removed > 0`}
            >
              <div
                sx={{
                  maxHeight: "300px",
                  overflowY: "auto",
                  border: "1px solid var(--palette-divider)",
                  borderRadius: "6px",
                  mt: 0.5,
                  fontFamily:
                    "ui-monospace, Menlo, Monaco, Consolas, monospace",
                  fontSize: "0.74rem",
                  lineHeight: 1.5,
                }}
              >
                <Each table="doc_edit_prev_diff_lines" recordName="dl">
                  <Show when={sql`left(dl.line, 1) = '+'`}>
                    <div
                      sx={{
                        whiteSpace: "pre-wrap",
                        px: 1,
                        backgroundColor: "var(--palette-success-softBg)",
                      }}
                    >
                      {sql`dl.line`}
                    </div>
                  </Show>
                  <Show when={sql`left(dl.line, 1) = '-'`}>
                    <div
                      sx={{
                        whiteSpace: "pre-wrap",
                        px: 1,
                        backgroundColor: "var(--palette-danger-softBg)",
                        color: "var(--palette-text-tertiary)",
                        textDecoration: "line-through",
                      }}
                    >
                      {sql`dl.line`}
                    </div>
                  </Show>
                  <Show
                    when={sql`left(dl.line, 1) not in ('+', '-')`}
                  >
                    <div
                      sx={{
                        whiteSpace: "pre-wrap",
                        px: 1,
                        color: "var(--palette-text-tertiary)",
                      }}
                    >
                      {sql`dl.line`}
                    </div>
                  </Show>
                </Each>
              </div>
            </Show>
            <Show
              when={sql`doc_edit_prev_diff is not null
                and doc_edit_prev_added + doc_edit_prev_removed = 0`}
            >
              <div
                sx={{
                  fontSize: "0.75rem",
                  color: "var(--palette-text-tertiary)",
                  mt: 0.5,
                }}
              >
                No content changes — the proposed markdown matches the current
                document.
              </div>
            </Show>
            <Show when={sql`doc_edit_prev_diff is null`}>
              <div
                sx={{
                  maxHeight: "260px",
                  overflowY: "auto",
                  border: "1px solid var(--palette-divider)",
                  borderRadius: "6px",
                  padding: 1,
                  mt: 0.5,
                }}
              >
                <MarkdownDisplay
                  content={sql`coalesce(${input}->>'markdown', '')`}
                  sx={styles.markdownBody}
                />
              </div>
            </Show>
            <div
              sx={{
                fontSize: "0.72rem",
                color: "var(--palette-text-tertiary)",
                mt: 0.25,
              }}
            >
              Creates a draft for review — publishing still happens in
              Documents.
            </div>
          </Data>
        ),
        procedure: (s) => {
          s.if(
            sql`action_sys_user_id is null`,
            (s) =>
              s.throwError(
                sql.lit`Editing documents requires a conversation owner.`,
              ),
          );
          s.defScalar(
            "doc_edit_document_id",
            sql`try_cast(action_input->>'document_id' as bigint)`,
          );
          s.defScalar(
            "doc_edit_markdown",
            sql`nullif(action_input->>'markdown', '')`,
          );
          s.if(
            sql`doc_edit_document_id is null or doc_edit_markdown is null`,
            (s) =>
              s.throwError(sql.lit`document_id and markdown are required.`),
          );
          s.defScalar(
            "doc_edit_source_version_id",
            sparkPublishedFileVersionId(
              knowledge,
              sql`doc_edit_document_id`,
            ),
          );
          s.if(
            sql`doc_edit_source_version_id is null`,
            (s) =>
              s.throwError(
                sql.lit`This document has no published version to revise.`,
              ),
          );
          s.if(
            sql`not exists (
              select 1
              from db.native_document_file_versions
              where file_version_id = doc_edit_source_version_id
            )`,
            (s) =>
              s.throwError(
                sql
                  .lit`Only native documents can be edited; PDFs and external links are read-only.`,
              ),
          );
          s.defScalar(
            "doc_edit_label",
            sql`'Spark edit ' || substr(cast(now() as string), 1, 10)`,
          );
          knowledge.control.createRevision(s, {
            fileItemId: sql`doc_edit_document_id`,
            language: preferredLanguage,
            revisionLabel: sql`doc_edit_label`,
            effectiveOn: sql`current_date()`,
            changeSummary: sql`action_input->>'change_summary'`,
            actingUser: sql`action_sys_user_id`,
            into: "doc_edit_revision_id",
          });
          knowledge.nativeDocuments.saveDocument(s, {
            fileItemId: sql`doc_edit_document_id`,
            content: sql`lexical_from_markdown(doc_edit_markdown)`,
            sysUserId: sql`action_sys_user_id`,
            note: sql`action_input->>'change_summary'`,
            intoVersion: "doc_edit_version_id",
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'revision_id', doc_edit_revision_id,
              'file_version_id', doc_edit_version_id,
              'source_file_version_id', doc_edit_source_version_id
            )::string`,
          );
        },
        undo: (s) => {
          s.defScalar(
            "doc_edit_document_id",
            sql`try_cast(action_input->>'document_id' as bigint)`,
          );
          s.defScalar(
            "doc_edit_undo_revision_id",
            sql`try_cast(action_result::json->>'revision_id' as bigint)`,
          );
          s.defScalar(
            "doc_edit_undo_version_id",
            sql`try_cast(action_result::json->>'file_version_id' as bigint)`,
          );
          s.defScalar(
            "doc_edit_undo_source_version_id",
            sql`try_cast(
              action_result::json->>'source_file_version_id' as bigint
            )`,
          );
          s.if(
            sql`
              not exists (
                select 1
                from db.controlled_file_revisions revision
                where revision.id = doc_edit_undo_revision_id
                  and revision.status = 'draft'
                  and revision.initiated_by_actor_id =
                    ${
              knowledge.control.opts.actor.actorIdForSysUserId(
                sql`action_sys_user_id`,
              )
            }
              )
            `,
            (s) =>
              s.throwError(
                sql.lit`Only your open draft can be discarded.`,
              ),
          );
          s.modify(sql`
            delete from db.controlled_file_revision_file_versions
            where controlled_file_revision_id = doc_edit_undo_revision_id
          `);
          s.modify(sql`
            delete from db.controlled_file_revisions
            where id = doc_edit_undo_revision_id
          `);
          s.modify(sql`
            update db.file_items
            set current_file_version_id = doc_edit_undo_source_version_id
            where id = doc_edit_document_id
              and current_file_version_id = doc_edit_undo_version_id
          `);
          s.modify(sql`
            delete from db.file_versions
            where id = doc_edit_undo_version_id
              and not exists (
                select 1
                from db.file_items item
                where item.current_file_version_id =
                  doc_edit_undo_version_id
              )
          `);
        },
      },
      {
        name: "create_document",
        description:
          "Create a new native company document as a DRAFT for human review — " +
          "nothing is published.",
        danger: "low",
        inputType: "{ title: string; markdown: string; description?: string }",
        approvalUi: ({ input }) => (
          <Data
            procedure={(s) => {
              s.defScalar(
                "doc_create_prev_title",
                sql`coalesce(${input}->>'title', '(untitled)')`,
              );
            }}
          >
            <div sx={{ fontWeight: 600, fontSize: "0.85rem" }}>
              {sql`'Draft new document: ' || doc_create_prev_title`}
            </div>
            <div
              sx={{
                fontSize: "0.75rem",
                color: "var(--palette-text-secondary)",
              }}
            >
              {sql`coalesce(${input}->>'description', '')`}
            </div>
            <div
              sx={{
                maxHeight: "260px",
                overflowY: "auto",
                border: "1px solid var(--palette-divider)",
                borderRadius: "6px",
                padding: 1,
                mt: 0.5,
              }}
            >
              <MarkdownDisplay
                content={sql`coalesce(${input}->>'markdown', '')`}
                sx={styles.markdownBody}
              />
            </div>
            <div
              sx={{
                fontSize: "0.72rem",
                color: "var(--palette-text-tertiary)",
                mt: 0.25,
              }}
            >
              Creates a draft for review — publishing still happens in
              Documents.
            </div>
          </Data>
        ),
        procedure: (s) => {
          s.if(
            sql`action_sys_user_id is null`,
            (s) =>
              s.throwError(
                sql.lit`Creating documents requires a conversation owner.`,
              ),
          );
          s.defScalar(
            "doc_create_title",
            sql`nullif(trim(coalesce(action_input->>'title', '')), '')`,
          );
          s.defScalar(
            "doc_create_markdown",
            sql`nullif(action_input->>'markdown', '')`,
          );
          s.if(
            sql`doc_create_title is null or doc_create_markdown is null`,
            (s) => s.throwError(sql.lit`title and markdown are required.`),
          );
          knowledge.nativeDocuments.createDocument(s, {
            spaceId: knowledge.createLocation.spaceId,
            parentItemId: knowledge.createLocation.parentItemId,
            name: sql`doc_create_title`,
            description: sql`action_input->>'description'`,
            content: sql`lexical_from_markdown(doc_create_markdown)`,
            sysUserId: sql`action_sys_user_id`,
            intoItem: "doc_create_item_id",
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'document_id', doc_create_item_id)::string`,
          );
        },
      },
      {
        name: "update_document_metadata",
        description:
          "Update a company document's title and/or description. The one " +
          "non-draft action: metadata has no draft stage, so it applies when " +
          "approved (undoable).",
        danger: "low",
        // Metadata changes are live on approval, so gate proposals on the
        // documents manage permission rather than the propose permission.
        permission: "can_manage_controlled_files",
        inputType:
          "{ document_id: number; title?: string; description?: string }",
        approvalUi: ({ input }) => (
          <Data
            procedure={(s) => {
              s.defScalar(
                "doc_meta_prev_id",
                sql`try_cast(${input}->>'document_id' as bigint)`,
              );
              // Only show the current title/description when the VIEWER can
              // read the document — no restricted-metadata disclosure.
              s.defRecord(
                "doc_meta_prev",
                sql`select name as title, description from db.file_items
                  where id = doc_meta_prev_id
                    and ${
                  canReadSparkKnowledgeFile(
                    knowledge,
                    sql`current_user`,
                    sql`doc_meta_prev_id`,
                  )
                }`,
              );
              s.defScalar(
                "doc_meta_prev_new_title",
                sql`nullif(trim(coalesce(${input}->>'title', '')), '')`,
              );
              s.defScalar(
                "doc_meta_prev_has_desc",
                sql`json_typeof(${input}->'description') = 'string'`,
              );
            }}
          >
            <div sx={{ fontWeight: 600, fontSize: "0.85rem" }}>
              {sql`'Update metadata: ' || coalesce(doc_meta_prev.title,
                '(unknown document #'
                  || coalesce(doc_meta_prev_id::string, '?') || ')')`}
            </div>
            <Show when={sql`doc_meta_prev_new_title is not null`}>
              <div sx={{ fontSize: "0.78rem" }}>
                {sql`'Title: ' || coalesce(doc_meta_prev.title, '(none)')
                  || ' → ' || doc_meta_prev_new_title`}
              </div>
            </Show>
            <Show when={sql`doc_meta_prev_has_desc`}>
              <div sx={{ fontSize: "0.78rem" }}>
                {sql`'Description: ' || coalesce(doc_meta_prev.description,
                  '(none)') || ' → ' ||
                  coalesce(nullif(trim(${input}->>'description'), ''),
                    '(cleared)')`}
              </div>
            </Show>
            <div
              sx={{
                fontSize: "0.72rem",
                color: "var(--palette-text-tertiary)",
                mt: 0.25,
              }}
            >
              Applies when approved (no draft stage for metadata); undoable.
            </div>
          </Data>
        ),
        procedure: (s) => {
          s.if(
            sql`action_sys_user_id is null`,
            (s) =>
              s.throwError(
                sql.lit`Updating documents requires a conversation owner.`,
              ),
          );
          s.defScalar(
            "doc_meta_document_id",
            sql`try_cast(action_input->>'document_id' as bigint)`,
          );
          s.if(
            sql`doc_meta_document_id is null`,
            (s) => s.throwError(sql.lit`document_id is required.`),
          );
          s.defScalar(
            "doc_meta_new_title",
            sql`nullif(trim(coalesce(action_input->>'title', '')), '')`,
          );
          s.defScalar(
            "doc_meta_has_desc",
            sql`json_typeof(action_input->'description') = 'string'`,
          );
          s.if(
            sql`doc_meta_new_title is null and not doc_meta_has_desc`,
            (s) =>
              s.throwError(
                sql.lit`Provide a new title and/or description.`,
              ),
          );
          s.defRecord(
            "doc_meta_old",
            sql`select name as title, description, file_space_id
              from db.file_items
              where id = doc_meta_document_id
                and item_kind = 'file'
                and trashed_at is null`,
          );
          s.if(
            sql`doc_meta_old.title is null`,
            (s) =>
              s.throwError(
                sql`'No document with id ' ||
                    coalesce(doc_meta_document_id::string, '(none)') || '.'`,
              ),
          );
          knowledge.files.updateItemMetadata(s, {
            spaceId: sql`doc_meta_old.file_space_id`,
            itemId: sql`doc_meta_document_id`,
            name: sql`coalesce(doc_meta_new_title, doc_meta_old.title)`,
            description: sql`case when doc_meta_has_desc
              then action_input->>'description'
              else doc_meta_old.description end`,
            sysUserId: sql`action_sys_user_id`,
          });
          s.setScalar(
            "action_result",
            sql`json_build_object(
              'old_title', doc_meta_old.title,
              'old_description', doc_meta_old.description)::string`,
          );
        },
        undo: (s) => {
          s.defScalar(
            "doc_meta_undo_document_id",
            sql`try_cast(action_input->>'document_id' as bigint)`,
          );
          s.defScalar(
            "doc_meta_undo_space_id",
            sql`(
              select file_space_id
              from db.file_items
              where id = doc_meta_undo_document_id
            )`,
          );
          knowledge.files.updateItemMetadata(s, {
            spaceId: sql`doc_meta_undo_space_id`,
            itemId: sql`doc_meta_undo_document_id`,
            name: sql`action_result::json->>'old_title'`,
            description: sql`action_result::json->>'old_description'`,
            sysUserId: sql`action_sys_user_id`,
          });
        },
      },
    ],
  };
}

//
// Built-in login-activity capability
//

// Login/session visibility for admins: who logged in when, and failed
// sign-in attempts. Deliberately excludes session token values (public_id),
// password/2FA material, ip_address/user_agent, and the platform's
// transaction/version history — none of that is queryable through Spark.
function buildAuthActivityCapability(
  adminPermission: string,
): SparkCapability {
  return {
    name: "auth_activity",
    label: "Login activity",
    description:
      "Login/session activity: who logged in when, plus failed sign-in attempts",
    permission: adminPermission,
    fieldWhitelist: [
      {
        table: "auth_session_tokens",
        fields: ["id", "sys_user_id", "issued"],
      },
      {
        table: "auth_login_failures",
        fields: [
          "id",
          "identifier",
          "sys_user_id",
          "attempted_at",
          "failure_reason",
          "auth_type",
        ],
      },
      {
        table: "sys_users",
        fields: ["id", "disabled", "created_at"],
      },
    ],
    doc:
      `One auth_session_tokens row = one successful login (\`issued\` = when).
"Has X logged in today?" = a session token issued today for X's sys_user id —
resolve people to sys_user ids through the tables your other capabilities
grant. auth_login_failures records failed attempts (\`identifier\` is what was
typed; \`sys_user_id\` is null when it matched no account). Session token
values, IPs, and user agents are not readable.`,
  };
}

//
// Block definition
//

export class SparkBlock implements Block {
  /** Permissions to include in the owning AuthBlock. */
  static readonly mcpPermissions = [
    {
      name: "can_connect_mcp_read",
      displayName: "Connect read-only MCP assistants",
      group: "MCP",
    },
    {
      name: "can_connect_mcp_act",
      displayName: "Connect MCP assistants that perform actions",
      group: "MCP",
    },
  ];
  blockName = "SparkBlock";
  componentDependencies: string[] = [];
  description: string | undefined;

  opts: SparkBlockOpts;
  #capabilities: SparkCapability[];

  /** Registered capability definitions, also used by saved dashboards. */
  get capabilities(): readonly SparkCapability[] {
    return this.#capabilities;
  }

  constructor(opts: SparkBlockOpts) {
    if (!opts) {
      throw new Error(
        "SparkBlock requires an options object with a Drive-backed workspace.",
      );
    }
    if (!opts.workspace) {
      throw new Error(
        "SparkBlock requires its dedicated Drive `workspace`.",
      );
    }
    if (
      !opts.workspace.drive.spaceTypes.includes(
        opts.workspace.type.spaceType,
      )
    ) {
      throw new Error(
        "Spark workspace spaceType must be registered on its DriveBlock.",
      );
    }
    if (
      !opts.workspace.type.spaceType.extensions.includes(
        opts.workspace.type.markdown,
      )
    ) {
      throw new Error(
        "Spark workspace must install its Markdown document extension.",
      );
    }
    if (opts.workspace.type.spaceType.lifecycle) {
      throw new Error(
        "Spark's own workspace must not use a controlled file lifecycle.",
      );
    }
    this.opts = opts;
    this.#capabilities = [...opts.capabilities];
    registeredSparkDefaultReasoningEffort = opts.defaultReasoningEffort ??
      "low";
    if (opts.controlledDocuments) {
      this.#capabilities.push(
        buildSparkDocumentsCapability(opts.controlledDocuments),
      );
    }
    this.#capabilities.push(
      buildSparkWorkspaceCapability(
        opts.workspace,
        opts.adminPermission ?? defaultSparkAdminPermission,
      ),
    );
    // Built-in capability: login/session visibility for Spark admins.
    this.#capabilities.push(
      buildAuthActivityCapability(
        opts.adminPermission ?? defaultSparkAdminPermission,
      ),
    );
  }

  populate() {
    // Validate every capability's whitelist against the actual schema at build
    // time. Otherwise a typo'd table/field is caught only at runtime by the
    // dynamic-query validator, which rejects the ENTIRE merged whitelist — so
    // one bad field silently breaks every query in any conversation that holds
    // that capability (the docket_documents.order_case_id class of bug).
    const capabilityNames = new Set<string>();
    const fileSourceNames = new Set<string>();
    for (const cap of this.#capabilities) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cap.name)) {
        throw new Error(
          `Spark capability name "${cap.name}" must be a valid JavaScript identifier.`,
        );
      }
      if (capabilityNames.has(cap.name)) {
        throw new Error(
          `Spark capability "${cap.name}" is registered more than once.`,
        );
      }
      capabilityNames.add(cap.name);
      const operationNames = new Set<string>();
      for (
        const operation of [...(cap.actions ?? []), ...(cap.functions ?? [])]
      ) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(operation.name)) {
          throw new Error(
            `Spark capability "${cap.name}" operation "${operation.name}" ` +
              "must be a valid JavaScript identifier.",
          );
        }
        if (operationNames.has(operation.name)) {
          throw new Error(
            `Spark capability "${cap.name}" registers operation ` +
              `"${operation.name}" more than once.`,
          );
        }
        operationNames.add(operation.name);
      }
      for (const action of cap.actions ?? []) {
        if (action.mode === "reversible" && !action.procedure) {
          throw new Error(
            `Spark capability "${cap.name}" action "${action.name}" ` +
              "must define a procedure when mode is reversible.",
          );
        }
        if (action.mode === "reversible" && action.approvalUi) {
          throw new Error(
            `Spark capability "${cap.name}" action "${action.name}" ` +
              "cannot define approvalUi when mode is reversible.",
          );
        }
        if (action.mode !== "reversible" && action.preflight) {
          throw new Error(
            `Spark capability "${cap.name}" action "${action.name}" ` +
              "can define preflight only when mode is reversible.",
          );
        }
      }
      for (const fw of cap.fieldWhitelist ?? []) {
        const table = system.db.tables[fw.table];
        if (!table) {
          throw new Error(
            `Spark capability "${cap.name}": fieldWhitelist references table ` +
              `"${fw.table}" which does not exist.`,
          );
        }
        const cols = new Set<string>([
          table.primaryKeyFieldName,
          ...Object.values(table.fields).map((f) => f.name),
        ]);
        // Virtual columns are NOT allowed: the runtime dynamic-query
        // fieldWhitelist rejects them as "unknown field", and because the
        // whitelist is rebuilt per query, ONE virtual entry breaks every
        // query() in any conversation holding the capability. Fail at check
        // time instead.
        const virtuals = new Set<string>(
          Object.values(table.virtuals).map((v) => v.name),
        );
        for (const field of fw.fields) {
          if (virtuals.has(field)) {
            throw new Error(
              `Spark capability "${cap.name}": fieldWhitelist field ` +
                `"${fw.table}.${field}" is a virtual column, which the ` +
                `runtime query whitelist does not support. Whitelist the ` +
                `underlying real columns instead.`,
            );
          }
          if (!cols.has(field)) {
            throw new Error(
              `Spark capability "${cap.name}": fieldWhitelist field ` +
                `"${fw.table}.${field}" does not exist on table "${fw.table}".`,
            );
          }
        }
      }
      for (const t of cap.tables ?? []) {
        if (!system.db.tables[t]) {
          throw new Error(
            `Spark capability "${cap.name}": table "${t}" does not exist.`,
          );
        }
      }
      for (const v of cap.views ?? []) {
        if (!system.db.views[v]) {
          throw new Error(
            `Spark capability "${cap.name}": view "${v}" does not exist.`,
          );
        }
      }
      // fileSources drive the runtime readFileImage() SQL select — a typo'd
      // table or column is otherwise silent until an agent reads a file.
      for (const fs of cap.fileSources ?? []) {
        if (fileSourceNames.has(fs.name)) {
          throw new Error(
            `Spark file source "${fs.name}" is registered more than once.`,
          );
        }
        fileSourceNames.add(fs.name);
        const table = system.db.tables[fs.table];
        const view = system.db.views[fs.table];
        if (!table && !view) {
          throw new Error(
            `Spark capability "${cap.name}": fileSource "${fs.name}" ` +
              `references relation "${fs.table}" which does not exist.`,
          );
        }
        if (
          !(cap.tables ?? []).includes(fs.table) &&
          !(cap.views ?? []).includes(fs.table)
        ) {
          throw new Error(
            `Spark capability "${cap.name}": fileSource "${fs.name}" relation ` +
              `"${fs.table}" must also be listed in this capability's tables or views.`,
          );
        }
        if (fs.lookup) continue;
        if (!table) {
          throw new Error(
            `Spark capability "${cap.name}": fileSource "${fs.name}" ` +
              "requires lookup when its discovery relation is a view.",
          );
        }
        if (!fs.blobColumn || !fs.mimeColumn) {
          throw new Error(
            `Spark capability "${cap.name}": fileSource "${fs.name}" ` +
              "requires blobColumn and mimeColumn when lookup is omitted.",
          );
        }
        const cols = new Set<string>([
          table.primaryKeyFieldName,
          ...Object.values(table.fields).map((f) => f.name),
          ...Object.values(table.virtuals).map((v) => v.name),
        ]);
        for (
          const [label, col] of [
            ["blobColumn", fs.blobColumn],
            ["mimeColumn", fs.mimeColumn],
            ["nameColumn", fs.nameColumn],
          ] as const
        ) {
          if (col && !cols.has(col)) {
            throw new Error(
              `Spark capability "${cap.name}": fileSource "${fs.name}" ` +
                `${label} "${col}" does not exist on table "${fs.table}".`,
            );
          }
        }
      }
    }
    registeredMcpEnabled = this.opts.mcp !== false;
    registeredMcpOptions = {
      mcp: registeredMcpEnabled,
      accessPermission: this.opts.accessPermission ??
        defaultSparkAccessPermission,
      capabilities: this.#capabilities,
      workspace: this.opts.workspace,
      knowledge: this.opts.controlledDocuments,
      enableDynamicUi: this.opts.enableDynamicUi ?? true,
      allowedCardJsModules: this.opts.allowedCardJsModules ?? [],
      mockProcedure: this.opts.mockProcedure,
    };
    registerSparkReactors(registeredMcpOptions);
    registeredUserDisplayName = this.opts.userDisplayName;
    registeredSparkAuthenticateDynamicRequest =
      this.opts.authenticateDynamicRequest;
    registeredSparkOnCardEvent = this.opts.onCardEvent;
    registeredSparkAccessPermission = this.opts.accessPermission ??
      defaultSparkAccessPermission;
    registeredSparkAdminPermission = this.opts.adminPermission ??
      defaultSparkAdminPermission;
    registeredSparkWorkspace = this.opts.workspace;
    registeredSparkAccountMenu = this.opts.accountMenu;
    registeredSparkBrand = this.opts.brand;
    // Publish per-skill UI metadata for the static SparkPage / SparkPanel
    // components (they read these module registries rather than receiving
    // props).
    for (const skill of this.#capabilities) {
      registeredCapabilitiesMeta.push({
        name: skill.name,
        description: skill.description,
        label: skill.label,
        permission: skill.permission,
        permissions: skill.permissions,
        internal: skill.internal,
      });
      for (const v of skill.views ?? []) {
        if (!registeredUiViews.includes(v)) registeredUiViews.push(v);
      }
      for (const t of skill.tables ?? []) {
        if (!registeredUiTables.includes(t)) registeredUiTables.push(t);
      }
      for (const fields of skill.fieldWhitelist ?? []) {
        const existing = registeredUiFieldWhitelist.find((item) =>
          item.table === fields.table
        );
        if (!existing) {
          registeredUiFieldWhitelist.push({
            table: fields.table,
            fields: [...fields.fields],
          });
          continue;
        }
        for (const field of fields.fields) {
          if (!existing.fields.includes(field)) existing.fields.push(field);
        }
      }
      for (const a of skill.actions ?? []) {
        if (a.mode === "reversible") {
          registeredReversibleActions.push(`${skill.name}.${a.name}`);
        }
        if (a.mode === "reversible" || a.undo) {
          registeredUndoActions.push(`${skill.name}.${a.name}`);
        }
        if (a.resultUi) {
          registeredResultRenderers.push({
            name: `${skill.name}.${a.name}`,
            render: a.resultUi,
          });
        }
        if (!a.approvalUi) continue;
        registeredActionRenderers.push({
          qualifiedName: `${skill.name}.${a.name}`,
          render: a.approvalUi,
        });
      }
    }
  }

  /**
   * Idempotently creates the reserved Spark workspace tree and initial
   * Markdown versions. Pipelines call this after their users/roles exist.
   */
  seedWorkspace<T extends ServerStatementsBase<any>>(
    s: T,
    opts: SparkWorkspaceSeedOpts,
  ) {
    const text = (value: Sql | string) =>
      typeof value === "string" ? sql.lit(value) : value;
    const drive = this.opts.workspace.drive;
    const typeName = this.opts.workspace.type.spaceType.name;
    const createdByUserId = opts.createdByUserId ??
      sql`(select min(id) from db.sys_users)`;

    s.defScalar(
      "spark_seed_space_id",
      sql`(
        select id from db.file_spaces
        where cast(space_type as string) = ${sql.lit(typeName)}
        order by id limit 1
      )`,
    );
    s.if(sql`spark_seed_space_id is null`, (s) => {
      s.modify(sql`
        insert into db.file_spaces (space_type, name)
        values (${sql.lit(typeName)}, 'Spark')
      `);
      s.setScalar("spark_seed_space_id", sql`last_record_id(db.file_spaces)`);
    });

    const ensureFolder = (
      scalar: string,
      parentId: Sql,
      name: string,
    ) => {
      s.defScalar(
        scalar,
        sql`(
          select id from db.file_items
          where file_space_id = spark_seed_space_id
            and coalesce(cast(parent_file_item_id as string), '') =
              coalesce(cast(${parentId} as string), '')
            and item_kind = 'folder'
            and trashed_at is null
            and name = ${sql.lit(name)}
          order by id limit 1
        )`,
      );
      s.if(sql`${sql.ref(scalar)} is null`, (s) => {
        drive.createFolder(s, {
          spaceId: sql`spark_seed_space_id`,
          parentItemId: parentId,
          name: sql.lit(name),
        });
        s.setScalar(scalar, sql`last_record_id(db.file_items)`);
      });
    };

    const ensureMarkdown = (
      prefix: string,
      parentId: Sql,
      name: string,
      content: Sql,
      description?: Sql,
    ) => {
      const itemScalar = `${prefix}_item_id`;
      s.defScalar(
        itemScalar,
        sql`(
          select id from db.file_items
          where file_space_id = spark_seed_space_id
            and coalesce(cast(parent_file_item_id as string), '') =
              coalesce(cast(${parentId} as string), '')
            and item_kind = 'file'
            and trashed_at is null
            and name = ${sql.lit(name)}
          order by id limit 1
        )`,
      );
      s.if(sql`${sql.ref(itemScalar)} is null`, (s) => {
        drive.createFileItem(s, {
          spaceId: sql`spark_seed_space_id`,
          parentItemId: parentId,
          name: sql.lit(name),
          description,
          into: `${prefix}_created_item_id`,
        });
        s.setScalar(itemScalar, sql.ref(`${prefix}_created_item_id`));
        drive.createFileVersion(s, {
          itemId: sql.ref(itemScalar),
          fileName: sql.lit(name),
          contentType: sql.lit`text/markdown`,
          byteLength: sql`octet_length(string.to_utf8(${content}))`,
          sysUserId: createdByUserId,
          intoVersion: `${prefix}_version_id`,
        });
        s.modify(sql`
          insert into db.markdown_file_versions (file_version_id, content)
          values (${sql.ref(`${prefix}_version_id`)}, ${content})
        `);
      });
    };

    ensureFolder(
      "spark_seed_skills_folder_id",
      sql`null::bigint`,
      "Skills",
    );
    ensureMarkdown(
      "spark_seed_root",
      sql`null::bigint`,
      "AGENTS.md",
      text(opts.instructions),
    );

    for (const [index, skill] of (opts.skills ?? []).entries()) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
        skill.name.length > 64
      ) {
        throw new Error(
          `Spark skill name "${skill.name}" must be lowercase hyphen-case and at most 64 characters.`,
        );
      }
      if (
        skill.description.trim() === "" || skill.description.length > 1024 ||
        skill.description.includes("<") || skill.description.includes(">") ||
        skill.description.includes("\n") || skill.description.includes("\r")
      ) {
        throw new Error(
          `Spark skill "${skill.name}" needs a single-line standard description of at most 1024 characters without angle brackets.`,
        );
      }
      const folderScalar = `spark_seed_skill_${index}_folder_id`;
      ensureFolder(
        folderScalar,
        sql`spark_seed_skills_folder_id`,
        skill.name,
      );
      ensureMarkdown(
        `spark_seed_skill_${index}`,
        sql.ref(folderScalar),
        "SKILL.md",
        sparkSkillDocumentContent({
          name: sql.lit(skill.name),
          description: sql.lit(skill.description),
          instructions: text(skill.instructions),
        }),
      );
    }
  }

  /**
   * Start a spark run by inserting `spark_conversations` + `spark_agents` rows
   * (plus an initial user_message event). The existing `spark_agent_plan`
   * reactor dispatches it — there is no separate scheduler.
   *
   * Callable from any server-side statement builder: UI event handlers, API
   * endpoints, scheduled procedures, and reactors.
   *
   * **Caller must wrap this call in `s.startTransaction()` /
   * `s.commitTransaction()`.** Side effects fan out to three tables; a
   * partial run is meaningless, so atomicity is the caller's responsibility.
   * Sets scalars `spark_start_conversation_id` and `spark_start_agent_id` that
   * the caller can read afterwards.
   */
  start<T extends import("std/statements").IServerBaseStatements>(
    s: T,
    opts: SparkStartOpts,
  ): void {
    const taskExpr = typeof opts.task === "string"
      ? sql.lit(opts.task)
      : opts.task;
    const sysUserIdExpr = opts.sysUserId ?? sql`null::bigint`;
    const labelExpr = opts.label === undefined
      ? sql`null::string`
      : typeof opts.label === "string"
      ? sql.lit(opts.label)
      : opts.label;
    const sourceExpr = opts.source === undefined
      ? sql`null::string`
      : typeof opts.source === "string"
      ? sql.lit(opts.source)
      : opts.source;
    const skillsExpr = sql`${sql.lit(JSON.stringify(opts.capabilities))}::json`;
    const contextExpr = opts.context ?? sql`null::json`;

    // start() runs are autonomous — a null (= "ask") policy would strand the run
    // the moment it asks a question or proposes an action, since no human is
    // present. So omitted policies default to safe autonomous values: proceed on
    // questions and low-danger (undoable) actions, and FAIL — cleanly, not strand
    // and not auto-execute — on high/external actions. A trusted caller can still
    // opt into auto_approve for those explicitly.
    const policy = opts.policy ?? {};
    const policyExpr = (v: string | undefined, dflt: string) =>
      sql.lit(v ?? dflt);
    const questionPolicy = policyExpr(policy.onQuestions, "use_defaults");
    const approvalLowPolicy = policyExpr(policy.onApprovalLow, "auto_approve");
    const approvalHighPolicy = policyExpr(policy.onApprovalHigh, "fail");
    const approvalExternalPolicy = policyExpr(
      policy.onApprovalExternal,
      "fail",
    );

    s.defScalar("spark_start_conversation_id", { type: "BigInt" });
    s.defScalar("spark_start_agent_id", { type: "BigInt" });

    s.modify(sql`
      insert into db.spark_conversations
        (sys_user_id, label, auto_title_pending, source, status, is_paused,
         capabilities_json, context_json, last_message_at)
      values (
        ${sysUserIdExpr},
        ${labelExpr},
        ${labelExpr} is null,
        ${sourceExpr},
        'active', false,
        ${skillsExpr},
        ${contextExpr},
        now()
      )
      returning id into spark_start_conversation_id
    `);

    s.modify(sql`
      insert into db.spark_agents
        (spark_conversation_id, status,
         question_policy,
         approval_low_policy, approval_high_policy, approval_external_policy)
      values (
        spark_start_conversation_id,
        'awaiting_plan',
        ${questionPolicy}::enums.spark_question_policy,
        ${approvalLowPolicy}::enums.spark_approval_policy,
        ${approvalHighPolicy}::enums.spark_approval_policy,
        ${approvalExternalPolicy}::enums.spark_approval_policy
      )
      returning id into spark_start_agent_id
    `);

    // Seed the task as the first user_message agent event.
    s.modify(sql`
      insert into db.spark_agent_events
        (spark_agent_id, type, content, created_at)
      values (spark_start_agent_id, 'user_message', ${taskExpr}, now())
    `);
  }

  initialize() {
    if (this.opts.mcp !== false) initializeMcpConnections();
    const { db } = system;

    //
    // Enums
    //

    system.enum_({
      name: "spark_conversation_status",
      values: ["active", "archived"],
    });

    system.enum_({
      name: "spark_agent_status",
      values: [
        "awaiting_plan",
        "awaiting_execute",
        "executing",
        "waiting_on_questions",
        "waiting_on_approval",
        "failed_retrying_plan",
        "completed",
        "failed",
      ],
    });

    system.enum_({
      name: "spark_agent_event_type",
      values: [
        "user_message",
        "create_script",
        "create_script_error",
        "execute_script_success",
        "execute_script_error",
        "blocker_resolved",
        "compaction",
        "card_displayed",
        "action_proposed",
        "action_executed",
        "action_undone",
        "action_cancelled",
        "question_created",
        "error_occurred",
        "external_message",
        "artifact_saved",
      ],
    });

    system.enum_({
      name: "spark_danger_level",
      values: ["low", "high", "external"],
    });

    system.enum_({
      name: "spark_action_status",
      values: [
        "proposed",
        "approved",
        "executed",
        "undo_requested",
        "undone",
        "cancelled",
        "failed",
      ],
    });

    system.enum_({
      name: "spark_question_policy",
      values: ["ask", "fail", "use_defaults"],
    });

    system.enum_({
      name: "spark_approval_policy",
      values: ["ask", "auto_approve", "fail"],
    });

    // Dedicated OpenAI harness controls.
    system.enum_({
      name: "spark_ai_reasoning_effort",
      values: ["none", "low", "medium", "high", "xhigh", "max"],
    });

    system.enum_({
      name: "spark_ai_queue_preference",
      values: ["inherit", "standard", "priority"],
    });

    // Conversation sharing. `private` = owner + explicit shares only;
    // `organization` = any user with Spark access can view. Targeted shares
    // live in spark_conversation_shares.
    system.enum_({
      name: "spark_conversation_visibility",
      values: ["private", "organization"],
    });

    //
    // Tables
    //

    db.table("spark_conversations", (table) => {
      table.autoCompact();
      // Nullable: runs started from scheduled jobs, APIs, or reactors have no
      // interactive user.
      table.fk("sys_user_id", "sys_users");
      table.string("label", 500);
      // Null leaves historical/explicitly named conversations unenrolled.
      table.bool("auto_title_pending");
      table.string("source", 200);
      table.string("agent_key", 200);
      table.enum("status", "spark_conversation_status").notNull()
        .default(sql`'active'`);
      table.bool("is_paused").notNull().default(sql`false`);
      // Sharing. `private` = owner + rows in spark_conversation_shares only;
      // `organization` = visible to anyone with Spark access. Sharing exposes
      // the transcript's data to the recipient regardless of their own data
      // permissions — it is a deliberate disclosure by the owner.
      table.enum("visibility", "spark_conversation_visibility").notNull()
        .default(sql`'private'`);
      // The conversation's static skill set — fixed at creation. Drives the
      // system prompt docs, query whitelist, and callable actions/functions.
      table.json("capabilities_json").renameFrom("skills_json");
      // Structured task context bound at creation (e.g. {revision_id,
      // project_id} for an estimating run). Surfaced to the agent and
      // validated by capability actions — the write path enforces that the
      // agent operates within this context. Null for open-ended chats.
      table.json("context_json");
      // Null model uses Luna for historical and noninteractive conversations.
      table.string("model", 100);
      // OpenAI harness controls.
      table.enum("reasoning_effort", "spark_ai_reasoning_effort").notNull()
        .default(sql.lit(this.opts.defaultReasoningEffort ?? "low"));
      table.enum("queue_preference", "spark_ai_queue_preference").notNull()
        .default(sql`'inherit'`);
      table.timestamp("last_message_at").notNull().default(sql`now()`);
    });

    system.enum_({
      name: "spark_execution_mode",
      values: ["native", "external"],
    });
    db.table("spark_agents", (table) => {
      table.enum("execution_mode", "spark_execution_mode").description(
        "Null means native; external MCP executions set this explicitly",
      );
      table.autoCompact();
      table.fk("spark_conversations").notNull();
      table.enum("status", "spark_agent_status").notNull()
        .default(sql`'awaiting_plan'`);
      table.smallUint("retry_count").notNull().default(sql`0`);
      table.timestamp("retry_at");
      table.string("openai_run_id", 64);
      // Policy columns: null = "ask" (wait for a human), which is the
      // default chat behavior. Non-chat runs typically set every column so
      // the agent never stalls waiting on interactive approval.
      table.enum("question_policy", "spark_question_policy");
      table.enum("approval_low_policy", "spark_approval_policy");
      table.enum("approval_high_policy", "spark_approval_policy");
      table.enum("approval_external_policy", "spark_approval_policy");
      table.timestamp("completed_at");
    });

    db.table("spark_agent_events", (table) => {
      table.autoCompact();
      table.fk("spark_agents").notNull();
      table.enum("type", "spark_agent_event_type").notNull();
      table.string("content", 50000);
      table.string("full_response", 100000);
      table.string("console_output", 100000);
      table.string("error_message", 10000);
      table.json("tool_actions");
      table.json("continuation_state");
      table.json("tool_outputs");
      table.json("payload");
      table.fk("action_id", "spark_action_log");
      // Set only on compaction events: the id of the last event subsumed by
      // the provider checkpoint.
      table.fk("compaction_cutoff_event_id", "spark_agent_events");
      table.timestamp("created_at").notNull().default(sql`now()`);
    });

    // File uploads and generated images attached to canonical agent events.
    // Small text bodies stay inline; binary files use the blob store.
    db.table("spark_attachments", (table) => {
      table.sampleData({ skipSampleData: true });
      table.autoCompact();
      table.fk("spark_event_id", "spark_agent_events").notNull().renameFrom(
        "spark_message_event_id",
      );
      table.string("name", 500).notNull();
      table.string("mime_type", 200).notNull();
      table.bigUint("file_size").notNull();
      table.string("text_content", 50000);
      table.blobRef("blob_hash");
      table.timestamp("expires_at").notNull().default(
        sql`timestamp '9999-12-31 23:59:59'`,
      );
      table.ttlFrom("expires_at", sql`now()`);
      table.check({
        fields: ["text_content", "blob_hash"],
        errorMessage: () => sql.lit`An attachment needs exactly one body`,
        check: ([textContent, blobHash]) =>
          sql`(${textContent} is null) != (${blobHash} is null)`,
      });
    });

    // Queue of images to be inlined into the next LLM turn for an agent.
    // Mirrors studio's `agent_pending_images`: the message-build path joins
    // this table to spark_attachments and emits per-message file parts so the
    // model receives images as inline vision content.
    db.table("spark_agent_pending_images", (table) => {
      table.sampleData({ skipSampleData: true });
      table.autoCompact();
      table.fk("spark_agents").notNull();
      table.fk("spark_attachment_id", "spark_attachments").notNull();
      table.timestamp("requested_at").notNull().default(sql`now()`);
      table.unique(["spark_agent_id", "spark_attachment_id"]);
      // Transient vision attachments — consumed within an agent turn. TTL reaps
      // any left behind by completed/dead runs so the table can't grow unbounded.
      table.ttlFrom("requested_at", sql`date.add(day, -1, now())`);
    });

    db.table("spark_action_log", (table) => {
      table.autoCompact();
      table.fk("spark_conversations").notNull();
      table.fk("execution_event_id", "spark_agent_events").notNull().renameFrom(
        "batch_id",
      );
      table.string("action_name", 200).notNull();
      // Approval proposals retain their review input. Reversible actions run
      // immediately and keep only their transaction receipt.
      table.json("input_json");
      table.json("result_json");
      table.enum("danger", "spark_danger_level").notNull()
        .default(sql`'low'`);
      table.bigUint("transaction_id");
      table.enum("status", "spark_action_status").notNull()
        .default(sql`'proposed'`);
    });

    // Targeted conversation shares (the "specific person" case; `organization`
    // visibility is on the conversation itself). Owner keeps full control.
    db.table("spark_conversation_shares", (table) => {
      table.fk("spark_conversations").notNull();
      table.fk("shared_with_sys_user_id", "sys_users").notNull();
      table.fk("shared_by_sys_user_id", "sys_users");
      table.timestamp("created_at").notNull().default(sql`now()`);
      table.unique(["spark_conversation_id", "shared_with_sys_user_id"]);
    });

    db.view(
      "spark_timeline",
      sql`
        select
          event.id * 10 as id,
          event.id as source_event_id,
          agent.spark_conversation_id,
          case
            when event.type = 'create_script' then 'assistant_message'
            when event.type in ('execute_script_success', 'execute_script_error')
              then 'tool_activity'
            when event.type = 'blocker_resolved' then 'tool_activity'
            when event.type = 'create_script_error' then 'error_occurred'
            else event.type::string
          end as event_type,
          case
            when event.type = 'execute_script_success'
              then coalesce(event.content, 'Ran tools')
            when event.type = 'execute_script_error'
              then case when event.payload->>'source' = 'mcp' then coalesce(event.error_message, 'Tool error') else coalesce(event.content, 'Tool error') end
            when event.type = 'create_script_error' then event.error_message
            else event.content
          end as message_content,
          event.payload,
          event.action_id,
          event.spark_agent_id as agent_id,
          event.created_at,
          coalesce(agent.execution_mode = 'external', false) as is_external
        from db.spark_agent_events event
        join db.spark_agents agent on agent.id = event.spark_agent_id
        where event.type in (
          'external_message', 'artifact_saved',
          'user_message', 'create_script', 'create_script_error',
          'execute_script_success', 'execute_script_error', 'card_displayed',
          'blocker_resolved',
          'action_proposed', 'action_executed', 'action_undone',
          'action_cancelled', 'question_created', 'error_occurred'
        )
          and (event.type <> 'create_script' or event.content is not null)
          and (event.type <> 'blocker_resolved'
            or event.payload->>'action' = 'ui_event')

        union all

        select
          event.id * 10 + 1,
          event.id,
          agent.spark_conversation_id,
          'assistant_message',
          event.full_response,
          null::json,
          null::bigint,
          event.spark_agent_id,
          event.created_at,
          coalesce(agent.execution_mode = 'external', false)
        from db.spark_agent_events event
        join db.spark_agents agent on agent.id = event.spark_agent_id
        where event.type = 'create_script'
          and event.full_response is not null
          and not exists (
            select 1
            from json.array_each(coalesce(event.tool_actions, '[]'::json))
          )
      `,
    );

    this.componentDependencies = ["SparkPage", "SparkPanel"];
    this.description =
      "Intelligent analysis and action layer for Yolm systems. Provides a conversational interface for data analysis, what-if questions, and controlled write operations.";
  }

  static SparkPage = SparkPage;
  static SparkPanel = SparkPanel;
}
