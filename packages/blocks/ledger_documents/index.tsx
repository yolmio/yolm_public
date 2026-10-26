import { AMOUNT_TYPE, currencyDecimalsSql } from "blocks/ledger";
import type { LedgerBlock, LedgerSource } from "blocks/ledger";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { HelperProcField, IServerBaseStatements } from "std/statements";
import { system, TableBlock } from "std/system";
import type { Block, TableBuilder } from "std/system";
import { definePosting, documentActions } from "./posting.ts";

export { LedgerItemTableBlock } from "./items.ts";
export type { LedgerItemTableBlockOptions } from "./items.ts";
export {
  DocumentPage,
  documentsNavItems,
  LedgerDocumentsRoutes,
} from "./ui.tsx";

/** A system table of customers or vendors and its ledger dimension. */
export interface DocumentParty {
  table: string;
  /** Ledger dimension key that references `table`. */
  dimension: string;
}

export interface LedgerDocumentsOptions {
  ledger: LedgerBlock;
  /**
   * The system's customer table. It may be the same table as `vendors`
   * (for example CRM organizations) and should carry
   * `LedgerPartyTableBlock` for terms and tax exemption.
   */
  customers: DocumentParty;
  /** Adds purchase documents: purchase orders, bills, expenses, credits. */
  vendors?: DocumentParty;
  /**
   * The system's item or product table, with `LedgerItemTableBlock`.
   * Documents do not keep a catalog of their own.
   */
  items: { table: string };
  /**
   * Adds tax agencies and rates. Taxable sales lines add tax at the
   * document's rate, owed to the rate's agency liability account.
   */
  salesTax?: boolean;
  /** Route prefix of the document pages. Defaults to `/documents`. */
  basePath?: string;
  /** Route prefix of the ledger pages, for posting links. Defaults to `/ledger`. */
  ledgerBasePath?: string;
  /** Name printed on invoices and statements. */
  companyName?: string;
  /** Control account numbers; defaults follow the standard chart. */
  accounts?: {
    receivable?: string;
    payable?: string;
    undeposited?: string;
    salesTax?: string;
    /** Offset of open items loaded at cut-over. Defaults to 3900. */
    openingBalance?: string;
  };
}

export interface LedgerPartyTableBlockOptions {
  /** Adds the party's default document currency. */
  currency?: boolean;
}

/**
 * Finance attributes on the system's own customer or vendor table: default
 * payment terms, tax exemption, and optionally currency. Needs the
 * documents block, which owns `ledger_payment_terms`.
 */
export class LedgerPartyTableBlock
  extends TableBlock<LedgerPartyTableBlockOptions> {
  initialize(table: TableBuilder) {
    table.fk("terms_id", "ledger_payment_terms").onDelete("Restrict");
    table.bool("tax_exempt").notNull().default(sql`false`);
    if (this.opts?.currency) table.string("currency", 3);
  }
}

/** Trade documents, which carry lines. */
export const DOCUMENT_KINDS = [
  { name: "estimate", displayName: "Estimate", vendor: false },
  { name: "invoice", displayName: "Invoice", vendor: false },
  { name: "sales_receipt", displayName: "Sales receipt", vendor: false },
  { name: "credit_memo", displayName: "Credit memo", vendor: false },
  { name: "purchase_order", displayName: "Purchase order", vendor: true },
  { name: "bill", displayName: "Bill", vendor: true },
  { name: "expense", displayName: "Expense", vendor: true },
  { name: "vendor_credit", displayName: "Vendor credit", vendor: true },
] as const;

/** Money movements, which carry an amount and no lines. */
export const PAYMENT_KINDS = [
  { name: "customer_payment", displayName: "Payment" },
  { name: "vendor_payment", displayName: "Bill payment" },
  { name: "deposit", displayName: "Deposit" },
  { name: "tax_payment", displayName: "Sales tax payment" },
  { name: "customer_refund", displayName: "Refund" },
  { name: "vendor_refund", displayName: "Vendor refund" },
  { name: "write_off", displayName: "Write-off" },
] as const;

