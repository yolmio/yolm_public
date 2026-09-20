import { sql } from "../std/sql_utils";
import type { JsonBuildValue, Sql } from "../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type {
  JsonGenerateParams,
  ModelConfig,
  TextGenerateParams,
  ToolUseGenerateParams,
} from "./ai";
import type { AIModel } from "./ai";

export class OpenAIModel implements AIModel {
  constructor(
    private modelName: string,
    private baseUrl: string,
    private config: ModelConfig,
    private supportsSystemInstruction = true,
  ) {}

  generateText<T extends IServerBaseStatements>(
    s: T,
    props: TextGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    let contentsFixed = contents;
    if (!contents) {
      contentsFixed = [];
      if (systemInstruction || this.config.systemInstruction) {
        contentsFixed.push({
          role: this.supportsSystemInstruction ? "system" : "user",
          content: systemInstruction ?? this.config.systemInstruction ?? "",
        });
      }
      contentsFixed.push({
        role: "user",
        content: props.prompt,
      });
    }
    openAIGenerateText(s, {
      contents: contentsFixed,
      model: this.modelName,
      baseUrl: this.baseUrl,
      resultScalar: props.resultScalar,
      apiKey: this.config.apiKey!,
      ...this.config,
    });
  }

  generateJson<T extends IServerBaseStatements>(
    s: T,
    props: JsonGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    let contentsFixed = contents;
    if (!contents) {
      contentsFixed = [];
      if (systemInstruction || this.config.systemInstruction) {
        contentsFixed.push({
          role: this.supportsSystemInstruction ? "system" : "user",
          content: systemInstruction ?? this.config.systemInstruction ?? "",
        });
      }
      contentsFixed.push({
        role: "user",
        content: props.prompt,
      });
    }
    openAIGenerateJson(s, {
      contents: contentsFixed,
      model: this.modelName,
      baseUrl: this.baseUrl,
      responseSchema: props.responseSchema,
      defOutputScalar: props.defOutputScalar,
      apiKey: this.config.apiKey!,
      ...this.config,
    });
  }

  generateToolUse<T extends IServerBaseStatements>(
    s: T,
    props: ToolUseGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    let contentsFixed = contents;
    if (!contents) {
      contentsFixed = [];
      if (systemInstruction || this.config.systemInstruction) {
        contentsFixed.push({
          role: this.supportsSystemInstruction ? "system" : "user",
          content: systemInstruction ?? this.config.systemInstruction ?? "",
        });
      }
      contentsFixed.push({
        role: "user",
        content: props.prompt,
      });
    }
    openAIGenerateToolUse(s, {
      contents: contentsFixed,
      model: this.modelName,
      baseUrl: this.baseUrl,
      tools: props.tools,
      toolChoice: props.toolChoice,
      resultScalar: props.resultScalar,
      toolCallsTable: props.toolCallsTable,
      apiKey: this.config.apiKey!,
      ...this.config,
    });
  }
}

/** Data type for the Schema object */
export type SchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object";

/** Represents a select subset of an OpenAPI 3.0 schema object */
export interface CommonSchema {
  /** Required. Data type. */
  type: SchemaType;
  description?: string;
  /** Optional. Indicates if the value may be null. */
  enum?: string[];
  /** Maximum number of the elements for Type.ARRAY. */
  properties?: { [key: string]: CommonSchema };
  /** Required properties of Type.OBJECT. */
  required?: string[];
  /** Schema of the elements of Type.ARRAY. */
  items?: CommonSchema;
}

/** Tool/Function definition for OpenAI-compatible APIs */
export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: CommonSchema;
  };
}

/** Tool choice options */
export type ToolChoice = "auto" | "none" | "required" | {
  type: "function";
  function: { name: string };
};

interface OpenAIGenerateTextProps {
  model: string | Sql;
  resultScalar?: string;
  /** Record name for structured result: {success, http_status, error_message, is_rate_limit, content, tokens, cost} */
  resultRecord?: string;
  ownResultScalar?: boolean;
  temperature?: number;
  maxTokens?: number;
  apiKey: Sql;
  baseUrl: string | Sql;
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
  /** Pricing per million tokens for cost calculation */
  pricing?: {
    inputCostPerMillion: Sql;
    outputCostPerMillion: Sql;
    cacheReadCostPerMillion: Sql;
    cacheWriteCostPerMillion: Sql;
  };
}

