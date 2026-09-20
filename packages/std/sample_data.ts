import * as YolmGenApi from "std/yolm_gen_api";
import { countriesWithEconomicIndex } from "enums/country";
import { sql } from "./sql_utils";
import type { AnyExpr } from "./sql_utils";
import type { IServerBaseStatements } from "./statements";
import { system } from "./system";
import type { Field, Table } from "./system";

export interface InsertRecordOptions {
  table: Table;
  currentRecords?: Record<string, number>;
  values?: Record<string, any>;
  fieldOverrides?: Record<string, AnyExpr>;
  ignoreFields?: string[];
  ignoreRelations?: string[];
  ignoreOverride?: boolean;
}

/**
 The main context class that handles generation logic, including:
 - Tracking how many records each table has
 - Possibly referencing foreign keys to newly inserted records
 - Generating realistic(ish) data based on field names/types

 */
export class SampleDataScriptContext {
  recordCounts: Record<string, number>;
  #currentForeignKeys: Map<string, number> = new Map();

  constructor() {
    this.recordCounts = Object.fromEntries(
      Object.entries(system.db.tables).map(([name]) => [name, 0]),
    );
  }

  incrementRecordCount(table: string, amount = 1) {
    const current = this.recordCounts[table];
    this.recordCounts[table] += amount;
    return current;
  }

  getCurrentForeignKey(table: string): number | undefined {
    return this.#currentForeignKeys.get(table);
  }

  setCurrentForeignKey(table: string, id: number) {
    this.#currentForeignKeys.set(table, id);
  }

  clearCurrentForeignKey(table: string) {
    this.#currentForeignKeys.delete(table);
  }

