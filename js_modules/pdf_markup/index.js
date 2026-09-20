// deno-lint-ignore-file no-undef

import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import pdfViewerCss from "pdfjs-dist/web/pdf_viewer.css" with { type: "text" };

const viewers = new Map();
const DEFAULT_TOOL = "select";
const VALID_TOOLS = ["hand", "select", "pen", "highlight", "text"];
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const ZOOM_COMMIT_DELAY_MS = 180;
const PINCH_GRACE_MS = 150;
const INERTIA_TIME_CONSTANT_MS = 325;
const INERTIA_MIN_VELOCITY = 0.02;
const INERTIA_START_MIN_VELOCITY = 0.25;
const DOCUMENT_BOUNDARY_WHEEL_THRESHOLD = 72;
const DOCUMENT_BOUNDARY_RESET_MS = 3000;
const MAX_CANVAS_DIMENSION = 8192;
// iOS Safari before iOS 18 rejects canvases over 16,777,216 px^2 (silently
// producing blank bitmaps), so stay at or below that area everywhere.
const MAX_CANVAS_PIXELS = 16777216;
const MAX_OVERLAY_CANVAS_PIXELS = 4194304;
const SELECT_COLOR = "#2563eb";
const DEFAULT_STYLE = {
  penColor: "#ef4444",
  penWidth: 2.5,
  highlightColor: "#fde047",
  highlightWidth: 12,
  highlightOpacity: 0.36,
  textColor: "#0f172a",
  fontSize: 13,
};

let pdfJsStylesInjected = false;
const pdfjsPromises = new Map();
let activeViewerHandle = null;

function loadPdfJs(url, workerUrl) {
  if (!url) {
    return Promise.reject(new Error("PDF.js module URL is required"));
  }
  const key = `${url}\n${workerUrl || ""}`;
  if (!pdfjsPromises.has(key)) {
    pdfjsPromises.set(
      key,
      import(url).then(async (mod) => {
        const lib = mod.default?.getDocument ? mod.default : mod;
        if (workerUrl) {
          lib.GlobalWorkerOptions.workerSrc = workerUrl;
        }
        // The prebuilt PDF.js viewer resolves its API from this global. Load
        // it only after the configured API module so both halves are always
        // the exact same version.
        globalThis.pdfjsLib = lib;
        const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
        return { lib, viewer };
      }),
    );
  }
  return pdfjsPromises.get(key);
}

function ensurePdfJsStyles() {
  if (pdfJsStylesInjected) return;
  pdfJsStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
@scope (.ym-pdf-markup-root) {
${pdfViewerCss}
}
`;
  document.head.appendChild(style);
}

function parseArgs(args) {
  if (!args) return {};
  const base = typeof args === "object" ? { ...args } : {};
  delete base.json;
  if (typeof args.json === "string") {
    try {
      return { ...base, ...JSON.parse(args.json) };
    } catch {
      return base;
    }
  }
  return { ...base, ...(args.json || {}) };
}

function moduleResult(handle, json) {
  return { handle, json };
}

function getViewer(args) {
  const handle = args?.handle || parseArgs(args).handle;
  return viewers.get(handle);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAnnotations(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.annotations)) return value.annotations;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed.annotations)) return parsed.annotations;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeRotations(value) {
  const rotations = {};
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
    ? Object.entries(value).map(([page, quarterTurns]) => ({
      page,
      quarterTurns,
    }))
    : [];
  for (const entry of entries) {
    const page = Math.max(1, Math.trunc(Number(entry?.page || 0)));
    const quarterTurns =
      ((Math.trunc(Number(entry?.quarterTurns ?? entry?.rotation ?? 0)) %
        4) + 4) % 4;
    if (page && quarterTurns) rotations[page] = quarterTurns;
  }
  return rotations;
}

function normalizeDocuments(config) {
  let configuredDocuments = config.documents;
  if (typeof configuredDocuments === "string") {
    try {
      configuredDocuments = JSON.parse(configuredDocuments);
    } catch {
      configuredDocuments = [];
    }
  }
  const source = Array.isArray(configuredDocuments) ? configuredDocuments : [{
    key: config.documentKey || "document",
    fileItemId: config.fileItemId,
    fileUrl: config.pdfUrl,
    fileName: config.fileName,
    annotations: config.annotations,
    rotations: config.rotations,
    revision: config.revision,
    page: config.page,
  }];
  return source.map((document, index) => ({
    key: String(document?.key ?? index + 1),
    fileItemId: String(document?.fileItemId || ""),
    fileUrl: String(document?.fileUrl || document?.pdfUrl || ""),
    dataUrl: String(document?.dataUrl || ""),
    href: String(document?.href || ""),
    fileName: String(document?.fileName || `Document ${index + 1}`),
    contextKey: String(document?.contextKey || ""),
    canEdit: document?.canEdit === undefined ? true : Boolean(document.canEdit),
    annotations: normalizeAnnotations(document?.annotations).map((annotation) =>
      cloneAnnotation(annotation)
    ),
    rotations: normalizeRotations(document?.rotations),
    revision: Math.max(0, Math.trunc(Number(document?.revision || 0))),
    page: Math.max(1, Math.trunc(Number(document?.page || 1))),
    dataLoaded: !document?.dataUrl,
    changeSequence: 0,
    dirty: false,
  }));
}

function normalizeEvidenceFocus(value) {
  if (!value || typeof value !== "object") return null;
  const focus = {
    page: Math.trunc(Number(value.page)),
    renderWidth: Number(value.renderWidth),
    renderHeight: Number(value.renderHeight),
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (
    !Number.isFinite(focus.page) || focus.page < 1 ||
    !Number.isFinite(focus.renderWidth) || focus.renderWidth <= 0 ||
    !Number.isFinite(focus.renderHeight) || focus.renderHeight <= 0 ||
    !Number.isFinite(focus.x) || focus.x < 0 ||
    !Number.isFinite(focus.y) || focus.y < 0 ||
    !Number.isFinite(focus.width) || focus.width <= 0 ||
    !Number.isFinite(focus.height) || focus.height <= 0 ||
    focus.x + focus.width > focus.renderWidth ||
    focus.y + focus.height > focus.renderHeight
  ) return null;
  return focus;
}

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `ann_${Date.now()}_${Math.round(Math.random() * 1000000)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function pointDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function segmentDistanceSquared(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return pointDistanceSquared(point, a);
  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
    0,
    1,
  );
  const closest = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
  return pointDistanceSquared(point, closest);
}

function simplifyPoints(points) {
  if (points.length < 3) return points;
  const simplified = [points[0]];
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (pointDistanceSquared(previous, points[i]) >= 1.2) {
      simplified.push(points[i]);
      previous = points[i];
    }
  }
  simplified.push(points[points.length - 1]);
  return simplified;
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function serializePoint(point) {
  return { x: rounded(point.x), y: rounded(point.y) };
}

function normalizedHexColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function normalizedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return rounded(clamp(number, min, max));
}

function styleProp(style, ...names) {
  if (!style || typeof style !== "object") return undefined;
  for (const name of names) {
    if (Object.hasOwn(style, name)) return style[name];
  }
  return undefined;
}

function annotationMatchesTool(annotation, tool) {
  return (
    (tool === "pen" && annotation.type === "freehand") ||
    (tool === "highlight" && annotation.type === "highlight") ||
    (tool === "text" && annotation.type === "text")
  );
}

function annotationTool(annotation) {
  if (!annotation) return null;
  if (annotation.type === "freehand") return "pen";
  if (annotation.type === "highlight") return "highlight";
  if (annotation.type === "text") return "text";
  return null;
}

function annotationBounds(annotation) {
  if (annotation.type === "freehand" || annotation.type === "highlight") {
    const points = annotation.points || [];
    if (points.length === 0) return null;
    let minX = Number(points[0].x);
    let minY = Number(points[0].y);
    let maxX = Number(points[0].x);
    let maxY = Number(points[0].y);
    for (const point of points) {
      minX = Math.min(minX, Number(point.x));
      minY = Math.min(minY, Number(point.y));
      maxX = Math.max(maxX, Number(point.x));
      maxY = Math.max(maxY, Number(point.y));
    }
    const pad = annotation.strokeWidth || 2;
    return {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    };
  }
  if (annotation.type === "text") {
    return {
      minX: Number(annotation.x),
      minY: Number(annotation.y) - Number(annotation.h || 0),
      maxX: Number(annotation.x) + Number(annotation.w || 0),
      maxY: Number(annotation.y),
    };
  }
  return null;
}

function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}

function clampMoveDelta(bounds, dx, dy, pageWidth, pageHeight) {
  if (!bounds || !pageWidth || !pageHeight) return { dx, dy };
  const minDx = -bounds.minX;
  const maxDx = pageWidth - bounds.maxX;
  const minDy = -bounds.minY;
  const maxDy = pageHeight - bounds.maxY;
  return {
    dx: rounded(clamp(dx, Math.min(minDx, maxDx), Math.max(minDx, maxDx))),
    dy: rounded(clamp(dy, Math.min(minDy, maxDy), Math.max(minDy, maxDy))),
  };
}

function moveAnnotationFromOriginal(annotation, original, dx, dy) {
  if (annotation.type === "freehand" || annotation.type === "highlight") {
    annotation.points = (original.points || []).map((point) => ({
      x: rounded(point.x + dx),
      y: rounded(point.y + dy),
    }));
    return;
  }
  if (annotation.type === "text") {
    annotation.x = rounded(original.x + dx);
    annotation.y = rounded(original.y + dy);
  }
}

function parseHexColor(color, fallback) {
  const value = typeof color === "string" ? color : fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(value || "");
  if (!match) return parseHexColor(fallback, "#ef4444");
  const number = Number.parseInt(match[1], 16);
  return rgb(
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  );
}

function safeDownloadFilename(filename) {
  const unsafeCharacters = '\\/:*?"<>|';
  const cleaned = Array.from(String(filename || "marked-up.pdf"))
    .map((char) => unsafeCharacters.includes(char) ? "-" : char)
    .join("");
  if (/\.pdf$/i.test(cleaned)) {
    return cleaned.replace(/\.pdf$/i, "-marked-up.pdf");
  }
  return `${cleaned}-marked-up.pdf`;
}

class PdfMarkupViewer {
  constructor(config) {
    this.instanceId = newId();
    this.handle = config.handle;
    this.elementId = config.elementId;
    this.documents = normalizeDocuments(config);
    const initialDocumentKey = String(config.initialDocumentKey ?? "");
    const requestedDocumentIndex = this.documents.findIndex((document) =>
      document.key === initialDocumentKey
    );
    this.documentIndex = requestedDocumentIndex >= 0
      ? requestedDocumentIndex
      : clamp(
        Math.trunc(Number(config.documentIndex || 0)),
        0,
        this.documents.length - 1,
      );
    this.document = this.documents[this.documentIndex];
    this.pdfUrl = this.document?.fileUrl || "";
    this.fileName = this.document?.fileName || "";
    this.pdfJsUrl = config.pdfJsUrl;
    this.pdfJsWorkerUrl = config.pdfJsWorkerUrl;
    // pdf.js resolves wasm decoders (CCITT/JBIG2/JPX/ICC) by concatenating
    // `wasmUrl + filename`, so it must end with a slash.
    this.pdfJsWasmUrl = config.pdfJsWasmUrl
      ? (String(config.pdfJsWasmUrl).endsWith("/")
        ? String(config.pdfJsWasmUrl)
        : `${config.pdfJsWasmUrl}/`)
      : null;
    this.annotations = this.document?.annotations || [];
    this.rotations = this.document?.rotations || {};
    this.changeSequence = this.document?.changeSequence || 0;
    this.currentPage = Math.max(
      1,
      Math.trunc(Number(config.page || this.document?.page || 1)),
    );
    if (this.document) this.document.page = this.currentPage;
    this.evidenceFocus = normalizeEvidenceFocus(config.evidenceFocus);
    this.evidenceFocusScrolled = false;
    this.scale = Number(config.scale || 1.1);
    this.fitWidthOnLoad = config.fitWidthOnLoad !== false;
    this.configuredReadOnly = Boolean(config.readOnly);
    this.readOnly = this.configuredReadOnly || !this.document ||
      this.document.canEdit === false;
    this.tool = this.configuredReadOnly
      ? "hand"
      : VALID_TOOLS.includes(config.tool)
      ? config.tool
      : DEFAULT_TOOL;
    this.style = {
      penColor: normalizedHexColor(
        config.style?.penColor,
        DEFAULT_STYLE.penColor,
      ),
      penWidth: normalizedNumber(
        config.style?.penWidth,
        DEFAULT_STYLE.penWidth,
        1,
        12,
      ),
      highlightColor: normalizedHexColor(
        config.style?.highlightColor,
        DEFAULT_STYLE.highlightColor,
      ),
      highlightWidth: normalizedNumber(
        config.style?.highlightWidth,
        DEFAULT_STYLE.highlightWidth,
        4,
        32,
      ),
      highlightOpacity: normalizedNumber(
        config.style?.highlightOpacity,
        DEFAULT_STYLE.highlightOpacity,
        0.15,
        0.8,
      ),
      textColor: normalizedHexColor(
        config.style?.textColor,
        DEFAULT_STYLE.textColor,
      ),
      fontSize: normalizedNumber(
        config.style?.fontSize,
        DEFAULT_STYLE.fontSize,
        10,
        24,
      ),
    };
    this.dirty = false;
    this.selectedAnnotationId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.pageCount = 0;
    this.pageViews = new Map();
    this.mount = null;
    this.viewerElement = null;
    this.pdfViewer = null;
    this.pdfLinkService = null;
    this.eventBus = null;
    this.loadingTask = null;
    this.scrollRaf = null;
    this.draft = null;
    this.drag = null;
    this.resize = null;
    this.activePointerId = null;
    this.textEditId = null;
    this.textEditHistoryId = null;
    this.lastAddedTextAnnotationId = null;
    this.lastTextPointerDown = null;
    this.draftInfo = null;
    this.pan = null;
    this.pinch = null;
    this.spacePan = false;
    this.penMode = false;
    this.touchPoints = new Map();
    this.previewScale = null;
    this.previewAnchor = null;
    this.pendingPreview = null;
    this.previewRaf = null;
    this.zoomCommitTimer = null;
    this.inertiaRaf = null;
    this.documentLoading = false;
    this.boundaryWheelDelta = 0;
    this.boundaryNavigationPending = false;
    this.boundaryNavigationResetTimer = null;
    this.pendingRotation = null;
    this.destroyed = false;
    this.cssZoomSupported = typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" && CSS.supports("zoom", "2");
    this.onScrollBound = () => this.queueScrollPageUpdate();
    this.onKeyDownBound = (event) => this.onKeyDown(event);
    this.onKeyUpBound = (event) => this.onKeyUp(event);
    this.onWindowBlurBound = () => this.onWindowBlur();
    this.onBeforeUnloadBound = (event) => this.onBeforeUnload(event);
    this.onContainerPointerDownCaptureBound = (event) =>
      this.onContainerPointerDownCapture(event);
    this.onContainerPointerDownBound = (event) =>
      this.onContainerPointerDown(event);
    this.onContainerPointerMoveBound = (event) =>
      this.onContainerPointerMove(event);
    this.onContainerPointerUpBound = (event) =>
      this.onContainerPointerUp(event);
    this.onContainerPointerCancelBound = (event) =>
      this.onContainerPointerCancel(event);
    this.onWheelBound = (event) => this.onWheel(event);
    this.onMiddleMouseDownBound = (event) => {
      if (event.button === 1) event.preventDefault();
    };
  }

