import { sql } from "std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "std/sql_utils";
import type {
  CallStoredProcedureOpts,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import {
  AuthBlock,
  currentUserHasPermission,
  getRolePermissions,
} from "blocks/auth";
import {
  assertOriginalAccessActor,
  canManageStaffAccess,
  canManageStaffUser,
  isAccessAdministrator,
  protectedAccessPermission,
} from "blocks/auth/access_policy";
import { insertUserWithPassword } from "blocks/auth/shared";
import { UserAccountManagementButton } from "blocks/auth/users";
import { AccessCheck } from "blocks/auth/access_check";
import { Alert } from "components/alert";
import { AutoInsertButton } from "components/auto_insert_dialog";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { DataTable } from "components/data_table";
import type { ColumnsBuilder } from "components/data_table";
import { EachSelect } from "components/each_select";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { ModalDialog } from "components/modal";
import { PageHeader, PageTitleHeader } from "components/page_header";
import { Select } from "components/select";
import { Tabs } from "components/tabs";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form } from "std/form";
import { DatagridPage } from "pages/datagrid";
import { RecordWithTabsAndDetailPage } from "pages/record_with_tabs_and_detail";
import { Each, Route } from "std/ui";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import { WorkforcePeopleImportAction } from "./people_import";
import { registerWorkforceAuthRuleSaveProcedure } from "./stored_procedures";
import type { WorkforcePeopleImportActionProps } from "./people_import";

export { WorkforcePeopleImportAction } from "./people_import";
export type { WorkforcePeopleImportActionProps } from "./people_import";

/**
 * Contract person-aware blocks (training, scheduling, ...) consume instead
 * of touching workforce tables directly.
 *
 * Design 1 (Core HRIS Spine): a person's employment is a worker
 * relationship to an organization, and the work they do is an
 * effective-dated assignment to a job profile, position, org unit, and
 * location. Provider facts are derived "current as of `current_date()`"
 * from the active worker relationship and active primary assignment, so
 * consumers never reconstruct effective-dating themselves.
 *
 * The people, organizations, worker-relationships, job-profiles, and
 * assignments tables are always present. Org units, locations, positions,
 * reporting relationships, and auth-role mappings are opt-in: a provider
 * advertises them by exposing the matching table name (and accessors), and
 * consumers must gate audience foreign keys and UI on that presence.
 * `audienceMatchSql` only references audience columns for facets the
 * provider advertises, plus the always-present worker type, relationship
 * status, employer/host organization, job profile, and assignment status.
 *
 * Every person resolves to exactly one `sys_users` row via
 * `personSysUserId`, so anything recorded against a person id can always be
 * attributed to a specific user. The usual way to satisfy this contract is
 * `WorkforceBlock` itself - with enable flags, custom table names, enum
 * values, and `define` hooks - rather than re-implementing the interface.
 */
export interface WorkforceProvider {
  personTable: string;
  organizationsTable: string;
  workerRelationshipsTable: string;
  jobProfilesTable: string;
  assignmentsTable: string;
  orgUnitsTable?: string;
  locationsTable?: string;
  positionsTable?: string;
  reportingRelationshipsTable?: string;
  authRoleMappingsTable?: string;
  authRoleMappingRolesTable?: string;
  authRoleMappingPermissionsTable?: string;
  currentPersonId(): Sql;
  /** The `sys_users` id every person is guaranteed to have. */
  personSysUserId(personRecord: Sql): Sql;
  personSysUserJoin(personRecord: Sql, sysUserRecord: Sql): Sql;
  personDisplayName(personRecord: Sql): Sql;
  personEmail?(personRecord: Sql): Sql;
  personPhone?(personRecord: Sql): Sql;
  personLanguage?(personRecord: Sql): Sql;
  personStatus?(personRecord: Sql): Sql;
  personCurrentWorkerRelationshipId?(personRecord: Sql): Sql;
  personWorkerType?(personRecord: Sql): Sql;
  personRelationshipStatus?(personRecord: Sql): Sql;
  personEmployerOrganizationId?(personRecord: Sql): Sql;
  personHostOrganizationId?(personRecord: Sql): Sql;
  personPrimaryOrgUnitId?(personRecord: Sql): Sql;
  personPrimaryLocationId?(personRecord: Sql): Sql;
  personPrimaryJobProfileId?(personRecord: Sql): Sql;
  personPrimaryPositionId?(personRecord: Sql): Sql;
  personPrimaryAssignmentStatus?(personRecord: Sql): Sql;
  personPrimaryOrgUnitDisplay?(personRecord: Sql): Sql;
  personPrimaryLocationDisplay?(personRecord: Sql): Sql;
  personPrimaryJobProfileDisplay?(personRecord: Sql): Sql;
  /** Whether the person has an active relationship and active primary assignment. */
  personAccessEligible(personRecord: Sql): Sql;
  /** Whether workforce ineligibility disables linked login accounts. */
  disableLoginWhenAccessIneligible?: boolean;
  audienceMatchSql(args: { personRecord: Sql; audienceRecord: Sql }): Sql;
}

export interface WorkforceEnumValue {
  name: string;
  displayName: string;
}

export interface WorkforceBlockOpts {
  peopleTable?: string;
  organizationsTable?: string;
  workerRelationshipsTable?: string;
  jobProfilesTable?: string;
  assignmentsTable?: string;
  /** Adds the recursive org-unit hierarchy table and assignment fk. */
  enableOrgUnits?: boolean;
  /** Adds the locations table and assignment fk. */
  enableLocations?: boolean;
  /** Adds the positions table (concrete seats) and assignment fk. */
  enablePositions?: boolean;
  /** Adds the effective-dated reporting-relationship table. */
  enableReporting?: boolean;
  /** Adds the workforce-facts-to-auth-role mapping table. */
  enableAuthRoleMappings?: boolean;
  /**
   * Shows guided New relationship and New assignment actions on the person
   * detail page. Off by default so systems opt into workforce-history writes
   * deliberately.
   */
  enableRelationshipAndAssignmentCreation?: boolean;
  /** Shows Add actions on the workforce reference-data page. */
  enableReferenceDataCreation?: boolean;
  /** Server-side permission required by every block-owned management mutation. */
  managementPermission?: string;
  /** Optional job-profile-code allowlist. Protected access mappings are always excluded. */
  assignableJobProfiles?: string[];
  /**
   * Disables linked login accounts and revokes their sessions when workforce
   * facts become ineligible. Never re-enables an account. Off by default so
   * consumers opt into Workforce controlling AuthBlock login state.
   */
  disableLoginWhenAccessIneligible?: boolean;
  /**
   * Allows more than one open worker relationship per person. Off by default:
   * the canonical model expects a single current relationship unless a system
   * explicitly needs concurrent employment/contractor relationships.
   */
  allowMultipleActiveRelationships?: boolean;
  /**
   * Allows more than one open primary assignment per worker relationship.
   * Off by default: provider current facts still choose one assignment
   * deterministically, but most systems should model a single primary job.
   */
  allowMultipleActivePrimaryAssignments?: boolean;
  orgUnitsTable?: string;
  locationsTable?: string;
  positionsTable?: string;
  reportingRelationshipsTable?: string;
  authRoleMappingsTable?: string;
  authRoleMappingRolesTable?: string;
  authRoleMappingPermissionsTable?: string;
  /**
   * Worker type enum values. Defaults to employee, contractor,
   * vendor_worker, temp, intern.
   */
  workerTypes?: Array<string | WorkforceEnumValue>;
  /** Person global status enum values. Defaults to active, inactive. */
  personStatuses?: Array<string | WorkforceEnumValue>;
  /**
   * Worker-relationship status enum values. Defaults to active, inactive,
   * terminated, on_leave.
   */
  relationshipStatuses?: Array<string | WorkforceEnumValue>;
  /** Assignment status enum values. Defaults to active, ended, suspended. */
  assignmentStatuses?: Array<string | WorkforceEnumValue>;
  /** Active person status and default for new people. Defaults to "active". */
  activePersonStatus?: string;
  /** Active relationship status and default for new relationships. Defaults to "active". */
  activeRelationshipStatus?: string;
  /** Active assignment status and default for new assignments. Defaults to "active". */
  activeAssignmentStatus?: string;
  definePeople?: (table: TableBuilder) => void;
  /**
   * Where the person/login relationship is stored.
   *
   * - `person_field` (default): `workforce_people.sys_user_id`
   * - `sys_user_field`: `sys_users.workforce_person_id`, intended for
   *   systems that expose workforce people through AuthBlock userTypes.
   */
  sysUserLink?: "person_field" | "sys_user_field";
  defineOrganizations?: (table: TableBuilder) => void;
  defineOrgUnits?: (table: TableBuilder) => void;
  defineLocations?: (table: TableBuilder) => void;
  defineWorkerRelationships?: (table: TableBuilder) => void;
  defineJobProfiles?: (table: TableBuilder) => void;
  definePositions?: (table: TableBuilder) => void;
  defineAssignments?: (table: TableBuilder) => void;
  defineReportingRelationships?: (table: TableBuilder) => void;
  defineAuthRoleMappings?: (table: TableBuilder) => void;
  defineAuthRoleMappingRoles?: (table: TableBuilder) => void;
  defineAuthRoleMappingPermissions?: (table: TableBuilder) => void;
  routes?: WorkforceRouteConfig;
}

export interface WorkforceRouteConfig {
  peopleListPath?: string;
  personDetailPath?: string;
  referenceDataPath?: string;
  authRoleRulesPath?: string;
  peopleDatagridName?: string;
}

interface WorkforceResolvedRouteConfig
  extends Required<Omit<WorkforceRouteConfig, "peopleDatagridName">> {
  peopleDatagridName?: string;
}

export interface WorkforceDetailTabConfig {
  value?: string;
  header: {
    icon?: IconName;
    label: Node;
  };
  content: Node;
}

export interface WorkforcePersonDetailPageProps {
  path?: string;
  wrapper?: (children: Node) => Node;
  prependTabs?: WorkforceDetailTabConfig[];
  appendTabs?: WorkforceDetailTabConfig[];
  leftSideHeader?: Node;
  rightSideHeader?: Node;
  details?: Node;
  excludeFields?: string[];
}

export interface WorkforcePeoplePageProps {
  path?: string;
  wrapper?: (children: Node) => Node;
  datagridName?: string;
  detailPath?: string;
  createAction?: Node;
  createActionProps?: Omit<WorkforcePersonCreateActionProps, "workforce">;
  importAction?: Node | false;
  importActionProps?: Omit<
    WorkforcePeopleImportActionProps,
    "workforce" | "afterImport"
  >;
}

export interface WorkforceAuthRoleRulesPageProps {
  path?: string;
  wrapper?: (children: Node) => Node;
}

export interface WorkforceReferenceDataPageProps {
  path?: string;
  wrapper?: (children: Node) => Node;
}

type WorkforceStandardRouteOverride = Node | false;

export interface WorkforceStandardRoutesProps {
  peopleListPath?: string;
  personDetailPath?: string;
  referenceDataPath?: string;
  authRoleRulesPath?: string;
  peopleDatagridName?: string;
  peopleCreateActionProps?: Omit<WorkforcePersonCreateActionProps, "workforce">;
  peopleImportActionProps?: Omit<
    WorkforcePeopleImportActionProps,
    "workforce" | "afterImport"
  >;
  /** Wraps each route's content while keeping Route nodes statically registered. */
  wrapper?: (children: Node) => Node;
  personDetail?: Omit<WorkforcePersonDetailPageProps, "path">;
  overrides?: {
    peopleList?: WorkforceStandardRouteOverride;
    personDetail?: WorkforceStandardRouteOverride;
    referenceData?: WorkforceStandardRouteOverride;
    authRoleRules?: WorkforceStandardRouteOverride;
  };
}

export interface WorkforcePersonCreateActionProps {
  workforce: WorkforceBlock;
  defaultLanguage?: Sql | string;
  languageOptions?: Array<{ code: string; name: string }>;
  /** Allows this action to create password credentials for the new person. */
  allowPortalLogin?: boolean;
  defaultCreateLogin?: boolean;
  defaultWorkerType?: string;
  /**
   * Extra insert columns/values for systems that add fields through
   * `definePeople`. Values can reference UI scalars declared by the caller.
   */
  extraPersonColumns?: Sql;
  extraPersonValues?: Sql;
  /** Extra insert columns/values for `defineWorkerRelationships` fields. */
  extraWorkerRelationshipColumns?: Sql;
  extraWorkerRelationshipValues?: Sql;
  /** Extra insert columns/values for `defineAssignments` fields. */
  extraAssignmentColumns?: Sql;
  extraAssignmentValues?: Sql;
}

function WorkforceInputField(props: {
  label: string;
  bindScalar: string;
  placeholder?: Sql | string;
  type?: string;
  className?: string;
}) {
  return (
    <FormControl className={props.className}>
      <FormLabel>{props.label}</FormLabel>
      <Input
        type={props.type}
        bindScalar={props.bindScalar}
        placeholder={props.placeholder}
      />
    </FormControl>
  );
}

function WorkforceSelectField(props: {
  label: string;
  scalar: string;
  children: Node;
}) {
  return (
    <FormControl>
      <FormLabel>{props.label}</FormLabel>
      <Select
        fullWidth
        value={sql.ref(props.scalar)}
        onInput={(s) => s.setScalar(props.scalar, sql`target_value`)}
      >
        {props.children}
      </Select>
    </FormControl>
  );
}

const workforceAuthRuleSource = sql.lit`workforce_auth_role_mapping`;

interface ModifyStatements {
  modify(sql: Sql): unknown;
  callStoredProcedure(name: string, opts?: CallStoredProcedureOpts): unknown;
}

interface PermissionAssertionStatements {
  throwErrorIf(condition: BooleanExpr, message: Sql): unknown;
}

function workforceAuthMappingMatchSql(args: {
  workforce: WorkforceProvider;
  personRecord: Sql;
  mappingRecord: Sql;
}) {
  const { workforce, personRecord, mappingRecord } = args;
  let match = sql`
    (${mappingRecord}.worker_type is null
      or lower(${mappingRecord}.worker_type) = lower(${
    workforce.personWorkerType!(personRecord)
  }))
    and (${mappingRecord}.employer_workforce_organization_id is null
      or ${mappingRecord}.employer_workforce_organization_id = ${
    workforce.personEmployerOrganizationId!(personRecord)
  })
    and (${mappingRecord}.host_workforce_organization_id is null
      or ${mappingRecord}.host_workforce_organization_id = ${
    workforce.personHostOrganizationId!(personRecord)
  })
    and (${mappingRecord}.workforce_job_profile_id is null
      or ${mappingRecord}.workforce_job_profile_id = ${
    workforce.personPrimaryJobProfileId!(personRecord)
  })`;
  if (workforce.orgUnitsTable) {
    match = sql`${match}
      and (${mappingRecord}.workforce_org_unit_id is null
        or ${mappingRecord}.workforce_org_unit_id = ${
      workforce.personPrimaryOrgUnitId!(personRecord)
    })`;
  }
  if (workforce.locationsTable) {
    match = sql`${match}
      and (${mappingRecord}.workforce_location_id is null
        or ${mappingRecord}.workforce_location_id = ${
      workforce.personPrimaryLocationId!(personRecord)
    })`;
  }
  return sql`(${match})`;
}

function workforceAuthMappedRoles(workforce: WorkforceProvider) {
  return sql`
    select ${workforce.personSysUserId(sql`person`)} as sys_user_id,
           mapped_role.auth_role_id,
           mapping.id as source_record_id
    from db.${sql.ref(workforce.personTable)} person
    join db.${sql.ref(workforce.authRoleMappingsTable!)} mapping
      on ${
    workforceAuthMappingMatchSql({
      workforce,
      personRecord: sql`person`,
      mappingRecord: sql`mapping`,
    })
  }
    join (
      select workforce_auth_role_mapping_id, auth_role_id
      from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
      union
      select legacy_mapping.id as workforce_auth_role_mapping_id,
             legacy_mapping.auth_role_id
      from db.${sql.ref(workforce.authRoleMappingsTable!)} legacy_mapping
      where legacy_mapping.auth_role_id is not null
        and not exists (
          select 1
          from db.${sql.ref(workforce.authRoleMappingRolesTable!)} role_mapping
          where role_mapping.workforce_auth_role_mapping_id =
            legacy_mapping.id
        )
    ) mapped_role
      on mapped_role.workforce_auth_role_mapping_id = mapping.id
    where mapping.is_active
      and (mapping.effective_from is null
        or mapping.effective_from <= current_date())
      and (mapping.effective_to is null
        or current_date() < mapping.effective_to)
      and ${workforce.personAccessEligible(sql`person`)}
      and ${workforce.personSysUserId(sql`person`)} is not null
  `;
}

function workforceAuthMappedPermissions(workforce: WorkforceProvider) {
  return sql`
    select ${workforce.personSysUserId(sql`person`)} as sys_user_id,
           extra.permission,
           true as is_allowed,
           mapping.id as source_record_id
    from db.${sql.ref(workforce.personTable)} person
    join db.${sql.ref(workforce.authRoleMappingsTable!)} mapping
      on ${
    workforceAuthMappingMatchSql({
      workforce,
      personRecord: sql`person`,
      mappingRecord: sql`mapping`,
    })
  }
    join db.${sql.ref(workforce.authRoleMappingPermissionsTable!)} extra
      on extra.workforce_auth_role_mapping_id = mapping.id
    where mapping.is_active
      and (mapping.effective_from is null
        or mapping.effective_from <= current_date())
      and (mapping.effective_to is null
        or current_date() < mapping.effective_to)
      and ${workforce.personAccessEligible(sql`person`)}
      and ${workforce.personSysUserId(sql`person`)} is not null
  `;
}

const WORKFORCE_AUTH_RECONCILIATION_PROCEDURE =
  "workforce_reconcile_auth_rules";

export function reconcileWorkforceAuthRules(
  s: ModifyStatements,
  workforce: WorkforceProvider,
) {
  if (!workforce.authRoleMappingsTable) {
    return;
  }
  if (workforce instanceof WorkforceBlock) {
    s.callStoredProcedure(WORKFORCE_AUTH_RECONCILIATION_PROCEDURE);
    return;
  }
  reconcileWorkforceAuthRulesStatements(s, workforce);
}

