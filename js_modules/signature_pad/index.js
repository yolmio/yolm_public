const __v2 = 1;
// Module state
let canvases = new Map(); // Store multiple canvas instances by handle
let resizeObserver = null;

// Canvas instance class
class SignaturePad {
  constructor(canvasElement, handle) {
    this.canvas = canvasElement;
    this.handle = handle;
    this.context = canvasElement.getContext("2d");
    this.isDrawing = false;
    this.currentPath = [];
    this.paths = [];
    this.eventListeners = [];

    this.setupCanvas();
    this.attachEventListeners();
  }

  setupCanvas() {
    // Set canvas size to match display size
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    // Initial drawing
    this.drawBackground();
  }

  drawBackground() {
    if (!this.context) return;

    // White background
    this.context.fillStyle = "white";
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw signature line
    this.context.strokeStyle = "#e0e0e0";
    this.context.lineWidth = 1;
    this.context.setLineDash([5, 5]);
    this.context.beginPath();
    this.context.moveTo(20, this.canvas.height - 40);
    this.context.lineTo(this.canvas.width - 20, this.canvas.height - 40);
    this.context.stroke();
    this.context.setLineDash([]);

    // Draw "Sign here" text
    this.context.fillStyle = "#999";
    this.context.font = "12px Arial";
    this.context.fillText("Sign here", 25, this.canvas.height - 25);
  }

  startDrawing(x, y) {
    this.isDrawing = true;
    this.currentPath = [{ x, y }];

    // Emit signature started event
    emit("signatureStarted", { handle: this.handle });
  }

  draw(x, y) {
    if (!this.isDrawing || !this.context) return;

    this.currentPath.push({ x, y });

    // Draw current stroke
    this.context.beginPath();
    this.context.strokeStyle = "#000";
    this.context.lineWidth = 2;
    this.context.lineCap = "round";
    this.context.lineJoin = "round";

    if (this.currentPath.length > 1) {
      this.context.moveTo(this.currentPath[this.currentPath.length - 2].x, this.currentPath[this.currentPath.length - 2].y);
      this.context.lineTo(x, y);
      this.context.stroke();
    }
  }

  stopDrawing() {
    if (!this.isDrawing) return;

    this.isDrawing = false;
    if (this.currentPath.length > 1) {
      this.paths.push([...this.currentPath]);

      // Emit signature changed event
      emit("signatureChanged", { handle: this.handle, json: {
        isEmpty: this.paths.length === 0,
      }});
    }
    this.currentPath = [];
  }

  clear() {
    this.paths = [];
    this.currentPath = [];
    this.redraw();

    // Emit signature cleared event
    emit("signatureCleared", { handle: this.handle });
  }

  redraw() {
    if (!this.context) return;

    // Clear and redraw background
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground();

    // Redraw all paths
    if (this.paths.length > 0) {
      this.context.beginPath();
      this.context.strokeStyle = "#000";
      this.context.lineWidth = 2;
      this.context.lineCap = "round";
      this.context.lineJoin = "round";

      for (const path of this.paths) {
        if (path.length > 1) {
          this.context.moveTo(path[0].x, path[0].y);
          for (let i = 1; i < path.length; i++) {
            this.context.lineTo(path[i].x, path[i].y);
          }
        }
      }

      this.context.stroke();
    }
  }

  getSignatureData(hideGuideInOutput = false) {
    // Check if signature is empty
    if (this.paths.length === 0) {
      return null;
    }
    if (hideGuideInOutput) {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = this.canvas.width;
      exportCanvas.height = this.canvas.height;
      const exportContext = exportCanvas.getContext("2d");
      exportContext.fillStyle = "white";
      exportContext.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportContext.beginPath();
      exportContext.strokeStyle = "#000";
      exportContext.lineWidth = 2;
      exportContext.lineCap = "round";
      exportContext.lineJoin = "round";
      for (const path of this.paths) {
        if (path.length > 1) {
          exportContext.moveTo(path[0].x, path[0].y);
          for (let i = 1; i < path.length; i++) {
            exportContext.lineTo(path[i].x, path[i].y);
          }
        }
      }
      exportContext.stroke();
      return exportCanvas.toDataURL("image/png");
    }
    console.log("signature data", this.canvas.toDataURL("image/png"));
    return this.canvas.toDataURL("image/png");
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();

    // Save current signature
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const tempContext = tempCanvas.getContext("2d");
    tempContext.drawImage(this.canvas, 0, 0);

    // Resize canvas
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    // Redraw signature
    this.redraw();
  }

  attachEventListeners() {
    // Helper to get coordinates
    const getCoordinates = (e, rect) => {
      if (e.touches && e.touches.length > 0) {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      }
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    // Mouse events
    const mouseDownHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const coords = getCoordinates(e, rect);
      this.startDrawing(coords.x, coords.y);
    };

    const mouseMoveHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const coords = getCoordinates(e, rect);
      this.draw(coords.x, coords.y);
    };

