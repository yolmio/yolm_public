---
title: Common Patterns
description: Common solution patterns for Yolm systems, including schema, UI, procedure, and integration choices that agents should reuse.
tags:
  - concepts
  - patterns
  - best-practices
  - architecture
---

# Common Patterns

This document covers reusable solution patterns for Yolm systems.

## Activity Logging Pattern

Track entity lifecycle events with activity logs:

```typescript
// Define activity types
system.enum_({
  name: "order_activity_type",
  values: [
    "received",
    "dispatched",
    "completed_indexing",
    "auto_verified_no_errors_no_cases",
    "manual_verification_work_needed",
    "manual_verification_cleared",
    "reported",
    "reopen_to_indexing",
    "hung_order_alert",
  ],
});

// Activity log table
db.table("order_activity_logs", (table) => {
  table.fk("order_id", "orders").notNull();
  table.enum("order_activity_type", "order_activity_type").notNull();
  table.timestampUtc("activity_date").notNull();
  table.fk("user_id", "sys_users");  // Who triggered it (if applicable)
  table.text("notes", 10_000);
});

// Log activity in procedures
s.modify(sql`
  INSERT INTO db.order_activity_logs (
    order_id, order_activity_type, activity_date
  ) VALUES (
    order.id,
    'dispatched'::enums.order_activity_type,
    now()
  )
`);
```

### Benefits

- Complete audit trail
- Timeline view of entity lifecycle
- Debug process issues
- Analytics on process timing

## Multi-Status Entity Pattern

Entities often need separate status fields for different aspects:

```typescript
db.table("orders", (table) => {
  table.enum("status", "order_status").notNull();  // Overall status
  table.enum("billing_status", "billing_status").notNull();  // Billing lifecycle
  table.enum("verification_status", "verification_status");  // Verification state

  table.bool("fees_calculated").notNull().default(false);
  table.bool("invoiced").notNull().default(false);
  table.bool("reported").notNull().default(false);
});
```

This allows:
- Independent workflows (billing, verification, reporting)
- Precise reactor queries
- Clear business logic separation

## Mapping Tables for External Systems

When integrating with external systems, use mapping tables:

```typescript
// Map external provider IDs to internal entities
db.table("provider_clients", (table) => {
  table.fk("clients").notNull();
  table.enum("provider", "external_provider").notNull();
  table.string("account", 100).notNull().description(
    "External provider's ID for this client"
  );
  table.string("username", 100).notNull();
  // Keep provider credentials in StaticSecretsBlock, not in this table.
  table.string("url", 100).notNull();
  table.bool("use_test_url").notNull();
});

// Map external search type codes to internal enums
db.table("provider_search_type_mappings", (table) => {
  table.fk("clients");  // Some mappings are client-specific
  table.enum("provider", "external_provider").notNull();
  table.string("provider_code", 50).notNull();
  table.enum("our_search_type", "search_type").notNull();
  table.tinyUint("search_years");
});
```

## Flags vs Boolean Columns

For tracking completion of multi-step processes, use boolean flags:

```typescript
db.table("orders", (table) => {
  // These track independent completion states
  table.bool("fees_calculated").notNull().default(false);
  table.bool("invoiced").notNull().default(false);
  table.bool("reported_to_client").notNull().default(false);
  table.bool("researcher_paid").notNull().default(false);

  // Timestamp when each occurred
  table.timestampUtc("fees_calculated_at");
  table.timestampUtc("invoiced_at");
  table.timestampUtc("reported_at");
});
```

### Reactor Queries

```typescript
system.addReactor({
  name: "calculate_order_fees",
  query: sql`
    SELECT id FROM db.orders
    WHERE status = 'completed'::enums.order_status
      AND fees_calculated = false
  `,
  recordName: "order",
  procedure: (s) => {
    // Calculate and insert fees
    // ...

    // Mark complete
    s.modify(sql`
      UPDATE db.orders
      SET fees_calculated = true,
          fees_calculated_at = now()
      WHERE id = order.id
    `);
  },
});
```

## Case/Detail Pattern

When entities have variable-length child records:

```typescript
// Parent entity
db.table("orders", (table) => {
  table.fk("client_id", "clients").notNull();
  table.string("reference", 100).notNull();
  table.enum("search_type", "search_type").notNull();
});

// Child cases (0 to many per order)
db.table("order_cases", (table) => {
  table.fk("order_id", "orders").notNull();
  table.string("case_number", 50).notNull();
  table.string("court_name", 100);
  table.date("filing_date");
  table.enum("status", "case_status").notNull();
});

// Per-case fees (0 to many per case)
db.table("order_case_fees", (table) => {
  table.fk("order_case_id", "order_cases").notNull();
  table.enum("fee_type", "order_case_fee_type").notNull();
  table.money("amount");
  table.string("description", 200);
});
```

### Aggregating Child Data

```sql
select
  o.id,
  o.reference,
  count(oc.id) as case_count,
  coalesce(sum(ocf.amount), 0) as total_fees
from db.orders o
left join db.order_cases oc on o.id = oc.order_id
left join db.order_case_fees ocf on oc.id = ocf.order_case_id
group by o.id, o.reference
```

