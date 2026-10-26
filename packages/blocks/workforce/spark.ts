import {
  AuthBlock,
  currentUserHasPermission,
  getRolePermissions,
} from "blocks/auth";
import type { SparkAction, SparkCapability, SparkFunction } from "blocks/spark";
import { rethrowSparkActionError } from "blocks/spark/action_errors";
import type { GeneralServerStatements } from "std/statements";
import { type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import { workforceAuthMappingMatchSql, type WorkforceBlock } from "./index";

const registered = new WeakMap<WorkforceBlock, string>();
const input = (key: string) => sql`p_input->>${sql.lit(key)}`;
const id = (key: string) => sql`try_cast(${input(key)} as bigint)`;

function objectInput(s: GeneralServerStatements, keys: string[]) {
  s.throwErrorIf(
    sql`json_typeof(p_input) is distinct from 'object'`,
    sql.lit`Provide a JSON object.`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from json.object_each(p_input) field
      where field.key not in (${keys.map((key) => sql.lit(key))}))`,
    sql
      .lit`The input contains unsupported fields. Use the tool's documented fields.`,
  );
}

function optionalId(s: GeneralServerStatements, key: string) {
  s.throwErrorIf(
    sql`${input(key)} is not null and (
      json_typeof(p_input->${sql.lit(key)}) <> 'number'
      or ${id(key)} is null or ${id(key)} < 0
      or try_cast(${input(key)} as double) <> cast(${id(key)} as double))`,
    sql.lit(`${key} must be a nonnegative integer ID or null.`),
  );
}

function optionalActive(s: GeneralServerStatements) {
  s.throwErrorIf(
    sql`(p_input ? 'is_active') and (json_typeof(p_input->'is_active') is distinct from 'boolean')`,
    sql.lit`is_active must be true or false.`,
  );
}

