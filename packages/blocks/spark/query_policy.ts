import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { SparkCapability, SparkTableFields } from "./index";
import {
  hasSparkPermissionGateDescriptor,
  sparkPermissionGateDescriptor,
} from "./permissions";

type ReadCapability = Pick<
  SparkCapability,
  | "name"
  | "permission"
  | "permissions"
  | "views"
  | "tables"
  | "fieldWhitelist"
  | "fieldBlacklist"
>;

/**
 * The column-restricted grants of one capability: its `fieldWhitelist` entries
 * plus each `fieldBlacklist` table resolved to its readable columns (primary
 * key and real fields, minus the listed ones). Virtual columns are never part
 * of a column-restricted grant. Every consumer of column restrictions (query
 * policy, render_ui policy, schema reference) reads through this helper so a
 * blacklist behaves exactly like the equivalent whitelist.
 */
export function capabilityFieldGrants(
  capability: Pick<SparkCapability, "fieldWhitelist" | "fieldBlacklist">,
): SparkTableFields[] {
  const grants = [...(capability.fieldWhitelist ?? [])];
  const hidden = new Map<string, Set<string>>();
  for (const entry of capability.fieldBlacklist ?? []) {
    const fields = hidden.get(entry.table) ?? new Set<string>();
    for (const field of entry.fields) fields.add(field);
    hidden.set(entry.table, fields);
  }
  for (const [name, fields] of hidden) {
    const table = system.db.tables[name];
    if (!table) continue;
    grants.push({
      table: name,
      fields: [
        table.primaryKeyFieldName,
        ...Object.values(table.fields).map((field) => field.name),
      ].filter((field) => !fields.has(field)),
    });
  }
  return grants;
}

export function effectiveCapabilitiesJsonExpr(
  capabilities: readonly ReadCapability[],
  storedCapabilities: Sql,
  ownerId: Sql,
) {
  const catalog = capabilities.map((capability) => ({
    name: capability.name,
    gate: sparkPermissionGateDescriptor(
      capability.permission,
      capability.permissions,
    ),
  }));
  return sql`coalesce((
    select json_array_agg(spark_capability.value->>'name' order by spark_capability.index)
    from json.array_each(${
    sql.lit(JSON.stringify(catalog))
  }::json) spark_capability
    where ${storedCapabilities} @> json_build_array(spark_capability.value->>'name')
      and (${ownerId} is null or ${
    hasSparkPermissionGateDescriptor(
      sql`spark_capability.value->'gate'`,
      ownerId,
    )
  })
  ), '[]'::json)`;
}

/**
 * Generation-time checks for `fieldBlacklist` and for one table appearing in
 * more than one grant form of a capability. `fieldWhitelist`, `tables`, and
 * `views` existence checks stay with the block's other schema validation.
 */
