import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Form } from "std/form";
import { createTranslator } from "std/i18n";
import { LogoutICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import { useJsModule } from "std/js_modules";
import type { DomStatements } from "std/statements";
import { Each, EventHandlers, Redirect, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { Button } from "components/button";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { Typography } from "components/typography";
import { UserNotificationsBlock } from "./user_notifications_block";

const { t } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: {
      notifications: "Notifications",
      unread: "unread",
      allRead: "All notifications marked as read",
      markAllRead: "Mark all read",
      settings: "Settings",
      all: "All",
      unreadFilter: "Unread",
      snoozed: "Snoozed",
      search: "Search notifications",
      none: "No notifications here",
      until: "Until",
      snooze: "Snooze",
      snoozeNotification: "Snooze notification",
      oneHour: "1 hour",
      oneDay: "1 day",
      oneWeek: "1 week",
      unsnooze: "Unsnooze notification",
      markRead: "Mark as read",
      markUnread: "Mark as unread",
      deleteNotification: "Delete notification",
      deleteDescription:
        "Delete this notification and all of its activity from your Inbox?",
      delete: "Delete",
      deleted: "Notification deleted",
      previous: "Previous",
      page: "Page",
      of: "of",
      next: "Next",
      push: "Push notifications",
      pushDescription:
        "Enable notifications for this browser and device. Inbox unread state remains authoritative if a notification is ignored or dismissed.",
      pushEnabled: "Push notifications are enabled on this device.",
      pushPermissionRequired:
        "Notification permission has not been granted. Click Enable and allow notifications in your browser.",
      pushDenied:
        "Notifications are blocked in this browser. Allow them in the site settings before trying again.",
      pushUnsupported:
        "Push notifications are not supported in this browser context.",
      pushFailed: "Unable to configure push notifications",
      pushSaveFailed: "Unable to save push notification settings",
      pushOwnershipFailed: "Unable to verify push notification ownership",
      disableDevice: "Disable on this device",
      enableDevice: "Enable on this device",
      back: "← Back to notifications",
      notificationSettings: "Notification settings",
      noChannels:
        "This system has no external notification delivery channels enabled.",
      emailDelivery: "Email delivery",
      emailDescription:
        "Activity always appears in your Inbox. Email can supplement it. Some notification types may be configured for immediate delivery.",
      deliveryTiming: "Delivery timing",
      digest: "Digest — send after 15 minutes without new activity",
      immediate: "Immediate — send as soon as possible",
      off: "Off",
      emailHelp:
        "Emails omit activity you have already read. During sustained activity, a digest is sent at least once an hour.",
      savePreferences: "Save preferences",
    },
    es: {
      notifications: "Notificaciones",
      unread: "sin leer",
      allRead: "Todas las notificaciones se marcaron como leídas",
      markAllRead: "Marcar todas como leídas",
      settings: "Configuración",
      all: "Todas",
      unreadFilter: "Sin leer",
      snoozed: "Pospuestas",
      search: "Buscar notificaciones",
      none: "No hay notificaciones aquí",
      until: "Hasta",
      snooze: "Posponer",
      snoozeNotification: "Posponer notificación",
      oneHour: "1 hora",
      oneDay: "1 día",
      oneWeek: "1 semana",
      unsnooze: "Quitar aplazamiento",
      markRead: "Marcar como leída",
      markUnread: "Marcar como no leída",
      deleteNotification: "Eliminar notificación",
      deleteDescription:
        "¿Eliminar esta notificación y toda su actividad de la bandeja de entrada?",
      delete: "Eliminar",
      deleted: "Notificación eliminada",
      previous: "Anterior",
      page: "Página",
      of: "de",
      next: "Siguiente",
      push: "Notificaciones push",
      pushDescription:
        "Active las notificaciones para este navegador y dispositivo. El estado de la bandeja de entrada seguirá siendo la referencia si se ignora o descarta una notificación.",
      pushEnabled:
        "Las notificaciones push están activadas en este dispositivo.",
      pushPermissionRequired:
        "No se ha concedido permiso para las notificaciones. Pulse Activar y permita las notificaciones en su navegador.",
      pushDenied:
        "Las notificaciones están bloqueadas en este navegador. Permítalas en la configuración del sitio antes de volver a intentarlo.",
      pushUnsupported:
        "Las notificaciones push no son compatibles con este navegador.",
      pushFailed: "No se pudieron configurar las notificaciones push",
      pushSaveFailed:
        "No se pudo guardar la configuración de notificaciones push",
      pushOwnershipFailed:
        "No se pudo verificar la propiedad de las notificaciones push",
      disableDevice: "Desactivar en este dispositivo",
      enableDevice: "Activar en este dispositivo",
      back: "← Volver a las notificaciones",
      notificationSettings: "Configuración de notificaciones",
      noChannels:
        "Este sistema no tiene canales externos de entrega de notificaciones activados.",
      emailDelivery: "Entrega por correo electrónico",
      emailDescription:
        "La actividad siempre aparece en su bandeja de entrada. El correo electrónico puede complementarla. Algunos tipos de notificación pueden configurarse para entrega inmediata.",
      deliveryTiming: "Momento de entrega",
      digest: "Resumen — enviar tras 15 minutos sin actividad nueva",
      immediate: "Inmediato — enviar lo antes posible",
      off: "Desactivado",
      emailHelp:
        "Los correos omiten la actividad que ya leyó. Durante una actividad continua, se envía un resumen al menos una vez por hora.",
      savePreferences: "Guardar preferencias",
    },
  },
});

