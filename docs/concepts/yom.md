---
title: YOM (Yolm Object Model)
description: The complete, declarative and executable representation of a Yolm system as a unified object model that serves as input for system compilation.
tags:
  - concepts
  - architecture
  - yom
---

# YOM (Yolm Object Model)

YOM is the complete, declarative and executable representation of a Yolm system as a unified object model.

## What is YOM?

- Generated from TypeScript code during generation time
- Serves as the input for system compilation by the Yolm compiler
- Contains database definitions, UI nodes, APIs, scheduled jobs, and all other system components
- Serialized as JSON for the compiler to process

## How YOM is Created

When you write TypeScript code defining your Yolm system, that code runs at generation time to produce the YOM. For example:

```tsx
const { db } = system;

db.table("todos", (table) => {
  table.string("title", 100).notNull();
});

system.app({
  domain: "todos.yolm.app",
  ui: <TodoList />,
});
```

This TypeScript executes once to generate a YOM containing:
- The `todos` table definition
- The app configuration and UI node tree