  /**
       Generates a single field value. If the field has a custom generator, it is used;
       otherwise, some heuristics based on field name, usage, and type are used.
       */
  generateFieldValue(field: Field, table: Table): AnyExpr | string {
    if (field.sampleDataConfig?.generator) {
      return field.sampleDataConfig.generator(this);
    }

    // Possibly generate null
    if (!field.notNull) {
      const nullPercent = field.sampleDataConfig?.nullProbability ?? 10;
      if (YolmGenApi.fakerNumberInt({ min: 1, max: 100 }) <= nullPercent) {
        return sql.null;
      }
    }

    const fieldName = field.name.toLowerCase();

    // Some date/time fields
    if (
      fieldName === "created_at" ||
      fieldName === "updated_at" ||
      fieldName === "deleted_at"
    ) {
      return YolmGenApi.fakerDateRecent().toISOString();
    }

    // Price/cost/amount fields
    if (
      fieldName.includes("price") ||
      fieldName.includes("amount") ||
      fieldName.includes("cost")
    ) {
      return String(
        YolmGenApi.fakerCommercePrice({ min: 1, max: 1000, dec: 2 }),
      );
    }

    // "Name" logic
    if (fieldName.includes("name")) {
      const tableLower = table.name.toLowerCase();
      // If table is "human-like"
      const isLikelyHuman = tableLower === "employees" ||
        tableLower === "users" ||
        tableLower === "agents" ||
        tableLower === "developers" ||
        tableLower === "customers" ||
        tableLower === "clients" ||
        tableLower === "contacts" ||
        tableLower === "staff" ||
        tableLower === "managers" ||
        tableLower.endsWith("_users") ||
        tableLower.endsWith("_employees");

      if (isLikelyHuman) {
        if (fieldName === "first_name") {
          return YolmGenApi.fakerPersonFirstName();
        }
        if (fieldName === "last_name") {
          return YolmGenApi.fakerPersonLastName();
        }
        if (fieldName === "full_name") {
          return YolmGenApi.fakerPersonFullName();
        }
        // For a plain "name" on a human-like table
        return YolmGenApi.fakerPersonFullName();
      }

      // Company or product name
      if (tableLower === "companies") {
        return YolmGenApi.fakerCompanyName();
      }
      if (tableLower === "products") {
        return YolmGenApi.fakerCommerceProductName();
      }
    }

    // Switch based on type
    switch (field.type) {
      case "String": {
        // Possible field usage
        if (fieldName.includes("email") || field.usage?.type === "Email") {
          // It normally gives capitalized emails, but that looks ugly
          return YolmGenApi.fakerInternetEmail().toLowerCase();
        }
        if (fieldName.includes("phone")) {
          return YolmGenApi.fakerPhoneNumber();
        }
        if (fieldName.includes("address") || fieldName.includes("street")) {
          return YolmGenApi.fakerLocationStreetAddress();
        }
        if (fieldName.includes("city")) {
          return YolmGenApi.fakerLocationCity();
        }
        if (fieldName.includes("state")) {
          return YolmGenApi.fakerLocationState();
        }
        if (fieldName.includes("country")) {
          return YolmGenApi.fakerLocationCountry();
        }
        if (fieldName.includes("zip") || fieldName.includes("postal")) {
          return YolmGenApi.fakerLocationZipCode();
        }
        if (fieldName.includes("company")) {
          return YolmGenApi.fakerCompanyName();
        }
        if (fieldName.includes("product")) {
          return YolmGenApi.fakerCommerceProductName();
        }
        if (fieldName.includes("description") || fieldName.includes("bio")) {
          return YolmGenApi.fakerLoremParagraph();
        }
        if (fieldName.includes("url") || fieldName.includes("website")) {
          return YolmGenApi.fakerInternetUrl();
        }
        if (fieldName.includes("username")) {
          return YolmGenApi.fakerInternetUserName();
        }
        if (fieldName.includes("password")) {
          return YolmGenApi.fakerInternetPassword();
        }
        if (fieldName.includes("color")) {
          return YolmGenApi.fakerColorHuman();
        }
        if (field.usage?.type === "PhoneNumber") {
          return YolmGenApi.fakerPhoneNumber();
        }
        if (field.usage?.type === "URL") {
          return YolmGenApi.fakerInternetUrl();
        }
        if (field.usage?.type === "HexColor") {
          return YolmGenApi.fakerColorRgb(); // Not actually hex but that's okay
        }
        if (field.multiline) {
          return YolmGenApi.fakerLoremParagraphs(2);
        }
        // Default
        return YolmGenApi.fakerLoremWords({ min: 1, max: 4 });
      }

      case "TinyUint":
      case "TinyInt":
      case "SmallUint":
      case "SmallInt":
      case "Int":
      case "Uint":
      case "BigUint":
      case "BigInt": {
        if (fieldName.includes("age")) {
          return String(YolmGenApi.fakerNumberInt({ min: 18, max: 90 }));
        }
        if (fieldName.includes("year")) {
          return String(YolmGenApi.fakerNumberInt({ min: 1900, max: 2024 }));
        }
        if (fieldName.includes("count") || fieldName.includes("quantity")) {
          return String(YolmGenApi.fakerNumberInt({ min: 0, max: 1000 }));
        }
        if (fieldName.includes("rating")) {
          return String(YolmGenApi.fakerNumberInt({ min: 1, max: 5 }));
        }
        const min = typeof field.min === "number" ? field.min : 0;
        const max = typeof field.max === "number" ? field.max : 10000;
        return String(YolmGenApi.fakerNumberInt({ min, max }));
      }

      case "Decimal": {
        // Price or rating
        if (fieldName.includes("price") || fieldName.includes("amount")) {
          return String(
            YolmGenApi.fakerNumberFloat({
              min: 0,
              max: 1000,
              fractionDigits: 2,
            }),
          );
        }
        if (fieldName.includes("rating")) {
          return String(YolmGenApi.fakerNumberFloat({ min: 0, max: 5 }));
        }
        const min = typeof field.min === "number" ? field.min : 0;
        const max = typeof field.max === "number" ? field.max : 1000;
        const scale = field.scale;
        return String(
          YolmGenApi.fakerNumberFloat({ min, max, fractionDigits: scale }),
        );
      }

      case "Date": {
        let string = "";
        if (fieldName.includes("birth")) {
          string = YolmGenApi.fakerDateBirthdate().toISOString().split("T")[0];
        } else if (fieldName.includes("future")) {
          string = YolmGenApi.fakerDateFuture().toISOString().split("T")[0];
        } else {
          string =
            YolmGenApi.fakerDatePast({ years: 20 }).toISOString().split("T")[0];
        }
        return sql`DATE ${sql.lit(string)}`;
      }

      case "TimestampUtc":
      case "TimestampTz":
      case "TimestampNaive": {
        if (fieldName.includes("future")) {
          return YolmGenApi.fakerDateFuture().toISOString();
        }
        return YolmGenApi.fakerDateRecent().toISOString();
      }

      case "Bool":
        return YolmGenApi.fakerDatatypeBoolean();

      case "Enum": {
        // Special handling for country enum
        if (field.enum === "country") {
          // Get weighted array of country codes based on economic index
          const weightedCountries = countriesWithEconomicIndex.flatMap(
            (country) => {
              // Get integer portion of economic index
              const weight = Math.floor(country.economicIndex);
              // Repeat country code by weight
              return Array(weight).fill(country.name);
            },
          );

          return YolmGenApi.fakerHelpersArrayElement(weightedCountries);
        }

        // Default enum handling for non-country enums
        return YolmGenApi.fakerHelpersArrayElement(
          Object.values(system.enums[field.enum].values).map((v) => v.name),
        );
      }

      case "Uuid":
        return YolmGenApi.fakerStringUuid();

      case "PhoneNumber":
        return sql`phone.try_parse(${
          sql.lit(YolmGenApi.fakerPhoneNumber({ style: "international" }))
        })`;

      case "Real":
      case "Double": {
        const min = typeof field.min === "number" ? field.min : 0;
        const max = typeof field.max === "number" ? field.max : 1000;
        return String(
          YolmGenApi.fakerNumberFloat({ min, max, fractionDigits: 2 }),
        );
      }

      case "Time":
        return YolmGenApi.fakerDateRecent().toISOString().split("T")[1].split(
          ".",
        )[0];

      case "ForeignKey":
        // We handle foreign keys in insertRecord, so we do not generate them here.
        throw new Error(
          "ForeignKey generation should be handled in insertRecord, not directly in generateFieldValue",
        );

      case "Tx":
      case "Json":
      case "Bytes":
      case "Ordering":
        throw new Error(
          `${field.type} fields are not supported directly. Field: ${field.name}, Table: ${table.name}`,
        );
      default:
        throw new Error(`Unknown field type: ${(field as Field).type}`);
    }
  }

