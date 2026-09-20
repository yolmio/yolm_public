import { sql } from "../std/sql_utils";
import type { JsonBuildValue, Sql } from "../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type {
  AIModel,
  JsonGenerateParams,
  ModelConfig,
  TextGenerateParams,
} from "./ai";
import type { CommonSchema } from "./open_ai";

// We can add more models here as we add support for them
export type AnthropicModelNames =
  | "claude-3-5-haiku-20241022"
  | "claude-3-5-sonnet-20241022"
  | "claude-3-7-sonnet-20250219";

export class AnthropicModel implements AIModel {
  constructor(
    private modelName: AnthropicModelNames,
    private config: ModelConfig,
  ) {}

  generateText<T extends IServerBaseStatements>(
    s: T,
    props: TextGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    anthropicGenerateText(s, {
      contents: contents ?? [{ role: "user", content: props.prompt }],
      baseUrl: sql.lit`https://api.anthropic.com/v1/messages`,
      model: this.modelName,
      resultScalar: props.resultScalar,
      systemInstruction: systemInstruction ?? this.config.systemInstruction,
      apiKey: this.config.apiKey!,
      ...this.config,
    });
  }

  generateJson<T extends IServerBaseStatements>(
    s: T,
    props: JsonGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    anthropicGenerateJson(s, {
      contents: contents ?? [{ role: "user", content: props.prompt }],
      model: this.modelName,
      baseUrl: sql.lit`https://api.anthropic.com/v1/messages`,
      responseSchema: props.responseSchema as CommonSchema,
      defOutputScalar: props.defOutputScalar,
      systemInstruction: systemInstruction ?? this.config.systemInstruction,
      apiKey: this.config.apiKey!,
      ...this.config,
    });
  }
}

interface AnthropicGenerateTextProps {
  model: string | Sql;
  baseUrl: Sql;
  resultScalar?: string;
  /** Record name for structured result: {success, http_status, error_message, is_rate_limit, content, tokens, cost} */
  resultRecord?: string;
  ownResultScalar?: boolean;
  maxTokens?: number;
  temperature?: number;
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
  systemInstruction?: string | Sql;
  apiKey: Sql;
  /**
   * Enable prompt caching for Anthropic.
   * When true, system instruction gets cache_control: ephemeral
   * and conversation prefix is cached (all but last message).
   */
  enableCaching?: boolean;
  /** Pricing per million tokens for cost calculation */
  pricing?: {
    inputCostPerMillion: Sql;
    outputCostPerMillion: Sql;
    cacheReadCostPerMillion: Sql;
    cacheWriteCostPerMillion: Sql;
  };
}

