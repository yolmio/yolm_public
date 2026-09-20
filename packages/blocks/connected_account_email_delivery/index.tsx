import type {
  ConnectedAccountEmailIntegration,
  SendEmailFromServerOpts,
} from "blocks/email_integrations/index";
import {
  registerEmailDeliveryTemplateRenderer,
  renderEmailDeliveryTemplate,
} from "blocks/email_delivery_template";
import type { AnyExpr, Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { storedScheduledProc } from "std/scheduled_utils";
import type { Block } from "std/system";
import { system } from "std/system";

export { ConnectedAccountEmailDeliveryReport } from "./reports";
export { ConnectedAccountEmailSelectedRowsDialog } from "./selected_rows_dialog";

const MAX_VARIABLE_BYTES = 10_000;
const MAX_RECIPIENTS_PER_DELIVERY = 500;
const SEND_OUTCOME_TIMEOUT_MINUTES = 10;

/** Domain-specific inputs for the block-owned selected-row send workflow. */
export interface ConnectedAccountEmailSelectedRowsWorkflowConfig {
  /** Must return id, name, subject_template, and html_template. */
  templatesQuery: Sql;
  /** Must return source_recipient_key, email, and variables. */
  recipientsQuery: (selectedIds: Sql) => Sql;
  authorize?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { selectedIds: Sql },
  ) => void;
  manualContent?: {
    variables?: Record<string, string>;
  };
}

export interface ConnectedAccountEmailDeliverySourceConfig {
  key: string;
  selectedRows?: ConnectedAccountEmailSelectedRowsWorkflowConfig;
  onTerminal?: <T extends IServerBaseStatements>(
    s: T,
    ctx: {
      deliveryId: AnyExpr;
      sourceRecordKey: Sql;
      succeeded: AnyExpr;
    },
  ) => void;
}

export interface EnqueueConnectedAccountEmailOptions {
  sourceRecordKey: Sql;
  integrationKey: Sql;
  accountId: AnyExpr;
  from: Sql;
  subjectTemplate: Sql;
  htmlTemplate: Sql;
  /** Must return source_recipient_key, email, and a JSON-object variables column. */
  recipientsQuery: Sql;
  deliveryIdScalar: string;
}

export interface EnqueueConnectedAccountEmailSelectedRowsOptions {
  sourceRecordKey: Sql;
  senderKey: Sql;
  templateId: AnyExpr;
  selectedIds: Sql;
  deliveryIdScalar: string;
  contentSource?: Sql;
  manualSubject?: Sql;
  manualBody?: Sql;
}

export interface ConnectedAccountEmailDeliveryBlockOptions {
  integrations: ConnectedAccountEmailIntegration[];
  maxRecipientsPerDelivery: number;
}

export class ConnectedAccountEmailDeliverySource {
  constructor(
    readonly block: ConnectedAccountEmailDeliveryBlock,
    readonly config: ConnectedAccountEmailDeliverySourceConfig,
  ) {}

  /** Enqueue inside the caller's transaction so its source record can be linked atomically. */
  enqueue<T extends IServerBaseStatements>(
    s: T,
    opts: EnqueueConnectedAccountEmailOptions,
  ) {
    this.block.enqueue(s, this.config, opts);
  }

  enqueueSelectedRows<T extends IServerBaseStatements>(
    s: T,
    opts: EnqueueConnectedAccountEmailSelectedRowsOptions,
  ) {
    this.block.enqueueSelectedRows(s, this.config, opts);
  }

  summaryQuery(deliveryId: Sql) {
    return this.block.summaryQuery(deliveryId, this.config.key);
  }

  recipientResultsQuery(deliveryId: Sql) {
    return this.block.recipientResultsQuery(deliveryId, this.config.key);
  }
}

/**
 * A bounded mail-merge outbox over user-owned email integrations. Integrations
 * retain ownership of OAuth and provider calls; this block owns only the
 * shared snapshot, recipient variables, retries, and delivery result.
 */
