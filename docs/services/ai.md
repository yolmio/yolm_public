---
title: AI Services
description: Direct AI model helpers for OpenAI-compatible, Anthropic, Gemini, Groq, Cerebras, and DeepSeek calls from server procedures.
tags:
  - services
  - ai
  - llm
  - integrations
related:
  - blocks/ai_providers.md
  - blocks/spark.md
  - services/solution_services.md
  - sql/ai_decisions.md
---

# AI Services

For classification, probability filters, routing to fixed outcomes, or scoring
against a rubric, prefer the provider-independent
[AI decision SQL functions](../sql/ai_decisions.md). Use the generation helpers
below for prose, arbitrary JSON extraction, and tool calls.

Use `services/ai` when system code needs direct model calls from server-side
statements. For admin-configurable providers, prefer
[`AiProvidersBlock`](../blocks/ai_providers.md).

```ts
import {
  anthropic,
  cerebras,
  deepseek,
  gemini,
  generateJson,
  generateText,
  generateToolUse,
  groq,
  openai,
} from "services/ai";
import { sql } from "std/sql_utils";
```

## Model Factories

Each factory returns an `AIModel`.

| Factory | Default secret | Notes |
| --- | --- | --- |
| `openai(modelOrOpts)` | `OPENAI_API_KEY` | OpenAI chat-completions models. |
| `groq(modelOrOpts)` | `GROQ_API_KEY` | OpenAI-compatible Groq endpoint. |
| `cerebras(modelOrOpts)` | `CEREBRAS_API_KEY` | OpenAI-compatible Cerebras endpoint. |
| `deepseek(modelOrOpts)` | `DEEPSEEK_API_KEY` | OpenAI-compatible DeepSeek endpoint. |
| `anthropic(modelOrOpts)` | `ANTHROPIC_API_KEY` | Anthropic message API. |
| `gemini(modelOrOpts)` | None | Gemini API. Pass `config.apiKey`. |

Pass either a model-name string or `{ modelName, config }`. `config` accepts
`topK`, `topP`, `temperature`, `maxTokens`, `systemInstruction`, `apiKey`, and
`contents`.

## Text

```ts
const model = openai("gpt-4o-mini");

generateText(s, {
  model,
  prompt: sql`'Summarize this account: ' || account.name`,
  resultScalar: "summary",
});
```

`generateText` writes the provider response text to `resultScalar`.

## JSON

```ts
generateJson(s, {
  model: anthropic("claude-3-5-sonnet-20241022"),
  prompt: sql`ticket.body`,
  responseSchema: {
    type: "object",
    required: ["priority", "reason"],
    properties: {
      priority: { type: "string", enum: ["low", "normal", "urgent"] },
      reason: { type: "string" },
    },
  },
  defOutputScalar: "triage_json",
});
```

`responseSchema` uses the `CommonSchema` shape from `services/open_ai`.
`defOutputScalar` is the output scalar name.

## Tool Use

```ts
generateToolUse(s, {
  model: openai("gpt-4o"),
  prompt: "Pick the best next action.",
  tools: [{
    type: "function",
    function: {
      name: "create_task",
      description: "Create a follow-up task",
      parameters: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string" } },
      },
    },
  }],
  resultScalar: "assistant_text",
  toolCallsTable: "tool_calls",
});
```

`generateToolUse` requires a model implementation that supports tool use. It
throws a procedure error when the selected model does not.

For simple transactional tool execution, `services/ai_simple_tools` exports
`generateTools(s, opts)`. It calls `generateToolUse`, writes tool calls into
`opts.resultTable`, opens a transaction when calls exist, and runs the matching
tool `procedure` callbacks.

## Vendor-specific modules

Most system code should use the `services/ai` factories above. Use these
lower-level modules only when a provider-specific request or response feature
is required:

| Module | Public surface | Use when |
| --- | --- | --- |
| `services/open_ai` | `OpenAIModel`, `CommonSchema`, `Tool`, `ToolChoice`, `openAIGenerateText`, `openAIGenerateJson`, `openAIGenerateToolUse` | You need the OpenAI-compatible request shape or options directly. |
| `services/anthropic` | `AnthropicModel`, `anthropicGenerateText`, `anthropicGenerateJson`, `anthropicUploadFile` | You need Anthropic-specific model names, caching, or file upload. |
| `services/gemini` | `GeminiModel`, `geminiGenerateText`, `geminiGenerateJson`, `geminiUploadFile` | You need Gemini-specific contents or file-upload behavior. |
| `services/groq` | `Groq`, `GroqChat`, `R1_MODEL`, `groq` | You need the native `chat.completions.create` request surface. |
| `services/ai_simple_tools` | `SimpleTool`, `SimpleHooks`, `GenerateOptions`, `generateTools` | You need transactional execution of model-selected application tools. |

The lower-level generation helpers still run inside server statement builders;
they do not provide a general TypeScript runtime. They read the same static
secrets as the higher-level factories. Neither layer exposes an `optIn`
option, so these calls stay gated when the runtime puts external services in
[opt-in mode](./solution_services.md#external-service-opt-in). Keep
provider-specific code behind a small system helper when the rest of the
application should remain provider-neutral.