export function anthropicGenerateText<T extends IServerBaseStatements>(
  s: T,
  props: AnthropicGenerateTextProps,
) {
  const resultScalar = props.resultScalar ?? "anthropic_response";
  const resultRecord = props.resultRecord ?? "llm_result";
  const model = props.model;
  const maxTokens = props.maxTokens ?? 64_000;
  const temperature = props.temperature ?? 0.5;
  const contents = props.contents;
  const systemInstruction = props.systemInstruction;
  const enableCaching = props.enableCaching ?? false;

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

  // Build system instruction - with caching support when enabled
  // Anthropic caching requires system to be an array of content blocks with cache_control
  let systemBlock: Sql | string | undefined;
  if (enableCaching && systemInstruction) {
    // Convert to cached content block array
    systemBlock = sql`json_build_array(
      json_build_object(
        'type', 'text',
        'text', ${systemInstruction},
        'cache_control', json_build_object('type', 'ephemeral')
      )
    )`;
  } else {
    systemBlock = systemInstruction;
  }

  // Build request headers
  const headers: { name: Sql; value: Sql }[] = [
    {
      name: sql.lit`x-api-key`,
      value: props.apiKey,
    },
    {
      name: sql.lit`anthropic-version`,
      value: sql.lit`2023-06-01`,
    },
  ];

  s.block((s) => {
    s.request({
      uri: props.baseUrl,
      method: "POST",
      headers,
      json: {
        model: model,
        messages: contents,
        max_tokens: maxTokens,
        temperature: temperature,
        system: systemBlock,
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with anthropic: `,
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
      s.setScalar(resultScalar, sql`response_body->'content'->0->>'text'`);

      // Extract token usage from Anthropic response
      // Anthropic usage: input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
      s.defScalar(
        "anthropic_input_tokens",
        sql`coalesce(try_cast(response_body->'usage'->>'input_tokens' as int), 0)`,
      );
      s.defScalar(
        "anthropic_output_tokens",
        sql`coalesce(try_cast(response_body->'usage'->>'output_tokens' as int), 0)`,
      );
      s.defScalar(
        "anthropic_cache_read_tokens",
        sql`coalesce(try_cast(response_body->'usage'->>'cache_read_input_tokens' as int), 0)`,
      );
      s.defScalar(
        "anthropic_cache_write_tokens",
        sql`coalesce(try_cast(response_body->'usage'->>'cache_creation_input_tokens' as int), 0)`,
      );

      // Log cache performance
      s.debugExpr(
        sql`'Anthropic tokens - input: ' || anthropic_input_tokens || ', output: ' || anthropic_output_tokens || ', cache_read: ' || anthropic_cache_read_tokens || ', cache_write: ' || anthropic_cache_write_tokens`,
      );

      // Calculate cost if pricing is provided
      // For Anthropic: input_tokens excludes cached tokens, so we charge:
      // - input_tokens at input rate
      // - cache_write_tokens at cache_write rate (125% of input for 5-min cache)
      // - cache_read_tokens at cache_read rate (10% of input)
      // - output_tokens at output rate
      let totalCostExpr: Sql;
      if (props.pricing) {
        totalCostExpr = sql`(
          (anthropic_input_tokens * ${props.pricing.inputCostPerMillion} / 1000000.0) +
          (anthropic_output_tokens * ${props.pricing.outputCostPerMillion} / 1000000.0) +
          (anthropic_cache_read_tokens * ${props.pricing.cacheReadCostPerMillion} / 1000000.0) +
          (anthropic_cache_write_tokens * ${props.pricing.cacheWriteCostPerMillion} / 1000000.0)
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
          response_body->'content'->0->>'text',
          anthropic_input_tokens,
          anthropic_output_tokens,
          anthropic_cache_read_tokens,
          anthropic_cache_write_tokens,
          ${totalCostExpr}
        )
      `);
    });
  });
}

interface AnthropicGenerateJsonProps {
  model: string | Sql;
  baseUrl: Sql;
  defOutputScalar?: string;
  responseSchema: CommonSchema;
  maxTokens?: number;
  temperature?: number;
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
  systemInstruction?: string | Sql;
  apiKey: Sql;
}

export function anthropicGenerateJson<T extends IServerBaseStatements>(
  s: T,
  props: AnthropicGenerateJsonProps,
) {
  const resultScalar = props.defOutputScalar ?? "anthropic_response";
  const model = props.model;
  const systemPrompt = buildSystemPrompt(
    props.responseSchema,
    props.systemInstruction,
  );
  const maxTokens = props.maxTokens ?? 8192;
  const temperature = props.temperature ?? 0.5;
  const contents = props.contents;
  s.defScalar(resultScalar, { type: "Json" });
  s.block((s) => {
    s.request({
      uri: props.baseUrl,
      method: "POST",
      headers: [
        {
          name: sql.lit`x-api-key`,
          value: props.apiKey,
        },
        {
          name: sql.lit`anthropic-version`,
          value: sql.lit`2023-06-01`,
        },
      ],
      json: {
        model: model,
        messages: contents,
        max_tokens: maxTokens,
        temperature: temperature,
        system: systemPrompt,
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.debugExpr(sql`response_body`);
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with anthropic: `,
          sql`response.status`,
        ),
      );
      // Include status code in error message for rate limit detection
      s.throwError(
        sql`'HTTP_STATUS:' || response.status || ':' || coalesce(
          response_body->'error'->>'message',
          response_body->>'message',
          'Failed to generate content'
        )`,
      );
    });
    s.setScalar(resultScalar, sql`(response_body->'content'->0->'text')::json`);
  });
}
function buildSystemPrompt(
  schema: object,
  systemInstruction?: string | Sql,
): Sql {
  return sql.concat(
    sql
      .lit`You are a JSON generation assistant. You must provide responses that strictly conform to the following JSON schema, with no additional text or explanation:`,
    JSON.stringify(schema, null, 2),
    systemInstruction,
  );
}

