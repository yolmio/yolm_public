import { getRolePermissions } from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { WorkforceBlock } from "./index";

export function registerWorkforceAuthRuleSaveProcedure(
  workforce: WorkforceBlock,
) {
  const facets = [
    "employer_workforce_organization_id",
    "host_workforce_organization_id",
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
    procedure: (s) => {
      // The UI owns the transaction and its management-session assertion.
      s.throwErrorIf(
        sql`not exists (select 1 from p_roles)`,
        sql.lit`Select at least one auth role this rule should grant.`,
      );
      const fields: [string, Sql][] = [
        [
          "auth_role_id",
          sql`(select auth_role_id from p_roles order by name limit 1)`,
        ],
        ["worker_type", sql`p_worker_type`],
        ...facets.map((name): [string, Sql] => [name, sql.ref(`p_${name}`)]),
      ];
      s.defScalar("saved_rule_id", sql`p_rule_id`);
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
