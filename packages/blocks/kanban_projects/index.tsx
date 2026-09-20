import { AutoInsertButton } from "components/auto_insert_dialog";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import { KanbanBoardViewContent } from "components/kanban/kanban";
import { Link } from "components/link";
import { MaterialIcon } from "components/material_icon";
import { DataTable } from "components/data_table";
import { Typography } from "components/typography";
import { RecordPage } from "pages/record_page";
import { SearchCardPage } from "pages/search_card_page";
import { Data } from "std/data";
import { TableLinksSharedContext } from "std/shared_contexts";
import { sql } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import { system } from "std/system";
import { Each, Show, useSharedContext } from "std/ui";
import { KanbanCardModal } from "./modal";
import { KanbanProjectsBlock } from "./kanban_projects_block";

const Pages = () => {
  const tableLinks = useSharedContext(TableLinksSharedContext);
  tableLinks.add(
    system.db.tables.kanban_boards,
    (id) => sql.concat("/projects/", id),
  );
  return (
    <>
      <SearchCardPage
        path="/projects"
        table="kanban_boards"
        display="grid"
        header={
          <div>
            <div className="flex justify-between items-center mb-8">
              <Typography level="h1">Projects</Typography>
              <AutoInsertButton
                startIcon="Add"
                variant="solid"
                color="primary"
                size="sm"
                navigateAfterInsert
                table="kanban_boards"
              >
                Add Project
              </AutoInsertButton>
            </div>
          </div>
        }
        card={
          <Card
            variant="outlined"
            sx={{
              p: 6,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              height: "100%",
              transition: "box-shadow 0.3s ease",
              "&:hover": {
                boxShadow: "md",
              },
            }}
          >
            <Data
              procedure={(s) => {
                s.defRecord(
                  "board_record",
                  sql`select * from db.kanban_boards where id = kanban_board_record.id`,
                );
                s.defTable(
                  "board_columns",
                  sql`select c.*, (select count(*) from db.kanban_cards where kanban_column_id = c.id) as card_count from db.kanban_columns c where c.kanban_board_id = kanban_board_record.id order by c."order" asc`,
                );
              }}
              pendingFallback={null}
              errorFallback={null}
            >
              <div className="flex justify-between items-center">
                <Typography level="h4" className="font-semibold">
                  <Link
                    href={sql.concat(
                      "/projects/",
                      sql`kanban_board_record.id`,
                    )}
                    color="neutral"
                    className="block hover:text-primary-600"
                  >
                    {sql`board_record.name`}
                  </Link>
                </Typography>
                <DeleteRecordIconButton
                  table="kanban_boards"
                  recordId={sql`kanban_board_record.id`}
                  size="sm"
                  variant="plain"
                  icon="DeleteOutlined"
                />
              </div>

              <div className="flex flex-row gap-4 flex-wrap justify-around mt-2">
                <Each table="board_columns" recordName="col">
                  <div className="flex flex-col items-center px-4 py-2 rounded-md bg-surface shadow-xs">
                    <Typography level="title-sm">
                      {sql`col.name`}
                    </Typography>
                    <Typography level="body-sm" className="font-semibold">
                      {sql`col.card_count`} tasks
                    </Typography>
                  </div>
                </Each>
              </div>

              <div sx={{ mt: "auto", pt: 2 }}>
                <Button
                  variant="soft"
                  color="primary"
                  startIcon="ViewKanban"
                  size="sm"
                  fullWidth
                  href={sql.concat(
                    "/projects/",
                    sql`kanban_board_record.id`,
                  )}
                >
                  View Project
                </Button>
              </div>
            </Data>
          </Card>
        }
      />
      <RecordPage
        table="kanban_boards"
        path="/projects/{record_id:id}"
      >
        <div className="grid grid-cols-12 w-full">
          <KanbanBoardViewContent
            sx={{ gridColumnSpan: 12 }}
            cardTableName="kanban_cards"
            columnTableName="kanban_columns"
            header={
              <Typography level="h2" className="mb-4">
                {sql`record.name`}
              </Typography>
            }
            query={sql`select id, name, "order" from db.kanban_columns where kanban_board_id = ui.record_id order by "order" asc`}
            cardOrderingQuery={(columnId) =>
              sql`select * from db.kanban_cards where kanban_column_id = ${columnId} order by "order" asc`}
            addNewColumn={(s, name) => {
              s.defScalar(
                "new_order",
                sql`coalesce(ordering.new((select "order" from db.kanban_columns where kanban_board_id = ui.record_id order by "order" desc limit 1)), ordering.new())`,
              );
              s.modify(
                sql`insert into kanban_columns (kanban_board_id, name, "order") values (ui.record_id, ${name}, new_order)`,
              );
            }}
            columnComponent={{
              getOrderingAfter: (id, targetOrder) => {
                return sql`(select "order" from db.kanban_cards where "order" > ${targetOrder} and kanban_column_id = ${id} order by "order" asc limit 1)`;
              },
              getOrderingBefore: (id, targetOrder) => {
                return sql`(select "order" from db.kanban_cards where "order" < ${targetOrder} and kanban_column_id = ${id} order by "order" desc limit 1)`;
              },
              addNewCard: (s, id, title) => {
                s.defScalar(
                  "new_order",
                  sql`coalesce(ordering.new((select "order" from db.kanban_cards where kanban_column_id = ${id} order by "order" desc limit 1)), ordering.new())`,
                );
                s.modify(sql`
                insert into db.kanban_cards (kanban_column_id, title, "order")
                values (${id}, ${title}, new_order)
              `);
              },
              query: (columnId) =>
                sql`select id, "order" from db.kanban_cards where kanban_column_id = ${columnId}`,
              moveCard: (s, { cardId, targetColumn, newOrder }) => {
                s.modify(sql`
                    update db.kanban_cards
                    set kanban_column_id = ${targetColumn}, "order" = ${newOrder}
                    where id = ${cardId}
                  `);
              },
            }}
            cardComponent={{
              cardModal: <KanbanCardModal />,
              renderCardContents: <KanbanCard />,
            }}
            columnOrderingThroughMenu
            draggableColumnReorder
          />
        </div>
      </RecordPage>
    </>
  );
};

