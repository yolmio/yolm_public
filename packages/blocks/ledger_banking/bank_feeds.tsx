import { Button } from "components/button";
import { Card } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { Select } from "components/select";
import { Table } from "components/table";
import { Textarea } from "components/textarea";
import { TableRecordSelect } from "components/table_record_select";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type {
  EndpointStatementsOrFn,
  HelperProcField,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import {
  accountTypesSql,
  AMOUNT_TYPE,
  dimensionLabel,
  formatDateSql as date,
  LedgerPage as Page,
  manageAction,
  openItemAccountTypesSql,
  STATEMENT_ACCOUNT_TYPES,
} from "blocks/ledger";
import type { LedgerBlock, LedgerSource } from "blocks/ledger";

/** Days either side of a bank transaction's date to look for a match. */
const MATCH_WINDOW_DAYS = 7;

/** Pages fetched per sync at most, so a misbehaving provider cannot loop. */
const MAX_PAGES = 100;

const FEED_ACCOUNT_TYPES = accountTypesSql(STATEMENT_ACCOUNT_TYPES);

/**
 * Bank feeds: provider connections per bank or card account, synced
 * transactions waiting for review, and rules that suggest an account.
 * Reviewing a transaction matches it to a posted line, adds it as a new
 * entry, or excludes it. Amounts are signed like the account's lines: money
 * in is positive, money out (including card charges) negative.
 *
 * Review state is derived, not stored: a transaction is excluded, or has a
 * line with an active entry (added when that entry is its own bank-feed
 * entry, matched otherwise), or is waiting for review.
 */
export function defineBankFeeds(block: LedgerBlock, source: LedgerSource) {
  const { db } = system;
  db.table("ledger_bank_connections", (table) => {
    table.displayName("Bank connections");
    table.fk("account_id", "ledger_accounts").notNull().onDelete("Restrict");
    // Entity that owns the account; null is the home entity.
    if (block.entities) {
      table.fk("entity_id", "ledger_entities").onDelete("Restrict");
    }
    /** Provider link session while the user finishes connecting. */
    table.string("link_session", 200);
    table.string("link_url", 1000);
    /** Provider connection reference once connected. */
    table.string("connection_ref", 200);
    table.string("institution", 200);
    table.string("mask", 10);
    table.string("sync_cursor", 500);
    /** Transactions dated before this are not downloaded (already booked). */
    table.date("start_on");
    table.timestampUtc("last_synced_at");
    /** Why the last scheduled sync failed, e.g. the bank login expired. */
    table.string("last_error", 500);
    table.timestampUtc("disconnected_at");
    table.skipAutoApi();
  });
  db.table("ledger_bank_transactions", (table) => {
    table.displayName("Bank transactions");
    table.fk("connection_id", "ledger_bank_connections").notNull()
      .onDelete("Restrict");
    table.string("external_id", 200).notNull();
    table.date("posted_on").notNull();
    table.money("amount", AMOUNT_TYPE).notNull();
    table.string("description", 500);
    table.string("counterparty", 200);
    /** The matched or added line on the connection's account. */
    table.fk("line_id", "ledger_lines").onDelete("Restrict");
    table.bool("excluded");
    /**
     * Set when the bank drops a transaction that was already reviewed; its
     * entry stays until someone undoes it or the replacement matches it.
     */
    table.timestampUtc("removed_at");
    table.unique(["connection_id", "external_id"]);
    table.skipAutoApi();
  });
  db.table("ledger_bank_rules", (table) => {
    table.displayName("Bank rules");
    /** Case-insensitive text the description or counterparty contains. */
    table.string("contains_text", 200).notNull();
    /** True for money in, false for money out, null for either. */
    table.bool("money_in");
    /** Bounds on the absolute amount, either optional. */
    table.money("min_amount", AMOUNT_TYPE);
    table.money("max_amount", AMOUNT_TYPE);
    table.fk("account_id", "ledger_accounts").notNull().onDelete("Restrict");
    // Payee, project, and other dimensions the added line gets.
    for (const d of lineDimensions(block)) {
      table.fk(`${d.key}_id`, d.table).onDelete("Restrict");
    }
    /** Adds matching transactions without review. */
    table.bool("auto_add");
    table.skipAutoApi();
  });

  const feedTransaction = <T extends IServerBaseStatements>(s: T) => {
    s.defRecord(
      "feed",
      sql`select txn.id, txn.amount, txn.posted_on, txn.description,
          txn.counterparty, connection.account_id,
          ${block.entities ? sql`connection.entity_id` : sql`null`}
            as entity_id,
          ${bankStatusSql(block, source, sql`txn`)} as status
        from db.ledger_bank_transactions txn
        join db.ledger_bank_connections connection
          on connection.id = txn.connection_id
        where txn.id = p_bank_transaction_id`,
    );
    s.throwErrorIf(sql`feed.id is null`, sql.lit`Bank transaction not found`);
  };
  const requireReview = <T extends IServerBaseStatements>(s: T) =>
    s.throwErrorIf(
      sql`feed.status <> 'for_review'`,
      sql.lit`This bank transaction is already reviewed`,
    );

  system.storedProcedure({
    name: "ledger_bank_match",
    transaction: "caller",
    inputScalars: [
      { name: "p_bank_transaction_id", type: "BigInt" },
      { name: "p_line_id", type: "BigInt" },
    ],
    procedure: (s) => {
      feedTransaction(s);
      requireReview(s);
      s.throwErrorUnless(
        sql`exists (${
          candidateLinesSql(block, sql`feed`)
        } and line.id = p_line_id)`,
        sql
          .lit`Match an unmatched posted line on the same account for the same amount`,
      );
      s.modify(sql`update db.ledger_bank_transactions
        set line_id = p_line_id where id = p_bank_transaction_id`);
    },
  });

  system.storedProcedure({
    name: "ledger_bank_add",
    transaction: "caller",
    inputScalars: [{ name: "p_bank_transaction_id", type: "BigInt" }],
    // Where the money went: one row per account, amounts signed like the
    // transaction and summing to it.
    inputTables: [{ name: "splits", fields: bankSplitFields(block) }],
    procedure: (s) => {
      feedTransaction(s);
      requireReview(s);
      s.throwErrorIf(
        sql`not exists (select 1 from splits)
          or exists (select 1 from splits
            where account_id is null or account_id = feed.account_id
              or amount is null)`,
        sql.lit`Choose the account this transaction belongs to`,
      );
      s.throwErrorIf(
        sql`(select sum(amount) from splits) <> feed.amount`,
        sql.lit`The split amounts must add up to the transaction`,
      );
      // Receivables and payables need a customer or vendor and a document
      // to settle against; record those through their own sources.
      s.throwErrorIf(
        sql`exists (select 1 from splits
          join db.ledger_accounts account on account.id = splits.account_id
          where account.type in ${openItemAccountTypesSql()})`,
        sql
          .lit`Record customer payments and bill payments through their documents, not the bank feed`,
      );
      s.defScalar("added_entry_id", { type: "BigInt" });
      const dims = lineDimensions(block).map((d) => `${d.key}_id`);
      source.post(s, {
        recordId: sql`feed.id`,
        date: sql`feed.posted_on`,
        description: sql`coalesce(feed.counterparty, feed.description)`,
        lines: {
          query: sql`select feed.account_id as account_id,
              feed.amount as amount, feed.description as memo
              ${block.entities ? sql`, feed.entity_id as entity_id` : sql``}
              ${
            dims.length
              ? sql`, ${
                dims.map((d) => sql`cast(null as bigint) as ${sql.ref(d)}`)
              }`
              : sql``
          }
            union all
            select account_id, -amount, coalesce(memo, feed.description)
              ${block.entities ? sql`, feed.entity_id` : sql``}
              ${dims.length ? sql`, ${dims.map((d) => sql.ref(d))}` : sql``}
            from splits`,
          columns: [
            "memo",
            ...(block.entities ? ["entity"] : []),
            ...lineDimensions(block).map((d) => d.key),
          ],
        },
        intoEntryId: "added_entry_id",
      });
      s.modify(sql`update db.ledger_bank_transactions
        set line_id = (select min(id) from db.ledger_lines
          where entry_id = added_entry_id and account_id = feed.account_id)
        where id = p_bank_transaction_id`);
    },
  });

  system.storedProcedure({
    name: "ledger_bank_exclude",
    transaction: "caller",
    inputScalars: [{ name: "p_bank_transaction_id", type: "BigInt" }],
    procedure: (s) => {
      feedTransaction(s);
      requireReview(s);
      s.modify(sql`update db.ledger_bank_transactions
        set excluded = true where id = p_bank_transaction_id`);
    },
  });

  system.storedProcedure({
    name: "ledger_bank_undo",
    transaction: "caller",
    inputScalars: [{ name: "p_bank_transaction_id", type: "BigInt" }],
    procedure: (s) => {
      feedTransaction(s);
      s.if(sql`feed.status = 'added'`, (s) => {
        source.reverse(s, { recordId: sql`feed.id` });
      });
      s.modify(sql`update db.ledger_bank_transactions
        set line_id = null, excluded = null
        where id = p_bank_transaction_id`);
      // A transaction the bank already dropped has nothing left to review.
      s.modify(sql`delete from db.ledger_bank_transactions
        where id = p_bank_transaction_id and removed_at is not null`);
    },
  });

  // Auto-matches pairs that are unique both ways: one candidate line for the
  // transaction and one waiting transaction for the line.
  system.storedProcedure({
    name: "ledger_bank_match_new",
    transaction: "caller",
    inputScalars: [{ name: "p_connection_id", type: "BigInt" }],
    procedure: (s) => {
      s.defTable(
        "waiting",
        sql`select txn.id, txn.amount, txn.posted_on, connection.account_id
          from db.ledger_bank_transactions txn
          join db.ledger_bank_connections connection
            on connection.id = txn.connection_id
          where txn.connection_id = p_connection_id
            and ${bankStatusSql(block, source, sql`txn`)} = 'for_review'`,
      );
      s.defTable(
        "candidates",
        sql`select waiting.id as bank_transaction_id, line.id as line_id
          from waiting
          join db.ledger_lines line
            on line.account_id = waiting.account_id
              and line.amount = waiting.amount
          where ${candidateConditionsSql(block, sql`waiting`)}`,
      );
      s.modify(sql`update db.ledger_bank_transactions
        set line_id = (select line_id from candidates
          where candidates.bank_transaction_id = ledger_bank_transactions.id)
        where id in (select bank_transaction_id from candidates
            group by bank_transaction_id having count(*) = 1)
          and id in (select min(bank_transaction_id) from candidates
            where line_id in (select line_id from candidates
              group by line_id having count(*) = 1)
            group by line_id)`);
    },
  });

  // Statement lines from a CSV file into a file-import connection for the
  // account, skipping lines already imported; then matching as for feeds.
  const entityField: HelperProcField[] = block.entities
    ? [{ name: "p_entity_id", type: "BigInt" }]
    : [];
  system.storedProcedure({
    name: "ledger_bank_import_statement",
    transaction: "caller",
    inputScalars: [
      { name: "p_account_id", type: "BigInt" },
      ...entityField,
      { name: "p_csv", type: "String" },
      { name: "p_date_column", type: "Int" },
      { name: "p_description_column", type: "Int" },
      { name: "p_amount_column", type: "Int" },
      // Card statements often show charges positive.
      { name: "p_flip_sign", type: "Bool" },
    ],
    outputScalars: [{ name: "imported_count", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorUnless(
        sql`exists (select 1 from db.ledger_accounts
          where id = p_account_id and type in ${FEED_ACCOUNT_TYPES})`,
        sql.lit`Statements import into bank and credit card accounts`,
      );
      s.defScalar(
        "file_connection_id",
        sql`(select min(id) from db.ledger_bank_connections
          where account_id = p_account_id and connection_ref is null
            and link_session is null and disconnected_at is null)`,
      );
      s.if(sql`file_connection_id is null`, (s) => {
        s.modify(sql`insert into db.ledger_bank_connections
          (account_id, institution ${block.entities ? sql`, entity_id` : sql``})
          values (p_account_id, 'File import'
            ${block.entities ? sql`, p_entity_id` : sql``})
          returning id into file_connection_id`);
      });
      const field = (column: string) =>
        sql`case ${sql.ref(column)} ${
          Array.from({ length: 20 }, (_, i) =>
            sql`when ${i} then row.${sql.ref(`field_${i}`)}`).reduce((a, b) =>
              sql`${a} ${b}`
            )
        } end`;
      const rawDate = sql`trim(${field("p_date_column")})`;
      // Dates need a four-digit year: 03/02/26 would read as year 26.
      s.defTable(
        "statement_lines",
        sql`select
            case when ${rawDate} like '____-__-__'
                then try_cast(${rawDate} as date)
              when ${rawDate} like '%/%/____'
                then date.parse_date(${rawDate}, '%m/%d/%Y')
              end as posted_on,
            trim(${field("p_description_column")}) as description,
            case when coalesce(p_flip_sign, false) then -1 else 1 end
              * case when trim(${field("p_amount_column")}) like '(%)'
                then -1 else 1 end
              * try_cast(replace(replace(replace(replace(
                trim(${field("p_amount_column")}), '$', ''), ',', ''),
                '(', ''), ')', '') as decimal(18, 4)) as amount,
            row.ordinal
          from csv.rows(p_csv) row
          where trim(coalesce(${field("p_date_column")}, '')) <> ''`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from statement_lines
          where posted_on is null or amount is null
            or posted_on < date '1900-01-01')`,
        sql
          .lit`Every statement line needs a date (YYYY-MM-DD or MM/DD/YYYY) and an amount`,
      );
      // Identical lines on one day are told apart by their order. Lines a
      // live feed on the same account already downloaded (same date and
      // amount) are not imported again.
      s.defScalar(
        "already_imported",
        sql`(select count(*) from db.ledger_bank_transactions
          where connection_id = file_connection_id)`,
      );
      s.modify(sql`insert into db.ledger_bank_transactions
        (connection_id, external_id, posted_on, amount, description)
        select file_connection_id, external_id, posted_on, amount,
          description
        from (select posted_on, amount, description,
            'file:' || format.date(posted_on, '%Y-%m-%d') || '|'
              || cast(amount as string) || '|' || coalesce(description, '')
              || '|' || cast(row_number() over (
                partition by posted_on, amount, description
                order by ordinal) as string) as external_id,
            row_number() over (partition by posted_on, amount
              order by ordinal) as same_day_amount
          from statement_lines) line
        where external_id not in (select external_id
          from db.ledger_bank_transactions
          where connection_id = file_connection_id)
          and line.same_day_amount > (select count(*)
            from db.ledger_bank_transactions fed
            join db.ledger_bank_connections feed_connection
              on feed_connection.id = fed.connection_id
            where feed_connection.account_id = p_account_id
              and feed_connection.id <> file_connection_id
              and fed.removed_at is null
              and fed.posted_on = line.posted_on
              and fed.amount = line.amount)`);
      s.setScalar(
        "imported_count",
        sql`(select count(*) from db.ledger_bank_transactions
          where connection_id = file_connection_id) - already_imported`,
      );
      s.callStoredProcedure("ledger_bank_match_new", {
        inputScalars: { p_connection_id: sql`file_connection_id` },
      });
    },
  });
}

/** `for_review`, `matched`, `added`, or `excluded` for a bank transaction. */
export function bankStatusSql(
  block: LedgerBlock,
  source: LedgerSource,
  txn: Sql,
): Sql {
  const entry = sql`(select entry_id from db.ledger_lines
    where id = ${txn}.line_id)`;
  return sql`case
    when ${txn}.excluded then 'excluded'
    when ${txn}.line_id is null or not exists (
      select 1 from db.ledger_entries entry
      where entry.id = ${entry} and ${block.isActiveEntrySql(sql`entry`)})
      then 'for_review'
    when exists (select 1 from db.ledger_entries entry
      where entry.id = ${entry} and entry.source = ${source.enumLiteral()}
        and entry.source_record_id = ${txn}.id) then 'added'
    else 'matched' end`;
}

/**
 * Conditions on `line` (joined to its account and amount) for matching a
 * waiting transaction (`txn` with `posted_on`): within the window, in an
 * active base-book entry, and not already used by another transaction.
 */
function candidateConditionsSql(block: LedgerBlock, txn: Sql): Sql {
  return sql`line.posting_date
      >= date.subtract(day, ${MATCH_WINDOW_DAYS}, ${txn}.posted_on)
    and line.posting_date
      <= date.add(day, ${MATCH_WINDOW_DAYS}, ${txn}.posted_on)
    ${block.books.length ? sql`and line.book is null` : sql``}
    and exists (select 1 from db.ledger_entries entry
      where entry.id = line.entry_id and ${block.isActiveEntrySql(sql`entry`)})
    and not exists (select 1 from db.ledger_bank_transactions used
      join db.ledger_bank_connections used_connection
        on used_connection.id = used.connection_id
      where used.line_id is not null and used.line_id = line.id
        and used.excluded is not true and used.removed_at is null
        and used_connection.disconnected_at is null)`;
}

/** Lines a waiting transaction (`account_id`, `amount`, `posted_on`) can match. */
function candidateLinesSql(block: LedgerBlock, txn: Sql): Sql {
  return sql`select line.id, line.posting_date, entry.description,
      entry.document_number
    from db.ledger_lines line
    join db.ledger_entries entry on entry.id = line.entry_id
    where line.account_id = ${txn}.account_id
      and line.amount = ${txn}.amount
      and ${candidateConditionsSql(block, txn)}`;
}

/**
 * `column` of the first rule (lowest id) matching the transaction: its text
 * appears in the description or counterparty, and the direction and amount
 * bounds fit.
 */
function suggestedRuleSql(txn: Sql, column: string): Sql {
  // min(id) rather than `order by ... limit 1`, which the optimizer can
  // drop from a scalar subquery on a small table.
  return sql`(select chosen.${sql.ref(column)} from db.ledger_bank_rules chosen
    where chosen.id = (select min(rule.id) from db.ledger_bank_rules rule
      where contains(lower(coalesce(${txn}.description, '') || ' '
          || coalesce(${txn}.counterparty, '')), lower(rule.contains_text))
        and (rule.money_in is null or rule.money_in = (${txn}.amount > 0))
        and (rule.min_amount is null or abs(${txn}.amount) >= rule.min_amount)
        and (rule.max_amount is null
          or abs(${txn}.amount) <= rule.max_amount)))`;
}

/** Ledger dimensions a bank transaction's lines can carry (not entity). */
function lineDimensions(block: LedgerBlock) {
  return block.dimensions.filter((d) => d.key !== "entity");
}

/**
 * A split of an added bank transaction: account, amount, memo, and the
 * ledger's dimensions (e.g. `vendor_id` as the payee, `project_id`).
 */
export function bankSplitFields(block: LedgerBlock): HelperProcField[] {
  return [
    { name: "account_id", type: "BigInt" },
    { name: "amount", type: AMOUNT_TYPE },
    { name: "memo", type: { type: "String", maxLength: 500 } },
    ...lineDimensions(block).map((d): HelperProcField => ({
      name: `${d.key}_id`,
      type: "BigInt",
    })),
  ];
}

function serviceError<T extends IServerBaseStatements>(
  s: T,
  error: string,
  operation: string,
) {
  s.throwErrorIf(
    sql`${sql.ref(error)} is not null`,
    sql`${sql.lit(`Bank feed ${operation} failed: `)}
      || coalesce(${sql.ref(error)}->>'message', 'unknown error')`,
  );
}

/** First sync returns four transactions before today; later syncs none. */
const mockSyncTransactions: EndpointStatementsOrFn = (s) => {
  s.getRequestBodyJson("sync_request");
  const txn = (n: number, days: number, amount: number, text: string) =>
    sql`json_build_object(
      'id', (sync_request->>'connectionRef') || ${sql.lit(`-${n}`)},
      'date', date.subtract(day, ${days}, current_date()),
      'amount', ${amount}, 'description', ${sql.lit(text)},
      'counterparty', null)`;
  s.return(sql`case when sync_request->>'cursor' is null
    then json_build_object(
      'added', json_build_array(
        ${txn(1, 6, -42.5, "STAPLES #1123 OFFICE SUPPLIES")},
        ${txn(2, 5, -1800, "ACME PROPERTIES RENT")},
        ${txn(3, 3, -18.99, "GITHUB INC")},
        ${txn(4, 2, 2500, "MOBILE DEPOSIT")}),
      'removed', json_build_array(), 'nextCursor', 'mock-cursor-1',
      'hasMore', false)
    else json_build_object('added', json_build_array(),
      'removed', json_build_array(), 'nextCursor', sync_request->>'cursor',
      'hasMore', false) end`);
};

/**
 * Bank feed actions. Review actions run in the caller's transaction;
 * `connect`, `finishConnecting`, `sync`, `syncAll`, and `disconnect` call
 * the `bank_feeds` service and open their
 * own transactions.
 */
export function bankFeedActions(block: LedgerBlock, source: LedgerSource) {
  const name = (stem: string) => block.uniqueName(stem);
  const call = <T extends IServerBaseStatements>(
    s: T,
    proc: string,
    inputScalars: Record<string, Sql>,
  ) => s.callStoredProcedure(proc, { inputScalars });
  const actions = {
    /**
     * Starts connecting a bank or card account (with entities, owned by
     * `entityId`, default the home entity). The connection's `link_url` is
     * the provider page where the user signs in; then `finishConnecting`.
     * Providers that need no sign-in (and the mock) connect at once.
     */
    connect<T extends IServerBaseStatements>(
      s: T,
      opts: {
        accountId: Sql;
        entityId?: Sql;
        /** Skip transactions before this date, e.g. the cut-over date. */
        startOn?: Sql;
        intoConnectionId: string;
      },
    ) {
      const [account, session, error] = [
        name("bank_link_account"),
        name("bank_link_session"),
        name("bank_link_error"),
      ];
      s.defScalar(account, { type: "BigInt", expr: opts.accountId });
      s.throwErrorUnless(
        sql`exists (select 1 from db.ledger_accounts
          where id = ${sql.ref(account)} and type in ${FEED_ACCOUNT_TYPES})`,
        sql.lit`Bank feeds connect bank and credit card accounts`,
      );
      s.serviceRequest({
        serviceType: sql.lit`bank_feeds`,
        operation: sql.lit`create_link_session`,
        optIn: true,
        requestJson: sql`json_build_object('accountId', ${sql.ref(account)},
          'accountName', (select name from db.ledger_accounts
            where id = ${sql.ref(account)}))`,
        defResultJsonScalar: session,
        defErrorJsonScalar: error,
        mockProcedure: (s) => {
          s.return(
            sql`json_build_object('sessionId', 'mock-session', 'url', null)`,
          );
        },
      });
      serviceError(s, error, "sign-in");
      s.startTransaction();
      s.modify(sql`insert into db.ledger_bank_connections
        (account_id, link_session, link_url, start_on
          ${block.entities ? sql`, entity_id` : sql``})
        values (${sql.ref(account)}, ${sql.ref(session)}->>'sessionId',
          ${sql.ref(session)}->>'url', ${opts.startOn ?? sql`null`}
          ${block.entities ? sql`, ${opts.entityId ?? sql`null`}` : sql``})
        returning id into ${sql.ref(opts.intoConnectionId)}`);
      s.commitTransaction();
      s.if(sql`${sql.ref(session)}->>'url' is null`, (s) => {
        actions.finishConnecting(s, sql.ref(opts.intoConnectionId));
      });
    },

    /** Exchanges a completed link session for a connection, then syncs. */
    finishConnecting<T extends IServerBaseStatements>(
      s: T,
      connectionId: Sql,
    ) {
      const [id, linked, error] = [
        name("bank_connection_id"),
        name("bank_linked"),
        name("bank_link_error"),
      ];
      s.defScalar(id, { type: "BigInt", expr: connectionId });
      s.throwErrorUnless(
        sql`exists (select 1 from db.ledger_bank_connections
          where id = ${sql.ref(id)} and link_session is not null
            and disconnected_at is null)`,
        sql.lit`This bank connection is not waiting for sign-in`,
      );
      s.serviceRequest({
        serviceType: sql.lit`bank_feeds`,
        operation: sql.lit`exchange_link`,
        optIn: true,
        requestJson: sql`(select json_build_object('sessionId', link_session,
            'accountId', account_id)
          from db.ledger_bank_connections where id = ${sql.ref(id)})`,
        defResultJsonScalar: linked,
        defErrorJsonScalar: error,
        mockProcedure: (s) => {
          s.getRequestBodyJson("link_request");
          s.return(sql`json_build_object(
            'connectionRef', 'mock-' || (link_request->>'accountId'),
            'institution', 'Mock Bank', 'mask', '4321')`);
        },
      });
      serviceError(s, error, "sign-in");
      s.startTransaction();
      s.modify(sql`update db.ledger_bank_connections
        set connection_ref = ${sql.ref(linked)}->>'connectionRef',
          institution = ${sql.ref(linked)}->>'institution',
          mask = ${sql.ref(linked)}->>'mask',
          link_session = null, link_url = null
        where id = ${sql.ref(id)}`);
      s.commitTransaction();
      actions.sync(s, sql.ref(id));
    },

    /**
     * Pulls new and removed transactions page by page from the saved
     * cursor, then auto-matches. A removed transaction is deleted whatever
     * its review state (its entry stays), so the bank's posted version can
     * match the same line.
     */
    sync<T extends IServerBaseStatements>(s: T, connectionId: Sql) {
      const [id, pages, page, error, cursor] = [
        name("bank_sync_connection"),
        name("bank_sync_pages"),
        name("bank_sync_page"),
        name("bank_sync_error"),
        name("bank_sync_cursor"),
      ];
      const ref = sql.ref;
      s.defScalar(id, { type: "BigInt", expr: connectionId });
      s.throwErrorIf(
        sql`not exists (select 1 from db.ledger_bank_connections
          where id = ${ref(id)} and connection_ref is not null
            and disconnected_at is null)`,
        sql.lit`This bank connection is not connected`,
      );
      s.defScalar(pages, sql`0`);
      s.defScalar(page, { type: "Json" });
      s.defScalar(error, { type: "Json" });
      s.defScalar(cursor, { type: { type: "String", maxLength: 500 } });
      s.while(sql`${ref(pages)} < ${MAX_PAGES}`, (s) => {
        s.setScalar(
          cursor,
          sql`(select sync_cursor from db.ledger_bank_connections
            where id = ${ref(id)})`,
        );
        s.serviceRequest({
          serviceType: sql.lit`bank_feeds`,
          operation: sql.lit`sync_transactions`,
          optIn: true,
          requestJson: sql`(select json_build_object(
              'connectionRef', connection_ref, 'cursor', sync_cursor)
            from db.ledger_bank_connections where id = ${ref(id)})`,
          setResultJsonScalar: page,
          setErrorJsonScalar: error,
          mockProcedure: mockSyncTransactions,
        });
        serviceError(s, error, "sync");
        const added = sql`select item.value->>'id' as external_id,
            cast(item.value->>'date' as date) as posted_on,
            cast(item.value->>'amount' as decimal(18, 4)) as amount,
            item.value->>'description' as description,
            item.value->>'counterparty' as counterparty
          from json.array_each(${ref(page)}->'added') item`;
        s.startTransaction();
        const removed = sql`connection_id = ${ref(id)}
          and external_id in (select json_build_array(item.value)->>0
            from json.array_each(${ref(page)}->'removed') item)`;
        // Unreviewed ones go; reviewed ones keep their entry, flagged. New
        // ones another connection of the account already has (same date
        // and amount, e.g. after reconnecting or a statement import) are
        // not downloaded again.
        s.modify(sql`delete from db.ledger_bank_transactions
          where ${removed} and line_id is null`);
        s.modify(sql`update db.ledger_bank_transactions
          set removed_at = now()
          where ${removed} and line_id is not null and removed_at is null`);
        s.modify(sql`insert into db.ledger_bank_transactions
          (connection_id, external_id, posted_on, amount, description,
            counterparty)
          select ${ref(id)}, external_id, posted_on, amount, description,
            counterparty
          from (select item.*, row_number() over (
                partition by item.posted_on, item.amount
                order by item.external_id) as same_day_amount
            from (select external_id, min(posted_on) as posted_on,
                min(amount) as amount, min(description) as description,
                min(counterparty) as counterparty
              from (${added}) added_item group by external_id) item) item
          where external_id not in (select external_id
            from db.ledger_bank_transactions
            where connection_id = ${ref(id)})
            and posted_on >= coalesce((select start_on
              from db.ledger_bank_connections where id = ${ref(id)}),
              posted_on)
            and item.same_day_amount > (select count(*)
              from db.ledger_bank_transactions other
              join db.ledger_bank_connections other_connection
                on other_connection.id = other.connection_id
              where other_connection.account_id = (select account_id
                  from db.ledger_bank_connections where id = ${ref(id)})
                and other_connection.id <> ${ref(id)}
                and other.removed_at is null
                and other.posted_on = item.posted_on
                and other.amount = item.amount)`);
        s.modify(sql`update db.ledger_bank_connections
          set sync_cursor = coalesce(${ref(page)}->>'nextCursor', sync_cursor),
            last_synced_at = now(), last_error = null
          where id = ${ref(id)}`);
        s.commitTransaction();
        s.setScalar(pages, sql`${ref(pages)} + 1`);
        // Stop when the provider is done or the cursor did not move.
        s.if(
          sql`not coalesce(cast(${ref(page)}->>'hasMore' as bool), false)
            or ${ref(page)}->>'nextCursor' is null
            or ${ref(page)}->>'nextCursor' = coalesce(${ref(cursor)}, '')`,
          (s) => s.setScalar(pages, sql`${MAX_PAGES}`),
        );
      });
      s.startTransaction();
      call(s, "ledger_bank_match_new", { p_connection_id: ref(id) });
      s.commitTransaction();
      actions.autoAdd(s, ref(id));
    },

    /**
     * Posts the transactions waiting for review that an auto-add rule covers
     * (on one connection, or all), each in its own transaction outside the
     * caller's. One that cannot post (a closed month, an account that needs
     * a dimension) stays for review and its reason is kept on the
     * connection's `last_error`.
     */
    autoAdd<T extends IServerBaseStatements>(s: T, connectionId?: Sql) {
      const dims = lineDimensions(block);
      const row = name("bank_auto_add");
      s.forEachQuery(
        sql`select txn.id, txn.connection_id,
            ${suggestedRuleSql(sql`txn`, "account_id")} as account_id
            ${
          dims.length
            ? sql`, ${
              dims.map((d) =>
                sql`${suggestedRuleSql(sql`txn`, `${d.key}_id`)}
                as ${sql.ref(`${d.key}_id`)}`
              )
            }`
            : sql``
        }
          from db.ledger_bank_transactions txn
          join db.ledger_bank_connections connection
            on connection.id = txn.connection_id
          where connection.disconnected_at is null
            ${
          connectionId ? sql`and txn.connection_id = ${connectionId}` : sql``
        }
            and ${bankStatusSql(block, source, sql`txn`)} = 'for_review'
            and ${suggestedRuleSql(sql`txn`, "auto_add")}`,
        row,
        (s) =>
          s.try({
            body: (s) => {
              s.startTransaction();
              actions.add(
                s,
                sql`${sql.ref(row)}.id`,
                sql`${sql.ref(row)}.account_id`,
                Object.fromEntries(
                  dims.map((d) => [
                    d.key,
                    sql`${sql.ref(row)}.${sql.ref(`${d.key}_id`)}`,
                  ]),
                ),
              );
              s.commitTransaction();
            },
            errorName: "bank_auto_add_error",
            catch: (s) => {
              s.rollbackIfInTransaction();
              s.startTransaction();
              s.modify(sql`update db.ledger_bank_connections
                set last_error = substring('Could not add '
                  || format.date((select posted_on
                    from db.ledger_bank_transactions
                    where id = ${sql.ref(row)}.id), '%m/%d/%Y') || ': '
                  || coalesce(bank_auto_add_error.message,
                    'the books may be closed for its date'), 1, 500)
                where id = ${sql.ref(row)}.connection_id`);
              s.commitTransaction();
            },
          }),
      );
    },

    /**
     * Syncs every connected feed, e.g. from a scheduled job. A failing
     * connection records `last_error` and does not stop the others.
     */
    syncAll<T extends IServerBaseStatements>(s: T) {
      s.forEachQuery(
        sql`select id from db.ledger_bank_connections
          where connection_ref is not null and disconnected_at is null`,
        "bank_feed_connection",
        (s) => {
          s.try({
            body: (s) => actions.sync(s, sql`bank_feed_connection.id`),
            errorName: "bank_feed_error",
            catch: (s) => {
              s.rollbackIfInTransaction();
              s.startTransaction();
              s.modify(sql`update db.ledger_bank_connections
                set last_error = substring(coalesce(bank_feed_error.message,
                  'Sync failed'), 1, 500)
                where id = bank_feed_connection.id`);
              s.commitTransaction();
            },
          });
        },
      );
    },

    disconnect<T extends IServerBaseStatements>(s: T, connectionId: Sql) {
      const [id, result, error] = [
        name("bank_disconnect_id"),
        name("bank_disconnect_result"),
        name("bank_disconnect_error"),
      ];
      s.defScalar(id, { type: "BigInt", expr: connectionId });
      s.if(
        sql`(select connection_ref from db.ledger_bank_connections
          where id = ${sql.ref(id)}) is not null`,
        (s) => {
          s.serviceRequest({
            serviceType: sql.lit`bank_feeds`,
            operation: sql.lit`disconnect`,
            optIn: true,
            requestJson: sql`(select json_build_object(
                'connectionRef', connection_ref)
              from db.ledger_bank_connections where id = ${sql.ref(id)})`,
            defResultJsonScalar: result,
            defErrorJsonScalar: error,
            mockProcedure: (s) => {
              s.return(sql`json_build_object('ok', true)`);
            },
          });
          serviceError(s, error, "disconnect");
        },
      );
      s.startTransaction();
      s.modify(sql`update db.ledger_bank_connections
        set disconnected_at = now() where id = ${sql.ref(id)}`);
      // Nothing reviewed goes; what was still waiting would come back from
      // a new connection and be reviewed twice.
      s.modify(sql`delete from db.ledger_bank_transactions
        where connection_id = ${sql.ref(id)} and line_id is null
          and excluded is null`);
      s.commitTransaction();
    },

    /** Links a posted line (same account and amount, not yet matched). */
    match<T extends IServerBaseStatements>(
      s: T,
      bankTransactionId: Sql,
      lineId: Sql,
    ) {
      call(s, "ledger_bank_match", {
        p_bank_transaction_id: bankTransactionId,
        p_line_id: lineId,
      });
    },
    /**
     * Posts the transaction against `accountId` as a new entry, with
     * dimension values by key (e.g. `{ vendor: vendorId }`).
     */
    add<T extends IServerBaseStatements>(
      s: T,
      bankTransactionId: Sql,
      accountId: Sql,
      dimensions: Record<string, Sql> = {},
    ) {
      const splits = name("bank_add_splits");
      const keys = Object.keys(dimensions);
      s.defTable(splits, { fields: bankSplitFields(block) });
      s.modify(
        sql`insert into ${sql.ref(splits)} (account_id, amount ${
          keys.length ? sql`, ${keys.map((k) => sql.ref(`${k}_id`))}` : sql``
        })
        select ${accountId}, amount ${
          keys.length ? sql`, ${keys.map((k) => dimensions[k])}` : sql``
        } from db.ledger_bank_transactions
        where id = ${bankTransactionId}`,
      );
      actions.addSplit(s, bankTransactionId, splits);
    },
    /**
     * Posts the transaction across several accounts. `splits` names a local
     * table with `bankSplitFields(ledger)`: `account_id`, `amount` (signed
     * like the transaction, summing to it), optional `memo`, and dimensions.
     */
    addSplit<T extends IServerBaseStatements>(
      s: T,
      bankTransactionId: Sql,
      splits: string,
    ) {
      s.callStoredProcedure("ledger_bank_add", {
        inputScalars: { p_bank_transaction_id: bankTransactionId },
        inputTables: { splits },
      });
    },
    /**
     * Imports a bank or card statement CSV into the review queue, into a
     * file-import connection for the account. The first row is a header;
     * columns are 0-based positions; dates are YYYY-MM-DD or MM/DD/YYYY; amounts are signed
     * money in. Re-importing the same lines adds nothing. Runs in the
     * caller's transaction.
     */
    importStatement<T extends IServerBaseStatements>(
      s: T,
      opts: {
        accountId: Sql;
        entityId?: Sql;
        csv: Sql;
        columns?: { date: number; description: number; amount: number };
        /** The file shows money out positive, as card statements often do. */
        flipSign?: Sql;
        intoCount?: string;
      },
    ) {
      const columns = opts.columns ?? { date: 0, description: 1, amount: 2 };
      const count = opts.intoCount ?? name("bank_imported");
      if (!opts.intoCount) s.defScalar(count, { type: "BigInt" });
      s.callStoredProcedure("ledger_bank_import_statement", {
        inputScalars: {
          p_account_id: opts.accountId,
          ...(block.entities
            ? { p_entity_id: opts.entityId ?? sql`cast(null as bigint)` }
            : {}),
          p_csv: opts.csv,
          p_date_column: sql`${columns.date}`,
          p_description_column: sql`${columns.description}`,
          p_amount_column: sql`${columns.amount}`,
          p_flip_sign: opts.flipSign ?? sql`false`,
        },
        outputScalars: { imported_count: count },
      });
    },
    /** Adds every transaction waiting for review that a rule covers. */
    addSuggested<T extends IServerBaseStatements>(s: T) {
      const dims = lineDimensions(block);
      const row = name("bank_suggested");
      s.forEachQuery(
        sql`select txn.id,
            ${suggestedRuleSql(sql`txn`, "account_id")} as account_id
            ${
          dims.length
            ? sql`, ${
              dims.map((d) =>
                sql`${suggestedRuleSql(sql`txn`, `${d.key}_id`)}
                  as ${sql.ref(`${d.key}_id`)}`
              )
            }`
            : sql``
        }
          from db.ledger_bank_transactions txn
          join db.ledger_bank_connections connection
            on connection.id = txn.connection_id
          where connection.disconnected_at is null
            and ${bankStatusSql(block, source, sql`txn`)}
              = 'for_review'
            and ${suggestedRuleSql(sql`txn`, "account_id")} is not null`,
        row,
        (s) =>
          actions.add(
            s,
            sql`${sql.ref(row)}.id`,
            sql`${sql.ref(row)}.account_id`,
            Object.fromEntries(
              dims.map((
                d,
              ) => [d.key, sql`${sql.ref(row)}.${sql.ref(`${d.key}_id`)}`]),
            ),
          ),
      );
    },
    exclude<T extends IServerBaseStatements>(s: T, bankTransactionId: Sql) {
      call(s, "ledger_bank_exclude", {
        p_bank_transaction_id: bankTransactionId,
      });
    },
    /** Returns a reviewed transaction to review, reversing an added entry. */
    undo<T extends IServerBaseStatements>(s: T, bankTransactionId: Sql) {
      call(s, "ledger_bank_undo", {
        p_bank_transaction_id: bankTransactionId,
      });
    },
  };
  return actions;
}

/** Connections, the review queue, and bank rules. */
export function BankFeedPage(
  props: { block: LedgerBlock; source: LedgerSource },
) {
  const { block } = props;
  const actions = bankFeedActions(block, props.source);
  const manage =
    (body: (s: UiServerStatements) => void) => (s: UiServerStatements) => {
      block.requireManage(s);
      body(s);
    };
  return (
    <Page block={block} title="Bank feed">
      <Data
        procedure={(s) => {
          s.defScalar("feed_account_id", { type: "BigInt" });
          s.defScalar("feed_entity_id", { type: "BigInt" });
          s.defScalar("feed_status", sql.lit`for_review`);
          s.defScalar("feed_rule_text", sql.lit``);
          s.defScalar("feed_rule_direction", sql.lit``);
          s.defScalar("feed_rule_auto", sql`false`);
          s.defScalar("feed_csv", sql.lit``);
          s.defScalar("feed_rule_account_id", { type: "BigInt" });
          s.defScalar("feed_rule_min", sql.lit``);
          s.defScalar("feed_rule_max", sql.lit``);
          s.defScalar("feed_start_on", { type: "Date" });
          s.defScalar("feed_flip_sign", sql`false`);
          for (const d of lineDimensions(block)) {
            s.defScalar(`feed_rule_${d.key}_id`, { type: "BigInt" });
          }
          s.defTable(
            "feed_connections",
            sql`select connection.id, connection.link_url,
                connection.link_session, connection.connection_ref,
                connection.institution,
                connection.mask, connection.last_synced_at,
                connection.last_error,
                account.number || ' ' || account.name as account
              from db.ledger_bank_connections connection
              join db.ledger_accounts account
                on account.id = connection.account_id
              where connection.disconnected_at is null
                and ${block.canViewSql(sql`current_user`)}
              order by account.number`,
          );
          s.defTable(
            "feed_rules",
            sql`select rule.id, rule.contains_text, rule.money_in,
                rule.auto_add, rule.min_amount, rule.max_amount,
                account.number || ' ' || account.name as account
              from db.ledger_bank_rules rule
              join db.ledger_accounts account on account.id = rule.account_id
              order by rule.id`,
          );
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-col gap-3">
          <Typography level="title-md">Connected accounts</Typography>
          <Each table="feed_connections" recordName="feed_connection">
            <div className="flex flex-wrap items-center gap-3">
              <Typography level="body-md" className="min-w-[220px]">
                {sql`feed_connection.account`}
              </Typography>
              <Typography level="body-sm" className="text-secondary">
                {sql`coalesce(feed_connection.institution || ' ••' ||
                  feed_connection.mask, 'Waiting for bank sign-in')
                  || coalesce(' · synced ' || format.date(
                    feed_connection.last_synced_at, '%m/%d/%Y %l:%M %p'), '')`}
              </Typography>
              <Show when={sql`feed_connection.last_error is not null`}>
                <Chip size="sm" color="danger">
                  {sql`feed_connection.last_error`}
                </Chip>
              </Show>
              <Show when={sql`feed_connection.link_session is not null`}>
                <Show when={sql`feed_connection.link_url is not null`}>
                  <a
                    href={sql`feed_connection.link_url`}
                    target="_blank"
                    className="text-primary-600 hover:underline"
                  >
                    Sign in to bank
                  </a>
                </Show>
                <ActionButton
                  size="sm"
                  variant="outlined"
                  action={manage((s) =>
                    actions.finishConnecting(s, sql`feed_connection.id`)
                  )}
                >
                  Finish connecting
                </ActionButton>
              </Show>
              <Show when={sql`feed_connection.connection_ref is not null`}>
                <ActionButton
                  size="sm"
                  variant="outlined"
                  action={manage((s) =>
                    actions.sync(s, sql`feed_connection.id`)
                  )}
                >
                  Update
                </ActionButton>
              </Show>
              <ActionButton
                size="sm"
                variant="plain"
                color="danger"
                confirm={{
                  description:
                    "Stop downloading transactions for this account? Reviewed transactions stay in the books.",
                }}
                action={manage((s) =>
                  actions.disconnect(s, sql`feed_connection.id`)
                )}
              >
                Disconnect
              </ActionButton>
            </div>
          </Each>
          <div className="flex flex-wrap items-end gap-3">
            <FormControl className="min-w-[240px]">
              <FormLabel>Connect an account</FormLabel>
              <TableRecordSelect
                tableName="ledger_accounts"
                where={sql`type in ${FEED_ACCOUNT_TYPES} and is_active`}
                value={sql`feed_account_id`}
                onSelectValue={(s, value) =>
                  s.setScalar("feed_account_id", value)}
              />
            </FormControl>
            {block.entities
              ? (
                <FormControl className="min-w-[200px]">
                  <FormLabel>Entity</FormLabel>
                  <TableRecordSelect
                    tableName="ledger_entities"
                    value={sql`feed_entity_id`}
                    onSelectValue={(s, value) =>
                      s.setScalar("feed_entity_id", value)}
                  />
                </FormControl>
              )
              : null}
            <FormControl>
              <FormLabel>Download from</FormLabel>
              <Input
                size="sm"
                type="date"
                value={sql`feed_start_on`}
                onInput={(s, value) =>
                  s.setScalar("feed_start_on", sql`try_cast(${value} as date)`)}
              />
            </FormControl>
            <ActionButton
              size="sm"
              action={manage((s) => {
                s.defScalar("feed_new_connection_id", { type: "BigInt" });
                actions.connect(s, {
                  accountId: sql`feed_account_id`,
                  entityId: block.entities ? sql`feed_entity_id` : undefined,
                  startOn: sql`feed_start_on`,
                  intoConnectionId: "feed_new_connection_id",
                });
              })}
            >
              Connect
            </ActionButton>
          </div>
        </Card>
        <Card variant="outlined" className="p-4 flex flex-col gap-3">
          <Typography level="title-md">Import a statement</Typography>
          <Typography level="body-sm" className="text-secondary">
            Paste CSV with a header row and columns Date, Description, Amount
            (money in positive). Lines already imported are skipped.
          </Typography>
          <Textarea
            minRows={4}
            value={sql`feed_csv`}
            onInput={(s) => s.setScalar("feed_csv", sql`target_value`)}
            placeholder="Date,Description,Amount"
          />
          <div className="flex flex-wrap items-end gap-3">
            <FormControl className="min-w-[240px]">
              <FormLabel>Into account</FormLabel>
              <TableRecordSelect
                tableName="ledger_accounts"
                where={sql`type in ${FEED_ACCOUNT_TYPES} and is_active`}
                value={sql`feed_account_id`}
                onSelectValue={(s, value) =>
                  s.setScalar("feed_account_id", value)}
              />
            </FormControl>
            <Checkbox
              label="Charges are positive (card statement)"
              checked={sql`feed_flip_sign`}
              onCheckboxChange={(s) =>
                s.setScalar("feed_flip_sign", sql`not feed_flip_sign`)}
            />
            <ActionButton
              size="sm"
              action={(s) => {
                manageAction(block, (s) =>
                  actions.importStatement(s, {
                    accountId: sql`feed_account_id`,
                    entityId: block.entities ? sql`feed_entity_id` : undefined,
                    csv: sql`feed_csv`,
                    flipSign: sql`feed_flip_sign`,
                  }))(s);
                actions.autoAdd(s);
              }}
              successMessage="Statement imported"
            >
              Import
            </ActionButton>
          </div>
        </Card>
        <ReviewQueue block={block} source={props.source} />
        <Card variant="outlined" className="p-4 flex flex-col gap-3">
          <Typography level="title-md">Rules</Typography>
          <Typography level="body-sm" className="text-secondary">
            Transactions whose description contains the text are suggested for
            the account; the first matching rule wins.
          </Typography>
          <Each table="feed_rules" recordName="feed_rule">
            <div className="flex items-center gap-3">
              <Typography level="body-md">
                {sql`'"' || feed_rule.contains_text || '" → '
                  || feed_rule.account
                  || case when feed_rule.money_in then ' (money in)'
                    when not feed_rule.money_in then ' (money out)' else '' end
                  || coalesce(' from ' || cast(feed_rule.min_amount as string),
                    '')
                  || coalesce(' up to ' || cast(feed_rule.max_amount as string),
                    '')
                  || case when feed_rule.auto_add then ', added automatically'
                    else '' end`}
              </Typography>
              <ActionButton
                size="sm"
                variant="plain"
                color="danger"
                action={manage((s) => {
                  s.startTransaction();
                  s.modify(sql`delete from db.ledger_bank_rules
                    where id = feed_rule.id`);
                  s.commitTransaction();
                })}
              >
                Remove
              </ActionButton>
            </div>
          </Each>
          <div className="flex flex-wrap items-end gap-3">
            <FormControl>
              <FormLabel>Description contains</FormLabel>
              <Input
                size="sm"
                value={sql`feed_rule_text`}
                onInput={(s, value) => s.setScalar("feed_rule_text", value)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Direction</FormLabel>
              <Select
                size="sm"
                value={sql`feed_rule_direction`}
                onChange={(s) =>
                  s.setScalar("feed_rule_direction", sql`target_value`)}
              >
                <Select.Option value="">Money in or out</Select.Option>
                <Select.Option value="in">Money in</Select.Option>
                <Select.Option value="out">Money out</Select.Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Amount from</FormLabel>
              <Input
                size="sm"
                className="w-[100px]"
                value={sql`feed_rule_min`}
                onInput={(s, value) => s.setScalar("feed_rule_min", value)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>up to</FormLabel>
              <Input
                size="sm"
                className="w-[100px]"
                value={sql`feed_rule_max`}
                onInput={(s, value) => s.setScalar("feed_rule_max", value)}
              />
            </FormControl>
            {lineDimensions(block).map((d) => (
              <FormControl className="min-w-[160px]">
                <FormLabel>{dimensionLabel(d)}</FormLabel>
                <TableRecordSelect
                  tableName={d.table}
                  value={sql.ref(`feed_rule_${d.key}_id`)}
                  onSelectValue={(s, value) =>
                    s.setScalar(`feed_rule_${d.key}_id`, value)}
                />
              </FormControl>
            ))}
            <Checkbox
              label="Add automatically"
              checked={sql`feed_rule_auto`}
              onCheckboxChange={(s) =>
                s.setScalar("feed_rule_auto", sql`not feed_rule_auto`)}
            />
            <FormControl className="min-w-[240px]">
              <FormLabel>Account</FormLabel>
              <TableRecordSelect
                tableName="ledger_accounts"
                where={sql`is_active`}
                value={sql`feed_rule_account_id`}
                onSelectValue={(s, value) =>
                  s.setScalar("feed_rule_account_id", value)}
              />
            </FormControl>
            <ActionButton
              size="sm"
              action={manage((s) => {
                s.throwErrorIf(
                  sql`trim(feed_rule_text) = '' or feed_rule_account_id is null`,
                  sql.lit`A rule needs text and an account`,
                );
                const amountText = (scalar: string) => {
                  const text = sql`replace(replace(trim(${
                    sql.ref(scalar)
                  }), ',', ''), '$', '')`;
                  return sql`(${text} <> '' and try_cast(${text}
                    as decimal(18, 4)) is null)`;
                };
                s.throwErrorIf(
                  sql`${amountText("feed_rule_min")}
                    or ${amountText("feed_rule_max")}`,
                  sql
                    .lit`Enter the amount bounds as numbers, or leave them empty`,
                );
                // Receivables and payables are settled through documents.
                s.throwErrorIf(
                  sql`exists (select 1 from db.ledger_accounts
                    where id = feed_rule_account_id
                      and type in ${openItemAccountTypesSql()})`,
                  sql.lit`Rules cannot add to receivable or payable accounts`,
                );
                s.startTransaction();
                const ruleDims = lineDimensions(block).map((d) => d.key);
                s.modify(sql`insert into db.ledger_bank_rules
                  (contains_text, account_id, money_in, auto_add, min_amount,
                    max_amount ${
                  ruleDims.length
                    ? sql`, ${ruleDims.map((k) => sql.ref(`${k}_id`))}`
                    : sql``
                })
                  values (trim(feed_rule_text), feed_rule_account_id,
                    case feed_rule_direction when 'in' then true
                      when 'out' then false end,
                    feed_rule_auto,
                    try_cast(replace(replace(trim(feed_rule_min), ',', ''),
                      '$', '') as decimal(18, 4)),
                    try_cast(replace(replace(trim(feed_rule_max), ',', ''),
                      '$', '') as decimal(18, 4))
                    ${
                  ruleDims.length
                    ? sql`, ${
                      ruleDims.map((k) => sql.ref(`feed_rule_${k}_id`))
                    }`
                    : sql``
                })`);
                s.commitTransaction();
              })}
            >
              Add rule
            </ActionButton>
          </div>
        </Card>
      </Data>
    </Page>
  );
}

function ReviewQueue(props: { block: LedgerBlock; source: LedgerSource }) {
  const { block } = props;
  const source = props.source;
  const actions = bankFeedActions(block, source);
  const act = (body: (s: UiServerStatements) => void) =>
    manageAction(block, body);
  return (
    <Card variant="outlined" className="p-0 overflow-x-auto">
      <div className="p-4 flex items-center gap-3">
        <Typography level="title-md">Transactions</Typography>
        <Select
          size="sm"
          value={sql`feed_status`}
          onChange={(s) => s.setScalar("feed_status", sql`target_value`)}
        >
          <Select.Option value="for_review">For review</Select.Option>
          <Select.Option value="matched">Matched</Select.Option>
          <Select.Option value="added">Added</Select.Option>
          <Select.Option value="excluded">Excluded</Select.Option>
        </Select>
        <Show when={sql`feed_status = 'for_review'`}>
          <ActionButton
            size="sm"
            variant="outlined"
            confirm={{
              description:
                "Add every transaction a rule suggests an account for, with the rule's dimensions?",
            }}
            action={act((s) => actions.addSuggested(s))}
            successMessage="Added"
          >
            Add all with a rule
          </ActionButton>
        </Show>
      </div>
      <Data
        procedure={(s) => {
          s.defTable(
            "feed_transactions",
            sql`select txn.id, txn.posted_on, txn.amount, txn.description,
                txn.counterparty, txn.account_id, txn.account,
                txn.removed_at is not null as is_removed,
                ${
              suggestedRuleSql(sql`txn`, "account_id")
            } as suggested_account_id
              from (select txn.id, txn.posted_on, txn.amount,
                  txn.description, txn.counterparty, txn.removed_at,
                  connection.account_id,
                  account.number || ' ' || account.name as account,
                  ${bankStatusSql(block, source, sql`txn`)} as status
                from db.ledger_bank_transactions txn
                join db.ledger_bank_connections connection
                  on connection.id = txn.connection_id
                join db.ledger_accounts account
                  on account.id = connection.account_id) txn
              where txn.status = feed_status
                and ${block.canViewSql(sql`current_user`)}
              order by txn.posted_on desc, txn.id desc
              limit 500`,
          );
        }}
      >
        <Table hoverRow>
          <thead>
            <tr>
              <th>Date</th>
              <th>Account</th>
              <th>Description</th>
              <th>
                <div className="text-right">Amount</div>
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            <Each table="feed_transactions" recordName="feed_txn">
              <tr>
                <td>{date(sql`feed_txn.posted_on`)}</td>
                <td>{sql`feed_txn.account`}</td>
                <td>
                  {sql`coalesce(feed_txn.counterparty || ' · ', '')
                    || coalesce(feed_txn.description, '')`}
                  <Show when={sql`feed_txn.is_removed`}>
                    <Chip size="sm" color="warning" className="ml-2">
                      Removed by bank
                    </Chip>
                  </Show>
                </td>
                <td className="text-right tabular-nums">
                  {block.formatAmountSql(sql`feed_txn.amount`)}
                </td>
                <td>
                  <Show
                    when={sql`feed_status = 'for_review'`}
                    fallback={
                      <ActionButton
                        size="sm"
                        variant="plain"
                        action={act((s) => actions.undo(s, sql`feed_txn.id`))}
                      >
                        Undo
                      </ActionButton>
                    }
                  >
                    <ReviewActions block={block} source={source} act={act} />
                  </Show>
                </td>
              </tr>
            </Each>
          </tbody>
        </Table>
      </Data>
    </Card>
  );
}

function ReviewActions(props: {
  block: LedgerBlock;
  source: LedgerSource;
  act: (
    body: (s: UiServerStatements) => void,
  ) => (s: UiServerStatements) => void;
}) {
  const { block, act } = props;
  const actions = bankFeedActions(block, props.source);
  const dims = lineDimensions(block);
  const splitRow = sql`feed_split_row`;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("feed_add_account_id", {
          type: "BigInt",
          expr: sql`feed_txn.suggested_account_id`,
        });
        for (const d of dims) {
          s.defScalar(`feed_add_${d.key}_id`, {
            type: "BigInt",
            expr: suggestedRuleSql(sql`feed_txn`, `${d.key}_id`),
          });
        }
        s.defScalar("feed_split_open", sql`false`);
        s.defTable("feed_split_rows", {
          fields: [
            { name: "row_id", type: "BigInt" },
            { name: "account_id", type: "BigInt" },
            { name: "amount_text", type: { type: "String", maxLength: 40 } },
            { name: "memo", type: { type: "String", maxLength: 500 } },
            ...dims.map((d) => ({
              name: `${d.key}_id`,
              type: "BigInt" as const,
            })),
          ],
        });
        // Several possible matches were left for the user to pick.
        s.defTable(
          "feed_candidates",
          sql`select candidate.id, candidate.posting_date,
              coalesce(candidate.document_number, candidate.description, '')
                as label
            from (${candidateLinesSql(block, sql`feed_txn`)}) candidate
            order by candidate.posting_date limit 3`,
        );
      }}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Each table="feed_candidates" recordName="feed_candidate">
          <ActionButton
            size="sm"
            variant="soft"
            action={act((s) =>
              actions.match(s, sql`feed_txn.id`, sql`feed_candidate.id`)
            )}
          >
            {sql`'Match ' || format.date(feed_candidate.posting_date, '%m/%d')
              || ' ' || feed_candidate.label`}
          </ActionButton>
        </Each>
        <div className="min-w-[200px]">
          <TableRecordSelect
            tableName="ledger_accounts"
            where={sql`is_active`}
            value={sql`feed_add_account_id`}
            onSelectValue={(s, value) =>
              s.setScalar("feed_add_account_id", value)}
          />
        </div>
        {dims.map((d) => (
          <div className="min-w-[160px]">
            <TableRecordSelect
              tableName={d.table}
              placeholder={dimensionLabel(d)}
              value={sql.ref(`feed_add_${d.key}_id`)}
              onSelectValue={(s, value) =>
                s.setScalar(`feed_add_${d.key}_id`, value)}
            />
          </div>
        ))}
        <ActionButton
          size="sm"
          action={act((s) =>
            actions.add(
              s,
              sql`feed_txn.id`,
              sql`feed_add_account_id`,
              Object.fromEntries(
                dims.map((d) => [d.key, sql.ref(`feed_add_${d.key}_id`)]),
              ),
            )
          )}
        >
          Add
        </ActionButton>
        <Button
          size="sm"
          variant="plain"
          onClick={(s) => {
            s.modify(sql`delete from feed_split_rows`);
            s.modify(sql`insert into feed_split_rows
              (row_id, account_id, amount_text ${
              dims.length
                ? sql`, ${dims.map((d) => sql.ref(`${d.key}_id`))}`
                : sql``
            })
              values (1, feed_add_account_id,
                cast(feed_txn.amount as string) ${
              dims.length
                ? sql`, ${dims.map((d) => sql.ref(`feed_add_${d.key}_id`))}`
                : sql``
            }), (2, null, '' ${
              dims.length ? sql`, ${dims.map(() => sql`null`)}` : sql``
            })`);
            s.setScalar("feed_split_open", sql`not feed_split_open`);
          }}
        >
          Split
        </Button>
        <ActionButton
          size="sm"
          variant="plain"
          action={act((s) => actions.exclude(s, sql`feed_txn.id`))}
        >
          Exclude
        </ActionButton>
        <Show when={sql`feed_txn.suggested_account_id is not null`}>
          <Chip size="sm" variant="soft">Rule</Chip>
        </Show>
      </div>
      <Show when={sql`feed_split_open`}>
        <div className="flex flex-col gap-2 pt-2">
          <Each table="feed_split_rows" recordName="feed_split_row">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="min-w-[200px]">
                <TableRecordSelect
                  tableName="ledger_accounts"
                  where={sql`is_active`}
                  value={sql`${splitRow}.account_id`}
                  onSelectValue={(s, value) =>
                    s.modify(sql`update feed_split_rows
                      set account_id = ${value}
                      where row_id = ${splitRow}.row_id`)}
                />
              </div>
              {dims.map((d) => (
                <div className="min-w-[160px]">
                  <TableRecordSelect
                    tableName={d.table}
                    placeholder={dimensionLabel(d)}
                    value={sql`${splitRow}.${sql.ref(`${d.key}_id`)}`}
                    onSelectValue={(s, value) =>
                      s.modify(sql`update feed_split_rows
                        set ${sql.ref(`${d.key}_id`)} = ${value}
                        where row_id = ${splitRow}.row_id`)}
                  />
                </div>
              ))}
              <Input
                size="sm"
                aria-label="Split memo"
                placeholder="Memo"
                value={sql`coalesce(${splitRow}.memo, '')`}
                onInput={(s, value) =>
                  s.modify(sql`update feed_split_rows set memo = ${value}
                    where row_id = ${splitRow}.row_id`)}
              />
              <Input
                size="sm"
                aria-label="Split amount"
                className="w-[120px]"
                value={sql`${splitRow}.amount_text`}
                onInput={(s, value) =>
                  s.modify(sql`update feed_split_rows set amount_text = ${value}
                    where row_id = ${splitRow}.row_id`)}
              />
            </div>
          </Each>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="plain"
              onClick={(s) =>
                s.modify(sql`insert into feed_split_rows (row_id, amount_text)
                  select coalesce(max(row_id), 0) + 1, ''
                  from feed_split_rows`)}
            >
              Add line
            </Button>
            <ActionButton
              size="sm"
              action={act((s) => {
                const splits = "feed_split_post";
                s.defTable(splits, { fields: bankSplitFields(block) });
                s.modify(sql`insert into feed_split_post
                  (account_id, amount, memo ${
                  dims.length
                    ? sql`, ${dims.map((d) => sql.ref(`${d.key}_id`))}`
                    : sql``
                })
                  select account_id, try_cast(replace(amount_text, ',', '')
                    as decimal(18, 4)), nullif(memo, '') ${
                  dims.length
                    ? sql`, ${dims.map((d) => sql.ref(`${d.key}_id`))}`
                    : sql``
                }
                  from feed_split_rows
                  where account_id is not null or trim(amount_text) <> ''`);
                actions.addSplit(s, sql`feed_txn.id`, splits);
              })}
            >
              Add split
            </ActionButton>
          </div>
        </div>
      </Show>
    </Data>
  );
}
