import { CrmBlock } from "blocks/crm";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { ChipButton } from "components/chip_button";
import { CircularProgress } from "components/circular_progress";
import { Divider } from "components/divider";
import { EachSelect } from "components/each_select";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { GmailIcon } from "components/icons/gmail";
import { OutlookEmailIcon } from "components/icons/outlook_email";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Sheet } from "components/sheet";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { singularize } from "std/inflectors";
import { Data } from "std/data";
import type { BooleanExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type {
  DomStatements,
  StateStatements,
  UiServerStatements,
} from "std/statements";
import { createStyles } from "std/style_utils";
import { system } from "std/system";
import { Conditional, Each, QueryParams, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { SidebarPresenceICtxKey } from "std/ictx";
import { ActionButton } from "std/action_button";
import { Sidebar } from "components/sidebar";
import { convertAmpHtmlToHtml, GmailIntegration } from "./gmail";
import type { SendEmailOpts } from "./index";
import { OutlookEmailIntegration } from "./outlook_email";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import { MAX_SERVER_EMAIL_ATTACHMENT_BYTES } from "./server_attachments";

const styles = createStyles({
  failureAlert: {
    position: "fixed",
    bottom: 16,
    left: 16,
    zIndex: 1000,
  },
});

function emailAttachmentUrl(blobId: Sql): Sql {
  if (system.hasBlock(GmailIntegration)) {
    return system.block(GmailIntegration).getAttachmentUrl(blobId);
  }
  if (system.hasBlock(OutlookEmailIntegration)) {
    return system.block(OutlookEmailIntegration).getAttachmentUrl(blobId);
  }
  return sql.lit``;
}

function defineEmailBodyForAction(
  s: StateStatements,
  integrationTable: string,
  emailRecord: Sql,
): Sql {
  const hasBodyBlob = !!system.db.tables[integrationTable]?.fields.body_blob;
  s.defRecord(
    "action_email_source",
    sql`select body_text${hasBodyBlob ? sql`, body_blob` : sql``}
        from ${sql.ref(integrationTable)}
        where id = ${emailRecord}.id`,
  );
  s.defScalar(
    "action_email_body_text",
    sql`coalesce(action_email_source.body_text, '')`,
  );
  if (hasBodyBlob) {
    s.if(sql`action_email_source.body_blob is not null`, (s) => {
      s.readBlob(sql`action_email_source.body_blob`, {
        defContentScalar: "action_email_body_bytes",
      });
      s.setScalar(
        "action_email_body_text",
        sql`string.from_utf8(action_email_body_bytes)`,
      );
    });
  }
  return sql`action_email_body_text`;
}

function availableAccountRows(
  provider: "gmail" | "outlook",
  providerLabel: "Gmail" | "Outlook",
  senders: Sql,
) {
  return sql`select
      available_sender.account_id,
      available_sender.from_address as email,
      ${sql.lit(provider)} as provider,
      concat(
        ${sql.lit(provider)}, ':',
        available_sender.account_id::string, ':',
        available_sender.from_address
      ) as account_key,
      concat(
        available_sender.from_address,
        ' (', ${sql.lit(providerLabel)}, ')'
      ) as account_label
    from (${senders}) available_sender`;
}

export function defineAvailableEmailAccounts(
  s: StateStatements,
  preferredAccount?: {
    provider: "gmail" | "outlook";
    accountId: Sql;
  },
) {
  if (system.hasBlock(GmailIntegration)) {
    s.defTable(
      "user_email_accounts",
      availableAccountRows(
        "gmail",
        "Gmail",
        system.block(GmailIntegration).availableSendersQuery(sql`current_user`),
      ),
    );
  } else {
    s.defTable("user_email_accounts", {
      fields: [
        { name: "account_id", type: "BigInt" },
        { name: "email", type: { type: "String", maxLength: 500 } },
        { name: "provider", type: { type: "String", maxLength: 20 } },
        { name: "account_key", type: { type: "String", maxLength: 550 } },
        { name: "account_label", type: { type: "String", maxLength: 530 } },
      ],
    });
  }
  if (system.hasBlock(OutlookEmailIntegration)) {
    s.modify(sql`insert into user_email_accounts (
        account_id, email, provider, account_key, account_label
      ) ${
      availableAccountRows(
        "outlook",
        "Outlook",
        system.block(OutlookEmailIntegration).availableSendersQuery(
          sql`current_user`,
        ),
      )
    }`);
  }
  s.defScalar(
    "selected_account_key",
    sql`(select account_key from user_email_accounts
      order by
        ${
      preferredAccount
        ? sql`case when provider = ${sql.lit(preferredAccount.provider)}
                and account_id = ${preferredAccount.accountId}
              then 0 else 1 end,`
        : sql``
    }
        provider, email, account_id
      limit 1)`,
  );
}

function EmailAccountSelector() {
  const selectedProvider =
    sql`(select provider from user_email_accounts where account_key = selected_account_key)`;
  return (
    <>
      <Show when={sql`not exists (select 1 from user_email_accounts)`}>
        <Alert
          variant="soft"
          color="warning"
          startIcon="Warning"
          endDecorator={
            <Button
              href="/email-integrations"
              size="sm"
              variant="solid"
              color="primary"
            >
              Connect account
            </Button>
          }
        >
          Connect an active email account before sending.
        </Alert>
      </Show>
      <Show
        when={sql`(select count(*) from user_email_accounts) = 1`}
      >
        <Typography
          level="body-sm"
          endDecorator={
            <Show
              when={sql`${selectedProvider} = 'gmail'`}
              fallback={<OutlookEmailIcon className="mr-6" />}
            >
              <GmailIcon className="mr-6" />
            </Show>
          }
        >
          Sending using{" "}
          {sql`(select email from user_email_accounts where account_key = selected_account_key)`}
        </Typography>
      </Show>
      <Show when={sql`(select count(*) from user_email_accounts) > 1`}>
        <EachSelect
          size="md"
          color="neutral"
          variant="outlined"
          startDecorator={<Typography level="body-sm">From:</Typography>}
          endDecorator={
            <Show
              when={sql`${selectedProvider} = 'gmail'`}
              fallback={<OutlookEmailIcon className="mr-6" />}
            >
              <GmailIcon className="mr-6" />
            </Show>
          }
          id="selected_account_key"
          value={sql`selected_account_key`}
          placeholder="From:"
          table="user_email_accounts"
          optionLabel="account_label"
          optionValue="account_key"
          valueType="String"
          onChange={(s) => {
            s.setScalar("selected_account_key", sql`target_value`);
          }}
          className="mt-4 w-[80%]"
        />
      </Show>
    </>
  );
}

function emailSendLifecycle(
  openScalar: string,
): Pick<SendEmailOpts, "afterEmailSent" | "onEmailSendError"> {
  return {
    afterEmailSent: (s) => {
      s.setScalar("sending", sql`false`);
      s.setScalar("send_error", sql`null`);
      s.setScalar("success", sql`true`);
      s.setScalar(openScalar, sql`false`);
    },
    onEmailSendError: (s, ctx) => {
      s.setScalar("sending", sql`false`);
      s.setScalar(
        "send_error",
        sql`'Email could not be confirmed as sent. ' || coalesce(
          ${ctx.errorMessage},
          'Review the message and try again.'
        )`,
      );
    },
  };
}

interface SelectedEmailAccount {
  provider: Sql;
  accountId: Sql;
  from: Sql;
}

function selectedEmailAccount(): SelectedEmailAccount {
  const selectedRow = sql`from user_email_accounts
    where account_key = selected_account_key`;
  return {
    provider: sql`(select provider ${selectedRow})`,
    accountId: sql`(select account_id ${selectedRow})`,
    from: sql`(select email ${selectedRow})`,
  };
}

function normalizedEmailAddress(value: Sql): Sql {
  return sql`lower(trim(case
    when ${value} like '%<%>%'
      then substring(
        ${value}
        from position('<' in ${value}) + 1
        for position('>' in ${value}) - position('<' in ${value}) - 1
      )
    else ${value}
  end))`;
}

function currentUserOwnsEmailAddress(value: Sql): BooleanExpr {
  const normalizedValue = normalizedEmailAddress(value);
  const conditions: BooleanExpr[] = [];
  if (system.hasBlock(GmailIntegration)) {
    conditions.push(sql`exists (
      select 1
      from user_gmail_accounts account
      where account.sys_user_id = current_user
        and ${normalizedEmailAddress(sql`account.email`)} = ${normalizedValue}
      union all
      select 1
      from user_gmail_aliases alias
      join user_gmail_accounts account
        on account.id = alias.user_gmail_account_id
      where account.sys_user_id = current_user
        and ${normalizedEmailAddress(sql`alias.email`)} = ${normalizedValue}
    )`);
  }
  if (system.hasBlock(OutlookEmailIntegration)) {
    conditions.push(sql`exists (
      select 1
      from user_outlook_emails_accounts account
      where account.sys_user_id = current_user
        and ${normalizedEmailAddress(sql`account.email`)} = ${normalizedValue}
    )`);
  }
  return conditions.length > 0 ? sql.or(...conditions) : sql`false`;
}

/**
 * Renders a single email row that expands inline to show recipients, body,
 * attachments and Reply / Reply All / Forward actions. Expects to run inside an
 * `Each` over emails with a record named `email` and a UI scalar
 * `expanded_email_id` tracking which row is open.
 *
 * @category UI Component
 */
export function EmailItem({
  integrationTable,
  recipientsTable,
  attachmentsTable,
  recieved,
  markAsRead,
  bodyFieldNode,
  enableCompose = true,
  extraActions,
  forceExpanded = false,
  hideHeader = false,
  attachmentEmailId,
}: {
  /** Email table to read the expanded row's full record from. */
  integrationTable: string;
  /** Table holding the to/cc/bcc recipients for each email. */
  recipientsTable: string;
  /** Table holding the email's attachments. */
  attachmentsTable: string;
  /** True for inbox (received) messages; enables mark-as-read on expand. */
  recieved: boolean;
  /** Marks the message read in the provider when an unread row is expanded. */
  markAsRead?: (
    s: UiServerStatements,
    opts: {
      messageId: Sql;
    },
  ) => void;
  /** Node that renders the email body (provider-specific). */
  bodyFieldNode: Node;
  /** When false, hides the Reply / Reply All / Forward actions. */
  enableCompose?: boolean;
  /** Extra action buttons rendered in the expanded row's action bar. */
  extraActions?: Node;
  /** Render the row already expanded (e.g. inside a thread view). */
  forceExpanded?: boolean;
  /** Condition for hiding the collapsed summary header row. */
  hideHeader?: BooleanExpr;
  /** Physical occurrence whose attachment collection is most complete. */
  attachmentEmailId?: Sql;
}) {
  // Use a unique ID for each email to track expansion state
  const attachmentBlobUrl = emailAttachmentUrl(sql`attachment.data`);
  const emailFields = system.db.tables[integrationTable]?.fields;
  const accountColumns = sql`${
    emailFields?.user_gmail_account_id ? sql`, user_gmail_account_id` : sql``
  }${
    emailFields?.user_outlook_emails_account_id
      ? sql`, user_outlook_emails_account_id`
      : sql``
  }`;
  const preferredAccount = emailFields?.user_outlook_emails_account_id
    ? {
      provider: "outlook" as const,
      accountId: sql`email_record.user_outlook_emails_account_id`,
    }
    : emailFields?.user_gmail_account_id
    ? {
      provider: "gmail" as const,
      accountId: sql`email_record.user_gmail_account_id`,
    }
    : undefined;
  const occurrenceOwnerConditions: BooleanExpr[] = [];
  if (emailFields?.user_gmail_account_id) {
    occurrenceOwnerConditions.push(sql`exists (
      select 1
      from db.user_gmail_accounts account
      where account.id = email_record.user_gmail_account_id
        and account.sys_user_id = current_user
    )`);
  }
  if (emailFields?.user_outlook_emails_account_id) {
    occurrenceOwnerConditions.push(sql`exists (
      select 1
      from db.user_outlook_emails_accounts account
      where account.id = email_record.user_outlook_emails_account_id
        and account.sys_user_id = current_user
    )`);
  }
  const currentUserOwnsOccurrence = occurrenceOwnerConditions.length > 0
    ? sql.or(...occurrenceOwnerConditions)
    : sql`false`;

  return (
    <Data
      local
      watch={[sql`expanded_email_id`]}
      procedure={(s) => {
        s.defRecord(
          "email_record",
          sql`select
                id,
                message_id,
                message_reply_id,
                thread_id,
                subject,
                snippet,
                "from",
                from_email,
                reply_to,
                date,
                is_read,
                has_attachments
                ${accountColumns}
              from ${sql.ref(integrationTable)}
              where id = email.id`,
        );
        s.defScalar(
          "sender_name",
          sql`case when email_record.from like '%<%>%'
            then trim(both ' ' from substring(email_record.from from 1 for position('<' in email_record.from) - 1))
            else coalesce(email_record.from, '')
          end`,
        );
        s.defScalar("reply_open", false);
        s.defScalar("forward_open", false);
        s.defScalar(
          "is_expanded",
          forceExpanded ? sql`true` : sql`expanded_email_id = email.id`,
        );
        s.defScalar("reply_all", false);
      }}
    >
      <div
        sx={{
          width: "100%",
          borderBottom: "1px solid",
          borderColor: "divider",
          backgroundColor: "background.level1",
          "&:hover": {
            boxShadow: "sm",
            zIndex: 1,
            position: "relative",
          },
          "&.unread": {
            backgroundColor: "background.body",
          },
          "&.unread .sender, &.unread .subject, &.unread .snippet, &.unread .date":
            {
              fontWeight: 700,
              color: "text.primary",
            },
        }}
        dynamicClass={{
          classes: "unread",
          condition: sql`not email_record.is_read`,
        }}
      >
        <div
          className="flex items-center gap-3 cursor-pointer"
          sx={{ px: 2, py: 0.5, minHeight: 32 }}
          dynamicClass={{ classes: "hidden", condition: hideHeader }}
          onClick={(s) => {
            s.setScalar(
              "expanded_email_id",
              sql`case when expanded_email_id = email.id then null else email.id end`,
            );
            if (recieved) {
              s.if(sql`email_record.is_read = false`, (s) => {
                s.tryServer({
                  body: (s) => {
                    s.if(currentUserOwnsOccurrence, (s) => {
                      if (markAsRead) {
                        markAsRead(s, {
                          messageId: sql`email_record.message_id`,
                        });
                      }
                      s.startTransaction();
                      s.modify(
                        sql`update ${
                          sql.ref(integrationTable)
                        } set is_read = true where id = email.id`,
                      );
                      s.commitTransaction();
                    });
                  },
                  errorName: "update_email_status_error",
                  catch: (s) =>
                    s.debugExpr(
                      sql`update_email_status_error.message || 'Unable to update email status'`,
                    ),
                  finally: (s) => {
                    s.refetch();
                  },
                });
              });
            }
          }}
        >
          <Typography
            level="body-sm"
            noWrap
            className="sender"
            sx={{
              width: forceExpanded ? "auto" : 180,
              flex: forceExpanded ? 1 : undefined,
              flexShrink: 0,
              color: "text.secondary",
            }}
          >
            {sql`case when sender_name = '' then '(no sender)' else sender_name end`}
          </Typography>
          {forceExpanded
            ? undefined
            : (
              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <Typography
                  level="body-sm"
                  noWrap
                  className="subject"
                  sx={{
                    flexShrink: 0,
                    maxWidth: "50%",
                    color: "text.secondary",
                  }}
                >
                  {sql`coalesce(email_record.subject, '(no subject)')`}
                </Typography>
                <Typography
                  level="body-sm"
                  noWrap
                  className="snippet"
                  sx={{ color: "text.tertiary", flex: 1, minWidth: 0 }}
                >
                  {sql`case when coalesce(email_record.snippet, '') = '' then '' else '- ' || email_record.snippet end`}
                </Typography>
              </div>
            )}
          <Data
            local
            procedure={(s) => {
              s.defScalar(
                "is_today",
                sql`date.part('day', email_record.date) = date.part('day', current_date())
                and date.part('month', email_record.date) = date.part('month', current_date())
                and date.part('year', email_record.date) = date.part('year', current_date())`,
              );
            }}
          >
            <Typography
              level="body-xs"
              className="date shrink-0"
              sx={{
                color: "text.secondary",
                width: forceExpanded ? 132 : 64,
                textAlign: "right",
              }}
            >
              {forceExpanded
                ? sql`format.date(email_record.date, '%b %-d, %Y %H:%M')`
                : (
                  <Show
                    when={sql`is_today`}
                    fallback={sql`format.date(email_record.date, '%b %-d')`}
                  >
                    {sql`format.date(email_record.date, '%H:%M')`}
                  </Show>
                )}
            </Typography>
          </Data>
        </div>

        <Show when={sql`is_expanded`}>
          <Show when={sql`not ${hideHeader}`}>
            <Divider className="mx-2" />
          </Show>

          <div className="px-6 pt-3 pb-1 flex flex-col gap-0.5">
            <Data
              procedure={(s) => {
                s.defTable(
                  "recipients_list",
                  sql`select * from db.${sql.ref(recipientsTable)} where ${
                    sql.ref(singularize(integrationTable))
                  }_id = email.id order by recipient_type`,
                );
              }}
              pendingFallback={null}
              errorFallback={null}
            >
              <Each table="recipients_list" recordName="recipient">
                <div className="flex flex-row items-center gap-2">
                  <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
                    {sql`recipient.recipient_type`}:
                  </Typography>
                  <Typography level="body-xs">
                    {sql`recipient.email`}
                  </Typography>
                </div>
              </Each>
            </Data>
          </div>

          {bodyFieldNode}

          <div className="px-6 pb-4">
            <Typography
              level="body-sm"
              startDecorator={<MaterialIcon icon="Attachment" />}
              className="mb-2 font-medium"
            >
              Attachments
            </Typography>

            <div className="flex flex-row gap-2 text-[12px]">
              <Data
                procedure={(s) => {
                  s.defTable(
                    "attachments_list",
                    sql`select * from db.${sql.ref(attachmentsTable)} where ${
                      sql.ref(singularize(integrationTable))
                    }_id = ${attachmentEmailId ?? sql`email.id`}`,
                  );
                }}
                pendingFallback={null}
                errorFallback={null}
              >
                <Each table="attachments_list" recordName="attachment">
                  <Conditional
                    when={sql`attachment.data is not null or attachment.external_url is not null`}
                    then={
                      <a
                        rel="noreferrer"
                        target="_blank"
                        download={sql`case when attachment.data is not null then attachment.filename else null end`}
                        href={sql`case
                          when attachment.external_url is not null then attachment.external_url
                          when attachment.data is not null then ${attachmentBlobUrl}
                          else ''
                        end`}
                      >
                        <AttachmentPill />
                      </a>
                    }
                    else={<AttachmentPill />}
                  />
                </Each>
              </Data>
            </div>
          </div>

          {(enableCompose || extraActions) && (
            <div
              sx={{
                px: 3,
                py: 2,
                borderTop: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              {enableCompose && (
                <>
                  <Button
                    size="sm"
                    color="primary"
                    startIcon="Reply"
                    onClick={(s) => {
                      s.setScalar("reply_all", sql`false`);
                      s.setScalar("reply_open", sql`true`);
                    }}
                  >
                    Reply
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    startIcon="ReplyAll"
                    onClick={(s) => {
                      s.setScalar("reply_open", sql`true`);
                      s.setScalar("reply_all", sql`true`);
                    }}
                  >
                    Reply All
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    color="neutral"
                    startIcon="Forward"
                    onClick={(s) => {
                      s.setScalar("forward_open", sql`true`);
                    }}
                  >
                    Forward
                  </Button>
                </>
              )}
              <div sx={{ flex: 1 }} />
              {extraActions}
            </div>
          )}
        </Show>

        <ComposeDialog
          openScalar="reply_open"
          dataStatements={(s) => {
            defineEmailBodyForAction(
              s,
              integrationTable,
              sql.ref("email_record"),
            );
            s.defScalar("recipient_id", sql`0`);
            s.defScalar("success", false);
            // s.defScalar("body", sql.lit``);
            s.defScalar("body", {
              type: { type: "Json" },
              expr: sql`lexical_simple_paragraph('')`,
            });
            s.defScalar(
              "message_is_sent",
              currentUserOwnsEmailAddress(
                sql`coalesce(email_record.from_email, email_record.from)`,
              ),
            );
            s.defTable(
              "recipient_to",
              sql`with candidates as (
                  select ${normalizedEmailAddress(sql`reply_address.value`)}
                    as email
                  from regex.matches(
                    coalesce(email_record.reply_to, ''),
                    '[^<>,;\\s]+@[^<>,;\\s]+'
                  ) reply_address
                  where not message_is_sent
                    and nullif(trim(email_record.reply_to), '') is not null
                  union all
                  select ${
                normalizedEmailAddress(
                  sql`coalesce(email_record.from_email, email_record.from)`,
                )
              } as email
                  where not message_is_sent
                    and nullif(trim(email_record.reply_to), '') is null
                  union all
                  select ${normalizedEmailAddress(sql`recipient.email`)}
                  from ${sql.ref(recipientsTable)} recipient
                  where recipient.${
                sql.ref(singularize(integrationTable))
              }_id = email_record.id
                    and recipient.recipient_type = 'to'
                    and (message_is_sent or reply_all)
                ), unique_candidates as (
                  select distinct email
                  from candidates
                  where email is not null and email != ''
                )
                select candidate.email,
                  row_number() over (order by candidate.email) - 1 as id
                from unique_candidates candidate
                where not ${currentUserOwnsEmailAddress(sql`candidate.email`)}`,
            );
            s.defTable(
              "recipient_cc",
              sql`with candidates as (
                  select distinct ${
                normalizedEmailAddress(sql`recipient.email`)
              } as email
                  from ${sql.ref(recipientsTable)} recipient
                  where recipient.${
                sql.ref(singularize(integrationTable))
              }_id = email_record.id
                    and recipient.recipient_type = 'cc'
                    and reply_all
                )
                select candidate.email,
                  row_number() over (order by candidate.email) - 1 as id
                from candidates candidate
                where candidate.email is not null
                  and candidate.email != ''
                  and not ${currentUserOwnsEmailAddress(sql`candidate.email`)}
                  and not exists (
                    select 1 from recipient_to recipient
                    where ${normalizedEmailAddress(sql`recipient.email`)} =
                      candidate.email
                  )`,
            );
            s.defTable("recipient_bcc", {
              fields: [
                {
                  name: "email",
                  type: { type: "String", maxLength: 255 },
                },
                {
                  name: "id",
                  type: "BigInt",
                },
              ],
            });
            s.setScalar(
              "recipient_id",
              sql`greatest(
                coalesce((select max(id) from recipient_to), -1),
                coalesce((select max(id) from recipient_cc), -1),
                coalesce((select max(id) from recipient_bcc), -1)
              ) + 1`,
            );

            s.defScalar("to", sql.lit``);
            s.defScalar(
              "subject",
              sql`case
                when lower(trim(coalesce(email_record.subject, '')))
                  like 're:%'
                then email_record.subject
                else 'Re: ' || coalesce(email_record.subject, '')
              end`,
            );
            s.defScalar("bcc", sql.lit``);

            s.defScalar("bcc_open", false);

            s.if(sql`exists(select 1 from recipient_bcc)`, (s) => {
              s.setScalar("bcc_open", sql`true`);
            });
            s.defScalar("cc", sql.lit``);
            s.defScalar("cc_open", false);

            s.if(sql`exists(select 1 from recipient_cc)`, (s) => {
              s.setScalar("cc_open", sql`true`);
            });
            s.defScalar("expanded", false);
          }}
          onSend={(s, openScalar, selectedAccount) => {
            const recipientFilter = sql`email is not null
              and trim(email) != ''
              and ${normalizedEmailAddress(sql`email`)} != ${
              normalizedEmailAddress(selectedAccount.from)
            }`;
            const recipientsTo =
              sql`(select string_agg(email, ', ') from recipient_to where ${recipientFilter})`;
            const recipientsCc =
              sql`(select string_agg(email, ', ') from recipient_cc where ${recipientFilter})`;
            const recipientsBcc =
              sql`(select string_agg(email, ', ') from recipient_bcc where ${recipientFilter})`;
            const attachment = [{
              filename: sql`attachment_filename`,
              contentType: sql`attachment_content_type`,
              content: sql`bytes.to_base64(content)`,
            }];
            const replyBody = sql`concat(
              lexical_rich_text_to_html_email(body),
              '<br><br>',
              '<p>On ',
              format.date(email_record.date, '%b %d, %Y, %H:%M')::string,
              ' ',
              email_record.from::string,
              ' wrote:</p>',
              action_email_body_text::string
            )`;
            s.readDomFile(sql`file_uuid`, "content");
            if (system.hasBlock(OutlookEmailIntegration)) {
              s.if(sql`${selectedAccount.provider} = 'outlook'`, (s) => {
                const nativeReply = preferredAccount?.provider === "outlook"
                  ? sql`${selectedAccount.accountId} = ${preferredAccount.accountId}
                      and not message_is_sent`
                  : sql`false`;
                s.if(nativeReply, (s) => {
                  system.block(OutlookEmailIntegration).sendEmail(s, {
                    accountId: selectedAccount.accountId,
                    to: recipientsTo,
                    cc: recipientsCc,
                    bcc: recipientsBcc,
                    subject: sql`subject`,
                    body: sql`lexical_rich_text_to_html_email(body)`,
                    from: selectedAccount.from,
                    inReplyTo: sql`email_record.message_id`,
                    replyAll: sql`reply_all`,
                    ...emailSendLifecycle(openScalar),
                  });
                }).else((s) => {
                  system.block(OutlookEmailIntegration).sendEmail(s, {
                    accountId: selectedAccount.accountId,
                    to: recipientsTo,
                    cc: recipientsCc,
                    bcc: recipientsBcc,
                    subject: sql`subject`,
                    body: replyBody,
                    from: selectedAccount.from,
                    attachments: attachment,
                    ...emailSendLifecycle(openScalar),
                  });
                });
              });
            }
            if (system.hasBlock(GmailIntegration)) {
              s.if(sql`${selectedAccount.provider} = 'gmail'`, (s) => {
                const nativeReply = preferredAccount?.provider === "gmail"
                  ? sql`${selectedAccount.accountId} = ${preferredAccount.accountId}`
                  : sql`false`;
                s.if(nativeReply, (s) => {
                  system.block(GmailIntegration).sendEmail(s, {
                    accountId: selectedAccount.accountId,
                    to: recipientsTo,
                    cc: recipientsCc,
                    bcc: recipientsBcc,
                    subject: sql`subject`,
                    body: replyBody,
                    from: selectedAccount.from,
                    threadId: sql`email_record.thread_id`,
                    isReply: true,
                    inReplyTo: sql`email_record.message_reply_id`,
                    attachments: attachment,
                    ...emailSendLifecycle(openScalar),
                  });
                }).else((s) => {
                  system.block(GmailIntegration).sendEmail(s, {
                    accountId: selectedAccount.accountId,
                    to: recipientsTo,
                    cc: recipientsCc,
                    bcc: recipientsBcc,
                    subject: sql`subject`,
                    body: replyBody,
                    from: selectedAccount.from,
                    attachments: attachment,
                    ...emailSendLifecycle(openScalar),
                  });
                });
              });
            }
          }}
          title={sql.lit`Reply Email`}
          preferredAccount={preferredAccount}
          recipientsEditable={preferredAccount?.provider === "outlook"
            ? sql`not (
                  reply_all
                  and not message_is_sent
                  and exists (
                    select 1
                    from user_email_accounts
                    where account_key = selected_account_key
                      and provider = 'outlook'
                      and account_id = ${preferredAccount.accountId}
                  )
                )`
            : sql`true`}
          attachmentsEnabled={sql`coalesce((
            select provider
            from user_email_accounts
            where account_key = selected_account_key
          ), '') != 'outlook'`}
        />
        <ForwardDialog
          openScalar="forward_open"
          emailRecord={sql.ref("email_record")}
          integrationTable={integrationTable}
          onSend={(s, openScalar, selectedAccount) => {
            if (system.hasBlock(GmailIntegration)) {
              s.if(sql`${selectedAccount.provider} = 'gmail'`, (s) => {
                system.block(GmailIntegration).sendEmail(s, {
                  accountId: selectedAccount.accountId,
                  to: sql`(select string_agg(email, ', ') from recipient_to)`,
                  cc: sql`(select string_agg(email, ', ') from recipient_cc)`,
                  bcc: sql`(select string_agg(email, ', ') from recipient_bcc)`,
                  subject: sql`subject`,
                  body: sql`concat(
                    lexical_rich_text_to_html_email(body),
                    '<br><br>',
                    action_email_body_text::string
                  )`,
                  from: selectedAccount.from,
                  inReplyTo: sql`${sql.ref("email_record")}.message_id`,
                  ...emailSendLifecycle(openScalar),
                });
              });
            }
            if (system.hasBlock(OutlookEmailIntegration)) {
              s.if(sql`${selectedAccount.provider} = 'outlook'`, (s) => {
                system.block(OutlookEmailIntegration).sendEmail(s, {
                  accountId: selectedAccount.accountId,
                  to: sql`(select string_agg(email, ', ') from recipient_to)`,
                  cc: sql`(select string_agg(email, ', ') from recipient_cc)`,
                  bcc: sql`(select string_agg(email, ', ') from recipient_bcc)`,
                  subject: sql`subject`,
                  body: sql`concat(
                    lexical_rich_text_to_html_email(body),
                    '<br><br>',
                    action_email_body_text::string
                  )`,
                  from: selectedAccount.from,
                  ...emailSendLifecycle(openScalar),
                });
              });
            }
          }}
          title={sql.lit`Forward Email`}
        />
      </div>
    </Data>
  );
}

function AttachmentPill() {
  return (
    <div
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "4px",
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        p: 1,
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span>{sql`coalesce(attachment.filename, 'Attachment')`}</span>
      </div>
    </div>
  );
}

function ForwardDialog({
  openScalar,
  onSend,
  title,
  emailRecord,
  integrationTable,
}: {
  openScalar: string;
  onSend: (
    s: DomStatements,
    openScalar: string,
    selectedAccount: SelectedEmailAccount,
  ) => void;
  title: Sql;
  emailRecord: Sql;
  integrationTable: string;
}) {
  return (
    <Data
      local
      watch={[sql`${sql.ref(openScalar)}`]}
      procedure={(s) => {
        defineEmailBodyForAction(s, integrationTable, emailRecord);
        s.defScalar("recipient_id", sql`0`);
        s.defScalar("success", false);
        s.defScalar("body", {
          type: { type: "Json" },
          expr: sql`lexical_simple_paragraph(concat('--- Forwarded Message ---
      From: ', ${emailRecord}.from, '
      Subject: ', ${emailRecord}.subject, '
      Date: ', format.date(${emailRecord}.date, '%b %d %Y, %H:%M'), ''))
        `,
        });
        s.defTable("recipient_to", {
          fields: [
            {
              name: "email",
              type: { type: "String", maxLength: 255 },
            },
            {
              name: "id",
              type: "BigInt",
            },
          ],
        });
        s.defTable("recipient_cc", {
          fields: [
            {
              name: "email",
              type: { type: "String", maxLength: 255 },
            },
            {
              name: "id",
              type: "BigInt",
            },
          ],
        });
        s.defTable("recipient_bcc", {
          fields: [
            {
              name: "email",
              type: { type: "String", maxLength: 255 },
            },
            {
              name: "id",
              type: "BigInt",
            },
          ],
        });

        s.defScalar("to", sql.lit``);
        s.defScalar(
          "subject",
          sql`case
            when lower(trim(coalesce(${emailRecord}.subject, '')))
              like 'fwd:%'
            then ${emailRecord}.subject
            else 'Fwd: ' || coalesce(${emailRecord}.subject, '')
          end`,
        );
        s.defScalar("bcc", sql.lit``);
        s.defScalar("bcc_open", false);
        s.defScalar("cc", sql.lit``);
        s.defScalar("cc_open", false);
        s.defScalar("expanded", false);
        s.defScalar("sending", false);
        s.defScalar("send_error", { type: "String" });
        defineAvailableEmailAccounts(s);
      }}
    >
      <Show when={sql`${sql.ref(openScalar)}`}>
        <Sheet
          variant="outlined"
          style={{
            width: sql`case when expanded then '90%' else '600px' end`,
            height: sql`case when expanded then '90%' else '500px' end`,
            bottom: sql`case when expanded then '10px' else '24px' end`,
            right: sql`case when expanded then '5%' else '24px' end`,
          }}
          className="fixed p-4 rounded-lg shadow-lg z-[1000] bg-surface overflow-auto"
        >
          <div className="flex items-center justify-between mb-4">
            <Typography level="title-md">{title}</Typography>
            <div>
              <IconButton
                variant="plain"
                size="sm"
                onClick={(s) => s.setScalar(openScalar, sql`false`)}
                icon="Close"
                aria-label="Close"
              />
              <Show
                when={sql`expanded`}
                fallback={
                  <IconButton
                    variant="plain"
                    size="sm"
                    onClick={(s) => s.toggle("expanded")}
                    icon="Fullscreen"
                    aria-label="Expand"
                  />
                }
              >
                <IconButton
                  variant="plain"
                  size="sm"
                  onClick={(s) => s.toggle("expanded")}
                  icon="FullscreenExit"
                  aria-label="Shrink"
                />
              </Show>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4">
              <InputEmails
                bindScalar="to"
                tableName="recipient_to"
                label="To"
                recipientId="recipient_id"
                endDecorator={
                  <div className="flex gap-2 flex-row">
                    <Button
                      aria-label="Cc"
                      variant="plain"
                      size="sm"
                      onClick={(s) => s.toggle("cc_open")}
                    >
                      Cc
                    </Button>
                    <Button
                      aria-label="Bcc"
                      variant="plain"
                      size="sm"
                      onClick={(s) => s.toggle("bcc_open")}
                    >
                      Bcc
                    </Button>
                  </div>
                }
              />
            </div>

            <Show when={sql`cc_open`}>
              <div className="flex items-center gap-4">
                <InputEmails
                  bindScalar="cc"
                  tableName="recipient_cc"
                  label="Cc"
                  recipientId="recipient_id"
                />
              </div>
            </Show>

            <Show when={sql`bcc_open`}>
              <div className="flex items-center gap-4">
                <InputEmails
                  bindScalar="bcc"
                  tableName="recipient_bcc"
                  label="Bcc"
                  recipientId="recipient_id"
                />
              </div>
            </Show>
          </div>
          <Divider className="my-4" />
          <EmailAccountSelector />
          <Show when={sql`send_error is not null`}>
            <Alert variant="soft" color="danger" startIcon="ErrorOutlined">
              {sql`send_error`}
            </Alert>
          </Show>
          <Input
            id="subject"
            placeholder={sql.lit`Subject`}
            bindScalar="subject"
            variant="plain"
            sx={{ flex: 1, my: 2 }}
          />
          <Divider />
          <Typography level="body-sm" className="my-2">
            You'll send the original content of the message together with your
            reply.
          </Typography>
          <RichTextSimpleEditor
            onChange={(s, value) => {
              s.setScalar("body", value);
            }}
            size="md"
            id="body"
            sx={{ flex: 1, my: 2 }}
            style={{
              height: sql`case when expanded then '500px' else '180px' end`,
            }}
            value={sql`body`}
          />
          {
            /* <AttachmentsCard
          sx={{ gridColumnSpan: 12, lg: { gridColumnSpan: 6 } }}
          table="user_outlook_email_attachments"
        /> */
          }

          <div className="flex gap-2 justify-end">
            <Button
              variant="plain"
              onClick={(s) => {
                s.setScalar(openScalar, sql`false`);
              }}
            >
              Cancel
            </Button>
            <Button
              color="primary"
              startIcon="Send"
              loading={sql`sending`}
              disabled={sql`selected_account_key is null
                or (
                  not exists (select 1 from recipient_to)
                  and not exists (select 1 from recipient_cc)
                  and not exists (select 1 from recipient_bcc)
                )`}
              onClick={(s) => {
                s.if(
                  sql`selected_account_key is not null
                    and (
                      exists (select 1 from recipient_to)
                      or exists (select 1 from recipient_cc)
                      or exists (select 1 from recipient_bcc)
                    )`,
                  (s) => {
                    s.setScalar("send_error", sql`null`);
                    s.setScalar("sending", sql`true`);
                    s.commitUiTreeChanges();
                    onSend(s, openScalar, selectedEmailAccount());
                  },
                );
              }}
            >
              Send
            </Button>
          </div>
        </Sheet>
      </Show>
      <Show when={sql`success`}>
        <Snackbar variant="soft" color="success">
          Email sent successfully
        </Snackbar>
      </Show>
    </Data>
  );
}

function ComposeButton() {
  return (
    <Show when={sql`compose_open = false`}>
      <IconButton
        variant="solid"
        color="primary"
        aria-label="Compose"
        size="lg"
        onClick={(s) => {
          s.setScalar("compose_open", true);
        }}
        sx={{
          position: "fixed",
          bottom: 24,
          right: 24,
          borderRadius: "50%",
          zIndex: 999,
          width: 56,
          height: 56,
          backgroundColor: "primary-500",
          "&:hover": {
            backgroundColor: "primary-400",
          },
        }}
      >
        <MaterialIcon icon="Mail" />
      </IconButton>
    </Show>
  );
}

function ComposeDialog({
  openScalar,
  dataStatements,
  onSend,
  title,
  preferredAccount,
  recipientsEditable = sql`true`,
  attachmentsEnabled = sql`true`,
  allowSaveDraft = false,
}: {
  openScalar: string;
  dataStatements: (s: StateStatements) => void;
  onSend: (
    s: DomStatements,
    openScalar: string,
    selectedAccount: SelectedEmailAccount,
  ) => void;
  title: Sql;
  preferredAccount?: {
    provider: "gmail" | "outlook";
    accountId: Sql;
  };
  recipientsEditable?: BooleanExpr;
  attachmentsEnabled?: BooleanExpr;
  allowSaveDraft?: boolean;
}) {
  return (
    <Data
      local
      watch={[sql`${sql.ref(openScalar)}`]}
      procedure={(s) => {
        defineAvailableEmailAccounts(s, preferredAccount);
        dataStatements(s);
        s.defScalar("uploading", {
          type: "Bool",
          expr: sql`false`,
        });
        s.defScalar("failed_upload", {
          type: "Bool",
          expr: sql`false`,
        });
        s.defScalar("file_uuid", {
          type: "Uuid",
        });
        s.defScalar("attachment_filename", {
          type: "String",
        });
        s.defScalar("attachment_content_type", {
          type: "String",
        });
        s.defScalar("sending", false);
        s.defScalar("send_error", { type: "String" });
        if (allowSaveDraft) {
          s.defScalar("saving_draft", false);
          s.defScalar("save_draft_error", { type: "String" });
          s.defScalar("draft_saved", false);
        }
      }}
    >
      <Show when={sql`${sql.ref(openScalar)}`}>
        <Sheet
          variant="outlined"
          style={{
            width: sql`case when expanded then '90%' else '600px' end`,
            height: sql`case when expanded then '90%' else '500px' end`,
            bottom: sql`case when expanded then '10px' else '24px' end`,
            right: sql`case when expanded then '5%' else '24px' end`,
          }}
          className="fixed p-4 rounded-lg shadow-lg z-[1000] bg-surface overflow-auto"
        >
          <div className="flex items-center justify-between mb-4">
            <Typography level="title-md">{title}</Typography>
            <div>
              <IconButton
                variant="plain"
                size="sm"
                onClick={(s) => {
                  s.setScalar(openScalar, sql`false`);
                  s.setScalar("reply_all", sql`false`);
                }}
                icon="Close"
                aria-label="Close"
              />
              <Show
                when={sql`expanded`}
                fallback={
                  <IconButton
                    variant="plain"
                    size="sm"
                    onClick={(s) => s.toggle("expanded")}
                    icon="Fullscreen"
                    aria-label="Expand"
                  />
                }
              >
                <IconButton
                  variant="plain"
                  size="sm"
                  onClick={(s) => s.toggle("expanded")}
                  icon="FullscreenExit"
                  aria-label="Shrink"
                />
              </Show>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Show
              when={recipientsEditable}
              fallback={
                <Alert variant="soft" color="neutral" startIcon="People">
                  Outlook will send this reply to all original recipients.
                </Alert>
              }
            >
              <div className="flex items-center gap-4">
                <InputEmails
                  bindScalar="to"
                  tableName="recipient_to"
                  label="To"
                  recipientId="recipient_id"
                  endDecorator={
                    <div className="flex gap-2 flex-row">
                      <Button
                        aria-label="Cc"
                        variant="plain"
                        size="sm"
                        onClick={(s) => s.toggle("cc_open")}
                      >
                        Cc
                      </Button>
                      <Button
                        aria-label="Bcc"
                        variant="plain"
                        size="sm"
                        onClick={(s) => s.toggle("bcc_open")}
                      >
                        Bcc
                      </Button>
                    </div>
                  }
                />
              </div>
            </Show>
            <Show when={sql`${recipientsEditable} and cc_open`}>
              <div className="flex items-center gap-4">
                <InputEmails
                  bindScalar="cc"
                  tableName="recipient_cc"
                  label="Cc"
                  recipientId="recipient_id"
                />
              </div>
            </Show>

            <Show when={sql`${recipientsEditable} and bcc_open`}>
              <div className="flex items-center gap-4">
                <InputEmails
                  bindScalar="bcc"
                  tableName="recipient_bcc"
                  label="Bcc"
                  recipientId="recipient_id"
                />
              </div>
            </Show>
          </div>
          <Divider className="my-4" />
          <EmailAccountSelector />
          <Show when={sql`send_error is not null`}>
            <Alert variant="soft" color="danger" startIcon="ErrorOutlined">
              {sql`send_error`}
            </Alert>
          </Show>

          <Input
            id="subject"
            placeholder={sql.lit`Subject`}
            bindScalar="subject"
            variant="plain"
            sx={{ flex: 1, my: 2 }}
          />
          <Divider />
          <RichTextSimpleEditor
            onChange={(s, value) => {
              s.setScalar("body", value);
            }}
            size="md"
            id="body"
            sx={{ flex: 1, my: 2 }}
            style={{
              height: sql`case when expanded then '500px' else '180px' end`,
            }}
            value={sql`body`}
          />
          {
            /* <IconButton
          component="label"
          size="sm"
          aria-label="Upload attachment"
          variant="plain"
          color="primary"
        > */
          }
          <Show when={attachmentsEnabled}>
            <input
              type="file"
              // sx={visuallyHiddenStyles}
              onFileChange={(s) => {
                s.returnIf(sql`uploading`);
                s.setScalar("uploading", true);
                s.commitUiTreeChanges();
                s.defRecord("dom_file", sql`select * from file limit 1`);
                s.setScalar("file_uuid", sql`dom_file.uuid`);
                s.setScalar("attachment_filename", sql`dom_file.name`);
                s.setScalar("attachment_content_type", sql`dom_file.type`);
                s.setScalar("uploading", false);
              }}
            />

            <Conditional
              when={sql`uploading`}
              then={<CircularProgress size="sm" />}
              else={<MaterialIcon icon="UploadOutlined" />}
            />
          </Show>
          {/* </IconButton> */}

          <div className="flex gap-2 justify-end">
            <Button
              variant="plain"
              onClick={(s) => {
                s.setScalar(openScalar, sql`false`);
              }}
            >
              Cancel
            </Button>
            {allowSaveDraft && (
              <Button
                variant="outlined"
                startIcon="Save"
                loading={sql`saving_draft`}
                onClick={(s) => {
                  s.returnIf(sql`saving_draft`);
                  s.setScalar("saving_draft", true);
                  s.setScalar("save_draft_error", sql`null`);
                  s.commitUiTreeChanges();
                  s.tryServer({
                    transferFiles:
                      sql`select file_uuid where file_uuid is not null`,
                    body: (s) => {
                      s.defScalar("saved_user_email_draft_id", {
                        type: "BigInt",
                      });
                      s.defTable("saved_user_email_draft_attachments", {
                        fields: [
                          {
                            name: "name",
                            type: { type: "String", maxLength: 255 },
                            notNull: true,
                          },
                          {
                            name: "content_type",
                            type: { type: "String", maxLength: 255 },
                            notNull: true,
                          },
                          {
                            name: "size_bytes",
                            type: "BigInt",
                            notNull: true,
                          },
                          {
                            name: "blob",
                            type: { type: "Bytes", maxLength: 32 },
                            notNull: true,
                          },
                        ],
                      });
                      s.if(sql`file_uuid is not null`, (s) => {
                        s.readDomFile(
                          sql`file_uuid`,
                          "saved_user_email_draft_file",
                        );
                        s.throwErrorIf(
                          sql`octet_length(saved_user_email_draft_file) >
                            ${MAX_SERVER_EMAIL_ATTACHMENT_BYTES}`,
                          sql
                            .lit`Each email attachment must be smaller than 3 MB.`,
                        );
                        s.createBlob(
                          sql`saved_user_email_draft_file`,
                          "saved_user_email_draft_blob",
                        );
                        s.modify(
                          sql`insert into saved_user_email_draft_attachments (
                            name, content_type, size_bytes, blob
                          ) values (
                            coalesce(attachment_filename, 'Attachment'),
                            coalesce(
                              nullif(attachment_content_type, ''),
                              'application/octet-stream'
                            ),
                            octet_length(saved_user_email_draft_file),
                            saved_user_email_draft_blob
                          )`,
                        );
                      });
                      const selectedAccount = selectedEmailAccount();
                      s.startTransaction();
                      s.modify(sql`insert into db.user_email_drafts (
                          sys_user_id, integration_key, account_id, from_email,
                          subject, body
                        ) values (
                          current_user,
                          case ${selectedAccount.provider}
                            when 'outlook' then 'outlook_email'
                            else ${selectedAccount.provider}
                          end,
                          ${selectedAccount.accountId},
                          ${selectedAccount.from},
                          coalesce(subject, ''),
                          body
                        ) returning id into saved_user_email_draft_id`);
                      s.modify(sql`insert into db.user_email_draft_recipients (
                          user_email_draft_id, recipient_type, email
                        )
                        select saved_user_email_draft_id, recipient_type, email
                        from (
                          select distinct 'to' as recipient_type, trim(email) as email
                          from recipient_to where nullif(trim(email), '') is not null
                          union
                          select distinct 'cc', trim(email)
                          from recipient_cc where nullif(trim(email), '') is not null
                          union
                          select distinct 'bcc', trim(email)
                          from recipient_bcc where nullif(trim(email), '') is not null
                        ) draft_recipient`);
                      s.modify(
                        sql`insert into db.user_email_draft_attachments (
                          user_email_draft_id, name, content_type, size_bytes,
                          blob
                        )
                        select saved_user_email_draft_id, name, content_type,
                          size_bytes, blob
                        from saved_user_email_draft_attachments`,
                      );
                      s.commitTransaction();
                      s.setScalar("draft_saved", true);
                      s.setScalar(openScalar, false);
                    },
                    errorName: "save_user_email_draft_error",
                    catch: (s) => {
                      s.setScalar(
                        "save_draft_error",
                        sql`coalesce(
                          save_user_email_draft_error.message,
                          'The draft could not be saved.'
                        )`,
                      );
                    },
                  });
                  s.setScalar("saving_draft", false);
                }}
              >
                Save draft
              </Button>
            )}
            <Button
              color="primary"
              startIcon="Send"
              loading={sql`sending`}
              disabled={sql`selected_account_key is null or (
                ${recipientsEditable}
                and not exists (select 1 from recipient_to)
                and not exists (select 1 from recipient_cc)
                and not exists (select 1 from recipient_bcc)
              )`}
              onClick={(s) => {
                s.if(
                  sql`selected_account_key is not null and (
                    not ${recipientsEditable}
                    or exists (select 1 from recipient_to)
                    or exists (select 1 from recipient_cc)
                    or exists (select 1 from recipient_bcc)
                  )`,
                  (s) => {
                    s.setScalar("send_error", sql`null`);
                    s.setScalar("sending", sql`true`);
                    s.commitUiTreeChanges();
                    onSend(s, openScalar, selectedEmailAccount());
                  },
                );
              }}
            >
              Send
            </Button>
          </div>
        </Sheet>
      </Show>
      <Show when={sql`failed_upload`}>
        <div sx={styles.failureAlert}>
          <Alert
            color="danger"
            size="lg"
            startDecorator={<MaterialIcon icon="Warning" />}
          >
            {sql`case when failed_upload then 'Failed to upload attachment' else 'Failed to edit attachment' end`}
          </Alert>
        </div>
      </Show>
      <Show when={sql`success`}>
        <Snackbar variant="soft" color="success">
          Email sent successfully
        </Snackbar>
      </Show>
      {allowSaveDraft && (
        <>
          <Show when={sql`save_draft_error is not null`}>
            <Snackbar variant="soft" color="danger">
              {sql`save_draft_error`}
            </Snackbar>
          </Show>
          <Show when={sql`draft_saved`}>
            <Snackbar variant="soft" color="success">
              Draft saved
            </Snackbar>
          </Show>
        </>
      )}
    </Data>
  );
}

function InputEmails({
  bindScalar,
  tableName,
  endDecorator,
  label,
  recipientId,
}: {
  bindScalar: string;
  tableName: string;
  endDecorator?: Node;
  label?: string;
  recipientId: string;
}) {
  return (
    <>
      <FormLabel htmlFor={bindScalar} className="shrink-0">
        {label}
      </FormLabel>
      <Input
        id={bindScalar}
        bindScalar={bindScalar}
        variant="plain"
        size="sm"
        onBlur={(s) => {
          s.if(
            sql`${sql.ref(bindScalar)} is not null and trim(${
              sql.ref(bindScalar)
            }) != ''`,
            (s) => {
              s.modify(
                sql`insert into ${sql.ref(tableName)} (email, id) values (${
                  sql.ref(bindScalar)
                }, ${sql.ref(recipientId)})`,
              );
              s.setScalar(bindScalar, sql.lit``);
              s.increment(recipientId);
            },
          );
        }}
        onKeyDown={(s) => {
          s.if(
            sql`event.key = 'Backspace' and (${
              sql.ref(bindScalar)
            } is null or ${sql.ref(bindScalar)} == '')`,
            (s) => {
              s.modify(
                sql`delete from ${
                  sql.ref(tableName)
                } where id = (select max(id) from ${sql.ref(tableName)})`,
              );
            },
          );
          s.if(
            sql`(event.key = ' ' or event.key = 'Enter') and ${
              sql.ref(bindScalar)
            } is not null and trim(${sql.ref(bindScalar)}) != '' `,
            (s) => {
              s.modify(
                sql`insert into ${sql.ref(tableName)} (email, id) values (${
                  sql.ref(bindScalar)
                }, ${sql.ref(recipientId)})`,
              );
              s.setScalar(bindScalar, sql.lit``);
              s.increment(recipientId);
            },
          );
        }}
        startDecorator={
          <Each recordName="record" table={tableName}>
            <ChipButton
              variant="soft"
              color="neutral"
              aria-label="Remove"
              checked={false}
              onClick={(s) => {
                s.modify(
                  sql`delete from ${
                    sql.ref(tableName)
                  } where email = record.email`,
                );
              }}
            >
              {sql`record.email`}
              <MaterialIcon icon="Close" />
            </ChipButton>
          </Each>
        }
        endDecorator={endDecorator}
        sx={{ flex: 1 }}
      />
    </>
  );
}

/**
 * Renders a searchable, paginated, thread-grouped list of the current user's
 * emails (across all configured CRM email integrations) backed by the
 * `user_all_emails` table, with an optional floating Compose dialog. Requires
 * the {@link CrmBlock} with at least one email integration configured.
 *
 * @category UI Component
 */
export function AllEmailsList(
  props: {
    /** Boolean predicate over `user_all_emails` to scope which emails show. */
    where: BooleanExpr;
    /**
     * When false, hides the floating Compose button + ComposeDialog and the
     * Reply / Reply All / Forward actions on expanded email cards. Useful for
     * read-only / triage-style inbox surfaces where outbound mail is handled
     * elsewhere (e.g. directly in Outlook). Defaults to true.
     */
    enableCompose?: boolean;
    /** Optional address inserted into the To field when a new message opens. */
    composeTo?: Sql;
    /** Enables saving from the composer when draft-management routes exist. */
    enableDraftSaving?: boolean;
    /**
     * When true, suppresses the "All Emails" heading rendered above the
     * search box. Use when the surface already supplies a title (e.g. a
     * detail-page tab whose label already describes the contents).
     */
    hideHeader?: boolean;
    /**
     * Hook for the consumer to add per-row action buttons (e.g. "Link to
     * job", "Dismiss") inside each expanded email card. Rendered inside the
     * Each-row scope, alongside Reply / Forward.
     */
    extraActions?: Node;
    /**
     * Runs in the AllEmailsList Data procedure, before the SearchCard. Use
     * to define scalars/tables that extraActions writes to and extraDialogs
     * reads from (e.g. `link_email_id`, `link_project_id`).
     */
    extraStatements?: (s: StateStatements) => void;
    /**
     * Rendered as a sibling of ComposeDialog at the page level. Sees scalars
     * from extraStatements. Use to host modals/popovers triggered by
     * extraActions (e.g. a Link-to-job picker).
     */
    extraDialogs?: Node;
  },
) {
  const enableCompose = props.enableCompose !== false;
  const block = system.block(CrmBlock);
  const emailIntegrations = block.opts.emailIntegrations || [];
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);

  if (emailIntegrations.length === 0) {
    return (
      <Typography level="body-md">No email integrations configured</Typography>
    );
  }

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("compose_open", false);
        // Written to `false` by ComposeDialog's shared close handler, never
        // read here — only meaningful for the reply flow inside EmailItem.
        s.defScalar("reply_all", {
          type: "Bool",
          expr: sql`false`,
          allowNoRead: true,
        });
        s.defScalar("expanded_thread_key", {
          type: "String",
        });
        s.defScalar("expanded_email_id", {
          type: { type: "BigInt" },
        });
        s.defScalar("page", 1);
        props.extraStatements?.(s);
      }}
    >
      <QueryParams params={[{ name: "search_query", type: "String" }]}>
        <EmailThreadsList
          where={props.where}
          hideHeader={props.hideHeader}
          hasSidebar={!!hasSidebar?.autoTrigger}
          enableCompose={enableCompose}
          extraActions={props.extraActions}
        />
      </QueryParams>
      {enableCompose ? <ComposeButton /> : null}
      {enableCompose && (
        <ComposeDialog
          openScalar="compose_open"
          dataStatements={(s) => {
            s.defScalar("recipient_id", props.composeTo ? sql`1` : sql`0`);
            s.defScalar("success", false);
            s.defScalar("body", {
              type: { type: "Json" },
              expr: sql`lexical_simple_paragraph('')`,
            });
            s.defTable("recipient_to", {
              fields: [
                { name: "email", type: { type: "String", maxLength: 255 } },
                { name: "id", type: "BigInt" },
              ],
            });
            if (props.composeTo) {
              s.modify(sql`insert into recipient_to (email, id)
                select trim(${props.composeTo}), 0
                where ${props.composeTo} is not null
                  and trim(${props.composeTo}) != ''`);
            }
            s.defTable("recipient_cc", {
              fields: [
                { name: "email", type: { type: "String", maxLength: 255 } },
                { name: "id", type: "BigInt" },
              ],
            });
            s.defTable("recipient_bcc", {
              fields: [
                { name: "email", type: { type: "String", maxLength: 255 } },
                { name: "id", type: "BigInt" },
              ],
            });
            s.defScalar("to", sql.lit``);
            s.defScalar("subject", sql.lit``);
            s.defScalar("bcc", sql.lit``);
            s.defScalar("bcc_open", false);
            s.defScalar("cc", sql.lit``);
            s.defScalar("cc_open", false);
            s.defScalar("expanded", false);
          }}
          onSend={(s, openScalar, selectedAccount) => {
            s.readDomFile(sql`file_uuid`, "content");
            if (system.hasBlock(OutlookEmailIntegration)) {
              s.if(sql`${selectedAccount.provider} = 'outlook'`, (s) => {
                system.block(OutlookEmailIntegration).sendEmail(s, {
                  accountId: selectedAccount.accountId,
                  to: sql`(select string_agg(email, ', ') from recipient_to)`,
                  cc: sql`(select string_agg(email, ', ') from recipient_cc)`,
                  bcc: sql`(select string_agg(email, ', ') from recipient_bcc)`,
                  subject: sql`subject`,
                  body: sql`lexical_rich_text_to_html_email(body)`,
                  from: selectedAccount.from,
                  attachments: [
                    {
                      filename: sql`attachment_filename`,
                      contentType: sql`attachment_content_type`,
                      content: sql`bytes.to_base64(content)`,
                    },
                  ],
                  ...emailSendLifecycle(openScalar),
                });
              });
            }
            if (system.hasBlock(GmailIntegration)) {
              s.if(sql`${selectedAccount.provider} = 'gmail'`, (s) => {
                system.block(GmailIntegration).sendEmail(s, {
                  accountId: selectedAccount.accountId,
                  to: sql`(select string_agg(email, ', ') from recipient_to)`,
                  cc: sql`(select string_agg(email, ', ') from recipient_cc)`,
                  bcc: sql`(select string_agg(email, ', ') from recipient_bcc)`,
                  subject: sql`subject`,
                  body: sql`lexical_rich_text_to_html_email(body)`,
                  from: selectedAccount.from,
                  attachments: [
                    {
                      filename: sql`attachment_filename`,
                      contentType: sql`attachment_content_type`,
                      content: sql`bytes.to_base64(content)`,
                    },
                  ],
                  ...emailSendLifecycle(openScalar),
                });
              });
            }
          }}
          title={sql.lit`Compose Email`}
          allowSaveDraft={props.enableDraftSaving === true}
        />
      )}
      {props.extraDialogs}
    </Data>
  );
}

