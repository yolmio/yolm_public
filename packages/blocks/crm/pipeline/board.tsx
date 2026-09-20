import { Button } from "components/button";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Sheet } from "components/sheet";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { CurrentRefetchICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { createStyles, cssVar } from "std/style_utils";
import { system } from "std/system";
import { Each, Show, useICtx } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import type { PipelineConfig, PipelineStageConfig } from "./types";
import { CrmBlock } from "../index";
import type { IServerBaseStatements } from "std/statements";
import { movePipelineItemProcedureName } from "./stored_procedures";
import { toDisplayName } from "../helpers";

/**
 * Insert the `autoTasksOnEntry` tasks for `stageName` against
 * `itemId`. Call from server-side procedures that move a pipeline item
 * into a new stage so the tasks declared in the pipeline config land
 * automatically.
 */
export function createAutoTasksForStage<T extends IServerBaseStatements>(
  s: T,
  params: {
    block: CrmBlock;
    pipeline: PipelineConfig;
    stageName: string;
    itemId: NumericExpr;
    activityLogTable: string;
  },
) {
  const { block, pipeline, stageName, itemId, activityLogTable } = params;
  const stage = pipeline.stages.find((st) => st.name === stageName);
  if (!stage?.autoTasksOnEntry || stage.autoTasksOnEntry.length === 0) {
    return;
  }

  const tasksTable = block.pipelineTasksTableName;
  const hasActivityLog = block.hasPipelineActivityLogEnabled(pipeline.name);

  for (const task of stage.autoTasksOnEntry) {
    const dueDate = task.dueDaysFromNow !== undefined
      ? sql`date.add(day, ${task.dueDaysFromNow}, current_date())`
      : sql.null;

    const priority = task.priority ?? "medium";

    s.modify(sql`
      insert into db.${sql.ref(tasksTable)}
        (pipeline_item_id, title, description, due_date, priority, created_by, created_at)
      values
        (${itemId}, ${sql.lit(task.title)}, ${
      task.description ? sql.lit(task.description) : sql.null
    }, ${dueDate}, ${sql.lit(priority)}, current_user, now())
    `);

    if (hasActivityLog) {
      s.modify(sql`
        insert into db.${sql.ref(activityLogTable)}
          (pipeline_item_id, activity_type, description, sys_user_id, created_at)
        values
          (${itemId}, 'task_created', ${
        sql.concat(sql.lit`Auto-created task: `, sql.lit(task.title))
      }, current_user, now())
      `);
    }

    block.opts.debugHooks?.afterPipelineAutoTaskCreated?.(s, {
      pipelineName: pipeline.name,
      stageName,
      itemId,
      title: task.title,
    });
  }
}

const styles = createStyles({
  board: {
    width: "100%",
    display: "flex",
    gap: 4,
    overflowX: "auto",
    pb: 4,
    scrollbarWidth: "thin",
    minHeight: 400,
  },
  column: {
    width: 300,
    minWidth: 300,
    backgroundColor: cssVar("palette-background-level1"),
    borderRadius: "md",
    px: 2,
    pt: 2,
    pb: 4,
    flexShrink: 0,
    borderWidth: 2,
    borderColor: "transparent",
    borderStyle: "dashed",
    boxShadow: "sm",
    "&.drag-over": {
      borderColor: cssVar("palette-primary-400"),
    },
    height: "fit-content",
    maxHeight: "calc(100vh - 200px)",
    overflowY: "auto",
  },
  card: {
    listStyle: "none",
    borderTop: "2px solid",
    borderBottom: "2px solid",
    borderColor: "transparent",
    "&.top": {
      borderColor: cssVar("palette-primary-400"),
      borderBottomColor: "transparent",
    },
    "&.bottom": {
      borderColor: cssVar("palette-primary-400"),
      borderTopColor: "transparent",
    },
    "&:last-child": {
      mb: 2,
    },
  },
  cardContent: {
    backgroundColor: "neutral-100",
    borderRadius: "sm",
    p: 3,
    mb: 2,
    mt: 2,
    cursor: "pointer",
    boxShadow: "sm",
    transition: "all 0.15s ease",
    "&:hover": {
      boxShadow: "md",
      transform: "translateY(-1px)",
    },
  },
});

interface PipelineBoardProps {
  pipelineName: string;
  header?: Node;
  renderCardContents?: (itemRecord: string) => Node;
  onItemClick?: (s: DomStatements, itemId: NumericExpr) => void;
  entityFilter?: {
    type: "organization" | "person";
    id: NumericExpr;
  };
  where?: BooleanExpr;
  showAddButton?: boolean;
  onAddClick?: (s: DomStatements, stageName: string) => void;
}

/**
 * Kanban-style board for a pipeline declared on {@link CrmBlock}.
 * Renders one column per stage, drag-and-drop between stages, and an
 * optional add button.
 */
export function PipelineBoard(props: PipelineBoardProps) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(props.pipelineName);

  if (!pipeline) {
    throw new Error(`Pipeline "${props.pipelineName}" not found`);
  }

  return (
    <PipelineRefreshKeyState>
      <div className="p-4">
        {props.header}
        <div sx={styles.board}>
          <Data
            local
            procedure={(s) => {
              s.defScalar("dragging_item", { type: "BigInt" });
              s.defScalar("error_move_item", { type: "String" });
              s.defScalar("main_drop_target", sql.lit`none`);
              s.defScalar("drop_target_id", { type: "BigInt" });
              s.defScalar("dragging_card_id", { type: "BigInt" });
              s.defScalar("drop_accept_position", sql.lit`none`);
            }}
            watch={[sql`pipeline_refresh_key`]}
          >
            {pipeline.stages.map((stage) => (
              <PipelineStageColumn
                pipeline={pipeline}
                stage={stage}
                block={block}
                entityFilter={props.entityFilter}
                where={props.where}
                renderCardContents={props.renderCardContents}
                onItemClick={props.onItemClick}
                showAddButton={props.showAddButton}
                onAddClick={props.onAddClick}
              />
            ))}
            <Show when={sql`error_move_item is not null`}>
              <Snackbar
                color="danger"
                variant="soft"
                anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
                startDecorator={<MaterialIcon icon="Error" />}
                onMount={(s) => {
                  s.sleep(6000);
                  s.setScalar("error_move_item", sql.null);
                }}
              >
                <div>
                  <Typography level="title-sm">Cannot move item</Typography>
                  <Typography level="body-sm">
                    {sql`error_move_item`}
                  </Typography>
                </div>
              </Snackbar>
            </Show>
          </Data>
        </div>
      </div>
    </PipelineRefreshKeyState>
  );
}

