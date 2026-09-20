import { ActionButton, FileActionButton } from "std/action_button";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { EachSelect } from "components/each_select";
import { FieldFormControl } from "components/field_form_control";
import { MaterialIcon } from "components/material_icon";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import { Typography } from "components/typography";
import { CrmBlock } from "blocks/crm";
import { Data } from "std/data";
import { Form, useCurrentTableHelper, useFieldHelper } from "std/form";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import { Each, Route, Show } from "std/ui";
import { defineAvailableEmailAccounts } from "./common";
import type { ConnectedAccountEmailIntegration } from "./index";
import { GmailIntegration } from "./gmail";
import { OutlookEmailIntegration } from "./outlook_email";
import {
  MAX_SERVER_EMAIL_ATTACHMENT_BYTES,
  MAX_SERVER_EMAIL_ATTACHMENT_COUNT,
  MAX_SERVER_EMAIL_ATTACHMENTS_TOTAL_BYTES,
} from "./server_attachments";

const EDITABLE_DRAFT_STATUS = sql`('draft', 'failed')`;

function configuredIntegrations(): ConnectedAccountEmailIntegration[] {
  const integrations: ConnectedAccountEmailIntegration[] = [];
  if (system.hasBlock(GmailIntegration)) {
    integrations.push(system.block(GmailIntegration));
  }
  if (system.hasBlock(OutlookEmailIntegration)) {
    integrations.push(system.block(OutlookEmailIntegration));
  }
  return integrations;
}

/** Claims and sends one application-owned draft without holding a DB transaction during I/O. */
export function sendUserEmailDraft<T extends IServerBaseStatements>(
  s: T,
  draftId: Sql,
) {
  s.callStoredProcedure("email_send_user_draft", {
    inputScalars: { p_draft_id: draftId },
  });
}

/** Registers draft sending after the configured providers and CRM schema exist. */
export function registerEmailDraftProcedure() {
  if (
    !system.db.tables.user_email_drafts ||
    system.storedProcedures.some((p) => p.name === "email_send_user_draft")
  ) return;
  system.storedProcedure({
    name: "email_send_user_draft",
    transaction: "standalone",
    inputScalars: [{ name: "p_draft_id", type: "BigInt" }],
    procedure: (s) => sendUserEmailDraftStatements(s, sql`p_draft_id`),
  });
}

