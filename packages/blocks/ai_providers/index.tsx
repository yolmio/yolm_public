import { type Block, system } from "std/system";
import { Card } from "components/card";
import { MaterialIcon } from "components/material_icon";
import { Each, Route, Show } from "std/ui";
import { type NumericExpr, type Sql, sql } from "std/sql_utils";
import { Form } from "std/form";
import { Data } from "std/data";
import { Button } from "components/button";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import type {
  DomStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import { anthropicGenerateText, anthropicUploadFile } from "services/anthropic";
import { geminiGenerateText, geminiUploadFile } from "services/gemini";
import { openAIGenerateText } from "services/open_ai";

type AiProviderType =
  | "open_ai_compatible"
  | "anthropic_compatible"
  | "gemini_compatible";

export type AiProvider = {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextLength: number;
  providerType: AiProviderType;
  headers?: AiProviderHeader[];
};

export type AiProviderHeader = {
  headerKey: string;
  headerValue: string;
};
interface AiProviderOpts {
  name: AiProviderType;
  displayName: string;
}

interface AiProviderBlock extends Block {
  providers: AiProvider[];
}
export const aiProviderTypes: AiProviderOpts[] = [{
  name: "open_ai_compatible",
  displayName: "OpenAI compatible ai provider",
}, {
  name: "anthropic_compatible",
  displayName: "Anthropic compatible ai provider",
}, { name: "gemini_compatible", displayName: "Gemini compatible ai provider" }];

interface AiProviderInsertAttachmentOpts {
  providerType: Sql;
  model: Sql;
  attachmentsQuery: Sql;
  beforeSubmitClient?: (s: DomStatements) => void;
  onUploadSuccessServer?: (s: UiServerStatements, file: Sql) => void;
  onUploadErrorClient?: (s: DomStatements) => void;
}
export class AiProvidersBlock implements AiProviderBlock {
  blockName = "AiProvidersBlock";
  blockDisplayName = "AI Providers";
  externalServiceOptions = [
    { optionKey: "generate_text", optionLabel: "Generate text via AI APIs" },
    { optionKey: "upload_files", optionLabel: "Upload files to AI providers" },
  ];
  componentDependencies: string[] = [];
  description: string | undefined;
  providers: AiProvider[];
  constructor(opts: {
    providers?: AiProvider[];
  } = {}) {
    this.providers = opts.providers ?? [];
  }
  initialize() {
    system.enum_({
      name: "ai_provider_type",
      values: aiProviderTypes,
    });
    // const ENCRYPTION_KEY = "ai_provider_encryption_key";
    system.db.table("ai_providers", (table) => {
      table.string("provider_name", 100).notNull().unique();
      table.string("base_url", 500).notNull(); // e.g., https://api.openai.com/v1, https://api.groq.com/openai/v1
      // TODO: add encryption for api key crypto is not working correctly
      table.text("api_key", 10000).notNull();
      table.enum("provider_type", "ai_provider_type").notNull();
      table.recordDisplayName(["provider_name"]);
    });

    system.db.table("ai_models", (table) => {
      table.fk("ai_providers").notNull();
      table.string("model_name", 200).notNull();
      table.int("context_length").notNull();
      table.bool("vision_support").notNull().default(false);
      // Pricing per million tokens (in USD)
      table.decimal("input_cost_per_million", { precision: 10, scale: 6 })
        .notNull().default(0);
      table.decimal("output_cost_per_million", { precision: 10, scale: 6 })
        .notNull().default(0);
      table.decimal("cache_read_cost_per_million", { precision: 10, scale: 6 })
        .notNull().default(0);
      table.decimal("cache_write_cost_per_million", { precision: 10, scale: 6 })
        .notNull().default(0);
      table.unique(["ai_provider_id", "model_name"]);
      table.recordDisplayName(["model_name"]);
    });

    // Extra headers for AI providers (key-value pairs)
    system.db.table("ai_provider_headers", (table) => {
      table.fk("ai_providers").notNull();
      table.string("header_key", 200).notNull();
      table.string("header_value", 200).notNull();
    });
  }
  generateText<T extends IServerBaseStatements>(
    s: T,
    props: AiProviderGenerateTextOpts,
  ) {
    generateText(s, props);
  }
  insertAttachment<T extends DomStatements>(
    s: T,
    props: AiProviderInsertAttachmentOpts,
  ) {
    insertAttachment(s, props);
  }
  static ConfigureAiProvidersPage = (
    props: { path?: string; withoutRoute?: boolean },
  ) => {
    if (props.withoutRoute) {
      return <AiProvidersInner />;
    }
    return (
      <Route path={props.path ?? "/ai-providers"}>
        <AiProvidersInner />
      </Route>
    );
  };
}

function AiProvidersInner() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("show_add_form", sql`false`);
        s.defScalar("refresh_key", 0);
      }}
    >
      <div className="container mx-auto max-w-6xl p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">AI Providers</h1>
          <p className="text-gray-600">
            Configure API endpoints for AI providers like OpenAI, Anthropic,
            Gemini, and more
          </p>
        </div>

        <Card className="mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Add New Provider</h2>
              <Button
                variant="outlined"
                size="sm"
                onClick={(s) =>
                  s.setScalar("show_add_form", sql`not show_add_form`)}
              >
                <Show when={sql`show_add_form`}>
                  <MaterialIcon icon="Close" />
                  Cancel
                </Show>
                <Show when={sql`not show_add_form`}>
                  <MaterialIcon icon="Add" />
                  Add Provider
                </Show>
              </Button>
            </div>

            <Show when={sql`show_add_form`}>
              <Form
                defaultFieldComponent={LabelOnTopFormField}
                afterSubmitClientSuccess={(s) => {
                  s.increment("refresh_key");
                  s.setScalar("show_add_form", sql`false`);
                }}
              >
                <Form.Insert table="ai_providers">
                  <div className="space-y-4">
                    <Form.Field field="provider_type" />
                    <Form.Field field="provider_name" />
                    <Form.Field field="base_url" />
                    <Form.Field field="api_key" />

                    <div className="border-t pt-4 mt-4">
                      <h3 className="text-sm font-medium mb-3">Models</h3>
                      <Form.Relation
                        table="ai_models"
                        dontInitialize
                      >
                        <div className="space-y-2">
                          <Form.Each
                            fallback={
                              <p className="text-xs text-gray-500 italic">
                                No models added yet. Click "Add Model" to add
                                models.
                              </p>
                            }
                          >
                            <div className="flex items-center gap-2">
                              <Form.Field field="model_name" />
                              <Form.Field field="context_length" />
                              <Form.Field field="vision_support" />
                              <Form.DeleteRecordIconButton
                                size="sm"
                                variant="plain"
                                icon="Close"
                              />
                            </div>
                          </Form.Each>

                          <Form.AddCurrentTableButton
                            size="sm"
                            variant="outlined"
                            startIcon="Add"
                          >
                            Add Model
                          </Form.AddCurrentTableButton>
                        </div>
                      </Form.Relation>
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <h3 className="text-sm font-medium mb-3">
                        Custom Headers (Optional)
                      </h3>
                      <Form.Relation
                        table="ai_provider_headers"
                        dontInitialize
                      >
                        <div className="space-y-2">
                          <Form.Each
                            fallback={
                              <p className="text-xs text-gray-500 italic">
                                No headers added yet. Click "Add Header" to add
                                custom headers.
                              </p>
                            }
                          >
                            <div className="flex items-center gap-2">
                              <Form.Field field="header_key" />
                              <Form.Field field="header_value" />
                              <Form.DeleteRecordIconButton
                                size="sm"
                                variant="plain"
                                icon="Close"
                              />
                            </div>
                          </Form.Each>

                          <Form.AddCurrentTableButton
                            size="sm"
                            variant="outlined"
                            startIcon="Add"
                          >
                            Add Header
                          </Form.AddCurrentTableButton>
                        </div>
                      </Form.Relation>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Form.SubmitButton>Save Provider</Form.SubmitButton>
                      <Button
                        variant="outlined"
                        onClick={(s) =>
                          s.setScalar("show_add_form", sql`false`)}
                      >
                        Cancel
                      </Button>
                    </div>

                    <Form.ErrorAlert />
                  </div>
                </Form.Insert>
              </Form>
            </Show>
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Configured Providers</h2>

            <Data
              watch={[sql`refresh_key`]}
              procedure={(s) => {
                s.defTable(
                  "providers",
                  sql`select * from db.ai_providers`,
                );
                s.defTable(
                  "provider_models",
                  sql`select * from db.ai_models`,
                );
                s.defTable(
                  "provider_headers",
                  sql`select * from db.ai_provider_headers`,
                );
              }}
            >
              <Show
                when={sql`(select count(*) from providers) = 0`}
              >
                <div className="text-center py-8 text-gray-500">
                  <MaterialIcon icon="CloudOff" className="mb-2" />
                  <p>No providers configured yet</p>
                  <p className="text-sm mt-1">
                    Click "Add Provider" to get started
                  </p>
                </div>
              </Show>
              <div className="space-y-3">
                <Each table="providers" recordName="provider">
                  <Card variant="outlined" className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-lg">
                            {sql`provider.provider_name`}
                          </h3>
                        </div>
                        <div className="flex items-start gap-2 mb-2">
                          <span className="font-medium">Provider Type:</span>
                          <code className="text-xs px-2 py-1 rounded">
                            {sql`fn.display_ai_provider_type(provider.provider_type)`}
                          </code>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-start gap-2">
                            <span className="font-medium">URL:</span>
                            <code className="text-xs px-2 py-1 rounded">
                              {sql`provider.base_url`}
                            </code>
                          </div>

                          <div className="flex items-start gap-2">
                            <span className="font-medium">API Key:</span>
                            <code className="text-xs px-2 py-1 rounded">
                              ••••••••
                            </code>
                          </div>

                          <div className="flex items-start gap-2">
                            <span className="font-medium">Models:</span>
                            <div className="space-y-1">
                              <Show
                                when={sql`(select count(*) from provider_models where ai_provider_id = provider.id) = 0`}
                              >
                                <span className="text-xs text-gray-500 italic">
                                  No models configured
                                </span>
                              </Show>
                              <Each
                                table="provider_models"
                                recordName="model"
                                where={sql`model.ai_provider_id = provider.id`}
                              >
                                <code className="text-xs px-2 py-1 rounded block">
                                  {sql`model.model_name`} (context:{" "}
                                  {sql`model.context_length`})
                                </code>
                              </Each>
                            </div>
                          </div>

                          <Each
                            table="provider_headers"
                            recordName="header"
                            where={sql`header.ai_provider_id = provider.id`}
                          >
                            <div className="flex items-start gap-2">
                              <span className="font-medium">Header:</span>
                              <code className="text-xs px-2 py-1 rounded">
                                {sql`header.header_key`}:{" "}
                                {sql`header.header_value`}
                              </code>
                            </div>
                          </Each>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        <DeleteRecordIconButton
                          table="ai_providers"
                          recordId={sql`provider.id`}
                          variant="plain"
                          color="primary"
                          size="sm"
                          afterSubmitClient={(s) => s.increment("refresh_key")}
                        />
                      </div>
                    </div>

                    <div className="mt-4 pt-4">
                      <EditProvider providerId={sql`provider.id`} />
                    </div>
                  </Card>
                </Each>
              </div>
            </Data>
          </div>
        </Card>
      </div>
    </Data>
  );
}

