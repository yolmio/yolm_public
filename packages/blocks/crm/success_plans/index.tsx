import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { EachSelect } from "components/each_select";
import { IconButton } from "components/icon_button";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { RecordPage } from "pages/record_page";
import { sql } from "std/sql_utils";
import type { NumericExpr } from "std/sql_utils";
import { system } from "std/system";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { Each, Route, Show, useSharedContext } from "std/ui";
import { Form } from "std/form";
import { SidebarItemsSharedContext } from "std/shared_contexts";
import { CrmBlock } from "../index";
import { ScoreAssessmentForm } from "../score_assessment";

interface SuccessPlanListPageProps {
  path?: string;
  onRowClick?: (recordId: NumericExpr) => void;
  toolbarRight?: Node;
}

/**
 * Datagrid-based list page for CRM success plans. Requires
 * {@link CrmBlock} to be configured with `successPlans: true`.
 */
export function SuccessPlanListPage(props: SuccessPlanListPageProps) {
  const block = system.block(CrmBlock);

  if (!block.hasSuccessPlansEnabled()) {
    return null;
  }

  const successPlansTable = block.successPlansTableName;
  const orgsTable = block.organizationsTableName;
  const path = props.path ?? block.routes.successPlansListPath;

  useSharedContext(SidebarItemsSharedContext).add({
    section: "Customer Success",
    icon: "TrendingUp",
    requiredPermission: "view_success_plans",
    order: 30,
    items: [
      {
        label: "Success Plans",
        href: path,
        icon: "TrendingUp",
      },
    ],
  });

  return (
    <Route path={path}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <MaterialIcon
              icon="TrendingUp"
              className="text-2xl text-success-500"
            />
            <Typography level="h3">Success Plans</Typography>
          </div>
          <div className="flex items-center gap-2">
            {props.toolbarRight}
            <Button
              variant="soft"
              color="success"
              startIcon="Add"
              href={block.routes.successPlanNewPath}
            >
              New Success Plan
            </Button>
          </div>
        </div>

        <Data
          procedure={(s) => {
            s.defTable(
              "plans",
              sql`
                select
                  sp.*,
                  o.name as organization_name,
                  case
                    when sp.renewal_date < current_date() then 'overdue'
                    when sp.renewal_date < current_date() + interval '${block.renewalUpcomingDays} day' then 'upcoming'
                    else 'ok'
                  end as renewal_status
                from db.${sql.ref(successPlansTable)} sp
                left join db.${
                sql.ref(orgsTable)
              } o on o.id = sp.organization_id
                order by sp.renewal_date asc nulls last, sp.created_at desc
              `,
            );
          }}
        >
          <div className="grid gap-4">
            <Each table="plans" recordName="plan">
              <Card
                variant="outlined"
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={(s) => {
                  if (props.onRowClick) {
                    props.onRowClick(sql`plan.id`);
                  } else {
                    s.navigate(block.successPlanHref(sql`plan.id`));
                  }
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Typography level="title-md">
                        {sql`plan.name`}
                      </Typography>
                      <HealthScoreChip score={sql`plan.health_score`} />
                    </div>
                    <Show when={sql`plan.organization_name is not null`}>
                      <Typography
                        level="body-sm"
                        className="text-tertiary mb-2"
                      >
                        <MaterialIcon
                          icon="Business"
                          className="text-sm mr-1"
                        />
                        {sql`plan.organization_name`}
                      </Typography>
                    </Show>
                    <div className="flex items-center gap-4 text-sm text-tertiary">
                      <Show when={sql`plan.renewal_date is not null`}>
                        <span
                          style={{
                            color: sql`case plan.renewal_status
                              when 'overdue' then '#EF4444'
                              when 'upcoming' then '#F59E0B'
                              else '#6B7280'
                            end`,
                          }}
                        >
                          <MaterialIcon icon="Event" className="text-sm mr-1" />
                          Renewal:{" "}
                          {sql`format.date(plan.renewal_date, '%b %d, %Y')`}
                        </span>
                      </Show>
                      <Show when={sql`plan.health_score is not null`}>
                        <span>
                          <MaterialIcon
                            icon="Favorite"
                            className="text-sm mr-1"
                          />
                          Health: {sql`plan.health_score`}%
                        </span>
                      </Show>
                    </div>
                  </div>
                  <IconButton
                    variant="plain"
                    color="neutral"
                    onClick={(s) => {
                      s.event.stopPropagation();
                      s.navigate(block.successPlanHref(sql`plan.id`));
                    }}
                  >
                    <MaterialIcon icon="ChevronRight" />
                  </IconButton>
                </div>
              </Card>
            </Each>
          </div>
        </Data>
      </div>
    </Route>
  );
}

// ==================== Success Plan Detail Page ====================

interface SuccessPlanDetailPageProps {
  path?: string;
}

/**
 * Detail page for a single success plan: outcomes, milestones, related
 * organization / contacts, and activity.
 */
export function SuccessPlanDetailPage(props: SuccessPlanDetailPageProps) {
  const block = system.block(CrmBlock);

  if (!block.hasSuccessPlansEnabled()) {
    return null;
  }

  const successPlansTable = block.successPlansTableName;
  const path = props.path ?? block.routes.successPlanDetailPath;

  return (
    <RecordPage table={successPlansTable} path={path}>
      <div className="container mx-auto p-6 max-w-4xl">
        <SuccessPlanDetailContent block={block} />
      </div>
    </RecordPage>
  );
}

function SuccessPlanDetailContent(props: { block: CrmBlock }) {
  const { block } = props;
  const successPlansTable = block.successPlansTableName;
  const orgsTable = block.organizationsTableName;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", 0);
        s.defScalar("edit_mode", false);
      }}
    >
      <Data
        procedure={(s) => {
          s.defRecord(
            "plan",
            sql`
              select
                sp.*,
                o.name as organization_name,
                case
                  when sp.renewal_date < current_date() then 'overdue'
                  when sp.renewal_date < current_date() + interval '${block.renewalUpcomingDays} day' then 'upcoming'
                  else 'ok'
                end as renewal_status
              from db.${sql.ref(successPlansTable)} sp
              left join db.${sql.ref(orgsTable)} o on o.id = sp.organization_id
              where sp.id = ui.record_id
            `,
          );
        }}
        watch={[sql`refresh_key`]}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <MaterialIcon
              icon="TrendingUp"
              className="text-3xl text-success-500"
            />
            <div>
              <Typography level="h3">{sql`plan.name`}</Typography>
              <Show when={sql`plan.organization_name is not null`}>
                <Typography level="body-sm" className="text-tertiary">
                  {sql`plan.organization_name`}
                </Typography>
              </Show>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HealthScoreChip score={sql`plan.health_score`} />
            <Button
              variant="outlined"
              color="neutral"
              startIcon="Edit"
              onClick={(s) => {
                s.setScalar("edit_mode", sql`not edit_mode`);
              }}
            >
              {sql`case when edit_mode then 'Cancel' else 'Edit' end`}
            </Button>
          </div>
        </div>

        <Show when={sql`edit_mode`}>
          <div className="grid gap-6">
            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="Edit" className="mr-2" />
                Edit Success Plan
              </CardHeader>
              <div className="space-y-4 mt-4">
                <Form
                  defaultFieldComponent={LabelOnTopFormField}
                  afterTransactionCommit={(s) => {
                    s.increment("refresh_key");
                  }}
                  afterSubmitClientSuccess={(s) => {
                    s.setScalar("edit_mode", false);
                  }}
                >
                  <Form.Update
                    table={successPlansTable}
                    where={sql`id = ui.record_id`}
                    setFields={{ last_modified_at: sql`now()` }}
                  >
                    <Form.Field field="name" />
                    {block.pipelines.length > 0 && (
                      <Form.Field field="pipeline_item_id" />
                    )}
                    <Form.Field field="renewal_date" />
                    <Form.Field field="adoption_activities" />
                    <Form.Field field="expansion_opportunities" />
                    <Form.ErrorAlert className="mt-3" mode="all" />
                    <div className="flex justify-end gap-2 pt-4">
                      <Form.SubmitButton>Save</Form.SubmitButton>
                    </div>
                  </Form.Update>
                </Form>
              </div>
            </Card>
          </div>
        </Show>

        <Show when={sql`not edit_mode`}>
          <div className="grid gap-6">
            <Show when={sql`plan.renewal_status = 'overdue'`}>
              <Card
                variant="soft"
                className="p-4 bg-danger-50 border-danger-200"
              >
                <div className="flex items-center gap-2">
                  <MaterialIcon icon="Warning" className="text-danger-600" />
                  <Typography level="body-md" className="text-danger-700">
                    Renewal is overdue! Expected date was{" "}
                    {sql`format.date(plan.renewal_date, '%b %d, %Y')`}
                  </Typography>
                </div>
              </Card>
            </Show>
            <Show when={sql`plan.renewal_status = 'upcoming'`}>
              <Card
                variant="soft"
                className="p-4 bg-warning-50 border-warning-200"
              >
                <div className="flex items-center gap-2">
                  <MaterialIcon icon="Schedule" className="text-warning-600" />
                  <Typography level="body-md" className="text-warning-700">
                    Renewal coming up on{" "}
                    {sql`format.date(plan.renewal_date, '%b %d, %Y')`}
                  </Typography>
                </div>
              </Card>
            </Show>

            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="Info" className="mr-2" />
                Overview
              </CardHeader>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    Renewal Date
                  </Typography>
                  <Typography level="body-md">
                    {sql`coalesce(format.date(plan.renewal_date, '%b %d, %Y'), 'Not set')`}
                  </Typography>
                </div>
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    Health Score
                  </Typography>
                  <Typography level="body-md">
                    {sql`coalesce(cast(plan.health_score as string) || '%', 'Not assessed')`}
                  </Typography>
                </div>
              </div>
            </Card>

            <ScoreAssessmentForm
              table={successPlansTable}
              recordId={sql`ui.record_id`}
              score={sql`plan.health_score`}
              assessedAt={sql`plan.health_score_calculated_at`}
              title="Health assessment"
              editPermission="edit_success_plans"
            />
            <KpisCard successPlanId={sql`plan.id`} />

            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="Checklist" className="mr-2" />
                Adoption Activities
              </CardHeader>
              <div className="mt-4">
                <Show
                  when={sql`plan.adoption_activities is not null and plan.adoption_activities != ''`}
                  fallback={
                    <Typography level="body-sm" className="text-tertiary">
                      No adoption activities documented
                    </Typography>
                  }
                >
                  <Typography level="body-sm" className="whitespace-pre-wrap">
                    {sql`plan.adoption_activities`}
                  </Typography>
                </Show>
              </div>
            </Card>

            <Card variant="outlined" className="p-4">
              <CardHeader>
                <MaterialIcon icon="TrendingUp" className="mr-2" />
                Expansion Opportunities
              </CardHeader>
              <div className="mt-4">
                <Show
                  when={sql`plan.expansion_opportunities is not null and plan.expansion_opportunities != ''`}
                  fallback={
                    <Typography level="body-sm" className="text-tertiary">
                      No expansion opportunities documented
                    </Typography>
                  }
                >
                  <Typography level="body-sm" className="whitespace-pre-wrap">
                    {sql`plan.expansion_opportunities`}
                  </Typography>
                </Show>
              </div>
            </Card>
          </div>
        </Show>
      </Data>
    </Data>
  );
}

