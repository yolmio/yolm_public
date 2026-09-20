import { AuthApiICtxKey, LogoutCleanupRegistry, LogoutICtxKey } from "std/ictx";
import { AccessActorICtxKey } from "./access_policy";
import { ImpersonationBanner } from "./impersonation_banner";
import type { AuthApiICtx, LogoutICtx } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import { system, useBlock } from "std/system";
import type { Table } from "std/system";
import { addCtx, Authorize, Show, useApp, useTheme } from "std/ui";
import { Data } from "std/data";
import type { ContextInstance, Node } from "std/ui";
import { Alert } from "../../components/alert";
import { Button } from "../../components/button";
import { FormControl } from "../../components/form_control";
import { FormLabel } from "../../components/form_label";
import { Input } from "../../components/input";
import { Typography } from "../../components/typography";
import {
  OneTimePasswordInput,
  otpDigits,
} from "../../components/one_time_password_input";
import { generateWaveBackground } from "components/backgrounds/wave";
import type { Style } from "std/style_types";
import { getCapabilities } from "std/yolm_gen_api";
import { TwoFactorVerify } from "./2fa_auth";
import {
  type AppSecondFactorConfig,
  AuthBlock,
  userHasPermission,
} from "./index";
import type { AfterLoginServerProps } from "./index";
import {
  authCookieOpts,
  authSessionUserExpr,
  ChangePasswordForm,
  hashAndStorePassword,
  otpEmailTemplate,
} from "./shared";
import { IdleTimeout } from "./idle_timeout";
import type { IdleTimeoutConfig } from "./idle_timeout";
import { UserSelector } from "./user_selector";
import type { Logo } from "./otp_auth";
import { YolmLogo } from "./otp_auth";

// Helper function to log authentication failures
function logAuthFailure<T extends IServerBaseStatements>(
  s: T,
  identifier: Sql,
  userId: Sql | null,
  failureReason: string,
  authType: Sql,
  withinTransaction = false,
) {
  if (!withinTransaction) s.startTransaction();
  s.modify(
    sql`insert into auth_login_failures (identifier, sys_user_id, attempted_at, failure_reason, auth_type)
    values (${identifier}, ${userId ?? sql.null}, now(), ${
      sql.lit(failureReason)
    }, ${authType}::enums.session_token_type)`,
  );
  if (!withinTransaction) s.commitTransaction();
}

export interface EmailPasswordAuthProps {
  applicationName?: string;
  logo?: Logo;
  sx?: Style;
  className?: string;
  loginText?: Sql | string;
  validateUser?: BooleanExpr;
  requiredPermission?: string;

  identifier:
    | "email"
    | {
      field: "email";
      getUserFromIdentifier: (identifier: Sql) => Sql;
      label?: string;
      placeholder?: string;
      inputType?: "email" | "text";
      requiredMessage?: string;
      notFoundMessage?: string;
    };

  email: {
    fromEmail?: Sql | string;
    getEmailFromUserId?: (userId: Sql) => Sql;
  };

  minPasswordLength?: number; // default 8
  allowForgotPassword?: boolean; // default true
  allowSelfSetup?: boolean; // default true

  children: Node;
  /** Custom login content; session and authorization checks are unchanged. */
  unauthorized?: Node;
  cookieExpiration?: Sql;
  cookieDomain?: Sql | string;
  cookieName?: Sql | string;
  rateLimit?: {
    maxAttempts: Sql;
    timeWindow: Sql;
  };
  /** Failed password attempts per account; timeWindow is in minutes. */
  passwordRateLimit?: {
    maxAttempts: Sql;
    timeWindow: Sql;
  };
  belowLoginNode?: Node;
  afterLoginServer?: (
    s: UiServerStatements,
    props: AfterLoginServerProps,
  ) => void;
  secondFactor?: AppSecondFactorConfig;
  idleTimeout?: IdleTimeoutConfig;
}

function getUserFilter(
  sysUserTable: Table,
  validateUser: BooleanExpr | undefined,
  requiredPermission: string | undefined,
) {
  let userFilter: BooleanExpr = true;
  if (sysUserTable.fields.disabled) {
    userFilter = sql`coalesce(disabled, false) = false`;
  }
  if (validateUser) {
    userFilter = sql.and(userFilter, validateUser);
  }
  if (requiredPermission) {
    userFilter = sql.and(
      userFilter,
      userHasPermission(sql.lit(requiredPermission), sql`sys_users.id`),
    );
  }
  return userFilter;
}

function resolveGetUserFromIdentifier(
  props: Pick<EmailPasswordAuthProps, "identifier">,
): (identifier: Sql) => Sql {
  if (typeof props.identifier === "object") {
    return props.identifier.getUserFromIdentifier;
  }
  // Default: look up email across all user type tables
  const authBlock = useBlock(AuthBlock);
  if (authBlock.userTypes.length === 0) {
    throw new Error(
      "EmailPasswordAuth with identifier='email' requires user types with email fields",
    );
  }
  if (authBlock.userTypes.length === 1) {
    const t = authBlock.userTypes[0];
    return (identifier: Sql) =>
      sql`(select sys_users.id from ${t.table.identWithDb} auto join sys_users where ${
        sql.ref(t.table.name)
      }.email = ${identifier})`;
  }
  return (identifier: Sql) =>
    sql`coalesce(${
      authBlock.userTypes
        .map(
          (t) =>
            sql`(select sys_users.id from ${t.table.identWithDb} auto join sys_users where ${
              sql.ref(t.table.name)
            }.email = ${identifier})`,
        )
        .reduce((a, b) => sql`${a}, ${b}`)
    })`;
}

