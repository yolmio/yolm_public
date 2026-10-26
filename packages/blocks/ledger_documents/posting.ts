import { AMOUNT_TYPE } from "blocks/ledger";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { HelperProcField, IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import { NUMBERED_KINDS } from "./index.tsx";
import type { LedgerDocumentsBlock } from "./index.tsx";

const docKind = (name: string) =>
  sql`cast(${sql.lit(name)} as enums.ledger_document_kind)`;
const payKind = (name: string) =>
  sql`cast(${sql.lit(name)} as enums.ledger_payment_kind)`;

const VENDOR_KINDS = [
  "purchase_order",
  "bill",
  "expense",
  "vendor_credit",
  "vendor_payment",
  "vendor_refund",
];

/** SQL list of the given kinds that the block has enabled. */
function kindList(
  docs: LedgerDocumentsBlock,
  names: string[],
  cast: (name: string) => Sql = docKind,
): Sql {
  const enabled = names.filter((name) =>
    (docs.vendors || !VENDOR_KINDS.includes(name)) &&
    (docs.salesTax || name !== "tax_payment")
  );
  return sql`(${enabled.map(cast)})`;
}

const SALES = ["invoice", "sales_receipt", "credit_memo"];
const PURCHASES = ["bill", "expense", "vendor_credit"];

/**
 * Posting, voiding, applying, and converting documents and payments. Each
 * posted document or payment is one ledger entry through the block's
 * `document` or `document_payment` source, with its id as the record id.
 */
export function definePosting(docs: LedgerDocumentsBlock) {
  const kinds = (...names: string[]) => kindList(docs, names);
  const payKinds = (...names: string[]) => kindList(docs, names, payKind);
  const ledger = docs.ledger;
  const source = docs.source;
  const paymentSource = docs.paymentSource;
  const account = (number: string) => ledger.account(number);
  const receivable = account(docs.accounts.receivable);
  const payable = account(docs.accounts.payable);
  const undeposited = account(docs.accounts.undeposited);
  const decimals = sql`${ledger.currencyDecimals}`;
  const items = sql.ref(docs.itemsTable);
  const customerColumn = sql.ref(`${docs.customers.dimension}_id`);
  const vendorColumn = docs.vendors
    ? sql.ref(`${docs.vendors.dimension}_id`)
    : undefined;
  const lineDims = docs.lineDimensions.map((d) => `${d.key}_id`);
  const itemDeferrals = !!ledger.deferralSource &&
    !!system.db.tables[docs.itemsTable]?.fields["deferral_months"];

  /** Posting line fields: account, amount, then the ledger's line columns. */
  const postLineFields: HelperProcField[] = [
    { name: "account_id", type: "BigInt" },
    { name: "amount", type: AMOUNT_TYPE },
    ...ledger.lineColumnSpecs.map((spec) => spec.field),
  ];
  const postLineColumns = ledger.lineColumnSpecs.map((spec) => spec.key);

  /** Party and entity columns every posting line of `doc` carries. */
  const partyColumns: [Sql, Sql][] = [
    [customerColumn, sql`doc.customer_id`],
    ...(vendorColumn ? [[vendorColumn, sql`doc.vendor_id`] as [Sql, Sql]] : []),
    ...(ledger.entities
      ? [[sql`entity_id`, sql`doc.entity_id`] as [Sql, Sql]]
      : []),
  ];

  /**
   * Inserts posting lines. `rows` selects `account_id`, `amount`,
   * `amount_txn` (ignored without multiCurrency), `due_date`, `memo`, and
   * the document line dimensions (null for control lines).
   */
  const insertLines = <T extends IServerBaseStatements>(
    s: T,
    rows: Sql,
    withLineDims: boolean,
  ) => {
    const columns: Sql[] = [sql`account_id`, sql`amount`, sql`memo`];
    const values: Sql[] = [
      sql`row.account_id`,
      sql`row.amount`,
      sql`row.memo`,
    ];
    if (ledger.settlements) {
      columns.push(sql`due_date`);
      values.push(sql`row.due_date`);
    }
    if (ledger.multiCurrency) {
      columns.push(sql`currency`, sql`amount_txn`);
      values.push(
        sql`doc.currency`,
        sql`case when doc.currency is null then null else row.amount_txn end`,
      );
    }
    for (const [column, value] of partyColumns) {
      columns.push(column);
      values.push(value);
    }
    if (withLineDims) {
      for (const dim of lineDims) {
        columns.push(sql.ref(dim));
        values.push(sql`row.${sql.ref(dim)}`);
      }
    }
    s.modify(sql`insert into post_lines (${columns})
      select ${values} from (${rows}) row`);
  };

  const control = (
    accountId: Sql,
    sign: number,
    amount: Sql,
    txn: Sql,
    due: Sql = sql`cast(null as date)`,
  ) =>
    sql`select ${accountId} as account_id, ${sign} * ${amount} as amount,
      ${sign} * ${txn} as amount_txn, ${due} as due_date,
      doc.memo as memo`;

  const docRate = <T extends IServerBaseStatements>(s: T, date: Sql) => {
    s.defScalar(
      "doc_rate",
      ledger.multiCurrency
        ? sql`case when doc.currency is null
            or doc.currency = ${sql.lit(ledger.functionalCurrency)} then 1
          else coalesce(doc.exchange_rate, ${
          ledger.exchangeRateSql(sql`doc.currency`, date)
        }) end`
        : sql`cast(1 as decimal(18, 8))`,
    );
    s.throwErrorIf(
      sql`doc_rate is null`,
      sql.lit`No exchange rate for the currency on this date`,
    );
  };
  const functional = (txn: Sql) => sql`round(${txn} * doc_rate, ${decimals})`;

  const commonColumns = sql`doc.id, doc.kind, doc.number, doc.customer_id,
    ${
    docs.vendors ? sql`doc.vendor_id` : sql`cast(null as bigint) as vendor_id`
  },
    doc.memo, doc.account_id, doc.deposit_id, doc.voided_at,
    ${
    ledger.multiCurrency
      ? sql`doc.currency, doc.exchange_rate`
      : sql`cast(null as string) as currency,
        cast(null as decimal(18, 8)) as exchange_rate`
  },
    ${
    ledger.entities
      ? sql`doc.entity_id`
      : sql`cast(null as bigint) as entity_id`
  }`;

  /** Terms and exemption from the party table's `LedgerPartyTableBlock`. */
  const partyValue = (column: string, fallback: Sql) => {
    const parties = [
      { party: docs.customers, id: sql`doc.customer_id` },
      ...(docs.vendors
        ? [{ party: docs.vendors, id: sql`doc.vendor_id` }]
        : []),
    ].filter(({ party }) => docs.partyHasTerms(party));
    if (!parties.length) return fallback;
    return sql`coalesce(${
      parties.map(({ party, id }) =>
        sql`(select ${sql.ref(column)} from db.${sql.ref(party.table)}
          where id = ${id})`
      )
    }, ${fallback})`;
  };

  // --- Trade documents ------------------------------------------------------

  /**
   * Undoes a posted document: deferrals, then the entry, on `date`
   * or (null) on the document's own dates.
   */
  const undoDocument = <T extends IServerBaseStatements>(s: T, date: Sql) => {
    if (ledger.deferralSource) {
      s.forEachQuery(
        sql`select id from db.ledger_deferrals
          where source = ${source.enumLiteral()}
            and source_record_id = p_document_id and cancelled_on is null`,
        "document_deferral",
        (s) => ledger.cancelDeferral(s, sql`document_deferral.id`, date),
      );
    }
    source.reverse(s, { recordId: sql`p_document_id`, date });
  };
  const noDate = sql`cast(null as date)`;
  /** Null-safe equality of a column between `other` and `doc`. */
  const same = (column: string) =>
    sql`(other.${sql.ref(column)} = doc.${sql.ref(column)}
      or (other.${sql.ref(column)} is null and doc.${
      sql.ref(column)
    } is null))`;

  const docRecord = sql`select ${commonColumns}, doc.document_date,
      doc.due_date, doc.terms_id,
      ${
    docs.salesTax
      ? sql`doc.tax_rate_id, doc.tax_amount`
      : sql`cast(null as bigint) as tax_rate_id,
        cast(null as decimal(18, 4)) as tax_amount`
  }
    from db.ledger_documents doc where doc.id = p_document_id`;

  system.storedProcedure({
    name: "ledger_post_document",
    transaction: "caller",
    inputScalars: [{ name: "p_document_id", type: "BigInt" }],
    procedure: (s) => {
      s.callStoredProcedure("ledger_number_document", {
        inputScalars: { p_document_id: sql`p_document_id` },
      });
      s.defRecord("doc", docRecord);
      s.throwErrorIf(sql`doc.id is null`, sql.lit`Document not found`);
      s.throwErrorIf(
        sql`doc.voided_at is not null`,
        sql.lit`A voided document cannot be posted`,
      );
      s.throwErrorIf(
        sql`doc.number is not null
          and (doc.customer_id is not null or doc.vendor_id is not null)
          and exists (select 1
          from db.ledger_documents other
          where other.id <> doc.id and other.kind = doc.kind
            and other.number = doc.number and other.voided_at is null
            and ${same("customer_id")}
            ${docs.vendors ? sql`and ${same("vendor_id")}` : sql``})`,
        sql`'Another ' || replace(cast(doc.kind as string), '_', ' ')
          || ' already has number ' || doc.number`,
      );
      s.throwErrorIf(
        sql`doc.kind in ${kinds("estimate", "purchase_order")}`,
        sql.lit`Estimates and purchase orders do not post; convert them`,
      );
      s.throwErrorIf(
        sql`doc.kind in ${kinds(...SALES)} and doc.customer_id is null`,
        sql.lit`Choose a customer`,
      );
      if (docs.vendors) {
        s.throwErrorIf(
          sql`doc.kind in ${kinds("bill", "vendor_credit")}
            and doc.vendor_id is null`,
          sql.lit`Choose a vendor`,
        );
      }
      s.throwErrorIf(
        sql`doc.kind = ${docKind("expense")} and doc.account_id is null`,
        sql.lit`Choose the account the expense was paid from`,
      );
      s.throwErrorIf(
        sql`doc.deposit_id is not null`,
        sql
          .lit`This sales receipt is in a deposit; void the deposit to change it`,
      );
      docRate(s, sql`doc.document_date`);
      const txnDecimals = docs.txnDecimalsSql(sql`doc`);

      // Lines with their posting account and functional amount.
      const salesAccount = sql`coalesce(line.account_id, case
        when doc.kind <> ${docKind("credit_memo")}
          ${
        itemDeferrals ? sql`and item.deferral_months > 0` : sql`and false`
      } then ${
        itemDeferrals ? sql`item.deferral_account_id` : sql`null`
      } else item.income_account_id end)`;
      const purchaseAccount = sql`coalesce(line.account_id,
        item.expense_account_id)`;
      const txnAmount = sql`coalesce(line.amount,
        round(line.quantity * line.unit_price, ${txnDecimals}))`;
      s.defTable(
        "doc_lines",
        sql`select line_id, item_id, account_id, amount_txn,
            round(amount_txn * doc_rate, ${decimals}) as amount, quantity,
            memo, taxable, deferral_months, income_account_id,
            expense_account_id ${
          lineDims.length ? sql`, ${lineDims.map((d) => sql.ref(d))}` : sql``
        }
          from (select line.id as line_id, line.item_id,
            case when doc.kind in ${kinds(...SALES)} then ${salesAccount}
              when doc.kind in ${kinds(...PURCHASES)} then ${purchaseAccount}
              else line.account_id end as account_id,
            ${txnAmount} as amount_txn,
            line.quantity, coalesce(line.description, item.name) as memo,
            ${
          docs.salesTax
            ? sql`coalesce(line.taxable, item.taxable, false)`
            : sql`false`
        } as taxable,
            ${
          itemDeferrals
            ? sql`case when doc.kind <> ${docKind("credit_memo")}
                then item.deferral_months end`
            : sql`cast(null as int)`
        } as deferral_months,
            item.income_account_id, item.expense_account_id
            ${
          lineDims.length
            ? sql`, ${lineDims.map((d) => sql`line.${sql.ref(d)}`)}`
            : sql``
        }
          from db.ledger_document_lines line
          left join db.${items} item on item.id = line.item_id
          where line.document_id = p_document_id) priced`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from doc_lines
          where account_id is null or amount_txn is null)`,
        sql
          .lit`Every line needs an amount and an account, or an item with one`,
      );
      // Sales tax from the document's rate, or as entered without one;
      // none for tax-exempt customers.
      s.defScalar(
        "tax_txn",
        sql`case when doc.kind in ${kinds(...SALES)}
          then ${docs.taxSql(sql`p_document_id`, { atPosting: true })}
          else 0 end`,
      );
      s.defScalar("tax_fn", functional(sql`tax_txn`));
      const taxAccount = docs.salesTax
        ? sql`coalesce((select agency.liability_account_id
            from db.ledger_tax_rates rate
            join db.ledger_tax_agencies agency on agency.id = rate.agency_id
            where rate.id = doc.tax_rate_id),
            ${account(docs.accounts.salesTax)})`
        : account(docs.accounts.salesTax);
      s.defScalar(
        "lines_txn",
        sql`coalesce((select sum(amount_txn) from doc_lines), 0)`,
      );
      s.defScalar(
        "lines_fn",
        sql`coalesce((select sum(amount) from doc_lines), 0)`,
      );
      s.defScalar(
        "doc_terms",
        sql`coalesce(doc.terms_id, ${
          partyValue("terms_id", sql`cast(null as bigint)`)
        })`,
      );
      s.defScalar(
        "due_on",
        sql`coalesce(doc.due_date, date.add(day, coalesce((
          select due_days from db.ledger_payment_terms
          where id = doc_terms), 0), doc.document_date))`,
      );

      s.defTable("post_lines", { fields: postLineFields });
      const lineRows = (sign: number) =>
        sql`select account_id, ${sign} * amount as amount,
            ${sign} * amount_txn as amount_txn, cast(null as date) as due_date,
            memo ${
          lineDims.length ? sql`, ${lineDims.map((d) => sql.ref(d))}` : sql``
        }
          from doc_lines`;
      // Installments split the receivable or payable by the terms.
      const installments = (accountId: Sql, sign: number) =>
        sql`select ${accountId} as account_id,
            ${sign} * case when n = c then total_fn - (sum(part_fn) over () - part_fn)
              else part_fn end as amount,
            ${sign} * case when n = c then total_txn - (sum(part_txn) over () - part_txn)
              else part_txn end as amount_txn,
            date.add(day, due_days, doc.document_date) as due_date,
            doc.memo as memo
          from (select due_days,
              row_number() over (order by due_days, id) as n,
              count(*) over () as c,
              lines_fn + tax_fn as total_fn, lines_txn + tax_txn as total_txn,
              round((lines_fn + tax_fn) * percent / 100, ${decimals}) as part_fn,
              round((lines_txn + tax_txn) * percent / 100, ${txnDecimals})
                as part_txn
            from db.ledger_payment_term_installments
            where terms_id = doc_terms) installment`;
      const hasInstallments = sql`exists (select 1
        from db.ledger_payment_term_installments where terms_id = doc_terms)`;
      const total = (accountId: Sql, sign: number) =>
        control(
          accountId,
          sign,
          sql`(lines_fn + tax_fn)`,
          sql`(lines_txn + tax_txn)`,
          sql`due_on`,
        );
      const openItem = <S extends IServerBaseStatements>(
        s: S,
        accountId: Sql,
        sign: number,
      ) =>
        s.if(
          hasInstallments,
          (s) => insertLines(s, installments(accountId, sign), false),
          (s) => insertLines(s, total(accountId, sign), false),
        );
      const tax = <S extends IServerBaseStatements>(s: S, sign: number) =>
        s.if(sql`tax_txn <> 0`, (s) =>
          insertLines(
            s,
            control(taxAccount, sign, sql`tax_fn`, sql`tax_txn`),
            false,
          ));

      s.if(sql`doc.kind = ${docKind("invoice")}`, (s) => {
        openItem(s, receivable, 1);
        insertLines(s, lineRows(-1), true);
        tax(s, -1);
      });
      s.if(sql`doc.kind = ${docKind("sales_receipt")}`, (s) => {
        insertLines(
          s,
          total(sql`coalesce(doc.account_id, ${undeposited})`, 1),
          false,
        );
        insertLines(s, lineRows(-1), true);
        tax(s, -1);
      });
      s.if(sql`doc.kind = ${docKind("credit_memo")}`, (s) => {
        insertLines(s, total(receivable, -1), false);
        insertLines(s, lineRows(1), true);
        tax(s, 1);
      });
      if (docs.vendors) {
        s.if(sql`doc.kind = ${docKind("bill")}`, (s) => {
          openItem(s, payable, -1);
          insertLines(s, lineRows(1), true);
        });
        s.if(sql`doc.kind = ${docKind("expense")}`, (s) => {
          insertLines(
            s,
            control(sql`doc.account_id`, -1, sql`lines_fn`, sql`lines_txn`),
            false,
          );
          insertLines(s, lineRows(1), true);
        });
        s.if(sql`doc.kind = ${docKind("vendor_credit")}`, (s) => {
          insertLines(
            s,
            control(payable, 1, sql`lines_fn`, sql`lines_txn`, sql`due_on`),
            false,
          );
          insertLines(s, lineRows(-1), true);
        });
      }

      // A save that changes nothing financial (memo, number typed the
      // same) keeps the posting, so payments stay applied and reports for
      // past dates do not move; otherwise the entry is reversed on its own
      // dates and posted again.
      const compared = [
        "account_id",
        "amount",
        ...ledger.lineColumnSpecs
          .map((spec) => spec.field.name)
          .filter((name) => name !== "memo"),
      ];
      const lineKey = (alias: string) =>
        sql`${
          compared
            .map((c) =>
              sql`coalesce(cast(${sql.ref(alias)}.${
                sql.ref(c)
              } as string), '~')`
            )
            .reduce((a, b) => sql`${a} || '|' || ${b}`)
        }`;
      s.defScalar("previous_entry_id", {
        type: "BigInt",
        expr: source.activeEntryId(sql`p_document_id`),
      });
      s.defScalar(
        "posting_unchanged",
        sql`previous_entry_id is not null
          and (select posting_date from db.ledger_entries
            where id = previous_entry_id) = doc.document_date
          and coalesce((select document_number from db.ledger_entries
            where id = previous_entry_id), '~') = coalesce(doc.number, '~')
          and (select count(*) from post_lines)
            = (select count(*) from db.ledger_lines
              where entry_id = previous_entry_id)
          and not exists (select 1 from (select ${lineKey("new_line")} as k,
                count(*) as n
              from post_lines new_line group by ${lineKey("new_line")}) proposed
            where proposed.n <> (select count(*) from db.ledger_lines old_line
              where old_line.entry_id = previous_entry_id
                and ${lineKey("old_line")} = proposed.k))`,
      );
      s.if(sql`not posting_unchanged`, (s) => {
        s.if(
          sql`previous_entry_id is not null`,
          (s) => undoDocument(s, noDate),
        );
        source.post(s, {
          recordId: sql`p_document_id`,
          date: sql`doc.document_date`,
          description: sql`coalesce(doc.memo, cast(doc.kind as string))`,
          documentNumber: sql`doc.number`,
          lines: {
            query: sql`select * from post_lines`,
            columns: postLineColumns,
          },
        });

        // Deferred items are recognized over their months.
        if (itemDeferrals) {
          const deferralDims = ledger.dimensions.map((d) => `${d.key}_id`);
          const dimValue = (dim: string) =>
            dim === `${docs.customers.dimension}_id`
              ? sql`doc.customer_id`
              : docs.vendors && dim === `${docs.vendors.dimension}_id`
              ? sql`doc.vendor_id`
              : dim === "entity_id"
              ? sql`doc.entity_id`
              : sql`line.${sql.ref(dim)}`;
          s.modify(sql`insert into db.ledger_deferrals
            (description, deferral_account_id, recognition_account_id, amount,
              start_on, months, source, source_record_id
              ${
            deferralDims.length
              ? sql`, ${deferralDims.map((d) => sql.ref(d))}`
              : sql``
          })
            select coalesce(line.memo, 'Deferred revenue'), line.account_id,
              line.income_account_id, -line.amount,
              doc.document_date, line.deferral_months, ${source.enumLiteral()},
              p_document_id
              ${
            deferralDims.length ? sql`, ${deferralDims.map(dimValue)}` : sql``
          }
            from doc_lines line
            where line.deferral_months > 0
              and doc.kind in ${kinds("invoice", "sales_receipt")}`);
        }

        if (docs.salesTax) {
          s.modify(sql`update db.ledger_documents
            set posted_tax = tax_txn, posted_tax_rate_id = tax_rate_id,
              posted_tax_rate = (select rate from db.ledger_tax_rates
                where id = tax_rate_id)
            where id = p_document_id`);
        }
      });
    },
  });

  system.storedProcedure({
    name: "ledger_void_document",
    transaction: "caller",
    inputScalars: [
      { name: "p_document_id", type: "BigInt" },
      // Reverses on this date; null reverses on the document's own dates.
      { name: "p_date", type: "Date" },
    ],
    procedure: (s) => {
      s.defRecord("doc", docRecord);
      s.throwErrorIf(
        sql`doc.id is null or doc.voided_at is not null`,
        sql.lit`This document is already void`,
      );
      s.throwErrorIf(
        sql`doc.deposit_id is not null`,
        sql.lit`Void the deposit that includes this sales receipt first`,
      );
      s.if(
        source.isPosted(sql`p_document_id`),
        (s) => undoDocument(s, sql`p_date`),
      );
      s.modify(sql`update db.ledger_documents
        set voided_at = now(), voided_by = current_user
        where id = p_document_id`);
    },
  });

  // An estimate becomes an invoice, a purchase order a bill; the source
  // closes.
  system.storedProcedure({
    name: "ledger_convert_document",
    transaction: "caller",
    inputScalars: [{ name: "p_document_id", type: "BigInt" }],
    outputScalars: [{ name: "new_document_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "doc",
        sql`select id, kind, closed_at, voided_at from db.ledger_documents
          where id = p_document_id`,
      );
      s.throwErrorIf(
        sql`doc.id is null or doc.kind not in ${
          kinds("estimate", "purchase_order")
        } or doc.closed_at is not null or doc.voided_at is not null`,
        sql.lit`Only open estimates and purchase orders convert`,
      );
      const copied = [
        "customer_id",
        ...(docs.vendors ? ["vendor_id"] : []),
        "terms_id",
        "memo",
        ...(docs.salesTax ? ["tax_rate_id", "tax_amount"] : []),
        ...(ledger.multiCurrency ? ["currency", "exchange_rate"] : []),
        ...(ledger.entities ? ["entity_id"] : []),
      ].map((c) => sql.ref(c));
      s.defScalar("converted_id", { type: "BigInt" });
      s.modify(sql`insert into db.ledger_documents
        (kind, document_date, source_document_id, ${copied})
        select case when kind = ${docKind("estimate")}
            then ${docKind("invoice")}
            else ${docs.vendors ? docKind("bill") : docKind("invoice")} end,
          current_date(), id, ${copied}
        from db.ledger_documents where id = p_document_id
        returning id into converted_id`);
      const lineColumns = [
        "item_id",
        "account_id",
        "description",
        "quantity",
        "unit_price",
        "amount",
        ...(docs.salesTax ? ["taxable"] : []),
        ...lineDims,
      ].map((c) => sql.ref(c));
      s.modify(sql`insert into db.ledger_document_lines
        (document_id, ${lineColumns})
        select converted_id, ${lineColumns} from db.ledger_document_lines
        where document_id = p_document_id`);
      s.modify(sql`update db.ledger_documents set closed_at = now()
        where id = p_document_id`);
      s.setScalar("new_document_id", sql`converted_id`);
    },
  });

  // --- Payments -------------------------------------------------------------

  const paymentRecord = sql`select ${commonColumns}, doc.payment_date,
      doc.amount,
      ${
    docs.salesTax
      ? sql`doc.tax_agency_id`
      : sql`cast(null as bigint) as tax_agency_id`
  }
    from db.ledger_payments doc where doc.id = p_payment_id`;

  system.storedProcedure({
    name: "ledger_post_payment",
    transaction: "caller",
    inputScalars: [{ name: "p_payment_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord("doc", paymentRecord);
      s.throwErrorIf(sql`doc.id is null`, sql.lit`Payment not found`);
      s.throwErrorIf(
        sql`doc.voided_at is not null`,
        sql.lit`A voided payment cannot be posted`,
      );
      s.throwErrorIf(
        sql`doc.deposit_id is not null`,
        sql.lit`This payment is in a deposit; void the deposit to change it`,
      );
      s.throwErrorIf(
        sql`doc.kind in ${payKinds("customer_payment", "customer_refund")}
          and doc.customer_id is null`,
        sql.lit`Choose a customer`,
      );
      if (docs.vendors) {
        s.throwErrorIf(
          sql`doc.kind in ${payKinds("vendor_payment", "vendor_refund")}
            and doc.vendor_id is null`,
          sql.lit`Choose a vendor`,
        );
      }
      s.throwErrorIf(
        sql`doc.kind = ${payKind("write_off")}
          and (doc.customer_id is null) = (doc.vendor_id is null)`,
        sql.lit`A write-off is for one customer or one vendor`,
      );
      s.throwErrorIf(
        sql`doc.kind <> ${payKind("customer_payment")}
          and doc.account_id is null`,
        sql.lit`Choose the account the money moves through`,
      );
      s.throwErrorIf(
        sql`doc.kind <> ${payKind("deposit")} and doc.amount <= 0`,
        sql.lit`A payment needs a positive amount`,
      );
      s.if(
        paymentSource.isPosted(sql`p_payment_id`),
        (s) => paymentSource.reverse(s, { recordId: sql`p_payment_id` }),
      );
      docRate(s, sql`doc.payment_date`);
      s.defTable("post_lines", { fields: postLineFields });
      const move = <S extends IServerBaseStatements>(
        s: S,
        from: Sql,
        to: Sql,
        amount: Sql,
        txn: Sql,
      ) => {
        insertLines(s, control(to, 1, amount, txn), false);
        insertLines(s, control(from, -1, amount, txn), false);
      };

      s.if(sql`doc.kind = ${payKind("customer_payment")}`, (s) =>
        move(
          s,
          receivable,
          sql`coalesce(doc.account_id, ${undeposited})`,
          functional(sql`doc.amount`),
          sql`doc.amount`,
        ));
      if (docs.vendors) {
        s.if(sql`doc.kind = ${payKind("vendor_payment")}`, (s) =>
          move(
            s,
            sql`doc.account_id`,
            payable,
            functional(sql`doc.amount`),
            sql`doc.amount`,
          ));
      }
      // Deposits move payments and sales receipts out of undeposited funds;
      // the deposit's amount is their total.
      s.if(sql`doc.kind = ${payKind("deposit")}`, (s) => {
        const undepositedOf = (table: string, entrySource: Sql) =>
          sql`select line.amount from db.${sql.ref(table)} included
            join db.ledger_entries entry on entry.source = ${entrySource}
              and entry.source_record_id = included.id
            join db.ledger_lines line on line.entry_id = entry.id
            where included.deposit_id = p_payment_id
              and line.account_id = ${undeposited}
              and ${ledger.isActiveEntrySql(sql`entry`)}`;
        s.defScalar(
          "deposited",
          sql`coalesce((select sum(amount) from (
            ${undepositedOf("ledger_payments", paymentSource.enumLiteral())}
            union all
            ${undepositedOf("ledger_documents", source.enumLiteral())}
          ) included_line), 0)`,
        );
        s.throwErrorIf(
          sql`deposited <= 0`,
          sql.lit`Choose payments to deposit`,
        );
        s.modify(sql`update db.ledger_payments set amount = deposited
          where id = p_payment_id`);
        move(
          s,
          undeposited,
          sql`doc.account_id`,
          sql`deposited`,
          sql`deposited`,
        );
      });
      if (docs.salesTax) {
        s.if(sql`doc.kind = ${payKind("tax_payment")}`, (s) => {
          s.throwErrorIf(
            sql`doc.tax_agency_id is null`,
            sql.lit`Choose the tax agency`,
          );
          move(
            s,
            sql`doc.account_id`,
            sql`(select liability_account_id from db.ledger_tax_agencies
              where id = doc.tax_agency_id)`,
            functional(sql`doc.amount`),
            sql`doc.amount`,
          );
        });
      }
      // Refunds pay back a credit; write-offs clear what is left of an
      // invoice or bill to an expense or income account.
      s.if(sql`doc.kind = ${payKind("customer_refund")}`, (s) =>
        move(
          s,
          sql`doc.account_id`,
          receivable,
          functional(sql`doc.amount`),
          sql`doc.amount`,
        ));
      if (docs.vendors) {
        s.if(sql`doc.kind = ${payKind("vendor_refund")}`, (s) =>
          move(
            s,
            payable,
            sql`doc.account_id`,
            functional(sql`doc.amount`),
            sql`doc.amount`,
          ));
      }
      s.if(
        sql`doc.kind = ${payKind("write_off")} and doc.customer_id is not null`,
        (s) =>
          move(
            s,
            receivable,
            sql`doc.account_id`,
            functional(sql`doc.amount`),
            sql`doc.amount`,
          ),
      );
      if (docs.vendors) {
        s.if(
          sql`doc.kind = ${payKind("write_off")} and doc.vendor_id is not null`,
          (s) =>
            move(
              s,
              sql`doc.account_id`,
              payable,
              functional(sql`doc.amount`),
              sql`doc.amount`,
            ),
        );
      }
      paymentSource.post(s, {
        recordId: sql`p_payment_id`,
        date: sql`doc.payment_date`,
        description: sql`coalesce(doc.memo, cast(doc.kind as string))`,
        documentNumber: sql`doc.number`,
        lines: {
          query: sql`select * from post_lines`,
          columns: postLineColumns,
        },
      });
    },
  });

  system.storedProcedure({
    name: "ledger_void_payment",
    transaction: "caller",
    inputScalars: [
      { name: "p_payment_id", type: "BigInt" },
      { name: "p_date", type: "Date" },
    ],
    procedure: (s) => {
      s.defRecord("doc", paymentRecord);
      s.throwErrorIf(
        sql`doc.id is null or doc.voided_at is not null`,
        sql.lit`This payment is already void`,
      );
      s.throwErrorIf(
        sql`doc.deposit_id is not null`,
        sql.lit`Void the deposit that includes this payment first`,
      );
      s.if(
        paymentSource.isPosted(sql`p_payment_id`),
        (s) =>
          paymentSource.reverse(s, {
            recordId: sql`p_payment_id`,
            date: sql`p_date`,
          }),
      );
      // A voided deposit returns its receipts to undeposited funds.
      s.modify(sql`update db.ledger_payments set deposit_id = null
        where deposit_id = p_payment_id`);
      s.modify(sql`update db.ledger_documents set deposit_id = null
        where deposit_id = p_payment_id`);
      s.modify(sql`update db.ledger_payments
        set voided_at = now(), voided_by = current_user
        where id = p_payment_id`);
    },
  });

  // Applies `p_amount` (in the entries' currency) of a payment or credit
  // entry to an invoice or bill entry, earliest due installment first.
  system.storedProcedure({
    name: "ledger_apply_entries",
    transaction: "caller",
    inputScalars: [
      { name: "p_from_entry_id", type: "BigInt" },
      { name: "p_to_entry_id", type: "BigInt" },
      { name: "p_amount", type: AMOUNT_TYPE },
      { name: "p_date", type: "Date" },
    ],
    procedure: (s) => {
      const openOf = (lineId: Sql) =>
        ledger.multiCurrency
          ? sql`case when (select currency from db.ledger_lines
              where id = ${lineId}) is null
              then ${ledger.openAmountSql(lineId)}
              else ${ledger.openAmountTxnSql(lineId)} end`
          : ledger.openAmountSql(lineId);
      const openLines = (entryId: Sql, positive: boolean) =>
        sql`select line.id, ${openOf(sql`line.id`)} as open,
            coalesce(line.due_date, line.posting_date) as due
          from db.ledger_lines line
          join db.ledger_accounts account on account.id = line.account_id
          where line.entry_id = ${entryId}
            and account.type in (
              cast('accounts_receivable' as enums.ledger_account_type),
              cast('accounts_payable' as enums.ledger_account_type))
            and line.amount ${positive ? sql`>` : sql`<`} 0`;
      s.throwErrorIf(
        sql`p_from_entry_id is null or p_to_entry_id is null`,
        sql.lit`Post both before applying`,
      );
      s.throwErrorIf(
        sql`coalesce(p_amount, 0) <= 0`,
        sql.lit`Apply a positive amount`,
      );
      // Invoices and payments to vendors are the debit side.
      s.defScalar(
        "to_is_debit",
        sql`exists (${openLines(sql`p_to_entry_id`, true)})`,
      );
      s.defScalar("apply_remaining", sql`p_amount`);
      s.while(sql`apply_remaining > 0`, (s) => {
        // Earliest due, then lowest id; min() rather than `order by ...
        // limit 1`, which the optimizer can drop from a scalar subquery.
        const first = (entryId: Sql, positive: boolean) =>
          sql`(select min(id) from (${openLines(entryId, positive)}) open_line
            where open > 0 and due = (select min(due)
              from (${openLines(entryId, positive)}) earliest
              where open > 0))`;
        s.defScalar(
          "debit_line",
          sql`case when to_is_debit then ${first(sql`p_to_entry_id`, true)}
            else ${first(sql`p_from_entry_id`, true)} end`,
        );
        s.defScalar(
          "credit_line",
          sql`case when to_is_debit then ${first(sql`p_from_entry_id`, false)}
            else ${first(sql`p_to_entry_id`, false)} end`,
        );
        s.throwErrorIf(
          sql`debit_line is null or credit_line is null`,
          sql.lit`The amount is more than is open on these documents`,
        );
        s.defScalar(
          "apply_now",
          sql`least(apply_remaining, ${openOf(sql`debit_line`)},
            ${openOf(sql`credit_line`)})`,
        );
        const foreign = ledger.multiCurrency
          ? sql`(select currency from db.ledger_lines where id = debit_line)
            is not null`
          : sql`false`;
        ledger.settle(s, {
          debitLineId: sql`debit_line`,
          creditLineId: sql`credit_line`,
          amount: sql`case when ${foreign} then null else apply_now end`,
          amountTxn: ledger.multiCurrency
            ? sql`case when ${foreign} then apply_now end`
            : undefined,
          date: sql`p_date`,
        });
        s.setScalar("apply_remaining", sql`apply_remaining - apply_now`);
      });
    },
  });

  // Takes back everything settled between two entries, e.g. a payment
  // applied to the wrong invoice.
  system.storedProcedure({
    name: "ledger_unapply_entries",
    transaction: "caller",
    inputScalars: [
      { name: "p_entry_id", type: "BigInt" },
      { name: "p_other_entry_id", type: "BigInt" },
      { name: "p_date", type: "Date" },
    ],
    procedure: (s) => {
      const txn = ledger.multiCurrency
        ? sql`sum(settlement.amount_txn)`
        : sql`cast(null as decimal(18, 4))`;
      s.forEachQuery(
        sql`select settlement.debit_line_id, settlement.credit_line_id,
            sum(settlement.amount) as amount, ${txn} as amount_txn
          from db.ledger_settlements settlement
          join db.ledger_lines debit on debit.id = settlement.debit_line_id
          join db.ledger_lines credit on credit.id = settlement.credit_line_id
          where (debit.entry_id = p_entry_id
              and credit.entry_id = p_other_entry_id)
            or (debit.entry_id = p_other_entry_id
              and credit.entry_id = p_entry_id)
          group by settlement.debit_line_id, settlement.credit_line_id
          having sum(settlement.amount) <> 0 ${
          ledger.multiCurrency ? sql`or ${txn} <> 0` : sql``
        }`,
        "applied_pair",
        (s) =>
          ledger.settle(s, {
            debitLineId: sql`applied_pair.debit_line_id`,
            creditLineId: sql`applied_pair.credit_line_id`,
            amount: sql`case when applied_pair.amount_txn is null
              then -applied_pair.amount end`,
            amountTxn: ledger.multiCurrency
              ? sql`-applied_pair.amount_txn`
              : undefined,
            date: sql`p_date`,
          }),
      );
    },
  });

  // Numbers estimates, invoices, sales receipts, credit memos, and purchase
  // orders left without one, skipping numbers typed by hand.
  const numbered = Object.keys(NUMBERED_KINDS).filter((k) =>
    docs.vendors || !VENDOR_KINDS.includes(k)
  );
  system.storedProcedure({
    name: "ledger_number_document",
    transaction: "caller",
    inputScalars: [{ name: "p_document_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "unnumbered",
        sql`select id, kind from db.ledger_documents
          where id = p_document_id and number is null
            and kind in ${kinds(...numbered)}`,
      );
      s.if(sql`unnumbered.id is not null`, (s) => {
        s.modify(sql`insert into db.ledger_document_sequences (kind, prefix)
          select unnumbered.kind, ${
          sql.caseWhen({
            conditions: numbered.map((k) => ({
              condition: sql`unnumbered.kind = ${docKind(k)}`,
              expr: sql.lit(NUMBERED_KINDS[k]),
            })),
            default: sql`''`,
          })
        }
          where not exists (select 1 from db.ledger_document_sequences
            where kind = unnumbered.kind)`);
        s.defScalar(
          "number_prefix",
          sql`(select prefix from db.ledger_document_sequences
            where kind = unnumbered.kind)`,
        );
        s.defScalar(
          "next_doc_number",
          sql`(select next_number from db.ledger_document_sequences
            where kind = unnumbered.kind)`,
        );
        s.while(
          sql`exists (select 1 from db.ledger_documents
            where kind = unnumbered.kind
              and number = number_prefix || cast(next_doc_number as string))`,
          (s) => s.setScalar("next_doc_number", sql`next_doc_number + 1`),
        );
        s.modify(sql`update db.ledger_documents
          set number = number_prefix || cast(next_doc_number as string)
          where id = p_document_id`);
        s.modify(sql`update db.ledger_document_sequences
          set next_number = next_doc_number + 1
          where kind = unnumbered.kind`);
      });
    },
  });
}

