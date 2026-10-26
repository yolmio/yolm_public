import { LedgerPage } from "blocks/ledger";
import type {
  LedgerBlock,
  LedgerNavItem,
  LedgerSource,
  LedgerStandardAccount,
} from "blocks/ledger";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { Table } from "components/table";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";
import { Each, Route, Show } from "std/ui";
import {
  bankFeedActions,
  BankFeedPage,
  bankSplitFields,
  defineBankFeeds,
} from "./bank_feeds.tsx";
import { definePayoutRuns, syncPayouts } from "./payouts.ts";
import {
  defineReconciliation,
  ReconcileAccountsPage,
  reconciliationActions,
  reconciliationDifferenceSql,
  ReconciliationPage,
} from "./reconciliation.tsx";

/** Account numbers payouts post to; ported charts name their own. */
export interface LedgerPayoutAccounts {
  clearingAccount?: string;
  depositAccount?: string;
  feeAccount?: string;
  /** First arrival date to download (YYYY-MM-DD), e.g. the cut-over. */
  startOn?: string;
}

/**
 * Where processor payments wait for their payout. Kept apart from
 * undeposited funds, which deposits empty.
 */
export const PAYMENT_CLEARING_ACCOUNT: LedgerStandardAccount = {
  number: "1320",
  name: "Payment Processor Clearing",
  type: "other_current_asset",
};

export interface LedgerBankingOptions {
  ledger: LedgerBlock;
  /**
   * Bank and credit card reconciliation: statements with ending balances
   * and the lines cleared against them. Defaults to true.
   */
  reconciliation?: boolean;
  /**
   * Bank feeds through the `bank_feeds` service and statement CSV import:
   * a review queue with rules, matching, and adding. Registers the
   * `bank_feed` source.
   */
  feeds?: boolean;
  /**
   * `syncPayouts`: payment processor payouts from the `payments` service
   * move their gross out of the clearing account (default 1320 Payment
   * Processor Clearing, where processor payments are received) into the
   * deposit account (default 1000, net) and fees (default 6100). Registers
   * the `payment_payout` source.
   */
  payouts?: boolean | LedgerPayoutAccounts;
  /** Route prefix of the banking pages. Defaults to `/banking`. */
  basePath?: string;
}

/**
 * Banking on the ledger: reconciliation, bank feeds, statement import, and
 * processor payouts. Bank statements are money-only facts, so they belong to
 * finance, but they are their own area with their own pages and services.
 * Construct before `system.addBlock(ledger)`.
 */
export class LedgerBankingBlock implements Block {
  blockName = "LedgerBankingBlock";
  blockDisplayName = "Banking";
  componentDependencies: string[] = [];
  description =
    "Bank reconciliation, bank feeds, statement import, and payouts posting to the ledger.";

  readonly ledger: LedgerBlock;
  readonly reconciliation: boolean;
  readonly feedSource?: LedgerSource;
  readonly payoutAccounts?: Required<Omit<LedgerPayoutAccounts, "startOn">>;
  readonly payoutStartOn?: string;
  readonly basePath: string;
  readonly #payoutSource?: LedgerSource;

