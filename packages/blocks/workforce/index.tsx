import { locationPaths } from "blocks/locations/queries";
import { LocationsBlock } from "blocks/locations";
import {
  registerWorkforceEndRelationship,
  WorkforceRelationshipEndAction,
} from "./relationship_end";
import { WorkforceOrgUnitHierarchy } from "./org_units";
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
import { AutoUpdateMenuItem } from "components/auto_update_dialog";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { Checkbox } from "components/checkbox";
import { DataTable } from "components/data_table";
import { EachSelect } from "components/each_select";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import type { IconName } from "components/material_icon_names";
import { ModalDialog } from "components/modal";
import { PageHeader, PageTitleHeader } from "components/page_header";
import { Select } from "components/select";
import { Snackbar } from "components/snackbar";
import { Tabs } from "components/tabs";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form } from "std/form";
import { DatagridPage } from "pages/datagrid";
import { RecordWithTabsAndDetailPage } from "pages/record_with_tabs_and_detail";
import { Each, Match, Route, Switch, useUniqueId } from "std/ui";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import { WorkforcePeopleImportAction } from "./people_import";
import {
  registerWorkforceAuthRuleSaveProcedure,
  registerWorkforceIntervalValidation,
  registerWorkforceOrgUnitValidation,
} from "./stored_procedures";
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
 * The people, worker-relationships, job-profiles, and assignments tables are
 * always present. Organizations are omitted for an implicit single employer.
 * Org units, locations, positions, reporting, and auth-role mappings are opt-in.
 * A provider
 * advertises them by exposing the matching table name (and accessors), and
 * consumers must gate audience foreign keys and UI on that presence.
 * `audienceMatchSql` only references audience columns for facets the
 * provider advertises, plus the always-present worker type, relationship
 * status, job profile, and assignment status.
 *
 * Every person resolves to exactly one `sys_users` row via
 * `personSysUserId`, so anything recorded against a person id can always be
 * attributed to a specific user. The usual way to satisfy this contract is
 * `WorkforceBlock` itself - with enable flags, custom table names, enum
 * values, and `define` hooks - rather than re-implementing the interface.
 */
export interface WorkforceProvider {
  personTable: string;
  organizationsTable?: string;
  workerRelationshipsTable: string;
  jobProfilesTable: string;
  assignmentsTable: string;
  orgUnitsTable?: string;
  locationsTable?: string;
  /** Location IDs and hierarchy labels; inactive locations are omitted by default. */
  locationOptions?(opts?: { includeInactive?: boolean }): Sql;
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
  /** Uses a configured organization name without organization tables or foreign keys. Omit to allow multiple organizations. */
  singleOrganization?: string;
  workerRelationshipsTable?: string;
  jobProfilesTable?: string;
  assignmentsTable?: string;
  /** Adds the recursive org-unit hierarchy table and assignment fk. */
  enableOrgUnits?: boolean;
  /** Shared physical locations. Register this instance before workforce. */
  locations?: LocationsBlock;
  /** Adds the positions table (concrete seats) and assignment fk. */
  enablePositions?: boolean;
  /** Adds the effective-dated reporting-relationship table. */
  enableReporting?: boolean;
  /** Adds the workforce-facts-to-auth-role mapping table. */
  enableAuthRoleMappings?: boolean;
  /**
   * Shows guided New relationship and Change assignment actions on the person
   * detail page. Off by default so systems opt into workforce-history writes
   * deliberately.
   */
  enableRelationshipAndAssignmentCreation?: boolean;
  /** Shows Add actions on the workforce reference-data page. */
  enableReferenceDataCreation?: boolean;
  /** Server-side permission required by every block-owned management mutation. */
  managementPermission?: string;
  /** Optional SQL predicate over a job-profile record. Protected access mappings are always excluded. */
  assignableJobProfiles?: (jobProfile: Sql) => Sql;
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
  defineWorkerRelationships?: (table: TableBuilder) => void;
  defineJobProfiles?: (table: TableBuilder) => void;
  definePositions?: (table: TableBuilder) => void;
  defineAssignments?: (table: TableBuilder) => void;
  /** Optional system-owned validation for extended assignment fields, run inside form transactions. */
  validatePersonAssignments?: (
    s: {
      callStoredProcedure(
        name: string,
        opts?: CallStoredProcedureOpts,
      ): unknown;
    },
    personId: Sql,
  ) => void;
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
  /** @deprecated Optional fields are now collapsed for all callers. */
  compact?: boolean;
  defaultLanguage?: Sql | string;
  languageOptions?: Array<{ code: string; name: string }>;
  /** Allows creation of an enabled portal login; otherwise its identity is disabled. */
  allowPortalLogin?: boolean;
  defaultCreateLogin?: boolean;
  defaultWorkerType?: string;
  /** Fixed values for fields added through `definePeople`. */
  extraPersonValues?: Record<string, Sql>;
  /** Fixed values for fields added through `defineWorkerRelationships`. */
  extraWorkerRelationshipValues?: Record<string, Sql>;
  /** Fixed values for fields added through `defineAssignments`. */
  extraAssignmentValues?: Record<string, Sql>;
}

const workforceAuthRuleSource = sql.lit`workforce_auth_role_mapping`;

interface ModifyStatements {
  modify(sql: Sql): unknown;
  callStoredProcedure(name: string, opts?: CallStoredProcedureOpts): unknown;
}

interface PermissionAssertionStatements {
  throwErrorIf(condition: BooleanExpr, message: Sql): unknown;
}

