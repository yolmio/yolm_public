import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { system } from "std/system";
import { Authorize, Each, Show, useTheme } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { generateWaveBackground } from "../../components/backgrounds/wave";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Typography } from "../../components/typography";
import type { IdleTimeoutConfig } from "./idle_timeout";
import { IdleTimeout } from "./idle_timeout";
import { YolmLogo } from "./otp_auth";
import type { Logo } from "./otp_auth";
import { Chip } from "../../components/chip";
import { authCookieOpts, authSessionUserExpr } from "./shared";
import { MaterialIcon } from "../../components/material_icon";

interface UserSelectorProps {
  userFilter: Sql | boolean;
  cookieName: Sql;
  sessionTokenType: Sql;
  applicationName?: string;
  logo?: Logo;
  idleTimeout?: IdleTimeoutConfig;
  children: Node;
}

export function userSelectorUserExpr(tokenId: Sql): Sql {
  return sql`coalesce(current_user, ${authSessionUserExpr(tokenId)})`;
}

/**
 * Wraps children with a user selector for preview/demo mode.
 * Instead of showing a login form, shows a list of users to select from.
 * The selected user is persisted via a cookie.
 */
export function UserSelector({
  userFilter,
  cookieName,
  sessionTokenType,
  applicationName,
  logo,
  idleTimeout,
  children,
}: UserSelectorProps) {
  const wrappedChildren = idleTimeout
    ? (
      <IdleTimeout config={idleTimeout} cookieName={cookieName}>
        {children}
      </IdleTimeout>
    )
    : children;

  return (
    <Authorize
      procedure={(s) => {
        // Check for demo user selection session cookie
        s.getCookie(cookieName, "token_id_cookie");
        s.defScalar(
          "token_id",
          sql`try_cast(token_id_cookie.value as uuid)`,
        );
        s.defScalar(
          "demo_user_id",
          userSelectorUserExpr(sql`token_id`),
        );
        s.if(sql`demo_user_id is not null`, (s) => {
          // Verify user exists and passes filter
          s.defScalar(
            "user_valid",
            sql`exists(select 1 from sys_users where id = demo_user_id${
              userFilter !== true ? sql` and ${userFilter}` : sql``
            })`,
          );
          s.if(sql`user_valid`, (s) => {
            s.setCurrentUser(sql`demo_user_id`);
            s.return(true);
          });
        });
        s.return(false);
      }}
      unauthorized={
        <UserSelectorView
          userFilter={userFilter}
          cookieName={cookieName}
          sessionTokenType={sessionTokenType}
          applicationName={applicationName}
          logo={logo}
        />
      }
    >
      {wrappedChildren}
    </Authorize>
  );
}