function resolveGetEmailFromUserId(
  props: Pick<EmailPasswordAuthProps, "email">,
): (userId: Sql) => Sql {
  if (props.email.getEmailFromUserId) {
    return props.email.getEmailFromUserId;
  }
  const authBlock = useBlock(AuthBlock);
  if (authBlock.userTypes.length === 1) {
    const t = authBlock.userTypes[0];
    return (userId: Sql) =>
      sql`(select ${
        sql.ref(t.table.name)
      }.email from ${t.table.identWithDb} auto join sys_users where sys_users.id = ${userId})`;
  }
  return (userId: Sql) =>
    sql`coalesce(${
      authBlock.userTypes
        .map(
          (t) =>
            sql`(select ${
              sql.ref(t.table.name)
            }.email from ${t.table.identWithDb} auto join sys_users where sys_users.id = ${userId})`,
        )
        .reduce((a, b) => sql`${a}, ${b}`)
    })`;
}

function DevAutoLoginUnauthorized(props: {
  identifier: string;
  requiredPermission?: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <Alert color="warning" startIcon="Warning">
          Dev auto-login could not authorize "{props.identifier}". Verify the
          user exists and is not disabled{props.requiredPermission
            ? `, and that they have ${props.requiredPermission}`
            : ""}.
        </Alert>
      </div>
    </div>
  );
}

// ---- Login Page State Machine ----
// States: enter_email, enter_password, setup_otp_send, setup_otp_verify,
//         forgot_otp_send, forgot_otp_verify, set_new_password, change_password, second_factor

export interface EmailPasswordLoginProps
  extends Omit<EmailPasswordAuthProps, "children" | "unauthorized"> {
  /** Initial email when switching between login methods. */
  initialIdentifier?: Sql;
  /** Method selector rendered inside the login state scope. */
  methodSelector?: Node;
}

