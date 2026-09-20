import { Alert } from "components/alert";
import { GmailIcon } from "components/icons/gmail";
import { Typography } from "components/typography";
import { SearchCard, SearchCardPage } from "pages/search_card_page";
import type { Oauth2TokenOpts } from "services/google/auth";
import { Gmail } from "services/google/gmail";
import { GoogleUserInfo } from "services/google/user_info";
import { AuthApiICtxKey } from "std/ictx";
import {
  isLocalhostHost,
  localhostAwareScheme,
  queryParamsString,
} from "std/services";
import { singularize } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  HelperProcField,
  IServerBaseStatements,
  StateStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { system } from "std/system";
import type { App } from "std/system";
import type { QueryParam } from "std/yom";
import { QueryParams, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { getCapabilities } from "std/yolm_gen_api";
import { EmailItem } from "./common";
import type {
  DeleteAccountOpts,
  EmailIntegration,
  MarkAsReadOpts,
  SendEmailFromServerOpts,
  SendEmailOpts,
} from "./index";
import {
  defineServerEmailAttachments,
  registerServerEmailAttachmentProcedure,
} from "./server_attachments";
import { registerEmailDraftProcedure } from "./drafts";

interface GmailIntegrationOptions {
  provider: string;
  scopes: Sql;
  devNotificationUrl: string;
  hasCrmBlock?: boolean;
  extensions?: GmailIntegrationExtensions;
}

/** Optional hooks for customizing {@link GmailIntegration} behavior. */
export interface GmailIntegrationExtensions {
  /** Runs when a Gmail push notification webhook is received, with its body. */
  onNotificationReceived?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { body: Sql },
  ) => void;
}
interface ListEmailsOpts {
  accountId: Sql;
  maxResults?: AnyExpr;
  pageToken?: Sql;
  query?: Sql;
  labelIds?: Sql[];
}
/**
 * Gmail email integration for the CRM block.
 *
 * Drops into `CrmBlock`'s `emailIntegrations` array to enable per-user
 * OAuth-connected Gmail mailboxes. Provides OAuth account connect/disconnect
 * (`navigateToOauth`, `deleteAccount`, `addOauthRedirect`), outbound send
 * (`sendEmail`), inbox sync via Gmail push notifications (`watchInbox`,
 * `listEmails`, `saveMessages`), and message read/state
 * (`markAsRead`, `markAsUnread`). When `hasCrmBlock` is set, emails are stored in
 * the shared `user_all_emails` tables; otherwise in Gmail-specific tables.
 *
 * @see docs/blocks/crm.md
 */
export class GmailIntegration implements EmailIntegration {
  blockName = "GmailIntegration";
  blockDisplayName = "Gmail";
  externalServiceOptions = [
    { optionKey: "oauth", optionLabel: "OAuth" },
    { optionKey: "send_emails", optionLabel: "Send emails" },
    { optionKey: "fetch_emails", optionLabel: "Fetch and read emails" },
  ];
  #caps = getCapabilities()?.blocks?.GmailIntegration;
  #gmail: Gmail;
  #userInfo: GoogleUserInfo;

  accountTable = "user_gmail_accounts";
  integrationKey = "gmail";
  deliveryLimits = {
    maxMessagesPerMinute: 60,
    maxRecipientsPer24Hours: 500,
  };
  emailTable: string;
  recipientsTable: string;
  attachmentsTable: string;
  aliasTable = "user_gmail_aliases";
  integrationName = "Gmail";
  emailsPage = (props: { where: Sql; path: string }) => (
    <EmailsGmailPage
      where={props.where}
      path={props.path}
    />
  );
  emailsList = (props: { where: Sql }) => (
    <EmailsGmailList where={props.where} />
  );
  bodyFieldNode = <GmailBodyFieldNode />;

  icon: (props: { sx?: Style }) => Node = ({ sx }) => <GmailIcon sx={sx} />;

  accountDisplay = sql`account.email`;

  constructor(private opts: GmailIntegrationOptions) {
    this.#gmail = new Gmail();
    this.#userInfo = new GoogleUserInfo();
    if (this.opts.hasCrmBlock) {
      this.emailTable = "user_all_emails";
      this.recipientsTable = "user_email_recipients";
      this.attachmentsTable = "user_email_attachments";
    } else {
      this.emailTable = "user_gmail_emails";
      this.recipientsTable = "user_gmail_recipients";
      this.attachmentsTable = "user_gmail_email_attachments";
    }
  }

  initialize() {
    const db = system.db;
    system.enum_({
      name: "sync_status_enum",
      values: ["pending", "syncing", "completed", "failed"],
    });
    system.enum_({
      name: "recipient_type_enum",
      values: ["to", "cc", "bcc"],
    });
    system.enum_({
      name: "gmail_connection_status",
      values: ["active", "reauth_required"],
    });
    system.enum_({
      name: "gmail_chosen_emails_enum",
      values: ["allEmails", "allExceptSpam", "allExceptSocialSpamPromotions"],
    });
    db.table("user_gmail_accounts", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.string("email", 500);
      table.bigUint("credential_id").notNull().unique();
      table.string("provider_subject", 500);
      table.enum("status", "gmail_connection_status")
        .notNull()
        .default(sql`'active'`);
      table.enum("sync_status", "sync_status_enum").notNull();
      table.date("chosen_sync_date");
      table.enum("chosen_emails", "gmail_chosen_emails_enum");
      table.string("notification_history_id", 100);
      table.timestamp("notification_expiration");
    });