  constructor(opts: LedgerBankingOptions) {
    const ledger = opts.ledger;
    this.ledger = ledger;
    this.reconciliation = opts.reconciliation ?? true;
    this.basePath = opts.basePath ?? "/banking";
    if (opts.feeds) {
      this.feedSource = ledger.registerSource({
        key: "bank_feed",
        displayName: "Bank feed",
      });
      ledger.addIntegrityCheck(
        "Reviewed bank transactions the bank later removed",
        sql`select count(*) from db.ledger_bank_transactions txn
          where txn.removed_at is not null and txn.line_id is not null
            and not exists (select 1 from db.ledger_bank_transactions live
              where live.line_id = txn.line_id and live.removed_at is null)`,
      );
    }
    if (opts.payouts) {
      const given = typeof opts.payouts === "object" ? opts.payouts : {};
      const accounts = {
        clearingAccount: given.clearingAccount ??
          PAYMENT_CLEARING_ACCOUNT.number,
        depositAccount: given.depositAccount ?? "1000",
        feeAccount: given.feeAccount ?? "6100",
      };
      if (!given.clearingAccount) {
        ledger.addStandardAccounts([PAYMENT_CLEARING_ACCOUNT]);
      }
      this.payoutAccounts = accounts;
      this.payoutStartOn = given.startOn;
      this.#payoutSource = ledger.registerSource({
        key: "payment_payout",
        displayName: "Payment payout",
      });
      const payoutLines = (numbers: string[], classes: string[]) =>
        sql`select count(*) from db.ledger_lines line
          join db.ledger_entries entry on entry.id = line.entry_id
          join db.ledger_accounts account on account.id = line.account_id
          where entry.source = cast('payment_payout' as enums.ledger_source)
            and account.number in (${numbers.map((n) => sql.lit(n))})
            and account.account_class not in (${
          classes.map((c) => sql.lit(c))
        })`;
      ledger.addIntegrityCheck(
        "Payouts posted more than once",
        sql`select count(*) from (select document_number
          from db.ledger_entries entry
          where entry.source = cast('payment_payout' as enums.ledger_source)
            and ${ledger.isActiveEntrySql(sql`entry`)}
          group by document_number having count(*) > 1) duplicates`,
      );
      ledger.addIntegrityCheck(
        "Payout lines on a clearing or deposit account that is not an asset",
        payoutLines([accounts.clearingAccount, accounts.depositAccount], [
          "asset",
        ]),
      );
      ledger.addIntegrityCheck(
        "Payout fees on an account that is not an expense",
        payoutLines([accounts.feeAccount], ["expense"]),
      );
    }
    if (this.reconciliation) {
      ledger.addCloseCheck(
        "Bank and card accounts not reconciled into the closing month",
        (through) =>
          sql`select count(*) from db.ledger_accounts account
            where account.type in (
                cast('bank' as enums.ledger_account_type),
                cast('credit_card' as enums.ledger_account_type))
              and exists (select 1 from db.ledger_lines line
                where line.account_id = account.id
                  and line.posting_date <= ${through})
              and coalesce((select max(reconciliation.statement_date)
                from db.ledger_reconciliations reconciliation
                where reconciliation.account_id = account.id
                  and reconciliation.completed_at is not null),
                date '1900-01-01') < date.start_of_month(${through})`,
      );
      ledger.addReversalGuard((s) =>
        s.throwErrorIf(
          sql`exists (select 1 from db.ledger_reconciliation_lines cleared
            join db.ledger_reconciliations reconciliation
              on reconciliation.id = cleared.reconciliation_id
            where reconciliation.completed_at is not null
              and cleared.line_id in (select id from db.ledger_lines
                where entry_id = p_entry_id))`,
          sql
            .lit`This entry is cleared in a completed reconciliation; undo the reconciliation first`,
        )
      );
    }
  }

  initialize() {
    if (this.reconciliation) {
      defineReconciliation(this.ledger, !!this.feedSource);
    }
    if (this.feedSource) defineBankFeeds(this.ledger, this.feedSource);
    if (this.#payoutSource) definePayoutRuns();
  }

  /** Fields of the splits table for `feeds.addSplit`. */
  get splitFields() {
    return bankSplitFields(this.ledger);
  }

  /** True when processor payouts are on. */
  get payoutsEnabled() {
    return !!this.#payoutSource;
  }

  #require(enabled: boolean, facet: string) {
    if (!enabled) {
      throw new Error(`LedgerBankingBlock ${facet} is not enabled`);
    }
  }

  /**
   * Start a statement, clear lines, complete it once the difference is
   * zero, undo the latest completed statement, or delete one in progress.
   */
  get reconcile() {
    this.#require(this.reconciliation, "reconciliation");
    return reconciliationActions;
  }

  /** Statement balance minus cleared balance for a reconciliation. */
  reconciliationDifferenceSql(reconciliationId: Sql): Sql {
    this.#require(this.reconciliation, "reconciliation");
    return reconciliationDifferenceSql(reconciliationId);
  }

  /**
   * Connect, sync, and disconnect feeds (service calls, outside a
   * transaction); import statements and review transactions (in the
   * caller's transaction).
   */
  get feeds() {
    this.#require(!!this.feedSource, "feeds");
    return bankFeedActions(this.ledger, this.feedSource!);
  }

  /** Opt-in scheduled job that syncs every connected bank feed. */
  scheduleFeedSync(schedule: string) {
    const actions = this.feeds;
    system.scheduledProc({
      name: "ledger_sync_bank_feeds",
      schedule,
      procedure: (s) => actions.syncAll(s),
    });
  }

  /**
   * Downloads payment processor payouts arriving on or after `since` and
   * posts each new one; by default from two weeks before the last payout
   * posted, or `startOn`, or 30 days ago. Runs outside a transaction; each
   * payout posts in its own, and each run is kept in `ledger_payout_runs`.
   */
  syncPayouts<T extends IServerBaseStatements>(
    s: T,
    opts: { since?: Sql } = {},
  ) {
    this.#require(!!this.#payoutSource, "payouts");
    const since = this.ledger.uniqueName("payouts_since");
    s.defScalar(since, {
      type: "Date",
      expr: opts.since ?? sql`coalesce(
        date.subtract(day, 14, (select max(entry.posting_date)
          from db.ledger_entries entry
          where entry.source = ${this.#payoutSource!.enumLiteral()}
            and entry.reverses_entry_id is null)),
        ${
        this.payoutStartOn
          ? sql`date ${sql.lit(this.payoutStartOn)}`
          : sql`cast(null as date)`
      },
        date.subtract(day, 30, current_date()))`,
    });
    syncPayouts(
      s,
      this.ledger,
      this.#payoutSource!,
      this.payoutAccounts!,
      sql.ref(since),
    );
  }

  /**
   * Opt-in scheduled payout sync. A failed run is kept with its error in
   * `ledger_payout_runs` and shown on the Payouts page.
   */
  schedulePayoutSync(schedule: string) {
    this.#require(!!this.#payoutSource, "payouts");
    system.scheduledProc({
      name: "ledger_sync_payouts",
      schedule,
      procedure: (s) =>
        s.try({
          body: (s) => this.syncPayouts(s),
          errorName: "payout_sync_error",
          catch: (s) => s.rollbackIfInTransaction(),
        }),
    });
  }
}