function NotificationFilterButton(
  { value, label }: { value: string; label: Node },
) {
  const valueLiteral = sql.lit(value);
  return (
    <Show
      when={sql`notification_filter = ${valueLiteral}`}
      fallback={
        <Button
          size="sm"
          variant="plain"
          color="neutral"
          aria-pressed={sql`false`}
          onClick={(s) => {
            s.setQueryParam("notification_filter", valueLiteral);
            s.setQueryParam("notification_page", sql`1`);
          }}
        >
          {label}
        </Button>
      }
    >
      <Button
        size="sm"
        variant="soft"
        color="primary"
        aria-pressed={sql`true`}
        onClick={(s) => {
          s.setQueryParam("notification_filter", valueLiteral);
          s.setQueryParam("notification_page", sql`1`);
        }}
      >
        {label}
      </Button>
    </Show>
  );
}

function DefaultNotificationContent(notification: Sql) {
  return (
    <div className="min-w-0">
      <Typography level="body-xs" className="text-secondary">
        {sql`${notification}.source_label`}
        {" · "}
        {sql`${notification}.record_key`}
      </Typography>
      <Typography level="body-sm" className="font-semibold">
        {sql`${notification}.title`}
      </Typography>
      <Show
        when={sql`nullif(trim(coalesce(${notification}.body, '')), '') is not null`}
      >
        <Typography level="body-sm" className="line-clamp-2 text-secondary">
          {sql`${notification}.body`}
        </Typography>
      </Show>
    </div>
  );
}

function NotificationContent(block: UserNotificationsBlock) {
  return (
    <>
      {block.sources.map((source) => (
        <Show when={sql`notification.source = ${sql.lit(source.key)}`}>
          {source.render?.(sql`notification`) ??
            DefaultNotificationContent(sql`notification`)}
        </Show>
      ))}
    </>
  );
}

