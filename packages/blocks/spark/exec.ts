import { registerSparkBulkUndo } from "./bulk_undo";
import { userHasPermission } from "blocks/auth";
import { mcpPermission } from "blocks/mcp";
import { sql } from "std/sql_utils";
import type {
  HelperProcField,
  ProcedureJavascriptTool,
  ProcedureToolRef,
} from "std/statements";
import { system } from "std/system";
import {
  createSparkTools,
  type RegisterReactorsOpts,
  sparkExecScriptExpr,
} from "./agent";
import {
  hasSparkPermissionGateDescriptor,
  type SparkPermissionGateDescriptor,
  sparkPermissionGateDescriptor,
} from "./permissions";
import { effectiveCapabilitiesJsonExpr } from "./query_policy";

const sparkExecInputScalars: HelperProcField[] = [
  { name: "spark_external", type: "Bool" },
  { name: "spark_read_only", type: "Bool" },
  { name: "mcp_connection_id", type: "BigInt" },
  { name: "spark_js_owner_id", type: "BigInt" },
  { name: "spark_js_conversation_id", type: "BigInt" },
  { name: "spark_js_agent_id", type: "BigInt" },
  { name: "spark_js_execution_event_id", type: "BigInt" },
  { name: "spark_granted_capabilities", type: "Json" },
  { name: "spark_code", type: "String" },
];
/** Action tools never read the script itself. */
const sparkActionToolInputScalars = sparkExecInputScalars.filter(({ name }) =>
  name !== "spark_code"
);

const SPARK_PROCEDURE_TOOL_POLICY = "spark_exec_tool_policy";
const SPARK_LOCAL_NATIVE_TOOL_NAMES = new Set([
  "__sparkEmitImage",
  "actionReceipt",
  "askQuestions",
  "context",
  "createMessage",
  "downloadDriveFile",
  "downloadFile",
  "listAttachments",
  "listArtifacts",
  "listFiles",
  "loadDocument",
  "prepareDriveUpload",
  "previewUndo",
  "query",
  "readAttachment",
  "readArtifact",
  "readCapability",
  "readFile",
  "readFileImage",
  "readFileMarkup",
  "readHelpDocument",
  "readPdfText",
  "renderPdfPage",
  "saveArtifact",
  "searchHelp",
  "showHelpMedia",
  "undoReceipt",
  "undoReceipts",
  "undoLastChanges",
]);
const SPARK_NATIVE_WRITE_TOOL_NAMES = new Set([
  "askQuestions",
  "createMessage",
  "previewUndo",
  "saveArtifact",
  "undoReceipt",
  "undoReceipts",
  "undoLastChanges",
]);
const SPARK_NATIVE_INTERNAL_TOOL_NAMES = new Set([
  "askQuestions",
  "listAttachments",
  "readAttachment",
  "readPdfText",
  "renderPdfPage",
  "undoLastChanges",
]);

interface SparkActionToolPolicyMetadata {
  readonly capability: string;
  readonly actionName: string;
  readonly actionGate: SparkPermissionGateDescriptor;
}

interface SparkFunctionToolPolicyMetadata {
  readonly capability: string;
}
/**
 * The common Spark policy is deliberately independent of the selected action
 * body. It refreshes connection/session access and normalizes the sole
 * untrusted value before a cold entry procedure can be resolved.
 */
