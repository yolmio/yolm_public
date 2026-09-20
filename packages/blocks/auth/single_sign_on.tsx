import { AuthApiICtxKey, LogoutCleanupRegistry, LogoutICtxKey } from "std/ictx";
import type { AuthApiICtx, LogoutICtx } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  UiServerStatements,
} from "std/statements";
import { AccessActorICtxKey } from "./access_policy";
import { system } from "std/system";
import type { Table } from "std/system";
import { addCtx, Authorize, useApp } from "std/ui";
import type { ContextInstance, Node } from "std/ui";
import type { Sql } from "std/sql_utils";

import { userHasPermission } from "./index";
import {
  authSessionUserExpr,
  decodeSamlResponse,
  extractSamlAttribute,
} from "./shared";
import { IdleTimeout } from "./idle_timeout";
import type { IdleTimeoutConfig } from "./idle_timeout";

interface SingleSignOnProps {
  validateUser?: BooleanExpr;
  requiredPermission?: string;
  children: Node;
  redirectUrl: string;
  cookieName?: string;
  fieldMapping: string[];
  createUser: (s: EndpointStatements, props: {
    userDetails: Sql;
  }) => void;
  getUser?: (props: {
    userDetails: Sql;
  }) => Sql;
  logoutUrl?: string;
  cookieExpires?: Sql;
  samlAssertionUrl: string;
  idleTimeout?: IdleTimeoutConfig;
}

function SSOLoginPage(props: SingleSignOnProps) {
  const domain = useApp().domain;

  configureSAMLApi({
    domain,
    fieldMapping: props.fieldMapping,
    createUser: props.createUser,
    getUser: props.getUser,
    cookieName: props.cookieName,
    cookieExpires: props.cookieExpires,
    samlAssertionUrl: props.samlAssertionUrl,
  });
  return (
    <div
      onMount={(s) => {
        s.window.open(sql.lit(props.redirectUrl), sql.lit("_self"));
      }}
    />
  );
}

class Context implements ContextInstance, LogoutICtx, AuthApiICtx {
  implementICtxs = [LogoutICtxKey, AuthApiICtxKey, AccessActorICtxKey];
  private readonly logoutCleanups = new LogoutCleanupRegistry();
  registerLogoutCleanup = this.logoutCleanups.register;
  runLogoutCleanups = this.logoutCleanups.run;

  constructor(
    private userFilter: BooleanExpr,
    private logoutUrl?: string,
    private cookieName?: string,
    private sessionExpiration?: Sql,
  ) {}

