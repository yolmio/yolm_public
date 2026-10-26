import { Alert } from "components/alert";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { FileTypeIcon } from "components/file_type_icon";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { ActionButton, ActionMenuItem } from "std/action_button";
import { Data } from "std/data";
import { system } from "std/system";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { Each, EventHandlers, Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { driveText } from "./i18n";
import type { DriveBlock, DriveSpaceType } from "./index.tsx";
import type { ControlledFileLifecycle } from "./controlled_lifecycle";

const CHUNK_THRESHOLD = 16 * 1024 * 1024;
const CHUNK_SIZE = 8 * 1024 * 1024;

export interface DriveWorkspaceProps {
  files: DriveBlock;
  type: DriveSpaceType;
  spaceId: AnyExpr;
  /** Folder selected when the workspace first mounts. Null opens the root. */
  initialFolderId?: AnyExpr;
  /** Keeps folder navigation in this URL query parameter using replace-state. */
  folderQueryParam?: string;
  /** Defaults to the space name. Null omits the redundant workspace heading. */
  title?: Node;
  heightClassName?: string;
  /**
   * Product-specific route for rich viewing. If omitted, files open their
   * immutable current-version bytes in a new tab.
   */
  fileHref?: (itemId: Sql, versionId: Sql, contentType: Sql) => Sql;
  /** Optional rich-view route for an exact historical version. */
  fileVersionHref?: (
    itemId: Sql,
    versionId: Sql,
    contentType: Sql,
  ) => Sql;
  /** Optional extension-owned file creation controls for the current folder. */
  createFile?: (props: {
    spaceId: Sql;
    parentItemId: Sql;
  }) => Node;
  /** Defaults to true. Disable for representation-only spaces. */
  allowUploads?: boolean;
  /** Hide editing controls for a browsing-only surface; server permissions still apply. */
  readOnly?: boolean;
  /** Browse preferred publications; defaults to read-only unless readOnly is explicitly false. */
  published?: {
    control: ControlledFileLifecycle;
    preferredLanguage: Sql;
  };
  /** Optional product rule for items that must not be moved to trash. */
  canTrashItem?: (itemId: Sql) => Sql;
  /** Enables Drive-style multi-selection and the built-in action toolbar. */
  selectable?: boolean;
  /** Product actions using the same selected item IDs as the built-in toolbar. */
  bulkActions?: (selectedTable: string) => Node;
}

export interface DriveFileUploadButtonProps {
  spaceId: AnyExpr;
  parentItemId?: AnyExpr;
  fileHref: (itemId: Sql) => Sql;
  /** Authenticated product endpoint returning the Drive itemId/versionId shape. */
  uploadEndpoint?: AnyExpr;
  /** File-picker formats; the upload endpoint remains authoritative. */
  accept?: AnyExpr;
  /** Upload a batch, then navigate once all files have completed. */
  multiple?: boolean;
  /** Runs after a successful batch, before navigation. */
  onUploaded?: (s: DomStatements) => void;
  children?: Node;
}

const SELECTION_TABLE = "files_selected_items";
const selectionTable = sql.ref(SELECTION_TABLE);
const selectionUiTable = sql.ref("ui", SELECTION_TABLE);

function clearWorkspaceSelection(s: DomStatements) {
  s.modify(sql`delete from ${selectionTable}`);
  s.setScalar("files_selection_anchor_ordinal", sql`cast(null as bigint)`);
}

function selectOnlyWorkspaceItem(
  s: DomStatements,
  itemId: Sql,
  ordinal: Sql,
) {
  s.modify(sql`delete from ${selectionTable}`);
  s.modify(sql`insert into ${selectionTable} (id) values (${itemId})`);
  s.setScalar("files_selection_anchor_ordinal", ordinal);
}

function selectedWorkspaceRootsSql(
  spaceId: AnyExpr,
  selection: Sql = selectionUiTable,
) {
  return sql`
    with recursive selected_candidates(id, parent_file_item_id) as (
      select item.id, item.parent_file_item_id
      from ${selection} selected
      join db.file_items item on item.id = selected.id
      where item.file_space_id = ${spaceId}
    ), selected_ancestors(selected_id, ancestor_id) as (
      select selected.id, selected.parent_file_item_id
      from selected_candidates selected
      where selected.parent_file_item_id is not null

      union all

      select ancestor.selected_id, parent.parent_file_item_id
      from selected_ancestors ancestor
      join db.file_items parent on parent.id = ancestor.ancestor_id
      where parent.parent_file_item_id is not null
        and parent.file_space_id = ${spaceId}
    )
    select selected.id
    from selected_candidates selected
    where not exists (
      select 1
      from selected_ancestors ancestor
      join ${selection} selected_parent
        on selected_parent.id = ancestor.ancestor_id
      where ancestor.selected_id = selected.id
    )
  `;
}

/** Keeps the bulk selection mutations out of every workspace route's handlers. */
export function registerDriveWorkspaceProcedures() {
  const selectedRoots = selectedWorkspaceRootsSql(
    sql`p_space_id`,
    sql.ref("p_selected_items"),
  );
  const selectedItems = [{
    name: "p_selected_items",
    fields: [{ name: "id", type: "BigInt" as const }],
  }];
  system.storedProcedure({
    name: "files_bulk_move_items",
    transaction: "caller",
    inputScalars: [
      { name: "p_space_id", type: "BigInt" },
      { name: "p_destination_parent_id", type: "BigInt" },
    ],
    inputTables: selectedItems,
    procedure: (s) => {
      s.forEachQuery(selectedRoots, "files_bulk_move_item", (s) => {
        s.callStoredProcedure("files_move_item", {
          inputScalars: {
            p_space_id: sql`p_space_id`,
            p_item_id: sql`files_bulk_move_item.id`,
            p_destination_parent_id: sql`p_destination_parent_id`,
          },
        });
      });
    },
  });
  system.storedProcedure({
    name: "files_bulk_trash_items",
    transaction: "caller",
    inputScalars: [{ name: "p_space_id", type: "BigInt" }],
    inputTables: selectedItems,
    procedure: (s) => {
      s.forEachQuery(selectedRoots, "files_bulk_trash_item", (s) => {
        s.callStoredProcedure("files_trash_item", {
          inputScalars: {
            p_space_id: sql`p_space_id`,
            p_item_id: sql`files_bulk_trash_item.id`,
          },
        });
      });
    },
  });
  system.storedProcedure({
    name: "files_bulk_restore_items",
    transaction: "caller",
    inputScalars: [{ name: "p_space_id", type: "BigInt" }],
    inputTables: selectedItems,
    procedure: (s) => {
      s.forEachQuery(selectedRoots, "files_bulk_restore_item", (s) => {
        s.callStoredProcedure("files_restore_item", {
          inputScalars: {
            p_space_id: sql`p_space_id`,
            p_item_id: sql`files_bulk_restore_item.id`,
          },
        });
      });
    },
  });
}

function MoveSelectedItemsButton(props: {
  spaceId: AnyExpr;
  destinationParentId: Sql;
  children: Node;
}) {
  return (
    <ActionButton
      size="sm"
      variant="plain"
      color="neutral"
      className="w-full justify-start"
      action={(s) => {
        callSelectedWorkspaceRoots(s, props.spaceId);
        s.throwErrorIf(
          sql`not exists (select 1 from files_selected_roots)`,
          driveText("selectionUnavailable"),
        );
        s.startTransaction();
        s.callStoredProcedure("files_bulk_move_items", {
          inputScalars: {
            p_space_id: props.spaceId,
            p_destination_parent_id: props.destinationParentId,
          },
          inputTables: { p_selected_items: "ui.files_selected_items" },
        });
        s.commitTransaction();
      }}
      afterSuccessClient={(s) => {
        s.setScalar("files_move_open", false);
        s.setScalar("files_details_item_id", sql`cast(null as bigint)`);
        clearWorkspaceSelection(s);
      }}
      successMessage={driveText("itemsMoved")}
    >
      {props.children}
    </ActionButton>
  );
}

function callSelectedWorkspaceRoots(s: UiServerStatements, spaceId: AnyExpr) {
  // Keep this read local: transferring the selection into a procedure slowed
  // large selections, even when that procedure used a local result table.
  s.defTable(
    "files_selected_roots",
    selectedWorkspaceRootsSql(spaceId, sql.ref("ui.files_selected_items")),
  );
}

function runWorkspaceMutation(
  s: DomStatements,
  body: (s: UiServerStatements) => void,
) {
  s.setScalar("files_error", sql.lit``);
  s.tryServer({
    body,
    errorName: "files_mutation_error",
    catch: (s) => {
      s.setScalar(
        "files_error",
        sql`coalesce(
          files_mutation_error.message,
          ${driveText("fileOperationFailed")}
        )`,
      );
    },
  });
}

function FilesUploadZone(props: {
  files: DriveBlock;
  spaceId: AnyExpr;
  children: Node;
  enabled: boolean;
}) {
  if (!props.enabled) {
    return (
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("files_upload_handle", sql`random.uuid()`);
          s.defScalar("files_uploading", false);
          s.defScalar("files_upload_drag_active", false);
          s.defScalar("files_upload_status", sql.lit``);
          s.defScalar("files_upload_percent", { type: "BigInt" });
        }}
      >
        {props.children}
      </Data>
    );
  }
  useJsModule("http_file_upload");
  const uploadId = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("files_upload_handle", sql`random.uuid()`);
        s.defScalar("files_uploading", false);
        s.defScalar("files_upload_drag_active", false);
        s.defScalar("files_upload_status", sql.lit``);
        s.defScalar("files_upload_percent", { type: "BigInt" });
      }}
    >
      <div
        id={uploadId}
        className="relative h-full min-h-0"
        onMount={(s) => {
          s.jsCall({
            module: "http_file_upload",
            exportName: "enableCapture",
            handle: sql`files_upload_handle`,
            argJson: sql`
              json_build_object(
                'handle', files_upload_handle,
                'targetId', ${uploadId},
                'sources', json_build_array('paste', 'drop')
              )
            `,
          });
        }}
        js={{
          handles: [{
            module: "http_file_upload",
            cleanup: "cleanup",
            handle: sql`files_upload_handle`,
          }],
          on: {
            "http_file_upload.filesSelected": (s) => {
              s.if(
                sql`coalesce(event.payload_json->>'success', 'false') = 'true'`,
                (s) => {
                  s.setScalar("files_uploading", true);
                  s.setScalar("files_error", sql.lit``);
                  s.commitUiTreeChanges();
                  s.jsCall({
                    module: "http_file_upload",
                    exportName: "upload",
                    handle: sql`files_upload_handle`,
                    argJson: sql`
                      json_build_object(
                        'handle', files_upload_handle,
                        'endpoint',
                          case
                            when ui.files_upload_target_item_id is not null
                              then '/api/files/items/'
                                || cast(ui.files_upload_target_item_id as string)
                                || '/versions/upload'
                            else '/api/files/spaces/'
                              || cast(${props.spaceId} as string)
                              || '/items/upload?parent_id='
                              || coalesce(cast(ui.files_folder_id as string), '')
                          end,
                        'concurrency', 4,
                        'chunkThreshold', ${CHUNK_THRESHOLD},
                        'chunkSize', ${CHUNK_SIZE}
                      )
                    `,
                  });
                },
              );
            },
            "http_file_upload.filesUploaded": (s) => {
              s.setScalar("files_uploading", false);
              s.setScalar("files_upload_status", sql.lit``);
              s.setScalar("files_upload_percent", sql`cast(null as bigint)`);
              s.setScalar(
                "files_upload_target_item_id",
                sql`cast(null as bigint)`,
              );
              s.refetch();
            },
            "http_file_upload.uploadError": (s) => {
              s.setScalar("files_uploading", false);
              s.setScalar("files_upload_status", sql.lit``);
              s.setScalar("files_upload_percent", sql`cast(null as bigint)`);
              s.setScalar(
                "files_upload_target_item_id",
                sql`cast(null as bigint)`,
              );
              s.setScalar(
                "files_error",
                sql`coalesce(
                  event.payload_json->>'error',
                  ${driveText("uploadFailed")}
                )`,
              );
              s.refetch();
            },
            "http_file_upload.selectionCancelled": (s) => {
              s.setScalar("files_uploading", false);
              s.setScalar("files_upload_status", sql.lit``);
              s.setScalar("files_upload_percent", sql`cast(null as bigint)`);
              s.setScalar(
                "files_upload_target_item_id",
                sql`cast(null as bigint)`,
              );
            },
            "http_file_upload.dragStateChanged": (s) => {
              s.setScalar(
                "files_upload_drag_active",
                sql`coalesce(event.payload_json->>'active', 'false') = 'true'`,
              );
            },
            "http_file_upload.uploadProgress": (s) => {
              s.setScalar(
                "files_upload_status",
                sql`${driveText("uploading")} || ' ' || coalesce(
                  event.payload_json->>'currentFileName',
                  ${driveText("file")}
                )`,
              );
              s.if(
                sql`coalesce(try_cast(event.payload_json->>'currentFileTotal' as bigint), 0) > 0`,
                (s) => {
                  s.setScalar(
                    "files_upload_percent",
                    sql`
                      try_cast(event.payload_json->>'currentFileLoaded' as bigint) * 100
                      / nullif(
                        try_cast(
                          event.payload_json->>'currentFileTotal' as bigint
                        ),
                        0
                      )
                    `,
                  );
                },
              );
            },
            "http_file_upload.uploadRetry": (s) => {
              s.setScalar(
                "files_upload_status",
                sql`${driveText("retrying")} || ' ' || coalesce(
                  event.payload_json->>'currentFileName',
                  ${driveText("upload")}
                ) || '…'`,
              );
            },
          },
        }}
      >
        <Show when={sql`files_upload_drag_active`}>
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary-500 bg-surface/95">
            <div className="text-center">
              <MaterialIcon icon="DriveFolderUpload" className="text-5xl" />
              <div className="mt-2 font-medium">
                {driveText("dropFiles")}
              </div>
            </div>
          </div>
        </Show>
        {props.children}
      </div>
    </Data>
  );
}

