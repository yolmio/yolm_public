import { Alert } from "components/alert";
import { FileTypeIcon, fileTypeIconKindSql } from "components/file_type_icon";
import { Sidebar } from "components/sidebar";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Each, Show } from "std/ui";
import { driveText } from "./i18n";
import type {
  DriveBlockContract,
  DriveSpaceType,
  FileViewerDocumentHref,
} from "./types.ts";
import { FileViewer } from "./viewer.tsx";

export const DRIVE_VIEWER_WORKSPACE_HANDLE = "drive-viewer-workspace";

export interface DriveViewerWorkspaceProps {
  files: DriveBlockContract;
  fileItemId: AnyExpr;
  fileVersionId?: AnyExpr;
  readOnly?: AnyExpr;
  presentation?: "default" | "governed";
  spaceType?: DriveSpaceType;
  documentHref?: FileViewerDocumentHref;
  onFileChange?: (
    s: DomStatements,
    fileItemId: Sql,
    fileVersionId: Sql,
  ) => void;
  handle?: Sql | string;
  initialPdfPage?: AnyExpr;
  initialPdfFocus?: AnyExpr;
  initialCadObjectKey?: AnyExpr;
  height?: string;
}

/** Full-height, viewer-first surface for one selected Drive file. */
export function DriveViewerWorkspace(props: DriveViewerWorkspaceProps) {
  const height = props.height ?? "100%";
  return (
    <div className="min-h-0 w-full" sx={{ height }}>
      <FileViewer
        files={props.files}
        fileItemId={props.fileItemId}
        fileVersionId={props.fileVersionId}
        readOnly={props.readOnly}
        presentation={props.presentation}
        spaceType={props.spaceType}
        workspace
        height={height}
        workspaceHandle={props.handle ?? DRIVE_VIEWER_WORKSPACE_HANDLE}
        initialPdfPage={props.initialPdfPage}
        initialPdfFocus={props.initialPdfFocus}
        initialCadObjectKey={props.initialCadObjectKey}
        documentHref={props.documentHref}
        onWorkspaceFileChange={props.onFileChange}
      />
    </div>
  );
}

export interface DriveViewerNavigationProps {
  files: DriveBlockContract;
  spaceId: AnyExpr;
  activeFileItemId: AnyExpr;
  /** App-shell UI scalar shared with a viewer that changes files in place. */
  selectedFileItemScalar?: string;
  backHref: Sql | string;
  backLabel?: string;
  groupLabel?: string;
  fileHref?: (fileItemId: Sql, fileVersionId: Sql) => Sql;
  /** Use for format-specific save-before-leave behavior. */
  onNavigate?: (s: DomStatements, href: Sql) => void;
  /** Allows a compatible mounted viewer to select a file without remounting. */
  onFileNavigate?: (
    s: DomStatements,
    file: DriveViewerNavigationFile,
    onSelected: (s: DomStatements) => void,
  ) => void;
}

export interface DriveViewerNavigationFile {
  href: Sql;
  spaceId: Sql;
  fileItemId: Sql;
  fileVersionId: Sql;
  folderId: Sql;
  contentType: Sql;
}

/**
 * Folder and file navigation intended for an application's existing
 * `Sidebar.Root`. It never creates a competing page-local sidebar.
 */