export class ConnectedAccountEmailDeliveryBlock implements Block {
  blockName = "ConnectedAccountEmailDeliveryBlock";
  blockDisplayName = "Connected Account Email Delivery";
  description =
    "Bounded queued delivery through connected Gmail/Outlook accounts";

  readonly sources: ConnectedAccountEmailDeliverySourceConfig[] = [];
  private initialized = false;
  private enqueueSequence = 0;

  constructor(readonly opts: ConnectedAccountEmailDeliveryBlockOptions) {
    if (opts.integrations.length === 0) {
      throw new Error(
        "ConnectedAccountEmailDeliveryBlock requires an email integration",
      );
    }
    if (
      !Number.isSafeInteger(opts.maxRecipientsPerDelivery) ||
      opts.maxRecipientsPerDelivery < 1 ||
      opts.maxRecipientsPerDelivery > MAX_RECIPIENTS_PER_DELIVERY
    ) {
      throw new Error(
        `Connected-account recipient limit must be a safe integer between 1 and ${MAX_RECIPIENTS_PER_DELIVERY}`,
      );
    }
    const keys = new Set<string>();
    for (const integration of opts.integrations) {
      if (
        integration.integrationKey.length === 0 ||
        integration.integrationKey.length > 100 ||
        !/^[a-z][a-z0-9_]*$/.test(integration.integrationKey)
      ) {
        throw new Error(
          `Invalid connected email integration key: ${integration.integrationKey}`,
        );
      }
      if (
        integration.integrationName.length === 0 ||
        integration.integrationName.length > 200
      ) {
        throw new Error(
          `Invalid connected email integration name: ${integration.integrationKey}`,
        );
      }
      if (keys.has(integration.integrationKey)) {
        throw new Error(
          `Duplicate connected email integration key: ${integration.integrationKey}`,
        );
      }
      if (
        !Number.isSafeInteger(
          integration.deliveryLimits.maxMessagesPerMinute,
        ) || integration.deliveryLimits.maxMessagesPerMinute < 1
      ) {
        throw new Error(
          `Invalid per-minute connected email limit: ${integration.integrationKey}`,
        );
      }
      if (
        !Number.isSafeInteger(
          integration.deliveryLimits.maxRecipientsPer24Hours,
        ) || integration.deliveryLimits.maxRecipientsPer24Hours < 1
      ) {
        throw new Error(
          `Invalid daily connected email limit: ${integration.integrationKey}`,
        );
      }
      keys.add(integration.integrationKey);
    }
  }

  registerSource(config: ConnectedAccountEmailDeliverySourceConfig) {
    if (this.initialized) {
      throw new Error(
        "Connected email delivery sources must be registered before initialization",
      );
    }
    if (
      config.key.length === 0 || config.key.length > 100 ||
      !/^[a-z][a-z0-9_]*$/.test(config.key)
    ) {
      throw new Error(
        `Invalid connected email delivery source key: ${config.key}`,
      );
    }
    if (this.sources.some((source) => source.key === config.key)) {
      throw new Error(
        `Duplicate connected email delivery source key: ${config.key}`,
      );
    }
    this.sources.push(config);
    return new ConnectedAccountEmailDeliverySource(this, config);
  }

  source(key: string) {
    const config = this.sources.find((source) => source.key === key);
    if (!config) throw new Error(`Unknown connected delivery source: ${key}`);
    return new ConnectedAccountEmailDeliverySource(this, config);
  }

  availableSendersQuery(userId: Sql) {
    return sql.unionAll(
      ...this.opts.integrations.map((integration) =>
        sql`select ${sql.lit(integration.integrationKey)} as integration_key,
                   sender.account_id, sender.from_address,
                   sender.mailbox_identity,
                   ${sql.lit(integration.integrationName)} as integration_name
            from (${integration.availableSendersQuery(userId)}) sender`
      ),
    );
  }

