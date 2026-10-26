import { YolmIcon } from "components/icons/yolm";
import { AuthApiICtxKey, LogoutCleanupRegistry, LogoutICtxKey } from "std/ictx";
import type { AuthApiICtx, LogoutICtx } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { system, useBlock } from "std/system";
import type { Table } from "std/system";
import { addCtx, Authorize, Show, useApp, useTheme } from "std/ui";
import { Data } from "std/data";
import type { ContextInstance, Node } from "std/ui";

import { getCapabilities } from "std/yolm_gen_api";
import { Alert } from "../../components/alert";
import { generateWaveBackground } from "../../components/backgrounds/wave";
import { Button } from "../../components/button";
import { FormControl } from "../../components/form_control";
import { FormLabel } from "../../components/form_label";
import { Input } from "../../components/input";
import {
  OneTimePasswordInput,
  otpDigits,
} from "../../components/one_time_password_input";
import { Radio } from "../../components/radio";
import { RadioGroup } from "../../components/radio_group";
import { Typography } from "../../components/typography";
import { AuthBlock, userHasPermission } from "./index";
import { AccessActorICtxKey } from "./access_policy";
import { ImpersonationBanner } from "./impersonation_banner";
import type { AfterLoginServerProps, DefaultAuthComponentProps } from "./index";
import {
  authCookieOpts,
  authSessionDurationSeconds,
  authSessionUserExpr,
  otpEmailTemplate,
} from "./shared";
import type { Sql } from "../../std/sql_utils";
import type { AppSecondFactorConfig } from "./index";
import { IdleTimeout } from "./idle_timeout";
import type { IdleTimeoutConfig } from "./idle_timeout";
import { TwoFactorVerify } from "./2fa_auth";
import { CircularProgress } from "components/circular_progress";
import { UserSelector } from "./user_selector";

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

/** Logo image shown on the auth screens; replaces the default Yolm wordmark. */
export interface Logo {
  src: Sql | string;
  alt: Sql | string;
  sx?: Style;
  className?: string;
}

export interface OTPAuthProps {
  applicationName?: string;
  logo?: Logo;
  sx?: Style;
  className?: string;
  loginText?: Sql | string;
  validateUser?: BooleanExpr;
  requiredPermission?: string;
  identifier:
    | "email"
    | "phone"
    | {
      field: "email" | "phone";
      getUserFromIdentifier: (identifier: Sql) => Sql;
    };
  channels: {
    email?: {
      fromEmail?: Sql | string;
      getEmailFromUserId?: (email: Sql) => Sql;
    };
    sms?: {
      getPhoneFromUserId?: (userId: Sql) => Sql;
      sendSms?: (
        s: UiServerStatements,
        opts: {
          to: Sql;
          code: Sql;
          from?: Sql | string;
          errorJsonScalar?: string;
        },
      ) => void;
      fromPhone?: Sql | string;
    };
  };
  defaultChannel?: "email" | "sms";
  children: Node;
  /** Custom login content; session and authorization checks are unchanged. */
  unauthorized?: Node;
  cookieExpiration?: Sql;
  cookieDomain?: Sql | string;
  cookieName?: Sql | string;
  rateLimit?: {
    /** The maximum number of attempts allowed in the time window. defaults to 3 */
    maxAttempts: Sql;
    /** The time window in minutes. defaults to 10 */
    timeWindow: Sql;
  };
  /**
   * Delegate user resolution, throttling, delivery, and OTP registration to
   * reusable server code such as a stored procedure.
   */
  requestCode?: (
    s: UiServerStatements,
    props: {
      identifier: Sql;
      selectedChannel: Sql;
      userIdOutput: string;
      errorOutput: string;
    },
  ) => void;
  /**
           Node that is displayed below the login form and under the "We will send you a code to..." text
           */
  belowLoginNode?: Node;
  afterLoginServer?: (
    s: UiServerStatements,
    props: AfterLoginServerProps,
  ) => void;
  secondFactor?: AppSecondFactorConfig;
  idleTimeout?: IdleTimeoutConfig;
}

/**
 * The standalone OTP login screen (identifier entry + code verification),
 * without the surrounding authorization gate. {@link OTPAuth} renders this as
 * its `unauthorized` view; use it directly only when you need the login form
 * on its own (e.g. a custom auth layout).
 *
 * @category Page Component
 */
export interface OTPLoginProps
  extends Omit<OTPAuthProps, "children" | "unauthorized"> {
  /** Initial identifier when switching between login methods. */
  initialIdentifier?: Sql;
  /** Method selector rendered inside the login state scope. */
  methodSelector?: Node;
}

