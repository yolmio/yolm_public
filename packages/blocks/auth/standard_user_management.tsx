import { Alert } from "components/alert";
import { Card, CardOverflow } from "components/card";
import { Chip } from "components/chip";
import { InlineRecordDisplay } from "components/inline_record_display";
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
import { TableRecordSelect } from "components/table_record_select";
import { Divider } from "components/divider";
import { Typography } from "components/typography";
import { InsertPage } from "pages/insert_page";
import { UpdatePage } from "pages/update_page";
import { singularize } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type { IServerBaseStatements, UiServerStatements } from "std/statements";
import { useBlock } from "std/system";
import { Route, Show, usePhase } from "std/ui";
import type { Node } from "std/ui";
import { Form, useFieldHelper } from "std/form";
import { Data } from "std/data";
import { AuthBlock, currentUserHasPermission } from "./index";
import { AccessCheck } from "./access_check";
import {
  assertAccessAdministrator,
  assertOriginalAccessActor,
  canViewStaffAccess,
  isAccessAdministrator,
} from "./access_policy";
import { UserDetailPage, UserForm } from "./users";
import type { ImpersonationAppOption } from "./users";
import { UsersList } from "./users";

export type UserProfileInsertBehavior = "link" | "create" | "link_or_create";
export type UserProfileUpdateBehavior = "link" | "edit" | "link_or_edit";

export interface UserProfileManagementOptions {
  insert?: UserProfileInsertBehavior;
  update?: UserProfileUpdateBehavior;
}

export type UserProfileManagementConfig = Record<
  string,
  UserProfileManagementOptions
>;

interface LinkedProfileSelectProps {
  tableName: string;
  where: Sql;
  placeholder: string;
}

function LinkedProfileSelect(props: LinkedProfileSelectProps) {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  return (
    <TableRecordSelect
      tableName={props.tableName}
      value={field.value}
      where={props.where}
      disableDialogInsert
      placeholder={props.placeholder}
      variant="outlined"
      onSelectValue={(s, value) => {
        field.setValue(s, value);
      }}
    />
  );
}

interface UserProfileCardsProps {
  isNew?: boolean;
  management?: UserProfileManagementConfig;
}

function getInsertBehavior(
  management: UserProfileManagementConfig | undefined,
  tableName: string,
): UserProfileInsertBehavior {
  return management?.[tableName]?.insert ?? "link";
}

function getUpdateBehavior(
  management: UserProfileManagementConfig | undefined,
  tableName: string,
): UserProfileUpdateBehavior {
  return management?.[tableName]?.update ?? "link_or_edit";
}

function canLinkOnInsert(behavior: UserProfileInsertBehavior) {
  return behavior === "link" || behavior === "link_or_create";
}

function canCreateOnInsert(behavior: UserProfileInsertBehavior) {
  return behavior === "create" || behavior === "link_or_create";
}

function canLinkOnUpdate(behavior: UserProfileUpdateBehavior) {
  return behavior === "link" || behavior === "link_or_edit";
}

function canEditOnUpdate(behavior: UserProfileUpdateBehavior) {
  return behavior === "edit" || behavior === "link_or_edit";
}

function insertLinkStateName(fieldName: string) {
  return `write_${fieldName}_profile_link`;
}

function insertCreateStateName(fieldName: string) {
  return `write_${fieldName}_profile_create`;
}

function updateProfileStateName(fieldName: string) {
  return `write_${fieldName}_profile`;
}

function relationExistsIdent(stateName: string) {
  return sql`ui.${sql.ref(stateName)}.write_relation_exists`;
}

function tempLinkedProfileIdent(fieldName: string) {
  return sql`ui.${sql.ref(insertLinkStateName(fieldName))}.${
    sql.ref(fieldName)
  }`;
}

interface InsertProfileModeControlProps {
  createStateName: string;
}

function InsertProfileModeControl(props: InsertProfileModeControlProps) {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  const createSelected = relationExistsIdent(props.createStateName);
  return (
    <RadioGroup orientation="horizontal" size="sm">
      <Radio
        label="Link existing"
        aria-label="Link existing"
        checked={sql.not(createSelected)}
        onChange={(s) => {
          s.modify(
            sql`update ui.${
              sql.ref(props.createStateName)
            } set write_relation_exists = false`,
          );
        }}
      />
      <Radio
        label="Create new"
        aria-label="Create new"
        checked={createSelected}
        onChange={(s) => {
          field.setValue(s, sql.null);
          s.modify(
            sql`update ui.${
              sql.ref(props.createStateName)
            } set write_relation_exists = true`,
          );
        }}
      />
    </RadioGroup>
  );
}

