---
title: Progressive Web Apps (PWA)
description: How to configure Yolm applications as Progressive Web Apps with web app manifests, service workers, and offline capabilities.
tags:
  - ui
  - pwa
  - manifest
  - mobile
---

# Progressive Web Apps (PWA)

Yolm apps can be installable Progressive Web Apps. A mobile app commonly sets
`display: "standalone"` in `webAppManifest`, supplies `icons`, and chooses an
appropriate `logoGeneration` strategy.

## Web App Manifest

Use `getAssetUrl("file.png")` for icons, favicons, touch icons, screenshots,
and other app assets. It returns a content-hashed URL that works in dev and
deploy. With `logoGeneration: { type: "App", ... }`, Yolm can generate the icon
set automatically; use `logoGeneration: { type: "Custom" }` when providing your
own assets.

```tsx
import { getAssetUrl } from "std/yolm_gen_api";

system.app({
  domain: "app.example.com",
  webAppManifest: {
    name: "My Application",
    short_name: "MyApp",
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
    theme_color: "#ffffff",
    background_color: "#ffffff",
    display: "standalone",
  },
  ui: <MyApp />,
});
```

## Manifest Properties

### Recommended Properties

All manifest properties are optional; production PWAs usually set:

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Full name of the application |
| `short_name` | `string` | Short name for home screen (12 chars max recommended) |
| `icons` | `Icon[]` | Array of icon objects |
| `theme_color` | `string` | Browser UI color |
| `background_color` | `string` | Splash screen background color |
| `display` | `string` | Display mode (`standalone`, `fullscreen`, `minimal-ui`, `browser`) |
| `start_url` | `string` | URL opened when launched from an installed icon |
| `screenshots` | `Screenshot[]` | App-store/install prompt screenshots; include `form_factor` for wide/narrow images |

### Icons

```tsx
icons: [
  {
    src: getAssetUrl("web-app-manifest-192x192.png"),
    sizes: "192x192",
    type: "image/png",
    purpose: "maskable",  // or "any", "monochrome"
  },
  {
    src: getAssetUrl("web-app-manifest-512x512.png"),
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
]
```

Use at least `192x192` and `512x512`. Optional sizes: `72x72`, `96x96`,
`128x128`, `144x144`, `152x152`, `384x384`.

### Display Modes

```tsx
display: "standalone"  // Looks like a native app (recommended)
display: "fullscreen"  // Takes over entire screen
display: "minimal-ui"  // Minimal browser UI
display: "browser"     // Regular browser tab
```

### Screenshots

Mobile-first apps can include install screenshots:

```tsx
screenshots: [
  {
    src: getAssetUrl("screenshot-wide.png"),
    sizes: "1280x720",
    type: "image/png",
    form_factor: "wide",
  },
  {
    src: getAssetUrl("screenshot-narrow.png"),
    sizes: "540x720",
    type: "image/png",
    form_factor: "narrow",
  },
]
```

## Favicons and Touch Icons

Add favicons and Apple touch icons in app UI:

```tsx
system.app({
  domain: "app.example.com",
  ui: (
    <>
      {/* Favicons */}
      <link
        rel="icon"
        type="image/png"
        href="/assets/favicon-96x96.png"
        sizes="96x96"
      />
      <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
      <link rel="shortcut icon" href="/assets/favicon.ico" />

      {/* Apple Touch Icon */}
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href="/assets/apple-touch-icon.png"
      />

      {/* Your app UI */}
      <MyApp />
    </>
  ),
});
```

## Logo Generation

Disable automatic logo generation if you're providing custom icons:

```tsx
system.app({
  domain: "app.example.com",
  logoGeneration: { type: "Custom" },  // Use custom favicons
  webAppManifest: { /* ... */ },
  ui: <MyApp />,
});
```

## Complete PWA Example

```tsx
import { system } from "std/system";
import { getAssetUrl } from "std/yolm_gen_api";

system.app({
  domain: "todos.example.com",
  logoGeneration: { type: "Custom" },
  webAppManifest: {
    name: "Todo Manager Pro",
    short_name: "Todo Pro",
    description: "Manage your tasks efficiently",
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
    categories: ["productivity", "utilities"],
  },
  ui: (
    <>
      {/* Favicons */}
      <link
        rel="icon"
        type="image/png"
        href="/assets/favicon-96x96.png"
        sizes="96x96"
      />
      <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
      <link rel="shortcut icon" href="/assets/favicon.ico" />

      {/* Apple Touch Icon */}
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href="/assets/apple-touch-icon.png"
      />

      {/* Meta tags */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black" />
      <meta name="apple-mobile-web-app-title" content="Todo Pro" />

      {/* App UI */}
      <TodoApp />
    </>
  ),
});
```

## Icon Creation Tips

### Maskable Icons

For `purpose: "maskable"`, ensure your icon design:
- Has important content in the safe zone (80% center circle)
- Works with rounded corners, circles, and squircles
- Has sufficient padding around the edges

### Design Specifications

```
512x512 icon:
- Safe zone: 409x409 center circle
- Padding: ~52px on all sides
- Format: PNG with transparency
```

### Testing

Test your PWA manifest:
1. Open DevTools → Application → Manifest
2. Check for warnings
3. Verify icon display
4. Test "Add to Home Screen" on mobile

## Additional Meta Tags

```tsx
<meta name="theme-color" content="#2563eb" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="App Name" />
```

## Best Practices

1. **Icons**
   - Provide both 192x192 and 512x512
   - Use `purpose: "maskable"` for better platform support
   - Test on different devices

2. **Names**
   - `name`: Full descriptive name
   - `short_name`: 12 characters or less for home screen

3. **Colors**
   - `theme_color`: Match your app's primary color
   - `background_color`: Splash screen background

4. **Display**
   - Use `standalone` for app-like experience
   - Consider `minimal-ui` if browser navigation is needed

5. **Testing**
   - Test on iOS Safari
   - Test on Android Chrome
   - Verify home screen appearance
   - Test offline capabilities (if implemented)
