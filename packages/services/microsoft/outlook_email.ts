import { queryParamsString } from "std/services";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { leanEmailBodyForStorage } from "services/email_body";
import { AzureADAuth } from "./auth";
import type { Oauth2TokenOpts } from "./auth";

const METADATA_SELECT_FIELD_LIST = [
  "id",
  "subject",
  "bodyPreview",
  "receivedDateTime",
  "from",
  "replyTo",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "conversationId",
  "internetMessageId",
  "isRead",
  "hasAttachments",
];
const MESSAGE_SELECT_FIELDS = [
  ...METADATA_SELECT_FIELD_LIST,
  "body",
  "internetMessageHeaders",
]
  .join(",");
const METADATA_SELECT_FIELDS = METADATA_SELECT_FIELD_LIST.join(",");
const MESSAGE_SELECT_QUERY_PARAM = `?$select=${MESSAGE_SELECT_FIELDS}`;
const MESSAGE_HEADER_SELECT_QUERY_PARAM =
  "?$select=id,internetMessageId,internetMessageHeaders,conversationId";
const ATTACHMENT_METADATA_SELECT_QUERY_PARAM =
  "?$select=microsoft.graph.fileAttachment/contentId,lastModifiedDateTime,contentType,isInline,name,size,id&$top=999";
// Graph allows 20 subrequests, but full message bodies can make responses large.
const MESSAGE_BATCH_SIZE = 10;
const IMMUTABLE_ID_PREFER = `IdType="ImmutableId"`;
const HTML_IMMUTABLE_ID_PREFER =
  `outlook.body-content-type="html", IdType="ImmutableId"`;
// Keeps the formerly unbounded public helper source-compatible while fitting
// the runtime's two-copy 1 GiB per-system streaming reservation.
const LEGACY_ATTACHMENT_MAX_BYTES = 511 * 1024 * 1024;

export interface GetSingleEmailOpts extends GetEmailsOpts {
  emailId: Sql;
}

export interface GetEmailBatchOpts extends GetEmailsOpts {
  messageIdsTable: string;
  failedMessagesTable?: string;
}

export interface GetEmailsOpts extends Oauth2TokenOpts {
  accountId: Sql;
  emailsTable: string;
  recipientsTable: string;
  attachmentsTable: string;
  maxResults?: AnyExpr;
  pageToken?: Sql;
  query?: Sql;
  search?: Sql;
  excludedFolderFilter?: Sql;
  fetchAllPages?: boolean;
  continuationUrl?: Sql;
  nextPageLinkScalar?: string;
  /** List without the `body` field; message bodies must be fetched separately. */
  metadataOnly?: boolean;
}
export interface SendEmailOpts extends Oauth2TokenOpts {
  accountId: Sql;
  toTable: Sql;
  ccTable: Sql;
  bccTable: Sql;
  subject: Sql;
  body: Sql;
  inReplyTo?: Sql;
  replyAll?: BooleanExpr;
  attachments?: {
    filename: Sql;
    content: Sql;
    contentType: Sql;
  }[];
  /** Procedure table containing id, filename, content_type, and base64 content. */
  attachmentsTable?: string;
}
export interface UpdateEmailOpts extends Oauth2TokenOpts {
  emailId: Sql;
  addFolderIds?: Sql[];
  removeFolderIds?: Sql[];
}

export interface DeleteEmailOpts extends Oauth2TokenOpts {
  emailId: Sql;
}

export interface GetAttachmentsOpts extends Oauth2TokenOpts {
  accountId: Sql;
  emailId: Sql;
  attachmentsTable: string;
  /** Refuse to persist content larger than this many bytes (defaults to 511 MiB). */
  maxContentBytes?: number;
  continuationUrl?: Sql;
  nextPageLinkScalar?: string;
  fetchAllPages?: boolean;
  /** Graph attachments have no in-place update; reuse a complete blob by ID. */
  reuseExistingContentFrom?: {
    emailsTable: string;
    attachmentsTable: string;
    emailForeignKeyColumn: string;
    blobColumn: string;
  };
}

export interface GetFoldersOpts extends Oauth2TokenOpts {
  foldersTable: string;
  accountId: Sql;
}

export class OutlookMail {
  #auth = new AzureADAuth();

