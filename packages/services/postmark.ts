import { getStaticSecret } from "std/services";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, JsonBuildObjectParam, Sql } from "../std/sql_utils";
import type { IServerBaseStatements, RequestHeader } from "std/statements";

const BASE_URL = "https://api.postmarkapp.com";

/** Options for instantiating a custom {@link Postmark} client. */
export interface PostmarkOptions {
  /** Override the server token (defaults to the `POSTMARK_SERVER_TOKEN` static secret). */
  serverToken?: Sql;
}

interface PostmarkInternalOptions {
  serverToken: Sql;
}

function authHeader(opts: PostmarkInternalOptions): RequestHeader {
  return {
    name: sql.lit`X-Postmark-Server-Token`,
    value: opts.serverToken,
  };
}

/**
 * Postmark transactional email integration.
 *
 * Wraps Postmark's HTTP API in Yolm-native server statements. Handles
 * authentication (via the `POSTMARK_SERVER_TOKEN` static secret unless
 * overridden), error semantics (silent on Postmark's "invalid email"
 * 406 responses unless `emailIsCritical` is set), tracking flags, and
 * webhook lifecycle management through the nested `webhooks` manager.
 *
 * Construct one instance per server token (most apps need only the
 * exported `postmark` singleton). Use `sendEmail` and
 * `webhooks.{create,list,delete}` from inside any server-side procedure.
 *
 * @category Service
 * @see docs/services/postmark.md
 */
export class Postmark {
  #opts: PostmarkInternalOptions;
  webhooks: PostmarkWebhookManager;

  constructor(opts: PostmarkOptions = {}) {
    this.#opts = {
      serverToken: opts.serverToken ??
        getStaticSecret(sql.lit`POSTMARK_SERVER_TOKEN`),
    };
    this.webhooks = new PostmarkWebhookManager(this.#opts);
  }

  /**
   * Sends a single transactional email through Postmark from inside a
   * server-side procedure.
   *
   * Any non-200 response (including a 406 "invalid email") runs the
   * `ifFails` hook and then throws; `emailIsCritical` controls the error
   * message raised for a 406.
   */
  sendEmail<T extends IServerBaseStatements>(
    s: T,
    opts: {
      from: Sql | string;
      to: Sql;
      cc?: Sql;
      subject: Sql;
      htmlBody: Sql;
      textBody?: Sql;
      replyTo?: Sql;
      /** Postmark message tag for categorizing/filtering in the dashboard. */
      tag?: Sql;
      /** Enable open tracking for this message. */
      trackOpens?: boolean;
      /** Link-tracking mode for this message. */
      trackLinks?: "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly";
      /** Postmark message stream to send on. Defaults to the account default. */
      messageStream?: Sql;
      /** When true, a 406 ("invalid email") response raises a specific "check the email address" error instead of the generic send-failure error. */
      emailIsCritical?: BooleanExpr;
      /** Statements run when the send fails (either branch of a 406, and on other errors). */
      ifFails?: (s: T) => void;
      /** Custom email headers serialized into Postmark's JSON `Headers` field. */
      headers?: {
        name: Sql;
        value: Sql;
      }[];
      /** File attachments: a prebuilt JSON array Sql, or per-file `{Name, Content, ContentType}` objects. */
      attachments?:
        | Sql
        | {
          Name: Sql;
          Content: Sql;
          ContentType: Sql;
          Disposition?: "inline" | Sql;
        }[];
      optIn?: BooleanExpr;
    },
  ) {
    const payload: JsonBuildObjectParam = {
      From: opts.from,
      To: opts.to,
      Cc: opts.cc,
      Subject: opts.subject,
      HtmlBody: opts.htmlBody,
    };

    if (opts.textBody) {
      payload.TextBody = opts.textBody;
    }
    if (opts.replyTo) {
      payload.ReplyTo = opts.replyTo;
    }
    if (opts.tag) {
      payload.Tag = opts.tag;
    }
    if (opts.trackOpens !== undefined) {
      payload.TrackOpens = opts.trackOpens;
    }
    if (opts.trackLinks) {
      payload.TrackLinks = opts.trackLinks;
    }
    if (opts.messageStream) {
      payload.MessageStream = opts.messageStream;
    }
    if (opts.headers && opts.headers.length > 0) {
      payload.Headers = opts.headers.map((header) => ({
        Name: header.name,
        Value: header.value,
      }));
    }
    if (Array.isArray(opts.attachments)) {
      if (opts.attachments.length > 0) {
        payload.Attachments = opts.attachments;
      }
    } else if (opts.attachments) {
      payload.Attachments = opts.attachments;
    }

    s.request({
      uri: sql.lit`${BASE_URL}/email`,
      method: "POST",
      optIn: opts.optIn,
      headers: [
        authHeader(this.#opts),
        { name: sql.lit`Accept`, value: sql.lit`application/json` },
      ],
      json: payload,
      receiveJson: "body",
      responseRecord: "response",
    });
    s.if(sql`response.status = 406`, (s) => {
      s.conditional({
        condition: opts.emailIsCritical
          ? sql`${opts.emailIsCritical}`
          : sql`false`,
        then: (s) => {
          s.debugExpr(sql`body`);
          opts.ifFails?.(s);
          s.throwError(
            sql
              .lit`Email address was not found, please check the email address and try again`,
          );
        },
        else: (s) => {
          opts.ifFails?.(s);
        },
      });
    });
    s.if(sql`response.status != 200`, (s) => {
      opts.ifFails?.(s);
      s.debugExpr(sql`body`);
      s.throwError(
        sql`'Failed to send email via Postmark. Status: ' || response.status || ', Error: ' || (body->>'Message')`,
      );
    });
  }
}

/**
 * Manages Postmark webhook subscriptions, accessed via `postmark.webhooks`.
 * Provides `create` / `list` / `delete` against Postmark's `/webhooks`
 * endpoint for the account's message streams.
 *
 * @category Service
 */
export class PostmarkWebhookManager {
  constructor(private opts: PostmarkInternalOptions) {}

