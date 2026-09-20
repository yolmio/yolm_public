import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { Show } from "std/ui";
import { Data } from "std/data";
import type { CrmBlock } from "../index";
import type { PipelineConfig, PipelineStageConfig } from "./types";
import { toDisplayName } from "../helpers";

interface ExitCriteriaChecklistProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  stageName: Sql;
  refreshKey?: Sql;
}

/**
 * Renders the exit-criteria checklist for the current stage of a
 * pipeline item. Each criterion appears as a check that the user can
 * toggle; the pipeline can use them to gate moves between stages.
 */
export function ExitCriteriaChecklist(props: ExitCriteriaChecklistProps) {
  const { block, pipeline } = props;

  return (
    <>
      {pipeline.stages.map((stage) => (
        <Show when={sql`${props.stageName} = ${sql.lit(stage.name)}`}>
          <StageExitCriteriaContent
            block={block}
            pipeline={pipeline}
            stage={stage}
            itemId={props.itemId}
            refreshKey={props.refreshKey}
          />
        </Show>
      ))}
    </>
  );
}

interface StageExitCriteriaContentProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  stage: PipelineStageConfig;
  itemId: NumericExpr;
  refreshKey?: Sql;
}

function StageExitCriteriaContent(props: StageExitCriteriaContentProps) {
  const { block, stage, itemId } = props;
  const criteria = stage.exitCriteria ?? [];
  const itemsTable = block.pipelineItemsTableName;

  if (criteria.length === 0) {
    return (
      <div className="text-center py-6 text-tertiary">
        <MaterialIcon
          icon="CheckCircleOutline"
          className="text-3xl mb-2 opacity-50"
        />
        <Typography level="body-sm">No exit criteria for this stage</Typography>
        <Typography level="body-xs" className="mt-1">
          You can move to the next stage at any time
        </Typography>
      </div>
    );
  }

  return (
    <Data
      procedure={(s) => {
        // Fetch the pipeline item as "item" so conditions can reference it
        s.defRecord(
          "item",
          sql`select * from db.${sql.ref(itemsTable)} where id = ${itemId}`,
        );

        // Evaluate each criterion's condition
        criteria.forEach((criterion, index) => {
          s.defScalar(`criterion_${index}_met`, criterion.condition);
        });

        const metCountExpr = criteria
          .map((_, i) => sql`case when criterion_${i}_met then 1 else 0 end`)
          .reduce((acc, curr) => sql`${acc} + ${curr}`);
        s.defScalar("criteria_met_count", metCountExpr);

        const mode = stage.exitCriteriaMode ?? "all";
        if (mode === "all") {
          s.defScalar(
            "can_advance",
            sql`criteria_met_count = ${criteria.length}`,
          );
        } else {
          s.defScalar("can_advance", sql`criteria_met_count > 0`);
        }
      }}
      watch={props.refreshKey ? [props.refreshKey] : undefined}
    >
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Typography level="body-sm" className="text-tertiary">
              Progress
            </Typography>
            <Show
              when={sql`can_advance`}
              fallback={
                <Chip size="sm" variant="soft" color="neutral">
                  {sql`criteria_met_count`}/{criteria.length}
                </Chip>
              }
            >
              <Chip size="sm" variant="soft" color="success">
                {sql`criteria_met_count`}/{criteria.length}
              </Chip>
            </Show>
          </div>
          <Show when={sql`can_advance`}>
            <Chip
              size="sm"
              variant="soft"
              color="success"
              startDecorator={<MaterialIcon icon="CheckCircle" />}
            >
              Ready to advance
            </Chip>
          </Show>
        </div>

        <div className="h-2 bg-neutral-200 rounded-full overflow-hidden mb-4">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width:
                sql`coalesce(criteria_met_count * 100.0 / nullif(${criteria.length}, 0), 0) || '%'`,
              backgroundColor:
                sql`case when can_advance then 'var(--palette-success-500)' else 'var(--palette-primary-500)' end`,
            }}
          />
        </div>

        <div className="space-y-2">
          {criteria.map((criterion, index) => (
            <CriterionItem
              criterion={criterion}
              index={index}
            />
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-divider">
          <Typography level="body-xs" className="text-tertiary">
            {stage.exitCriteriaMode === "any"
              ? "Complete at least one criterion to advance"
              : "Complete all criteria to advance"}
          </Typography>
        </div>
      </div>
    </Data>
  );
}

interface CriterionItemProps {
  criterion: { name: string; displayName?: string };
  index: number;
}

function CriterionItem(props: CriterionItemProps) {
  const { criterion, index } = props;
  const isMet = sql`criterion_${index}_met`;

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg"
      style={{
        backgroundColor:
          sql`case when ${isMet} then 'var(--palette-success-50)' else 'transparent' end`,
      }}
    >
      <div
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
        style={{
          backgroundColor:
            sql`case when ${isMet} then 'var(--palette-success-500)' else 'var(--palette-neutral-200)' end`,
        }}
      >
        <Show
          when={isMet}
          fallback={<div className="w-2 h-2 rounded-full bg-white" />}
        >
          <MaterialIcon icon="Check" className="text-white text-sm" />
        </Show>
      </div>
      <div className="flex-1">
        <Typography
          level="body-sm"
          style={{
            color:
              sql`case when ${isMet} then 'var(--palette-success-700)' else 'inherit' end`,
            textDecoration:
              sql`case when ${isMet} then 'line-through' else 'none' end`,
          }}
        >
          {criterion.displayName ?? toDisplayName(criterion.name)}
        </Typography>
      </div>
      <Show when={isMet}>
        <Chip size="sm" variant="soft" color="success">Complete</Chip>
      </Show>
      <Show when={sql`not ${isMet}`}>
        <Chip size="sm" variant="soft" color="neutral">Pending</Chip>
      </Show>
    </div>
  );
}

