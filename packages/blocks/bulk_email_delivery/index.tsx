import { storedScheduledProc } from "std/scheduled_utils";
import { checkString, sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type {
  EndpointStatementsOrFn,
  HelperProcField,
  IServerBaseStatements,
} from "std/statements";
import type { Block } from "std/system";
import { system } from "std/system";
import { getCapabilities } from "std/yolm_gen_api";

export { BulkEmailDeliveryReport } from "./reports";
export { BulkEmailReconciliation } from "./reconciliation";

const SUBMISSION_TIMEOUT_MINUTES = 10;
const RETRY_DELAY_MINUTES = 1;
const CALLBACK_RETRY_DELAY_MINUTES = 15;
const MAX_SUBMISSION_ATTEMPTS = 3;
const MAX_RECIPIENT_VARIABLE_BYTES = 10_000;
// The current platform bulk-delivery contract supports at most 500 recipients
// per request. Keep this explicit until the platform owns provider-specific
// chunking.
const MAX_BULK_EMAIL_RECIPIENTS = 500;
const MAX_ATTACHMENTS_PER_DELIVERY = 10;
const MAX_REQUEST_BYTES = 10_000_000;
const UNSUBSCRIBE_TOKEN_HEX_LENGTH = 64;
// One unquoted mailbox per tracked recipient. Display names and address lists
// cannot be correlated to the provider's individual recipient events.
// Postmark's mailbox validator excludes '?', even though RFC 5322 permits it:
// https://postmarkapp.com/support/article/what-regex-does-postmark-use
const RECIPIENT_EMAIL_PATTERN =
  "^[a-zA-Z0-9!#$%&'*+/=^_`{|}~-]+(?:\\.[a-zA-Z0-9!#$%&'*+/=^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$";
const INVALID_RECIPIENT_EMAIL_ERROR =
  "Invalid recipient email format; use one plain email address";
const HTML_UNSUBSCRIBE_FOOTER =
  '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:12px;line-height:1.5;color:#666;">You are receiving this message because you are subscribed to bulk emails. <a href="{{unsubscribe_url}}">Unsubscribe</a></div>';
const TEXT_UNSUBSCRIBE_FOOTER =
  "\n\nYou are receiving this message because you are subscribed to bulk emails. Unsubscribe: {{{unsubscribe_url}}}";

export function withHtmlUnsubscribeFooter(html: AnyExpr) {
  return sql`case when ${html} is null then null
    when regex.is_match(
      ${html},
      '(?is)</body\\s*>\\s*(?:</html\\s*>)?\\s*$'
    )
      then regex.replace(
        ${html},
        '(?is)^(.*)</body\\s*>(\\s*(?:</html\\s*>)?\\s*)$',
        '$1' || ${sql.lit(HTML_UNSUBSCRIBE_FOOTER)} || '</body>$2'
      )
    when regex.is_match(${html}, '(?is)</html\\s*>\\s*$')
      then regex.replace(
        ${html},
        '(?is)^(.*)</html\\s*>(\\s*)$',
        '$1' || ${sql.lit(HTML_UNSUBSCRIBE_FOOTER)} || '</html>$2'
      )
    else ${html} || ${sql.lit(HTML_UNSUBSCRIBE_FOOTER)} end`;
}

export function withTextUnsubscribeFooter(text: AnyExpr) {
  return sql`case when ${text} is null then null
    else ${text} || ${sql.lit(TEXT_UNSUBSCRIBE_FOOTER)} end`;
}

export interface BulkEmailDeliverySourceConfig {
  key: string;
  isRecipientEligible?: (recipient: Sql) => AnyExpr;
  onSubmissionTerminal?: <T extends IServerBaseStatements>(
    s: T,
    ctx: {
      deliveryId: AnyExpr;
      sourceRecordKey: Sql;
      succeeded: AnyExpr;
    },
  ) => void;
  /**
   * Called when a provider event changes the recipient's first-event summary.
   */
  onRecipientEvent?: <T extends IServerBaseStatements>(
    s: T,
    ctx: {
      deliveryId: AnyExpr;
      sourceRecordKey: Sql;
      sourceRecipientKey: Sql;
      email: Sql;
      eventType: AnyExpr;
      occurredAt: AnyExpr;
      detail: AnyExpr;
    },
  ) => void;
}

export interface EnqueueBulkEmailDeliveryOptions {
  sourceRecordKey: Sql;
  from: Sql;
  replyTo?: Sql;
  subjectTemplate: Sql;
  htmlTemplate?: Sql;
  textTemplate?: Sql;
  /** Must return source_recipient_key, email, and a JSON-object variables column. */
  recipientsQuery: Sql;
  /** Must return name, blob, and content_type. */
  attachmentsQuery?: Sql;
  deliveryIdScalar: string;
}

export interface CreateHeldBulkEmailDeliveryOptions {
  sourceRecordKey: Sql;
  from: Sql;
  replyTo?: Sql;
  /** Must return source_recipient_key, email, and a JSON-object variables column. */
  recipientsQuery: Sql;
  /** Must return name, blob, and content_type. */
  attachmentsQuery?: Sql;
  deliveryIdScalar: string;
}

export interface ReleaseHeldBulkEmailDeliveryOptions {
  deliveryId: AnyExpr;
  subjectTemplate: Sql;
  htmlTemplate?: Sql;
  textTemplate?: Sql;
  releasedDeliveryIdScalar: string;
}

type CreateBulkEmailDeliveryOptions = CreateHeldBulkEmailDeliveryOptions & {
  subjectTemplate?: Sql;
  htmlTemplate?: Sql;
  textTemplate?: Sql;
};

export interface BulkEmailRecipientEvent {
  recipientId: AnyExpr;
  eventType: AnyExpr;
  occurredAt: AnyExpr;
  detail?: AnyExpr;
  terminalBounce?: AnyExpr;
}

export interface BulkEmailDeliveryBlockOptions {
  /** Enable shared file attachments. Defaults to true for existing consumers. */
  attachments?: boolean;
  /** Used by isolated examples and tests in place of the platform operation. */
  platformBulkMockProcedure?: EndpointStatementsOrFn;
  /**
   * Retain open/click aggregates. When disabled, valid canonical engagement
   * events are acknowledged without storing them or invoking source callbacks.
   */
  engagementTracking?: boolean;
}

const bulkRecipientFields: HelperProcField[] = [
  { name: "source_recipient_key", type: "String" },
  { name: "email", type: "String" },
  { name: "variables", type: "Json" },
];
const bulkAttachmentFields: HelperProcField[] = [
  { name: "name", type: "String" },
  { name: "blob", type: { type: "Bytes", maxLength: 64 } },
  { name: "content_type", type: "String" },
];

export class BulkEmailDeliverySource {
  constructor(
    readonly block: BulkEmailDeliveryBlock,
    readonly config: BulkEmailDeliverySourceConfig,
  ) {}

  /** Enqueue inside the caller's transaction so its source record can be linked atomically. */
  enqueue<T extends IServerBaseStatements>(
    s: T,
    opts: EnqueueBulkEmailDeliveryOptions,
  ) {
    this.block.enqueue(s, this.config, opts);
  }

  /** Freeze an audience now while leaving shared content for a later release. */
  createHeld<T extends IServerBaseStatements>(
    s: T,
    opts: CreateHeldBulkEmailDeliveryOptions,
  ) {
    this.block.createHeld(s, this.config, opts);
  }

  /** Finalize shared content and make a held delivery eligible for submission. */
  releaseHeld<T extends IServerBaseStatements>(
    s: T,
    opts: ReleaseHeldBulkEmailDeliveryOptions,
  ) {
    this.block.releaseHeld(s, this.config, opts);
  }

  /** Delete a held delivery and its audience before it is released. */
  discardHeld<T extends IServerBaseStatements>(
    s: T,
    deliveryId: AnyExpr,
  ) {
    this.block.discardHeld(s, this.config, deliveryId);
  }

  summaryQuery(deliveryId: Sql) {
    return this.block.summaryQuery(deliveryId, this.config.key);
  }
}

/**
 * Frozen, provider-neutral bulk delivery through the platform
 * `email.send_bulk` operation. It deliberately owns neither templates,
 * marketing preferences, provider credentials, nor provider webhook setup.
 */
export class BulkEmailDeliveryBlock implements Block {
  blockName = "BulkEmailDeliveryBlock";
  blockDisplayName = "Bulk Email Delivery";
  description = "Provider-neutral platform bulk-email delivery and results";
  externalServiceOptions = [
    { optionKey: "send_emails", optionLabel: "Send bulk emails" },
  ];

  private readonly sources: BulkEmailDeliverySourceConfig[] = [];
  private initialized = false;
  private enqueueSequence = 0;
  #caps = getCapabilities()?.blocks?.BulkEmailDeliveryBlock;

  constructor(readonly opts: BulkEmailDeliveryBlockOptions = {}) {}

  registerSource(config: BulkEmailDeliverySourceConfig) {
    if (this.initialized) {
      throw new Error(
        "Bulk email delivery sources must be registered before initialization",
      );
    }
    if (
      config.key.length === 0 || config.key.length > 100 ||
      !/^[a-z][a-z0-9_]*$/.test(config.key)
    ) {
      throw new Error(`Invalid bulk email delivery source key: ${config.key}`);
    }
    if (this.sources.some((source) => source.key === config.key)) {
      throw new Error(
        `Duplicate bulk email delivery source key: ${config.key}`,
      );
    }
    this.sources.push(config);
    return new BulkEmailDeliverySource(this, config);
  }

  source(key: string) {
    const config = this.sources.find((source) => source.key === key);
    if (!config) throw new Error(`Unknown bulk email delivery source: ${key}`);
    return new BulkEmailDeliverySource(this, config);
  }

  initialize() {
    this.initialized = true;
    if (this.sources.length === 0) {
      throw new Error("BulkEmailDeliveryBlock requires a registered source");
    }
    this.defineSchema();
    this.initializePlatformEventEndpoint();
    this.initializeUnsubscribeEndpoints();
    this.initializeDelivery();
  }

  populate() {
    system.storedProcedure({
      name: "bulk_email_validate_recipients",
      transaction: "caller",
      inputTables: [{ name: "recipients", fields: bulkRecipientFields }],
      procedure: (s) => {
        s.throwErrorIf(
          sql`not exists (select 1 from ${sql.ref("recipients")})`,
          sql.lit`Bulk delivery requires at least one recipient`,
        );
        s.throwErrorIf(
          sql`(select count(*) from ${sql.ref("recipients")})
          > ${MAX_BULK_EMAIL_RECIPIENTS}`,
          sql
            .lit`Bulk delivery exceeds the current 500-recipient provider request limit`,
        );
        s.throwErrorIf(
          sql`exists (
          select 1 from ${sql.ref("recipients")}
          where source_recipient_key is null
             or length(source_recipient_key) > 200
             or json_typeof(variables) != 'object'
             or exists (select 1 from json.object_each(variables)
                        where key in (
                          'email', 'unsubscribe_url', 'one_click_unsubscribe_url'
                        ))
             or octet_length(string.to_utf8(cast(variables as string))) > ${MAX_RECIPIENT_VARIABLE_BYTES}
        )`,
          sql.lit`Bulk delivery contains an invalid recipient`,
        );
        s.throwErrorIf(
          sql`exists (
          select source_recipient_key from ${sql.ref("recipients")}
          group by source_recipient_key having count(*) > 1
        ) or exists (
          select email from ${sql.ref("recipients")} where email is not null
          group by email having count(*) > 1
        )`,
          sql.lit`Bulk delivery contains duplicate recipients`,
        );
      },
    });
    system.storedProcedure({
      name: "bulk_email_store_recipients",
      transaction: "caller",
      inputScalars: [{ name: "p_delivery_id", type: "BigInt" }],
      inputTables: [{ name: "recipients", fields: bulkRecipientFields }, {
        name: "attachments",
        fields: bulkAttachmentFields,
      }],
      procedure: (s) => {
        s.if(
          sql`not exists (
          select 1 from bulk_email_delivery_recipients
          where delivery_id = ${sql.ref("p_delivery_id")}
        )`,
          (s) => {
            s.modify(sql`insert into bulk_email_delivery_recipients (
            delivery_id, source_recipient_key, email, variables,
            unsubscribe_token, status, error
          ) select ${sql.ref("p_delivery_id")}, source_recipient_key,
                   email, variables, bytes.to_hex(crypto.random_bytes(32)),
                   case when email is null then 'excluded'::enums.bulk_email_recipient_status
                   when exists (
                     select 1 from bulk_email_suppressions suppression
                     where suppression.email = ${sql.ref("recipients")}.email
                   ) then 'excluded'::enums.bulk_email_recipient_status
                   else 'pending'::enums.bulk_email_recipient_status end,
                   case when email is null then ${
              sql.lit(INVALID_RECIPIENT_EMAIL_ERROR)
            }
                   when exists (
                     select 1 from bulk_email_suppressions suppression
                     where suppression.email = ${sql.ref("recipients")}.email
                   ) then 'Excluded by system-wide bulk-email suppression'
                   else null end
            from ${sql.ref("recipients")}`);
            if (this.opts.attachments !== false) {
              s.modify(sql`insert into bulk_email_delivery_attachments (
              delivery_id, name, blob, content_type
            ) select ${sql.ref("p_delivery_id")}, name, blob, content_type
              from ${sql.ref("attachments")}`);
            }
          },
        );
      },
    });
    system.storedProcedure({
      name: "bulk_email_apply_recipient_event",
      transaction: "caller",
      inputScalars: [
        { name: "p_recipient_id", type: "BigInt" },
        { name: "p_event_type", type: "String" },
        { name: "p_occurred_at", type: "TimestampUtc" },
        { name: "p_detail", type: "String" },
        { name: "p_terminal_bounce", type: "Bool" },
        { name: "p_source_event_key", type: "String" },
        { name: "p_delivery_id", type: "BigInt" },
        { name: "p_source", type: "String" },
        { name: "p_source_record_key", type: "String" },
        { name: "p_source_recipient_key", type: "String" },
        { name: "p_email", type: "String" },
      ],
      procedure: (s) => {
        s.defRecord(
          "bulk_event_recipient",
          sql`select p_delivery_id as delivery_id, p_source as source, p_source_record_key as source_record_key, p_source_recipient_key as source_recipient_key, p_email as email`,
        );
        this.applyRecipientEventStatements(s, {
          recipientId: sql`p_recipient_id`,
          eventType: sql`p_event_type`,
          occurredAt: sql`p_occurred_at`,
          detail: sql`p_detail`,
          terminalBounce: sql`p_terminal_bounce`,
          sourceEventKey: sql`p_source_event_key`,
        });
      },
    });
  }

  /** Shared marketing opt-out check, including connected-account mail merges. */
  isSuppressed(email: AnyExpr) {
    return sql`exists(select 1 from bulk_email_suppressions suppression
      where suppression.email = lower(trim(${email})))`;
  }

  private unsubscribeUrl(token: AnyExpr, oneClick = false) {
    const baseUrl = sql.lit(
      `https://yolmglobalapi.com/bulk-email/unsubscribe${
        oneClick ? "/one-click" : ""
      }?yolm-system-id=`,
    );
    return sql`${baseUrl} || info.system_id()::string
      || '&token=' || uri.encode_component(cast(${token} as string))`;
  }

  private initializeUnsubscribeEndpoints() {
    const query = [{
      name: "token",
      type: { type: "String" as const, maxLength: 200 },
    }];
    system.globalApi.get("/bulk-email/unsubscribe", {
      query,
      procedure: (s) => {
        s.setHeader(
          sql.lit`Content-Type`,
          sql.lit`text/html; charset=utf-8`,
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHeader(sql.lit`X-Robots-Tag`, sql.lit`noindex, nofollow`);
        s.if(
          sql`token is null
            or not regex.is_match(token, '^[0-9a-f]{64}$')
            or not exists (
              select 1 from bulk_email_delivery_recipients
              where unsubscribe_token = token
            )`,
          (s) => {
            s.setHttpStatus(404);
            s.return(
              sql
                .lit`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:50px auto;text-align:center"><h1>Unsubscribe link unavailable</h1><p>This unsubscribe link is invalid or no longer available.</p></body></html>`,
            );
          },
        );
        s.return(sql.concat(
          sql
            .lit`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:50px auto;text-align:center"><h1>Unsubscribe</h1><p>Confirm that you want to stop receiving bulk emails.</p><form method="post" action="`,
          this.unsubscribeUrl(sql`token`),
          sql
            .lit`"><button type="submit" style="padding:10px 18px">Unsubscribe</button></form></body></html>`,
        ));
      },
    });

    system.globalApi.post("/bulk-email/unsubscribe", {
      query,
      procedure: (s) => {
        this.applyUnsubscribeToken(s);
        s.setHeader(
          sql.lit`Content-Type`,
          sql.lit`text/html; charset=utf-8`,
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.return(
          sql
            .lit`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:50px auto;text-align:center"><h1>Unsubscribe request received</h1><p>If the link was valid, you have been unsubscribed from bulk emails.</p></body></html>`,
        );
      },
    });

    system.globalApi.post("/bulk-email/unsubscribe/one-click", {
      query,
      textBodyScalar: "bulk_one_click_body",
      procedure: (s) => {
        s.if(
          sql`bulk_one_click_body = 'List-Unsubscribe=One-Click'`,
          (s) => this.applyUnsubscribeToken(s),
        );
        s.setHeader(
          sql.lit`Content-Type`,
          sql.lit`application/json`,
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.return(sql`json_build_object('ok', true)`);
      },
    });
  }

  private applyUnsubscribeToken<T extends IServerBaseStatements>(s: T) {
    s.defRecord(
      "bulk_event_recipient",
      sql`select recipient.id, recipient.delivery_id,
              recipient.source_recipient_key, recipient.email,
              recipient.unsubscribed_at,
              delivery.source, delivery.source_record_key
          from bulk_email_delivery_recipients recipient
          join bulk_email_deliveries delivery
            on delivery.id = recipient.delivery_id
          where token is not null
            and regex.is_match(token, '^[0-9a-f]{64}$')
            and recipient.unsubscribe_token = token`,
    );
    s.startTransaction();
    s.if(sql`bulk_event_recipient.id is not null`, (s) => {
      this.applyRecipientEvent(s, {
        recipientId: sql`bulk_event_recipient.id`,
        eventType: sql.lit`unsubscribe`,
        occurredAt: sql`now()`,
        detail: sql.lit`Recipient requested bulk-email unsubscribe`,
        sourceEventKey:
          sql`'local-unsubscribe:' || bulk_event_recipient.id::string`,
      });
    });
    s.commitTransaction();
  }

  private initializePlatformEventEndpoint() {
    const unsupportedEventType = sql`bulk_event_type not in (
      'delivered', 'open', 'click', 'bounce', 'complaint', 'unsubscribe'
    )`;
    const engagementPayloadValidation = sql`
          when length(coalesce(bulk_platform_event->>'url', '')) > 4000
            then 'url_too_long'
          when length(coalesce(
            bulk_platform_event->>'click_location', ''
          )) > 50 then 'click_location_too_long'
          when length(coalesce(
            bulk_platform_event->>'user_agent', ''
          )) > 1000 then 'user_agent_too_long'
          when length(coalesce(bulk_platform_event->>'ip', '')) > 100
            then 'ip_too_long'`;
    system.globalApi.post("/platform-email-events", {
      jsonBodyScalar: "bulk_platform_event",
      procedure: (s) => {
        s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
        s.defScalar(
          "bulk_event_version",
          sql`case when lower(trim(coalesce(
              bulk_platform_event->>'version',
              bulk_platform_event->>'event_version',
              ''
            ))) = 'v1' then 1
            else try_cast(coalesce(
              bulk_platform_event->>'version',
              bulk_platform_event->>'event_version'
            ) as int) end`,
        );
        s.defScalar(
          "bulk_event_key",
          sql`nullif(trim(bulk_platform_event->>'event_key'), '')`,
        );
        s.defScalar(
          "bulk_event_provider",
          sql`lower(trim(coalesce(bulk_platform_event->>'provider', '')))`,
        );
        s.defScalar(
          "bulk_event_type",
          sql`lower(trim(coalesce(bulk_platform_event->>'event_type', '')))`,
        );
        s.defScalar(
          "bulk_event_campaign_id",
          sql`try_cast(bulk_platform_event->>'campaign_id' as bigint)`,
        );
        s.defScalar(
          "bulk_event_batch_id",
          sql`try_cast(bulk_platform_event->>'batch_id' as bigint)`,
        );
        s.defScalar(
          "bulk_event_recipient_id",
          sql`try_cast(bulk_platform_event->>'recipient_id' as bigint)`,
        );
        s.defScalar(
          "bulk_event_recipient_key",
          sql`try_cast(bulk_platform_event->>'recipient_key' as bigint)`,
        );
        s.defScalar(
          "bulk_event_occurred_at",
          sql`try_cast(bulk_platform_event->>'occurred_at' as timestamptz)`,
        );
        s.defScalar(
          "bulk_event_email",
          sql`lower(trim(coalesce(bulk_platform_event->>'recipient', '')))`,
        );
        s.defScalar(
          "bulk_event_invalid_reason",
          sql`case
            when json_typeof(bulk_platform_event) != 'object'
              then 'body_not_object'
            when bulk_event_version is null then 'invalid_version'
            when bulk_event_version != 1 then 'unsupported_version'
            when bulk_event_key is null then 'missing_event_key'
            when length(bulk_event_key) > 500 then 'event_key_too_long'
            when bulk_event_provider = '' then 'missing_provider'
            when length(bulk_event_provider) > 50 then 'provider_too_long'
            when ${unsupportedEventType} then 'unsupported_event_type'
            when bulk_event_campaign_id is null
              or bulk_event_campaign_id <= 0 then 'invalid_campaign_id'
            when bulk_event_batch_id is null
              or bulk_event_batch_id <= 0 then 'invalid_batch_id'
            when bulk_event_campaign_id != bulk_event_batch_id
              then 'campaign_batch_mismatch'
            when bulk_event_recipient_id is null
              or bulk_event_recipient_id <= 0 then 'invalid_recipient_id'
            when bulk_event_recipient_key is null
              or bulk_event_recipient_key <= 0 then 'invalid_recipient_key'
            when bulk_event_recipient_id != bulk_event_recipient_key
              then 'recipient_id_key_mismatch'
            when bulk_event_occurred_at is null then 'invalid_occurred_at'
            when bulk_event_email = '' then 'missing_recipient'
            when length(bulk_event_email) > 500 then 'recipient_too_long'
            when length(coalesce(
              bulk_platform_event->>'provider_message_id', ''
            )) > 200 then 'provider_message_id_too_long'
            when length(coalesce(bulk_platform_event->>'bounce_type', '')) > 100
              then 'bounce_type_too_long'
            ${engagementPayloadValidation}
            when length(coalesce(bulk_platform_event->>'detail', '')) > 2000
              then 'detail_too_long'
            when bulk_platform_event->>'bounce_type_code' is not null
              and json_typeof(bulk_platform_event->'bounce_type_code') != 'number'
              then 'bounce_type_code_not_number'
            when bulk_platform_event->>'inactive' is not null
              and json_typeof(bulk_platform_event->'inactive') != 'boolean'
              then 'inactive_not_boolean'
            when bulk_platform_event->>'can_activate' is not null
              and json_typeof(bulk_platform_event->'can_activate') != 'boolean'
              then 'can_activate_not_boolean'
            when bulk_platform_event->>'terminal_bounce' is not null
              and json_typeof(bulk_platform_event->'terminal_bounce') != 'boolean'
              then 'terminal_bounce_not_boolean'
            when bulk_platform_event->>'terminal' is not null
              and json_typeof(bulk_platform_event->'terminal') != 'boolean'
              then 'terminal_not_boolean'
            else null end`,
        );
        s.if(
          sql`bulk_event_invalid_reason is not null`,
          (s) => {
            s.logError(
              sql`'Rejected bulk email platform event: '
                || bulk_event_invalid_reason
                || '; event_type=' || substring(
                  coalesce(bulk_event_type, '<null>') from 1 for 80
                )
                || '; provider=' || substring(
                  coalesce(bulk_event_provider, '<null>') from 1 for 80
                )
                || '; version=' || substring(coalesce(
                  bulk_platform_event->>'version',
                  bulk_platform_event->>'event_version',
                  '<null>'
                ) from 1 for 80)
                || '; campaign_id=' || coalesce(
                  bulk_event_campaign_id::string, '<null>'
                )
                || '; batch_id=' || coalesce(
                  bulk_event_batch_id::string, '<null>'
                )
                || '; recipient_id=' || coalesce(
                  bulk_event_recipient_id::string, '<null>'
                )
                || '; recipient_key=' || coalesce(
                  bulk_event_recipient_key::string, '<null>'
                )
                || '; occurred_at_json_type=' || coalesce(
                  json_typeof(bulk_platform_event->'occurred_at'), '<missing>'
                )
                || '; occurred_at=' || substring(coalesce(
                  bulk_platform_event->>'occurred_at', '<null>'
                ) from 1 for 100
                )`,
              sql.lit`bulk_email_webhook_validation`,
            );
            s.setHeader(
              sql.lit`X-Yolm-Webhook-Rejection`,
              sql`bulk_event_invalid_reason`,
            );
            s.setHttpStatus(400);
            s.return(
              sql`json_build_object(
                'ok', false,
                'error', 'invalid_event',
                'reason', bulk_event_invalid_reason
              )`,
            );
          },
        );
        s.defRecord(
          "bulk_event_recipient",
          sql`select recipient.id, recipient.delivery_id,
                  recipient.source_recipient_key, recipient.email,
                  delivery.source, delivery.source_record_key
              from bulk_email_delivery_recipients recipient
              join bulk_email_deliveries delivery
                on delivery.id = recipient.delivery_id
              where recipient.id = bulk_event_recipient_id - 1`,
        );
        s.defScalar(
          "bulk_event_mismatch_reason",
          sql`case
            when bulk_event_recipient.id is null then 'recipient_not_found'
            when bulk_event_recipient.delivery_id + 1 != bulk_event_campaign_id
              then 'delivery_mismatch'
            when lower(trim(bulk_event_recipient.email)) is distinct from bulk_event_email
              then 'recipient_email_mismatch'
            else null end`,
        );
        s.if(
          sql`bulk_event_mismatch_reason is not null`,
          (s) => {
            s.logError(
              sql`'Rejected bulk email platform event: '
                || bulk_event_mismatch_reason
                || '; campaign_id=' || bulk_event_campaign_id::string
                || '; recipient_id=' || bulk_event_recipient_id::string
                || '; resolved_delivery_id=' || coalesce(
                  (bulk_event_recipient.delivery_id + 1)::string, '<null>'
                )`,
              sql.lit`bulk_email_webhook_correlation`,
            );
            s.setHeader(
              sql.lit`X-Yolm-Webhook-Rejection`,
              sql`bulk_event_mismatch_reason`,
            );
            s.setHttpStatus(400);
            s.return(
              sql`json_build_object(
                'ok', false,
                'error', 'recipient_mismatch',
                'reason', bulk_event_mismatch_reason
              )`,
            );
          },
        );
        if (this.opts.engagementTracking === false) {
          // Tracking is a retention policy, not a restriction on valid events.
          // Validate and correlate first, then acknowledge without any writes.
          s.if(sql`bulk_event_type in ('open', 'click')`, (s) => {
            s.return(sql`json_build_object(
              'ok', true, 'ignored', true,
              'reason', 'engagement_tracking_disabled'
            )`);
          });
        }
        s.defScalar(
          "bulk_event_terminal_bounce",
          sql`coalesce(
            try_cast(bulk_platform_event->>'terminal_bounce' as bool),
            try_cast(bulk_platform_event->>'terminal' as bool),
            false
          )`,
        );
        s.if(sql`bulk_event_type in ('bounce', 'complaint')`, (s) => {
          s.logError(
            sql`json_build_object(
            'received_at', now(), 'occurred_at', bulk_event_occurred_at,
            'event_key', bulk_event_key, 'event_type', bulk_event_type,
            'provider', bulk_event_provider,
            'provider_message_id', bulk_platform_event->>'provider_message_id',
            'delivery_id', bulk_event_recipient.delivery_id,
            'recipient_id', bulk_event_recipient.id,
            'bounce_type', bulk_platform_event->>'bounce_type',
            'bounce_type_code', bulk_platform_event->>'bounce_type_code',
            'terminal_bounce', bulk_event_terminal_bounce,
            'detail', bulk_platform_event->>'detail'
          )::string`,
            sql.lit`bulk_email_delivery_event`,
          );
        });
        s.startTransaction();
        this.applyRecipientEvent(s, {
          recipientId: sql`bulk_event_recipient.id`,
          eventType: sql`bulk_event_type`,
          occurredAt: sql`bulk_event_occurred_at`,
          detail: sql`nullif(bulk_platform_event->>'detail', '')`,
          terminalBounce: sql`bulk_event_terminal_bounce`,
          sourceEventKey: sql`bulk_event_key`,
        });
        s.commitTransaction();
        s.return(sql`json_build_object('ok', true)`);
      },
    });
  }

  private defineSchema() {
    system.enum_({
      name: "bulk_email_delivery_status",
      values: ["held", "prepared", "submitting", "submitted", "failed"],
    });
    system.enum_({
      name: "bulk_email_recipient_status",
      values: ["pending", "submitted", "failed", "send_unknown", "excluded"],
    });

    system.db.table("bulk_email_deliveries", (table) => {
      table.description(
        "One platform bulk delivery with a frozen audience and shared content finalized before release.",
      );
      table.sampleData({ skipSampleData: true });
      table.string("source", 100).notNull();
      table.string("source_record_key", 200).notNull();
      table.string("from_email", 500).notNull();
      table.string("reply_to_email", 500);
      table.string("subject_template", 1000);
      table.string("html_template", 10_000_000).multiline();
      table.string("text_template", 10_000_000).multiline();
      table.enum("status", "bulk_email_delivery_status").notNull().default(
        sql.lit`prepared`,
      );
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("completed_at");
      table.string("provider", 50);
      table.string("provider_bulk_id", 200);
      table.string("error", 2000);
      table.string("submission_attempt_id", 100);
      table.tinyUint("submission_attempt_count").notNull().default(0);
      table.string("request_hash", 64);
      table.timestampUtc("next_attempt_at");
      table.timestampUtc("submission_deadline_at");
      table.timestampUtc("terminal_callback_completed_at");
      table.unique(["source", "source_record_key"]);
      table.check({
        fields: [
          "status",
          "subject_template",
          "html_template",
          "text_template",
        ],
        check: ([status, subject, html, text]) =>
          sql`${status} = ${checkString("held")} or (
            ${subject} is not null
            and (${html} is not null or ${text} is not null)
          )`,
        errorMessage: () =>
          sql
            .lit`Released bulk delivery requires a subject and HTML or text content`,
      });
      table.skipAutoApi();
    });

    if (this.opts.attachments !== false) {
      system.db.table("bulk_email_delivery_attachments", (table) => {
        table.description(
          "Blob-backed attachments shared by one immutable bulk delivery.",
        );
        table.sampleData({ skipSampleData: true });
        table.fk("delivery_id", "bulk_email_deliveries").notNull().onDelete(
          "Restrict",
        );
        table.string("name", 255).notNull();
        table.blobRef("blob").notNull();
        table.string("content_type", 100).notNull();
        table.skipAutoApi();
      });
    }

    system.db.table("bulk_email_delivery_recipients", (table) => {
      table.description(
        "One canonical recipient and its compact delivery-result aggregates.",
      );
      table.sampleData({ skipSampleData: true });
      table.fk("delivery_id", "bulk_email_deliveries").notNull().onDelete(
        "Restrict",
      );
      table.string("source_recipient_key", 200).notNull();
      // Missing addresses are retained as excluded recipients, including more
      // than one missing address in the same delivery's unique email key.
      table.email("email");
      table.json("variables").notNull().default(sql`json_build_object()`);
      table.enum("status", "bulk_email_recipient_status").notNull().default(
        sql.lit`pending`,
      );
      table.timestampUtc("submitted_at");
      table.timestampUtc("delivered_at");
      if (this.opts.engagementTracking !== false) {
        table.timestampUtc("first_opened_at");
        table.timestampUtc("first_clicked_at");
      }
      table.timestampUtc("first_bounced_at");
      table.timestampUtc("hard_bounced_at");
      table.timestampUtc("complained_at");
      table.timestampUtc("unsubscribed_at");
      table.string("unsubscribe_token", UNSUBSCRIBE_TOKEN_HEX_LENGTH);
      table.string("error", 2000);
      table.unique(["delivery_id", "source_recipient_key"]);
      table.unique(["delivery_id", "email"]);
      table.skipAutoApi();
    });

    system.db.table("bulk_email_suppressions", (table) => {
      table.description(
        "System-wide bulk-email suppression; transactional email is unaffected.",
      );
      table.sampleData({ skipSampleData: true });
      table.email("email").notNull().unique();
      table.string("reason", 20).notNull();
      table.string("source_event_key", 500);
      table.string("detail", 2000);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.skipAutoApi();
    });
  }

  enqueue<T extends IServerBaseStatements>(
    s: T,
    source: BulkEmailDeliverySourceConfig,
    opts: EnqueueBulkEmailDeliveryOptions,
  ) {
    this.createDelivery(s, source, opts, false);
  }

  createHeld<T extends IServerBaseStatements>(
    s: T,
    source: BulkEmailDeliverySourceConfig,
    opts: CreateHeldBulkEmailDeliveryOptions,
  ) {
    this.createDelivery(s, source, opts, true);
  }

  private createDelivery<T extends IServerBaseStatements>(
    s: T,
    source: BulkEmailDeliverySourceConfig,
    opts: CreateBulkEmailDeliveryOptions,
    held: boolean,
  ) {
    if (opts.attachmentsQuery && this.opts.attachments === false) {
      throw new Error("Bulk email attachments are disabled for this block");
    }
    const prefix = `bulk_email_enqueue_${this.enqueueSequence++}`;
    const candidates = `${prefix}_recipients`;
    const attachments = `${prefix}_attachments`;
    const existingId = `${prefix}_existing_id`;
    s.defScalar(opts.deliveryIdScalar, { type: "BigInt" });
    s.defScalar(
      existingId,
      sql`(select id from bulk_email_deliveries
           where source = ${sql.lit(source.key)}
             and source_record_key = cast(${opts.sourceRecordKey} as string))`,
    );
    s.if(sql`${sql.ref(existingId)} is not null`, (s) => {
      s.setScalar(opts.deliveryIdScalar, sql.ref(existingId));
    }).else((s) => {
      s.modify(sql`insert into bulk_email_deliveries (
          source, source_record_key, from_email, reply_to_email,
          subject_template, html_template, text_template, status
        ) values (
          ${sql.lit(source.key)}, cast(${opts.sourceRecordKey} as string),
          ${opts.from}, ${opts.replyTo ?? sql`null`},
          ${held ? sql`null` : opts.subjectTemplate ?? sql`null`},
          ${held ? sql`null` : opts.htmlTemplate ?? sql`null`},
          ${held ? sql`null` : opts.textTemplate ?? sql`null`},
          ${held ? sql.lit`held` : sql.lit`prepared`}
        )
        on conflict (source, source_record_key) do nothing`);
      s.setScalar(
        opts.deliveryIdScalar,
        sql`(select id from bulk_email_deliveries
          where source = ${sql.lit(source.key)}
            and source_record_key = cast(${opts.sourceRecordKey} as string))`,
      );
      s.defTable(candidates, { fields: bulkRecipientFields });
      s.modify(
        sql`insert into ${sql.ref(candidates)} select
              cast(candidate.source_recipient_key as string) as source_recipient_key,
              nullif(lower(trim(candidate.email)), '') as email,
              coalesce(candidate.variables, json_build_object()) as variables
            from (${opts.recipientsQuery}) candidate
            limit ${MAX_BULK_EMAIL_RECIPIENTS + 1}`,
      );
      s.callStoredProcedure("bulk_email_validate_recipients", {
        inputTables: { recipients: candidates },
      });
      s.defTable(attachments, { fields: bulkAttachmentFields });
      if (opts.attachmentsQuery) {
        s.modify(
          sql`insert into ${
            sql.ref(attachments)
          } select attachment.name, attachment.blob, attachment.content_type
            from (${opts.attachmentsQuery}) attachment
            limit ${MAX_ATTACHMENTS_PER_DELIVERY + 1}`,
        );
        s.throwErrorIf(
          sql`(select count(*) from ${
            sql.ref(attachments)
          }) > ${MAX_ATTACHMENTS_PER_DELIVERY}`,
          sql.lit`Bulk delivery exceeds the attachment count limit`,
        );
      }
      s.callStoredProcedure("bulk_email_store_recipients", {
        inputScalars: { p_delivery_id: sql.ref(opts.deliveryIdScalar) },
        inputTables: { recipients: candidates, attachments },
      });
    });
  }

  releaseHeld<T extends IServerBaseStatements>(
    s: T,
    source: BulkEmailDeliverySourceConfig,
    opts: ReleaseHeldBulkEmailDeliveryOptions,
  ) {
    s.defScalar(opts.releasedDeliveryIdScalar, { type: "BigInt" });
    s.modify(sql`update bulk_email_deliveries
      set subject_template = ${opts.subjectTemplate},
          html_template = ${opts.htmlTemplate ?? sql`null`},
          text_template = ${opts.textTemplate ?? sql`null`},
          status = 'prepared'
      where id = ${opts.deliveryId}
        and source = ${sql.lit(source.key)}
        and status = 'held'
        and ${opts.subjectTemplate} is not null
        and (${opts.htmlTemplate ?? sql`null`} is not null
          or ${opts.textTemplate ?? sql`null`} is not null)
      returning id into ${sql.ref(opts.releasedDeliveryIdScalar)}`);
  }

  discardHeld<T extends IServerBaseStatements>(
    s: T,
    source: BulkEmailDeliverySourceConfig,
    deliveryId: AnyExpr,
  ) {
    const heldDelivery = sql`select id from bulk_email_deliveries
        where id = ${deliveryId}
          and source = ${sql.lit(source.key)}
          and status = 'held'`;
    if (this.opts.attachments !== false) {
      s.modify(sql`delete from bulk_email_delivery_attachments
        where delivery_id in (${heldDelivery})`);
    }
    s.modify(sql`delete from bulk_email_delivery_recipients
      where delivery_id in (${heldDelivery})`);
    s.modify(sql`delete from bulk_email_deliveries
      where id in (${heldDelivery})`);
  }

  summaryQuery(deliveryId: Sql, sourceKey?: string) {
    const engagementCounts = this.opts.engagementTracking === false
      ? sql``
      : sql`,
        count(case when recipient.first_opened_at is not null then 1 end) as opened_count,
        count(case when recipient.first_clicked_at is not null then 1 end) as clicked_count`;
    return sql`select
        delivery.id, delivery.source, delivery.source_record_key,
        delivery.status, delivery.provider, delivery.provider_bulk_id,
        delivery.error, delivery.created_at, delivery.completed_at,
        count(recipient.id) as recipient_count,
        count(case when recipient.status = 'submitted' then 1 end) as submitted_count,
        count(case when recipient.status = 'excluded' then 1 end) as excluded_count,
        count(case when recipient.status = 'failed' then 1 end) as failed_count,
        count(case when recipient.status = 'send_unknown' then 1 end) as send_unknown_count,
        count(case when recipient.delivered_at is not null then 1 end) as delivered_count,
        count(case when recipient.hard_bounced_at is not null then 1 end) as hard_bounced_count,
        count(case when recipient.complained_at is not null then 1 end) as complained_count
        ${engagementCounts}
      from bulk_email_deliveries delivery
      left join bulk_email_delivery_recipients recipient
        on recipient.delivery_id = delivery.id
      where delivery.id = ${deliveryId}
        ${sourceKey ? sql`and delivery.source = ${sql.lit(sourceKey)}` : sql``}
      group by delivery.id, delivery.source, delivery.source_record_key,
        delivery.status, delivery.provider, delivery.provider_bulk_id,
        delivery.error, delivery.created_at, delivery.completed_at`;
  }

  private submissionEvidence(recipient?: Sql): Sql {
    const field = (name: string) =>
      recipient ? sql`${recipient}.${sql.ref(name)}` : sql.ref(name);
    return sql`(${field("submitted_at")} is not null
      or ${field("delivered_at")} is not null
      or ${field("first_bounced_at")} is not null
      or ${field("complained_at")} is not null
      ${
      this.opts.engagementTracking === false ? sql`` : sql`
        or ${field("first_opened_at")} is not null
        or ${field("first_clicked_at")} is not null`
    })`;
  }

  /** Caller must authorize the operator and hold a transaction. Never sends mail. */
  reconcileRecipient<T extends IServerBaseStatements>(s: T, opts: {
    deliveryId: AnyExpr;
    recipientId: AnyExpr;
    outcome: "submitted" | "not_sent";
    evidence: AnyExpr;
  }) {
    s.throwErrorUnless(
      sql`length(trim(coalesce(cast(${opts.evidence} as string), ''))) between 10 and 1000`,
      sql
        .lit`Enter provider evidence, including a message ID or support reference (10–1000 characters). Absence of a webhook is not proof of non-delivery.`,
    );
    s.throwErrorUnless(
      sql`exists (
      select 1 from bulk_email_delivery_recipients recipient
      join bulk_email_deliveries delivery on delivery.id = recipient.delivery_id
      where recipient.id = ${opts.recipientId}
        and delivery.id = ${opts.deliveryId} and delivery.status = 'failed'
        and recipient.status = 'send_unknown'
        ${
        opts.outcome === "not_sent"
          ? sql`and not ${this.submissionEvidence(sql.ref("recipient"))}`
          : sql``
      }
    )`,
      sql
        .lit`This recipient is no longer unresolved or has evidence of sending. Refresh the delivery before reconciling.`,
    );
    s.modify(sql`update bulk_email_delivery_recipients
      set status = ${
      sql.lit(opts.outcome === "submitted" ? "submitted" : "failed")
    },
          error = ${
      sql.lit(`Reconciled ${opts.outcome}: `)
    } || trim(cast(${opts.evidence} as string))
      where id = ${opts.recipientId} and delivery_id = ${opts.deliveryId}
        and status = 'send_unknown'`);
    // The delivery's failed attempt and original terminal callback stay intact.
    // Recipient summaries represent the subsequently established outcome.
  }

  recordRecipientEvent<T extends IServerBaseStatements>(
    s: T,
    event: BulkEmailRecipientEvent,
  ) {
    const unsupportedEventType = this.opts.engagementTracking === false
      ? sql`${event.eventType} not in (
          'delivered', 'bounce', 'complaint', 'unsubscribe'
        )`
      : sql`${event.eventType} not in (
          'delivered', 'open', 'click', 'bounce', 'complaint', 'unsubscribe'
        )`;
    s.throwErrorIf(
      unsupportedEventType,
      sql.lit`Unsupported bulk email recipient event`,
    );
    s.defRecord(
      "bulk_event_recipient",
      sql`select recipient.id, recipient.delivery_id,
              recipient.source_recipient_key, recipient.email,
              delivery.source, delivery.source_record_key
          from bulk_email_delivery_recipients recipient
          join bulk_email_deliveries delivery on delivery.id = recipient.delivery_id
          where recipient.id = ${event.recipientId}`,
    );
    s.throwErrorIf(
      sql`bulk_event_recipient.id is null`,
      sql.lit`Bulk email event does not match a recipient`,
    );
    s.startTransaction();
    this.applyRecipientEvent(s, event);
    s.commitTransaction();
  }

  private applyRecipientEvent<T extends IServerBaseStatements>(
    s: T,
    event: BulkEmailRecipientEvent & {
      sourceEventKey?: AnyExpr;
    },
  ) {
    s.callStoredProcedure("bulk_email_apply_recipient_event", {
      inputScalars: {
        p_recipient_id: event.recipientId,
        p_event_type: event.eventType,
        p_occurred_at: event.occurredAt,
        p_detail: event.detail ?? sql.null,
        p_terminal_bounce: event.terminalBounce ?? sql`false`,
        p_source_event_key: event.sourceEventKey ?? sql.null,
        p_delivery_id: sql`bulk_event_recipient.delivery_id`,
        p_source: sql`bulk_event_recipient.source`,
        p_source_record_key: sql`bulk_event_recipient.source_record_key`,
        p_source_recipient_key: sql`bulk_event_recipient.source_recipient_key`,
        p_email: sql`bulk_event_recipient.email`,
      },
    });
  }

  private applyRecipientEventStatements<T extends IServerBaseStatements>(
    s: T,
    event: BulkEmailRecipientEvent & {
      sourceEventKey?: AnyExpr;
    },
  ) {
    const terminalBounce = event.terminalBounce ?? sql`false`;
    const provesSubmission = this.opts.engagementTracking === false
      ? sql`${event.eventType} in ('delivered', 'bounce', 'complaint')`
      : sql`${event.eventType} in ('delivered', 'bounce', 'complaint', 'open', 'click')`;
    const engagementShouldApply = this.opts.engagementTracking === false
      ? sql``
      : sql`
        or (${event.eventType} = 'open'
          and (first_opened_at is null or ${event.occurredAt} < first_opened_at))
        or (${event.eventType} = 'click'
          and (first_clicked_at is null or ${event.occurredAt} < first_clicked_at))`;
    const engagementUpdates = this.opts.engagementTracking === false
      ? sql``
      : sql`,
          first_opened_at = case when ${event.eventType} = 'open'
            and (first_opened_at is null or ${event.occurredAt} < first_opened_at)
            then ${event.occurredAt} else first_opened_at end,
          first_clicked_at = case when ${event.eventType} = 'click'
            and (first_clicked_at is null or ${event.occurredAt} < first_clicked_at)
            then ${event.occurredAt} else first_clicked_at end`;
    const shouldApply = sql`(
      (${event.eventType} = 'delivered'
        and (delivered_at is null or ${event.occurredAt} < delivered_at))
      ${engagementShouldApply}
      or (${event.eventType} = 'bounce' and (
        first_bounced_at is null or ${event.occurredAt} < first_bounced_at
        or (coalesce(${terminalBounce}, false)
          and (hard_bounced_at is null or ${event.occurredAt} < hard_bounced_at))
      ))
      or (${event.eventType} = 'complaint'
        and (complained_at is null or ${event.occurredAt} < complained_at))
      or (${event.eventType} = 'unsubscribe'
        and (unsubscribed_at is null or ${event.occurredAt} < unsubscribed_at))
    )`;
    const suppressionReason = sql`case
      when ${event.eventType} = 'unsubscribe' then 'unsubscribe'
      when ${event.eventType} = 'complaint' then 'complaint'
      when ${event.eventType} = 'bounce'
        and coalesce(${terminalBounce}, false)
        then 'terminal_bounce'
      else null end`;
    s.defScalar("bulk_event_updated_recipient_id", { type: "BigInt" });
    s.modify(sql`update bulk_email_delivery_recipients
      set status = case when ${provesSubmission}
            and status in ('send_unknown', 'failed')
            then 'submitted'::enums.bulk_email_recipient_status else status end,
          delivered_at = case when ${event.eventType} = 'delivered'
            and (delivered_at is null or ${event.occurredAt} < delivered_at)
            then ${event.occurredAt} else delivered_at end,
          first_bounced_at = case when ${event.eventType} = 'bounce'
            and (first_bounced_at is null or ${event.occurredAt} < first_bounced_at)
            then ${event.occurredAt} else first_bounced_at end,
          hard_bounced_at = case when ${event.eventType} = 'bounce'
            and coalesce(${terminalBounce}, false)
            and (hard_bounced_at is null or ${event.occurredAt} < hard_bounced_at)
            then ${event.occurredAt} else hard_bounced_at end,
          complained_at = case when ${event.eventType} = 'complaint'
            and (complained_at is null or ${event.occurredAt} < complained_at)
            then ${event.occurredAt} else complained_at end,
          unsubscribed_at = case when ${event.eventType} = 'unsubscribe'
            and (unsubscribed_at is null or ${event.occurredAt} < unsubscribed_at)
            then ${event.occurredAt} else unsubscribed_at end,
          error = case when ${event.eventType} in ('complaint', 'bounce')
            then coalesce(${event.detail ?? sql`cast(null as string)`}, error)
            when ${provesSubmission} and status in ('send_unknown', 'failed')
              and first_bounced_at is null and complained_at is null then null
            else error end
          ${engagementUpdates}
      where id = ${event.recipientId}
        and (${shouldApply} or (status in ('send_unknown', 'failed')
          and ${provesSubmission}))
      returning id into bulk_event_updated_recipient_id`);
    s.if(sql`bulk_event_updated_recipient_id is not null`, (s) => {
      s.if(sql`${suppressionReason} is not null`, (s) => {
        s.modify(sql`insert into bulk_email_suppressions (
            email, reason, source_event_key, detail
          ) values (
            lower(trim(bulk_event_recipient.email)), ${suppressionReason},
            ${event.sourceEventKey ?? sql`null`},
            ${event.detail ?? sql`null`}
          ) on conflict (email) do nothing`);
      });
      for (const source of this.sources) {
        if (!source.onRecipientEvent) continue;
        s.if(sql`bulk_event_recipient.source = ${sql.lit(source.key)}`, (s) => {
          source.onRecipientEvent!(s, {
            deliveryId: sql`bulk_event_recipient.delivery_id`,
            sourceRecordKey: sql`bulk_event_recipient.source_record_key`,
            sourceRecipientKey: sql`bulk_event_recipient.source_recipient_key`,
            email: sql`bulk_event_recipient.email`,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            detail: event.detail ?? sql`cast(null as string)`,
          });
        });
      }
    });
  }

  private initializeDelivery() {
    system.storedProcedure({
      name: "bulk_email_delivery_complete_callback",
      transaction: "standalone",
      inputScalars: [{ name: "p_delivery_id", type: "BigInt" }],
      procedure: (s) => {
        s.returnIf(sql`p_delivery_id is null`);
        s.defScalar("bulk_terminal_claimed_id", { type: "BigInt" });
        s.try({
          body: (s) => {
            s.startTransaction();
            s.modify(sql`update bulk_email_deliveries
              set terminal_callback_completed_at = now(), next_attempt_at = null
              where id = p_delivery_id and status in ('submitted', 'failed')
                and terminal_callback_completed_at is null
                and (next_attempt_at is null or next_attempt_at <= now())
              returning id into bulk_terminal_claimed_id`);
            s.if(sql`bulk_terminal_claimed_id is not null`, (s) => {
              this.invokeTerminalCallback(s, sql`bulk_terminal_claimed_id`);
            });
            s.commitTransaction();
          },
          errorName: "bulk_terminal_error",
          catch: (s) => {
            // Log before rollback clears the error record. Failed source writes
            // and the completion marker roll back together.
            s.logError(
              sql`json_build_object(
              'delivery_id', p_delivery_id, 'observed_at', now(),
              'phase', 'terminal_callback_failed',
              'retry_after_minutes', ${CALLBACK_RETRY_DELAY_MINUTES},
              'type', bulk_terminal_error.type,
              'message', left(bulk_terminal_error.message, 2000),
              'description', left(bulk_terminal_error.description, 2000)
            )::string`,
              sql.lit`bulk_email_delivery_terminal`,
            );
            s.rollbackIfInTransaction();
            s.startTransaction();
            s.modify(sql`update bulk_email_deliveries
              set next_attempt_at = date.add(minute, ${CALLBACK_RETRY_DELAY_MINUTES}, now())
              where id = p_delivery_id and status in ('submitted', 'failed')
                and terminal_callback_completed_at is null
                and (next_attempt_at is null or next_attempt_at <= now())`);
            s.commitTransaction();
          },
        });
      },
    });
    storedScheduledProc({
      name: "bulk_email_delivery_send",
      schedule: "0 */15 * * * *",
      procedure: (s) => {
        // Time alone need not wake a reactor. Retry at most one due callback
        // on the existing sweep, before submitNextDelivery's early returns.
        s.forEachQuery(
          sql`select id from bulk_email_deliveries
          where status in ('submitted', 'failed')
            and terminal_callback_completed_at is null
            and (next_attempt_at is null or next_attempt_at <= now())
          order by coalesce(next_attempt_at, completed_at, created_at), id limit 1`,
          "bulk_callback_retry",
          (s) => {
            s.callStoredProcedure("bulk_email_delivery_complete_callback", {
              inputScalars: { p_delivery_id: sql`bulk_callback_retry.id` },
            });
          },
        );
        this.submitNextDelivery(s);
      },
    });
    system.addReactor({
      name: "bulk_email_delivery_ready",
      query: sql`select id from bulk_email_deliveries
        where status = 'prepared' and (next_attempt_at is null or next_attempt_at <= now())
          and not exists (select 1 from bulk_email_deliveries active_delivery
            where active_delivery.status = 'submitting')
        order by coalesce(next_attempt_at, created_at), id limit 1`,
      recordName: "ready_bulk_delivery",
      maxConcurrent: 1,
      procedure: (s) =>
        s.if(
          sql`exists (select 1 from bulk_email_deliveries
        where id = ready_bulk_delivery.id and status = 'prepared')`,
          (s) => {
            s.callStoredProcedure("bulk_email_delivery_send_impl");
          },
        ),
    });
    system.addReactor({
      name: "bulk_email_delivery_terminal",
      query: sql`select id from bulk_email_deliveries
        where status in ('submitted', 'failed')
          and terminal_callback_completed_at is null
          and (next_attempt_at is null or next_attempt_at <= now())
        order by coalesce(next_attempt_at, completed_at, created_at), id limit 2`,
      recordName: "bulk_terminal_candidate",
      maxConcurrent: 2,
      procedure: (s) => {
        s.callStoredProcedure("bulk_email_delivery_complete_callback", {
          inputScalars: { p_delivery_id: sql`bulk_terminal_candidate.id` },
        });
      },
    });
  }

  private submitNextDelivery<T extends IServerBaseStatements>(s: T) {
    s.startTransaction();
    // Bound recovery as well as submission: an old backlog must not become
    // one transaction over every expired delivery and all of its recipients.
    s.defRecord(
      "bulk_expired_delivery",
      sql`select id from bulk_email_deliveries
        where status = 'submitting' and submission_deadline_at <= now()
        order by submission_deadline_at, id limit 1`,
    );
    s.modify(sql`update bulk_email_delivery_recipients recipient
      set status = case when ${this.submissionEvidence()} then 'submitted'::enums.bulk_email_recipient_status
            else 'send_unknown'::enums.bulk_email_recipient_status end,
          error = case when first_bounced_at is not null or complained_at is not null
            then error when ${this.submissionEvidence()} then null
            else 'Bulk submission lease expired with an unknown provider outcome' end
      where recipient.delivery_id = bulk_expired_delivery.id
        and recipient.status = 'pending'`);
    s.modify(sql`update bulk_email_deliveries
      set status = 'failed', completed_at = now(),
          submission_deadline_at = null, next_attempt_at = null,
          error = 'Bulk submission lease expired with an unknown provider outcome'
      where id = bulk_expired_delivery.id and status = 'submitting'
        and submission_deadline_at <= now()`);
    s.commitTransaction();
    s.defRecord(
      "bulk_delivery_candidate",
      sql`select id from bulk_email_deliveries
          where status = 'prepared'
            and (next_attempt_at is null or next_attempt_at <= now())
          order by coalesce(next_attempt_at, created_at), id limit 1`,
    );
    s.returnIf(sql`bulk_delivery_candidate.id is null`);
    s.defScalar("bulk_attempt_id", sql`cast(random.uuid() as string)`);
    s.defScalar("bulk_claimed_delivery_id", { type: "BigInt" });
    s.startTransaction();
    s.modify(sql`update bulk_email_deliveries
      set status = 'submitting', submission_attempt_id = bulk_attempt_id,
          submission_attempt_count = submission_attempt_count + 1,
          next_attempt_at = null,
          submission_deadline_at = date.add(minute, ${SUBMISSION_TIMEOUT_MINUTES}, now()),
          error = null
      where id = bulk_delivery_candidate.id and status = 'prepared'
        and (next_attempt_at is null or next_attempt_at <= now())
        and not exists (select 1 from bulk_email_deliveries active_delivery
          where active_delivery.status = 'submitting')
      returning id into bulk_claimed_delivery_id`);
    s.commitTransaction();
    s.returnIf(sql`bulk_claimed_delivery_id is null`);
    s.defScalar("bulk_attempt_started_at", sql`now()`);
    s.defRecord(
      "bulk_delivery_snapshot",
      sql`select id, source, source_record_key, from_email, reply_to_email,
                 subject_template, html_template, text_template,
                 submission_attempt_count, request_hash, provider_bulk_id
          from bulk_email_deliveries
          where id = bulk_claimed_delivery_id`,
    );
    s.defScalar("bulk_freeze_owner_id", { type: "BigInt" });
    s.defScalar("bulk_frozen_owner_id", { type: "BigInt" });
    s.defScalar("bulk_request_frozen", sql`false`);
    s.defScalar("bulk_recipients_json", { type: "Json" });
    s.defScalar("bulk_attachments_json", { type: "Json" });
    s.defScalar("bulk_request", { type: "Json" });
    s.defScalar("bulk_request_hash", {
      type: { type: "String", maxLength: 64 },
    });
    s.try({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`update bulk_email_deliveries
          set submission_deadline_at = date.add(minute, ${SUBMISSION_TIMEOUT_MINUTES}, now())
          where id = bulk_delivery_snapshot.id and status = 'submitting'
            and submission_attempt_id = bulk_attempt_id
            and submission_deadline_at > now()
          returning id into bulk_freeze_owner_id`);
        s.throwErrorIf(
          sql`bulk_freeze_owner_id is null`,
          sql.lit`Bulk delivery attempt no longer owns the delivery`,
        );
        this.applyFinalEligibility(s);
        s.modify(sql`update bulk_email_delivery_recipients
          set unsubscribe_token = bytes.to_hex(crypto.random_bytes(32))
          where delivery_id = bulk_delivery_snapshot.id
            and unsubscribe_token is null
            and bulk_delivery_snapshot.request_hash is null`);
        this.validateStoredDeliveryBounds(s);
        this.defineRequest(s);
        s.setScalar(
          "bulk_request_hash",
          sql`bytes.to_hex(crypto.sha256(cast(bulk_request as string)))`,
        );
        s.modify(sql`update bulk_email_deliveries
          set request_hash = coalesce(request_hash, bulk_request_hash)
          where id = bulk_delivery_snapshot.id and status = 'submitting'
            and submission_attempt_id = bulk_attempt_id
            and (request_hash is null or request_hash = bulk_request_hash)
          returning id into bulk_frozen_owner_id`);
        s.throwErrorIf(
          sql`bulk_frozen_owner_id is null`,
          sql.lit`Frozen bulk request changed between attempts`,
        );
        this.filterRecipientAddresses(s);
        // Bound the payload actually dispatched, after filtering. Frozen
        // retries still have to match their original hash before this point.
        s.throwErrorIf(
          sql`octet_length(string.to_utf8(cast(bulk_request as string))) > ${MAX_REQUEST_BYTES}`,
          sql.lit`Bulk email request exceeds the platform size limit`,
        );
        s.commitTransaction();
        s.setScalar("bulk_request_frozen", sql`true`);
      },
      errorName: "bulk_freeze_error",
      catch: (s) => {
        this.logAttempt(s, "freeze_failed", sql`bulk_freeze_error.message`);
        s.rollbackIfInTransaction();
        this.finishDelivery(s, {
          succeeded: sql`false`,
          error: sql
            .lit`Bulk request validation failed before dispatch. Consent or frozen content may have changed; inspect bulk_email_delivery_attempt logs before preparing a new delivery.`,
        });
      },
    });
    s.returnIf(sql`not bulk_request_frozen`);
    this.submitFrozenRequest(s);
  }

  private submitFrozenRequest<T extends IServerBaseStatements>(s: T) {
    s.defRecord(
      "bulk_frozen_delivery",
      sql`select id, request_hash from bulk_email_deliveries
          where id = bulk_delivery_snapshot.id and status = 'submitting'
            and submission_attempt_id = bulk_attempt_id
            and submission_deadline_at > now()`,
    );
    s.returnIf(
      sql`bulk_frozen_delivery.id is null
        or bulk_frozen_delivery.request_hash is null
        or bulk_frozen_delivery.request_hash != bulk_request_hash`,
    );
    s.if(
      sql`not exists (select 1 from bulk_email_delivery_recipients
                      where delivery_id = bulk_delivery_snapshot.id
                        and status = 'pending')`,
      (s) => {
        this.finishDelivery(s, { succeeded: sql`true` });
        s.return();
      },
    );
    s.sendBulkEmail({
      from: sql`bulk_delivery_snapshot.from_email`,
      replyTo: sql`bulk_delivery_snapshot.reply_to_email`,
      subject: sql`bulk_delivery_snapshot.subject_template`,
      htmlBody: withHtmlUnsubscribeFooter(
        sql`bulk_delivery_snapshot.html_template`,
      ),
      textBody: withTextUnsubscribeFooter(
        sql`bulk_delivery_snapshot.text_template`,
      ),
      recipientsJson: sql`bulk_recipients_json`,
      attachmentsJson: sql`bulk_attachments_json`,
      submissionKey:
        sql`'bulk-email-delivery:' || bulk_delivery_snapshot.id::text`,
      optIn: !!this.#caps?.send_emails,
      defResultJsonScalar: "bulk_result",
      defErrorJsonScalar: "bulk_error",
      mockProcedure: this.opts.platformBulkMockProcedure,
    });
    // A mock procedure can only populate the result scalar. This mirrors the
    // established service-request test seam without affecting real results.
    s.defScalar(
      "bulk_error_envelope",
      this.opts.platformBulkMockProcedure
        ? sql`coalesce(bulk_error, bulk_result->'mockError')`
        : sql`bulk_error`,
    );
    // Log every response: ownership now cannot guarantee ownership when
    // completion writes. Only bounded diagnostic fields, never bodies or recipients.
    this.logAttempt(
      s,
      "submission_response",
      sql`json_build_object(
        'provider', left(bulk_result->>'provider', 50),
        'provider_bulk_id', left(bulk_result->>'provider_bulk_id', 200),
        'status', left(bulk_result->>'status', 100),
        'dispatch_state', left(bulk_error_envelope->'details'->>'dispatch_state', 100),
        'retryable', bulk_error_envelope->>'retryable',
        'code', left(bulk_error_envelope->>'code', 200),
        'message', left(coalesce(bulk_error_envelope->>'message',
          bulk_result->>'error', bulk_result->>'message'), 2000),
        'provider_request_id', left(bulk_error_envelope->'details'->>'request_id', 200),
        'provider_code', left(bulk_error_envelope->'details'->>'code', 200),
        'provider_message', left(bulk_error_envelope->'details'->>'message', 2000)
      )::string`,
    );
    const explicitlyNotSent =
      sql`coalesce(bulk_error_envelope->'details'->>'dispatch_state', '') = 'not_sent'`;
    const safeToRetry = sql`${explicitlyNotSent}
      and coalesce(bulk_error_envelope->>'retryable', 'false') = 'true'
      and bulk_delivery_snapshot.submission_attempt_count < ${MAX_SUBMISSION_ATTEMPTS}`;
    s.if(sql`bulk_error_envelope is not null`, (s) => {
      s.if(safeToRetry, (s) => {
        this.retryDelivery(s);
      }).else((s) => {
        this.finishDelivery(s, {
          succeeded: sql`false`,
          failureStatus: sql`case when ${explicitlyNotSent}
            then 'failed'::enums.bulk_email_recipient_status
            else 'send_unknown'::enums.bulk_email_recipient_status end`,
          error: sql`coalesce(
            bulk_error_envelope->>'message',
            bulk_error_envelope->>'code',
            'Bulk submission outcome is unknown'
          )`,
        });
      });
      s.return();
    });
    s.if(
      sql`lower(coalesce(bulk_result->>'status', '')) in ('failed', 'rejected')`,
      (s) => {
        this.finishDelivery(s, {
          succeeded: sql`false`,
          failureStatus: sql.lit`failed`,
          error: sql`coalesce(
            bulk_result->>'error',
            bulk_result->>'message',
            'Bulk submission was rejected'
          )`,
        });
        s.return();
      },
    );
    s.if(sql`nullif(bulk_result->>'provider_bulk_id', '') is null`, (s) => {
      this.finishDelivery(s, {
        succeeded: sql`false`,
        failureStatus: sql.lit`send_unknown`,
        error: sql
          .lit`Bulk submission returned no provider request ID; provider outcome is unknown`,
      });
      s.return();
    });
    this.finishDelivery(s, {
      succeeded: sql`true`,
      provider: sql`bulk_result->>'provider'`,
      providerBulkId: sql`bulk_result->>'provider_bulk_id'`,
      submittedAt: sql`coalesce(
        (bulk_result->>'submitted_at')::timestamp,
        now()
      )`,
    });
  }

  private filterRecipientAddresses<T extends IServerBaseStatements>(s: T) {
    s.defTable(
      "bulk_invalid_recipients",
      sql`select id
      from bulk_email_delivery_recipients recipient
      where delivery_id = bulk_delivery_snapshot.id and status = 'pending'
        and not coalesce(
          length(recipient.email) <= 254
          and length(split_part(recipient.email, '@', 1)) <= 64
          and regex.is_match(recipient.email, ${
        sql.lit(RECIPIENT_EMAIL_PATTERN)
      }),
          false
        )`,
    );
    s.if(sql`exists (select 1 from bulk_invalid_recipients)`, (s) => {
      // The original request has already passed the frozen-hash guard. Only
      // prepared retries (created exclusively by explicit not_sent responses)
      // may refreeze after a validator upgrade. Never refreeze uncertain work
      // or a request contradicted by recipient submission evidence.
      s.throwErrorIf(
        sql`(bulk_delivery_snapshot.request_hash is not null
          and bulk_delivery_snapshot.submission_attempt_count not between 2 and ${MAX_SUBMISSION_ATTEMPTS})
          or bulk_delivery_snapshot.provider_bulk_id is not null
          or exists (select 1 from bulk_email_delivery_recipients recipient
            where delivery_id = bulk_delivery_snapshot.id
              and (status not in ('pending', 'excluded')
                or ${this.submissionEvidence(sql.ref("recipient"))}))`,
        sql
          .lit`Cannot filter a frozen bulk request without confirmed non-dispatch`,
      );
      s.modify(sql`update bulk_email_delivery_recipients
        set status = 'excluded', error = ${
        sql.lit(INVALID_RECIPIENT_EMAIL_ERROR)
      }
        where delivery_id = bulk_delivery_snapshot.id and status = 'pending'
          and id in (select id from bulk_invalid_recipients)`);
      s.setScalar(
        "bulk_recipients_json",
        sql`(select
        coalesce(json_array_agg(item.value order by item.index), json_build_array())
        from json.array_each(bulk_recipients_json) item
        where (item.value->>'recipientKey')::bigint - 1
          not in (select id from bulk_invalid_recipients))`,
      );
      s.setScalar(
        "bulk_request",
        sql`bulk_request || json_build_object(
        'recipients', bulk_recipients_json)`,
      );
      s.defScalar(
        "bulk_validated_request_hash",
        sql`bytes.to_hex(crypto.sha256(cast(bulk_request as string)))`,
      );
      s.modify(sql`update bulk_email_deliveries
        set request_hash = bulk_validated_request_hash
        where id = bulk_delivery_snapshot.id and status = 'submitting'
          and submission_attempt_id = bulk_attempt_id
          and request_hash = bulk_request_hash
        returning id into bulk_frozen_owner_id`);
      s.throwErrorIf(
        sql`bulk_frozen_owner_id is null`,
        sql.lit`Frozen bulk request changed during recipient validation`,
      );
      s.if(sql`bulk_delivery_snapshot.request_hash is not null`, (s) => {
        this.logAttempt(
          s,
          "recipient_validation_refreeze",
          sql`json_build_object(
          'previous_request_hash', bulk_request_hash,
          'validated_request_hash', bulk_validated_request_hash,
          'excluded_count', (select count(*) from bulk_invalid_recipients)
        )::string`,
        );
      });
      s.setScalar("bulk_request_hash", sql`bulk_validated_request_hash`);
    });
  }

  private applyFinalEligibility<T extends IServerBaseStatements>(s: T) {
    s.modify(sql`update bulk_email_delivery_recipients recipient
        set status = 'excluded',
            error = 'Excluded by system-wide bulk-email suppression'
        where recipient.delivery_id = bulk_delivery_snapshot.id
          and recipient.status = 'pending'
          and exists (
            select 1 from bulk_email_suppressions suppression
            where suppression.email = lower(trim(recipient.email))
          )`);
    for (const source of this.sources) {
      if (!source.isRecipientEligible) continue;
      s.if(
        sql`bulk_delivery_snapshot.source = ${sql.lit(source.key)}`,
        (s) => {
          const recipient = sql.ref("recipient");
          s.modify(sql`update bulk_email_delivery_recipients recipient
            set status = 'excluded', error = 'Excluded by source eligibility policy'
            where recipient.delivery_id = bulk_delivery_snapshot.id
              and recipient.status = 'pending'
              and not coalesce((${
            source.isRecipientEligible!(recipient)
          }), false)
              and exists (select 1 from bulk_email_deliveries delivery
                where delivery.id = bulk_delivery_snapshot.id
                  and delivery.status = 'submitting'
                  and delivery.submission_attempt_id = bulk_attempt_id)`);
        },
      );
    }
  }

  private defineRequest<T extends IServerBaseStatements>(s: T) {
    const visibleUnsubscribeUrl = this.unsubscribeUrl(
      sql`recipient.unsubscribe_token`,
    );
    const oneClickUnsubscribeUrl = this.unsubscribeUrl(
      sql`recipient.unsubscribe_token`,
      true,
    );
    s.setScalar(
      "bulk_recipients_json",
      sql`(select coalesce(json_array_agg(json_build_object(
          'recipientKey', (recipient.id + 1)::text,
          'to', recipient.email,
          'templateModel', recipient.variables || json_build_object(
            'email', recipient.email,
            'unsubscribe_url', ${visibleUnsubscribeUrl},
            'one_click_unsubscribe_url', ${oneClickUnsubscribeUrl}
          ),
          'metadata', json_build_object(
            'yolm_campaign_id', (recipient.delivery_id + 1)::text,
            'yolm_batch_id', (recipient.delivery_id + 1)::text
          ),
          'headers', json_build_array(
            json_build_object(
              'name', 'List-Unsubscribe',
              'value', '<' || ${oneClickUnsubscribeUrl} || '>, <'
                || ${visibleUnsubscribeUrl} || '>'
            ),
            json_build_object(
              'name', 'List-Unsubscribe-Post',
              'value', 'List-Unsubscribe=One-Click'
            )
          )
        ) order by recipient.id), json_build_array())
        from bulk_email_delivery_recipients recipient
        where recipient.delivery_id = bulk_delivery_snapshot.id
          and recipient.status = 'pending')`,
    );
    s.setScalar(
      "bulk_attachments_json",
      this.opts.attachments === false
        ? sql`json_build_array()`
        : sql`(select coalesce(json_array_agg(json_build_object(
          'blobHash', bytes.to_hex(blob), 'name', name, 'contentType', content_type
        ) order by id), json_build_array())
        from bulk_email_delivery_attachments
        where delivery_id = bulk_delivery_snapshot.id)`,
    );
    s.setScalar(
      "bulk_request",
      sql.jsonBuildObject({
        apiVersion: 1,
        streamIntent: "marketing",
        from: sql`bulk_delivery_snapshot.from_email`,
        replyTo: sql`bulk_delivery_snapshot.reply_to_email`,
        subject: sql`bulk_delivery_snapshot.subject_template`,
        htmlBody: withHtmlUnsubscribeFooter(
          sql`bulk_delivery_snapshot.html_template`,
        ),
        textBody: withTextUnsubscribeFooter(
          sql`bulk_delivery_snapshot.text_template`,
        ),
        recipients: sql`bulk_recipients_json`,
        attachments: sql`bulk_attachments_json`,
        submissionKey:
          sql`'bulk-email-delivery:' || bulk_delivery_snapshot.id::text`,
      }),
    );
  }

  private validateStoredDeliveryBounds<T extends IServerBaseStatements>(s: T) {
    // Character count is a lower bound on serialized bytes. Reject obviously
    // oversized bodies before allocating the recipient JSON and request copies;
    // the exact byte-size check still runs after serialization.
    s.throwErrorIf(
      sql`coalesce(length(bulk_delivery_snapshot.subject_template), 0)
        + coalesce(length(bulk_delivery_snapshot.html_template), 0)
        + coalesce(length(bulk_delivery_snapshot.text_template), 0) > ${MAX_REQUEST_BYTES}`,
      sql.lit`Bulk email request exceeds the platform size limit`,
    );
    s.throwErrorIf(
      sql`(select count(*) from bulk_email_delivery_recipients
        where delivery_id = bulk_delivery_snapshot.id
          and status = 'pending') > ${MAX_BULK_EMAIL_RECIPIENTS}`,
      sql
        .lit`Bulk delivery exceeds the current 500-recipient provider request limit`,
    );
    s.throwErrorIf(
      sql`exists (select 1
        from bulk_email_delivery_recipients
        where delivery_id = bulk_delivery_snapshot.id
          and status = 'pending'
          and octet_length(string.to_utf8(
            cast(variables as string)
          )) > ${MAX_RECIPIENT_VARIABLE_BYTES})`,
      sql.lit`Bulk delivery contains oversized recipient variables`,
    );
    if (this.opts.attachments !== false) {
      s.throwErrorIf(
        sql`(select count(*) from bulk_email_delivery_attachments
        where delivery_id = bulk_delivery_snapshot.id) > ${MAX_ATTACHMENTS_PER_DELIVERY}`,
        sql.lit`Bulk delivery exceeds the platform attachment count limit`,
      );
    }
  }

  private retryDelivery<T extends IServerBaseStatements>(s: T) {
    s.startTransaction();
    s.modify(sql`update bulk_email_deliveries
      set status = 'prepared', submission_deadline_at = null,
          next_attempt_at = date.add(minute, ${RETRY_DELAY_MINUTES}, now()),
          error = left(coalesce(bulk_error_envelope->>'message',
            bulk_error_envelope->>'code', 'Platform confirmed no dispatch; retry pending'), 2000)
      where id = bulk_delivery_snapshot.id and status = 'submitting'
        and submission_attempt_id = bulk_attempt_id
        and submission_deadline_at > now()`);
    s.commitTransaction();
  }

  private finishDelivery<T extends IServerBaseStatements>(
    s: T,
    opts: {
      succeeded: AnyExpr;
      error?: AnyExpr;
      failureStatus?: AnyExpr;
      provider?: AnyExpr;
      providerBulkId?: AnyExpr;
      submittedAt?: AnyExpr;
    },
  ) {
    s.defScalar("bulk_completed_delivery_id", { type: "BigInt" });
    s.startTransaction();
    s.modify(sql`update bulk_email_deliveries
      set status = case when ${opts.succeeded}
            then 'submitted'::enums.bulk_email_delivery_status
            else 'failed'::enums.bulk_email_delivery_status end,
          completed_at = now(),
          provider = case when ${opts.succeeded}
            then ${opts.provider ?? sql`null`} else provider end,
          provider_bulk_id = case when ${opts.succeeded}
            then ${opts.providerBulkId ?? sql`null`} else provider_bulk_id end,
          error = case when ${opts.succeeded} then null
            else ${opts.error ?? sql.lit`Platform submission failed`} end,
          submission_deadline_at = null,
          next_attempt_at = null
      where id = bulk_delivery_snapshot.id and status = 'submitting'
        and submission_attempt_id = bulk_attempt_id
        and submission_deadline_at > now()
      returning id into bulk_completed_delivery_id`);
    s.if(sql`bulk_completed_delivery_id is not null`, (s) => {
      s.modify(sql`update bulk_email_delivery_recipients
        set status = case when ${opts.succeeded} or ${this.submissionEvidence()}
              then 'submitted'::enums.bulk_email_recipient_status
              else cast(${
        opts.failureStatus ?? sql.lit`failed`
      } as enums.bulk_email_recipient_status) end,
            submitted_at = case when ${opts.succeeded}
              then coalesce(submitted_at, ${
        opts.submittedAt ?? sql`now()`
      }) else submitted_at end,
            error = case when first_bounced_at is not null or complained_at is not null
              then error
              when ${opts.succeeded} or ${this.submissionEvidence()} then null
              else ${opts.error ?? sql.lit`Platform submission failed`} end
        where delivery_id = bulk_delivery_snapshot.id and status = 'pending'`);
    });
    s.commitTransaction();
  }

  private logAttempt<T extends IServerBaseStatements>(
    s: T,
    phase: string,
    detail: AnyExpr,
  ) {
    s.logError(
      sql`json_build_object(
      'phase', ${sql.lit(phase)}, 'observed_at', now(),
      'delivery_id', bulk_delivery_snapshot.id,
      'source', bulk_delivery_snapshot.source,
      'source_record_key', bulk_delivery_snapshot.source_record_key,
      'attempt_id', bulk_attempt_id,
      'attempt_count', bulk_delivery_snapshot.submission_attempt_count,
      'request_hash', coalesce(bulk_request_hash, bulk_delivery_snapshot.request_hash),
      'submission_key', 'bulk-email-delivery:' || bulk_delivery_snapshot.id::string,
      'elapsed_seconds', date.diff(second, bulk_attempt_started_at, now()),
      'detail', left(cast(${detail} as string), 6000)
    )::string`,
      sql.lit`bulk_email_delivery_attempt`,
    );
  }

  private invokeTerminalCallback<T extends IServerBaseStatements>(
    s: T,
    deliveryId: AnyExpr,
  ) {
    const callbackSources = this.sources.filter((source) =>
      source.onSubmissionTerminal
    );
    if (callbackSources.length === 0) return;
    s.defRecord(
      "bulk_terminal_delivery",
      sql`select source, source_record_key, status
          from bulk_email_deliveries where id = ${deliveryId}`,
    );
    for (const source of callbackSources) {
      s.if(sql`bulk_terminal_delivery.source = ${sql.lit(source.key)}`, (s) => {
        source.onSubmissionTerminal!(s, {
          deliveryId,
          sourceRecordKey: sql`bulk_terminal_delivery.source_record_key`,
          succeeded: sql`bulk_terminal_delivery.status = 'submitted'`,
        });
      });
    }
  }
}