// =============================================================================
// Anthropic Files API - Upload files for use in messages
// =============================================================================

interface AnthropicUploadFileProps {
  /** API key for authentication */
  apiKey: Sql;
  /** File content as bytes */
  fileContent: Sql;
  /** Filename to use */
  filename: Sql;
  /** MIME type of the file */
  mimeType: Sql;
  /** Record name for the result */
  resultRecord?: string;
}

/**
 * Upload a file to Anthropic's Files API.
 * Returns file metadata including the provider_file_id needed for referencing in messages.
 *
 * Response format:
 * {
 *   success: boolean,
 *   provider_file_id: string,  // e.g., "file_011CVoSwuzAEZ9BxKMDdx129"
 *   size_bytes: number,
 *   filename: string,
 *   mime_type: string,
 *   downloadable: boolean,
 *   created_at: string,
 *   error_message: string | null
 * }
 */
export function anthropicUploadFile<T extends IServerBaseStatements>(
  s: T,
  props: AnthropicUploadFileProps,
) {
  const resultRecord = props.resultRecord ?? "anthropic_file_result";

  s.defRecord(resultRecord, {
    fields: [
      { name: "success", type: "Bool" },
      { name: "provider_file_id", type: "String" },
      { name: "size_bytes", type: "Int" },
      { name: "filename", type: "String" },
      { name: "mime_type", type: "String" },
      { name: "downloadable", type: "Bool" },
      { name: "created_at", type: "String" },
      { name: "error_message", type: "String" },
    ],
  });

  s.block((s) => {
    // Anthropic Files API - upload file using multipart/form-data
    // Using the beta header: anthropic-beta: files-api-2025-04-14
    // The API expects: -F "file=@/path/to/document.pdf"
    s.debugExpr(sql`'File upload - filename: ' || ${props.filename}`);
    s.debugExpr(sql`'File upload - mime type: ' || ${props.mimeType}`);
    s.request({
      uri: sql.lit`https://api.anthropic.com/v1/files`,
      method: "POST",
      headers: [
        { name: sql.lit`x-api-key`, value: props.apiKey },
        { name: sql.lit`anthropic-version`, value: sql.lit`2023-06-01` },
        { name: sql.lit`anthropic-beta`, value: sql.lit`files-api-2025-04-14` },
      ],
      multipart: [{
        name: sql.lit`file`,
        content_type: props.mimeType,
        bytes_value: props.fileContent,
        filename: props.filename,
      }],
      receiveJson: "file_response_body",
      responseRecord: "file_response",
    });

    s.debugExpr(
      sql`'Anthropic file upload response: ' || file_response_body::text`,
    );

    s.if(sql`file_response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to upload file to Anthropic: `,
          sql`file_response.status`,
        ),
      );
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, downloadable, created_at, error_message
        ) values (
          false, null, 0, null, null, false, null,
          coalesce(file_response_body->'error'->>'message', 'Failed to upload file')
        )
      `);
    });
    s.else((s) => {
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, downloadable, created_at, error_message
        ) values (
          true,
          file_response_body->>'id',
          (file_response_body->>'size_bytes')::int,
          file_response_body->>'filename',
          file_response_body->>'mime_type',
          coalesce((file_response_body->>'downloadable')::bool, false),
          file_response_body->>'created_at',
          null
        )
      `);
    });
  });
}
