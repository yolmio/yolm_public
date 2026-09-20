import type { StyleObject } from "std/style_types";
import { cssVar } from "std/style_utils";

/** Presentation for DOM rendered by the file decoders. JS supplies only part names and geometry. */
export const filePreviewStyles: StyleObject = {
  "--preview-row-height": "28px",
  "--preview-row-header-width": "54px",
  "--preview-column-width": "140px",
  '& [data-preview-part="tiff-mount"]': {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "0",
  },
  '& [data-preview-part="tiff-viewport"]': {
    alignItems: "center",
    background: cssVar("palette-background-level3"),
    display: "flex",
    flex: "1",
    justifyContent: "center",
    minHeight: "0",
    overflow: "hidden",
    position: "relative",
    touchAction: "none",
  },
  '& [data-preview-part="tiff-canvas"]': {
    boxShadow: cssVar("shadow-md"),
    maxHeight: "calc(100% - 2rem)",
    maxWidth: "calc(100% - 2rem)",
    transformOrigin: "center center",
    userSelect: "none",
  },
  '& [data-preview-part="sheet-mount"]': {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "0",
  },
  '& [data-preview-part="sheet-viewport"]': {
    background: cssVar("palette-background-surface"),
    flex: "1",
    minHeight: "0",
    overflow: "auto",
    position: "relative",
  },
  '& [data-preview-part="sheet-spacer"]': { position: "relative" },
  '& [data-preview-part="sheet-header"]': {
    background: cssVar("palette-background-level1"),
    borderBottom: `1px solid ${cssVar("palette-divider")}`,
    display: "flex",
    height: "var(--preview-row-height)",
    left: "0",
    position: "sticky",
    top: "0",
    width: "100%",
    zIndex: "3",
  },
  '& [data-preview-part="sheet-row"]': {
    display: "flex",
    height: "var(--preview-row-height)",
    left: "0",
    position: "absolute",
    top: "var(--preview-row-top)",
    width: "100%",
  },
  '& [data-preview-part="sheet-cell"]': {
    alignItems: "center",
    background: cssVar("palette-background-surface"),
    borderBottom: `1px solid ${cssVar("palette-divider")}`,
    borderRight: `1px solid ${cssVar("palette-divider")}`,
    color: cssVar("palette-text-primary"),
    display: "flex",
    flex: "0 0 var(--preview-cell-width)",
    font: "12px system-ui, sans-serif",
    overflow: "hidden",
    py: 0,
    px: "0.45rem",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "var(--preview-cell-width)",
    boxSizing: "border-box",
  },
  '& [data-preview-part="zip-mount"]': {
    background: cssVar("palette-background-body"),
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "0",
  },
  '& [data-preview-part="zip-list"]': {
    flex: "1",
    minHeight: "0",
    overflow: "auto",
    padding: "0.5rem",
  },
  '& [data-preview-part="zip-row"]': {
    alignItems: "center",
    background: cssVar("palette-background-surface"),
    borderBottom: `1px solid ${cssVar("palette-divider")}`,
    color: cssVar("palette-text-primary"),
    display: "grid",
    font: "13px system-ui",
    gap: "0.5rem",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    minHeight: "2.35rem",
    py: "0.35rem",
    px: "0.65rem",
  },
  '& [data-preview-part="zip-name"]': {
    overflow: "hidden",
    paddingLeft: "calc(var(--preview-depth) * 1.1rem)",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  '& [data-preview-part="zip-empty"]': {
    color: cssVar("palette-text-secondary"),
    padding: "2rem",
    textAlign: "center",
  },
  '& [data-preview-part="docx-mount"]': {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "0",
  },
  '& [data-preview-part="docx-frame"]': {
    border: "0",
    flex: "1",
    minHeight: "0",
    width: "100%",
  },
  '& [data-preview-part="signature-term"]': {
    color: cssVar("palette-text-secondary"),
    fontWeight: "600",
  },
  '& [data-preview-part="signature-detail"]': {
    margin: "0",
    overflowWrap: "anywhere",
  },
  '& [data-preview-part="signature-mount"]': {
    background: cssVar("palette-background-level1"),
    height: "100%",
    minHeight: "0",
    overflow: "auto",
    padding: "1rem",
  },
  '& [data-preview-part="signature-card"]': {
    background: cssVar("palette-background-surface"),
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: "0.5rem",
    color: cssVar("palette-text-primary"),
    my: 0,
    mx: "auto",
    maxWidth: "74rem",
    overflow: "hidden",
  },
  '& [data-preview-part="signature-status"]': {
    display: "grid",
    gap: "0.5rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
    padding: "1rem",
  },
  '& [data-preview-part="signature-notice"]': {
    background: cssVar("palette-warning-soft-bg"),
    borderBottom: `1px solid ${cssVar("palette-warning-outlined-border")}`,
    borderTop: `1px solid ${cssVar("palette-warning-outlined-border")}`,
    color: cssVar("palette-warning-soft-color"),
    font: "12px/1.45 system-ui",
    py: "0.6rem",
    px: "1rem",
  },
  '& [data-preview-part="signature-badge"]': {
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: "0.4rem",
    py: "0.65rem",
    px: "0.75rem",
  },
  '& [data-preview-part="signature-label"]': {
    color: cssVar("palette-text-secondary"),
    font: "12px system-ui",
  },
  '& [data-preview-part="signature-result"]': {
    color: "inherit",
    font: "650 15px system-ui",
    marginTop: "0.2rem",
  },
  '& [data-preview-part="signature-section"]': {
    borderBottom: `1px solid ${cssVar("palette-divider")}`,
    padding: "1rem",
  },
  '& [data-preview-part="signature-heading"]': {
    font: "650 15px system-ui",
    margin: 0,
    mb: "0.75rem",
  },
  '& [data-preview-part="signature-fields"]': {
    display: "grid",
    font: "13px/1.45 system-ui",
    gap: "0.45rem 0.8rem",
    gridTemplateColumns: "8rem minmax(0, 1fr)",
    margin: "0",
  },
  '& [data-preview-part="signature-content"]': {
    minHeight: "8rem",
    padding: "1rem",
  },
  '& [data-preview-part="signature-content-heading"]': {
    font: "650 15px system-ui",
    margin: 0,
    mb: "0.75rem",
  },
  '& [data-preview-part="signature-empty"]': {
    color: cssVar("palette-text-secondary"),
    font: "13px/1.5 system-ui",
  },
  '& [data-preview-part="signature-file"]': {
    alignItems: "center",
    display: "flex",
    gap: "0.75rem",
    marginBottom: "0.75rem",
  },
  '& [data-preview-part="signature-file-detail"]': {
    color: cssVar("palette-text-secondary"),
    font: "12px system-ui",
  },
  '& [data-preview-part="signature-pdf"]': {
    border: `1px solid ${cssVar("palette-divider")}`,
    height: "65vh",
    width: "100%",
  },
  '& [data-preview-part="signature-text"]': {
    background: cssVar("palette-background-body"),
    border: `1px solid ${cssVar("palette-divider")}`,
    font: "13px/1.5 ui-monospace, monospace",
    margin: "0",
    maxHeight: "32rem",
    overflow: "auto",
    padding: "0.75rem",
    whiteSpace: "pre-wrap",
  },
  '& [data-preview-part="signature-truncated"]': {
    color: cssVar("palette-text-secondary"),
    font: "12px system-ui",
  },

  '& [data-preview-part="tiff-viewport"][data-zoomed="true"]': {
    cursor: "grab",
  },
  '& [data-preview-part="sheet-cell"][data-header="true"]': {
    background: cssVar("palette-background-level1"),
    color: cssVar("palette-text-secondary"),
    fontWeight: 600,
  },
  '& [data-preview-part="zip-detail"]': {
    color: cssVar("palette-text-secondary"),
  },
  '& [data-preview-tone="success"]': {
    color: cssVar("palette-success-plain-color"),
  },
  '& [data-preview-tone="danger"]': {
    color: cssVar("palette-danger-plain-color"),
  },
  '& [data-preview-tone="warning"]': {
    color: cssVar("palette-warning-plain-color"),
  },
  '& [data-preview-tone="primary"]': {
    color: cssVar("palette-primary-plain-color"),
  },
  '& [data-preview-tone="neutral"]': {
    color: cssVar("palette-text-secondary"),
  },
};

/** Passed into the sandboxed Word preview; it cannot inherit the parent stylesheet. */
export const filePreviewDocumentCss = `
html{background:var(--palette-background-level1)}
body{box-sizing:border-box;background:var(--palette-background-surface);color:var(--palette-text-primary);font:15px/1.55 system-ui,sans-serif;margin:24px auto;max-width:850px;min-height:calc(100vh - 48px);padding:54px 64px;overflow-wrap:anywhere;box-shadow:var(--shadow-sm)}
img{height:auto;max-width:100%}
table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}
td,th{border:1px solid var(--palette-divider);padding:.3rem .45rem;vertical-align:top}
pre{white-space:pre-wrap}
@media(max-width:700px){body{margin:0;padding:24px;box-shadow:none}}
`;