  #fetchMissingAttachmentContent<T extends IServerBaseStatements>(
    s: T,
    opts: GetAttachmentsOpts,
  ): void {
    const maxContentBytes = opts.maxContentBytes ??
      LEGACY_ATTACHMENT_MAX_BYTES;
    if (opts.reuseExistingContentFrom) {
      s.modify(
        sql`update ${sql.ref(opts.attachmentsTable)} source
            set blob_id = (
              select existing.${
          sql.ref(opts.reuseExistingContentFrom.blobColumn)
        }
              from ${
          sql.ref(opts.reuseExistingContentFrom.attachmentsTable)
        } existing
              join ${sql.ref(opts.reuseExistingContentFrom.emailsTable)} email
                on email.id = existing.${
          sql.ref(opts.reuseExistingContentFrom.emailForeignKeyColumn)
        }
              where email.user_outlook_emails_account_id = ${opts.accountId}
                and email.message_id = ${opts.emailId}
                and existing.attachment_id = source.attachment_id
                and existing.${
          sql.ref(opts.reuseExistingContentFrom.blobColumn)
        } is not null
              limit 1
            )
            where source.user_outlook_emails_account_id = ${opts.accountId}
              and source.message_id = ${opts.emailId}
              and source.blob_id is null`,
      );
    }
    s.forEachQuery(
      sql`select distinct source.attachment_id
          from ${sql.ref(opts.attachmentsTable)} source
          where user_outlook_emails_account_id = ${opts.accountId}
            and message_id = ${opts.emailId}
            and blob_id is null
            and attachment_id is not null
            and attachment_type in (
              '#microsoft.graph.fileAttachment',
              '#microsoft.graph.itemAttachment'
            )`,
      "attachment",
      (s) => {
        this.#auth.requestWithOauth(s, {
          requestOpts: {
            uri: sql.concat(
              sql.lit`https://graph.microsoft.com/v1.0/me/messages/`,
              sql`uri.encode_component(${opts.emailId})`,
              sql.lit`/attachments/`,
              sql`uri.encode_component(attachment.attachment_id)`,
              sql.lit`/$value`,
            ),
            method: sql.lit`GET`,
            headers: [
              {
                name: sql.lit`Prefer`,
                value: sql.lit(IMMUTABLE_ID_PREFER),
              },
            ],
            receiveBody: {
              type: "Blob",
              scalar: "attachment_blob_id",
              maxBytes: maxContentBytes,
              acceptedStatuses: [200],
            },
            responseRecord: "attachment_response",
            responseHeadersTable: "attachment_headers",
          },
          afterRequest: (s) => {
            s.if(sql`attachment_response.status != 200`, (s) => {
              s.throwError(
                sql.concat(
                  "Failed to fetch outlook attachment content: ",
                  sql`attachment_response.status`,
                ),
              );
            });
            s.if(sql`attachment_response.status = 200`, (s) => {
              s.modify(
                sql`update ${sql.ref(opts.attachmentsTable)}
                    set blob_id = attachment_blob_id,
                        content_type = coalesce(
                          content_type,
                          (select value from attachment_headers where lower(name) = 'content-type' limit 1),
                          case
                            when contains(coalesce(filename, ''), '.ics') then 'text/calendar'
                            when contains(coalesce(filename, ''), '.vcf') then 'text/vcard'
                            else 'message/rfc822'
                          end
                        )
                    where attachment_id = attachment.attachment_id
                      and message_id = ${opts.emailId}
                      and user_outlook_emails_account_id = ${opts.accountId}`,
              );
            });
          },
          oauthOpts: opts,
        });
      },
    );
  }

  messages = {
    storeMessages: <T extends IServerBaseStatements>(
      s: T,
      opts: GetEmailsOpts,
    ) => {
      s.forEachQuery(
        sql`select * from json.array_each(message_list->'value')`,
        "message",
        (s) => {
          s.modify(
            sql`insert into ${sql.ref(opts.recipientsTable)}
                (
                  user_outlook_emails_account_id,
                  message_id,
                  email,
                  recipient_type
                )
              select
                ${opts.accountId},
                message.value->>'id',
                recipient.value->'emailAddress'->>'address',
                'to'
              from json.array_each(message.value->'toRecipients') recipient
              union all
              select
                ${opts.accountId},
                message.value->>'id',
                recipient.value->'emailAddress'->>'address',
                'cc'
              from json.array_each(message.value->'ccRecipients') recipient
              union all
              select
                ${opts.accountId},
                message.value->>'id',
                recipient.value->'emailAddress'->>'address',
                'bcc'
              from json.array_each(message.value->'bccRecipients') recipient`,
          );
        },
      );

      s.modify(sql`insert into ${sql.ref(opts.emailsTable)} select
        (value->>'id') as message_id,
        ${opts.accountId} as user_outlook_emails_account_id,
        (value->>'subject') as subject,
        (value->>'bodyPreview') as snippet,
        cast(((value->>'receivedDateTime')::timestamptz) as timestamp ) at time zone 'UTC' as date,
        coalesce(
          (value->'from'->'emailAddress'->>'name')
            || ' <' || (value->'from'->'emailAddress'->>'address') || '>',
          (value->'from'->'emailAddress'->>'address')
        ) as from,
        (value->'from'->'emailAddress'->>'address') as from_email,
        (
          select string_agg(
            reply_recipient.value->'emailAddress'->>'address',
            ', '
          )
          from json.array_each(value->'replyTo') reply_recipient
          where reply_recipient.value->'emailAddress'->>'address' is not null
        ) as reply_to,
        ${leanEmailBodyForStorage(sql`value->'body'->>'content'`)} as body_text,
        (value->>'conversationId') as thread_id,
        (value->>'internetMessageId') as message_reply_id,
        (
          select header.value->>'value'
          from json.array_each(value->'internetMessageHeaders') header
          where lower(header.value->>'name') = 'in-reply-to'
          limit 1
        ) as in_reply_to,
        case
          when value->'internetMessageHeaders' is null then null
          else coalesce((
            select json_agg(reference.value order by reference.ordinal)
            from json.array_each(value->'internetMessageHeaders') header
            join regex.matches(
              coalesce(header.value->>'value', ''),
              '<[^<>\\s]+@[^<>\\s]+>'
            ) reference
            where lower(header.value->>'name') = 'references'
          ), json_build_array())
        end as message_references,
        coalesce((value->>'isRead')::bool, false) as is_read,
        coalesce((value->>'hasAttachments')::bool, false)
          or contains(coalesce(value->'body'->>'content', ''), 'cid:') as has_attachments
      from json.array_each(message_list -> 'value') as value

      `);
    },

    list: <T extends IServerBaseStatements>(s: T, opts: GetEmailsOpts) => {
      s.block((s) => {
        s.defScalar("next_page_link", {
          type: "String",
        });

        s.defScalar(
          "message_list_query_filter",
          sql`trim(coalesce(${opts.query ?? sql`null`}, ''))`,
        );
        s.defScalar(
          "message_list_excluded_folder_filter",
          sql`trim(coalesce(${opts.excludedFolderFilter ?? sql`null`}, ''))`,
        );
        s.defScalar(
          "message_list_filter",
          sql`case
            when message_list_query_filter != '' and message_list_excluded_folder_filter != ''
              then message_list_query_filter || ' and ' || message_list_excluded_folder_filter
            when message_list_query_filter != '' then message_list_query_filter
            else message_list_excluded_folder_filter
          end`,
        );

        const requestPage = (
          statements: T,
          uri: Sql,
          errorPrefix: string,
        ) => {
          this.#auth.requestWithOauth(statements, {
            requestOpts: {
              uri,
              headers: [
                {
                  name: sql.lit`Prefer`,
                  value: sql.lit(HTML_IMMUTABLE_ID_PREFER),
                },
                ...(opts.search
                  ? [{
                    name: sql.lit`ConsistencyLevel`,
                    value: sql.lit`eventual`,
                  }]
                  : []),
              ],
              method: sql.lit`GET`,
              receiveJson: "message_list",
              responseRecord: "response",
            },
            afterRequest: (statements) => {
              statements.if(sql`response.status != 200`, (statements) => {
                statements.throwError(
                  sql.concat(
                    errorPrefix,
                    sql`response.status`,
                    " body=",
                    sql`left(coalesce(message_list::string, ''), 700)`,
                  ),
                );
              });
              this.messages.storeMessages(statements, opts);
              statements.setScalar(
                "next_page_link",
                sql`message_list->>'@odata.nextLink'`,
              );
            },
            oauthOpts: opts,
          });
        };
        const initialUri = sql.concat(
          sql.lit`https://graph.microsoft.com/v1.0/me/messages?`,
          queryParamsString({
            $top: opts.maxResults || 10,
            $skip: opts.pageToken,
            $search: opts.search,
            $select: opts.metadataOnly
              ? METADATA_SELECT_FIELDS
              : MESSAGE_SELECT_FIELDS,
          }),
          sql`case
            when message_list_filter = '' then ''
            else '&$filter=' || uri.encode_component(message_list_filter)
          end`,
        );
        if (opts.continuationUrl) {
          s.if(
            sql`${opts.continuationUrl} is null
              or trim(${opts.continuationUrl}) = ''`,
            (s) => {
              requestPage(s, initialUri, "Failed to list outlook messages: ");
            },
            (s) => {
              requestPage(
                s,
                opts.continuationUrl as Sql,
                "Failed to list outlook messages page: ",
              );
            },
          );
        } else {
          requestPage(s, initialUri, "Failed to list outlook messages: ");
        }
        s.while(
          sql`${
            opts.fetchAllPages ?? sql`false`
          } and next_page_link is not null`,
          (s) => {
            s.breakIf(sql`trim(next_page_link) = ''`);
            this.#auth.requestWithOauth(s, {
              requestOpts: {
                uri: sql`next_page_link`,
                headers: [
                  {
                    name: sql.lit`Prefer`,
                    value: sql.lit(HTML_IMMUTABLE_ID_PREFER),
                  },
                  ...(opts.search
                    ? [{
                      name: sql.lit`ConsistencyLevel`,
                      value: sql.lit`eventual`,
                    }]
                    : []),
                ],
                method: sql.lit`GET`,
                receiveJson: "message_list",
                responseRecord: "response",
              },
              afterRequest: (s) => {
                s.if(sql`response.status != 200`, (s) => {
                  s.throwError(
                    sql.concat(
                      "Failed to list outlook messages page: ",
                      sql`response.status`,
                      " body=",
                      sql`left(coalesce(message_list::string, ''), 700)`,
                    ),
                  );
                });
                this.messages.storeMessages(s, opts);
                s.setScalar(
                  "next_page_link",
                  sql`message_list->>'@odata.nextLink'`,
                );
              },
              oauthOpts: opts,
            });
          },
        );
        if (opts.nextPageLinkScalar) {
          s.setScalar(opts.nextPageLinkScalar, sql`next_page_link`);
        }
      });
    },

    send: <T extends IServerBaseStatements>(s: T, opts: SendEmailOpts) => {
      // Define scalar variables for JSON construction
      s.defScalar("request_body", {
        type: "Json",
      });
      const staticAttachments = (opts.attachments ?? []).reduce<Sql>(
        (result, attachment) =>
          sql`${result} || case
            when ${attachment.filename} is not null
              and ${attachment.content} is not null
            then ${
            sql.jsonBuildArray(
              sql.jsonBuildObject({
                "@odata.type": sql.lit`#microsoft.graph.fileAttachment`,
                name: attachment.filename,
                contentType: attachment.contentType,
                contentBytes: attachment.content,
              }),
            )
          }
            else json_build_array()
          end`,
        sql`json_build_array()`,
      );
      const hasStaticAttachments = opts.attachments?.length
        ? sql.or(
          ...opts.attachments.map((attachment) =>
            sql`${attachment.filename} is not null
              and ${attachment.content} is not null`
          ),
        )
        : sql`false`;
      const requestAttachments = opts.attachmentsTable
        ? sql`${staticAttachments} || coalesce((
            select json_array_agg(json_build_object(
              '@odata.type', '#microsoft.graph.fileAttachment',
              'name', filename,
              'contentType', content_type,
              'contentBytes', content
            ))
            from (
              select filename, content_type, content
              from ${sql.ref(opts.attachmentsTable)}
              order by id
            ) stored_attachments
          ), json_build_array())`
        : staticAttachments;

      // Check if we have an attachment
      s.defScalar(
        "hasAttachment",
        opts.attachmentsTable
          ? sql`${hasStaticAttachments} or exists (
              select 1 from ${sql.ref(opts.attachmentsTable)}
            )`
          : hasStaticAttachments,
      );
      // Check if this is a reply or a new email
      s.conditional({
        condition: sql`${opts.inReplyTo ?? sql`null`} is not null`,
        then: (s) => {
          s.if(sql`hasAttachment`, (s) => {
            s.throwError(
              sql.lit`Outlook reply attachments require a draft or MIME reply`,
            );
          });
          s.conditional({
            condition: opts.replyAll ?? sql`false`,
            then: (s) => {
              s.setScalar(
                "request_body",
                sql.jsonBuildObject({
                  comment: opts.body,
                }),
              );
            },
            else: (s) => {
              s.setScalar(
                "request_body",
                sql.jsonBuildObject({
                  message: sql.jsonBuildObject({
                    subject: opts.subject,
                    toRecipients: opts.toTable,
                    ccRecipients: opts.ccTable,
                    bccRecipients: opts.bccTable,
                  }),
                  comment: opts.body,
                }),
              );
            },
          });
        },
        else: (s) => {
          // Handle normal email case - build email request body
          s.conditional({
            condition: sql`hasAttachment`,
            then: (s) => {
              s.setScalar(
                "request_body",
                sql.jsonBuildObject({
                  message: sql.jsonBuildObject({
                    subject: opts.subject,
                    body: sql.jsonBuildObject({
                      contentType: sql.lit`Html`,
                      content: opts.body,
                    }),
                    toRecipients: opts.toTable,
                    ccRecipients: opts.ccTable,
                    bccRecipients: opts.bccTable,
                    attachments: requestAttachments,
                  }),
                }),
              );
            },
            else: (s) => {
              s.setScalar(
                "request_body",
                sql.jsonBuildObject({
                  message: sql.jsonBuildObject({
                    subject: opts.subject,
                    body: sql.jsonBuildObject({
                      contentType: sql.lit`Html`,
                      content: opts.body,
                    }),
                    toRecipients: opts.toTable,
                    ccRecipients: opts.ccTable,
                    bccRecipients: opts.bccTable,
                  }),
                }),
              );
            },
          });
        },
      });

      // Make the request with OAuth
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: opts.inReplyTo
            ? sql`case
                when ${opts.replyAll ?? false}
                  then 'https://graph.microsoft.com/v1.0/me/messages/'
                    || uri.encode_component(${opts.inReplyTo}) || '/replyAll'
                else 'https://graph.microsoft.com/v1.0/me/messages/'
                    || uri.encode_component(${opts.inReplyTo}) || '/reply'
              end`
            : sql.lit`https://graph.microsoft.com/v1.0/me/sendMail`,
          method: sql.lit`POST`,
          headers: [
            {
              name: sql.lit`Content-Type`,
              value: sql.lit`application/json`,
            },
            {
              name: sql.lit`Prefer`,
              value: sql.lit(IMMUTABLE_ID_PREFER),
            },
          ],
          json: sql`request_body`,
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.if(sql`response.status != 202`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to send outlook message: ",
                sql`response.status`,
              ),
            );
          });
        },
        oauthOpts: opts,
      });
    },

    watch: <T extends IServerBaseStatements>(
      s: T,
      opts: {
        accountId: Sql;
        clientState: Sql;
        responseRecord?: string;
        notificationUrl: Sql;
      } & Oauth2TokenOpts,
    ) => {
      const responseRecord = opts.responseRecord ?? "watch_response";
      s.defRecord(responseRecord, {
        fields: [
          { name: "id", type: "String" },
          { name: "resource_id", type: "String" },
          { name: "resource_uri", type: "String" },
          { name: "token", type: "String" },
          { name: "expiration", type: "String" },
        ],
      });
      s.defScalar(
        "current_timezone",
        sql`date.part(timezone,current_timestamp())`,
      );
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.lit`https://graph.microsoft.com/v1.0/subscriptions`,
          method: "POST",
          headers: [
            {
              name: sql.lit`Prefer`,
              value: sql.lit(IMMUTABLE_ID_PREFER),
            },
          ],
          json: {
            changeType: sql.lit`created,deleted`,
            notificationUrl: opts.notificationUrl,
            lifecycleNotificationUrl: opts.notificationUrl,
            resource: sql.lit`/me/messages?$filter=isDraft eq false`,
            expirationDateTime: sql`date.to_rfc3339(
            date.add(day,2, current_timestamp at time zone current_timezone) at time zone current_timezone,
            'auto',
            false
          )`,
            clientState: opts.clientState,
          },
          receiveJson: "notification_channel_response",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.if(sql`response.status != 201`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to watch outlook messages: ",
                sql`response.status`,
                " code=",
                sql`coalesce(notification_channel_response->'error'->>'code', 'NULL')`,
                " message=",
                sql`coalesce(notification_channel_response->'error'->>'message', 'NULL')`,
                " body=",
                sql`left(coalesce(notification_channel_response::string, ''), 700)`,
              ),
            );
          });
          s.modify(
            sql`insert into ${
              sql.ref(responseRecord)
            }  (id, resource_id, expiration)
        values (notification_channel_response->>'id', notification_channel_response->>'resourceId', (notification_channel_response->>'expirationDateTime'))`,
          );
        },
        oauthOpts: opts,
      });
    },

    renewSubscription: <T extends IServerBaseStatements>(
      s: T,
      opts: {
        resourceId: Sql;
        responseRecord?: string;
      } & Oauth2TokenOpts,
    ) => {
      const responseRecord = opts.responseRecord ??
        "renew_subscription_response";
      s.defRecord(responseRecord, {
        fields: [
          { name: "status", type: "Int" },
          { name: "expiration", type: "Timestamp" },
        ],
      });
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://graph.microsoft.com/v1.0/subscriptions/`,
            opts.resourceId,
          ),
          method: "PATCH",
          json: {
            expirationDateTime: sql`date.to_rfc3339(
              date.add(
                day,
                2,
                current_timestamp
                  at time zone date.part(timezone, current_timestamp())
              ) at time zone date.part(timezone, current_timestamp()),
              'auto',
              false
            )`,
          },
          receiveJson: "renew_subscription_response_json",
          responseRecord: "renew_subscription_http_response",
        },
        afterRequest: (s) => {
          s.if(
            sql`renew_subscription_http_response.status != 200
              and renew_subscription_http_response.status != 404`,
            (s) => {
              s.throwError(
                sql.concat(
                  "Failed to renew outlook subscription: ",
                  sql`renew_subscription_http_response.status`,
                  " code=",
                  sql`coalesce(renew_subscription_response_json->'error'->>'code', 'NULL')`,
                  " message=",
                  sql`coalesce(renew_subscription_response_json->'error'->>'message', 'NULL')`,
                  " body=",
                  sql`left(coalesce(renew_subscription_response_json::string, ''), 700)`,
                ),
              );
            },
          );
          s.defScalar(
            "renewed_subscription_expiration",
            sql`coalesce(
              try_cast(
                renew_subscription_response_json->>'expirationDateTime'
                as timestamptz
              )
                at time zone date.part(timezone, current_timestamp())
                at time zone date.part(timezone, current_timestamp()),
              try_cast(
                renew_subscription_response_json->>'expirationDateTime'
                as timestamp
              ) at time zone 'UTC'
            )`,
          );
          s.if(
            sql`renew_subscription_http_response.status = 200
              and renewed_subscription_expiration is null`,
            (s) => {
              s.throwError(
                sql`concat(
                  'Outlook subscription renewal response missing a valid expirationDateTime: ',
                  left(
                    coalesce(
                      renew_subscription_response_json::string,
                      ''
                    ),
                    700
                  )
                )`,
              );
            },
          );
          s.modify(
            sql`insert into ${sql.ref(responseRecord)} (status, expiration)
              values (
                renew_subscription_http_response.status,
                renewed_subscription_expiration
              )`,
          );
        },
        oauthOpts: opts,
      });
    },

    stopWatch: <T extends IServerBaseStatements>(
      s: T,
      opts: {
        resourceId: Sql;
      } & Oauth2TokenOpts,
    ) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://graph.microsoft.com/v1.0/subscriptions/`,
            opts.resourceId,
          ),
          method: "DELETE",
          responseRecord: "response",
        },
        afterRequest: (s) => {
          s.if(sql`response.status != 204 and response.status != 404`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to stop notification channel: ",
                sql`response.status`,
              ),
            );
          });
        },
        oauthOpts: opts,
      });
    },

    get: <T extends IServerBaseStatements>(s: T, opts: GetSingleEmailOpts) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://graph.microsoft.com/v1.0/me/messages/`,
            sql`uri.encode_component(${opts.emailId})`,
            sql.lit`?`,
            queryParamsString({
              $select: opts.metadataOnly
                ? METADATA_SELECT_FIELDS
                : MESSAGE_SELECT_FIELDS,
            }),
          ),
          headers: [
            {
              name: sql.lit`Prefer`,
              value: sql.lit(HTML_IMMUTABLE_ID_PREFER),
            },
          ],
          method: sql.lit`GET`,
          receiveJson: "response_json",
        },
        afterRequest: (s) => {
          s.if(sql`response.status != 200`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to get outlook message: ",
                sql`response.status`,
                " body=",
                sql`left(coalesce(response_json::string, ''), 700)`,
              ),
            );
          });
          s.modify(sql`insert into ${sql.ref(opts.emailsTable)} select
          (response_json->>'id') as message_id,
          ${opts.accountId} as user_outlook_emails_account_id,
          (response_json->>'subject') as subject,
          (response_json->>'bodyPreview') as snippet,
          cast((response_json->>'receivedDateTime')::timestamptz as timestamp) at time zone 'UTC' as date,
          coalesce(
            (response_json->'from'->'emailAddress'->>'name')
              || ' <' || (response_json->'from'->'emailAddress'->>'address') || '>',
            (response_json->'from'->'emailAddress'->>'address')
          ) as from,
          (response_json->'from'->'emailAddress'->>'address') as from_email,
          (
            select string_agg(
              reply_recipient.value->'emailAddress'->>'address',
              ', '
            )
            from json.array_each(response_json->'replyTo') reply_recipient
            where reply_recipient.value->'emailAddress'->>'address' is not null
          ) as reply_to,
          ${
            leanEmailBodyForStorage(sql`response_json->'body'->>'content'`)
          } as body_text,
          (response_json->>'conversationId') as thread_id,
          (response_json->>'internetMessageId') as message_reply_id,
          (
            select header.value->>'value'
            from json.array_each(response_json->'internetMessageHeaders') header
            where lower(header.value->>'name') = 'in-reply-to'
            limit 1
          ) as in_reply_to,
          case
            when response_json->'internetMessageHeaders' is null then null
            else coalesce((
              select json_agg(reference.value order by reference.ordinal)
              from json.array_each(response_json->'internetMessageHeaders') header
              join regex.matches(
                coalesce(header.value->>'value', ''),
                '<[^<>\\s]+@[^<>\\s]+>'
              ) reference
              where lower(header.value->>'name') = 'references'
            ), json_build_array())
          end as message_references,
          coalesce((response_json->>'isRead')::bool, false) as is_read,
          coalesce((response_json->>'hasAttachments')::bool, false)
            or contains(coalesce(response_json->'body'->>'content', ''), 'cid:') as has_attachments
      `);
          s.modify(
            sql`insert into ${sql.ref(opts.recipientsTable)}
                (
                  user_outlook_emails_account_id,
                  message_id,
                  email,
                  recipient_type
                )
              select
                ${opts.accountId},
                response_json->>'id',
                recipient.value->'emailAddress'->>'address',
                'to'
              from json.array_each(response_json->'toRecipients') recipient
              union all
              select
                ${opts.accountId},
                response_json->>'id',
                recipient.value->'emailAddress'->>'address',
                'cc'
              from json.array_each(response_json->'ccRecipients') recipient
              union all
              select
                ${opts.accountId},
                response_json->>'id',
                recipient.value->'emailAddress'->>'address',
                'bcc'
              from json.array_each(response_json->'bccRecipients') recipient`,
          );
        },
        oauthOpts: opts,
      });
    },
    getHeaders: <T extends IServerBaseStatements>(
      s: T,
      opts: Oauth2TokenOpts & {
        accountId: Sql;
        emailId: Sql;
        headersTable: string;
      },
    ) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://graph.microsoft.com/v1.0/me/messages/`,
            sql`uri.encode_component(${opts.emailId})`,
            sql.lit(MESSAGE_HEADER_SELECT_QUERY_PARAM),
          ),
          headers: [{
            name: sql.lit`Prefer`,
            value: sql.lit(IMMUTABLE_ID_PREFER),
          }],
          method: sql.lit`GET`,
          receiveJson: "message_headers_response",
          responseRecord: "message_headers_response_record",
        },
        afterRequest: (s) => {
          s.if(sql`message_headers_response_record.status != 200`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to get outlook message headers: ",
                sql`message_headers_response_record.status`,
                " body=",
                sql`left(coalesce(message_headers_response::string, ''), 700)`,
              ),
            );
          });
          s.modify(sql`insert into ${sql.ref(opts.headersTable)}
            select
              ${opts.accountId},
              message_headers_response->>'id',
              message_headers_response->>'internetMessageId',
              message_headers_response->>'conversationId',
              (
                select header.value->>'value'
                from json.array_each(
                  message_headers_response->'internetMessageHeaders'
                ) header
                where lower(header.value->>'name') = 'in-reply-to'
                limit 1
              ),
              case
                when message_headers_response->'internetMessageHeaders' is null
                  then json_build_array()
                else coalesce((
                  select json_agg(
                    reference.value order by reference.ordinal
                  )
                  from json.array_each(
                    message_headers_response->'internetMessageHeaders'
                  ) header
                  join regex.matches(
                    coalesce(header.value->>'value', ''),
                    '<[^<>\\s]+@[^<>\\s]+>'
                  ) reference
                  where lower(header.value->>'name') = 'references'
                ), json_build_array())
              end
          `);
        },
        oauthOpts: opts,
      });
    },
    getBatch: <T extends IServerBaseStatements>(
      s: T,
      opts: GetEmailBatchOpts,
    ) => {
      s.defTable(
        "__outlook_message_batch_requests",
        sql`with numbered as (
              select
                message_id,
                row_number() over (order by message_id) - 1 as rn
              from ${sql.ref(opts.messageIdsTable)}
            )
            select
              message_id,
              cast(rn as string) as request_id,
              floor(rn / ${MESSAGE_BATCH_SIZE}) as batch_idx,
              rn
            from numbered`,
      );
      s.forEachQuery(
        sql`select
              batch_idx,
              json_build_object(
                'requests',
                json_agg(
                  json_build_object(
                    'id', request_id,
                    'method', 'GET',
                    'url',
                      '/me/messages/' || uri.encode_component(message_id) || ${
          sql.lit(MESSAGE_SELECT_QUERY_PARAM)
        },
                    'headers',
                      json_build_object(
                        'Prefer',
                        ${sql.lit(HTML_IMMUTABLE_ID_PREFER)}
                      )
                  )
                  order by rn
                )
              ) as request_body
            from __outlook_message_batch_requests
            group by batch_idx
            order by batch_idx`,
        "message_batch",
        (s) => {
          this.#auth.requestWithOauth(s, {
            requestOpts: {
              uri: sql.lit`https://graph.microsoft.com/v1.0/$batch`,
              method: sql.lit`POST`,
              headers: [
                {
                  name: sql.lit`Content-Type`,
                  value: sql.lit`application/json`,
                },
              ],
              json: sql`message_batch.request_body`,
              receiveJson: "message_batch_response",
              responseRecord: "message_batch_response_record",
            },
            afterRequest: (s) => {
              s.if(sql`message_batch_response_record.status != 200`, (s) => {
                s.throwError(
                  sql.concat(
                    "Failed to batch get outlook messages: ",
                    sql`message_batch_response_record.status`,
                    " body=",
                    sql`left(coalesce(message_batch_response::string, ''), 700)`,
                  ),
                );
              });
              s.modify(sql`insert into ${sql.ref(opts.emailsTable)} select
                (response.value->'body'->>'id') as message_id,
                ${opts.accountId} as user_outlook_emails_account_id,
                (response.value->'body'->>'subject') as subject,
                (response.value->'body'->>'bodyPreview') as snippet,
                cast((response.value->'body'->>'receivedDateTime')::timestamptz as timestamp) at time zone 'UTC' as date,
                coalesce(
                  (response.value->'body'->'from'->'emailAddress'->>'name')
                    || ' <' || (response.value->'body'->'from'->'emailAddress'->>'address') || '>',
                  (response.value->'body'->'from'->'emailAddress'->>'address')
                ) as from,
                (response.value->'body'->'from'->'emailAddress'->>'address') as from_email,
                (
                  select string_agg(
                    reply_recipient.value->'emailAddress'->>'address',
                    ', '
                  )
                  from json.array_each(
                    response.value->'body'->'replyTo'
                  ) reply_recipient
                  where reply_recipient.value->'emailAddress'->>'address'
                    is not null
                ) as reply_to,
                ${
                leanEmailBodyForStorage(
                  sql`response.value->'body'->'body'->>'content'`,
                )
              } as body_text,
                (response.value->'body'->>'conversationId') as thread_id,
                (response.value->'body'->>'internetMessageId') as message_reply_id,
                (
                  select header.value->>'value'
                  from json.array_each(
                    response.value->'body'->'internetMessageHeaders'
                  ) header
                  where lower(header.value->>'name') = 'in-reply-to'
                  limit 1
                ) as in_reply_to,
                case
                  when response.value->'body'->'internetMessageHeaders' is null
                    then null
                  else coalesce((
                    select json_agg(reference.value order by reference.ordinal)
                    from json.array_each(
                      response.value->'body'->'internetMessageHeaders'
                    ) header
                    join regex.matches(
                      coalesce(header.value->>'value', ''),
                      '<[^<>\\s]+@[^<>\\s]+>'
                    ) reference
                    where lower(header.value->>'name') = 'references'
                  ), json_build_array())
                end as message_references,
                coalesce((response.value->'body'->>'isRead')::bool, false) as is_read,
                coalesce((response.value->'body'->>'hasAttachments')::bool, false)
                  or contains(coalesce(response.value->'body'->'body'->>'content', ''), 'cid:') as has_attachments
                from json.array_each(message_batch_response->'responses') as response
                where (response.value->>'status')::int = 200`);
              if (opts.failedMessagesTable) {
                s.modify(sql`insert into ${sql.ref(opts.failedMessagesTable)}
                  (user_outlook_emails_account_id, message_id, status, error_message)
                  select
                    ${opts.accountId},
                    request.message_id,
                    coalesce(
                      (
                        select (response.value->>'status')::int
                        from json.array_each(
                          message_batch_response->'responses'
                        ) as response
                        where response.value->>'id' = request.request_id
                        limit 1
                      ),
                      0
                    ),
                    concat(
                      'Failed to get outlook message: ',
                      coalesce(
                        (
                          select response.value->>'status'
                          from json.array_each(
                            message_batch_response->'responses'
                          ) as response
                          where response.value->>'id' = request.request_id
                          limit 1
                        ),
                        '<missing response>'
                      ),
                      ' body=',
                      left(
                        coalesce(
                          (
                            select (response.value->'body')::string
                            from json.array_each(
                              message_batch_response->'responses'
                            ) as response
                            where response.value->>'id' = request.request_id
                            limit 1
                          ),
                          ''
                        ),
                        700
                      )
                    )
                  from __outlook_message_batch_requests request
                  where request.batch_idx = message_batch.batch_idx
                    and not exists (
                      select 1
                      from json.array_each(
                        message_batch_response->'responses'
                      ) as response
                      where response.value->>'id' = request.request_id
                        and (response.value->>'status')::int = 200
                    )`);
              }
              s.forEachQuery(
                sql`select response.value->'body' as body
                    from json.array_each(message_batch_response->'responses') as response
                    where (response.value->>'status')::int = 200`,
                "batch_message",
                (s) => {
                  s.modify(
                    sql`insert into ${sql.ref(opts.recipientsTable)}
                        (
                          user_outlook_emails_account_id,
                          message_id,
                          email,
                          recipient_type
                        )
                      select
                        ${opts.accountId},
                        batch_message.body->>'id',
                        recipient.value->'emailAddress'->>'address',
                        'to'
                      from json.array_each(
                        batch_message.body->'toRecipients'
                      ) recipient
                      union all
                      select
                        ${opts.accountId},
                        batch_message.body->>'id',
                        recipient.value->'emailAddress'->>'address',
                        'cc'
                      from json.array_each(
                        batch_message.body->'ccRecipients'
                      ) recipient
                      union all
                      select
                        ${opts.accountId},
                        batch_message.body->>'id',
                        recipient.value->'emailAddress'->>'address',
                        'bcc'
                      from json.array_each(
                        batch_message.body->'bccRecipients'
                      ) recipient`,
                  );
                },
              );
            },
            oauthOpts: opts,
          });
        },
      );
    },
    markAsRead: <T extends IServerBaseStatements>(
      s: T,
      opts: {
        messageId: AnyExpr;
        accountId: AnyExpr;
      } & Oauth2TokenOpts,
    ) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql.concat(
            sql.lit`https://graph.microsoft.com/v1.0/me/messages/`,
            opts.messageId,
          ),
          method: sql.lit`PATCH`,
          headers: [
            {
              name: sql.lit`Prefer`,
              value: sql.lit(IMMUTABLE_ID_PREFER),
            },
          ],
          json: {
            isRead: true,
          },
        },
        afterRequest: (s) => {
          s.if(sql`response.status < 200 or response.status >= 300`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to mark outlook message as read: ",
                sql`response.status`,
              ),
            );
          });
        },
        oauthOpts: opts,
      });
    },
  };

  folders = {
    list: <T extends IServerBaseStatements>(s: T, opts: GetFoldersOpts) => {
      this.#auth.requestWithOauth(s, {
        requestOpts: {
          uri: sql
            .lit`https://graph.microsoft.com/v1.0/me/mailFolders/junkemail`,
          method: sql.lit`GET`,
          receiveJson: "response_json",
        },
        afterRequest: (s) => {
          s.if(sql`response.status != 200`, (s) => {
            s.throwError(
              sql.concat(
                "Failed to list outlook folders: ",
                sql`response.status`,
                " body=",
                sql`left(coalesce(response_json::string, ''), 700)`,
              ),
            );
          });
          s.modify(
            sql`insert into ${sql.ref(opts.foldersTable)}
              select
                response_json->>'id' as folder_id`,
          );
        },
        oauthOpts: opts,
      });
    },
  };
  attachments = {
    get: <T extends IServerBaseStatements>(s: T, opts: GetAttachmentsOpts) => {
      const storeAttachments = (s: T) => {
        s.modify(sql`insert into ${sql.ref(opts.attachmentsTable)} select
          ${opts.accountId} as user_outlook_emails_account_id,
          ${opts.emailId} as message_id,
          (value->>'id') as attachment_id,
          (value->>'@odata.type') as attachment_type,
          (value->>'name') as filename,
          (value->>'contentType') as content_type,
          (value->>'contentId') as content_id,
          coalesce((value->>'isInline')::bool, false) as is_inline,
          bytes.from_hex(null::string) as blob_id,
          coalesce(value->>'sourceUrl', value->>'webUrl', value->>'previewUrl') as external_url,
          value->>'providerType' as provider_type,
          try_cast(value->>'size' as bigint) as size_bytes
          from json.array_each(json_attachments->'value') as value
        `);
      };
      s.defScalar("next_attachment_page_link", {
        type: "String",
      });
      const requestPage = (s: T, uri: Sql, errorPrefix: string) => {
        this.#auth.requestWithOauth(s, {
          requestOpts: {
            uri,
            method: sql.lit`GET`,
            headers: [
              {
                name: sql.lit`Prefer`,
                value: sql.lit(IMMUTABLE_ID_PREFER),
              },
            ],
            receiveJson: "json_attachments",
            responseRecord: "response",
          },
          afterRequest: (s) => {
            s.if(sql`response.status != 200`, (s) => {
              s.throwError(
                sql.concat(
                  errorPrefix,
                  sql`response.status`,
                  " body=",
                  sql`left(coalesce(json_attachments::string, ''), 700)`,
                ),
              );
            });
            storeAttachments(s);
            s.setScalar(
              "next_attachment_page_link",
              sql`json_attachments->>'@odata.nextLink'`,
            );
          },
          oauthOpts: opts,
        });
      };
      const initialUri = sql.concat(
        sql.lit`https://graph.microsoft.com/v1.0/me/messages/`,
        sql`uri.encode_component(${opts.emailId})`,
        sql.lit`/attachments`,
        sql.lit(ATTACHMENT_METADATA_SELECT_QUERY_PARAM),
      );
      if (opts.continuationUrl) {
        s.if(
          sql`${opts.continuationUrl} is null
            or trim(${opts.continuationUrl}) = ''`,
          (s) =>
            requestPage(
              s,
              initialUri,
              "Failed to list outlook message attachments: ",
            ),
          (s) =>
            requestPage(
              s,
              opts.continuationUrl as Sql,
              "Failed to list outlook message attachments page: ",
            ),
        );
      } else {
        requestPage(
          s,
          initialUri,
          "Failed to list outlook message attachments: ",
        );
      }
      if (opts.fetchAllPages === true) {
        s.while(sql`next_attachment_page_link is not null`, (s) => {
          s.breakIf(sql`trim(next_attachment_page_link) = ''`);
          requestPage(
            s,
            sql`next_attachment_page_link`,
            "Failed to list outlook message attachments page: ",
          );
        });
      }
      if (opts.nextPageLinkScalar) {
        s.setScalar(opts.nextPageLinkScalar, sql`next_attachment_page_link`);
      }
    },
    fetchMissingContent: <T extends IServerBaseStatements>(
      s: T,
      opts: GetAttachmentsOpts,
    ) => {
      this.#fetchMissingAttachmentContent(s, opts);
    },
  };
}