function reconcileWorkforceAuthRulesStatements(
  s: ModifyStatements,
  workforce: WorkforceProvider,
) {
  if (!workforce.authRoleMappingsTable) {
    return;
  }
  const desiredRoles = workforceAuthMappedRoles(workforce);
  const desiredPermissions = workforceAuthMappedPermissions(workforce);
  s.modify(sql`
    insert into db.auth_user_role_sources
      (sys_user_id, auth_role_id, source, source_record_id)
    select desired.sys_user_id,
           desired.auth_role_id,
           ${workforceAuthRuleSource},
           desired.source_record_id
    from (${desiredRoles}) desired
    where not exists (
      select 1
      from db.auth_user_role_sources existing
      where existing.sys_user_id = desired.sys_user_id
        and existing.auth_role_id = desired.auth_role_id
        and existing.source = ${workforceAuthRuleSource}
        and existing.source_record_id = desired.source_record_id
    )
  `);
  s.modify(sql`
    insert into db.auth_user_permission_sources
      (sys_user_id, permission, is_allowed, source, source_record_id)
    select desired.sys_user_id,
           desired.permission,
           desired.is_allowed,
           ${workforceAuthRuleSource},
           desired.source_record_id
    from (${desiredPermissions}) desired
    where not exists (
      select 1
      from db.auth_user_permission_sources existing
      where existing.sys_user_id = desired.sys_user_id
        and existing.permission = desired.permission
        and existing.source = ${workforceAuthRuleSource}
        and existing.source_record_id = desired.source_record_id
    )
  `);
  s.modify(sql`
    delete from db.auth_user_role_sources source
    where source.source = ${workforceAuthRuleSource}
      and not exists (
        select 1
        from (${desiredRoles}) desired
        where desired.sys_user_id = source.sys_user_id
          and desired.auth_role_id = source.auth_role_id
          and desired.source_record_id = source.source_record_id
      )
  `);
  s.modify(sql`
    delete from db.auth_user_permission_sources source
    where source.source = ${workforceAuthRuleSource}
      and not exists (
        select 1
        from (${desiredPermissions}) desired
        where desired.sys_user_id = source.sys_user_id
          and desired.permission = source.permission
          and desired.source_record_id = source.source_record_id
      )
  `);
}

function reconcileWorkforceReferenceDataAuthRules(
  s: UiServerStatements,
  workforce: WorkforceBlock,
) {
  if (!workforce.authRoleMappingsTable) {
    return;
  }
  s.callStoredProcedure(WORKFORCE_AUTH_RECONCILIATION_PROCEDURE);
}

export function syncWorkforcePersonLoginState(
  s: ModifyStatements,
  workforce: WorkforceProvider,
  personId: Sql,
) {
  if (!workforce.disableLoginWhenAccessIneligible) {
    return;
  }
  if (workforce instanceof WorkforceBlock) {
    s.callStoredProcedure("workforce_sync_person_login_state", {
      inputScalars: { p_person_id: personId },
    });
    return;
  }
  syncWorkforcePersonLoginStateStatements(s, workforce, personId);
}

function syncWorkforcePersonLoginStateStatements(
  s: ModifyStatements,
  workforce: WorkforceProvider,
  personId: Sql,
) {
  if (!workforce.disableLoginWhenAccessIneligible) {
    return;
  }
  const sysUserId = () =>
    sql`(
    select ${workforce.personSysUserId(sql`person`)}
    from db.${sql.ref(workforce.personTable)} person
    where person.id = ${personId}
  )`;
  const accessEligible = () =>
    sql`coalesce((
    select ${workforce.personAccessEligible(sql`person`)}
    from db.${sql.ref(workforce.personTable)} person
    where person.id = ${personId}
  ), false)`;
  s.modify(sql`
    update db.sys_users
    set disabled = true,
        last_modified_at = current_timestamp()
    where id = ${sysUserId()}
      and not disabled
      and not ${accessEligible()}
  `);
  s.modify(sql`
    delete from db.auth_session_tokens
    where sys_user_id = ${sysUserId()}
      and not ${accessEligible()}
  `);
}

export function syncWorkforcePersonAccess(
  s: ModifyStatements,
  workforce: WorkforceProvider,
  personId: Sql,
) {
  syncWorkforcePersonLoginState(s, workforce, personId);
  reconcileWorkforceAuthRules(s, workforce);
}

export function syncWorkforceLoginStates(
  s: ModifyStatements,
  workforce: WorkforceProvider,
) {
  if (!workforce.disableLoginWhenAccessIneligible) {
    return;
  }
  if (workforce instanceof WorkforceBlock) {
    s.callStoredProcedure("workforce_sync_login_states");
    return;
  }
  syncWorkforceLoginStatesStatements(s, workforce);
}

function syncWorkforceLoginStatesStatements(
  s: ModifyStatements,
  workforce: WorkforceProvider,
) {
  if (!workforce.disableLoginWhenAccessIneligible) {
    return;
  }
  s.modify(sql`
    update db.sys_users app_user
    set disabled = true,
        last_modified_at = current_timestamp()
    from db.${sql.ref(workforce.personTable)} person
    where ${workforce.personSysUserJoin(sql`person`, sql`app_user`)}
      and not app_user.disabled
      and not ${workforce.personAccessEligible(sql`person`)}
  `);
  s.modify(sql`
    delete from db.auth_session_tokens token
    where exists (
      select 1
      from db.sys_users app_user
      join db.${sql.ref(workforce.personTable)} person
        on ${workforce.personSysUserJoin(sql`person`, sql`app_user`)}
      where app_user.id = token.sys_user_id
        and not ${workforce.personAccessEligible(sql`person`)}
    )
  `);
}

function workforceAuthRuleReconciliationNeeded(workforce: WorkforceProvider) {
  const desiredRoles = workforceAuthMappedRoles(workforce);
  const desiredPermissions = workforceAuthMappedPermissions(workforce);
  const loginReconciliation = workforce.disableLoginWhenAccessIneligible
    ? sql`
      or exists (
        select 1
        from db.sys_users app_user
        join db.${sql.ref(workforce.personTable)} person
          on ${workforce.personSysUserJoin(sql`person`, sql`app_user`)}
        where not app_user.disabled
          and not ${workforce.personAccessEligible(sql`person`)}
      )
      or exists (
        select 1
        from db.auth_session_tokens token
        join db.sys_users app_user on app_user.id = token.sys_user_id
        join db.${sql.ref(workforce.personTable)} person
          on ${workforce.personSysUserJoin(sql`person`, sql`app_user`)}
        where not ${workforce.personAccessEligible(sql`person`)}
      )`
    : sql``;
  return sql`
    exists (
      select 1
      from (${desiredRoles}) desired
      where not exists (
        select 1
        from db.auth_user_role_sources existing
        where existing.sys_user_id = desired.sys_user_id
          and existing.auth_role_id = desired.auth_role_id
          and existing.source = ${workforceAuthRuleSource}
          and existing.source_record_id = desired.source_record_id
      )
    )
    or exists (
      select 1
      from (${desiredPermissions}) desired
      where not exists (
        select 1
        from db.auth_user_permission_sources existing
        where existing.sys_user_id = desired.sys_user_id
          and existing.permission = desired.permission
          and existing.source = ${workforceAuthRuleSource}
          and existing.source_record_id = desired.source_record_id
      )
    )
    or exists (
      select 1
      from db.auth_user_role_sources source
      where source.source = ${workforceAuthRuleSource}
        and not exists (
          select 1
          from (${desiredRoles}) desired
          where desired.sys_user_id = source.sys_user_id
            and desired.auth_role_id = source.auth_role_id
            and desired.source_record_id = source.source_record_id
        )
    )
    or exists (
      select 1
      from db.auth_user_permission_sources source
      where source.source = ${workforceAuthRuleSource}
        and not exists (
          select 1
          from (${desiredPermissions}) desired
          where desired.sys_user_id = source.sys_user_id
            and desired.permission = source.permission
            and desired.source_record_id = source.source_record_id
        )
    )
    ${loginReconciliation}
  `;
}

