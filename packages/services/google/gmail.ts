import { queryParamsString } from "std/services";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { leanEmailBodyForStorage } from "services/email_body";
import { GoogleAuth } from "./auth";
import type { Oauth2TokenOpts } from "./auth";

export interface GetEmailsOpts extends Oauth2TokenOpts {
  accountId: Sql;
  emailsTable: string;
  maxResults?: AnyExpr;
  pageToken?: Sql;
  query?: Sql;
  labelIds?: Sql[];
  recipientsTable: string;
  attachmentsTable: string;
}

export interface GetHistoryOpts extends GetEmailsOpts {
  historyId: Sql;
}

export interface GetEmailOpts extends Oauth2TokenOpts {
  accountId: Sql;
  messageId: Sql;
}

export interface SendEmailOpts extends Oauth2TokenOpts {
  accountId: Sql;
  toTable: Sql;
  ccTable: Sql;
  bccTable: Sql;
  subject: Sql;
  body: Sql;
  from: Sql;
  replyTo?: Sql;
  threadId?: Sql;
  inReplyTo?: Sql;
  references?: Sql;
  messageId?: Sql;
  isReply?: boolean;
  previewText?: Sql;
  responseScalar?: string;
  attachments?: {
    filename: Sql;
    content: Sql;
    contentType: Sql;
  }[];
  /** Procedure table containing id, filename, content_type, and base64 content. */
  attachmentsTable?: string;
}
interface WatchOpts extends Oauth2TokenOpts {
  /**
       Unique identifier for the notification channel, will be put in the header X-Goog-Channel-ID.
       */
  id: Sql;
  /**
       Webhook URL that will receive notifications.
       */
  address: Sql;
  /**
       Time to live for the notification channel in seconds.
       */
  ttl?: NumericExpr;
  accountId: Sql;
  /**
       Name of record to save the response to. Defaults to "watch_response".

       Has fields:
       - id: string
       - resource_id: string
       - resource_uri: string
       - token: string
       - expiration: timestamp
       */
  responseRecord?: string;
}

interface StopWatchOpts extends Oauth2TokenOpts {
  /**
       The ID of the notification channel to stop
       */
  id: Sql;
  /**
       The resource ID obtained from the watch response
       */
  resourceId: Sql;
}
interface GetAttachmentsOpts extends Oauth2TokenOpts {
  messageId: Sql;
  attachmentId: Sql;
  attachmentsTable: string;
}
interface ModifyMessageOpts extends Oauth2TokenOpts {
  messageId: AnyExpr;
  addLabelIds?: Sql[];
  removeLabelIds?: Sql[];
}

export class Gmail {
  #auth = new GoogleAuth();