/** Document and payment actions; each runs in the caller's transaction. */
export function documentActions(docs: LedgerDocumentsBlock) {
  const payKinds = (...names: string[]) => kindList(docs, names, payKind);
  const ledger = docs.ledger;
  const call = <T extends IServerBaseStatements>(
    s: T,
    proc: string,
    inputScalars: Record<string, Sql>,
  ) => s.callStoredProcedure(proc, { inputScalars });
  const applyEntries = <T extends IServerBaseStatements>(
    s: T,
    from: Sql,
    to: Sql,
    opts: { amount: Sql; date: Sql },
  ) =>
    call(s, "ledger_apply_entries", {
      p_from_entry_id: from,
      p_to_entry_id: to,
      p_amount: opts.amount,
      p_date: opts.date,
    });
  const apply = <T extends IServerBaseStatements>(
    s: T,
    from: Sql,
    opts: { documentId: Sql; amount: Sql; date: Sql },
  ) => applyEntries(s, from, docs.source.activeEntryId(opts.documentId), opts);
  const noDate = sql`cast(null as date)`;
  const actions = {
    /**
     * Loads an invoice, bill, credit memo, or vendor credit still open at
     * cut-over from the previous system: one line on the opening balance
     * equity account (3900), so the trial balance moved by journal is not
     * counted twice, and payments can then be applied to it.
     */
    openItem<T extends IServerBaseStatements>(
      s: T,
      opts: {
        kind: "invoice" | "bill" | "credit_memo" | "vendor_credit";
        partyId: Sql;
        date: Sql;
        amount: Sql;
        number?: Sql;
        dueDate?: Sql;
        memo?: Sql;
        intoDocumentId: string;
      },
    ) {
      const id = sql.ref(opts.intoDocumentId);
      const vendor = opts.kind === "bill" || opts.kind === "vendor_credit";
      s.modify(sql`insert into db.ledger_documents
        (kind, document_date, due_date, number, memo,
          ${vendor ? sql`vendor_id` : sql`customer_id`})
        values (${docKind(opts.kind)}, ${opts.date},
          ${opts.dueDate ?? sql`null`}, ${opts.number ?? sql`null`},
          ${opts.memo ?? sql.lit`Opening balance`}, ${opts.partyId})
        returning id into ${id}`);
      s.modify(sql`insert into db.ledger_document_lines
        (document_id, account_id, amount, description)
        values (${id}, ${ledger.account(docs.accounts.openingBalance)},
          ${opts.amount}, 'Open at cut-over')`);
      actions.post(s, id);
    },
    /** Posts a draft, or reposts an edited posted document. */
    post<T extends IServerBaseStatements>(s: T, documentId: Sql) {
      call(s, "ledger_post_document", { p_document_id: documentId });
    },
    /**
     * Reverses a posted document and marks it void, on `date` (e.g. the
     * first open day when its month is closed) or on its own dates.
     */
    void<T extends IServerBaseStatements>(
      s: T,
      documentId: Sql,
      date?: Sql,
    ) {
      call(s, "ledger_void_document", {
        p_document_id: documentId,
        p_date: date ?? noDate,
      });
    },
    /** Gives an estimate, invoice, sales receipt, credit memo, or purchase
     * order the next number of its kind when it has none. */
    number<T extends IServerBaseStatements>(s: T, documentId: Sql) {
      call(s, "ledger_number_document", { p_document_id: documentId });
    },
    /** Converts an estimate to an invoice or a purchase order to a bill. */
    convert<T extends IServerBaseStatements>(
      s: T,
      documentId: Sql,
      intoDocumentId: string,
    ) {
      s.callStoredProcedure("ledger_convert_document", {
        inputScalars: { p_document_id: documentId },
        outputScalars: { new_document_id: intoDocumentId },
      });
    },
    /** Posts a payment, or reposts an edited one. */
    postPayment<T extends IServerBaseStatements>(s: T, paymentId: Sql) {
      call(s, "ledger_post_payment", { p_payment_id: paymentId });
    },
    /** Reverses a posted payment and marks it void, on `date` or its own. */
    voidPayment<T extends IServerBaseStatements>(
      s: T,
      paymentId: Sql,
      date?: Sql,
    ) {
      call(s, "ledger_void_payment", {
        p_payment_id: paymentId,
        p_date: date ?? noDate,
      });
    },
    /**
     * Takes back everything applied between two posted entries (a
     * document's or payment's `activeEntryId`), dated `date`.
     */
    unapply<T extends IServerBaseStatements>(
      s: T,
      opts: { entryId: Sql; otherEntryId: Sql; date: Sql },
    ) {
      call(s, "ledger_unapply_entries", {
        p_entry_id: opts.entryId,
        p_other_entry_id: opts.otherEntryId,
        p_date: opts.date,
      });
    },
    /**
     * Applies an open credit (a credit memo, vendor credit, or unapplied
     * payment, by its posted entry) to an invoice or bill.
     */
    applyEntry<T extends IServerBaseStatements>(
      s: T,
      opts: { fromEntryId: Sql; documentId: Sql; amount: Sql; date: Sql },
    ) {
      apply(s, opts.fromEntryId, opts);
    },
    /**
     * Writes off what is left open on an invoice (to an expense such as bad
     * debt or discounts) or a bill (to income), as a posted `write_off`
     * applied to it.
     */
    writeOff<T extends IServerBaseStatements>(
      s: T,
      opts: {
        documentId: Sql;
        accountId: Sql;
        date: Sql;
        /** Defaults to the open balance. */
        amount?: Sql;
        intoPaymentId: string;
      },
    ) {
      const writeOffId = sql.ref(opts.intoPaymentId);
      const copied = [
        "customer_id",
        ...(docs.vendors ? ["vendor_id"] : []),
        ...(ledger.multiCurrency ? ["currency", "exchange_rate"] : []),
        ...(ledger.entities ? ["entity_id"] : []),
      ].map((c) => sql.ref(c));
      s.modify(sql`insert into db.ledger_payments
        (kind, payment_date, amount, account_id, memo, ${copied})
        select ${payKind("write_off")}, ${opts.date},
          ${opts.amount ?? docs.openBalanceSql(sql`written.id`)},
          ${opts.accountId},
          'Write-off of ' || coalesce(written.number,
            'document ' || written.id),
          ${copied.map((c) => sql`written.${c}`)}
        from db.ledger_documents written where written.id = ${opts.documentId}
        returning id into ${writeOffId}`);
      actions.postPayment(s, writeOffId);
      actions.applyPayment(s, {
        paymentId: writeOffId,
        documentId: opts.documentId,
        amount: sql`(select amount from db.ledger_payments
          where id = ${writeOffId})`,
        date: opts.date,
      });
    },
    /**
     * Pays back an open credit (a credit memo, vendor credit, or unapplied
     * payment, by its posted entry) from or into `accountId`.
     */
    refund<T extends IServerBaseStatements>(
      s: T,
      opts: {
        kind: "customer_refund" | "vendor_refund";
        partyId: Sql;
        fromEntryId: Sql;
        accountId: Sql;
        date: Sql;
        amount: Sql;
        intoPaymentId: string;
      },
    ) {
      const refundId = sql.ref(opts.intoPaymentId);
      const party = opts.kind === "customer_refund"
        ? sql`customer_id`
        : sql`vendor_id`;
      // In the credit's currency and entity, so it can settle against it.
      s.modify(sql`insert into db.ledger_payments
        (kind, payment_date, ${party}, amount, account_id
          ${ledger.multiCurrency ? sql`, currency` : sql``}
          ${ledger.entities ? sql`, entity_id` : sql``})
        values (${payKind(opts.kind)}, ${opts.date}, ${opts.partyId},
          ${opts.amount}, ${opts.accountId}
          ${
        ledger.multiCurrency
          ? sql`, (select min(currency) from db.ledger_lines
            where entry_id = ${opts.fromEntryId})`
          : sql``
      }
          ${
        ledger.entities
          ? sql`, (select min(entity_id) from db.ledger_lines
            where entry_id = ${opts.fromEntryId})`
          : sql``
      })
        returning id into ${refundId}`);
      actions.postPayment(s, refundId);
      applyEntries(
        s,
        opts.fromEntryId,
        docs.paymentSource.activeEntryId(refundId),
        opts,
      );
    },
    /**
     * Applies part of a posted payment to an invoice or bill, in their
     * currency.
     */
    applyPayment<T extends IServerBaseStatements>(
      s: T,
      opts: { paymentId: Sql; documentId: Sql; amount: Sql; date: Sql },
    ) {
      apply(s, docs.paymentSource.activeEntryId(opts.paymentId), opts);
    },
    /** Applies a credit memo or vendor credit to an invoice or bill. */
    applyCredit<T extends IServerBaseStatements>(
      s: T,
      opts: { creditId: Sql; documentId: Sql; amount: Sql; date: Sql },
    ) {
      apply(s, docs.source.activeEntryId(opts.creditId), opts);
    },
    /**
     * Records a customer payment or bill payment and applies it.
     * `applications` names a local table with `docs.applicationFields`
     * (invoice or bill id, amount); what is not applied stays as an open
     * credit.
     */
    recordPayment<T extends IServerBaseStatements>(
      s: T,
      opts: {
        kind: "customer_payment" | "vendor_payment";
        partyId: Sql;
        date: Sql;
        amount: Sql;
        /** Received into or paid from; payments default to undeposited funds. */
        accountId?: Sql;
        /** Check or reference number. */
        number?: Sql;
        applications: string;
        intoPaymentId: string;
      },
    ) {
      const party = opts.kind === "customer_payment"
        ? sql`customer_id`
        : sql`vendor_id`;
      const paymentId = sql.ref(opts.intoPaymentId);
      // In the currency and entity of the documents it pays.
      const applied = (column: string) =>
        sql`(select min(${sql.ref(column)}) from db.ledger_documents
          where id in (select document_id from ${sql.ref(opts.applications)}))`;
      s.modify(sql`insert into db.ledger_payments
        (kind, payment_date, ${party}, amount, account_id, number
          ${ledger.multiCurrency ? sql`, currency` : sql``}
          ${ledger.entities ? sql`, entity_id` : sql``})
        values (${payKind(opts.kind)}, ${opts.date}, ${opts.partyId},
          ${opts.amount}, ${opts.accountId ?? sql`null`},
          ${opts.number ?? sql`null`}
          ${ledger.multiCurrency ? sql`, ${applied("currency")}` : sql``}
          ${ledger.entities ? sql`, ${applied("entity_id")}` : sql``})
        returning id into ${paymentId}`);
      actions.postPayment(s, paymentId);
      const application = ledger.uniqueName("document_application");
      s.forEachQuery(
        sql`select document_id, amount from ${sql.ref(opts.applications)}
          where amount > 0`,
        application,
        (s) =>
          actions.applyPayment(s, {
            paymentId,
            documentId: sql`${sql.ref(application)}.document_id`,
            amount: sql`${sql.ref(application)}.amount`,
            date: opts.date,
          }),
      );
    },
    /**
     * Deposits payments and sales receipts held in undeposited funds into
     * a bank account as one deposit. `included` names a local table with
     * `docs.depositFields`: a `payment_id` or a `document_id` per row.
     */
    deposit<T extends IServerBaseStatements>(
      s: T,
      opts: {
        accountId: Sql;
        date: Sql;
        included: string;
        intoPaymentId: string;
      },
    ) {
      const included = sql.ref(opts.included);
      const depositId = sql.ref(opts.intoPaymentId);
      s.throwErrorIf(
        sql`exists (select 1 from db.ledger_payments
          where id in (select payment_id from ${included})
            and (deposit_id is not null or voided_at is not null
              or kind not in ${payKinds("customer_payment")}))
          or exists (select 1 from db.ledger_documents
          where id in (select document_id from ${included})
            and (deposit_id is not null or voided_at is not null
              or kind <> ${docKind("sales_receipt")}))`,
        sql.lit`Only undeposited payments and sales receipts can be deposited`,
      );
      // Only what sits in undeposited funds: posted, and received there.
      const inUndeposited = (entrySource: Sql, recordId: Sql) =>
        sql`exists (select 1 from db.ledger_entries entry
          join db.ledger_lines line on line.entry_id = entry.id
          where entry.source = ${entrySource}
            and entry.source_record_id = ${recordId}
            and ${ledger.isActiveEntrySql(sql`entry`)}
            and line.account_id = ${
          ledger.account(docs.accounts.undeposited)
        } and line.amount > 0)`;
      s.throwErrorIf(
        sql`exists (select 1 from ${included} held
          where (held.payment_id is not null and not ${
          inUndeposited(docs.paymentSource.enumLiteral(), sql`held.payment_id`)
        }) or (held.document_id is not null and not ${
          inUndeposited(docs.source.enumLiteral(), sql`held.document_id`)
        }))`,
        sql
          .lit`Only posted payments received into undeposited funds can be deposited`,
      );
      s.modify(sql`insert into db.ledger_payments
        (kind, payment_date, account_id, amount)
        values (${payKind("deposit")}, ${opts.date}, ${opts.accountId}, 0)
        returning id into ${depositId}`);
      s.modify(sql`update db.ledger_payments set deposit_id = ${depositId}
        where id in (select payment_id from ${included})`);
      s.modify(sql`update db.ledger_documents set deposit_id = ${depositId}
        where id in (select document_id from ${included})`);
      actions.postPayment(s, depositId);
    },
  };
  return actions;
}