function EditProvider({ providerId }: { providerId: NumericExpr }) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("edit_mode", sql`false`);
      }}
    >
      <div className="space-y-4">
        <Show when={sql`not edit_mode`}>
          <div className="flex items-center justify-between">
            <TestConnection providerId={providerId} />
            <Button
              size="sm"
              variant="outlined"
              onClick={(s) => s.setScalar("edit_mode", sql`true`)}
            >
              <MaterialIcon icon="Edit" fontSize="sm" />
              Edit Configuration
            </Button>
          </div>
        </Show>

        <Show when={sql`edit_mode`}>
          <Form
            defaultFieldComponent={LabelOnTopFormField}
            afterSubmitClientSuccess={(s) => {
              s.setScalar("edit_mode", sql`false`);
              s.increment("refresh_key");
            }}
          >
            <Form.Update
              table="ai_providers"
              where={sql`id = ${providerId}`}
            >
              <div className="space-y-4 p-4 rounded">
                <h4 className="font-medium">Edit Provider Configuration</h4>
                <Form.Field field="provider_type" />
                <Form.Field field="provider_name" />
                <Form.Field field="base_url" />
                <div className="border-t pt-4">
                  <h5 className="text-sm font-medium mb-3">Models</h5>
                  <Form.Relation
                    field="ai_provider_id"
                    table="ai_models"
                  >
                    <div className="space-y-2">
                      <Form.Each
                        recordName="model"
                        fallback={
                          <p className="text-xs text-gray-500 italic">
                            No models configured
                          </p>
                        }
                      >
                        <div className="flex items-center gap-2">
                          <Form.Field field="model_name" />
                          <Form.Field field="context_length" />
                          <Form.Field field="vision_support" />
                          <Form.DeleteRecordIconButton
                            size="sm"
                            variant="plain"
                            icon="Close"
                          />
                        </div>
                      </Form.Each>

                      <Form.AddCurrentTableButton
                        size="sm"
                        variant="outlined"
                        startIcon="Add"
                      >
                        Add Model
                      </Form.AddCurrentTableButton>
                    </div>
                  </Form.Relation>
                </div>
                <div className="border-t pt-4">
                  <h5 className="text-sm font-medium mb-3">Custom Headers</h5>
                  <Form.Relation
                    field="ai_provider_id"
                    table="ai_provider_headers"
                  >
                    <div className="space-y-2">
                      <Form.Each
                        recordName="header"
                        fallback={
                          <p className="text-xs text-gray-500 italic">
                            No custom headers configured
                          </p>
                        }
                      >
                        <div className="flex items-center gap-2">
                          <Form.Field field="header_key" />
                          <Form.Field field="header_value" />
                          <Form.DeleteRecordIconButton
                            size="sm"
                            variant="plain"
                            icon="Close"
                          />
                        </div>
                      </Form.Each>

                      <Form.AddCurrentTableButton
                        size="sm"
                        variant="outlined"
                        startIcon="Add"
                      >
                        Add Header
                      </Form.AddCurrentTableButton>
                    </div>
                  </Form.Relation>
                </div>

                <div className="flex gap-2 pt-2">
                  <Form.SubmitButton size="sm">Save Changes</Form.SubmitButton>
                  <Button
                    size="sm"
                    variant="outlined"
                    onClick={(s) => s.setScalar("edit_mode", sql`false`)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Form.Update>
          </Form>
        </Show>
      </div>
    </Data>
  );
}

