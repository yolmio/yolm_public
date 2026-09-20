import { Alert } from "components/alert";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { CircularProgress } from "components/circular_progress";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { Sheet } from "components/sheet";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { getUniqueUiId, singleElementComponent } from "components/utils";
import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  CurrentWatchKeyICtxKey,
  ExtendedCurrentRecordContext,
  ExtendedCurrentTableContext,
  ExtendedWatchKeyContext,
  SimpleRefetchContext,
  useCurrentWatchState,
} from "std/ictx";
import { singularize } from "std/inflectors";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import type {
  AnyExpr,
  BooleanExpr,
  NumericExpr,
  Sql,
} from "../../std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles, cssVar } from "std/style_utils";
import { system } from "std/system";
import type { Table } from "std/system";
import {
  addCtx,
  Conditional,
  Each,
  Match,
  Route,
  Show,
  Switch,
  useICtx,
  useOptionalICtx,
} from "std/ui";
import type { Node } from "std/ui";
import { Form } from "std/form";

interface CardComponentProps {
  renderCardContents?: Node;
  cardModal?: Node;
  cardTableName: string;
  columnTableName: string;
}

interface BoardViewContentProps {
  cardTableName: string;
  sx?: Style;
  columnTableName: string;
  /**
         A query that fetches the columns



         The columns are expected to have the fields:
         - id: BigInt
         - name: String
         - order: Ordering
         */
  query: Sql;
  cardOrderingQuery: (columnId: NumericExpr) => Sql;
  columnComponent: Omit<
    ReorderableKanbanColumnProps,
    "cardComponent" | "title" | "cardTableName" | "columnTableName"
  >;
  /**
         A function that adds a new column to the board.



         This is already wrapped in a transaction and will automatically refresh the board.
         */
  addNewColumn: (s: UiServerStatements, name: Sql) => any;
  cardComponent: Omit<CardComponentProps, "cardTableName" | "columnTableName">;
  header: Node;
  columnOrderingThroughMenu?: boolean;
  draggableColumnReorder?: boolean;
}

interface ReorderableKanbanColumnProps {
  cardTableName: string;
  columnTableName: string;
  /**
         The query to fetch the cards for this column.



         Cards are expected to have the fields:
         - order: Ordering
         - id: BigInt
         */
  query: (columnId: NumericExpr) => Sql;
  title: Sql;
  addNewCard: (
    s: UiServerStatements,
    id: NumericExpr,
    title: Sql,
  ) => any;
  getOrderingBefore: (
    columnId: NumericExpr,
    targetOrder: AnyExpr,
  ) => AnyExpr;
  getOrderingAfter: (
    columnId: NumericExpr,
    targetOrder: AnyExpr,
  ) => AnyExpr;
  moveCard: (s: UiServerStatements, props: MoveCardProps) => any;
  cardComponent: Omit<CardComponentProps, "cardTableName" | "columnTableName">;
  columnOrderingThroughMenu?: boolean;
  draggableColumnReorder?: boolean;
}

interface MoveCardProps {
  targetColumn: NumericExpr;
  cardId: NumericExpr;
  newOrder: AnyExpr;
}
interface CardModalProps {
  /**
         @default "column"
         */
  columnField?: string;
  columnName?: Sql;
}

interface SuperKanbanProps extends BoardViewContentProps {
  boardTable: string;
  path?: string;
}

interface ColumnComponentProps {
  cardsTableName: string;
  columnName: AnyExpr;
  where: BooleanExpr;
  orderColumn: string;
  orderBy?: Sql;
  afterMoveToThisColumn?: (s: UiServerStatements, cardId: NumericExpr) => void;
  cardsAbleToRedorder?: boolean;
  renderCardContents?: Node;
  cardModal?: Node;
  initializeValues?: Record<string, AnyExpr>;
  columnColor?: string;
}

interface SimplifiedCardComponentProps {
  columnName: AnyExpr;
  cardsTableName: string;
  cardsAbleToRedorder?: boolean;
  renderCardContents?: Node;
  cardModal?: Node;
}
interface AutoKanbanProps {
  table: string;
  field: string;
  header?: Node;
  abilityToRedorder?: boolean;
  renderCardContents?: Node;
  orderColumn?: string;
  where?: BooleanExpr;
  initializeValues?: Record<string, AnyExpr>;
  sx?: Style;
}
interface SimplifiedKanbanProps {
  cardsTableName: string;
  header: Node;
  columns: {
    name: string;
    where: BooleanExpr;
    orderBy?: Sql;
    afterMoveToThisColumn?: (
      s: UiServerStatements,
      cardId: NumericExpr,
    ) => void;
    renderCardContents?: Node;
    cardModal?: Node;
    initializeValues?: Record<string, AnyExpr>;
  }[];
  orderColumn?: string;
  abilityToRedorder?: boolean;
  modal?: Node;
}
const styles = createStyles({
  mainBoard: {
    p: 8,
  },
  board: {
    width: "100%",
    display: "flex",
    gap: 8,
    overflowX: "auto",
    pb: 8,
    scrollbarWidth: "thin",
  },
  column: {
    width: 300,
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
    "&.left": {
      borderLeft: `2px solid ${cssVar("palette-primary-400")}`,
    },
    "&.right": {
      borderRight: `2px solid ${cssVar("palette-primary-400")}`,
    },
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
      mb: 4,
    },
  },
  cardContent: {
    backgroundColor: "white",
    borderRadius: "sm",
    p: 2,
    mb: 1,
    mt: 1,
    cursor: "pointer",
    boxShadow: "sm",
    "&:hover": {
      outline: `2px solid ${cssVar("palette-primary-400")}`,
    },
    dark: {
      backgroundColor: "neutral-900",
    },
  },
});

interface DataWrapperProps {
  children: Node;
  table: string;
  recordId: NumericExpr;
}

function DataWrapper(props: DataWrapperProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  let displayNameExpr: Sql;
  if (table.recordDisplayName) {
    displayNameExpr = table.recordDisplayName.expr(
      ...table.recordDisplayName.fields.map((f) =>
        sql`card_data.${sql.ref(f)}`
      ),
    );
  } else if (table.fields.email) {
    displayNameExpr = sql`card_data.email`;
  } else {
    displayNameExpr = sql`cast(card_data.${table.primaryKeyIdent} as string)`;
  }
  const { currentWatchKey } = useICtx(CurrentWatchKeyICtxKey);
  const parentTable = useOptionalICtx(CurrentTableICtxKey);
  const parentRecord = useOptionalICtx(CurrentRecordICtxKey);
  addCtx(new ExtendedCurrentTableContext(parentTable, table));
  addCtx(new ExtendedCurrentRecordContext(parentRecord, props.recordId));
  return (
    <Data
      watch={currentWatchKey}
      procedure={(s) => {
        s.defRecord(
          "card_data",
          sql`select * from ${table.identWithDb} where ${table.primaryKeyIdent} = ${props.recordId}`,
        );
        s.defScalar("card_display_name", {
          expr: displayNameExpr,
          allowNoRead: true,
        });
      }}
    >
      {props.children}
    </Data>
  );
}

const { db } = system;

export function kanbanTables() {
  db.table("boards", (table) => {
    table.string("name", 100).notNull();
    table.string("description", 500);
  });

  db.table("columns", (table) => {
    table.fk("boards").notNull();
    table.string("name", 100).notNull();
    table.ordering("order").notNull();
  });

  db.table("cards", (table) => {
    table.fk("columns").notNull();
    table.string("title", 100).notNull();
    table.string("description", 500);
    table.ordering("order").notNull();
  });
}

