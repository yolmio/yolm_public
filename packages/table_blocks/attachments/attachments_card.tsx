import { Alert } from "components/alert";
import { Card, CardHeader } from "components/card";
import { CircularProgress } from "components/circular_progress";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { currentUserHasPermission } from "blocks/auth";
import { CurrentRecordICtxKey, CurrentTableICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import type { Style } from "std/style_types";
import {
  createStyles,
  flexGrowStyles,
  visuallyHiddenStyles,
} from "std/style_utils";
import type { Table } from "std/system";
import { Conditional, Each, Show, State, useICtx, useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { AttachmentsTableBlock } from "table_blocks/attachments";

/** Props for {@link AttachmentsCard}. */
export interface Props {
  sx?: Style;
  className?: string;
  /** Card title; defaults to the literal "Attachments". */
  header?: Node;
  table?: string;
  /** Permission required to upload, rename, or delete attachments. */
  editPermission?: string;
}

function requireEditPermission(
  s: UiServerStatements,
  editPermission: string | undefined,
) {
  if (!editPermission) return;
  s.throwErrorIf(
    sql`${currentUserHasPermission(sql.lit(editPermission))} is not true`,
    sql.lit`You do not have permission to edit attachments.`,
  );
}

const styles = createStyles({
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    pb: 3,
  },
  divider: {
    mb: 3,
  },
  failureAlert: {
    position: "fixed",
    bottom: 16,
    left: 16,
    zIndex: 1000,
  },
  attachmentsList: {
    display: "flex",
    flexDirection: "column",
  },
  attachment: {
    display: "flex",
    alignItems: "center",
    "&:not(:last-child)": {
      mb: 2,
      pb: 2,
      borderBottom: "1px solid",
      borderColor: "divider",
    },
  },
  attachmentLink: {
    color: "primary-500",
    textDecoration: "none",
    "&:hover": { textDecoration: "underline" },
  },
  editLoading: {
    ml: 2,
  },
});

/**
A component that displays attachments in a card format with integrated upload functionality.
Typically you will want to associate attachments to an entity (sql.g. organization, contact) directly
rather than associating it with a document table. You can have multiple attachment tables, one per entity.
To associate an attachment table with an entity, add the Attachments block:
 `table.addBlock(new Attachments());`
Often this component will be used inside a RecordPage.

Ensure that AttachmentsTableBlock was added to the table of the RecordPage before using this component.

 @category UI Component
 @examples
[Example](../../../examples/legal/apps/legal.yolmstaging.net.tsx)
 */
export function AttachmentsCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const block = currentTable.block(AttachmentsTableBlock);
  block.registerAppUsage();
  const attachmentTable = block.table;
  const fkField = Object.values(attachmentTable.fields).find(
    (f) => f.type === "ForeignKey" && f.table === currentTable.name,
  );
  if (!fkField) {
    throw new Error(
      `No foreign key field found for ${attachmentTable.name} to ${currentTable.name}`,
    );
  }
  useSourceMap("attachments_card");
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("failed_edit", false);
        s.defScalar("uploading", false);
        s.defScalar("failed_upload", false);
        s.defScalar(
          "can_edit_attachments",
          props.editPermission
            ? currentUserHasPermission(sql.lit(props.editPermission))
            : true,
        );
      }}
    >
      <Data
        procedure={(s) => {
          s.defTable(
            "attachment",
            sql`select id, name, blob from ${attachmentTable.identWithDb} where ${fkField.ident} = ${currentRecordId}`,
          );
        }}
      >
        <Card variant="outlined" sx={props.sx} className={props.className}>
          <CardHeader>
            <Typography level="title-lg" startIcon="Attachment">
              {props.header ?? sql.lit`Attachments`}
            </Typography>
            <div sx={flexGrowStyles} />
            <Show when={sql`can_edit_attachments`}>
              <IconButton
                component="label"
                size="sm"
                aria-label="Upload attachment"
                variant="plain"
                color="primary"
              >
                <input
                  type="file"
                  sx={visuallyHiddenStyles}
                  onFileChange={(s) => {
                    s.returnIf(sql`uploading`);
                    s.setScalar("uploading", true);
                    s.commitUiTreeChanges();
                    s.defRecord("dom_file", sql`select * from file limit 1`);
                    s.tryServer({
                      transferFiles: sql`select uuid from file`,
                      body: (s) => {
                        requireEditPermission(s, props.editPermission);
                        s.readDomFile(sql`dom_file.uuid`, "content");
                        s.createBlob(sql`content`, "blob_id");
                        s.startTransaction();
                        s.modify(
                          sql`insert into ${attachmentTable.identWithDb} (name, blob, ${fkField.ident}, content_type, size) values
                       (dom_file.name, blob_id, ${currentRecordId}, dom_file.type, dom_file.size)`,
                        );
                        s.commitTransaction();
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar("failed_upload", true);
                        s.startTaskWithOpts({
                          detached: true,
                          procedure: (s) => {
                            s.sleep(4000);
                            s.setScalar("failed_upload", false);
                            s.commitUiTreeChanges();
                          },
                        });
                      },
                    });
                    s.setScalar("uploading", false);
                  }}
                />
                {/*Example_CircularProgress_Start*/}
                <Conditional
                  when={sql`uploading`}
                  then={<CircularProgress size="sm" />}
                  else={<MaterialIcon icon="UploadOutlined" />}
                />
                {/*Example_CircularProgress_End*/}
              </IconButton>
            </Show>
          </CardHeader>
          <Divider sx={styles.divider} />
          <div sx={styles.attachmentsList}>
            <Conditional
              when={sql`exists (select 1 from attachment)`}
              then={
                <Each table="attachment" recordName="attachment_record">
                  <AttachmentItem
                    attachmentTable={attachmentTable}
                    block={block}
                    editPermission={props.editPermission}
                  />
                </Each>
              }
              else={
                <div className="flex flex-col items-center justify-center h-full p-6 bg-level1">
                  <MaterialIcon fontSize="3xl" icon="Attachment" />
                  <Typography level="body-sm" className="text-base">
                    No attachments
                  </Typography>
                </div>
              }
            />
          </div>
          <Show when={sql`failed_upload or failed_edit`}>
            <div sx={styles.failureAlert}>
              <Alert
                color="danger"
                size="lg"
                startDecorator={<MaterialIcon icon="Warning" />}
              >
                {sql`case when failed_upload then 'Failed to upload attachment' else 'Failed to edit attachment' end`}
              </Alert>
            </div>
          </Show>
        </Card>
      </Data>
    </Data>
  );
}

