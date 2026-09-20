import {
  MultiTableSearchDialog,
  type MultiTableSearchDialogTable,
  TableSearchDialog,
  type TableSearchDisplay,
} from "components/search_dialog";
import { EventHandlers } from "std/ui";
import type { Node } from "std/ui";
import { sql } from "../std/sql_utils";

export interface GlobalSearchDialogProps {
  searchDialog?: {
    table: string;
    displayValues?: (string | TableSearchDisplay)[];
  };
  multiTableSearchDialog?: {
    tables: MultiTableSearchDialogTable[];
  };
  openScalar: string;
}

/**
 A component that renders a global search dialog, either for a single table or multiple tables.
 It also adds a keyboard shortcut (Ctrl/Cmd + K) to open the search dialog.

 @category Dialog Component

 @param props.searchDialog Configuration for a single table search dialog
 @param props.multiTableSearchDialog Configuration for a multi-table search dialog
 @param props.openScalar The name of the scalar to control the open state of the dialog

 @examples
 [Example](./navbar.tsx)
*/
export function GlobalSearchDialog(props: GlobalSearchDialogProps) {
  let searchDialog: Node | undefined;
  if (props.searchDialog) {
    searchDialog = (
      <TableSearchDialog
        open={sql.ref(props.openScalar)}
        onClose={(s) => s.setScalar(props.openScalar, false)}
        table={props.searchDialog.table}
        displayValues={props.searchDialog.displayValues}
      />
    );
  }
  if (props.multiTableSearchDialog) {
    if (searchDialog) {
      throw new Error(
        "Cannot have both searchDialog and multiTableSearchDialog",
      );
    }
    searchDialog = (
      <MultiTableSearchDialog
        open={sql.ref(props.openScalar)}
        onClose={(s) => s.setScalar(props.openScalar, false)}
        tables={props.multiTableSearchDialog.tables}
      />
    );
  }
  if (!searchDialog) {
    return undefined;
  }
  return (
    <>
      {searchDialog}
      <EventHandlers
        document={{
          keydown: (s) => {
            s.if(
              sql`event.key = 'k' and (event.ctrl_key or event.meta_key)`,
              (s) => {
                s.event.preventDefault();
                s.toggle(props.openScalar);
              },
            );
          },
        }}
      />
    </>
  );
}