function registerSparkProcedureToolPolicy() {
  system.storedProcedure({
    name: SPARK_PROCEDURE_TOOL_POLICY,
    // The runtime invokes the policy before resolving a cold tool target, so
    // it must own its transaction boundary rather than inherit the enclosing
    // RunJavascript procedure's transaction.
    transaction: "standalone",
    inputScalars: [
      { name: "spark_policy_raw_input", type: "Json" },
      { name: "spark_policy_metadata", type: "Json" },
      ...sparkActionToolInputScalars,
    ],
    outputScalars: [
      { name: "spark_policy_normalized_input", type: "Json" },
      { name: "spark_policy_capabilities", type: "Json" },
    ],
    procedure: (s) => {
      const metadata = sql`try_cast(spark_policy_metadata as json)`;
      const metadataClass = sql`${metadata}->>'class'`;
      const capability = sql`(${metadata}->>'capability')`;
      const actionGate = sql`${metadata}->'actionGate'`;
      // Metadata comes from checked registration, never JavaScript arguments.
      s.throwErrorIf(
        sql`coalesce(json_typeof(${metadata}), '') != 'object'
          or coalesce(${metadataClass}, '')
            not in ('spark_action', 'spark_function', 'spark_native')`,
        sql.lit`Invalid Spark tool policy metadata.`,
      );
      s.throwErrorIf(
        sql`${metadataClass} in ('spark_action', 'spark_function') and (
          coalesce(json_typeof(${metadata}->'capability'), '') != 'string'
          or (
            ${metadataClass} = 'spark_action' and (
              coalesce(json_typeof(${metadata}->'actionName'), '') != 'string'
              or coalesce(json_typeof(${actionGate}), '') != 'object'
              or coalesce(${actionGate}->>'mode', '') not in ('all', 'any')
              or coalesce(json_typeof(${actionGate}->'permissions'), '') != 'array'
              or exists(
                select 1
                from json.array_each(
                  case when json_typeof(${actionGate}->'permissions') = 'array'
                    then ${actionGate}->'permissions'
                    else '[]'::json end
                ) spark_policy_permission
                where try_cast(
                  spark_policy_permission.value #>> '{}'
                  as enums.auth_permission
                ) is null
              )
            )
          )
        )`,
        sql.lit`Invalid Spark tool policy metadata.`,
      );
      s.callStoredProcedure("spark_exec_access", {
        inputScalars: {
          spark_external: sql`spark_external`,
          spark_read_only: sql`spark_read_only`,
          mcp_connection_id: sql`mcp_connection_id`,
          spark_js_owner_id: sql`spark_js_owner_id`,
          spark_js_conversation_id: sql`spark_js_conversation_id`,
          spark_granted_capabilities: sql`spark_granted_capabilities`,
        },
        outputScalars: { capabilities: "spark_policy_capabilities" },
      });
      s.throwErrorIf(
        sql`spark_read_only
          and (try_cast(spark_policy_metadata as json)->>'class' = 'spark_action'
            or coalesce(
            try_cast(spark_policy_metadata as json)->>'requiresWrite',
            'false'
          ) = 'true')`,
        sql.lit`This operation is unavailable in read-only execution.`,
      );
      s.throwErrorIf(
        sql`spark_external
          and coalesce(${metadata}->>'internal', 'false') = 'true'`,
        sql.lit`This operation is unavailable through MCP.`,
      );
      s.throwErrorIf(
        sql`${metadataClass} in ('spark_action', 'spark_function')
          and not (spark_policy_capabilities @> json_build_array(${capability}))`,
        sql`case ${metadataClass}
          when 'spark_action' then
            'Capability "' || ${capability} ||
              '" is not enabled for this conversation or its permission is no longer held.'
          else
            'Capability "' || ${capability} ||
              '" is not enabled for this conversation.'
        end`,
      );
      s.throwErrorIf(
        sql`${metadataClass} = 'spark_action'
          and not ${
          hasSparkPermissionGateDescriptor(
            actionGate,
            sql`(select sys_user_id from db.spark_conversations
              where id = spark_js_conversation_id)`,
          )
        }`,
        sql`'You do not have permission to use the "' ||
          (${metadata}->>'actionName') || '" action.'`,
      );
      s.setScalar(
        "spark_policy_normalized_input",
        sql`case ${metadataClass}
          when 'spark_function'
            then coalesce(spark_policy_raw_input->0, '{}'::json)
          else spark_policy_raw_input
        end`,
      );
    },
  });
}

function sparkProcedureToolPolicy() {
  return {
    procedure: SPARK_PROCEDURE_TOOL_POLICY,
    inputBindings: {
      spark_policy_raw_input: { kind: "rawArguments" as const },
      spark_policy_metadata: { kind: "toolMetadata" as const },
      ...Object.fromEntries(
        sparkActionToolInputScalars.map(({ name }) => [name, {
          kind: "trustedHostScalar" as const,
          scalar: name,
        }]),
      ),
    },
    outputBindings: {
      spark_policy_normalized_input: "normalizedArguments",
      spark_policy_capabilities: "capabilities",
    },
  };
}

