import { Card } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
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
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";
import {
  accountTypesSql,
  AMOUNT_TYPE,
  formatDateSql as date,
  LedgerPage as Page,
  manageAction,
  recordLabelSql,
  STATEMENT_ACCOUNT_TYPES,
} from "blocks/ledger";
import type { LedgerBlock } from "blocks/ledger";

/** Accounts reconciled against an outside statement. */
const STATEMENT_TYPES = accountTypesSql(STATEMENT_ACCOUNT_TYPES);

/**
 * Bank and card reconciliation: a statement per account with its ending
 * balance, and the lines cleared against it. A statement completes only when
 * the cleared balance equals the statement balance.
 */
export function defineReconciliation(
  block: LedgerBlock,
  withFeeds: boolean,
) {
  const { db } = system;
  db.table("ledger_reconciliations", (table) => {
    table.displayName("Reconciliations");
    table.fk("account_id", "ledger_accounts").notNull().onDelete("Restrict");
    table.date("statement_date").notNull();
    table.money("statement_balance", AMOUNT_TYPE).notNull();
    table.timestampUtc("completed_at");
    table.fk("completed_by", "sys_users").onDelete("Restrict");
    table.skipAutoApi();
  });
  db.table("ledger_reconciliation_lines", (table) => {
    table.displayName("Reconciled lines");
    table.fk("reconciliation_id", "ledger_reconciliations").notNull()
      .onDelete("Cascade");
    table.fk("line_id", "ledger_lines").notNull().onDelete("Restrict").unique();
    table.skipAutoApi();
  });

  system.storedProcedure({
    name: "ledger_start_reconciliation",
    transaction: "caller",
    inputScalars: [
      { name: "p_account_id", type: "BigInt" },
      { name: "p_statement_date", type: "Date" },
      { name: "p_statement_balance", type: AMOUNT_TYPE },
    ],
    outputScalars: [{ name: "reconciliation_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorIf(
        sql`p_account_id is null or p_statement_date is null
          or p_statement_balance is null`,
        sql.lit`Choose an account, statement date, and ending balance`,
      );
      s.throwErrorIf(
        sql`not exists (select 1 from db.ledger_accounts
          where id = p_account_id
            and type in ${STATEMENT_TYPES})`,
        sql.lit`Only bank and credit card accounts can be reconciled`,
      );
      s.throwErrorIf(
        sql`exists (select 1 from db.ledger_reconciliations
          where account_id = p_account_id and completed_at is null)`,
        sql.lit`Finish or delete the reconciliation in progress first`,
      );
      s.throwErrorIf(
        sql`p_statement_date <= (select max(statement_date)
          from db.ledger_reconciliations where account_id = p_account_id)`,
        sql.lit`Statements must be reconciled in date order`,
      );
      s.defScalar("new_reconciliation_id", { type: "BigInt" });
      s.modify(sql`insert into db.ledger_reconciliations
        (account_id, statement_date, statement_balance)
        values (p_account_id, p_statement_date, p_statement_balance)
        returning id into new_reconciliation_id`);
      if (withFeeds) {
        // Lines the bank feed already matched are on the statement.
        s.modify(sql`insert into db.ledger_reconciliation_lines
          (reconciliation_id, line_id)
          select distinct new_reconciliation_id, line.id
          from db.ledger_bank_transactions txn
          join db.ledger_lines line on line.id = txn.line_id
          join db.ledger_entries entry on entry.id = line.entry_id
          where line.account_id = p_account_id
            and line.posting_date <= p_statement_date
            and txn.posted_on <= p_statement_date
            and txn.excluded is not true
            and txn.removed_at is null
            and ${block.isActiveEntrySql(sql`entry`)}
            and line.id not in (select line_id
              from db.ledger_reconciliation_lines)`);
      }
      s.setScalar("reconciliation_id", sql`new_reconciliation_id`);
    },
  });

  system.storedProcedure({
    name: "ledger_toggle_reconciled_line",
    transaction: "caller",
    inputScalars: [
      { name: "p_reconciliation_id", type: "BigInt" },
      { name: "p_line_id", type: "BigInt" },
    ],
    procedure: (s) => {
      s.defRecord(
        "reconciliation",
        sql`select id, account_id, statement_date, completed_at
          from db.ledger_reconciliations where id = p_reconciliation_id`,
      );
      s.throwErrorIf(
        sql`reconciliation.id is null or reconciliation.completed_at is not null`,
        sql.lit`This reconciliation is not in progress`,
      );
      s.if(
        sql`exists (select 1 from db.ledger_reconciliation_lines
          where reconciliation_id = p_reconciliation_id
            and line_id = p_line_id)`,
        (s) => {
          s.modify(sql`delete from db.ledger_reconciliation_lines
            where reconciliation_id = p_reconciliation_id
              and line_id = p_line_id`);
        },
        (s) => {
          s.throwErrorIf(
            sql`not exists (select 1 from db.ledger_lines
              where id = p_line_id and account_id = reconciliation.account_id
                and posting_date <= reconciliation.statement_date
                ${block.books.length ? sql`and book is null` : sql``})`,
            sql
              .lit`Only lines on this account up to the statement date can be cleared`,
          );
          s.modify(sql`insert into db.ledger_reconciliation_lines
            (reconciliation_id, line_id)
            values (p_reconciliation_id, p_line_id)`);
        },
      );
    },
  });

  // Clears every uncleared line through the statement date, e.g. for the
  // first statement after migrating years of history.
  system.storedProcedure({
    name: "ledger_clear_all_reconciled_lines",
    transaction: "caller",
    inputScalars: [{ name: "p_reconciliation_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "reconciliation",
        sql`select id, account_id, statement_date, completed_at
          from db.ledger_reconciliations where id = p_reconciliation_id`,
      );
      s.throwErrorIf(
        sql`reconciliation.id is null or reconciliation.completed_at is not null`,
        sql.lit`This reconciliation is not in progress`,
      );
      s.modify(sql`insert into db.ledger_reconciliation_lines
        (reconciliation_id, line_id)
        select p_reconciliation_id, line.id from db.ledger_lines line
        where line.account_id = reconciliation.account_id
          and line.posting_date <= reconciliation.statement_date
          ${block.books.length ? sql`and line.book is null` : sql``}
          and not exists (select 1 from db.ledger_reconciliation_lines cleared
            where cleared.line_id = line.id)`);
    },
  });

  system.storedProcedure({
    name: "ledger_complete_reconciliation",
    transaction: "caller",
    inputScalars: [{ name: "p_reconciliation_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorIf(
        sql`not exists (select 1 from db.ledger_reconciliations
          where id = p_reconciliation_id and completed_at is null)`,
        sql.lit`This reconciliation is not in progress`,
      );
      s.throwErrorIf(
        sql`${reconciliationDifferenceSql(sql`p_reconciliation_id`)} <> 0`,
        sql`'The cleared balance differs from the statement by ' || ${
          block.formatAmountSql(
            reconciliationDifferenceSql(sql`p_reconciliation_id`),
          )
        }`,
      );
      s.modify(sql`update db.ledger_reconciliations
        set completed_at = now(), completed_by = current_user
        where id = p_reconciliation_id`);
    },
  });

  system.storedProcedure({
    name: "ledger_undo_reconciliation",
    transaction: "caller",
    inputScalars: [{ name: "p_reconciliation_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorIf(
        sql`exists (select 1 from db.ledger_reconciliations later
          join db.ledger_reconciliations this_one
            on this_one.id = p_reconciliation_id
          where later.account_id = this_one.account_id
            and later.statement_date > this_one.statement_date)`,
        sql.lit`Only the latest reconciliation of an account can be undone`,
      );
      s.throwErrorIf(
        sql`(select statement_date from db.ledger_reconciliations
          where id = p_reconciliation_id)
          <> ${
          block.openDateSql(
            sql`(select statement_date from db.ledger_reconciliations
              where id = p_reconciliation_id)`,
            sql`(select line.* from db.ledger_reconciliation_lines cleared
              join db.ledger_lines line on line.id = cleared.line_id
              where cleared.reconciliation_id = p_reconciliation_id)`,
          )
        }`,
        sql
          .lit`Reopen the books before undoing a reconciliation in a closed period`,
      );
      s.modify(sql`update db.ledger_reconciliations
        set completed_at = null, completed_by = null
        where id = p_reconciliation_id`);
    },
  });

  system.storedProcedure({
    name: "ledger_delete_reconciliation",
    transaction: "caller",
    inputScalars: [{ name: "p_reconciliation_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorIf(
        sql`exists (select 1 from db.ledger_reconciliations
          where id = p_reconciliation_id and completed_at is not null)`,
        sql.lit`Undo a completed reconciliation before deleting it`,
      );
      s.modify(sql`delete from db.ledger_reconciliations
        where id = p_reconciliation_id`);
    },
  });
}

