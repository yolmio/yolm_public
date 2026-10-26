import { formatDateSql, LedgerPage } from "blocks/ledger";
import { Card } from "components/card";
import { DateRangeFilter } from "components/date_range";
import { DownloadButton } from "components/download_button";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Table } from "components/table";
import { TableRecordSelect } from "components/table_record_select";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { kindLabelSql, partyLabel } from "./applications.tsx";
import type { LedgerDocumentsBlock } from "./index.tsx";

interface Ctx {
  docs: LedgerDocumentsBlock;
  base: string;
}

function Amount(props: { docs: LedgerDocumentsBlock; amount: Sql }) {
  return (
    <td className="text-right tabular-nums">
      {props.docs.ledger.formatAmountSql(props.amount)}
    </td>
  );
}

function printedTotals(docs: LedgerDocumentsBlock): [string, Sql][] {
  const tax: [string, Sql][] = docs.salesTax ? [["Tax", sql`printed.tax`]] : [];
  return [
    ["Subtotal", sql`printed.total - printed.tax`],
    ...tax,
    ["Total", sql`printed.total`],
  ];
}

/**
 * A sales document laid out to print or save as PDF from the browser:
 * company, customer, lines, tax, total, and balance due.
 */
export function InvoicePrintPage(props: Ctx) {
  const { docs } = props;
  const id = sql`ledger_document_id`;
  const decimals = docs.txnDecimalsSql(sql`doc`);
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "printed",
          sql`select doc.kind, doc.number, doc.document_date,
              ${docs.dueDateSql(id)} as due_date,
              doc.memo, ${partyLabel(docs, "doc")} as party,
              (select name from db.ledger_payment_terms
                where id = doc.terms_id) as terms,
              ${docs.taxSql(id)} as tax, ${docs.totalSql(id)} as total,
              ${docs.openBalanceSql(id)} as open_balance,
              ${docs.source.isPosted(id)} as posted
            from db.ledger_documents doc where doc.id = ${id}`,
        );
        s.defTable(
          "printed_lines",
          sql`select line.id,
              coalesce(line.description, item.name, '') as description,
              line.quantity, line.unit_price,
              coalesce(line.amount,
                round(line.quantity * line.unit_price, ${decimals})) as amount
            from db.ledger_document_lines line
            join db.ledger_documents doc on doc.id = line.document_id
            left join db.${sql.ref(docs.itemsTable)} item
              on item.id = line.item_id
            where line.document_id = ${id} order by line.id`,
        );
      }}
    >
      <div className="max-w-[800px] mx-auto w-full p-8 flex flex-col gap-6 bg-white text-black">
        <div className="flex justify-between gap-4">
          <div>
            <Typography level="h3">{docs.companyName}</Typography>
          </div>
          <div className="text-right">
            <Typography level="h3">
              {kindLabelSql(sql`cast(printed.kind as string)`)}
            </Typography>
            <div>{sql`coalesce(printed.number, '')`}</div>
          </div>
        </div>
        <div className="flex justify-between gap-4">
          <div>
            <div className="text-sm text-neutral-500">Bill to</div>
            <div className="font-semibold">{sql`printed.party`}</div>
          </div>
          <div className="text-right text-sm">
            <div>
              {sql`'Date ' || ${formatDateSql(sql`printed.document_date`)}`}
            </div>
            <Show when={sql`printed.due_date is not null`}>
              <div>
                {sql`'Due ' || ${formatDateSql(sql`printed.due_date`)}`}
              </div>
            </Show>
            <Show when={sql`printed.terms is not null`}>
              <div>{sql`'Terms ' || printed.terms`}</div>
            </Show>
          </div>
        </div>
        <Table borderAxis="xBetween">
          <thead>
            <tr>
              <th>Description</th>
              <th className="w-[80px]">
                <div className="text-right">Qty</div>
              </th>
              <th className="w-[120px]">
                <div className="text-right">Rate</div>
              </th>
              <th className="w-[140px]">
                <div className="text-right">Amount</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <Each table="printed_lines" recordName="printed_line">
              <tr>
                <td>{sql`printed_line.description`}</td>
                <td className="text-right tabular-nums">
                  {sql`coalesce(cast(printed_line.quantity as string), '')`}
                </td>
                <td className="text-right tabular-nums">
                  {sql`coalesce(${
                    docs.ledger.formatAmountSql(sql`printed_line.unit_price`)
                  }, '')`}
                </td>
                <Amount docs={docs} amount={sql`printed_line.amount`} />
              </tr>
            </Each>
          </tbody>
        </Table>
        <div className="flex flex-col items-end gap-1 tabular-nums">
          {printedTotals(docs).map(([label, amount]) => (
            <div className="flex gap-6">
              <span>{label}</span>
              <span className="min-w-[140px] text-right">
                {docs.ledger.formatAmountSql(amount)}
              </span>
            </div>
          ))}
          <Show
            when={sql`printed.posted
              and cast(printed.kind as string) = 'invoice'`}
          >
            <div className="flex gap-6 font-semibold">
              <span>Balance due</span>
              <span className="min-w-[140px] text-right">
                {docs.ledger.formatAmountSql(sql`printed.open_balance`)}
              </span>
            </div>
          </Show>
        </div>
        <Show when={sql`printed.memo is not null`}>
          <div className="text-sm">{sql`printed.memo`}</div>
        </Show>
        <div className="text-xs text-neutral-500 print:hidden">
          Use the browser's Print command to print or save as PDF.
        </div>
      </div>
    </Data>
  );
}

