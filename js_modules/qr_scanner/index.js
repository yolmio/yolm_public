// Consolidated QR Scanner + Camera Capture module
//
// Two instance maps:
//   scanners — camera + QR detection + hardware barcode input
//   cameras  — camera + photo capture (no QR detection)

import { createWorker } from "qr-scanner/qr-scanner-worker.min.js";

// ---------------------------------------------------------------------------
// Audio feedback (Web Audio API)
// ---------------------------------------------------------------------------

let audioCtx = null;
let audioUnlocked = false;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!audioUnlocked) {
    const unlock = () => {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      audioUnlocked = true;
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }
  return audioCtx;
}

function playBeep() {
  try {
    const ctx = ensureAudioContext();
    if (ctx.state === "suspended") return;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = 1800;
    oscillator.type = "sine";
    gainNode.gain.value = 0.3;
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    oscillator.stop(ctx.currentTime + 0.15);
  } catch (_) {
    // Audio feedback is best-effort
  }
}

function vibrate() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }
  } catch (_) {
    // Vibration is best-effort
  }
}

function emitDeferred(eventName, payload) {
  setTimeout(() => {
    emit(eventName, payload);
  }, 0);
}

// ---------------------------------------------------------------------------
// 3-tier QR detection: Native BarcodeDetector > WASM worker > (none)
// ---------------------------------------------------------------------------

let nativeDetector = null;
let nativeDetectorChecked = false;

let wasmWorker = null;
let wasmWorkerReady = null;
let workerMessageId = 0;
const workerCallbacks = new Map();

function initWasmWorker() {
  if (wasmWorkerReady) return wasmWorkerReady;
  wasmWorkerReady = Promise.resolve().then(() => {
    wasmWorker = createWorker();
    wasmWorker.onmessage = (e) => {
      const cb = workerCallbacks.get(e.data.id);
      if (cb) {
        workerCallbacks.delete(e.data.id);
        cb.resolve(e.data);
      }
    };
    wasmWorker.postMessage({
      id: workerMessageId++,
      type: "inversionMode",
      data: "dontInvert",
    });
    return wasmWorker;
  });
  return wasmWorkerReady;
}

function decodeWithWorker(imageData) {
  const id = workerMessageId++;
  return new Promise((resolve) => {
    workerCallbacks.set(id, { resolve });
    wasmWorker.postMessage({ id, type: "decode", data: imageData }, [
      imageData.data.buffer,
    ]);
    setTimeout(() => {
      if (workerCallbacks.has(id)) {
        workerCallbacks.delete(id);
        resolve({ data: null, cornerPoints: [] });
      }
    }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Shared camera helpers
// ---------------------------------------------------------------------------

const QUALITY_PRESETS = {
  low: { width: 640, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
  max: { width: 3840, height: 2160 },
};

function syncCanvasToVideo(canvas, video) {
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
}

async function openCameraStream(facingMode, width, height) {
  const constraints = {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: width },
      height: { ideal: height },
    },
    audio: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (_) {
    console.log("Preferred camera failed, trying any camera");
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: width }, height: { ideal: height } },
      audio: false,
    });
  }
}

async function doSwitchCamera(instance) {
  if (!instance.stream) return false;
  const currentFacing =
    instance.stream.getVideoTracks()[0].getSettings().facingMode;
  const oldStream = instance.stream;
  const newFacing = currentFacing === "environment" ? "user" : "environment";
  const w = instance.canvas?.width || 1280;
  const h = instance.canvas?.height || 720;
  try {
    instance.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: newFacing },
        width: { ideal: w },
        height: { ideal: h },
      },
      audio: false,
    });
  } catch (_) {
    try {
      instance.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: newFacing },
          width: { ideal: w },
          height: { ideal: h },
        },
        audio: false,
      });
    } catch (_) {
      instance.stream = oldStream;
      emit("error", {
        handle: instance.handle,
        json: { message: "Failed to switch camera", type: "camera_switch" },
      });
      return false;
    }
  }
  oldStream.getTracks().forEach((t) => t.stop());
  instance.video.srcObject = instance.stream;
  emit("cameraSwitched", {
    handle: instance.handle,
    json: { facingMode: newFacing },
  });
  return true;
}

