import { type Block, system } from "std/system";
import { sql } from "std/sql_utils";
import { Tabs } from "components/tabs";
import {
  InvoiceDetail,
  InvoiceGenerator,
  InvoiceListBrowse,
} from "./invoicing";
import {
  BillApprovalWorkflow,
  ResearcherBillGenerator,
  ResearcherPaymentTracking,
} from "./billing";
import {
  PeriodCloseManager,
  PLAnalysis,
  PLDashboard,
} from "./financial_reporting";
import { FeeVerification, OrderExpenseEntry } from "./expense_tracking";
import {
  ClientRateProposals,
  RateCalculatorWizard,
  ResearcherRatesManager,
  SlidingScaleRates,
} from "./rate_management";
import {
  ClientRatesManager,
  DefaultRatesManager,
  MissingRatesManager,
  RateDashboard,
} from "./rates";
import {
  CommissionCalculator,
  CommissionPaymentTracking,
  CommissionStructureManager,
} from "./commissions";
import {
  BalanceSheetReport,
  BudgetComparison,
  MarginAnalysisTools,
  PLByJurisdiction,
  PLByResearcher,
  TrialBalanceReport,
} from "./advanced_reporting";

const tabStyles = {
  py: 4,
  px: 6,
  fontWeight: "medium",
  flex: "initial",
};

/**
 * AccountingBlock - Completes the double-entry accounting system
 *
 * This block provides the missing accounting infrastructure needed for:
 * - GL period management and closing
 * - Chart of Accounts with account metadata
 * - Rate management UI support
 * - Enhanced financial reporting
 *
 * Works in conjunction with existing tables:
 * - journal_entries (already exists)
 * - ar_invoices (already exists)
 * - ap_bills (already exists)
 * - client_rates (already exists)
 * - researcher_rates (already exists)
 */
export class AccountingBlock implements Block {
  blockName = "AccountingBlock";
  tablesDefined: string[] = [];
  componentDependencies: string[] = [];
  description =
    "Complete accounting system with GL periods, chart of accounts, and rate management";

