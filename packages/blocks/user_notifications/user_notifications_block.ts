import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { storedScheduledProc } from "std/scheduled_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";
import type { Node } from "std/ui";
import type { UserNotificationTarget } from "./record_destination";
import {
  notificationAppHref,
  NotificationRoutes,
  NotificationSidebarItem,
} from "./surfaces";

/** A source-owned exact destination. */
export interface UserNotificationDestination {
  href: (notification: Sql) => Sql;
  /** Optional packaged destination pages, mounted by Notifications.Routes. */
  routes?: () => Node;
}

/** Adapts a system's user records to notification delivery. */
export interface UserNotificationIdentityProvider {
  isActive: (userId: Sql) => Sql;
  email?: (userId: Sql) => Sql;
}

/** Defines one domain source that can publish into the shared Inbox. */
export interface UserNotificationSourceConfig {
  /** System-wide, namespaced source key such as `sales.crm.opportunity`. */
  key: string;
  displayName: string;
  canUserAccess: (opts: { userId: Sql; recordKey: Sql }) => Sql;
  /** Omit for non-clickable informational notifications. */
  destination?: UserNotificationDestination;
  /** Resolves source-owned context shown in generic notification emails. */
  emailContext?: (notification: Sql) => Sql;
  /** Overrides generic email delivery for this source. */
  email?: UserNotificationSourceEmailConfig;
  /**
   * Optional source-owned rendering for an Inbox occurrence. The record
   * includes the persisted notification fields plus `source_label`,
   * `resolved_href`, `is_unread`, and `is_snoozed`.
   */
  render?: (notification: Sql) => Node;
}

/** Configures optional email delivery for notifications. */
export interface UserNotificationEmailConfig {
  /** App hosting Notifications.Routes; email always enters through its handoff. */
  domain: string;
  /** Runtime absolute origin for email links; null/blank uses the mapped domain. */
  publicOrigin?: Sql;
  from: string | Sql;
  applicationName?: string | Sql;
  tag?: string | Sql;
  messageStream?: string | Sql;
}

/** Configures how one notification source participates in shared email. */
export interface UserNotificationSourceEmailConfig {
  /**
   * Source email policy. Defaults to `preference`, which follows each
   * recipient's immediate, digest, or off preference. `immediate` makes an
   * eligible occurrence immediately due while still respecting an off
   * preference. `disabled` keeps the source Inbox-only.
   */
  delivery?: "disabled" | "preference" | "immediate";
  subject?: (notification: Sql) => Sql;
  htmlBody?: (notification: Sql) => Sql;
  textBody?: (notification: Sql) => Sql;
}

/** Generation-time configuration for {@link UserNotificationsBlock}. */
export interface UserNotificationsBlockOpts {
  identity: UserNotificationIdentityProvider;
  sources: UserNotificationSourceConfig[];
  email?: UserNotificationEmailConfig;
  /** Enables managed browser Web Push delivery with no application secrets. */
  push?: boolean;
}

/** Runtime expressions used to insert a notification for each recipient. */
export interface PublishUserNotificationOptions {
  /** Stable subject identifier used for access checks and Inbox grouping. */
  recordKey: Sql;
  /** Query returning one `recipient_user_id` row per intended recipient. */
  recipientsQuery: Sql;
  title: Sql;
  body?: Sql;
  /** Package-owned record destination; do not also supply href or payload. */
  target?: UserNotificationTarget;
  href?: Sql;
  /** Source-owned JSON; explicit record targets serialize their own payload. */
  payload?: Sql;
}

/** A configured source capability used to publish and manage notifications. */
export class UserNotificationSource {
  constructor(
    readonly block: UserNotificationsBlock,
    readonly config: UserNotificationSourceConfig,
  ) {}

  publish<T extends IServerBaseStatements>(
    s: T,
    opts: PublishUserNotificationOptions,
  ) {
    this.block.publish(s, this.config, opts);
  }
}

/**
 * Adds a shared personal Inbox and optional email/Web Push delivery to a system.
 * Each row is one occurrence for one recipient; no separate thread model.
 */
export class UserNotificationsBlock implements Block {
  Routes = () => NotificationRoutes({ block: this });
  SidebarItem = (props: { label?: Node } = {}) =>
    NotificationSidebarItem({ ...props, block: this });
  static NotificationsPage: any;
  static NotificationSettingsPage: any;
  static NotificationOpenPage: any;
  static PushProvider: any;