interface InsertProfileSectionProps {
  tableName: string;
  fieldName: string;
  displayName: string;
  where: Sql;
  behavior: UserProfileInsertBehavior;
  writeFields: Node;
  onInsert?: <T extends IServerBaseStatements>(
    s: T,
    recordId: NumericExpr,
  ) => void;
}

function InsertProfileSection(props: InsertProfileSectionProps) {
  const createStateName = insertCreateStateName(props.fieldName);
  const createSelected = relationExistsIdent(createStateName);
  return (
    <>
      {canLinkOnInsert(props.behavior) && (
        <Form.Temporary name={insertLinkStateName(props.fieldName)}>
          <Form.Field field={props.fieldName} fieldType="BigInt">
            {props.behavior === "link_or_create" && (
              <InsertProfileModeControl createStateName={createStateName} />
            )}
            <Show
              when={props.behavior === "link"
                ? sql.true
                : sql.not(createSelected)}
            >
              <LinkedProfileSelect
                tableName={props.tableName}
                where={props.where}
                placeholder={`Select ${props.displayName}`}
              />
            </Show>
          </Form.Field>
        </Form.Temporary>
      )}
      {canCreateOnInsert(props.behavior) && (
        <Form.Relation
          table={props.tableName}
          stateName={createStateName}
          many={false}
          optional={props.behavior !== "create"}
          optionalExistsByDefault={props.behavior === "create"}
          onInsert={props.onInsert}
        >
          <Show
            when={props.behavior === "create" ? sql.true : createSelected}
          >
            <Typography level="title-lg">
              {props.displayName} Information
            </Typography>
            {props.writeFields}
          </Show>
        </Form.Relation>
      )}
    </>
  );
}

interface UpdateProfileSectionProps {
  tableName: string;
  fieldName: string;
  displayName: string;
  where: Sql;
  behavior: UserProfileUpdateBehavior;
  writeFields: Node;
  selectedIdent: BooleanExpr;
  editableIdent: BooleanExpr;
}

function UpdateProfileSection(props: UpdateProfileSectionProps) {
  return (
    <>
      <Form.Field field={props.fieldName}>
        {canLinkOnUpdate(props.behavior)
          ? (
            <LinkedProfileSelect
              tableName={props.tableName}
              where={props.where}
              placeholder={`Select ${props.displayName}`}
            />
          )
          : <></>}
      </Form.Field>
      {canEditOnUpdate(props.behavior) && (
        <Form.Update
          table={props.tableName}
          stateName={updateProfileStateName(props.fieldName)}
          where={sql`id = ui.write_sys_user.${sql.ref(props.fieldName)}`}
          filterBeforeSubmit={props.editableIdent}
        >
          <Show when={props.editableIdent}>
            <Typography level="title-lg">
              {props.displayName} Information
            </Typography>
            {props.writeFields}
          </Show>
          <Show
            when={sql.and(
              props.selectedIdent,
              sql.not(props.editableIdent),
            )}
          >
            <Typography level="body-sm" color="neutral">
              Save this user to edit the selected profile information.
            </Typography>
          </Show>
        </Form.Update>
      )}
    </>
  );
}