/**
 * 1 for asset accounts, -1 for liabilities, so statement and cleared
 * balances read the way the bank or card issuer prints them (a card owing
 * $500 has a statement balance of 500).
 */
function normalSignSql(accountId: Sql): Sql {
  return sql`(select case when account_class = 'liability' then -1 else 1 end
    from db.ledger_accounts where id = ${accountId})`;
}

/**
 * Cleared balance, in the account's normal sign, of lines cleared in
 * completed statements before `statementDate`.
 */
function openingClearedSql(accountId: Sql, statementDate: Sql): Sql {
  return sql`${normalSignSql(accountId)} * coalesce((select sum(line.amount)
    from db.ledger_reconciliation_lines cleared
    join db.ledger_reconciliations earlier
      on earlier.id = cleared.reconciliation_id
    join db.ledger_lines line on line.id = cleared.line_id
    where earlier.account_id = ${accountId}
      and earlier.completed_at is not null
      and earlier.statement_date < ${statementDate}), 0)`;
}

/**
 * Statement balance minus cleared balance, both in the account's normal
 * sign; zero when reconciled.
 */
export function reconciliationDifferenceSql(reconciliationId: Sql): Sql {
  return sql`(select reconciliation.statement_balance
      - ${
    openingClearedSql(
      sql`reconciliation.account_id`,
      sql`reconciliation.statement_date`,
    )
  }
      - ${normalSignSql(sql`reconciliation.account_id`)}
        * coalesce((select sum(line.amount)
        from db.ledger_reconciliation_lines cleared
        join db.ledger_lines line on line.id = cleared.line_id
        where cleared.reconciliation_id = reconciliation.id), 0)
    from db.ledger_reconciliations reconciliation
    where reconciliation.id = ${reconciliationId})`;
}

