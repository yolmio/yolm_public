import { sparkDriveTransferTools } from "./transfers";
import {
  downloadFileJs,
  generatedFileDownloadTool,
} from "blocks/mcp/transfers";
import { refreshSparkExecAccess, registerSparkExecutor } from "./exec";
import { sparkActionUndoResult } from "./action_undo";
import { executeSparkReversibleAction } from "./action_execution";
import { externalSparkArtifactTools } from "./mcp_artifacts";
import { externalSparkMessageTools } from "./mcp_messages";

import type { SparkFunctionContext } from "./function_context";
import {
  defQueryWhitelists,
  effectiveCapabilitiesJsonExpr,
} from "./query_policy";
import type {
  EndpointStatementsOrFn,
  GeneralServerStatements,
} from "std/statements";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { system } from "std/system";
import {
  canReadSparkKnowledgeForNullableOwner,
  type SparkDriveKnowledge,
  sparkPublishedFileVersionId,
} from "./drive_knowledge.ts";
import {
  sparkSkillFrontmatterValid,
  sparkSkillFrontmatterValue,
  type SparkWorkspace,
} from "./workspace.ts";
import {
  sparkPersistedToolOutputExpr,
  sparkPersistedToolOutputJsonExpr,
  sparkPromptConsoleExpr,
  sparkPromptErrorExpr,
  sparkPromptFullResponseExpr,
} from "./prompt_output";
import {
  generateNativeSparkResponse,
  nativeSparkMockCloseProcedure,
} from "./native_llm";
import { SPARK_NATIVE_REFERENCES } from "./native_references";
import { pdfSourceRegionRenderValidationFailure } from "./pdf_source_region_validation";
import { SPARK_SPREADSHEET_EXEC_HELPERS } from "./spreadsheet_exec";
import { registerSparkTitleReactor } from "./title";
import { undoSparkActionBatch } from "./action_undo";
import {
  externalSparkImage,
  externalSparkReceiptTools,
  sparkSessionActionAllowed,
} from "./mcp_actions";
import {
  hasSparkPermissionGate,
  type SparkPermissionRequirement,
} from "./permissions.ts";

// Default width (px) for PDF pages rendered to PNG for vision. 1568 is the
// max-useful vision width for current models while keeping renders small.
const SPARK_PDF_RENDER_WIDTH = 1568;
const SPARK_FILE_READ_TIMEOUT_MS = 15 * 60 * 1000;

// ============================================================================
// Types (mirrors the public types from index.tsx, avoids circular imports)
// ============================================================================

export interface CapabilityAction {
  name: string;
  description: string;
  danger?: string;
  mode?: "approval" | "reversible";
  permission?: string;
  permissions?: SparkPermissionRequirement;
  inputType: string;
  preflight?: (s: GeneralServerStatements) => void;
  procedure?: (s: GeneralServerStatements) => void;
  undo?: (s: GeneralServerStatements) => void;
}

interface CapabilityFunction {
  name: string;
  description: string;
  inputType?: string;
  timeoutMs?: number;
  procedure: (
    s: GeneralServerStatements,
    context: SparkFunctionContext,
  ) => void;
}

interface CapabilityOpts {
  name: string;
  description: string;
  permission?: string;
  permissions?: SparkPermissionRequirement;
  internal?: boolean;
  views?: string[];
  tables?: string[];
  fieldWhitelist?: { table: string; fields: string[] }[];
  actions?: CapabilityAction[];
  functions?: CapabilityFunction[];
  fileSources?: {
    name: string;
    table: string;
    blobColumn?: string;
    mimeColumn?: string;
    nameColumn?: string;
    lookup?: (id: Sql, context: { sysUserId: Sql }) => Sql;
    renderPdfPage?: (
      s: GeneralServerStatements,
      opts: {
        fileId: Sql;
        pdf: Sql;
        page: Sql;
        pageWidth: Sql;
        pageHeight: Sql;
        renderWidth: Sql;
        defOutputScalar: string;
      },
    ) => void;
    readPdfMarkup?: (
      s: GeneralServerStatements,
      opts: {
        fileId: Sql;
        page: Sql;
        defOutputScalar: string;
      },
    ) => void;
  }[];
  doc: string;
}

export interface RegisterReactorsOpts {
  mcp?: boolean;
  accessPermission?: string;
  capabilities: CapabilityOpts[];
  workspace: SparkWorkspace;
  /** Optional controlled document library. */
  knowledge?: SparkDriveKnowledge;
  /** Expose the native `render_ui` tool. */
  enableDynamicUi?: boolean;
  /**
   * Bundled JS modules (by id, e.g. `listbox_nav`) that rendered cards
   * may import + `jsCall` into — passed to the dynamic-UI preflight as the
   * capability allowlist. Empty (default) = no client JS. Only add vetted,
   * repo-shipped module ids; this widens the same-origin card sandbox.
   */
  allowedCardJsModules?: string[];
  /**
   * Dev/test-only stand-in for the native OpenAI harness. See
   * `generateNativeSparkResponse`'s `mockProcedure` for the required shape.
   */
  mockProcedure?: EndpointStatementsOrFn;
}

// ============================================================================
// System Prompt
// ============================================================================

// Safe fallback for a newly created workspace whose AGENTS.md has not
// been authored yet.
const DEFAULT_SPARK_ROOT =
  "You are Spark, an intelligent analysis and action assistant working inside a business system.";

export function buildNativeSystemPrompt(
  opts: RegisterReactorsOpts,
  external = false,
  readOnly = false,
): string {
  const renderUi = opts.enableDynamicUi ?? false;
  const references = SPARK_NATIVE_REFERENCES.map((reference) =>
    `- ${reference.path}: ${reference.description} Load with ` +
    `\`text((await tools.readFile(${
      JSON.stringify(reference.path)
    })).markdown)\`.`
  ).join("\n");

  return `You are Spark, an analysis and action agent inside a business system.

Work directly with the user. Share brief commentary and a concise final.

Tools:
- \`exec\` runs JavaScript in a fresh V8 isolate without filesystem or network
  access. Application APIs are under
  \`tools.*\`; \`tools.query(sql)\` returns \`{ data: CSV }\`. Emit only compact
  results with \`text(value)\` and images with \`image(bytes)\`. Text emitted by
  one exec call is limited to 40,000 characters ${
    external ? "before returning to the client" : "before conversation storage"
  }.
${
    external
      ? "- Use exec to orchestrate related reads and actions; conversation stays in your MCP client. Export generated text with text(await tools.downloadFile({data,filename,mimeType})). Download links expire after 30 minutes; use the exact URL without appending parameters." +
        (opts.workspace
          ? " tools.downloadDriveFile({versionId}) returns a link for an authorized immutable Drive version. With write access, tools.prepareDriveUpload({spaceId,parentId?,filename,mimeType}) (or {itemId,filename,mimeType} for a new revision) returns a POST URL accepting raw file bytes. Drive permissions and extension policies still apply. Upload is a new operation and must not be blindly retried after a lost response."
          : "")
      : "- Call one native tool per turn. Use one `exec` to orchestrate any number of\n  related application reads and actions."
  }
${
    renderUi
      ? `- \`render_ui\` renders a complete raw Yolm TSX module after compilation
  and capability checks. Load \`System/UI\` through \`exec\` before first use.`
      : ""
  }

Capability documents are authoritative for allowed data, operations,
exact schemas or view definitions, and common query syntax. Use their exact
names and combine related reads and calls. Prefer SQL for filtering, grouping,
and set comparisons; use JavaScript for bounded orchestration and transforms.
Build complex investigations in short validated stages. Qualify joined columns
and alias identifiers that occur in more than one relation.

Load a capability document by visibly emitting its markdown in one \`exec\`,
then call its operations in a later \`exec\`. Capability functions are direct
namespaced calls such as \`await tools.capability.function(input)\`; capability
actions use the same direct form, \`await tools.capability.action(input)\`.

${
    external
      ? (readOnly
        ? `This is a read-only MCP connection. Use execRead for queries, files, skills and explicitly read-only functions. It cannot create sessions, execute or propose actions, or save artifacts. A selected session can provide task context and saved results.`
        : `Create or select one session for the whole job; reuse its sessionId across subagents and repairs. Independent agent context does not require a new Spark session. Registered reversible actions execute immediately. Approval actions create proposals that the user reviews in the linked Spark session; the client cannot approve them. Every action call is a new operation; inspect receipts after a lost response before retrying. tools.actionReceipt({receiptId}) checks status; tools.undoReceipt({receiptId}) undoes those exact reversible changes. For a set, inspect tools.previewUndo({receiptIds}), then pass its exact result to tools.undoReceipts({preview}); the set is undone atomically or blocked by conflicts. Optionally publish a concise outcome with tools.createMessage({message}); actions and files are visible automatically. Conversation stays in the client; Yolm retains actions, proposals and saved work. Runtime permissions remain authoritative.`)
      : `Capability actions either create approval proposals or execute as reversible
database transactions, as documented for each action. Never claim an action
completed until the runtime reports its resolved state. Runtime permissions,
capability policy, task context, and UI preflight are authoritative.
When the user asks to undo the latest reversible changes, call
\`undoLastChanges()\` instead of constructing an inverse domain action.`
  }

## Native references

${references}`;
}

function buildSchemaReference(
  skill: CapabilityOpts,
  resource?: string,
): string {
  const sections: string[] = [];
  const enums = new Set<string>();
  const restricted = new Map<string, string[]>();
  for (const entry of skill.fieldWhitelist ?? []) {
    restricted.set(entry.table, [
      ...(restricted.get(entry.table) ?? []),
      ...entry.fields,
    ]);
  }
  for (const name of new Set([...(skill.tables ?? []), ...restricted.keys()])) {
    if (resource && name !== resource) continue;
    const table = system.db.tables[name];
    if (!table) continue;
    const fields = restricted.get(name) ?? [
      table.primaryKeyFieldName,
      ...Object.keys(table.fields),
    ];
    const lines = [
      `${name}${table.description ? ` — ${table.description}` : ""}`,
    ];
    for (const name of new Set(fields)) {
      if (name === table.primaryKeyFieldName) {
        lines.push(`${name}: bigint PK`);
        continue;
      }
      const field = table.fields[name];
      if (!field) continue;
      let type = field.castType;
      if (field.type === "Enum") enums.add(field.enum);
      if (field.type === "ForeignKey") {
        const target = system.db.tables[field.table];
        type = `bigint${
          field.notNull ? "" : "?"
        } -> ${field.table}.${target.primaryKeyFieldName}`;
      } else if (!field.notNull) {
        type += "?";
      }
      lines.push(
        `${name}: ${type}${field.description ? ` — ${field.description}` : ""}`,
      );
    }
    sections.push(lines.join("\n"));
  }
  for (const name of enums) {
    const definition = system.enums[name];
    // Built-in enums (for example sys_timezone) have no authored registry entry.
    if (!definition) continue;
    sections.push(
      `enums.${name} = ${
        Object.values(definition.values).map((value) => value.name).join(" | ")
      }`,
    );
  }
  let text = sections.length
    ? `\n## Readable schema\n\nOnly listed columns are exposed here. ? = nullable; PK = primary key.\n\n${
      sections.join("\n\n")
    }\n`
    : "";
  for (const name of skill.views ?? []) {
    if (resource && name !== resource) continue;
    const view = system.db.views[name];
    if (!view) continue;
    // Keep the authoritative projection, including computed columns and aliases.
    text += `\n### ${name}${
      view.description ? ` — ${view.description}` : ""
    }\nView output is its SELECT list; underlying tables are not granted by this view.\n\n\`\`\`sql\n${view.query.toSQL()}\n\`\`\`\n`;
  }
  return text;
}

// Build the authoritative lazy-loaded reference returned by readCapability.
function buildCapabilityDocText(skill: CapabilityOpts): string {
  let text = `\n---\n\n# Capability: ${skill.name}\n\n${skill.description}\n`;
  text += buildSchemaReference(skill);
  const actions = skill.actions ?? [];
  if (actions.length > 0) {
    text += `\n**Actions:**\n`;
    for (const a of actions) {
      text +=
        `- \`tools.${skill.name}.${a.name}(input: ${a.inputType})\` — ${a.description} (danger: ${
          a.danger ?? "low"
        }; execution: ${a.mode ?? "approval"})\n`;
    }
  }
  const functions = skill.functions ?? [];
  if (functions.length > 0) {
    text += `\n**Functions:**\n`;
    for (const f of functions) {
      text += `- \`tools.${skill.name}.${f.name}(input${
        f.inputType ? `: ${f.inputType}` : "?"
      })\` — ${f.description}\n`;
    }
  }
  const fileSources = skill.fileSources ?? [];
  if (fileSources.length > 0) {
    text += `\n**Files:**\n`;
    for (const source of fileSources) {
      text +=
        `- Source \`${source.name}\`: obtain IDs through the tables, views, or ` +
        `resolver functions documented by this capability.\n`;
    }
    text +=
      `Read \`System/Files\` for file binding, PDF/image rendering, and exact Excel queries.\n`;
    if (fileSources.some((source) => source.readPdfMarkup)) {
      text += `For saved structured annotations and rotations, call ` +
        `\`tools.readFileMarkup({ source, id, page? })\`; pass \`page\` to ` +
        `return only that page's presentation data.\n`;
    }
  }
  text +=
    `\nUse the readable schema above for exact column names, keys, and units. ` +
    `\`tools.query(sql)\` or \`tools.query({ sql, maxRows?, file? })\` returns CSV in \`data\`; SQL placeholder bindings are not supported.\n`;
  text +=
    `\nRe-read one resource schema with \`tools.readCapability({ name: "${skill.name}", section: "schema", resource: "<table or view>" })\`. ` +
    `Read \`System/SQL\` for shared query syntax.\n`;
  text += `\n${skill.doc}\n`;
  return text;
}

export function buildCapabilityCatalogEntry(skill: CapabilityOpts): string {
  const operations = [
    ...(skill.actions ?? []).map((action) => action.name),
    ...(skill.functions ?? []).map((fn) => fn.name),
  ];
  const directCallHelp = [
    (skill.functions ?? []).length > 0
      ? `function example: \`await tools.${skill.name}.${
        (skill.functions ?? [])[0].name
      }(input)\``
      : null,
    (skill.actions ?? []).length > 0
      ? `action example: \`await tools.${skill.name}.${
        (skill.actions ?? [])[0].name
      }(input)\``
      : null,
  ].filter((item): item is string => item !== null).join("; ");
  return `- **${skill.name}** — ${skill.description}` +
    (operations.length > 0
      ? ` Callable operations: ${operations.join(", ")}.`
      : " Data access is through tools.query.") +
    (directCallHelp.length > 0 ? ` Direct calls use ${directCallHelp}.` : "") +
    `\n  Load: \`text((await tools.readCapability(${
      JSON.stringify(skill.name)
    })).markdown);\` in its own exec, then use it in a later exec.`;
}

/**
 * SQL expression injecting the index of governed company documents (the
 * controlled Drive) readable by this conversation's owner: id, title, content
 * mode, and description. Only the index is injected; the agent pulls content
 * on demand via tools.loadDocument(), keeping the system prompt small.
 * Ownerless runs (scheduled/API/reactor) see organization-visibility
 * documents only — there is no user to evaluate restricted permissions
 * against.
 */
function sparkDocumentIndexExpr(
  knowledge: SparkDriveKnowledge,
  conversationIdExpr: Sql,
): Sql {
  return sparkDocumentIndexForUser(
    knowledge,
    sql`(select sys_user_id from db.spark_conversations where id = ${conversationIdExpr})`,
  );
}

export function sparkDocumentIndexForUser(
  knowledge: SparkDriveKnowledge,
  ownerExpr: Sql,
): Sql {
  const resolvedVersionId = sparkPublishedFileVersionId(
    knowledge,
    sql`item.id`,
  );
  return sql`(
    select case when count(*) = 0 then '' else
      chr(10) || chr(10) || '# Company documents (index)' || chr(10)
        || 'Governed company documents you can read. Load content with '
        || 'tools.loadDocument(<id>) before relying on it.' || chr(10)
        || string_agg(
            '- [' || d.id::string || '] ' || d.title
              || ' (' || d.mode || ')'
              || coalesce(': ' || d.description, ''),
            chr(10) order by d.title)
    end
    from (
      select item.id, item.name as title, item.description,
        case
          when exists (
            select 1
            from db.native_document_file_versions native
            where native.file_version_id = ${resolvedVersionId}
          ) then 'document'
          when lower((
            select version.content_type
            from db.file_versions version
            where version.id = ${resolvedVersionId}
          )) = 'application/pdf' then 'pdf'
          else 'file'
        end as mode
      from db.file_items item
      where item.item_kind = 'file'
        and item.trashed_at is null
        and ${resolvedVersionId} is not null
        and ${
    canReadSparkKnowledgeForNullableOwner(
      knowledge,
      ownerExpr,
      sql`item.id`,
    )
  }
    ) d)`;
}

function sparkWorkspaceIdExpr(workspace: SparkWorkspace) {
  return sql`(
    select id
    from db.file_spaces
    where cast(space_type as string) = ${sql.lit(workspace.type.spaceType.name)}
    order by id
    limit 1
  )`;
}

export function sparkRootInstructionsExpr(workspace: SparkWorkspace) {
  const spaceId = sparkWorkspaceIdExpr(workspace);
  return sql`coalesce((
    select markdown.content
    from db.file_items item
    join db.markdown_file_versions markdown
      on markdown.file_version_id = item.current_file_version_id
    where item.file_space_id = ${spaceId}
      and item.parent_file_item_id is null
      and item.item_kind = 'file'
      and item.trashed_at is null
      and item.name = 'AGENTS.md'
    order by item.id
    limit 1
  ), ${sql.lit(DEFAULT_SPARK_ROOT)})`;
}

export function sparkSkillIndexExpr(workspace: SparkWorkspace) {
  const spaceId = sparkWorkspaceIdExpr(workspace);
  return sql`(
    select case when count(*) = 0 then '' else
      chr(10) || chr(10) || '# Skills' || chr(10)
      || 'Select skills only when their descriptions match the requested work.'
      || ' A simple read-only lookup may need no skill.'
      || ' Before acting, read each selected SKILL.md through tools.readFile'
      || ' and follow it. Skills are guidance; available capabilities are authoritative.'
      || chr(10)
      || string_agg(
        '- ' || skill.skill_name || ': ' || skill.skill_description
          || ' — Skills/' || skill.folder_name || '/SKILL.md',
        chr(10) order by skill.skill_name
      )
    end
    from (
      select parsed.folder_name, parsed.skill_name, parsed.skill_description
      from (
        select skill.name as folder_name,
          ${sparkSkillFrontmatterValue(sql`markdown.content`, "name")}
            as skill_name,
          ${sparkSkillFrontmatterValue(sql`markdown.content`, "description")}
            as skill_description,
          ${sparkSkillFrontmatterValid(sql`markdown.content`)}
            as frontmatter_valid
        from db.file_items skills_folder
        join db.file_items skill
          on skill.file_space_id = ${spaceId}
          and skill.parent_file_item_id = skills_folder.id
          and skill.item_kind = 'folder'
          and skill.trashed_at is null
        join db.file_items skill_file
          on skill_file.file_space_id = ${spaceId}
          and skill_file.parent_file_item_id = skill.id
          and skill_file.item_kind = 'file'
          and skill_file.trashed_at is null
          and skill_file.name = 'SKILL.md'
        join db.markdown_file_versions markdown
          on markdown.file_version_id = skill_file.current_file_version_id
        where skills_folder.file_space_id = ${spaceId}
          and skills_folder.parent_file_item_id is null
          and skills_folder.item_kind = 'folder'
          and skills_folder.trashed_at is null
          and skills_folder.name = 'Skills'
      ) parsed
      where parsed.frontmatter_valid
    ) skill
  )`;
}

/**
 * Defines `spark_conv_capabilities_json` (the conversation's static capability
 * list) and `spark_system_prompt`. The prompt is assembled at runtime as:
 *   locked native harness
 *   + compact capability catalog
 *   + root Drive AGENTS.md
 *   + Drive skill index
 *   + the optional company-document index.
 * Drive versions are intentionally read on each turn: an edit invalidates
 * prompt caching and takes effect immediately.
 */