/** Kinds numbered automatically when first saved or posted. */
export const NUMBERED_KINDS: Record<string, string> = {
  estimate: "EST-",
  invoice: "INV-",
  sales_receipt: "SR-",
  credit_memo: "CM-",
  purchase_order: "PO-",
};

/**
 * Sales and purchase documents on the ledger for systems without their own
 * order model: payment terms, estimates, invoices, sales receipts, credit
 * memos, purchase orders, bills, expenses, and vendor credits (trade
 * documents with lines), plus customer payments, bill payments, deposits,
 * and sales tax payments (money movements). Parties and items are the
 * system's own tables. Posting writes one ledger entry per document or
 * payment; payments settle invoices and bills through ledger settlements.
 * Construct before `system.addBlock(ledger)`.
 */
export class LedgerDocumentsBlock implements Block {
  blockName = "LedgerDocumentsBlock";
  blockDisplayName = "Documents";
  componentDependencies: string[] = [];
  description =
    "Invoices, bills, payments, deposits, terms, and sales tax posting to the ledger.";

  readonly ledger: LedgerBlock;
  readonly customers: DocumentParty;
  readonly vendors?: DocumentParty;
  readonly itemsTable: string;
  readonly salesTax: boolean;
  readonly basePath: string;
  readonly ledgerBasePath: string;
  readonly companyName: string;
  readonly accounts: Required<NonNullable<LedgerDocumentsOptions["accounts"]>>;
  /** Trade documents; record id = document id. */
  readonly source: LedgerSource;
  /** Money movements; record id = payment id. */
  readonly paymentSource: LedgerSource;

  constructor(opts: LedgerDocumentsOptions) {
    this.ledger = opts.ledger;
    if (!this.ledger.settlements) {
      throw new Error("LedgerDocumentsBlock needs LedgerBlock settlements");
    }
    if (opts.ledger.consolidation) {
      // Documents would need each entity's own currency and rounding.
      throw new Error(
        "LedgerDocumentsBlock does not yet support ledger consolidation",
      );
    }
    this.customers = opts.customers;
    this.vendors = opts.vendors;
    this.itemsTable = opts.items.table;
    this.salesTax = opts.salesTax ?? false;
    this.basePath = opts.basePath ?? "/documents";
    this.ledgerBasePath = opts.ledgerBasePath ?? "/ledger";
    this.companyName = opts.companyName ?? "";
    this.accounts = {
      receivable: "1200",
      payable: "2000",
      undeposited: "1300",
      salesTax: "2200",
      openingBalance: "3900",
      ...opts.accounts,
    };
    for (const party of [this.customers, this.vendors]) {
      if (
        party && !this.ledger.dimensions.some((d) => d.key === party.dimension)
      ) {
        throw new Error(`Unknown ledger dimension: ${party.dimension}`);
      }
    }
    const base = this.basePath;
    this.ledger.addCloseCheck(
      "Unposted invoices, bills, and payments dated on or before the close",
      (through) =>
        sql`(select count(*) from db.ledger_documents doc
          where doc.document_date <= ${through} and doc.voided_at is null
            and cast(doc.kind as string)
              not in ('estimate', 'purchase_order')
            and not ${this.source.isPosted(sql`doc.id`)})
        + (select count(*) from db.ledger_payments payment
          where payment.payment_date <= ${through}
            and payment.voided_at is null
            and not ${this.paymentSource.isPosted(sql`payment.id`)})`,
    );
    this.source = this.ledger.registerSource({
      key: "document",
      displayName: "Document",
      documentHref: (id) => sql`${sql.lit(`${base}/`)} || ${id}`,
    });
    this.paymentSource = this.ledger.registerSource({
      key: "document_payment",
      displayName: "Payment",
      documentHref: (id) => sql`${sql.lit(`${base}/payments/`)} || ${id}`,
    });
  }

  /** Ledger dimensions carried on document lines (not party or entity). */
  get lineDimensions() {
    const party = [this.customers.dimension, this.vendors?.dimension];
    return this.ledger.dimensions.filter((d) =>
      d.key !== "entity" && !party.includes(d.key)
    );
  }

  get documentKinds() {
    return DOCUMENT_KINDS.filter((k) => this.vendors || !k.vendor);
  }