function UserSelectorView({
  userFilter,
  cookieName,
  sessionTokenType,
  applicationName,
  logo,
}: {
  userFilter: Sql | boolean;
  cookieName: Sql;
  sessionTokenType: Sql;
  applicationName?: string;
  logo?: Logo;
}) {
  const sysUserTable = system.db.tables.sys_users;
  if (!sysUserTable) {
    throw new Error("sys_users table not found");
  }

  const appName = applicationName ?? "Yolm";

  // Build display name expression
  let nameExpr: Sql;
  if (sysUserTable.recordDisplayName) {
    nameExpr = sysUserTable.recordDisplayName.expr(
      ...sysUserTable.recordDisplayName.fields.map(
        (f) => sql`sys_users.${sql.ref(f)}`,
      ),
    );
  } else {
    nameExpr = sql`'User #' || sys_users.id`;
  }

  // Build role expression
  const roleExpr =
    sql`(select string_agg(ar.name, ', ') from auth_user_roles aur join auth_roles ar on ar.id = aur.auth_role_id where aur.sys_user_id = sys_users.id)`;

  const filterWhere = userFilter !== true ? sql` and ${userFilter}` : sql``;

  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "available_users",
          sql`select
            sys_users.id,
            ${nameExpr} as display_name,
            ${roleExpr} as roles
          from db.sys_users
          where true${filterWhere}
          order by sys_users.id
          limit 50`,
        );
        s.defScalar("search_text", sql.lit``);
        s.defScalar("user_count", sql`(select count(*) from available_users)`);
      }}
    >
      <div
        sx={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "start",
          p: 2,
          md: {
            p: 4,
          },
          ...generateWaveBackground({
            lightBaseColor: useTheme().lightColorScheme.palette.primary["400"],
            darkBaseColor: useTheme().darkColorScheme.palette.primary["600"],
          }),
        }}
      >
        <div
          sx={{
            width: "100%",
            mt: "6vh",
            maxWidth: "520px",
            bgcolor: "background-surface",
            borderRadius: "xl",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            boxShadow: "lg",
            px: 4,
            py: 6,
            sm: {
              px: 8,
              py: 8,
            },
          }}
        >
          {logo
            ? (
              <img
                src={logo.src}
                alt={logo.alt}
                sx={[{ maxWidth: 80 }, logo.sx]}
                className={logo.className}
              />
            )
            : <YolmLogo />}

          <Typography level="h3" className="mb-1 text-center">
            Select User Account
          </Typography>
          <Typography
            level="body-sm"
            className="mb-5 text-center"
            color="neutral"
          >
            Choose an account to continue to {appName}
          </Typography>

          <Show when={sql`user_count > 5`}>
            <Input
              value={sql`search_text`}
              onInput={(s) => s.setScalar("search_text", sql`target_value`)}
              placeholder="Search users..."
              size="sm"
              startDecorator={<MaterialIcon icon="Search" fontSize="sm" />}
              className="w-full mb-3"
            />
          </Show>

          <div className="w-full space-y-2 max-h-[400px] overflow-y-auto">
            <Each
              table="available_users"
              recordName="u"
              where={sql`search_text = '' or lower(u.display_name) like '%' || lower(search_text) || '%'`}
            >
              <Button
                variant="outlined"
                color="neutral"
                className="w-full"
                sx={{
                  justifyContent: "flex-start",
                  px: 2.5,
                  py: 1.5,
                  "&:hover": {
                    bgcolor: "background-level1",
                    borderColor: "primary-outlinedBorder",
                  },
                }}
                onClick={(s) => {
                  s.defScalar("selected_user_id", sql`u.id`);
                  s.server((s) => {
                    s.defScalar("token_id", sql`random.uuid()`);
                    s.startTransaction();
                    s.modify(
                      sql`insert into auth_session_tokens (sys_user_id, issued, public_id, type) values (selected_user_id, now(), token_id, ${sessionTokenType})`,
                    );
                    s.commitTransaction();
                    s.setCookie(
                      cookieName,
                      sql`token_id`,
                      authCookieOpts({}),
                    );
                  });
                  s.navigate(sql.lit`/`);
                }}
              >
                <div className="flex items-center gap-3 w-full min-w-0">
                  <div
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      bgcolor: "primary-softBg",
                      color: "primary-softColor",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontWeight: 600,
                      fontSize: "0.875rem",
                    }}
                  >
                    {sql`upper(left(u.display_name, 1))`}
                  </div>
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <Typography
                      level="title-sm"
                      className="truncate w-full text-left"
                    >
                      {sql`u.display_name`}
                    </Typography>
                  </div>
                  <Show when={sql`u.roles is not null and u.roles != ''`}>
                    <Chip size="sm" variant="soft" color="primary">
                      {sql`u.roles`}
                    </Chip>
                  </Show>
                </div>
              </Button>
            </Each>
          </div>

          <Show
            when={sql`user_count = 0`}
          >
            <Typography
              level="body-sm"
              color="neutral"
              className="mt-4 text-center"
            >
              No users available. Please contact your administrator.
            </Typography>
          </Show>

          <Typography
            level="body-xs"
            color="neutral"
            className="mt-5 text-center"
          >
            Preview mode - no authentication required
          </Typography>
        </div>
      </div>
    </Data>
  );
}