function sparkActionProcedureTool(
  tool: Pick<ProcedureJavascriptTool, "name" | "timeoutMs">,
  target: ProcedureToolRef,
  opts: SparkActionToolPolicyMetadata & { readonly internal: boolean },
): ProcedureJavascriptTool {
  return {
    name: tool.name,
    timeoutMs: tool.timeoutMs,
    implementation: target,
    inputBindings: {
      ...Object.fromEntries(
        sparkActionToolInputScalars.map(({ name }) => [name, {
          kind: "trustedHostScalar" as const,
          scalar: name,
        }]),
      ),
      tool_input: { kind: "normalizedArguments" },
      spark_js_conv_capabilities: {
        kind: "policyOutput",
        scalar: "capabilities",
      },
    },
    stateOutputs: [{
      outputScalar: "spark_action_tool_capabilities",
      stateScalar: "spark_js_conv_capabilities",
    }],
    policyMetadataJson: JSON.stringify({ class: "spark_action", ...opts }),
  };
}

function sparkFunctionProcedureTool(
  tool: Pick<ProcedureJavascriptTool, "name" | "timeoutMs">,
  target: ProcedureToolRef,
  opts: SparkFunctionToolPolicyMetadata & { readonly internal: boolean },
): ProcedureJavascriptTool {
  return {
    name: tool.name,
    timeoutMs: tool.timeoutMs,
    implementation: target,
    inputBindings: {
      ...Object.fromEntries(
        sparkActionToolInputScalars.map(({ name }) => [name, {
          kind: "trustedHostScalar" as const,
          scalar: name,
        }]),
      ),
      function_input: { kind: "normalizedArguments" },
      spark_js_conv_capabilities: {
        kind: "policyOutput",
        scalar: "capabilities",
      },
    },
    policyMetadataJson: JSON.stringify({ class: "spark_function", ...opts }),
  };
}

function sparkNativeProcedureTool(
  tool: Pick<ProcedureJavascriptTool, "name" | "timeoutMs">,
  target: ProcedureToolRef,
  opts: { internal: boolean; requiresWrite: boolean },
): ProcedureJavascriptTool {
  return {
    name: tool.name,
    timeoutMs: tool.timeoutMs,
    implementation: target,
    inputBindings: {
      ...Object.fromEntries(
        sparkActionToolInputScalars.map(({ name }) => [name, {
          kind: "trustedHostScalar" as const,
          scalar: name,
        }]),
      ),
      tool_input: { kind: "normalizedArguments" },
      spark_js_conv_capabilities: {
        kind: "policyOutput",
        scalar: "capabilities",
      },
    },
    policyMetadataJson: JSON.stringify({
      class: "spark_native",
      internal: opts.internal,
      requiresWrite: opts.requiresWrite,
    }),
  };
}

