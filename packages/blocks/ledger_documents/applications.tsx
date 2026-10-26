import { formatDateSql, manageAction } from "blocks/ledger";
import { Card } from "components/card";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { Table } from "components/table";
import { TableRecordSelect } from "components/table_record_select";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { DOCUMENT_KINDS, PAYMENT_KINDS } from "./index.tsx";
import type { LedgerDocumentsBlock } from "./index.tsx";

/** Label of a document or payment kind stored as a string. */
export function kindLabelSql(kind: Sql): Sql {
  return sql.caseWhen({
    conditions: [...DOCUMENT_KINDS, ...PAYMENT_KINDS].map((k) => ({
      condition: sql`${kind} = ${sql.lit(k.name)}`,
      expr: sql.lit(k.displayName),
    })),
    default: kind,
  });
}

/** Name of a document's or payment's customer or vendor. */
export function partyLabel(docs: LedgerDocumentsBlock, doc: string): Sql {
  // Party tables are expected to have a `name` column.
  const customer = sql`(select party.name from db.${
    sql.ref(docs.customers.table)
  } party
    where party.id = ${sql.ref(doc)}.customer_id)`;
  if (!docs.vendors) return sql`coalesce(${customer}, '')`;
  const vendor = sql`(select party.name from db.${
    sql.ref(docs.vendors.table)
  } party
    where party.id = ${sql.ref(doc)}.vendor_id)`;
  return sql`coalesce(${customer}, ${vendor}, '')`;
}

const amountText = (text: Sql) =>
  sql`try_cast(replace(${text}, ',', '') as decimal(18, 4))`;

/** Link target and label of a document or payment id pair. */
function counterpart(docs: LedgerDocumentsBlock, row: string) {
  const r = sql.ref(row);
  return {
    href: sql`case when ${r}.document_id is not null
      then ${sql.lit(`${docs.basePath}/`)} || ${r}.document_id
      else ${sql.lit(`${docs.basePath}/payments/`)} || ${r}.payment_id end`,
  };
}

/**
 * What was applied to (or from) a posted document or payment, each with
 * Unapply. `entryId` is the posted entry of the page's record.
 */
export function AppliedList(
  props: { docs: LedgerDocumentsBlock; name: string; entryId: Sql },
) {
  const { docs } = props;
  const table = `${props.name}_applied`;
  const row = `${props.name}_applied_row`;
  const r = sql.ref(row);
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          table,
          sql`select applied.document_id, applied.payment_id,
              applied.entry_id, applied.amount, applied.settled_on,
              coalesce(
                (select cast(kind as string) from db.ledger_documents
                  where id = applied.document_id),
                (select cast(kind as string) from db.ledger_payments
                  where id = applied.payment_id)) as kind,
              coalesce(
                (select number from db.ledger_documents
                  where id = applied.document_id),
                (select number from db.ledger_payments
                  where id = applied.payment_id), '') as number
            from (${docs.applicationsQuery(props.entryId)}) applied
            order by applied.settled_on`,
        )}
    >
      <Show when={sql`exists (select 1 from ${sql.ref(table)})`}>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <div className="p-4">
            <Typography level="title-md">Applied</Typography>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Applied with</th>
                <th>No.</th>
                <th>
                  <div className="text-right">Amount</div>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              <Each table={table} recordName={row}>
                <tr>
                  <td>{formatDateSql(sql`${r}.settled_on`)}</td>
                  <td>
                    <a
                      href={counterpart(docs, row).href}
                      className="text-primary-600 hover:underline"
                    >
                      {kindLabelSql(sql`${r}.kind`)}
                    </a>
                  </td>
                  <td>{sql`${r}.number`}</td>
                  <td className="text-right tabular-nums">
                    {docs.ledger.formatAmountSql(sql`abs(${r}.amount)`)}
                  </td>
                  <td className="text-right">
                    <Show when={sql`ledger_can_manage`}>
                      <ActionButton
                        size="sm"
                        variant="plain"
                        confirm={{
                          description:
                            "Unapplying reopens both sides as of today.",
                        }}
                        action={manageAction(docs.ledger, (s) =>
                          docs.actions.unapply(s, {
                            entryId: props.entryId,
                            otherEntryId: sql`${r}.entry_id`,
                            // Not before the application it takes back.
                            date: sql`greatest(current_date(),
                              ${r}.settled_on)`,
                          }))}
                        successMessage="Unapplied"
                      >
                        Unapply
                      </ActionButton>
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Show>
    </Data>
  );
}

/**
 * Open credits of the invoice's customer (or the bill's vendor) with an
 * amount to apply to this document.
 */
