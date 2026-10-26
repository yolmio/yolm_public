---
title: Accounting Block
description: "Double-entry accounting block adding GL periods, chart of accounts, invoicing, AR/AP bills, rates, commissions, and reporting UI."
tags:
  - blocks
  - accounting
  - finance
  - reporting
related:
  - blocks/solution_blocks.md
  - concepts/blocks.md
  - ui/blocks_reference.md
---

# Accounting Block

`AccountingBlock` adds a double-entry accounting schema (GL, chart of accounts,
AR invoices, AP bills, payments, rates, commissions, budgets) and zero-prop
admin UI components for a legal-research-services domain (clients,
jurisdictions, researchers, orders, cases). The class is marked `@deprecated`
in source: new systems use `LedgerBlock` (`blocks/ledger`) with
`LedgerDocumentsBlock`, `LedgerBankingBlock` and `LedgerAssetsBlock`.

## Minimal Setup

The constructor takes no options; behavior is data-driven through
configuration tables (`overhead_allocation_rules`,
`financial_report_templates`, `commission_structures`, `tat_pricing`,
`volume_discounts`, ...) that start empty. Prerequisite references resolve at
compile time, so their order relative to `addBlock` does not matter.

```ts
// core.tsx
import { system } from "std/system";
import { AccountingBlock } from "blocks/accounting";

system.addBlock(new AccountingBlock());
// Define the prerequisite tables and enums below anywhere in the same system.
```

Components are not self-routing; wrap each in a `<Route>` or tab, or use the
all-in-one tabbed page:

```tsx
<Route path="/invoicing/generate">
  <AccountingBlock.InvoiceGenerator />
</Route>
<Route path="/" exact>
  <AccountingBlock.AccountingPage />
</Route>
```

## Prerequisites

`initialize()` references tables (`t.fk`) and enums (`t.enum`) it does not
create; Forge validation fails if any is missing. The canonical reference
schema is `examples/accounting/core.tsx`; mirror it.

| Prerequisite | Kind | Columns/values the component SQL reads (representative) |
| --- | --- | --- |
| `clients` | table | `name`, `code`, `email`, address fields, `phone`, `type` (values include `npe`, `pe`, `mx`) |
| `jurisdictions` | table | `name`, `state`, `code` |
| `researchers` | table | `name`, `code`, `is_active` |
| `orders` | table | `order_number`, `matter_number`, `client_id`, `jurisdiction_id`, `researcher_id`, `search_type`, `status` (values include `completed`, `delivered`, `invoiced`), `client_cost`, `completed_at`, `invoice_id`, `researcher_invoiced` |
| `order_cases` | table | `order_id` |
| `employees` | table | referenced by `employee_commissions` and `commission_calculations` |
| `account` | enum | GL account codes for `journal_lines.account`; SQL uses `cash`, `accounts_receivable`, `accounts_payable`, `accrued_expenses`, `researcher_costs`, `revenue` |
| `search_type` | enum | service categories used by rate tables and `missing_rates_log` |

## Tables Created

The block defines all 28 tables below; do not define them yourself (a second
definition is a duplicate-table error). This is package schema, not a pattern
to copy.

| Area | Tables |
| --- | --- |
| General ledger | `gl_periods` (period status, virtual `is_current`), `period_close_tasks`, `chart_of_accounts` (keyed by `account_code` mapping to the `account` enum), `journal_entries`, `journal_lines` (debit/credit check constraints), `budget_entries` |
| AR / AP | `ar_invoices`, `ar_payments`, `ap_bills`, `ap_payments` |
| Order costs | `order_expenses`, `order_case_fees` |
| Rates | `client_rates`, `researcher_rates`, `volume_discounts`, `tat_pricing`, `sliding_scale_rates`, `sliding_scale_tiers`, `client_rate_proposals`, `client_rate_proposal_details`, `missing_rates_log` |
| Commissions | `commission_structures`, `commission_tiers`, `employee_commissions`, `commission_calculations`, `commission_details` |
| Configuration | `overhead_allocation_rules`, `financial_report_templates` |

It also registers 22 enums (statuses and types for the tables above, such as
`invoice_status`, `journal_status`, `commission_type`); do not redefine them.
`account` and `search_type` are prerequisites, not created here.

## Components

Each component is a zero-prop static member of `AccountingBlock`. All except
`AccountingPage` are also named exports of the listed submodule (for example
`import { InvoiceGenerator } from "blocks/accounting/invoicing"`).

| Submodule | Components |
| --- | --- |
| static member only | `AccountingPage` (tabbed page assembling all components) |
| `blocks/accounting/invoicing` | `InvoiceGenerator`, `InvoiceListBrowse`, `InvoiceDetail` |
| `blocks/accounting/billing` | `ResearcherBillGenerator`, `BillApprovalWorkflow`, `ResearcherPaymentTracking` |
| `blocks/accounting/expense_tracking` | `OrderExpenseEntry`, `FeeVerification` |
| `blocks/accounting/financial_reporting` | `PLDashboard`, `PLAnalysis`, `PeriodCloseManager` |
| `blocks/accounting/rates` | `RateDashboard`, `DefaultRatesManager`, `ClientRatesManager`, `MissingRatesManager` |
| `blocks/accounting/rate_management` | `RateCalculatorWizard`, `ClientRateProposals`, `ResearcherRatesManager`, `SlidingScaleRates` |
| `blocks/accounting/commissions` | `CommissionStructureManager`, `CommissionCalculator`, `CommissionPaymentTracking` |
| `blocks/accounting/advanced_reporting` | `PLByJurisdiction`, `PLByResearcher`, `MarginAnalysisTools`, `BudgetComparison`, `TrialBalanceReport`, `BalanceSheetReport` |

The block has no jobs, reactors, APIs, permission references or block
dependencies.

## Gotchas

- `InvoiceDetail` ignores route params and loads the first invoice
  (`select id from db.ar_invoices limit 1`).
- `ResearcherPaymentTracking`'s "Process Payment" action inserts columns that
  do not exist on `journal_entries` (`account`, `amount`, `researcher_id`,
  `ap_bill_id`); routing it, directly or through `AccountingPage`, fails. The
  example app routes individual components and omits it.
- Component SQL hard-codes the example data model, so this is not a generic
  ledger for other domains.
