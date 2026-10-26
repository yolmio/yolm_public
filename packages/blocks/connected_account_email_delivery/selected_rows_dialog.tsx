import { Alert } from "components/alert";
import { Button } from "components/button";
import { Input } from "components/input";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import { Select } from "components/select";
import { Typography } from "components/typography";
import {
  DatagridActionDialog,
  useSelectedIds,
  WithTotalCount,
} from "pages/datagrid_internals/action_dialog_datagrid";
import { Data } from "std/data";
import { ActionButton } from "std/action_button";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { ConnectedAccountEmailDeliverySource } from "./index";

export interface ConnectedAccountEmailSelectedRowsDialogProps {
  openScalar: string;
  source: ConnectedAccountEmailDeliverySource;
}

function EmailTemplatePicker() {
  return (
    <label className="flex flex-col gap-1">
      <Typography level="title-sm">Email template</Typography>
      <Select
        aria-label="Email template"
        value={sql`selected_connected_email_template_id`}
        onChange={(s) =>
          s.setScalar(
            "selected_connected_email_template_id",
            sql`target_value`,
          )}
        fullWidth
      >
        <Each table="connected_email_templates" recordName="template">
          <Select.Option value={sql`template.id::string`}>
            {sql`template.name`}
          </Select.Option>
        </Each>
      </Select>
      <Show when={sql`selected_connected_email_template_id = ''`}>
        <Alert color="warning" variant="soft">
          Create an available email template before sending.
        </Alert>
      </Show>
    </label>
  );
}

/**
 * Complete selected-row mail-merge workflow for a registered connected-email
 * source. The source supplies only its domain-specific templates, recipients,
 * and authorization policy.
 */