function defSparkSystemPrompt(
  s: GeneralServerStatements,
  opts: RegisterReactorsOpts,
  conversationIdExpr: Sql,
) {
  s.defScalar(
    "spark_conv_stored_capabilities_json",
    sql`coalesce(
      (select capabilities_json from db.spark_conversations
        where id = ${conversationIdExpr}),
      '[]'::json)`,
  );
  s.defScalar(
    "spark_conv_owner_id",
    sql`(select sys_user_id from db.spark_conversations
      where id = ${conversationIdExpr})`,
  );
  s.defScalar(
    "spark_conv_capabilities_json",
    effectiveCapabilitiesJsonExpr(
      opts.capabilities,
      sql`spark_conv_stored_capabilities_json`,
      sql`spark_conv_owner_id`,
    ),
  );
  let capabilityCatalogExpr: Sql = sql`''`;
  for (const skill of opts.capabilities) {
    capabilityCatalogExpr = sql`${capabilityCatalogExpr} || case
      when spark_conv_capabilities_json @> json_build_array(${
      sql.lit(skill.name)
    })
      then chr(10) || ${sql.lit(buildCapabilityCatalogEntry(skill))}
      else '' end`;
  }
  // NOTE: an earlier version rendered a live "## Table columns" block here from
  // information_schema. It cannot work: inside a JIT-compiled procedure the
  // catalog scan returns rows only when it is the literal FIRST statement of
  // the execution, which the prompt-assembly path can never be. See
  // internal_docs/bugs/information_schema_scan_quirks_in_procedure.md. The
  // agent instead reads exact columns via its own query() tool (each query is
  // its own procedure, so the scan is first there) guided by the skill doc.
  s.defScalar(
    "spark_system_prompt",
    sql`${sql.lit(buildNativeSystemPrompt(opts))}
      || chr(10) || chr(10) || '## Available capabilities'
      || chr(10) || 'Load relevant capabilities for their instructions, readable schemas, and operations.'
      || ${capabilityCatalogExpr}
      || chr(10) || chr(10) || '## Organization instructions' || chr(10)
      || ${sparkRootInstructionsExpr(opts.workspace)}
      || chr(10) || chr(10) || '## Current date' || chr(10)
        || 'Today is ' || substr(cast(now() as string), 1, 10)
        || '. Treat this as "now" for recent, this-year, this-month, and '
        || 'lately reasoning.'
      || coalesce(
        (select chr(10) || chr(10) || '## Task context' || chr(10)
            || 'This run is bound to: ' || cast(c.context_json as string)
            || chr(10)
            || 'Use these authoritative ids for every read and action.'
         from db.spark_conversations c
         where c.id = ${conversationIdExpr} and c.context_json is not null),
        '')
      || ${sparkSkillIndexExpr(opts.workspace)}
      || ${
      opts.knowledge
        ? sparkDocumentIndexExpr(opts.knowledge, conversationIdExpr)
        : sql`''`
    }`,
  );
}

// ============================================================================
// Message Building
// ============================================================================

function buildSparkAgentMessages(
  s: GeneralServerStatements,
  agentId: Sql,
) {
  const conversationAgentIds = sql`
    select history_agent.id
    from db.spark_agents history_agent
    where history_agent.spark_conversation_id = current_conversation_id
  `;
  const userMessageContent = sql`coalesce(bae.content, '')
    || case when bae.payload->>'action' = 'ui_request' then
      chr(10) || 'Structured card selection: '
      || coalesce(bae.payload->'payload', '{}'::json)::string
    else '' end
    || coalesce((
    select chr(10) || chr(10) || string_agg(
      case
        when attachment.text_content is not null then
          '[Attached file: ' || attachment.name || ']' || chr(10)
          || attachment.text_content || chr(10) || '[/Attached file]'
        when lower(attachment.name) like '%.xlsx'
          or lower(attachment.name) like '%.xls'
          or attachment.mime_type like '%spreadsheet%'
          or attachment.mime_type like '%excel%' then
          '[Attached spreadsheet: ' || attachment.name
          || ' (attachment_id=' || attachment.id::string
          || ') — load System/Attachments, then use inspectSpreadsheet() '
          || 'and readSpreadsheet().]'
        when attachment.mime_type = 'application/pdf' then
          '[Attached PDF: ' || attachment.name
          || ' (attachment_id=' || attachment.id::string
          || ') — use readPdfText({ id }) or renderPdfPage({ id, page }).]'
        when attachment.mime_type like 'image/%' then
          '[Attached image: ' || attachment.name || ' ('
          || attachment.mime_type || ', attachment_id='
          || attachment.id::string || ')]'
        else
          '[Attached file: ' || attachment.name || ' ('
          || attachment.mime_type || ', ' || attachment.file_size::string
          || ' bytes, attachment_id=' || attachment.id::string || ')]'
      end,
      chr(10) || chr(10) order by attachment.id
    )
    from db.spark_attachments attachment
    where attachment.spark_event_id = bae.id
  ), '')`;

  s.defTable("spark_agent_messages", {
    fields: [
      { name: "message_id", type: "BigInt" },
      { name: "role", type: "String" },
      { name: "content", type: "String" },
      { name: "cache_marker", type: "Bool" },
      { name: "continuation_state", type: "Json" },
      { name: "tool_outputs", type: "Json" },
    ],
  });

  s.defScalar(
    "current_conversation_id",
    sql`(select spark_conversation_id from db.spark_agents where id = ${agentId})`,
  );

  // Compaction cutoff: the latest compaction event subsumes all events with
  // id <= its compaction_cutoff_event_id. We skip those, EXCEPT:
  //   - the first user_message (the original task — the run's anchor, always
  //     kept verbatim so the agent's goal never drifts out of view), and
  //   - the latest user_message (kept verbatim for the current-turn context).
  // The compaction event's content is rendered below as a summary message in
  // place of the older history.
  s.defScalar(
    "build_msg_compaction_cutoff",
    sql`coalesce(
      (select compaction_cutoff_event_id from db.spark_agent_events
       where spark_agent_id in (${conversationAgentIds})
         and type = 'compaction'
       order by id desc limit 1),
      -1
    )`,
  );
  s.defScalar(
    "build_msg_first_user_id",
    sql`(select id from db.spark_agent_events
         where spark_agent_id in (${conversationAgentIds})
           and type = 'user_message'
         order by id asc limit 1)`,
  );
  s.defScalar(
    "build_msg_latest_user_id",
    sql`(select id from db.spark_agent_events
         where spark_agent_id in (${conversationAgentIds})
           and type = 'user_message'
         order by id desc limit 1)`,
  );
  s.defScalar(
    "build_msg_latest_assistant_id",
    sql`(select id from db.spark_agent_events
         where spark_agent_id in (${conversationAgentIds})
           and type in ('create_script', 'execute_script_success', 'execute_script_error')
           and (full_response is not null or continuation_state is not null)
         order by id desc limit 1)`,
  );

  // Legacy Responses events trimmed display text before saving. Recover their
  // original visible text from retained provider items; the platform still
  // verifies the envelope hash. New events use payload.assistant_text.
  // Insert events as messages (skip internal LLM events and compaction rows;
  // the compaction summary is injected separately below).
  s.modify(sql`
    insert into spark_agent_messages (
      message_id, role, content, cache_marker, continuation_state,
      tool_outputs
    )
    select
      bae.id * 10 as message_id,
      case
        when bae.type in ('create_script', 'execute_script_success', 'execute_script_error')
          and (bae.full_response is not null or bae.continuation_state is not null)
          then 'assistant'
        else 'user'
      end as role,
      case bae.type
        when 'user_message' then '[Event: user_message]' || chr(10) ||
          case when bae.id = build_msg_latest_user_id
            then ${userMessageContent}
            else ${sparkPromptConsoleExpr(userMessageContent)} end
        when 'create_script' then
          case when bae.continuation_state is not null
            then coalesce(bae.payload->>'assistant_text',
              case when bae.continuation_state->>'codec' in
                  ('openai_responses_output_v1', 'xai_responses_output_v1')
                and json_typeof(bae.continuation_state->'items') = 'array'
                then coalesce((
                  select string_agg(part.value->>'text', '' order by item.index, part.index)
                  from json.array_each(bae.continuation_state->'items') item
                  join json.array_each(item.value->'content') part on true
                  where item.value->>'type' = 'message'
                    and part.value->>'type' in ('output_text', 'text')
                ), '') end,
              bae.full_response, bae.content, '')
            when bae.id = build_msg_latest_assistant_id
            then bae.full_response
            else ${sparkPromptFullResponseExpr(sql`bae.full_response`)} end
        when 'execute_script_success' then
          case when bae.id = build_msg_latest_assistant_id
            then bae.full_response
            else ${sparkPromptFullResponseExpr(sql`bae.full_response`)} end
        when 'execute_script_error' then
          case when bae.id = build_msg_latest_assistant_id
            then bae.full_response
            else ${sparkPromptFullResponseExpr(sql`bae.full_response`)} end
        when 'blocker_resolved' then '[Event: blocker_resolved]' || chr(10) ||
          coalesce(${sparkPromptConsoleExpr(sql`bae.content`)}, '')
        when 'action_executed' then coalesce(
          ${sparkPromptConsoleExpr(sql`bae.content`)}, ''
        ) || coalesce((
          select chr(10) || 'Result: ' ||
            ${sparkPromptConsoleExpr(sql`action.result_json::string`)}
          from db.spark_action_log action
          where action.id = bae.action_id
            and action.input_json is not null
            and action.result_json is not null
        ), '')
        else coalesce(
          ${sparkPromptConsoleExpr(sql`bae.content`)},
          ${sparkPromptFullResponseExpr(sql`bae.full_response`)},
          ''
        )
      end as content,
      false as cache_marker,
      case
        when bae.id > coalesce((
          select max(id) from db.spark_agent_events
          where spark_agent_id in (${conversationAgentIds})
            and type = 'compaction'
        ), -1) then bae.continuation_state
        else null::json
      end as continuation_state,
      null::json as tool_outputs
    from db.spark_agent_events bae
    where bae.spark_agent_id in (${conversationAgentIds})
      and bae.type not in ('create_script_error', 'compaction')
      and bae.tool_outputs is null
      and not (
        bae.type = 'create_script'
        and exists (
          select 1
          from db.spark_agent_events execution_event
          where execution_event.spark_agent_id = bae.spark_agent_id
            and execution_event.id > bae.id
            and execution_event.type in ('execute_script_success', 'execute_script_error')
            and execution_event.full_response = bae.full_response
        )
      )
      and (
        bae.id > build_msg_compaction_cutoff
        or bae.id = build_msg_first_user_id
        or bae.id = build_msg_latest_user_id
      )
    order by bae.id
  `);

  // Provider compaction is an exact assistant checkpoint, not prose. The
  // service can resume it without re-tokenizing or interpreting a summary.
  s.modify(sql`
    insert into spark_agent_messages (
      message_id, role, content, cache_marker, continuation_state,
      tool_outputs
    )
    select
      compaction_event.id * 10,
      'assistant',
      '',
      false,
      compaction_event.continuation_state,
      null::json
    from db.spark_agent_events compaction_event
    where compaction_event.spark_agent_id in (${conversationAgentIds})
      and compaction_event.type = 'compaction'
      and compaction_event.id = (
        select max(latest_compaction.id)
        from db.spark_agent_events latest_compaction
        where latest_compaction.spark_agent_id in (${conversationAgentIds})
          and latest_compaction.type = 'compaction'
      )
  `);

  // Add execution results as separate user messages after scripts
  s.modify(sql`
    insert into spark_agent_messages (
      message_id, role, content, cache_marker, continuation_state,
      tool_outputs
    )
    select
      bae.id * 10 + 1 as message_id,
      'user' as role,
      case
        when bae.error_message is not null then
          '[Script Error]' || chr(10) || ${
    sparkPromptErrorExpr(sql`bae.error_message`)
  } ||
          case when bae.console_output is not null and bae.console_output != ''
            then chr(10) || chr(10) || '[Console Output]' || chr(10) ||
              ${sparkPromptConsoleExpr(sql`bae.console_output`)}
            else '' end
        when bae.console_output is not null and bae.console_output != '' then
          '[Console Output]' || chr(10) || ${
    sparkPromptConsoleExpr(sql`bae.console_output`)
  }
        else '[Script completed]'
      end as content,
      false as cache_marker,
      null::json,
      bae.tool_outputs
    from db.spark_agent_events bae
    where bae.spark_agent_id in (${conversationAgentIds})
      and bae.type in ('execute_script_success', 'execute_script_error')
      and (bae.full_response is not null or bae.error_message is not null
           or bae.console_output is not null)
      and bae.id > build_msg_compaction_cutoff
    order by bae.id
  `);

  // Native tool outputs cannot carry a prompt-cache breakpoint. Follow each
  // correlated output with a tiny ordinary input item so explicit caching can
  // mark the complete reusable tool-result prefix. This row is reconstructed
  // deterministically from the persisted execution event on every replay.
  s.modify(sql`
    insert into spark_agent_messages (
      message_id, role, content, cache_marker, continuation_state,
      tool_outputs
    )
    select
      bae.id * 10 + 2,
      'user',
      '[End of reusable tool result]',
      true,
      null::json,
      null::json
    from db.spark_agent_events bae
    where bae.spark_agent_id in (${conversationAgentIds})
      and bae.type in ('execute_script_success', 'execute_script_error')
      and bae.tool_outputs is not null
      and bae.id > build_msg_compaction_cutoff
    order by bae.id
  `);

  // Pending actions and questions stop planning until their resolutions are
  // persisted as ordinary events. Do not append an ephemeral state message:
  // putting it after each prompt snapshot makes the next prompt cease to be a
  // strict extension and prevents Responses from reusing previous_response_id.
  // User images stay associated with their persisted event for the same
  // reason.

  // Earlier explicit breakpoints stay read-only on later requests. Preserve
  // every checkpoint so each turn writes only its newly appended suffix.
  s.modify(sql`
    update spark_agent_messages
    set cache_marker = true
    where role = 'user'
      and tool_outputs is null
  `);
}

// ============================================================================
// JS Context
// ============================================================================

function prepareSparkJsContext(
  s: GeneralServerStatements,
  opts: {
    conversationId: Sql;
    agentId: Sql;
    executionEventId: Sql;
    capabilities: CapabilityOpts[];
  },
) {
  s.defScalar("spark_js_conversation_id", opts.conversationId);
  s.defScalar("spark_js_agent_id", opts.agentId);
  s.defScalar("spark_js_execution_event_id", opts.executionEventId);
  s.defScalar(
    "spark_js_stored_capabilities",
    sql`coalesce(
      (select capabilities_json from db.spark_conversations
        where id = ${opts.conversationId}),
      '[]'::json)`,
  );
  s.defScalar(
    "spark_js_owner_id",
    sql`(select sys_user_id from db.spark_conversations
      where id = ${opts.conversationId})`,
  );
  s.defScalar(
    "spark_js_conv_capabilities",
    effectiveCapabilitiesJsonExpr(
      opts.capabilities,
      sql`spark_js_stored_capabilities`,
      sql`spark_js_owner_id`,
    ),
  );
  // Bind the ambient request context from the conversation's context_json so the
  // agent's query() / action executions can scope whitelisted views to this
  // run's tenant/record via the current_context() SQL function. The context
  // propagates to child procedure executions; a null context_json = no scope.
  s.setContext(
    sql`(select context_json from db.spark_conversations
         where id = ${opts.conversationId})`,
  );
}

