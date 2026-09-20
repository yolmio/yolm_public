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
- `procedures/*.ts` and `shared/*.ts` hold reusable procedure helpers and UI
  helpers.
- `tests/*.ts` covers workflows, APIs, reactors, and accounting-style side
  effects.

Prefer small workflow-area files. Put helpers in `shared/` only when multiple
apps, APIs, reactors, or tests need them.

## Schema Shape

Operational schemas often need:

- status enums for lifecycle state,
- activity log tables for audit history,
- queue tables for deferred work and retries,
- configuration tables for client, provider, rate, rule, or jurisdiction data,
- line-item tables for fees, ledger entries, invoices, or other calculations,
- import tables for raw inbound payloads and normalized staging rows,
- error or exception tables that make failed automation visible in the UI.
- blob hash fields for uploaded images, generated PDFs, and attachments.
- print/export queues when physical devices or external workers consume work.

Use table and field descriptions for business meaning, not implementation
notes. Put transient UI state in `ui.*` or `Data local`; do not add persistent
columns for open dialogs, selected rows, filters, or page-local state.

## Workflow Pattern

For each workflow, define the durable state first:

1. Identify the lifecycle enum and the table that owns it.
2. Add an activity log if users or automation need an audit trail.
3. Add queue/error tables if work can be retried, delayed, or inspected.
4. Implement the write path with a procedure helper or `Form` submit hook.
5. Implement automation with reactors that select only ready rows.
6. Build queue/detail UI that exposes the current state and recovery actions.
7. Add tests that seed the minimum data, trigger the workflow, call
   `s.flushReactors()` when needed, and assert all durable side effects.

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
4. Put reusable workflow logic in `procedures/` or `shared/*_sql.ts` before UI,
   APIs, reactors, and tests use it.
5. Add mobile capture flows with [Mobile Capture And Scanning](../ui/mobile_capture_scanning.md),
   blob/photo endpoints with [Files, Blobs, And Exports](../api/files_blobs_exports.md),
   and app manifests/modules with [Apps](./apps.md) and
   [JS Modules](../ui/js_modules.md).
6. Add tests for API endpoints, calculation helpers, scan/restore flows,
   print queues, and transform helpers as each workflow becomes durable.

## External Interfaces

For external systems, keep integration state explicit:

- log raw request/response payloads when audit or replay matters,
- normalize JSON/XML into typed tables before workflow reactors consume it,
- store provider credentials in secrets or configuration tables,
- route outbound work through queue tables with attempt counts and last errors,
- separate endpoint parsing from domain workflow updates where possible.

Use `api/external_interfaces.md` for XML/JSON API and outbound request patterns.
Use `api/files_blobs_exports.md` for uploads, images, PDFs, ZIPs, and print
queues.

## Agent Build Sequence

When building a system from docs, exported TypeScript types, and examples:

1. Read `core.tsx` requirements as a schema and workflow inventory.
2. Define enums and tables before UI.
3. Add blocks and admin pages only where they directly support the workflow.
4. Implement procedure helpers before reactors and UI actions reuse them.
5. Build APIs and imports against raw payload samples, then normalize.
6. Build role apps with route shells, then fill queue/detail workflows.
7. Add focused tests for each lifecycle transition, reactor, API, and ledger or
   audit side effect.
8. Run Forge validation early and repeatedly; use exported TypeScript types for
   exact props.
