import type { BooleanExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type { AnyRequestOpts, IServerBaseStatements } from "std/statements";
import { resolveRequestResponseBindings } from "std/statements";
import { ZoomMeetings } from "./meeting";

export type ZoomAuthOptions = {
  verificationSecret: Sql;
};

export class ZoomAuth {
  meetings: ZoomMeetings;
  verificationSecret: Sql;

  constructor(protected opts: ZoomAuthOptions) {
    this.meetings = new ZoomMeetings(this);
    this.verificationSecret = opts.verificationSecret;
  }

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
    s.request({
      ...requestOpts,
      optIn: oauthOpts.optIn,
      ...defaultBindings,
      serviceCredentials: {
        type: "ManagedOauth",
        credentialId: oauthOpts.managedOauthCredentialId,
      },
    });
    s.if(reauthCondition, (s) => {
      oauthOpts.onReauthRequired?.(s);
    }, (s) => {
      afterRequest(s);
    });
  }
}

export interface Oauth2TokenOpts {
  managedOauthCredentialId: Sql;
  onReauthRequired?: <T extends IServerBaseStatements>(s: T) => void;
  optIn?: BooleanExpr;
}