  initialize() {
    const { db } = system;

    // Rate-related enums
    system.enum_({
      name: "rate_proposal_status",
      values: [
        { name: "pending", displayName: "Pending" },
        { name: "approved", displayName: "Approved" },
        { name: "rejected", displayName: "Rejected" },
        { name: "expired", displayName: "Expired" },
      ],
    });

    system.enum_({
      name: "tat_type",
      values: [
        { name: "standard", displayName: "Standard (48-72 hours)" },
        { name: "rush", displayName: "Rush (24-48 hours)" },
        { name: "urgent", displayName: "Urgent (12-24 hours)" },
        { name: "immediate", displayName: "Immediate (< 12 hours)" },
      ],
    });

    system.enum_({
      name: "sliding_scale_type",
      values: [
        { name: "volume", displayName: "Volume-based" },
        { name: "revenue", displayName: "Revenue-based" },
        { name: "time", displayName: "Time-based" },
      ],
    });

    system.enum_({
      name: "gl_period_status",
      values: [
        { name: "open", displayName: "Open" },
        { name: "closing", displayName: "Closing" },
        { name: "closed", displayName: "Closed" },
        { name: "locked", displayName: "Locked" }, // Cannot be modified even by admins
      ],
    });

    system.enum_({
      name: "account_type",
      values: [
        { name: "asset", displayName: "Asset" },
        { name: "liability", displayName: "Liability" },
        { name: "equity", displayName: "Equity" },
        { name: "revenue", displayName: "Revenue" },
        { name: "expense", displayName: "Expense" },
      ],
    });

    system.enum_({
      name: "account_category",
      values: [
        // Assets
        { name: "current_asset", displayName: "Current Asset" },
        { name: "fixed_asset", displayName: "Fixed Asset" },
        { name: "other_asset", displayName: "Other Asset" },
        // Liabilities
        { name: "current_liability", displayName: "Current Liability" },
        { name: "long_term_liability", displayName: "Long Term Liability" },
        // Equity
        { name: "owner_equity", displayName: "Owner Equity" },
        { name: "retained_earnings", displayName: "Retained Earnings" },
        // Revenue
        { name: "operating_revenue", displayName: "Operating Revenue" },
        { name: "other_revenue", displayName: "Other Revenue" },
        // COGS
        { name: "direct_costs", displayName: "Direct Costs" },
        { name: "indirect_costs", displayName: "Indirect Costs" },
        // OpEx
        { name: "administrative", displayName: "Administrative" },
        { name: "sales_marketing", displayName: "Sales & Marketing" },
        { name: "technology", displayName: "Technology" },
      ],
    });

    system.enum_({
      name: "balance_side",
      values: [
        { name: "debit", displayName: "Debit" },
        { name: "credit", displayName: "Credit" },
      ],
    });

    system.enum_({
      name: "rate_calculation_method",
      values: [
        { name: "fixed", displayName: "Fixed Amount" },
        { name: "percentage", displayName: "Percentage of Base" },
        { name: "sliding_scale", displayName: "Sliding Scale" },
        { name: "tiered", displayName: "Tiered" },
        { name: "cost_plus", displayName: "Cost Plus Margin" },
      ],
    });

    system.enum_({
      name: "allocation_basis",
      values: [
        { name: "order_count", displayName: "Order Count" },
        { name: "revenue", displayName: "Revenue" },
        { name: "direct_costs", displayName: "Direct Costs" },
        { name: "researcher_hours", displayName: "Researcher Hours" },
        { name: "equal_distribution", displayName: "Equal Distribution" },
      ],
    });

    system.enum_({
      name: "allocation_frequency",
      values: [
        { name: "monthly", displayName: "Monthly" },
        { name: "quarterly", displayName: "Quarterly" },
        { name: "annually", displayName: "Annually" },
      ],
    });

    system.enum_({
      name: "report_type",
      values: [
        { name: "pl", displayName: "Profit & Loss" },
        { name: "balance_sheet", displayName: "Balance Sheet" },
        { name: "trial_balance", displayName: "Trial Balance" },
        { name: "custom", displayName: "Custom" },
      ],
    });

    system.enum_({
      name: "period_close_task_status",
      values: [
        { name: "pending", displayName: "Pending" },
        { name: "in_progress", displayName: "In Progress" },
        { name: "completed", displayName: "Completed" },
        { name: "skipped", displayName: "Skipped" },
      ],
    });

    system.enum_({
      name: "invoice_status",
      values: [
        { name: "draft", displayName: "Draft" },
        { name: "sent", displayName: "Sent" },
        { name: "paid", displayName: "Paid" },
        { name: "overdue", displayName: "Overdue" },
        { name: "cancelled", displayName: "Cancelled" },
      ],
    });

    system.enum_({
      name: "payment_status",
      values: [
        { name: "pending", displayName: "Pending" },
        { name: "cleared", displayName: "Cleared" },
        { name: "bounced", displayName: "Bounced" },
        { name: "reversed", displayName: "Reversed" },
      ],
    });

    system.enum_({
      name: "bill_status",
      values: [
        { name: "pending", displayName: "Pending" },
        { name: "approved", displayName: "Approved" },
        { name: "paid", displayName: "Paid" },
        { name: "disputed", displayName: "Disputed" },
        { name: "cancelled", displayName: "Cancelled" },
      ],
    });

    system.enum_({
      name: "ap_payment_status",
      values: [
        { name: "pending", displayName: "Pending" },
        { name: "cleared", displayName: "Cleared" },
        { name: "stopped", displayName: "Stopped" },
        { name: "voided", displayName: "Voided" },
      ],
    });

    db.table("gl_periods", (t) => {
      t.description("Accounting periods for financial close management");

      t.string("period_name", 50).notNull()
        .description("e.g. '2024-01 January', '2024-Q1'");

      t.date("start_date").notNull().unique();
      t.date("end_date").notNull();

      t.enum("status", "gl_period_status").notNull().default(sql.lit`open`);

      // Close tracking
      t.timestamp("closed_at");
      t.string("closed_by_user", 100);
      t.string("close_notes", 500);

      // Period close checklist
      t.bool("revenue_recognized").notNull().default(false);
      t.bool("expenses_accrued").notNull().default(false);
      t.bool("reconciliations_complete").notNull().default(false);
      t.bool("adjusting_entries_posted").notNull().default(false);
      t.bool("financial_statements_reviewed").notNull().default(false);

      // Prevent overlapping periods
      t.check({
        fields: ["start_date", "end_date"],
        errorMessage: () => sql.lit`End date must be after start date`,
        check: ([startDate, endDate]) => sql`${startDate} < ${endDate}`,
      });

      t.virtual(
        "is_current",
        sql`current_date() between start_date and end_date`,
      );
    });
    this.tablesDefined.push("gl_periods");

    db.table("chart_of_accounts", (t) => {
      t.description("Master list of GL accounts with metadata");

      // Using the existing 'account' enum value as the key
      t.string("account_code", 50).notNull().unique()
        .description("Maps to the 'account' enum used in journal_entries");

      t.string("account_name", 100).notNull();
      t.string("description", 500);

      t.enum("account_type", "account_type").notNull();
      t.enum("account_category", "account_category").notNull();

      // Hierarchy support
      t.string("parent_account_code", 50);

      // Control flags
      t.bool("is_active").notNull().default(true);
      t.bool("is_control_account").notNull().default(false)
        .description("Cannot post directly, only through sub-accounts");
      t.bool("requires_dimension").notNull().default(false)
        .description("Must have client/jurisdiction/researcher dimension");

      // For financial statement presentation
      t.int("sort_order").notNull().default(1000);
      t.string("financial_statement_section", 100);

      // Normal balance for validation
      t.enum("normal_balance", "balance_side").notNull();

      // Book restrictions
      t.bool("statutory_only").notNull().default(false);
      t.bool("management_only").notNull().default(false);
    });
    this.tablesDefined.push("chart_of_accounts");

    db.table("overhead_allocation_rules", (t) => {
      t.description(
        "Rules for allocating overhead costs to jurisdictions/clients",
      );

      t.string("rule_name", 100).notNull();
      t.bool("is_active").notNull().default(true);

      t.enum("source_account_type", "account_type").notNull();
      t.string("source_account_pattern", 100)
        .description("SQL LIKE pattern for account codes");

      t.enum("allocation_basis", "allocation_basis").notNull();

      // Target dimensions
      //This should be passed as props to the block?
      t.bool("allocate_to_jurisdictions").notNull().default(true);
      t.bool("allocate_to_clients").notNull().default(false);
      t.bool("allocate_to_researchers").notNull().default(false);

      t.decimal("allocation_percent", { precision: 5, scale: 2 }).notNull()
        .default(100)
        .description("Percentage of source amount to allocate");

      t.enum("frequency", "allocation_frequency").notNull().default(
        sql.lit`monthly`,
      );
    });
    this.tablesDefined.push("overhead_allocation_rules");

    db.table("financial_report_templates", (t) => {
      t.description(
        "Configurable templates for P&L and other financial reports",
      );

      t.string("template_name", 100).notNull().unique();
      t.enum("report_type", "report_type").notNull();

      t.string("description", 500);
      t.bool("is_default").notNull().default(false);

      // Grouping preferences
      //grouping should be passed as props to the block?
      t.bool("group_by_jurisdiction").notNull().default(false);
      t.bool("group_by_client").notNull().default(false);
      t.bool("group_by_researcher").notNull().default(false);
      t.bool("group_by_search_type").notNull().default(false);

      t.bool("show_percentages").notNull().default(true);
      t.bool("show_variances").notNull().default(false);
      t.bool("show_budget_comparison").notNull().default(false);

      t.string("included_accounts", 1000)
        .description("JSON array of account codes to include");
      t.string("excluded_accounts", 1000)
        .description("JSON array of account codes to exclude");
    });
    this.tablesDefined.push("financial_report_templates");

    db.table("missing_rates_log", (t) => {
      t.description("Track rate lookups that failed to find a match");

      t.fk("order_id", "orders");
      t.fk("client_id", "clients");
      t.fk("jurisdiction_id", "jurisdictions");
      t.enum("search_type", "search_type");
      t.enum("rate_type", "order_expense_type");

      t.timestamp("lookup_timestamp").notNull().default(
        sql`current_timestamp()`,
      );

      t.money("fallback_amount");
      t.string("fallback_source", 100)
        .description("e.g. 'system_default', 'state_average', 'zero'");

      t.bool("is_resolved").notNull().default(false);
      t.timestamp("resolved_at");
      t.string("resolved_by_user", 100);
    });
    this.tablesDefined.push("missing_rates_log");

    db.table("period_close_tasks", (t) => {
      t.description("Detailed checklist for period close process");

      t.fk("period_id", "gl_periods").notNull();

      t.string("task_name", 200).notNull();
      t.string("task_category", 100).notNull()
        .description("e.g. 'Revenue', 'Expenses', 'Reconciliation'");

      t.int("sequence_order").notNull();

      t.enum("status", "period_close_task_status").notNull().default(
        sql.lit`pending`,
      );

      t.timestamp("started_at");
      t.timestamp("completed_at");
      t.string("completed_by_user", 100);

      t.string("task_notes", 2000);
      t.string("completion_notes", 2000);

      t.string("validation_query", 2000)
        .description(
          "SQL query that should return 0 rows when task is complete",
        );
    });
    this.tablesDefined.push("period_close_tasks");

    db.table("ar_invoices", (t) => {
      t.description("Client invoices for billing");

      t.fk("client_id", "clients").notNull();
      t.string("invoice_number", 50).notNull().unique();

      t.date("invoice_date").notNull();
      t.date("due_date").notNull();

      t.money("subtotal").notNull();
      t.money("tax_amount").notNull().default(0);
      t.money("total_amount").notNull();

      t.enum("status", "invoice_status").notNull().default(sql.lit`draft`);

      t.date("sent_date");
      t.date("paid_date");

      t.string("payment_terms", 50);
      t.string("notes", 2000);

      t.string("generated_by_user", 100);
      t.timestamp("generated_at").notNull().default(sql`current_timestamp()`);
    });
    this.tablesDefined.push("ar_invoices");

    db.table("ar_payments", (t) => {
      t.description("Client payment records");

      t.fk("invoice_id", "ar_invoices");
      t.fk("client_id", "clients").notNull();

      t.money("amount").notNull();
      t.date("payment_date").notNull();
      t.string("payment_method", 50).notNull();
      t.string("reference_number", 100);

      t.enum("status", "payment_status").notNull().default(sql.lit`pending`);

      t.timestamp("cleared_at");
      t.string("notes", 1000);

      t.bigInt("journal_entry_id").notNull();
    });
    this.tablesDefined.push("ar_payments");

    db.table("ap_bills", (t) => {
      t.description("Researcher/vendor bills for payment");

      t.fk("researcher_id", "researchers").notNull();
      t.string("bill_number", 50).notNull().unique();

      t.date("bill_date").notNull();
      t.date("due_date").notNull();

      t.money("subtotal").notNull();
      t.money("tax_amount").notNull().default(0);
      t.money("total_amount").notNull();

      t.enum("status", "bill_status").notNull().default(sql.lit`pending`);

      t.date("approved_date");
      t.string("approved_by", 100);
      t.date("paid_date");

      t.string("payment_terms", 50);
      t.string("notes", 2000);

      t.string("created_by_user", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
    });
    this.tablesDefined.push("ap_bills");

    db.table("ap_payments", (t) => {
      t.description("Researcher payment records");

      t.fk("bill_id", "ap_bills");
      t.fk("researcher_id", "researchers").notNull();

      t.money("amount").notNull();
      t.date("payment_date").notNull();
      t.string("payment_method", 50).notNull();
      t.string("check_number", 50);

      t.enum("status", "ap_payment_status").notNull().default(sql.lit`pending`);

      t.timestamp("cleared_at");
      t.string("notes", 1000);

      t.bigInt("journal_entry_id").notNull();
    });
    this.tablesDefined.push("ap_payments");

    // Order expense tracking
    db.table("order_expenses", (t) => {
      t.description("Track all expenses associated with orders");

      t.fk("order_id", "orders").notNull();
      t.fk("order_case_id", "order_cases");
      t.fk("researcher_id", "researchers");

      t.enum("expense_type", "order_expense_type").notNull();
      t.money("amount_incurred").notNull().default(0);
      t.money("amount_billed").notNull().default(0);
      t.money("amount_paid_researcher").notNull().default(0);

      t.string("description", 500);

      t.bool("is_billable").notNull().default(true);

      t.string("created_by", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
    });
    this.tablesDefined.push("order_expenses");

    db.table("order_case_fees", (t) => {
      t.description("Fees associated with specific cases within orders");

      t.fk("order_case_id", "order_cases").notNull();

      t.enum("fee_type", "case_fee_type").notNull();
      t.money("amount").notNull();
      t.string("description", 500);

      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
    });
    this.tablesDefined.push("order_case_fees");

    // Core accounting tables
    db.table("journal_entries", (t) => {
      t.description("General journal entries for all accounting transactions");

      t.date("entry_date").notNull();
      t.string("description", 500).notNull();
      t.enum("entry_type", "journal_entry_type").notNull();
      t.enum("status", "journal_status").notNull().default(sql.lit`draft`);

      // Reference fields for source documents
      t.string("reference_type", 50);
      t.bigInt("reference_id");

      t.string("created_by_user", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
      t.string("posted_by_user", 100);
      t.timestamp("posted_at");

      t.string("notes", 2000);
    });
    this.tablesDefined.push("journal_entries");

    db.table("journal_lines", (t) => {
      t.description("Individual line items within journal entries");

      t.fk("journal_id", "journal_entries").notNull();
      t.enum("account", "account").notNull();
      t.money("debit").notNull().default(0);
      t.money("credit").notNull().default(0);

      // Dimensions for analytics
      t.fk("client_id", "clients");
      t.fk("jurisdiction_id", "jurisdictions");
      t.fk("researcher_id", "researchers");

      t.string("memo", 500);

      t.check({
        fields: ["debit", "credit"],
        errorMessage: () => sql.lit`Either debit or credit must be zero`,
        check: ([debit, credit]) => sql`${debit} = 0 or ${credit} = 0`,
      });

      t.check({
        fields: ["debit", "credit"],
        errorMessage: () => sql.lit`Debit and credit cannot both be zero`,
        check: ([debit, credit]) => sql`${debit} > 0 or ${credit} > 0`,
      });
    });
    this.tablesDefined.push("journal_lines");

    // Rate management tables
    db.table("client_rates", (t) => {
      t.description("Custom billing rates for clients");

      t.fk("client_id", "clients");
      t.fk("jurisdiction_id", "jurisdictions");
      t.enum("search_type", "search_type");
      t.enum("rate_type", "order_expense_type").notNull();

      t.money("amount").notNull();
      t.date("effective_from").notNull();
      t.date("effective_to");
      t.bool("is_active").notNull().default(true);

      t.string("created_by_user", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
      t.string("notes", 1000);

      t.unique(["client_id", "jurisdiction_id", "search_type", "rate_type"]);
    });
    this.tablesDefined.push("client_rates");

    db.table("researcher_rates", (t) => {
      t.description("Cost rates for researchers/contractors");

      t.fk("researcher_id", "researchers");
      t.fk("jurisdiction_id", "jurisdictions");
      t.enum("search_type", "search_type");

      t.money("rate").notNull();
      t.bool("is_active").notNull().default(true);

      t.string("created_by_user", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
      t.string("notes", 1000);

      t.unique(["researcher_id", "jurisdiction_id", "search_type"]);
    });
    this.tablesDefined.push("researcher_rates");

    // Advanced rate management tables
    db.table("volume_discounts", (t) => {
      t.description("Volume-based discount tiers for clients");

      t.fk("client_id", "clients");
      t.int("min_volume").notNull();
      t.int("max_volume");
      t.decimal("discount_percent", { precision: 5, scale: 2 }).notNull();
      t.string("description", 200);

      t.check({
        fields: ["min_volume", "max_volume"],
        errorMessage: () => sql.lit`Max volume must be greater than min volume`,
        check: ([min, max]) => sql`${max} is null or ${max} > ${min}`,
      });
    });
    this.tablesDefined.push("volume_discounts");

    db.table("tat_pricing", (t) => {
      t.description("Turn-around time based pricing tiers");

      t.enum("tat_type", "tat_type").notNull().unique();
      t.int("hours").notNull();
      t.decimal("premium_percent", { precision: 5, scale: 2 }).notNull();
      t.bool("is_active").notNull().default(true);
      t.string("description", 200);
    });
    this.tablesDefined.push("tat_pricing");

    db.table("client_rate_proposals", (t) => {
      t.description("Proposed rate changes for client approval");

      t.fk("client_id", "clients").notNull();
      t.string("proposal_name", 200).notNull();
      t.string("description", 1000);
      t.date("valid_until").notNull();
      t.enum("status", "rate_proposal_status").notNull().default(
        sql.lit`pending`,
      );

      t.string("created_by", 100).notNull();
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
      t.string("approved_by", 100);
      t.timestamp("approved_date");
    });
    this.tablesDefined.push("client_rate_proposals");

    db.table("client_rate_proposal_details", (t) => {
      t.description("Individual rate items within a proposal");

      t.fk("proposal_id", "client_rate_proposals").notNull();
      t.fk("jurisdiction_id", "jurisdictions");
      t.enum("search_type", "search_type");
      t.enum("rate_type", "order_expense_type").notNull();

      t.money("current_rate");
      t.money("proposed_rate").notNull();
      t.int("volume_commitment");
      t.money("estimated_cost");
      t.decimal("margin_percent", { precision: 5, scale: 2 });
    });
    this.tablesDefined.push("client_rate_proposal_details");

    db.table("sliding_scale_rates", (t) => {
      t.description("Sliding scale rate configurations");

      t.fk("client_id", "clients");
      t.string("scale_name", 200).notNull();
      t.string("description", 500);
      t.enum("scale_type", "sliding_scale_type").notNull();
      t.money("base_rate").notNull();
      t.bool("is_active").notNull().default(true);
    });
    this.tablesDefined.push("sliding_scale_rates");

    db.table("sliding_scale_tiers", (t) => {
      t.description("Individual tiers within a sliding scale");

      t.fk("scale_id", "sliding_scale_rates").notNull();
      t.decimal("min_value", { precision: 12, scale: 2 }).notNull();
      t.decimal("max_value", { precision: 12, scale: 2 });
      t.decimal("discount_percent", { precision: 5, scale: 2 }).notNull();
      t.string("description", 200);
    });
    this.tablesDefined.push("sliding_scale_tiers");

    // Commission management tables
    db.table("commission_structures", (t) => {
      t.description("Commission structures for employees/agents");

      t.string("name", 200).notNull();
      t.string("description", 500);
      t.enum("type", "commission_type").notNull();
      t.bool("is_active").notNull().default(true);

      // Base commission settings
      t.decimal("base_rate", { precision: 5, scale: 2 });
      t.money("minimum_threshold");
      t.money("cap_amount");

      t.string("created_by", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
    });
    this.tablesDefined.push("commission_structures");

    db.table("commission_tiers", (t) => {
      t.description("Tiered commission rates");

      t.fk("structure_id", "commission_structures").notNull();
      t.money("min_amount").notNull();
      t.money("max_amount");
      t.decimal("rate", { precision: 5, scale: 2 }).notNull();
      t.string("description", 200);

      t.check({
        fields: ["min_amount", "max_amount"],
        errorMessage: () => sql.lit`Max amount must be greater than min amount`,
        check: ([min, max]) => sql`${max} is null or ${max} > ${min}`,
      });
    });
    this.tablesDefined.push("commission_tiers");

    db.table("employee_commissions", (t) => {
      t.description("Commission assignments to employees");

      t.fk("employee_id", "employees").notNull();
      t.fk("structure_id", "commission_structures").notNull();
      t.date("effective_from").notNull();
      t.date("effective_to");
      t.bool("is_active").notNull().default(true);

      // Override settings
      t.decimal("override_rate", { precision: 5, scale: 2 });
      t.string("notes", 500);

      t.unique(["employee_id", "effective_from"]);
    });
    this.tablesDefined.push("employee_commissions");

    db.table("commission_calculations", (t) => {
      t.description("Calculated commissions for payment");

      t.fk("employee_id", "employees").notNull();
      t.date("period_start").notNull();
      t.date("period_end").notNull();

      // Calculation details
      t.money("gross_sales").notNull();
      t.money("commissionable_amount").notNull();
      t.decimal("commission_rate", { precision: 5, scale: 2 }).notNull();
      t.money("commission_amount").notNull();

      // Adjustments
      t.money("adjustments").notNull().default(0);
      t.string("adjustment_notes", 1000);
      t.money("final_amount").notNull();

      t.enum("status", "commission_status").notNull().default(sql.lit`pending`);
      t.date("approved_date");
      t.string("approved_by", 100);
      t.date("paid_date");
      t.string("payment_reference", 100);

      t.timestamp("calculated_at").notNull().default(sql`current_timestamp()`);
      t.string("calculated_by", 100);

      t.unique(["employee_id", "period_start", "period_end"]);
    });
    this.tablesDefined.push("commission_calculations");

    db.table("commission_details", (t) => {
      t.description("Line items contributing to commission calculations");

      t.fk("calculation_id", "commission_calculations").notNull();
      t.fk("order_id", "orders");
      t.fk("invoice_id", "ar_invoices");

      t.money("amount").notNull();
      t.decimal("rate", { precision: 5, scale: 2 }).notNull();
      t.money("commission").notNull();
      t.string("description", 500);
    });
    this.tablesDefined.push("commission_details");

    // Budget management tables
    db.table("budget_entries", (t) => {
      t.description("Budget entries by account and period");

      t.date("period_start").notNull();
      t.string("account", 50).notNull();
      t.money("budget_amount").notNull();

      t.string("notes", 1000);
      t.string("created_by", 100);
      t.timestamp("created_at").notNull().default(sql`current_timestamp()`);
      t.string("updated_by", 100);
      t.timestamp("updated_at");

      t.unique(["period_start", "account"]);
    });
    this.tablesDefined.push("budget_entries");

    // Supporting enums
    system.enum_({
      name: "commission_type",
      values: [
        { name: "flat_rate", displayName: "Flat Rate" },
        { name: "tiered", displayName: "Tiered" },
        { name: "sliding_scale", displayName: "Sliding Scale" },
        { name: "revenue_share", displayName: "Revenue Share" },
        { name: "hybrid", displayName: "Hybrid" },
      ],
    });

    system.enum_({
      name: "commission_status",
      values: [
        { name: "pending", displayName: "Pending" },
        { name: "approved", displayName: "Approved" },
        { name: "paid", displayName: "Paid" },
        { name: "disputed", displayName: "Disputed" },
        { name: "cancelled", displayName: "Cancelled" },
      ],
    });

    system.enum_({
      name: "order_expense_type",
      values: [
        { name: "search_fee", displayName: "Search Fee" },
        { name: "court_fee", displayName: "Court Fee" },
        { name: "court_copy_docket_fee", displayName: "Copy/Docket Fee" },
        { name: "researcher_expense", displayName: "Researcher Expense" },
        { name: "surcharge", displayName: "Surcharge" },
        { name: "miscellaneous_expense", displayName: "Miscellaneous" },
        { name: "unbillable", displayName: "Unbillable" },
      ],
    });

    system.enum_({
      name: "case_fee_type",
      values: [
        { name: "court_file_pull_fee", displayName: "Court File Pull" },
        { name: "court_copy_docket_fee", displayName: "Copy/Docket Fee" },
        { name: "court_search_fee", displayName: "Court Search Fee" },
        { name: "researcher_expense", displayName: "Researcher Expense" },
        { name: "unbillable_court_fee", displayName: "Unbillable Court Fee" },
      ],
    });

    system.enum_({
      name: "journal_entry_type",
      values: [
        { name: "revenue", displayName: "Revenue Recognition" },
        { name: "expense", displayName: "Expense" },
        { name: "payment", displayName: "Payment" },
        { name: "accrual", displayName: "Accrual" },
      ],
    });

    system.enum_({
      name: "journal_status",
      values: [
        { name: "draft", displayName: "Draft" },
        { name: "posted", displayName: "Posted" },
        { name: "reversed", displayName: "Reversed" },
      ],
    });
  }

  static RateDashboard = RateDashboard;
  static DefaultRatesManager = DefaultRatesManager;
  static ClientRatesManager = ClientRatesManager;
  static MissingRatesManager = MissingRatesManager;
  static RateCalculatorWizard = RateCalculatorWizard;
  static ClientRateProposals = ClientRateProposals;
  static ResearcherRatesManager = ResearcherRatesManager;
  static SlidingScaleRates = SlidingScaleRates;
  static InvoiceGenerator = InvoiceGenerator;
  static InvoiceListBrowse = InvoiceListBrowse;
  static InvoiceDetail = InvoiceDetail;
  static ResearcherBillGenerator = ResearcherBillGenerator;
  static BillApprovalWorkflow = BillApprovalWorkflow;
  static ResearcherPaymentTracking = ResearcherPaymentTracking;
  static PLDashboard = PLDashboard;
  static PLAnalysis = PLAnalysis;
  static PeriodCloseManager = PeriodCloseManager;
  static OrderExpenseEntry = OrderExpenseEntry;
  static FeeVerification = FeeVerification;
  static CommissionStructureManager = CommissionStructureManager;
  static CommissionCalculator = CommissionCalculator;
  static CommissionPaymentTracking = CommissionPaymentTracking;
  static PLByJurisdiction = PLByJurisdiction;
  static PLByResearcher = PLByResearcher;
  static MarginAnalysisTools = MarginAnalysisTools;
  static BudgetComparison = BudgetComparison;
  static TrialBalanceReport = TrialBalanceReport;
  static BalanceSheetReport = BalanceSheetReport;
  static AccountingPage = AccountingPage;
}

// Rate Management sub-tabs component
function RateManagementTabs() {
  return (
    <div className="flex flex-col h-full">
      <Tabs selectedTabScalar="rate_sub_tab" defaultValue="rate_dashboard">
        <Tabs.List sx={{ pl: 2 }}>
          <Tabs.Tab
            value="rate_dashboard"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Rate Dashboard
          </Tabs.Tab>
          <Tabs.Tab
            value="rate_calculator"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Rate Calculator
          </Tabs.Tab>
          <Tabs.Tab
            value="client_rates"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Client Rates
          </Tabs.Tab>
          <Tabs.Tab
            value="researcher_rates"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Researcher Rates
          </Tabs.Tab>
          <Tabs.Tab
            value="rate_proposals"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Rate Proposals
          </Tabs.Tab>
          <Tabs.Tab
            value="sliding_scales"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Sliding Scales
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="rate_dashboard" sx={{ p: 0 }}>
          <RateDashboard />
        </Tabs.Panel>
        <Tabs.Panel value="rate_calculator" sx={{ p: 0 }}>
          <RateCalculatorWizard />
        </Tabs.Panel>
        <Tabs.Panel value="client_rates" sx={{ p: 0 }}>
          <DefaultRatesManager />
        </Tabs.Panel>
        <Tabs.Panel value="researcher_rates" sx={{ p: 0 }}>
          <ResearcherRatesManager />
        </Tabs.Panel>
        <Tabs.Panel value="rate_proposals" sx={{ p: 0 }}>
          <ClientRateProposals />
        </Tabs.Panel>
        <Tabs.Panel value="sliding_scales" sx={{ p: 0 }}>
          <SlidingScaleRates />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function AccountingPage() {
  return (
    <div className="flex flex-col h-full">
      <Tabs selectedTabScalar="selected_tab" defaultValue="pl_dashboard">
        <Tabs.List
          sx={{
            "--tab-indicator-thickness": "3px",
            borderBottom: "1px solid",
            borderColor: "divider",
            px: 2,
            bgcolor: "background.surface",
          }}
        >
          <Tabs.Tab
            value="pl_dashboard"
            sx={tabStyles}
            selectedColor="primary"
          >
            P&L Dashboard
          </Tabs.Tab>
          <Tabs.Tab
            value="client_invoicing"
            sx={tabStyles}
            selectedColor="primary"
          >
            Client Invoicing
          </Tabs.Tab>
          <Tabs.Tab
            value="invoice_list"
            sx={tabStyles}
            selectedColor="primary"
          >
            Invoice List
          </Tabs.Tab>
          <Tabs.Tab
            value="researcher_billing"
            sx={tabStyles}
            selectedColor="primary"
          >
            Researcher Billing
          </Tabs.Tab>
          <Tabs.Tab
            value="bill_approval"
            sx={tabStyles}
            selectedColor="primary"
          >
            Bill Approval
          </Tabs.Tab>
          <Tabs.Tab
            value="payment_tracking"
            sx={tabStyles}
            selectedColor="primary"
          >
            Payment Tracking
          </Tabs.Tab>
          <Tabs.Tab
            value="expense_entry"
            sx={tabStyles}
            selectedColor="primary"
          >
            Expense Entry
          </Tabs.Tab>
          <Tabs.Tab
            value="fee_verification"
            sx={tabStyles}
            selectedColor="primary"
          >
            Fee Verification
          </Tabs.Tab>
          <Tabs.Tab value="rates" sx={tabStyles} selectedColor="primary">
            Rates
          </Tabs.Tab>
          <Tabs.Tab
            value="period_close"
            sx={tabStyles}
            selectedColor="primary"
          >
            Period Close
          </Tabs.Tab>
          <Tabs.Tab value="commissions" sx={tabStyles} selectedColor="primary">
            Commissions
          </Tabs.Tab>
          <Tabs.Tab value="advanced_pl" sx={tabStyles} selectedColor="primary">
            Advanced P&L
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="pl_dashboard" sx={{ p: 0 }}>
          <PLDashboard />
        </Tabs.Panel>
        <Tabs.Panel value="client_invoicing" sx={{ p: 0 }}>
          <InvoiceGenerator />
        </Tabs.Panel>
        <Tabs.Panel value="invoice_list" sx={{ p: 0 }}>
          <InvoiceListBrowse />
        </Tabs.Panel>
        <Tabs.Panel value="researcher_billing" sx={{ p: 0 }}>
          <ResearcherBillGenerator />
        </Tabs.Panel>
        <Tabs.Panel value="bill_approval" sx={{ p: 0 }}>
          <BillApprovalWorkflow />
        </Tabs.Panel>
        <Tabs.Panel value="payment_tracking" sx={{ p: 0 }}>
          <ResearcherPaymentTracking />
        </Tabs.Panel>
        <Tabs.Panel value="expense_entry" sx={{ p: 0 }}>
          <OrderExpenseEntry />
        </Tabs.Panel>
        <Tabs.Panel value="fee_verification" sx={{ p: 0 }}>
          <FeeVerification />
        </Tabs.Panel>
        <Tabs.Panel value="rates" sx={{ p: 0 }}>
          <RateManagementTabs />
        </Tabs.Panel>
        <Tabs.Panel value="period_close" sx={{ p: 0 }}>
          <PeriodCloseManager />
        </Tabs.Panel>
        <Tabs.Panel value="commissions" sx={{ p: 0 }}>
          <CommissionManagementTabs />
        </Tabs.Panel>
        <Tabs.Panel value="advanced_pl" sx={{ p: 0 }}>
          <AdvancedPLTabs />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

// Commission Management sub-tabs component
function CommissionManagementTabs() {
  return (
    <div className="flex flex-col h-full">
      <Tabs selectedTabScalar="commission_sub_tab" defaultValue="structures">
        <Tabs.List sx={{ pl: 2 }}>
          <Tabs.Tab
            value="structures"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Structures
          </Tabs.Tab>
          <Tabs.Tab
            value="calculator"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Calculator
          </Tabs.Tab>
          <Tabs.Tab
            value="commission_payment_tracking"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Payment Tracking
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="structures" sx={{ p: 0 }}>
          <CommissionStructureManager />
        </Tabs.Panel>
        <Tabs.Panel value="calculator" sx={{ p: 0 }}>
          <CommissionCalculator />
        </Tabs.Panel>
        <Tabs.Panel value="commission_payment_tracking" sx={{ p: 0 }}>
          <CommissionPaymentTracking />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

// Advanced P&L sub-tabs component
function AdvancedPLTabs() {
  return (
    <div className="flex flex-col h-full">
      <Tabs
        selectedTabScalar="advanced_pl_sub_tab"
        defaultValue="pl_by_jurisdiction"
      >
        <Tabs.List sx={{ pl: 2 }}>
          <Tabs.Tab
            value="pl_by_jurisdiction"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            P&L by Jurisdiction
          </Tabs.Tab>
          <Tabs.Tab
            value="pl_by_researcher"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            P&L by Researcher
          </Tabs.Tab>
          <Tabs.Tab
            value="margin_analysis"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Margin Analysis
          </Tabs.Tab>
          <Tabs.Tab
            value="budget_comparison"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Budget Comparison
          </Tabs.Tab>
          <Tabs.Tab
            value="trial_balance"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Trial Balance
          </Tabs.Tab>
          <Tabs.Tab
            value="balance_sheet"
            sx={{ py: 2, px: 4 }}
            selectedColor="primary"
          >
            Balance Sheet
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="pl_by_jurisdiction" sx={{ p: 0 }}>
          <PLByJurisdiction />
        </Tabs.Panel>
        <Tabs.Panel value="pl_by_researcher" sx={{ p: 0 }}>
          <PLByResearcher />
        </Tabs.Panel>
        <Tabs.Panel value="margin_analysis" sx={{ p: 0 }}>
          <MarginAnalysisTools />
        </Tabs.Panel>
        <Tabs.Panel value="budget_comparison" sx={{ p: 0 }}>
          <BudgetComparison />
        </Tabs.Panel>
        <Tabs.Panel value="trial_balance" sx={{ p: 0 }}>
          <TrialBalanceReport />
        </Tabs.Panel>
        <Tabs.Panel value="balance_sheet" sx={{ p: 0 }}>
          <BalanceSheetReport />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
