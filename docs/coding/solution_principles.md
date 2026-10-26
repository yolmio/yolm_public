---
title: Solution Development Principles
description: Best practices and principles for building Yolm solutions, including reusability guidelines, code organization, and styling conventions.
tags:
  - coding
  - best-practices
  - reusability
---

# Solution Development Principles

## Maximize Reusability

Solutions should be built with the highest levels of reusable blocks, apps, pages, components, and functions - using the least custom code possible.

### Block and App Reuse

Blocks and apps are the highest level of reusability. Always prefer existing blocks:

- **AuthBlock** - Use when the product requires authentication or permissions
- **adminApp** - Use when the product has administrative workflows
- **BulkEmailDeliveryBlock** and **MarketingEmailCampaignBlock** - For platform bulk delivery and scheduled template campaigns
- **SchedulingBlock** - For booking appointments
- **AttachmentsTableBlock** - For attaching/managing files on a table
- **NotesListTableBlock** - For adding notes to a table
- **KanbanProjectTableBlock** - For managing projects with Kanban boards

Err on the side of choosing an existing block if it at least mostly solves the problem.

### Don't Reinvent the Wheel

If an existing system or example solves the problem, use the relevant parts of it. Solution developers generally don't create new blocks, pages, components, or reusable functions - they reuse existing ones. However, they may need to create new components and functions to solve system-specific problems.

## Database Design

Keep the persistent model compact. Every table, field, enum value, and
relationship should have a concrete purpose, reader, and writer. Removing a
field later leaves its physical slot and data behind as an orphan until a
transform rebuilds the database, so add only
what the workflow needs.

- Use meaningful and descriptive names for tables, fields, and variables
- Follow naming conventions (snake_case, plural table names)
- Prefer block-provided schema over overlapping custom tables
- Derive values computable from other data (totals, rollups, copies,
  statuses such as overdue) with queries, virtual fields, or views instead of
  storing them; store authoritative workflow state once
- Do not add cache, summary, or denormalized tables as speculative query
  optimization
- Use [transaction queries](../sql/transaction_queries.md) for change history
  instead of audit, log, and history tables. Add `created_at`/`created_by`
  style fields only when a frequent query, the UI, or a workflow reads them:
  the transaction log scans each table's retained history (subject to
  `autoCompact`), so it suits forensics, not routine reads
- Use procedure tables for intermediate data instead of persistent staging
  tables
- Do not design around secondary indexes or physical partition, cluster, or
  sort keys; Yolm does not expose them

## Styling Guidelines

- Use the theme - minimize custom styling
- Prefer the theme and existing style utilities. Add scoped typography, color,
  state, responsive, and accessibility styles when the product requires them;
  keep layout and spacing styles local to the component.
- Set density and copy by users and device; see [UX](../ai/review.md#ux).
