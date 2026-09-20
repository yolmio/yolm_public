import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { Match, Show, Switch } from "std/ui";
import { Data } from "std/data";
import { Button } from "../../components/button";
import { Typography } from "../../components/typography";
import { IconButton } from "components/icon_button";
import type { DomStatements, UiServerStatements } from "std/statements";
import {
  OneTimePasswordInput,
  otpDigits,
} from "components/one_time_password_input";
import { Alert } from "components/alert";
import { YolmLogo } from "./otp_auth";
import type { Logo } from "./otp_auth";
import { getCapabilities } from "std/yolm_gen_api";
import type {
  AppSecondFactorConfig,
  AppSecondFactorMethod,
  TOTPConfig,
} from "./index";

// Interfaces for component props
interface IFirstStepProps {
  onNext: (s: DomStatements) => void;
}

interface IThirdStepProps {
  onVerify: (s: DomStatements, code: Sql) => void;
}

interface IOtpGenerationOptions {
  otpType: "email" | "sms";
  loadingScalar: string;
  errorScalar: string;
  onStartTransaction?: (s: UiServerStatements) => void;
  finally?: (s: DomStatements) => void;
}

interface ISecondFactorOtpProps {
  logo?: Logo;
  method: AppSecondFactorMethod;
  otpGeneration: (s: DomStatements, opts: IOtpGenerationOptions) => void;
  generateCookie: (s: UiServerStatements) => void;
}

interface ISecondFactorTotpProps {
  totpConfig: TOTPConfig;
  accountName: Sql;
  generateCookie: (s: UiServerStatements) => void;
  logo?: Logo;
}

interface ITwoFactorVerifyProps {
  secondFactor: AppSecondFactorConfig;
  generateCookie: (s: UiServerStatements) => void;
  logo?: Logo;
  otpGeneration: (s: DomStatements, opts: IOtpGenerationOptions) => void;
  totpConfig?: TOTPConfig;
  accountName?: Sql;
}