async function doToggleFlash(instance) {
  if (!instance.stream) return false;
  const track = instance.stream.getVideoTracks()[0];
  if (!track.getCapabilities().torch) {
    emit("error", {
      handle: instance.handle,
      json: {
        message: "Flashlight not available on this device",
        type: "flash",
      },
    });
    return false;
  }
  const newState = !track.getSettings().torch;
  try {
    await track.applyConstraints({ advanced: [{ torch: newState }] });
    emit("flashToggled", {
      handle: instance.handle,
      json: { enabled: newState },
    });
    return true;
  } catch (_) {
    emit("error", {
      handle: instance.handle,
      json: { message: "Failed to toggle flashlight", type: "flash" },
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// QR Scanner class
// ---------------------------------------------------------------------------

const scanners = new Map();
const BOUNDING_BOX_VISIBLE_MS = 500;
const BOUNDING_BOX_CONFIRM_GRACE_MS = 2500;

class QRScannerInstance {
  constructor(handle, options) {
    this.handle = handle;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.stream = null;
    this.scanning = false;
    this.animationFrameId = null;
    this.lastScanResult = null;
    this.scanCooldown = false;
    this.containerElement = null;
    this.detecting = false;
    this.enableAudio = options.enableAudio !== false;
    this.enableVibration = options.enableVibration !== false;
    this.docKeyBuffer = "";
    this.docKeyLastTime = 0;
    this.docKeydownHandler = null;
    this.destroyed = false;
    this.boundingBoxTimeout = null;
    this.boundingBoxActiveTimeout = null;
    this.boundingBoxActive = false;
  }

  async initialize(elementId) {
    this.destroyed = false;
    try {
      // Probe native BarcodeDetector once
      if (!nativeDetectorChecked) {
        nativeDetectorChecked = true;
        if ("BarcodeDetector" in window) {
          try {
            const formats = await BarcodeDetector.getSupportedFormats();
            if (formats.includes("qr_code")) {
              nativeDetector = new BarcodeDetector({ formats: ["qr_code"] });
            }
          } catch (_) {
            /* not available */
          }
        }
      }
      // Pre-initialize WASM worker if native isn't available
      if (!nativeDetector) {
        await initWasmWorker();
      }

      this.containerElement = document.getElementById(elementId);
      if (!this.containerElement) {
        throw new Error(`Container element not found: ${elementId}`);
      }

      this.video = document.createElement("video");
      this.video.setAttribute("playsinline", "");
      this.video.setAttribute("autoplay", "");
      this.video.setAttribute("muted", "");
      this.video.style.width = "100%";
      this.video.style.height = "100%";
      this.video.style.objectFit = "cover";
      this.video.style.borderRadius = "8px";

      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "none";
      this.context = this.canvas.getContext("2d", { willReadFrequently: true });

      this.containerElement.innerHTML = "";
      this.containerElement.appendChild(this.video);
      this.containerElement.appendChild(this.canvas);

      // Bounding box SVG overlay
      this.overlayElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      Object.assign(this.overlayElement.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "1",
      });
      this.boundingBoxPolygon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon",
      );
      this.boundingBoxPolygon.setAttribute("stroke", "#f97316");
      this.boundingBoxPolygon.setAttribute("stroke-width", "3");
      this.boundingBoxPolygon.setAttribute("fill", "none");
      this.boundingBoxPolygon.setAttribute("stroke-linejoin", "round");
      this.boundingBoxPolygon.style.display = "none";
      this.boundingBoxPolygon.style.transition = "opacity 0.2s ease-out";
      this.overlayElement.appendChild(this.boundingBoxPolygon);
      this.containerElement.appendChild(this.overlayElement);

      if (this.enableAudio) ensureAudioContext();
      this.setupHardwareInput();

      const stream = await openCameraStream("environment", 1280, 720);
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stream = stream;
      if (!this.video) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
        return false;
      }
      this.video.srcObject = this.stream;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Camera timed out waiting for video stream"));
        }, 10000);
        this.video.onloadedmetadata = () => {
          clearTimeout(timeout);
          this.video.play();
          resolve();
        };
      });

      if (this.destroyed || !this.video || !this.canvas) return false;
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      return true;
    } catch (err) {
      if (this.destroyed) return false;
      console.error("Failed to initialize QR scanner:", err);
      emitDeferred("error", {
        handle: this.handle,
        json: {
          message: err.message || "Failed to access camera",
          type: "initialization",
        },
      });
      return false;
    }
  }

  startScanning() {
    if (this.scanning) return;
    this.scanning = true;
    this.detecting = false;
    this.boundingBoxActive = false;
    this.scanFrame();
    emit("scanningStarted", { handle: this.handle });
  }

  stopScanning() {
    this.scanning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    emit("scanningStopped", { handle: this.handle });
  }

  scanFrame() {
    if (!this.scanning || !this.video) return;

    if (
      this.video.readyState === this.video.HAVE_ENOUGH_DATA &&
      !this.detecting
    ) {
      this.detecting = true;

      const onResult = (data, location) => {
        this.detecting = false;
        if (data && location) {
          this.showBoundingBox(location);
        }
        if (data && !this.scanCooldown && data !== this.lastScanResult) {
          this.lastScanResult = data;
          this.scanCooldown = true;
          if (this.enableAudio) playBeep();
          if (this.enableVibration) vibrate();
          emit("qrCodeDetected", {
            handle: this.handle,
            json: { data, location },
          });
          setTimeout(() => {
            this.scanCooldown = false;
          }, 1500);
        }
      };

      if (nativeDetector) {
        nativeDetector
          .detect(this.video)
          .then((barcodes) => {
            if (barcodes.length > 0) {
              const b = barcodes[0];
              onResult(b.rawValue, {
                topLeft: b.cornerPoints[0],
                topRight: b.cornerPoints[1],
                bottomRight: b.cornerPoints[2],
                bottomLeft: b.cornerPoints[3],
              });
            } else {
              this.detecting = false;
            }
          })
          .catch(() => {
            this.detecting = false;
          });
      } else if (wasmWorker) {
        this.context.drawImage(
          this.video,
          0,
          0,
          this.canvas.width,
          this.canvas.height,
        );
        const imageData = this.context.getImageData(
          0,
          0,
          this.canvas.width,
          this.canvas.height,
        );
        decodeWithWorker(imageData).then((result) => {
          if (result.data !== null) {
            const cp = result.cornerPoints || [];
            onResult(result.data, {
              topLeft: cp[0],
              topRight: cp[1],
              bottomRight: cp[2],
              bottomLeft: cp[3],
            });
          } else {
            this.detecting = false;
          }
        });
      } else {
        this.detecting = false;
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.scanFrame());
  }

  emitHardwareScan(value) {
    if (!value || this.scanCooldown || value === this.lastScanResult) return;
    this.lastScanResult = value;
    this.scanCooldown = true;
    if (this.enableAudio) playBeep();
    if (this.enableVibration) vibrate();
    emit("qrCodeDetected", {
      handle: this.handle,
      json: { data: value },
    });
    setTimeout(() => {
      this.scanCooldown = false;
    }, 1500);
  }

  setupHardwareInput() {
    // Document-level keydown listener for hardware barcode scanners.
    // Hardware scanners in "key pressure" / "keyboard wedge" mode dispatch
    // rapid keydown events followed by Enter. We accumulate characters
    // that arrive faster than human typing and emit on Enter.
    this.docKeyBuffer = "";
    this.docKeyLastTime = 0;
    const SCAN_MAX_INTER_CHAR_MS = 80;

    this.docKeydownHandler = (e) => {
      // Skip if user is typing in a real form field
      const tag = e.target?.tagName;
      if (
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        e.target?.isContentEditable
      ) {
        this.docKeyBuffer = "";
        return;
      }
      const now = Date.now();
      if (e.key === "Enter") {
        if (this.docKeyBuffer.length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          const value = this.docKeyBuffer;
          this.docKeyBuffer = "";
          this.emitHardwareScan(value);
        }
        this.docKeyBuffer = "";
        return;
      }
      if (e.key.length === 1) {
        if (
          now - this.docKeyLastTime > SCAN_MAX_INTER_CHAR_MS &&
          this.docKeyBuffer.length > 0
        ) {
          this.docKeyBuffer = "";
        }
        this.docKeyBuffer += e.key;
        this.docKeyLastTime = now;
      }
    };
    document.addEventListener("keydown", this.docKeydownHandler, true);
  }

  async captureFrame() {
    if (
      !this.stream || !this.video || !this.canvas || !this.context ||
      this.video.videoWidth === 0 || this.video.videoHeight === 0
    ) {
      return null;
    }
    syncCanvasToVideo(this.canvas, this.video);
    this.context.drawImage(
      this.video,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    return new Promise((resolve) => {
      this.canvas.toBlob(resolve, "image/jpeg", 0.85);
    });
  }

  videoToDisplayCoords(point) {
    const rect = this.containerElement.getBoundingClientRect();
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const scale = Math.max(rect.width / vw, rect.height / vh);
    const offsetX = (rect.width - vw * scale) / 2;
    const offsetY = (rect.height - vh * scale) / 2;
    return { x: point.x * scale + offsetX, y: point.y * scale + offsetY };
  }

  showBoundingBox(location) {
    if (
      !location || !location.topLeft || !this.boundingBoxPolygon ||
      !this.containerElement
    ) {
      return;
    }
    const corners = [
      location.topLeft,
      location.topRight,
      location.bottomRight,
      location.bottomLeft,
    ];
    const points = corners
      .map((c) => {
        const p = this.videoToDisplayCoords(c);
        return `${p.x},${p.y}`;
      })
      .join(" ");
    this.boundingBoxPolygon.setAttribute("points", points);
    this.boundingBoxPolygon.style.display = "block";
    this.boundingBoxPolygon.style.opacity = "1";
    if (!this.boundingBoxActive) {
      this.boundingBoxActive = true;
      emit("boundingBoxVisible", { handle: this.handle });
    }
    if (this.boundingBoxTimeout) clearTimeout(this.boundingBoxTimeout);
    if (this.boundingBoxActiveTimeout) {
      clearTimeout(this.boundingBoxActiveTimeout);
    }
    this.boundingBoxTimeout = setTimeout(() => {
      if (this.boundingBoxPolygon) {
        this.boundingBoxPolygon.style.opacity = "0";
      }
    }, BOUNDING_BOX_VISIBLE_MS);
    this.boundingBoxActiveTimeout = setTimeout(() => {
      if (!this.boundingBoxActive) return;
      this.boundingBoxActive = false;
      if (this.boundingBoxPolygon) {
        this.boundingBoxPolygon.style.display = "none";
      }
      emit("boundingBoxExpired", { handle: this.handle });
    }, BOUNDING_BOX_CONFIRM_GRACE_MS);
  }

  hideBoundingBox() {
    if (this.boundingBoxTimeout) {
      clearTimeout(this.boundingBoxTimeout);
      this.boundingBoxTimeout = null;
    }
    if (this.boundingBoxActiveTimeout) {
      clearTimeout(this.boundingBoxActiveTimeout);
      this.boundingBoxActiveTimeout = null;
    }
    if (this.boundingBoxPolygon) {
      this.boundingBoxPolygon.style.display = "none";
      this.boundingBoxPolygon.style.opacity = "0";
    }
    if (this.boundingBoxActive) {
      this.boundingBoxActive = false;
      emit("boundingBoxExpired", { handle: this.handle });
    }
  }

  resetLastScan() {
    this.lastScanResult = null;
    this.scanCooldown = false;
    this.docKeyBuffer = "";
  }

  destroy() {
    this.destroyed = true;
    this.stopScanning();
    this.hideBoundingBox();
    if (this.docKeydownHandler) {
      document.removeEventListener("keydown", this.docKeydownHandler, true);
      this.docKeydownHandler = null;
    }
    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
    }
    this.overlayElement = null;
    this.boundingBoxPolygon = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video && this.video.parentNode) {
      this.video.parentNode.removeChild(this.video);
    }
    this.video = null;
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.context = null;
    this.containerElement = null;
  }
}

