import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { TableRecordSelect } from "components/table_record_select";
import { Typography } from "components/typography";
import { RecordPage } from "pages/record_page";
import { sql } from "std/sql_utils";
import type { NumericExpr } from "std/sql_utils";
import type { DomStatementsOrFn, UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Each, Match, Show, Switch } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { CrmBlock } from "../index";
import type { PipelineConfig } from "./types";
import { StageFieldsForm } from "./stage_fields";
import { ExitCriteriaChecklist } from "./exit_criteria";
import { movePipelineItemProcedureName } from "./stored_procedures";
import { removeFromPipeline } from "./board";
import { PipelineTaskList } from "./tasks";
import { ExtendedItemDetailsCard } from "./extended_item_fields";
import { toDisplayName } from "../helpers";

interface PipelineItemDetailPageProps {
  pipelineName?: string;
  path?: string;
  appendTabs?: Array<{
    header: { icon?: string; label: string };
    content: Node;
  }>;
  renderEntityDetails?: (entityType: string, entityId: NumericExpr) => Node;
}

/**
 * Detail page for a single pipeline item: stage, exit criteria, tasks,
 * activity log, and any extended fields configured on the stage. Mount
 * inside a `<Route>` parameterized by the item id.
 */
export function PipelineItemDetailPage(props: PipelineItemDetailPageProps) {
  const block = system.block(CrmBlock);
  const pipeline = props.pipelineName
    ? block.getPipeline(props.pipelineName)
    : undefined;

  if (props.pipelineName && !pipeline) {
    throw new Error(`Pipeline "${props.pipelineName}" not found`);
  }

  const itemsTable = block.pipelineItemsTableName;
  const path = props.path ?? `/pipeline-items/{record_id:id}`;

  return (
    <RecordPage table={itemsTable} path={path}>
      <Data
        procedure={(s) =>
          s.defScalar(
            "item_pipeline_name",
            sql`(select pipeline_name from db.${
              sql.ref(itemsTable)
            } where id = ui.record_id)`,
          )}
      >
        <div className="container mx-auto p-4 max-w-6xl">
          {(pipeline ? [pipeline] : block.pipelines).map((
            configuredPipeline,
          ) => (
            <Show
              when={sql`item_pipeline_name = ${
                sql.lit(configuredPipeline.name)
              }`}
            >
              <PipelineItemDetailContent
                block={block}
                pipeline={configuredPipeline}
                appendTabs={props.appendTabs}
                renderEntityDetails={props.renderEntityDetails}
              />
            </Show>
          ))}
        </div>
      </Data>
    </RecordPage>
  );
}

interface PipelineItemDetailContentProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  appendTabs?: Array<{
    header: { icon?: string; label: string };
    content: Node;
  }>;
  renderEntityDetails?: (entityType: string, entityId: NumericExpr) => Node;
}

