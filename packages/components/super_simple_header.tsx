import { AutoUpdateButton } from "components/auto_update_dialog";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { CurrentRecordICtxKey, CurrentTableICtxKey } from "std/ictx";

import { sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { useICtx } from "std/ui";
import type { Node } from "std/ui";

export interface Props {
  sx?: Style;
  rightSection?: Node;
  edit?: boolean;
  delete?: boolean;
  header: string;
}

const styles = createStyles({
  root: {
    gridColumn: "span 12 / span 12",
    display: "flex",
    gap: 2,
    alignItems: "baseline",
  },
});

/**
 A simple header component with optional edit and delete buttons.

 @category UI Component

 @param props.header - The main text to display in the header.
 @param props.sx
 @param props.rightSection - Additional content to display on the right side of the header.
 @param props.edit - Whether to show the edit button.
 @param props.delete - Whether to show the delete button.

 @examples
 [Example](../../examples/chinook/apps/chinook.yolmstaging.net.tsx)
*/
export function SuperSimpleHeader(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  return (
    <div sx={styles.root}>
      <Typography level="h4">{props.header}</Typography>
      <div sx={flexGrowStyles} />
      {props.rightSection}
      {props.edit
        ? (
          <AutoUpdateButton
            table={currentTable.name}
            recordId={currentRecordId}
            color="primary"
            size="sm"
            variant="soft"
            startDecorator={<MaterialIcon icon="Edit" />}
          >
            Edit
          </AutoUpdateButton>
        )
        : undefined}
      {props.delete
        ? (
          <DeleteRecordButton
            table={currentTable.name}
            recordId={currentRecordId}
            size="sm"
            afterTransactionCommit={(s) =>
              s.navigate(sql.lit(currentTable.baseUrl))}
          />
        )
        : undefined}
    </div>
  );
}
