import { getStaticSecret, queryParamsString } from "std/services";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import { EndpointStatements } from "std/statements";
import type {
  EndpointStatementsOrFn,
  GenericServerStatementsFn,
  HelperProcField,
  RequestHeader,
} from "std/statements";
import { system } from "std/system";

const BASE_URL = "https://api.calendly.com";

/** Options for instantiating a custom {@link Calendly} client. */
export interface CalendlyOptions {
  /** Override the API key (defaults to the `CALENDLY_API_KEY` static secret). */
  apiKey?: Sql;
  /** Override the webhook base name (defaults to `"calendly"`). */
  webhookBaseName?: string;
}

interface CalendlyInternalOptions {
  apiKey: Sql;
  webhookBaseName: string;
}

function authHeader(opts: CalendlyInternalOptions): RequestHeader {
  return {
    name: sql.lit`authorization`,
    value: sql.concat("Bearer ", opts.apiKey),
  };
}

/**
 * Calendly v2 API client. Use the default {@link calendly} singleton for
 * the standard "CALENDLY_API_KEY" / "calendly" webhook configuration, or
 * construct your own with custom {@link CalendlyOptions}.
 *
 * Exposes typed helpers under `.eventTypes` (REST), `.webhook` (manual static
 * webhook declaration), and connection helpers for procedures.
 *
 * @category Service
 */
export class Calendly {
  #opts: CalendlyInternalOptions;
  #webhook?: CalendlyWebhook;
  /** Event-type REST helpers. */
  eventTypes: CalendlyEventTypes;

  constructor(opts: CalendlyOptions = {}) {
    this.#opts = {
      apiKey: opts.apiKey ?? getStaticSecret(sql.lit`CALENDLY_API_KEY`),
      webhookBaseName: opts.webhookBaseName ?? "calendly",
    };
    // Delay webhook initialization to avoid forward reference
    // this.webhook will be initialized on first access
    this.eventTypes = new CalendlyEventTypes(this.#opts);
  }

  get webhook(): CalendlyWebhook {
    if (!this.#webhook) {
      this.#webhook = new CalendlyWebhook(this.#opts);
    }
    return this.#webhook;
  }
}

/**
 * Helpers for Calendly's `event_types` REST resource. Accessed via
 * `calendly.eventTypes.*`. Provides a single paged {@link CalendlyEventTypes.list | list}
 * and a {@link CalendlyEventTypes.listAll | listAll} convenience that walks
 * every page into one procedure-scope table.
 *
 * @category Service
 */
export class CalendlyEventTypes {
  constructor(private opts: CalendlyInternalOptions) {}

  get #resultFields(): HelperProcField[] {
    return [
      {
        name: "active",
        type: "Bool",
      },
      {
        name: "uri",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "scheduling_url",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "name",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "profile_type",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "profile_name",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "profile_owner",
        type: { type: "String", maxLength: 65_000 },
      },
    ];
  }

  /**
   * Fetches a single page of event types into a procedure-scope table and a
   * pagination record. Pass `pageToken` from the previous page's
   * `next_page_token` to advance; use {@link CalendlyEventTypes.listAll} to
   * walk every page automatically.
   */
  list(
    opts: {
      /** Page size. */
      count?: NumericExpr;
      /** Page cursor from the prior page's `pagination.next_page_token`. */
      pageToken?: Sql;
      /** Calendly organization URI to scope results to. */
      organization?: Sql;
      /** Procedure-scope table to receive event-type rows. Defaults to `event_type`. */
      resultTable?: string;
      /** Procedure-scope record to receive paging cursors. Defaults to `pagination`. */
      paginationRecord?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const paginationRecord = opts.paginationRecord ?? "pagination";
    const resultTable = opts.resultTable ?? "event_type";
    return (s) => {
      s.defRecord(paginationRecord, {
        fields: [
          {
            name: "count",
            type: "BigInt",
          },
          {
            name: "next_page_token",
            type: { type: "String", maxLength: 65_000 },
          },
          {
            name: "previous_page_token",
            type: { type: "String", maxLength: 65_000 },
          },
        ],
      });
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.request({
          uri: sql.concat(
            `${BASE_URL}/event_types?`,
            queryParamsString({
              count: opts.count,
              organization: opts.organization,
              page_token: opts.pageToken,
            }),
          ),
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.debugExpr(sql`body`);
          s.throwError(
            sql`'Received error status from list templates:' || response.status`,
          );
        });
        s.defScalar("pagination_json", sql`body->'pagination'`);
        s.modify(
          sql`insert into ${
            sql.ref(paginationRecord)
          } (count, next_page_token, previous_page_token) values (
          cast((pagination_json->'count') as bigint),
          pagination_json->>'next_page_token',
          pagination_json->>'previous_page_token'
        )`,
        );
        s.modify(sql`insert into ${sql.ref(resultTable)}
          select
            cast((value->'active') as bool) as active,
            value->>'uri' as uri,
            value->>'name' as name,
            value->>'scheduling_url' as scheduling_url,
            (value->'profile')->>'name' as profile_name,
            (value->'profile')->>'owner' as profile_owner,
            (value->'profile')->>'type' as profile_type
          from json.array_each(body->'collection')`);
      });
    };
  }

  /**
   * Loops {@link CalendlyEventTypes.list} until all pages are consumed,
   * collecting every event type into one procedure-scope table.
   */
  listAll(
    opts: {
      /** Calendly organization URI to scope results to. */
      organization?: Sql;
      /** Procedure-scope table to receive all event-type rows. Defaults to `event_type`. */
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const resultTable = opts.resultTable ?? "event_type";
    return (s) => {
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.defScalar("page_token", {
          type: { type: "String", maxLength: 500 },
        });
        s.loop((s) => {
          s.statements(
            this.list({
              organization: opts.organization,
              pageToken: sql`page_token`,
              count: 100,
              resultTable: "tmp_event_type",
              optIn: opts.optIn,
            }),
          );
          s.modify(
            sql`insert into ${
              sql.ref(resultTable)
            } select * from tmp_event_type`,
          );
          s.setScalar("page_token", sql`pagination.next_page_token`);
          s.breakIf(sql`page_token is null`);
        });
      });
    };
  }
}