interface PipelineStageColumnProps {
  pipeline: PipelineConfig;
  stage: PipelineStageConfig;
  block: CrmBlock;
  entityFilter?: {
    type: "organization" | "person";
    id: NumericExpr;
  };
  where?: BooleanExpr;
  renderCardContents?: (itemRecord: string) => Node;
  onItemClick?: (s: DomStatements, itemId: NumericExpr) => void;
  showAddButton?: boolean;
  onAddClick?: (s: DomStatements, stageName: string) => void;
}

function PipelineStageColumn(props: PipelineStageColumnProps) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { block, pipeline, stage } = props;
  const itemsTable = block.pipelineItemsTableName;
  const organizationsTable = block.organizationsTableName;
  const peopleTable = block.peopleTableName;
  const tasksTable = block.pipelineTasksTableName;
  const itemFkColumn = block.pipelineItemFkColumnName;
  const hasTasksEnabled = block.hasPipelineTasksEnabled(pipeline.name);
  const stageName = stage.name;
  const stageDisplayName = stage.displayName ?? toDisplayName(stageName);

  const baseWhere = sql`i.pipeline_name = ${
    sql.lit(pipeline.name)
  } and i.stage_name = ${sql.lit(stageName)}`;
  const entityFilterWhere = props.entityFilter
    ? sql`${baseWhere} and i.entity_type = ${
      sql.lit(props.entityFilter.type)
    } and ${
      props.entityFilter.type === "organization"
        ? sql`i.organization_id = ${props.entityFilter.id}`
        : sql`i.person_id = ${props.entityFilter.id}`
    }`
    : baseWhere;
  const whereClause = props.where
    ? sql`${entityFilterWhere} and ${props.where}`
    : entityFilterWhere;

  const taskCountExpr = hasTasksEnabled
    ? sql`(select count(*) from db.${sql.ref(tasksTable)} where ${
      sql.ref(itemFkColumn)
    } = i.id and not completed)`
    : sql`0`;

  return (
    <Data
      procedure={(s) => {
        s.defScalar("is_drag_over", false);
        s.defTable(
          "stage_items",
          sql`select
                i.id,
                i.pipeline_name,
                i.stage_name,
                i.entity_type,
                i.organization_id,
                i.person_id,
                i.stage_order,
                i.assigned_to,
                i.expected_close_date,
${
            pipeline.opportunityFields
              ? sql`i.opportunity_name`
              : sql`cast(null as string)`
          } as opportunity_name,
${
            pipeline.opportunityFields
              ? sql`i.estimated_value`
              : sql`cast(null as decimal)`
          } as estimated_value,
${
            pipeline.opportunityFields
              ? sql`i.probability_pct`
              : sql`cast(null as int)`
          } as probability_pct,
${
            pipeline.opportunityFields
              ? sql`i.risk_level`
              : sql`cast(null as string)`
          } as risk_level,
                case
                  when i.entity_type = 'organization' then ${
            system.db.tables[organizationsTable]
              ? sql`org.name`
              : sql`cast(null as string)`
          }
                  else concat(person.first_name, ' ', person.last_name)
                end as entity_name,
                ${taskCountExpr} as task_count
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
              where ${whereClause}
              order by i.stage_order asc`,
        );
      }}
    >
      <Sheet
        sx={styles.column}
        variant="soft"
        color="neutral"
        harmonize
        style={{
          ...(props.stage.color
            ? { borderTop: `4px solid ${props.stage.color}` }
            : {}),
        }}
        dynamicClasses={[
          {
            classes: "drag-over",
            condition:
              sql`is_drag_over and (select count(*) from stage_items) = 0`,
          },
        ]}
        onDragOver={(s) => {
          s.event.preventDefault();
          s.setScalar("is_drag_over", true);
        }}
        onDragLeave={(s) => {
          s.setScalar("is_drag_over", false);
        }}
        onDrop={(s) => {
          s.event.preventDefault();
          s.setScalar("is_drag_over", false);
          s.if(sql`dragging_item is not null`, (s) => {
            moveItemToStage(s, {
              block: props.block,
              pipelineName: props.pipeline.name,
              targetStageName: stageName,
              triggerRefetch,
            });
          });
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {props.stage.icon && (
              <MaterialIcon
                icon={props.stage.icon}
                style={{ color: props.stage.color }}
              />
            )}
            <Typography level="title-md" className="text-black">
              {stageDisplayName}
            </Typography>
          </div>
          <Chip color="neutral" size="sm" variant="soft">
            {sql`(select count(*) from stage_items)`}
          </Chip>
        </div>

        <Each
          table="stage_items"
          recordName="item"
          eachKey={sql`item.id`}
          orderBy={sql`item.stage_order asc`}
        >
          <PipelineItemCard
            block={props.block}
            pipeline={props.pipeline}
            stage={props.stage}
            renderCardContents={props.renderCardContents}
            onItemClick={props.onItemClick}
          />
        </Each>

        <Show when={sql`(select count(*) from stage_items) = 0`}>
          <div className="text-center py-8 text-neutral-500">
            <MaterialIcon icon="Inbox" className="text-3xl mb-2 opacity-50" />
            <Typography level="body-sm">No items in this stage</Typography>
          </div>
        </Show>

        <Show when={sql`${props.showAddButton ?? false}`}>
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            startIcon="Add"
            className="w-full mt-2 justify-start"
            onClick={(s) => {
              if (props.onAddClick) {
                props.onAddClick(s, stageName);
              }
            }}
          >
            Add item
          </Button>
        </Show>
      </Sheet>
    </Data>
  );
}

interface PipelineItemCardProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  stage: PipelineStageConfig;
  renderCardContents?: (itemRecord: string) => Node;
  onItemClick?: (s: DomStatements, itemId: NumericExpr) => void;
}

