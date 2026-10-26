import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type { LedgerBlock, LedgerSource } from "blocks/ledger";
import { system } from "std/system";
import type { LedgerPayoutAccounts } from "./index.tsx";

/** Records each payout sync, so failures and the next start are visible. */
export function definePayoutRuns() {
  system.db.table("ledger_payout_runs", (table) => {
    table.displayName("Payout syncs");
    table.timestampUtc("ran_at").notNull().default(sql`now()`);
    table.date("since").notNull();
    table.int("posted_count").notNull().default(sql`0`);
    table.string("error", 500);
    table.insertOnly();
    table.skipAutoApi();
  });
}

/** Pages fetched per sync at most, so a misbehaving provider cannot loop. */
const MAX_PAGES = 100;

/**
 * `payments.list_payouts`: posts each
 * payout arriving on or after `since` once, keyed by the payout id in the
 * entry's document number (a reversed payout is not posted again). Net goes
 * to the deposit account, fees to the fee account, and gross out of the
 * clearing account, where the consumer posts processor payments. Each
 * payout posts in its own transaction, which re-checks that it is new;
 * failures are reported after the rest post.
 */
export function syncPayouts<T extends IServerBaseStatements>(
  s: T,
  block: LedgerBlock,
  source: LedgerSource,
  accounts: Required<Omit<LedgerPayoutAccounts, "startOn">>,
  since: Sql,
) {
  const name = (stem: string) => block.uniqueName(stem);
  const [page, error, cursor, pages, failed, failure] = [
    name("payouts_page"),
    name("payouts_error"),
    name("payouts_cursor"),
    name("payouts_pages"),
    name("payouts_failed"),
    name("payouts_failure"),
  ];
  const ref = sql.ref;
  s.defScalar(cursor, { type: { type: "String", maxLength: 200 } });
  s.defScalar(pages, sql`0`);
  s.defScalar(failed, sql`0`);
  s.defScalar(failure, { type: { type: "String", maxLength: 500 } });
  s.defScalar(page, { type: "Json" });
  s.defScalar(error, { type: "Json" });
  const posted = name("payouts_posted");
  s.defScalar(posted, sql`0`);
  s.while(sql`${ref(pages)} < ${MAX_PAGES}`, (s) => {
    s.serviceRequest({
      serviceType: sql.lit`payments`,
      operation: sql.lit`list_payouts`,
      optIn: true,
      requestJson: sql`json_build_object('since', ${since},
        'startingAfter', ${ref(cursor)})`,
      setResultJsonScalar: page,
      setErrorJsonScalar: error,
      // One payout on the first page, then none.
      mockProcedure: (s) => {
        s.getRequestBodyJson("payouts_request");
        s.return(sql`case when payouts_request->>'startingAfter' is null
          then json_build_object('payouts', json_build_array(
            json_build_object('id', 'po_mock_1',
              'arrivalDate', date.subtract(day, 1, current_date()),
              'gross', 1000, 'fee', 29.30, 'net', 970.70)),
            'hasMore', true)
          else json_build_object('payouts', json_build_array(),
            'hasMore', false) end`);
      },
    });
    s.if(sql`${ref(error)} is not null`, (s) => {
      s.setScalar(failed, sql`${ref(failed)} + 1`);
      s.setScalar(
        failure,
        sql`'the payments service: ' || coalesce(${
          ref(error)
        }->>'message', 'unknown error')`,
      );
      s.setScalar(page, sql`json_build_object('payouts', json_build_array())`);
    });
    s.forEachQuery(
      sql`select item.value->>'id' as external_id,
          cast(item.value->>'arrivalDate' as date) as arrival_date,
          cast(item.value->>'gross' as decimal(18, 4)) as gross,
          cast(item.value->>'fee' as decimal(18, 4)) as fee,
          cast(item.value->>'net' as decimal(18, 4)) as net
        from json.array_each(${ref(page)}->'payouts') item
        order by item.index`,
      "payout",
      (s) => {
        s.try({
          body: (s) => {
            s.throwErrorIf(
              sql`payout.net <> payout.gross - payout.fee`,
              sql`'Payout ' || payout.external_id
                || ' net does not equal gross less fees'`,
            );
            s.startTransaction();
            // Checked inside the transaction so a payout repeated in a page
            // or a concurrent sync cannot post twice.
            s.if(
              sql`not exists (select 1 from db.ledger_entries entry
              where entry.source = ${source.enumLiteral()}
                and entry.document_number = payout.external_id)`,
              (s) => {
                s.setScalar(posted, sql`${ref(posted)} + 1`);
                source.post(s, {
                  date: sql`payout.arrival_date`,
                  documentNumber: sql`payout.external_id`,
                  description: sql`'Payout ' || payout.external_id`,
                  lines: [
                    {
                      account: block.account(accounts.depositAccount),
                      amount: sql`payout.net`,
                    },
                    {
                      account: block.account(accounts.feeAccount),
                      amount: sql`payout.fee`,
                    },
                    {
                      account: block.account(accounts.clearingAccount),
                      amount: sql`-payout.gross`,
                    },
                  ],
                });
              },
            );
            s.commitTransaction();
          },
          errorName: "payout_error",
          catch: (s) => {
            s.rollbackIfInTransaction();
            s.setScalar(failed, sql`${ref(failed)} + 1`);
            s.setScalar(
              failure,
              sql`coalesce(${ref(failure)}, payout.external_id || ': '
                || coalesce(payout_error.message,
                  'could not post (are the books closed for its date?)'))`,
            );
          },
        });
      },
    );
    s.setScalar(pages, sql`${ref(pages)} + 1`);
    // Stop when the provider has no more pages or returned none.
    s.setScalar(
      cursor,
      sql`case when coalesce(cast(${ref(page)}->>'hasMore' as bool), false)
        then (select item.value->>'id'
          from json.array_each(${ref(page)}->'payouts') item
          where item.index = (select max(last_item.index)
            from json.array_each(${ref(page)}->'payouts') last_item)) end`,
    );
    s.if(
      sql`${ref(cursor)} is null`,
      (s) => s.setScalar(pages, sql`${MAX_PAGES}`),
    );
  });
  s.startTransaction();
  s.modify(sql`insert into db.ledger_payout_runs (since, posted_count, error)
    values (${since}, ${ref(posted)}, case when ${ref(failed)} > 0
      then substring(${ref(failed)} || ' failed; first: ' || ${
    ref(failure)
  }, 1, 500) end)`);
  s.commitTransaction();
  s.throwErrorIf(
    sql`${ref(failed)} > 0`,
    sql`${ref(failed)} || ' payout(s) could not post; first: ' || ${
      ref(failure)
    }`,
  );
}