    const mouseUpHandler = () => {
      this.stopDrawing();
    };

    // Touch events
    const touchStartHandler = (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const coords = getCoordinates(e, rect);
      this.startDrawing(coords.x, coords.y);
    };

    const touchMoveHandler = (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const coords = getCoordinates(e, rect);
      this.draw(coords.x, coords.y);
    };

    const touchEndHandler = (e) => {
      e.preventDefault();
      this.stopDrawing();
    };

    // Attach listeners
    this.canvas.addEventListener("mousedown", mouseDownHandler);
    this.canvas.addEventListener("mousemove", mouseMoveHandler);
    this.canvas.addEventListener("mouseup", mouseUpHandler);
    this.canvas.addEventListener("mouseleave", mouseUpHandler);

    this.canvas.addEventListener("touchstart", touchStartHandler, { passive: false });
    this.canvas.addEventListener("touchmove", touchMoveHandler, { passive: false });
    this.canvas.addEventListener("touchend", touchEndHandler, { passive: false });

    // Store references for cleanup
    this.eventListeners = [
      { type: "mousedown", handler: mouseDownHandler },
      { type: "mousemove", handler: mouseMoveHandler },
      { type: "mouseup", handler: mouseUpHandler },
      { type: "mouseleave", handler: mouseUpHandler },
      { type: "touchstart", handler: touchStartHandler },
      { type: "touchmove", handler: touchMoveHandler },
      { type: "touchend", handler: touchEndHandler },
    ];
  }

  destroy() {
    // Remove event listeners
    this.eventListeners.forEach(({ type, handler }) => {
      this.canvas.removeEventListener(type, handler);
    });
    this.eventListeners = [];

    // Clear references
    this.context = null;
    this.canvas = null;
  }
}

// Initialize a signature pad
function initializeCanvas(args) {
  const { handle, elementId } = args;

  const canvasElement = document.getElementById(elementId);
  if (!canvasElement) {
    console.error("Canvas element not found:", elementId);
    return false;
  }

  // Cleanup existing instance if any
  if (canvases.has(handle)) {
    cleanup({ handle });
  }

  // Create new signature pad instance
  const signaturePad = new SignaturePad(canvasElement, handle);
  canvases.set(handle, signaturePad);

  // Setup resize observer if not already created
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        // Find which signature pad this canvas belongs to
        canvases.forEach((pad) => {
          if (pad.canvas === entry.target) {
            pad.resize();
          }
        });
      });
    });
  }

  // Observe canvas for resize
  resizeObserver.observe(canvasElement);

  emit("initialized", { handle, json: { elementId } });
  return true;
}

// Clear the signature
function clearSignature(args) {
  const { handle } = args;

  const signaturePad = canvases.get(handle);
  if (!signaturePad) {
    console.warn("Signature pad not found for handle:", handle);
    return false;
  }

  signaturePad.clear();
  return true;
}

// Get signature data as base64
function getSignatureData(args) {
  const { handle } = args;

  const signaturePad = canvases.get(handle);
  if (!signaturePad) {
    console.warn("Signature pad not found for handle:", handle);
    return null;
  }

  const dataUrl = signaturePad.getSignatureData();
  console.log("dataUrl", dataUrl);

  // Return as an object to avoid string serialization issues with resultJsonScalar
  if (dataUrl === null) {
    return { signature: null };
  }

  return { signature: dataUrl };
}

function getCleanSignatureData(args) {
  const { handle } = args;

  const signaturePad = canvases.get(handle);
  if (!signaturePad) {
    console.warn("Signature pad not found for handle:", handle);
    return null;
  }

  const dataUrl = signaturePad.getSignatureData(true);
  if (dataUrl === null) {
    return { signature: null };
  }

  return { signature: dataUrl };
}

// Check if signature is empty
function isEmpty(args) {
  const { handle } = args;

  const signaturePad = canvases.get(handle);
  if (!signaturePad) {
    return true;
  }

  return signaturePad.paths.length === 0;
}

// Cleanup a signature pad instance
function cleanup(args) {
  const { handle } = args;

  const signaturePad = canvases.get(handle);
  if (signaturePad) {
    // Stop observing canvas
    if (resizeObserver && signaturePad.canvas) {
      resizeObserver.unobserve(signaturePad.canvas);
    }

    // Destroy the pad
    signaturePad.destroy();

    // Remove from map
    canvases.delete(handle);
  }
}

// Cleanup all instances
function cleanupAll() {
  canvases.forEach((pad, handle) => {
    cleanup({ handle });
  });

  // Disconnect resize observer
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

registerModule({
  initializeCanvas,
  clearSignature,
  getSignatureData,
  getCleanSignatureData,
  isEmpty,
  cleanup,
  cleanupAll,
});
