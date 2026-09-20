import { agentModelExpr, agentReasoningEffortExpr } from "std/agent_models";
import type {
  EndpointStatementsOrFn,
  GeneralServerStatements,
} from "std/statements";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

/** Keep a started run on its model; a new run reads the conversation choice. */
export function sparkAgentModelExpr(agentId: Sql): Sql {
  return agentModelExpr(sql`coalesce((
    select continuation_state->>'model' from db.spark_agent_events
    where spark_agent_id = ${agentId} and continuation_state->>'model' is not null
    order by id desc limit 1
  ), (
    select conversation.model from db.spark_conversations conversation
    join db.spark_agents agent on agent.spark_conversation_id = conversation.id
    where agent.id = ${agentId}
  ))`);
}

// Trivial stand-in for the `openai_responses_close` call. Its result is never
// inspected by the caller, so both the start-loop's own close and the
// caller's post-commit close (see agent.ts) can share this.
export const nativeSparkMockCloseProcedure: EndpointStatementsOrFn = (s) => {
  s.return(sql`json_build_object('closed', true, 'cancelled', false)`);
};

// A real run always takes some wall-clock time, during which the agent row
// stays 'awaiting_plan' and the UI shows a live "Thinking…" state. Without
// this sleep the mocked run completes before any client poll can observe
// that state, so the whole turn appears to finish atomically.
const nativeSparkMockStartProcedure: EndpointStatementsOrFn = (s) => {
  s.sleep(2000);
  s.return(sql`json_build_object('runId', 'mock-run')`);
};

/**
 * Runs one turn through Spark's dedicated OpenAI harness.
 *
 * The platform owns the Responses websocket, streaming aggregation, native
 * output parsing, and provider compaction. Spark persists the continuation
 * state and only executes correlated actions after the run completes.
 */