const FirstStep = (props: IFirstStepProps) => {
  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-6">
        <Typography level="h3" className="font-semibold text-gray-900">
          Enable an authenticator app
        </Typography>
      </div>

      <Typography level="body-sm" className="text-gray-500 mb-8">
        Two-factor authentication (2FA)
      </Typography>

      <div className="space-y-6">
        <div>
          <Typography level="h4" className="font-semibold text-gray-900 mb-4">
            Download and install an authenticator app
          </Typography>

          <div className="space-y-3">
            <Typography level="body-md" className="text-gray-600">
              If you already have an authenticator app, click next.
            </Typography>
            <Typography level="body-md" className="text-gray-600">
              If not, download an authenticator app like Google Authenticator,
              Authy, Dashlane or Microsoft Authenticator and follow the setup
              instructions.
            </Typography>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-12">
        <div className="text-gray-500">
          <Typography level="body-sm">Step: {sql`setup_step`} of 3</Typography>
          <Typography level="body-sm">
            Next: link an authenticator app
          </Typography>
        </div>

        <Button
          size="md"
          className="px-8"
          onClick={(s) => {
            props.onNext(s);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
};
const SecondStep = () => {
  // QR code SVG and base32 secret are pre-computed on the server and stored in UI state
  // (totp_qr_svg and totp_secret_base32 are set by generateTotpSecret)

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("show_manual_entry", false);
      }}
    >
      <div className="relative">
        <div className="flex items-center justify-between mb-6">
          <IconButton
            icon="ArrowBack"
            variant="plain"
            color="neutral"
            onClick={(s) => {
              s.setScalar("setup_step", sql`setup_step - 1`);
            }}
          />

          <Typography
            level="h3"
            className="font-semibold text-gray-900 flex-1 text-center"
          >
            Link your authenticator app
          </Typography>
        </div>

        <Typography level="body-sm" className="text-gray-500 mb-8 text-center">
          Two-factor authentication (2FA)
        </Typography>

        <div className="space-y-6">
          <Show when={sql`not show_manual_entry`}>
            <Typography level="body-md" className="text-gray-900 text-center">
              Scan the QR code using your authenticator app<br />
              to link it to your account
            </Typography>

            <div className="flex justify-center my-8">
              <div
                className="w-56 h-56 bg-white rounded-lg flex items-center justify-center border-2 border-gray-300 p-2"
                dangerouslySetInnerHTML={sql`totp_qr_svg`}
              />
            </div>

            <div className="text-center">
              <Button
                variant="plain"
                color="primary"
                className="text-sm"
                onClick={(s) => {
                  s.setScalar("show_manual_entry", true);
                }}
              >
                Can't scan the QR Code?
              </Button>
            </div>
          </Show>

          <Show when={sql`show_manual_entry`}>
            <Typography level="body-md" className="text-gray-900 text-center">
              Enter this secret key manually in your authenticator app:
            </Typography>

            <div className="flex justify-center my-8">
              <div className="bg-gray-100 rounded-lg p-4 border border-gray-300">
                <Typography
                  level="body-md"
                  className="font-mono text-center break-all select-all"
                >
                  {sql`totp_secret_base32`}
                </Typography>
              </div>
            </div>

            <div className="text-center">
              <Button
                variant="plain"
                color="primary"
                className="text-sm"
                onClick={(s) => {
                  s.setScalar("show_manual_entry", false);
                }}
              >
                Show QR Code instead
              </Button>
            </div>
          </Show>
        </div>

        <div className="flex items-center justify-between mt-12">
          <div className="text-gray-500">
            <Typography level="body-sm">Step: 2 of 3</Typography>
            <Typography level="body-sm">
              Next: verify your authenticator
            </Typography>
          </div>

          <Button
            size="md"
            className="px-8"
            onClick={(s) => {
              s.setScalar("setup_step", sql`setup_step + 1`);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </Data>
  );
};
const ThirdStep = (props: IThirdStepProps) => {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("verification_error", {
          type: "String",
        });
        otpDigits(s, "totp_digits", 6);
      }}
    >
      <div className="relative">
        <div className="flex items-center justify-between mb-6">
          <IconButton
            icon="ArrowBack"
            variant="plain"
            color="neutral"
            onClick={(s) => {
              s.setScalar("setup_step", sql`setup_step - 1`);
            }}
          />

          <Typography
            level="h3"
            className="font-semibold text-gray-900 flex-1 text-center"
          >
            Verify your authenticator
          </Typography>
        </div>

        <div className="text-center mb-8">
          <Typography level="body-md" className="text-gray-500">
            Enter the 6-digit code from your authenticator app to complete setup
          </Typography>
        </div>

        <div className="space-y-6">
          <div className="w-full flex flex-row justify-center gap-4 pt-4">
            <OneTimePasswordInput
              size="lg"
              digits={6}
              digitsRecord="totp_digits"
              error={sql`verification_error is not null`}
              focusFirstImmediately
              onComplete={(s, code) => {
                props.onVerify(s, code);
              }}
            />
          </div>

          <Show when={sql`verification_error is not null`}>
            <Alert color="danger" className="mt-4">
              {sql`verification_error`}
            </Alert>
          </Show>

          <Typography level="body-sm" className="text-gray-500 text-center">
            Open your authenticator app to find the code
          </Typography>
        </div>

        <div className="flex items-center justify-between mt-12">
          <div className="text-gray-500">
            <Typography level="body-sm">Step: 3 of 3</Typography>
            <Typography level="body-sm">Last step</Typography>
          </div>
        </div>
      </div>
    </Data>
  );
};