function sendUserEmailDraftStatements<T extends IServerBaseStatements>(
  s: T,
  draftId: Sql,
) {
  const integrations = configuredIntegrations();
  s.defScalar("claimed_user_email_draft_id", { type: "BigInt" });
  s.defScalar("claimed_user_email_draft_started_at", {
    type: "TimestampUtc",
  });
  s.defScalar("user_email_draft_dispatch_started", false);
  s.startTransaction();
  s.modify(sql`update db.user_email_drafts
        set status = 'sending', send_started_at = now(), last_error = null
        where id = ${draftId}
          and sys_user_id = current_user
          and status in ${EDITABLE_DRAFT_STATUS}
        returning id into claimed_user_email_draft_id`);
  s.commitTransaction();
  s.throwErrorIf(
    sql`claimed_user_email_draft_id is null`,
    sql.lit`This draft is unavailable or is no longer ready to send.`,
  );
  s.setScalar(
    "claimed_user_email_draft_started_at",
    sql`(select send_started_at
      from db.user_email_drafts
      where id = claimed_user_email_draft_id
        and sys_user_id = current_user
        and status = 'sending')`,
  );

  s.try({
    body: (s) => {
      s.defRecord(
        "user_email_draft_to_send",
        sql`select id, integration_key, account_id, from_email,
                       subject, body
                from db.user_email_drafts
                where id = claimed_user_email_draft_id
                  and sys_user_id = current_user
                  and status = 'sending'`,
      );
      s.throwErrorIf(
        sql`user_email_draft_to_send.id is null`,
        sql.lit`The claimed draft could not be loaded.`,
      );
      s.throwErrorIf(
        sql`not exists (
              select 1
              from db.user_email_draft_recipients recipient
              where recipient.user_email_draft_id = user_email_draft_to_send.id
                and nullif(trim(recipient.email), '') is not null
            )`,
        sql.lit`Add at least one recipient before sending.`,
      );
      s.throwErrorIf(
        sql`exists (
              select 1
              from db.user_email_draft_recipients recipient
              where recipient.user_email_draft_id = user_email_draft_to_send.id
                and (
                  char_length(trim(recipient.email)) > 254
                  or not string.is_valid_email(trim(recipient.email))
                )
            )`,
        sql.lit`Correct invalid recipient email addresses before sending.`,
      );
      s.throwErrorIf(
        sql`(select count(*)
          from db.user_email_draft_recipients recipient
          where recipient.user_email_draft_id = user_email_draft_to_send.id
            and nullif(trim(recipient.email), '') is not null) > 1000`,
        sql.lit`Email drafts are limited to 1000 recipients.`,
      );

      const senderMatches = integrations.map((integration) =>
        sql`(
              user_email_draft_to_send.integration_key = ${
          sql.lit(integration.integrationKey)
        }
              and exists (
                select 1
                from (${
          integration.availableSendersQuery(sql`current_user`)
        }) sender
                where sender.account_id = user_email_draft_to_send.account_id
                  and lower(trim(sender.from_address)) =
                    lower(trim(user_email_draft_to_send.from_email))
              )
            )`
      );
      s.throwErrorIf(
        senderMatches.length === 0 ? sql`true` : sql.not(
          sql.or(...senderMatches),
        ),
        sql.lit`Choose an active connected account before sending.`,
      );

      const recipients = (type: "to" | "cc" | "bcc") =>
        sql`(
              select string_agg(trim(recipient.email), ',')
              from db.user_email_draft_recipients recipient
              where recipient.user_email_draft_id = user_email_draft_to_send.id
                and recipient.recipient_type = ${sql.lit(type)}
                and nullif(trim(recipient.email), '') is not null
            )`;
      const attachmentQuery = sql`select attachment.id,
                  attachment.name as filename,
                  attachment.content_type,
                  attachment.size_bytes,
                  attachment.blob
              from db.user_email_draft_attachments attachment
              where attachment.user_email_draft_id = user_email_draft_to_send.id
              order by attachment.id`;

      for (const integration of integrations) {
        s.if(
          sql`user_email_draft_to_send.integration_key = ${
            sql.lit(integration.integrationKey)
          }`,
          (s) => {
            integration.sendEmailFromServer(s, {
              accountId: sql`user_email_draft_to_send.account_id`,
              from: sql`user_email_draft_to_send.from_email`,
              to: recipients("to"),
              cc: recipients("cc"),
              bcc: recipients("bcc"),
              subject: sql`user_email_draft_to_send.subject`,
              body:
                sql`lexical_rich_text_to_html_email(user_email_draft_to_send.body)`,
              attachmentsQuery: attachmentQuery,
              beforeEmailSent: (s) => {
                s.throwErrorIf(
                  sql`not exists (
                    select 1
                    from db.user_email_drafts draft
                    where draft.id = claimed_user_email_draft_id
                      and draft.sys_user_id = current_user
                      and draft.status = 'sending'
                      and draft.send_started_at =
                        claimed_user_email_draft_started_at
                  )`,
                  sql.lit`This draft send claim expired before dispatch.`,
                );
                s.setScalar("user_email_draft_dispatch_started", true);
              },
              onEmailSendError: (s, ctx) => {
                if (ctx.deliveryMayHaveOccurred) {
                  s.setScalar(
                    "user_email_draft_dispatch_started",
                    ctx.deliveryMayHaveOccurred,
                  );
                }
              },
            });
          },
        );
      }

      s.startTransaction();
      s.modify(sql`delete from db.user_email_drafts
            where id = claimed_user_email_draft_id
              and sys_user_id = current_user
              and status in ('sending', 'send_unknown')
              and send_started_at = claimed_user_email_draft_started_at`);
      s.commitTransaction();
    },
    errorName: "user_email_draft_send_error",
    catch: (s) => {
      s.rollbackIfInTransaction();
      s.startTransaction();
      s.modify(sql`update db.user_email_drafts
            set status = case when user_email_draft_dispatch_started
                  then 'send_unknown'::enums.user_email_draft_status
                  else 'failed'::enums.user_email_draft_status end,
                send_started_at = case when user_email_draft_dispatch_started
                  then send_started_at else null end,
                updated_at = now(),
                last_error = left(
                  coalesce(user_email_draft_send_error.message, 'Send failed'),
                  2000
                )
            where id = claimed_user_email_draft_id
              and sys_user_id = current_user
              and status = 'sending'
              and send_started_at = claimed_user_email_draft_started_at`);
      s.commitTransaction();
      s.throwError(sql`coalesce(
            user_email_draft_send_error.message,
            'The draft could not be sent.'
          )`);
    },
  });
}