  assertOriginalActor = (s: UiServerStatements) => {
    s.getCookie(
      sql.lit(this.cookieName ?? getDefaultCookieName()),
      "access_actor_cookie",
    );
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
    if (this.logoutUrl) {
      s.window.open(sql.lit(this.logoutUrl), sql.lit("_self"));
    }
    s.tryServer({
      body: (s) => {
        s.getCookie(
          sql.lit(this.cookieName ?? getDefaultCookieName()),
          "token_id_cookie",
        );
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
    s.getCookie(
      sql.lit(this.cookieName ?? getDefaultCookieName()),
      "token_id_cookie",
    );
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

interface SAMLApiProps {
  domain: string;
  fieldMapping: string[];
  createUser: (s: EndpointStatements, props: {
    userDetails: Sql;
  }) => void;
  getUser?: (props: {
    userDetails: Sql;
  }) => Sql;
  cookieName?: string;
  cookieExpires?: Sql;
  samlAssertionUrl: string;
}

function getDefaultCookieName(): string {
  return "y-t";
}

function getDefaultCookieExpires(): Sql {
  return sql`date.add(year, 1, now())`;
}

function createAuthToken(
  s: EndpointStatements,
  userId: Sql,
  cookieName: string,
) {
  s.getHeader(sql.lit`Host`, "request_host");
  s.defScalar("token_id", sql`random.uuid()`);
  s.modify(
    sql`insert into auth_session_tokens (sys_user_id, issued, public_id, type) values (${userId}, now(), token_id, 'single_sign_on')`,
  );
  s.setCookie(
    sql.lit(cookieName),
    sql`token_id`,
    {
      path: sql.lit`/`,
      expires: getDefaultCookieExpires(),
      secure:
        sql`case when request_host like 'localhost%' or request_host like '%.localhost%' then null else true end`,
      httpOnly: true,
      sameSite: sql.lit`Lax`,
    },
  );
}

function processSAMLResponse(
  s: EndpointStatements,
  fieldMapping: string[],
): void {
  // Decode the SAML response from the form body to XML
  decodeSamlResponse(s, "body", "saml_response_xml");

  // Define user details record structure
  s.defRecord("user_details", {
    fields: fieldMapping.map((field) => ({
      name: field,
      type: "String",
    })),
  });

  // Extract and validate SAML attributes
  fieldMapping.forEach((field) => {
    extractSamlAttribute(s, sql`saml_response_xml`, field, field);
    s.throwErrorIf(
      sql`${sql(field)} = ''`,
      sql.lit`${field} saml_attribute_missing`,
    );
  });

  // Store user details
  s.modify(
    sql.insertValues(
      "user_details",
      fieldMapping,
      fieldMapping.map((field) => sql(field)),
    ),
  );
  s.debugExpr(sql`user_details.email`);
}

function configureSAMLApi(props: SAMLApiProps) {
  system.api({ prefix: "/api", domain: props.domain }).post(
    props.samlAssertionUrl,
    {
      textBodyScalar: "body",
      procedure: (s) => {
        // Process SAML response and extract user details
        processSAMLResponse(s, props.fieldMapping);
        const user = props.getUser?.({ userDetails: sql`user_details` });
        s.defScalar("user_id", sql`coalesce(${user}, null)`);
        s.conditional({
          condition: sql`user_id is null`,
          then: (s) => {
            s.startTransaction();
            props.createUser(s, { userDetails: sql`user_details` });
            createAuthToken(
              s,
              sql`last_record_id(db.sys_users)`,
              props.cookieName ?? getDefaultCookieName(),
            );
            s.commitTransaction();
          },
          else: (s) => {
            s.startTransaction();
            createAuthToken(
              s,
              sql`user_id`,
              props.cookieName ?? getDefaultCookieName(),
            );
            s.commitTransaction();
          },
        });
        // Redirect to home page after successful authentication
        s.setHeader(sql.lit`Location`, sql.lit`/`);
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    },
  );
}

/**
 * Provides SAML-based Single Sign-On (SSO) authentication functionality.
 *
 * This component enables users to authenticate using external identity providers via SAML.
 * It handles the complete SSO flow including:
 * - SAML response processing and validation
 * - User creation or linking based on SAML attributes
 * - Session token generation and management
 * - Cookie-based authentication persistence
 * - Optional permission-based access control
 *
 * @param props.redirectUrl The URL to redirect users to for SSO authentication
 * @param props.samlAssertionUrl The endpoint path that receives SAML assertions
 * @param props.fieldMapping Array of SAML attribute names to extract (e.g., ["email", "firstName", "lastName"])
 * @param props.createUser Function to create a new user from SAML attributes
 * @param props.getUser Optional function to retrieve existing user ID based on SAML attributes
 * @param props.validateUser Optional SQL expression to validate user access
 * @param props.requiredPermission Optional permission required for access
 * @param props.cookieName Optional custom cookie name (defaults to 'y-t')
 * @param props.cookieExpires Optional server-side session expiration SQL expression (defaults to 1 year)
 * @param props.logoutUrl Optional URL to redirect to on logout
 * @param props.children The protected content to render after successful authentication
 *
 * @category Authentication Component
 *
 * @example
 * [Example](../../../examples/auth/apps/okta-test.yolmstaging.net.tsx)
 */
export function SingleSignOn(props: SingleSignOnProps) {
  const sysUserTable = system.db.tables.sys_users;
  if (!sysUserTable) {
    throw new Error(
      "Please add a sys_users table to your system before using usernamePasswordAuth",
    );
  }
  const userFilter = getUserFilter(
    sysUserTable,
    props.validateUser,
    props.requiredPermission,
  );
  const cookieName = sql.lit(props.cookieName ?? getDefaultCookieName());
  addCtx(
    new Context(
      userFilter,
      props.logoutUrl,
      props.cookieName,
      props.cookieExpires,
    ),
  );
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
          authSessionUserExpr(sql`token_id`, props.cookieExpires),
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
      unauthorized={<SSOLoginPage {...props} />}
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
