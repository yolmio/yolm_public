import { Alert } from "./alert";
import { Button } from "./button";
import { ButtonGroup } from "./button_group";
import { Divider } from "./divider";
import { IconButton } from "./icon_button";
import type { IconName } from "./material_icon_names";
import { Typography } from "./typography";
import { Data } from "std/data";
import { getModuleDirUrl, getModuleFileUrl, useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { createStyles } from "std/style_utils";
import { Show, useUniqueId } from "std/ui";

export type PdfMarkupTool = "hand" | "select" | "pen" | "highlight" | "text";
type PdfMarkupStyleTool = Exclude<PdfMarkupTool, "hand" | "select">;
type PdfMarkupStyleValue = string | number;

export interface PdfMarkupEvent {
  handle: Sql;
  payload: Sql;
  page: Sql;
  pageCount: Sql;
  dirty: Sql;
  documentKey: Sql;
  fileItemId: Sql;
  documentIndex: Sql;
  documentCount: Sql;
  fileName: Sql;
  revision: Sql;
  contextKey: Sql;
  canEdit: Sql;
}

export interface PdfMarkupSaveEvent extends PdfMarkupEvent {
  annotations: Sql;
  changeSequence: Sql;
}

export type PdfMarkupEventHandler = (
  s: DomStatements,
  event: PdfMarkupEvent,
) => void;

export type PdfMarkupSaveHandler = (
  s: UiServerStatements,
  event: PdfMarkupSaveEvent,
) => void;

/** Shared configuration for ordered PDF workspace viewers and editors. */
export interface PdfWorkspaceBaseProps {
  handle?: Sql | string;
  documents: Sql;
  initialDocumentKey?: Sql | string;
  initialPage?: Sql;
  /** Optional rendered-pixel crop to frame when the document opens. */
  initialFocus?: Sql;
  height?: string;
  className?: string;
  showToolbar?: boolean;
  showDocumentNavigation?: boolean;
  allowDownloadFlattened?: boolean;
  pdfJsUrl?: Sql | string;
  pdfJsWorkerUrl?: Sql | string;
  pdfJsWasmUrl?: Sql | string;
  onReady?: PdfMarkupEventHandler;
  onPageChange?: PdfMarkupEventHandler;
  onDocumentChange?: PdfMarkupEventHandler;
  onError?: PdfMarkupEventHandler;
}

/** Read-only viewer for an ordered runtime JSON array of PDF documents. */
export interface PdfWorkspaceViewerProps extends PdfWorkspaceBaseProps {
  allowRotation?: boolean;
}

/** Annotation editor for an ordered runtime JSON array of PDF documents. */
export interface PdfWorkspaceEditorProps extends PdfWorkspaceBaseProps {
  tools?: PdfMarkupTool[];
  initialTool?: PdfMarkupTool;
  disabled?: BooleanExpr;
  saveLabel?: string;
  onChange?: PdfMarkupEventHandler;
  onSave: PdfMarkupSaveHandler;
  onRotationChange?: PdfMarkupRotationHandler;
}

export interface PdfMarkupBaseProps extends
  Omit<
    PdfWorkspaceBaseProps,
    | "documents"
    | "initialDocumentKey"
    | "onDocumentChange"
    | "showDocumentNavigation"
  > {
  fileUrl: Sql | string;
  annotations?: Sql;
  fileName?: Sql | string;
  initialPage?: Sql;
  initialFocus?: Sql;
}

export interface PdfMarkupViewerProps extends PdfMarkupBaseProps {}

export interface PdfMarkupEditorProps extends PdfMarkupBaseProps {
  tools?: PdfMarkupTool[];
  initialTool?: PdfMarkupTool;
  disabled?: BooleanExpr;
  saveLabel?: string;
  onChange?: PdfMarkupEventHandler;
  onSave: PdfMarkupSaveHandler;
}

/** Server event emitted after a workspace page is rotated. */
export interface PdfMarkupRotationEvent extends PdfMarkupEvent {
  quarterTurns: Sql;
  previousQuarterTurns: Sql;
  requestId: Sql;
}

/** Persists a workspace page's normalized clockwise quarter-turn count. */
export type PdfMarkupRotationHandler = (
  s: UiServerStatements,
  event: PdfMarkupRotationEvent,
) => void;

const DEFAULT_EDITOR_TOOLS: PdfMarkupTool[] = [
  "hand",
  "select",
  "pen",
  "highlight",
  "text",
];

const PEN_COLORS = [
  { label: "Red", value: "#ef4444" },
  { label: "Blue", value: "#2563eb" },
  { label: "Black", value: "#0f172a" },
  { label: "Green", value: "#16a34a" },
];
const HIGHLIGHT_COLORS = [
  { label: "Yellow", value: "#fde047" },
  { label: "Green", value: "#86efac" },
  { label: "Blue", value: "#67e8f9" },
  { label: "Pink", value: "#f9a8d4" },
];
const TEXT_COLORS = [
  { label: "Black", value: "#0f172a" },
  { label: "Red", value: "#dc2626" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#15803d" },
];
const PEN_WIDTHS = [
  { label: "Thin Pen", value: 1.5 },
  { label: "Medium Pen", value: 2.5 },
  { label: "Thick Pen", value: 4.5 },
];
const HIGHLIGHT_WIDTHS = [
  { label: "Narrow Highlight", value: 8 },
  { label: "Medium Highlight", value: 12 },
  { label: "Wide Highlight", value: 18 },
];
const HIGHLIGHT_OPACITIES = [
  { label: "Light Highlight", value: 0.24 },
  { label: "Medium Highlight", value: 0.36 },
  { label: "Strong Highlight", value: 0.52 },
];
const FONT_SIZES = [
  { label: "Small Text", shortLabel: "S", value: 11 },
  { label: "Medium Text", shortLabel: "M", value: 13 },
  { label: "Large Text", shortLabel: "L", value: 16 },
  { label: "Extra Large Text", shortLabel: "XL", value: 20 },
];

const pdfDocumentBoundaryStyles = {
  boxSizing: "border-box",
  width: "min(920px, calc(100% - 32px))",
  margin: "0 auto 14px",
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: "8px",
  background: "rgba(248, 250, 252, 0.96)",
  color: "#334155",
  font:
    '500 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  padding: "9px 12px",
  textAlign: "center",
} as const;

const pdfViewerMessageStyles = {
  height: "100%",
  minHeight: "520px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  color: "#475569",
  textAlign: "center",
  font:
    '500 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

const styles = createStyles({
  frame: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    border: "1px solid var(--palette-divider)",
    borderRadius: "6px",
    backgroundColor: "var(--palette-background-surface)",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 1,
    p: 1,
    borderBottom: "1px solid var(--palette-divider)",
    backgroundColor: "var(--palette-background-surface)",
  },
  mount: {
    height: "calc(100vh - 150px)",
    minHeight: "520px",
    position: "relative",
    overflow: "hidden",
    "& .ym-pdf-markup-root": {
      position: "absolute",
      inset: 0,
      minHeight: "520px",
      background: "#e5e7eb",
      overflow: "auto",
      touchAction: "none",
      overscrollBehavior: "contain",
      "--pdfViewer-padding-bottom": "32px",
      "--page-margin": "12px auto 18px",
      "--page-border": 0,
    },
    "& .ym-pdf-markup-pages": {
      minHeight: "100%",
      paddingTop: "1px",
    },
    "& .ym-pdf-markup-document-header": pdfDocumentBoundaryStyles,
    "& .ym-pdf-markup-document-footer": {
      ...pdfDocumentBoundaryStyles,
      marginBottom: 0,
    },
    "& .ym-pdf-markup-document-header strong": {
      color: "#0f172a",
      display: "block",
      fontSize: "14px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    "& .ym-pdf-markup-document-position": {
      color: "#64748b",
      display: "block",
      fontSize: "12px",
      marginTop: "2px",
    },
    "& .ym-pdf-markup-document-footer strong": {
      color: "#0f172a",
    },
    "& .ym-pdf-markup-stage": {
      position: "relative",
      margin: "0 auto 18px",
      background: "#ffffff",
      boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
      touchAction: "none",
    },
    "& .ym-pdf-markup-overlay": {
      position: "absolute",
      inset: 0,
      zIndex: 10,
    },
    "& .ym-pdf-markup-root[data-read-only='true'] .ym-pdf-markup-overlay": {
      pointerEvents: "none",
    },
    "& .ym-pdf-markup-text-layer": {
      position: "absolute",
      inset: 0,
      zIndex: 11,
      pointerEvents: "none",
    },
    "& .ym-pdf-evidence-focus": {
      position: "absolute",
      zIndex: 15,
      boxSizing: "border-box",
      border: "3px solid #f59e0b",
      borderRadius: "5px",
      background: "rgba(245, 158, 11, 0.12)",
      boxShadow:
        "0 0 0 3px rgba(255, 255, 255, 0.92), 0 8px 24px rgba(15, 23, 42, 0.3)",
      pointerEvents: "none",
    },
    "& .ym-pdf-evidence-focus-label": {
      position: "absolute",
      left: "-3px",
      top: "-29px",
      borderRadius: "4px 4px 0 0",
      background: "#b45309",
      color: "#ffffff",
      font:
        '700 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      letterSpacing: "0.01em",
      padding: "5px 8px",
      whiteSpace: "nowrap",
    },
    "& .ym-pdf-markup-text-note": {
      position: "absolute",
      boxSizing: "border-box",
      border: "1px solid transparent",
      borderRadius: "3px",
      background: "transparent",
      color: "#0f172a",
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      lineHeight: 1.28,
      margin: 0,
      minHeight: "24px",
      minWidth: "48px",
      overflow: "hidden",
      padding: "1px 2px",
      pointerEvents: "auto",
      resize: "none",
      whiteSpace: "pre-wrap",
    },
    "& .ym-pdf-markup-text-resize-handle": {
      position: "absolute",
      boxSizing: "border-box",
      width: "14px",
      height: "14px",
      borderRight: "2px solid #2563eb",
      borderBottom: "2px solid #2563eb",
      cursor: "nwse-resize",
      opacity: 0,
      pointerEvents: "none",
    },
    "& .ym-pdf-markup-text-resize-handle[data-selected='true']": {
      opacity: 1,
      pointerEvents: "auto",
    },
    "& .ym-pdf-markup-text-note::placeholder": {
      color: "#64748b",
    },
    "& .ym-pdf-markup-text-note:focus, & .ym-pdf-markup-text-note[data-selected='true']":
      {
        background: "rgba(255, 255, 255, 0.24)",
        borderColor: "#2563eb",
        boxShadow: "0 0 0 1px #2563eb",
        outline: "none",
      },
    "& .ym-pdf-markup-root[data-read-only='true'] .ym-pdf-markup-text-note": {
      background: "transparent",
      borderColor: "transparent",
      boxShadow: "none",
      cursor: "default",
    },
    "& .ym-pdf-markup-root[data-tool='select'] .ym-pdf-markup-text-note": {
      cursor: "move",
    },
    "& .ym-pdf-markup-root[data-tool='text'] .ym-pdf-markup-text-note": {
      cursor: "text",
    },
    "& .ym-pdf-markup-root[data-tool='pen'] .ym-pdf-markup-text-note, & .ym-pdf-markup-root[data-tool='highlight'] .ym-pdf-markup-text-note, & .ym-pdf-markup-root[data-read-only='false'][data-tool='hand'] .ym-pdf-markup-text-note, & .ym-pdf-markup-root[data-space-pan='true'] .ym-pdf-markup-text-note, & .ym-pdf-markup-root[data-tool='pen'] .ym-pdf-markup-text-resize-handle, & .ym-pdf-markup-root[data-tool='highlight'] .ym-pdf-markup-text-resize-handle, & .ym-pdf-markup-root[data-read-only='false'][data-tool='hand'] .ym-pdf-markup-text-resize-handle, & .ym-pdf-markup-root[data-space-pan='true'] .ym-pdf-markup-text-resize-handle":
      {
        pointerEvents: "none",
      },
    "& .ym-pdf-markup-empty": pdfViewerMessageStyles,
    "& .ym-pdf-markup-loading": pdfViewerMessageStyles,
    "& .ym-pdf-markup-error": {
      ...pdfViewerMessageStyles,
      color: "#b91c1c",
    },
  },
  workspaceMount: {
    height: "auto",
    minHeight: 0,
    flexGrow: 1,
  },
  styleControls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 1,
  },
  styleGroup: {
    display: "flex",
    alignItems: "center",
    gap: "3px",
  },
  styleOptionButton: {
    appearance: "none",
    width: "28px",
    height: "26px",
    border: "1px solid var(--palette-neutral-outlined-border)",
    borderRadius: "4px",
    backgroundColor: "var(--palette-background-surface)",
    color: "var(--palette-text-primary)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    "&:hover": {
      backgroundColor: "var(--palette-neutral-outlined-hoverBg)",
    },
    "&[aria-pressed='true']": {
      borderColor: "var(--palette-primary-outlined-border)",
      boxShadow: "0 0 0 2px var(--palette-primary-soft-bg)",
    },
    "&:disabled": {
      cursor: "default",
      opacity: 0.48,
    },
  },
  colorPreview: {
    width: "15px",
    height: "15px",
    border: "1px solid rgba(15, 23, 42, 0.22)",
    borderRadius: "50%",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.45)",
  },
  strokePreview: {
    width: "16px",
    borderRadius: "999px",
    backgroundColor: "currentColor",
  },
  opacityPreview: {
    width: "16px",
    height: "16px",
    border: "1px solid rgba(15, 23, 42, 0.18)",
    borderRadius: "3px",
    backgroundColor: "#fde047",
  },
  fontSizePreview: {
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: 1,
  },
});

