---
title: Forge UI skill
description: "Use before building or changing pages, components, forms, or interactions: Data, Form, ActionButton, refetch, and component reuse."
tags: [ai, forge, skill, ui, form]
related:
  - ui/overview.md
  - ui/data.md
  - ui/form.md
  - ui/action_button.md
  - ui/page_templates.md
---

# Forge UI skill

Inspect the current app and search existing blocks, components, pages, and
examples before designing custom UI. Reuse the highest-level documented
primitive that fits and follow the existing theme and layout patterns.

- Use `Data` for query-backed reads, URL filters, and local UI state.
- Keep list filters and search in `Data` `queryParams`, and set `backLink` on
  links back to a list so filters and scroll are restored; see
  [Routing](../ui/routing.md#returning-to-a-list).
- Use `Form` for user-edited inserts, updates, merges, validation, and
  submit lifecycle.
- Use `ActionButton` or `ActionMenuItem` for command mutations such as approve,
  delete, send, sync, recalculate, or archive.
- Use a plain `Button` for client-side interaction.
- Keep numeric editing state as text. Use `Form.Field` and its numeric control
  in forms; use `NumericInput` from `components/numeric_input` directly for
  standalone command/scenario inputs, without a per-input form. Parse a separate
  value for calculations or submission. Never feed casts, rounding, formatting,
  or a numeric scalar binding back into a plain `Input` on every keystroke. Preserve
  empty text, a leading minus, a trailing decimal point, and trailing zeroes.
  Verify with sequential keystrokes, cursor edits, clearing, paste, and
  external resets; filling a complete number alone does not catch
  feedback-loop bugs.
- Let `Form` and `ActionButton` own loading, errors, confirmation,
  double-submit protection, and refetch behavior.
- Before adding or changing server hooks/actions, follow
  [Own The Generated-Code Cost](./forge_procedures.md#own-the-generated-code-cost).
  Trace option-handler and route copies, including nested helpers. Do not add
  generated duplication; TypeScript reuse alone does not share compiled code.
  Report pre-existing duplication for a cleanup task. Preserve the UI lifecycle
  and caller transaction when extracting work.
- Refresh affected reads after successful mutations. Choose `noRefetch` when a
  `Data` component's state should survive global `s.refetch()`.
- Before adding per-row reads or changing query eligibility, follow
  `docs/ai/forge_queries.md`. Measure the whole interaction at realistic row
  counts; a small label lookup can repeat a large scan for every displayed row.
- Own the [interactive request cost](review.md#interactive-request-cost): small
  reference dropdowns should normally load once and filter locally, not request
  the server on focus, every keystroke, and selection. Trace dependent-field and
  blur callbacks too. Preserve refresh scope and server-side write validation;
  verify request counts and sequential keyboard interaction, not only final
  values.
- Design for the users and device, and cut filler copy; see
  [UX](review.md#ux). Review screenshots with realistic data.

Think through the states the actual flow can reach: pending, empty, success,
validation failure, server failure, permission denial, missing records,
disabled or duplicate submission, and retry or recovery. Implement reachable
states and validate both the compiled system and the interaction.

Read `docs/ui/data.md`, `docs/ui/form.md`, and `docs/ui/action_button.md` for the
decision boundaries. Use `docs/ui/page_templates.md` and exact exported types
for the closest reusable surface and API.