export function generateNativeSparkResponse(
  s: GeneralServerStatements,
  opts: {
    systemPrompt: Sql;
    messagesQuery: Sql;
    resultScalar: string;
    continuationStateScalar: string;
    providerCompactionStateScalar: string;
    actionsScalar: string;
    commentaryScalar: string;
    finalScalar: string;
    agentId: Sql;
    enableRenderUi: boolean;
    attachmentsQuery?: Sql;
    reasoningEffort?: Sql;
    serviceTier?: Sql;
    promptCacheKey?: Sql;
    maxOutputTokens?: Sql;
    timeoutMs?: Sql;
    /**
     * Dev/test-only stand-in for the `openai_responses_wait` call, used
     * instead of the real OpenAI Responses API. Must return the same
     * envelope a completed run's wait call would: `json_build_object(
     * 'status', 'completed', 'sequence', 1, 'result',
     * json_build_object('text', ..., 'toolCalls', '[]'::json))`.
     */
    mockProcedure?: EndpointStatementsOrFn;
  },
) {
  s.defTable("ai_generate_messages_input", {
    fields: [
      { name: "role", type: "String" },
      { name: "content", type: "String" },
      { name: "message_id", type: "BigInt" },
      { name: "cache_marker", type: "Bool" },
      { name: "continuation_state", type: "Json" },
      { name: "tool_outputs", type: "Json" },
    ],
    query: opts.messagesQuery,
  });
  s.defTable("ai_generate_attachments_input", {
    fields: [
      { name: "message_id", type: "BigInt" },
      { name: "mime_type", type: "String" },
      { name: "blob_hash", type: "String" },
    ],
    query: opts.attachmentsQuery ?? sql`
      select
        cast(null as bigint) as message_id,
        cast(null as string) as mime_type,
        cast(null as string) as blob_hash
      where false
    `,
  });

  s.defScalar(
    "ai_messages_json",
    sql`coalesce(
      (
        select json_array_agg(
          json_build_object(
            'role', case when m.role = 'assistant' then 'assistant' else 'user' end,
            'parts',
              case when m.role = 'user' and m.tool_outputs is not null then
                '[]'::json
              else json_build_array(
                case
                  when coalesce(m.cache_marker, false) then
                    json_build_object(
                      'type', 'text',
                      'text', coalesce(m.content, ''),
                      'cacheBoundary', true
                    )
                  else json_build_object(
                    'type', 'text',
                    'text', coalesce(m.content, '')
                  )
                end
              ) || coalesce(
                (
                  select json_array_agg(
                    json_build_object(
                      'type', 'file',
                      'source', json_build_object(
                        'kind', 'blob_hash',
                        'blobHash', attachment.blob_hash
                      ),
                      'mimeType', attachment.mime_type
                    )
                    order by attachment.blob_hash
                  )
                  from ai_generate_attachments_input attachment
                  where attachment.message_id = m.message_id
                    and attachment.blob_hash is not null
                    and attachment.mime_type like 'image/%'
                ),
                '[]'::json
              ) end,
            'continuationState', case
              when m.role = 'assistant' then m.continuation_state
              else null::json
            end,
            'toolOutputs', case
              when m.role = 'user' then m.tool_outputs
              else null::json
            end
          )
          order by m.message_id
        )
        from ai_generate_messages_input m
      ),
      '[]'::json
    )`,
  );
  s.defScalar("ai_selected_model", sparkAgentModelExpr(opts.agentId));

  const request = sql`json_build_object(
    'model', ai_selected_model,
    'tasks', json_build_array('agentic', 'general'),
    'system', ${opts.systemPrompt},
    'messages', ai_messages_json,
    'tools', case
      when ${
    opts.enableRenderUi ? sql`true` : sql`false`
  } then json_build_array(
        json_build_object(
          'type', 'custom',
          'name', 'exec',
          'description', 'Run JavaScript in a fresh V8 isolate without filesystem or network access. Application APIs are async functions under tools.*; tools.query(sql) returns { data: CSV }. Emit only compact model-visible results with text(value) or image(bytes). Text emitted by one exec call is limited to 40,000 characters before conversation storage.'
        ),
        json_build_object(
          'type', 'custom',
          'name', 'render_ui',
          'description', 'Render a complete raw Yolm TSX module after it passes compilation and capability-policy checks.'
        )
      )
      else json_build_array(
        json_build_object(
          'type', 'custom',
          'name', 'exec',
          'description', 'Run JavaScript in a fresh V8 isolate without filesystem or network access. Application APIs are async functions under tools.*; tools.query(sql) returns { data: CSV }. Emit only compact model-visible results with text(value) or image(bytes). Text emitted by one exec call is limited to 40,000 characters before conversation storage.'
        )
      )
    end,
    'reasoningEffort', ${
    agentReasoningEffortExpr(
      sql`ai_selected_model`,
      opts.reasoningEffort ?? sql.lit`medium`,
    )
  },
    'serviceTier', ${opts.serviceTier ?? sql.lit`auto`},
    'textVerbosity', 'low',
    'maxOutputTokens', coalesce(${
    opts.maxOutputTokens ?? sql`null::int`
  }, 64000),
    'compactThresholdTokens', 244800,
    'promptCacheKey', ${opts.promptCacheKey ?? sql`null::string`},
    'cacheMode', 'default',
    'timeoutMs', ${opts.timeoutMs ?? sql`null::bigint`}
  )`;

  s.defScalar("ai_generate_result_json", { type: "Json" });
  s.defScalar("ai_generate_error_json", { type: "Json" });
  s.defScalar("ai_spark_start_result_json", { type: "Json" });
  s.defScalar("ai_spark_start_error_json", { type: "Json" });
  s.defScalar(
    "ai_spark_run_id",
    sql`(
      select openai_run_id
      from db.spark_agents
      where id = ${opts.agentId}
    )`,
  );
  s.defScalar("ai_spark_sequence", sql`0::bigint`);
  s.defScalar("ai_spark_status", sql.lit`in_progress`);
  s.defScalar("ai_spark_wait_result_json", { type: "Json" });
  s.defScalar("ai_spark_wait_error_json", { type: "Json" });
  s.defScalar("ai_spark_wait_count", sql`0`);
  s.defScalar("ai_spark_restart_count", sql`0`);
  s.defScalar("ai_spark_yield_run", sql`false`);
  s.defScalar("ai_spark_started_run", sql`false`);

  s.while(
    sql`ai_generate_error_json is null
      and ai_spark_status = 'in_progress'
      and not ai_spark_yield_run`,
    (s) => {
      s.if(sql`ai_spark_run_id is null`, (s) => {
        s.setScalar("ai_spark_start_result_json", sql`null::json`);
        s.setScalar("ai_spark_start_error_json", sql`null::json`);
        s.serviceRequest({
          serviceType: sql.lit`ai`,
          operation: sql.lit`openai_responses_start`,
          usageContext: sql`json_build_object(
            'conversationId', (select spark_conversation_id::string from db.spark_agents where id = ${opts.agentId})
          )`,
          optIn: true,
          requestJson: sql`json_build_object(
            'apiVersion', 1,
            'sessionKey', coalesce(
              ${opts.promptCacheKey ?? sql`null::string`},
              'spark-agent:' || ${opts.agentId}::string
            ),
            'request', ${request}
          )`,
          setResultJsonScalar: "ai_spark_start_result_json",
          setErrorJsonScalar: "ai_spark_start_error_json",
          mockProcedure: opts.mockProcedure && nativeSparkMockStartProcedure,
        });
        s.if(sql`ai_spark_start_error_json is not null`, (s) => {
          s.setScalar("ai_generate_error_json", sql`ai_spark_start_error_json`);
          s.setScalar("ai_spark_status", sql.lit`failed`);
        }).else((s) => {
          s.setScalar(
            "ai_spark_run_id",
            sql`ai_spark_start_result_json->>'runId'`,
          );
          s.setScalar("ai_spark_sequence", sql`0::bigint`);
          s.setScalar("ai_spark_wait_count", sql`0`);
          s.setScalar("ai_spark_started_run", sql`true`);
        });
      });

      s.if(sql`ai_spark_started_run`, (s) => {
        s.startTransaction();
        s.modify(sql`
          update db.spark_agents
          set openai_run_id = ai_spark_run_id
          where id = ${opts.agentId}
        `);
        s.commitTransaction();
        s.setScalar("ai_spark_started_run", sql`false`);
      });

      s.while(
        sql`ai_generate_error_json is null
          and ai_spark_run_id is not null
          and ai_spark_status = 'in_progress'
          and ai_spark_wait_count < 60`,
        (s) => {
          s.setScalar("ai_spark_wait_count", sql`ai_spark_wait_count + 1`);
          s.setScalar("ai_spark_wait_result_json", sql`null::json`);
          s.setScalar("ai_spark_wait_error_json", sql`null::json`);
          s.serviceRequest({
            serviceType: sql.lit`ai`,
            operation: sql.lit`openai_responses_wait`,
            optIn: true,
            requestJson: sql`json_build_object(
              'apiVersion', 1,
              'runId', ai_spark_run_id,
              'afterSequence', ai_spark_sequence,
              'maxWaitMs', 2000
            )`,
            setResultJsonScalar: "ai_spark_wait_result_json",
            setErrorJsonScalar: "ai_spark_wait_error_json",
            mockProcedure: opts.mockProcedure,
          });
          s.if(
            sql`ai_spark_wait_error_json is not null
              and ai_spark_restart_count = 0
              and coalesce(ai_spark_wait_error_json->>'message', '') like '%run not found:%'`,
            (s) => {
              s.setScalar("ai_spark_restart_count", sql`1`);
              s.setScalar("ai_spark_run_id", sql`null::string`);
              s.setScalar("ai_spark_sequence", sql`0::bigint`);
              s.setScalar("ai_spark_wait_count", sql`0`);
              s.startTransaction();
              s.modify(sql`
                update db.spark_agents
                set openai_run_id = null
                where id = ${opts.agentId}
              `);
              s.commitTransaction();
            },
          ).elseIf(sql`ai_spark_wait_error_json is not null`, (s) => {
            s.setScalar(
              "ai_generate_error_json",
              sql`ai_spark_wait_error_json`,
            );
            s.setScalar("ai_spark_status", sql.lit`failed`);
          }).else((s) => {
            s.setScalar(
              "ai_spark_status",
              sql`coalesce(ai_spark_wait_result_json->>'status', 'failed')`,
            );
            s.if(
              sql`coalesce(
                try_cast(ai_spark_wait_result_json->>'sequence' as bigint),
                0
              ) > ai_spark_sequence`,
              (s) => {
                s.setScalar(
                  "ai_spark_sequence",
                  sql`try_cast(ai_spark_wait_result_json->>'sequence' as bigint)`,
                );
              },
            );
            s.if(sql`ai_spark_status = 'completed'`, (s) => {
              s.setScalar(
                "ai_generate_result_json",
                sql`ai_spark_wait_result_json->'result'`,
              );
            }).elseIf(sql`ai_spark_status = 'failed'`, (s) => {
              s.setScalar(
                "ai_generate_error_json",
                sql`coalesce(
                  ai_spark_wait_result_json->'error',
                  json_build_object(
                    'code', 'provider_unavailable',
                    'message', 'OpenAI Spark response failed'
                  )
                )`,
              );
            }).elseIf(sql`ai_spark_status = 'cancelled'`, (s) => {
              s.setScalar(
                "ai_generate_error_json",
                sql`json_build_object(
                  'code', 'cancelled',
                  'message', 'OpenAI Spark response was cancelled'
                )`,
              );
            });
          });

          s.if(
            sql`exists (
              select 1
              from db.spark_agents agent
              join db.spark_conversations conversation
                on conversation.id = agent.spark_conversation_id
              where agent.id = ${opts.agentId}
                and (conversation.is_paused or conversation.status <> 'active')
            )`,
            (s) => {
              s.setScalar("ai_spark_status", sql.lit`cancelled`);
              s.setScalar(
                "ai_generate_error_json",
                sql`json_build_object(
                  'code', 'cancelled',
                  'message', 'Spark agent was paused or cancelled'
                )`,
              );
            },
          );
        },
      );

      s.if(
        sql`ai_generate_error_json is null
          and ai_spark_run_id is not null
          and ai_spark_status = 'in_progress'
          and ai_spark_wait_count >= 60`,
        (s) => s.setScalar("ai_spark_yield_run", sql`true`),
      );
    },
  );

  s.if(sql`ai_spark_yield_run`, (s) => s.return());

  // A completed run remains attached to the agent until the caller commits
  // the resulting event and next agent status in the same transaction. That
  // makes a procedure crash resume the existing run instead of purchasing a
  // duplicate response.
  s.if(
    sql`ai_spark_run_id is not null and ai_spark_status <> 'completed'`,
    (s) => {
      s.serviceRequest({
        serviceType: sql.lit`ai`,
        operation: sql.lit`openai_responses_close`,
        optIn: true,
        requestJson: sql`json_build_object(
        'apiVersion', 1,
        'runId', ai_spark_run_id,
        'cancel', ai_spark_status <> 'completed'
      )`,
        defResultJsonScalar: "ai_spark_close_result_json",
        defErrorJsonScalar: "ai_spark_close_error_json",
        mockProcedure: opts.mockProcedure && nativeSparkMockCloseProcedure,
      });
      s.startTransaction();
      s.modify(sql`
      update db.spark_agents
      set openai_run_id = null
      where id = ${opts.agentId}
        and openai_run_id = ai_spark_run_id
    `);
      s.commitTransaction();
    },
  );

  s.if(
    sql`ai_generate_error_json is null
      and ai_generate_result_json is not null
      and ai_generate_result_json->'toolCalls' is null`,
    (s) => {
      s.setScalar(
        "ai_generate_error_json",
        sql`json_build_object(
          'code', 'invalid_openai_responses_response',
          'message', 'OpenAI Responses result is missing toolCalls'
        )`,
      );
    },
  );

  s.setScalar(
    opts.continuationStateScalar,
    sql`case
      when coalesce(
        ai_generate_result_json->'resolution'->'contextManagement'->>'compacted',
        'false'
      ) = 'true' then null::json
      else ai_generate_result_json->'continuationState'
    end`,
  );
  s.setScalar(
    opts.providerCompactionStateScalar,
    sql`case
      when coalesce(
        ai_generate_result_json->'resolution'->'contextManagement'->>'compacted',
        'false'
      ) = 'true' then ai_generate_result_json->'continuationState'
      else null::json
    end`,
  );
  s.setScalar(opts.actionsScalar, sql`ai_generate_result_json->'toolCalls'`);
  s.setScalar(
    opts.commentaryScalar,
    sql`coalesce(
      ai_generate_result_json->>'commentary',
      ai_spark_wait_result_json->>'commentary',
      ''
    )`,
  );
  s.setScalar(
    opts.finalScalar,
    sql`coalesce(
      ai_generate_result_json->>'final',
      ai_generate_result_json->>'text',
      ai_spark_wait_result_json->>'final',
      ''
    )`,
  );

  s.defScalar("llm_raw_script", sql.lit``);
  s.if(sql`ai_generate_error_json is not null`, (s) => {
    s.defScalar(
      "err_http_status",
      sql`coalesce(
        try_cast(ai_generate_error_json->'details'->>'status' as int),
        0
      )`,
    );
    s.defScalar(
      "err_retry_after_seconds",
      sql`try_cast(
        ai_generate_error_json->'details'->>'retry_after_seconds' as int
      )`,
    );
    s.modify(sql`
      insert into llm_result (
        success, http_status, error_message, is_rate_limit,
        retry_after_seconds, retryable
      ) values (
        false,
        err_http_status,
        coalesce(
          ai_generate_error_json->>'message',
          ai_generate_error_json->>'code',
          'AI generation failed'
        ),
        err_http_status = 429
          or coalesce(ai_generate_error_json->>'code', '') = 'rate_limit',
        err_retry_after_seconds,
        try_cast(ai_generate_error_json->>'retryable' as bool)
      )
    `);
  }).else((s) => {
    s.setScalar(
      "llm_raw_script",
      sql`coalesce(ai_generate_result_json->>'text', '')`,
    );
    s.modify(sql`
      insert into llm_result (
        success, http_status, error_message, is_rate_limit,
        retry_after_seconds, retryable
      ) values (
        true,
        200,
        null::string,
        false,
        null::int, null::bool
      )
    `);
  });

  s.setScalar(opts.resultScalar, sql`llm_raw_script`);
}
