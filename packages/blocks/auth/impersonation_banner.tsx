import { ActionButton } from "std/action_button";
import { InlineRecordDisplay } from "components/inline_record_display";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import { Show, useApp } from "std/ui";
import { AuthBlock } from "./index";
import { authSessionUserExpr } from "./shared";

/** The session cookie, never client state, identifies whose impersonation can end. */
export function ImpersonationBanner(
  props: { cookieName: Sql; sessionExpiration?: Sql },
) {
  if (!system.block(AuthBlock).opts.accessPolicy) return null;
  useApp().addGlobalStyle({
    // Reserve the footer in the shared app root, independently of page layout.
    "#yolm-app-container:has([data-impersonation-banner])": {
      height: "calc(100dvh - 40px)",
      overflow: "auto",
      // Viewport-height pages must remain scrollable instead of being clipped
      // by flex shrinking their outer shell.
      "& > *": { flexShrink: 0 },
    },
  });
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
          data-impersonation-banner="true"
          className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-between gap-2 bg-warning-100 text-warning-900 px-3 text-sm"
          sx={{ height: 40, boxSizing: "border-box" }}
        >
          <span className="min-w-0 truncate">
            Impersonating{" "}
            {users.inlineRecordDisplay || users.recordDisplayName ||
                users.fields.email
              ? (
                <InlineRecordDisplay
                  tableName="sys_users"
                  id={sql`impersonation_target`}
                />
              )
              : sql`'User #' || impersonation_target`}
            <span className="hidden sm:inline">
              . Changes affect their account.
            </span>
          </span>
          <ActionButton
            color="warning"
            size="sm"
            variant="outlined"
            sx={{ flexShrink: 0 }}
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