export function kanbanTablesForStatic() {
  db.table("columns", (table) => {
    table.string("name", 100).notNull();
    table.ordering("order").notNull();
  });

  db.table("card_statics", (table) => {
    table.fk("columns").notNull();
    table.string("title", 100).notNull();
    table.string("description", 500);
    table.ordering("order").notNull();
  });
}

export function KanbanBoardViewContent(props: BoardViewContentProps) {
  const refreshKeyName = `kanban_refresh_key_${getUniqueUiId()}`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(refreshKeyName, 0);
        s.defScalar("dragging_card", {
          type: "BigInt",
        });
      }}
    >
      <KanbanBoardViewContentInner
        {...props}
        refreshKeyName={refreshKeyName}
      />
    </Data>
  );
}

function KanbanBoardViewContentInner(
  props: BoardViewContentProps & { refreshKeyName: string },
) {
  const parentWatchKey = useOptionalICtx(CurrentWatchKeyICtxKey);
  addCtx(
    new SimpleRefetchContext(props.refreshKeyName, [
      sql.ref(props.refreshKeyName),
    ]),
  );
  addCtx(
    new ExtendedWatchKeyContext(parentWatchKey, [
      sql.ref(props.refreshKeyName),
    ]),
  );
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  function addNewColumn(s: DomStatements) {
    s.event.preventDefault();
    s.returnIf(sql`waiting_add_column`);
    s.setScalar("waiting_add_column", true);
    s.commitUiTreeChanges();
    s.if(sql`trim(new_column_name) = ''`, (s) => {
      s.setScalar("error_add_column", sql.lit`Column name is required`);
      s.setScalar("waiting_add_column", false);
      s.return();
    });
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        props.addNewColumn(s, sql`new_column_name`);
        s.commitTransaction();
        triggerRefetch(s);
      },
      finally: (s) => {
        s.setScalar("new_column_name", sql.lit``);
        s.setScalar("waiting_add_column", false);
      },
      catch: (s) => {
        s.setScalar("error_add_column", sql.lit`Failed to add column`);
      },
    });
  }
  useCurrentWatchState((s) => {
    s.defTable("columns_list", props.query);
    s.defScalar("new_column_name", sql.lit``);
    s.defScalar("error_add_column", sql.lit``);
    s.defScalar("waiting_add_column", {
      expr: false,
      allowNoRead: true,
    });
    s.defScalar("dragging_column", false);
    s.defScalar("drop_target_column_id", {
      type: "BigInt",
      allowNoRead: true,
    });
    s.defScalar("column_id", {
      type: "BigInt",
      allowNoRead: true,
    });
  });
  return (
    <div sx={[{ p: 8 }, props.sx]}>
      {props.header}
      <div sx={styles.board}>
        <Each
          table="columns_list"
          recordName="column_record"
          eachKey={sql`column_record.id`}
        >
          <KanbanReorderableColumn
            cardTableName={props.cardTableName}
            columnTableName={props.columnTableName}
            cardComponent={props.cardComponent}
            title={sql`column_record.name`}
            query={props.cardOrderingQuery}
            addNewCard={props.columnComponent.addNewCard}
            getOrderingBefore={props.columnComponent.getOrderingBefore}
            getOrderingAfter={props.columnComponent.getOrderingAfter}
            moveCard={props.columnComponent.moveCard}
            columnOrderingThroughMenu={props.columnOrderingThroughMenu}
            draggableColumnReorder={props.draggableColumnReorder}
          />
        </Each>
        <Data
          local
          noRefetch
          procedure={(s) => {
            s.defScalar("adding_column", false);
            s.defScalar("waiting_add_column", false);
          }}
        >
          <Sheet
            sx={{
              width: 300,
              justifySelf: "flex-start",
              alignSelf: "flex-start",
            }}
            variant="soft"
            color="neutral"
            harmonize
          >
            <Conditional
              when={sql`adding_column`}
              then={
                <div className="p-2">
                  <Input
                    placeholder="New Column Name"
                    value={sql`new_column_name`}
                    yolmFocusKey
                    onInput={(s) =>
                      s.setScalar("new_column_name", sql`target_value`)}
                    onKeyDown={(s) => {
                      s.if(sql`event.key = 'Enter'`, addNewColumn);
                    }}
                    className="mt-2"
                  />
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      startIcon="Add"
                      loading={sql`waiting_add_column`}
                      onClick={addNewColumn}
                    >
                      Add column
                    </Button>
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      aria-label="Cancel adding column"
                      icon="Close"
                      onClick={(s) => {
                        s.setScalar("adding_column", false);
                      }}
                    />
                  </div>
                </div>
              }
              else={
                <Button
                  size="md"
                  variant="plain"
                  color="harmonize"
                  startIcon="Add"
                  onClick={(s) => {
                    s.setScalar("adding_column", true);
                  }}
                  className="w-full justify-start"
                >
                  Add a column
                </Button>
              }
            />
            <Show when={sql`error_add_column != ''`}>
              <Alert color="danger" size="sm">{sql`error_add_column`}</Alert>
            </Show>
          </Sheet>
        </Data>
      </div>
    </div>
  );
}

function KanbanCardComponent(props: CardComponentProps) {
  const [Root, rootProps] = singleElementComponent({
    // if you want to use <li> it needs to be wrapped in a <ul>
    component: "div",
    sx: styles.card,
    internalProps: {
      dynamicClasses: [
        {
          classes: "top",
          condition: sql`accept_drop = 'top' and not dragging_column`,
        },
        {
          classes: "bottom",
          condition: sql`accept_drop = 'bottom' and not dragging_column`,
        },
      ],
    },
    externalProps: {},
  });
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("dragging", false);
        s.defScalar("dragged_card_id", {
          expr: 0,
          allowNoRead: true,
        });
        s.defScalar("dragged_from_column", {
          expr: 0,
          allowNoRead: true,
        });
        s.defScalar("accept_drop", {
          expr: sql.lit`none`,
          allowNoRead: true,
        });
        s.defScalar("show_modal", {
          expr: false,
          allowNoRead: true,
        });
      }}
    >
      <Root {...rootProps}>
        <DataWrapper table={props.cardTableName} recordId={sql`card_record.id`}>
          <div
            sx={styles.cardContent}
            id={sql`'card_' || card_record.id`}
            draggable={sql`dragging`}
            onClick={(s) => {
              if (props.cardModal) {
                s.setScalar("show_modal", true);
              }
            }}
            onMouseDown={(s) => {
              s.setScalar("dragging", true);
            }}
            onMouseUp={(s) => {
              s.setScalar("dragging", false);
              s.setScalar("accept_drop", sql.lit`none`);
            }}
            onDragStart={(s) => {
              s.setScalar("dragged_card_id", sql`card_record.id`);
              s.setScalar(
                "dragged_from_column",
                sql`card_record.${
                  sql.ref(singularize(props.columnTableName))
                }_id`,
              );
              s.setScalar("dragging_card", sql`card_record.id`);
            }}
            onDragEnd={(s) => {
              s.setScalar("dragging_card", sql.null);
              s.setScalar("accept_drop", sql.lit`none`);
            }}
            onDragLeave={(s) => {
              s.setScalar("accept_drop", sql.lit`none`);
            }}
            onDragOver={(s) => {
              s.event.preventDefault();
              s.element(sql`'card_' || card_record.id`).getBoundingClientRect(
                "rect",
              );
              s.defScalar(
                "midpoint",
                sql`rect.top + (rect.bottom - rect.top) / 2`,
              );
              s.setScalar(
                "accept_drop",
                sql`case when event.client_y <= midpoint then 'top' else 'bottom' end`,
              );
              s.setScalar("main_drop_target", sql`accept_drop`);
              s.setScalar("drop_target_id", sql`card_record.id`);
            }}
            onDrop={(s) => {
              s.setScalar("accept_drop", sql.lit`none`);
            }}
          >
            {props.renderCardContents ?? sql`card_display_name`}
          </div>
          {props.cardModal && props.cardModal}
        </DataWrapper>
      </Root>
    </Data>
  );
}