export function openAIGenerateText<T extends IServerBaseStatements>(
  s: T,
  props: OpenAIGenerateTextProps,
) {
  const resultScalar = props.resultScalar ?? "openai_response";
  const resultRecord = props.resultRecord ?? "llm_result";
  const model = props.model;
  const temperature = props.temperature;
  const maxTokens = props.maxTokens ?? 64000;
  const contents = props.contents;
  if (!props.ownResultScalar) {
    s.defScalar(resultScalar, { type: "String" });
    // Define result record for structured error handling (only if not using ownResultScalar,
    // meaning caller will define it at outer scope)
    s.defRecord(resultRecord, {
      fields: [
        { name: "success", type: "Bool" },
        { name: "http_status", type: "Int" },
        { name: "error_message", type: "String" },
        { name: "is_rate_limit", type: "Bool" },
        { name: "input_tokens", type: "Int" },
        { name: "output_tokens", type: "Int" },
        { name: "cache_read_tokens", type: "Int" },
        { name: "cache_write_tokens", type: "Int" },
        {
          name: "total_cost",
          type: { type: "Decimal", precision: 10, scale: 6, signed: true },
        },
        { name: "content", type: "String" },
      ],
    });
  }
  s.block((s) => {
    s.request({
      uri: sql.lit`${props.baseUrl}`,
      method: "POST",
      headers: [
        {
          name: sql.lit`Authorization`,
          value: sql.concat("Bearer ", props.apiKey),
        },
      ],
      json: {
        model: model,
        temperature: temperature,
        max_tokens: maxTokens,
        messages: contents,
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with openai: `,
          sql`response.status`,
        ),
      );
      s.debugExpr(sql`response_body`);
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, http_status, error_message, is_rate_limit, content,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_cost
        )
        values (
          false,
          response.status,
          coalesce(
            response_body->'error'->>'message',
            response_body->>'message',
            'Failed to generate content'
          ),
          response.status = 429,
          null,
          0, 0, 0, 0, 0
        )
      `);
    });
    s.else((s) => {
      s.setScalar(
        resultScalar,
        sql`response_body->'choices'->0->'message'->>'content'`,
      );

      // Extract token usage from OpenAI response
      // OpenAI usage: prompt_tokens, completion_tokens, prompt_tokens_details.cached_tokens
      s.defScalar(
        "openai_prompt_tokens",
        sql`coalesce(try_cast(response_body->'usage'->>'prompt_tokens' as int), 0)`,
      );
      s.defScalar(
        "openai_completion_tokens",
        sql`coalesce(try_cast(response_body->'usage'->>'completion_tokens' as int), 0)`,
      );
      s.defScalar(
        "openai_cached_tokens",
        sql`coalesce(try_cast(response_body->'usage'->'prompt_tokens_details'->>'cached_tokens' as int), 0)`,
      );

      // For OpenAI, prompt_tokens includes cached_tokens, so we need to split them
      // Non-cached input = prompt_tokens - cached_tokens
      s.defScalar(
        "openai_uncached_input",
        sql`openai_prompt_tokens - openai_cached_tokens`,
      );

      // Log token usage
      s.debugExpr(
        sql`'OpenAI tokens - prompt: ' || openai_prompt_tokens || ', completion: ' || openai_completion_tokens || ', cached: ' || openai_cached_tokens`,
      );

      // Calculate cost if pricing is provided
      // OpenAI: uncached input at input rate, cached input at cache_read rate (50% of input), output at output rate
      let totalCostExpr: Sql;
      if (props.pricing) {
        totalCostExpr = sql`(
          (openai_uncached_input * ${props.pricing.inputCostPerMillion} / 1000000.0) +
          (openai_completion_tokens * ${props.pricing.outputCostPerMillion} / 1000000.0) +
          (openai_cached_tokens * ${props.pricing.cacheReadCostPerMillion} / 1000000.0)
        )`;
      } else {
        totalCostExpr = sql`0`;
      }

      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, http_status, error_message, is_rate_limit, content,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_cost
        )
        values (
          true,
          response.status,
          null,
          false,
          response_body->'choices'->0->'message'->>'content',
          openai_uncached_input,
          openai_completion_tokens,
          openai_cached_tokens,
          0,
          ${totalCostExpr}
        )
      `);
    });
  });
}

interface OpenAIGenerateJsonProps {
  model: string;
  defOutputScalar?: string;
  responseSchema: CommonSchema;
  temperature?: number;
  maxTokens?: number;
  apiKey: Sql;
  baseUrl: string;
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
}

export function openAIGenerateJson<T extends IServerBaseStatements>(
  s: T,
  props: OpenAIGenerateJsonProps,
) {
  const resultScalar = props.defOutputScalar ?? "openai_response";
  const model = props.model;
  const temperature = props.temperature;
  const maxTokens = props.maxTokens ?? 64000;
  const contents = props.contents;
  s.defScalar(resultScalar, { type: "Json" });
  s.block((s) => {
    s.request({
      uri: sql.lit`${props.baseUrl}`,
      method: "POST",
      headers: [
        {
          name: sql.lit`Authorization`,
          value: sql.concat("Bearer ", props.apiKey),
        },
      ],
      json: {
        model: model,
        temperature: temperature,
        max_tokens: maxTokens,
        messages: contents,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "response",
            schema: {
              ...props.responseSchema,
              type: "object",
            },
          },
        } as any,
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with openai: `,
          sql`response.status`,
        ),
      );
      s.debugExpr(sql`response_body`);
      // Include status code in error message for rate limit detection
      s.throwError(
        sql`'HTTP_STATUS:' || response.status || ':' || coalesce(
          response_body->'error'->>'message',
          response_body->>'message',
          'Failed to generate content'
        )`,
      );
    });
    s.setScalar(
      resultScalar,
      sql`(response_body->'choices'->0->'message'->>'content')::json`,
    );
  });
}