  blockName = "UserNotificationsBlock";
  blockDisplayName = "User Notifications";
  componentDependencies = [
    "UserNotificationsPage",
    "UserNotificationSettingsPage",
    "UserNotificationOpenPage",
  ];
  description =
    "Provides a personal notification Inbox with optional email and Web Push delivery.";

  readonly opts: UserNotificationsBlockOpts;
  readonly sources: UserNotificationSourceConfig[];

  constructor(opts: UserNotificationsBlockOpts) {
    this.opts = opts;
    this.sources = opts.sources;
    this.validateConfiguration();
  }

  initialize() {
    if (this.opts.email) {
      system.enum_({
        name: "user_notification_email_mode",
        values: ["off", "digest", "immediate"],
      });
      system.emailOutboxTable({
        name: "user_notification_email",
        fields: (table) => {
          table.fk("recipient_user_id", "sys_users").notNull();
        },
      });
    }

    if (this.opts.push) {
      system.outboxTable({
        name: "user_notification_push",
        fields: (table) => {
          table.fk("notification_id", "user_notifications").notNull().onDelete(
            "Cascade",
          );
          table.fk(
            "subscription_id",
            "user_notification_push_subscriptions",
          ).notNull().onDelete("Cascade");
          table.unique(["notification_id", "subscription_id"]);
        },
      });
    }

    system.db.table("user_notifications", (table) => {
      table.string("source", 100).notNull();
      table.string("record_key", 200).notNull();
      table.fk("recipient_user_id", "sys_users").notNull().onDelete(
        "Cascade",
      );
      table.string("title", 1000).notNull();
      table.text("body", 10000);
      table.string("href", 2000);
      table.json("payload");
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("read_at");
      table.timestampUtc("snoozed_until");
      if (this.opts.push) {
        table.timestampUtc("push_eligible_at");
        table.timestampUtc("push_prepared_at");
      }
      if (this.opts.email) {
        table.timestampUtc("email_eligible_at");
        table.fk("email_outbox_id", "user_notification_email_outbox");
      }
    });

    if (this.opts.push) {
      system.db.table("user_notification_push_subscriptions", (table) => {
        table.fk("sys_user_id", "sys_users").notNull().onDelete("Cascade");
        table.uuid("installation_id").notNull();
        table.string("origin", 500).notNull();
        table.string("endpoint", 4096).notNull();
        table.string("endpoint_hash", 64).notNull();
        table.string("p256dh", 200).notNull();
        table.string("auth", 200).notNull();
        table.string("vapid_key_id", 100).notNull();
        table.unique(["origin", "installation_id"]);
        table.unique(["endpoint_hash"]);
      });
      this.registerPushPreparation();
      this.registerPushReactor();
    }

    if (this.opts.email) {
      system.db.table("user_notification_preferences", (table) => {
        table.fk("sys_user_id", "sys_users").notNull().unique().onDelete(
          "Cascade",
        );
        table.enum("email_mode", "user_notification_email_mode").notNull()
          .default(sql.lit`digest`);
      });
      this.registerEmailPreparation();
      this.registerEmailReactor();
    }
  }

  source(key: string) {
    const config = this.sources.find((source) => source.key === key);
    if (!config) {
      throw new Error(`Unknown user notification source: ${key}`);
    }
    return new UserNotificationSource(this, config);
  }

  sourceDisplayNameExpr(source: Sql) {
    return sql.caseWhen({
      operand: source,
      conditions: this.sources.map((config) => ({
        condition: sql.lit(config.key),
        expr: sql.lit(config.displayName),
      })),
      default: sql.lit`Notifications`,
    });
  }

  destinationHrefExpr(notification: Sql) {
    return sql.caseWhen({
      operand: sql`${notification}.source`,
      conditions: this.sources.map((source) => ({
        condition: sql.lit(source.key),
        expr: source.destination?.href(notification) ?? sql`null`,
      })),
      default: sql`null`,
    });
  }

  /** Build an email link using the runtime origin or the mapped app domain. */
  emailAppHref(path: Sql): Sql {
    const email = this.opts.email;
    if (!email) throw new Error("Email delivery is not configured");
    const fallback = notificationAppHref(email.domain, path);
    if (!email.publicOrigin) return fallback;
    return sql`coalesce(
      regexp_replace(nullif(trim(${email.publicOrigin}), ''), '/+$', '') || ${path},
      ${fallback}
    )`;
  }