  /**
   * Creates a Postmark webhook subscription and writes its `{id, url,
   * message_stream}` into a procedure-scope record. Triggers default to
   * bounce + spam-complaint enabled (with content) and open/click/delivery
   * disabled; override per trigger via `triggers`.
   */
  create<T extends IServerBaseStatements>(
    s: T,
    opts: {
      url: Sql;
      /** Message stream the webhook applies to. Defaults to `outbound`. */
      messageStream?: Sql;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
      /** Basic-auth credentials Postmark sends when calling the webhook URL. */
      httpAuth?: {
        username: Sql;
        password: Sql;
      };
      /** Extra HTTP headers Postmark sends when calling the webhook URL. */
      httpHeaders?: Array<{
        name: Sql;
        value: Sql;
      }>;
      /** Per-event enablement; unspecified triggers fall back to the defaults noted above. */
      triggers?: {
        bounce?: {
          enabled: boolean;
          includeContent?: boolean;
        };
        spamComplaint?: {
          enabled: boolean;
          includeContent?: boolean;
        };
        open?: {
          enabled: boolean;
          postFirstOpenOnly?: boolean;
        };
        click?: {
          enabled: boolean;
        };
        delivery?: {
          enabled: boolean;
        };
      };
      /** Procedure-scope record to receive the created webhook. Defaults to `webhook`. */
      responseRecord?: string;
    },
  ) {
    const responseRecord = opts.responseRecord ?? "webhook";

    const payload: JsonBuildObjectParam = {
      Url: opts.url,
      MessageStream: opts.messageStream ?? sql.lit`outbound`,
      Triggers: {
        Bounce: {
          Enabled: opts.triggers?.bounce?.enabled ?? true,
          IncludeContent: opts.triggers?.bounce?.includeContent ?? true,
        },
        SpamComplaint: {
          Enabled: opts.triggers?.spamComplaint?.enabled ?? true,
          IncludeContent: opts.triggers?.spamComplaint?.includeContent ?? true,
        },
        Open: {
          Enabled: opts.triggers?.open?.enabled ?? false,
          PostFirstOpenOnly: opts.triggers?.open?.postFirstOpenOnly ?? true,
        },
        Click: {
          Enabled: opts.triggers?.click?.enabled ?? false,
        },
        Delivery: {
          Enabled: opts.triggers?.delivery?.enabled ?? false,
        },
      },
    };

    if (opts.httpAuth) {
      payload.HttpAuth = {
        Username: opts.httpAuth.username,
        Password: opts.httpAuth.password,
      };
    }

    if (opts.httpHeaders && opts.httpHeaders.length > 0) {
      payload.HttpHeaders = opts.httpHeaders.map((h) => ({
        Name: h.name,
        Value: h.value,
      }));
    }

    s.request({
      uri: sql.lit`${BASE_URL}/webhooks`,
      method: "POST",
      optIn: opts.optIn,
      headers: [
        authHeader(this.opts),
        { name: sql.lit`Accept`, value: sql.lit`application/json` },
      ],
      json: payload,
      receiveJson: "body",
      responseRecord: "response",
    });

    s.if(sql`response.status != 200`, (s) => {
      s.debugExpr(sql`body`);
      s.throwError(
        sql`'Failed to create Postmark webhook. Status: ' || response.status || ', Error: ' || (body->>'Message')`,
      );
    });

    s.defRecord(
      responseRecord,
      sql`select body->>'ID' as id, body->>'Url' as url, body->>'MessageStream' as message_stream`,
    );
  }