function markUserAllEmailAsRead(
  s: UiServerStatements,
  opts: { messageId: Sql },
) {
  if (system.hasBlock(GmailIntegration)) {
    s.if(
      sql`email_record.user_gmail_account_id is not null
        and exists (
          select 1
          from db.user_gmail_accounts account
          where account.id = email_record.user_gmail_account_id
            and account.sys_user_id = current_user
        )`,
      (s) => {
        system.block(GmailIntegration).markAsRead(s, {
          emailId: opts.messageId,
          accountId: sql`email_record.user_gmail_account_id`,
        });
      },
    );
  }
  if (system.hasBlock(OutlookEmailIntegration)) {
    s.if(
      sql`email_record.user_outlook_emails_account_id is not null
        and exists (
          select 1
          from db.user_outlook_emails_accounts account
          where account.id = email_record.user_outlook_emails_account_id
            and account.sys_user_id = current_user
        )`,
      (s) => {
        system.block(OutlookEmailIntegration).markAsRead(s, {
          emailId: opts.messageId,
          accountId: sql`email_record.user_outlook_emails_account_id`,
        });
      },
    );
  }
}

function EmailThreadsList(props: {
  where?: BooleanExpr;
  hideHeader?: boolean;
  hasSidebar: boolean;
  enableCompose: boolean;
  extraActions?: Node;
}) {
  const hasStoredThreadKey = !!system.db.tables.user_all_emails.fields
    .thread_key;
  const hasCanonicalIdentity = !!system.db.tables.user_all_emails.fields
    .user_email_identity_id;
  const hasOutlookAccount = !!system.db.tables.user_all_emails.fields
    .user_outlook_emails_account_id;
  const effectiveThreadKey = hasStoredThreadKey && hasOutlookAccount
    ? sql`case
        when user_outlook_emails_account_id is not null
          and nullif(trim(thread_id), '') is not null
        then 'provider:outlook:'
          || cast(user_outlook_emails_account_id as string)
          || ':' || thread_id
        else coalesce(thread_key, thread_id, 'message:' || cast(id as string))
      end`
    : hasStoredThreadKey
    ? sql`coalesce(thread_key, thread_id, 'message:' || cast(id as string))`
    : sql`coalesce(thread_id, 'message:' || cast(id as string))`;
  return (
    <Data
      watch={[sql`search_query`, sql`page`]}
      debounce={{ wait: 300 }}
      pendingFallback={null}
      procedure={(s) => {
        const whereExpr = props.where ?? true;
        const searchExpr = sql`trim(coalesce(search_query, '')) = ''
            or lower(coalesce(subject, '')) like '%' || lower(search_query) || '%'
            or lower(coalesce("from", '')) like '%' || lower(search_query) || '%'
            or lower(coalesce(snippet, '')) like '%' || lower(search_query) || '%'`;
        const filteredWhere = sql.and(whereExpr, searchExpr);
        const threadInputsCte = hasCanonicalIdentity
          ? sql`
            scoped_email_occurrences as (
              select
                email.*,
                row_number() over (
                  partition by email.user_email_identity_id
                  order by
                    (email.provider_deleted_at is null) desc,
                    (
                      email.body_text is not null
                      or email.body_blob is not null
                    ) desc,
                    email.id
                ) as occurrence_rank
              from db.user_all_emails email
              where ${filteredWhere}
            ), thread_inputs as (
              select
                email.id,
                email.date,
                email.is_read,
                ${effectiveThreadKey} as effective_thread_key
              from scoped_email_occurrences email
              where email.occurrence_rank = 1
            )`
          : sql`
            thread_inputs as (
              select
                id,
                date,
                is_read,
                ${effectiveThreadKey} as effective_thread_key
              from db.user_all_emails
              where ${filteredWhere}
            )`;
        s.defTable(
          "email_threads",
          sql`
            with ${threadInputsCte}, thread_stats as (
              select
                effective_thread_key,
                count(*) as message_count,
                sum(case when not is_read then 1 else 0 end) as unread_count,
                max(date) as latest_date
              from thread_inputs
              group by effective_thread_key
            ), latest_threads as (
              select
                candidate.effective_thread_key,
                max(candidate.id) as email_id
              from thread_inputs candidate
              join thread_stats stats
                on stats.effective_thread_key = candidate.effective_thread_key
                and candidate.date is not distinct from stats.latest_date
              group by candidate.effective_thread_key
            )
            select
              email.*,
              latest.effective_thread_key,
              stats.message_count,
              stats.unread_count
            from latest_threads latest
            join thread_stats stats
              on stats.effective_thread_key = latest.effective_thread_key
            join db.user_all_emails email on email.id = latest.email_id
            order by email.date desc nulls last, email.id desc
            limit 25 offset (page - 1) * 25
          `,
        );
        s.defScalar(
          "total_count",
          sql`(
            with ${threadInputsCte}
            select count(distinct effective_thread_key)
            from thread_inputs
          )`,
        );
      }}
    >
      {props.hideHeader
        ? undefined
        : (
          <div className="flex items-center gap-2 mb-8">
            {props.hasSidebar && <Sidebar.Trigger />}
            <Typography level="h2">All Emails</Typography>
          </div>
        )}
      <div className="w-full mb-4">
        <Input
          placeholder="Search"
          bindScalar="search_query"
          startIcon="Search"
          className="md:w-[30%] my-auto"
        />
      </div>
      <Show when={sql`not exists (select 1 from email_threads)`}>
        <Typography
          level="title-lg"
          className="text-center text-neutral-500 mt-10"
        >
          No results currently found
        </Typography>
      </Show>
      <div sx={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <Each table="email_threads" recordName="email">
          <EmailThreadItem
            enableCompose={props.enableCompose}
            extraActions={props.extraActions}
            where={props.where ?? sql`true`}
          />
        </Each>
      </div>
      <div className="pt-2 gap-1 hidden md:flex">
        <Button
          size="sm"
          variant="outlined"
          disabled={sql`page <= 1`}
          onClick={(s) => s.decrement("page")}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outlined"
          disabled={sql`page * 25 >= total_count`}
          onClick={(s) => s.increment("page")}
        >
          Next
        </Button>
      </div>
    </Data>
  );
}

function EmailThreadItem(
  props: {
    enableCompose: boolean;
    extraActions?: Node;
    where: BooleanExpr;
  },
) {
  const threadKey = sql`email.effective_thread_key`;
  const hasStoredThreadKey = !!system.db.tables.user_all_emails.fields
    .thread_key;
  const hasOutlookAccount = !!system.db.tables.user_all_emails.fields
    .user_outlook_emails_account_id;
  const storedThreadKey = hasStoredThreadKey && hasOutlookAccount
    ? sql`case
        when user_outlook_emails_account_id is not null
          and nullif(trim(thread_id), '') is not null
        then 'provider:outlook:'
          || cast(user_outlook_emails_account_id as string)
          || ':' || thread_id
        else coalesce(thread_key, thread_id, 'message:' || cast(id as string))
      end`
    : hasStoredThreadKey
    ? sql`coalesce(thread_key, thread_id, 'message:' || cast(id as string))`
    : sql`coalesce(thread_id, 'message:' || cast(id as string))`;
  const hasCanonicalIdentity = !!system.db.tables.user_all_emails.fields
    .user_email_identity_id;
  return (
    <Data
      local
      watch={[sql`expanded_thread_key`]}
      procedure={(s) => {
        s.defRecord(
          "email_record",
          sql`select * from email_threads where id = email.id`,
        );
        s.defScalar(
          "sender_name",
          sql`case when email_record.from like '%<%>%'
            then trim(both ' ' from substring(email_record.from from 1 for position('<' in email_record.from) - 1))
            else coalesce(email_record.from, '')
          end`,
        );
        s.defScalar(
          "is_expanded",
          sql`expanded_thread_key = ${threadKey}`,
        );
      }}
    >
      <div
        sx={{
          width: "100%",
          borderBottom: "1px solid",
          borderColor: "divider",
          backgroundColor: "background.level1",
          "&:hover": {
            boxShadow: "sm",
            zIndex: 1,
            position: "relative",
          },
          "&.unread": {
            backgroundColor: "background.body",
          },
          "&.unread .sender, &.unread .subject, &.unread .snippet, &.unread .date":
            {
              fontWeight: 700,
              color: "text.primary",
            },
        }}
        dynamicClass={{
          classes: "unread",
          condition: sql`email.unread_count > 0`,
        }}
      >
        <div
          className="flex items-center gap-3 cursor-pointer"
          sx={{ px: 2, py: 0.5, minHeight: 32 }}
          onClick={(s) => {
            s.setScalar(
              "expanded_thread_key",
              sql`case when expanded_thread_key = ${threadKey} then null else ${threadKey} end`,
            );
          }}
        >
          <Typography
            level="body-sm"
            noWrap
            className="sender"
            sx={{ width: 180, flexShrink: 0, color: "text.secondary" }}
          >
            {sql`case when sender_name = '' then '(no sender)' else sender_name end`}
          </Typography>
          <div className="flex-1 min-w-0 flex items-baseline gap-2">
            <Typography
              level="body-sm"
              noWrap
              className="subject"
              sx={{ flexShrink: 0, maxWidth: "50%", color: "text.secondary" }}
            >
              {sql`coalesce(email_record.subject, '(no subject)')`}
            </Typography>
            <Show when={sql`email.message_count > 1`}>
              <Typography
                level="body-xs"
                sx={{ color: "text.tertiary", flexShrink: 0 }}
              >
                {sql`'(' || email.message_count || ')'`}
              </Typography>
            </Show>
            <Typography
              level="body-sm"
              noWrap
              className="snippet"
              sx={{ color: "text.tertiary", flex: 1, minWidth: 0 }}
            >
              {sql`case when coalesce(email_record.snippet, '') = '' then '' else '- ' || email_record.snippet end`}
            </Typography>
          </div>
          <Data
            local
            procedure={(s) => {
              s.defScalar(
                "is_today",
                sql`date.part('day', email_record.date) = date.part('day', current_date())
                and date.part('month', email_record.date) = date.part('month', current_date())
                and date.part('year', email_record.date) = date.part('year', current_date())`,
              );
            }}
          >
            <Typography
              level="body-xs"
              className="date shrink-0"
              sx={{ color: "text.secondary", width: 64, textAlign: "right" }}
            >
              <Show
                when={sql`is_today`}
                fallback={sql`format.date(email_record.date, '%b %-d')`}
              >
                {sql`format.date(email_record.date, '%H:%M')`}
              </Show>
            </Typography>
          </Data>
        </div>
        <Show when={sql`is_expanded`}>
          <Divider className="mx-2" />
          <Data
            procedure={(s) => {
              s.defTable(
                "thread_messages",
                hasCanonicalIdentity
                  ? sql`with scoped_thread_identities as (
                      select distinct canonical_email.user_email_identity_id
                      from db.user_all_emails canonical_email
                      where ${storedThreadKey} = ${threadKey}
                        and ${props.where}
                    ), scoped_thread_occurrences as (
                      select
                        canonical_email.id,
                        canonical_email.user_email_identity_id,
                        canonical_email.date,
                        canonical_email.provider_deleted_at,
                        row_number() over (
                          partition by canonical_email.user_email_identity_id
                          order by
                            (
                              canonical_email.provider_deleted_at is null
                            ) desc,
                            (
                              canonical_email.body_text is not null
                              or canonical_email.body_blob is not null
                            ) desc,
                            canonical_email.id
                        ) as occurrence_rank
                      from db.user_all_emails canonical_email
                      join scoped_thread_identities thread_identity
                        on thread_identity.user_email_identity_id =
                          canonical_email.user_email_identity_id
                      where ${props.where}
                    ), scoped_attachment_stats as (
                      select
                        attachment.user_all_email_id,
                        count(*) as attachment_count,
                        sum(case when attachment.data is not null then 1 else 0 end)
                          as complete_attachment_count
                      from db.user_email_attachments attachment
                      join scoped_thread_occurrences occurrence
                        on occurrence.id = attachment.user_all_email_id
                      where attachment.provider_deleted_at is null
                      group by attachment.user_all_email_id
                    ), ranked_attachment_sources as (
                      select
                        occurrence.id,
                        occurrence.user_email_identity_id,
                        row_number() over (
                          partition by occurrence.user_email_identity_id
                          order by
                            (occurrence.provider_deleted_at is null) desc,
                            coalesce(
                              attachment.complete_attachment_count,
                              0
                            ) desc,
                            coalesce(attachment.attachment_count, 0) desc,
                            occurrence.id
                        ) as attachment_rank
                      from scoped_thread_occurrences occurrence
                      left join scoped_attachment_stats attachment
                        on attachment.user_all_email_id = occurrence.id
                    )
                    select
                      message.id,
                      attachment_source.id as attachment_user_all_email_id
                    from scoped_thread_occurrences message
                    join ranked_attachment_sources attachment_source
                      on attachment_source.user_email_identity_id =
                        message.user_email_identity_id
                      and attachment_source.attachment_rank = 1
                    where message.occurrence_rank = 1
                    order by message.date desc nulls last, message.id desc`
                  : sql`select
                      canonical_email.id,
                      canonical_email.id as attachment_user_all_email_id
                    from db.user_all_emails canonical_email
                    where ${storedThreadKey} = ${threadKey}
                      and ${props.where}
                    order by canonical_email.date desc nulls last,
                      canonical_email.id desc`,
              );
            }}
            pendingFallback={null}
            errorFallback={null}
          >
            <div className="flex flex-col">
              <Each table="thread_messages" recordName="email">
                <EmailItem
                  integrationTable="user_all_emails"
                  recipientsTable="user_email_recipients"
                  attachmentsTable="user_email_attachments"
                  attachmentEmailId={sql`email.attachment_user_all_email_id`}
                  recieved
                  enableCompose={props.enableCompose}
                  extraActions={props.extraActions}
                  markAsRead={markUserAllEmailAsRead}
                  bodyFieldNode={
                    <EmailBodyFieldNode
                      integrationTable="user_all_emails"
                      attachmentEmailId={sql`email.attachment_user_all_email_id`}
                    />
                  }
                />
              </Each>
            </div>
          </Data>
        </Show>
      </div>
    </Data>
  );
}

export function EmailBodyFieldNode(
  props: {
    integrationTable: string;
    recordName?: string;
    attachmentsTable?: string;
    attachmentEmailId?: Sql;
  },
) {
  const sourceEmailRecord = props.recordName ?? "email_record";
  const emailRecord = "email_body_record";
  const attachmentsTable = props.attachmentsTable ?? "user_email_attachments";
  const hasHybridBody = !!system.db.tables[props.integrationTable]?.fields
    .body_blob;
  const hasHydrationState = !!system.db.tables[props.integrationTable]?.fields
    .hydrate_attempt_count;
  const hasCanonicalCid = !!system.db.tables[attachmentsTable]?.fields.ccid;
  const hasOnDemandOutlookAttachments =
    !!system.db.tables[attachmentsTable]?.fields.kind &&
    system.hasBlock(OutlookEmailIntegration);
  const bodyField = hasHybridBody
    ? sql`loaded_email_body`
    : sql.ref(emailRecord, "body_text");
  const emailId = sql.ref(emailRecord, "id");
  const inlineAttachmentUrl = emailAttachmentUrl(sql`attachment.data`);
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          emailRecord,
          sql`select *
              from ${sql.ref(props.integrationTable)}
              where id = ${sql.ref(sourceEmailRecord, "id")}`,
        );
        s.defScalar("hydrating_email_id", emailId);
        if (hasHybridBody) {
          s.defScalar(
            "loaded_email_body",
            sql`coalesce(${sql.ref(emailRecord, "body_text")}, '')`,
          );
          s.if(
            sql`${sql.ref(emailRecord, "body_blob")} is not null`,
            (s) => {
              s.readBlob(sql.ref(emailRecord, "body_blob"), {
                defContentScalar: "email_body_bytes",
              });
              s.setScalar(
                "loaded_email_body",
                sql`string.from_utf8(email_body_bytes)`,
              );
            },
          );
        }
        if (hasHydrationState) {
          s.defScalar(
            "email_body_is_missing",
            sql`${sql.ref(emailRecord, "body_text")} is null
              and ${sql.ref(emailRecord, "body_blob")} is null`,
          );
          s.defScalar(
            "email_body_hydrate_attempt_count",
            sql.ref(emailRecord, "hydrate_attempt_count"),
          );
          s.defScalar(
            "email_body_hydrate_error",
            sql.ref(emailRecord, "hydrate_error"),
          );
          s.defScalar(
            "email_body_hydrated_at",
            sql.ref(emailRecord, "hydrated_at"),
          );
        }
        if (hasOnDemandOutlookAttachments) {
          s.defScalar(
            "missing_inline_attachment_count",
            sql`(
              select count(*)
              from ${sql.ref(attachmentsTable)} attachment
              where attachment.${
              sql.ref(singularize(props.integrationTable))
            }_id = ${props.attachmentEmailId ?? emailId}
                and attachment.is_inline
                and attachment.data is null
                and attachment.provider_deleted_at is null
                and attachment.kind in ('file', 'item')
                and coalesce(attachment.size_bytes, 0) <= 5242880
            )`,
          );
        }
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
          sql`select * from ${sql.ref(attachmentsTable)} where ${
            sql.ref(singularize(props.integrationTable))
          }_id = ${props.attachmentEmailId ?? emailId}`,
          "attachment",
          (s) => {
            // Prefer ccid; fall back to Outlook's content_id, stripping the
            // RFC 2392 angle brackets (<id> in the header vs cid:id in the
            // body) so existing rows saved before ccid was populated render.
            s.defScalar(
              "cid_key",
              hasCanonicalCid
                ? sql`coalesce(
                    nullif(attachment.ccid, ''),
                    nullif(attachment.content_id, '')
                  )`
                : sql`nullif(attachment.content_id, '')`,
            );
            s.if(
              sql`cid_key is not null and attachment.data is not null`,
              (s) => {
                s.setScalar(
                  "replaced_body",
                  sql`case
                   when contains(${bodyField}, 'cid:' || cid_key)
                   then replace(
                     replaced_body,
                     'src="cid:' || cid_key || '"',
                     'src="' || ${inlineAttachmentUrl} || '"'
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
      {hasHydrationState && (
        <Show
          when={sql`email_body_is_missing`}
        >
          <Alert
            color="warning"
            variant="soft"
          >
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span>
                {sql`case
                  when email_body_hydrate_attempt_count >= 5
                    then coalesce(
                      email_body_hydrate_error,
                      'The message body could not be downloaded.'
                    )
                  when email_body_hydrated_at is not null
                    then 'The message body has not been downloaded.'
                  else 'The message body is still syncing.'
                end`}
              </span>
              {system.hasBlock(OutlookEmailIntegration) && (
                <ActionButton
                  size="sm"
                  variant="outlined"
                  errorDisplay="inline"
                  successMessage="Message body downloaded"
                  action={(s) => {
                    system.block(OutlookEmailIntegration)
                      .hydrateEmailNowWithProcedure(
                        s,
                        { emailId: sql`hydrating_email_id` },
                      );
                  }}
                >
                  Get now
                </ActionButton>
              )}
            </div>
          </Alert>
        </Show>
      )}
      {hasOnDemandOutlookAttachments && (
        <Show when={sql`missing_inline_attachment_count > 0`}>
          <Button
            size="sm"
            variant="outlined"
            startIcon="Image"
            onClick={(s) => {
              s.server((s) => {
                system.block(OutlookEmailIntegration)
                  .fetchNextInlineAttachmentContentWithProcedure(s, {
                    emailId: sql`hydrating_email_id`,
                  });
              });
              s.refetch();
            }}
          >
            Load next embedded image
          </Button>
        </Show>
      )}
      <Show
        when={hasHybridBody
          ? sql`not email_body_is_missing`
          : sql`${sql.ref(emailRecord, "body_text")} is not null`}
      >
        <iframe
          sx={{
            p: 3,
            width: "100%",
            height: "60vh",
            border: "none",
          }}
          title="Email"
          srcDoc={sql`replaced_body`}
        />
      </Show>
    </Data>
  );
}