  /** Email resolves app choice only after the recipient authenticates. */
  emailHrefExpr(notification: Sql) {
    if (!this.opts.email) throw new Error("Email delivery is not configured");
    return sql`case when ${
      sql.or(
        this.sources.filter((source) => source.destination).map((source) =>
          sql`${notification}.source = ${sql.lit(source.key)}`
        ),
      )
    } then ${
      this.emailAppHref(
        sql`'/notifications/open/' || cast(${notification}.id as string)`,
      )
    } end`;
  }

  /** In a transaction, resolve an authorized occurrence and mark it read. */
  open<T extends IServerBaseStatements>(
    s: T,
    notificationId: Sql,
    intoHref: string,
  ) {
    s.block((s) => {
      s.defRecord(
        "notification_to_open",
        sql`
        select notification.id, ${
          this.destinationHrefExpr(sql`notification`)
        } as href
        from user_notifications notification
        where notification.id = ${notificationId}
          and notification.recipient_user_id = current_user
          and ${this.canUserAccess(sql`current_user`, sql`notification`)}
      `,
      );
      s.setScalar(intoHref, sql`null`);
      s.if(
        sql`notification_to_open.id is not null
        and position('#' in notification_to_open.href) = 0
        and (notification_to_open.href like '/%'
          or notification_to_open.href like 'https://%'
          or notification_to_open.href like 'http://%')
        and notification_to_open.href not like '//%'`,
        (s) => {
          s.modify(sql`update user_notifications
          set read_at = coalesce(read_at, now()), snoozed_until = null
          where id = notification_to_open.id
            and (read_at is null or snoozed_until is not null)`);
          s.setScalar(intoHref, sql`notification_to_open.href`);
        },
      );
    });
  }

  private emailContextExpr(source: Sql, notification: Sql) {
    return sql.caseWhen({
      operand: source,
      conditions: this.sources.map((config) => ({
        condition: sql.lit(config.key),
        expr: config.emailContext?.(notification) ?? sql`null`,
      })),
      default: sql`null`,
    });
  }

  private sourceForcesImmediateEmailExpr(source: Sql) {
    const immediateSources = this.sources.filter(
      (config) => config.email?.delivery === "immediate",
    );
    if (immediateSources.length === 0) return sql`false`;
    return sql.caseWhen({
      operand: source,
      conditions: immediateSources.map((config) => ({
        condition: sql.lit(config.key),
        expr: sql`true`,
      })),
      default: sql`false`,
    });
  }

  private sourceDisablesEmailExpr(source: Sql) {
    const disabledSources = this.sources.filter(
      (config) => config.email?.delivery === "disabled",
    );
    if (disabledSources.length === 0) return sql`false`;
    return sql.caseWhen({
      operand: source,
      conditions: disabledSources.map((config) => ({
        condition: sql.lit(config.key),
        expr: sql`true`,
      })),
      default: sql`false`,
    });
  }

  private sourceEmailSubjectExpr(source: Sql, notification: Sql) {
    const customSources = this.sources.filter(
      (config) => config.email?.subject,
    );
    if (customSources.length === 0) return sql`cast(null as string)`;
    return sql.caseWhen({
      operand: source,
      conditions: customSources.map((config) => ({
        condition: sql.lit(config.key),
        expr: config.email!.subject!(notification),
      })),
      default: sql`null`,
    });
  }

  private sourceEmailHtmlBodyExpr(source: Sql, notification: Sql) {
    const customSources = this.sources.filter(
      (config) => config.email?.htmlBody,
    );
    if (customSources.length === 0) return sql`cast(null as string)`;
    return sql.caseWhen({
      operand: source,
      conditions: customSources.map((config) => ({
        condition: sql.lit(config.key),
        expr: config.email!.htmlBody!(notification),
      })),
      default: sql`null`,
    });
  }

  private sourceEmailTextBodyExpr(source: Sql, notification: Sql) {
    const customSources = this.sources.filter(
      (config) => config.email?.textBody,
    );
    if (customSources.length === 0) return sql`cast(null as string)`;
    return sql.caseWhen({
      operand: source,
      conditions: customSources.map((config) => ({
        condition: sql.lit(config.key),
        expr: config.email!.textBody!(notification),
      })),
      default: sql`null`,
    });
  }

  canUserAccess(userId: Sql, notificationRecord: Sql) {
    return sql.caseWhen({
      operand: sql`${notificationRecord}.source`,
      conditions: this.sources.map((config) => ({
        condition: sql.lit(config.key),
        expr: config.canUserAccess({
          userId,
          recordKey: sql`${notificationRecord}.record_key`,
        }),
      })),
      default: sql`false`,
    });
  }

