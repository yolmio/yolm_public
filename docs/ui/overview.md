---
title: UI Overview
description: Introduction to Yolm UI - TSX-like components that generate UI at generation time with automatic single-roundtrip data access.
tags:
  - ui
  - overview
  - components
---

# UI Overview

In Yolm, UIs are defined in apps using a TSX-like syntax. Components run at generation time and produce a node tree that becomes the runtime UI.

## Simplest App

```typescript
system.app({
  domain: "test.yolm.app",
  ui: "Hello World"
})
```

## Key Differences from React

1. **No `key` props** - Not needed in Yolm, never add them
2. **Generation time execution** - Components run once at build time, not at runtime
3. **Automatic optimization** - Single roundtrip happens automatically
4. **No objects for runtime state** - Use `db.*`, `ui.*`, and procedure scalars,
   records, or tables intentionally
5. **Two-phase components** - Gather phase + render phase

## Server Rendering

You don't need to worry about server vs client rendering. Yolm serves the first rendered page on the server, then subsequent pages are rendered in the browser by the Yolm DOM runtime. Components are isomorphic.

## Styling

Yolm supports both Tailwind and CSS-in-JS:

- Use `className` prop with Tailwind classes (preferred)
- Use `sx` prop for things that can't be done in Tailwind

## Design Principles

Follow Refactoring UI principles:

- **Visual Language**: Minimalism with subtle shadows, rounded corners, white space
- **Color Philosophy**: Use consistent palette with four treatment types:
  - plain (minimal styling)
  - outlined (bordered with transparent backgrounds)
  - soft (subtle colored backgrounds)
  - solid (full-color with high contrast)
- **Typography**: Clear hierarchy with 3-4 heading levels and body sizes
  - Readable line heights (1.5-1.7× for body text)
- **Page Structure**:
  - Create visual rhythm with consistent spacing between sections
  - Group related elements with proximity and shared background treatments
  - Use card-based layouts for content organization
  - Maintain generous margins and padding for breathing room
- **Interface Patterns**:
  - Design forms with clear labels and consistent input styling
  - Use subtle animations for state changes
  - Structure dashboards with card-based modules and clear visual hierarchy

## Important Rules

- Only use components and props from documentation or examples
- NEVER add a `key` prop
- Use `<Each>` for runtime iteration over tables
- Generation-time array iteration doesn't need keys

## URL and Query Parameters

Yolm provides several ways to work with URLs and query parameters:

### Route Parameters
Use `{param_name:type}` syntax in routes to capture URL segments:
```tsx
<Route path="/users/{user_id:id}">
  {/* user_id is available as a scalar */}
</Route>
```

### Query Parameters
Use `Data`'s `queryParams` prop to access URL query parameters:
```tsx
import { Data } from "std/data";

<Data
  queryParams={{
    q: { default: sql.lit``, type: "String" },
    page: { default: sql`1`, type: "BigInt" },
  }}
  procedure={(s) => {
  // q and page are available as scalars
  s.defTable("results", sql`select * from db.items where name like '%' || q || '%'`);
  }}
>
  {/* children can use q and page scalars */}
</Data>
```

See the [Routing](./routing.md) documentation for more details.
