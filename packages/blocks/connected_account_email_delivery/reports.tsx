import { DataTable } from "components/data_table";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { ModalDialog } from "components/modal";
import { StatRow } from "components/stat_row";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { useState } from "std/ui";

/**
 * Route-free reporting for deliveries sent through connected email accounts.
 * Systems can place this component inside their own page, permissions, and
 * navigation wrapper.
 */
export function ConnectedAccountEmailDeliveryReport() {
  useState((s) => {
    s.defScalar("connected_report_delivery_id", { type: "BigInt" });
  });
  return (
    <div className="flex flex-col gap-6">
      <StatRow
        header="Connected-account delivery"
        stats={[
          {
            title: "Deliveries",
            value:
              sql`(select count(*) from connected_account_email_deliveries)`,
          },
          {
            title: "Sent recipients",
            value:
              sql`(select count(*) from connected_account_email_recipient_outbox where status = 'sent')`,
          },
          {
            title: "Rate limited",
            value:
              sql`(select count(*) from connected_account_email_recipient_outbox where status = 'rate_limited')`,
          },
          {
            title: "Failed or uncertain",
            value:
              sql`(select count(*) from connected_account_email_recipient_outbox where status in ('failed', 'send_unknown'))`,
          },
        ]}
      />
      <DataTable
        header={
          <Typography level="title-md" sx={{ p: 1 }}>
            Connected-account delivery history
          </Typography>
        }
        query={sql`
          select
            delivery.id,
            delivery.source,
            delivery.source_record_key,
            delivery.integration_key,
            delivery.from_email,
            delivery.status,
            delivery.created_at,
            delivery.completed_at,
            count(recipient.id) as recipient_count,
            count(case when recipient.status = 'pending' then 1 end) as pending_count,
            count(case when recipient.status = 'rate_limited' then 1 end) as rate_limited_count,
            count(case when recipient.status = 'sending' then 1 end) as sending_count,
            count(case when recipient.status = 'sent' then 1 end) as sent_count,
            count(case when recipient.status = 'failed' then 1 end) as failed_count,
            count(case when recipient.status = 'send_unknown' then 1 end) as send_unknown_count
          from connected_account_email_deliveries delivery
          left join connected_account_email_recipient_outbox recipient
            on recipient.delivery_id = delivery.id
          group by
            delivery.id,
            delivery.source,
            delivery.source_record_key,
            delivery.integration_key,
            delivery.from_email,
            delivery.status,
            delivery.created_at,
            delivery.completed_at
          order by delivery.id desc
        `}
        primaryTable="connected_account_email_deliveries"
        columns={(b) => {
          b.column("Details", ({ record }) => (
            <Button
              size="sm"
              variant="plain"
              onClick={(s) =>
                s.setScalar("connected_report_delivery_id", sql`${record}.id`)}
            >
              View recipients
            </Button>
          ));
          b.field("source");
          b.field("source_record_key");
          b.field("integration_key");
          b.field("from_email");
          b.field("status");
          b.simpleColumn("recipient_count", "Recipients");
          b.simpleColumn("pending_count", "Pending");
          b.simpleColumn("rate_limited_count", "Rate limited");
          b.simpleColumn("sending_count", "Sending");
          b.simpleColumn("sent_count", "Sent");
          b.simpleColumn("failed_count", "Failed");
          b.simpleColumn("send_unknown_count", "Unknown");
          b.field("created_at");
          b.field("completed_at");
        }}
        searchable={["source_record_key", "from_email"]}
        pageSize={25}
        variant="outlined"
        emptyState="No connected-account deliveries yet"
        minColumnWidth={120}
      />
      <ModalDialog
        open={sql`connected_report_delivery_id is not null`}
        onClose={(s) => s.setScalar("connected_report_delivery_id", sql`null`)}
        maxWidth="xl"
      >
        <Typography level="h3">
          {sql`'Recipients for connected-account delivery ' || connected_report_delivery_id::string`}
        </Typography>
        <Alert color="neutral">
          Failed recipients were not sent. Check the error and current contact
          eligibility before preparing a new message. Unknown outcomes need
          provider confirmation; pending, rate-limited, and sending recipients
          are still queued or in progress.
        </Alert>
        <DataTable
          query={sql`select id, delivery_id, source_recipient_key,
              recipient_email, status, error, attempted_at, completed_at
            from connected_account_email_recipient_outbox
            where delivery_id = connected_report_delivery_id
            order by id`}
          primaryTable="connected_account_email_recipient_outbox"
          columns={(b) => {
            b.field("recipient_email", "Email");
            b.field("source_recipient_key", "Source recipient");
            b.field("status");
            b.column(
              "Error / reconciliation evidence",
              ({ record }) => (
                <div sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {sql`${record}.error`}
                </div>
              ),
              { field: "error", fieldType: "String", width: 320 },
            );
            b.field("attempted_at");
            b.field("completed_at");
          }}
          searchable={["recipient_email", "source_recipient_key", "error"]}
          filterable
          sortable
          pageSize={25}
          download={{
            fileName: "connected-delivery-recipients.csv",
            label: "Download recipients",
          }}
          emptyState="No recipients match this delivery and its filters"
          minColumnWidth={140}
        />
        <Button
          variant="plain"
          onClick={(s) =>
            s.setScalar("connected_report_delivery_id", sql`null`)}
        >
          Close
        </Button>
      </ModalDialog>
    </div>
  );
}