  unreadCountExpr(userId: Sql = sql`current_user`) {
    return sql`(select count(*) from user_notifications notification
        where notification.recipient_user_id = ${userId}
          and notification.read_at is null
          and (notification.snoozed_until is null or notification.snoozed_until <= now())
          and ${this.canUserAccess(userId, sql`notification`)})`;
  }

  publish<T extends IServerBaseStatements>(
    s: T,
    source: UserNotificationSourceConfig,
    opts: PublishUserNotificationOptions,
  ) {
    if (opts.target) {
      if (opts.href || opts.payload) {
        throw new Error("Notification target owns href and payload");
      }
      const { destination, id } = opts.target;
      opts = {
        ...opts,
        href: destination.path(id),
        payload: sql`json_build_object('targetKind', ${
          sql.lit(destination.opts.key)
        }, 'targetId', ${id})`,
      };
    }
    s.block((s) => {
      s.defTable(
        "published_user_notification_recipients",
        sql`
          select distinct candidate.recipient_user_id
          from (${opts.recipientsQuery}) candidate
          where candidate.recipient_user_id is not null
            and ${this.opts.identity.isActive(sql`candidate.recipient_user_id`)}
            and ${
          source.canUserAccess({
            userId: sql`candidate.recipient_user_id`,
            recordKey: opts.recordKey,
          })
        }
        `,
      );

      if (this.opts.email) {
        const email = this.opts.identity.email!;
        s.modify(sql`
          insert into user_notifications (
            source,
            record_key,
            recipient_user_id,
            title,
            body,
            href,
            payload,
            ${this.opts.push ? sql`push_eligible_at,` : sql``}
            email_eligible_at
          )
          select
            ${sql.lit(source.key)},
            cast(${opts.recordKey} as string),
            recipient.recipient_user_id,
            ${opts.title},
            ${opts.body ?? sql`null`},
            ${opts.href ?? sql`null`},
            ${opts.payload ?? sql`null`},
            ${this.opts.push ? sql`now(),` : sql``}
            case
              when ${
          this.sourceDisablesEmailExpr(sql.lit(source.key))
        } then null
              when nullif(trim(${
          email(sql`recipient.recipient_user_id`)
        }), '') is null then null
              when coalesce(
                preference.email_mode,
                'digest'::enums.user_notification_email_mode
              ) = 'off' then null
              when ${
          this.sourceForcesImmediateEmailExpr(sql.lit(source.key))
        } then now()
              when coalesce(
                preference.email_mode,
                'digest'::enums.user_notification_email_mode
              ) = 'immediate' then now()
              else now() + interval '15 minutes'
            end
          from published_user_notification_recipients recipient
          left join user_notification_preferences preference
            on preference.sys_user_id = recipient.recipient_user_id
        `);
      } else {
        s.modify(sql`
          insert into user_notifications (
            source,
            record_key,
            recipient_user_id,
            title,
            body,
            href,
            payload
            ${this.opts.push ? sql`, push_eligible_at` : sql``}
          )
          select
            ${sql.lit(source.key)},
            cast(${opts.recordKey} as string),
            recipient.recipient_user_id,
            ${opts.title},
            ${opts.body ?? sql`null`},
            ${opts.href ?? sql`null`},
            ${opts.payload ?? sql`null`}
            ${this.opts.push ? sql`, now()` : sql``}
          from published_user_notification_recipients recipient
        `);
      }
    });
  }

  private validateConfiguration() {
    if (this.sources.length === 0) {
      throw new Error("UserNotificationsBlock requires at least one source");
    }
    const sourceKeys = new Set<string>();
    for (const source of this.sources) {
      if (sourceKeys.has(source.key)) {
        throw new Error(`Duplicate user notification source: ${source.key}`);
      }
      if (source.key.length > 100) {
        throw new Error(
          `User notification source key exceeds 100 characters: ${source.key}`,
        );
      }
      sourceKeys.add(source.key);
    }
    if (this.opts.email && !this.opts.identity.email) {
      throw new Error(
        "UserNotificationsBlock email delivery requires identity.email",
      );
    }
  }

