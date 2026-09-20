import { getStaticSecret } from "std/services";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

//docs: https://console.groq.com/docs/api-reference

const BASE_URL = "https://api.groq.com/openai/v1";

export const R1_MODEL = "deepseek-r1-distill-llama-70b";

export interface GroqOptions {
  apiKey?: Sql;
}

interface GroqInternalOptions {
  apiKey: Sql;
}

function authHeader(opts: GroqInternalOptions) {
  return {
    name: sql.lit`authorization`,
    value: sql.concat("Bearer ", opts.apiKey),
  };
}

export class Groq {
  #opts: GroqInternalOptions;
  chat: GroqChat;

  constructor(opts: GroqOptions = {}) {
    this.#opts = {
      apiKey: opts.apiKey ?? getStaticSecret(sql.lit`GROQ_API_KEY`),
    };
    this.chat = new GroqChat(this.#opts);
  }
}

export class GroqChat {
  constructor(private opts: GroqInternalOptions) {}

  completions = {
    create: <T extends IServerBaseStatements>(
      s: T,
      opts: {
        messages: {
          role: Sql;
          content: Sql;
        }[];
        model: Sql;
        maxCompletionTokens?: NumericExpr;
        stream?: boolean;
        responseFormat?: {
          type: Sql;
        };
        resultScalar?: string;
        /** Required in preview/local-dev when external services mode is opt-in */
        optIn?: BooleanExpr;
      },
    ) => {
      const resultScalar = opts.resultScalar ?? "ai_response";

      s.defScalar(resultScalar, {
        type: "String",
      });

      s.request({
        method: "POST",
        uri: sql.concat(`${BASE_URL}/chat/completions`),
        optIn: opts.optIn,
        headers: [authHeader(this.opts)],
        json: sql.jsonBuildObject({
          messages: opts.messages,
          model: opts.model,
          max_completion_tokens: opts.maxCompletionTokens ?? 131072,
          stream: opts.stream,
          response_format: opts.responseFormat,
        }),
        receiveJson: "response_body",
        responseRecord: "response",
      });

      s.if(sql`response.status != 200`, (s) => {
        s.debugExpr(
          sql.concat("received error from groq: ", sql`response.status`),
        );
        s.debugExpr(sql`response_body`);
        s.throwError(
          sql`'Received error status from chat completions:' || response.status`,
        );
      });

      s.setScalar(
        resultScalar,
        sql`(response_body->'choices'->0->'message'->>'content')`,
      );
    },
  };
}

export const groq = new Groq();