/**
 * Checks if an item can advance from its current stage using procedure statements.
 * Sets an `exit_criteria_met` scalar (boolean) that callers can reference.
 *
 * This approach uses s.defRecord("item", ...) + s.if branches instead of generating
 * a massive inline SQL expression with N subqueries per criterion. The criterion
 * conditions reference `item` directly from the procedure record scope.
 */
export function checkExitCriteriaForItem<T extends IServerBaseStatements>(
  s: T,
  block: CrmBlock,
  pipeline: PipelineConfig,
  itemId: NumericExpr,
  currentStageName: Sql,
  targetStageName: string | Sql,
): void {
  const itemsTable = block.pipelineItemsTableName;

  // Fetch item as "item" so criterion conditions (which reference item.id etc.) work
  s.defRecord("item", {
    query: sql`select * from db.${sql.ref(itemsTable)} where id = ${itemId}`,
    allowNoRead: true,
  });

  // Build stage index lookup
  const stageIndexCase = sql.caseWhen({
    conditions: pipeline.stages.map((stage, index) => ({
      condition: sql`stage_name = ${sql.lit(stage.name)}`,
      expr: index,
    })),
    default: sql`-1`,
  });

  s.defScalar(
    "exit_criteria_current_idx",
    sql`(select ${stageIndexCase} from (select ${currentStageName} as stage_name))`,
  );
  const targetIdxExpr = typeof targetStageName === "string"
    ? sql`${pipeline.stages.findIndex((st) => st.name === targetStageName)}`
    : sql`(select ${stageIndexCase} from (select ${targetStageName} as stage_name))`;
  s.defScalar("exit_criteria_target_idx", targetIdxExpr);

  // Default: allow (covers backward moves, same stage, and stages without criteria)
  s.defScalar("exit_criteria_met", sql`true`);

  // Only evaluate criteria when moving forward
  s.if(sql`exit_criteria_target_idx > exit_criteria_current_idx`, (s) => {
    for (const stage of pipeline.stages) {
      if (!stage.exitCriteria || stage.exitCriteria.length === 0) continue;

      s.if(sql`${currentStageName} = ${sql.lit(stage.name)}`, (s) => {
        // Evaluate criteria directly — item record is in scope
        const mode = stage.exitCriteriaMode ?? "all";
        const combined = mode === "all"
          ? sql.and(...(stage.exitCriteria ?? []).map((c) => c.condition))
          : sql.or(...(stage.exitCriteria ?? []).map((c) => c.condition));
        s.setScalar("exit_criteria_met", combined as Sql);
      });
    }
  });
}
