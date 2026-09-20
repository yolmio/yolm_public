import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type {
  EndpointStatementsOrFn,
  GeneralServerStatements,
} from "std/statements";
import { system } from "std/system";

const CONVERSATION_TITLE_SYSTEM_PROMPT = sql.lit(
  `Generate a concise 3-to-6-word noun phrase that names this conversation.
Use the user's language. Capture the concrete task or subject, not the requested
action. Return only the title text with no quotes, prefix, markdown, or ending
punctuation.`,
);

const TITLE_PREFIX_PATTERN = "(?i)^title\\s*:\\s*";
const TITLE_WRAPPER_PATTERN = '^[#*`" ]+|[#*`" ]+$';

export function generateSparkConversationTitle(
  s: GeneralServerStatements,
  opts: {
    conversationId: Sql;
    firstMessageContent: Sql;
    attachmentNames: Sql;
    mockProcedure?: EndpointStatementsOrFn;
  },
) {
  s.if(
    sql`nullif(trim(coalesce(${opts.firstMessageContent}, '')), '') is null
      and nullif(trim(coalesce(${opts.attachmentNames}, '')), '') is null`,
    (s) => s.return(),
  );
  s.defScalar(
    "auto_title_message_content",
    sql`coalesce(${opts.firstMessageContent}, '')`,
  );
  s.defScalar(
    "auto_title_attachment_names",
    sql`coalesce(${opts.attachmentNames}, '')`,
  );
  s.defScalar(
    "auto_title_fallback",
    sql`left(coalesce(
      nullif(trim(regex.replace_all(
        auto_title_message_content,
        '\\s+',
        ' '
      )), ''),
      nullif(auto_title_attachment_names, ''),
      'New conversation'
    ), 80)`,
  );
  s.defScalar(
    "auto_title_input",
    sql`'User request:' || chr(10) ||
      left(auto_title_message_content, 3500) ||
      case
        when auto_title_attachment_names = '' then ''
        else chr(10) || chr(10) || 'Attachments: ' ||
          left(auto_title_attachment_names, 400)
      end`,
  );

  s.aiGenerate({
    intent: {
      task: "summarization",
      priority: "cost",
      noMatchPolicy: "best_effort",
      forceProvider: sql.lit`openai`,
      forceModel: sql.lit`gpt-5.6-luna`,
    },
    system: CONVERSATION_TITLE_SYSTEM_PROMPT,
    messages: sql`json_build_array(json_build_object(
      'role', 'user',
      'parts', json_build_array(json_build_object(
        'type', 'text',
        'text', auto_title_input
      ))
    ))`,
    cacheMode: "off",
    generation: sql`json_build_object('maxOutputTokens', 512)`,
    timeoutMs: 30000,
    usageContext: sql`json_build_object(
      'conversationId', ${opts.conversationId}::string
    )`,
    resultJsonScalar: "auto_title_result_json",
    errorJsonScalar: "auto_title_error_json",
    optIn: true,
    mockProcedure: opts.mockProcedure,
  });

  s.defScalar(
    "auto_title_first_line",
    sql`trim(split_part(
      coalesce(auto_title_result_json->>'text', ''),
      chr(10),
      1
    ))`,
  );
  s.defScalar(
    "auto_title_clean",
    sql`left(trim(regex.replace_all(
      regex.replace_all(
        auto_title_first_line,
        ${sql.lit(TITLE_PREFIX_PATTERN)},
        ''
      ),
      ${sql.lit(TITLE_WRAPPER_PATTERN)},
      ''
    )), 80)`,
  );
  s.defScalar(
    "auto_title_usable",
    sql`auto_title_error_json is null
      and auto_title_clean != ''
      and lower(coalesce(auto_title_result_json->>'finishReason', ''))
        not in ('length', 'max_tokens')
      and lower(auto_title_clean) not in (
        'new chat',
        'new conversation',
        'unspecified user request',
        'user request',
        'user request details',
        'untitled'
      )
      and position('{' in auto_title_clean) = 0
      and position('}' in auto_title_clean) = 0`,
  );

  s.startTransaction();
  s.modify(sql`
    update db.spark_conversations
    set
      label = case
        when auto_title_usable then auto_title_clean
        else auto_title_fallback
      end,
      auto_title_pending = false
    where id = ${opts.conversationId}
      and auto_title_pending = true
  `);
  s.commitTransaction();
}

export function registerSparkTitleReactor() {
  system.addReactor({
    name: "spark_generate_conversation_title",
    query: sql`
      select
        c.id,
        left(coalesce(first_message.message_content, ''), 3500)
          as first_message_content,
        left(coalesce((
          select string_agg(attachment.name, ', ' order by attachment.id)
          from db.spark_attachments attachment
          where attachment.spark_event_id = first_message.id
        ), ''), 400) as attachment_names
      from db.spark_conversations c
      join (
        select
          agent.spark_conversation_id,
          event.id,
          event.content as message_content,
          row_number() over (
            partition by agent.spark_conversation_id
            order by event.created_at, event.id
          ) as message_number
        from db.spark_agent_events event
        join db.spark_agents agent on agent.id = event.spark_agent_id
        where event.type = 'user_message'
      ) first_message on first_message.spark_conversation_id = c.id
        and first_message.message_number = 1
      where c.auto_title_pending = true
        and (
          nullif(trim(coalesce(first_message.message_content, '')), '')
            is not null
          or exists (
            select 1
            from db.spark_attachments attachment
            where attachment.spark_event_id = first_message.id
          )
        )
    `,
    recordName: "title_conversation",
    procedure: (s) => {
      generateSparkConversationTitle(s, {
        conversationId: sql`title_conversation.id`,
        firstMessageContent: sql`title_conversation.first_message_content`,
        attachmentNames: sql`title_conversation.attachment_names`,
      });
    },
  });
}