interface OpenAIGenerateToolUseProps {
  model: string;
  tools: Tool[];
  toolChoice?: ToolChoice;
  resultScalar?: string;
  toolCallsTable?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey: Sql;
  baseUrl: string;
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
}

export function openAIGenerateToolUse<T extends IServerBaseStatements>(
  s: T,
  props: OpenAIGenerateToolUseProps,
) {
  const resultScalar = props.resultScalar ?? "openai_response";
  const toolCallsTable = props.toolCallsTable ?? "tool_calls";
  const model = props.model;
  const temperature = props.temperature;
  const maxTokens = props.maxTokens;
  const contents = props.contents;
  const tools = props.tools;
  const toolChoice = props.toolChoice ?? "auto";

  s.defScalar(resultScalar, { type: "String" });
  s.defTable(toolCallsTable, {
    fields: [
      { name: "id", type: "String" },
      { name: "type", type: "String" },
      { name: "function_name", type: "String" },
      { name: "function_arguments", type: "Json" },
    ],
  });

  s.block((s) => {
    s.request({
      uri: sql.lit`${props.baseUrl}`,
      method: "POST",
      headers: [
        {
          name: sql.lit`Authorization`,
          value: sql.concat("Bearer ", props.apiKey),
        },
      ],
      json: {
        model: model,
        temperature: temperature,
        max_tokens: maxTokens,
        messages: contents,
        tools: tools as any,
        tool_choice: toolChoice as any,
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with tool use: `,
          sql`response.status`,
        ),
      );
      s.debugExpr(sql`response_body`);
      // Include status code in error message for rate limit detection
      s.throwError(
        sql`'HTTP_STATUS:' || response.status || ':' || coalesce(
          response_body->'error'->>'message',
          response_body->>'message',
          'Failed to generate content'
        )`,
      );
    });

    // Extract text content if any
    s.setScalar(
      resultScalar,
      sql`response_body->'choices'->0->'message'->>'content'`,
    );
    s.modify(sql`
        insert into ${
      sql.ref(toolCallsTable)
    } (id, type, function_name, function_arguments)
        select
          value->>'id' as id,
          'function' as type,
          value->'function'->>'name' as function_name,
          (value->'function'->>'arguments')::json as function_arguments
        from json.array_each(response_body->'choices'->0->'message'->'tool_calls')
      `);
  });
}