function toSql(value: Sql | string | undefined, fallback: string): Sql {
  if (value === undefined) {
    return sql.lit(fallback);
  }
  return typeof value === "string" ? sql.lit(value) : value;
}

function annotationJson(annotations: Sql | undefined) {
  return annotations
    ? sql`coalesce(${annotations}, '[]'::json)`
    : sql`'[]'::json`;
}

function styleValueSql(value: PdfMarkupStyleValue): Sql {
  return typeof value === "string" ? sql.lit(value) : sql`${value}`;
}

function createPdfMarkupEvent(handle: Sql): PdfMarkupEvent {
  return {
    handle,
    payload: sql`event.payload_json`,
    page:
      sql`coalesce(try_cast(event.payload_json->>'page' as int), current_page)`,
    pageCount:
      sql`coalesce(try_cast(event.payload_json->>'pageCount' as int), page_count)`,
    dirty: sql`coalesce(try_cast(event.payload_json->>'dirty' as bool), dirty)`,
    documentKey:
      sql`coalesce(event.payload_json->>'documentKey', current_document_key)`,
    fileItemId:
      sql`coalesce(event.payload_json->>'fileItemId', current_file_item_id)`,
    documentIndex:
      sql`coalesce(try_cast(event.payload_json->>'documentIndex' as int), document_index)`,
    documentCount:
      sql`coalesce(try_cast(event.payload_json->>'documentCount' as int), document_count)`,
    fileName: sql`coalesce(event.payload_json->>'fileName', current_file_name)`,
    revision:
      sql`coalesce(try_cast(event.payload_json->>'revision' as int), current_revision)`,
    contextKey:
      sql`coalesce(event.payload_json->>'contextKey', current_document_context_key)`,
    canEdit:
      sql`coalesce(try_cast(event.payload_json->>'canEdit' as bool), current_document_can_edit)`,
  };
}

