import { Alert } from "components/alert";
import {
  filePreviewDocumentCss,
  filePreviewStyles,
} from "components/file_preview_styles";
import { Button } from "components/button";
import { Input } from "components/input";
import { Select } from "components/select";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { Each, Show, useUniqueId } from "std/ui";

export type DrivePreviewModule =
  | "archive_viewer"
  | "docx_viewer"
  | "image_viewer"
  | "outlook_message_viewer"
  | "p7m_viewer"
  | "spreadsheet_viewer"
  | "tiff_viewer";

function viewerCall(
  module: DrivePreviewModule,
  exportName:
    | "zoomIn"
    | "zoomOut"
    | "fit"
    | "actualSize"
    | "rotateLeft"
    | "rotateRight"
    | "previousPage"
    | "nextPage"
    | "downloadContent"
    | "selectSheet"
    | "filter"
    | "download",
  handle: Sql,
  value: Sql = sql.null,
) {
  return (s: DomStatements) => {
    s.jsCall({
      module,
      exportName,
      handle,
      argJson: sql`json_build_object('handle', ${handle}, 'value', ${value})`,
    });
  };
}

export function FilePreview(props: {
  kind: "image" | "document" | "outlook_message";
  module: DrivePreviewModule;
  fileName: Sql;
  fileUrl: Sql;
  assetUrl?: string;
}) {
  useJsModule(props.module, { assetUrl: props.assetUrl });
  const id = useUniqueId();
  const handle = sql.concat(id, sql.lit`-drive-preview`);
  const mountId = sql.concat(id, sql.lit`-drive-preview-mount`);
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("drive_preview_status", sql.lit`loading`);
        s.defScalar("drive_preview_page", sql`1`);
        s.defScalar("drive_preview_pages", sql`0`);
        s.defScalar("drive_preview_sheet", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("drive_preview_sheets", sql`json_build_array()`);
        s.defScalar("drive_preview_notice", {
          type: { type: "String", maxLength: 2000 },
        });
        s.defScalar("drive_preview_has_content", sql.false);
        s.defScalar("drive_preview_filter", sql.lit``);
        s.defScalar("drive_preview_error", {
          type: { type: "String", maxLength: 500 },
        });
      }}
    >
      <div
        className={props.module === "docx_viewer"
          ? "flex h-[85dvh] min-h-[36rem] flex-col bg-body"
          : "flex h-full min-h-96 flex-col bg-body"}
        sx={filePreviewStyles}
        js={{
          handles: [{ module: props.module, cleanup: "cleanup", handle }],
          on: {
            [`${props.module}.ready`]: (s) => {
              s.setScalar("drive_preview_status", sql.lit`ready`);
              s.setScalar(
                "drive_preview_has_content",
                sql`coalesce(cast(event.payload_json->>'hasEmbeddedContent' as bool), false)`,
              );
              s.setScalar("drive_preview_error", sql.null);
              s.commitUiTreeChanges();
            },
            [`${props.module}.stateChanged`]: (s) => {
              s.setScalar(
                "drive_preview_page",
                sql`coalesce(try_cast(event.payload_json->>'page' as bigint), ui.drive_preview_page)`,
              );
              s.setScalar(
                "drive_preview_pages",
                sql`coalesce(try_cast(event.payload_json->>'pageCount' as bigint), ui.drive_preview_pages)`,
              );
              s.setScalar(
                "drive_preview_sheet",
                sql`event.payload_json->>'sheet'`,
              );
              s.setScalar(
                "drive_preview_sheets",
                sql`coalesce(event.payload_json->'sheets', json_build_array())`,
              );
              s.setScalar(
                "drive_preview_notice",
                sql`event.payload_json->>'notice'`,
              );
              s.commitUiTreeChanges();
            },
            [`${props.module}.error`]: (s) => {
              s.setScalar("drive_preview_status", sql.lit`error`);
              s.setScalar(
                "drive_preview_error",
                sql`coalesce(
                  event.payload_json->>'message',
                  'This file could not be previewed.'
                )`,
              );
              s.commitUiTreeChanges();
            },
          },
        }}
      >
        <div
          aria-label="File controls"
          role="toolbar"
          className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-divider bg-surface px-2 py-1"
        >
          <div className="min-w-0 truncate px-1 text-sm font-medium">
            {props.fileName}
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
            <Show when={sql`${sql.lit(props.module)} = 'tiff_viewer'`}>
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Previous page"
                disabled={sql`ui.drive_preview_page <= 1 or ui.drive_preview_status <> 'ready'`}
                onClick={viewerCall(props.module, "previousPage", handle)}
              >
                <MaterialIcon icon="ChevronLeft" />
              </IconButton>
              <span className="whitespace-nowrap text-sm" aria-live="polite">
                {sql`'Page ' || ui.drive_preview_page || ' of ' || ui.drive_preview_pages`}
              </span>
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Next page"
                disabled={sql`ui.drive_preview_page >= ui.drive_preview_pages or ui.drive_preview_status <> 'ready'`}
                onClick={viewerCall(props.module, "nextPage", handle)}
              >
                <MaterialIcon icon="ChevronRight" />
              </IconButton>
            </Show>
            <Show
              when={sql`${
                sql.lit(props.module)
              } = 'spreadsheet_viewer' and ui.drive_preview_status = 'ready'`}
            >
              <Data
                local
                watch={[sql`ui.drive_preview_sheets`]}
                procedure={(s) => {
                  s.defTable(
                    "preview_sheets",
                    sql`select value->>'name' as name from json.array_each(ui.drive_preview_sheets)`,
                  );
                }}
              >
                <Select
                  size="sm"
                  aria-label="Sheet"
                  value={sql`ui.drive_preview_sheet`}
                  onChange={viewerCall(
                    props.module,
                    "selectSheet",
                    handle,
                    sql`target_value`,
                  )}
                >
                  <Each table="preview_sheets" recordName="preview_sheet">
                    <Select.Option value={sql`preview_sheet.name`}>
                      {sql`preview_sheet.name`}
                    </Select.Option>
                  </Each>
                </Select>
              </Data>
            </Show>
            <Show when={sql`${sql.lit(props.module)} = 'archive_viewer'`}>
              <Input
                size="sm"
                type="search"
                placeholder="Find files in ZIP"
                value={sql`ui.drive_preview_filter`}
                slotProps={{ input: { "aria-label": "Find files in ZIP" } }}
                onInput={(s) => {
                  s.setScalar("drive_preview_filter", sql`target_value`);
                  s.statements(
                    viewerCall(
                      props.module,
                      "filter",
                      handle,
                      sql`ui.drive_preview_filter`,
                    ),
                  );
                }}
              />
            </Show>
            <Show
              when={sql`${
                sql.lit(props.module)
              } = 'p7m_viewer' and ui.drive_preview_has_content`}
            >
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={viewerCall(props.module, "downloadContent", handle)}
              >
                Download signed file
              </Button>
            </Show>
            <Show
              when={sql`${sql.lit(props.kind)} = 'image' or ${
                sql.lit(props.module)
              } = 'tiff_viewer'`}
            >
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Zoom out"
                onClick={viewerCall(props.module, "zoomOut", handle)}
              >
                <MaterialIcon icon="ZoomOut" />
              </IconButton>
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={viewerCall(props.module, "fit", handle)}
              >
                Fit
              </Button>
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={viewerCall(props.module, "actualSize", handle)}
              >
                100%
              </Button>
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Zoom in"
                onClick={viewerCall(props.module, "zoomIn", handle)}
              >
                <MaterialIcon icon="ZoomIn" />
              </IconButton>
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Rotate left"
                onClick={viewerCall(props.module, "rotateLeft", handle)}
              >
                <MaterialIcon icon="RotateLeft" />
              </IconButton>
              <IconButton
                size="sm"
                variant="plain"
                aria-label="Rotate right"
                onClick={viewerCall(props.module, "rotateRight", handle)}
              >
                <MaterialIcon icon="RotateRight" />
              </IconButton>
            </Show>
            <IconButton
              size="sm"
              variant="plain"
              aria-label="Download file"
              onClick={viewerCall(props.module, "download", handle)}
            >
              <MaterialIcon icon="Download" />
            </IconButton>
          </div>
        </div>
        <Show when={sql`${sql.lit(props.module)} = 'docx_viewer'`}>
          <div className="border-b border-divider px-3 py-2 text-xs text-secondary">
            Formatting may look different here. Download the file to see the
            original Word layout.
          </div>
        </Show>
        <Show when={sql`${sql.lit(props.module)} = 'archive_viewer'`}>
          <div className="border-b border-divider px-3 py-2 text-xs text-secondary">
            Browse the files and folders in this ZIP. Download it to open the
            files inside.
          </div>
        </Show>
        <Show when={sql`ui.drive_preview_notice is not null`}>
          <div className="border-b border-divider px-3 py-2 text-xs text-secondary">
            {sql`ui.drive_preview_notice`}
          </div>
        </Show>
        <Show when={sql`ui.drive_preview_error is not null`}>
          <Alert color="danger" className="m-2">
            {sql`ui.drive_preview_error`}
          </Alert>
        </Show>
        <div className="relative min-h-0 flex-1">
          <div
            id={mountId}
            className="absolute inset-0"
            onMount={(s) => {
              s.jsCall({
                module: props.module,
                exportName: "initialize",
                handle,
                argJson: sql`json_build_object(
                  'handle', ${handle},
                  'elementId', ${mountId},
                  'fileUrl', ${props.fileUrl},
                  'fileName', ${props.fileName},
                  'documentCss', ${
                  sql.lit(
                    props.module === "docx_viewer"
                      ? filePreviewDocumentCss
                      : "",
                  )
                }
                )`,
              });
            }}
          />
          <Show when={sql`ui.drive_preview_status = 'loading'`}>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-body/80 text-sm text-secondary">
              <MaterialIcon icon="Autorenew" className="mr-2 animate-spin" />
              Opening file…
            </div>
          </Show>
        </div>
      </div>
    </Data>
  );
}
