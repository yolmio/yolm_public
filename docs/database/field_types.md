---
title: Database Field Types
description: All available field types in Yolm database tables including strings, numbers, dates, and specialized types like phone numbers.
tags:
  - database
  - fields
  - types
---

# Database Field Types

Yolm table fields use the builder methods below. In SQL, some compact field
types surface as wider SQL numeric types; see [Type Conversion](#type-conversion).

## String Types

There is one core string type. Length is measured in Unicode scalar values,
not bytes or user-perceived grapheme clusters. Simple Unicode code points such
as `Ѓ` and `🎂` count as one; a compound emoji such as `🤦🏻‍♂️` counts as
multiple scalar values even though it renders as one grapheme.

### string

```ts
table.string("name", 200).notNull();
table.string("description", 1000);
```

### text

Alias for `string` with a `maxLength` parameter:

```ts
table.text("content", 10000);
table.text("notes", 5000).multiline();  // Renders as textarea in UI
```

### String Modifiers

```ts
table.string("code", 20)
  .notNull()
  .notEmpty()
  .collation("Binary")
  .autoTrim("Both")
  .minLength(2)
  .maxBytesPerChar(4);
```

- `maxLength(...)` changes the maximum character length.
- `minLength(...)` sets a minimum character length.
- `notEmpty()` is shorthand for `minLength(1)`.
- `collation("Binary" | "NoCase")` overrides the database default.
- `autoTrim("None" | "Left" | "Right" | "Both")` overrides the database
  default.
- `maxBytesPerChar(...)` caps per-character byte storage.

### multiline Modifier

The `.multiline()` modifier indicates a field should be rendered as a multi-line textarea in the UI:

```ts
table.string("comment", 500).multiline();
table.text("description", 1000).multiline();
```

## Numeric Types

Unlike most databases, Yolm supports unsigned integers for efficient storage.

### Integer Types

| Type | Storage | Range |
|------|---------|-------|
| `tinyInt` | 1-byte signed | -128 to 127 |
| `smallInt` | 2-byte signed | -32,768 to 32,767 |
| `int` | 4-byte signed | -2,147,483,648 to 2,147,483,647 |
| `bigInt` | 8-byte signed | -9,223,372,036,854,775,808 to 9,223,372,036,854,775,807 |
| `tinyUint` | 1-byte unsigned | 0 to 255 |
| `smallUint` | 2-byte unsigned | 0 to 65,535 |
| `uint` | 4-byte unsigned | 0 to 4,294,967,295 |
| `bigUint` | 8-byte unsigned | 0 to 18,446,744,073,709,551,615 |

```ts
table.int("quantity");
table.bigInt("large_number");
table.smallInt("small_value");

// Unsigned variants
table.uint("positive_quantity");
table.tinyUint("status_code");
table.smallUint("year");
```

### decimal

For precise decimal numbers with configurable precision and scale:

```ts
table.decimal("amount", { precision: 15, scale: 2 });
table.decimal("rate", { precision: 5, scale: 4, signed: true });
```

- `precision`: Total number of digits (max 28)
- `scale`: Digits after the decimal point
- `signed`: Whether negative values are allowed (default: true)

| Precision | Scale | Max Value |
|-----------|-------|-----------|
| 5 | 1 | 9999.9 |
| 5 | 2 | 999.99 |
| 10 | 5 | 99999.99999 |
| 5 | 5 | 0.99999 |

### money

Specialized currency field. By default this is a fixed-point decimal with
precision 13 and scale 2. Pass an integer backing type when you want to store
integer minor units explicitly:

```ts
table.money("amount");
table.money("price", { precision: 15, scale: 2 });
table.money("amount_in_cents", "BigInt");
```

Signedness differs from `decimal`:

- `table.money("amount")` (no options) is signed: precision 13, scale 2.
- With an explicit `{ precision, scale }` object, `signed` defaults to
  `false`, so the field rejects negative values. Pass `signed: true` for
  amounts that can be negative, such as adjustments or balances:
  `table.money("adjustment", { precision: 15, scale: 2, signed: true })`.
- With an integer backing type, signedness follows that type (`"BigInt"` is
  signed, `"BigUint"` is unsigned).

### Floating Point (real / double)

```ts
table.real("latitude");      // 4-byte, ~6 decimal digits precision
table.double("measurement"); // 8-byte, ~15 decimal digits precision
```

> **Warning:** Floating point types are not exact. For financial calculations, use `decimal` or `money`. Example: `0.1 + 0.2` results in `0.30000000000000004`.

## Boolean

```ts
table.bool("is_active").notNull();
table.bool("enabled").default(sql`true`);
```

## Date and Time

### date

Calendar date (year, month, day):

```ts
table.date("birth_date");
```

### time

Time of day without timezone:

```ts
table.time("start_time");
```

### Timestamp Types

Yolm has three timestamp types for different use cases:

| Type | Use Case | Storage |
|------|----------|---------|
| `timestampUtc` | Past events (`created_at`, `paid_at`) | Stored as UTC, converted to client timezone |
| `timestampTz` | Future events, appointments | Stored with timezone info |
| `timestampNaive` | Statically-known timezone | No timezone conversion |

```ts
table.timestampUtc("created_at");     // Recommended for most cases
table.timestampTz("appointment_at");  // For future dates with timezone
table.timestampNaive("legacy_date");  // When timezone is handled externally
```

**Guidance:**
- Use `timestampUtc` for dates in the past (interactions, logs, created/modified dates)
- Use `timestampTz` for dates in the future (appointments, deadlines) - see [why UTC isn't always enough](https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/)
- Use `timestampNaive` when the timezone is statically known for the column

### Additional field builders

These builders add a semantic type or a commonly used alias to the base SQL
type:

```ts
table.bool("is_active");
table.boolean("is_enabled"); // alias for bool
table.timestamp("created_at"); // alias for timestampUtc
table.tx("written_in_tx");
table.percentage("completion", { precision: 5, scale: 2 });
table.url("website");
table.hexColor("accent_color");
```

`tx` is a transaction identifier backed by `bigint`. `percentage` is a fixed
point decimal with percentage metadata. `url` is a string field with a default
maximum length of 2048, and `hexColor` is a seven-character string for values
such as `#a1b2c3`.

## Specialized Types

### uuid

```ts
table.uuid("external_id");
table.uuid("public_id").notNull().unique();
```

### email

Validated email addresses:

```ts
table.email("contact_email");
```

### phoneNumber

Validates and normalizes phone numbers:

```ts
table.phoneNumber("phone");
table.phoneNumber("us_phone").country("US");
```

### phoneNumberString

For legacy systems or unvalidated phone numbers:

```ts
table.phoneNumberString("legacy_phone").maxLength(24);
```

### ordering

Opaque type for efficiently maintaining sort order in lists:

```ts
table.ordering("sort_order");
```

## Enums

Enums are stored as small integers but displayed as strings. They must be defined at the system level before use.

```ts
// Define enum at system level (before database definition)
system.enum_({
  name: "contact_type",
  values: ["prospect", "client", "lead", "other"],
});

// Use in table
db.table("contact", (table) => {
  table.enum("type", "contact_type").notNull();
});
```

> **Important:** Enums cannot be defined inline in table definitions. Always use `system.enum_()` first.

## JSON

```ts
table.json("metadata");
table.json("settings");
```

## Bytes

For binary data (keys, tokens, hashes). Not for file storage - files are stored externally and referenced by blob hashes.

```ts
table.bytes("encryption_key", 32);
table.bytes("hash", 64);
table.blobRef("photo_blob_hash"); // 32-byte Yolm blob content hash
table.blobRef("legacy_photo_blob_hash", 64); // preserves an existing wider field
table.secret("api_token", 256, "external_service_key");
```

## Foreign Keys

Reference another table's primary key:

```ts
table.fk("customers").notNull(); // Creates `customer_id`
table.fk("customer", "customers").notNull(); // Creates `customer`
table.fk("parent", "categories"); // Self-referential field named `parent`
table.fk("owner", "sys_users"); // Field named `owner`
```

Use the field name created by the schema in SQL. If you define
`table.fk("customer", "customers")`, query `customer`, not `customer_id`.

## Type Conversion

Storage types are optimized for space efficiency and converted to standard SQL types when queried:

| Storage Type | SQL Type |
|--------------|----------|
| `tinyUint`, `tinyInt`, `smallInt` | `smallint` |
| `smallUint`, `int` | `int` |
| `uint`, `bigUint`, `bigInt` | `bigint` |
| `timestampUtc`, `timestampTz` | `timestamptz` |
| `timestampNaive` | `timestamp` |
| `tx` | `bigint` |
| `phoneNumber` | Specialized phone type |
| `email` | `string` with validation |

## Common Field Modifiers

All field builders support these modifiers:

```ts
table.string("name", 200)
  .displayName("Company name")
  .description("Legal or trading name shown to users.")
  .notNull()
  .default(sql.lit`Unknown`)
  .unique()
  .renameFrom("company_name")
  .group("profile");
```

- `notNull()` makes the field required. Fields are nullable by default.
- `default(expr)` / `defaultTo(expr)` / `defaultsTo(expr)` / `defaults(expr)`
  set a SQL default expression.
- `unique()` adds a single-field unique constraint.
- `check(predicate, errorMessage)` adds a single-field check constraint.
- `renameFrom(oldName)` preserves existing data across a field rename.
- `displayName(...)` changes generated UI/docs labels.
- `description(...)` adds explanatory text for generated docs/tooling.
- `group(...)` assigns the field to a named field group.
- `sampleData(...)` customizes sample-data generation for the field.

Numeric fields also support inclusive `.min(...)` and `.max(...)` constraints.
