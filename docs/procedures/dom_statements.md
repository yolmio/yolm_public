---
title: DOM Statements
description: Client-side DOM statements in Yolm for navigation, element manipulation, events, clipboard, and window operations.
tags:
  - procedures
  - dom
  - client-side
  - navigation
  - events
---

# DOM Statements

Client-side statements for UI interactions.

## Navigation

```typescript
s.navigate(sql.lit`/dashboard`);
s.navigate(sql.lit`/dashboard`, sql`true`); // With replace option

// URL parameters
s.setQueryParam('page', sql`2`); // Uses the param's declared history
s.setQueryParam('filter', sql`'active'`, sql`true`); // Force replace
```

`setQueryParam` writes the param and updates the URL, like `setScalar` on a
query param. Without the third argument it follows the `history` declared on
the `Data` `queryParams` entry (default `"replace"`); the argument overrides
that for one write.

## Server Interaction

For ordinary mutations prefer `Form` or `ActionButton`, which own loading,
errors, and refetch; see
[mutation loading and error states](./patterns.md#mutation-loading-and-error-states).
Use these statements directly only when no such primitive fits.

```typescript
// Simple server call
s.server((s) => {
  s.startTransaction();
  s.modify(sql`insert into db.todos (title) values ('Buy milk')`);
  s.commitTransaction();
  s.refetch();
});

// With file upload: in onFileChange, `file` lists the selected files
s.defRecord("dom_file", sql`select * from file limit 1`);
s.serverWithFiles(sql`select uuid from file`, (s) => {
  s.readDomFile(sql`dom_file.uuid`, "content");
  s.createBlob(sql`content`, { defHashScalar: "blob_hash" });
  // ...then insert a row referencing blob_hash in a transaction
});

// With error handling
s.tryServer({
  body: (s) => { /* UiServerStatements */ },
  transferFiles: sql`select uuid from file`,
  errorName: "server_error",
  catch: (s) => s.debugExpr(sql`server_error.message`)
});
```

### Returning Values From Server Blocks

`server()` and `tryServer()` may update `ui.*` state, and those updates are
applied back to the UI. However, if the same event handler continues after the
server call and needs a server-computed value, return that value through a
proc-local scalar or table declared before the server block. Do not rely on
reading a server-mutated `ui.*` value in the immediate client continuation.

```typescript
s.defScalar("created_id", { type: "BigInt" });

s.tryServer({
  body: (s) => {
    s.modify(sql`
      insert into db.items (name)
      values (ui.name)
      returning id into created_id
    `);
  },
});

s.navigate(sql.concat(sql.lit`/items/`, sql`created_id`));
```

Use `ui.*` writes for UI state that should be reflected in the rendered tree.
Use proc-local result scalars/tables for values the client-side continuation
needs to branch on, navigate with, or pass to later client statements.
For multirow output, row images, and `MERGE` behavior, see
[RETURNING INTO](../sql/basic_operations.md#returning-into).

## Element Manipulation

```typescript
s.element(sql.lit`button-id`).click();
s.element(sql.lit`input-id`).focus();
s.element(sql.lit`input-id`).blur();
s.element(sql.lit`div-id`).scrollIntoView({ behavior: sql.lit`smooth`, block: sql.lit`center` });
s.element(sql.lit`input-id`).setSelectionRange({ start: sql`0`, end: sql`5` });
s.element(sql.lit`button-id`).getBoundingClientRect('rect');
s.element(sql.lit`div-id`).getScrollHeight('height');
```

## Window Operations

```typescript
s.window.focus();
s.window.print();
s.window.open(sql.lit`https://example.com`, sql.lit`_blank`);
s.window.scrollTo({ top: sql`0`, left: sql`0`, behavior: sql.lit`smooth` });
s.window.getInnerHeight('height');
```

## Location and History

```typescript
s.location.reload();
s.location.assign(sql.lit`/dashboard`);

s.history.back();
s.history.forward();
s.history.go(sql`-2`);
```

`history.back()` is not a reliable way to return to a list: the previous entry
may be a different page. Use a `backLink` on the link or button instead; see
[Routing](../ui/routing.md#returning-to-a-list).

## Event Handling

```typescript
s.event.stopPropagation();
s.event.preventDefault();
s.event.getTarget('event_target');
s.event.getCurrentTarget('current_target');
```

### Keyboard Events

```typescript
s.switchKeyboardEvent({
  'Enter': (s) => s.debug('Enter pressed'),
  'Escape': (s) => s.debug('Escape pressed'),
  'ctrl+s': (s) => s.debug('Save shortcut'),
  'default': (s) => s.debug('Other key pressed')
});
```

## Clipboard

```typescript
s.clipboard.readText('clipboard_content');
s.clipboard.writeText(sql.lit`text to copy`);
```

## Cookie Management

```typescript
s.setCookie(sql.lit`user_pref`, sql.lit`dark_mode`, {
  expires: sql.lit`7d`,
  secure: true,
  path: sql.lit`/`
});
s.removeCookie(sql.lit`temp_data`);
```

## File Operations

```typescript
s.download(sql.lit`file.txt`, sql`content`, sql.lit`text/plain`);
s.readDomFile(sql`dom_file.uuid`, 'file_contents');
```

## Tasks

```typescript
s.startTask((s) => { /* Background task */ });
s.startTaskWithOpts({
  procedure: (s) => { /* Background task */ },
  detached: true,
  handleScalar: 'task_id'
});
s.waitOnTask(sql`task_id`);
s.cancelTask(sql`task_id`);
```

## UI Operations

```typescript
s.commitUiTreeChanges();  // Show loading state immediately
s.runTreeChangeEffects();
s.sleep(sql`1000`);       // Sleep for 1000ms
s.logOut();
```

## Drag and Drop

```typescript
s.setDropEffect(sql.lit`copy`);
s.setEffectAllowed(sql.lit`copyMove`);
```

## View Transitions

```typescript
s.triggerViewTransition('after', sql.lit`slide`);
```

## Document Properties

```typescript
s.document.getHidden('is_hidden');
```

---

## UiServerStatements

When inside `s.server()` or `s.tryServer()`, you have access to UiServerStatements:

```typescript
// Navigation from server
s.navigate(sql.lit`/dashboard`);
s.setQueryParam('page', sql`2`);

// Cookie Management
s.getCookie(sql.lit`session_id`, { defRecord: 'session_record' });
s.setCookie(sql.lit`user_pref`, sql.lit`dark_mode`, {
  expires: sql.lit`7d`,
  secure: true,
  path: sql.lit`/`
});
s.removeCookie(sql.lit`temp_data`);

// File operations
s.readDomFile(sql`file_id`, 'file_content');
```