/** Renders one Inbox item per notification occurrence. */
export function UserNotificationsPage() {
  const block = system.block(UserNotificationsBlock);
  const actionScope = sql`id = notification.id`;
  return (
    <Data
      local
      queryParams={{
        notification_filter: {
          type: { type: "String", maxLength: 20 },
          default: sql.lit`all`,
        },
        notification_search: {
          type: { type: "String", maxLength: 300 },
          default: sql.lit``,
        },
        notification_page: { type: "Int", default: sql`1` },
      }}
      procedure={(s) => {
        s.defScalar("notification_refresh_key", 0);
      }}
    >
      <EventHandlers
        mount={(s) => {
          s.while(sql`true`, (s) => {
            s.sleep(30_000);
            s.increment("notification_refresh_key");
            s.commitUiTreeChanges();
          });
        }}
      />
      <Data
        watch={[
          sql`notification_filter`,
          sql`notification_search`,
          sql`notification_page`,
          sql`notification_refresh_key`,
        ]}
        debounce={{ wait: sql`250` }}
        procedure={(s) => {
          s.defScalar(
            "unread_notification_count",
            block.unreadCountExpr(),
          );
          s.defTable(
            "filtered_notifications",
            sql`
              with accessible_notifications as (
                select notification.*,
                  notification.read_at is null and (
                    notification.snoozed_until is null
                    or notification.snoozed_until <= now()
                  ) as is_unread,
                  notification.read_at is null
                    and notification.snoozed_until > now() as is_snoozed
                from user_notifications notification
                where notification.recipient_user_id = current_user
                  and ${
              block.canUserAccess(sql`current_user`, sql`notification`)
            }
              )
              select
                notification.id,
                notification.source,
                notification.record_key,
                notification.title,
                notification.body,
                notification.payload,
                notification.created_at,
                notification.is_unread,
                notification.is_snoozed,
                notification.snoozed_until,
                ${
              block.sourceDisplayNameExpr(sql`notification.source`)
            } as source_label,
                ${block.destinationHrefExpr(sql`notification`)} as resolved_href
              from accessible_notifications notification
              where (
                  notification_search = ''
                  or lower(notification.title) like '%' || lower(notification_search) || '%'
                  or lower(coalesce(notification.body, '')) like '%' || lower(notification_search) || '%'
                  or lower(notification.record_key) like '%' || lower(notification_search) || '%'
                  or lower(${
              block.sourceDisplayNameExpr(sql`notification.source`)
            }) like '%' || lower(notification_search) || '%'
                )
                and (
                  (
                    notification_filter = 'all'
                    and not coalesce(notification.is_snoozed, false)
                  )
                  or (
                    notification_filter = 'unread'
                    and notification.is_unread
                  )
                  or (
                    notification_filter = 'snoozed'
                    and notification.is_snoozed
                  )
                )
            `,
          );
          s.defScalar(
            "notification_count",
            sql`(select count(*) from filtered_notifications)`,
          );
          s.defScalar(
            "notification_page_count",
            sql`case
              when notification_count = 0 then 1
              else cast(ceil(notification_count / 50.0) as bigint)
            end`,
          );
          s.defScalar(
            "effective_notification_page",
            sql`case
              when notification_page < 1 then 1
              when notification_page > notification_page_count then notification_page_count
              else notification_page
            end`,
          );
          s.defTable(
            "notifications",
            sql`
              select *
              from filtered_notifications
              order by created_at desc, id desc
              limit 50 offset (effective_notification_page - 1) * 50
            `,
          );
        }}
      >
        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Typography level="h3">{t("notifications")}</Typography>
              <Typography level="body-sm" className="text-secondary">
                {sql`unread_notification_count`} {t("unread")}
              </Typography>
            </div>
            <div className="flex gap-2">
              <ActionButton
                size="sm"
                variant="outlined"
                color="neutral"
                disabled={sql`unread_notification_count = 0`}
                action={(s) => {
                  s.startTransaction();
                  s.modify(sql`
                    update user_notifications
                    set read_at = now()
                    where recipient_user_id = current_user
                      and read_at is null
                      and (
                        snoozed_until is null
                        or snoozed_until <= now()
                      )
                  `);
                  s.commitTransaction();
                }}
                successMessage={t("allRead")}
              >
                {t("markAllRead")}
              </ActionButton>
              {(block.opts.email || block.opts.push) && (
                <Button
                  size="sm"
                  variant="outlined"
                  color="neutral"
                  href="/notifications/settings"
                >
                  <MaterialIcon icon="SettingsOutlined" />
                  {t("settings")}
                </Button>
              )}
            </div>
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex shrink-0 gap-1">
              <NotificationFilterButton value="all" label={t("all")} />
              <NotificationFilterButton
                value="unread"
                label={t("unreadFilter")}
              />
              <NotificationFilterButton
                value="snoozed"
                label={t("snoozed")}
              />
            </div>
            <Input
              value={sql`notification_search`}
              aria-label={t("search")}
              placeholder={t("search")}
              startIcon="Search"
              fullWidth
              onInput={(s) => {
                s.setQueryParam(
                  "notification_search",
                  sql`target_value`,
                );
                s.setQueryParam("notification_page", sql`1`);
              }}
            />
          </div>

          <Show
            when={sql`exists(select 1 from notifications)`}
            fallback={
              <div className="rounded-md border border-divider py-16 text-center">
                <MaterialIcon
                  icon="NotificationsNone"
                  sx={{ fontSize: "42px", opacity: 0.35 }}
                />
                <Typography level="body-md" className="mt-2 text-secondary">
                  {t("none")}
                </Typography>
              </div>
            }
          >
            <div className="overflow-hidden rounded-md border border-divider bg-surface">
              <Each table="notifications" recordName="notification">
                <div
                  className="flex min-h-20 items-center gap-3 border-b border-divider px-3 py-3 last:border-b-0 sm:px-4"
                  dynamicClassNames={[
                    {
                      condition: sql`notification.is_unread`,
                      classNames: "bg-primary-50",
                    },
                  ]}
                >
                  <div className="flex w-4 shrink-0 justify-center">
                    <Show
                      when={sql`notification.is_snoozed`}
                      fallback={
                        <Show when={sql`notification.is_unread`}>
                          <MaterialIcon
                            icon="Circle"
                            color="primary"
                            sx={{ fontSize: "9px" }}
                          />
                        </Show>
                      }
                    >
                      <MaterialIcon
                        icon="Schedule"
                        color="neutral"
                        sx={{ fontSize: "16px" }}
                      />
                    </Show>
                  </div>

                  <div className="min-w-0 flex-1">
                    <Show
                      when={sql`notification.resolved_href is null`}
                      fallback={
                        <a
                          href={sql`'/notifications/open/' || cast(notification.id as string)`}
                          className="block min-w-0 no-underline text-inherit"
                        >
                          {NotificationContent(block)}
                        </a>
                      }
                    >
                      {NotificationContent(block)}
                    </Show>
                  </div>

                  <Typography
                    level="body-xs"
                    className="hidden w-32 shrink-0 text-right text-secondary sm:block"
                  >
                    {sql`case
                      when notification.is_snoozed then
                        ${t("until")} || ' ' || format.date(
                          notification.snoozed_until at time zone ${
                      sql.lit(system.timezone)
                    },
                          '%b %-d, %-I:%M %p'
                        )
                      else format.date(
                        notification.created_at at time zone ${
                      sql.lit(system.timezone)
                    },
                        '%b %-d, %Y'
                      )
                    end`}
                  </Typography>

                  <Show
                    when={sql`notification.is_unread or notification.is_snoozed`}
                  >
                    <Show
                      when={sql`notification.is_snoozed`}
                      fallback={
                        <Menu>
                          <Menu.IconButton
                            icon="Schedule"
                            size="sm"
                            variant="plain"
                            color="neutral"
                            tooltip={t("snooze")}
                            aria-label={t("snoozeNotification")}
                          />
                          <Menu.Content>
                            <Menu.Item
                              onClick={(s) => {
                                s.server((s) => {
                                  s.startTransaction();
                                  s.modify(sql`
                                    update user_notifications
                                    set snoozed_until = now() + interval '1 hour'
                                    where recipient_user_id = current_user
                                      and ${actionScope}
                                      and read_at is null
                                  `);
                                  s.commitTransaction();
                                });
                                s.increment("notification_refresh_key");
                              }}
                            >
                              {t("oneHour")}
                            </Menu.Item>
                            <Menu.Item
                              onClick={(s) => {
                                s.server((s) => {
                                  s.startTransaction();
                                  s.modify(sql`
                                    update user_notifications
                                    set snoozed_until = now() + interval '1 day'
                                    where recipient_user_id = current_user
                                      and ${actionScope}
                                      and read_at is null
                                  `);
                                  s.commitTransaction();
                                });
                                s.increment("notification_refresh_key");
                              }}
                            >
                              {t("oneDay")}
                            </Menu.Item>
                            <Menu.Item
                              onClick={(s) => {
                                s.server((s) => {
                                  s.startTransaction();
                                  s.modify(sql`
                                    update user_notifications
                                    set snoozed_until = now() + interval '7 days'
                                    where recipient_user_id = current_user
                                      and ${actionScope}
                                      and read_at is null
                                  `);
                                  s.commitTransaction();
                                });
                                s.increment("notification_refresh_key");
                              }}
                            >
                              {t("oneWeek")}
                            </Menu.Item>
                          </Menu.Content>
                        </Menu>
                      }
                    >
                      <ActionButton
                        size="sm"
                        variant="plain"
                        color="neutral"
                        aria-label={t("unsnooze")}
                        action={(s) => {
                          s.startTransaction();
                          s.modify(sql`
                            update user_notifications
                            set snoozed_until = null
                            where recipient_user_id = current_user
                              and ${actionScope}
                              and read_at is null
                          `);
                          s.commitTransaction();
                        }}
                      >
                        <MaterialIcon icon="AlarmOff" />
                      </ActionButton>
                    </Show>
                  </Show>

                  <ActionButton
                    size="sm"
                    variant="plain"
                    color="neutral"
                    aria-label={sql`case
                      when notification.is_unread or notification.is_snoozed
                        then ${t("markRead")}
                      else ${t("markUnread")}
                    end`}
                    action={(s) => {
                      s.startTransaction();
                      s.if(
                        sql`notification.is_unread or notification.is_snoozed`,
                        (s) => {
                          s.modify(sql`
                            update user_notifications
                            set read_at = now(), snoozed_until = null
                            where recipient_user_id = current_user
                              and ${actionScope}
                              and read_at is null
                          `);
                        },
                        (s) => {
                          s.modify(sql`
                            update user_notifications
                            set read_at = null, snoozed_until = null
                            where id = notification.id
                              and recipient_user_id = current_user
                          `);
                        },
                      );
                      s.commitTransaction();
                    }}
                  >
                    <Show
                      when={sql`notification.is_unread or notification.is_snoozed`}
                      fallback={<MaterialIcon icon="MarkEmailUnreadOutlined" />}
                    >
                      <MaterialIcon icon="DraftsOutlined" />
                    </Show>
                  </ActionButton>

                  <ActionButton
                    size="sm"
                    variant="plain"
                    color="neutral"
                    aria-label={t("deleteNotification")}
                    confirm={{
                      description: t("deleteDescription"),
                      confirmText: t("delete"),
                    }}
                    action={(s) => {
                      s.startTransaction();
                      s.modify(sql`
                        delete from user_notifications
                        where recipient_user_id = current_user
                          and ${actionScope}
                      `);
                      s.commitTransaction();
                    }}
                    successMessage={t("deleted")}
                  >
                    <MaterialIcon icon="DeleteOutline" />
                  </ActionButton>
                </div>
              </Each>
            </div>
          </Show>

          <Show when={sql`notification_count > 50`}>
            <div className="mt-4 flex items-center justify-between gap-3">
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                disabled={sql`effective_notification_page <= 1`}
                onClick={(s) =>
                  s.setQueryParam(
                    "notification_page",
                    sql`effective_notification_page - 1`,
                  )}
              >
                {t("previous")}
              </Button>
              <Typography level="body-sm" className="text-secondary">
                {t("page")} {sql`effective_notification_page`} {t("of")}{"  "}
                {sql`notification_page_count`}
              </Typography>
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                disabled={sql`effective_notification_page >= notification_page_count`}
                onClick={(s) =>
                  s.setQueryParam(
                    "notification_page",
                    sql`effective_notification_page + 1`,
                  )}
              >
                {t("next")}
              </Button>
            </div>
          </Show>
        </div>
      </Data>
    </Data>
  );
}

