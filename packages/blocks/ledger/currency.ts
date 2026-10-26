import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

/**
 * Stored amount type for every ledger money column. Four decimal places hold
 * any ISO 4217 currency (0, 2, or 3 minor digits) plus units of account;
 * amounts are rounded to the functional currency's minor unit when posted.
 */
export const AMOUNT_TYPE = {
  type: "Decimal",
  precision: 18,
  scale: 4,
  signed: true,
} as const;

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

/** Minor-unit digits for an ISO 4217 currency code. */
export function currencyDecimals(code: string): number {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Currency must be an ISO 4217 code: ${code}`);
  }
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/** SQL minor-unit digits for a currency code expression (2 when unlisted). */
export function currencyDecimalsSql(code: Sql): Sql {
  const list = (codes: Set<string>) =>
    sql`(${[...codes].map((c) => sql.lit(c))})`;
  return sql`case when ${code} in ${list(ZERO_DECIMAL_CURRENCIES)} then 0
    when ${code} in ${list(THREE_DECIMAL_CURRENCIES)} then 3 else 2 end`;
}