function SecondFactorOtp(props: ISecondFactorOtpProps) {
  const { logo } = props;
  return (
    <Data
      watch={[sql`refresh_key`]}
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar("error", {
          type: "String",
        });
        otpDigits(s, "code_digits_2fa", 6);
        s.defScalar("waiting_2fa", false);
        s.defScalar(
          "enabled_second_factor",
          sql`exists(select 1 from auth_second_factor_settings where sys_user_id = ui.user_id and enabled = true)`,
        );
      }}
    >
      <Show
        when={sql`enabled_second_factor`}
        fallback={
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
              Enable {props.method} as second factor
            </Typography>
            <Button
              className="mt-4"
              loading={sql`waiting_2fa`}
              onClick={(s) => {
                props.otpGeneration(s, {
                  otpType: props.method === "email" ? "email" : "sms",
                  loadingScalar: "waiting_2fa",
                  errorScalar: "error",
                  onStartTransaction: (s) => {
                    s.modify(
                      sql`insert into auth_second_factor_settings (sys_user_id, method, enabled) values (ui.user_id, ${
                        sql.lit(props.method)
                      }, true)`,
                    );
                  },
                  finally: (s) => {
                    s.increment("refresh_key");
                  },
                });
              }}
            >
              Enable
            </Button>
            <Show when={sql`error is not null`}>
              <Alert color="danger" className="mt-4">{sql`error`}</Alert>
            </Show>
          </>
        }
      >
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
          Second Factor Authentication
        </Typography>
        <Typography
          level="body-md"
          className="text-center mt-2 mb-6 text-[#555]"
        >
          We have sent a 6-digit code via{" "}
          {props.method}. Please enter it below to complete the sign-in process.
        </Typography>
        <div className="w-full flex flex-row justify-center gap-4 pt-4">
          <OneTimePasswordInput
            size="lg"
            digits={6}
            digitsRecord="code_digits_2fa"
            error={sql`error is not null`}
            focusFirstImmediately
            onComplete={(s, code) => {
              const devBypassCode = getCapabilities()?.blocks?.AuthBlock
                ?.devBypassCode;
              s.tryServer({
                body: (s) => {
                  if (devBypassCode) {
                    s.if(sql`${code} != '111111'`, (s) => {
                      s.setScalar("error", sql.lit`Invalid code`);
                      s.return();
                    });
                  } else {
                    s.if(
                      sql`not exists (select 1 from auth_second_factor_otp_registrations
                          where sys_user_id = ui.user_id and
                          hash = crypto.hmac_sha256(${code}, salt) and
                          abs(date.diff(minute, now(), registration_time)) <= 10)`,
                      (s) => {
                        s.setScalar("error", sql.lit`Unknown code`);
                        s.return();
                      },
                    );
                  }
                  props.generateCookie(s);
                },
                errorName: "service_error",
                catch: (s) => {
                  s.setScalar(
                    "error",
                    sql.concat("Error: ", sql`service_error.message`),
                  );
                  s.return();
                },
              });
            }}
          />
        </div>
        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mt-4">{sql`error`}</Alert>
        </Show>
      </Show>
    </Data>
  );
}