/** Opening an authorized notification marks that occurrence read, then redirects. */
export function UserNotificationOpenPage() {
  const open = (s: DomStatements) => {
    s.setScalar("notification_open_status", sql.lit`opening`);
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.callStoredProcedure("user_notifications_open", {
          inputScalars: { p_notification_id: sql`route_user_notification_id` },
          outputScalars: { p_href: "ui.notification_open_href" },
        });
        s.commitTransaction();
      },
      catch: (s) => s.setScalar("notification_open_status", sql.lit`failed`),
    });
    s.if(sql`notification_open_status != 'failed'`, (s) => {
      s.setScalar("notification_open_status", sql.lit`complete`);
    });
  };
  return (
    <Data
      local
      watch={[sql`route_user_notification_id`]}
      procedure={(s) => {
        s.defScalar("notification_open_href", { type: "String" });
        s.defScalar("notification_open_status", sql.lit`opening`);
      }}
    >
      <EventHandlers mount={open} />
      <Show
        when={sql`notification_open_status = 'complete' and notification_open_href is not null`}
        fallback={
          <div className="mx-auto max-w-lg p-8 text-center">
            <Typography level="body-md" className="text-secondary">
              {sql`case notification_open_status
                when 'opening' then 'Opening notification…'
                when 'failed' then 'Could not open this notification. Please try again.'
                else 'This notification is no longer available, or you no longer have access.' end`}
            </Typography>
            <Show when={sql`notification_open_status = 'failed'`}>
              <Button onClick={open} className="mt-4">Try again</Button>
            </Show>
            <Show when={sql`notification_open_status != 'opening'`}>
              <Button href="/notifications" backLink className="mt-4">
                Back to notifications
              </Button>
            </Show>
          </div>
        }
      >
        <Redirect to={sql`notification_open_href`} />
      </Show>
    </Data>
  );
}

