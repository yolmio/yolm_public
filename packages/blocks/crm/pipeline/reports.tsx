import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { StatRow } from "components/stat_row";
import type { StatProps } from "components/stat_row";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import { CrmBlock } from "../index";
import { toDisplayName } from "../helpers";

interface PipelineOverviewReportProps {
  pipelineName: string;
  title?: string;
}

/**
 * Pre-built `SimpleReportsPage.Report` for a single pipeline. Shows
 * stage-by-stage counts, conversion rates, and value totals.
 */
export function PipelineOverviewReport(props: PipelineOverviewReportProps) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline) {
    throw new Error(`Pipeline "${props.pipelineName}" not found`);
  }

  const itemsTable = block.pipelineItemsTableName;
  const tasksTable = block.pipelineTasksTableName;
  const hasTasks = block.hasPipelineTasksEnabled(pipeline.name);
  const title = props.title ?? pipeline.displayName ??
    toDisplayName(pipeline.name);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {pipeline.icon && (
          <MaterialIcon
            icon={pipeline.icon}
            className="text-2xl text-primary-500"
          />
        )}
        <Typography level="h4">{title} Overview</Typography>
      </div>

      <Data
        procedure={(s) => {
          s.defScalar(
            "total_items",
            sql`(select count(*) from db.${
              sql.ref(itemsTable)
            } where pipeline_name = ${sql.lit(pipeline.name)})`,
          );
          s.defScalar(
            "items_this_week",
            sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(pipeline.name)}
                and entered_pipeline_at >= current_date() - interval '7 days')`,
          );

          if (hasTasks) {
            s.defScalar(
              "pending_tasks",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${sql.lit(pipeline.name)}
                  and not t.completed)`,
            );
            s.defScalar(
              "overdue_tasks",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${sql.lit(pipeline.name)}
                  and not t.completed
                  and t.due_date < current_date())`,
            );
          }
        }}
      >
        <StatRow
          stats={[
            {
              title: "Total Items",
              value: sql`total_items`,
              color: "primary",
              titleProps: { startIcon: "Inbox" },
            },
            {
              title: "Added This Week",
              value: sql`items_this_week`,
              color: "success",
              titleProps: { startIcon: "TrendingUp" },
            },
            ...(hasTasks
              ? [
                {
                  title: "Pending Tasks",
                  value: sql`pending_tasks`,
                  color: "warning",
                  titleProps: { startIcon: "Task" },
                },
                {
                  title: "Overdue Tasks",
                  value: sql`overdue_tasks`,
                  color: "danger",
                  titleProps: { startIcon: "Schedule" },
                },
              ] satisfies StatProps[]
              : []),
          ]}
        />
      </Data>

      <StageDistributionCard pipelineName={props.pipelineName} />

      {block.hasPipelineActivityLogEnabled(pipeline.name) && (
        <>
          <Card variant="outlined">
            <CardHeader>
              <Typography startIcon="History" level="title-md">
                Recent Activity
              </Typography>
            </CardHeader>
            <div className="p-4">
              <RecentActivityList
                block={block}
                pipelineName={pipeline.name}
                limit={10}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

interface RecentActivityListProps {
  block: CrmBlock;
  pipelineName: string;
  limit?: number;
}

function RecentActivityList(props: RecentActivityListProps) {
  const { block, pipelineName, limit = 10 } = props;
  const activityLogTable = block.pipelineActivityLogTableName;
  const itemsTable = block.pipelineItemsTableName;
  const organizationsTable = block.organizationsTableName;
  const peopleTable = block.peopleTableName;

  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "activities",
          sql`select
                al.*,
                case
                  when i.entity_type = 'organization' then ${
            system.db.tables[organizationsTable]
              ? sql`org.name`
              : sql`cast(null as string)`
          }
                  else concat(person.first_name, ' ', person.last_name)
                end as entity_name
              from db.${sql.ref(activityLogTable)} al
              join db.${sql.ref(itemsTable)} i on i.id = al.pipeline_item_id
              ${
            system.db.tables[organizationsTable]
              ? sql`left join db.${
                sql.ref(organizationsTable)
              } org on org.id = i.organization_id`
              : sql``
          }
              left join db.${
            sql.ref(peopleTable)
          } person on person.id = i.person_id
              where i.pipeline_name = ${sql.lit(pipelineName)}
              order by al.created_at desc
              limit ${limit}`,
        );
      }}
    >
      <div className="space-y-3">
        <Show when={sql`(select count(*) from activities) = 0`}>
          <Typography
            level="body-sm"
            className="text-tertiary text-center py-4"
          >
            No activity yet
          </Typography>
        </Show>
        <Each
          table="activities"
          recordName="activity"
        >
          <div className="flex items-start gap-3 py-2">
            <div className="flex-shrink-0">
              <Show
                when={sql`activity.activity_type = 'stage_changed'`}
                fallback={
                  <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="Circle"
                      className="text-neutral-500 text-sm"
                    />
                  </div>
                }
              >
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <MaterialIcon
                    icon="SwapHoriz"
                    className="text-primary-600 text-sm"
                  />
                </div>
              </Show>
            </div>
            <div className="flex-1 min-w-0">
              <Typography level="body-sm" component="div">
                <strong>{sql`activity.entity_name`}</strong>
                <Show when={sql`activity.activity_type = 'stage_changed'`}>
                  {" moved from "}
                  <Chip size="sm" variant="outlined">
                    {sql`string.capitalize(replace(activity.from_stage, '_', ' '))`}
                  </Chip>
                  {" to "}
                  <Chip size="sm" variant="outlined">
                    {sql`string.capitalize(replace(activity.to_stage, '_', ' '))`}
                  </Chip>
                </Show>
                <Show when={sql`activity.activity_type = 'item_created'`}>
                  {" was added to the pipeline"}
                </Show>
                <Show when={sql`activity.activity_type = 'task_completed'`}>
                  {" - task completed"}
                </Show>
              </Typography>
              <Typography level="body-xs" className="text-tertiary mt-0.5">
                {sql`format.date(activity.created_at, '%b %d, %Y')`}
              </Typography>
            </div>
          </div>
        </Each>
      </div>
    </Data>
  );
}

interface PipelineTasksReportProps {
  pipelineName: string;
}

/**
 * Pre-built report listing open and overdue tasks across all items in
 * `pipelineName`, grouped by assignee.
 */
export function PipelineTasksReport(props: PipelineTasksReportProps) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline || !block.hasPipelineTasksEnabled(props.pipelineName)) {
    return null;
  }

  const tasksTable = block.pipelineTasksTableName;
  const itemsTable = block.pipelineItemsTableName;

  return (
    <Card variant="outlined">
      <CardHeader>
        <Typography startIcon="Task" level="title-md">
          Tasks Overview
        </Typography>
      </CardHeader>
      <div className="p-4">
        <Data
          procedure={(s) => {
            s.defScalar(
              "total_tasks",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${sql.lit(props.pipelineName)})`,
            );
            s.defScalar(
              "completed_tasks",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${
                sql.lit(props.pipelineName)
              } and t.completed)`,
            );
            s.defScalar(
              "pending_tasks",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${
                sql.lit(props.pipelineName)
              } and not t.completed)`,
            );
            s.defScalar(
              "overdue_tasks",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${sql.lit(props.pipelineName)}
                  and not t.completed and t.due_date < current_date())`,
            );
            s.defScalar(
              "high_priority_pending",
              sql`(select count(*) from db.${sql.ref(tasksTable)} t
                  join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
                  where i.pipeline_name = ${sql.lit(props.pipelineName)}
                  and not t.completed and t.priority = 'high')`,
            );
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-level1 rounded-lg">
              <Typography level="h2" color="primary">
                {sql`total_tasks`}
              </Typography>
              <Typography level="body-xs" className="text-tertiary">
                Total Tasks
              </Typography>
            </div>
            <div className="text-center p-4 bg-success-50 rounded-lg">
              <Typography level="h2" className="text-success-600">
                {sql`completed_tasks`}
              </Typography>
              <Typography level="body-xs" className="text-tertiary">
                Completed
              </Typography>
            </div>
            <div className="text-center p-4 bg-warning-50 rounded-lg">
              <Typography level="h2" className="text-warning-600">
                {sql`pending_tasks`}
              </Typography>
              <Typography level="body-xs" className="text-tertiary">
                Pending
              </Typography>
            </div>
            <div className="text-center p-4 bg-danger-50 rounded-lg">
              <Typography level="h2" className="text-danger-600">
                {sql`overdue_tasks`}
              </Typography>
              <Typography level="body-xs" className="text-tertiary">
                Overdue
              </Typography>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex justify-between items-center mb-2">
              <Typography level="body-sm" className="text-tertiary">
                Completion Rate
              </Typography>
              <Typography level="body-sm" className="font-medium">
                {sql`case when total_tasks > 0 then cast(round(cast(completed_tasks as real) * 100.0 / cast(total_tasks as real), 0) as int) else 0 end`}%
              </Typography>
            </div>
            <div className="h-3 bg-neutral-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-success-500 rounded-full transition-all duration-500"
                style={{
                  width:
                    sql`case when total_tasks > 0 then cast(round(cast(completed_tasks as real) * 100.0 / cast(total_tasks as real), 0) as int) || '%' else '0%' end`,
                }}
              />
            </div>
          </div>

          <Show when={sql`high_priority_pending > 0`}>
            <div className="mt-4 p-3 bg-danger-50 rounded-lg flex items-center gap-3">
              <MaterialIcon icon="PriorityHigh" className="text-danger-500" />
              <div>
                <Typography
                  level="body-sm"
                  className="font-medium text-danger-700"
                >
                  {sql`high_priority_pending`}{" "}
                  high priority
                  task{sql`case when high_priority_pending > 1 then 's' else '' end`}
                  {" "}
                  pending
                </Typography>
              </div>
            </div>
          </Show>
        </Data>
      </div>
    </Card>
  );
}

interface StageDistributionCardProps {
  pipelineName: string;
  title?: string;
  showPercentage?: boolean;
  showCount?: boolean;
}

export function StageDistributionCard(props: StageDistributionCardProps) {
  const {
    pipelineName,
    title = "Stage Distribution",
    showPercentage = true,
    showCount = false,
  } = props;
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(pipelineName);

  if (!pipeline) {
    throw new Error(`Pipeline "${pipelineName}" not found`);
  }

  const itemsTable = block.pipelineItemsTableName;

  return (
    <Card variant="outlined">
      <CardHeader>
        <Typography startIcon="ViewKanban" level="title-md">
          {title}
        </Typography>
      </CardHeader>
      <div className="p-4">
        <Data
          procedure={(s) => {
            s.defScalar(
              "total",
              sql`(select count(*) from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(pipeline.name)})`,
            );

            pipeline.stages.forEach((stage) => {
              s.defScalar(
                `stage_${stage.name}_count`,
                sql`(select count(*) from db.${sql.ref(itemsTable)}
                    where pipeline_name = ${sql.lit(pipeline.name)}
                    and stage_name = ${sql.lit(stage.name)})`,
              );
            });
          }}
        >
          <div className="space-y-3">
            {pipeline.stages.map((stage) => {
              const countScalar = sql.ref(`stage_${stage.name}_count`);
              const percentage =
                sql`case when total > 0 then cast(round(cast(${countScalar} as real) * 100.0 / cast(total as real), 0) as int) else 0 end`;
              const stageColor = stage.color ?? "#3B82F6";
              const fillPct = sql`cast(case
                when ${percentage} >= 3 then ${percentage}
                when ${countScalar} > 0 then 3
                else 0
              end as string)`;

              return (
                <div className="flex items-center gap-3">
                  <div className="w-32 flex items-center gap-2">
                    {stage.icon && (
                      <MaterialIcon
                        icon={stage.icon}
                        style={{ color: stageColor }}
                        className="text-sm"
                      />
                    )}
                    <Typography level="body-sm">
                      {stage.displayName ?? toDisplayName(stage.name)}
                    </Typography>
                  </div>
                  <div
                    className="flex-1 h-7 rounded"
                    style={{
                      background: sql.concat(
                        sql
                          .lit`linear-gradient(to right, ${stageColor} 0%, ${stageColor} `,
                        fillPct,
                        sql.lit`%, #f3f4f6 `,
                        fillPct,
                        sql.lit`%, #f3f4f6 100%)`,
                      ),
                    }}
                  />
                  <Show when={sql`${showPercentage}`}>
                    <div className="w-16 text-right">
                      <Typography level="body-sm" className="font-medium">
                        {percentage}%
                      </Typography>
                    </div>
                  </Show>
                  <Show when={sql`${showCount}`}>
                    <div className="w-20 text-right">
                      <Typography level="body-sm" className="font-medium">
                        {countScalar}{" "}
                        {sql`case when ${countScalar} = 1 then 'deal' else 'deals' end`}
                      </Typography>
                    </div>
                  </Show>
                </div>
              );
            })}
          </div>
        </Data>
      </div>
    </Card>
  );
}