// ==================== Helper Components ====================

function HealthScoreChip(props: { score: NumericExpr }) {
  const block = system.block(CrmBlock);
  const { good, warning } = block.healthScoreThresholds;

  return (
    <Show when={sql`${props.score} is not null`}>
      <Chip
        size="sm"
        variant="soft"
        style={{
          backgroundColor: sql`case
            when ${props.score} >= ${good} then '#10B98130'
            when ${props.score} >= ${warning} then '#F59E0B30'
            else '#EF444430'
          end`,
          color: sql`case
            when ${props.score} >= ${good} then '#10B981'
            when ${props.score} >= ${warning} then '#F59E0B'
            else '#EF4444'
          end`,
        }}
      >
        {sql`${props.score} || '%'`}
      </Chip>
    </Show>
  );
}

// ==================== Success Plan Form for New/Edit ====================

interface SuccessPlanFormProps {
  path?: string;
}

/**
 * Create-success-plan page. Renders the form pre-bound to the
 * `success_plans` table and redirects to the detail page on submit.
 */
export function SuccessPlanNewPage(props: SuccessPlanFormProps) {
  const block = system.block(CrmBlock);

  if (!block.hasSuccessPlansEnabled()) {
    return null;
  }

  const successPlansTable = block.successPlansTableName;
  const orgsTable = block.organizationsTableName;
  const path = props.path ?? block.routes.successPlanNewPath;

  return (
    <Route path={path}>
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <MaterialIcon icon="Add" className="text-3xl text-success-500" />
          <Typography level="h3">New Success Plan</Typography>
        </div>

        <Card variant="outlined" className="p-6">
          <Form
            defaultFieldComponent={LabelOnTopFormField}
            beforeTransactionCommit={(s) => {
              s.defScalar(
                "new_id",
                sql`last_record_id(${sql.ref(successPlansTable)})`,
              );
            }}
            afterTransactionCommit={(s) => {
              s.navigate(block.successPlanHref(sql`new_id`));
            }}
          >
            <Form.Insert
              table={successPlansTable}
              values={{ created_by: sql`current_user` }}
            >
              <div className="space-y-4">
                <Form.Field field="name" />
                <Form.Field field="organization_id">
                  {(helper) => (
                    <Data
                      procedure={(s) => {
                        s.defTable(
                          "orgs",
                          sql`select id, name from db.${
                            sql.ref(orgsTable)
                          } order by name`,
                        );
                      }}
                    >
                      <EachSelect
                        table="orgs"
                        value={helper.value}
                        onChange={(s, recordId) => helper.setValue(s, recordId)}
                        placeholder="Select organization..."
                        size="md"
                        optionLabel="name"
                        optionValue="id"
                      />
                    </Data>
                  )}
                </Form.Field>
                {block.pipelines.length > 0 && (
                  <Form.Field field="pipeline_item_id" />
                )}
                <Form.Field field="renewal_date" />
                <Form.Field field="adoption_activities" />
                <Form.Field field="expansion_opportunities" />
                <Form.ErrorAlert className="mt-3" mode="all" />
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outlined"
                    color="neutral"
                    href={block.routes.successPlansListPath}
                  >
                    Cancel
                  </Button>
                  <Form.SubmitButton
                    variant="solid"
                    color="success"
                  >
                    Create Success Plan
                  </Form.SubmitButton>
                </div>
              </div>
            </Form.Insert>
          </Form>
        </Card>
      </div>
    </Route>
  );
}
interface KpisCardProps {
  successPlanId: NumericExpr;
}