export function bankingNavItems(banking: LedgerBankingBlock): LedgerNavItem[] {
  const base = banking.basePath;
  const items: LedgerNavItem[] = [];
  if (banking.feedSource) {
    items.push({ label: "Bank feed", href: `${base}/feed`, icon: "Sync" });
  }
  if (banking.reconciliation) {
    items.push({
      label: "Reconcile",
      href: `${base}/reconcile`,
      icon: "FactCheck",
    });
  }
  if (banking.payoutsEnabled) {
    items.push({ label: "Payouts", href: `${base}/payouts`, icon: "Payments" });
  }
  return items;
}

/** Recent syncs and payouts, with a button to sync now. */
function PayoutsPage(props: { banking: LedgerBankingBlock }) {
  const { banking } = props;
  const ledger = banking.ledger;
  return (
    <LedgerPage
      block={ledger}
      title="Payouts"
      actions={
        <ActionButton
          size="sm"
          action={(s) => {
            ledger.requireManage(s);
            banking.syncPayouts(s);
          }}
          successMessage="Payouts synced"
        >
          Sync now
        </ActionButton>
      }
    >
      <Data
        procedure={(s) => {
          s.defTable(
            "payout_runs",
            sql`select id, ran_at, since, posted_count, error
              from db.ledger_payout_runs order by id desc limit 20`,
          );
          s.defTable(
            "payout_entries",
            sql`select entry.id, entry.posting_date, entry.document_number,
                (select sum(line.amount) from db.ledger_lines line
                  where line.entry_id = entry.id
                    and line.account_id = ${
              ledger.account(banking.payoutAccounts!.depositAccount)
            }) as net
              from db.ledger_entries entry
              where entry.source = cast('payment_payout'
                as enums.ledger_source)
                and ${ledger.isActiveEntrySql(sql`entry`)}
              order by entry.posting_date desc, entry.id desc limit 100`,
          );
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-col gap-2">
          <Typography level="title-md">Recent syncs</Typography>
          <Each table="payout_runs" recordName="payout_run">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                {sql`format.date(payout_run.ran_at, '%m/%d/%Y %I:%M %p')
                  || ' · from ' || format.date(payout_run.since, '%m/%d/%Y')
                  || ' · ' || payout_run.posted_count || ' posted'`}
              </span>
              <Show when={sql`payout_run.error is not null`}>
                <Chip size="sm" color="danger">{sql`payout_run.error`}</Chip>
              </Show>
            </div>
          </Each>
        </Card>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <th>Arrived</th>
                <th>Payout</th>
                <th>
                  <div className="text-right">Net</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <Each table="payout_entries" recordName="payout_entry">
                <tr>
                  <td>
                    {sql`format.date(payout_entry.posting_date, '%m/%d/%Y')`}
                  </td>
                  <td>{sql`payout_entry.document_number`}</td>
                  <td className="text-right tabular-nums">
                    {ledger.formatAmountSql(sql`payout_entry.net`)}
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

/** The banking pages, mounted under the block's `basePath`. */
export function LedgerBankingRoutes(props: { banking: LedgerBankingBlock }) {
  const { banking } = props;
  const ctx = { block: banking.ledger, base: banking.basePath };
  return (
    <>
      {banking.reconciliation
        ? (
          <>
            <Route path={`${ctx.base}/reconcile`} exact>
              <ReconcileAccountsPage {...ctx} />
            </Route>
            <Route
              path={`${ctx.base}/reconcile/{ledger_reconciliation_id:id}`}
            >
              <ReconciliationPage {...ctx} />
            </Route>
          </>
        )
        : null}
      {banking.payoutsEnabled
        ? (
          <Route path={`${ctx.base}/payouts`}>
            <PayoutsPage banking={banking} />
          </Route>
        )
        : null}
      {banking.feedSource
        ? (
          <Route path={`${ctx.base}/feed`}>
            <BankFeedPage block={ctx.block} source={banking.feedSource} />
          </Route>
        )
        : null}
    </>
  );
}