function KanbanReorderableColumn(props: ReorderableKanbanColumnProps) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  function addNewCard(s: DomStatements) {
    s.event.preventDefault();
    s.returnIf(sql`waiting_add_card`);
    s.setScalar("waiting_add_card", true);
    s.commitUiTreeChanges();
    s.if(sql`trim(new_card_title) = ''`, (s) => {
      s.setScalar("error_add_card", sql.lit`Card title is required`);
      s.setScalar("waiting_add_card", false);
      s.return();
    });
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        props.addNewCard(s, sql`column_record.id`, sql`new_card_title`);
        s.commitTransaction();
        triggerRefetch(s);
      },
      finally: (s) => {
        s.setScalar("new_card_title", sql.lit``);
        s.setScalar("waiting_add_card", false);
        s.setScalar("error_add_card", sql.null);
      },
      catch: (s) => {
        s.setScalar("error_add_card", sql.lit`Failed to add card`);
      },
    });
  }
  const [RootSlot, rootProps] = singleElementComponent({
    component: Sheet,
    sx: styles.column,
    externalProps: {},
    internalProps: {
      variant: "soft",
      color: "neutral",
      harmonize: true,
      draggable: props.draggableColumnReorder ? sql`dragging_column` : false,
      id: sql`'column_' || column_record.id`,
      dynamicClasses: [
        {
          classes: "drag-over",
          condition:
            sql`is_drag_over and (select count(*) from cards_list) = 0 and not dragging_column`,
        },
        {
          classes: "left",
          condition: sql`accept_drop_column = 'left' and dragging_column`,
        },
        {
          classes: "right",
          condition: sql`accept_drop_column = 'right' and dragging_column`,
        },
      ],
      onDragOver: (s) => {
        s.event.preventDefault();
        s.setScalar("is_drag_over", true);
        if (props.draggableColumnReorder) {
          s.element(sql`'column_' || column_record.id`).getBoundingClientRect(
            "rect",
          );
          s.defScalar(
            "midpoint",
            sql`rect.left + (rect.right - rect.left) / 2`,
          );
          s.setScalar(
            "accept_drop_column",
            sql`case when event.client_x <= midpoint then 'left' else 'right' end`,
          );
          s.setScalar("drop_target_column_id", sql`column_record.id`);
        }
      },
      onDragLeave: (s) => {
        if (props.draggableColumnReorder) {
          s.setScalar("accept_drop_column", sql.lit`none`);
        }
      },
      onDrop: (s) => {
        s.event.preventDefault();
        s.if(sql`dragging_card is not null`, (s) => {
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.defScalar(
                "target_order",
                {
                  type: "Ordering",
                  expr:
                    sql`(select "order" from cards_list where id = drop_target_id)`,
                },
              );
              s.defScalar(
                "ordering_before",
                {
                  type: "Ordering",
                  expr: props.getOrderingBefore(
                    sql`column_record.id`,
                    sql`target_order`,
                  ),
                },
              );
              s.defScalar(
                "ordering_after",
                {
                  type: "Ordering",
                  expr: props.getOrderingAfter(
                    sql`column_record.id`,
                    sql`target_order`,
                  ),
                },
              );
              props.moveCard(s, {
                cardId: sql`dragging_card`,
                targetColumn: sql`column_record.id`,
                newOrder: sql`case
                  when main_drop_target = 'top' then ordering.new(ordering_before, target_order)
                  when main_drop_target = 'bottom' then ordering.new(target_order, ordering_after)
                  else order
                end`,
              });
              s.commitTransaction();
              triggerRefetch(s);
            },
            finally: (s) => {
              s.setScalar("dragging_card", sql.null);
            },
          });
          s.return();
        });
        if (props.draggableColumnReorder) {
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.defScalar(
                "target_order",
                sql`(select "order" from columns_query where id = drop_target_column_id)`,
              );
              s.defScalar(
                "ordering_before",
                {
                  type: "Ordering",
                  expr:
                    sql`(select "order" from columns_query where "order" < target_order order by "order" desc limit 1)`,
                },
              );
              s.defScalar(
                "ordering_after",
                {
                  type: "Ordering",
                  expr:
                    sql`(select "order" from columns_query where "order" > target_order order by "order" asc limit 1)`,
                },
              );
              s.modify(sql`
              update ${sql.ref(props.columnTableName)}
              set "order" = case
                  when accept_drop_column = 'left' then ordering.new(ordering_before, target_order)
                  when accept_drop_column = 'right' then ordering.new(target_order, ordering_after)
                  else order
                end
              where id = column_id
            `);
              s.commitTransaction();
              triggerRefetch(s);
            },
            finally: (s) => {
              s.setScalar("drop_target_column_id", sql.null);
              s.setScalar("column_id", sql.null);
            },
          });
        }
      },
    },
  });
  useCurrentWatchState((s) => {
    s.defTable("cards_list", props.query(sql`column_record.id`));
    s.defScalar("is_drag_over", false);
    s.defScalar("main_drop_target", {
      expr: sql.lit`none`,
      allowNoRead: true,
    });
    s.defScalar("drop_target_id", {
      type: "BigInt",
      allowNoRead: true,
    });
    s.defScalar("edit_column_name", false);
    s.defScalar("update_column_name", {
      type: "String",
    });
    s.defScalar("error_update_column_name", {
      type: "String",
    });
    s.defTable(
      "columns_query",
      sql`select * from ${sql.ref(props.columnTableName)}`,
    );
    s.defScalar("accept_drop_column", sql.lit`none`);
  });
  return (
    <RootSlot {...rootProps}>
      <div
        onMouseDown={(s) => {
          if (props.draggableColumnReorder) {
            s.setScalar("dragging_column", true);
            s.setScalar("column_id", sql`column_record.id`);
          }
        }}
        onMouseUp={(s) => {
          if (props.draggableColumnReorder) {
            s.setScalar("dragging_column", false);
          }
        }}
        className="flex items-center break-words cursor-grab"
      >
        <Show when={sql`not edit_column_name`}>
          <Typography level="h3">{props.title}</Typography>
          <IconButton
            variant="plain"
            color="neutral"
            size="sm"
            aria-label="Edit"
            onClick={(s) => {
              s.setScalar("edit_column_name", true);
              s.setScalar("update_column_name", props.title);
            }}
            className="ml-2"
          >
            <MaterialIcon icon="EditOutlined" />
          </IconButton>
          <div className="grow" />
          <Menu>
            <Menu.IconButton
              icon="MoreVert"
              aria-label="Column options"
              variant="plain"
              size="sm"
            />
            <Menu.Content>
              {props.columnOrderingThroughMenu && (
                <>
                  <Show
                    when={sql`column_record.order != (select min("order") from columns_query)`}
                  >
                    <Menu.Item
                      onClick={(s) => {
                        s.defScalar(
                          "prev_col",
                          sql`(select max("order") from columns_query where "order" < column_record.order)`,
                        );
                        s.defScalar(
                          "prev_prev_col",
                          sql`(select max("order") from columns_query where "order" < prev_col)`,
                        );
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.modify(sql`
                          update ${sql.ref(props.columnTableName)}
                          set "order" = ordering.new(prev_prev_col, prev_col)
                          where id = column_record.id
                        `);
                            s.commitTransaction();
                            triggerRefetch(s);
                          },
                          catch: (s) => {
                            s.setScalar(
                              "error_update_column_name",
                              sql.lit`Failed to move column`,
                            );
                          },
                        });
                      }}
                    >
                      Move Left
                    </Menu.Item>
                  </Show>
                  <Show
                    when={sql`column_record.order != (select max("order") from columns_query)`}
                  >
                    <Menu.Item
                      onClick={(s) => {
                        s.defScalar(
                          "next_col",
                          sql`(select min("order") from columns_query where "order" > column_record.order)`,
                        );
                        s.defScalar(
                          "next_next_col",
                          sql`(select min("order") from columns_query where "order" > next_col)`,
                        );
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.modify(sql`
                          update ${sql.ref(props.columnTableName)}
                          set "order" = ordering.new(next_col, next_next_col)
                          where id = column_record.id
                        `);
                            s.commitTransaction();
                            triggerRefetch(s);
                          },
                          catch: (s) => {
                            s.setScalar(
                              "error_update_column_name",
                              sql.lit`Failed to move column`,
                            );
                          },
                        });
                      }}
                    >
                      Move Right
                    </Menu.Item>
                  </Show>
                </>
              )}
              <DeleteRecordButton
                table={props.columnTableName}
                recordId={sql`column_record.id`}
                variant="plain"
                color="neutral"
                aria-label="Delete"
                afterTransactionCommit={(s) => {
                  triggerRefetch(s);
                }}
              >
                Delete
              </DeleteRecordButton>
            </Menu.Content>
          </Menu>
        </Show>
        <Show when={sql`edit_column_name`}>
          <div
            onClickAway={(s) => s.setScalar("edit_column_name", false)}
            className="flex items-center break-words"
          >
            <Input
              placeholder="New Column Name"
              value={sql`update_column_name`}
              onInput={(s) =>
                s.setScalar("update_column_name", sql`target_value`)}
              yolmFocusKey
              endDecorator={
                <IconButton
                  size="sm"
                  variant="solid"
                  color="primary"
                  onClick={(s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(sql`update ${sql.ref(props.columnTableName)}
                      set name = update_column_name
                      where id = column_record.id
                    `);
                        s.commitTransaction();
                        triggerRefetch(s);
                        s.setScalar("edit_column_name", false);
                      },
                      catch: (s) => {
                        s.setScalar(
                          "error_update_column_name",
                          sql.lit`Failed to update column name`,
                        );
                      },
                    });
                  }}
                  aria-label="Save"
                  icon="Save"
                />
              }
            />
          </div>
        </Show>
      </div>
      <Show when={sql`error_update_column_name != ''`}>
        <Alert color="danger" size="sm">
          {sql`error_update_column_name`}
        </Alert>
      </Show>
      <Each
        table="cards_list"
        recordName="card_record"
        eachKey={sql`card_record.id`}
        where={sql`card_record.${
          sql.ref(singularize(props.columnTableName))
        }_id = column_record.id`}
        orderBy={sql`card_record."order" asc`}
      >
        {
          <KanbanCardComponent
            {...props.cardComponent}
            cardTableName={props.cardTableName}
            columnTableName={props.columnTableName}
          />
        }
      </Each>
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("new_card_title", sql.lit``);
          s.defScalar("error_add_card", {
            type: "String",
          });
          s.defScalar("waiting_add_card", false);
          s.defScalar("adding_card", false);
        }}
      >
        <Conditional
          when={sql`adding_card`}
          then={
            <>
              <Input
                placeholder="New Card Title"
                value={sql`new_card_title`}
                yolmFocusKey
                onInput={(s) => {
                  s.setScalar("new_card_title", sql`target_value`);
                }}
                onKeyDown={(s) => {
                  s.if(sql`event.key = 'Enter'`, addNewCard);
                }}
                className="mt-2"
              />
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  startIcon="Add"
                  loading={sql`waiting_add_card`}
                  onClick={addNewCard}
                >
                  Add card
                </Button>
                <IconButton
                  size="sm"
                  variant="plain"
                  color="neutral"
                  aria-label="Cancel adding card"
                  icon="Close"
                  onClick={(s) => {
                    s.setScalar("adding_card", false);
                  }}
                />
              </div>
            </>
          }
          else={
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startIcon="Add"
              onClick={(s) => {
                s.setScalar("adding_card", true);
              }}
              className="w-full mt-2 justify-start"
            >
              Add a card
            </Button>
          }
        />
        <Show when={sql`error_add_card != ''`}>
          <Alert color="danger" size="sm">{sql`error_add_card`}</Alert>
        </Show>
      </Data>
    </RootSlot>
  );
}

