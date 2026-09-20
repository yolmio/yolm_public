import { Button } from "components/button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import { EmailPasswordAuth, EmailPasswordLogin } from "./email_password_auth";
import type { EmailPasswordAuthProps } from "./email_password_auth";
import { OTPAuth, OTPLogin } from "./otp_auth";
import type { OTPAuthProps } from "./otp_auth";

type OtpConfig = Pick<
  OTPAuthProps,
  "identifier" | "channels" | "defaultChannel" | "rateLimit" | "requestCode"
>;
type PasswordConfig = Pick<
  EmailPasswordAuthProps,
  | "identifier"
  | "email"
  | "minPasswordLength"
  | "allowForgotPassword"
  | "allowSelfSetup"
  | "rateLimit"
  | "passwordRateLimit"
>;
type LoginMethod = "otp" | "email_password";

/** Shared policy applies to every enabled login method. Signup is not supported. */
export interface MultiAuthConfig extends
  Pick<
    OTPAuthProps,
    | "applicationName"
    | "logo"
    | "sx"
    | "className"
    | "loginText"
    | "validateUser"
    | "requiredPermission"
    | "cookieName"
    | "cookieDomain"
    | "cookieExpiration"
    | "belowLoginNode"
    | "afterLoginServer"
    | "secondFactor"
    | "idleTimeout"
    | "unauthorized"
  > {
  authTypes:
    | { otp: OtpConfig; emailPassword?: PasswordConfig }
    | { otp?: OtpConfig; emailPassword: PasswordConfig };
  /** Defaults to OTP when available, otherwise email/password. */
  defaultMethod?: LoginMethod;
}

export interface MultiAuthProviderConfig extends MultiAuthConfig {
  children: Node;
}

/**
 * Existing-account login through email/SMS OTP and/or email/password.
 * Reuses the standalone login forms and their authorization, MFA and sessions.
 * OTP delivery channels are configured separately from the login method.
 */
export function MultiAuthProvider(props: MultiAuthProviderConfig) {
  const { authTypes, defaultMethod, children, ...shared } = props;
  const { otp, emailPassword } = authTypes;
  const method = defaultMethod ?? (otp ? "otp" : "email_password");
  if (!otp && !emailPassword) {
    throw new Error(
      "MultiAuthProvider requires an OTP or email/password method.",
    );
  }
  if (
    (method === "otp" && !otp) ||
    (method === "email_password" && !emailPassword)
  ) {
    throw new Error("MultiAuthProvider defaultMethod must be enabled.");
  }
  if (!otp) {
    if (!emailPassword) {
      throw new Error("Email/password configuration is required.");
    }
    return (
      <EmailPasswordAuth {...shared} {...emailPassword}>
        {children}
      </EmailPasswordAuth>
    );
  }
  if (!otp.channels.email && !otp.channels.sms) {
    throw new Error("MultiAuthProvider OTP requires an email or SMS channel.");
  }
  if (!emailPassword) {
    return <OTPAuth {...shared} {...otp}>{children}</OTPAuth>;
  }

  const otpIdentifier = typeof otp.identifier === "string"
    ? otp.identifier
    : otp.identifier.field;
  const passwordUsesEmail = typeof emailPassword.identifier === "string" ||
    emailPassword.identifier.inputType !== "text";
  function selectMethod(s: DomStatements, selected: LoginMethod) {
    s.returnIf(sql`multi_auth_method = ${sql.lit(selected)}`);
    // Each form owns its credentials/challenge state. Only a shared email is
    // retained when switching; removing the form discards its other UI state.
    s.setScalar(
      "multi_auth_identifier",
      otpIdentifier === "email" && passwordUsesEmail
        ? sql`ui.identifier`
        : sql.lit``,
    );
    s.setScalar("multi_auth_method", sql.lit(selected));
  }
  function MethodSelector(props: { selected: LoginMethod }) {
    return (
      <div className="mt-5 pt-4 border-t border-divider w-full text-center">
        <Button
          type="button"
          variant="plain"
          size="sm"
          onClick={(s) => selectMethod(s, props.selected)}
        >
          {props.selected === "otp"
            ? "Use a code instead"
            : "Use a password instead"}
        </Button>
      </div>
    );
  }

  const login = shared.unauthorized ?? (
    <Data
      local
      procedure={(s) => {
        s.defScalar("multi_auth_method", sql.lit(method));
        s.defScalar("multi_auth_identifier", sql.lit``);
      }}
    >
      <Show
        when={sql`multi_auth_method = 'otp'`}
        fallback={
          <EmailPasswordLogin
            {...shared}
            {...emailPassword}
            initialIdentifier={sql`multi_auth_identifier`}
            methodSelector={<MethodSelector selected="otp" />}
          />
        }
      >
        <OTPLogin
          {...shared}
          {...otp}
          initialIdentifier={sql`multi_auth_identifier`}
          methodSelector={<MethodSelector selected="email_password" />}
        />
      </Show>
    </Data>
  );
  // The default method also owns development auto-login/user-selector behavior,
  // including that provider's custom identifier lookup.
  return method === "email_password"
    ? (
      <EmailPasswordAuth {...shared} {...emailPassword} unauthorized={login}>
        {children}
      </EmailPasswordAuth>
    )
    : (
      <OTPAuth {...shared} {...otp} unauthorized={login}>
        {children}
      </OTPAuth>
    );
}
