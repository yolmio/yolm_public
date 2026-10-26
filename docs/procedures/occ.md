---
title: OCC and Transaction Patterns
description: Grounded patterns for optimistic concurrency control, transaction replay, bounded claims, generated IDs, and low-conflict Yolm writes.
tags: [procedures, transactions, concurrency, performance, correctness]
related:
  - procedures/patterns.md
  - concepts/stored_procedures.md
  - concepts/outbox.md
  - sql/query_planning.md
  - ai/review.md
---

# OCC and Transaction Patterns

Yolm uses optimistic concurrency control (OCC): a write transaction reads a
snapshot, records dependencies, and validates them at commit. A conflicting
commit causes automatic transaction replay. Reduce unnecessary dependencies
and time inside the transaction while retaining every read needed for
correctness. A conflict is not necessarily two users editing the same row.

## What the runtime protects

Read tracking includes row ranges and columns, deletion visibility, predicate
filters, table appends, layout changes, and specialized constraint reads.
Commit validation also considers conflicting inserts already accepted into
the same commit batch. The dependency footprint follows the executed plan;
the number of returned or updated rows alone does not describe it.

Consequently:

- Prefer direct primary-key predicates and only the fields needed by the
  operation. Joins, predicate scans, aggregates, and absence checks can create
  broader dependencies. A selective SQL predicate is not proof of a narrow
  runtime read set; inspect the real plan and conflict details.
- `not exists`, counts, and "latest matching row" reads can be essential
  correctness dependencies. Do not move them outside the transaction when
  concurrent inserts or updates must invalidate the decision.
- A foreign-key check or uniqueness check can add dependencies even when the
  application does not issue an explicit query.
- Primary-key writes can still contend. OCC validation and write admission
  are different stages; a busy commit is not by itself evidence of a broad
  read set.

Keep key comparisons type-aligned. The current scalar-FK read proof requires a
direct scalar or literal with the same type as the non-null FK. A generic
`BigInt` parameter compared with a narrower FK can lose that proof. When a
parent-existence check is already required, select its `id` into an inferred
procedure scalar and use that scalar for child reads. This derives the type
from the schema and avoids a hard-coded narrowing cast. Preserve the missing
parent behavior, and verify the actual plan and conflicts: this proof covers
eligible filter reads, not every content or visibility dependency.

## Know the replay boundary

Automatic OCC replay resumes at the transaction's retry boundary and restores
transactional procedure, UI, and temporary-table state. It does not rerun
candidate discovery or refresh inputs computed before `startTransaction()`.
Earlier committed transactions remain committed.

A `transaction: "caller"` stored procedure shares its caller's transaction,
read dependencies, and retry scope. Splitting a large procedure into caller
helpers helps compilation, but does not shorten the transaction. A standalone
procedure is a separate transaction owner and cannot be invoked while an
ambient transaction is active; it is not a nested commit mechanism.

Keep HTTP requests, email sends, sleeps, and other external effects outside
the transaction. Replay cannot undo a provider call. When an effect must be
coupled to a database change, write the supported
[outbox](../concepts/outbox.md) entry in that transaction and deliver it after
commit. When a caller can redeliver the same operation (partner retries,
webhooks), use a stable idempotency key and durable deduplication; OCC does not
deduplicate separate committed commands. A natural business key, or a reactor
keyed on missing output, often suffices.

The current executor allows 16 OCC retries after the initial attempt. After
three conflicts it can enter a protected progress lane that drains competing
commits and temporarily gates other writers. Protection is time-bounded
(currently 30 seconds), not a guarantee that an arbitrarily large transaction
will finish. These are implementation limits, not application tuning knobs.
An expired protected attempt aborts the shared transaction; catching an error
inside a caller-owned helper cannot make that transaction usable again.

## Prepare, revalidate, write, commit

1. Parse and normalize request data before starting the transaction. Keep
   inputs that identify the command stable across retries.
2. If selection need not include every eligible row as of commit, discover a
   bounded set of candidate primary keys before the transaction.
3. Inside the transaction, re-read and check permissions, ownership, current
   state, and all other facts on which the write depends.
4. Write only the bounded accepted set and commit. Return only records the
   transaction actually claimed or changed.
5. Build wide responses and reporting results after commit when their
   semantics permit a later snapshot.

