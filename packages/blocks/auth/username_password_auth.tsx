import { YolmIcon } from "components/icons/yolm";
import { AccessActorICtxKey } from "./access_policy";
import { AuthApiICtxKey, LogoutCleanupRegistry, LogoutICtxKey } from "std/ictx";
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
import { addCtx, Authorize, Show, useTheme } from "std/ui";
import { Data } from "std/data";
import type { ContextInstance, Node } from "std/ui";
import { Alert } from "../../components/alert";
import { Button } from "../../components/button";
import { FormControl } from "../../components/form_control";
import { FormLabel } from "../../components/form_label";
import { Input } from "../../components/input";
import { Typography } from "../../components/typography";
import { generateWaveBackground } from "components/backgrounds/wave";
import type { Style } from "std/style_types";
import { getCapabilities } from "std/yolm_gen_api";
import { TwoFactorVerify } from "./2fa_auth";
import type { Logo } from "./otp_auth";
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

// Helper function to log authentication failures
function logAuthFailure<T extends IServerBaseStatements>(
  s: T,
  identifier: Sql,
  userId: Sql | null,
  failureReason: string,
  authType: Sql,
) {
  // Start a nested transaction for logging
  s.startTransaction();
  s.modify(
    sql`insert into auth_login_failures (identifier, sys_user_id, attempted_at, failure_reason, auth_type)
    values (${identifier}, ${userId ?? sql.null}, now(), ${
      sql.lit(failureReason)
    }, ${authType}::enums.session_token_type)`,
  );
  s.commitTransaction();
}

interface UsernamePasswordAuthProps {
  logo?: Logo;
  loginText?: string;
  validateUser?: BooleanExpr;
  requiredPermission?: string;
  children: Node;
  sx?: Style;
  className?: string;
  secondFactor?: AppSecondFactorConfig;
  applicationName?: string;
  idleTimeout?: IdleTimeoutConfig;
  minPasswordLength?: number;
  cookieExpiration?: Sql;
  cookieDomain?: Sql | string;
  cookieName?: Sql | string;
  afterLoginServer?: (
    s: UiServerStatements,
    props: AfterLoginServerProps,
  ) => void;
}

function YolmLogo() {
  return (
    <div className="flex justify-center mb-4 w-full">
      <Typography
        level="h3"
        startDecorator={
          <YolmIcon className="text-[#6985ff] w-[60px] h-[60px] -mr-4" />
        }
        className="text-[#6985ff]"
      >
        Yolm
      </Typography>
    </div>
  );
}
interface UsernamePasswordFormProps {
  logo?: Logo;
  loginText?: string;
  verifyPassword: (s: DomStatements) => void;
}

function UsernamePasswordForm(props: UsernamePasswordFormProps) {
  const { logo, loginText, verifyPassword } = props;
  return (
    <>
      {logo
        ? (
          <img
            src={logo.src}
            alt={logo.alt}
            className={logo.className}
            sx={{ maxWidth: 80, ...logo.sx }}
          />
        )
        : <YolmLogo />}
      <Typography level="h3">
        {loginText ?? "Sign in to your account"}
      </Typography>
      <FormControl fullWidth className="mb-4">
        <FormLabel htmlFor="username">Username</FormLabel>
        <Input
          bindScalar="username"
          type="text"
          placeholder="Username"
          id="username"
          fullWidth
        />
      </FormControl>
      <FormControl fullWidth className="mb-4">
        <FormLabel htmlFor="password">Password</FormLabel>
        <Input
          bindScalar="password"
          type="password"
          placeholder="Password"
          id="password"
          fullWidth
        />
      </FormControl>
      <Button
        fullWidth
        onClick={(s) => verifyPassword(s)}
        className="mb-4"
        loading={sql`waiting_2fa`}
      >
        Sign in
      </Button>
      <Show when={sql`error is not null`}>
        <Alert color="danger">{sql`error`}</Alert>
      </Show>
    </>
  );
}

// Internal component for username/password with second factor support
interface UsernamePasswordWithSecondFactorProps {
  verifyPassword: (props: {
    s: DomStatements;
    generateCookie?: boolean;
    onSuccess?: (s: DomStatements) => void;
    loadingScalar: string;
    errorScalar: string;
  }) => void;
  secondFactor?: AppSecondFactorConfig;
  logo?: Logo;
  loginText?: string;
  cookieGeneration: (s: UiServerStatements) => void;
  otpGeneration: (
    s: DomStatements,
    opts: {
      otpType: "email" | "sms";
      loadingScalar: string;
      errorScalar: string;
    },
  ) => void;
  totpConfig?: {
    issuerName: string;
  };
  accountName?: Sql;
}