export function validateCapabilityReadGrants(
  cap: Pick<
    SparkCapability,
    "name" | "tables" | "fieldWhitelist" | "fieldBlacklist"
  >,
) {
  for (const fb of cap.fieldBlacklist ?? []) {
    const table = system.db.tables[fb.table];
    if (!table) {
      throw new Error(
        `Spark capability "${cap.name}": fieldBlacklist references table ` +
          `"${fb.table}" which does not exist.`,
      );
    }
    const cols = new Set<string>([
      table.primaryKeyFieldName,
      ...Object.values(table.fields).map((f) => f.name),
    ]);
    for (const field of fb.fields) {
      if (!cols.has(field)) {
        throw new Error(
          `Spark capability "${cap.name}": fieldBlacklist field ` +
            `"${fb.table}.${field}" is not a real column of table ` +
            `"${fb.table}". Virtual columns are never exposed under a ` +
            `column restriction, so they need no blacklist entry.`,
        );
      }
    }
  }
  for (
    const grant of capabilityFieldGrants({ fieldBlacklist: cap.fieldBlacklist })
  ) {
    if (grant.fields.length === 0) {
      throw new Error(
        `Spark capability "${cap.name}": fieldBlacklist hides every ` +
          `column of table "${grant.table}". Remove the table instead.`,
      );
    }
  }
  // A blacklisted table takes no other grant form in the same capability:
  // combining it with tables or fieldWhitelist is ambiguous. tables plus
  // fieldWhitelist keeps its established meaning (the restriction applies).
  const grantForms = new Map<string, string>();
  const forms: [string, string[]][] = [
    ["tables", cap.tables ?? []],
    ["fieldWhitelist", (cap.fieldWhitelist ?? []).map((e) => e.table)],
    ["fieldBlacklist", (cap.fieldBlacklist ?? []).map((e) => e.table)],
  ];
  for (const [form, names] of forms) {
    for (const name of new Set(names)) {
      const previous = grantForms.get(name);
      if (
        previous && (previous === "fieldBlacklist" || form === "fieldBlacklist")
      ) {
        throw new Error(
          `Spark capability "${cap.name}": table "${name}" is listed in ` +
            `both ${previous} and ${form}. A blacklisted table takes no ` +
            `other grant in the same capability.`,
        );
      }
      grantForms.set(name, form);
    }
  }
}

// Builds scalar definitions for the runtime view/table/field whitelists
// derived from a JSON skill-name array scalar. View/table whitelists are JSON
// arrays. Field whitelists are either the object shape used by query
// validation or the array shape used by dynamic UI accessPolicy. Column
// restrictions come from capabilityFieldGrants, so `fieldBlacklist` merges
// exactly like `fieldWhitelist`: allowed columns union across held
// capabilities, and a wholesale `tables` grant wins.

export function defQueryWhitelists<
  T extends import("std/statements").IStatementsBase,
