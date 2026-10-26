---
title: Source Imports
description: Importing CSV, JSON, Parquet, spreadsheet, and SQLite files into source databases for pipelines, with exact type rules and an import report.
tags:
  - concepts
  - pipelines
  - data-import
  - csv
  - migration
---

# Source Imports

A source import loads raw files into a **source database** that pipelines read
as `<database>.<table>`. It is the first step of a migration: extract data from
the old system, import it unchanged, then map it into `db.*` with a
[pipeline](pipelines.md).

Import with Forge (`prepareDatabaseUpload`, see
[Forge transfers](../ai/forge_transfers.md)) or locally:

```bash
yolm pipeline import hubspot ./extract -d ./my_system --report-json report.json
yolm query -d ./my_system --source hubspot -q "select count(*) from deals"
```

`yolm query --source <name>` queries an imported database with its own tables,
so no project schema is needed to inspect or reconcile source data.

## Supported files

| Format | Extensions |
| --- | --- |
| CSV / TSV | `.csv`, `.tsv` (optionally `.gz`) |
| JSON Lines | `.jsonl`, `.ndjson` (optionally `.gz`); one object per line |
| JSON array | `.json` (optionally `.gz`); a top-level array of objects, up to 512 MiB |
| Parquet | `.parquet`, `.pq` |
| Spreadsheet | `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`; one table per sheet |
| SQLite | `.sqlite`, `.sqlite3`, `.db3`, and `.db` files that start with the SQLite header; one table per table |

One upload can mix formats. `export_data` directories (`manifest.json` plus
chunks), `.yolm-export`, and WAL imports are separate import kinds and are not
changed by anything on this page.

Prefer JSON Lines for API extractions: write each record the API returns as
one line. JSON already says which values are strings, numbers, booleans, and
objects, so nothing has to be guessed from text.

## Tables

- A file is one table named after the file: `contacts.jsonl.gz` → `contacts`.
- Part files in one directory form one table named after the directory, so a
  paginated extraction or a Spark/DuckDB output directory becomes one table:
  `deals/part-00000.jsonl` and `deals/part-00001.jsonl` → `deals`. Part files
  are named `part-N`, `data_N`, `chunk-N`, or only digits, optionally followed
  by a writer id (`part-00000-<uuid>-c000.snappy.parquet`). Only files of one
  naming style group together; where a directory mixes styles, a lone file
  (`2024.csv` next to `data_2023.csv`) is its own table.
- Importing a directory of parts or partitions with the CLI
  (`yolm pipeline import src orders/`) names the table after that directory.
  An upload has no directory name, so several part files at its top level are
  an error; put them in a directory or list them under a table's `files`.
- Hive-partitioned directories form one table named after the directory above
  the partitions, and each `key=value` directory becomes a column:
  `orders/year=2024/month=02/part-0.parquet` → table `orders` with `year` and
  `month`. Partition values are typed like CSV values in CSV/JSON,
  spreadsheet, and SQLite tables and are text in Parquet tables.
- Files are never merged because their names match. Same-named files in
  different directories are prefixed with their directory
  (`hubspot/contacts.csv` → `hubspot_contacts`, `salesforce/contacts.csv` →
  `salesforce_contacts`); two files in one directory that would get the same
  name (`My Table.csv` and `my_table.csv`) are an error.
- `files` globs in `yolm-import.json` assign any files to a table explicitly.
  `*` matches within a path segment, `**` matches whole segments.
- Table names are case-insensitive: a spec entry `Orders` configures and names
  the table derived from `orders.csv`, and two spec entries that differ only in
  case are an error.
- Every file of a table must use the same format. Parquet parts must have the
  same column names and types (in any order); a column is nullable if it is
  nullable in any part.
  Column renames are chosen once per table, so a renamed column keeps its
  name whatever its position in each part.
- Names that are not plain identifiers are converted to snake_case, with
  accents folded (`Invoice Lines.csv` → `invoice_lines`).
- macOS metadata (`__MACOSX/`, `._*`) and hidden files are skipped. They, and
  any unsupported files, are listed under `ignoredFiles` in the report.

## Spreadsheets and SQLite

- A workbook with one data sheet is named after the file; with several, each
  sheet becomes `<file>_<sheet>` in snake_case (`book.xlsx` sheet `Q1 Invoices`
  → `book_q1_invoices`). Hidden sheets are imported with a report note; empty,
  chart, and macro sheets are listed as ignored.
