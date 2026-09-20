import { sql } from "std/sql_utils";
import type { EndpointStatements } from "std/statements";

/** Called after cookie parsing; only verified claims may establish a transfer identity. */
export function applySignedTransferIdentity(s: EndpointStatements) {
  s.defScalar(
    "signed_transfer_claims",
    sql`http.verify_signed_request(http.request_info()->>'method', http.request_info()->>'url')`,
  );
  s.if(sql`signed_transfer_claims is not null`, (s) => {
    s.setScalar(
      "auth_user_id",
      sql`(select id from db.sys_users
      where id = try_cast(signed_transfer_claims->>'_user' as bigint) and not disabled)`,
    );
    s.if(sql`auth_user_id is null`, (s) => {
      s.setHttpStatus(403);
      s.return(sql.lit`Transfer access is unavailable`);
    });
    s.setCurrentUser(sql`auth_user_id`);
    s.setHeader("cache-control", sql.lit`private, no-store`);
    s.setHeader("content-disposition", sql.lit`attachment`);
    s.setHeader("x-content-type-options", sql.lit`nosniff`);
  });
}