function deletePushBrowserState(
  s: DomStatements,
  pushResult: Sql = sql`push_result`,
  reportUiError = true,
) {
  s.tryServer({
    body: (s) => {
      s.startTransaction();
      s.modify(sql`
        delete from user_notification_push_subscriptions
        where (
            origin = ${pushResult}->>'origin'
            and installation_id = cast(${pushResult}->>'installationId' as uuid)
          )
          or (
            nullif(${pushResult}->>'endpoint', '') is not null
            and endpoint_hash = bytes.to_hex(crypto.sha256(
              string.to_utf8(${pushResult}->>'endpoint')
            ))
          )
      `);
      s.commitTransaction();
    },
    errorName: "push_persist_error",
    catch: (s) => {
      if (reportUiError) {
        s.setScalar("push_status", sql.lit`failed`);
        s.setScalar(
          "push_error",
          sql`coalesce(push_persist_error.message, ${t("pushSaveFailed")})`,
        );
      }
    },
  });
}

function persistEnabledPushBrowserState(s: DomStatements) {
  s.tryServer({
    body: (s) => {
      s.startTransaction();
      s.modify(sql`
        delete from user_notification_push_subscriptions
        where endpoint_hash = bytes.to_hex(crypto.sha256(
            string.to_utf8(push_result->>'endpoint')
          ))
          and not (
            origin = push_result->>'origin'
            and installation_id = cast(push_result->>'installationId' as uuid)
          )
      `);
      s.modify(sql`
        insert into user_notification_push_subscriptions (
          sys_user_id,
          installation_id,
          origin,
          endpoint,
          endpoint_hash,
          p256dh,
          auth,
          vapid_key_id
        ) values (
          current_user,
          cast(push_result->>'installationId' as uuid),
          push_result->>'origin',
          push_result->>'endpoint',
          bytes.to_hex(crypto.sha256(string.to_utf8(push_result->>'endpoint'))),
          push_result->>'p256dh',
          push_result->>'auth',
          push_result->>'vapidKeyId'
        )
        on conflict (origin, installation_id) do update set
          sys_user_id = current_user,
          endpoint = push_result->>'endpoint',
          endpoint_hash = bytes.to_hex(crypto.sha256(
            string.to_utf8(push_result->>'endpoint')
          )),
          p256dh = push_result->>'p256dh',
          auth = push_result->>'auth',
          vapid_key_id = push_result->>'vapidKeyId'
      `);
      s.commitTransaction();
    },
    errorName: "push_persist_error",
    catch: (s) => {
      s.setScalar("push_status", sql.lit`failed`);
      s.setScalar(
        "push_error",
        sql`coalesce(push_persist_error.message, ${t("pushSaveFailed")})`,
      );
    },
  });
}

