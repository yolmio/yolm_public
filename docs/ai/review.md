---
title: AI Code Review Guidelines
description: "Use when reviewing Yolm code or finishing a larger change: the review-fix loop sized to the change, triage, and what to check."
tags: [ai, skill, review, maintainability, schema]
related:
  - ai/system_review.md
  - coding/index.md
  - coding/solution_principles.md
  - database/best_practices.md
  - sql/query_planning.md
  - procedures/occ.md
---

# AI Code Review

The core rubric for requested reviews and for the review-fix loop that finishes
a larger change. Deployed systems add `docs/ai/system_review.md`.

## Change Size: Verification And Review

**Minor change**: a small UI fix or logic change that will not noticeably
affect performance or user workflows, such as styling, copy, a condition, or a
contained query tweak. Run `validate()` and the tests covering the touched
code, re-read the diff, and look once in a preview if it is visible. Nothing
more: no review loop, and no new test unless [Tests](#tests) calls for one.

**Larger change**: a new feature or flow, schema, a procedure, an API, several
files, a workflow users rely on, performance-sensitive queries, or anything
hard to undo. Retest everything it can affect:

- Run `validate()` and the relevant tests, broadening with the change.
- Use a recent production snapshot; fixture data rarely shows real performance
  or edge cases. Check which database the preview uses and when it was taken:
  an existing preview keeps its database, and a new system may have only
  fixtures. If the snapshot is old (a week, say) or lacks the data the change
  or bug depends on, ask the user before relying on it.
- Click through affected and adjacent workflows as a user would.
- Check timings against [Performance](#performance) and the original version.
- Verify writes independently (for example with `queryPreview`).
- Run [the review-fix loop](#the-review-fix-loop).

`docs/ai/forge_testing.md` and `docs/ai/forge_preview.md` cover the tools. When
the user needs a fix now, validate the affected path narrowly and say what was
not verified.

**Requested review**: report-only unless fixes are asked for
([Fix Mode](#fix-mode)).

**Cleanup is its own task.** A change does only what was requested. Report
pre-existing problems instead of fixing them inside other work; clean up only
when the user asks, as an explicit task using this document.

## The Review-Fix Loop

1. Review the whole diff against [What To Look For](#what-to-look-for), in a
   fresh-context subagent if available. Give it the diff, the request and this
   document, not your conclusions.
2. [Triage](#triage-findings) each finding.
3. Before fixing, ask whether a simpler design makes the finding disappear. A
   loop that keeps adding edge-case machinery means the design is wrong.
4. Fix, re-verify the affected behavior, and review again.
5. Stop when no actionable finding caused by the change remains. If passes
   reverse earlier fixes or repeat speculation, stop and ask the user about
   the disputed requirement.

Finish with a simplicity pass: can anything now be deleted? If so, delete it,
re-verify, and review once more.

## Triage Findings

A finding is actionable only with a concrete condition, consequence, location,
and evidence: a code path, query, plan, test, or observed run.

- **Fix**: caused by this change.
- **Report, don't fix**: pre-existing problems, even in touched files.
- **Drop**: imagined risks, unreachable states, attacks needing access the
  actor already has, "could be cleaner" with no concrete cost, and
  hypothetical future callers.

Don't inflate severity to justify a fix.

## What To Look For

The reviewed scope is every file the diff touches (whole files) or the named
artifact for a whole-artifact review. Requested reviews and cleanup tasks
report pre-existing dead code, unused fields, and needless complexity in that
scope; the review-fix loop for your own change fixes only what it caused.

### Scope

- Does what was asked and nothing more: no unrequested features, stats,
  settings, guards, preflight checks, logging, tests, or commits. A question
  was answered, not acted on; a plan or investigation made no changes.
- Existing behavior is preserved. Ported or legacy-parity work matches the
  reference exactly and adds no logic it lacks.

### Simplicity And Code Paths

Minimize the resulting implementation, not just the diff: a larger change that
removes a path beats a small one that adds a parallel one.

- One path per behavior: change the owning code and delete what it replaces.
  Flag duplicate workflows, special cases, flags, and modes.
- No legacy or compatibility shims, fallbacks, deprecated aliases, or "just
  in case" code. Fix logic going forward instead of adding repair paths; change
  deployed data through the deploy process in `docs/ai/forge_schema.md`.
- No guards for unreachable states: show how the invalid state reaches the
  boundary. Validate external input, permissions, and concurrent database
  state on the server; do not re-check what types or earlier code exclude.
- No speculative props, options, or abstractions without a caller today.
- No dead code (unused imports, exports, scalars, UI state, props, enums,
  fields, commented-out code), debug output, or temporary scaffolding.
- Fix root causes at the owning layer; a downstream patch over an upstream bug
  is a finding, and a generic platform or package problem is fixed in the
  package, not worked around per system.

### Reuse

- Prefer documented primitives (`Data`, `Form`, `ActionButton`, blocks,
  components, existing tables, built-in SQL functions) over reimplementations;
  see `docs/coding/solution_principles.md`. Search before accepting new
  machinery.
- Flag notes, JSON blobs, or text fields standing in for an existing table.

### Stored Procedures And Generated Code

Server logic belongs in stored procedures by default. They compile separately
and in parallel instead of re-expanding inline wherever used, can be tested
directly, and make reuse explicit. Anything reused, or likely to be, is a
stored procedure; only one-off glue stays inline.

Apply [Own The Generated-Code Cost](./forge_procedures.md#own-the-generated-code-cost)
to server hooks, actions, and reusable components: trace generated copies across
options, routes, and nested TypeScript helpers, which do not create runtime
boundaries. Source reuse is not compiled-code reuse, and many small procedures
can still duplicate substantial work. Flag substantial repeated server bodies as
performance findings, judged by generated size and compile cost. Extraction must
preserve transaction ownership, callback order, validation, rollback, results,
and side effects. When compile limits are at risk, cite a compilation-budget
result; an untimed JIT check is not one. A change must not add such duplication;
pre-existing duplication is reported.

### Database And Schema

Review schema hardest; it is the costliest to change.

- Every table and field needs a reader and a writer; otherwise flag it as
  major. Rich structure that models the domain is fine; speculative structure
  is not.
- Flag stored derived data as major: totals, counts, balances, rollups, a
  status restated by booleans or `*_at` fields, keys copied from a parent, and
  per-channel column sets. Live aggregates and correlated subqueries are
  usually cheap ([Performance](#performance)). Accept only authoritative
  state, deliberate historical snapshots (an invoice line's price), or results
  measured as expensive after query-shape fixes, with the plan or timing cited
  and the user's approval as a schema change.
- Flag surrogate IDs, request/idempotency/correlation keys, and outbox tables
  that nothing needs.
- Flag audit, activity-log, and error-log tables that transaction queries
  cover. A durable record of a failed, rolled-back request is legitimate,
  since the rollback keeps it out of transaction history.
- Provenance fields (`created_at`, `created_by`, `last_modified_at`,
  `modified_by`) only where the UI or logic reads them; otherwise the
  transaction log covers forensics, unless the table uses `autoCompact`.
- New fields are nullable unless a required field is truly needed and its
  deploy class is understood.
- Add `recordDisplayName()` to tables used in dropdowns, links, or foreign keys,
  unless a block manages the table or it has `name`, `first_name`+`last_name`,
  or `title`. Never include `id`.
- String fields define `maxLength`; types and foreign keys follow
  `docs/database/best_practices.md`.

### Correctness

- Imports: every used symbol is imported from its correct package (e.g.
  `import { Data } from "std/data";`), with no wildcard paths and with
  `import type` for type-only imports.
- No JS-only constructs in runtime logic; runtime data lives in scalars,
  records, and tables accessed through SQL.
- State scopes: persistent data in `db.*`, transient UI state in `ui.*`,
  execution-local state in procedure scope.
- SQL only through `sql`, `sql.lit`, and `sql.ref`; never concatenation.
- Multi-step writes are transactional where partial progress would corrupt
  state.
- Components receive their required props.
- Authorization and authoritative validation happen on the server.

### Performance

The engine is columnar, vectorized, and morsel-parallel with zone maps, bloom
filters, and runtime pruning; procedures and server rendering are
JIT-compiled. Row-store expectations are far too slow. Reference numbers from
a production system with 23M orders and 28M notes:

| Work | Typical time |
|---|---|
| Full page or API call, p50 / p90 | 15 ms / 46 ms |
| Complex work-queue page | ~90 ms |
| Point lookup by key | <1 ms CPU |
| Filtered aggregate over millions of rows | 4–8 ms |
| Full-table group by over 23M rows | ~300 ms |

A page or query over ~100 ms is a finding to explain, not "fine"; most should
be far under it. Heavy analytics, such as aggregating 100M rows or joining
tens of millions with complex aggregates, are judged case by case.

Shape matters more than intuition. In that system a correlated note count for
29k recent orders took 2.7 s because the planner misestimated the date filter
and aggregated all 28M notes; as an `IN` subquery, or with the limit applied
first, it took 9 ms. Correlated SQL is neither bad nor automatically fast.
Read the plan.

- For queries on large tables, follow `docs/sql/query_planning.md`: engine
  tier, direct pruning predicates, caller cardinality, and estimated versus
  actual rows.
- Prefer set-based work, narrow projections, and early filters; check hot
  loops and per-row queries.
- Measure at realistic cardinality on a production snapshot, with
  `queryProduction` (`metrics: true`, `explain: true`), or with
  `yolm query --explain`, using real route parameters and user. Try a simpler
  shape before caches or stored rollups.
- Changes to joins, `OR` eligibility predicates, per-row reads, or work-queue
  checks on large tables need a plan and timing, even inside feature or
  correctness work.
- Existing pages and endpoints must not get slower; compare production
  metrics where available.
- No unbounded memory or runaway CPU; no debug builds for performance claims.

### Transactions And OCC

For write paths, apply [OCC and transaction patterns](../procedures/occ.md).
Trace the actual transaction owner through UI/API wrappers and stored
procedures, then check:

- **Retry boundary**: pre-transaction candidates are stale on replay.
  Revalidate permissions, ownership, eligibility, and required membership or
  absence inside the transaction; dependent writes use the accepted set.
- **Footprint**: no needless broad reads, repeated key lookups,
  insert-then-update, parsing, or response building inside transactions.
  Claimed gains need plan or conflict evidence.
- **Bounded work** that keeps the command atomic; caller-owned helper
  extraction does not shrink a transaction.
- **Generated IDs**: use `RETURNING`; keep insert destinations separate from
  existing-ID or scratch cells until commit; do not assume provisional IDs are
  fixed up or that every `RETURNING` use avoids append conflicts. Preserve
  responses for null, malformed, and missing keys.
- **Replay-safe effects**: external calls outside the transaction,
  idempotency or outbox only where an external contract needs it, and no stale
  success after a failed claim. Verify concurrent writers and per-record
  relationships.
- **Partial progress**: when items commit separately, a terminal failure must
  not hide earlier commits. Check the catch boundary, refresh on failure,
  retry only still-eligible work, and count outcomes after commit.
- **Catch cleanup**: catching does not roll back. An owning boundary calls
  `rollbackIfInTransaction()` before a catch starts a logging transaction,
  including through helpers. Verify by forcing a failure after a write that
  the rollback happens, the original error surfaces, and the failure is
  recorded; commit a test when fixing a real bug here. See
  [transaction cleanup](../api/external_interfaces.md#transaction-cleanup-in-error-handlers).

### Reactors And Background Integrations

For reactors, scheduled procedures, webhook workers, reconciliation, and
background integrations, treat request cardinality, memory and CPU bounds,
durable progress, retries, and Forge execution evidence as correctness
requirements.

### UX

Judge UI for its users and device:

- Back-office screens for professionals: dense and efficient, like a good
  spreadsheet, with few clicks and little scrolling for the daily task.
- Shop-floor, kiosk, and mobile: large touch targets, few clear options,
  readable at a distance.
- Public sites and portals: follow the brand and audience.

Then check:

- Cut taglines, helper text and secondary labels; if a screen needs them to
  make sense, fix the layout. Keep field labels, units, constraints, errors,
  and consequences of actions.
- No decorative badges, icons, or color unless informative or actionable.
- Clear hierarchy and grouping, one obvious next action, no competing controls
  or unnecessary steps.
- Consistent with the system's existing screens; daily workflows keep working
  the way users know.
- Review screenshots with realistic data, as someone who did not build it. A
  passing browser assertion does not show that a screen makes sense.
- Pages are mostly composition, with UI state minimal and derived where
  possible. `DataTablePage` takes toolbar content directly through `toolbar`
  (no wrapper component) and bulk delete through `deletable`.
- Apply [Interactive request cost](#interactive-request-cost) to selectors and
  event handlers; report pre-existing issues in touched components.

#### Interactive request cost

Needless round trips are performance findings even when each query is fast. A
dropdown is not automatically a server search because its options came from
the database.

- Count requests across the whole interaction: focus, open, each keystroke,
  selection, blur, Enter/Tab, dependent fields, save, and refetch, including
  callbacks hidden in helpers. Look for per-keystroke reads, refetching loaded
  rows, catalogs duplicated per field or row, and global refetches after
  UI-only edits.
- Small bounded reference catalogs load once, with only permitted rows and
  needed columns, in the nearest shared UI scope and filter locally
  (`QueryCombobox local` for UI-table queries). Reload on navigation, parent
  change, successful mutation, or explicit refresh; do not cache indefinitely,
  leak rows across permissions, or preload large business tables.
- Large or volatile searches stay on the server with measured justification:
  bounded results, debounced typing, and stale or failed responses never
  replacing newer input or becoming an Enter/Tab selection. A `limit 50` does
  not bound the requests needed to find those rows.
- Date and range filters keep drafts local and apply on an intentional
  boundary, skipping unchanged filters and preserving clearing, URL
  restoration, and export agreement. Native date inputs fire events for
  intermediate years; renaming events or debouncing is not a commit boundary.
  Test editing single date segments.
- Fewer requests do not excuse an expensive remaining query; check rows,
  counts, options, and exports separately, with exact results and block-work
  bounds, not just elapsed time. Repeated latest-row probes can revisit the
  same blocks per consumer; keep future rows that can disqualify a result.
- Measure the whole cost, including initial catalog load, payload, refresh,
  and client filtering.
- Moving a read to the browser keeps authorization and write validation on
  the server and preserves filtering, ranking, NULL and custom values, focus,
  and saved effects.
- Verify in a preview: type sequentially, edit, paste, select by keyboard and
  mouse, change the parent scope, press Enter/Tab immediately, delay server
  responses, and reopen saved values in both add and edit consumers. Check
  request counts as well as results; loaded local catalogs issue zero lookup
  requests. Shared control behavior is tested once in `packages/components`;
  add a system test only for that system's own wiring bug.

In fix mode, report before/after request counts with behavioral evidence; a
successful HTTP response does not prove a responsive or correct interaction.

### Spark Capabilities

Review against `docs/ai/forge_spark.md`: reads prefer tables, then column
whitelists or blacklists, then views and functions; writes are generic,
set-based, and reversible where constraints and an editable-state guard
prevent invalid states;
approval mode is for external effects and released or critical state. Flag
narrow single-field actions and bespoke read functions a table grant covers.

### Tests

A retained test must catch a realistic regression in production behavior that
nothing else catches.

- For a bug fix, prefer a test that fails before the fix; platform bugs get an
  internal reproduction test. Small changes usually need no new test.
- Flag tests that assert fixture contents, test a copy of production logic,
  freeze incidental wording or call shapes, cover impossible states, or
  duplicate another test.
- Shared component and block behavior is tested once in its package; system
  tests cover that system's rules, permissions, and wiring.
- Extend the owning test before adding a file. Tests must run for other
  developers, without local-only files.

### Verification Evidence

- The change was exercised the way users reach it: a preview with realistic
  data, a real API call, or a production-sized query.
- The report says what was and was not verified; missing evidence is an open
  item, not a clean result.

### Consistency

- Follow `docs/coding/index.md` and `docs/coding/imports.md`.
- Import table blocks from `'table_blocks/NAME'` and blocks from
  `"blocks/NAME"`, once each; use block UI through its namespace
  (`<SchedulingBlock.AppointmentsPage />`); import a dependent block only when
  used directly.

## Severity

Rank by cost to change later and user impact:

1. **Schema**: highest. Deployed schema consumes durable physical IDs, removed
   fields linger as orphaned data until a transform, backfills rewrite data,
   and incompatible changes need a transform or database swap. A questionable
   table or field is **major** even when it works.
2. **Procedures, APIs, reactors**: medium; callers and stored behavior depend
   on them.
3. **UI**: cheapest to change, but a broken, slow, or confusing daily workflow
   is still major.

Levels: **blocker** (incorrect behavior, data loss, broken check), **major**
(schema debt, wrong primitive, real performance problem, unrequested
behavior), **minor** (dead code, duplication, convention violation), **nit**
(style).

## Review Output

List findings caused by the change first, by severity, then pre-existing
findings in a separate section. Each: severity, `file:line`, category (scope,
simplicity, schema, correctness, performance, ux, tests, consistency), the
problem with its evidence in one sentence, and the fix. Skip padding; say
plainly when nothing survives scrutiny.

## Fix Mode

When fixes are explicitly requested, report all findings first, then fix in
severity order. Before a deployed schema fix, report its `planDeploy`
`deployType` (`compatible`, `compatible_by_orphaning`, `automatic_backfill`,
`requires_transform`, or a database swap) and its consequences, describe any
transform's historical-data mapping, and get confirmation. Then re-run Forge
validation, relevant tests, and the preview workflow for the affected scope.