function PipelineItemCard(props: PipelineItemCardProps) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);

  return (
    <div
      sx={styles.card}
      dynamicClasses={[
        {
          classes: "top",
          condition:
            sql`drop_target_id = item.id and drop_accept_position = 'top'`,
        },
        {
          classes: "bottom",
          condition:
            sql`drop_target_id = item.id and drop_accept_position = 'bottom'`,
        },
      ]}
    >
      <div
        sx={styles.cardContent}
        id={sql`'pipeline_item_' || item.id`}
        draggable={sql`dragging_card_id = item.id`}
        onClick={(s) => {
          s.defScalar("item_event_id", {
            expr: sql`item.id`,
            allowNoRead: true,
          });
          if (props.onItemClick) {
            props.onItemClick(s, sql`item_event_id`);
          }
        }}
        onMouseDown={(s) => {
          s.setScalar("dragging_card_id", sql`item.id`);
        }}
        onMouseUp={(s) => {
          s.setScalar("dragging_card_id", sql.null);
          s.setScalar("drop_accept_position", sql.lit`none`);
        }}
        onDragStart={(s) => {
          s.setScalar("dragging_item", sql`item.id`);
        }}
        onDragEnd={(s) => {
          s.setScalar("dragging_item", sql.null);
          s.setScalar("dragging_card_id", sql.null);
          s.setScalar("drop_accept_position", sql.lit`none`);
        }}
        onDragLeave={(s) => {
          s.if(sql`drop_target_id = item.id`, (s) => {
            s.setScalar("drop_accept_position", sql.lit`none`);
          });
        }}
        onDragOver={(s) => {
          s.event.preventDefault();
          s.element(sql`'pipeline_item_' || item.id`).getBoundingClientRect(
            "rect",
          );
          s.defScalar("midpoint", sql`rect.top + (rect.bottom - rect.top) / 2`);
          s.setScalar(
            "drop_accept_position",
            sql`case when event.client_y <= midpoint then 'top' else 'bottom' end`,
          );
          s.setScalar("main_drop_target", sql`drop_accept_position`);
          s.setScalar("drop_target_id", sql`item.id`);
        }}
        onDrop={(s) => {
          s.defScalar("item_event_id", {
            expr: sql`item.id`,
            allowNoRead: true,
          });
          s.setScalar("drop_accept_position", sql.lit`none`);
          s.if(
            sql`dragging_item is not null and dragging_item != item_event_id`,
            (s) => {
              moveItemToStage(s, {
                block: props.block,
                pipelineName: props.pipeline.name,
                targetStageName: props.stage.name,
                triggerRefetch,
                targetItemId: sql`item_event_id`,
                dropPosition: sql`main_drop_target`,
              });
            },
          );
        }}
      >
        {props.renderCardContents
          ? props.renderCardContents("item")
          : (
            <DefaultPipelineCardContent
              block={props.block}
              itemRecord="item"
            />
          )}
      </div>
    </div>
  );
}