function createPdfMarkupSaveEvent(handle: Sql): PdfMarkupSaveEvent {
  return {
    handle,
    payload: sql`pdf_markup_result`,
    annotations: sql`coalesce(pdf_markup_result->'annotations', '[]'::json)`,
    changeSequence:
      sql`coalesce(try_cast(pdf_markup_result->>'changeSequence' as int), 0)`,
    page:
      sql`coalesce(try_cast(pdf_markup_result->>'page' as int), current_page)`,
    pageCount:
      sql`coalesce(try_cast(pdf_markup_result->>'pageCount' as int), page_count)`,
    dirty: sql`coalesce(try_cast(pdf_markup_result->>'dirty' as bool), dirty)`,
    documentKey:
      sql`coalesce(pdf_markup_result->>'documentKey', current_document_key)`,
    fileItemId:
      sql`coalesce(pdf_markup_result->>'fileItemId', current_file_item_id)`,
    documentIndex:
      sql`coalesce(try_cast(pdf_markup_result->>'documentIndex' as int), document_index)`,
    documentCount:
      sql`coalesce(try_cast(pdf_markup_result->>'documentCount' as int), document_count)`,
    fileName: sql`coalesce(pdf_markup_result->>'fileName', current_file_name)`,
    revision:
      sql`coalesce(try_cast(pdf_markup_result->>'revision' as int), current_revision)`,
    contextKey:
      sql`coalesce(pdf_markup_result->>'contextKey', current_document_context_key)`,
    canEdit:
      sql`coalesce(try_cast(pdf_markup_result->>'canEdit' as bool), current_document_can_edit)`,
  };
}

function createPdfMarkupRotationEvent(handle: Sql): PdfMarkupRotationEvent {
  return {
    ...createPdfMarkupEvent(handle),
    quarterTurns:
      sql`coalesce(try_cast(event.payload_json->>'quarterTurns' as int), 0)`,
    previousQuarterTurns:
      sql`coalesce(try_cast(event.payload_json->>'previousQuarterTurns' as int), 0)`,
    requestId: sql`coalesce(event.payload_json->>'requestId', '')`,
  };
}

function PdfMarkupToolButton(props: {
  handle: Sql;
  tool: PdfMarkupTool;
  icon: IconName;
  label: string;
  disabled?: BooleanExpr;
}) {
  return (
    <IconButton
      icon={props.icon}
      aria-label={props.label}
      tooltip={props.label}
      variant="outlined"
      color="neutral"
      size="sm"
      disabled={props.disabled}
      aria-pressed={sql`active_tool = ${sql.lit(props.tool)}`}
      onClick={(s) => {
        s.setScalar("active_tool", sql.lit(props.tool));
        s.setScalar("selected_markup_tool", sql.null);
        s.setScalar("has_selection", false);
        s.jsCall({
          module: "pdf_markup",
          exportName: "setTool",
          handle: props.handle,
          argJson: sql`json_build_object(
            'handle', ${props.handle},
            'tool', ${sql.lit(props.tool)}
          )`,
        });
      }}
    />
  );
}

function PdfMarkupStyleOptionButton(props: {
  handle: Sql;
  tool: PdfMarkupStyleTool;
  scalar: string;
  argName: "color" | "strokeWidth" | "opacity" | "fontSize";
  value: PdfMarkupStyleValue;
  label: string;
  disabled?: BooleanExpr;
  children: JSX.Element;
}) {
  const value = styleValueSql(props.value);
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={sql`${sql.ref(props.scalar)} = ${value}`}
      disabled={props.disabled}
      sx={styles.styleOptionButton}
      onClick={(s) => {
        s.setScalar(props.scalar, value);
        s.jsCall({
          module: "pdf_markup",
          exportName: "setStyle",
          handle: props.handle,
          argJson: sql`json_build_object(
            'handle', ${props.handle},
            'tool', ${sql.lit(props.tool)},
            ${sql.lit(props.argName)}, ${value}
          )`,
        });
      }}
    >
      {props.children}
    </button>
  );
}

function PdfMarkupColorControls(props: {
  handle: Sql;
  tool: PdfMarkupStyleTool;
  scalar: string;
  colors: { label: string; value: string }[];
  disabled?: BooleanExpr;
}) {
  return (
    <div sx={styles.styleGroup}>
      {props.colors.map((color) => (
        <PdfMarkupStyleOptionButton
          handle={props.handle}
          tool={props.tool}
          scalar={props.scalar}
          argName="color"
          value={color.value}
          label={`${color.label} ${props.tool} color`}
          disabled={props.disabled}
        >
          <span
            aria-hidden="true"
            sx={[styles.colorPreview, { backgroundColor: color.value }]}
          />
        </PdfMarkupStyleOptionButton>
      ))}
    </div>
  );
}

function PdfMarkupStrokeControls(props: {
  handle: Sql;
  tool: "pen" | "highlight";
  scalar: string;
  widths: { label: string; value: number }[];
  disabled?: BooleanExpr;
}) {
  return (
    <div sx={styles.styleGroup}>
      {props.widths.map((width) => (
        <PdfMarkupStyleOptionButton
          handle={props.handle}
          tool={props.tool}
          scalar={props.scalar}
          argName="strokeWidth"
          value={width.value}
          label={width.label}
          disabled={props.disabled}
        >
          <span
            aria-hidden="true"
            sx={[
              styles.strokePreview,
              {
                height: `${Math.max(2, Math.min(width.value, 8))}px`,
              },
            ]}
          />
        </PdfMarkupStyleOptionButton>
      ))}
    </div>
  );
}

function PdfMarkupOpacityControls(props: {
  handle: Sql;
  disabled?: BooleanExpr;
}) {
  return (
    <div sx={styles.styleGroup}>
      {HIGHLIGHT_OPACITIES.map((opacity) => (
        <PdfMarkupStyleOptionButton
          handle={props.handle}
          tool="highlight"
          scalar="highlight_opacity"
          argName="opacity"
          value={opacity.value}
          label={opacity.label}
          disabled={props.disabled}
        >
          <span
            aria-hidden="true"
            sx={[styles.opacityPreview, { opacity: String(opacity.value) }]}
          />
        </PdfMarkupStyleOptionButton>
      ))}
    </div>
  );
}

function PdfMarkupFontSizeControls(props: {
  handle: Sql;
  disabled?: BooleanExpr;
}) {
  return (
    <div sx={styles.styleGroup}>
      {FONT_SIZES.map((fontSize) => (
        <PdfMarkupStyleOptionButton
          handle={props.handle}
          tool="text"
          scalar="text_font_size"
          argName="fontSize"
          value={fontSize.value}
          label={fontSize.label}
          disabled={props.disabled}
        >
          <span aria-hidden="true" sx={styles.fontSizePreview}>
            {fontSize.shortLabel}
          </span>
        </PdfMarkupStyleOptionButton>
      ))}
    </div>
  );
}

function PdfMarkupStyleControls(props: {
  handle: Sql;
  disabled?: BooleanExpr;
}) {
  return (
    <div sx={styles.styleControls}>
      <Show when={sql`coalesce(selected_markup_tool, active_tool) = 'pen'`}>
        <PdfMarkupColorControls
          handle={props.handle}
          tool="pen"
          scalar="pen_color"
          colors={PEN_COLORS}
          disabled={props.disabled}
        />
        <PdfMarkupStrokeControls
          handle={props.handle}
          tool="pen"
          scalar="pen_width"
          widths={PEN_WIDTHS}
          disabled={props.disabled}
        />
      </Show>
      <Show
        when={sql`coalesce(selected_markup_tool, active_tool) = 'highlight'`}
      >
        <PdfMarkupColorControls
          handle={props.handle}
          tool="highlight"
          scalar="highlight_color"
          colors={HIGHLIGHT_COLORS}
          disabled={props.disabled}
        />
        <PdfMarkupStrokeControls
          handle={props.handle}
          tool="highlight"
          scalar="highlight_width"
          widths={HIGHLIGHT_WIDTHS}
          disabled={props.disabled}
        />
        <PdfMarkupOpacityControls
          handle={props.handle}
          disabled={props.disabled}
        />
      </Show>
      <Show when={sql`coalesce(selected_markup_tool, active_tool) = 'text'`}>
        <PdfMarkupColorControls
          handle={props.handle}
          tool="text"
          scalar="text_color"
          colors={TEXT_COLORS}
          disabled={props.disabled}
        />
        <PdfMarkupFontSizeControls
          handle={props.handle}
          disabled={props.disabled}
        />
      </Show>
    </div>
  );
}