  private registerEmailPreparation() {
    storedScheduledProc({
      name: "prepare_user_notification_emails",
      schedule: "0 * * * * *",
      description: "Consolidate due personal notifications into emails",
      procedure: (s) => {
        s.forEachQuery(
          sql`
            with pending_notifications as (
              select
                notification.*,
                coalesce(
                  case
                    when ${
            this.sourceForcesImmediateEmailExpr(
              sql`notification.source`,
            )
          } then 'immediate'::enums.user_notification_email_mode
                    else (
                      select preference.email_mode
                      from user_notification_preferences preference
                      where preference.sys_user_id =
                        notification.recipient_user_id
                    )
                  end,
                  'digest'::enums.user_notification_email_mode
                ) as email_mode,
                ${
            this.sourceForcesImmediateEmailExpr(
              sql`notification.source`,
            )
          } as source_forces_immediate
              from user_notifications notification
              where notification.email_outbox_id is null
                and notification.email_eligible_at is not null
                and not ${
            this.sourceDisablesEmailExpr(sql`notification.source`)
          }
            )
            select
              notification.recipient_user_id,
              notification.email_mode,
              notification.source_forces_immediate,
              case
                when notification.source_forces_immediate
                  then notification.id
                else null
              end as immediate_notification_id
            from pending_notifications notification
            group by
              notification.recipient_user_id,
              notification.email_mode,
              notification.source_forces_immediate,
              case
                when notification.source_forces_immediate
                  then notification.id
                else null
              end
            having case
              when notification.email_mode = 'digest' then
                max(notification.email_eligible_at) <= now()
                or min(notification.created_at) <= now() - interval '60 minutes'
              else min(notification.email_eligible_at) <= now()
            end
            order by min(notification.email_eligible_at)
            limit 100
          `,
          "due_user_notification_delivery",
          (s) => {
            s.defScalar("prepared_user_notification_outbox_id", {
              type: "BigInt",
            });
            s.startTransaction();
            s.modify(sql`
              insert into user_notification_email_outbox (
                recipient_user_id
              ) values (
                due_user_notification_delivery.recipient_user_id
              )
              returning id into prepared_user_notification_outbox_id
            `);
            s.modify(sql`
              update user_notifications
              set email_outbox_id = prepared_user_notification_outbox_id
              where id in (
                select pending_notification.id
                from (
                  select
                    notification.id,
                    notification.email_eligible_at,
                    coalesce(
                      case
                        when ${
              this.sourceForcesImmediateEmailExpr(
                sql`notification.source`,
              )
            } then 'immediate'::enums.user_notification_email_mode
                        else (
                          select preference.email_mode
                          from user_notification_preferences preference
                          where preference.sys_user_id =
                            notification.recipient_user_id
                        )
                      end,
                      'digest'::enums.user_notification_email_mode
                    ) as email_mode,
                    ${
              this.sourceForcesImmediateEmailExpr(
                sql`notification.source`,
              )
            } as source_forces_immediate
                  from user_notifications notification
                  where notification.recipient_user_id =
                      due_user_notification_delivery.recipient_user_id
                    and notification.email_outbox_id is null
                    and notification.email_eligible_at is not null
                    and not ${
              this.sourceDisablesEmailExpr(sql`notification.source`)
            }
                ) pending_notification
                where pending_notification.email_mode =
                    due_user_notification_delivery.email_mode
                  and pending_notification.source_forces_immediate =
                    due_user_notification_delivery.source_forces_immediate
                  and (
                    due_user_notification_delivery.immediate_notification_id
                      is null
                    or pending_notification.id =
                      due_user_notification_delivery.immediate_notification_id
                  )
                  and (
                    due_user_notification_delivery.email_mode in ('digest', 'off')
                    or pending_notification.email_eligible_at <= now()
                  )
                order by pending_notification.email_eligible_at,
                  pending_notification.id
                limit 25
              )
            `);
            s.commitTransaction();
          },
        );
      },
    });
  }

  private registerPushPreparation() {
    storedScheduledProc({
      name: "prepare_user_notification_push",
      schedule: "*/5 * * * * *",
      description:
        "Fan out new personal notifications to browser subscriptions",
      procedure: (s) => {
        s.forEachQuery(
          sql`
            select notification.id
            from user_notifications notification
            where notification.push_prepared_at is null
              and notification.push_eligible_at <= now()
            order by notification.id
            limit 100
          `,
          "pending_user_notification_push",
          (s) => {
            s.startTransaction();
            s.modify(sql`
              insert into user_notification_push_outbox (
                notification_id,
                subscription_id
              )
              select
                notification.id as notification_id,
                subscription.id as subscription_id
              from user_notifications notification
              join user_notification_push_subscriptions subscription
                on subscription.sys_user_id = notification.recipient_user_id
              where notification.id = pending_user_notification_push.id
                and notification.read_at is null
                and (
                  notification.snoozed_until is null
                  or notification.snoozed_until <= now()
                )
                and ${
              this.opts.identity.isActive(
                sql`notification.recipient_user_id`,
              )
            }
                and ${
              this.canUserAccess(
                sql`notification.recipient_user_id`,
                sql`notification`,
              )
            }
              on conflict (notification_id, subscription_id) do nothing
            `);
            s.modify(sql`
              update user_notifications
              set push_prepared_at = now()
              where id = pending_user_notification_push.id
                and push_prepared_at is null
            `);
            s.commitTransaction();
          },
        );
      },
    });
  }

