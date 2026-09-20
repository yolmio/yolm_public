import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card } from "components/card";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { useUndoSnackbar } from "components/undo_snackbars";
import { CurrentRecordICtxKey, CurrentTableICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, flexGrowStyles } from "std/style_utils";
import type { Field, Table } from "std/system";
import {
  Conditional,
  Each,
  Show,
  useICtx,
  useSourceMap,
  useUniqueId,
} from "std/ui";
import { Data } from "std/data";
import { NotesListTableBlock } from "table_blocks/notes_list";

/** Props for {@link NotesListCard}. */
export interface Props {
  sx?: Style;
  /** Custom class name to apply to the card. */
  className?: string;
  /** Override the foreign-key field name linking notes back to the current record; auto-detected from the notes table when omitted. */
  foreignKeyField?: string;
  /**
   * Currently unused — the notes table is always resolved from the current
   * table's {@link NotesListTableBlock}.
   */
  notesTable?: string;
}

const styles = createStyles({
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addingForm: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  addingButtons: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 2,
  },
  addingError: {
    mt: 2,
  },
  emptyText: {
    color: "text-secondary",
    fontSize: "sm",
    my: 0,
    py: 6,
    textAlign: "center",
  },
  notes: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 400,
    overflowY: "auto",
    overflowX: "hidden",
  },
  editing: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  editingError: {
    my: 2,
  },
  editButtons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 2,
  },
  note: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    py: 3,
  },
  noteHeader: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  noteDate: {
    color: "text-secondary",
    my: 0,
    fontSize: "sm",
  },
  noteContent: {
    whiteSpace: "pre-wrap",
    my: 0,
    fontSize: "sm",
  },
});

interface AddNoteFormProps {
  notesTable: Table;
  fkField: Field;
}

/**
 A form component for adding a new note to a record.

 This component provides a textarea for entering the note content and a button to submit the note.
 It handles the state for the note content, submission progress, and error handling.
 The component uses the current record and table context to associate the note with the correct record.

 @category UI Component

 @param notesTable The table where notes are stored

*/
function AddNoteForm({ notesTable, fkField }: AddNoteFormProps) {
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("content", sql.lit``);
        s.defScalar("in_progress", false);
        s.defScalar("failed", false);
      }}
    >
      <div sx={styles.addingForm}>
        <Textarea
          bindScalar="content"
          yolmFocusKey
          placeholder="Write a note. Use @name for teammate context."
        />
        <Show when={sql`failed`}>
          <Alert sx={styles.addingError} color="danger">
            Unable to add note at this time
          </Alert>
        </Show>
        <div sx={styles.addingButtons}>
          <Typography level="body-xs" className="text-tertiary">
            Notes stay linked to this record.
          </Typography>
          <Button
            size="sm"
            loading={sql`in_progress`}
            onClick={(s) => {
              s.returnIf(sql`in_progress`);
              s.setScalar("in_progress", true);
              s.setScalar("failed", false);
              s.commitUiTreeChanges();
              s.try({
                body: (s) => {
                  s.server((s) => {
                    s.startTransaction();
                    s.modify(
                      sql`insert into ${notesTable.identWithDb} (content, date, ${
                        sql.ref(fkField.ident)
                      }) values (ui.content, current_date(), ${currentRecordId})`,
                    );
                    s.commitTransaction();
                    s.refetch();
                  });
                  s.setScalar("ui.adding", false);
                },
                catch: (s) => {
                  s.setScalar("ui.in_progress", false);
                  s.setScalar("ui.failed", true);
                },
              });
            }}
          >
            Save note
          </Button>
        </div>
      </div>
    </Data>
  );
}

interface EditNoteFormProps {
  notesTable: Table;
}

/**
 A component that renders a form for editing an existing note.

 This form includes fields for the note's content and date, and buttons to save or cancel the edit.
 It handles the update process, including error handling and UI state management.

 @category UI Component

 @param notesTable - The database table where notes are stored

*/
function EditNoteForm({ notesTable }: EditNoteFormProps) {
  const dateInputId = useUniqueId();
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("content", sql`note_record.content`);
        s.defScalar("date", sql`note_record.date`);
        s.defScalar("in_progress", false);
        s.defScalar("failed", false);
      }}
    >
      <div sx={styles.editing}>
        <FormControl>
          {/*Example_FormLabel_Start*/}
          <FormLabel htmlFor={dateInputId}>Date</FormLabel>
          {/*Example_FormLabel_End*/}
          <Input
            id={dateInputId}
            value={sql`date`}
            type="date"
            onInput={(s) => {
              s.if(sql`try_cast(target_value as date) is not null`, (s) => {
                s.setScalar("ui.date", sql`cast(target_value as date)`);
              });
            }}
          />
        </FormControl>
        <Textarea bindScalar="content" />
        <Show when={sql`failed`}>
          <Alert sx={styles.editingError} color="danger">
            Unable to edit note at this time
          </Alert>
        </Show>
        <div sx={styles.editButtons}>
          <Button
            variant="soft"
            color="neutral"
            onClick={(s) => s.setScalar("ui.editing", false)}
          >
            Cancel
          </Button>
          <Button
            loading={sql`in_progress`}
            onClick={(s) => {
              s.returnIf(sql`in_progress`);
              s.setScalar("ui.in_progress", true);
              s.setScalar("ui.failed", false);
              s.commitUiTreeChanges();
              s.try({
                body: (s) => {
                  s.server((s) => {
                    s.startTransaction();
                    s.modify(
                      sql`update ${notesTable.identWithDb} set content = ui.content, date = ui.date where id = note_record.id`,
                    );
                    s.commitTransaction();
                    s.refetch();
                  });
                  s.setScalar("ui.editing", false);
                },
                catch: (s) => {
                  s.setScalar("failed", true);
                },
              });
            }}
          >
            Confirm changes
          </Button>
        </div>
      </div>
    </Data>
  );
}

