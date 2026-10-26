---
title: Site pages (static blog & content)
description: Marketing surface for Yolm apps — static blog with file-defined posts, static content pages, and helpers to load them at generation time.
tags:
  - ui
  - marketing
  - blog
  - landing
---

# Site pages

`pages/site/*` provides a marketing surface for Yolm apps: a static,
file-driven blog and a registry of plain content pages (terms,
privacy, about). Pair with `TransparentNavbar` (`components/transparent_navbar`) and
`Footer` (`components/site/footer`) for full landing pages.

These pages are **generation-time static** — content is imported from
TSX modules at build time, not stored in the database.

## Static blog

```tsx
import { StaticBlogPages } from "pages/site/static_blog";
import { loadBlogPosts } from "pages/site/load_posts";

const posts = await loadBlogPosts("blog_posts");

<StaticBlogPages
  posts={posts}
  titleBrand="Example Inc."
/>
```

Each post is a module under the directory you pass (`blog_posts/` in
the example) that exports a `post: StaticBlogPost`:

```tsx
import type { StaticBlogPost } from "pages/site/static_blog";

export const post: StaticBlogPost = {
  slug: "welcome",
  title: "Welcome to our blog",
  date: "2025-01-15",
  status: "published",
  description: "Introducing the new platform.",
  content: <>{/* JSX body */}</>,
};
```

`loadBlogPosts(dir)` imports every `.ts`/`.tsx` module under `dir`
(relative to the system root) and sorts the posts newest first by `date`.
Only posts with `status: "published"` appear on the indexes. Posts may also
set `coverImage`, `author`, `tags`, `groups`, and `showOnPaths`.

`StaticBlogPages` mounts the index at `basePath` (default `/blog`) with detail
pages at `basePath/<slug>`, plus index aliases (default `["/blogs"]`; pass
`[]` to disable). `showForPath` and `showForGroup` filter the default indexes.
`filterRoutes` (`StaticBlogFilterRoute[]`) adds further indexes filtered by
`post.groups`.

## Static content

For terms-of-service, privacy, about-us, and similar pages:

```tsx
import { StaticContent } from "pages/site/static_content";
import { loadPages } from "pages/site/load_posts";

const pages = await loadPages("static_pages");

<StaticContent pages={pages} titleBrand="Example Inc." />
```

Each module under the directory exports `page: StaticPage` with
`{ path, title, content }`. `loadPages` sorts the pages by title. Each page
gets its own `Route` with the title `<title> | <titleBrand>` and the shared
site prose styles, and scrolls to the top on mount.

## Composing with marketing components

A typical landing-page app combines these with the marketing nav and
footer:

```tsx
system.app({
  domain: "marketing.example.com",
  ui: (
    <>
      <TransparentNavbar /* … */ />
      <AppRoutes>
        <StaticBlogPages posts={posts} titleBrand="Example" />
        <StaticContent pages={contentPages} titleBrand="Example" />
        <Route path="/">{/* landing page */}</Route>
      </AppRoutes>
      <Footer /* … */ />
    </>
  ),
});
```

## Related

- [Apps](../concepts/apps.md)
- [Routing](./routing.md)