const YourTasksQueryTable = ({ sx }: { sx?: Style }) => {
  return (
    <div sx={sx}>
      <DataTable
        header={
          <Typography level="title-md" sx={{ p: 1 }}>Your tasks</Typography>
        }
        query={sql`select kanban_cards.title, kanban_columns.name as column_name, kanban_boards.name as board_name, kanban_boards.id as board_id
        from kanban_cards
        auto join kanban_columns
        auto join kanban_boards
        where exists (select 1 from kanban_card_assignees where kanban_card_id = kanban_cards.id and sys_user_id = current_user)`}
        primaryTable="kanban_cards"
        columns={(b) => {
          b.field("title");
          b.simpleColumn("column_name");
          b.column("Project", ({ record }) => (
            <Link
              href={sql.concat("/projects/", sql`${record}.board_id`)}
            >
              {sql`${record}.board_name`}
            </Link>
          ));
        }}
      />
    </div>
  );
};

function KanbanCard() {
  const block = system.block(KanbanProjectsBlock);
  const icons = [
    {
      icon: <MaterialIcon icon="Description" />,
      show: sql`card_info.description is not null`,
    },
  ];
  if (block.comments) {
    icons.push({
      icon: <MaterialIcon icon="CommentOutlined" />,
      show:
        sql`exists(select 1 from card_comments where kanban_card_id = card_info.id)`,
    });
  }
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "card_info",
          sql`select * from db.kanban_cards where id = card_record.id`,
        );
        if (block.comments) {
          s.defTable(
            "card_comments",
            sql`select * from db.kanban_card_comments where kanban_card_id = card_record.id`,
          );
        }
        if (block.assignable) {
          s.defTable(
            "card_assignees",
            sql`select ca.*, su.acronym_virtual from db.kanban_card_assignees ca join db.sys_users su on su.id = ca.sys_user_id where ca.kanban_card_id = card_record.id`,
          );
        }
      }}
      pendingFallback={null}
      errorFallback={null}
    >
      <div className="flex flex-col gap-2">
        {sql`card_info.title`}
        <div className="w-full flex gap-2">
          {icons.map((icon) => <Show when={icon.show}>{icon.icon}</Show>)}
          {block.assignable && (
            <div sx={{ display: "flex", gap: 1, ml: "auto" }}>
              <Each table="card_assignees" recordName="assignee">
                <Chip size="sm" color="primary" variant="soft">
                  {sql`assignee.acronym_virtual`}
                </Chip>
              </Each>
            </div>
          )}
        </div>
      </div>
    </Data>
  );
}

KanbanProjectsBlock.Pages = Pages;
KanbanProjectsBlock.YourTasksQueryTable = YourTasksQueryTable;

export { KanbanProjectsBlock };
