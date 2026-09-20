---
title: QuickBooks IIF Helpers
description: Helpers for constructing QuickBooks IIF headers and tab-delimited rows from SQL expressions.
tags:
  - services
  - quickbooks
  - iif
  - export
---

# QuickBooks IIF Helpers

`services/quickbooks_iif` provides small generation-time helpers for building
QuickBooks IIF text. It does not know your chart of accounts or invoice
business rules; callers still provide account names, dates, amounts, memos,
and item names.

## Headers

Use `quickBooksIifHeader(rowType, fields)` for a single `!ROWTYPE` header,
`quickBooksInvoiceIifHeaders()` for the standard invoice header block as a
generation-time string, or `quickBooksInvoiceIifHeaderRows()` for the same
headers as a SQL expression.

```typescript
import { quickBooksInvoiceIifHeaderRows } from "services/quickbooks_iif";
import { sql } from "std/sql_utils";

s.setScalar(
  "iif_content",
  sql`${quickBooksInvoiceIifHeaderRows()} || E'\n'`,
);
```

The exported `QUICKBOOKS_IIF_INVOICE_TRNS_FIELDS`,
`QUICKBOOKS_IIF_INVOICE_SPL_FIELDS`, and `QUICKBOOKS_IIF_ENDTRNS_HEADER`
constants are available when you need to build a custom header block.

## Rows

`quickBooksIifRow(cells)` returns a SQL expression that joins string, number,
and SQL cells with tabs.

```typescript
import { quickBooksIifRow } from "services/quickbooks_iif";
import { sql } from "std/sql_utils";

s.defScalar(
  "trns_line",
  quickBooksIifRow([
    "TRNS",
    "",
    "INVOICE",
    sql`to_char(current_date(), 'MM/DD/YYYY')`,
    "Accounts Receivable",
    sql`client_code`,
    "",
    sql`format.decimal(round(invoice_total, 2))`,
    sql`invoice_no`,
    sql`coalesce(invoice_memo, '')`,
    "N",
    "N",
    "N",
    "",
    "",
    "Net 30",
    "",
    "",
  ]),
);
```

The row helper intentionally does not escape or normalize cell values. Build
the exact strings QuickBooks expects before passing them in.

## See also

- [SOAP Helpers](./soap.md) — XML/SOAP integration helpers.
- [HTTP Helpers](./http.md) — HTTP endpoint helpers.
