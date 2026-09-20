# Site Package Components

Components in this package are reusable website primitives. They may depend on
the generic `--site-*` CSS variable contract documented in
`docs/ui/website_styling.md`, but they must not define or import a concrete
brand palette.

Public props should describe intent, not brand implementation. Prefer semantic
variants such as `tone`, `variant`, `layout`, or `actionLabel`; do not add raw
color props to package components. The consuming app binds the `--site-*`
tokens to its own palette.

## Package Boundary

Keep product-, campaign-, industry-, and app-specific section kits inside the
app that owns them. This package keeps generic navigation, prose, content
index, footer, and static content helpers.

Package components may:

- Consume semantic CSS variables such as `--site-text`, `--site-accent`,
  `--site-border`, `--site-font-body`, and `--site-nav-bg`.
- Expose content and behavior through typed props.
- Accept limited escape hatches such as `sx` or decorative `background` nodes
  when the app must adapt layout or art.

Package components must not:

- Import files from `systems/*` or app-specific shared folders.
- Mention a concrete product, customer segment, route set, or brand.
- Define raw brand colors, fonts, or image assets.
- Add raw color props that bypass the app's token contract.

## Components

- `MegaMenuNavbar` provides a fixed responsive navbar with desktop mega menus
  and a mobile drawer. It uses `--site-nav-*` variables for all nav-specific
  colors and shadows.
- `ContentIndexPage`, `ContentIndexCard`, and `ContentIndexEmptyState`
  provide generic listing pages for blogs, articles, news, resources, and case
  studies, including filtered indexes with no published items yet.
- `ContentDetailPage` provides a generic long-form detail shell for posts,
  resources, and case studies.
- `StaticBlogPages` renders a file-driven blog index, detail pages, and
  optional filtered indexes. Use `basePath`, `aliases`, `groups`, and
  `filterRoutes` instead of hard-coded route or audience assumptions.
- `StaticContent` renders file-driven static prose pages such as legal pages.
- `siteProseStyles` provides semantic prose defaults for long-form content.
- `Footer` from `components/site/footer` provides a generic footer shell with
  columns, legal links, disclaimers, and social/profile links.

## Extension Guidance

When a site needs distinctive marketing sections, build those sections in the
app layer using the shared tokens and generic components here. Promote a piece
back into this package only after it has a generic contract and no embedded
site assumptions.