interface SalesDashboardProps {
  pipelineName: string;
  title?: string;
  showSummary?: boolean;
  showStageBreakdown?: boolean;
  showVelocity?: boolean;
  showTasks?: boolean;
  showPartners?: boolean;
  showActivity?: boolean;
  showEmails?: boolean;
}

/**
 * Configurable sales dashboard. Toggles which panels render via the
 * `show*` props (charts, tasks, partners, activity, emails). Drop into
 * a route to give sales managers a single landing view.
 */
export function SalesDashboard(props: SalesDashboardProps) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline) {
    throw new Error(`Pipeline "${props.pipelineName}" not found`);
  }

  const itemsTable = block.pipelineItemsTableName;
  const tasksTable = block.pipelineTasksTableName;
  const title = props.title ??
    `${pipeline.displayName ?? toDisplayName(pipeline.name)} Dashboard`;
  const hasOpportunityFields = !!pipeline.opportunityFields;
  const hasPartnerAttachment = pipeline.enablePartnerAttachment ?? false;

  const showSummary = props.showSummary ?? true;
  const showStageBreakdown = props.showStageBreakdown ?? true;
  const showVelocity = props.showVelocity ?? true;
  const showTasks = props.showTasks ?? true;
  const showPartners = props.showPartners ?? true;
  const showActivity = props.showActivity ?? true;
  const showEmails = props.showEmails ?? true;
  const hasEmailIntegrations = !!block.opts.emailIntegrations;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {pipeline.icon && (
          <MaterialIcon
            icon={pipeline.icon}
            className="text-2xl text-primary-500"
          />
        )}
        <Typography level="h4">{title}</Typography>
      </div>

      {showSummary && (
        <Data
          procedure={(s) => {
            s.defScalar(
              "total_deals",
              sql`(select count(*) from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(pipeline.name)})`,
            );

            s.defScalar(
              "deals_this_month",
              sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(pipeline.name)}
                and expected_close_date >= date_trunc('month', current_date())
                and expected_close_date < date_trunc('month', current_date()) + interval '1 month')`,
            );

            s.defScalar(
              "deals_this_quarter",
              sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(pipeline.name)}
                and expected_close_date >= date_trunc('quarter', current_date())
                and expected_close_date < date_trunc('quarter', current_date()) + interval '3 months')`,
            );

            s.defScalar(
              "new_deals_this_week",
              sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(pipeline.name)}
                and entered_pipeline_at >= current_date() - interval '7 days')`,
            );

            if (hasOpportunityFields) {
              s.defScalar(
                "total_pipeline_value",
                sql`coalesce((select sum(estimated_value) from db.${
                  sql.ref(itemsTable)
                }
                  where pipeline_name = ${
                  sql.lit(pipeline.name)
                } and estimated_value is not null), 0)`,
              );

              s.defScalar(
                "weighted_pipeline_value",
                sql`coalesce((select sum(estimated_value * coalesce(probability_pct, 50) / 100.0)
                  from db.${sql.ref(itemsTable)}
                  where pipeline_name = ${
                  sql.lit(pipeline.name)
                } and estimated_value is not null), 0)`,
              );

              s.defScalar(
                "avg_deal_size",
                sql`coalesce((select avg(estimated_value) from db.${
                  sql.ref(itemsTable)
                }
                  where pipeline_name = ${
                  sql.lit(pipeline.name)
                } and estimated_value is not null and estimated_value > 0), 0)`,
              );

              s.defScalar(
                "high_value_deals",
                sql`(select count(*) from db.${sql.ref(itemsTable)}
                  where pipeline_name = ${sql.lit(pipeline.name)}
                  and estimated_value > coalesce((select avg(estimated_value) from db.${
                  sql.ref(itemsTable)
                }
                    where pipeline_name = ${
                  sql.lit(pipeline.name)
                } and estimated_value is not null and estimated_value > 0), 0))`,
              );
            } else {
              s.defScalar("total_pipeline_value", sql`0`);
              s.defScalar("weighted_pipeline_value", sql`0`);
              s.defScalar("avg_deal_size", sql`0`);
              s.defScalar("high_value_deals", sql`0`);
            }
          }}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card variant="outlined" className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <MaterialIcon icon="Inbox" className="text-primary-500" />
                <Typography level="body-sm" className="text-tertiary">
                  Total Deals
                </Typography>
              </div>
              <Typography level="h2" color="primary">
                {sql`total_deals`}
              </Typography>
              <Typography level="body-xs" className="text-success-600">
                +{sql`new_deals_this_week`} this week
              </Typography>
            </Card>

            {hasOpportunityFields && (
              <>
                <Card variant="outlined" className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <MaterialIcon
                      icon="AttachMoney"
                      className="text-success-500"
                    />
                    <Typography level="body-sm" className="text-tertiary">
                      Pipeline Value
                    </Typography>
                  </div>
                  <Typography level="h2" className="text-success-600">
                    ${sql`format.decimal(total_pipeline_value)`}
                  </Typography>
                  <Typography level="body-xs" className="text-tertiary">
                    Weighted: ${sql`format.decimal(weighted_pipeline_value)`}
                  </Typography>
                </Card>

                <Card variant="outlined" className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <MaterialIcon
                      icon="ShowChart"
                      className="text-warning-500"
                    />
                    <Typography level="body-sm" className="text-tertiary">
                      Avg Deal Size
                    </Typography>
                  </div>
                  <Typography level="h2" className="text-warning-600">
                    ${sql`format.decimal(avg_deal_size)`}
                  </Typography>
                  <Typography level="body-xs" className="text-tertiary">
                    {sql`high_value_deals`} high-value deals
                  </Typography>
                </Card>
              </>
            )}

            <Card variant="outlined" className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <MaterialIcon icon="Event" className="text-primary-500" />
                <Typography level="body-sm" className="text-tertiary">
                  Closing This Month
                </Typography>
              </div>
              <Typography level="h2" color="primary">
                {sql`deals_this_month`}
              </Typography>
              <Typography level="body-xs" className="text-tertiary">
                {sql`deals_this_quarter`} this quarter
              </Typography>
            </Card>
          </div>
        </Data>
      )}

      {showStageBreakdown && (
        <Card variant="outlined">
          <div className="p-4">
            <Data
              procedure={(s) => {
                pipeline.stages.forEach((stage) => {
                  s.defScalar(
                    `stage_${stage.name}_count`,
                    sql`(select count(*) from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and stage_name = ${sql.lit(stage.name)})`,
                  );
                  if (hasOpportunityFields) {
                    s.defScalar(
                      `stage_${stage.name}_value`,
                      sql`coalesce((select sum(estimated_value) from db.${
                        sql.ref(itemsTable)
                      }
                        where pipeline_name = ${sql.lit(pipeline.name)}
                        and stage_name = ${sql.lit(stage.name)}
                        and estimated_value is not null), 0)`,
                    );
                  }
                });
              }}
            >
              <div className="flex items-stretch overflow-x-auto">
                {pipeline.stages.map((stage, index) => {
                  const countScalar = sql.ref(`stage_${stage.name}_count`);
                  const valueScalar = hasOpportunityFields
                    ? sql.ref(`stage_${stage.name}_value`)
                    : null;

                  return (
                    <div
                      className="flex-1 min-w-[120px] text-center py-2 px-4"
                      sx={index > 0
                        ? { borderLeft: "1px solid var(--palette-divider)" }
                        : {}}
                    >
                      <Typography
                        level="body-xs"
                        className="text-tertiary mb-1"
                      >
                        {stage.displayName ?? toDisplayName(stage.name)}
                      </Typography>
                      {valueScalar
                        ? (
                          <Typography
                            level="title-lg"
                            className="text-success-600 font-semibold"
                          >
                            ${sql`format.decimal(cast(round(${valueScalar}, 0) as bigint))`}
                          </Typography>
                        )
                        : (
                          <Typography
                            level="title-lg"
                            className="text-success-600 font-semibold"
                          >
                            {countScalar}
                          </Typography>
                        )}
                      <Typography
                        level="body-xs"
                        className="text-tertiary mt-1"
                      >
                        {countScalar}{" "}
                        {sql`case when ${countScalar} = 1 then 'deal' else 'deals' end`}
                      </Typography>
                    </div>
                  );
                })}
              </div>
            </Data>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {showVelocity && (
          <Card variant="outlined">
            <CardHeader>
              <Typography startIcon="Speed" level="title-md">
                Deal Velocity
              </Typography>
            </CardHeader>
            <div className="p-4">
              <Data
                procedure={(s) => {
                  s.defScalar(
                    "avg_days_in_pipeline",
                    sql`coalesce((select cast(avg(date.diff(day, cast(coalesce(entered_pipeline_at, created_at) as date), current_date())) as int)
                      from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and coalesce(entered_pipeline_at, created_at) > now() - interval '10 years'), 0)`,
                  );

                  s.defScalar(
                    "avg_days_in_stage",
                    sql`coalesce((select cast(avg(date.diff(day, cast(coalesce(entered_stage_at, created_at) as date), current_date())) as int)
                      from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and coalesce(entered_stage_at, created_at) > now() - interval '10 years'), 0)`,
                  );

                  s.defScalar(
                    "stalled_deals",
                    sql`(select count(*) from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and last_modified_at < now() - interval '14 days')`,
                  );

                  s.defScalar(
                    "overdue_deals",
                    sql`(select count(*) from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and expected_close_date < current_date()
                      and expected_close_date is not null)`,
                  );
                }}
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-level1 rounded-lg">
                    <div className="flex items-center gap-2">
                      <MaterialIcon
                        icon="HourglassEmpty"
                        className="text-primary-500"
                      />
                      <Typography level="body-sm">
                        Avg. Days in Pipeline
                      </Typography>
                    </div>
                    <Typography level="title-lg">
                      {sql`avg_days_in_pipeline`}
                    </Typography>
                  </div>

                  <div className="flex justify-between items-center p-3 bg-level1 rounded-lg">
                    <div className="flex items-center gap-2">
                      <MaterialIcon icon="Timer" className="text-primary-500" />
                      <Typography level="body-sm">
                        Avg. Days in Current Stage
                      </Typography>
                    </div>
                    <Typography level="title-lg">
                      {sql`avg_days_in_stage`}
                    </Typography>
                  </div>

                  <Show when={sql`stalled_deals > 0`}>
                    <div className="flex justify-between items-center p-3 bg-warning-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <MaterialIcon
                          icon="PauseCircle"
                          className="text-warning-600"
                        />
                        <Typography
                          level="body-sm"
                          className="text-warning-700"
                        >
                          Stalled Deals (14+ days)
                        </Typography>
                      </div>
                      <Chip color="warning" variant="soft">
                        {sql`stalled_deals`}
                      </Chip>
                    </div>
                  </Show>

                  <Show when={sql`overdue_deals > 0`}>
                    <div className="flex justify-between items-center p-3 bg-danger-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <MaterialIcon
                          icon="Warning"
                          className="text-danger-600"
                        />
                        <Typography level="body-sm" className="text-danger-700">
                          Past Expected Close
                        </Typography>
                      </div>
                      <Chip color="danger" variant="soft">
                        {sql`overdue_deals`}
                      </Chip>
                    </div>
                  </Show>
                </div>
              </Data>
            </div>
          </Card>
        )}

        {showTasks && block.hasPipelineTasksEnabled(pipeline.name) && (
          <>
            <Card variant="outlined">
              <CardHeader>
                <Typography startIcon="Task" level="title-md">
                  Task Performance
                </Typography>
              </CardHeader>
              <div className="p-4">
                <Data
                  procedure={(s) => {
                    s.defScalar(
                      "total_tasks",
                      sql`(select count(*) from db.${sql.ref(tasksTable)} t
                        join db.${
                        sql.ref(itemsTable)
                      } i on i.id = t.pipeline_item_id
                        where i.pipeline_name = ${sql.lit(pipeline.name)})`,
                    );
                    s.defScalar(
                      "completed_tasks",
                      sql`(select count(*) from db.${sql.ref(tasksTable)} t
                        join db.${
                        sql.ref(itemsTable)
                      } i on i.id = t.pipeline_item_id
                        where i.pipeline_name = ${
                        sql.lit(pipeline.name)
                      } and t.completed)`,
                    );
                    s.defScalar(
                      "overdue_tasks",
                      sql`(select count(*) from db.${sql.ref(tasksTable)} t
                        join db.${
                        sql.ref(itemsTable)
                      } i on i.id = t.pipeline_item_id
                        where i.pipeline_name = ${sql.lit(pipeline.name)}
                        and not t.completed and t.due_date < current_date())`,
                    );
                    s.defScalar(
                      "high_priority_tasks",
                      sql`(select count(*) from db.${sql.ref(tasksTable)} t
                        join db.${
                        sql.ref(itemsTable)
                      } i on i.id = t.pipeline_item_id
                        where i.pipeline_name = ${sql.lit(pipeline.name)}
                        and not t.completed and t.priority = 'high')`,
                    );
                    s.defScalar(
                      "completion_rate",
                      sql`case when total_tasks > 0
                      then cast(round(cast(completed_tasks as real) * 100.0 / cast(total_tasks as real), 0) as int)
                      else 0 end`,
                    );
                  }}
                >
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <Typography level="body-sm" className="text-tertiary">
                          Task Completion
                        </Typography>
                        <Typography level="body-sm" className="font-medium">
                          {sql`completion_rate`}%
                        </Typography>
                      </div>
                      <div className="h-3 bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-success-500 rounded-full transition-all duration-500"
                          style={{
                            width: sql`completion_rate || '%'`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-level1 rounded-lg text-center">
                        <Typography level="h3" color="primary">
                          {sql`completed_tasks`}
                        </Typography>
                        <Typography level="body-xs" className="text-tertiary">
                          Completed
                        </Typography>
                      </div>
                      <div className="p-3 bg-level1 rounded-lg text-center">
                        <Typography level="h3" className="text-warning-600">
                          {sql`total_tasks - completed_tasks`}
                        </Typography>
                        <Typography level="body-xs" className="text-tertiary">
                          Pending
                        </Typography>
                      </div>
                    </div>

                    <Show
                      when={sql`overdue_tasks > 0 or high_priority_tasks > 0`}
                    >
                      <div className="flex gap-2">
                        <Show when={sql`overdue_tasks > 0`}>
                          <Chip
                            color="danger"
                            variant="soft"
                            startDecorator={<MaterialIcon icon="Schedule" />}
                          >
                            {sql`overdue_tasks`} overdue
                          </Chip>
                        </Show>
                        <Show when={sql`high_priority_tasks > 0`}>
                          <Chip
                            color="warning"
                            variant="soft"
                            startDecorator={
                              <MaterialIcon icon="PriorityHigh" />
                            }
                          >
                            {sql`high_priority_tasks`} high priority
                          </Chip>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Data>
              </div>
            </Card>
          </>
        )}
      </div>

      {showPartners && hasPartnerAttachment && (
        <>
          <Card variant="outlined">
            <CardHeader>
              <Typography startIcon="Handshake" level="title-md">
                Partner Performance
              </Typography>
            </CardHeader>
            <div className="p-4">
              <Data
                procedure={(s) => {
                  s.defScalar(
                    "deals_with_partners",
                    sql`(select count(*) from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and partner_attached = true)`,
                  );
                  s.defScalar(
                    "deals_without_partners",
                    sql`(select count(*) from db.${sql.ref(itemsTable)}
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and (partner_attached = false or partner_attached is null))`,
                  );
                  if (hasOpportunityFields) {
                    s.defScalar(
                      "partner_deal_value",
                      sql`coalesce((select sum(estimated_value) from db.${
                        sql.ref(itemsTable)
                      }
                        where pipeline_name = ${sql.lit(pipeline.name)}
                        and partner_attached = true and estimated_value is not null), 0)`,
                    );
                  } else {
                    s.defScalar("partner_deal_value", sql`0`);
                  }
                  s.defScalar(
                    "total_partners",
                    sql`(select count(distinct partner_id) from db.${
                      sql.ref(itemsTable)
                    }
                      where pipeline_name = ${sql.lit(pipeline.name)}
                      and partner_id is not null)`,
                  );
                }}
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-primary-50 rounded-lg text-center">
                    <Typography level="h2" color="primary">
                      {sql`deals_with_partners`}
                    </Typography>
                    <Typography level="body-xs" className="text-tertiary">
                      Partner Deals
                    </Typography>
                  </div>
                  <div className="p-4 bg-neutral-100 rounded-lg text-center">
                    <Typography level="h2">
                      {sql`deals_without_partners`}
                    </Typography>
                    <Typography level="body-xs" className="text-tertiary">
                      Direct Deals
                    </Typography>
                  </div>
                  {hasOpportunityFields && (
                    <>
                      <div className="p-4 bg-success-50 rounded-lg text-center">
                        <Typography level="h3" className="text-success-600">
                          ${sql`round(partner_deal_value)`}
                        </Typography>
                        <Typography level="body-xs" className="text-tertiary">
                          Partner Value
                        </Typography>
                      </div>
                    </>
                  )}
                  <div className="p-4 bg-level1 rounded-lg text-center">
                    <Typography level="h2">{sql`total_partners`}</Typography>
                    <Typography level="body-xs" className="text-tertiary">
                      Active Partners
                    </Typography>
                  </div>
                </div>
              </Data>
            </div>
          </Card>
        </>
      )}

      {(showActivity || (showEmails && hasEmailIntegrations)) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {showActivity && block.hasPipelineActivityLogEnabled(pipeline.name) &&
            (
              <>
                <Card variant="outlined">
                  <CardHeader>
                    <Typography startIcon="History" level="title-md">
                      Recent Pipeline Activity
                    </Typography>
                  </CardHeader>
                  <div className="p-4">
                    <RecentActivityList
                      block={block}
                      pipelineName={pipeline.name}
                      limit={10}
                    />
                  </div>
                </Card>
              </>
            )}

          {showEmails && hasEmailIntegrations && (
            <Card variant="outlined">
              <CardHeader>
                <Typography startIcon="Email" level="title-md">
                  Recent Emails
                </Typography>
              </CardHeader>
              <div className="p-4">
                <Data
                  procedure={(s) => {
                    s.defTable(
                      "recent_emails",
                      sql`select id, subject, snippet, "from", from_email, date, is_read
                        from db.user_all_emails
                        order by date desc
                        limit 10`,
                    );
                  }}
                >
                  <Show
                    when={sql`(select count(*) from recent_emails) > 0`}
                    fallback={
                      <Typography
                        level="body-sm"
                        className="text-tertiary text-center py-4"
                      >
                        No emails yet
                      </Typography>
                    }
                  >
                    <div className="space-y-1">
                      <Each table="recent_emails" recordName="email">
                        <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-level1">
                          <Show when={sql`not email.is_read`}>
                            <div className="w-2 h-2 mt-2 rounded-full bg-primary-500 shrink-0" />
                          </Show>
                          <Show when={sql`email.is_read`}>
                            <div className="w-2 h-2 mt-2 rounded-full bg-transparent shrink-0" />
                          </Show>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <Show when={sql`not email.is_read`}>
                                <Typography
                                  level="body-sm"
                                  className="font-semibold truncate"
                                >
                                  {sql`coalesce(email."from", email.from_email, 'Unknown')`}
                                </Typography>
                              </Show>
                              <Show when={sql`email.is_read`}>
                                <Typography
                                  level="body-sm"
                                  className="truncate text-tertiary"
                                >
                                  {sql`coalesce(email."from", email.from_email, 'Unknown')`}
                                </Typography>
                              </Show>
                              <Typography
                                level="body-xs"
                                className="text-tertiary shrink-0"
                              >
                                {sql`case
                                  when cast(email.date as date) = current_date()
                                  then format.date(email.date, '%H:%M')
                                  else format.date(cast(email.date as date), '%b %d')
                                end`}
                              </Typography>
                            </div>
                            <Show when={sql`not email.is_read`}>
                              <Typography
                                level="body-xs"
                                className="font-medium truncate"
                              >
                                {sql`coalesce(email.subject, '(no subject)')`}
                              </Typography>
                            </Show>
                            <Show when={sql`email.is_read`}>
                              <Typography
                                level="body-xs"
                                className="truncate text-tertiary"
                              >
                                {sql`coalesce(email.subject, '(no subject)')`}
                              </Typography>
                            </Show>
                            <Typography
                              level="body-xs"
                              className="text-tertiary truncate"
                            >
                              {sql`coalesce(email.snippet, '')`}
                            </Typography>
                          </div>
                        </div>
                      </Each>
                    </div>
                  </Show>
                </Data>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

interface QualificationScoreDistributionProps {
  pipelineName: string;
  title?: string;
}

/**
 * Histogram of qualification scores across items in `pipelineName`. Use
 * inside a dashboard or report to surface where the bulk of unqualified
 * leads sit.
 */
export function QualificationScoreDistribution(
  props: QualificationScoreDistributionProps,
) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline) {
    throw new Error(`Pipeline "${props.pipelineName}" not found`);
  }

  if (!pipeline.opportunityFields?.qualification) {
    return null;
  }

  const itemsTable = block.pipelineItemsTableName;
  const organizationsTable = block.organizationsTableName;
  const peopleTable = block.peopleTableName;
  const title = props.title ?? "Qualification Score Distribution";

  const scoreRanges = [
    {
      min: 0,
      max: 20,
      label: "0-20",
      color: "#EF4444",
      description: "Needs Work",
    },
    {
      min: 21,
      max: 40,
      label: "21-40",
      color: "#F97316",
      description: "Early Stage",
    },
    {
      min: 41,
      max: 60,
      label: "41-60",
      color: "#F59E0B",
      description: "Developing",
    },
    {
      min: 61,
      max: 80,
      label: "61-80",
      color: "#84CC16",
      description: "Strong",
    },
    {
      min: 81,
      max: 100,
      label: "81-100",
      color: "#22C55E",
      description: "Excellent",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MaterialIcon icon="Assessment" className="text-2xl text-primary-500" />
        <Typography level="h4">{title}</Typography>
      </div>

      <Data
        procedure={(s) => {
          s.defScalar(
            "total_scored",
            sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(pipeline.name)}
                and business_case_score is not null)`,
          );
          s.defScalar(
            "total_unscored",
            sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(pipeline.name)}
                and business_case_score is null)`,
          );
          s.defScalar(
            "avg_score",
            sql`coalesce((select avg(business_case_score) from db.${
              sql.ref(itemsTable)
            }
                where pipeline_name = ${sql.lit(pipeline.name)}
                and business_case_score is not null), 0)`,
          );
          s.defScalar(
            "min_score",
            sql`coalesce((select min(business_case_score) from db.${
              sql.ref(itemsTable)
            }
                where pipeline_name = ${sql.lit(pipeline.name)}
                and business_case_score is not null), 0)`,
          );
          s.defScalar(
            "max_score",
            sql`coalesce((select max(business_case_score) from db.${
              sql.ref(itemsTable)
            }
                where pipeline_name = ${sql.lit(pipeline.name)}
                and business_case_score is not null), 0)`,
          );

          scoreRanges.forEach((range) => {
            s.defScalar(
              `range_${range.min}_${range.max}`,
              sql`(select count(*) from db.${sql.ref(itemsTable)}
                  where pipeline_name = ${sql.lit(pipeline.name)}
                  and business_case_score is not null
                  and business_case_score >= ${range.min}
                  and business_case_score <= ${range.max})`,
            );
          });

          s.defTable(
            "low_score_items",
            sql`
              select
                i.id,
                i.opportunity_name,
                i.business_case_score,
                i.stage_name,
                i.estimated_value,
                case
                  when i.entity_type = 'organization' then ${
              system.db.tables[organizationsTable]
                ? sql`o.name`
                : sql`cast(null as string)`
            }
                  else concat(p.first_name, ' ', p.last_name)
                end as entity_name
              from db.${sql.ref(itemsTable)} i
              ${
              system.db.tables[organizationsTable]
                ? sql`left join db.${
                  sql.ref(organizationsTable)
                } o on o.id = i.organization_id`
                : sql``
            }
              left join db.${sql.ref(peopleTable)} p on p.id = i.person_id
              where i.pipeline_name = ${sql.lit(pipeline.name)}
                and i.business_case_score is not null
                and i.business_case_score < 40
              order by i.business_case_score asc
              limit 10
            `,
          );

          s.defTable(
            "high_score_items",
            sql`
              select
                i.id,
                i.opportunity_name,
                i.business_case_score,
                i.stage_name,
                i.estimated_value,
                case
                  when i.entity_type = 'organization' then ${
              system.db.tables[organizationsTable]
                ? sql`o.name`
                : sql`cast(null as string)`
            }
                  else concat(p.first_name, ' ', p.last_name)
                end as entity_name
              from db.${sql.ref(itemsTable)} i
              ${
              system.db.tables[organizationsTable]
                ? sql`left join db.${
                  sql.ref(organizationsTable)
                } o on o.id = i.organization_id`
                : sql``
            }
              left join db.${sql.ref(peopleTable)} p on p.id = i.person_id
              where i.pipeline_name = ${sql.lit(pipeline.name)}
                and i.business_case_score is not null
                and i.business_case_score >= 80
              order by i.business_case_score desc
              limit 10
            `,
          );
        }}
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card variant="outlined" className="p-4 text-center">
            <Typography level="body-xs" className="text-tertiary">
              Total Scored
            </Typography>
            <Typography level="h2" color="primary">
              {sql`total_scored`}
            </Typography>
          </Card>
          <Card variant="outlined" className="p-4 text-center">
            <Typography level="body-xs" className="text-tertiary">
              Unscored
            </Typography>
            <Typography level="h2" className="text-warning-600">
              {sql`total_unscored`}
            </Typography>
          </Card>
          <Card variant="outlined" className="p-4 text-center">
            <Typography level="body-xs" className="text-tertiary">
              Average Score
            </Typography>
            <Typography level="h2" className="text-primary-600">
              {sql`cast(round(avg_score, 0) as int)`}
            </Typography>
          </Card>
          <Card variant="outlined" className="p-4 text-center">
            <Typography level="body-xs" className="text-tertiary">
              Min Score
            </Typography>
            <Typography level="h2" className="text-danger-600">
              {sql`min_score`}
            </Typography>
          </Card>
          <Card variant="outlined" className="p-4 text-center">
            <Typography level="body-xs" className="text-tertiary">
              Max Score
            </Typography>
            <Typography level="h2" className="text-success-600">
              {sql`max_score`}
            </Typography>
          </Card>
        </div>

        <Card variant="outlined">
          <CardHeader>
            <Typography startIcon="BarChart" level="title-md">
              Score Distribution
            </Typography>
          </CardHeader>
          <div className="p-4">
            <div className="space-y-3">
              {scoreRanges.map((range) => {
                const countScalar = sql.ref(`range_${range.min}_${range.max}`);
                const percentage = sql`case when total_scored > 0
                  then cast(round(cast(${countScalar} as real) * 100.0 / cast(total_scored as real), 0) as int)
                  else 0 end`;
                const fillPct = sql`cast(case
                  when ${percentage} >= 3 then ${percentage}
                  when ${countScalar} > 0 then 3
                  else 0
                end as string)`;

                return (
                  <div className="flex items-center gap-3">
                    <div className="w-12 text-right">
                      <Typography level="body-xs" className="font-medium">
                        {range.label}
                      </Typography>
                    </div>
                    <div className="w-24">
                      <Typography level="body-xs" className="text-tertiary">
                        {range.description}
                      </Typography>
                    </div>
                    <div
                      className="flex-1 h-7 rounded"
                      style={{
                        background: sql.concat(
                          sql
                            .lit`linear-gradient(to right, ${range.color} 0%, ${range.color} `,
                          fillPct,
                          sql.lit`%, #f3f4f6 `,
                          fillPct,
                          sql.lit`%, #f3f4f6 100%)`,
                        ),
                      }}
                    />
                    <div className="w-16 text-right">
                      <Typography level="body-sm" className="font-medium">
                        {percentage}%
                      </Typography>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MaterialIcon icon="Warning" className="text-danger-500" />
              <Typography level="title-md">
                Needs Attention (Score &lt; 40)
              </Typography>
            </div>
          </CardHeader>
          <div className="p-4">
            <Show
              when={sql`(select count(*) from low_score_items) > 0`}
              fallback={
                <Typography
                  level="body-sm"
                  className="text-tertiary text-center py-4"
                >
                  No low-scoring items - great job!
                </Typography>
              }
            >
              <div className="space-y-2">
                <Each table="low_score_items" recordName="item">
                  <div className="flex items-center justify-between p-3 bg-danger-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white"
                        style={{
                          backgroundColor: sql`case
                            when item.business_case_score <= 20 then '#EF4444'
                            else '#F97316'
                          end`,
                        }}
                      >
                        {sql`item.business_case_score`}
                      </div>
                      <div>
                        <Typography level="body-sm" className="font-medium">
                          {sql`coalesce(item.opportunity_name, item.entity_name)`}
                        </Typography>
                        <Typography level="body-xs" className="text-tertiary">
                          {sql`string.capitalize(replace(item.stage_name, '_', ' '))`}
                          <Show when={sql`item.estimated_value is not null`}>
                            {" · $"}
                            {sql`format.decimal(item.estimated_value)`}
                          </Show>
                        </Typography>
                      </div>
                    </div>
                    <MaterialIcon
                      icon="ChevronRight"
                      className="text-neutral-400"
                    />
                  </div>
                </Each>
              </div>
            </Show>
          </div>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MaterialIcon icon="EmojiEvents" className="text-success-500" />
              <Typography level="title-md">
                Top Performers (Score ≥ 80)
              </Typography>
            </div>
          </CardHeader>
          <div className="p-4">
            <Show
              when={sql`(select count(*) from high_score_items) > 0`}
              fallback={
                <Typography
                  level="body-sm"
                  className="text-tertiary text-center py-4"
                >
                  No high-scoring items yet
                </Typography>
              }
            >
              <div className="space-y-2">
                <Each table="high_score_items" recordName="item">
                  <div className="flex items-center justify-between p-3 bg-success-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white"
                        style={{
                          backgroundColor: sql`case
                            when item.business_case_score >= 90 then '#22C55E'
                            else '#84CC16'
                          end`,
                        }}
                      >
                        {sql`item.business_case_score`}
                      </div>
                      <div>
                        <Typography level="body-sm" className="font-medium">
                          {sql`coalesce(item.opportunity_name, item.entity_name)`}
                        </Typography>
                        <Typography level="body-xs" className="text-tertiary">
                          {sql`string.capitalize(replace(item.stage_name, '_', ' '))`}
                          <Show when={sql`item.estimated_value is not null`}>
                            {" · $"}
                            {sql`format.decimal(item.estimated_value)`}
                          </Show>
                        </Typography>
                      </div>
                    </div>
                    <MaterialIcon
                      icon="ChevronRight"
                      className="text-neutral-400"
                    />
                  </div>
                </Each>
              </div>
            </Show>
          </div>
        </Card>
      </Data>
    </div>
  );
}