  messages = {
    /**
           List emails from Gmail account
           Populates a table with email data including:
           - id: string
           - thread_id: string
           - label_ids: string[]
           - snippet: string
           - payload: {
               headers: { name: string, value: string }[]
               body: { data: string }
               parts: { body: { data: string }, mimeType: string }[]
             }
    */
    list: <T extends IServerBaseStatements>(s: T, opts: GetEmailsOpts) => {
      s.defScalar("next_page_token", {
        type: "String",
      });
      s.loop((s) => {
        this.#auth.requestWithOauth(s, {
          requestOpts: {
            uri: sql.concat(
              sql.lit`https://gmail.googleapis.com/gmail/v1/users/me/messages?`,
              queryParamsString({
                maxResults: opts.maxResults,
                pageToken: sql`next_page_token`,
                q: opts.query,
                labelIds: opts.labelIds,
                includeSpamTrash: false,
              }),
            ),
            method: sql.lit`GET`,
            receiveJson: "message_list",
          },
          afterRequest: (s) => {
            s.defTable(
              "message_ids",
              sql`
              select
                (value->>'id') as id,
                (value->>'threadId') as thread_id
              from json.array_each(message_list -> 'messages') as value
            `,
            );
            this.messages.searchMessagesFromList(s, opts);

            s.setScalar(
              "next_page_token",
              sql`message_list ->> 'nextPageToken'`,
            );
          },
          oauthOpts: opts,
        });
        s.if(sql`next_page_token is null or next_page_token = ''`, (s) => {
          s.break();
        });
      });
    },
    /**
    Fetches a full message into message_response. Rejects failed, mismatched,
    or incomplete responses before they can enter a reconciliation snapshot.
     */
    get: <T extends IServerBaseStatements>(s: T, opts: GetEmailOpts) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://gmail.googleapis.com/gmail/v1/users/me/messages/`,
            opts.messageId,
            sql.lit`?`,
            queryParamsString({
              format: sql.lit`full`,
            }),
          ),
          method: sql.lit`GET`,
          receiveJson: "message_response",
          responseRecord: "gmail_message_response",
        },
        afterRequest: () => {},
        oauthOpts: opts,
      });
      // Also reject responses handled by the reauthorization hook.
      s.throwErrorIf(
        sql`gmail_message_response.status != 200
          or coalesce(message_response->>'id', '') != ${opts.messageId}
          or coalesce(json_typeof(message_response->'payload'->'headers'), '') != 'array'`,
        sql`'Failed to fetch a complete Gmail message: ' || gmail_message_response.status`,
      );
    },

    history: <T extends IServerBaseStatements>(s: T, opts: GetHistoryOpts) => {
      s.defScalar("next_page_token", {
        type: "String",
        expr: sql.null,
      });
      this.#auth.requestWithOauth(s, {
        oauthOpts: opts,
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://gmail.googleapis.com/gmail/v1/users/me/history?`,
            queryParamsString({
              startHistoryId: opts.historyId,
              maxResults: opts.maxResults,
              pageToken: sql`next_page_token`,
              sql: opts.query,
              historyTypes: [sql.lit`messageAdded`, sql.lit`messageDeleted`],
            }),
          ),
          method: sql.lit`GET`,
          receiveJson: "message_history",
        },
        afterRequest: (s) => {
          s.if(sql`message_history->'history->0->>messages' is null`, (s) => {
            s.return();
          });
          s.defTable(
            "message_ids",
            sql`
              select
                (value->>'id') as id,
                (value->>'threadId') as thread_id
              from json.array_each(message_history->'history'->0->'messages') as value
            `,
          );
          //this is what should be done parallely.
          this.messages.searchMessagesFromList(s, {
            ...opts,
            accountId: opts.accountId,
            emailsTable: "temp_table",
            recipientsTable: "temp_table_recipients",
          });
        },
      });
    },

    /**
           Send an email through Gmail
           */
    send: <T extends IServerBaseStatements>(s: T, opts: SendEmailOpts) => {
      const hasStaticAttachments = opts.attachments?.length
        ? sql.or(
          ...opts.attachments.map((attachment) =>
            sql`${attachment.filename} is not null
            and ${attachment.content} is not null`
          ),
        )
        : sql`false`;
      const hasAttachments = opts.attachmentsTable
        ? sql`${hasStaticAttachments} or exists (
            select 1 from ${sql.ref(opts.attachmentsTable)}
          )`
        : hasStaticAttachments;
      // First, construct the RFC 2822 formatted email
      s.defScalar("email_content", {
        type: { type: "String", maxLength: 1000000000 },
      });

      // Build email headers with conditional reply headers
      s.defScalar("email_headers", {
        type: { type: "String", maxLength: 5000 },
      });

      s.defScalar("cc_content", {
        type: "String",
        expr: sql.lit``,
      });

      s.defScalar("bcc_content", {
        type: "String",
        expr: sql.lit``,
      });
      s.defScalar("reply_to_content", {
        type: "String",
        expr: sql.lit``,
      });
      s.defScalar("boundary", {
        type: "String",
        expr: sql`'boundary_' || random.uuid()`,
      });

      // Only add CC if it exists and has content
      s.if(sql`${opts.ccTable} is not null`, (s) => {
        s.setScalar("cc_content", sql.concat("Cc: ", opts.ccTable, "\r\n"));
      });

      // Only add BCC if it exists and has content
      s.if(sql`${opts.bccTable} is not null`, (s) => {
        s.setScalar("bcc_content", sql.concat("Bcc: ", opts.bccTable, "\r\n"));
      });
      if (opts.replyTo) {
        s.setScalar(
          "reply_to_content",
          sql.concat("Reply-To: ", opts.replyTo, "\r\n"),
        );
      }

      s.setScalar(
        "email_headers",
        sql.concat(
          "From: ",
          opts.from,
          "\r\n",
          "To: ",
          opts.toTable,
          "\r\n",
          sql`cc_content`,
          sql`bcc_content`,
          sql`reply_to_content`,
          "Subject: ",
          opts.subject,
          "\r\n",
          "Content-Type: text/html; charset=UTF-8\r\n",
        ),
      );
      s.if(hasAttachments, (s) => {
        s.setScalar(
          "email_headers",
          sql.concat(
            "From: ",
            opts.from,
            "\r\n",
            "To: ",
            opts.toTable,
            "\r\n",
            sql`cc_content`,
            sql`bcc_content`,
            sql`reply_to_content`,
            "Subject: ",
            opts.subject,
            "\r\n",
            "MIME-Version: 1.0\r\n",
            "Content-Type: multipart/mixed; boundary=",
            sql`boundary`,
            "\r\n",
          ),
        );
      });
      // Construct the complete email content

      // Preserve a supplied reference chain, falling back to the parent message.
      const references = sql`coalesce(nullif(${
        opts.references ?? sql.lit``
      }, ''), ${opts.inReplyTo ?? sql.lit``})`;
      s.if(sql`${opts.isReply ?? false}`, (s) => {
        s.if(sql`${references} is not null and ${references} != ''`, (s) => {
          s.setScalar(
            "email_headers",
            sql.concat(sql`email_headers`, "References: ", references, "\r\n"),
          );
        });
        s.setScalar(
          "email_headers",
          sql.concat(
            sql`email_headers`,
            opts.inReplyTo
              ? sql.concat("In-Reply-To: ", opts.inReplyTo, "\r\n")
              : "",
          ),
        );
      });

      // Create body with preview text if provided
      s.defScalar("email_body_with_preview", {
        type: { type: "String", maxLength: 1000000000 },
      });

      // Add preview text to the beginning of the body if provided
      s.if(
        opts.previewText
          ? sql`${opts.previewText} is not null and ${opts.previewText} != ''`
          : sql`false`,
        (s) => {
          s.setScalar(
            "email_body_with_preview",
            sql.concat(
              // Hidden preview text div
              sql
                .lit`<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">`,
              opts.previewText,
              sql.lit`</div>`,
              opts.body,
            ),
          );
        },
      ).else((s) => {
        s.setScalar("email_body_with_preview", opts.body);
      });

      s.setScalar(
        "email_content",
        sql.concat(sql`email_headers`, "\r\n", sql`email_body_with_preview`),
      );

      //if we send attachments the email_content is different
      s.if(hasAttachments, (s) => {
        s.setScalar(
          "email_content",
          sql.concat(
            sql`email_headers`,
            "\r\n",
            "--",
            sql`boundary`,
            "\r\n",
            "Content-Type: text/html; charset=UTF-8\r\n",
            "\r\n",
            sql`email_body_with_preview`,
            "\r\n",
          ),
        );

        opts.attachments?.map((attachment) => {
          s.if(
            sql`${attachment.filename} is not null
              and ${attachment.content} is not null`,
            (s) => {
              s.setScalar(
                "email_content",
                sql.concat(
                  sql`email_content`,
                  "--",
                  sql`boundary`,
                  "\r\n",
                  "Content-Type: ",
                  sql`${attachment.contentType}`,
                  "\r\n",
                  "Content-Transfer-Encoding: base64\r\n",
                  "Content-Disposition: attachment; filename=",
                  sql`${attachment.filename}`,
                  "\r\n",
                  "\r\n",
                  sql`${attachment.content}`,
                  "\r\n",
                ),
              );
            },
          );
        });
        if (opts.attachmentsTable) {
          s.setScalar(
            "email_content",
            sql`email_content || coalesce((
              select string_agg(part, '')
              from (
                select concat(
                  '--', boundary, '\r\n',
                  'Content-Type: ',
                  replace(replace(content_type, chr(13), ''), chr(10), ''),
                  '\r\n',
                  'Content-Transfer-Encoding: base64\r\n',
                  'Content-Disposition: attachment; filename=',
                  replace(replace(filename, chr(13), ''), chr(10), ''),
                  '\r\n\r\n', content, '\r\n'
                ) as part
                from ${sql.ref(opts.attachmentsTable)}
                order by id
              ) stored_attachment_parts
            ), '')`,
          );
        }
        s.setScalar(
          "email_content",
          sql.concat(
            sql`email_content`,
            "--",
            sql`boundary`,
            "--\r\n",
          ),
        );
      });
      // Base64url encode the email content
      s.defScalar("encoded_email", {
        type: "String",
      });
      s.setScalar(
        "encoded_email",
        sql`bytes.to_base64_url_safe(string.to_utf8(email_content))`,
      );

      // Prepare request body with optional threadId
      s.defScalar("request_body", {
        type: "Json",
      });

      if (opts.threadId) {
        s.conditional({
          condition:
            sql`${opts.threadId} is not null and ${opts.threadId} != ''`,
          then: (s) => {
            s.setScalar(
              "request_body",
              sql.jsonBuildObject({
                raw: sql`encoded_email`,
                threadId: opts.threadId,
              }),
            );
          },
          else: (s) => {
            s.setScalar(
              "request_body",
              sql.jsonBuildObject({
                raw: sql`encoded_email`,
              }),
            );
          },
        });
      } else {
        s.setScalar(
          "request_body",
          sql.jsonBuildObject({
            raw: sql`encoded_email`,
          }),
        );
      }

      this.#auth.requestWithOauth(s, {
        oauthOpts: opts,
        requestOpts: {
          method: sql.lit`POST`,
          uri: sql
            .lit`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
          headers: [
            {
              name: sql.lit`Content-Type`,
              value: sql.lit`application/json`,
            },
          ],
          json: sql`request_body`,
          receiveJson: "send_response_json",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.if(sql`response.status not between 200 and 299`, (s) => {
            s.defScalar(
              "error_message",
              sql`(select send_response_json->'error'->>'message')`,
            );
            s.throwError(
              sql`'Gmail failed to send email: ' || response.status || ' ' || error_message`,
            );
          });
          if (opts.responseScalar) {
            s.modify(
              sql`
              insert into ${sql.ref(opts.responseScalar)}
              select
                send_response_json->>'id' as message_id,
                send_response_json->>'threadId' as thread_id
            `,
            );
          }
        },
      });
    },

    markAsRead: <T extends IServerBaseStatements>(
      s: T,
      opts: ModifyMessageOpts,
    ) => {
      this.#auth.requestWithOauth(s, {
        oauthOpts: opts,
        requestOpts: {
          method: sql.lit`POST`,
          uri: sql.concat(
            sql.lit`https://gmail.googleapis.com/gmail/v1/users/me/messages/`,
            opts.messageId,
            sql.lit`/modify`,
          ),
          headers: [
            {
              name: sql.lit`Content-Type`,
              value: sql.lit`application/json`,
            },
          ],
          json: sql.jsonBuildObject({
            removeLabelIds: ["UNREAD"],
          }),
          receiveJson: "modify_json_response",
          responseRecord: "modify_response",
        },
        afterRequest: (s) => {
          s.if(sql`modify_json_response is null`, () => {});
        },
      });
    },
    markAsUnread: <T extends IServerBaseStatements>(
      s: T,
      opts: ModifyMessageOpts,
    ) => {
      this.#auth.requestWithOauth(s, {
        oauthOpts: opts,
        requestOpts: {
          method: sql.lit`POST`,
          uri: sql.concat(
            sql.lit`https://gmail.googleapis.com/gmail/v1/users/me/messages/`,
            opts.messageId,
            sql.lit`/modify`,
          ),
          headers: [
            {
              name: sql.lit`Content-Type`,
              value: sql.lit`application/json`,
            },
          ],
          json: sql.jsonBuildObject({
            addLabelIds: ["UNREAD"],
          }),
          receiveJson: "modify_response",
        },
        afterRequest: (s) => {
          s.if(sql`modify_response is null`, () => {});
        },
      });
    },

    /**
         You must re-call watch at least every 7 days or else you will stop receiving updates for the user.
         Gmail recommends calling watch once per day.
         The watch response also has an expiration field with the timestamp for the watch expiration
         */
    watch: <T extends IServerBaseStatements>(s: T, opts: WatchOpts) => {
      s.defRecord(opts.responseRecord ?? "watch_response", {
        fields: [
          { name: "history_id", type: "String" },
          { name: "expiration", type: "BigInt" },
        ],
      });
      this.#auth.requestWithOauth(s, {
        oauthOpts: opts,
        requestOpts: {
          method: sql.lit`POST`,
          uri: sql.concat(
            sql.lit`https://www.googleapis.com/gmail/v1/users/me/watch`,
          ),
          json: sql.jsonBuildObject({
            topicName: sql.lit`projects/calendar-test-436717/topics/emailTopic`,
            labelIds: ["INBOX"],
            labelFilterAction: sql.lit`include`,
          }),
          receiveJson: "subscription_response",
        },
        afterRequest: (s) => {
          s.if(sql`response.status not between 200 and 299`, (s) => {
            s.throwError(sql`'Failed to watch calendar: ' || response.status`);
          });
          s.if(sql`subscription_response->>'expiration' is not null`, (s) => {
            const responseRecord = opts.responseRecord ?? "watch_response";
            s.modify(sql`
              insert into ${sql.ref(responseRecord)} (history_id, expiration)
              values (
                subscription_response->>'historyId',
                (subscription_response->>'expiration')::bigint / 1000
              )
            `);
          });
        },
      });
    },
    //Todo: this is not working, check notification id and history id.
    stopWatch: <T extends IServerBaseStatements>(s: T, opts: StopWatchOpts) => {
      this.#auth.requestWithOauth(s, {
        oauthOpts: opts,
        requestOpts: {
          method: sql.lit`POST`,
          uri: sql.lit`https://www.googleapis.com/gmail/v1/users/me/stop`,
          json: sql.jsonBuildObject({
            id: opts.id,
            resourceId: opts.resourceId,
          }),
          receiveText: "response_text",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.if(sql`response_text is null`, () => {});
          s.if(sql`response.status != 204 and response.status != 404`, (s) => {
            s.throwError(
              sql`'Failed to stop notification channel: ' || response.status`,
            );
          });
        },
      });
    },
    searchMessagesFromList: <T extends IServerBaseStatements>(
      s: T,
      opts: GetEmailsOpts,
    ) => {
      s.forEachTable("message_ids", "message_id", (s) => {
        this.messages.get(s, {
          ...opts,
          messageId: sql`message_id.id`,
        });
        // Extract attachments from parts, using a scalar for the header lookup
        // instead of a nested forEachQuery loop
        s.forEachQuery(
          sql`select * from json.array_each(message_response->'payload'->'parts')`,
          "part",
          (s) => {
            s.if(sql`part.value->'body'->>'attachmentId' is not null`, (s) => {
              s.defScalar(
                "ccid",
                sql`(select h.value->>'value'
                  from json.array_each(part.value->'headers') as h
                  where h.value->>'name' = 'X-Attachment-Id')`,
              );
              s.modify(
                sql`insert into ${sql.ref(opts.attachmentsTable)}
                  (message_id, filename, content_type, ccid, attachment_id)
                  values (
                    message_id.id,
                    part.value->>'filename',
                    part.value->>'mimeType',
                    ccid,
                    part.value->'body'->>'attachmentId'
                  )`,
              );
            });
          },
        );
        s.defScalar(
          "is_unread",
          sql`exists(select value from json.array_each(message_response->'labelIds') where value::text = '"UNREAD"')`,
        );
        s.defScalar(
          "body_raw",
          sql`(coalesce(
            (select message_response->'payload'->'parts'->0->'parts'->1->'body'->>'data'),
            (select message_response->'payload'->'parts'->1->'body'->>'data'),
            (select message_response->'payload'->'parts'->0->'parts'->0->'parts'->1->'body'->>'data'),
            (select message_response->'payload'->'parts'->0->'body'->>'data'),
            (select message_response->'payload'->'body'->>'data')))`,
        );
        s.if(sql`body_raw is null`, () => {});
        s.defTable(
          "headers",
          sql`select
              value->>'name' as name,
              value->>'value' as value
            from json.array_each(message_response->'payload'->'headers') as value`,
        );
        s.modify(
          sql`insert into ${sql.ref(opts.recipientsTable)}
            (message_id, email, recipient_type)
            select message_id.id, trim(new_value.value) as email, 'to' as recipient_type
            from string.split((select value from headers where name = 'To'), ',') as new_value
            where (select value from headers where name = 'To') is not null`,
        );
        s.modify(
          sql`insert into ${sql.ref(opts.recipientsTable)}
            (message_id, email, recipient_type)
            select message_id.id, trim(new_value.value) as email, 'cc' as recipient_type
            from string.split((select value from headers where name = 'Cc'), ',') as new_value
            where (select value from headers where name = 'Cc') is not null`,
        );
        s.modify(
          sql`insert into ${sql.ref(opts.recipientsTable)}
            (message_id, email, recipient_type)
            select message_id.id, trim(new_value.value) as email, 'bcc' as recipient_type
            from string.split((select value from headers where name = 'Bcc'), ',') as new_value
            where (select value from headers where name = 'Bcc') is not null`,
        );
        s.defScalar(
          "decoded_body",
          sql`string.from_utf8(bytes.from_base64_url_safe(regex.replace_all(body_raw, '=', '')))`,
        );
        s.modify(
          sql`insert into ${sql.ref(opts.emailsTable)}
            (message_id, snippet, "from", subject, message_reply_id, reply_to,
              body_text, thread_id, is_read, date)
            select
              message_id.id as message_id,
              message_response->>'snippet' as snippet,
              (select value from headers where name = 'From') as from,
              (select value from headers where name = 'Subject') as subject,
              (select value from headers where name = 'Message-ID') as message_reply_id,
              (
                select value
                from headers
                where lower(name) = 'reply-to'
                limit 1
              ) as reply_to,
              ${leanEmailBodyForStorage(sql`decoded_body`)} as body_text,
              message_response->>'threadId' as thread_id,
              not is_unread as is_read,
              (select date.parse_timestamp(value, '%a, %d %b %Y %H:%M:%S %z') from headers where name = 'Date') as date`,
        );
      });
      s.forEachQuery(
        sql`select distinct source.message_id, source.attachment_id
          from ${sql.ref(opts.attachmentsTable)} source
          where source.filename != ''
            and source.filename is not null
            and exists (
              select 1 from message_ids current_page_message
              where current_page_message.id = source.message_id
            )`,
        "attachment",
        (s) => {
          this.attachments.get(s, {
            ...opts,
            messageId: sql`attachment.message_id`,
            attachmentId: sql`attachment.attachment_id`,
          });
        },
      );
      s.modify(
        sql`delete from ${sql.ref(opts.attachmentsTable)} source
          where (source.filename = '' or source.filename is null)
            and exists (
              select 1 from message_ids current_page_message
              where current_page_message.id = source.message_id
            )`,
      );
    },
  };

  attachments = {
    get: <T extends IServerBaseStatements>(s: T, opts: GetAttachmentsOpts) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://gmail.googleapis.com/gmail/v1/users/me/messages/`,
            opts.messageId,
            sql.lit`/attachments/`,
            opts.attachmentId,
          ),
          method: sql.lit`GET`,
          // TODO(request-streaming): Gmail wraps attachment bytes in the
          // top-level JSON `data` field as base64url. The committed raw Blob
          // receiver cannot preserve those semantics; migrate this only with
          // a bounded streaming JSON/base64url decoder and durable retry work
          // in the runtime/reactor path.
          receiveJson: "json_attachments",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.modify(
            sql` update ${sql.ref(opts.attachmentsTable)} set
           data = json_attachments->>'data'
           where attachment_id = ${opts.attachmentId}
           and message_id = ${opts.messageId}
            `,
          );
        },
        oauthOpts: opts,
      });
    },
  };
}
