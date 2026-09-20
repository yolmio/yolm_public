import { DataTable } from "components/data_table";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { ModalDialog } from "components/modal";
import { StatRow } from "components/stat_row";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { Data } from "std/data";
import { system } from "std/system";
import { BulkEmailDeliveryBlock } from "./index";
import { Show, useState } from "std/ui";

/**
 * Route-free reporting for platform bulk-email deliveries. Systems can place
 * this component inside their own page, permissions, and navigation wrapper.
 */
export function BulkEmailDeliveryReport() {
  const engagementTracking =
    system.block(BulkEmailDeliveryBlock).opts.engagementTracking !== false;
  useState((s) => {
    s.defScalar("bulk_report_delivery_id", { type: "BigInt" });
  });
  return (
    <div className="flex flex-col gap-6">
      <Data
        procedure={(s) =>
          s.defScalar(
            "overdue_bulk_queue",
            sql`exists (select 1 from bulk_email_deliveries
        where status = 'prepared' and created_at < date.add(minute, -15, now())
          and (next_attempt_at is null or next_attempt_at <= now()))`,
          )}
      >
        <Show when={sql`overdue_bulk_queue`}>
          <Alert color="warning">
            A delivery has been queued for more than 15 minutes. Check the bulk
            delivery worker and any active submission before preparing a
            replacement.
          </Alert>
        </Show>
      </Data>
      <StatRow
        header="Bulk email delivery"
        stats={[
          {
            title: "Queued deliveries",
            value:
              sql`(select count(*) from bulk_email_deliveries where status = 'prepared')`,
          },
          {
            title: "Submitted recipients",
            value:
              sql`(select count(*) from bulk_email_delivery_recipients where status = 'submitted')`,
          },
          {
            title: "Delivered recipients",
            value:
              sql`(select count(*) from bulk_email_delivery_recipients where delivered_at is not null)`,
          },
          {
            title: "Failed or uncertain",
            value:
              sql`(select count(*) from bulk_email_delivery_recipients where status in ('failed', 'send_unknown'))`,
          },
        ]}
      />
      <DataTable
        header={
          <Typography level="title-md" sx={{ p: 1 }}>
            Bulk delivery history
          </Typography>
        }
        query={sql`
          select
            delivery.id,
            delivery.source,
            delivery.source_record_key,
            delivery.provider,
            delivery.provider_bulk_id,
            delivery.from_email,
            delivery.status,
            delivery.error,
            delivery.created_at,
            delivery.completed_at,
            count(recipient.id) as recipient_count,
            count(case when recipient.status = 'submitted' then 1 end) as submitted_count,
            count(case when recipient.status = 'excluded' then 1 end) as excluded_count,
            count(case when recipient.status = 'failed' then 1 end) as failed_count,
            count(case when recipient.status = 'send_unknown' then 1 end) as send_unknown_count,
            count(case when recipient.delivered_at is not null then 1 end) as delivered_count,
            ${
          engagementTracking
            ? sql`
              count(case when recipient.first_opened_at is not null then 1 end) as opened_count,
              count(case when recipient.first_clicked_at is not null then 1 end) as clicked_count,
            `
            : sql``
        }
            count(case when recipient.hard_bounced_at is not null then 1 end) as hard_bounced_count,
            count(case when recipient.complained_at is not null then 1 end) as complained_count
          from bulk_email_deliveries delivery
          left join bulk_email_delivery_recipients recipient
            on recipient.delivery_id = delivery.id
          group by
            delivery.id,
            delivery.source,
            delivery.source_record_key,
            delivery.provider,
            delivery.provider_bulk_id,
            delivery.from_email,
            delivery.status,
            delivery.error,
            delivery.created_at,
            delivery.completed_at
          order by delivery.id desc
        `}
        primaryTable="bulk_email_deliveries"
        columns={(b) => {
          b.column("Details", ({ record }) => (
            <Button
              size="sm"
              variant="plain"
              onClick={(s) =>
                s.setScalar("bulk_report_delivery_id", sql`${record}.id`)}
            >
              View recipients
            </Button>
          ));
          b.field("source");
          b.field("source_record_key");
          b.field("provider");
          b.simpleColumn("provider_bulk_id", "Provider ID");
          b.field("from_email");
          b.field("status");
          b.simpleColumn("error", "Error");
          b.simpleColumn("recipient_count", "Recipients");
          b.simpleColumn("submitted_count", "Submitted");
          b.simpleColumn("excluded_count", "Excluded");
          b.simpleColumn("failed_count", "Failed");
          b.simpleColumn("send_unknown_count", "Unknown");
          b.simpleColumn("delivered_count", "Delivered");
          if (engagementTracking) {
            b.simpleColumn("opened_count", "Opened");
            b.simpleColumn("clicked_count", "Clicked");
          }
          b.simpleColumn("hard_bounced_count", "Hard bounced");
          b.simpleColumn("complained_count", "Complained");
          b.field("created_at");
          b.field("completed_at");
        }}
        searchable={["source_record_key", "from_email"]}
        pageSize={25}
        variant="outlined"
        emptyState="No bulk deliveries yet"
        minColumnWidth={120}
      />
      <ModalDialog
        open={sql`bulk_report_delivery_id is not null`}
        onClose={(s) => s.setScalar("bulk_report_delivery_id", sql`null`)}
        maxWidth="xl"
      >
        <Typography level="h3">
          {sql`'Recipients for bulk delivery ' || bulk_report_delivery_id::string`}
        </Typography>
        <Alert color="neutral">
          Filter Status to Failed to find recipients recorded as not sent.
          Review their errors and current contact eligibility before preparing a
          new campaign. Reconcile unknown outcomes first; do not resend to
          submitted or excluded recipients.
        </Alert>
        <DataTable
          query={sql`select id, delivery_id, source_recipient_key, email,
              status, error, submitted_at, delivered_at, first_bounced_at,
              hard_bounced_at, complained_at, unsubscribed_at
            from bulk_email_delivery_recipients
            where delivery_id = bulk_report_delivery_id
            order by id`}
          primaryTable="bulk_email_delivery_recipients"
          columns={(b) => {
            b.field("email");
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
            b.field("submitted_at");
            b.field("delivered_at");
            b.field("first_bounced_at");
            b.field("hard_bounced_at");
            b.field("complained_at");
            b.field("unsubscribed_at");
          }}
          searchable={["email", "source_recipient_key", "error"]}
          filterable
          sortable
          pageSize={25}
          download={{
            fileName: "bulk-delivery-recipients.csv",
            label: "Download recipients",
          }}
          emptyState="No recipients match this delivery and its filters"
          minColumnWidth={140}
        />
        <Button
          variant="plain"
          onClick={(s) => s.setScalar("bulk_report_delivery_id", sql`null`)}
        >
          Close
        </Button>
      </ModalDialog>
    </div>
  );
}