function PipelineItemDetailContent(props: PipelineItemDetailContentProps) {
  const { block, pipeline } = props;
  const itemsTable = block.pipelineItemsTableName;
  const organizationsTable = block.organizationsTableName;
  const peopleTable = block.peopleTableName;

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("refresh_key", 0);
      }}
    >
      <Data
        procedure={(s) => {
          s.defRecord(
            "item",
            sql`select
                  i.*,
                  case
                    when i.entity_type = 'organization' then ${
              system.db.tables[organizationsTable]
                ? sql`org.name`
                : sql`cast(null as string)`
            }
                    else concat(person.first_name, ' ', person.last_name)
                  end as entity_name
                from db.${sql.ref(itemsTable)} i
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
                where i.id = ui.record_id`,
          );
          s.defScalar(
            "assigned_user_name",
            sql`(select display_name_virtual from db.sys_users where id = item.assigned_to)`,
          );
          s.defScalar("current_stage_index", sql`0`);
          s.defScalar("show_move_dialog", false);
          s.defScalar("selected_stage", sql.lit``);
          s.defScalar("show_assign_dialog", false);
          s.defScalar("selected_user_id", { type: "BigInt" });

          if (pipeline.enablePartnerAttachment) {
            s.defScalar(
              "partner_name",
              sql`(select name from db.crm_partners where id = item.partner_id)`,
            );
            s.defScalar("editing_partner", false);
            s.defScalar("selected_partner_id", { type: "BigInt" });
            s.defScalar("saving_partner", false);
          }

          let stageIndexCase = sql`case`;
          pipeline.stages.forEach((stage, index) => {
            stageIndexCase = sql`${stageIndexCase} when item.stage_name = ${
              sql.lit(stage.name)
            } then ${index}`;
          });
          stageIndexCase = sql`${stageIndexCase} else 0 end`;
          s.setScalar("current_stage_index", stageIndexCase);
        }}
        watch={[sql`refresh_key`]}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Show when={sql`item.entity_type = 'organization'`}>
              <MaterialIcon
                icon="Business"
                className="text-3xl text-primary-500"
              />
            </Show>
            <Show when={sql`item.entity_type = 'person'`}>
              <MaterialIcon
                icon="Person"
                className="text-3xl text-primary-500"
              />
            </Show>
            <div>
              <Typography level="h3">{sql`item.entity_name`}</Typography>
              <Typography level="body-sm" className="text-tertiary">
                {pipeline.displayName ?? toDisplayName(pipeline.name)}
              </Typography>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outlined"
              color="primary"
              startIcon="SwapHoriz"
              onClick={(s) => {
                s.setScalar("show_move_dialog", true);
                s.setScalar("selected_stage", sql`item.stage_name`);
              }}
            >
              Move Stage
            </Button>
            <Menu>
              <Menu.IconButton variant="outlined" color="neutral">
                <MaterialIcon icon="MoreVert" />
              </Menu.IconButton>
              <Menu.Content>
                <Menu.Item
                  onClick={(s) => {
                    s.navigate(
                      sql`case
                        when item.entity_type = 'organization' then ${
                        block.organizationHref(sql`item.organization_id`)
                      }
                        else ${block.personHref(sql`item.person_id`)}
                      end`,
                    );
                  }}
                >
                  View Entity
                </Menu.Item>
                <Menu.Item
                  color="danger"
                  onClick={(s) => {
                    s.tryServer({
                      body: (s) => {
                        removeFromPipeline(s, {
                          block,
                          itemId: sql`ui.record_id`,
                        });
                      },
                    });
                    s.navigate(sql.lit(block.routes.pipelinesPath));
                  }}
                >
                  Remove from Pipeline
                </Menu.Item>
              </Menu.Content>
            </Menu>
          </div>
        </div>

        <Card variant="outlined" className="mb-6">
          <div className="p-4">
            <Typography level="title-sm" className="mb-3">
              Sales Progress
            </Typography>
            <div className="flex items-center gap-2">
              {pipeline.stages.map((stage, index) => {
                const stageColor = stage.color ?? "#3B82F6";
                const stageColorWithAlpha = `${stageColor}20`;
                return (
                  <>
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{
                        backgroundColor:
                          sql`case when current_stage_index >= ${index} then ${
                            sql.lit(stageColorWithAlpha)
                          } else 'transparent' end`,
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderColor: sql`case when item.stage_name = ${
                          sql.lit(stage.name)
                        } then ${sql.lit(stageColor)} else 'transparent' end`,
                      }}
                    >
                      {stage.icon && (
                        <MaterialIcon
                          icon={stage.icon}
                          style={{
                            color:
                              sql`case when current_stage_index >= ${index} then ${
                                sql.lit(stageColor)
                              } else '#9CA3AF' end`,
                          }}
                        />
                      )}
                      <Typography
                        level="body-xs"
                        style={{
                          color:
                            sql`case when current_stage_index >= ${index} then ${
                              sql.lit(stageColor)
                            } else '#9CA3AF' end`,
                          fontWeight: sql`case when item.stage_name = ${
                            sql.lit(stage.name)
                          } then 600 else 400 end`,
                        }}
                      >
                        {stage.displayName ?? toDisplayName(stage.name)}
                      </Typography>
                    </div>
                    {index < pipeline.stages.length - 1 && (
                      <MaterialIcon
                        icon="ChevronRight"
                        className="text-neutral-300"
                      />
                    )}
                  </>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8 space-y-4">
            {pipeline.opportunityFields && (
              <ExtendedItemDetailsCard
                pipeline={pipeline}
                itemId={sql`ui.record_id`}
                onSave={(s: UiServerStatements) => s.increment("refresh_key")}
              />
            )}

            {(() => {
              const stagesWithFields = pipeline.stages.filter((s) =>
                s.fields && s.fields.length > 0
              );
              if (stagesWithFields.length === 0) {
                return null;
              }
              const hasFieldsCondition = stagesWithFields
                .map((s) => sql`item.stage_name = ${sql.lit(s.name)}`)
                .reduce((acc, curr) => sql`${acc} or ${curr}`);

              return (
                <Show when={hasFieldsCondition}>
                  <Card variant="outlined">
                    <CardHeader>
                      <Typography startIcon="Assignment" level="title-md">
                        Stage Information
                      </Typography>
                    </CardHeader>
                    <div className="p-4">
                      <StageFieldsForm
                        block={block}
                        pipeline={pipeline}
                        itemId={sql`ui.record_id`}
                        stageName={sql`item.stage_name`}
                        onSave={(s) => s.increment("refresh_key")}
                      />
                    </div>
                  </Card>
                </Show>
              );
            })()}

            {(() => {
              // Build SQL condition for whether current stage has exit criteria configured
              const stagesWithExitCriteria = pipeline.stages.filter((s) =>
                s.exitCriteria && s.exitCriteria.length > 0
              );
              if (stagesWithExitCriteria.length === 0) {
                return null; // No stages have exit criteria, hide the card entirely
              }
              const hasExitCriteriaCondition = stagesWithExitCriteria
                .map((s) => sql`item.stage_name = ${sql.lit(s.name)}`)
                .reduce((acc, curr) => sql`${acc} or ${curr}`);

              return (
                <Show when={hasExitCriteriaCondition}>
                  <Card variant="outlined">
                    <CardHeader>
                      <Typography startIcon="ChecklistRtl" level="title-md">
                        Exit Criteria
                      </Typography>
                    </CardHeader>
                    <div className="p-4">
                      <ExitCriteriaChecklist
                        block={block}
                        pipeline={pipeline}
                        itemId={sql`ui.record_id`}
                        stageName={sql`item.stage_name`}
                        refreshKey={sql`refresh_key`}
                      />
                    </div>
                  </Card>
                </Show>
              );
            })()}

            {block.hasPipelineTasksEnabled(pipeline.name) && (
              <>
                <Card variant="outlined">
                  <CardHeader>
                    <Typography startIcon="Task" level="title-md">
                      Tasks
                    </Typography>
                  </CardHeader>
                  <div className="p-4">
                    <PipelineTaskList
                      block={block}
                      itemId={sql`ui.record_id`}
                      onTaskChange={(s) => s.increment("refresh_key")}
                    />
                  </div>
                </Card>
              </>
            )}
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-4">
            <Card variant="outlined">
              <CardHeader>
                <Typography startIcon="Info" level="title-md">
                  Details
                </Typography>
              </CardHeader>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <Typography level="body-xs" className="text-tertiary">
                      Assigned To
                    </Typography>
                    <IconButton
                      variant="plain"
                      color="neutral"
                      size="sm"
                      icon="Edit"
                      onClick={(s) => {
                        s.setScalar("selected_user_id", sql`item.assigned_to`);
                        s.setScalar("show_assign_dialog", true);
                      }}
                    />
                  </div>
                  <Show
                    when={sql`item.assigned_to is not null`}
                    fallback={
                      <Typography level="body-sm" className="text-tertiary">
                        Unassigned
                      </Typography>
                    }
                  >
                    <div className="flex items-center gap-2">
                      <MaterialIcon
                        icon="Person"
                        className="text-primary-500 text-sm"
                      />
                      <Typography level="body-sm">
                        {sql`coalesce(assigned_user_name, 'User #' || item.assigned_to)`}
                      </Typography>
                    </div>
                  </Show>
                </div>
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    Expected Close
                  </Typography>
                  <Show
                    when={sql`item.expected_close_date is not null`}
                    fallback={
                      <Typography level="body-sm" className="text-tertiary">
                        Not set
                      </Typography>
                    }
                  >
                    <Typography level="body-sm">
                      {sql`format.date(item.expected_close_date, '%B %d, %Y')`}
                    </Typography>
                  </Show>
                </div>
                {pipeline.enablePartnerAttachment && (() => {
                  const savePartner: DomStatementsOrFn = (s) => {
                    s.setScalar("saving_partner", true);
                    s.commitUiTreeChanges();

                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();

                        if (
                          block.hasPipelineActivityLogEnabled(pipeline.name)
                        ) {
                          s.defScalar(
                            "new_partner_name",
                            sql`coalesce((select name from db.crm_partners where id = selected_partner_id), 'Unknown')`,
                          );
                        }

                        s.modify(sql`
                          update db.${sql.ref(itemsTable)}
                          set
                            partner_id = selected_partner_id,
                            partner_attached = case when selected_partner_id is not null then true else false end,
                            last_modified_at = now()
                          where id = ui.record_id
                        `);

                        if (
                          block.hasPipelineActivityLogEnabled(pipeline.name)
                        ) {
                          s.if(
                            sql`selected_partner_id is not null`,
                            (s) => {
                              s.modify(sql`
                                insert into db.${
                                sql.ref(block.pipelineActivityLogTableName)
                              }
                                  (pipeline_item_id, activity_type, description, sys_user_id, created_at)
                                values
                                  (ui.record_id, 'partner_attached', 'Attached partner ' || new_partner_name, current_user, now())
                              `);
                            },
                          );
                        }

                        s.commitTransaction();
                        s.increment("ui.refresh_key");
                      },
                      finally: (s) => {
                        s.setScalar("saving_partner", false);
                        s.setScalar("editing_partner", false);
                      },
                    });
                  };

                  return (
                    <>
                      <div>
                        <Show
                          when={sql`not editing_partner`}
                          fallback={
                            <div
                              onKeyDown={(s) => {
                                s.if(sql`event.key = 'Enter'`, savePartner);
                                s.if(sql`event.key = 'Escape'`, (s) => {
                                  s.setScalar("editing_partner", false);
                                });
                              }}
                            >
                              <Typography
                                level="body-xs"
                                className="text-tertiary mb-2"
                              >
                                Partner
                              </Typography>
                              <TableRecordSelect
                                tableName="crm_partners"
                                value={sql`selected_partner_id`}
                                onSelectValue={(s, value) => {
                                  s.setScalar("selected_partner_id", value);
                                }}
                                placeholder="Search partners..."
                              />
                              <div className="flex items-center gap-1 mt-2">
                                <Button
                                  variant="solid"
                                  color="primary"
                                  size="sm"
                                  loading={sql`saving_partner`}
                                  onClick={savePartner}
                                >
                                  Save
                                </Button>
                                <Button
                                  variant="plain"
                                  color="neutral"
                                  size="sm"
                                  onClick={(s) => {
                                    s.setScalar("editing_partner", false);
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Show when={sql`item.partner_id is not null`}>
                                  <Button
                                    variant="plain"
                                    color="danger"
                                    size="sm"
                                    loading={sql`saving_partner`}
                                    onClick={(s) => {
                                      s.setScalar("saving_partner", true);
                                      s.commitUiTreeChanges();

                                      s.tryServer({
                                        body: (s) => {
                                          s.startTransaction();

                                          if (
                                            block.hasPipelineActivityLogEnabled(
                                              pipeline.name,
                                            )
                                          ) {
                                            s.defScalar(
                                              "detached_partner_name",
                                              sql`coalesce((select name from db.crm_partners where id = (select partner_id from db.${
                                                sql.ref(itemsTable)
                                              } where id = ui.record_id)), 'Unknown')`,
                                            );
                                          }

                                          s.modify(sql`
                                          update db.${sql.ref(itemsTable)}
                                          set
                                            partner_id = null,
                                            partner_attached = false,
                                            last_modified_at = now()
                                          where id = ui.record_id
                                        `);

                                          if (
                                            block.hasPipelineActivityLogEnabled(
                                              pipeline.name,
                                            )
                                          ) {
                                            s.modify(sql`
                                            insert into db.${
                                              sql.ref(
                                                block
                                                  .pipelineActivityLogTableName,
                                              )
                                            }
                                              (pipeline_item_id, activity_type, description, sys_user_id, created_at)
                                            values
                                              (ui.record_id, 'partner_detached', 'Detached partner ' || detached_partner_name, current_user, now())
                                          `);
                                          }

                                          s.commitTransaction();
                                          s.increment("ui.refresh_key");
                                        },
                                        finally: (s) => {
                                          s.setScalar("saving_partner", false);
                                          s.setScalar("editing_partner", false);
                                        },
                                      });
                                    }}
                                  >
                                    Detach
                                  </Button>
                                </Show>
                              </div>
                            </div>
                          }
                        >
                          <div className="flex items-center justify-between">
                            <Typography
                              level="body-xs"
                              className="text-tertiary"
                            >
                              Partner
                            </Typography>
                            <IconButton
                              variant="plain"
                              color="neutral"
                              size="sm"
                              icon="Edit"
                              onClick={(s) => {
                                s.setScalar(
                                  "selected_partner_id",
                                  sql`item.partner_id`,
                                );
                                s.setScalar("editing_partner", true);
                              }}
                            />
                          </div>
                          <Show
                            when={sql`item.partner_id is not null`}
                            fallback={
                              <Typography
                                level="body-sm"
                                className="text-tertiary"
                              >
                                No partner attached
                              </Typography>
                            }
                          >
                            <div className="flex items-center gap-2">
                              <MaterialIcon
                                icon="Handshake"
                                className="text-primary-500 text-sm"
                              />
                              <Typography level="body-sm">
                                {sql`coalesce(partner_name, 'Partner #' || item.partner_id)`}
                              </Typography>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    </>
                  );
                })()}
                <Divider />
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    Entered Pipeline
                  </Typography>
                  <Typography level="body-sm">
                    {sql`format.date(item.entered_pipeline_at, '%b %d, %Y')`}
                  </Typography>
                </div>
                <div>
                  <Typography level="body-xs" className="text-tertiary">
                    In Current Stage
                  </Typography>
                  <Typography level="body-sm">
                    {sql`format.date(item.entered_stage_at, '%b %d, %Y')`}
                  </Typography>
                </div>
              </div>
            </Card>

            {block.hasPipelineActivityLogEnabled(pipeline.name) && (
              <>
                <Card variant="outlined">
                  <CardHeader>
                    <Typography startIcon="History" level="title-md">
                      Activity
                    </Typography>
                  </CardHeader>
                  <div className="p-4 max-h-96 overflow-y-auto">
                    <PipelineActivityLog
                      block={block}
                      itemId={sql`ui.record_id`}
                      refreshKey={sql`refresh_key`}
                    />
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>

        <MoveStageDialog
          block={block}
          pipeline={pipeline}
          itemId={sql`ui.record_id`}
          onMoved={(s) => s.increment("refresh_key")}
        />

        <AssignmentDialog
          block={block}
          pipeline={pipeline}
          itemId={sql`ui.record_id`}
          onAssigned={(s) => s.increment("refresh_key")}
        />
      </Data>
    </Data>
  );
}

interface MoveStageDialogProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  onMoved: (s: UiServerStatements) => void;
}

function MoveStageDialog(props: MoveStageDialogProps) {
  const { block, pipeline } = props;

  const anyStageHasExitCriteria = pipeline.stages.some(
    (s) => s.exitCriteria && s.exitCriteria.length > 0,
  );

  return (
    <ModalDialog bindScalar="show_move_dialog">
      <Data
        local
        procedure={(s) => {
          s.defScalar("saving", false);
          s.defScalar("error", { type: "String" });
        }}
      >
        <Typography level="h4" className="mb-4">Move to Stage</Typography>

        <div className="space-y-2 mb-4">
          {pipeline.stages.map((stage) => {
            const stageColor = stage.color ?? "#3B82F6";
            const stageColorWithAlpha = `${stageColor}15`;
            return (
              <div
                className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-level1 transition-colors"
                style={{
                  backgroundColor: sql`case when selected_stage = ${
                    sql.lit(stage.name)
                  } then ${
                    sql.lit(stageColorWithAlpha)
                  } else 'transparent' end`,
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: sql`case when selected_stage = ${
                    sql.lit(stage.name)
                  } then ${sql.lit(stageColor)} else 'transparent' end`,
                }}
                onClick={(s) => {
                  s.setScalar("selected_stage", sql.lit(stage.name));
                  s.setScalar("error", sql.null);
                }}
              >
                {stage.icon && (
                  <MaterialIcon
                    icon={stage.icon}
                    style={{ color: stage.color ?? "#6B7280" }}
                  />
                )}
                <div className="flex-1">
                  <Typography level="body-sm" className="font-medium">
                    {stage.displayName ?? toDisplayName(stage.name)}
                  </Typography>
                  {stage.description && (
                    <Typography level="body-xs" className="text-tertiary">
                      {stage.description}
                    </Typography>
                  )}
                </div>
                <Show when={sql`selected_stage = ${sql.lit(stage.name)}`}>
                  <MaterialIcon
                    icon="CheckCircle"
                    className="text-primary-500"
                  />
                </Show>
                <Show when={sql`item.stage_name = ${sql.lit(stage.name)}`}>
                  <Typography level="body-xs" className="text-tertiary">
                    Current
                  </Typography>
                </Show>
              </div>
            );
          })}
        </div>

        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mb-4">{sql`error`}</Alert>
        </Show>

        {anyStageHasExitCriteria && (
          <Show
            when={sql`${
              sql.caseWhen({
                conditions: pipeline.stages.map((stage, index) => ({
                  condition: sql`selected_stage = ${sql.lit(stage.name)}`,
                  expr: index,
                })),
                default: sql`0`,
              })
            } > ${
              sql.caseWhen({
                conditions: pipeline.stages.map((stage, index) => ({
                  condition: sql`item.stage_name = ${sql.lit(stage.name)}`,
                  expr: index,
                })),
                default: sql`0`,
              })
            } and selected_stage != item.stage_name`}
          >
            <Alert
              color="neutral"
              variant="soft"
              className="mb-4"
              startDecorator={<MaterialIcon icon="Info" />}
            >
              <Typography level="body-xs">
                Moving forward requires completing exit criteria for your
                current stage.
              </Typography>
            </Alert>
          </Show>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("show_move_dialog", false)}
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            color="primary"
            loading={sql`saving`}
            onClick={(s) => {
              s.setScalar("saving", true);
              s.commitUiTreeChanges();

              s.tryServer({
                errorName: "move_error",
                body: (s) => {
                  s.startTransaction();

                  s.callStoredProcedure(
                    movePipelineItemProcedureName(block, pipeline.name),
                    {
                      inputScalars: {
                        p_item_id: props.itemId,
                        p_stage: sql`selected_stage`,
                        p_reorder: sql`false`,
                        p_target_item_id: sql.null,
                        p_drop_position: sql.null,
                      },
                    },
                  );

                  s.commitTransaction();
                  props.onMoved(s);
                  s.setScalar("show_move_dialog", false);
                },
                catch: (s) => {
                  s.setScalar("error", sql`move_error.message`);
                },
                finally: (s) => {
                  s.setScalar("saving", false);
                },
              });
            }}
          >
            Move
          </Button>
        </div>
      </Data>
    </ModalDialog>
  );
}

interface AssignmentDialogProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  onAssigned: (s: UiServerStatements) => void;
}

function AssignmentDialog(props: AssignmentDialogProps) {
  const { block, pipeline } = props;
  const itemsTable = block.pipelineItemsTableName;
  const activityLogTable = block.pipelineActivityLogTableName;
  const hasActivityLog = block.hasPipelineActivityLogEnabled(pipeline.name);

  return (
    <ModalDialog bindScalar="show_assign_dialog">
      <Data
        procedure={(s) => {
          s.defScalar("saving", false);
          s.defScalar("error", { type: "String" });
          s.defScalar(
            "selected_user_display_name",
            sql`coalesce((select display_name_virtual from db.sys_users where id = selected_user_id), 'User #' || selected_user_id)`,
          );
        }}
        watch={[sql`selected_user_id`]}
      >
        <Typography level="h4" className="mb-4">Assign To</Typography>

        <div className="mb-4">
          <Typography level="body-sm" className="text-tertiary mb-2">
            Select a team member to assign this item to
          </Typography>
          <TableRecordSelect
            tableName="sys_users"
            value={sql`selected_user_id`}
            onSelectValue={(s, value) => {
              s.setScalar("selected_user_id", value);
            }}
            placeholder="Search users..."
          />
        </div>

        <Show when={sql`selected_user_id is not null`}>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary-50 mb-4">
            <MaterialIcon icon="Person" className="text-primary-500" />
            <div>
              <Typography level="body-sm" className="font-medium">
                {sql`selected_user_display_name`}
              </Typography>
            </div>
          </div>
        </Show>

        <Show when={sql`error is not null`}>
          <Alert color="danger" className="mb-4">{sql`error`}</Alert>
        </Show>

        <div className="flex justify-between gap-2">
          <Show when={sql`item.assigned_to is not null`}>
            <Button
              variant="plain"
              color="danger"
              onClick={(s) => {
                s.setScalar("saving", true);
                s.commitUiTreeChanges();

                s.tryServer({
                  body: (s) => {
                    s.startTransaction();

                    if (hasActivityLog) {
                      s.defScalar(
                        "prev_assigned_name",
                        sql`coalesce((select display_name_virtual from db.sys_users where id = (select assigned_to from db.${
                          sql.ref(itemsTable)
                        } where id = ${props.itemId})), 'Unknown')`,
                      );
                    }

                    s.modify(sql`
                      update db.${sql.ref(itemsTable)}
                      set
                        assigned_to = null,
                        last_modified_at = now()
                      where id = ${props.itemId}
                    `);

                    if (hasActivityLog) {
                      s.modify(sql`
                        insert into db.${sql.ref(activityLogTable)}
                          (pipeline_item_id, activity_type, description, sys_user_id, created_at)
                        values
                          (${props.itemId}, 'unassigned', 'Unassigned from ' || prev_assigned_name, current_user, now())
                      `);
                    }

                    s.commitTransaction();
                    props.onAssigned(s);
                    s.setScalar("show_assign_dialog", false);
                  },
                  catch: (s) => {
                    s.setScalar("error", sql.lit`Failed to unassign`);
                  },
                  finally: (s) => {
                    s.setScalar("saving", false);
                  },
                });
              }}
            >
              Unassign
            </Button>
          </Show>
          <div className="flex-1" />
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("show_assign_dialog", false)}
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            color="primary"
            loading={sql`saving`}
            disabled={sql`selected_user_id is null`}
            onClick={(s) => {
              s.setScalar("saving", true);
              s.commitUiTreeChanges();

              s.tryServer({
                body: (s) => {
                  s.startTransaction();

                  if (hasActivityLog) {
                    s.defScalar(
                      "prev_assigned_to",
                      sql`(select assigned_to from db.${
                        sql.ref(itemsTable)
                      } where id = ${props.itemId})`,
                    );
                  }
                  if (hasActivityLog) {
                    s.defScalar(
                      "new_assigned_name",
                      sql`coalesce((select display_name_virtual from db.sys_users where id = selected_user_id), 'User #' || selected_user_id)`,
                    );
                  }

                  s.modify(sql`
                    update db.${sql.ref(itemsTable)}
                    set
                      assigned_to = selected_user_id,
                      last_modified_at = now()
                    where id = ${props.itemId}
                  `);

                  if (hasActivityLog) {
                    s.if(
                      sql`prev_assigned_to is null or prev_assigned_to != selected_user_id`,
                      (s) => {
                        s.modify(sql`
                        insert into db.${sql.ref(activityLogTable)}
                          (pipeline_item_id, activity_type, description, sys_user_id, created_at)
                        values
                          (${props.itemId}, 'assigned', 'Assigned to ' || new_assigned_name, current_user, now())
                      `);
                      },
                    );
                  }

                  s.commitTransaction();
                  props.onAssigned(s);
                  s.setScalar("show_assign_dialog", false);
                },
                catch: (s) => {
                  s.setScalar("error", sql.lit`Failed to assign`);
                },
                finally: (s) => {
                  s.setScalar("saving", false);
                },
              });
            }}
          >
            Assign
          </Button>
        </div>
      </Data>
    </ModalDialog>
  );
}