export function DriveViewerNavigation(props: DriveViewerNavigationProps) {
  const selectedFileItemScalar = props.selectedFileItemScalar ??
    "drive_viewer_selected_file_item_id";
  const selectedFileItemId = sql.ref(`ui.${selectedFileItemScalar}`);
  const fileHref = props.fileHref ??
    ((fileItemId) => sql`'/file-items/' || cast(${fileItemId} as string)`);
  const navigate = (s: DomStatements, href: Sql) => {
    s.setScalar("drive_viewer_navigation_error", sql.lit``);
    s.setScalar(selectedFileItemScalar, sql.null);
    if (props.onNavigate) {
      props.onNavigate(s, href);
    } else {
      s.navigate(href);
    }
  };
  const selectFile = (s: DomStatements, fileItemId: Sql) => {
    s.setScalar(selectedFileItemScalar, fileItemId);
  };
  const navigateFile = (s: DomStatements, file: DriveViewerNavigationFile) => {
    s.setScalar("drive_viewer_navigation_error", sql.lit``);
    s.setScalar(selectedFileItemScalar, sql.null);
    if (props.onFileNavigate) {
      s.defScalar("drive_viewer_navigation_file_item_id", {
        type: "BigInt",
        expr: file.fileItemId,
      });
      props.onFileNavigate(
        s,
        file,
        (s) => selectFile(s, sql`drive_viewer_navigation_file_item_id`),
      );
    } else {
      s.navigate(file.href, sql`true`);
    }
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("drive_viewer_selected_folder_id", {
          type: "BigInt",
          expr: sql`cast(null as bigint)`,
        });
        s.defScalar("drive_viewer_navigation_error", sql.lit``);
        if (!props.selectedFileItemScalar) {
          s.defScalar(selectedFileItemScalar, {
            type: "BigInt",
            expr: sql`cast(null as bigint)`,
          });
        }
      }}
    >
      <Data
        watch={[
          sql`ui.drive_viewer_selected_folder_id`,
          selectedFileItemId,
        ]}
        procedure={(s) => {
          s.defScalar(
            "drive_viewer_can_read_space",
            props.files.runtimeAccessSql(
              props.spaceId as Sql,
              sql`current_user`,
              "read",
            ),
          );
          s.defScalar(
            "drive_viewer_custom_ordering",
            props.files.customOrderingSql(props.spaceId as Sql),
          );
          s.defRecord(
            "drive_viewer_active_file",
            sql`
              select
                item.id,
                item.parent_file_item_id,
                version.id as file_version_id
              from db.file_items item
              join db.file_versions version
                on version.id = item.current_file_version_id
              join db.file_spaces space on space.id = item.file_space_id
              where item.id = coalesce(
                ${selectedFileItemId},
                ${props.activeFileItemId}
              )
                and item.file_space_id = ${props.spaceId}
                and item.item_kind = 'file'
                and item.trashed_at is null
                and drive_viewer_can_read_space
                and ${
              props.files.canReadVersionForAuthorizedSpaceSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`current_user`,
              })
            }
            `,
          );
          s.defScalar(
            "drive_viewer_initial_folder_id",
            sql`coalesce(drive_viewer_active_file.parent_file_item_id, -1)`,
          );
          s.defScalar(
            "drive_viewer_active_folder_id",
            sql`coalesce(
              ui.drive_viewer_selected_folder_id,
              drive_viewer_initial_folder_id
            )`,
          );
          s.defTable(
            "drive_viewer_folder_file_counts",
            sql`
              select
                item.parent_file_item_id as folder_id,
                count(*) as file_count
              from db.file_items item
              join db.file_versions version
                on version.id = item.current_file_version_id
              join db.file_spaces space on space.id = item.file_space_id
              where item.file_space_id = ${props.spaceId}
                and item.item_kind = 'file'
                and item.trashed_at is null
                and drive_viewer_can_read_space
                and ${
              props.files.canReadVersionForAuthorizedSpaceSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`current_user`,
              })
            }
              group by item.parent_file_item_id
            `,
          );
          s.defScalar(
            "drive_viewer_root_file_count",
            sql`coalesce((
              select counts.file_count
              from drive_viewer_folder_file_counts counts
              where counts.folder_id is null
            ), 0)`,
          );
          s.defTable(
            "drive_viewer_folders",
            sql`
              with recursive ranked_folders as (
                select
                  folder.id,
                  folder.parent_file_item_id,
                  folder.name,
                  lpad(cast(row_number() over (
                    partition by folder.parent_file_item_id
                    order by ${
              props.files.itemOrderSql(
                sql`folder`,
                sql`drive_viewer_custom_ordering`,
              )
            }
                  ) as string), 6, '0') as sibling_rank
                from db.file_items folder
                where folder.file_space_id = ${props.spaceId}
                  and folder.item_kind = 'folder'
                  and folder.trashed_at is null
                  and drive_viewer_can_read_space
              ),
              folder_tree as (
                select
                  folder.id,
                  folder.name,
                  0 as depth,
                  folder.sibling_rank as sort_path
                from ranked_folders folder
                where folder.parent_file_item_id is null

                union all

                select
                  child.id,
                  child.name,
                  parent.depth + 1,
                  parent.sort_path || '/' || child.sibling_rank
                from folder_tree parent
                join ranked_folders child
                  on child.parent_file_item_id = parent.id
              )
              select
                tree.id,
                tree.name,
                tree.depth,
                coalesce(counts.file_count, 0) as file_count
              from folder_tree tree
              left join drive_viewer_folder_file_counts counts
                on counts.folder_id = tree.id
              order by tree.sort_path
            `,
          );
          s.defTable(
            "drive_viewer_files",
            sql`
              select
                item.id,
                version.id as file_version_id,
                item.name,
                version.content_type,
                ${
              fileTypeIconKindSql({
                contentType: sql`version.content_type`,
                fileName: sql`item.name`,
              })
            } as icon_kind
              from db.file_items item
              join db.file_versions version
                on version.id = item.current_file_version_id
              join db.file_spaces space on space.id = item.file_space_id
              where item.file_space_id = ${props.spaceId}
                and item.item_kind = 'file'
                and item.trashed_at is null
                and (
                  item.parent_file_item_id = drive_viewer_active_folder_id
                  or (
                    item.parent_file_item_id is null
                    and drive_viewer_active_folder_id = -1
                  )
                )
                and drive_viewer_can_read_space
                and ${
              props.files.canReadVersionForAuthorizedSpaceSql({
                spaceRecord: sql`space`,
                itemRecord: sql`item`,
                versionRecord: sql`version`,
                sysUserId: sql`current_user`,
              })
            }
              order by ${
              props.files.itemOrderSql(
                sql`item`,
                sql`drive_viewer_custom_ordering`,
              )
            }
            `,
          );
        }}
      >
        <Sidebar.Group label={props.groupLabel} sx={{ paddingTop: 0 }}>
          <Show when={sql`ui.drive_viewer_navigation_error <> ''`}>
            <Alert color="danger" className="mx-2 mb-2">
              {sql`ui.drive_viewer_navigation_error`}
            </Alert>
          </Show>
          <Sidebar.Menu>
            <Sidebar.MenuItem sx={{ py: 0 }}>
              <Sidebar.MenuButton
                icon="ArrowBack"
                href={props.backHref}
                sx={{ whiteSpace: "nowrap" }}
                onClick={(s) => {
                  s.event.preventDefault();
                  navigate(
                    s,
                    typeof props.backHref === "string"
                      ? sql.lit(props.backHref)
                      : props.backHref,
                  );
                }}
              >
                {props.backLabel ?? driveText("back")}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.Group>
        <Sidebar.Group label={driveText("folders")} sx={{ paddingTop: 0 }}>
          <div aria-label={driveText("folders")}>
            <Sidebar.Menu>
              <Sidebar.MenuItem sx={{ py: 0 }}>
                <Sidebar.MenuButton
                  component="button"
                  active={sql`drive_viewer_active_folder_id = -1`}
                  onClick={(s) =>
                    s.setScalar("drive_viewer_selected_folder_id", sql`-1`)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <FileTypeIcon
                      kind="folder"
                      className="shrink-0 text-lg"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {driveText("topLevel")}
                    </span>
                    <span className="shrink-0 text-xs text-secondary">
                      {sql`case
                      when drive_viewer_root_file_count = 0 then ''
                      else cast(drive_viewer_root_file_count as string)
                    end`}
                    </span>
                  </span>
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
              <Each
                table="drive_viewer_folders"
                recordName="drive_viewer_folder"
              >
                <Sidebar.MenuItem sx={{ py: 0 }}>
                  <Sidebar.MenuButton
                    component="button"
                    active={sql`drive_viewer_folder.id = drive_viewer_active_folder_id`}
                    onClick={(s) =>
                      s.setScalar(
                        "drive_viewer_selected_folder_id",
                        sql`drive_viewer_folder.id`,
                      )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className="shrink-0"
                        dynamicClassNames={[{
                          condition: sql`drive_viewer_folder.depth = 0`,
                          classNames: "w-3",
                        }, {
                          condition: sql`drive_viewer_folder.depth = 1`,
                          classNames: "w-6",
                        }, {
                          condition: sql`drive_viewer_folder.depth = 2`,
                          classNames: "w-9",
                        }, {
                          condition: sql`drive_viewer_folder.depth >= 3`,
                          classNames: "w-12",
                        }]}
                      />
                      <FileTypeIcon
                        kind="folder"
                        className="shrink-0 text-lg"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {sql`drive_viewer_folder.name`}
                      </span>
                      <span className="shrink-0 text-xs text-secondary">
                        {sql`case
                        when drive_viewer_folder.file_count = 0 then ''
                        else cast(drive_viewer_folder.file_count as string)
                      end`}
                      </span>
                    </span>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Each>
            </Sidebar.Menu>
          </div>
        </Sidebar.Group>
        <Sidebar.Group
          label={driveText("files")}
          sx={{ paddingTop: 0, marginTop: -1, minWidth: 0 }}
        >
          <div aria-label={driveText("files")} className="min-w-0">
            <Sidebar.Menu sx={{ minWidth: 0 }}>
              <Each table="drive_viewer_files" recordName="drive_viewer_file">
                <Sidebar.MenuItem sx={{ py: 0, minWidth: 0 }}>
                  <Sidebar.MenuButton
                    component={props.onFileNavigate ? "button" : undefined}
                    sx={{
                      fontSize: "xs",
                      minWidth: 0,
                      width: "100%",
                      overflow: "hidden",
                    }}
                    href={props.onFileNavigate ? undefined : fileHref(
                      sql`drive_viewer_file.id`,
                      sql`drive_viewer_file.file_version_id`,
                    )}
                    active={sql`drive_viewer_file.id = coalesce(
                      ${selectedFileItemId},
                      ${props.activeFileItemId}
                    )`}
                    onClick={(s) => {
                      s.event.preventDefault();
                      navigateFile(s, {
                        href: fileHref(
                          sql`drive_viewer_file.id`,
                          sql`drive_viewer_file.file_version_id`,
                        ),
                        spaceId: props.spaceId as Sql,
                        fileItemId: sql`drive_viewer_file.id`,
                        fileVersionId: sql`drive_viewer_file.file_version_id`,
                        folderId: sql`drive_viewer_active_folder_id`,
                        contentType: sql`drive_viewer_file.content_type`,
                      });
                    }}
                  >
                    <span
                      className="flex w-full min-w-0 items-center gap-2 overflow-hidden"
                      data-drive-viewer-document-key={sql`drive_viewer_file.file_version_id::string`}
                    >
                      <FileTypeIcon
                        kind={sql`drive_viewer_file.icon_kind`}
                        className="shrink-0 text-base"
                      />
                      <span className="block min-w-0 flex-1 truncate">
                        {sql`drive_viewer_file.name`}
                      </span>
                    </span>
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              </Each>
            </Sidebar.Menu>
          </div>
          <Show when={sql`not exists (select 1 from drive_viewer_files)`}>
            <p className="px-4 py-2 text-xs text-secondary">
              {driveText("noFolderFiles")}
            </p>
          </Show>
        </Sidebar.Group>
      </Data>
    </Data>
  );
}