export function workforceAuthMappingMatchSql(args: {
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
    and (${mappingRecord}.workforce_job_profile_id is null
      or ${mappingRecord}.workforce_job_profile_id = ${
    workforce.personPrimaryJobProfileId!(personRecord)
  })`;
  if (workforce.organizationsTable) {
    match = sql`${match}
    and (${mappingRecord}.employer_workforce_organization_id is null
      or ${mappingRecord}.employer_workforce_organization_id = ${
      workforce.personEmployerOrganizationId!(personRecord)
    })
    and (${mappingRecord}.host_workforce_organization_id is null
      or ${mappingRecord}.host_workforce_organization_id = ${
      workforce.personHostOrganizationId!(personRecord)
    })
`;
  }
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
    join db.${sql.ref(workforce.authRoleMappingRolesTable!)} mapped_role
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
  // Access revocation must not depend on repairing historical workforce data.
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
    { code: "es", name: "Spanish" },
  ];
  const allowPortalLogin = props.allowPortalLogin ?? false;
  const portalLoginId = useUniqueId();
  const createLogin = allowPortalLogin
    ? sql`ui.workforce_new_login.create_login`
    : sql.false;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("workforce_add_person_open", false);
        s.defScalar("workforce_add_person_message", { type: "String" });
      }}
    >
      <Button
        startIcon="PersonAdd"
        onClick={(s) => s.setScalar("workforce_add_person_open", true)}
      >
        Add person
      </Button>
      <Show when={sql`workforce_add_person_message is not null`}>
        <Snackbar
          color="success"
          variant="soft"
          startIcon="CheckCircle"
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          onMount={(s) => {
            s.sleep(4000);
            s.setScalar("workforce_add_person_message", sql.null);
          }}
        >
          {sql`workforce_add_person_message`}
        </Snackbar>
      </Show>
      <ModalDialog
        bindScalar="workforce_add_person_open"
        aria-label="Add person"
        layout="center"
        sx={{
          width: "min(720px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          padding: "24px",
        }}
      >
        <Typography level="title-lg" startIcon="PersonAdd">
          Add person
        </Typography>
        <Typography level="body-sm" className="text-secondary mt-1 mb-4">
          {workforce.organizationMode === "single"
            ? "Start with their name and job. Employment starts today with active status."
            : "Start with their name, company, and job. Employment starts today with active status."}
        </Typography>
        <Form
          defaultFieldComponent={LabelOnTopFormField}
          beforeSubmitClient={(s, ctx) => {
            s.if(
              sql`nullif(trim(workforce_new_person.display_name), '') is null`,
              (s) => {
                ctx.record("workforce_new_person").field("display_name")
                  .setError(s, sql.lit`Enter a name.`);
              },
            );
            s.if(
              workforce.positionsTable
                ? sql`workforce_new_assignment.workforce_job_profile_id is null and workforce_new_assignment.workforce_position_id is null`
                : sql`workforce_new_assignment.workforce_job_profile_id is null`,
              (s) => {
                ctx.record("workforce_new_assignment").field(
                  "workforce_job_profile_id",
                ).setError(s, sql.lit`Select a job or position.`);
              },
            );
            s.if(
              sql`${createLogin} and nullif(trim(workforce_new_person.email), '') is null`,
              (s) => {
                ctx.record("workforce_new_person").field("email").setError(
                  s,
                  sql.lit`Email is required for a portal login.`,
                );
              },
            );
            if (allowPortalLogin) {
              s.if(
                sql`${createLogin} and nullif(workforce_new_login.password, '') is not null and length(workforce_new_login.password) < 8`,
                (s) => {
                  ctx.record("workforce_new_login").field("password").setError(
                    s,
                    sql
                      .lit`Use at least 8 characters, or leave blank for email password setup.`,
                  );
                },
              );
            }
          }}
          afterTransactionStart={(s) => {
            workforce.assertManagementSession(s);
            s.modify(sql`update ui.workforce_new_person
              set display_name = trim(display_name),
                  email = nullif(trim(email), ''),
                  phone = nullif(trim(phone), '')`);
            s.throwErrorIf(
              sql`nullif(ui.workforce_new_person.display_name, '') is null`,
              sql.lit`Enter a name.`,
            );
            s.throwErrorIf(
              workforce.positionsTable
                ? sql`ui.workforce_new_assignment.workforce_job_profile_id is null and ui.workforce_new_assignment.workforce_position_id is null`
                : sql`ui.workforce_new_assignment.workforce_job_profile_id is null`,
              sql.lit`Select a job or position.`,
            );
            s.throwErrorIf(
              sql`${createLogin} and nullif(trim(ui.workforce_new_person.email), '') is null`,
              sql.lit`Email is required for a portal login.`,
            );
            s.defScalar("workforce_new_sys_user_id", { type: "BigInt" });
            const insertIdentity = (s: UiServerStatements) => {
              // Keep the person's attribution identity without allowing self-setup or sign-in.
              s.modify(sql`insert into db.sys_users (created_at, disabled)
                values (current_timestamp(), not ${createLogin})
                returning id into workforce_created_sys_user_id`);
              s.setScalar(
                "workforce_new_sys_user_id",
                sql`workforce_created_sys_user_id`,
              );
            };
            if (allowPortalLogin) {
              s.if(
                sql`${createLogin} and nullif(ui.workforce_new_login.password, '') is not null`,
                (s) => {
                  s.throwErrorIf(
                    sql`length(ui.workforce_new_login.password) < 8`,
                    sql.lit`Temporary password must be at least 8 characters.`,
                  );
                  insertUserWithPassword(s, {
                    password: sql`ui.workforce_new_login.password`,
                    mustChangePassword: sql.true,
                    idScalar: "workforce_created_sys_user_id",
                  });
                  s.setScalar(
                    "workforce_new_sys_user_id",
                    sql`workforce_created_sys_user_id`,
                  );
                },
                insertIdentity,
              );
            } else {
              insertIdentity(s);
            }
          }}
          beforeTransactionCommit={(s) => {
            if (workforce.sysUserLink === "sys_user_field") {
              s.modify(sql`update db.sys_users
                set workforce_person_id = last_record_id(${
                sql.ref(workforce.peopleTable)
              })
                where id = workforce_new_sys_user_id`);
            }
            workforce.validatePersonIntervals(
              s,
              sql`last_record_id(${sql.ref(workforce.peopleTable)})`,
            );
            workforce.opts.validatePersonAssignments?.(
              s,
              sql`last_record_id(${sql.ref(workforce.peopleTable)})`,
            );
            syncWorkforcePersonAccess(
              s,
              workforce,
              sql`last_record_id(${sql.ref(workforce.peopleTable)})`,
            );
          }}
          afterSubmitClientSuccess={(s) => {
            s.setScalar(
              "workforce_add_person_message",
              sql.lit`Person created.`,
            );
            s.setScalar("workforce_add_person_open", false);
          }}
        >
          <Form.Insert
            table={workforce.peopleTable}
            stateName="workforce_new_person"
            values={{
              status: sql.lit(workforce.activePersonStatus),
              ...(workforce.sysUserLink === "person_field"
                ? { sys_user_id: sql`workforce_new_sys_user_id` }
                : {}),
              ...props.extraPersonValues,
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Form.Field field="display_name">
                <LabelOnTopFormField label="Full name" />
              </Form.Field>
              <Form.Field field="email" />
              <Form.Field
                field="preferred_language"
                initialValue={defaultLanguage}
              >
                {(field) => (
                  <FormControl>
                    <FormLabel>Preferred language</FormLabel>
                    <Select
                      aria-label="Preferred language"
                      fullWidth
                      value={field.value}
                      onInput={(s) => field.setValue(s, sql`target_value`)}
                    >
                      {languageOptions.map((language) => (
                        <Select.Option value={language.code}>
                          {language.name}
                        </Select.Option>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Form.Field>
              <Form.Field field="phone" />
            </div>
            <Form.Relation
              table={workforce.workerRelationshipsTable}
              stateName="workforce_new_relationship"
              field="person_id"
              many={false}
              values={{
                effective_from: sql`current_date()`,
                status: sql.lit(workforce.activeRelationshipStatus),
                ...props.extraWorkerRelationshipValues,
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                {workforce.organizationsTable && (
                  <Form.Field
                    field="workforce_organization_id"
                    initialValue={sql`(select min(id) from db.${
                      sql.ref(workforce.organizationsTable)
                    } where is_active having count(*) = 1)`}
                  >
                    <LabelOnTopFormField
                      label="Company"
                      where={sql`is_active`}
                    />
                  </Form.Field>
                )}
                <Form.Field
                  field="worker_type"
                  initialValue={sql.lit(
                    props.defaultWorkerType ?? workforce.workerTypes[0].name,
                  )}
                />
              </div>
              <Form.Relation
                table={workforce.assignmentsTable}
                stateName="workforce_new_assignment"
                field="worker_relationship_id"
                many={false}
                values={{
                  effective_from: sql`current_date()`,
                  is_primary: sql.true,
                  status: sql.lit(workforce.activeAssignmentStatus),
                  ...props.extraAssignmentValues,
                }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                  <Form.Field field="workforce_job_profile_id">
                    <LabelOnTopFormField label="Job" where={sql`is_active`} />
                  </Form.Field>
                  {workforce.positionsTable && (
                    <Form.Field field="workforce_position_id" />
                  )}
                </div>
                {(workforce.organizationsTable || workforce.orgUnitsTable ||
                  workforce.locationsTable) && (
                  <details className="mt-3 rounded border border-divider">
                    <summary className="cursor-pointer select-none rounded bg-neutral-soft px-4 py-3 text-sm font-semibold hover:bg-neutral-soft-hover">
                      Assignment details
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-divider p-4">
                      {workforce.organizationsTable && (
                        <Form.Field field="host_workforce_organization_id">
                          <LabelOnTopFormField
                            label="Host company"
                            helperText="Leave blank to use the company above."
                          />
                        </Form.Field>
                      )}
                      {workforce.orgUnitsTable && (
                        <Form.Field field="workforce_org_unit_id" />
                      )}
                      {workforce.locationsTable && (
                        <Form.Field field="workforce_location_id" />
                      )}
                    </div>
                  </details>
                )}
              </Form.Relation>
            </Form.Relation>
          </Form.Insert>
          {allowPortalLogin && (
            <Form.Temporary name="workforce_new_login">
              <div className="border-t border-divider pt-4 mt-4">
                <Form.Field
                  field="create_login"
                  fieldType="Bool"
                  initialValue={props.defaultCreateLogin ?? true}
                >
                  {(field) => (
                    <Checkbox
                      id={portalLoginId}
                      label="Create portal login"
                      checked={field.value}
                      onCheckboxChange={(s) =>
                        field.setValue(s, sql`target_checked`)}
                    />
                  )}
                </Form.Field>
                <Typography level="body-sm" className="text-secondary mt-2">
                  When unchecked, sign-in and password setup are disabled. You
                  can enable access later from the person's login settings.
                </Typography>
                <Show when={sql`workforce_new_login.create_login`}>
                  <Typography level="body-sm" className="mt-2">
                    Leave the password blank to let the person set it through
                    the portal's email password setup. No email is sent by this
                    form.
                  </Typography>
                  <details className="mt-3 rounded border border-divider">
                    <summary className="cursor-pointer select-none rounded bg-neutral-soft px-4 py-3 text-sm font-semibold hover:bg-neutral-soft-hover">
                      Set a temporary password instead
                    </summary>
                    <div className="border-t border-divider p-4">
                      <Form.Field
                        field="password"
                        fieldType={{ type: "String", maxLength: 1024 }}
                        initialValue={sql.lit``}
                      >
                        {(field) => (
                          <FormControl>
                            <FormLabel>Temporary password</FormLabel>
                            <Input
                              type="password"
                              value={field.value}
                              onInput={(s) =>
                                field.setValue(s, sql`target_value`)}
                            />
                            <Show when={field.hasError}>
                              <Typography level="body-sm" color="danger">
                                {field.error}
                              </Typography>
                            </Show>
                          </FormControl>
                        )}
                      </Form.Field>
                    </div>
                  </details>
                </Show>
              </div>
            </Form.Temporary>
          )}
          <Form.ErrorAlert className="mt-4" mode="all" />
          <div className="flex justify-end gap-3 border-t border-divider pt-4 mt-4">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("workforce_add_person_open", false)}
            >
              Cancel
            </Button>
            <Form.SubmitButton>Create person</Form.SubmitButton>
          </div>
        </Form>
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
    `;
  if (!workforce.authRoleMappingsTable) {
    return (
      <Alert color="warning" startIcon="Warning">
        Enable auth role mappings on WorkforceBlock to manage workforce access
        rules.
      </Alert>
    );
  }
  const reviewCheckboxId = useUniqueId();
  const facets = [
    ["workforce_job_profile_id", "Job"],
    ...(workforce.organizationsTable
      ? [
        ["employer_workforce_organization_id", "Employer company"],
        ["host_workforce_organization_id", "Host company"],
      ]
      : []),
    ...(hasOrgUnits ? [["workforce_org_unit_id", "Org unit"]] : []),
    ...(hasLocations ? [["workforce_location_id", "Location"]] : []),
  ];
  const draftVersion = sql`concat(
    ${
    [
      "worker_type",
      ...facets.map(([field]) => field),
      "effective_from",
      "effective_to",
      "is_active",
    ].map((field) =>
      sql`coalesce(cast(${
        sql.ref(`ui.workforce_rule_draft.${field}`)
      } as string), '<empty>') || '|'`
    )
  },
    coalesce((select string_agg(auth_role_id::string, ',' order by auth_role_id) from ui.workforce_auth_rule_selected_roles), ''), '|',
    coalesce((select string_agg(permission, ',' order by permission) from ui.workforce_auth_rule_selected_permissions), '')
  )`;
  const draftActiveToday = sql`ui.workforce_rule_draft.is_active
    and (try_cast(ui.workforce_rule_draft.effective_from as date) is null or try_cast(ui.workforce_rule_draft.effective_from as date) <= current_date())
    and (try_cast(ui.workforce_rule_draft.effective_to as date) is null or current_date() < try_cast(ui.workforce_rule_draft.effective_to as date))`;
  return (
    <Data
      queryParams={{ rule_id: { type: "BigInt", default: sql.null } }}
      local
      procedure={(s) => {
        s.defScalar("workforce_auth_rule_open", sql`false`);
        s.defScalar("workforce_auth_rule_permissions_visible", sql`false`);
        s.defScalar("workforce_auth_selected_rule_id", sql.lit``);
        s.defScalar("workforce_auth_rule_reviewed", { type: "String" });
        s.defTable("workforce_auth_rule_selected_roles", {
          fields: [
            { name: "auth_role_id", type: "BigInt" },
            { name: "name", type: "String" },
          ],
        });
        s.defTable("workforce_auth_rule_selected_permissions", {
          fields: [{ name: "permission", type: "String" }],
        });
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
                  s.setScalar("workforce_auth_selected_rule_id", sql.lit``);
                  s.modify(
                    sql`delete from ui.workforce_auth_rule_selected_roles`,
                  );
                  s.modify(
                    sql`delete from ui.workforce_auth_rule_selected_permissions`,
                  );
                  s.setScalar("workforce_auth_rule_reviewed", sql.null);
                  s.setScalar(
                    "workforce_auth_rule_permissions_visible",
                    sql`false`,
                  );
                  s.setScalar("workforce_auth_rule_open", sql`true`);
                }}
              >
                Add rule
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Show when={sql`rule_id is not null`}>
              <Button variant="plain" href={workforce.routes.authRoleRulesPath}>
                Show all rules
              </Button>
            </Show>
            <DataTable
              query={sql`
              select mapping.id,
                     mapping.worker_type as rule_worker_type,
                     ${
                workforce.organizationsTable
                  ? sql`mapping.employer_workforce_organization_id,
                     mapping.host_workforce_organization_id,`
                  : sql``
              }
                     mapping.workforce_job_profile_id,
                     ${
                hasOrgUnits ? sql`mapping.workforce_org_unit_id,` : sql``
              }
                     ${
                hasLocations ? sql`mapping.workforce_location_id,` : sql``
              }
                     coalesce((
                       select string_agg(role.name, ', ' order by role.name)
                       from db.${
                sql.ref(workforce.authRoleMappingRolesTable!)
              } mapped_role
                       join db.auth_roles role on role.id = mapped_role.auth_role_id
                       where mapped_role.workforce_auth_role_mapping_id = mapping.id
                     ), 'Direct permissions') as auth_roles,
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
                     coalesce(fn.display_workforce_worker_type(mapping.worker_type), 'Any type') as worker_type,
                     coalesce(job.name, 'Any job') as job_profile,
                     ${
                workforce.organizationsTable
                  ? sql`coalesce(employer.name, 'Any employer') as employer,
                     coalesce(host.name, 'Any host') as host,`
                  : sql``
              }
                     ${
                hasOrgUnits
                  ? sql`coalesce(unit.name, 'Any org unit') as org_unit,`
                  : sql``
              }
                     ${
                hasLocations
                  ? sql`coalesce(location.path, 'Any location') as location,`
                  : sql``
              }
                     case when not mapping.is_active then 'Inactive' when mapping.effective_from > current_date() then 'Scheduled' when mapping.effective_to <= current_date() then 'Expired' else 'Active' end as status, mapping.effective_from, mapping.effective_to
              from db.${sql.ref(workforce.authRoleMappingsTable!)} mapping
              left join db.${sql.ref(workforce.jobProfilesTable)} job
                on job.id = mapping.workforce_job_profile_id
              ${
                workforce.organizationsTable
                  ? sql`left join db.${
                    sql.ref(workforce.organizationsTable)
                  } employer
                on employer.id = mapping.employer_workforce_organization_id
              left join db.${sql.ref(workforce.organizationsTable)} host
                on host.id = mapping.host_workforce_organization_id`
                  : sql``
              }
              ${
                hasOrgUnits
                  ? sql`left join db.${sql.ref(workforce.orgUnitsTable!)} unit
                on unit.id = mapping.workforce_org_unit_id`
                  : sql``
              }
              ${
                hasLocations
                  ? sql`left join (${locationPaths()}) location
                on location.id = mapping.workforce_location_id`
                  : sql``
              }
              where (rule_id is null or mapping.id = rule_id) and (exists (
                select 1
                from db.${sql.ref(workforce.authRoleMappingRolesTable!)}
                where workforce_auth_role_mapping_id = mapping.id
              ) or exists (
                select 1 from db.${
                sql.ref(workforce.authRoleMappingPermissionsTable!)
              }
                where workforce_auth_role_mapping_id = mapping.id
              ))
              order by case when mapping.is_active then 0 else 1 end,
                       auth_roles
            `}
              recordName="rule"
              pageSize={8}
              minColumnWidth={220}
              emptyState="No workforce access rules to show. Add a rule to grant access from employment details, or adjust your search."
              searchable={[
                "auth_roles",
                "worker_type",
                "job_profile",
                ...(workforce.organizationsTable ? ["employer", "host"] : []),
                ...(hasOrgUnits ? ["org_unit"] : []),
                ...(hasLocations ? ["location"] : []),
                "status",
              ]}
              columns={(b) => {
                b.column(
                  "Grants",
                  ({ record }) => (
                    <div className="flex flex-col gap-1 py-1">
                      <Typography level="title-sm">
                        {sql`${record}.auth_roles`}
                      </Typography>
                      <Typography level="body-xs">
                        {sql`${record}.permissions`}
                      </Typography>
                    </div>
                  ),
                  { width: "30%" },
                );
                b.column(
                  "Matches all criteria",
                  ({ record }) => (
                    <div className="flex flex-col gap-1 py-1">
                      <Typography level="body-sm">
                        {sql`${record}.worker_type || ' · ' || ${record}.job_profile`}
                      </Typography>
                      {workforce.organizationsTable && (
                        <Typography level="body-xs">
                          {sql`${record}.employer || ' · ' || ${record}.host`}
                        </Typography>
                      )}
                      {hasOrgUnits && (
                        <Typography level="body-xs">
                          {sql`${record}.org_unit`}
                        </Typography>
                      )}
                      {hasLocations && (
                        <Typography level="body-xs">
                          {sql`${record}.location`}
                        </Typography>
                      )}
                    </div>
                  ),
                  { width: "45%" },
                );
                b.column(
                  "Status / dates",
                  ({ record }) => (
                    <div className="flex flex-col gap-1 py-1">
                      <Chip size="sm" variant="soft">
                        {sql`${record}.status`}
                      </Chip>
                      <Typography level="body-xs">
                        {sql`coalesce(cast(${record}.effective_from as string), 'Any start') || ' – ' || coalesce(cast(${record}.effective_to as string), 'No end')`}
                      </Typography>
                    </div>
                  ),
                  { width: "25%" },
                );
              }}
              actions={(b) => {
                b.custom(
                  "Edit rule",
                  { icon: "Edit" },
                  (s) => {
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
                    s.setScalar("workforce_auth_rule_reviewed", sql.null);
                    s.setScalar(
                      "workforce_auth_rule_permissions_visible",
                      sql`false`,
                    );
                    s.setScalar("workforce_auth_rule_open", sql`true`);
                  },
                );
              }}
            />
          </CardContent>
        </Card>

        <ModalDialog
          bindScalar="workforce_auth_rule_open"
          aria-label="Workforce access rule"
          layout="center"
          sx={{
            width: "min(900px, calc(100vw - 32px))",
            maxHeight: "calc(100dvh - 32px)",
            overflowY: "auto",
            padding: "24px",
          }}
        >
          <Typography level="title-lg">
            {sql`case when nullif(workforce_auth_selected_rule_id, '') is null then 'Add Role Rule' else 'Edit Role Rule' end`}
          </Typography>
          <Typography level="body-sm" className="text-secondary mt-1 mb-4">
            All selected criteria must match. “Any” leaves that criterion
            unrestricted.
          </Typography>
          <Form
            defaultFieldComponent={LabelOnTopFormField}
            beforeSubmitClient={(s, ctx) => {
              s.if(
                sql`not exists (select 1 from ui.workforce_auth_rule_selected_roles)
                  and not exists (select 1 from ui.workforce_auth_rule_selected_permissions)`,
                (s) =>
                  ctx.setWriteError(
                    s,
                    sql
                      .lit`Select at least one role or permission this rule should grant.`,
                  ),
              );
              s.if(
                sql`ui.workforce_auth_rule_reviewed is distinct from ${draftVersion}`,
                (s) =>
                  ctx.setWriteError(
                    s,
                    sql
                      .lit`Review the current impact and confirm before saving.`,
                  ),
              );
            }}
            afterTransactionStart={(s) => {
              workforce.assertManagementSession(s);
              s.throwErrorIf(
                sql`ui.workforce_auth_rule_reviewed is distinct from ${draftVersion}`,
                sql.lit`Review the current impact and confirm before saving.`,
              );
            }}
            beforeTransactionCommit={(s) => {
              s.callStoredProcedure("workforce_save_auth_rule", {
                inputScalars: {
                  p_rule_id:
                    sql`coalesce(nullif(ui.workforce_auth_selected_rule_id, '')::bigint, last_record_id(${
                      sql.ref(workforce.authRoleMappingsTable!)
                    }))`,
                  p_worker_type:
                    sql`cast(ui.workforce_rule_draft.worker_type as string)`,
                  p_effective_from:
                    sql`try_cast(ui.workforce_rule_draft.effective_from as date)`,
                  p_effective_to:
                    sql`try_cast(ui.workforce_rule_draft.effective_to as date)`,
                  p_is_active:
                    sql`ui.workforce_rule_draft.is_active is not false`,
                  ...Object.fromEntries(
                    facets.map((
                      [field],
                    ) => [
                      `p_${field}`,
                      sql`try_cast(${
                        sql.ref(`ui.workforce_rule_draft.${field}`)
                      } as bigint)`,
                    ]),
                  ),
                },
                inputTables: {
                  p_roles: "ui.workforce_auth_rule_selected_roles",
                  p_permissions: "ui.workforce_auth_rule_selected_permissions",
                },
                outputScalars: { saved_rule_id: "saved_workforce_rule_id" },
              });
            }}
            afterSubmitClientSuccess={(s) =>
              s.setScalar("workforce_auth_rule_open", false)}
          >
            <Form.Merge
              table={workforce.authRoleMappingsTable!}
              stateName="workforce_rule_draft"
              where={sql`id = nullif(ui.workforce_auth_selected_rule_id, '')::bigint`}
              defaultEmptyRecord
            >
              <section
                aria-label="Roles and permissions to grant"
                className="mb-6 space-y-3"
              >
                <div className="mb-4">
                  <FormControl>
                    <FormLabel>Roles to grant (optional)</FormLabel>
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
            end || ' (' || (select count(*) from (
              select permission from ui.workforce_auth_rule_selected_permissions
              union
              select granted.permission
              from workforce_auth_role_permissions granted
              join ui.workforce_auth_rule_selected_roles selected_role
                on selected_role.auth_role_id = granted.auth_role_id
            ) selected_permissions)::string || ')'`}
                  </Button>
                </div>
                <Show when={sql`workforce_auth_rule_permissions_visible`}>
                  <div className="mt-3 flex flex-col gap-3">
                    <Typography level="title-sm">
                      Permissions to grant
                    </Typography>
                    <Each
                      table="workforce_auth_rule_selected_permissions"
                      recordName="extra_permission"
                    >
                      <AuthBlock.PermissionEntry
                        permission={sql`extra_permission.permission`}
                      >
                        <Typography level="body-sm">
                          Added by this rule
                        </Typography>
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
                    <Typography level="title-sm">
                      Permissions from roles
                    </Typography>
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
                          <Typography
                            level="body-sm"
                            className="text-secondary"
                          >
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
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Form.Field field="worker_type">
                  {(field) => (
                    <FormControl>
                      <FormLabel>Worker type</FormLabel>
                      <Select
                        aria-label="Worker type"
                        fullWidth
                        value={sql`coalesce(cast(${field.value} as string), '')`}
                        onInput={(s) =>
                          field.setValue(s, sql`nullif(target_value, '')`)}
                      >
                        <Select.Option value="">Any type</Select.Option>
                        {workforce.workerTypes.map((workerType) => (
                          <Select.Option value={workerType.name}>
                            {workerType.displayName}
                          </Select.Option>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Form.Field>
                {facets.map(([field, label]) => (
                  <Form.Field field={field}>
                    <LabelOnTopFormField
                      label={label}
                      helperText="Leave blank for any."
                    />
                  </Form.Field>
                ))}
                <Form.Field field="effective_from">
                  <LabelOnTopFormField
                    label="Starts on"
                    helperText="Blank means immediately."
                  />
                </Form.Field>
                <Form.Field field="effective_to">
                  <LabelOnTopFormField
                    label="Ends before"
                    helperText="Exclusive end date; blank means no end."
                  />
                </Form.Field>
                <Form.Field field="is_active">
                  <LabelOnTopFormField label="Enabled" />
                </Form.Field>
              </div>

              <Data
                errorFallback={
                  <Alert color="danger">
                    Unable to calculate the affected people. Close and reopen
                    the rule to try again.
                  </Alert>
                }
                pendingFallback={
                  <Typography className="mt-4">Calculating impact…</Typography>
                }
                procedure={(s) => {
                  s.defTable(
                    "workforce_rule_matching_people",
                    sql`
                    select person.id, person.display_name, ${
                      workforce.personSysUserId(sql`person`)
                    } as sys_user_id
                    from db.${sql.ref(workforce.peopleTable)} person
                    cross join (select
                      ui.workforce_rule_draft.worker_type as worker_type,
                      ${
                      facets.map(([field]) =>
                        sql`try_cast(${
                          sql.ref(`ui.workforce_rule_draft.${field}`)
                        } as bigint) as ${sql.ref(field)}`
                      )
                    }
                    ) mapping
                    where ${workforce.personAccessEligible(sql`person`)}
                      and ${workforce.personSysUserId(sql`person`)} is not null
                      and ${
                      workforceAuthMappingMatchSql({
                        workforce,
                        personRecord: sql`person`,
                        mappingRecord: sql`mapping`,
                      })
                    }
                  `,
                  );
                  s.defTable(
                    "workforce_rule_existing_people",
                    sql`
                    select sys_user_id from db.auth_user_role_sources where source = ${workforceAuthRuleSource} and source_record_id = nullif(ui.workforce_auth_selected_rule_id, '')::bigint
                    union
                    select sys_user_id from db.auth_user_permission_sources where source = ${workforceAuthRuleSource} and source_record_id = nullif(ui.workforce_auth_selected_rule_id, '')::bigint
                  `,
                  );
                  s.defTable(
                    "workforce_rule_preview_people",
                    sql`select * from workforce_rule_matching_people order by display_name, id limit 10`,
                  );
                  s.defRecord(
                    "workforce_rule_membership_counts",
                    sql`select
                      (select count(*) from workforce_rule_matching_people) as matches,
                      (select count(*) from workforce_rule_matching_people matched where not exists (select 1 from workforce_rule_existing_people existing where existing.sys_user_id = matched.sys_user_id)) as added,
                      (select count(*) from workforce_rule_existing_people existing where not exists (select 1 from workforce_rule_matching_people matched where matched.sys_user_id = existing.sys_user_id)) as removed,
                      (select count(*) from workforce_rule_existing_people) as existing
                    `,
                  );
                }}
              >
                <Data
                  local
                  procedure={(s) => {
                    s.defRecord(
                      "workforce_rule_impact",
                      sql`select
                      workforce_rule_membership_counts.matches as matches,
                      case when ${draftActiveToday} then workforce_rule_membership_counts.added else 0 end as added,
                      case when ${draftActiveToday} then workforce_rule_membership_counts.removed else workforce_rule_membership_counts.existing end as removed
                  `,
                    );
                  }}
                >
                  <Card variant="soft" className="mt-5 p-4 flex flex-col gap-3">
                    <Typography level="title-md">Review impact</Typography>
                    <Show
                      when={sql.and(
                        sql`workforce_rule_draft.worker_type is null`,
                        ...facets.map(([field]) =>
                          sql`nullif(cast(${
                            sql.ref(`workforce_rule_draft.${field}`)
                          } as string), '') is null`
                        ),
                      )}
                    >
                      <Alert color="warning">
                        No criteria are restricted. This rule covers every
                        eligible person with a linked login.
                      </Alert>
                    </Show>
                    <Typography level="body-sm">
                      {sql`workforce_rule_impact.matches`}{" "}
                      people match the current workforce criteria.
                    </Typography>
                    <Typography level="body-sm">
                      After saving today: {sql`workforce_rule_impact.added`}
                      {" "}
                      gain this rule's grants;{" "}
                      {sql`workforce_rule_impact.removed`}{" "}
                      lose this rule's grants. Existing matching people receive
                      any changes to the selected grants.
                    </Typography>
                    <Show when={sql`not (${draftActiveToday})`}>
                      <Alert color="neutral">
                        This rule will not grant access today because it is
                        disabled or outside its effective dates.
                      </Alert>
                    </Show>
                    <Typography level="body-xs" className="text-secondary">
                      Other rules and manual grants remain in place. Future
                      membership depends on workforce records at that time.
                    </Typography>
                    <div className="flex flex-wrap gap-2">
                      <Each
                        table="workforce_rule_preview_people"
                        recordName="matched"
                        orderBy={sql`display_name`}
                      >
                        <Chip size="sm" variant="outlined">
                          {sql`matched.display_name`}
                        </Chip>
                      </Each>
                      <Show when={sql`workforce_rule_impact.matches > 10`}>
                        <Typography level="body-sm">
                          and {sql`workforce_rule_impact.matches - 10`} more
                        </Typography>
                      </Show>
                    </div>
                    <Checkbox
                      id={reviewCheckboxId}
                      label="I reviewed the people, dates, and access changes"
                      checked={sql`coalesce(workforce_auth_rule_reviewed = ${draftVersion}, false)`}
                      onCheckboxChange={(s) =>
                        s.setScalar(
                          "workforce_auth_rule_reviewed",
                          sql`case when target_checked then ${draftVersion} else null end`,
                        )}
                    />
                  </Card>
                </Data>
              </Data>
            </Form.Merge>
            <Form.ErrorAlert className="mt-4" mode="all" />
            <div className="flex justify-end gap-3 mt-5">
              <Button
                variant="plain"
                color="neutral"
                onClick={(s) => s.setScalar("workforce_auth_rule_open", false)}
              >
                Cancel
              </Button>
              <Form.SubmitButton startIcon="Save">
                {sql`case when nullif(workforce_auth_selected_rule_id, '') is null then 'Create rule' else 'Save rule' end`}
              </Form.SubmitButton>
            </div>
          </Form>
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
          display={props.field === "preferred_language"
            ? (value) =>
              sql`case lower(${value}) when 'en' then 'English' when 'es' then 'Spanish' else ${value} end`
            : undefined}
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
    if (field.name === "sys_user_id") {
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
    effective_to: "Ends before",
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
      <Form.Field
        field={field.name}
        initialValue={field.name === "is_primary" ? sql.true : undefined}
      >
        <LabelOnLeftFormField label={labels[field.name]} />
        {field.name === "effective_to" && (
          <Typography level="body-sm" className="text-secondary">
            Exclusive end date. For a final working day of Friday, choose
            Saturday. Leave blank for no end.
          </Typography>
        )}
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

// Stored procedures keep the create-dialog SQL out of every UI route.
function registerWorkforceCreateActionProcedures(workforce: WorkforceBlock) {
  system.storedProcedure({
    name: "workforce_close_open_relationships",
    transaction: "caller",
    inputScalars: [
      { name: "p_person_id", type: "BigInt" },
      { name: "p_effective_from", type: "Date" },
    ],
    procedure: (s) => {
      s.if(
        sql`exists (
          select 1
          from db.${
          sql.ref(workforce.workerRelationshipsTable)
        } current_relationship
          where current_relationship.person_id = p_person_id
            and current_relationship.effective_to is null
            and current_relationship.effective_from >=
              p_effective_from
        )`,
        (s) => {
          s.throwError(
            sql
              .lit`The new relationship must start after every currently open relationship. Use Correct history to fix the existing start date.`,
          );
        },
      );
      s.if(
        sql`exists (
          select 1
          from db.${sql.ref(workforce.assignmentsTable)} current_assignment
          join db.${
          sql.ref(workforce.workerRelationshipsTable)
        } current_relationship
            on current_relationship.id = current_assignment.worker_relationship_id
          where current_relationship.person_id = p_person_id
            and current_relationship.effective_from < p_effective_from
            and (current_relationship.effective_to is null or current_relationship.effective_to > p_effective_from)
            and current_assignment.effective_from >=
              p_effective_from
        )`,
        (s) => {
          s.throwError(
            sql
              .lit`The new relationship must start after every assignment on the current relationship. Use Correct history to review future assignments before replacing the relationship.`,
          );
        },
      );
      if (workforce.reportingRelationshipsTable) {
        const affectedReporting = sql`exists (
          select 1 from db.${
          sql.ref(workforce.workerRelationshipsTable)
        } current_relationship
          where current_relationship.person_id = p_person_id
            and current_relationship.effective_from < p_effective_from
            and (current_relationship.effective_to is null or current_relationship.effective_to > p_effective_from)
            and (current_relationship.id = reporting.worker_relationship_id
              or current_relationship.id = reporting.manager_worker_relationship_id)
        )`;
        s.validationErrorIf(
          sql`exists (select 1 from db.${
            sql.ref(workforce.reportingRelationshipsTable)
          } reporting
            where ${affectedReporting} and reporting.effective_from >= p_effective_from)`,
          sql
            .lit`A reporting relationship starts on or after the replacement date. Review reporting dates before replacing the relationship.`,
        );
        s.modify(
          sql`update db.${
            sql.ref(workforce.reportingRelationshipsTable)
          } reporting
          set effective_to = p_effective_from
          where ${affectedReporting}
            and (reporting.effective_to is null or reporting.effective_to > p_effective_from)`,
        );
      }
      s.modify(sql`
        update db.${sql.ref(workforce.assignmentsTable)} assignment
        set effective_to = p_effective_from
        where assignment.effective_from <
            p_effective_from
          and (
            assignment.effective_to is null
            or assignment.effective_to >
              p_effective_from
          )
          and exists (
            select 1
            from db.${
        sql.ref(workforce.workerRelationshipsTable)
      } current_relationship
            where current_relationship.id = assignment.worker_relationship_id
              and current_relationship.person_id = p_person_id
              and current_relationship.effective_from < p_effective_from
            and (current_relationship.effective_to is null or current_relationship.effective_to > p_effective_from)
          )
      `);
      s.modify(sql`
        update db.${sql.ref(workforce.workerRelationshipsTable)}
        set effective_to = p_effective_from
        where person_id = p_person_id
          and effective_from < p_effective_from
          and (effective_to is null or effective_to > p_effective_from)
      `);
    },
  });
  system.storedProcedure({
    name: "workforce_prepare_new_assignment",
    transaction: "caller",
    inputScalars: [
      { name: "p_person_id", type: "BigInt" },
      { name: "p_worker_relationship_id", type: "BigInt" },
      { name: "p_effective_from", type: "Date" },
      { name: "p_effective_to", type: "Date" },
      { name: "p_is_primary", type: "Bool" },
      { name: "p_is_active", type: "Bool" },
      { name: "p_close_current", type: "Bool" },
    ],
    procedure: (s) => {
      s.unless(
        sql`exists (
          select 1
          from db.${sql.ref(workforce.workerRelationshipsTable)} relationship
          where relationship.id =
              p_worker_relationship_id
            and relationship.person_id = p_person_id
            and relationship.effective_from <=
              p_effective_from
            and (
              relationship.effective_to is null
              or (
                p_effective_to is not null
                and p_effective_to <=
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
        sql`p_close_current and p_is_primary`,
        (s) => {
          s.if(
            sql`exists (
              select 1
              from db.${sql.ref(workforce.assignmentsTable)} current_assignment
              where current_assignment.worker_relationship_id =
                  p_worker_relationship_id
                and current_assignment.is_primary
                and current_assignment.effective_from >=
                  p_effective_from
                and (
                  (p_is_active and current_assignment.status = ${
              sql.lit(workforce.activeAssignmentStatus)
            }
                    and (p_effective_to is null or current_assignment.effective_from < p_effective_to))
                  or (${
              workforce.opts.allowMultipleActivePrimaryAssignments
                ? sql.false
                : sql.true
            }
                    and p_effective_to is null and current_assignment.effective_to is null)
                )
            )`,
            (s) => {
              s.throwError(
                sql
                  .lit`Another primary assignment starts within the new period. Use Correct history to review its dates, or end the new period before that assignment starts.`,
              );
            },
          );
          s.modify(sql`
            update db.${sql.ref(workforce.assignmentsTable)}
            set effective_to = p_effective_from
            where worker_relationship_id =
                p_worker_relationship_id
              and is_primary
              and effective_from < p_effective_from
              and (effective_to is null or effective_to > p_effective_from)
              and ((p_is_active and status = ${
            sql.lit(workforce.activeAssignmentStatus)
          })
                or (${
            workforce.opts.allowMultipleActivePrimaryAssignments
              ? sql.false
              : sql.true
          }
                  and p_effective_to is null and effective_to is null))
          `);
        },
      );
    },
  });
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
        aria-label="New relationship"
        maxWidth="lg"
        className="flex flex-col gap-4 p-6"
      >
        <div>
          <Typography level="title-lg">New relationship</Typography>
          <Typography level="body-sm" className="text-secondary mt-1">
            Add an effective-dated relationship and its initial primary
            assignment. Use Correct history only to fix a recorded mistake.
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
                s.callStoredProcedure("workforce_close_open_relationships", {
                  inputScalars: {
                    p_person_id: sql`record_id`,
                    p_effective_from:
                      sql`workforce_new_relationship.effective_from`,
                  },
                });
              },
            );
          }}
          beforeTransactionCommit={(s) => {
            block.assertStaffPersonAccess(s, sql`record_id`);
            block.validatePersonIntervals(s, sql`record_id`);
            block.opts.validatePersonAssignments?.(s, sql`record_id`);
            syncWorkforcePersonAccess(s, block, sql`record_id`);
          }}
          afterSubmitClientSuccess={(s) =>
            s.setScalar("workforce_relationship_create_open", false)}
        >
          <Form.Insert
            table={block.workerRelationshipsTable}
            stateName="workforce_new_relationship"
            values={{
              person_id: sql`record_id`,
            }}
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
                   ${
            block.organizationDisplayName(
              sql`relationship.workforce_organization_id`,
            )
          } || ' · ' ||
                     cast(relationship.worker_type as string) || ' · ' ||
                     cast(relationship.effective_from as string) ||
                     case
                       when relationship.effective_to is null then ' onward'
                       else ' to ' || cast(relationship.effective_to as string)
                     end as label
            from db.${sql.ref(block.workerRelationshipsTable)} relationship
            where relationship.person_id = record_id
              and (relationship.effective_to is null or relationship.effective_to > current_date())
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
          Change assignment
        </Button>
        <ModalDialog
          bindScalar="workforce_assignment_create_open"
          aria-label="Change assignment"
          maxWidth="lg"
          className="flex flex-col gap-4 p-6"
        >
          <div>
            <Typography level="title-lg">Change assignment</Typography>
            <Typography level="body-sm" className="text-secondary mt-1">
              Add an effective-dated assignment to one of this person's
              relationships. The primary assignment is selected by default; its
              previous period ends when the new one starts. Use Correct history
              to fix a recorded mistake.
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
              s.callStoredProcedure("workforce_prepare_new_assignment", {
                inputScalars: {
                  p_person_id: sql`record_id`,
                  p_worker_relationship_id:
                    sql`workforce_new_assignment.worker_relationship_id`,
                  p_effective_from:
                    sql`workforce_new_assignment.effective_from`,
                  p_effective_to: sql`workforce_new_assignment.effective_to`,
                  p_is_primary: sql`workforce_new_assignment.is_primary`,
                  p_is_active: sql`workforce_new_assignment.status = ${
                    sql.lit(block.activeAssignmentStatus)
                  }`,
                  p_close_current:
                    sql`workforce_assignment_change_options.close_current`,
                },
              });
            }}
            beforeTransactionCommit={(s) => {
              block.assertStaffPersonAccess(s, sql`record_id`);
              block.validatePersonIntervals(s, sql`record_id`);
              block.opts.validatePersonAssignments?.(s, sql`record_id`);
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
              and (relationship.effective_to is null or relationship.effective_to > current_date())
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
                label="End the previous primary assignment when this primary assignment starts"
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
              <Form.SubmitButton>Save assignment change</Form.SubmitButton>
            </div>
            <Form.ErrorAlert className="mt-3" mode="all" size="lg" />
          </Form>
        </ModalDialog>
      </Data>
    </Data>
  );
}