/** Password login form, including enrollment, recovery and second factor. */
export function EmailPasswordLogin(props: EmailPasswordLoginProps) {
  const sysUserTable = system.db.tables.sys_users;
  const getUserFromIdentifier = resolveGetUserFromIdentifier(props);
  const getEmailFromUserId = resolveGetEmailFromUserId(props);
  const applicationName = props.applicationName ?? "Yolm";
  const allowForgotPassword = props.allowForgotPassword ?? true;
  const allowSelfSetup = props.allowSelfSetup ?? true;
  const minPasswordLength = props.minPasswordLength ?? 8;
  const cookieName = props.cookieName
    ? (typeof props.cookieName === "string"
      ? sql.lit(props.cookieName)
      : props.cookieName)
    : sql.lit`y-t`;
  const cookieOpts = authCookieOpts({
    cookieDomain: props.cookieDomain,
  });

  const authBlock = useBlock(AuthBlock);
  const secondFactorAuthblock = authBlock.opts.secondFactor;
  const legacyPasswordsEnabled = !!authBlock.opts.legacyPasswords;
  const hasLegacyPasswordFields = legacyPasswordsEnabled &&
    !!sysUserTable.fields.legacy_password_hash &&
    !!sysUserTable.fields.legacy_password_algorithm &&
    !!sysUserTable.fields.legacy_password_migrated_at;

  function userHasStoredPassword(userId: Sql): Sql {
    return hasLegacyPasswordFields
      ? sql`(select (password_hash is not null and password_salt is not null) or (legacy_password_hash is not null and legacy_password_algorithm is not null) from sys_users where id = ${userId})`
      : sql`(select password_hash is not null and password_salt is not null from sys_users where id = ${userId})`;
  }

  function nativePasswordMatches(userId: Sql): Sql {
    return sql`(
      select case
        when password_hash is not null and password_salt is not null
          then password_hash = crypto.hash_password(ui.password, password_salt)
        else false
      end
      from sys_users
      where id = ${userId}
    )`;
  }

  function assertEligibleUser(s: UiServerStatements) {
    s.throwErrorUnless(
      sql`exists(select 1 from sys_users where id = ui.user_id and ${
        getUserFilter(
          sysUserTable,
          props.validateUser,
          props.requiredPermission,
        )
      })`,
      sql.lit`Account is not active or no longer has access`,
    );
  }

  function assertCurrentPassword(s: UiServerStatements) {
    s.throwErrorIf(
      sql`(${nativePasswordMatches(sql`ui.user_id`)} or ${
        legacyPasswordMatches(sql`ui.user_id`)
      }) is not true`,
      sql.lit`Password changed. Please sign in again.`,
    );
  }

  function legacyPasswordMatches(userId: Sql): Sql {
    return hasLegacyPasswordFields
      ? sql`(
        select case
          when password_hash is null
            and legacy_password_hash is not null
            and legacy_password_algorithm is not null
            then crypto.legacy_verify_password(ui.password, legacy_password_hash, legacy_password_algorithm)
          else false
        end
        from sys_users
        where id = ${userId}
      )`
      : sql`false`;
  }

  const timeWindow = props.rateLimit?.timeWindow ?? sql`10`;
  const maxAttempts = props.rateLimit?.maxAttempts ?? sql`3`;

  const logo = props.logo
    ? (
      <img
        src={props.logo.src}
        alt={props.logo.alt}
        sx={props.logo.sx ?? { maxWidth: 80 }}
      />
    )
    : <YolmLogo />;
  const identifierLabel = typeof props.identifier === "object"
    ? props.identifier.label ?? "Email"
    : "Email";
  const identifierPlaceholder = typeof props.identifier === "object"
    ? props.identifier.placeholder ?? "Enter your email"
    : "Enter your email";
  const identifierInputType = typeof props.identifier === "object"
    ? props.identifier.inputType ?? "email"
    : "email";
  const identifierRequiredMessage = typeof props.identifier === "object"
    ? props.identifier.requiredMessage ?? "Email is required"
    : "Email is required";
  const identifierNotFoundMessage = typeof props.identifier === "object"
    ? props.identifier.notFoundMessage ?? "No account found with that email"
    : "No account found with that email";

  function cookieGeneration(s: UiServerStatements) {
    s.defScalar("token_id", sql`random.uuid()`);
    s.startTransaction();
    // Recheck after the password-change/MFA screens, inside the session write.
    assertEligibleUser(s);
    assertCurrentPassword(s);
    s.throwErrorIf(
      sql`coalesce((select must_change_password from sys_users where id = ui.user_id), false)`,
      sql.lit`Password change required. Please sign in again.`,
    );
    s.modify(
      sql`insert into auth_session_tokens (sys_user_id, issued, public_id, type) values (ui.user_id, now(), token_id, 'email_password')`,
    );
    s.commitTransaction();
    s.setCookie(cookieName, sql`token_id`, cookieOpts);
    props.afterLoginServer?.(s, {
      user: sql`ui.user_id`,
      session: sql`token_id`,
    });
  }

  function sendOtp(
    s: DomStatements,
    opts: {
      loadingScalar: string;
      errorScalar: string;
      purpose: "setup" | "forgot";
    },
  ) {
    s.returnIf(sql.ref(opts.loadingScalar));
    s.setScalar(opts.loadingScalar, true);
    s.setScalar(opts.errorScalar, sql.null);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        // Rate limit check
        const devBypassCode = getCapabilities()?.blocks?.AuthBlock
          ?.devBypassCode;
        if (!devBypassCode) {
          s.if(
            sql`(select count(*) from auth_otp_registrations where sys_user_id = ui.user_id and abs(date.diff(minute, now(), registration_time)) <= ${timeWindow}) >= ${maxAttempts}`,
            (s) => {
              s.setScalar(
                opts.errorScalar,
                sql.lit`Too many attempts, please try again later`,
              );
              s.return();
            },
          );
        }
        s.defScalar("code", sql`crypto.digit_otp(6)`);
        s.defScalar("salt", sql`crypto.random_bytes(32)`);
        if (devBypassCode) {
          s.debugExpr(sql`code`);
        } else {
          s.defScalar("to_email", getEmailFromUserId(sql`ui.user_id`));
          s.sendEmail({
            to: sql`to_email`,
            from: props.email.fromEmail ?? sql.lit`notifications@yolm.ai`,
            subject: sql.lit`${applicationName} Access Code`,
            textBody: sql.concat(
              `Your ${applicationName} access code is `,
              sql`code`,
            ),
            htmlBody: otpEmailTemplate({
              applicationName,
              code: sql`code`,
            }),
            errorJsonScalar: "otp_send_error_json",
          });
          s.if(sql`__send_email_result_json is null`, () => {});
          s.if(sql`otp_send_error_json is not null`, (s) => {
            s.setScalar(
              opts.errorScalar,
              sql.concat(
                "Error: ",
                sql`coalesce(otp_send_error_json->>'message', otp_send_error_json->>'code', 'Unable to send access code')`,
              ),
            );
            s.return();
          });
        }
        s.startTransaction();
        s.modify(
          sql`insert into auth_otp_registrations (sys_user_id, hash, salt, registration_time, otp_type) values
            (ui.user_id, crypto.hmac_sha256(code, salt), salt, now(), 'email')`,
        );
        s.commitTransaction();
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          opts.errorScalar,
          sql.concat(
            "Error: ",
            sql`coalesce(service_error.message, service_error.type::string)`,
          ),
        );
      },
    });
    s.setScalar(opts.loadingScalar, false);
  }

  function verifyOtp(
    s: DomStatements,
    code: Sql,
    opts: {
      errorScalar: string;
      onSuccess: (s: DomStatements) => void;
    },
  ) {
    s.setScalar(opts.errorScalar, sql.null);
    s.tryServer({
      body: (s) => {
        const devBypassCode = getCapabilities()?.blocks?.AuthBlock
          ?.devBypassCode;
        if (devBypassCode) {
          s.if(sql`${code} != '111111'`, (s) => {
            s.setScalar(opts.errorScalar, sql.lit`Invalid code`);
            s.return();
          });
        } else {
          s.if(
            sql`not exists (select 1 from auth_otp_registrations
                where sys_user_id = ui.user_id and
                hash = crypto.hmac_sha256(${code}, salt) and
                abs(date.diff(minute, now(), registration_time)) <= 10)`,
            (s) => {
              s.setScalar(opts.errorScalar, sql.lit`Invalid code`);
              s.return();
            },
          );
        }
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          opts.errorScalar,
          sql.concat("Error: ", sql`service_error.message`),
        );
        s.return();
      },
    });
    s.if(sql`${sql.ref(opts.errorScalar)} is null`, (s) => {
      opts.onSuccess(s);
    });
  }

  // ---- UI for each state ----

  function submitEmail(s: DomStatements) {
    s.returnIf(sql`loading`);
    s.if(sql`trim(identifier) = ''`, (s) => {
      s.setScalar("error", sql.lit(identifierRequiredMessage));
      s.return();
    });
    s.setScalar("error", sql.null);
    s.setScalar("loading", true);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.defScalar(
          "found_user_id",
          getUserFromIdentifier(sql`ui.identifier`),
        );
        s.if(sql`found_user_id is null`, (s) => {
          logAuthFailure(
            s,
            sql`ui.identifier`,
            null,
            "user_not_found",
            sql.lit`email_password`,
          );
          s.setScalar(
            "error",
            sql.lit(identifierNotFoundMessage),
          );
          s.return();
        });
        // Check if account is disabled
        if (sysUserTable.fields.disabled) {
          s.if(
            sql`(select coalesce(disabled, false) from sys_users where id = found_user_id)`,
            (s) => {
              logAuthFailure(
                s,
                sql`ui.identifier`,
                sql`found_user_id`,
                "user_disabled",
                sql.lit`email_password`,
              );
              s.setScalar("error", sql.lit`Account is not active`);
              s.return();
            },
          );
        }
        // Check custom user validation
        if (props.validateUser) {
          s.if(
            sql`(select ${props.validateUser} from sys_users where id = found_user_id) is not true`,
            (s) => {
              logAuthFailure(
                s,
                sql`ui.identifier`,
                sql`found_user_id`,
                "user_disabled",
                sql.lit`email_password`,
              );
              s.setScalar("error", sql.lit`Account is not active`);
              s.return();
            },
          );
        }
        // Check required permission
        if (props.requiredPermission) {
          s.if(
            sql`(select ${
              userHasPermission(
                sql.lit(props.requiredPermission),
                sql`sys_users.id`,
              )
            } from sys_users where id = found_user_id) is not true`,
            (s) => {
              logAuthFailure(
                s,
                sql`ui.identifier`,
                sql`found_user_id`,
                "user_disabled",
                sql.lit`email_password`,
              );
              s.setScalar(
                "error",
                sql.lit`You do not have permission to access this application`,
              );
              s.return();
            },
          );
        }
        s.setScalar("user_id", sql`found_user_id`);
        // Check if password is set
        s.defScalar(
          "has_password",
          userHasStoredPassword(sql`found_user_id`),
        );
        s.if(sql`has_password`, (s) => {
          s.setScalar("ui.loading", false);
          s.setScalar("auth_state", sql.lit`enter_password`);
        });
        s.if(sql`not has_password`, (s) => {
          if (allowSelfSetup) {
            s.setScalar("ui.loading", false);
            s.setScalar("auth_state", sql.lit`setup_otp_send`);
          } else {
            s.setScalar("ui.loading", false);
            s.setScalar(
              "error",
              sql
                .lit`No password set. Please contact your administrator.`,
            );
          }
        });
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          "error",
          sql.concat("Error: ", sql`service_error.message`),
        );
      },
    });
    s.setScalar("loading", false);
  }

  function EnterEmailState() {
    return (
      <>
        {logo}
        <Typography level="h3">
          {props.loginText ?? "Sign in to your account"}
        </Typography>
        <form
          className="w-full"
          noValidate
          onSubmit={(s) => {
            s.event.preventDefault();
            submitEmail(s);
          }}
        >
          <FormControl fullWidth className="mb-4 mt-4">
            <FormLabel htmlFor="email_input">{identifierLabel}</FormLabel>
            <Input
              bindScalar="identifier"
              type={identifierInputType}
              placeholder={identifierPlaceholder}
              id="email_input"
              yolmFocusKey
            />
          </FormControl>
          <Button type="submit" fullWidth loading={sql`loading`}>
            Continue
          </Button>
        </form>
        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mt-4">{sql`error`}</Alert>
        </Show>
        {props.belowLoginNode}
      </>
    );
  }

  function submitPassword(s: DomStatements) {
    s.returnIf(sql`loading`);
    s.setScalar("error", sql.null);
    s.setScalar("loading", true);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        assertEligibleUser(s);
        if (props.passwordRateLimit) {
          // The count and failure insert share a transaction so concurrent
          // guesses cannot race past the account's limit.
          s.throwErrorIf(
            sql`(select count(*) from auth_login_failures
              where sys_user_id = ui.user_id and auth_type = 'email_password'
                and failure_reason = 'invalid_credentials'
                and attempted_at >= date.add(minute, -${props.passwordRateLimit.timeWindow}, now())) >= ${props.passwordRateLimit.maxAttempts}`,
            sql.lit`Too many attempts, please try again later`,
          );
        }
        s.defScalar(
          "valid_native_login",
          nativePasswordMatches(sql`ui.user_id`),
        );
        s.defScalar(
          "valid_legacy_login",
          legacyPasswordMatches(sql`ui.user_id`),
        );
        s.defScalar(
          "valid_login",
          sql`valid_native_login or valid_legacy_login`,
        );
        s.if(sql`valid_login is not true`, (s) => {
          logAuthFailure(
            s,
            sql`ui.identifier`,
            sql`ui.user_id`,
            "invalid_credentials",
            sql.lit`email_password`,
            true,
          );
        });
        if (hasLegacyPasswordFields) {
          s.if(sql`valid_legacy_login`, (s) => {
            s.defScalar("new_salt", sql`crypto.random_bytes(32)`);
            s.defScalar(
              "new_hash",
              sql`crypto.hash_password(ui.password, new_salt)`,
            );
            s.modify(sql`
              update sys_users
              set password_hash = new_hash,
                  password_salt = new_salt,
                  legacy_password_hash = null,
                  legacy_password_algorithm = null,
                  legacy_password_migrated_at = current_timestamp()
              where id = ui.user_id
            `);
          });
        }
        // Check must_change_password
        s.defScalar(
          "must_change",
          sql`coalesce((select must_change_password from sys_users where id = ui.user_id), false)`,
        );
        s.commitTransaction();
        s.if(sql`valid_login is not true`, (s) => {
          s.setScalar("error", sql.lit`Invalid password`);
          s.return();
        });
        s.if(sql`must_change`, (s) => {
          s.setScalar("auth_state", sql.lit`change_password`);
          s.return();
        });
        // Check 2FA
        if (props.secondFactor) {
          s.setScalar("auth_state", sql.lit`second_factor`);
        } else {
          // No 2FA configured, generate cookie
          cookieGeneration(s);
        }
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          "error",
          sql.concat("Error: ", sql`service_error.message`),
        );
      },
    });
    s.setScalar("loading", false);
  }

  function EnterPasswordState() {
    return (
      <>
        {logo}
        <Typography level="h3">Enter your password</Typography>
        <Typography level="body-md" className="text-center mt-1 mb-2">
          {sql`identifier`}
        </Typography>
        <FormControl fullWidth className="mb-4">
          <FormLabel htmlFor="password_input">Password</FormLabel>
          <Input
            bindScalar="password"
            type="password"
            placeholder="Enter your password"
            id="password_input"
            fullWidth
            yolmFocusKey
            onKeyDown={(s) => {
              s.if(sql`event.key = 'Enter'`, submitPassword);
            }}
          />
        </FormControl>
        <Button
          fullWidth
          loading={sql`loading`}
          onClick={submitPassword}
        >
          Sign in
        </Button>
        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mt-4">{sql`error`}</Alert>
        </Show>
        <div className="flex justify-between mt-2 w-full">
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            onClick={(s) => {
              s.setScalar("auth_state", sql.lit`enter_email`);
              s.setScalar("password", sql.lit``);
              s.setScalar("error", sql.null);
            }}
          >
            Back
          </Button>
          {allowForgotPassword && (
            <Button
              variant="plain"
              color="primary"
              size="sm"
              onClick={(s) => {
                s.setScalar("auth_state", sql.lit`forgot_otp_send`);
                s.setScalar("error", sql.null);
              }}
            >
              Forgot password?
            </Button>
          )}
        </div>
      </>
    );
  }

  function OtpSendState(otpProps: {
    title: string;
    subtitle: string;
    nextState: string;
    purpose: "setup" | "forgot";
  }) {
    return (
      <>
        {logo}
        <Typography level="h3">{otpProps.title}</Typography>
        <Typography level="body-md" className="text-center mt-2 mb-4">
          {otpProps.subtitle}
        </Typography>
        <Button
          fullWidth
          loading={sql`loading`}
          onClick={(s) => {
            sendOtp(s, {
              loadingScalar: "loading",
              errorScalar: "error",
              purpose: otpProps.purpose,
            });
            s.if(sql`error is null`, (s) => {
              s.setScalar("auth_state", sql.lit(otpProps.nextState));
            });
          }}
        >
          Send verification code
        </Button>
        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mt-4">{sql`error`}</Alert>
        </Show>
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          className="mt-2"
          onClick={(s) => {
            s.setScalar("auth_state", sql.lit`enter_email`);
            s.setScalar("error", sql.null);
          }}
        >
          Back to sign in
        </Button>
      </>
    );
  }

  function OtpVerifyState(otpProps: {
    title: string;
    onSuccess: (s: DomStatements) => void;
    backState: string;
  }) {
    return (
      <Data
        local
        procedure={(s) => {
          otpDigits(s, "otp_verify_digits", 6);
        }}
      >
        {logo}
        <Typography level="h3">{otpProps.title}</Typography>
        <Typography
          level="body-md"
          className="text-center mt-2 mb-4 text-[#555]"
        >
          We sent a 6-digit code to your email. Enter it below.
        </Typography>
        <div className="w-full flex flex-row justify-center gap-4 pt-4">
          <OneTimePasswordInput
            size="lg"
            digits={6}
            digitsRecord="otp_verify_digits"
            error={sql`error is not null`}
            focusFirstImmediately
            onComplete={(s, code) => {
              verifyOtp(s, code, {
                errorScalar: "error",
                onSuccess: otpProps.onSuccess,
              });
            }}
          />
        </div>
        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mt-4">{sql`error`}</Alert>
        </Show>
        <Button
          variant="plain"
          color="neutral"
          size="sm"
          className="mt-4"
          onClick={(s) => {
            s.setScalar("auth_state", sql.lit(otpProps.backState));
            s.setScalar("error", sql.null);
          }}
        >
          Back
        </Button>
      </Data>
    );
  }

  function SetNewPasswordState() {
    return (
      <ChangePasswordForm
        title="Set your password"
        subtitle="Choose a strong password for your account."
        minPasswordLength={minPasswordLength}
        logo={logo}
        onSave={(s) => {
          hashAndStorePassword(s, sql`ui.user_id`, {
            clearLegacyPassword: legacyPasswordsEnabled,
            beforeStore: assertEligibleUser,
          });
          s.setScalar("ui.password", sql`ui.new_password`);
          if (props.secondFactor) {
            s.setScalar("auth_state", sql.lit`second_factor`);
          } else {
            cookieGeneration(s);
          }
        }}
        belowForm={
          <Button
            variant="plain"
            color="neutral"
            size="sm"
            className="mt-2"
            onClick={(s) => {
              s.setScalar("auth_state", sql.lit`enter_email`);
              s.setScalar("error", sql.null);
            }}
          >
            Back to sign in
          </Button>
        }
      />
    );
  }

  function ChangePasswordState() {
    return (
      <ChangePasswordForm
        title="Change your password"
        subtitle="Your administrator requires you to change your password."
        minPasswordLength={minPasswordLength}
        logo={logo}
        onSave={(s) => {
          hashAndStorePassword(s, sql`ui.user_id`, {
            clearLegacyPassword: legacyPasswordsEnabled,
            beforeStore: (s) => {
              assertEligibleUser(s);
              assertCurrentPassword(s);
            },
          });
          s.setScalar("ui.password", sql`ui.new_password`);
          if (props.secondFactor) {
            s.setScalar("auth_state", sql.lit`second_factor`);
          } else {
            cookieGeneration(s);
          }
        }}
      />
    );
  }

  function SecondFactorState() {
    if (!props.secondFactor) return null;
    function otpGeneration(
      s: DomStatements,
      opts: {
        otpType: "email" | "sms";
        loadingScalar: string;
        errorScalar: string;
      },
    ) {
      s.returnIf(sql.ref(opts.loadingScalar));
      s.setScalar(opts.loadingScalar, true);
      s.setScalar(opts.errorScalar, sql.null);
      s.commitUiTreeChanges();
      s.tryServer({
        body: (s) => {
          s.defScalar(
            "enabled_second_factor",
            sql`exists(select 1 from auth_second_factor_settings where sys_user_id = ui.user_id and enabled = true)`,
          );
          s.returnIf(sql`not enabled_second_factor`);

          const devBypassCode = getCapabilities()?.blocks?.AuthBlock
            ?.devBypassCode;
          if (
            props.secondFactor?.method === "sms" ||
            props.secondFactor?.method === "email"
          ) {
            const sf2TimeWindow = props.secondFactor?.rateLimit?.timeWindow ??
              sql`10`;
            const sf2MaxAttempts = props.secondFactor?.rateLimit?.maxAttempts ??
              sql`3`;
            if (!devBypassCode) {
              s.if(
                sql`(select count(*) from auth_second_factor_otp_registrations where sys_user_id = ui.user_id and abs(date.diff(minute, now(), registration_time)) <= ${sf2TimeWindow}) >= ${sf2MaxAttempts}`,
                (s) => {
                  s.setScalar(
                    opts.errorScalar,
                    sql.lit`Too many attempts, please try again later`,
                  );
                  s.return();
                },
              );
            }
            s.defScalar("code", sql`crypto.digit_otp(6)`);
            s.defScalar("salt", sql`crypto.random_bytes(32)`);
            if (devBypassCode) {
              s.debugExpr(sql`code`);
            } else {
              if (
                secondFactorAuthblock?.methods.email &&
                props.secondFactor?.method === "email"
              ) {
                s.defScalar(
                  "to_email",
                  secondFactorAuthblock.methods.email.getEmailFromUserId(
                    sql`ui.user_id`,
                  ),
                );
                s.sendEmail({
                  to: sql`to_email`,
                  from: secondFactorAuthblock.methods.email.fromEmail ??
                    sql.lit`notifications@yolm.ai`,
                  subject: sql.lit`${applicationName} Access Code`,
                  textBody: sql.concat(
                    `Your ${applicationName} access code is `,
                    sql`code`,
                  ),
                  htmlBody: otpEmailTemplate({
                    applicationName,
                    code: sql`code`,
                  }),
                  errorJsonScalar: "otp_second_factor_send_error_json",
                });
              } else if (
                secondFactorAuthblock?.methods.sms &&
                props.secondFactor?.method === "sms"
              ) {
                const to = secondFactorAuthblock.methods.sms.getPhoneFromUserId(
                  sql`ui.user_id`,
                );
                if (secondFactorAuthblock.methods.sms.sendSms) {
                  secondFactorAuthblock.methods.sms.sendSms(s, {
                    to,
                    code: sql`code`,
                    from: secondFactorAuthblock.methods.sms.fromPhone,
                    errorJsonScalar: "otp_second_factor_send_error_json",
                  });
                } else {
                  if (!secondFactorAuthblock.methods.sms.fromPhone) {
                    throw new Error(
                      "Second-factor SMS requires methods.sms.sendSms or methods.sms.fromPhone",
                    );
                  }
                  s.sendSms({
                    to,
                    from: secondFactorAuthblock.methods.sms.fromPhone,
                    body: sql.concat(
                      `Your ${applicationName} access code is `,
                      sql`code`,
                    ),
                    errorJsonScalar: "otp_second_factor_send_error_json",
                  });
                }
              }
              s.if(
                sql`otp_second_factor_send_error_json is not null`,
                (s) => {
                  s.setScalar(
                    opts.errorScalar,
                    sql.concat(
                      "Error: ",
                      sql`coalesce(otp_second_factor_send_error_json->>'message', otp_second_factor_send_error_json->>'code', 'Unable to send access code')`,
                    ),
                  );
                  s.return();
                },
              );
            }
            s.startTransaction();
            s.modify(
              sql`insert into auth_second_factor_otp_registrations (sys_user_id, hash, salt, registration_time, otp_type) values
                (ui.user_id, crypto.hmac_sha256(code, salt), salt, now(), ${
                sql.lit(props.secondFactor.method)
              })`,
            );
            s.commitTransaction();
          }
        },
        errorName: "service_error",
        catch: (s) => {
          s.setScalar(
            opts.errorScalar,
            sql.concat(
              "Error: ",
              sql`coalesce(service_error.message, service_error.type::string)`,
            ),
          );
        },
      });
      s.setScalar(opts.loadingScalar, false);
    }
    return (
      <TwoFactorVerify
        secondFactor={props.secondFactor}
        generateCookie={cookieGeneration}
        logo={props.logo}
        otpGeneration={otpGeneration}
        totpConfig={secondFactorAuthblock?.methods.totp}
        accountName={sql`ui.identifier`}
      />
    );
  }

  // ---- Main login page with state machine ----
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("auth_state", sql.lit`enter_email`);
        s.defScalar("identifier", props.initialIdentifier ?? sql.lit``);
        s.defScalar("password", sql.lit``);
        s.defScalar("user_id", { type: "BigUint" });
        s.defScalar("error", { type: "String" });
        s.defScalar("loading", false);
        if (props.secondFactor) {
          if (props.secondFactor.method === "sms") {
            s.defScalar(
              "selected_channel_2fa",
              sql`'sms'::enums.auth_second_factor_otp_type`,
            );
          } else if (props.secondFactor.method === "email") {
            s.defScalar(
              "selected_channel_2fa",
              sql`'email'::enums.auth_second_factor_otp_type`,
            );
          }
        }
      }}
    >
      <div
        sx={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "start",
          p: 2,
          md: { p: 4 },
          ...generateWaveBackground({
            lightBaseColor: useTheme().lightColorScheme.palette.primary["400"],
            darkBaseColor: useTheme().darkColorScheme.palette.primary["600"],
          }),
        }}
      >
        <div
          sx={[
            {
              width: "100%",
              mt: "10vh",
              maxWidth: "460px",
              bgcolor: "background-surface",
              borderRadius: "xl",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: "lg",
              px: 4,
              py: 6,
              sm: { px: 12, py: 10 },
            },
            props.sx,
          ]}
          className={props.className}
        >
          <Show
            when={sql`auth_state = 'enter_email'`}
          >
            <EnterEmailState />
          </Show>
          <Show
            when={sql`auth_state = 'enter_password'`}
          >
            <EnterPasswordState />
          </Show>
          {allowSelfSetup && (
            <>
              <Show
                when={sql`auth_state = 'setup_otp_send'`}
              >
                <OtpSendState
                  title="Set up your password"
                  subtitle="We'll verify your email first. Click below to receive a verification code."
                  nextState="setup_otp_verify"
                  purpose="setup"
                />
              </Show>
              <Show
                when={sql`auth_state = 'setup_otp_verify'`}
              >
                <OtpVerifyState
                  title="Verify your email"
                  backState="setup_otp_send"
                  onSuccess={(s) => {
                    s.setScalar("auth_state", sql.lit`set_new_password`);
                  }}
                />
              </Show>
            </>
          )}
          {allowForgotPassword && (
            <>
              <Show
                when={sql`auth_state = 'forgot_otp_send'`}
              >
                <OtpSendState
                  title="Reset your password"
                  subtitle="We'll send a verification code to your email to reset your password."
                  nextState="forgot_otp_verify"
                  purpose="forgot"
                />
              </Show>
              <Show
                when={sql`auth_state = 'forgot_otp_verify'`}
              >
                <OtpVerifyState
                  title="Enter verification code"
                  backState="forgot_otp_send"
                  onSuccess={(s) => {
                    s.setScalar("auth_state", sql.lit`set_new_password`);
                  }}
                />
              </Show>
            </>
          )}
          {(allowSelfSetup || allowForgotPassword) && (
            <Show
              when={sql`auth_state = 'set_new_password'`}
            >
              <SetNewPasswordState />
            </Show>
          )}
          <Show
            when={sql`auth_state = 'change_password'`}
          >
            <ChangePasswordState />
          </Show>
          <Show
            when={sql`auth_state = 'second_factor'`}
          >
            <SecondFactorState />
          </Show>
          {props.methodSelector}
        </div>
      </div>
    </Data>
  );
}