  initialize() {
    this.initialized = true;
    if (this.sources.length === 0) {
      throw new Error(
        "ConnectedAccountEmailDeliveryBlock requires a registered source",
      );
    }
    system.enum_({
      name: "connected_account_email_delivery_status",
      values: ["queued", "sending", "sent", "failed", "send_unknown"],
    });
    system.enum_({
      name: "connected_account_email_recipient_status",
      values: [
        "pending",
        "rate_limited",
        "sending",
        "sent",
        "failed",
        "send_unknown",
      ],
    });
    system.db.table("connected_account_email_deliveries", (table) => {
      table.description(
        "One shared email snapshot queued for bounded delivery through a user-owned account.",
      );
      table.sampleData({ skipSampleData: true });
      table.string("source", 100).notNull();
      table.string("source_record_key", 200).notNull();
      table.string("integration_key", 100).notNull();
      table.bigUint("account_id").notNull();
      table.string("from_email", 500).notNull();
      // Nullable for compatible adoption by systems with pre-existing outbox
      // rows. Every newly enqueued delivery freezes a non-empty identity.
      table.string("mailbox_identity", 500);
      table.string("subject_template", 1000).notNull();
      table.string("html_template", 10_000_000).notNull().multiline();
      table.enum("status", "connected_account_email_delivery_status")
        .notNull().default(sql.lit`queued`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("completed_at");
      table.unique(["source", "source_record_key"]);
      table.skipAutoApi();
    });
    system.db.table("connected_account_email_recipient_outbox", (table) => {
      table.description(
        "One recipient sent at most once through a connected account.",
      );
      table.enum("status", "connected_account_email_recipient_status").notNull()
        .default(sql.lit`pending`);
      table.timestampTz("attempted_at");
      table.timestampTz("completed_at");
      table.string("error", 2000);
      table.fk("delivery_id", "connected_account_email_deliveries").notNull()
        .onDelete("Restrict");
      table.string("source_recipient_key", 200).notNull();
      table.email("recipient_email").notNull();
      table.json("variables").notNull().default(sql`json_build_object()`);
      table.unique(["delivery_id", "source_recipient_key"]);
      table.unique(["delivery_id", "recipient_email"]);
      table.skipAutoApi();
    });
    registerEmailDeliveryTemplateRenderer();
    this.initializeCapacityWakeup();
    this.initializeOutbox();
    this.initializeTerminalReactor();
  }

  enqueue<T extends IServerBaseStatements>(
    s: T,
    source: ConnectedAccountEmailDeliverySourceConfig,
    opts: EnqueueConnectedAccountEmailOptions,
  ) {
    const prefix = `connected_email_enqueue_${this.enqueueSequence++}`;
    const recipients = `${prefix}_recipients`;
    const existingId = `${prefix}_existing_id`;
    const senderValid = `${prefix}_sender_valid`;
    const accountId = `${prefix}_account_id`;
    const mailboxIdentity = `${prefix}_mailbox_identity`;
    s.defScalar(opts.deliveryIdScalar, { type: "BigInt" });
    s.defScalar(accountId, { type: "BigInt", expr: opts.accountId });
    s.defScalar(
      existingId,
      sql`(select id from connected_account_email_deliveries
           where source = ${sql.lit(source.key)}
             and source_record_key = cast(${opts.sourceRecordKey} as string))`,
    );
    s.if(sql`${sql.ref(existingId)} is not null`, (s) => {
      s.setScalar(opts.deliveryIdScalar, sql.ref(existingId));
    }).else((s) => {
      s.defScalar(senderValid, sql`false`);
      s.defScalar(mailboxIdentity, {
        type: { type: "String", maxLength: 500 },
      });
      for (const integration of this.opts.integrations) {
        s.if(
          sql`${opts.integrationKey} = ${sql.lit(integration.integrationKey)}`,
          (s) => {
            s.setScalar(
              senderValid,
              sql`exists (select 1
                from (${
                integration.availableSendersQuery(sql`current_user`)
              }) sender
                where concat('', sender.account_id) = concat('', ${
                sql.ref(accountId)
              })
                  and lower(trim(sender.from_address)) = lower(trim(${opts.from})))`,
            );
            s.setScalar(
              mailboxIdentity,
              sql`(select min(trim(sender.mailbox_identity))
                from (${
                integration.availableSendersQuery(sql`current_user`)
              }) sender
                where concat('', sender.account_id) = concat('', ${
                sql.ref(accountId)
              })
                  and lower(trim(sender.from_address)) = lower(trim(${opts.from})))`,
            );
          },
        );
      }
      s.throwErrorIf(
        sql`not ${sql.ref(senderValid)}
          or nullif(trim(${sql.ref(mailboxIdentity)}), '') is null`,
        sql.lit`Connected email sender is unavailable for the current user`,
      );
      s.defTable(
        recipients,
        sql`select cast(recipient.source_recipient_key as string) as source_recipient_key,
                   lower(trim(recipient.email)) as email,
                   coalesce(recipient.variables, json_build_object()) as variables
            from (${opts.recipientsQuery}) recipient`,
      );
      s.throwErrorIf(
        sql`not exists (select 1 from ${sql.ref(recipients)})
          or (select count(*) from ${
          sql.ref(recipients)
        }) > ${this.opts.maxRecipientsPerDelivery}`,
        sql.lit`Connected-account delivery has an invalid recipient count`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from ${sql.ref(recipients)}
          where source_recipient_key is null
             or length(source_recipient_key) > 200
             or email is null or email = ''
             or not string.is_valid_email(email)
             or json_typeof(variables) != 'object'
             or exists (select 1 from json.object_each(variables)
                        where key = 'email')
             or octet_length(string.to_utf8(cast(variables as string))) > ${MAX_VARIABLE_BYTES})
          or exists (select source_recipient_key from ${sql.ref(recipients)}
            group by source_recipient_key having count(*) > 1)
          or exists (select email from ${sql.ref(recipients)}
            group by email having count(*) > 1)`,
        sql.lit`Connected-account delivery contains invalid recipients`,
      );
      s.modify(sql`insert into connected_account_email_deliveries (
          source, source_record_key, integration_key, account_id, from_email,
          mailbox_identity, subject_template, html_template
        ) values (
          ${sql.lit(source.key)}, cast(${opts.sourceRecordKey} as string),
          ${opts.integrationKey}, ${
        sql.ref(accountId)
      }, lower(trim(${opts.from})), ${sql.ref(mailboxIdentity)},
          ${opts.subjectTemplate}, ${opts.htmlTemplate}
        )
        on conflict (source, source_record_key) do nothing`);
      s.setScalar(
        opts.deliveryIdScalar,
        sql`(select id from connected_account_email_deliveries
          where source = ${sql.lit(source.key)}
            and source_record_key = cast(${opts.sourceRecordKey} as string))`,
      );
      s.if(
        sql`not exists (
          select 1 from connected_account_email_recipient_outbox
          where delivery_id = ${sql.ref(opts.deliveryIdScalar)}
        )`,
        (s) => {
          s.modify(sql`insert into connected_account_email_recipient_outbox (
            delivery_id, source_recipient_key, recipient_email, variables
          ) select ${sql.ref(opts.deliveryIdScalar)}, source_recipient_key,
                   email, variables from ${sql.ref(recipients)}`);
        },
      );
    });
  }

  enqueueSelectedRows<T extends IServerBaseStatements>(
    s: T,
    source: ConnectedAccountEmailDeliverySourceConfig,
    opts: EnqueueConnectedAccountEmailSelectedRowsOptions,
  ) {
    const workflow = source.selectedRows;
    if (!workflow) {
      throw new Error(
        `Connected email source ${source.key} has no selected-rows workflow`,
      );
    }
    const prefix = `connected_email_selected_rows_${this.enqueueSequence++}`;
    const sender = `${prefix}_sender`;
    const template = `${prefix}_template`;
    const contentSource = opts.contentSource ?? sql.lit`template`;
    workflow.authorize?.(s, { selectedIds: opts.selectedIds });
    s.defRecord(
      sender,
      sql`select integration_key, account_id, from_address
        from (${this.availableSendersQuery(sql`current_user`)}) available
        where available.integration_key || ':' || available.account_id::string || ':' ||
              lower(trim(available.from_address)) = ${opts.senderKey}`,
    );
    s.defRecord(
      template,
      sql`select id, subject_template, html_template
        from (${workflow.templatesQuery}) available_template
        where concat('', available_template.id) = concat('', ${opts.templateId})`,
    );
    s.throwErrorIf(
      sql`${sql.ref(sender)}.account_id is null`,
      sql.lit`Select an available connected email account.`,
    );
    s.throwErrorIf(
      workflow.manualContent
        ? sql`${contentSource} not in ('template', 'manual')
            or (
              ${contentSource} = 'template'
              and ${sql.ref(template)}.id is null
            )
            or (
              ${contentSource} = 'manual'
              and trim(coalesce(${opts.manualSubject ?? sql`null`}, '')) = ''
            )`
        : sql`${contentSource} != 'template'
            or ${sql.ref(template)}.id is null`,
      sql.lit`Select an available template or provide a manual subject.`,
    );
    const recipients = workflow.recipientsQuery(opts.selectedIds);
    s.throwErrorIf(
      sql`not exists (${recipients})`,
      sql.lit`None of the selected records is eligible for email.`,
    );
    this.enqueue(s, source, {
      sourceRecordKey: opts.sourceRecordKey,
      integrationKey: sql`${sql.ref(sender)}.integration_key`,
      accountId: sql`${sql.ref(sender)}.account_id`,
      from: sql`${sql.ref(sender)}.from_address`,
      subjectTemplate: workflow.manualContent
        ? sql`case when ${contentSource} = 'manual'
            then ${opts.manualSubject ?? sql`null`}
            else ${sql.ref(template)}.subject_template end`
        : sql`${sql.ref(template)}.subject_template`,
      htmlTemplate: workflow.manualContent
        ? sql`case when ${contentSource} = 'manual'
            then lexical_rich_text_to_html_email(${
          opts.manualBody ?? sql`null`
        })
            else ${sql.ref(template)}.html_template end`
        : sql`${sql.ref(template)}.html_template`,
      recipientsQuery: recipients,
      deliveryIdScalar: opts.deliveryIdScalar,
    });
  }

  summaryQuery(deliveryId: Sql, sourceKey?: string) {
    return sql`select delivery.id, delivery.source, delivery.source_record_key,
        delivery.integration_key, delivery.account_id, delivery.from_email,
        delivery.status, delivery.created_at, delivery.completed_at,
        count(recipient.id) as recipient_count,
        count(case when recipient.status = 'rate_limited' then 1 end)
          as rate_limited_count,
        count(case when recipient.status = 'sent' then 1 end) as sent_count,
        count(case when recipient.status = 'failed' then 1 end) as failed_count,
        count(case when recipient.status = 'send_unknown' then 1 end)
          as send_unknown_count
      from connected_account_email_deliveries delivery
      left join connected_account_email_recipient_outbox recipient
        on recipient.delivery_id = delivery.id
      where delivery.id = ${deliveryId}
        ${sourceKey ? sql`and delivery.source = ${sql.lit(sourceKey)}` : sql``}
      group by delivery.id, delivery.source, delivery.source_record_key,
        delivery.integration_key, delivery.account_id, delivery.from_email,
        delivery.status, delivery.created_at, delivery.completed_at`;
  }

  recipientResultsQuery(deliveryId: Sql, sourceKey?: string) {
    return sql`select recipient.id, recipient.delivery_id,
        recipient.source_recipient_key, recipient.recipient_email,
        recipient.status, recipient.attempted_at, recipient.completed_at,
        recipient.error
      from connected_account_email_recipient_outbox recipient
      join connected_account_email_deliveries delivery
        on delivery.id = recipient.delivery_id
      where recipient.delivery_id = ${deliveryId}
        ${sourceKey ? sql`and delivery.source = ${sql.lit(sourceKey)}` : sql``}
      order by recipient.id`;
  }

  private initializeOutbox() {
    system.addReactor({
      name: "connected_account_email_recipient_outbox_executor",
      query: sql`select id from connected_account_email_recipient_outbox
        where status = 'pending'
          or (status = 'sending'
            and attempted_at < date.add(
              minute,
              -${SEND_OUTCOME_TIMEOUT_MINUTES},
              now()
            ))`,
      recordName: "connected_outbox_candidate",
      maxConcurrent: 1,
      procedure: (s) => {
        s.defScalar("connected_stale_outbox_id", { type: "BigInt" });
        s.startTransaction();
        s.modify(sql`update connected_account_email_recipient_outbox
          set status = 'send_unknown',
              completed_at = now(),
              error = 'Connected-account send lease expired; provider outcome is unknown and the message was not retried'
          where id = connected_outbox_candidate.id
            and status = 'sending'
            and attempted_at < date.add(
              minute,
              -${SEND_OUTCOME_TIMEOUT_MINUTES},
              now()
            )
          returning id into connected_stale_outbox_id`);
        s.commitTransaction();
        s.returnIf(sql`connected_stale_outbox_id is not null`);

        s.defRecord(
          "connected_claim_delivery",
          sql`select delivery.integration_key, delivery.account_id,
              delivery.from_email, delivery.mailbox_identity
            from connected_account_email_deliveries delivery
            join connected_account_email_recipient_outbox recipient
              on recipient.delivery_id = delivery.id
            where recipient.id = connected_outbox_candidate.id`,
        );
        s.defScalar(
          "connected_mailbox_has_capacity",
          this.mailboxHasCapacity(
            sql`connected_claim_delivery.integration_key`,
            sql`connected_claim_delivery.account_id`,
            sql`connected_claim_delivery.mailbox_identity`,
            sql`connected_claim_delivery.from_email`,
          ),
        );
        s.defScalar("connected_claimed_outbox_id", { type: "BigInt" });
        s.startTransaction();
        s.if(sql`connected_mailbox_has_capacity`, (s) => {
          s.modify(sql`update connected_account_email_recipient_outbox
            set status = 'sending', attempted_at = now()
            where id = connected_outbox_candidate.id and status = 'pending'
            returning id into connected_claimed_outbox_id`);
        }).else((s) => {
          s.modify(sql`update connected_account_email_recipient_outbox
            set status = 'rate_limited'
            where id = connected_outbox_candidate.id and status = 'pending'`);
        });
        s.modify(sql`update connected_account_email_deliveries
          set status = 'sending'
          where id = (
              select delivery_id
              from connected_account_email_recipient_outbox
              where id = connected_claimed_outbox_id
            )
            and status = 'queued'`);
        s.commitTransaction();
        s.returnIf(sql`connected_claimed_outbox_id is null`);
        s.defRecord(
          "outbox",
          sql`select * from connected_account_email_recipient_outbox
            where id = connected_claimed_outbox_id`,
        );
        s.defRecord(
          "connected_delivery",
          sql`select * from connected_account_email_deliveries
              where id = outbox.delivery_id`,
        );
        s.defScalar(
          "connected_variables",
          sql`outbox.variables ||
            json_build_object('email', outbox.recipient_email)`,
        );
        s.defScalar(
          "connected_subject",
          renderEmailDeliveryTemplate(
            sql`connected_delivery.subject_template`,
            sql`connected_variables`,
            false,
          ),
        );
        s.defScalar(
          "connected_html",
          renderEmailDeliveryTemplate(
            sql`connected_delivery.html_template`,
            sql`connected_variables`,
            true,
          ),
        );
        s.defScalar("connected_provider_succeeded", sql`false`);
        s.defScalar("connected_dispatch_started", sql`false`);
        s.defScalar("connected_provider_error", {
          type: { type: "String", maxLength: 2000 },
        });
        s.try({
          body: (s) => {
            s.defScalar("connected_integration_matched", sql`false`);
            for (const integration of this.opts.integrations) {
              s.if(
                sql`connected_delivery.integration_key = ${
                  sql.lit(integration.integrationKey)
                }`,
                (s) => {
                  s.setScalar("connected_integration_matched", sql`true`);
                  if (integration.accountOwnerQuery) {
                    const ownerScalar =
                      `connected_account_owner_${integration.integrationKey}`;
                    s.defScalar(
                      ownerScalar,
                      integration.accountOwnerQuery(
                        sql`connected_delivery.account_id`,
                      ),
                    );
                    s.throwErrorIf(
                      sql`${sql.ref(ownerScalar)} is null`,
                      sql.lit`Connected email account owner is unavailable`,
                    );
                    s.setCurrentUser(sql.ref(ownerScalar));
                  } else {
                    // Legacy/test adapters cannot expose request-boundary hooks
                    // reliably, so retain the conservative unknown outcome.
                    s.setScalar("connected_dispatch_started", sql`true`);
                  }
                  const sendOpts: SendEmailFromServerOpts = {
                    accountId: sql`connected_delivery.account_id`,
                    to: sql`outbox.recipient_email`,
                    subject: sql`connected_subject`,
                    body: sql`connected_html`,
                    from: sql`connected_delivery.from_email`,
                    beforeEmailSent: (s) => {
                      s.setScalar("connected_dispatch_started", sql`true`);
                    },
                    onEmailSendError: (s, ctx) => {
                      s.setScalar(
                        "connected_dispatch_started",
                        ctx.deliveryMayHaveOccurred ?? sql`false`,
                      );
                      s.setScalar(
                        "connected_provider_error",
                        ctx.errorMessage,
                      );
                    },
                  };
                  integration.sendEmailFromServer(s, sendOpts);
                },
              );
            }
            s.throwErrorIf(
              sql`not connected_integration_matched`,
              sql.lit`Connected email integration is not registered`,
            );
            s.setScalar("connected_provider_succeeded", sql`true`);
          },
          errorName: "connected_send_error",
          catch: (s) =>
            s.setScalar(
              "connected_provider_error",
              sql`coalesce(connected_send_error.message, 'Connected account send failed')`,
            ),
        });
        s.startTransaction();
        s.modify(sql`update connected_account_email_recipient_outbox
          set status = case when connected_provider_succeeded
                then 'sent'::enums.connected_account_email_recipient_status
                when connected_dispatch_started
                then 'send_unknown'::enums.connected_account_email_recipient_status
                else 'failed'::enums.connected_account_email_recipient_status end,
              completed_at = now(),
              error = case when connected_provider_succeeded then null
                else coalesce(
                  connected_provider_error,
                  'Connected account send failed; provider outcome is unknown and the message was not retried'
                ) end
          where id = connected_claimed_outbox_id and status = 'sending'`);
        s.commitTransaction();
      },
    });
  }

  private initializeCapacityWakeup() {
    storedScheduledProc({
      name: "connected_account_email_capacity_wake",
      schedule: "0 * * * * *",
      procedure: (s) => {
        s.startTransaction();
        s.modify(sql`update connected_account_email_recipient_outbox recipient
          set status = 'pending'
          where recipient.status = 'rate_limited'
            and exists (
              select 1
              from connected_account_email_deliveries delivery
              where delivery.id = recipient.delivery_id
                and ${
          this.mailboxHasCapacity(
            sql`delivery.integration_key`,
            sql`delivery.account_id`,
            sql`delivery.mailbox_identity`,
            sql`delivery.from_email`,
          )
        }
            )`);
        s.commitTransaction();
      },
    });
  }

  private mailboxHasCapacity(
    integrationKey: Sql,
    accountId: Sql,
    mailboxIdentity: Sql,
    fromEmail: Sql,
  ) {
    return sql.or(
      ...this.opts.integrations.map((integration) => {
        const resolvedMailboxIdentity = sql`coalesce(
          ${integration.mailboxIdentityQuery(accountId)},
          nullif(trim(${mailboxIdentity}), ''),
          lower(trim(${fromEmail}))
        )`;
        return sql.and(
          sql`${integrationKey} = ${sql.lit(integration.integrationKey)}`,
          sql`(select count(*)
                from connected_account_email_recipient_outbox prior_recipient
                join connected_account_email_deliveries prior_delivery
                  on prior_delivery.id = prior_recipient.delivery_id
                where prior_recipient.attempted_at >= date.add(minute, -1, now())
                  and prior_delivery.integration_key = ${integrationKey}
                  and (
                    prior_delivery.mailbox_identity = ${resolvedMailboxIdentity}
                    or ${
            integration.mailboxIdentityQuery(
              sql`prior_delivery.account_id`,
            )
          } = ${resolvedMailboxIdentity}
                    or lower(trim(prior_delivery.from_email)) =
                      lower(trim(${fromEmail}))
                  ))
              < ${integration.deliveryLimits.maxMessagesPerMinute}`,
          sql`(select count(*)
                from connected_account_email_recipient_outbox prior_recipient
                join connected_account_email_deliveries prior_delivery
                  on prior_delivery.id = prior_recipient.delivery_id
                where prior_recipient.attempted_at >= date.add(hour, -24, now())
                  and prior_delivery.integration_key = ${integrationKey}
                  and (
                    prior_delivery.mailbox_identity = ${resolvedMailboxIdentity}
                    or ${
            integration.mailboxIdentityQuery(
              sql`prior_delivery.account_id`,
            )
          } = ${resolvedMailboxIdentity}
                    or lower(trim(prior_delivery.from_email)) =
                      lower(trim(${fromEmail}))
                  ))
              < ${integration.deliveryLimits.maxRecipientsPer24Hours}`,
        );
      }),
    );
  }

  private initializeTerminalReactor() {
    system.addReactor({
      name: "connected_account_email_delivery_terminal",
      query: sql`select delivery.id
        from connected_account_email_deliveries delivery
        where delivery.status in ('queued', 'sending')
          and not exists (
            select 1 from connected_account_email_recipient_outbox recipient
            where recipient.delivery_id = delivery.id
              and recipient.status in ('pending', 'rate_limited', 'sending')
          )`,
      recordName: "connected_terminal_candidate",
      maxConcurrent: 2,
      procedure: (s) => {
        s.startTransaction();
        this.completeIfTerminal(s, sql`connected_terminal_candidate.id`);
        s.commitTransaction();
      },
    });
  }

  private completeIfTerminal<T extends IServerBaseStatements>(
    s: T,
    deliveryId: Sql,
  ) {
    const terminalSources = this.sources.filter((source) => source.onTerminal);
    if (terminalSources.length > 0) {
      s.defScalar("connected_completed_delivery_id", { type: "BigInt" });
    }
    s.modify(sql`update connected_account_email_deliveries
      set status = case
            when exists (
              select 1 from connected_account_email_recipient_outbox
              where delivery_id = ${deliveryId} and status = 'send_unknown'
            )
            then 'send_unknown'::enums.connected_account_email_delivery_status
            when exists (
              select 1 from connected_account_email_recipient_outbox
              where delivery_id = ${deliveryId} and status = 'failed'
            )
            then 'failed'::enums.connected_account_email_delivery_status
            else 'sent'::enums.connected_account_email_delivery_status end,
          completed_at = now()
      where id = ${deliveryId} and status in ('queued', 'sending')
        and not exists (select 1 from connected_account_email_recipient_outbox
          where delivery_id = ${deliveryId}
            and status in ('pending', 'rate_limited', 'sending'))
      ${
      terminalSources.length > 0
        ? sql`returning id into connected_completed_delivery_id`
        : sql``
    }`);
    if (terminalSources.length === 0) return;
    s.if(sql`connected_completed_delivery_id is not null`, (s) => {
      s.defRecord(
        "connected_terminal_delivery",
        sql`select * from connected_account_email_deliveries
            where id = connected_completed_delivery_id`,
      );
      for (const source of terminalSources) {
        s.if(
          sql`connected_terminal_delivery.source = ${sql.lit(source.key)}`,
          (s) => {
            source.onTerminal!(s, {
              deliveryId: sql`connected_terminal_delivery.id`,
              sourceRecordKey:
                sql`connected_terminal_delivery.source_record_key`,
              succeeded: sql`connected_terminal_delivery.status = 'sent'`,
            });
          },
        );
      }
    });
  }
}