function workforceIsoDate(value: Sql) {
  return sql`format.date(${value}, '%Y-%m-%d')`;
}

function WorkforceSectionHeader(props: { label: string; action?: Node }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 min-h-[32px]">
      <Typography
        level="body-xs"
        className="font-semibold uppercase tracking-wide text-secondary"
      >
        {props.label}
      </Typography>
      {props.action}
    </div>
  );
}

function WorkforceAccessCheck(props: { ok: Sql; text: Sql }) {
  return (
    <div className="flex items-center gap-2">
      <Show when={props.ok}>
        <MaterialIcon icon="CheckCircle" className="text-[16px]" />
      </Show>
      <Show when={sql`not ${props.ok}`}>
        <MaterialIcon icon="Cancel" className="text-[16px]" />
      </Show>
      <Typography level="body-sm">{props.text}</Typography>
    </div>
  );
}

function WorkforceAccessStatusContent() {
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Typography level="body-sm" className="font-semibold">
          {sql`case
            when not workforce_access.eligible then 'Not eligible for access'
            when workforce_access.sys_user_id is null then 'Active · no login account'
            when workforce_access.login_disabled then 'Active · login disabled'
            else 'Active and can sign in' end`}
        </Typography>
        <Show when={sql`workforce_access.current_job is not null`}>
          <Typography level="body-sm">
            {sql`'· ' || workforce_access.current_job`}
          </Typography>
        </Show>
        <div className="flex-1" />
        <Show when={sql`workforce_access.eligible`}>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            onClick={(s) =>
              s.setScalar(
                "workforce_access_checks_open",
                sql`not workforce_access_checks_open`,
              )}
          >
            {sql`case when workforce_access_checks_open then 'Hide access checks' else 'Access checks' end`}
          </Button>
        </Show>
      </div>
      <Show
        when={sql`workforce_access_checks_open or not workforce_access.eligible`}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <WorkforceAccessCheck
            ok={sql`workforce_access.person_ok`}
            text={sql`'Person status is ' || workforce_access.person_status`}
          />
          <WorkforceAccessCheck
            ok={sql`workforce_access.relationship_ok`}
            text={sql`case when workforce_access.relationship_ok
              then 'An active relationship covers today'
              else 'No active relationship covers today' end`}
          />
          <WorkforceAccessCheck
            ok={sql`workforce_access.assignment_ok`}
            text={sql`case when workforce_access.assignment_ok
              then 'An active primary assignment covers today'
              else 'No active primary assignment covers today' end`}
          />
        </div>
      </Show>
    </div>
  );
}

