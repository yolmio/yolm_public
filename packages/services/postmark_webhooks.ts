import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { getStaticSecret } from "std/services";
import { EndpointStatements } from "std/statements";
import type {
  EndpointStatementsOrFn,
  GenericServerStatementsFn,
  IServerBaseStatements,
} from "std/statements";
import { system } from "std/system";
import { postmark } from "./postmark";

const POSTMARK_WEBHOOK_TOKEN = getStaticSecret(sql.lit`postmark`);

export type PostmarkWebhookEvent =
  | "Bounce"
  | "SpamComplaint"
  | "Open"
  | "Click"
  | "Delivery"
  | "Unsubscribe";

export type BounceType =
  | "HardBounce"
  | "SoftBounce"
  | "Transient"
  | "Unsubscribe"
  | "SpamComplaint"
  | "ISPBlock";

interface PostmarkWebhookOptions {
  webhookBaseName?: string;
  webhookToken?: Sql;
  extensions?: PostmarkWebhooksExtensions;
}

interface PostmarkWebhookInternalOptions {
  webhookBaseName: string;
  webhookToken: Sql;
  extensions?: PostmarkWebhooksExtensions;
}

export interface PostmarkWebhooksExtensions {
  onWebhookReceived?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { body: Sql },
  ) => void;
}

function webhookHandlerPrefix(opts: PostmarkWebhookInternalOptions) {
  const s = new EndpointStatements();

  opts.extensions?.onWebhookReceived?.(s, { body: sql`body` });

  // Verify webhook authenticity using token
  s.getHeader(sql.lit`X-Postmark-Token`, "webhook_token");
  s.if(sql`webhook_token != ${opts.webhookToken}`, (s) => {
    s.setHttpStatus(401);
    s.return();
  });

  // Parse the webhook payload
  s.defScalar("event_type", sql`body->>'RecordType'`);
  s.defScalar("message_id", sql`body->>'MessageID'`);
  s.defScalar("received_at", sql`now()`);

  return s;
}

export class PostmarkWebhooks {
  #opts: PostmarkWebhookInternalOptions;

