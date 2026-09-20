/**
 * Partner automation reactors for CRM pipeline.
 *
 * These reactors handle automated partner-related workflows:
 * - Partner notification: Notifies partners when deals are ready for co-sell
 * - Partner validation: Ensures partner is validated before attachment
 *
 * Usage:
 * ```typescript
 * import { registerPartnerAutomationReactors } from "blocks/crm/reactors/partner_automation";
 *
 * // In your system initialization:
 * const crmBlock = new CrmBlock({ ... });
 * system.addBlock(crmBlock);
 *
 * // Register the reactors
 * registerPartnerAutomationReactors(crmBlock);
 * ```
 */

import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { CrmBlock } from "../index";

/**
 * Registers all partner automation reactors for the CRM block.
 */
export function registerPartnerAutomationReactors(block: CrmBlock) {
  const hasPartnerPipeline = block.pipelines.some((p) =>
    p.enablePartnerAttachment
  );

  if (!hasPartnerPipeline) return;

  block.ensurePartnerNotificationsTable();
  registerPartnerNotificationReactor(block);
  if (block.opts.partners?.program) {
    registerCoSellReadyNotificationReactor(
      block,
      block.opts.partners.program.coSellReadinessThreshold,
    );
  }
}

/**
 * Reactor that creates notifications when a partner is attached to a pipeline item.
 *
 * Creates a "deal_attached" notification for the partner when:
 * - A pipeline item has a partner attached
 * - No existing "deal_attached" notification exists for this item
 */
function registerPartnerNotificationReactor(block: CrmBlock) {
  if (system.reactors.some((r) => r.name === "crm_partner_deal_attached")) {
    return;
  }
  const itemsTable = block.pipelineItemsTableName;
  const notificationsTable = block.partnerNotificationsTableName;

  system.addReactor({
    name: "crm_partner_deal_attached",
    query: sql`
      select
        pi.id as pipeline_item_id,
        pi.partner_id,
        pi.partner_attached,
        p.name as partner_name
      from db.${sql.ref(itemsTable)} pi
      join db.crm_partners p on p.id = pi.partner_id
      where pi.partner_attached = true
        and pi.partner_id is not null
        and not exists (
          select 1 from db.${sql.ref(notificationsTable)} pn
          where pn.pipeline_item_id = pi.id
            and pn.notification_type = 'deal_attached'
        )
    `,
    procedure: (s) => {
      s.defRecord("r", sql`select * from reactor`);

      s.startTransaction();
      s.modify(sql`
        insert into db.${sql.ref(notificationsTable)}
          (pipeline_item_id, partner_id, notification_type, notified_at)
        values
          (r.pipeline_item_id, r.partner_id, 'deal_attached', current_timestamp)
      `);
      s.commitTransaction();
    },
    maxConcurrent: 5,
  });
}

/**
 * Reactor that creates co-sell ready notifications when partners meet the threshold.
 *
 * Creates a "co_sell_ready" notification when:
 * - A partner attached to a pipeline item meets the configured co-sell readiness threshold
 * - The partner is validated
 * - No existing "co_sell_ready" notification exists for this item
 *
 * This allows partner managers to be notified when a deal is ready
 * for co-selling activities.
 */
function registerCoSellReadyNotificationReactor(
  block: CrmBlock,
  readinessThreshold: number,
) {
  if (system.reactors.some((r) => r.name === "crm_partner_cosell_ready")) {
    return;
  }
  const itemsTable = block.pipelineItemsTableName;
  const notificationsTable = block.partnerNotificationsTableName;

  system.addReactor({
    name: "crm_partner_cosell_ready",
    query: sql`
      select
        pi.id as pipeline_item_id,
        pi.partner_id,
        p.name as partner_name,
        p.co_sell_readiness_score,
        p.validation_status
      from db.${sql.ref(itemsTable)} pi
      join db.crm_partners p on p.id = pi.partner_id
      where pi.partner_attached = true
        and pi.partner_id is not null
        and p.co_sell_readiness_score >= ${readinessThreshold}
        and p.validation_status = 'validated'
        and not exists (
          select 1 from db.${sql.ref(notificationsTable)} pn
          where pn.pipeline_item_id = pi.id
            and pn.notification_type = 'co_sell_ready'
        )
    `,
    procedure: (s) => {
      s.defRecord("r", sql`select * from reactor`);

      s.startTransaction();
      s.modify(sql`
        insert into db.${sql.ref(notificationsTable)}
          (pipeline_item_id, partner_id, notification_type, notified_at)
        values
          (r.pipeline_item_id, r.partner_id, 'co_sell_ready', current_timestamp)
      `);
      s.commitTransaction();
    },
    maxConcurrent: 5,
  });
}

/**
 * Reactor that creates validation required notifications for unvalidated partners.
 *
 * Creates a "validation_required" notification when:
 * - A partner is attached to a pipeline item
 * - The partner is not yet validated (status is 'pending')
 * - No existing "validation_required" notification exists for this item
 *
 * This reminds partner managers to validate partners before deals progress.
 */
export function registerPartnerValidationReminderReactor(block: CrmBlock) {
  if (
    system.reactors.some((r) => r.name === "crm_partner_validation_reminder")
  ) return;
  if (
    !block.opts.partners?.program ||
    !block.pipelines.some((p) => p.enablePartnerAttachment)
  ) return;
  block.ensurePartnerNotificationsTable();
  const itemsTable = block.pipelineItemsTableName;
  const notificationsTable = block.partnerNotificationsTableName;

  system.addReactor({
    name: "crm_partner_validation_reminder",
    query: sql`
      select
        pi.id as pipeline_item_id,
        pi.partner_id,
        p.name as partner_name,
        p.validation_status
      from db.${sql.ref(itemsTable)} pi
      join db.crm_partners p on p.id = pi.partner_id
      where pi.partner_attached = true
        and pi.partner_id is not null
        and p.validation_status = 'pending'
        and not exists (
          select 1 from db.${sql.ref(notificationsTable)} pn
          where pn.pipeline_item_id = pi.id
            and pn.notification_type = 'validation_required'
        )
    `,
    procedure: (s) => {
      s.defRecord("r", sql`select * from reactor`);

      s.startTransaction();
      s.modify(sql`
        insert into db.${sql.ref(notificationsTable)}
          (pipeline_item_id, partner_id, notification_type, notified_at)
        values
          (r.pipeline_item_id, r.partner_id, 'validation_required', current_timestamp)
      `);
      s.commitTransaction();
    },
    maxConcurrent: 5,
  });
}
