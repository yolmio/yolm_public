// deno-lint-ignore-file no-undef
import { getStroke } from "perfect-freehand";

const pads = new Map();
let resizeObserver = null;

const DEFAULT_INK = "#0f172a";
const DEFAULT_BASE_SIZE = 3.6;
const DEFAULT_ERASER_RADIUS = 18;
const ERASER_CURSOR_COLOR = "rgba(15, 23, 42, 0.55)";
const PEN_ERASER_BUTTON = 5;
const PEN_ERASER_BUTTONS = 32;
const STORAGE_VERSION = 2;
const COORDINATE_PRECISION = 10;
const PRESSURE_PRECISION = 1000;
const MIN_PRESSURE = 0.025;
const PAD_EDGE_MARGIN = 8;
const MIN_JUMP_ALLOWANCE = 80;
const MAX_JUMP_ALLOWANCE = 240;
const MAX_STYLUS_SPEED_PX_PER_MS = 3.5;
const TOOL_PEN = "pen";
const TOOL_ERASER = "eraser";
const STROKE_OPTIONS = {
  size: DEFAULT_BASE_SIZE,
  thinning: 0.62,
  smoothing: 0.62,
  streamline: 0.42,
  simulatePressure: false,
  start: {
    cap: true,
    taper: 0,
  },
  end: {
    cap: true,
    taper: 0,
  },
};

let activeSelectionGuardCount = 0;
let activeSelectionGuardPreviousStyles = null;

function preventActiveSelection(event) {
  event.preventDefault();
}

function setSelectionGuardElementStyles(element) {
  if (!element) return null;
  const previous = {
    userSelect: element.style.userSelect,
    webkitUserSelect: element.style.webkitUserSelect,
    webkitTouchCallout: element.style.webkitTouchCallout,
  };
  element.style.userSelect = "none";
  element.style.webkitUserSelect = "none";
  element.style.webkitTouchCallout = "none";
  return previous;
}

function restoreSelectionGuardElementStyles(element, previous) {
  if (!element || !previous) return;
  element.style.userSelect = previous.userSelect;
  element.style.webkitUserSelect = previous.webkitUserSelect;
  element.style.webkitTouchCallout = previous.webkitTouchCallout;
}

function beginActiveSelectionGuard() {
  activeSelectionGuardCount += 1;
  if (activeSelectionGuardCount !== 1) return;

  activeSelectionGuardPreviousStyles = {
    body: setSelectionGuardElementStyles(document.body),
    documentElement: setSelectionGuardElementStyles(document.documentElement),
  };
  document.addEventListener("selectstart", preventActiveSelection, true);
}

function endActiveSelectionGuard() {
  if (activeSelectionGuardCount === 0) return;
  activeSelectionGuardCount -= 1;
  if (activeSelectionGuardCount !== 0) return;

  document.removeEventListener("selectstart", preventActiveSelection, true);
  restoreSelectionGuardElementStyles(
    document.body,
    activeSelectionGuardPreviousStyles?.body,
  );
  restoreSelectionGuardElementStyles(
    document.documentElement,
    activeSelectionGuardPreviousStyles?.documentElement,
  );
  activeSelectionGuardPreviousStyles = null;
}

function getCoalescedPointerEvents(event) {
  if (!event.getCoalescedEvents) return [event];
  try {
    const events = event.getCoalescedEvents();
    return events.length > 0 ? events : [event];
  } catch (_) {
    return [event];
  }
}

function eventPoint(event, rect) {
  const rawPressure = event.pressure ?? 0.5;
  const pressure = rawPressure > 0 ? Math.max(rawPressure, MIN_PRESSURE) : 0.5;
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure,
    t: Math.round(event.timeStamp),
  };
}

function pointerUsesHardwareEraser(event) {
  return event.pointerType === "pen" &&
    (event.button === PEN_ERASER_BUTTON ||
      (event.buttons & PEN_ERASER_BUTTONS) === PEN_ERASER_BUTTONS);
}

function suppressPointerEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function rounded(value, precision) {
  return Math.round(value * precision) / precision;
}

function serializePoint(point) {
  return [
    rounded(point.x, COORDINATE_PRECISION),
    rounded(point.y, COORDINATE_PRECISION),
    rounded(point.pressure, PRESSURE_PRECISION),
  ];
}

function serializeStroke(stroke) {
  const serialized = {
    p: stroke.points.map(serializePoint),
  };
  if (stroke.color && stroke.color !== DEFAULT_INK) {
    serialized.c = stroke.color;
  }
  if (stroke.baseSize && stroke.baseSize !== DEFAULT_BASE_SIZE) {
    serialized.z = rounded(stroke.baseSize, PRESSURE_PRECISION);
  }
  return serialized;
}

function isFinitePoint(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y) &&
    Number.isFinite(point.pressure);
}

function pointIsInBounds(point, width, height) {
  return point.x >= -PAD_EDGE_MARGIN &&
    point.x <= width + PAD_EDGE_MARGIN &&
    point.y >= -PAD_EDGE_MARGIN &&
    point.y <= height + PAD_EDGE_MARGIN;
}

function pointsAreClose(a, b, baseSize) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy < Math.pow(baseSize / 3, 2);
}

function pointIsLikelyJump(last, point, baseSize) {
  const dx = point.x - last.x;
  const dy = point.y - last.y;
  const distanceSquared = dx * dx + dy * dy;
  const dt = Math.max(0, point.t - last.t);
  const maxDistance = Math.min(
    MAX_JUMP_ALLOWANCE,
    Math.max(
      MIN_JUMP_ALLOWANCE,
      baseSize * 12 + dt * MAX_STYLUS_SPEED_PX_PER_MS,
    ),
  );
  return distanceSquared > maxDistance * maxDistance;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distanceToSegmentSquared(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceSquared(point, a);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  const closest = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
  return distanceSquared(point, closest);
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, a, b) {
  return point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y);
}

function segmentsIntersect(a, b, c, d) {
  const c1 = cross(a, b, c);
  const c2 = cross(a, b, d);
  const c3 = cross(c, d, a);
  const c4 = cross(c, d, b);
  if (
    ((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0)) &&
    ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))
  ) {
    return true;
  }
  return (c1 === 0 && pointOnSegment(c, a, b)) ||
    (c2 === 0 && pointOnSegment(d, a, b)) ||
    (c3 === 0 && pointOnSegment(a, c, d)) ||
    (c4 === 0 && pointOnSegment(b, c, d));
}

function segmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegmentSquared(a, c, d),
    distanceToSegmentSquared(b, c, d),
    distanceToSegmentSquared(c, a, b),
    distanceToSegmentSquared(d, a, b),
  );
}

function appendPoint(stroke, point, width, height) {
  if (!isFinitePoint(point) || !pointIsInBounds(point, width, height)) {
    return false;
  }
  const points = stroke.points;
  const baseSize = stroke.baseSize || DEFAULT_BASE_SIZE;
  const last = points[points.length - 1];
  if (last && pointIsLikelyJump(last, point, baseSize)) {
    return false;
  }
  if (last && pointsAreClose(last, point, baseSize)) {
    last.pressure = Math.max(last.pressure, point.pressure);
    last.t = point.t;
    return false;
  }
  points.push(point);
  return true;
}

function strokeHasInk(stroke) {
  return stroke.points.length > 0;
}

function strokesHaveInk(strokes) {
  return strokes.some(strokeHasInk);
}