export function UserProfileCards(props: UserProfileCardsProps = {}) {
  const authBlock = useBlock(AuthBlock);
  if (authBlock.userTypes.length === 0) {
    return null;
  }
  const sysUserStateName = "write_sys_user";

  function getSelectedIdent(fieldName: string) {
    return sql`ui.${sql.ref(sysUserStateName)}.${
      sql.ref(fieldName)
    } is not null`;
  }

  function getEditableIdent(fieldName: string) {
    const stateName = updateProfileStateName(fieldName);
    return sql.and(
      getSelectedIdent(fieldName),
      sql`ui.${sql.ref(stateName)}.write_db_id = ui.${
        sql.ref(sysUserStateName)
      }.${sql.ref(fieldName)}`,
    );
  }

  function availableProfileWhere(fieldName: string) {
    return props.isNew
      ? sql`id not in (select ${sql.ref(fieldName)} from db.sys_users where ${
        sql.ref(fieldName)
      } is not null)`
      : sql`id not in (select ${sql.ref(fieldName)} from db.sys_users where ${
        sql.ref(fieldName)
      } is not null and id != ui.record_id)`;
  }

  function getHasProfileIdent(
    tableName: string,
    fieldName: string,
  ) {
    if (!props.isNew) {
      return getSelectedIdent(fieldName);
    }
    const insertBehavior = getInsertBehavior(props.management, tableName);
    const conditions = [];
    if (canLinkOnInsert(insertBehavior)) {
      conditions.push(sql`${tempLinkedProfileIdent(fieldName)} is not null`);
    }
    if (insertBehavior === "create") {
      conditions.push(sql.true);
    } else if (insertBehavior === "link_or_create") {
      conditions.push(relationExistsIdent(insertCreateStateName(fieldName)));
    }
    return sql.or(...conditions);
  }

  const hasInsertLink = props.isNew &&
    authBlock.userTypes.some((t) =>
      canLinkOnInsert(getInsertBehavior(props.management, t.table.name))
    );
  const hasInsertCreate = props.isNew &&
    authBlock.userTypes.some((t) =>
      canCreateOnInsert(getInsertBehavior(props.management, t.table.name))
    );
  const hasUpdateLink = !props.isNew &&
    authBlock.userTypes.some((t) =>
      canLinkOnUpdate(getUpdateBehavior(props.management, t.table.name))
    );
  const hasUpdateEdit = !props.isNew &&
    authBlock.userTypes.some((t) =>
      canEditOnUpdate(getUpdateBehavior(props.management, t.table.name))
    );
  const description = props.isNew
    ? hasInsertLink && hasInsertCreate
      ? "Select or create profile records for this login."
      : hasInsertCreate
      ? "Create profile records for this login."
      : "Select existing profile records for this login."
    : hasUpdateLink && hasUpdateEdit
    ? "Select existing profile records and edit profile details for this login."
    : hasUpdateEdit
    ? "Edit profile records for this login."
    : "Select existing profile records for this login.";

  return (
    <Card
      variant="outlined"
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 2,
        gridColumnSpan: 12,
        md: {
          gridTemplateColumns: "auto 1fr",
        },
      }}
    >
      <CardOverflow
        row
        variant="soft"
        className="flex flex-col gap-4 py-6 pr-4"
      >
        <Typography level="body-lg">
          Linked Profiles
        </Typography>
        <Typography level="body-sm" color="neutral">
          {description}
        </Typography>
      </CardOverflow>

      <div className="flex flex-col gap-4">
        <Show
          when={sql.not(
            sql.or(
              ...authBlock.userTypes.map((t) =>
                getHasProfileIdent(t.table.name, t.fieldName)
              ),
            ),
          )}
        >
          <Typography level="body-md" color="neutral">
            Please select at least one linked profile
          </Typography>
        </Show>

        {authBlock.userTypes.map((t, i) => (
          <>
            {i !== 0 && <Divider />}
            <div className="flex flex-col gap-3">
              {(() => {
                const displayName = singularize(t.table.displayName);
                const insertBehavior = getInsertBehavior(
                  props.management,
                  t.table.name,
                );
                const updateBehavior = getUpdateBehavior(
                  props.management,
                  t.table.name,
                );
                const selectedIdent = getSelectedIdent(t.fieldName);
                const editableIdent = getEditableIdent(t.fieldName);
                return (
                  <>
                    <Typography level="title-md">
                      {displayName}
                    </Typography>
                    {props.isNew
                      ? (
                        <InsertProfileSection
                          tableName={t.table.name}
                          fieldName={t.fieldName}
                          displayName={displayName}
                          where={availableProfileWhere(t.fieldName)}
                          behavior={insertBehavior}
                          writeFields={t.writeFields}
                          onInsert={t.onInsert}
                        />
                      )
                      : (
                        <UpdateProfileSection
                          tableName={t.table.name}
                          fieldName={t.fieldName}
                          displayName={displayName}
                          where={availableProfileWhere(t.fieldName)}
                          behavior={updateBehavior}
                          writeFields={t.writeFields}
                          selectedIdent={selectedIdent}
                          editableIdent={editableIdent}
                        />
                      )}
                    <Show
                      when={sql.not(
                        getHasProfileIdent(t.table.name, t.fieldName),
                      )}
                    >
                      <Typography level="body-sm" color="neutral">
                        No {displayName} linked
                      </Typography>
                    </Show>
                  </>
                );
              })()}
            </div>
          </>
        ))}
      </div>
    </Card>
  );
}

