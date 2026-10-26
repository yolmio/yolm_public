---
title: Forge data skill
description: Use before importing or migrating data, creating or copying development databases, or running pipelines and transforms in Forge.
tags: [ai, forge, skill, databases, migrations]
related:
  - ai/forge_databases.md
  - ai/forge_transfers.md
  - concepts/pipelines.md
  - concepts/transforms.md
  - concepts/source_imports.md
---

# Forge data skill

Forge works on development databases. Production data changes go through
planned production pipelines that a person confirms (`docs/ai/forge_deploy.md`).

## Choose the tool

- **Import source data**: upload CSV/TSV, JSON Lines, JSON arrays, Parquet,
  spreadsheets, or SQLite with `prepareDatabaseUpload`, or import files already
  in Drive with `importDriveFiles`. Each import creates a source database whose
  tables mirror the files. Prefer JSON Lines for API extracts and Parquet for
  large tables.
- **Load or reshape into the system's schema**: a pipeline reads source
  database tables and writes the system's tables in dependency-ordered stages.
  Use it for migrations from another system and for recurring loads.
- **Change data or schema of an existing Yolm database**: a transform replays
  transaction history into a new output database (`compact`, `sameSchema`,
  `newSchema`).
- **Scratch work**: `createDatabase` and `copyDatabase`; copies share storage
  and are cheap.

## Migration workflow

1. Import the source files and inspect them with `devDatabaseInfo` and
   `queryDatabase`; check the import `report` for type choices and rejected
   values.
2. Model the target schema minimally (`docs/ai/forge_schema.md`) and map source
   fields to it. Keep staging logic in pipeline stages and procedure tables
   rather than extra system tables.
3. Write the pipeline, run it on a development database, and verify counts and
   sample records. Runs are asynchronous: poll `versionRun({runId})`.
4. Preview the app on the result (`docs/ai/forge_preview.md`).
5. For production, plan the pipeline with `planProductionPipeline`; a person
   confirms it.

## References

- Database tools, ownership, retries, and bindings: `docs/ai/forge_databases.md`
- Uploads and signed links: `docs/ai/forge_transfers.md`
- Import formats and type rules: `docs/concepts/source_imports.md`
- Pipelines: `docs/concepts/pipelines.md`; transforms:
  `docs/concepts/transforms.md`