function eraseStrokes(strokes, start, end) {
  const nextStrokes = [];
  let changed = false;

  for (const stroke of strokes) {
    const radius = DEFAULT_ERASER_RADIUS +
      (stroke.baseSize || DEFAULT_BASE_SIZE);
    const radiusSquared = radius * radius;
    let currentRun = [];

    for (let i = 0; i < stroke.points.length; i++) {
      const point = stroke.points[i];
      const previous = stroke.points[i - 1];
      const erasesPoint = distanceToSegmentSquared(point, start, end) <=
        radiusSquared;
      const erasesSegment = previous
        ? segmentDistanceSquared(previous, point, start, end) <= radiusSquared
        : false;

      if (erasesPoint || erasesSegment) {
        changed = true;
        if (currentRun.length > 0) {
          nextStrokes.push({ ...stroke, points: currentRun });
          currentRun = [];
        }
        continue;
      }

      currentRun.push(point);
    }

    if (currentRun.length > 0) {
      nextStrokes.push({ ...stroke, points: currentRun });
    }
  }

  return changed ? nextStrokes : strokes;
}

function getDrawablePoints(points, baseSize) {
  if (points.length !== 2) return points;

  const [first, last] = points;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if ((dx * dx + dy * dy) > baseSize * baseSize) return points;

  const interpolated = [first];
  for (let i = 1; i < 5; i++) {
    const t = i / 4;
    interpolated.push({
      ...first,
      x: first.x + dx * t,
      y: first.y + dy * t,
      pressure: first.pressure + (last.pressure - first.pressure) * t,
      t: Math.round(first.t + (last.t - first.t) * t),
    });
  }
  return interpolated;
}

function getSvgPathFromStroke(outlinePoints) {
  if (outlinePoints.length === 0) return "";

  const max = outlinePoints.length - 1;
  const start = outlinePoints[0];
  const path = [`M ${start[0].toFixed(2)} ${start[1].toFixed(2)}`];

  for (let i = 0; i < max; i++) {
    const point = outlinePoints[i];
    const next = outlinePoints[i + 1];
    const midX = ((point[0] + next[0]) / 2).toFixed(2);
    const midY = ((point[1] + next[1]) / 2).toFixed(2);
    path.push(
      `Q ${point[0].toFixed(2)} ${point[1].toFixed(2)} ${midX} ${midY}`,
    );
  }

  path.push("Z");
  return path.join(" ");
}