  get paymentKinds() {
    return PAYMENT_KINDS.filter((k) =>
      (this.vendors || !["vendor_payment", "vendor_refund"].includes(k.name)) &&
      (this.salesTax || k.name !== "tax_payment")
    );
  }

  /** True when the party table carries `LedgerPartyTableBlock`. */
  partyHasTerms(party: DocumentParty) {
    return !!system.db.tables[party.table]?.fields["terms_id"];
  }

  initialize() {
    const { db } = system;
    const ledger = this.ledger;
    system.enum_({
      name: "ledger_document_kind",
      values: this.documentKinds.map(({ name, displayName }) => ({
        name,
        displayName,
      })),
    });
    system.enum_({
      name: "ledger_payment_kind",
      values: this.paymentKinds.map(({ name, displayName }) => ({
        name,
        displayName,
      })),
    });

    db.table("ledger_payment_terms", (table) => {
      table.displayName("Payment terms");
      table.string("name", 100).notNull().unique();
      table.smallInt("due_days").notNull().default(sql`0`);
      table.skipAutoApi();
    });
    /** Optional installments; percentages of the total, summing to 100. */
    db.table("ledger_payment_term_installments", (table) => {
      table.displayName("Installments");
      table.fk("terms_id", "ledger_payment_terms").notNull()
        .onDelete("Cascade");
      table.decimal("percent", { precision: 9, scale: 4 }).notNull();
      table.smallInt("due_days").notNull();
      table.skipAutoApi();
    });

    /** Next number per auto-numbered document kind. */
    db.table("ledger_document_sequences", (table) => {
      table.displayName("Document numbering");
      table.enum("kind", "ledger_document_kind").notNull().unique();
      table.string("prefix", 20).notNull().default(sql`''`);
      table.bigInt("next_number").notNull().default(sql`1001`);
      table.skipAutoApi();
    });

    if (this.salesTax) {
      db.table("ledger_tax_agencies", (table) => {
        table.displayName("Tax agencies");
        table.string("name", 200).notNull().unique();
        table.fk("liability_account_id", "ledger_accounts").notNull()
          .onDelete("Restrict");
        table.skipAutoApi();
      });
      db.table("ledger_tax_rates", (table) => {
        table.displayName("Tax rates");
        table.string("name", 100).notNull().unique();
        table.fk("agency_id", "ledger_tax_agencies").notNull()
          .onDelete("Restrict");
        table.decimal("rate", { precision: 9, scale: 6 }).notNull();
        table.bool("is_active").notNull().default(sql`true`);
        table.skipAutoApi();
      });
    }

    const commonFields = (table: TableBuilder) => {
      table.string("number", 50);
      table.fk("customer_id", this.customers.table).onDelete("Restrict");
      if (this.vendors) {
        table.fk("vendor_id", this.vendors.table).onDelete("Restrict");
      }
      table.string("memo", 500);
      if (ledger.multiCurrency) {
        table.string("currency", 3);
        /** Functional units per document unit; the rate table's when null. */
        table.decimal("exchange_rate", { precision: 18, scale: 8 });
      }
      if (ledger.entities) {
        table.fk("entity_id", "ledger_entities").onDelete("Restrict");
      }
      table.timestampUtc("voided_at");
      table.fk("voided_by", "sys_users").onDelete("Restrict");
    };

    db.table("ledger_payments", (table) => {
      table.displayName("Payments");
      table.enum("kind", "ledger_payment_kind").notNull();
      table.date("payment_date").notNull();
      /** Received into (default undeposited funds) or paid from. */
      table.fk("account_id", "ledger_accounts").onDelete("Restrict");
      table.money("amount", AMOUNT_TYPE).notNull();
      if (this.salesTax) {
        table.fk("tax_agency_id", "ledger_tax_agencies").onDelete("Restrict");
      }
      /** The deposit that took this payment to the bank. */
      table.fk("deposit_id", "ledger_payments").onDelete("Restrict");
      commonFields(table);
      table.recordDisplayName(
        ["kind", "number", "payment_date"],
        (kind, number, date) =>
          sql`cast(${kind} as string) || ' ' || coalesce(${number},
            format.date(${date}, '%m/%d/%Y'))`,
      );
      table.skipAutoApi();
    });

    db.table("ledger_documents", (table) => {
      table.displayName("Documents");
      table.enum("kind", "ledger_document_kind").notNull();
      table.date("document_date").notNull();
      /** Set by posting from the terms unless entered. */
      table.date("due_date");
      table.fk("terms_id", "ledger_payment_terms").onDelete("Restrict");
      /** Sales receipts: received into; expenses: paid from. */
      table.fk("account_id", "ledger_accounts").onDelete("Restrict");
      if (this.salesTax) {
        table.fk("tax_rate_id", "ledger_tax_rates").onDelete("Restrict");
        /** Tax entered by hand; used only when there is no rate. */
        table.money("tax_amount", AMOUNT_TYPE);
        // What the last posting charged, and the rate it used: a rate
        // edited later does not change a posted document's tax.
        table.money("posted_tax", AMOUNT_TYPE);
        table.fk("posted_tax_rate_id", "ledger_tax_rates").onDelete("Restrict");
        table.decimal("posted_tax_rate", { precision: 9, scale: 6 });
      }
      /** The deposit that took this sales receipt to the bank. */
      table.fk("deposit_id", "ledger_payments").onDelete("Restrict");
      /** The estimate or purchase order this document came from. */
      table.fk("source_document_id", "ledger_documents").onDelete("Restrict");
      /** Estimates and purchase orders: closed or converted. */
      table.timestampUtc("closed_at");
      commonFields(table);
      table.recordDisplayName(
        ["kind", "number", "document_date"],
        (kind, number, date) =>
          sql`cast(${kind} as string) || ' ' || coalesce(${number},
            format.date(${date}, '%m/%d/%Y'))`,
      );
      table.skipAutoApi();
    });

    db.table("ledger_document_lines", (table) => {
      table.displayName("Document lines");
      table.fk("document_id", "ledger_documents").notNull()
        .onDelete("Cascade");
      table.fk("item_id", this.itemsTable).onDelete("Restrict");
      /** Posts here instead of the item's account; required without an item. */
      table.fk("account_id", "ledger_accounts").onDelete("Restrict");
      table.string("description", 500);
      table.decimal("quantity", { precision: 18, scale: 4 });
      table.money("unit_price", AMOUNT_TYPE);
      /** Quantity times unit price when left empty. */
      table.money("amount", AMOUNT_TYPE);
      if (this.salesTax) table.bool("taxable");
      for (const d of this.lineDimensions) {
        table.fk(`${d.key}_id`, d.table).onDelete("Restrict");
      }
      table.skipAutoApi();
    });

    definePosting(this);
  }

