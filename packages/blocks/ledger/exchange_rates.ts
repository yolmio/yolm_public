import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import type { LedgerBlock } from "./index.tsx";

/** Dev and test rates: functional-currency units per foreign unit. */
const MOCK_RATES: Record<string, number> = {
  EUR: 1.1,
  GBP: 1.27,
  CAD: 0.74,
  AUD: 0.66,
  JPY: 0.0068,
  MXN: 0.058,
};

/**
 * `fx_rates.get_rates`: `date`'s rates for
 * `currencies` (a JSON array of ISO codes) into `ledger_exchange_rates`,
 * replacing that date's rates. Runs outside a transaction; opens its own.
 */
export function syncExchangeRates<T extends IServerBaseStatements>(
  s: T,
  block: LedgerBlock,
  opts: { date: Sql; currencies: Sql },
) {
  const dateName = block.uniqueName("fx_rates_date");
  const date = sql.ref(dateName);
  const result = block.uniqueName("fx_rates_result");
  const error = block.uniqueName("fx_rates_error");
  s.defScalar(dateName, { type: "Date", expr: opts.date });
  s.serviceRequest({
    serviceType: sql.lit`fx_rates`,
    operation: sql.lit`get_rates`,
    optIn: true,
    requestJson: sql`json_build_object(
      'base', ${sql.lit(block.functionalCurrency)}, 'date', ${date},
      'currencies', ${opts.currencies})`,
    defResultJsonScalar: result,
    defErrorJsonScalar: error,
    mockProcedure: (s) => {
      s.getRequestBodyJson("fx_request");
      const code = sql`json_build_array(requested.value)->>0`;
      s.return(sql`json_build_object('rates', coalesce((
        select json_agg(json_build_object('currency', ${code},
          'rate', case ${code} ${
        Object.entries(MOCK_RATES).map(([currency, rate]) =>
          sql`when ${sql.lit(currency)} then ${rate}`
        ).reduce((a, b) => sql`${a} ${b}`)
      } else 1 end))
        from json.array_each(fx_request->'currencies') requested
      ), json_build_array()))`);
    },
  });
  s.throwErrorIf(
    sql`${sql.ref(error)} is not null`,
    sql`'Exchange rates failed: ' || coalesce(${
      sql.ref(error)
    }->>'message', 'unknown error')`,
  );
  // Usable rates only, one per currency; others keep their stored rate.
  const rates = sql`select currency, max(rate) as rate from (
      select rate.value->>'currency' as currency,
        try_cast(rate.value->>'rate' as decimal(18, 8)) as rate
      from json.array_each(${sql.ref(result)}->'rates') rate
    ) fetched
    where currency is not null and rate > 0
    group by currency`;
  s.startTransaction();
  s.modify(sql`delete from db.ledger_exchange_rates
    where rate_date = ${date}
      and currency in (select currency from (${rates}) fetched)`);
  s.modify(sql`insert into db.ledger_exchange_rates (currency, rate_date, rate)
    select currency, ${date}, rate from (${rates}) fetched`);
  s.commitTransaction();
}