function drawStroke(ctx, stroke, last = true) {
  const points = getDrawablePoints(
    stroke.points,
    stroke.baseSize || DEFAULT_BASE_SIZE,
  );
  if (points.length === 0) return;

  ctx.save();
  ctx.fillStyle = stroke.color || DEFAULT_INK;

  if (points.length === 1) {
    const baseSize = stroke.baseSize || DEFAULT_BASE_SIZE;
    const r = Math.max(
      baseSize * 1.1,
      baseSize * Math.sqrt(points[0].pressure) * 1.1,
    );
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const outline = getStroke(
    points.map((point) => [point.x, point.y, point.pressure]),
    {
      ...STROKE_OPTIONS,
      size: stroke.baseSize || DEFAULT_BASE_SIZE,
      last,
    },
  );
  const path = new Path2D(getSvgPathFromStroke(outline));
  ctx.fill(path);
  ctx.restore();
}

function drawEraserCursor(ctx, point) {
  ctx.save();
  ctx.strokeStyle = ERASER_CURSOR_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, DEFAULT_ERASER_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function normalizeSavedPage(strokes) {
  if (!strokes) return { w: 770, h: 760, s: [] };
  if (strokes.s) {
    return {
      w: strokes.w || strokes.width || 770,
      h: strokes.h || strokes.height || 760,
      s: (strokes.s || []).map((stroke) => ({
        color: stroke.c || DEFAULT_INK,
        baseSize: stroke.z || DEFAULT_BASE_SIZE,
        points: (stroke.p || []).map((point) => ({
          x: point[0],
          y: point[1],
          pressure: point[2] ?? 0.5,
          t: point[3] ?? 0,
        })),
      })),
    };
  }
  return {
    w: strokes.width || strokes.w || 770,
    h: strokes.height || strokes.h || 760,
    s: (strokes.strokes || []).map((stroke) => ({
      color: stroke.color || stroke.c || DEFAULT_INK,
      baseSize: stroke.baseSize || stroke.z || DEFAULT_BASE_SIZE,
      points: (stroke.points || stroke.p || []).map((point) =>
        Array.isArray(point)
          ? {
            x: point[0],
            y: point[1],
            pressure: point[2] ?? 0.5,
            t: point[3] ?? 0,
          }
          : {
            x: point.x,
            y: point.y,
            pressure: point.pressure ?? 0.5,
            t: point.t ?? 0,
          }
      ),
    })),
  };
}

function strokeToSvgShape(stroke) {
  const points = getDrawablePoints(
    stroke.points,
    stroke.baseSize || DEFAULT_BASE_SIZE,
  );
  if (points.length === 0) return null;
  if (points.length === 1) {
    const baseSize = stroke.baseSize || DEFAULT_BASE_SIZE;
    return {
      circle: true,
      cx: points[0].x,
      cy: points[0].y,
      r: Math.max(
        baseSize * 1.1,
        baseSize * Math.sqrt(points[0].pressure) * 1.1,
      ),
      color: stroke.color || DEFAULT_INK,
    };
  }
  return {
    d: getSvgPathFromStroke(getStroke(
      points.map((point) => [point.x, point.y, point.pressure]),
      {
        ...STROKE_OPTIONS,
        size: stroke.baseSize || DEFAULT_BASE_SIZE,
        last: true,
      },
    )),
    color: stroke.color || DEFAULT_INK,
  };
}

function renderSavedPage(args) {
  const { elementId, strokes } = args;
  const container = document.getElementById(elementId);
  if (!container) return false;

  const page = normalizeSavedPage(strokes);
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  const background = document.createElementNS(svgNamespace, "rect");
  svg.setAttribute("viewBox", `0 0 ${page.w} ${page.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  background.setAttribute("x", "0");
  background.setAttribute("y", "0");
  background.setAttribute("width", String(page.w));
  background.setAttribute("height", String(page.h));
  background.setAttribute("fill", "#ffffff");
  svg.appendChild(background);

  for (const stroke of page.s) {
    const shape = strokeToSvgShape(stroke);
    if (!shape) continue;
    if (shape.circle) {
      const circle = document.createElementNS(svgNamespace, "circle");
      circle.setAttribute("cx", String(shape.cx));
      circle.setAttribute("cy", String(shape.cy));
      circle.setAttribute("r", String(shape.r));
      circle.setAttribute("fill", shape.color);
      svg.appendChild(circle);
    } else {
      const path = document.createElementNS(svgNamespace, "path");
      path.setAttribute("d", shape.d);
      path.setAttribute("fill", shape.color);
      svg.appendChild(path);
    }
  }

  container.replaceChildren(svg);
  return true;
}

class StylusNotePad {
  constructor(container, handle, options = {}) {
    this.container = container;
    this.handle = handle;
    this.logicalWidth = Number.isFinite(options.logicalWidth) &&
        options.logicalWidth > 0
      ? Math.round(options.logicalWidth)
      : null;
    this.logicalHeight = Number.isFinite(options.logicalHeight) &&
        options.logicalHeight > 0
      ? Math.round(options.logicalHeight)
      : null;
    this.strokes = [];
    this.currentStroke = null;
    this.currentTool = null;
    this.currentEraserPoint = null;
    this.lastEraserPoint = null;
    this.eraserChanged = false;
    this.eraserStartStrokes = null;
    this.predictedPoints = [];
    this.pointerId = null;
    this.activePointerType = null;
    this.pointerCaptureActive = false;
    this.finishingPointerId = null;
    this.penDetected = false;
    this.activeSelectionGuard = false;
    this.listeners = [];
    this.tool = TOOL_PEN;

    this.staticCanvas = document.createElement("canvas");
    this.dynamicCanvas = document.createElement("canvas");
    for (const canvas of [this.staticCanvas, this.dynamicCanvas]) {
      canvas.style.position = "absolute";
      canvas.style.inset = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    }
    this.dynamicCanvas.style.touchAction = "none";

    this.container.style.position = this.container.style.position || "relative";
    this.container.style.touchAction = "none";
    this.container.style.overscrollBehavior = "none";
    this.container.style.userSelect = "none";
    this.container.style.webkitUserSelect = "none";
    this.container.style.webkitTouchCallout = "none";
    this.container.replaceChildren(this.staticCanvas, this.dynamicCanvas);

    // Temporarily disabled: desynchronized canvas can render black on some devices.
    // const lowLatencyContextOptions = { desynchronized: true };
    this.staticCtx = this.staticCanvas.getContext("2d");
    this.dynamicCtx = this.dynamicCanvas.getContext("2d");

    this.resize();
    this.setTool(TOOL_PEN);
    this.attach();
  }

  setTool(tool) {
    this.tool = tool === TOOL_ERASER ? TOOL_ERASER : TOOL_PEN;
    this.dynamicCanvas.style.cursor = this.tool === TOOL_ERASER
      ? "cell"
      : "crosshair";
  }

  eventTool(event) {
    return pointerUsesHardwareEraser(event) ? TOOL_ERASER : this.tool;
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
    this.displayWidth = Math.max(1, Math.round(rect.width));
    this.displayHeight = Math.max(1, Math.round(rect.height));
    this.width = this.logicalWidth || this.displayWidth;
    this.height = this.logicalHeight || this.displayHeight;
    this.scaleX = this.displayWidth / this.width;
    this.scaleY = this.displayHeight / this.height;

    for (const canvas of [this.staticCanvas, this.dynamicCanvas]) {
      canvas.width = Math.round(this.displayWidth * dpr);
      canvas.height = Math.round(this.displayHeight * dpr);
      canvas.style.width = `${this.displayWidth}px`;
      canvas.style.height = `${this.displayHeight}px`;
    }
    for (const ctx of [this.staticCtx, this.dynamicCtx]) {
      ctx.setTransform(dpr * this.scaleX, 0, 0, dpr * this.scaleY, 0, 0);
    }
    this.renderStatic();
    this.renderDynamic();
  }

  eventPoint(event, rect) {
    const point = eventPoint(event, rect);
    point.x = point.x / this.scaleX;
    point.y = point.y / this.scaleY;
    return point;
  }

  attach() {
    const down = (event) => {
      if (event.isPrimary === false) {
        if (this.penDetected && event.pointerType !== "pen") {
          suppressPointerEvent(event);
        }
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) return;

      if (
        event.pointerType === "pen" &&
        this.pointerId !== null &&
        this.activePointerType !== "pen"
      ) {
        this.cancelActivePointer();
      }
      if (this.pointerId !== null) {
        suppressPointerEvent(event);
        return;
      }
      if (this.penDetected && event.pointerType !== "pen") {
        suppressPointerEvent(event);
        return;
      }
      if (event.pointerType === "pen") {
        this.penDetected = true;
      }

      event.preventDefault();
      this.pointerId = event.pointerId;
      this.activePointerType = event.pointerType || "";
      if (this.activePointerType === "pen") {
        this.beginActiveSelectionGuard();
      }
      this.currentTool = this.eventTool(event);
      if (this.dynamicCanvas.setPointerCapture) {
        try {
          this.dynamicCanvas.setPointerCapture(event.pointerId);
          this.pointerCaptureActive = true;
        } catch (_) {
          this.pointerCaptureActive = false;
        }
      }
      const rect = this.dynamicCanvas.getBoundingClientRect();
      const point = this.eventPoint(event, rect);
      if (this.currentTool === TOOL_ERASER) {
        this.currentStroke = null;
        this.currentEraserPoint = point;
        this.lastEraserPoint = point;
        this.eraserChanged = false;
        this.eraserStartStrokes = this.strokes;
        this.eraseTo(point);
        emit("noteStarted", { handle: this.handle });
        this.renderDynamic();
        return;
      }
      this.currentStroke = {
        color: DEFAULT_INK,
        baseSize: DEFAULT_BASE_SIZE,
        points: [point],
      };
      this.predictedPoints = [];
      emit("noteStarted", { handle: this.handle });
      this.renderDynamic();
    };

    const move = (event) => {
      if (
        (!this.currentStroke && this.currentTool !== TOOL_ERASER) ||
        event.pointerId !== this.pointerId ||
        event.isPrimary === false
      ) return;
      event.preventDefault();
      const rect = this.dynamicCanvas.getBoundingClientRect();
      if (this.currentTool === TOOL_ERASER) {
        for (const coalesced of getCoalescedPointerEvents(event)) {
          this.eraseTo(this.eventPoint(coalesced, rect));
        }
        this.renderDynamic();
        return;
      }
      for (const coalesced of getCoalescedPointerEvents(event)) {
        appendPoint(
          this.currentStroke,
          this.eventPoint(coalesced, rect),
          this.width,
          this.height,
        );
      }
      // Keep committed ink limited to actual hardware samples. Predicted
      // samples are useful for latency masking, but on pen input they can
      // briefly create long straight-line artifacts as the browser revises
      // its future path.
      this.predictedPoints = [];
      this.renderDynamic();
    };

    const up = (event) => {
      if (
        (!this.currentStroke && this.currentTool !== TOOL_ERASER) ||
        event.pointerId !== this.pointerId
      ) return;
      event.preventDefault();
      const rect = this.dynamicCanvas.getBoundingClientRect();
      if (this.currentTool === TOOL_ERASER) {
        this.eraseTo(this.eventPoint(event, rect));
        this.finishingPointerId = event.pointerId;
        this.releasePointerCapture(event);
        this.finishingPointerId = null;
        this.currentEraserPoint = null;
        this.lastEraserPoint = null;
        this.currentTool = null;
        this.pointerId = null;
        this.activePointerType = null;
        this.eraserStartStrokes = null;
        this.endActiveSelectionGuard();
        this.renderDynamic();
        if (this.eraserChanged) {
          emit("noteChanged", {
            handle: this.handle,
            json: { hasInk: strokesHaveInk(this.strokes) },
          });
        }
        return;
      }
      appendPoint(
        this.currentStroke,
        this.eventPoint(event, rect),
        this.width,
        this.height,
      );
      this.finishingPointerId = event.pointerId;
      this.releasePointerCapture(event);
      this.finishingPointerId = null;
      if (this.currentStroke.points.length > 0) {
        this.strokes.push(this.currentStroke);
      }
      this.currentStroke = null;
      this.currentTool = null;
      this.predictedPoints = [];
      this.pointerId = null;
      this.activePointerType = null;
      this.endActiveSelectionGuard();
      this.renderStatic();
      this.renderDynamic();
      emit("noteChanged", {
        handle: this.handle,
        json: { hasInk: strokesHaveInk(this.strokes) },
      });
    };

    const cancel = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.cancelActivePointer();
    };

    const lostPointerCapture = (event) => {
      if (
        event.pointerId !== this.pointerId ||
        event.pointerId === this.finishingPointerId
      ) {
        return;
      }
      this.cancelActivePointer();
    };

    const documentPointerGuard = (event) => {
      if (!this.penDetected || event.pointerType === "pen") return;
      suppressPointerEvent(event);
    };
    const documentPointerGuardOptions = { capture: true };

    for (
      const [target, type, handler, options] of [
        [
          document,
          "pointerdown",
          documentPointerGuard,
          documentPointerGuardOptions,
        ],
        [
          document,
          "pointermove",
          documentPointerGuard,
          documentPointerGuardOptions,
        ],
        [
          document,
          "pointerup",
          documentPointerGuard,
          documentPointerGuardOptions,
        ],
        [
          document,
          "pointercancel",
          documentPointerGuard,
          documentPointerGuardOptions,
        ],
        [this.dynamicCanvas, "pointerdown", down],
        [document, "pointermove", move],
        [document, "pointerup", up],
        [document, "pointercancel", cancel],
        [this.dynamicCanvas, "lostpointercapture", lostPointerCapture],
      ]
    ) {
      target.addEventListener(type, handler, options);
      this.listeners.push({ target, type, handler, options });
    }

    const contextMenu = (event) => event.preventDefault();
    this.dynamicCanvas.addEventListener("contextmenu", contextMenu);
    this.listeners.push({
      target: this.dynamicCanvas,
      type: "contextmenu",
      handler: contextMenu,
    });

    // iPadOS Scribble keeps its handwriting recognizer hot briefly after each
    // pen stroke and claims quick re-contacts before the page sees them,
    // dropping the strokes. Cancelling the touch events is the only thing
    // that stops it — pointer-event preventDefault and touch-action: none do
    // not. Pointer events still fire, so drawing is unaffected.
    const consumeTouch = (event) => event.preventDefault();
    const touchOptions = { passive: false };
    for (const type of ["touchstart", "touchmove"]) {
      this.dynamicCanvas.addEventListener(type, consumeTouch, touchOptions);
      this.listeners.push({
        target: this.dynamicCanvas,
        type,
        handler: consumeTouch,
        options: touchOptions,
      });
    }
  }

  beginActiveSelectionGuard() {
    if (this.activeSelectionGuard) return;
    this.activeSelectionGuard = true;
    beginActiveSelectionGuard();
  }

  endActiveSelectionGuard() {
    if (!this.activeSelectionGuard) return;
    this.activeSelectionGuard = false;
    endActiveSelectionGuard();
  }

  releasePointerCapture(event) {
    this.releasePointerCaptureForPointer(event.pointerId);
  }

  releasePointerCaptureForPointer(pointerId) {
    if (
      this.pointerCaptureActive && this.dynamicCanvas.hasPointerCapture &&
      this.dynamicCanvas.hasPointerCapture(pointerId)
    ) {
      try {
        this.dynamicCanvas.releasePointerCapture(pointerId);
      } catch (_) {
        // The browser may have already released capture on cancel.
      }
    }
    this.pointerCaptureActive = false;
  }

  cancelActivePointer() {
    const pointerId = this.pointerId;
    const shouldRestoreEraser = this.currentTool === TOOL_ERASER &&
      this.eraserStartStrokes;

    if (shouldRestoreEraser) {
      this.strokes = this.eraserStartStrokes;
    }

    this.currentStroke = null;
    this.currentTool = null;
    this.currentEraserPoint = null;
    this.lastEraserPoint = null;
    this.eraserChanged = false;
    this.eraserStartStrokes = null;
    this.predictedPoints = [];
    this.pointerId = null;
    this.activePointerType = null;
    this.endActiveSelectionGuard();

    if (pointerId !== null) {
      this.releasePointerCaptureForPointer(pointerId);
    }
    if (shouldRestoreEraser) {
      this.renderStatic();
    }
    this.renderDynamic();
  }

  eraseTo(point) {
    if (
      !isFinitePoint(point) || !pointIsInBounds(point, this.width, this.height)
    ) {
      this.lastEraserPoint = null;
      this.currentEraserPoint = null;
      return;
    }
    const start = this.lastEraserPoint &&
        !pointIsLikelyJump(this.lastEraserPoint, point, DEFAULT_ERASER_RADIUS)
      ? this.lastEraserPoint
      : point;
    const nextStrokes = eraseStrokes(this.strokes, start, point);
    if (nextStrokes !== this.strokes) {
      this.strokes = nextStrokes;
      this.eraserChanged = true;
      this.renderStatic();
    }
    this.lastEraserPoint = point;
    this.currentEraserPoint = point;
  }

  renderStatic() {
    this.staticCtx.clearRect(0, 0, this.width, this.height);
    this.staticCtx.fillStyle = "#ffffff";
    this.staticCtx.fillRect(0, 0, this.width, this.height);
    for (const stroke of this.strokes) {
      drawStroke(this.staticCtx, stroke);
    }
  }

  renderDynamic() {
    this.dynamicCtx.clearRect(0, 0, this.width, this.height);
    if (this.currentTool === TOOL_ERASER && this.currentEraserPoint) {
      drawEraserCursor(this.dynamicCtx, this.currentEraserPoint);
      return;
    }
    if (!this.currentStroke) return;
    drawStroke(this.dynamicCtx, {
      ...this.currentStroke,
      points: this.predictedPoints.length > 0
        ? [...this.currentStroke.points, ...this.predictedPoints]
        : this.currentStroke.points,
    }, this.predictedPoints.length === 0);
  }

  clear() {
    this.strokes = [];
    this.currentStroke = null;
    this.currentTool = null;
    this.currentEraserPoint = null;
    this.lastEraserPoint = null;
    this.eraserChanged = false;
    this.eraserStartStrokes = null;
    this.predictedPoints = [];
    this.activePointerType = null;
    this.endActiveSelectionGuard();
    this.renderStatic();
    this.renderDynamic();
    emit("noteCleared", { handle: this.handle, json: { hasInk: false } });
  }

  load(strokes) {
    const page = normalizeSavedPage(strokes);
    this.strokes = page.s;
    this.currentStroke = null;
    this.currentTool = null;
    this.currentEraserPoint = null;
    this.lastEraserPoint = null;
    this.eraserChanged = false;
    this.eraserStartStrokes = null;
    this.predictedPoints = [];
    this.activePointerType = null;
    this.endActiveSelectionGuard();
    this.renderStatic();
    this.renderDynamic();
  }

  getData() {
    return {
      width: this.width,
      height: this.height,
      hasInk: strokesHaveInk(this.strokes),
      strokes: {
        v: STORAGE_VERSION,
        w: this.width,
        h: this.height,
        s: this.strokes.map(serializeStroke),
      },
    };
  }

  destroy() {
    this.endActiveSelectionGuard();
    for (const { target, type, handler, options } of this.listeners) {
      target.removeEventListener(type, handler, options);
    }
    this.listeners = [];
    this.container.replaceChildren();
  }
}

function initialize(args) {
  const { handle, elementId } = args;
  const container = document.getElementById(elementId);
  if (!container) return false;
  const existingPad = pads.get(handle);
  if (existingPad) {
    if (existingPad.container === container) {
      existingPad.resize();
      return true;
    }
    destroyPad(handle, existingPad);
  }
  const pad = new StylusNotePad(container, handle, args);
  pads.set(handle, pad);
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        for (const pad of pads.values()) {
          if (pad.container === entry.target) pad.resize();
        }
      }
    });
  }
  resizeObserver.observe(container);
  if (globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame(() => pad.resize());
  }
  emit("initialized", { handle, json: { elementId } });
  return true;
}

function clear(args) {
  const pad = pads.get(args.handle);
  if (!pad) return false;
  pad.clear();
  return true;
}

function setTool(args) {
  const pad = pads.get(args.handle);
  if (!pad) return false;
  pad.setTool(args.tool);
  return true;
}

function getNoteData(args) {
  const pad = pads.get(args.handle);
  if (!pad) return null;
  return pad.getData();
}

function load(args) {
  const pad = pads.get(args.handle);
  if (!pad) return null;
  pad.load(args.strokes);
  return pad.getData();
}

function goBack(args = {}) {
  const fallback = typeof args.fallback === "string" && args.fallback
    ? args.fallback
    : "/";
  if (globalThis.history && globalThis.history.length > 1) {
    globalThis.history.back();
  } else {
    globalThis.location.assign(fallback);
  }
  return true;
}

function destroyPad(handle, pad) {
  if (resizeObserver) resizeObserver.unobserve(pad.container);
  pad.destroy();
  if (pads.get(handle) === pad) pads.delete(handle);
}

function cleanup(args) {
  const pad = pads.get(args.handle);
  if (!pad) return;
  queueMicrotask(() => {
    if (pads.get(args.handle) !== pad || pad.container.isConnected) return;
    destroyPad(args.handle, pad);
  });
}

function cleanupAll() {
  for (const [handle, pad] of [...pads.entries()]) destroyPad(handle, pad);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

registerModule({
  initialize,
  clear,
  setTool,
  getNoteData,
  load,
  renderSavedPage,
  goBack,
  cleanup,
  cleanupAll,
});
