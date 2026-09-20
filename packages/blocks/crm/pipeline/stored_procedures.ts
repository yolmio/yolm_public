import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { CrmBlock } from "../index";
import { createAutoTasksForStage } from "./board";
import { checkExitCriteriaForItem } from "./exit_criteria";
import { registerStageFieldSaveProcedure } from "./stage_fields";

/** Name of the configured pipeline’s shared stage-transition procedure. */
export function movePipelineItemProcedureName(
  block: CrmBlock,
  pipelineName: string,
) {
  return `${block.getPipelineStageEnumName(pipelineName)}_move_item`;
}

/** Name of the block’s shared task-completion procedure. */
export function togglePipelineTaskProcedureName(block: CrmBlock) {
  return `${block.pipelineTasksTableName}_toggle_complete`;
}

/** Name of the block’s pipeline-aware task-creation logging procedure. */
export function logPipelineTaskCreatedProcedureName(block: CrmBlock) {
  return `${block.pipelineTasksTableName}_log_created`;
}

/** Registers shared pipeline mutations once per configured block. */
export function registerCrmPipelineStoredProcedures(block: CrmBlock) {
  const itemsTable = block.pipelineItemsTableName;
  const activityLogTable = block.pipelineActivityLogTableName;
  for (const pipeline of block.pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.fields?.length) {
        registerStageFieldSaveProcedure(block, pipeline, stage);
      }
    }
    system.storedProcedure({
      name: movePipelineItemProcedureName(block, pipeline.name),
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        {
          name: "p_stage",
          type: { type: "String", maxLength: 100 },
        },
        { name: "p_reorder", type: "Bool", notNull: true },
        { name: "p_target_item_id", type: "BigInt" },
        { name: "p_drop_position", type: { type: "String", maxLength: 20 } },
      ],
      procedure: (s) => {
        s.defRecord(
          "current_item",
          sql`select * from db.${sql.ref(itemsTable)}
          where id = p_item_id and pipeline_name = ${sql.lit(pipeline.name)}`,
        );
        s.throwErrorIf(
          sql`current_item.id is null`,
          sql.lit`Pipeline item not found.`,
        );
        s.throwErrorIf(
          sql`p_stage is null or not (${
            sql.or(...pipeline.stages.map((stage) =>
              sql`p_stage = ${sql.lit(stage.name)}`
            ))
          })`,
          sql.lit`Pipeline stage not found.`,
        );
        checkExitCriteriaForItem(
          s,
          block,
          pipeline,
          sql`p_item_id`,
          sql`current_item.stage_name`,
          sql`p_stage`,
        );
        s.throwErrorIf(
          sql`not exit_criteria_met`,
          sql
            .lit`Cannot advance: exit criteria for current stage not met. Complete all required fields before moving forward.`,
        );
        s.defScalar("new_order", sql`current_item.stage_order`);
        s.if(sql`p_reorder`, (s) => {
          s.if(
            sql`p_target_item_id is not null and p_drop_position is not null`,
            (s) => {
              s.defScalar(
                "target_order",
                sql`(select stage_order from db.${
                  sql.ref(itemsTable)
                } where id = p_target_item_id)`,
              );
              s.defScalar(
                "ordering_before",
                sql`(select stage_order from db.${sql.ref(itemsTable)}
              where stage_order < target_order and pipeline_name = ${
                  sql.lit(pipeline.name)
                }
                and stage_name = p_stage order by stage_order desc limit 1)`,
              );
              s.defScalar(
                "ordering_after",
                sql`(select stage_order from db.${sql.ref(itemsTable)}
              where stage_order > target_order and pipeline_name = ${
                  sql.lit(pipeline.name)
                }
                and stage_name = p_stage order by stage_order asc limit 1)`,
              );
              s.setScalar(
                "new_order",
                sql`case
              when p_drop_position = 'top' then ordering.new(ordering_before, target_order)
              when p_drop_position = 'bottom' then ordering.new(target_order, ordering_after)
              else current_item.stage_order end`,
              );
            },
            (s) => {
              s.setScalar(
                "new_order",
                sql`coalesce(ordering.new((select stage_order from db.${
                  sql.ref(itemsTable)
                }
              where pipeline_name = ${
                  sql.lit(pipeline.name)
                } and stage_name = p_stage
              order by stage_order desc limit 1)), ordering.new())`,
              );
            },
          );
        });
        s.modify(sql`update db.${sql.ref(itemsTable)}
          set stage_name = p_stage, stage_order = new_order,
            entered_stage_at = case when stage_name != p_stage then now() else entered_stage_at end,
            last_modified_at = now()
          where id = p_item_id`);
        s.if(sql`current_item.stage_name != p_stage`, (s) => {
          if (block.hasPipelineActivityLogEnabled(pipeline.name)) {
            s.modify(sql`insert into db.${sql.ref(activityLogTable)}
              (pipeline_item_id, activity_type, from_stage, to_stage, sys_user_id, created_at)
              values (p_item_id, 'stage_changed', current_item.stage_name, p_stage, current_user, now())`);
          }
          for (const stage of pipeline.stages) {
            if (
              !block.opts.debugHooks?.afterPipelineStageChanged &&
              !(block.hasPipelineTasksEnabled(pipeline.name) &&
                stage.autoTasksOnEntry?.length)
            ) continue;
            s.if(sql`p_stage = ${sql.lit(stage.name)}`, (s) => {
              block.opts.debugHooks?.afterPipelineStageChanged?.(s, {
                pipelineName: pipeline.name,
                itemId: sql`p_item_id`,
                fromStage: sql`current_item.stage_name`,
                toStage: stage.name,
              });
              if (block.hasPipelineTasksEnabled(pipeline.name)) {
                createAutoTasksForStage(s, {
                  block,
                  pipeline,
                  stageName: stage.name,
                  itemId: sql`p_item_id`,
                  activityLogTable,
                });
              }
            });
          }
        });
      },
    });
  }
  if (
    !block.pipelines.some((pipeline) =>
      block.hasPipelineTasksEnabled(pipeline.name)
    )
  ) return;
  const loggedPipelines = block.pipelines.filter((pipeline) =>
    block.hasPipelineActivityLogEnabled(pipeline.name)
  );
  system.storedProcedure({
    name: logPipelineTaskCreatedProcedureName(block),
    transaction: "caller",
    inputScalars: [
      { name: "p_item_id", type: "BigInt" },
      { name: "p_title", type: { type: "String", maxLength: 500 } },
    ],
    procedure: (s) => {
      s.throwErrorIf(
        sql`not (${block.pipelineItemSupportsTasks(sql`p_item_id`)})`,
        sql.lit`Tasks are disabled for this pipeline item.`,
      );
      if (!loggedPipelines.length) return;
      s.modify(sql`insert into db.${sql.ref(activityLogTable)}
        (pipeline_item_id, activity_type, description, sys_user_id, created_at)
        select item.id, 'task_created', 'Created task: ' || p_title, current_user, now()
        from db.${sql.ref(itemsTable)} item
        where item.id = p_item_id and (${
        sql.or(...loggedPipelines.map((pipeline) =>
          sql`item.pipeline_name = ${sql.lit(pipeline.name)}`
        ))
      })`);
    },
  });
  system.storedProcedure({
    name: togglePipelineTaskProcedureName(block),
    transaction: "caller",
    inputScalars: [{ name: "p_task_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "task",
        sql`select id, pipeline_item_id, title, completed from db.${
          sql.ref(block.pipelineTasksTableName)
        } where id = p_task_id`,
      );
      s.throwErrorIf(sql`task.id is null`, sql.lit`Pipeline task not found.`);
      s.throwErrorIf(
        sql`not (${
          block.pipelineItemSupportsTasks(sql`task.pipeline_item_id`)
        })`,
        sql.lit`Tasks are disabled for this pipeline item.`,
      );
      s.modify(sql`update db.${sql.ref(block.pipelineTasksTableName)}
        set completed = not completed,
          completed_at = case when not completed then now() else null end,
          completed_by = case when not completed then current_user else null end
        where id = p_task_id`);
      if (loggedPipelines.length) {
        s.if(
          sql`exists (select 1 from db.${sql.ref(itemsTable)} item
          where item.id = task.pipeline_item_id and (${
            sql.or(
              ...loggedPipelines.map((pipeline) =>
                sql`item.pipeline_name = ${sql.lit(pipeline.name)}`
              ),
            )
          }))`,
          (s) => {
            s.modify(sql`insert into db.${sql.ref(activityLogTable)}
            (pipeline_item_id, activity_type, description, sys_user_id, created_at)
            values (task.pipeline_item_id,
              case when task.completed then 'task_uncompleted' else 'task_completed' end,
              case when task.completed then 'Marked task incomplete: ' else 'Completed task: ' end || task.title,
              current_user, now())`);
          },
        );
      }
    },
  });
}