function SecondFactorTotp(props: ISecondFactorTotpProps) {
  const { totpConfig, accountName, generateCookie, logo } = props;

  // Handler for generating TOTP secret
  function generateTotpSecret(s: DomStatements) {
    s.setScalar("totp_setup_error", sql.null);
    s.tryServer({
      body: (s) => {
        // Generate a new TOTP secret
        s.defScalar("new_secret", sql`totp.generate_secret()`);

        s.startTransaction();
        // Insert or update the TOTP secret (handles both new and existing records)
        s.modify(
          sql`insert into auth_second_factor_totp (sys_user_id, secret, verified)
              values (ui.user_id, new_secret, false)
              on conflict (sys_user_id) do update set secret = new_secret, verified = false`,
        );
        s.commitTransaction();

        // Generate QR code and base32 secret on server (crypto functions are server-only)
        s.defScalar(
          "totp_uri",
          sql`totp.uri(new_secret, ${accountName}, ${
            sql.lit(totpConfig.issuerName)
          })`,
        );
        s.defScalar("qr_svg", sql`qr.svg(totp_uri)`);
        s.defScalar("secret_base32", sql`base32.encode(new_secret)`);

        // Set the values in UI state
        s.setScalar("totp_qr_svg", sql`qr_svg`);
        s.setScalar("totp_secret_base32", sql`secret_base32`);
        s.setScalar("setup_step", sql`2`);
      },
      errorName: "totp_error",
      catch: (s) => {
        s.setScalar(
          "totp_setup_error",
          sql.concat(
            "Failed to generate TOTP secret: ",
            sql`coalesce(totp_error.message, totp_error.type::string)`,
          ),
        );
      },
    });
  }

  // Handler for verifying TOTP code
  function verifyTotpCode(s: DomStatements, code: Sql) {
    s.setScalar("verification_error", sql.null);
    s.commitUiTreeChanges();

    s.tryServer({
      body: (s) => {
        // Get the stored secret for this user
        s.defScalar(
          "stored_secret",
          sql`(select secret from auth_second_factor_totp where sys_user_id = ui.user_id and verified = false)`,
        );

        s.if(sql`stored_secret is null`, (s) => {
          s.setScalar(
            "verification_error",
            sql.lit`No pending TOTP setup found. Please start over.`,
          );
          s.return();
        });

        // Verify the TOTP code with a window of 1 (allows for slight time drift)
        s.defScalar("is_valid", sql`totp.verify(stored_secret, ${code}, 1)`);

        s.if(sql`not is_valid`, (s) => {
          s.setScalar(
            "verification_error",
            sql.lit`Invalid code. Please try again.`,
          );
          s.return();
        });

        // Mark TOTP as verified and enable 2FA
        s.startTransaction();
        s.modify(
          sql`update auth_second_factor_totp set verified = true where sys_user_id = ui.user_id`,
        );

        // Update or insert 2FA settings
        s.modify(
          sql`insert into auth_second_factor_settings (sys_user_id, method, enabled)
              values (ui.user_id, 'totp', true)
              on conflict (sys_user_id) do update set method = 'totp', enabled = true`,
        );
        s.commitTransaction();

        // Generate session cookie
        generateCookie(s);
      },
      errorName: "verify_error",
      catch: (s) => {
        s.setScalar(
          "verification_error",
          sql.concat(
            "Verification failed: ",
            sql`coalesce(verify_error.message, verify_error.type::string)`,
          ),
        );
      },
    });
  }

  return (
    <Data
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar("setup_step", sql`1`);
        // Check if user already has TOTP enabled
        s.defScalar(
          "totp_already_enabled",
          sql`exists(select 1 from auth_second_factor_totp where sys_user_id = ui.user_id and verified = true)`,
        );
        s.defScalar("totp_setup_error", {
          type: "String",
        });
        // QR code SVG and base32 secret - generated on server
        s.defScalar("totp_qr_svg", {
          type: "String",
        });
        s.defScalar("totp_secret_base32", {
          type: "String",
        });
      }}
    >
      {/* If TOTP is already enabled, show verification UI */}
      <Show
        when={sql`totp_already_enabled`}
        fallback={
          // Show setup wizard for new TOTP enrollment


            <div className="w-full max-w-md">
              {logo
                ? (
                  <div className="flex justify-center mb-4">
                    <img
                      src={logo.src}
                      alt={logo.alt}
                      sx={logo.sx ?? { maxWidth: 100 }}
                    />
                  </div>
                )
                : <YolmLogo />}

              <Show when={sql`totp_setup_error is not null`}>
                <Alert color="danger" className="mb-4">
                  {sql`totp_setup_error`}
                </Alert>
              </Show>

              <Switch>
                <Match when={sql`setup_step = 1`}>
                  <FirstStep onNext={generateTotpSecret} />
                </Match>
                <Match when={sql`setup_step = 2`}>
                  <SecondStep />
                </Match>
                <Match when={sql`setup_step = 3`}>
                  <ThirdStep onVerify={verifyTotpCode} />
                </Match>
              </Switch>
            </div>

        }
      >
        {/* Existing TOTP - show verification UI */}
        <TotpVerificationUI
          logo={logo}
          generateCookie={generateCookie}
        />
      </Show>
    </Data>
  );
}

