import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type {
  GeneralServerStatements,
  HelperProcField,
  IServerBaseStatements,
  IStatementsBase,
} from "std/statements";
import { userHasPermission } from "blocks/auth";
import { system } from "std/system";
import type { Block } from "std/system";
import {
  ACCOUNT_TYPES,
  accountClassSql,
  EXCHANGE_GAIN_LOSS_ACCOUNT,
  type LedgerAccountClass,
  type LedgerAccountType,
  STANDARD_CHART_OF_ACCOUNTS,
  TRANSLATION_ADJUSTMENT_ACCOUNT,
  UNREALIZED_EXCHANGE_ACCOUNT,
} from "./accounts.ts";
import { revalueOpenItems } from "./revaluation.ts";
import { budgetVsActualQuery, defineBudgets } from "./budgets.ts";
import { defineDeferrals } from "./schedules.ts";
import type { LedgerStandardAccount } from "./accounts.ts";
import {
  defineManualJournals,
  dueTemplatesSql,
  manualJournalStatusSql,
} from "./manual_journals.ts";
import {
  AMOUNT_TYPE,
  currencyDecimals,
  currencyDecimalsSql,
} from "./currency.ts";
import {
  accountTypeFromExternalSql,
  defineImport,
  importEntryFields,
  importLineFields,
} from "./import.ts";
import { integrityQuery } from "./integrity.ts";
import { syncExchangeRates } from "./exchange_rates.ts";
import {
  accountRegisterQuery,
  accountTotalsQuery,
  openingBalanceSql,
  profitAndLossActivityQuery,
  reconcileQuery,
} from "./reports.ts";
import {
  defineSettlementImport,
  defineSettlements,
  importSettlementFields,
  openAmountSql,
  openAmountTxnSql,
  openItemsQuery,
} from "./settlements.ts";

export { accountTypeFromExternalSql };
export {
  date as formatDateSql,
  dimensionLabel,
  manageAction,
  Page as LedgerPage,
  recordLabelSql,
  VoidControl,
} from "./ui_common.tsx";
export { accountTypesSql, STATEMENT_ACCOUNT_TYPES } from "./accounts.ts";
export { AMOUNT_TYPE, currencyDecimalsSql } from "./currency.ts";
export { openItemAccountTypesSql } from "./settlements.ts";
export {
  postSchedulePending,
  schedulePendingFields,
  schedulePeriodEnd,
} from "./schedules.ts";
export { ledgerNavItems, LedgerRoutes } from "./ui.tsx";
export type { LedgerNavItem, LedgerUiProps } from "./ui.tsx";
export type { LedgerAccountClass, LedgerAccountType, LedgerStandardAccount };

/**
 * A typed analysis dimension carried on every journal line, e.g. a customer,
 * project, or department. Each dimension adds one nullable foreign key
 * `<key>_id` to `ledger_lines`, so adding a dimension later is a compatible
 * deploy: historical lines read as "unassigned".
 */
export interface LedgerDimension {
  /** Column stem; the line column is `<key>_id`. Lowercase snake_case. */
  key: string;
  /** Consumer table the dimension references. */
  table: string;
  /** Label for report and form headings. Defaults to a title-cased key. */
  label?: string;
  /**
   * Adds `ledger_accounts.requires_<key>`: lines on flagged accounts must
   * carry this dimension, e.g. every revenue line needs a project.
   */
  requiredByAccount?: boolean;
}

export interface LedgerPermissions {
  /**
   * Required to edit accounts, write manual journals, and work in the
   * documents and banking pages. Source postings from consumer workflows do
   * not require it.
   */
  manage: string;
  /** Required to open ledger pages. Defaults to no check. */
  view?: string;
  /**
   * Required to close and reopen the books, so bookkeepers who manage the
   * books cannot reopen a closed month. Defaults to `manage`.
   */
  close?: string;
}

/** An optional journal line column after `account_id` and `amount`. */
interface LedgerLineColumn {
  name: string;
  /** Name in `LedgerLinesQuery.columns`. */
  key: string;
  field: HelperProcField;
  sqlType: Sql;
  value: (line: LedgerLine) => Sql | undefined;
}

export interface LedgerBook {
  /** Enum key, e.g. `tax` or `ifrs`. */
  key: string;
  displayName?: string;
}

export interface LedgerBlockOptions {
  /**
   * Adds `ledger_entities` (legal entities or subsidiaries) and an `entity`
   * dimension on lines. Every entity must balance within each entry, so
   * intercompany entries post due-to and due-from lines per entity.
   */
  entities?: boolean;
  /**
   * Adds budgets: named plans per account and month (and dimension), with
   * `budgetFromActuals` and `budgetVsActualQuery`.
   */
  budgets?: boolean;
  /**
   * Adds deferrals: deferred revenue and prepaid expenses recognized evenly
   * by month with `recognizeDeferrals`. Registers the
   * `deferral_recognition` source.
   */
  deferrals?: boolean;
  /**
   * Adds `currency` and `amount_txn` on lines for foreign-currency
   * transactions, and `ledger_exchange_rates`. `amount` stays in the line's
   * entity currency (the functional currency without `consolidation`).
   */
  multiCurrency?: boolean;
  /**
   * With `entities` and `multiCurrency`: entities may keep their books in
   * their own currency (`setEntityCurrency`; entities without one, including
   * the home entity, use the functional currency, which becomes the group
   * currency). Line amounts are in their
   * entity's currency and rounded to its minor unit. Statements translate
   * into the group currency: asset and liability balances at the closing
   * rate, profit and loss and equity at each month's average rate, with the
   * difference on 3800 Cumulative Translation Adjustment.
   */
  consolidation?: boolean;
  /**
   * Adjustment books (tax, IFRS, management). Entries in a book hold only the
   * differences from the base book; a book's statements read base plus its
   * adjustments.
   */
  books?: LedgerBook[];
  /**
   * ISO 4217 code of the currency the books are kept in. Line amounts are
   * rounded to its minor unit. Defaults to USD. A one-way choice: changing
   * it later reinterprets every stored amount.
   */
  functionalCurrency?: string;
  /**
   * AuthBlock permissions guarding the ledger UI. Omit when the app's own
   * auth wrapper already limits who can reach the pages.
   */
  permissions?: LedgerPermissions;
  /** Analysis dimensions carried on journal lines. */
  dimensions?: LedgerDimension[];
  /**
   * First month (1-12) of the fiscal year. Profit-and-loss accounts roll into
   * retained earnings at this boundary. Defaults to 1 (January). A one-way
   * choice: changing it later moves amounts between retained earnings and
   * net income in closed periods.
   */
  fiscalYearStartMonth?: number;
  /**
   * Adds user-entered journal entries: mutable drafts that post through the
   * same checks as every other source. Registers the `manual_journal` source.
   */
  manualJournals?: boolean;
  /**
   * Adds open-item tracking (`ledger_settlements`) for accounts receivable and
   * accounts payable lines: which payment paid which invoice.
   */
  settlements?: boolean;
}

export interface LedgerSourceConfig {
  /** Stable enum key stored on every entry, e.g. `invoice`. */
  key: string;
  displayName?: string;
  /** Link from ledger drill-down to the source document. */
  documentHref?: (recordId: Sql) => Sql;
}

/** One journal line built at generation time. */
export interface LedgerLine {
  /** Account id; usually `ledger.account("1200")`. */
  account: Sql;
  /**
   * Signed amount in the line's entity currency (the functional currency
   * without consolidation): positive debits, negative credits. Rounded to
   * the currency's minor unit when posted.
   */
  amount: Sql;
  memo?: Sql;
  /**
   * With `settlements`: when a receivable or payable line is due. Split an
   * invoice into installments with one line per due date.
   */
  dueDate?: Sql;
  /** With `multiCurrency`: ISO code of the transaction currency. */
  currency?: Sql;
  /** With `multiCurrency`: signed amount in the transaction currency. */
  amountTxn?: Sql;
  /** Dimension values keyed by dimension key. */
  dimensions?: Record<string, Sql>;
}