function call<T extends IServerBaseStatements>(
  s: T,
  name: string,
  inputScalars: Record<string, Sql>,
) {
  s.callStoredProcedure(name, { inputScalars });
}

export const reconciliationActions = {
  start<T extends IServerBaseStatements>(
    s: T,
    opts: {
      accountId: Sql;
      statementDate: Sql;
      statementBalance: Sql;
      intoReconciliationId: string;
    },
  ) {
    s.callStoredProcedure("ledger_start_reconciliation", {
      inputScalars: {
        p_account_id: opts.accountId,
        p_statement_date: opts.statementDate,
        p_statement_balance: opts.statementBalance,
      },
      outputScalars: { reconciliation_id: opts.intoReconciliationId },
    });
  },
  toggleLine<T extends IServerBaseStatements>(
    s: T,
    reconciliationId: Sql,
    lineId: Sql,
  ) {
    call(s, "ledger_toggle_reconciled_line", {
      p_reconciliation_id: reconciliationId,
      p_line_id: lineId,
    });
  },
  clearAll<T extends IServerBaseStatements>(s: T, reconciliationId: Sql) {
    call(s, "ledger_clear_all_reconciled_lines", {
      p_reconciliation_id: reconciliationId,
    });
  },
  complete<T extends IServerBaseStatements>(s: T, reconciliationId: Sql) {
    call(s, "ledger_complete_reconciliation", {
      p_reconciliation_id: reconciliationId,
    });
  },
  undo<T extends IServerBaseStatements>(s: T, reconciliationId: Sql) {
    call(s, "ledger_undo_reconciliation", {
      p_reconciliation_id: reconciliationId,
    });
  },
  /** Deletes a reconciliation in progress with its cleared lines. */
  delete<T extends IServerBaseStatements>(s: T, reconciliationId: Sql) {
    call(s, "ledger_delete_reconciliation", {
      p_reconciliation_id: reconciliationId,
    });
  },
};

interface PageProps {
  block: LedgerBlock;
  base: string;
}