interface DefaultPipelineCardContentProps {
  block: CrmBlock;
  itemRecord: string;
}

function DefaultPipelineCardContent(props: DefaultPipelineCardContentProps) {
  const { itemRecord } = props;
  const itemRef = sql.ref(itemRecord);
  const entityType = sql`${itemRef}.entity_type`;
  const assignedToId = sql`${itemRef}.assigned_to`;
  const expectedCloseDate = sql`${itemRef}.expected_close_date`;
  const entityName = sql`${itemRef}.entity_name`;
  const taskCount = sql`${itemRef}.task_count`;
  const opportunityName = sql`${itemRef}.opportunity_name`;
  const estimatedValue = sql`${itemRef}.estimated_value`;
  const probabilityPct = sql`${itemRef}.probability_pct`;
  const riskLevel = sql`${itemRef}.risk_level`;

  return (
    <div className="flex flex-col gap-2">
      {/* Opportunity name (if set) or Entity name */}
      <Show when={sql`${opportunityName} is not null`}>
        <Typography level="body-sm" className="font-semibold text-neutral-900">
          {opportunityName}
        </Typography>
      </Show>

      <div className="flex items-center gap-2">
        <Show when={sql`${entityType} = 'organization'`}>
          <MaterialIcon icon="Business" className="text-primary-500 text-sm" />
        </Show>
        <Show when={sql`${entityType} = 'person'`}>
          <MaterialIcon icon="Person" className="text-primary-500 text-sm" />
        </Show>
        <Show when={sql`${opportunityName} is not null`}>
          <Typography level="body-xs" className="text-tertiary">
            {entityName}
          </Typography>
        </Show>
        <Show when={sql`${opportunityName} is null`}>
          <Typography level="body-xs" className="font-medium text-neutral-900">
            {entityName}
          </Typography>
        </Show>
      </div>

      {/* Value and probability */}
      <Show
        when={sql`${estimatedValue} is not null or ${probabilityPct} is not null`}
      >
        <div className="flex items-center gap-3 text-xs">
          <Show when={sql`${estimatedValue} is not null`}>
            <div className="flex items-center gap-1 text-success-600 font-medium">
              <span>${sql`${estimatedValue}`}</span>
            </div>
          </Show>
          <Show when={sql`${probabilityPct} is not null`}>
            <div className="flex items-center gap-1 text-neutral-500">
              <span>{probabilityPct}%</span>
            </div>
          </Show>
          <Show when={sql`${riskLevel} = 'high'`}>
            <div className="text-danger-600">High</div>
          </Show>
          <Show when={sql`${riskLevel} = 'medium'`}>
            <div className="text-warning-600">Medium</div>
          </Show>
          <Show when={sql`${riskLevel} = 'low'`}>
            <div className="text-success-600">Low</div>
          </Show>
        </div>
      </Show>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <Show when={sql`${assignedToId} is not null`}>
          <div className="flex items-center gap-1">
            <MaterialIcon icon="AccountCircle" className="text-sm" />
            <span>Assigned</span>
          </div>
        </Show>
        <Show when={sql`${taskCount} > 0`}>
          <div className="flex items-center gap-1">
            <MaterialIcon icon="CheckCircleOutline" className="text-sm" />
            <span>{taskCount} tasks</span>
          </div>
        </Show>
      </div>

      <Show when={sql`${expectedCloseDate} is not null`}>
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <MaterialIcon icon="Event" className="text-sm" />
          <span>{sql`format.date(${expectedCloseDate}, '%b %d, %Y')`}</span>
        </div>
      </Show>
    </div>
  );
}

