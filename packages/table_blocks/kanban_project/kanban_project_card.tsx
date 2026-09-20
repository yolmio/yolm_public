import { AutoInsertIconButton } from "components/auto_insert_dialog";
import { Card, CardHeader } from "components/card";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { InlineRecordDisplay } from "components/inline_record_display";
import { AutoKanban } from "components/kanban/kanban";
import { NotesCard } from "components/notes_card";
import { PageHeader } from "components/page_header";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form } from "std/form";
import { CurrentTableICtxKey } from "std/ictx";
import { singularize } from "std/inflectors";
import { RecordPage } from "pages/record_page";
import { sql } from "../../std/sql_utils";
import type { NumericExpr } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import { flexGrowStyles } from "std/style_utils";
import { system } from "std/system";
import { Each, Show, useICtx } from "std/ui";
import type { Node } from "std/ui";
import { getTableBaseUrl } from "std/utils/url";
import { AttachmentsCard } from "table_blocks/attachments/attachments_card";
import { KanbanProjectTableBlock } from "./index";

interface KanbanProjectListProps {
  /**
         Optional custom renderer for Kanban card contents
         */
  renderCardContents?: Node;
  /**
         Optional flag to enable drag-and-drop reordering within columns
         */
  abilityToRedorder?: boolean;
  /**
         Optional default values to set when creating new Kanban items
         */
  initializeValues?: Record<string, any>;
  /**
         Optional CSS styles to apply to the card
         */
  sx?: Style;
}

/**
 A component that provides a complete Kanban project List interface.
 Handles multiple projects per parent record with:
 - Project selection/creation
 - Project details
 - Attachments
 - Notes
 - Kanban board

 Must be used within a context that provides CurrentRecordICtx.
 */