function TestConnection({ providerId }: { providerId: NumericExpr }) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("test_loading", {
          type: "Bool",
          expr: sql`false`,
        });
        s.defScalar("test_result", {
          type: "String",
          expr: sql.lit``,
        });
        s.defScalar("test_success", { type: "Bool" });
      }}
    >
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outlined"
          onClick={(s) => {
            s.returnIf(sql`test_loading`);
            s.setScalar("test_loading", true);
            s.commitUiTreeChanges();
            s.setScalar("test_result", sql.lit``);
            s.defTable("ai_provider_generate_text_messages_temp", {
              fields: [
                { name: "role", type: "String" },
                { name: "content", type: "String" },
                { name: "message_id", type: "BigInt" },
                { name: "cache_marker", type: "Bool" },
                { name: "files", type: "Json" },
              ],
            });
            s.defRecord("llm_result", {
              fields: [
                { name: "success", type: "Bool" },
                { name: "http_status", type: "Int" },
                { name: "error_message", type: "String" },
                { name: "is_rate_limit", type: "Bool" },
                { name: "content", type: "String" },
                { name: "input_tokens", type: "Int" },
                { name: "output_tokens", type: "Int" },
                { name: "cache_read_tokens", type: "Int" },
                { name: "cache_write_tokens", type: "Int" },
                {
                  name: "total_cost",
                  type: {
                    type: "Decimal",
                    precision: 10,
                    scale: 6,
                    signed: true,
                  },
                },
              ],
              allowNoRead: true,
            });
            s.modify(
              sql`insert into ai_provider_generate_text_messages_temp (role, content, message_id, cache_marker, files) values ('user', 'testing if the connection is working', 1, false, null), ('model', 'this is a test', 2, false, null)`,
            );
            s.tryServer({
              body: (s) => {
                const aiProvidersBlock = useAiProvidersBlock();
                s.debugExpr(
                  sql`(select model_name from ai_models where ai_provider_id = ${providerId} )`,
                );
                aiProvidersBlock.generateText(s, {
                  providerType:
                    sql`(select provider_type from ai_providers where id = ${providerId})`,
                  model:
                    sql`(select model_name from ai_models where ai_provider_id = ${providerId} )`,
                  messagesQuery:
                    sql`select * from ai_provider_generate_text_messages_temp`,
                  resultScalar: "test_reult1",
                  baseUrl:
                    sql`(select base_url from ai_providers where id = ${providerId})`,
                  apiKey:
                    sql`(select api_key from ai_providers where id = ${providerId})`,
                });
                s.defRecord(
                  "provider_data",
                  sql`
                  select provider_name, base_url, model_name
                  from ai_providers join ai_models on ai_providers.id = ai_models.ai_provider_id
                  where ai_providers.id = ${providerId}
                `,
                );
                s.setScalar(
                  "test_result",
                  sql`
                  case
                    when test_reult1 is not null and test_reult1 != '' then
                      'Connection test for ' || provider_data.provider_name || ': ' || test_reult1
                    else
                      'Connection test for ' || provider_data.provider_name || ' - Ready to implement API call'
                  end
                `,
                );
                s.setScalar("test_success", true);
                s.setScalar("test_loading", false);
              },
              catch: (s) => {
                s.setScalar("test_result", sql`'Connection failed'`);
                s.setScalar("test_success", false);
                s.setScalar("test_loading", false);
              },
              finally: (s) => {
                s.setScalar("test_loading", false);
              },
            });
          }}
          loading={sql`test_loading`}
          startIcon="Speed"
        >
          Test Connection
        </Button>

        <Show when={sql`test_result is not null`}>
          <div className="flex items-center gap-2 text-sm">
            <Show when={sql`test_success`}>
              <MaterialIcon
                icon="CheckCircle"
                className="text-green-600"
                fontSize="sm"
              />
              <span className="text-green-700">{sql`test_result`}</span>
            </Show>
            <Show when={sql`not test_success and not test_result = ''`}>
              <MaterialIcon
                icon="Error"
                className="text-red-600"
                fontSize="sm"
              />
              <span className="text-red-700">{sql`test_result`}</span>
            </Show>
          </div>
        </Show>
      </div>
    </Data>
  );
}