export function WorkforcePersonCreateAction(
  props: WorkforcePersonCreateActionProps,
) {
  const workforce = props.workforce;
  const defaultLanguage = typeof props.defaultLanguage === "string"
    ? sql.lit(props.defaultLanguage)
    : props.defaultLanguage ?? sql.lit`en`;
  const languageOptions = props.languageOptions ?? [
    { code: "en", name: "English" },
  ];
  const allowPortalLogin = props.allowPortalLogin ?? false;

  function matchingAuthRoleMappingWhere(): Sql {
    return sql`
      ui.workforce_add_person_status = cast(${
      sql.lit(workforce.activePersonStatus)
    } as enums.workforce_person_status)
      and ui.workforce_add_person_relationship_status = cast(${
      sql.lit(workforce.activeRelationshipStatus)
    } as enums.workforce_relationship_status)
      and ui.workforce_add_person_assignment_status = cast(${
      sql.lit(workforce.activeAssignmentStatus)
    } as enums.workforce_assignment_status)
      and mapping.is_active
      and (mapping.effective_from is null
        or mapping.effective_from <= current_date())
      and (mapping.effective_to is null
        or current_date() < mapping.effective_to)
      and (mapping.worker_type is null
        or lower(mapping.worker_type) =
          lower(ui.workforce_add_person_worker_type))
      and (mapping.employer_workforce_organization_id is null
        or mapping.employer_workforce_organization_id =
          ui.workforce_add_person_organization_id::bigint)
      and (mapping.host_workforce_organization_id is null
        or mapping.host_workforce_organization_id =
          coalesce(
            nullif(ui.workforce_add_person_host_organization_id, '')::bigint,
            ui.workforce_add_person_organization_id::bigint
          ))
      and (mapping.workforce_job_profile_id is null
        or mapping.workforce_job_profile_id =
          nullif(ui.workforce_add_person_job_profile_id, '')::bigint)
      ${
      workforce.orgUnitsTable
        ? sql`and (mapping.workforce_org_unit_id is null
          or mapping.workforce_org_unit_id =
            nullif(ui.workforce_add_person_org_unit_id, '')::bigint)`
        : sql``
    }
      ${
      workforce.locationsTable
        ? sql`and (mapping.workforce_location_id is null
          or mapping.workforce_location_id =
            nullif(ui.workforce_add_person_location_id, '')::bigint)`
        : sql``
    }
    `;
  }

  // Creates the person, worker relationship, and primary assignment for
  // workforce_new_sys_user_id inside the caller's transaction.
  function insertPersonGraph(s: UiServerStatements) {
    let personColumns = sql`display_name, email, phone, preferred_language,
       status, created_at`;
    let personValues = sql`trim(ui.workforce_add_person_display_name),
       nullif(trim(ui.workforce_add_person_email), ''),
       nullif(trim(ui.workforce_add_person_phone), ''),
       ui.workforce_add_person_language,
       ui.workforce_add_person_status,
       current_timestamp()`;
    if (workforce.sysUserLink === "person_field") {
      personColumns = sql`${personColumns}, sys_user_id`;
      personValues = sql`${personValues}, workforce_new_sys_user_id`;
    }
    if (props.extraPersonColumns && props.extraPersonValues) {
      personColumns = sql`${personColumns}, ${props.extraPersonColumns}`;
      personValues = sql`${personValues}, ${props.extraPersonValues}`;
    }
    s.modify(sql`
      insert into db.${sql.ref(workforce.peopleTable)}
        (${personColumns})
      values
        (${personValues})
      returning id into workforce_new_person_id
    `);
    if (workforce.sysUserLink === "sys_user_field") {
      s.modify(sql`
        update db.sys_users
        set workforce_person_id = workforce_new_person_id
        where id = workforce_new_sys_user_id
      `);
    }
    let relationshipColumns = sql`person_id, workforce_organization_id,
       worker_type, status, effective_from`;
    let relationshipValues = sql`workforce_new_person_id,
       ui.workforce_add_person_organization_id::bigint,
       ui.workforce_add_person_worker_type,
       ui.workforce_add_person_relationship_status,
       current_date()`;
    if (
      props.extraWorkerRelationshipColumns &&
      props.extraWorkerRelationshipValues
    ) {
      relationshipColumns =
        sql`${relationshipColumns}, ${props.extraWorkerRelationshipColumns}`;
      relationshipValues =
        sql`${relationshipValues}, ${props.extraWorkerRelationshipValues}`;
    }
    s.modify(sql`
      insert into db.${sql.ref(workforce.workerRelationshipsTable)}
        (${relationshipColumns})
      values
        (${relationshipValues})
      returning id into workforce_new_relationship_id
    `);
    let columns = sql`worker_relationship_id, host_workforce_organization_id,
       workforce_job_profile_id, is_primary, status, effective_from`;
    let values = sql`workforce_new_relationship_id,
       nullif(ui.workforce_add_person_host_organization_id, '')::bigint,
       nullif(ui.workforce_add_person_job_profile_id, '')::bigint,
       true,
       ui.workforce_add_person_assignment_status,
       current_date()`;
    if (workforce.orgUnitsTable) {
      columns = sql`${columns}, workforce_org_unit_id`;
      values =
        sql`${values}, nullif(ui.workforce_add_person_org_unit_id, '')::bigint`;
    }
    if (workforce.locationsTable) {
      columns = sql`${columns}, workforce_location_id`;
      values =
        sql`${values}, nullif(ui.workforce_add_person_location_id, '')::bigint`;
    }
    if (workforce.positionsTable) {
      columns = sql`${columns}, workforce_position_id`;
      values =
        sql`${values}, nullif(ui.workforce_add_person_position_id, '')::bigint`;
    }
    if (props.extraAssignmentColumns && props.extraAssignmentValues) {
      columns = sql`${columns}, ${props.extraAssignmentColumns}`;
      values = sql`${values}, ${props.extraAssignmentValues}`;
    }
    s.modify(sql`
      insert into db.${sql.ref(workforce.assignmentsTable)} (${columns})
      values (${values})
    `);
    applyMappedAuthRoles(s);
    applyMappedAuthPermissions(s);
    syncWorkforcePersonAccess(
      s,
      workforce,
      sql`workforce_new_person_id`,
    );
  }

  function applyMappedAuthRoles(s: UiServerStatements) {
    if (!workforce.authRoleMappingsTable) {
      return;
    }
    s.modify(sql`
      insert into db.auth_user_role_sources
        (sys_user_id, auth_role_id, source, source_record_id)
      select workforce_new_sys_user_id,
             mapped_role.auth_role_id,
             ${workforceAuthRuleSource},
             mapping.id
      from db.${sql.ref(workforce.authRoleMappingsTable)} mapping
      join (
        select workforce_auth_role_mapping_id, auth_role_id
        from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
        union
        select legacy_mapping.id as workforce_auth_role_mapping_id,
               legacy_mapping.auth_role_id
        from db.${sql.ref(workforce.authRoleMappingsTable)} legacy_mapping
        where legacy_mapping.auth_role_id is not null
          and not exists (
            select 1
            from db.${
      sql.ref(workforce.authRoleMappingRolesTable!)
    } role_mapping
            where role_mapping.workforce_auth_role_mapping_id =
              legacy_mapping.id
          )
      ) mapped_role
        on mapped_role.workforce_auth_role_mapping_id = mapping.id
      where ${matchingAuthRoleMappingWhere()}
        and not exists (
          select 1
          from db.auth_user_role_sources existing
          where existing.sys_user_id = workforce_new_sys_user_id
            and existing.auth_role_id = mapped_role.auth_role_id
            and existing.source = ${workforceAuthRuleSource}
            and existing.source_record_id = mapping.id
        )
    `);
  }

  function applyMappedAuthPermissions(s: UiServerStatements) {
    if (!workforce.authRoleMappingsTable) {
      return;
    }
    s.modify(sql`
      insert into db.auth_user_permission_sources
        (sys_user_id, permission, is_allowed, source, source_record_id)
      select workforce_new_sys_user_id,
             extra.permission,
             true,
             ${workforceAuthRuleSource},
             mapping.id
      from db.${sql.ref(workforce.authRoleMappingsTable)} mapping
      join db.${sql.ref(workforce.authRoleMappingPermissionsTable!)} extra
        on extra.workforce_auth_role_mapping_id = mapping.id
      where ${matchingAuthRoleMappingWhere()}
        and not exists (
          select 1
          from db.auth_user_permission_sources existing
          where existing.sys_user_id = workforce_new_sys_user_id
            and existing.permission = extra.permission
            and existing.source = ${workforceAuthRuleSource}
            and existing.source_record_id = mapping.id
        )
    `);
  }

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("workforce_add_person_open", sql`false`);
        s.defScalar("workforce_add_person_display_name", sql.lit``);
        s.defScalar("workforce_add_person_email", sql.lit``);
        s.defScalar("workforce_add_person_phone", sql.lit``);
        s.defScalar(
          "workforce_add_person_worker_type",
          sql.lit(props.defaultWorkerType ?? workforce.workerTypes[0].name),
        );
        s.defScalar(
          "workforce_add_person_status",
          sql.lit(workforce.activePersonStatus),
        );
        s.defScalar(
          "workforce_add_person_relationship_status",
          sql.lit(workforce.activeRelationshipStatus),
        );
        s.defScalar(
          "workforce_add_person_assignment_status",
          sql.lit(workforce.activeAssignmentStatus),
        );
        s.defScalar("workforce_add_person_language", defaultLanguage);
        s.defScalar("workforce_add_person_organization_id", sql.lit``);
        s.defScalar("workforce_add_person_host_organization_id", sql.lit``);
        s.defScalar("workforce_add_person_job_profile_id", sql.lit``);
        if (workforce.orgUnitsTable) {
          s.defScalar("workforce_add_person_org_unit_id", sql.lit``);
        }
        if (workforce.locationsTable) {
          s.defScalar("workforce_add_person_location_id", sql.lit``);
        }
        if (workforce.positionsTable) {
          s.defScalar("workforce_add_person_position_id", sql.lit``);
        }
        if (allowPortalLogin) {
          s.defScalar(
            "workforce_add_person_create_login",
            props.defaultCreateLogin ?? true,
          );
          s.defScalar("workforce_add_person_temp_password", sql.lit``);
        }
        s.defScalar("workforce_add_person_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("workforce_add_person_message", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defTable(
          "workforce_add_person_organizations",
          sql`select id, name
              from db.${sql.ref(workforce.organizationsTable)}
              where is_active
              order by name`,
        );
        s.defTable(
          "workforce_add_person_job_profiles",
          sql`select id, name, code
              from db.${sql.ref(workforce.jobProfilesTable)}
              where is_active
              order by name`,
        );
        if (workforce.orgUnitsTable) {
          s.defTable(
            "workforce_add_person_org_units",
            sql`select id, name, code
                from db.${sql.ref(workforce.orgUnitsTable)}
                where is_active
                order by name`,
          );
        }
        if (workforce.locationsTable) {
          s.defTable(
            "workforce_add_person_locations",
            sql`select id, name, code
                from db.${sql.ref(workforce.locationsTable)}
                where is_active
                order by name`,
          );
        }
        if (workforce.positionsTable) {
          s.defTable(
            "workforce_add_person_positions",
            sql`select id, name, code
                from db.${sql.ref(workforce.positionsTable)}
                where is_active
                order by name`,
          );
        }
      }}
    >
      <Button
        startIcon="PersonAdd"
        onClick={(s) => {
          s.setScalar("workforce_add_person_error", sql`null`);
          s.setScalar("workforce_add_person_message", sql`null`);
          s.setScalar("workforce_add_person_open", sql`true`);
        }}
      >
        Add person
      </Button>
      <Show when={sql`workforce_add_person_message is not null`}>
        <Alert color="success" startIcon="CheckCircle" className="mb-4">
          {sql`workforce_add_person_message`}
        </Alert>
      </Show>
      <ModalDialog bindScalar="workforce_add_person_open" maxWidth="lg">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <Typography level="title-lg" startIcon="PersonAdd">
              Add Person
            </Typography>
            <Typography level="body-sm" className="text-neutral-600 mt-1">
              Create a person, their worker relationship, and primary
              assignment.
            </Typography>
          </div>
          <IconButton
            icon="Close"
            aria-label="Close"
            variant="plain"
            color="neutral"
            onClick={(s) =>
              s.setScalar("workforce_add_person_open", sql`false`)}
          />
        </div>
        <Show when={sql`workforce_add_person_error is not null`}>
          <Alert color="danger" startIcon="Error" className="mb-4">
            {sql`workforce_add_person_error`}
          </Alert>
        </Show>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <WorkforceInputField
            label="Name"
            bindScalar="workforce_add_person_display_name"
            placeholder="Full name"
            className="md:col-span-2"
          />
          <WorkforceInputField
            label="Email"
            bindScalar="workforce_add_person_email"
            placeholder={allowPortalLogin
              ? sql`case
                when workforce_add_person_create_login
                  then 'required for portal login'
                else 'optional'
              end`
              : "optional"}
          />
          <WorkforceInputField
            label="Phone"
            bindScalar="workforce_add_person_phone"
            placeholder="optional"
          />
          <WorkforceSelectField
            label="Company"
            scalar="workforce_add_person_organization_id"
          >
            <Select.Option value="">Select company</Select.Option>
            <Each
              table="workforce_add_person_organizations"
              recordName="org"
            >
              <Select.Option value={sql`org.id`}>
                {sql`org.name`}
              </Select.Option>
            </Each>
          </WorkforceSelectField>
          <WorkforceSelectField
            label="Host company"
            scalar="workforce_add_person_host_organization_id"
          >
            <Select.Option value="">Same as company</Select.Option>
            <Each
              table="workforce_add_person_organizations"
              recordName="org"
            >
              <Select.Option value={sql`org.id`}>
                {sql`org.name`}
              </Select.Option>
            </Each>
          </WorkforceSelectField>
          <WorkforceSelectField
            label="Worker type"
            scalar="workforce_add_person_worker_type"
          >
            {workforce.workerTypes.map((workerType) => (
              <Select.Option value={workerType.name}>
                {workerType.displayName}
              </Select.Option>
            ))}
          </WorkforceSelectField>
          <WorkforceSelectField
            label="Relationship status"
            scalar="workforce_add_person_relationship_status"
          >
            {workforce.relationshipStatuses.map((status) => (
              <Select.Option value={status.name}>
                {status.displayName}
              </Select.Option>
            ))}
          </WorkforceSelectField>
          <WorkforceSelectField
            label="Job profile"
            scalar="workforce_add_person_job_profile_id"
          >
            <Select.Option value="">
              {workforce.positionsTable
                ? "No job profile"
                : "Select job profile"}
            </Select.Option>
            <Each
              table="workforce_add_person_job_profiles"
              recordName="job"
            >
              <Select.Option value={sql`job.id`}>
                {sql`job.name || ' · ' || job.code`}
              </Select.Option>
            </Each>
          </WorkforceSelectField>
          <WorkforceSelectField
            label="Assignment status"
            scalar="workforce_add_person_assignment_status"
          >
            {workforce.assignmentStatuses.map((status) => (
              <Select.Option value={status.name}>
                {status.displayName}
              </Select.Option>
            ))}
          </WorkforceSelectField>
          {workforce.orgUnitsTable && (
            <WorkforceSelectField
              label="Org unit"
              scalar="workforce_add_person_org_unit_id"
            >
              <Select.Option value="">No org unit</Select.Option>
              <Each
                table="workforce_add_person_org_units"
                recordName="unit"
              >
                <Select.Option value={sql`unit.id`}>
                  {sql`unit.name || coalesce(' · ' || unit.code, '')`}
                </Select.Option>
              </Each>
            </WorkforceSelectField>
          )}
          {workforce.locationsTable && (
            <WorkforceSelectField
              label="Location"
              scalar="workforce_add_person_location_id"
            >
              <Select.Option value="">No location</Select.Option>
              <Each
                table="workforce_add_person_locations"
                recordName="location"
              >
                <Select.Option value={sql`location.id`}>
                  {sql`location.name || coalesce(' · ' || location.code, '')`}
                </Select.Option>
              </Each>
            </WorkforceSelectField>
          )}
          {workforce.positionsTable && (
            <WorkforceSelectField
              label="Position"
              scalar="workforce_add_person_position_id"
            >
              <Select.Option value="">No position</Select.Option>
              <Each
                table="workforce_add_person_positions"
                recordName="position"
              >
                <Select.Option value={sql`position.id`}>
                  {sql`position.name || coalesce(' · ' || position.code, '')`}
                </Select.Option>
              </Each>
            </WorkforceSelectField>
          )}
          <WorkforceSelectField
            label="Person status"
            scalar="workforce_add_person_status"
          >
            {workforce.personStatuses.map((status) => (
              <Select.Option value={status.name}>
                {status.displayName}
              </Select.Option>
            ))}
          </WorkforceSelectField>
          <WorkforceSelectField
            label="Preferred language"
            scalar="workforce_add_person_language"
          >
            {languageOptions.map((language) => (
              <Select.Option value={language.code}>
                {language.name}
              </Select.Option>
            ))}
          </WorkforceSelectField>
          {allowPortalLogin && (
            <>
              <label className="flex items-start gap-3 rounded-md border border-divider bg-neutral-50 p-3 md:col-span-2">
                <span className="pt-0.5 shrink-0">
                  <Checkbox bindScalar="workforce_add_person_create_login" />
                </span>
                <span className="text-sm text-neutral-700">
                  Create portal login for this person
                </span>
              </label>
              <Show when={sql`workforce_add_person_create_login`}>
                <WorkforceInputField
                  label="Temporary password"
                  type="password"
                  bindScalar="workforce_add_person_temp_password"
                  placeholder="Requires change on first login"
                />
              </Show>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) =>
              s.setScalar("workforce_add_person_open", sql`false`)}
          >
            Cancel
          </Button>
          <Button
            startIcon="Save"
            onClick={(s) => {
              s.setScalar("workforce_add_person_error", sql`null`);
              s.setScalar("workforce_add_person_message", sql`null`);
              s.tryServer({
                body: (s) => {
                  s.if(
                    sql`trim(ui.workforce_add_person_display_name) = ''`,
                    (s) => {
                      s.setScalar(
                        "ui.workforce_add_person_error",
                        sql.lit`Name is required.`,
                      );
                      s.return();
                    },
                  );
                  s.if(
                    sql`nullif(ui.workforce_add_person_organization_id, '') is null`,
                    (s) => {
                      s.setScalar(
                        "ui.workforce_add_person_error",
                        sql
                          .lit`Company is required for the worker relationship.`,
                      );
                      s.return();
                    },
                  );
                  s.if(
                    workforce.positionsTable
                      ? sql`
                        nullif(ui.workforce_add_person_job_profile_id, '') is null
                        and nullif(ui.workforce_add_person_position_id, '') is null
                      `
                      : sql`nullif(ui.workforce_add_person_job_profile_id, '') is null`,
                    (s) => {
                      s.setScalar(
                        "ui.workforce_add_person_error",
                        workforce.positionsTable
                          ? sql
                            .lit`Select a job profile or position for the primary assignment.`
                          : sql
                            .lit`Select a job profile for the primary assignment.`,
                      );
                      s.return();
                    },
                  );
                  if (allowPortalLogin) {
                    s.if(
                      sql`ui.workforce_add_person_create_login
                        and nullif(trim(ui.workforce_add_person_email), '') is null`,
                      (s) => {
                        s.setScalar(
                          "ui.workforce_add_person_error",
                          sql
                            .lit`Email is required when creating a portal login.`,
                        );
                        s.return();
                      },
                    );
                    s.if(
                      sql`ui.workforce_add_person_create_login
                        and length(ui.workforce_add_person_temp_password) < 8`,
                      (s) => {
                        s.setScalar(
                          "ui.workforce_add_person_error",
                          sql
                            .lit`Temporary password must be at least 8 characters.`,
                        );
                        s.return();
                      },
                    );
                  }
                  s.startTransaction();
                  workforce.assertManagementSession(s);
                  s.defScalar("workforce_new_sys_user_id", { type: "BigInt" });
                  const insertIdentity = (s: UiServerStatements) => {
                    s.modify(sql`
                      insert into db.sys_users (created_at)
                      values (current_timestamp())
                      returning id into workforce_created_sys_user_id
                    `);
                    s.setScalar(
                      "workforce_new_sys_user_id",
                      sql`workforce_created_sys_user_id`,
                    );
                  };
                  if (allowPortalLogin) {
                    s.if(sql`ui.workforce_add_person_create_login`, (s) => {
                      insertUserWithPassword(s, {
                        password: sql`ui.workforce_add_person_temp_password`,
                        mustChangePassword: sql`true`,
                        idScalar: "workforce_created_sys_user_id",
                      });
                      s.setScalar(
                        "workforce_new_sys_user_id",
                        sql`workforce_created_sys_user_id`,
                      );
                    }, insertIdentity);
                  } else {
                    insertIdentity(s);
                  }
                  insertPersonGraph(s);
                  s.commitTransaction();
                  s.setScalar(
                    "ui.workforce_add_person_message",
                    sql`'Added ' || trim(ui.workforce_add_person_display_name) || '.'`,
                  );
                  s.setScalar(
                    "ui.workforce_add_person_display_name",
                    sql.lit``,
                  );
                  s.setScalar("ui.workforce_add_person_email", sql.lit``);
                  s.setScalar("ui.workforce_add_person_phone", sql.lit``);
                  s.setScalar(
                    "ui.workforce_add_person_worker_type",
                    sql.lit(
                      props.defaultWorkerType ?? workforce.workerTypes[0].name,
                    ),
                  );
                  s.setScalar(
                    "ui.workforce_add_person_status",
                    sql.lit(workforce.activePersonStatus),
                  );
                  s.setScalar(
                    "ui.workforce_add_person_relationship_status",
                    sql.lit(workforce.activeRelationshipStatus),
                  );
                  s.setScalar(
                    "ui.workforce_add_person_assignment_status",
                    sql.lit(workforce.activeAssignmentStatus),
                  );
                  s.setScalar(
                    "ui.workforce_add_person_language",
                    defaultLanguage,
                  );
                  s.setScalar(
                    "ui.workforce_add_person_organization_id",
                    sql.lit``,
                  );
                  s.setScalar(
                    "ui.workforce_add_person_host_organization_id",
                    sql.lit``,
                  );
                  s.setScalar(
                    "ui.workforce_add_person_job_profile_id",
                    sql.lit``,
                  );
                  if (workforce.orgUnitsTable) {
                    s.setScalar(
                      "ui.workforce_add_person_org_unit_id",
                      sql.lit``,
                    );
                  }
                  if (workforce.locationsTable) {
                    s.setScalar(
                      "ui.workforce_add_person_location_id",
                      sql.lit``,
                    );
                  }
                  if (workforce.positionsTable) {
                    s.setScalar(
                      "ui.workforce_add_person_position_id",
                      sql.lit``,
                    );
                  }
                  if (allowPortalLogin) {
                    s.setScalar(
                      "ui.workforce_add_person_create_login",
                      props.defaultCreateLogin ?? true,
                    );
                    s.setScalar(
                      "ui.workforce_add_person_temp_password",
                      sql.lit``,
                    );
                  }
                  s.setScalar("ui.workforce_add_person_open", sql`false`);
                  s.refetch();
                },
                catch: (s) => {
                  s.setScalar(
                    "workforce_add_person_error",
                    sql.lit`Person could not be created.`,
                  );
                },
              });
            }}
          >
            Create person
          </Button>
        </div>
      </ModalDialog>
    </Data>
  );
}

