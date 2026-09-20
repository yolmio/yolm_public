---
title: Forge schema skill
description: Compact Yolm database schema design for tables, fields, enums, relationships, constraints, blocks, and deployed transforms.
tags: [ai, forge, database, schema, htap]
related:
  - database/overview.md
  - database/best_practices.md
  - database/field_types.md
  - database/advanced_table_features.md
  - concepts/transforms.md
---

# Forge schema skill

Read `core.tsx` and inspect the current database, enums, and wired blocks before
proposing schema. Prefer block-provided schema when it covers the domain.

Keep the durable model compact. Every table, field, enum value, and relationship
must have a concrete purpose, reader, and writer. Derive inexpensive values with
queries or virtual fields. Add cache, summary, or denormalized tables when
current measured requirements justify their durable cost.

Yolm provides fixed columnar physical storage with fast scans. Use types,
foreign keys, unique constraints, checks, and appropriate string lengths to
encode domain invariants and design around columnar access patterns.

Classify schema changes on deployed systems before applying them. New tables,
nullable fields, enum values, and identity-preserving `renameFrom` changes are
compatible deploys. Removing a table or field retains its physical slot and
data as an orphan. Default-backed required-field additions and nullability
tightening use automatic backfill. Changes that require custom rewriting,
reinterpretation, or validation of historical data require a transform or
database swap. Surface the actual deploy class and preserve the semantics of
historical operations. Read `docs/database/best_practices.md` and the relevant
field or constraint guide; load `docs/concepts/transforms.md` when the change
requires a transform.