function WorkforcePersonAccessStatus() {
  const block = system.block(WorkforceBlock);
  const coversToday = (alias: string) =>
    sql`${sql.ref(alias)}.effective_from <= current_date()
      and (${sql.ref(alias)}.effective_to is null
        or current_date() < ${sql.ref(alias)}.effective_to)`;
  const activeRelationship = sql`wf_wr.status = cast(${
    sql.lit(block.activeRelationshipStatus)
  } as enums.workforce_relationship_status) and ${coversToday("wf_wr")}`;
  const sysUserId = block.personSysUserId(sql`person`);
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "workforce_access",
          sql`
            select
              person.status = cast(${
            sql.lit(block.activePersonStatus)
          } as enums.workforce_person_status) as person_ok,
              fn.display_workforce_person_status(person.status) as person_status,
              exists (
                select 1 from db.${
            sql.ref(block.workerRelationshipsTable)
          } wf_wr
                where wf_wr.person_id = person.id and ${activeRelationship}
              ) as relationship_ok,
              exists (
                select 1 from db.${
            sql.ref(block.workerRelationshipsTable)
          } wf_wr
                join db.${sql.ref(block.assignmentsTable)} wf_a
                  on wf_a.worker_relationship_id = wf_wr.id
                where wf_wr.person_id = person.id and ${activeRelationship}
                  and wf_a.is_primary
                  and wf_a.status = cast(${
            sql.lit(block.activeAssignmentStatus)
          } as enums.workforce_assignment_status)
                  and ${coversToday("wf_a")}
              ) as assignment_ok,
              coalesce(${
            block.personAccessEligible(sql`person`)
          }, false) as eligible,
              ${sysUserId} as sys_user_id,
              coalesce((select disabled from db.sys_users where id = ${sysUserId}), false) as login_disabled,
              nullif(concat_ws(' at ', ${
            block.personPrimaryJobProfileDisplay(sql`person`)
          }, ${
            block.organizationDisplayName(
              block.personEmployerOrganizationId(sql`person`),
            )
          }), '') as current_job
            from db.${sql.ref(block.peopleTable)} person
            where person.id = record_id
          `,
        );
      }}
    >
      <Data
        local
        procedure={(s) => s.defScalar("workforce_access_checks_open", false)}
      >
        <Show when={sql`workforce_access.eligible`}>
          <Alert variant="soft" color="success" startIcon="VerifiedUser">
            <WorkforceAccessStatusContent />
          </Alert>
        </Show>
        <Show when={sql`not workforce_access.eligible`}>
          <Alert variant="soft" color="warning" startIcon="Warning">
            <WorkforceAccessStatusContent />
          </Alert>
        </Show>
      </Data>
    </Data>
  );
}