export function WorkforceAuthRoleRules(props: { workforce: WorkforceBlock }) {
  const workforce = props.workforce;
  const hasOrgUnits = workforce.orgUnitsTable !== undefined;
  const hasLocations = workforce.locationsTable !== undefined;
  const mappingRoleIdsSql = (mappingId: Sql) =>
    sql`
      select auth_role_id
      from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
      where workforce_auth_role_mapping_id = ${mappingId}
      union
      select auth_role_id
      from db.${sql.ref(workforce.authRoleMappingsTable!)}
      where id = ${mappingId}
        and auth_role_id is not null
        and not exists (
          select 1
          from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
          where workforce_auth_role_mapping_id = ${mappingId}
        )
    `;
  if (!workforce.authRoleMappingsTable) {
    return (
      <Alert color="warning" startIcon="Warning">
        Enable auth role mappings on WorkforceBlock to manage workforce access
        rules.
      </Alert>
    );
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("workforce_auth_rule_open", sql`false`);
        s.defScalar("workforce_auth_rule_permissions_visible", sql`false`);
        s.defScalar("workforce_auth_selected_rule_id", sql.lit``);
        s.defScalar("workforce_auth_rule_worker_type", sql.lit``);
        s.defScalar("workforce_auth_rule_employer_org_id", sql.lit``);
        s.defScalar("workforce_auth_rule_host_org_id", sql.lit``);
        s.defScalar("workforce_auth_rule_job_profile_id", sql.lit``);
        if (hasOrgUnits) {
          s.defScalar("workforce_auth_rule_org_unit_id", sql.lit``);
        }
        if (hasLocations) {
          s.defScalar("workforce_auth_rule_location_id", sql.lit``);
        }
        s.defScalar("workforce_auth_rule_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defTable("workforce_auth_rule_selected_roles", {
          fields: [
            { name: "auth_role_id", type: "BigInt" },
            { name: "name", type: "String" },
          ],
        });
        s.defTable("workforce_auth_rule_selected_permissions", {
          fields: [{ name: "permission", type: "String" }],
        });
        s.defTable(
          "workforce_auth_rule_organizations",
          sql`select id, name
              from db.${sql.ref(workforce.organizationsTable)}
              where is_active
              order by name`,
        );
        s.defTable(
          "workforce_auth_rule_job_profiles",
          sql`select id, name, code
              from db.${sql.ref(workforce.jobProfilesTable)}
              where is_active
              order by name`,
        );
        if (hasOrgUnits) {
          s.defTable(
            "workforce_auth_rule_org_units",
            sql`select id, name, code
                from db.${sql.ref(workforce.orgUnitsTable!)}
                where is_active
                order by name`,
          );
        }
        if (hasLocations) {
          s.defTable(
            "workforce_auth_rule_locations",
            sql`select id, name, code
                from db.${sql.ref(workforce.locationsTable!)}
                where is_active
                order by name`,
          );
        }
      }}
    >
      {/* Refresh role grants on opening without resetting the local draft. */}
      <Data
        watch={[sql`workforce_auth_rule_open`]}
        procedure={(s) => {
          s.defTable(
            "workforce_auth_role_permissions",
            sql`select role.id as auth_role_id, role.name as source_role_name,
                     granted.permission
              from db.auth_roles role
              cross join lateral (${getRolePermissions(sql`role.id`)}) granted`,
          );
        }}
      >
        <Card variant="outlined">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
              <div>
                <Typography level="title-lg" startIcon="AdminPanelSettings">
                  Workforce Role Rules
                </Typography>
                <Typography level="body-sm" className="text-neutral-600 mt-1">
                  Grant roles and additional permissions while people match
                  workforce facts.
                </Typography>
              </div>
              <Button
                startIcon="Add"
                onClick={(s) => {
                  s.setScalar("workforce_auth_rule_error", sql`null`);
                  s.setScalar("workforce_auth_selected_rule_id", sql.lit``);
                  s.modify(
                    sql`delete from ui.workforce_auth_rule_selected_roles`,
                  );
                  s.modify(
                    sql`delete from ui.workforce_auth_rule_selected_permissions`,
                  );
                  s.setScalar(
                    "workforce_auth_rule_permissions_visible",
                    sql`false`,
                  );
                  s.setScalar("workforce_auth_rule_worker_type", sql.lit``);
                  s.setScalar("workforce_auth_rule_employer_org_id", sql.lit``);
                  s.setScalar("workforce_auth_rule_host_org_id", sql.lit``);
                  s.setScalar("workforce_auth_rule_job_profile_id", sql.lit``);
                  if (hasOrgUnits) {
                    s.setScalar("workforce_auth_rule_org_unit_id", sql.lit``);
                  }
                  if (hasLocations) {
                    s.setScalar("workforce_auth_rule_location_id", sql.lit``);
                  }
                  s.setScalar("workforce_auth_rule_open", sql`true`);
                }}
              >
                Add rule
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              query={sql`
              select mapping.id,
                     mapping.auth_role_id,
                     mapping.worker_type as rule_worker_type,
                     mapping.employer_workforce_organization_id,
                     mapping.host_workforce_organization_id,
                     mapping.workforce_job_profile_id,
                     ${
                hasOrgUnits ? sql`mapping.workforce_org_unit_id,` : sql``
              }
                     ${
                hasLocations ? sql`mapping.workforce_location_id,` : sql``
              }
                     (
                       case
                         when exists (
                           select 1
                           from db.${
                sql.ref(workforce.authRoleMappingRolesTable!)
              } mapped_role
                           where mapped_role.workforce_auth_role_mapping_id =
                             mapping.id
                         ) then (
                           select string_agg(role.name, ', ' order by role.name)
                           from db.${
                sql.ref(workforce.authRoleMappingRolesTable!)
              } mapped_role
                           join db.auth_roles role
                             on role.id = mapped_role.auth_role_id
                           where mapped_role.workforce_auth_role_mapping_id =
                             mapping.id
                         )
                         else (
                           select role.name
                           from db.auth_roles role
                           where role.id = mapping.auth_role_id
                         )
                       end
                     ) as auth_roles,
                     (
                       (select count(distinct permission)
                        from ui.workforce_auth_role_permissions
                        where auth_role_id in (${
                mappingRoleIdsSql(sql`mapping.id`)
              }))::string
                       || ' role / '
                       || (select count(*)
                           from db.${
                sql.ref(workforce.authRoleMappingPermissionsTable!)
              } extra
                           where extra.workforce_auth_role_mapping_id = mapping.id
                             and not exists (
                               select 1 from ui.workforce_auth_role_permissions granted
                               where granted.auth_role_id in (${
                mappingRoleIdsSql(sql`mapping.id`)
              })
                                 and granted.permission = extra.permission
                             ))::string || ' extra'
                     ) as permissions,
                     (
                       select count(distinct permission)
                       from (
                         select permission from ui.workforce_auth_role_permissions
                         where auth_role_id in (${
                mappingRoleIdsSql(sql`mapping.id`)
              })
                         union
                         select permission
                         from db.${
                sql.ref(workforce.authRoleMappingPermissionsTable!)
              }
                         where workforce_auth_role_mapping_id = mapping.id
                       ) granted
                     ) as permission_count,
                     coalesce(mapping.worker_type, 'Any type') as worker_type,
                     coalesce(job.name, 'Any job') as job_profile,
                     coalesce(employer.name, 'Any employer') as employer,
                     coalesce(host.name, 'Any host') as host,
                     ${
                hasOrgUnits
                  ? sql`coalesce(unit.name, 'Any org unit') as org_unit,`
                  : sql``
              }
                     ${
                hasLocations
                  ? sql`coalesce(location.name, 'Any location') as location,`
                  : sql``
              }
                     case when mapping.is_active then 'Active' else 'Inactive' end as status
              from db.${sql.ref(workforce.authRoleMappingsTable!)} mapping
              left join db.${sql.ref(workforce.jobProfilesTable)} job
                on job.id = mapping.workforce_job_profile_id
              left join db.${sql.ref(workforce.organizationsTable)} employer
                on employer.id = mapping.employer_workforce_organization_id
              left join db.${sql.ref(workforce.organizationsTable)} host
                on host.id = mapping.host_workforce_organization_id
              ${
                hasOrgUnits
                  ? sql`left join db.${sql.ref(workforce.orgUnitsTable!)} unit
                on unit.id = mapping.workforce_org_unit_id`
                  : sql``
              }
              ${
                hasLocations
                  ? sql`left join db.${
                    sql.ref(workforce.locationsTable!)
                  } location
                on location.id = mapping.workforce_location_id`
                  : sql``
              }
              where exists (
                select 1
                from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
                where workforce_auth_role_mapping_id = mapping.id
              ) or mapping.auth_role_id is not null
              order by case when mapping.is_active then 0 else 1 end,
                       auth_roles
            `}
              recordName="rule"
              pageSize={8}
              searchable={[
                "auth_roles",
                "worker_type",
                "job_profile",
                "employer",
                "host",
                ...(hasOrgUnits ? ["org_unit"] : []),
                ...(hasLocations ? ["location"] : []),
                "status",
              ]}
              columns={(b) => {
                b.simpleColumn("auth_roles", "Auth roles", { width: "19%" });
                b.simpleColumn("permissions", "Permissions", { width: "13%" });
                b.simpleColumn("worker_type", "Worker type", { width: "11%" });
                b.simpleColumn("job_profile", "Job", { width: "14%" });
                b.simpleColumn("employer", "Employer", { width: "15%" });
                b.simpleColumn("host", "Host", { width: "13%" });
                if (hasOrgUnits) {
                  b.simpleColumn("org_unit", "Org unit", { width: "11%" });
                }
                if (hasLocations) {
                  b.simpleColumn("location", "Location", { width: "11%" });
                }
                b.simpleColumn("status", "Status", { width: "8%" });
              }}
              actions={(b) => {
                b.custom(
                  "Edit rule",
                  { icon: "Edit" },
                  (s) => {
                    s.setScalar("workforce_auth_rule_error", sql`null`);
                    s.setScalar(
                      "workforce_auth_selected_rule_id",
                      sql`rule.id`,
                    );
                    s.tryServer({
                      body: (s) => {
                        s.modify(
                          sql`delete from ui.workforce_auth_rule_selected_roles`,
                        );
                        s.modify(
                          sql`delete from ui.workforce_auth_rule_selected_permissions`,
                        );
                        s.modify(sql`
                        insert into ui.workforce_auth_rule_selected_roles
                          (auth_role_id, name)
                        select role.id, role.name
                        from (${
                          mappingRoleIdsSql(
                            sql`ui.workforce_auth_selected_rule_id::bigint`,
                          )
                        }) selected_role
                        join db.auth_roles role
                          on role.id = selected_role.auth_role_id
                        order by role.name
                      `);
                        s.modify(sql`
                        insert into ui.workforce_auth_rule_selected_permissions
                          (permission)
                        select extra.permission
                        from db.${
                          sql.ref(workforce.authRoleMappingPermissionsTable!)
                        } extra
                        where extra.workforce_auth_role_mapping_id =
                          ui.workforce_auth_selected_rule_id::bigint
                      `);
                      },
                    });
                    s.setScalar(
                      "workforce_auth_rule_permissions_visible",
                      sql`false`,
                    );
                    s.setScalar(
                      "workforce_auth_rule_worker_type",
                      sql`coalesce(rule.rule_worker_type, '')`,
                    );
                    s.setScalar(
                      "workforce_auth_rule_employer_org_id",
                      sql`coalesce(rule.employer_workforce_organization_id::string, '')`,
                    );
                    s.setScalar(
                      "workforce_auth_rule_host_org_id",
                      sql`coalesce(rule.host_workforce_organization_id::string, '')`,
                    );
                    s.setScalar(
                      "workforce_auth_rule_job_profile_id",
                      sql`coalesce(rule.workforce_job_profile_id::string, '')`,
                    );
                    if (hasOrgUnits) {
                      s.setScalar(
                        "workforce_auth_rule_org_unit_id",
                        sql`coalesce(rule.workforce_org_unit_id::string, '')`,
                      );
                    }
                    if (hasLocations) {
                      s.setScalar(
                        "workforce_auth_rule_location_id",
                        sql`coalesce(rule.workforce_location_id::string, '')`,
                      );
                    }
                    s.setScalar("workforce_auth_rule_open", sql`true`);
                  },
                );
                b.custom(
                  "Toggle active",
                  { icon: "PublishedWithChanges" },
                  (s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        workforce.assertManagementSession(s);
                        s.modify(sql`
                        update db.${sql.ref(workforce.authRoleMappingsTable!)}
                        set is_active = not is_active
                        where id = rule.id
                      `);
                        reconcileWorkforceAuthRules(s, workforce);
                        s.commitTransaction();
                        s.refetch();
                      },
                    });
                  },
                );
              }}
            />
          </CardContent>
        </Card>

        <ModalDialog bindScalar="workforce_auth_rule_open" maxWidth="lg">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Typography level="title-lg" startIcon="Add">
                {sql`case
                when nullif(workforce_auth_selected_rule_id, '') is null
                  then 'Add Role Rule'
                else 'Edit Role Rule'
              end`}
              </Typography>
              <Typography level="body-sm" className="text-neutral-600 mt-1">
                Choose the workforce facts that should grant an auth role.
              </Typography>
            </div>
            <IconButton
              icon="Close"
              aria-label="Close"
              variant="plain"
              color="neutral"
              onClick={(s) =>
                s.setScalar("workforce_auth_rule_open", sql`false`)}
            />
          </div>
          <Show when={sql`workforce_auth_rule_error is not null`}>
            <Alert color="danger" startIcon="Error" className="mb-4">
              {sql`workforce_auth_rule_error`}
            </Alert>
          </Show>
          <div className="mb-4">
            <FormControl>
              <FormLabel>Auth roles to grant</FormLabel>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <Each
                    table="workforce_auth_rule_selected_roles"
                    recordName="selected_role"
                  >
                    <div className="flex items-center gap-2 rounded-md border border-divider bg-neutral-50 px-2 py-1">
                      <Typography level="body-sm">
                        {sql`selected_role.name`}
                      </Typography>
                      <IconButton
                        icon="Close"
                        aria-label="Remove role"
                        variant="plain"
                        color="neutral"
                        size="sm"
                        onClick={(s) => {
                          s.modify(sql`
                          delete from ui.workforce_auth_rule_selected_roles
                          where auth_role_id = selected_role.auth_role_id
                        `);
                        }}
                      />
                    </div>
                  </Each>
                </div>
                <AuthBlock.RoleSelector
                  selected={(role) =>
                    sql`exists (
                    select 1 from ui.workforce_auth_rule_selected_roles
                    where auth_role_id = ${role}
                  )`}
                  onSelect={(s, role, name) => {
                    s.modify(sql`
                      insert into ui.workforce_auth_rule_selected_roles (auth_role_id, name)
                      select ${role}, ${name}
                      where not exists (
                        select 1 from ui.workforce_auth_rule_selected_roles selected_role
                        where selected_role.auth_role_id = ${role}
                      )
                    `);
                  }}
                />
              </div>
            </FormControl>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <WorkforceSelectField
              label="Worker type"
              scalar="workforce_auth_rule_worker_type"
            >
              <Select.Option value="">Any type</Select.Option>
              {workforce.workerTypes.map((workerType) => (
                <Select.Option value={workerType.name}>
                  {workerType.displayName}
                </Select.Option>
              ))}
            </WorkforceSelectField>
            <WorkforceSelectField
              label="Job profile"
              scalar="workforce_auth_rule_job_profile_id"
            >
              <Select.Option value="">Any job</Select.Option>
              <Each table="workforce_auth_rule_job_profiles" recordName="job">
                <Select.Option value={sql`job.id`}>
                  {sql`job.name || ' · ' || job.code`}
                </Select.Option>
              </Each>
            </WorkforceSelectField>
            <WorkforceSelectField
              label="Employer company"
              scalar="workforce_auth_rule_employer_org_id"
            >
              <Select.Option value="">Any employer</Select.Option>
              <Each table="workforce_auth_rule_organizations" recordName="org">
                <Select.Option value={sql`org.id`}>
                  {sql`org.name`}
                </Select.Option>
              </Each>
            </WorkforceSelectField>
            <WorkforceSelectField
              label="Host company"
              scalar="workforce_auth_rule_host_org_id"
            >
              <Select.Option value="">Any host</Select.Option>
              <Each table="workforce_auth_rule_organizations" recordName="org">
                <Select.Option value={sql`org.id`}>
                  {sql`org.name`}
                </Select.Option>
              </Each>
            </WorkforceSelectField>
            {hasOrgUnits && (
              <WorkforceSelectField
                label="Org unit"
                scalar="workforce_auth_rule_org_unit_id"
              >
                <Select.Option value="">Any org unit</Select.Option>
                <Each table="workforce_auth_rule_org_units" recordName="unit">
                  <Select.Option value={sql`unit.id`}>
                    {sql`unit.name || coalesce(' · ' || unit.code, '')`}
                  </Select.Option>
                </Each>
              </WorkforceSelectField>
            )}
            {hasLocations && (
              <WorkforceSelectField
                label="Location"
                scalar="workforce_auth_rule_location_id"
              >
                <Select.Option value="">Any location</Select.Option>
                <Each
                  table="workforce_auth_rule_locations"
                  recordName="location"
                >
                  <Select.Option value={sql`location.id`}>
                    {sql`location.name || coalesce(' · ' || location.code, '')`}
                  </Select.Option>
                </Each>
              </WorkforceSelectField>
            )}
          </div>
          <div className="mt-4">
            <Button
              variant="outlined"
              color="neutral"
              startIcon="FactCheck"
              onClick={(s) =>
                s.setScalar(
                  "workforce_auth_rule_permissions_visible",
                  sql`not workforce_auth_rule_permissions_visible`,
                )}
            >
              {sql`case
              when workforce_auth_rule_permissions_visible
                then 'Hide permissions'
              else 'Show permissions'
            end`}
            </Button>
          </div>
          <Show when={sql`workforce_auth_rule_permissions_visible`}>
            <div className="mt-3 flex flex-col gap-3">
              <Typography level="title-sm">Additional permissions</Typography>
              <Each
                table="workforce_auth_rule_selected_permissions"
                recordName="extra_permission"
              >
                <AuthBlock.PermissionEntry
                  permission={sql`extra_permission.permission`}
                >
                  <Typography level="body-sm">Added by this rule</Typography>
                  <IconButton
                    icon="DeleteOutline"
                    aria-label="Remove permission"
                    variant="plain"
                    color="danger"
                    onClick={(s) => {
                      s.modify(
                        sql`delete from ui.workforce_auth_rule_selected_permissions
                                 where permission = extra_permission.permission`,
                      );
                    }}
                  />
                </AuthBlock.PermissionEntry>
              </Each>
              <AuthBlock.PermissionPicker
                selected={(permission) =>
                  sql`exists (
                select 1 from ui.workforce_auth_rule_selected_permissions
                where permission = ${permission}
              ) or exists (
                select 1 from workforce_auth_role_permissions granted
                join ui.workforce_auth_rule_selected_roles selected_role
                  on selected_role.auth_role_id = granted.auth_role_id
                where granted.permission = ${permission}
              )`}
                onSelect={(s, permission) => {
                  s.modify(
                    sql`insert into ui.workforce_auth_rule_selected_permissions (permission)
                             values (${permission})`,
                  );
                }}
              />
              <Typography level="title-sm">Permissions from roles</Typography>
              <Data
                local
                watch={[
                  sql`(select string_agg(auth_role_id::string, ',') from workforce_auth_rule_selected_roles)`,
                ]}
                procedure={(s) => {
                  s.defTable(
                    "workforce_auth_selected_role_permissions",
                    sql`select granted.permission,
                             string_agg(granted.source_role_name, ', ' order by granted.source_role_name) as source_roles
                      from workforce_auth_role_permissions granted
                      join ui.workforce_auth_rule_selected_roles selected_role
                        on selected_role.auth_role_id = granted.auth_role_id
                      group by granted.permission`,
                  );
                }}
              >
                <Each
                  table="workforce_auth_selected_role_permissions"
                  recordName="role_permission"
                >
                  <AuthBlock.PermissionEntry
                    permission={sql`role_permission.permission`}
                  >
                    <Typography level="body-sm" className="text-secondary">
                      Inherited from {sql`role_permission.source_roles`}
                    </Typography>
                  </AuthBlock.PermissionEntry>
                </Each>
                <Show
                  when={sql`not exists (select 1 from workforce_auth_selected_role_permissions)`}
                >
                  <Typography level="body-sm" className="text-secondary">
                    The selected roles grant no permissions.
                  </Typography>
                </Show>
              </Data>
            </div>
          </Show>
          <div className="flex justify-end gap-2 mt-5">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) =>
                s.setScalar("workforce_auth_rule_open", sql`false`)}
            >
              Cancel
            </Button>
            <Button
              startIcon="Save"
              onClick={(s) => {
                s.setScalar("workforce_auth_rule_error", sql`null`);
                s.tryServer({
                  body: (s) => {
                    s.if(
                      sql`not exists (
                      select 1
                      from ui.workforce_auth_rule_selected_roles
                    )`,
                      (s) => {
                        s.setScalar(
                          "ui.workforce_auth_rule_error",
                          sql
                            .lit`Select at least one auth role this rule should grant.`,
                        );
                        s.return();
                      },
                    );
                    s.startTransaction();
                    workforce.assertManagementSession(s);
                    s.callStoredProcedure("workforce_save_auth_rule", {
                      inputScalars: {
                        p_rule_id:
                          sql`nullif(ui.workforce_auth_selected_rule_id, '')::bigint`,
                        p_worker_type:
                          sql`nullif(ui.workforce_auth_rule_worker_type, '')`,
                        p_employer_workforce_organization_id:
                          sql`nullif(ui.workforce_auth_rule_employer_org_id, '')::bigint`,
                        p_host_workforce_organization_id:
                          sql`nullif(ui.workforce_auth_rule_host_org_id, '')::bigint`,
                        p_workforce_job_profile_id:
                          sql`nullif(ui.workforce_auth_rule_job_profile_id, '')::bigint`,
                        ...(hasOrgUnits
                          ? {
                            p_workforce_org_unit_id:
                              sql`nullif(ui.workforce_auth_rule_org_unit_id, '')::bigint`,
                          }
                          : {}),
                        ...(hasLocations
                          ? {
                            p_workforce_location_id:
                              sql`nullif(ui.workforce_auth_rule_location_id, '')::bigint`,
                          }
                          : {}),
                      },
                      inputTables: {
                        p_roles: "ui.workforce_auth_rule_selected_roles",
                        p_permissions:
                          "ui.workforce_auth_rule_selected_permissions",
                      },
                    });
                    s.commitTransaction();
                    s.setScalar(
                      "ui.workforce_auth_selected_rule_id",
                      sql.lit``,
                    );
                    s.modify(
                      sql`delete from ui.workforce_auth_rule_selected_roles`,
                    );
                    s.modify(
                      sql`delete from ui.workforce_auth_rule_selected_permissions`,
                    );
                    s.setScalar(
                      "ui.workforce_auth_rule_permissions_visible",
                      sql`false`,
                    );
                    s.setScalar(
                      "ui.workforce_auth_rule_worker_type",
                      sql.lit``,
                    );
                    s.setScalar(
                      "ui.workforce_auth_rule_employer_org_id",
                      sql.lit``,
                    );
                    s.setScalar(
                      "ui.workforce_auth_rule_host_org_id",
                      sql.lit``,
                    );
                    s.setScalar(
                      "ui.workforce_auth_rule_job_profile_id",
                      sql.lit``,
                    );
                    if (hasOrgUnits) {
                      s.setScalar(
                        "ui.workforce_auth_rule_org_unit_id",
                        sql.lit``,
                      );
                    }
                    if (hasLocations) {
                      s.setScalar(
                        "ui.workforce_auth_rule_location_id",
                        sql.lit``,
                      );
                    }
                    s.setScalar("ui.workforce_auth_rule_open", sql`false`);
                    s.refetch();
                  },
                  catch: (s) => {
                    s.setScalar(
                      "workforce_auth_rule_error",
                      sql.lit`Role rule could not be saved.`,
                    );
                  },
                });
              }}
            >
              {sql`case
              when nullif(workforce_auth_selected_rule_id, '') is null
                then 'Create rule'
              else 'Save rule'
            end`}
            </Button>
          </div>
        </ModalDialog>
      </Data>
    </Data>
  );
}

