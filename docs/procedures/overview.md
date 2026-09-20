---
title: Procedures Overview
description: Introduction to Yolm procedures - sequences of statements executed in response to events like user actions, scheduled events, or external requests.
tags:
  - procedures
  - overview
  - statements
---

# Procedures Overview

Procedures (procs) are a set of Yolm statements executed in response to an event (user action, scheduled event, external request).

## Key Concepts

- **Procedures act like macros**: Functions in procedures run at generation time to produce code, NOT at runtime
- **Lexical scoping**: declarations create bindings in the current block; use `setScalar` or set-output options to assign outer bindings
- **No arrays**: Use tables instead. Split strings with `string.split` table function
- **Transaction speed**: Keep transactions fast - avoid sleeps and requests inside transactions

## Important Notes

- Always use snake_case for names
- Tables should be plural, records/fields/scalars should be singular
- A scalar cannot have type null - use `s.defScalar("name", { type })` to define without initializing
- Always use template literals (`sql`, `sql.lit`) for SQL
