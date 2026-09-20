import { sql } from "../std/sql_utils";
import type { JsonBuildValue, NumericExpr, Sql } from "../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type {
  AIModel,
  JsonGenerateParams,
  ModelConfig,
  TextGenerateParams,
} from "./ai";
import type { CommonSchema } from "./open_ai";

// We can add more models here as we add support for them
export type GeminiModelNames =
  | "gemini-1.5-flash"
  | "gemini-2.0-flash-thinking-exp"
  | "gemini-2.0-flash"
  | "gemini-2.0-flash-thinking-exp-01-21"
  | "gemini-2.0-flash-lite-preview-02-05"
  | "gemini-2.0-pro-exp-02-05"
  | "gemini-2.5-flash-preview-04-17"
  | "gemini-2.5-pro-preview-03-25"
  | "gemini-2.5-flash-preview-05-20";

export class GeminiModel implements AIModel {
  constructor(
    private modelName: GeminiModelNames,
    private config: ModelConfig = {},
  ) {}

  generateText<T extends IServerBaseStatements>(
    s: T,
    props: TextGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    geminiGenerateText(s, {
      contents: contents ?? [{ role: "user", parts: [{ text: props.prompt }] }],
      model: this.modelName,
      resultScalar: props.resultScalar,
      systemInstruction: systemInstruction ?? this.config.systemInstruction,
      apiKey: this.config.apiKey ?? sql.lit`todo maybe even get rid of this`,
      topK: props.topK,
      topP: props.topP,
      ...this.config,
    });
  }

  generateJson<T extends IServerBaseStatements>(
    s: T,
    props: JsonGenerateParams,
  ) {
    const { contents, systemInstruction } = props;
    geminiGenerateJson(s, {
      contents: contents ?? [{ role: "user", parts: [{ text: props.prompt }] }],
      model: this.modelName,
      responseSchema: props.responseSchema as CommonSchema,
      resultScalar: props.defOutputScalar,
      systemInstruction: systemInstruction ?? this.config.systemInstruction,
      apiKey: this.config.apiKey ?? sql.lit`todo maybe even get rid of this`,
      ...this.config,
    });
  }
}

interface GeminiGenerateTextProps {
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
  systemInstruction?: string | Sql;
  baseUrl?: Sql;
  model?: string | Sql;
  temperature?: number;
  topK?: number;
  topP?: number;
  maxTokens?: number;
  resultScalar?: string;
  /** Record name for structured result: {success, http_status, error_message, is_rate_limit, content, tokens, cost} */
  resultRecord?: string;
  apiKey: Sql;
  ownResultScalar?: boolean;
  /** Pricing per million tokens for cost calculation */
  pricing?: {
    inputCostPerMillion: Sql;
    outputCostPerMillion: Sql;
    cacheReadCostPerMillion: Sql;
    cacheWriteCostPerMillion: Sql;
  };
}
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