/**
 * Shared {@link Calendly} client using the default
 * `CALENDLY_API_KEY` static secret and `"calendly"` webhook base name.
 * Use this in most call sites; construct a fresh {@link Calendly} only
 * when you need a non-default configuration.
 *
 * @category Service
 */
export const calendly = new Calendly();

type WebhookEvent =
  | "invitee.created"
  | "invitee.canceled"
  | "invitee_no_show.created";

function deregisterWebhook(
  apiKey: Sql,
  webhookUri: Sql,
  optIn?: BooleanExpr,
): GenericServerStatementsFn {
  return (s) => {
    s.request({
      uri: webhookUri,
      method: sql.lit`DELETE`,
      optIn,
      headers: [
        {
          name: sql.lit`authorization`,
          value: sql.concat("Bearer ", apiKey),
        },
      ],
      responseRecord: "response",
    });
    s.if(sql`response.status not in (200, 204, 404)`, (s) => {
      s.throwError(
        sql`'Received error status from deregister webhook Status: ' || response.status`,
      );
    });
  };
}

function registerWebhook(
  apiKey: Sql,
  event: WebhookEvent,
  organizationId: Sql,
  callBackUrl: Sql,
  optIn?: BooleanExpr,
): GenericServerStatementsFn {
  return (s) => {
    s.defScalar(
      "calendly_webhook_signing_key",
      getStaticSecret(sql.lit`CALENDLY_WEBHOOK_SIGNING_KEY`),
    );
    s.if(
      sql`calendly_webhook_signing_key is null or calendly_webhook_signing_key = ''`,
      (s) => {
        s.throwError(sql.lit`Calendly webhook signing key is not configured`);
      },
    );
    s.request({
      uri: sql.lit`${BASE_URL}/webhook_subscriptions`,
      method: "POST",
      optIn,
      json: {
        url: callBackUrl,
        events: [sql.lit(event)],
        organization: organizationId,
        scope: sql.lit`organization`,
        signing_key: sql`calendly_webhook_signing_key`,
      },
      receiveJson: "register_response",
      headers: [
        {
          name: sql.lit`authorization`,
          value: sql.concat("Bearer ", apiKey),
        },
      ],
      responseRecord: "response",
    });
    s.if(sql`response.status not in (201, 200)`, (s) => {
      s.throwError(
        sql`'Received error status from webhook registration. Status: ' || response.status`,
      );
    });
    s.defScalar("webhook_uri", sql`(register_response->'resource')->>'uri'`);
  };
}

