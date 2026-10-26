---
title: Forge blocks skill
description: "Use before adding any significant capability, schema, or UI: find and reuse existing blocks, components, and pages first."
tags: [ai, forge, skill, blocks, reuse]
related:
  - concepts/blocks.md
  - coding/solution_principles.md
---

# Forge blocks skill

Load this guide before adding a significant capability or custom schema/UI.
Inspect blocks already wired in `core.tsx`, search the `blocks` docs tag, and
search examples and exported APIs for the closest capability.

Prefer the highest useful level of reuse in this order: an existing block, its
pages or components, a shared component, and system-specific code. Check
the block's tables, enums, configuration, routes, permissions, components, and
common mistakes before adding overlapping schema or UI. Use block UI through
the documented block namespace and import dependencies used directly.

Compose or extend the closest block's documented surfaces and keep block-owned
behavior in its existing model. Read `docs/concepts/blocks.md` and the matching
`docs/blocks/*.md` guide before patching.