/** Opt in through Spark's capability list; this does not add database tables. */
export function workforceSparkCapability(
  block: WorkforceBlock,
  opts: { permission?: string } = {},
): SparkCapability {
  const permission =
    system.block(AuthBlock).opts.accessPolicy?.sysadminPermission ??
      block.opts.managementPermission ?? opts.permission;
  if (!permission) {
    throw new Error(
      "Workforce Spark requires a management permission or an explicit capability permission.",
    );
  }
  if (registered.has(block) && registered.get(block) !== permission) {
    throw new Error(
      "Workforce Spark must use the same permission for every registration.",
    );
  }
  const requireManagement = (s: GeneralServerStatements) => {
    s.throwErrorIf(
      sql`current_user is null or not exists(select 1 from db.sys_users
        where id = current_user and not disabled)
        or ${currentUserHasPermission(sql.lit(permission))} is not true`,
      sql.lit`You do not have permission to manage workforce configuration.`,
    );
    block.assertManagementPermission(s);
  };
  const referenceData: {
    entity: string;
    singular: string;
    table: string;
    maxName: number;
    facets: string[];
  }[] = [
    {
      entity: "job_profiles",
      singular: "job_profile",
      table: block.jobProfilesTable,
      maxName: 150,
      facets: [],
    },
    ...(block.organizationsTable
      ? [{
        entity: "organizations",
        singular: "organization",
        table: block.organizationsTable,
        maxName: 200,
        facets: [],
      }]
      : []),
    ...(block.orgUnitsTable
      ? [{
        entity: "org_units",
        singular: "org_unit",
        table: block.orgUnitsTable,
        maxName: 200,
        facets: [
          "parent_org_unit_id",
          ...(block.organizationsTable ? ["workforce_organization_id"] : []),
        ],
      }]
      : []),
    ...(block.positionsTable
      ? [{
        entity: "positions",
        singular: "position",
        table: block.positionsTable,
        maxName: 200,
        facets: [
          "workforce_job_profile_id",
          ...(block.organizationsTable ? ["workforce_organization_id"] : []),
          ...(block.orgUnitsTable ? ["workforce_org_unit_id"] : []),
          ...(block.locationsTable ? ["workforce_location_id"] : []),
        ],
      }]
      : []),
  ];
  const facets = [
    "workforce_job_profile_id",
    ...(block.organizationsTable
      ? ["employer_workforce_organization_id", "host_workforce_organization_id"]
      : []),
    ...(block.orgUnitsTable ? ["workforce_org_unit_id"] : []),
    ...(block.locationsTable ? ["workforce_location_id"] : []),
  ];
  const ruleKeys = [
    "rule_id",
    "role_ids",
    "permissions",
    "worker_type",
    "effective_from",
    "effective_to",
    "is_active",
    ...facets,
  ];
  const ruleInputType =
    `{ rule_id?: number; role_ids: number[]; permissions: string[]; worker_type?: ${
      block.workerTypes.map((type) => JSON.stringify(type.name)).join(" | ")
    } | null; effective_from?: string | null; effective_to?: string | null; is_active?: boolean; ${
      facets.map((key) => `${key}?: number | null`).join("; ")
    } }`;
  const parseRule = (s: GeneralServerStatements) => {
    objectInput(s, ruleKeys);
    optionalActive(s);
    for (const key of ["rule_id", ...facets]) optionalId(s, key);
    s.throwErrorIf(
      sql`${input("worker_type")} is not null and (
        json_typeof(p_input->'worker_type') <> 'string'
        or try_cast(${
        input("worker_type")
      } as enums.workforce_worker_type) is null)`,
      sql.lit`Select a configured worker type.`,
    );
    for (const key of ["effective_from", "effective_to"]) {
      s.throwErrorIf(
        sql`${input(key)} is not null and (json_typeof(p_input->${
          sql.lit(key)
        }) <> 'string'
          or try_cast(${input(key)} as date) is null)`,
        sql.lit(`${key} must be a valid date or null.`),
      );
    }
    s.throwErrorIf(
      sql`try_cast(${input("effective_to")} as date) <= try_cast(${
        input("effective_from")
      } as date)`,
      sql.lit`The end date must be after the start date.`,
    );
    for (const key of ["role_ids", "permissions"]) {
      s.throwErrorIf(
        sql`json_typeof(p_input->${sql.lit(key)}) is distinct from 'array'`,
        sql.lit(`${key} must be an array; use [] for no grants of that kind.`),
      );
      s.throwErrorIf(
        sql`json_array_length(p_input->${sql.lit(key)}) > 1000`,
        sql.lit`Limit each grant list to 1,000 entries.`,
      );
    }
    s.throwErrorIf(
      sql`exists(select 1 from json.array_each(p_input->'role_ids') item
        where json_typeof(item.value) <> 'number'
          or try_cast(item.value::string as bigint) is null
          or try_cast(item.value::string as double) <> cast(try_cast(item.value::string as bigint) as double)
          or not exists(select 1 from db.auth_roles where id = try_cast(item.value::string as bigint)))`,
      sql.lit`Every role ID must identify an existing auth role.`,
    );
    s.throwErrorIf(
      sql`exists(select 1 from json.array_each(p_input->'permissions') item
        where json_typeof(item.value) <> 'string'
          or try_cast(item.value #>> '{}' as enums.auth_permission) is null)`,
      sql.lit`Every permission must be a configured permission name.`,
    );
    s.throwErrorIf(
      sql`json_array_length(p_input->'role_ids') = 0 and json_array_length(p_input->'permissions') = 0`,
      sql.lit`Select at least one role or permission this rule should grant.`,
    );
    s.defTable("selected_roles", {
      fields: [
        { name: "auth_role_id", type: "BigInt" },
        { name: "name", type: "String" },
      ],
    });
    s.modify(
      sql`insert into selected_roles (auth_role_id, name)
      select distinct role.id, role.name
      from json.array_each(p_input->'role_ids') item join db.auth_roles role
        on role.id = try_cast(item.value::string as bigint)`,
    );
    s.defTable("selected_permissions", {
      fields: [{ name: "permission", type: "String" }],
    });
    s.modify(
      sql`insert into selected_permissions (permission)
      select distinct item.value #>> '{}'
      from json.array_each(p_input->'permissions') item`,
    );
    s.defRecord(
      "rule_draft",
      sql`select
      ${input("worker_type")} as worker_type,
      ${facets.map((key) => sql`${id(key)} as ${sql.ref(key)}`)},
      try_cast(${input("effective_from")} as date) as effective_from,
      try_cast(${input("effective_to")} as date) as effective_to,
      coalesce(try_cast(${input("is_active")} as bool), true) as is_active`,
    );
    s.throwErrorIf(
      sql`${id("rule_id")} is not null and not exists(
        select 1 from db.${sql.ref(block.authRoleMappingsTable!)} where id = ${
        id("rule_id")
      })`,
      sql.lit`The access rule no longer exists.`,
    );
    const facetTables: [string, string | undefined][] = [
      ["workforce_job_profile_id", block.jobProfilesTable],
      ["employer_workforce_organization_id", block.organizationsTable],
      ["host_workforce_organization_id", block.organizationsTable],
      ["workforce_org_unit_id", block.orgUnitsTable],
      ["workforce_location_id", block.locationsTable],
    ];
    for (const [key, table] of facetTables) {
      if (!table) continue;
      s.throwErrorIf(
        sql`${id(key)} is not null and not exists(select 1 from db.${
          sql.ref(table)
        } where id = ${id(key)})`,
        sql.lit(`${key} must identify an existing record.`),
      );
    }
  };
  const readRule = (record: Sql) =>
    sql`json_build_object(
    'rule_id', ${record}.id, 'worker_type', ${record}.worker_type,
    'effective_from', ${record}.effective_from, 'effective_to', ${record}.effective_to,
    'is_active', ${record}.is_active,
    ${facets.flatMap((key) => [sql.lit(key), sql`${record}.${sql.ref(key)}`])},
    'role_ids', coalesce((select json_array_agg(auth_role_id order by auth_role_id)
      from db.${
      sql.ref(block.authRoleMappingRolesTable!)
    } where workforce_auth_role_mapping_id = ${record}.id), '[]'::json),
    'permissions', coalesce((select json_array_agg(permission order by permission)
      from db.${
      sql.ref(block.authRoleMappingPermissionsTable!)
    } where workforce_auth_role_mapping_id = ${record}.id), '[]'::json))`;

  if (!registered.has(block)) {
    registered.set(block, permission);
    const procedure = (
      name: string,
      body: (s: GeneralServerStatements) => void,
    ) => {
      system.storedProcedure({
        name: `workforce_spark_${name}`,
        transaction: "caller",
        inputScalars: [{ name: "p_input", type: "Json" }],
        outputScalars: [{ name: "workforce_spark_result", type: "Json" }],
        procedure: (s) => {
          requireManagement(s);
          body(s);
        },
      });
    };
    const listings = referenceData.map((ref) => ({
      entity: ref.entity,
      query:
        sql`select id, json_build_object('id', id, 'name', name, 'is_active', is_active
        ${
          ref.facets.length
            ? sql`, ${
              ref.facets.flatMap((key) => [sql.lit(key), sql.ref(key)])
            }`
            : sql``
        }) as item
        from db.${sql.ref(ref.table)}`,
    }));
    if (block.locationsTable) {
      listings.push({
        entity: "locations",
        query:
          sql`select location.id, json_build_object('id', location.id, 'name', location.name,
        'active', stored.active) as item from (${
            block.locationOptions({ includeInactive: true })
          }) location
        join db.${
            sql.ref(block.locationsTable)
          } stored on stored.id = location.id`,
      });
    }
    if (block.authRoleMappingsTable) {
      listings.push({
        entity: "access_rules",
        query: sql`select rule.id, ${readRule(sql`rule`)} as item from db.${
          sql.ref(block.authRoleMappingsTable)
        } rule`,
      });
      listings.push({
        entity: "roles",
        query:
          sql`select role.id, json_build_object('id', role.id, 'name', role.name,
        'permissions', coalesce((select json_array_agg(permission order by permission)
          from (${
            getRolePermissions(sql`role.id`)
          }) granted), '[]'::json)) as item from db.auth_roles role`,
      });
    }
    procedure("list_configuration", (s) => {
      objectInput(s, ["entity", "offset", "limit"]);
      optionalId(s, "offset");
      optionalId(s, "limit");
      s.throwErrorIf(
        sql`coalesce(${id("limit")}, 50) not between 1 and 100`,
        sql.lit`limit must be between 1 and 100.`,
      );
      s.throwErrorIf(
        sql`${input("entity")} is null or ${input("entity")} not in (${
          [...listings.map((item) => item.entity), "permissions"].map((key) =>
            sql.lit(key)
          )
        })`,
        sql.lit`Select an enabled configuration entity.`,
      );
      for (const listing of listings) {
        s.if(sql`${input("entity")} = ${sql.lit(listing.entity)}`, (s) => {
          s.defTable(
            "page",
            sql`select id, item from (${listing.query}) source order by id
            limit coalesce(${id("limit")}, 50) offset coalesce(${
              id("offset")
            }, 0)`,
          );
          s.setScalar(
            "workforce_spark_result",
            sql`json_build_object('items', coalesce((select json_array_agg(item order by id) from page), '[]'::json),
            'next_offset', case when (select count(*) from page) = coalesce(${
              id("limit")
            }, 50)
              then coalesce(${id("offset")}, 0) + coalesce(${
              id("limit")
            }, 50) else null end)`,
          );
        });
      }
      s.if(sql`${input("entity")} = 'permissions'`, (s) => {
        const permissions = [...system.enums.auth_permission.valuesMap.values()]
          .map((value) => ({
            name: value.name,
            label: value.displayName ?? value.name,
          }));
        s.setScalar(
          "workforce_spark_result",
          sql`json_build_object('items', coalesce((select json_array_agg(value) from (
          select value from json.array_each(${
            sql.lit(JSON.stringify(permissions))
          }::json)
          limit coalesce(${id("limit")}, 50) offset coalesce(${id("offset")}, 0)
        ) page), '[]'::json), 'next_offset', case when coalesce(${
            id("offset")
          }, 0) + coalesce(${id("limit")}, 50) < ${permissions.length}
          then coalesce(${id("offset")}, 0) + coalesce(${
            id("limit")
          }, 50) else null end)`,
        );
      });
    });
    for (const ref of referenceData) {
      procedure(`save_${ref.singular}`, (s) => {
        objectInput(s, ["id", "name", "is_active", ...ref.facets]);
        optionalActive(s);
        for (const key of ["id", ...ref.facets]) optionalId(s, key);
        s.defScalar("record_id", id("id"));
        s.throwErrorIf(
          sql`(p_input ? 'name') and ((json_typeof(p_input->'name') is distinct from 'string')
          or length(trim(${input("name")})) not between 1 and ${ref.maxName})`,
          sql.lit(`Name must contain 1–${ref.maxName} characters.`),
        );
        s.if(sql`record_id is null`, (s) => {
          if (!block.opts.enableReferenceDataCreation) {
            s.throwError(
              sql.lit`Creating workforce reference data is disabled.`,
            );
          }
          s.throwErrorIf(
            sql`nullif(trim(${input("name")}), '') is null`,
            sql.lit`A new record needs a name.`,
          );
          s.modify(
            sql`insert into db.${sql.ref(ref.table)} (name, is_active ${
              ref.facets.length
                ? sql`, ${ref.facets.map((key) => sql.ref(key))}`
                : sql``
            })
            values (trim(${input("name")}), coalesce(try_cast(${
              input("is_active")
            } as bool), true) ${
              ref.facets.length
                ? sql`, ${ref.facets.map((key) => id(key))}`
                : sql``
            }) returning id into record_id`,
          );
        }, (s) => {
          s.throwErrorIf(
            sql`not exists(select 1 from db.${
              sql.ref(ref.table)
            } where id = record_id)`,
            sql.lit`The configuration record no longer exists.`,
          );
          s.modify(sql`update db.${sql.ref(ref.table)} set
            name = case when p_input ? 'name' then trim(${
            input("name")
          }) else name end,
            is_active = coalesce(try_cast(${
            input("is_active")
          } as bool), is_active)
            ${
            ref.facets.map((key) =>
              sql`, ${sql.ref(key)} = case when p_input ? ${
                sql.lit(key)
              } then ${id(key)} else ${sql.ref(key)} end`
            ).reduce((a, b) => sql`${a}${b}`, sql``)
          }
            where id = record_id`);
        });
        if (ref.entity === "org_units") {
          s.callStoredProcedure("workforce_validate_org_units");
        }
        if (block.authRoleMappingsTable) {
          s.callStoredProcedure("workforce_reconcile_auth_rules");
        }
        s.setScalar(
          "workforce_spark_result",
          sql`(select json_build_object('id', id, 'name', name, 'is_active', is_active) from db.${
            sql.ref(ref.table)
          } where id = record_id)`,
        );
      });
    }
    if (block.authRoleMappingsTable) {
      procedure("get_access_rule", (s) => {
        objectInput(s, ["rule_id"]);
        optionalId(s, "rule_id");
        s.throwErrorIf(
          sql`not exists(select 1 from db.${
            sql.ref(block.authRoleMappingsTable!)
          } where id = ${id("rule_id")})`,
          sql.lit`The access rule no longer exists.`,
        );
        s.setScalar(
          "workforce_spark_result",
          sql`(select ${readRule(sql`rule`)} from db.${
            sql.ref(block.authRoleMappingsTable!)
          } rule where id = ${id("rule_id")})`,
        );
      });
      procedure("preview_access_rule", (s) => {
        parseRule(s);
        s.defTable(
          "matching_people",
          sql`select person.id, person.display_name from db.${
            sql.ref(block.peopleTable)
          } person
          where ${block.personAccessEligible(sql`person`)} and ${
            block.personSysUserId(sql`person`)
          } is not null
          and ${
            workforceAuthMappingMatchSql({
              workforce: block,
              personRecord: sql`person`,
              mappingRecord: sql`rule_draft`,
            })
          }`,
        );
        s.setScalar(
          "workforce_spark_result",
          sql`json_build_object('matching_people', (select count(*) from matching_people),
          'role_count', (select count(*) from selected_roles),
          'additional_permission_count', (select count(*) from selected_permissions),
          'active_today', rule_draft.is_active and (rule_draft.effective_from is null or rule_draft.effective_from <= current_date())
            and (rule_draft.effective_to is null or current_date() < rule_draft.effective_to),
          'sample', coalesce((select json_array_agg(json_build_object('id', id, 'name', display_name) order by display_name, id)
            from (select * from matching_people order by display_name, id limit 10) sampled_people), '[]'::json))`,
        );
      });
      procedure("save_access_rule", (s) => {
        parseRule(s);
        s.callStoredProcedure("workforce_save_auth_rule", {
          inputScalars: {
            p_rule_id: id("rule_id"),
            p_worker_type: sql`rule_draft.worker_type`,
            p_effective_from: sql`rule_draft.effective_from`,
            p_effective_to: sql`rule_draft.effective_to`,
            p_is_active: sql`rule_draft.is_active is not false`,
            ...Object.fromEntries(
              facets.map((
                key,
              ) => [`p_${key}`, sql`rule_draft.${sql.ref(key)}`]),
            ),
          },
          inputTables: {
            p_roles: "selected_roles",
            p_permissions: "selected_permissions",
          },
          outputScalars: { saved_rule_id: "saved_id" },
        });
        s.setScalar(
          "workforce_spark_result",
          sql`(select ${readRule(sql`rule`)} from db.${
            sql.ref(block.authRoleMappingsTable!)
          } rule where id = saved_id)`,
        );
      });
    }
  }
  const call = (s: GeneralServerStatements, name: string, value: Sql) =>
    s.callStoredProcedure(`workforce_spark_${name}`, {
      inputScalars: { p_input: value },
      outputScalars: { workforce_spark_result: "tool_result" },
    });
  const fn = (
    name: string,
    description: string,
    inputType: string,
  ): SparkFunction => ({
    name,
    description,
    inputType,
    procedure: (s) => {
      call(s, name, sql`function_input`);
      s.return(sql`tool_result`);
    },
  });
  const action = (
    name: string,
    description: string,
    inputType: string,
  ): SparkAction => ({
    name,
    description,
    inputType,
    mode: "reversible",
    procedure: (s) =>
      s.try({
        body: (s) => {
          call(s, name, sql`action_input`);
          s.setScalar("action_result", sql`tool_result::string`);
        },
        errorName: "workforce_tool_error",
        catch: (s) => rethrowSparkActionError(s, "workforce_tool_error"),
      }),
  });
  const entities = [
    ...referenceData.map((ref) => ref.entity),
    ...(block.locationsTable ? ["locations"] : []),
    ...(block.authRoleMappingsTable ? ["access_rules", "roles"] : []),
    "permissions",
  ];
  return {
    name: "workforce",
    label: "Workforce",
    permission,
    description: "Manage workforce configuration and access rules.",
    functions: [
      fn(
        "list_configuration",
        "List enabled workforce configuration with stable IDs; includes inactive records.",
        `{ entity: ${
          entities.map((entity) => JSON.stringify(entity)).join(" | ")
        }; offset?: number; limit?: number }`,
      ),
      ...(block.authRoleMappingsTable
        ? [
          fn(
            "get_access_rule",
            "Read an access rule in the shape accepted by save_access_rule.",
            "{ rule_id: number }",
          ),
          fn(
            "preview_access_rule",
            "Validate a proposed access rule and count eligible matching people, with a bounded sample.",
            ruleInputType,
          ),
        ]
        : []),
    ],
    actions: [
      ...referenceData.map((ref) =>
        action(
          `save_${ref.singular}`,
          `Create or update a workforce ${ref.singular}; omit id to create, set is_active to false to deactivate.`,
          `{ id?: number; name?: string; is_active?: boolean; ${
            ref.facets.map((key) => `${key}?: number | null`).join("; ")
          } }`,
        )
      ),
      ...(block.authRoleMappingsTable
        ? [
          action(
            "save_access_rule",
            "Create or replace an access rule, granting roles, permissions, or both; reconcile affected access immediately.",
            ruleInputType,
          ),
        ]
        : []),
    ],
    doc:
      `Manage the enabled workforce configuration through these tools. Page through list_configuration for IDs; permissions lists the available permission names and roles includes inherited grants.
Reference-data saves are patches: omitted fields retain their values, null clears an optional relationship. Omit id to create. Deactivate rather than delete historical configuration. Shared locations are readable here and managed through LocationsBlock.
Access-rule saves replace the whole rule: first get_access_rule when editing, then preview_access_rule before saving. role_ids and permissions are required arrays; either may be empty, but not both. Omitted criteria mean Any, omitted dates mean unbounded, and omitted is_active means true. Every selected criterion must match the person's active primary assignment; location matching uses exact IDs, not descendants. effective_to is exclusive. Job profiles remain global.
Read existing rules before creating one to avoid duplicate or overlapping grants. Rules are additive: disabling one only removes that rule's grants; another rule or manual grant may retain access. Renaming configuration preserves IDs. Actions use Spark transactions and receipts, so failed validation rolls back all writes and access reconciliation. Tools are permission gated and available through Spark and MCP when this capability is registered.`,
  };
}