function unsubscribePushBrowser(
  s: DomStatements,
  resultJsonScalar = "push_result",
  reportUiError = true,
) {
  s.jsCall({
    module: "web_push",
    exportName: "unsubscribe",
    handle: sql.lit`user_notifications_push`,
    resultJsonScalar,
  });
  deletePushBrowserState(s, sql.ref(resultJsonScalar), reportUiError);
}

function reconcileExistingPushBrowser(s: DomStatements) {
  s.if(sql`push_status in ('enabled', 'refresh_required')`, (s) => {
    s.tryServer({
      body: (s) => {
        s.setScalar(
          "push_owner_matches",
          sql`exists (
            select 1
            from user_notification_push_subscriptions
            where sys_user_id = current_user
              and origin = push_result->>'origin'
              and installation_id = cast(push_result->>'installationId' as uuid)
          )`,
        );
      },
      errorName: "push_owner_error",
      catch: (s) => {
        s.setScalar("push_status", sql.lit`failed`);
        s.setScalar(
          "push_error",
          sql`coalesce(push_owner_error.message, ${t("pushOwnershipFailed")})`,
        );
      },
    });
    s.if(sql`push_status <> 'failed' and push_owner_matches`, (s) => {
      s.jsCall({
        module: "web_push",
        exportName: "subscribe",
        handle: sql.lit`user_notifications_push`,
        argJson: sql`json_build_object('requestPermission', false)`,
        resultJsonScalar: "push_result",
      });
      s.setScalar("push_status", sql`push_result->>'state'`);
      s.setScalar("push_error", sql`coalesce(push_result->>'error', '')`);
      s.if(sql`push_status = 'enabled'`, (s) => {
        persistEnabledPushBrowserState(s);
      });
      s.elseIf(sql`push_status = 'failed'`, (s) => {
        unsubscribePushBrowser(s);
        s.setScalar("push_status", sql.lit`failed`);
      });
    });
    s.elseIf(sql`push_status <> 'failed'`, (s) => {
      unsubscribePushBrowser(s);
      s.setScalar("push_status", sql.lit`disabled`);
    });
  });
  s.elseIf(sql`push_status in ('disabled', 'denied')`, (s) => {
    deletePushBrowserState(s);
  });
}