When the response must describe the decisions made by that transaction, retain
the narrow decision values in procedure state and format them after commit.
Do not re-query mutable eligibility, duplicate state, or membership to rebuild
those decisions. Preserve response ordering and the original atomic write unit.
Keep generated numeric IDs subject to the commit-fixup rules below; copying a
provisional ID into arbitrary response state does not make it commit-safe.

For example, this claims at most one candidate, and an OCC retry that loses
the claim cannot return a previous attempt's success:

```typescript
s.defScalar("candidate_task_id", sql`(
  select id from db.tasks where status = 'pending' order by id limit 1
)`);
s.defScalar("claimed_task_id", { type: "BigInt" });

s.startTransaction();
s.setScalar("claimed_task_id", sql.null);
s.modify(sql`
  update db.tasks
  set status = 'processing'
  where id = candidate_task_id and status = 'pending'
  returning id into claimed_task_id
`);
s.commitTransaction();
// A null claimed_task_id means no task was claimed. Do not return the candidate
// as a success or perform its external work.
```

For a bounded batch, use a procedure table for candidates and a
`RETURNING ... INTO` table for accepted rows. The accepted set drives dependent
writes and the response. Preserve ownership tokens/attempt checks through
completion, not just at initial claim.

Preselection changes the contract: work arriving after discovery can wait
until the next invocation. It is unsuitable when the operation must include
all matching children, prove absence, or choose the latest eligible record as
of commit. Keep that membership query inside the transaction. Moving only the
expensive query out and trusting its stale result weakens correctness.

Batch by a bounded business unit when partial progress is allowed. Do not
split an all-or-nothing user command into separate commits merely to reduce
conflicts. Bound the child workload too: a limit on parents does not bound
cases, charges, or other work expanded for each parent.

For a command that already commits each item separately, treat partial progress
as part of its error contract. A terminal commit/retry failure can leave the
executor before a procedure-level catch runs; an earlier successful commit is
not rolled back. Refresh the UI after failure and tell the user that some items
may have completed. Never report uncommitted counters as completed work.

When the batch must catch that failure and continue, a standalone per-item
procedure can own the existing transaction. Call it without an ambient
transaction, catch its error in the outer batch, and publish its status only
after commit. This supplies an error boundary; it does not eliminate conflicts.
Revalidate each item inside its transaction and retry only remaining eligible
work. Test a failure after successful commits, retained verification work, and
the subsequent retry, including every audit and child row.

## Insert final values and retain generated IDs

Insert a row with its final known fields. Avoid inserting defaults, finding
the row again by a non-unique business key, and updating it immediately.
Use `INSERT ... RETURNING id INTO` to identify the row just inserted; use its
primary key for subsequent operations. Retain business-key absence checks
that are needed for deduplication. In this example, `children.parent_id` is a
declared foreign key to `parents`:

```typescript
s.defScalar("inserted_parent_id", { type: "BigInt" });
s.startTransaction();
s.modify(sql`
  insert into db.parents (name, status)
  values (input_name, 'pending')
  returning id into inserted_parent_id
`);
s.modify(sql`
  insert into db.children (parent_id, name)
  values (inserted_parent_id, input_child_name)
`);
s.commitTransaction();
// Publish the generated ID only after successful commit.
```

Before replacing a lookup with `RETURNING`, check the response contract for
null, malformed, and missing lookup keys. An inserted row can have a nullable
association while the old lookup returns no ID; returning its generated ID
would then change both the response value and potentially the HTTP status.
Preserve that behavior or treat changing it as a separate approved fix.

Generated IDs are provisional until commit. The runtime registers destination
cells and eligible child-FK slots for commit-time adjustment. The compiler can
omit the parent append dependency only when it proves a supported use of the
returned ID exclusively in matching child foreign keys before commit. Other
uses remain append-validated. `RETURNING` is not a promise of zero conflicts;
using the ID in an update, comparison, generic integer field, or an arbitrary
helper is not equivalent to the proven child-FK pattern.

Avoid redundant updates, but do not count every removed UPDATE as a removed
physical write: the runtime can suppress known-equal values. Verify the change
in query work, read dependencies, and actual mutations.

Keep an INSERT-generated-ID destination dedicated to generated IDs until
commit. Do not reset it to null, assign an existing record's ID to it, or reuse
it as general scratch state after an insert. A later INSERT RETURNING can
replace the registration; an ordinary scalar assignment does not. This also
applies when a loop's repeated declaration reinitializes the same cell.