function runViewerCommand(handle: Sql, exportName: string) {
  return (s: DomStatements) => {
    s.jsCall({
      module: "pdf_markup",
      exportName,
      handle,
      argJson: sql`json_build_object('handle', ${handle})`,
    });
  };
}

function changeWorkspaceDocument(handle: Sql, delta: number) {
  return (s: DomStatements) => {
    s.jsCall({
      module: "pdf_markup",
      exportName: "changeDocument",
      handle,
      argJson: sql`json_build_object(
        'handle', ${handle},
        'documentIndex', document_index + ${delta}
      )`,
    });
  };
}

/** Requests a workspace document change while preserving editor save guards. */
export function changePdfWorkspaceDocument(
  s: DomStatements,
  handle: Sql | string,
  documentKey: Sql | string,
  targetPage?: Sql | number | "last",
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  const key = typeof documentKey === "string"
    ? sql.lit(documentKey)
    : documentKey;
  const page = targetPage === undefined
    ? sql`1`
    : typeof targetPage === "number"
    ? sql`${targetPage}`
    : targetPage === "last"
    ? sql.lit`last`
    : targetPage;
  s.jsCall({
    module: "pdf_markup",
    exportName: "changeDocument",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'documentKey', ${key},
      'targetPage', ${page}
    )`,
  });
}

/**
 * Replaces a workspace's ordered document set in place and opens the
 * requested document, keeping the mounted viewer, tool, and zoom context.
 * Callers must flush unsaved annotations first; the previous set's in-memory
 * edits are discarded.
 */
export function setPdfWorkspaceDocuments(
  s: DomStatements,
  handle: Sql | string,
  documents: Sql,
  initialDocumentKey?: Sql | string,
  resultJsonScalar?: string,
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  s.jsCall({
    module: "pdf_markup",
    exportName: "setDocuments",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'documents', ${documents},
      'initialDocumentKey', ${toSql(initialDocumentKey, "")}
    )`,
    resultJsonScalar,
  });
}

export function downloadFlattenedPdf(
  s: DomStatements,
  handle: Sql | string,
  fileName: Sql | string | undefined,
) {
  const viewerHandle = typeof handle === "string" ? sql.lit(handle) : handle;
  s.jsCall({
    module: "pdf_markup",
    exportName: "downloadFlattenedPdf",
    handle: viewerHandle,
    argJson: sql`json_build_object(
      'handle', ${viewerHandle},
      'filename', ${toSql(fileName, "marked-up.pdf")}
    )`,
  });
}

function PdfMarkupNavigationToolbar(props: {
  handle: Sql;
  fileName?: Sql | string;
  allowDownloadFlattened?: boolean;
  workspace?: boolean;
  showDocumentNavigation?: boolean;
  allowRotation?: boolean;
  disabled?: BooleanExpr;
}) {
  return (
    <>
      <Show
        when={sql`
          ${
          props.workspace && props.showDocumentNavigation !== false ? 1 : 0
        } = 1
          and document_count > 1
        `}
      >
        <ButtonGroup spacing={0}>
          <IconButton
            icon="KeyboardDoubleArrowLeft"
            aria-label="Previous Document"
            tooltip="Previous Document"
            variant="outlined"
            color="neutral"
            size="sm"
            disabled={sql`
              document_index <= 0 or saving_annotations or saving_rotation
            `}
            onClick={changeWorkspaceDocument(props.handle, -1)}
          />
          <IconButton
            icon="KeyboardDoubleArrowRight"
            aria-label="Next Document"
            tooltip="Next Document"
            variant="outlined"
            color="neutral"
            size="sm"
            disabled={sql`
              document_index >= document_count - 1
              or saving_annotations
              or saving_rotation
            `}
            onClick={changeWorkspaceDocument(props.handle, 1)}
          />
        </ButtonGroup>
        <div className="min-w-0 max-w-64 px-2">
          <Typography level="body-sm" className="truncate font-medium">
            {sql`current_file_name`}
          </Typography>
          <Typography level="body-xs" className="text-secondary">
            {sql`(document_index + 1)::string || ' of ' || document_count::string`}
          </Typography>
        </div>
        <Divider orientation="vertical" />
      </Show>
      <ButtonGroup spacing={0}>
        <IconButton
          icon="NavigateBefore"
          aria-label="Previous Page"
          tooltip="Previous Page"
          variant="outlined"
          color="neutral"
          size="sm"
          disabled={sql`saving_annotations or saving_rotation`}
          onClick={runViewerCommand(props.handle, "previousPage")}
        />
        <IconButton
          icon="NavigateNext"
          aria-label="Next Page"
          tooltip="Next Page"
          variant="outlined"
          color="neutral"
          size="sm"
          disabled={sql`saving_annotations or saving_rotation`}
          onClick={runViewerCommand(props.handle, "nextPage")}
        />
      </ButtonGroup>
      <Show when={sql`${props.allowRotation ? 1 : 0} = 1`}>
        <ButtonGroup spacing={0}>
          <IconButton
            icon="RotateLeft"
            aria-label="Rotate Page Left"
            tooltip="Rotate Page Left"
            variant="outlined"
            color="neutral"
            size="sm"
            disabled={props.disabled
              ? sql`${props.disabled} or saving_rotation or saving_annotations`
              : sql`saving_rotation or saving_annotations`}
            onClick={runViewerCommand(props.handle, "rotateLeft")}
          />
          <IconButton
            icon="RotateRight"
            aria-label="Rotate Page Right"
            tooltip="Rotate Page Right"
            variant="outlined"
            color="neutral"
            size="sm"
            disabled={props.disabled
              ? sql`${props.disabled} or saving_rotation or saving_annotations`
              : sql`saving_rotation or saving_annotations`}
            onClick={runViewerCommand(props.handle, "rotateRight")}
          />
        </ButtonGroup>
      </Show>
      <Typography level="body-sm" className="px-2 min-w-20 text-center">
        {sql`current_page || ' / ' || case when page_count = 0 then '?' else page_count::string end`}
      </Typography>
      <ButtonGroup spacing={0}>
        <IconButton
          icon="ZoomOut"
          aria-label="Zoom Out"
          tooltip="Zoom Out (Ctrl+-)"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={runViewerCommand(props.handle, "zoomOut")}
        />
        <IconButton
          icon="ZoomIn"
          aria-label="Zoom In"
          tooltip="Zoom In (Ctrl+=)"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={runViewerCommand(props.handle, "zoomIn")}
        />
      </ButtonGroup>
      <Typography level="body-sm" className="px-1 min-w-12 text-center">
        {sql`zoom_percent::string || '%'`}
      </Typography>
      <ButtonGroup spacing={0}>
        <IconButton
          icon="FitScreen"
          aria-label="Fit Width"
          tooltip="Fit Width (Ctrl+2)"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={runViewerCommand(props.handle, "fitWidth")}
        />
        <IconButton
          icon="CropFree"
          aria-label="Fit Page"
          tooltip="Fit Page (Ctrl+0)"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={runViewerCommand(props.handle, "fitPage")}
        />
        <IconButton
          icon="CenterFocusStrong"
          aria-label="Actual Size"
          tooltip="Actual Size (Ctrl+1)"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={runViewerCommand(props.handle, "actualSize")}
        />
      </ButtonGroup>
      <Show when={sql`${props.allowDownloadFlattened ? 1 : 0} = 1`}>
        <Divider orientation="vertical" />
        <Button
          startIcon="Download"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={(s) => downloadFlattenedPdf(s, props.handle, props.fileName)}
        >
          Download Marked-Up PDF
        </Button>
      </Show>
    </>
  );
}