  validate() {
    for (const party of [this.customers, this.vendors]) {
      if (party && !system.db.tables[party.table]) {
        throw new Error(
          `LedgerDocumentsBlock party table ${party.table} is missing`,
        );
      }
    }
    const items = system.db.tables[this.itemsTable];
    if (!items?.fields["income_account_id"]) {
      throw new Error(
        `LedgerDocumentsBlock item table ${this.itemsTable} needs LedgerItemTableBlock`,
      );
    }
  }

  /** Posting, voiding, applying, converting, payments, and deposits. */
  get actions() {
    return documentActions(this);
  }

  /**
   * `draft`, `posted`, `void`, or for estimates and purchase orders `open`
   * and `closed`.
   */
  statusSql(documentId: Sql): Sql {
    return sql`(select case
        when status_doc.voided_at is not null then 'void'
        when cast(status_doc.kind as string)
          in ('estimate', 'purchase_order')
          then case when status_doc.closed_at is null then 'open'
            else 'closed' end
        when ${this.source.isPosted(sql`status_doc.id`)} then 'posted'
        else 'draft' end
      from db.ledger_documents status_doc
      where status_doc.id = ${documentId})`;
  }

  /**
   * Sales tax of a document in its currency: the rate on its taxable
   * lines, the entered amount without a rate, and nothing for tax-exempt
   * customers or purchases.
   */
  taxSql(documentId: Sql, opts: { atPosting?: boolean } = {}): Sql {
    if (!this.salesTax) return sql`cast(0 as decimal(18, 4))`;
    const decimals = this.txnDecimalsSql(sql`tax_doc`);
    const exempt = this.partyHasTerms(this.customers)
      ? sql`coalesce((select tax_exempt from db.${
        sql.ref(this.customers.table)
      } where id = tax_doc.customer_id), false)`
      : sql`false`;
    const computed = sql`coalesce((select case
        when cast(tax_doc.kind as string) not in
          ('estimate', 'invoice', 'sales_receipt', 'credit_memo') then 0
        when ${exempt} then 0
        when tax_doc.tax_rate_id is not null then round(coalesce((
          select sum(coalesce(line.amount,
            round(line.quantity * line.unit_price, ${decimals})))
          from db.ledger_document_lines line
          left join db.${sql.ref(this.itemsTable)} item
            on item.id = line.item_id
          where line.document_id = tax_doc.id
            and coalesce(line.taxable, item.taxable, false)), 0)
          * case when tax_doc.tax_rate_id = tax_doc.posted_tax_rate_id
              then tax_doc.posted_tax_rate
              else (select rate from db.ledger_tax_rates
                where id = tax_doc.tax_rate_id) end, ${decimals})
        else coalesce(tax_doc.tax_amount, 0) end
      from db.ledger_documents tax_doc where tax_doc.id = ${documentId}), 0)`;
    // Shown as posted; posting (and drafts) compute it.
    return opts.atPosting ? computed : sql`coalesce((select posted_tax
      from db.ledger_documents posted_doc
      where posted_doc.id = ${documentId}), ${computed})`;
  }

