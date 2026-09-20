import { Alert } from "components/alert";
import { Input } from "components/input";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import { Select } from "components/select";
import { Typography } from "components/typography";
import {
  DatagridActionDialog,
  WithTotalCount,
} from "pages/datagrid_internals/action_dialog_datagrid";
import { Data } from "std/data";
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
        header={
          <Typography level="title-lg" startIcon="Send">
            Send from a connected account to{" "}
            <WithTotalCount>
              {(count) => <strong>{count} selected records</strong>}
            </WithTotalCount>
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
          </div>
        }
        confirmDisabled={workflow.manualContent
          ? sql`selected_connected_email_sender_key = ''
              or (
                connected_email_content_source = 'template'
                and selected_connected_email_template_id = ''
              )
              or (
                connected_email_content_source = 'manual'
                and trim(connected_email_manual_subject) = ''
              )`
          : sql`selected_connected_email_sender_key = ''
              or selected_connected_email_template_id = ''`}
        action={{
          beforeTransactionCommit: (s, ids) => {
            props.source.enqueueSelectedRows(s, {
              sourceRecordKey: sql`ui.connected_email_source_record_key`,
              senderKey: sql`ui.selected_connected_email_sender_key`,
              templateId: sql`ui.selected_connected_email_template_id`,
              selectedIds: ids,
              deliveryIdScalar: "connected_email_delivery_id",
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
