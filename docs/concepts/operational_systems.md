---
title: Operational System Architecture
description: How to structure large Yolm operational systems with multiple apps, workflow tables, reactors, APIs, admin pages, and tests.
tags:
  - concepts
  - architecture
  - workflows
  - reactors
  - api
related:
  - concepts/apps.md
  - concepts/reactors.md
  - concepts/pipelines.md
  - api/overview.md
  - api/files_blobs_exports.md
  - ui/operational_ui.md
  - ui/mobile_capture_scanning.md
  - testing/overview.md
---

# Operational System Architecture

For large internal systems with many apps, workflows, queues, external
interfaces, audit records, imports, and automation.

## File Layout

Keep each surface in the folder that matches its execution model:

- `core.tsx` defines enums, tables, blocks, scalar functions, and global setup
  such as `system.addDataGridTablesAndEnums(...)`.
- `apps/*.tsx` registers user-facing apps with `system.app`.
- `components/*.tsx` contains app UI assembled from `Data`, `Form`, pages, and
  reusable components.
- `apis/*.ts` defines HTTP endpoints with `system.api(...)`.
- `reactors/*.ts` defines background workflow processors with
  `system.addReactor(...)`.
- `scheduled/*.ts` defines time-based procedures.
- `pipelines/*.ts` defines import, seed, and setup flows with
  `system.addPipeline(...)`.
- `templates/*.typ` contains Typst templates for generated documents.
- `procedures/*.ts` holds stored procedures for shared runtime logic;
  `shared/*.ts` holds generation-time statement builders and UI helpers.
- `tests/*.ts` covers workflows, APIs, reactors, and accounting-style side
  effects.

Prefer small workflow-area files. Put helpers in `shared/` only when multiple
apps, APIs, reactors, or tests need them.

## Schema Shape

Keep the schema minimal: add a table or field only when a concrete writer and
reader need it, because a removed field leaves an orphaned slot and its data
until a transform. Typically that means status enums for lifecycle state, the business
records and line items users actually edit, and blob hash fields for uploads and
generated documents.

Do not store what can be derived. Compute totals, statuses, and rollups with
queries, virtual fields, or views. Use
[transaction queries](../sql/transaction_queries.md) for audit history instead
of activity log tables, procedure tables for import staging, and the
[outbox](./outbox.md) for deferred outbound work and retries.

Use table and field descriptions for business meaning, not implementation
notes. Put transient UI state in `ui.*` or `Data local`; do not add persistent
columns for open dialogs, selected rows, filters, or page-local state.

## Workflow Pattern

For each workflow, define the durable state first:

1. Identify the lifecycle enum and the table that owns it.
2. Enable [transaction queries](../sql/transaction_queries.md) if users or
   automation need an audit trail, and use the [outbox](./outbox.md) when
   outbound work can be retried or delayed.
3. Implement the write path with a stored procedure or `Form` submit hook.
4. Implement automation with reactors that select only ready rows.
5. Build queue/detail UI that exposes the current state and recovery actions.
6. Where a workflow needs a test (see [Tests](../ai/review.md#tests)), seed
   the minimum data, trigger the workflow, call `s.flushReactors()` when
   needed, and assert the business outcome.

Keep reactor queries idempotent: the procedure must update state so processed
rows no longer match, or it must record attempts and retry windows explicitly.

## Apps And Access

Split apps when roles, navigation, permissions, or task density differ.
Register each app separately, wrap it in auth, and keep routes obvious:

```tsx
system.app({
  domain: "operations.example.com",
  ui: (
    <AuthBlock.DefaultEmailOtpAuth requiredPermission="can_access_operations">
      <AppRoutes>
        <Route path="/">
          <OperationsDashboard />
        </Route>
        <RecordPage path="/orders/{record_id:id}" table="orders" />
      </AppRoutes>
    </AuthBlock.DefaultEmailOtpAuth>
  ),
});
```

Use `system.addDataGridTablesAndEnums(["orders", "clients"])` when
`DatagridPage` views should support saved view names for those tables.

For multi-app systems (office, sales, estimating, reporting, mobile loader):

1. Define shared schema and blocks in `core.tsx`:
   `AuthBlock`, `WorkforceBlock`, CRM/email blocks, static secrets, table
   blocks, enums, and workflow tables.
2. Add shared API factories for cross-app file/photo endpoints; call them from
   each app domain that needs them.
3. Build each app as a thin shell around a role-specific layout:
   auth wrapper, `AppRoutes`, sidebar or mobile layout, and PWA/app assets.
4. Put reusable workflow logic in stored procedures in `procedures/` before UI,
   APIs, reactors, and tests use it; keep `shared/*_sql.ts` for query builders.
5. Add mobile capture flows with [Mobile Capture And Scanning](../ui/mobile_capture_scanning.md),
   blob/photo endpoints with [Files, Blobs, And Exports](../api/files_blobs_exports.md),
   and app manifests/modules with [Apps](./apps.md) and
   [JS Modules](../ui/js_modules.md).
6. Add tests where they catch real regressions (see
   [Tests](../ai/review.md#tests)), such as business rules in APIs,
   calculations, and scan/restore flows.

## External Interfaces

For external systems, keep integration state explicit:

- write only the business rows a request changes; use
  [transaction queries](../sql/transaction_queries.md) to see what each request
  changed instead of raw payload log tables,
- normalize JSON/XML into typed tables before workflow reactors consume it,
- read provider credentials from static secrets (`getStaticSecret`), never from
  database tables,
- route outbound work through the [outbox](./outbox.md), which tracks status,
  retries, and errors,
- separate endpoint parsing from domain workflow updates where possible.

Use `api/external_interfaces.md` for XML/JSON API and outbound request patterns.
Use `api/files_blobs_exports.md` for uploads, images, PDFs, ZIPs, and print
queues.

## Agent Build Sequence

When building a system from docs, exported TypeScript types, and examples:

1. Read `core.tsx` requirements as a schema and workflow inventory.
2. Define enums and tables before UI.
3. Add blocks and admin pages only where they directly support the workflow.
4. Implement stored procedures before reactors and UI actions reuse them.
5. Build APIs and imports against raw payload samples, then normalize.
6. Build role apps with route shells, then fill queue/detail workflows.
7. Add focused tests for business rules nothing else covers, such as
   lifecycle invariants and ledger postings (see
   [Tests](../ai/review.md#tests)).
8. Run Forge validation early and repeatedly; use exported TypeScript types for
   exact props.