  /**
   * When a document is due: the date typed on it, else the earliest due
   * date its posting gave its receivable or payable lines.
   */
  dueDateSql(documentId: Sql): Sql {
    return sql`coalesce((select due_date from db.ledger_documents
        where id = ${documentId}),
      (select min(line.due_date) from db.ledger_lines line
        join db.ledger_accounts account on account.id = line.account_id
        where line.entry_id = ${this.source.activeEntryId(documentId)}
          and account.type in (
            cast('accounts_receivable' as enums.ledger_account_type),
            cast('accounts_payable' as enums.ledger_account_type))))`;
  }

  /** Lines plus tax of a document, in its currency. */
  totalSql(documentId: Sql): Sql {
    return sql`(coalesce((select sum(coalesce(line.amount,
        round(line.quantity * line.unit_price, ${
      this.txnDecimalsSql(sql`total_doc`)
    })))
      from db.ledger_documents total_doc
      join db.ledger_document_lines line on line.document_id = total_doc.id
      where total_doc.id = ${documentId}), 0) + ${this.taxSql(documentId)})`;
  }

  /** Minor-unit digits of a document or payment's own currency. */
  txnDecimalsSql(doc: Sql): Sql {
    return this.ledger.multiCurrency
      ? currencyDecimalsSql(
        sql`coalesce(${doc}.currency, ${
          sql.lit(this.ledger.functionalCurrency)
        })`,
      )
      : sql`${this.ledger.currencyDecimals}`;
  }

  /** `draft`, `posted`, or `void` for a payment. */
  paymentStatusSql(paymentId: Sql): Sql {
    return sql`(select case
        when status_payment.voided_at is not null then 'void'
        when ${this.paymentSource.isPosted(sql`status_payment.id`)}
          then 'posted'
        else 'draft' end
      from db.ledger_payments status_payment
      where status_payment.id = ${paymentId})`;
  }

  /**
   * What is still owed on a posted invoice or bill, or unapplied on a
   * credit, in its currency and always positive.
   */
  openBalanceSql(documentId: Sql): Sql {
    return this.#openSql(this.source.activeEntryId(documentId));
  }

