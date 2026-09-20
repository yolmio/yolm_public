import type { CSSObjectWithVars } from "./types";
import { TW_VAR } from "./constants";

export const staticClasses: Record<string, CSSObjectWithVars> = {
  // Display
  block: { display: "block" },
  "inline-block": { display: "inline-block" },
  inline: { display: "inline" },
  flex: { display: "flex" },
  "inline-flex": { display: "inline-flex" },
  table: { display: "table" },
  "inline-table": { display: "inline-table" },
  "table-caption": { display: "table-caption" },
  "table-cell": { display: "table-cell" },
  "table-column": { display: "table-column" },
  "table-column-group": { display: "table-column-group" },
  "table-footer-group": { display: "table-footer-group" },
  "table-header-group": { display: "table-header-group" },
  "table-row-group": { display: "table-row-group" },
  "table-row": { display: "table-row" },
  "flow-root": { display: "flow-root" },
  grid: { display: "grid" },
  "inline-grid": { display: "inline-grid" },
  contents: { display: "contents" },
  "list-item": { display: "list-item" },
  hidden: { display: "none" },

  // Table layout
  "table-auto": { tableLayout: "auto" },
  "table-fixed": { tableLayout: "fixed" },

  // Table border utilities (NEW)
  "border-collapse": { borderCollapse: "collapse" },
  "border-separate": { borderCollapse: "separate" },

  // Caption utilities (NEW)
  "caption-top": { captionSide: "top" },
  "caption-bottom": { captionSide: "bottom" },

  // Position
  static: { position: "static" },
  fixed: { position: "fixed" },
  absolute: { position: "absolute" },
  relative: { position: "relative" },
  sticky: { position: "sticky" },

  // Visibility
  visible: { visibility: "visible" },
  invisible: { visibility: "hidden" },
  collapse: { visibility: "collapse" },

  // Overflow
  "overflow-auto": { overflow: "auto" },
  "overflow-hidden": { overflow: "hidden" },
  "overflow-clip": { overflow: "clip" },
  "overflow-visible": { overflow: "visible" },
  "overflow-scroll": { overflow: "scroll" },
  "overflow-x-auto": { overflowX: "auto" },
  "overflow-y-auto": { overflowY: "auto" },
  "overflow-x-hidden": { overflowX: "hidden" },
  "overflow-y-hidden": { overflowY: "hidden" },
  "overflow-x-clip": { overflowX: "clip" },
  "overflow-y-clip": { overflowY: "clip" },
  "overflow-x-visible": { overflowX: "visible" },
  "overflow-y-visible": { overflowY: "visible" },
  "overflow-x-scroll": { overflowX: "scroll" },
  "overflow-y-scroll": { overflowY: "scroll" },

  // Isolation
  isolate: { isolation: "isolate" },
  "isolation-auto": { isolation: "auto" },

  // Flexbox Layout
  "flex-row": { flexDirection: "row" },
  "flex-row-reverse": { flexDirection: "row-reverse" },
  "flex-col": { flexDirection: "column" },
  "flex-col-reverse": { flexDirection: "column-reverse" },
  "flex-wrap": { flexWrap: "wrap" },
  "flex-wrap-reverse": { flexWrap: "wrap-reverse" },
  "flex-nowrap": { flexWrap: "nowrap" },
  "flex-1": { flex: "1 1 0%" },
  "flex-auto": { flex: "1 1 auto" },
  "flex-initial": { flex: "0 1 auto" },
  "flex-none": { flex: "none" },
  grow: { flexGrow: 1 },
  "grow-0": { flexGrow: 0 },
  shrink: { flexShrink: 1 },
  "shrink-0": { flexShrink: 0 },

  // Grid Layout
  "grid-flow-row": { gridAutoFlow: "row" },
  "grid-flow-col": { gridAutoFlow: "column" },
  "grid-flow-dense": { gridAutoFlow: "dense" },
  "grid-flow-row-dense": { gridAutoFlow: "row dense" },
  "grid-flow-col-dense": { gridAutoFlow: "column dense" },
  subgrid: { gridTemplateColumns: "subgrid", gridTemplateRows: "subgrid" },

  // Order
  "order-first": { order: -9999 },
  "order-last": { order: 9999 },
  "order-none": { order: 0 },

  // Object Fit & Position
  "object-contain": { objectFit: "contain" },
  "object-cover": { objectFit: "cover" },
  "object-fill": { objectFit: "fill" },
  "object-none": { objectFit: "none" },
  "object-scale-down": { objectFit: "scale-down" },
  "object-bottom": { objectPosition: "bottom" },
  "object-center": { objectPosition: "center" },
  "object-left": { objectPosition: "left" },
  "object-left-bottom": { objectPosition: "left bottom" },
  "object-left-top": { objectPosition: "left top" },
  "object-right": { objectPosition: "right" },
  "object-right-bottom": { objectPosition: "right bottom" },
  "object-right-top": { objectPosition: "right top" },
  "object-top": { objectPosition: "top" },

  // Font Smoothing & Style
  antialiased: {
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  },
  "subpixel-antialiased": {
    WebkitFontSmoothing: "auto",
    MozOsxFontSmoothing: "auto",
  },
  italic: { fontStyle: "italic" },
  "not-italic": { fontStyle: "normal" },

  // Text Alignment, Decoration, Transform
  "text-left": { textAlign: "left" },
  "text-center": { textAlign: "center" },
  "text-right": { textAlign: "right" },
  "text-justify": { textAlign: "justify" },
  "text-start": { textAlign: "start" },
  "text-end": { textAlign: "end" },
  underline: { textDecorationLine: "underline" },
  overline: { textDecorationLine: "overline" },
  "line-through": { textDecorationLine: "line-through" },
  "no-underline": { textDecorationLine: "none" },
  uppercase: { textTransform: "uppercase" },
  lowercase: { textTransform: "lowercase" },
  capitalize: { textTransform: "capitalize" },
  "normal-case": { textTransform: "none" },

  // Text Overflow, Whitespace, Word Break, Wrap
  truncate: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  "text-ellipsis": { textOverflow: "ellipsis" },
  "text-clip": { textOverflow: "clip" },
  "whitespace-normal": { whiteSpace: "normal" },
  "whitespace-nowrap": { whiteSpace: "nowrap" },
  "whitespace-pre": { whiteSpace: "pre" },
  "whitespace-pre-line": { whiteSpace: "pre-line" },
  "whitespace-pre-wrap": { whiteSpace: "pre-wrap" },
  "break-normal": { overflowWrap: "normal", wordBreak: "normal" },
  "break-words": { overflowWrap: "break-word" },
  "break-all": { wordBreak: "break-all" },
  "break-keep": { wordBreak: "keep-all" },
  "text-wrap": { textWrap: "wrap" },
  "text-nowrap": { textWrap: "nowrap" },
  "text-balance": { textWrap: "balance" },
  "text-pretty": { textWrap: "pretty" },

  // Box decoration break (NEW)
  "decoration-slice": { boxDecorationBreak: "slice" },
  "decoration-clone": { boxDecorationBreak: "clone" },

  // Hyphens (NEW)
  "hyphens-none": { hyphens: "none" },
  "hyphens-manual": { hyphens: "manual" },
  "hyphens-auto": { hyphens: "auto" },

  // Border Style
  "border-solid": { borderStyle: "solid" },
  "border-dashed": { borderStyle: "dashed" },
  "border-dotted": { borderStyle: "dotted" },
  "border-double": { borderStyle: "double" },
  "border-hidden": { borderStyle: "hidden" },
  "border-none": { borderStyle: "none" },

  // Appearance, Pointer Events, Resize
  "appearance-none": { appearance: "none" },
  "appearance-auto": { appearance: "auto" },
  "pointer-events-none": { pointerEvents: "none" },
  "pointer-events-auto": { pointerEvents: "auto" },
  "resize-none": { resize: "none" },
  "resize-y": { resize: "vertical" },
  "resize-x": { resize: "horizontal" },
  resize: { resize: "both" },

  // List style
  "list-none": { listStyleType: "none" },
  "list-disc": { listStyleType: "disc" },
  "list-decimal": { listStyleType: "decimal" },
  "list-inside": { listStylePosition: "inside" },
  "list-outside": { listStylePosition: "outside" },

  // Scroll Behavior, Snap Align/Stop/Type
  "scroll-auto": { scrollBehavior: "auto" },
  "scroll-smooth": { scrollBehavior: "smooth" },
  "snap-start": { scrollSnapAlign: "start" },
  "snap-end": { scrollSnapAlign: "end" },
  "snap-center": { scrollSnapAlign: "center" },
  "snap-align-none": { scrollSnapAlign: "none" },
  "snap-normal": { scrollSnapStop: "normal" },
  "snap-always": { scrollSnapStop: "always" },
  "snap-none": { scrollSnapType: "none" },
  "snap-x": {
    scrollSnapType: `x var(${TW_VAR.SCROLL_SNAP_STRICTNESS}, proximity)`,
  },
  "snap-y": {
    scrollSnapType: `y var(${TW_VAR.SCROLL_SNAP_STRICTNESS}, proximity)`,
  },
  "snap-both": {
    scrollSnapType: `both var(${TW_VAR.SCROLL_SNAP_STRICTNESS}, proximity)`,
  },
  "snap-mandatory": {
    [TW_VAR.SCROLL_SNAP_STRICTNESS]: "mandatory",
  },
  "snap-proximity": {
    [TW_VAR.SCROLL_SNAP_STRICTNESS]: "proximity",
  },

  // Touch Action
  "touch-auto": { touchAction: "auto" },
  "touch-none": { touchAction: "none" },
  "touch-pan-x": { touchAction: "pan-x" },
  "touch-pan-left": { touchAction: "pan-left" },
  "touch-pan-right": { touchAction: "pan-right" },
  "touch-pan-y": { touchAction: "pan-y" },
  "touch-pan-up": { touchAction: "pan-up" },
  "touch-pan-down": { touchAction: "pan-down" },
  "touch-pinch-zoom": { touchAction: "pinch-zoom" },
  "touch-manipulation": { touchAction: "manipulation" },

  // User Select
  "select-none": { userSelect: "none" },
  "select-text": { userSelect: "text" },
  "select-all": { userSelect: "all" },
  "select-auto": { userSelect: "auto" },

  // Will Change
  "will-change-auto": { willChange: "auto" },
  "will-change-scroll": { willChange: "scroll-position" },
  "will-change-contents": { willChange: "contents" },
  "will-change-transform": { willChange: "transform" },

  // Content
  "content-none": { content: "none" },

  // Box Sizing
  "box-border": { boxSizing: "border-box" },
  "box-content": { boxSizing: "content-box" },

  // Float & Clear
  "float-start": { float: "inline-start" },
  "float-end": { float: "inline-end" },
  "float-right": { float: "right" },
  "float-left": { float: "left" },
  "float-none": { float: "none" },
  "clear-start": { clear: "inline-start" },
  "clear-end": { clear: "inline-end" },
  "clear-left": { clear: "left" },
  "clear-right": { clear: "right" },
  "clear-both": { clear: "both" },
  "clear-none": { clear: "none" },

  // Mix Blend Mode
  "mix-blend-normal": { mixBlendMode: "normal" },
  "mix-blend-multiply": { mixBlendMode: "multiply" },
  "mix-blend-screen": { mixBlendMode: "screen" },
  "mix-blend-overlay": { mixBlendMode: "overlay" },
  "mix-blend-darken": { mixBlendMode: "darken" },
  "mix-blend-lighten": { mixBlendMode: "lighten" },
  "mix-blend-color-dodge": { mixBlendMode: "color-dodge" },
  "mix-blend-color-burn": { mixBlendMode: "color-burn" },
  "mix-blend-hard-light": { mixBlendMode: "hard-light" },
  "mix-blend-soft-light": { mixBlendMode: "soft-light" },
  "mix-blend-difference": { mixBlendMode: "difference" },
  "mix-blend-exclusion": { mixBlendMode: "exclusion" },
  "mix-blend-hue": { mixBlendMode: "hue" },
  "mix-blend-saturation": { mixBlendMode: "saturation" },
  "mix-blend-color": { mixBlendMode: "color" },
  "mix-blend-luminosity": { mixBlendMode: "luminosity" },
  "mix-blend-plus-darker": { mixBlendMode: "plus-darker" },
  "mix-blend-plus-lighter": { mixBlendMode: "plus-lighter" },

  // Background Blend Mode
  "bg-blend-normal": { backgroundBlendMode: "normal" },
  "bg-blend-multiply": { backgroundBlendMode: "multiply" },
  "bg-blend-screen": { backgroundBlendMode: "screen" },
  "bg-blend-overlay": { backgroundBlendMode: "overlay" },
  "bg-blend-darken": { backgroundBlendMode: "darken" },
  "bg-blend-lighten": { backgroundBlendMode: "lighten" },
  "bg-blend-color-dodge": { backgroundBlendMode: "color-dodge" },
  "bg-blend-color-burn": { backgroundBlendMode: "color-burn" },
  "bg-blend-hard-light": { backgroundBlendMode: "hard-light" },
  "bg-blend-soft-light": { backgroundBlendMode: "soft-light" },
  "bg-blend-difference": { backgroundBlendMode: "difference" },
  "bg-blend-exclusion": { backgroundBlendMode: "exclusion" },
  "bg-blend-hue": { backgroundBlendMode: "hue" },
  "bg-blend-saturation": { backgroundBlendMode: "saturation" },
  "bg-blend-color": { backgroundBlendMode: "color" },
  "bg-blend-luminosity": { backgroundBlendMode: "luminosity" },

  // Alignment
  "align-baseline": { verticalAlign: "baseline" },
  "align-top": { verticalAlign: "top" },
  "align-middle": { verticalAlign: "middle" },
  "align-bottom": { verticalAlign: "bottom" },
  "align-text-top": { verticalAlign: "text-top" },
  "align-text-bottom": { verticalAlign: "text-bottom" },
  "align-sub": { verticalAlign: "sub" },
  "align-super": { verticalAlign: "super" },

  // Flex/Grid alignment
  "justify-normal": { justifyContent: "normal" },
  "justify-start": { justifyContent: "flex-start" },
  "justify-end": { justifyContent: "flex-end" },
  "justify-center": { justifyContent: "center" },
  "justify-between": { justifyContent: "space-between" },
  "justify-around": { justifyContent: "space-around" },
  "justify-evenly": { justifyContent: "space-evenly" },
  "justify-stretch": { justifyContent: "stretch" },
  "justify-items-start": { justifyItems: "start" },
  "justify-items-end": { justifyItems: "end" },
  "justify-items-center": { justifyItems: "center" },
  "justify-items-stretch": { justifyItems: "stretch" },
  "justify-self-auto": { justifySelf: "auto" },
  "justify-self-start": { justifySelf: "start" },
  "justify-self-end": { justifySelf: "end" },
  "justify-self-center": { justifySelf: "center" },
  "justify-self-stretch": { justifySelf: "stretch" },
  "content-normal": { alignContent: "normal" },
  "content-center": { alignContent: "center" },
  "content-start": { alignContent: "flex-start" },
  "content-end": { alignContent: "flex-end" },
  "content-between": { alignContent: "space-between" },
  "divide-x-reverse": { [TW_VAR.SPACE_X_REVERSE]: "1" },
  "divide-y-reverse": { [TW_VAR.SPACE_Y_REVERSE]: "1" },
  "content-around": { alignContent: "space-around" },
  "content-evenly": { alignContent: "space-evenly" },
  "content-baseline": { alignContent: "baseline" },
  "content-stretch": { alignContent: "stretch" },
  "items-start": { alignItems: "flex-start" },
  "items-end": { alignItems: "flex-end" },
  "items-center": { alignItems: "center" },
  "items-baseline": { alignItems: "baseline" },
  "items-stretch": { alignItems: "stretch" },
  "self-auto": { alignSelf: "auto" },
  "self-start": { alignSelf: "flex-start" },
  "self-end": { alignSelf: "flex-end" },
  "self-center": { alignSelf: "center" },
  "self-stretch": { alignSelf: "stretch" },
  "self-baseline": { alignSelf: "baseline" },
  "place-content-center": { placeContent: "center" },
  "place-content-start": { placeContent: "start" },
  "place-content-end": { placeContent: "end" },
  "place-content-between": { placeContent: "space-between" },
  "place-content-around": { placeContent: "space-around" },
  "place-content-evenly": { placeContent: "space-evenly" },
  "place-content-baseline": { placeContent: "baseline" },
  "place-content-stretch": { placeContent: "stretch" },
  "place-items-start": { placeItems: "start" },
  "place-items-end": { placeItems: "end" },
  "place-items-center": { placeItems: "center" },
  "place-items-baseline": { placeItems: "baseline" },
  "place-items-stretch": { placeItems: "stretch" },
  "place-self-auto": { placeSelf: "auto" },
  "place-self-start": { placeSelf: "start" },
  "place-self-end": { placeSelf: "end" },
  "place-self-center": { placeSelf: "center" },
  "place-self-stretch": { placeSelf: "stretch" },

  // Background
  "bg-fixed": { backgroundAttachment: "fixed" },
  "bg-local": { backgroundAttachment: "local" },
  "bg-scroll": { backgroundAttachment: "scroll" },
  "bg-clip-border": { backgroundClip: "border-box" },
  "bg-clip-padding": { backgroundClip: "padding-box" },
  "bg-clip-content": { backgroundClip: "content-box" },
  "bg-clip-text": {
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
  },
  "bg-origin-border": { backgroundOrigin: "border-box" },
  "bg-origin-padding": { backgroundOrigin: "padding-box" },
  "bg-origin-content": { backgroundOrigin: "content-box" },
  "bg-repeat": { backgroundRepeat: "repeat" },
  "bg-no-repeat": { backgroundRepeat: "no-repeat" },
  "bg-repeat-x": { backgroundRepeat: "repeat-x" },
  "bg-repeat-y": { backgroundRepeat: "repeat-y" },
  "bg-repeat-round": { backgroundRepeat: "round" },
  "bg-repeat-space": { backgroundRepeat: "space" },

  // Gradients
  "bg-none": { backgroundImage: "none" },
  "bg-gradient-to-t": {
    backgroundImage: `linear-gradient(to top, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-tr": {
    backgroundImage:
      `linear-gradient(to top right, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-r": {
    backgroundImage: `linear-gradient(to right, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-br": {
    backgroundImage:
      `linear-gradient(to bottom right, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-b": {
    backgroundImage:
      `linear-gradient(to bottom, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-bl": {
    backgroundImage:
      `linear-gradient(to bottom left, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-l": {
    backgroundImage: `linear-gradient(to left, var(${TW_VAR.GRADIENT_STOPS}))`,
  },
  "bg-gradient-to-tl": {
    backgroundImage:
      `linear-gradient(to top left, var(${TW_VAR.GRADIENT_STOPS}))`,
  },

  // Outline
  outline: { outlineStyle: "solid" },
  "outline-none": {
    outline: "2px solid transparent",
    outlineOffset: "2px",
  },
  "outline-dashed": { outlineStyle: "dashed" },
  "outline-dotted": { outlineStyle: "dotted" },
  "outline-double": { outlineStyle: "double" },

  // Ring inset
  "ring-inset": { [TW_VAR.RING_INSET]: "inset" },

  // Cursor
  "cursor-auto": { cursor: "auto" },
  "cursor-default": { cursor: "default" },
  "cursor-pointer": { cursor: "pointer" },
  "cursor-wait": { cursor: "wait" },
  "cursor-text": { cursor: "text" },
  "cursor-move": { cursor: "move" },
  "cursor-help": { cursor: "help" },
  "cursor-not-allowed": { cursor: "not-allowed" },
  "cursor-none": { cursor: "none" },
  "cursor-context-menu": { cursor: "context-menu" },
  "cursor-progress": { cursor: "progress" },
  "cursor-cell": { cursor: "cell" },
  "cursor-crosshair": { cursor: "crosshair" },
  "cursor-vertical-text": { cursor: "vertical-text" },
  "cursor-alias": { cursor: "alias" },
  "cursor-copy": { cursor: "copy" },
  "cursor-no-drop": { cursor: "no-drop" },
  "cursor-grab": { cursor: "grab" },
  "cursor-grabbing": { cursor: "grabbing" },
  "cursor-all-scroll": { cursor: "all-scroll" },
  "cursor-col-resize": { cursor: "col-resize" },
  "cursor-row-resize": { cursor: "row-resize" },
  "cursor-n-resize": { cursor: "n-resize" },
  "cursor-sql-resize": { cursor: "sql-resize" },
  "cursor-s-resize": { cursor: "s-resize" },
  "cursor-w-resize": { cursor: "w-resize" },
  "cursor-ne-resize": { cursor: "ne-resize" },
  "cursor-nw-resize": { cursor: "nw-resize" },
  "cursor-se-resize": { cursor: "se-resize" },
  "cursor-sw-resize": { cursor: "sw-resize" },
  "cursor-ew-resize": { cursor: "ew-resize" },
  "cursor-ns-resize": { cursor: "ns-resize" },
  "cursor-nesw-resize": { cursor: "nesw-resize" },
  "cursor-nwse-resize": { cursor: "nwse-resize" },
  "cursor-zoom-in": { cursor: "zoom-in" },
  "cursor-zoom-out": { cursor: "zoom-out" },

  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL THEME COLORS (neutral-based, for general UI)
  // ═══════════════════════════════════════════════════════════════════════════

  // Text hierarchy
  "text-primary": { color: "var(--palette-text-primary)" },
  "text-secondary": { color: "var(--palette-text-secondary)" },
  "text-tertiary": { color: "var(--palette-text-tertiary)" },
  "text-icon": { color: "var(--palette-text-icon)" },
  "text-site": { color: "var(--site-text)" },
  "text-site-text": { color: "var(--site-text)" },
  "text-site-body": { color: "var(--site-text-body)" },
  "text-site-muted": { color: "var(--site-text-muted)" },
  "text-site-accent": { color: "var(--site-accent)" },
  "text-site-on-accent": { color: "var(--site-on-accent)" },

  // Background hierarchy
  "bg-body": { backgroundColor: "var(--palette-background-body)" },
  "bg-surface": { backgroundColor: "var(--palette-background-surface)" },
  "bg-popup": { backgroundColor: "var(--palette-background-popup)" },
  "bg-level1": { backgroundColor: "var(--palette-background-level1)" },
  "bg-level2": { backgroundColor: "var(--palette-background-level2)" },
  "bg-level3": { backgroundColor: "var(--palette-background-level3)" },
  "bg-tooltip": { backgroundColor: "var(--palette-background-tooltip)" },
  "bg-backdrop": { backgroundColor: "var(--palette-background-backdrop)" },
  "bg-site": { backgroundColor: "var(--site-bg)" },
  "bg-site-bg": { backgroundColor: "var(--site-bg)" },
  "bg-site-surface": { backgroundColor: "var(--site-surface)" },
  "bg-site-surface-alt": { backgroundColor: "var(--site-surface-alt)" },
  "bg-site-surface-subtle": {
    backgroundColor: "var(--site-surface-subtle)",
  },
  "bg-site-accent": { backgroundColor: "var(--site-accent)" },
  "bg-site-accent-soft": { backgroundColor: "var(--site-accent-soft)" },
  "bg-site-accent-tint": { backgroundColor: "var(--site-accent-tint)" },

  // Border
  "border-divider": { borderColor: "var(--palette-divider)" },
  "border-site": { borderColor: "var(--site-border)" },
  "border-site-border": { borderColor: "var(--site-border)" },
  "border-site-accent": { borderColor: "var(--site-accent)" },

  // Site fonts and shadows
  "font-site-body": { fontFamily: "var(--site-font-body)" },
  "font-site-display": { fontFamily: "var(--site-font-display)" },
  "font-site-mono": { fontFamily: "var(--site-font-mono)" },
  "shadow-site-soft": { boxShadow: "0 1px 3px var(--site-shadow-soft)" },
  "shadow-site-card": { boxShadow: "var(--site-shadow-card)" },
  "shadow-site-panel": { boxShadow: "0 12px 32px var(--site-shadow-panel)" },

  // ═══════════════════════════════════════════════════════════════════════════
  // VARIANT/COLOR SYSTEM (Joy UI style)
  // Colors: primary, neutral, danger, success, warning
  // Variants: solid, soft, outlined, plain
  // States: (default), hover, active, disabled
  // ═══════════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────────────
  // PRIMARY - Solid
  // ─────────────────────────────────────────────────────────────────────────────
  "bg-primary-solid": { backgroundColor: "var(--palette-primary-solid-bg)" },
  "bg-primary-solid-hover": {
    backgroundColor: "var(--palette-primary-solid-hover-bg)",
  },
  "bg-primary-solid-active": {
    backgroundColor: "var(--palette-primary-solid-active-bg)",
  },
  "bg-primary-solid-disabled": {
    backgroundColor: "var(--palette-primary-solid-disabled-bg)",
  },
  "text-primary-solid": { color: "var(--palette-primary-solid-color)" },
  "text-primary-solid-hover": {
    color: "var(--palette-primary-solid-hover-color)",
  },
  "text-primary-solid-active": {
    color: "var(--palette-primary-solid-active-color)",
  },
  "text-primary-solid-disabled": {
    color: "var(--palette-primary-solid-disabled-color)",
  },

  // PRIMARY - Soft
  "bg-primary-soft": { backgroundColor: "var(--palette-primary-soft-bg)" },
  "bg-primary-soft-hover": {
    backgroundColor: "var(--palette-primary-soft-hover-bg)",
  },
  "bg-primary-soft-active": {
    backgroundColor: "var(--palette-primary-soft-active-bg)",
  },
  "bg-primary-soft-disabled": {
    backgroundColor: "var(--palette-primary-soft-disabled-bg)",
  },
  "text-primary-soft": { color: "var(--palette-primary-soft-color)" },
  "text-primary-soft-hover": {
    color: "var(--palette-primary-soft-hover-color)",
  },
  "text-primary-soft-active": {
    color: "var(--palette-primary-soft-active-color)",
  },
  "text-primary-soft-disabled": {
    color: "var(--palette-primary-soft-disabled-color)",
  },

  // PRIMARY - Outlined
  "bg-primary-outlined": {
    backgroundColor: "var(--palette-primary-outlined-bg)",
  },
  "bg-primary-outlined-hover": {
    backgroundColor: "var(--palette-primary-outlined-hover-bg)",
  },
  "bg-primary-outlined-active": {
    backgroundColor: "var(--palette-primary-outlined-active-bg)",
  },
  "bg-primary-outlined-disabled": {
    backgroundColor: "var(--palette-primary-outlined-disabled-bg)",
  },
  "text-primary-outlined": { color: "var(--palette-primary-outlined-color)" },
  "text-primary-outlined-hover": {
    color: "var(--palette-primary-outlined-hover-color)",
  },
  "text-primary-outlined-active": {
    color: "var(--palette-primary-outlined-active-color)",
  },
  "text-primary-outlined-disabled": {
    color: "var(--palette-primary-outlined-disabled-color)",
  },
  "border-primary-outlined": {
    borderColor: "var(--palette-primary-outlined-border)",
  },
  "border-primary-outlined-hover": {
    borderColor: "var(--palette-primary-outlined-hover-border)",
  },
  "border-primary-outlined-active": {
    borderColor: "var(--palette-primary-outlined-active-border)",
  },
  "border-primary-outlined-disabled": {
    borderColor: "var(--palette-primary-outlined-disabled-border)",
  },

  // PRIMARY - Plain
  "bg-primary-plain": { backgroundColor: "var(--palette-primary-plain-bg)" },
  "bg-primary-plain-hover": {
    backgroundColor: "var(--palette-primary-plain-hover-bg)",
  },
  "bg-primary-plain-active": {
    backgroundColor: "var(--palette-primary-plain-active-bg)",
  },
  "bg-primary-plain-disabled": {
    backgroundColor: "var(--palette-primary-plain-disabled-bg)",
  },
  "text-primary-plain": { color: "var(--palette-primary-plain-color)" },
  "text-primary-plain-hover": {
    color: "var(--palette-primary-plain-hover-color)",
  },
  "text-primary-plain-active": {
    color: "var(--palette-primary-plain-active-color)",
  },
  "text-primary-plain-disabled": {
    color: "var(--palette-primary-plain-disabled-color)",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // NEUTRAL - Solid
  // ─────────────────────────────────────────────────────────────────────────────
  "bg-neutral-solid": { backgroundColor: "var(--palette-neutral-solid-bg)" },
  "bg-neutral-solid-hover": {
    backgroundColor: "var(--palette-neutral-solid-hover-bg)",
  },
  "bg-neutral-solid-active": {
    backgroundColor: "var(--palette-neutral-solid-active-bg)",
  },
  "bg-neutral-solid-disabled": {
    backgroundColor: "var(--palette-neutral-solid-disabled-bg)",
  },
  "text-neutral-solid": { color: "var(--palette-neutral-solid-color)" },
  "text-neutral-solid-hover": {
    color: "var(--palette-neutral-solid-hover-color)",
  },
  "text-neutral-solid-active": {
    color: "var(--palette-neutral-solid-active-color)",
  },
  "text-neutral-solid-disabled": {
    color: "var(--palette-neutral-solid-disabled-color)",
  },

  // NEUTRAL - Soft
  "bg-neutral-soft": { backgroundColor: "var(--palette-neutral-soft-bg)" },
  "bg-neutral-soft-hover": {
    backgroundColor: "var(--palette-neutral-soft-hover-bg)",
  },
  "bg-neutral-soft-active": {
    backgroundColor: "var(--palette-neutral-soft-active-bg)",
  },
  "bg-neutral-soft-disabled": {
    backgroundColor: "var(--palette-neutral-soft-disabled-bg)",
  },
  "text-neutral-soft": { color: "var(--palette-neutral-soft-color)" },
  "text-neutral-soft-hover": {
    color: "var(--palette-neutral-soft-hover-color)",
  },
  "text-neutral-soft-active": {
    color: "var(--palette-neutral-soft-active-color)",
  },
  "text-neutral-soft-disabled": {
    color: "var(--palette-neutral-soft-disabled-color)",
  },

  // NEUTRAL - Outlined
  "bg-neutral-outlined": {
    backgroundColor: "var(--palette-neutral-outlined-bg)",
  },
  "bg-neutral-outlined-hover": {
    backgroundColor: "var(--palette-neutral-outlined-hover-bg)",
  },
  "bg-neutral-outlined-active": {
    backgroundColor: "var(--palette-neutral-outlined-active-bg)",
  },
  "bg-neutral-outlined-disabled": {
    backgroundColor: "var(--palette-neutral-outlined-disabled-bg)",
  },
  "text-neutral-outlined": { color: "var(--palette-neutral-outlined-color)" },
  "text-neutral-outlined-hover": {
    color: "var(--palette-neutral-outlined-hover-color)",
  },
  "text-neutral-outlined-active": {
    color: "var(--palette-neutral-outlined-active-color)",
  },
  "text-neutral-outlined-disabled": {
    color: "var(--palette-neutral-outlined-disabled-color)",
  },
  "border-neutral-outlined": {
    borderColor: "var(--palette-neutral-outlined-border)",
  },
  "border-neutral-outlined-hover": {
    borderColor: "var(--palette-neutral-outlined-hover-border)",
  },
  "border-neutral-outlined-active": {
    borderColor: "var(--palette-neutral-outlined-active-border)",
  },
  "border-neutral-outlined-disabled": {
    borderColor: "var(--palette-neutral-outlined-disabled-border)",
  },

  // NEUTRAL - Plain
  "bg-neutral-plain": { backgroundColor: "var(--palette-neutral-plain-bg)" },
  "bg-neutral-plain-hover": {
    backgroundColor: "var(--palette-neutral-plain-hover-bg)",
  },
  "bg-neutral-plain-active": {
    backgroundColor: "var(--palette-neutral-plain-active-bg)",
  },
  "bg-neutral-plain-disabled": {
    backgroundColor: "var(--palette-neutral-plain-disabled-bg)",
  },
  "text-neutral-plain": { color: "var(--palette-neutral-plain-color)" },
  "text-neutral-plain-hover": {
    color: "var(--palette-neutral-plain-hover-color)",
  },
  "text-neutral-plain-active": {
    color: "var(--palette-neutral-plain-active-color)",
  },
  "text-neutral-plain-disabled": {
    color: "var(--palette-neutral-plain-disabled-color)",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // DANGER - Solid
  // ─────────────────────────────────────────────────────────────────────────────
  "bg-danger-solid": { backgroundColor: "var(--palette-danger-solid-bg)" },
  "bg-danger-solid-hover": {
    backgroundColor: "var(--palette-danger-solid-hover-bg)",
  },
  "bg-danger-solid-active": {
    backgroundColor: "var(--palette-danger-solid-active-bg)",
  },
  "bg-danger-solid-disabled": {
    backgroundColor: "var(--palette-danger-solid-disabled-bg)",
  },
  "text-danger-solid": { color: "var(--palette-danger-solid-color)" },
  "text-danger-solid-hover": {
    color: "var(--palette-danger-solid-hover-color)",
  },
  "text-danger-solid-active": {
    color: "var(--palette-danger-solid-active-color)",
  },
  "text-danger-solid-disabled": {
    color: "var(--palette-danger-solid-disabled-color)",
  },

  // DANGER - Soft
  "bg-danger-soft": { backgroundColor: "var(--palette-danger-soft-bg)" },
  "bg-danger-soft-hover": {
    backgroundColor: "var(--palette-danger-soft-hover-bg)",
  },
  "bg-danger-soft-active": {
    backgroundColor: "var(--palette-danger-soft-active-bg)",
  },
  "bg-danger-soft-disabled": {
    backgroundColor: "var(--palette-danger-soft-disabled-bg)",
  },
  "text-danger-soft": { color: "var(--palette-danger-soft-color)" },
  "text-danger-soft-hover": { color: "var(--palette-danger-soft-hover-color)" },
  "text-danger-soft-active": {
    color: "var(--palette-danger-soft-active-color)",
  },
  "text-danger-soft-disabled": {
    color: "var(--palette-danger-soft-disabled-color)",
  },

  // DANGER - Outlined
  "bg-danger-outlined": {
    backgroundColor: "var(--palette-danger-outlined-bg)",
  },
  "bg-danger-outlined-hover": {
    backgroundColor: "var(--palette-danger-outlined-hover-bg)",
  },
  "bg-danger-outlined-active": {
    backgroundColor: "var(--palette-danger-outlined-active-bg)",
  },
  "bg-danger-outlined-disabled": {
    backgroundColor: "var(--palette-danger-outlined-disabled-bg)",
  },
  "text-danger-outlined": { color: "var(--palette-danger-outlined-color)" },
  "text-danger-outlined-hover": {
    color: "var(--palette-danger-outlined-hover-color)",
  },
  "text-danger-outlined-active": {
    color: "var(--palette-danger-outlined-active-color)",
  },
  "text-danger-outlined-disabled": {
    color: "var(--palette-danger-outlined-disabled-color)",
  },
  "border-danger-outlined": {
    borderColor: "var(--palette-danger-outlined-border)",
  },
  "border-danger-outlined-hover": {
    borderColor: "var(--palette-danger-outlined-hover-border)",
  },
  "border-danger-outlined-active": {
    borderColor: "var(--palette-danger-outlined-active-border)",
  },
  "border-danger-outlined-disabled": {
    borderColor: "var(--palette-danger-outlined-disabled-border)",
  },

  // DANGER - Plain
  "bg-danger-plain": { backgroundColor: "var(--palette-danger-plain-bg)" },
  "bg-danger-plain-hover": {
    backgroundColor: "var(--palette-danger-plain-hover-bg)",
  },
  "bg-danger-plain-active": {
    backgroundColor: "var(--palette-danger-plain-active-bg)",
  },
  "bg-danger-plain-disabled": {
    backgroundColor: "var(--palette-danger-plain-disabled-bg)",
  },
  "text-danger-plain": { color: "var(--palette-danger-plain-color)" },
  "text-danger-plain-hover": {
    color: "var(--palette-danger-plain-hover-color)",
  },
  "text-danger-plain-active": {
    color: "var(--palette-danger-plain-active-color)",
  },
  "text-danger-plain-disabled": {
    color: "var(--palette-danger-plain-disabled-color)",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // SUCCESS - Solid
  // ─────────────────────────────────────────────────────────────────────────────
  "bg-success-solid": { backgroundColor: "var(--palette-success-solid-bg)" },
  "bg-success-solid-hover": {
    backgroundColor: "var(--palette-success-solid-hover-bg)",
  },
  "bg-success-solid-active": {
    backgroundColor: "var(--palette-success-solid-active-bg)",
  },
  "bg-success-solid-disabled": {
    backgroundColor: "var(--palette-success-solid-disabled-bg)",
  },
  "text-success-solid": { color: "var(--palette-success-solid-color)" },
  "text-success-solid-hover": {
    color: "var(--palette-success-solid-hover-color)",
  },
  "text-success-solid-active": {
    color: "var(--palette-success-solid-active-color)",
  },
  "text-success-solid-disabled": {
    color: "var(--palette-success-solid-disabled-color)",
  },

  // SUCCESS - Soft
  "bg-success-soft": { backgroundColor: "var(--palette-success-soft-bg)" },
  "bg-success-soft-hover": {
    backgroundColor: "var(--palette-success-soft-hover-bg)",
  },
  "bg-success-soft-active": {
    backgroundColor: "var(--palette-success-soft-active-bg)",
  },
  "bg-success-soft-disabled": {
    backgroundColor: "var(--palette-success-soft-disabled-bg)",
  },
  "text-success-soft": { color: "var(--palette-success-soft-color)" },
  "text-success-soft-hover": {
    color: "var(--palette-success-soft-hover-color)",
  },
  "text-success-soft-active": {
    color: "var(--palette-success-soft-active-color)",
  },
  "text-success-soft-disabled": {
    color: "var(--palette-success-soft-disabled-color)",
  },

  // SUCCESS - Outlined
  "bg-success-outlined": {
    backgroundColor: "var(--palette-success-outlined-bg)",
  },
  "bg-success-outlined-hover": {
    backgroundColor: "var(--palette-success-outlined-hover-bg)",
  },
  "bg-success-outlined-active": {
    backgroundColor: "var(--palette-success-outlined-active-bg)",
  },
  "bg-success-outlined-disabled": {
    backgroundColor: "var(--palette-success-outlined-disabled-bg)",
  },
  "text-success-outlined": { color: "var(--palette-success-outlined-color)" },
  "text-success-outlined-hover": {
    color: "var(--palette-success-outlined-hover-color)",
  },
  "text-success-outlined-active": {
    color: "var(--palette-success-outlined-active-color)",
  },
  "text-success-outlined-disabled": {
    color: "var(--palette-success-outlined-disabled-color)",
  },
  "border-success-outlined": {
    borderColor: "var(--palette-success-outlined-border)",
  },
  "border-success-outlined-hover": {
    borderColor: "var(--palette-success-outlined-hover-border)",
  },
  "border-success-outlined-active": {
    borderColor: "var(--palette-success-outlined-active-border)",
  },
  "border-success-outlined-disabled": {
    borderColor: "var(--palette-success-outlined-disabled-border)",
  },

  // SUCCESS - Plain
  "bg-success-plain": { backgroundColor: "var(--palette-success-plain-bg)" },
  "bg-success-plain-hover": {
    backgroundColor: "var(--palette-success-plain-hover-bg)",
  },
  "bg-success-plain-active": {
    backgroundColor: "var(--palette-success-plain-active-bg)",
  },
  "bg-success-plain-disabled": {
    backgroundColor: "var(--palette-success-plain-disabled-bg)",
  },
  "text-success-plain": { color: "var(--palette-success-plain-color)" },
  "text-success-plain-hover": {
    color: "var(--palette-success-plain-hover-color)",
  },
  "text-success-plain-active": {
    color: "var(--palette-success-plain-active-color)",
  },
  "text-success-plain-disabled": {
    color: "var(--palette-success-plain-disabled-color)",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // WARNING - Solid
  // ─────────────────────────────────────────────────────────────────────────────
  "bg-warning-solid": { backgroundColor: "var(--palette-warning-solid-bg)" },
  "bg-warning-solid-hover": {
    backgroundColor: "var(--palette-warning-solid-hover-bg)",
  },
  "bg-warning-solid-active": {
    backgroundColor: "var(--palette-warning-solid-active-bg)",
  },
  "bg-warning-solid-disabled": {
    backgroundColor: "var(--palette-warning-solid-disabled-bg)",
  },
  "text-warning-solid": { color: "var(--palette-warning-solid-color)" },
  "text-warning-solid-hover": {
    color: "var(--palette-warning-solid-hover-color)",
  },
  "text-warning-solid-active": {
    color: "var(--palette-warning-solid-active-color)",
  },
  "text-warning-solid-disabled": {
    color: "var(--palette-warning-solid-disabled-color)",
  },

  // WARNING - Soft
  "bg-warning-soft": { backgroundColor: "var(--palette-warning-soft-bg)" },
  "bg-warning-soft-hover": {
    backgroundColor: "var(--palette-warning-soft-hover-bg)",
  },
  "bg-warning-soft-active": {
    backgroundColor: "var(--palette-warning-soft-active-bg)",
  },
  "bg-warning-soft-disabled": {
    backgroundColor: "var(--palette-warning-soft-disabled-bg)",
  },
  "text-warning-soft": { color: "var(--palette-warning-soft-color)" },
  "text-warning-soft-hover": {
    color: "var(--palette-warning-soft-hover-color)",
  },
  "text-warning-soft-active": {
    color: "var(--palette-warning-soft-active-color)",
  },
  "text-warning-soft-disabled": {
    color: "var(--palette-warning-soft-disabled-color)",
  },

  // WARNING - Outlined
  "bg-warning-outlined": {
    backgroundColor: "var(--palette-warning-outlined-bg)",
  },
  "bg-warning-outlined-hover": {
    backgroundColor: "var(--palette-warning-outlined-hover-bg)",
  },
  "bg-warning-outlined-active": {
    backgroundColor: "var(--palette-warning-outlined-active-bg)",
  },
  "bg-warning-outlined-disabled": {
    backgroundColor: "var(--palette-warning-outlined-disabled-bg)",
  },
  "text-warning-outlined": { color: "var(--palette-warning-outlined-color)" },
  "text-warning-outlined-hover": {
    color: "var(--palette-warning-outlined-hover-color)",
  },
  "text-warning-outlined-active": {
    color: "var(--palette-warning-outlined-active-color)",
  },
  "text-warning-outlined-disabled": {
    color: "var(--palette-warning-outlined-disabled-color)",
  },
  "border-warning-outlined": {
    borderColor: "var(--palette-warning-outlined-border)",
  },
  "border-warning-outlined-hover": {
    borderColor: "var(--palette-warning-outlined-hover-border)",
  },
  "border-warning-outlined-active": {
    borderColor: "var(--palette-warning-outlined-active-border)",
  },
  "border-warning-outlined-disabled": {
    borderColor: "var(--palette-warning-outlined-disabled-border)",
  },

  // WARNING - Plain
  "bg-warning-plain": { backgroundColor: "var(--palette-warning-plain-bg)" },
  "bg-warning-plain-hover": {
    backgroundColor: "var(--palette-warning-plain-hover-bg)",
  },
  "bg-warning-plain-active": {
    backgroundColor: "var(--palette-warning-plain-active-bg)",
  },
  "bg-warning-plain-disabled": {
    backgroundColor: "var(--palette-warning-plain-disabled-bg)",
  },
  "text-warning-plain": { color: "var(--palette-warning-plain-color)" },
  "text-warning-plain-hover": {
    color: "var(--palette-warning-plain-hover-color)",
  },
  "text-warning-plain-active": {
    color: "var(--palette-warning-plain-active-color)",
  },
  "text-warning-plain-disabled": {
    color: "var(--palette-warning-plain-disabled-color)",
  },

  // SR Only
  "sr-only": {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: "0",
  },
  "not-sr-only": {
    position: "static",
    width: "auto",
    height: "auto",
    padding: "0",
    margin: "0",
    overflow: "visible",
    clip: "auto",
    whiteSpace: "normal",
  },

  // Force color adjust
  "forced-color-adjust-auto": { forcedColorAdjust: "auto" },
  "forced-color-adjust-none": { forcedColorAdjust: "none" },
};