function UserDetailInfo() {
  const authBlock = useBlock(AuthBlock);
  if (authBlock.userTypes.length === 1) {
    const t = authBlock.userTypes[0];
    return (
      <Data
        procedure={(s) => {
          s.defRecord(
            "user_type_detail",
            sql`select t.* from ${t.table.identWithDb} t
              join db.sys_users u on u.${sql.ref(t.fieldName)} = t.id
              where u.id = ui.record_id`,
          );
        }}
      >
        {t.detailInfoNode}
      </Data>
    );
  }
  return authBlock.userTypes.map((t) => (
    <Data
      procedure={(s) => {
        s.defScalar(
          "has_user_type",
          sql`(select ${
            sql.ref(t.fieldName)
          } is not null from db.sys_users where id = ui.record_id)`,
        );
        s.defRecord(
          "user_type_detail",
          sql`select t.* from ${t.table.identWithDb} t
            join db.sys_users u on u.${sql.ref(t.fieldName)} = t.id
            where u.id = ui.record_id`,
        );
      }}
    >
      <Show when={sql`has_user_type`}>
        <Typography level="title-lg" sx={{ gridColumnSpan: 2 }}>
          {singularize(t.table.displayName)} Information
        </Typography>
        {t.detailInfoNode}
      </Show>
    </Data>
  ));
}

function StandardUserList({
  backHomeButton,
  disableAddButton,
  userFilter,
}: {
  backHomeButton?: boolean;
  disableAddButton?: boolean;
  userFilter?: (userId: Sql) => BooleanExpr;
}) {
  const authBlock = useBlock(AuthBlock);
  if (authBlock.userTypes.length === 0) {
    return (
      <UsersList
        backHomeButton={backHomeButton}
        disableAddButton={disableAddButton}
        userFilter={userFilter}
      />
    );
  }
  if (authBlock.userTypes.length === 1) {
    const tableName = authBlock.userTypes[0].table.name;
    return (
      <UsersList
        backHomeButton={backHomeButton}
        disableAddButton={disableAddButton}
        userFilter={userFilter}
        columns={(b) => {
          b.recordDisplayColumn(
            singularize(tableName) + "_id",
            tableName,
            "Name",
            { field: "user_display_name" },
          );
        }}
      />
    );
  }
  return (
    <UsersList
      backHomeButton={backHomeButton}
      disableAddButton={disableAddButton}
      userFilter={userFilter}
      columns={(b) => {
        b.column(
          "Type",
          ({ record }) => (
            <div className="flex gap-1 flex-wrap">
              {authBlock.userTypes.map((t) => (
                <Show
                  when={sql`${record}.${sql.ref(t.fieldName)} is not null`}
                >
                  <Chip variant="outlined" startDecorator={t.icon} size="sm">
                    {singularize(t.table.displayName)}
                  </Chip>
                </Show>
              ))}
            </div>
          ),
        );
        b.column(
          "Name",
          ({ record }) => {
            const parts = authBlock.userTypes.map((t) => (
              <Show when={sql`${record}.${sql.ref(t.fieldName)} is not null`}>
                <div>
                  <InlineRecordDisplay
                    id={sql`${record}.${sql.ref(t.fieldName)}`}
                    tableName={t.table.name}
                  />
                </div>
              </Show>
            ));
            return <div className="flex flex-col gap-1">{...parts}</div>;
          },
          { field: "user_display_name" },
        );
      }}
    />
  );
}

export interface StandardUserManagementProps {
  backHomeButton?: boolean;
  /** Disable the add-user button and route, e.g. when identities must be
   * created through a dedicated person-management workflow. */
  disableAddButton?: boolean;
  /** Whether Edit Login & Access includes linked profile controls. */
  showProfilesOnUpdate?: boolean;
  /** Whether Login & Access displays linked profile details. */
  showProfilesOnDetail?: boolean;
  /**
   * Legacy permission required to use the user and role management pages.
   * AuthBlock.accessPolicy takes precedence when configured. The
   * routes stay registered (route matching needs static routes) but their
   * content renders an access alert without this permission.
   */
  requiredPermission?: string;
  /**
   * Restrict the identities managed by these routes. The filter applies to
   * the list, direct detail/edit navigation, and every update/detail mutation.
   */
  userFilter?: (userId: Sql) => BooleanExpr;
  userProfiles?: UserProfileManagementConfig;
  /** Applications offered as shortcuts in the impersonation dialog. */
  impersonationApps?: ImpersonationAppOption[];
  onInsert?: {
    beforeTransactionCommit?: (
      s: UiServerStatements,
      recordId: NumericExpr,
    ) => void;
    afterTransactionCommit?: (
      s: UiServerStatements,
      recordId: NumericExpr,
    ) => void;
  };
  onUpdate?: {
    beforeTransactionCommit?: (
      s: UiServerStatements,
      recordId: NumericExpr,
    ) => void;
    afterTransactionCommit?: (
      s: UiServerStatements,
      recordId: NumericExpr,
    ) => void;
  };
}