function AttachmentItem({
  attachmentTable,
  block,
  editPermission,
}: {
  attachmentTable: Table;
  block: AttachmentsTableBlock;
  editPermission?: string;
}) {
  function onSubmit(s: DomStatements) {
    s.returnIf(sql`submitting`);
    s.if(sql`new_name = attachment_record.name`, (s) => {
      s.setScalar("editing", false);
      s.return();
    });
    s.setScalar("submitting", true);
    s.commitUiTreeChanges();
    s.tryServer({
      body: (s) => {
        requireEditPermission(s, editPermission);
        s.startTransaction();
        s.modify(
          sql`update ${attachmentTable.identWithDb} set name = new_name where id = attachment_record.id`,
        );
        s.commitTransaction();
        s.refetch();
      },
      catch: (s) => {
        s.setScalar("failed_edit", true);
        s.startTaskWithOpts({
          detached: true,
          procedure: (s) => {
            s.sleep(4000);
            s.setScalar("failed_edit", false);
            s.commitUiTreeChanges();
          },
        });
      },
    });
    s.setScalar("editing", false);
  }
  const attachmentUrl = block.getAttachmentUrl(sql`attachment_record.blob`);
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
      <div sx={styles.attachment}>
        <Conditional
          when={sql`editing`}
          then={
            <State
              procedure={(s) => {
                s.defScalar("new_name", sql`attachment_record.name`);
                s.defScalar("submitting", false);
              }}
            >
              <Input
                size="sm"
                sx={flexGrowStyles}
                value={sql`new_name`}
                yolmFocusKey
                onInput={(s) => {
                  s.setScalar("new_name", sql`target_value`);
                }}
                onBlur={onSubmit}
                onKeyDown={(s) => {
                  s.if(sql`event.key = 'Enter'`, onSubmit);
                  s.if(sql`event.key = 'Escape'`, (s) => {
                    s.setScalar("editing", false);
                  });
                }}
              />
              <Show when={sql`submitting`}>
                <CircularProgress size="sm" sx={styles.editLoading} />
              </Show>
            </State>
          }
          else={
            <a
              sx={styles.attachmentLink}
              target="_blank"
              href={attachmentUrl}
              rel="noreferrer"
            >
              {sql`attachment_record.name`}
            </a>
          }
        />
        <div sx={flexGrowStyles} />
        {/*Example_IconButton_Start*/}
        <IconButton
          component="a"
          href={attachmentUrl}
          download={sql`attachment_record.name`}
          variant="plain"
          color="neutral"
          size="sm"
          aria-label="Download File"
          icon="DownloadOutlined"
        />
        {/*Example_IconButton_End*/}
        <Show when={sql`can_edit_attachments`}>
          <IconButton
            variant="plain"
            color="neutral"
            size="sm"
            aria-label={sql.lit`Edit Attachment`}
            onClick={(s) => s.toggle("editing")}
            icon="EditOutlined"
          />
          <DeleteRecordIconButton
            recordId={sql`attachment_record.id`}
            table={attachmentTable.name}
            beforeTransactionStart={(s) =>
              requireEditPermission(s, editPermission)}
            afterTransactionCommit={(s) => s.refetch()}
            aria-label="Delete attachment"
            variant="plain"
            color="neutral"
            size="sm"
          />
        </Show>
      </div>
    </Data>
  );
}
