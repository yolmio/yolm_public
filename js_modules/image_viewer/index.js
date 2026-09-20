// deno-lint-ignore-file no-undef

const instances = new Map();

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

function requiredMount(elementId) {
  const mount = document.getElementById(elementId);
  if (!mount) throw new Error("The image viewer mount is unavailable.");
  return mount;
}

function emitError(handle, error) {
  const message = error instanceof Error ? error.message : String(error);
  emit("error", { handle, json: { message } });
  return moduleResult(handle, { success: false, error: message });
}

class ImageViewer {
  constructor({ handle, elementId, fileUrl, fileName }) {
    this.handle = handle;
    this.mount = requiredMount(elementId);
    this.fileUrl = fileUrl;
    this.fileName = fileName || "image";
    this.scale = 1;
    this.rotation = 0;
    this.translateX = 0;
    this.translateY = 0;
    this.drag = null;
    this.listeners = [];
    this.build();
  }

  build() {
    this.mount.innerHTML = "";
    this.mount.style.height = "100%";
    this.mount.style.minHeight = "0";
    this.viewport = document.createElement("div");
    Object.assign(this.viewport.style, {
      alignItems: "center",
      background: "#202124",
      display: "flex",
      height: "100%",
      justifyContent: "center",
      overflow: "hidden",
      position: "relative",
      touchAction: "none",
      width: "100%",
    });
    this.image = document.createElement("img");
    this.image.alt = this.fileName;
    this.image.draggable = false;
    Object.assign(this.image.style, {
      maxHeight: "calc(100% - 2rem)",
      maxWidth: "calc(100% - 2rem)",
      objectFit: "contain",
      transformOrigin: "center center",
      userSelect: "none",
    });
    this.viewport.append(this.image);
    this.mount.append(this.viewport);
    this.listen(this.image, "load", () => {
      this.fit();
      emit("ready", {
        handle: this.handle,
        json: {
          height: this.image.naturalHeight,
          width: this.image.naturalWidth,
        },
      });
    });
    this.listen(this.image, "error", () => {
      emit("error", {
        handle: this.handle,
        json: { message: "The image could not be loaded." },
      });
    });
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
      this.viewport.style.cursor = "grabbing";
    });
    this.listen(this.viewport, "pointermove", (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      this.translateX = this.drag.translateX + event.clientX - this.drag.startX;
      this.translateY = this.drag.translateY + event.clientY - this.drag.startY;
      this.applyTransform();
    });
    const endDrag = (event) => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      this.drag = null;
      this.viewport.style.cursor = this.scale > 1 ? "grab" : "default";
    };
    this.listen(this.viewport, "pointerup", endDrag);
    this.listen(this.viewport, "pointercancel", endDrag);
    this.image.src = this.fileUrl;
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  applyTransform() {
    this.image.style.transform =
      `translate(${this.translateX}px, ${this.translateY}px) ` +
      `scale(${this.scale}) rotate(${this.rotation}deg)`;
    this.viewport.style.cursor = this.scale > 1 ? "grab" : "default";
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
    if (!this.image.naturalWidth || !this.image.clientWidth) return;
    this.setScale(this.image.naturalWidth / this.image.clientWidth);
    this.translateX = 0;
    this.translateY = 0;
    this.applyTransform();
  }

  rotate(delta) {
    this.rotation = (this.rotation + delta + 360) % 360;
    this.applyTransform();
  }

  download() {
    const anchor = document.createElement("a");
    anchor.href = this.fileUrl;
    anchor.download = this.fileName;
    anchor.rel = "noreferrer";
    anchor.click();
  }

  destroy() {
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners = [];
    this.mount.innerHTML = "";
  }
}

function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const instance = new ImageViewer({ ...data, handle });
    instances.set(handle, instance);
    return moduleResult(handle, { success: true });
  } catch (error) {
    return emitError(handle, error);
  }
}

function zoomIn(args) {
  const instance = instances.get(args.handle || parseArgs(args).handle);
  instance?.setScale(instance.scale * 1.25);
}

function zoomOut(args) {
  const instance = instances.get(args.handle || parseArgs(args).handle);
  instance?.setScale(instance.scale / 1.25);
}

function fit(args) {
  instances.get(args.handle || parseArgs(args).handle)?.fit();
}

function actualSize(args) {
  instances.get(args.handle || parseArgs(args).handle)?.actualSize();
}

function rotateLeft(args) {
  instances.get(args.handle || parseArgs(args).handle)?.rotate(-90);
}

function rotateRight(args) {
  instances.get(args.handle || parseArgs(args).handle)?.rotate(90);
}

function download(args) {
  instances.get(args.handle || parseArgs(args).handle)?.download();
}

function cleanup(args) {
  const handle = args.handle || parseArgs(args).handle;
  instances.get(handle)?.destroy();
  instances.delete(handle);
}

registerModule({
  initialize,
  zoomIn,
  zoomOut,
  fit,
  actualSize,
  rotateLeft,
  rotateRight,
  download,
  cleanup,
});
