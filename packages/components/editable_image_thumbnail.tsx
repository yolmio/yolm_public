import {
  createImageSetEndpointsForCurrentApp,
  getVariantFromImageSet,
  ImageSetFieldGroup,
  imageVariantUrl,
  uploadImageSet,
} from "field_groups/image_set";
import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
} from "std/ictx";
import { sql } from "../std/sql_utils";
import { createStyles, visuallyHiddenStyles } from "std/style_utils";
import type { Table } from "std/system";
import { Conditional, Show, useICtx } from "std/ui";
import { Data } from "std/data";
import { CircularProgress } from "./circular_progress";
import { ImageDialog } from "./image_dialog";
import { MaterialIcon } from "./material_icon";
import { Snackbar } from "./snackbar";

const styles = createStyles({
  emptyLabel: ({ theme }) => ({
    width: 128,
    height: 128,
    borderRadius: "xl",
    border: "1px solid",
    borderColor: "divider",
    fontSize: 80,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    cursor: "pointer",
    "&:focus-within": theme.focus.default,
  }),
  imgWrapper: {
    width: 128,
    height: 128,
    borderRadius: "xl",
  },
  img: ({ theme }) => ({
    width: 128,
    height: 128,
    borderRadius: "xl",
    cursor: "pointer",
    "&:focus": theme.focus.default,
  }),
});

function getThumbnailVariant(imageFieldGroup: ImageSetFieldGroup) {
  const variant = getVariantFromImageSet(imageFieldGroup, "square_thumbnail", [
    "general_thumbnail",
  ]);
  if (!variant) {
    throw new Error("No thumbnail variant found");
  }
  return variant;
}

function getImageFieldGroup(
  table: Table,
  groupName?: string,
): ImageSetFieldGroup {
  if (groupName) {
    const imageFieldGroup = table.fieldGroups[groupName];
    if (!imageFieldGroup) {
      throw new Error(`Field group ${groupName} not found`);
    }
    if (!(imageFieldGroup instanceof ImageSetFieldGroup)) {
      throw new Error(
        `Field group ${groupName} is not an image set field group`,
      );
    }
    return imageFieldGroup;
  }
  let imageSetCount = 0;
  for (const group of Object.values(table.fieldGroups)) {
    if (group instanceof ImageSetFieldGroup) {
      imageSetCount += 1;
    }
  }
  if (imageSetCount === 0) {
    throw new Error("No image set field groups found");
  }
  if (imageSetCount === 1) {
    return Object.values(table.fieldGroups).find(
      (g) => g instanceof ImageSetFieldGroup,
    ) as ImageSetFieldGroup;
  }
  for (const group of Object.values(table.fieldGroups)) {
    if (group instanceof ImageSetFieldGroup && group.name === "main_image") {
      return group;
    }
  }
  throw new Error(
    "Multiple image set field groups found, but none named 'main_image'",
  );
}

interface EditableImageThumbnailProps {
  group?: string;
}

/**
 A component that displays an editable image thumbnail.
 Allows uploading a new image or editing an existing one.
 Uses the image set field group from the current table.

 @category UI Component
 */
export function EditableImageThumbnail({ group }: EditableImageThumbnailProps) {
  const { currentTable: tableModel } = useICtx(CurrentTableICtxKey);
  const { currentRecordId: recordId } = useICtx(CurrentRecordICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const imageFieldGroup = getImageFieldGroup(tableModel, group);
  const { upload, updateDb } = uploadImageSet(
    tableModel.name,
    recordId,
    imageFieldGroup,
  );
  createImageSetEndpointsForCurrentApp(tableModel.name, imageFieldGroup);
  const variant = getThumbnailVariant(imageFieldGroup);
  const thumbId = sql`record.${sql.ref(variant)}`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("uploading", false);
        s.defScalar("dialog_open", false);
        s.defScalar("failed_upload", false);
      }}
    >
      <Conditional
        when={sql`${thumbId} is null`}
        then={
          <label sx={styles.emptyLabel()}>
            <input
              sx={visuallyHiddenStyles}
              accept="image/*"
              type="file"
              onFileChange={{
                detachedFromNode: true,
                procedure: (s) => {
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
                      triggerRefetch(s);
                    },
                    catch: (s) => {
                      s.setScalar("uploading", false);
                      s.setScalar("failed_upload", true);
                    },
                  });
                  s.setScalar("uploading", false);
                },
              }}
            />
            <Conditional
              when={sql`uploading`}
              then={<CircularProgress />}
              else={<MaterialIcon icon="Person" />}
            />
          </label>
        }
        else={
          <>
            <div sx={styles.imgWrapper}>
              <img
                sx={styles.img()}
                tabIndex={0}
                alt="Image"
                src={imageVariantUrl(
                  tableModel,
                  getThumbnailVariant(imageFieldGroup),
                  recordId,
                  thumbId,
                )}
                onClick={(s) => s.setScalar("dialog_open", true)}
                onKeyDown={(s) => {
                  s.if(sql`event.key = 'Enter'`, (s) => {
                    s.setScalar("dialog_open", true);
                  });
                }}
              />
            </div>
            <ImageDialog
              bindScalar="dialog_open"
              group={imageFieldGroup.name}
              afterReplace={(s) => triggerRefetch(s)}
              afterRemove={(s) => triggerRefetch(s)}
            />
          </>
        }
      />
      <Show when={sql`failed_upload`}>
        <Snackbar
          color="danger"
          startDecorator={<MaterialIcon icon="Error" />}
          onMount={(s) => {
            s.sleep(5000);
            s.setScalar("failed_upload", false);
          }}
        >
          Failed to upload image
        </Snackbar>
      </Show>
    </Data>
  );
}
