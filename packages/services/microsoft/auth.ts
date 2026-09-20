import type { BooleanExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type { AnyRequestOpts, IServerBaseStatements } from "std/statements";
import { resolveRequestResponseBindings } from "std/statements";
import { sourceMap } from "std/utils";
import { MicrosoftAzureAD, MicrosoftAzureEventsAD } from "./azure_ad";

/**
 * Microsoft Azure AD client bundling `.calendars` and `.events` Graph
 * API helpers along with a shared {@link AzureADAuth} that handles
 * managed-OAuth token refresh.
 */
export class AzureAD {
  /** Microsoft Graph calendar REST helpers. */
  calendars: MicrosoftAzureAD;
  /** Microsoft Graph event REST helpers. */
  events: MicrosoftAzureEventsAD;
  /** Underlying auth helper. */
  auth: AzureADAuth;

  constructor() {
    this.auth = new AzureADAuth();
    this.calendars = new MicrosoftAzureAD(this.auth);
    this.events = new MicrosoftAzureEventsAD(this.auth);
  }
}

/**
 * Helper that issues authenticated requests against Microsoft Graph
 * using a Yolm-managed OAuth credential. Detects the
 * `x-yolm-oauth-reauth` response header and invokes the caller's
 * `onReauthRequired` hook so the credential can be re-consented.
 */
export class AzureADAuth {
  @sourceMap
  requestWithOauth<T extends IServerBaseStatements>(
    s: T,
    opts: {
      requestOpts: AnyRequestOpts;
      afterRequest: (s: T) => void;
      oauthOpts: Oauth2TokenOpts;
    },
  ) {
    const { requestOpts, afterRequest, oauthOpts } = opts;
    const {
      responseRecord,
      responseHeadersTable,
      defaultBindings,
    } = resolveRequestResponseBindings(requestOpts);
    const reauthCondition = sql`${
      sql.ref(responseRecord)
    }.status = 401 and exists(
          select 1 from ${sql.ref(responseHeadersTable)}
          where lower(name) = 'x-yolm-oauth-reauth'
        )`;
    oauthOpts.extensions?.beforeRequest?.(s, {
      requestOpts,
      responseRecord,
      responseHeadersTable,
    });
    s.request({
      ...requestOpts,
      optIn: oauthOpts.optIn,
      ...defaultBindings,
      serviceCredentials: {
        type: "ManagedOauth",
        credentialId: oauthOpts.managedOauthCredentialId,
      },
    });
    oauthOpts.extensions?.afterRequest?.(s, {
      requestOpts,
      responseRecord,
      responseHeadersTable,
    });
    s.if(reauthCondition, (s) => {
      oauthOpts.extensions?.onReauthRequired?.(s, {
        requestOpts,
        responseRecord,
        responseHeadersTable,
      });
      oauthOpts.onReauthRequired?.(s);
    }, (s) => {
      afterRequest(s);
    });
  }
}

/**
 * Options for requests that use a Yolm-managed Microsoft OAuth
 * credential. Pass to {@link AzureADAuth.requestWithOauth} (and to the
 * Microsoft Graph helpers that wrap it).
 */
export interface Oauth2TokenOpts {
  /** Managed OAuth credential identifier. */
  managedOauthCredentialId: Sql;
  /** Statements run when the response signals that the user must re-authorize. */
  onReauthRequired?: <T extends IServerBaseStatements>(s: T) => void;
  /** Required in preview/local-dev when external services mode is opt-in. */
  optIn?: BooleanExpr;
  /** Optional lifecycle hooks for system-specific diagnostics or logging. */
  extensions?: OauthRequestExtensions;
}

export interface OauthRequestExtensions {
  beforeRequest?: <T extends IServerBaseStatements>(
    s: T,
    ctx: OauthRequestContext,
  ) => void;
  afterRequest?: <T extends IServerBaseStatements>(
    s: T,
    ctx: OauthRequestContext,
  ) => void;
  onReauthRequired?: <T extends IServerBaseStatements>(
    s: T,
    ctx: OauthRequestContext,
  ) => void;
}

export interface OauthRequestContext {
  requestOpts: AnyRequestOpts;
  responseRecord: string;
  responseHeadersTable: string;
}
