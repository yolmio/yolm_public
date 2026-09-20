// deno-lint-ignore-file no-undef

import * as UTIF from "utif";
import {
  downloadUrl,
  fetchLimited,
  moduleResult,
  parseArgs,
  previewPart,
  requiredMount,
} from "../_drive_preview/common";

const MAX_TIFF_BYTES = 128 * 1024 * 1024;
const MAX_PAGES = 1000;
const MAX_PAGE_PIXELS = 50_000_000;
const instances = new Map();

class TiffViewer {
  constructor({ handle, elementId, fileUrl, fileName }) {
    this.handle = handle;
    this.mount = requiredMount(elementId, "TIFF viewer");
    this.fileUrl = fileUrl;
    this.fileName = fileName || "image.tif";
    this.abortController = new AbortController();
    this.listeners = [];
    this.pageIndex = 0;
    this.scale = 1;
    this.rotation = 0;
    this.drag = null;
    this.translateX = 0;
    this.translateY = 0;
    this.destroyed = false;
  }

  async initialize() {
    const buffer = await fetchLimited(
      this.fileUrl,
      MAX_TIFF_BYTES,
      this.abortController.signal,
      "This TIFF",
    );
    if (this.destroyed) return;
    this.ifds = UTIF.decode(buffer);
    if (!this.ifds.length) {
      throw new Error("This TIFF contains no image pages.");
    }
    if (this.ifds.length > MAX_PAGES) {
      throw new Error(
        `This TIFF has more than ${MAX_PAGES} pages and cannot be previewed safely.`,
      );
    }
    this.buffer = buffer;
    this.build();
    this.renderPage(0);
    emit("ready", {
      handle: this.handle,
      json: { pageCount: this.ifds.length },
    });
  }

  build() {
    this.mount.innerHTML = "";
    previewPart(this.mount, "tiff-mount");
    this.viewport = previewPart(document.createElement("div"), "tiff-viewport");
    this.canvas = document.createElement("canvas");
    previewPart(this.canvas, "tiff-canvas");
    this.viewport.append(this.canvas);
    this.mount.append(this.viewport);
    this.listen(this.viewport, "wheel", (event) => {
      event.preventDefault();
      this.setScale(this.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
    this.listen(this.viewport, "pointerdown", (event) => {
      this.viewport.setPointerCapture(event.pointerId);
      this.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        translateX: this.translateX,
        translateY: this.translateY,
      };
    });
    this.listen(this.viewport, "pointermove", (event) => {
      if (this.drag?.pointerId !== event.pointerId) return;
      this.translateX = this.drag.translateX + event.clientX - this.drag.startX;
      this.translateY = this.drag.translateY + event.clientY - this.drag.startY;
      this.applyTransform();
    });
    const endDrag = (event) => {
      if (this.drag?.pointerId === event.pointerId) this.drag = null;
    };
    this.listen(this.viewport, "pointerup", endDrag);
    this.listen(this.viewport, "pointercancel", endDrag);
  }

  renderPage(index) {
    if (index < 0 || index >= this.ifds.length) return;
    const ifd = this.ifds[index];
    const width = Number(ifd.width || ifd.t256?.[0] || 0);
    const height = Number(ifd.height || ifd.t257?.[0] || 0);
    if (!width || !height || width * height > MAX_PAGE_PIXELS) {
      throw new Error("This TIFF page is too large to preview safely.");
    }
    for (const page of this.ifds) delete page.data;
    UTIF.decodeImage(this.buffer, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable.");
    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), width, height),
      0,
      0,
    );
    delete ifd.data;
    this.pageIndex = index;
    emit("stateChanged", {
      handle: this.handle,
      json: { page: index + 1, pageCount: this.ifds.length },
    });
    this.rotation = 0;
    this.fit();
  }

  safeRenderPage(index) {
    try {
      this.renderPage(index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit("error", { handle: this.handle, json: { message } });
    }
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  applyTransform() {
    this.canvas.style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) ` +
      `scale(${this.scale}) rotate(${this.rotation}deg)`;
    this.viewport.dataset.zoomed = String(this.scale > 1);
  }

  setScale(scale) {
    this.scale = Math.min(8, Math.max(0.1, scale));
    this.applyTransform();
  }

  fit() {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  actualSize() {
    if (!this.canvas.width || !this.canvas.clientWidth) return;
    this.setScale(this.canvas.width / this.canvas.clientWidth);
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  download() {
    downloadUrl(this.fileUrl, this.fileName);
  }

  destroy() {
    this.destroyed = true;
    this.abortController.abort();
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners = [];
    this.mount.innerHTML = "";
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const instance = new TiffViewer({ ...data, handle });
    instances.set(handle, instance);
    await instance.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function download(args) {
  instances.get(args.handle || parseArgs(args).handle)?.download();
}

function cleanup(args) {
  const handle = args.handle || parseArgs(args).handle;
  instances.get(handle)?.destroy();
  instances.delete(handle);
}

function previousPage(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) v.safeRenderPage(v.pageIndex - 1);
}
function nextPage(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) v.safeRenderPage(v.pageIndex + 1);
}
function zoomIn(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) v.setScale(v.scale * 1.25);
}
function zoomOut(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) v.setScale(v.scale / 1.25);
}
function fit(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) v.fit();
}
function actualSize(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) v.actualSize();
}
function rotateLeft(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) {
    v.rotation = (v.rotation + 270) % 360;
    v.applyTransform();
  }
}
function rotateRight(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.canvas) {
    v.rotation = (v.rotation + 90) % 360;
    v.applyTransform();
  }
}
registerModule({
  initialize,
  download,
  cleanup,
  previousPage,
  nextPage,
  zoomIn,
  zoomOut,
  fit,
  actualSize,
  rotateLeft,
  rotateRight,
});
