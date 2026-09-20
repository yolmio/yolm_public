---
title: Server Statements
description: Server-side statements in Yolm procedures including transactions, HTTP requests, and file operations.
tags:
  - procedures
  - server
  - transactions
  - http
  - files
---

# Server Statements

These are available in all server-side statement types (GeneralServerStatements, UiServerStatements, StateStatements, EndpointStatements).

## Database Operations

### Transactions

```typescript
s.startTransaction();
s.commitTransaction();
s.rollbackTransaction();

// Capture the ID assigned by this commit.
s.startTransaction();
// ...writes...
s.commitTransaction("committed_tx_id");

// Undo a transaction
s.undoTx(sql`transaction_id`);
```

Pass a bigint scalar name to `commitTransaction` when later UI or procedure
logic needs the committed transaction ID. Do not recover it with
`select max(tx_id) from tx_op`: `tx_op` spans every table's history, so an
unbounded aggregate can load the whole database WAL and is also not a safe way
to identify a specific concurrent commit.

A commit that made no changes (for example an `update` that matched no rows or
wrote only identical values) assigns no transaction ID and sets the scalar to
null. Treat a null scalar as "committed with no changes", not as a failure.

### Restore Deleted Records

```typescript
s.restore('users', sql`SELECT id FROM deleted_user_ids`);
```

### Dynamic SQL

```typescript
s.dynamicModify(sql`'INSERT INTO ' || table_name || ' (name) VALUES (''John'')'`);

s.dynamicQuery({
  query: sql`'SELECT * FROM ' || table_name`,
  defResultTable: 'query_results',
  columnCount: 5,
  defColumnMetaTable: 'column_metadata'
});

s.dynamicQueryToCsv(sql`'SELECT * FROM ' || table_name`, { defScalar: 'results' });
```

## HTTP Operations

### Basic Request

```typescript
s.request({
  uri: sql.lit`https://api.example.com/users`,
  method: 'GET',
  headers: [{ name: sql.lit`Content-Type`, value: sql.lit`application/json` }],
  defReceiveJson: 'response_data'
});
```

### POST with JSON Body

```typescript
s.request({
  uri: sql.lit`https://api.example.com/users`,
  method: 'POST',
  headers: [{ name: sql.lit`Content-Type`, value: sql.lit`application/json` }],
  json: { name: sql`user.name`, email: sql`user.email` },
  defReceiveJson: 'response_data',
  defResponseRecord: 'response_info',
  defResponseHeadersTable: 'response_headers'
});
```

### OAuth Support

```typescript
s.request({
  uri: sql.lit`https://api.example.com/secure`,
  oauth: {
    type: "ServiceAccount",
    privateKey: sql`credentials.private_key`,
    tokenUri: sql`credentials.token_uri`,
    clientEmail: sql`credentials.client_email`,
    scope: sql.lit`https://www.googleapis.com/auth/spreadsheets`
  }
});
```

### Stream a Response Into a Blob

Potentially large binary responses should bypass procedure memory and stream
through the runtime's bounded private-disk staging into blob storage. The
maximum and accepted statuses are mandatory; an unaccepted status leaves the
hash null while preserving the response record.

```typescript
s.request({
  uri: sql.lit`https://api.example.com/archive.bin`,
  method: "GET",
  receiveBody: {
    type: "Blob",
    scalar: "archive_blob_hash",
    maxBytes: 25 * 1024 * 1024,
    acceptedStatuses: [200],
  },
  defResponseRecord: "response_info",
});
```

## File Operations

```typescript
// Create a blob outside the database
s.createBlob(sql.lit`file content`, { defHashScalar: 'uuid_scalar' });

// Read blob content
s.readBlob(sql`file_uuid`, { defContentScalar: 'content_scalar' });

// Delete a blob
s.removeBlob(sql`file_uuid`);

// Remove multiple files
s.removeFiles(sql`SELECT id FROM files_to_delete`);
```

## Image Operations

```typescript
s.resizeImage({
  inBytes: sql`image_data`,
  imageType: sql.lit`image/jpeg`,
  resizeType: sql.lit`cover`,
  width: sql`800`,
  height: sql`600`,
  defOutBytesScalar: 'resized_image'
});
```

## Template Operations

```typescript
// Render template
s.defScalar("user_name", sql`user.name`);
s.renderTemplate({
  template: sql`Hello {{name}}`,
  scope: { name: "user_name" },
  defOutputScalar: 'rendered_content'
});

// Render MJML email template
s.renderMjml({
  mjml: sql.lit`<mjml>...</mjml>`,
  defOutputScalar: 'html_output'
});
```

## Search Operations

```typescript
s.search({
  resultTable: 'search_results',
  query: sql`search_term`,
  limit: sql`10`,
  offset: sql`0`,
  config: {
    tokenizer: {
      splitter: { type: "Alphanumeric" },
      filters: [{ type: "AsciiFold" }, { type: "Lowercase" }],
    },
    style: { type: "Fuzzy", ...system.searchConfig.defaultFuzzyConfig },
    tables: [
      {
        table: "users",
        fields: [{ field: "name", priority: 1 }, { field: "email", priority: 2 }]
      }
    ]
  }
});
```

## Upload Public Assets

```typescript
s.uploadPublicAsset({
  content: sql`file_content`,
  contentType: sql.lit`image/png`,
  defHashScalar: 'asset_hash'
});
```

---

## Endpoint Statements (API-specific)

These are available only in API endpoint procedures:

### HTTP Response Control

```typescript
s.setHttpStatus(sql`404`);
s.getHeader(sql.lit`Content-Type`, { defScalar: 'content_type' });
s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
s.noCaching();
```

### Cookie Management

```typescript
s.getCookie(sql.lit`session_id`, { defRecord: 'session_record' });
s.setCookie(sql.lit`session_id`, sql`new_id`, {
  secure: true,
  httpOnly: true
});
s.removeCookie(sql.lit`temp_data`);
```

### Response

```typescript
s.returnBlob(sql`file_uuid`);
```

---

## State Statements

Available in State component procedures:

```typescript
// Cookie Access
s.getCookie(sql.lit`session_id`, { defRecord: 'session_record' });

// File References
s.fileRefTable('file_refs');
```

---

## Authorize Statements

Available in Authorize component procedures:

```typescript
s.getCookie(sql.lit`auth_token`, { defRecord: 'auth_record' });
s.setCurrentUser(sql`user_id`);
```