function startFileSelection(
  s: DomStatements,
  targetItemId?: Sql,
) {
  s.returnIf(sql`files_uploading`);
  s.setScalar(
    "files_upload_target_item_id",
    targetItemId ?? sql`cast(null as bigint)`,
  );
  s.jsCall({
    module: "http_file_upload",
    exportName: "selectFiles",
    handle: sql`files_upload_handle`,
    argJson: sql`json_build_object(
      'handle', files_upload_handle,
      'multiple', ${targetItemId ? sql`false` : sql`true`}
    )`,
  });
}

/** Uploads files directly into a known Drive location without a workspace. */
export function DriveFileUploadButton(props: DriveFileUploadButtonProps) {
  useJsModule("http_file_upload");
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("drive_direct_upload_handle", sql`random.uuid()`);
        s.defScalar("drive_direct_uploading", false);
        s.defScalar("drive_direct_upload_status", sql.lit``);
        s.defScalar("drive_direct_upload_error", sql.lit``);
      }}
    >
      <div
        js={{
          handles: [{
            module: "http_file_upload",
            cleanup: "cleanup",
            handle: sql`drive_direct_upload_handle`,
          }],
          on: {
            "http_file_upload.filesSelected": (s) => {
              s.if(
                sql`coalesce(event.payload_json->>'success', 'false') = 'true'`,
                (s) => {
                  s.setScalar("drive_direct_uploading", true);
                  s.setScalar("drive_direct_upload_error", sql.lit``);
                  s.setScalar(
                    "drive_direct_upload_status",
                    driveText("preparingUpload"),
                  );
                  s.commitUiTreeChanges();
                  s.jsCall({
                    module: "http_file_upload",
                    exportName: "upload",
                    handle: sql`drive_direct_upload_handle`,
                    argJson: sql`json_build_object(
                      'handle', drive_direct_upload_handle,
                      'endpoint', ${
                      props.uploadEndpoint ?? sql`'/api/files/spaces/' ||
                        cast(${props.spaceId} as string) ||
                        '/items/upload?parent_id=' ||
                        coalesce(cast(${
                        props.parentItemId ?? sql`null`
                      } as string), '')`
                    },
                      'concurrency', 1,
                      'chunkThreshold', ${CHUNK_THRESHOLD},
                      'chunkSize', ${CHUNK_SIZE}
                    )`,
                  });
                },
              );
            },
            "http_file_upload.filesUploaded": (s) => {
              s.setScalar("drive_direct_uploading", false);
              s.setScalar("drive_direct_upload_status", sql.lit``);
              s.defScalar(
                "drive_direct_uploaded_item_id",
                sql`try_cast(
                  event.payload_json->'results'->0->'response'->>'itemId'
                  as bigint
                )`,
              );
              s.if(sql`drive_direct_uploaded_item_id is not null`, (s) => {
                props.onUploaded?.(s);
                s.navigate(props.fileHref(sql`drive_direct_uploaded_item_id`));
                if (props.multiple) s.refetch();
              }).else((s) => {
                s.setScalar(
                  "drive_direct_upload_error",
                  sql.lit`The file uploaded, but it could not be opened.`,
                );
              });
            },
            "http_file_upload.uploadProgress": (s) => {
              s.setScalar(
                "drive_direct_upload_status",
                sql`${driveText("uploading")} || ' ' || coalesce(
                  event.payload_json->>'currentFileName',
                  ${driveText("file")}
                )`,
              );
            },
            "http_file_upload.uploadError": (s) => {
              s.setScalar("drive_direct_uploading", false);
              s.setScalar("drive_direct_upload_status", sql.lit``);
              s.setScalar(
                "drive_direct_upload_error",
                sql`coalesce(
                  event.payload_json->'results'->0->'response'->>'error',
                  event.payload_json->>'error',
                  ${driveText("uploadFailed")}
                )`,
              );
              if (props.multiple) s.refetch();
            },
            "http_file_upload.selectionCancelled": (s) => {
              s.setScalar("drive_direct_uploading", false);
              s.setScalar("drive_direct_upload_status", sql.lit``);
            },
          },
        }}
      >
        <Button
          startIcon="UploadFile"
          loading={sql`ui.drive_direct_uploading`}
          onClick={(s) => {
            s.setScalar("drive_direct_upload_error", sql.lit``);
            s.jsCall({
              module: "http_file_upload",
              exportName: "selectFiles",
              handle: sql`drive_direct_upload_handle`,
              argJson: sql`json_build_object(
                'handle', drive_direct_upload_handle,
                'accept', ${props.accept ?? sql.null},
                'multiple', ${props.multiple ? sql`true` : sql`false`}
              )`,
            });
          }}
        >
          {props.children ?? driveText("uploadFiles")}
        </Button>
        <Show when={sql`ui.drive_direct_upload_status <> ''`}>
          <span className="ml-3 text-sm text-secondary">
            {sql`ui.drive_direct_upload_status`}
          </span>
        </Show>
        <Show when={sql`ui.drive_direct_upload_error <> ''`}>
          <Alert color="danger" className="mt-3">
            {sql`ui.drive_direct_upload_error`}
          </Alert>
        </Show>
      </div>
    </Data>
  );
}