function webhookHandlerPrefix() {
  const s = new EndpointStatements();
  s.defScalar(
    "calendly_webhook_signing_key",
    getStaticSecret(sql.lit`CALENDLY_WEBHOOK_SIGNING_KEY`),
  );
  s.if(
    sql`calendly_webhook_signing_key is null or calendly_webhook_signing_key = ''`,
    (s) => {
      s.setHttpStatus(503);
      s.return();
    },
  );
  s.getHeader(sql.lit`Calendly-Webhook-Signature`, "signature_header");
  s.defScalar("signature_timestamp", {
    type: "BigInt",
  });
  s.defScalar("signature", {
    type: { type: "String", maxLength: 450 },
  });
  s.forEachQuery(
    sql`select value, ordinal from string.split(signature_header, ',')`,
    "part",
    (s) => {
      s.defScalar(
        "key",
        sql`(select value from string.split(part.value, '=') where ordinal = 0)`,
      );
      s.defScalar(
        "value",
        sql`(select value from string.split(part.value, '=') where ordinal = 1)`,
      );
      s.if(sql`key = 'v1'`, (s) => {
        s.setScalar("signature", sql`value`);
      });
      s.if(sql`key = 't'`, (s) => {
        s.setScalar("signature_timestamp", sql`try_cast(value as bigint)`);
      });
    },
  );
  s.if(sql`signature_timestamp is null or signature is null`, (s) => {
    s.setHttpStatus(400);
    s.return();
  });
  s.if(
    sql`abs(date.diff(hour, date.from_epoch(signature_timestamp) at time zone 'UTC', now() at time zone 'UTC')) > 2`,
    (s) => {
      s.setHttpStatus(400);
      s.return();
    },
  );
  s.if(
    sql`crypto.verify_hmac_sha256(signature_timestamp || '.' || body::string,
      calendly_webhook_signing_key, bytes.from_hex(signature)) is not true`,
    (s) => {
      s.setHttpStatus(400);
      s.return();
    },
  );
  s.defScalar("payload_json", sql`body->'payload'`);
  s.defRecord("payload", {
    fields: [
      { name: "email", type: { type: "String", maxLength: 350 } },
      { name: "name", type: { type: "String", maxLength: 450 } },
      { name: "timezone", type: { type: "String", maxLength: 450 } },
    ],
  });
  s.modify(
    sql`insert into payload (email, name, timezone) values (payload_json->>'email', payload_json->>'name', payload_json->>'timezone')`,
  );
  s.defRecord("scheduled_event", {
    fields: [
      { name: "event_type", type: { type: "String", maxLength: 350 } },
      { name: "uri", type: { type: "String", maxLength: 450 } },
      { name: "start_time", type: "Timestamp" },
      { name: "end_time", type: "Timestamp" },
    ],
  });
  s.defScalar("scheduled_event_json", sql`payload_json->'scheduled_event'`);
  s.modify(
    sql`insert into scheduled_event (event_type, uri, start_time, end_time) values (
        scheduled_event_json->>'event_type',
        scheduled_event_json->>'uri',
        cast((scheduled_event_json->>'start_time') as timestamptz),
        cast((scheduled_event_json->>'end_time') as timestamptz)
      )`,
  );
  s.defTable("scheduled_event_membership", {
    fields: [
      { name: "user", type: { type: "String", maxLength: 350 } },
      { name: "user_email", type: { type: "String", maxLength: 450 } },
    ],
  });
  s.modify(
    sql`insert into scheduled_event_membership
        select value->>'user' as user, value->>'user_email' as user_email from json.array_each(scheduled_event_json->'event_memberships')`,
  );
  s.defRecord("tracking", {
    fields: [
      { name: "utm_campaign", type: { type: "String", maxLength: 350 } },
      { name: "utm_source", type: { type: "String", maxLength: 350 } },
    ],
  });
  s.modify(
    sql`insert into tracking (utm_campaign, utm_source) values (((payload_json->'tracking')->>'utm_campaign'), ((payload_json->'tracking')->>'utm_source'))`,
  );
  return s;
}

/** Identifies which Calendly invitee event a webhook subscribes to. */
export interface WebhookOpts {
  event: WebhookEvent;
}

/**
 * Calendly webhook endpoint and manual registration callbacks, accessed via
 * `calendly.webhook`.
 *
 * Each `invitee*` method declares a `system.staticWebhook` whose handler is
 * prefixed with shared signature verification and payload parsing. The Static
 * Webhook Management page invokes its registration/deregistration callbacks;
 * deployment does not. The incoming body is exploded into `payload`,
 * `scheduled_event`, `scheduled_event_membership`, and `tracking` procedure
 * scopes before the handler runs. Call {@link CalendlyWebhook.addDbTable} once
 * during system definition so the registration bookkeeping table exists.
 *
 * @category Service
 */