interface AiProviderGenerateTextOpts {
  providerType: Sql;
  model: Sql;
  /**
   * Query for messages. Should return columns:
   * - role: 'user' | 'assistant' | 'model' | 'system'
   * - content: text content of the message
   * - message_id: BigInt for ordering
   * - cache_marker: Bool (optional, for Anthropic caching)
   * - files: JSON (optional) - Array of file objects: [{file_uri: string, mime_type: string}, ...]
   *
   * Files are included as parts within the same message entry.
   * Example files value: '[{"file_uri": "files/abc123", "mime_type": "application/pdf"}]'
   */
  messagesQuery: Sql;
  resultScalar: string;
  /** Record name for structured result: {success, http_status, error_message, is_rate_limit, content, tokens, cost} */
  resultRecord?: string;
  baseUrl?: Sql;
  apiKey: Sql;
  systemInstruction?: Sql;
  headers?: AiProviderHeader[];
  attachmentsQuery?: Sql; // Optional query for message attachments (base64 images)
  headersQuery?: Sql; // Optional query for headers
  /**
   * Enable prompt caching (Anthropic only).
   * When true, system instruction is cached and conversation prefix benefits from caching.
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
function generateText<T extends IServerBaseStatements>(
  s: T,
  props: AiProviderGenerateTextOpts,
) {
  const resultRecord = props.resultRecord ?? "llm_result";

  // Define table to hold messages with support for attachments and cache markers
  // Messages can have multiple file attachments via the 'files' JSON array field
  // Files are included as parts within the same message (not as separate messages)
  s.defTable("ai_provider_generate_text_messages", {
    fields: [
      { name: "role", type: "String" },
      { name: "content", type: "String" },
      { name: "message_id", type: "BigInt" },
      { name: "cache_marker", type: "Bool" }, // For Anthropic prompt caching
      { name: "files", type: "Json" }, // JSON array: [{file_uri: string, mime_type: string}, ...]
    ],
    query: props.messagesQuery,
  });
  if (props.headersQuery) {
    s.defTable("ai_provider_headers", {
      fields: [
        { name: "header_key", type: "String" },
        { name: "header_value", type: "String" },
        { name: "ai_provider_id", type: "BigInt" },
      ],
      query: props.headersQuery,
    });
  }
  // Define table for attachments (images) - only if attachmentsQuery is provided
  if (props.attachmentsQuery) {
    s.defTable("ai_provider_message_attachments", {
      fields: [
        { name: "message_id", type: "BigInt" },
        { name: "mime_type", type: "String" },
        { name: "content", type: "String" }, // Base64 encoded or text content
      ],
      query: props.attachmentsQuery,
    });
  }
  s.defScalar(props.resultScalar, { type: "String" });

  // The underlying AI services set llm_result record with structured error info
  // No try/catch needed - caller checks llm_result.success
  s.block((s) => {
    s.if(sql`${props.providerType} = 'open_ai_compatible'`, (s) => {
      if (props.systemInstruction) {
        s.modify(
          sql`insert into ai_provider_generate_text_messages (role, content, message_id) values ('system', ${props.systemInstruction}, 0)`,
        );
      }
      // OpenAI format: supports content as string or array of content parts
      let openaiMessages: Sql;
      if (props.attachmentsQuery) {
        openaiMessages = sql`(
            select json_array_agg(
              case
                when exists(select 1 from ai_provider_message_attachments where message_id = msgs.message_id) then
                  json_build_object(
                    'role',
                    case when role = 'user' then 'user'
                         when role = 'system' then 'system'
                         else 'assistant' end,
                    'content', (
                      select json_array_agg(part_value)
                      from (
                        select json_build_object('type', 'text', 'text', msgs.content) as part_value
                        union all
                        select json_build_object(
                          'type', 'image_url',
                          'image_url', json_build_object(
                            'url', 'data:' || mime_type || ';base64,' || content
                          )
                        ) as part_value
                        from ai_provider_message_attachments
                        where message_id = msgs.message_id
                      ) as parts
                    )
                  )
                else
                  json_build_object(
                    'role',
                    case when role = 'user' then 'user'
                         when role = 'system' then 'system'
                         else 'assistant' end,
                    'content', msgs.content
                  )
              end
            order by msgs.message_id) from ai_provider_generate_text_messages as msgs
          )`;
      } else {
        openaiMessages = sql`(
            select json_array_agg(
              json_build_object(
                'role',
                case when role = 'user' then 'user'
                     when role = 'system' then 'system'
                     else 'assistant' end,
                'content', content
              )
            order by message_id) from ai_provider_generate_text_messages
          )`;
      }
      // s.debugExpr(openaiMessages);
      openAIGenerateText(s, {
        contents: openaiMessages,
        model: props.model,
        resultScalar: props.resultScalar,
        // this needs to be populated from the model info
        baseUrl: props.baseUrl ??
          sql.lit`https://api.openai.com/v1/chat/completions`,
        apiKey: props.apiKey,
        ownResultScalar: true,
        pricing: props.pricing,
        resultRecord: resultRecord,
      });
    });

    // Anthropic compatible
    s.if(sql`${props.providerType} = 'anthropic_compatible'`, (s) => {
      // Anthropic format: content is always an array of content blocks
      // For caching: when cache_marker is true, add cache_control to the last content block
      // Files (via file_uri) are included as document parts within the same message

      let anthropicMessages: Sql;
      if (props.attachmentsQuery) {
        anthropicMessages = sql`(
            select json_array_agg(
              json_build_object(
                'role',
                case when role = 'user' then 'user' else 'assistant' end,
                'content', (
                  select json_array_agg(content_block)
                  from (
                    select json_build_object('type', 'text', 'text', msgs.content) as content_block
                    union all
                    select json_build_object(
                      'type', 'image',
                      'source', json_build_object(
                        'type', 'base64',
                        'media_type', 'image/webp',
                        'data', content
                      )
                    ) as content_block
                    from ai_provider_message_attachments
                    where message_id = msgs.message_id
                  ) as blocks
                )
              )
            order by msgs.message_id) from ai_provider_generate_text_messages as msgs
            where role != 'system'
          )`;
      } else {
        // Build messages with file attachments and cache_control support
        // 'files' is a JSON array: [{file_uri: string, mime_type: string}, ...]
        // When cache_marker is true, add cache_control to the text block
        //
        // Build file_doc_parts imperatively since LATERAL joins aren't supported in tableDef

        s.defTable("anthropic_msg_files", {
          fields: [
            { name: "message_id", type: "BigInt" },
            { name: "file_doc_parts", type: "Json" },
          ],
        });

        s.forEachTable("ai_provider_generate_text_messages", "msg", (s) => {
          s.if(
            sql`msg.files is not null and json_array_length(msg.files) > 0`,
            (s) => {
              s.defScalar("file_doc_parts", sql`'[]'::json`);
              s.forEachQuery(
                sql`select value from json.array_each(msg.files)`,
                "f",
                (s) => {
                  s.setScalar(
                    "file_doc_parts",
                    sql`file_doc_parts || json_build_array(json_build_object(
                  'type', 'document',
                  'source', json_build_object('type', 'file', 'file_id', f.value->>'file_uri')
                ))`,
                  );
                },
              );
              s.modify(
                sql`insert into anthropic_msg_files (message_id, file_doc_parts) values (msg.message_id, file_doc_parts)`,
              );
            },
          );
        });

        anthropicMessages = sql`(
            select json_array_agg(
              json_build_object(
                'role',
                case when m.role = 'user' then 'user' else 'assistant' end,
                'content',
                case
                  when amf.file_doc_parts is not null then
                    amf.file_doc_parts || json_build_array(
                      case
                        when coalesce(m.cache_marker, false) = true then
                          json_build_object('type', 'text', 'text', m.content, 'cache_control', json_build_object('type', 'ephemeral'))
                        else
                          json_build_object('type', 'text', 'text', m.content)
                      end
                    )
                  when coalesce(m.cache_marker, false) = true then
                    json_build_array(json_build_object('type', 'text', 'text', m.content, 'cache_control', json_build_object('type', 'ephemeral')))
                  else
                    json_build_array(json_build_object('type', 'text', 'text', m.content))
                end
              )
            order by m.message_id)
            from ai_provider_generate_text_messages m
            left join anthropic_msg_files amf on amf.message_id = m.message_id
          )`;
      }

      // s.debugQuery(anthropicMessages);
      // s.debugExpr(props.systemInstruction ?? sql.lit``);
      anthropicGenerateText(s, {
        contents: anthropicMessages,
        model: props.model,
        resultScalar: props.resultScalar,
        systemInstruction: props.systemInstruction,
        // this needs to be populated from the model info
        baseUrl: props.baseUrl ??
          sql.lit`https://api.anthropic.com/v1/messages`,
        apiKey: props.apiKey,
        ownResultScalar: true,
        enableCaching: props.enableCaching,
        pricing: props.pricing,
        resultRecord: resultRecord,
      });
    });

    // Gemini compatible
    s.if(sql`${props.providerType} = 'gemini_compatible'`, (s) => {
      // Gemini format: parts array with text and inline_data/file_data
      // Files (via file_uri) are included as file_data parts within the same message

      let geminiMessages: Sql;
      if (props.attachmentsQuery) {
        geminiMessages = sql`(
            select json_array_agg(
              json_build_object(
                'role',
                case when role = 'user' then 'user' else 'model' end,
                'parts', (
                  select json_array_agg(part_value)
                  from (
                    select json_build_object('text', coalesce(msgs.content, '')) as part_value
                    union all
                    select case
                      when content is not null then
                        json_build_object(
                          'inline_data', json_build_object(
                            'mime_type', mime_type,
                            'data', content
                          )
                        )
                      else
                        json_build_object(
                          'inline_data', json_build_object(
                            'mime_type', mime_type,
                            'data', content
                          )
                        )
                    end as part_value
                    from ai_provider_message_attachments
                    where message_id = msgs.message_id
                  ) as parts
                )
              )
            order by msgs.message_id) from ai_provider_generate_text_messages as msgs
          )`;
      } else {
        // Build messages with file attachments support
        // 'files' is a JSON array: [{file_uri: string, mime_type: string}, ...]
        // Build file_parts imperatively since LATERAL joins aren't supported in tableDef

        s.defTable("gemini_msg_files", {
          fields: [
            { name: "message_id", type: "BigInt" },
            { name: "file_parts", type: "Json" },
          ],
        });

        s.forEachTable("ai_provider_generate_text_messages", "msg", (s) => {
          s.if(
            sql`msg.files is not null and json_array_length(msg.files) > 0`,
            (s) => {
              s.defScalar("file_parts", sql`'[]'::json`);
              s.forEachQuery(
                sql`select value from json.array_each(msg.files)`,
                "f",
                (s) => {
                  s.setScalar(
                    "file_parts",
                    sql`file_parts || json_build_array(json_build_object(
                  'file_data', json_build_object('mime_type', f.value->>'mime_type', 'file_uri', f.value->>'file_uri')
                ))`,
                  );
                },
              );
              s.modify(
                sql`insert into gemini_msg_files (message_id, file_parts) values (msg.message_id, file_parts)`,
              );
            },
          );
        });

        geminiMessages = sql`(
            select json_array_agg(
              json_build_object(
                'role',
                case when m.role = 'user' then 'user' else 'model' end,
                'parts',
                case
                  when gmf.file_parts is not null then
                    gmf.file_parts || json_build_array(json_build_object('text', coalesce(m.content, '')))
                  else
                    json_build_array(json_build_object('text', coalesce(m.content, '')))
                end
              )
            order by m.message_id)
            from ai_provider_generate_text_messages m
            left join gemini_msg_files gmf on gmf.message_id = m.message_id
          )`;
      }

      // s.debugExpr(geminiMessages);
      geminiGenerateText(s, {
        contents: geminiMessages,
        model: props.model,
        resultScalar: props.resultScalar,
        resultRecord: resultRecord,
        systemInstruction: props.systemInstruction,
        baseUrl: props.baseUrl,
        apiKey: props.apiKey,
        ownResultScalar: true,
        temperature: 0.1, // Lower temperature for more deterministic code output
        topK: 1,
        topP: 0.8,
        pricing: props.pricing,
      });
    });
  });
}

function insertAttachment<T extends DomStatements>(
  s: T,
  props: AiProviderInsertAttachmentOpts,
) {
  props.beforeSubmitClient?.(s);
  s.tryServer({
    transferFiles: sql`select uuid from file`,
    body: (s) => {
      s.forEachTable("file", "file", (s) => {
        s.try({
          body: (s) => {
            s.if(
              sql`file.type in ('image/png', 'image/jpeg', 'image/jpg', 'application/pdf')`,
              (s) => {
                s.readDomFile(sql`file.uuid`, "image");
                s.defScalar("base64_content", sql`bytes.to_base64(image)`);
                s.debug("Uploading image or pdf");
                s.debugExpr(sql`base64_content`);
                props.onUploadSuccessServer?.(s, sql`base64_content`);
              },
            );
            s.else((s) => {
              s.throwError(
                sql.concat(sql.lit`Unsupported file type: `, sql`file.type`),
              );
            });
          },
          errorName: "file_upload_error",
          catch: (s) => {
            s.debugExpr(sql`file_upload_error.type`);
            s.debugExpr(sql`file_upload_error.message`);
            s.debugExpr(sql`file_upload_error.description`);
            s.throwError(sql`file_upload_error.message`);
          },
        });
      });
    },
    errorName: "err",
    catch: (s) => {
      s.debugExpr(sql`err.type`);
      s.debugExpr(sql`err.message`);
      s.debugExpr(sql`err.description`);
      props.onUploadErrorClient?.(s);
    },
  });
}

export function useAiProvidersBlock() {
  return new AiProvidersBlock();
}

// =============================================================================
// Unified File Upload API - uploads to Anthropic or Gemini based on provider type
// =============================================================================

interface UploadFileToProviderOpts {
  /** Provider type: 'anthropic_compatible' or 'gemini_compatible' */
  providerType: Sql;
  /** API key for the provider */
  apiKey: Sql;
  /** File content as bytes */
  fileContent: Sql;
  /** Filename */
  filename: Sql;
  /** MIME type of the file */
  mimeType: Sql;
  /** Record name for the result */
  resultRecord?: string;
}