export function OTPLogin(props: OTPLoginProps) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("identifier", props.initialIdentifier ?? sql.lit``);
        s.defScalar("show_register", false);
        s.defScalar("waiting", false);
        if (props.channels.email && props.channels.sms) {
          s.defScalar(
            "selected_channel",
            sql`cast(${
              sql.lit(props.defaultChannel ?? "sms")
            } as enums.auth_otp_registration_type)`,
          );
        } else if (props.channels.email) {
          s.defScalar(
            "selected_channel",
            sql`'email'::enums.auth_otp_registration_type`,
          );
        } else if (props.channels.sms) {
          s.defScalar(
            "selected_channel",
            sql`'sms'::enums.auth_otp_registration_type`,
          );
        }
        s.defScalar("user_id", {
          type: "BigUint",
        });
        s.defScalar("error", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        otpDigits(s, "code_digits", 6);
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
            when={sql`show_register`}
            fallback={<IdentifierLogin {...props} />}
          >
            <Register {...props} />
          </Show>
          {props.methodSelector}
        </div>
      </div>
    </Data>
  );
}

function tableUserFromIdentifier(table: Table) {
  if (table.fields.email) {
    return (identifier: Sql) =>
      sql`(select sys_users.id from ${table.identWithDb} auto join sys_users where email = ${identifier})`;
  }
  throw new Error(
    `Auth block has no email field for user type ${table.name}, you must specify how to get the user from the identifier`,
  );
}

/**
 * Default branding shown on auth screens when no {@link Logo} is supplied —
 * the Yolm wordmark with its icon.
 *
 * @category UI Component
 */