interface MoveItemToStageParams {
  block: CrmBlock;
  pipelineName: string;
  targetStageName: string;
  triggerRefetch: (s: UiServerStatements) => void;
  targetItemId?: NumericExpr;
  dropPosition?: Sql;
}

function moveItemToStage(s: DomStatements, params: MoveItemToStageParams) {
  s.tryServer({
    errorName: "move_error",
    body: (s) => {
      s.startTransaction();

      s.callStoredProcedure(
        movePipelineItemProcedureName(params.block, params.pipelineName),
        {
          inputScalars: {
            p_item_id: sql`dragging_item`,
            p_stage: sql.lit(params.targetStageName),
            p_reorder: sql`true`,
            p_target_item_id: params.targetItemId ?? sql.null,
            p_drop_position: params.dropPosition ?? sql.null,
          },
        },
      );

      s.commitTransaction();
      params.triggerRefetch(s);
    },
    finally: (s) => {
      s.setScalar("dragging_item", sql.null);
    },
    catch: (s) => {
      s.setScalar("error_move_item", sql`move_error.message`);
    },
  });
}

function PipelineRefreshKeyState(props: { children: Node }) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("pipeline_refresh_key", 0);
      }}
    >
      {props.children}
    </Data>
  );
}

/**
 * Extended fields for pipeline items.
 * These are enabled when a pipeline has `opportunityFields: {}`.
 */
