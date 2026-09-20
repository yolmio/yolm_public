import { Sidebar } from "components/sidebar";
import { MaterialIcon } from "components/material_icon";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { EventHandlers, Route, Show } from "std/ui";
import type { Node } from "std/ui";
import { getActualDomain } from "std/yolm_gen_api";
import type { UserNotificationsBlock } from "./user_notifications_block";
import {
  UserNotificationOpenPage,
  UserNotificationSettingsPage,
  UserNotificationsPage,
} from "./pages";

/** Resolve app links in production and local multi-domain development alike. */
export function notificationAppHref(domain: string, path: Sql): Sql {
  const actual = getActualDomain(domain);
  const origin = /^https?:\/\//.test(actual)
    ? actual
    : `${
      actual.includes("localhost") || actual.startsWith("127.0.0.1")
        ? "http"
        : "https"
    }://${actual}`;
  return sql`${sql.lit(origin)} || ${path}`;
}

export function NotificationRoutes(props: { block: UserNotificationsBlock }) {
  return (
    <>
      <Route path="/notifications/open/{route_user_notification_id:id}">
        <UserNotificationOpenPage />
      </Route>
      <Route path="/notifications/settings">
        <UserNotificationSettingsPage />
      </Route>
      <Route path="/notifications">
        <UserNotificationsPage />
      </Route>
      {props.block.sources.map((source) => source.destination?.routes?.())}
    </>
  );
}

export function NotificationSidebarItem(
  props: { block: UserNotificationsBlock; label?: Node },
) {
  return (
    <Sidebar.MenuItem>
      <Data local procedure={(s) => s.defScalar("notification_badge_tick", 0)}>
        <EventHandlers
          mount={(s) =>
            s.while(sql`true`, (s) => {
              s.sleep(30_000);
              s.increment("notification_badge_tick");
              s.commitUiTreeChanges();
            })}
        />
        <Data
          watch={[sql`notification_badge_tick`, sql`location.pathname`]}
          procedure={(s) =>
            s.defScalar(
              "notification_badge_count",
              props.block.unreadCountExpr(),
            )}
        >
          <Sidebar.MenuButton href="/notifications">
            <MaterialIcon icon="NotificationsNone" className="mr-2" />
            <span className="flex flex-1 items-center justify-between gap-2">
              <span>{props.label ?? "Notifications"}</span>
              <Show when={sql`notification_badge_count > 0`}>
                <span className="rounded-full bg-primary-500 px-1.5 text-xs text-white">
                  {sql`notification_badge_count`}
                </span>
              </Show>
            </span>
          </Sidebar.MenuButton>
        </Data>
      </Data>
    </Sidebar.MenuItem>
  );
}
