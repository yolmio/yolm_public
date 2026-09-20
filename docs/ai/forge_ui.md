---
title: Forge UI skill
description: Yolm UI design decisions for Data, Form, ActionButton, refetch behavior, interaction states, and component reuse.
tags: [ai, forge, ui, form, action-button]
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
  Test with sequential keystrokes, cursor edits, clearing, paste, and external
  resets; filling a complete number alone does not catch feedback-loop bugs.
- Let `Form` and `ActionButton` own loading, errors, confirmation,
  double-submit protection, and refetch behavior.
- Refresh affected reads after successful mutations. Choose `noRefetch` when a
  `Data` component's state should survive global `s.refetch()`.
- Before adding per-row reads or changing query eligibility, follow
  `docs/ai/forge_queries.md`. Measure the whole interaction at realistic row
  counts; a small label lookup can repeat a large scan for every displayed row.

Think through the states the actual flow can reach: pending, empty, success,
validation failure, server failure, permission denial, missing records,
disabled or duplicate submission, and retry or recovery. Implement reachable
states and validate both the compiled system and the interaction.

Read `docs/ui/data.md`, `docs/ui/form.md`, and `docs/ui/action_button.md` for the
decision boundaries. Use `docs/ui/page_templates.md` and exact exported types
for the closest reusable surface and API.