export function ConnectedAccountEmailSelectedRowsDialog(
  props: ConnectedAccountEmailSelectedRowsDialogProps,
) {
  const workflow = props.source.config.selectedRows;
  if (!workflow) {
    throw new Error(
      `Connected email source ${props.source.config.key} has no selected-rows workflow`,
    );
  }
  const delivery = props.source.block;
  const contentMissing = workflow.manualContent
    ? sql`selected_connected_email_sender_key = ''
        or (connected_email_content_source = 'template' and selected_connected_email_template_id = '')
        or (connected_email_content_source = 'manual' and trim(connected_email_manual_subject) = '')`
    : sql`selected_connected_email_sender_key = '' or selected_connected_email_template_id = ''`;
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "connected_email_templates",
          sql`select template.id, template.name
            from (${workflow.templatesQuery}) template
            order by template.name, template.id`,
        );
        s.defTable(
          "connected_email_senders",
          sql`select integration_key || ':' || account_id::string || ':' ||
                 lower(trim(from_address)) as sender_key,
                 integration_key, integration_name, account_id, from_address
            from (${delivery.availableSendersQuery(sql`current_user`)}) sender
            order by integration_name, from_address, account_id`,
        );
        s.defScalar(
          "selected_connected_email_template_id",
          sql`coalesce((select id::string
            from connected_email_templates limit 1), '')`,
        );
        s.defScalar(
          "selected_connected_email_sender_key",
          sql`coalesce((select sender_key
            from connected_email_senders limit 1), '')`,
        );
        s.defScalar(
          "connected_email_source_record_key",
          sql`gen_random_uuid()::text`,
        );
        s.defScalar("connected_test_open", false);
        if (workflow.manualContent) {
          s.defScalar("connected_email_content_source", sql.lit`template`);
          s.defScalar("connected_email_manual_subject", sql.lit``);
          s.defScalar("connected_email_manual_body", {
            type: { type: "Json" },
            expr: sql`lexical_simple_paragraph('')`,
          });
        }
      }}
    >
      <DatagridActionDialog
        open={sql.ref(props.openScalar)}
        onClose={(s) => s.setScalar(props.openScalar, false)}
        sx={{
          width: "min(640px, calc(100vw - 24px))",
          maxHeight: "calc(100dvh - 24px)",
          overflowY: "auto",
        }}
        header={
          <Typography level="title-lg" startIcon="Send">
            <span>
              Send from a connected account to{" "}
              <WithTotalCount>
                {(count) => <strong>{count} selected records</strong>}
              </WithTotalCount>
            </span>
          </Typography>
        }
        successMessage="Connected-account email queued successfully"
        form={
          <div className="flex flex-col gap-4">
            <Typography level="body-md">
              Queue one personalized message per eligible selected record
              through a connected email account.
            </Typography>
            <label className="flex flex-col gap-1">
              <Typography level="title-sm">Send from</Typography>
              <Select
                aria-label="Send from"
                value={sql`selected_connected_email_sender_key`}
                onChange={(s) =>
                  s.setScalar(
                    "selected_connected_email_sender_key",
                    sql`target_value`,
                  )}
                fullWidth
              >
                <Each table="connected_email_senders" recordName="sender">
                  <Select.Option value={sql`sender.sender_key`}>
                    {sql`sender.from_address || ' — ' || sender.integration_name`}
                  </Select.Option>
                </Each>
              </Select>
              <Show when={sql`selected_connected_email_sender_key = ''`}>
                <Alert color="warning" variant="soft">
                  Connect an email account before sending.
                </Alert>
              </Show>
            </label>
            {workflow.manualContent
              ? (
                <>
                  <label className="flex flex-col gap-1">
                    <Typography level="title-sm">Message content</Typography>
                    <Select
                      aria-label="Message content"
                      value={sql`connected_email_content_source`}
                      onChange={(s) =>
                        s.setScalar(
                          "connected_email_content_source",
                          sql`target_value`,
                        )}
                      fullWidth
                    >
                      <Select.Option value="template">
                        Use saved template
                      </Select.Option>
                      <Select.Option value="manual">
                        Write manually
                      </Select.Option>
                    </Select>
                  </label>
                  <Show
                    when={sql`connected_email_content_source = 'template'`}
                    fallback={
                      <>
                        <label className="flex flex-col gap-1">
                          <Typography level="title-sm">Subject</Typography>
                          <Input
                            aria-label="Subject"
                            bindScalar="connected_email_manual_subject"
                            fullWidth
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <Typography level="title-sm">Body</Typography>
                          <RichTextSimpleEditor
                            value={sql`connected_email_manual_body`}
                            onChange={(s, value) => {
                              s.setScalar("connected_email_manual_body", value);
                            }}
                            extendedToolbar
                            showVariables
                            variables={workflow.manualContent.variables}
                            sx={{ minHeight: 240 }}
                          />
                        </label>
                      </>
                    }
                  >
                    <EmailTemplatePicker />
                  </Show>
                </>
              )
              : <EmailTemplatePicker />}
            <Typography level="body-sm" sx={{ color: "text.secondary" }}>
              A delivery can contain up to{" "}
              {delivery.opts.maxRecipientsPerDelivery}{" "}
              unique eligible recipients. Provider rate limits may delay
              completion.
            </Typography>
            <Button
              type="button"
              variant="soft"
              startIcon="Send"
              onClick={(s) =>
                s.setScalar(
                  "connected_test_open",
                  sql`not connected_test_open`,
                )}
            >
              {sql`case when connected_test_open then 'Hide test email' else 'Send test' end`}
            </Button>
            <Show when={sql`connected_test_open`}>
              <Data
                noRefetch
                autoWatch={false}
                procedure={(s) => {
                  const ids = useSelectedIds(s);
                  s.defTable(
                    "connected_test_contacts",
                    sql`select source_recipient_key, email
                  from (${
                      workflow.recipientsQuery(ids)
                    }) test_candidate order by email`,
                  );
                  s.defScalar("connected_test_to", sql.lit``);
                  s.defScalar(
                    "connected_test_sample_key",
                    sql`coalesce((select source_recipient_key from connected_test_contacts limit 1), '')`,
                  );
                }}
              >
                <div className="flex flex-col gap-3">
                  <Typography level="body-sm">
                    Send only to the test addresses from the selected account,
                    using the sample contact’s merge fields. Unsubscribe links
                    are inactive in tests.
                  </Typography>
                  <label className="flex flex-col gap-1">
                    <Typography level="title-sm">
                      Test email addresses
                    </Typography>
                    <Input
                      type="email"
                      multiple
                      aria-label="Test email addresses"
                      bindScalar="connected_test_to"
                      fullWidth
                    />
                    <Typography level="body-sm">
                      Separate up to 10 addresses with commas.
                    </Typography>
                  </label>
                  <label className="flex flex-col gap-1">
                    <Typography level="title-sm">Sample contact</Typography>
                    <Select
                      aria-label="Sample contact"
                      value={sql`nullif(connected_test_sample_key, '')`}
                      onChange={(s, value) =>
                        s.setScalar("connected_test_sample_key", value)}
                      fullWidth
                    >
                      <Each
                        table="connected_test_contacts"
                        recordName="test_contact"
                      >
                        <Select.Option
                          value={sql`test_contact.source_recipient_key`}
                        >
                          {sql`test_contact.email`}
                        </Select.Option>
                      </Each>
                    </Select>
                  </label>
                  <Show
                    when={sql`not exists(select 1 from connected_test_contacts)`}
                  >
                    <Alert color="warning">
                      Select an eligible contact to personalize a test email.
                    </Alert>
                  </Show>
                  <ActionButton
                    variant="soft"
                    startIcon="Send"
                    refetch={false}
                    errorDisplay="inline"
                    successMessage="Test email submitted"
                    disabled={sql`(${contentMissing}) or trim(connected_test_to) = '' or connected_test_sample_key = ''`}
                    action={(s) => {
                      props.source.sendTest(s, {
                        senderKey: sql`ui.selected_connected_email_sender_key`,
                        templateId:
                          sql`ui.selected_connected_email_template_id`,
                        selectedIds: sql`ui.datagrid_ids`,
                        to: sql`ui.connected_test_to`,
                        sampleRecipientKey: sql`ui.connected_test_sample_key`,
                        ...(workflow.manualContent
                          ? {
                            contentSource:
                              sql`ui.connected_email_content_source`,
                            manualSubject:
                              sql`ui.connected_email_manual_subject`,
                            manualBody: sql`ui.connected_email_manual_body`,
                          }
                          : {}),
                      });
                    }}
                  >
                    Send test email
                  </ActionButton>
                </div>
              </Data>
            </Show>
          </div>
        }
        confirmDisabled={contentMissing}
        action={{
          beforeTransactionStart: (s, ids) => {
            props.source.queueSelectedRows(s, {
              sourceRecordKey: sql`ui.connected_email_source_record_key`,
              deliveryIdScalar: "connected_email_delivery_id",
              senderKey: sql`ui.selected_connected_email_sender_key`,
              templateId: sql`ui.selected_connected_email_template_id`,
              selectedIds: ids,
              ...(workflow.manualContent
                ? {
                  contentSource: sql`ui.connected_email_content_source`,
                  manualSubject: sql`ui.connected_email_manual_subject`,
                  manualBody: sql`ui.connected_email_manual_body`,
                }
                : {}),
            });
          },
        }}
      />
    </Data>
  );
}