  async initialize() {
    ensurePdfJsStyles();
    this.mount = document.getElementById(this.elementId);
    if (!this.mount) {
      throw new Error(`PDF markup mount element not found: ${this.elementId}`);
    }
    this.mount.innerHTML =
      `<div class="ym-pdf-markup-loading">Loading PDF...</div>`;
    const pdfJs = await loadPdfJs(this.pdfJsUrl, this.pdfJsWorkerUrl);
    this.pdfjsLib = pdfJs.lib;
    this.pdfjsViewer = pdfJs.viewer;
    this.createViewer();
    this.container.dataset.tool = this.tool;
    this.container.dataset.readOnly = this.readOnly ? "true" : "false";
    this.container.tabIndex = 0;
    document.addEventListener("keydown", this.onKeyDownBound, true);
    document.addEventListener("keyup", this.onKeyUpBound, true);
    globalThis.addEventListener("blur", this.onWindowBlurBound);
    this.container.addEventListener(
      "pointerdown",
      this.onContainerPointerDownCaptureBound,
      true,
    );
    this.container.addEventListener(
      "pointerdown",
      this.onContainerPointerDownBound,
    );
    this.container.addEventListener(
      "pointermove",
      this.onContainerPointerMoveBound,
    );
    this.container.addEventListener(
      "pointerup",
      this.onContainerPointerUpBound,
    );
    this.container.addEventListener(
      "pointercancel",
      this.onContainerPointerCancelBound,
    );
    this.container.addEventListener("wheel", this.onWheelBound, {
      passive: false,
    });
    this.container.addEventListener("mousedown", this.onMiddleMouseDownBound);
    this.container.addEventListener("scroll", this.onScrollBound, {
      passive: true,
    });
    if (!this.configuredReadOnly) {
      globalThis.addEventListener("beforeunload", this.onBeforeUnloadBound);
    }

    await this.openDocument();
    this.updateCursors();
    emit("ready", {
      handle: this.handle,
      json: this.workspacePayload(),
    });
  }

  createViewer() {
    this.mount.innerHTML = "";
    this.container = document.createElement("div");
    this.container.className = "ym-pdf-markup-root";
    this.viewerElement = document.createElement("div");
    this.viewerElement.className = "pdfViewer ym-pdf-markup-pages";
    this.container.append(this.viewerElement);
    this.mount.append(this.container);

    this.eventBus = new this.pdfjsViewer.EventBus();
    this.viewerAbortController = new AbortController();
    this.pdfLinkService = new this.pdfjsViewer.PDFLinkService({
      eventBus: this.eventBus,
    });
    this.pdfViewer = new this.pdfjsViewer.PDFViewer({
      container: this.container,
      viewer: this.viewerElement,
      eventBus: this.eventBus,
      linkService: this.pdfLinkService,
      maxCanvasPixels: MAX_CANVAS_PIXELS,
      maxCanvasDim: MAX_CANVAS_DIMENSION,
      enableDetailCanvas: true,
      minDurationToUpdateCanvas: 500,
      supportsPinchToZoom: false,
      abortSignal: this.viewerAbortController.signal,
    });
    this.pdfLinkService.setViewer(this.pdfViewer);
    this.eventBus.on("pagechanging", ({ pageNumber }) => {
      if (!this.pdf || pageNumber === this.currentPage) return;
      this.currentPage = pageNumber;
      emit("pageChanged", {
        handle: this.handle,
        json: this.workspacePayload(),
      });
    });
    this.eventBus.on("scalechanging", ({ scale }) => {
      if (!this.pdf || !Number.isFinite(scale)) return;
      this.scale = scale;
      queueMicrotask(() => {
        this.syncPageSurfaces();
        this.renderAllTextLayers();
        for (const pageView of this.pageViews.values()) {
          this.renderAnnotations(pageView.pageNumber);
          this.renderEvidenceFocus(pageView.pageNumber);
        }
      });
      this.emitZoomChanged();
    });
    this.eventBus.on("pagerender", ({ pageNumber }) => {
      this.syncPageSurface(pageNumber);
    });
    this.eventBus.on("pagerendered", ({ pageNumber }) => {
      this.syncPageSurface(pageNumber);
      this.renderAnnotations(pageNumber);
      this.renderTextLayer(pageNumber);
      this.renderEvidenceFocus(pageNumber);
    });
  }

  async openDocument() {
    this.syncDocumentAccess();
    if (!this.document?.fileUrl) {
      this.showViewerMessage("No PDF selected.", "ym-pdf-markup-empty");
      return;
    }
    this.removeViewerMessage();
    const loadingElement = document.createElement("div");
    loadingElement.className = "ym-pdf-markup-loading";
    loadingElement.textContent = `Loading ${this.document.fileName}...`;
    this.container.append(loadingElement);
    await this.loadDocumentData(this.document);
    if (this.destroyed) return;
    this.pdfUrl = this.document.fileUrl;
    this.fileName = this.document.fileName;
    this.annotations = this.document.annotations;
    this.rotations = this.document.rotations;
    this.changeSequence = this.document.changeSequence;
    this.currentPage = this.document.page;
    this.dirty = this.document.dirty;
    this.selectedAnnotationId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.loadingTask = this.pdfjsLib.getDocument({
      url: this.pdfUrl,
      withCredentials: true,
      // Without this, scanned PDFs (CCITT/JBIG2 images) render blank pages:
      // pdf.js logs the decode failure as a warning and paints nothing.
      // Note: qcms (ICC color) stays disabled even with wasmUrl set — pdf.js
      // only enables it when cMapUrl and standardFontDataUrl are also
      // configured. Adding those later would activate ICC color management
      // (via synchronous XHR) and change color output of existing PDFs.
      wasmUrl: this.pdfJsWasmUrl,
    });
    this.pdf = await this.loadingTask.promise;
    if (this.destroyed) return;
    this.pageCount = this.pdf.numPages;
    this.currentPage = clamp(this.currentPage, 1, this.pageCount);
    loadingElement.remove();
    this.pagesRoot = this.viewerElement;
    const pagesInitialized = new Promise((resolve) => {
      this.eventBus.on("pagesinit", resolve, { once: true });
    });
    this.pdfLinkService.setDocument(this.pdf);
    this.pdfViewer.setDocument(this.pdf);
    await pagesInitialized;
    this.createPageViews();
    this.applyPageRotations();
    this.pdfViewer.currentPageNumber = this.currentPage;
    if (this.fitWidthOnLoad) {
      this.pdfViewer.currentScaleValue = "page-width";
    } else {
      this.pdfViewer.currentScale = this.scale;
    }
    this.scale = this.pdfViewer.currentScale;
    this.appendDocumentHeader();
    this.appendDocumentFooter();
    const initialPage = this.currentPage;
    this.pdfViewer.update();
    this.syncPageSurfaces();
    this.renderEvidenceFocus(this.currentPage);
    if (initialPage > 1) {
      this.scrollPageIntoView(initialPage);
      this.currentPage = initialPage;
    }
    emit("documentChanged", {
      handle: this.handle,
      json: this.workspacePayload(),
    });
    this.resetBoundaryNavigation();
    this.syncDocumentUrl();
  }

  showViewerMessage(message, className) {
    this.removeViewerMessage();
    const element = document.createElement("div");
    element.className = className;
    element.dataset.pdfViewerMessage = "true";
    element.textContent = message;
    this.container?.append(element);
  }

  removeViewerMessage() {
    this.container?.querySelector("[data-pdf-viewer-message]")?.remove();
  }

  appendDocumentHeader() {
    if (!this.container || !this.viewerElement || !this.document) return;
    this.documentHeader?.remove();
    const header = document.createElement("div");
    header.className = "ym-pdf-markup-document-header";
    const name = document.createElement("strong");
    name.textContent = this.document.fileName;
    const position = document.createElement("span");
    position.className = "ym-pdf-markup-document-position";
    position.textContent = `Document ${
      this.documentIndex + 1
    } of ${this.documents.length}`;
    header.append(name, position);
    this.container.insertBefore(header, this.viewerElement);
    this.documentHeader = header;
  }

  appendDocumentFooter() {
    if (!this.container || !this.document) return;
    this.documentFooter?.remove();
    const footer = document.createElement("div");
    footer.className = "ym-pdf-markup-document-footer";
    const adjacent = this.documents[this.documentIndex + 1];
    if (adjacent) {
      footer.append("Continue scrolling for ");
      const name = document.createElement("strong");
      name.textContent = adjacent.fileName;
      footer.append(name);
    } else {
      footer.textContent = "End of folder";
    }
    this.container.append(footer);
    this.documentFooter = footer;
  }

