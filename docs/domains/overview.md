---
title: Domain Modeling Guides
description: How to model a business domain in Yolm before adding tables, enums, or blocks; index of domain guides such as accounting, with the shared guide template.
tags:
  - domain
  - modeling
  - schema
  - best-practices
related:
  - domains/accounting.md
  - ai/forge_schema.md
  - database/best_practices.md
  - concepts/common_patterns.md
---

# Domain Modeling Guides

Domain guides show the smallest correct Yolm model for a business domain:
which blocks already cover it, which tables, fields, and enum values it needs,
what to derive instead of store, and how to keep edits safe. Search these
guides before designing schema for a domain; then follow
[Forge schema](../ai/forge_schema.md) for the change itself.

## Modeling Principles

- **Schema is the costliest thing to change.** Adding a table, nullable
  field, or enum value is a compatible deploy, but a removed table or field
  keeps its data as an orphan until a transform. Add the fewest tables, fields, and enum
  values that correctly model the domain, each with a concrete reader and
  writer.
- **Derive, don't store.** Totals, balances, statuses that follow from other
  rows, rollups, and copies of values reachable through a join belong in
  queries, [virtual fields](../database/virtual_fields.md), or views. Store
  only authoritative state, deliberate historical snapshots (an invoice line's
  price), or results measured as expensive after query-shape fixes, with the
  user's approval.
- **History is built in.** [Transaction queries](../sql/transaction_queries.md)
  record who changed what and when; do not add audit, activity, or change-log
  tables for that.
- **Make edits safe.** Where a mistake is costly, split working state (drafts)
  from released state (posted, issued), change released state only through
  procedures that check invariants, and correct it with new records such as
  reversals. Put row-level invariants in check and unique constraints so every
  writer, including AI agents, is held to them.

## Guide Template

Each guide uses the same sections so a retrieved section stands on its own:

1. **Purpose** — two lines on what the domain covers.
2. **Blocks to use** — existing blocks and when their schema fits.
3. **Minimal model** — compiling schema code.
4. **Derived values** — queries and views for totals, balances, and statuses.
5. **Safe-edit state** — working versus released state and how corrections
   happen.
6. **Anti-patterns** — over-modeling mistakes specific to the domain.
7. **References** — related docs.

## Guides

- [Accounting](accounting.md) — ledger blocks, chart of accounts, journal,
  invoices, credit memos, payments, derived balances, posting, and reversal.

For cross-domain patterns such as status fields, child records, external IDs,
and inbound payloads, see [Common Patterns](../concepts/common_patterns.md).