function workforcePeriodState(alias: string, activeStatus: Sql, display: Sql) {
  const t = sql.ref(alias);
  return sql`case when ${t}.effective_to <= current_date() then 'Ended'
    when ${t}.status <> ${activeStatus} then ${display}
    when ${t}.effective_from > current_date() then 'Scheduled'
    else 'Current' end`;
}

function WorkforcePeriodChip(props: { state: Sql }) {
  return (
    <Switch>
      <Match when={sql`${props.state} = 'Current'`}>
        <Chip size="sm" variant="soft" color="success">Current</Chip>
      </Match>
      <Match when={sql`${props.state} = 'Scheduled'`}>
        <Chip size="sm" variant="soft" color="primary">Scheduled</Chip>
      </Match>
      <Match when={sql.true}>
        <Chip size="sm" variant="soft" color="warning">{props.state}</Chip>
      </Match>
    </Switch>
  );
}

function WorkforcePersonRelationshipCards() {
  const block = system.block(WorkforceBlock);
  const canCreate = block.opts.enableRelationshipAndAssignmentCreation;
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          "workforce_current_relationships",
          sql`
            select relationship.id,
                   ${
            block.organizationDisplayName(
              sql`relationship.workforce_organization_id`,
            )
          } as organization,
                   fn.display_workforce_worker_type(relationship.worker_type) as worker_type,
                   ${
            workforcePeriodState(
              "relationship",
              sql.lit(block.activeRelationshipStatus),
              sql`fn.display_workforce_relationship_status(relationship.status)`,
            )
          } as period_state,
                   relationship.effective_from,
                   relationship.effective_to - interval '1 day' as last_working_day,
                   relationship.external_worker_id
            from db.${sql.ref(block.workerRelationshipsTable)} relationship
            where relationship.person_id = record_id
              and (relationship.effective_to is null or relationship.effective_to > current_date())
            order by relationship.effective_from desc, relationship.id desc
          `,
        )}
    >
      <div className="flex flex-col gap-2">
        <WorkforceSectionHeader
          label="Employment"
          action={canCreate ? <WorkforceRelationshipCreateAction /> : undefined}
        />
        <Show
          when={sql`not exists (select 1 from workforce_current_relationships)`}
        >
          <Typography level="body-sm" className="text-secondary">
            No current relationship.
            {canCreate && " Add one to record who this person works for."}
          </Typography>
        </Show>
        <div
          role="list"
          aria-label="Employment"
          className="flex flex-col gap-2"
        >
          <Each
            table="workforce_current_relationships"
            recordName="relationship"
          >
            <div role="listitem">
              <Card
                variant="outlined"
                className="flex flex-row items-start gap-4 p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100">
                  <MaterialIcon
                    icon="Business"
                    className="text-[20px] text-icon"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography level="title-md">
                      {sql`coalesce(relationship.organization, relationship.worker_type)`}
                    </Typography>
                    <Show when={sql`relationship.organization is not null`}>
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`relationship.worker_type`}
                      </Chip>
                    </Show>
                    <WorkforcePeriodChip
                      state={sql`relationship.period_state`}
                    />
                  </div>
                  <Typography level="body-sm" className="mt-1 text-secondary">
                    {sql`concat_ws(' · ',
                  case when relationship.effective_from > current_date() then 'Starts ' else 'Since ' end
                    || ${workforceIsoDate(sql`relationship.effective_from`)},
                  'Last working day ' || ${
                      workforceIsoDate(sql`relationship.last_working_day`)
                    },
                  'Worker ID ' || relationship.external_worker_id)`}
                  </Typography>
                </div>
                {canCreate && (
                  <WorkforceRelationshipEndAction
                    relationshipId={sql`relationship.id`}
                    description={sql`concat_ws(' · ', relationship.organization, relationship.worker_type, relationship.period_state, 'Starts ' || cast(relationship.effective_from as string))`}
                  />
                )}
              </Card>
            </div>
          </Each>
        </div>
      </div>
    </Data>
  );
}

