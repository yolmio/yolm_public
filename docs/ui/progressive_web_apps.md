---
title: Progressive Web Apps (PWA)
description: Configure installable Yolm apps with webAppManifest, icons, logoGeneration strategies, and favicon and touch-icon tags.
tags:
  - ui
  - pwa
  - manifest
  - mobile
---

# Progressive Web Apps (PWA)

Yolm apps become installable by setting `webAppManifest` on `system.app`. A
mobile app usually sets `display: "standalone"`, supplies `icons`, and picks a
`logoGeneration` strategy for favicons and touch icons.

```tsx
import { system } from "std/system";
import { getAssetUrl } from "std/yolm_gen_api";

system.app({
  domain: "todos.example.com",
  logoGeneration: { type: "Custom" },
  webAppManifest: {
    name: "Todo Manager Pro",
    short_name: "Todo Pro",
    start_url: "/",
    icons: [
      {
        src: getAssetUrl("icon-192x192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: getAssetUrl("icon-512x512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    theme_color: "#2563eb",
    background_color: "#ffffff",
    display: "standalone",
    orientation: "portrait",
  },
  ui: (
    <>
      <link rel="icon" type="image/svg+xml" href={getAssetUrl("favicon.svg")} />
      <link rel="shortcut icon" href={getAssetUrl("favicon.ico")} />
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href={getAssetUrl("apple-touch-icon.png")}
      />
      <meta name="apple-mobile-web-app-title" content="Todo Pro" />
      <TodoApp />
    </>
  ),
});
```

## Manifest

`webAppManifest` is typed as `WebAppManifest` (`std/pwa_manifest`), which
follows the W3C manifest member names (`name`, `short_name`, `icons`,
`start_url`, `display`, `theme_color`, `background_color`, `orientation`,
`screenshots`, `categories`, …). Every member is optional. Yolm-specific
behavior:

- `name` defaults to the app's `displayName`, and `displayName` (used for the
  document `<title>`) defaults to `webAppManifest.name`.
- Reference icon and screenshot files with `getAssetUrl("file.png")`. It
  returns a content-hashed URL that works in both preview and deploy; do not
  hard-code `/assets/...` paths.
- Provide at least `192x192` and `512x512` icons. For `purpose: "maskable"`,
  keep important content inside the central 80% safe zone.
- Use `screenshots` with `form_factor: "wide"` / `"narrow"` for richer install
  prompts.

## Logo generation

`logoGeneration` controls the favicon and touch-icon tags Yolm adds to every
page (`LogoGeneration` in `std/system`):

| Value | Behavior |
|---|---|
| `{ type: "Default" }` (default) | Built-in Yolm favicons and touch icon. |
| `{ type: "App", safariPinnedTabColor, msTileColor, themeColor }` | Emits tags pointing at the app's own assets: `apple-touch-icon.png`, `favicon-32x32.png`, `favicon-16x16.png`, `safari-pinned-tab.svg`, `favicon.ico`. All three colors are required. |
| `{ type: "Custom" }` | Emits no icon tags; render your own `<link>` / `<meta>` tags in `ui`, as in the example above. |

## Meta tags

Every app already emits `mobile-web-app-capable`,
`apple-mobile-web-app-capable` (`yes`), and
`apple-mobile-web-app-status-bar-style` (`default`). Add others, such as
`apple-mobile-web-app-title`, as elements in `ui`.

`system.app` has no service-worker or offline-caching option; the manifest
only makes the app installable. Check the result in DevTools under Application, then Manifest,
and test "Add to Home Screen" on iOS Safari and Android Chrome.