- The header is the first non-empty row, or `headerRow` (1-based) in the
  table's spec; rows above `headerRow` are skipped with a report note. Fully
  empty rows are not records, and a column exists only when it has a header
  or a value below it. Report line numbers are sheet row numbers.
- Cells keep their spreadsheet types: numbers, booleans, dates (date-only
  cells become `date`, time-only cells `time`, others `timestamp`), and text,
  which is never re-interpreted. In `.xlsx` a time-only cell is one whose
  number format shows only a time of day (`h:mm:ss`) and whose value has no
  date part; elsewhere, a value below one day in the 1900 date system. A
  time-formatted cell that does hold a date stays a `timestamp` unless its
  column is declared `time`, which takes the time it shows. A ZIP code stored as a number in the workbook
  has already lost its leading zero.
- Formulas import their saved result. Error cells (`#N/A`, `#DIV/0!`) and
  formulas saved without a result (common in workbooks written by scripts) are
  rejected values; open and save the workbook in a spreadsheet app to
  calculate them.
- A merged range keeps its value only in its first cell; the other cells are
  NULL and the report notes the merged ranges.
- `.xlsx`, `.xlsm`, and `.xlsb` sheets are streamed, so size does not matter.
  `.xls` and `.ods` workbooks are loaded whole and are rejected when they would
  need more than 512 MiB (a used range of roughly five million cells); save
  them as `.xlsx` or CSV. Workbooks are recognized by content, so a misnamed
  file opens, and an HTML or text export named `.xls` gets a hint to rename
  it.
- Each SQLite table keeps its name. Views, virtual tables (FTS, R*Tree), and
  the storage tables SQLite classifies as theirs (`docs_data` for an FTS table
  `docs`) are listed as ignored; an ordinary table such as `docs_metadata` is
  imported.
- SQLite values are typed by their storage class. INTEGER and REAL values are
  numbers; TEXT values are typed like CSV fields, since SQLite stores dates as
  text; BLOBs become `bytes`. Text that is not valid UTF-8 is a rejected value.
- A database is read as an immutable snapshot and never modified. Upload its
  `-wal` or `-journal` file with it when it was copied from a running
  application: a copy is recovered the way SQLite would, so the WAL's commits
  are imported and a journal's unfinished transaction is rolled back. Without
  its journal, a database copied mid-transaction can contain uncommitted
  data.
- Names from sheets, headers, and tables follow the rules below; two tables
  from different files that end up with the same name are prefixed with their
  file name.

## Columns

- JSON tables have the union of the top-level keys of every record; a missing
  key is NULL. At most 2,000 distinct columns are allowed per table.
- Column names that are not plain identifiers become snake_case with accents
  folded (`First Name` → `first_name`, `Straße` → `strasse`); names with no
  Latin letters become `column_N`. Case-insensitive duplicates get `_2`, `_3`,
  and so on.
- A column named `id` (any case) becomes `source_id`, because every table
  already has a built-in `id`. Names starting with `__` are also renamed.
- Every rename is listed in the import report with the original name.
- A key that appears twice in one JSON object is a rejected value (the last
  value is kept in lenient mode).
- `--align-system-db` imports keep every column name exactly as written.

## Types

Each column's type is declared in `yolm-import.json`, inferred from **every**
value, or kept as text. A column only gets a non-text type when all of its
values convert exactly; anything ambiguous stays text for the pipeline to cast.

**CSV** (values are text, so they are inferred conservatively):

| Values | Type |
| --- | --- |
| `true` / `false` (any case) | `bool` |
| Integers without leading zeros that fit in 64 bits | `bigint` |
| Plain decimals (`1200.50`, `-0.01`) with at most 18 digits | `decimal(18,s)` |
| ISO dates `YYYY-MM-DD` | `date` |
| ISO timestamps `YYYY-MM-DD HH:MM[:SS[.ffffff]]` (`T` or space) | `timestamp` |
| ISO timestamps with `Z` or `±HH:MM` | `timestamptz` |
| Anything else, including mixed kinds | `string` |

So `02139`, `00104`, `1`/`0` mixed with `yes`, `03/05/2021`, `1e3`, leap
seconds (`23:59:60`), and nanosecond timestamps all stay text. Empty fields
are NULL; `NULL`, `null`, and `\N` are also NULL (configurable with
`nullValues`), and the report counts those per column. A blank line is not a
row, so a one-column CSV cannot express an empty value with a blank line.