function WorkforceDetailTabLabel(props: { icon?: IconName; label: Node }) {
  return (
    <span className="inline-flex items-center gap-2">
      {props.icon && (
        <MaterialIcon icon={props.icon} className="text-[17px] text-icon" />
      )}
      <span>{props.label}</span>
    </span>
  );
}

function WorkforceDetailField(props: {
  field: string;
  icon?: IconName;
  label?: Node;
}) {
  const block = system.block(WorkforceBlock);
  const table = system.db.tables[block.peopleTable];
  const field = table.fields[props.field];
  if (!field) {
    throw new Error(`Field ${props.field} not found`);
  }
  return (
    <div
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(92px, 38%) minmax(0, 1fr)",
        alignItems: "start",
        minHeight: "26px",
        columnGap: "10px",
      }}
      className="py-0.5"
    >
      <Typography
        startIcon={props.icon}
        level="body-sm"
        className="text-secondary"
      >
        {props.label ?? field.displayName}
      </Typography>
      <div className="min-w-0 break-words" sx={{ overflowWrap: "anywhere" }}>
        <Form.InlineEdit
          field={props.field}
          afterTransactionStart={(s) => block.assertManagementSession(s)}
          beforeTransactionCommit={props.field === "status"
            ? (s) => syncWorkforcePersonAccess(s, block, sql`record_id`)
            : undefined}
          sx={{
            px: 1,
            py: 0.5,
            borderRadius: "md",
            cursor: "pointer",
            position: "relative",
            minWidth: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            "&:hover": {
              backgroundColor: "background-level1",
            },
            "&:focus-within": {
              outline: "1px solid",
              outlineColor: "primary-500",
            },
            fontSize: "sm",
            minHeight: "22px",
          }}
        />
      </div>
    </div>
  );
}

function WorkforcePersonDetails(props: { excludeFields?: string[] }) {
  const block = system.block(WorkforceBlock);
  const table = system.db.tables[block.peopleTable];
  const excludeFields = new Set(props.excludeFields ?? []);
  const details: Node[] = [];
  for (const field of Object.values(table.fields)) {
    if (table.recordDisplayName?.fields.includes(field.name)) {
      continue;
    }
    if (
      field.name === "sys_user_id" ||
      field.name === "created_at"
    ) {
      continue;
    }
    if (excludeFields.has(field.name)) {
      continue;
    }
    let icon: IconName = "Info";
    if (field.name.includes("email")) {
      icon = "Email";
    } else if (field.name.includes("phone")) {
      icon = "Phone";
    } else if (field.name.includes("language")) {
      icon = "Translate";
    } else if (field.name.includes("status")) {
      icon = "FactCheck";
    } else if (field.name.includes("user")) {
      icon = "AccountCircle";
    }
    details.push(<WorkforceDetailField field={field.name} icon={icon} />);
  }
  return (
    <div className="h-full flex flex-col">
      <Typography
        level="title-sm"
        className="px-4 py-2 border-b border-divider"
      >
        Details
      </Typography>
      <div className="p-3 flex-1 overflow-auto">
        {details}
      </div>
    </div>
  );
}

function WorkforceCloseCurrentField(props: {
  stateName: string;
  initialValue: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Form.Temporary name={props.stateName}>
      <Form.Field
        field="close_current"
        fieldType="Bool"
        initialValue={props.initialValue}
      >
        {(field) => (
          <Checkbox
            checked={field.value}
            disabled={props.disabled}
            onCheckboxChange={(s) => field.setValue(s, sql`target_checked`)}
            label={props.label}
          />
        )}
      </Form.Field>
    </Form.Temporary>
  );
}

function workforceGeneratedFormFields(
  tableName: string,
  ignoreFields: string[],
) {
  const labels: Record<string, string> = {
    workforce_organization_id: "Organization",
    host_workforce_organization_id: "Host organization",
    workforce_job_profile_id: "Job profile",
    workforce_org_unit_id: "Organizational unit",
    workforce_location_id: "Location",
    workforce_position_id: "Position",
    external_worker_id: "External worker ID",
    is_primary: "Primary assignment",
    effective_from: "Starts on",
    effective_to: "Ends on",
  };
  const table = system.db.tables[tableName];
  return Object.values(table.fields)
    .filter((field) =>
      !ignoreFields.includes(field.name) &&
      field.name !== "created_at" &&
      field.name !== "last_modified_at" &&
      field.type !== "Bytes" &&
      field.type !== "Json"
    )
    .map((field) => (
      <Form.Field field={field.name}>
        <LabelOnLeftFormField label={labels[field.name]} />
      </Form.Field>
    ));
}

function validateWorkforceRelationshipAssignmentIntervals(
  s: UiServerStatements,
  block: WorkforceBlock,
  relationshipId: Sql,
) {
  s.if(
    sql`exists (
      select 1
      from db.${sql.ref(block.assignmentsTable)} child_assignment
      join db.${sql.ref(block.workerRelationshipsTable)} edited_relationship
        on edited_relationship.id = child_assignment.worker_relationship_id
      where edited_relationship.id = ${relationshipId}
        and (
          child_assignment.effective_from < edited_relationship.effective_from
          or (
            edited_relationship.effective_to is not null
            and (
              child_assignment.effective_to is null
              or child_assignment.effective_to >
                edited_relationship.effective_to
            )
          )
        )
    )`,
    (s) => {
      s.throwError(
        sql
          .lit`Relationship dates must contain every assignment. Adjust the child assignments before shortening this relationship.`,
      );
    },
  );
}

function validateWorkforceAssignmentRelationshipInterval(
  s: UiServerStatements,
  block: WorkforceBlock,
  assignmentId: Sql,
) {
  s.unless(
    sql`exists (
      select 1
      from db.${sql.ref(block.assignmentsTable)} edited_assignment
      join db.${sql.ref(block.workerRelationshipsTable)} parent_relationship
        on parent_relationship.id = edited_assignment.worker_relationship_id
      where edited_assignment.id = ${assignmentId}
        and parent_relationship.effective_from <=
          edited_assignment.effective_from
        and (
          parent_relationship.effective_to is null
          or (
            edited_assignment.effective_to is not null
            and edited_assignment.effective_to <=
              parent_relationship.effective_to
          )
        )
    )`,
    (s) => {
      s.throwError(
        sql
          .lit`Assignment dates must fall within the worker relationship dates.`,
      );
    },
  );
}

function WorkforceRelationshipCreateAction() {
  const block = system.block(WorkforceBlock);
  const assignmentNeedsPosition = Boolean(block.positionsTable);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("workforce_relationship_create_open", false);
      }}
    >
      <Button
        size="sm"
        variant="soft"
        startIcon="Add"
        onClick={(s) => s.setScalar("workforce_relationship_create_open", true)}
      >
        New relationship
      </Button>
      <ModalDialog
        bindScalar="workforce_relationship_create_open"
        maxWidth="lg"
        className="flex flex-col gap-4 p-6"
      >
        <div>
          <Typography level="title-lg">New relationship</Typography>
          <Typography level="body-sm" className="text-secondary mt-1">
            Add an effective-dated relationship and its initial primary
            assignment. Use Edit instead when correcting an existing record.
          </Typography>
        </div>
        <Form
          beforeSubmitClient={(s, ctx) => {
            s.if(
              assignmentNeedsPosition
                ? sql`workforce_new_relationship_assignment.workforce_job_profile_id is null
                    and workforce_new_relationship_assignment.workforce_position_id is null`
                : sql`workforce_new_relationship_assignment.workforce_job_profile_id is null`,
              (s) => {
                ctx.setWriteError(
                  s,
                  assignmentNeedsPosition
                    ? sql
                      .lit`Choose a job profile or position for the initial assignment.`
                    : sql.lit`Choose a job profile for the initial assignment.`,
                );
              },
            );
          }}
          afterTransactionStart={(s) => {
            block.assertStaffPersonAccess(s, sql`record_id`);
            s.if(
              sql`workforce_relationship_change_options.close_current
                and workforce_new_relationship.effective_to is null`,
              (s) => {
                s.if(
                  sql`exists (
                    select 1
                    from db.${
                    sql.ref(block.workerRelationshipsTable)
                  } current_relationship
                    where current_relationship.person_id = record_id
                      and current_relationship.effective_to is null
                      and current_relationship.effective_from >=
                        workforce_new_relationship.effective_from
                  )`,
                  (s) => {
                    s.throwError(
                      sql
                        .lit`The new relationship must start after every currently open relationship. Edit the existing relationship to correct its start date.`,
                    );
                  },
                );
                s.if(
                  sql`exists (
                    select 1
                    from db.${
                    sql.ref(block.assignmentsTable)
                  } current_assignment
                    join db.${
                    sql.ref(block.workerRelationshipsTable)
                  } current_relationship
                      on current_relationship.id = current_assignment.worker_relationship_id
                    where current_relationship.person_id = record_id
                      and current_relationship.effective_to is null
                      and current_assignment.effective_from >=
                        workforce_new_relationship.effective_from
                  )`,
                  (s) => {
                    s.throwError(
                      sql
                        .lit`The new relationship must start after every assignment on the current relationship. Edit or remove future assignments before replacing the relationship.`,
                    );
                  },
                );
                s.modify(sql`
                  update db.${sql.ref(block.assignmentsTable)} assignment
                  set effective_to = workforce_new_relationship.effective_from
                  where assignment.effective_from <
                      workforce_new_relationship.effective_from
                    and (
                      assignment.effective_to is null
                      or assignment.effective_to >
                        workforce_new_relationship.effective_from
                    )
                    and exists (
                      select 1
                      from db.${
                  sql.ref(block.workerRelationshipsTable)
                } current_relationship
                      where current_relationship.id = assignment.worker_relationship_id
                        and current_relationship.person_id = record_id
                        and current_relationship.effective_to is null
                    )
                `);
                s.modify(sql`
                  update db.${sql.ref(block.workerRelationshipsTable)}
                  set effective_to = workforce_new_relationship.effective_from
                  where person_id = record_id
                    and effective_to is null
                `);
              },
            );
          }}
          beforeTransactionCommit={(s) => {
            block.assertStaffPersonAccess(s, sql`record_id`);
            syncWorkforcePersonAccess(s, block, sql`record_id`);
          }}
          afterSubmitClientSuccess={(s) =>
            s.setScalar("workforce_relationship_create_open", false)}
        >
          <Form.Insert
            table={block.workerRelationshipsTable}
            stateName="workforce_new_relationship"
            values={{ person_id: sql`record_id` }}
          >
            <Typography level="title-md" className="mb-2">
              Relationship
            </Typography>
            <div className="flex flex-col gap-3">
              {workforceGeneratedFormFields(
                block.workerRelationshipsTable,
                ["person_id"],
              )}
            </div>
            <Typography level="title-md" className="mt-5 mb-2">
              Initial assignment
            </Typography>
            <Form.Relation
              table={block.assignmentsTable}
              stateName="workforce_new_relationship_assignment"
              field="worker_relationship_id"
              many={false}
              values={{
                effective_from: sql`workforce_new_relationship.effective_from`,
                effective_to: sql`workforce_new_relationship.effective_to`,
                is_primary: sql`true`,
              }}
            >
              <div className="flex flex-col gap-3">
                {workforceGeneratedFormFields(
                  block.assignmentsTable,
                  [
                    "worker_relationship_id",
                    "effective_from",
                    "effective_to",
                    "is_primary",
                  ],
                )}
              </div>
            </Form.Relation>
          </Form.Insert>
          <div className="mt-4">
            <WorkforceCloseCurrentField
              stateName="workforce_relationship_change_options"
              initialValue={!block.opts.allowMultipleActiveRelationships}
              disabled={!block.opts.allowMultipleActiveRelationships}
              label="End currently open relationships and assignments when this relationship starts"
            />
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) =>
                s.setScalar("workforce_relationship_create_open", false)}
            >
              Cancel
            </Button>
            <Form.SubmitButton>Create relationship</Form.SubmitButton>
          </div>
          <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
        </Form>
      </ModalDialog>
    </Data>
  );
}

function WorkforceAssignmentCreateAction() {
  const block = system.block(WorkforceBlock);
  const assignmentNeedsPosition = Boolean(block.positionsTable);
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "workforce_assignment_relationship_options",
          sql`
            select relationship.id,
                   organization.name || ' · ' ||
                     cast(relationship.worker_type as string) || ' · ' ||
                     cast(relationship.effective_from as string) ||
                     case
                       when relationship.effective_to is null then ' onward'
                       else ' to ' || cast(relationship.effective_to as string)
                     end as label
            from db.${sql.ref(block.workerRelationshipsTable)} relationship
            join db.${sql.ref(block.organizationsTable)} organization
              on organization.id = relationship.workforce_organization_id
            where relationship.person_id = record_id
            order by
              case
                when relationship.effective_from <= current_date()
                  and (relationship.effective_to is null
                    or current_date() < relationship.effective_to)
                  then 0
                else 1
              end,
              relationship.effective_from desc,
              relationship.id desc
          `,
        );
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar("workforce_assignment_create_open", false);
        }}
      >
        <Button
          size="sm"
          variant="soft"
          startIcon="Add"
          disabled={sql`not exists (
            select 1 from workforce_assignment_relationship_options
          )`}
          onClick={(s) => s.setScalar("workforce_assignment_create_open", true)}
        >
          New assignment
        </Button>
        <ModalDialog
          bindScalar="workforce_assignment_create_open"
          maxWidth="lg"
          className="flex flex-col gap-4 p-6"
        >
          <div>
            <Typography level="title-lg">New assignment</Typography>
            <Typography level="body-sm" className="text-secondary mt-1">
              Add an effective-dated assignment to one of this person's
              relationships. Use Edit instead when correcting an existing
              assignment.
            </Typography>
          </div>
          <Form
            beforeSubmitClient={(s, ctx) => {
              s.if(
                assignmentNeedsPosition
                  ? sql`workforce_new_assignment.workforce_job_profile_id is null
                      and workforce_new_assignment.workforce_position_id is null`
                  : sql`workforce_new_assignment.workforce_job_profile_id is null`,
                (s) => {
                  ctx.setWriteError(
                    s,
                    assignmentNeedsPosition
                      ? sql.lit`Choose a job profile or position.`
                      : sql.lit`Choose a job profile.`,
                  );
                },
              );
            }}
            afterTransactionStart={(s) => {
              block.assertStaffPersonAccess(s, sql`record_id`);
              s.unless(
                sql`exists (
                  select 1
                  from db.${
                  sql.ref(block.workerRelationshipsTable)
                } relationship
                  where relationship.id =
                      workforce_new_assignment.worker_relationship_id
                    and relationship.person_id = record_id
                    and relationship.effective_from <=
                      workforce_new_assignment.effective_from
                    and (
                      relationship.effective_to is null
                      or (
                        workforce_new_assignment.effective_to is not null
                        and workforce_new_assignment.effective_to <=
                          relationship.effective_to
                      )
                    )
                )`,
                (s) => {
                  s.throwError(
                    sql
                      .lit`The assignment dates must fall within a relationship belonging to this person.`,
                  );
                },
              );
              s.if(
                sql`workforce_assignment_change_options.close_current
                  and workforce_new_assignment.is_primary
                  and workforce_new_assignment.effective_to is null`,
                (s) => {
                  s.if(
                    sql`exists (
                      select 1
                      from db.${
                      sql.ref(block.assignmentsTable)
                    } current_assignment
                      where current_assignment.worker_relationship_id =
                          workforce_new_assignment.worker_relationship_id
                        and current_assignment.is_primary
                        and current_assignment.effective_to is null
                        and current_assignment.effective_from >=
                          workforce_new_assignment.effective_from
                    )`,
                    (s) => {
                      s.throwError(
                        sql
                          .lit`The new assignment must start after the currently open primary assignment. Edit the existing assignment to correct its start date.`,
                      );
                    },
                  );
                  s.modify(sql`
                    update db.${sql.ref(block.assignmentsTable)}
                    set effective_to = workforce_new_assignment.effective_from
                    where worker_relationship_id =
                        workforce_new_assignment.worker_relationship_id
                      and is_primary
                      and effective_to is null
                  `);
                },
              );
            }}
            beforeTransactionCommit={(s) => {
              block.assertStaffPersonAccess(s, sql`record_id`);
              syncWorkforcePersonAccess(s, block, sql`record_id`);
            }}
            afterSubmitClientSuccess={(s) =>
              s.setScalar("workforce_assignment_create_open", false)}
          >
            <Form.Insert
              table={block.assignmentsTable}
              stateName="workforce_new_assignment"
            >
              <div className="flex flex-col gap-3">
                <Form.Field
                  field="worker_relationship_id"
                  required
                  initialValue={sql`(
                    select relationship.id
                    from db.${
                    sql.ref(block.workerRelationshipsTable)
                  } relationship
                    where relationship.person_id = record_id
                    order by
                      case
                        when relationship.effective_from <= current_date()
                          and (relationship.effective_to is null
                            or current_date() < relationship.effective_to)
                          then 0
                        else 1
                      end,
                      relationship.effective_from desc,
                      relationship.id desc
                    limit 1
                  )`}
                >
                  {(field) => (
                    <FormControl>
                      <FormLabel>Relationship</FormLabel>
                      <EachSelect
                        table="workforce_assignment_relationship_options"
                        value={field.value}
                        onChange={(s, recordId) => field.setValue(s, recordId)}
                        optionLabel="label"
                        optionValue="id"
                        placeholder="Select relationship"
                        aria-label="Relationship"
                        fullWidth
                      />
                    </FormControl>
                  )}
                </Form.Field>
                {workforceGeneratedFormFields(block.assignmentsTable, [
                  "worker_relationship_id",
                ])}
              </div>
            </Form.Insert>
            <div className="mt-4">
              <WorkforceCloseCurrentField
                stateName="workforce_assignment_change_options"
                initialValue={!block.opts.allowMultipleActivePrimaryAssignments}
                disabled={!block.opts.allowMultipleActivePrimaryAssignments}
                label="End the currently open primary assignment when this primary assignment starts"
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="plain"
                color="neutral"
                onClick={(s) =>
                  s.setScalar("workforce_assignment_create_open", false)}
              >
                Cancel
              </Button>
              <Form.SubmitButton>Create assignment</Form.SubmitButton>
            </div>
            <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
          </Form>
        </ModalDialog>
      </Data>
    </Data>
  );
}

function workforceDateColumn(
  columns: ColumnsBuilder,
  field: string,
  header: string,
  width: string,
) {
  columns.column(
    header,
    ({ record }) => (
      <span className="whitespace-nowrap">
        {sql`format.date(${record}.${sql.ref(field)}, '%Y-%m-%d')`}
      </span>
    ),
    { field, width },
  );
}