function PdfMarkupViewerToolbar(props: {
  handle: Sql;
  fileName?: Sql | string;
  allowDownloadFlattened?: boolean;
  workspace?: boolean;
  showDocumentNavigation?: boolean;
  allowRotation?: boolean;
}) {
  return (
    <div sx={styles.toolbar}>
      <PdfMarkupNavigationToolbar
        handle={props.handle}
        fileName={props.fileName}
        allowDownloadFlattened={props.allowDownloadFlattened}
        workspace={props.workspace}
        showDocumentNavigation={props.showDocumentNavigation}
        allowRotation={props.allowRotation}
      />
      <div className="grow" />
    </div>
  );
}

function saveEditorAnnotations(
  s: DomStatements,
  props: PdfMarkupEditorProps | PdfWorkspaceEditorProps,
  handle: Sql,
  onSuccess?: (s: DomStatements) => void,
) {
  s.returnIf(sql`saving_annotations`);
  s.setScalar("saving_annotations", true);
  s.setScalar("pdf_markup_error", sql.null);
  s.setScalar("save_message", sql.null);
  s.defScalar("pdf_markup_save_succeeded", sql`false`);
  s.commitUiTreeChanges();
  s.jsCall({
    module: "pdf_markup",
    exportName: "getAnnotations",
    handle,
    argJson: sql`json_build_object('handle', ${handle})`,
    resultJsonScalar: "pdf_markup_payload",
  });
  s.defScalar(
    "pdf_markup_result",
    sql`coalesce(pdf_markup_payload->'json', pdf_markup_payload)`,
  );
  s.if(
    sql`coalesce(try_cast(pdf_markup_result->>'success' as bool), false) = false`,
    (s) => {
      s.setScalar(
        "pdf_markup_error",
        sql`coalesce(pdf_markup_result->>'error', 'Viewer is not ready.')`,
      );
      s.setScalar("saving_annotations", false);
      s.return();
    },
  );
  s.tryServer({
    body: (s) => {
      props.onSave(s, createPdfMarkupSaveEvent(handle));
      s.setScalar("pdf_markup_save_succeeded", true);
    },
    errorName: "error",
    catch: (s) => {
      s.setScalar(
        "pdf_markup_error",
        sql`coalesce(error.message, 'Unable to save markups.')`,
      );
    },
    finally: (s) => {
      s.if(sql`pdf_markup_save_succeeded`, (s) => {
        s.jsCall({
          module: "pdf_markup",
          exportName: "markClean",
          handle,
          argJson: sql`json_build_object(
            'handle', ${handle},
            'revision', coalesce(
              try_cast(pdf_markup_result->>'revision' as int),
              current_revision
            ) + 1,
            'changeSequence', coalesce(
              try_cast(pdf_markup_result->>'changeSequence' as int),
              0
            )
          )`,
          resultJsonScalar: "pdf_markup_mark_clean_payload",
        });
        s.defScalar(
          "pdf_markup_mark_clean_result",
          sql`
            coalesce(
              pdf_markup_mark_clean_payload->'json',
              pdf_markup_mark_clean_payload
            )
          `,
        );
        s.setScalar(
          "current_revision",
          sql`
            coalesce(
              try_cast(pdf_markup_mark_clean_result->>'revision' as int),
              current_revision + 1
            )
          `,
        );
        s.if(
          sql`
            coalesce(
              try_cast(pdf_markup_mark_clean_result->>'clean' as bool),
              false
            )
          `,
          (s) => {
            s.setScalar("dirty", false);
            s.setScalar("save_message", sql.lit`Saved`);
            onSuccess?.(s);
          },
        ).else((s) => {
          s.setScalar("dirty", true);
          s.setScalar(
            "save_message",
            sql.lit`Saved; newer changes remain unsaved`,
          );
        });
      });
      s.setScalar("saving_annotations", false);
    },
  });
}

function PdfMarkupEditorToolbar(props: {
  handle: Sql;
  fileName?: Sql | string;
  allowDownloadFlattened?: boolean;
  tools: PdfMarkupTool[];
  disabled?: BooleanExpr;
  saveLabel: string;
  onSave: (s: DomStatements) => void;
  workspace?: boolean;
  showDocumentNavigation?: boolean;
  allowRotation?: boolean;
}) {
  return (
    <div sx={styles.toolbar}>
      <ButtonGroup spacing={0}>
        <Show when={sql`${props.tools.includes("hand") ? 1 : 0} = 1`}>
          <PdfMarkupToolButton
            handle={props.handle}
            tool="hand"
            icon="PanTool"
            label="Pan (H)"
            disabled={props.disabled}
          />
        </Show>
        <Show when={sql`${props.tools.includes("select") ? 1 : 0} = 1`}>
          <PdfMarkupToolButton
            handle={props.handle}
            tool="select"
            icon="OpenWith"
            label="Select (V)"
            disabled={props.disabled}
          />
        </Show>
        <Show when={sql`${props.tools.includes("pen") ? 1 : 0} = 1`}>
          <PdfMarkupToolButton
            handle={props.handle}
            tool="pen"
            icon="Draw"
            label="Pen"
            disabled={props.disabled}
          />
        </Show>
        <Show when={sql`${props.tools.includes("highlight") ? 1 : 0} = 1`}>
          <PdfMarkupToolButton
            handle={props.handle}
            tool="highlight"
            icon="Highlight"
            label="Highlight"
            disabled={props.disabled}
          />
        </Show>
        <Show when={sql`${props.tools.includes("text") ? 1 : 0} = 1`}>
          <PdfMarkupToolButton
            handle={props.handle}
            tool="text"
            icon="TextFields"
            label="Text Note"
            disabled={props.disabled}
          />
        </Show>
      </ButtonGroup>
      <Divider orientation="vertical" />
      <PdfMarkupNavigationToolbar
        handle={props.handle}
        fileName={props.fileName}
        allowDownloadFlattened={props.allowDownloadFlattened}
        workspace={props.workspace}
        showDocumentNavigation={props.showDocumentNavigation}
        allowRotation={props.allowRotation}
        disabled={props.disabled}
      />
      <Divider orientation="vertical" />
      <ButtonGroup spacing={0}>
        <IconButton
          icon="Undo"
          aria-label="Undo"
          tooltip="Undo"
          variant="outlined"
          color="neutral"
          size="sm"
          disabled={props.disabled
            ? sql`${props.disabled} or not can_undo`
            : sql`not can_undo`}
          onClick={runViewerCommand(props.handle, "undo")}
        />
        <IconButton
          icon="Redo"
          aria-label="Redo"
          tooltip="Redo"
          variant="outlined"
          color="neutral"
          size="sm"
          disabled={props.disabled
            ? sql`${props.disabled} or not can_redo`
            : sql`not can_redo`}
          onClick={runViewerCommand(props.handle, "redo")}
        />
        <IconButton
          icon="Delete"
          aria-label="Delete Selected"
          tooltip="Delete Selected"
          variant="outlined"
          color="neutral"
          size="sm"
          disabled={props.disabled
            ? sql`${props.disabled} or not has_selection`
            : sql`not has_selection`}
          onClick={runViewerCommand(props.handle, "deleteSelected")}
        />
      </ButtonGroup>
      <Divider orientation="vertical" />
      <PdfMarkupStyleControls
        handle={props.handle}
        disabled={props.disabled}
      />
      <div className="grow" />
      <Button
        startIcon="Save"
        loading={sql`saving_annotations`}
        disabled={props.disabled
          ? sql`${props.disabled} or not dirty`
          : sql`not dirty`}
        size="sm"
        onClick={props.onSave}
      >
        {props.saveLabel}
      </Button>
    </div>
  );
}