export function geminiGenerateText<T extends IServerBaseStatements>(
  s: T,
  opts: GeminiGenerateTextProps,
) {
  const resultScalar = opts.resultScalar ?? "gemini_response";
  const resultRecord = opts.resultRecord ?? "llm_result";
  const model = opts.model;
  const temperature = opts.temperature ?? 0.5;
  const maxTokens = opts.maxTokens ?? 64000;
  const topK = opts.topK;
  const topP = opts.topP;
  if (!opts.apiKey) {
    throw new Error("apiKey is required");
  }
  if (!opts.ownResultScalar) {
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
      uri: sql.concat(
        sql.lit`${opts.baseUrl ?? BASE_URL}`,
        model,
        sql.lit`:generateContent`,
      ),
      method: "POST",
      headers: [
        {
          name: sql.lit`x-goog-api-key`,
          value: opts.apiKey,
        },
      ],
      json: {
        contents: opts.contents,
        system_instruction: {
          parts: [{ text: opts.systemInstruction ?? "" }],
        },
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
          topP: topP,
          topK: topK,
        },
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.debugExpr(sql`response_body`);
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with gemini: `,
          sql`response.status`,
        ),
      );
      s.debugExpr(sql`response_body`);
      // Set structured error result
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
      s.return();
    });
    // Handle multi-part responses from Gemini
    // Gemini often returns responses split into multiple parts
    // We need to concatenate all text parts to get the complete response

    // Since json.array_each doesn't work reliably in scalar contexts,
    // we use a more direct approach with array indexing
    s.defScalar(
      "parts_array",
      sql`response_body->'candidates'->0->'content'->'parts'`,
    );

    // Concatenate up to 10 parts (should be enough for most responses)
    s.defScalar(
      "gemini_content",
      sql`
        coalesce(parts_array->0->>'text', '') ||
        coalesce(parts_array->1->>'text', '') ||
        coalesce(parts_array->2->>'text', '') ||
        coalesce(parts_array->3->>'text', '') ||
        coalesce(parts_array->4->>'text', '') ||
        coalesce(parts_array->5->>'text', '') ||
        coalesce(parts_array->6->>'text', '') ||
        coalesce(parts_array->7->>'text', '') ||
        coalesce(parts_array->8->>'text', '') ||
        coalesce(parts_array->9->>'text', '')
      `,
    );
    s.setScalar(resultScalar, sql`gemini_content`);

    // Extract token usage from Gemini response
    // Gemini usageMetadata: promptTokenCount, candidatesTokenCount, cachedContentTokenCount
    s.defScalar(
      "gemini_prompt_tokens",
      sql`coalesce(try_cast(response_body->'usageMetadata'->>'promptTokenCount' as int), 0)`,
    );
    s.defScalar(
      "gemini_output_tokens",
      sql`coalesce(try_cast(response_body->'usageMetadata'->>'candidatesTokenCount' as int), 0)`,
    );
    // s.defScalar("gemini_cached_tokens", sql`coalesce((response_body->'usageMetadata'->>'cachedContentTokenCount')::int, 0)`);

    // For Gemini, promptTokenCount includes cachedContentTokenCount
    // Uncached input = promptTokenCount - cachedContentTokenCount
    s.defScalar("gemini_uncached_input", sql`gemini_prompt_tokens`);

    // Log token usage
    s.debugExpr(
      sql`'Gemini tokens - prompt: ' || gemini_prompt_tokens || ', output: ' || gemini_output_tokens`,
    );

    // Calculate cost if pricing is provided
    // Gemini: uncached input at input rate, cached input at cache_read rate (25% of input), output at output rate
    let totalCostExpr: Sql;
    if (opts.pricing) {
      totalCostExpr = sql`(
        (gemini_uncached_input * ${opts.pricing.inputCostPerMillion} / 1000000.0) +
        (gemini_output_tokens * ${opts.pricing.outputCostPerMillion} / 1000000.0)
      )`;
    } else {
      totalCostExpr = sql`0`;
    }

    s.modify(sql`
      insert into ${sql.ref(resultRecord)} (
        success, http_status, error_message, is_rate_limit, content,
        input_tokens, output_tokens, cache_write_tokens, total_cost
      )
      values (
        true,
        response.status,
        null,
        false,
        gemini_content,
        gemini_uncached_input,
        gemini_output_tokens,
        0,
        ${totalCostExpr}
      )
    `);
  });
}

interface GeminiGenerateJsonProps {
  contents:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[]
    | undefined;
  responseSchema: CommonSchema;
  systemInstruction?: string | Sql;
  model?: Sql | string;
  temperature?: NumericExpr;
  maxTokens?: NumericExpr;
  resultScalar?: string;
  apiKey: Sql;
}

export function geminiGenerateJson<T extends IServerBaseStatements>(
  s: T,
  opts: GeminiGenerateJsonProps,
) {
  const resultScalar = opts.resultScalar ?? "gemini_response";
  const model = opts.model;
  const temperature = opts.temperature ?? 0.5;
  const maxTokens = opts.maxTokens ?? 64000;
  if (!opts.apiKey) {
    throw new Error("apiKey is required");
  }
  s.defScalar(resultScalar, { type: "Json" });
  s.block((s) => {
    s.request({
      uri: sql.concat(sql.lit`${BASE_URL}`, model, sql.lit`:generateContent`),
      method: "POST",
      headers: [
        {
          name: sql.lit`x-goog-api-key`,
          value: opts.apiKey,
        },
      ],
      json: {
        contents: opts.contents,
        system_instruction: {
          parts: [{ text: opts.systemInstruction ?? "" }],
        },
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
          responseSchema: opts.responseSchema as any,
        },
      },
      receiveJson: "response_body",
      responseRecord: "response",
    });
    s.debugExpr(sql`response_body`);
    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to generate content with gemini: `,
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
    s.setScalar(
      resultScalar,
      sql`(response_body->'candidates'->0->'content'->'parts'->0->>'text')::json`,
    );
  });
}