/** Native Spark and both MCP access modes share one compiled tool environment. */
export function registerSparkExecutor(opts: RegisterReactorsOpts) {
  registerSparkBulkUndo(opts);
  const actionMetadata = new Map<string, SparkActionToolPolicyMetadata>(
    opts.capabilities.flatMap((capability) =>
      (capability.actions ?? []).map((action) =>
        [
          `${capability.name}.${action.name}`,
          {
            capability: capability.name,
            actionName: `${capability.name}.${action.name}`,
            actionGate: sparkPermissionGateDescriptor(
              action.permission,
              action.permissions,
            ),
          },
        ] as const
      )
    ),
  );
  const actions = new Set(actionMetadata.keys());
  const internal = new Set(
    opts.capabilities.filter((c) => c.internal).flatMap((c) =>
      [...(c.actions ?? []), ...(c.functions ?? [])].map((f) =>
        `${c.name}.${f.name}`
      )
    ),
  );
  const tools = createSparkTools(opts);
  // Each action tool compiles once as its own procedure instead of inside
  // spark_exec, which otherwise gates the end of the stored-procedure phase.
  const actionToolProcedures = new Map<string, ProcedureToolRef>();
  for (const tool of tools) {
    if (!actions.has(tool.name)) continue;
    const name = `spark_exec_action_${tool.name.replace(/[^a-z0-9_]/gi, "_")}`;
    if (
      [...actionToolProcedures.values()].some((target) =>
        target.procedure === name
      )
    ) {
      throw new Error(`Duplicate Spark action tool procedure name: ${name}`);
    }
    const target = system.toolEntryProcedure({
      name,
      transaction: "standalone",
      inputScalars: [
        ...sparkActionToolInputScalars,
        { name: "tool_input", type: "Json" },
        { name: "spark_js_conv_capabilities", type: "Json" },
      ],
      outputScalars: [{ name: "spark_action_tool_capabilities", type: "Json" }],
      procedure: (s) => {
        s.setCurrentUser(sql`spark_js_owner_id`);
        s.setContext(
          sql`(select context_json from db.spark_conversations
            where id = spark_js_conversation_id)`,
        );
        s.setScalar(
          "spark_action_tool_capabilities",
          sql`spark_js_conv_capabilities`,
        );
        tool.statements(s);
      },
    });
    actionToolProcedures.set(tool.name, target);
  }
  const functionTools: ProcedureJavascriptTool[] = [];
  const functionProcedureNames = new Set<string>();
  for (const capability of opts.capabilities) {
    for (const fn of capability.functions ?? []) {
      const toolName = `${capability.name}.${fn.name}`;
      const name = `spark_exec_function_${
        toolName.replace(/[^a-z0-9_]/gi, "_")
      }`;
      if (functionProcedureNames.has(name.toLowerCase())) {
        throw new Error(
          `Duplicate Spark function tool procedure name: ${name}`,
        );
      }
      functionProcedureNames.add(name.toLowerCase());
      const target = system.toolEntryProcedure({
        name,
        transaction: "standalone",
        inputScalars: [
          ...sparkActionToolInputScalars,
          { name: "function_input", type: "Json" },
          { name: "spark_js_conv_capabilities", type: "Json" },
        ],
        procedure: (s) => {
          s.setCurrentUser(sql`spark_js_owner_id`);
          s.setContext(
            sql`(select context_json from db.spark_conversations
              where id = spark_js_conversation_id)`,
          );
          s.defScalar(
            "fn_skill_enabled",
            sql`spark_js_conv_capabilities @> json_build_array(${
              sql.lit(capability.name)
            })`,
          );
          s.if(sql`not fn_skill_enabled`, (s) => {
            s.throwError(
              sql
                .lit`Capability "${capability.name}" is not enabled for this conversation.`,
            );
          });
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
          fn.procedure(s, {
            sysUserId: sql`spark_js_owner_id`,
            nativeExecution: {
              eventId: sql`spark_js_execution_event_id`,
              agentId: sql`spark_js_agent_id`,
            },
          });
        },
      });
      functionTools.push(sparkFunctionProcedureTool(
        { name: toolName, timeoutMs: fn.timeoutMs },
        target,
        { internal: internal.has(toolName), capability: capability.name },
      ));
    }
  }
  const nativeToolProcedures = new Map<string, ProcedureToolRef>();
  for (const tool of tools) {
    if (
      actions.has(tool.name) ||
      !SPARK_LOCAL_NATIVE_TOOL_NAMES.has(tool.name)
    ) continue;
    const name = `spark_exec_native_${tool.name.replace(/[^a-z0-9_]/gi, "_")}`;
    if (
      [...nativeToolProcedures.values()].some((target) =>
        target.procedure === name
      )
    ) {
      throw new Error(`Duplicate Spark native tool procedure name: ${name}`);
    }
    const target = system.toolEntryProcedure({
      name,
      transaction: "standalone",
      inputScalars: [
        ...sparkActionToolInputScalars,
        { name: "tool_input", type: "Json" },
        { name: "spark_js_conv_capabilities", type: "Json" },
      ],
      procedure: (s) => {
        s.setCurrentUser(sql`spark_js_owner_id`);
        s.setContext(
          sql`(select context_json from db.spark_conversations
            where id = spark_js_conversation_id)`,
        );
        tool.statements(s);
      },
    });
    nativeToolProcedures.set(tool.name, target);
  }
  const permission = (user: import("std/sql_utils").Sql) =>
    userHasPermission(sql.lit(opts.accessPermission ?? "can_use_spark"), user);
  system.storedProcedure({
    name: "spark_exec_access",
    transaction: "caller",
    inputScalars: [
      { name: "spark_external", type: "Bool" },
      { name: "spark_read_only", type: "Bool" },
      { name: "mcp_connection_id", type: "BigInt" },
      { name: "spark_js_owner_id", type: "BigInt" },
      { name: "spark_js_conversation_id", type: "BigInt" },
      { name: "spark_granted_capabilities", type: "Json" },
    ],
    outputScalars: [{ name: "capabilities", type: "Json" }],
    procedure: (s) => {
      if (opts.mcp !== false) {
        s.if(sql`spark_external`, (s) => {
          s.if(
            sql`not exists(select 1 from db.mcp_connections c join db.sys_users u on u.id = c.sys_user_id where c.id = mcp_connection_id and c.sys_user_id = spark_js_owner_id and c.surface = 'spark' and c.revoked_at is null and not u.disabled and (spark_read_only or c.access = 'write') and (${
              mcpPermission(
                {
                  surface: "spark",
                  domain: "",
                  path: "",
                  settingsPath: "",
                  permission,
                  capabilities: () => sql`'[]'::json`,
                },
                sql`u.id`,
                sql`case when spark_read_only then 'read' else 'write' end`,
              )
            }))`,
            (s) => s.throwError(sql.lit`This connection no longer has access.`),
          );
          s.if(
            sql`spark_js_conversation_id is not null and not exists(select 1 from db.spark_conversations c where c.id = spark_js_conversation_id and c.sys_user_id = spark_js_owner_id and (spark_read_only or (c.status = 'active' and not c.is_paused)))`,
            (s) => s.throwError(sql.lit`Session is unavailable.`),
          );
        });
      }
      s.setScalar(
        "capabilities",
        effectiveCapabilitiesJsonExpr(
          opts.capabilities,
          sql`case when spark_js_conversation_id is null then spark_granted_capabilities else coalesce((select json_array_agg(value) from json.array_each(spark_granted_capabilities) where (select capabilities_json from db.spark_conversations where id = spark_js_conversation_id) @> json_build_array(value)), '[]'::json) end`,
          sql`spark_js_owner_id`,
        ),
      );
    },
  });
  registerSparkProcedureToolPolicy();
  system.storedProcedure({
    name: "spark_exec",
    transaction: "standalone",
    inputScalars: sparkExecInputScalars,
    outputScalars: [{ name: "output", type: "Json" }],
    procedure: (s) => {
      s.defScalar("spark_js_conv_capabilities", { type: "Json" });
      refreshSparkExecAccess(s);
      s.setCurrentUser(sql`spark_js_owner_id`);
      s.setContext(
        sql`(select context_json from db.spark_conversations where id = spark_js_conversation_id)`,
      );
      s.runJavascript({
        script: sql`case when spark_external then ${
          sparkExecScriptExpr(
            {
              ...opts,
              capabilities: opts.capabilities.filter((c) => !c.internal),
            },
            sql`spark_code`,
            true,
          )
        } else ${sparkExecScriptExpr(opts, sql`spark_code`)} end`,
        resultScalar: "spark_result",
        includeLibs: sql`json_build_array('mammoth', 'xlsx')`,
        procedureToolPolicy: sparkProcedureToolPolicy(),
        tools: [
          ...tools.map((tool) => {
            const target = actionToolProcedures.get(tool.name);
            if (target) {
              const metadata = actionMetadata.get(tool.name);
              if (!metadata) {
                throw new Error(
                  `Spark action ${tool.name} lacks policy metadata`,
                );
              }
              return sparkActionProcedureTool(
                tool,
                target,
                { ...metadata, internal: internal.has(tool.name) },
              );
            }
            const nativeTarget = nativeToolProcedures.get(tool.name);
            if (nativeTarget) {
              return sparkNativeProcedureTool(tool, nativeTarget, {
                internal: SPARK_NATIVE_INTERNAL_TOOL_NAMES.has(tool.name),
                requiresWrite: SPARK_NATIVE_WRITE_TOOL_NAMES.has(tool.name),
              });
            }
            throw new Error(
              `Spark tool ${tool.name} lacks a procedure registration`,
            );
          }),
          ...functionTools,
        ],
      });
      s.setScalar("output", sql`spark_result`);
    },
  });
}

export const refreshSparkExecAccess = (
  s: import("std/statements").GeneralServerStatements,
) =>
  s.callStoredProcedure("spark_exec_access", {
    inputScalars: {
      spark_external: sql`spark_external`,
      spark_read_only: sql`spark_read_only`,
      mcp_connection_id: sql`mcp_connection_id`,
      spark_js_owner_id: sql`spark_js_owner_id`,
      spark_js_conversation_id: sql`spark_js_conversation_id`,
      spark_granted_capabilities: sql`spark_granted_capabilities`,
    },
    outputScalars: { capabilities: "spark_js_conv_capabilities" },
  });