>(
  s: T,
  capabilities: readonly ReadCapability[],
  capabilitiesJsonRef: Sql,
  prefix: string,
  opts?: {
    fieldPolicyShape?: "query" | "ui";
  },
) {
  let viewItems: Sql = sql`''`;
  let tableItems: Sql = sql`''`;
  let fieldObjectItems: Sql = sql`''`;
  let fieldArrayItems: Sql = sql`''`;
  const fieldPolicyShape = opts?.fieldPolicyShape ?? "query";
  const fieldGrants = capabilities.map((skill) => ({
    skill,
    grants: capabilityFieldGrants(skill),
  }));
  const fieldTables = [
    ...new Set(
      fieldGrants.flatMap(({ grants }) => grants.map((item) => item.table)),
    ),
  ];
  for (const skill of capabilities) {
    const views = skill.views ?? [];
    const tables = skill.tables ?? [];
    const guard = sql`${capabilitiesJsonRef} @> json_build_array(${
      sql.lit(skill.name)
    })`;
    if (views.length > 0) {
      const lit = sql.lit(views.map((v) => `"${v}",`).join(""));
      viewItems =
        sql`${viewItems} || case when ${guard} then ${lit} else '' end`;
    }
    if (tables.length > 0) {
      const lit = sql.lit(tables.map((t) => `"${t}",`).join(""));
      tableItems =
        sql`${tableItems} || case when ${guard} then ${lit} else '' end`;
    }
  }
  for (const [idx, table] of fieldTables.entries()) {
    // A capability that lists this table in `tables` but does NOT field-restrict
    // it grants the table WHOLESALE. When any such capability is held, the table
    // is whole-access, so its field whitelist must be suppressed — a column
    // restriction from one capability must not override a wholesale grant from
    // another (the platform caps a table to its field whitelist the moment the
    // table appears there at all, so an un-suppressed entry would silently
    // shrink the wholesale grant). The table stays visible via that capability's
    // entry in the table whitelist.
    const wholesaleCaps = fieldGrants
      .filter(({ skill, grants }) =>
        (skill.tables ?? []).includes(table) &&
        !grants.some((item) => item.table === table)
      )
      .map(({ skill }) => skill);
    let fieldItems: Sql = sql`''`;
    for (const { skill, grants } of fieldGrants) {
      const fields = [
        ...new Set(
          grants
            .filter((item) => item.table === table)
            .flatMap((item) => item.fields),
        ),
      ];
      if (fields.length === 0) continue;
      const guard = sql`${capabilitiesJsonRef} @> json_build_array(${
        sql.lit(skill.name)
      })`;
      const lit = sql.lit(fields.map((field) => `"${field}",`).join(""));
      fieldItems =
        sql`${fieldItems} || case when ${guard} then ${lit} else '' end`;
    }
    if (wholesaleCaps.length > 0) {
      const wholesaleGuard = wholesaleCaps
        .map((skill) =>
          sql`${capabilitiesJsonRef} @> json_build_array(${
            sql.lit(skill.name)
          })`
        )
        .reduce((a, b) => sql`${a} or ${b}`);
      fieldItems =
        sql`case when ${wholesaleGuard} then '' else (${fieldItems}) end`;
    }
    const fieldItemsName = `${prefix}_field_items_${idx}`;
    s.defScalar(fieldItemsName, fieldItems);
    if (fieldPolicyShape === "query") {
      const objectPrefix = sql.lit(`${JSON.stringify(table)}:[`);
      fieldObjectItems = sql`${fieldObjectItems} || case when ${
        sql.ref(fieldItemsName)
      } = ''
          then ''
          else ${objectPrefix} || left(${sql.ref(fieldItemsName)},
            length(${sql.ref(fieldItemsName)}) - 1) || '],'
          end`;
    } else {
      const arrayPrefix = sql.lit(
        `{"table":${JSON.stringify(table)},"fields":[`,
      );
      fieldArrayItems = sql`${fieldArrayItems} || case when ${
        sql.ref(fieldItemsName)
      } = ''
          then ''
          else ${arrayPrefix} || left(${sql.ref(fieldItemsName)},
            length(${sql.ref(fieldItemsName)}) - 1) || ']},'
          end`;
    }
  }
  // The item strings are '"a","b",…,' with a trailing comma — strip it with
  // left() (Yolm's rtrim is single-argument).
  s.defScalar(`${prefix}_view_items`, viewItems);
  s.defScalar(
    `${prefix}_view_whitelist`,
    sql`case when ${sql.ref(`${prefix}_view_items`)} = '' then '[]'
      else '[' || left(${sql.ref(`${prefix}_view_items`)},
        length(${sql.ref(`${prefix}_view_items`)}) - 1) || ']' end`,
  );
  s.defScalar(`${prefix}_table_items`, tableItems);
  s.defScalar(
    `${prefix}_table_whitelist`,
    sql`case when ${sql.ref(`${prefix}_table_items`)} = '' then '[]'
      else '[' || left(${sql.ref(`${prefix}_table_items`)},
        length(${sql.ref(`${prefix}_table_items`)}) - 1) || ']' end`,
  );
  if (fieldPolicyShape === "query") {
    s.defScalar(`${prefix}_field_object_items`, fieldObjectItems);
    s.defScalar(
      `${prefix}_field_whitelist`,
      sql`case when ${sql.ref(`${prefix}_field_object_items`)} = '' then '{}'
        else '{' || left(${sql.ref(`${prefix}_field_object_items`)},
          length(${sql.ref(`${prefix}_field_object_items`)}) - 1) || '}' end`,
    );
  } else {
    s.defScalar(`${prefix}_field_array_items`, fieldArrayItems);
    s.defScalar(
      `${prefix}_ui_field_whitelist`,
      sql`case when ${sql.ref(`${prefix}_field_array_items`)} = '' then '[]'
        else '[' || left(${sql.ref(`${prefix}_field_array_items`)},
          length(${sql.ref(`${prefix}_field_array_items`)}) - 1) || ']' end`,
    );
  }
}
