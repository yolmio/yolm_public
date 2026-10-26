import {
  dimensionLabel,
  formatDateSql as date,
  LedgerPage,
  manageAction,
  VoidControl,
} from "blocks/ledger";
import type { LedgerNavItem } from "blocks/ledger";
import { AutoInsertButton } from "components/auto_insert_dialog";
import { AutoUpdateDialog } from "components/auto_update_dialog";
import { Button } from "components/button";
import { Card } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { Select } from "components/select";
import { Table } from "components/table";
import { TableRecordSelect } from "components/table_record_select";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Form, useCurrentTableHelper } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Route, Show } from "std/ui";
import {
  AppliedList,
  ApplyToDocuments,
  CreditsToApply,
  kindLabelSql,
  partyLabel,
  RefundCard,
  WriteOffCard,
} from "./applications.tsx";
import type { LedgerDocumentsBlock } from "./index.tsx";
import { InvoicePrintPage, SalesTaxReport, StatementPage } from "./print.tsx";

interface Ctx {
  docs: LedgerDocumentsBlock;
  base: string;
}

const kindLabel = (expr: Sql) => kindLabelSql(sql`cast(${expr} as string)`);

export function documentsNavItems(
  docs: LedgerDocumentsBlock,
): LedgerNavItem[] {
  const base = docs.basePath;
  const items: LedgerNavItem[] = [
    { label: "Documents", href: base, icon: "Description" },
    {
      label: "Receive payment",
      href: `${base}/receive-payment`,
      icon: "Payments",
    },
  ];
  if (docs.vendors) {
    items.push({
      label: "Pay bills",
      href: `${base}/pay-bills`,
      icon: "Outbox",
    });
  }
  items.push(
    {
      label: "Deposits",
      href: `${base}/deposit`,
      icon: "AccountBalanceWallet",
    },
    {
      label: "Customer statements",
      href: `${base}/statement`,
      icon: "ReceiptLong",
    },
    { label: "Payment terms", href: `${base}/terms`, icon: "EventNote" },
  );
  if (docs.salesTax) {
    items.push({
      label: "Sales tax",
      href: `${base}/sales-tax`,
      icon: "Percent",
    });
  }
  return items;
}

/** Every document page, mounted under the block's `basePath`. */
export function LedgerDocumentsRoutes(props: { docs: LedgerDocumentsBlock }) {
  const ctx = { docs: props.docs, base: props.docs.basePath };
  return (
    <>
      <Route path={ctx.base} exact>
        <DocumentsListPage {...ctx} />
      </Route>
      <Route path={`${ctx.base}/receive-payment`}>
        <PaymentPage {...ctx} kind="customer_payment" />
      </Route>
      {props.docs.vendors
        ? (
          <Route path={`${ctx.base}/pay-bills`}>
            <PaymentPage {...ctx} kind="vendor_payment" />
          </Route>
        )
        : null}
      <Route path={`${ctx.base}/deposit`}>
        <DepositPage {...ctx} />
      </Route>
      <Route path={`${ctx.base}/terms`}>
        <TermsPage {...ctx} />
      </Route>
      {props.docs.salesTax
        ? (
          <Route path={`${ctx.base}/sales-tax`}>
            <SalesTaxPage {...ctx} />
          </Route>
        )
        : null}
      <Route path={`${ctx.base}/statement`}>
        <StatementPage {...ctx} />
      </Route>
      <Route path={`${ctx.base}/{ledger_document_id:id}/print`}>
        <InvoicePrintPage {...ctx} />
      </Route>
      <Route path={`${ctx.base}/payments/{ledger_payment_id:id}`}>
        <PaymentDetailPage {...ctx} />
      </Route>
      <Route path={`${ctx.base}/{ledger_document_id:id}`}>
        <DocumentPage {...ctx} />
      </Route>
    </>
  );
}

function StatusChip(props: { status: Sql }) {
  const colors: [string, "success" | "neutral" | "warning" | "primary"][] = [
    ["posted", "success"],
    ["void", "neutral"],
    ["draft", "warning"],
    ["open", "primary"],
    ["closed", "neutral"],
  ];
  return (
    <>
      {colors.map(([status, color]) => (
        <Show when={sql`${props.status} = ${sql.lit(status)}`}>
          <Chip size="sm" color={color}>{status}</Chip>
        </Show>
      ))}
    </>
  );
}

