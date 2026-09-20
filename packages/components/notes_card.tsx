import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  useCurrentWatchState,
} from "std/ictx";
import { sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { Conditional, Show, useICtx, useSourceMap } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";

export interface Props {
  sx?: Style;
  field?: string;
  header?: Node;
  /** Custom class name to apply to the card. */
  className?: string;
}

const styles = createStyles({
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    pb: 3,
  },
  emptyNote: {
    color: "text-tertiary",
    my: 3,
    pb: 0,
  },
  noteText: {
    whiteSpace: "pre-wrap",
    p: 2,
  },
  editingError: {
    mt: 3,
  },
  textarea: {
    mt: 3,
  },
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    mt: 3,
  },
});

/**
 A component that displays and allows editing of notes for a record and saving it to the database.

 This card component shows the current note for a record and provides functionality to edit it.
 It includes a toggle for editing mode, a textarea for modifying the note, and error handling for failed updates.

 @category UI Component

 @param props.sx

 @examples
 [Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function NotesCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  useSourceMap("notes_card");
  const field = sql.ref(props.field ?? "notes");
  useCurrentWatchState((s) => {
    s.defScalar(
      "note",
      sql`(select ${field} from ${currentTable.identWithDb} where id = ${currentRecordId})`,
    );
  });
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("editing", false);
      }}
    >
      <Card variant="outlined" sx={props.sx} className={props.className}>
        <CardHeader>
          <Typography level="title-lg" startIcon="Notes">
            {props.header ?? "Notes"}
          </Typography>
          <div sx={flexGrowStyles} />
          <IconButton
            variant="plain"
            size="sm"
            aria-label={sql`case when editing then 'Cancel edit' else 'Edit note' end`}
            onClick={(s) => s.toggle("editing")}
          >
            <Show
              when={sql`editing`}
              fallback={<MaterialIcon icon="EditOutlined" />}
            >
              <MaterialIcon icon="Close" />
            </Show>
          </IconButton>
        </CardHeader>
        <Divider />
        <Conditional
          when={sql`editing`}
          then={
            <Data
              local
              noRefetch
              procedure={(s) => {
                s.defScalar("editing_note", sql`note`);
                s.defScalar("in_progress", false);
                s.defScalar("failed", false);
              }}
            >
              {/*Example_Textarea_Start*/}
              <Textarea
                sx={styles.textarea}
                yolmFocusKey
                bindScalar="editing_note"
              />
              {/*Example_Textarea_End*/}
              <Show when={sql`failed`}>
                <Alert sx={styles.editingError} color="danger">
                  Unable to add note at this time
                </Alert>
              </Show>
              <div sx={styles.buttons}>
                <Button
                  loading={sql`in_progress`}
                  size="sm"
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
                            sql`update ${currentTable.identWithDb} set ${field} = ui.editing_note where id = ${currentRecordId}`,
                          );
                          s.commitTransaction();
                          triggerRefetch(s);
                        });
                        s.setScalar("ui.editing", false);
                      },
                      catch: (s) => {
                        s.setScalar("ui.in_progress", false);
                        s.setScalar("ui.failed", true);
                      },
                    });
                  }}
                >
                  Save changes
                </Button>
              </div>
            </Data>
          }
          else={
            <Conditional
              when={sql`note is null or note = ''`}
              then={<p sx={styles.emptyNote}>No notes here!</p>}
              else={
                <Typography
                  level="body-md"
                  sx={styles.noteText}
                >
                  {sql`note`}
                </Typography>
              }
            />
          }
        />
      </Card>
    </Data>
  );
}