/**
 * Upload a file to the appropriate provider's Files API based on provider type.
 *
 * Result record contains:
 * - success: boolean
 * - provider_file_id: string (Anthropic: "file_xxx", Gemini: file URI)
 * - size_bytes: number
 * - filename: string
 * - mime_type: string
 * - downloadable: boolean (Anthropic only, false for Gemini)
 * - created_at: string
 * - expires_at: string | null (Gemini only - 48h expiry)
 * - error_message: string | null
 */
export function uploadFileToProvider<T extends IServerBaseStatements>(
  s: T,
  opts: UploadFileToProviderOpts,
) {
  const resultRecord = opts.resultRecord ?? "file_upload_result";

  s.defRecord(resultRecord, {
    fields: [
      { name: "success", type: "Bool" },
      { name: "provider_file_id", type: "String" },
      { name: "size_bytes", type: "Int" },
      { name: "filename", type: "String" },
      { name: "mime_type", type: "String" },
      { name: "downloadable", type: "Bool" },
      { name: "created_at", type: "String" },
      { name: "expires_at", type: "String" },
      { name: "error_message", type: "String" },
    ],
  });

  s.block((s) => {
    // Anthropic Files API
    s.if(sql`${opts.providerType} = 'anthropic_compatible'`, (s) => {
      anthropicUploadFile(s, {
        apiKey: opts.apiKey,
        fileContent: opts.fileContent,
        filename: opts.filename,
        mimeType: opts.mimeType,
        resultRecord: "anthropic_upload_result",
      });

      // Copy result to unified result record
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, downloadable, created_at, expires_at, error_message
        ) values (
          anthropic_upload_result.success,
          anthropic_upload_result.provider_file_id,
          anthropic_upload_result.size_bytes,
          anthropic_upload_result.filename,
          anthropic_upload_result.mime_type,
          anthropic_upload_result.downloadable,
          anthropic_upload_result.created_at,
          null,
          anthropic_upload_result.error_message
        )
      `);
    });

    // Gemini Files API
    s.if(sql`${opts.providerType} = 'gemini_compatible'`, (s) => {
      geminiUploadFile(s, {
        apiKey: opts.apiKey,
        fileContent: opts.fileContent,
        filename: opts.filename,
        mimeType: opts.mimeType,
        resultRecord: "gemini_upload_result",
      });

      // Copy result to unified result record
      s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, downloadable, created_at, expires_at, error_message
        ) values (
          gemini_upload_result.success,
          gemini_upload_result.provider_file_id,
          gemini_upload_result.size_bytes,
          gemini_upload_result.filename,
          gemini_upload_result.mime_type,
          false,
          gemini_upload_result.created_at,
          gemini_upload_result.expires_at,
          gemini_upload_result.error_message
        )
      `);
    });

    // Unsupported provider type
    s.if(
      sql`${opts.providerType} not in ('anthropic_compatible', 'gemini_compatible')`,
      (s) => {
        s.modify(sql`
        insert into ${sql.ref(resultRecord)} (
          success, provider_file_id, size_bytes, filename, mime_type, downloadable, created_at, expires_at, error_message
        ) values (
          false, null, 0, null, null, false, null, null,
          'File upload not supported for provider type: ' || ${opts.providerType}
        )
      `);
      },
    );
  });
}