function DocumentsListPage(props: Ctx) {
  const { docs, base } = props;
  const kinds = docs.documentKinds;
  return (
    <LedgerPage
      block={docs.ledger}
      title="Documents"
      actions={
        <>
          {kinds.map((k) => (
            <ActionButton
              size="sm"
              variant="outlined"
              action={(s) => {
                s.defScalar("new_document_id", { type: "BigInt" });
                manageAction(docs.ledger, (s) =>
                  s.modify(sql`insert into db.ledger_documents
                    (kind, document_date)
                    values (cast(${sql.lit(k.name)}
                      as enums.ledger_document_kind), current_date())
                    returning id into new_document_id`))(s);
                s.navigate(sql`${sql.lit(`${base}/`)} || new_document_id`);
              }}
            >
              {`New ${k.displayName.toLowerCase()}`}
            </ActionButton>
          ))}
        </>
      }
    >
      <Data
        procedure={(s) => {
          s.defScalar("documents_kind", sql.lit``);
          s.defScalar("documents_search", sql.lit``);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <FormControl className="min-w-[200px]">
            <FormLabel>Kind</FormLabel>
            <Select
              size="sm"
              value={sql`documents_kind`}
              onChange={(s) => s.setScalar("documents_kind", sql`target_value`)}
            >
              <Select.Option value="">All</Select.Option>
              {[...docs.documentKinds, ...docs.paymentKinds].map((k) => (
                <Select.Option value={k.name}>{k.displayName}</Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl className="min-w-[240px]">
            <FormLabel>Number or name contains</FormLabel>
            <Input
              size="sm"
              value={sql`documents_search`}
              onInput={(s, value) => s.setScalar("documents_search", value)}
            />
          </FormControl>
        </div>
        <Data
          watch={[sql`documents_kind`, sql`documents_search`]}
          procedure={(s) => {
            // Filter and take the newest 500 first, then work out status,
            // totals, and open balances for those rows only.
            const matches = (kind: Sql, number: Sql, party: Sql) =>
              sql`(documents_kind = '' or cast(${kind} as string)
                  = documents_kind)
                and (trim(documents_search) = ''
                  or contains(lower(coalesce(${number}, '') || ' ' || ${party}),
                    lower(trim(documents_search))))`;
            s.defTable(
              "document_rows",
              sql`select listed.row_id as id, listed.kind, listed.number,
                  listed.document_date, listed.party,
                  case when listed.payment_id is not null then cast(null as date)
                    else ${docs.dueDateSql(sql`listed.document_id`)} end
                    as due_date,
                  case when listed.payment_id is not null
                    then ${docs.paymentStatusSql(sql`listed.payment_id`)}
                    else ${docs.statusSql(sql`listed.document_id`)} end
                    as status,
                  case when listed.payment_id is not null
                    then ${docs.paymentUnappliedSql(sql`listed.payment_id`)}
                    else ${docs.openBalanceSql(sql`listed.document_id`)} end
                    as open_balance,
                  case when listed.payment_id is not null
                    then (select amount from db.ledger_payments
                      where id = listed.payment_id)
                    else ${docs.totalSql(sql`listed.document_id`)} end
                    as total,
                  case when listed.payment_id is not null
                    then ${sql.lit(`${base}/payments/`)} || listed.payment_id
                    else ${sql.lit(`${base}/`)} || listed.document_id end
                    as href
                from (select row_number() over (
                      order by all_rows.document_date desc,
                        all_rows.sort_id desc) as row_id, all_rows.*
                    from (
                    select doc.id as document_id,
                      cast(null as bigint) as payment_id,
                      cast(doc.id as bigint) as sort_id,
                      cast(doc.kind as string) as kind,
                      doc.number, doc.document_date,
                      ${partyLabel(docs, "doc")} as party
                    from db.ledger_documents doc
                    where ${
                matches(
                  sql`doc.kind`,
                  sql`doc.number`,
                  partyLabel(docs, "doc"),
                )
              }
                    union all
                    select cast(null as bigint), payment.id,
                      cast(payment.id as bigint),
                      cast(payment.kind as string),
                      payment.number, payment.payment_date,
                      ${partyLabel(docs, "payment")}
                    from db.ledger_payments payment
                    where ${
                matches(
                  sql`payment.kind`,
                  sql`payment.number`,
                  partyLabel(docs, "payment"),
                )
              }) all_rows) listed
                where listed.row_id <= 500
                order by listed.row_id`,
            );
          }}
        >
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>No.</th>
                  <th>Customer or vendor</th>
                  <th>Due</th>
                  <th>
                    <div className="text-right">Total</div>
                  </th>
                  <th>
                    <div className="text-right">Open</div>
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <Each table="document_rows" recordName="document_row">
                  <tr>
                    <td>{date(sql`document_row.document_date`)}</td>
                    <td>
                      <a
                        href={sql`document_row.href`}
                        className="text-primary-600 hover:underline"
                      >
                        {kindLabel(sql`document_row.kind`)}
                      </a>
                    </td>
                    <td>{sql`coalesce(document_row.number, '')`}</td>
                    <td>{sql`document_row.party`}</td>
                    <td>
                      {sql`coalesce(${date(sql`document_row.due_date`)}, '')`}
                    </td>
                    <td className="text-right tabular-nums">
                      {docs.ledger.formatAmountSql(sql`document_row.total`)}
                    </td>
                    <td className="text-right tabular-nums">
                      {sql`case when document_row.open_balance = 0 then ''
                        else ${
                        docs.ledger.formatAmountSql(
                          sql`document_row.open_balance`,
                        )
                      } end`}
                    </td>
                    <td>
                      <StatusChip status={sql`document_row.status`} />
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Data>
      </Data>
    </LedgerPage>
  );
}

/** One document: header, lines, totals; saving posts it. */
export function DocumentPage(props: Ctx) {
  const { docs, base } = props;
  const ledger = docs.ledger;
  const id = sql`ledger_document_id`;
  const isKind = (...names: string[]) =>
    sql`cast(document.kind as string) in (${names.map((n) => sql.lit(n))})`;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "document",
          sql`select doc.id, doc.kind, doc.source_document_id,
              doc.customer_id, ${
            docs.vendors ? sql`doc.vendor_id` : sql`cast(null as bigint)`
          } as vendor_id,
              ${docs.statusSql(id)} as status,
              ${docs.openBalanceSql(id)} as open_balance,
              ${docs.source.activeEntryId(id)} as entry_id,
              ${docs.totalSql(id)} - ${docs.taxSql(id)} as subtotal,
              ${docs.taxSql(id)} as tax, ${docs.totalSql(id)} as total,
              ${docs.dueDateSql(id)} as due_on
            from db.ledger_documents doc where doc.id = ${id}`,
        );
      }}
    >
      <LedgerPage
        block={ledger}
        title={kindLabel(sql`document.kind`)}
        aside={
          <>
            <StatusChip status={sql`document.status`} />
            <Show when={sql`document.open_balance <> 0`}>
              <Chip size="sm" variant="soft">
                {sql`'Open ' || ${
                  ledger.formatAmountSql(sql`document.open_balance`)
                }`}
              </Chip>
            </Show>
            <Show when={sql`document.entry_id is not null`}>
              <Button
                size="sm"
                variant="outlined"
                href={sql`${
                  sql.lit(`${docs.ledgerBasePath}/journal/`)
                } || document.entry_id`}
              >
                View posting
              </Button>
            </Show>
            <Show
              when={isKind(
                "estimate",
                "invoice",
                "sales_receipt",
                "credit_memo",
              )}
            >
              <Button
                size="sm"
                variant="outlined"
                href={sql`${sql.lit(`${base}/`)} || ${id} || '/print'`}
              >
                Print
              </Button>
            </Show>
          </>
        }
        actions={
          <>
            <Show when={sql`document.status = 'open'`}>
              <ActionButton
                size="sm"
                action={(s) => {
                  s.defScalar("converted_document_id", { type: "BigInt" });
                  manageAction(
                    ledger,
                    (s) => docs.actions.convert(s, id, "converted_document_id"),
                  )(s);
                  s.navigate(
                    sql`${sql.lit(`${base}/`)} || converted_document_id`,
                  );
                }}
              >
                {sql`case when ${isKind("estimate")} then 'Convert to invoice'
                  else 'Convert to bill' end`}
              </ActionButton>
            </Show>
            <Show when={sql`document.status in ('draft', 'open')`}>
              <ActionButton
                size="sm"
                color="danger"
                variant="outlined"
                confirm={{ description: "Delete this document?" }}
                action={(s) => {
                  manageAction(
                    ledger,
                    (s) =>
                      s.modify(sql`delete from db.ledger_documents
                      where id = ${id}`),
                  )(s);
                  s.navigate(sql.lit(base));
                }}
              >
                Delete
              </ActionButton>
            </Show>
            <Show when={sql`document.status = 'posted'`}>
              <VoidControl
                block={ledger}
                name="document"
                description="Voiding reverses the posting on the chosen date, or on the document's date when none is chosen. Unapply payments first."
                action={(s, date) => docs.actions.void(s, id, date)}
              />
            </Show>
          </>
        }
      >
        <Form
          defaultFieldComponent={LabelOnTopFormField}
          watch={[id]}
          beforeTransactionStart={(s) => ledger.requireManage(s)}
          beforeTransactionCommit={(s) => {
            // Saving posts, or reposts an edited posted document;
            // estimates and purchase orders only take their number.
            s.if(
              sql`cast((select kind from db.ledger_documents
                where id = ${id}) as string)
                not in ('estimate', 'purchase_order')`,
              (s) => docs.actions.post(s, id),
              (s) => docs.actions.number(s, id),
            );
          }}
          afterSubmitClientSuccess={(s, ctx) => {
            // Saving can assign the number, so reload the form instead of
            // keeping the values as typed.
            ctx.reset(s);
            s.refetch();
          }}
        >
          <Form.Update table="ledger_documents" where={sql`id = ${id}`}>
            <Card variant="outlined" className="p-4 flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Show
                  when={isKind(
                    "estimate",
                    "invoice",
                    "sales_receipt",
                    "credit_memo",
                  )}
                >
                  <Form.Field field="customer_id" />
                </Show>
                {docs.vendors
                  ? (
                    <Show
                      when={isKind(
                        "purchase_order",
                        "bill",
                        "expense",
                        "vendor_credit",
                      )}
                    >
                      <Form.Field field="vendor_id" />
                    </Show>
                  )
                  : null}
                <Form.Field field="document_date" />
                <Form.Field field="number" />
                <Show when={isKind("invoice", "bill")}>
                  <Form.Field field="terms_id" />
                  <Form.Field field="due_date" />
                </Show>
                <Show when={isKind("sales_receipt", "expense")}>
                  <Form.Field field="account_id" />
                </Show>
                {docs.salesTax
                  ? (
                    <Show
                      when={isKind(
                        "estimate",
                        "invoice",
                        "sales_receipt",
                        "credit_memo",
                      )}
                    >
                      <Form.Field field="tax_rate_id" />
                      <Form.Field field="tax_amount" />
                    </Show>
                  )
                  : null}
                {ledger.multiCurrency
                  ? (
                    <>
                      <Form.Field field="currency" />
                      <Form.Field field="exchange_rate" />
                    </>
                  )
                  : null}
                {ledger.entities ? <Form.Field field="entity_id" /> : null}
                <Form.Field field="memo" />
              </div>
              <Form.Relation table="ledger_document_lines">
                <div className="overflow-x-auto">
                  {/* Auto layout keeps the column minimums; the div scrolls. */}
                  <Table borderAxis="none" sx={{ tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th className="min-w-[200px]">Product or service</th>
                        <th className="min-w-[200px]">Account</th>
                        <th>Description</th>
                        <th className="w-[100px]">Qty</th>
                        <th className="w-[120px]">Rate</th>
                        <th className="w-[140px]">Amount</th>
                        {docs.salesTax ? <th>Tax</th> : null}
                        {docs.lineDimensions.map((d) => (
                          <th>{dimensionLabel(d)}</th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      <Form.Each>
                        <tr>
                          {[
                            "item_id",
                            "account_id",
                            "description",
                            "quantity",
                            "unit_price",
                            "amount",
                            ...(docs.salesTax ? ["taxable"] : []),
                            ...docs.lineDimensions.map((d) => `${d.key}_id`),
                          ].map((field) => (
                            <td
                              className={field.endsWith("_id")
                                ? "min-w-[180px]"
                                : undefined}
                            >
                              <Form.Field field={field}>
                                <FieldFormControl aria-label={field} />
                              </Form.Field>
                            </td>
                          ))}
                          <td>
                            <Form.DeleteRecordIconButton
                              icon="Close"
                              aria-label="Remove line"
                              variant="plain"
                              size="sm"
                            />
                          </td>
                        </tr>
                      </Form.Each>
                    </tbody>
                  </Table>
                </div>
                <LinesTotal docs={docs} />
                <div>
                  <Form.AddCurrentTableButton
                    startIcon="Add"
                    variant="outlined"
                    size="sm"
                  >
                    Add line
                  </Form.AddCurrentTableButton>
                </div>
              </Form.Relation>
              <Form.ErrorAlert mode="all" />
              <Show when={sql`ledger_can_manage and document.status <> 'void'`}>
                <div className="flex justify-end">
                  <Form.SubmitButton>
                    {sql`case when ${isKind("estimate", "purchase_order")}
                      then 'Save' else 'Save and post' end`}
                  </Form.SubmitButton>
                </div>
              </Show>
            </Card>
          </Form.Update>
        </Form>
        <Card variant="outlined" className="p-4 flex flex-col items-end gap-1">
          {documentTotals(docs).map(([label, amount]) => (
            <div className="flex gap-6 tabular-nums">
              <span>{label}</span>
              <span className="min-w-[120px] text-right">
                {ledger.formatAmountSql(amount)}
              </span>
            </div>
          ))}
          <Show when={sql`document.due_on is not null`}>
            <div className="text-sm">
              {sql`'Due ' || ${date(sql`document.due_on`)}`}
            </div>
          </Show>
        </Card>
        <Show when={sql`document.entry_id is not null`}>
          <AppliedList
            docs={docs}
            name="document"
            entryId={sql`document.entry_id`}
          />
          <Show
            when={sql`ledger_can_manage and document.open_balance > 0
              and ${isKind("invoice", ...(docs.vendors ? ["bill"] : []))}`}
          >
            <Show when={isKind("invoice")}>
              <CreditsToApply docs={docs} documentId={id} customer />
              <WriteOffCard docs={docs} documentId={id} customer />
            </Show>
            {docs.vendors
              ? (
                <Show when={isKind("bill")}>
                  <CreditsToApply
                    docs={docs}
                    documentId={id}
                    customer={false}
                  />
                  <WriteOffCard docs={docs} documentId={id} customer={false} />
                </Show>
              )
              : null}
          </Show>
          <Show
            when={sql`ledger_can_manage and document.open_balance > 0
              and ${isKind("credit_memo")}`}
          >
            <ApplyToDocuments
              docs={docs}
              fromEntryId={sql`document.entry_id`}
              customer
              partyId={sql`document.customer_id`}
              available={sql`document.open_balance`}
            />
            <RefundCard
              docs={docs}
              customer
              partyId={sql`document.customer_id`}
              fromEntryId={sql`document.entry_id`}
              open={sql`document.open_balance`}
            />
          </Show>
          {docs.vendors
            ? (
              <Show
                when={sql`ledger_can_manage and document.open_balance > 0
                  and ${isKind("vendor_credit")}`}
              >
                <ApplyToDocuments
                  docs={docs}
                  fromEntryId={sql`document.entry_id`}
                  customer={false}
                  partyId={sql`document.vendor_id`}
                  available={sql`document.open_balance`}
                />
                <RefundCard
                  docs={docs}
                  customer={false}
                  partyId={sql`document.vendor_id`}
                  fromEntryId={sql`document.entry_id`}
                  open={sql`document.open_balance`}
                />
              </Show>
            )
            : null}
        </Show>
      </LedgerPage>
    </Data>
  );
}

/** One payment, deposit, or tax payment; edit them by voiding. */
function PaymentDetailPage(props: Ctx) {
  const { docs, base } = props;
  const ledger = docs.ledger;
  const id = sql`ledger_payment_id`;
  const detail = (label: string, value: Sql) => (
    <div>
      <Typography level="body-sm">{label}</Typography>
      <Typography>{value}</Typography>
    </div>
  );
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "payment",
          sql`select doc.id, doc.kind, doc.number, doc.payment_date,
              doc.amount, doc.deposit_id, doc.memo, doc.customer_id,
              ${
            docs.vendors ? sql`doc.vendor_id` : sql`cast(null as bigint)`
          } as vendor_id,
              (select name from db.ledger_accounts
                where id = doc.account_id) as account_name,
              ${partyLabel(docs, "doc")} as party,
              ${docs.paymentStatusSql(id)} as status,
              ${docs.paymentUnappliedSql(id)} as unapplied,
              ${docs.paymentSource.activeEntryId(id)} as entry_id
            from db.ledger_payments doc where doc.id = ${id}`,
        );
        s.defTable(
          "payment_included",
          sql`select included.id, cast(included.kind as string) as kind,
              included.payment_date as received_on,
              ${partyLabel(docs, "included")} as party,
              ${sql.lit(`${base}/payments/`)} || included.id as href
            from db.ledger_payments included where included.deposit_id = ${id}
            union all
            select included.id, cast(included.kind as string),
              included.document_date, ${partyLabel(docs, "included")},
              ${sql.lit(`${base}/`)} || included.id
            from db.ledger_documents included
            where included.deposit_id = ${id}`,
        );
      }}
    >
      <LedgerPage
        block={ledger}
        title={kindLabel(sql`payment.kind`)}
        aside={
          <>
            <StatusChip status={sql`payment.status`} />
            <Show when={sql`payment.unapplied <> 0`}>
              <Chip size="sm" variant="soft">
                {sql`'Unapplied ' || ${
                  ledger.formatAmountSql(sql`payment.unapplied`)
                }`}
              </Chip>
            </Show>
            <Show when={sql`payment.entry_id is not null`}>
              <Button
                size="sm"
                variant="outlined"
                href={sql`${
                  sql.lit(`${docs.ledgerBasePath}/journal/`)
                } || payment.entry_id`}
              >
                View posting
              </Button>
            </Show>
          </>
        }
        actions={
          <Show
            when={sql`payment.status <> 'void' and payment.deposit_id is null`}
          >
            <VoidControl
              block={ledger}
              name="payment"
              description="Voiding reverses the posting on the chosen date (or the payment's date) and releases what it included. Unapply it first."
              action={(s, date) => docs.actions.voidPayment(s, id, date)}
            />
          </Show>
        }
      >
        <Card variant="outlined" className="p-4 grid gap-4 md:grid-cols-3">
          {detail("Date", date(sql`payment.payment_date`))}
          {detail("Number", sql`coalesce(payment.number, '')`)}
          {detail("Customer or vendor", sql`payment.party`)}
          {detail("Account", sql`coalesce(payment.account_name, '')`)}
          {detail("Amount", ledger.formatAmountSql(sql`payment.amount`))}
          {detail("Memo", sql`coalesce(payment.memo, '')`)}
        </Card>
        <Show when={sql`exists (select 1 from payment_included)`}>
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Deposited</th>
                  <th>Received from</th>
                </tr>
              </thead>
              <tbody>
                <Each table="payment_included" recordName="included_row">
                  <tr>
                    <td>{date(sql`included_row.received_on`)}</td>
                    <td>
                      <a
                        href={sql`included_row.href`}
                        className="text-primary-600 hover:underline"
                      >
                        {kindLabel(sql`included_row.kind`)}
                      </a>
                    </td>
                    <td>{sql`included_row.party`}</td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Show>
        <Show when={sql`payment.entry_id is not null`}>
          <AppliedList
            docs={docs}
            name="payment"
            entryId={sql`payment.entry_id`}
          />
          <Show
            when={sql`ledger_can_manage and payment.unapplied > 0
              and payment.customer_id is not null
              and cast(payment.kind as string)
                in ('customer_payment', 'write_off')`}
          >
            <ApplyToDocuments
              docs={docs}
              fromEntryId={sql`payment.entry_id`}
              customer
              partyId={sql`payment.customer_id`}
              available={sql`payment.unapplied`}
            />
            <RefundCard
              docs={docs}
              customer
              partyId={sql`payment.customer_id`}
              fromEntryId={sql`payment.entry_id`}
              open={sql`payment.unapplied`}
            />
          </Show>
          {docs.vendors
            ? (
              <Show
                when={sql`ledger_can_manage and payment.unapplied > 0
                  and payment.vendor_id is not null
                  and cast(payment.kind as string)
                    in ('vendor_payment', 'write_off')`}
              >
                <ApplyToDocuments
                  docs={docs}
                  fromEntryId={sql`payment.entry_id`}
                  customer={false}
                  partyId={sql`payment.vendor_id`}
                  available={sql`payment.unapplied`}
                />
              </Show>
            )
            : null}
        </Show>
      </LedgerPage>
    </Data>
  );
}

/** The saved document's totals, as posted. */
function documentTotals(docs: LedgerDocumentsBlock): [string, Sql][] {
  const tax: [string, Sql][] = docs.salesTax
    ? [["Tax", sql`document.tax`]]
    : [];
  return [
    ["Subtotal", sql`document.subtotal`],
    ...tax,
    ["Total", sql`document.total`],
    ["Open", sql`document.open_balance`],
  ];
}

/** Live subtotal of the lines being edited. */
function LinesTotal(props: { docs: LedgerDocumentsBlock }) {
  const lines = useCurrentTableHelper().tableIdent;
  // Form state keeps numeric fields as edited text.
  const total = sql`coalesce((select sum(coalesce(
      try_cast(amount as decimal(18, 4)),
      try_cast(quantity as decimal(18, 4))
        * try_cast(unit_price as decimal(18, 4)))) from ${lines}), 0)`;
  return (
    <div className="flex justify-end text-sm font-semibold">
      {sql`'Subtotal ' || ${props.docs.ledger.formatAmountSql(total)}`}
    </div>
  );
}

/**
 * Receive payment or pay bills: a party's open invoices or bills, an amount
 * to apply to each, and the account the money moves through.
 */
function PaymentPage(
  props: Ctx & { kind: "customer_payment" | "vendor_payment" },
) {
  const { docs, base } = props;
  const ledger = docs.ledger;
  const customer = props.kind === "customer_payment";
  const party = customer ? docs.customers : docs.vendors!;
  const partyColumn = customer ? sql`customer_id` : sql`vendor_id`;
  const openKinds = customer ? sql`('invoice')` : sql`('bill')`;
  return (
    <LedgerPage
      block={ledger}
      title={customer ? "Receive payment" : "Pay bills"}
    >
      <Data
        procedure={(s) => {
          s.defScalar("pay_party_id", { type: "BigInt" });
          s.defScalar("pay_date", { type: "Date", expr: sql`current_date()` });
          s.defScalar("pay_account_id", { type: "BigInt" });
          s.defScalar("pay_amount_text", sql.lit``);
          s.defScalar("pay_reference", sql.lit``);
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-wrap items-end gap-3">
          <FormControl className="min-w-[240px]">
            <FormLabel>{customer ? "Customer" : "Vendor"}</FormLabel>
            <TableRecordSelect
              tableName={party.table}
              value={sql`pay_party_id`}
              onSelectValue={(s, value) => s.setScalar("pay_party_id", value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Date</FormLabel>
            <Input
              size="sm"
              type="date"
              value={sql`pay_date`}
              onInput={(s, value) =>
                s.setScalar("pay_date", sql`try_cast(${value} as date)`)}
            />
          </FormControl>
          <FormControl className="min-w-[240px]">
            <FormLabel>
              {customer
                ? "Deposit to (default undeposited funds)"
                : "Paid from"}
            </FormLabel>
            <TableRecordSelect
              tableName="ledger_accounts"
              where={sql`type in (cast('bank' as enums.ledger_account_type),
                cast('credit_card' as enums.ledger_account_type),
                cast('other_current_asset' as enums.ledger_account_type))`}
              value={sql`pay_account_id`}
              onSelectValue={(s, value) => s.setScalar("pay_account_id", value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Amount (default: total applied)</FormLabel>
            <Input
              size="sm"
              value={sql`pay_amount_text`}
              onInput={(s, value) => s.setScalar("pay_amount_text", value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>{customer ? "Reference no." : "Check no."}</FormLabel>
            <Input
              size="sm"
              value={sql`pay_reference`}
              onInput={(s, value) => s.setScalar("pay_reference", value)}
            />
          </FormControl>
        </Card>
        <Data
          watch={[sql`pay_party_id`]}
          procedure={(s) => {
            s.defTable(
              "pay_open",
              sql`select doc.id, doc.number, doc.document_date, doc.due_date,
                  ${docs.openBalanceSql(sql`doc.id`)} as open_balance,
                  cast(${docs.openBalanceSql(sql`doc.id`)} as string)
                    as apply_text,
                  true as selected
                from db.ledger_documents doc
                where doc.${partyColumn} = pay_party_id
                  and cast(doc.kind as string) in ${openKinds}
                  and ${docs.openBalanceSql(sql`doc.id`)} > 0
                order by coalesce(doc.due_date, doc.document_date), doc.id`,
            );
          }}
        >
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <th />
                  <th>No.</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th>
                    <div className="text-right">Open</div>
                  </th>
                  <th className="w-[160px]">Payment</th>
                </tr>
              </thead>
              <tbody>
                <Each table="pay_open" recordName="pay_row">
                  <tr>
                    <td>
                      <Checkbox
                        checked={sql`pay_row.selected`}
                        onCheckboxChange={(s) => s.modify(sql`update pay_open
                            set selected = not selected
                            where id = pay_row.id`)}
                      />
                    </td>
                    <td>{sql`coalesce(pay_row.number, '')`}</td>
                    <td>{date(sql`pay_row.document_date`)}</td>
                    <td>{sql`coalesce(${date(sql`pay_row.due_date`)}, '')`}</td>
                    <td className="text-right tabular-nums">
                      {ledger.formatAmountSql(sql`pay_row.open_balance`)}
                    </td>
                    <td>
                      <Input
                        size="sm"
                        value={sql`pay_row.apply_text`}
                        onInput={(s, value) =>
                          s.modify(sql`update pay_open set apply_text = ${value}
                            where id = pay_row.id`)}
                      />
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
          <div className="flex justify-end">
            <ActionButton
              action={(s) => {
                s.defTable("pay_applications", {
                  fields: docs.applicationFields,
                });
                s.modify(sql`insert into pay_applications
                  select id, try_cast(replace(apply_text, ',', '')
                    as decimal(18, 4))
                  from pay_open where selected`);
                // More than is applied stays on the account as a credit.
                s.defScalar(
                  "pay_applied",
                  sql`coalesce((select sum(amount) from pay_applications), 0)`,
                );
                s.defScalar(
                  "pay_amount",
                  sql`coalesce(try_cast(replace(pay_amount_text, ',', '')
                    as decimal(18, 4)), pay_applied)`,
                );
                s.throwErrorIf(
                  sql`pay_party_id is null`,
                  sql.lit`Choose who the payment is from or to`,
                );
                s.throwErrorIf(
                  sql`pay_amount < pay_applied`,
                  sql.lit`The amount is less than what is applied`,
                );
                s.defScalar("recorded_payment_id", { type: "BigInt" });
                manageAction(ledger, (s) => {
                  docs.actions.recordPayment(s, {
                    kind: props.kind,
                    partyId: sql`pay_party_id`,
                    date: sql`pay_date`,
                    amount: sql`pay_amount`,
                    accountId: sql`pay_account_id`,
                    applications: "pay_applications",
                    number: sql`nullif(trim(pay_reference), '')`,
                    intoPaymentId: "recorded_payment_id",
                  });
                })(s);
                s.navigate(
                  sql`${sql.lit(`${base}/payments/`)} || recorded_payment_id`,
                );
              }}
            >
              {customer ? "Receive payment" : "Pay bills"}
            </ActionButton>
          </div>
        </Data>
      </Data>
    </LedgerPage>
  );
}

/** Posted, undeposited receipts of one table sitting in undeposited funds. */
function undeposited(
  docs: LedgerDocumentsBlock,
  table: "ledger_payments" | "ledger_documents",
  dateColumn: string,
): Sql {
  const payment = table === "ledger_payments";
  const source = payment ? docs.paymentSource : docs.source;
  return sql`select
      ${payment ? sql`doc.id` : sql`cast(null as bigint)`} as payment_id,
      ${payment ? sql`cast(null as bigint)` : sql`doc.id`} as document_id,
      cast(doc.kind as string) as kind, doc.number,
      doc.${sql.ref(dateColumn)} as received_on,
      ${partyLabel(docs, "doc")} as party, line.amount
    from db.${sql.ref(table)} doc
    join db.ledger_entries entry on entry.source = ${source.enumLiteral()}
      and entry.source_record_id = doc.id
    join db.ledger_lines line on line.entry_id = entry.id
    where doc.deposit_id is null and doc.voided_at is null
      and line.account_id = ${docs.ledger.account(docs.accounts.undeposited)}
      and line.amount > 0
      and ${docs.ledger.isActiveEntrySql(sql`entry`)}`;
}

/** Payments and receipts in undeposited funds, deposited together. */
function DepositPage(props: Ctx) {
  const { docs, base } = props;
  const ledger = docs.ledger;
  return (
    <LedgerPage block={ledger} title="Deposits">
      <Data
        procedure={(s) => {
          s.defScalar("deposit_date", {
            type: "Date",
            expr: sql`current_date()`,
          });
          s.defScalar("deposit_account_id", { type: "BigInt" });
          s.defTable(
            "undeposited",
            sql`select row_number() over (order by received_on, kind)
                as row_id, payment_id, document_id, kind, number,
                received_on, party, amount, true as selected
              from (${undeposited(docs, "ledger_payments", "payment_date")}
                union all
                ${undeposited(docs, "ledger_documents", "document_date")}
              ) received`,
          );
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-wrap items-end gap-3">
          <FormControl className="min-w-[240px]">
            <FormLabel>Deposit to</FormLabel>
            <TableRecordSelect
              tableName="ledger_accounts"
              where={sql`type = cast('bank' as enums.ledger_account_type)`}
              value={sql`deposit_account_id`}
              onSelectValue={(s, value) =>
                s.setScalar("deposit_account_id", value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Date</FormLabel>
            <Input
              size="sm"
              type="date"
              value={sql`deposit_date`}
              onInput={(s, value) =>
                s.setScalar("deposit_date", sql`try_cast(${value} as date)`)}
            />
          </FormControl>
          <ActionButton
            action={(s) => {
              s.defTable("deposit_included", { fields: docs.depositFields });
              s.modify(sql`insert into deposit_included
                select payment_id, document_id from undeposited where selected`);
              s.defScalar("deposit_payment_id", { type: "BigInt" });
              manageAction(ledger, (s) =>
                docs.actions.deposit(s, {
                  accountId: sql`deposit_account_id`,
                  date: sql`deposit_date`,
                  included: "deposit_included",
                  intoPaymentId: "deposit_payment_id",
                }))(s);
              s.navigate(
                sql`${sql.lit(`${base}/payments/`)} || deposit_payment_id`,
              );
            }}
          >
            Deposit selected
          </ActionButton>
        </Card>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <th />
                <th>Date</th>
                <th>Type</th>
                <th>Received from</th>
                <th>
                  <div className="text-right">Amount</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <Each table="undeposited" recordName="undeposited_row">
                <tr>
                  <td>
                    <Checkbox
                      checked={sql`undeposited_row.selected`}
                      onCheckboxChange={(s) =>
                        s.modify(sql`update undeposited
                          set selected = not selected
                          where row_id = undeposited_row.row_id`)}
                    />
                  </td>
                  <td>{date(sql`undeposited_row.received_on`)}</td>
                  <td>{kindLabel(sql`undeposited_row.kind`)}</td>
                  <td>{sql`undeposited_row.party`}</td>
                  <td className="text-right tabular-nums">
                    {ledger.formatAmountSql(sql`undeposited_row.amount`)}
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Data>
    </LedgerPage>
  );
}

/** A setup table: rows, add, and edit in a dialog. */
function SetupList(
  props: {
    docs: LedgerDocumentsBlock;
    title: string;
    table: string;
    query: Sql;
    columns: [string, Sql][];
  },
) {
  const { docs } = props;
  const open = `${props.table}_edit_open`;
  const editId = `${props.table}_edit_id`;
  const row = `${props.table}_row`;
  return (
    <Data
      procedure={(s) => {
        s.defScalar(open, sql`false`);
        s.defScalar(editId, { type: "BigInt" });
        s.defTable(`${props.table}_rows`, props.query);
      }}
    >
      <Card variant="outlined" className="p-0 overflow-x-auto">
        <div className="p-4 flex items-center justify-between">
          <Typography level="title-md">{props.title}</Typography>
          <AutoInsertButton
            table={props.table}
            size="sm"
            startIcon="Add"
            beforeTransactionStart={(s) => docs.requireManage(s)}
          >
            Add
          </AutoInsertButton>
        </div>
        <Table hoverRow>
          <thead>
            <tr>
              {props.columns.map(([label]) => <th>{label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            <Each table={`${props.table}_rows`} recordName={row}>
              <tr>
                {props.columns.map(([, expr]) => <td>{expr}</td>)}
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="plain"
                    onClick={(s) => {
                      s.setScalar(editId, sql`${sql.ref(row)}.id`);
                      s.setScalar(open, true);
                    }}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            </Each>
          </tbody>
        </Table>
      </Card>
      <AutoUpdateDialog
        bindScalar={open}
        table={props.table}
        recordId={sql.ref(editId)}
        beforeTransactionStart={(s) => docs.requireManage(s)}
      />
    </Data>
  );
}

function TermsPage(props: Ctx) {
  const { docs } = props;
  return (
    <LedgerPage block={docs.ledger} title="Payment terms">
      <SetupList
        docs={docs}
        title="Payment terms"
        table="ledger_payment_terms"
        query={sql`select id, name, due_days from db.ledger_payment_terms
          order by due_days`}
        columns={[
          ["Name", sql`ledger_payment_terms_row.name`],
          [
            "Due in days",
            sql`cast(ledger_payment_terms_row.due_days as string)`,
          ],
        ]}
      />
    </LedgerPage>
  );
}

/** Agencies with what is owed to each, rates, and recording payments. */
function SalesTaxPage(props: Ctx) {
  const { docs, base } = props;
  const ledger = docs.ledger;
  return (
    <LedgerPage block={ledger} title="Sales tax">
      <SalesTaxReport docs={docs} />
      <SetupList
        docs={docs}
        title="Agencies"
        table="ledger_tax_agencies"
        query={sql`select agency.id, agency.name,
            coalesce(-(select sum(amount) from db.ledger_lines
              where account_id = agency.liability_account_id), 0) as owed
          from db.ledger_tax_agencies agency order by agency.name`}
        columns={[
          ["Agency", sql`ledger_tax_agencies_row.name`],
          [
            "Owed today",
            ledger.formatAmountSql(sql`ledger_tax_agencies_row.owed`),
          ],
        ]}
      />
      <SetupList
        docs={docs}
        title="Rates"
        table="ledger_tax_rates"
        query={sql`select rate.id, rate.name, rate.rate,
            (select name from db.ledger_tax_agencies
              where id = rate.agency_id) as agency
          from db.ledger_tax_rates rate order by rate.name`}
        columns={[
          ["Rate", sql`ledger_tax_rates_row.name`],
          [
            "Percent",
            sql`cast(ledger_tax_rates_row.rate * 100 as string) || '%'`,
          ],
          ["Agency", sql`ledger_tax_rates_row.agency`],
        ]}
      />
      <Data
        procedure={(s) => {
          s.defScalar("tax_pay_agency_id", { type: "BigInt" });
          s.defScalar("tax_pay_account_id", { type: "BigInt" });
          s.defScalar("tax_pay_amount", sql.lit``);
          s.defScalar("tax_pay_date", {
            type: "Date",
            expr: sql`current_date()`,
          });
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-wrap items-end gap-3">
          <Typography level="title-md" className="w-full">
            Record a tax payment
          </Typography>
          <FormControl className="min-w-[200px]">
            <FormLabel>Agency</FormLabel>
            <TableRecordSelect
              tableName="ledger_tax_agencies"
              value={sql`tax_pay_agency_id`}
              onSelectValue={(s, value) =>
                s.setScalar("tax_pay_agency_id", value)}
            />
          </FormControl>
          <FormControl className="min-w-[200px]">
            <FormLabel>Paid from</FormLabel>
            <TableRecordSelect
              tableName="ledger_accounts"
              where={sql`type = cast('bank' as enums.ledger_account_type)`}
              value={sql`tax_pay_account_id`}
              onSelectValue={(s, value) =>
                s.setScalar("tax_pay_account_id", value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Date</FormLabel>
            <Input
              size="sm"
              type="date"
              value={sql`tax_pay_date`}
              onInput={(s, value) =>
                s.setScalar("tax_pay_date", sql`try_cast(${value} as date)`)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Amount</FormLabel>
            <Input
              size="sm"
              value={sql`tax_pay_amount`}
              onInput={(s, value) => s.setScalar("tax_pay_amount", value)}
            />
          </FormControl>
          <ActionButton
            action={(s) => {
              s.defScalar("tax_payment_id", { type: "BigInt" });
              manageAction(ledger, (s) => {
                s.modify(sql`insert into db.ledger_payments
                  (kind, payment_date, tax_agency_id, account_id, amount)
                  values (cast('tax_payment' as enums.ledger_payment_kind),
                    tax_pay_date, tax_pay_agency_id, tax_pay_account_id,
                    try_cast(replace(tax_pay_amount, ',', '')
                      as decimal(18, 4)))
                  returning id into tax_payment_id`);
                docs.actions.postPayment(s, sql`tax_payment_id`);
              })(s);
              s.navigate(
                sql`${sql.lit(`${base}/payments/`)} || tax_payment_id`,
              );
            }}
          >
            Record payment
          </ActionButton>
        </Card>
      </Data>
    </LedgerPage>
  );
}
