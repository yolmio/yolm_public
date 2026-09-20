import { CrmBlock } from "blocks/crm";
import { Alert } from "components/alert";
import { OutlookEmailIcon } from "components/icons/outlook_email";
import { Typography } from "components/typography";
import { SearchCard, SearchCardPage } from "pages/search_card_page";
import type { Oauth2TokenOpts } from "services/microsoft/auth";
import { OutlookMail } from "services/microsoft/outlook_email";
import type { GetSingleEmailOpts } from "services/microsoft/outlook_email";
import { AuthApiICtxKey } from "std/ictx";
import { singularize } from "std/inflectors";
import {
  isLocalhostHost,
  localhostAwareScheme,
  queryParamsString,
} from "std/services";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  HelperProcField,
  IServerBaseStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { system } from "std/system";
import type { App, TableBuilder } from "std/system";
import type { QueryParam } from "std/yom";
import { QueryParams, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { getCapabilities } from "std/yolm_gen_api";
import { EmailBodyFieldNode, EmailItem } from "./common";
import {
  defineOutlookParticipantSyncSchema,
  enqueueOutlookParticipantSync,
  registerOutlookParticipantSync,
  resetOutlookParticipantSyncForAccount,
} from "./outlook_participant_sync";
import type { OutlookParticipantSyncConfig } from "./outlook_participant_sync";
import type {
  DeleteAccountOpts,
  EmailIntegration,
  MarkAsReadOpts,
  SendEmailFromServerOpts,
  SendEmailOpts,
} from "./index";
import { emailIdentityKey, normalizedInternetMessageId } from "./index";
import {
  defineServerEmailAttachments,
  registerServerEmailAttachmentProcedure,
} from "./server_attachments";
import { registerEmailDraftProcedure } from "./drafts";

const INLINE_EMAIL_BODY_MAX_BYTES = 4 * 1024;
const OUTLOOK_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const OUTLOOK_INLINE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const OUTLOOK_NOTIFICATION_CLIENT_STATE_PREFIX = "message-v2:";
const MANUAL_HYDRATION_IN_PROGRESS = "Manual download in progress.";

function outlookThreadKey(opts: {
  accountId: Sql;
  identityKey: Sql;
  inReplyTo: Sql;
  messageReferences: Sql;
  providerThreadId: Sql;
}): Sql {
  return sql`coalesce(
    (
      select 'mid:' || reference.value::string
      from json.array_each(${opts.messageReferences}) reference
      order by reference.index
      limit 1
    ),
    case when ${opts.inReplyTo} is not null
      then 'mid:' || ${opts.inReplyTo} end,
    case when starts_with(${opts.identityKey}, 'mid:')
      then ${opts.identityKey} end,
    case when nullif(trim(${opts.providerThreadId}), '') is not null
      then 'provider:outlook:' || cast(${opts.accountId} as string)
        || ':' || ${opts.providerThreadId} end,
    ${opts.identityKey}
  )`;
}

function outlookAddressRecipients(addresses: Sql): Sql {
  return sql`coalesce((
    select json_array_agg(json_build_object(
      'emailAddress', json_build_object('address', trim(value))
    ))
    from string.split(coalesce(${addresses}, ''), ',')
    where trim(value) != ''
  ), json_build_array())`;
}

interface OutlookIntegrationOptions {
  provider: string;
  scopes: Sql;

  notificationDomain: string | string[];
  participantSync?: OutlookParticipantSyncConfig;

  devNotificationUrl?: string;
  emails?: {
    define?: (table: TableBuilder) => void;
    recipients?: {
      define?: (table: TableBuilder) => void;
    };
    attachments?: {
      define?: (table: TableBuilder) => void;
    };
  };
}

/**
 * Outlook (Microsoft 365 Graph) email integration for the CRM block.
 *
 * Drops into `CrmBlock`'s `emailIntegrations` array to enable
 * per-user OAuth-connected mailboxes. Provides OAuth account
 * connect/disconnect (`navigateToOauth`, `deleteAccount`,
 * `addOauthRedirect`), contact-scoped discovery
 * (`syncEmailsByParticipant`), notification-driven updates, bounded message
 * hydration, on-demand attachments, and outbound send/read actions.
 *
 * Microsoft Graph requests run through `services/microsoft/auth.ts`'s
 * `AzureADAuth.requestWithOauth`, which handles managed-OAuth
 * credential lookup and reauth.
 *
 * @see docs/blocks/crm.md
 */
export class OutlookEmailIntegration implements EmailIntegration {
  blockName = "OutlookEmailIntegration";
  blockDisplayName = "Outlook Email";
  externalServiceOptions = [
    { optionKey: "oauth", optionLabel: "OAuth" },
    { optionKey: "send_emails", optionLabel: "Send emails" },
    { optionKey: "fetch_emails", optionLabel: "Fetch and read emails" },
  ];
  #caps = getCapabilities()?.blocks?.OutlookEmailIntegration;
  #outlook: OutlookMail;

  accountTable = "user_outlook_emails_accounts";
  integrationKey = "outlook_email";
  deliveryLimits = {
    maxMessagesPerMinute: 30,
    maxRecipientsPer24Hours: 10_000,
  };
  emailTable: string;
  recipientsTable: string;
  attachmentsTable: string;
  integrationName = "Outlook";
  emailsPage = (props: { where: Sql; path: string }) => (
    <EmailsOutlookPage where={props.where} path={props.path} />
  );
  emailsList = (props: { where: Sql }) => (
    <EmailsOutlookList where={props.where} />
  );
  bodyFieldNode = <OutlookBodyFieldNode />;
  icon: (props: { sx?: Style }) => Node = ({ sx }) => (
    <OutlookEmailIcon sx={sx} />
  );

  accountDisplay = sql`account.email`;

  constructor(private opts: OutlookIntegrationOptions) {
    this.#outlook = new OutlookMail();
    this.emailTable = "user_outlook_emails";
    this.recipientsTable = "user_outlook_recipients";
    this.attachmentsTable = "user_outlook_email_attachments";
  }

  initialize() {
    if (system.hasBlock(CrmBlock)) {
      this.emailTable = "user_all_emails";
      this.recipientsTable = "user_email_recipients";
      this.attachmentsTable = "user_email_attachments";
    }
    const db = system.db;
    system.enum_({
      name: "outlook_email_connection_status",
      values: ["active", "reauth_required"],
    });
    system.enum_({
      name: "recipient_type_enum",
      values: ["to", "cc", "bcc"],
    });
    system.enum_({
      name: "outlook_email_attachment_kind",
      values: ["file", "item", "reference"],
    });
    system.enum_({
      name: "outlook_email_notification_event",
      values: [
        "created",
        "updated",
        "deleted",
        "missed",
        "subscription_removed",
        "reauthorization_required",
      ],
    });

    db.table("user_outlook_emails_accounts", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.string("email", 500);
      table.bigUint("credential_id").notNull().unique();
      table.string("provider_subject", 500);
      table.string("granted_scopes", 1000);
      table.enum("status", "outlook_email_connection_status")
        .notNull()
        .default(sql`'active'`);
      table.string("notification_resource_id", 500);
      table.string("notification_client_state", 255);
      table.timestamp("expiration_date_time");
    });
    db.table("user_outlook_email_integration_logs", (table) => {
      table.sampleData({ skipSampleData: true });
      table.string("operation", 100).notNull();
      table.string("error_message", 5000);
      table.fk("user_outlook_emails_accounts").onDelete("Cascade");
      table.string("message_id", 500).collation("Binary");
      table.timestampUtc("logged_at").notNull().default(sql`now()`);
      table.ttlFrom("logged_at", sql`date.add(week, -1, now())`);
    });
    db.table("outlook_email_notification_inbox", (table) => {
      table.sampleData({ skipSampleData: true });
      table.autoCompact();
      table.string("dedup_key", 600).notNull().unique();
      table.fk("user_outlook_emails_accounts").notNull().onDelete("Cascade");
      table.string("subscription_id", 500).notNull();
      table.string("message_id", 500).collation("Binary");
      table.enum("event_type", "outlook_email_notification_event").notNull();
      table.smallUint("attempt_count").notNull().default(0);
      table.timestampUtc("next_attempt_at").notNull().default(sql`now()`);
      table.timestampUtc("processed_at");
      table.timestampUtc("enqueued_at").notNull().default(sql`now()`);
      table.ttlFrom("enqueued_at", sql`date.add(day, -2, now())`);
    });
    if (this.opts.participantSync) {
      defineOutlookParticipantSyncSchema();
    }
    if (!system.hasBlock(CrmBlock)) {
      db.table("user_email_identities", (table) => {
        table.sampleData({ skipSampleData: true });
        table.string("identity_key", 600).notNull().collation("Binary")
          .unique();
      });
      db.table("user_outlook_emails", (table) => {
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("user_outlook_emails_accounts").onDelete("SetToNull");
        table.fk("user_email_identities").notNull().onDelete("Restrict");
        table.string("message_id", 500).notNull().collation("Binary");
        table.string("thread_id", 500).collation("Binary");
        table.string("subject", 1000);
        table.string("snippet", 1000);
        table.string("from", 500);
        table.string("from_email", 500);
        table.string("reply_to", 2000);
        table.string("to", 500);
        table.timestamp("date");
        table.string("body_text", 100000000);
        table.string("bcc", 500);
        table.bool("is_read").notNull().default(false);
        table.bool("has_attachments").notNull().default(false);
        table.string("message_reply_id", 500).collation("Binary");
        table.bytes("body_blob", 32);
        table.string("in_reply_to", 500).collation("Binary");
        table.json("message_references");
        table.string("thread_key", 600).collation("Binary");
        table.timestampUtc("hydrated_at");
        table.timestampUtc("provider_deleted_at");
        table.smallUint("hydrate_attempt_count").notNull().default(sql`0`);
        table.timestampUtc("hydrate_after").notNull().default(sql`now()`);
        table.string("hydrate_error", 5000);
        table.unique(["user_outlook_emails_account_id", "message_id"]);
        table.recordDisplayName(["subject"], (subject) => subject);
        table.searchConfig({
          fields: [
            {
              field: "subject",
              priority: 1,
            },
          ],
        });
        this.opts.emails?.define?.(table);
      });

      db.table("user_outlook_recipients", (table) => {
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("user_outlook_emails").notNull().onDelete("Cascade");
        table.string("email", 500);
        table.enum("recipient_type", "recipient_type_enum").notNull();
        table.unique(["user_outlook_email_id", "email", "recipient_type"]);
        this.opts.emails?.recipients?.define?.(table);
      });

      db.table("user_outlook_email_attachments", (table) => {
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("user_outlook_emails").notNull().onDelete("Cascade");
        table.string("attachment_id", 500).collation("Binary");
        table.enum("kind", "outlook_email_attachment_kind").notNull();
        table.string("filename", 500);
        table.bool("is_inline").notNull();
        table.string("content_type", 500);
        table.string("content_id", 500);
        table.bytes("data", 32);
        table.string("external_url", 5000);
        table.bigUint("size_bytes");
        table.timestampUtc("provider_deleted_at");
        table.unique(["user_outlook_email_id", "attachment_id"]);
        this.opts.emails?.attachments?.define?.(table);
      });
    }

    system.addReactor({
      name: "outlook_renew_subscriptions",
      query: sql`
        select *
        from user_outlook_emails_accounts
        where status = 'active'
          and credential_id is not null
          and notification_resource_id is not null
          and (
            notification_client_state is null
            or not starts_with(
              notification_client_state,
              ${sql.lit(OUTLOOK_NOTIFICATION_CLIENT_STATE_PREFIX)}
            )
            or expiration_date_time is null
            or expiration_date_time <= date.add(hour, 6, now())
          )
      `,
      recordName: "account",
      maxConcurrent: 1,
      procedure: (s) => {
        s.defRecord(
          "renew_account",
          sql`select *
            from user_outlook_emails_accounts
            where id = account.id`,
        );
        s.if(
          sql`renew_account.status = 'active'
            and renew_account.credential_id is not null
            and renew_account.notification_resource_id is not null
            and (
              renew_account.notification_client_state is null
              or not starts_with(
                renew_account.notification_client_state,
                ${sql.lit(OUTLOOK_NOTIFICATION_CLIENT_STATE_PREFIX)}
              )
              or renew_account.expiration_date_time is null
              or renew_account.expiration_date_time <= date.add(hour, 6, now())
            )`,
          (s) => {
            s.try({
              body: (s) => {
                s.if(
                  sql`renew_account.notification_client_state is null
                    or not starts_with(
                      renew_account.notification_client_state,
                      ${sql.lit(OUTLOOK_NOTIFICATION_CLIENT_STATE_PREFIX)}
                    )`,
                  (s) => {
                    this.watchInbox(s, {
                      accountId: sql`renew_account.id`,
                      expectedResourceId:
                        sql`renew_account.notification_resource_id`,
                      propagateTransientErrors: true,
                    });
                    this.#outlook.messages.stopWatch(s, {
                      resourceId: sql`renew_account.notification_resource_id`,
                      ...this.#getOauthOpts(
                        sql`renew_account.credential_id`,
                        !!this.#caps?.fetch_emails,
                      ),
                    });
                  },
                  (s) => {
                    this.#outlook.messages.renewSubscription(s, {
                      resourceId: sql`renew_account.notification_resource_id`,
                      responseRecord: "renewed_subscription",
                      ...this.#getOauthOpts(
                        sql`renew_account.credential_id`,
                        !!this.#caps?.fetch_emails,
                      ),
                    });
                    s.startTransaction();
                    s.if(sql`renewed_subscription.status = 404`, (s) => {
                      s.modify(sql`update user_outlook_emails_accounts
                        set notification_resource_id = null,
                            expiration_date_time = null
                        where id = renew_account.id
                          and status = 'active'
                          and credential_id = renew_account.credential_id
                          and notification_resource_id = renew_account.notification_resource_id`);
                    }, (s) => {
                      s.modify(sql`update user_outlook_emails_accounts
                        set expiration_date_time = renewed_subscription.expiration
                        where id = renew_account.id
                          and status = 'active'
                          and credential_id = renew_account.credential_id
                          and notification_resource_id = renew_account.notification_resource_id`);
                    });
                    s.commitTransaction();
                  },
                );
              },
              errorName: "renew_subscription_error",
              catch: (s) => {
                s.rollbackIfInTransaction();
                s.startTransaction();
                s.modify(
                  sql`insert into user_outlook_email_integration_logs
                    (operation, error_message, user_outlook_emails_account_id)
                  values (
                    'renew_subscription',
                    coalesce(renew_subscription_error.type, '<no type>') || ': ' ||
                      coalesce(renew_subscription_error.message, '<no message>'),
                    renew_account.id
                  )`,
                );
                s.modify(
                  sql`update user_outlook_emails_accounts
                    set notification_resource_id = null,
                        expiration_date_time = null
                    where id = renew_account.id
                      and status = 'active'
                      and credential_id = renew_account.credential_id
                      and notification_resource_id =
                        renew_account.notification_resource_id`,
                );
                s.commitTransaction();
                this.#markReauthOnTokenError(s, {
                  errorMessage: sql`renew_subscription_error.message`,
                  accountWhere: sql`id = renew_account.id
                    and credential_id = renew_account.credential_id
                    and status = 'active'`,
                });
              },
            });
          },
        );
      },
    });

    system.addReactor({
      name: "outlook_resubscribe_missing_email_subscription",
      query: sql`
        select id
        from user_outlook_emails_accounts
        where status = 'active'
          and credential_id is not null
          and notification_resource_id is null
      `,
      recordName: "account",
      maxConcurrent: 1,
      procedure: (s) => {
        s.defRecord(
          "subscription_account",
          sql`select *
            from user_outlook_emails_accounts
            where id = account.id
              and status = 'active'
              and credential_id is not null
              and notification_resource_id is null`,
        );
        s.if(sql`subscription_account.id is null`, (s) => s.return());
        this.watchInbox(s, {
          accountId: sql`subscription_account.id`,
          propagateTransientErrors: true,
        });
      },
    });

    system.addReactor({
      name: "outlook_email_notification_inbox",
      query: sql`
        select notification.id
        from db.outlook_email_notification_inbox notification
        join db.user_outlook_emails_accounts account
          on account.id = notification.user_outlook_emails_account_id
        where notification.processed_at is null
          and notification.attempt_count < 8
          and notification.next_attempt_at <= now()
          and account.status = 'active'
          and account.credential_id is not null
        order by notification.id
      `,
      recordName: "notification_job",
      maxConcurrent: 1,
      procedure: (s) => {
        s.defRecord(
          "queued_notification",
          sql`select n.*, a.credential_id
            from db.outlook_email_notification_inbox n
            join db.user_outlook_emails_accounts a
              on a.id = n.user_outlook_emails_account_id
            where n.id = notification_job.id
              and n.processed_at is null
              and a.status = 'active'
              and a.credential_id is not null`,
        );
        s.if(sql`queued_notification.id is null`, (s) => {
          s.return();
        });
        s.try({
          body: (s) => {
            this.processQueuedNotification(s, {
              notificationRecord: sql.ref("queued_notification"),
            });
            s.startTransaction();
            s.modify(sql`
              update db.outlook_email_notification_inbox
              set processed_at = now()
              where id = queued_notification.id
                and processed_at is null
            `);
            s.commitTransaction();
          },
          errorName: "notification_error",
          catch: (s) => {
            s.rollbackIfInTransaction();
            s.startTransaction();
            s.if(sql`queued_notification.attempt_count = 7`, (s) => {
              s.modify(sql`
                insert into db.user_outlook_email_integration_logs
                  (operation, error_message,
                   user_outlook_emails_account_id, message_id)
                values (
                  'process_notification',
                  coalesce(notification_error.type, '<no type>') || ': ' ||
                    coalesce(notification_error.message, '<no message>'),
                  queued_notification.user_outlook_emails_account_id,
                  queued_notification.message_id
                )
              `);
            });
            s.modify(sql`
              update db.outlook_email_notification_inbox
              set attempt_count = attempt_count + 1,
                  next_attempt_at = date.add(
                    minute,
                    case attempt_count
                      when 0 then 1
                      when 1 then 5
                      when 2 then 15
                      else 60
                    end,
                    now()
                  )
              where id = queued_notification.id
                and processed_at is null
            `);
            s.commitTransaction();
            this.#markReauthOnTokenError(s, {
              errorMessage: sql`notification_error.message`,
              accountWhere:
                sql`id = queued_notification.user_outlook_emails_account_id
                  and credential_id = queued_notification.credential_id
                  and status = 'active'`,
            });
          },
        });
      },
    });

    system.addReactor({
      name: "outlook_email_hydration",
      query: sql`
        select email.id
        from ${sql.ref(this.emailTable)} email
        join db.user_outlook_emails_accounts account
          on account.id = email.user_outlook_emails_account_id
        where email.hydrated_at is null
          and email.provider_deleted_at is null
          and email.hydrate_attempt_count < 5
          and email.hydrate_after <= now()
          and account.status = 'active'
          and account.credential_id is not null
        order by email.date desc nulls last, email.id desc
      `,
      recordName: "email_to_hydrate",
      maxConcurrent: 1,
      procedure: (s) => {
        s.defRecord(
          "hydration_email",
          sql`select email.*, account.credential_id
            from ${sql.ref(this.emailTable)} email
            join db.user_outlook_emails_accounts account
              on account.id = email.user_outlook_emails_account_id
            where email.id = email_to_hydrate.id
              and email.hydrated_at is null
              and email.provider_deleted_at is null
              and email.hydrate_attempt_count < 5
              and email.hydrate_after <= now()
              and account.status = 'active'
              and account.credential_id is not null`,
        );
        s.if(sql`hydration_email.id is null`, (s) => s.return());
        s.startTransaction();
        s.modify(sql`update ${sql.ref(this.emailTable)}
          set hydrate_attempt_count = hydrate_attempt_count + 1,
              hydrate_after = date.add(hour, 1, now()),
              hydrate_error = null
          where id = hydration_email.id
            and hydrate_attempt_count = hydration_email.hydrate_attempt_count
            and hydrate_after = hydration_email.hydrate_after`);
        s.commitTransaction();
        s.if(
          sql`not exists (
            select 1
            from ${sql.ref(this.emailTable)}
            where id = hydration_email.id
              and hydrate_attempt_count =
                hydration_email.hydrate_attempt_count + 1
              and hydrate_after > now()
          )`,
          (s) => s.return(),
        );
        const hydrationFence = sql`exists (
          select 1
          from ${sql.ref(this.emailTable)} email
          join db.user_outlook_emails_accounts account
            on account.id = email.user_outlook_emails_account_id
          where email.id = hydration_email.id
            and email.provider_deleted_at is null
            and email.hydrate_attempt_count =
              hydration_email.hydrate_attempt_count + 1
            and email.hydrate_after > now()
            and email.hydrate_error is null
            and account.status = 'active'
            and account.credential_id = hydration_email.credential_id
        )`;
        s.try({
          body: (s) => {
            s.sleep(1000);
            this.#fetchAndSaveHydratedEmail(s, {
              accountId: sql`hydration_email.user_outlook_emails_account_id`,
              messageId: sql`hydration_email.message_id`,
              credentialId: sql`hydration_email.credential_id`,
              writeFence: hydrationFence,
            });
            s.startTransaction();
            s.modify(sql`update ${sql.ref(this.emailTable)}
              set hydrated_at = now(),
                  hydrate_attempt_count = 0,
                  hydrate_after = now(),
                  hydrate_error = null
              where id = hydration_email.id
                and ${hydrationFence}`);
            s.commitTransaction();
          },
          errorName: "hydrate_email_error",
          catch: (s) => {
            s.rollbackIfInTransaction();
            s.startTransaction();
            s.modify(sql`update ${sql.ref(this.emailTable)}
              set hydrate_after = date.add(
                    minute,
                    case hydrate_attempt_count
                      when 1 then 5
                      when 2 then 15
                      else 60
                    end,
                    now()
                  ),
                  hydrate_error = left(
                    coalesce(
                      hydrate_email_error.message,
                      'Outlook message hydration failed'
                    ),
                    5000
                  )
              where id = hydration_email.id
                and hydrate_attempt_count =
                  hydration_email.hydrate_attempt_count + 1
                and hydrate_error is null`);
            s.commitTransaction();
            this.#markReauthOnTokenError(s, {
              errorMessage: sql`hydrate_email_error.message`,
              accountWhere: sql`id =
                  hydration_email.user_outlook_emails_account_id
                and credential_id = hydration_email.credential_id
                and status = 'active'`,
            });
          },
        });
      },
    });
    if (this.opts.participantSync) {
      registerOutlookParticipantSync(this.opts.participantSync, {
        syncPage: (s, opts) => this.syncEmailsByParticipant(s, opts),
        markReauthRequired: (s, opts) => {
          this.#markReauthOnTokenError(s, {
            errorMessage: opts.errorMessage,
            accountWhere:
              sql`id = ${opts.accountId} and credential_id = ${opts.credentialId}`,
          });
        },
      });
    }
  }

  enqueueParticipantSync<T extends IServerBaseStatements>(
    s: T,
    opts: {
      participants: Sql;
      since: Sql;
      accountWhere?: BooleanExpr;
    },
  ): void {
    enqueueOutlookParticipantSync(s, opts);
  }

  isActiveAccount: BooleanExpr = sql`status = 'active'`;

  availableSendersQuery(userId: Sql) {
    return sql`select id as account_id, email as from_address,
        coalesce(nullif(trim(provider_subject), ''), lower(trim(email)))
          as mailbox_identity
      from user_outlook_emails_accounts
      where sys_user_id = ${userId} and status = 'active'
        and email is not null and trim(email) != ''`;
  }

  mailboxIdentityQuery(accountId: AnyExpr) {
    return sql`(select coalesce(
        nullif(trim(provider_subject), ''),
        lower(trim(email))
      ) from user_outlook_emails_accounts where id = ${accountId})`;
  }

  accountOwnerQuery(accountId: AnyExpr) {
    return sql`(select sys_user_id from user_outlook_emails_accounts
      where id = ${accountId})`;
  }

  adminStatus = (
    <Show when={sql`account.status = 'reauth_required'`}>
      <Alert variant="soft" color="danger" startIcon="ErrorOutlined">
        Re-authentication is required for this account.
      </Alert>
    </Show>
  );

  #getOauthOpts = (
    credentialId: AnyExpr,
    optIn: BooleanExpr,
    opts?: {
      extensions?: Oauth2TokenOpts["extensions"];
      throwOnReauth?: boolean;
    },
  ): Oauth2TokenOpts => {
    return {
      managedOauthCredentialId: sql`${credentialId}`,
      onReauthRequired: (s) => {
        s.startTransaction();
        s.modify(
          sql`update user_outlook_emails_accounts set status = 'reauth_required'
          where credential_id = ${credentialId}
            and status = 'active'`,
        );
        s.commitTransaction();
        if (opts?.throwOnReauth) {
          s.throwError(
            sql.lit`The selected Outlook account must be reconnected.`,
          );
        }
      },
      optIn,
      extensions: opts?.extensions,
    };
  };

  #markReauthOnTokenError<T extends IServerBaseStatements>(
    s: T,
    opts: { errorMessage: Sql; accountWhere: Sql },
  ): void {
    s.if(
      sql`(lower(coalesce(${opts.errorMessage}, '')) like '%token refresh%'
           or lower(coalesce(${opts.errorMessage}, '')) like '%token exchange%')
          and lower(coalesce(${opts.errorMessage}, '')) not like '%internal oauth request failed%'`,
      (s) => {
        s.startTransaction();
        s.modify(
          sql`update user_outlook_emails_accounts set status = 'reauth_required'
            where ${opts.accountWhere}`,
        );
        s.commitTransaction();
      },
    );
  }

  #fetchAndSaveHydratedEmail<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: Sql;
      messageId: Sql;
      credentialId: Sql;
      writeFence: BooleanExpr;
      preserveHydrationClaim?: boolean;
    },
  ): void {
    const oauthOpts = this.#getOauthOpts(
      opts.credentialId,
      !!this.#caps?.fetch_emails,
    );
    this.defineTemporaryTables(s);
    this.getEmail(s, {
      ...oauthOpts,
      accountId: opts.accountId,
      emailId: opts.messageId,
      emailsTable: "temp_table",
      recipientsTable: "temp_table_recipients",
      attachmentsTable: "temp_table_attachments",
      maxResults: 1,
      pageToken: sql`null`,
      query: sql`null`,
    });
    s.defScalar("hydration_attachment_next_page", { type: "String" });
    this.#outlook.attachments.get(s, {
      ...oauthOpts,
      accountId: opts.accountId,
      emailId: opts.messageId,
      attachmentsTable: "temp_table_attachments",
      fetchAllPages: false,
      nextPageLinkScalar: "hydration_attachment_next_page",
    });
    s.if(
      sql`hydration_attachment_next_page is not null
        and trim(hydration_attachment_next_page) != ''`,
      (s) =>
        s.throwError(
          sql.lit`Message has more than 1000 attachments`,
        ),
    );
    s.modify(sql`insert into temp_attachment_sync
      (user_outlook_emails_account_id, message_id)
      values (${opts.accountId}, ${opts.messageId})`);
    this.saveFilteredTempMessages(s, {
      writeFence: opts.writeFence,
      preserveHydrationClaim: opts.preserveHydrationClaim,
    });
  }

  sendEmail<T extends DomStatements>(s: T, opts: SendEmailOpts): void {
    s.tryServer({
      body: (s) => {
        s.defScalar(
          "send_email_credential_id",
          sql`(
            select credential_id
            from user_outlook_emails_accounts
            where id = ${opts.accountId}
              and sys_user_id = current_user
              and status = 'active'
          )`,
        );
        s.if(sql`send_email_credential_id is null`, (s) => {
          s.throwError(
            sql.lit`The selected Outlook account is unavailable for sending`,
          );
        });

        s.try({
          body: (s) => {
            opts.beforeEmailSent?.(s, {
              provider: "outlook_email",
              accountId: opts.accountId,
              to: opts.to,
              cc: opts.cc,
              bcc: opts.bcc,
              subject: opts.subject,
              body: opts.body,
              from: opts.from,
              inReplyTo: opts.inReplyTo,
              attachments: opts.attachments,
            });
            this.sendInteractiveEmail(s, opts, sql`send_email_credential_id`);
            opts.afterEmailSent?.(s, {
              provider: "outlook_email",
              accountId: opts.accountId,
              to: opts.to,
              cc: opts.cc,
              bcc: opts.bcc,
              subject: opts.subject,
              body: opts.body,
              from: opts.from,
              inReplyTo: opts.inReplyTo,
              attachments: opts.attachments,
            });
          },
          errorName: "send_inner_err",
          catch: (s) => {
            s.startTransaction();
            s.modify(
              sql`insert into user_outlook_email_integration_logs
                (operation, error_message, user_outlook_emails_account_id)
              values (
                'send_email',
                concat(send_inner_err.type, ': ', coalesce(send_inner_err.message, '')),
                ${opts.accountId}
              )`,
            );
            s.commitTransaction();
            this.#markReauthOnTokenError(s, {
              errorMessage: sql`send_inner_err.message`,
              accountWhere: sql`id = ${opts.accountId}
                and credential_id = send_email_credential_id
                and status = 'active'`,
            });
            s.throwError(sql`coalesce(send_inner_err.message, 'send failed')`);
          },
        });
      },
      errorName: "send_email_error",
      catch: (s) => {
        if (opts.onEmailSendError) {
          opts.onEmailSendError(s, {
            provider: "outlook_email",
            accountId: opts.accountId,
            to: opts.to,
            cc: opts.cc,
            bcc: opts.bcc,
            subject: opts.subject,
            body: opts.body,
            from: opts.from,
            inReplyTo: opts.inReplyTo,
            attachments: opts.attachments,
            errorMessage: sql`send_email_error.message`,
          });
        }
        s.debugExpr(sql`send_email_error.message`);
        if (!opts.onEmailSendError) {
          s.throwError(sql`coalesce(send_email_error.message, 'send failed')`);
        }
      },
    });
  }

  private sendInteractiveEmail<T extends IServerBaseStatements>(
    s: T,
    opts: SendEmailOpts,
    credentialId: Sql,
  ) {
    // Static attachment arity and optional reply headers affect the provider's
    // generated payload. Share each actual shape across all UI call sites.
    const name = `outlook_send_interactive_${opts.attachments?.length ?? 0}_${
      opts.inReplyTo ? "reply" : "new"
    }`;
    const fields: HelperProcField[] = [
      { name: "p_account_id", type: "BigInt" },
      { name: "p_credential_id", type: "BigInt" },
      { name: "p_to", type: "String" },
      { name: "p_cc", type: "String" },
      { name: "p_bcc", type: "String" },
      { name: "p_subject", type: "String" },
      { name: "p_body", type: "String" },
      { name: "p_in_reply_to", type: "String" },
      { name: "p_reply_all", type: "Bool" },
    ];
    const inputs: Record<string, Sql> = {
      p_account_id: opts.accountId,
      p_credential_id: credentialId,
      p_to: opts.to,
      p_cc: opts.cc ?? sql.lit``,
      p_bcc: opts.bcc ?? sql.lit``,
      p_subject: opts.subject,
      p_body: opts.body,
      p_in_reply_to: opts.inReplyTo ?? sql.null,
      p_reply_all: sql`${opts.replyAll ?? false}`,
    };
    const attachments = opts.attachments?.map((attachment, i) => {
      for (const key of ["filename", "content", "contentType"] as const) {
        const field = `attachment_${i}_${
          key === "contentType" ? "content_type" : key
        }`;
        fields.push({ name: field, type: "String" });
        inputs[field] = attachment[key];
      }
      return {
        filename: sql.ref(`attachment_${i}_filename`),
        content: sql.ref(`attachment_${i}_content`),
        contentType: sql.ref(`attachment_${i}_content_type`),
      };
    });
    if (!system.storedProcedures.some((p) => p.name === name)) {
      system.storedProcedure({
        name,
        transaction: "standalone",
        inputScalars: fields,
        procedure: (s) => {
          this.#outlook.messages.send(s, {
            ...this.#getOauthOpts(
              sql`p_credential_id`,
              !!this.#caps?.send_emails,
              { throwOnReauth: true },
            ),
            accountId: sql`p_account_id`,
            toTable: outlookAddressRecipients(sql`p_to`),
            ccTable: outlookAddressRecipients(sql`p_cc`),
            bccTable: outlookAddressRecipients(sql`p_bcc`),
            subject: sql`p_subject`,
            body: sql`p_body`,
            replyAll: sql`p_reply_all`,
            inReplyTo: opts.inReplyTo ? sql`p_in_reply_to` : undefined,
            attachments,
          });
        },
      });
    }
    s.callStoredProcedure(name, { inputScalars: inputs });
  }

  sendEmailFromServer<T extends IServerBaseStatements>(
    s: T,
    opts: SendEmailFromServerOpts,
  ): void {
    if (opts.onEmailSendError) {
      s.defScalar("outlook_delivery_may_have_occurred", false);
    }
    s.defRecord(
      "send_email_from_server_account",
      sql`select credential_id, email
        from user_outlook_emails_accounts
        where id = ${opts.accountId}
          and sys_user_id = current_user
          and status = 'active'`,
    );
    const recipients = (type: "to" | "cc" | "bcc") =>
      sql`coalesce((
        select json_array_agg(json_build_object(
          'emailAddress', json_build_object('address', address)
        ))
        from outlook_server_email_addresses
        where recipient_type = ${sql.lit(type)}
      ), json_build_array())`;
    const toRecipients = recipients("to");
    const ccRecipients = recipients("cc");
    const bccRecipients = recipients("bcc");
    const hookContext = {
      provider: "outlook_email" as const,
      accountId: opts.accountId,
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      body: opts.body,
      from: opts.from,
      attachments: opts.attachments,
    };
    s.try({
      body: (s) => {
        s.throwErrorIf(
          sql`send_email_from_server_account.credential_id is null`,
          sql.lit`The selected Outlook account is unavailable for sending.`,
        );
        s.throwErrorIf(
          sql`lower(trim(coalesce(send_email_from_server_account.email, ''))) !=
            lower(trim(coalesce(cast(${opts.from} as string), '')))`,
          sql.lit`The selected Outlook sender no longer matches this draft.`,
        );
        s.throwErrorIf(
          sql`char_length(coalesce(cast(${opts.subject} as string), '')) > 255`,
          sql.lit`Outlook email subjects are limited to 255 characters.`,
        );
        s.defTable(
          "outlook_server_email_addresses",
          sql`select address, recipient_type
            from (
              select candidate.*,
                row_number() over (
                  partition by lower(candidate.address)
                  order by candidate.recipient_priority, candidate.source_index
                ) as dedup_rank
              from (
                select trim(value) as address, 'to' as recipient_type,
                  0 as recipient_priority, ordinal as source_index
                from string.split(
                  coalesce(cast(${opts.to} as string), ''), ','
                )
                union all
                select trim(value), 'cc', 1, ordinal
                from string.split(
                  coalesce(cast(${opts.cc ?? sql`null`} as string), ''), ','
                )
                union all
                select trim(value), 'bcc', 2, ordinal
                from string.split(
                  coalesce(cast(${opts.bcc ?? sql`null`} as string), ''), ','
                )
              ) candidate
              where candidate.address != ''
            ) ranked
            where dedup_rank = 1`,
        );
        s.throwErrorIf(
          sql`not exists (select 1 from outlook_server_email_addresses)`,
          sql.lit`Add at least one recipient before sending.`,
        );
        s.throwErrorIf(
          sql`exists (
            select 1
            from outlook_server_email_addresses
            where char_length(address) > 254
              or not string.is_valid_email(address)
          )`,
          sql.lit`Correct invalid recipient email addresses before sending.`,
        );
        s.throwErrorIf(
          sql`(select count(*) from outlook_server_email_addresses) > 1000`,
          sql.lit`Outlook emails are limited to 1000 recipients.`,
        );
        const attachmentsTable = opts.attachmentsQuery
          ? defineServerEmailAttachments(
            s,
            opts.attachmentsQuery,
            "outlook_server_email",
          )
          : undefined;
        const oauthOpts = this.#getOauthOpts(
          sql`send_email_from_server_account.credential_id`,
          !!this.#caps?.send_emails,
          {
            throwOnReauth: true,
            extensions: {
              beforeRequest: (s) => {
                opts.beforeEmailSent?.(s, hookContext);
                if (opts.onEmailSendError) {
                  s.setScalar("outlook_delivery_may_have_occurred", true);
                }
              },
              afterRequest: (s, { responseRecord }) => {
                if (opts.onEmailSendError) {
                  s.if(
                    sql`${sql.ref(responseRecord)}.status between 400 and 499
                      and ${sql.ref(responseRecord)}.status != 408`,
                    (s) => {
                      s.setScalar("outlook_delivery_may_have_occurred", false);
                    },
                  );
                }
              },
            },
          },
        );
        this.#outlook.messages.send(s, {
          ...oauthOpts,
          accountId: opts.accountId,
          toTable: toRecipients,
          ccTable: ccRecipients,
          bccTable: bccRecipients,
          subject: opts.subject,
          body: opts.body,
          attachments: opts.attachments,
          attachmentsTable,
        });
        opts.afterEmailSent?.(s, hookContext);
      },
      errorName: "send_email_from_server_error",
      catch: (s) => {
        opts.onEmailSendError?.(s, {
          provider: "outlook_email",
          accountId: opts.accountId,
          to: opts.to,
          cc: opts.cc,
          bcc: opts.bcc,
          subject: opts.subject,
          body: opts.body,
          from: opts.from,
          attachments: opts.attachments,
          errorMessage: sql`send_email_from_server_error.message`,
          deliveryMayHaveOccurred: sql`outlook_delivery_may_have_occurred`,
        });
        this.#markReauthOnTokenError(s, {
          errorMessage: sql`send_email_from_server_error.message`,
          accountWhere: sql`id = ${opts.accountId}
            and credential_id = send_email_from_server_account.credential_id
            and status = 'active'`,
        });
        s.throwError(
          sql`coalesce(send_email_from_server_error.message, 'send failed')`,
        );
      },
    });
  }

  getAttachmentUrl(blobId: Sql) {
    return sql.concat(
      "/api/",
      this.attachmentsTable,
      "/",
      sql`bytes.to_hex(${blobId})`,
    );
  }

  hydrateEmailNow<T extends IServerBaseStatements>(
    s: T,
    opts: { emailId: Sql },
  ): void {
    s.defRecord(
      "manual_hydration_email",
      sql`select
          email.*,
          account.credential_id,
          account.status as account_status
        from ${sql.ref(this.emailTable)} email
        join db.user_outlook_emails_accounts account
          on account.id = email.user_outlook_emails_account_id
        where email.id = ${opts.emailId}
          and account.sys_user_id = current_user`,
    );
    s.if(sql`manual_hydration_email.id is null`, (s) => {
      s.throwError(sql.lit`The Outlook message no longer exists.`);
    });
    s.if(
      sql`manual_hydration_email.body_text is not null
        or manual_hydration_email.body_blob is not null`,
      (s) => s.return(),
    );
    s.if(sql`manual_hydration_email.provider_deleted_at is not null`, (s) => {
      s.throwError(sql.lit`The message no longer exists in Outlook.`);
    });
    s.if(
      sql`manual_hydration_email.account_status != 'active'
        or manual_hydration_email.credential_id is null`,
      (s) => {
        s.throwError(
          sql.lit`Connect this Outlook account before downloading the message.`,
        );
      },
    );
    s.if(
      sql`manual_hydration_email.hydrate_error = ${
        sql.lit(MANUAL_HYDRATION_IN_PROGRESS)
      }
        and manual_hydration_email.hydrate_after > now()`,
      (s) => {
        s.throwError(sql.lit`The message body is already being downloaded.`);
      },
    );
    s.defScalar(
      "manual_hydration_claim_attempt_count",
      sql`case
        when manual_hydration_email.hydrate_attempt_count < 5
          then manual_hydration_email.hydrate_attempt_count + 1
        else manual_hydration_email.hydrate_attempt_count
      end`,
    );
    s.defScalar(
      "manual_hydration_claim_until",
      sql`date.add(hour, 1, now())`,
    );
    s.startTransaction();
    s.modify(sql`update ${sql.ref(this.emailTable)} email
      set hydrated_at = null,
          hydrate_attempt_count = manual_hydration_claim_attempt_count,
          hydrate_after = manual_hydration_claim_until,
          hydrate_error = ${sql.lit(MANUAL_HYDRATION_IN_PROGRESS)}
      where email.id = manual_hydration_email.id
        and email.body_text is null
        and email.body_blob is null
        and email.provider_deleted_at is null
        and email.hydrate_attempt_count =
          manual_hydration_email.hydrate_attempt_count
        and email.hydrate_after = manual_hydration_email.hydrate_after
        and (
          email.hydrated_at is not distinct from
            manual_hydration_email.hydrated_at
        )
        and (
          email.hydrate_error is not distinct from
            manual_hydration_email.hydrate_error
        )
        and exists (
          select 1
          from db.user_outlook_emails_accounts account
          where account.id = email.user_outlook_emails_account_id
            and account.sys_user_id = current_user
            and account.status = 'active'
            and account.credential_id = manual_hydration_email.credential_id
        )`);
    s.commitTransaction();
    const manualHydrationClaimState = sql`exists (
      select 1
      from ${sql.ref(this.emailTable)} email
      where email.id = manual_hydration_email.id
        and email.message_id = manual_hydration_email.message_id
        and email.user_outlook_emails_account_id =
          manual_hydration_email.user_outlook_emails_account_id
        and email.provider_deleted_at is null
        and email.hydrate_attempt_count = manual_hydration_claim_attempt_count
        and email.hydrate_after = manual_hydration_claim_until
        and email.hydrate_error = ${sql.lit(MANUAL_HYDRATION_IN_PROGRESS)}
    )`;
    s.if(sql`not ${manualHydrationClaimState}`, (s) => {
      s.throwError(sql.lit`The message body is already being downloaded.`);
    });
    const manualHydrationWriteFence = sql`${manualHydrationClaimState}
      and exists (
      select 1
      from db.user_outlook_emails_accounts account
      where account.id =
        manual_hydration_email.user_outlook_emails_account_id
        and account.sys_user_id = current_user
        and account.status = 'active'
        and account.credential_id = manual_hydration_email.credential_id
    )`;
    s.try({
      body: (s) => {
        this.#fetchAndSaveHydratedEmail(s, {
          accountId: sql`manual_hydration_email.user_outlook_emails_account_id`,
          messageId: sql`manual_hydration_email.message_id`,
          credentialId: sql`manual_hydration_email.credential_id`,
          writeFence: manualHydrationWriteFence,
          preserveHydrationClaim: true,
        });
        s.if(
          sql`not exists (
            select 1
            from ${sql.ref(this.emailTable)}
            where id = manual_hydration_email.id
              and (body_text is not null or body_blob is not null)
          )`,
          (s) => {
            s.throwError(
              sql.lit`Outlook returned the message without a body.`,
            );
          },
        );
        s.startTransaction();
        s.modify(sql`update ${sql.ref(this.emailTable)}
          set hydrated_at = now(),
              hydrate_attempt_count = 0,
              hydrate_after = now(),
              hydrate_error = null
          where id = manual_hydration_email.id
            and ${manualHydrationClaimState}`);
        s.commitTransaction();
      },
      errorName: "manual_hydration_error",
      catch: (s) => {
        s.rollbackIfInTransaction();
        s.startTransaction();
        s.modify(sql`update ${sql.ref(this.emailTable)}
          set hydrated_at = null,
              hydrate_attempt_count = case
                when manual_hydration_email.hydrate_attempt_count >= 5
                  then 4
                else manual_hydration_email.hydrate_attempt_count
              end,
              hydrate_after = date.add(minute, 5, now()),
              hydrate_error = left(
                coalesce(
                  manual_hydration_error.message,
                  'Outlook message hydration failed'
                ),
                5000
              )
          where id = manual_hydration_email.id
            and body_text is null
            and body_blob is null
            and ${manualHydrationClaimState}`);
        s.commitTransaction();
        this.#markReauthOnTokenError(s, {
          errorMessage: sql`manual_hydration_error.message`,
          accountWhere: sql`id =
              manual_hydration_email.user_outlook_emails_account_id
            and credential_id = manual_hydration_email.credential_id
            and status = 'active'`,
        });
        s.throwError(
          sql`coalesce(
            manual_hydration_error.message,
            'Outlook message hydration failed'
          )`,
        );
      },
    });
  }

  fetchAttachmentContent<T extends IServerBaseStatements>(
    s: T,
    opts: { attachmentId: Sql },
  ): void {
    this.#fetchAttachmentContent(s, {
      attachmentId: opts.attachmentId,
      maxBytes: OUTLOOK_ATTACHMENT_MAX_BYTES,
    });
  }

  fetchNextInlineAttachmentContent<T extends IServerBaseStatements>(
    s: T,
    opts: { emailId: Sql },
  ): void {
    this.#fetchAttachmentContent(s, {
      emailId: opts.emailId,
      maxBytes: OUTLOOK_INLINE_ATTACHMENT_MAX_BYTES,
    });
  }

  #fetchAttachmentContent<T extends IServerBaseStatements>(
    s: T,
    opts: { attachmentId?: Sql; emailId?: Sql; maxBytes: number },
  ): void {
    const emailIdColumn = sql.ref(singularize(this.emailTable));
    const attachmentWhere = opts.attachmentId
      ? sql`stored_attachment.id = ${opts.attachmentId}`
      : sql`email.id = ${opts.emailId ?? sql`null`}
        and stored_attachment.is_inline
        and coalesce(stored_attachment.size_bytes, 0) <=
          ${OUTLOOK_INLINE_ATTACHMENT_MAX_BYTES}`;
    s.defRecord(
      "attachment_to_fetch",
      sql`select
          stored_attachment.*,
          email.message_id,
          email.user_outlook_emails_account_id,
          account.credential_id
        from ${sql.ref(this.attachmentsTable)} stored_attachment
        join ${sql.ref(this.emailTable)} email
          on email.id = stored_attachment.${emailIdColumn}_id
        join db.user_outlook_emails_accounts account
          on account.id = email.user_outlook_emails_account_id
        where ${attachmentWhere}
          and stored_attachment.data is null
          and stored_attachment.provider_deleted_at is null
          and stored_attachment.kind in ('file', 'item')
          and email.provider_deleted_at is null
          and account.sys_user_id = current_user
          and account.status = 'active'
          and account.credential_id is not null
        order by stored_attachment.id
        limit 1`,
    );
    s.if(sql`attachment_to_fetch.id is null`, (s) => s.return());
    s.if(
      sql`coalesce(attachment_to_fetch.size_bytes, 0) > ${opts.maxBytes}`,
      (s) => s.throwError(sql.lit`Attachment is too large to download.`),
    );
    this.defineTemporaryAttachmentTable(s);
    s.modify(sql`insert into temp_table_attachments (
        user_outlook_emails_account_id,
        message_id,
        attachment_id,
        attachment_type,
        filename,
        content_type,
        content_id,
        is_inline,
        blob_id,
        external_url,
        provider_type,
        size_bytes
      ) values (
        attachment_to_fetch.user_outlook_emails_account_id,
        attachment_to_fetch.message_id,
        attachment_to_fetch.attachment_id,
        case attachment_to_fetch.kind
          when 'file' then '#microsoft.graph.fileAttachment'
          when 'item' then '#microsoft.graph.itemAttachment'
          else '#microsoft.graph.referenceAttachment'
        end,
        attachment_to_fetch.filename,
        attachment_to_fetch.content_type,
        attachment_to_fetch.content_id,
        attachment_to_fetch.is_inline,
        null,
        attachment_to_fetch.external_url,
        null,
        attachment_to_fetch.size_bytes
      )`);
    this.#outlook.attachments.fetchMissingContent(s, {
      ...this.#getOauthOpts(
        sql`attachment_to_fetch.credential_id`,
        !!this.#caps?.fetch_emails,
      ),
      accountId: sql`attachment_to_fetch.user_outlook_emails_account_id`,
      emailId: sql`attachment_to_fetch.message_id`,
      attachmentsTable: "temp_table_attachments",
      maxContentBytes: opts.maxBytes,
    });
    s.startTransaction();
    s.modify(sql`update ${sql.ref(this.attachmentsTable)} attachment
      set data = source.blob_id,
          content_type = coalesce(source.content_type, attachment.content_type)
      from temp_table_attachments source
      where attachment.id = attachment_to_fetch.id
        and attachment.attachment_id = source.attachment_id
        and attachment.data is null
        and attachment.provider_deleted_at is null
        and source.blob_id is not null
        and exists (
          select 1
          from ${sql.ref(this.emailTable)} owned_email
          join db.user_outlook_emails_accounts owned_account
            on owned_account.id =
              owned_email.user_outlook_emails_account_id
          where owned_email.id = attachment.${emailIdColumn}_id
            and owned_account.sys_user_id = current_user
        )`);
    s.commitTransaction();
  }

  private syncEmailsByParticipant<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: Sql;
      credentialId: Sql;
      normalizedAddress: Sql;
      windowStart: Sql;
      windowEnd: Sql;
      continuationUrl: Sql;
      nextPageLinkScalar: string;
      resultCountScalar: string;
      writeFence: BooleanExpr;
    },
  ): void {
    const oauthOpts = this.#getOauthOpts(
      opts.credentialId,
      !!this.#caps?.fetch_emails,
    );
    this.defineTemporaryTables(s);
    this.#outlook.messages.list(s, {
      ...oauthOpts,
      accountId: opts.accountId,
      emailsTable: "temp_table",
      recipientsTable: "temp_table_recipients",
      attachmentsTable: "temp_table_attachments",
      maxResults: 100,
      continuationUrl: opts.continuationUrl,
      nextPageLinkScalar: opts.nextPageLinkScalar,
      metadataOnly: true,
      query: sql.lit``,
      excludedFolderFilter: sql.lit``,
      search: sql`'"participants:' ||
        regex.replace_all(${opts.normalizedAddress}, '"', '') || ' AND ' ||
        'received>=' || substring(
          date.to_rfc3339(${opts.windowStart}::timestamptz, 'seconds', true),
          1,
          10
        ) || ' AND received<=' || substring(
          date.to_rfc3339(
            date.add(day, -1, ${opts.windowEnd})::timestamptz,
            'seconds',
            true
          ),
          1,
          10
        ) || '"'`,
    });
    s.setScalar(
      opts.resultCountScalar,
      sql`(select count(*) from temp_table)`,
    );
    s.modify(sql`
      delete from temp_table email
      where (email.from_email is null
          or lower(email.from_email) != ${opts.normalizedAddress})
        and not exists (
          select 1
          from temp_table_recipients recipient
          where recipient.user_outlook_emails_account_id =
              email.user_outlook_emails_account_id
            and recipient.message_id = email.message_id
            and lower(recipient.email) = ${opts.normalizedAddress}
        )
    `);
    s.modify(sql`
      delete from temp_table_recipients recipient
      where not exists (
        select 1
        from temp_table email
        where email.user_outlook_emails_account_id =
            recipient.user_outlook_emails_account_id
          and email.message_id = recipient.message_id
      )
    `);
    this.filterTempMessages(s);
    this.saveFilteredTempMessages(s, {
      metadataOnlyListing: true,
      writeFence: opts.writeFence,
    });
    s.startTransaction();
    s.modify(sql`update ${sql.ref(this.emailTable)} email
      set hydrated_at = null,
          hydrate_attempt_count = 0,
          hydrate_after = now(),
          hydrate_error = null
      where (email.body_text is null and email.body_blob is null)
        and exists (
          select 1
          from temp_table source
          where source.user_outlook_emails_account_id =
              email.user_outlook_emails_account_id
            and source.message_id = email.message_id
        )
        and ${opts.writeFence}`);
    s.commitTransaction();
  }

  addOauthRedirect(app: App): void {
    const callbackQueryParams = [
      { name: "code", type: { type: "String", maxLength: 8_000 } },
      { name: "state", type: { type: "String", maxLength: 8_000 } },
      { name: "error", type: { type: "String", maxLength: 8_000 } },
      { name: "error_description", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];
    const redirectQueryParams = [
      ...callbackQueryParams,
      { name: "scope", type: { type: "String", maxLength: 8_000 } },
      { name: "error_uri", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];

    const body = (s: EndpointStatements) => {
      const authCtx = useOptionalICtx(AuthApiICtxKey);
      if (authCtx) {
        authCtx.authenticate(s);
      } else {
        throw new Error("No auth context for api");
      }
      s.if(sql`error is not null and error != ''`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(coalesce(error_description, error))`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.if(sql`code is null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql
            .lit`/oauth-email-error?message=Please make sure you have granted access to the email.`,
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.getCookie(
        sql.lit`outlook_email_oauth_preferences`,
        "outlook_oauth_preferences_cookie",
      );
      s.defScalar(
        "outlook_oauth_preferences",
        sql`try_cast(outlook_oauth_preferences_cookie.value as json)`,
      );
      s.if(
        sql`state is null
          or outlook_oauth_preferences is null
          or (
            outlook_oauth_preferences->>'oauth_state' is distinct from state
          )`,
        (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql.concat(
              "/oauth-error?error_msg=",
              sql`uri.encode_component(
                'The Outlook connection request is missing, expired, or belongs to another OAuth flow. Please try connecting again.'
              )`,
            ),
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        },
      );
      s.serviceRequest({
        serviceType: sql.lit`managed_oauth`,
        operation: sql.lit`complete_callback`,
        requestJson: sql`json_build_object(
          'provider', ${sql.lit(this.opts.provider)},
          'code', code,
          'state', state
        )`,
        resultJsonScalar: "callback_result",
        errorJsonScalar: "callback_error",
        optIn: !!this.#caps?.oauth,
      });
      s.if(sql`callback_error is not null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(coalesce(callback_error->>'message', 'OAuth callback failed'))`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.defScalar(
        "existing_outlook_email_account_id",
        sql`(
          select candidate.id
          from user_outlook_emails_accounts candidate
          where candidate.sys_user_id = user_id
            and (
              candidate.credential_id =
                (callback_result->>'credential_id')::bigint
              or
              (
                callback_result->>'provider_subject' is not null
                and candidate.provider_subject =
                  callback_result->>'provider_subject'
              )
              or (
                candidate.email = callback_result->>'provider_email'
                and (
                  candidate.provider_subject is null
                  or callback_result->>'provider_subject' is null
                )
              )
            )
          order by
            case
              when candidate.credential_id =
                (callback_result->>'credential_id')::bigint then 0
              when candidate.provider_subject =
                callback_result->>'provider_subject' then 1
              else 2
            end,
            candidate.id
          limit 1
        )`,
      );
      s.startTransaction();
      s.modify(
        sql`merge into user_outlook_emails_accounts as target
          using (select
            user_id as sys_user_id,
            (callback_result->>'credential_id')::bigint as credential_id,
            callback_result->>'provider_email' as email,
            callback_result->>'provider_subject' as provider_subject,
            callback_result->>'granted_scopes' as granted_scopes,
            existing_outlook_email_account_id as existing_account_id,
            'active' as status
          ) as source
          on target.id = source.existing_account_id
          when matched then
            update set
              credential_id = source.credential_id,
              email = source.email,
              provider_subject = coalesce(
                source.provider_subject,
                target.provider_subject
              ),
              granted_scopes = source.granted_scopes,
              status = source.status
          when not matched then
            insert (
              sys_user_id,
              credential_id,
              email,
              provider_subject,
              granted_scopes,
              status
            )
            values (
              source.sys_user_id,
              source.credential_id,
              source.email,
              source.provider_subject,
              source.granted_scopes,
              source.status
            )`,
      );
      s.commitTransaction();
      s.setCookie(
        sql.lit`outlook_email_oauth_preferences`,
        sql.lit``,
        {
          path: "/",
          expires: sql`date.add(day, -1, now())`,
          httpOnly: sql`true`,
          sameSite: "Lax",
        },
      );

      s.setHeader(sql.lit`Location`, sql.lit`/email-integrations`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHttpStatus(303);
    };

    system.api({ prefix: "/api", domain: app.domain }).get(
      "/can-write/outlook-email-oauth-callback",
      {
        query: callbackQueryParams,
        procedure: body,
      },
    );
    for (const alias of app.domainAliases) {
      system.api({ prefix: "/api", domain: alias }).get(
        "/can-write/outlook-email-oauth-callback",
        {
          query: callbackQueryParams,
          procedure: body,
        },
      );
    }

    // Global API redirect using resolve_callback_target
    system.globalApi.get("/can-write/outlook-email-oauth-redirect", {
      query: redirectQueryParams,
      procedure: (s) => {
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`resolve_callback_target`,
          requestJson: sql`json_build_object(
            'provider', ${sql.lit(this.opts.provider)},
            'state', state
          )`,
          resultJsonScalar: "callback_target_result",
          errorJsonScalar: "callback_target_error",
          optIn: !!this.#caps?.oauth,
        });
        s.if(sql`callback_target_error is not null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql.concat(
              "/oauth-error?error_msg=",
              sql`uri.encode_component(coalesce(callback_target_error->>'message', 'Failed to resolve callback target'))`,
            ),
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.defScalar(
          "original_host",
          sql`callback_target_result->>'original_host'`,
        );
        const queryParamValues = queryParamsString({
          code: sql`code`,
          state: sql`state`,
          scope: sql`scope`,
          error: sql`error`,
          error_description: sql`error_description`,
          error_uri: sql`error_uri`,
        });
        s.if(sql`original_host is null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql
              .lit`/oauth-error?error_msg=Could+not+determine+original+host`,
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            localhostAwareScheme(sql`lower(original_host)`),
            sql`original_host`,
            "/api/can-write/outlook-email-oauth-callback?",
            queryParamValues,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    });

    system.api({ prefix: "/api", domain: app.domain }).get(
      `/${this.attachmentsTable}/{blob_id}`,
      {
        procedure: (s) => {
          const authCtx = useOptionalICtx(AuthApiICtxKey);
          if (authCtx) {
            authCtx.authenticate(s);
          } else {
            throw new Error("No auth context for api");
          }
          const emailIdColumn = sql.ref(singularize(this.emailTable));
          s.defRecord(
            "attachment",
            sql`select stored_attachment.*
              from db.${sql.ref(this.attachmentsTable)} stored_attachment
              join db.${sql.ref(this.emailTable)} email
                on email.id = stored_attachment.${emailIdColumn}_id
              join db.user_outlook_emails_accounts account
                on account.id = email.user_outlook_emails_account_id
              where stored_attachment.data = bytes.from_hex(blob_id)
                and stored_attachment.provider_deleted_at is null
                and email.provider_deleted_at is null
                and account.sys_user_id = current_user`,
          );
          s.if(sql`attachment.id is null`, (s) => {
            s.setHttpStatus(404);
            s.return();
          });
          s.setHeader(sql.lit`Content-Type`, sql`attachment.content_type`);
          s.setHeader(
            sql.lit`Cache-Control`,
            sql.lit`private, max-age=31536000, immutable`,
          );
          s.returnBlob(sql`attachment.data`);
        },
      },
    );
  }

  populate(): void {
    registerServerEmailAttachmentProcedure();
    registerEmailDraftProcedure();
    const notificationDomains = Array.isArray(this.opts.notificationDomain)
      ? this.opts.notificationDomain
      : [this.opts.notificationDomain];
    for (const notificationDomain of notificationDomains) {
      system.api({ prefix: "/api", domain: notificationDomain }).post(
        "/azure-email-notifications",
        {
          textBodyScalar: "body",
          query: [
            {
              name: "validationToken",
              type: { type: "String", maxLength: 1000 },
            },
          ],
          procedure: (s) => {
            s.if(
              sql`validationToken is not null and validationToken != ''`,
              (s) => {
                s.setHttpStatus(200);
                s.return(sql`validationToken`);
              },
            );
            s.if(
              sql`body is null
                or octet_length(string.to_utf8(body)) > 1_000_000`,
              (s) => {
                s.setHttpStatus(413);
                s.return();
              },
            );
            s.if(
              sql`try_cast(body as json) is null
                or try_cast(body as json)->'value' is null
                or json_typeof(try_cast(body as json)->'value') != 'array'`,
              (s) => {
                s.setHttpStatus(400);
                s.return();
              },
            );
            s.if(
              sql`json_array_length(try_cast(body as json)->'value') > 1000`,
              (s) => {
                s.setHttpStatus(413);
                s.return();
              },
            );
            s.try({
              body: (s) => {
                s.defTable(
                  "messages",
                  sql`select
                    value->>'id' as notification_id,
                    value->'resourceData'->>'id' as message_id,
                    value->>'subscriptionId' as subscription_id,
                    value->>'clientState' as client_state,
                    case
                      when value->>'lifecycleEvent' = 'missed'
                        then 'missed'
                      when value->>'lifecycleEvent' = 'subscriptionRemoved'
                        then 'subscription_removed'
                      when value->>'lifecycleEvent' =
                        'reauthorizationRequired'
                        then 'reauthorization_required'
                      when value->>'changeType' in ('created', 'deleted')
                        then value->>'changeType'
                    end as event_type,
                    bytes.to_hex(
                      crypto.sha256(string.to_utf8(value::string))
                    ) as payload_hash
                  from json.array_each(
                    try_cast(body as json) -> 'value'
                  ) as value`,
                );
                s.if(
                  sql`exists (
                    select 1
                    from messages message
                    join db.user_outlook_emails_accounts account
                      on account.notification_resource_id =
                        message.subscription_id
                    where account.notification_client_state is null
                      and account.status = 'active'
                  )`,
                  (s) => {
                    s.setHttpStatus(503);
                    s.return();
                  },
                );
                s.defTable(
                  "notifications_to_enqueue",
                  sql`with authenticated as (
                    select
                      case
                        when message.event_type in ('created', 'deleted') then
                          'message:' || cast(account.id as string) || ':' ||
                            message.message_id
                        else coalesce(
                          'id:' || message.notification_id,
                          'payload:' || message.payload_hash
                        )
                      end as dedup_key,
                      account.id as user_outlook_emails_account_id,
                      message.subscription_id,
                      message.message_id,
                      message.event_type
                    from messages message
                    join db.user_outlook_emails_accounts account
                      on account.notification_resource_id =
                        message.subscription_id
                      and account.notification_client_state =
                        message.client_state
                    where message.subscription_id is not null
                      and message.event_type is not null
                      and account.status = 'active'
                      and account.credential_id is not null
                      and (
                        message.message_id is not null
                        or message.event_type in (
                          'missed',
                          'subscription_removed',
                          'reauthorization_required'
                        )
                      )
                  ), ranked as (
                    select
                      authenticated.*,
                      row_number() over (
                        partition by authenticated.dedup_key
                        order by case
                          when authenticated.event_type = 'deleted' then 0
                          else 1
                        end
                      ) as dedup_rank
                    from authenticated
                  ), state as (
                    select
                      ranked.*,
                      (
                        select case
                          when email.provider_deleted_at is null then 'live'
                          else 'deleted'
                        end
                        from ${sql.ref(this.emailTable)} email
                        where email.user_outlook_emails_account_id =
                            ranked.user_outlook_emails_account_id
                          and email.message_id = ranked.message_id
                      ) as email_state,
                      (
                        select case
                          when existing.processed_at is null then
                            cast(existing.event_type as string)
                          else 'processed'
                        end
                        from db.outlook_email_notification_inbox existing
                        where existing.dedup_key = ranked.dedup_key
                      ) as inbox_state
                    from ranked
                    where ranked.dedup_rank = 1
                  )
                  select
                    state.dedup_key,
                    state.user_outlook_emails_account_id,
                    state.subscription_id,
                    state.message_id,
                    state.event_type
                  from state
                  where (
                    state.event_type in (
                      'missed',
                      'subscription_removed',
                      'reauthorization_required'
                    )
                    and state.inbox_state is null
                  ) or (
                    state.event_type = 'created'
                    and (
                      state.email_state = 'deleted'
                      or (
                        state.email_state is null
                        and state.inbox_state is null
                      )
                    )
                  ) or (
                    state.event_type = 'deleted'
                    and coalesce(state.inbox_state, '') != 'deleted'
                    and (
                      state.email_state = 'live'
                      or state.inbox_state = 'created'
                    )
                  )`,
                );
                s.if(
                  sql`not exists (select 1 from notifications_to_enqueue)`,
                  (s) => {
                    s.setHttpStatus(202);
                    s.return();
                  },
                );
                s.startTransaction();
                s.modify(sql`
                  merge into db.outlook_email_notification_inbox as target
                  using notifications_to_enqueue as source
                    on target.dedup_key = source.dedup_key
                    when matched then update set
                      subscription_id = source.subscription_id,
                      event_type = source.event_type::
                        enums.outlook_email_notification_event,
                      attempt_count = 0,
                      next_attempt_at = now(),
                      processed_at = null,
                      enqueued_at = now()
                    when not matched then insert (
                      dedup_key,
                      user_outlook_emails_account_id,
                      subscription_id,
                      message_id,
                      event_type,
                      attempt_count,
                      next_attempt_at,
                      enqueued_at
                    ) values (
                      source.dedup_key,
                      source.user_outlook_emails_account_id,
                      source.subscription_id,
                      source.message_id,
                      source.event_type::
                        enums.outlook_email_notification_event,
                      0,
                      now(),
                      now()
                    )
                `);
                s.commitTransaction();
                s.setHttpStatus(202);
                s.return();
              },
              errorName: "enqueue_notification_error",
              catch: (s) => {
                s.rollbackIfInTransaction();
                s.startTransaction();
                s.modify(sql`insert into user_outlook_email_integration_logs
                  (operation, error_message)
                  values (
                    'enqueue_notification',
                    coalesce(enqueue_notification_error.type, '<no type>') ||
                      ': ' ||
                      coalesce(
                        enqueue_notification_error.message,
                        '<no message>'
                      )
                  )`);
                s.commitTransaction();
                s.setHttpStatus(503);
                s.return();
              },
            });
          },
        },
      );
    }
  }

  private processQueuedNotification<T extends IServerBaseStatements>(
    s: T,
    opts: { notificationRecord: Sql },
  ): void {
    const notification = opts.notificationRecord;
    const notificationSince = this.opts.participantSync?.defaultSince ??
      sql`date.add(month, -3, current_date)`;
    s.if(
      sql`${notification}.event_type in (
        'missed',
        'subscription_removed',
        'reauthorization_required'
      )`,
      (s) => {
        s.if(sql`${notification}.event_type = 'missed'`, (s) => {
          if (this.opts.participantSync) {
            resetOutlookParticipantSyncForAccount(
              s,
              this.opts.participantSync,
              sql`${notification}.user_outlook_emails_account_id`,
            );
          }
        });
        s.if(
          sql`${notification}.event_type = 'subscription_removed'`,
          (s) => {
            s.startTransaction();
            s.modify(sql`update db.user_outlook_emails_accounts
              set notification_resource_id = null,
                  expiration_date_time = null
              where id = ${notification}.user_outlook_emails_account_id
                and notification_resource_id =
                  ${notification}.subscription_id`);
            s.commitTransaction();
          },
        );
        s.if(
          sql`${notification}.event_type = 'reauthorization_required'`,
          (s) => {
            s.startTransaction();
            s.modify(sql`update db.user_outlook_emails_accounts
              set expiration_date_time = now()
              where id = ${notification}.user_outlook_emails_account_id
                and notification_resource_id =
                  ${notification}.subscription_id`);
            s.commitTransaction();
          },
        );
      },
      (s) => {
        s.if(
          sql`${notification}.event_type = 'deleted'`,
          (s) => {
            s.startTransaction();
            s.modify(sql`update ${sql.ref(this.emailTable)}
              set provider_deleted_at = coalesce(provider_deleted_at, now())
              where message_id = ${notification}.message_id
                and user_outlook_emails_account_id =
                  ${notification}.user_outlook_emails_account_id`);
            s.commitTransaction();
          },
          (s) => {
            const oauthOpts = this.#getOauthOpts(
              sql`${notification}.credential_id`,
              !!this.#caps?.fetch_emails,
            );
            this.defineTemporaryTables(s);
            this.getEmail(s, {
              ...oauthOpts,
              accountId: sql`${notification}.user_outlook_emails_account_id`,
              emailId: sql`${notification}.message_id`,
              emailsTable: "temp_table",
              recipientsTable: "temp_table_recipients",
              attachmentsTable: "temp_table_attachments",
              maxResults: 1,
              pageToken: sql`null`,
              query: sql`null`,
              metadataOnly: true,
            });
            s.modify(sql`delete from temp_table
              where date is null
                or date < ${notificationSince}`);
            this.filterTempMessages(s);
            this.saveFilteredTempMessages(s, {
              metadataOnlyListing: true,
              writeFence: sql`exists (
                select 1
                from db.outlook_email_notification_inbox pending
                join db.user_outlook_emails_accounts account
                  on account.id = pending.user_outlook_emails_account_id
                where pending.id = ${notification}.id
                  and pending.processed_at is null
                  and account.status = 'active'
                  and account.credential_id = ${notification}.credential_id
              )`,
            });
          },
        );
      },
    );
  }

  saveMessages<T extends IServerBaseStatements>(s: T): void {
    this.filterTempMessages(s);
    this.saveFilteredTempMessages(s);
  }

  private filterTempMessages<T extends IServerBaseStatements>(s: T): void {
    const participantSync = this.opts.participantSync;
    if (participantSync) {
      s.modify(sql`
        delete from temp_table email
        where not exists (
          select 1
          from (${participantSync.participants}) participant
          where participant.address = lower(email.from_email)
        )
          and not exists (
            select 1
            from temp_table_recipients recipient
            join (${participantSync.participants}) participant
              on participant.address = lower(recipient.email)
            where recipient.message_id = email.message_id
              and recipient.user_outlook_emails_account_id =
                email.user_outlook_emails_account_id
          )
      `);
      s.modify(sql`delete from temp_table_recipients
                   where not exists (
                     select 1
                     from temp_table e
                     where e.message_id = temp_table_recipients.message_id
                       and e.user_outlook_emails_account_id = temp_table_recipients.user_outlook_emails_account_id
                   )`);
      s.modify(sql`delete from temp_table_attachments
                   where not exists (
                     select 1
                     from temp_table e
                     where e.message_id = temp_table_attachments.message_id
                       and e.user_outlook_emails_account_id = temp_table_attachments.user_outlook_emails_account_id
                   )`);
    }
  }

  private saveFilteredTempMessages<T extends IServerBaseStatements>(
    s: T,
    opts?: {
      /**
       * Set when the temp_table rows of already-synced messages come from a
       * metadata-only listing, i.e. they carry a null body_text and a
       * has_attachments flag that misses inline `cid:` attachments. The
       * merge then never nulls out a stored body or clears a stored
       * has_attachments.
       */
      metadataOnlyListing?: boolean;
      writeFence?: BooleanExpr;
      preserveHydrationClaim?: boolean;
    },
  ): void {
    const writeFence = opts?.writeFence ?? sql`true`;
    const preserveHydrationClaim = opts?.preserveHydrationClaim
      ? sql.true
      : sql.false;
    this.#prepareArchiveTempMessages(s);
    s.startTransaction();
    s.modify(sql`insert into db.user_email_identities (identity_key)
      select distinct identity_key
      from temp_table
      where identity_key is not null
      on conflict (identity_key) do nothing`);
    s.modify(sql`update temp_table source
      set user_email_identity_id = (
        select identity.id
        from db.user_email_identities identity
        where identity.identity_key = source.identity_key
      )`);
    const emailIdColumn = sql.ref(singularize(this.emailTable));
    const bodyChanged = sql`(
      target.body_text is null
      and target.body_blob is null
      and (source.body_text is not null or source.body_blob is not null)
    )`;
    const hydrationChanged = sql`(
      ${bodyChanged} or source.message_references is not null
    )`;
    const hasAttachmentsChanged = opts?.metadataOnlyListing
      ? sql`(source.has_attachments and not target.has_attachments)`
      : sql`(target.has_attachments is distinct from source.has_attachments)`;
    const bodyValue = sql`case
      when target.body_text is null and target.body_blob is null
        then source.body_text
      else target.body_text
    end`;
    const hasAttachmentsValue = opts?.metadataOnlyListing
      ? sql`source.has_attachments or target.has_attachments`
      : sql`source.has_attachments`;
    s.modify(sql`merge into ${sql.ref(this.emailTable)} as target
              using (
                select *
                from temp_table
                where ${writeFence}
              ) as source
              on target.message_id = source.message_id
              and target.user_outlook_emails_account_id = source.user_outlook_emails_account_id
              when matched and (
                (target.user_email_identity_id is distinct from source.user_email_identity_id)
                or (target.subject is distinct from source.subject)
                or (target.snippet is distinct from source.snippet)
                or (target.from is distinct from source.from)
                or (target.from_email is distinct from source.from_email)
                or (target.reply_to is distinct from source.reply_to)
                or (target.date is distinct from source.date)
                or ${bodyChanged}
                or (target.thread_id is distinct from source.thread_id)
                or (target.message_reply_id is distinct from source.message_reply_id)
                or target.provider_deleted_at is not null
                or (
                  source.in_reply_to is not null
                  and target.in_reply_to is distinct from source.in_reply_to
                )
                or (
                  source.message_references is not null
                  and target.message_references is distinct from source.message_references
                )
                or (
                  source.thread_key is not null
                  and target.thread_key is distinct from source.thread_key
                )
                or (target.is_read is distinct from source.is_read)
                or ${hasAttachmentsChanged}
              ) then update set
              user_email_identity_id = source.user_email_identity_id,
              subject = source.subject,
              snippet = source.snippet,
              from = source.from,
              from_email = source.from_email,
              reply_to = source.reply_to,
              date = source.date,
              body_text = ${bodyValue},
              body_blob = case
                when target.body_text is null and target.body_blob is null
                  then source.body_blob
                else target.body_blob
              end,
              thread_id = source.thread_id,
              message_reply_id = source.message_reply_id,
              in_reply_to = coalesce(source.in_reply_to, target.in_reply_to),
              message_references = coalesce(
                source.message_references,
                target.message_references
              ),
              thread_key = coalesce(source.thread_key, target.thread_key),
              is_read = source.is_read,
              has_attachments = ${hasAttachmentsValue},
              provider_deleted_at = null,
              hydrate_attempt_count = case
                when ${preserveHydrationClaim}
                  then target.hydrate_attempt_count
                when ${hydrationChanged} then 0
                else target.hydrate_attempt_count
              end,
              hydrate_after = case
                when ${preserveHydrationClaim}
                  then target.hydrate_after
                when ${hydrationChanged} then now()
                else target.hydrate_after
              end,
              hydrate_error = case
                when ${preserveHydrationClaim}
                  then target.hydrate_error
                when ${hydrationChanged} then null
                else target.hydrate_error
              end
              when not matched then insert
              (
                user_email_identity_id,
                user_outlook_emails_account_id,
                message_id,
                subject,
                snippet,
                from,
                from_email,
                reply_to,
                date,
                body_text,
                body_blob,
                thread_id,
                message_reply_id,
                in_reply_to,
                message_references,
                thread_key,
                is_read,
                has_attachments
              )
              values
              (
                source.user_email_identity_id,
                source.user_outlook_emails_account_id,
                source.message_id,
                source.subject,
                source.snippet,
                source.from,
                source.from_email,
                source.reply_to,
                source.date,
                source.body_text,
                source.body_blob,
                source.thread_id,
                source.message_reply_id,
                source.in_reply_to,
                source.message_references,
                source.thread_key,
                source.is_read,
                source.has_attachments
              )`);

    s.defTable(
      "temp_synced_email_ids",
      sql`select target_email.id as email_id
          from ${sql.ref(this.emailTable)} target_email
          join temp_table source
            on target_email.message_id = source.message_id
            and target_email.user_outlook_emails_account_id = source.user_outlook_emails_account_id`,
    );
    s.defTable(
      "temp_normalized_recipients",
      sql`select distinct
            target_email.id as email_id,
            source.email as email,
            source.recipient_type::enums.recipient_type_enum as recipient_type
          from temp_table_recipients source
          join ${sql.ref(this.emailTable)} target_email
            on target_email.message_id = source.message_id
            and target_email.user_outlook_emails_account_id = source.user_outlook_emails_account_id
          where source.email is not null
            and trim(source.email) != ''`,
    );

    s.modify(sql`delete from ${sql.ref(this.recipientsTable)} target
              where target.${emailIdColumn}_id in (
                select email_id from temp_synced_email_ids
              )
              and ${writeFence}
              and not exists (
                select 1
                from temp_normalized_recipients source
                where source.email_id = target.${emailIdColumn}_id
                  and source.email = target.email
                  and source.recipient_type = target.recipient_type
              )`);

    s.modify(sql`insert into ${sql.ref(this.recipientsTable)}
              (${emailIdColumn}_id, email, recipient_type)
              select
                source.email_id as ${emailIdColumn}_id,
                source.email,
                source.recipient_type
              from temp_normalized_recipients source
              where ${writeFence}
                and not exists (
                select 1
                from ${sql.ref(this.recipientsTable)} target
                where target.${emailIdColumn}_id = source.email_id
                  and target.email = source.email
                  and target.recipient_type = source.recipient_type
              )`);
    this.saveAttachments(s, writeFence);
    s.commitTransaction();
  }

  #prepareArchiveTempMessages<T extends IServerBaseStatements>(s: T): void {
    s.forEachQuery(
      sql`select user_outlook_emails_account_id, message_id, body_text
          from temp_table
          where body_text is not null
            and body_blob is null
            and octet_length(body_text) > ${INLINE_EMAIL_BODY_MAX_BYTES}`,
      "large_email_body",
      (s) => {
        s.createBlob(sql`string.to_utf8(large_email_body.body_text)`, {
          defHashScalar: "large_email_body_blob",
        });
        s.modify(sql`update temp_table
          set body_text = null,
              body_blob = large_email_body_blob
          where user_outlook_emails_account_id =
              large_email_body.user_outlook_emails_account_id
            and message_id = large_email_body.message_id`);
      },
    );
    const normalizedMessageIdExpr = normalizedInternetMessageId(
      sql`source.message_reply_id`,
    );
    const normalizedInReplyTo = normalizedInternetMessageId(
      sql`source.in_reply_to`,
    );
    const identityKey = emailIdentityKey({
      provider: "outlook",
      accountId: sql`source.user_outlook_emails_account_id`,
      providerMessageId: sql`source.message_id`,
      internetMessageId: sql`source.message_reply_id`,
    });
    s.modify(sql`update temp_table source
      set message_reply_id = ${normalizedMessageIdExpr},
          in_reply_to = ${normalizedInReplyTo},
          message_references = case
            when source.message_references is null then null
            else coalesce((
              select json_agg(reference_id order by reference_index)
              from (
                select
                  ${normalizedInternetMessageId(sql`reference.value::string`)}
                    as reference_id,
                  reference.index as reference_index
                from json.array_each(source.message_references) reference
              ) normalized_reference
              where reference_id is not null
            ), json_build_array())
          end,
          identity_key = ${identityKey}`);
    s.modify(sql`update temp_table source
      set thread_key = case
        when source.message_references is null then null
        else ${
      outlookThreadKey({
        accountId: sql`source.user_outlook_emails_account_id`,
        identityKey: sql`source.identity_key`,
        inReplyTo: sql`source.in_reply_to`,
        messageReferences: sql`source.message_references`,
        providerThreadId: sql`source.thread_id`,
      })
    }
      end`);
  }

  private saveAttachments<T extends IServerBaseStatements>(
    s: T,
    writeFence: BooleanExpr,
  ): void {
    s.if(sql`exists (select 1 from temp_attachment_sync)`, (s) => {
      const emailIdColumn = sql.ref(singularize(this.emailTable));
      s.defTable(
        "temp_synced_attachment_email_ids",
        sql`select distinct target.id as email_id
          from ${sql.ref(this.emailTable)} target
          join temp_attachment_sync source
            on target.message_id = source.message_id
            and target.user_outlook_emails_account_id =
              source.user_outlook_emails_account_id`,
      );
      s.defTable(
        "temp_normalized_attachments",
        sql`select distinct
            target.id as email_id,
            source.attachment_id,
            case source.attachment_type
              when '#microsoft.graph.fileAttachment' then 'file'
              when '#microsoft.graph.itemAttachment' then 'item'
              else 'reference'
            end::enums.outlook_email_attachment_kind as kind,
            source.filename,
            source.content_type,
            nullif(
              case
                when source.content_id like '<%>'
                then substring(
                  source.content_id from 2 for length(source.content_id) - 2
                )
                else source.content_id
              end,
              ''
            ) as content_id,
            source.blob_id,
            source.is_inline,
            source.external_url,
            source.size_bytes
          from temp_table_attachments source
          join ${sql.ref(this.emailTable)} target
            on target.message_id = source.message_id
            and target.user_outlook_emails_account_id =
              source.user_outlook_emails_account_id
          where source.attachment_id is not null`,
      );
      s.modify(sql`update ${sql.ref(this.attachmentsTable)} target
        set provider_deleted_at = coalesce(provider_deleted_at, now())
        where target.${emailIdColumn}_id in (
          select email_id from temp_synced_attachment_email_ids
        )
          and ${writeFence}
          and not exists (
            select 1
            from temp_normalized_attachments source
            where source.email_id = target.${emailIdColumn}_id
              and source.attachment_id = target.attachment_id
          )`);
      s.modify(sql`update ${sql.ref(this.attachmentsTable)} target
        set kind = source.kind,
            filename = source.filename,
            content_type = source.content_type,
            content_id = source.content_id,
            data = coalesce(target.data, source.blob_id),
            is_inline = source.is_inline,
            external_url = source.external_url,
            size_bytes = source.size_bytes,
            provider_deleted_at = null
        from temp_normalized_attachments source
        where target.${emailIdColumn}_id = source.email_id
          and target.attachment_id = source.attachment_id
          and ${writeFence}`);
      s.modify(sql`insert into ${sql.ref(this.attachmentsTable)}
          (
            ${emailIdColumn}_id,
            attachment_id,
            kind,
            filename,
            content_type,
            content_id,
            data,
            is_inline,
            external_url,
            size_bytes
          )
        select
          source.email_id,
          source.attachment_id,
          source.kind,
          source.filename,
          source.content_type,
          source.content_id,
          source.blob_id,
          source.is_inline,
          source.external_url,
          source.size_bytes
        from temp_normalized_attachments source
        where ${writeFence}
          and not exists (
            select 1
            from ${sql.ref(this.attachmentsTable)} target
            where target.${emailIdColumn}_id = source.email_id
              and target.attachment_id = source.attachment_id
          )`);
      s.modify(sql`update ${sql.ref(this.emailTable)} email
        set has_attachments = exists (
          select 1
          from ${sql.ref(this.attachmentsTable)} attachment
          where attachment.${emailIdColumn}_id = email.id
            and attachment.provider_deleted_at is null
        )
        where email.id in (
          select email_id from temp_synced_attachment_email_ids
        )
          and ${writeFence}`);
    });
  }

  getEmail<T extends IServerBaseStatements>(
    s: T,
    opts: GetSingleEmailOpts,
  ): void {
    this.#outlook.messages.get(s, {
      ...opts,
    });
  }
  markAsRead<T extends IServerBaseStatements>(
    s: T,
    opts: MarkAsReadOpts,
  ): void {
    s.defScalar(
      "mark_as_read_credential_id",
      sql`(
        select credential_id
        from user_outlook_emails_accounts
        where id = ${opts.accountId}
          and sys_user_id = current_user
          and status = 'active'
      )`,
    );
    s.throwErrorIf(
      sql`mark_as_read_credential_id is null`,
      sql.lit`The selected Outlook account is unavailable.`,
    );
    this.#outlook.messages.markAsRead(s, {
      ...opts,
      messageId: opts.emailId,
      ...this.#getOauthOpts(
        sql`mark_as_read_credential_id`,
        !!this.#caps?.fetch_emails,
      ),
    });
  }
  navigateToOauth(s: DomStatements): void {
    s.defScalar("oauth_start_error", {
      type: "String",
    });
    s.defScalar("authorize_url", {
      type: "String",
    });
    s.tryServer({
      body: (s) => {
        s.getHeader(sql.lit`yolm-origin-domain`, "oauth_origin_domain");
        s.defScalar(
          "oauth_origin_domain_lower",
          sql`lower(coalesce(oauth_origin_domain, ''))`,
        );
        // Must match the URL the block registered with `system.globalApi.get`
        // above (and the calendar block's convention). Microsoft will redirect
        // back here after consent, and the global handler dispatches to the
        // per-app `/can-write/outlook-email-oauth-callback` endpoint.
        s.defScalar(
          "oauth_redirect_uri",
          sql`case when ${
            isLocalhostHost(sql`oauth_origin_domain_lower`)
          } then 'http://localhost:3000/can-write/outlook-email-oauth-redirect' else 'https://yolmglobalapi.com/can-write/outlook-email-oauth-redirect' end`,
        );
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`start_flow`,
          requestJson: sql`json_build_object(
            'provider', ${sql.lit(this.opts.provider)},
            'scopes', ${this.opts.scopes},
            'redirect_uri', oauth_redirect_uri
          )`,
          resultJsonScalar: "start_flow_result",
          errorJsonScalar: "start_flow_error",
          optIn: !!this.#caps?.oauth,
        });
        s.if(sql`start_flow_error is not null`, (s) => {
          s.setScalar(
            "oauth_start_error",
            sql`coalesce(start_flow_error->>'message', 'Failed to start OAuth flow')`,
          );
          s.return();
        });
        s.setScalar("authorize_url", sql`start_flow_result->>'authorize_url'`);
        s.defScalar(
          "oauth_flow_state",
          sql`uri.form_url_decode(
            regex.capture(authorize_url, '[?&]state=([^&]+)', 1)
          )`,
        );
        s.if(sql`oauth_flow_state is null`, (s) => {
          s.setScalar(
            "oauth_start_error",
            sql.lit`The managed OAuth flow did not return a state value`,
          );
          s.return();
        });
        s.setCookie(
          sql.lit`outlook_email_oauth_preferences`,
          sql`json_build_object(
            'oauth_state', oauth_flow_state
          )::string`,
          {
            path: "/",
            expires: sql`date.add(minute, 15, now())`,
            secure: sql`not ${isLocalhostHost(sql`oauth_origin_domain_lower`)}`,
            httpOnly: sql`true`,
            sameSite: "Lax",
          },
        );
      },
      errorName: "start_flow_proc_error",
      catch: (s) => {
        s.setScalar(
          "oauth_start_error",
          sql`coalesce(start_flow_proc_error.message, 'Failed to start OAuth flow')`,
        );
      },
    });
    s.if(sql`oauth_start_error is not null`, (s) => {
      s.location.assign(
        sql.concat(
          "/oauth-error?error_msg=",
          sql`uri.encode_component(oauth_start_error)`,
        ),
      );
    }, (s) => {
      s.location.assign(sql`authorize_url`);
    });
  }

  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteAccountOpts,
  ): void {
    s.defRecord(
      "account_to_delete",
      sql`select *
        from user_outlook_emails_accounts
        where id = ${opts.accountId}
          and sys_user_id = current_user`,
    );
    s.if(sql`account_to_delete.id is null`, (s) => {
      s.throwError(sql.lit`Outlook account not found`);
    });
    s.serviceRequest({
      serviceType: sql.lit`managed_oauth`,
      operation: sql.lit`disconnect`,
      requestJson:
        sql`json_build_object('credential_id', account_to_delete.credential_id)`,
      resultJsonScalar: "__outlook_email_disconnect_result",
      errorJsonScalar: "__outlook_email_disconnect_error",
      optIn: !!this.#caps?.oauth,
      mockProcedure: (s) =>
        s.return(sql`json_build_object('disconnected', true)`),
    });
    s.if(
      sql`__outlook_email_disconnect_error is not null
        and lower(coalesce(
          __outlook_email_disconnect_error->>'message',
          __outlook_email_disconnect_error->>'error',
          ''
        )) not like '%credential not found%'`,
      (s) => {
        s.throwError(
          sql`coalesce(
            __outlook_email_disconnect_error->>'message',
            __outlook_email_disconnect_error->>'error',
            'Unable to disconnect the Outlook credential'
          )`,
        );
      },
    );
    s.startTransaction();
    s.modify(sql`update ${sql.ref(this.emailTable)} email
      set provider_deleted_at = coalesce(provider_deleted_at, now())
      where email.user_outlook_emails_account_id = account_to_delete.id
        and exists (
          select 1
          from user_outlook_emails_accounts account
          where account.id = account_to_delete.id
            and account.sys_user_id = current_user
            and account.credential_id = account_to_delete.credential_id
        )`);
    s.modify(
      sql`delete from ${
        sql.ref(this.accountTable)
      } where id = account_to_delete.id
          and sys_user_id = current_user
          and credential_id = account_to_delete.credential_id`,
    );
    s.if(
      sql`exists (
        select 1
        from user_outlook_emails_accounts
        where id = account_to_delete.id
          and sys_user_id = current_user
      )`,
      (s) => {
        s.throwError(
          sql
            .lit`The Outlook account was reconnected while it was being removed`,
        );
      },
    );
    s.commitTransaction();
  }

  watchInbox<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
      expectedResourceId?: AnyExpr;
      propagateTransientErrors?: boolean;
    },
  ) {
    s.block((s) => {
      const accountResourceMatches = opts.expectedResourceId
        ? sql`account_record.notification_resource_id =
          ${opts.expectedResourceId}`
        : sql`account_record.notification_resource_id is null`;
      const storedResourceMatches = opts.expectedResourceId
        ? sql`notification_resource_id = ${opts.expectedResourceId}`
        : sql`notification_resource_id is null`;
      s.defRecord(
        "account_record",
        sql`select * from user_outlook_emails_accounts where id = ${opts.accountId}`,
      );
      s.if(
        sql`account_record.status = 'active'
          and account_record.credential_id is not null
          and ${accountResourceMatches}`,
        (s) => {
          s.defScalar(
            "watch_client_state",
            sql`case
          when starts_with(
            coalesce(account_record.notification_client_state, ''),
            ${sql.lit(OUTLOOK_NOTIFICATION_CLIENT_STATE_PREFIX)}
          ) then account_record.notification_client_state
          else ${sql.lit(OUTLOOK_NOTIFICATION_CLIENT_STATE_PREFIX)}
            || random.uuid()::string
        end`,
          );
          const firstNotificationDomain = Array.isArray(
              this.opts.notificationDomain,
            )
            ? this.opts.notificationDomain[0]
            : this.opts.notificationDomain;
          const notificationUrl = this.opts.devNotificationUrl
            ? sql.lit(this.opts.devNotificationUrl)
            : sql
              .lit`https://${firstNotificationDomain}/api/azure-email-notifications`;
          s.try({
            body: (s) => {
              this.#outlook.messages.watch(s, {
                accountId: sql`${opts.accountId}`,
                clientState: sql`watch_client_state`,
                notificationUrl,
                ...this.#getOauthOpts(
                  sql`account_record.credential_id`,
                  !!this.#caps?.fetch_emails,
                ),
              });
              s.if(sql`watch_response.id is null`, (s) => {
                s.throwError(
                  sql`concat('outlook email watch response missing resource id for account_id=', ${opts.accountId}::string, ' expiration=', coalesce(watch_response.expiration, 'NULL'))`,
                );
              });
              s.startTransaction();
              s.modify(sql`update user_outlook_emails_accounts
                  set notification_resource_id = watch_response.id,
                  notification_client_state = watch_client_state,
                  expiration_date_time = coalesce(
                    try_cast(watch_response.expiration as timestamptz) at time zone current_timezone at time zone current_timezone,
                    try_cast(watch_response.expiration as timestamp) at time zone 'UTC',
                    date.add(day, 2, now() at time zone current_timezone) at time zone current_timezone
                  )
                  where id = ${opts.accountId}
                    and status = 'active'
                    and credential_id = account_record.credential_id
                    and ${storedResourceMatches}
                `);
              s.commitTransaction();
              s.defScalar(
                "stored_watch_resource_id",
                sql`(
                  select notification_resource_id
                  from db.user_outlook_emails_accounts
                  where id = ${opts.accountId}
                )`,
              );
              s.if(
                sql`coalesce(stored_watch_resource_id, '') !=
                  coalesce(watch_response.id, '')`,
                (s) => {
                  this.#outlook.messages.stopWatch(s, {
                    resourceId: sql`watch_response.id`,
                    ...this.#getOauthOpts(
                      sql`account_record.credential_id`,
                      !!this.#caps?.fetch_emails,
                    ),
                  });
                  s.throwError(
                    sql`concat(
                      'Outlook subscription creation lost account compare-and-set for account_id=',
                      ${opts.accountId}::string,
                      ' created_subscription_id=',
                      coalesce(watch_response.id, 'NULL'),
                      ' stored_subscription_id=',
                      coalesce(stored_watch_resource_id, 'NULL')
                    )`,
                  );
                },
              );
            },
            errorName: "watch_error",
            catch: (s) => {
              s.rollbackIfInTransaction();
              s.defScalar(
                "watch_error_message",
                sql`left(coalesce(watch_error.message, ''), 5000)`,
              );
              s.startTransaction();
              s.modify(
                sql`insert into db.user_outlook_email_integration_logs
                  (operation, error_message, user_outlook_emails_account_id)
                values (
                  'watch',
                  concat(watch_error.type, ': ', watch_error_message, ' ', coalesce(watch_error.description, '')),
                  ${opts.accountId}
                )`,
              );
              s.commitTransaction();
              this.#markReauthOnTokenError(s, {
                errorMessage: sql`watch_error_message`,
                accountWhere: sql`id = ${opts.accountId}
                  and credential_id = account_record.credential_id
                  and status = 'active'`,
              });
              if (opts.propagateTransientErrors) {
                s.throwError(
                  sql`coalesce(nullif(watch_error_message, ''), 'Outlook email watch failed')`,
                );
              } else {
                s.defScalar(
                  "is_handled_ms_watch_error",
                  sql`watch_error_message like '%MailboxCrossSiteFailoverException%'
                  or watch_error_message like '%MapiExceptionMdbOffline%'
                  or watch_error_message like '%QuotaExceededException%'
                  or watch_error_message like '%MapiExceptionShutoffQuotaExceeded%'
                  or watch_error_message like '%Too Many Requests%'
                  or watch_error_message like '%Status Code: 429%'
                  or watch_error_message like '%Failed to watch outlook events: 429%'
                  or watch_error_message like '%Notification URL%verification failed%'
                  or watch_error_message like '%Subscription validation request timed out%'`,
                );
                s.if(sql`is_handled_ms_watch_error`, () => {}, (s) => {
                  s.throwError(
                    sql`coalesce(nullif(watch_error_message, ''), 'Outlook email watch failed')`,
                  );
                });
              }
            },
          });
        },
      );
    });
  }

  stopWatchInbox<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "account_record",
        sql`select * from user_outlook_emails_accounts where id = ${opts.accountId}`,
      );
      s.if(
        sql`account_record.status = 'active'
          and account_record.credential_id is not null
          and account_record.notification_resource_id is not null`,
        (s) => {
          this.#outlook.messages.stopWatch(s, {
            resourceId: sql`account_record.notification_resource_id`,
            ...this.#getOauthOpts(
              sql`account_record.credential_id`,
              !!this.#caps?.fetch_emails,
            ),
          });
          s.startTransaction();
          s.modify(sql`update user_outlook_emails_accounts
              set notification_resource_id = null
              where id = ${opts.accountId}`);
          s.modify(
            sql`update ${sql.ref(this.emailTable)}
                set provider_deleted_at = coalesce(provider_deleted_at, now())
                where user_outlook_emails_account_id = ${opts.accountId}`,
          );
          s.commitTransaction();
        },
      );
    });
  }

  private defineTemporaryTables<T extends IServerBaseStatements>(s: T): void {
    s.defTable("temp_table", {
      fields: [
        { name: "user_outlook_emails_account_id", type: "BigInt" },
        {
          name: "message_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        { name: "from", type: "String" },
        { name: "from_email", type: "String" },
        { name: "reply_to", type: "String" },
        { name: "date", type: "Timestamp" },
        {
          name: "thread_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        { name: "subject", type: "String" },
        { name: "snippet", type: "String" },
        { name: "body_text", type: "String" },
        {
          name: "message_reply_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        { name: "body_blob", type: { type: "Bytes", maxLength: 32 } },
        {
          name: "in_reply_to",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        { name: "message_references", type: "Json" },
        {
          name: "thread_key",
          type: { type: "String", maxLength: 600, collation: "Binary" },
        },
        {
          name: "identity_key",
          type: { type: "String", maxLength: 600, collation: "Binary" },
        },
        { name: "user_email_identity_id", type: "BigInt" },
        { name: "is_read", type: "Bool" },
        { name: "has_attachments", type: "Bool" },
      ],
    });
    s.defTable("temp_table_recipients", {
      fields: [
        { name: "user_outlook_emails_account_id", type: "BigInt" },
        {
          name: "message_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        { name: "email", type: "String" },
        { name: "recipient_type", type: "String" },
      ],
    });
    this.defineTemporaryAttachmentSyncTables(s);
  }

  private defineTemporaryAttachmentSyncTables<
    T extends IServerBaseStatements,
  >(
    s: T,
  ): void {
    this.defineTemporaryAttachmentTable(s);
    s.defTable("temp_attachment_sync", {
      fields: [
        { name: "user_outlook_emails_account_id", type: "BigInt" },
        {
          name: "message_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
      ],
    });
  }

  private defineTemporaryAttachmentTable<T extends IServerBaseStatements>(
    s: T,
  ): void {
    s.defTable("temp_table_attachments", {
      fields: [
        { name: "user_outlook_emails_account_id", type: "BigInt" },
        {
          name: "message_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        {
          name: "attachment_id",
          type: { type: "String", maxLength: 500, collation: "Binary" },
        },
        { name: "attachment_type", type: "String" },
        { name: "filename", type: "String" },
        { name: "content_type", type: "String" },
        { name: "content_id", type: "String" },
        { name: "is_inline", type: "Bool" },
        { name: "blob_id", type: { type: "Bytes", maxLength: 32 } },
        { name: "external_url", type: { type: "String", maxLength: 5000 } },
        { name: "provider_type", type: "String" },
        { name: "size_bytes", type: "BigInt" },
      ],
    });
  }
}

function EmailsOutlookPage(props: { where: Sql; path: string }) {
  const block = system.block(OutlookEmailIntegration);
  return (
    <SearchCardPage
      table={block.emailTable}
      path={props.path}
      watch={[sql`refresh_key`]}
      stateStatements={(s) => {
        s.defScalar("expanded_email_id", {
          type: { type: "BigInt" },
        });
      }}
      search
      header={
        <Typography level="h2" className="mb-8">
          Outlook Emails
        </Typography>
      }
      recordName="email"
      display="list"
      card={
        <EmailItem
          integrationTable={block.emailTable}
          recipientsTable={block.recipientsTable}
          attachmentsTable={block.attachmentsTable}
          recieved
          bodyFieldNode={<OutlookBodyFieldNode />}
        />
      }
      where={props.where}
      orderBy={sql`date desc`}
      pageSize={25}
      gridSx={{ gap: 0 }}
    />
  );
}

function EmailsOutlookList(props: { where: Sql }) {
  const block = system.block(OutlookEmailIntegration);
  return (
    <QueryParams params={[{ name: "search_query", type: "String" }]}>
      <SearchCard
        table={block.emailTable}
        watch={[sql`refresh_key`]}
        stateStatements={(s) => {
          s.defScalar("expanded_email_id", {
            type: { type: "BigInt" },
          });
        }}
        search
        header={
          <Typography level="h2" className="mb-8">
            Outlook Emails
          </Typography>
        }
        recordName="email"
        display="list"
        card={
          <EmailItem
            integrationTable={block.emailTable}
            recipientsTable={block.recipientsTable}
            attachmentsTable={block.attachmentsTable}
            recieved
            bodyFieldNode={<OutlookBodyFieldNode />}
          />
        }
        where={props.where}
        orderBy={sql`date desc`}
        pageSize={25}
        gridSx={{ gap: 0 }}
      />
    </QueryParams>
  );
}

function OutlookBodyFieldNode() {
  const block = system.block(OutlookEmailIntegration);
  return (
    <EmailBodyFieldNode
      integrationTable={block.emailTable}
      attachmentsTable={block.attachmentsTable}
    />
  );
}
