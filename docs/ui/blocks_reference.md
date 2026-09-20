---
title: Blocks Reference
description: Short routing reference for choosing reusable Yolm blocks; use public block docs and exported TypeScript types for exact constructors and props.
tags:
  - blocks
  - solution-development
  - reference
related:
  - blocks/solution_blocks.md
  - blocks/auth.md
  - blocks/crm.md
  - concepts/blocks.md
---

# Blocks Reference

This page is a compact retrieval bridge. For solution work, prefer
[Solution Blocks](../blocks/solution_blocks.md), then use the block's public
docs and exported TypeScript types for exact constructor and component
signatures.

## Choose A Block

| Need | Block/doc |
| --- | --- |
| Login, roles, permissions, OTP, password auth, SSO, user management | [AuthBlock](../blocks/auth.md) |
| Contacts, organizations, CRM reports, and optional pipeline/projects/success-plan features | [CrmBlock](../blocks/crm.md) |
| Appointment scheduling, booking pages, availability, calendars, meetings | `SchedulingBlock` in [Solution Blocks](../blocks/solution_blocks.md) |
| Weekly availability and date-specific availability rules | `AvailabilityBlock` in [Solution Blocks](../blocks/solution_blocks.md) |
| Email templates editable by users/admins | `EmailTemplatesBlock` in [Solution Blocks](../blocks/solution_blocks.md) |
| Durable outgoing webhooks with retries | `OutgoingWebhooksBlock` in [Solution Blocks](../blocks/solution_blocks.md) |
| Bulk delivery, marketing campaigns, and connected-account sends | Email delivery blocks in [Solution Blocks](../blocks/solution_blocks.md) |
| Kanban project boards | `KanbanProjectsBlock` in [Solution Blocks](../blocks/solution_blocks.md) |
| Related address, notes, attachments, translations, synonyms | table blocks in [Solution Blocks](../blocks/solution_blocks.md) |

## Use Blocks Correctly

- Add system blocks in `core.tsx` with `system.addBlock(new Block(...))`.
- Define tables referenced by a block before adding the block.
- Use block-provided pages/components instead of recreating parallel UI.
- Use `system.block(BlockClass)` in procedures when you need the configured
  block instance.
- Do not import block internals unless a public docs page explicitly exposes
  them as solution-facing API.