/** Deletes an ambiguous draft after its owner verifies provider delivery. */
export function confirmUserEmailDraftSent<T extends IServerBaseStatements>(
  s: T,
  draftId: Sql,
) {
  s.defScalar("confirmed_user_email_draft_id", { type: "BigInt" });
  s.startTransaction();
  s.modify(sql`delete from db.user_email_drafts
    where id = ${draftId}
      and sys_user_id = current_user
      and status = 'send_unknown'
    returning id into confirmed_user_email_draft_id`);
  s.commitTransaction();
  s.throwErrorIf(
    sql`confirmed_user_email_draft_id is null`,
    sql.lit`This draft has already been resolved.`,
  );
}

function integrationKeyFromAccountProvider(provider: Sql) {
  return sql`case ${provider}
    when 'outlook' then 'outlook_email'
    else ${provider}
  end`;
}

function accountProviderFromIntegrationKey(integrationKey: Sql) {
  return sql`case ${integrationKey}
    when 'outlook_email' then 'outlook'
    else ${integrationKey}
  end`;
}

function DraftSenderField() {
  const table = useCurrentTableHelper();
  return (
    <>
      <Show
        when={sql`not exists (select 1 from user_email_accounts)`}
      >
        <Alert
          color="warning"
          variant="soft"
          startIcon="Warning"
          endDecorator={
            <Button
              href={system.block(CrmBlock).routes.emailIntegrationsPath}
              size="sm"
            >
              Connect account
            </Button>
          }
        >
          Connect an active email account before choosing a sender.
        </Alert>
      </Show>
      <Show when={sql`exists (select 1 from user_email_accounts)`}>
        <EachSelect
          table="user_email_accounts"
          optionLabel="account_label"
          optionValue="account_key"
          valueType="String"
          value={sql`selected_account_key`}
          fullWidth
          placeholder="Choose sender"
          onChange={(s) => {
            s.setScalar("selected_account_key", sql`target_value`);
            s.modify(sql`update ${table.tableIdent}
              set integration_key = ${
              integrationKeyFromAccountProvider(sql`(
                select provider from user_email_accounts
                where account_key = target_value
              )`)
            },
                  integration_key_write_touched = true,
                  account_id = (
                    select account_id from user_email_accounts
                    where account_key = target_value
                  ),
                  account_id_write_touched = true,
                  from_email = (
                    select email from user_email_accounts
                    where account_key = target_value
                  ),
                  from_email_write_touched = true`);
          }}
        />
      </Show>
    </>
  );
}

function DraftBodyField() {
  const field = useFieldHelper();
  return (
    <RichTextSimpleEditor
      value={field.value}
      onChange={(s, value) => field.setValue(s, value)}
      extendedToolbar
      style={{ minHeight: sql.lit`280px` }}
    />
  );
}

function DraftRecipients({ isNew }: { isNew: boolean }) {
  return (
    <Form.Relation
      table="user_email_draft_recipients"
      many
      dontInitialize={isNew}
      fields={["recipient_type", "email"]}
      validatePartialRows
    >
      <div className="flex flex-col gap-2">
        <Form.Each>
          <div className="flex items-start gap-2">
            <div className="w-32">
              <Form.Field field="recipient_type">
                <FieldFormControl aria-label="Recipient type" />
              </Form.Field>
            </div>
            <div className="flex-1">
              <Form.Field field="email">
                <FieldFormControl
                  aria-label="Email address"
                  placeholder="name@example.com"
                />
              </Form.Field>
            </div>
            <Form.DeleteRecordIconButton
              icon="Close"
              aria-label="Remove recipient"
              variant="plain"
              color="neutral"
            />
          </div>
        </Form.Each>
        <Form.AddCurrentTableButton
          fields={{ recipient_type: sql.lit`to`, email: sql.lit`` }}
          startIcon="Add"
          variant="outlined"
          size="sm"
          className="self-start"
        >
          Add recipient
        </Form.AddCurrentTableButton>
        {isNew && (
          <Typography level="body-xs" color="neutral">
            Recipients can be added now or after saving the draft.
          </Typography>
        )}
      </div>
    </Form.Relation>
  );
}

