import { FilePreview } from "components/file_preview";
import type { DrivePreviewModule } from "components/file_preview";
import { sql } from "std/sql_utils";
import type {
  DriveExtension,
  FileViewerContribution,
  FileViewerRenderProps,
} from "./types.ts";

export interface DrivePreviewExtensionOpts {
  /** URL for this extension's dedicated browser module. */
  assetUrl?: string;
}

function renderImage(
  props: FileViewerRenderProps,
  opts: DrivePreviewExtensionOpts,
) {
  return (
    <FilePreview
      kind="image"
      module="image_viewer"
      fileName={props.fileName}
      fileUrl={props.fileUrl}
      assetUrl={opts.assetUrl}
    />
  );
}

function renderOutlookMessage(
  props: FileViewerRenderProps,
  opts: DrivePreviewExtensionOpts,
) {
  return (
    <FilePreview
      kind="outlook_message"
      module="outlook_message_viewer"
      fileName={props.fileName}
      fileUrl={props.fileUrl}
      assetUrl={opts.assetUrl}
    />
  );
}

function renderDocument(
  props: FileViewerRenderProps,
  opts: DrivePreviewExtensionOpts,
  module: DrivePreviewModule,
) {
  return (
    <FilePreview
      kind="document"
      module={module}
      fileName={props.fileName}
      fileUrl={props.fileUrl}
      assetUrl={opts.assetUrl}
    />
  );
}

/** Browser-native raster image viewing without additional Drive schema. */
export class ImageViewerExtension implements DriveExtension {
  readonly name = "image_viewer";
  readonly viewer: FileViewerContribution = {
    name: "image_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) in (
        'image/avif',
        'image/bmp',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp'
      )`,
    render: (props) => renderImage(props, this.opts),
    renderReadOnly: (props) =>
      renderImage({
        ...props,
        readOnly: sql`true`,
        allowNewVersionFromHistorical: sql`false`,
      }, this.opts),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}

/** Client-side Outlook `.msg` viewing without persisting parsed message data. */
export class OutlookMessageViewerExtension implements DriveExtension {
  readonly name = "outlook_message_viewer";
  readonly viewer: FileViewerContribution = {
    name: "outlook_message_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) in (
        'application/vnd.ms-outlook',
        'application/x-msg'
      ) or lower(${version}.name) like '%.msg'`,
    render: (props) => renderOutlookMessage(props, this.opts),
    renderReadOnly: (props) =>
      renderOutlookMessage({
        ...props,
        readOnly: sql`true`,
        allowNewVersionFromHistorical: sql`false`,
      }, this.opts),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}

/** Multi-page TIFF viewing with bounded, page-at-a-time client-side decoding. */
export class TiffViewerExtension implements DriveExtension {
  readonly name = "tiff_viewer";
  readonly viewer: FileViewerContribution = {
    name: "tiff_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) in ('image/tif', 'image/tiff')
        or lower(${version}.name) like '%.tif'
        or lower(${version}.name) like '%.tiff'`,
    render: (props) => renderDocument(props, this.opts, "tiff_viewer"),
    renderReadOnly: (props) =>
      renderDocument(
        {
          ...props,
          readOnly: sql`true`,
          allowNewVersionFromHistorical: sql`false`,
        },
        this.opts,
        "tiff_viewer",
      ),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}

/** Data-only workbook viewing for XLSX, XLSM, and legacy XLS files. */
export class SpreadsheetViewerExtension implements DriveExtension {
  readonly name = "spreadsheet_viewer";
  readonly viewer: FileViewerContribution = {
    name: "spreadsheet_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) in (
        'application/msexcel',
        'application/vnd.ms-excel',
        'application/vnd.ms-excel.sheet.macroenabled.12',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ) or lower(${version}.name) like '%.xls'
        or lower(${version}.name) like '%.xlsx'
        or lower(${version}.name) like '%.xlsm'`,
    render: (props) => renderDocument(props, this.opts, "spreadsheet_viewer"),
    renderReadOnly: (props) =>
      renderDocument(
        {
          ...props,
          readOnly: sql`true`,
          allowNewVersionFromHistorical: sql`false`,
        },
        this.opts,
        "spreadsheet_viewer",
      ),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}

/** ZIP folder and entry metadata viewing without extracting archive contents. */
export class ArchiveViewerExtension implements DriveExtension {
  readonly name = "archive_viewer";
  readonly viewer: FileViewerContribution = {
    name: "archive_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) in (
        'application/x-zip-compressed',
        'application/zip'
      ) or lower(${version}.name) like '%.zip'`,
    render: (props) => renderDocument(props, this.opts, "archive_viewer"),
    renderReadOnly: (props) =>
      renderDocument(
        {
          ...props,
          readOnly: sql`true`,
          allowNewVersionFromHistorical: sql`false`,
        },
        this.opts,
        "archive_viewer",
      ),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}

/** Sanitized, sandboxed HTML derivative viewing for DOCX files. */
export class DocxViewerExtension implements DriveExtension {
  readonly name = "docx_viewer";
  readonly viewer: FileViewerContribution = {
    name: "docx_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        or lower(${version}.name) like '%.docx'`,
    render: (props) => renderDocument(props, this.opts, "docx_viewer"),
    renderReadOnly: (props) =>
      renderDocument(
        {
          ...props,
          readOnly: sql`true`,
          allowNewVersionFromHistorical: sql`false`,
        },
        this.opts,
        "docx_viewer",
      ),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}

/** CMS/P7M signature and embedded-payload inspection in the browser. */
export class P7mViewerExtension implements DriveExtension {
  readonly name = "p7m_viewer";
  readonly viewer: FileViewerContribution = {
    name: "p7m_viewer",
    canView: (version) =>
      sql`lower(${version}.content_type) in (
        'application/pkcs7-mime',
        'application/x-pkcs7-mime',
        'multipart/signed'
      ) or lower(${version}.name) like '%.p7m'`,
    render: (props) => renderDocument(props, this.opts, "p7m_viewer"),
    renderReadOnly: (props) =>
      renderDocument(
        {
          ...props,
          readOnly: sql`true`,
          allowNewVersionFromHistorical: sql`false`,
        },
        this.opts,
        "p7m_viewer",
      ),
  };

  constructor(readonly opts: DrivePreviewExtensionOpts = {}) {}

  initialize() {}
}
