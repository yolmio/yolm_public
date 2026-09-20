import { sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { AzureADAuth } from "./auth";
import type { Oauth2TokenOpts } from "./auth";

export class OutlookUserInfo {
  auth = new AzureADAuth();

  /**
    @param opts.emailScalar - Name of scalar to store the email in. Defaults to "email".
   */
  listUser<T extends IServerBaseStatements>(
    s: T,
    opts: {
      emailScalar?: string;
      azureUserIdScalar?: string;
    } & Oauth2TokenOpts,
  ) {
    if (opts.emailScalar) {
      s.defScalar(opts.emailScalar, {
        type: "String",
      });
    }
    if (opts.azureUserIdScalar) {
      s.defScalar(opts.azureUserIdScalar, {
        type: "String",
      });
    }
    this.auth.requestWithOauth(s, {
      requestOpts: {
        uri: sql.lit`https://graph.microsoft.com/v1.0/me`,
        receiveJson: "users_response",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql.concat("Failed to list azure ad user: ", sql`response.status`),
          );
        });
        if (opts.emailScalar) {
          s.setScalar(
            opts.emailScalar,
            sql`users_response ->> 'userPrincipalName'`,
          );
        }
        if (opts.azureUserIdScalar) {
          s.setScalar(opts.azureUserIdScalar, sql`users_response ->> 'id'`);
        }
      },
      oauthOpts: opts,
    });
  }
}