function KanbanCreateViewBoard(props: SuperKanbanProps) {
  return (
    <>
      <Route path={props.path ?? "/kanban"}>
        <CreateBoardForm {...props} />
      </Route>
      <Route path={`${props.path ?? "/kanban"}/{record_id:id}`}>
        <SimpleRefreshKeyState>
          <Data
            procedure={(s) => {
              s.defScalar(
                "record_exists",
                sql`exists (select 1 from ${
                  sql.ref(props.boardTable)
                } where id = ui.record_id)`,
              );
            }}
            statusScalar="status"
            hasDataScalar="has_data"
            watch={[sql`kanban_refresh_key`]}
          >
            <Switch>
              <Match when={sql`not has_data and status = 'fallback_triggered'`}>
                <CircularProgress size="lg" />
              </Match>
              <Match when={sql`status = 'failed'`}>
                <Alert color="danger" startIcon="Report">
                  Unable to get {props.boardTable}
                </Alert>
              </Match>
              <Match when={sql`not record_exists`}>
                <Alert color="danger" startIcon="Report">
                  Unable to get {props.boardTable}
                </Alert>
              </Match>
              <Match when={sql.true}>
                <KanbanBoardViewContent
                  cardTableName={props.cardTableName}
                  columnTableName={props.columnTableName}
                  header={props.header}
                  query={props.query}
                  addNewColumn={props.addNewColumn}
                  cardOrderingQuery={props.cardOrderingQuery}
                  columnComponent={{
                    getOrderingAfter: props.columnComponent.getOrderingAfter,
                    getOrderingBefore: props.columnComponent.getOrderingBefore,
                    addNewCard: props.columnComponent.addNewCard,
                    query: props.columnComponent.query,
                    moveCard: props.columnComponent.moveCard,
                  }}
                  cardComponent={{
                    cardModal: props.cardComponent.cardModal,
                    renderCardContents: props.cardComponent.renderCardContents,
                  }}
                  columnOrderingThroughMenu={props.columnOrderingThroughMenu}
                  draggableColumnReorder={props.draggableColumnReorder}
                />
              </Match>
            </Switch>
          </Data>
        </SimpleRefreshKeyState>
      </Route>
    </>
  );
}