interface NoteItemProps {
  notesTable: Table;
}

/**
 Renders a single note item with options to edit and delete.

 This component displays the note's date and content, and provides buttons to edit or delete the note.
 It uses conditional rendering to switch between display and edit modes.

 @category UI Component

 @param notesTable The table where notes are stored

*/
function NoteItem({ notesTable }: NoteItemProps) {
  const undoSnackbars = useUndoSnackbar({
    successSnackbarContent: sql.lit`Deleted note`,
    afterUndo: (s) => {
      s.refetch();
    },
  });
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("deleting", {
          expr: false,
          allowNoRead: true,
        });
        s.defScalar("editing", false);
      }}
    >
      <Conditional
        when={sql`editing`}
        then={<EditNoteForm notesTable={notesTable} />}
        else={
          <div sx={styles.note}>
            <div sx={styles.noteHeader}>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-level1 text-secondary">
                <MaterialIcon icon="StickyNote2" className="text-base" />
              </div>
              <p sx={styles.noteDate}>
                {sql`format.date(note_record.date, '%-d %b %Y')`}
              </p>
              <div sx={flexGrowStyles} />
              <IconButton
                color="neutral"
                variant="plain"
                size="sm"
                onClick={(s) => s.setScalar("ui.editing", true)}
                aria-label="Edit Note"
                icon="EditOutlined"
              />
              <DeleteRecordIconButton
                color="neutral"
                variant="plain"
                size="sm"
                aria-label="Delete Note"
                icon="DeleteOutlined"
                table={notesTable.name}
                recordId={sql`note_record.id`}
                afterTransactionCommit={(s) => s.refetch()}
                beforeTransactionCommit={(s) => undoSnackbars.setUndoTx(s)}
                afterSubmitClient={undoSnackbars.openSuccess}
              />
            </div>
            <p sx={styles.noteContent} className="pl-9">
              {sql`note_record.content`}
            </p>
          </div>
        }
      />
    </Data>
  );
}

/**
 A component that displays a list of notes for a record and allows adding new notes.

 This card component shows existing notes for a record, provides functionality to add new notes,
 and displays each note with options to edit or delete. It handles the state for adding notes
 and fetches the current notes for the record.

 Unlike the NotesCard component where the note is part of a record, the NotesListCard component
 is used when the notes are stored in a separate table from the record.

 Prerequisite: A notes table for the current table must be defined in the database definition, for example:

 ```tsx
 notesTable("company");
 ```

  </sql>

 @category UI Component

 @param props.sx
 @param props.notesTable - Optional custom name for the notes table
 @param props.foreignKeyField - Optional custom foreign key field name

*/
export function NotesListCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const block = currentTable.block(NotesListTableBlock);
  const notesTableModel = block.table;
  let foreignKeyField: Field | undefined;
  if (typeof props.foreignKeyField === "string") {
    foreignKeyField = notesTableModel.fields[props.foreignKeyField];
  }
  if (!foreignKeyField) {
    foreignKeyField = Object.values(notesTableModel.fields).find(
      (f) => f.type === "ForeignKey" && f.table === currentTable.name,
    );
  }

  if (!foreignKeyField) {
    throw new Error(
      `No foreign key field found for ${notesTableModel.name} to ${currentTable.name}`,
    );
  }
  useSourceMap("notes_list_card");
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("adding", false);
      }}
    >
      <Data
        procedure={(s) => {
          s.defTable(
            "note",
            sql`select content, date, id from ${notesTableModel.identWithDb} where ${foreignKeyField.ident} = ${currentRecordId} order by date desc, id desc`,
          );
        }}
      >
        <Card
          variant="outlined"
          sx={props.sx}
          className={`${props.className ?? ""} overflow-hidden`}
        >
          <div className="border-b border-divider px-4 py-3">
            <div sx={styles.header}>
              <div>
                <Typography
                  level="body-xs"
                  className="font-semibold uppercase text-secondary"
                >
                  Notes
                </Typography>
                <Typography level="body-md" className="font-semibold">
                  Record notes
                </Typography>
              </div>
              <Conditional
                when={sql`adding`}
                then={
                  <Button
                    variant="soft"
                    color="neutral"
                    size="sm"
                    startIcon="Close"
                    onClick={(s) => s.setScalar("ui.adding", false)}
                  >
                    Cancel
                  </Button>
                }
                else={
                  <Button
                    variant="plain"
                    color="primary"
                    size="sm"
                    startIcon="Add"
                    onClick={(s) => s.setScalar("ui.adding", true)}
                  >
                    New note
                  </Button>
                }
              />
            </div>
          </div>
          <Show when={sql`adding`}>
            <div className="border-b border-divider bg-level1 p-4">
              <AddNoteForm
                notesTable={notesTableModel}
                fkField={foreignKeyField}
              />
            </div>
          </Show>
          <Conditional
            when={sql`exists (select id from note)`}
            then={
              <div sx={styles.notes} className="divide-y divide-divider px-4">
                {/*Example_Each_Start*/}
                <Each table="note" recordName="note_record" eachKey={sql`id`}>
                  <NoteItem notesTable={notesTableModel} />
                </Each>
                {/*Example_Each_End*/}
              </div>
            }
            else={<p sx={styles.emptyText}>No notes yet.</p>}
          />
        </Card>
      </Data>
    </Data>
  );
}
