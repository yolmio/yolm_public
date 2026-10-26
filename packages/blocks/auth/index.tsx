// import { StaticSecretsBlock } from "blocks/static_secrets";
import { InlineRecordDisplay } from "components/inline_record_display";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { singularize } from "std/inflectors";
import type { SampleDataScriptContext } from "std/sample_data";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type {
  EndpointStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import type {
  Block,
  EnumValue,
  HelperEnum,
  Table,
  TableBuilder,
} from "std/system";
import { Match, Show, Switch } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { Form } from "std/form";
import { defaultEmailOtpAuth, OTPAuth, OTPLogin } from "./otp_auth";
import { EmailPasswordAuth } from "./email_password_auth";
import { RolePages } from "./roles";
import { PermissionEntry, PermissionPicker } from "./permissions";
import { RoleSelector } from "./role_selector";
import {
  StandardUserManagement,
  UserProfileCards,
} from "./standard_user_management";
import { UsernamePasswordAuth } from "./username_password_auth";
import {
  UserAccountManagementButton,
  UserDetailPage,
  UserForm,
  UsersList,
} from "./users";
import { SingleSignOn } from "./single_sign_on";
import type { IdleTimeoutConfig } from "./idle_timeout";
import { authSessionUserExpr } from "./shared";
import { canImpersonateUser } from "./access_policy";
import { registerStaffAccessProcedure } from "./stored_procedures";

type AppAuthType =
  | "otp"
  | "username_password"
  | "email_password"
  | "google"
  | "single_sign_on";

interface UserTypeTable {
  table: string;
  onInsert?: <T extends IServerBaseStatements>(
    s: T,
    recordId: NumericExpr,
  ) => void;
  fieldName?: string;
  icon?: Node;
  tableCellNode?: Node;
  detailInfoNode?: Node;
  nameNode?: Node;
  writeFields?: Node;
}

interface PreppedUserTypeTable {
  table: Table;
  fieldName: string;
  icon?: Node;
  onInsert?: <T extends IServerBaseStatements>(
    s: T,
    recordId: NumericExpr,
  ) => void;

  writeFields: Node;
  tableCellNode: Node;
  detailInfoNode: Node;
  nameNode: Node;
}

/** Second-factor delivery method: authenticator app, SMS code, or emailed code. */
export type AppSecondFactorMethod = "totp" | "sms" | "email";

/**
 * Per-auth-component second-factor settings, passed to login components such
 * as {@link OTPAuth}. Selects which 2FA method to challenge with and how
 * aggressively to rate-limit code generation. Distinct from the system-wide
 * {@link SecondFactorConfig} configured on the {@link AuthBlock}, which
 * defines the available methods and their credentials.
 */
export interface AppSecondFactorConfig {
  method: AppSecondFactorMethod;
  /** Whether the second factor must be completed (vs. optional/skippable). */
  required?: boolean;
  rateLimit?: {
    /** Window over which `maxAttempts` is counted, in minutes. */
    timeWindow?: Sql;
    /** Maximum second-factor codes allowed within `timeWindow`. */
    maxAttempts?: Sql;
  };
}

/**
 * Shared props for the convenience auth wrappers (e.g.
 * {@link defaultEmailOtpAuth}) that render a login screen and gate their
 * children behind a valid session.
 */
export interface DefaultAuthComponentProps {
  applicationName?: string;
  /** Heading shown on the login screen; defaults to `Sign in to <app>`. */
  loginText?: Sql | string;
  /** If set, only users holding this permission may authenticate. */
  requiredPermission?: string;
  /** Additional server-side eligibility expression evaluated against sys_users. */
  validateUser?: BooleanExpr;
  /** Server-side session lifetime; browser cookies are always issued for 1 year. */
  cookieExpiration?: Sql;
  /** Domain the session cookie is scoped to (for cross-subdomain sessions). */
  cookieDomain?: Sql | string;
  /** Override the session cookie name (the OTP auth flow defaults to `y-t`). */
  cookieName?: Sql | string;
  children: Node;
  /** Extra content rendered beneath the login form. */
  belowLoginNode?: Node;
  /** Server hook run after a successful login, e.g. to record activity. */
  afterLoginServer?: (
    s: UiServerStatements,
    props: AfterLoginServerProps,
  ) => void;
  secondFactor?: AppSecondFactorConfig;
  idleTimeout?: IdleTimeoutConfig;
}

/** Identifiers passed to {@link DefaultAuthComponentProps.afterLoginServer}. */
export interface AfterLoginServerProps {
  /** The newly authenticated user's `sys_users` id. */
  user: NumericExpr;
  /** The freshly issued `auth_session_tokens` id. */
  session: NumericExpr;
}

/** TOTP (authenticator-app) second-factor settings. */
export interface TOTPConfig {
  /** Issuer name shown in the authenticator app entry. */
  issuerName: string;
}

/** SMS second-factor settings: how to find the phone and how to send the code. */
export interface SMSConfig {
  /** Resolves a user's phone number from their `sys_users` id. */
  getPhoneFromUserId: (userId: Sql) => Sql;
  /** Custom sender; if omitted, the built-in `sendSms` with `fromPhone` is used. */
  sendSms?: (
    s: UiServerStatements,
    opts: {
      to: Sql;
      code: Sql;
      from?: Sql | string;
      errorJsonScalar?: string;
    },
  ) => void;
  /** Default origin phone number used by the built-in SMS sender. */
  fromPhone?: Sql | string;
}

/** Email second-factor settings: how to find the address and who it's from. */
export interface EmailConfig {
  /** From address for the code email; defaults to the platform sender. */
  fromEmail?: Sql | string;
  /** Resolves a user's email address from their `sys_users` id. */
  getEmailFromUserId: (userId: Sql) => Sql;
}

/**
 * System-wide second-factor configuration set on the {@link AuthBlock}.
 * Setting `secondFactor` provisions the 2FA settings table; each method
 * enabled under `methods` additionally provisions its own
 * `auth_second_factor_*` table and makes that method available to login
 * components. Only `methods` is wired up today — `required`, `userPrompts`,
 * and `recovery` are reserved for future use.
 */
export interface SecondFactorConfig {
  /** Which 2FA methods are available, each with its delivery credentials. */
  methods: {
    totp?: TOTPConfig;
    sms?: SMSConfig;
    email?: EmailConfig;
  };
  /** Reserved (not yet implemented): whether 2FA enrollment is mandatory for all users. */
  required?: boolean;
  /** Reserved (not yet implemented): in-app nudges to enable 2FA. */
  userPrompts?: {
    /** Prompt shown after login nudging the user to enable 2FA. */
    afterLogin?: {
      enabled?: boolean;
      message?: string;
      dismissible?: boolean;
      /** How long a dismissal suppresses the prompt, in days. */
      dismissForDays?: number;
    };
    /** Whether to surface 2FA controls in the user settings UI. */
    showInSettings?: boolean;
  };
  /** Reserved (not yet implemented): backup codes and trusted-device options. */
  recovery?: {
    /** One-time backup codes the user can use if their device is unavailable. */
    backupCodes?: {
      enabled?: boolean;
      /** Number of backup codes to generate. */
      count?: number;
      /** Character length of each backup code. */
      length?: number;
    };
    /** Lets users skip 2FA on remembered devices. */
    trustedDevices?: {
      enabled?: boolean;
      /** Days a trusted device stays exempt from the second factor. */
      expirationDays?: number;
      /** Cap on simultaneously trusted devices per user. */
      maxDevices?: number;
    };
  };
}

interface AuthOpts {
  permissions: HelperEnum["values"];
  /** Enables delegated staff management with an explicit developer authority. */
  accessPolicy?: {
    sysadminPermission: string;
    /** Optional role-name allowlist. By default, roles without protected access are assignable. */
    assignableRoles?: string[];
  };
  appAuthTypes: AppAuthType[];
  legacyPasswords?: boolean;
  /** Allow adding password auth without backfilling existing users. NULL means false. */
  nullableMustChangePassword?: boolean;
  userTable?: (table: TableBuilder) => void;
  userTypes?: (string | UserTypeTable)[];
  disableDisabled?: boolean;
  secondFactor?: SecondFactorConfig;
  /**
   * Record user activity per session in `auth_session_activity`. Required by
   * `idleTimeout`, so activity in any tab or app sharing a session keeps it
   * alive.
   */
  sessionActivity?: boolean;
}

/**
Provides a complete authentication and authorization system with user management, roles, permissions, and impersonation.

Most systems will use this block.

Includes
- backing database tables and enums
- end-to-end authentication and authorization UIs with login, registration, password reset, and OTP login, user/role/permission management
- option of OTP (one-time password) authentication or username/password authentication
- permission checking
- impersonation

Important: Always define user type tables (sql.g employees, developers, etc) before adding AuthBlock to the system.

@category Block

 */
export class AuthBlock implements Block {
  static readonly managementPermissions = [
    {
      name: "can_manage_staff_access",
      displayName: "Manage staff access",
      description: "Assign approved roles and job profiles to other people.",
      group: "Access management",
    },
    {
      name: "can_impersonate_users",
      displayName: "Impersonate users",
      description: "Act as users whose permissions are within your own access.",
      group: "Access management",
    },
  ];
  blockName = "AuthBlock";
  userTypes: PreppedUserTypeTable[] = [];

  componentDependencies: string[] = [];
  description: string | undefined;
  constructor(public opts: AuthOpts) {
    if (system.db.tables.sys_users !== undefined) {
      throw new Error(
        "sys_users table should not be defined when using the AuthBlock since it will be created automatically.",
      );
    }
    if (opts.legacyPasswords && !opts.appAuthTypes.includes("email_password")) {
      throw new Error(
        "AuthBlock legacyPasswords currently requires email_password auth.",
      );
    }
  }

  populate() {
    this.prepareUserTypes();
    if (this.opts.accessPolicy) {
      registerStaffAccessProcedure();
      system.db.scalarFunction({
        name: "auth_can_impersonate",
        parameters: [
          { name: "actor_id", type: "BigInt" },
          { name: "target_id", type: "BigInt" },
        ],
        returnType: "Bool",
        procedure: (s) => {
          s.return(
            canImpersonateUser(sql`input.actor_id`, sql`input.target_id`),
          );
        },
      });
    }
  }

  private prepareUserTypes() {
    if (this.userTypes.length > 0 || !this.opts.userTypes) {
      return;
    }
    this.userTypes = this.opts.userTypes.map((t) => {
      const opts = typeof t === "string" ? { table: t } : t;
      if (!opts.fieldName) {
        opts.fieldName = `${singularize(opts.table)}_id`;
      }
      const table = system.db.tables[opts.table];
      if (!table) {
        throw new Error(`Table ${opts.table} not found`);
      }
      const tableCellNode = opts.tableCellNode ?? null;
      let detailInfoNode = opts.detailInfoNode;
      if (!detailInfoNode) {
        const details = [];
        for (const field of Object.values(table.fields)) {
          if (table.recordDisplayName?.fields.includes(field.name)) {
            continue;
          }
          if (
            field.notNull ||
            ["email", "phone", "title"].includes(field.name)
          ) {
            details.push(
              <>
                <Typography level="title-md">{field.displayName}</Typography>
                <Show
                  when={sql`user_type_detail.${
                    sql.ref(field.name)
                  } is not null`}
                  fallback={
                    <Typography level="body-md" className="text-neutral-500">
                      Not set
                    </Typography>
                  }
                >
                  {sql`user_type_detail.${sql.ref(field.name)}`}
                </Show>
              </>,
            );
          }
        }
        detailInfoNode = details;
      }
      let nameNode = opts.nameNode;
      if (!nameNode) {
        if (table.recordDisplayName) {
          nameNode = table.recordDisplayName.expr(
            ...table.recordDisplayName.fields.map((f) =>
              sql`user_type_detail.${sql.ref(f)}`
            ),
          );
        } else {
          nameNode = sql`user_type_detail.id`;
        }
      }
      let writeFields = opts.writeFields;
      if (!writeFields) {
        const fields = [];
        for (const field of Object.values(table.fields)) {
          if ("usage" in field && field.usage?.type === "Secret") {
            continue;
          }
          fields.push(
            <Form.Field field={field.name}>
              <LabelOnTopFormField />
            </Form.Field>,
          );
        }
        writeFields = fields;
      }
      let icon = opts.icon;
      if (!icon) {
        if (table.name === "developers") {
          icon = <MaterialIcon icon="Code" />;
        }
        if (table.name === "employees") {
          icon = <MaterialIcon icon="Badge" />;
        }
      }
      return {
        table,
        fieldName: opts.fieldName,
        icon,
        tableCellNode,
        detailInfoNode,
        nameNode,
        writeFields,
        onInsert: opts.onInsert,
      };
    });
  }

  initialize() {
    const permissions = [...this.opts.permissions];
    for (const permission of AuthBlock.managementPermissions) {
      if (
        !permissions.some((value) =>
          (typeof value === "string" ? value : value.name) === permission.name
        )
      ) {
        permissions.push(permission);
      }
    }
    if (
      this.opts.accessPolicy &&
      !permissions.some((value) =>
        (typeof value === "string" ? value : value.name) ===
          this.opts.accessPolicy?.sysadminPermission
      )
    ) {
      throw new Error(
        "AuthBlock accessPolicy.sysadminPermission must be a declared permission",
      );
    }
    system.enum_({
      name: "auth_permission",
      values: permissions,
    });

    const db = system.db;

    db.table("sys_users", (table) => {
      table.description(
        "A user is any person that has access to the system. In the database, each transaction has an optional user associated with it in and that id is the id of the sys_users.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      const hasUsernamePassword = this.opts.appAuthTypes.includes(
        "username_password",
      );
      const hasEmailPassword = this.opts.appAuthTypes.includes(
        "email_password",
      );
      if (hasUsernamePassword) {
        table.string("username", 100);
      }
      if (hasUsernamePassword || hasEmailPassword) {
        table.bytes("password_hash", 64);
        table.bytes("password_salt", 32);
        const mustChangePassword = table.bool("must_change_password").default(
          sql`false`,
        );
        if (!this.opts.nullableMustChangePassword) {
          mustChangePassword.notNull();
        }
        if (this.opts.legacyPasswords) {
          table.string("legacy_password_hash", 1000);
          table.string("legacy_password_algorithm", 100);
          table.timestampUtc("legacy_password_migrated_at");
        }
      }
      this.opts.userTable?.(table);
      if (!this.opts.disableDisabled) {
        table.bool("disabled").notNull().default(sql`false`);
      }
      table.timestampUtc("created_at").notNull().default(
        sql`current_timestamp()`,
      );
      table.timestampUtc("last_modified_at").notNull().default(
        sql`current_timestamp()`,
      );
      if (this.opts.userTypes) {
        const normalized = this.opts.userTypes.map((t) => {
          const opts = typeof t === "string" ? { table: t } : t;
          if (!opts.fieldName) {
            opts.fieldName = `${singularize(opts.table)}_id`;
          }
          return opts;
        });
        for (const relatedTable of normalized) {
          const relatedTableModel = system.db.tables[relatedTable.table];
          if (relatedTableModel && !relatedTableModel.sampleDataConfig) {
            relatedTableModel.sampleDataConfig = {
              skipSampleData: true,
            };
          }
          if (!table.hasField(relatedTable.fieldName!)) {
            table
              .fk(relatedTable.fieldName!, relatedTable.table)
              .onDelete("SetToNull");
          }
        }
        // Leaving the related-table-only search config in place breaks UI
        // helpers that only understand direct searchable sys_users fields.
        // table.searchConfig({
        //   relatedTables: normalized.map((t) => {
        //     return {
        //       table: t.table,
        //       relationField: `sys_users.${t.fieldName}`,
        //       ...(system.db.tables[t.table].getSearchConfig() as any),
        //     };
        //   }),
        // });
        if (
          normalized.every((t) => system.db.tables[t.table].recordDisplayName)
        ) {
          table.recordDisplayName(
            normalized.map((t) => t.fieldName!),
            (...ids) => {
              return sql.coalesce(
                ...normalized.map((t, i) => {
                  const table = system.db.tables[t.table];
                  const nameExpr = table.recordDisplayName!.expr(
                    ...table.recordDisplayName!.fields.map(
                      (f) => sql`other.${sql.ref(f)}`,
                    ),
                  );
                  return sql`(select ${nameExpr} from ${table.identWithDb} as other where other.id = ${
                    ids[i]
                  })`;
                }),
              );
            },
          );
        }
        table.virtual(
          "display_name_virtual",
          sql.coalesce(
            ...normalized.map((t) => {
              const table = system.db.tables[t.table];
              const nameExpr = table.recordDisplayName!.expr(
                ...table.recordDisplayName!.fields.map(
                  (f) => sql`other.${sql.ref(f)}`,
                ),
              );
              return sql`(select ${nameExpr} from ${table.identWithDb} as other where other.id = ${
                sql.ref(t.fieldName!)
              })`;
            }),
          ),
        );
        const searchFields = [{ field: "display_name_virtual", priority: 1 }];
        if (hasUsernamePassword) {
          searchFields.push({ field: "username", priority: 2 });
        }
        table.searchConfig({
          fields: searchFields,
        });
        table.virtual(
          "acronym_virtual",
          sql`case
            when contains(display_name_virtual, '@') and contains(display_name_virtual, '.') then
              upper(concat(
                left(split_part(display_name_virtual, '.', 1), 1),
                coalesce(left(split_part(display_name_virtual, '.', 2), 1), '')
              )) else
            upper(concat(
              left(split_part(display_name_virtual, ' ', 1), 1),
              coalesce(left(split_part(display_name_virtual, ' ', 2), 1), '')
            ))
          end`,
        );
        table.inlineRecordDisplay(({ id }) => {
          return (
            <Data
              watch={[id]}
              pendingFallback={null}
              errorFallback={null}
              procedure={(s) => {
                const userType = sql.caseWhen({
                  conditions: normalized.map((t, i) => {
                    return {
                      condition: sql`${sql.ref(t.fieldName!)} is not null`,
                      expr: i,
                    };
                  }),
                });
                const recordId = normalized.length === 1
                  ? sql.ref(normalized[0].fieldName!)
                  : sql.coalesce(
                    ...normalized.map((t) => sql`${sql.ref(t.fieldName!)}`),
                  );
                s.defRecord(
                  "user_info",
                  sql`
                  select ${userType} as user_type,
                    ${recordId} as record_id
                  from sys_users
                  where id = ${id}`,
                );
              }}
            >
              <Switch>
                {normalized.map((t, i) => (
                  <Match when={sql`user_info.user_type = ${i}`}>
                    <InlineRecordDisplay
                      tableName={t.table}
                      id={sql`user_info.record_id`}
                    />
                  </Match>
                ))}
              </Switch>
            </Data>
          );
        });
      }
    });

    db.table("auth_roles", (table) => {
      table.description(
        "A collection of permissions that can be assigned to a user.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("extends", "auth_roles");
      table.string("name", 100).notNull().unique();
      table.string("description", 1000).multiline();
      table.timestampUtc("created_at").notNull().default(
        sql`current_timestamp()`,
      );
      table.timestampUtc("last_modified_at").notNull().default(
        sql`current_timestamp()`,
      );
    });

    db.table("auth_role_permissions", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("auth_roles").notNull();
      table.enum("permission", "auth_permission").notNull();
      table.bool("is_allowed").notNull();
    });

    db.table("auth_user_roles", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.fk("auth_roles").notNull();
    });

    db.table("auth_user_role_sources", (table) => {
      table.description(
        "Tracks non-manual sources that grant an auth role to a user.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.fk("auth_roles").notNull();
      table.string("source", 100).notNull();
      table.bigUint("source_record_id").notNull();
      table.unique([
        "sys_user_id",
        "auth_role_id",
        "source",
        "source_record_id",
      ]);
    });

    db.table("auth_user_permissions", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.enum("permission", "auth_permission").notNull();
      table.bool("is_allowed").notNull();
    });

    db.table("auth_user_permission_sources", (table) => {
      table.description(
        "Tracks non-manual sources that grant a direct permission to a user.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.enum("permission", "auth_permission").notNull();
      table.bool("is_allowed").notNull();
      table.string("source", 100).notNull();
      table.bigUint("source_record_id").notNull();
      table.unique([
        "sys_user_id",
        "permission",
        "source",
        "source_record_id",
      ]);
    });

    db.scalarFunction({
      name: "auth_has_role_permission",
      description:
        "Role grants only; the caller applies explicit user overrides.",
      parameters: [
        { name: "permission", type: { type: "Enum", enum: "auth_permission" } },
        { name: "sys_user_id", type: "BigInt" },
      ],
      returnType: "Bool",
      procedure: (s) => {
        s.defScalar("checked_permission", sql`input.permission`);
        s.defScalar("checked_sys_user_id", sql`input.sys_user_id`);
        s.return(userHasRolePermissionPredicate(
          sql`checked_permission`,
          sql`checked_sys_user_id`,
        ));
      },
    });

    // Public permission resolution is usable from UI expressions and server procedures.
    db.scalarFunction({
      name: "auth_has_permission",
      description:
        "True when the user holds the permission directly or via the recursively resolved role hierarchy.",
      parameters: [
        { name: "permission", type: { type: "Enum", enum: "auth_permission" } },
        { name: "sys_user_id", type: "BigInt" },
      ],
      returnType: "Bool",
      procedure: (s) => {
        // Copy inputs into locals: `input.*` references inside the return
        // expression's subqueries do not resolve reliably in the JIT.
        s.defScalar("checked_permission", sql`input.permission`);
        s.defScalar("checked_sys_user_id", sql`input.sys_user_id`);
        // Multiple explicit rows are allowed: any allow wins, while the
        // presence of only denials suppresses every sourced or role grant.
        // is_allowed is non-null, so a null aggregate means no explicit row.
        s.defScalar(
          "direct_permission",
          sql`(
          select bool_or(is_allowed)
          from db.auth_user_permissions
          where sys_user_id = checked_sys_user_id
            and permission = checked_permission
        )`,
        );
        s.if(sql`direct_permission is not null`, (s) => {
          s.return(sql`direct_permission`);
        });
        s.if(
          sql`exists (
          select 1 from db.auth_user_permission_sources
          where sys_user_id = checked_sys_user_id
            and permission = checked_permission and is_allowed
        )`,
          (s) => s.return(sql`true`),
        );
        s.return(
          sql`fn.auth_has_role_permission(checked_permission, checked_sys_user_id)`,
        );
      },
    });

    db.table("auth_impersonations", (table) => {
      table.description(
        "An impersonation allows a user to act as another user for a limited time on certain domains.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("impersonator", "sys_users").notNull();
      table.fk("impersonatee", "sys_users").notNull();
      table.timestampUtc("issued").notNull();
      table.minutesDuration("duration", "SmallUint").notNull();
      table.string("reason", 1000).notNull();
      table.bool("active").notNull().default(sql`true`); // For manual revocation
    });

    // Impersonation only applies to these domains, useful because having this on the admin
    // app would just log the person out
    db.table("auth_impersonation_domains", (table) => {
      table.description("A domain that an impersonation applies to.");
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("auth_impersonations").notNull();
      table.string("domain", 100).notNull();
    });

    if (
      this.opts.appAuthTypes.includes("otp") ||
      this.opts.appAuthTypes.includes("email_password")
    ) {
      if (!system.enums.auth_otp_registration_type) {
        system.enum_({
          name: "auth_otp_registration_type",
          values: ["email", "sms"],
        });
      }
      db.table("auth_otp_registrations", (table) => {
        table.description(
          "A registration of an OTP for a user, the user has not logged in, but will be able to log in with it if they provide the code within the time limit.",
        );
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("sys_users").notNull();
        table.bytes("hash", 32).notNull();
        table.bytes("salt", 32).notNull();
        table.timestampUtc("registration_time").notNull();
        table.enum("otp_type", "auth_otp_registration_type").notNull();
      });
    }
    const sessionTokenTypes: EnumValue[] = [];
    if (this.opts.appAuthTypes.includes("google")) {
      sessionTokenTypes.push({
        name: "google",
        displayName: "Google",
      });
      system.enum_({
        name: "recent_multi_auth_login_type",
        values: ["google", "email"],
      });
    }
    if (this.opts.appAuthTypes.includes("single_sign_on")) {
      sessionTokenTypes.push({
        name: "single_sign_on",
        displayName: "Single Sign On",
      });
    }
    if (this.opts.appAuthTypes.includes("username_password")) {
      sessionTokenTypes.push({
        name: "username_password",
        displayName: "Username/Password",
      });
    }
    if (this.opts.appAuthTypes.includes("email_password")) {
      sessionTokenTypes.push({
        name: "email_password",
        displayName: "Email/Password",
      });
    }
    if (this.opts.appAuthTypes.includes("otp")) {
      sessionTokenTypes.push({
        name: "otp_email",
        displayName: "OTP Email",
      });
      sessionTokenTypes.push({
        name: "otp_sms",
        displayName: "OTP SMS",
      });
    }
    system.enum_({
      name: "session_token_type",
      values: sessionTokenTypes,
    });
    db.table("auth_session_tokens", (table) => {
      table.description(
        "This is issued whenever a user logs in. It is used to authenticate the user and normally kept in a cookie.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("sys_users").notNull();
      table.uuid("public_id").notNull().unique();
      table.timestampUtc("issued").notNull();
      // Vestigial: never read or written. Session validity is derived from
      // `issued` plus the app-level `cookieExpiration`; this column only
      // remains because deployed databases already contain it.
      table.int("session_duration_seconds");
      table.enum("type", "session_token_type").notNull();
    });

    if (this.opts.sessionActivity) {
      db.table("auth_session_activity", (table) => {
        table.description(
          "Latest user input on a session from any tab or app, so idle timeouts expire only shared sessions that are idle everywhere.",
        );
        table.sampleData({
          skipSampleData: true,
        });
        // Updated about once a minute per active tab; keep that churn out of
        // the retained history.
        table.autoCompact();
        table.fk("auth_session_tokens").notNull().unique();
        table.timestampUtc("last_activity_at").notNull();
        // The longest recent gap between inputs, so a tab that slept through
        // an idle deadline still expires the session after activity resumed.
        table.timestampUtc("idle_gap_from");
        table.timestampUtc("idle_gap_to");
      });
    }

    db.scalarFunction({
      name: "auth_resolve_session_user",
      description:
        "Resolves a session token to its effective user, including domain-scoped impersonation.",
      parameters: [
        { name: "token_id", type: "Uuid" },
        { name: "session_duration_seconds", type: "Int" },
        { name: "domain", type: { type: "String", maxLength: 100 } },
      ],
      returnType: "BigInt",
      procedure: (s) => {
        s.defScalar("checked_token_id", sql`input.token_id`);
        s.defScalar(
          "checked_session_duration_seconds",
          sql`input.session_duration_seconds`,
        );
        s.defScalar("checked_domain", sql`input.domain`);
        s.defScalar(
          "session_user_id",
          sql`(
            select sys_user_id
            from auth_session_tokens
            where public_id = checked_token_id
              ${
            this.opts.disableDisabled
              ? sql``
              : sql`and exists (select 1 from sys_users where id = auth_session_tokens.sys_user_id and not disabled)`
          }
              and now() < date.add(
                second,
                checked_session_duration_seconds,
                issued
              )
          )`,
        );
        s.return(sql`coalesce(
          (
            select impersonatee
            from auth_impersonations
            where impersonator = session_user_id
              and active
              ${
          this.opts.accessPolicy
            ? sql`and fn.auth_can_impersonate(session_user_id, impersonatee)`
            : sql``
        }
              and now() between issued and date.add(minute, duration, issued)
              and exists (
                select 1
                from auth_impersonation_domains
                where domain = checked_domain
                  and auth_impersonation_id = auth_impersonations.id
              )
            order by issued desc, id desc
            limit 1
          ),
          session_user_id
        )`);
      },
    });

    // Login failure tracking table
    db.table("auth_login_failures", (table) => {
      table.description(
        "Tracks failed login attempts for security monitoring and rate limiting.",
      );
      table.sampleData({
        skipSampleData: true,
      });
      table.string("identifier", 255).notNull(); // Email, username, or phone used in login attempt
      table.fk("sys_users"); // Nullable - may not have a valid user
      table.timestampUtc("attempted_at").notNull();
      table.string("failure_reason", 100); // 'invalid_credentials', 'user_disabled', 'too_many_attempts', etc.
      table.string("ip_address", 45); // IPv4 or IPv6
      table.string("user_agent", 500);
      table.enum("auth_type", "session_token_type"); // Which auth method was attempted
    });

    // Second Factor Authentication Tables
    if (this.opts.secondFactor) {
      system.enum_({
        name: "auth_second_factor_method",
        values: ["totp", "sms", "email"],
      });
      // Track user's 2FA settings
      db.table("auth_second_factor_settings", (table) => {
        table.description(
          "Tracks whether a user has enabled second factor authentication and their preferred method.",
        );
        table.sampleData({
          skipSampleData: true,
        });
        table.fk("sys_users").notNull().unique();
        table.bool("enabled").notNull().default(sql`false`);
        table.enum("method", "auth_second_factor_method"); // 'totp', 'sms', 'email'
      });

      // TOTP secrets
      if (this.opts.secondFactor.methods.totp) {
        db.table("auth_second_factor_totp", (table) => {
          table.description(
            "Stores TOTP (Time-based One-Time Password) secrets for users who have enabled authenticator app 2FA.",
          );
          table.sampleData({
            skipSampleData: true,
          });
          table.fk("sys_users").notNull().unique();
          table.bytes("secret", 32).notNull(); // Encrypted TOTP secret
          table.bool("verified").notNull().default(sql`false`);
        });
      }
      if (
        this.opts.secondFactor.methods.sms ||
        this.opts.secondFactor.methods.email
      ) {
        system.enum_({
          name: "auth_second_factor_otp_type",
          values: ["email", "sms"],
        });
        db.table("auth_second_factor_otp_registrations", (table) => {
          table.description(
            "A registration of an OTP for a user, the user has not logged in, but will be able to log in with it if they provide the code within the time limit.",
          );
          table.sampleData({
            skipSampleData: true,
          });
          table.fk("sys_users").notNull();
          table.bytes("hash", 32).notNull();
          table.bytes("salt", 32).notNull();
          table.timestampUtc("registration_time").notNull();
          table.enum("otp_type", "auth_second_factor_otp_type").notNull();
        });
      }
    }
    this.componentDependencies = [
      "OTPAuth",
      "RolePages",
      "UserDetailPage",
      "UserAccountManagementButton",
      "UserForm",
      "UsersList",
      "DefaultEmailOtpAuth",
      "StandardUserManagement",
      "UsernamePasswordAuth",
      "EmailPasswordAuth",
      "userHasPermission",
      "roleHasPermission",
      "countRolePermissions",
      "SingleSignOn",
    ];
    this.description =
      "Authentication and authorization block that provides user management, role-based permissions, and multiple authentication methods including OTP and username/password.";
  }

  beforeGenerateSampleData(
    s: IServerBaseStatements,
    ctx: SampleDataScriptContext,
  ) {
    s.startTransaction();
    s.modify(
      sql`insert into auth_roles (name, description) values ('Developer', 'Developers can do everything'),
      ('Admin', 'Admins can do everything'),
      ('Employee Base', 'Employee Base can do some things')`,
    );
    ctx.incrementRecordCount("auth_roles", 3);
    for (
      const permission of Object.values(
        system.enums.auth_permission.values,
      )
    ) {
      s.modify(
        sql`insert into auth_role_permissions (auth_role_id, permission, is_allowed) values
        (0, ${sql.lit(permission.name)}, true),
        (1, ${sql.lit(permission.name)}, true)
        `,
      );
      ctx.incrementRecordCount("auth_role_permissions", 2);
      if (!permission.name.includes("admin")) {
        s.modify(
          sql`insert into auth_role_permissions (auth_role_id, permission, is_allowed) values
          (2, ${sql.lit(permission.name)}, true)`,
        );
        ctx.incrementRecordCount("auth_role_permissions", 1);
      }
    }
    const developerUserType = this.userTypes.find((t) =>
      t.table.name === "developers"
    );
    if (developerUserType) {
      ctx.insertRecord(s, {
        table: system.db.tables.developers,
        fieldOverrides: {
          email: sql.lit("dev@yolm.ai"),
          name: sql.lit("Sample developer"),
        },
        ignoreRelations: ["sys_users"],
      });
      s.modify(
        sql`insert into sys_users (${
          sql.ref(developerUserType.fieldName)
        }) values (0)`,
      );
      const userId = ctx.incrementRecordCount("sys_users", 1);
      s.modify(
        sql`insert into auth_user_roles (sys_user_id, auth_role_id) values (${userId}, 0)`,
      );
      ctx.incrementRecordCount("auth_user_roles", 1);
    }
    const employeeUserType = this.userTypes.find((t) =>
      t.table.name === "employees"
    );
    if (employeeUserType) {
      ctx.insertRecord(s, {
        table: system.db.tables.employees,
        fieldOverrides: {
          email: sql.lit("admin@example.com"),
        },
        ignoreRelations: ["sys_users"],
      });
      s.modify(
        sql`insert into sys_users (${
          sql.ref(employeeUserType.fieldName)
        }) values (0)`,
      );
      const userId = ctx.incrementRecordCount("sys_users", 1);
      s.modify(
        sql`insert into auth_user_roles (sys_user_id, auth_role_id) values (${userId}, 1)`,
      );
      ctx.incrementRecordCount("auth_user_roles", 1);
      for (
        const email of [
          "john.doe@example.com",
          "jane.smith@example.com",
          "alice.jones@example.com",
        ]
      ) {
        const employeeId = ctx.insertRecord(s, {
          table: system.db.tables.employees,
          fieldOverrides: {
            email: sql.lit(email),
          },
          ignoreRelations: ["sys_users"],
        });
        s.modify(
          sql`insert into sys_users (${
            sql.ref(employeeUserType.fieldName)
          }) values (${employeeId})`,
        );
        const userId = ctx.incrementRecordCount("sys_users", 1);
        s.modify(
          sql`insert into auth_user_roles (sys_user_id, auth_role_id) values (${userId}, 2)`,
        );
        ctx.incrementRecordCount("auth_user_roles", 1);
      }
    }
    s.commitTransaction();
  }

  // Use getters for all imports from files that import back from this file
  // This breaks the circular dependency by deferring access until runtime
  static get OTPAuth() {
    return OTPAuth;
  }
  static get OTPLogin() {
    return OTPLogin;
  }
  static get DefaultEmailOtpAuth() {
    return defaultEmailOtpAuth;
  }
  static get PermissionPicker() {
    return PermissionPicker;
  }
  static get PermissionEntry() {
    return PermissionEntry;
  }
  static get RoleSelector() {
    return RoleSelector;
  }
  static get RolePages() {
    return RolePages;
  }
  static get UserDetailPage() {
    return UserDetailPage;
  }
  static get UserAccountManagementButton() {
    return UserAccountManagementButton;
  }
  static get UserForm() {
    return UserForm;
  }
  static get UsersList() {
    return UsersList;
  }
  static get StandardUserManagement() {
    return StandardUserManagement;
  }
  static get UserProfileCards() {
    return UserProfileCards;
  }
  static get UsernamePasswordAuth() {
    return UsernamePasswordAuth;
  }
  static get EmailPasswordAuth() {
    return EmailPasswordAuth;
  }
  static get SingleSignOn() {
    return SingleSignOn;
  }
  // These are defined in this file, no circular dependency
  static userHasPermission = userHasPermission;
  static roleHasPermission = roleHasPermission;
  static countRolePermissions = countRolePermissions;
  static PermissionCheck = PermissionCheck;
  static PermissionCheckAny = PermissionCheckAny;
  static PermissionCheckAll = PermissionCheckAll;

  /**
   * Validates API authentication by reading a session cookie and looking up
   * the user. Sets `auth_user_id` scalar (null if not authenticated).
   * Does NOT return 401 — the caller decides what to do.
   */
  static validateApi(
    s: EndpointStatements,
    cookieName: Sql,
    sessionExpiration?: Sql,
  ) {
    s.getCookie(cookieName, "auth_cookie");
    s.defScalar("auth_token_id", sql`try_cast(auth_cookie.value as uuid)`);
    s.defScalar(
      "auth_user_id",
      authSessionUserExpr(sql`auth_token_id`, sessionExpiration),
    );
  }
}

/**
 * SQL boolean expression that is true when `user` holds `permission`, either
 * granted directly or via any role in the (recursively resolved) role
 * hierarchy. Direct user-level denials override role grants.
 *
 * To test multiple permissions at once, prefer {@link getUserPermissions}.
 *
 * @category Helper
 */
export function userHasPermission(permission: Sql, user: NumericExpr) {
  return sql`fn.auth_has_permission(${permission}, ${user})`;
}

/** Role grants are consulted after checking for an explicit user override. */
function userHasRolePermissionPredicate(permission: Sql, user: NumericExpr) {
  return sql`exists (
        with recursive role_hierarchy as (
          select auth_role_id as id from auth_user_roles
          where sys_user_id = ${user}

          union all

          select auth_role_id as id from auth_user_role_sources
          where sys_user_id = ${user}

          -- The recursive UNION deduplicates both seed rows and inherited roles.
          union

          select role.extends as id
          from role_hierarchy child
          join auth_roles role on role.id = child.id
          where role.extends is not null
        )
        select 1
        from role_hierarchy
        join auth_role_permissions on auth_role_permissions.auth_role_id = role_hierarchy.id
        where auth_role_permissions.permission = ${permission} and
          auth_role_permissions.is_allowed
      )
  `;
}

/**
 * {@link userHasPermission} bound to the request's `current_user`. Use in
 * UI/server statements to gate behaviour on the logged-in user.
 *
 * @category Helper
 */
export function currentUserHasPermission(permission: Sql) {
  return userHasPermission(permission, sql`current_user`);
}

/**
 * SQL boolean expression that is true when `role` grants `permission`,
 * including permissions inherited through the role's `extends` chain.
 *
 * @category Helper
 */
export function roleHasPermission(permission: Sql, role: NumericExpr) {
  return sql`
    exists (
      with recursive role_hierarchy as (
        select ar.id
        from auth_roles ar
        where ar.id = ${role}

          union

          select parent.extends as id
          from role_hierarchy child
          join auth_roles parent on parent.id = child.id
          where parent.extends is not null
        )
        select 1
        from role_hierarchy
        join auth_role_permissions on auth_role_permissions.auth_role_id = role_hierarchy.id
        where auth_role_permissions.permission = ${permission} and
          auth_role_permissions.is_allowed
      )
  `;
}

/**
 * Scalar subquery expression returning the count of distinct permissions a
 * role allows, including those inherited via `extends`. Handy for showing a
 * permission tally in role-management UI.
 *
 * @category Helper
 */
export function countRolePermissions(role: NumericExpr) {
  return sql`(
      with recursive role_hierarchy as (
        select ar.id
        from auth_roles ar
        where ar.id = ${role}
        union
        select parent.extends as id
        from role_hierarchy child
        join auth_roles parent on parent.id = child.id
        where parent.extends is not null
      )
      select count(distinct permission)
      from role_hierarchy
      join auth_role_permissions on auth_role_permissions.auth_role_id = role_hierarchy.id
      where auth_role_permissions.is_allowed
  )`;
}

/**
 * Returns a query that gets all permissions for a user (both direct and inherited from roles).
 * This is more efficient than calling userHasPermission for each permission.
 *
 * @category Helper
 */
export function getUserPermissions(user: NumericExpr) {
  return sql`
    with recursive user_roles as (
      select auth_role_id as id from auth_user_roles
      where sys_user_id = ${user}
      union all
      select auth_role_id as id from auth_user_role_sources
      where sys_user_id = ${user}
      union
      -- Parent roles through extends chain
      select parent.extends as id
      from user_roles child
      join auth_roles parent on parent.id = child.id
      where parent.extends is not null
    )
    select distinct permission from (
      -- Direct user permissions
      select permission from auth_user_permissions
      where sys_user_id = ${user} and is_allowed
      union all
      -- Source-granted user permissions (excluding overridden by user)
      select permission from auth_user_permission_sources
      where sys_user_id = ${user}
        and is_allowed
        and permission not in (
          select permission from auth_user_permissions where sys_user_id = ${user}
        )
      union all
      -- Role permissions (excluding denied by user)
      select rp.permission
      from user_roles
      join auth_role_permissions rp on rp.auth_role_id = user_roles.id
      where rp.is_allowed
        and rp.permission not in (
          select permission from auth_user_permissions where sys_user_id = ${user}
        )
    )
  `;
}

/**
 * Returns a query that gets all permissions for a role (including inherited permissions).
 * This is more efficient than calling roleHasPermission for each permission.
 *
 * @category Helper
 */
export function getRolePermissions(role: NumericExpr) {
  return sql`
    with recursive role_hierarchy as (
      select ar.id from auth_roles ar where ar.id = ${role}
      union
      select parent.extends as id
      from role_hierarchy child
      join auth_roles parent on parent.id = child.id
      where parent.extends is not null
    )
    select distinct permission
    from role_hierarchy
    join auth_role_permissions on auth_role_permissions.auth_role_id = role_hierarchy.id
    where auth_role_permissions.is_allowed
  `;
}

// Permission Check Components
interface PermissionCheckProps {
  permission: string;
  children: Node;
  fallback?: Node;
}

function PermissionCheck(
  { permission, children, fallback }: PermissionCheckProps,
) {
  return (
    <Data
      errorFallback={null}
      procedure={(s) => {
        s.defScalar(
          "has_permission",
          userHasPermission(sql.lit(permission), sql`current_user`),
        );
      }}
    >
      <Show when={sql`has_permission`} fallback={fallback}>
        {children}
      </Show>
    </Data>
  );
}

function PermissionCheckAny({ permissions, children, fallback }: {
  permissions: string[];
  children: Node;
  fallback?: Node;
}) {
  return (
    <Data
      errorFallback={null}
      procedure={(s) => {
        const conditions = permissions.map((p) =>
          userHasPermission(sql.lit(p), sql`current_user`)
        );
        s.defScalar("has_any_permission", sql.or(...conditions));
      }}
    >
      <Show when={sql`has_any_permission`} fallback={fallback}>
        {children}
      </Show>
    </Data>
  );
}

function PermissionCheckAll({ permissions, children, fallback }: {
  permissions: string[];
  children: Node;
  fallback?: Node;
}) {
  return (
    <Data
      errorFallback={null}
      procedure={(s) => {
        const conditions = permissions.map((p) =>
          userHasPermission(sql.lit(p), sql`current_user`)
        );
        s.defScalar("has_all_permissions", sql.and(...conditions));
      }}
    >
      <Show when={sql`has_all_permissions`} fallback={fallback}>
        {children}
      </Show>
    </Data>
  );
}

export type {
  StandardUserManagementProps,
  UserProfileInsertBehavior,
  UserProfileManagementConfig,
  UserProfileManagementOptions,
  UserProfileUpdateBehavior,
} from "./standard_user_management";
export type {
  ImpersonationAppOption,
  UserAccountManagementButtonProps,
} from "./users";
export type { IdleTimeoutConfig } from "./idle_timeout";
