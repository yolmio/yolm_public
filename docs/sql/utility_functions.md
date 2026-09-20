---
title: Utility Functions
description: Utility SQL functions for formatting, phone numbers, JWTs, OTP/TOTP/HOTP, QR codes, rich text, markdown, ordering, and network access.
tags:
  - sql
  - functions
  - utilities
---

# Utility Functions

Yolm SQL provides various utility functions for common tasks.

## Formatting Functions

`format.decimal`, `format.currency`, and `format.percent` accept these named
integer options where applicable:

- `minimum_integer_digits`
- `minimum_fraction_digits`
- `maximum_fraction_digits`
- `maximum_significant_digits`

Named arguments may use either `=>` or `:=`.

### format.decimal

Formats a number with locale grouping. The decimal-place count is set with the
named argument `maximum_fraction_digits` (positional precision is not accepted).

```sql
select format.decimal(1234.5678);
-- '1,234.568'

select format.decimal(1234.5678, maximum_fraction_digits => 2);
-- '1,234.57'

select format.decimal(1000000, maximum_fraction_digits => 0);
-- '1,000,000'
```

### format.currency

Formats a number as currency.

```sql
select format.currency(1234.56, 'USD');
-- '$1,234.56'

select format.currency(1234.56, 'EUR', maximum_fraction_digits => 0);
-- '€1,235'
```

### format.percent

Formats a number as a percentage. The decimal-place count is set with the named
argument `maximum_fraction_digits` (positional precision is not accepted).

```sql
select format.percent(0.1234, maximum_fraction_digits => 2);
-- '12.34%'

select format.percent(0.5, maximum_fraction_digits => 0);
-- '50%'
```

### format.date

Formats a date with a format string. See [Date Functions](./date_functions.md) for format specifiers.

```sql
select format.date(current_date, '%B %d, %Y');
-- 'January 15, 2024'

select format.date(current_timestamp, '%Y-%m-%d %H:%M:%S');
-- '2024-01-15 14:30:45'
```

### format.typescript

Formats a TypeScript/TSX source code string using dprint.

```sql
select format.typescript('const x={a:1,b:2}');
-- 'const x = { a: 1, b: 2 };'
```

## Phone Number Functions

Parse and format phone numbers using international standards.

### phone.parse

Parses a phone number string.

```sql
select phone.parse('+1-555-123-4567');
select phone.parse('555-123-4567', 'US');  -- with country hint
select phone.try_parse('555-123-4567', 'US');
```

### phone.format_international

Formats a phone number in international format.

```sql
select phone.format_international(phone.parse('+15551234567'));
-- '+1 555 123 4567'
```

### phone.format_national

Formats a phone number in national format.

```sql
select phone.format_national(phone.parse('+15551234567'));
-- '(555) 123-4567'
```

### phone.get_country_code

Extracts the numeric country calling code from a phone number.

```sql
select phone.get_country_code(phone.parse('+15551234567'));
-- 1

select phone.country_code(phone.parse('+442079460000'));
-- 44
```

### phone.format_partial

Formats a partial phone number with country context. Takes one positional
argument (the number) plus optional named arguments:

- `country => 'US'`
- `disable_country_code => true`

```sql
select phone.format_partial('5551234', country => 'US');
-- '+1 (555) 123-4'

select phone.format_partial('5551234', country => 'US', disable_country_code => true);
-- '(555) 123-4'
```

### phone.guess_country

Attempts to determine the country from a phone number.

```sql
select phone.guess_country('+15551234567');
-- 'US'
```

## JWT Functions

Create and verify JSON Web Tokens.

### jwt.sign

Creates a JWT with the given payload and secret.

```sql
select jwt.sign(
  json_build_object('user_id', 123),
  'secret_key',
  'HS256'
);
-- 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### jwt.verify

Verifies a JWT signature and returns validity.

```sql
select jwt.verify('eyJhbGciOi...', 'secret_key', 'HS256');
-- true or false
```

### jwt.decode

Decodes a JWT without verifying the signature (useful for reading claims).

```sql
select jwt.decode('eyJhbGciOi...');
-- JSON payload
```

### jwt.get_claims

Verifies and extracts claims from a JWT.

```sql
select jwt.get_claims('eyJhbGciOi...', 'secret_key', 'HS256') ->> 'user_id';
-- '123'
```

## Network Functions

### ip_in_cidr

Checks if an IP address is within a CIDR block.

```sql
select ip_in_cidr('192.168.1.100', '192.168.1.0/24');
-- true

select ip_in_cidr('10.0.0.1', '192.168.0.0/16');
-- false

-- Practical usage
select * from requests
where ip_in_cidr(client_ip, '10.0.0.0/8');  -- internal requests
```

## System Functions

For `current_user`, `current_tx()`, `current_task()`, `system_id()`, and
`info.system_id()`, see [Global Functions and Operators](./global_functions.md).

## OTP Functions

> **Server-only:** OTP functions are only available in server-side procedures.

### digit_otp

Generates a numeric one-time password.

```sql
select digit_otp(6);
-- '123456'