export function YolmLogo() {
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

function IdentifierLogin(props: OTPLoginProps) {
  const { logo, loginText } = props;
  const userFilter = getUserFilter(props);
  const applicationName = props.applicationName ?? "Yolm";
  if (
    !props.requestCode &&
    props.channels.sms &&
    !props.channels.sms.sendSms &&
    !props.channels.sms.fromPhone
  ) {
    throw new Error(
      "SMS channel requires sendSms callback or fromPhone for default sendSms",
    );
  }
  const identifierField = typeof props.identifier === "string"
    ? props.identifier
    : props.identifier.field;
  let getUserFromIdentifier: (identifier: Sql) => Sql;
  if (typeof props.identifier === "string") {
    const authBlock = system.block(AuthBlock);
    if (authBlock.userTypes.length === 0) {
      throw new Error(
        "Auth block has no user types, you must specify how to get the user from the identifier",
      );
    }
    if (authBlock.userTypes.length === 1) {
      const table = authBlock.userTypes[0].table;
      if (table.fields.email) {
        getUserFromIdentifier = tableUserFromIdentifier(table);
      } else {
        throw new Error(
          `Auth block has no email field for user type ${table.name}, you must specify how to get the user from the identifier`,
        );
      }
    } else {
      getUserFromIdentifier = (identifier) => {
        return sql.coalesce(
          authBlock.userTypes.map((userType) =>
            tableUserFromIdentifier(userType.table)(identifier)
          ),
        );
      };
    }
  } else {
    getUserFromIdentifier = props.identifier.getUserFromIdentifier;
  }
  function submitLogin(s: DomStatements) {
    s.returnIf(sql`waiting`);
    s.if(sql`trim(ui.identifier) = ''`, (s) => {
      s.setScalar(
        "error",
        sql.concat(
          identifierField === "email" ? "Email" : "Phone",
          sql.lit` is required`,
        ),
      );
      s.return();
    });
    s.setScalar("waiting", true);
    s.setScalar("error", sql.null);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        if (props.requestCode) {
          s.defScalar("request_code_user_id", { type: "BigUint" });
          s.defScalar("request_code_error", {
            type: "String",
            expr: sql.null,
          });
          props.requestCode(s, {
            identifier: sql`ui.identifier`,
            selectedChannel: sql`ui.selected_channel`,
            userIdOutput: "request_code_user_id",
            errorOutput: "request_code_error",
          });
          s.if(sql`request_code_error is not null`, (s) => {
            s.setScalar("error", sql`request_code_error`);
            s.return();
          });
          s.if(sql`request_code_user_id is null`, (s) => {
            s.throwError(
              sql.lit`OTP request handler returned neither a user nor an error`,
            );
          });
          s.setScalar("ui.user_id", sql`request_code_user_id`);
          s.setScalar("show_register", true);
          return;
        }
        s.defScalar("user_id", getUserFromIdentifier(sql`ui.identifier`));
        s.if(
          sql`not exists (select 1 from sys_users where ${userFilter} and id = user_id)`,
          (s) => {
            s.setScalar("user_id", sql.null);
          },
        );
        s.if(sql`user_id is null`, (s) => {
          const authType = props.channels.email && props.channels.sms
            ? sql`case when ui.selected_channel = 'email' then 'otp_email'::enums.session_token_type else 'otp_sms'::enums.session_token_type end`
            : props.channels.email
            ? sql`'otp_email'::enums.session_token_type`
            : sql`'otp_sms'::enums.session_token_type`;
          logAuthFailure(
            s,
            sql`ui.identifier`,
            null,
            "user_not_found",
            authType,
          );
          s.setScalar(
            "error",
            sql.concat("No user with that ", identifierField),
          );
          s.return();
        });
        const timeWindow = props.rateLimit?.timeWindow ?? sql`10`;
        const maxAttempts = props.rateLimit?.maxAttempts ?? sql`3`;
        const devBypassCode = getCapabilities()?.blocks?.AuthBlock
          ?.devBypassCode;
        if (!devBypassCode) {
          s.if(
            sql`(select count(*) from auth_otp_registrations where sys_user_id = user_id and abs(date.diff(minute, now(), registration_time)) <= ${timeWindow}) >= ${maxAttempts}`,
            (s) => {
              const authType = props.channels.email && props.channels.sms
                ? sql`case when ui.selected_channel = 'email' then 'otp_email'::enums.session_token_type else 'otp_sms'::enums.session_token_type end`
                : props.channels.email
                ? sql`'otp_email'::enums.session_token_type`
                : sql`'otp_sms'::enums.session_token_type`;
              logAuthFailure(
                s,
                sql`ui.identifier`,
                sql`user_id`,
                "rate_limit_exceeded",
                authType,
              );
              s.setScalar(
                "error",
                sql.lit`Too many attempts, please try again later`,
              );
              s.return();
            },
          );
        }
        s.defScalar("code", sql`crypto.digit_otp(6)`);
        s.defScalar("salt", sql`crypto.random_bytes(32)`);
        function sendEmailOtp(s: UiServerStatements) {
          s.defScalar(
            "to_email",
            props.channels.email?.getEmailFromUserId?.(sql`user_id`) ??
              sql`identifier`,
          );
          s.sendEmail({
            to: sql`to_email`,
            from: props.channels.email?.fromEmail ??
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
            errorJsonScalar: "otp_send_error_json",
          });
          s.if(sql`__send_email_result_json is null`, () => {});
          s.if(sql`otp_send_error_json is not null`, (s) => {
            s.setScalar(
              "error",
              sql.concat(
                "Error: ",
                sql`coalesce(otp_send_error_json->>'message', otp_send_error_json->>'code', 'Unable to send access code')`,
              ),
            );
            s.return();
          });
        }
        function sendSmsOtp(s: UiServerStatements) {
          const to = props.channels.sms!.getPhoneFromUserId?.(sql`user_id`) ??
            sql`identifier`;
          if (props.channels.sms?.sendSms) {
            props.channels.sms.sendSms(s, {
              to,
              code: sql`code`,
              from: props.channels.sms.fromPhone,
              errorJsonScalar: "otp_send_error_json",
            });
          } else {
            s.sendSms({
              to,
              from: props.channels.sms!.fromPhone!,
              body: sql.concat(
                `Your ${applicationName} access code is `,
                sql`code`,
              ),
              errorJsonScalar: "otp_send_error_json",
            });
          }
          s.if(sql`otp_send_error_json is not null`, (s) => {
            s.setScalar(
              "error",
              sql.concat(
                "Error: ",
                sql`coalesce(otp_send_error_json->>'message', otp_send_error_json->>'code', 'Unable to send access code')`,
              ),
            );
            s.return();
          });
        }
        if (devBypassCode) {
          s.debugExpr(sql`code`);
        } else {
          if (props.channels.email && props.channels.sms) {
            s.if(sql`ui.selected_channel = 'email'`, sendEmailOtp);
            s.if(sql`ui.selected_channel = 'sms'`, sendSmsOtp);
          } else if (props.channels.email) {
            sendEmailOtp(s);
          } else if (props.channels.sms) {
            sendSmsOtp(s);
          }
        }
        s.startTransaction();
        s.modify(
          sql`insert into auth_otp_registrations (sys_user_id, hash, salt, registration_time, otp_type) values
            (user_id, crypto.hmac_sha256(code, salt), salt, now(), ui.selected_channel)`,
        );
        s.commitTransaction();
        s.setScalar("ui.user_id", sql`user_id`);
        s.setScalar("show_register", true);
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar(
          "error",
          sql.concat(
            "Error: ",
            sql`coalesce(service_error.message, service_error.type::string)`,
          ),
        );
      },
    });
    s.setScalar("waiting", false);
  }
  return (
    <>
      {logo
        ? (
          <img
            src={logo.src}
            alt={logo.alt}
            sx={[
              {
                maxWidth: 100,
              },
              logo.sx,
            ]}
            className={props.logo?.className}
          />
        )
        : <YolmLogo />}
      <Typography level="h3" className="mb-4 text-center">
        {loginText ?? `Sign in to ${applicationName}`}
      </Typography>

      <form
        className="w-full"
        noValidate
        onSubmit={(s) => {
          s.event.preventDefault();
          submitLogin(s);
        }}
      >
        <FormControl fullWidth className="mb-4">
          <FormLabel htmlFor="identifier">
            {identifierField === "email" ? "Email" : "Phone"}
          </FormLabel>
          <Input
            bindScalar="identifier"
            type={identifierField === "email" ? "email" : "tel"}
            placeholder={identifierField === "email"
              ? "john@example.com"
              : "(555) 555-5555"}
            id="identifier"
            fullWidth
            autoFocus
            size="lg"
          />
        </FormControl>

        {!props.methodSelector && props.channels.email && props.channels.sms &&
          (
            <FormControl fullWidth className="mb-6">
              <FormLabel>How should we send your code?</FormLabel>
              <RadioGroup color="primary">
                <Radio
                  value={sql.lit`email`}
                  checked={sql`ui.selected_channel = 'email'`}
                  label="Email"
                  size="lg"
                  color="primary"
                  onChange={(s) =>
                    s.setScalar(
                      "ui.selected_channel",
                      sql`'email'::enums.auth_otp_registration_type`,
                    )}
                />
                <Radio
                  value={sql.lit`sms`}
                  checked={sql`ui.selected_channel = 'sms'`}
                  label="Text message"
                  size="lg"
                  color="primary"
                  onChange={(s) =>
                    s.setScalar(
                      "ui.selected_channel",
                      sql`'sms'::enums.auth_otp_registration_type`,
                    )}
                />
              </RadioGroup>
            </FormControl>
          )}

        <Button type="submit" fullWidth loading={sql`waiting`} size="lg">
          {props.methodSelector
            ? sql`case when ui.selected_channel = 'email' then 'Send email code' else 'Send text code' end`
            : "Send code"}
        </Button>
        {props.methodSelector && props.channels.email && props.channels.sms && (
          <Button
            type="button"
            variant="plain"
            size="sm"
            fullWidth
            className="mt-2"
            disabled={sql`waiting`}
            onClick={(s) => {
              s.setScalar(
                "ui.selected_channel",
                sql`case when ui.selected_channel = 'email' then 'sms'::enums.auth_otp_registration_type else 'email'::enums.auth_otp_registration_type end`,
              );
              s.setScalar("error", sql.null);
            }}
          >
            {sql`case when ui.selected_channel = 'email' then 'Use text messages instead' else 'Use email instead' end`}
          </Button>
        )}
      </form>

      <Show when={sql`error is not null`}>
        <Alert color="danger" className="mt-4 w-full">
          {sql`error`}
        </Alert>
      </Show>

      <Typography level="body-sm" className="mt-4 text-center">
        We will send you a one-time code to verify your identity.
      </Typography>
      {props.belowLoginNode}
    </>
  );
}
function OTPLoginUI(
  props: { verifyCode: (s: DomStatements, code: Sql) => void; logo?: Logo },
) {
  const { verifyCode, logo } = props;
  return (
    <>
      {logo
        ? (
          <img
            src={logo.src}
            alt={logo.alt}
            sx={logo.sx ?? { maxWidth: 100 }}
          />
        )
        : <YolmLogo />}
      <Typography level="h3" className="text-center font-bold">
        Enter Your Code
      </Typography>
      <Typography level="body-md" className="text-center mt-2 mb-6 text-[#555]">
        We have sent a 6-digit code to the contact method you selected. Please
        enter it below to complete the sign-in process.
      </Typography>
      <div className="w-full flex flex-row justify-center gap-4 pt-4">
        <OneTimePasswordInput
          size="lg"
          digits={6}
          digitsRecord="code_digits"
          error={sql`error is not null`}
          focusFirstImmediately
          onComplete={(s, code) => verifyCode(s, code)}
        />
      </div>
      <Show when={sql`error is not null`}>
        <Alert color="danger" className="mt-4">{sql`error`}</Alert>
      </Show>
    </>
  );
}

