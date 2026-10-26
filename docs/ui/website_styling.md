---
title: Website Styling
description: Recommended styling architecture for Yolm websites, including semantic tokens, Tailwind usage, sx usage, reusable components, and site-specific gotchas.
tags:
  - ui
  - styling
  - websites
  - tailwind
  - design-system
related:
  - ui/styling.md
  - ui/theming.md
---

# Website Styling in Yolm

Yolm websites should use a small design system instead of page-local styling.
The goal is consistency, readable content, and reusable sections without hiding
Yolm's generation/runtime model.

## Recommended Split

Use five layers:

1. **Generic site contract** - reusable components may assume generic semantic
   slots such as `--site-bg`, `--site-surface`, `--site-surface-alt`,
   `--site-text`, `--site-text-muted`, `--site-border`, `--site-accent`,
   `--site-radius-card`, and `--site-shadow-card`. These names describe UI
   roles, not a specific brand.
2. **App/site tokens** - each website defines concrete brand colors, text
   colors, surfaces, shadows, radii, and fonts in its own app token module.
   App-specific names such as `--one-burgundy`, `--one-hero-gradient`, or
   `--fabrication-shop-floor` belong here, not in `packages/`.
3. **Theme binding** - bind app tokens to the generic site contract at the app
   shell or root slot, then expose any app-only aliases the site needs.
4. **Reusable components** - compose existing website primitives such as
   sections, cards, buttons, heroes, prose, FAQ lists, navigation, content
   indexes, and CTAs. Keep their styling on the generic contract rather than
   introducing a brand palette in a page.
5. **App pages** - compose reusable components and provide content, route
   structure, and truly page-specific layout only.

Page files should normally read as content plus section order. They should not
redefine brand colors, button styles, card styling, prose styling, or repeated
accordion/grid/hero patterns.

## Styling Rules

- Use semantic CSS variables for visual design. Prefer generic package-facing
  names for reusable components, such as `var(--site-text)`,
  `var(--site-surface)`, and `var(--site-accent)`. Use app-specific variables
  only in that app's pages or app-owned components.
- Keep raw color literals in app token/theme files only. Package files should
  not define Yolm/ONE/fabrication brand colors.
- Use Tailwind/classes for common static styling, but only through semantic
  tokens. Good examples: `bg-site-surface`, `text-site-body`,
  `border-site-border`, `shadow-site-card`, `font-site-body`, or app-local
  classes such as `bg-one-panel`.
- Do not use arbitrary palette utilities (`text-gray-*`, `bg-white`,
  `text-primary-*`, etc.) in website pages unless the app has deliberately
  mapped those utilities to semantic site tokens. Prefer explicit semantic
  names so intent survives theme changes.
- Prefer semantic wrappers over shared class strings. A `SiteCard` or
  `SiteButton` captures theme, spacing, interaction, and accessibility better
  than a copied class list.
- Use `sx` for component APIs, complex local composition, and responsive rules
  where classes become harder to read.
- Use `dynamicClassNames` for SQL-driven class switching. Use `style` only for
  a runtime value that cannot be cleanly represented as a class.
- Keep contrast high. Body text should use the main body token, not a faint or
  decorative token.
- If a section grows many styling props, split it into clearer component
  variants instead of building a prop ladder.

## Tailwind Pattern

The preferred website authoring style is semantic Tailwind for static styling,
with `sx` as the escape hatch:

```tsx
<section className="bg-site-surface text-site-body">
  <div className="mx-auto max-w-site px-6 py-20">
    <h1 className="font-site-display text-site-text">...</h1>
  </div>
</section>
```

App-specific styling can use app-specific semantic classes:

```tsx
<section className="bg-one-panel text-site-body">
  <a className="bg-site-accent text-site-on-accent">Find out</a>
</section>
```

The important rule is that Tailwind consumes tokens; it does not create an
independent palette. If a page needs a new visual role, add a semantic token or
class in the app theme layer first.

## Yolm Gotchas

General Yolm styling rules apply (see [Styling](./styling.md)): runtime styling
uses `dynamicClassNames` or SQL values in `style`, never SQL in `sx` or
`className`, and transient UI state lives in `Data` state, not module-level
JavaScript variables. When dynamic UI or runtime expressions change, include
the runtime validation path before exercising the preview.

## Lessons From Site Migrations

- Define the site token contract once at the app root or shell. Reusable
  components can then rely on `--site-*` variables without importing app code
  or knowing the brand palette.
- Keep reusable component APIs semantic. Prefer props like `variant`, `tone`,
  or `actionLabel`; avoid raw `color`, `backgroundColor`, or brand-specific
  props unless the component is app-owned.
- Load static content at generation time. Helpers such as `loadPages` and
  `loadBlogPosts` should run in the app module, and render components should
  receive already-loaded arrays.
- Put rich interactions in reusable components early. Menus, accordions,
  content indexes, case-study cards, and FAQ lists should each own their
  keyboard, focus, hover, and mobile behavior.
- Test interaction timing with Playwright. Delayed menu close behavior,
  outside-click handling, mobile drawers, contrast, and horizontal overflow are
  easy to regress with visual-only review.
- Treat typography as part of the token layer. Use semantic font classes such
  as `font-site-body`, `font-site-display`, and `font-site-mono`; avoid
  page-local font families and negative tracking unless the token layer
  deliberately exposes them.

## Practical Review Checklist

- New colors are added only to the app token/theme layer.
- Reusable website components do not introduce concrete brand colors.
- Public page files do not introduce arbitrary Tailwind palette utilities or
  raw colors.
- Static page styling uses semantic classes where practical.
- Repeated visual structures are reusable or scoped shared components, not
  copy-pasted TSX.
- Reusable components accept content/data and minimal semantic variants, not
  arbitrary page-specific styling knobs.
- Content loaders run at generation time; render components do not pretend to
  load directories synchronously.
- Public pages use semantic font tokens/classes, not direct font-family names.
- Desktop and mobile Playwright checks confirm no overflow, readable contrast,
  and working menus/interactions.