export function CreateBoardForm({
  boardTable,
  path,
}: Pick<SuperKanbanProps, "boardTable" | "path">) {
  return (
    <>
      <div
        sx={{
          maxWidth: 600,
          mx: "auto",
          mt: 8,
          px: 4,
        }}
      >
        <Typography level="h1">Create New Board</Typography>
        {/*Example_Write_Start*/}
        <Form
          defaultFieldComponent={LabelOnLeftFormField}
          beforeTransactionCommit={(s) => {
            s.defScalar(
              "current_board",
              sql`last_record_id(${sql.ref(boardTable)})`,
            );
          }}
          afterTransactionCommit={(s) => {
            s.navigate(sql.concat(path ?? "/kanban", "/", sql`current_board`));
          }}
        >
          <Form.Insert table={boardTable}>
            <Form.Field field="name" />
            <Form.Field field="description" />
            <Form.SubmitButton className="mt-4">
              Create Board
            </Form.SubmitButton>
            <Form.ErrorAlert className="mt-3" />
          </Form.Insert>
        </Form>
        {/*Example_Write_End*/}
      </div>
      <Data
        procedure={(s) => {
          s.defTable("boards", sql`select * from ${sql.ref(boardTable)}`);
        }}
      >
        <div
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(1, 1fr)",
            md: {
              gridTemplateColumns: "repeat(2, 1fr)",
            },
            lg: {
              gridTemplateColumns: "repeat(3, 1fr)",
            },
            gap: 3,
            p: 3,
            maxHeight: "calc(100vh - 100px)",
            overflowY: "auto",
          }}
        >
          <Each table="boards" recordName="boards_record">
            <div
              onClick={(s) => {
                s.navigate(
                  sql.concat(path ?? "/kanban", "/", sql`boards_record.id`),
                );
              }}
              className="p-6 rounded-lg bg-level1 cursor-pointer flex flex-col gap-2"
            >
              <Typography level="h3">{sql`boards_record.name`}</Typography>
              <Show when={sql`boards_record.description is not null`}>
                <Typography
                  level="body-sm"
                  sx={{
                    color: "text-secondary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {sql`boards_record.description`}
                </Typography>
              </Show>
            </div>
          </Each>
        </div>
      </Data>
    </>
  );
}

interface FetchColumnNameResult {
  expr: Sql;
  addToProcedure?: (
    s: { defRecord: (name: string, query: Sql) => void },
  ) => void;
}

function fetchColumnName(
  table: Table,
  recordId: NumericExpr,
  columnFieldName: string,
  columnNameExpr?: Sql,
): FetchColumnNameResult {
  if (columnNameExpr) {
    return { expr: columnNameExpr };
  }
  const columnField = table.fields[columnFieldName];
  if (!columnField) {
    throw new Error(
      `Table ${table.name} must have a "${columnFieldName}" field`,
    );
  }
  if (columnField.type !== "ForeignKey") {
    throw new Error(`Field ${columnFieldName} must be a ForeignKey`);
  }
  const columnTable = system.db.tables[columnField.table];
  if (!columnTable.recordDisplayName) {
    throw new Error(
      `Table ${columnTable.identWithDb} must have a recordDisplayName`,
    );
  }
  const fields = columnTable.recordDisplayName.fields.map(
    (f) => sql`${columnTable.ident}.${sql.ref(f)}`,
  );
  const query = sql`select ${
    columnTable.recordDisplayName.expr(...fields)
  } from ${columnTable.identWithDb} where id = (select ${
    sql.ref(columnField.name)
  } from ${table.identWithDb} where id = ${recordId})`;
  return {
    expr: sql`column.name`,
    addToProcedure: (s) => {
      s.defRecord("column", query);
    },
  };
}

function CardComponent(props: SimplifiedCardComponentProps) {
  const propsForAbilityToReorder = {
    dynamicClasses: [
      {
        classes: "top",
        condition: sql`accept_drop = 'top'`,
      },
      {
        classes: "bottom",
        condition: sql`accept_drop = 'bottom'`,
      },
    ],
    mouseEvents: {
      onClick: (s: DomStatements) => {
        s.setScalar("show_modal", true);
      },
      onMouseDown: (s: DomStatements) => {
        s.setScalar("dragging", true);
      },
      onMouseUp: (s: DomStatements) => {
        s.setScalar("dragging", false);
        s.setScalar("accept_drop", sql.lit`none`);
      },
      onDragStart: (s: DomStatements) => {
        s.setScalar("dragged_card_id", sql`card_record.id`);
        s.setScalar("dragging_card", sql`card_record.id`);
      },
      onDragEnd: (s: DomStatements) => {
        s.setScalar("dragging_card", sql.null);
        s.setScalar("accept_drop", sql.lit`none`);
      },
      onDragLeave: (s: DomStatements) => {
        s.setScalar("accept_drop", sql.lit`none`);
      },
      onDragOver: (s: DomStatements) => {
        s.event.preventDefault();
        s.element(sql`'card_' || card_record.id`).getBoundingClientRect("rect");
        s.defScalar("midpoint", sql`rect.top + (rect.bottom - rect.top) / 2`);
        s.setScalar(
          "accept_drop",
          sql`case when event.client_y <= midpoint then 'top' else 'bottom' end`,
        );
        s.setScalar("main_drop_target", sql`accept_drop`);
        s.setScalar("drop_target_id", sql`card_record.id`);
      },
      onDrop: (s: DomStatements) => {
        s.setScalar("accept_drop", sql.lit`none`);
      },
    },
  };
  const propsForNotAbilityToReorder = {
    dynamicClasses: [
      {
        classes: "top",
        condition: sql`accept_drop = 'top'`,
      },
      {
        classes: "bottom",
        condition: sql`accept_drop = 'bottom'`,
      },
    ],
    mouseEvents: {
      onClick: (s: DomStatements) => {
        s.setScalar("show_modal", true);
      },
      onMouseDown: (s: DomStatements) => {
        s.setScalar("dragging", true);
      },
      onMouseUp: (s: DomStatements) => {
        s.setScalar("dragging", false);
      },
      onDragStart: (s: DomStatements) => {
        s.setScalar("dragged_card_id", sql`card_record.id`);
        // s.setScalar("dragged_from_column", sql`card_record.column`);
        s.setScalar("dragging_card", sql`card_record.id`);
      },
      onDragEnd: (s: DomStatements) => {
        s.setScalar("dragging_card", sql.null);
      },
      onDragLeave: (s: DomStatements) => {
        s.setScalar("accept_drop", sql.lit`none`);
      },
      onDragOver: (s: DomStatements) => {
        s.event.preventDefault();
        s.setScalar("drop_target_id", sql`card_record.id`);
      },
    },
  };
  const [Root, rootProps] = singleElementComponent({
    component: "div",
    sx: styles.card,
    internalProps: {
      dynamicClasses: propsForAbilityToReorder.dynamicClasses,
    },
    externalProps: {},
  });
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("dragging", false);
        s.defScalar("dragged_card_id", {
          expr: 0,
          allowNoRead: true,
        });
        s.defScalar("accept_drop", {
          expr: sql.lit`none`,
          allowNoRead: true,
        });
        s.defScalar("show_modal", {
          expr: false,
          allowNoRead: true,
        });
      }}
    >
      <Root {...rootProps}>
        <DataWrapper
          table={props.cardsTableName}
          recordId={sql`card_record.id`}
        >
          <div
            sx={styles.cardContent}
            id={sql`'card_' || card_record.id`}
            draggable={sql`dragging`}
            {...(props.cardsAbleToRedorder
              ? propsForAbilityToReorder.mouseEvents
              : propsForNotAbilityToReorder.mouseEvents)}
          >
            {props.renderCardContents ?? sql`card_display_name`}
          </div>
          {props.cardModal && props.cardModal}
        </DataWrapper>
      </Root>
    </Data>
  );
}