function DraftFields(props: { isNew: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Typography level="title-sm" className="mb-2">From</Typography>
        <DraftSenderField />
      </div>
      <div>
        <Typography level="title-sm" className="mb-2">
          Recipients
        </Typography>
        <DraftRecipients isNew={props.isNew} />
      </div>
      <div>
        <Typography level="title-sm" className="mb-2">Subject</Typography>
        <Form.Field field="subject">
          <FieldFormControl fullWidth />
        </Form.Field>
      </div>
      <div>
        <Typography level="title-sm" className="mb-2">Message</Typography>
        <Form.Field field="body">
          <DraftBodyField />
        </Form.Field>
      </div>
      <Form.ErrorAlert />
      <div className="flex justify-end gap-2">
        <Button
          href={system.block(CrmBlock).routes.emailDraftsPath}
          variant="outlined"
          color="neutral"
        >
          Cancel
        </Button>
        <Form.SubmitButton startIcon="Save">Save draft</Form.SubmitButton>
      </div>
    </div>
  );
}

function DraftForm(props: { draftId?: Sql }) {
  const block = system.block(CrmBlock);
  const isNew = props.draftId === undefined;
  const selectedAccount = sql`from user_email_accounts
    where account_key = selected_account_key`;
  const fields = [
    "integration_key",
    "account_id",
    "from_email",
    "subject",
    "body",
  ];
  const formTable = isNew
    ? (
      <Form.Insert
        table="user_email_drafts"
        fields={fields}
        values={{
          sys_user_id: sql`current_user`,
          integration_key: integrationKeyFromAccountProvider(
            sql`(select provider ${selectedAccount})`,
          ),
          account_id: sql`(select account_id ${selectedAccount})`,
          from_email: sql`(select email ${selectedAccount})`,
        }}
      >
        <DraftFields isNew />
      </Form.Insert>
    )
    : (
      <Form.Update
        table="user_email_drafts"
        fields={fields}
        where={sql`id = ${props.draftId!}
          and sys_user_id = current_user
          and status in ${EDITABLE_DRAFT_STATUS}`}
        setFields={{
          status: sql.lit`draft`,
          last_error: sql`null`,
          send_started_at: sql`null`,
          updated_at: sql`now()`,
        }}
      >
        <DraftFields isNew={false} />
      </Form.Update>
    );

  return (
    <Form
      afterSubmitClientSuccess={(s) => {
        s.navigate(sql.lit(block.routes.emailDraftsPath));
      }}
    >
      {formTable}
    </Form>
  );
}

function DraftEditorPage(props: { draftId?: Sql }) {
  const block = system.block(CrmBlock);
  const isNew = props.draftId === undefined;
  return (
    <Data
      procedure={(s) => {
        defineAvailableEmailAccounts(s);
        s.defScalar(
          "email_draft_is_editable",
          isNew ? sql`true` : sql`exists (
            select 1 from db.user_email_drafts
            where id = ${props.draftId!}
              and sys_user_id = current_user
              and status in ${EDITABLE_DRAFT_STATUS}
          )`,
        );
        if (!isNew) {
          s.setScalar(
            "selected_account_key",
            sql`(
              select account.account_key
              from user_email_accounts account
              join db.user_email_drafts draft
                on draft.account_id = account.account_id
               and lower(draft.from_email) = lower(account.email)
               and ${
              accountProviderFromIntegrationKey(sql`draft.integration_key`)
            } = account.provider
              where draft.id = ${props.draftId!}
                and draft.sys_user_id = current_user
              limit 1
            )`,
          );
        }
      }}
    >
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <Typography level="h3">
            {isNew ? "New email draft" : "Edit email draft"}
          </Typography>
          <Button
            href={block.routes.emailDraftsPath}
            variant="plain"
            startIcon="ArrowBack"
          >
            Drafts
          </Button>
        </div>
        <Show
          when={sql`email_draft_is_editable`}
          fallback={
            <Alert color="warning" variant="soft" startIcon="Warning">
              This draft cannot be edited. It may have already been sent or
              discarded.
            </Alert>
          }
        >
          <Card variant="outlined" className="p-5">
            <DraftForm draftId={props.draftId} />
          </Card>
          {!isNew && <DraftAttachments draftId={props.draftId!} />}
        </Show>
      </div>
    </Data>
  );
}