    db.table("user_gmail_aliases", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("user_gmail_accounts").notNull().onDelete("Cascade");
      table.string("email", 500);
    });
    db.table("user_gmail_sync_logs", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("user_gmail_accounts").notNull().onDelete("Cascade");
      table.string("message", 1000);
      table.string("status", 100);
    });
    //for some reason this is false even though the block is loaded.
    if (!this.opts.hasCrmBlock) {
      db.table("user_gmail_emails", (table) => {
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("user_gmail_accounts").notNull().onDelete("Cascade");
        table.string("message_id", 100).notNull();
        table.string("subject", 1000);
        table.string("snippet", 1000);
        table.string("from", 500);
        table.string("from_email", 500);
        table.string("reply_to", 2000);
        table.string("thread_id", 500);
        table.timestamp("date");
        table.string("body_text", 1000000);
        table.bool("is_read").notNull().default(false);
        table.string("message_reply_id", 500);
        table.searchConfig({
          fields: [
            {
              field: "subject",
              priority: 1,
            },
          ],
        });
      });
      db.table("user_gmail_recipients", (table) => {
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("user_gmail_emails").notNull().onDelete("Cascade");
        table.string("email", 500);
        table.string("recipient_address", 500);
        table.enum("recipient_type", "recipient_type_enum").notNull();
      });

      db.table("user_gmail_email_attachments", (table) => {
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("user_gmail_emails").notNull().onDelete("Cascade");
        table.string("message_id", 100).notNull();
        table.string("attachment_id", 500);
        table.string("attachment_type", 100);
        table.string("filename", 500);
        table.string("content_type", 500);
        table.blobRef("data", 64).notNull();
        table.string("ccid", 1000);
        table.string("external_url", 5000);
        table.string("provider_type", 100);
      });
    }

    system.addReactor({
      name: "gmail_sync_pending",
      query: sql`select * from ${
        sql.ref(this.accountTable)
      } where sync_status = 'pending' and status = 'active' and credential_id is not null`,
      recordName: "account",
      maxConcurrent: 5,
      procedure: (s) => {
        s.defScalar("query", sql.lit``);
        s.try({
          body: (s) => {
            s.cases({
              cases: [
                {
                  condition: sql`account.chosen_emails = 'allEmails'`,
                  body: (s) => {
                    s.setScalar("query", sql.lit``);
                  },
                },
                {
                  condition: sql`account.chosen_emails = 'allExceptSpam'`,
                  body: (s) => {
                    s.setScalar("query", sql.lit` -category:spam`);
                  },
                },
                {
                  condition:
                    sql`account.chosen_emails = 'allExceptSocialSpamPromotions'`,
                  body: (s) => {
                    s.setScalar(
                      "query",
                      sql
                        .lit` -category:promotions -category:social -category:forums `,
                    );
                  },
                },
              ],
            });
            this.listEmails(s, {
              accountId: sql`account.id`,
              maxResults: 100,
              query:
                sql`case when account.chosen_sync_date is not null then 'after:' || ${sql`account.chosen_sync_date`} || ' ' || query else query end`,
            });
          },
          errorName: "list_emails_error",
          catch: (s) => {
            s.debugExpr(sql`list_emails_error.message`);
          },
        });
      },
    });

    system.addReactor({
      name: "gmail_watch_inbox",
      query: sql`select * from ${
        sql.ref(this.accountTable)
      } where notification_history_id is null and status = 'active' and credential_id is not null`,
      recordName: "account",
      maxConcurrent: 5,
      procedure: (s) => {
        this.watchInbox(s, { accountId: sql`account.id` });
      },
    });

    system.addReactor({
      name: "gmail_renew_subscriptions",
      query: sql`select * from ${
        sql.ref(this.accountTable)
      } where abs(date.duration(hour, now(), notification_expiration)) <= 6`,
      recordName: "account",
      maxConcurrent: 5,
      procedure: (s) => {
        this.stopwatchInbox(s, { accountId: sql`account.id` });
        this.watchInbox(s, { accountId: sql`account.id` });
      },
    });
  }

  isActiveAccount: BooleanExpr = sql`status = 'active'`;

  populate() {
    registerServerEmailAttachmentProcedure();
    registerEmailDraftProcedure();
  }

  availableSendersQuery(userId: Sql) {
    return sql`select account.id as account_id,
               lower(trim(account.email)) as from_address,
               coalesce(
                 nullif(trim(account.provider_subject), ''),
                 lower(trim(account.email))
               ) as mailbox_identity
        from user_gmail_accounts account
        where account.sys_user_id = ${userId} and account.status = 'active'
          and account.email is not null and trim(account.email) != ''
      union
      select alias.user_gmail_account_id as account_id,
             lower(trim(alias.email)) as from_address,
             coalesce(
               nullif(trim(account.provider_subject), ''),
               lower(trim(account.email))
             ) as mailbox_identity
        from user_gmail_aliases alias
        join user_gmail_accounts account on account.id = alias.user_gmail_account_id
        where account.sys_user_id = ${userId} and account.status = 'active'
          and alias.email is not null and trim(alias.email) != ''`;
  }

  mailboxIdentityQuery(accountId: AnyExpr) {
    return sql`(select coalesce(
        nullif(trim(provider_subject), ''),
        lower(trim(email))
      ) from user_gmail_accounts where id = ${accountId})`;
  }

  accountOwnerQuery(accountId: AnyExpr) {
    return sql`(select sys_user_id from user_gmail_accounts
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
    optIn?: boolean,
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
          sql`update user_gmail_accounts set status = 'reauth_required'
          where credential_id = ${credentialId}`,
        );
        s.commitTransaction();
        if (opts?.throwOnReauth) {
          s.throwError(
            sql.lit`The selected Gmail account must be reconnected.`,
          );
        }
      },
      optIn,
      extensions: opts?.extensions,
    };
  };

  getAttachmentUrl(blobId: Sql) {
    return sql.concat(
      "/api/",
      this.attachmentsTable,
      "/",
      sql`bytes.to_hex(${blobId})`,
    );
  }

  sendEmail<T extends DomStatements>(s: T, opts: SendEmailOpts): void {
    s.tryServer({
      body: (s) => {
        s.defScalar(
          "send_email_credential_id",
          sql`(select credential_id
            from user_gmail_accounts
            where id = ${opts.accountId}
              and sys_user_id = current_user
              and status = 'active')`,
        );
        s.if(sql`send_email_credential_id is null`, (s) => {
          s.throwError(
            sql.lit`The selected Gmail account is unavailable for sending`,
          );
        });

        opts.beforeEmailSent?.(s, {
          provider: "gmail",
          accountId: opts.accountId,
          to: opts.to,
          cc: opts.cc,
          bcc: opts.bcc,
          subject: opts.subject,
          body: opts.body,
          from: opts.from,
          threadId: opts.threadId,
          isReply: opts.isReply,
          inReplyTo: opts.inReplyTo,
          references: opts.references,
          attachments: opts.attachments,
        });
        this.sendInteractiveEmail(s, opts, sql`send_email_credential_id`);
        opts.afterEmailSent?.(s, {
          provider: "gmail",
          accountId: opts.accountId,
          to: opts.to,
          cc: opts.cc,
          bcc: opts.bcc,
          subject: opts.subject,
          body: opts.body,
          from: opts.from,
          threadId: opts.threadId,
          isReply: opts.isReply,
          inReplyTo: opts.inReplyTo,
          references: opts.references,
          attachments: opts.attachments,
        });
      },
      errorName: "send_email_error",
      catch: (s) => {
        opts.onEmailSendError?.(s, {
          provider: "gmail",
          accountId: opts.accountId,
          to: opts.to,
          cc: opts.cc,
          bcc: opts.bcc,
          subject: opts.subject,
          body: opts.body,
          from: opts.from,
          threadId: opts.threadId,
          isReply: opts.isReply,
          inReplyTo: opts.inReplyTo,
          references: opts.references,
          attachments: opts.attachments,
          errorMessage: sql`send_email_error.message`,
        });
        s.debugExpr(sql`send_email_error.message`);
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
    const name = `gmail_send_interactive_${opts.attachments?.length ?? 0}_${
      opts.isReply ? 1 : 0
    }_${opts.inReplyTo ? 1 : 0}_${opts.threadId ? 1 : 0}`;
    const fields: HelperProcField[] = [
      { name: "p_account_id", type: "BigInt" },
      { name: "p_credential_id", type: "BigInt" },
      { name: "p_to", type: "String" },
      { name: "p_cc", type: "String" },
      { name: "p_bcc", type: "String" },
      { name: "p_subject", type: "String" },
      { name: "p_body", type: "String" },
      { name: "p_from", type: "String" },
      { name: "p_in_reply_to", type: "String" },
      { name: "p_references", type: "String" },
      { name: "p_thread_id", type: "String" },
    ];
    const inputs: Record<string, Sql> = {
      p_account_id: opts.accountId,
      p_credential_id: credentialId,
      p_to: opts.to,
      p_cc: opts.cc ?? sql.lit``,
      p_bcc: opts.bcc ?? sql.lit``,
      p_subject: opts.subject,
      p_body: opts.body,
      p_from: opts.from,
      p_in_reply_to: opts.inReplyTo ?? sql.null,
      p_references: opts.references ?? sql.null,
      p_thread_id: opts.threadId ?? sql.null,
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
          this.#gmail.messages.send(s, {
            ...this.#getOauthOpts(
              sql`p_credential_id`,
              !!this.#caps?.send_emails,
              { throwOnReauth: true },
            ),
            accountId: sql`p_account_id`,
            toTable: sql`p_to`,
            ccTable: sql`p_cc`,
            bccTable: sql`p_bcc`,
            subject: sql`p_subject`,
            body: sql`p_body`,
            from: sql`p_from`,
            threadId: opts.threadId ? sql`p_thread_id` : undefined,
            isReply: opts.isReply,
            inReplyTo: opts.inReplyTo ? sql`p_in_reply_to` : undefined,
            references: sql`p_references`,
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
    const cc = opts.cc ?? sql`null`;
    const bcc = opts.bcc ?? sql`null`;
    if (opts.onEmailSendError) {
      s.defScalar("gmail_delivery_may_have_occurred", false);
    }
    s.defRecord(
      "gmail_server_email_account",
      sql`select credential_id
        from user_gmail_accounts
        where id = ${opts.accountId}
          and sys_user_id = current_user
          and status = 'active'`,
    );
    const hookContext = {
      provider: "gmail" as const,
      accountId: opts.accountId,
      to: opts.to,
      cc: cc,
      bcc: bcc,
      subject: opts.subject,
      body: opts.body,
      from: opts.from,
      attachments: opts.attachments,
    };
    s.try({
      body: (s) => {
        s.throwErrorIf(
          sql`gmail_server_email_account.credential_id is null`,
          sql.lit`The selected Gmail account is unavailable for sending.`,
        );
        s.throwErrorIf(
          sql`not exists (
            select 1
            from (${this.availableSendersQuery(sql`current_user`)}) sender
            where sender.account_id = ${opts.accountId}
              and lower(trim(sender.from_address)) =
                lower(trim(coalesce(cast(${opts.from} as string), '')))
          )`,
          sql.lit`The selected Gmail sender no longer matches this draft.`,
        );
        const attachmentsTable = opts.attachmentsQuery
          ? defineServerEmailAttachments(
            s,
            opts.attachmentsQuery,
            "gmail_server_email",
          )
          : undefined;
        const oauthOpts = this.#getOauthOpts(
          sql`gmail_server_email_account.credential_id`,
          !!this.#caps?.send_emails,
          {
            throwOnReauth: true,
            extensions: {
              beforeRequest: (s) => {
                opts.beforeEmailSent?.(s, hookContext);
                if (opts.onEmailSendError) {
                  s.setScalar("gmail_delivery_may_have_occurred", true);
                }
              },
              afterRequest: (s, { responseRecord }) => {
                if (opts.onEmailSendError) {
                  s.if(
                    sql`${sql.ref(responseRecord)}.status between 400 and 499
                      and ${sql.ref(responseRecord)}.status != 408`,
                    (s) => {
                      s.setScalar("gmail_delivery_may_have_occurred", false);
                    },
                  );
                }
              },
            },
          },
        );
        this.#gmail.messages.send(s, {
          ...oauthOpts,
          accountId: opts.accountId,
          toTable: opts.to,
          ccTable: cc,
          bccTable: bcc,
          subject: opts.subject,
          body: opts.body,
          from: opts.from,
          attachments: opts.attachments,
          attachmentsTable,
        });
        opts.afterEmailSent?.(s, hookContext);
      },
      errorName: "send_email_from_server_error",
      catch: (s) => {
        opts.onEmailSendError?.(s, {
          provider: "gmail",
          accountId: opts.accountId,
          to: opts.to,
          cc: opts.cc,
          bcc: opts.bcc,
          subject: opts.subject,
          body: opts.body,
          from: opts.from,
          attachments: opts.attachments,
          errorMessage: sql`send_email_from_server_error.message`,
          deliveryMayHaveOccurred: sql`gmail_delivery_may_have_occurred`,
        });
        s.throwError(
          sql`coalesce(send_email_from_server_error.message, 'send failed')`,
        );
      },
    });
  }

  listEmails<T extends IServerBaseStatements>(
    s: T,
    opts: ListEmailsOpts,
  ): void {
    s.try({
      body: (s) => {
        const oauthOpts = this.#getOauthOpts(
          sql`(select credential_id from user_gmail_accounts where id = ${opts.accountId})`,
          !!this.#caps?.fetch_emails,
        );
        this.defineTemporaryTables(s);
        this.updateSyncLogStatus(s, {
          accountId: opts.accountId,
          status: sql.lit`syncing`,
          message: sql.lit`started syncing process`,
        });
        this.#gmail.messages.list(s, {
          ...oauthOpts,
          accountId: opts.accountId,
          emailsTable: "temp_table",
          recipientsTable: "temp_table_recipients",
          maxResults: opts.maxResults,
          pageToken: opts.pageToken,
          query: opts.query,
          labelIds: opts.labelIds,
          attachmentsTable: "temp_table_attachments",
        });
        this.saveMessages(s, {
          accountId: opts.accountId,
        });
      },
      errorName: "list_emails_error",
      catch: (s) => {
        s.debugExpr(sql`list_emails_error.message`);
      },
    });
  }

  saveMessages<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
    },
  ): void {
    s.startTransaction();

    s.modify(sql`merge into ${sql.ref(this.emailTable)} as target
      using temp_table as source
      on target.message_id = source.message_id
        and target.user_gmail_account_id = ${opts.accountId}
      when matched then update set
      subject = source.subject,
      snippet = regex.replace_all(
        regex.replace_all(
          regex.replace_all(
            regex.replace_all(
              regex.replace_all(source.snippet, '&#39;', ''''),
                       '&quot;', '"'),
                     '&amp;', '&'),
                   '&lt;', '<'),
                 '&gt;', '>'),
      from = source.from,
      from_email= case when source.from like '%<%>%' then substring(source.from from position('<' in source.from) + 1 for position('>' in source.from) - position('<' in source.from) - 1) else source.from end,
      reply_to = source.reply_to,
      date = source.date,
      body_text = source.body_text,
      thread_id = source.thread_id,
      is_read = source.is_read,
      message_reply_id = source.message_reply_id
      when not matched then insert
      (user_gmail_account_id, message_id, subject, snippet, from, from_email, reply_to, date, body_text, thread_id, is_read, message_reply_id)
      values
        (${opts.accountId}, source.message_id, source.subject,
        regex.replace_all(
          regex.replace_all(
            regex.replace_all(
              regex.replace_all(
                regex.replace_all(source.snippet, '&#39;', ''''),
                         '&quot;', '"'),
                       '&amp;', '&'),
                     '&lt;', '<'),
                   '&gt;', '>'),
        source.from, case when source.from like '%<%>%' then substring(source.from from position('<' in source.from) + 1 for position('>' in source.from) - position('<' in source.from) - 1) else source.from end, source.reply_to, source.date, source.body_text, source.thread_id, source.is_read, source.message_reply_id)
    `);

    // Reconcile complete snapshots, including messages with no recipients.
    // Replacing rows also repairs duplicates left by older sync implementations.
    s.block((s) => {
      s.defTable(
        "fetched_email_ids",
        sql`select email.id, email.message_id
        from ${sql.ref(this.emailTable)} email
        where email.user_gmail_account_id = ${opts.accountId}
          and exists (select 1 from temp_table fetched
            where fetched.message_id = email.message_id)`,
      );
      s.modify(sql`delete from ${sql.ref(this.recipientsTable)}
        where ${sql.ref(singularize(this.emailTable))}_id in
          (select id from fetched_email_ids)`);
      const recipientAddress =
        sql`case when source.email like '%<%>%' then substring(source.email from position('<' in source.email) + 1 for position('>' in source.email) - position('<' in source.email) - 1) else source.email end`;
      s.modify(sql`insert into ${sql.ref(this.recipientsTable)}
        (${
        sql.ref(singularize(this.emailTable))
      }_id, email, recipient_address, recipient_type)
        select fetched.id, min(source.email), ${recipientAddress},
          source.recipient_type::enums.recipient_type_enum
        from temp_table_recipients source
        join fetched_email_ids fetched on fetched.message_id = source.message_id
        group by fetched.id, ${recipientAddress},
          source.recipient_type::enums.recipient_type_enum`);
    });
    s.modify(sql`merge into ${sql.ref(this.attachmentsTable)} as target
      using temp_table_attachments as source
      on target.${sql.ref(singularize(this.emailTable))}_id = (
          select id
          from ${sql.ref(this.emailTable)}
          where message_id = source.message_id
            and user_gmail_account_id = ${opts.accountId}
        )
        and target.attachment_id = source.attachment_id
      when matched then update set
      ccid = source.ccid
      when not matched then insert
      (${
      sql.ref(singularize(this.emailTable))
    }_id, message_id, attachment_id, filename, content_type, data, ccid)
      values
      ((select id from ${
      sql.ref(this.emailTable)
    } where message_id = source.message_id
        and user_gmail_account_id = ${opts.accountId}), source.message_id, source.attachment_id, source.filename, source.content_type, crypto.random_bytes(16), source.ccid)
    `);
    s.commitTransaction();

    // TODO(request-streaming): remove this buffered base64url conversion once
    // outbound request streaming can decode Gmail's JSON `data` field directly
    // into the blob spool. The existing raw Blob receiver would store JSON.
    s.forEachQuery(
      sql`select distinct message_id, attachment_id, data
        from temp_table_attachments`,
      "attachment",
      (s) => {
        s.createBlob(
          sql`bytes.from_base64_url_safe(regex.replace_all(attachment.data, '=', ''))`,
          { defHashScalar: "blob_id" },
        );
        s.startTransaction();
        s.modify(
          sql`update ${sql.ref(this.attachmentsTable)} target set data = blob_id
          where target.attachment_id = attachment.attachment_id
            and target.${sql.ref(singularize(this.emailTable))}_id = (
              select id
              from ${sql.ref(this.emailTable)}
              where message_id = attachment.message_id
                and user_gmail_account_id = ${opts.accountId}
            )`,
        );
        s.commitTransaction();
      },
    );

    this.updateSyncLogStatus(s, {
      accountId: opts.accountId,
      status: sql.lit`completed`,
      message: sql.lit`completed syncing process`,
    });
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

    const body = (s: import("std/statements").EndpointStatements) => {
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
      s.startTransaction();
      s.modify(
        sql`merge into user_gmail_accounts as target
          using (select
            user_id as sys_user_id,
            (callback_result->>'credential_id')::bigint as credential_id,
            callback_result->>'provider_email' as email,
            callback_result->>'provider_subject' as provider_subject,
            'active' as status
          ) as source
          on target.sys_user_id = source.sys_user_id and target.email = source.email
          when matched then
            update set
              credential_id = source.credential_id,
              email = source.email,
              provider_subject = source.provider_subject,
              status = source.status,
              sync_status = 'pending'
          when not matched then
            insert (sys_user_id, credential_id, email, provider_subject, status, sync_status)
            values (source.sys_user_id, source.credential_id, source.email, source.provider_subject, source.status, 'pending')`,
      );
      s.defScalar(
        "gmail_callback_account_id",
        sql`(select id from user_gmail_accounts where sys_user_id = user_id and credential_id = (callback_result->>'credential_id')::bigint)`,
      );
      s.commitTransaction();

      // Fetch aliases using managed oauth (must be outside transaction)
      this.#userInfo.getAliases(s, {
        ...this.#getOauthOpts(
          sql`(callback_result->>'credential_id')::bigint`,
          !!this.#caps?.oauth,
        ),
        aliasTable: "alias_table",
      });
      s.startTransaction();
      s.modify(sql`delete from ${sql.ref(this.aliasTable)}
        where user_gmail_account_id = gmail_callback_account_id`);
      s.modify(sql`
        insert into ${sql.ref(this.aliasTable)} (user_gmail_account_id, email)
        select
          gmail_callback_account_id,
          lower(trim(email))
        from alias_table
        where email is not null and trim(email) != ''
        group by lower(trim(email))
      `);
      s.commitTransaction();

      s.setHeader(sql.lit`Location`, sql.lit`/email-integrations`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHttpStatus(303);
    };

    system.api({ prefix: "/api", domain: app.domain }).get(
      "/can-write/gmail-oauth-callback",
      {
        query: callbackQueryParams,
        procedure: body,
      },
    );
    for (const alias of app.domainAliases) {
      system.api({ prefix: "/api", domain: alias }).get(
        "/can-write/gmail-oauth-callback",
        {
          query: callbackQueryParams,
          procedure: body,
        },
      );
    }

    // Global API redirect using resolve_callback_target
    system.globalApi.get("/can-write/gmail-email-oauth-redirect", {
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
            "/api/can-write/gmail-oauth-callback?",
            queryParamValues,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    });

    // Notification endpoint
    system.api({ prefix: "/api", domain: app.domain }).post(
      "/can-write/google-email-notifications",
      {
        jsonBodyScalar: "body",
        procedure: (s) => {
          this.opts.extensions?.onNotificationReceived?.(s, {
            body: sql`body`,
          });
          s.defScalar("raw_data", sql`body->'message'->>'data'`);
          s.defScalar(
            "decoded_data_string",
            sql` (string.from_utf8(bytes.from_base64_url_safe(regex.replace_all(raw_data, '=', ''))))`,
          );
          s.defScalar(
            "notification_email",
            sql`(${sql`decoded_data_string`}::json)->>'emailAddress'`,
          );
          s.defScalar(
            "notification_history_id_scalar",
            sql`(${sql`decoded_data_string`}::json)->>'historyId'`,
          );
          s.debugExpr(sql`notification_email`);
          s.defRecord(
            "notification_account_record",
            sql`select * from ${
              sql.ref(this.accountTable)
            } where email = ${sql`notification_email`}`,
          );

          this.updateSyncLogStatus(s, {
            accountId: sql`notification_account_record.id`,
            status: sql.lit`syncing`,
            message: sql.lit`started syncing process`,
          });
          this.defineTemporaryTables(s);
          this.#gmail.messages.history(s, {
            ...this.#getOauthOpts(
              sql`notification_account_record.credential_id`,
              !!this.#caps?.fetch_emails,
            ),
            accountId: sql`notification_account_record.id`,
            historyId: sql`notification_account_record.notification_history_id`,
            maxResults: 100,
            emailsTable: "temp_table",
            recipientsTable: "temp_table_recipients",
            attachmentsTable: "temp_table_attachments",
          });
          s.startTransaction();
          s.modify(
            sql`update user_gmail_accounts set notification_history_id = notification_history_id_scalar where id = ${sql`notification_account_record.id`}`,
          );
          s.commitTransaction();
          this.saveMessages(s, {
            accountId: sql`notification_account_record.id`,
          });
          s.setHttpStatus(200);
          s.return();
        },
      },
    );

    // Attachment endpoint
    system.api({ prefix: "/api", domain: app.domain }).get(
      `/${this.attachmentsTable}/{blob_id}`,
      {
        procedure: (s) => {
          const authCtx = useOptionalICtx(AuthApiICtxKey);
          if (authCtx) {
            authCtx.authenticate(s);
          }
          s.defRecord(
            "attachment",
            sql`select * from db.${
              sql.ref(this.attachmentsTable)
            } where data = bytes.from_hex(blob_id)`,
          );
          s.if(sql`attachment.id is null`, (s) => {
            s.setHttpStatus(404);
            s.return();
          });
          s.setHeader(sql.lit`Content-Type`, sql`attachment.content_type`);
          s.setHeader(
            sql.lit`Cache-Control`,
            sql.lit`max-age=31536000, immutable`,
          );
          s.returnBlob(sql`attachment.data`);
        },
      },
    );
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
        s.defScalar(
          "oauth_redirect_uri",
          sql`case when ${
            isLocalhostHost(sql`oauth_origin_domain_lower`)
          } then 'http://localhost:3000/managed/oauth/entry' else 'https://yolmglobalapi.com/managed/oauth/entry' end`,
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
        from user_gmail_accounts
        where id = ${opts.accountId}
          and sys_user_id = current_user`,
    );
    s.if(sql`account_to_delete.id is null`, (s) => {
      s.throwError(sql.lit`Gmail account not found`);
    });
    s.serviceRequest({
      serviceType: sql.lit`managed_oauth`,
      operation: sql.lit`disconnect`,
      requestJson:
        sql`json_build_object('credential_id', account_to_delete.credential_id)`,
      resultJsonScalar: "__gmail_disconnect_result",
      errorJsonScalar: "__gmail_disconnect_error",
      optIn: !!this.#caps?.oauth,
    });
    s.if(
      sql`__gmail_disconnect_error is not null
        and lower(coalesce(
          __gmail_disconnect_error->>'message',
          __gmail_disconnect_error->>'error',
          ''
        )) not like '%credential not found%'`,
      (s) => {
        s.throwError(
          sql`coalesce(
            __gmail_disconnect_error->>'message',
            __gmail_disconnect_error->>'error',
            'Unable to disconnect the Gmail credential'
          )`,
        );
      },
    );
    s.startTransaction();
    s.modify(
      sql`delete from user_gmail_accounts
        where id = account_to_delete.id
          and sys_user_id = current_user
          and credential_id = account_to_delete.credential_id`,
    );
    s.if(
      sql`exists (
        select 1
        from user_gmail_accounts
        where id = account_to_delete.id
          and sys_user_id = current_user
      )`,
      (s) => {
        s.throwError(
          sql.lit`The Gmail account was reconnected while it was being removed`,
        );
      },
    );
    s.commitTransaction();
  }

  defineTemporaryTables<T extends IServerBaseStatements>(s: T): void {
    s.defTable("temp_table", {
      fields: [
        { name: "id", type: "String" },
        { name: "user_gmail_account_id", type: "String" },
        { name: "gmail_email_id", type: "String" },
        { name: "message_id", type: "String" },
        { name: "from", type: "String" },
        { name: "reply_to", type: "String" },
        { name: "date", type: "Timestamp" },
        { name: "subject", type: "String" },
        { name: "snippet", type: "String" },
        { name: "body_text", type: "String" },
        { name: "thread_id", type: "String" },
        { name: "is_read", type: "Bool" },
        { name: "message_reply_id", type: "String" },
      ],
    });
    s.defTable("temp_table_recipients", {
      fields: [
        { name: "message_id", type: "String" },
        { name: "email", type: "String" },
        { name: "recipient_type", type: "String" },
      ],
    });
    s.defTable("temp_table_attachments", {
      fields: [
        { name: "message_id", type: "String" },
        { name: "attachment_id", type: "String" },
        { name: "filename", type: "String" },
        { name: "content_type", type: "String" },
        { name: "data", type: "String" },
        { name: "ccid", type: "String" },
      ],
    });
  }

  updateSyncLogStatus<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
      status: Sql;
      message: Sql;
    },
  ): void {
    s.startTransaction();
    s.modify(
      sql`update user_gmail_accounts set sync_status = ${opts.status} where id = ${opts.accountId}`,
    );

    s.modify(
      sql`insert into user_gmail_sync_logs (user_gmail_account_id, message, status) values (${opts.accountId}, ${opts.message}, ${opts.status})`,
    );
    s.commitTransaction();
  }
  watchInbox<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "db_account",
        sql`select * from user_gmail_accounts where id = ${opts.accountId}`,
      );
      s.defScalar("channel_id", {
        type: "Uuid",
        expr: sql`random.uuid()`,
        allowNoRead: true,
      });
      this.#gmail.messages.watch(s, {
        accountId: sql`db_account.id`,
        id: sql`channel_id`,
        address: sql.lit(this.opts.devNotificationUrl),
        ...this.#getOauthOpts(
          sql`db_account.credential_id`,
          !!this.#caps?.fetch_emails,
        ),
      });
      s.startTransaction();
      s.modify(sql`update user_gmail_accounts
        set notification_history_id = watch_response.history_id,
            notification_expiration = date.add(second, watch_response.expiration, timestamp '1970-01-01 00:00:00')
        where id = ${opts.accountId}`);
      s.commitTransaction();
    });
  }

  stopwatchInbox<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: AnyExpr;
    },
  ) {
    s.block((s) => {
      s.defRecord(
        "db_account",
        sql`select * from user_gmail_accounts where id = ${opts.accountId}`,
      );
      this.#gmail.messages.stopWatch(s, {
        id: sql`db_account.notification_history_id`,
        resourceId: sql`db_account.notification_history_id`,
        ...this.#getOauthOpts(
          sql`db_account.credential_id`,
          !!this.#caps?.fetch_emails,
        ),
      });
      s.startTransaction();
      s.modify(sql`update user_gmail_accounts
        set notification_history_id = null,
            notification_expiration = null
        where id = ${opts.accountId}`);
      s.commitTransaction();
    });
  }

  markAsRead<T extends IServerBaseStatements>(
    s: T,
    opts: MarkAsReadOpts,
  ): void {
    this.#gmail.messages.markAsRead(s, {
      messageId: opts.emailId,
      ...this.#getOauthOpts(
        sql`(select credential_id
          from user_gmail_accounts
          where id = ${opts.accountId}
            and sys_user_id = current_user)`,
        !!this.#caps?.fetch_emails,
      ),
    });
  }

  markAsUnread<T extends IServerBaseStatements>(
    s: T,
    opts: {
      messageId: AnyExpr;
    },
  ): void {
    this.#gmail.messages.markAsUnread(s, {
      messageId: opts.messageId,
      ...this.#getOauthOpts(
        sql`account.credential_id`,
        !!this.#caps?.fetch_emails,
      ),
    });
  }

  static EmailsPage = EmailsGmailPage;
  static EmailsList = EmailsGmailList;
}