export function CreditsToApply(
  props: {
    docs: LedgerDocumentsBlock;
    documentId: Sql;
    customer: boolean;
  },
) {
  const { docs } = props;
  const party = props.customer ? "customer_id" : "vendor_id";
  const partyId = sql`(select ${sql.ref(party)} from db.ledger_documents
    where id = ${props.documentId})`;
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          "credits_to_apply",
          sql`select row_number() over (order by credit_date) as row_id,
              document_id, payment_id, entry_id, kind, number, credit_date,
              open,
              cast(least(open, ${
            docs.openBalanceSql(props.documentId)
          }) as string) as apply_text
            from (${
            docs.openCreditsQuery(
              props.customer ? { customerId: partyId } : { vendorId: partyId },
            )
          }) credit`,
        )}
    >
      <Show when={sql`exists (select 1 from credits_to_apply)`}>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <div className="p-4">
            <Typography level="title-md">Credits available</Typography>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Credit</th>
                <th>No.</th>
                <th>
                  <div className="text-right">Open</div>
                </th>
                <th className="w-[160px]">Apply</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <Each table="credits_to_apply" recordName="credit_row">
                <tr>
                  <td>{formatDateSql(sql`credit_row.credit_date`)}</td>
                  <td>
                    <a
                      href={counterpart(docs, "credit_row").href}
                      className="text-primary-600 hover:underline"
                    >
                      {kindLabelSql(sql`credit_row.kind`)}
                    </a>
                  </td>
                  <td>{sql`coalesce(credit_row.number, '')`}</td>
                  <td className="text-right tabular-nums">
                    {docs.ledger.formatAmountSql(sql`credit_row.open`)}
                  </td>
                  <td>
                    <Input
                      size="sm"
                      aria-label="Amount to apply"
                      value={sql`credit_row.apply_text`}
                      onInput={(s, value) =>
                        s.modify(sql`update credits_to_apply
                          set apply_text = ${value}
                          where row_id = credit_row.row_id`)}
                    />
                  </td>
                  <td className="text-right">
                    <ActionButton
                      size="sm"
                      variant="outlined"
                      action={manageAction(docs.ledger, (s) =>
                        docs.actions.applyEntry(s, {
                          fromEntryId: sql`credit_row.entry_id`,
                          documentId: props.documentId,
                          amount: amountText(sql`credit_row.apply_text`),
                          date: sql`current_date()`,
                        }))}
                      successMessage="Applied"
                    >
                      Apply
                    </ActionButton>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Show>
    </Data>
  );
}

/**
 * Open invoices (for a customer credit) or bills (for a vendor credit) of
 * the party, with an amount to apply from `fromEntryId`.
 */
export function ApplyToDocuments(
  props: {
    docs: LedgerDocumentsBlock;
    fromEntryId: Sql;
    customer: boolean;
    partyId: Sql;
    available: Sql;
  },
) {
  const { docs } = props;
  const party = props.customer ? sql`customer_id` : sql`vendor_id`;
  const kind = props.customer ? sql.lit`invoice` : sql.lit`bill`;
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          "documents_to_pay",
          sql`select doc.id, doc.number, doc.document_date,
              ${docs.dueDateSql(sql`doc.id`)} as due_date,
              ${docs.openBalanceSql(sql`doc.id`)} as open,
              cast(least(${docs.openBalanceSql(sql`doc.id`)},
                ${props.available}) as string) as apply_text
            from db.ledger_documents doc
            where doc.${party} = ${props.partyId}
              and cast(doc.kind as string) = ${kind}
              and ${docs.openBalanceSql(sql`doc.id`)} > 0
            order by doc.document_date, doc.id`,
        )}
    >
      <Show when={sql`exists (select 1 from documents_to_pay)`}>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <div className="p-4">
            <Typography level="title-md">
              {props.customer ? "Apply to invoices" : "Apply to bills"}
            </Typography>
          </div>
          <Table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Due</th>
                <th>
                  <div className="text-right">Open</div>
                </th>
                <th className="w-[160px]">Apply</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <Each table="documents_to_pay" recordName="to_pay">
                <tr>
                  <td>
                    <a
                      href={sql`${sql.lit(`${docs.basePath}/`)} || to_pay.id`}
                      className="text-primary-600 hover:underline"
                    >
                      {sql`coalesce(to_pay.number, 'No number')`}
                    </a>
                  </td>
                  <td>{formatDateSql(sql`to_pay.document_date`)}</td>
                  <td>
                    {sql`coalesce(${formatDateSql(sql`to_pay.due_date`)}, '')`}
                  </td>
                  <td className="text-right tabular-nums">
                    {docs.ledger.formatAmountSql(sql`to_pay.open`)}
                  </td>
                  <td>
                    <Input
                      size="sm"
                      aria-label="Amount to apply"
                      value={sql`to_pay.apply_text`}
                      onInput={(s, value) =>
                        s.modify(sql`update documents_to_pay
                          set apply_text = ${value} where id = to_pay.id`)}
                    />
                  </td>
                  <td className="text-right">
                    <ActionButton
                      size="sm"
                      variant="outlined"
                      action={manageAction(docs.ledger, (s) =>
                        docs.actions.applyEntry(s, {
                          fromEntryId: props.fromEntryId,
                          documentId: sql`to_pay.id`,
                          amount: amountText(sql`to_pay.apply_text`),
                          date: sql`current_date()`,
                        }))}
                      successMessage="Applied"
                    >
                      Apply
                    </ActionButton>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Show>
    </Data>
  );
}

