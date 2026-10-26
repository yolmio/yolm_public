import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

export type LedgerAccountClass =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "expense";

/**
 * Account types follow the familiar QuickBooks list so migrated charts map
 * one-to-one. The class drives normal balance and statement placement.
 */
export const ACCOUNT_TYPES = [
  { name: "bank", displayName: "Bank", class: "asset" },
  {
    name: "accounts_receivable",
    displayName: "Accounts receivable (A/R)",
    class: "asset",
  },
  {
    name: "other_current_asset",
    displayName: "Other current asset",
    class: "asset",
  },
  { name: "fixed_asset", displayName: "Fixed asset", class: "asset" },
  { name: "other_asset", displayName: "Other asset", class: "asset" },
  {
    name: "accounts_payable",
    displayName: "Accounts payable (A/P)",
    class: "liability",
  },
  { name: "credit_card", displayName: "Credit card", class: "liability" },
  {
    name: "other_current_liability",
    displayName: "Other current liability",
    class: "liability",
  },
  {
    name: "long_term_liability",
    displayName: "Long-term liability",
    class: "liability",
  },
  { name: "equity", displayName: "Equity", class: "equity" },
  { name: "income", displayName: "Income", class: "income" },
  {
    name: "cost_of_goods_sold",
    displayName: "Cost of goods sold",
    class: "expense",
  },
  { name: "expense", displayName: "Expense", class: "expense" },
  { name: "other_income", displayName: "Other income", class: "income" },
  { name: "other_expense", displayName: "Other expense", class: "expense" },
] as const satisfies readonly {
  name: string;
  displayName: string;
  class: LedgerAccountClass;
}[];

export type LedgerAccountType = (typeof ACCOUNT_TYPES)[number]["name"];

/** SQL class (`asset`, `liability`, ...) for an account type expression. */
export function accountClassSql(type: Sql): Sql {
  const classes: LedgerAccountClass[] = [
    "asset",
    "liability",
    "equity",
    "income",
    "expense",
  ];
  return sql.caseWhen({
    conditions: classes.map((accountClass) => ({
      condition: sql`cast(${type} as string) in (${
        ACCOUNT_TYPES.filter((t) => t.class === accountClass).map((t) =>
          sql.lit(t.name)
        )
      })`,
      expr: sql.lit(accountClass),
    })),
  });
}

export interface LedgerStandardAccount {
  number: string;
  name: string;
  type: LedgerAccountType;
}

/**
 * Starter chart for a US small business, modeled on the QuickBooks Online
 * default chart. Systems may pass their own list to `insertChartOfAccounts`.
 */
export const STANDARD_CHART_OF_ACCOUNTS: LedgerStandardAccount[] = [
  { number: "1000", name: "Checking", type: "bank" },
  { number: "1010", name: "Savings", type: "bank" },
  { number: "1200", name: "Accounts Receivable", type: "accounts_receivable" },
  { number: "1300", name: "Undeposited Funds", type: "other_current_asset" },
  { number: "1400", name: "Prepaid Expenses", type: "other_current_asset" },
  { number: "1500", name: "Inventory Asset", type: "other_current_asset" },
  { number: "1700", name: "Equipment", type: "fixed_asset" },
  {
    number: "1790",
    name: "Accumulated Depreciation",
    type: "fixed_asset",
  },
  { number: "2000", name: "Accounts Payable", type: "accounts_payable" },
  { number: "2100", name: "Credit Card", type: "credit_card" },
  {
    number: "2200",
    name: "Sales Tax Payable",
    type: "other_current_liability",
  },
  {
    number: "2300",
    name: "Accrued Liabilities",
    type: "other_current_liability",
  },
  {
    number: "2400",
    name: "Payroll Liabilities",
    type: "other_current_liability",
  },
  { number: "2500", name: "Deferred Revenue", type: "other_current_liability" },
  { number: "2700", name: "Loans Payable", type: "long_term_liability" },
  { number: "3000", name: "Owner's Equity", type: "equity" },
  { number: "3100", name: "Owner's Draws", type: "equity" },
  { number: "3900", name: "Opening Balance Equity", type: "equity" },
  { number: "4000", name: "Sales", type: "income" },
  { number: "4100", name: "Services", type: "income" },
  { number: "4900", name: "Discounts Given", type: "income" },
  { number: "5000", name: "Cost of Goods Sold", type: "cost_of_goods_sold" },
  { number: "6000", name: "Advertising & Marketing", type: "expense" },
  { number: "6100", name: "Bank Charges & Fees", type: "expense" },
  { number: "6200", name: "Contractors", type: "expense" },
  { number: "6300", name: "Insurance", type: "expense" },
  { number: "6400", name: "Legal & Professional Services", type: "expense" },
  { number: "6500", name: "Meals", type: "expense" },
  { number: "6600", name: "Office Supplies & Software", type: "expense" },
  { number: "6700", name: "Payroll Expenses", type: "expense" },
  { number: "6800", name: "Rent & Lease", type: "expense" },
  { number: "6900", name: "Travel", type: "expense" },
  { number: "6950", name: "Utilities", type: "expense" },
  { number: "7000", name: "Depreciation", type: "expense" },
  { number: "8000", name: "Interest Earned", type: "other_income" },
  { number: "8500", name: "Interest Expense", type: "other_expense" },
];

/** Realized exchange gains and losses on foreign-currency settlements. */
export const EXCHANGE_GAIN_LOSS_ACCOUNT: LedgerStandardAccount = {
  number: "7900",
  name: "Exchange Gain or Loss",
  type: "other_expense",
};

/** Unrealized exchange gains and losses from period-end revaluation. */
export const UNREALIZED_EXCHANGE_ACCOUNT: LedgerStandardAccount = {
  number: "7950",
  name: "Unrealized Exchange Gain or Loss",
  type: "other_expense",
};

/** Cumulative translation adjustment for consolidated statements. */
export const TRANSLATION_ADJUSTMENT_ACCOUNT: LedgerStandardAccount = {
  number: "3800",
  name: "Cumulative Translation Adjustment",
  type: "equity",
};

/** Bank and credit card accounts: the ones with outside statements. */
export const STATEMENT_ACCOUNT_TYPES: LedgerAccountType[] = [
  "bank",
  "credit_card",
];

/** SQL list of `ledger_account_type` values for `in` comparisons. */
export function accountTypesSql(types: readonly LedgerAccountType[]): Sql {
  return sql`(${
    types.map((type) =>
      sql`cast(${sql.lit(type)} as enums.ledger_account_type)`
    )
  })`;
}