class Context implements ContextInstance, LogoutICtx, AuthApiICtx {
  implementICtxs = [LogoutICtxKey, AuthApiICtxKey, AccessActorICtxKey];
  private readonly logoutCleanups = new LogoutCleanupRegistry();
  registerLogoutCleanup = this.logoutCleanups.register;
  runLogoutCleanups = this.logoutCleanups.run;

  constructor(
    private userFilter: BooleanExpr,
    private cookieName: Sql,
    private sessionExpiration?: Sql,
  ) {}

  assertOriginalActor = (s: UiServerStatements) => {
    s.getCookie(this.cookieName, "access_actor_cookie");
    s.throwErrorIf(
      sql`${
        authSessionUserExpr(
          sql`try_cast(access_actor_cookie.value as uuid)`,
          this.sessionExpiration,
        )
      } is distinct from current_user`,
      sql.lit`End impersonation before managing access.`,
    );
  };

  logout = (s: DomStatements) => {
    this.runLogoutCleanups(s);
    s.startTaskWithOpts({
      detached: true,
      procedure: (s) => {
        s.tryServer({
          body: (s) => {
            s.getCookie(this.cookieName, "token_id_cookie");
            s.defScalar(
              "token_id",
              sql`try_cast(token_id_cookie.value as uuid)`,
            );
            s.if(sql`token_id is not null`, (s) => {
              s.startTransaction();
              s.modify(
                sql`delete from auth_session_tokens where public_id = token_id`,
              );
              s.commitTransaction();
            });
            s.removeCookie(this.cookieName);
          },
          errorName: "service_error",
          catch: (s) => {
            s.debugExpr(sql.lit`Failed to logout on server`);
          },
        });
        s.removeCookie(this.cookieName);
        s.clearLocalData();
      },
    });
  };