function DraftAttachments({ draftId }: { draftId: Sql }) {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "email_draft_attachments",
          sql`select id, name, content_type, size_bytes
            from db.user_email_draft_attachments
            where user_email_draft_id = ${draftId}
              and exists (
                select 1 from db.user_email_drafts draft
                where draft.id = user_email_draft_id
                  and draft.sys_user_id = current_user
                  and draft.status in ${EDITABLE_DRAFT_STATUS}
              )
            order by id`,
        );
      }}
    >
      <Card variant="outlined" className="p-5 mt-4">
        <div className="flex items-center justify-between mb-3">
          <Typography level="title-md" startIcon="Attachment">
            Attachments
          </Typography>
          <FileActionButton
            size="sm"
            variant="outlined"
            startIcon="UploadOutlined"
            successMessage="Attachment added"
            action={(s, file) => {
              s.readDomFile(file.uuid, "email_draft_attachment_content");
              s.throwErrorIf(
                sql`octet_length(email_draft_attachment_content) >=
                  ${MAX_SERVER_EMAIL_ATTACHMENT_BYTES + 1}`,
                sql.lit`Each email attachment must be smaller than 3 MB.`,
              );
              s.try({
                errorName: "email_draft_attachment_error",
                body: (s) => {
                  s.defScalar("email_draft_attachment_claimed_id", {
                    type: "BigInt",
                  });
                  s.throwErrorIf(
                    sql`not exists (
                      select 1 from db.user_email_drafts
                      where id = ${draftId}
                        and sys_user_id = current_user
                        and status in ${EDITABLE_DRAFT_STATUS}
                    )`,
                    sql.lit`This draft is no longer editable.`,
                  );
                  s.throwErrorIf(
                    sql`(select count(*)
                      from db.user_email_draft_attachments
                      where user_email_draft_id = ${draftId}) >=
                      ${MAX_SERVER_EMAIL_ATTACHMENT_COUNT}`,
                    sql.lit`Email drafts are limited to 20 attachments.`,
                  );
                  s.throwErrorIf(
                    sql`coalesce((select sum(size_bytes)
                      from db.user_email_draft_attachments
                      where user_email_draft_id = ${draftId}), 0) +
                      octet_length(email_draft_attachment_content) >
                      ${MAX_SERVER_EMAIL_ATTACHMENTS_TOTAL_BYTES}`,
                    sql.lit`Email attachments are limited to 10 MB in total.`,
                  );
                  s.createBlob(
                    sql`email_draft_attachment_content`,
                    "email_draft_attachment_blob",
                  );
                  s.startTransaction();
                  s.modify(sql`update db.user_email_drafts
                    set updated_at = now()
                    where id = ${draftId}
                      and sys_user_id = current_user
                      and status in ${EDITABLE_DRAFT_STATUS}
                    returning id into email_draft_attachment_claimed_id`);
                  s.throwErrorIf(
                    sql`email_draft_attachment_claimed_id is null`,
                    sql.lit`This draft is no longer editable.`,
                  );
                  s.throwErrorIf(
                    sql`(select count(*)
                      from db.user_email_draft_attachments
                      where user_email_draft_id =
                        email_draft_attachment_claimed_id) >=
                      ${MAX_SERVER_EMAIL_ATTACHMENT_COUNT}`,
                    sql.lit`Email drafts are limited to 20 attachments.`,
                  );
                  s.throwErrorIf(
                    sql`coalesce((select sum(size_bytes)
                      from db.user_email_draft_attachments
                      where user_email_draft_id =
                        email_draft_attachment_claimed_id), 0) +
                      octet_length(email_draft_attachment_content) >
                      ${MAX_SERVER_EMAIL_ATTACHMENTS_TOTAL_BYTES}`,
                    sql.lit`Email attachments are limited to 10 MB in total.`,
                  );
                  s.modify(sql`insert into db.user_email_draft_attachments
                      (user_email_draft_id, name, content_type, size_bytes, blob)
                    values (
                      email_draft_attachment_claimed_id, ${file.name},
                      coalesce(
                        nullif(${file.type}, ''),
                        'application/octet-stream'
                      ),
                      octet_length(email_draft_attachment_content),
                      email_draft_attachment_blob
                    )`);
                  s.commitTransaction();
                },
                catch: (s) => {
                  s.rollbackIfInTransaction();
                  s.throwError(sql`email_draft_attachment_error.message`);
                },
              });
            }}
          >
            Add attachment
          </FileActionButton>
        </div>
        <Show
          when={sql`not exists (select 1 from email_draft_attachments)`}
        >
          <Typography level="body-sm" color="neutral">
            No attachments.
          </Typography>
        </Show>
        <Each table="email_draft_attachments" recordName="draft_attachment">
          <div className="flex items-center gap-3 py-2 border-b border-divider last:border-0">
            <MaterialIcon icon="InsertDriveFile" />
            <div className="flex-1 min-w-0">
              <Typography level="body-sm" className="truncate">
                {sql`draft_attachment.name`}
              </Typography>
              <Typography level="body-xs" color="neutral">
                {sql`case
                  when draft_attachment.size_bytes < 1024
                    then draft_attachment.size_bytes::string || ' B'
                  when draft_attachment.size_bytes < 1048576
                    then (draft_attachment.size_bytes / 1024)::string || ' KB'
                  else (draft_attachment.size_bytes / 1048576)::string || ' MB'
                end`}
              </Typography>
            </div>
            <ActionButton
              size="sm"
              variant="plain"
              color="danger"
              startIcon="DeleteOutline"
              confirm={{
                description: "Remove this attachment from the draft?",
                confirmText: "Remove",
              }}
              action={(s) => {
                s.startTransaction();
                s.modify(sql`delete from db.user_email_draft_attachments
                  where id = draft_attachment.id
                    and exists (
                      select 1 from db.user_email_drafts draft
                      where draft.id = user_email_draft_id
                        and draft.sys_user_id = current_user
                        and draft.status in ${EDITABLE_DRAFT_STATUS}
                    )`);
                s.modify(sql`update db.user_email_drafts
                  set updated_at = now()
                  where id = ${draftId} and sys_user_id = current_user`);
                s.commitTransaction();
              }}
            >
              Remove
            </ActionButton>
          </div>
        </Each>
      </Card>
    </Data>
  );
}