function UsernamePasswordWithSecondFactor(
  props: UsernamePasswordWithSecondFactorProps,
) {
  const {
    verifyPassword,
    secondFactor,
    logo,
    loginText,
    cookieGeneration,
    otpGeneration,
    totpConfig,
    accountName,
  } = props;

  // Handler for successful first factor password verification
  const handleFirstFactorSuccess = (s: DomStatements) => {
    if (!secondFactor) {
      // No second factor required, complete authentication
      verifyPassword({
        s,
        generateCookie: true,
        loadingScalar: "waiting_2fa",
        errorScalar: "error",
      });
    } else if (secondFactor.method === "totp") {
      // TOTP: just verify password and go to second factor screen
      verifyPassword({
        s,
        onSuccess: (s) => {
          s.setScalar("auth_stage", sql.lit`second_factor`);
        },
        loadingScalar: "waiting_2fa",
        errorScalar: "error",
      });
    } else {
      // OTP (email/sms): verify password and send OTP code
      verifyPassword({
        s,
        onSuccess: (s) => {
          otpGeneration(s, {
            otpType: secondFactor.method === "email" ? "email" : "sms",
            loadingScalar: "waiting_2fa",
            errorScalar: "error",
          });
          s.setScalar("auth_stage", sql.lit`second_factor`);
        },
        loadingScalar: "waiting_2fa",
        errorScalar: "error",
      });
    }
  };

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("auth_stage", sql.lit`first_factor`); // 'first_factor' | 'second_factor'
        s.defScalar("waiting_2fa", false);
        if (
          secondFactor &&
          (secondFactor.method === "email" || secondFactor.method === "sms")
        ) {
          s.defScalar("error_2fa", {
            type: "String",
          });
        }
      }}
    >
      {secondFactor && (
        <Show
          when={sql`auth_stage = 'first_factor'`}
          fallback={
            <TwoFactorVerify
              secondFactor={secondFactor}
              generateCookie={cookieGeneration}
              logo={logo}
              otpGeneration={otpGeneration}
              totpConfig={totpConfig}
              accountName={accountName}
            />
          }
        >
          <UsernamePasswordForm
            verifyPassword={(s) => handleFirstFactorSuccess(s)}
            logo={logo}
            loginText={loginText}
          />
        </Show>
      )}
      {!secondFactor && (
        <UsernamePasswordForm
          verifyPassword={(s) => handleFirstFactorSuccess(s)}
          logo={logo}
          loginText={loginText}
        />
      )}
    </Data>
  );
}

