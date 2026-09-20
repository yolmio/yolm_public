import { Sql, sql } from "../std/sql_utils";

/**
 * Cell value accepted by {@link quickBooksIifRow}.
 *
 * @category Service
 */
export type QuickBooksIifCell = Sql | string | number;

/**
 * Standard QuickBooks IIF transaction header fields for invoice exports.
 *
 * @category Service
 */
export const QUICKBOOKS_IIF_INVOICE_TRNS_FIELDS = [
  "TRNSID",
  "TRANSTYPE",
  "DATE",
  "ACCNT",
  "NAME",
  "CLASS",
  "AMOUNT",
  "DOCNUM",
  "MEMO",
  "CLEAR",
  "TOPRINT",
  "NAMEISTAXABLE",
  "ADDR1",
  "ADDR3",
  "TERMS",
  "SHIPVIA",
  "SHIPDATE",
] as const;

/**
 * Standard QuickBooks IIF split-line header fields for invoice exports.
 *
 * @category Service
 */
export const QUICKBOOKS_IIF_INVOICE_SPL_FIELDS = [
  "SPLID",
  "TRANSTYPE",
  "DATE",
  "ACCNT",
  "NAME",
  "CLASS",
  "AMOUNT",
  "DOCNUM",
  "MEMO",
  "CLEAR",
  "QNTY",
  "PRICE",
  "INVITEM",
  "TAXABLE",
  "OTHER2",
  "YEARTODATE",
  "WAGEBASE",
] as const;

/**
 * QuickBooks IIF end-of-transaction header row.
 *
 * @category Service
 */
export const QUICKBOOKS_IIF_ENDTRNS_HEADER = "!ENDTRNS";

function iifCell(value: QuickBooksIifCell): Sql {
  return value instanceof Sql ? value : sql.lit(String(value));
}

/**
 * Builds a tab-delimited QuickBooks IIF header row.
 *
 * Pass the row marker without the leading `!`; the helper prefixes it so
 * `quickBooksIifHeader("TRNS", ["DATE"])` returns `!TRNS\tDATE`.
 *
 * @category Service
 */
export function quickBooksIifHeader(
  rowType: string,
  fields: readonly string[],
): string {
  return [`!${rowType}`, ...fields].join("\t");
}

/**
 * Builds the three standard invoice export header rows as a newline-joined
 * string (`!TRNS…`, `!SPL…`, `!ENDTRNS`).
 *
 * @category Service
 */
export function quickBooksInvoiceIifHeaders(): string {
  return [
    quickBooksIifHeader("TRNS", QUICKBOOKS_IIF_INVOICE_TRNS_FIELDS),
    quickBooksIifHeader("SPL", QUICKBOOKS_IIF_INVOICE_SPL_FIELDS),
    QUICKBOOKS_IIF_ENDTRNS_HEADER,
  ].join("\n");
}

/**
 * Builds the three standard invoice export header rows as a SQL expression.
 *
 * Use this when appending headers inside a Yolm procedure scalar.
 *
 * @category Service
 */
export function quickBooksInvoiceIifHeaderRows(): Sql {
  return sql`${
    sql.lit(
      quickBooksIifHeader("TRNS", QUICKBOOKS_IIF_INVOICE_TRNS_FIELDS),
    )
  } || E'\n' ||
    ${sql.lit(quickBooksIifHeader("SPL", QUICKBOOKS_IIF_INVOICE_SPL_FIELDS))} ||
    E'\n' || ${sql.lit(QUICKBOOKS_IIF_ENDTRNS_HEADER)}`;
}

/**
 * Builds one tab-delimited QuickBooks IIF data row as a SQL expression.
 *
 * String and number cells become SQL string literals; SQL cells are composed
 * directly. The helper does not transform account names, dates, amounts, or
 * memo text, so callers keep full control over QuickBooks-specific values.
 *
 * @category Service
 */
export function quickBooksIifRow(cells: readonly QuickBooksIifCell[]): Sql {
  if (cells.length === 0) {
    return sql.lit``;
  }
  let row = iifCell(cells[0]);
  for (let i = 1; i < cells.length; i++) {
    row = sql`${row} || E'\t' || ${iifCell(cells[i])}`;
  }
  return row;
}