  async loadDocumentData(document) {
    if (!document?.dataUrl || document.dataLoaded) return;
    const response = await fetch(document.dataUrl, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Unable to load markup data for ${document.fileName} (${response.status})`,
      );
    }
    const data = await response.json();
    document.annotations = normalizeAnnotations(data?.annotations).map(
      (annotation) => cloneAnnotation(annotation),
    );
    document.rotations = normalizeRotations(data?.rotations);
    if (data?.revision !== undefined) {
      document.revision = Math.max(
        0,
        Math.trunc(Number(data.revision || 0)),
      );
    }
    document.dataLoaded = true;
  }

  syncDocumentUrl() {
    if (!this.document?.href || typeof history?.replaceState !== "function") {
      return;
    }
    const target = new URL(this.document.href, globalThis.location?.href);
    if (target.origin !== globalThis.location?.origin) return;
    const current = new URL(globalThis.location?.href);
    if (this.evidenceFocus && target.pathname === current.pathname) {
      target.search = current.search;
      target.hash = current.hash;
    }
    if (
      `${target.pathname}${target.search}${target.hash}` !==
        `${globalThis.location?.pathname}${globalThis.location?.search}${globalThis.location?.hash}`
    ) {
      history.replaceState(history.state, "", target);
    }
    const workspacePaths = new Map(
      this.documents.filter((document) => document.href).map((document) => {
        const url = new URL(document.href, globalThis.location.href);
        return [
          `${url.pathname}${url.search}${url.hash}`,
          document.key,
        ];
      }),
    );
    for (const anchor of document.querySelectorAll("a[href]")) {
      const url = new URL(
        anchor.getAttribute("href"),
        globalThis.location.href,
      );
      const path = `${url.pathname}${url.search}${url.hash}`;
      if (workspacePaths.has(path)) {
        anchor.setAttribute(
          "aria-selected",
          workspacePaths.get(path) === this.document.key ? "true" : "false",
        );
      }
    }
  }

  syncDocumentAccess() {
    this.readOnly = this.configuredReadOnly || !this.document ||
      this.document.canEdit === false;
    if (this.container) {
      this.container.dataset.readOnly = this.readOnly ? "true" : "false";
    }
  }

  workspacePayload(extra = {}) {
    return {
      page: this.currentPage,
      pageCount: this.pageCount,
      scale: this.scale,
      zoomPercent: Math.round(this.scale * 100),
      dirty: this.dirty,
      documentKey: this.document?.key || "",
      fileItemId: this.document?.fileItemId || "",
      documentIndex: this.documentIndex,
      documentCount: this.documents.length,
      fileName: this.document?.fileName || "",
      revision: this.document?.revision || 0,
      contextKey: this.document?.contextKey || "",
      canEdit: !this.readOnly,
      changeSequence: this.changeSequence,
      ...extra,
    };
  }

  pageRotation(pageNumber, page) {
    const pdfRotation = Number(page?.rotate || 0);
    const userRotation = Number(this.rotations[pageNumber] || 0) * 90;
    return ((pdfRotation + userRotation) % 360 + 360) % 360;
  }

  persistDocumentState() {
    if (!this.document) return;
    this.flushTextEdits();
    this.document.annotations = this.annotations;
    this.document.rotations = this.rotations;
    this.document.page = this.currentPage;
    this.document.changeSequence = this.changeSequence;
    this.document.dirty = this.dirty;
  }

  async closeDocument() {
    this.pageViews.clear();
    this.documentHeader?.remove();
    this.documentFooter?.remove();
    this.documentHeader = null;
    this.documentFooter = null;
    this.pagesRoot = null;
    this.pdfViewer?.setDocument(null);
    this.pdfLinkService?.setDocument(null);
    const loadingTask = this.loadingTask;
    this.loadingTask = null;
    this.pdf = null;
    if (loadingTask?.destroy) {
      await loadingTask.destroy();
    }
  }

  async changeDocument(target) {
    const index = typeof target === "string"
      ? this.documents.findIndex((document) => document.key === target)
      : Math.trunc(Number(target));
    if (
      this.documentLoading || this.pendingRotation || index < 0 ||
      index >= this.documents.length ||
      index === this.documentIndex
    ) {
      return;
    }
    this.documentLoading = true;
    try {
      this.persistDocumentState();
      await this.closeDocument();
      if (this.destroyed) return;
      this.documentIndex = index;
      this.document = this.documents[index];
      this.evidenceFocus = null;
      this.evidenceFocusScrolled = false;
      await this.openDocument();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.container) {
        this.showViewerMessage(message, "ym-pdf-markup-error");
      }
      emit("error", { handle: this.handle, json: { message } });
    } finally {
      this.documentLoading = false;
    }
  }

  async requestDocumentChange(target, targetPage = 1) {
    const requestedIndex = typeof target === "string"
      ? this.documents.findIndex((document) => document.key === target)
      : Math.trunc(Number(target));
    if (
      this.documentLoading || this.pendingRotation || requestedIndex < 0 ||
      requestedIndex >= this.documents.length ||
      requestedIndex === this.documentIndex
    ) return;
    const index = requestedIndex;
    if (!this.readOnly && this.dirty) {
      emit("documentNavigationRequested", {
        handle: this.handle,
        json: this.workspacePayload({ targetDocumentIndex: index, targetPage }),
      });
      return;
    }
    await this.changeDocument(index);
    if (targetPage === "last") {
      await this.setPage(this.pageCount);
      this.scrollToDocumentEnd();
    } else {
      await this.setPage(targetPage);
    }
  }

  async setDocuments(config) {
    while (
      (this.documentLoading || this.pendingRotation) && !this.destroyed
    ) {
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    if (this.destroyed) return false;
    const onePageRendered = this.pdfViewer?.onePageRendered;
    if (onePageRendered) {
      await onePageRendered.catch(() => {});
    }
    if (this.destroyed) return false;
    const replacementScale = this.effectiveScale();
    if (this.previewRaf !== null) {
      cancelAnimationFrame(this.previewRaf);
      this.previewRaf = null;
    }
    this.pendingPreview = null;
    this.previewScale = null;
    this.previewAnchor = null;
    if (this.zoomCommitTimer !== null) {
      clearTimeout(this.zoomCommitTimer);
      this.zoomCommitTimer = null;
    }
    if (this.pagesRoot) this.pagesRoot.style.zoom = "";
    this.scale = replacementScale;
    const fitWidthOnLoad = this.fitWidthOnLoad;
    this.fitWidthOnLoad = false;
    this.documentLoading = true;
    try {
      await this.closeDocument();
      if (this.destroyed) return false;
      this.documents = normalizeDocuments(config);
      const initialDocumentKey = String(config.initialDocumentKey ?? "");
      const requestedIndex = this.documents.findIndex((document) =>
        document.key === initialDocumentKey
      );
      this.documentIndex = requestedIndex >= 0 ? requestedIndex : 0;
      this.document = this.documents[this.documentIndex];
      this.dirty = false;
      await this.openDocument();
      if (this.pdf && this.pdfViewer) {
        this.pdfViewer.currentScale = replacementScale;
        this.scale = this.pdfViewer.currentScale;
      }
      if (!this.pdf) {
        // The replacement set has no loadable PDF; reset viewer state so the
        // host UI does not keep counts from the previous document set.
        this.pageCount = 0;
        this.currentPage = 1;
        this.annotations = [];
        this.selectedAnnotationId = null;
        this.undoStack = [];
        this.redoStack = [];
        emit("documentChanged", {
          handle: this.handle,
          json: this.workspacePayload(),
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.container) {
        this.showViewerMessage(message, "ym-pdf-markup-error");
      }
      emit("error", { handle: this.handle, json: { message } });
      return false;
    } finally {
      this.documentLoading = false;
      this.fitWidthOnLoad = fitWidthOnLoad;
    }
  }

  scrollToDocumentEnd() {
    if (!this.container) return;
    this.container.scrollTop = Math.max(
      0,
      this.container.scrollHeight - this.container.clientHeight,
    );
  }

  resetBoundaryNavigation() {
    this.boundaryWheelDelta = 0;
    this.boundaryNavigationPending = false;
    if (this.boundaryNavigationResetTimer !== null) {
      clearTimeout(this.boundaryNavigationResetTimer);
      this.boundaryNavigationResetTimer = null;
    }
  }

  queueBoundaryNavigation(target, targetPage) {
    if (this.boundaryNavigationPending) return;
    this.boundaryNavigationPending = true;
    this.boundaryWheelDelta = 0;
    this.boundaryNavigationResetTimer = setTimeout(() => {
      this.boundaryNavigationPending = false;
      this.boundaryNavigationResetTimer = null;
    }, DOCUMENT_BOUNDARY_RESET_MS);
    void this.requestDocumentChange(target, targetPage);
  }

  async rotatePage(delta) {
    if (!this.pdf || !this.currentPage || this.pendingRotation) return;
    const page = this.currentPage;
    const previousQuarterTurns = Number(this.rotations[page] || 0);
    const quarterTurns =
      ((previousQuarterTurns + Math.trunc(Number(delta || 0))) % 4 + 4) % 4;
    const requestId = newId();
    if (!this.readOnly) {
      this.pendingRotation = { requestId, page, previousQuarterTurns };
    }
    if (quarterTurns) {
      this.rotations[page] = quarterTurns;
    } else {
      delete this.rotations[page];
    }
    this.document.rotations = this.rotations;
    try {
      await this.renderRotatedPage(page);
    } catch (error) {
      this.restorePageRotation(page, previousQuarterTurns);
      this.pendingRotation = null;
      throw error;
    }
    emit("rotationChanged", {
      handle: this.handle,
      json: this.workspacePayload({
        page,
        quarterTurns,
        previousQuarterTurns,
        requestId,
      }),
    });
  }

  renderRotatedPage(page) {
    const pageView = this.getPageView(page);
    if (!pageView) return;
    const rotation = Number(this.rotations[pageView.pageNumber] || 0) * 90;
    pageView.pdfPageView.update({ rotation });
    this.pdfViewer.update();
    this.syncPageSurface(pageView.pageNumber);
    this.renderAnnotations(pageView.pageNumber);
    this.renderTextLayer(page);
  }

  restorePageRotation(page, quarterTurns) {
    if (quarterTurns) {
      this.rotations[page] = quarterTurns;
    } else {
      delete this.rotations[page];
    }
    this.document.rotations = this.rotations;
  }

  completeRotation(requestId) {
    if (this.pendingRotation?.requestId !== requestId) return false;
    this.pendingRotation = null;
    return true;
  }

  async rejectRotation(requestId) {
    if (this.pendingRotation?.requestId !== requestId) return false;
    const { page, previousQuarterTurns } = this.pendingRotation;
    this.pendingRotation = null;
    this.restorePageRotation(page, previousQuarterTurns);
    await this.renderRotatedPage(page);
    return true;
  }

  activate() {
    // Read-only viewers never own editor shortcuts (Ctrl+S/Z/Y); letting a
    // preview take the handle would silently disable them in an editor on
    // the same page.
    if (this.readOnly) return;
    activeViewerHandle = this.handle;
  }

  onKeyDown(event) {
    if (!this.container || event.defaultPrevented) return;
    const key = String(event.key || "");
    const lower = key.toLowerCase();
    const target = event.target;
    const targetIsElement = target instanceof Element;
    const editableTarget = targetIsElement &&
      (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable);
    // Keyboard ownership follows focus, not hover: focus is unique across
    // viewers (routing stays deterministic with several on one page) and a
    // merely-hovered viewer never steals Space/Escape/zoom keys from the
    // host page. Pointer interactions and toolbar commands focus the
    // container, so any engaged viewer receives its shortcuts.
    const withinViewer = this.container.contains(document.activeElement) ||
      (targetIsElement && this.container.contains(target));

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (["=", "+", "-", "_", "0", "1", "2"].includes(key)) {
        if (!withinViewer) return;
        event.preventDefault();
        if (key === "=" || key === "+") {
          this.setScale(this.effectiveScale() * ZOOM_STEP);
        } else if (key === "-" || key === "_") {
          this.setScale(this.effectiveScale() / ZOOM_STEP);
        } else if (key === "0") {
          this.fitPage();
        } else if (key === "1") {
          this.setScale(1);
        } else if (key === "2") {
          this.fitWidth();
        }
        return;
      }
      if (this.readOnly || activeViewerHandle !== this.handle) return;
      const targetIsExternalEditable = editableTarget &&
        !this.container.contains(target);
      if (targetIsExternalEditable) return;
      if (lower === "s") {
        event.preventDefault();
        emit("saveRequested", {
          handle: this.handle,
          json: this.statePayload(),
        });
      } else if (lower === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      } else if (lower === "y") {
        event.preventDefault();
        this.redo();
      }
      return;
    }

    if (event.altKey) return;
    if (key === " " || event.code === "Space") {
      if (editableTarget || !withinViewer) return;
      event.preventDefault();
      if (!event.repeat && !this.spacePan) {
        this.spacePan = true;
        this.updateCursors();
      }
      return;
    }
    if (key === "Escape") {
      if (!withinViewer) return;
      this.handleEscape(event);
      return;
    }
    if (this.readOnly || editableTarget || !withinViewer || event.repeat) {
      return;
    }
    if (lower === "h") {
      event.preventDefault();
      this.applyTool("hand");
    } else if (lower === "v") {
      event.preventDefault();
      this.applyTool("select");
    }
  }

  onKeyUp(event) {
    if (event.key === " " || event.code === "Space") {
      if (this.spacePan) {
        this.spacePan = false;
        this.updateCursors();
      }
    }
  }

  onWindowBlur() {
    if (this.spacePan) {
      this.spacePan = false;
      this.updateCursors();
    }
  }

  handleEscape(event) {
    if (this.draft) {
      event.preventDefault();
      this.cancelDraft();
      return;
    }
    if (this.textEditId) {
      event.preventDefault();
      const element = this.findTextElement(this.textEditId);
      const annotation = this.getAnnotationById(this.textEditId);
      this.textEditId = null;
      element?.blur();
      this.selectedAnnotationId = null;
      this.syncTextSelection();
      this.renderAnnotations(annotation?.page);
      this.emitSelectionChanged(null);
      return;
    }
    if (this.selectedAnnotationId) {
      event.preventDefault();
      const selected = this.getAnnotationById(this.selectedAnnotationId);
      this.selectedAnnotationId = null;
      this.syncTextSelection();
      this.renderAnnotations(selected?.page);
      this.emitSelectionChanged(null);
      return;
    }
    if (!this.readOnly && this.tool !== "hand") {
      event.preventDefault();
      this.applyTool("hand");
    }
  }

  applyTool(tool) {
    this.setTool(tool);
    emit("toolChanged", {
      handle: this.handle,
      json: { tool: this.tool },
    });
  }

  onBeforeUnload(event) {
    if (this.readOnly || !this.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  }

  createPageViews() {
    this.pageViews.clear();
    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
      const pdfPageView = this.pdfViewer.getPageView(pageNumber - 1);
      const stage = pdfPageView.div;
      stage.classList.add("ym-pdf-markup-stage");
      stage.dataset.page = String(pageNumber);
      this.pageViews.set(pageNumber, {
        pageNumber,
        stage,
        pdfPageView,
        overlayCanvas: null,
        textLayer: null,
        overlayContext: null,
        pageWidth: 0,
        pageHeight: 0,
        viewport: pdfPageView.viewport,
      });
    }
    this.syncPageSurfaces();
  }

  applyPageRotations() {
    for (const pageView of this.pageViews.values()) {
      const rotation = Number(this.rotations[pageView.pageNumber] || 0) * 90;
      if (pageView.pdfPageView.rotation !== rotation) {
        pageView.pdfPageView.update({ rotation });
      }
    }
    this.pdfViewer.update();
  }

  mountPageSurface(pageView) {
    if (!pageView.overlayCanvas) {
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.className = "ym-pdf-markup-overlay";
      overlayCanvas.dataset.page = String(pageView.pageNumber);
      const textLayer = document.createElement("div");
      textLayer.className = "ym-pdf-markup-text-layer";
      textLayer.dataset.page = String(pageView.pageNumber);
      overlayCanvas.addEventListener(
        "pointerdown",
        (event) => this.onPointerDown(event),
      );
      overlayCanvas.addEventListener(
        "pointermove",
        (event) => this.onPointerMove(event),
      );
      overlayCanvas.addEventListener(
        "pointerup",
        (event) => this.onPointerUp(event),
      );
      overlayCanvas.addEventListener(
        "pointercancel",
        (event) => this.onPointerUp(event),
      );
      pageView.overlayCanvas = overlayCanvas;
      pageView.textLayer = textLayer;
      pageView.overlayContext = overlayCanvas.getContext("2d");
    }
    if (pageView.overlayCanvas.parentElement !== pageView.stage) {
      pageView.stage.append(pageView.overlayCanvas, pageView.textLayer);
    }
    this.updateCursors();
  }

  syncPageSurfaces() {
    for (const pageView of this.pageViews.values()) {
      this.syncPageSurface(pageView.pageNumber);
    }
  }

  syncPageSurface(pageNumber) {
    const pageView = this.pageViews.get(Number(pageNumber));
    if (!pageView) return;
    const pdfPageView = pageView.pdfPageView;
    pageView.viewport = pdfPageView.viewport;
    const pdfPage = pdfPageView.pdfPage;
    if (pdfPage) {
      const baseViewport = pdfPage.getViewport({
        scale: 1,
        rotation: this.pageRotation(pageView.pageNumber, pdfPage),
      });
      pageView.pageWidth = baseViewport.width;
      pageView.pageHeight = baseViewport.height;
    } else if (pageView.viewport?.scale) {
      pageView.pageWidth = pageView.viewport.width / pageView.viewport.scale;
      pageView.pageHeight = pageView.viewport.height / pageView.viewport.scale;
    }
    const width = Math.max(1, pageView.viewport?.width || 1);
    const height = Math.max(1, pageView.viewport?.height || 1);
    if (!this.stageNearViewport(pageView)) {
      if (pageView.overlayCanvas) {
        pageView.overlayCanvas.width = 1;
        pageView.overlayCanvas.height = 1;
        pageView.overlayCanvas.remove();
        pageView.textLayer.remove();
        pageView.dpr = 1;
      }
      return;
    }
    this.mountPageSurface(pageView);
    pageView.overlayCanvas.style.width = `${width}px`;
    pageView.overlayCanvas.style.height = `${height}px`;
    pageView.textLayer.style.width = `${width}px`;
    pageView.textLayer.style.height = `${height}px`;
    const rawDpr = globalThis.devicePixelRatio || 1;
    const dpr = Math.min(
      rawDpr,
      MAX_CANVAS_DIMENSION / Math.max(width, height),
      Math.sqrt(MAX_OVERLAY_CANVAS_PIXELS / Math.max(1, width * height)),
    );
    const renderWidth = Math.max(1, Math.ceil(width * dpr));
    const renderHeight = Math.max(1, Math.ceil(height * dpr));
    if (
      pageView.overlayCanvas.width !== renderWidth ||
      pageView.overlayCanvas.height !== renderHeight
    ) {
      pageView.overlayCanvas.width = renderWidth;
      pageView.overlayCanvas.height = renderHeight;
    }
    pageView.dpr = dpr;
    pageView.overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderEvidenceFocus(pageNumber);
  }

  renderEvidenceFocus(pageNumber) {
    const pageView = this.pageViews.get(Number(pageNumber));
    if (!pageView) return;
    let element = pageView.stage.querySelector(".ym-pdf-evidence-focus");
    if (
      !this.evidenceFocus || this.evidenceFocus.page !== pageView.pageNumber
    ) {
      element?.remove();
      return;
    }
    if (!element) {
      element = document.createElement("div");
      element.className = "ym-pdf-evidence-focus";
      element.setAttribute("role", "region");
      element.setAttribute("aria-label", "Evidence focus");
      const label = document.createElement("span");
      label.className = "ym-pdf-evidence-focus-label";
      label.textContent = "Evidence focus";
      element.append(label);
      pageView.stage.append(element);
    }
    const renderedWidth = Math.max(1, pageView.viewport?.width || 1);
    const scale = renderedWidth / this.evidenceFocus.renderWidth;
    element.style.left = `${this.evidenceFocus.x * scale}px`;
    element.style.top = `${this.evidenceFocus.y * scale}px`;
    element.style.width = `${this.evidenceFocus.width * scale}px`;
    element.style.height = `${this.evidenceFocus.height * scale}px`;

    if (
      !this.evidenceFocusScrolled && pageView.pageNumber === this.currentPage
    ) {
      this.evidenceFocusScrolled = true;
      requestAnimationFrame(() => {
        if (!this.container || !element?.isConnected) return;
        const containerRect = this.container.getBoundingClientRect();
        const focusRect = element.getBoundingClientRect();
        this.container.scrollTop += focusRect.top - containerRect.top - 100;
        this.container.scrollLeft += focusRect.left - containerRect.left -
          Math.max(24, (containerRect.width - focusRect.width) / 2);
      });
    }
  }

  pageScale(pageNumber = this.currentPage) {
    return this.getPageView(pageNumber)?.viewport?.scale || this.scale;
  }

  effectiveScale() {
    return this.pendingPreview?.scale ?? this.previewScale ?? this.scale;
  }

  updateCursors() {
    if (!this.container) return;
    const panning = Boolean(this.pan || this.pinch);
    this.container.dataset.panning = panning ? "true" : "false";
    this.container.dataset.spacePan = this.spacePan ? "true" : "false";
    const overlayCursor = panning
      ? "grabbing"
      : this.spacePan || this.tool === "hand"
      ? "grab"
      : this.tool === "select"
      ? "default"
      : this.tool === "text"
      ? "text"
      : "crosshair";
    for (const pageView of this.pageViews.values()) {
      if (pageView.overlayCanvas) {
        pageView.overlayCanvas.style.cursor = overlayCursor;
      }
    }
    this.container.style.cursor = panning
      ? "grabbing"
      : this.spacePan || this.tool === "hand"
      ? "grab"
      : "";
  }

  isScrollbarPointerDown(event) {
    if (event.target !== this.container) return false;
    const rect = this.container.getBoundingClientRect();
    return event.clientX - rect.left >= this.container.clientWidth ||
      event.clientY - rect.top >= this.container.clientHeight;
  }

  // Single pan-intent predicate shared by the gesture router and the
  // text-note/resize-handle handlers so a pointer that should pan is treated
  // the same no matter which element it lands on. Only the left button can
  // trigger tool-based panning; right/other buttons never pan (the context
  // menu would swallow the pointerup and leave a stuck pan).
  isPanTrigger(event) {
    if (event.button === 1) return true;
    if (event.button !== 0) return false;
    return (
      this.spacePan || this.tool === "hand" || this.readOnly ||
      (event.pointerType === "touch" && this.penMode)
    );
  }

  // Capture-phase bookkeeping for every pointerdown inside the container.
  // Runs before element handlers, so touches are tracked even when a
  // text-note handler stops propagation, keeping pinch detection correct.
  onContainerPointerDownCapture(event) {
    this.activate();
    this.cancelInertia();
    if (event.pointerType === "pen") {
      this.penMode = true;
      return;
    }
    if (event.pointerType !== "touch") return;
    this.touchPoints.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (this.touchPoints.size === 2) {
      event.stopPropagation();
      this.onSecondTouchDown(event);
    } else if (this.touchPoints.size > 2) {
      event.stopPropagation();
    }
  }

  // Pointerdown routing for pan gestures (touch tracking already happened in
  // the capture phase). Returns true when the event was consumed by a
  // navigation gesture and tool logic must not run.
  handleGesturePointerDown(event, fromOverlay) {
    if (this.isPanTrigger(event)) {
      this.startPan(event);
      return true;
    }
    if (event.pointerType === "touch" && event.button === 0) {
      if (!fromOverlay) {
        this.startPan(event);
        return true;
      }
      if (this.tool === "select") {
        const pageView = this.getPageViewFromEvent(event);
        const hit = pageView?.viewport
          ? this.hitTest(this.eventPoint(event, pageView), pageView.pageNumber)
          : null;
        if (!hit) {
          this.startPan(event);
          return true;
        }
      }
    }
    return false;
  }

  onSecondTouchDown(event) {
    if (this.draft && this.draftInfo?.pointerType === "touch") {
      if (performance.now() - this.draftInfo.startedAt <= PINCH_GRACE_MS) {
        this.cancelDraft();
      } else {
        this.touchPoints.delete(event.pointerId);
        return;
      }
    } else if (this.draft || this.drag || this.resize) {
      this.touchPoints.delete(event.pointerId);
      return;
    }
    this.startPinch();
  }

  cancelDraft() {
    if (!this.draft) return;
    const page = this.draft.page;
    this.draft = null;
    this.draftInfo = null;
    this.activePointerId = null;
    this.renderAnnotations(page);
  }

  onContainerPointerDown(event) {
    if (event.ymPdfMarkupHandled) return;
    if (this.isScrollbarPointerDown(event)) return;
    if (
      this.readOnly && event.pointerType !== "touch" &&
      event.target instanceof Element &&
      event.target.classList.contains("ym-pdf-markup-text-note")
    ) {
      // Let mouse/pen select the text of read-only notes; touch still pans.
      return;
    }
    this.handleGesturePointerDown(event, false);
  }

  onContainerPointerMove(event) {
    const touch = this.touchPoints.get(event.pointerId);
    if (touch) {
      touch.x = event.clientX;
      touch.y = event.clientY;
    }
    if (this.pinch?.ids.includes(event.pointerId)) {
      this.updatePinch();
      return;
    }
    if (this.pan && event.pointerId === this.pan.pointerId) {
      this.updatePan(event);
    }
  }

  onContainerPointerUp(event) {
    this.touchPoints.delete(event.pointerId);
    if (this.pinch?.ids.includes(event.pointerId)) {
      this.endPinch();
      return;
    }
    if (this.pan && event.pointerId === this.pan.pointerId) {
      this.endPan(event);
    }
  }

  onContainerPointerCancel(event) {
    this.touchPoints.delete(event.pointerId);
    if (this.pinch?.ids.includes(event.pointerId)) {
      this.endPinch();
      return;
    }
    if (this.pan && event.pointerId === this.pan.pointerId) {
      this.endPan(event, { allowInertia: false });
    }
  }

  startPan(event) {
    this.endPan(null, { allowInertia: false });
    this.pan = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      lastX: event.clientX,
      lastY: event.clientY,
      samples: [{
        t: performance.now(),
        x: event.clientX,
        y: event.clientY,
      }],
    };
    try {
      this.container.setPointerCapture(event.pointerId);
    } catch {
      // Pointer may already be gone; panning still works via bubbled moves.
    }
    this.container.focus?.({ preventScroll: true });
    event.preventDefault();
    this.updateCursors();
  }

  updatePan(event) {
    const pan = this.pan;
    if (!pan || !this.container) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      // The pointerup was swallowed (e.g. by a context menu); end the pan
      // instead of scrolling under a released mouse.
      this.endPan(event, { allowInertia: false });
      return;
    }
    this.container.scrollLeft -= event.clientX - pan.lastX;
    this.container.scrollTop -= event.clientY - pan.lastY;
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
    const now = performance.now();
    pan.samples.push({ t: now, x: event.clientX, y: event.clientY });
    while (pan.samples.length > 1 && now - pan.samples[0].t > 120) {
      pan.samples.shift();
    }
  }

  endPan(event, { allowInertia = true } = {}) {
    const pan = this.pan;
    if (!pan) return;
    this.pan = null;
    try {
      this.container?.releasePointerCapture(pan.pointerId);
    } catch {
      // Capture may already be released.
    }
    if (allowInertia && pan.pointerType === "touch" && event) {
      const now = performance.now();
      pan.samples.push({ t: now, x: event.clientX, y: event.clientY });
      const oldest = pan.samples.find((sample) => now - sample.t <= 120) ??
        pan.samples[0];
      const dt = now - oldest.t;
      if (dt > 15) {
        this.startInertia(
          (event.clientX - oldest.x) / dt,
          (event.clientY - oldest.y) / dt,
        );
      }
    }
    this.updateCursors();
  }

  startPinch() {
    this.endPan(null, { allowInertia: false });
    const ids = [...this.touchPoints.keys()].slice(0, 2);
    const [a, b] = ids.map((id) => this.touchPoints.get(id));
    this.pinch = {
      ids,
      startDistance: Math.max(20, Math.hypot(b.x - a.x, b.y - a.y)),
      startScale: this.effectiveScale(),
      lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    for (const id of ids) {
      try {
        this.container.setPointerCapture(id);
      } catch {
        // Ignore pointers that can no longer be captured.
      }
    }
    this.updateCursors();
  }

  updatePinch() {
    const pinch = this.pinch;
    if (!pinch || !this.container) return;
    const points = pinch.ids.map((id) => this.touchPoints.get(id));
    if (points.some((point) => !point)) return;
    const [a, b] = points;
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.container.scrollLeft -= center.x - pinch.lastCenter.x;
    this.container.scrollTop -= center.y - pinch.lastCenter.y;
    pinch.lastCenter = center;
    const distance = Math.max(20, Math.hypot(b.x - a.x, b.y - a.y));
    const target = clamp(
      pinch.startScale * (distance / pinch.startDistance),
      MIN_SCALE,
      MAX_SCALE,
    );
    this.previewZoomAt(target, center.x, center.y);
  }

  endPinch() {
    const pinch = this.pinch;
    if (!pinch) return;
    this.pinch = null;
    for (const id of pinch.ids) {
      try {
        this.container?.releasePointerCapture(id);
      } catch {
        // Capture may already be released.
      }
    }
    this.scheduleZoomCommit();
    const remainingId = pinch.ids.find((id) => this.touchPoints.has(id));
    if (remainingId !== undefined) {
      const point = this.touchPoints.get(remainingId);
      this.pan = {
        pointerId: remainingId,
        pointerType: "touch",
        lastX: point.x,
        lastY: point.y,
        samples: [{ t: performance.now(), x: point.x, y: point.y }],
      };
      try {
        this.container.setPointerCapture(remainingId);
      } catch {
        // Ignore pointers that can no longer be captured.
      }
    }
    this.updateCursors();
  }

  startInertia(velocityX, velocityY) {
    if (Math.hypot(velocityX, velocityY) < INERTIA_START_MIN_VELOCITY) return;
    let vx = velocityX;
    let vy = velocityY;
    let last = performance.now();
    const step = (now) => {
      this.inertiaRaf = null;
      if (!this.container) return;
      const dt = Math.min(64, now - last);
      last = now;
      this.container.scrollLeft -= vx * dt;
      this.container.scrollTop -= vy * dt;
      const decay = Math.exp(-dt / INERTIA_TIME_CONSTANT_MS);
      vx *= decay;
      vy *= decay;
      if (Math.max(Math.abs(vx), Math.abs(vy)) > INERTIA_MIN_VELOCITY) {
        this.inertiaRaf = requestAnimationFrame(step);
      }
    };
    this.inertiaRaf = requestAnimationFrame(step);
  }

  cancelInertia() {
    if (this.inertiaRaf !== null) {
      cancelAnimationFrame(this.inertiaRaf);
      this.inertiaRaf = null;
    }
  }

  onWheel(event) {
    this.cancelInertia();
    let delta = event.deltaY;
    if (event.deltaMode === 1) {
      delta *= 16;
    } else if (event.deltaMode === 2) {
      delta *= 100;
    }
    if (!event.ctrlKey && !event.metaKey) {
      if (
        !this.container || this.documents.length <= 1 ||
        this.documentLoading || this.pendingRotation
      ) {
        this.boundaryWheelDelta = 0;
        return;
      }
      const maxScrollTop = Math.max(
        0,
        this.container.scrollHeight - this.container.clientHeight,
      );
      const atStart = this.container.scrollTop <= 2;
      const atEnd = this.container.scrollTop >= maxScrollTop - 2;
      const forward = delta > 0 && atEnd &&
        this.documentIndex < this.documents.length - 1;
      const backward = delta < 0 && atStart && this.documentIndex > 0;
      if (!forward && !backward) {
        this.boundaryWheelDelta = 0;
        return;
      }
      event.preventDefault();
      this.activate();
      this.boundaryWheelDelta += Math.abs(delta);
      if (this.boundaryWheelDelta < DOCUMENT_BOUNDARY_WHEEL_THRESHOLD) return;
      if (forward) {
        this.queueBoundaryNavigation(this.documentIndex + 1, 1);
      } else {
        this.queueBoundaryNavigation(this.documentIndex - 1, "last");
      }
      return;
    }
    event.preventDefault();
    this.activate();
    delta = clamp(delta, -240, 240);
    const target = clamp(
      this.effectiveScale() * Math.pow(2, -delta * WHEEL_ZOOM_SENSITIVITY),
      MIN_SCALE,
      MAX_SCALE,
    );
    this.previewZoomAt(target, event.clientX, event.clientY);
  }

  // Zoom preview: scale the already-rendered pages with CSS zoom so wheel and
  // pinch feel instant, keeping the content under the anchor point fixed. The
  // crisp re-render happens in commitZoom after the gesture settles.
  // Applications are coalesced to one per animation frame — wheel and pinch
  // events fire far more often than frames, and each application forces a
  // layout of every page stage.
  previewZoomAt(target, clientX, clientY) {
    if (!this.container || !this.pagesRoot) return;
    this.pendingPreview = {
      scale: clamp(Number(target) || this.scale, MIN_SCALE, MAX_SCALE),
      clientX,
      clientY,
    };
    if (this.previewRaf === null) {
      this.previewRaf = requestAnimationFrame(() => {
        this.previewRaf = null;
        this.flushPreviewZoom();
      });
    }
    this.scheduleZoomCommit();
  }

  flushPreviewZoom() {
    const pending = this.pendingPreview;
    if (!pending || !this.container || !this.pagesRoot) return;
    this.pendingPreview = null;
    const next = pending.scale;
    const clientX = pending.clientX;
    const clientY = pending.clientY;
    this.previewAnchor = { clientX, clientY };
    if (!this.cssZoomSupported) {
      this.previewScale = next;
      return;
    }
    const rect = this.container.getBoundingClientRect();
    const offX = clamp(clientX - rect.left, 0, rect.width);
    const offY = clamp(clientY - rect.top, 0, rect.height);
    const factorOld = (this.previewScale ?? this.scale) / this.scale;
    const factorNew = next / this.scale;
    if (Math.abs(factorNew - factorOld) > 0.0005) {
      const contentX = (this.container.scrollLeft + offX) / factorOld;
      const contentY = (this.container.scrollTop + offY) / factorOld;
      this.pagesRoot.style.zoom = factorNew === 1 ? "" : String(factorNew);
      this.previewScale = next;
      this.container.scrollLeft = contentX * factorNew - offX;
      this.container.scrollTop = contentY * factorNew - offY;
    } else {
      this.previewScale = next;
    }
  }

  captureZoomAnchor(clientX, clientY) {
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const pageView of this.pageViews.values()) {
      const rect = pageView.stage.getBoundingClientRect();
      const distance = clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom
        ? clientY - rect.bottom
        : 0;
      if (distance >= closestDistance) continue;
      closest = { pageView, rect };
      closestDistance = distance;
      if (distance === 0) break;
    }
    if (!closest || closest.rect.width <= 0 || closest.rect.height <= 0) {
      return null;
    }
    return {
      pageNumber: closest.pageView.pageNumber,
      clientX,
      clientY,
      xRatio: clamp(
        (clientX - closest.rect.left) / closest.rect.width,
        0,
        1,
      ),
      yRatio: clamp(
        (clientY - closest.rect.top) / closest.rect.height,
        0,
        1,
      ),
    };
  }

  restoreZoomAnchor(anchor) {
    if (!anchor || !this.container) return;
    const pageView = this.pageViews.get(anchor.pageNumber);
    if (!pageView) return;
    const rect = pageView.stage.getBoundingClientRect();
    this.container.scrollLeft += rect.left + anchor.xRatio * rect.width -
      anchor.clientX;
    this.container.scrollTop += rect.top + anchor.yRatio * rect.height -
      anchor.clientY;
  }

  scheduleZoomCommit() {
    if (this.zoomCommitTimer !== null) clearTimeout(this.zoomCommitTimer);
    this.zoomCommitTimer = setTimeout(() => {
      this.zoomCommitTimer = null;
      this.commitZoom();
    }, ZOOM_COMMIT_DELAY_MS);
  }

  commitZoom() {
    if (this.zoomCommitTimer !== null) {
      clearTimeout(this.zoomCommitTimer);
      this.zoomCommitTimer = null;
    }
    if (this.pinch) {
      this.scheduleZoomCommit();
      return;
    }
    if (this.previewRaf !== null) {
      cancelAnimationFrame(this.previewRaf);
      this.previewRaf = null;
    }
    this.flushPreviewZoom();
    const target = this.previewScale;
    if (target === null) return;
    const fallbackRect = this.container.getBoundingClientRect();
    const previewAnchor = this.previewAnchor ?? {
      clientX: fallbackRect.left + fallbackRect.width / 2,
      clientY: fallbackRect.top + fallbackRect.height / 2,
    };
    const zoomAnchor = this.captureZoomAnchor(
      previewAnchor.clientX,
      previewAnchor.clientY,
    );
    this.previewScale = null;
    this.previewAnchor = null;
    if (Math.abs(target - this.scale) < 0.001) {
      if (this.pagesRoot) this.pagesRoot.style.zoom = "";
      return;
    }
    if (this.pagesRoot) this.pagesRoot.style.zoom = "";
    this.pdfViewer.currentScale = target;
    this.scale = this.pdfViewer.currentScale;
    this.restoreZoomAnchor(zoomAnchor);
    this.syncPageSurfaces();
  }

  emitZoomChanged() {
    emit("zoomChanged", {
      handle: this.handle,
      json: this.workspacePayload(),
    });
  }

  getPageView(pageNumber) {
    return this.pageViews.get(Number(pageNumber)) ??
      this.pageViews.get(this.currentPage);
  }

  getPageViewFromEvent(event) {
    const stage = event.target?.closest?.(".ym-pdf-markup-stage");
    if (!stage) return this.getPageView(this.currentPage);
    return this.getPageView(Number(stage.dataset.page));
  }

  pageAnnotations(pageNumber = this.currentPage) {
    return this.annotations.filter((annotation) =>
      Number(annotation.page) === Number(pageNumber)
    );
  }

  eventPoint(event, pageView = this.getPageViewFromEvent(event)) {
    const rect = pageView.overlayCanvas.getBoundingClientRect();
    // The on-screen rect can differ from the rendered viewport during a CSS
    // zoom preview; divide out that factor so points stay in viewport space.
    const factorX = rect.width / Math.max(1, pageView.viewport.width);
    const factorY = rect.height / Math.max(1, pageView.viewport.height);
    const viewportX = (event.clientX - rect.left) / (factorX || 1);
    const viewportY = (event.clientY - rect.top) / (factorY || 1);
    const [x, y] = pageView.viewport.convertToPdfPoint(viewportX, viewportY);
    return { x: rounded(x), y: rounded(y) };
  }

  viewportPoint(point, pageNumber = this.currentPage) {
    const pageView = this.getPageView(pageNumber);
    const [x, y] = pageView.viewport.convertToViewportPoint(point.x, point.y);
    return { x, y };
  }

  stageNearViewport(pageView) {
    const rect = this.container.getBoundingClientRect();
    const stageRect = pageView.stage.getBoundingClientRect();
    return stageRect.bottom >= rect.top - rect.height &&
      stageRect.top <= rect.bottom + rect.height;
  }

  renderAnnotations(pageNumber = this.currentPage) {
    const pageView = this.getPageView(pageNumber);
    if (!pageView?.overlayContext) return;
    const dpr = pageView.dpr || globalThis.devicePixelRatio || 1;
    const width = pageView.overlayCanvas?.width / dpr;
    const height = pageView.overlayCanvas?.height / dpr;
    const ctx = pageView.overlayContext;
    ctx.clearRect(0, 0, width, height);
    for (const annotation of this.pageAnnotations(pageNumber)) {
      this.drawAnnotation(ctx, annotation);
    }
    if (this.draft && Number(this.draft.page) === Number(pageNumber)) {
      this.drawAnnotation(ctx, this.draft);
    }
    if (this.selectedAnnotationId) {
      const selected = this.annotations.find((annotation) =>
        annotation.id === this.selectedAnnotationId
      );
      if (selected && Number(selected.page) === Number(pageNumber)) {
        this.drawSelection(ctx, selected);
      }
    }
  }

  renderAllTextLayers() {
    for (const pageView of this.pageViews.values()) {
      this.renderTextLayer(pageView.pageNumber);
    }
  }

  renderTextLayer(pageNumber = this.currentPage) {
    const pageView = this.getPageView(pageNumber);
    if (!pageView?.textLayer) return;
    const focusedId = document.activeElement?.dataset?.annotationId ||
      this.textEditId;
    pageView.textLayer.innerHTML = "";
    for (const annotation of this.pageAnnotations(pageNumber)) {
      if (annotation.type !== "text") continue;
      const element = document.createElement("textarea");
      element.className = "ym-pdf-markup-text-note";
      element.dataset.annotationId = annotation.id;
      element.dataset.selected = annotation.id === this.selectedAnnotationId
        ? "true"
        : "false";
      element.value = String(annotation.text || "");
      element.placeholder = "Text note";
      element.spellcheck = false;
      element.readOnly = this.readOnly;
      if (this.readOnly) {
        element.tabIndex = -1;
      }
      this.applyTextElementStyle(element, annotation);
      element.addEventListener("input", () => {
        const nextText = element.value;
        if (annotation.text !== nextText) {
          this.recordTextEditHistory(annotation.id);
          annotation.text = nextText;
          this.markDirty();
        }
        this.resizeTextElement(element, annotation, true);
      });
      element.addEventListener("focus", () => {
        this.activate();
        this.textEditId = annotation.id;
        this.selectedAnnotationId = annotation.id;
        this.syncTextSelection();
        this.renderAnnotations(annotation.page);
      });
      element.addEventListener("blur", () => {
        const nextText = element.value;
        if (annotation.text !== nextText) {
          this.recordTextEditHistory(annotation.id);
          annotation.text = nextText;
          this.markDirty();
        }
        this.resizeTextElement(element, annotation, true);
        if (this.textEditId === annotation.id) this.textEditId = null;
        if (this.textEditHistoryId === annotation.id) {
          this.textEditHistoryId = null;
        }
        if (this.lastAddedTextAnnotationId === annotation.id) {
          this.lastAddedTextAnnotationId = null;
        }
      });
      element.addEventListener("pointerdown", (event) => {
        this.onTextPointerDown(event, annotation.id);
      });
      element.addEventListener("pointermove", (event) => {
        this.onPointerMove(event);
      });
      element.addEventListener("pointerup", (event) => {
        this.onPointerUp(event);
      });
      element.addEventListener("pointercancel", (event) => {
        this.onPointerUp(event);
      });
      element.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.focusTextAnnotation(annotation.id);
      });
      pageView.textLayer.append(element);
      this.resizeTextElement(element, annotation, false);
      if (!this.readOnly) {
        const handle = document.createElement("div");
        handle.className = "ym-pdf-markup-text-resize-handle";
        handle.dataset.annotationId = annotation.id;
        handle.dataset.selected = annotation.id === this.selectedAnnotationId
          ? "true"
          : "false";
        this.applyTextResizeHandleStyle(handle, annotation);
        handle.addEventListener("pointerdown", (event) => {
          this.onTextResizePointerDown(event, annotation.id);
        });
        handle.addEventListener("pointermove", (event) => {
          this.onPointerMove(event);
        });
        handle.addEventListener("pointerup", (event) => {
          this.onPointerUp(event);
        });
        handle.addEventListener("pointercancel", (event) => {
          this.onPointerUp(event);
        });
        pageView.textLayer.append(handle);
      }
      if (annotation.id === focusedId) {
        queueMicrotask(() => this.focusTextAnnotation(annotation.id));
      }
    }
  }

  findTextElement(annotationId) {
    if (!this.container) return null;
    for (
      const element of this.container.querySelectorAll(
        ".ym-pdf-markup-text-note",
      )
    ) {
      if (element.dataset.annotationId === annotationId) return element;
    }
    return null;
  }

  findTextResizeHandle(annotationId) {
    if (!this.container) return null;
    for (
      const element of this.container.querySelectorAll(
        ".ym-pdf-markup-text-resize-handle",
      )
    ) {
      if (element.dataset.annotationId === annotationId) return element;
    }
    return null;
  }

  applyTextElementStyle(element, annotation) {
    const scale = this.pageScale(annotation.page);
    const fontSize = annotation.fontSize || 13;
    const topLeft = this.viewportPoint(
      { x: annotation.x, y: annotation.y },
      annotation.page,
    );
    element.style.left = `${topLeft.x}px`;
    element.style.top = `${topLeft.y}px`;
    element.style.width = `${Math.max(48, (annotation.w || 220) * scale)}px`;
    element.style.height = `${Math.max(24, (annotation.h || 52) * scale)}px`;
    element.style.color = annotation.color || "#0f172a";
    element.style.fontSize = `${Math.max(8, fontSize * scale)}px`;
  }

  applyTextResizeHandleStyle(element, annotation) {
    const scale = this.pageScale(annotation.page);
    const topLeft = this.viewportPoint(
      { x: annotation.x, y: annotation.y },
      annotation.page,
    );
    const width = Math.max(48, (annotation.w || 220) * scale);
    const height = Math.max(24, (annotation.h || 52) * scale);
    element.style.left = `${topLeft.x + width - 11}px`;
    element.style.top = `${topLeft.y + height - 11}px`;
  }

  resizeTextElement(element, annotation, updateAnnotation) {
    const scale = this.pageScale(annotation.page);
    const currentHeight = Math.max(24, (annotation.h || 52) * scale);
    element.style.height = `${currentHeight}px`;
    const nextHeight = Math.max(
      currentHeight,
      element.scrollHeight,
    );
    element.style.height = `${nextHeight}px`;
    if (updateAnnotation) {
      const nextAnnotationHeight = rounded(nextHeight / scale);
      if (Math.abs((annotation.h || 0) - nextAnnotationHeight) > 0.5) {
        annotation.h = nextAnnotationHeight;
      }
      const handle = this.findTextResizeHandle(annotation.id);
      if (handle) {
        this.applyTextResizeHandleStyle(handle, annotation);
      }
    }
  }

  syncTextSelection() {
    if (!this.container) return;
    for (
      const element of this.container.querySelectorAll(
        ".ym-pdf-markup-text-note",
      )
    ) {
      element.dataset.selected =
        element.dataset.annotationId === this.selectedAnnotationId
          ? "true"
          : "false";
    }
    for (
      const element of this.container.querySelectorAll(
        ".ym-pdf-markup-text-resize-handle",
      )
    ) {
      element.dataset.selected =
        element.dataset.annotationId === this.selectedAnnotationId
          ? "true"
          : "false";
    }
  }

  emitSelectionChanged(
    annotation = this.getAnnotationById(this.selectedAnnotationId),
  ) {
    const tool = annotationTool(annotation);
    if (!tool) {
      emit("selectionChanged", {
        handle: this.handle,
        json: { selected: false },
      });
      return;
    }
    const payload = {
      selected: true,
      id: annotation.id,
      tool,
      color: annotation.color || (
        tool === "highlight"
          ? this.style.highlightColor
          : tool === "text"
          ? this.style.textColor
          : this.style.penColor
      ),
    };
    if (tool === "pen") {
      payload.strokeWidth = annotation.strokeWidth || this.style.penWidth;
    } else if (tool === "highlight") {
      payload.strokeWidth = annotation.strokeWidth || this.style.highlightWidth;
      payload.opacity = annotation.opacity ?? this.style.highlightOpacity;
    } else if (tool === "text") {
      payload.fontSize = annotation.fontSize || this.style.fontSize;
    }
    emit("selectionChanged", {
      handle: this.handle,
      json: payload,
    });
  }

  focusTextAnnotation(annotationId) {
    const element = this.findTextElement(annotationId);
    if (!element) return;
    const annotation = this.getAnnotationById(annotationId);
    this.selectedAnnotationId = annotationId;
    if (annotation) {
      this.currentPage = Number(annotation.page) || this.currentPage;
    }
    this.textEditId = annotationId;
    this.syncTextSelection();
    this.renderAnnotations(annotation?.page);
    this.emitSelectionChanged(annotation);
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }

  deferFocusTextAnnotation(annotationId) {
    setTimeout(() => {
      this.focusTextAnnotation(annotationId);
    }, 0);
  }

  flushTextEdits() {
    if (!this.container) return;
    for (
      const element of this.container.querySelectorAll(
        ".ym-pdf-markup-text-note",
      )
    ) {
      const annotation = this.getAnnotationById(element.dataset.annotationId);
      if (!annotation) continue;
      annotation.text = element.value;
      this.resizeTextElement(element, annotation, true);
    }
  }

  drawAnnotation(ctx, annotation) {
    const scale = this.pageScale(annotation.page);
    ctx.save();
    ctx.globalAlpha = annotation.opacity ?? 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (annotation.type === "freehand" || annotation.type === "highlight") {
      const points = annotation.points || [];
      if (points.length < 1) {
        ctx.restore();
        return;
      }
      ctx.strokeStyle = annotation.color ||
        (annotation.type === "highlight" ? "#fde047" : "#ef4444");
      ctx.lineWidth = (annotation.strokeWidth ||
        (annotation.type === "highlight" ? 12 : 2.5)) * scale;
      const firstPoint = this.viewportPoint(points[0], annotation.page);
      ctx.beginPath();
      ctx.moveTo(firstPoint.x, firstPoint.y);
      for (let i = 1; i < points.length; i += 1) {
        const nextPoint = this.viewportPoint(points[i], annotation.page);
        ctx.lineTo(nextPoint.x, nextPoint.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSelection(ctx, annotation) {
    const bounds = annotationBounds(annotation);
    if (!bounds) return;
    const topLeft = this.viewportPoint(
      { x: bounds.minX, y: bounds.maxY },
      annotation.page,
    );
    const bottomRight = this.viewportPoint(
      { x: bounds.maxX, y: bounds.minY },
      annotation.page,
    );
    const x = Math.min(topLeft.x, bottomRight.x);
    const y = Math.min(topLeft.y, bottomRight.y);
    const w = Math.abs(bottomRight.x - topLeft.x);
    const h = Math.abs(bottomRight.y - topLeft.y);
    ctx.save();
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    ctx.restore();
  }

  onPointerDown(event) {
    event.ymPdfMarkupHandled = true;
    if (this.handleGesturePointerDown(event, true)) return;
    if (this.readOnly) return;
    const pageView = this.getPageViewFromEvent(event);
    if (!pageView) return;
    this.container?.focus?.({ preventScroll: true });
    try {
      pageView.overlayCanvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be inactive; drawing still works via
      // bubbled pointer events.
    }
    this.activePointerId = event.pointerId;
    this.currentPage = pageView.pageNumber;
    const point = this.eventPoint(event, pageView);
    if (this.tool === "select") {
      const hit = this.hitTest(point, pageView.pageNumber);
      this.selectedAnnotationId = hit?.id || null;
      this.textEditId = null;
      if (hit) {
        this.startDrag(event, hit, point, pageView.overlayCanvas);
      }
      this.renderAnnotations(pageView.pageNumber);
      this.syncTextSelection();
      this.emitSelectionChanged(hit);
      return;
    }
    if (this.tool === "text") {
      event.preventDefault();
      event.stopPropagation();
      const existingText = this.hitTest(point, pageView.pageNumber);
      if (existingText?.type === "text") {
        this.deferFocusTextAnnotation(existingText.id);
        return;
      }
      const annotation = {
        id: newId(),
        type: "text",
        page: pageView.pageNumber,
        x: rounded(point.x),
        y: rounded(point.y),
        w: 220,
        h: 52,
        text: "",
        fontSize: this.style.fontSize,
        color: this.style.textColor,
        createdAt: nowIso(),
      };
      this.addAnnotation(annotation);
      this.deferFocusTextAnnotation(annotation.id);
      return;
    }
    if (this.tool === "pen" || this.tool === "highlight") {
      const isHighlight = this.tool === "highlight";
      this.draftInfo = {
        pointerType: event.pointerType,
        startedAt: performance.now(),
      };
      this.draft = {
        id: newId(),
        type: isHighlight ? "highlight" : "freehand",
        page: pageView.pageNumber,
        points: [serializePoint(point)],
        color: isHighlight ? this.style.highlightColor : this.style.penColor,
        strokeWidth: isHighlight
          ? this.style.highlightWidth
          : this.style.penWidth,
        opacity: isHighlight ? this.style.highlightOpacity : 1,
        createdAt: nowIso(),
      };
      this.renderAnnotations(pageView.pageNumber);
      return;
    }
  }

  onTextPointerDown(event, annotationId) {
    if (this.readOnly) return;
    if (this.isPanTrigger(event)) {
      // Let the event bubble to the container so it starts a pan instead.
      return;
    }
    this.activate();
    const annotation = this.getAnnotationById(annotationId);
    if (!annotation) return;
    const pageView = this.getPageView(annotation.page);
    if (!pageView) return;
    this.currentPage = pageView.pageNumber;
    if (this.tool === "select") {
      const now = performance.now();
      const isDoubleClick = this.lastTextPointerDown?.id === annotation.id &&
        now - this.lastTextPointerDown.time < 420;
      this.lastTextPointerDown = { id: annotation.id, time: now };
      if (this.textEditId === annotation.id) {
        event.stopPropagation();
        this.selectedAnnotationId = annotation.id;
        this.syncTextSelection();
        this.renderAnnotations(annotation.page);
        this.emitSelectionChanged(annotation);
        return;
      }
      if (event.detail >= 2 || isDoubleClick) {
        event.preventDefault();
        event.stopPropagation();
        this.lastTextPointerDown = null;
        this.focusTextAnnotation(annotation.id);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.selectedAnnotationId = annotation.id;
      this.startDrag(
        event,
        annotation,
        this.eventPoint(event, pageView),
        event.currentTarget,
      );
      this.renderAnnotations(annotation.page);
      this.syncTextSelection();
      this.emitSelectionChanged(annotation);
      return;
    }
    if (this.tool === "text") {
      event.stopPropagation();
      this.selectedAnnotationId = annotation.id;
      this.syncTextSelection();
      this.renderAnnotations(annotation.page);
      this.emitSelectionChanged(annotation);
    }
  }

  onTextResizePointerDown(event, annotationId) {
    if (this.readOnly) return;
    if (this.isPanTrigger(event)) {
      return;
    }
    this.activate();
    const annotation = this.getAnnotationById(annotationId);
    if (!annotation) return;
    const pageView = this.getPageView(annotation.page);
    if (!pageView) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedAnnotationId = annotation.id;
    this.currentPage = pageView.pageNumber;
    this.textEditId = null;
    this.resize = {
      id: annotation.id,
      startPoint: this.eventPoint(event, pageView),
      startWidth: Number(annotation.w || 220),
      startHeight: Number(annotation.h || 52),
      historySnapshot: this.snapshotAnnotations(),
      moved: false,
      captureTarget: event.currentTarget,
    };
    this.activePointerId = event.pointerId;
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be inactive; resizing still works via
      // bubbled pointer events.
    }
    this.renderAnnotations(annotation.page);
    this.syncTextSelection();
    this.emitSelectionChanged(annotation);
  }

  onPointerMove(event) {
    if (this.resize && event.pointerId === this.activePointerId) {
      this.updateResize(event);
      return;
    }
    if (this.drag && event.pointerId === this.activePointerId) {
      this.updateDrag(event);
      return;
    }
    if (!this.draft || event.pointerId !== this.activePointerId) {
      if (
        this.tool === "select" && !this.spacePan && !this.pan && !this.pinch &&
        event.target?.classList?.contains("ym-pdf-markup-overlay")
      ) {
        const pageView = this.getPageViewFromEvent(event);
        const hit = this.hitTest(
          this.eventPoint(event, pageView),
          pageView.pageNumber,
        );
        pageView.overlayCanvas.style.cursor = hit ? "move" : "default";
      }
      return;
    }
    const pageView = this.getPageView(this.draft.page);
    const point = this.eventPoint(event, pageView);
    if (this.draft.type === "freehand" || this.draft.type === "highlight") {
      this.draft.points.push(serializePoint(point));
    }
    this.renderAnnotations(this.draft.page);
  }

  onPointerUp(event) {
    if (event.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    if (this.resize) {
      const resize = this.resize;
      this.resize = null;
      if (resize.captureTarget?.hasPointerCapture?.(event.pointerId)) {
        resize.captureTarget.releasePointerCapture(event.pointerId);
      }
      if (resize.moved) {
        this.pushUndoSnapshot(resize.historySnapshot);
        this.markDirty();
      }
      this.renderAnnotations(this.getAnnotationById(resize.id)?.page);
      this.syncTextSelection();
      return;
    }
    if (this.drag) {
      const drag = this.drag;
      this.drag = null;
      if (drag.captureTarget?.hasPointerCapture?.(event.pointerId)) {
        drag.captureTarget.releasePointerCapture(event.pointerId);
      }
      if (drag.moved) {
        this.pushUndoSnapshot(drag.historySnapshot);
        this.markDirty();
      }
      this.renderAnnotations(this.getAnnotationById(drag.id)?.page);
      this.renderTextLayer(this.getAnnotationById(drag.id)?.page);
      return;
    }
    if (!this.draft) return;
    const annotation = this.draft;
    this.draft = null;
    this.draftInfo = null;
    if (annotation.points) {
      annotation.points = simplifyPoints(annotation.points);
      if (annotation.points.length < 2) {
        this.renderAnnotations(annotation.page);
        return;
      }
    }
    this.addAnnotation(annotation);
  }

  getAnnotationById(annotationId) {
    return this.annotations.find((annotation) =>
      annotation.id === annotationId
    );
  }

  startDrag(event, annotation, point, captureTarget) {
    this.drag = {
      id: annotation.id,
      startPoint: point,
      original: cloneAnnotation(annotation),
      historySnapshot: this.snapshotAnnotations(),
      moved: false,
      captureTarget,
    };
    this.activePointerId = event.pointerId;
    try {
      captureTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be inactive; dragging still works via
      // bubbled pointer events.
    }
  }

  updateDrag(event) {
    const drag = this.drag;
    if (!drag) return;
    const annotation = this.getAnnotationById(drag.id);
    if (!annotation) return;
    const pageView = this.getPageView(annotation.page);
    const point = this.eventPoint(event, pageView);
    const originalBounds = annotationBounds(drag.original);
    const delta = clampMoveDelta(
      originalBounds,
      point.x - drag.startPoint.x,
      point.y - drag.startPoint.y,
      pageView.pageWidth,
      pageView.pageHeight,
    );
    if (Math.abs(delta.dx) > 0.4 || Math.abs(delta.dy) > 0.4) {
      drag.moved = true;
    }
    moveAnnotationFromOriginal(annotation, drag.original, delta.dx, delta.dy);
    this.renderAnnotations(annotation.page);
    if (annotation.type === "text") {
      const element = this.findTextElement(annotation.id);
      if (element) {
        this.applyTextElementStyle(element, annotation);
        this.resizeTextElement(element, annotation, false);
      }
      const resizeHandle = this.findTextResizeHandle(annotation.id);
      if (resizeHandle) {
        this.applyTextResizeHandleStyle(resizeHandle, annotation);
      }
    }
  }

  updateResize(event) {
    const resize = this.resize;
    if (!resize) return;
    const annotation = this.getAnnotationById(resize.id);
    if (!annotation) return;
    const pageView = this.getPageView(annotation.page);
    const point = this.eventPoint(event, pageView);
    const nextWidth = clamp(
      resize.startWidth + point.x - resize.startPoint.x,
      48,
      Math.max(48, pageView.pageWidth - Number(annotation.x || 0)),
    );
    const nextHeight = clamp(
      resize.startHeight + resize.startPoint.y - point.y,
      24,
      Math.max(24, Number(annotation.y || pageView.pageHeight)),
    );
    if (
      Math.abs(nextWidth - resize.startWidth) > 0.4 ||
      Math.abs(nextHeight - resize.startHeight) > 0.4
    ) {
      resize.moved = true;
    }
    annotation.w = rounded(nextWidth);
    annotation.h = rounded(nextHeight);
    const element = this.findTextElement(annotation.id);
    if (element) {
      this.applyTextElementStyle(element, annotation);
    }
    const resizeHandle = this.findTextResizeHandle(annotation.id);
    if (resizeHandle) {
      this.applyTextResizeHandleStyle(resizeHandle, annotation);
    }
    this.renderAnnotations(annotation.page);
  }

  hitTest(point, pageNumber = this.currentPage) {
    const pageAnnotations = this.pageAnnotations(pageNumber);
    const scale = this.pageScale(pageNumber);
    for (let i = pageAnnotations.length - 1; i >= 0; i -= 1) {
      const annotation = pageAnnotations[i];
      const bounds = annotationBounds(annotation);
      if (!bounds) continue;
      const pad = Math.max(6 / scale, annotation.strokeWidth || 2);
      if (
        point.x < bounds.minX - pad || point.x > bounds.maxX + pad ||
        point.y < bounds.minY - pad || point.y > bounds.maxY + pad
      ) {
        continue;
      }
      if (annotation.type === "freehand" || annotation.type === "highlight") {
        const points = annotation.points || [];
        for (let j = 1; j < points.length; j += 1) {
          const limit = Math.max(
            8 / scale,
            (annotation.strokeWidth || 2) + 4 / scale,
          );
          if (
            segmentDistanceSquared(point, points[j - 1], points[j]) <=
              limit * limit
          ) {
            return annotation;
          }
        }
      } else {
        return annotation;
      }
    }
    return null;
  }

  addAnnotation(annotation) {
    this.recordHistory();
    this.annotations.push(annotation);
    this.selectedAnnotationId = annotation.id;
    this.lastAddedTextAnnotationId = annotation.type === "text"
      ? annotation.id
      : null;
    this.currentPage = Number(annotation.page) || this.currentPage;
    this.markDirty();
    this.renderAnnotations(annotation.page);
    this.renderTextLayer(annotation.page);
    this.emitSelectionChanged(annotation);
  }

  markDirty() {
    this.dirty = true;
    this.changeSequence += 1;
    if (this.document) {
      this.document.changeSequence = this.changeSequence;
    }
    emit("changed", {
      handle: this.handle,
      json: this.statePayload({ dirty: true }),
    });
  }

  statePayload(extra = {}) {
    return this.workspacePayload({
      dirty: this.dirty,
      annotationCount: this.annotations.length,
      hasSelection: this.selectedAnnotationId !== null,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      ...extra,
    });
  }

  snapshotAnnotations() {
    return this.annotations.map((annotation) => cloneAnnotation(annotation));
  }

  pushUndoSnapshot(snapshot) {
    this.undoStack.push(
      snapshot.map((annotation) => cloneAnnotation(annotation)),
    );
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  recordHistory() {
    this.pushUndoSnapshot(this.snapshotAnnotations());
  }

  recordTextEditHistory(annotationId) {
    if (this.lastAddedTextAnnotationId === annotationId) return;
    if (this.textEditHistoryId === annotationId) return;
    this.recordHistory();
    this.textEditHistoryId = annotationId;
  }

  restoreAnnotations(snapshot) {
    this.annotations = snapshot.map((annotation) =>
      cloneAnnotation(annotation)
    );
    this.selectedAnnotationId = null;
    this.textEditId = null;
    this.textEditHistoryId = null;
    this.lastAddedTextAnnotationId = null;
    this.lastTextPointerDown = null;
    for (const pageView of this.pageViews.values()) {
      this.renderAnnotations(pageView.pageNumber);
      this.renderTextLayer(pageView.pageNumber);
    }
    this.emitSelectionChanged(null);
  }

  queueScrollPageUpdate() {
    if (this.scrollRaf !== null) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = null;
      this.pdfViewer?.update();
      for (const pageView of this.pageViews.values()) {
        this.syncPageSurface(pageView.pageNumber);
        if (this.stageNearViewport(pageView)) {
          this.renderAnnotations(pageView.pageNumber);
          this.renderTextLayer(pageView.pageNumber);
        }
      }
    });
  }

  scrollPageIntoView(pageNumber) {
    this.pdfViewer?.scrollPageIntoView({ pageNumber });
  }

  setTool(tool) {
    this.activate();
    // Explicitly choosing a tool exits pen mode so finger drawing works
    // again after stylus use; the next pen contact re-arms it. Also hand
    // keyboard shortcuts to the viewer, since picking a tool signals intent
    // to work in the canvas.
    this.penMode = false;
    this.container?.focus?.({ preventScroll: true });
    const selected = this.getAnnotationById(this.selectedAnnotationId);
    this.tool = VALID_TOOLS.includes(tool) ? tool : DEFAULT_TOOL;
    this.selectedAnnotationId = null;
    if (this.tool === "hand" && this.textEditId) {
      this.findTextElement(this.textEditId)?.blur();
    }
    this.textEditId = null;
    if (this.container) this.container.dataset.tool = this.tool;
    this.updateCursors();
    if (selected) {
      this.renderAnnotations(selected.page);
      this.syncTextSelection();
      this.emitSelectionChanged(null);
    }
  }

  setStyle(style) {
    if (this.readOnly) return;
    this.activate();
    const tool = ["pen", "highlight", "text"].includes(style?.tool)
      ? style.tool
      : this.tool;
    const color = styleProp(style, "color");
    const strokeWidth = styleProp(
      style,
      "strokeWidth",
      "stroke_width",
      "strokewidth",
    );
    const opacity = styleProp(style, "opacity");
    const fontSize = styleProp(style, "fontSize", "font_size", "fontsize");
    if (tool === "pen") {
      if (color !== undefined) {
        this.style.penColor = normalizedHexColor(
          color,
          this.style.penColor,
        );
      }
      if (strokeWidth !== undefined) {
        this.style.penWidth = normalizedNumber(
          strokeWidth,
          this.style.penWidth,
          1,
          12,
        );
      }
    } else if (tool === "highlight") {
      if (color !== undefined) {
        this.style.highlightColor = normalizedHexColor(
          color,
          this.style.highlightColor,
        );
      }
      if (strokeWidth !== undefined) {
        this.style.highlightWidth = normalizedNumber(
          strokeWidth,
          this.style.highlightWidth,
          4,
          32,
        );
      }
      if (opacity !== undefined) {
        this.style.highlightOpacity = normalizedNumber(
          opacity,
          this.style.highlightOpacity,
          0.15,
          0.8,
        );
      }
    } else if (tool === "text") {
      if (color !== undefined) {
        this.style.textColor = normalizedHexColor(
          color,
          this.style.textColor,
        );
      }
      if (fontSize !== undefined) {
        this.style.fontSize = normalizedNumber(
          fontSize,
          this.style.fontSize,
          10,
          24,
        );
      }
    }

    const annotation = this.getAnnotationById(this.selectedAnnotationId);
    if (!annotation || !annotationMatchesTool(annotation, tool)) return;

    let changed = false;
    const beginChange = () => {
      if (changed) return;
      this.recordHistory();
      changed = true;
    };
    if (tool === "pen") {
      if (
        color !== undefined && annotation.color !== this.style.penColor
      ) {
        beginChange();
        annotation.color = this.style.penColor;
      }
      if (
        strokeWidth !== undefined &&
        annotation.strokeWidth !== this.style.penWidth
      ) {
        beginChange();
        annotation.strokeWidth = this.style.penWidth;
      }
    } else if (tool === "highlight") {
      if (
        color !== undefined &&
        annotation.color !== this.style.highlightColor
      ) {
        beginChange();
        annotation.color = this.style.highlightColor;
      }
      if (
        strokeWidth !== undefined &&
        annotation.strokeWidth !== this.style.highlightWidth
      ) {
        beginChange();
        annotation.strokeWidth = this.style.highlightWidth;
      }
      if (
        opacity !== undefined &&
        annotation.opacity !== this.style.highlightOpacity
      ) {
        beginChange();
        annotation.opacity = this.style.highlightOpacity;
      }
    } else if (tool === "text") {
      if (
        color !== undefined && annotation.color !== this.style.textColor
      ) {
        beginChange();
        annotation.color = this.style.textColor;
      }
      if (
        fontSize !== undefined &&
        annotation.fontSize !== this.style.fontSize
      ) {
        beginChange();
        annotation.fontSize = this.style.fontSize;
      }
    }
    if (!changed) return;
    this.markDirty();
    this.renderAnnotations(annotation.page);
    if (annotation.type === "text") {
      this.renderTextLayer(annotation.page);
    }
  }

  setPage(page) {
    const nextPage = clamp(Number(page || 1), 1, this.pageCount || 1);
    if (nextPage === this.currentPage) return;
    this.currentPage = nextPage;
    this.selectedAnnotationId = null;
    this.scrollPageIntoView(nextPage);
    this.renderAnnotations(nextPage);
    this.syncTextSelection();
    this.emitSelectionChanged(null);
    emit("pageChanged", {
      handle: this.handle,
      json: this.workspacePayload(),
    });
  }

  setScale(scale) {
    if (!this.container) return;
    // Toolbar zoom commands hand keyboard shortcuts to the viewer.
    this.container.focus?.({ preventScroll: true });
    const nextScale = clamp(
      Number(scale || this.effectiveScale()),
      MIN_SCALE,
      MAX_SCALE,
    );
    const rect = this.container.getBoundingClientRect();
    this.previewZoomAt(
      nextScale,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }

  fitWidth() {
    if (!this.pdfViewer) return;
    this.pdfViewer.currentScaleValue = "page-width";
    this.scale = this.pdfViewer.currentScale;
  }

  fitPage() {
    if (!this.pdfViewer) return;
    this.pdfViewer.currentScaleValue = "page-fit";
    this.scale = this.pdfViewer.currentScale;
  }

  undo() {
    this.activate();
    if (this.undoStack.length === 0) return;
    const previous = this.undoStack.pop();
    this.redoStack.push(this.snapshotAnnotations());
    this.restoreAnnotations(previous);
    this.markDirty();
  }

  redo() {
    this.activate();
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop();
    this.undoStack.push(this.snapshotAnnotations());
    this.restoreAnnotations(next);
    this.markDirty();
  }

  deleteSelected() {
    this.activate();
    if (!this.selectedAnnotationId) return;
    const deleted = this.getAnnotationById(this.selectedAnnotationId);
    const nextAnnotations = this.annotations.filter((annotation) =>
      annotation.id !== this.selectedAnnotationId
    );
    if (nextAnnotations.length === this.annotations.length) return;
    this.recordHistory();
    this.annotations = nextAnnotations;
    this.selectedAnnotationId = null;
    this.markDirty();
    this.renderAnnotations(deleted?.page);
    this.renderTextLayer(deleted?.page);
    this.emitSelectionChanged(null);
  }

  clearPage() {
    this.activate();
    const nextAnnotations = this.annotations.filter((annotation) =>
      Number(annotation.page) !== this.currentPage
    );
    if (nextAnnotations.length === this.annotations.length) return;
    this.recordHistory();
    this.annotations = nextAnnotations;
    this.selectedAnnotationId = null;
    this.markDirty();
    this.renderAnnotations(this.currentPage);
    this.renderTextLayer(this.currentPage);
    this.emitSelectionChanged(null);
  }

  loadAnnotations(annotations) {
    this.annotations = normalizeAnnotations(annotations);
    this.selectedAnnotationId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.textEditHistoryId = null;
    this.lastAddedTextAnnotationId = null;
    this.dirty = false;
    this.changeSequence = 0;
    if (this.document) {
      this.document.changeSequence = 0;
    }
    this.emitSelectionChanged(null);
    for (const pageView of this.pageViews.values()) {
      this.renderAnnotations(pageView.pageNumber);
      this.renderTextLayer(pageView.pageNumber);
    }
  }

  markClean(revision, savedChangeSequence) {
    const clean = Number(savedChangeSequence) === this.changeSequence;
    this.dirty = !clean;
    this.document.dirty = this.dirty;
    this.document.annotations = this.annotations;
    if (Number.isFinite(Number(revision))) {
      this.document.revision = Math.max(0, Math.trunc(Number(revision)));
    }
    return clean;
  }

  exportAnnotations() {
    this.flushTextEdits();
    return this.workspacePayload({
      annotations: this.annotations,
      rotations: Object.entries(this.rotations).map(([page, quarterTurns]) => ({
        page: Number(page),
        quarterTurns,
      })),
    });
  }

  async createFlattenedPdf() {
    this.flushTextEdits();
    const response = await fetch(this.pdfUrl, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`Unable to load PDF (${response.status})`);
    }
    const pdfDoc = await PDFDocument.load(await response.arrayBuffer());
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    for (const [pageNumber, quarterTurns] of Object.entries(this.rotations)) {
      const page = pages[Number(pageNumber) - 1];
      if (!page) continue;
      page.setRotation(
        degrees((page.getRotation().angle + Number(quarterTurns) * 90) % 360),
      );
    }
    for (const annotation of this.annotations) {
      const page = pages[Number(annotation.page) - 1];
      if (!page) continue;
      if (annotation.type === "freehand" || annotation.type === "highlight") {
        this.drawPathOnPdfPage(page, annotation);
      } else if (annotation.type === "text") {
        this.drawTextOnPdfPage(page, annotation, font);
      }
    }
    return await pdfDoc.save();
  }

  drawPathOnPdfPage(page, annotation) {
    const points = annotation.points || [];
    if (points.length < 2) return;
    const color = parseHexColor(
      annotation.color,
      annotation.type === "highlight" ? "#fde047" : "#ef4444",
    );
    for (let i = 1; i < points.length; i += 1) {
      page.drawLine({
        start: { x: points[i - 1].x, y: points[i - 1].y },
        end: { x: points[i].x, y: points[i].y },
        thickness: annotation.strokeWidth ||
          (annotation.type === "highlight" ? 12 : 2.5),
        color,
        opacity: annotation.opacity ??
          (annotation.type === "highlight" ? 0.36 : 1),
      });
    }
  }

  drawTextOnPdfPage(page, annotation, font) {
    const text = String(annotation.text || "").trimEnd();
    if (!text) return;
    const fontSize = annotation.fontSize || 13;
    const lineHeight = fontSize * 1.28;
    page.drawText(text, {
      x: annotation.x,
      y: annotation.y - fontSize,
      size: fontSize,
      font,
      color: parseHexColor(annotation.color, "#0f172a"),
      lineHeight,
      maxWidth: annotation.w || 220,
    });
  }

  async downloadFlattenedPdf(filename) {
    this.activate();
    const pdfBytes = await this.createFlattenedPdf();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeDownloadFilename(filename);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  destroy() {
    this.persistDocumentState();
    this.destroyed = true;
    if (this.scrollRaf !== null) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = null;
    }
    this.cancelInertia();
    if (this.previewRaf !== null) {
      cancelAnimationFrame(this.previewRaf);
      this.previewRaf = null;
    }
    this.pendingPreview = null;
    if (this.zoomCommitTimer !== null) {
      clearTimeout(this.zoomCommitTimer);
      this.zoomCommitTimer = null;
    }
    if (this.boundaryNavigationResetTimer !== null) {
      clearTimeout(this.boundaryNavigationResetTimer);
      this.boundaryNavigationResetTimer = null;
    }
    document.removeEventListener("keydown", this.onKeyDownBound, true);
    document.removeEventListener("keyup", this.onKeyUpBound, true);
    globalThis.removeEventListener("blur", this.onWindowBlurBound);
    globalThis.removeEventListener("beforeunload", this.onBeforeUnloadBound);
    this.pdfViewer?.setDocument(null);
    this.viewerAbortController?.abort();
    if (activeViewerHandle === this.handle) activeViewerHandle = null;
    if (this.container) {
      this.container.removeEventListener("scroll", this.onScrollBound);
      this.container.removeEventListener(
        "pointerdown",
        this.onContainerPointerDownCaptureBound,
        true,
      );
      this.container.removeEventListener(
        "pointerdown",
        this.onContainerPointerDownBound,
      );
      this.container.removeEventListener(
        "pointermove",
        this.onContainerPointerMoveBound,
      );
      this.container.removeEventListener(
        "pointerup",
        this.onContainerPointerUpBound,
      );
      this.container.removeEventListener(
        "pointercancel",
        this.onContainerPointerCancelBound,
      );
      this.container.removeEventListener("wheel", this.onWheelBound);
      this.container.removeEventListener(
        "mousedown",
        this.onMiddleMouseDownBound,
      );
      this.container.style.cursor = "";
      this.container.removeAttribute("tabindex");
      delete this.container.dataset.panning;
      delete this.container.dataset.spacePan;
    }
    if (this.mount) this.mount.innerHTML = "";
    void this.closeDocument().catch(() => {});
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    if (viewers.has(handle)) {
      viewers.get(handle).destroy();
      viewers.delete(handle);
    }
    const viewer = new PdfMarkupViewer({ ...data, handle });
    viewers.set(handle, viewer);
    await viewer.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function setTool(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  viewer?.setTool(data.tool);
}

function setStyle(args) {
  const viewer = getViewer(args);
  viewer?.setStyle(parseArgs(args));
}

async function setPage(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  await viewer?.setPage(data.page);
}

async function nextPage(args) {
  const viewer = getViewer(args);
  if (!viewer) return;
  if (viewer.currentPage < viewer.pageCount) {
    await viewer.setPage(viewer.currentPage + 1);
  } else {
    await viewer.requestDocumentChange(viewer.documentIndex + 1, 1);
  }
}

async function previousPage(args) {
  const viewer = getViewer(args);
  if (!viewer) return;
  if (viewer.currentPage > 1) {
    await viewer.setPage(viewer.currentPage - 1);
  } else {
    const previousIndex = viewer.documentIndex - 1;
    if (previousIndex >= 0) {
      await viewer.requestDocumentChange(previousIndex, "last");
    }
  }
}

async function changeDocument(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  await viewer?.requestDocumentChange(
    data.documentKey ?? data.documentIndex ?? data.targetDocumentIndex,
    data.targetPage ?? 1,
  );
}

async function setDocuments(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      error: "Viewer is not initialized",
    });
  }
  try {
    const changed = await viewer.setDocuments(data);
    return moduleResult(handle, { success: changed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

async function completeDocumentNavigation(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  await viewer?.changeDocument(data.targetDocumentIndex);
  if (data.targetPage === "last") {
    await viewer?.setPage(viewer.pageCount);
    viewer?.scrollToDocumentEnd();
  } else {
    await viewer?.setPage(data.targetPage ?? 1);
  }
}

async function rotateLeft(args) {
  await getViewer(args)?.rotatePage(-1);
}

async function rotateRight(args) {
  await getViewer(args)?.rotatePage(1);
}

function completeRotation(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      error: "Viewer is not initialized",
    });
  }
  const completed = viewer.completeRotation(data.requestId);
  return moduleResult(handle, { success: completed });
}

async function rejectRotation(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      error: "Viewer is not initialized",
    });
  }
  const rejected = await viewer.rejectRotation(data.requestId);
  return moduleResult(handle, { success: rejected });
}

async function zoomIn(args) {
  const viewer = getViewer(args);
  if (viewer) await viewer.setScale(viewer.effectiveScale() * ZOOM_STEP);
}

async function zoomOut(args) {
  const viewer = getViewer(args);
  if (viewer) await viewer.setScale(viewer.effectiveScale() / ZOOM_STEP);
}

async function fitWidth(args) {
  const viewer = getViewer(args);
  await viewer?.fitWidth();
}

async function fitPage(args) {
  const viewer = getViewer(args);
  await viewer?.fitPage();
}

async function actualSize(args) {
  const viewer = getViewer(args);
  if (viewer) await viewer.setScale(1);
}

async function setZoom(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  const percent = Number(data.percent);
  if (viewer && Number.isFinite(percent) && percent > 0) {
    await viewer.setScale(percent / 100);
  }
}

function undo(args) {
  getViewer(args)?.undo();
}

function redo(args) {
  getViewer(args)?.redo();
}

function deleteSelected(args) {
  getViewer(args)?.deleteSelected();
}

function clearPage(args) {
  getViewer(args)?.clearPage();
}

function loadAnnotations(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  viewer?.loadAnnotations(data.annotations);
}

function markClean(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      error: "Viewer is not initialized",
    });
  }
  const clean = viewer.markClean(data.revision, data.changeSequence);
  return moduleResult(handle, {
    success: true,
    clean,
    dirty: viewer.dirty,
    changeSequence: viewer.changeSequence,
    revision: viewer.document?.revision || 0,
  });
}

function getAnnotations(args) {
  const viewer = getViewer(args);
  const handle = args.handle || parseArgs(args).handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      annotations: [],
      pageCount: 0,
      error: "Viewer is not initialized",
    });
  }
  return moduleResult(handle, {
    success: true,
    ...viewer.exportAnnotations(),
  });
}

function getDiagnostics(args) {
  const viewer = getViewer(args);
  const handle = args.handle || parseArgs(args).handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      error: "Viewer is not initialized",
    });
  }
  const rendered = [...viewer.pageViews.values()].filter((pageView) =>
    Boolean(pageView.pdfPageView.canvas)
  );
  const canvases = viewer.container
    ? [...viewer.container.querySelectorAll("canvas")]
    : [];
  const pdfCanvases = canvases.filter((canvas) =>
    !canvas.classList.contains("ym-pdf-markup-overlay")
  );
  const canvasBytes = canvases.reduce(
    (total, canvas) => total + canvas.width * canvas.height * 4,
    0,
  );
  return moduleResult(handle, {
    success: true,
    instanceId: viewer.instanceId,
    documentKey: viewer.document?.key || "",
    documentIndex: viewer.documentIndex,
    documentCount: viewer.documents.length,
    pageCount: viewer.pageCount,
    currentPage: viewer.currentPage,
    currentPageWidth: viewer.getPageView(viewer.currentPage)?.pageWidth || 0,
    currentPageHeight: viewer.getPageView(viewer.currentPage)?.pageHeight || 0,
    evidenceFocus: viewer.evidenceFocus,
    scale: viewer.effectiveScale(),
    tool: viewer.tool,
    renderedPageCount: rendered.length,
    pdfCanvasCount: pdfCanvases.length,
    overlayCanvasCount: canvases.length - pdfCanvases.length,
    largestPdfCanvasPixels: pdfCanvases.reduce(
      (largest, canvas) => Math.max(largest, canvas.width * canvas.height),
      0,
    ),
    canvasBytes,
    maxCanvasPixels: MAX_CANVAS_PIXELS,
    maxCanvasDimension: MAX_CANVAS_DIMENSION,
    detailCanvasEnabled: true,
    renderingEngine: "pdfjs-viewer",
    pendingRotation: Boolean(viewer.pendingRotation),
  });
}

async function downloadFlattenedPdf(args) {
  const viewer = getViewer(args);
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  if (!viewer) {
    return moduleResult(handle, {
      success: false,
      error: "Viewer is not initialized",
    });
  }
  try {
    await viewer.downloadFlattenedPdf(data.filename);
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function cleanup(args) {
  const handle = args.handle || parseArgs(args).handle;
  const viewer = viewers.get(handle);
  if (viewer) {
    viewer.destroy();
    viewers.delete(handle);
  }
}

function noop() {}

registerModule({
  initialize,
  setTool,
  setStyle,
  setPage,
  nextPage,
  previousPage,
  changeDocument,
  setDocuments,
  completeDocumentNavigation,
  rotateLeft,
  rotateRight,
  completeRotation,
  rejectRotation,
  zoomIn,
  zoomOut,
  fitWidth,
  fitPage,
  actualSize,
  setZoom,
  undo,
  redo,
  deleteSelected,
  clearPage,
  loadAnnotations,
  markClean,
  getAnnotations,
  getDiagnostics,
  downloadFlattenedPdf,
  noop,
  cleanup,
});