For a loop that sometimes inserts and sometimes uses an existing row, declare
an insert-only destination outside the loop. Use a separate working scalar
for the selected row:

```typescript
s.defScalar("inserted_item_id", { type: "BigInt" });
s.startTransaction();
s.forEachTable("requested_items", "item", (s) => {
  s.defScalar("target_item_id", sql`item.existing_id`);
  s.if(sql`target_item_id is null`, (s) => {
    s.modify(sql`
      insert into db.items (name) values (item.name)
      returning id into inserted_item_id
    `);
    s.setScalar("target_item_id", sql`inserted_item_id`);
  });
  // Use target_item_id for this iteration; never assign it back to
  // inserted_item_id. Revalidate existing-row eligibility inside this tx.
});
s.commitTransaction();
```

That separation prevents stale fixup registrations; it does not grant the
working scalar automatic fixup behavior or guarantee the FK-only optimization.
Do not publish a copied provisional ID after commit as though it were the
registered output. Test mixed new/existing rows, multiple inserts, rollback,
and concurrent inserts, checking each parent-child link rather than totals
alone. A "generated-ID scalar cell lost provisional identity" failure is a
correctness error, not an OCC retry to hide with another application retry.

System 5 commit `ada26e89511bc704d7b85f3a7454cdb067737aad` illustrates this
failure in `auto_review_process_batch`: a mixed new/existing-case loop reused
the generated-ID destination for an existing case. The fix introduced an
insert-only destination and retained a separate working ID. That repairs ID
lifetime correctness; it is not, by itself, evidence of fewer OCC conflicts.

## Verify a proposed reduction

Use a representative concurrent workload and preserve the real caller's
route/input shape, parent and child cardinality, and database size. Compare:

- Committed effects and invariants, including duplicates, orphaned children,
  stale claims, and all-or-nothing behavior on failure.
- OCC retry counts and conflict kind/table/range/columns where available.
- End-to-end latency, CPU, blocks/bytes read, and commit/admission wait.

Use [query plans and metrics](../sql/query_planning.md) to check whether a
rewrite actually narrows work. Lower latency in a serial run does not prove
fewer OCC conflicts. Do not increase retry budgets, add serialization, or add
schema fields as the first response to avoidable transaction work. Even
carefully scoped transactions can have legitimate business conflicts.

## Implementation grounding

Verified against platform source revision
`5b947e7d373f80d5241f98839225380a884fbcf3` on 2026-10-06. Paths below are
relative to the platform repository; recheck them when changing these rules.

| Contract | Implementation |
| --- | --- |
| Read dependencies and conflict details | `crates/runtime/src/read_tracker.rs`; `crates/runtime/src/system/mod.rs`: `OccConflictDetail`, `describe_read_set_conflict` |
| Committed and pending-batch validation | `crates/runtime/src/storage/commit_queue.rs`: read-set validation and `pending_batch_inserts` |
| Retry boundary and state restoration | `crates/runtime/src/executor.rs`: `MAX_OCC_RETRIES`, `retry_resume_id`, `restore_proc_tx_cow`, `restore_ui_tx_cow`, `restore_tmp_table_tx_cow` |
| Protected progress and inherited abort | `crates/runtime/src/system/occ_progress.rs`; `crates/runtime/src/transaction_progress.rs` |
| Stored-procedure transaction ownership | `crates/runtime/src/stored_procedure_invocation.rs`: `check_invocation` |
| Compiler proof for generated-ID FK use | `crates/compiler_hir/src/general_server.rs`: `analyze_fk_only_returning_into`, `check_direct_commit_fixup_suffix` |
| Scalar and joined FK membership proofs | `crates/compiler_execution_planner/src/exact_fk_read.rs`: `SealedScalarFkRead`, `SealedExactFkRead`; `crates/runtime/src/system/insert_filter_proof.rs` |
| Generated-ID cell registration and validation | `crates/runtime/src/abi/insert.rs`: `rt_register_optimistic_id_scalar`; `crates/runtime/src/transaction.rs`: `register_scalar_fixup`; `crates/runtime/src/storage/commit_queue.rs`: `validate_optimistic_id_fixups` |