/**
 * Full folder workspace for a Files space: search, ordered folders/files,
 * bulk upload, rename, move, trash/restore, tags, and immutable history.
 */
export function DriveWorkspace(props: DriveWorkspaceProps) {
  const origin =
    sql`case when regex.is_match(location.host, '^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$') then 'http://' else 'https://' end || location.host`;
  const copyFolderLink = (s: DomStatements, folder: Sql) => {
    const param = sql.lit(props.folderQueryParam ?? "folder");
    s.clipboard.writeText(sql`${origin} || location.pathname || (
      select case when params = '' then '' else '?' || params end
      from (
        select coalesce(string_agg(value, '&' order by ordinal), '') ||
          case when ${folder} is null then '' else
            case when count(*) > 0 then '&' else '' end ||
            uri.encode_component(${param}) || '=' || cast(${folder} as string)
          end as params
        from string.split(regex.replace(location.query, '^[?]', ''), '&')
        where value <> '' and uri.form_url_decode(split_part(value, '=', 1)) <> ${param}
      ) remaining
    )`);
  };
  const copyFileLink = (s: DomStatements, href: Sql) =>
    s.clipboard.writeText(
      sql`case when ${href} like '/%' and ${href} not like '//%'
        then ${origin} || ${href} else ${href} end`,
    );
  const versionHref = props.fileVersionHref
    ? props.fileVersionHref(
      sql`files_selected_item.id`,
      sql`files_version.id`,
      sql`files_version.content_type`,
    )
    : sql`case when files_version.blob_hash is not null then ${
      props.files.versionBlobUrl(
        sql`files_version.id`,
        sql`files_version.blob_hash`,
      )
    } end`;
  const height = props.heightClassName ?? "h-[44rem]";
  const readOnly = props.readOnly ?? props.published !== undefined;
  const allowUploads = !readOnly &&
    (props.allowUploads ?? props.type.blobUploads !== false);
  const selectable = props.selectable === true && !readOnly;
  const hideHeader = props.title === null &&
    (readOnly || (props.published !== undefined && !allowUploads));
  const inlineSelection = selectable && hideHeader;
  const itemRowIdPrefix = useUniqueId();
  const openFolder = (
    s: DomStatements,
    folderId: Sql,
    clearSearch = false,
  ) => {
    s.setScalar("files_folder_id", folderId);
    s.setScalar("files_details_item_id", sql`cast(null as bigint)`);
    if (clearSearch) s.setScalar("files_search", sql.lit``);
    if (props.folderQueryParam) {
      s.setQueryParam(props.folderQueryParam, folderId, sql`true`);
    }
    if (selectable) clearWorkspaceSelection(s);
  };
  const defaultHeader = () => (
    <>
      <div
        className={props.title === null ? "hidden" : "min-w-0"}
      >
        <Typography level="title-lg" startIcon="Folder">
          {props.title ?? sql`files_space.name`}
        </Typography>
        <Show
          when={sql`coalesce(files_space.description, '') <> ''`}
        >
          <p className="truncate text-xs text-secondary">
            {sql`files_space.description`}
          </p>
        </Show>
      </div>
      <div className="flex items-center gap-2">
        <Button
          className={readOnly ? "hidden" : undefined}
          dynamicClassNames={props.published
            ? [{
              condition: sql`files_published_only or not files_can_edit`,
              classNames: "hidden",
            }]
            : undefined}
          size="sm"
          variant="plain"
          color="neutral"
          startIcon="DeleteOutline"
          onClick={(s) => {
            s.setScalar(
              "files_show_trash",
              sql`not files_show_trash`,
            );
            s.setScalar(
              "files_details_item_id",
              sql`cast(null as bigint)`,
            );
            if (selectable) clearWorkspaceSelection(s);
          }}
        >
          {driveText("trash")}
        </Button>
        {allowUploads
          ? (
            <Show
              when={sql`files_can_create_file and not ui.files_show_trash`}
            >
              <Button
                size="sm"
                variant="outlined"
                startIcon="UploadFile"
                loading={sql`files_uploading`}
                onClick={(s) => startFileSelection(s)}
              >
                {driveText("upload")}
              </Button>
            </Show>
          )
          : null}
      </div>
    </>
  );
  const selectionActions = () => (
    <div
      className={inlineSelection
        ? "flex min-w-max flex-1 items-center gap-2"
        : "flex min-w-0 flex-1 items-center gap-2"}
    >
      <IconButton
        size="sm"
        variant="plain"
        color="neutral"
        aria-label={driveText("clearSelection")}
        onClick={clearWorkspaceSelection}
      >
        <MaterialIcon icon="Close" />
      </IconButton>
      <span className="whitespace-nowrap text-sm font-medium">
        {sql`cast((select count(*) from ${selectionTable}) as string)
                          || ' ' || ${driveText("selected")}`}
      </span>
      <div className="min-w-0 flex-1" />
      {props.bulkActions?.(SELECTION_TABLE)}
      <Show
        when={sql`(select count(*) from ${selectionTable}) = 1`}
      >
        <Each
          table="files_items"
          recordName="files_download_item"
          where={sql`files_download_item.id in (select id from ${selectionTable})
                            and files_download_item.item_kind = 'file'
                            and files_download_item.current_file_version_id is not null
                            and files_download_item.has_blob`}
        >
          <a
            href={props.files.versionBlobUrl(
              sql`files_download_item.current_file_version_id`,
            )}
            download={sql`files_download_item.name`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium hover:bg-level1"
          >
            <MaterialIcon icon="Download" />
            {driveText("download")}
          </a>
        </Each>
      </Show>
      <Show
        when={sql`files_can_edit and not ui.files_show_trash`}
      >
        <Button
          size="sm"
          variant="plain"
          color="neutral"
          startIcon="DriveFileMove"
          onClick={(s) => s.setScalar("files_move_open", true)}
        >
          {driveText("moveTo")}
        </Button>
        <ActionButton
          size="sm"
          variant="plain"
          color="danger"
          startIcon="DeleteOutline"
          confirm={{
            description: driveText("trashSelectedConfirmation"),
            confirmText: driveText("delete"),
          }}
          action={(s) => {
            if (props.canTrashItem) {
              callSelectedWorkspaceRoots(s, props.spaceId);
              s.throwErrorIf(
                sql`exists (
                                  select 1
                                  from files_selected_roots selected_root
                                  where not (${
                  props.canTrashItem(sql`selected_root.id`)
                })
                                )`,
                driveText("cannotTrash"),
              );
            }
            s.startTransaction();
            s.callStoredProcedure("files_bulk_trash_items", {
              inputScalars: { p_space_id: props.spaceId },
              inputTables: {
                p_selected_items: "ui.files_selected_items",
              },
            });
            s.commitTransaction();
          }}
          afterSuccessClient={(s) => {
            s.setScalar(
              "files_details_item_id",
              sql`cast(null as bigint)`,
            );
            clearWorkspaceSelection(s);
          }}
          successMessage={driveText("itemsTrashed")}
        >
          {driveText("delete")}
        </ActionButton>
      </Show>
      <Show when={sql`files_can_edit and ui.files_show_trash`}>
        <ActionButton
          size="sm"
          variant="plain"
          color="neutral"
          startIcon="RestoreFromTrash"
          action={(s) => {
            s.startTransaction();
            s.callStoredProcedure("files_bulk_restore_items", {
              inputScalars: { p_space_id: props.spaceId },
              inputTables: {
                p_selected_items: "ui.files_selected_items",
              },
            });
            s.commitTransaction();
          }}
          afterSuccessClient={(s) => {
            s.setScalar(
              "files_details_item_id",
              sql`cast(null as bigint)`,
            );
            clearWorkspaceSelection(s);
          }}
          successMessage={driveText("itemsRestored")}
        >
          {driveText("restore")}
        </ActionButton>
      </Show>
    </div>
  );
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar(
          "files_folder_id",
          props.initialFolderId ?? sql`cast(null as bigint)`,
        );
        s.defScalar("files_details_item_id", {
          type: "BigInt",
          expr: sql`cast(null as bigint)`,
        });
        s.defScalar("files_details_open", false);
        s.defScalar("files_selection_anchor_ordinal", {
          type: "BigInt",
          expr: sql`cast(null as bigint)`,
        });
        s.defTable(
          SELECTION_TABLE,
          sql`select cast(null as bigint) as id where false`,
        );
        s.defScalar("files_search", sql.lit``);
        s.defScalar("files_show_trash", false);
        s.defScalar("files_new_folder_name", sql.lit``);
        s.defScalar("files_rename_name", sql.lit``);
        s.defScalar("files_rename_open", false);
        s.defScalar("files_move_open", false);
        s.defScalar("files_description", sql.lit``);
        s.defScalar("files_new_tag_name", sql.lit``);
        s.defScalar("files_error", sql.lit``);
        s.defScalar("files_dragging_item_id", {
          type: "BigInt",
          expr: sql`cast(null as bigint)`,
        });
        s.defScalar("files_drop_target_item_id", {
          type: "BigInt",
          expr: sql`cast(null as bigint)`,
        });
        s.defScalar("files_drop_position", sql.lit`none`);
        s.defScalar("files_upload_target_item_id", {
          type: "BigInt",
          expr: sql`cast(null as bigint)`,
        });
      }}
    >
      <Data
        procedure={(s) => {
          s.callStoredProcedure("files_workspace_space_state", {
            inputScalars: {
              p_space_id: props.spaceId,
              p_folder_id: sql`ui.files_folder_id`,
              p_selected_item_id: sql`ui.files_details_item_id`,
            },
            outputRecords: {
              files_space: "files_space",
              files_current_folder: "files_current_folder",
            },
            outputScalars: {
              files_can_edit: "files_can_edit",
              files_can_create_file: "files_can_create_file",
              files_can_manage: "files_can_manage",
              files_custom_ordering: "files_custom_ordering",
            },
            outputTables: {
              files_available_tags: "files_available_tags",
            },
          });
          s.defTable("files_published_versions", {
            fields: [
              { name: "file_item_id", type: "BigInt" },
              { name: "file_version_id", type: "BigInt" },
            ],
          });
          s.defScalar("files_published_only", Boolean(props.published));
          if (props.published) {
            const publication = props.published;
            s.modify(sql`insert into files_published_versions
                  select item.id, revision.file_version_id
                  from db.file_items item
                  join db.controlled_file_revisions revision on revision.id = ${
              publication.control.resolvePreferredPublishedRevision({
                fileItemId: sql`item.id`,
                preferredLanguage: publication.preferredLanguage,
              })
            }
                  where item.file_space_id = ${props.spaceId}
                    and item.item_kind = 'file' and item.trashed_at is null`);
          }
          s.callStoredProcedure("files_workspace_items_state", {
            inputScalars: {
              p_space_id: props.spaceId,
              p_folder_id: sql`ui.files_folder_id`,
              p_search: sql`ui.files_search`,
              p_show_trash:
                sql`not files_published_only and ui.files_show_trash`,
              p_selected_item_id: sql`ui.files_details_item_id`,
              p_custom_ordering: sql`files_custom_ordering`,
              p_published_only: sql`files_published_only`,
            },
            inputTables: { p_published_versions: "files_published_versions" },
            outputRecords: {
              files_selected_item: "files_selected_item",
            },
            outputTables: {
              files_items: "files_items",
              files_move_destinations: "files_move_destinations",
            },
          });
          s.callStoredProcedure("files_workspace_selection_state", {
            inputScalars: {
              p_space_id: props.spaceId,
              p_selected_item_id: sql`files_selected_item.id`,
              p_version_id:
                sql`case when files_published_only then files_selected_item.current_file_version_id else null end`,
            },
            outputScalars: {
              files_can_create_version: "files_can_create_version",
            },
            outputTables: {
              files_selected_versions: "files_selected_versions",
            },
          });
          if (readOnly) {
            s.setScalar("files_can_edit", false);
            s.setScalar("files_can_create_file", false);
            s.setScalar("files_can_manage", false);
            s.setScalar("files_can_create_version", false);
          }
          s.defScalar(
            "files_can_trash_selected",
            props.canTrashItem
              ? props.canTrashItem(sql`files_selected_item.id`)
              : sql`true`,
          );
          if (selectable) {
            s.defTable(
              "files_workspace_folders",
              sql`
                select folder.id, folder.name
                from db.file_items folder
                where folder.file_space_id = ${props.spaceId}
                  and folder.item_kind = 'folder'
                  and folder.trashed_at is null
                order by folder.name collate nocase
              `,
            );
            s.defTable(
              "files_workspace_folder_ancestors",
              sql`
                with recursive folder_ancestors(folder_id, ancestor_id) as (
                  select
                    folder.id as folder_id,
                    folder.id as ancestor_id
                  from db.file_items folder
                  where folder.file_space_id = ${props.spaceId}
                    and folder.item_kind = 'folder'
                    and folder.trashed_at is null

                  union all

                  select child.folder_id, parent.parent_file_item_id
                  from folder_ancestors child
                  join db.file_items parent on parent.id = child.ancestor_id
                  where parent.parent_file_item_id is not null
                    and parent.file_space_id = ${props.spaceId}
                )
                select folder_id, ancestor_id
                from folder_ancestors
              `,
            );
          }
        }}
      >
        <FilesUploadZone
          files={props.files}
          spaceId={props.spaceId}
          enabled={allowUploads}
        >
          <section
            aria-label={driveText("fileWorkspace")}
            className={`${height} flex min-h-0 flex-col overflow-hidden rounded-lg border border-divider bg-surface`}
            sx={{ containerType: "inline-size" }}
          >
            {selectable
              ? (
                <EventHandlers
                  document={{
                    keydown: (s) => {
                      s.if(
                        sql`event.key = 'Escape'
                          and not ui.files_rename_open
                          and not ui.files_move_open
                          and not ui.files_details_open`,
                        (s) => clearWorkspaceSelection(s),
                      );
                    },
                  }}
                />
              )
              : null}
            {hideHeader
              ? null
              : (
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-divider px-4 py-3">
                  {selectable
                    ? (
                      <Show
                        when={sql`exists (select 1 from ${selectionTable})`}
                        fallback={defaultHeader()}
                      >
                        {selectionActions()}
                      </Show>
                    )
                    : defaultHeader()}
                </header>
              )}

            <Show when={sql`ui.files_error <> ''`}>
              <Alert color="danger" className="m-3 mb-0">
                {sql`ui.files_error`}
              </Alert>
            </Show>
            <Show when={sql`files_uploading`}>
              <div className="border-b border-divider px-4 py-2 text-xs text-secondary">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {sql`coalesce(
                      files_upload_status,
                      ${driveText("preparingUpload")}
                    )`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Show when={sql`files_upload_percent is not null`}>
                      <span>
                        {sql`cast(files_upload_percent as string) || '%'`}
                      </span>
                    </Show>
                    <Button
                      size="sm"
                      variant="plain"
                      color="neutral"
                      onClick={(s) => {
                        s.jsCall({
                          module: "http_file_upload",
                          exportName: "cancel",
                          handle: sql`files_upload_handle`,
                          argJson:
                            sql`json_build_object('handle', files_upload_handle)`,
                        });
                      }}
                    >
                      {driveText("cancel")}
                    </Button>
                  </div>
                </div>
              </div>
            </Show>

            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="relative shrink-0 border-b border-divider">
                  <div
                    className="flex items-center gap-2 px-3 py-2"
                    dynamicClassNames={inlineSelection
                      ? [{
                        condition:
                          sql`exists (select 1 from ${selectionTable})`,
                        classNames: "invisible",
                      }]
                      : undefined}
                  >
                    <IconButton
                      size="sm"
                      variant="plain"
                      aria-label={driveText("parentFolder")}
                      disabled={sql`ui.files_folder_id is null`}
                      onClick={(s) => {
                        openFolder(
                          s,
                          sql`files_current_folder.parent_file_item_id`,
                        );
                      }}
                    >
                      <MaterialIcon icon="ArrowUpward" />
                    </IconButton>
                    <div className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
                      <Button
                        className="min-w-0 max-w-full shrink px-1"
                        title={sql`files_space.name`}
                        size="sm"
                        variant="plain"
                        color="neutral"
                        onClick={(s) => {
                          openFolder(
                            s,
                            sql`cast(null as bigint)`,
                          );
                        }}
                      >
                        <span className="truncate">
                          {sql`files_space.name`}
                        </span>
                      </Button>
                      <Show when={sql`files_current_folder.id is not null`}>
                        <span className="shrink-0 text-secondary">/</span>
                        <span
                          className="min-w-0 truncate"
                          title={sql`files_current_folder.name`}
                        >
                          {sql`files_current_folder.name`}
                        </span>
                      </Show>
                    </div>
                    {props.folderQueryParam
                      ? (
                        <Menu>
                          <Menu.IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            aria-label={driveText("folderActions")}
                          >
                            <MaterialIcon icon="MoreVert" />
                          </Menu.IconButton>
                          <Menu.Content floating={{ placement: "bottom-end" }}>
                            <Menu.Item
                              onClick={(s) =>
                                copyFolderLink(s, sql`ui.files_folder_id`)}
                            >
                              <MaterialIcon icon="Link" />
                              {driveText("copyFolderLink")}
                            </Menu.Item>
                          </Menu.Content>
                        </Menu>
                      )
                      : null}
                    <Input
                      size="sm"
                      value={sql`ui.files_search`}
                      onInput={(s) => {
                        s.setScalar("files_search", sql`target_value`);
                        s.setScalar(
                          "files_details_item_id",
                          sql`cast(null as bigint)`,
                        );
                        if (selectable) clearWorkspaceSelection(s);
                      }}
                      startIcon="Search"
                      placeholder={driveText("search")}
                      aria-label={driveText("searchSpace")}
                      sx={{
                        width: "8rem",
                        minWidth: 0,
                        flexShrink: 0,
                        "@container (min-width: 480px)": { width: "12rem" },
                        "@container (min-width: 720px)": { width: "16rem" },
                      }}
                    />
                  </div>
                  {inlineSelection
                    ? (
                      <Show
                        when={sql`exists (select 1 from ${selectionTable})`}
                      >
                        {/* Replace the navigation controls without moving the rows. */}
                        <div className="absolute inset-0 flex items-center overflow-x-auto bg-surface px-3 py-2">
                          {selectionActions()}
                        </div>
                      </Show>
                    )
                    : null}
                </div>

                <Show
                  when={sql`files_can_edit and not ui.files_show_trash`}
                >
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-divider bg-level1 px-3 py-2">
                    {props.createFile?.({
                      spaceId: sql`${props.spaceId}`,
                      parentItemId: sql`ui.files_folder_id`,
                    })}
                    <Input
                      size="sm"
                      bindScalar="files_new_folder_name"
                      placeholder={driveText("newFolderName")}
                      startIcon="CreateNewFolder"
                      className="max-w-xs"
                      onKeyDown={(s) => {
                        s.if(sql`event.key = 'Enter'`, (s) => {
                          runWorkspaceMutation(s, (s) => {
                            s.startTransaction();
                            s.callStoredProcedure("files_create_folder", {
                              inputScalars: {
                                p_space_id: props.spaceId,
                                p_parent_item_id: sql`ui.files_folder_id`,
                                p_name: sql`ui.files_new_folder_name`,
                              },
                            });
                            s.commitTransaction();
                            s.setScalar("files_new_folder_name", sql.lit``);
                            s.refetch();
                          });
                        });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="plain"
                      startIcon="Add"
                      disabled={sql`trim(ui.files_new_folder_name) = ''`}
                      onClick={(s) => {
                        runWorkspaceMutation(s, (s) => {
                          s.startTransaction();
                          s.callStoredProcedure("files_create_folder", {
                            inputScalars: {
                              p_space_id: props.spaceId,
                              p_parent_item_id: sql`ui.files_folder_id`,
                              p_name: sql`ui.files_new_folder_name`,
                            },
                          });
                          s.commitTransaction();
                          s.setScalar("files_new_folder_name", sql.lit``);
                          s.refetch();
                        });
                      }}
                    >
                      {driveText("create")}
                    </Button>
                  </div>
                </Show>

                <div className="min-h-0 flex-1 overflow-auto">
                  <div
                    className="sticky top-0 z-10 grid border-b border-divider bg-surface px-4 py-2 text-xs font-medium text-secondary"
                    sx={{
                      minWidth: "31.5rem",
                      gridTemplateColumns:
                        "minmax(10rem, 1fr) 10rem 5.5rem 2.5rem",
                    }}
                  >
                    <span>{driveText("name")}</span>
                    <span>{driveText("dateModified")}</span>
                    <span className="text-right">
                      {driveText("size")}
                    </span>
                    <span className="sr-only">{driveText("actions")}</span>
                  </div>
                  <Each table="files_items" recordName="files_item">
                    <div
                      id={sql.concat(
                        itemRowIdPrefix,
                        sql`cast(files_item.id as string)`,
                      )}
                      role="row"
                      tabIndex={0}
                      aria-selected={selectable
                        ? sql`exists (
                            select 1
                            from ${selectionTable} selected
                            where selected.id = files_item.id
                          )`
                        : undefined}
                      className={`grid w-full items-center border-b border-divider px-4 py-2 text-left text-sm hover:bg-level1 ${
                        selectable ? "select-none" : ""
                      }`}
                      sx={{
                        minWidth: "31.5rem",
                        gridTemplateColumns:
                          "minmax(10rem, 1fr) 10rem 5.5rem 2.5rem",
                      }}
                      dynamicClassNames={[{
                        condition: selectable
                          ? sql`exists (
                              select 1
                              from ${selectionTable} selected
                              where selected.id = files_item.id
                            )`
                          : sql`false`,
                        classNames: "bg-primary-50",
                      }, {
                        condition: sql`
                          ui.files_drop_target_item_id = files_item.id
                          and ui.files_drop_position = 'before'
                        `,
                        classNames: "border-t-2 border-t-primary-500",
                      }, {
                        condition: sql`
                          ui.files_drop_target_item_id = files_item.id
                          and ui.files_drop_position = 'after'
                        `,
                        classNames: "border-b-2 border-b-primary-500",
                      }]}
                      onDragOver={(s) => {
                        s.event.preventDefault();
                        s.element(
                          sql.concat(
                            itemRowIdPrefix,
                            sql`cast(files_item.id as string)`,
                          ),
                        ).getBoundingClientRect("files_drop_row_rect");
                        s.setScalar(
                          "files_drop_target_item_id",
                          sql`files_item.id`,
                        );
                        s.setScalar(
                          "files_drop_position",
                          sql`case
                            when ui.files_dragging_item_id is null
                              or ui.files_dragging_item_id = files_item.id
                              or not files_custom_ordering
                              or not files_can_edit
                              or ui.files_show_trash
                              or trim(ui.files_search) <> ''
                              then 'none'
                            when event.client_y * 2 <=
                              files_drop_row_rect.top + files_drop_row_rect.bottom
                              then 'before'
                            else 'after'
                          end`,
                        );
                      }}
                      onDragLeave={(s) => {
                        s.if(
                          sql`ui.files_drop_target_item_id = files_item.id`,
                          (s) => {
                            s.setScalar(
                              "files_drop_target_item_id",
                              sql`cast(null as bigint)`,
                            );
                            s.setScalar("files_drop_position", sql.lit`none`);
                          },
                        );
                      }}
                      onDrop={(s) => {
                        s.returnIf(sql`
                          ui.files_dragging_item_id is null
                          or ui.files_drop_target_item_id is null
                          or ui.files_drop_position = 'none'
                        `);
                        runWorkspaceMutation(s, (s) => {
                          s.startTransaction();
                          s.callStoredProcedure("files_drop_reorder_item", {
                            inputScalars: {
                              p_space_id: props.spaceId,
                              p_item_id: sql`ui.files_dragging_item_id`,
                              p_target_item_id:
                                sql`ui.files_drop_target_item_id`,
                              p_position: sql`ui.files_drop_position`,
                            },
                          });
                          s.commitTransaction();
                          s.refetch();
                        });
                        s.setScalar(
                          "files_dragging_item_id",
                          sql`cast(null as bigint)`,
                        );
                        s.setScalar(
                          "files_drop_target_item_id",
                          sql`cast(null as bigint)`,
                        );
                        s.setScalar("files_drop_position", sql.lit`none`);
                      }}
                      onClick={(s) => {
                        if (selectable) {
                          s.if(
                            sql`event.shift_key
                              and ui.files_selection_anchor_ordinal is not null`,
                            (s) => {
                              s.modify(sql`delete from ${selectionTable}`);
                              s.modify(sql`
                                insert into ${selectionTable} (id)
                                select visible.id
                                from files_items visible
                                where visible.visible_ordinal between
                                  least(
                                    ui.files_selection_anchor_ordinal,
                                    files_item.visible_ordinal
                                  )
                                  and greatest(
                                    ui.files_selection_anchor_ordinal,
                                    files_item.visible_ordinal
                                  )
                              `);
                            },
                          ).elseIf(
                            sql`event.ctrl_key or event.meta_key`,
                            (s) => {
                              s.if(
                                sql`exists (
                                select 1
                                from ${selectionTable} selected
                                where selected.id = files_item.id
                              )`,
                                (s) => {
                                  s.modify(sql`
                                  delete from ${selectionTable}
                                  where id = files_item.id
                                `);
                                },
                                (s) => {
                                  s.modify(sql`
                                  insert into ${selectionTable} (id)
                                  values (files_item.id)
                                `);
                                },
                              );
                              s.setScalar(
                                "files_selection_anchor_ordinal",
                                sql`files_item.visible_ordinal`,
                              );
                            },
                          ).else((s) => {
                            selectOnlyWorkspaceItem(
                              s,
                              sql`files_item.id`,
                              sql`files_item.visible_ordinal`,
                            );
                          });
                        } else {
                          s.setScalar(
                            "files_details_item_id",
                            sql`cast(null as bigint)`,
                          );
                        }
                      }}
                      onKeyDown={(s) => {
                        s.if(sql`event.key = 'Enter'`, (s) => {
                          s.event.preventDefault();
                          s.if(sql`files_item.item_kind = 'folder'`, (s) => {
                            openFolder(s, sql`files_item.id`, true);
                          }).else((s) => {
                            if (props.fileHref) {
                              s.navigate(
                                props.fileHref(
                                  sql`files_item.id`,
                                  sql`files_item.current_file_version_id`,
                                  sql`files_item.content_type`,
                                ),
                              );
                            } else {
                              s.navigate(
                                props.files.versionBlobUrl(
                                  sql`files_item.current_file_version_id`,
                                ),
                              );
                            }
                          });
                        });
                      }}
                      onDoubleClick={(s) => {
                        s.if(sql`files_item.item_kind = 'folder'`, (s) => {
                          openFolder(s, sql`files_item.id`, true);
                        }).else((s) => {
                          if (props.fileHref) {
                            s.navigate(
                              props.fileHref(
                                sql`files_item.id`,
                                sql`files_item.current_file_version_id`,
                                sql`files_item.content_type`,
                              ),
                            );
                          } else {
                            s.navigate(
                              props.files.versionBlobUrl(
                                sql`files_item.current_file_version_id`,
                              ),
                            );
                          }
                        });
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Show
                          when={sql`
                            files_custom_ordering
                            and files_can_edit
                            and not ui.files_show_trash
                            and trim(ui.files_search) = ''
                          `}
                        >
                          <span
                            draggable
                            aria-label="Drag to reorder"
                            title="Drag to reorder"
                            className="flex shrink-0 cursor-grab items-center text-secondary active:cursor-grabbing"
                            onDragStart={(s) => {
                              s.setEffectAllowed(sql.lit`move`);
                              s.setScalar(
                                "files_dragging_item_id",
                                sql`files_item.id`,
                              );
                            }}
                            onDragEnd={(s) => {
                              s.setScalar(
                                "files_dragging_item_id",
                                sql`cast(null as bigint)`,
                              );
                              s.setScalar(
                                "files_drop_target_item_id",
                                sql`cast(null as bigint)`,
                              );
                              s.setScalar(
                                "files_drop_position",
                                sql.lit`none`,
                              );
                            }}
                          >
                            <MaterialIcon icon="DragIndicator" />
                          </span>
                        </Show>
                        <FileTypeIcon
                          kind={sql`files_item.icon_kind`}
                          className="shrink-0 text-xl"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {sql`files_item.name`}
                          </span>
                          <Show when={sql`files_item.tag_names <> ''`}>
                            <span className="block truncate text-xs text-secondary">
                              {sql`files_item.tag_names`}
                            </span>
                          </Show>
                        </span>
                      </span>
                      <span
                        className="truncate text-secondary"
                        title={sql`case
                          when files_item.modified_at is null then ''
                          else format.date(
                            files_item.modified_at,
                            ${driveText("dateTimeFormat")}
                          )
                        end`}
                      >
                        {sql`case
                          when files_item.modified_at is null then '—'
                          else format.date(
                            files_item.modified_at,
                            ${driveText("dateFormat")}
                          ) || case
                            when coalesce(files_item.modified_by, '') = ''
                              then ''
                            else ' · ' || files_item.modified_by
                          end
                        end`}
                      </span>
                      <span className="text-right text-secondary">
                        {sql`case
                          when files_item.item_kind = 'folder' then case
                            when files_item.file_count is null then '—'
                            when files_item.file_count = 1
                              then '1 ' || ${driveText("fileSingular")}
                            else cast(files_item.file_count as string)
                              || ' ' || ${driveText("filePlural")}
                          end
                          when coalesce(files_item.byte_length, 0) = 0 then '—'
                          when files_item.byte_length < 1024 then cast(files_item.byte_length as string) || ' B'
                          when files_item.byte_length < 1048576 then cast(files_item.byte_length / 1024 as string) || ' KB'
                          else cast(files_item.byte_length / 1048576 as string) || ' MB'
                        end`}
                      </span>
                      <span
                        className="flex justify-end"
                        onClick={(s) => s.event.stopPropagation()}
                      >
                        <Menu>
                          <Menu.IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            aria-label={sql`${
                              driveText("actionsFor")
                            } || ' ' || files_item.name`}
                          >
                            <MaterialIcon icon="MoreVert" />
                          </Menu.IconButton>
                          <Menu.Content floating={{ placement: "bottom-end" }}>
                            <Menu.Item
                              onClick={(s) => {
                                s.if(
                                  sql`files_item.item_kind = 'folder'`,
                                  (s) => {
                                    openFolder(s, sql`files_item.id`, true);
                                  },
                                  (s) => {
                                    if (props.fileHref) {
                                      s.navigate(
                                        props.fileHref(
                                          sql`files_item.id`,
                                          sql`files_item.current_file_version_id`,
                                          sql`files_item.content_type`,
                                        ),
                                      );
                                    } else {
                                      s.navigate(
                                        props.files.versionBlobUrl(
                                          sql`files_item.current_file_version_id`,
                                        ),
                                      );
                                    }
                                  },
                                );
                              }}
                            >
                              <MaterialIcon icon="OpenInNew" />
                              {props.fileHref
                                ? sql`case
                                    when files_item.item_kind = 'file'
                                      then ${driveText("openInViewer")}
                                    else ${driveText("open")}
                                  end`
                                : driveText("open")}
                            </Menu.Item>
                            <Show
                              when={sql`files_item.item_kind='file'${
                                props.folderQueryParam
                                  ? sql` or files_item.item_kind='folder'`
                                  : sql``
                              }`}
                            >
                              <Menu.Item
                                onClick={(s) => {
                                  s.if(
                                    sql`files_item.item_kind='folder'`,
                                    (s) =>
                                      copyFolderLink(s, sql`files_item.id`),
                                    (s) =>
                                      copyFileLink(
                                        s,
                                        props.fileHref
                                          ? props.fileHref(
                                            sql`files_item.id`,
                                            sql`files_item.current_file_version_id`,
                                            sql`files_item.content_type`,
                                          )
                                          : props.files.versionBlobUrl(
                                            sql`files_item.current_file_version_id`,
                                          ),
                                      ),
                                  );
                                }}
                              >
                                <MaterialIcon icon="Link" />
                                {driveText("copyLink")}
                              </Menu.Item>
                            </Show>
                            <Show
                              when={sql`
                                files_custom_ordering
                                and files_can_edit
                                and not ui.files_show_trash
                                and trim(ui.files_search) = ''
                              `}
                            >
                              <Menu.Item
                                onClick={(s) => {
                                  runWorkspaceMutation(s, (s) => {
                                    s.startTransaction();
                                    s.callStoredProcedure(
                                      "files_swap_item_order",
                                      {
                                        inputScalars: {
                                          p_space_id: props.spaceId,
                                          p_item_id: sql`files_item.id`,
                                          p_earlier: true,
                                        },
                                      },
                                    );
                                    s.commitTransaction();
                                    s.refetch();
                                  });
                                }}
                              >
                                <MaterialIcon icon="ArrowUpward" />
                                {driveText("earlier")}
                              </Menu.Item>
                              <Menu.Item
                                onClick={(s) => {
                                  runWorkspaceMutation(s, (s) => {
                                    s.startTransaction();
                                    s.callStoredProcedure(
                                      "files_swap_item_order",
                                      {
                                        inputScalars: {
                                          p_space_id: props.spaceId,
                                          p_item_id: sql`files_item.id`,
                                          p_earlier: false,
                                        },
                                      },
                                    );
                                    s.commitTransaction();
                                    s.refetch();
                                  });
                                }}
                              >
                                <MaterialIcon icon="ArrowDownward" />
                                {driveText("later")}
                              </Menu.Item>
                            </Show>
                            {selectable
                              ? (
                                <>
                                  <Show
                                    when={sql`files_can_edit and not ui.files_show_trash`}
                                  >
                                    <Menu.Item
                                      onClick={(s) => {
                                        selectOnlyWorkspaceItem(
                                          s,
                                          sql`files_item.id`,
                                          sql`files_item.visible_ordinal`,
                                        );
                                        s.setScalar(
                                          "files_rename_name",
                                          sql`files_item.name`,
                                        );
                                        s.setScalar("files_rename_open", true);
                                      }}
                                    >
                                      <MaterialIcon icon="Edit" />
                                      {driveText("rename")}
                                    </Menu.Item>
                                    <Menu.Item
                                      onClick={(s) => {
                                        selectOnlyWorkspaceItem(
                                          s,
                                          sql`files_item.id`,
                                          sql`files_item.visible_ordinal`,
                                        );
                                        s.setScalar("files_move_open", true);
                                      }}
                                    >
                                      <MaterialIcon icon="DriveFileMove" />
                                      {driveText("moveTo")}
                                    </Menu.Item>
                                  </Show>
                                </>
                              )
                              : null}
                            <Menu.Item
                              onClick={(s) => {
                                s.setScalar(
                                  "files_details_item_id",
                                  sql`files_item.id`,
                                );
                                s.setScalar(
                                  "files_rename_name",
                                  sql`files_item.name`,
                                );
                                s.setScalar(
                                  "files_description",
                                  sql`coalesce(files_item.description, '')`,
                                );
                                s.setScalar("files_details_open", true);
                              }}
                            >
                              <MaterialIcon icon="InfoOutlined" />
                              {driveText("viewDetails")}
                            </Menu.Item>
                            <Show when={sql`files_can_edit`}>
                              <Show
                                when={sql`files_item.trashed_at is null`}
                                fallback={
                                  <ActionMenuItem
                                    icon="RestoreFromTrash"
                                    action={(s) => {
                                      s.startTransaction();
                                      s.callStoredProcedure(
                                        "files_restore_item",
                                        {
                                          inputScalars: {
                                            p_space_id: props.spaceId,
                                            p_item_id: sql`files_item.id`,
                                          },
                                        },
                                      );
                                      s.commitTransaction();
                                    }}
                                    afterSuccessClient={(s) => {
                                      s.setScalar(
                                        "files_details_item_id",
                                        sql`cast(null as bigint)`,
                                      );
                                      clearWorkspaceSelection(s);
                                    }}
                                    successMessage={driveText("itemRestored")}
                                  >
                                    {driveText("restore")}
                                  </ActionMenuItem>
                                }
                              >
                                <ActionMenuItem
                                  icon="DeleteOutline"
                                  confirm={{
                                    description: driveText(
                                      "trashItemConfirmation",
                                    ),
                                    confirmText: driveText("delete"),
                                  }}
                                  action={(s) => {
                                    if (props.canTrashItem) {
                                      s.throwErrorIf(
                                        sql`not (${
                                          props.canTrashItem(
                                            sql`files_item.id`,
                                          )
                                        })`,
                                        driveText("cannotTrash"),
                                      );
                                    }
                                    s.startTransaction();
                                    s.callStoredProcedure(
                                      "files_trash_item",
                                      {
                                        inputScalars: {
                                          p_space_id: props.spaceId,
                                          p_item_id: sql`files_item.id`,
                                        },
                                      },
                                    );
                                    s.commitTransaction();
                                  }}
                                  afterSuccessClient={(s) => {
                                    s.setScalar(
                                      "files_details_item_id",
                                      sql`cast(null as bigint)`,
                                    );
                                    clearWorkspaceSelection(s);
                                  }}
                                  successMessage={driveText("itemTrashed")}
                                >
                                  {driveText("delete")}
                                </ActionMenuItem>
                              </Show>
                            </Show>
                          </Menu.Content>
                        </Menu>
                      </span>
                    </div>
                  </Each>
                  <Show when={sql`not exists (select 1 from files_items)`}>
                    <div className="flex h-64 flex-col items-center justify-center text-center text-secondary">
                      <MaterialIcon icon="FolderOpen" className="text-5xl" />
                      <p className="mt-2 text-sm">
                        {sql`case
                          when trim(ui.files_search) <> ''
                            then ${driveText("noMatchingFiles")}
                          when ui.files_show_trash
                            then ${driveText("trashEmpty")}
                          else ${driveText("folderEmpty")}
                        end`}
                      </p>
                      {allowUploads
                        ? (
                          <Show
                            when={sql`files_can_edit and not ui.files_show_trash`}
                          >
                            <Button
                              size="sm"
                              variant="plain"
                              startIcon="UploadFile"
                              className="mt-2"
                              onClick={(s) => startFileSelection(s)}
                            >
                              {driveText("uploadFiles")}
                            </Button>
                          </Show>
                        )
                        : null}
                    </div>
                  </Show>
                </div>
              </div>

              <Show when={sql`files_selected_item.id is not null`}>
                <ModalDialog
                  open={sql`ui.files_details_open`}
                  onClose={(s) => {
                    s.setScalar("files_details_open", false);
                    s.setScalar(
                      "files_details_item_id",
                      sql`cast(null as bigint)`,
                    );
                  }}
                  size="sm"
                  maxWidth="xs"
                  className="max-h-[calc(100vh-2rem)] overflow-auto"
                >
                  <div className="p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Typography level="title-md">
                          {sql`files_selected_item.name`}
                        </Typography>
                        <p className="mt-1 text-xs text-secondary">
                          {sql`case
                          when files_selected_item.item_kind = 'folder'
                            then ${driveText("folder")}
                          else coalesce(
                            files_selected_item.content_type,
                            ${driveText("file")}
                          )
                        end`}
                        </p>
                      </div>
                      <IconButton
                        size="sm"
                        variant="plain"
                        aria-label={driveText("closeDetails")}
                        onClick={(s) => {
                          s.setScalar("files_details_open", false);
                          s.setScalar(
                            "files_details_item_id",
                            sql`cast(null as bigint)`,
                          );
                        }}
                      >
                        <MaterialIcon icon="Close" />
                      </IconButton>
                    </div>

                    {props.fileHref
                      ? (
                        <Show
                          when={sql`
                          files_selected_item.item_kind = 'file'
                          and files_selected_item.trashed_at is null
                        `}
                        >
                          <Button
                            className="mt-4"
                            size="sm"
                            variant="outlined"
                            startIcon="Visibility"
                            href={props.fileHref(
                              sql`files_selected_item.id`,
                              sql`files_selected_item.current_file_version_id`,
                              sql`files_selected_item.content_type`,
                            )}
                          >
                            {driveText("openInViewer")}
                          </Button>
                        </Show>
                      )
                      : null}

                    <Show
                      when={sql`files_can_edit and files_selected_item.trashed_at is null`}
                    >
                      <div className="mt-5">
                        <label className="mb-1 block text-xs font-medium text-secondary">
                          {driveText("name")}
                        </label>
                        <div className="flex gap-2">
                          <Input
                            size="sm"
                            bindScalar="files_rename_name"
                            fullWidth
                          />
                          <Button
                            size="sm"
                            variant="outlined"
                            disabled={sql`
                            trim(ui.files_rename_name) = ''
                            or trim(ui.files_rename_name) = files_selected_item.name
                          `}
                            onClick={(s) => {
                              runWorkspaceMutation(s, (s) => {
                                s.startTransaction();
                                s.callStoredProcedure("files_rename_item", {
                                  inputScalars: {
                                    p_space_id: props.spaceId,
                                    p_item_id: sql`files_selected_item.id`,
                                    p_name: sql`ui.files_rename_name`,
                                  },
                                });
                                s.commitTransaction();
                                s.refetch();
                              });
                            }}
                          >
                            {driveText("save")}
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-secondary">
                          {driveText("description")}
                        </label>
                        <Textarea
                          size="sm"
                          minRows={3}
                          fullWidth
                          bindScalar="files_description"
                        />
                        <Button
                          className="mt-2"
                          size="sm"
                          variant="outlined"
                          disabled={sql`
                          trim(ui.files_description) = coalesce(
                            trim(files_selected_item.description),
                            ''
                          )
                        `}
                          onClick={(s) => {
                            runWorkspaceMutation(s, (s) => {
                              s.startTransaction();
                              s.callStoredProcedure(
                                "files_update_item_metadata",
                                {
                                  inputScalars: {
                                    p_space_id: props.spaceId,
                                    p_item_id: sql`files_selected_item.id`,
                                    p_name: sql`files_selected_item.name`,
                                    p_description: sql`ui.files_description`,
                                  },
                                },
                              );
                              s.commitTransaction();
                              s.refetch();
                            });
                          }}
                        >
                          {driveText("saveDescription")}
                        </Button>
                      </div>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-secondary">
                          {driveText("moveTo")}
                        </summary>
                        <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-md bg-level1 p-2">
                          <button
                            type="button"
                            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-surface"
                            onClick={(s) => {
                              runWorkspaceMutation(s, (s) => {
                                s.startTransaction();
                                s.callStoredProcedure("files_move_item", {
                                  inputScalars: {
                                    p_space_id: props.spaceId,
                                    p_item_id: sql`files_selected_item.id`,
                                    p_destination_parent_id:
                                      sql`cast(null as bigint)`,
                                  },
                                });
                                s.commitTransaction();
                                s.refetch();
                              });
                            }}
                          >
                            {driveText("topLevel")}
                          </button>
                          <Each
                            table="files_move_destinations"
                            recordName="files_destination"
                          >
                            <button
                              type="button"
                              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-surface"
                              onClick={(s) => {
                                runWorkspaceMutation(s, (s) => {
                                  s.startTransaction();
                                  s.callStoredProcedure("files_move_item", {
                                    inputScalars: {
                                      p_space_id: props.spaceId,
                                      p_item_id: sql`files_selected_item.id`,
                                      p_destination_parent_id:
                                        sql`files_destination.id`,
                                    },
                                  });
                                  s.commitTransaction();
                                  s.refetch();
                                });
                              }}
                            >
                              {sql`files_destination.name`}
                            </button>
                          </Each>
                        </div>
                      </details>
                    </Show>

                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-secondary">
                          {driveText("tags")}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Each
                          table="files_available_tags"
                          recordName="files_tag"
                        >
                          <button
                            type="button"
                            disabled={sql`not files_can_edit`}
                            onClick={(s) => {
                              runWorkspaceMutation(s, (s) => {
                                s.startTransaction();
                                s.callStoredProcedure("files_toggle_item_tag", {
                                  inputScalars: {
                                    p_space_id: props.spaceId,
                                    p_item_id: sql`files_selected_item.id`,
                                    p_tag_id: sql`files_tag.id`,
                                  },
                                });
                                s.commitTransaction();
                                s.refetch();
                              });
                            }}
                          >
                            <Show
                              when={sql`files_tag.assigned`}
                              fallback={
                                <Chip
                                  size="sm"
                                  variant="outlined"
                                  color="neutral"
                                >
                                  {sql`files_tag.name`}
                                </Chip>
                              }
                            >
                              <Chip size="sm" color="primary">
                                {sql`files_tag.name`}
                              </Chip>
                            </Show>
                          </button>
                        </Each>
                      </div>
                      <Show when={sql`files_can_manage`}>
                        <div className="mt-2 flex gap-2">
                          <Input
                            size="sm"
                            bindScalar="files_new_tag_name"
                            placeholder={driveText("newTag")}
                            fullWidth
                          />
                          <Button
                            size="sm"
                            variant="plain"
                            disabled={sql`trim(ui.files_new_tag_name) = ''`}
                            onClick={(s) => {
                              runWorkspaceMutation(s, (s) => {
                                s.startTransaction();
                                s.callStoredProcedure("files_create_tag", {
                                  inputScalars: {
                                    p_space_id: props.spaceId,
                                    p_name: sql`ui.files_new_tag_name`,
                                  },
                                });
                                s.commitTransaction();
                                s.setScalar("files_new_tag_name", sql.lit``);
                                s.refetch();
                              });
                            }}
                          >
                            {driveText("add")}
                          </Button>
                        </div>
                      </Show>
                    </div>

                    <Show when={sql`files_selected_item.item_kind = 'file'`}>
                      <div className="mt-5 border-t border-divider pt-4">
                        <div className="flex items-center justify-between gap-2">
                          <Typography level="title-sm">
                            {driveText("versionHistory")}
                          </Typography>
                          {allowUploads
                            ? (
                              <Show
                                when={sql`
                                files_can_create_version
                                and files_selected_item.trashed_at is null
                                and files_selected_item.content_type not in (
                                  'application/vnd.yolm.document+json',
                                  'text/markdown'
                                )
                              `}
                              >
                                <Button
                                  size="sm"
                                  variant="plain"
                                  startIcon="UploadFile"
                                  loading={sql`
                                  files_uploading
                                  and ui.files_upload_target_item_id =
                                    files_selected_item.id
                                `}
                                  onClick={(s) =>
                                    startFileSelection(
                                      s,
                                      sql`files_selected_item.id`,
                                    )}
                                >
                                  {driveText("newVersion")}
                                </Button>
                              </Show>
                            )
                            : null}
                        </div>
                        <div className="mt-2 space-y-2">
                          <Each
                            table="files_selected_versions"
                            recordName="files_version"
                          >
                            <div className="flex items-start gap-1">
                              <a
                                href={versionHref}
                                target="_blank"
                                className="min-w-0 flex-1 rounded-md border border-divider p-2 hover:bg-level1"
                              >
                                <div className="flex justify-between gap-2 text-sm">
                                  <span className="font-medium">
                                    {sql`${driveText("version")} || ' ' ||
                                  cast(files_version.version_number as string)`}
                                  </span>
                                  <Show
                                    when={sql`files_version.id = files_selected_item.current_file_version_id`}
                                  >
                                    <Chip size="sm" color="success">
                                      {driveText("current")}
                                    </Chip>
                                  </Show>
                                </div>
                                <div className="mt-1 truncate text-xs text-secondary">
                                  {sql`files_version.file_name`}
                                </div>
                                <div className="mt-1 text-xs text-secondary">
                                  {sql`format.date(
                                files_version.created_at,
                                ${driveText("dateTimeFormat")}
                              )`}
                                </div>
                              </a>
                              <Show when={sql`${versionHref} is not null`}>
                                <Menu>
                                  <Menu.IconButton
                                    size="sm"
                                    variant="plain"
                                    color="neutral"
                                    aria-label={sql`${
                                      driveText("actionsFor")
                                    } || ' ' || ${
                                      driveText("version")
                                    } || ' ' || files_version.version_number::string`}
                                  >
                                    <MaterialIcon icon="MoreVert" />
                                  </Menu.IconButton>
                                  <Menu.Content
                                    floating={{ placement: "bottom-end" }}
                                  >
                                    <Menu.Item
                                      onClick={(s) =>
                                        copyFileLink(s, versionHref)}
                                    >
                                      <MaterialIcon icon="Link" />
                                      {driveText("copyVersionLink")}
                                    </Menu.Item>
                                  </Menu.Content>
                                </Menu>
                              </Show>
                            </div>
                          </Each>
                        </div>
                      </div>
                    </Show>

                    <div className="mt-5 border-t border-divider pt-4">
                      <Show
                        when={sql`files_selected_item.trashed_at is null`}
                        fallback={
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outlined"
                              color="neutral"
                              startIcon="RestoreFromTrash"
                              disabled={sql`not files_can_edit`}
                              onClick={(s) => {
                                runWorkspaceMutation(s, (s) => {
                                  s.startTransaction();
                                  s.callStoredProcedure("files_restore_item", {
                                    inputScalars: {
                                      p_space_id: props.spaceId,
                                      p_item_id: sql`files_selected_item.id`,
                                    },
                                  });
                                  s.commitTransaction();
                                  s.setScalar("files_details_open", false);
                                  s.setScalar(
                                    "files_details_item_id",
                                    sql`cast(null as bigint)`,
                                  );
                                  s.refetch();
                                });
                              }}
                            >
                              {driveText("restore")}
                            </Button>
                          </div>
                        }
                      >
                        <ActionButton
                          size="sm"
                          variant="plain"
                          color="danger"
                          startIcon="DeleteOutline"
                          disabled={sql`
                          not files_can_edit
                          or not files_can_trash_selected
                        `}
                          confirm={{
                            description: driveText("trashItemConfirmation"),
                            confirmText: driveText("delete"),
                          }}
                          action={(s) => {
                            if (props.canTrashItem) {
                              s.throwErrorIf(
                                sql`not (${
                                  props.canTrashItem(
                                    sql`files_selected_item.id`,
                                  )
                                })`,
                                driveText("cannotTrash"),
                              );
                            }
                            s.startTransaction();
                            s.callStoredProcedure("files_trash_item", {
                              inputScalars: {
                                p_space_id: props.spaceId,
                                p_item_id: sql`files_selected_item.id`,
                              },
                            });
                            s.commitTransaction();
                          }}
                          afterSuccessClient={(s) => {
                            s.setScalar("files_details_open", false);
                            s.setScalar(
                              "files_details_item_id",
                              sql`cast(null as bigint)`,
                            );
                          }}
                          successMessage={driveText("itemTrashed")}
                        >
                          {driveText("delete")}
                        </ActionButton>
                      </Show>
                    </div>
                  </div>
                </ModalDialog>
              </Show>
            </div>
            {selectable
              ? (
                <>
                  <ModalDialog
                    bindScalar="files_rename_open"
                    size="sm"
                    maxWidth="xs"
                  >
                    <Typography level="title-lg">
                      {driveText("renameItem")}
                    </Typography>
                    <Input
                      className="mt-4"
                      bindScalar="files_rename_name"
                      fullWidth
                    />
                    <div className="mt-5 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        onClick={(s) => s.setScalar("files_rename_open", false)}
                      >
                        {driveText("cancel")}
                      </Button>
                      <ActionButton
                        size="sm"
                        disabled={sql`trim(ui.files_rename_name) = ''`}
                        action={(s) => {
                          s.throwErrorIf(
                            sql`(select count(*) from ${selectionUiTable}) <> 1`,
                            driveText("selectionUnavailable"),
                          );
                          s.startTransaction();
                          s.callStoredProcedure("files_rename_item", {
                            inputScalars: {
                              p_space_id: props.spaceId,
                              p_item_id:
                                sql`(select id from ${selectionUiTable} limit 1)`,
                              p_name: sql`ui.files_rename_name`,
                            },
                          });
                          s.commitTransaction();
                        }}
                        afterSuccessClient={(s) => {
                          s.setScalar("files_rename_open", false);
                          s.setScalar(
                            "files_details_item_id",
                            sql`cast(null as bigint)`,
                          );
                          clearWorkspaceSelection(s);
                        }}
                        successMessage={driveText("itemRenamed")}
                      >
                        {driveText("save")}
                      </ActionButton>
                    </div>
                  </ModalDialog>

                  <ModalDialog
                    bindScalar="files_move_open"
                    size="sm"
                    maxWidth="xs"
                  >
                    <Typography level="title-lg">
                      {driveText("moveSelected")}
                    </Typography>
                    <div className="mt-4 max-h-80 space-y-1 overflow-auto rounded-md border border-divider p-2">
                      <MoveSelectedItemsButton
                        spaceId={props.spaceId}
                        destinationParentId={sql`cast(null as bigint)`}
                      >
                        <MaterialIcon icon="Home" />
                        {driveText("topLevel")}
                      </MoveSelectedItemsButton>
                      <Each
                        table="files_workspace_folders"
                        recordName="files_workspace_folder"
                      >
                        <Show
                          when={sql`not exists (
                            select 1
                            from files_workspace_folder_ancestors ancestor
                            join ${selectionTable} selected
                              on selected.id = ancestor.ancestor_id
                            where ancestor.folder_id = files_workspace_folder.id
                          )`}
                        >
                          <MoveSelectedItemsButton
                            spaceId={props.spaceId}
                            destinationParentId={sql`files_workspace_folder.id`}
                          >
                            <MaterialIcon icon="Folder" />
                            {sql`files_workspace_folder.name`}
                          </MoveSelectedItemsButton>
                        </Show>
                      </Each>
                    </div>
                    <div className="mt-5 flex justify-end">
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        onClick={(s) => s.setScalar("files_move_open", false)}
                      >
                        {driveText("cancel")}
                      </Button>
                    </div>
                  </ModalDialog>
                </>
              )
              : null}
          </section>
        </FilesUploadZone>
      </Data>
    </Data>
  );
}
