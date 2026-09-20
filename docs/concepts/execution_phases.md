---
title: Execution Phases
description: Understanding Yolm's three execution phases - generation time (TypeScript), compile time (Rust compiler), and runtime on Yolm DB with SQL and procedures only.
tags:
  - concepts
  - architecture
  - generation-time
  - runtime
---

# Execution Phases

The basic execution flow in Yolm is:

1. **Generation Time**: TypeScript runs via Deno to generate YOM (Yolm Object Model)
2. **Compile Time**: Rust compiler processes YOM into optimized artifacts
3. **Runtime**: Only SQL and Yolm procedures execute - **no TypeScript available**

## Critical Understanding

During runtime, general TypeScript values, JavaScript arrays, JavaScript
classes, and JavaScript loops do not execute. Yolm statement builders still
provide runtime control flow such as `if`, `while`, and `forEachTable`; use
those procedures over scalars, records, and tables accessible via SQL.

## Generation Time

- When TypeScript is executed
- Components are processed during this phase and generate UI nodes in the YOM
- Produces a single YOM object containing database definitions, UI nodes and other information
- Serializes to JSON

## Compile Time

- When the Yolm compiler (written in Rust) processes the system
- Validates the system: SQL syntax, type checks, etc.
- Converts YOM JSON into optimized artifacts, including optimized code

## Runtime (Execution Time)

- When the system is actively running
- Uses generated optimized code and artifacts
- Managed by the Yolm Runtime
- Executes against Yolm DB, Yolm's own HTAP database engine, not PostgreSQL
- Only tables, records and scalars are accessible at this point

## Why This Separation?

Yolm uses generation time/runtime separation because it allows:

- Secure database access without exposing queries
- Single-roundtrip efficiency
- Type-safe SQL end to end

## The Yolm Runtime

The Yolm Runtime is a set of programs that execute the system, including:

- Database and search engine
- Workflow engine
- Web service
- DOM runtime