function PdfMarkupMount(props: {
  handle: Sql;
  containerId: Sql;
  fileUrl?: Sql | string;
  documents?: Sql;
  initialDocumentKey?: Sql | string;
  annotations?: Sql;
  initialPage?: Sql;
  initialFocus?: Sql;
  initialTool?: PdfMarkupTool;
  readOnly: boolean;
  height?: string;
  pdfJsUrl?: Sql | string;
  pdfJsWorkerUrl?: Sql | string;
  pdfJsWasmUrl?: Sql | string;
  fillAvailable?: boolean;
}) {
  return (
    <div
      id={props.containerId}
      sx={[
        styles.mount,
        props.fillAvailable
          ? styles.workspaceMount
          : props.height
          ? { height: props.height }
          : undefined,
      ]}
      onMount={(s) => {
        s.sleep(250);
        s.jsCall({
          module: "pdf_markup",
          exportName: "initialize",
          handle: props.handle,
          argJson: sql`json_build_object(
            'handle', ${props.handle},
            'elementId', ${props.containerId},
            'pdfUrl', ${toSql(props.fileUrl, "")},
            'documents', ${props.documents ?? sql.null},
            'initialDocumentKey', ${toSql(props.initialDocumentKey, "")},
            'pdfJsUrl', ${
            toSql(
              props.pdfJsUrl ??
                getModuleFileUrl("pdf_markup", "pdf.min.mjs"),
              "",
            )
          },
            'pdfJsWorkerUrl', ${
            toSql(
              props.pdfJsWorkerUrl ??
                getModuleFileUrl("pdf_markup", "pdf.worker.min.mjs"),
              "",
            )
          },
            'pdfJsWasmUrl', ${
            toSql(
              props.pdfJsWasmUrl ?? getModuleDirUrl("pdf_markup", "wasm/"),
              "",
            )
          },
            'annotations', ${annotationJson(props.annotations)},
            'page', ${props.initialPage ?? sql`1`},
            'evidenceFocus', ${props.initialFocus ?? sql.null},
            'tool', ${sql.lit(props.initialTool ?? "select")},
            'readOnly', ${props.readOnly ? sql`true` : sql`false`}
          )`,
        });
      }}
    />
  );
}

function PdfMarkupSurface(props: {
  handle: Sql;
  containerId: Sql;
  fileUrl?: Sql | string;
  documents?: Sql;
  initialDocumentKey?: Sql | string;
  annotations?: Sql;
  fileName?: Sql | string;
  initialPage?: Sql;
  initialFocus?: Sql;
  initialTool?: PdfMarkupTool;
  height?: string;
  className?: string;
  showToolbar: boolean;
  allowDownloadFlattened?: boolean;
  pdfJsUrl?: Sql | string;
  pdfJsWorkerUrl?: Sql | string;
  pdfJsWasmUrl?: Sql | string;
  readOnly: boolean;
  tools?: PdfMarkupTool[];
  disabled?: BooleanExpr;
  saveLabel?: string;
  onSave?: (s: DomStatements) => void;
  workspace?: boolean;
  showDocumentNavigation?: boolean;
  allowRotation?: boolean;
}) {
  const fillAvailable = props.workspace && props.height !== undefined;
  return (
    <div
      sx={[
        styles.frame,
        fillAvailable ? { height: props.height } : undefined,
      ]}
      className={props.className}
    >
      <Show when={sql`${props.showToolbar ? 1 : 0} = 1`}>
        {props.readOnly
          ? (
            <PdfMarkupViewerToolbar
              handle={props.handle}
              fileName={props.fileName}
              allowDownloadFlattened={props.allowDownloadFlattened}
              workspace={props.workspace}
              showDocumentNavigation={props.showDocumentNavigation}
              allowRotation={props.allowRotation}
            />
          )
          : (
            <PdfMarkupEditorToolbar
              handle={props.handle}
              fileName={props.fileName}
              allowDownloadFlattened={props.allowDownloadFlattened}
              tools={props.tools ?? DEFAULT_EDITOR_TOOLS}
              disabled={props.disabled}
              saveLabel={props.saveLabel ?? "Save Markups"}
              onSave={props.onSave ?? (() => {})}
              workspace={props.workspace}
              showDocumentNavigation={props.showDocumentNavigation}
              allowRotation={props.allowRotation}
            />
          )}
      </Show>
      <Show when={sql`pdf_markup_error is not null`}>
        <Alert color="danger" className="m-2">
          {sql`pdf_markup_error`}
        </Alert>
      </Show>
      <Show when={sql`save_message is not null and pdf_markup_error is null`}>
        <Alert color="success" className="m-2">
          {sql`save_message`}
        </Alert>
      </Show>
      <PdfMarkupMount
        handle={props.handle}
        containerId={props.containerId}
        fileUrl={props.fileUrl}
        documents={props.documents}
        initialDocumentKey={props.initialDocumentKey}
        annotations={props.annotations}
        initialPage={props.initialPage}
        initialFocus={props.initialFocus}
        initialTool={props.initialTool}
        readOnly={props.readOnly}
        height={fillAvailable ? undefined : props.height}
        fillAvailable={fillAvailable}
        pdfJsUrl={props.pdfJsUrl}
        pdfJsWorkerUrl={props.pdfJsWorkerUrl}
        pdfJsWasmUrl={props.pdfJsWasmUrl}
      />
    </div>
  );
}