// Component for verifying TOTP when it's already set up
function TotpVerificationUI(
  props: { logo?: Logo; generateCookie: (s: UiServerStatements) => void },
) {
  const { logo, generateCookie } = props;

  function verifyExistingTotp(s: DomStatements, code: Sql) {
    s.setScalar("totp_verify_error", sql.null);
    s.commitUiTreeChanges();

    s.tryServer({
      body: (s) => {
        // Get the verified secret for this user
        s.defScalar(
          "stored_secret",
          sql`(select secret from auth_second_factor_totp where sys_user_id = ui.user_id and verified = true)`,
        );

        s.if(sql`stored_secret is null`, (s) => {
          s.setScalar(
            "totp_verify_error",
            sql.lit`TOTP not configured. Please contact support.`,
          );
          s.return();
        });

        // Verify the TOTP code
        s.defScalar("is_valid", sql`totp.verify(stored_secret, ${code}, 1)`);

        s.if(sql`not is_valid`, (s) => {
          s.setScalar(
            "totp_verify_error",
            sql.lit`Invalid code. Please try again.`,
          );
          s.return();
        });

        // Generate session cookie
        generateCookie(s);
      },
      errorName: "verify_error",
      catch: (s) => {
        s.setScalar(
          "totp_verify_error",
          sql.concat(
            "Verification failed: ",
            sql`coalesce(verify_error.message, verify_error.type::string)`,
          ),
        );
      },
    });
  }

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("totp_verify_error", {
          type: "String",
        });
        otpDigits(s, "totp_verify_digits", 6);
      }}
    >
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
        Two-Factor Authentication
      </Typography>
      <Typography
        level="body-md"
        className="text-center mt-2 mb-6 text-[#555]"
      >
        Enter the 6-digit code from your authenticator app
      </Typography>
      <div className="w-full flex flex-row justify-center gap-4 pt-4">
        <OneTimePasswordInput
          size="lg"
          digits={6}
          digitsRecord="totp_verify_digits"
          error={sql`totp_verify_error is not null`}
          focusFirstImmediately
          onComplete={(s, code) => verifyExistingTotp(s, code)}
        />
      </div>
      <Show when={sql`totp_verify_error is not null`}>
        <Alert color="danger" className="mt-4">
          {sql`totp_verify_error`}
        </Alert>
      </Show>
    </Data>
  );
}

export const TwoFactorVerify = (props: ITwoFactorVerifyProps) => {
  const required = props.secondFactor.required ?? false;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", {
          type: "Int",
          expr: sql`1`,
          allowNoRead: true,
        });
        if (!required) {
          s.defScalar("skip_2fa", false);
          s.defScalar("error", {
            type: "String",
          });
        }
      }}
    >
      {props.secondFactor.method === "totp" && props.totpConfig && (
        <SecondFactorTotp
          totpConfig={props.totpConfig}
          accountName={props.accountName ?? sql`ui.identifier`}
          generateCookie={props.generateCookie}
          logo={props.logo}
        />
      )}
      {(props.secondFactor.method === "sms" ||
        props.secondFactor.method === "email") && (
        <SecondFactorOtp
          logo={props.logo}
          method={props.secondFactor.method}
          otpGeneration={props.otpGeneration}
          generateCookie={props.generateCookie}
        />
      )}
      {!required && (
        <Button
          variant="outlined"
          color="neutral"
          className="mt-4"
          loading={sql`skip_2fa`}
          onClick={(s) => {
            s.setScalar("skip_2fa", true);
            s.commitUiTreeChanges();
            s.tryServer({
              body: (s) => {
                props.generateCookie(s);
              },
              catch: (s) => {
                s.setScalar("error", sql.lit`Failed to generate cookie`);
              },
            });
            s.setScalar("skip_2fa", false);
          }}
        >
          Skip for now
        </Button>
      )}
      <Show when={sql`error is not null`}>
        <Alert color="danger" className="mt-4">
          {sql`error`}
        </Alert>
      </Show>
    </Data>
  );
};