  private registerPushReactor() {
    system.outboxReactor({
      name: "user_notification_push",
      maxConcurrent: 10,
      maxRetries: 5,
      retryBackoff: (retryCount) =>
        sql`case
          when ${retryCount} = 0 then interval '15 seconds'
          when ${retryCount} = 1 then interval '1 minute'
          when ${retryCount} = 2 then interval '5 minutes'
          else interval '30 minutes'
        end`,
      procedure: (s, onError, onSuccess) => {
        s.defRecord(
          "user_notification_push_delivery",
          sql`
            select
              notification.id as notification_id,
              notification.recipient_user_id,
              notification.source,
              notification.record_key,
              notification.title,
              notification.body,
              subscription.id as subscription_id,
              subscription.endpoint,
              subscription.p256dh,
              subscription.auth,
              subscription.vapid_key_id
            from user_notification_push_outbox current_outbox
            join user_notifications notification
              on notification.id = current_outbox.notification_id
            join user_notification_push_subscriptions subscription
              on subscription.id = current_outbox.subscription_id
             and subscription.sys_user_id = notification.recipient_user_id
            where current_outbox.id = outbox.id
              and notification.read_at is null
              and (
                notification.snoozed_until is null
                or notification.snoozed_until <= now()
              )
              and ${
            this.opts.identity.isActive(
              sql`notification.recipient_user_id`,
            )
          }
              and ${
            this.canUserAccess(
              sql`notification.recipient_user_id`,
              sql`notification`,
            )
          }
          `,
        );
        s.if(
          sql`user_notification_push_delivery.notification_id is null`,
          (s) => {
            s.startTransaction();
            onSuccess(s);
            s.commitTransaction();
            s.return();
          },
        );

        s.defScalar(
          "user_notification_push_payload",
          sql`json_build_object(
            'v', 1,
            'operation', 'show',
            'tag', user_notification_push_delivery.recipient_user_id::string || ':' ||
              bytes.to_hex(crypto.sha256(string.to_utf8(
                user_notification_push_delivery.source || ':' ||
                user_notification_push_delivery.record_key
              ))),
            'version', user_notification_push_delivery.notification_id,
            'title', left(user_notification_push_delivery.title, 150),
            'body', left(user_notification_push_delivery.body, 350),
            'href', '/notifications/open/' ||
              user_notification_push_delivery.notification_id::string
          )`,
        );
        s.if(
          sql`octet_length(string.to_utf8(user_notification_push_payload::string)) > 3072`,
          (s) => {
            s.setScalar(
              "user_notification_push_payload",
              sql`json_build_object(
                'v', 1,
                'operation', 'show',
                'tag', user_notification_push_delivery.recipient_user_id::string || ':' ||
                  bytes.to_hex(crypto.sha256(string.to_utf8(
                    user_notification_push_delivery.source || ':' ||
                    user_notification_push_delivery.record_key
                  ))),
                'version', user_notification_push_delivery.notification_id,
                'title', left(user_notification_push_delivery.title, 150),
                'href', '/notifications/open/' ||
                  user_notification_push_delivery.notification_id::string
              )`,
            );
          },
        );

        s.sendWebPush({
          endpoint: sql`user_notification_push_delivery.endpoint`,
          p256dh: sql`user_notification_push_delivery.p256dh`,
          auth: sql`user_notification_push_delivery.auth`,
          vapidKeyId: sql`user_notification_push_delivery.vapid_key_id`,
          payload: sql`user_notification_push_payload`,
          resultJsonScalar: "user_notification_push_result",
          errorJsonScalar: "user_notification_push_error",
        });

        s.if(sql`user_notification_push_error is not null`, (s) => {
          s.startTransaction();
          onError(s, sql`user_notification_push_error->>'message'`);
          s.commitTransaction();
          s.return();
        });
        s.if(
          sql`user_notification_push_result->>'status' = 'retryable'`,
          (s) => {
            s.startTransaction();
            onError(
              s,
              sql`coalesce(user_notification_push_result->>'error', 'push service asked for retry')`,
            );
            s.commitTransaction();
            s.return();
          },
        );

        s.startTransaction();
        s.if(sql`user_notification_push_result->>'status' = 'gone'`, (s) => {
          s.modify(sql`
            delete from user_notification_push_subscriptions
            where id = user_notification_push_delivery.subscription_id
          `);
        });
        onSuccess(s);
        s.commitTransaction();
      },
    });
  }