export function StandardUserManagement(props: StandardUserManagementProps) {
  const {
    onInsert,
    onUpdate,
    backHomeButton,
    disableAddButton,
    requiredPermission,
    userFilter,
    userProfiles,
    impersonationApps,
    showProfilesOnUpdate = true,
    showProfilesOnDetail = true,
  } = props;
  const authBlock = useBlock(AuthBlock);
  const policy = authBlock.opts.accessPolicy;
  const guard = requiredPermission
    ? (children: Node) => (
      <AuthBlock.PermissionCheck
        permission={requiredPermission}
        fallback={
          <Alert color="danger" startIcon="Lock">
            You do not have permission to manage users.
          </Alert>
        }
      >
        {children}
      </AuthBlock.PermissionCheck>
    )
    : undefined;
  const assertManagementPermission = requiredPermission
    ? (s: UiServerStatements) => {
      s.if(
        sql`${
          currentUserHasPermission(sql.lit(requiredPermission))
        } is not true`,
        (s) => {
          s.throwError(sql.lit`You do not have permission to manage users.`);
        },
      );
    }
    : undefined;
  const viewGuard = policy
    ? (children: Node) => (
      <AccessCheck
        when={canViewStaffAccess()}
        fallback={
          <Alert color="danger">
            You do not have permission to view staff access.
          </Alert>
        }
      >
        {children}
      </AccessCheck>
    )
    : guard;
  const adminGuard = policy
    ? (children: Node) => (
      <AccessCheck
        when={isAccessAdministrator()}
        fallback={
          <Alert color="danger">
            System administration is required to edit access definitions.
          </Alert>
        }
      >
        {children}
      </AccessCheck>
    )
    : guard;
  function updateLinkedProfilesOnInsert(
    s: UiServerStatements,
    recordId: NumericExpr,
  ) {
    for (const t of authBlock.userTypes) {
      const behavior = getInsertBehavior(userProfiles, t.table.name);
      if (!canLinkOnInsert(behavior)) {
        continue;
      }
      const selectedProfile = tempLinkedProfileIdent(t.fieldName);
      const shouldLink = behavior === "link"
        ? sql.true
        : sql.not(relationExistsIdent(insertCreateStateName(t.fieldName)));
      s.if(sql.and(shouldLink, sql`${selectedProfile} is not null`), (s) => {
        s.modify(sql`
          update db.sys_users
          set ${sql.ref(t.fieldName)} = ${selectedProfile}
          where id = ${recordId}
        `);
      });
    }
  }
  const usersList = (
    <StandardUserList
      backHomeButton={backHomeButton}
      disableAddButton={disableAddButton}
      userFilter={userFilter}
    />
  );
  const recordGuard = userFilter
    ? (children: Node) => {
      const filtered = (
        <Data
          procedure={(s) => {
            s.defScalar(
              "standard_user_management_record_allowed",
              userFilter(sql`ui.record_id`),
            );
          }}
        >
          <Show
            when={sql`standard_user_management_record_allowed`}
            fallback={
              <Alert color="danger" startIcon="Lock">
                This login is managed through its dedicated account workflow.
              </Alert>
            }
          >
            {children}
          </Show>
        </Data>
      );
      return viewGuard ? viewGuard(filtered) : filtered;
    }
    : viewGuard;
  const assertUserFilter = userFilter
    ? (s: UiServerStatements, userId: Sql) => {
      s.if(sql`${userFilter(userId)} is not true`, (s) => {
        s.throwError(
          sql
            .lit`This login is managed through its dedicated account workflow.`,
        );
      });
    }
    : undefined;
  const beforeUserMutation =
    policy || assertManagementPermission || assertUserFilter
      ? (s: UiServerStatements, userId: Sql) => {
        if (policy) {
          assertOriginalAccessActor(s);
          assertAccessAdministrator(s);
        } else {
          assertManagementPermission?.(s);
        }
        assertUserFilter?.(s, userId);
      }
      : undefined;
  return (
    <>
      <AuthBlock.RolePages
        wrapper={adminGuard}
        beforeMutation={policy
          ? (s) => {
            assertOriginalAccessActor(s);
            assertAccessAdministrator(s);
          }
          : assertManagementPermission}
      />
      <Route path="/users" title="Users">
        {viewGuard ? viewGuard(usersList) : usersList}
      </Route>
      <UpdatePage
        table="sys_users"
        title="Edit Login & Access"
        wrapper={policy && adminGuard
          ? (children) =>
            adminGuard(recordGuard ? recordGuard(children) : children)
          : recordGuard}
        path="/users/{record_id:id}/edit"
        afterTransactionStart={(s) => {
          beforeUserMutation?.(s, sql`ui.record_id`);
        }}
        beforeTransactionCommit={(s) => {
          assertUserFilter?.(s, sql`ui.record_id`);
          onUpdate?.beforeTransactionCommit?.(s, sql`ui.record_id`);
        }}
        afterTransactionCommit={(s) => {
          onUpdate?.afterTransactionCommit?.(s, sql`ui.record_id`);
          s.navigate(sql`'/users/' || ui.record_id`);
        }}
      >
        <UserForm
          cards={showProfilesOnUpdate
            ? <UserProfileCards management={userProfiles} />
            : undefined}
        />
      </UpdatePage>
      {!disableAddButton && (
        <InsertPage
          table="sys_users"
          title="Add Login"
          wrapper={adminGuard}
          path="/users/add"
          values={{ disabled: sql`false` }}
          afterTransactionStart={(s) => {
            if (policy) {
              assertOriginalAccessActor(s);
              assertAccessAdministrator(s);
            } else assertManagementPermission?.(s);
          }}
          beforeTransactionCommit={(s) => {
            s.defScalar("created_user_id", sql`last_record_id(db.sys_users)`);
            updateLinkedProfilesOnInsert(s, sql`created_user_id`);
            assertUserFilter?.(s, sql`created_user_id`);
            onInsert?.beforeTransactionCommit?.(s, sql`created_user_id`);
          }}
          afterTransactionCommit={(s) => {
            onInsert?.afterTransactionCommit?.(s, sql`created_user_id`);
            s.navigate(sql`'/users/' || created_user_id`);
          }}
        >
          <UserForm
            isNew
            cards={<UserProfileCards isNew management={userProfiles} />}
          />
        </InsertPage>
      )}
      <UserDetailPage
        wrapper={recordGuard}
        beforeUserMutation={beforeUserMutation}
        beforeImpersonation={policy
          ? (s, userId) => {
            assertUserFilter?.(s, userId);
          }
          : beforeUserMutation}
        beforeStaffMutation={(s, userId) => assertUserFilter?.(s, userId)}
        impersonationApps={impersonationApps}
        backButtonRef="/users"
        name={authBlock.userTypes.length === 1
          ? (
            <Data
              pendingFallback={null}
              procedure={(s) => {
                const t = authBlock.userTypes[0];
                s.defRecord(
                  "user_type_detail",
                  sql`select t.* from ${t.table.identWithDb} t
                      join db.sys_users u on u.${sql.ref(t.fieldName)} = t.id
                      where u.id = ui.record_id`,
                );
              }}
            >
              {authBlock.userTypes[0].nameNode}
            </Data>
          )
          : (
            <>
              {authBlock.userTypes.map((t) => (
                <Data
                  pendingFallback={null}
                  procedure={(s) => {
                    s.defScalar(
                      "show_user_type_name",
                      sql`(select ${
                        sql.and(
                          sql`${sql.ref(t.fieldName)} is not null`,
                          ...authBlock.userTypes
                            .slice(0, authBlock.userTypes.indexOf(t))
                            .map((previous) =>
                              sql`${sql.ref(previous.fieldName)} is null`
                            ),
                        )
                      } from db.sys_users where id = ui.record_id)`,
                    );
                    s.defRecord(
                      "user_type_detail",
                      sql`select t.* from ${t.table.identWithDb} t
                          join db.sys_users u on u.${
                        sql.ref(t.fieldName)
                      } = t.id
                      where u.id = ui.record_id`,
                    );
                  }}
                >
                  <Show when={sql`show_user_type_name`}>
                    {t.nameNode}
                  </Show>
                </Data>
              ))}
            </>
          )}
        userInfo={showProfilesOnDetail ? <UserDetailInfo /> : undefined}
      />
    </>
  );
}
