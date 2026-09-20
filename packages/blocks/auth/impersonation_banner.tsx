import { ActionButton } from "std/action_button";
import { InlineRecordDisplay } from "components/inline_record_display";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import { Show } from "std/ui";
import { AuthBlock } from "./index";
import { authSessionUserExpr } from "./shared";

/** The session cookie, never client state, identifies whose impersonation can end. */
export function ImpersonationBanner(
  props: { cookieName: Sql; sessionExpiration?: Sql },
) {
  if (!system.block(AuthBlock).opts.accessPolicy) return null;
  const users = system.db.tables.sys_users;
  return (
    <Data
      procedure={(s) => {
        s.getCookie(props.cookieName, "impersonation_cookie");
        s.defScalar(
          "impersonation_owner",
          authSessionUserExpr(
            sql`try_cast(impersonation_cookie.value as uuid)`,
            props.sessionExpiration,
          ),
        );
        s.defScalar(
          "is_impersonating",
          sql`impersonation_owner is not null and impersonation_owner != current_user`,
        );
        s.defScalar("impersonation_target", sql`current_user`);
      }}
    >
      <Show when={sql`is_impersonating`}>
        <div
          role="status"
          className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-center gap-4 bg-warning-100 text-warning-900 p-3 shadow-lg"
        >
          <span>
            Impersonating{" "}
            {users.inlineRecordDisplay || users.recordDisplayName ||
                users.fields.email
              ? (
                <InlineRecordDisplay
                  tableName="sys_users"
                  id={sql`impersonation_target`}
                />
              )
              : sql`'User #' || impersonation_target`}. Changes affect their
            account.
          </span>
          <ActionButton
            color="warning"
            refetch={false}
            action={(s) => {
              s.getCookie(props.cookieName, "end_impersonation_cookie");
              s.defScalar(
                "end_impersonation_owner",
                authSessionUserExpr(
                  sql`try_cast(end_impersonation_cookie.value as uuid)`,
                  props.sessionExpiration,
                ),
              );
              s.startTransaction();
              s.modify(
                sql`update db.auth_impersonations set active = false where impersonator = end_impersonation_owner and active`,
              );
              s.commitTransaction();
            }}
            afterSuccessClient={(s) => s.location.reload()}
          >
            End impersonation
          </ActionButton>
        </div>
      </Show>
    </Data>
  );
}