function WorkforcePersonAssignmentCards() {
  const block = system.block(WorkforceBlock);
  const canCreate = block.opts.enableRelationshipAndAssignmentCreation;
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          "workforce_current_assignments",
          sql`
            select assignment.id,
                   coalesce(job.name, ${
            block.positionsTable ? sql`position.name, ` : sql``
          }'No job profile') as job_profile,
                   assignment.is_primary,
                   ${
            workforcePeriodState(
              "assignment",
              sql.lit(block.activeAssignmentStatus),
              sql`fn.display_workforce_assignment_status(assignment.status)`,
            )
          } as period_state,
                   concat_ws(' · ',
                     ${
            block.organizationsTable
              ? block.organizationDisplayName(
                sql`assignment.host_workforce_organization_id`,
              )
              : sql.null
          },
                     ${block.orgUnitsTable ? sql`unit.name` : sql.null},
                     ${block.locationsTable ? sql`location.path` : sql.null},
                     ${
            block.positionsTable
              ? sql`case when job.name is not null then position.name end`
              : sql.null
          },
                     case when assignment.effective_from > current_date() then 'Starts ' else 'Since ' end
                       || ${workforceIsoDate(sql`assignment.effective_from`)},
                     'Last working day ' || ${
            workforceIsoDate(sql`assignment.effective_to - interval '1 day'`)
          }) as detail
            from db.${sql.ref(block.assignmentsTable)} assignment
            join db.${sql.ref(block.workerRelationshipsTable)} relationship
              on relationship.id = assignment.worker_relationship_id
            left join db.${sql.ref(block.jobProfilesTable)} job
              on job.id = assignment.workforce_job_profile_id
            ${
            block.orgUnitsTable
              ? sql`left join db.${sql.ref(block.orgUnitsTable)} unit
                  on unit.id = assignment.workforce_org_unit_id`
              : sql``
          }
            ${
            block.locationsTable
              ? sql`left join (${locationPaths()}) location
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
              and (assignment.effective_to is null or assignment.effective_to > current_date())
            order by assignment.is_primary desc, assignment.effective_from asc, assignment.id asc
          `,
        )}
    >
      <div className="flex flex-col gap-2">
        <WorkforceSectionHeader
          label="Assignment"
          action={canCreate ? <WorkforceAssignmentCreateAction /> : undefined}
        />
        <Show
          when={sql`not exists (select 1 from workforce_current_assignments)`}
        >
          <Typography level="body-sm" className="text-secondary">
            No current assignment.
          </Typography>
        </Show>
        <div
          role="list"
          aria-label="Assignments"
          className="flex flex-col gap-2"
        >
          <Each table="workforce_current_assignments" recordName="assignment">
            <div role="listitem">
              <Card
                variant="outlined"
                className="flex flex-row items-start gap-4 p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                  <MaterialIcon icon="Work" className="text-[20px] text-icon" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography level="title-md">
                      {sql`assignment.job_profile`}
                    </Typography>
                    <Show when={sql`assignment.is_primary`}>
                      <Chip size="sm" variant="soft" color="primary">
                        Primary
                      </Chip>
                    </Show>
                    <WorkforcePeriodChip state={sql`assignment.period_state`} />
                  </div>
                  <Typography level="body-sm" className="mt-1 text-secondary">
                    {sql`assignment.detail`}
                  </Typography>
                </div>
              </Card>
            </div>
          </Each>
        </div>
      </div>
    </Data>
  );
}

function WorkforcePersonReportingChips() {
  const block = system.block(WorkforceBlock);
  const reportingTable = block.reportingRelationshipsTable;
  if (!reportingTable) {
    return null;
  }
  return (
    <Data
      procedure={(s) =>
        s.defTable(
          "workforce_current_reporting",
          sql`
            select reporting.id,
                   manager_person.display_name as manager,
                   concat_ws(' · ', reporting.relationship_type,
                     case when not reporting.is_active then 'Inactive' end,
                     case when reporting.effective_from > current_date() then 'Starts ' else 'Since ' end
                       || ${
            workforceIsoDate(sql`reporting.effective_from`)
          }) as detail
            from db.${sql.ref(reportingTable)} reporting
            join db.${sql.ref(block.workerRelationshipsTable)} relationship
              on relationship.id = reporting.worker_relationship_id
            join db.${
            sql.ref(block.workerRelationshipsTable)
          } manager_relationship
              on manager_relationship.id = reporting.manager_worker_relationship_id
            join db.${sql.ref(block.peopleTable)} manager_person
              on manager_person.id = manager_relationship.person_id
            where relationship.person_id = record_id
              and (reporting.effective_to is null or reporting.effective_to > current_date())
            order by reporting.effective_from desc, reporting.id desc
          `,
        )}
    >
      <div className="flex flex-col gap-2">
        <WorkforceSectionHeader label="Reports to" />
        <Show
          when={sql`not exists (select 1 from workforce_current_reporting)`}
        >
          <Typography level="body-sm" className="text-secondary">
            No manager recorded.
          </Typography>
        </Show>
        <div className="flex flex-wrap gap-2">
          <Each table="workforce_current_reporting" recordName="reporting">
            <div className="inline-flex items-center gap-2 rounded-full border border-divider py-1 pl-1 pr-3">
              <MaterialIcon
                icon="AccountCircle"
                className="text-[24px] text-icon"
              />
              <Typography level="body-sm" className="font-medium">
                {sql`reporting.manager`}
              </Typography>
              <Typography level="body-sm" className="text-secondary">
                {sql`'· ' || reporting.detail`}
              </Typography>
            </div>
          </Each>
        </div>
      </div>
    </Data>
  );
}

function WorkforceRelationshipCorrectMenuItem(props: { recordId: Sql }) {
  const block = system.block(WorkforceBlock);
  const personId = sql`(select person_id from db.${
    sql.ref(block.workerRelationshipsTable)
  } where id = ${props.recordId})`;
  return (
    <AutoUpdateMenuItem
      table={block.workerRelationshipsTable}
      recordId={props.recordId}
      ignoreFields={["person_id"]}
      temporaryFields={
        <Alert color="warning" className="mb-3">
          Correct history: this edits the existing period in place.{" "}
          {block.opts.enableRelationshipAndAssignmentCreation && (
            <>
              To start a new period, cancel and choose New relationship.
            </>
          )}{" "}
          Setting this relationship active does not activate its assignments or
          person. Review their statuses and dates separately.
        </Alert>
      }
      afterTransactionStart={(s) => block.assertStaffPersonAccess(s, personId)}
      beforeTransactionCommit={(s) => {
        validateWorkforceRelationshipAssignmentIntervals(
          s,
          block,
          props.recordId,
        );
        block.assertStaffPersonAccess(s, personId);
        block.validatePersonIntervals(s, personId);
        block.opts.validatePersonAssignments?.(s, personId);
        syncWorkforcePersonAccess(s, block, personId);
      }}
    >
      Correct history
    </AutoUpdateMenuItem>
  );
}

function WorkforceAssignmentCorrectMenuItem(props: { recordId: Sql }) {
  const block = system.block(WorkforceBlock);
  const personId = sql`(select checked_relationship.person_id from db.${
    sql.ref(block.assignmentsTable)
  } checked_assignment join db.${
    sql.ref(block.workerRelationshipsTable)
  } checked_relationship on checked_relationship.id = checked_assignment.worker_relationship_id where checked_assignment.id = ${props.recordId})`;
  return (
    <AutoUpdateMenuItem
      table={block.assignmentsTable}
      recordId={props.recordId}
      ignoreFields={["worker_relationship_id"]}
      temporaryFields={
        <Alert color="warning" className="mb-3">
          Correct history: this edits the existing period in place.{" "}
          {block.opts.enableRelationshipAndAssignmentCreation && (
            <>
              To start a new period, cancel and choose Change assignment.
            </>
          )}{" "}
          The person and relationship must also be active for this assignment to
          be current.
        </Alert>
      }
      afterTransactionStart={(s) => block.assertStaffPersonAccess(s, personId)}
      beforeTransactionCommit={(s) => {
        validateWorkforceAssignmentRelationshipInterval(
          s,
          block,
          props.recordId,
        );
        block.assertStaffPersonAccess(s, personId);
        block.validatePersonIntervals(s, personId);
        block.opts.validatePersonAssignments?.(s, personId);
        syncWorkforcePersonAccess(s, block, personId);
      }}
    >
      Correct history
    </AutoUpdateMenuItem>
  );
}

function WorkforceReportingCorrectMenuItem(props: { recordId: Sql }) {
  const block = system.block(WorkforceBlock);
  return (
    <AutoUpdateMenuItem
      table={block.reportingRelationshipsTable}
      recordId={props.recordId}
      ignoreFields={["worker_relationship_id"]}
      afterTransactionStart={(s) => block.assertManagementSession(s)}
    >
      Correct history
    </AutoUpdateMenuItem>
  );
}

function WorkforceHistoryActions(props: { kind: string; item: Node }) {
  return (
    <Match when={sql`workforce_event.kind = ${sql.lit(props.kind)}`}>
      <Menu>
        <Menu.IconButton
          variant="plain"
          size="sm"
          color="neutral"
          icon="MoreVert"
          aria-label="History actions"
        />
        <Menu.Content>{props.item}</Menu.Content>
      </Menu>
    </Match>
  );
}

function WorkforcePersonHistory() {
  const block = system.block(WorkforceBlock);
  const relationships = sql`db.${sql.ref(block.workerRelationshipsTable)}`;
  const assignments = sql`db.${sql.ref(block.assignmentsTable)}`;
  const organization = block.organizationDisplayName(
    sql`relationship.workforce_organization_id`,
  );
  const job = sql`coalesce((select name from db.${
    sql.ref(block.jobProfilesTable)
  } where id = assignment.workforce_job_profile_id), ${
    block.positionsTable
      ? sql`(select name from db.${
        sql.ref(block.positionsTable)
      } where id = assignment.workforce_position_id), `
      : sql``
  }'No job profile')`;
  const previousJob = sql`(
    select coalesce(previous_job.name, 'No job profile')
    from ${assignments} previous
    left join db.${sql.ref(block.jobProfilesTable)} previous_job
      on previous_job.id = previous.workforce_job_profile_id
    where previous.worker_relationship_id = assignment.worker_relationship_id
      and previous.is_primary = assignment.is_primary
      and previous.effective_to = assignment.effective_from
    order by previous.id desc
    limit 1
  )`;
  const assignmentDetail = sql`concat_ws(' · ',
    case when not assignment.is_primary then 'Secondary' end,
    ${block.orgUnitsTable ? sql`unit.name` : sql.null},
    ${block.locationsTable ? sql`location.path` : sql.null})`;
  const assignmentJoins = sql`
    join ${relationships} relationship
      on relationship.id = assignment.worker_relationship_id
    ${
    block.orgUnitsTable
      ? sql`left join db.${sql.ref(block.orgUnitsTable)} unit
          on unit.id = assignment.workforce_org_unit_id`
      : sql``
  }
    ${
    block.locationsTable
      ? sql`left join (${locationPaths()}) location
          on location.id = assignment.workforce_location_id`
      : sql``
  }`;
  const reporting = block.reportingRelationshipsTable
    ? sql`
      union all
      select 'reporting' as kind, reporting.id as source_id,
             reporting.effective_from as event_date, 2 as sort_order,
             'Started reporting to ' || manager_person.display_name as title,
             reporting.relationship_type as detail
      from db.${sql.ref(block.reportingRelationshipsTable)} reporting
      join ${relationships} relationship
        on relationship.id = reporting.worker_relationship_id
      join ${relationships} manager_relationship
        on manager_relationship.id = reporting.manager_worker_relationship_id
      join db.${sql.ref(block.peopleTable)} manager_person
        on manager_person.id = manager_relationship.person_id
      where relationship.person_id = record_id`
    : sql``;
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "workforce_history_events",
          sql`
            select event.kind, event.source_id, event.event_date, event.sort_order,
                   event.title, event.detail,
                   event.event_date > current_date() as is_scheduled,
                   row_number() over (
                     order by event.event_date desc, event.sort_order desc
                   ) = count(*) over () as is_last
            from (
              select 'today' as kind, cast(null as bigint) as source_id,
                     current_date() as event_date, 9 as sort_order,
                     coalesce(nullif(concat_ws(' at ',
                       ${block.personPrimaryJobProfileDisplay(sql`person`)},
                       ${
            block.organizationDisplayName(
              block.personEmployerOrganizationId(sql`person`),
            )
          }), ''), 'No current assignment') as title,
                     cast(null as string) as detail
              from db.${sql.ref(block.peopleTable)} person
              where person.id = record_id
              union all
              select 'relationship', relationship.id, relationship.effective_from, 0,
                     case when ${organization} is null
                       then 'Started as ' || fn.display_workforce_worker_type(relationship.worker_type)
                       else 'Started at ' || ${organization} || ' as '
                         || fn.display_workforce_worker_type(relationship.worker_type) end,
                     concat_ws(' · ',
                       case when relationship.status <> ${
            sql.lit(block.activeRelationshipStatus)
          } then fn.display_workforce_relationship_status(relationship.status) end,
                       'Worker ID ' || relationship.external_worker_id)
              from ${relationships} relationship
              where relationship.person_id = record_id
              union all
              select 'relationship', relationship.id,
                     cast(relationship.effective_to - interval '1 day' as date), 3,
                     case when ${organization} is null then 'Relationship ended'
                       else 'Left ' || ${organization} end,
                     'Last working day'
              from ${relationships} relationship
              where relationship.person_id = record_id
                and relationship.effective_to is not null
              union all
              select 'assignment', assignment.id, assignment.effective_from, 1,
                     case when ${previousJob} is not null
                       then ${previousJob} || ' → ' || ${job}
                       else 'Assigned ' || ${job} end,
                     ${assignmentDetail}
              from ${assignments} assignment
              ${assignmentJoins}
              where relationship.person_id = record_id
              union all
              select 'assignment', assignment.id,
                     cast(assignment.effective_to - interval '1 day' as date), 3,
                     'Assignment ended: ' || ${job},
                     ${assignmentDetail}
              from ${assignments} assignment
              ${assignmentJoins}
              where relationship.person_id = record_id
                and assignment.effective_to is not null
                and (relationship.effective_to is null
                  or assignment.effective_to <> relationship.effective_to)
                and not exists (
                  select 1 from ${assignments} next_assignment
                  where next_assignment.worker_relationship_id = assignment.worker_relationship_id
                    and next_assignment.is_primary = assignment.is_primary
                    and next_assignment.effective_from = assignment.effective_to
                )
              ${reporting}
            ) event
            order by event.event_date desc, event.sort_order desc
          `,
        );
        s.defScalar(
          "workforce_history_count",
          sql`(select count(*) from workforce_history_events where kind <> 'today')`,
        );
      }}
    >
      <Data
        local
        procedure={(s) => s.defScalar("workforce_history_open", false)}
      >
        <div className="border-t border-divider pt-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) =>
              s.setScalar(
                "workforce_history_open",
                sql`not workforce_history_open`,
              )}
          >
            <span className="inline-flex items-center gap-2">
              <Show when={sql`workforce_history_open`}>
                <MaterialIcon icon="ExpandMore" className="text-[18px]" />
              </Show>
              <Show when={sql`not workforce_history_open`}>
                <MaterialIcon icon="ChevronRight" className="text-[18px]" />
              </Show>
              <span>History</span>
              <span className="font-normal text-secondary">
                {sql`case workforce_history_count when 1 then '1 change'
                  else cast(workforce_history_count as string) || ' changes' end`}
              </span>
            </span>
          </Button>
          <Show when={sql`workforce_history_open`}>
            <div
              role="list"
              aria-label="Workforce history"
              className="mt-3 flex flex-col"
            >
              <Each
                table="workforce_history_events"
                recordName="workforce_event"
              >
                <div
                  role="listitem"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "96px 20px minmax(0, 1fr) auto",
                    columnGap: "12px",
                    alignItems: "start",
                  }}
                >
                  <Typography
                    level="body-sm"
                    className="text-right text-secondary whitespace-nowrap"
                  >
                    {sql`case when workforce_event.kind = 'today' then 'Today'
                      else ${
                      workforceIsoDate(sql`workforce_event.event_date`)
                    } end`}
                  </Typography>
                  <div className="flex flex-col items-center self-stretch">
                    <Switch>
                      <Match when={sql`workforce_event.kind = 'today'`}>
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-neutral-800" />
                      </Match>
                      <Match when={sql`workforce_event.is_scheduled`}>
                        <span className="mt-1 h-3 w-3 rounded-full border-2 border-dashed border-primary-500" />
                      </Match>
                      <Match when={sql`workforce_event.sort_order = 3`}>
                        <span className="mt-1 h-3 w-3 rounded-full bg-neutral-400" />
                      </Match>
                      <Match when={sql`true`}>
                        <span className="mt-1 h-3 w-3 rounded-full bg-primary-500" />
                      </Match>
                    </Switch>
                    <Show when={sql`not workforce_event.is_last`}>
                      <span className="mt-1 min-h-[20px] w-0.5 flex-1 bg-neutral-200" />
                    </Show>
                  </div>
                  <div className="min-w-0 pb-4">
                    <Show when={sql`workforce_event.kind = 'today'`}>
                      <Typography level="body-sm" className="text-secondary">
                        {sql`workforce_event.title`}
                      </Typography>
                    </Show>
                    <Show when={sql`workforce_event.kind <> 'today'`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography level="title-sm">
                          {sql`workforce_event.title`}
                        </Typography>
                        <Show when={sql`workforce_event.is_scheduled`}>
                          <Chip size="sm" variant="soft" color="primary">
                            Scheduled
                          </Chip>
                        </Show>
                      </div>
                      <Show when={sql`workforce_event.detail <> ''`}>
                        <Typography
                          level="body-sm"
                          className="mt-0.5 text-secondary"
                        >
                          {sql`workforce_event.detail`}
                        </Typography>
                      </Show>
                    </Show>
                  </div>
                  <Switch>
                    <WorkforceHistoryActions
                      kind="relationship"
                      item={
                        <WorkforceRelationshipCorrectMenuItem
                          recordId={sql`workforce_event.source_id`}
                        />
                      }
                    />
                    <WorkforceHistoryActions
                      kind="assignment"
                      item={
                        <WorkforceAssignmentCorrectMenuItem
                          recordId={sql`workforce_event.source_id`}
                        />
                      }
                    />
                    {block.reportingRelationshipsTable && (
                      <WorkforceHistoryActions
                        kind="reporting"
                        item={
                          <WorkforceReportingCorrectMenuItem
                            recordId={sql`workforce_event.source_id`}
                          />
                        }
                      />
                    )}
                  </Switch>
                </div>
              </Each>
            </div>
          </Show>
        </div>
      </Data>
    </Data>
  );
}

/**
 * Standard workforce surface for embedding in a person detail page. Current
 * relationships, assignments, and reporting lines render as cards above one
 * history timeline that keeps the block's validation-aware corrections.
 */
export function WorkforcePersonManagement() {
  const block = system.block(WorkforceBlock);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {block.opts.enableReferenceDataCreation && (
          <AccessCheck
            when={system.block(AuthBlock).opts.accessPolicy
              ? isAccessAdministrator()
              : sql.true}
          >
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                startIcon="Settings"
                href={block.routes.referenceDataPath}
              >
                Configure workforce
              </Button>
            </div>
          </AccessCheck>
        )}
        <WorkforcePersonAccessStatus />
      </div>
      <WorkforcePersonRelationshipCards />
      <WorkforcePersonAssignmentCards />
      <WorkforcePersonReportingChips />
      <WorkforcePersonHistory />
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
        <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
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
          <div className="hidden sm:block sm:flex-1" />
          <PageHeader.Actions>
            {props.rightSideHeader ?? <WorkforcePersonAccountAction />}
          </PageHeader.Actions>
        </div>
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
      canEdit={system.block(AuthBlock).opts.accessPolicy
        ? isAccessAdministrator()
        : undefined}
      defaultView={{
        displayColumns: [
          "display_name",
          "current_job",
          ...(block.organizationMode === "multiple" ? ["current_company"] : []),
          "status",
          "login_status",
          "email",
        ],
        columnOrder: [
          "display_name",
          "current_job",
          ...(block.organizationMode === "multiple" ? ["current_company"] : []),
          "status",
          "login_status",
          "email",
        ],
      }}
      columns={(b) => {
        for (
          const field of Object.keys(system.db.tables[block.peopleTable].fields)
        ) {
          if (field === "sys_user_id") continue;
          b.addField(field, {
            ...(field === "display_name"
              ? { displayName: "Name", initialWidth: 220 }
              : {}),
            beforeUpdate: () => (s) => block.assertManagementSession(s),
            afterUpdate: field === "status"
              ? (_value, recordId) => (s) =>
                syncWorkforcePersonAccess(s, block, sql`${recordId}`)
              : undefined,
          });
        }
        b.virtualColumn({
          storageName: "current_job",
          displayName: "Current job",
          initialWidth: 200,
          expr: sql`(select name from db.${
            sql.ref(block.jobProfilesTable)
          } where id = ${block.personPrimaryJobProfileId(sql`record`)})`,
        });
        if (block.organizationMode === "multiple") {
          b.virtualColumn({
            storageName: "current_company",
            displayName: "Company",
            initialWidth: 200,
            expr: block.organizationDisplayName(
              block.personEmployerOrganizationId(sql`record`),
            ),
          });
        }
        b.virtualColumn({
          storageName: "login_status",
          displayName: "Portal login",
          initialWidth: 140,
          expr:
            sql`coalesce((select case when disabled then 'Disabled' else 'Enabled' end from db.sys_users where id = ${
              block.personSysUserId(sql`record`)
            }), 'No login')`,
        });
      }}
      quickSearch
      emptyState={
        <Data
          procedure={(s) =>
            s.defScalar(
              "workforce_has_people",
              sql`exists (select 1 from db.${sql.ref(block.peopleTable)})`,
            )}
        >
          <div className="p-6 sm:p-8 flex flex-col gap-2">
            <Typography level="title-lg">
              {sql`case when workforce_has_people then 'No people match this view' else 'No people yet' end`}
            </Typography>
            <Typography level="body-sm">
              {sql`case when workforce_has_people then 'Try another search or clear your filters to see more people.' else 'Add a person or import a CSV to get started.' end`}
            </Typography>
          </div>
        </Data>
      }
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
    <div>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 w-full">
          <div>
            <Typography level="body-sm" className="text-secondary">
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
          columns={(b) => b.autoFields()}
          emptyState={`No ${props.title.toLowerCase()} yet.`}
          actions={(b) =>
            b.edit({
              afterTransactionStart: (s) => block.assertManagementSession(s),
              beforeTransactionCommit: (s) =>
                reconcileWorkforceReferenceDataAuthRules(s, block),
            })}
        />
      </CardContent>
    </div>
  );
}

export function WorkforceReferenceDataPage(
  props: WorkforceReferenceDataPageProps,
) {
  const block = system.block(WorkforceBlock);
  const tabs = [
    ...(block.organizationsTable
      ? [{
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
      }]
      : []),
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
        content: <WorkforceOrgUnitHierarchy workforce={block} />,
      }]
      : []),
    ...(block.locationsTable
      ? [{
        value: "locations",
        label: "Locations",
        content: (
          <LocationsBlock.Management
            locations={block.opts.locations!}
            allowCreate={Boolean(block.opts.enableReferenceDataCreation)}
            afterTransactionStart={(s) => block.assertManagementSession(s)}
            beforeTransactionCommit={(s) =>
              reconcileWorkforceReferenceDataAuthRules(s, block)}
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
        defaultValue={block.organizationMode === "single"
          ? "job_profiles"
          : "organizations"}
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
  organizationsTable?: string;
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
    if (
      opts.singleOrganization !== undefined &&
      (opts.singleOrganization.trim().length === 0 ||
        opts.singleOrganization.length > 200)
    ) {
      throw new Error(
        "WorkforceBlock singleOrganization must be a nonblank name of at most 200 characters.",
      );
    }
    this.peopleTable = opts.peopleTable ?? "workforce_people";
    this.organizationsTable = opts.singleOrganization === undefined
      ? opts.organizationsTable ?? "workforce_organizations"
      : undefined;
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
          select name
          from db.${sql.ref(this.orgUnitsTable!)}
          where id = ${this.personPrimaryOrgUnitId!(personRecord)}
        )`;
    }
    if (opts.locations) {
      this.locationsTable = opts.locations.locationsTable;
      this.personPrimaryLocationId = (personRecord) =>
        this.assignmentFact(personRecord, sql`wf_a.workforce_location_id`);
      this.personPrimaryLocationDisplay = (personRecord) =>
        sql`(
          select path
          from (${locationPaths()}) location
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

  locationOptions(opts?: { includeInactive?: boolean }): Sql {
    if (!this.locationsTable) {
      throw new Error("Workforce locations are not enabled.");
    }
    return sql`select path.id, path.path as name from (${locationPaths()}) path
      join db.${sql.ref(this.locationsTable)} location on location.id = path.id
      where ${opts?.includeInactive ? sql`true` : sql`location.active`}
      order by path.path`;
  }

  get personTable() {
    return this.peopleTable;
  }

  get routes() {
    return this.#routes;
  }

  get organizationMode() {
    return this.opts.singleOrganization === undefined ? "multiple" : "single";
  }

  /** Configured display name in single mode; no organization record is stored. */
  get singleOrganization() {
    return this.opts.singleOrganization;
  }

  organizationDisplayName(organizationId: Sql): Sql {
    if (this.opts.singleOrganization !== undefined) {
      return sql.lit(this.opts.singleOrganization);
    }
    if (!this.organizationsTable) {
      throw new Error("Workforce organization storage is not configured.");
    }
    return sql`(select name from db.${
      sql.ref(this.organizationsTable)
    } where id = ${organizationId})`;
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
      s.callStoredProcedure("workforce_assert_staff_person_permission", {
        inputScalars: { p_person_id: sql`staff_target_person_id` },
      });
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
    const approved = sql`job.id is not null and (${
      this.opts.assignableJobProfiles?.(sql`job`) ?? sql.true
    })`;
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
          where workforce_auth_role_mapping_id = mapping.id`;
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

  validatePersonIntervals(s: ModifyStatements, personId: Sql) {
    s.callStoredProcedure("workforce_validate_person_intervals", {
      inputScalars: { p_person_id: personId },
    });
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
    if (!this.organizationsTable) return sql.null;
    return this.relationshipFact(
      personRecord,
      sql`wf_wr.workforce_organization_id`,
    );
  }

  personHostOrganizationId(personRecord: Sql) {
    if (!this.organizationsTable) return sql.null;
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
      select name
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
`;
    if (this.organizationsTable) {
      match = sql`${match}
      and (${audience}.employer_workforce_organization_id is null
        or ${audience}.employer_workforce_organization_id = ${
        this.personEmployerOrganizationId(person)
      })`;
    }
    // Assignment-level facets must all be satisfied by one active
    // assignment; when every assignment-level column is null there is no
    // assignment constraint (so all-null audiences match everyone).
    const assignmentColumns: Sql[] = [
      sql`${audience}.workforce_job_profile_id`,
      sql`${audience}.assignment_status`,
    ];
    let assignmentWhere = sql`
      (${audience}.workforce_job_profile_id is null
        or wf_a.workforce_job_profile_id = ${audience}.workforce_job_profile_id)
      and (${audience}.assignment_status is null
        or lower(wf_a.status) = lower(${audience}.assignment_status))`;
    if (this.organizationsTable) {
      assignmentColumns.push(sql`${audience}.host_workforce_organization_id`);
      assignmentWhere = sql`${assignmentWhere}
      and (${audience}.host_workforce_organization_id is null
        or coalesce(wf_a.host_workforce_organization_id, wf_wr.workforce_organization_id)
          = ${audience}.host_workforce_organization_id)
`;
    }
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
      this.opts.locations &&
      (!system.hasBlock(LocationsBlock) ||
        system.block(LocationsBlock) !== this.opts.locations)
    ) {
      throw new Error(
        "Register the shared LocationsBlock instance before WorkforceBlock.",
      );
    }
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

    if (this.organizationsTable) {
      system.db.table(this.organizationsTable, (table) => {
        table.string("name", 200).notNull().unique();
        table.bool("is_active").notNull().default(sql`true`);
        table.recordDisplayName(["name"]);
        table.searchConfig({ fields: [{ field: "name", priority: 1 }] });
        this.opts.defineOrganizations?.(table);
      });
    }

    if (this.orgUnitsTable) {
      system.db.table(this.orgUnitsTable, (table) => {
        if (this.organizationsTable) {
          table.fk("workforce_organization_id", this.organizationsTable)
            .notNull();
        }
        table.fk("parent_org_unit_id", this.orgUnitsTable!);
        table.string("name", 200).notNull();
        table.bool("is_active").notNull().default(sql`true`);
        table.recordDisplayName(["name"]);
        table.searchConfig({
          fields: [
            { field: "name", priority: 1 },
          ],
        });
        this.opts.defineOrgUnits?.(table);
      });
    }

    system.db.table(this.jobProfilesTable, (table) => {
      table.string("name", 150).notNull().unique();
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
        ],
      });
      this.opts.defineJobProfiles?.(table);
    });

    if (this.positionsTable) {
      system.db.table(this.positionsTable, (table) => {
        table.string("name", 200).notNull();
        if (this.organizationsTable) {
          table.fk("workforce_organization_id", this.organizationsTable);
        }
        if (this.orgUnitsTable) {
          table.fk("workforce_org_unit_id", this.orgUnitsTable);
        }
        if (this.locationsTable) {
          table.fk("workforce_location_id", this.locationsTable).onDelete(
            "Restrict",
          );
        }
        table.fk("workforce_job_profile_id", this.jobProfilesTable);
        table.bool("is_active").notNull().default(sql`true`);
        table.recordDisplayName(["name"]);
        table.searchConfig({
          fields: [
            { field: "name", priority: 1 },
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
      if (this.organizationsTable) {
        table.fk("workforce_organization_id", this.organizationsTable)
          .notNull();
      }
      table.enum("worker_type", "workforce_worker_type").notNull().default(
        sql.lit(this.workerTypes[0].name),
      );
      table.enum("status", "workforce_relationship_status").notNull().default(
        sql.lit(this.activeRelationshipStatus),
      );
      table.date("effective_from").notNull().default(sql`current_date()`);
      table.date("effective_to").displayName("Ends before");
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
      if (this.organizationsTable) {
        table.fk("host_workforce_organization_id", this.organizationsTable);
      }
      table.fk("workforce_job_profile_id", this.jobProfilesTable);
      if (this.positionsTable) {
        table.fk("workforce_position_id", this.positionsTable);
      }
      if (this.orgUnitsTable) {
        table.fk("workforce_org_unit_id", this.orgUnitsTable);
      }
      if (this.locationsTable) {
        table.fk("workforce_location_id", this.locationsTable).onDelete(
          "Restrict",
        );
      }
      table.bool("is_primary").notNull().default(sql`false`);
      table.enum("status", "workforce_assignment_status").notNull().default(
        sql.lit(this.activeAssignmentStatus),
      );
      table.date("effective_from").notNull().default(sql`current_date()`);
      table.date("effective_to").displayName("Ends before");
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
        table.date("effective_to").displayName("Ends before");
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
        if (this.organizationsTable) {
          table.fk(
            "employer_workforce_organization_id",
            this.organizationsTable,
          );
          table.fk("host_workforce_organization_id", this.organizationsTable);
        }
        table.fk("workforce_job_profile_id", this.jobProfilesTable);
        if (this.orgUnitsTable) {
          table.fk("workforce_org_unit_id", this.orgUnitsTable);
        }
        if (this.locationsTable) {
          table.fk("workforce_location_id", this.locationsTable).onDelete(
            "Restrict",
          );
        }
        table.date("effective_from");
        table.date("effective_to").displayName("Ends before");
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
    registerWorkforceIntervalValidation(this);
    registerWorkforceOrgUnitValidation(this);
    if (
      system.hasBlock(AuthBlock) && system.block(AuthBlock).opts.accessPolicy
    ) {
      // Keeps the staff permission SQL out of every UI route that writes people.
      system.storedProcedure({
        name: "workforce_assert_staff_person_permission",
        transaction: "caller",
        inputScalars: [{ name: "p_person_id", type: "BigInt" }],
        procedure: (s) => this.assertStaffPersonPermission(s, sql`p_person_id`),
      });
    }
    if (this.opts.enableRelationshipAndAssignmentCreation) {
      registerWorkforceCreateActionProcedures(this);
      registerWorkforceEndRelationship(this);
    }
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