/** Writes off an invoice's or bill's open balance to a chosen account. */
export function WriteOffCard(
  props: { docs: LedgerDocumentsBlock; documentId: Sql; customer: boolean },
) {
  const { docs } = props;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("write_off_account_id", { type: "BigInt" });
        s.defScalar("write_off_text", sql.lit``);
      }}
    >
      <Card variant="outlined" className="p-4 flex flex-wrap items-end gap-3">
        <Typography level="title-md" className="w-full">
          Write off the balance
        </Typography>
        <FormControl className="min-w-[240px]">
          <FormLabel>
            {props.customer
              ? "To account (e.g. bad debt or discounts)"
              : "To account"}
          </FormLabel>
          <TableRecordSelect
            tableName="ledger_accounts"
            where={sql`is_active`}
            value={sql`write_off_account_id`}
            onSelectValue={(s, value) =>
              s.setScalar("write_off_account_id", value)}
          />
        </FormControl>
        <FormControl>
          <FormLabel>Amount (default: all that is open)</FormLabel>
          <Input
            size="sm"
            value={sql`write_off_text`}
            onInput={(s, value) => s.setScalar("write_off_text", value)}
          />
        </FormControl>
        <ActionButton
          size="sm"
          variant="outlined"
          action={(s) => {
            s.throwErrorIf(
              sql`write_off_account_id is null`,
              sql.lit`Choose the account to write off to`,
            );
            s.defScalar("written_off_id", { type: "BigInt" });
            manageAction(docs.ledger, (s) =>
              docs.actions.writeOff(s, {
                documentId: props.documentId,
                accountId: sql`write_off_account_id`,
                date: sql`current_date()`,
                amount: sql`coalesce(${amountText(sql`write_off_text`)},
                  ${docs.openBalanceSql(props.documentId)})`,
                intoPaymentId: "written_off_id",
              }))(s);
          }}
          successMessage="Written off"
        >
          Write off
        </ActionButton>
      </Card>
    </Data>
  );
}

/** Pays back an open credit from a bank or card account. */
export function RefundCard(
  props: {
    docs: LedgerDocumentsBlock;
    customer: boolean;
    partyId: Sql;
    fromEntryId: Sql;
    open: Sql;
  },
) {
  const { docs } = props;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("refund_account_id", { type: "BigInt" });
        s.defScalar("refund_text", sql.lit``);
        s.defScalar("refund_date", {
          type: "Date",
          expr: sql`current_date()`,
        });
      }}
    >
      <Card variant="outlined" className="p-4 flex flex-wrap items-end gap-3">
        <Typography level="title-md" className="w-full">
          {props.customer ? "Refund the customer" : "Record a vendor refund"}
        </Typography>
        <FormControl className="min-w-[240px]">
          <FormLabel>{props.customer ? "Paid from" : "Deposited to"}</FormLabel>
          <TableRecordSelect
            tableName="ledger_accounts"
            where={sql`type in (cast('bank' as enums.ledger_account_type),
              cast('credit_card' as enums.ledger_account_type))`}
            value={sql`refund_account_id`}
            onSelectValue={(s, value) =>
              s.setScalar("refund_account_id", value)}
          />
        </FormControl>
        <FormControl>
          <FormLabel>Date</FormLabel>
          <Input
            size="sm"
            type="date"
            value={sql`refund_date`}
            onInput={(s, value) =>
              s.setScalar("refund_date", sql`try_cast(${value} as date)`)}
          />
        </FormControl>
        <FormControl>
          <FormLabel>Amount (default: all that is open)</FormLabel>
          <Input
            size="sm"
            value={sql`refund_text`}
            onInput={(s, value) => s.setScalar("refund_text", value)}
          />
        </FormControl>
        <ActionButton
          size="sm"
          variant="outlined"
          action={(s) => {
            s.throwErrorIf(
              sql`refund_account_id is null`,
              sql.lit`Choose the bank or card account`,
            );
            s.defScalar("refunded_id", { type: "BigInt" });
            manageAction(docs.ledger, (s) =>
              docs.actions.refund(s, {
                kind: props.customer ? "customer_refund" : "vendor_refund",
                partyId: props.partyId,
                fromEntryId: props.fromEntryId,
                accountId: sql`refund_account_id`,
                date: sql`refund_date`,
                amount: sql`coalesce(${amountText(sql`refund_text`)},
                  ${props.open})`,
                intoPaymentId: "refunded_id",
              }))(s);
            s.navigate(
              sql`${sql.lit(`${docs.basePath}/payments/`)} || refunded_id`,
            );
          }}
        >
          Refund
        </ActionButton>
      </Card>
    </Data>
  );
}