// Internal component for OTP with second factor support
interface OTPWithSecondFactorProps {
  verifyOtpCode: (props: {
    s: DomStatements;
    code: Sql;
    otpTable: string;
    generateCookie?: boolean;
    onSuccess?: (s: DomStatements) => void;
  }) => void;
  secondFactor?: AppSecondFactorConfig;
  logo?: Logo;
  cookieGeneration: (s: UiServerStatements) => void;
  otpGeneration: (
    s: DomStatements,
    opts: {
      otpType: "email" | "sms";
      loadingScalar: string;
      errorScalar: string;
      onStartTransaction?: (s: UiServerStatements) => void;
      finally?: (s: DomStatements) => void;
    },
  ) => void;
  totpConfig?: {
    issuerName: string;
  };
  accountName?: Sql;
}

function OTPWithSecondFactor(props: OTPWithSecondFactorProps) {
  const {
    verifyOtpCode,
    secondFactor,
    logo,
    cookieGeneration,
    otpGeneration,
    totpConfig,
    accountName,
  } = props;

  // Handler for successful first factor OTP verification
  const handleFirstFactorSuccess = (s: DomStatements, code: Sql) => {
    if (!secondFactor) {
      // No second factor required, complete authentication
      verifyOtpCode({
        s,
        code,
        otpTable: "auth_otp_registrations",
        generateCookie: true,
      });
    } else {
      // Verify first factor OTP and proceed to second factor
      verifyOtpCode({
        s,
        code,
        otpTable: "auth_otp_registrations",
        onSuccess: (s) => {
          // For TOTP, we don't generate an OTP - user uses their authenticator app
          // For email/sms, we need to generate and send an OTP for the second factor
          if (
            secondFactor.method === "email" || secondFactor.method === "sms"
          ) {
            otpGeneration(s, {
              otpType: secondFactor.method,
              loadingScalar: "waiting_2fa",
              errorScalar: "error_2fa",
            });
          }
          s.setScalar("auth_stage", sql.lit`second_factor`);
        },
      });
    }
  };

  return (
    <Data
      local
      procedure={(s) => {
        if (secondFactor) {
          // State management for the authentication flow
          s.defScalar("auth_stage", sql.lit`first_factor`); // 'first_factor' | 'second_factor'
          s.defScalar("waiting_2fa", false);
          if (
            secondFactor.method === "email" || secondFactor.method === "sms"
          ) {
            s.defScalar("error_2fa", {
              type: "String",
            });
          }
        }
      }}
    >
      {secondFactor && (
        <Show
          when={sql`auth_stage = 'first_factor'`}
          fallback={
            <Show
              when={sql`not waiting_2fa`}
              fallback={<CircularProgress size="lg" />}
            >
              <TwoFactorVerify
                secondFactor={secondFactor}
                generateCookie={cookieGeneration}
                logo={logo}
                otpGeneration={otpGeneration}
                totpConfig={totpConfig}
                accountName={accountName}
              />
            </Show>
          }
        >
          <OTPLoginUI
            verifyCode={(s, code) => handleFirstFactorSuccess(s, code)}
            logo={logo}
          />
        </Show>
      )}
      {!secondFactor && (
        <OTPLoginUI
          verifyCode={(s, code) => handleFirstFactorSuccess(s, code)}
          logo={logo}
        />
      )}
    </Data>
  );
}