function PdfMarkupData(props: {
  children: (handle: Sql, containerId: Sql) => JSX.Element;
  handle?: Sql | string;
  initialTool?: PdfMarkupTool;
  onReady?: PdfMarkupEventHandler;
  onPageChange?: PdfMarkupEventHandler;
  onDocumentChange?: PdfMarkupEventHandler;
  onChange?: PdfMarkupEventHandler;
  onError?: PdfMarkupEventHandler;
  onSaveRequested?: (s: DomStatements, handle: Sql) => void;
  onDocumentNavigationRequested?: (
    s: DomStatements,
    handle: Sql,
    targetDocumentIndex: Sql,
    targetPage: Sql,
  ) => void;
  onRotationChange?: PdfMarkupRotationHandler;
}) {
  const id = useUniqueId();
  const handle = props.handle
    ? (typeof props.handle === "string" ? sql.lit(props.handle) : props.handle)
    : sql.concat(id, sql.lit`-pdf-markup`);
  const containerId = sql.concat(id, sql.lit`-pdf-markup-mount`);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("active_tool", sql.lit(props.initialTool ?? "select"));
        s.defScalar("pen_color", sql.lit`#ef4444`);
        s.defScalar("pen_width", sql`2.5`);
        s.defScalar("highlight_color", sql.lit`#fde047`);
        s.defScalar("highlight_width", sql`12`);
        s.defScalar("highlight_opacity", sql`0.36`);
        s.defScalar("text_color", sql.lit`#0f172a`);
        s.defScalar("text_font_size", sql`13`);
        s.defScalar("selected_markup_tool", {
          type: { type: "String", maxLength: 20 },
        });
        s.defScalar("has_selection", sql`false`);
        s.defScalar("can_undo", sql`false`);
        s.defScalar("can_redo", sql`false`);
        s.defScalar("dirty", sql`false`);
        s.defScalar("saving_annotations", sql`false`);
        s.defScalar("saving_rotation", sql`false`);
        s.defScalar("current_page", sql`1`);
        s.defScalar("page_count", sql`0`);
        s.defScalar("zoom_percent", sql`100`);
        s.defScalar("current_document_key", {
          type: { type: "String", maxLength: 500 },
          expr: sql.lit``,
        });
        s.defScalar("current_file_item_id", {
          type: { type: "String", maxLength: 30 },
          expr: sql.lit``,
        });
        s.defScalar("current_file_name", {
          type: { type: "String", maxLength: 500 },
          expr: sql.lit``,
        });
        s.defScalar("document_index", sql`0`);
        s.defScalar("document_count", sql`0`);
        s.defScalar("current_revision", sql`0`);
        s.defScalar("current_document_context_key", {
          type: { type: "String", maxLength: 100 },
          expr: sql.lit``,
        });
        s.defScalar("current_document_can_edit", sql`false`);
        s.defScalar("pdf_markup_error", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("save_message", {
          type: { type: "String", maxLength: 100 },
        });
      }}
    >
      <div
        js={{
          handles: [{
            module: "pdf_markup",
            cleanup: "cleanup",
            handle,
          }],
          on: {
            "pdf_markup.ready": (s) => {
              s.setScalar("pdf_markup_error", sql.null);
              s.setScalar(
                "page_count",
                sql`coalesce(try_cast(event.payload_json->>'pageCount' as int), 0)`,
              );
              s.setScalar(
                "current_page",
                sql`coalesce(try_cast(event.payload_json->>'page' as int), 1)`,
              );
              s.setScalar(
                "zoom_percent",
                sql`coalesce(try_cast(event.payload_json->>'zoomPercent' as int), zoom_percent)`,
              );
              s.setScalar(
                "current_document_key",
                sql`coalesce(event.payload_json->>'documentKey', '')`,
              );
              s.setScalar(
                "current_file_item_id",
                sql`coalesce(event.payload_json->>'fileItemId', '')`,
              );
              s.setScalar(
                "current_file_name",
                sql`coalesce(event.payload_json->>'fileName', '')`,
              );
              s.setScalar(
                "document_index",
                sql`coalesce(try_cast(event.payload_json->>'documentIndex' as int), 0)`,
              );
              s.setScalar(
                "document_count",
                sql`coalesce(try_cast(event.payload_json->>'documentCount' as int), 0)`,
              );
              s.setScalar(
                "current_revision",
                sql`coalesce(try_cast(event.payload_json->>'revision' as int), 0)`,
              );
              s.setScalar(
                "current_document_context_key",
                sql`coalesce(event.payload_json->>'contextKey', '')`,
              );
              s.setScalar(
                "current_document_can_edit",
                sql`coalesce(try_cast(event.payload_json->>'canEdit' as bool), true)`,
              );
              if (props.onReady) {
                props.onReady(s, createPdfMarkupEvent(handle));
              }
            },
            "pdf_markup.zoomChanged": (s) => {
              s.setScalar(
                "zoom_percent",
                sql`coalesce(try_cast(event.payload_json->>'zoomPercent' as int), zoom_percent)`,
              );
            },
            "pdf_markup.toolChanged": (s) => {
              s.setScalar(
                "active_tool",
                sql`coalesce(event.payload_json->>'tool', active_tool)`,
              );
              s.setScalar("selected_markup_tool", sql.null);
              s.setScalar("has_selection", false);
            },
            "pdf_markup.pageChanged": (s) => {
              s.setScalar(
                "page_count",
                sql`coalesce(try_cast(event.payload_json->>'pageCount' as int), page_count)`,
              );
              s.setScalar(
                "current_page",
                sql`coalesce(try_cast(event.payload_json->>'page' as int), current_page)`,
              );
              if (props.onPageChange) {
                props.onPageChange(s, createPdfMarkupEvent(handle));
              }
            },
            "pdf_markup.documentChanged": (s) => {
              s.setScalar("pdf_markup_error", sql.null);
              s.setScalar("dirty", sql`false`);
              s.setScalar(
                "page_count",
                sql`coalesce(try_cast(event.payload_json->>'pageCount' as int), 0)`,
              );
              s.setScalar(
                "current_page",
                sql`coalesce(try_cast(event.payload_json->>'page' as int), 1)`,
              );
              s.setScalar(
                "current_document_key",
                sql`coalesce(event.payload_json->>'documentKey', '')`,
              );
              s.setScalar(
                "current_file_item_id",
                sql`coalesce(event.payload_json->>'fileItemId', '')`,
              );
              s.setScalar(
                "current_file_name",
                sql`coalesce(event.payload_json->>'fileName', '')`,
              );
              s.setScalar(
                "document_index",
                sql`coalesce(try_cast(event.payload_json->>'documentIndex' as int), 0)`,
              );
              s.setScalar(
                "document_count",
                sql`coalesce(try_cast(event.payload_json->>'documentCount' as int), 0)`,
              );
              s.setScalar(
                "current_revision",
                sql`coalesce(try_cast(event.payload_json->>'revision' as int), 0)`,
              );
              s.setScalar(
                "current_document_context_key",
                sql`coalesce(event.payload_json->>'contextKey', '')`,
              );
              s.setScalar(
                "current_document_can_edit",
                sql`coalesce(try_cast(event.payload_json->>'canEdit' as bool), true)`,
              );
              s.setScalar("can_undo", false);
              s.setScalar("can_redo", false);
              s.setScalar("has_selection", false);
              if (props.onDocumentChange) {
                props.onDocumentChange(s, createPdfMarkupEvent(handle));
              }
            },
            "pdf_markup.changed": (s) => {
              s.setScalar("dirty", true);
              s.setScalar(
                "can_undo",
                sql`coalesce(try_cast(event.payload_json->>'canUndo' as bool), can_undo)`,
              );
              s.setScalar(
                "can_redo",
                sql`coalesce(try_cast(event.payload_json->>'canRedo' as bool), can_redo)`,
              );
              s.setScalar("save_message", sql.null);
              if (props.onChange) {
                props.onChange(s, createPdfMarkupEvent(handle));
              }
            },
            "pdf_markup.saveRequested": (s) => {
              if (props.onSaveRequested) {
                props.onSaveRequested(s, handle);
              }
            },
            "pdf_markup.documentNavigationRequested": (s) => {
              if (props.onDocumentNavigationRequested) {
                props.onDocumentNavigationRequested(
                  s,
                  handle,
                  sql`try_cast(event.payload_json->>'targetDocumentIndex' as int)`,
                  sql`event.payload_json->'targetPage'`,
                );
              }
            },
            "pdf_markup.rotationChanged": (s) => {
              if (props.onRotationChange) {
                s.returnIf(sql`saving_rotation`);
                s.setScalar("saving_rotation", true);
                s.setScalar("pdf_markup_error", sql.null);
                s.setScalar("save_message", sql.null);
                s.defScalar("rotation_save_succeeded", sql`false`);
                s.tryServer({
                  body: (s) => {
                    props.onRotationChange!(
                      s,
                      createPdfMarkupRotationEvent(handle),
                    );
                    s.setScalar("rotation_save_succeeded", true);
                    s.setScalar("save_message", sql.lit`Rotation saved`);
                  },
                  errorName: "rotation_save_error",
                  catch: (s) => {
                    s.setScalar(
                      "pdf_markup_error",
                      sql`coalesce(rotation_save_error.message, 'Unable to save page rotation.')`,
                    );
                  },
                  finally: (s) => {
                    s.if(sql`rotation_save_succeeded`, (s) => {
                      s.jsCall({
                        module: "pdf_markup",
                        exportName: "completeRotation",
                        handle,
                        argJson: sql`json_build_object(
                          'handle', ${handle},
                          'requestId', coalesce(
                            event.payload_json->>'requestId',
                            ''
                          )
                        )`,
                      });
                    }).else((s) => {
                      s.jsCall({
                        module: "pdf_markup",
                        exportName: "rejectRotation",
                        handle,
                        argJson: sql`json_build_object(
                          'handle', ${handle},
                          'requestId', coalesce(
                            event.payload_json->>'requestId',
                            ''
                          )
                        )`,
                      });
                    });
                    s.setScalar("saving_rotation", false);
                  },
                });
              }
            },
            "pdf_markup.selectionChanged": (s) => {
              s.setScalar(
                "has_selection",
                sql`coalesce(try_cast(event.payload_json->>'selected' as bool), false)`,
              );
              s.setScalar(
                "selected_markup_tool",
                sql`event.payload_json->>'tool'`,
              );
              s.if(sql`event.payload_json->>'tool' = 'pen'`, (s) => {
                s.setScalar(
                  "pen_color",
                  sql`coalesce(event.payload_json->>'color', pen_color)`,
                );
                s.setScalar(
                  "pen_width",
                  sql`coalesce(try_cast(event.payload_json->>'strokeWidth' as double), pen_width)`,
                );
              });
              s.if(sql`event.payload_json->>'tool' = 'highlight'`, (s) => {
                s.setScalar(
                  "highlight_color",
                  sql`coalesce(event.payload_json->>'color', highlight_color)`,
                );
                s.setScalar(
                  "highlight_width",
                  sql`coalesce(try_cast(event.payload_json->>'strokeWidth' as double), highlight_width)`,
                );
                s.setScalar(
                  "highlight_opacity",
                  sql`coalesce(try_cast(event.payload_json->>'opacity' as double), highlight_opacity)`,
                );
              });
              s.if(sql`event.payload_json->>'tool' = 'text'`, (s) => {
                s.setScalar(
                  "text_color",
                  sql`coalesce(event.payload_json->>'color', text_color)`,
                );
                s.setScalar(
                  "text_font_size",
                  sql`coalesce(try_cast(event.payload_json->>'fontSize' as double), text_font_size)`,
                );
              });
            },
            "pdf_markup.error": (s) => {
              s.setScalar(
                "pdf_markup_error",
                sql`coalesce(event.payload_json->>'message', 'Unable to load PDF markup viewer.')`,
              );
              if (props.onError) {
                props.onError(s, createPdfMarkupEvent(handle));
              }
            },
          },
        }}
      >
        {props.children(handle, containerId)}
      </div>
    </Data>
  );
}

