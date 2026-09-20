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

`AccountingBlock` adds a double-entry accounting layer to a system: it creates
the financial schema (general ledger, chart of accounts, invoices, bills,
payments, rates, commissions, budgets) and ships ready-made admin UI components
for invoicing, billing, rate management, period close, commissions, and
P&L / balance-sheet reporting.

Use it when you want a turnkey back-office accounting module on top of an
existing operational schema. It is purpose-built for a legal-research-services
domain (clients, jurisdictions, researchers, orders, cases). If your domain
differs substantially, prefer building custom schema instead — the components
hard-code that data model in their SQL.

```ts
import { AccountingBlock } from "blocks/accounting";
```

## Minimal Setup

`AccountingBlock` takes no constructor options. Register it with
`system.addBlock`. `addBlock` runs the block's `initialize()` immediately, but
the block's foreign-key and enum references to consumer tables/enums are
resolved at compile time — so the prerequisite tables and enums (see
[Prerequisites](#prerequisites)) only need to exist **somewhere in the same
system**, regardless of whether they are defined before or after the
`addBlock` call.

```ts
// core.tsx
import { system } from "std/system";
import { AccountingBlock } from "blocks/accounting";
import { sql } from "std/sql_utils";

system.addBlock(new AccountingBlock());

const { db } = system;

// Define prerequisite enums and tables (clients, jurisdictions, researchers,
// orders, order_cases, employees, plus the `account` and `search_type` enums).
// Order relative to addBlock does not matter — see Prerequisites below.
```

Render a component from any app `.tsx` by routing it yourself. The static
members are plain components, not self-routing pages, so you wrap them in a
`<Route>`:

```tsx
// apps/<domain>.tsx
import { AppRoutes, Route } from "std/ui";
import { AccountingBlock } from "blocks/accounting";

const routes = (
  <AppRoutes>
    <Route path="/invoicing/generate">
      <AccountingBlock.InvoiceGenerator />
    </Route>
    <Route path="/financial/pl-dashboard">
      <AccountingBlock.PLDashboard />
    </Route>
  </AppRoutes>
);
```

Or drop the all-in-one tabbed page that assembles every component:

```tsx
<Route path="/" exact>
  <AccountingBlock.AccountingPage />
</Route>
```

## Configuration

`AccountingBlock` has **no constructor options** — instantiate it with
`new AccountingBlock()`. Behavior that other systems expose as options is
data-driven here: the block creates configuration tables
(`overhead_allocation_rules`, `financial_report_templates`,
`commission_structures`, `tat_pricing`, `volume_discounts`, etc.) which start
empty; you populate them with your own data.

## Prerequisites

`initialize()` references external tables (via `t.fk`) and external enums (via
`t.enum`) that the block does **not** create. Every referenced table and enum
must be defined somewhere in the same system or Forge validation fails at
compile time. The canonical reference schema is `examples/accounting/core.tsx`.

Required tables (referenced by `t.fk`):

| Prerequisite | Kind | Notes |
| --- | --- | --- |
| `clients` | table | invoicing/AR; components also read `name`, `code`, `email`, `address_line_1`, `address_line_2`, `city`, `state`, `postal_code`, `phone`, `type` |
| `jurisdictions` | table | components read `name`, `state` (and `code`) |
| `researchers` | table | components read `name`, `code`, `is_active` |
| `orders` | table | components read `order_number`, `matter_number`, `client_id`, `jurisdiction_id`, `researcher_id`, `search_type`, `status`, `client_cost`, `completed_at`, `invoice_id`, `researcher_invoiced` |
| `order_cases` | table | components read `order_id` |
| `employees` | table | referenced by `employee_commissions` and `commission_calculations` |

Required enums (referenced by `t.enum`):

| Prerequisite | Kind | Notes |
| --- | --- | --- |
| `account` | enum | GL account codes used by `journal_lines.account` (component SQL uses values `cash`, `accounts_receivable`, `accounts_payable`, `accrued_expenses`, `researcher_costs`, `revenue`) |
| `search_type` | enum | service search categories; used by `missing_rates_log`, `client_rates`, `researcher_rates`, `client_rate_proposal_details` |

The required-columns notes above are representative (inferred from component and
`initialize()` SQL), not exhaustive. Beyond the FK/enum references that gate
compilation, the component SQL also assumes the `orders.status` value set
includes `completed`, `delivered`, and `invoiced`, and that `clients.type`
includes `npe`, `pe`, and `mx`. Mirror `examples/accounting/core.tsx` to
satisfy these.

## Tables Created

The block creates the 28 tables below. Do **not** define them yourself. (The
source comments at the top of `index.tsx` claiming some of these "already
exist" are outdated — the block owns them; redefining one causes a
duplicate-table error.)

| Table | Purpose |
| --- | --- |
| `gl_periods` | Accounting periods with close checklist + status (`gl_period_status`); has virtual `is_current` |
| `chart_of_accounts` | GL account master keyed by `account_code` (maps to the `account` enum); type, category, normal balance, hierarchy |
| `overhead_allocation_rules` | Rules for allocating overhead to jurisdictions/clients/researchers |
| `financial_report_templates` | Configurable P&L / report layouts |
| `missing_rates_log` | Records rate lookups that found no match |
| `period_close_tasks` | Checklist items per `gl_period` |
| `ar_invoices` | Client invoices (`invoice_status`) |
| `ar_payments` | Client payment records (`payment_status`) |
| `ap_bills` | Researcher/vendor bills (`bill_status`) |
| `ap_payments` | Researcher payment records (`ap_payment_status`) |
| `order_expenses` | Per-order expenses (incurred / billed / paid-to-researcher) |
| `order_case_fees` | Per-case fees (`case_fee_type`) |
| `journal_entries` | GL entry headers (`journal_entry_type`, `journal_status`) |
| `journal_lines` | GL line items with `account` + client/jurisdiction/researcher dimensions; check constraints enforce debit/credit |
| `client_rates` | Client billing rates |
| `researcher_rates` | Researcher cost rates |
| `volume_discounts` | Volume-based discount tiers |
| `tat_pricing` | Turn-around-time pricing tiers (`tat_type`) |
| `client_rate_proposals` | Proposed rate changes (`rate_proposal_status`) |
| `client_rate_proposal_details` | Line items within a proposal |
| `sliding_scale_rates` | Sliding-scale rate configs (`sliding_scale_type`) |
| `sliding_scale_tiers` | Tiers within a sliding scale |
| `commission_structures` | Commission plans (`commission_type`) |
| `commission_tiers` | Tiered commission rates |
| `employee_commissions` | Commission assignments per employee |
| `commission_calculations` | Calculated commissions (`commission_status`) |
| `commission_details` | Line items behind a calculation |
| `budget_entries` | Budget amounts per account/period |

## Enums Created

The block registers these 22 enums via `system.enum_`. Do not redefine them:

`rate_proposal_status`, `tat_type`, `sliding_scale_type`, `gl_period_status`,
`account_type`, `account_category`, `balance_side`, `rate_calculation_method`,
`allocation_basis`, `allocation_frequency`, `report_type`,
`period_close_task_status`, `invoice_status`, `payment_status`, `bill_status`,
`ap_payment_status`, `commission_type`, `commission_status`,
`order_expense_type`, `case_fee_type`, `journal_entry_type`, `journal_status`.

The `account` and `search_type` enums are **not** created here — they are
consumer prerequisites (see [Prerequisites](#prerequisites)).

## Components

Every UI component is exposed as a static member of `AccountingBlock`
(e.g. `<AccountingBlock.InvoiceGenerator />`). All are **zero-prop** function
components — they manage their own `Data` state and SQL internally. They are
**not self-routing**: place each one inside a `<Route>` or layout/tab yourself.

The 28 individual components can alternatively be imported from their
submodules, e.g.
`import { InvoiceGenerator } from "blocks/accounting/invoicing";`.
`AccountingPage` is the exception: it is **only** available as the static member
`AccountingBlock.AccountingPage` (it is not an importable named export).

| Component | Submodule path | Purpose |
| --- | --- | --- |
| `AccountingBlock.AccountingPage` | static member only | All-in-one tabbed page assembling every component below |
| `AccountingBlock.InvoiceGenerator` | `blocks/accounting/invoicing` | Generate client invoices from billable orders |
| `AccountingBlock.InvoiceListBrowse` | `blocks/accounting/invoicing` | Browse the invoice list |
| `AccountingBlock.InvoiceDetail` | `blocks/accounting/invoicing` | Single-invoice detail with send / record-payment actions |
| `AccountingBlock.ResearcherBillGenerator` | `blocks/accounting/billing` | Build researcher (AP) bills from unbilled orders |
| `AccountingBlock.BillApprovalWorkflow` | `blocks/accounting/billing` | Approve / dispute pending bills |
| `AccountingBlock.ResearcherPaymentTracking` | `blocks/accounting/billing` | Track and process researcher payments (see caveat below) |
| `AccountingBlock.OrderExpenseEntry` | `blocks/accounting/expense_tracking` | Enter order expenses, case fees, surcharges |
| `AccountingBlock.FeeVerification` | `blocks/accounting/expense_tracking` | Verify calculated fees / margins per order |
| `AccountingBlock.PLDashboard` | `blocks/accounting/financial_reporting` | Profit & loss dashboard |
| `AccountingBlock.PLAnalysis` | `blocks/accounting/financial_reporting` | Detailed P&L analysis |
| `AccountingBlock.PeriodCloseManager` | `blocks/accounting/financial_reporting` | Manage GL period close checklist |
| `AccountingBlock.RateDashboard` | `blocks/accounting/rates` | Rate overview dashboard |
| `AccountingBlock.DefaultRatesManager` | `blocks/accounting/rates` | Manage default client rates |
| `AccountingBlock.ClientRatesManager` | `blocks/accounting/rates` | Manage per-client rates |
| `AccountingBlock.MissingRatesManager` | `blocks/accounting/rates` | Resolve missing-rate lookups |
| `AccountingBlock.RateCalculatorWizard` | `blocks/accounting/rate_management` | Calculate an order rate |
| `AccountingBlock.ClientRateProposals` | `blocks/accounting/rate_management` | Create / track rate-change proposals |
| `AccountingBlock.ResearcherRatesManager` | `blocks/accounting/rate_management` | Manage researcher cost rates |
| `AccountingBlock.SlidingScaleRates` | `blocks/accounting/rate_management` | Configure sliding-scale rates |
| `AccountingBlock.CommissionStructureManager` | `blocks/accounting/commissions` | Define commission structures and tiers |
| `AccountingBlock.CommissionCalculator` | `blocks/accounting/commissions` | Calculate employee commissions |
| `AccountingBlock.CommissionPaymentTracking` | `blocks/accounting/commissions` | Approve and pay commissions |
| `AccountingBlock.PLByJurisdiction` | `blocks/accounting/advanced_reporting` | P&L grouped by jurisdiction |
| `AccountingBlock.PLByResearcher` | `blocks/accounting/advanced_reporting` | P&L grouped by researcher |
| `AccountingBlock.MarginAnalysisTools` | `blocks/accounting/advanced_reporting` | Margin analysis / low-margin orders |
| `AccountingBlock.BudgetComparison` | `blocks/accounting/advanced_reporting` | Budget vs. actual |
| `AccountingBlock.TrialBalanceReport` | `blocks/accounting/advanced_reporting` | Trial balance with balance check |
| `AccountingBlock.BalanceSheetReport` | `blocks/accounting/advanced_reporting` | Balance sheet with assets/liabilities/equity |

Caveats in the current source:

- `AccountingBlock.InvoiceDetail` ignores route params. It loads the first
  invoice (`select id from db.ar_invoices limit 1`, with a "would come from
  route params" comment) rather than reading a `record_id`, even when routed
  under a path like `/invoicing/detail/{record_id:id}`.
- `AccountingBlock.ResearcherPaymentTracking`'s "Process Payment" action inserts
  into `db.journal_entries` columns that do not exist on the table (`account`,
  `amount`, `researcher_id`, `ap_bill_id`). The example app does not route this
  component, so the broken handler is never compiled there; routing it and
  invoking Process Payment will fail to compile/run.

There are no scheduled jobs, reactors, APIs, or permission references in this
block, and it declares no block dependencies (`componentDependencies = []`).

## Common Mistakes

- Failing to define a prerequisite table or enum anywhere in the system. Order
  relative to `addBlock` does not matter (FK/enum references resolve at compile
  time), but `clients`, `jurisdictions`, `researchers`, `orders`,
  `order_cases`, `employees` and the `account` and `search_type` enums must
  exist somewhere or Forge validation fails.
- Re-defining tables the block owns (`journal_entries`, `journal_lines`,
  `ar_invoices`, `ap_bills`, `client_rates`, etc.). The block creates all 28
  tables itself; defining one again causes a duplicate-table error.
- Looking for constructor options. There are none — configure behavior through
  the data-driven config tables instead.
- Wrapping the components as if they were self-routing pages. They are plain
  zero-prop components; you supply the `<Route>` or tab.
  (`AccountingBlock.AccountingPage` provides the full tabbed UI if you want
  everything at once.)
- Expecting `AccountingBlock.InvoiceDetail` to read a route `record_id`. As
  written it loads the first invoice; it does not consume route params.
- Using this block in a non-research-services domain. Its component SQL
  hard-codes the example data model (order/client/researcher/case columns,
  client-type and order-status values), so it is not a generic ledger for
  arbitrary schemas.
</content>
</invoke>
