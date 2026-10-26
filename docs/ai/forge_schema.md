---
title: Forge schema skill
description: Use before adding or changing tables, fields, enums, constraints, or relationships, including schema added as part of feature work.
tags: [ai, forge, skill, schema, htap]
related:
  - database/best_practices.md
  - database/field_types.md
  - concepts/transforms.md
  - domains/overview.md
---

# Forge schema skill

Schema is the most expensive part of a system to change. A new table, nullable
field, or enum value deploys compatibly; a removed table or field keeps its
physical slot and data as an orphan until a transform. Reviews that delete fields and
merge tables cost far more than modeling minimally up front.

## Rules

1. **Model the minimum that is correct.** Every table, field, and enum value
   needs a concrete reader and writer today. Make fields nullable where
   possible. Read the system's `core.tsx`,
   inspect the wired blocks, and search `docs/domains/` before designing. Prefer
   block-provided schema when it covers the domain.
2. **Derive instead of storing.** Yolm is HTAP: live queries over columnar data
   are fast. Compute totals, balances, counts, "last X" values, rollups, and
   statuses computable from other data (overdue, paid) with queries,
   [virtual fields](../database/virtual_fields.md), or views. A stored derived
   value or summary table needs measured `yolm query --explain` evidence and the
   user's approval as a schema change. Authoritative workflow state that people
   set, such as an order's lifecycle status, is stored once.
3. **One source per fact.** Common duplicates to avoid:
   - a status enum plus booleans or `*_at` fields that restate it — pick the
     status, or the timestamp when the time matters;
   - a foreign key copied from a parent (`client_id` beside `order_id`);
   - names, emails, or prices copied from another table, unless the copy is a
     deliberate historical snapshot such as an invoice line price;
   - one column set per channel or variant (`email_sent_at`, `sms_sent_at`, …)
     instead of a child table or enum.
4. **History comes from transactions.** [Transaction queries](../sql/transaction_queries.md)
   answer "who changed what, when" without audit, activity-log, or error-log
   tables, within each table's retention: `autoCompact` tables fold old
   update payloads away. Reading the log scans a table's whole retained
   history, so it is costly: add a provenance field such as
   `created_at` or `created_by` when the UI or logic reads it, and leave it
   out when only developer forensics would.
5. **Keep transient data out of `db.*`.** Staging and intermediate rows belong
   in procedure tables or [pipelines](../concepts/pipelines.md); UI selections
   belong in `ui.*` state.
6. **Make invalid states unrepresentable.** Use field types, foreign keys,
   unique constraints, checks, and string lengths for invariants. Where edits
   are costly to get wrong (released engineering data, posted accounting),
   split working state from released or immutable state so people and agents
   can edit the working copy safely.
7. **Report every schema change.** Make the changes the task needs, then list
   each added, changed, or removed table, field, and enum value, with its
   reader and writer, in your report to the user. The deploy page also shows
   the production schema changes before anyone deploys.

## Deployed systems

Classify every schema change before applying it: new tables, nullable fields,
enum values, and identity-preserving `renameFrom` changes are compatible;
removals orphan data; default-backed required fields and nullability tightening
backfill automatically; reinterpreting historical data needs a transform or
database swap. Report the actual class from `planDeploy`'s `schemaChanges` and
preserve the meaning of historical operations.

## References

- Field types, money, and durations: `docs/database/field_types.md`
- Constraints and relationships: `docs/database/best_practices.md`,
  `docs/database/foreign_keys.md`
- Transforms and deploy classes: `docs/concepts/transforms.md`
- Domain models (accounting and others): search tag `domain`
- Anything else: `searchDocs` with tag `database`