function WorkforcePersonRelationshipsTab() {
  const block = system.block(WorkforceBlock);
  return (
    <DataTable
      primaryTable={block.workerRelationshipsTable}
      query={sql`
        select relationship.id,
               org.name as organization,
               relationship.worker_type,
               relationship.status,
               relationship.effective_from,
               relationship.effective_to,
               relationship.external_worker_id
        from db.${sql.ref(block.workerRelationshipsTable)} relationship
        join db.${sql.ref(block.organizationsTable)} org
          on org.id = relationship.workforce_organization_id
        where relationship.person_id = record_id
        order by relationship.effective_from desc, relationship.id desc
      `}
      recordName="relationship"
      pageSize={10}
      toolbar={block.opts.enableRelationshipAndAssignmentCreation
        ? <WorkforceRelationshipCreateAction />
        : undefined}
      searchable={[
        "organization",
        "worker_type",
        "status",
        "external_worker_id",
      ]}
      columns={(b) => {
        b.simpleColumn("organization", "Organization", { width: "28%" });
        b.enumColumn("worker_type", "workforce_worker_type", "Type", {
          width: "14%",
        });
        b.enumColumn("status", "workforce_relationship_status", "Status", {
          width: "14%",
        });
        workforceDateColumn(b, "effective_from", "From", "14%");
        workforceDateColumn(b, "effective_to", "To", "14%");
        b.simpleColumn("external_worker_id", "External ID", { width: "16%" });
      }}
      actions={(b) => {
        b.edit({
          ignoreFields: ["person_id"],
          afterTransactionStart: (s, _ctx, recordId) =>
            block.assertStaffPersonAccess(
              s,
              sql`(select person_id from db.${
                sql.ref(block.workerRelationshipsTable)
              } where id = ${recordId})`,
            ),
          beforeTransactionCommit: (s, _ctx, recordId) => {
            validateWorkforceRelationshipAssignmentIntervals(
              s,
              block,
              recordId,
            );
            block.assertStaffPersonAccess(
              s,
              sql`(select person_id from db.${
                sql.ref(block.workerRelationshipsTable)
              } where id = ${recordId})`,
            );
            syncWorkforcePersonAccess(
              s,
              block,
              sql`(
                select person_id
                from db.${sql.ref(block.workerRelationshipsTable)}
                where id = ${recordId}
              )`,
            );
          },
        });
      }}
    />
  );
}

function WorkforcePersonAssignmentsTab() {
  const block = system.block(WorkforceBlock);
  return (
    <DataTable
      primaryTable={block.assignmentsTable}
      query={sql`
        select assignment.id,
               job.name as job_profile,
               host.name as host_organization,
               ${block.orgUnitsTable ? sql`unit.name as org_unit,` : sql``}
               ${block.locationsTable ? sql`location.name as location,` : sql``}
               ${block.positionsTable ? sql`position.name as position,` : sql``}
               assignment.is_primary,
               assignment.status,
               assignment.effective_from,
               assignment.effective_to
        from db.${sql.ref(block.assignmentsTable)} assignment
        join db.${sql.ref(block.workerRelationshipsTable)} relationship
          on relationship.id = assignment.worker_relationship_id
        left join db.${sql.ref(block.jobProfilesTable)} job
          on job.id = assignment.workforce_job_profile_id
        left join db.${sql.ref(block.organizationsTable)} host
          on host.id = assignment.host_workforce_organization_id
        ${
        block.orgUnitsTable
          ? sql`left join db.${sql.ref(block.orgUnitsTable)} unit
              on unit.id = assignment.workforce_org_unit_id`
          : sql``
      }
        ${
        block.locationsTable
          ? sql`left join db.${sql.ref(block.locationsTable)} location
              on location.id = assignment.workforce_location_id`
          : sql``
      }
        ${
        block.positionsTable
          ? sql`left join db.${sql.ref(block.positionsTable)} position
              on position.id = assignment.workforce_position_id`
          : sql``
      }
        where relationship.person_id = record_id
        order by assignment.effective_from desc, assignment.id desc
      `}
      recordName="assignment"
      pageSize={10}
      toolbar={block.opts.enableRelationshipAndAssignmentCreation
        ? <WorkforceAssignmentCreateAction />
        : undefined}
      searchable={[
        "job_profile",
        "host_organization",
        ...(block.orgUnitsTable ? ["org_unit"] : []),
        ...(block.locationsTable ? ["location"] : []),
        ...(block.positionsTable ? ["position"] : []),
        "status",
      ]}
      columns={(b) => {
        b.simpleColumn("job_profile", "Job", { width: "20%" });
        b.simpleColumn("host_organization", "Host", { width: "18%" });
        if (block.orgUnitsTable) {
          b.simpleColumn("org_unit", "Org unit", { width: "15%" });
        }
        if (block.locationsTable) {
          b.simpleColumn("location", "Location", { width: "15%" });
        }
        if (block.positionsTable) {
          b.simpleColumn("position", "Position", { width: "15%" });
        }
        b.checkColumn("is_primary", "Primary", { width: "10%" });
        b.enumColumn("status", "workforce_assignment_status", "Status", {
          width: "12%",
        });
        workforceDateColumn(b, "effective_from", "From", "12%");
        workforceDateColumn(b, "effective_to", "To", "12%");
      }}
      actions={(b) => {
        b.edit({
          ignoreFields: ["worker_relationship_id"],
          afterTransactionStart: (s, _ctx, recordId) =>
            block.assertStaffPersonAccess(
              s,
              sql`(select checked_relationship.person_id from db.${
                sql.ref(block.assignmentsTable)
              } checked_assignment join db.${
                sql.ref(block.workerRelationshipsTable)
              } checked_relationship on checked_relationship.id = checked_assignment.worker_relationship_id where checked_assignment.id = ${recordId})`,
            ),
          beforeTransactionCommit: (s, _ctx, recordId) => {
            validateWorkforceAssignmentRelationshipInterval(
              s,
              block,
              recordId,
            );
            block.assertStaffPersonAccess(
              s,
              sql`(select checked_relationship.person_id from db.${
                sql.ref(block.assignmentsTable)
              } checked_assignment join db.${
                sql.ref(block.workerRelationshipsTable)
              } checked_relationship on checked_relationship.id = checked_assignment.worker_relationship_id where checked_assignment.id = ${recordId})`,
            );
            syncWorkforcePersonAccess(
              s,
              block,
              sql`(
                select relationship.person_id
                from db.${sql.ref(block.assignmentsTable)} target_assignment
                join db.${sql.ref(block.workerRelationshipsTable)}
                  relationship
                  on relationship.id = target_assignment.worker_relationship_id
                where target_assignment.id = ${recordId}
              )`,
            );
          },
        });
      }}
    />
  );
}

function WorkforcePersonReportingTab() {
  const block = system.block(WorkforceBlock);
  if (!block.reportingRelationshipsTable) {
    return null;
  }
  return (
    <DataTable
      primaryTable={block.reportingRelationshipsTable}
      query={sql`
        select reporting.id,
               reporting.relationship_type,
               manager_person.display_name as manager,
               reporting.is_active,
               reporting.effective_from,
               reporting.effective_to
        from db.${sql.ref(block.reportingRelationshipsTable)} reporting
        join db.${sql.ref(block.workerRelationshipsTable)} relationship
          on relationship.id = reporting.worker_relationship_id
        join db.${sql.ref(block.workerRelationshipsTable)} manager_relationship
          on manager_relationship.id = reporting.manager_worker_relationship_id
        join db.${sql.ref(block.peopleTable)} manager_person
          on manager_person.id = manager_relationship.person_id
        where relationship.person_id = record_id
        order by reporting.effective_from desc, reporting.id desc
      `}
      recordName="reporting"
      pageSize={10}
      searchable={["relationship_type", "manager"]}
      columns={(b) => {
        b.simpleColumn("relationship_type", "Type", { width: "22%" });
        b.simpleColumn("manager", "Manager", { width: "28%" });
        b.checkColumn("is_active", "Active", { width: "12%" });
        workforceDateColumn(b, "effective_from", "From", "18%");
        workforceDateColumn(b, "effective_to", "To", "18%");
      }}
      actions={(b) => {
        b.edit({
          ignoreFields: ["worker_relationship_id"],
          afterTransactionStart: (s) => block.assertManagementSession(s),
        });
      }}
    />
  );
}

/**
 * Standard workforce-history surface for embedding in a person detail page.
 * Relationship, assignment, and reporting records stay together without
 * requiring systems to rebuild the block's validation-aware tables.
 */
export function WorkforcePersonManagement() {
  const block = system.block(WorkforceBlock);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Typography level="h4">Workforce</Typography>
          <Typography level="body-sm" className="text-secondary mt-1">
            Employment relationships, job assignments, and reporting history.
          </Typography>
          {system.block(AuthBlock).opts.accessPolicy && (
            <Typography level="body-sm" className="text-secondary mt-1">
              Staff managers can assign approved job profiles to other people.
              Protected accounts, login details, and access rules require system
              administration.
            </Typography>
          )}
        </div>
        {block.opts.enableReferenceDataCreation && (
          <AccessCheck
            when={system.block(AuthBlock).opts.accessPolicy
              ? isAccessAdministrator()
              : sql.true}
          >
            <Button
              size="sm"
              variant="outlined"
              startIcon="Settings"
              href={block.routes.referenceDataPath}
            >
              Configure workforce
            </Button>
          </AccessCheck>
        )}
      </div>
      <Tabs
        selectedTabScalar="workforce_person_section"
        defaultValue="relationships"
        size="sm"
      >
        <Tabs.List className="w-full overflow-x-auto">
          <Tabs.Tab value="relationships">Relationships</Tabs.Tab>
          <Tabs.Tab value="assignments">Assignments</Tabs.Tab>
          {block.reportingRelationshipsTable && (
            <Tabs.Tab value="reporting">Reporting</Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="relationships" className="pt-4">
          <WorkforcePersonRelationshipsTab />
        </Tabs.Panel>
        <Tabs.Panel value="assignments" className="pt-4">
          <WorkforcePersonAssignmentsTab />
        </Tabs.Panel>
        {block.reportingRelationshipsTable && (
          <Tabs.Panel value="reporting" className="pt-4">
            <WorkforcePersonReportingTab />
          </Tabs.Panel>
        )}
      </Tabs>
    </div>
  );
}

function WorkforcePersonAccountAction() {
  const block = system.block(WorkforceBlock);
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "workforce_person_auth_user_id",
          sql`(
            select ${block.personSysUserId(sql`person`)}
            from db.${sql.ref(block.peopleTable)} person
            where person.id = record_id
          )`,
        );
      }}
    >
      <UserAccountManagementButton
        userId={sql`workforce_person_auth_user_id`}
      />
    </Data>
  );
}

function renderWorkforceDetailTabs(tabs: WorkforceDetailTabConfig[] = []) {
  return tabs.map((tab) => ({
    value: tab.value,
    header: (
      <WorkforceDetailTabLabel
        icon={tab.header.icon}
        label={tab.header.label}
      />
    ),
    content: tab.content,
  }));
}

export function WorkforcePersonDetailPage(
  props: WorkforcePersonDetailPageProps,
) {
  const block = system.block(WorkforceBlock);
  const table = system.db.tables[block.peopleTable];
  const tabs: {
    value?: string;
    header: Node;
    content: Node;
  }[] = [
    ...renderWorkforceDetailTabs(props.prependTabs),
    {
      value: "workforce",
      header: <WorkforceDetailTabLabel icon="Work" label="Workforce" />,
      content: <WorkforcePersonManagement />,
    },
  ];
  tabs.push(...renderWorkforceDetailTabs(props.appendTabs));
  return (
    <RecordWithTabsAndDetailPage
      table={block.peopleTable}
      path={props.path ?? block.routes.personDetailPath}
      wrapper={props.wrapper}
      header={
        <>
          {props.leftSideHeader ?? (
            <Data
              procedure={(s) => {
                s.defRecord(
                  "rec",
                  sql`select * from db.${
                    sql.ref(block.peopleTable)
                  } where id = record_id`,
                );
              }}
            >
              <Typography level="h4">
                <Form.InlineEdit
                  field={table.recordDisplayName?.fields[0] ??
                    "display_name"}
                  afterTransactionStart={(s) =>
                    block.assertManagementSession(s)}
                  sx={{
                    pl: 2,
                    pr: 5,
                    borderRadius: "md",
                    cursor: "pointer",
                    position: "relative",
                    "&:hover": {
                      backgroundColor: "background-level1",
                    },
                    "&:focus-within": {
                      outline: "1px solid",
                      outlineColor: "primary-500",
                    },
                  }}
                />
              </Typography>
            </Data>
          )}
          <PageHeader.Grow />
          <PageHeader.Actions>
            {props.rightSideHeader ?? <WorkforcePersonAccountAction />}
          </PageHeader.Actions>
        </>
      }
      tabs={tabs}
      details={props.details ?? (
        <WorkforcePersonDetails excludeFields={props.excludeFields} />
      )}
    />
  );
}

export function WorkforcePeoplePage(props: WorkforcePeoplePageProps) {
  const block = system.block(WorkforceBlock);
  const importAction = props.importAction === false
    ? null
    : props.importAction ?? (
      <WorkforcePeopleImportAction
        workforce={block}
        {...(props.importActionProps ?? {})}
        afterImport={(s) => reconcileWorkforceAuthRules(s, block)}
      />
    );
  const createAction = props.createAction ?? (
    <WorkforcePersonCreateAction
      workforce={block}
      {...(props.createActionProps ?? {})}
    />
  );
  return (
    <DatagridPage
      table={block.peopleTable}
      path={props.path ?? block.routes.peopleListPath}
      wrapper={props.wrapper}
      datagridName={props.datagridName ?? block.routes.peopleDatagridName}
      viewButtonUrl={(id) =>
        block.recordHref(props.detailPath ?? block.routes.personDetailPath, id)}
      ignoreFields={["sys_user_id"]}
      canEdit={system.block(AuthBlock).opts.accessPolicy
        ? isAccessAdministrator()
        : undefined}
      fields={system.block(AuthBlock).opts.accessPolicy
        ? Object.fromEntries(
          Object.keys(system.db.tables[block.peopleTable].fields).map((
            field,
          ) => [field, {
            beforeUpdate: () => (s: UiServerStatements) =>
              block.assertManagementSession(s),
          }]),
        )
        : undefined}
      quickSearch
      toolbarRight={
        <div className="flex items-center gap-2 flex-wrap">
          <AccessCheck
            when={system.block(AuthBlock).opts.accessPolicy
              ? isAccessAdministrator()
              : sql.true}
          >
            {importAction}
            {createAction}
          </AccessCheck>
        </div>
      }
    />
  );
}

interface WorkforceReferenceDataTableProps {
  table: string;
  title: string;
  description: string;
  addLabel: string;
  allowCreate: boolean;
}