## Multi-Table Import Pattern

When receiving data from external sources, use staging tables:

```typescript
// Staging table for incoming orders
db.table("new_orders", (table) => {
  table.uuid("internal_id").notNull();  // External reference
  table.fk("client_id", "clients").notNull();
  table.string("reference", 100);
  table.string("first_name", 50);
  table.string("last_name", 50);
  table.enum("search_type", "search_type").notNull();
  table.enum("status", "import_status").notNull();
  table.timestampUtc("received_at").notNull();
  table.text("raw_xml", 1_000_000);  // Original payload for debugging
});

// Reactor processes imports
system.addReactor({
  name: "import_orders",
  query: sql`
    SELECT * FROM db.new_orders
    WHERE status = 'new'
  `,
  recordName: "new_order",
  procedure: (s) => {
    s.startTransaction();

    // Validate and transform
    // Insert into main orders table
    // Mark as imported
    s.modify(sql`
      UPDATE db.new_orders
      SET status = 'imported'::enums.import_status
      WHERE id = new_order.id
    `);

    s.commitTransaction();
  },
});
```

## Interface-Specific Code Mappings

Different clients/interfaces use different codes. Map them:

```typescript
db.table("interface_code_mappings", (table) => {
  table.enum("interface", "interface_type").notNull();
  table.fk("client_id", "clients");  // NULL = applies to all clients
  table.enum("code_type", "code_type").notNull();  // disposition, charge_type, etc.
  table.string("external_code", 50).notNull();  // What they send
  table.string("internal_code", 50).notNull();  // What we use
  table.string("description", 200);
});

// Use in transformations
s.defScalar(
  "internal_disposition",
  sql`
    (SELECT internal_code
     FROM db.interface_code_mappings
     WHERE interface = 'external_provider'::enums.interface_type
       AND code_type = 'disposition'::enums.code_type
       AND external_code = new_order.disposition_code
     LIMIT 1)
  `
);
```

## Effective Dating for Rates

Support historical accuracy and future changes:

```typescript
db.table("client_rates", (table) => {
  table.fk("client_id", "clients");
  table.enum("rate_type", "rate_type").notNull();
  table.money("amount");
  table.date("effective_from").notNull();
  table.date("effective_to");  // NULL = no end date
});

// Query for current rate
sql`
  SELECT amount
  FROM db.client_rates
  WHERE client_id = target_client_id
    AND rate_type = 'search_fee'
    AND current_date BETWEEN effective_from AND COALESCE(effective_to, '2099-12-31'::date)
  ORDER BY effective_from DESC
  LIMIT 1
`

// Query for historical rate (as of specific date)
sql`
  SELECT amount
  FROM db.client_rates
  WHERE client_id = target_client_id
    AND rate_type = 'search_fee'
    AND order_date BETWEEN effective_from AND COALESCE(effective_to, '2099-12-31'::date)
  ORDER BY effective_from DESC
  LIMIT 1
`
```

## External ID Pattern (Many-to-One External Mapping)

Some external systems have multiple IDs for one internal entity:

```typescript
db.table("external_client_ids", (table) => {
  table.fk("clients").notNull();
  table.string("external_customer_id", 8).notNull();

  // One client can have multiple external customer IDs
  // because the provider has multiple sub-clients per company
});

// Look up client from external ID
sql`
  SELECT client_id
  FROM db.external_client_ids
  WHERE external_customer_id = external_id
`
```

## AKA (Also Known As) Pattern

For entities with alternate names:

```typescript
// Main entity with primary name
db.table("people", (table) => {
  table.string("first_name", 50).notNull();
  table.string("middle_name", 50);
  table.string("last_name", 50).notNull();
});

// Alternate names
db.table("person_akas", (table) => {
  table.fk("person_id", "people").notNull();
  table.string("first_name", 50).notNull();
  table.string("middle_name", 50);
  table.string("last_name", 50);
  table.bool("first_name_only").notNull().description(
    "True if only first name differs (e.g., 'Bob' for 'Robert')"
  );
});

// Search including AKAs
sql`
  SELECT DISTINCT p.*
  FROM db.people p
  LEFT JOIN db.person_akas aka ON p.id = aka.person_id
  WHERE p.last_name = search_last_name
    AND (
      p.first_name = search_first_name
      OR aka.first_name = search_first_name
    )
`
```

## Automation Instance Tracking

Track which automated processes handled which records:

```typescript
db.table("automation_instances", (table) => {
  table.string("machine", 50).notNull();
  table.string("app", 50).notNull();
  table.timestampUtc("started_at").notNull();
});

db.table("automation_searches", (table) => {
  table.fk("order_id", "orders").notNull();
  table.fk("automation_instance_id", "automation_instances");
  table.timestampUtc("assigned_at");
  table.enum("status", "automation_search_status").notNull();
  table.fk("processed_by", "sys_users");
});
```

This enables:
- Debugging which automation run processed what
- Load balancing across instances
- Tracking automation performance
- Recovering from automation failures
