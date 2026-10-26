---
title: Utility Functions
description: Helper functions available in Yolm for common tasks like string formatting, description management, and more.
tags:
  - concepts
  - utilities
  - helpers
  - dedent
---

# Utility Functions

Yolm provides several utility functions to help with common tasks during system definition.

## dedent

The `dedent` function removes common leading whitespace from multi-line strings, making it easy to write readable inline documentation:

```typescript
import { dedent } from "std/utils";

db.table("external_client_ids", (table) => {
  table.description(
    dedent`
      Mapping table for an external provider integration.
      The provider handles interfaces for clients.
      It sends over a customer ID for each client, and we store it here
      and map it to the client.

      This is a one-to-many relationship because each provider client
      can have multiple customers and therefore multiple external IDs
      that need to be mapped to the client.
    `
  );
  table.fk("clients").notNull();
  table.string("external_customer_id", 8).notNull();
});
```

Without `dedent`, you would need to write:

```typescript
table.description(
  "Mapping table for an external provider integration.\n" +
  "The provider handles interfaces for clients.\n" +
  "..."
);
```

### How dedent Works

1. Finds the minimum indentation level across all non-empty lines
2. Removes that indentation from every line
3. Trims leading and trailing blank lines
4. Returns the cleaned string

```typescript
const text = dedent`
  First line
    Indented line
  Back to normal
`;

// Result:
// "First line\n  Indented line\nBack to normal"
```

## Field Descriptions

Use `.description()` on table fields to document their purpose:

```typescript
db.table("provider_clients", (table) => {
  table.fk("clients").notNull();
  table.enum("provider", "external_provider").notNull();
  table.string("account", 100).notNull().description(
    "Internal ID for client in the provider, we must send it along in order to correctly identify the client"
  );
  table.string("username", 100).notNull();
  // Keep provider credentials in StaticSecretsBlock, not in this table.
  table.bool("use_test_url").notNull();
});
```

### Multi-line Descriptions with dedent

Combine `dedent` with `.description()` for longer explanations:

```typescript
db.table("automation_mapping", (table) => {
  table.string("br_value", 100).description(
    dedent`
      What the source system has for the value. For example, when mapping
      court names, 'SC' here represents 'Superior Court'.
    `
  );
  table.string("web_value", 100).description(
    dedent`
      What the web interface has for the value.
      This is what the external system sends us.
    `
  );
  table.enum("data_type", "automation_mapping_data_type").notNull();
  table.fk("jurisdictions").notNull();
});
```

## Table Descriptions

Document entire tables:

```typescript
db.table("jurisdictions", (table) => {
  table.description("Courts and counties we file and search orders in");
  table.string("name", 100).notNull();
  // ...
});
```

Do not create a persistent table for intermediate data that lives only while
one procedure runs. Declare a procedure table instead; it is local to that
execution and leaves nothing in the schema:

```typescript
s.defTable("case_list", {
  fields: [
    { name: "order_id", type: "BigUint", notNull: true },
    { name: "case_number", type: { type: "String", maxLength: 50 } },
  ],
});
```

## Best Practices

1. **Use dedent for multi-line descriptions** - Improves code readability
2. **Document complex relationships** - Explain why tables exist
3. **Explain business logic** - Not just what fields are, but why they're needed
4. **Reference external systems** - Name third-party integrations explicitly
5. **Note unusual patterns** - Call out special cases or edge cases

## Example: Well-Documented Table

```typescript
import { dedent } from "std/utils";

db.table("batch_provider_clients", (table) => {
  table.description(
    dedent`
      Batch provider client configuration.

      This provider sends batches of orders.
      Each order can have 1 name with multiple jurisdictions and
      search types, requiring us to create many internal orders
      from a single provider order.
    `
  );

  table.fk("clients").notNull();

  table.string("account_code", 100).notNull().description(
    "Internal ID for client in the provider. We must send this to correctly identify the client."
  );

  table.string("client_site_id", 100).notNull();
  table.string("provider_site_id", 100).notNull();
  table.string("user_id", 100).notNull();
  // Keep provider credentials in StaticSecretsBlock, not in this table.

  table.bool("all_caps").notNull().description(
    "Some clients want certain fields returned in all caps"
  );

  table.bool("send_pending_updates").notNull().description(
    "Some clients want to receive status updates for pending orders, others don't"
  );
});
```

This makes it clear to future developers (and AI assistants) exactly what this table does and why it exists.