// =============================================================================
// Gemini Files API - Upload files for use in messages
// =============================================================================

const FILES_API_BASE_URL =
  "https://generativelanguage.googleapis.com/upload/v1beta/files";

interface GeminiUploadFileProps {
  /** API key for authentication */
  apiKey: Sql;
  /** File content as bytes */
  fileContent: Sql;
  /** Filename to use (display name) */
  filename: Sql;
  /** MIME type of the file */
  mimeType: Sql;
  /** Record name for the result */
  resultRecord?: string;
}

/**
 * Upload a file to Gemini's Files API.
 * Returns file metadata including the file URI needed for referencing in messages.
 * Files expire after 48 hours.
 *
 * Response format:
 * {
 *   success: boolean,
 *   provider_file_id: string,  // e.g., "files/abc123" (the URI)
 *   size_bytes: number,
 *   filename: string,
 *   mime_type: string,
 *   created_at: string,
 *   expires_at: string,        // 48 hours from upload
 *   error_message: string | null
 * }
 */
export function geminiUploadFile<T extends IServerBaseStatements>(
  s: T,
  props: GeminiUploadFileProps,
) {
  const resultRecord = props.resultRecord ?? "gemini_file_result";

  s.defRecord(resultRecord, {
    fields: [
      { name: "success", type: "Bool" },
      { name: "provider_file_id", type: "String" },
      { name: "size_bytes", type: "Int" },
      { name: "filename", type: "String" },
      { name: "mime_type", type: "String" },
      { name: "created_at", type: "String" },
      { name: "expires_at", type: "String" },
      { name: "error_message", type: "String" },
    ],
  });

  s.block((s) => {
    // Gemini Files API uses resumable upload protocol
    // Step 1: Start resumable upload to get upload URI
    s.request({
      uri: sql.lit`${FILES_API_BASE_URL}`,
      method: "POST",
      headers: [
        { name: sql.lit`x-goog-api-key`, value: props.apiKey },
        { name: sql.lit`X-Goog-Upload-Protocol`, value: sql.lit`resumable` },
        { name: sql.lit`X-Goog-Upload-Command`, value: sql.lit`start` },
        {
          name: sql.lit`X-Goog-Upload-Header-Content-Type`,
          value: props.mimeType,
        },
      ],
      json: {
        file: {
          display_name: props.filename,
        },
      },
      receiveJson: "start_response_body",
      responseRecord: "start_response",
      responseHeadersTable: "start_response_headers",
    });

    s.if(sql`start_response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to start Gemini file upload: `,
          sql`start_response.status`,
        ),
      );
      s.debugExpr(sql`start_response_body`);
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, created_at, expires_at, error_message
        ) values (
          false, null, 0, null, null, null, null,
          coalesce(start_response_body->'error'->>'message', 'Failed to start upload')
        )
      `);
      s.return();
    });

    // Get upload URI from response header table
    s.defScalar(
      "upload_uri",
      sql`(select value from start_response_headers where name = 'x-goog-upload-url')`,
    );

    // Step 2: Upload the actual file content
    s.request({
      uri: sql`upload_uri`,
      method: "POST",
      headers: [
        { name: sql.lit`Content-Type`, value: props.mimeType },
        { name: sql.lit`X-Goog-Upload-Offset`, value: sql.lit`0` },
        {
          name: sql.lit`X-Goog-Upload-Command`,
          value: sql.lit`upload, finalize`,
        },
      ],
      bytes: props.fileContent,
      receiveJson: "upload_response_body",
      responseRecord: "upload_response",
    });

    s.debugExpr(sql`upload_response_body`);

    s.if(sql`upload_response.status != 200`, (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`Failed to upload file to Gemini: `,
          sql`upload_response.status`,
        ),
      );
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, created_at, expires_at, error_message
        ) values (
          false, null, 0, null, null, null, null,
          coalesce(upload_response_body->'error'->>'message', 'Failed to upload file')
        )
      `);
    });
    s.else((s) => {
      // Gemini returns file info in response.file object
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, created_at, expires_at, error_message
        ) values (
          true,
          upload_response_body->'file'->>'uri',
          coalesce(try_cast(upload_response_body->'file'->>'sizeBytes' as int), 0),
          upload_response_body->'file'->>'displayName',
          upload_response_body->'file'->>'mimeType',
          upload_response_body->'file'->>'createTime',
          upload_response_body->'file'->>'expirationTime',
          null
        )
      `);
    });
  });
}