/**
 * Journal lines produced by a query. The query must return `account_id` and
 * `amount` (positive debits, negative credits) plus any optional columns named
 * in `columns`: `memo` and dimension keys (returned as `<key>_id`).
 */
export interface LedgerLinesQuery {
  query: Sql;
  columns?: string[];
}

export interface LedgerPostOptions {
  /** Source document id. Each document has at most one active entry. */
  recordId?: NumericExpr;
  /** Accounting date the entry counts on. */
  date: Sql;
  description?: Sql;
  /** Human document number, e.g. an invoice or journal number. */
  documentNumber?: Sql;
  /** With `books`: the adjustment book (a `ledger_book` value); null posts to the base book. */
  book?: Sql;
  lines: LedgerLine[] | LedgerLinesQuery;
  /** Scalar that receives the new entry id. */
  intoEntryId?: string;
}

export interface LedgerReverseOptions {
  recordId: NumericExpr;
  /** Reversal date; defaults to the original entry's posting date. */
  date?: Sql;
  description?: Sql;
  intoEntryId?: string;
}

/** Keys whose `<key>_id` or column name would collide with line columns. */
const RESERVED_DIMENSION_KEYS = new Set([
  "account",
  "entry",
  "memo",
  "entity",
]);

/** Fields of a posting's local lines table, in insert order. */
function lineInputFields(block: LedgerBlock): HelperProcField[] {
  return [
    { name: "account_id", type: "BigInt" },
    { name: "amount", type: AMOUNT_TYPE },
    ...block.lineColumnSpecs.map((spec) => spec.field),
  ];
}

/** Unrounded candidate lines; `ledger_post_entry` rounds per entity. */
function linesQuery(
  block: LedgerBlock,
  lines: LedgerLine[] | LedgerLinesQuery,
): Sql {
  const specs = block.lineColumnSpecs;
  if (!Array.isArray(lines)) {
    const optional = new Set(lines.columns ?? []);
    for (const column of optional) {
      if (!specs.some((spec) => spec.key === column)) {
        throw new Error(`Unknown ledger line column: ${column}`);
      }
    }
    const columns = [
      sql`line.account_id`,
      sql`line.amount`,
      ...specs.map((spec) =>
        optional.has(spec.key)
          ? sql`line.${sql.ref(spec.name)}`
          : sql`cast(null as ${spec.sqlType}) as ${sql.ref(spec.name)}`
      ),
    ];
    return sql`select ${columns} from (${lines.query}) line`;
  }
  if (lines.length === 0) {
    throw new Error("A ledger posting needs at least one line");
  }
  for (const line of lines) {
    for (const key of Object.keys(line.dimensions ?? {})) {
      if (!block.dimensions.some((d) => d.key === key)) {
        throw new Error(`Unknown ledger dimension: ${key}`);
      }
    }
    if ((line.currency || line.amountTxn) && !block.multiCurrency) {
      throw new Error("Foreign-currency lines need multiCurrency");
    }
  }
  return sql.unionAll(
    ...lines.map((line) => {
      const columns = [
        sql`cast(${line.account} as bigint) as account_id`,
        sql`cast(${line.amount} as decimal(18, 4)) as amount`,
        ...specs.map((spec) =>
          sql`cast(${spec.value(line) ?? sql`null`} as ${spec.sqlType})
            as ${sql.ref(spec.name)}`
        ),
      ];
      return sql`select ${columns}`;
    }),
  );
}

/**
 * A registered posting source. Every write to the ledger goes through a
 * source so each entry traces back to the document that caused it.
 */
export class LedgerSource {
  constructor(
    readonly block: LedgerBlock,
    readonly config: LedgerSourceConfig,
  ) {}

  get key() {
    return this.config.key;
  }

  /** Posts a balanced entry for a source document in the caller's transaction. */
  post<T extends IServerBaseStatements>(s: T, opts: LedgerPostOptions) {
    const block = this.block;
    if (opts.book && !block.books.length) {
      throw new Error("Posting to a book needs LedgerBlock books");
    }
    const linesTable = block.uniqueName("ledger_post_lines");
    const entryId = opts.intoEntryId ?? block.uniqueName("ledger_entry_id");
    const fields = lineInputFields(block);
    s.defTable(linesTable, { fields });
    // Zero lines are dropped; null amounts are kept so posting rejects them.
    s.modify(sql`insert into ${sql.ref(linesTable)}
        (${fields.map((f) => sql.ref(f.name))})
      select ${fields.map((f) => sql.ref(f.name))}
      from (${linesQuery(block, opts.lines)}) candidate
      where amount is null or amount <> 0`);
    if (!opts.intoEntryId) s.defScalar(entryId, { type: "BigInt" });
    s.callStoredProcedure("ledger_post_entry", {
      inputScalars: {
        p_source: this.enumLiteral(),
        p_source_record_id: opts.recordId ?? sql`cast(null as bigint)`,
        p_posting_date: opts.date,
        p_description: opts.description ?? sql`cast(null as string)`,
        p_document_number: opts.documentNumber ?? sql`cast(null as string)`,
        ...(block.books.length
          ? { p_book: opts.book ?? sql`cast(null as enums.ledger_book)` }
          : {}),
      },
      inputTables: { lines: linesTable },
      outputScalars: { entry_id: entryId },
    });
  }

  /**
   * Posts a batch of historical documents set-based, e.g. when migrating from
   * another system. `entries` and `lines` name local tables with
   * `ledger.importEntryFields` and `ledger.importLineFields`, joined on
   * `source_record_id`.
   */
  importEntries<T extends IServerBaseStatements>(
    s: T,
    opts: { entries: string; lines: string; intoCount?: string },
  ) {
    const count = opts.intoCount ?? this.block.uniqueName("ledger_imported");
    if (!opts.intoCount) s.defScalar(count, { type: "BigInt" });
    s.callStoredProcedure("ledger_import_entries", {
      inputScalars: { p_source: this.enumLiteral() },
      inputTables: { entries: opts.entries, lines: opts.lines },
      outputScalars: { entry_count: count },
    });
  }

  /**
   * With `settlements`: applies a batch of payments to invoices among this
   * source's imported documents. `settlements` names a local table with
   * `ledger.importSettlementFields` holding the source system's applied
   * totals per document pair; only the part not already settled is
   * imported, so re-runs are safe.
   */
  importSettlements<T extends IServerBaseStatements>(
    s: T,
    settlements: string,
  ) {
    if (!this.block.settlements) {
      throw new Error("LedgerBlock settlements facet is not enabled");
    }
    s.callStoredProcedure("ledger_import_settlements", {
      inputScalars: { p_source: this.enumLiteral() },
      inputTables: { items: settlements },
    });
  }

  /** Reverses the document's active entry in the caller's transaction. */
  reverse<T extends IServerBaseStatements>(s: T, opts: LedgerReverseOptions) {
    const entryId = this.block.uniqueName("ledger_reverse_target");
    s.defScalar(entryId, {
      type: "BigInt",
      expr: this.activeEntryId(opts.recordId),
    });
    s.throwErrorIf(
      sql`${sql.ref(entryId)} is null`,
      sql.lit`There is no posted journal entry to reverse`,
    );
    this.block.reverseEntry(s, {
      entryId: sql.ref(entryId),
      date: opts.date,
      description: opts.description,
      intoEntryId: opts.intoEntryId,
    });
  }

  /** The document's current (not reversed) entry id, or null. */
  activeEntryId(recordId: NumericExpr): Sql {
    return sql`(select id from db.ledger_entries entry
      where entry.source = ${this.enumLiteral()}
        and entry.source_record_id = ${recordId}
        and ${this.block.isActiveEntrySql(sql`entry`)}
      limit 1)`;
  }

  /** Id of the document's active line on `accountId`, e.g. its A/R line. */
  lineId(recordId: NumericExpr, accountId: Sql): Sql {
    return sql`(select min(line.id) from db.ledger_lines line
      where line.entry_id = ${this.activeEntryId(recordId)}
        and line.account_id = ${accountId})`;
  }