select digit_otp(4);
-- '1234'
```

## TOTP Functions (Time-Based One-Time Password)

> **Server-only:** TOTP functions are only available in server-side procedures.

### totp.generate_secret

Generates a random TOTP secret key as `bytes`.

```sql
select totp.generate_secret();
select base32.encode(totp.generate_secret());
```

### totp.generate

Generates a TOTP code from a secret.

```sql
select totp.generate(secret);
select totp.generate(secret, current_timestamp);
-- '123456'
```

### totp.verify

Verifies a TOTP code against a secret.

```sql
select totp.verify(secret, '123456', 1);
select totp.verify(secret, '123456', 1, current_timestamp);
-- true or false
```

### totp.uri

Generates a TOTP provisioning URI for use in authenticator apps.

```sql
select totp.uri(secret, 'user@example.com', 'MyApp');
-- 'otpauth://totp/MyApp:user@example.com?secret=...'
```

## HOTP Functions (HMAC-Based One-Time Password)

> **Server-only:** HOTP functions are only available in server-side procedures.

### hotp.generate

Generates an HOTP code from a secret and counter.

```sql
select hotp.generate(secret, 1);
-- '123456'
```

### hotp.verify

Verifies an HOTP code against a secret and counter.

```sql
select hotp.verify(secret, '123456', 1);
-- true or false
```

### hotp.uri

Generates an HOTP provisioning URI.

```sql
select hotp.uri(secret, 'user@example.com', 'MyApp', 1);
-- 'otpauth://hotp/MyApp:user@example.com?secret=...&counter=1'
```

## QR Code Functions

> **Server-only:** QR code functions are only available in server-side procedures.

### qr.png

Generates a QR code as PNG image bytes.

```sql
select qr.png('https://example.com');
select qr.png('https://example.com', 'M'); -- error correction: L, M, Q, or H
-- <PNG bytes>
```

### qr.svg

Generates a QR code as an SVG string.

```sql
select qr.svg('https://example.com');
select qr.svg('https://example.com', 'Q');
-- '<svg>...</svg>'
```

### qr.data_url

Generates a QR code as a data URL (suitable for embedding in HTML `<img>` tags).

```sql
select qr.data_url('https://example.com');
select qr.data_url('https://example.com', 'H');
-- 'data:image/png;base64,...'
```

## Markdown Functions

### markdown.to_html

Converts a Markdown string to HTML.

```sql
select markdown.to_html('# Hello\n\nThis is **bold**.');
-- '<h1>Hello</h1><p>This is <strong>bold</strong>.</p>'
```

## HTML Functions

### html.lean_email

Sanitizes an HTML email body into smaller semantic HTML. This removes scripts,
styles, head metadata, unsafe URLs, and presentation-only attributes such as
email client and Word classes and inline styles while preserving common email
structure such as paragraphs, links, lists, headings, tables, and `cid:` images.

Plain-text and incomplete-markup bodies are returned unchanged up to the output
limit when no complete HTML element is present, so this is safe to apply at
ingestion when the provider may return either HTML or text content. HTML bodies
larger than 4 MiB or containing more than 10,000 tag markers bypass the DOM
parser, and sanitizer failures fall back to safe text with tag delimiters
neutralized. Sanitized HTML is returned only when it can be serialized completely
within the output bound; output expansion or an incomplete serialization also
uses the safe-text fallback. All output is capped at 1,000,000 bytes and never
exceeds the input length, with plain-text truncation occurring only at a valid
UTF-8 boundary. If even the bounded fallback allocation fails, the function
returns an empty string instead of propagating the sanitizer failure or
overflowing the destination field.

```sql
select html.lean_email('<html><body><p class="MsoNormal" style="margin:0">Hello <b>world</b></p></body></html>');
-- '<p>Hello <b>world</b></p>'
```

## Ordering Functions

For maintaining sortable lists with stable ordering values.

### ordering.new()

Creates a new initial ordering value.

```sql
select ordering.new();
```

### ordering.n_after(offset, base?)

Creates an ordering value `offset` positions after `base`. If `base` is
omitted, the offset is relative to the start of the ordering range.

```sql
-- Get ordering value after existing item
select ordering.n_after(1, existing_item.ordering) from items limit 1;

-- Insert item after another
insert into items (name, ordering)
values (
  'New Item',
  ordering.n_after(1, (select ordering from items where id = 5))
);
```

### ordering.n_before(offset, base?)

Creates an ordering value `offset` positions before `base`.

```sql
-- Insert at beginning of list
insert into items (name, ordering)
values ('First Item', ordering.n_before(1, (select min(ordering) from items)));
```

## Null Handling and Type Checks

For `coalesce`, `nullif`, `greatest`, `least`, and null-safe comparison
operators, see [Global Functions and Operators](./global_functions.md).

## Record ID Functions

For `next_record_id` and `last_record_id`, see
[Global Functions and Operators](./global_functions.md).
