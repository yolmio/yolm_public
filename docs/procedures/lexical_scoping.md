---
title: Procedure Lexical Scoping
description: How Yolm procedure declarations are scoped, how def and set bindings differ, and how to fix duplicate declaration and shadowing errors.
tags:
  - procedures
  - validation
  - debugging
related:
  - procedures/overview.md
  - procedures/declaration_liveness.md
  - procedures/base_statements.md
---

# Procedure Lexical Scoping

Yolm procedures use lexical scope for temporary scalars, records, and tables.
A declaration creates a new binding in the current procedure block. An
assignment updates an existing visible binding.

This applies to procedure bodies in `Data`, `Form`, event handlers, APIs,
reactors, scheduled jobs, scripts, tests, and helper functions that emit
statements.

## Declaration Rules

These statement builders create fresh bindings in the current lexical block:

- `s.defScalar`
- `s.defRecord`
- `s.defTable`
- statement output options that define a scalar, record, or table

These statement builders update existing visible bindings:

- `s.setScalar`
- statement output options that set a scalar, record, or table

Re-declaring the same name in the same block is a compile error. Re-declaring
the same name in a nested block is allowed, but the nested declaration shadows
the outer binding only inside that nested block.

```tsx
// Fresh declaration in the current block.
s.defScalar("total", sql`0`);

// Assignment to the existing visible scalar.
s.setScalar("total", sql`total + 1`);

// Fresh nested declaration. This does not update the outer total.
s.if(sql`should_override`, (s) => {
  s.defScalar("total", sql`100`);
});
```

Use declarations for new procedure-local state. Use assignments when the code
is meant to populate or mutate state that was declared earlier.

## Blocks That Create Scope

Yolm creates a fresh lexical scope for nested procedure bodies, including:

- `s.if` true and false branches
- `s.conditional` branches
- `s.while` bodies
- `s.try`, `catch`, and `finally` bodies
- `s.block` bodies
- cursor, table, and query iteration bodies
- UI control-flow children that emit nested procedure bodies

Bindings declared inside one of these blocks are not visible outside that
block. A same-named inner declaration does not populate an outer declaration.

## Defining Versus Setting Outputs

Many helper statements produce output bindings. Treat those output options like
`defScalar` or `setScalar`.

Use a defining output option only when the statement introduces a new binding:

```tsx
s.renderTemplate({
  template: sql`template_body`,
  defOutputScalar: "rendered_body",
});
```

Use a setting output option when an outer binding already exists and the
statement should assign to it:

```tsx
s.defScalar("rendered_body", {
  type: { type: "String", maxLength: 1000000 },
});

s.if(sql`use_template`, (s) => {
  s.renderTemplate({
    template: sql`template_body`,
    setOutputScalar: "rendered_body",
  });
});
```

Do not rely on a defining output to overwrite an existing binding. If
downstream code reads one shared binding after a branch or loop, hoist the
declaration and set it from each branch that can produce the value.

## Fixing Duplicate Declaration Errors

A duplicate declaration means two declarations with the same name were emitted
in one lexical block.

Common fixes:

- If the second statement should update the first binding, use `s.setScalar` or
  a set-output option.
- If each use needs an independent temporary, rename the temporary and update
  reads in the same block.
- If a reusable helper emits fixed temporary names and can be called twice in
  the same block, wrap the helper body in `s.block` or give the temporary names
  a deterministic helper-local prefix.
- If two branches both define a result that is read after the branch, declare
  the result before the branch and set it inside each branch.

```tsx
// Bad: both renderTemplate calls define rendered_body in the same block.
s.renderTemplate({
  template: sql`primary_template`,
  defOutputScalar: "rendered_body",
});
s.renderTemplate({
  template: sql`fallback_template`,
  defOutputScalar: "rendered_body",
});

// Good: one declaration, then assignments.
s.defScalar("rendered_body", {
  type: { type: "String", maxLength: 1000000 },
});
s.renderTemplate({
  template: sql`primary_template`,
  setOutputScalar: "rendered_body",
});
s.renderTemplate({
  template: sql`fallback_template`,
  setOutputScalar: "rendered_body",
});
```

## Shadowing And Liveness Errors

If a never-written or never-read error mentions a same-named nested
declaration, treat it as a real lexical scoping bug. A nested declaration does
not write the outer binding. See
[Declaration Liveness Validation](declaration_liveness.md) for the detailed
diagnostics and fixes.

## Reusable Helper Pattern

Reusable helpers should not leak generic temporary names into the caller's
block when the helper can be used more than once. A helper expands inline at
every call site; share runtime logic through a
[stored procedure](../concepts/stored_procedures.md) instead.

Use a private `s.block` when all helper temporaries are local to the helper:

```tsx
function sendNotification(s: GeneralServerStatements, recipient: Sql) {
  s.block((s) => {
    s.defScalar("body", sql`build_notification_body()`);
    s.sendEmail({
      to: recipient,
      subject: sql.lit`Notification`,
      htmlBody: sql`body`,
      optIn: true,
    });
  });
}
```

Use a caller-provided output name only when callers need to read the result
after the helper returns. In that case, document whether the helper defines the
output or sets a predeclared output.

## Review Checklist

Before considering a lexical-scope fix complete, check that:

- every `def*` call still represents a fresh binding
- every mutation of an existing binding uses `setScalar` or a set-output option
- no outer binding depends on a same-named inner declaration
- no branch-local declaration is read after the branch
- reusable helpers cannot collide when called twice in the same block
- `allowNoRead` was not used to hide a redeclaration or shadowing bug
