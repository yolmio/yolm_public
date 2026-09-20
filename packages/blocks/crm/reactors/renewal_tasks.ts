/**
 * Renewal prep auto-task reactor for CRM success plans.
 *
 * This reactor automatically creates "Renewal Prep" tasks 90 days before
 * the renewal date on success plans that are linked to pipeline items.
 *
 * Usage:
 * ```typescript
 * import { registerRenewalTaskReactor } from "blocks/crm/reactors/renewal_tasks";
 *
 * // In your system initialization:
 * const crmBlock = new CrmBlock({ ... });
 * system.addBlock(crmBlock);
 *
 * // Register the reactor
 * registerRenewalTaskReactor(crmBlock);
 * ```
 */

import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { CrmBlock } from "../index";

/**
 * Registers the renewal prep auto-task reactor.
 *
 * Creates a "Renewal Prep" task on the linked pipeline item when:
 * - A success plan has a renewal_date set
 * - The success plan is linked to a pipeline item
 * - The renewal date is within 90 days
 * - No "Renewal Prep" task already exists for this success plan
 *
 * The task is created with:
 * - Title: "Renewal Prep - {success_plan_name}"
 * - Priority: high
 * - Due date: 60 days before renewal (giving 30 days to complete)
 */
export function registerRenewalTaskReactor(block: CrmBlock) {
  if (!block.hasSuccessPlansEnabled()) return;

  // Only register if there are pipelines with tasks enabled
  const hasPipelineWithTasks = block.pipelines.some((p) =>
    p.enableTasks !== false
  );
  if (
    !hasPipelineWithTasks ||
    system.reactors.some((r) => r.name === "crm_renewal_prep_task")
  ) return;

  const successPlansTable = block.successPlansTableName;
  const tasksTable = block.pipelineTasksTableName;

  system.addReactor({
    name: "crm_renewal_prep_task",
    query: sql`
      select
        sp.id as success_plan_id,
        sp.name as success_plan_name,
        sp.renewal_date,
        sp.pipeline_item_id,
        sp.organization_id,
        o.name as organization_name
      from db.${sql.ref(successPlansTable)} sp
      left join db.${
      sql.ref(block.organizationsTableName)
    } o on o.id = sp.organization_id
      where sp.renewal_date is not null
        and ${block.pipelineItemSupportsTasks(sql`sp.pipeline_item_id`)}
        and sp.renewal_date <= current_date() + interval '90 day'
        and sp.renewal_date > current_date()
        and not exists (
          select 1 from db.${sql.ref(tasksTable)} t
          where t.pipeline_item_id = sp.pipeline_item_id
            and t.title like 'Renewal Prep%'
            and not t.completed
        )
    `,
    procedure: (s) => {
      s.defRecord("r", sql`select * from reactor`);

      s.defScalar(
        "task_title",
        sql`'Renewal Prep - ' || coalesce(r.organization_name, r.success_plan_name)`,
      );
      s.defScalar(
        "task_description",
        sql`'Prepare for renewal of success plan: ' || r.success_plan_name || '. Renewal date: ' || format.date(r.renewal_date, '%Y-%m-%d')`,
      );
      s.defScalar(
        "due_date",
        sql`r.renewal_date - interval '60 day'`,
      );
      s.defScalar(
        "adjusted_due_date",
        sql`case when due_date < current_date() then current_date() + interval '7 day' else due_date end`,
      );

      s.startTransaction();
      s.modify(sql`
        insert into db.${sql.ref(tasksTable)}
          (pipeline_item_id, title, description, due_date, priority, completed, created_at)
        values
          (
            r.pipeline_item_id,
            task_title,
            task_description,
            cast(adjusted_due_date as date),
            'high',
            false,
            now()
          )
      `);
      s.commitTransaction();
    },
    maxConcurrent: 5,
  });
}