function ColumnComponent(props: ColumnComponentProps) {
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const propsForAbilityToReorder = {
    dynamicClasses: [
      {
        classes: "drag-over",
        condition: sql`is_drag_over and (select count(*) from cards_list) = 0`,
      },
    ],
    mouseEvents: {
      onDragOver: (s: DomStatements) => {
        s.event.preventDefault();
        s.setScalar("is_drag_over", true);
      },
      onDragLeave: (s: DomStatements) => {
        s.setScalar("is_drag_over", false);
      },
      onDrop: (s: DomStatements) => {
        s.event.preventDefault();
        s.setScalar("is_drag_over", false);
        s.if(sql`dragging_card is not null`, (s) => {
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              s.defScalar(
                "target_order",
                {
                  type: "Ordering",
                  expr: sql`(select ${
                    sql.ref(props.orderColumn ?? "order")
                  } from ${
                    sql.ref(props.cardsTableName)
                  } where id = drop_target_id)`,
                },
              );
              s.defScalar(
                "ordering_before",
                {
                  type: "Ordering",
                  expr: sql`(select ${sql.ref(props.orderColumn)} from ${
                    sql.ref(props.cardsTableName)
                  } where ${
                    sql.ref(props.orderColumn)
                  } < target_order and ${props.where} order by ${
                    sql.ref(props.orderColumn)
                  } desc limit 1)`,
                },
              );
              s.defScalar(
                "ordering_after",
                {
                  type: "Ordering",
                  expr: sql`(select ${sql.ref(props.orderColumn)} from ${
                    sql.ref(props.cardsTableName)
                  } where ${
                    sql.ref(props.orderColumn)
                  } > target_order and ${props.where} order by ${
                    sql.ref(props.orderColumn)
                  } asc limit 1)`,
                },
              );
              s.modify(sql`
                update ${sql.ref(props.cardsTableName)}
                set ${sql.ref(props.orderColumn)} = case
                  when main_drop_target = 'top' then ordering.new(ordering_before, target_order)
                  when main_drop_target = 'bottom' then ordering.new(target_order, ordering_after)
                  else ${sql.ref(props.orderColumn)}
                end
                where id = dragging_card
              `);
              props.afterMoveToThisColumn?.(s, sql`dragging_card`);
              s.commitTransaction();
              triggerRefetch(s);
            },
            finally: (s) => {
              s.setScalar("dragging_card", sql.null);
            },
          });
        });
      },
    },
  };
  const propsForNotAbilityToReorder = {
    dynamicClasses: [
      {
        classes: "drag-over",
        condition: sql`is_drag_over`,
      },
    ],
    mouseEvents: {
      onDragOver: (s: DomStatements) => {
        s.event.preventDefault();
        s.setScalar("is_drag_over", true);
      },
      onDragLeave: (s: DomStatements) => {
        s.setScalar("is_drag_over", false);
      },
      onDrop: (s: DomStatements) => {
        s.event.preventDefault();
        s.setScalar("is_drag_over", false);
        s.if(sql`dragging_card is not null`, (s) => {
          s.tryServer({
            body: (s) => {
              s.startTransaction();
              props.afterMoveToThisColumn?.(s, sql`dragging_card`);
              s.commitTransaction();
              triggerRefetch(s);
            },
            finally: (s) => {
              s.setScalar("dragging_card", sql.null);
            },
          });
        });
      },
    },
  };
  function addNewCard(s: DomStatements) {
    s.event.preventDefault();
    s.returnIf(sql`waiting_add_card`);
    s.setScalar("waiting_add_card", true);
    s.commitUiTreeChanges();
    s.if(sql`trim(new_card_title) = ''`, (s) => {
      s.setScalar("error_add_card", sql.lit`Card title is required`);
      s.setScalar("waiting_add_card", false);
      s.return();
    });
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        let insertFields: string[] = [];
        let insertValues: AnyExpr[] = [];
        if (props.cardsAbleToRedorder) {
          s.defScalar(
            "new_order",
            {
              type: "Ordering",
              expr: sql`coalesce(ordering.new((select ${
                sql.ref(props.orderColumn)
              } from ${
                sql.ref(props.cardsTableName)
              } where ${props.where} order by ${
                sql.ref(props.orderColumn)
              } desc limit 1)), ordering.new())`,
            },
          );

          insertFields = ["title", props.orderColumn];
          insertValues = [sql`new_card_title`, sql`new_order`];
          if (props.initializeValues) {
            for (const fieldName of Object.keys(props.initializeValues)) {
              insertFields.push(fieldName);
              insertValues.push(props.initializeValues[fieldName]);
            }
          }

          s.modify(
            sql.insertValues(
              sql.ref(props.cardsTableName),
              insertFields,
              insertValues,
            ),
          );
        } else {
          insertFields = ["title"];
          insertValues = [sql`new_card_title`];
          if (props.initializeValues) {
            for (const fieldName of Object.keys(props.initializeValues)) {
              insertFields.push(fieldName);
              insertValues.push(props.initializeValues[fieldName]);
            }
          }
          s.modify(
            sql.insertValues(
              sql.ref(props.cardsTableName),
              insertFields,
              insertValues,
            ),
          );
        }
        s.commitTransaction();
        triggerRefetch(s);
      },
      finally: (s) => {
        s.setScalar("new_card_title", sql.lit``);
        s.setScalar("waiting_add_card", false);
      },
      catch: (s) => {
        s.setScalar("error_add_card", sql.lit`Failed to add card`);
      },
    });
  }
  const [RootSlot, rootProps] = singleElementComponent({
    component: Sheet,
    sx: styles.column,
    externalProps: {},
    internalProps: {
      variant: "soft",
      color: "neutral",
      harmonize: true,
      dynamicClasses: props.cardsAbleToRedorder
        ? propsForAbilityToReorder.dynamicClasses
        : propsForNotAbilityToReorder.dynamicClasses,
      ...(props.cardsAbleToRedorder
        ? propsForAbilityToReorder.mouseEvents
        : propsForNotAbilityToReorder.mouseEvents),
      style: {
        "border-top": props.columnColor
          ? sql.lit`4px solid ${props.columnColor}`
          : undefined,
      },
    },
  });
  useCurrentWatchState((s) => {
    s.defScalar("is_drag_over", false);
    s.defTable(
      "cards_list",
      sql`select * from ${sql.ref(props.cardsTableName)} where ${props.where} ${
        props.orderBy ? sql`order by ${props.orderBy}` : sql``
      }`,
    );
    s.defScalar("new_card_title", sql.lit``);
    s.defScalar("error_add_card", {
      type: "String",
    });
    s.defScalar("waiting_add_card", false);
    s.defScalar("adding_card", false);
  });
  return (
    <RootSlot {...rootProps}>
      <div className="flex items-center justify-between">
        <Typography
          level="title-lg"
          className="ml-2"
        >
          {sql`${props.columnName}`}
        </Typography>
        <Chip color="harmonize" size="md" variant="plain">
          {sql`(select count(*) from cards_list)`}
        </Chip>
      </div>

      <Each
        table="cards_list"
        recordName="card_record"
        eachKey={sql`card_record.id`}
      >
        <CardComponent
          columnName={props.columnName}
          cardsAbleToRedorder={props.cardsAbleToRedorder}
          renderCardContents={props.renderCardContents}
          cardsTableName={props.cardsTableName}
          cardModal={props.cardModal}
        />
      </Each>
      <Conditional
        when={sql`adding_card`}
        then={
          <>
            <Input
              placeholder="New Card Title"
              value={sql`new_card_title`}
              yolmFocusKey
              onInput={(s) => {
                s.setScalar("new_card_title", sql`target_value`);
              }}
              onKeyDown={(s) => {
                s.if(sql`event.key = 'Enter'`, addNewCard);
              }}
              className="mt-2"
            />
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                aria-label="Add"
                startIcon="Add"
                onClick={addNewCard}
              >
                Add card
              </Button>
              <IconButton
                size="sm"
                variant="plain"
                color="neutral"
                aria-label="Cancel"
                icon="Close"
                onClick={(s) => {
                  s.setScalar("adding_card", false);
                }}
              />
            </div>
          </>
        }
        else={
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            aria-label="Add"
            startIcon="Add"
            onClick={(s) => {
              s.setScalar("adding_card", true);
            }}
            className="w-full justify-start"
          >
            Add a card
          </Button>
        }
      />
      <Show when={sql`error_add_card != ''`}>
        <Alert color="danger" size="sm">{sql`error_add_card`}</Alert>
      </Show>
      <Show when={sql`waiting_add_card`}>
        <CircularProgress size="sm" />
      </Show>
    </RootSlot>
  );
}

