import { getRolePermissions } from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { WorkforceBlock } from "./index";

export function registerWorkforceIntervalValidation(workforce: WorkforceBlock) {
  system.storedProcedure({
    name: "workforce_validate_person_intervals",
    transaction: "caller",
    inputScalars: [{ name: "p_person_id", type: "BigInt" }],
    procedure: (s) => {
      if (!workforce.opts.allowMultipleActiveRelationships) {
        s.throwErrorIf(
          sql`exists (
            select 1 from db.${sql.ref(workforce.workerRelationshipsTable)} a
            join db.${sql.ref(workforce.workerRelationshipsTable)} b
              on a.person_id = b.person_id and a.id < b.id
            where a.person_id = p_person_id
              and a.status = ${sql.lit(workforce.activeRelationshipStatus)}
              and b.status = ${sql.lit(workforce.activeRelationshipStatus)}
              and (b.effective_to is null or a.effective_from < b.effective_to)
              and (a.effective_to is null or b.effective_from < a.effective_to)
          )`,
          sql
            .lit`Active employment relationships cannot overlap. End the existing relationship on or before the new start date.`,
        );
      }
      if (!workforce.opts.allowMultipleActivePrimaryAssignments) {
        s.throwErrorIf(
          sql`exists (
            select 1 from db.${sql.ref(workforce.assignmentsTable)} a
            join db.${sql.ref(workforce.assignmentsTable)} b
              on a.worker_relationship_id = b.worker_relationship_id and a.id < b.id
            join db.${sql.ref(workforce.workerRelationshipsTable)} relationship
              on relationship.id = a.worker_relationship_id
            where relationship.person_id = p_person_id
              and a.is_primary and b.is_primary
              and a.status = ${sql.lit(workforce.activeAssignmentStatus)}
              and b.status = ${sql.lit(workforce.activeAssignmentStatus)}
              and (b.effective_to is null or a.effective_from < b.effective_to)
              and (a.effective_to is null or b.effective_from < a.effective_to)
          )`,
          sql
            .lit`Active primary assignments cannot overlap within an employment relationship. End the existing assignment on or before the new start date.`,
        );
      }
    },
  });
}

export function registerWorkforceAuthRuleSaveProcedure(
  workforce: WorkforceBlock,
) {
  const facets = [
    ...(workforce.organizationsTable
      ? ["employer_workforce_organization_id", "host_workforce_organization_id"]
      : []),
    "workforce_job_profile_id",
    ...(workforce.orgUnitsTable ? ["workforce_org_unit_id"] : []),
    ...(workforce.locationsTable ? ["workforce_location_id"] : []),
  ];
  system.storedProcedure({
    name: "workforce_save_auth_rule",
    transaction: "caller",
    inputScalars: [
      { name: "p_rule_id", type: "BigInt" },
      { name: "p_worker_type", type: "String" },
      { name: "p_effective_from", type: "Date" },
      { name: "p_effective_to", type: "Date" },
      { name: "p_is_active", type: "Bool", notNull: true },
      ...facets.map((name) => ({ name: `p_${name}`, type: "BigInt" as const })),
    ],
    inputTables: [
      {
        name: "p_roles",
        fields: [
          { name: "auth_role_id", type: "BigInt" },
          { name: "name", type: "String" },
        ],
      },
      {
        name: "p_permissions",
        fields: [{ name: "permission", type: "String" }],
      },
    ],
    outputScalars: [{ name: "saved_rule_id", type: "BigInt" }],
    procedure: (s) => {
      // Callers own the transaction; UI also asserts the original session.
      workforce.assertManagementPermission(s);
      s.throwErrorIf(
        sql`not exists (select 1 from p_roles)
          and not exists (select 1 from p_permissions)`,
        sql.lit`Select at least one role or permission this rule should grant.`,
      );
      s.throwErrorIf(
        sql`p_rule_id is not null and not exists (
          select 1 from db.${
          sql.ref(workforce.authRoleMappingsTable!)
        } where id = p_rule_id
        )`,
        sql.lit`The access rule no longer exists.`,
      );
      s.throwErrorIf(
        sql`p_effective_from is not null and p_effective_to is not null and p_effective_to <= p_effective_from`,
        sql.lit`The end date must be after the start date.`,
      );
      const fields: [string, Sql][] = [
        ["worker_type", sql`p_worker_type`],
        ["effective_from", sql`p_effective_from`],
        ["effective_to", sql`p_effective_to`],
        ["is_active", sql`p_is_active`],
        ...facets.map((name): [string, Sql] => [name, sql.ref(`p_${name}`)]),
      ];
      s.setScalar("saved_rule_id", sql`p_rule_id`);
      s.if(sql`saved_rule_id is null`, (s) => {
        s.modify(sql`
          insert into db.${sql.ref(workforce.authRoleMappingsTable!)}
            (${fields.map(([name]) => sql.ref(name))})
          values (${fields.map(([, value]) => value)})
          returning id into inserted_rule_id
        `);
        s.setScalar("saved_rule_id", sql`inserted_rule_id`);
      }, (s) => {
        s.modify(sql`
          update db.${sql.ref(workforce.authRoleMappingsTable!)}
          set ${fields.map(([name, value]) => sql`${sql.ref(name)} = ${value}`)}
          where id = saved_rule_id
        `);
      });
      s.modify(sql`
        delete from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
        where workforce_auth_role_mapping_id = saved_rule_id
      `);
      s.modify(sql`
        insert into db.${sql.ref(workforce.authRoleMappingRolesTable!)}
          (workforce_auth_role_mapping_id, auth_role_id)
        select saved_rule_id, auth_role_id from p_roles
      `);
      s.modify(sql`
        delete from db.${sql.ref(workforce.authRoleMappingPermissionsTable!)}
        where workforce_auth_role_mapping_id = saved_rule_id
      `);
      s.modify(sql`
        insert into db.${sql.ref(workforce.authRoleMappingPermissionsTable!)}
          (workforce_auth_role_mapping_id, permission)
        select saved_rule_id, selected_permission.permission
        from p_permissions selected_permission
        where not exists (
          select 1 from p_roles selected_role
          where exists (
            select 1 from (${
        getRolePermissions(sql`selected_role.auth_role_id`)
      }) granted
            where granted.permission = selected_permission.permission
          )
        )
      `);
      s.callStoredProcedure("workforce_reconcile_auth_rules");
    },
  });
}

/** Every org-unit writer calls this inside its transaction, including imports. */
export function registerWorkforceOrgUnitValidation(workforce: WorkforceBlock) {
  if (!workforce.orgUnitsTable) return;
  const table = sql.ref(workforce.orgUnitsTable);
  system.storedProcedure({
    name: "workforce_validate_org_units",
    transaction: "caller",
    procedure: (s) => {
      s.throwErrorIf(
        sql`exists(select 1 from db.${table} where trim(name) = '')`,
        sql.lit`Every org unit needs a name.`,
      );
      s.throwErrorIf(
        sql`(with recursive connected as (
        select id from db.${table} where parent_org_unit_id is null
        union all
        select child.id from db.${table} child join connected parent on child.parent_org_unit_id = parent.id
      ) select count(*) from connected) <> (select count(*) from db.${table})`,
        sql.lit`An org unit cannot be placed inside itself or its descendants.`,
      );
      if (workforce.organizationsTable) {
        s.throwErrorIf(
          sql`exists(
        select 1 from db.${table} child join db.${table} parent on parent.id = child.parent_org_unit_id
        where child.workforce_organization_id <> parent.workforce_organization_id
      )`,
          sql
            .lit`Parent and child org units must belong to the same organization.`,
        );
      }
    },
  });
}