/**
 * A customer statement from the ledger: balance forward, every receivable
 * posting in the period with a running balance, and what is owed at the
 * end. Opening balances and journals on receivables are included.
 */
export function StatementPage(props: Ctx) {
  const { docs } = props;
  const ledger = docs.ledger;
  const party = sql.ref(`${docs.customers.dimension}_id`);
  const receivableLines = sql`select line.posting_date, line.amount,
      entry.document_number, entry.description, entry.id as entry_id
    from db.ledger_lines line
    join db.ledger_entries entry on entry.id = line.entry_id
    join db.ledger_accounts account on account.id = line.account_id
    where account.type = cast('accounts_receivable'
        as enums.ledger_account_type)
      and line.${party} = statement_customer_id
      ${ledger.books.length ? sql`and line.book is null` : sql``}`;
  return (
    <LedgerPage block={ledger} title="Customer statement">
      <Data
        procedure={(s) => {
          s.defScalar("statement_customer_id", { type: "BigInt" });
          s.defScalar("statement_from", {
            type: "Date",
            expr: sql`date.start_of_month(current_date())`,
          });
          s.defScalar("statement_to", {
            type: "Date",
            expr: sql`current_date()`,
          });
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-wrap items-end gap-3">
          <FormControl className="min-w-[240px]">
            <FormLabel>Customer</FormLabel>
            <TableRecordSelect
              tableName={docs.customers.table}
              value={sql`statement_customer_id`}
              onSelectValue={(s, value) =>
                s.setScalar("statement_customer_id", value)}
            />
          </FormControl>
          <DateRangeFilter
            size="sm"
            startDate={sql`statement_from`}
            endDate={sql`statement_to`}
            onStartDateChange={(s, value) =>
              s.setScalar("statement_from", value)}
            onEndDateChange={(s, value) => s.setScalar("statement_to", value)}
          />
        </Card>
        <Data
          watch={[
            sql`statement_customer_id`,
            sql`statement_from`,
            sql`statement_to`,
          ]}
          procedure={(s) => {
            s.defScalar(
              "statement_opening",
              sql`coalesce((select sum(amount) from (${receivableLines}) line
                where posting_date < statement_from), 0)`,
            );
            s.defTable(
              "statement_lines",
              sql`select entry_id, posting_date,
                  coalesce(document_number, '') as document_number,
                  coalesce(description, '') as description,
                  sum(amount) as amount,
                  statement_opening + sum(sum(amount)) over (
                    order by posting_date, entry_id
                    rows between unbounded preceding and current row)
                    as balance
                from (${receivableLines}) line
                where posting_date between statement_from and statement_to
                group by entry_id, posting_date, document_number, description
                order by posting_date, entry_id`,
            );
            s.defScalar(
              "statement_customer_name",
              sql`(select name from db.${
                sql.ref(docs.customers.table)
              } where id = statement_customer_id)`,
            );
            s.defScalar(
              "statement_closing",
              sql`coalesce((select sum(amount) from (${receivableLines}) line
                where posting_date <= statement_to), 0)`,
            );
          }}
        >
          <Show when={sql`statement_customer_id is not null`}>
            <Card variant="outlined" className="p-0 overflow-x-auto">
              <div className="p-4 flex justify-between gap-4">
                <Typography level="title-md">
                  {sql`coalesce(statement_customer_name, '')`}
                </Typography>
                <DownloadButton
                  size="sm"
                  variant="plain"
                  fileName="statement.csv"
                  query={sql`select format.date(posting_date, '%Y-%m-%d')
                      as date, document_number, description,
                      cast(amount as string) as amount,
                      cast(balance as string) as balance
                    from statement_lines`}
                >
                  Export CSV
                </DownloadButton>
              </div>
              <Table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>No.</th>
                    <th>Description</th>
                    <th>
                      <div className="text-right">Amount</div>
                    </th>
                    <th>
                      <div className="text-right">Balance</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatDateSql(sql`statement_from`)}</td>
                    <td />
                    <td>Balance forward</td>
                    <td />
                    <Amount docs={docs} amount={sql`statement_opening`} />
                  </tr>
                  <Each table="statement_lines" recordName="statement_line">
                    <tr>
                      <td>{formatDateSql(sql`statement_line.posting_date`)}</td>
                      <td>{sql`statement_line.document_number`}</td>
                      <td>{sql`statement_line.description`}</td>
                      <Amount docs={docs} amount={sql`statement_line.amount`} />
                      <Amount
                        docs={docs}
                        amount={sql`statement_line.balance`}
                      />
                    </tr>
                  </Each>
                  <tr className="font-semibold">
                    <td>{formatDateSql(sql`statement_to`)}</td>
                    <td />
                    <td>Amount due</td>
                    <td />
                    <Amount docs={docs} amount={sql`statement_closing`} />
                  </tr>
                </tbody>
              </Table>
            </Card>
          </Show>
        </Data>
      </Data>
    </LedgerPage>
  );
}

/**
 * Sales tax for a period per agency: taxable sales and tax on posted sales
 * documents dated in the period, tax paid, and the agency's liability
 * balance at the end of the period (agencies are expected to have their
 * own liability accounts).
 */
export function SalesTaxReport(props: { docs: LedgerDocumentsBlock }) {
  const { docs } = props;
  const decimals = docs.txnDecimalsSql(sql`doc`);
  const sign = sql`case when cast(doc.kind as string) = 'credit_memo'
    then -1 else 1 end`;
  const taxable = sql`coalesce((select sum(coalesce(line.amount,
      round(line.quantity * line.unit_price, ${decimals})))
    from db.ledger_document_lines line
    left join db.${sql.ref(docs.itemsTable)} item on item.id = line.item_id
    where line.document_id = doc.id
      and coalesce(line.taxable, item.taxable, false)), 0)`;
  const liability = sql`agency.liability_account_id`;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("tax_report_from", {
          type: "Date",
          expr: sql`date.start_of_month(date.subtract(month, 1,
            current_date()))`,
        });
        s.defScalar("tax_report_to", {
          type: "Date",
          expr: sql`date.subtract(day, 1, date.start_of_month(current_date()))`,
        });
      }}
    >
      <Card variant="outlined" className="p-0 overflow-x-auto">
        <div className="p-4 flex flex-wrap items-end justify-between gap-3">
          <Typography level="title-md">Sales tax for a period</Typography>
          <DateRangeFilter
            size="sm"
            startDate={sql`tax_report_from`}
            endDate={sql`tax_report_to`}
            onStartDateChange={(s, value) =>
              s.setScalar("tax_report_from", value)}
            onEndDateChange={(s, value) => s.setScalar("tax_report_to", value)}
          />
        </div>
        <Data
          watch={[sql`tax_report_from`, sql`tax_report_to`]}
          procedure={(s) =>
            s.defTable(
              "tax_report",
              sql`select agency.id, agency.name,
                  coalesce((select sum(${sign} * ${taxable})
                    from db.ledger_documents doc
                    join db.ledger_tax_rates rate on rate.id = doc.tax_rate_id
                    where rate.agency_id = agency.id
                      and doc.posted_tax <> 0
                      and ${docs.source.isPosted(sql`doc.id`)}
                      and doc.document_date between tax_report_from
                        and tax_report_to), 0) as taxable_sales,
                  coalesce(-(select sum(line.amount) from db.ledger_lines line
                    join db.ledger_entries entry on entry.id = line.entry_id
                    where line.account_id = ${liability}
                      and entry.source = ${docs.source.enumLiteral()}
                      and line.posting_date between tax_report_from
                        and tax_report_to), 0) as tax_collected,
                  coalesce((select sum(line.amount) from db.ledger_lines line
                    join db.ledger_entries entry on entry.id = line.entry_id
                    where line.account_id = ${liability}
                      and entry.source = ${docs.paymentSource.enumLiteral()}
                      and line.posting_date between tax_report_from
                        and tax_report_to), 0) as tax_paid,
                  coalesce(-(select sum(line.amount) from db.ledger_lines line
                    where line.account_id = ${liability}
                      and line.posting_date <= tax_report_to), 0) as owed
                from db.ledger_tax_agencies agency order by agency.name`,
            )}
        >
          <Table>
            <thead>
              <tr>
                <th>Agency</th>
                <th>
                  <div className="text-right">Taxable sales</div>
                </th>
                <th>
                  <div className="text-right">Tax collected</div>
                </th>
                <th>
                  <div className="text-right">Tax paid</div>
                </th>
                <th>
                  <div className="text-right">Liability at end</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <Each table="tax_report" recordName="tax_row">
                <tr>
                  <td>{sql`tax_row.name`}</td>
                  <Amount docs={docs} amount={sql`tax_row.taxable_sales`} />
                  <Amount docs={docs} amount={sql`tax_row.tax_collected`} />
                  <Amount docs={docs} amount={sql`tax_row.tax_paid`} />
                  <Amount docs={docs} amount={sql`tax_row.owed`} />
                </tr>
              </Each>
            </tbody>
          </Table>
        </Data>
      </Card>
    </Data>
  );
}
