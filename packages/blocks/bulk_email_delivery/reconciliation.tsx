import { Chip } from "components/chip";
import { Input } from "components/input";
import { Select } from "components/select";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import { BulkEmailDeliveryBlock } from "./index";

/** An explicitly authorized operator resolves one uncertain recipient at a time. */
export function BulkEmailReconciliation(props: {
  deliveryId?: Sql;
  authorize: (s: UiServerStatements) => void;
}) {
  return (
    <Data
      local
      noRefetch
      procedure={(s) => s.defScalar("reconciliation_saved", false)}
    >
      <Show when={sql`reconciliation_saved`}>
        <Snackbar
          color="success"
          variant="soft"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          onMount={(s) => {
            s.sleep(3500);
            s.setScalar("reconciliation_saved", false);
          }}
        >
          Recipient outcome reconciled; no email was sent
        </Snackbar>
      </Show>
      <Data
        procedure={(s) => {
          s.defTable(
            "unresolved_bulk_recipients",
            sql`select recipient.id,
        recipient.email, recipient.delivery_id
        from bulk_email_delivery_recipients recipient
        join bulk_email_deliveries delivery on delivery.id = recipient.delivery_id
        where recipient.status = 'send_unknown' and delivery.status = 'failed'
          ${
              props.deliveryId
                ? sql`and delivery.id = ${props.deliveryId}`
                : sql``
            }
        order by recipient.id desc limit 100`,
          );
          s.defScalar("reconcile_recipient", sql.lit``);
          s.defScalar("reconcile_evidence", sql.lit``);
        }}
      >
        <Show when={sql`exists (select 1 from unresolved_bulk_recipients)`}>
          <section
            className="flex flex-col gap-4 p-4"
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "md",
            }}
          >
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Typography level="title-md" startIcon="FactCheck">
                  Reconcile uncertain recipients
                </Typography>
                <Chip size="sm" variant="soft" color="warning">
                  {sql`case
                    when (select count(*) from unresolved_bulk_recipients) >= 100
                      then '100+'
                    else (select count(*) from unresolved_bulk_recipients)::string
                  end || ' awaiting evidence'`}
                </Chip>
              </div>
              <Typography level="body-sm" sx={{ color: "text.secondary" }}>
                Reconcile uncertain recipients using provider evidence. Missing
                webhooks do not prove that a message was not sent. This records
                the outcome without sending email; the original failed attempt
                remains visible. For partial failures, prepare a new campaign
                only for recipients proven not sent.
              </Typography>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 min-w-0">
                <Typography level="title-sm">Uncertain recipient</Typography>
                <Select
                  aria-label="Uncertain recipient"
                  value={sql`nullif(reconcile_recipient, '')`}
                  placeholder="Choose an uncertain recipient"
                  onChange={(s) =>
                    s.setScalar("reconcile_recipient", sql`target_value`)}
                  fullWidth
                >
                  <Each
                    table="unresolved_bulk_recipients"
                    recordName="unresolved_recipient"
                  >
                    <Select.Option value={sql`unresolved_recipient.id::string`}>
                      {sql`unresolved_recipient.email || ' (delivery ' || unresolved_recipient.delivery_id::string || ')'`}
                    </Select.Option>
                  </Each>
                </Select>
              </label>
              <label className="flex flex-col gap-1 min-w-0">
                <Typography level="title-sm">Provider evidence</Typography>
                <Input
                  aria-label="Provider evidence"
                  bindScalar="reconcile_evidence"
                  placeholder="Provider message ID or support reference and confirmed outcome"
                  fullWidth
                />
                <Typography level="body-xs" sx={{ color: "text.secondary" }}>
                  Enter at least 10 characters to record an outcome.
                </Typography>
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {(["not_sent", "submitted"] as const).map((outcome) => (
                <ActionButton
                  size="sm"
                  variant={outcome === "submitted" ? "solid" : "outlined"}
                  color={outcome === "submitted" ? "primary" : "warning"}
                  disabled={sql`reconcile_recipient = '' or length(trim(reconcile_evidence)) < 10`}
                  confirm={{
                    description: outcome === "submitted"
                      ? "Confirm that provider evidence establishes this recipient was sent the message?"
                      : "Confirm that the provider explicitly established this recipient was never sent the message? Missing events alone are insufficient.",
                    confirmText: "Record reconciliation",
                  }}
                  afterSuccessClient={(s) =>
                    s.setScalar("reconciliation_saved", true)}
                  errorDisplay="inline"
                  action={(s) => {
                    s.startTransaction();
                    props.authorize(s);
                    s.defScalar(
                      "reconcile_delivery_id",
                      sql`(select delivery_id
                    from bulk_email_delivery_recipients
                    where id = try_cast(ui.reconcile_recipient as bigint)
                      ${
                        props.deliveryId
                          ? sql`and delivery_id = ${props.deliveryId}`
                          : sql``
                      })`,
                    );
                    system.block(BulkEmailDeliveryBlock).reconcileRecipient(s, {
                      deliveryId: sql`reconcile_delivery_id`,
                      recipientId:
                        sql`try_cast(ui.reconcile_recipient as bigint)`,
                      outcome,
                      evidence: sql`ui.reconcile_evidence`,
                    });
                    s.commitTransaction();
                  }}
                >
                  {outcome === "submitted"
                    ? "Confirm sent"
                    : "Confirm not sent"}
                </ActionButton>
              ))}
            </div>
          </section>
        </Show>
      </Data>
    </Data>
  );
}
