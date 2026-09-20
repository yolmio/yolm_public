import type { BooleanExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type { AnyRequestOpts, IServerBaseStatements } from "std/statements";
import { resolveRequestResponseBindings } from "std/statements";
import { sourceMap } from "std/utils";

/**
 * Helper that issues authenticated HTTP requests against Google APIs
 * using a managed OAuth credential. Detects the
 * `x-yolm-oauth-reauth` response header and invokes the caller's
 * `onReauthRequired` hook so the credential can be marked as needing a
 * fresh consent.
 */
export class GoogleAuth {
  /**
   * Issue an HTTP request signed with the managed OAuth credential
   * referenced by `oauthOpts.managedOauthCredentialId`. On success the
   * `afterRequest` callback runs with the response; on a re-auth
   * response the `oauthOpts.onReauthRequired` callback runs instead.
   */
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
 * Options for requests that use a Yolm-managed Google OAuth credential.
 * Pass to {@link GoogleAuth.requestWithOauth} (and to the Google API
 * helpers that wrap it) so the runtime can mint a fresh access token
 * and surface re-auth signals back to the caller.
 */
export interface Oauth2TokenOpts {
  /** Managed OAuth credential identifier (typically a SQL subquery on `managed_oauth_credentials`). */
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