function LoginPage(props: UsernamePasswordAuthProps) {
  const { logo, loginText, validateUser, requiredPermission } = props;
  const sysUserTable = system.db.tables.sys_users;
  const userFilter = getUserFilter(
    sysUserTable,
    validateUser,
    requiredPermission,
  );
  const hasMustChangePassword = !!sysUserTable.fields.must_change_password;
  const minPasswordLength = props.minPasswordLength ?? 8;

  const cookieNameSql = props.cookieName
    ? (typeof props.cookieName === "string"
      ? sql.lit(props.cookieName)
      : props.cookieName)
    : sql.lit`y-t`;
  const cookieOpts = authCookieOpts({
    cookieDomain: props.cookieDomain,
  });

  function cookieGeneration(s: UiServerStatements) {
    s.defScalar(
      "user_id_login",
      sql`(select id
          from sys_users where ${userFilter} and
          username = ui.username and
          password_hash = crypto.hash_password(ui.password, password_salt))`,
    );
    s.defScalar("token_id", sql`random.uuid()`);
    s.startTransaction();
    s.modify(
      sql`insert into auth_session_tokens (sys_user_id, issued, public_id, type) values (user_id_login, now(), token_id, 'username_password')`,
    );
    s.commitTransaction();
    s.setCookie(cookieNameSql, sql`token_id`, cookieOpts);
    props.afterLoginServer?.(s, {
      user: sql`user_id_login`,
      session: sql`token_id`,
    });
  }

  function cookieGenerationFromUserId(s: UiServerStatements) {
    s.defScalar("token_id", sql`random.uuid()`);
    s.startTransaction();
    s.modify(
      sql`insert into auth_session_tokens (sys_user_id, issued, public_id, type) values (ui.user_id, now(), token_id, 'username_password')`,
    );
    s.commitTransaction();
    s.setCookie(cookieNameSql, sql`token_id`, cookieOpts);
    props.afterLoginServer?.(s, {
      user: sql`ui.user_id`,
      session: sql`token_id`,
    });
  }

  function verifyPassword(
    verifyProps: {
      s: DomStatements;
      generateCookie?: boolean;
      onSuccess?: (s: DomStatements) => void;
      loadingScalar: string;
      errorScalar: string;
    },
  ) {
    const { s, generateCookie, onSuccess, loadingScalar, errorScalar } =
      verifyProps;
    s.returnIf(sql(loadingScalar));
    s.setScalar(loadingScalar, true);
    s.setScalar(errorScalar, sql.null);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        // Check if user exists and password_hash is null
        s.defScalar(
          "found_user_id",
          sql`(select id from sys_users where ${userFilter} and username = ui.username)`,
        );
        s.if(sql`found_user_id is not null`, (s) => {
          s.defScalar(
            "has_password",
            sql`(select password_hash is not null from sys_users where id = found_user_id)`,
          );
          s.if(sql`not has_password`, (s) => {
            s.setScalar(
              "error",
              sql.lit`No password set. Please contact your administrator.`,
            );
            s.return();
          });
        });
        s.defScalar(
          "user_id_login",
          sql`(select id
              from sys_users where ${userFilter} and
              username = ui.username and
              password_hash = crypto.hash_password(ui.password, password_salt))`,
        );
        s.if(sql`user_id_login is null`, (s) => {
          // Log failed login attempt
          logAuthFailure(
            s,
            sql`ui.username`,
            null,
            "invalid_credentials",
            sql.lit`username_password`,
          );
          s.setScalar("error", sql.lit`Invalid username or password`);
          s.return();
        });
        s.setScalar("user_id", sql`user_id_login`);

        // Check must_change_password
        if (hasMustChangePassword) {
          s.defScalar(
            "must_change",
            sql`(select must_change_password from sys_users where id = user_id_login)`,
          );
          s.if(sql`must_change`, (s) => {
            s.setScalar("up_auth_state", sql.lit`change_password`);
            s.return();
          });
        }

        if (generateCookie) {
          cookieGeneration(s);
        }
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          errorScalar,
          sql.concat("Error: ", sql`service_error.message`),
        );
        s.return();
      },
      finally: (s) => {
        s.setScalar(loadingScalar, false);
        s.if(
          sql`user_id is not null and up_auth_state != 'change_password'`,
          (s) => {
            onSuccess?.(s);
          },
        );
      },
    });
  }
  const applicationName = props.applicationName ?? "Yolm";
  const authBlock = useBlock(AuthBlock);
  const secondFactorAuthblock = authBlock.opts.secondFactor;
  if (secondFactorAuthblock && !secondFactorAuthblock.methods) {
    throw new Error("Second factor requires methods");
  }
  const identifierField = props.secondFactor?.method === "sms"
    ? "phone"
    : "email";
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
        s.defScalar(
          "user_id",
          sql`(select id
              from sys_users where ${userFilter} and
              username = ui.username and
              password_hash = crypto.hash_password(ui.password, password_salt))`,
        );
        s.if(
          sql`not exists (select 1 from sys_users where ${userFilter} and id = user_id)`,
          (s) => {
            s.setScalar("user_id", sql.null);
          },
        );
        s.if(sql`user_id is null`, (s) => {
          s.setScalar(
            opts.errorScalar,
            sql.concat("No user with that ", identifierField),
          );
          s.return();
        });
        const timeWindow = props.secondFactor?.rateLimit?.timeWindow ?? sql`10`;
        const maxAttempts = props.secondFactor?.rateLimit?.maxAttempts ??
          sql`3`;
        const devBypassCode = getCapabilities()?.blocks?.AuthBlock
          ?.devBypassCode;
        if (!devBypassCode) {
          s.if(
            sql`(select count(*) from auth_second_factor_otp_registrations where sys_user_id = user_id and abs(date.diff(minute, now(), registration_time)) <= ${timeWindow}) >= ${maxAttempts}`,
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
        s.defScalar("otp_second_factor_send_error_json", sql`null`);
        function sendEmailOtp(s: UiServerStatements) {
          s.setScalar("otp_second_factor_send_error_json", sql`null`);
          s.defScalar(
            "to_email",
            secondFactorAuthblock!.methods.email!.getEmailFromUserId(
              sql`user_id`,
            ),
          );
          s.sendEmail({
            to: sql`to_email`,
            from: secondFactorAuthblock?.methods.email?.fromEmail ??
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
          s.if(sql`otp_second_factor_send_error_json is not null`, (s) => {
            s.setScalar(
              opts.errorScalar,
              sql.concat(
                "Error: ",
                sql`coalesce(otp_second_factor_send_error_json->>'message', otp_second_factor_send_error_json->>'code', 'Unable to send access code')`,
              ),
            );
            s.return();
          });
        }
        function sendSmsOtp(s: UiServerStatements) {
          s.setScalar("otp_second_factor_send_error_json", sql`null`);
          const to = secondFactorAuthblock!.methods.sms!.getPhoneFromUserId(
            sql`user_id`,
          );
          if (secondFactorAuthblock?.methods.sms?.sendSms) {
            secondFactorAuthblock.methods.sms.sendSms(s, {
              to,
              code: sql`code`,
              from: secondFactorAuthblock.methods.sms.fromPhone,
              errorJsonScalar: "otp_second_factor_send_error_json",
            });
          } else {
            if (!secondFactorAuthblock?.methods.sms?.fromPhone) {
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
          s.if(sql`otp_second_factor_send_error_json is not null`, (s) => {
            s.setScalar(
              opts.errorScalar,
              sql.concat(
                "Error: ",
                sql`coalesce(otp_second_factor_send_error_json->>'message', otp_second_factor_send_error_json->>'code', 'Unable to send access code')`,
              ),
            );
            s.return();
          });
        }
        if (devBypassCode) {
          s.debugExpr(sql`code`);
        } else {
          if (
            secondFactorAuthblock?.methods.email &&
            props.secondFactor?.method === "email"
          ) {
            sendEmailOtp(s);
          } else if (
            secondFactorAuthblock?.methods.sms &&
            props.secondFactor?.method === "sms"
          ) {
            sendSmsOtp(s);
          }
        }
        if (
          props.secondFactor?.method === "sms" ||
          props.secondFactor?.method === "email"
        ) {
          s.startTransaction();
          s.modify(
            sql`insert into auth_second_factor_otp_registrations (sys_user_id, hash, salt, registration_time, otp_type) values
              (user_id, crypto.hmac_sha256(code, salt), salt, now(), ui.selected_channel_2fa)`,
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
    <Data
      local
      procedure={(s) => {
        s.defScalar("username", sql.lit``);
        s.defScalar("password", sql.lit``);
        s.defScalar("up_auth_state", sql.lit`login`);
        s.defScalar("user_id", {
          type: "BigInt",
        });
        s.defScalar("error", {
          type: "String",
        });
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
          md: {
            p: 4,
          },
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
              sm: {
                px: 12,
                py: 10,
              },
            },
            props.sx,
          ]}
          className={props.className}
        >
          <Show
            when={sql`up_auth_state = 'login'`}
          >
            <UsernamePasswordWithSecondFactor
              verifyPassword={verifyPassword}
              secondFactor={props.secondFactor}
              logo={logo}
              loginText={loginText}
              cookieGeneration={cookieGeneration}
              otpGeneration={otpGeneration}
              totpConfig={authBlock.opts.secondFactor?.methods.totp}
              accountName={sql`ui.username`}
            />
          </Show>
          {hasMustChangePassword && (
            <Show when={sql`up_auth_state = 'change_password'`}>
              <ChangePasswordForm
                title="Change your password"
                subtitle="Your administrator requires you to change your password."
                minPasswordLength={minPasswordLength}
                logo={logo
                  ? (
                    <img
                      src={logo.src}
                      alt={logo.alt}
                      className={logo.className}
                      sx={{ maxWidth: 80, ...logo.sx }}
                    />
                  )
                  : <YolmLogo />}
                onSave={(s) => {
                  hashAndStorePassword(s, sql`ui.user_id`, {
                    clearLegacyPassword: !!authBlock.opts.legacyPasswords,
                  });
                  cookieGenerationFromUserId(s);
                }}
              />
            </Show>
          )}
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
    s.tryServer({
      body: (s) => {
        s.getCookie(this.cookieName, "token_id_cookie");
        s.defScalar("token_id", sql`try_cast(token_id_cookie.value as uuid)`);
        s.if(sql`token_id is not null`, (s) => {
          s.startTransaction();
          s.modify(
            sql`delete from auth_session_tokens where public_id = token_id`,
          );
          s.commitTransaction();
        });
      },
      errorName: "service_error",
      catch: (s) => {
        s.debugExpr(sql.lit`Failed to logout on server`);
      },
    });
    s.clearLocalData();
  };

  authenticate = (s: EndpointStatements) => {
    s.getCookie(this.cookieName, "token_id_cookie");
    s.defScalar("token_id", sql`try_cast(token_id_cookie.value as uuid)`);
    s.defScalar(
      "user_id",
      authSessionUserExpr(sql`token_id`, this.sessionExpiration),
    );
    s.if(sql`user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return();
    });
    if (this.userFilter !== true) {
      s.unless(
        sql`(select ${this.userFilter} from sys_users where id = user_id)`,
        (s) => {
          s.setHttpStatus(401);
          s.return();
        },
      );
    }
  };
}

/**
This helper allows you to use username and password for authentication.
To use it, you need to have a `username` field, `password_hash` field and `password_salt` field on the `sys_users` table.
Use the `usernamePasswordFields` field group to add those fields.

@category Authentication Component

@examples
[Example](../../../platform_test_systems/hello_world/system.tsx)
*/
export function UsernamePasswordAuth(props: UsernamePasswordAuthProps) {
  const sysUserTable = system.db.tables.sys_users;
  if (!sysUserTable) {
    throw new Error(
      "Please add a sys_users table to your system before using usernamePasswordAuth",
    );
  }
  if (!sysUserTable.fields.username) {
    throw new Error(
      "Please specify a username field on the sys_users table before using usernamePasswordAuth",
    );
  }
  if (!sysUserTable.fields.password_hash) {
    throw new Error(
      "Please specify a password_hash field on the sys_users table before using usernamePasswordAuth",
    );
  }
  if (!sysUserTable.fields.password_salt) {
    throw new Error(
      "Please specify a password_salt field on the sys_users table before using usernamePasswordAuth",
    );
  }
  const userFilter = getUserFilter(
    sysUserTable,
    props.validateUser,
    props.requiredPermission,
  );

  // Check capabilities for auto-login bypass
  const caps = getCapabilities();
  const authCaps = caps?.blocks?.AuthBlock;

  const cookieName = props.cookieName
    ? (typeof props.cookieName === "string"
      ? sql.lit(props.cookieName)
      : props.cookieName)
    : sql.lit`y-t`;

  // User selector mode: show a user picker instead of login form
  if (authCaps?.authEnabled === false && authCaps.userSelectorMode) {
    addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
    return (
      <UserSelector
        userFilter={userFilter}
        cookieName={cookieName}
        sessionTokenType={sql`'username_password'::enums.session_token_type`}
        applicationName={props.applicationName}
        idleTimeout={props.idleTimeout}
      >
        {props.children}
      </UserSelector>
    );
  }

  // Auto-login mode: bypass auth with a specific user
  if (
    authCaps?.authEnabled === false && authCaps.defaultUserIdentifier
  ) {
    const identifier = String(authCaps.defaultUserIdentifier);
    addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
    const wrappedChildren = props.idleTimeout
      ? (
        <IdleTimeout
          config={props.idleTimeout}
          cookieName={cookieName}
          sessionless
        >
          {props.children}
        </IdleTimeout>
      )
      : props.children;
    return (
      <Authorize
        procedure={(s) => {
          s.defScalar(
            "auto_user_id",
            sql`coalesce(current_user, (select id from sys_users where username = ${
              sql.lit(identifier)
            }))`,
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
      unauthorized={<LoginPage {...props} />}
    >
      {wrappedChildren}
    </Authorize>
  );
}

function getUserFilter(
  sysUserTable: Table,
  validateUser: BooleanExpr | undefined,
  requiredPermission: string | undefined,
) {
  let userFilter: BooleanExpr = true;
  if (sysUserTable.fields.disabled) {
    userFilter = sql`not disabled`;
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