/**
 * Reconciles one browser subscription for the authenticated notification-host
 * app and removes it during every supported logout flow.
 */
export function UserNotificationsPushProvider(props: { children: Node }) {
  const block = system.block(UserNotificationsBlock);
  if (!block.opts.push) {
    throw new Error(
      "UserNotificationsBlock.PushProvider requires UserNotificationsBlock({ push: true })",
    );
  }
  const logout = useOptionalICtx(LogoutICtxKey);
  if (!logout?.registerLogoutCleanup) {
    throw new Error(
      "UserNotificationsBlock.PushProvider must be rendered inside a supported authentication provider",
    );
  }
  useJsModule("web_push");
  logout.registerLogoutCleanup(
    "user_notifications_web_push",
    (s) => {
      unsubscribePushBrowser(
        s,
        "user_notifications_logout_push_result",
        false,
      );
    },
  );

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("push_status", sql.lit`checking`);
        s.defScalar("push_error", sql.lit``);
        s.defScalar("push_owner_matches", false);
        s.defScalar("push_result", { type: "Json" });
      }}
    >
      <EventHandlers
        mount={(s) => {
          s.jsCall({
            module: "web_push",
            exportName: "inspect",
            handle: sql.lit`user_notifications_push`,
            resultJsonScalar: "push_result",
          });
          s.setScalar("push_status", sql`push_result->>'state'`);
          s.setScalar("push_error", sql`coalesce(push_result->>'error', '')`);
          reconcileExistingPushBrowser(s);
        }}
      />
      <div
        className="hidden"
        onMount={(s) => {
          s.jsCall({
            module: "web_push",
            exportName: "beginSession",
            handle: sql.lit`user_notifications_push_session`,
          });
        }}
        js={{
          handles: [{
            module: "web_push",
            cleanup: "endSession",
            handle: sql.lit`user_notifications_push_session`,
          }],
          on: {},
        }}
      />
      {props.children}
    </Data>
  );
}

function PushNotificationSettings() {
  useJsModule("web_push");
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("push_status", sql.lit`checking`);
        s.defScalar("push_busy", false);
        s.defScalar("push_error", sql.lit``);
        s.defScalar("push_result", { type: "Json" });
      }}
    >
      <EventHandlers
        mount={(s) => {
          s.jsCall({
            module: "web_push",
            exportName: "inspect",
            handle: sql.lit`user_notifications_push`,
            resultJsonScalar: "push_result",
          });
          s.setScalar("push_status", sql`push_result->>'state'`);
          s.setScalar("push_error", sql`coalesce(push_result->>'error', '')`);
        }}
      />
      <div className="space-y-4 rounded-md border border-divider p-5">
        <div>
          <Typography level="title-sm">{t("push")}</Typography>
          <Typography level="body-xs" className="text-secondary">
            {t("pushDescription")}
          </Typography>
        </div>
        <Show when={sql`push_status = 'enabled'`}>
          <Typography level="body-sm" color="success">
            {t("pushEnabled")}
          </Typography>
        </Show>
        <Show when={sql`push_status = 'permission_required'`}>
          <Typography level="body-sm" className="text-secondary" role="status">
            {t("pushPermissionRequired")}
          </Typography>
        </Show>
        <Show when={sql`push_status = 'denied'`}>
          <Typography level="body-sm" color="danger">
            {t("pushDenied")}
          </Typography>
        </Show>
        <Show when={sql`push_status = 'unsupported'`}>
          <Typography level="body-sm" className="text-secondary">
            {t("pushUnsupported")}
          </Typography>
        </Show>
        <Show when={sql`push_status = 'failed'`}>
          <Typography level="body-sm" color="danger">
            {sql`coalesce(nullif(push_error, ''), ${t("pushFailed")})`}
          </Typography>
        </Show>
        <div className="flex justify-end gap-2">
          <Show when={sql`push_status = 'enabled'`}>
            <Button
              variant="outlined"
              color="neutral"
              onClick={(s) => {
                s.setScalar("push_error", sql.lit``);
                unsubscribePushBrowser(s);
                s.setScalar("push_status", sql`push_result->>'state'`);
                s.setScalar(
                  "push_error",
                  sql`coalesce(push_result->>'error', '')`,
                );
              }}
            >
              {t("disableDevice")}
            </Button>
          </Show>
          <Show when={sql`push_status not in ('enabled', 'unsupported')`}>
            <Button
              loading={sql`push_busy`}
              disabled={sql`push_status = 'checking' or push_busy`}
              onClick={(s) => {
                s.if(sql`push_busy`, (s) => s.return());
                s.setScalar("push_busy", true);
                s.try({
                  body: (s) => {
                    s.setScalar("push_error", sql.lit``);
                    s.jsCall({
                      module: "web_push",
                      exportName: "subscribe",
                      handle: sql.lit`user_notifications_push`,
                      argJson:
                        sql`json_build_object('requestPermission', true)`,
                      resultJsonScalar: "push_result",
                    });
                    s.setScalar("push_status", sql`push_result->>'state'`);
                    s.setScalar(
                      "push_error",
                      sql`coalesce(push_result->>'error', '')`,
                    );
                    s.if(sql`push_status = 'failed'`, (s) => {
                      unsubscribePushBrowser(s);
                      s.setScalar("push_status", sql.lit`failed`);
                    });
                    s.if(
                      sql`push_status in ('enabled', 'disabled', 'denied')`,
                      (s) => {
                        s.if(sql`push_status = 'enabled'`, (s) => {
                          persistEnabledPushBrowserState(s);
                        });
                        s.else((s) => deletePushBrowserState(s));
                      },
                    );
                  },
                  errorName: "push_enable_error",
                  catch: (s) => {
                    s.setScalar("push_status", sql.lit`failed`);
                    s.setScalar(
                      "push_error",
                      sql`coalesce(push_enable_error.message, ${
                        t("pushFailed")
                      })`,
                    );
                  },
                  finally: (s) => s.setScalar("push_busy", false),
                });
              }}
            >
              {t("enableDevice")}
            </Button>
          </Show>
        </div>
      </div>
    </Data>
  );
}