  constructor(opts: PostmarkWebhookOptions = {}) {
    this.#opts = {
      webhookBaseName: opts.webhookBaseName ?? "postmark",
      webhookToken: opts.webhookToken ?? POSTMARK_WEBHOOK_TOKEN,
      extensions: opts.extensions,
    };
  }

  addDbTables() {
    // Table to track registered webhooks
    system.db.table("postmark_webhook", (table) => {
      table.string("key", 200).notNull().unique();
      table.string("webhook_id", 100).notNull();
      table.string("webhook_url", 500).notNull();
      table.timestampTz("created_at").notNull().default(sql`now()`);
    });

    system.db.table("postmark_bounce_events", (table) => {
      table.string("message_id", 200).notNull();
      table.string("email", 255).notNull();
      table.string("bounce_type", 50);
      table.string("bounce_name", 200);
      table.string("bounce_description", 1000);
      table.string("bounce_details", 2000);
      table.bool("inactive").notNull().default(false);
      table.bool("can_activate").notNull().default(false);
      table.timestampTz("bounced_at").notNull();
      table.timestampTz("created_at").notNull().default(sql`now()`);
    });

    system.db.table("postmark_spam_complaints", (table) => {
      table.string("message_id", 200).notNull();
      table.string("email", 255).notNull();
      table.timestampTz("complained_at").notNull();
      table.timestampTz("created_at").notNull().default(sql`now()`);
    });

    system.db.table("postmark_webhook_log", (table) => {
      table.string("event_type", 50).notNull();
      table.string("message_id", 200);
      table.json("payload").notNull();
      table.timestampTz("received_at").notNull().default(sql`now()`);
      table.bool("processed").notNull().default(false);
    });
  }

  bounceWebhook(handler?: EndpointStatementsOrFn) {
    const improvedHandler = webhookHandlerPrefix(this.#opts);

    // Log the webhook
    improvedHandler.modify(
      sql`insert into postmark_webhook_log (event_type, message_id, payload)
          values (event_type, message_id, body)`,
    );

    // Process bounce event
    improvedHandler.if(sql`event_type = 'Bounce'`, (s) => {
      s.defScalar("email", sql`body->>'Email'`);
      s.defScalar("bounce_type", sql`body->>'Type'`);
      s.defScalar("bounce_name", sql`body->>'Name'`);
      s.defScalar("bounce_description", sql`body->>'Description'`);
      s.defScalar("bounce_details", sql`body->>'Details'`);
      s.defScalar("inactive", sql`cast((body->>'Inactive') as bool)`);
      s.defScalar("can_activate", sql`cast((body->>'CanActivate') as bool)`);
      s.defScalar("bounced_at", sql`cast((body->>'BouncedAt') as timestamptz)`);

      s.startTransaction();

      // Insert bounce event
      s.modify(
        sql`insert into postmark_bounce_events
            (message_id, email, bounce_type, bounce_name, bounce_description,
             bounce_details, inactive, can_activate, bounced_at)
            values (message_id, email, bounce_type, bounce_name, bounce_description,
                    bounce_details, inactive, can_activate, bounced_at)`,
      );

      // Update campaign recipient status if using bulk email campaigns
      s.modify(
        sql`update email_campaign_recipients
            set status = 'bounced',
                bounced = true
            where recipient_email = email
            and status = 'sent'`,
      );

      // Insert into email_campaign_bounces table
      s.defScalar(
        "recipient_id",
        sql`(select id from email_campaign_recipients where recipient_email = email and status = 'bounced' order by id desc limit 1)`,
      );

      s.if(sql`recipient_id is not null`, (s) => {
        // Map Postmark bounce types to campaign bounce types
        s.defScalar(
          "mapped_bounce_type",
          sql`case
            when bounce_type in ('HardBounce', 'SpamComplaint') then 'hard'
            when bounce_type in ('SoftBounce', 'Transient') then 'soft'
            when bounce_type = 'ISPBlock' then 'blocked'
            else 'soft'
          end`,
        );

        s.modify(
          sql`
            insert into email_campaign_bounces (
              email_campaign_recipient_id,
              bounce_type,
              bounced_at,
              bounce_reason,
              bounce_code
            ) values (
              recipient_id,
              mapped_bounce_type::enums.email_campaign_bounce_type,
              bounced_at,
              bounce_description,
              left(bounce_type, 20)
            )
          `,
        );
      });

      s.commitTransaction();
    });

    // Process spam complaint
    improvedHandler.if(sql`event_type = 'SpamComplaint'`, (s) => {
      s.defScalar("email", sql`body->>'Email'`);
      s.defScalar(
        "complained_at",
        sql`cast((body->>'BouncedAt') as timestamptz)`,
      );

      s.startTransaction();

      // Insert spam complaint
      s.modify(
        sql`insert into postmark_spam_complaints
            (message_id, email, complained_at)
            values (message_id, email, complained_at)`,
      );

      // Update campaign recipient to mark as spam complaint
      s.modify(
        sql`update email_campaign_recipients
            set status = 'bounced',
                bounced = true,
                complained = true
            where recipient_email = email
            and status = 'sent'`,
      );

      s.defScalar(
        "recipient_id",
        sql`(select id from email_campaign_recipients where recipient_email = email and status = 'bounced' order by id desc limit 1)`,
      );

      s.if(sql`recipient_id is not null`, (s) => {
        s.modify(
          sql`
            insert into email_campaign_bounces (
              email_campaign_recipient_id,
              bounce_type,
              bounced_at,
              bounce_reason,
              bounce_code
            ) values (
              recipient_id,
              'complaint'::enums.email_campaign_bounce_type,
              complained_at,
              'Spam complaint',
              'SpamComplaint'
            )
          `,
        );
      });

      s.commitTransaction();
    });

    // Mark webhook as processed
    improvedHandler.modify(
      sql`update postmark_webhook_log
          set processed = true
          where message_id = message_id
          and event_type = event_type
          and processed = false`,
    );

    // Add custom handler if provided
    if (handler) {
      improvedHandler.statements(handler);
    }

    improvedHandler.setHttpStatus(200);

    const key = `${this.#opts.webhookBaseName}-bounce`;
    system.staticWebhook({
      key,
      handler: improvedHandler,
      jsonBodyScalar: "body",
      register: (callbackUrl) => this.registerWebhook(callbackUrl),
      deregister: this.deregisterWebhook(),
      webhookRegistered:
        sql`exists (select 1 from postmark_webhook where key = ${
          sql.lit(key)
        })`,
    });
  }

  getBounceStats(email?: Sql): EndpointStatementsOrFn {
    return (s) => {
      if (email) {
        s.defTable(
          "total_bounces",
          sql`
            select
              count(*) as total_bounces,
              sum(case when bounce_type = 'HardBounce' then 1 else 0 end) as hard_bounces,
              sum(case when bounce_type = 'SoftBounce' then 1 else 0 end) as soft_bounces,
              sum(case when bounce_type = 'SpamComplaint' then 1 else 0 end) as spam_complaints,
              max(bounced_at) as last_bounce_at
            from postmark_bounce_events
            where email = ${email}
          `,
        );
      } else {
        s.defTable(
          "stats",
          sql`
            select
              email,
              count(*) as total_bounces,
              sum(case when bounce_type = 'HardBounce' then 1 else 0 end) as hard_bounces,
              sum(case when bounce_type = 'SoftBounce' then 1 else 0 end) as soft_bounces,
              sum(case when bounce_type = 'SpamComplaint' then 1 else 0 end) as spam_complaints,
              max(bounced_at) as last_bounce_at
            from postmark_bounce_events
            group by email
            order by total_bounces desc
          `,
        );
      }
    };
  }

  private registerWebhook(callbackUrl: Sql): GenericServerStatementsFn {
    return (s) => {
      postmark.webhooks.create(s, {
        url: callbackUrl,
        httpHeaders: [{
          name: sql.lit`X-Postmark-Token`,
          value: this.#opts.webhookToken,
        }],
        triggers: {
          bounce: { enabled: true, includeContent: true },
          spamComplaint: { enabled: true, includeContent: true },
          open: { enabled: false },
          click: { enabled: false },
          delivery: { enabled: false },
        },
        responseRecord: "webhook_result",
      });

      // Store webhook registration
      s.startTransaction();
      s.modify(
        sql`insert into postmark_webhook (key, webhook_id, webhook_url)
            values (${
          sql.lit(`${this.#opts.webhookBaseName}-bounce`)
        }, webhook_result.id, webhook_result.url)`,
      );
      s.commitTransaction();
    };
  }

  private deregisterWebhook(): GenericServerStatementsFn {
    return (s) => {
      const key = `${this.#opts.webhookBaseName}-bounce`;
      s.defScalar(
        "webhook_id",
        sql`(select webhook_id from postmark_webhook where key = ${
          sql.lit(key)
        })`,
      );
      s.unless(sql`webhook_id is null`, (s) => {
        // Delete webhook via Postmark API
        postmark.webhooks.delete(s, sql`webhook_id`);

        // Remove from database
        s.startTransaction();
        s.modify(sql`delete from postmark_webhook where key = ${sql.lit(key)}`);
        s.commitTransaction();
      });
    };
  }
}

export const postmarkWebhooks = new PostmarkWebhooks();
