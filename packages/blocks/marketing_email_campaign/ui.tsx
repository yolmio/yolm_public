import {
  BulkEmailDeliveryReport,
  BulkEmailReconciliation,
} from "blocks/bulk_email_delivery";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { PageHeader } from "components/page_header";
import { Select } from "components/select";
import { StatusChip } from "components/status_chip";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form } from "std/form";
import { FormICtxKey } from "std/ictx";
import { DataTable } from "components/data_table";
import { ActionButton } from "std/action_button";
import { sql } from "std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Each, Route, Show, useICtx } from "std/ui";
import type { Node } from "std/ui";
import { DatagridPage } from "pages/datagrid";
import {
  DatagridActionDialog,
  useSelectedIds,
  WithTotalCount,
} from "pages/datagrid_internals/action_dialog_datagrid";
import {
  isMarketingEmailTemplateReady,
  MarketingEmailCampaignBlock,
} from "./index";

/** Read visibility and independently enforced campaign-management access. */
export interface MarketingCampaignAccess {
  canView: Sql;
  canManage: Sql;
  /** Enforce management access on the server for every mutation. */
  authorize: (s: UiServerStatements) => void;
  denied?: Node;
}

/** Selected audience IDs and unsaved scheduling form values. */
export interface MarketingCampaignSelectedRows {
  /** Queryable table of selected record IDs, with an id column. */
  selectedIds: Sql;
  name: Sql;
  /** Text input; validate/cast before passing to the campaign block. */
  templateId: Sql;
  /** Local datetime input, parsed with marketingCampaignScheduleTime. */
  scheduleTime: Sql;
}

/** Domain-specific scheduling action and explanatory copy for the shared dialog. */
export interface MarketingCampaignSelectedRowsDialogProps {
  openScalar: string;
  description: Node;
  senderDescription: Node;
  senderKey: string;
  /** Resolved audience query for the selected rows, using buildAudienceQuery. */
  previewAudience?: (selectedIds: Sql) => Sql;
  authorize: (s: UiServerStatements) => void;
  /** Runs inside the dialog transaction; retain domain eligibility checks here. */
  onSchedule: (
    s: UiServerStatements,
    values: MarketingCampaignSelectedRows,
  ) => void;
}

/** Sender, authorization, and navigation for the standard campaign list. */
export interface MarketingCampaignsPageProps {
  access: MarketingCampaignAccess;
  /** SQL display expression with record as the campaign row alias. */
  senderLabel: Sql;
  paths: {
    campaigns: string;
    templates: string;
    results: string;
    recipients: string;
  };
}

/** Authorized delivery results with optional companion reports. */
export interface MarketingCampaignDeliveryResultsPageProps {
  access: MarketingCampaignAccess;
  path: string;
  title: string;
  description: Node;
  children?: Node;
}