  authenticate = (s: EndpointStatements) => {
    s.getCookie(this.cookieName, "token_id_cookie");
    s.defScalar("token_id", sql`try_cast(token_id_cookie.value as uuid)`);
    s.defScalar(
      "user_id",
      authSessionUserExpr(sql`token_id`, this.sessionExpiration),
    );
    // Validate the session owner independently of the destination app's access.
    s.unless(
      sql`exists (select 1 from sys_users where id = user_id ${
        system.block(AuthBlock).opts.disableDisabled
          ? sql``
          : sql`and not disabled`
      })`,
      (s) => {
        s.setHttpStatus(401);
        s.return();
      },
    );
    const domains = [useApp().domain];
    domains.push(...useApp().domainAliases);
    s.defScalar(
      "impersonated_user_id",
      sql`(select impersonatee from auth_impersonations
            where impersonator = user_id and active and
            ${
        system.block(AuthBlock).opts.accessPolicy
          ? sql`fn.auth_can_impersonate(user_id, impersonatee) and`
          : sql``
      }
            now() between issued and date.add(minute, duration, issued) and
            exists (select 1 from auth_impersonation_domains where
              ${sql.inList(sql`domain`, domains.map(sql.lit))} and
              auth_impersonation_id = auth_impersonations.id)
            order by issued desc, id desc limit 1
            )`,
    );
    s.if(sql`impersonated_user_id is not null`, (s) => {
      s.setScalar("user_id", sql`impersonated_user_id`);
    });
    // The effective identity must satisfy the app's permission and user filters.
    if (this.userFilter !== true) {
      s.unless(
        sql`exists (select 1 from sys_users where id = user_id and (${this.userFilter}))`,
        (s) => {
          s.setHttpStatus(401);
          s.return();
        },
      );
    }
  };
}