  /** True when the document has an active entry. */
  isPosted(recordId: NumericExpr): Sql {
    return sql`(${this.activeEntryId(recordId)} is not null)`;
  }

  enumLiteral(): Sql {
    return sql`cast(${sql.lit(this.key)} as enums.ledger_source)`;
  }
}

/**
 * General ledger with a universal journal: one immutable line table carrying
 * accounts, signed amounts, and typed dimensions. Balances and statements are
 * always computed from lines; nothing stores running totals.
 *
 * Optional facets add tables or nullable columns only when enabled, so a
 * system never pays for features it does not use and can enable them later
 * as a compatible deploy.
 */
export class LedgerBlock implements Block {
  blockName = "LedgerBlock";
  blockDisplayName = "Ledger";
  componentDependencies: string[] = [];
  description =
    "Double-entry general ledger with immutable journal lines, typed dimensions, and computed financial statements.";

  readonly dimensions: LedgerDimension[];
  readonly fiscalYearStartMonth: number;
  readonly functionalCurrency: string;
  /** Minor-unit digits of the functional currency. */
  readonly currencyDecimals: number;
  readonly manualJournals: boolean;
  readonly settlements: boolean;
  readonly entities: boolean;
  readonly budgets: boolean;
  /** Present when `deferrals` is enabled. */
  readonly deferralSource?: LedgerSource;
  #integrityChecks: [string, Sql][] = [];
  #closeChecks: [string, (through: Sql) => Sql][] = [];
  #reversalGuards: ((s: GeneralServerStatements) => void)[] = [];
  #standardAccounts: LedgerStandardAccount[] = [];
  readonly multiCurrency: boolean;
  readonly consolidation: boolean;
  readonly books: LedgerBook[];
  readonly permissions?: LedgerPermissions;
  readonly sources: LedgerSource[] = [];
  /** Present when `manualJournals` is enabled. */
  readonly manualJournalSource?: LedgerSource;

  #manualJournalReversalSource?: LedgerSource;
  #exchangeSource?: LedgerSource;
  /** With multiCurrency and settlements: period-end revaluation entries. */
  readonly revaluationSource?: LedgerSource;
  #initialized = false;
  #nameCounter = 0;