export class CalendlyWebhook {
  #opts: CalendlyInternalOptions;
  constructor(opts: CalendlyInternalOptions) {
    this.#opts = opts;
  }

  #createWebhook(
    event: WebhookEvent,
    organizationId: Sql,
    handler: EndpointStatementsOrFn,
  ) {
    const improvedHandler = webhookHandlerPrefix();
    improvedHandler.statements(handler);
    const key = `${this.#opts.webhookBaseName}-${event}`;
    system.staticWebhook({
      key,
      handler: improvedHandler,
      jsonBodyScalar: "body",
      register: (callbackUrl) => (s) => {
        registerWebhook(
          this.#opts.apiKey,
          event,
          organizationId,
          callbackUrl,
        )(s);
        s.startTransaction();
        s.modify(
          sql`insert into calendly_webhook (key, webhook_uri) values (${
            sql.lit(key)
          }, webhook_uri)`,
        );
        s.commitTransaction();
      },
      deregister: (s) => {
        s.defScalar(
          "webhook_uri",
          sql`(select webhook_uri from calendly_webhook where key = ${
            sql.lit(key)
          })`,
        );
        s.unless(sql`webhook_uri is null`, (s) => {
          deregisterWebhook(this.#opts.apiKey, sql`webhook_uri`)(s);
          s.startTransaction();
          s.modify(
            sql`delete from calendly_webhook where key = ${sql.lit(key)}`,
          );
          s.commitTransaction();
        });
      },
      webhookRegistered:
        sql`exists (select 1 from calendly_webhook where key = ${
          sql.lit(key)
        })`,
    });
  }

  /**
   * Declares the `calendly_webhook` table that tracks the registered
   * webhook URIs keyed by base-name + event. Call once at system-definition
   * time before using the `invitee*` registration helpers.
   */
  addDbTable() {
    system.db.table("calendly_webhook", (table) => {
      table.string("key", 200).notNull().unique();
      table.string("webhook_uri", 200).notNull();
    });
  }

  /** Declares an `invitee.created` webhook for the organization. */
  inviteeCreated(organizationId: Sql, handler: EndpointStatementsOrFn) {
    this.#createWebhook("invitee.created", organizationId, handler);
  }

  /** Declares an `invitee.canceled` webhook for the organization. */
  inviteeCanceled(organizationId: Sql, handler: EndpointStatementsOrFn) {
    this.#createWebhook("invitee.canceled", organizationId, handler);
  }

  /** Declares an `invitee_no_show.created` webhook for the organization. */
  inviteeNoShowCreated(
    organizationId: Sql,
    handler: EndpointStatementsOrFn,
  ) {
    this.#createWebhook("invitee_no_show.created", organizationId, handler);
  }
}

/**
 * Per-event {@link DynamicWebhook} instances for callers whose organization,
 * API key, and callback URL vary at runtime. Reach for the
 * {@link calendlyWebhooks} singleton.
 *
 * @category Service
 */
export class DynamicWebhooks {
  inviteeCreated = new DynamicWebhook("invitee.created");
  inviteeCanceled = new DynamicWebhook("invitee.canceled");
  inviteeNoShowCreated = new DynamicWebhook("invitee_no_show.created");
}

/**
 * Lower-level builder for one Calendly invitee event. Unlike
 * {@link CalendlyWebhook}, registration/deregistration and the handler are
 * returned for the caller to wire up, with runtime-supplied organization,
 * API key, and callback URL.
 *
 * @category Service
 */
export class DynamicWebhook {
  constructor(private event: WebhookEvent) {}

  /** Builds statements that register this event's webhook subscription. */
  register(organizationId: Sql, apiKey: Sql, url: Sql) {
    return registerWebhook(apiKey, this.event, organizationId, url);
  }

  /** Builds statements that delete a previously registered subscription by URI. */
  deregister(apiKey: Sql, uri: Sql) {
    return deregisterWebhook(apiKey, uri);
  }

  /**
   * Wraps a handler with the shared signature-verification and
   * payload-parsing prefix (see {@link CalendlyWebhook}) and returns the
   * resulting {@link EndpointStatements}.
   */
  handler(handler: EndpointStatementsOrFn) {
    const improvedHandler = webhookHandlerPrefix();
    improvedHandler.statements(handler);
    return improvedHandler;
  }
}

/** Shared {@link DynamicWebhooks} instance for runtime-supplied Calendly webhooks. */
export const calendlyWebhooks = new DynamicWebhooks();