/**
 A high-level Kanban board component that provides full functionality for creating and managing a Kanban board.

 @category UI Component
 @param props SuperKanbanProps - Configuration for the Kanban board including:
 - boardTable: Name of the table storing board metadata
 - cardTableName: Name of the table storing card data
 - columnTableName: Name of the table storing column data
 - header: Node to render at the top of the board
 - query: Query to fetch columns
 - cardOrderingQuery: Function to get query for ordering cards in a column
 - addNewColumn: Function to handle adding new columns
 - columnComponent: Configuration for column behavior and rendering
 - cardComponent: Configuration for card behavior and rendering

 @returns A fully functional Kanban board with drag-and-drop, column management, and card management capabilities
 */
export function SuperKanban(props: SuperKanbanProps) {
  return <KanbanCreateViewBoard {...props} />;
}

/**
 A simplified Kanban board component that renders a board with static columns.
 This is useful when you want to display a Kanban board with a fixed board configuration
 but still allow column management within that board.

 @category UI Component

 @param props BoardViewContentProps - Configuration for the Kanban board including:
 - cardsTableName: Name of the table storing card data
 - header: Node to render at the top of the board
 - columns: Array of column configurations specifying:
   - name: Display name of the column
   - where: Query condition to filter cards for this column
   - orderBy: Optional SQL for ordering cards
   - afterMoveToThisColumn: Optional callback when cards are moved/added
 - renderCardContents: Optional custom carsd content renderer
 - cardModal: Optional modal component for card details

 @returns A Kanban board view with column management capabilities but a fixed board configuration

 @examples
[Example](../../../examples/kanban/apps/kanban.yolmstaging.net.tsx)
 */
export function KanbanWithStaticBoard(props: BoardViewContentProps) {
  return (
    <SimpleRefreshKeyState>
      <KanbanBoardViewContent {...props} />
    </SimpleRefreshKeyState>
  );
}

/**
 A Kanban board component that automatically configures itself based on a field in a table.
 This component can handle both enum fields and foreign key fields to create columns.

 @category UI Component

 @param props AutoKanbanProps - Configuration for the auto-generated Kanban board including:
 - table: Name of the table containing the cards
 - field: Name of the field to use for column grouping (must be enum or foreign key)
 - header: Optional node to render at the top of the board
 - abilityToRedorder: Whether cards can be reordered within columns
 - orderColumn: Optional column name to use for card ordering
 - renderCardContents: Optional custom card content renderer

 For enum fields:
 - Creates a column for each enum value
 - Cards are grouped by their enum value in the specified field
 - Moving cards updates their enum value

 For foreign key fields:
 - Creates a column for each record in the referenced table
 - Cards are grouped by their foreign key reference
 - Moving cards updates their foreign key reference

 @returns A fully functional Kanban board with drag-and-drop capabilities and automatic column management

 @examples
[Example](../../../examples/kanban/apps/kanban.yolmstaging.net.tsx)
 */
export function AutoKanban(props: AutoKanbanProps) {
  const tableName = props.table;
  if (!tableName) {
    throw new Error(`Field ${props.field} is not a valid kanban field`);
  }
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const field = table.fields[props.field];
  if (field.type === "Enum") {
    const enum_ = system.enums[field.enum];
    return (
      <div sx={props.sx}>
        {props.header}
        <SimpleRefreshKeyState>
          <div sx={styles.board}>
            <Data
              procedure={(s) => {
                s.defScalar("dragging_card", {
                  type: "BigInt",
                });
                s.defScalar("main_drop_target", {
                  expr: sql.lit`none`,
                  allowNoRead: true,
                });
                s.defScalar("drop_target_id", {
                  type: "BigInt",
                  allowNoRead: true,
                });
              }}
              watch={[sql`kanban_refresh_key`]}
            >
              {Object.values(enum_.values).map((value) => (
                <ColumnComponent
                  cardsTableName={props.table}
                  columnName={sql.lit`${value.displayName}`}
                  cardsAbleToRedorder={props.abilityToRedorder}
                  where={sql.and(
                    sql`${sql.ref(props.field)} = '${sql.ref(value.name)}'`,
                    props.where ?? true,
                  )}
                  orderBy={props.abilityToRedorder
                    ? sql`${sql.ref(props.orderColumn ?? "order")} asc`
                    : undefined}
                  orderColumn={props.orderColumn ?? "order"}
                  afterMoveToThisColumn={(s, cardId) => {
                    s.modify(
                      sql`update ${sql.ref(props.table)} set ${
                        sql.ref(props.field)
                      } = '${sql.ref(value.name)}' where id = ${cardId}`,
                    );
                  }}
                  renderCardContents={props.renderCardContents}
                  cardModal={
                    <KanbanCardModal
                      columnName={sql.lit`${value.displayName}`}
                    />
                  }
                  initializeValues={{
                    [props.field]: sql.lit`${value.name}`,
                    ...props.initializeValues,
                  }}
                  columnColor={value.color}
                />
              ))}
            </Data>
          </div>
        </SimpleRefreshKeyState>
      </div>
    );
  }
  if (field.type === "ForeignKey") {
    const otherTable = system.db.tables[field.table];
    return (
      <div sx={styles.mainBoard}>
        {props.header}
        <SimpleRefreshKeyState>
          <div sx={styles.board}>
            <Data
              procedure={(s) => {
                s.defTable(
                  "status_values",
                  sql`select * from ${otherTable.identWithDb}`,
                );
                s.defScalar("dragging_card", {
                  type: "BigInt",
                });
                s.defScalar("main_drop_target", {
                  expr: sql.lit`none`,
                  allowNoRead: true,
                });
                s.defScalar("drop_target_id", {
                  type: "BigInt",
                  allowNoRead: true,
                });
              }}
              watch={[sql`kanban_refresh_key`]}
            >
              <Each table="status_values" recordName="record_status">
                <ColumnComponent
                  cardsTableName={props.table}
                  columnName={sql`string.capitalize(record_status.name)`}
                  cardsAbleToRedorder={props.abilityToRedorder}
                  where={sql.and(
                    sql`${sql.ref(props.field)} = record_status.id`,
                    props.where ?? true,
                  )}
                  orderBy={props.abilityToRedorder
                    ? sql`${sql.ref(props.orderColumn ?? "order")} asc`
                    : undefined}
                  orderColumn={props.orderColumn ?? "order"}
                  afterMoveToThisColumn={(s, cardId) => {
                    s.modify(
                      sql`update ${sql.ref(props.table)} set ${
                        sql.ref(props.field)
                      } = record_status.id where id = ${cardId}`,
                    );
                  }}
                  renderCardContents={props.renderCardContents}
                  cardModal={
                    <KanbanCardModal
                      columnName={sql`string.capitalize(record_status.name)`}
                    />
                  }
                  initializeValues={{
                    [props.field]: sql`record_status.id`,
                    ...props.initializeValues,
                  }}
                />
              </Each>
            </Data>
          </div>
        </SimpleRefreshKeyState>
      </div>
    );
  }
  throw new Error(`Field ${props.field} is not a valid kanban field`);
}

