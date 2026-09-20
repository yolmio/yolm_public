import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import { CrmBlock } from "../index";
import type { IconName } from "components/material_icon_names";
import { StageDistributionCard } from "./reports";

interface StatCardProps {
  title: string;
  value: Sql;
  icon: IconName;
  color?: "primary" | "success" | "warning" | "danger" | "neutral";
  subtitle?: Sql;
}

function StatCard(props: StatCardProps) {
  const colorStyles = {
    primary: {
      bg: "bg-primary-50",
      text: "text-primary-600",
      icon: "text-primary-500",
    },
    success: {
      bg: "bg-success-50",
      text: "text-success-600",
      icon: "text-success-500",
    },
    warning: {
      bg: "bg-warning-50",
      text: "text-warning-600",
      icon: "text-warning-500",
    },
    danger: {
      bg: "bg-danger-50",
      text: "text-danger-600",
      icon: "text-danger-500",
    },
    neutral: {
      bg: "bg-neutral-50",
      text: "text-neutral-600",
      icon: "text-neutral-500",
    },
  };

  const color = props.color ?? "primary";
  const styles = colorStyles[color];

  return (
    <Card variant="outlined" className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <Typography level="body-xs" className="text-tertiary mb-1">
            {props.title}
          </Typography>
          <Typography level="h3" className={styles.text}>
            {props.value}
          </Typography>
          {props.subtitle
            ? (
              <Typography level="body-xs" className="text-tertiary mt-1">
                {props.subtitle}
              </Typography>
            )
            : null}
        </div>
        <div className={`p-2 rounded-lg ${styles.bg}`}>
          <MaterialIcon
            icon={props.icon}
            className={`text-xl ${styles.icon}`}
          />
        </div>
      </div>
    </Card>
  );
}

interface ScorecardItem {
  label: string;
  score: NumericExpr;
  thresholds?: { red: number; yellow: number };
}

interface RYGScorecardsProps {
  items: ScorecardItem[];
}

/**
 * Red/Yellow/Green health scorecards for a list of items. Each item's
 * `score` is bucketed against the (configurable) thresholds and rendered
 * as a colored chip. Useful in customer-success dashboards.
 */
