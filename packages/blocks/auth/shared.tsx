import { Alert } from "../../components/alert";
import { Button } from "../../components/button";
import { FormControl } from "../../components/form_control";
import { FormLabel } from "../../components/form_label";
import { Input } from "../../components/input";
import { Typography } from "../../components/typography";
import { Show } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type {
  CookieOptions,
  DomStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";

export function authCookieOpts(opts: {
  cookieDomain?: Sql | string;
}): CookieOptions {
  return {
    path: sql.lit`/`,
    expires: sql`date.add(year, 1, now())`,
    domain: typeof opts.cookieDomain === "string"
      ? sql`case when location.host like 'localhost%' or location.host like '%.localhost%' then null else ${
        sql.lit(opts.cookieDomain)
      } end`
      : opts.cookieDomain
      ? sql`case when location.host like 'localhost%' or location.host like '%.localhost%' then null else ${opts.cookieDomain} end`
      : undefined,
    secure:
      sql`case when location.host like 'localhost%' or location.host like '%.localhost%' then null else true end`,
    httpOnly: true,
    sameSite: sql.lit`Lax`,
  };
}

export function authSessionDurationSeconds(expiration?: Sql): Sql {
  return expiration
    ? sql`cast(greatest(0, date.diff(second, now(), ${expiration})) as int)`
    : sql`31536000`;
}

export function authSessionUserExpr(tokenId: Sql, expiration?: Sql): Sql {
  const appSessionDuration = authSessionDurationSeconds(expiration);
  return sql`(
    select sys_user_id
    from auth_session_tokens
    where public_id = ${tokenId}
      and now() < date.add(second, ${appSessionDuration}, issued)
  )`;
}

export function otpEmailTemplate(props: {
  applicationName: string;
  code: Sql;
}) {
  return sql.concat(
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    // Meta tags for better OTP recognition
    `<meta name="x-apple-disable-message-reformatting">`,
    `<meta name="format-detection" content="telephone=no">`,
    // Prevents email clients from formatting numbers as phone numbers
    `<meta property="og:title" content="${props.applicationName} Verification Code">`,
    `<meta property="og:type" content="one-time-code">`,
    "</head>",
    "<body>",
    `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">`,
    `<p style="font-size: 16px; color: #333;">Your ${props.applicationName} access code is:</p>`,
    // Main code display with semantic markup
    `<div role="contentinfo" aria-label="verification code">`,
    `<span style="`,
    "display: inline-block;",
    "font-family: monospace;",
    "font-size: 32px;",
    "font-weight: bold;",
    "letter-spacing: 4px;",
    "padding: 16px;",
    "margin: 16px 0;",
    "background-color: #f5f5f5;",
    "border-radius: 8px;",
    "color: #000;",
    `">`,
    props.code,
    "</span>",
    "</div>",
    // Add expiry info if applicable
    `<p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>`,
    // Additional security notice
    `<p style="color: #666; font-size: 14px;">If you didn't request this code, please ignore this email.</p>`,
    // Add branding/footer
    `<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;">`,
    `<p style="color: #999; font-size: 12px;">`,
    `This is an automated message from ${props.applicationName}.<br>`,
    "Please do not reply to this email.",
    "</p>",
    "</div>",
    "</body>",
    "</html>",
  );
}

// Helper function to extract SAML response from form body
function extractSamlResponseFromBody<T extends IServerBaseStatements>(
  s: T,
  bodyScalar: string,
  defOutputScalar = "saml_response_encoded",
) {
  // Extract SAMLResponse parameter from the form body
  s.defScalar(
    "relay_state",
    sql`regex.replace_all(${sql.ref(bodyScalar)}, '&RelayState=', '')`,
  );
  s.defScalar(
    defOutputScalar,
    sql`regex.replace_all(${sql.ref("relay_state")}, 'SAMLResponse=', '')`,
  );
}

// Helper function to URL decode the SAML response
function urlDecodeSamlResponse<T extends IServerBaseStatements>(
  s: T,
  encodedScalar: string,
  defOutputScalar = "saml_response_url_decoded",
) {
  // URL decode the SAML response (replace URL-encoded characters)
  s.defScalar(
    defOutputScalar,
    sql`
      regex.replace_all(
          regex.replace_all(
              regex.replace_all(${sql.ref(encodedScalar)}, '%2B', '+'),
              '%2F', '/'
          ),
          '%3D', '='
      )
  `,
  );
}

// Helper function to base64 decode SAML response to XML
function base64DecodeSamlResponse<T extends IServerBaseStatements>(
  s: T,
  urlDecodedScalar: string,
  defOutputScalar = "saml_response_xml",
) {
  // Base64 decode the SAML response to get the XML
  s.defScalar(
    defOutputScalar,
    sql`string.from_utf8(bytes.from_base64(${sql.ref(urlDecodedScalar)}))`,
  );
}

// Combined helper function to convert form body to SAML XML
export function decodeSamlResponse<T extends IServerBaseStatements>(
  s: T,
  bodyScalar: string,
  defOutputScalar = "saml_response_xml",
) {
  // Extract SAML response from body
  extractSamlResponseFromBody(s, bodyScalar, "saml_response_encoded");

  // URL decode
  urlDecodeSamlResponse(
    s,
    "saml_response_encoded",
    "saml_response_url_decoded",
  );

  // Base64 decode to XML
  base64DecodeSamlResponse(s, "saml_response_url_decoded", defOutputScalar);
}

// Helper function to extract SAML attribute values
export function extractSamlAttribute<T extends IServerBaseStatements>(
  s: T,
  xmlContent: Sql,
  attributeName: string,
  scalarName: string,
) {
  // First, extract the full attribute XML block
  const rawScalarName = `${scalarName}_raw`;
  s.defScalar(
    rawScalarName,
    sql`
      coalesce(
          (select value from regex.matches(${xmlContent}, 
              '<saml2:Attribute Name="' || ${
      sql.lit(attributeName)
    } || '"[^>]*>.*?<saml2:AttributeValue[^>]*>[^<]+</saml2:AttributeValue>'
          ) limit 1),
          ''
      )
  `,
  );

  // Then extract just the value from the AttributeValue tag
  s.defScalar(
    scalarName,
    sql`
      regex.replace_all(
          regex.replace_all(${
      sql.ref(rawScalarName)
    }, '.*<saml2:AttributeValue[^>]*>', ''),
          '</saml2:AttributeValue>.*', ''
      )
  `,
  );
}

/**
 * Hashes and stores a password for a user on the server.
 * Expects `new_password` scalar to be set in the UI state.
 */
export function hashAndStorePassword(
  s: UiServerStatements,
  userId: Sql,
  opts?: {
    clearLegacyPassword?: boolean;
    beforeStore?: (s: UiServerStatements) => void;
  },
) {
  const clearLegacyPassword = opts?.clearLegacyPassword
    ? sql`, legacy_password_hash = null, legacy_password_algorithm = null, legacy_password_migrated_at = current_timestamp()`
    : sql``;
  s.startTransaction();
  opts?.beforeStore?.(s);
  s.defScalar("new_salt", sql`crypto.random_bytes(32)`);
  s.defScalar(
    "new_hash",
    sql`crypto.hash_password(ui.new_password, new_salt)`,
  );
  s.modify(
    sql`update sys_users set password_hash = new_hash, password_salt = new_salt, must_change_password = false ${clearLegacyPassword} where id = ${userId}`,
  );
  s.commitTransaction();
}

/**
 * Inserts a `sys_users` row with a freshly salted and hashed password,
 * declaring the new user id into the `idScalar` scalar (default
 * `auth_new_user_id`). Composable: runs inside the caller's transaction and
 * owns the password storage format, so other blocks creating logins do not
 * have to duplicate it. Extra `sys_users` columns (e.g. a person FK added
 * via the `userTable` opt) are passed through `values`.
 */
export function insertUserWithPassword(
  s: UiServerStatements,
  opts: {
    password: Sql;
    mustChangePassword?: Sql;
    values?: Record<string, Sql>;
    idScalar?: string;
  },
) {
  const idScalar = opts.idScalar ?? "auth_new_user_id";
  const entries = Object.entries(opts.values ?? {});
  let columns = sql``;
  let values = sql``;
  for (const [column, value] of entries) {
    columns = sql`${columns}, ${sql.ref(column)}`;
    values = sql`${values}, ${value}`;
  }
  s.defScalar("auth_new_user_salt", sql`crypto.random_bytes(32)`);
  s.modify(sql`
    insert into db.sys_users
      (password_hash, password_salt, must_change_password${columns})
    values
      (crypto.hash_password(${opts.password}, auth_new_user_salt),
       auth_new_user_salt,
       ${opts.mustChangePassword ?? sql`true`}${values})
    returning id into ${sql.ref(idScalar)}
  `);
}

export interface ChangePasswordFormProps {
  title?: string;
  subtitle?: string;
  /** Called on the server after password is validated, within the transaction */
  onSave: (s: UiServerStatements) => void;
  /** Min password length, default 8 */
  minPasswordLength?: number;
  /** Additional node to show below the form */
  belowForm?: Node;
  logo?: Node;
}

/**
 * Reusable change/set password form with new password + confirm fields.
 * Sets `new_password` and `confirm_password` scalars in local Data scope.
 */
export function ChangePasswordForm(props: ChangePasswordFormProps) {
  const minLen = props.minPasswordLength ?? 8;
  function submitChangePassword(s: DomStatements) {
    s.returnIf(sql`change_pw_loading`);
    s.setScalar("change_pw_error", sql.null);
    s.if(
      sql`char_length(new_password) < ${minLen}`,
      (s) => {
        s.setScalar(
          "change_pw_error",
          sql.lit`Password must be at least ${minLen} characters`,
        );
        s.return();
      },
    );
    s.if(sql`new_password != confirm_password`, (s) => {
      s.setScalar(
        "change_pw_error",
        sql.lit`Passwords do not match`,
      );
      s.return();
    });
    s.setScalar("change_pw_loading", true);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        s.throwErrorIf(
          sql`(char_length(ui.new_password) >= ${minLen}) is not true`,
          sql.lit`Password must be at least ${minLen} characters`,
        );
        s.throwErrorIf(
          sql`(ui.new_password = ui.confirm_password) is not true`,
          sql.lit`Passwords do not match`,
        );
        props.onSave(s);
      },
      errorName: "pw_error",
      catch: (s) => {
        s.setScalar(
          "change_pw_error",
          sql.concat(
            "Error: ",
            sql`coalesce(pw_error.message, pw_error.type::string)`,
          ),
        );
      },
    });
    s.setScalar("change_pw_loading", false);
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("new_password", sql.lit``);
        s.defScalar("confirm_password", sql.lit``);
        s.defScalar("change_pw_error", { type: "String" });
        s.defScalar("change_pw_loading", false);
      }}
    >
      {props.logo}
      <Typography level="h3">
        {props.title ?? "Set your password"}
      </Typography>
      {props.subtitle && (
        <Typography level="body-md" className="text-center mt-2 mb-2">
          {props.subtitle}
        </Typography>
      )}
      <FormControl fullWidth className="mb-4 mt-4">
        <FormLabel htmlFor="new_password">New Password</FormLabel>
        <Input
          bindScalar="new_password"
          type="password"
          placeholder="Enter new password"
          id="new_password"
          fullWidth
          yolmFocusKey
        />
      </FormControl>
      <FormControl fullWidth className="mb-4">
        <FormLabel htmlFor="confirm_password">Confirm Password</FormLabel>
        <Input
          bindScalar="confirm_password"
          type="password"
          placeholder="Confirm new password"
          id="confirm_password"
          fullWidth
          onKeyDown={(s) => {
            s.if(sql`event.key = 'Enter'`, submitChangePassword);
          }}
        />
      </FormControl>
      <Button
        fullWidth
        loading={sql`change_pw_loading`}
        onClick={submitChangePassword}
      >
        Set Password
      </Button>
      <Show when={sql`change_pw_error is not null`}>
        <Alert color="danger" className="mt-4">{sql`change_pw_error`}</Alert>
      </Show>
      {props.belowForm}
    </Data>
  );
}

// Helper function to extract NameID
export function extractSamlNameId<T extends IServerBaseStatements>(
  s: T,
  xmlContent: Sql,
  scalarName: string,
) {
  const rawScalarName = `${scalarName}_raw`;
  s.defScalar(
    rawScalarName,
    sql`
      coalesce(
          (select value from regex.matches(${xmlContent}, '<saml2:NameID[^>]*>[^<]+</saml2:NameID>') limit 1),
          ''
      )
  `,
  );

  s.defScalar(
    scalarName,
    sql`
      regex.replace_all(
          regex.replace_all(${
      sql.ref(rawScalarName)
    }, '<saml2:NameID[^>]*>', ''),
          '</saml2:NameID>', ''
      )
  `,
  );
}