export function PdfMarkupViewer(props: PdfMarkupViewerProps) {
  useJsModule("pdf_markup");
  return (
    <PdfMarkupData
      handle={props.handle}
      initialTool="hand"
      onReady={props.onReady}
      onPageChange={props.onPageChange}
      onError={props.onError}
    >
      {(handle, containerId) => (
        <PdfMarkupSurface
          handle={handle}
          containerId={containerId}
          fileUrl={props.fileUrl}
          annotations={props.annotations}
          fileName={props.fileName}
          initialPage={props.initialPage}
          initialFocus={props.initialFocus}
          initialTool="hand"
          height={props.height}
          className={props.className}
          showToolbar={props.showToolbar ?? true}
          allowDownloadFlattened={props.allowDownloadFlattened}
          pdfJsUrl={props.pdfJsUrl}
          pdfJsWorkerUrl={props.pdfJsWorkerUrl}
          pdfJsWasmUrl={props.pdfJsWasmUrl}
          readOnly
        />
      )}
    </PdfMarkupData>
  );
}

export function PdfMarkupEditor(props: PdfMarkupEditorProps) {
  useJsModule("pdf_markup");
  return (
    <PdfMarkupData
      handle={props.handle}
      initialTool={props.initialTool ?? "select"}
      onReady={props.onReady}
      onPageChange={props.onPageChange}
      onChange={props.onChange}
      onError={props.onError}
      onSaveRequested={(s, handle) => saveEditorAnnotations(s, props, handle)}
    >
      {(handle, containerId) => (
        <PdfMarkupSurface
          handle={handle}
          containerId={containerId}
          fileUrl={props.fileUrl}
          annotations={props.annotations}
          fileName={props.fileName}
          initialPage={props.initialPage}
          initialFocus={props.initialFocus}
          initialTool={props.initialTool ?? "select"}
          height={props.height}
          className={props.className}
          showToolbar={props.showToolbar ?? true}
          allowDownloadFlattened={props.allowDownloadFlattened}
          pdfJsUrl={props.pdfJsUrl}
          pdfJsWorkerUrl={props.pdfJsWorkerUrl}
          pdfJsWasmUrl={props.pdfJsWasmUrl}
          readOnly={false}
          tools={props.tools}
          disabled={props.disabled}
          saveLabel={props.saveLabel}
          onSave={(s) => saveEditorAnnotations(s, props, handle)}
        />
      )}
    </PdfMarkupData>
  );
}

/** Renders an ordered PDF workspace while loading only one document at a time. */
export function PdfWorkspaceViewer(props: PdfWorkspaceViewerProps) {
  useJsModule("pdf_markup");
  return (
    <PdfMarkupData
      handle={props.handle}
      initialTool="hand"
      onReady={props.onReady}
      onPageChange={props.onPageChange}
      onDocumentChange={props.onDocumentChange}
      onError={props.onError}
    >
      {(handle, containerId) => (
        <PdfMarkupSurface
          handle={handle}
          containerId={containerId}
          documents={props.documents}
          initialDocumentKey={props.initialDocumentKey}
          initialPage={props.initialPage}
          initialFocus={props.initialFocus}
          fileName={sql`current_file_name`}
          initialTool="hand"
          height={props.height}
          className={props.className}
          showToolbar={props.showToolbar ?? true}
          allowDownloadFlattened={props.allowDownloadFlattened}
          pdfJsUrl={props.pdfJsUrl}
          pdfJsWorkerUrl={props.pdfJsWorkerUrl}
          pdfJsWasmUrl={props.pdfJsWasmUrl}
          readOnly
          workspace
          showDocumentNavigation={props.showDocumentNavigation}
          allowRotation={props.allowRotation}
        />
      )}
    </PdfMarkupData>
  );
}

/**
 * Edits an ordered PDF workspace and saves the active document before
 * switching when it has unsaved annotations.
 */
export function PdfWorkspaceEditor(props: PdfWorkspaceEditorProps) {
  useJsModule("pdf_markup");
  const disabled = props.disabled
    ? sql`${props.disabled} or not current_document_can_edit`
    : sql`not current_document_can_edit`;
  return (
    <PdfMarkupData
      handle={props.handle}
      initialTool={props.initialTool ?? "select"}
      onReady={props.onReady}
      onPageChange={props.onPageChange}
      onDocumentChange={props.onDocumentChange}
      onChange={props.onChange}
      onError={props.onError}
      onRotationChange={props.onRotationChange}
      onSaveRequested={(s, handle) => saveEditorAnnotations(s, props, handle)}
      onDocumentNavigationRequested={(
        s,
        handle,
        targetDocumentIndex,
        targetPage,
      ) =>
        saveEditorAnnotations(s, props, handle, (s) => {
          s.jsCall({
            module: "pdf_markup",
            exportName: "completeDocumentNavigation",
            handle,
            argJson: sql`json_build_object(
              'handle', ${handle},
              'targetDocumentIndex', ${targetDocumentIndex},
              'targetPage', ${targetPage}
            )`,
          });
        })}
    >
      {(handle, containerId) => (
        <PdfMarkupSurface
          handle={handle}
          containerId={containerId}
          documents={props.documents}
          initialDocumentKey={props.initialDocumentKey}
          initialPage={props.initialPage}
          initialFocus={props.initialFocus}
          fileName={sql`current_file_name`}
          initialTool={props.initialTool ?? "select"}
          height={props.height}
          className={props.className}
          showToolbar={props.showToolbar ?? true}
          allowDownloadFlattened={props.allowDownloadFlattened}
          pdfJsUrl={props.pdfJsUrl}
          pdfJsWorkerUrl={props.pdfJsWorkerUrl}
          pdfJsWasmUrl={props.pdfJsWasmUrl}
          readOnly={false}
          tools={props.tools}
          disabled={disabled}
          saveLabel={props.saveLabel}
          onSave={(s) => saveEditorAnnotations(s, props, handle)}
          workspace
          showDocumentNavigation={props.showDocumentNavigation}
          allowRotation={props.onRotationChange !== undefined}
        />
      )}
    </PdfMarkupData>
  );
}