interface PipelineActivityLogProps {
  block: CrmBlock;
  itemId: NumericExpr;
  refreshKey?: NumericExpr;
}

function PipelineActivityLog(props: PipelineActivityLogProps) {
  const activityLogTable = props.block.pipelineActivityLogTableName;

  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "activities",
          sql`select * from db.${sql.ref(activityLogTable)}
              where pipeline_item_id = ${props.itemId}
              order by created_at desc
              limit 20`,
        );
      }}
      watch={props.refreshKey ? [props.refreshKey] : undefined}
    >
      <div className="space-y-3">
        <Show
          when={sql`(select count(*) from activities) = 0`}
        >
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
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <Switch>
                <Match when={sql`activity.activity_type = 'stage_changed'`}>
                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="SwapHoriz"
                      className="text-primary-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'item_created'`}>
                  <div className="w-8 h-8 rounded-full bg-success-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="Add"
                      className="text-success-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'task_completed'`}>
                  <div className="w-8 h-8 rounded-full bg-success-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="CheckCircle"
                      className="text-success-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'task_uncompleted'`}>
                  <div className="w-8 h-8 rounded-full bg-warning-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="Undo"
                      className="text-warning-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'field_updated'`}>
                  <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="Edit"
                      className="text-neutral-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'assigned'`}>
                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="PersonAdd"
                      className="text-primary-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'unassigned'`}>
                  <div className="w-8 h-8 rounded-full bg-warning-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="PersonRemove"
                      className="text-warning-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'partner_attached'`}>
                  <div className="w-8 h-8 rounded-full bg-success-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="Handshake"
                      className="text-success-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql`activity.activity_type = 'partner_detached'`}>
                  <div className="w-8 h-8 rounded-full bg-warning-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="LinkOff"
                      className="text-warning-600 text-sm"
                    />
                  </div>
                </Match>
                <Match when={sql.true}>
                  <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                    <MaterialIcon
                      icon="Circle"
                      className="text-neutral-600 text-sm"
                    />
                  </div>
                </Match>
              </Switch>
            </div>
            <div className="flex-1 min-w-0">
              <Switch>
                <Match when={sql`activity.activity_type = 'stage_changed'`}>
                  <Typography level="body-sm">
                    Moved from{" "}
                    <strong>
                      {sql`string.capitalize(replace(activity.from_stage, '_', ' '))`}
                    </strong>
                    {" to "}
                    <strong>
                      {sql`string.capitalize(replace(activity.to_stage, '_', ' '))`}
                    </strong>
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'item_created'`}>
                  <Typography level="body-sm">
                    Added to pipeline
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'task_completed'`}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'task_uncompleted'`}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'assigned'`}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'unassigned'`}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'partner_attached'`}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
                <Match when={sql`activity.activity_type = 'partner_detached'`}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
                <Match when={sql.true}>
                  <Typography level="body-sm">
                    {sql`activity.description`}
                  </Typography>
                </Match>
              </Switch>
              <Typography level="body-xs" className="text-tertiary">
                {sql`format.date(activity.created_at, '%b %d, %Y')`}
              </Typography>
            </div>
          </div>
        </Each>
      </div>
    </Data>
  );
}
