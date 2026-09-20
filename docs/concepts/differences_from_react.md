---
title: Differences from React
description: Understanding the fundamental differences between Yolm and React, specifically regarding generation time vs runtime behavior.
tags:
  - concepts
  - react
  - comparison
---

# Differences from React

While Yolm uses TSX syntax similar to React, its underlying architecture is fundamentally different. The most important distinction is that Yolm components run at **Generation Time**, not at runtime in the browser.

## Common Pitfalls for React Developers

### 1. The `key` Prop

In React, the `key` prop is essential for list reconciliation. In Yolm, **the `key` prop serves no purpose and should never be used.**

```tsx
// ❌ INCORRECT (React style)
array.map((item) => <div key={item.id}>{item.name}</div>);

// ✅ CORRECT (Yolm style)
array.map((item) => <div>{item.name}</div>);
```

Generation-time array iteration does not require keys. For runtime iteration over database tables, use the `<Each>` component.

### 2. Data Component vs. React `useState`

Yolm uses the `Data` component (from `std/data`) to define runtime state. Unlike React's `useState` hook, the `Data` component wraps its children and defines state that is stored in the Yolm runtime (in SQL tables/scalars), not in a JavaScript closure.

#### Basic Usage

Use the `Data` component to define scalars or tables that will be available to all child components via SQL.

```tsx
import { Data } from "std/data";

function CounterComponent() {
  return (
    <Data procedure={(s) => {
      s.defScalar("count", 0);
      s.defScalar("display_text", sql`'Count is: ' || count`);
    }}>
      <div>{sql`display_text`}</div>
    </Data>
  );
}
```

#### Watching for Changes

You can make a Data component re-run its procedure when specific scalars change by using the `watch` prop.

```tsx
function DependentComponent() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("a", 1);
        s.defScalar("b", sql`1 + a`);
      }}
      watch={[sql`some_scalar_above`]}
    >
      <div>{sql`b`}</div>
    </Data>
  );
}
```

## Summary Table

| Feature | React | Yolm |
| :--- | :--- | :--- |
| **Execution** | Runtime (Browser/Server) | Generation Time (Build) |
| **State Storage** | JS Memory | SQL Tables / Scalars |
| **`key` prop** | Required for lists | Never used |
| **`Data` component** | Reactive JS state (`useState`) | Runtime SQL state definition |
| **Updates** | Re-renders component | Updates SQL state & DOM |
