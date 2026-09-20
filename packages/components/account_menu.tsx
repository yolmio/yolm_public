import { navigationText } from "./navigation_text";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Menu } from "components/menu";
import { Data } from "std/data";
import { LogoutICtxKey } from "std/ictx";
import { type Sql, sql } from "std/sql_utils";
import { type FloatingOpts, type Node, Show, useOptionalICtx } from "std/ui";

export interface AccountMenuApp {
  name: string;
  href: string;
  icon: IconName;
  visible?: Sql;
}

export interface AccountMenuProps {
  userName: Sql;
  userInitials: Sql;
  apps: AccountMenuApp[];
  compact?: boolean;
  placement?: FloatingOpts["placement"];
  logoutLabel?: Node;
  openAppsInNewWindow?: boolean;
}

export function AccountMenu(props: AccountMenuProps) {
  const logout = useOptionalICtx(LogoutICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("account_menu_user_name", props.userName);
        s.defScalar("account_menu_user_initials", props.userInitials);
        props.apps.forEach((app, index) => {
          if (app.visible) {
            s.defScalar(`account_menu_app_${index}`, app.visible);
          }
        });
      }}
    >
      <Menu>
        <Menu.Button
          variant="soft"
          color="neutral"
          size="sm"
          aria-label={navigationText("accountAndApps")}
          sx={props.compact
            ? {
              width: 36,
              minWidth: 36,
              height: 36,
              p: 0,
              borderRadius: 999,
            }
            : {
              width: "100%",
              minHeight: 52,
              justifyContent: "flex-start",
              gap: 1.25,
              px: 1.25,
              borderRadius: 12,
            }}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-medium text-white">
            {sql`account_menu_user_initials`}
          </span>
          <Show when={props.compact ? sql`false` : sql`true`}>
            <span className="min-w-0 flex-1 truncate text-left font-normal">
              {sql`account_menu_user_name`}
            </span>
            <MaterialIcon icon="KeyboardArrowRight" fontSize="sm" />
          </Show>
        </Menu.Button>
        <Menu.Content
          floating={{
            placement: props.placement ??
              (props.compact ? "right-end" : "top-start"),
          }}
          sx={{
            width: 264,
            maxHeight: "min(70vh, 560px)",
            p: 0.75,
            borderRadius: 14,
          }}
        >
          <li className="flex items-center gap-3 px-2 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-xs font-medium text-white">
              {sql`account_menu_user_initials`}
            </span>
            <span className="min-w-0 truncate text-sm font-medium">
              {sql`account_menu_user_name`}
            </span>
          </li>
          {props.apps.length > 0 && (
            <>
              <Menu.Separator />
              <li className="px-2 pb-1 pt-1 text-xs text-tertiary">
                {navigationText("apps")}
              </li>
            </>
          )}
          {props.apps.map((app, index) => {
            const item = (
              <Menu.Item
                href={app.href}
                target={props.openAppsInNewWindow ? "_blank" : undefined}
                rel={props.openAppsInNewWindow
                  ? "noopener noreferrer"
                  : undefined}
              >
                <MaterialIcon icon={app.icon} fontSize="sm" />
                <span>{app.name}</span>
              </Menu.Item>
            );
            return app.visible
              ? <Show when={sql.ref(`account_menu_app_${index}`)}>{item}</Show>
              : item;
          })}
          {logout && (
            <>
              <Menu.Separator />
              <Menu.Item onClick={logout.logout}>
                <MaterialIcon icon="Logout" fontSize="sm" />
                <span>{props.logoutLabel ?? navigationText("logout")}</span>
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu>
    </Data>
  );
}
