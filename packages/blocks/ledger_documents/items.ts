import { sql } from "std/sql_utils";
import { TableBlock } from "std/system";
import type { TableBuilder } from "std/system";

export interface LedgerItemTableBlockOptions {
  /** Adds deferral months and account, for revenue recognized over time. */
  deferrals?: boolean;
}

/**
 * Finance attributes on the system's own item or product table, so items
 * are not duplicated in a finance catalog: where sales and purchases post
 * and whether sales are taxable.
 * The table needs a `name` column.
 */
export class LedgerItemTableBlock
  extends TableBlock<LedgerItemTableBlockOptions> {
  initialize(table: TableBuilder) {
    /** Where sales post; with a deferral, where they are recognized. */
    table.fk("income_account_id", "ledger_accounts").onDelete("Restrict");
    /** Where purchases post. */
    table.fk("expense_account_id", "ledger_accounts").onDelete("Restrict");
    table.bool("taxable").notNull().default(sql`false`);
    if (this.opts?.deferrals) {
      /** Sales are recognized evenly over this many months. */
      table.smallInt("deferral_months");
      table.fk("deferral_account_id", "ledger_accounts").onDelete("Restrict");
    }
  }
}