  /**
       Inserts a single record into the given table, potentially also inserting related records if needed.
       @param s The statement builder
       @param opts Additional options controlling how to insert
       @returns The newly inserted record's ID (which is the count of that table so far minus 1)
       */
  insertRecord(s: IServerBaseStatements, opts: InsertRecordOptions): number {
    const fields: string[] = [];
    const values: AnyExpr[] = [];
    const currentRecords = opts.currentRecords ?? {};

    // If table has a custom record generator, we run it. It might create multiple records at once.
    if (opts.table.sampleDataConfig?.generateRecord && !opts.ignoreOverride) {
      const savedKeys = new Map(this.#currentForeignKeys);
      opts.table.sampleDataConfig.generateRecord(s, this);
      this.#currentForeignKeys = savedKeys;
      // We assume that generateRecord handled insertion, so we return the newly inserted ID:
      // Need to handle the case where the table hasn't been inserted into yet
      const count = this.recordCounts[opts.table.name] || 0;
      return count > 0 ? count - 1 : 0;
    }

    // Otherwise we do a simple field-by-field generation
    for (const f of Object.values(opts.table.fields)) {
      if (opts.ignoreFields?.includes(f.name)) {
        continue;
      }
      if (opts.fieldOverrides?.[f.name] !== undefined) {
        fields.push(f.name);
        values.push(opts.fieldOverrides[f.name]);
        continue;
      }
      if (opts.values?.[f.name] !== undefined) {
        fields.push(f.name);
        values.push(
          typeof opts.values[f.name] === "string"
            ? sql.lit(opts.values[f.name])
            : opts.values[f.name],
        );
        continue;
      }
      if (f.type === "ForeignKey") {
        // If we have a current foreign key set, use that
        const currentKey = this.getCurrentForeignKey(f.table);
        const otherTable = system.db.tables[f.table];
        if (currentKey !== undefined) {
          fields.push(f.name);
          values.push(currentKey);
          continue;
        }
        // else if we have a known count for that table in currentRecords
        if (currentRecords[f.table] !== undefined) {
          fields.push(f.name);
          values.push(currentRecords[f.table]);
          continue;
        }
        let foreignKeyStrategy = f.sampleDataConfig?.foreignKeyStrategy;
        if (!foreignKeyStrategy) {
          foreignKeyStrategy = {
            type: "mixed",
          };
          if (otherTable.sampleDataConfig?.skipSampleData) {
            foreignKeyStrategy.type = "existing";
          }
        }
        if (foreignKeyStrategy?.type === "existing") {
          const existingCount = this.recordCounts[f.table] ?? 0;
          if (existingCount > 0) {
            fields.push(f.name);
            values.push(
              sql.lit(
                String(
                  YolmGenApi.fakerNumberInt({ min: 0, max: existingCount - 1 }),
                ),
              ),
            );
          } else if (otherTable.sampleDataConfig?.skipSampleData) {
            throw new Error(
              `No existing records found for ${f.table} and skipSampleData is true`,
            );
          } else if (f.notNull) {
            // If none exist, just create one
            const newId = this.insertRecord(s, {
              table: system.db.tables[f.table],
              currentRecords,
            });
            fields.push(f.name);
            values.push(sql.lit(String(newId)));
          } else {
            fields.push(f.name);
            values.push(sql.null);
          }
        } else if (foreignKeyStrategy?.type === "new") {
          const relatedId = this.insertRecord(s, {
            table: system.db.tables[f.table],
            currentRecords,
          });
          fields.push(f.name);
          values.push(sql.lit(String(relatedId)));
        } else if (foreignKeyStrategy?.type === "mixed") {
          const newProb = foreignKeyStrategy.newProbability ?? 50;
          const roll = YolmGenApi.fakerNumberInt({ min: 1, max: 100 });
          if (roll <= newProb) {
            const relatedId = this.insertRecord(s, {
              table: system.db.tables[f.table],
              currentRecords,
            });
            fields.push(f.name);
            values.push(sql.lit(String(relatedId)));
          } else {
            const existingCount = this.recordCounts[f.table] ?? 0;
            if (existingCount > 0) {
              fields.push(f.name);
              values.push(
                sql.lit(
                  String(
                    YolmGenApi.fakerNumberInt({
                      min: 0,
                      max: existingCount - 1,
                    }),
                  ),
                ),
              );
            } else if (f.notNull) {
              // no existing, create new
              const relatedId = this.insertRecord(s, {
                table: system.db.tables[f.table],
                currentRecords,
              });
              fields.push(f.name);
              values.push(sql.lit(String(relatedId)));
            }
          }
        } else {
          fields.push(f.name);
          values.push(sql.null);
        }
        continue;
      }

      // Normal field
      fields.push(f.name);
      const value = this.generateFieldValue(f, opts.table);
      values.push(typeof value === "string" ? sql.lit(value) : value);
    }

    // Insert record
    s.modify(sql.insertValues(opts.table.name, fields, values));

    // The new row's ID = recordCounts for that table (0-based), i.e. if it is the 5th row inserted, ID = 4
    const newId = this.recordCounts[opts.table.name] || 0;
    this.recordCounts[opts.table.name] = newId + 1;

    // Possibly handle dependent tables that have foreign keys back to us
    if (!opts.ignoreRelations) {
      this.setCurrentForeignKey(opts.table.name, newId);
      for (const depTable of Object.values(system.db.tables)) {
        if (
          depTable.sampleDataConfig?.skipSampleData ||
          depTable.name === opts.table.name
        ) {
          continue;
        }

        const hasForeignKey = Object.values(depTable.fields).some(
          (f) => f.type === "ForeignKey" && f.table === opts.table.name,
        );

        if (hasForeignKey && depTable.sampleDataConfig?.generateRecord) {
          depTable.sampleDataConfig.generateRecord(s, this);
        }
      }
      this.clearCurrentForeignKey(opts.table.name);
    }

    return newId;
  }
}