export function RYGScorecards(props: RYGScorecardsProps) {
  return (
    <Card variant="outlined" className="p-4">
      <CardHeader>
        <MaterialIcon icon="Assessment" className="mr-2" />
        Health Scorecards
      </CardHeader>
      <div className="grid grid-cols-3 gap-4 mt-4">
        {props.items.map((item) => {
          const redThreshold = item.thresholds?.red ?? 40;
          const yellowThreshold = item.thresholds?.yellow ?? 70;

          return (
            <div className="text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2"
                style={{
                  backgroundColor: sql`case
                    when ${item.score} is null then '#6B728020'
                    when ${item.score} < ${redThreshold} then '#EF444430'
                    when ${item.score} < ${yellowThreshold} then '#F59E0B30'
                    else '#10B98130'
                  end`,
                }}
              >
                <Typography
                  level="title-lg"
                  style={{
                    color: sql`case
                      when ${item.score} is null then '#6B7280'
                      when ${item.score} < ${redThreshold} then '#EF4444'
                      when ${item.score} < ${yellowThreshold} then '#F59E0B'
                      else '#10B981'
                    end`,
                  }}
                >
                  {sql`coalesce(cast(${item.score} as string), '-')`}
                </Typography>
              </div>
              <Typography level="body-sm" className="text-tertiary">
                {item.label}
              </Typography>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

interface AdoptionValueDashboardProps {
  pipelineName: string;
  /** Stage that represents first delivered value for this process. */
  valueStage: string;
  /** Boolean stage field that records whether the customer's KPIs were achieved. */
  kpiAchievement: { stageName: string; fieldName: string };
  /** Optional project phase to count, using the configured phase label. */
  projectPhase?: string;
  title?: string;
}

/**
 * Adoption / value dashboard for a CRM pipeline. Surfaces feature
 * adoption, time-to-value, and value-realized signals as charts and
 * KPIs. Used in customer-success post-sale flows.
 */
export function AdoptionValueDashboard(props: AdoptionValueDashboardProps) {
  const block = system.block(CrmBlock);
  const hasProjects = block.hasProjectsEnabled();
  const hasSuccessPlans = block.hasSuccessPlansEnabled();
  const hasAdoption = block.hasAdoptionTrackingEnabled();
  const pipeline = block.getPipeline(props.pipelineName);
  if (!pipeline?.stages.some((stage) => stage.name === props.valueStage)) {
    throw new Error(
      "AdoptionValue requires a valueStage in the configured pipeline.",
    );
  }
  if (
    !block.getPipelineStageFields(
      props.pipelineName,
      props.kpiAchievement.stageName,
    ).some((field) =>
      field.name === props.kpiAchievement.fieldName && field.type === "bool"
    )
  ) {
    throw new Error(
      "AdoptionValue kpiAchievement must reference a configured boolean stage field.",
    );
  }
  const projectPhase = hasProjects && props.projectPhase
    ? block.projectPhases.find((phase) => phase.name === props.projectPhase)
    : undefined;
  if (hasProjects && props.projectPhase && !projectPhase) {
    throw new Error(
      "AdoptionValue projectPhase is not a configured project phase.",
    );
  }

  const projectsTable = block.projectsTableName;
  const successPlansTable = block.successPlansTableName;
  const itemsTable = block.pipelineItemsTableName;
  const stageDataTable = block.pipelineStageDataTableName;
  const orgsTable = block.organizationsTableName;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MaterialIcon icon="TrendingUp" className="text-2xl text-primary-500" />
        <Typography level="h3">
          {props.title ?? "Adoption & Value Metrics"}
        </Typography>
      </div>

      <Data
        procedure={(s) => {
          if (hasAdoption) {
            s.defScalar(
              "avg_adoption_score",
              sql`(select avg(adoption_score) from db.${
                sql.ref(projectsTable)
              } where adoption_score is not null and pipeline_item_id in (select id from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(props.pipelineName)}))`,
            );
          } else {
            s.defScalar("avg_adoption_score", sql`cast(null as decimal)`);
          }
          if (hasProjects) {
            s.defScalar(
              "projects_count",
              sql`(select count(*) from db.${
                sql.ref(projectsTable)
              } where pipeline_item_id in (select id from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(props.pipelineName)}))`,
            );
            s.defScalar(
              "projects_in_phase",
              projectPhase
                ? sql`(select count(*) from db.${
                  sql.ref(projectsTable)
                } where phase = ${
                  sql.lit(projectPhase.name)
                } and pipeline_item_id in (select id from db.${
                  sql.ref(itemsTable)
                } where pipeline_name = ${sql.lit(props.pipelineName)}))`
                : sql`0`,
            );
          } else {
            s.defScalar("projects_count", sql`0`);
            s.defScalar("projects_in_phase", sql`0`);
          }

          if (hasSuccessPlans) {
            s.defScalar(
              "avg_health_score",
              sql`(select avg(health_score) from db.${
                sql.ref(successPlansTable)
              } where health_score is not null and pipeline_item_id in (select id from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(props.pipelineName)}))`,
            );
            s.defScalar(
              "renewals_upcoming",
              sql`(select count(*) from db.${
                sql.ref(successPlansTable)
              } where renewal_date between current_date() and current_date() + interval '${block.renewalUpcomingDays} day' and pipeline_item_id in (select id from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(props.pipelineName)}))`,
            );
            s.defScalar(
              "renewals_overdue",
              sql`(select count(*) from db.${
                sql.ref(successPlansTable)
              } where renewal_date < current_date() and pipeline_item_id in (select id from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(props.pipelineName)}))`,
            );
          } else {
            s.defScalar("avg_health_score", sql`cast(null as decimal)`);
            s.defScalar("renewals_upcoming", sql`0`);
            s.defScalar("renewals_overdue", sql`0`);
          }

          s.defScalar(
            "kpi_achievement_rate",
            sql`(
              select coalesce(
                cast(sum(case when sd.bool_value = true then 1 else 0 end) * 100.0 / nullif(count(*), 0) as int),
                0
              )
              from db.${sql.ref(itemsTable)} i
              join db.${
              sql.ref(stageDataTable)
            } sd on sd.pipeline_item_id = i.id
              where i.pipeline_name = ${sql.lit(props.pipelineName)}
                and sd.stage_name = ${sql.lit(props.kpiAchievement.stageName)}
                and sd.field_name = ${sql.lit(props.kpiAchievement.fieldName)}
            )`,
          );

          s.defScalar(
            "avg_time_to_value",
            sql`(
              select coalesce(cast(avg(date.diff(day, i.entered_pipeline_at, i.entered_stage_at)) as int), 0)
              from db.${sql.ref(itemsTable)} i
              where i.pipeline_name = ${sql.lit(props.pipelineName)}
                and i.stage_name = ${sql.lit(props.valueStage)}
            )`,
          );

          if (hasAdoption) {
            s.defTable(
              "adoption_by_customer",
              sql`
                select
                  o.name as organization_name,
                  p.adoption_score
                from db.${sql.ref(projectsTable)} p
                join db.${sql.ref(orgsTable)} o on o.id = p.organization_id
                where p.adoption_score is not null
                  and p.pipeline_item_id in (select id from db.${
                sql.ref(itemsTable)
              } where pipeline_name = ${sql.lit(props.pipelineName)})
                order by p.adoption_score desc
                limit 10
              `,
            );
          }
        }}
      >
        <div className="grid grid-cols-4 gap-4">
          {hasAdoption && (
            <StatCard
              title="Avg Adoption Score"
              value={sql`coalesce(cast(round(avg_adoption_score, 0) as string) || '%', '-')`}
              icon="Speed"
              color="primary"
            />
          )}
          {hasSuccessPlans && (
            <StatCard
              title="Avg Health Score"
              value={sql`coalesce(cast(round(avg_health_score, 0) as string) || '%', '-')`}
              icon="Favorite"
              color="success"
            />
          )}
          <StatCard
            title="KPI Achievement Rate"
            value={sql`cast(kpi_achievement_rate as string) || '%'`}
            icon="CheckCircle"
            color="success"
          />
          <StatCard
            title="Avg Time-to-Value"
            value={sql`cast(avg_time_to_value as string) || ' days'`}
            icon="Schedule"
            color="neutral"
          />
        </div>

        <div className="grid grid-cols-4 gap-4">
          {hasProjects && (
            <StatCard
              title="Active Projects"
              value={sql`cast(projects_count as string)`}
              icon="Folder"
              color="primary"
            />
          )}
          {projectPhase && (
            <StatCard
              title={`In ${projectPhase.displayName ?? projectPhase.name}`}
              value={sql`cast(projects_in_phase as string)`}
              icon="SupportAgent"
              color="success"
            />
          )}
          {hasSuccessPlans && (
            <StatCard
              title="Upcoming Renewals"
              value={sql`cast(renewals_upcoming as string)`}
              icon="Event"
              color="warning"
            />
          )}
          {hasSuccessPlans && (
            <StatCard
              title="Overdue Renewals"
              value={sql`cast(renewals_overdue as string)`}
              icon="Warning"
              color="danger"
            />
          )}
        </div>

        <RYGScorecards
          items={[
            ...(hasAdoption
              ? [{ label: "Adoption", score: sql`avg_adoption_score` }]
              : []),
            ...(hasSuccessPlans
              ? [{
                label: "Health",
                score: sql`avg_health_score`,
                thresholds: hasSuccessPlans
                  ? {
                    red: block.healthScoreThresholds.warning,
                    yellow: block.healthScoreThresholds.good,
                  }
                  : undefined,
              }]
              : []),
            { label: "KPI Achievement", score: sql`kpi_achievement_rate` },
          ]}
        />

        {hasAdoption && (
          <Card variant="outlined" className="p-4">
            <CardHeader>
              <MaterialIcon icon="BarChart" className="mr-2" />
              Adoption Score by Customer
            </CardHeader>
            <div className="mt-4 space-y-3">
              <Each table="adoption_by_customer" recordName="row">
                <div className="flex items-center gap-3">
                  <Typography
                    level="body-sm"
                    className="w-48 truncate font-medium"
                  >
                    {sql`row.organization_name`}
                  </Typography>
                  <div
                    className="flex-1 h-6 rounded-full"
                    style={{
                      background: sql`
                        'linear-gradient(to right, ' ||
                        case
                          when row.adoption_score >= 70 then '#10B981 0%, #10B981 '
                          when row.adoption_score >= 40 then '#F59E0B 0%, #F59E0B '
                          else '#EF4444 0%, #EF4444 '
                        end ||
                        cast(row.adoption_score as string) || '%, #f3f4f6 ' ||
                        cast(row.adoption_score as string) || '%, #f3f4f6 100%)'
                      `,
                    }}
                  />
                  <Typography
                    level="body-sm"
                    className="w-12 text-right font-medium"
                  >
                    {sql`cast(row.adoption_score as string) || '%'`}
                  </Typography>
                </div>
              </Each>
            </div>
          </Card>
        )}
      </Data>
    </div>
  );
}

interface OperatingRhythmDashboardProps {
  pipelineName: string;
  title?: string;
}

/**
 * Operating-rhythm dashboard tracking touchpoint cadence and meeting
 * coverage across accounts in a CRM pipeline. Highlights accounts that
 * are behind on the configured cadence.
 */
export function OperatingRhythmDashboard(props: OperatingRhythmDashboardProps) {
  const block = system.block(CrmBlock);
  const itemsTable = block.pipelineItemsTableName;
  const tasksTable = block.pipelineTasksTableName;
  const activityLogTable = block.pipelineActivityLogTableName;
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline) return null;

  const hasPartnerAttachment = pipeline.enablePartnerAttachment;
  const hasTasks = block.hasPipelineTasksEnabled(pipeline.name);
  const hasActivityLog = block.hasPipelineActivityLogEnabled(pipeline.name);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MaterialIcon icon="Dashboard" className="text-2xl text-primary-500" />
        <Typography level="h3">{props.title ?? "Operating Rhythm"}</Typography>
      </div>

      <Data
        procedure={(s) => {
          if (hasActivityLog) {
            s.defScalar(
              "deals_moved_this_week",
              sql`(
              select count(distinct pipeline_item_id)
              from db.${sql.ref(activityLogTable)} activity
              join db.${sql.ref(itemsTable)} item
                on item.id = activity.pipeline_item_id
              where activity.activity_type = 'stage_changed'
                and activity.created_at >= current_date() - interval '7 day'
                and item.pipeline_name = ${sql.lit(props.pipelineName)}
            )`,
            );
          }

          if (hasPartnerAttachment) {
            s.defScalar(
              "partner_attach_pct",
              sql`(
                select coalesce(
                  cast(sum(case when partner_attached then 1 else 0 end) * 100.0 / nullif(count(*), 0) as int),
                  0
                )
                from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(props.pipelineName)}
              )`,
            );
          }

          const finalStage = pipeline.stages[pipeline.stages.length - 1];
          s.defScalar(
            "win_rate",
            sql`(
              select coalesce(
                cast(sum(case when stage_name = ${
              sql.lit(finalStage.name)
            } then 1 else 0 end) * 100.0 / nullif(count(*), 0) as int),
                0
              )
              from db.${sql.ref(itemsTable)}
              where pipeline_name = ${sql.lit(props.pipelineName)}
            )`,
          );

          s.defScalar(
            "avg_cycle_days",
            sql`(
              select coalesce(cast(avg(date.diff(day, entered_pipeline_at, last_modified_at)) as int), 0)
              from db.${sql.ref(itemsTable)}
              where pipeline_name = ${sql.lit(props.pipelineName)}
                and stage_name = ${sql.lit(finalStage.name)}
            )`,
          );

          if (hasTasks) {
            s.defScalar(
              "task_completion_rate",
              sql`(
              select coalesce(
                cast(sum(case when completed then 1 else 0 end) * 100.0 / nullif(count(*), 0) as int),
                0
              )
              from db.${sql.ref(tasksTable)} t
              join db.${sql.ref(itemsTable)} i on i.id = t.pipeline_item_id
              where i.pipeline_name = ${sql.lit(props.pipelineName)}
            )`,
            );
          }

          s.defScalar(
            "pipeline_health",
            sql`(
              select coalesce(
                cast(sum(case when last_modified_at >= current_date() - interval '14 day' then 1 else 0 end) * 100.0 / nullif(count(*), 0) as int),
                0
              )
              from db.${sql.ref(itemsTable)}
              where pipeline_name = ${sql.lit(props.pipelineName)}
            )`,
          );

          if (hasActivityLog) {
            s.defTable(
              "recent_activity",
              sql`
              select
                cast(al.created_at as date) as activity_date,
                count(*) as activity_count
              from db.${sql.ref(activityLogTable)} al
              join db.${sql.ref(itemsTable)} i on i.id = al.pipeline_item_id
              where i.pipeline_name = ${sql.lit(props.pipelineName)}
                and al.created_at >= current_date() - interval '7 day'
              group by cast(al.created_at as date)
              order by activity_date desc
            `,
            );
          }
        }}
      >
        <div className="grid grid-cols-4 gap-4">
          {hasActivityLog && (
            <StatCard
              title="Deals Moved This Week"
              value={sql`cast(deals_moved_this_week as string)`}
              icon="SwapHoriz"
              color="primary"
            />
          )}
          {hasPartnerAttachment && (
            <StatCard
              title="Partner Attach %"
              value={sql`cast(partner_attach_pct as string) || '%'`}
              icon="Handshake"
              color="neutral"
            />
          )}
          <StatCard
            title="Win Rate"
            value={sql`cast(win_rate as string) || '%'`}
            icon="EmojiEvents"
            color="success"
          />
          <StatCard
            title="Avg Cycle Time"
            value={sql`cast(avg_cycle_days as string) || ' days'`}
            icon="Timer"
            color="neutral"
          />
        </div>

        <RYGScorecards
          items={[
            { label: "Pipeline Health", score: sql`pipeline_health` },
            ...(hasTasks
              ? [{ label: "Task Completion", score: sql`task_completion_rate` }]
              : []),
            ...(hasPartnerAttachment
              ? [{
                label: "Partner Coverage",
                score: sql`partner_attach_pct`,
                thresholds: { red: 25, yellow: 50 },
              }]
              : []),
          ]}
        />

        <StageDistributionCard
          pipelineName={props.pipelineName}
          title="Pipeline Stage Distribution"
          showPercentage={false}
          showCount
        />

        {hasActivityLog && (
          <Card variant="outlined" className="p-4">
            <CardHeader>
              <MaterialIcon icon="History" className="mr-2" />
              Activity This Week
            </CardHeader>
            <div className="mt-4">
              <div className="flex items-end gap-2 h-32">
                <Each table="recent_activity" recordName="day">
                  <div className="flex-1 flex flex-col items-center">
                    <div
                      className="w-full bg-primary-500 rounded-t"
                      style={{
                        height:
                          sql`cast(least(day.activity_count * 10, 100) as string) || '%'`,
                        minHeight: "4px",
                      }}
                    />
                    <Typography level="body-xs" className="mt-1 text-tertiary">
                      {sql`format.date(day.activity_date, '%a')`}
                    </Typography>
                  </div>
                </Each>
              </div>
            </div>
          </Card>
        )}
      </Data>
    </div>
  );
}

interface PartnerMetricsDashboardProps {
  pipelineName: string;
  title?: string;
}

/**
 * Partner / channel metrics dashboard. Aggregates pipeline performance
 * by partner so partner managers can spot drop-off and concentration
 * risk.
 */
export function PartnerMetricsDashboard(props: PartnerMetricsDashboardProps) {
  const block = system.block(CrmBlock);
  const itemsTable = block.pipelineItemsTableName;
  const pipeline = block.getPipeline(props.pipelineName);

  if (
    !pipeline || !pipeline.enablePartnerAttachment ||
    !block.opts.partners?.program
  ) {
    return null;
  }

  const program = block.opts.partners.program;
  const hasOpportunityFields = !!pipeline.opportunityFields;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MaterialIcon icon="Handshake" className="text-2xl text-primary-500" />
        <Typography level="h3">{props.title ?? "Partner Metrics"}</Typography>
      </div>

      <Data
        procedure={(s) => {
          if (hasOpportunityFields) {
            s.defScalar(
              "total_revenue",
              sql`coalesce((select sum(estimated_value) from db.${
                sql.ref(itemsTable)
              }
                  where pipeline_name = ${sql.lit(props.pipelineName)}
                  and estimated_value is not null), 0)`,
            );
            s.defScalar(
              "partner_revenue",
              sql`coalesce((select sum(estimated_value) from db.${
                sql.ref(itemsTable)
              }
                  where pipeline_name = ${sql.lit(props.pipelineName)}
                  and partner_attached = true
                  and estimated_value is not null), 0)`,
            );
            s.defScalar(
              "partner_revenue_pct",
              sql`case when total_revenue > 0
                then cast(round(partner_revenue * 100.0 / total_revenue, 0) as int)
                else 0 end`,
            );
          }

          s.defScalar(
            "avg_cosell_readiness",
            sql`coalesce((select avg(p.co_sell_readiness_score) from db.crm_partners p
                where p.co_sell_readiness_score is not null), 0)`,
          );

          s.defScalar(
            "cosell_ready_partners",
            sql`(select count(*) from db.crm_partners p
                where p.co_sell_readiness_score >= ${program.coSellReadinessThreshold}
                and p.validation_status = 'validated')`,
          );

          s.defScalar(
            "joint_pipeline_deals",
            sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(props.pipelineName)}
                and partner_attached = true)`,
          );

          s.defScalar(
            "total_deals",
            sql`(select count(*) from db.${sql.ref(itemsTable)}
                where pipeline_name = ${sql.lit(props.pipelineName)})`,
          );

          s.defScalar(
            "joint_pipeline_pct",
            sql`case when total_deals > 0
              then cast(round(joint_pipeline_deals * 100.0 / total_deals, 0) as int)
              else 0 end`,
          );

          s.defScalar(
            "incentive_eligible_partners",
            sql`(select count(*) from db.crm_partners p
                where p.incentive_eligibility = true)`,
          );

          s.defScalar(
            "partners_with_deals",
            sql`(select count(distinct partner_id) from db.${
              sql.ref(itemsTable)
            }
                where pipeline_name = ${sql.lit(props.pipelineName)}
                and partner_id is not null)`,
          );

          s.defScalar(
            "incentive_utilization_pct",
            sql`case when incentive_eligible_partners > 0
              then cast(round(partners_with_deals * 100.0 / incentive_eligible_partners, 0) as int)
              else 0 end`,
          );

          s.defTable(
            "top_partners",
            sql`
              select
                p.id,
                p.name,
                p.partner_type,
                p.co_sell_readiness_score,
                p.validation_status,
                p.incentive_eligibility,
                count(i.id) as deal_count,
                ${
              hasOpportunityFields
                ? sql`coalesce(sum(i.estimated_value), 0)`
                : sql`0`
            } as total_value
              from db.crm_partners p
              left join db.${sql.ref(itemsTable)} i on i.partner_id = p.id
                and i.pipeline_name = ${sql.lit(props.pipelineName)}
              group by p.id, p.name, p.partner_type, p.co_sell_readiness_score, p.validation_status, p.incentive_eligibility
              order by deal_count desc, total_value desc
              limit 10
            `,
          );
        }}
      >
        <div className="grid grid-cols-4 gap-4">
          {hasOpportunityFields && (
            <StatCard
              title="Partner Revenue Contribution"
              value={sql`cast(partner_revenue_pct as string) || '%'`}
              icon="AttachMoney"
              color="success"
              subtitle={sql`'$' || format.decimal(partner_revenue) || ' of $' || format.decimal(total_revenue)`}
            />
          )}
          <StatCard
            title="Avg Co-Sell Readiness"
            value={sql`cast(round(avg_cosell_readiness, 0) as string)`}
            icon="TrendingUp"
            color="primary"
            subtitle={sql`cast(cosell_ready_partners as string) || ' partners ready'`}
          />
          <StatCard
            title="Joint Pipeline"
            value={sql`cast(joint_pipeline_pct as string) || '%'`}
            icon="Diversity3"
            color="primary"
            subtitle={sql`cast(joint_pipeline_deals as string) || ' of ' || cast(total_deals as string) || ' deals'`}
          />
          <StatCard
            title="Incentive Utilization"
            value={sql`cast(incentive_utilization_pct as string) || '%'`}
            icon="CardGiftcard"
            color="warning"
            subtitle={sql`cast(partners_with_deals as string) || ' of ' || cast(incentive_eligible_partners as string) || ' eligible'`}
          />
        </div>

        <RYGScorecards
          items={[
            ...(hasOpportunityFields
              ? [{
                label: "Revenue Share",
                score: sql`partner_revenue_pct`,
                thresholds: { red: 20, yellow: 40 },
              }]
              : []),
            { label: "Co-Sell Ready", score: sql`avg_cosell_readiness` },
            {
              label: "Joint Pipeline",
              score: sql`joint_pipeline_pct`,
              thresholds: { red: 25, yellow: 50 },
            },
          ]}
        />

        <Card variant="outlined" className="p-4">
          <CardHeader>
            <MaterialIcon icon="Groups" className="mr-2" />
            Top Partners by Deal Count
          </CardHeader>
          <div className="mt-4 space-y-3">
            <Show
              when={sql`(select count(*) from top_partners) = 0`}
              fallback={
                <Each table="top_partners" recordName="partner">
                  <div className="flex items-center justify-between p-3 bg-level1 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                        <MaterialIcon
                          icon="Business"
                          className="text-primary-600"
                        />
                      </div>
                      <div>
                        <Typography level="body-sm" className="font-medium">
                          {sql`partner.name`}
                        </Typography>
                        <div className="flex items-center gap-2">
                          <Typography level="body-xs" className="text-tertiary">
                            {sql`string.capitalize(replace(partner.partner_type, '_', ' '))`}
                          </Typography>
                          <Show
                            when={sql`partner.validation_status = 'validated'`}
                          >
                            <Chip size="sm" variant="soft" color="success">
                              Validated
                            </Chip>
                          </Show>
                          <Show when={sql`partner.incentive_eligibility`}>
                            <Chip size="sm" variant="soft" color="warning">
                              Incentive Eligible
                            </Chip>
                          </Show>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <Typography level="title-md" color="primary">
                        {sql`partner.deal_count`} deals
                      </Typography>
                      <Show when={sql`partner.total_value > 0`}>
                        <Typography
                          level="body-xs"
                          className="text-success-600"
                        >
                          ${sql`format.decimal(partner.total_value)`}
                        </Typography>
                      </Show>
                      <Show
                        when={sql`partner.co_sell_readiness_score is not null`}
                      >
                        <Typography level="body-xs" className="text-tertiary">
                          Readiness: {sql`partner.co_sell_readiness_score`}
                        </Typography>
                      </Show>
                    </div>
                  </div>
                </Each>
              }
            >
              <Typography
                level="body-sm"
                className="text-tertiary text-center py-4"
              >
                No partners with deals yet
              </Typography>
            </Show>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card variant="outlined" className="p-4">
            <CardHeader>
              <MaterialIcon icon="VerifiedUser" className="mr-2" />
              Partner Validation Status
            </CardHeader>
            <div className="mt-4 space-y-3">
              <Data
                procedure={(s) => {
                  s.defScalar(
                    "validated_count",
                    sql`(select count(*) from db.crm_partners where validation_status = 'validated')`,
                  );
                  s.defScalar(
                    "pending_count",
                    sql`(select count(*) from db.crm_partners where validation_status = 'pending')`,
                  );
                  s.defScalar(
                    "rejected_count",
                    sql`(select count(*) from db.crm_partners where validation_status = 'rejected')`,
                  );
                }}
              >
                <div className="flex items-center justify-between p-2 bg-success-50 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-success-500" />
                    <Typography level="body-sm">Validated</Typography>
                  </div>
                  <Typography level="body-sm" className="font-medium">
                    {sql`validated_count`}
                  </Typography>
                </div>
                <div className="flex items-center justify-between p-2 bg-warning-50 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-warning-500" />
                    <Typography level="body-sm">Pending</Typography>
                  </div>
                  <Typography level="body-sm" className="font-medium">
                    {sql`pending_count`}
                  </Typography>
                </div>
                <div className="flex items-center justify-between p-2 bg-danger-50 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-danger-500" />
                    <Typography level="body-sm">Rejected</Typography>
                  </div>
                  <Typography level="body-sm" className="font-medium">
                    {sql`rejected_count`}
                  </Typography>
                </div>
              </Data>
            </div>
          </Card>

          <Card variant="outlined" className="p-4">
            <CardHeader>
              <MaterialIcon icon="Category" className="mr-2" />
              Partners by Type
            </CardHeader>
            <div className="mt-4 space-y-3">
              <Data
                procedure={(s) => {
                  s.defScalar(
                    "reseller_count",
                    sql`(select count(*) from db.crm_partners where partner_type = 'valued_reseller')`,
                  );
                  s.defScalar(
                    "affiliate_count",
                    sql`(select count(*) from db.crm_partners where partner_type = 'affiliate')`,
                  );
                  s.defScalar(
                    "industry_count",
                    sql`(select count(*) from db.crm_partners where partner_type = 'industry_solution')`,
                  );
                }}
              >
                <div className="flex items-center justify-between p-2 bg-primary-50 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-primary-500" />
                    <Typography level="body-sm">Valued Resellers</Typography>
                  </div>
                  <Typography level="body-sm" className="font-medium">
                    {sql`reseller_count`}
                  </Typography>
                </div>
                <div className="flex items-center justify-between p-2 bg-level1 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-neutral-500" />
                    <Typography level="body-sm">Affiliates</Typography>
                  </div>
                  <Typography level="body-sm" className="font-medium">
                    {sql`affiliate_count`}
                  </Typography>
                </div>
                <div className="flex items-center justify-between p-2 bg-success-50 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-success-500" />
                    <Typography level="body-sm">Industry Solutions</Typography>
                  </div>
                  <Typography level="body-sm" className="font-medium">
                    {sql`industry_count`}
                  </Typography>
                </div>
              </Data>
            </div>
          </Card>
        </div>
      </Data>
    </div>
  );
}