export function EmailPasswordAuth(props: EmailPasswordAuthProps) {
  const sysUserTable = system.db.tables.sys_users;
  if (!sysUserTable) {
    throw new Error(
      "Please add a sys_users table to your system before using EmailPasswordAuth",
    );
  }
  if (!sysUserTable.fields.password_hash) {
    throw new Error(
      "Please specify a password_hash field on the sys_users table before using EmailPasswordAuth",
    );
  }
  if (!sysUserTable.fields.password_salt) {
    throw new Error(
      "Please specify a password_salt field on the sys_users table before using EmailPasswordAuth",
    );
  }
  const userFilter = getUserFilter(
    sysUserTable,
    props.validateUser,
    props.requiredPermission,
  );

  const cookieName = props.cookieName
    ? (typeof props.cookieName === "string"
      ? sql.lit(props.cookieName)
      : props.cookieName)
    : sql.lit`y-t`;

  // Check capabilities for auto-login bypass
  const caps = getCapabilities();
  const authCaps = caps?.blocks?.AuthBlock;

  // User selector mode
  if (authCaps?.authEnabled === false && authCaps.userSelectorMode) {
    addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
    return (
      <UserSelector
        userFilter={userFilter}
        cookieName={cookieName}
        sessionTokenType={sql`'email_password'::enums.session_token_type`}
        applicationName={props.applicationName}
        idleTimeout={props.idleTimeout}
      >
        {props.children}
      </UserSelector>
    );
  }

  // Auto-login mode
  if (authCaps?.authEnabled === false && authCaps.defaultUserIdentifier) {
    const identifier = String(authCaps.defaultUserIdentifier);
    const getUserFromIdentifier = resolveGetUserFromIdentifier(props);
    addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
    const wrappedChildren = props.idleTimeout
      ? (
        <IdleTimeout config={props.idleTimeout} cookieName={cookieName}>
          {props.children}
        </IdleTimeout>
      )
      : props.children;
    return (
      <Authorize
        procedure={(s) => {
          s.defScalar(
            "auto_user_id",
            sql`coalesce(current_user, ${
              getUserFromIdentifier(sql.lit(identifier))
            })`,
          );
          s.returnUnless(sql`auto_user_id is not null`, false);
          if (userFilter !== true) {
            s.returnUnless(
              sql`(select ${userFilter} from sys_users where id = auto_user_id)`,
              false,
            );
          }
          s.setCurrentUser(sql`auto_user_id`);
          s.return(true);
        }}
        unauthorized={
          <DevAutoLoginUnauthorized
            identifier={identifier}
            requiredPermission={props.requiredPermission}
          />
        }
      >
        {wrappedChildren}
      </Authorize>
    );
  }

  addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
  const wrappedChildren = props.idleTimeout
    ? (
      <IdleTimeout config={props.idleTimeout} cookieName={cookieName}>
        {props.children}
      </IdleTimeout>
    )
    : props.children;
  return (
    <Authorize
      procedure={(s) => {
        s.getCookie(cookieName, "token_id_cookie");
        s.defScalar("token_id", sql`try_cast(token_id_cookie.value as uuid)`);
        s.returnUnless(sql`token_id is not null`, false);
        s.defScalar(
          "user_id",
          authSessionUserExpr(sql`token_id`, props.cookieExpiration),
        );
        const domains = [useApp().domain];
        domains.push(...useApp().domainAliases);
        s.defScalar(
          "impersonated_user_id",
          sql`(select impersonatee from auth_impersonations
            where impersonator = user_id and active and
            ${
            system.block(AuthBlock).opts.accessPolicy
              ? sql`fn.auth_can_impersonate(user_id, impersonatee) and`
              : sql``
          }
            now() between issued and date.add(minute, duration, issued) and
            exists (select 1 from auth_impersonation_domains where
              ${sql.inList(sql`domain`, domains.map(sql.lit))} and
              auth_impersonation_id = auth_impersonations.id)
            order by issued desc, id desc limit 1
            )`,
        );
        s.if(sql`impersonated_user_id is not null`, (s) => {
          if (userFilter !== true) {
            s.returnUnless(
              sql`(select ${userFilter} from sys_users where id = impersonated_user_id)`,
              false,
            );
          }
          s.setCurrentUser(sql`impersonated_user_id`);
          s.return(true);
        });
        s.returnUnless(sql`user_id is not null`, false);
        if (userFilter !== true) {
          s.returnUnless(
            sql`(select ${userFilter} from sys_users where id = user_id)`,
            false,
          );
        }
        s.setCurrentUser(sql`user_id`);
        s.return(true);
      }}
      unauthorized={props.unauthorized ?? <EmailPasswordLogin {...props} />}
    >
      <ImpersonationBanner
        cookieName={cookieName}
        sessionExpiration={props.cookieExpiration}
      />
      {wrappedChildren}
    </Authorize>
  );
}