// ---------------------------------------------------------------------------
// Camera Capture class
// ---------------------------------------------------------------------------

const cameras = new Map();

class CameraCaptureInstance {
  constructor(handle) {
    this.handle = handle;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.stream = null;
    this.containerElement = null;
    this.blobUrls = [];
  }

  async open(elementId, options = {}) {
    try {
      this.containerElement = document.getElementById(elementId);
      if (!this.containerElement) {
        throw new Error(`Container element not found: ${elementId}`);
      }

      this.video = document.createElement("video");
      this.video.setAttribute("playsinline", "");
      this.video.setAttribute("autoplay", "");
      this.video.setAttribute("muted", "");
      this.video.style.width = "100%";
      this.video.style.height = "100%";
      this.video.style.objectFit = "cover";

      this.canvas = document.createElement("canvas");
      this.canvas.style.display = "none";
      this.context = this.canvas.getContext("2d");

      this.containerElement.innerHTML = "";
      this.containerElement.appendChild(this.video);
      this.containerElement.appendChild(this.canvas);

      const preset = QUALITY_PRESETS[options.quality] || QUALITY_PRESETS.high;
      this.stream = await openCameraStream(
        options.facingMode || "environment",
        preset.width,
        preset.height,
      );
      this.video.srcObject = this.stream;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Camera timed out waiting for video stream"));
        }, 10000);
        this.video.onloadedmetadata = () => {
          clearTimeout(timeout);
          this.video.play();
          resolve();
        };
      });

      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;

      return true;
    } catch (err) {
      console.error("[camera] Failed to open:", err);
      emitDeferred("error", {
        handle: this.handle,
        json: { message: err.message || "Failed to access camera" },
      });
      return false;
    }
  }

  async capture(jpegQuality = 0.92) {
    if (!this.video || !this.canvas || !this.context) {
      emit("error", {
        handle: this.handle,
        json: { message: "Camera not ready" },
      });
      return null;
    }
    syncCanvasToVideo(this.canvas, this.video);
    this.context.drawImage(
      this.video,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    return new Promise((resolve) => {
      this.canvas.toBlob(
        (blob) => {
          if (!blob) {
            emit("error", {
              handle: this.handle,
              json: { message: "Failed to capture photo" },
            });
            resolve(null);
            return;
          }
          const url = URL.createObjectURL(blob);
          this.blobUrls.push(url);
          emit("photoCaptured", {
            handle: this.handle,
            json: {
              url,
              size: blob.size,
              width: this.canvas.width,
              height: this.canvas.height,
            },
          });
          resolve({ blob, url });
        },
        "image/jpeg",
        jpegQuality,
      );
    });
  }

  async captureToInput(fileInputId, jpegQuality = 0.92) {
    const result = await this.capture(jpegQuality);
    if (!result) return false;
    const fileInput = document.getElementById(fileInputId);
    if (!fileInput) {
      console.warn("File input not found:", fileInputId);
      return false;
    }
    const file = new File([result.blob], "photo-" + Date.now() + ".jpg", {
      type: "image/jpeg",
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  close() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      if (this.video.parentNode) this.video.parentNode.removeChild(this.video);
      this.video = null;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this.context = null;
  }

  destroy() {
    this.close();
    this.blobUrls.forEach((url) => URL.revokeObjectURL(url));
    this.blobUrls = [];
    this.containerElement = null;
  }
}

// ---------------------------------------------------------------------------
// Exported functions — Scanner
// ---------------------------------------------------------------------------

function getInstance(handle) {
  return scanners.get(handle) || cameras.get(handle);
}

async function initializeScanner(args) {
  const { handle, elementId, enableAudio, enableVibration } = args;
  if (scanners.has(handle)) cleanup({ handle });
  const scanner = new QRScannerInstance(handle, {
    enableAudio,
    enableVibration,
  });
  // Register immediately so cleanup/reset still work if camera access fails.
  // The hardware-scanner path should remain owned by this handle even when the
  // camera is unavailable.
  scanners.set(handle, scanner);
  const ok = await scanner.initialize(elementId);
  if (ok) {
    scanner.startScanning();
    emitDeferred("initialized", { handle, json: { elementId } });
  }
  return ok;
}

function startScanning(args) {
  const scanner = scanners.get(args.handle);
  if (!scanner) return false;
  scanner.startScanning();
  return true;
}

function stopScanning(args) {
  const scanner = scanners.get(args.handle);
  if (!scanner) return false;
  scanner.stopScanning();
  return true;
}

function resetLastScan(args) {
  const scanner = scanners.get(args.handle);
  if (!scanner) return false;
  scanner.resetLastScan();
  return true;
}

async function confirmAndCapture(args) {
  const { handle, endpoint } = args;
  const scanner = scanners.get(handle);
  if (!scanner) return false;

  const frame = await scanner.captureFrame();
  if (!frame) {
    emit("uploadFailed", {
      handle,
      json: { error: "Camera unavailable" },
    });
    return false;
  }
  emit("uploadStarted", { handle });

  try {
    const body = await frame.arrayBuffer();
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      emit("uploadFailed", { handle, json: { error: text } });
      return false;
    }
    emit("uploadComplete", { handle });
    return true;
  } catch (e) {
    emit("uploadFailed", { handle, json: { error: e.message } });
    return false;
  }
}

async function captureFrame(args) {
  const { handle, fileInputId } = args;
  const scanner = scanners.get(handle);
  if (!scanner) return false;

  const blob = await scanner.captureFrame();
  if (!blob) return false;

  const fileInput = document.getElementById(fileInputId);
  if (!fileInput) return false;

  const file = new File([blob], "scan-photo.jpg", { type: "image/jpeg" });
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function hideBoundingBox(args) {
  const scanner = scanners.get(args.handle);
  if (!scanner) return false;
  scanner.hideBoundingBox();
  return true;
}

// ---------------------------------------------------------------------------
// Exported functions — Camera
// ---------------------------------------------------------------------------

async function openCamera(args) {
  const { handle, elementId, quality, facingMode } = args;
  if (cameras.has(handle)) {
    const cam = cameras.get(handle);
    cam.destroy();
    cameras.delete(handle);
  }
  const cam = new CameraCaptureInstance(handle);
  const ok = await cam.open(elementId, { quality, facingMode });
  if (ok) cameras.set(handle, cam);
  return ok;
}

async function capturePhoto(args) {
  const cam = cameras.get(args.handle);
  if (!cam) return false;
  return !!(await cam.capture(args.quality || 0.92));
}

async function captureToFileInput(args) {
  const cam = cameras.get(args.handle);
  if (!cam) return false;
  return await cam.captureToInput(args.fileInputId, args.quality || 0.92);
}

function closeCamera(args) {
  const cam = cameras.get(args.handle);
  if (cam) {
    cam.close();
    emit("cameraClosed", { handle: args.handle, json: {} });
  }
}

// ---------------------------------------------------------------------------
// Exported functions — Shared
// ---------------------------------------------------------------------------

async function switchCamera(args) {
  const inst = getInstance(args.handle);
  if (!inst) return false;
  return await doSwitchCamera(inst);
}

async function toggleFlash(args) {
  const inst = getInstance(args.handle);
  if (!inst) return false;
  return await doToggleFlash(inst);
}

function cleanup(args) {
  const { handle } = args;
  const scanner = scanners.get(handle);
  if (scanner) {
    scanner.destroy();
    scanners.delete(handle);
  }
  const cam = cameras.get(handle);
  if (cam) {
    cam.destroy();
    cameras.delete(handle);
  }
}

function cleanupAll() {
  scanners.forEach((_, handle) => cleanup({ handle }));
  cameras.forEach((_, handle) => cleanup({ handle }));
  if (wasmWorker) {
    wasmWorker.terminate();
    wasmWorker = null;
    wasmWorkerReady = null;
  }
}

async function checkCameraAvailability() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return { available: devices.some((d) => d.kind === "videoinput") };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

registerModule({
  // Scanner (camera + QR detection)
  initializeScanner,
  startScanning,
  stopScanning,
  switchCamera,
  toggleFlash,
  resetLastScan,
  confirmAndCapture,
  captureFrame,
  cleanup,
  cleanupAll,
  checkCameraAvailability,
  hideBoundingBox,
  // Camera (camera + photo capture, no QR)
  openCamera,
  capturePhoto,
  captureToFileInput,
  closeCamera,
});

console.log("[QR Scanner] Module registered successfully");