  /**
   * Lists the account's webhook subscriptions into a procedure-scope table,
   * one row per webhook with its id, URL, stream, and per-trigger enabled
   * flags. Filter to one stream with `messageStream`.
   */
  list<T extends IServerBaseStatements>(
    s: T,
    opts: {
      /** Restrict the listing to a single message stream. */
      messageStream?: Sql;
      /** Procedure-scope table to receive the webhook rows. Defaults to `webhooks`. */
      webhooksTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ) {
    const webhooksTable = opts.webhooksTable ?? "webhooks";

    s.defTable(webhooksTable, {
      fields: [
        { name: "id", type: { type: "String", maxLength: 100 } },
        { name: "url", type: { type: "String", maxLength: 500 } },
        { name: "message_stream", type: { type: "String", maxLength: 100 } },
        { name: "bounce_enabled", type: "Bool" },
        { name: "spam_complaint_enabled", type: "Bool" },
        { name: "open_enabled", type: "Bool" },
        { name: "click_enabled", type: "Bool" },
        { name: "delivery_enabled", type: "Bool" },
      ],
    });

    const uri = opts.messageStream
      ? sql`${BASE_URL}/webhooks?MessageStream=${opts.messageStream}`
      : sql.lit`${BASE_URL}/webhooks`;

    s.request({
      uri,
      method: "GET",
      optIn: opts.optIn,
      headers: [
        authHeader(this.opts),
        { name: sql.lit`Accept`, value: sql.lit`application/json` },
      ],
      receiveJson: "body",
      responseRecord: "response",
    });

    s.if(sql`response.status != 200`, (s) => {
      s.throwError(
        sql`'Failed to list Postmark webhooks. Status: ' || response.status`,
      );
    });

    s.modify(
      sql`insert into ${sql.ref(webhooksTable)} (
        id, url, message_stream,
        bounce_enabled, spam_complaint_enabled,
        open_enabled, click_enabled, delivery_enabled
      )
      select
        value->>'ID',
        value->>'Url',
        value->>'MessageStream',
        (value->'Triggers'->'Bounce'->>'Enabled')::bool,
        (value->'Triggers'->'SpamComplaint'->>'Enabled')::bool,
        (value->'Triggers'->'Open'->>'Enabled')::bool,
        (value->'Triggers'->'Click'->>'Enabled')::bool,
        (value->'Triggers'->'Delivery'->>'Enabled')::bool
      from json.array_each(body->'Webhooks')`,
    );
  }

  /**
   * Deletes a webhook subscription by id. Treats a 404 as success so the
   * call is idempotent.
   */
  delete<T extends IServerBaseStatements>(
    s: T,
    webhookId: Sql,
    opts?: {
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    },
  ) {
    s.request({
      uri: sql.concat(sql.lit`${BASE_URL}/webhooks/`, webhookId),
      method: "DELETE",
      optIn: opts?.optIn,
      headers: [
        authHeader(this.opts),
        { name: sql.lit`Accept`, value: sql.lit`application/json` },
      ],
      responseRecord: "response",
    });

    s.if(sql`response.status not in (200, 204, 404)`, (s) => {
      s.throwError(
        sql`'Failed to delete Postmark webhook. Status: ' || response.status`,
      );
    });
  }
}

/**
 * Shared {@link Postmark} client using the default `POSTMARK_SERVER_TOKEN`
 * static secret. Construct a fresh {@link Postmark} only when you need a
 * different server token.
 *
 * @category Service
 */
export const postmark = new Postmark();
