import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { currentUserHasPermission } from "blocks/auth";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import { Form } from "std/form";
import { CrmBlock } from "../index";
import { addToPipeline } from "./board";
import {
  ExtendedItemFieldsForm,
  getExtendedItemFieldsFromWriteState,
} from "./extended_item_fields";

interface EntityPipelineStatusTabProps {
  pipelineName: string;
  entityType: "organization" | "person";
  editPermission?: string;
  itemDetailHref?: string;
}

/**
 * Tab content rendered inside an organization or person detail page
 * showing that entity's status in `pipelineName` — current stage, exit
 * criteria, open tasks, and a link to the full pipeline item.
 */
export function EntityPipelineStatusTab(props: EntityPipelineStatusTabProps) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);
  const itemsTable = block.pipelineItemsTableName;
  const tasksTable = block.pipelineTasksTableName;

  if (!pipeline) return null;

  const entityIdColumn = props.entityType === "organization"
    ? "organization_id"
    : "person_id";
  const editPermission = props.editPermission ?? "edit_pipeline";
  const itemDetailHref = props.itemDetailHref;
  const hasOpportunityFields = !!pipeline.opportunityFields;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("show_add_dialog", false);
        s.defScalar("refresh_key", 0);
        s.defScalar(
          "can_edit_pipeline",
          currentUserHasPermission(sql.lit(editPermission)),
        );
      }}
    >
      <div className="p-4">
        <Typography level="title-lg" className="mb-4">
          Sales Process
        </Typography>

        <Data
          procedure={(s) => {
            s.defTable(
              "entity_pipeline_items",
              sql`
              select
                pi.id,
                pi.pipeline_name,
                pi.stage_name,
                pi.assigned_to,
                pi.expected_close_date,
                pi.entered_stage_at,
                pi.entered_pipeline_at,
${
                pipeline.opportunityFields
                  ? sql`pi.opportunity_name`
                  : sql`cast(null as string)`
              } as opportunity_name,
${
                pipeline.opportunityFields
                  ? sql`pi.estimated_value`
                  : sql`cast(null as decimal)`
              } as estimated_value,
${
                pipeline.opportunityFields
                  ? sql`pi.probability_pct`
                  : sql`cast(null as int)`
              } as probability_pct,
${
                pipeline.opportunityFields
                  ? sql`pi.risk_level`
                  : sql`cast(null as string)`
              } as risk_level,
${
                pipeline.opportunityFields?.qualification
                  ? sql`pi.business_case_score`
                  : sql`cast(null as int)`
              } as business_case_score,
                pi.assigned_to is not null as has_assigned,
                ${
                block.hasPipelineTasksEnabled(pipeline.name)
                  ? sql`(select count(*) from db.${
                    sql.ref(tasksTable)
                  } where pipeline_item_id = pi.id and not completed)`
                  : sql`0`
              } as pending_tasks,
                (select display_name_virtual from db.sys_users where id = pi.assigned_to) as assigned_name
              from db.${sql.ref(itemsTable)} pi
              where pi.pipeline_name = ${
                sql.lit(pipeline.name)
              } and pi.entity_type = ${sql.lit(props.entityType)}
                and pi.${sql.ref(entityIdColumn)} = record_id
              order by pi.entered_stage_at desc
            `,
            );
            s.defScalar(
              "exists_pipeline_item",
              sql`(select count(*) from entity_pipeline_items) > 0`,
            );
          }}
          watch={[sql`refresh_key`]}
        >
          <Show when={sql`can_edit_pipeline`}>
            {hasOpportunityFields
              ? (
                <Button
                  variant="soft"
                  color="primary"
                  startIcon="Add"
                  onClick={(s) => s.setScalar("show_add_dialog", true)}
                >
                  Create Opportunity
                </Button>
              )
              : (
                <Button
                  variant="soft"
                  color="primary"
                  startIcon="Add"
                  onClick={(s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        addToPipeline(s, {
                          pipelineName: props.pipelineName,
                          entityType: props.entityType,
                          entityId: sql`record_id`,
                          onSuccess: (s, itemId) => {
                            s.navigate(
                              itemDetailHref
                                ? sql.concat(sql.lit(itemDetailHref), itemId)
                                : block.pipelineItemHref(itemId),
                            );
                          },
                        });
                        s.commitTransaction();
                      },
                    });
                  }}
                >
                  Create Opportunity
                </Button>
              )}
          </Show>
          <Show
            when={sql`exists_pipeline_item`}
            fallback={
              <Card variant="soft" className="p-6 text-center mb-4 mt-4">
                <MaterialIcon
                  icon="ViewKanban"
                  className="text-4xl text-neutral-300 mb-2"
                />
                <Typography level="body-md" className="text-tertiary mb-4">
                  No opportunities yet
                </Typography>
              </Card>
            }
          >
            <div className="space-y-4 mt-4">
              <Each table="entity_pipeline_items" recordName="item">
                <Card variant="outlined" className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Typography level="title-md">
                          {sql`coalesce(item.opportunity_name, ${
                            sql.lit(pipeline.displayName ?? "Pipeline Item")
                          })`}
                        </Typography>
                        <Chip size="sm" variant="soft" color="primary">
                          {sql`string.capitalize(replace(item.stage_name, '_', ' '))`}
                        </Chip>
                        <Show when={sql`item.risk_level = 'high'`}>
                          <Chip size="sm" variant="soft" color="danger">
                            High Risk
                          </Chip>
                        </Show>
                        <Show when={sql`item.risk_level = 'medium'`}>
                          <Chip size="sm" variant="soft" color="warning">
                            Medium Risk
                          </Chip>
                        </Show>
                        <Show when={sql`item.risk_level = 'low'`}>
                          <Chip size="sm" variant="soft" color="success">
                            Low Risk
                          </Chip>
                        </Show>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                        <Show when={sql`item.estimated_value is not null`}>
                          <div>
                            <Typography
                              level="body-xs"
                              className="text-tertiary"
                            >
                              Estimated Value
                            </Typography>
                            <Typography level="body-sm" className="font-medium">
                              ${sql`item.estimated_value`}
                            </Typography>
                          </div>
                        </Show>
                        <Show when={sql`item.probability_pct is not null`}>
                          <div>
                            <Typography
                              level="body-xs"
                              className="text-tertiary"
                            >
                              Probability
                            </Typography>
                            <Typography level="body-sm" className="font-medium">
                              {sql`item.probability_pct`}%
                            </Typography>
                          </div>
                        </Show>
                        <Show when={sql`item.expected_close_date is not null`}>
                          <div>
                            <Typography
                              level="body-xs"
                              className="text-tertiary"
                            >
                              Expected Close
                            </Typography>
                            <Typography level="body-sm">
                              {sql`format.date(item.expected_close_date, '%b %d, %Y')`}
                            </Typography>
                          </div>
                        </Show>
                        <Show when={sql`item.business_case_score is not null`}>
                          <div>
                            <Typography
                              level="body-xs"
                              className="text-tertiary"
                            >
                              Business Case
                            </Typography>
                            <Typography level="body-sm" className="font-medium">
                              {sql`item.business_case_score`}/5
                            </Typography>
                          </div>
                        </Show>
                        <div>
                          <Typography level="body-xs" className="text-tertiary">
                            In Stage Since
                          </Typography>
                          <Typography level="body-sm">
                            {sql`format.date(item.entered_stage_at, '%b %d, %Y')`}
                          </Typography>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-tertiary">
                        <Show when={sql`item.has_assigned`}>
                          <div className="flex items-center gap-1">
                            <MaterialIcon icon="Person" className="text-sm" />
                            <span>
                              {sql`coalesce(item.assigned_name, 'Assigned')`}
                            </span>
                          </div>
                        </Show>
                        <Show when={sql`item.pending_tasks > 0`}>
                          <div className="flex items-center gap-1">
                            <MaterialIcon icon="Task" className="text-sm" />
                            <span>{sql`item.pending_tasks`} pending tasks</span>
                          </div>
                        </Show>
                      </div>
                    </div>

                    <Button
                      variant="outlined"
                      color="primary"
                      size="sm"
                      href={itemDetailHref
                        ? sql`${sql.lit(itemDetailHref)} || item.id`
                        : block.pipelineItemHref(sql`item.id`)}
                    >
                      View Details
                    </Button>
                  </div>

                  <div className="mt-4 pt-4 border-t">
                    <Typography level="body-xs" className="text-tertiary mb-2">
                      Sales Progress
                    </Typography>
                    <div className="flex items-center gap-1 flex-wrap">
                      {pipeline.stages.map((stage, index) => {
                        const stageColor = stage.color ?? "#3B82F6";
                        return (
                          <>
                            <div
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                              style={{
                                backgroundColor: sql`case
                                when item.stage_name = ${
                                  sql.lit(stage.name)
                                } then ${sql.lit(stageColor + "30")}
                                else 'transparent'
                              end`,
                                color: sql`case
                                when item.stage_name = ${
                                  sql.lit(stage.name)
                                } then ${sql.lit(stageColor)}
                                else '#9CA3AF'
                              end`,
                                fontWeight: sql`case when item.stage_name = ${
                                  sql.lit(stage.name)
                                } then 600 else 400 end`,
                              }}
                            >
                              {stage.icon && (
                                <MaterialIcon
                                  icon={stage.icon}
                                  className="text-xs"
                                />
                              )}
                              <span>{stage.displayName ?? stage.name}</span>
                            </div>
                            {index < pipeline.stages.length - 1 && (
                              <MaterialIcon
                                icon="ChevronRight"
                                className="text-neutral-300 text-sm"
                              />
                            )}
                          </>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              </Each>
            </div>
          </Show>
        </Data>

        {hasOpportunityFields && (
          <Show when={sql`can_edit_pipeline`}>
            <AddOpportunityDialog
              pipelineName={props.pipelineName}
              entityType={props.entityType}
              itemDetailHref={itemDetailHref}
            />
          </Show>
        )}
      </div>
    </Data>
  );
}

interface AddOpportunityDialogProps {
  pipelineName: string;
  entityType: "organization" | "person";
  itemDetailHref?: string;
}

function AddOpportunityDialog(props: AddOpportunityDialogProps) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline) return null;

  const hasPartnerAttachment = pipeline.enablePartnerAttachment;
  const fields = getExtendedItemFieldsFromWriteState("new_item");

  return (
    <ModalDialog bindScalar="show_add_dialog" size="lg">
      <Form
        afterTransactionStart={(s) => {
          addToPipeline(s, {
            pipelineName: props.pipelineName,
            entityType: props.entityType,
            entityId: sql`record_id`,
            extendedFields: {
              itemName: fields.itemName,
              estimatedValue: fields.estimatedValue,
              probabilityPct: fields.probabilityPct,
              expectedCloseDate: fields.expectedCloseDate,
              riskLevel: fields.riskLevel,
              successMetricsDefined: fields.successMetricsDefined,
              competitiveLandscape: fields.competitiveLandscape,
              useCaseCategory: fields.useCaseCategory,
              partnerId: hasPartnerAttachment ? fields.partnerId : undefined,
            },
            onSuccess: (s, itemId) => {
              s.navigate(
                props.itemDetailHref
                  ? sql.concat(sql.lit(props.itemDetailHref), itemId)
                  : block.pipelineItemHref(itemId),
              );
            },
          });
        }}
        afterSubmitClientSuccess={(s) => {
          s.setScalar("show_add_dialog", false);
        }}
      >
        <Typography level="h4" className="mb-2">
          Create Opportunity
        </Typography>
        <Typography level="body-sm" className="text-tertiary mb-4">
          Create a new opportunity in the{" "}
          {pipeline.displayName ?? pipeline.name}
        </Typography>

        <Form.Temporary name="new_item">
          <ExtendedItemFieldsForm
            hasPartnerAttachment={hasPartnerAttachment}
            hasQualification={pipeline.opportunityFields?.qualification}
            hideBusinessCaseScore
          />
        </Form.Temporary>

        <div className="flex justify-end gap-2 mt-6">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("show_add_dialog", false)}
          >
            Cancel
          </Button>
          <Form.SubmitButton variant="solid" color="primary">
            Create
          </Form.SubmitButton>
        </div>
        <Form.ErrorAlert className="mt-3" mode="all" />
      </Form>
    </ModalDialog>
  );
}