export function KanbanProjectListCard(props: KanbanProjectListProps) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const block = currentTable.block(KanbanProjectTableBlock);
  const boardsTableName = block.projectsTableName;
  const cardsTableName = block.tasksTableName;
  const boardCardStatusEnumName = block.taskStatusEnumName;
  const enum_ = system.enums[boardCardStatusEnumName];
  const boardsTable = system.db.tables[boardsTableName];
  const parentFkField = Object.values(boardsTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === currentTable.name,
  );
  if (!parentFkField) {
    throw new Error(
      `No foreign key field found for ${boardsTableName} to ${currentTable.name}`,
    );
  }
  const projectFkColumn = `${singularize(boardsTableName)}_id`;
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "projects",
          sql`select * from db.${sql.ref(boardsTableName)} where ${
            sql.ref(parentFkField.name)
          } = ui.record_id`,
        );
      }}
    >
      <Card sx={{ gridColumnSpan: 12, ...props.sx }} variant="outlined">
        <CardHeader variant="soft">
          <Typography startIcon="Notes" level="body-lg">
            Projects
          </Typography>
          <div sx={flexGrowStyles} />
          <AutoInsertIconButton
            size="sm"
            table={boardsTableName}
            parentTable={currentTable.name}
          />
        </CardHeader>
        <div
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(1, 1fr)",
            md: {
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 4,
            },
            lg: {
              gridTemplateColumns: "repeat(3, 1fr)",
            },
            pt: 4,
            gap: 3,
          }}
        >
          <Show when={sql`(select count(*) from projects) = 0`}>
            <div>No projects</div>
          </Show>
          <Each table="projects" recordName="project">
            <Data
              procedure={(s) => {
                for (const v of Object.values(enum_.values)) {
                  s.defScalar(
                    `${v.name}_count`,
                    sql`(select count(*) from db.${
                      sql.ref(cardsTableName)
                    } where ${
                      sql.ref(projectFkColumn)
                    } = project.id and status = ${sql.lit(v.name)})`,
                  );
                }
              }}
              pendingFallback={null}
            >
              <Card
                variant="soft"
                sx={{
                  p: 8,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  transition: "transform 0.2s, box-shadow 0.2s",
                  "&:hover": {
                    transform: "translateY(-4px)",
                    boxShadow: "md",
                  },
                }}
                onClick={(s) => {
                  s.navigate(
                    sql.concat(
                      "/",
                      getTableBaseUrl(boardsTableName),
                      "/",
                      sql`project.id`,
                    ),
                  );
                }}
              >
                <Typography level="h4" className="font-semibold">
                  {sql`project.name`}
                </Typography>
                <div className="flex flex-row gap-4 items-center text-center">
                  {Object.values(enum_.values).map((v) => {
                    return (
                      <div className="flex flex-col items-center">
                        {v.color
                          ? (
                            <span
                              sx={{
                                display: "inline-block",
                                width: "0.75em",
                                height: "0.75em",
                                borderRadius: "50%",
                                backgroundColor: v.color,
                                marginRight: 1,
                                verticalAlign: "center",
                              }}
                            />
                          )
                          : null}
                        <Typography level="body-sm">
                          {v.displayName}:{"  "}
                          {sql`${sql.ref(`${v.name}_count`)}`}
                        </Typography>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Data>
          </Each>
        </div>
      </Card>
    </Data>
  );
}

interface KanbanProjectContentProps extends Omit<KanbanProjectListProps, "sx"> {
  projectId: NumericExpr;
  cardsTableName: string;
  boardsTableName: string;
  parentTable: string;
}

/**
 KanbanProjectContent component displays the content for a Kanban project view.

 This component renders:
 - An automatic page header based on the project
 - An attachments card for managing project files
 - A notes card for project notes/comments
 - A Kanban board for managing project tasks/cards

  - The ID of the current project
  - Name of the table containing the Kanban cards/tasks
  - Name of the table containing the Kanban boards/projects
  - Whether cards can be reordered via drag and drop
  - Optional custom renderer for card contents
  - Optional initial values for new cards
 */
export function KanbanProjectContent(props: KanbanProjectContentProps) {
  const table = useICtx(CurrentTableICtxKey).currentTable;
  const fkField = Object.values(table.fields).find(
    (f) => f.type === "ForeignKey" && f.table === props.parentTable,
  );
  if (!fkField) {
    throw new Error(
      `No foreign key field found for ${table.name} to ${props.parentTable}`,
    );
  }
  return (
    <>
      <PageHeader className="bg-surface">
        <div>
          <Typography level="h4" className="flex items-center">
            <Form.InlineEdit field="name" />
          </Typography>
          <Typography level="body-sm">
            For:{" "}
            <InlineRecordDisplay
              tableName={props.parentTable}
              id={sql`record.${sql.ref(fkField.name)}`}
            />
          </Typography>
        </div>
        <PageHeader.Grow />
        <DeleteRecordButton
          size="sm"
          variant="outlined"
          globalUndoSnackbarKey={`page_header_${table.name}_undo`}
          afterTransactionCommit={(s) => s.navigate(sql.lit`/`)}
        >
          Delete
        </DeleteRecordButton>
      </PageHeader>
      <NotesCard sx={{ gridColumnSpan: 12, md: { gridColumnSpan: 6 } }} />
      <AttachmentsCard sx={{ gridColumnSpan: 12, md: { gridColumnSpan: 6 } }} />
      <div sx={{ gridColumnSpan: 12, pt: 2 }}>
        <AutoKanban
          table={props.cardsTableName}
          field="status"
          where={sql`${
            sql.ref(singularize(props.boardsTableName))
          }_id = ${props.projectId}`}
          initializeValues={{
            [`${singularize(props.boardsTableName)}_id`]: props.projectId,
            ...props.initializeValues,
          }}
          abilityToRedorder={props.abilityToRedorder}
          renderCardContents={props.renderCardContents}
        />
      </div>
    </>
  );
}

interface KanbanProjectPageProps {
  table: string;
}

/**
 KanbanProjectPage provides a complete page interface for managing a single Kanban project.

 This component:
 - Renders a full-page view of a single Kanban project using RecordPage
 - Displays the project content including attachments, notes and Kanban board
 - Provides an edit form for updating project details

 It is typically used as a route in an app to show the details and Kanban board
 for a specific project. The component automatically handles:
 - Loading the project record
 - Displaying project details in a grid layout
 - Managing project cards/tasks in a Kanban board
 - Editing project properties via a form

  - The name of the parent table that has the KanbanProjectTableBlock
 */
export function KanbanProjectPage(props: KanbanProjectPageProps) {
  const currentTable = system.db.tables[props.table];
  const block = currentTable.block(KanbanProjectTableBlock);
  const boardsTableName = block.projectsTableName;
  const cardsTableName = block.tasksTableName;
  return (
    <RecordPage table={boardsTableName}>
      <div className="grid grid-cols-12 w-full mx-auto p-2 sm:px-4 md:gap-4 lg:px-10 xl:px-12 xl:max-w-7xl py-4 gap-3">
        <KanbanProjectContent
          projectId={sql`ui.record_id`}
          cardsTableName={cardsTableName}
          boardsTableName={boardsTableName}
          parentTable={props.table}
          abilityToRedorder
        />
      </div>
    </RecordPage>
  );
}