/** Select a complete template and schedule selected contacts. */
export function SelectedRowsDialog(
  props: MarketingCampaignSelectedRowsDialogProps,
) {
  return (
    <Data
      noRefetch
      procedure={(s) => {
        s.defTable(
          "available_campaign_templates",
          sql`select template.id, template.name
            from email_templates template
            where ${isMarketingEmailTemplateReady(sql`template`)}
            order by template.name, template.id`,
        );
        s.defScalar(
          "new_campaign_name",
          sql`'Campaign ' || format.date(current_date(), '%B %d, %Y')`,
        );
        s.defScalar(
          "selected_campaign_template_id",
          sql`coalesce((select id::string
            from available_campaign_templates limit 1), '')`,
        );
        s.defScalar("selected_campaign_scheduled_at", sql.lit``);
      }}
    >
      <DatagridActionDialog
        open={sql.ref(props.openScalar)}
        onClose={(s) => s.setScalar(props.openScalar, false)}
        maxWidth="sm"
        header={
          <div className="flex flex-col gap-1">
            <Typography level="title-lg" startIcon="Campaign">
              Send campaign
            </Typography>
            <WithTotalCount>
              {(count) => (
                <Typography level="body-sm" sx={{ color: "text.secondary" }}>
                  {sql`'To ' || ${count}::string || ' selected ' ||
                    case when ${count} = 1 then 'contact' else 'contacts' end`}
                </Typography>
              )}
            </WithTotalCount>
          </div>
        }
        successMessage="Campaign scheduled successfully"
        form={
          <div className="flex flex-col gap-4 pt-2">
            <Typography level="body-sm" sx={{ color: "text.secondary" }}>
              {props.description}
            </Typography>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <Typography level="title-sm">Campaign name</Typography>
                <Input bindScalar="new_campaign_name" fullWidth />
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <Typography level="title-sm">Email template</Typography>
                  <Select
                    aria-label="Email template"
                    value={sql`nullif(selected_campaign_template_id, '')`}
                    placeholder="No ready templates"
                    onChange={(s) =>
                      s.setScalar(
                        "selected_campaign_template_id",
                        sql`target_value`,
                      )}
                    fullWidth
                  >
                    <Each
                      table="available_campaign_templates"
                      recordName="campaign_template"
                    >
                      <Select.Option
                        value={sql`campaign_template.id::string`}
                      >
                        {sql`campaign_template.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </label>
                <Show when={sql`selected_campaign_template_id = ''`}>
                  <Alert color="warning" variant="soft" startIcon="Warning">
                    Create and activate an email template before scheduling a
                    campaign.
                  </Alert>
                </Show>
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <Typography level="title-sm">Schedule time</Typography>
              <Input
                type="datetime-local"
                bindScalar="selected_campaign_scheduled_at"
                fullWidth
              />
              <Typography level="body-xs" sx={{ color: "text.secondary" }}>
                Leave blank to send when the campaign worker next runs.
              </Typography>
            </label>
            <Alert color="neutral" variant="soft" startIcon="Info">
              {props.senderDescription}
            </Alert>
            {props.previewAudience && (
              <SelectedSenderPreview query={props.previewAudience} />
            )}
            <CampaignTestButton
              templateId={sql`try_cast(selected_campaign_template_id as bigint)`}
              senderKey={sql.lit(props.senderKey)}
              authorize={props.authorize}
              previewAudience={props.previewAudience}
            />
            <Form.ErrorAlert mode="all" />
          </div>
        }
        confirmDisabled={sql`trim(new_campaign_name) = '' or selected_campaign_template_id = ''`}
        action={{
          beforeTransactionStart: props.authorize,
          beforeTransactionCommit: (s, selectedIds) =>
            props.onSchedule(s, {
              selectedIds,
              name: sql`ui.new_campaign_name`,
              templateId: sql`ui.selected_campaign_template_id`,
              scheduleTime: sql`ui.selected_campaign_scheduled_at`,
            }),
        }}
      />
    </Data>
  );
}

function SelectedSenderPreview(props: { query: (selectedIds: Sql) => Sql }) {
  const campaigns = system.block(MarketingEmailCampaignBlock);
  return (
    <Data local procedure={(s) => s.defScalar("sender_issue_page", 0)}>
      <Data
        watch={[sql`sender_issue_page`]}
        procedure={(s) => {
          const selectedIds = useSelectedIds(s);
          const audience = props.query(selectedIds);
          s.defTable(
            "sender_groups",
            sql`select from_address, reply_to,
        ${campaigns.validSender(sql`recipient`)} as valid,
        count(*) as recipient_count,
        count(case when sender_is_fallback then 1 end) as fallback_count
        from (${audience}) recipient group by from_address, reply_to, ${
              campaigns.validSender(sql`recipient`)
            }
        order by from_address, reply_to`,
          );
          s.defScalar(
            "sender_issue_count",
            sql`coalesce((select sum(recipient_count) from sender_groups where not valid), 0)`,
          );
          s.defTable(
            "sender_issues",
            sql`select recipient_label, email, recipient_href,
        coalesce(sender_error, 'Sender unavailable or invalid. Review the contact owner.') as reason
        from (${audience}) recipient where not ${
              campaigns.validSender(sql`recipient`)
            }
        order by email, source_recipient_key limit 25 offset sender_issue_page * 25`,
          );
        }}
      >
        <section className="flex flex-col gap-2" aria-label="Sender preview">
          <Typography level="title-md">Sender preview</Typography>
          <Typography level="body-sm">
            Eligible, unique recipients after exclusions. Senders are frozen
            when you schedule.
          </Typography>
          <Show when={sql`not exists(select 1 from sender_groups)`}>
            <Alert color="warning">
              No eligible recipients remain in this selection.
            </Alert>
          </Show>
          <Each table="sender_groups" recordName="sender_group">
            <Show when={sql`sender_group.valid`}>
              <div className="flex flex-col gap-1 break-words">
                <Typography level="title-sm">
                  {sql`'From: ' || sender_group.from_address`}
                </Typography>
                <Typography level="body-sm">
                  {sql`'Reply-To: ' || coalesce(sender_group.reply_to, sender_group.from_address)`}
                </Typography>
                <Typography level="body-sm">
                  {sql`sender_group.recipient_count::string || case when sender_group.recipient_count = 1 then ' recipient' else ' recipients' end || ' · ' || sender_group.fallback_count::string || ' using fallback'`}
                </Typography>
              </div>
            </Show>
          </Each>
          <Show when={sql`sender_issue_count > 0`}>
            <Alert color="warning">
              {sql`sender_issue_count::string || ' contacts need sender corrections before this campaign can be scheduled.'`}
            </Alert>
            <div className="max-h-64 overflow-y-auto flex flex-col gap-3">
              <Each table="sender_issues" recordName="sender_issue">
                <div className="flex flex-col gap-1 break-words">
                  <Typography level="title-sm">
                    {sql`coalesce(nullif(sender_issue.recipient_label, ''), sender_issue.email)`}
                  </Typography>
                  <Typography level="body-sm">
                    {sql`sender_issue.email || ': ' || sender_issue.reason`}
                  </Typography>
                  <Show when={sql`sender_issue.recipient_href is not null`}>
                    <Button
                      variant="plain"
                      size="sm"
                      href={sql`sender_issue.recipient_href`}
                      className="self-start"
                    >
                      Review contact owner
                    </Button>
                  </Show>
                </div>
              </Each>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="plain"
                disabled={sql`sender_issue_page = 0`}
                onClick={(s) =>
                  s.setScalar("sender_issue_page", sql`sender_issue_page - 1`)}
              >
                Previous issues
              </Button>
              <Typography level="body-sm">
                {sql`'Page ' || (sender_issue_page + 1)::string`}
              </Typography>
              <Button
                size="sm"
                variant="plain"
                disabled={sql`(sender_issue_page + 1) * 25 >= sender_issue_count`}
                onClick={(s) =>
                  s.setScalar("sender_issue_page", sql`sender_issue_page + 1`)}
              >
                Next issues
              </Button>
            </div>
          </Show>
          <Button
            size="sm"
            variant="plain"
            startIcon="Refresh"
            onClick={(s) => {
              useICtx(FormICtxKey).setWriteError(s, sql.null);
              s.refetch();
            }}
          >
            Refresh senders
          </Button>
        </section>
      </Data>
    </Data>
  );
}

function CampaignAccessBoundary(
  props: { access: MarketingCampaignAccess; children: Node },
) {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("campaign_can_view", props.access.canView);
        s.defScalar("campaign_can_manage", props.access.canManage);
      }}
    >
      <Show
        when={sql`campaign_can_view`}
        fallback={props.access.denied ?? (
          <div className="p-6">
            <Alert color="neutral" variant="soft" startIcon="Lock">
              You do not have permission to view email campaigns.
            </Alert>
          </div>
        )}
      >
        {props.children}
      </Show>
    </Data>
  );
}

function CampaignStatusChip(props: { status: AnyExpr }) {
  return (
    <StatusChip
      cases={[
        {
          when: sql`${props.status} = 'cancelled'`,
          label: "Cancelled",
          color: "neutral",
        },
        {
          when: sql`${props.status} = 'scheduled'`,
          label: "Scheduled",
          color: "primary",
        },
        {
          when: sql`${props.status} = 'submitting'`,
          label: "Submitting",
          color: "primary",
        },
        {
          when: sql`${props.status} = 'submitted'`,
          label: "Submitted",
          color: "success",
        },
        {
          when: sql`${props.status} = 'failed'`,
          label: "Failed",
          color: "danger",
        },
      ]}
    />
  );
}

function selectedTestRecipients(
  campaigns: MarketingEmailCampaignBlock,
  selectedIds: Sql,
) {
  return sql`select source_recipient_key, email from (${
    campaigns.opts.audience.recipientsQuery(sql`preview_campaign`)
  }) recipient
    where try_cast(source_recipient_key as bigint) in (select id from ${selectedIds})`;
}

function CampaignTestButton(props: {
  campaignId?: NumericExpr;
  templateId?: Sql;
  senderKey?: Sql;
  previewAudience?: (selectedIds: Sql) => Sql;
  authorize: (s: UiServerStatements) => void;
}) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("test_open", false);
      }}
    >
      <Button
        size="xs"
        variant="soft"
        startIcon="Send"
        onClick={(s) => s.setScalar("test_open", true)}
      >
        Send test
      </Button>
      <Show when={sql`test_open`}>
        <ModalDialog
          aria-label="Send test email"
          open={sql`test_open`}
          onClose={(s) => s.setScalar("test_open", false)}
          maxWidth="sm"
        >
          <Data
            noRefetch
            procedure={(s) => {
              s.defRecord(
                "preview_campaign",
                props.campaignId !== undefined
                  ? sql`select * from marketing_email_campaigns where id = ${props.campaignId}`
                  : sql`select 0 as id, ${
                    props.templateId ?? sql.null
                  } as email_template_id,
                  ${
                    props.senderKey ?? sql.null
                  } as sender_key, 'Test email' as name`,
              );
              const campaigns = system.block(MarketingEmailCampaignBlock);
              const selectedIds = props.campaignId === undefined
                ? useSelectedIds(s)
                : undefined;
              const audience = selectedIds
                ? props.previewAudience?.(selectedIds) ??
                  campaigns.buildAudienceQuery(
                    sql`preview_campaign`,
                    selectedTestRecipients(campaigns, selectedIds),
                  )
                : campaigns.scheduledTestRecipientsQuery(sql`preview_campaign`);
              s.defTable(
                "test_contacts",
                sql`select source_recipient_key, email, from_address, reply_to, sender_error, recipient_href,
                  ${
                  campaigns.validSender(sql`audience`)
                } as valid from (${audience}) audience order by email`,
              );
              s.defScalar("test_to", sql.lit``);
              s.defScalar(
                "test_sample_key",
                sql`coalesce((select source_recipient_key from test_contacts limit 1), '')`,
              );
            }}
          >
            <div className="flex flex-col gap-4">
              <Typography level="title-lg">Send test email</Typography>
              <Typography level="body-sm">
                {props.campaignId !== undefined
                  ? "Uses the saved template and the scheduled recipient’s frozen sender and merge fields."
                  : "Uses the saved template and a selected contact’s current sender and merge fields."}
                {" "}
                Only the test addresses receive the email. Unsubscribe links are
                inactive in tests.
              </Typography>
              <label className="flex flex-col gap-1">
                <Typography level="title-sm">Test email addresses</Typography>
                <Input
                  type="email"
                  multiple
                  aria-label="Test email addresses"
                  bindScalar="test_to"
                />
                <Typography level="body-sm">
                  Separate up to 10 addresses with commas.
                </Typography>
              </label>
              <label className="flex flex-col gap-1">
                <Typography level="title-sm">Sample contact</Typography>
                <Select
                  aria-label="Sample contact"
                  value={sql`nullif(test_sample_key, '')`}
                  onChange={(s, value) => s.setScalar("test_sample_key", value)}
                >
                  <Each table="test_contacts" recordName="test_contact">
                    <Select.Option
                      value={sql`test_contact.source_recipient_key`}
                    >
                      {sql`test_contact.email || ' — ' || case when test_contact.valid
                        then 'From: ' || test_contact.from_address else 'Needs sender correction' end`}
                    </Select.Option>
                  </Each>
                </Select>
              </label>
              <Data
                local
                watch={[sql`test_sample_key`]}
                procedure={(s) => {
                  s.defRecord(
                    "sample_sender",
                    sql`select * from test_contacts where source_recipient_key = test_sample_key`,
                  );
                }}
              >
                <Show when={sql`sample_sender.valid`}>
                  <div
                    className="flex flex-col gap-1 break-words"
                    aria-label="Test sender"
                  >
                    <Typography level="body-sm">
                      {sql`'From: ' || sample_sender.from_address`}
                    </Typography>
                    <Typography level="body-sm">
                      {sql`'Reply-To: ' || coalesce(sample_sender.reply_to, sample_sender.from_address)`}
                    </Typography>
                  </div>
                </Show>
                <Show
                  when={sql`sample_sender.source_recipient_key is not null and not sample_sender.valid`}
                >
                  <Alert color="warning">
                    {sql`coalesce(sample_sender.sender_error, 'Sender unavailable or invalid. Review the contact owner.')`}
                  </Alert>
                  <Show when={sql`sample_sender.recipient_href is not null`}>
                    <Button
                      variant="plain"
                      size="sm"
                      href={sql`sample_sender.recipient_href`}
                    >
                      Review contact owner
                    </Button>
                  </Show>
                </Show>
              </Data>
              <Show when={sql`not exists(select 1 from test_contacts)`}>
                <Alert color="warning">
                  This campaign needs an eligible sample contact before you can
                  send a test.
                </Alert>
              </Show>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="plain"
                  color="neutral"
                  onClick={(s) => s.setScalar("test_open", false)}
                >
                  Cancel
                </Button>
                <ActionButton
                  startIcon="Send"
                  refetch={false}
                  errorDisplay="inline"
                  disabled={sql`trim(test_to) = '' or test_sample_key = ''
                    or not coalesce((select valid from test_contacts where source_recipient_key = test_sample_key), false)`}
                  successMessage="Test email submitted"
                  action={(s) => {
                    props.authorize(s);
                    const campaigns = system.block(MarketingEmailCampaignBlock);
                    const selectedIds = props.campaignId === undefined
                      ? useSelectedIds(s)
                      : undefined;
                    campaigns.sendTest(s, {
                      campaignId: props.campaignId,
                      templateId: props.templateId,
                      senderKey: props.senderKey,
                      to: sql`test_to`,
                      sampleRecipientKey: sql`test_sample_key`,
                      recipientsQuery: selectedIds
                        ? props.previewAudience?.(selectedIds) ??
                          selectedTestRecipients(campaigns, selectedIds)
                        : undefined,
                    });
                  }}
                >
                  Send test email
                </ActionButton>
              </div>
            </div>
          </Data>
        </ModalDialog>
      </Show>
    </Data>
  );
}

function CampaignActions(props: {
  campaignId: NumericExpr;
  status: AnyExpr;
  access: MarketingCampaignAccess;
}) {
  return (
    <div
      className="flex items-center gap-2"
      onClick={(s) => s.event.stopPropagation()}
    >
      <Show
        when={sql`${props.status} = 'scheduled' and campaign_can_manage`}
      >
        <CampaignTestButton
          campaignId={props.campaignId}
          authorize={props.access.authorize}
        />
        <ActionButton
          size="xs"
          variant="soft"
          color="warning"
          startIcon="EventBusy"
          successMessage="Campaign cancelled"
          confirm={{
            description:
              "Cancel this campaign? Its recipients and sender details will remain in the campaign history.",
            confirmText: "Cancel campaign",
          }}
          action={(s) => {
            props.access.authorize(s);
            s.startTransaction();
            system.block(MarketingEmailCampaignBlock).cancel(
              s,
              props.campaignId,
            );
            s.commitTransaction();
          }}
        >
          Cancel campaign
        </ActionButton>
      </Show>
    </div>
  );
}

/** Campaign history with authorized cancellation. */
export function CampaignsPage(props: MarketingCampaignsPageProps) {
  return (
    <DatagridPage
      table="marketing_email_campaigns"
      datagridName="marketing_email_campaigns"
      path={props.paths.campaigns}
      title="Email Campaigns"
      canEdit={false}
      additionalWhere={props.access.canView}
      wrapper={(children) => (
        <CampaignAccessBoundary access={props.access}>
          {children}
        </CampaignAccessBoundary>
      )}
      columns={(b) => {
        b.addField("name", { initialWidth: 280 });
        b.addField("status", {
          initialWidth: 130,
          cell: ({ helper }) => <CampaignStatusChip status={helper.value} />,
        });
        b.addFkField("email_template_id", "name", {
          displayName: "Template",
          initiallyDisplaying: true,
          filter: true,
          sort: true,
        });
        b.addField("scheduled_at", {});
        b.virtualColumn({
          storageName: "sender",
          displayName: "Sender",
          initiallyDisplaying: true,
          initialWidth: 300,
          expr: system.block(MarketingEmailCampaignBlock).senderLabel(
            sql`record`,
            props.senderLabel,
          ),
          valueType: { type: "string", notNull: true },
        });
        b.addField("error", { initialWidth: 320 });
        b.virtualColumn({
          storageName: "campaign_actions",
          displayName: "Actions",
          initiallyDisplaying: true,
          expr: sql`record.status::string`,
          valueType: { type: "string", notNull: true },
          disableSort: true,
          initialWidth: 230,
          pin: "right",
          cell: ({ helper }) => (
            <CampaignActions
              campaignId={helper.recordId}
              status={helper.value}
              access={props.access}
            />
          ),
        });
      }}
      toolbarRight={
        <>
          <Show when={sql`campaign_can_manage`}>
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startIcon="Description"
              href={props.paths.templates}
            >
              Manage Templates
            </Button>
          </Show>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            startIcon="Assessment"
            href={props.paths.results}
          >
            Delivery Results
          </Button>
          <Show when={sql`campaign_can_manage`}>
            <Button
              size="sm"
              variant="soft"
              startIcon="Campaign"
              href={props.paths.recipients}
            >
              Send to Contacts
            </Button>
          </Show>
        </>
      }
    />
  );
}

/** Aggregate outcomes for the campaign, including every provider batch. */
export function CampaignDeliveryReport() {
  return (
    <DataTable
      header={<Typography level="title-md">Campaign totals</Typography>}
      primaryTable="marketing_email_campaigns"
      query={system.block(MarketingEmailCampaignBlock).summaryQuery()}
      columns={(b) => {
        b.field("name");
        b.field("status");
        b.simpleColumn("batch_count", "Batches");
        b.simpleColumn("recipient_count", "Recipients");
        b.simpleColumn("submitted_count", "Submitted");
        b.simpleColumn("delivered_count", "Delivered");
        if (
          system.block(MarketingEmailCampaignBlock).opts.delivery.opts
            .engagementTracking !== false
        ) {
          b.simpleColumn("opened_count", "Opened");
          b.simpleColumn("clicked_count", "Clicked");
        }
        b.simpleColumn("hard_bounced_count", "Hard bounced");
        b.simpleColumn("excluded_count", "Excluded");
        b.simpleColumn("failed_count", "Failed");
        b.simpleColumn("send_unknown_count", "Uncertain");
        b.field("error");
      }}
      pageSize={25}
      emptyState="No campaigns yet"
    />
  );
}

/** Platform delivery results with optional companion delivery panels. */
export function DeliveryResultsPage(
  props: MarketingCampaignDeliveryResultsPageProps,
) {
  return (
    <Route path={props.path} title={props.title}>
      <CampaignAccessBoundary access={props.access}>
        <div className="p-4 sm:p-6 flex flex-col gap-6">
          <PageHeader>
            <PageHeader.Column>
              <Typography level="h3">{props.title}</Typography>
              <Typography level="body-sm" sx={{ color: "text.secondary" }}>
                {props.description}
              </Typography>
            </PageHeader.Column>
          </PageHeader>
          <Show when={sql`campaign_can_manage`}>
            <BulkEmailReconciliation authorize={props.access.authorize} />
          </Show>
          <CampaignDeliveryReport />
          <BulkEmailDeliveryReport />
          {props.children}
        </div>
      </CampaignAccessBoundary>
    </Route>
  );
}
