---
title: Coding Conventions
description: Standardized coding conventions for Yolm systems, including SQL, TypeScript, styling, and general development practices.
tags:
  - coding
  - conventions
---

# Coding Conventions

- SQL: lowercase snake_case for keywords and function names
- TypeScript:
  - camelCase for variables and functions
  - PascalCase for classes
  - Always use blocks for if, else, for, while, try, catch, finally
  - Prefer for...of over forEach
  - Use import type for type imports
- Indentation: 2 spaces
- String literals:
  - SQL: Single quotes ('example')
  - TypeScript: Backticks for interpolation, double quotes otherwise
- Use const for variables that won't be reassigned
- Prefer arrow functions for callbacks and anonymous functions
- Separate statements with semicolons when using the builder pattern for procedures
- For runtime SQL:
    - Use `sql` for expressions, modifications (insert, update, delete), and queries
    - Use `sql.lit` for string literal expressions
    - Use `sql.ref` for dynamic identifiers such as table or field names
    - Never build SQL by concatenating strings
- Use early returns in procs to reduce nesting
- Reuse code at highest level of abstraction possible
- Reuse themes for styling to minimize custom CSS
- Leverage pre-built components, pages, blocks and functions from packages folder when possible
- Use meaningful and descriptive names for tables, fields, and variables
- Minimize comments, only comment complex logic or non-obvious code
- Try to put each statement on its own line separated by semicolons (when using the builder pattern)