function Register(props: Omit<OTPAuthProps, "children">) {
  const { logo } = props;
  const cookieName = typeof props.cookieName === "string"
    ? sql.lit(props.cookieName)
    : (props.cookieName ?? sql.lit`y-t`);
  function cookieGeneration(s: UiServerStatements) {
    s.debug("here");
    s.defScalar("token_id", sql`random.uuid()`);
    s.startTransaction();
    s.modify(
      sql`insert into auth_session_tokens (sys_user_id, issued, public_id, type) values (
          ui.user_id,
          now(),
          token_id,
          case when ui.selected_channel = 'email' then 'otp_email'::enums.session_token_type else 'otp_sms'::enums.session_token_type end
      )`,
    );
    s.commitTransaction();
    s.setCookie(
      cookieName,
      sql`token_id`,
      authCookieOpts({
        cookieDomain: props.cookieDomain,
      }),
    );
    props.afterLoginServer?.(s, {
      user: sql`ui.user_id`,
      session: sql`token_id`,
    });
  }
  function verifyOtpCode(
    props: {
      s: DomStatements;
      code: Sql;
      generateCookie?: boolean;
      onSuccess?: (s: DomStatements) => void;
      otpTable: string;
    },
  ) {
    const { s, code, generateCookie, onSuccess, otpTable } = props;
    s.setScalar("error", sql.null);
    const devBypassCode = getCapabilities()?.blocks?.AuthBlock?.devBypassCode;
    s.tryServer({
      body: (s) => {
        if (devBypassCode) {
          s.if(sql`${code} != '111111'`, (s) => {
            logAuthFailure(
              s,
              sql`ui.identifier`,
              sql`ui.user_id`,
              "invalid_otp_code",
              sql`case when ui.selected_channel = 'email' then 'otp_email'::enums.session_token_type else 'otp_sms'::enums.session_token_type end`,
            );
            s.setScalar("error", sql.lit`Invalid code`);
            s.return();
          });
        } else {
          s.debugExpr(sql.lit`${otpTable}`);
          s.if(
            sql`not exists (select 1 from ${sql.ref(otpTable)}
            where sys_user_id = ui.user_id and
            hash = crypto.hmac_sha256(${code}, salt) and
            abs(date.diff(minute, now(), registration_time)) <= 10)`,
            (s) => {
              logAuthFailure(
                s,
                sql`ui.identifier`,
                sql`ui.user_id`,
                "invalid_otp_code",
                sql`case when ui.selected_channel = 'email' then 'otp_email'::enums.session_token_type else 'otp_sms'::enums.session_token_type end`,
              );
              s.setScalar("error", sql.lit`Unknown code`);
              s.return();
            },
          );
        }
        if (generateCookie) {
          cookieGeneration?.(s);
        }
      },
      finally: (s) => {
        if (onSuccess) {
          s.if(sql`error is null`, (s) => {
            onSuccess(s);
          });
        }
      },
      errorName: "service_error",
      catch: (s) => {
        s.setScalar("error", sql.concat("Error: ", sql`service_error.message`));
        s.return();
      },
    });
  }
  const userFilter = getUserFilter(props);
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
      onStartTransaction?: (s: UiServerStatements) => void;
      finally?: (s: DomStatements) => void;
    },
  ) {
    s.returnIf(sql(opts.loadingScalar));
    s.if(sql`trim(ui.identifier) = ''`, (s) => {
      s.setScalar(
        "error",
        sql.concat(
          identifierField === "email" ? "Email" : "Phone",
          sql.lit` is required`,
        ),
      );
      s.return();
    });
    s.setScalar(opts.loadingScalar, true);
    s.setScalar(opts.errorScalar, sql.null);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        opts.onStartTransaction?.(s);
        s.commitTransaction();
        s.defScalar(
          "enabled_second_factor",
          sql`exists(select 1 from auth_second_factor_settings where sys_user_id = ui.user_id and enabled = true)`,
        );
        s.returnIf(sql`not enabled_second_factor`);
        s.if(
          sql`not exists (select 1 from sys_users where ${userFilter} and id = user_id)`,
          (s) => {
            s.setScalar("user_id", sql.null);
          },
        );
        s.if(sql`user_id is null`, (s) => {
          s.setScalar(
            "error",
            sql.concat("No user with that ", identifierField),
          );
          s.return();
        });
        const sfDevBypassCode = getCapabilities()?.blocks?.AuthBlock
          ?.devBypassCode;
        if (
          props.secondFactor?.method === "sms" ||
          props.secondFactor?.method === "email"
        ) {
          const timeWindow = props.secondFactor?.rateLimit?.timeWindow ??
            sql`10`;
          const maxAttempts = props.secondFactor?.rateLimit?.maxAttempts ??
            sql`3`;
          if (!sfDevBypassCode) {
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
        }
        s.defScalar("code", sql`crypto.digit_otp(6)`);
        s.defScalar("salt", sql`crypto.random_bytes(32)`);
        function sendEmailOtp(s: UiServerStatements) {
          s.defScalar(
            "to_email",
            secondFactorAuthblock?.methods.email?.getEmailFromUserId?.(
              sql`user_id`,
            ) ?? sql`identifier`,
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
        if (sfDevBypassCode) {
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
        s.setScalar("ui.user_id", sql`user_id`);
      },
      errorName: "service_error",
      finally: (s) => {
        opts.finally?.(s);
      },
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
  // Get TOTP config from AuthBlock if available
  const totpConfig = authBlock.opts.secondFactor?.methods.totp;

  return (
    <Data
      local
      procedure={(s) => {
        if (props.secondFactor && props.secondFactor.method === "sms") {
          s.defScalar(
            "selected_channel_2fa",
            sql`'sms'::enums.auth_second_factor_otp_type`,
          );
        } else if (
          props.secondFactor && props.secondFactor.method === "email"
        ) {
          s.defScalar(
            "selected_channel_2fa",
            sql`'email'::enums.auth_second_factor_otp_type`,
          );
        }
      }}
    >
      <OTPWithSecondFactor
        verifyOtpCode={verifyOtpCode}
        secondFactor={props.secondFactor}
        logo={logo}
        cookieGeneration={cookieGeneration}
        otpGeneration={otpGeneration}
        totpConfig={totpConfig}
        accountName={sql`ui.identifier`}
      />
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

/**
This helper allows you to use OTP (one-time password) for authentication.
This component provides one-time password (OTP) authentication functionality. It supports:

- Email-based OTP delivery
- SMS-based OTP delivery
- Rate limiting of OTP attempts
- Optional user validation
- Permission-based access control
- Cookie-based session management
- User impersonation support

Ensure you import this component with the "blocks/auth/otp_auth" path.

To use this component, enable the `AuthBlock` in your system.

@param props.identifier Configuration for identifying users
@param props.identifier.field The field used to identify users (sql.g. "email")
@param props.identifier.getUserFromIdentifier Function that returns user ID from identifier value
@param props.channels Configuration for OTP delivery channels
@param props.channels.email Email channel configuration
@param props.channels.email.getEmailFromUserId Function that returns email address for user ID
@param props.validateUser Optional function to validate user before authentication
@param props.requiredPermission Optional permission required for access
@param props.cookieName Optional custom name for auth cookie (defaults to "y-t")
@param props.rateLimit Optional rate limiting configuration
@param props.rateLimit.maxAttempts Maximum number of attempts allowed
@param props.rateLimit.timeWindow Time window in minutes for rate limiting
@param props.children Content to render when authenticated


 */
function buildGetUserFromIdentifier(
  props: Pick<OTPAuthProps, "identifier">,
): (identifier: Sql) => Sql {
  if (typeof props.identifier === "string") {
    const authBlock = system.block(AuthBlock);
    if (authBlock.userTypes.length === 0) {
      throw new Error(
        "Auth block has no user types, you must specify how to get the user from the identifier",
      );
    }
    if (authBlock.userTypes.length === 1) {
      const table = authBlock.userTypes[0].table;
      return tableUserFromIdentifier(table);
    }
    return (identifier) =>
      sql.coalesce(
        authBlock.userTypes.map((userType) =>
          tableUserFromIdentifier(userType.table)(identifier)
        ),
      );
  }
  return props.identifier.getUserFromIdentifier;
}

/**
 * One-time-password authentication gate. Renders the {@link OTPLogin} screen
 * when no valid session exists and its `children` once the user has verified a
 * code sent over email and/or SMS. Requires the {@link AuthBlock} and a
 * `sys_users` table.
 *
 * Supports rate limiting, per-user validation, a `requiredPermission` gate,
 * optional second-factor challenge, idle timeout, and user impersonation. In
 * dev/preview capability modes it can auto-login or show a user picker instead
 * of the login form.
 *
 * Import from `blocks/auth/otp_auth`.
 *
 * @category Page Component
 */
export function OTPAuth(props: OTPAuthProps) {
  const sysUserTable = system.db.tables.sys_users;
  if (!sysUserTable) {
    throw new Error(
      "Please add a sys_users table to your system before using OTPAuth",
    );
  }

  // Check capabilities for auto-login bypass
  const caps = getCapabilities();
  const authCaps = caps?.blocks?.AuthBlock;

  // User selector mode: show a user picker instead of login form
  if (authCaps?.authEnabled === false && authCaps.userSelectorMode) {
    const cookieName = typeof props.cookieName === "string"
      ? sql.lit(props.cookieName)
      : (props.cookieName ?? sql.lit`y-t`);
    const userFilter = getUserFilter(props);
    addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
    return (
      <UserSelector
        userFilter={userFilter}
        cookieName={cookieName}
        sessionTokenType={sql`'otp_email'::enums.session_token_type`}
        applicationName={props.applicationName}
        logo={props.logo}
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
    const getUserFromIdentifier = buildGetUserFromIdentifier(props);
    const cookieName = typeof props.cookieName === "string"
      ? sql.lit(props.cookieName)
      : (props.cookieName ?? sql.lit`y-t`);
    const userFilter = getUserFilter(props);
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
      >
        {wrappedChildren}
      </Authorize>
    );
  }

  const userFilter = getUserFilter(props);
  const cookieName = typeof props.cookieName === "string"
    ? sql.lit(props.cookieName)
    : (props.cookieName ?? sql.lit`y-t`);
  addCtx(new Context(userFilter, cookieName, props.cookieExpiration));
  const wrappedChildren = props.idleTimeout
    ? (
      <IdleTimeout config={props.idleTimeout} cookieName={cookieName}>
        {props.children}
      </IdleTimeout>
    )
    : props.children;
  return (
    <SessionAuthorize
      cookieName={cookieName}
      userFilter={userFilter}
      sessionExpiration={props.cookieExpiration}
      unauthorized={props.unauthorized ?? <OTPLogin {...props} />}
    >
      <ImpersonationBanner
        cookieName={cookieName}
        sessionExpiration={props.cookieExpiration}
      />
      {wrappedChildren}
    </SessionAuthorize>
  );
}

function getUserFilter(props: Omit<OTPAuthProps, "children">) {
  const sysUserTable = system.db.tables.sys_users;
  if (!sysUserTable) {
    throw new Error(
      "Please add a sys_users table to your system before using OTPAuth",
    );
  }
  let userFilter: Sql | boolean = true;
  if (sysUserTable.fields.disabled) {
    userFilter = sql`coalesce(disabled, false) = false`;
  }
  if (props.validateUser) {
    userFilter = sql.and(userFilter, props.validateUser);
  }
  if (props.requiredPermission) {
    userFilter = sql.and(
      userFilter,
      userHasPermission(sql.lit(props.requiredPermission), sql`sys_users.id`),
    );
  }
  return userFilter;
}

/**
 * Convenience wrapper around {@link OTPAuth} preconfigured for email-only OTP
 * login keyed on the user's `email`. Use when you just want the standard
 * emailed-code sign-in with no SMS channel or custom identifier wiring.
 *
 * @category Page Component
 */
export const defaultEmailOtpAuth = (props: DefaultAuthComponentProps) => {
  return (
    <OTPAuth
      identifier="email"
      channels={{
        email: {},
      }}
      {...props}
    />
  );
};

function SessionAuthorize(props: {
  cookieName: Sql;
  userFilter?: Sql | boolean;
  sessionExpiration?: Sql;
  children: Node;
  unauthorized?: Node;
}) {
  const userFilter = props.userFilter ?? true;
  const app = useApp();
  const domains = [app.domain, ...app.domainAliases];
  return (
    <Authorize
      procedure={(s) => {
        s.getCookie(props.cookieName, "token_id_cookie");
        s.defScalar("token_id", sql`try_cast(token_id_cookie.value as uuid)`);
        s.returnUnless(sql`token_id is not null`, false);
        if (app.domainAliases.length === 0) {
          s.defScalar(
            "resolved_session_user_id",
            sql`fn.auth_resolve_session_user(
              token_id,
              ${authSessionDurationSeconds(props.sessionExpiration)},
              ${sql.lit(app.domain)}
            )`,
          );
          s.returnUnless(sql`resolved_session_user_id is not null`, false);
          if (props.userFilter !== true) {
            s.returnUnless(
              sql`(select ${userFilter} from sys_users where id = resolved_session_user_id)`,
              false,
            );
          }
          s.setCurrentUser(sql`resolved_session_user_id`);
          s.return(true);
          return;
        }
        s.defScalar(
          "user_id",
          authSessionUserExpr(sql`token_id`, props.sessionExpiration),
        );
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
          if (props.userFilter !== true) {
            s.returnUnless(
              sql`(select ${userFilter} from sys_users where id = impersonated_user_id)`,
              false,
            );
          }
          s.setCurrentUser(sql`impersonated_user_id`);
          s.return(true);
        });
        s.returnUnless(sql`user_id is not null`, false);
        if (props.userFilter !== true) {
          s.returnUnless(
            sql`(select ${userFilter} from sys_users where id = user_id)`,
            false,
          );
        }
        s.setCurrentUser(sql`user_id`);
        s.return(true);
      }}
      unauthorized={props.unauthorized}
    >
      {props.children}
    </Authorize>
  );
}