function EmailsGmailPage(props: { where: Sql; path: string }) {
  const block = system.block(GmailIntegration);

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
          Gmail Emails
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
          markAsRead={(s, opts) => {
            system.block(GmailIntegration).markAsRead(s, {
              emailId: opts.messageId,
              accountId: sql`email_record.user_gmail_account_id`,
            });
          }}
          bodyFieldNode={<GmailBodyFieldNode />}
        />
      }
      where={props.where}
      orderBy={sql`date desc`}
      pageSize={25}
      gridSx={{ gap: 0 }}
    />
  );
}

function GmailBodyFieldNode() {
  const block = system.block(GmailIntegration);
  const bodyField = sql`email.body_text`;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("replaced_body", bodyField);
        s.defScalar(
          "is_amp_html",
          sql`(position('<!doctype html><html amp4email' in ${bodyField}) = 1) or
            (position('<html amp4email' in ${bodyField}) = 1) or
            (position('<!doctype html><html ⚡4email' in ${bodyField}) = 1) or
            (position('<html ⚡4email' in ${bodyField}) = 1)`,
        );

        s.if(sql`is_amp_html`, (s) => {
          s.defScalar("fallback_content", sql`''`);

          s.conditional({
            condition: sql`position('<div role="list">' in ${bodyField}) > 0`,
            then: (s) => {
              s.setScalar(
                "fallback_content",
                sql`substring(${bodyField} from position('<div role="list">' in ${bodyField}) for length(${bodyField}))`,
              );

              s.setScalar("replaced_body", sql`fallback_content`);

              s.setScalar(
                "replaced_body",
                sql`regex.replace_all(replaced_body, '<div style="background-color: #f0f8ff; padding: 10px; margin-bottom: 15px; border-radius: 5px; border: 1px solid #cce5ff;"><p style="margin: 0; color: #004085;">.*?</p></div>', '')`,
              );

              s.if(
                sql`position('<!doctype html>' in fallback_content) = 0`,
                (s) => {
                  s.setScalar(
                    "replaced_body",
                    sql`'<!doctype html><html><head><meta charset="utf-8"></head><body>' || replaced_body || '</body></html>'`,
                  );
                },
              );
            },
            else: (s) => {
              convertAmpHtmlToHtml(s, bodyField, "replaced_body");
            },
          });
        });

        s.forEachQuery(
          sql`select * from ${sql.ref(block.attachmentsTable)} where ${
            sql.ref(singularize(block.emailTable))
          }_id = email.id`,
          "attachment",
          (s) => {
            s.if(
              sql`attachment.ccid is not null and attachment.ccid != ''`,
              (s) => {
                s.readBlob(sql`attachment.data`, "content");
                s.defScalar("base64_content", sql`bytes.to_base64(content)`);
                s.setScalar(
                  "replaced_body",
                  sql`case
                   when contains(${bodyField}, 'cid:' || attachment.ccid)
                   then regex.replace(
                     replaced_body,
                     'src="cid:' || attachment.ccid || '"',
                     'src="data:' || attachment.content_type || ';base64,' || base64_content || '"'
                   )
                   else replaced_body
                 end`,
                );
              },
            );
          },
        );
      }}
    >
      <iframe
        className="w-full h-[60vh] border-none"
        title="Email"
        srcDoc={sql`replaced_body`}
      />
    </Data>
  );
}
function EmailsGmailList(props: { where: Sql }) {
  const block = system.block(GmailIntegration);
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
            Gmail Emails
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
            markAsRead={(s, opts) => {
              system.block(GmailIntegration).markAsRead(s, {
                emailId: opts.messageId,
                accountId: sql`email_record.user_gmail_account_id`,
              });
            }}
            bodyFieldNode={<GmailBodyFieldNode />}
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

/**
 Converts AMP HTML to standard HTML
 @param s - The statement context
 @param sourceExpr - The expression containing AMP HTML
 @param resultScalar - The name of the scalar to store the result
 */
export function convertAmpHtmlToHtml<T extends StateStatements>(
  s: T,
  sourceExpr: Sql,
  resultScalar: string,
): void {
  const identScalar = sql.ref(resultScalar);
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${sourceExpr}, '<style amp4email-boilerplate>.*?</style>', '')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, 'amp4email', '')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '⚡4email', '')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<script async src="https://cdn.ampproject.org/v0.js"></script>', '')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<script async custom-element="[^"]*" src="[^"]*"></script>', '')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<script async custom-template="[^"]*" src="[^"]*"></script>', '')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<amp-img', '<img')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</amp-img>', '</img>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<amp-list', '<div class="converted-amp-list"')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</amp-list>', '</div>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<amp-layout', '<div class="converted-amp-layout"')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</amp-layout>', '</div>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<amp-timeago', '<div class="converted-amp-timeago"')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</amp-timeago>', '</div>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<amp-form', '<div class="converted-amp-form"')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</amp-form>', '</div>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<amp-bind', '<div class="converted-amp-bind"')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</amp-bind>', '</div>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<template type="amp-mustache">', '<div class="template-content">')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '</template>', '</div>')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, 'data-amp-bind-[^=]*="[^"]*"', '')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, 'on="[^"]*"', '')`,
  );
  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, 'layout="[^"]*"', 'style="max-width:100%"')`,
  );

  s.setScalar(
    resultScalar,
    sql`regex.replace_all(${identScalar}, '<body>', '<body><div style="background-color: #f0f8ff; padding: 10px; margin-bottom: 15px; border-radius: 5px; border: 1px solid #cce5ff;"><p style="margin: 0; color: #004085;">This email was originally in AMP HTML format and has been converted for basic viewing.</p></div>')`,
  );
}
