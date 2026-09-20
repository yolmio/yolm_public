import { sql } from "../std/sql_utils";
import type { JsonBuildValue, Sql } from "../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { AnthropicModel } from "./anthropic";
import type { AnthropicModelNames } from "./anthropic";

import { getStaticSecret } from "std/services";
import { GeminiModel } from "./gemini";
import type { GeminiModelNames } from "./gemini";
import { OpenAIModel } from "./open_ai";
import type { CommonSchema, Tool, ToolChoice } from "./open_ai";

export type ModelConfig = {
  topK?: number;
  topP?: number;
  temperature?: number;
  maxTokens?: number;
  systemInstruction?: string | Sql;
  apiKey?: Sql;
  //contents is different for openai and anthropic and gemini please refer to
  // the docs for more details how the contents is passed for different models
  contents?:
    | Sql
    | Partial<Record<string, JsonBuildValue>>
    | JsonBuildValue[];
};

export type TextGenerateParams = {
  prompt?: string | Sql;
  resultScalar: string;
} & ModelConfig;

export type JsonGenerateParams = {
  prompt?: string | Sql;
  responseSchema: CommonSchema;
  defOutputScalar?: string;
} & ModelConfig;

export type ToolUseGenerateParams = {
  prompt?: string | Sql;
  tools: Tool[];
  toolChoice?: ToolChoice;
  resultScalar?: string;
  toolCallsTable?: string;
} & ModelConfig;

export interface AIModel {
  generateText<T extends IServerBaseStatements>(
    s: T,
    props: TextGenerateParams,
  ): void;
  generateJson<T extends IServerBaseStatements>(
    s: T,
    props: JsonGenerateParams,
  ): void;
  generateToolUse?<T extends IServerBaseStatements>(
    s: T,
    props: ToolUseGenerateParams,
  ): void;
}

type OpenAIModelNames = "gpt-4o" | "gpt-4o-mini" | "o3-mini" | "o1" | "o1-mini";

export const openai = (
  opts:
    | {
      modelName: OpenAIModelNames;
      config?: ModelConfig;
    }
    | OpenAIModelNames,
): AIModel => {
  const modelName = typeof opts === "string" ? opts : opts.modelName;
  const config = typeof opts === "string" ? undefined : opts.config;
  return new OpenAIModel(
    modelName,
    "https://api.openai.com/v1/chat/completions",
    config ?? {
      apiKey: getStaticSecret(sql.lit`OPENAI_API_KEY`),
    },
    !["o1-mini", "o1", "o3-mini"].includes(modelName),
  );
};

type GroqModelNames =
  | "distil-whisper-large-v3-en"
  | "gemma2-9b-it"
  | "llama-3.3-70b-versatile"
  | "llama-3.1-8b-instant"
  | "llama-guard-3-8b"
  | "llama3-70b-8192"
  | "llama3-8b-8192"
  | "mixtral-8x7b-32768"
  | "whisper-large-v3"
  | "whisper-large-v3-turbo"
  | "deepseek-r1-distill-llama-70b-specdec"
  | "deepseek-r1-distill-llama-70b"
  | "llama-3.3-70b-specdec"
  | "llama-3.2-1b-preview"
  | "llama-3.2-3b-preview"
  | "llama-3.2-11b-vision-preview"
  | "llama-3.2-90b-vision-preview";

export const groq = (
  opts:
    | {
      modelName: GroqModelNames;
      config?: ModelConfig;
    }
    | GroqModelNames,
): AIModel => {
  const modelName = typeof opts === "string" ? opts : opts.modelName;
  const config = typeof opts === "string" ? undefined : opts.config;
  if (config && !config.apiKey) {
    config.apiKey = getStaticSecret(sql.lit`GROQ_API_KEY`);
  }
  return new OpenAIModel(
    modelName,
    "https://api.groq.com/openai/v1/chat/completions",
    config ?? {
      apiKey: getStaticSecret(sql.lit`GROQ_API_KEY`),
    },
  );
};

type CerebrasModelNames = "qwen-3-coder-480b";

export const cerebras = (
  opts:
    | {
      modelName: CerebrasModelNames;
      config?: ModelConfig;
    }
    | CerebrasModelNames,
): AIModel => {
  const modelName = typeof opts === "string" ? opts : opts.modelName;
  const config = typeof opts === "string" ? undefined : opts.config;
  return new OpenAIModel(
    modelName,
    "https://api.cerebras.ai/v1/chat/completions",
    config ?? {
      apiKey: getStaticSecret(sql.lit`CEREBRAS_API_KEY`),
    },
  );
};

type DeepseekModelNames = "deepseek-chat" | "deepseek-reasoner";

export const deepseek = (
  opts:
    | {
      modelName: DeepseekModelNames;
      config?: ModelConfig;
    }
    | DeepseekModelNames,
): AIModel => {
  const modelName = typeof opts === "string" ? opts : opts.modelName;
  const config = typeof opts === "string" ? undefined : opts.config;
  return new OpenAIModel(
    modelName,
    "https://api.deepseek.com/v1/chat/completions",
    config ?? {
      apiKey: getStaticSecret(sql.lit`DEEPSEEK_API_KEY`),
    },
  );
};

export const anthropic = (
  opts:
    | {
      modelName: AnthropicModelNames;
      config?: ModelConfig;
    }
    | AnthropicModelNames,
): AIModel => {
  const modelName = typeof opts === "string" ? opts : opts.modelName;
  const config = typeof opts === "string" ? undefined : opts.config;
  return new AnthropicModel(
    modelName,
    config ?? {
      apiKey: getStaticSecret(sql.lit`ANTHROPIC_API_KEY`),
    },
  );
};

export const gemini = (
  opts:
    | {
      modelName: GeminiModelNames;
      config?: ModelConfig;
    }
    | GeminiModelNames,
): AIModel => {
  const modelName = typeof opts === "string" ? opts : opts.modelName;
  const config = typeof opts === "string" ? undefined : opts.config;
  return new GeminiModel(modelName, config);
};

export function generateText<T extends IServerBaseStatements>(
  s: T,
  props: TextGenerateParams & { model: AIModel },
) {
  props.model.generateText(s, props);
}

export function generateJson<T extends IServerBaseStatements>(
  s: T,
  props: JsonGenerateParams & { model: AIModel },
) {
  props.model.generateJson(s, props);
}

export function generateToolUse<T extends IServerBaseStatements>(
  s: T,
  props: ToolUseGenerateParams & { model: AIModel },
) {
  if (!props.model.generateToolUse) {
    s.throwError(sql.lit`Tool use is not supported by this model`);
    return;
  }
  props.model.generateToolUse(s, props);
}