export interface ExtendedItemFields {
  itemName?: Sql;
  estimatedValue?: Sql;
  probabilityPct?: Sql;
  expectedCloseDate?: Sql;
  riskLevel?: Sql;
  successMetricsDefined?: Sql;
  businessCaseScore?: Sql;
  competitiveLandscape?: Sql;
  useCaseCategory?: Sql;
  partnerId?: Sql;
}

interface AddToPipelineParams {
  pipelineName: string;
  entityType: "organization" | "person";
  entityId: NumericExpr;
  stageName?: string;
  /** Extended fields for the pipeline item */
  extendedFields?: ExtendedItemFields;
  onSuccess?: (s: UiServerStatements, itemId: NumericExpr) => void;
}

/**
 * Server-side helper that inserts `entityId` into `pipelineName` at the
 * given (or first) stage, optionally writes the extended fields, and
 * fires any auto-tasks the stage declares. Call from server hooks (e.g.
 * `afterTransactionCommit`) where you want a record to enter a CRM
 * pipeline.
 */
export function addToPipeline(
  s: UiServerStatements,
  params: AddToPipelineParams,
) {
  const block = system.block(CrmBlock);
  const pipeline = block.getPipeline(params.pipelineName);

  if (!pipeline) {
    throw new Error(`Pipeline "${params.pipelineName}" not found`);
  }

  const stageName = params.stageName ?? pipeline.stages[0].name;
  const entryStage = pipeline.stages.find((stage) => stage.name === stageName);
  if (!entryStage || !pipeline.entityTypes.includes(params.entityType)) {
    throw new Error(
      `Invalid stage or entity type for CRM pipeline "${pipeline.name}".`,
    );
  }
  const itemsTable = block.pipelineItemsTableName;
  const activityLogTable = block.pipelineActivityLogTableName;
  const itemFkColumn = block.pipelineItemFkColumnName;
  const hasActivityLog = block.hasPipelineActivityLogEnabled(
    params.pipelineName,
  );
  const hasOpportunityFields = !!pipeline.opportunityFields;
  const hasPartnerAttachment = pipeline.enablePartnerAttachment;
  const extFields = params.extendedFields;

  s.defScalar(
    "new_order",
    sql`coalesce(
      ordering.new((select stage_order from db.${sql.ref(itemsTable)}
        where pipeline_name = ${sql.lit(params.pipelineName)}
        and stage_name = ${sql.lit(stageName)}
        order by stage_order desc limit 1)),
      ordering.new()
    )`,
  );

  const baseColumns =
    sql`pipeline_name, stage_name, entity_type, stage_order, created_by, entered_pipeline_at, entered_stage_at, created_at, last_modified_at`;
  const baseValues = sql`${sql.lit(params.pipelineName)}, ${
    sql.lit(stageName)
  }, ${
    sql.lit(params.entityType)
  }, new_order, current_user, now(), now(), now(), now()`;

  const extColumns = hasOpportunityFields
    ? sql`, opportunity_name, estimated_value, probability_pct, expected_close_date, risk_level`
    : sql``;
  const extValues = hasOpportunityFields
    ? sql`, ${extFields?.itemName ?? sql.null}, ${
      extFields?.estimatedValue ?? sql.null
    }, ${extFields?.probabilityPct ?? sql.null}, ${
      extFields?.expectedCloseDate ?? sql.null
    }, ${extFields?.riskLevel ?? sql.null}`
    : sql``;
  const qualificationColumns = pipeline.opportunityFields?.qualification
    ? sql`, success_metrics_defined, business_case_score, competitive_landscape, use_case_category`
    : sql``;
  const qualificationValues = pipeline.opportunityFields?.qualification
    ? sql`, ${extFields?.successMetricsDefined ?? sql`false`}, ${
      extFields?.businessCaseScore ?? sql.null
    }, ${extFields?.competitiveLandscape ?? sql.null}, ${
      extFields?.useCaseCategory ?? sql.null
    }`
    : sql``;

  const partnerColumns = hasPartnerAttachment
    ? sql`, partner_id, partner_attached`
    : sql``;
  const partnerValues = hasPartnerAttachment && extFields?.partnerId
    ? sql`, ${extFields.partnerId}, case when ${extFields.partnerId} is not null then true else false end`
    : hasPartnerAttachment
    ? sql`, null, false`
    : sql``;

  if (params.entityType === "organization") {
    s.modify(sql`
    insert into db.${sql.ref(itemsTable)}
      (${baseColumns}, organization_id${extColumns}${qualificationColumns}${partnerColumns})
    values
      (${baseValues}, ${params.entityId}${extValues}${qualificationValues}${partnerValues})
  `);
  } else {
    s.modify(sql`
    insert into db.${sql.ref(itemsTable)}
      (${baseColumns}, person_id${extColumns}${qualificationColumns}${partnerColumns})
    values
      (${baseValues}, ${params.entityId}${extValues}${qualificationValues}${partnerValues})
  `);
  }
  if (
    !hasActivityLog &&
    !(block.hasPipelineTasksEnabled(params.pipelineName) &&
      entryStage.autoTasksOnEntry?.length) &&
    !params.onSuccess && !block.opts.debugHooks?.afterPipelineItemCreated
  ) return;
  s.defScalar("new_item_id", sql`last_record_id(db.${sql.ref(itemsTable)})`);

  if (hasActivityLog) {
    s.modify(sql`
      insert into db.${sql.ref(activityLogTable)}
        (${
      sql.ref(itemFkColumn)
    }, activity_type, to_stage, sys_user_id, created_at)
      values
        (new_item_id, 'item_created', ${
      sql.lit(stageName)
    }, current_user, now())
    `);
  }

  block.opts.debugHooks?.afterPipelineItemCreated?.(s, {
    pipelineName: params.pipelineName,
    entityType: params.entityType,
    entityId: params.entityId,
    itemId: sql`new_item_id`,
    stageName,
  });

  if (block.hasPipelineTasksEnabled(params.pipelineName)) {
    createAutoTasksForStage(s, {
      block,
      pipeline,
      stageName,
      itemId: sql`new_item_id`,
      activityLogTable,
    });
  }

  if (params.onSuccess) {
    params.onSuccess(s, sql`new_item_id`);
  }
}

/**
 * Server-side helper that removes `entityId` from `pipelineName`,
 * logging the removal in the activity log if the pipeline has one
 * enabled.
 */
export function removeFromPipeline(
  s: UiServerStatements,
  params: { block: CrmBlock; itemId: NumericExpr },
) {
  const itemsTable = params.block.pipelineItemsTableName;
  const afterPipelineItemRemoved = params.block.opts.debugHooks
    ?.afterPipelineItemRemoved;
  s.startTransaction();
  if (afterPipelineItemRemoved) {
    s.defRecord(
      "removed_pipeline_item",
      sql`select pipeline_name, stage_name from db.${
        sql.ref(itemsTable)
      } where id = ${params.itemId}`,
    );
  }
  s.modify(
    sql`delete from db.${sql.ref(itemsTable)} where id = ${params.itemId}`,
  );
  if (afterPipelineItemRemoved) {
    afterPipelineItemRemoved(s, {
      itemId: params.itemId,
      pipelineName: sql`removed_pipeline_item.pipeline_name`,
      stageName: sql`removed_pipeline_item.stage_name`,
    });
  }
  s.commitTransaction();
}