function DraftStatusChip() {
  return (
    <Show
      when={sql`draft.status = 'failed'`}
      fallback={
        <Show
          when={sql`draft.status = 'send_unknown'`}
          fallback={
            <Show
              when={sql`draft.status = 'sending'`}
              fallback={
                <Chip size="sm" variant="soft" color="neutral">Draft</Chip>
              }
            >
              <Chip size="sm" variant="soft" color="primary">Sending</Chip>
            </Show>
          }
        >
          <Chip size="sm" variant="soft" color="warning">
            Delivery unknown
          </Chip>
        </Show>
      }
    >
      <Chip size="sm" variant="soft" color="danger">Failed</Chip>
    </Show>
  );
}

function DraftListPage() {
  const block = system.block(CrmBlock);
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "user_email_draft_list",
          sql`select draft.id, draft.status, draft.from_email, draft.subject,
                     draft.updated_at, draft.last_error,
                     (select count(*)
                        from db.user_email_draft_recipients recipient
                        where recipient.user_email_draft_id = draft.id
                     ) as recipient_count,
                     (select count(*)
                        from db.user_email_draft_attachments attachment
                        where attachment.user_email_draft_id = draft.id
                     ) as attachment_count
              from db.user_email_drafts draft
              where draft.sys_user_id = current_user
                and draft.status in (
                  'draft', 'failed', 'sending', 'send_unknown'
                )
              order by draft.updated_at desc, draft.id desc`,
        );
      }}
    >
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <Typography level="h3">Email drafts</Typography>
            <Typography level="body-sm" color="neutral">
              Save a message now and send it later from any active connected
              account you own.
            </Typography>
          </div>
          <Button
            href={`${block.routes.emailDraftsPath}/new`}
            startIcon="Add"
          >
            New draft
          </Button>
        </div>
        <Show
          when={sql`exists (select 1 from user_email_draft_list)`}
          fallback={
            <Card variant="outlined" className="p-10 text-center">
              <MaterialIcon icon="Drafts" className="text-4xl" />
              <Typography level="title-md" className="mt-2">
                No saved drafts
              </Typography>
              <Typography level="body-sm" color="neutral">
                Create a draft to prepare an email without sending it yet.
              </Typography>
            </Card>
          }
        >
          <div className="flex flex-col gap-3">
            <Each table="user_email_draft_list" recordName="draft">
              <Card variant="outlined" className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <DraftStatusChip />
                      <Typography level="title-md" className="truncate">
                        {sql`coalesce(nullif(draft.subject, ''), '(No subject)')`}
                      </Typography>
                    </div>
                    <Typography level="body-sm" color="neutral">
                      {sql`coalesce(draft.from_email, 'No sender selected')`}
                      {" · "}
                      {sql`draft.recipient_count::string || case
                        when draft.recipient_count = 1 then ' recipient'
                        else ' recipients' end`}
                      {" · "}
                      {sql`draft.attachment_count::string || case
                        when draft.attachment_count = 1 then ' attachment'
                        else ' attachments' end`}
                    </Typography>
                    <Show when={sql`draft.last_error is not null`}>
                      <Typography
                        level="body-xs"
                        color="danger"
                        className="mt-2"
                      >
                        {sql`draft.last_error`}
                      </Typography>
                    </Show>
                    <Show when={sql`draft.status = 'send_unknown'`}>
                      <Alert color="warning" variant="soft" className="mt-3">
                        The provider outcome is unknown. Check the connected
                        mailbox before composing another message.
                      </Alert>
                    </Show>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <Show when={sql`draft.status in ${EDITABLE_DRAFT_STATUS}`}>
                      <Button
                        href={block.emailDraftHref(sql`draft.id`)}
                        size="sm"
                        variant="outlined"
                        startIcon="Edit"
                      >
                        Edit
                      </Button>
                      <ActionButton
                        size="sm"
                        startIcon="Send"
                        successMessage="Email sent"
                        confirm={{
                          description:
                            "Send this draft from the selected connected account?",
                          confirmText: "Send",
                        }}
                        action={(s) => {
                          sendUserEmailDraft(s, sql`draft.id`);
                        }}
                      >
                        Send
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="plain"
                        color="danger"
                        confirm={{
                          description: "Discard this draft?",
                          confirmText: "Discard",
                        }}
                        action={(s) => {
                          s.startTransaction();
                          s.modify(sql`delete from db.user_email_drafts
                            where id = draft.id
                              and sys_user_id = current_user
                              and status in ${EDITABLE_DRAFT_STATUS}`);
                          s.commitTransaction();
                        }}
                      >
                        Discard
                      </ActionButton>
                    </Show>
                    <Show when={sql`draft.status = 'send_unknown'`}>
                      <ActionButton
                        size="sm"
                        variant="outlined"
                        successMessage="Draft resolved as sent"
                        confirm={{
                          description:
                            "Confirm that this message appears in the connected mailbox's Sent folder? This removes the local draft.",
                          confirmText: "Confirm sent",
                        }}
                        action={(s) => {
                          confirmUserEmailDraftSent(s, sql`draft.id`);
                        }}
                      >
                        Confirm sent
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="outlined"
                        color="danger"
                        successMessage="Unresolved draft discarded"
                        confirm={{
                          description:
                            "Discard this unresolved local draft? It cannot be resent safely because the provider outcome is unknown.",
                          confirmText: "Discard unresolved draft",
                        }}
                        action={(s) => {
                          s.startTransaction();
                          s.modify(sql`delete from db.user_email_drafts
                            where id = draft.id
                              and sys_user_id = current_user
                              and status = 'send_unknown'`);
                          s.commitTransaction();
                        }}
                      >
                        Discard unresolved
                      </ActionButton>
                    </Show>
                  </div>
                </div>
              </Card>
            </Each>
          </div>
        </Show>
      </div>
    </Data>
  );
}

/** CRM routes for application-owned email drafts. */
export function EmailDraftRoutes() {
  const block = system.block(CrmBlock);
  return (
    <>
      <Route
        path={`${block.routes.emailDraftsPath}/new`}
        title="New email draft"
      >
        <DraftEditorPage />
      </Route>
      <Route path={block.routes.emailDraftDetailPath} title="Edit email draft">
        <DraftEditorPage draftId={sql`ui.record_id`} />
      </Route>
      <Route path={block.routes.emailDraftsPath} title="Email drafts">
        <DraftListPage />
      </Route>
    </>
  );
}