  constructor(opts: LedgerBlockOptions = {}) {
    this.entities = opts.entities ?? false;
    this.multiCurrency = opts.multiCurrency ?? false;
    this.consolidation = opts.consolidation ?? false;
    this.budgets = opts.budgets ?? false;
    if (this.consolidation && !(this.entities && this.multiCurrency)) {
      throw new Error(
        "LedgerBlock consolidation needs entities and multiCurrency",
      );
    }
    this.books = opts.books ?? [];
    for (const book of this.books) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(book.key)) {
        throw new Error(`LedgerBlock book key must be snake_case: ${book.key}`);
      }
    }
    // Entities reuse the dimension machinery: filters, labels, imports, and
    // settlement matching all apply to `entity_id`.
    this.dimensions = [
      ...(this.entities
        ? [{ key: "entity", table: "ledger_entities", label: "Entity" }]
        : []),
      ...(opts.dimensions ?? []),
    ];
    this.fiscalYearStartMonth = opts.fiscalYearStartMonth ?? 1;
    this.functionalCurrency = opts.functionalCurrency ?? "USD";
    this.currencyDecimals = currencyDecimals(this.functionalCurrency);
    this.manualJournals = opts.manualJournals ?? false;
    this.settlements = opts.settlements ?? false;
    this.permissions = opts.permissions;
    if (
      !Number.isInteger(this.fiscalYearStartMonth) ||
      this.fiscalYearStartMonth < 1 || this.fiscalYearStartMonth > 12
    ) {
      throw new Error("LedgerBlock fiscalYearStartMonth must be 1-12");
    }
    const keys = new Set<string>();
    for (const dimension of this.dimensions) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(dimension.key)) {
        throw new Error(
          `LedgerBlock dimension key must be snake_case: ${dimension.key}`,
        );
      }
      if (
        keys.has(dimension.key) ||
        (RESERVED_DIMENSION_KEYS.has(dimension.key) &&
          dimension.table !== "ledger_entities")
      ) {
        throw new Error(`Duplicate LedgerBlock dimension: ${dimension.key}`);
      }
      keys.add(dimension.key);
    }
    if (this.manualJournals) {
      this.manualJournalSource = this.registerSource({
        key: "manual_journal",
        displayName: "Journal entry",
      });
      this.#manualJournalReversalSource = this.registerSource({
        key: "manual_journal_reversal",
        displayName: "Journal auto-reversal",
      });
    }
    if (opts.deferrals) {
      this.deferralSource = this.registerSource({
        key: "deferral_recognition",
        displayName: "Deferral recognition",
      });
    }
    if (this.multiCurrency && this.settlements) {
      this.#exchangeSource = this.registerSource({
        key: "realized_exchange",
        displayName: "Realized exchange gain or loss",
      });
      this.revaluationSource = this.registerSource({
        key: "unrealized_exchange",
        displayName: "Unrealized exchange revaluation",
      });
    }
  }

  /**
   * A count shown before closing the books through `through`, such as
   * drafts or unreconciled accounts; nonzero warns but does not block.
   */
  addCloseCheck(label: string, count: (through: Sql) => Sql) {
    this.#closeChecks.push([label, count]);
  }

  /** `check_name` and `issue_count` per close check, for `through`. */
  closeChecksQuery(through: Sql): Sql {
    const checks: [string, (through: Sql) => Sql][] = [
      ...(this.manualJournals
        ? [[
          "Draft journal entries dated on or before the close",
          (through: Sql) =>
            sql`select count(*) from db.ledger_manual_journals journal
              where journal.journal_date <= ${through}
                and journal.repeat_months is null
                and ${
              manualJournalStatusSql(
                this.manualJournalSource!,
                sql`journal.id`,
              )
            } = 'draft'`,
        ] as [string, (through: Sql) => Sql]]
        : []),
      ...this.#closeChecks,
    ];
    if (!checks.length) {
      return sql`select cast(null as string) as check_name,
        cast(0 as bigint) as issue_count from db.ledger_accounts where false`;
    }
    return sql.unionAll(
      ...checks.map(([label, count]) =>
        sql`select ${sql.lit(label)} as check_name,
          (${count(through)}) as issue_count`
      ),
    );
  }

  /**
   * For blocks that extend the ledger: an integrity check (`count` is a SQL
   * query returning the number of issues) shown with the ledger's own.
   */
  addIntegrityCheck(label: string, count: Sql) {
    this.#integrityChecks.push([label, count]);
  }

  /** Extension integrity checks, in registration order. */
  get extensionIntegrityChecks(): readonly [string, Sql][] {
    return this.#integrityChecks;
  }

  /**
   * For blocks that extend the ledger: statements run before an entry is
   * reversed, with the entry id in scalar `p_entry_id`, e.g. to refuse
   * reversing a reconciled entry. Call before `system.addBlock(ledger)`.
   */
  addReversalGuard(guard: (s: GeneralServerStatements) => void) {
    if (this.#initialized) {
      throw new Error("Add reversal guards before system.addBlock(ledger)");
    }
    this.#reversalGuards.push(guard);
  }

  /** For blocks that extend the ledger: accounts the standard chart adds. */
  addStandardAccounts(accounts: LedgerStandardAccount[]) {
    this.#standardAccounts.push(...accounts);
  }

  /** Registers a posting source. Call before `system.addBlock`. */
  registerSource(config: LedgerSourceConfig): LedgerSource {
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(config.key)) {
      throw new Error(`Ledger source key must be snake_case: ${config.key}`);
    }
    if (this.sources.some((source) => source.key === config.key)) {
      throw new Error(`Duplicate ledger source: ${config.key}`);
    }
    if (this.#initialized) {
      throw new Error("Register ledger sources before system.addBlock(ledger)");
    }
    const source = new LedgerSource(this, config);
    this.sources.push(source);
    return source;
  }

  initialize() {
    this.#initialized = true;
    const { db } = system;

    system.enum_({
      name: "ledger_account_type",
      values: ACCOUNT_TYPES.map(({ name, displayName }) => ({
        name,
        displayName,
      })),
    });
    system.enum_({
      name: "ledger_source",
      values: this.sources.map(({ config }) =>
        config.displayName
          ? { name: config.key, displayName: config.displayName }
          : config.key
      ),
    });

    if (this.books.length) {
      system.enum_({
        name: "ledger_book",
        values: this.books.map((book) =>
          book.displayName
            ? { name: book.key, displayName: book.displayName }
            : book.key
        ),
      });
    }
    if (this.entities) {
      db.table("ledger_entities", (table) => {
        table.displayName("Entities");
        table.string("code", 20).notNull().unique();
        table.string("name", 200).notNull();
        table.skipAutoApi();
      });
    }
    if (this.consolidation) {
      // Written through `setEntityCurrency`, which refuses once the entity
      // has postings; entities without a row keep the group currency.
      db.table("ledger_entity_currencies", (table) => {
        table.displayName("Entity currencies");
        table.fk("entity_id", "ledger_entities").notNull().unique()
          .onDelete("Restrict");
        table.string("currency", 3).notNull();
        table.skipAutoApi();
      });
    }
    if (this.multiCurrency) {
      db.table("ledger_exchange_rates", (table) => {
        table.displayName("Exchange rates");
        table.description(
          "Functional-currency units per unit of `currency`, in force from `rate_date` until the next rate.",
        );
        table.string("currency", 3).notNull();
        table.date("rate_date").notNull();
        table.decimal("rate", { precision: 18, scale: 8 }).notNull().check(
          (rate) => sql`${rate} > 0`,
          () => sql.lit`Exchange rate must be positive`,
        );
        table.unique(["currency", "rate_date"]);
        table.skipAutoApi();
      });
    }

    db.table("ledger_accounts", (table) => {
      table.displayName("Accounts");
      table.string("number", 20).notNull().unique();
      table.string("name", 200).notNull();
      table.enum("type", "ledger_account_type").notNull();
      table.bool("is_active").notNull().default(sql`true`);
      table.fk("parent_id", "ledger_accounts").onDelete("Restrict");
      for (const dimension of this.dimensions) {
        // Nullable so enabling it later needs no backfill; null is false.
        if (dimension.requiredByAccount) {
          table.bool(`requires_${dimension.key}`);
        }
      }
      table.skipAutoApi();
      table.virtual("account_class", accountClassSql(sql`type`), {
        type: "String",
      });
      table.recordDisplayName(
        ["number", "name"],
        (number, name) => sql`${number} || ' ' || ${name}`,
      );
    });

    db.table("ledger_closings", (table) => {
      table.displayName("Book closings");
      table.description(
        "History of the books' closing date. The latest row is in force; no entry may post on or before it.",
      );
      table.date("closed_through");
      if (this.entities) {
        // Null closes every entity; an entity's own rows add later closes.
        table.fk("entity_id", "ledger_entities").onDelete("Restrict");
      }
      table.string("note", 500);
      table.timestampUtc("closed_at").notNull().default(sql`now()`);
      table.fk("closed_by", "sys_users").onDelete("Restrict");
      table.insertOnly();
      table.skipAutoApi();
    });

    db.table("ledger_entries", (table) => {
      table.displayName("Journal entries");
      table.date("posting_date").notNull();
      table.enum("source", "ledger_source").notNull();
      table.bigInt("source_record_id");
      table.string("description", 500);
      table.string("document_number", 50);
      if (this.books.length) table.enum("book", "ledger_book");
      table.fk("reverses_entry_id", "ledger_entries").onDelete("Restrict");
      table.timestampUtc("posted_at").notNull().default(sql`now()`);
      table.fk("posted_by", "sys_users").onDelete("Restrict");
      table.recordDisplayName(
        ["posting_date", "source"],
        (date, source) =>
          sql`format.date(${date}, '%m/%d/%Y') || ' ' || cast(${source} as string)`,
      );
      table.insertOnly();
      table.skipAutoApi();
    });

    db.table("ledger_lines", (table) => {
      table.displayName("Journal lines");
      table.fk("entry_id", "ledger_entries").notNull().onDelete("Restrict");
      table.date("posting_date").notNull();
      table.fk("account_id", "ledger_accounts").notNull().onDelete("Restrict");
      table.money("amount", AMOUNT_TYPE).notNull();
      table.string("memo", 500);
      // Open items age from their due date; null is due on posting.
      if (this.settlements) table.date("due_date");
      if (this.multiCurrency) {
        // Posting checks the pair; the integrity query reports strays.
        table.string("currency", 3);
        table.money("amount_txn", AMOUNT_TYPE);
      }
      if (this.books.length) table.enum("book", "ledger_book");
      for (const dimension of this.dimensions) {
        table.fk(`${dimension.key}_id`, dimension.table).onDelete("Restrict");
      }
      table.virtual(
        "debit",
        sql`case when amount > 0 then amount end`,
        AMOUNT_TYPE,
      );
      table.virtual(
        "credit",
        sql`case when amount < 0 then -amount end`,
        AMOUNT_TYPE,
      );
      table.insertOnly();
      table.skipAutoApi();
    });

    this.#definePostingProcedures();
    defineImport(this);
    if (this.settlements) {
      defineSettlements(this, this.#exchangeSource);
      defineSettlementImport(this);
    }
    if (this.manualJournalSource) {
      defineManualJournals(
        this,
        this.manualJournalSource,
        this.#manualJournalReversalSource!,
      );
    }
    if (this.budgets) defineBudgets(this);
    if (this.deferralSource) defineDeferrals(this, this.deferralSource);
  }

  validate() {
    if (!system.db.tables.sys_users) {
      throw new Error("LedgerBlock requires AuthBlock (sys_users).");
    }
    if (this.sources.length === 0) {
      throw new Error(
        "LedgerBlock requires a registered source or manualJournals.",
      );
    }
    const permissions = new Set(
      Object.values(system.enums.auth_permission?.values ?? {}).map((value) =>
        value.name
      ),
    );
    for (const permission of Object.values(this.permissions ?? {})) {
      if (!permissions.has(permission)) {
        throw new Error(
          `LedgerBlock permission '${permission}' must be registered with AuthBlock.`,
        );
      }
    }
    for (const dimension of this.dimensions) {
      if (!system.db.tables[dimension.table]) {
        throw new Error(
          `LedgerBlock dimension ${dimension.key} references missing table ${dimension.table}`,
        );
      }
    }
  }

  /** True when `userId` may edit accounts, journals, and closings. */
  canManageSql(userId: Sql): Sql {
    return this.permissions
      ? userHasPermission(sql.lit(this.permissions.manage), userId)
      : sql`true`;
  }

  /** True when `userId` may open ledger pages. */
  canViewSql(userId: Sql): Sql {
    if (!this.permissions) return sql`true`;
    const view = this.permissions.view
      ? userHasPermission(sql.lit(this.permissions.view), userId)
      : sql`true`;
    return sql`(${view} or ${this.canManageSql(userId)})`;
  }

  /** True when `userId` may close and reopen the books. */
  canCloseSql(userId: Sql): Sql {
    return this.permissions?.close
      ? userHasPermission(sql.lit(this.permissions.close), userId)
      : this.canManageSql(userId);
  }

  /** Throws unless the current user may close and reopen the books. */
  requireClose<T extends IServerBaseStatements>(s: T) {
    if (!this.permissions) return;
    s.throwErrorUnless(
      this.canCloseSql(sql`current_user`),
      sql.lit`You do not have permission to close or reopen the books`,
    );
  }

  /** Throws unless the current user may manage the ledger. */
  requireManage<T extends IServerBaseStatements>(s: T) {
    if (!this.permissions) return;
    s.throwErrorUnless(
      this.canManageSql(sql`current_user`),
      sql.lit`You do not have permission to change the books`,
    );
  }

  /** Fields for the entries table of `LedgerSource.importEntries`. */
  get importEntryFields() {
    return importEntryFields(this);
  }

  /** Fields for the table of `LedgerSource.importSettlements`. */
  get importSettlementFields() {
    return importSettlementFields(this);
  }

  /** Fields for the lines table of `LedgerSource.importEntries`. */
  get importLineFields() {
    return importLineFields(this);
  }

  /** Formats an amount in the functional currency. */
  formatAmountSql(amount: Sql): Sql {
    const code = sql.lit(this.functionalCurrency);
    return sql`case when ${amount} < 0
      then '-' || format.currency(-${amount}, ${code})
      else format.currency(${amount}, ${code}) end`;
  }

  /** Generation-time unique local name for helper-owned scalars and tables. */
  uniqueName(stem: string) {
    return `${stem}_${this.#nameCounter++}`;
  }

  /**
   * With multiCurrency: functional-currency units per unit of `currency` on
   * `date` (the latest rate on or before it), or null without a rate.
   */
  exchangeRateSql(currency: Sql, date: Sql): Sql {
    this.#requireFacet(this.multiCurrency, "multiCurrency");
    // max() rather than `order by ... limit 1`, which the optimizer can drop
    // from a scalar subquery on a small table.
    return sql`(select rate from db.ledger_exchange_rates rate
      where rate.currency = ${currency}
        and rate.rate_date = (select max(latest.rate_date)
          from db.ledger_exchange_rates latest
          where latest.currency = ${currency}
            and latest.rate_date <= ${date}))`;
  }

  /**
   * With multiCurrency: fetches `date`'s rates for `currencies` (a JSON
   * array of ISO codes) from the `fx_rates` service into
   * `ledger_exchange_rates`. Runs outside a transaction; manages its own.
   */
  syncExchangeRates<T extends IServerBaseStatements>(
    s: T,
    opts: { date: Sql; currencies: Sql },
  ) {
    this.#requireFacet(this.multiCurrency, "multiCurrency");
    syncExchangeRates(s, this, opts);
  }

  /** Account id for an account number, or null when it does not exist. */
  account(number: string | Sql): Sql {
    const value = typeof number === "string" ? sql.lit(number) : number;
    return sql`(select id from db.ledger_accounts where number = ${value})`;
  }

  /**
   * The closing date in force, or null when the books are open. With
   * entities, pass an entity id for the later of the all-entity close and
   * that entity's own close.
   */
  closedThroughSql(entityId?: Sql): Sql {
    // The latest closing by max(id): the optimizer drops `order by ...
    // limit 1` from a scalar subquery when the table is estimated at one row,
    // which returned the first close instead of the latest.
    if (!this.entities) {
      return sql`(select closed_through from db.ledger_closings
        where id = (select max(id) from db.ledger_closings))`;
    }
    const all = sql`(select closed_through from db.ledger_closings
      where id = (select max(id) from db.ledger_closings
        where entity_id is null))`;
    if (!entityId) return all;
    const own = sql`(select closed_through from db.ledger_closings
      where id = (select max(id) from db.ledger_closings
        where entity_id = ${entityId}))`;
    return sql`case when ${all} is null then ${own}
      when ${own} is null then ${all}
      else greatest(${all}, ${own}) end`;
  }

  /**
   * `date`, or the day after the close that applies to `lines` (a table or
   * query with `entity_id` when entities are on) when that is later: where
   * scheduled postings for a closed month land.
   */
  openDateSql(date: Sql, lines: Sql): Sql {
    const closed = this.#closedThroughForLinesSql(lines);
    return sql`case when ${closed} >= ${date}
      then date.add(day, 1, ${closed}) else ${date} end`;
  }

  /**
   * Latest closing date that applies to any line of `lines` (a table or
   * query with `entity_id` when entities are on).
   */
  #closedThroughForLinesSql(lines: Sql): Sql {
    // Without entities `lines` is not read, so it may name missing columns.
    if (!this.entities) return this.closedThroughSql();
    return sql`(select max(${
      this.closedThroughSql(sql`closing_scope.entity_id`)
    }) from (select distinct ${
      this.lineEntitySql(sql`scoped_line`)
    } as entity_id from ${lines} scoped_line) closing_scope)`;
  }

  /**
   * With entities: the home entity (the first created). Lines without an
   * entity, including history posted before entities were enabled, belong
   * to it.
   */
  get homeEntitySql(): Sql {
    return sql`(select min(id) from db.ledger_entities)`;
  }

  /** Minor-unit digits a line's amount rounds to (its entity's currency). */
  amountDecimalsSql(line: Sql): Sql {
    return this.consolidation
      ? currencyDecimalsSql(this.#entityCurrencySql(this.lineEntitySql(line)))
      : sql`${this.currencyDecimals}`;
  }

  /** A line's entity: its `entity_id`, or the home entity when null. */
  lineEntitySql(line: Sql): Sql {
    return sql`coalesce(${line}.entity_id, ${this.homeEntitySql})`;
  }

  /**
   * Lines of one entity, counting unassigned lines for the home entity.
   * Keeps `entity_id` bare so storage pruning still applies.
   */
  entityFilterSql(entityId: Sql, line?: Sql): Sql {
    const column = line ? sql`${line}.entity_id` : sql`entity_id`;
    return sql`(${column} = ${entityId}
      or (${column} is null and ${entityId} = ${this.homeEntitySql}))`;
  }

  /**
   * With consolidation: sets an entity's currency. Allowed only before the
   * entity's first posting, and not for the home entity, which keeps the
   * group currency.
   */
  setEntityCurrency<T extends IServerBaseStatements>(
    s: T,
    entityId: Sql,
    currency: Sql,
  ) {
    this.#requireFacet(this.consolidation, "consolidation");
    const entityName = this.uniqueName("ledger_currency_entity");
    const entity = sql.ref(entityName);
    s.defScalar(entityName, { type: "BigInt", expr: entityId });
    s.throwErrorIf(
      sql`${entity} = ${this.homeEntitySql}`,
      sql.lit`The home entity keeps the group currency`,
    );
    s.throwErrorIf(
      sql`exists (select 1 from db.ledger_lines
        where ${this.entityFilterSql(entity)})`,
      sql.lit`An entity's currency cannot change after its first posting`,
    );
    s.modify(sql`delete from db.ledger_entity_currencies
      where entity_id = ${entity}`);
    s.modify(sql`insert into db.ledger_entity_currencies (entity_id, currency)
      values (${entity}, ${currency})`);
  }

  /**
   * With consolidation: an entity's currency; the functional (group)
   * currency when none is set.
   */
  #entityCurrencySql(entityId: Sql): Sql {
    return sql`coalesce((select entity_currency.currency
      from db.ledger_entity_currencies entity_currency
      where entity_currency.entity_id = ${entityId}),
      ${sql.lit(this.functionalCurrency)})`;
  }

  /** First day of the fiscal year containing `date`. */
  fiscalYearStartSql(date: Sql): Sql {
    const month = this.fiscalYearStartMonth;
    if (month === 1) return sql`date.start_of_year(${date})`;
    return sql`make_date(
      cast(extract(year from ${date}) as int)
        - case when extract(month from ${date}) < ${month} then 1 else 0 end,
      ${month}, 1)`;
  }

  /**
   * True when `entry` is neither a reversal nor reversed (as of the end of
   * `asOf` when given).
   */
  isActiveEntrySql(entry: Sql, asOf?: Sql): Sql {
    // The `is not null` guard keeps the anti-join off the mostly-null key.
    return sql`${entry}.reverses_entry_id is null and not exists (
      select 1 from db.ledger_entries reversal
      where reversal.reverses_entry_id is not null
        and reversal.reverses_entry_id = ${entry}.id
        ${asOf ? sql`and reversal.posting_date <= ${asOf}` : sql``})`;
  }

  /**
   * Sets the books' closing date. Pass null to reopen every period; without
   * `entityId` that also reopens every entity's own close.
   */
  closeBooks<T extends IServerBaseStatements>(
    s: T,
    opts: {
      through: Sql;
      note?: Sql;
      /** With entities: close one entity; omit to close every entity. */
      entityId?: Sql;
    },
  ) {
    if (opts.entityId && !this.entities) {
      throw new Error("Closing one entity needs LedgerBlock entities");
    }
    s.modify(
      sql`insert into db.ledger_closings
        (closed_through, note, closed_by
          ${this.entities ? sql`, entity_id` : sql``})
      values (${opts.through}, ${opts.note ?? sql`null`}, current_user
        ${this.entities ? sql`, ${opts.entityId ?? sql`null`}` : sql``})`,
    ); // Reopening everything also lifts each entity's own close.
    if (this.entities) {
      s.modify(sql`insert into db.ledger_closings
        (closed_through, note, closed_by, entity_id)
        select cast(null as date), ${opts.note ?? sql`null`}, current_user,
          entity.id
        from db.ledger_entities entity
        where ${opts.through} is null
          and ${opts.entityId ?? sql`cast(null as bigint)`} is null
          and (select closed_through from db.ledger_closings
            where id = (select max(id) from db.ledger_closings
              where entity_id = entity.id)) is not null`);
    }
  }

  /**
   * Inserts any missing accounts from a chart; existing numbers are kept.
   * The standard chart adds the exchange gain or loss account when needed.
   */
  insertChartOfAccounts<T extends IStatementsBase>(
    s: T,
    accounts?: LedgerStandardAccount[],
  ) {
    const chart = accounts ?? [
      ...STANDARD_CHART_OF_ACCOUNTS,
      ...(this.#exchangeSource
        ? [EXCHANGE_GAIN_LOSS_ACCOUNT, UNREALIZED_EXCHANGE_ACCOUNT]
        : []),
      ...(this.consolidation ? [TRANSLATION_ADJUSTMENT_ACCOUNT] : []),
      ...this.#standardAccounts,
    ];
    for (const account of chart) {
      s.modify(sql`insert into db.ledger_accounts (number, name, type)
        select ${sql.lit(account.number)}, ${sql.lit(account.name)},
          cast(${sql.lit(account.type)} as enums.ledger_account_type)
        where not exists (
          select 1 from db.ledger_accounts where number = ${
        sql.lit(account.number)
      })`);
    }
  }

  /**
   * Optional line columns after `account_id` and `amount`, in insert order.
   * `key` names the column in `LedgerLinesQuery.columns`.
   */
  get lineColumnSpecs(): LedgerLineColumn[] {
    const specs: LedgerLineColumn[] = [{
      name: "memo",
      key: "memo",
      field: { name: "memo", type: { type: "String", maxLength: 500 } },
      sqlType: sql`string`,
      value: (line: LedgerLine) => line.memo,
    }];
    if (this.settlements) {
      specs.push({
        name: "due_date",
        key: "due_date",
        field: { name: "due_date", type: "Date" },
        sqlType: sql`date`,
        value: (line) => line.dueDate,
      });
    }
    if (this.multiCurrency) {
      specs.push({
        name: "currency",
        key: "currency",
        field: { name: "currency", type: { type: "String", maxLength: 3 } },
        sqlType: sql`string`,
        value: (line) => line.currency,
      }, {
        name: "amount_txn",
        key: "amount_txn",
        field: { name: "amount_txn", type: AMOUNT_TYPE },
        sqlType: sql`decimal(18, 4)`,
        value: (line) => line.amountTxn,
      });
    }
    for (const dimension of this.dimensions) {
      const name = `${dimension.key}_id`;
      specs.push({
        name,
        key: dimension.key,
        field: { name, type: "BigInt" },
        sqlType: sql`bigint`,
        value: (line) => line.dimensions?.[dimension.key],
      });
    }
    return specs;
  }

  /** Reverses an entry by id. Prefer `LedgerSource.reverse`. */
  reverseEntry<T extends IServerBaseStatements>(
    s: T,
    opts: {
      entryId: NumericExpr;
      date?: Sql;
      description?: Sql;
      intoEntryId?: string;
    },
  ) {
    const reversalId = opts.intoEntryId ??
      this.uniqueName("ledger_reversal_id");
    if (!opts.intoEntryId) s.defScalar(reversalId, { type: "BigInt" });
    s.callStoredProcedure("ledger_reverse_entry", {
      inputScalars: {
        p_entry_id: opts.entryId,
        p_posting_date: opts.date ?? sql`cast(null as date)`,
        p_description: opts.description ?? sql`cast(null as string)`,
      },
      outputScalars: { entry_id: reversalId },
    });
  }

  /**
   * Per-account `activity` (from..asOf), statement `balance` at `asOf`, and
   * `prior_years` profit and loss for retained earnings. One line scan.
   * Report queries read the base book unless `book` names an adjustment
   * book, which adds that book's adjustments. With consolidation, amounts
   * are translated into the group currency unless `translate` is false
   * (e.g. one entity's statements in its own currency).
   */
  accountTotalsQuery(
    opts: {
      asOf: Sql;
      from?: Sql;
      lineFilter?: Sql;
      book?: Sql;
      translate?: boolean;
    },
  ): Sql {
    return accountTotalsQuery(this, opts);
  }

  /**
   * Income and expense activity per account and period (months when
   * `byMonth` is true), with `normal_sign` for presentation.
   */
  profitAndLossActivityQuery(
    opts: {
      from: Sql;
      to: Sql;
      byMonth?: Sql;
      lineFilter?: Sql;
      book?: Sql;
      translate?: boolean;
    },
  ): Sql {
    return profitAndLossActivityQuery(this, opts);
  }

  /** Lines on one account with a running balance. */
  accountRegisterQuery(
    opts: { accountId: Sql; from: Sql; to: Sql; book?: Sql },
  ): Sql {
    return accountRegisterQuery(this, opts);
  }

  /** Account balance before `date`; P&L accounts reset each fiscal year. */
  openingBalanceSql(accountId: Sql, date: Sql, book?: Sql): Sql {
    return openingBalanceSql(this, accountId, date, book);
  }

  /**
   * `check_name`, `issue_count` rows for the ledger's invariants (balanced
   * entries, single active posting per document, settlement limits). Every
   * count should be zero.
   */
  integrityQuery(): Sql {
    return integrityQuery(this);
  }

  /**
   * Rows where `expected` (columns `account_number`, `period` as the month's
   * first day, `activity` with debits positive) differs from the ledger.
   * Empty when the books match.
   */
  reconcileQuery(
    opts: { expected: Sql; from: Sql; to: Sql; book?: Sql },
  ): Sql {
    return reconcileQuery(this, opts);
  }

  #requireFacet(enabled: boolean, facet: string) {
    if (!enabled) throw new Error(`LedgerBlock ${facet} facet is not enabled`);
  }

  /**
   * Applies (positive) or unapplies (negative) a debit line to a credit line.
   * Foreign-currency lines settle by `amountTxn` and post any realized
   * exchange gain or loss; a negative `amountTxn` unapplies the whole pair.
   */
  settle<T extends IServerBaseStatements>(
    s: T,
    opts: {
      debitLineId: NumericExpr;
      creditLineId: NumericExpr;
      /** Functional-currency amount, for functional-currency lines. */
      amount?: Sql;
      /** With multiCurrency: transaction-currency amount of foreign lines. */
      amountTxn?: Sql;
      date: Sql;
    },
  ) {
    this.#requireFacet(this.settlements, "settlements");
    if (opts.amountTxn && !this.multiCurrency) {
      throw new Error("Settling by amountTxn needs multiCurrency");
    }
    const noAmount = sql`cast(null as decimal(18, 4))`;
    s.callStoredProcedure("ledger_settle", {
      inputScalars: {
        p_debit_line_id: opts.debitLineId,
        p_credit_line_id: opts.creditLineId,
        p_amount: opts.amount ?? noAmount,
        p_settled_on: opts.date,
        ...(this.multiCurrency
          ? { p_amount_txn: opts.amountTxn ?? noAmount }
          : {}),
      },
    });
  }

  /** Unsettled amount of a receivable or payable line. */
  openAmountSql(lineId: Sql): Sql {
    this.#requireFacet(this.settlements, "settlements");
    return openAmountSql(lineId);
  }

  /**
   * With multiCurrency: revalues open foreign-currency receivables and
   * payables at `date`'s rate, posting unrealized gain or loss that reverses
   * the next day. Runs in the caller's transaction; once per date.
   */
  revalueOpenItems<T extends IServerBaseStatements>(
    s: T,
    opts: { date: Sql },
  ) {
    this.#requireFacet(!!this.revaluationSource, "multiCurrency");
    revalueOpenItems(s, this, this.revaluationSource!, opts.date);
  }

  /** Unsettled transaction-currency amount of a foreign-currency line. */
  openAmountTxnSql(lineId: Sql): Sql {
    this.#requireFacet(this.settlements && this.multiCurrency, "multiCurrency");
    return openAmountTxnSql(lineId);
  }

  /**
   * Open receivable and payable lines with `open_amount`, currently or as of
   * the end of `asOf`.
   */
  openItemsQuery(opts: { asOf?: Sql } = {}): Sql {
    this.#requireFacet(this.settlements, "settlements");
    return openItemsQuery(this, opts.asOf);
  }

  /**
   * With `deferrals`: posts every deferral month ending on or before
   * `through`, one entry per month. Runs in the caller's transaction;
   * reruns post only what is new.
   */
  recognizeDeferrals<T extends IServerBaseStatements>(s: T, through: Sql) {
    this.#requireFacet(!!this.deferralSource, "deferrals");
    s.callStoredProcedure("ledger_recognize_deferrals", {
      inputScalars: { p_through: through },
    });
  }

  /**
   * With `deferrals`: stops a deferral and moves what was recognized back
   * to its deferral account on `date`, or with a null date in each month
   * it was recognized (months since closed move to the first open day).
   */
  cancelDeferral<T extends IServerBaseStatements>(
    s: T,
    deferralId: Sql,
    date: Sql,
  ) {
    this.#requireFacet(!!this.deferralSource, "deferrals");
    s.callStoredProcedure("ledger_cancel_deferral", {
      inputScalars: { p_deferral_id: deferralId, p_date: date },
    });
  }

  /**
   * With `budgets`: replaces a budget's months with actual activity from
   * `from`..`to`, shifted forward `shiftMonths` (12 copies last year).
   */
  budgetFromActuals<T extends IServerBaseStatements>(
    s: T,
    opts: { budgetId: Sql; from: Sql; to: Sql; shiftMonths: number },
  ) {
    this.#requireFacet(this.budgets, "budgets");
    s.callStoredProcedure("ledger_budget_from_actuals", {
      inputScalars: {
        p_budget_id: opts.budgetId,
        p_from: opts.from,
        p_to: opts.to,
        p_shift_months: sql`${opts.shiftMonths}`,
      },
    });
  }

  /** With `budgets`: budget, actual, and variance per account and month. */
  budgetVsActualQuery(
    opts: { budgetId: Sql; from: Sql; to: Sql; lineFilter?: Sql },
  ): Sql {
    this.#requireFacet(this.budgets, "budgets");
    return budgetVsActualQuery(this, opts);
  }

  /** Posts a manual journal, replacing its previous version if posted. */
  postManualJournal<T extends IServerBaseStatements>(
    s: T,
    journalId: NumericExpr,
    intoEntryId?: string,
  ) {
    this.#requireFacet(this.manualJournals, "manualJournals");
    const entryId = intoEntryId ?? this.uniqueName("ledger_journal_entry_id");
    if (!intoEntryId) s.defScalar(entryId, { type: "BigInt" });
    s.callStoredProcedure("ledger_post_manual_journal", {
      inputScalars: { p_manual_journal_id: journalId },
      outputScalars: { entry_id: entryId },
    });
  }

  /**
   * Voids a posted manual journal and its automatic reversal, on `date`
   * (e.g. the first open day when its month is closed) or by default on
   * their own dates.
   */
  voidManualJournal<T extends IServerBaseStatements>(
    s: T,
    journalId: NumericExpr,
    date?: Sql,
  ) {
    this.#requireFacet(this.manualJournals, "manualJournals");
    s.callStoredProcedure("ledger_void_manual_journal", {
      inputScalars: {
        p_manual_journal_id: journalId,
        p_date: date ?? sql`cast(null as date)`,
      },
    });
  }

  /** Posts every recurring journal occurrence due on or before `through`. */
  runRecurringJournals<T extends IServerBaseStatements>(
    s: T,
    through: Sql,
    intoCount?: string,
  ) {
    this.#requireFacet(this.manualJournals, "manualJournals");
    const count = intoCount ?? this.uniqueName("ledger_recurring_posted");
    if (!intoCount) s.defScalar(count, { type: "BigInt" });
    s.callStoredProcedure("ledger_run_recurring_journals", {
      inputScalars: {
        p_through: through,
        p_manual_journal_id: sql`cast(null as bigint)`,
      },
      outputScalars: { posted_count: count },
    });
  }

  /**
   * Opt-in scheduled job that recognizes deferrals through today; months
   * already closed post on the first open day.
   */
  scheduleDeferralRecognition(schedule: string) {
    this.#requireFacet(!!this.deferralSource, "deferrals");
    system.scheduledProc({
      name: "ledger_recognize_deferrals_daily",
      schedule,
      procedure: (s) => {
        s.startTransaction();
        this.recognizeDeferrals(s, sql`current_date()`);
        s.commitTransaction();
      },
    });
  }

  /**
   * Opt-in scheduled job that posts due recurring journals, e.g. daily at
   * 02:00 with `"0 0 2 * * *"`.
   */
  scheduleRecurringJournals(schedule: string) {
    this.#requireFacet(this.manualJournals, "manualJournals");
    // Each template posts in its own transaction; one that cannot post
    // (closed period, inactive account) records why and the rest continue.
    system.scheduledProc({
      name: "ledger_post_recurring_journals",
      schedule,
      procedure: (s) => {
        s.forEachQuery(
          sql`select id from db.ledger_manual_journals
            where ${dueTemplatesSql(sql`current_date()`)}`,
          "recurring_template",
          (s) => {
            s.try({
              body: (s) => {
                s.defScalar("recurring_posted", { type: "BigInt" });
                s.startTransaction();
                s.callStoredProcedure("ledger_run_recurring_journals", {
                  inputScalars: {
                    p_through: sql`current_date()`,
                    p_manual_journal_id: sql`recurring_template.id`,
                  },
                  outputScalars: { posted_count: "recurring_posted" },
                });
                s.commitTransaction();
              },
              errorName: "recurring_error",
              catch: (s) => {
                s.rollbackIfInTransaction();
                s.startTransaction();
                s.modify(sql`update db.ledger_manual_journals
                  set repeat_error = substring(recurring_error.message, 1, 500)
                  where id = recurring_template.id`);
                s.commitTransaction();
              },
            });
          },
        );
      },
    });
  }

  /** `recurring`, `draft`, `posted`, or `void` for a manual journal id. */
  manualJournalStatusSql(journalId: Sql): Sql {
    this.#requireFacet(this.manualJournals, "manualJournals");
    return manualJournalStatusSql(this.manualJournalSource!, journalId);
  }

  /** Rejects `date` on or before the close that applies to `lines`. */
  #assertOpenPeriod<T extends IServerBaseStatements>(
    s: T,
    date: Sql,
    lines: Sql,
  ) {
    const closed = this.#closedThroughForLinesSql(lines);
    s.throwErrorIf(
      sql`${date} <= ${closed}`,
      sql`'The books are closed through ' || format.date(${closed}, '%m/%d/%Y')`,
    );
  }

  #definePostingProcedures() {
    const lineColumns = lineInputFields(this).map((field) => field.name);
    const lineColumnList = lineColumns.map((c) => sql.ref(c));
    const books = this.books.length > 0;
    const bookField: HelperProcField[] = books
      ? [{ name: "p_book", type: { type: "Enum", enum: "ledger_book" } }]
      : [];
    system.storedProcedure({
      name: "ledger_post_entry",
      transaction: "caller",
      inputScalars: [
        {
          name: "p_source",
          type: { type: "Enum", enum: "ledger_source" },
          notNull: true,
        },
        { name: "p_source_record_id", type: "BigInt" },
        { name: "p_posting_date", type: "Date" },
        { name: "p_description", type: { type: "String", maxLength: 500 } },
        {
          name: "p_document_number",
          type: { type: "String", maxLength: 50 },
        },
        ...bookField,
      ],
      inputTables: [{ name: "lines", fields: lineInputFields(this) }],
      outputScalars: [{ name: "entry_id", type: "BigInt" }],
      procedure: (s) => {
        const lines = sql.ref("lines");
        if (this.entities) {
          s.modify(sql`update ${lines} set entity_id = ${this.homeEntitySql}
            where entity_id is null`);
        }
        // The one rounding point: each line to its entity's currency.
        s.modify(sql`update ${lines}
          set amount = round(amount, ${this.amountDecimalsSql(lines)})`);
        s.modify(sql`delete from ${lines} where amount = 0`);
        s.throwErrorIf(
          sql`p_posting_date is null`,
          sql.lit`A journal entry needs a posting date`,
        );
        s.throwErrorIf(
          sql`not exists (select 1 from ${lines})`,
          sql.lit`A journal entry needs at least one non-zero line`,
        );
        s.throwErrorIf(
          sql`exists (select 1 from ${lines} where amount is null)`,
          sql.lit`Every journal line needs an amount`,
        );
        s.throwErrorIf(
          sql`exists (select 1 from ${lines} line where line.account_id is null
            or not exists (select 1 from db.ledger_accounts account
              where account.id = line.account_id and account.is_active))`,
          sql.lit`Every journal line needs an active account`,
        );
        // Per-entity balance implies the whole entry balances.
        if (this.entities) {
          s.throwErrorIf(
            sql`exists (select entity_id from ${lines}
              group by entity_id having sum(amount) <> 0)`,
            sql
              .lit`Each entity's lines must balance; use due-to and due-from accounts between entities`,
          );
        }
        s.throwErrorIf(
          sql`(select sum(amount) from ${lines}) <> 0`,
          sql`'Journal entry is out of balance by ' || ${
            this.formatAmountSql(sql`(select sum(amount) from ${lines})`)
          }`,
        );
        if (this.multiCurrency) {
          s.throwErrorIf(
            sql`exists (select 1 from ${lines}
              where (currency is null) <> (amount_txn is null))`,
            sql.lit`A foreign-currency line needs both currency and amount`,
          );
        }
        for (const dimension of this.dimensions) {
          if (!dimension.requiredByAccount) continue;
          s.throwErrorIf(
            sql`exists (select 1 from ${lines} line
              join db.ledger_accounts account on account.id = line.account_id
              where account.${sql.ref(`requires_${dimension.key}`)}
                and line.${sql.ref(`${dimension.key}_id`)} is null)`,
            sql`${
              sql.lit(
                `Lines on some accounts need a ${
                  (dimension.label ?? dimension.key.replaceAll("_", " "))
                    .toLowerCase()
                }: `,
              )
            } || (select string_agg(distinct account.number, ', ')
              from ${lines} line
              join db.ledger_accounts account on account.id = line.account_id
              where account.${sql.ref(`requires_${dimension.key}`)}
                and line.${sql.ref(`${dimension.key}_id`)} is null)`,
          );
        }
        this.#assertOpenPeriod(s, sql`p_posting_date`, lines);
        s.throwErrorIf(
          sql`p_source_record_id is not null and exists (
            select 1 from db.ledger_entries entry
            where entry.source = p_source
              and entry.source_record_id = p_source_record_id
              and ${this.isActiveEntrySql(sql`entry`)})`,
          sql
            .lit`This document is already posted; reverse it before posting again`,
        );
        s.defScalar("new_entry_id", { type: "BigInt" });
        s.modify(sql`insert into db.ledger_entries
          (posting_date, source, source_record_id, description,
            document_number, ${books ? sql`book,` : sql``} posted_by)
          values (p_posting_date, p_source, p_source_record_id, p_description,
            p_document_number, ${books ? sql`p_book,` : sql``} current_user)
          returning id into new_entry_id`);
        s.modify(
          sql`insert into db.ledger_lines (entry_id, posting_date,
            ${books ? sql`book,` : sql``} ${lineColumnList})
          select new_entry_id, p_posting_date, ${books ? sql`p_book,` : sql``}
            ${lineColumnList} from ${lines}`,
        );
        s.setScalar("entry_id", sql`new_entry_id`);
      },
    });

    system.storedProcedure({
      name: "ledger_reverse_entry",
      transaction: "caller",
      inputScalars: [
        { name: "p_entry_id", type: "BigInt" },
        { name: "p_posting_date", type: "Date" },
        { name: "p_description", type: { type: "String", maxLength: 500 } },
      ],
      outputScalars: [{ name: "entry_id", type: "BigInt" }],
      procedure: (s) => {
        s.defRecord(
          "original",
          sql`select id, posting_date, source, source_record_id, description,
            document_number, ${books ? sql`book,` : sql``} reverses_entry_id
          from db.ledger_entries where id = p_entry_id`,
        );
        s.throwErrorIf(
          sql`original.id is null`,
          sql.lit`Journal entry not found`,
        );
        s.throwErrorIf(
          sql`original.reverses_entry_id is not null`,
          sql.lit`A reversal cannot itself be reversed`,
        );
        s.throwErrorIf(
          sql`exists (select 1 from db.ledger_entries
            where reverses_entry_id = p_entry_id)`,
          sql.lit`This journal entry is already reversed`,
        );
        if (this.settlements) {
          s.throwErrorIf(
            sql`exists (select 1 from db.ledger_settlements settlement
              where settlement.debit_line_id in (select id from db.ledger_lines
                  where entry_id = p_entry_id)
                or settlement.credit_line_id in (select id from db.ledger_lines
                  where entry_id = p_entry_id)
              group by settlement.debit_line_id, settlement.credit_line_id
              having sum(settlement.amount) <> 0)`,
            sql
              .lit`Unapply the payments settled against this entry before reversing it`,
          );
        }
        // Extension blocks' checks, e.g. reconciled entries stay put.
        for (const guard of this.#reversalGuards) guard(s);
        s.defScalar(
          "reversal_date",
          sql`coalesce(p_posting_date, original.posting_date)`,
        );
        // A reversal before its entry would leave the books showing only
        // the reversal in between.
        s.throwErrorIf(
          sql`reversal_date < original.posting_date`,
          sql`'A reversal cannot be dated before the entry it reverses ('
            || format.date(original.posting_date, '%m/%d/%Y') || ')'`,
        );
        this.#assertOpenPeriod(
          s,
          sql`reversal_date`,
          sql`(select entity_id from db.ledger_lines
            where entry_id = p_entry_id)`,
        );
        s.defScalar("reversal_entry_id", { type: "BigInt" });
        s.modify(sql`insert into db.ledger_entries
          (posting_date, source, source_record_id, description,
            document_number, ${books ? sql`book,` : sql``} reverses_entry_id,
            posted_by)
          values (reversal_date, original.source, original.source_record_id,
            coalesce(p_description, 'Reversal of ' || coalesce(original.description, 'journal entry')),
            original.document_number, ${books ? sql`original.book,` : sql``}
            p_entry_id, current_user)
          returning id into reversal_entry_id`);
        const copied = [
          ...lineColumns.filter((c) => c !== "amount"),
          ...(books ? ["book"] : []),
        ];
        s.modify(sql`insert into db.ledger_lines
          (entry_id, posting_date, amount, ${copied.map((c) => sql.ref(c))})
          select reversal_entry_id, reversal_date, -amount, ${
          copied.map((c) => c === "amount_txn" ? sql`-amount_txn` : sql.ref(c))
        }
          from db.ledger_lines where entry_id = p_entry_id`);
        s.setScalar("entry_id", sql`reversal_entry_id`);
      },
    });
  }
}