function WorkforceReferenceDataTable(
  props: WorkforceReferenceDataTableProps,
) {
  const block = system.block(WorkforceBlock);
  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 w-full">
          <div>
            <Typography level="title-lg">{props.title}</Typography>
            <Typography level="body-sm" className="text-secondary mt-1">
              {props.description}
            </Typography>
          </div>
          {props.allowCreate && (
            <AutoInsertButton
              table={props.table}
              afterTransactionStart={(s) => block.assertManagementSession(s)}
              beforeTransactionCommit={(s) =>
                reconcileWorkforceReferenceDataAuthRules(s, block)}
              size="sm"
              variant="soft"
              startIcon="Add"
            >
              {props.addLabel}
            </AutoInsertButton>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          primaryTable={props.table}
          query={sql`select * from db.${sql.ref(props.table)} order by id`}
          pageSize={20}
          searchable
          sortable
          emptyState={`No ${props.title.toLowerCase()} yet.`}
          actions={(b) =>
            b.edit({
              afterTransactionStart: (s) => block.assertManagementSession(s),
              beforeTransactionCommit: (s) =>
                reconcileWorkforceReferenceDataAuthRules(s, block),
            })}
        />
      </CardContent>
    </Card>
  );
}

export function WorkforceReferenceDataPage(
  props: WorkforceReferenceDataPageProps,
) {
  const block = system.block(WorkforceBlock);
  const tabs = [
    {
      value: "organizations",
      label: "Organizations",
      content: (
        <WorkforceReferenceDataTable
          table={block.organizationsTable}
          title="Organizations"
          description="Employers and host organizations used by worker relationships and assignments."
          addLabel="Add organization"
          allowCreate={Boolean(block.opts.enableReferenceDataCreation)}
        />
      ),
    },
    {
      value: "job_profiles",
      label: "Job profiles",
      content: (
        <WorkforceReferenceDataTable
          table={block.jobProfilesTable}
          title="Job profiles"
          description="Reusable job definitions selected on workforce assignments."
          addLabel="Add job profile"
          allowCreate={Boolean(block.opts.enableReferenceDataCreation)}
        />
      ),
    },
    ...(block.orgUnitsTable
      ? [{
        value: "org_units",
        label: "Org units",
        content: (
          <WorkforceReferenceDataTable
            table={block.orgUnitsTable}
            title="Org units"
            description="The organization hierarchy available to assignments."
            addLabel="Add org unit"
            allowCreate={Boolean(block.opts.enableReferenceDataCreation)}
          />
        ),
      }]
      : []),
    ...(block.locationsTable
      ? [{
        value: "locations",
        label: "Locations",
        content: (
          <WorkforceReferenceDataTable
            table={block.locationsTable}
            title="Locations"
            description="Work locations available to assignments and positions."
            addLabel="Add location"
            allowCreate={Boolean(block.opts.enableReferenceDataCreation)}
          />
        ),
      }]
      : []),
    ...(block.positionsTable
      ? [{
        value: "positions",
        label: "Positions",
        content: (
          <WorkforceReferenceDataTable
            table={block.positionsTable}
            title="Positions"
            description="Concrete workforce seats linked to jobs, org units, and locations."
            addLabel="Add position"
            allowCreate={Boolean(block.opts.enableReferenceDataCreation)}
          />
        ),
      }]
      : []),
  ];
  const inner = (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageTitleHeader title="Workforce setup" />
      <Tabs
        selectedTabScalar="workforce_reference_data_tab"
        defaultValue="organizations"
      >
        <Tabs.List
          className="overflow-x-auto"
          sx={{
            "--tab-indicator-thickness": "3px",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {tabs.map((tab) => (
            <Tabs.Tab value={tab.value} selectedColor="primary">
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Panel value={tab.value} className="pt-4">
            {tab.content}
          </Tabs.Panel>
        ))}
      </Tabs>
    </div>
  );
  const content = props.wrapper ? props.wrapper(inner) : inner;
  return (
    <Route path={props.path ?? block.routes.referenceDataPath}>
      {content}
    </Route>
  );
}

export function WorkforceAuthRoleRulesPage(
  props: WorkforceAuthRoleRulesPageProps,
) {
  const block = system.block(WorkforceBlock);
  const path = props.path ?? block.routes.authRoleRulesPath;
  const inner = (
    <div className="p-4 sm:p-6 lg:p-8">
      <WorkforceAuthRoleRules workforce={block} />
    </div>
  );
  const content = props.wrapper ? props.wrapper(inner) : inner;
  return (
    <Route path={path}>
      {content}
    </Route>
  );
}

function renderWorkforceStandardRouteContent(
  override: WorkforceStandardRouteOverride | undefined,
  fallback: Node,
) {
  if (override === false) return null;
  if (override !== undefined) return override;
  return fallback;
}

function WorkforceStandardRoutes(props: WorkforceStandardRoutesProps) {
  const block = system.block(WorkforceBlock);
  const overrides = props.overrides ?? {};
  const peopleListPath = props.peopleListPath ?? block.routes.peopleListPath;
  const personDetailPath = props.personDetailPath ??
    block.routes.personDetailPath;
  const referenceDataPath = props.referenceDataPath;
  const authRoleRulesPath = props.authRoleRulesPath ??
    block.routes.authRoleRulesPath;
  return (
    <>
      {renderWorkforceStandardRouteContent(
        overrides.peopleList,
        <WorkforcePeoplePage
          path={peopleListPath}
          wrapper={props.wrapper}
          detailPath={personDetailPath}
          datagridName={props.peopleDatagridName ??
            block.routes.peopleDatagridName}
          createActionProps={props.peopleCreateActionProps}
          importActionProps={props.peopleImportActionProps}
        />,
      )}
      {renderWorkforceStandardRouteContent(
        overrides.personDetail,
        <WorkforcePersonDetailPage
          path={personDetailPath}
          wrapper={props.wrapper}
          {...(props.personDetail ?? {})}
        />,
      )}
      {(referenceDataPath !== undefined ||
        overrides.referenceData !== undefined) &&
        renderWorkforceStandardRouteContent(
          overrides.referenceData,
          <WorkforceReferenceDataPage
            path={referenceDataPath ?? block.routes.referenceDataPath}
            wrapper={props.wrapper}
          />,
        )}
      {renderWorkforceStandardRouteContent(
        overrides.authRoleRules,
        <WorkforceAuthRoleRulesPage
          path={authRoleRulesPath}
          wrapper={props.wrapper}
        />,
      )}
    </>
  );
}

function normalizeEnumValues(
  values: Array<string | WorkforceEnumValue>,
): WorkforceEnumValue[] {
  return values.map((value) =>
    typeof value === "string"
      ? {
        name: value,
        displayName: value.charAt(0).toUpperCase() + value.slice(1),
      }
      : value
  );
}

export class WorkforceBlock implements Block, WorkforceProvider {
  blockName = "WorkforceBlock";

  peopleTable: string;
  organizationsTable: string;
  workerRelationshipsTable: string;
  jobProfilesTable: string;
  assignmentsTable: string;
  orgUnitsTable?: string;
  locationsTable?: string;
  positionsTable?: string;
  reportingRelationshipsTable?: string;
  authRoleMappingsTable?: string;
  authRoleMappingRolesTable?: string;
  authRoleMappingPermissionsTable?: string;
  workerTypes: WorkforceEnumValue[];
  personStatuses: WorkforceEnumValue[];
  relationshipStatuses: WorkforceEnumValue[];
  assignmentStatuses: WorkforceEnumValue[];
  readonly activePersonStatus: string;
  readonly activeRelationshipStatus: string;
  readonly activeAssignmentStatus: string;
  sysUserLink: "person_field" | "sys_user_field";
  disableLoginWhenAccessIneligible: boolean;
  #routes: WorkforceResolvedRouteConfig;

  personPrimaryOrgUnitId?: (personRecord: Sql) => Sql;
  personPrimaryLocationId?: (personRecord: Sql) => Sql;
  personPrimaryPositionId?: (personRecord: Sql) => Sql;
  personPrimaryOrgUnitDisplay?: (personRecord: Sql) => Sql;
  personPrimaryLocationDisplay?: (personRecord: Sql) => Sql;

  constructor(public opts: WorkforceBlockOpts = {}) {
    this.peopleTable = opts.peopleTable ?? "workforce_people";
    this.organizationsTable = opts.organizationsTable ??
      "workforce_organizations";
    this.workerRelationshipsTable = opts.workerRelationshipsTable ??
      "workforce_worker_relationships";
    this.jobProfilesTable = opts.jobProfilesTable ?? "workforce_job_profiles";
    this.assignmentsTable = opts.assignmentsTable ?? "workforce_assignments";
    this.workerTypes = normalizeEnumValues(
      opts.workerTypes ??
        ["employee", "contractor", "vendor_worker", "temp", "intern"],
    );
    this.personStatuses = normalizeEnumValues(
      opts.personStatuses ?? ["active", "inactive"],
    );
    this.relationshipStatuses = normalizeEnumValues(
      opts.relationshipStatuses ??
        ["active", "inactive", "terminated", "on_leave"],
    );
    this.assignmentStatuses = normalizeEnumValues(
      opts.assignmentStatuses ?? ["active", "ended", "suspended"],
    );
    this.activePersonStatus = opts.activePersonStatus ?? "active";
    this.activeRelationshipStatus = opts.activeRelationshipStatus ?? "active";
    this.activeAssignmentStatus = opts.activeAssignmentStatus ?? "active";
    for (
      const [option, active, values] of [
        ["activePersonStatus", this.activePersonStatus, this.personStatuses],
        [
          "activeRelationshipStatus",
          this.activeRelationshipStatus,
          this.relationshipStatuses,
        ],
        [
          "activeAssignmentStatus",
          this.activeAssignmentStatus,
          this.assignmentStatuses,
        ],
      ] as const
    ) {
      if (!values.some((value) => value.name === active)) {
        throw new Error(
          `WorkforceBlock ${option} must name a configured status: ${active}`,
        );
      }
    }
    this.sysUserLink = opts.sysUserLink ?? "person_field";
    this.disableLoginWhenAccessIneligible =
      opts.disableLoginWhenAccessIneligible ?? false;
    this.#routes = {
      peopleListPath: opts.routes?.peopleListPath ?? "/people",
      personDetailPath: opts.routes?.personDetailPath ??
        `${opts.routes?.peopleListPath ?? "/people"}/{record_id:id}`,
      referenceDataPath: opts.routes?.referenceDataPath ??
        "/workforce/reference-data",
      authRoleRulesPath: opts.routes?.authRoleRulesPath ??
        "/workforce/role-rules",
      peopleDatagridName: opts.routes?.peopleDatagridName,
    };
    if (opts.enableOrgUnits) {
      this.orgUnitsTable = opts.orgUnitsTable ?? "workforce_org_units";
      this.personPrimaryOrgUnitId = (personRecord) =>
        this.assignmentFact(personRecord, sql`wf_a.workforce_org_unit_id`);
      this.personPrimaryOrgUnitDisplay = (personRecord) =>
        sql`(
          select coalesce(code, name)
          from db.${sql.ref(this.orgUnitsTable!)}
          where id = ${this.personPrimaryOrgUnitId!(personRecord)}
        )`;
    }
    if (opts.enableLocations) {
      this.locationsTable = opts.locationsTable ?? "workforce_locations";
      this.personPrimaryLocationId = (personRecord) =>
        this.assignmentFact(personRecord, sql`wf_a.workforce_location_id`);
      this.personPrimaryLocationDisplay = (personRecord) =>
        sql`(
          select coalesce(code, name)
          from db.${sql.ref(this.locationsTable!)}
          where id = ${this.personPrimaryLocationId!(personRecord)}
        )`;
    }
    if (opts.enablePositions) {
      this.positionsTable = opts.positionsTable ?? "workforce_positions";
      this.personPrimaryPositionId = (personRecord) =>
        this.assignmentFact(personRecord, sql`wf_a.workforce_position_id`);
    }
    if (opts.enableReporting) {
      this.reportingRelationshipsTable = opts.reportingRelationshipsTable ??
        "workforce_reporting_relationships";
    }
    if (opts.enableAuthRoleMappings) {
      this.authRoleMappingsTable = opts.authRoleMappingsTable ??
        "workforce_auth_role_mappings";
      this.authRoleMappingRolesTable = opts.authRoleMappingRolesTable ??
        "workforce_auth_role_mapping_roles";
      this.authRoleMappingPermissionsTable =
        opts.authRoleMappingPermissionsTable ??
          "workforce_auth_role_mapping_permissions";
    }
  }

  get personTable() {
    return this.peopleTable;
  }

  get routes() {
    return this.#routes;
  }

  assertManagementSession(s: UiServerStatements) {
    assertOriginalAccessActor(s);
    this.assertManagementPermission(s);
  }

  assertManagementPermission(s: PermissionAssertionStatements) {
    if (system.block(AuthBlock).opts.accessPolicy) {
      s.throwErrorIf(
        sql`${isAccessAdministrator()} is not true`,
        sql
          .lit`System administration is required to configure workforce access.`,
      );
      return;
    }
    if (!this.opts.managementPermission) {
      return;
    }
    s.throwErrorIf(
      sql`${
        currentUserHasPermission(sql.lit(this.opts.managementPermission))
      } is not true`,
      sql.lit`You do not have permission to manage workforce access.`,
    );
  }

  /** Called before and after person-specific writes, in the same transaction. */
  assertStaffPersonAccess(s: UiServerStatements, personId: Sql) {
    if (!system.block(AuthBlock).opts.accessPolicy) {
      this.assertManagementPermission(s);
      return;
    }
    s.block((s) => {
      s.defScalar("staff_target_person_id", personId);
      assertOriginalAccessActor(s);
      this.assertStaffPersonPermission(s, sql`staff_target_person_id`);
    });
  }

  /** Business policy shared by server procedures; UI writes also check the original session. */
  assertStaffPersonPermission(s: PermissionAssertionStatements, personId: Sql) {
    if (!system.block(AuthBlock).opts.accessPolicy) {
      this.assertManagementPermission(s);
      return;
    }
    s.throwErrorIf(
      sql`${canManageStaffAccess()} is not true`,
      sql.lit`You do not have permission to manage staff access.`,
    );
    const allowed = this.opts.assignableJobProfiles;
    const approved = allowed === undefined
      ? sql`job.id is not null`
      : allowed.length
      ? sql.inList(sql`job.code`, allowed.map(sql.lit))
      : sql.false;
    const assignmentJobProfile = this.positionsTable
      ? sql`coalesce(assignment.workforce_job_profile_id, (select workforce_job_profile_id from db.${
        sql.ref(this.positionsTable)
      } where id = assignment.workforce_position_id))`
      : sql`assignment.workforce_job_profile_id`;
    s.throwErrorIf(
      sql`not ${isAccessAdministrator()} and not exists (
        select 1 from db.${sql.ref(this.peopleTable)} person
        where person.id = ${personId}
          and exists (select 1 from db.sys_users linked_user where ${
        this.personSysUserJoin(sql`person`, sql`linked_user`)
      })
          and not exists (select 1 from db.sys_users linked_user
            where ${this.personSysUserJoin(sql`person`, sql`linked_user`)}
              and ${
        canManageStaffUser(sql`current_user`, sql`linked_user.id`)
      } is not true)
      )`,
      sql.lit`You cannot change your own access or a protected account.`,
    );
    s.throwErrorIf(
      sql`not ${isAccessAdministrator()} and exists (
        select 1 from db.${sql.ref(this.assignmentsTable)} assignment
        join db.${
        sql.ref(this.workerRelationshipsTable)
      } relationship on relationship.id = assignment.worker_relationship_id
        left join db.${
        sql.ref(this.jobProfilesTable)
      } job on job.id = ${assignmentJobProfile}
        where relationship.person_id = ${personId} and (${approved}) is not true
      )`,
      sql.lit`This person's job profile requires system administration.`,
    );
    if (this.authRoleMappingsTable) {
      // Consider every configured rule for these profiles, including inactive
      // and future rules. A future activation must not evade the ceiling.
      const roles = sql`select auth_role_id from db.${
        sql.ref(this.authRoleMappingRolesTable!)
      }
          where workforce_auth_role_mapping_id = mapping.id
          union select mapping.auth_role_id where mapping.auth_role_id is not null
            and not exists (select 1 from db.${
        sql.ref(this.authRoleMappingRolesTable!)
      }
              where workforce_auth_role_mapping_id = mapping.id)`;
      s.throwErrorIf(
        sql`not ${isAccessAdministrator()} and exists (
          select 1 from db.${sql.ref(this.authRoleMappingsTable)} mapping
          where (mapping.workforce_job_profile_id is null or exists (
            select 1 from db.${sql.ref(this.assignmentsTable)} assignment
            join db.${
          sql.ref(this.workerRelationshipsTable)
        } relationship on relationship.id = assignment.worker_relationship_id
            where relationship.person_id = ${personId} and ${assignmentJobProfile} = mapping.workforce_job_profile_id
          )) and (
            exists (select 1 from (${roles}) mapped_role where exists (
              select 1 from (${
          getRolePermissions(sql`mapped_role.auth_role_id`)
        }) granted
              where ${protectedAccessPermission(sql`granted.permission`)}
            )) or exists (
              select 1 from db.${
          sql.ref(this.authRoleMappingPermissionsTable!)
        } extra
              where extra.workforce_auth_role_mapping_id = mapping.id
              and ${protectedAccessPermission(sql`extra.permission`)}
            )
          )
        )`,
        sql
          .lit`This job profile can grant protected access and requires system administration.`,
      );
    }
  }

  syncPersonLoginState(s: ModifyStatements, personId: Sql) {
    syncWorkforcePersonLoginState(s, this, personId);
  }

  recordHref(path: string, id: NumericExpr) {
    const placeholder = "{record_id:id}";
    const placeholderIndex = path.indexOf(placeholder);
    if (placeholderIndex === -1) {
      return sql.concat(sql.lit(path.endsWith("/") ? path : `${path}/`), id);
    }
    return sql.concat(
      sql.lit(path.slice(0, placeholderIndex)),
      id,
      sql.lit(path.slice(placeholderIndex + placeholder.length)),
    );
  }

  personHref(id: NumericExpr) {
    return this.recordHref(this.#routes.personDetailPath, id);
  }

  // The active worker relationship as of today: the latest-starting open
  // relationship for the person.
  private relationshipFact(personRecord: Sql, columnExpr: Sql) {
    return sql`(
      select ${columnExpr}
      from db.${sql.ref(this.workerRelationshipsTable)} wf_wr
      where wf_wr.person_id = ${personRecord}.id
        and ${personRecord}.status = cast(${
      sql.lit(this.activePersonStatus)
    } as enums.workforce_person_status)
        and wf_wr.status = cast(${
      sql.lit(this.activeRelationshipStatus)
    } as enums.workforce_relationship_status)
        and wf_wr.effective_from <= current_date()
        and (wf_wr.effective_to is null or current_date() < wf_wr.effective_to)
      order by wf_wr.effective_from desc, wf_wr.id desc
      limit 1
    )`;
  }

  // The active primary assignment as of today, joined back to its active
  // worker relationship.
  private assignmentFact(personRecord: Sql, columnExpr: Sql) {
    return sql`(
      select ${columnExpr}
      from db.${sql.ref(this.assignmentsTable)} wf_a
      join db.${sql.ref(this.workerRelationshipsTable)} wf_wr
        on wf_wr.id = wf_a.worker_relationship_id
      where wf_wr.person_id = ${personRecord}.id
        and wf_wr.id = ${this.personCurrentWorkerRelationshipId(personRecord)}
        and wf_wr.effective_from <= current_date()
        and (wf_wr.effective_to is null or current_date() < wf_wr.effective_to)
        and wf_a.is_primary
        and wf_a.status = cast(${
      sql.lit(this.activeAssignmentStatus)
    } as enums.workforce_assignment_status)
        and wf_a.effective_from <= current_date()
        and (wf_a.effective_to is null or current_date() < wf_a.effective_to)
      order by wf_a.is_primary desc, wf_a.effective_from asc, wf_a.id asc
      limit 1
    )`;
  }

  currentPersonId() {
    return this.sysUserLink === "sys_user_field"
      ? sql`(select workforce_person_id from db.sys_users where id = current_user)`
      : sql`(select id from db.${
        sql.ref(this.peopleTable)
      } where sys_user_id = current_user)`;
  }

  personSysUserId(personRecord: Sql) {
    return this.sysUserLink === "sys_user_field"
      ? sql`(
        select id
        from db.sys_users
        where workforce_person_id = ${personRecord}.id
        limit 1
      )`
      : sql`${personRecord}.sys_user_id`;
  }

  personSysUserJoin(personRecord: Sql, sysUserRecord: Sql) {
    return this.sysUserLink === "sys_user_field"
      ? sql`${sysUserRecord}.workforce_person_id = ${personRecord}.id`
      : sql`${personRecord}.sys_user_id = ${sysUserRecord}.id`;
  }

  personDisplayName(personRecord: Sql) {
    return sql`${personRecord}.display_name`;
  }

  personEmail(personRecord: Sql) {
    return sql`${personRecord}.email`;
  }

  personPhone(personRecord: Sql) {
    return sql`${personRecord}.phone`;
  }

  personLanguage(personRecord: Sql) {
    return sql`${personRecord}.preferred_language`;
  }

  personStatus(personRecord: Sql) {
    return sql`${personRecord}.status`;
  }

  personCurrentWorkerRelationshipId(personRecord: Sql) {
    return this.relationshipFact(personRecord, sql`wf_wr.id`);
  }

  personWorkerType(personRecord: Sql) {
    return this.relationshipFact(personRecord, sql`wf_wr.worker_type`);
  }

  personRelationshipStatus(personRecord: Sql) {
    return this.relationshipFact(personRecord, sql`wf_wr.status`);
  }

  personEmployerOrganizationId(personRecord: Sql) {
    return this.relationshipFact(
      personRecord,
      sql`wf_wr.workforce_organization_id`,
    );
  }

  personHostOrganizationId(personRecord: Sql) {
    return this.assignmentFact(
      personRecord,
      sql`coalesce(wf_a.host_workforce_organization_id, wf_wr.workforce_organization_id)`,
    );
  }

  personPrimaryJobProfileId(personRecord: Sql) {
    return this.assignmentFact(
      personRecord,
      sql`wf_a.workforce_job_profile_id`,
    );
  }

  personPrimaryAssignmentStatus(personRecord: Sql) {
    return this.assignmentFact(personRecord, sql`wf_a.status`);
  }

  personPrimaryJobProfileDisplay(personRecord: Sql) {
    return sql`(
      select code
      from db.${sql.ref(this.jobProfilesTable)}
      where id = ${this.personPrimaryJobProfileId(personRecord)}
    )`;
  }

  personAccessEligible(personRecord: Sql) {
    return sql`${personRecord}.status = cast(${
      sql.lit(this.activePersonStatus)
    } as enums.workforce_person_status)
      and exists (
        select 1
        from db.${sql.ref(this.workerRelationshipsTable)} wf_wr
        join db.${sql.ref(this.assignmentsTable)} wf_a
          on wf_a.worker_relationship_id = wf_wr.id
        where wf_wr.person_id = ${personRecord}.id
          and wf_wr.status = cast(${
      sql.lit(this.activeRelationshipStatus)
    } as enums.workforce_relationship_status)
          and wf_wr.effective_from <= current_date()
          and (wf_wr.effective_to is null
            or current_date() < wf_wr.effective_to)
          and wf_a.is_primary
          and wf_a.status = cast(${
      sql.lit(this.activeAssignmentStatus)
    } as enums.workforce_assignment_status)
          and wf_a.effective_from <= current_date()
          and (wf_a.effective_to is null
            or current_date() < wf_a.effective_to)
      )`;
  }

  audienceMatchSql(args: { personRecord: Sql; audienceRecord: Sql }) {
    const person = args.personRecord;
    const audience = args.audienceRecord;
    // Relationship-level facets resolve against the active relationship.
    let match = sql`
      ${person}.status = cast(${
      sql.lit(this.activePersonStatus)
    } as enums.workforce_person_status)
      and (${audience}.worker_type is null
        or lower(${audience}.worker_type) = lower(${
      this.personWorkerType(person)
    }))
      and (${audience}.relationship_status is null
        or lower(${audience}.relationship_status) = lower(${
      this.personRelationshipStatus(person)
    }))
      and (${audience}.employer_workforce_organization_id is null
        or ${audience}.employer_workforce_organization_id = ${
      this.personEmployerOrganizationId(person)
    })`;
    // Assignment-level facets must all be satisfied by one active
    // assignment; when every assignment-level column is null there is no
    // assignment constraint (so all-null audiences match everyone).
    const assignmentColumns: Sql[] = [
      sql`${audience}.workforce_job_profile_id`,
      sql`${audience}.host_workforce_organization_id`,
      sql`${audience}.assignment_status`,
    ];
    let assignmentWhere = sql`
      (${audience}.workforce_job_profile_id is null
        or wf_a.workforce_job_profile_id = ${audience}.workforce_job_profile_id)
      and (${audience}.host_workforce_organization_id is null
        or coalesce(wf_a.host_workforce_organization_id, wf_wr.workforce_organization_id)
          = ${audience}.host_workforce_organization_id)
      and (${audience}.assignment_status is null
        or lower(wf_a.status) = lower(${audience}.assignment_status))`;
    if (this.orgUnitsTable) {
      assignmentColumns.push(sql`${audience}.workforce_org_unit_id`);
      assignmentWhere = sql`${assignmentWhere}
      and (${audience}.workforce_org_unit_id is null
        or wf_a.workforce_org_unit_id = ${audience}.workforce_org_unit_id)`;
    }
    if (this.locationsTable) {
      assignmentColumns.push(sql`${audience}.workforce_location_id`);
      assignmentWhere = sql`${assignmentWhere}
      and (${audience}.workforce_location_id is null
        or wf_a.workforce_location_id = ${audience}.workforce_location_id)`;
    }
    if (this.positionsTable) {
      assignmentColumns.push(sql`${audience}.workforce_position_id`);
      assignmentWhere = sql`${assignmentWhere}
      and (${audience}.workforce_position_id is null
        or wf_a.workforce_position_id = ${audience}.workforce_position_id)`;
    }
    const allAssignmentNull = assignmentColumns
      .map((column) => sql`${column} is null`)
      .reduce((a, b) => sql`${a} and ${b}`);
    match = sql`${match}
      and (
        (${allAssignmentNull})
        or exists (
          select 1
          from db.${sql.ref(this.assignmentsTable)} wf_a
          join db.${sql.ref(this.workerRelationshipsTable)} wf_wr
            on wf_wr.id = wf_a.worker_relationship_id
          where wf_wr.person_id = ${person}.id
            and wf_wr.id = ${this.personCurrentWorkerRelationshipId(person)}
            and wf_wr.status = cast(${
      sql.lit(this.activeRelationshipStatus)
    } as enums.workforce_relationship_status)
            and wf_wr.effective_from <= current_date()
            and (wf_wr.effective_to is null
              or current_date() < wf_wr.effective_to)
            and wf_a.effective_from <= current_date()
            and (wf_a.effective_to is null
              or current_date() < wf_a.effective_to)
            and wf_a.is_primary
            and wf_a.status = cast(${
      sql.lit(this.activeAssignmentStatus)
    } as enums.workforce_assignment_status)
            and ${assignmentWhere}
        )
      )`;
    return sql`(${match})`;
  }

  static get PeoplePage() {
    return WorkforcePeoplePage;
  }

  static get PersonDetailPage() {
    return WorkforcePersonDetailPage;
  }

  static get PersonManagement() {
    return WorkforcePersonManagement;
  }

  static get ReferenceDataPage() {
    return WorkforceReferenceDataPage;
  }

  static get AuthRoleRulesPage() {
    return WorkforceAuthRoleRulesPage;
  }

  static get PeopleImportAction() {
    return WorkforcePeopleImportAction;
  }

  static get StandardRoutes() {
    return WorkforceStandardRoutes;
  }

  static get DetailField() {
    return WorkforceDetailField;
  }

  initialize() {
    if (
      this.sysUserLink === "person_field" &&
      system.db.tables.sys_users === undefined
    ) {
      throw new Error(
        "WorkforceBlock requires the sys_users table. Add the AuthBlock before the WorkforceBlock so every person can link to a login.",
      );
    }

    system.enum_({ name: "workforce_worker_type", values: this.workerTypes });
    system.enum_({
      name: "workforce_person_status",
      values: this.personStatuses,
    });
    system.enum_({
      name: "workforce_relationship_status",
      values: this.relationshipStatuses,
    });
    system.enum_({
      name: "workforce_assignment_status",
      values: this.assignmentStatuses,
    });

    system.db.table(this.organizationsTable, (table) => {
      table.string("name", 200).notNull().unique();
      table.string("code", 80);
      table.string("organization_type", 100);
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.searchConfig({ fields: [{ field: "name", priority: 1 }] });
      this.opts.defineOrganizations?.(table);
    });

    if (this.orgUnitsTable) {
      system.db.table(this.orgUnitsTable, (table) => {
        table.fk("workforce_organization_id", this.organizationsTable)
          .notNull();
        table.fk("parent_org_unit_id", this.orgUnitsTable!);
        table.string("name", 200).notNull();
        table.string("code", 80);
        table.string("org_unit_type", 100);
        table.bool("is_active").notNull().default(sql`true`);
        table.recordDisplayName(["name"]);
        table.searchConfig({
          fields: [
            { field: "name", priority: 1 },
            { field: "code", priority: 2 },
          ],
        });
        this.opts.defineOrgUnits?.(table);
      });
    }

    if (this.locationsTable) {
      system.db.table(this.locationsTable, (table) => {
        table.string("name", 200).notNull();
        table.string("code", 80);
        table.fk("workforce_organization_id", this.organizationsTable);
        table.bool("is_active").notNull().default(sql`true`);
        table.unique(["workforce_organization_id", "code"]);
        table.recordDisplayName(["name"]);
        table.searchConfig({
          fields: [
            { field: "name", priority: 1 },
            { field: "code", priority: 2 },
          ],
        });
        this.opts.defineLocations?.(table);
      });
    }

    system.db.table(this.jobProfilesTable, (table) => {
      table.string("name", 150).notNull().unique();
      table.string("code", 100).notNull().unique();
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "code", priority: 2 },
        ],
      });
      this.opts.defineJobProfiles?.(table);
    });

    if (this.positionsTable) {
      system.db.table(this.positionsTable, (table) => {
        table.string("name", 200).notNull();
        table.string("code", 80);
        table.fk("workforce_organization_id", this.organizationsTable);
        if (this.orgUnitsTable) {
          table.fk("workforce_org_unit_id", this.orgUnitsTable);
        }
        if (this.locationsTable) {
          table.fk("workforce_location_id", this.locationsTable);
        }
        table.fk("workforce_job_profile_id", this.jobProfilesTable);
        table.bool("is_active").notNull().default(sql`true`);
        table.recordDisplayName(["name"]);
        table.searchConfig({
          fields: [
            { field: "name", priority: 1 },
            { field: "code", priority: 2 },
          ],
        });
        this.opts.definePositions?.(table);
      });
    }

    system.db.table(this.peopleTable, (table) => {
      if (this.sysUserLink === "person_field") {
        // The identity guarantee: every person, whatever their worker type or
        // job, points at exactly one sys_users row, so every action recorded
        // against a person id can be attributed to a specific user.
        table.fk("sys_user_id", "sys_users").notNull().unique();
      }
      table.string("display_name", 200).notNull();
      table.string("preferred_name", 200);
      table.email("email");
      table.string("phone", 40);
      table.string("preferred_language", 10).notNull().default(sql.lit`en`);
      table.enum("status", "workforce_person_status").notNull().default(
        sql.lit(this.activePersonStatus),
      );
      table.timestamp("created_at").notNull().default(sql`current_timestamp()`);
      table.recordDisplayName(["display_name"]);
      table.searchConfig({
        fields: [
          { field: "display_name", priority: 1 },
          { field: "email", priority: 2 },
        ],
      });
      this.opts.definePeople?.(table);
    });

    system.db.table(this.workerRelationshipsTable, (table) => {
      table.fk("person_id", this.peopleTable).notNull();
      table.fk("workforce_organization_id", this.organizationsTable).notNull();
      table.enum("worker_type", "workforce_worker_type").notNull().default(
        sql.lit(this.workerTypes[0].name),
      );
      table.enum("status", "workforce_relationship_status").notNull().default(
        sql.lit(this.activeRelationshipStatus),
      );
      table.date("effective_from").notNull().default(sql`current_date()`);
      table.date("effective_to");
      table.string("external_worker_id", 100);
      table.recordDisplayName(
        ["person_id", "worker_type", "effective_from", "effective_to"],
        (personId, workerType, effectiveFrom, effectiveTo) =>
          sql`coalesce(
            (
              select person.display_name
              from db.${sql.ref(this.peopleTable)} person
              where person.id = ${personId}
            ),
            'Person #' || cast(${personId} as string)
          ) || ' · ' || cast(${workerType} as string) || ' · ' ||
          cast(${effectiveFrom} as string) ||
          case
            when ${effectiveTo} is null then ' onward'
            else ' to ' || cast(${effectiveTo} as string)
          end`,
      );
      table.searchConfig({
        fields: [{ field: "external_worker_id", priority: 2 }],
        relatedTables: [
          {
            table: this.peopleTable,
            relationField: `${this.workerRelationshipsTable}.person_id`,
            fields: [{ field: "display_name", priority: 1 }],
          },
        ],
      });
      if (!this.opts.allowMultipleActiveRelationships) {
        // Open-ended only: a static partial index cannot reference
        // current_date(), so this guards against multiple open relationships
        // (the common case). Two relationships both end-dated in the future
        // are not caught here; the provider's current-fact helpers still
        // resolve to a single relationship deterministically.
        table.unique({
          fields: ["person_id"],
          where: "effective_to is null",
        });
      }
      table.check({
        fields: ["effective_from", "effective_to"],
        errorMessage: () =>
          sql.lit`Relationship end date must be after start date.`,
        check: ([effectiveFrom, effectiveTo]) =>
          sql`${effectiveTo} is null or ${effectiveTo} > ${effectiveFrom}`,
      });
      this.opts.defineWorkerRelationships?.(table);
    });

    system.db.table(this.assignmentsTable, (table) => {
      table.fk("worker_relationship_id", this.workerRelationshipsTable)
        .notNull();
      table.fk("host_workforce_organization_id", this.organizationsTable);
      table.fk("workforce_job_profile_id", this.jobProfilesTable);
      if (this.positionsTable) {
        table.fk("workforce_position_id", this.positionsTable);
      }
      if (this.orgUnitsTable) {
        table.fk("workforce_org_unit_id", this.orgUnitsTable);
      }
      if (this.locationsTable) {
        table.fk("workforce_location_id", this.locationsTable);
      }
      table.bool("is_primary").notNull().default(sql`false`);
      table.enum("status", "workforce_assignment_status").notNull().default(
        sql.lit(this.activeAssignmentStatus),
      );
      table.date("effective_from").notNull().default(sql`current_date()`);
      table.date("effective_to");
      if (!this.opts.allowMultipleActivePrimaryAssignments) {
        // Open-ended only (see worker-relationship note above): guards
        // against more than one open primary assignment per relationship.
        // Future end-dated primaries are not caught; the primary-assignment
        // provider facts still tiebreak deterministically.
        table.unique({
          fields: ["worker_relationship_id"],
          where: "is_primary and effective_to is null",
        });
      }
      table.check({
        fields: ["effective_from", "effective_to"],
        errorMessage: () =>
          sql.lit`Assignment end date must be after start date.`,
        check: ([effectiveFrom, effectiveTo]) =>
          sql`${effectiveTo} is null or ${effectiveTo} > ${effectiveFrom}`,
      });
      table.check({
        fields: this.positionsTable
          ? ["workforce_job_profile_id", "workforce_position_id"]
          : ["workforce_job_profile_id"],
        errorMessage: () =>
          sql.lit`Assignment must reference a job profile or position.`,
        check: ([jobProfileId, positionId]) =>
          this.positionsTable
            ? sql`${jobProfileId} is not null or ${positionId} is not null`
            : sql`${jobProfileId} is not null`,
      });
      this.opts.defineAssignments?.(table);
    });

    if (this.reportingRelationshipsTable) {
      system.db.table(this.reportingRelationshipsTable, (table) => {
        table.fk("worker_relationship_id", this.workerRelationshipsTable)
          .notNull();
        table.fk(
          "manager_worker_relationship_id",
          this.workerRelationshipsTable,
        ).notNull();
        table.string("relationship_type", 100).notNull();
        table.date("effective_from").notNull().default(sql`current_date()`);
        table.date("effective_to");
        table.bool("is_active").notNull().default(sql`true`);
        table.check({
          fields: ["effective_from", "effective_to"],
          errorMessage: () =>
            sql.lit`Reporting relationship end date must be after start date.`,
          check: ([effectiveFrom, effectiveTo]) =>
            sql`${effectiveTo} is null or ${effectiveTo} > ${effectiveFrom}`,
        });
        table.check({
          fields: ["worker_relationship_id", "manager_worker_relationship_id"],
          errorMessage: () =>
            sql.lit`A worker relationship cannot report to itself.`,
          check: ([workerRelationshipId, managerWorkerRelationshipId]) =>
            sql`${workerRelationshipId} != ${managerWorkerRelationshipId}`,
        });
        this.opts.defineReportingRelationships?.(table);
      });
    }

    if (this.authRoleMappingsTable) {
      system.db.table(this.authRoleMappingsTable, (table) => {
        table.enum("worker_type", "workforce_worker_type");
        table.fk(
          "employer_workforce_organization_id",
          this.organizationsTable,
        );
        table.fk("host_workforce_organization_id", this.organizationsTable);
        table.fk("workforce_job_profile_id", this.jobProfilesTable);
        if (this.orgUnitsTable) {
          table.fk("workforce_org_unit_id", this.orgUnitsTable);
        }
        if (this.locationsTable) {
          table.fk("workforce_location_id", this.locationsTable);
        }
        table.fk("auth_role_id", "auth_roles");
        table.date("effective_from");
        table.date("effective_to");
        table.bool("is_active").notNull().default(sql`true`);
        table.check({
          fields: ["effective_from", "effective_to"],
          errorMessage: () =>
            sql.lit`Auth role mapping end date must be after start date.`,
          check: ([effectiveFrom, effectiveTo]) =>
            sql`${effectiveFrom} is null or ${effectiveTo} is null or ${effectiveTo} > ${effectiveFrom}`,
        });
        this.opts.defineAuthRoleMappings?.(table);
      });
      system.db.table(this.authRoleMappingRolesTable!, (table) => {
        table.fk("workforce_auth_role_mapping_id", this.authRoleMappingsTable!)
          .notNull();
        table.fk("auth_role_id", "auth_roles").notNull();
        table.unique(["workforce_auth_role_mapping_id", "auth_role_id"]);
        this.opts.defineAuthRoleMappingRoles?.(table);
      });
      system.db.table(this.authRoleMappingPermissionsTable!, (table) => {
        table.fk("workforce_auth_role_mapping_id", this.authRoleMappingsTable!)
          .notNull();
        table.enum("permission", "auth_permission").notNull();
        table.unique(["workforce_auth_role_mapping_id", "permission"]);
        this.opts.defineAuthRoleMappingPermissions?.(table);
      });
      system.addReactor({
        name: "workforce_auth_rule_reconciliation",
        query: sql`
          select 1 as id
          where ${workforceAuthRuleReconciliationNeeded(this)}
        `,
        recordName: "reactor",
        procedure: (s) => {
          s.if(sql`reactor.id = 1`, (s) => {
            s.startTransaction();
            syncWorkforceLoginStates(s, this);
            reconcileWorkforceAuthRules(s, this);
            s.commitTransaction();
          });
        },
      });
    }
  }

  populate() {
    if (this.disableLoginWhenAccessIneligible) {
      system.storedProcedure({
        name: "workforce_sync_person_login_state",
        transaction: "caller",
        inputScalars: [{ name: "p_person_id", type: "BigInt" }],
        procedure: (s) =>
          syncWorkforcePersonLoginStateStatements(s, this, sql`p_person_id`),
      });
      system.storedProcedure({
        name: "workforce_sync_login_states",
        transaction: "caller",
        procedure: (s) => syncWorkforceLoginStatesStatements(s, this),
      });
    }
    if (!this.authRoleMappingsTable) {
      return;
    }
    registerWorkforceAuthRuleSaveProcedure(this);
    system.storedProcedure({
      name: WORKFORCE_AUTH_RECONCILIATION_PROCEDURE,
      transaction: "caller",
      procedure: (s) => reconcileWorkforceAuthRulesStatements(s, this),
    });
  }
}
