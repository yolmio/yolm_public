import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type { AIModel } from "./ai";
import type { CommonSchema, Tool, ToolChoice } from "./open_ai";
import { generateToolUse } from "./ai";

/**
 * Simple tool definition with inline procedure
 */
export interface SimpleTool {
  name: string;
  description: string;
  inputSchema: CommonSchema;
  procedure: (s: IServerBaseStatements, context: { input: Sql }) => void;
}

/**
 * Simple hooks for the generate function
 */
export interface SimpleHooks {
  beforeTransactionStart?: (
    s: IServerBaseStatements,
    context: { toolCallTable: string },
  ) => void;
  afterTransactionStart?: (
    s: IServerBaseStatements,
    context: { toolCallTable: string },
  ) => void;
  beforeTransactionCommit?: (
    s: IServerBaseStatements,
    context: { toolCallTable: string },
  ) => void;
  afterTransactionCommit?: (
    s: IServerBaseStatements,
    context: { toolCallTable: string },
  ) => void;
}

/**
 * Options for the simple generate function
 */
export interface GenerateOptions {
  model: AIModel;
  prompt?: Sql | string;
  systemInstruction?: Sql | string;
  tools: SimpleTool[];
  toolChoice?: ToolChoice;
  hooks?: SimpleHooks;
  resultScalar?: string;
  resultTable: string;
}

/**
 * Simple AI generation with tools
 */
export function generateTools<T extends IServerBaseStatements>(
  s: T,
  options: GenerateOptions,
): void {
  const {
    model,
    prompt,
    systemInstruction,
    tools,
    toolChoice = "auto",
    hooks,
    resultScalar = "ai_response",
    resultTable,
  } = options;
  // Convert tools to OpenAI format
  const openAITools: Tool[] = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  // Generate AI response with tools
  generateToolUse(s, {
    model,
    prompt: typeof prompt === "string" ? sql.lit`${prompt}` : prompt,
    systemInstruction,
    tools: openAITools,
    toolChoice,
    resultScalar,
    toolCallsTable: resultTable,
  });
  // Process tool calls
  s.defScalar(
    "has_tool_calls",
    sql`exists(select 1 from ${sql.ref(resultTable)})`,
  );

  s.if(sql`has_tool_calls`, (s) => {
    // Execute before tool hook
    hooks?.beforeTransactionStart?.(s, { toolCallTable: resultTable });
    s.startTransaction();
    hooks?.afterTransactionStart?.(s, { toolCallTable: resultTable });
    // Find and execute the matching tool
    tools.forEach((tool) => {
      s.defRecord(
        "tool_call",
        sql`select function_name, function_arguments from ${
          sql.ref(resultTable)
        } where function_name = ${sql.lit(tool.name)}`,
      );
      s.if(
        sql`tool_call.function_name is not null and tool_call.function_name = ${
          sql.lit(tool.name)
        }`,
        (s) => {
          tool.procedure(s, { input: sql`tool_call.function_arguments::json` });
        },
      );
    });
    hooks?.beforeTransactionCommit?.(s, { toolCallTable: resultTable });
    s.commitTransaction();
    hooks?.afterTransactionCommit?.(s, { toolCallTable: resultTable });
  });
}
