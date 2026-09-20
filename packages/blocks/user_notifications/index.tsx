import {
  UserNotificationsBlock,
  UserNotificationSource,
} from "./user_notifications_block";
import {
  UserNotificationOpenPage,
  UserNotificationSettingsPage,
  UserNotificationsPage,
  UserNotificationsPushProvider,
} from "./pages";

UserNotificationsBlock.NotificationsPage = UserNotificationsPage;
UserNotificationsBlock.NotificationSettingsPage = UserNotificationSettingsPage;
UserNotificationsBlock.NotificationOpenPage = UserNotificationOpenPage;
UserNotificationsBlock.PushProvider = UserNotificationsPushProvider;

export {
  UserNotificationOpenPage,
  UserNotificationsBlock,
  UserNotificationSettingsPage,
  UserNotificationSource,
  UserNotificationsPage,
  UserNotificationsPushProvider,
};
export type {
  PublishUserNotificationOptions,
  UserNotificationDestination,
  UserNotificationEmailConfig,
  UserNotificationIdentityProvider,
  UserNotificationsBlockOpts,
  UserNotificationSourceConfig,
  UserNotificationSourceEmailConfig,
} from "./user_notifications_block";
export { notificationAppHref } from "./surfaces";
export {
  RecordNotificationDestination,
  recordNotificationDestinations,
} from "./record_destination";
export type {
  RecordNotificationDestinationOptions,
  UserNotificationTarget,
} from "./record_destination";