function KpisCard(props: KpisCardProps) {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "kpis",
          sql`
            select
              id,
              name,
              description,
              unit,
              target_value,
              baseline_value,
              current_value
            from db.crm_success_plan_kpis
            where success_plan_id = ${props.successPlanId}
            order by sort_order, name
          `,
        );
        s.defScalar("has_any", sql`(select count(*) > 0 from kpis)`);
      }}
    >
      <Card variant="outlined" className="p-4">
        <CardHeader>
          <MaterialIcon icon="Assessment" className="mr-2" />
          KPIs & Metrics
        </CardHeader>
        <div className="mt-4">
          <Show
            when={sql`has_any`}
            fallback={
              <Typography level="body-sm" className="text-tertiary">
                No KPIs defined yet
              </Typography>
            }
          >
            <div className="space-y-3">
              <Each table="kpis" recordName="kpi">
                <div className="p-3 rounded-lg bg-neutral-50 border border-divider">
                  <div className="flex justify-between items-start">
                    <div>
                      <Typography level="title-sm">{sql`kpi.name`}</Typography>
                      <Show
                        when={sql`kpi.description is not null and kpi.description != ''`}
                      >
                        <Typography
                          level="body-xs"
                          className="text-tertiary mt-1"
                        >
                          {sql`kpi.description`}
                        </Typography>
                      </Show>
                    </div>
                    <Show when={sql`kpi.unit is not null`}>
                      <Chip size="sm" variant="outlined" color="neutral">
                        {sql`kpi.unit`}
                      </Chip>
                    </Show>
                  </div>
                  <div className="flex gap-4 mt-3 text-sm">
                    <div>
                      <Typography level="body-xs" className="text-tertiary">
                        Baseline
                      </Typography>
                      <Typography level="body-sm" className="font-medium">
                        {sql`coalesce(cast(kpi.baseline_value as string), '-')`}
                      </Typography>
                    </div>
                    <div>
                      <Typography level="body-xs" className="text-tertiary">
                        Current
                      </Typography>
                      <Typography level="body-sm" className="font-medium">
                        {sql`coalesce(cast(kpi.current_value as string), '-')`}
                      </Typography>
                    </div>
                    <div>
                      <Typography level="body-xs" className="text-tertiary">
                        Target
                      </Typography>
                      <Typography level="body-sm" className="font-medium">
                        {sql`coalesce(cast(kpi.target_value as string), '-')`}
                      </Typography>
                    </div>
                  </div>
                </div>
              </Each>
            </div>
          </Show>
        </div>
      </Card>
    </Data>
  );
}
