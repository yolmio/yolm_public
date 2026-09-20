import {
  createImageSetEndpointsForCurrentApp,
  ImageSetFieldGroup,
  imageVariantUrl,
} from "field_groups/image_set";
import { getVariantFromImageSet, uploadImageSet } from "field_groups/image_set";
import { CurrentRecordICtxKey, CurrentTableICtxKey } from "std/ictx";
import { sql, updateAssignment } from "../std/sql_utils";
import type { NumericExpr } from "../std/sql_utils";
import type { UiServerStatementsOrFn } from "std/statements";
import { createStyles, visuallyHiddenStyles } from "std/style_utils";
import { system } from "std/system";
import { Show, useOptionalICtx } from "std/ui";
import { Data } from "std/data";
import { Alert } from "./alert";
import { Button } from "./button";
import { Divider } from "./divider";
import { IconButton } from "./icon_button";
import { ModalDialog } from "./modal";
import { resolveDialogBinding } from "./utils";
import type { DialogBinding } from "./utils";

interface ImageDialogProps extends DialogBinding {
  tableName?: string;
  recordId?: NumericExpr;
  group: string;
  afterReplace?: UiServerStatementsOrFn;
  afterRemove?: UiServerStatementsOrFn;
}

const styles = createStyles({
  dialogRoot: {
    display: "flex",
    gap: 3,
    flexDirection: "column-reverse",
    maxWidth: "calc(100vw - 32px)",
    lg: { flexDirection: "row" },
  },
  img: {
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100vh - 98px)",
    minHeight: 50,
    width: "100%",
    border: "1px solid",
    borderColor: "divider",
    lg: {
      maxWidth: "calc(100vw - 32px - 132px)",
      maxHeight: "calc(100vh - 48px)",
    },
  },
  actionsWrapper: {
    display: "flex",
    gap: 2,
    alignItems: "center",
    lg: { flexDirection: "column" },
  },
  closeButton: {
    order: 5,
    ml: "auto",
    justifySelf: "flex-end",
    lg: {
      ml: "auto",
      order: "initial",
      justifySelf: "inherit",
      alignSelf: "flex-end",
    },
  },
  divider: {
    display: "none",
    lg: { display: "block" },
  },
  replaceButton: (app) => ({ "&:focus-within": app.theme.focus.default }),
});

/**
 A component that displays a dialog for viewing, replacing, and removing an image.

 @category Dialog Component

 @param props.open
 @param props.onClose
 @param props.tableName The name of the table containing the image field (optional if CurrentTableICtxKey is provided)
 @param props.recordId The ID of the record containing the image (optional if CurrentRecordICtxKey is provided)
 @param props.group The name of the image set field group
 @param props.afterReplace
 @param props.afterRemove

 @examples
 [Example](../pages/datagrid_internals/cells.tsx)
*/
export function ImageDialog(props: ImageDialogProps) {
  const { open, onClose } = resolveDialogBinding(props);
  const table = props.tableName
    ? system.db.tables[props.tableName]
    : useOptionalICtx(CurrentTableICtxKey)?.currentTable;
  if (!table) {
    throw new Error("No table found for image dialog");
  }
  const recordId = props.recordId ??
    useOptionalICtx(CurrentRecordICtxKey)?.currentRecordId;
  if (!recordId) {
    throw new Error("No record id found for image dialog");
  }
  const fieldGroup = table.fieldGroups[props.group];
  if (!(fieldGroup instanceof ImageSetFieldGroup)) {
    throw new Error("Invalid field group type for image dialog");
  }
  const fullImageFieldName = getVariantFromImageSet(fieldGroup, "dialog_full", [
    "general_full",
  ]);
  if (!fullImageFieldName) {
    throw new Error("Image dialog requires a full image variant");
  }
  createImageSetEndpointsForCurrentApp(table.name, fieldGroup);
  const fullImageIndex = Object.keys(fieldGroup.variants).indexOf(
    fullImageFieldName,
  );
  const { upload, updateDb } = uploadImageSet(table.name, recordId, fieldGroup);
  const setFieldsToNull = Object.keys(fieldGroup.variants).map((fieldName) =>
    updateAssignment(fieldName, sql.null)
  );
  return (
    <ModalDialog open={open} onClose={onClose}>
      <Data
        procedure={(s) => {
          s.defScalar(
            "full_img",
            sql`(select ${
              sql.ref(fullImageFieldName)
            } from ${table.identWithDb} where id = ${recordId})`,
          );
          s.defScalar("uploading", false);
          s.defScalar("deleting", {
            expr: false,
            allowNoRead: true,
          });
          s.defScalar("failed_upload", false);
          s.defScalar("failed_remove", false);
        }}
      >
        <div sx={styles.dialogRoot}>
          <div>
            <img
              sx={styles.img}
              alt="Full size image"
              src={imageVariantUrl(
                table,
                fullImageFieldName,
                recordId,
                sql`full_img`,
              )}
            />
          </div>
          <div sx={styles.actionsWrapper}>
            <IconButton
              sx={styles.closeButton}
              color="neutral"
              variant="plain"
              size="sm"
              onClick={onClose}
              aria-label="Close dialog"
              icon="Close"
            />
            <Divider sx={styles.divider} inset="none" />
            <Button
              component="label"
              size="sm"
              startIcon="Upload"
              sx={styles.replaceButton()}
              variant="outlined"
              color="neutral"
              loading={sql`uploading`}
              loadingPosition="start"
            >
              <input
                sx={visuallyHiddenStyles}
                accept="image/*"
                type="file"
                onFileChange={(s) => {
                  s.returnIf(sql`uploading`);
                  s.setScalar("uploading", true);
                  s.commitUiTreeChanges();
                  s.tryServer({
                    transferFiles: sql`select uuid from file`,
                    body: (s) => {
                      s.statements(upload);
                      s.startTransaction();
                      s.statements(updateDb);
                      s.commitTransaction();
                      s.setScalar(
                        "full_img",
                        sql`hash_${sql(fullImageIndex.toString())}`,
                      );
                      s.statements(props.afterReplace);
                    },
                    catch: (s) => {
                      s.setScalar("failed_upload", true);
                    },
                  });
                  s.setScalar("uploading", false);
                }}
              />
              Replace
            </Button>
            <Button
              startIcon="Delete"
              loading={sql`deleting`}
              size="sm"
              variant="outlined"
              color="danger"
              loadingPosition="start"
              onClick={(s) => {
                s.setScalar("deleting", true);
                s.commitUiTreeChanges();
                s.try({
                  body: (s) => {
                    s.server((s) => {
                      s.startTransaction();
                      s.modify(
                        sql`update ${table.identWithDb} set ${setFieldsToNull} where id = ${recordId}`,
                      );
                      s.commitTransaction();
                      s.statements(props.afterRemove);
                    });
                    s.statements(onClose);
                  },
                  catch: (s) => s.setScalar("failed_remove", true),
                });
                s.setScalar("deleting", false);
              }}
            >
              Remove
            </Button>
            <Show when={sql`failed_upload`}>
              <Alert color="danger">Failed to upload image</Alert>
            </Show>
            <Show when={sql`failed_remove`}>
              <Alert color="danger">Failed to remove image</Alert>
            </Show>
          </div>
        </div>
      </Data>
    </ModalDialog>
  );
}