export function sparkExecScriptExpr(
  opts: RegisterReactorsOpts,
  script: Sql,
  external = false,
  readOnly = false,
): Sql {
  const baseToolNames = [
    ...(opts.mcp !== false
      ? [
        "downloadFile",
        ...(opts.workspace
          ? ["downloadDriveFile", ...(!readOnly ? ["prepareDriveUpload"] : [])]
          : []),
      ]
      : []),
    "readCapability",
    "query",
    "listFiles",
    "readFile",
    ...(opts.knowledge ? ["loadDocument"] : []),
    ...(external
      ? [
        "actionReceipt",
        "listArtifacts",
        "readArtifact",
        ...(readOnly
          ? []
          : ["undoReceipt", "previewUndo", "undoReceipts", "createMessage"]),
      ]
      : [
        "askQuestions",
        "undoLastChanges",
        "listAttachments",
        "readAttachment",
        "readPdfText",
        "renderPdfPage",
        "context",
      ]),
    ...(opts.capabilities.some((capability) =>
        (capability.fileSources ?? []).length > 0
      )
      ? ["readFileImage"]
      : []),
    ...(opts.capabilities.some((capability) =>
        (capability.fileSources ?? []).some((source) => source.readPdfMarkup)
      )
      ? ["readFileMarkup"]
      : []),
  ];
  let baseProperties = baseToolNames.map((name) =>
    name === "downloadFile"
      ? `downloadFile: ${downloadFileJs}`
      : `${JSON.stringify(name)}: (...args) => __sparkHydrate(${name}(...args))`
  ).join(", ");
  if (external && !readOnly) {
    baseProperties +=
      `, saveArtifact: async ({name, mimeType, bytes, text}) => {
    if ((bytes === undefined) === (text === undefined)) throw new Error("Supply bytes or text");
    if (text !== undefined) bytes = new TextEncoder().encode(text);
    if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be Uint8Array");
    const id = await yolm.bytes.set(bytes);
    try { return await saveArtifact({name, mimeType: mimeType ?? "text/plain", bytesId: Number(id)}); }
    finally { yolm.bytes.drop(id); }
  }`;
  }
  let capabilityProperties: Sql = sql`''`;
  for (const capability of opts.capabilities) {
    if (
      (capability.actions ?? []).length === 0 &&
      (capability.functions ?? []).length === 0
    ) {
      continue;
    }
    capabilityProperties = sql`${capabilityProperties} || case
      when spark_js_conv_capabilities @> json_build_array(${
      sql.lit(capability.name)
    })
        then ${
      sql.lit(
        `, ${
          JSON.stringify(capability.name)
        }: __sparkWrapCapability(${capability.name})`,
      )
    }
      else '' end`;
  }
  const prefix = `try {
const {
  hydrate: __sparkHydrate,
  imageOutput: __sparkImageOutput,
  binaryMetadata: __sparkBinaryMetadata,
} = (() => {
const binaryMetadata = new WeakMap();
const __sparkHydrate = async (pending) => {
  const value = await pending;
  if (
    value === null || typeof value !== "object" ||
    value.__sparkBytesId === undefined
  ) {
    return value;
  }
  const scratchId = BigInt(value.__sparkBytesId);
  const bytes = await yolm.bytes.get(scratchId);
  yolm.bytes.drop(scratchId);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("Binary tool returned no bytes");
  }
  const metadata = {
    mimeType: value.mimeType,
    name: value.name,
    readEvidenceToken: value.__sparkReadEvidenceToken,
    renderWidth: value.renderWidth,
    renderHeight: value.renderHeight,
    outputWidth: value.outputWidth,
    outputHeight: value.outputHeight,
    crop: value.crop,
  };
  binaryMetadata.set(bytes, metadata);
  for (const key of [
    "renderWidth", "renderHeight", "outputWidth", "outputHeight", "crop",
  ]) {
    Object.defineProperty(bytes, key, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: metadata[key],
    });
  }
  return bytes;
};
const imageOutput = (bytes, options = {}) => {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("image() expects a Uint8Array");
  }
  if (bytes.byteLength === 0) {
    throw new TypeError("image() received an empty Uint8Array");
  }
  const metadata = binaryMetadata.get(bytes) ?? {};
  const mimeType = options.mimeType ?? metadata.mimeType;
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    throw new TypeError(
      "image() requires PNG, JPEG, or WebP bytes; pass { mimeType } for generated bytes",
    );
  }
  const detail = options.detail ?? "auto";
  if (!["auto", "low", "high"].includes(detail)) {
    throw new TypeError("image() detail must be auto, low, or high");
  }
  return {
    type: "image",
    bytes,
    mimeType,
    detail,
    readEvidenceToken: metadata.readEvidenceToken,
    frame: metadata.readEvidenceToken && metadata.renderWidth
      ? {
        name: metadata.name,
        full_page_width: metadata.renderWidth,
        full_page_height: metadata.renderHeight,
        crop: metadata.crop,
        emitted_width: metadata.outputWidth ?? metadata.crop?.width ?? metadata.renderWidth,
        emitted_height: metadata.outputHeight ?? metadata.crop?.height ?? metadata.renderHeight,
        coordinates: "Crop coordinates are top-left pixels in the full-page frame, not pixels in this emitted crop. For a different render width, rescale both axes before cropping.",
      }
      : undefined,
  };
};
return { hydrate: __sparkHydrate, imageOutput, binaryMetadata };
})();
const __sparkWrapCapability = (capability) => new Proxy(capability, {
  get: (target, property, receiver) => {
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== "function") return value;
    return (...args) => __sparkHydrate(Reflect.apply(value, target, args));
  },
});
const __sparkEmitImageInternal = globalThis.__sparkEmitImage;
delete globalThis.__sparkEmitImage;
const __sparkUnavailableApi = (name) => {
  throw new TypeError(
    name + " is unavailable in Spark exec; use a function under tools.*",
  );
};
const Deno = new Proxy({}, {
  get: () => __sparkUnavailableApi("Deno APIs"),
});
const process = undefined;
const require = undefined;
const fetch = () => __sparkUnavailableApi("fetch()");
const XMLHttpRequest = undefined;
const WebSocket = undefined;
const tools = { ${baseProperties}`;
  const suffix = ` };
${SPARK_SPREADSHEET_EXEC_HELPERS}
const __sparkOutputs = [];
const __sparkOriginalConsoleLog = console.log;
const __sparkOutputHeadChars = 24000;
const __sparkOutputTailChars = 15000;
const __sparkBoundText = (value) => {
  if (value.length <= 40000) return value;
  const retained = __sparkOutputHeadChars + __sparkOutputTailChars;
  return "Warning: tool output truncated before conversation storage.\\n" +
    "Original chars: " + value.length + "\\n\\n" +
    value.slice(0, __sparkOutputHeadChars) + "\\n[..." +
    (value.length - retained) + " chars truncated ...]\\n" +
    value.slice(-__sparkOutputTailChars);
};
const __sparkFormatText = (value) => {
  if (value instanceof Uint8Array) {
    throw new TypeError("Raw bytes cannot be printed; pass image bytes to image()");
  }
  if (typeof value === "string") return value;
  let rendered;
  try {
    rendered = JSON.stringify(
      value,
      (_key, item) => typeof item === "bigint" ? item.toString() : item,
      2,
    );
  } catch (_) {
    rendered = String(value);
  }
  return rendered === undefined ? String(value) : rendered;
};
const text = (value) => {
  const rendered = __sparkBoundText(__sparkFormatText(value));
  __sparkOutputs.push({ type: "text", text: rendered });
  __sparkOriginalConsoleLog(rendered);
  return value;
};
const image = (bytes, options = {}) => {
  const output = __sparkImageOutput(bytes, options);
  if (output.frame) {
    const ordinal = 1 + __sparkOutputs.filter((entry) => entry.type === "image").length;
    text({ pdf_image_frame: { image_ordinal: ordinal, ...output.frame } });
  }
  __sparkOutputs.push(output);
  return bytes;
};
console.log = (...values) => {
  const rendered = __sparkBoundText(
    values.map(__sparkFormatText).join(" "),
  );
  __sparkOriginalConsoleLog(rendered);
  __sparkOutputs.push({
    type: "text",
    text: rendered,
  });
};
const __sparkProgramResult = await (async () => {
`;
  const suffixAfterScript = `
})();
if (__sparkOutputs.length === 0) {
  text(__sparkProgramResult === undefined ? "[Completed]" : __sparkProgramResult);
}
const __sparkFinalOutputs = [];
for (const output of __sparkOutputs) {
  if (output.type === "text") {
    __sparkFinalOutputs.push(output);
    continue;
  }
  const scratchId = await yolm.bytes.set(output.bytes);
  try {
    __sparkFinalOutputs.push(await __sparkEmitImageInternal({
      bytesId: Number(scratchId),
      mimeType: output.mimeType,
      detail: output.detail,
      readEvidenceToken: output.readEvidenceToken,
    }));
  } finally {
    yolm.bytes.drop(scratchId);
  }
}
const __sparkTextOutputs = __sparkFinalOutputs.filter(
  (output) => output.type === "text",
);
const __sparkBoundedOutputs = [];
if (__sparkTextOutputs.length > 0) {
  __sparkBoundedOutputs.push({
    type: "text",
    text: __sparkBoundText(
      __sparkTextOutputs.map((output) => output.text).join("\\n"),
    ),
  });
}
__sparkBoundedOutputs.push(
  ...__sparkFinalOutputs.filter((output) => output.type !== "text"),
);
return { outputs: __sparkBoundedOutputs };
} catch (__sparkRuntimeError) {
  const __sparkRuntimeMessage = __sparkRuntimeError instanceof Error
    ? __sparkRuntimeError.message
    : String(__sparkRuntimeError);
  throw new Error("Spark exec runtime error: " + __sparkRuntimeMessage);
}
`;
  return sql`${sql.lit(prefix)} || ${capabilityProperties} || ${
    sql.lit(suffix)
  } || ${script} || ${sql.lit(suffixAfterScript)}`;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface SparkTool {
  name: string;
  timeoutMs?: number;
  statements: (s: GeneralServerStatements) => void;
}

function preflightSparkUi(
  s: GeneralServerStatements,
  capabilities: CapabilityOpts[],
  capabilitiesJsonRef: Sql,
  sourceExpr: Sql,
  prefix: string,
  allowedJsModules: string[],
) {
  defQueryWhitelists(s, capabilities, capabilitiesJsonRef, `${prefix}_policy`, {
    fieldPolicyShape: "ui",
  });
  s.serviceRequest({
    serviceType: sql.lit("dynamic_ui"),
    operation: sql.lit("preflight"),
    requestJson: sql`json_build_object(
      'source', ${sourceExpr},
      'accessPolicy', json_build_object(
        'tableWhitelist', ${sql.ref(`${prefix}_policy_table_whitelist`)}::json,
        'viewWhitelist', ${sql.ref(`${prefix}_policy_view_whitelist`)}::json,
        'fieldWhitelist', ${
      sql.ref(`${prefix}_policy_ui_field_whitelist`)
    }::json,
        'allowedJsModules', ${sql.lit(JSON.stringify(allowedJsModules))}::json
      )
    )`,
    defResultJsonScalar: `${prefix}_ui_preflight_result`,
    defErrorJsonScalar: `${prefix}_ui_preflight_error`,
  });
  // Callers read `${prefix}_ui_preflight_error` (null => the card compiled and
  // is safe to render). A failed card is dropped, not fatal, so we don't build
  // a user-facing error message here.
}

export function createSparkTools(
  opts: RegisterReactorsOpts,
  sharedExecutor = false,
): SparkTool[] {
  const reversibleActionNames = opts.capabilities.flatMap((capability) =>
    (capability.actions ?? [])
      .filter((action) => action.mode === "reversible")
      .map((action) => `${capability.name}.${action.name}`)
  );
  const reversibleActionCondition = (actionName: Sql) =>
    reversibleActionNames.length === 0
      ? sql`false`
      : sql`(${
        reversibleActionNames.slice(1).reduce(
          (condition, name) =>
            sql`${condition} or ${actionName} = ${sql.lit(name)}`,
          sql`${actionName} = ${sql.lit(reversibleActionNames[0])}`,
        )
      })`;
  const allFileSources = opts.capabilities.flatMap((capability) =>
    (capability.fileSources ?? []).map((source) => ({
      capability: capability.name,
      source,
    }))
  );
  const sourceLookupQuery = (
    source: NonNullable<CapabilityOpts["fileSources"]>[number],
    id: Sql,
  ) => {
    if (source.lookup) {
      return source.lookup(id, {
        sysUserId: sql`spark_js_owner_id`,
      });
    }
    if (!source.blobColumn || !source.mimeColumn) {
      throw new Error(
        `Spark file source "${source.name}" requires blobColumn and mimeColumn.`,
      );
    }
    return sql`select ${sql.ref(source.blobColumn)} as bh,
        ${sql.ref(source.mimeColumn)} as mime,
        ${source.nameColumn ? sql.ref(source.nameColumn) : sql`''`} as label
      from db.${sql.ref(source.table)} where id = ${id}`;
  };

  const READ_CAPABILITY: SparkTool = {
    name: "readCapability",
    statements: (s) => {
      s.defScalar("read_capability_raw_input", sql`tool_input->0`);
      s.defScalar(
        "read_capability_name",
        sql`case
          when json_typeof(read_capability_raw_input) = 'string'
            then trim(read_capability_raw_input::string)
          else trim(coalesce(read_capability_raw_input->>'name', ''))
        end`,
      );
      s.if(
        sql`read_capability_name = ''`,
        (s) => s.throwError(sql.lit`A capability name is required.`),
      );
      s.defScalar("read_capability_matched", false);
      for (const reference of SPARK_NATIVE_REFERENCES) {
        s.if(
          sql`not read_capability_matched
            and read_capability_name = ${sql.lit(reference.path)}`,
          (s) => {
            s.setScalar("read_capability_matched", true);
            s.return(sql`json_build_object(
              'name', ${sql.lit(reference.path)},
              'markdown', ${sql.lit(reference.markdown)}
            )`);
          },
        );
      }
      for (const capability of opts.capabilities) {
        s.if(
          sql`not read_capability_matched
            and read_capability_name = ${sql.lit(capability.name)}`,
          (s) => {
            s.setScalar("read_capability_matched", true);
            s.if(
              sql`not spark_js_conv_capabilities @> json_build_array(${
                sql.lit(capability.name)
              })`,
              (s) =>
                s.throwError(
                  sql
                    .lit`That capability is not enabled for this conversation.`,
                ),
            );
            s.if(sql`read_capability_raw_input->>'section' = 'schema'`, (s) => {
              for (
                const resource of new Set([
                  ...(capability.tables ?? []),
                  ...(capability.views ?? []),
                  ...(capability.fieldWhitelist ?? []).map((entry) =>
                    entry.table
                  ),
                ])
              ) {
                s.if(
                  sql`read_capability_raw_input->>'resource' = ${
                    sql.lit(resource)
                  }`,
                  (s) => {
                    s.return(sql`json_build_object(
                    'name', ${sql.lit(capability.name)},
                    'resource', ${sql.lit(resource)},
                    'markdown', ${
                      sql.lit(buildSchemaReference(capability, resource))
                    }
                  )`);
                  },
                );
              }
              s.throwError(
                sql
                  .lit`Choose a table or view exposed by this capability as resource.`,
              );
            });
            s.if(
              sql`coalesce(read_capability_raw_input->>'section', 'instructions') <> 'instructions'`,
              (s) => {
                s.throwError(sql.lit`section must be instructions or schema.`);
              },
            );
            s.return(sql`json_build_object(
              'name', ${sql.lit(capability.name)},
              'markdown', ${sql.lit(buildCapabilityDocText(capability))}
            )`);
          },
        );
      }
      s.if(
        sql`not read_capability_matched`,
        (s) =>
          s.throwError(
            sql
              .lit`Unknown capability. Use a name from the capability catalog.`,
          ),
      );
    },
  };

  const QUERY: SparkTool = {
    name: "query",
    statements: (s) => {
      // Background tool execution must evaluate permission-filtered views as
      // the conversation owner, not the reactor's ambient user.
      s.setCurrentUser(sql`spark_js_owner_id`);
      // Accept string or { sql, maxRows, file: { source, id } }. A governed
      // file binding loads one blob into a one-row procedure table so the
      // dynamic SQL can use pdf.* and xlsx.* directly.
      s.defScalar("query_raw_input", sql`tool_input->0`);
      s.defScalar(
        "query_sql",
        sql`case
          when json_typeof(query_raw_input) = 'string'
            then nullif(trim(query_raw_input::string), '')
          else nullif(trim(query_raw_input->>'sql'), '')
        end`,
      );
      s.defScalar(
        "query_max_rows",
        sql`least(1000, greatest(1, case
          when json_typeof(query_raw_input) = 'string' then 1000
          else coalesce(try_cast(query_raw_input->>'maxRows' as int), 1000)
        end))`,
      );
      s.if(
        sql`query_sql is null`,
        (s) => s.throwError(sql.lit`sql query is required`),
      );
      if (allFileSources.length > 0) {
        s.defScalar(
          "query_file_source",
          sql`case when json_typeof(query_raw_input) = 'object'
            then nullif(trim(query_raw_input->'file'->>'source'), '')
            else null end`,
        );
        s.defScalar(
          "query_file_id",
          sql`case when json_typeof(query_raw_input) = 'object'
            then try_cast(query_raw_input->'file'->>'id' as bigint)
            else null end`,
        );
        s.if(
          sql`(query_file_source is null) != (query_file_id is null)`,
          (s) =>
            s.throwError(
              sql
                .lit`file.source and file.id must either both be supplied or both be omitted`,
            ),
        );
        s.defScalar("query_file_matched", false);
        s.defScalar("source_file_bytes", {
          type: { type: "Bytes", maxLength: 1000000000 },
        });
        s.defScalar("source_file_name", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("source_file_mime", {
          type: { type: "String", maxLength: 255 },
        });
        s.defTable("source_file", {
          fields: [
            {
              name: "file_bytes",
              type: { type: "Bytes", maxLength: 1000000000 },
              notNull: true,
            },
            {
              name: "file_name",
              type: { type: "String", maxLength: 1000 },
              notNull: true,
            },
            {
              name: "mime_type",
              type: { type: "String", maxLength: 255 },
              notNull: true,
            },
          ],
        });
        for (const { capability, source } of allFileSources) {
          s.if(
            sql`query_file_source = ${sql.lit(source.name)}
              and spark_js_conv_capabilities @> json_build_array(${
              sql.lit(capability)
            })`,
            (s) => {
              s.defRecord(
                "query_source_file",
                sourceLookupQuery(source, sql`query_file_id`),
              );
              s.if(sql`query_source_file.bh is null`, (s) => {
                s.throwError(
                  sql`'File not found in source "' || query_file_source ||
                    '": id ' || query_file_id::string`,
                );
              });
              s.readBlob(sql`query_source_file.bh`, {
                setContentScalar: "source_file_bytes",
              });
              s.setScalar(
                "source_file_name",
                sql`coalesce(query_source_file.label, '')`,
              );
              s.setScalar(
                "source_file_mime",
                sql`coalesce(query_source_file.mime, 'application/octet-stream')`,
              );
              s.if(sql`spark_js_execution_event_id is not null`, (s) => {
                s.startTransaction();
                s.modify(sql`
                update db.spark_agent_events
                set payload = coalesce(payload, '{}'::json) ||
                  json_build_object(
                    'file_reads',
                    coalesce(payload->'file_reads', '[]'::json) ||
                      json_build_array(json_build_object(
                        'tool', 'query',
                        'source', query_file_source,
                        'file_version_id', query_file_id,
                        'blob_hash', bytes.to_hex(query_source_file.bh),
                        'label', source_file_name,
                        'mime', source_file_mime
                      ))
                  )
                where id = spark_js_execution_event_id
                  and spark_agent_id = spark_js_agent_id
              `);
                s.commitTransaction();
              });
              s.modify(sql`
                insert into source_file (file_bytes, file_name, mime_type)
                values (
                  source_file_bytes,
                  source_file_name,
                  source_file_mime
                )
              `);
              s.setScalar("query_file_matched", true);
            },
          );
        }
        s.if(
          sql`query_file_source is not null and not query_file_matched`,
          (s) =>
            s.throwError(
              sql`'Unknown or unavailable file source: ' || query_file_source`,
            ),
        );
      }

      // Static-skill access policy: compute the view/table whitelist from the
      // conversation's capabilities first — the exact query string is validated
      // against it below.
      defQueryWhitelists(
        s,
        opts.capabilities,
        sql`spark_js_conv_capabilities`,
        "q",
      );

      // A conversation whose skills grant NO views, NO tables, and NO
      // field-whitelisted columns has no data access — and crucially, an
      // EMPTY whitelist means "no restriction" at the engine layer, silently
      // granting full read access. Guard on the COMPUTED whitelists, not just
      // an empty capabilities_json: an action-only or misconfigured
      // capability yields capabilities_json != '[]' but empty whitelists,
      // which would otherwise fall open to the whole database. A
      // fieldWhitelist-only capability (e.g. auth_activity) is real access.
      s.if(
        sql`q_view_whitelist = '[]' and q_table_whitelist = '[]'
          and q_field_whitelist = '{}'`,
        (s) =>
          s.throwError(
            sql
              .lit`You have no data access in this conversation, so no queries can run. Tell the user and suggest they ask an administrator about access.`,
          ),
      );

      s.setScalar(
        "query_sql",
        sql`'SELECT * FROM (' || query_sql || ') AS _q LIMIT ' || cast(query_max_rows as string)`,
      );
      if (allFileSources.length > 0) {
        s.defScalar(
          "q_execution_table_whitelist",
          sql`case when q_table_whitelist = '[]'
            then '["proc.source_file"]'
            else left(q_table_whitelist, length(q_table_whitelist) - 1) ||
              ',"proc.source_file"]'
          end`,
        );
        // ValidateDynamicQuery intentionally has no access to procedure-local
        // tables. Preserve its friendlier errors for ordinary database queries;
        // file-bound queries are compiled and policy-checked by DynamicQueryToCsv.
        s.if(sql`query_file_source is null`, (s) => {
          s.validateDynamicQuery(sql`query_sql`, "query_check", {
            viewWhitelist: sql`q_view_whitelist`,
            tableWhitelist: sql`q_table_whitelist`,
            fieldWhitelist: sql`q_field_whitelist`,
          });
          s.if(
            sql`coalesce(query_check.message, query_check.description) is not null`,
            (s) => {
              s.throwError(
                sql`'Query rejected: ' ||
                    coalesce(nullif(query_check.message, ''),
                             query_check.description, 'invalid query')`,
              );
            },
          );
        });
        s.dynamicQueryToCsv(sql`query_sql`, {
          defScalar: "query_result_csv",
          viewWhitelist: sql`q_view_whitelist`,
          tableWhitelist: sql`q_execution_table_whitelist`,
          fieldWhitelist: sql`q_field_whitelist`,
          accessibleTableScopes: ["proc"],
          tableScopeWhitelist: ["source_file"],
        });
      } else {
        s.validateDynamicQuery(sql`query_sql`, "query_check", {
          viewWhitelist: sql`q_view_whitelist`,
          tableWhitelist: sql`q_table_whitelist`,
          fieldWhitelist: sql`q_field_whitelist`,
        });
        s.if(
          sql`coalesce(query_check.message, query_check.description) is not null`,
          (s) => {
            s.throwError(
              sql`'Query rejected: ' ||
                  coalesce(nullif(query_check.message, ''),
                           query_check.description, 'invalid query')`,
            );
          },
        );
        s.dynamicQueryToCsv(sql`query_sql`, {
          defScalar: "query_result_csv",
          viewWhitelist: sql`q_view_whitelist`,
          tableWhitelist: sql`q_table_whitelist`,
          fieldWhitelist: sql`q_field_whitelist`,
        });
      }

      // No per-query timeline row: the canonical agent event already retains
      // the execution details needed for model continuation.

      if (allFileSources.length > 0) {
        s.return(sql`json_build_object(
          'data', coalesce(query_result_csv, ''),
          'file', case when query_file_source is null then null else
            json_build_object(
              'source', query_file_source,
              'id', query_file_id,
              'name', (select file_name from source_file),
              'mimeType', (select mime_type from source_file),
              'byteLength', (
                select octet_length(file_bytes) from source_file
              )
            )
          end
        )`);
      } else {
        s.return(
          sql`json_build_object('data', coalesce(query_result_csv, ''))`,
        );
      }
    },
  };

  // --- Action tools (skill-namespaced) ---
  // Each action of each skill gets a callable tool: skillName.actionName.
  // Approval-mode actions persist their input while waiting for a person or
  // policy. Reversible actions consume it immediately and retain only the
  // transaction receipt.
  const actionTools: SparkTool[] = [];
  for (const skill of opts.capabilities) {
    for (const a of skill.actions ?? []) {
      const toolName = `${skill.name}.${a.name}`;
      actionTools.push({
        name: toolName,
        statements: (s) => {
          s.block((s) => {
            s.defScalar(
              "act_input",
              sql`coalesce((tool_input->0)::json, '{}'::json)`,
            );
            // Static skill set: the conversation must include this skill.
            s.defScalar(
              "act_skill_enabled",
              sql`spark_js_conv_capabilities @> json_build_array(${
                sql.lit(skill.name)
              })`,
            );
            s.if(sql`not act_skill_enabled`, (s) => {
              s.throwError(
                sql
                  .lit`Capability "${skill.name}" is not enabled for this conversation or its permission is no longer held.`,
              );
            });
            s.defScalar(
              "act_sys_user_id",
              {
                expr:
                  sql`(select sys_user_id from db.spark_conversations where id = spark_js_conversation_id)`,
                allowNoRead: true,
              },
            );
            // Check action-level permissions.
            if (a.permission !== undefined || a.permissions) {
              s.defScalar(
                "act_has_permissions",
                hasSparkPermissionGate(
                  a.permission,
                  a.permissions,
                  sql`act_sys_user_id`,
                ),
              );
              s.if(sql`not act_has_permissions`, (s) => {
                s.throwError(
                  sql
                    .lit`You do not have permission to use the "${toolName}" action.`,
                );
              });
            }
            s.defScalar(
              "act_execution_event_id",
              sql`spark_js_execution_event_id`,
            );
            s.startTransaction();
            s.modify(
              a.mode === "reversible"
                ? sql`
                insert into db.spark_action_log
                  (spark_conversation_id, execution_event_id,
                   action_name, danger, status)
                values (
                  spark_js_conversation_id,
                  act_execution_event_id,
                  ${sql.lit(toolName)},
                  ${sql.lit(a.danger ?? "low")},
                  'approved'
                )
              `
                : sql`
                insert into db.spark_action_log
                  (spark_conversation_id, execution_event_id,
                   action_name, input_json, danger, status)
                values (
                  spark_js_conversation_id,
                  act_execution_event_id,
                  ${sql.lit(toolName)},
                  act_input,
                  ${sql.lit(a.danger ?? "low")},
                  'proposed'
                )
              `,
            );
            s.defScalar(
              "act_action_id",
              sql`last_record_id(db.spark_action_log)`,
            );
            if (a.mode === "reversible") {
              s.commitTransaction();
              s.defScalar("action_input", sql`act_input`);
              s.defScalar("action_sys_user_id", {
                expr: sql`act_sys_user_id`,
                allowNoRead: true,
              });
              executeSparkReversibleAction(s, {
                action: a,
                receiptId: sql`act_action_id`,
                cacheTransactionId: true,
                beforeMutation: (s) => {
                  if (sharedExecutor) refreshSparkExecAccess(s);
                  s.if(
                    sql`not (spark_js_conv_capabilities @> json_build_array(${
                      sql.lit(skill.name)
                    })) or not (${
                      hasSparkPermissionGate(
                        a.permission,
                        a.permissions,
                        sql`spark_js_owner_id`,
                      )
                    })`,
                    (s) =>
                      s.throwError(
                        sql.lit`Access was revoked before execution.`,
                      ),
                  );
                },
                event: (s, failed) =>
                  s.modify(sql`
                  insert into db.spark_agent_events
                    (spark_agent_id, type, content, action_id, payload, created_at)
                  values (spark_js_agent_id,
                    ${sql.lit(failed ? "error_occurred" : "action_executed")},
                    ${
                    failed
                      ? sql`action_result::json->>'error'`
                      : sql.lit(`Executed: ${toolName}`)
                  },
                    act_action_id,
                    ${
                    failed
                      ? sql`null::json`
                      : sql`json_build_object('result_hash', bytes.to_hex(crypto.sha256(string.to_utf8(cast(coalesce(try_cast(action_result as json), '{}'::json) as string)))))`
                  },
                    now())`),
              });
            } else {
              s.modify(sql`
                insert into db.spark_agent_events
                  (spark_agent_id, type, content, action_id, created_at)
                values (
                  spark_js_agent_id,
                  'action_proposed',
                  ${sql.lit(`Proposed: ${toolName}`)},
                  act_action_id,
                  now()
                )
              `);
              s.commitTransaction();
            }
            s.return(
              a.mode === "reversible"
                ? sql`json_build_object(
                  'action_id', act_action_id,
                  'status', (select status from db.spark_action_log where id = act_action_id),
                  'result', coalesce(
                    try_cast(action_result as json), '{}'::json
                  )
                )`
                : sql`json_build_object('action_id', act_action_id, 'status', 'proposed')`,
            );
          });
        },
      });
    }
  }

  // --- Function tools (skill-namespaced) ---
  // Read-only domain computation that runs immediately inside the script.
  // The function procedure reads the `function_input` JSON scalar and must
  // call s.return(<json expr>) with its result.
  const functionTools: SparkTool[] = [];
  for (const skill of opts.capabilities) {
    for (const f of skill.functions ?? []) {
      const toolName = `${skill.name}.${f.name}`;
      functionTools.push({
        name: toolName,
        timeoutMs: f.timeoutMs,
        statements: (s) => {
          s.defScalar(
            "fn_skill_enabled",
            sql`spark_js_conv_capabilities @> json_build_array(${
              sql.lit(skill.name)
            })`,
          );
          s.if(sql`not fn_skill_enabled`, (s) => {
            s.throwError(
              sql
                .lit`Capability "${skill.name}" is not enabled for this conversation.`,
            );
          });
          s.defScalar(
            "function_input",
            {
              expr: sql`coalesce((tool_input->0)::json, '{}'::json)`,
              allowNoRead: true,
            },
          );
          s.if(sql`spark_js_execution_event_id is not null`, (s) => {
            s.startTransaction();
            s.modify(sql`
            update db.spark_agent_events
            set payload = coalesce(payload, '{}'::json) ||
              json_build_object(
                'function_calls',
                coalesce(payload->'function_calls', '[]'::json) ||
                  json_build_array(json_build_object(
                    'function', ${sql.lit(toolName)},
                    'input', function_input
                  ))
              )
            where id = spark_js_execution_event_id
              and spark_agent_id = spark_js_agent_id
          `);
            s.commitTransaction();
          });
          f.procedure(s, {
            sysUserId: sql`spark_js_owner_id`,
            nativeExecution: {
              eventId: sql`spark_js_execution_event_id`,
              agentId: sql`spark_js_agent_id`,
            },
          });
        },
      });
    }
  }

  // File sources: readFileImage reads an image or renders one PDF page from a
  // capability-declared system-file table. Crops require an explicit page
  // render width so their coordinate space cannot be ambiguous.
  const fileImageTools: SparkTool[] = [];
  if (allFileSources.length > 0) {
    fileImageTools.push({
      name: "readFileImage",
      timeoutMs: SPARK_FILE_READ_TIMEOUT_MS,
      statements: (s) => {
        s.defScalar(
          "lf_input",
          sql`coalesce((tool_input->0)::json, '{}'::json)`,
        );
        s.defScalar("lf_source", sql`lf_input->>'source'`);
        s.defScalar("lf_id", sql`(lf_input->>'id')::bigint`);
        // PDFs are rendered to a PNG of one page (default 1).
        s.defScalar(
          "lf_page_requested",
          sql`lf_input->>'page' is not null`,
        );
        s.defScalar(
          "lf_page",
          sql`coalesce(try_cast(lf_input->>'page' as int), 1)`,
        );
        s.if(
          sql`lf_page_requested and (
            try_cast(lf_input->>'page' as int) is null or lf_page < 1
          )`,
          (s) =>
            s.throwError(
              sql.lit`page must be a positive integer`,
            ),
        );
        s.defScalar(
          "lf_render_width_requested",
          sql`lf_input->>'width' is not null`,
        );
        s.defScalar(
          "lf_render_width",
          sql`coalesce(
            try_cast(lf_input->>'width' as int), ${SPARK_PDF_RENDER_WIDTH}
          )`,
        );
        s.if(
          sql`lf_render_width_requested and (
            try_cast(lf_input->>'width' as int) is null
            or lf_render_width not between 320 and 4096
          )`,
          (s) =>
            s.throwError(
              sql.lit`width must be an integer from 320 through 4096`,
            ),
        );
        s.defScalar("lf_effective_render_width", sql`lf_render_width`);
        s.defScalar(
          "lf_render_mode",
          sql`coalesce(lf_input->>'renderMode', 'annotated')`,
        );
        s.if(
          sql`lf_render_mode not in ('annotated', 'original')`,
          (s) =>
            s.throwError(
              sql
                .lit`renderMode must be either "annotated" or "original"`,
            ),
        );
        s.defScalar("lf_crop_x", sql`try_cast(lf_input->'crop'->>'x' as int)`);
        s.defScalar("lf_crop_y", sql`try_cast(lf_input->'crop'->>'y' as int)`);
        s.defScalar(
          "lf_crop_width",
          sql`try_cast(lf_input->'crop'->>'width' as int)`,
        );
        s.defScalar(
          "lf_crop_height",
          sql`try_cast(lf_input->'crop'->>'height' as int)`,
        );
        s.defScalar(
          "lf_crop_requested",
          sql`lf_input->'crop' is not null`,
        );
        s.defScalar(
          "lf_crop_output_width",
          sql`try_cast(lf_input->>'outputWidth' as int)`,
        );
        s.defScalar(
          "lf_output_width_requested",
          sql`lf_input->>'outputWidth' is not null`,
        );
        s.defScalar(
          "lf_crop_output_width_requested",
          sql`lf_crop_requested and lf_output_width_requested`,
        );
        s.if(
          sql`lf_crop_requested and not lf_render_width_requested`,
          (s) =>
            s.throwError(
              sql
                .lit`crop requires an explicit top-level width selecting the full-page pixel coordinate space; use the same width as the full-page read that supplied the crop coordinates (4096 for maximum detail)`,
            ),
        );
        s.if(
          sql`lf_output_width_requested and not lf_crop_requested`,
          (s) =>
            s.throwError(
              sql
                .lit`outputWidth requires crop; use top-level width to set full-page render resolution`,
            ),
        );
        s.if(
          sql`lf_crop_requested and (
            lf_crop_x is null or lf_crop_y is null
            or lf_crop_width is null or lf_crop_height is null
            or lf_crop_width <= 0 or lf_crop_height <= 0
          )`,
          (s) =>
            s.throwError(
              sql
                .lit`crop requires integer x, y, width, and height; width and height must be positive`,
            ),
        );
        s.if(
          sql`lf_crop_output_width_requested and (
            lf_crop_output_width is null
            or lf_crop_output_width < 64
            or lf_crop_output_width > 4096
          )`,
          (s) =>
            s.throwError(
              sql
                .lit`outputWidth requires a crop and must be an integer from 64 through 4096`,
            ),
        );
        s.if(
          sql`lf_crop_output_width_requested
            and lf_render_mode != 'original'`,
          (s) =>
            s.throwError(
              sql
                .lit`outputWidth is only available with renderMode "original"`,
            ),
        );
        s.defScalar("lf_done", false);
        for (const { capability, source } of allFileSources) {
          s.if(
            sql`not lf_done and lf_source = ${sql.lit(source.name)}
              and spark_js_conv_capabilities @> json_build_array(${
              sql.lit(capability)
            })`,
            (s) => {
              s.defRecord(
                "lf_file",
                sourceLookupQuery(source, sql`lf_id`),
              );
              s.if(
                sql`lf_file.bh is null`,
                (s) =>
                  s.throwError(
                    sql`'File not found in source "' || lf_source ||
                        '": id ' || coalesce(lf_id::string, '(none)')`,
                  ),
              );
              s.if(
                sql`lower(lf_file.mime) not in (
                  'application/pdf', 'image/png', 'image/jpeg', 'image/webp'
                )`,
                (s) =>
                  s.throwError(
                    sql`'readFileImage accepts PDF, PNG, JPEG, or WebP; "' ||
                        coalesce(lf_file.label, '') || '" is ' ||
                        coalesce(lf_file.mime, '(unknown)')`,
                  ),
              );
              s.if(
                sql`lower(lf_file.mime) != 'application/pdf'
                  and (lf_page_requested or lf_render_width_requested
                    or lf_crop_requested or lf_output_width_requested
                    or lf_input->>'renderMode' is not null)`,
                (s) =>
                  s.throwError(
                    sql
                      .lit`page, width, crop, renderMode, and outputWidth apply only to PDF files; read raster images without PDF rendering options`,
                  ),
              );
              s.if(
                sql`lf_crop_output_width_requested
                  and lf_file.mime != 'application/pdf'`,
                (s) =>
                  s.throwError(
                    sql
                      .lit`outputWidth is only available for application/pdf files`,
                  ),
              );
              s.readBlob(sql`lf_file.bh`, { defContentScalar: "lf_bytes" });
              s.defScalar("lf_final_mime", sql`lower(lf_file.mime)`);
              s.defScalar("lf_final_label", sql`coalesce(lf_file.label, '')`);
              s.defScalar("lf_read_evidence_token", sql`random.uuid()`);
              s.defScalar("lf_scratch_id", { type: "BigInt" });
              s.defScalar("lf_image_bytes", {
                type: { type: "Bytes", maxLength: 1000000000 },
              });
              s.defScalar("lf_effective_render_height", {
                expr: sql`null::int`,
                allowNoRead: true,
              });
              s.defScalar("lf_direct_crop_rendered", false);
              s.defScalar("lf_direct_crop_output_width", {
                expr: sql`null::int`,
                allowNoRead: true,
              });
              s.defScalar("lf_direct_crop_output_height", {
                expr: sql`null::int`,
                allowNoRead: true,
              });
              s.if(sql`lf_file.mime = 'application/pdf'`, (s) => {
                s.defScalar(
                  "lf_page_count",
                  sql`(select count(*) from pdf.pages(lf_bytes))`,
                );
                s.if(
                  sql`lf_page > lf_page_count`,
                  (s) =>
                    s.throwError(
                      sql`'Page ' || lf_page::string || ' is out of range: "' ||
                          coalesce(lf_file.label, '') || '" has ' ||
                          lf_page_count::string || ' pages.'`,
                    ),
                );
                s.defRecord(
                  "lf_page_info",
                  sql`select width, height
                    from pdf.pages(lf_bytes) where page = lf_page`,
                );
                s.setScalar(
                  "lf_effective_render_width",
                  sql`case when lf_crop_output_width_requested then
                      lf_render_width
                    else least(
                      lf_render_width,
                      greatest(320, coalesce(try_cast(floor(sqrt(
                        16777216.0 * lf_page_info.width /
                          nullif(lf_page_info.height, 0)
                      )) as int), lf_render_width))
                    ) end`,
                );
                s.setScalar(
                  "lf_effective_render_height",
                  sql`greatest(1, try_cast(ceil(
                    lf_effective_render_width * lf_page_info.height /
                      nullif(lf_page_info.width, 0)
                  ) as int))`,
                );
                s.if(
                  sql`not lf_crop_output_width_requested and
                    lf_effective_render_width::bigint * lf_effective_render_height > 16777216`,
                  (s) => {
                    s.setScalar(
                      "lf_effective_render_width",
                      sql`lf_effective_render_width - 1`,
                    );
                    s.setScalar(
                      "lf_effective_render_height",
                      sql`greatest(1, try_cast(ceil(
                      lf_effective_render_width * lf_page_info.height /
                        nullif(lf_page_info.width, 0)
                    ) as int))`,
                    );
                  },
                );
                s.if(
                  sql`lf_crop_requested and lf_effective_render_width <> lf_render_width`,
                  (s) =>
                    s.throwError(
                      sql`'This PDF requires a smaller full-page render. Crop coordinates were not applied. Read the page at width ' ||
                      lf_effective_render_width::string ||
                      ' and use that returned width and its pixel coordinates, or use renderMode "original" with outputWidth for a direct source-region crop in the requested coordinate space.'`,
                    ),
                );
                s.if(
                  sql`lf_crop_requested and (
                    lf_crop_x < 0 or lf_crop_y < 0
                    or lf_crop_x > lf_effective_render_width
                    or lf_crop_y > lf_effective_render_height
                    or lf_crop_width >
                      lf_effective_render_width - lf_crop_x
                    or lf_crop_height >
                      lf_effective_render_height - lf_crop_y
                  )`,
                  (s) =>
                    s.throwError(
                      sql`'crop (' || lf_crop_x::string || ', ' ||
                        lf_crop_y::string || ', ' || lf_crop_width::string ||
                        ' × ' || lf_crop_height::string ||
                        ') falls outside the PDF page render (' ||
                        lf_effective_render_width::string || ' × ' ||
                        lf_effective_render_height::string || ')'`,
                    ),
                );
                s.if(sql`lf_crop_output_width_requested`, (s) => {
                  if (sharedExecutor) {
                    s.if(sql`spark_read_only`, (s) =>
                      s.throwError(
                        sql.lit`outputWidth requires mutable execution.`,
                      ));
                  }
                  s.defScalar(
                    "lf_source_region",
                    sql`json_build_object(
                      'min', json_build_object(
                        'x', lf_crop_x::double /
                          lf_effective_render_width::double,
                        'y', 1.0 - (
                          lf_crop_y + lf_crop_height
                        )::double / lf_effective_render_height::double
                      ),
                      'max', json_build_object(
                        'x', (lf_crop_x + lf_crop_width)::double /
                          lf_effective_render_width::double,
                        'y', 1.0 - lf_crop_y::double /
                          lf_effective_render_height::double
                      )
                    )`,
                  );
                  s.serviceRequest({
                    serviceType: sql.lit`processing`,
                    operation: sql.lit`pdf_render_source_region`,
                    usageContext:
                      sql`json_build_object('conversationId', spark_js_conversation_id::string)`,
                    optIn: true,
                    requestJson: sql`json_build_object(
                      'sourceBlobHash', bytes.to_hex(lf_file.bh),
                      'pageNumber', lf_page,
                      'region', lf_source_region,
                      'outputWidth', lf_crop_output_width
                    )`,
                    defResultJsonScalar: "lf_direct_crop_response",
                    defErrorJsonScalar: "lf_direct_crop_error",
                  });
                  s.if(sql`lf_direct_crop_error is not null`, (s) => {
                    s.throwError(
                      sql`'PDF source-region render failed: ' ||
                        cast(lf_direct_crop_error as string)`,
                    );
                  });
                  s.defScalar(
                    "lf_direct_crop_result",
                    sql`lf_direct_crop_response::json->'resultJson'`,
                  );
                  s.defScalar(
                    "lf_direct_crop_blob_hash",
                    sql`lf_direct_crop_result->>'imageBlobHash'`,
                  );
                  s.defScalar(
                    "lf_direct_crop_validation_failure",
                    pdfSourceRegionRenderValidationFailure(
                      sql`lf_direct_crop_response`,
                      sql`bytes.to_hex(lf_file.bh)`,
                      sql`lf_page`,
                      sql`lf_source_region`,
                      sql`lf_crop_output_width`,
                    ),
                  );
                  s.if(
                    sql`lf_direct_crop_validation_failure is not null`,
                    (s) =>
                      s.throwError(
                        sql`'PDF source-region renderer returned invalid evidence; failed predicate: ' ||
                          lf_direct_crop_validation_failure || '.'`,
                      ),
                  );
                  s.setScalar(
                    "lf_direct_crop_output_width",
                    sql`try_cast(
                      lf_direct_crop_result->>'outputWidthPx' as int
                    )`,
                  );
                  s.setScalar(
                    "lf_direct_crop_output_height",
                    sql`try_cast(
                      lf_direct_crop_result->>'outputHeightPx' as int
                    )`,
                  );
                  s.readBlob(
                    sql`bytes.from_hex(lf_direct_crop_blob_hash)`,
                    { defContentScalar: "lf_direct_crop_png" },
                  );
                  s.setScalar("lf_image_bytes", sql`lf_direct_crop_png`);
                  s.setScalar("lf_direct_crop_rendered", true);
                }).else((s) => {
                  const renderPdfPage = source.renderPdfPage;
                  if (renderPdfPage) {
                    s.if(sql`lf_render_mode = 'original'`, (s) => {
                      s.pdfRenderPage({
                        pdf: sql`lf_bytes`,
                        page: sql`lf_page`,
                        width: sql`lf_effective_render_width`,
                        defOutputScalar: "lf_original_png",
                      });
                      s.setScalar("lf_image_bytes", sql`lf_original_png`);
                    }).else((s) => {
                      renderPdfPage(s, {
                        fileId: sql`lf_id`,
                        pdf: sql`lf_bytes`,
                        page: sql`lf_page`,
                        pageWidth: sql`lf_page_info.width`,
                        pageHeight: sql`lf_page_info.height`,
                        renderWidth: sql`lf_effective_render_width`,
                        defOutputScalar: "lf_annotated_png",
                      });
                      s.setScalar("lf_image_bytes", sql`lf_annotated_png`);
                    });
                  } else {
                    s.pdfRenderPage({
                      pdf: sql`lf_bytes`,
                      page: sql`lf_page`,
                      width: sql`lf_effective_render_width`,
                      defOutputScalar: "lf_png",
                    });
                    s.setScalar("lf_image_bytes", sql`lf_png`);
                  }
                });
                s.setScalar("lf_final_mime", sql.lit`image/png`);
                s.setScalar(
                  "lf_final_label",
                  sql`lf_final_label || ' — page ' || lf_page::string`,
                );
              }).else((s) => {
                s.setScalar("lf_image_bytes", sql`lf_bytes`);
              });
              s.if(
                sql`lf_crop_requested and not lf_direct_crop_rendered`,
                (s) => {
                  s.cropImage({
                    inBytes: sql`lf_image_bytes`,
                    x: sql`lf_crop_x`,
                    y: sql`lf_crop_y`,
                    width: sql`lf_crop_width`,
                    height: sql`lf_crop_height`,
                    defOutBytesScalar: "lf_cropped_png",
                  });
                  s.setScalar("lf_image_bytes", sql`lf_cropped_png`);
                  s.setScalar("lf_final_mime", sql.lit`image/png`);
                  s.setScalar(
                    "lf_final_label",
                    sql`lf_final_label || ' — crop (' || lf_crop_x::string ||
                    ', ' || lf_crop_y::string || ', ' ||
                    lf_crop_width::string || ' × ' || lf_crop_height::string || ')'`,
                  );
                },
              );
              s.if(sql`lf_direct_crop_rendered`, (s) => {
                s.setScalar("lf_final_mime", sql.lit`image/png`);
                s.setScalar(
                  "lf_final_label",
                  sql`lf_final_label || ' — direct crop (' ||
                    lf_crop_x::string || ', ' || lf_crop_y::string || ', ' ||
                    lf_crop_width::string || ' × ' ||
                    lf_crop_height::string || ') at ' ||
                    lf_direct_crop_output_width::string || ' px wide'`,
                );
              });
              s.if(sql`spark_js_execution_event_id is not null`, (s) => {
                s.startTransaction();
                s.modify(sql`
                update db.spark_agent_events
                set payload = coalesce(payload, '{}'::json) ||
                  json_build_object(
                    'file_reads',
                    coalesce(payload->'file_reads', '[]'::json) ||
                      json_build_array(json_build_object(
                        'tool', 'readFileImage',
                        'evidence_token', lf_read_evidence_token,
                        'source', lf_source,
                        'file_version_id', lf_id,
                        'blob_hash', bytes.to_hex(lf_file.bh),
                        'label', coalesce(lf_file.label, ''),
                        'mime', coalesce(
                          lf_file.mime,
                          'application/octet-stream'
                        ),
                        'page', case when lower(lf_file.mime) = 'application/pdf'
                          then lf_page else null end,
                        'render_width', case
                          when lower(lf_file.mime) = 'application/pdf'
                          then lf_effective_render_width else null end,
                        'render_height', lf_effective_render_height,
                        'render_mode', case
                          when lower(lf_file.mime) = 'application/pdf'
                          then lf_render_mode else null end,
                        'output_width', case
                          when lf_direct_crop_rendered then
                            lf_direct_crop_output_width
                          else null end,
                        'output_height', case
                          when lf_direct_crop_rendered then
                            lf_direct_crop_output_height
                          else null end,
                        'crop', case when lf_crop_requested then
                          json_build_object(
                            'x', lf_crop_x,
                            'y', lf_crop_y,
                            'width', lf_crop_width,
                            'height', lf_crop_height
                          )
                        else null end
                      ))
                  )
                where id = spark_js_execution_event_id
                  and spark_agent_id = spark_js_agent_id
              `);
                s.commitTransaction();
              });
              s.setJsBytes(sql`lf_image_bytes`, {
                setIdScalar: "lf_scratch_id",
              });
              s.setScalar("lf_done", true);
              s.return(sql`json_build_object(
                '__sparkBytesId', lf_scratch_id,
                'name', lf_final_label,
                'mimeType', lf_final_mime,
                '__sparkReadEvidenceToken', lf_read_evidence_token,
                'renderWidth', case
                  when lower(lf_file.mime) = 'application/pdf'
                  then lf_effective_render_width else null end,
                'renderHeight', lf_effective_render_height,
                'outputWidth', case when lf_direct_crop_rendered then
                  lf_direct_crop_output_width else null end,
                'outputHeight', case when lf_direct_crop_rendered then
                  lf_direct_crop_output_height else null end,
                'crop', case when lf_crop_requested then json_build_object(
                  'x', lf_crop_x,
                  'y', lf_crop_y,
                  'width', lf_crop_width,
                  'height', lf_crop_height
                ) else null end
              )`);
            },
          );
        }
        s.if(
          sql`not lf_done`,
          (s) =>
            s.throwError(
              sql`'Unknown or unavailable file source: ' ||
                  coalesce(lf_source, '(none)')`,
            ),
        );
      },
    });
  }

  // Structured saved annotations and rotations for sources that expose them.
  const fileMarkupTools: SparkTool[] = [];
  if (allFileSources.some(({ source }) => source.readPdfMarkup)) {
    fileMarkupTools.push({
      name: "readFileMarkup",
      statements: (s) => {
        s.defScalar(
          "lfm_input",
          sql`coalesce((tool_input->0)::json, '{}'::json)`,
        );
        s.defScalar("lfm_source", sql`lfm_input->>'source'`);
        s.defScalar("lfm_id", sql`try_cast(lfm_input->>'id' as bigint)`);
        s.defScalar("lfm_page", sql`try_cast(lfm_input->>'page' as int)`);
        s.if(
          sql`lfm_input->'page' is not null
            and (lfm_page is null or lfm_page < 1)`,
          (s) =>
            s.throwError(
              sql.lit`page must be a positive one-based page number`,
            ),
        );
        s.defScalar("lfm_done", false);
        for (const { capability, source } of allFileSources) {
          const readPdfMarkup = source.readPdfMarkup;
          if (!readPdfMarkup) continue;
          s.if(
            sql`not lfm_done and lfm_source = ${sql.lit(source.name)}
              and spark_js_conv_capabilities @> json_build_array(${
              sql.lit(capability)
            })`,
            (s) => {
              s.defRecord(
                "lfm_file",
                sourceLookupQuery(source, sql`lfm_id`),
              );
              s.if(
                sql`lfm_file.bh is null`,
                (s) =>
                  s.throwError(
                    sql`'File not found in source "' || lfm_source ||
                        '": id ' || coalesce(lfm_id::string, '(none)')`,
                  ),
              );
              s.if(
                sql`lfm_file.mime != 'application/pdf'`,
                (s) =>
                  s.throwError(
                    sql`'readFileMarkup only accepts application/pdf; "' ||
                        coalesce(lfm_file.label, '') || '" is ' ||
                        coalesce(lfm_file.mime, '(unknown)')`,
                  ),
              );
              readPdfMarkup(s, {
                fileId: sql`lfm_id`,
                page: sql`lfm_page`,
                defOutputScalar: "lfm_markup",
              });
              s.setScalar("lfm_done", true);
              s.return(sql`lfm_markup`);
            },
          );
        }
        s.if(
          sql`not lfm_done`,
          (s) =>
            s.throwError(
              sql`'Unknown or unavailable markup source: ' ||
                  coalesce(lfm_source, '(none)')`,
            ),
        );
      },
    });
  }

  // context() returns the conversation's bound context_json (e.g. the estimate
  // revision the run is scoped to). Actions validate their input against it.
  const CONTEXT_TOOL: SparkTool = {
    name: "context",
    statements: (s) => {
      s.return(sql`coalesce(
        (select context_json from db.spark_conversations
         where id = spark_js_conversation_id),
        '{}'::json)`);
    },
  };

  const ASK_QUESTIONS: SparkTool = {
    name: "askQuestions",
    statements: (s) => {
      s.defScalar(
        "q_payload",
        sql`coalesce((tool_input->0)::json, '{}'::json)`,
      );
      s.defScalar("q_prompt", sql`nullif(q_payload->>'prompt', '')`);
      s.defScalar(
        "q_questions",
        sql`coalesce(q_payload->'questions', '[]'::json)`,
      );
      s.if(
        sql`q_prompt is null`,
        (s) => s.throwError(sql.lit`prompt is required`),
      );
      s.startTransaction();
      s.modify(sql`
        insert into db.spark_agent_events
          (spark_agent_id, type, content, payload, created_at)
        values (
          spark_js_agent_id,
          'question_created',
          q_prompt,
          json_build_object('questions', q_questions),
          now()
        )
      `);
      s.commitTransaction();
      s.return(sql`'null'::json`);
    },
  };

  const UNDO_LAST_CHANGES: SparkTool = {
    name: "undoLastChanges",
    statements: (s) => {
      s.defScalar(
        "undo_last_execution_event_id",
        sql`(select execution_event_id
          from db.spark_action_log
          where spark_conversation_id = spark_js_conversation_id
            and status = 'executed'
            and ${reversibleActionCondition(sql`action_name`)}
            and transaction_id is not null
          order by id desc
          limit 1)`,
      );
      s.if(sql`undo_last_execution_event_id is null`, (s) => {
        s.throwError(
          sql.lit`There are no reversible Spark changes to undo.`,
        );
      });
      s.defScalar(
        "undo_last_action_count",
        sql`(select count(*)
          from db.spark_action_log
          where spark_conversation_id = spark_js_conversation_id
            and execution_event_id = undo_last_execution_event_id
            and status = 'executed'
            and ${reversibleActionCondition(sql`action_name`)}
            and transaction_id is not null)`,
      );
      s.defScalar(
        "undo_last_action_id",
        sql`(select max(id)
          from db.spark_action_log
          where spark_conversation_id = spark_js_conversation_id
            and execution_event_id = undo_last_execution_event_id
            and status = 'executed'
            and ${reversibleActionCondition(sql`action_name`)}
            and transaction_id is not null)`,
      );
      undoSparkActionBatch(s, {
        conversationId: sql`spark_js_conversation_id`,
        executionEventId: sql`undo_last_execution_event_id`,
        actionId: sql`undo_last_action_id`,
        agentId: sql`spark_js_agent_id`,
        actionFilter: reversibleActionCondition(sql`action_name`),
      });
      s.return(sql`json_build_object(
        'status', 'undone',
        'action_count', undo_last_action_count
      )`);
    },
  };

  const EMIT_IMAGE: SparkTool = {
    name: "__sparkEmitImage",
    statements: (s) => {
      s.defScalar(
        "emit_image_input",
        sql`coalesce((tool_input->0)::json, '{}'::json)`,
      );
      s.defScalar(
        "emit_image_bytes_id",
        sql`try_cast(emit_image_input->>'bytesId' as bigint)`,
      );
      s.defScalar("emit_image_mime", sql`emit_image_input->>'mimeType'`);
      s.defScalar(
        "emit_image_detail",
        sql`coalesce(nullif(emit_image_input->>'detail', ''), 'auto')`,
      );
      s.defScalar(
        "emit_image_read_evidence_token",
        sql`emit_image_input->>'readEvidenceToken'`,
      );
      s.if(
        sql`emit_image_bytes_id is null or emit_image_bytes_id <= 0`,
        (s) => s.throwError(sql.lit`image() received an invalid byte buffer`),
      );
      s.if(
        sql`emit_image_mime not in ('image/png', 'image/jpeg', 'image/webp')`,
        (s) =>
          s.throwError(
            sql.lit`image() accepts image/png, image/jpeg, or image/webp`,
          ),
      );
      s.if(
        sql`emit_image_detail not in ('auto', 'low', 'high')`,
        (s) =>
          s.throwError(
            sql.lit`image() detail must be auto, low, or high`,
          ),
      );
      s.if(
        sql`emit_image_read_evidence_token is not null and not exists (
          select 1
          from db.spark_agent_events event
          join json.array_each(
            coalesce(event.payload->'file_reads', '[]'::json)
          ) file_read on true
          where event.id = spark_js_execution_event_id
            and event.spark_agent_id = spark_js_agent_id
            and file_read.value->>'tool' = 'readFileImage'
            and file_read.value->>'evidence_token' =
              emit_image_read_evidence_token
        )`,
        (s) =>
          s.throwError(
            sql.lit`image() source evidence is not valid for this execution`,
          ),
      );
      s.getJsBytes(sql`emit_image_bytes_id`, {
        defBytesScalar: "emit_image_bytes",
      });
      s.createBlob(sql`emit_image_bytes`, {
        defHashScalar: "emit_image_blob_hash",
      });
      s.startTransaction();
      s.modify(sql`
        insert into db.spark_attachments
          (spark_event_id, name, mime_type, file_size, blob_hash, expires_at)
        values (
          (select max(id) from db.spark_agent_events
            where spark_agent_id = spark_js_agent_id
              and type in ('execute_script_success', 'execute_script_error')),
          'Generated image', emit_image_mime,
          octet_length(emit_image_bytes), emit_image_blob_hash,
          date.add(day, 1, now())
        )
      `);
      s.if(sql`emit_image_read_evidence_token is not null`, (s) => {
        s.modify(sql`
          update db.spark_agent_events event
          set payload = coalesce(event.payload, '{}'::json) ||
            json_build_object(
              'image_emissions',
              coalesce(event.payload->'image_emissions', '[]'::json) ||
                json_build_array(coalesce((
                  select file_read.value || json_build_object(
                    'emitted_blob_hash', encode.hex(emit_image_blob_hash),
                    'emitted_mime', emit_image_mime,
                    'detail', emit_image_detail
                  )
                  from json.array_each(
                    coalesce(event.payload->'file_reads', '[]'::json)
                  ) file_read
                  where file_read.value->>'tool' = 'readFileImage'
                    and file_read.value->>'evidence_token' =
                      emit_image_read_evidence_token
                  limit 1
                ), '{}'::json))
            )
          where event.id = spark_js_execution_event_id
            and event.spark_agent_id = spark_js_agent_id
        `);
      });
      s.commitTransaction();
      s.return(sql`json_build_object(
        'type', 'file',
        'source', json_build_object(
          'kind', 'blob_hash',
          'blobHash', encode.hex(emit_image_blob_hash)
        ),
        'mimeType', emit_image_mime,
        'detail', emit_image_detail
      )`);
    },
  };

  // ---------------------------------------------------------------------------
  // Attachment tools
  //   listAttachments()           — list every file the user uploaded in this
  //                                  conversation (so the agent can find them
  //                                  by id even after the message scrolled).
  //   readAttachment(idOrName)    — return a Uint8Array for custom parsing or
  //                                  image() vision input.
  //   inspectSpreadsheet(...)     — inspect sheets and bounded cell previews.
  //   readSpreadsheet(...)        — read bounded, typed worksheet rows.
  //   readPdfText({id, page?})    — extract plain or positioned PDF text.
  //   renderPdfPage({id, page})   — rasterize one PDF page to a PNG Uint8Array.
  // ---------------------------------------------------------------------------

  function defAttachmentLookup(s: GeneralServerStatements) {
    s.defScalar("att_raw_input", sql`tool_input->0`);
    s.defScalar(
      "att_id_input",
      sql`case
        when json_typeof(att_raw_input) = 'number'
          then try_cast(att_raw_input::string as bigint)
        when json_typeof(att_raw_input) = 'string'
          then try_cast(att_raw_input::string as bigint)
        when json_typeof(att_raw_input) = 'object'
          then try_cast(att_raw_input->>'id' as bigint)
        else null
      end`,
    );
    s.defScalar(
      "att_name_input",
      sql`case
        when json_typeof(att_raw_input) = 'string' and att_id_input is null
          then att_raw_input::string
        when json_typeof(att_raw_input) = 'object'
          then nullif(att_raw_input->>'name', '')
        else null
      end`,
    );
    s.if(
      sql`att_id_input is null and att_name_input is null`,
      (s) =>
        s.throwError(
          sql.lit`attachment id or name is required`,
        ),
    );
    s.defRecord(
      "att",
      sql`select attachment.id, attachment.name, attachment.mime_type,
            attachment.file_size, attachment.text_content, attachment.blob_hash
          from db.spark_attachments attachment
          join db.spark_agent_events event
            on event.id = attachment.spark_event_id
          join db.spark_agents agent on agent.id = event.spark_agent_id
          where agent.spark_conversation_id = spark_js_conversation_id
            and event.type = 'user_message'
            and (
              (att_id_input is not null and attachment.id = att_id_input)
              or (att_id_input is null and attachment.name = att_name_input)
            )
          order by attachment.id desc
          limit 1`,
    );
    s.if(
      sql`att.id is null`,
      (s) =>
        s.throwError(
          sql`'Attachment not found: ' ||
              coalesce(cast(att_id_input as string), att_name_input, '(unknown)')`,
        ),
    );
  }

  const LIST_ATTACHMENTS: SparkTool = {
    name: "listAttachments",
    statements: (s) => {
      s.return(sql`coalesce(
        (select json_array_agg(json_build_object(
            'id', attachment.id,
            'name', attachment.name,
            'mimeType', attachment.mime_type,
            'size', attachment.file_size,
            'kind', case
              when attachment.text_content is not null then 'text'
              when attachment.mime_type like 'image/%' then 'image'
              else 'binary' end
          ) order by attachment.id)
         from db.spark_attachments attachment
         join db.spark_agent_events event
           on event.id = attachment.spark_event_id
         join db.spark_agents agent on agent.id = event.spark_agent_id
         where agent.spark_conversation_id = spark_js_conversation_id
           and event.type = 'user_message'),
        '[]'::json
      )`);
    },
  };

  const READ_ATTACHMENT: SparkTool = {
    name: "readAttachment",
    statements: (s) => {
      defAttachmentLookup(s);
      s.defScalar("att_scratch_id", { type: "BigInt" });
      s.if(sql`att.text_content is not null`, (s) => {
        s.setJsBytes(sql`string.to_utf8(att.text_content)`, {
          setIdScalar: "att_scratch_id",
        });
      }).else((s) => {
        s.readBlob(sql`att.blob_hash`, { defContentScalar: "att_blob_bytes" });
        s.setJsBytes(sql`att_blob_bytes`, { setIdScalar: "att_scratch_id" });
      });
      s.return(sql`json_build_object(
        '__sparkBytesId', att_scratch_id,
        'name', att.name,
        'mimeType', att.mime_type
      )`);
    },
  };

  // PDF tools — PDFs are never sent to the model raw (no provider-portable
  // file part). The agent decides per-PDF: readPdfText extracts the embedded
  // text layer (cheap, all pages at once); renderPdfPage rasterizes one page
  // to PNG for charts, drawings, and scans.

  const READ_PDF_TEXT: SparkTool = {
    name: "readPdfText",
    statements: (s) => {
      defAttachmentLookup(s);
      s.defScalar(
        "rpt_page",
        sql`case when json_typeof(att_raw_input) = 'object'
          then try_cast(att_raw_input->>'page' as int) end`,
      );
      s.defScalar(
        "rpt_mode",
        sql`coalesce(case when json_typeof(att_raw_input) = 'object'
          then nullif(att_raw_input->>'mode', '') end, 'plain')`,
      );
      s.defScalar(
        "rpt_width",
        sql`least(2400, greatest(256, coalesce(
          case when json_typeof(att_raw_input) = 'object'
            then try_cast(att_raw_input->>'width' as int) end,
          ${SPARK_PDF_RENDER_WIDTH})))`,
      );
      s.if(sql`rpt_mode not in ('plain', 'positioned')`, (s) => {
        s.throwError(sql.lit`mode must be "plain" or "positioned"`);
      });
      s.if(sql`att.blob_hash is null`, (s) =>
        s.throwError(
          sql`'Attachment "' || att.name || '" has no binary payload.'`,
        ));
      s.if(
        sql`att.mime_type != 'application/pdf'`,
        (s) =>
          s.throwError(
            sql`'readPdfText() only accepts application/pdf; "' ||
                att.name || '" is ' || att.mime_type ||
                '. For spreadsheets use inspectSpreadsheet() or readSpreadsheet(); for docx use readAttachment() with mammoth.'`,
          ),
      );
      s.readBlob(sql`att.blob_hash`, { defContentScalar: "rpt_bytes" });
      s.defScalar(
        "rpt_page_count",
        sql`(select count(*) from pdf.pages(rpt_bytes))`,
      );
      s.if(
        sql`rpt_page is not null
          and (rpt_page < 1 or rpt_page > rpt_page_count)`,
        (s) =>
          s.throwError(
            sql`'Page ' || rpt_page::string || ' is out of range: "' ||
                att.name || '" has ' || rpt_page_count::string || ' pages.'`,
          ),
      );
      s.if(sql`rpt_mode = 'positioned'`, (s) => {
        s.if(sql`rpt_page is null`, (s) => {
          s.throwError(
            sql.lit`positioned PDF text requires one page`,
          );
        });
        s.defTable(
          "rpt_positioned_runs",
          sql`select text, x, y, w, h
            from pdf.text_positioned(rpt_bytes, rpt_page, rpt_width)`,
        );
        s.return(sql`json_build_object(
          'name', att.name,
          'pageCount', rpt_page_count,
          'page', rpt_page,
          'width', rpt_width,
          'truncated', (select count(*) from rpt_positioned_runs) > 1000,
          'runs', coalesce((
            select json_array_agg(json_build_object(
              'text', text, 'x', x, 'y', y, 'w', w, 'h', h
            ))
            from (select * from rpt_positioned_runs limit 1000) bounded_runs
          ), '[]'::json)
        )`);
      });
      // Per-page cap keeps a huge PDF from blowing the console/context; the
      // truncation flag tells the agent to re-request page-by-page.
      s.return(sql`json_build_object(
        'name', att.name,
        'pageCount', rpt_page_count,
        'truncated', (rpt_page is null and rpt_page_count > 5)
          or exists(select 1 from pdf.text(rpt_bytes)
            where (rpt_page is null or page = rpt_page)
              and length(text) > case when rpt_page is null then 4000 else 20000 end),
        'pages', coalesce(
          (select json_array_agg(json_build_object(
              'page', page,
              'text', left(text,
                case when rpt_page is null then 4000 else 20000 end)
            ) order by page)
           from pdf.text(rpt_bytes)
           where (rpt_page is null and page <= 5)
             or page = rpt_page),
          '[]'::json)
      )`);
    },
  };

  const RENDER_PDF_PAGE: SparkTool = {
    name: "renderPdfPage",
    statements: (s) => {
      defAttachmentLookup(s);
      s.defScalar(
        "rpp_page",
        sql`greatest(coalesce(
          case when json_typeof(att_raw_input) = 'object'
            then try_cast(att_raw_input->>'page' as int) end, 1), 1)`,
      );
      s.defScalar(
        "rpp_width",
        sql`least(case when att_raw_input->'crop' is not null
          then 4096 else 2400 end,
          greatest(256, coalesce(
          case when json_typeof(att_raw_input) = 'object'
            then try_cast(att_raw_input->>'width' as int) end,
          ${SPARK_PDF_RENDER_WIDTH})))`,
      );
      s.defScalar(
        "rpp_crop_x",
        sql`try_cast(att_raw_input->'crop'->>'x' as int)`,
      );
      s.defScalar(
        "rpp_crop_y",
        sql`try_cast(att_raw_input->'crop'->>'y' as int)`,
      );
      s.defScalar(
        "rpp_crop_width",
        sql`try_cast(att_raw_input->'crop'->>'width' as int)`,
      );
      s.defScalar(
        "rpp_crop_height",
        sql`try_cast(att_raw_input->'crop'->>'height' as int)`,
      );
      s.defScalar("rpp_crop_requested", sql`att_raw_input->'crop' is not null`);
      s.if(
        sql`rpp_crop_requested and (
          rpp_crop_x is null or rpp_crop_y is null
          or rpp_crop_width is null or rpp_crop_height is null
          or rpp_crop_width <= 0 or rpp_crop_height <= 0
        )`,
        (s) =>
          s.throwError(
            sql
              .lit`crop requires integer x, y, width, and height; width and height must be positive`,
          ),
      );
      s.if(sql`att.blob_hash is null`, (s) =>
        s.throwError(
          sql`'Attachment "' || att.name || '" has no binary payload.'`,
        ));
      s.if(
        sql`att.mime_type != 'application/pdf'`,
        (s) =>
          s.throwError(
            sql`'renderPdfPage() only accepts application/pdf; "' ||
                att.name || '" is ' || att.mime_type ||
                '. Pass image bytes from readAttachment() to image().'`,
          ),
      );
      s.readBlob(sql`att.blob_hash`, { defContentScalar: "rpp_bytes" });
      s.defScalar(
        "rpp_page_count",
        sql`(select count(*) from pdf.pages(rpp_bytes))`,
      );
      s.if(
        sql`rpp_page > rpp_page_count`,
        (s) =>
          s.throwError(
            sql`'Page ' || rpp_page::string || ' is out of range: "' ||
                att.name || '" has ' || rpp_page_count::string || ' pages.'`,
          ),
      );
      s.pdfRenderPage({
        pdf: sql`rpp_bytes`,
        page: sql`rpp_page`,
        width: sql`rpp_width`,
        defOutputScalar: "rpp_png",
      });
      s.defScalar("rpp_image_bytes", {
        type: { type: "Bytes", maxLength: 1000000000 },
        expr: sql`rpp_png`,
      });
      s.if(sql`rpp_crop_requested`, (s) => {
        s.cropImage({
          inBytes: sql`rpp_image_bytes`,
          x: sql`rpp_crop_x`,
          y: sql`rpp_crop_y`,
          width: sql`rpp_crop_width`,
          height: sql`rpp_crop_height`,
          defOutBytesScalar: "rpp_cropped_png",
        });
        s.setScalar("rpp_image_bytes", sql`rpp_cropped_png`);
      });
      s.setJsBytes(sql`rpp_image_bytes`, { defIdScalar: "rpp_scratch_id" });
      s.return(sql`json_build_object(
        '__sparkBytesId', rpp_scratch_id,
        'name', att.name || ' — page ' || rpp_page::string ||
          case when rpp_crop_requested then ' — crop (' ||
            rpp_crop_x::string || ', ' || rpp_crop_y::string || ', ' ||
            rpp_crop_width::string || ' × ' || rpp_crop_height::string || ')'
          else '' end,
        'mimeType', 'image/png'
      )`);
    },
  };

  const LIST_FILES: SparkTool = {
    name: "listFiles",
    statements: (s) => {
      s.defScalar("list_files_raw_input", sql`tool_input->0`);
      s.defScalar(
        "list_files_path",
        sql`case
          when list_files_raw_input is null then ''
          when json_typeof(list_files_raw_input) = 'string'
            then trim(list_files_raw_input::string)
          else trim(coalesce(list_files_raw_input->>'path', ''))
        end`,
      );
      s.if(
        sql`
          list_files_path like '/%'
          or list_files_path like '%/'
          or list_files_path = '..'
          or list_files_path like '../%'
          or list_files_path like '%/../%'
          or list_files_path like '%/..'
        `,
        (s) => s.throwError(sql.lit`Use a workspace-relative folder path.`),
      );
      s.if(sql`list_files_path = 'System'`, (s) => {
        s.return(sql`json_build_object(
          'path', 'System',
          'items', ${
          sql.lit(JSON.stringify(SPARK_NATIVE_REFERENCES.map(
            (reference) => ({
              name: reference.path.slice("System/".length),
              kind: "file",
              description: reference.description,
              path: reference.path,
            }),
          )))
        }::json
        )`);
      });
      s.defScalar(
        "list_files_space_id",
        sparkWorkspaceIdExpr(opts.workspace),
      );
      s.defScalar(
        "list_files_folder_id",
        sql`case when list_files_path = '' then null::bigint else (
          with recursive paths as (
            select item.id, item.item_kind, item.name as path
            from db.file_items item
            where item.file_space_id = list_files_space_id
              and item.parent_file_item_id is null
              and item.trashed_at is null
            union all
            select child.id, child.item_kind,
              parent.path || '/' || child.name
            from db.file_items child
            join paths parent on parent.id = child.parent_file_item_id
            where child.file_space_id = list_files_space_id
              and child.trashed_at is null
          )
          select id from paths
          where path = list_files_path and item_kind = 'folder'
          limit 1
        ) end`,
      );
      s.if(
        sql`list_files_path <> '' and list_files_folder_id is null`,
        (s) =>
          s.throwError(
            sql`'No Spark workspace folder exists at "' ||
              list_files_path || '".'`,
          ),
      );
      s.return(sql`json_build_object(
        'path', list_files_path,
        'items', case when list_files_path = '' then json_build_array(
          json_build_object(
            'name', 'System',
            'kind', 'folder',
            'description', 'Native Spark reference guides.',
            'path', 'System'
          )
        ) else '[]'::json end || coalesce((
          select json_array_agg(json_build_object(
            'name', item.name,
            'kind', cast(item.item_kind as string),
            'description', item.description,
            'path', case when list_files_path = '' then item.name
              else list_files_path || '/' || item.name end
          ) order by
            case when item.item_kind = 'folder' then 0 else 1 end,
            item.name)
          from db.file_items item
          where item.file_space_id = list_files_space_id
            and coalesce(cast(item.parent_file_item_id as string), '') =
              coalesce(cast(list_files_folder_id as string), '')
            and item.trashed_at is null
        ), '[]'::json)
      )`);
    },
  };

  const READ_FILE: SparkTool = {
    name: "readFile",
    statements: (s) => {
      s.defScalar("read_file_raw_input", sql`tool_input->0`);
      s.defScalar(
        "read_file_path",
        sql`case
          when json_typeof(read_file_raw_input) = 'string'
            then trim(read_file_raw_input::string)
          else trim(coalesce(read_file_raw_input->>'path', ''))
        end`,
      );
      s.if(
        sql`
          read_file_path = ''
          or read_file_path like '/%'
          or read_file_path like '%/'
          or read_file_path = '..'
          or read_file_path like '../%'
          or read_file_path like '%/../%'
          or read_file_path like '%/..'
        `,
        (s) => s.throwError(sql.lit`Use a workspace-relative file path.`),
      );
      for (const reference of SPARK_NATIVE_REFERENCES) {
        s.if(sql`read_file_path = ${sql.lit(reference.path)}`, (s) => {
          s.return(sql`json_build_object(
            'path', ${sql.lit(reference.path)},
            'name', ${sql.lit(reference.path.slice("System/".length))},
            'description', ${sql.lit(reference.description)},
            'markdown', ${sql.lit(reference.markdown)}
          )`);
        });
      }
      s.defScalar(
        "read_file_space_id",
        sparkWorkspaceIdExpr(opts.workspace),
      );
      s.defRecord(
        "read_file",
        sql`
          with recursive paths as (
            select item.id, item.name, item.description, item.item_kind,
              item.current_file_version_id, item.name as path
            from db.file_items item
            where item.file_space_id = read_file_space_id
              and item.parent_file_item_id is null
              and item.trashed_at is null
            union all
            select child.id, child.name, child.description, child.item_kind,
              child.current_file_version_id,
              parent.path || '/' || child.name
            from db.file_items child
            join paths parent on parent.id = child.parent_file_item_id
            where child.file_space_id = read_file_space_id
              and child.trashed_at is null
          )
          select paths.id, paths.name, paths.description, paths.path,
            markdown.content
          from paths
          join db.markdown_file_versions markdown
            on markdown.file_version_id = paths.current_file_version_id
          where paths.path = read_file_path
            and paths.item_kind = 'file'
          limit 1
        `,
      );
      s.if(
        sql`read_file.id is null`,
        (s) =>
          s.throwError(
            sql`'No readable Markdown file exists at "' ||
              read_file_path || '".'`,
          ),
      );
      s.return(sql`json_build_object(
        'path', read_file.path,
        'name', read_file.name,
        'description', read_file.description,
        'markdown', read_file.content
      )`);
    },
  };

  // Loads a governed company document (controlled Drive) by id — the `Company
  // documents (index)` in the prompt carries only titles + descriptions; this
  // fetches content into the message stream on demand. Native documents come
  // back as markdown and PDFs as extracted text (or one page rasterized to a
  // PNG Uint8Array via renderPage). Authorization is the same predicate as the prompt
  // index: the conversation owner's document
  // access, organization-visibility only for ownerless runs.
  const governedDocumentTools: SparkTool[] = [];
  if (opts.knowledge) {
    const knowledge = opts.knowledge;
    governedDocumentTools.push({
      name: "loadDocument",
      statements: (s) => {
        s.defScalar("ldoc_raw_input", sql`tool_input->0`);
        s.defScalar(
          "ldoc_id",
          sql`case
          when json_typeof(ldoc_raw_input) = 'number'
            then try_cast(ldoc_raw_input::string as bigint)
          when json_typeof(ldoc_raw_input) = 'string'
            then try_cast(ldoc_raw_input::string as bigint)
          when json_typeof(ldoc_raw_input) = 'object'
            then try_cast(ldoc_raw_input->>'id' as bigint)
          else null
        end`,
        );
        s.defScalar(
          "ldoc_render_page",
          sql`case when json_typeof(ldoc_raw_input) = 'object'
          then try_cast(ldoc_raw_input->>'renderPage' as int) end`,
        );
        s.if(
          sql`ldoc_id is null`,
          (s) => s.throwError(sql.lit`document id is required`),
        );
        s.defScalar(
          "ldoc_owner",
          sql`spark_js_owner_id`,
        );
        s.defScalar(
          "ldoc_readable",
          canReadSparkKnowledgeForNullableOwner(
            knowledge,
            sql`ldoc_owner`,
            sql`ldoc_id`,
          ),
        );
        s.if(
          sql`not ldoc_readable`,
          (s) =>
            s.throwError(
              sql`'No readable document with id ' ||
                coalesce(ldoc_id::string, '(none)') ||
                '. See the Company documents index in your prompt.'`,
            ),
        );
        s.defScalar(
          "ldoc_version_id",
          sparkPublishedFileVersionId(knowledge, sql`ldoc_id`),
        );
        s.if(
          sql`ldoc_version_id is null`,
          (s) =>
            s.throwError(
              sql`'Document ' || ldoc_id::string ||
                ' has no published version.'`,
            ),
        );
        s.defRecord(
          "ldoc_ver",
          sql`select
            version.id,
            version.content_type,
            native.rich_content,
            blob.blob_hash,
            item.name as title
          from db.file_versions version
          join db.file_items item on item.id = version.file_item_id
          left join db.native_document_file_versions native
            on native.file_version_id = version.id
          left join db.file_version_blobs blob
            on blob.file_version_id = version.id
          where version.id = ldoc_version_id`,
        );
        s.if(sql`ldoc_ver.rich_content is not null`, (s) => {
          s.return(sql`json_build_object(
          'id', ldoc_id,
          'title', ldoc_ver.title,
          'mode', 'native',
          'markdown', lexical_rich_text_to_markdown(ldoc_ver.rich_content)
        )`);
        });
        s.if(
          sql`
          lower(ldoc_ver.content_type) <> 'application/pdf'
          or ldoc_ver.blob_hash is null
        `,
          (s) =>
            s.throwError(
              sql
                .lit`This published file type cannot be loaded as Spark knowledge.`,
            ),
        );
        // pdf_attachment — extracted text by default, one page rasterized when
        // renderPage is passed (mirrors renderPdfPage).
        s.readBlob(sql`ldoc_ver.blob_hash`, { defContentScalar: "ldoc_bytes" });
        s.defScalar(
          "ldoc_page_count",
          sql`(select count(*) from pdf.pages(ldoc_bytes))`,
        );
        s.if(sql`ldoc_render_page is not null`, (s) => {
          s.if(
            sql`ldoc_render_page < 1 or ldoc_render_page > ldoc_page_count`,
            (s) =>
              s.throwError(
                sql`'Page ' || ldoc_render_page::string ||
                  ' is out of range: "' || ldoc_ver.title || '" has ' ||
                  ldoc_page_count::string || ' pages.'`,
              ),
          );
          s.pdfRenderPage({
            pdf: sql`ldoc_bytes`,
            page: sql`ldoc_render_page`,
            width: sql`${SPARK_PDF_RENDER_WIDTH}`,
            defOutputScalar: "ldoc_png",
          });
          s.setJsBytes(sql`ldoc_png`, { defIdScalar: "ldoc_scratch_id" });
          s.return(sql`json_build_object(
          '__sparkBytesId', ldoc_scratch_id,
          'name', ldoc_ver.title || ' — page ' || ldoc_render_page::string,
          'mimeType', 'image/png'
        )`);
        });
        s.return(sql`json_build_object(
        'id', ldoc_id,
        'title', ldoc_ver.title,
        'mode', 'pdf',
        'pageCount', ldoc_page_count,
        'truncated', ldoc_page_count > 5
          or exists(select 1 from pdf.text(ldoc_bytes)
            where page <= 5 and length(text) > 4000),
        'pages', coalesce(
          (select json_array_agg(json_build_object(
              'page', page,
              'text', left(text, 4000)
            ) order by page)
           from pdf.text(ldoc_bytes)
           where page <= 5),
          '[]'::json)
      )`);
      },
    });
  }

  return [
    sharedExecutor
      ? {
        ...EMIT_IMAGE,
        statements: (s) => {
          s.if(sql`spark_external`, (s) => externalSparkImage.statements(s))
            .else((s) => EMIT_IMAGE.statements(s));
        },
      }
      : EMIT_IMAGE,
    ...(opts.mcp !== false
      ? [
        generatedFileDownloadTool,
        ...(opts.workspace ? sparkDriveTransferTools : []),
      ]
      : []),
    READ_CAPABILITY,
    QUERY,
    LIST_FILES,
    READ_FILE,
    ...governedDocumentTools,
    ...(sharedExecutor
      ? [
        ...externalSparkReceiptTools(opts),
        ...externalSparkArtifactTools(),
        ...externalSparkMessageTools(),
      ]
      : []),
    ASK_QUESTIONS,
    UNDO_LAST_CHANGES,
    LIST_ATTACHMENTS,
    READ_ATTACHMENT,
    READ_PDF_TEXT,
    RENDER_PDF_PAGE,
    CONTEXT_TOOL,
    ...fileImageTools,
    ...fileMarkupTools,
    ...actionTools,
    ...functionTools,
  ];
}

// ============================================================================
// Helper: define llm_result record
// ============================================================================

function defineLlmResult(s: GeneralServerStatements) {
  s.defRecord("llm_result", {
    fields: [
      { name: "success", type: "Bool" },
      { name: "http_status", type: "Int" },
      { name: "error_message", type: "String" },
      { name: "is_rate_limit", type: "Bool" },
      { name: "retry_after_seconds", type: "Int" },
      { name: "retryable", type: "Bool" },
    ],
  });
}

// ============================================================================
// Helper: handle LLM failure with retry logic
// ============================================================================

function sparkReasoningEffortExpr(conv: Sql): Sql {
  return sql`coalesce(
    (select reasoning_effort::text from db.spark_conversations where id = ${conv}),
    'none')`;
}

export function isUnrecoverableSparkBillingFailure(
  httpStatus: Sql,
  errorMessage: Sql,
): Sql {
  return sql`${httpStatus} = 402
    or lower(coalesce(${errorMessage}, '')) like '%no credits remaining%'
    or lower(coalesce(${errorMessage}, '')) like '%insufficient_quota%'
    or lower(coalesce(${errorMessage}, '')) like '%billing hard limit%'
    or lower(coalesce(${errorMessage}, '')) like '%billing_not_active%'
    or lower(coalesce(${errorMessage}, '')) like '%billing_limit_reached%'
    or lower(coalesce(${errorMessage}, '')) like '%credit_balance_exhausted%'
    or lower(coalesce(${errorMessage}, '')) like '%exceeded your current quota%'`;
}

function handleLlmFailure(
  s: GeneralServerStatements,
  opts: {
    agentIdExpr: Sql;
    conversationIdExpr: Sql;
    retryCountExpr: Sql;
    eventType: string;
    retryStatus: string;
    haltStatus: string;
  },
) {
  s.defScalar("failed_http_status", sql`llm_result.http_status`);
  s.defScalar("failed_error_message", sql`llm_result.error_message`);
  s.defScalar("failed_is_rate_limit", sql`llm_result.is_rate_limit`);
  s.defScalar(
    "retry_delay_seconds",
    sql`coalesce(llm_result.retry_after_seconds,
      case
        when failed_is_rate_limit
          then power(2, least(${opts.retryCountExpr}, 4))::int * 60
        else (${opts.retryCountExpr} + 1) * 60
      end)`,
  );
  s.defScalar(
    "max_retries",
    sql`case when failed_is_rate_limit then 5 else 3 end`,
  );
  s.defScalar(
    "failed_is_unrecoverable_billing",
    isUnrecoverableSparkBillingFailure(
      sql`failed_http_status`,
      sql`failed_error_message`,
    ),
  );
  s.defScalar(
    "is_terminal",
    sql`${opts.retryCountExpr} >= max_retries
      or coalesce(llm_result.retryable = false, false)
      or failed_http_status in (400, 413)
      or failed_is_unrecoverable_billing`,
  );
  s.defScalar(
    "is_autonomous",
    sql`(select sys_user_id from db.spark_conversations
         where id = ${opts.conversationIdExpr}) is null`,
  );

  s.startTransaction();
  s.modify(sql`
    insert into db.spark_agent_events (
      spark_agent_id, type, error_message, created_at
    ) values (
      ${opts.agentIdExpr}, ${sql.lit(opts.eventType)},
      failed_error_message, now()
    )
  `);
  s.modify(sql`
    update db.spark_agents set
      status = case
        when is_terminal and is_autonomous then 'failed'
        when is_terminal then ${sql.lit(opts.haltStatus)}
        else ${sql.lit(opts.retryStatus)}
      end,
      retry_count = case when is_terminal then 0 else retry_count + 1 end,
      retry_at = case
        when is_terminal then null::timestamp
        else date.add(second, retry_delay_seconds, now())
      end
    where id = ${opts.agentIdExpr}
  `);
  s.if(sql`is_terminal and failed_http_status = 400`, (s) => {
    s.modify(sql`
      delete from db.spark_agent_pending_images
      where spark_agent_id = ${opts.agentIdExpr}
    `);
  });
  s.if(sql`is_terminal`, (s) => {
    s.if(sql`not is_autonomous`, (s) => {
      s.modify(sql`
        update db.spark_conversations set is_paused = true
        where id = ${opts.conversationIdExpr}
      `);
    });
    s.modify(sql`
      insert into db.spark_agent_events (
        spark_agent_id, type, content, created_at
      ) values (
        ${opts.agentIdExpr}, 'error_occurred',
        coalesce(nullif(failed_error_message, ''),
          'Agent stopped after repeated errors.'),
        now()
      )
    `);
  });
  s.commitTransaction();
  s.return();
}

function nativeSparkAttachmentsQuery(agentId: Sql): Sql {
  return sql`
    select
      attachment.spark_event_id * 10 as message_id,
      attachment.mime_type,
      encode.hex(attachment.blob_hash) as blob_hash
    from db.spark_agent_pending_images pending
    join db.spark_attachments attachment
      on attachment.id = pending.spark_attachment_id
    where pending.spark_agent_id = ${agentId}
      and attachment.blob_hash is not null
      and attachment.mime_type like 'image/%'
    order by pending.id desc
    limit 4
  `;
}

function insertOpaqueSparkCompactionEvent(
  s: GeneralServerStatements,
  opts: {
    agentId: Sql;
    cutoffEventId: Sql;
    continuationState: Sql;
  },
) {
  s.if(sql`${opts.continuationState} is not null`, (s) => {
    s.modify(sql`
      insert into db.spark_agent_events (
        spark_agent_id, type, continuation_state,
        compaction_cutoff_event_id, created_at
      ) values (
        ${opts.agentId}, 'compaction',
        ${opts.continuationState}, ${opts.cutoffEventId}, now()
      )
    `);
    s.modify(sql`
      update db.spark_agent_events
      set full_response = case when exists (
            select 1 from json.array_each(coalesce(tool_actions, '[]'::json))
          ) then null::string else full_response end,
          tool_actions = null::json,
          continuation_state = null::json,
          tool_outputs = null::json,
          console_output = null::string
      where spark_agent_id = ${opts.agentId}
        and id < ${opts.cutoffEventId}
        and (tool_actions is not null or tool_outputs is not null
          or console_output is not null or continuation_state is not null)
    `);
  });
}

export function planNativeSparkTurn(
  s: GeneralServerStatements,
  opts: RegisterReactorsOpts,
) {
  defSparkSystemPrompt(s, opts, sql`run_record.spark_conversation_id`);
  defineLlmResult(s);
  buildSparkAgentMessages(s, sql`run_record.id`);
  s.defScalar("llm_raw_response", { type: "String" });
  s.defScalar("llm_continuation_state", { type: "Json" });
  s.defScalar("llm_provider_compaction_state", { type: "Json" });
  s.defScalar("llm_tool_actions", { type: "Json" });
  s.defScalar("llm_commentary", { type: "String" });
  s.defScalar("llm_final", { type: "String" });

  s.try({
    body: (s) => {
      generateNativeSparkResponse(s, {
        agentId: sql`run_record.id`,
        enableRenderUi: opts.enableDynamicUi ?? false,
        systemPrompt: sql`spark_system_prompt`,
        messagesQuery:
          sql`select role, content, message_id, cache_marker, continuation_state,
              tool_outputs
            from spark_agent_messages
            where content is not null
            order by message_id`,
        attachmentsQuery: nativeSparkAttachmentsQuery(sql`run_record.id`),
        resultScalar: "llm_raw_response",
        continuationStateScalar: "llm_continuation_state",
        providerCompactionStateScalar: "llm_provider_compaction_state",
        actionsScalar: "llm_tool_actions",
        commentaryScalar: "llm_commentary",
        finalScalar: "llm_final",
        reasoningEffort: sparkReasoningEffortExpr(
          sql`run_record.spark_conversation_id`,
        ),
        serviceTier: sql`case
          when (select queue_preference::text from db.spark_conversations
                where id = run_record.spark_conversation_id) = 'priority'
            then 'priority'
          when (select queue_preference::text from db.spark_conversations
                where id = run_record.spark_conversation_id) = 'standard'
            then 'default'
          else 'auto'
        end`,
        promptCacheKey:
          sql`'spark-agent:' || run_record.spark_conversation_id::string`,
        mockProcedure: opts.mockProcedure,
      });
    },
    errorName: "llm_request_error",
    catch: (s) => {
      s.modify(sql`
        insert into llm_result (
          success, http_status, error_message, is_rate_limit,
          retry_after_seconds
        ) values (
          false, 0, 'Request failed: ' || llm_request_error.message,
          false, null::int
        )
      `);
      s.debugExpr(sql`'Spark native LLM error: ' || llm_request_error.message`);
    },
  });

  s.if(sql`not llm_result.success`, (s) => {
    handleLlmFailure(s, {
      agentIdExpr: sql`run_record.id`,
      conversationIdExpr: sql`run_record.spark_conversation_id`,
      retryCountExpr: sql`run_record.retry_count`,
      eventType: "create_script_error",
      retryStatus: "failed_retrying_plan",
      haltStatus: "awaiting_plan",
    });
  }).else((s) => {
    s.defScalar(
      "native_completed_run_id",
      sql`(select openai_run_id from db.spark_agents where id = run_record.id)`,
    );
    s.defScalar(
      "native_has_actions",
      sql`exists(
        select 1
        from json.array_each(coalesce(llm_tool_actions, '[]'::json))
      )`,
    );
    s.defScalar(
      "native_accept_final",
      sql`nullif(trim(llm_final), '') is not null
        and not native_has_actions`,
    );
    // Continuation binding uses exact provider text, including whitespace and
    // all message phases. Keep it separate from presentation fields.
    s.startTransaction();
    s.modify(sql`
      insert into db.spark_agent_events (
        spark_agent_id, type, content, full_response, tool_actions,
        continuation_state, payload, created_at
      ) values (
        run_record.id, 'create_script', nullif(trim(llm_commentary), ''),
        case when native_accept_final then nullif(trim(llm_final), '')
          else null::string end,
        coalesce(llm_tool_actions, '[]'::json), llm_continuation_state,
        json_build_object('assistant_text', llm_raw_response), now()
      )
    `);
    s.defScalar(
      "native_response_event_id",
      sql`last_record_id(db.spark_agent_events)`,
    );
    insertOpaqueSparkCompactionEvent(s, {
      agentId: sql`run_record.id`,
      cutoffEventId: sql`native_response_event_id`,
      continuationState: sql`case when native_accept_final
        or native_has_actions then llm_provider_compaction_state
        else null::json end`,
    });
    s.modify(sql`
      delete from db.spark_agent_pending_images
      where spark_agent_id = run_record.id
    `);
    s.modify(sql`
      update db.spark_agents
      set
        status = case
          when native_has_actions then 'awaiting_execute'
          when native_accept_final then 'completed'
          else 'awaiting_plan'
        end,
        completed_at = case
          when not native_has_actions and native_accept_final
            then now()
          else null::timestamp
        end,
        retry_count = 0,
        retry_at = null::timestamp,
        openai_run_id = null
      where id = run_record.id
    `);
    s.if(
      sql`not native_has_actions and nullif(trim(llm_final), '') is null`,
      (s) => {
        s.modify(sql`
          update db.spark_conversations
          set is_paused = true
          where id = run_record.spark_conversation_id
        `);
        s.modify(sql`
          insert into db.spark_agent_events (
            spark_agent_id, type, content, created_at
          ) values (
            run_record.id, 'error_occurred',
            'OpenAI returned neither a tool call nor a final response.',
            now()
          )
        `);
      },
    );
    s.modify(sql`update db.spark_conversations
      set last_message_at = now()
      where id = run_record.spark_conversation_id`);
    s.commitTransaction();
    s.if(sql`native_completed_run_id is not null`, (s) => {
      s.serviceRequest({
        serviceType: sql.lit`ai`,
        operation: sql.lit`openai_responses_close`,
        optIn: true,
        requestJson: sql`json_build_object(
          'apiVersion', 1,
          'runId', native_completed_run_id,
          'cancel', false
        )`,
        defResultJsonScalar: "native_close_result_json",
        defErrorJsonScalar: "native_close_error_json",
        mockProcedure: opts.mockProcedure && nativeSparkMockCloseProcedure,
      });
    });
  });
}

function executeNativeSparkActions(
  s: GeneralServerStatements,
  opts: RegisterReactorsOpts,
) {
  s.defRecord(
    "script_event",
    sql`select id, tool_actions
      from db.spark_agent_events
      where spark_agent_id = run_record.id
        and type = 'create_script'
        and tool_actions is not null
      order by id desc limit 1`,
  );
  s.if(
    sql`script_event.id is null
      or not exists(
        select 1 from json.array_each(coalesce(script_event.tool_actions, '[]'::json))
      )`,
    (s) => {
      s.startTransaction();
      s.modify(sql`
        update db.spark_agents
        set status = 'awaiting_plan', retry_count = 0,
          retry_at = null::timestamp
        where id = run_record.id
      `);
      s.modify(sql`
        update db.spark_conversations
        set is_paused = true
        where id = run_record.spark_conversation_id
      `);
      s.commitTransaction();
      s.return();
    },
  );

  s.startTransaction();
  s.modify(sql`
    insert into db.spark_agent_events (
      spark_agent_id, type, created_at
    ) values (
      run_record.id, 'execute_script_success', now()
    )
  `);
  s.defScalar(
    "native_execution_event_id",
    sql`last_record_id(db.spark_agent_events)`,
  );
  s.modify(sql`
    update db.spark_agents
    set status = 'executing'
    where id = run_record.id
  `);
  s.commitTransaction();

  prepareSparkJsContext(s, {
    conversationId: sql`run_record.spark_conversation_id`,
    agentId: sql`run_record.id`,
    executionEventId: sql`native_execution_event_id`,
    capabilities: opts.capabilities,
  });
  s.defTable("native_tool_outputs", {
    fields: [
      { name: "ordinal", type: "Int" },
      { name: "call_id", type: "String" },
      { name: "action_type", type: "String" },
      { name: "output", type: "Json" },
      { name: "display_output", type: "String" },
      { name: "failed", type: "Bool" },
    ],
  });
  s.defScalar("native_any_tool_failed", false);
  s.defScalar("native_exec_parse_failed", false);
  s.defScalar("native_first_tool_error", { type: "String" });
  s.defScalar(
    "native_action_count",
    sql`json_array_length(coalesce(script_event.tool_actions, '[]'::json))`,
  );
  s.if(sql`native_action_count != 1`, (s) => {
    s.setScalar("native_any_tool_failed", true);
    s.setScalar(
      "native_first_tool_error",
      sql
        .lit`Spark accepts one native tool call per turn. Use exec to orchestrate multiple application operations.`,
    );
    s.modify(sql`insert into native_tool_outputs (
        ordinal, call_id, action_type, output, display_output, failed
      )
      select action.index, action.value->>'callId',
        coalesce(action.value->>'name', action.value->>'type', ''),
        json_build_array(json_build_object(
          'type', 'text',
          'text', 'Error: Spark accepts one native tool call per turn.'
        )),
        'Error: Spark accepts one native tool call per turn.',
        true
      from json.array_each(
        coalesce(script_event.tool_actions, '[]'::json)) action`);
  }).else((s) => {
    s.defScalar(
      "native_action_value",
      sql`script_event.tool_actions->0`,
    );
    s.defScalar(
      "native_action_type",
      sql`case
          when native_action_value->>'type' = 'custom'
            then coalesce(native_action_value->>'name', '')
          else coalesce(native_action_value->>'type', '')
        end`,
    );
    s.defScalar(
      "native_action_call_id",
      sql`native_action_value->>'callId'`,
    );
    s.defScalar(
      "native_action_input",
      sql`coalesce(native_action_value->>'input', '')`,
    );
    s.if(sql`native_action_type = 'exec'`, (s) => {
      s.try({
        body: (s) => {
          s.defScalar("native_exec_result", { type: "Json" });
          s.callStoredProcedure("spark_exec", {
            inputScalars: {
              spark_external: sql`false`,
              spark_read_only: sql`false`,
              mcp_connection_id: sql`null::bigint`,
              spark_js_owner_id: sql`spark_js_owner_id`,
              spark_js_conversation_id: sql`spark_js_conversation_id`,
              spark_js_agent_id: sql`spark_js_agent_id`,
              spark_js_execution_event_id: sql`spark_js_execution_event_id`,
              spark_granted_capabilities: sql`spark_js_conv_capabilities`,
              spark_code: sql`native_action_input`,
            },
            outputScalars: { output: "native_exec_result" },
          });
          s.modify(sql`
              insert into native_tool_outputs (
                ordinal, call_id, action_type, output, display_output, failed
              ) values (
                0, native_action_call_id, 'exec',
                ${
            sparkPersistedToolOutputJsonExpr(
              sql`native_exec_result->'outputs'`,
            )
          },
                coalesce(
                  nullif((select string_agg(value->>'text', chr(10))
                    from json.array_each(
                      coalesce(native_exec_result->'outputs', '[]'::json))
                    where value->>'type' = 'text'), ''),
                  '[Completed]'
                ), false
              )
            `);
        },
        errorName: "native_exec_error",
        catch: (s) => {
          s.setScalar("native_any_tool_failed", true);
          s.setScalar(
            "native_exec_parse_failed",
            sql`starts_with(
              native_exec_error.message,
              'TypeScript parse error:'
            )`,
          );
          s.if(sql`native_first_tool_error is null`, (s) => {
            s.setScalar(
              "native_first_tool_error",
              sql`native_exec_error.message`,
            );
          });
          s.modify(sql`
              insert into native_tool_outputs (
                ordinal, call_id, action_type, output, display_output, failed
              ) values (
                0, native_action_call_id, 'exec',
                json_build_array(json_build_object(
                  'type', 'text',
                  'text', 'Error: ' || native_exec_error.message
                )),
                'Error: ' || native_exec_error.message, true
              )
            `);
        },
      });
    }).elseIf(sql`native_action_type = 'render_ui'`, (s) => {
      if (opts.enableDynamicUi) {
        preflightSparkUi(
          s,
          opts.capabilities,
          sql`spark_js_conv_capabilities`,
          sql`native_action_input`,
          "native_render",
          opts.allowedCardJsModules ?? [],
        );
        s.if(sql`native_render_ui_preflight_error is null`, (s) => {
          s.startTransaction();
          s.modify(sql`
              insert into db.spark_agent_events (
                spark_agent_id, type, content, payload, created_at
              ) values (
                run_record.id, 'card_displayed', 'UI card',
                json_build_object('source', native_action_input), now()
              )
            `);
          s.commitTransaction();
          s.modify(sql`
              insert into native_tool_outputs (
                ordinal, call_id, action_type, output, display_output, failed
              ) values (
                0, native_action_call_id,
                'render_ui', json_build_array(json_build_object(
                  'type', 'text', 'text', 'Rendered UI card.'
                )), 'Rendered UI card.', false
              )
            `);
        }).else((s) => {
          s.setScalar("native_any_tool_failed", true);
          s.if(sql`native_first_tool_error is null`, (s) => {
            s.setScalar(
              "native_first_tool_error",
              sql`native_render_ui_preflight_error`,
            );
          });
          s.modify(sql`
              insert into native_tool_outputs (
                ordinal, call_id, action_type, output, display_output, failed
              ) values (
                0, native_action_call_id,
                'render_ui',
                json_build_array(json_build_object(
                  'type', 'text',
                  'text', 'UI preflight failed: ' ||
                    native_render_ui_preflight_error
                )),
                'UI preflight failed: ' || native_render_ui_preflight_error,
                true
              )
            `);
        });
      } else {
        s.setScalar("native_any_tool_failed", true);
        s.if(sql`native_first_tool_error is null`, (s) => {
          s.setScalar(
            "native_first_tool_error",
            sql.lit`render_ui is not enabled for this Spark deployment.`,
          );
        });
        s.modify(sql`
            insert into native_tool_outputs (
              ordinal, call_id, action_type, output, display_output, failed
            ) values (
              0, native_action_call_id,
              'render_ui', json_build_array(json_build_object(
                'type', 'text', 'text', 'render_ui is not enabled.'
              )), 'render_ui is not enabled.', true
            )
          `);
      }
    }).else((s) => {
      s.setScalar("native_any_tool_failed", true);
      s.if(sql`native_first_tool_error is null`, (s) => {
        s.setScalar(
          "native_first_tool_error",
          sql`'Unsupported Spark action: ' ||
              coalesce(nullif(native_action_type, ''), '(missing type)')`,
        );
      });
      s.modify(sql`
          insert into native_tool_outputs (
            ordinal, call_id, action_type, output, display_output, failed
          ) values (
            0, native_action_call_id,
            native_action_type,
            json_build_array(json_build_object(
              'type', 'text',
              'text', 'Unsupported Spark action: ' ||
                coalesce(nullif(native_action_type, ''), '(missing type)')
            )),
            'Unsupported Spark action: ' ||
              coalesce(nullif(native_action_type, ''), '(missing type)'),
            true
          )
        `);
    });
  });

  s.defScalar(
    "native_console_output",
    sparkPersistedToolOutputExpr(sql`coalesce((
        select string_agg(display_output, chr(10) || chr(10) order by ordinal)
        from native_tool_outputs
      ), '')`),
  );
  s.defScalar(
    "native_tool_outputs_json",
    sql`coalesce((
      select json_array_agg(json_build_object(
        'callId', call_id,
        'output', output,
        'failed', failed
      ) order by ordinal)
      from native_tool_outputs
      where call_id is not null
    ), '[]'::json)`,
  );
  s.defScalar(
    "native_has_pending_questions",
    sql`exists(
      select 1 from db.spark_agent_events
      where spark_agent_id = run_record.id
        and id > native_execution_event_id
        and type = 'question_created'
    )`,
  );
  s.defScalar(
    "native_has_pending_actions",
    sql`exists(
      select 1 from db.spark_action_log
      where spark_conversation_id = run_record.spark_conversation_id
        and (status = 'proposed'
          or (status = 'approved' and input_json is not null))
    )`,
  );
  s.defScalar(
    "native_blocking_count",
    sql`(case when native_has_pending_questions then 1 else 0 end +
      case when native_has_pending_actions then 1 else 0 end)`,
  );
  s.if(sql`native_blocking_count > 1`, (s) => {
    s.setScalar("native_any_tool_failed", true);
    s.setScalar(
      "native_first_tool_error",
      sql
        .lit`One exec call created multiple blocking outcomes. Create questions and actions in separate turns.`,
    );
  });

  s.startTransaction();
  s.modify(sql`
    update db.spark_agent_events
    set
      type = case
        when native_any_tool_failed then 'execute_script_error'
        else 'execute_script_success'
      end,
      content = case when native_exec_parse_failed then
        'The exec script could not be parsed before it ran. ' ||
        'No tool or database side effects occurred. ' ||
        'Correct the TypeScript syntax and retry from the current durable state.'
        else content end,
      console_output = native_console_output,
      error_message = case when native_any_tool_failed
        then native_first_tool_error else null::string end,
      tool_outputs = native_tool_outputs_json,
      payload = coalesce(payload, '{}'::json) || json_build_object(
        'action', 'native_tools',
        'status', case
          when native_exec_parse_failed then 'retryable_parse_error'
          when native_any_tool_failed then 'error'
          else 'success'
        end
      )
    where id = native_execution_event_id
  `);
  s.modify(sql`
    update db.spark_agents
    set
      status = case
        when native_has_pending_questions then 'waiting_on_questions'
        when native_has_pending_actions then 'waiting_on_approval'
        else 'awaiting_plan'
      end,
      retry_count = 0,
      retry_at = null::timestamp
    where id = run_record.id
  `);
  s.commitTransaction();
}

// ============================================================================
// Reactor Registration
// ============================================================================

export function registerSparkReactors(opts: RegisterReactorsOpts) {
  registerSparkTitleReactor();
  registerSparkExecutor(opts);

  const allActions = opts.capabilities.flatMap((capability) =>
    (capability.actions ?? []).map((a) => ({
      ...a,
      capabilityPermission: capability.permission,
      capabilityPermissions: capability.permissions,
      skillName: capability.name,
      qualifiedName: `${capability.name}.${a.name}`,
    }))
  );
  const reversibleActions = allActions.filter((a) => a.mode === "reversible");
  const approvalActions = allActions.filter((a) => a.mode !== "reversible");
  let reversibleNameCondition = sql`false`;
  if (reversibleActions.length > 0) {
    reversibleNameCondition = sql`al.action_name = ${
      sql.lit(reversibleActions[0].qualifiedName)
    }`;
    for (let i = 1; i < reversibleActions.length; i++) {
      reversibleNameCondition =
        sql`${reversibleNameCondition} or al.action_name = ${
          sql.lit(reversibleActions[i].qualifiedName)
        }`;
    }
  }

  // ---- PLAN REACTOR ----
  system.addReactor({
    name: "spark_agent_plan",
    query: sql`
      select
        ba.id,
        ba.spark_conversation_id,
        ba.status,
        ba.retry_at,
        ba.retry_count
      from db.spark_agents ba
      join db.spark_conversations bc on bc.id = ba.spark_conversation_id
      where (
        ba.status = 'awaiting_plan'
        or (ba.status = 'failed_retrying_plan'
            and ba.retry_at is not null and ba.retry_at <= now())
        or (ba.status = 'waiting_on_approval'
            and not exists (
              select 1 from db.spark_action_log al
              where al.spark_conversation_id = ba.spark_conversation_id
                and (al.status = 'proposed'
                  or (al.status = 'approved' and al.input_json is not null))))
      )
      and not bc.is_paused
      and bc.status = 'active'
        and coalesce(ba.execution_mode, 'native') = 'native'
    `,
    recordName: "run_record",
    procedure: (s) => {
      // Guard against race conditions
      s.defScalar(
        "has_any_blocker",
        sql`exists (select 1 from db.spark_action_log
              where spark_conversation_id = run_record.spark_conversation_id
                and (status = 'proposed'
                  or (status = 'approved' and input_json is not null)))`,
      );
      s.if(sql`has_any_blocker`, (s) => s.return());

      // Absolute turn ceiling for an agent that repeatedly uses tools without
      // producing a final response.
      s.defScalar(
        "spark_total_turns",
        sql`(select count(*) from db.spark_agent_events
             where spark_agent_id = run_record.id and type = 'create_script')`,
      );
      s.if(sql`spark_total_turns >= 200`, (s) => {
        s.defScalar(
          "cap_is_autonomous",
          sql`(select sys_user_id from db.spark_conversations
               where id = run_record.spark_conversation_id) is null`,
        );
        s.startTransaction();
        s.modify(sql`update db.spark_agents
          set status = case when cap_is_autonomous
            then 'failed' else 'awaiting_plan' end
          where id = run_record.id`);
        s.if(
          sql`not cap_is_autonomous`,
          (s) =>
            s.modify(sql`update db.spark_conversations set is_paused = true
              where id = run_record.spark_conversation_id`),
        );
        s.modify(sql`insert into db.spark_agent_events
            (spark_agent_id, type, content, created_at)
          values (run_record.id, 'error_occurred',
            'Stopped: reached the maximum number of turns without finishing.',
            now())`);
        s.commitTransaction();
        s.return();
      });

      planNativeSparkTurn(s, opts);
    },
  });

  // Never replay orphaned execution: its database effects may have committed.
  system.addReactor({
    name: "spark_agent_execution_recover",
    query: sql`
      select ba.id, event.id as execution_event_id
      from db.spark_agents ba
      join db.spark_agent_events event
        on event.spark_agent_id = ba.id
      where ba.status = 'executing'
        and event.id = (
          select max(latest_event.id)
          from db.spark_agent_events latest_event
          where latest_event.spark_agent_id = ba.id
            and latest_event.type in (
              'execute_script_success', 'execute_script_error'
            )
        )
        and event.type = 'execute_script_success'
        and event.tool_outputs is null
        and event.created_at < date.add(hour, -1, now())
    `,
    recordName: "interrupted_record",
    procedure: (s) => {
      s.defScalar(
        "interrupted_tool_outputs",
        sql`(select json_array_agg(json_build_object(
            'callId', action.value->>'callId',
            'output', json_build_array(json_build_object(
              'type', 'text',
              'text', 'Error: execution was interrupted and was not replayed.'
            )),
            'failed', true
          ) order by action.index)
          from json.array_each(coalesce((
            select script_event.tool_actions
            from db.spark_agent_events script_event
            where script_event.spark_agent_id = interrupted_record.id
              and script_event.type = 'create_script'
              and script_event.id < interrupted_record.execution_event_id
              and script_event.tool_actions is not null
            order by script_event.id desc limit 1
          ), '[]'::json)) action
          where action.value->>'callId' is not null)`,
      );
      s.startTransaction();
      s.modify(sql`
        update db.spark_agent_events
        set type = 'execute_script_error',
            content = 'Execution was interrupted and can be retried.',
            error_message = 'Execution was interrupted before completion.',
            console_output =
              'Error: execution was interrupted and was not replayed.',
            tool_outputs = interrupted_tool_outputs
        where id = interrupted_record.execution_event_id
          and spark_agent_id = interrupted_record.id
          and type = 'execute_script_success'
          and tool_outputs is null
      `);
      s.modify(sql`
        update db.spark_agents
        set status = case when interrupted_tool_outputs is null
              then 'failed' else 'awaiting_plan' end,
            retry_count = 0,
            retry_at = null::timestamp, completed_at = null::timestamp
        where id = interrupted_record.id and status = 'executing'
      `);
      s.commitTransaction();
    },
  });

  if (reversibleActions.length > 0) {
    system.addReactor({
      name: "spark_reversible_action_interruption_recover",
      query: sql`
        select al.id, execution_event.spark_agent_id
        from db.spark_action_log al
        join db.spark_agent_events execution_event
          on execution_event.id = al.execution_event_id
        join db.spark_agents agent
          on agent.id = execution_event.spark_agent_id
        join db.spark_conversations conversation
          on conversation.id = al.spark_conversation_id
        where al.status = 'approved'
          and (${reversibleNameCondition})
          and agent.status != 'executing'
          and conversation.status = 'active'
          and not conversation.is_paused
          and not exists (
            select 1 from db.spark_agent_events receipt
            where receipt.action_id = al.id
              and receipt.type = 'action_executed'
          )
      `,
      recordName: "interrupted_action",
      procedure: (s) => {
        s.startTransaction();
        s.modify(sql`
          update db.spark_action_log
          set status = 'failed',
              result_json = json_build_object(
                'error',
                'Action execution was interrupted before a durable receipt; Spark will recompute it.'
              )
          where id = interrupted_action.id
            and status = 'approved'
        `);
        s.modify(sql`
          insert into db.spark_agent_events
            (spark_agent_id, type, content, action_id, created_at)
          values (
            interrupted_action.spark_agent_id,
            'error_occurred',
            'Action execution was interrupted before a durable receipt; retrying from current working state.',
            interrupted_action.id,
            now()
          )
        `);
        s.modify(sql`
          update db.spark_agents
          set status = 'awaiting_plan', retry_count = 0,
              retry_at = null::timestamp, completed_at = null::timestamp
          where id = interrupted_action.spark_agent_id
            and status != 'executing'
        `);
        s.commitTransaction();
      },
    });
  }

  // ---- EXECUTE REACTOR ----
  system.addReactor({
    name: "spark_agent_execute",
    query: sql`
      select
        ba.id,
        ba.spark_conversation_id
      from db.spark_agents ba
      join db.spark_conversations bc on bc.id = ba.spark_conversation_id
      where ba.status = 'awaiting_execute'
        and not bc.is_paused
        and bc.status = 'active'
        and coalesce(ba.execution_mode, 'native') = 'native'
    `,
    recordName: "run_record",
    procedure: (s) => {
      executeNativeSparkActions(s, opts);
    },
  });

  // ---- ACTION EXECUTE REACTOR ----
  // Picks up approved proposals and runs their procedure. Only registered when
  // at least one approval action exists: with none, no proposal can ever
  // be recorded, and the unconditional action_input/action_result scalar
  // definitions would fail declaration-liveness validation.
  if (approvalActions.length > 0) {
    system.addReactor({
      name: "spark_action_execute",
      query: sql`
      select
        al.id,
        al.spark_conversation_id,
        execution_event.spark_agent_id,
        al.action_name,
        al.input_json
      from db.spark_action_log al
      join db.spark_agent_events execution_event
        on execution_event.id = al.execution_event_id
      join db.spark_conversations bc on bc.id = al.spark_conversation_id
      where al.status = 'approved'
        and al.input_json is not null
        and not exists (
          select 1 from db.spark_agent_events event
          where event.action_id = al.id
            and event.type = 'action_executed'
        )
        and not bc.is_paused
        and bc.status = 'active'
    `,
      recordName: "action_record",
      procedure: (s) => {
        s.defScalar("action_input", sql`action_record.input_json`);
        s.defScalar("action_result", { type: "String" });
        s.defScalar(
          "action_sys_user_id",
          {
            expr: sql`(select sys_user_id from db.spark_conversations
              where id = action_record.spark_conversation_id)`,
            allowNoRead: true,
          },
        );

        let hasAnyExecute = false;
        for (const a of approvalActions) {
          const actionProcedure = a.procedure;
          if (actionProcedure) {
            hasAnyExecute = true;
            s.if(
              sql`action_record.action_name = ${sql.lit(a.qualifiedName)}`,
              (s) => {
                s.try({
                  body: (s) => {
                    s.startTransaction();
                    s.if(
                      sql`exists (select 1 from db.spark_action_log
                        where id = action_record.id and status = 'approved')`,
                      (s) => {
                        const hasCapabilityGate =
                          a.capabilityPermission !== undefined ||
                          a.capabilityPermissions !== undefined;
                        const hasActionGate = a.permission !== undefined ||
                          a.permissions !== undefined;
                        if (hasCapabilityGate || hasActionGate) {
                          const hasCapabilityAccess = hasCapabilityGate
                            ? hasSparkPermissionGate(
                              a.capabilityPermission,
                              a.capabilityPermissions,
                              sql`action_sys_user_id`,
                            )
                            : sql`true`;
                          const hasActionAccess = hasActionGate
                            ? hasSparkPermissionGate(
                              a.permission,
                              a.permissions,
                              sql`action_sys_user_id`,
                            )
                            : sql`true`;
                          s.if(
                            sql`action_sys_user_id is not null and not (
                              ${hasCapabilityAccess} and ${hasActionAccess}
                            )`,
                            (s) => {
                              s.throwError(
                                sql
                                  .lit`The action is no longer permitted for this user.`,
                              );
                            },
                          );
                        }
                        s.if(
                          sql`not (${
                            sparkSessionActionAllowed(
                              opts,
                              sql`action_sys_user_id`,
                              sql`action_record.spark_conversation_id`,
                              sql`action_record.action_name`,
                              a.qualifiedName,
                            )
                          })`,
                          (s) =>
                            s.throwError(
                              sql.lit`This action is no longer authorized.`,
                            ),
                        );
                        actionProcedure(s);
                        s.modify(sql`
                        update db.spark_action_log
                        set status = 'executed',
                            result_json = coalesce(try_cast(action_result as json), '{}'::json)
                        where id = action_record.id`);
                        s.modify(sql`
                    insert into db.spark_agent_events
                      (spark_agent_id, type, content, action_id, created_at)
                    values (
                      action_record.spark_agent_id,
                      'action_executed',
                      'Executed: ' || action_record.action_name,
                      action_record.id,
                      now()
                    )`);
                        s.commitTransaction();
                      },
                    ).else((s) => s.rollbackTransaction());
                  },
                  catch: (s) => {
                    s.rollbackTransaction();
                    s.startTransaction();
                    s.if(
                      sql`exists (select 1 from db.spark_action_log
                        where id = action_record.id and status = 'approved')`,
                      (s) => {
                        s.modify(sql`
                          update db.spark_action_log
                          set status = 'failed',
                              result_json = json_build_object(
                                'error',
                                'Action failed; no changes were committed. ' || coalesce(nullif(act_exec_error.message,''),'Unknown error.')
                              )
                          where id = action_record.id`);
                        s.modify(sql`
                          insert into db.spark_agent_events
                            (spark_agent_id, type, content, action_id, created_at)
                          values (
                            action_record.spark_agent_id,
                            'error_occurred',
                            'Action failed; no changes were committed. ' || coalesce(nullif(act_exec_error.message,''),'Unknown error.'),
                            action_record.id,
                            now()
                          )`);
                        s.commitTransaction();
                      },
                    ).else((s) => s.rollbackTransaction());
                  },
                  errorName: "act_exec_error",
                });
              },
            );
          }
        }

        // Actions without a procedure: just mark as executed
        if (!hasAnyExecute || approvalActions.some((a) => !a.procedure)) {
          const noExecNames = approvalActions.filter((a) => !a.procedure);
          let noExecCheck: Sql;
          if (noExecNames.length === 0 && !hasAnyExecute) {
            noExecCheck = sql`true`;
          } else if (noExecNames.length > 0) {
            noExecCheck = sql`action_record.action_name = ${
              sql.lit(noExecNames[0].qualifiedName)
            }`;
            for (let i = 1; i < noExecNames.length; i++) {
              noExecCheck = sql`${noExecCheck} or action_record.action_name = ${
                sql.lit(noExecNames[i].qualifiedName)
              }`;
            }
          } else {
            noExecCheck = sql`false`;
          }
          s.if(noExecCheck, (s) => {
            s.startTransaction();
            s.if(
              sql`exists (select 1 from db.spark_action_log
                where id = action_record.id and status = 'approved')`,
              (s) => {
                s.modify(sql`
                  update db.spark_action_log
                  set status = 'executed'
                  where id = action_record.id`);
                s.modify(sql`
                  insert into db.spark_agent_events
                    (spark_agent_id, type, content, action_id, created_at)
                  values (
                    action_record.spark_agent_id,
                    'action_executed',
                    'Executed: ' || action_record.action_name,
                    action_record.id,
                    now()
                  )`);
                s.commitTransaction();
              },
            ).else((s) => s.rollbackTransaction());
          });
        }

        // After execution, check if all batch actions are done and resume agent
        s.defScalar(
          "remaining_approved",
          sql`(select count(*) from db.spark_action_log
          where spark_conversation_id = action_record.spark_conversation_id
            and (status = 'proposed'
              or (status = 'approved' and input_json is not null))
            and id != action_record.id)`,
        );
        s.if(sql`remaining_approved = 0`, (s) => {
          s.defScalar(
            "waiting_agent_id",
            sql`(select id from db.spark_agents
            where spark_conversation_id = action_record.spark_conversation_id
              and status = 'waiting_on_approval'
            limit 1)`,
          );
          s.if(sql`waiting_agent_id is not null`, (s) => {
            s.startTransaction();
            s.modify(sql`
            insert into db.spark_agent_events
              (spark_agent_id, type, content, created_at)
            values (
              waiting_agent_id,
              'blocker_resolved',
              case when exists (
                select 1 from db.spark_action_log failed_action
                where failed_action.spark_conversation_id =
                    action_record.spark_conversation_id
                  and failed_action.execution_event_id = (
                    select execution_event_id from db.spark_action_log
                    where id = action_record.id
                  )
                  and failed_action.status = 'failed'
              ) then 'Action execution finished with failures: ' || coalesce((
                select string_agg(
                  failed_action.action_name || ': ' || coalesce(
                    failed_action.result_json->>'error',
                    'Unknown action failure'
                  ),
                  '; ' order by failed_action.id
                )
                from db.spark_action_log failed_action
                where failed_action.spark_conversation_id =
                    action_record.spark_conversation_id
                  and failed_action.execution_event_id = (
                    select execution_event_id from db.spark_action_log
                    where id = action_record.id
                  )
                  and failed_action.status = 'failed'
              ), 'Unknown action failure')
              else 'All actions executed' end,
              now()
            )`);
            s.modify(sql`
            update db.spark_agents
            set status = 'awaiting_plan', retry_count = 0, retry_at = null::timestamp
            where id = waiting_agent_id`);
            s.commitTransaction();
          });
        });
      },
    });
  }

  if (reversibleActions.length > 0) {
    system.addReactor({
      name: "spark_action_receipt_repair",
      query: sql`
        select
          al.id,
          (
            select max(version.tx_id)
            from db.spark_agent_events event
            join db.spark_agent_events__versions version
              on version.record_id = event.id
            where event.action_id = al.id
              and event.type = 'action_executed'
              and version.op_kind = 'insert'
          ) as transaction_id
        from db.spark_action_log al
        where al.status in ('approved', 'executed')
          and al.transaction_id is null
          and (${reversibleNameCondition})
          and exists (
            select 1 from db.spark_agent_events event
            where event.action_id = al.id
              and event.type = 'action_executed'
          )
      `,
      recordName: "receipt_record",
      procedure: (s) => {
        s.if(sql`receipt_record.transaction_id is not null`, (s) => {
          s.startTransaction();
          s.modify(sql`
            update db.spark_action_log
            set status = 'executed',
                transaction_id = receipt_record.transaction_id
            where id = receipt_record.id
              and status in ('approved', 'executed')
              and transaction_id is null`);
          s.commitTransaction();
        });
      },
    });
  }

  // ---- ACTION UNDO REACTOR ----
  // Picks up undo_requested actions and runs their undo
  const undoableActions = allActions.filter((a) => a.undo);
  if (undoableActions.length > 0) {
    system.addReactor({
      name: "spark_action_undo",
      query: sql`
        select
          al.id,
          al.spark_conversation_id,
          execution_event.spark_agent_id,
          al.action_name,
          al.input_json,
          al.result_json
        from db.spark_action_log al
        join db.spark_agent_events execution_event
          on execution_event.id = al.execution_event_id
        join db.spark_conversations bc on bc.id = al.spark_conversation_id
        where al.status = 'undo_requested'
          and not bc.is_paused
          and bc.status = 'active'
      `,
      recordName: "undo_record",
      procedure: (s) => {
        s.setContext(
          sql`(select context_json from db.spark_conversations where id = undo_record.spark_conversation_id)`,
        );
        // Context scalars for consumer undo procedures. allowNoRead: which of
        // these an undo reads depends on the registered actions (e.g. the
        // built-in documents.edit_document undo reads only action_result).
        s.defScalar("action_input", {
          expr: sql`undo_record.input_json`,
          allowNoRead: true,
        });
        s.defScalar("action_result", {
          expr: sparkActionUndoResult(sql`undo_record.result_json`),
          allowNoRead: true,
        });
        s.defScalar(
          "action_sys_user_id",
          {
            expr: sql`(select sys_user_id from db.spark_conversations
              where id = undo_record.spark_conversation_id)`,
            allowNoRead: true,
          },
        );

        for (const a of undoableActions) {
          s.if(
            sql`undo_record.action_name = ${sql.lit(a.qualifiedName)}`,
            (s) => {
              s.try({
                body: (s) => {
                  s.startTransaction();
                  s.if(
                    sql`exists (select 1 from db.spark_action_log
                      where id = undo_record.id and status = 'undo_requested')`,
                    (s) => {
                      s.if(
                        sql`undo_record.spark_agent_id is null and not (${
                          sparkSessionActionAllowed(
                            opts,
                            sql`action_sys_user_id`,
                            sql`undo_record.spark_conversation_id`,
                            sql`undo_record.action_name`,
                            a.qualifiedName,
                          )
                        })`,
                        (s) =>
                          s.throwError(
                            sql.lit`This undo is no longer authorized.`,
                          ),
                      );
                      a.undo!(s);
                      s.modify(sql`
                        update db.spark_action_log
                        set status = 'undone', result_json = ${
                        sparkActionUndoResult(sql`undo_record.result_json`)
                      }
                        where id = undo_record.id`);
                      s.if(
                        sql`undo_record.spark_agent_id is not null`,
                        (s) =>
                          s.modify(sql`
                        insert into db.spark_agent_events
                          (spark_agent_id, type, content, action_id, created_at)
                        values (
                          undo_record.spark_agent_id,
                          'action_undone',
                          'Undone: ' || undo_record.action_name,
                          undo_record.id,
                          now()
                        )`),
                      );
                      s.commitTransaction();
                    },
                  ).else((s) => s.rollbackTransaction());
                },
                errorName: "undo_error",
                catch: (s) => {
                  // A direct first rollback preserves the compiler's caught-error record.
                  s.rollbackTransaction();
                  s.startTransaction();
                  s.if(
                    sql`exists (select 1 from db.spark_action_log
                      where id = undo_record.id and status = 'undo_requested')`,
                    (s) => {
                      s.modify(sql`
                        update db.spark_action_log
                        set status = 'executed', result_json = json_build_object('__spark_undo_failure', json_build_object('error', undo_error.message, 'result', ${
                        sparkActionUndoResult(sql`undo_record.result_json`)
                      }))
                        where id = undo_record.id`);
                      s.if(
                        sql`undo_record.spark_agent_id is not null`,
                        (s) =>
                          s.modify(sql`
                        insert into db.spark_agent_events
                          (spark_agent_id, type, content, created_at)
                        values (
                          undo_record.spark_agent_id,
                          'error_occurred',
                          'Undo failed: ' || undo_error.message,
                          now()
                        )`),
                      );
                      s.commitTransaction();
                    },
                  ).else((s) => s.rollbackTransaction());
                },
              });
            },
          );
        }
      },
    });
  }

  // ---- POLICY RESOLVE REACTOR ----
  // Advances or fails an agent that is stuck in a waiting_on_* state
  // and has a non-`ask` policy for that blocker. Composes with the other
  // reactors by writing to the blocker rows (questions/action_log) —
  // auto_approve hands off to action_execute, fail ends the run.
  system.addReactor({
    name: "spark_agent_policy_resolve",
    query: sql`
      select
        ba.id,
        ba.spark_conversation_id,
        ba.status,
        ba.question_policy,
        ba.approval_low_policy,
        ba.approval_high_policy,
        ba.approval_external_policy
      from db.spark_agents ba
      join db.spark_conversations bc on bc.id = ba.spark_conversation_id
      where not bc.is_paused
        and bc.status = 'active'
        and coalesce(ba.execution_mode, 'native') = 'native'
        and (
          (ba.status = 'waiting_on_questions'
            and ba.question_policy in ('fail', 'use_defaults'))
          or (ba.status = 'waiting_on_approval'
            and exists (
              select 1 from db.spark_action_log al
              where al.spark_conversation_id = ba.spark_conversation_id
                and al.status = 'proposed'
                and (
                  (al.danger = 'low'
                    and ba.approval_low_policy in ('auto_approve', 'fail'))
                  or (al.danger = 'high'
                    and ba.approval_high_policy in ('auto_approve', 'fail'))
                  or (al.danger = 'external'
                    and ba.approval_external_policy in ('auto_approve', 'fail'))
                )))
        )
    `,
    recordName: "policy_record",
    procedure: (s) => {
      s.if(
        sql`policy_record.status = 'waiting_on_questions'
            and policy_record.question_policy = 'use_defaults'`,
        (s) => {
          s.startTransaction();
          s.modify(sql`
            insert into db.spark_agent_events
              (spark_agent_id, type, content, created_at)
            values (policy_record.id, 'blocker_resolved',
              'Questions auto-answered per policy (use_defaults). Proceed with reasonable defaults.',
              now())`);
          s.modify(sql`
            update db.spark_agents
            set status = 'awaiting_plan',
                retry_count = 0,
                retry_at = null::timestamp
            where id = policy_record.id`);
          s.commitTransaction();
        },
      );

      s.if(
        sql`policy_record.status = 'waiting_on_questions'
            and policy_record.question_policy = 'fail'`,
        (s) => {
          s.startTransaction();
          s.modify(sql`
            insert into db.spark_agent_events
              (spark_agent_id, type, content, created_at)
            values (
              policy_record.id,
              'error_occurred',
              'Policy: agent asked a question but on_questions = fail.',
              now()
            )`);
          s.modify(sql`
            update db.spark_agents
            set status = 'failed',
                completed_at = now(),
                retry_at = null::timestamp
            where id = policy_record.id`);
          s.modify(sql`
            update db.spark_conversations set is_paused = true
            where id = policy_record.spark_conversation_id`);
          s.commitTransaction();
        },
      );

      s.if(
        sql`policy_record.status = 'waiting_on_approval'`,
        (s) => {
          // If any pending action maps to policy=fail, cancel everything and
          // fail the agent. Otherwise auto-approve every action whose policy
          // is auto_approve (action_execute resumes the agent afterwards).
          s.defScalar(
            "has_fail_action",
            sql`exists (
              select 1 from db.spark_action_log al
              where al.spark_conversation_id = policy_record.spark_conversation_id
                and al.status = 'proposed'
                and (
                  (al.danger = 'low'
                    and policy_record.approval_low_policy = 'fail')
                  or (al.danger = 'high'
                    and policy_record.approval_high_policy = 'fail')
                  or (al.danger = 'external'
                    and policy_record.approval_external_policy = 'fail')
                )
            )`,
          );
          s.if(
            sql`has_fail_action`,
            (s) => {
              s.startTransaction();
              s.modify(sql`
                update db.spark_action_log
                set status = 'cancelled'
                where spark_conversation_id = policy_record.spark_conversation_id
                  and status = 'proposed'`);
              s.modify(sql`
                insert into db.spark_agent_events
                  (spark_agent_id, type, content, created_at)
                values (
                  policy_record.id,
                  'error_occurred',
                  'Policy: action blocked by approval policy = fail.',
                  now()
                )`);
              s.modify(sql`
                update db.spark_agents
                set status = 'failed',
                    completed_at = now(),
                    retry_at = null::timestamp
                where id = policy_record.id`);
              s.modify(sql`
                update db.spark_conversations set is_paused = true
                where id = policy_record.spark_conversation_id`);
              s.commitTransaction();
            },
          ).else((s) => {
            s.startTransaction();
            s.modify(sql`
              update db.spark_action_log
              set status = 'approved'
              where spark_conversation_id = policy_record.spark_conversation_id
                and status = 'proposed'
                and (
                  (danger = 'low'
                    and policy_record.approval_low_policy = 'auto_approve')
                  or (danger = 'high'
                    and policy_record.approval_high_policy = 'auto_approve')
                  or (danger = 'external'
                    and policy_record.approval_external_policy = 'auto_approve')
                )`);
            s.commitTransaction();
          });
        },
      );
    },
  });

  // Retry waits need no scheduled waker: the plan reactor matches
  // failed_retrying_plan rows with `retry_at <= now()` directly, and reactors
  // re-evaluate time-dependent queries when the time condition becomes true.
}