/** Renders the current user's notification delivery settings. */
export function UserNotificationSettingsPage() {
  const block = system.block(UserNotificationsBlock);
  if (!block.opts.email && !block.opts.push) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <a href="/notifications" className="no-underline hover:underline">
          <Typography level="body-sm" className="text-secondary">
            {t("back")}
          </Typography>
        </a>
        <Typography level="h3" className="mt-2">
          {t("notificationSettings")}
        </Typography>
        <Typography level="body-sm" className="mt-4 text-secondary">
          {t("noChannels")}
        </Typography>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <div className="mb-5">
        <a href="/notifications" className="no-underline hover:underline">
          <Typography level="body-sm" className="text-secondary">
            {t("back")}
          </Typography>
        </a>
        <Typography level="h3" className="mt-2">
          {t("notificationSettings")}
        </Typography>
      </div>
      <div className="space-y-4">
        {block.opts.push && <PushNotificationSettings />}
        {block.opts.email && (
          <Form defaultFieldComponent={FieldFormControl}>
            <Form.Merge
              table="user_notification_preferences"
              where={sql`sys_user_id = current_user`}
              values={{ sys_user_id: sql`current_user` }}
              defaultEmptyRecord
            >
              <div className="space-y-4 rounded-md border border-divider p-5">
                <div>
                  <Typography level="title-sm">
                    {t("emailDelivery")}
                  </Typography>
                  <Typography level="body-xs" className="text-secondary">
                    {t("emailDescription")}
                  </Typography>
                </div>
                <FormControl className="gap-2">
                  <FormLabel>{t("deliveryTiming")}</FormLabel>
                  <Form.Field field="email_mode">
                    {(helper) => (
                      <Select
                        value={helper.value}
                        onChange={(s, value) => helper.setValue(s, value)}
                      >
                        <Select.Option value="digest">
                          {t("digest")}
                        </Select.Option>
                        <Select.Option value="immediate">
                          {t("immediate")}
                        </Select.Option>
                        <Select.Option value="off">{t("off")}</Select.Option>
                      </Select>
                    )}
                  </Form.Field>
                  <Typography level="body-xs" className="text-secondary">
                    {t("emailHelp")}
                  </Typography>
                </FormControl>
                <Form.ErrorAlert />
                <div className="flex justify-end">
                  <Form.SubmitButton>
                    {t("savePreferences")}
                  </Form.SubmitButton>
                </div>
              </div>
            </Form.Merge>
          </Form>
        )}
      </div>
    </div>
  );
}