function SimpleRefreshKeyState(props: { children: Node }) {
  addCtx(
    new SimpleRefetchContext("kanban_refresh_key", [sql`kanban_refresh_key`]),
  );
  addCtx(new ExtendedWatchKeyContext(undefined, [sql`kanban_refresh_key`]));
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("kanban_refresh_key", 0);
      }}
    >
      {props.children}
    </Data>
  );
}

/**
 A simplified Kanban board component that renders a list of predefined columns.

 @category UI Component

 @param props.cardsTableName - The name of the table containing the cards
 @param props.header - Node to render at the top of the board
 @param props.columns - Array of column configurations, each containing:
   - name: The display name of the column
   - where: SQL query to filter cards for this column
   - orderBy: Optional SQL ordering expression
   - afterMoveToThisColumn: Optional callback when a card is moved/added
   - renderCardContents: Optional node to customize card rendering
   - cardModal: Optional node for card modal content
 @param props.abilityToRedorder - Whether cards can be reordered via drag & drop
 @param props.orderColumn - Optional column name used for ordering cards
 */
export function SimplifiedKanban(props: SimplifiedKanbanProps) {
  return (
    <SimpleRefreshKeyState>
      <div sx={styles.mainBoard}>
        {props.header}
        <div sx={styles.board}>
          <Data
            local
            noRefetch
            procedure={(s) => {
              // Track currently dragged card ID
              s.defScalar("dragging_card", {
                type: "BigInt",
              });

              // Track drop target status
              s.defScalar("main_drop_target", {
                expr: sql.lit`none`,
                allowNoRead: true,
              });
              s.defScalar("drop_target_id", {
                type: "BigInt",
                allowNoRead: true,
              });
            }}
          >
            {props.columns.map((column) => {
              return (
                <ColumnComponent
                  cardsTableName={props.cardsTableName}
                  columnName={sql.lit`${column.name}`}
                  cardsAbleToRedorder={props.abilityToRedorder}
                  where={column.where}
                  orderBy={column.orderBy}
                  orderColumn={props.orderColumn ?? "order"}
                  afterMoveToThisColumn={column.afterMoveToThisColumn}
                  renderCardContents={column.renderCardContents}
                  cardModal={column.cardModal}
                  initializeValues={column.initializeValues}
                />
              );
            })}
          </Data>
        </div>
      </div>
    </SimpleRefreshKeyState>
  );
}

/**
 A modal dialog component for displaying and editing Kanban card details.

 Requirements:
 1. The table must have the following fields:
    - id: Primary key
    - title: String field for card title
    - description: String field for card description
    - Either:
      a) column: Foreign key to column table (specified via columnField prop), OR
      b) No column field - in this case columnName must be passed as a prop

 2. The component must be used within a context that provides:
    - CurrentTableICtxKey: The current table context
    - CurrentRecordICtxKey: The current record ID context

Blocks:
 - Displays card title and current column
 - Allows editing of card description
 - Shows error messages if save fails
 - Handles modal visibility via "show_modal" scalar binding
 - Auto-refreshes content when description is updated

Props:
@param proops.columnName - The name of the column to display in the modal. Required if table doesn't have column field
@param props.columnField - Optional. The name of the field that references the column table. If not provided, uses columnName prop directly

@category Dialog Component


  */
export function KanbanCardModal(props: CardModalProps) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const { columnName, columnField = "column_id" } = props;
  if (!currentTable.fields.title) {
    throw new Error(
      `Table ${currentTable.identWithDb} must have a "title" field`,
    );
  }
  if (!currentTable.fields.description) {
    throw new Error(
      `Table ${currentTable.identWithDb} must have a "description" field`,
    );
  }
  const columnResult = fetchColumnName(
    currentTable,
    currentRecordId,
    columnField,
    columnName,
  );
  return (
    <ModalDialog bindScalar="show_modal">
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("modal_refresh_key", 0);
        }}
      >
        <Data
          procedure={(s) => {
            s.defScalar("edit_mode", false);
            s.defScalar("descrition_edit", sql.lit``);
            s.defRecord(
              "selected_card",
              sql`select * from ${currentTable.identWithDb} where id = ${currentRecordId}`,
            );
            s.defScalar("modal_error", {
              type: "String",
            });
            columnResult.addToProcedure?.(s);
          }}
          watch={[sql`modal_refresh_key`]}
        >
          <div>
            <div className="flex items-center">
              <MaterialIcon icon="DvrOutlined" className="text-2xl mr-2" />
              <Typography level="h3">{sql`selected_card.title`}</Typography>
            </div>
            <div className="flex justify-between items-center mb-2 ml-8">
              <Typography level="body-md">
                {sql.lit`In List `}
                <span className="underline">{columnResult.expr}</span>
              </Typography>
            </div>
            <div className="flex items-center">
              {
                /* <IconButton
          variant="plain"
          color="neutral"
          size="md"
          aria-label={"Edit"}
        > */
              }
              <MaterialIcon
                icon="DescriptionOutlined"
                className="text-2xl mr-2"
              />
              <Typography level="body-md">{sql.lit`Description`}</Typography>
              <IconButton
                variant="plain"
                color="neutral"
                size="sm"
                aria-label="Edit"
                onClick={(s) => {
                  s.setScalar("edit_mode", true);
                }}
                className="ml-4"
              >
                <MaterialIcon icon="EditOutlined" />
              </IconButton>
            </div>
            <div className="ml-8">
              <Show when={sql`edit_mode`}>
                <div>
                  <Textarea
                    id={sql.lit`content-input`}
                    value={sql`selected_card.description`}
                    onInput={(s) => {
                      s.setScalar("descrition_edit", sql`target_value`);
                    }}
                    sx={{ minHeight: "100px" }}
                  />
                  <Button
                    color="primary"
                    size="sm"
                    onClick={(s) => {
                      s.tryServer({
                        body: (s) => {
                          s.startTransaction();
                          s.modify(sql`update ${currentTable.identWithDb}
                            set description = descrition_edit
                            where id = ${currentRecordId}
                            `);
                          s.setScalar("edit_mode", false);
                          s.increment("modal_refresh_key");
                          s.commitTransaction();
                        },
                        catch: (s) => {
                          s.setScalar("modal_error", sql.lit`Failed to save`);
                        },
                      });
                    }}
                    className="mt-2"
                  >
                    Save
                  </Button>
                </div>
              </Show>
              <Show when={sql`not edit_mode`}>
                <Typography level="body-md">
                  {sql`selected_card.description`}
                </Typography>
              </Show>
              <Show when={sql`modal_error != ''`}>
                <Alert color="danger" size="sm">{sql`modal_error`}</Alert>
              </Show>
            </div>
          </div>
        </Data>
        <div
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "1rem",
          }}
        >
          <Button
            variant="outlined"
            color="neutral"
            onClick={(s) => {
              s.setScalar("show_modal", false);
            }}
          >
            Close
          </Button>
        </div>
      </Data>
    </ModalDialog>
  );
}

/*

kanban_super

Kanban with the creation of boards for project management

Employee table
Contact table
Ticket table (enum status = 'new', 'assigned', 'in progress', 'done')

<AutoKanban table="ticket" field="status" where={sql`employee = current_user`} />

Record grid page:

<AutoKanban table="ticket" field="status" where={sql`contact = record_id`} />

*/