  /**
   * What a posted document or payment has applied to it, or it applied to
   * others: one row per counterpart with `document_id` or `payment_id`
   * and the amount (in the lines' currency), for listing and unapplying.
   */
  applicationsQuery(entryId: Sql): Sql {
    const amount = this.ledger.multiCurrency
      ? sql`case when mine.currency is null then settlement.amount
        else settlement.amount_txn end`
      : sql`settlement.amount`;
    return sql`select
        case when other_entry.source = ${this.source.enumLiteral()}
          then other_entry.source_record_id end as document_id,
        case when other_entry.source = ${this.paymentSource.enumLiteral()}
          then other_entry.source_record_id end as payment_id,
        other_entry.id as entry_id, sum(${amount}) as amount,
        max(settlement.settled_on) as settled_on
      from db.ledger_settlements settlement
      join db.ledger_lines mine on mine.id in
        (settlement.debit_line_id, settlement.credit_line_id)
      join db.ledger_lines other on other.id in
        (settlement.debit_line_id, settlement.credit_line_id)
        and other.id <> mine.id
      join db.ledger_entries other_entry on other_entry.id = other.entry_id
      where mine.entry_id = ${entryId}
        and other_entry.source in (${this.source.enumLiteral()},
          ${this.paymentSource.enumLiteral()})
      group by other_entry.source, other_entry.source_record_id,
        other_entry.id
      having sum(${amount}) <> 0`;
  }

  /** What is still unapplied on a customer payment or bill payment. */
  paymentUnappliedSql(paymentId: Sql): Sql {
    return this.#openSql(this.paymentSource.activeEntryId(paymentId));
  }

  #openSql(entryId: Sql): Sql {
    const open = this.ledger.multiCurrency
      ? sql`case when line.currency is null
        then ${this.ledger.openAmountSql(sql`line.id`)}
        else ${this.ledger.openAmountTxnSql(sql`line.id`)} end`
      : this.ledger.openAmountSql(sql`line.id`);
    return sql`coalesce((select sum(${open})
      from db.ledger_lines line
      join db.ledger_accounts account on account.id = line.account_id
      where line.entry_id = ${entryId}
        and account.type in (
          cast('accounts_receivable' as enums.ledger_account_type),
          cast('accounts_payable' as enums.ledger_account_type))), 0)`;
  }

  /** Fields of the applications table for `recordPayment`. */
  get applicationFields(): HelperProcField[] {
    return [
      { name: "document_id", type: "BigInt" },
      { name: "amount", type: AMOUNT_TYPE },
    ];
  }

  /**
   * Open credits of a party that can be applied to its invoices or bills:
   * credit memos, vendor credits, and unapplied payments, with
   * `document_id` or `payment_id`, `entry_id`, date, number, and `open`.
   */
  openCreditsQuery(opts: { customerId?: Sql; vendorId?: Sql }): Sql {
    const party = opts.customerId
      ? sql`customer_id = ${opts.customerId}`
      : sql`vendor_id = ${opts.vendorId!}`;
    const creditKinds = opts.customerId
      ? sql`('credit_memo')`
      : sql`('vendor_credit')`;
    const paymentKinds = opts.customerId
      ? sql`('customer_payment', 'write_off')`
      : sql`('vendor_payment', 'write_off')`;
    return sql`select * from (
        select credit.id as document_id, cast(null as bigint) as payment_id,
          ${this.source.activeEntryId(sql`credit.id`)} as entry_id,
          cast(credit.kind as string) as kind, credit.number,
          credit.document_date as credit_date,
          ${this.openBalanceSql(sql`credit.id`)} as open
        from db.ledger_documents credit
        where credit.${party} and credit.voided_at is null
          and cast(credit.kind as string) in ${creditKinds}
        union all
        select cast(null as bigint), paid.id,
          ${this.paymentSource.activeEntryId(sql`paid.id`)},
          cast(paid.kind as string), paid.number, paid.payment_date,
          ${this.paymentUnappliedSql(sql`paid.id`)}
        from db.ledger_payments paid
        where paid.${party} and paid.voided_at is null
          and cast(paid.kind as string) in ${paymentKinds}
      ) credits where open > 0 and entry_id is not null`;
  }

  /** Fields of the table for `deposit`: payments and sales receipts. */
  get depositFields(): HelperProcField[] {
    return [
      { name: "payment_id", type: "BigInt" },
      { name: "document_id", type: "BigInt" },
    ];
  }

  requireManage<T extends IServerBaseStatements>(s: T) {
    this.ledger.requireManage(s);
  }
}
