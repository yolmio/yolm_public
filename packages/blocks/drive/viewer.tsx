import { Button } from "components/button";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Show } from "std/ui";
import type {
  DriveBlockContract,
  DriveSpaceType,
  FileViewerDocumentHref,
  RegisteredFileViewer,
} from "./types.ts";
import { driveText } from "./i18n";
import { fileViewerStateSql } from "./viewer_state_sql";

export interface FileViewerProps {
  controlledRevisionId?: Sql;
  files: DriveBlockContract;
  fileItemId: AnyExpr;
  /**
   * An immutable version to render instead of the item's current version.
   * The version must belong to `fileItemId`; this is used by governed
   * publications and training assignments that must never drift to a draft.
   */
  fileVersionId?: AnyExpr;
  readOnly?: AnyExpr;
  /**
   * Allows an installed editor to fork a new current version from the exact
   * historical version being displayed. Governed draft workspaces use this;
   * ordinary history and published readers leave it disabled.
   */
  allowNewVersionFromHistorical?: AnyExpr;
  /**
   * Governed readers render only the exact approved source representation,
   * excluding mutable working overlays such as PDF markup.
   */
  presentation?: "default" | "governed";
  /** Enables format-specific optimizations for a full-page viewing surface. */
  workspace?: boolean;
  height?: string;
  workspaceHandle?: Sql | string;
  initialPdfPage?: AnyExpr;
  initialPdfFocus?: AnyExpr;
  initialCadObjectKey?: AnyExpr;
  /** Route written by viewers that can switch files without remounting. */
  documentHref?: FileViewerDocumentHref;
  onWorkspaceFileChange?: (
    s: DomStatements,
    fileItemId: Sql,
    fileVersionId: Sql,
  ) => void;
  /**
   * Restricts the emitted contributions to one space type. Use when the
   * surface only ever shows items from that type, so viewers enabled only
   * on other types are not emitted at all.
   */
  spaceType?: DriveSpaceType;
}

/**
 * Resolves a file's current immutable version through registered viewer
 * contributions. Files itself only supplies the authorized byte fallback.
 */
export function FileViewer(props: FileViewerProps) {
  // A literal `true` marks the whole surface statically read-only, letting
  // contributions swap in their display-only rendering instead of emitting
  // full editor trees.
  const staticReadOnly = props.readOnly === true;
  // Trash affects the working item, not an authorized immutable publication.
  const retainedVersion = staticReadOnly &&
    props.presentation === "governed" && props.fileVersionId !== undefined &&
    props.fileVersionId !== null;
  const readOnly = props.readOnly ?? sql`false`;
  const allowNewVersionFromHistorical = props.allowNewVersionFromHistorical ??
    sql`false`;
  const allowedTypeNames = props.spaceType ? [props.spaceType.name] : undefined;
  const viewers: { viewer: RegisteredFileViewer; spaceTypeNames: string[] }[] =
    [];
  for (const viewer of props.files.viewers) {
    const spaceTypeNames = allowedTypeNames
      ? viewer.spaceTypeNames.filter((name) => allowedTypeNames.includes(name))
      : [...viewer.spaceTypeNames];
    if (spaceTypeNames.length === 0) continue;
    viewers.push({ viewer, spaceTypeNames });
  }
  const viewerMatches = viewers.map(({ viewer, spaceTypeNames }) =>
    sql`
      cast(file_viewer.space_type as string) in (
        ${spaceTypeNames.map((name) => sql.lit(name))}
      )
      and ${viewer.canView(sql`file_viewer`)}
    `
  );
  const hasViewer = viewerMatches.length
    ? viewerMatches.reduce((left, right) => sql`${left} or ${right}`)
    : sql`false`;
  let earlierViewerMatches = sql`false`;
  return (
    <Data
      procedure={(s) => {
        // A nested stored-procedure call dominated production UI-state CPU.
        // Share its exact authorized query without crossing that boundary.
        s.defRecord(
          "file_viewer",
          fileViewerStateSql(
            props.files,
            sql`${props.fileItemId}`,
            sql`${props.fileVersionId ?? sql`cast(null as bigint)`}`,
            props.fileVersionId === undefined || props.fileVersionId === null
              ? sql`true`
              : sql`false`,
            retainedVersion ? sql`true` : sql`false`,
          ),
        );
      }}
    >
      <Show
        when={sql`file_viewer.file_item_id is not null`}
        fallback={
          <div className="flex min-h-96 items-center justify-center text-center">
            <div>
              <MaterialIcon icon="Drafts" className="text-5xl text-secondary" />
              <Typography level="h4" className="mt-2">
                {driveText("fileUnavailable")}
              </Typography>
            </div>
          </div>
        }
      >
        {viewers.map(({ viewer }, index) => {
          const match = viewerMatches[index];
          const selected = sql`${match} and not (${earlierViewerMatches})`;
          earlierViewerMatches = sql`${earlierViewerMatches} or ${match}`;
          const renderProps = {
            controlledRevisionId: props.controlledRevisionId,
            fileSpaceId: sql`file_viewer.file_space_id`,
            fileItemId: sql`file_viewer.file_item_id`,
            fileVersionId: sql`file_viewer.file_version_id`,
            versionNumber: sql`file_viewer.version_number`,
            fileName: sql`file_viewer.name`,
            contentType: sql`file_viewer.content_type`,
            fileUrl: props.files.versionBlobUrl(
              sql`file_viewer.file_version_id`,
              sql`file_viewer.blob_hash`,
            ),
            height: props.height,
            presentation: props.presentation ?? "default",
            workspace: props.workspace ?? false,
            workspaceHandle: props.workspaceHandle,
            initialPdfPage: props.initialPdfPage
              ? sql`${props.initialPdfPage}`
              : undefined,
            initialPdfFocus: props.initialPdfFocus
              ? sql`${props.initialPdfFocus}`
              : undefined,
            initialCadObjectKey: props.initialCadObjectKey
              ? sql`${props.initialCadObjectKey}`
              : undefined,
            documentHref: props.documentHref,
            onWorkspaceFileChange: props.onWorkspaceFileChange,
          } as const;
          return (
            <Show when={selected}>
              {staticReadOnly && viewer.renderReadOnly
                ? viewer.renderReadOnly(renderProps)
                : viewer.render({
                  ...renderProps,
                  readOnly: staticReadOnly ? sql`true` : readOnly as Sql,
                  allowNewVersionFromHistorical:
                    allowNewVersionFromHistorical as Sql,
                })}
            </Show>
          );
        })}
        <Show when={sql`not (${hasViewer})`}>
          <div className="flex min-h-96 items-center justify-center text-center">
            <div>
              <MaterialIcon icon="Drafts" className="text-5xl text-secondary" />
              <Typography level="h4" className="mt-2">
                {sql`file_viewer.name`}
              </Typography>
              <p className="mt-1 text-sm text-secondary">
                {driveText("noRichViewer")}
              </p>
              <Show when={sql`file_viewer.blob_hash is not null`}>
                <Button
                  className="mt-4"
                  startIcon="Download"
                  component="a"
                  href={props.files.versionBlobUrl(
                    sql`file_viewer.file_version_id`,
                    sql`file_viewer.blob_hash`,
                  )}
                  target="_blank"
                >
                  {driveText("openFile")}
                </Button>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </Data>
  );
}