  private registerEmailReactor() {
    const emailConfig = this.opts.email!;
    const email = this.opts.identity.email!;
    const applicationName = typeof emailConfig.applicationName === "string"
      ? sql.lit(emailConfig.applicationName)
      : emailConfig.applicationName ?? sql.lit`Notifications`;
    const preferencesHref = this.emailAppHref(
      sql.lit`/notifications/settings`,
    );
    system.emailOutboxReactor({
      name: "user_notification_email",
      setup: (s) => {
        s.defRecord(
          "user_notification_recipient",
          sql`
            select
              ${
            this.opts.identity.isActive(sql`outbox.recipient_user_id`)
          } as is_active,
              ${email(sql`outbox.recipient_user_id`)} as email,
              coalesce(
                preference.email_mode,
                'digest'::enums.user_notification_email_mode
              ) as email_mode
            from user_notification_email_outbox current_outbox
            left join user_notification_preferences preference
              on preference.sys_user_id = current_outbox.recipient_user_id
            where current_outbox.id = outbox.id
          `,
        );
        s.if(
          sql`not coalesce(user_notification_recipient.is_active, false)
            or nullif(trim(user_notification_recipient.email), '') is null
            or user_notification_recipient.email_mode = 'off'`,
          (s) => {
            s.startTransaction();
            s.modify(sql`
              update user_notification_email_outbox
              set status = 'sent', completed_at = now()
              where id = outbox.id
            `);
            s.commitTransaction();
            s.return();
          },
        );
        s.defTable(
          "user_notification_email_entries",
          sql`
            with ranked_notifications as (
              select
                notification.*,
                row_number() over (
                  partition by notification.source, notification.record_key
                  order by notification.created_at desc, notification.id desc
                ) as latest_rank,
                count(*) over (
                  partition by notification.source, notification.record_key
                ) as activity_count
              from user_notifications notification
              where notification.email_outbox_id = outbox.id
                and notification.read_at is null
                and (
                  notification.snoozed_until is null
                  or notification.snoozed_until <= now()
                )
            )
            select
              notification.source,
              notification.record_key,
              notification.title,
              notification.body,
              notification.created_at,
              notification.activity_count,
              ${
            this.sourceEmailSubjectExpr(
              sql`notification.source`,
              sql`notification`,
            )
          } as source_email_subject,
              ${
            this.sourceEmailHtmlBodyExpr(
              sql`notification.source`,
              sql`notification`,
            )
          } as source_email_html_body,
              ${
            this.sourceEmailTextBodyExpr(
              sql`notification.source`,
              sql`notification`,
            )
          } as source_email_text_body,
              ${
            this.sourceDisplayNameExpr(sql`notification.source`)
          } as source_label,
              ${
            this.emailContextExpr(
              sql`notification.source`,
              sql`notification`,
            )
          } as source_context,
              ${this.emailHrefExpr(sql`notification`)} as resolved_href
            from ranked_notifications notification
            where notification.latest_rank = 1
              and not ${this.sourceDisablesEmailExpr(sql`notification.source`)}
              and ${
            this.canUserAccess(
              sql`outbox.recipient_user_id`,
              sql`notification`,
            )
          }
            order by notification.created_at desc, notification.id desc
            limit 25
          `,
        );
        s.defScalar(
          "user_notification_email_entry_count",
          sql`(select count(*) from user_notification_email_entries)`,
        );
        s.if(sql`user_notification_email_entry_count = 0`, (s) => {
          s.startTransaction();
          s.modify(sql`
            update user_notification_email_outbox
            set status = 'sent', completed_at = now()
            where id = outbox.id
          `);
          s.commitTransaction();
          s.return();
        });
        s.defScalar(
          "user_notification_email_subject",
          sql`coalesce(
            case
              when user_notification_email_entry_count = 1 then (
                select source_email_subject
                from user_notification_email_entries
                limit 1
              )
            end,
            coalesce(${applicationName}, 'Notifications') || ' — ' ||
              user_notification_email_entry_count::string ||
              case
                when user_notification_email_entry_count = 1
                  then ' notification'
                else ' notifications'
              end
          )`,
        );
        s.defScalar(
          "user_notification_email_html",
          sql`(
            select string_agg(
              '<div style="border-bottom:1px solid #e5e7eb;padding:20px 0">' ||
              '<p style="color:#6b7280;font-size:12px;font-weight:600;letter-spacing:.02em;margin:0 0 7px">' ||
                string.html_escape(
                  source_label ||
                  case when nullif(trim(coalesce(source_context, '')), '') is null
                    then '' else ' · ' || source_context end ||
                  case when activity_count > 1
                    then ' · ' || activity_count::string || ' updates'
                    else '' end
                ) ||
              '</p>' ||
              coalesce(source_email_html_body,
              '<h2 style="color:#111827;font-size:17px;line-height:1.35;margin:0 0 8px">' ||
                string.html_escape(title) ||
              '</h2>' ||
              case
                when nullif(trim(coalesce(body, '')), '') is null then ''
                else '<p style="color:#374151;font-size:14px;line-height:1.5;white-space:pre-wrap;margin:0 0 14px">' ||
                  string.html_escape(body) || '</p>'
              end) ||
              '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>' ||
              '<td style="color:#6b7280;font-size:12px">' ||
                string.html_escape(format.date(
                  created_at at time zone ${sql.lit(system.timezone)},
                  '%b %-d, %Y · %-I:%M %p'
                )) ||
              '</td>' ||
              case when resolved_href is null then '<td></td>' else
                '<td align="right"><a href="' || string.html_escape(resolved_href) ||
                '" style="background:#2563eb;border-radius:6px;color:#ffffff;display:inline-block;font-size:13px;font-weight:600;padding:8px 14px;text-decoration:none">Open</a></td>'
              end ||
              '</tr></table>' ||
              '</div>',
              '' order by created_at desc, source, record_key
            )
            from user_notification_email_entries
          )`,
        );
        s.defScalar(
          "user_notification_email_text",
          sql`(
            select string_agg(
              source_label ||
              case when nullif(trim(coalesce(source_context, '')), '') is null
                then '' else ' · ' || source_context end ||
              case when activity_count > 1
                then ' · ' || activity_count::string || ' updates'
                else '' end || chr(10) ||
              coalesce(source_email_text_body, title ||
              case when nullif(trim(coalesce(body, '')), '') is null
                then '' else chr(10) || body end) ||
              case when resolved_href is null
                then '' else chr(10) || resolved_href end,
              chr(10) || chr(10) || '---' || chr(10) || chr(10)
              order by created_at desc, source, record_key
            )
            from user_notification_email_entries
          )`,
        );
      },
      from: emailConfig.from,
      to: sql`user_notification_recipient.email`,
      subject: sql`user_notification_email_subject`,
      htmlBody: sql`
        '<!doctype html><html><body style="background:#f3f4f6;margin:0;padding:0">' ||
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6">' ||
        '<tr><td align="center" style="padding:28px 12px">' ||
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Arial,sans-serif;max-width:640px;overflow:hidden">' ||
        '<tr><td style="background:#111827;color:#ffffff;padding:22px 26px">' ||
        '<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">' ||
          string.html_escape(coalesce(${applicationName}, 'Notifications')) ||
        '</div>' ||
        '<div style="font-size:22px;font-weight:700;margin-top:6px">' ||
          user_notification_email_entry_count::string ||
          case when user_notification_email_entry_count = 1
            then ' unread notification' else ' unread notifications' end ||
        '</div></td></tr>' ||
        '<tr><td style="padding:0 26px">' ||
        user_notification_email_html ||
        '</td></tr>' ||
        '<tr><td style="color:#6b7280;font-size:12px;padding:20px 26px 24px">' ||
        '<a href="' || string.html_escape(${preferencesHref}) ||
            '" style="color:#4b5563;text-decoration:underline">Manage notification preferences</a>' ||
        '</td></tr></table></td></tr></table></body></html>'
      `,
      textBody: sql`
        coalesce(${applicationName}, 'Notifications') || chr(10) ||
        user_notification_email_entry_count::string ||
        case when user_notification_email_entry_count = 1
          then ' unread notification' else ' unread notifications' end ||
        chr(10) || chr(10) || user_notification_email_text ||
        chr(10) || chr(10) || 'Manage notification preferences: ' || ${preferencesHref}
      `,
      tag: emailConfig.tag ?? "user-notification",
      messageStream: emailConfig.messageStream ?? "outbound",
      maxConcurrent: 5,
      maxRetries: 5,
      retryBackoff: (retryCount) =>
        sql`interval '5 minutes' * (${retryCount} + 1)`,
    });
  }
}