**JSON:** strings are always `string` (dates in strings are not parsed),
integers are `bigint`, numbers with a fraction are `decimal(18,s)` taken from
the digits as written, and booleans are `bool`. Exponent notation is `double`
only when every number in the column survives a double exactly (at most 15
significant digits, and not so small that it underflows); integers beyond 64
bits, exponents a double would change (`1e400`, `1e-400`,
`9007199254740993e0`), and mixes that would lose digits stay `string` with
the literal text. Objects or arrays are `json`.
Mixed kinds become `string`, or `json` when any value is an object or array.

**Parquet:** types come from the file. Columns are converted only where Yolm
stores the value differently, and each conversion is reported:

- second, millisecond, and nanosecond timestamps → microseconds;
- `time` of any unit → Yolm `time` (whole seconds);
- lists, structs, maps, and unions → `json` text;
- the Parquet `UUID` logical type → `uuid`;
- decimals wider than 28 digits → `decimal(18,s)`;
- durations → `bigint` in the column's unit, intervals → text.

A column is converted only when **no value changes**. Otherwise the whole
column is imported as exact text instead: times with fractional seconds,
nanosecond timestamps with sub-microsecond digits, wide decimals with a value
beyond 18 digits (or a scale above 18), and unsigned 64-bit integers above
`9223372036854775807`. Write timestamps as microseconds and keep decimals
within 18 digits to get typed columns.

## yolm-import.json

Put `yolm-import.json` next to the files (or pass `--spec` to
`yolm pipeline import`). Every field is optional and unknown fields are
rejected.

```json
{
  "mode": "strict",
  "infer": "types",
  "encoding": "windows-1252",
  "csv": { "delimiter": ";", "header": true, "nullValues": ["", "NULL"] },
  "tables": {
    "contacts": {
      "files": ["hubspot/contacts_*.jsonl.gz"],
      "keepRaw": true,
      "columns": {
        "zip": "string",
        "amount": "decimal(18,2)",
        "createdate": "timestamptz",
        "closedate": { "type": "date", "format": "%m/%d/%Y" },
        "posted": {
          "type": "timestamptz",
          "format": "%m/%d/%Y %I:%M %p",
          "timezone": "America/New_York"
        }
      }
    }
  }
}
```

- `mode`: `strict` (default) fails the import when any value cannot be
  converted; `lenient` imports those values as NULL, skips invalid rows, and
  reports both.
- `infer`: `types` (default) or `text`, which keeps every undeclared scalar
  column as `string` so the pipeline does all casting.
- `encoding`: any WHATWG label (`windows-1252`, `latin1`, `utf-16le`, ...).
  A byte-order mark always wins. Invalid bytes are an error, never replaced.
- `csv`: `delimiter` (a character or `"tab"`; sniffed from the header when
  omitted), `header`, `nullValues`.
- Table-level `mode`, `infer`, `encoding`, and `csv` override the top level.
- `keepRaw` (JSON only) adds a `_raw` json column with each record exactly as
  written.
- `headerRow` (spreadsheets only) is the 1-based row that holds the header.
- `files` patterns containing `#` match single sheets or tables
  (`"book.xlsx#Q*"`), so similar monthly sheets can be combined into one table.
- `columns` declares types by source or output name: `string`, `bool`,
  `bigint`, `decimal(p,s)` (p ≤ 18), `double`, `date`, `time`, `timestamp`,
  `timestamptz`, `uuid`, `json`, `bytes` (base64). `format` uses chrono
  `strftime` syntax. `timezone` interprets `timestamptz` values without an
  offset in that IANA zone. Timestamps store microseconds, so a value with
  finer digits (`%f` reads nanoseconds) is rejected rather than cut.
- Parquet tables accept only `files` and `mode`; their types come from the file.

Declared names match the source name or the output name exactly, or
case-insensitively when only one column matches. Declared decimals reject
values with more fractional digits than the scale rather than rounding them.
Declared `time` rejects fractional seconds, and leap seconds are rejected.
Formats that would drop part of a value are rejected when the spec is read: a
`date` format with time fields, a `time` format with date fields, `%z` in a
`timestamp` format, `%z` together with `timezone`, and a `timestamptz` format
with neither.

## Import report

Every source import returns a report: for each table its format, row count,
and every column with its final type and whether the type was `declared`,
`inferred`, `text`, `parquet`, or `generated`, plus renames and conversions.
Rejected values are counted per column and the first 25 are listed with file,
line, value, and reason.

- `yolm pipeline import` prints it; `--report-json <path>` writes it (also on a
  strict failure).
- Forge's `databaseUploadStatus({ jobId })` returns it as `report`, including
  for a failed strict import.

Check the report before writing the pipeline: it shows exactly which columns
need casting and which values need a decision.
