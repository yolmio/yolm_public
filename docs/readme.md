---
title: Yolm Documentation Contract
description: Defines the purpose, metadata requirements, and retrieval rules for Yolm docs used by Forge research agents and solution developers.
tags:
  - docs
  - agents
  - retrieval
  - solution-development
related:
  - concepts/overview.md
  - coding/index.md
  - ai/review.md
---

# Yolm Documentation Contract

The `docs/` folder is first and foremost for Yolm system and solution
development. It should tell agents and users which primitive to use, where
state belongs, which files define each surface, and which patterns are valid.

Package and framework implementation guidance is outside this solution-facing
set. Keep lower-level authoring internals, hooks, and maintenance notes out of
these docs unless solution developers need them.

## Retrieval Contract

Forge builds multiple knowledge artifacts from `docs/`:

- a doc manifest from front matter for coarse discovery,
- section records from headings and section text for `searchDocSections`,
- linked examples from code-snippet directives in docs,
- public API lookup from exported TypeScript type metadata.

Agents should usually receive concise doc sections plus exact exported
TypeScript signatures. Therefore docs should explain **when and why** to use a
primitive, while exhaustive prop lists and implementation internals belong in
type metadata or platform-maintained references.

Every canonical doc must include:

```yaml
---
title: Short Searchable Title
description: One concise sentence with the exact primitive names, synonyms, and
  decision terms an agent is likely to search for.
tags:
  - ui
  - form
related:
  - ui/data.md
---
```

- `title` is required and should use the exact public primitive or topic name.
- `description` is required for retrieval quality. Include terms agents search
  for, such as `Data`, `Form`, `system.api`, `scheduledProc`, `runtime state`,
  or `query params` when relevant.
- `tags` should be a short list of stable topic names.
- `related` should point to existing docs paths relative to `docs/`.
- Do not rename docs casually; agents and preloaded context may reference paths.

## Authoring Rules

- Prefer source-verified facts over restating assumptions.
- Link to one canonical explanation instead of duplicating it.
- Keep each heading section independently useful and compact; `searchDocSections`
  may preload only that section.
- Use concise examples that match current code and documented primitives.
- Avoid exhaustive prop tables when exported TypeScript types provide the exact
  API. Keep docs focused on decision rules, common patterns, and pitfalls.
- Keep package-development-only content outside the solution-facing docs.
- Mark any historical design note still in `docs/` as historical in title,
  description, or tags.

## Ingestion and validation

Forge ingests Markdown front matter, headings, links, and code-snippet
directives into its documentation and retrieval indexes. Keep metadata and
related paths valid, keep examples source-verified, and make every heading
useful when retrieved on its own. Platform-side ingestion and validation are
the authority for publication readiness.