/** Reconcilable accounts with their last reconciled statement. */
export function ReconcileAccountsPage(props: PageProps) {
  const { block, base } = props;
  return (
    <Page block={block} title="Reconcile">
      <Data
        procedure={(s) => {
          s.defScalar("new_rec_account_id", { type: "BigInt" });
          s.defScalar("new_rec_date", {
            type: "Date",
            expr:
              sql`date.subtract(day, 1, date.start_of_month(current_date()))`,
          });
          s.defScalar("new_rec_balance", sql.lit``);
          s.defTable(
            "reconcile_accounts",
            sql`select account.id, account.number, account.name,
                (select max(statement_date) from db.ledger_reconciliations
                  where account_id = account.id and completed_at is not null)
                  as last_reconciled,
                (select id from db.ledger_reconciliations
                  where account_id = account.id and completed_at is null)
                  as in_progress_id
              from db.ledger_accounts account
              where account.type in ${STATEMENT_TYPES}
                and account.is_active
              order by account.number`,
          );
        }}
      >
        <Card variant="outlined" className="p-4 flex flex-col gap-3">
          <Typography level="title-md">Start a reconciliation</Typography>
          <div className="flex flex-wrap items-end gap-3">
            <FormControl className="min-w-[240px]">
              <FormLabel>Account</FormLabel>
              <TableRecordSelect
                tableName="ledger_accounts"
                where={sql`type in ${STATEMENT_TYPES}`}
                value={sql`new_rec_account_id`}
                onSelectValue={(s, value) =>
                  s.setScalar("new_rec_account_id", value)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Statement date</FormLabel>
              <Input
                size="sm"
                type="date"
                value={sql`new_rec_date`}
                onInput={(s, value) =>
                  s.setScalar("new_rec_date", sql`try_cast(${value} as date)`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Ending balance</FormLabel>
              <Input
                size="sm"
                value={sql`new_rec_balance`}
                onInput={(s, value) => s.setScalar("new_rec_balance", value)}
              />
            </FormControl>
            <ActionButton
              size="sm"
              action={(s) => {
                s.defScalar("started_reconciliation_id", { type: "BigInt" });
                manageAction(block, (s) =>
                  reconciliationActions.start(s, {
                    accountId: sql`new_rec_account_id`,
                    statementDate: sql`new_rec_date`,
                    statementBalance:
                      sql`try_cast(replace(new_rec_balance, ',', '') as decimal(18, 4))`,
                    intoReconciliationId: "started_reconciliation_id",
                  }))(s);
                s.navigate(
                  sql`${
                    sql.lit(`${base}/reconcile/`)
                  } || started_reconciliation_id`,
                );
              }}
            >
              Start
            </ActionButton>
          </div>
        </Card>
        <Card variant="outlined" className="p-0 overflow-x-auto">
          <Table hoverRow>
            <thead>
              <tr>
                <th>Account</th>
                <th>Last reconciled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <Each table="reconcile_accounts" recordName="reconcile_account">
                <tr>
                  <td>
                    {sql`reconcile_account.number || ' '
                      || reconcile_account.name`}
                  </td>
                  <td>
                    {sql`coalesce(format.date(reconcile_account.last_reconciled,
                      '%m/%d/%Y'), 'Never')`}
                  </td>
                  <td className="text-right">
                    <Show
                      when={sql`reconcile_account.in_progress_id is not null`}
                    >
                      <a
                        href={sql`${sql.lit(`${base}/reconcile/`)}
                          || reconcile_account.in_progress_id`}
                        className="text-primary-600 hover:underline"
                      >
                        Resume
                      </a>
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </Data>
    </Page>
  );
}

/** One statement: clear lines until the difference is zero, then finish. */
export function ReconciliationPage(props: PageProps) {
  const { block, base } = props;
  const money = (expr: Sql) => block.formatAmountSql(expr);
  const id = sql`ledger_reconciliation_id`;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "reconciliation",
          sql`select reconciliation.id, reconciliation.account_id,
              reconciliation.statement_date, reconciliation.statement_balance,
              reconciliation.completed_at,
              account.number || ' ' || account.name as account,
              ${
            recordLabelSql("sys_users", sql`reconciliation.completed_by`)
          } as completed_by_label,
              ${
            openingClearedSql(
              sql`reconciliation.account_id`,
              sql`reconciliation.statement_date`,
            )
          } as opening_cleared,
              ${reconciliationDifferenceSql(id)} as difference
            from db.ledger_reconciliations reconciliation
            join db.ledger_accounts account
              on account.id = reconciliation.account_id
            where reconciliation.id = ${id}
              and ${block.canViewSql(sql`current_user`)}`,
        );
        s.defTable(
          "reconcile_lines",
          sql`select line.id, line.posting_date, line.amount, line.memo,
              entry.description, entry.document_number,
              cleared.reconciliation_id is not null as is_cleared
            from db.ledger_lines line
            join db.ledger_entries entry on entry.id = line.entry_id
            left join db.ledger_reconciliation_lines cleared
              on cleared.line_id = line.id
            where line.account_id = reconciliation.account_id
              and line.posting_date <= reconciliation.statement_date
              ${block.books.length ? sql`and line.book is null` : sql``}
              and (cleared.reconciliation_id is null
                or cleared.reconciliation_id = reconciliation.id)
            order by line.posting_date, line.id
            limit 2000`,
        );
      }}
    >
      <Page
        block={block}
        title={sql`'Reconcile ' || reconciliation.account`}
      >
        <>
          <Card variant="outlined" className="p-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Statement date">
              {date(sql`reconciliation.statement_date`)}
            </Stat>
            <Stat label="Statement balance">
              {money(sql`reconciliation.statement_balance`)}
            </Stat>
            <Stat label="Beginning balance">
              {money(sql`reconciliation.opening_cleared`)}
            </Stat>
            <Stat label="Difference">
              {money(sql`reconciliation.difference`)}
            </Stat>
          </Card>
          <div className="flex flex-wrap items-center gap-2">
            <Show
              when={sql`reconciliation.completed_at is null`}
              fallback={
                <>
                  <Chip color="success">
                    {sql`'Reconciled ' || format.date(
                        reconciliation.completed_at, '%m/%d/%Y')
                        || coalesce(' by ' || reconciliation.completed_by_label, '')`}
                  </Chip>
                  <ActionButton
                    size="sm"
                    variant="outlined"
                    color="warning"
                    confirm={{
                      description:
                        "Undoing reopens this statement so its cleared lines can change.",
                    }}
                    action={manageAction(
                      block,
                      (s) => reconciliationActions.undo(s, id),
                    )}
                  >
                    Undo reconciliation
                  </ActionButton>
                </>
              }
            >
              <ActionButton
                size="sm"
                variant="outlined"
                action={manageAction(
                  block,
                  (s) => reconciliationActions.clearAll(s, id),
                )}
              >
                Clear all through statement date
              </ActionButton>
              <ActionButton
                size="sm"
                action={manageAction(
                  block,
                  (s) => reconciliationActions.complete(s, id),
                )}
                successMessage="Account reconciled"
              >
                Finish reconciliation
              </ActionButton>
              <ActionButton
                size="sm"
                variant="outlined"
                color="danger"
                confirm={{ description: "Delete this reconciliation?" }}
                action={(s) => {
                  manageAction(
                    block,
                    (s) => reconciliationActions.delete(s, id),
                  )(s);
                  s.navigate(sql.lit(`${base}/reconcile`));
                }}
              >
                Delete
              </ActionButton>
            </Show>
          </div>
          <Card variant="outlined" className="p-0 overflow-x-auto">
            <Table hoverRow>
              <thead>
                <tr>
                  <th>Cleared</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>
                    <div className="text-right">Amount</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <Each table="reconcile_lines" recordName="reconcile_line">
                  <tr>
                    <td>
                      <Show
                        when={sql`reconciliation.completed_at is null`}
                        fallback={
                          <Show when={sql`reconcile_line.is_cleared`}>
                            <Chip size="sm" color="success">Cleared</Chip>
                          </Show>
                        }
                      >
                        <Checkbox
                          size="sm"
                          checked={sql`reconcile_line.is_cleared`}
                          onCheckboxChange={(s) => {
                            s.tryServer({
                              body: (s) => {
                                manageAction(block, (s) =>
                                  reconciliationActions.toggleLine(
                                    s,
                                    id,
                                    sql`reconcile_line.id`,
                                  ))(s);
                                s.refetch();
                              },
                            });
                          }}
                        />
                      </Show>
                    </td>
                    <td>
                      {date(sql`reconcile_line.posting_date`)}
                    </td>
                    <td>
                      {sql`coalesce(reconcile_line.document_number || ' · ', '')
                          || coalesce(reconcile_line.memo,
                            reconcile_line.description, '')`}
                    </td>
                    <td className="text-right tabular-nums">
                      {money(sql`reconcile_line.amount`)}
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </>
      </Page>
    </Data>
  );
}

function Stat(props: { label: string; children: Node }) {
  return (
    <div>
      <Typography level="body-sm" className="text-secondary">
        {props.label}
      </Typography>
      <Typography level="title-md">{props.children}</Typography>
    </div>
  );
}
