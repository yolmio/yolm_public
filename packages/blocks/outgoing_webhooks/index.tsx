import { WebhookManagementPage } from "./outgoing_webhooks_page";
import {
  OutgoingWebhooksBlock,
  type OutgoingWebhookType,
} from "./outgoing_webhooks_block";

OutgoingWebhooksBlock.WebhookManagementPage = WebhookManagementPage;

export { OutgoingWebhooksBlock, WebhookManagementPage };
export type { OutgoingWebhookType };
