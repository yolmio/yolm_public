// deno-lint-ignore-file no-undef

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "./vendor/DRACOLoader.js";

const instances = new Map();
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const MAX_GRAPH_PAGE_SIZE = 2_000;
const MAX_COMMAND_KEYS = 100_000;
const VIEW_DIRECTIONS = {
  isometric: new THREE.Vector3(1, 0.8, 1),
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

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

function emitEvent(name, handle, json) {
  emit(name, { handle, json });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function objectValue(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function arrayValue(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function cadIdentity(object) {
  const data = objectValue(object?.userData) || {};
  return objectValue(data.yolmCad) || {
    objectKey: data["yolmCad.objectKey"],
    definitionKey: data["yolmCad.definitionKey"],
    kind: data["yolmCad.kind"],
  };
}

function stringArray(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_COMMAND_KEYS) {
    throw new Error(`${name} must contain at most ${MAX_COMMAND_KEYS} keys.`);
  }
  return value.map((item) => String(item));
}

function instanceFor(args) {
  const data = parseArgs(args);
  return instances.get(args?.handle || data.handle);
}

function forEachMaterial(object, callback) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) callback(material, child);
  });
}

function inspectSelfContainedGlb(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 20) {
    throw new Error("The file is not a valid GLB 2.0 model.");
  }
  const view = new DataView(buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw new Error("The file is not a valid GLB 2.0 model.");
  }
  let offset = 12;
  let json = null;
  const chunks = [];
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength) {
      throw new Error("The GLB contains an invalid chunk.");
    }
    chunks.push({ end, length, start, type });
    if (type === 0x4e4f534a && json === null) {
      const source = new TextDecoder().decode(bytes.subarray(start, end))
        .trim();
      try {
        json = JSON.parse(source);
      } catch {
        throw new Error("The GLB contains invalid scene metadata.");
      }
    }
    offset = end;
  }
  if (!json) throw new Error("The GLB does not contain scene metadata.");
  const referencedUris = [
    ...(json.buffers || []).map((item) => item?.uri),
    ...(json.images || []).map((item) => item?.uri),
  ].filter(Boolean);
  if (referencedUris.some((uri) => !String(uri).startsWith("data:"))) {
    throw new Error(
      "This GLB references an external resource. Only self-contained GLB files can be viewed.",
    );
  }
  return { bytes, chunks, json };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function glbWithDataUriImages(inspected) {
  const embeddedImages = (inspected.json.images || []).filter((image) =>
    image?.bufferView !== undefined
  );
  if (!embeddedImages.length) return inspected.bytes.buffer;

  const binaryChunk = inspected.chunks.find((chunk) =>
    chunk.type === 0x004e4942
  );
  if (!binaryChunk) {
    throw new Error("The GLB declares embedded images without binary data.");
  }
  const json = structuredClone(inspected.json);
  for (const image of json.images || []) {
    if (image?.bufferView === undefined) continue;
    const bufferView = json.bufferViews?.[image.bufferView];
    if (!bufferView || (bufferView.buffer ?? 0) !== 0) {
      throw new Error("The GLB image data is not stored in its binary chunk.");
    }
    const start = binaryChunk.start + (bufferView.byteOffset || 0);
    const end = start + bufferView.byteLength;
    if (start < binaryChunk.start || end > binaryChunk.end) {
      throw new Error("The GLB contains an invalid embedded image.");
    }
    const mimeType = String(image.mimeType || "");
    if (!mimeType.startsWith("image/")) {
      throw new Error(
        "The GLB contains an embedded image without a MIME type.",
      );
    }
    image.uri = `data:${mimeType};base64,${
      bytesToBase64(inspected.bytes.subarray(start, end))
    }`;
    delete image.bufferView;
  }

  const encodedJson = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = (encodedJson.length + 3) & ~3;
  const chunks = inspected.chunks.map((chunk) =>
    chunk.type === 0x4e4f534a
      ? { bytes: encodedJson, length: jsonLength, type: chunk.type }
      : {
        bytes: inspected.bytes.subarray(chunk.start, chunk.end),
        length: chunk.length,
        type: chunk.type,
      }
  );
  const totalLength = 12 + chunks.reduce(
    (total, chunk) => total + 8 + chunk.length,
    0,
  );
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.length, true);
    view.setUint32(offset + 4, chunk.type, true);
    if (chunk.type === 0x4e4f534a) {
      output.fill(0x20, offset + 8, offset + 8 + chunk.length);
    }
    output.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.length;
  }
  return output.buffer;
}

function parseGltfWithCspSafeTextures(loader, bytes) {
  const createImageBitmap = globalThis.createImageBitmap;
  try {
    globalThis.createImageBitmap = undefined;
    return loader.parseAsync(bytes, "");
  } finally {
    globalThis.createImageBitmap = createImageBitmap;
  }
}

function disposeMaterial(material, disposedTextures) {
  for (const value of Object.values(material)) {
    if (!value?.isTexture || disposedTextures.has(value)) continue;
    disposedTextures.add(value);
    const image = value.source?.data;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      image.close();
    }
    value.dispose();
  }
  material.dispose();
}

async function responseBytes(response, opts) {
  const headerTotal = Number(response.headers.get("content-length") || 0);
  const total = Number.isFinite(headerTotal) && headerTotal > 0
    ? headerTotal
    : null;
  if (total && total > opts.maxBytes) {
    throw new Error(
      `The model is too large to open (${total} bytes; limit ${opts.maxBytes}).`,
    );
  }
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > opts.maxBytes) {
      throw new Error(
        `The model is too large to open (${buffer.byteLength} bytes; limit ${opts.maxBytes}).`,
      );
    }
    opts.onProgress(buffer.byteLength, total || buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (loaded > opts.maxBytes) {
      await reader.cancel();
      throw new Error(
        `The model is too large to open (${loaded} bytes; limit ${opts.maxBytes}).`,
      );
    }
    chunks.push(value);
    opts.onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  opts.onProgress(loaded, total || loaded);
  return bytes.buffer;
}

class GlbViewer {
  constructor(options) {
    this.handle = options.handle;
    this.elementId = options.elementId;
    this.fileUrl = String(options.fileUrl || "");
    this.fileName = String(options.fileName || "model.glb");
    this.dracoDecoderUrl = String(options.dracoDecoderUrl || "");
    this.maxBytes = Math.max(
      1,
      finiteNumber(options.maxBytes, DEFAULT_MAX_BYTES),
    );
    this.maxPixelRatio = clamp(
      finiteNumber(options.maxPixelRatio, 2),
      0.5,
      3,
    );
    this.backgroundColor = options.backgroundColor || "#e9edf2";
    this.transparent = options.transparent === true;
    this.destroyed = false;
    this.ready = false;
    this.visible = true;
    this.contextLost = false;
    this.renderRequest = null;
    this.hoverRequest = null;
    this.settleFrames = 0;
    this.loadStartedAt = 0;
    this.downloadCompletedAt = 0;
    this.parseCompletedAt = 0;
    this.firstRenderAt = 0;
    this.modelSummary = null;
    this.recommendedFitBounds = null;
    this.abortController = new AbortController();
    this.dracoLoader = null;
    this.listeners = [];
    this.nodeEntries = [];
    this.entryByKey = new Map();
    this.entriesByName = new Map();
    this.entryByObject = new Map();
    this.meshToEntry = new Map();
    this.selectedEntry = null;
    this.selectedEntries = [];
    this.selectedPayloadOverride = null;
    this.hoveredEntry = null;
    this.hiddenEntries = new Set();
    this.isolatedEntry = null;
    this.modelIndex = objectValue(options.modelIndex);
    this.cadBom = { hasMore: false, total: 0 };
    this.semanticParts = new Map();
    this.semanticAssemblies = new Map();
    this.semanticOccurrences = new Map();
    this.filterHiddenEntries = new Set();
    this.appearanceOriginals = new Map();
    this.appearanceMaterials = new Set();
    this.semanticFilter = {
      active: false,
      definitionKeys: [],
      mode: "hide",
    };
    for (const interaction of arrayValue(options.cadInteractions)) {
      this.ingestCadInteraction(interaction);
    }
    this.edgesEnabled = options.edges === true;
    this.edgeObjects = [];
    this.edgeGeometries = new Set();
    this.edgeMaterial = null;
    this.section = {
      enabled: false,
      axis: "x",
      offset: 0,
      reverse: false,
    };
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this.measurementMode = false;
    this.measurementPoints = [];
    this.measurement = null;
    this.explodeFactor = 0;
    this.explodeEntries = [];
    this.pointerDown = null;
    this.projection = options.projection === "orthographic"
      ? "orthographic"
      : "perspective";
    this.currentView = "isometric";
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.mount = document.getElementById(this.elementId);
    if (!this.mount) {
      throw new Error(`The GLB viewer mount is unavailable: ${this.elementId}`);
    }
    if (!this.fileUrl) throw new Error("A GLB file URL is required.");
    this.originalMountStyle = {
      minHeight: this.mount.style.minHeight,
      overflow: this.mount.style.overflow,
      position: this.mount.style.position,
    };
    this.buildRenderer();
  }

  buildRenderer() {
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", `3D model: ${this.fileName}`);
    Object.assign(this.canvas.style, {
      display: "block",
      height: "100%",
      outline: "none",
      touchAction: "none",
      width: "100%",
    });
    this.mount.replaceChildren(this.canvas);
    this.mount.style.minHeight = "0";
    this.mount.style.overflow = "hidden";
    if (getComputedStyle(this.mount).position === "static") {
      this.mount.style.position = "relative";
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: this.transparent,
        powerPreference: "high-performance",
      });
    } catch (error) {
      throw new Error(`WebGL could not be initialized: ${errorMessage(error)}`);
    }
    if (!this.renderer.capabilities.isWebGL2) {
      throw new Error("This viewer requires WebGL 2.");
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;
    this.renderer.setPixelRatio(
      Math.min(globalThis.devicePixelRatio || 1, this.maxPixelRatio),
    );
    if (this.transparent) {
      this.renderer.setClearColor(0x000000, 0);
    }

    this.scene = new THREE.Scene();
    if (!this.transparent) {
      this.scene.background = new THREE.Color(this.backgroundColor);
    }
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = "yolm-glb-model";
    this.scene.add(this.modelRoot);
    this.overlayRoot = new THREE.Group();
    this.overlayRoot.name = "yolm-glb-overlays";
    this.scene.add(this.overlayRoot);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.85;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x59636f, 1.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(4, 7, 5);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb9d6ff, 0.65);
    fillLight.position.set(-5, 2, -4);
    this.scene.add(fillLight);

    this.perspectiveCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 10_000);
    this.orthographicCamera = new THREE.OrthographicCamera(
      -1,
      1,
      1,
      -1,
      -10_000,
      10_000,
    );
    this.camera = this.projection === "orthographic"
      ? this.orthographicCamera
      : this.perspectiveCamera;
    this.camera.position.set(3, 2.4, 3);
    this.createControls(new THREE.Vector3());

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.selectionOutline = new OutlinePass(
      new THREE.Vector2(1, 1),
      this.scene,
      this.camera,
    );
    this.selectionOutline.edgeStrength = 4.5;
    this.selectionOutline.edgeGlow = 0.2;
    this.selectionOutline.edgeThickness = 1.25;
    this.selectionOutline.visibleEdgeColor.set(0xffa000);
    this.selectionOutline.hiddenEdgeColor.set(0x6b4500);
    this.selectionOutline.enabled = false;
    this.hoverOutline = new OutlinePass(
      new THREE.Vector2(1, 1),
      this.scene,
      this.camera,
    );
    this.hoverOutline.edgeStrength = 2;
    this.hoverOutline.edgeGlow = 0;
    this.hoverOutline.edgeThickness = 0.75;
    this.hoverOutline.visibleEdgeColor.set(0x36c5f0);
    this.hoverOutline.hiddenEdgeColor.set(0x164e63);
    this.hoverOutline.enabled = false;
    this.outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.hoverOutline);
    this.composer.addPass(this.selectionOutline);
    this.composer.addPass(this.outputPass);

    this.listen(this.canvas, "pointerdown", (event) => {
      this.pointerDown = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      this.canvas.focus({ preventScroll: true });
    });
    this.listen(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.listen(
      this.canvas,
      "pointermove",
      (event) => this.onPointerMove(event),
    );
    this.listen(this.canvas, "pointerleave", () => this.setHoveredEntry(null));
    this.listen(this.canvas, "dblclick", (event) => {
      event.preventDefault();
      if (this.selectedEntry) this.fitSelection();
      else this.fitAll();
    });
    this.listen(this.canvas, "keydown", (event) => this.onKeyDown(event));
    this.listen(this.canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      emitEvent("contextLost", this.handle, this.statePayload());
    });
    this.listen(this.canvas, "webglcontextrestored", () => {
      this.contextLost = false;
      this.requestRender(4);
      emitEvent("contextRestored", this.handle, this.statePayload());
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.visible = entries.at(-1)?.isIntersecting !== false;
        if (this.visible) this.requestRender(2);
      });
      this.intersectionObserver.observe(this.mount);
    }
    this.resize();
  }

  createControls(target) {
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.0001;
    this.controls.maxDistance = 1e12;
    this.controls.addEventListener("start", () => {
      this.settleFrames = 20;
      this.currentView = "custom";
      this.setHoveredEntry(null);
    });
    this.controls.addEventListener("change", () => this.requestRender(12));
    this.controls.addEventListener("end", () => this.requestRender(24));
    this.controls.update();
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  async initialize() {
    this.loadStartedAt = performance.now();
    try {
      await this.loadModel(this.fileUrl, this.fileName);
      if (this.destroyed) return moduleResult(this.handle, { aborted: true });
      this.ready = true;
      this.fitBounds(
        this.recommendedFitBounds ?? this.activeBounds(),
        "isometric",
      );
      if (this.edgesEnabled) this.setEdges(true, false);
      this.requestRender(4);
      emitEvent(
        "ready",
        this.handle,
        this.statePayload({
          semanticCatalog: this.semanticCatalog(),
          summary: this.sceneSummary(),
        }),
      );
      return moduleResult(this.handle, {
        success: true,
        ...this.statePayload({
          semanticCatalog: this.semanticCatalog(),
          summary: this.sceneSummary(),
        }),
      });
    } catch (error) {
      if (error?.name === "AbortError" || this.destroyed) {
        return moduleResult(this.handle, { aborted: true, success: false });
      }
      const message = errorMessage(error);
      emitEvent("error", this.handle, { message });
      return moduleResult(this.handle, { error: message, success: false });
    }
  }

  async loadModel(fileUrl, fileName) {
    this.ready = false;
    this.fileUrl = String(fileUrl);
    this.fileName = String(fileName || "model.glb");
    this.canvas.setAttribute("aria-label", `3D model: ${this.fileName}`);
    this.disposeModel();
    emitEvent("progress", this.handle, {
      fileName: this.fileName,
      loaded: 0,
      total: null,
      percent: 0,
      stage: "download",
    });
    const response = await fetch(this.fileUrl, {
      credentials: "same-origin",
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error(
        `The model could not be downloaded (${response.status}).`,
      );
    }
    const bytes = await responseBytes(response, {
      maxBytes: this.maxBytes,
      onProgress: (loaded, total) => {
        emitEvent("progress", this.handle, {
          fileName: this.fileName,
          loaded,
          total,
          percent: total ? Math.round((loaded / total) * 100) : null,
          stage: "download",
        });
      },
    });
    const inspected = inspectSelfContainedGlb(bytes);
    this.downloadCompletedAt = performance.now();
    emitEvent("progress", this.handle, {
      fileName: this.fileName,
      loaded: bytes.byteLength,
      total: bytes.byteLength,
      percent: 100,
      stage: "parse",
    });

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.startsWith("blob:") || url.startsWith("data:")) return url;
      throw new Error(
        "This GLB references an external resource. Only self-contained GLB files can be viewed.",
      );
    });
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    if (this.dracoDecoderUrl) {
      this.dracoLoader ??= new DRACOLoader();
      this.dracoLoader.setDecoderPath(
        new URL(".", new URL(this.dracoDecoderUrl, document.baseURI))
          .toString(),
      );
      loader.setDRACOLoader(this.dracoLoader);
    }
    const gltf = await parseGltfWithCspSafeTextures(
      loader,
      glbWithDataUriImages(inspected),
    );
    if (this.destroyed) return;
    if (!gltf.scene) {
      throw new Error("The GLB does not define a default scene.");
    }
    if (gltf.scene.parent) gltf.scene.parent.remove(gltf.scene);
    const recommended = gltf.parser?.json?.asset?.extras?.yolmCad
      ?.recommendedFitBounds;
    const recommendedMin = Array.isArray(recommended?.min)
      ? recommended.min.map(Number)
      : [];
    const recommendedMax = Array.isArray(recommended?.max)
      ? recommended.max.map(Number)
      : [];
    this.recommendedFitBounds = recommendedMin.length === 3 &&
        recommendedMax.length === 3 &&
        [...recommendedMin, ...recommendedMax].every(Number.isFinite) &&
        recommendedMax.some((value, index) => value > recommendedMin[index])
      ? new THREE.Box3(
        new THREE.Vector3(...recommendedMin),
        new THREE.Vector3(...recommendedMax),
      )
      : null;
    this.modelRoot.add(gltf.scene);
    this.animations = gltf.animations || [];
    this.parseCompletedAt = performance.now();
    this.prepareModel();
  }

  prepareModel() {
    this.modelRoot.updateMatrixWorld(true);
    this.modelBounds = new THREE.Box3().setFromObject(this.modelRoot);
    if (this.modelBounds.isEmpty()) {
      throw new Error("The GLB scene contains no visible geometry.");
    }
    this.modelSphere = this.modelBounds.getBoundingSphere(new THREE.Sphere());
    this.recommendedFitBounds ??= this.robustMeshBounds();
    this.buildNodeIndex();
    this.indexSemantics();
    this.buildExplodeEntries();
    this.applySemanticFilter(false);
    this.applyExplode();
    this.applySection();
    this.modelSummary = this.sceneSummary();
  }

  // Opening bounds that skip parts whose centers sit far outside the
  // interquartile spread of the rest (IFC survey markers, stray exports),
  // matching the fences yolm-fab bakes into DWG GLBs.
  robustMeshBounds() {
    const boxes = [];
    this.modelRoot.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const count = object.isInstancedMesh ? object.count : 1;
      const instanceMatrix = new THREE.Matrix4();
      for (let index = 0; index < count; index += 1) {
        const box = object.geometry.boundingBox.clone();
        if (object.isInstancedMesh) {
          object.getMatrixAt(index, instanceMatrix);
          box.applyMatrix4(instanceMatrix);
        }
        box.applyMatrix4(object.matrixWorld);
        if (!box.isEmpty()) boxes.push(box);
      }
    });
    if (boxes.length < 3) return null;
    // Weight parts by size so a cluster of tiny markers (IFC survey points,
    // origin glyphs) cannot hold the fences open, while one long real part
    // still anchors them.
    const weights = boxes.map((box) =>
      Math.max(box.getSize(new THREE.Vector3()).length(), 1e-9)
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const centers = boxes.map((box) => box.getCenter(new THREE.Vector3()));
    const quantile = (entries, fraction) => {
      let cumulative = 0;
      for (const entry of entries) {
        cumulative += entry.weight;
        if (cumulative >= totalWeight * fraction) return entry.value;
      }
      return entries.at(-1).value;
    };
    const fences = ["x", "y", "z"].map((axis) => {
      const entries = centers
        .map((center, index) => ({
          value: center[axis],
          weight: weights[index],
        }))
        .sort((a, b) => a.value - b.value);
      const lower = quantile(entries, 0.25);
      const upper = quantile(entries, 0.75);
      const padding = Math.max((upper - lower) * 3, 1e-9);
      return [axis, lower - padding, upper + padding];
    });
    const retainedIndices = boxes.map((_, index) => index).filter((index) =>
      fences.every(([axis, lower, upper]) =>
        centers[index][axis] >= lower && centers[index][axis] <= upper
      )
    );
    const retainedWeight = retainedIndices.reduce(
      (sum, index) => sum + weights[index],
      0,
    );
    if (
      retainedIndices.length === boxes.length ||
      retainedWeight < totalWeight / 2
    ) return null;
    const retained = retainedIndices.map((index) => boxes[index]);
    return retained.reduce(
      (bounds, box) => bounds.union(box),
      new THREE.Box3(),
    );
  }

  buildNodeIndex() {
    this.nodeEntries = [];
    this.entryByKey.clear();
    this.entriesByName.clear();
    this.entryByObject.clear();
    this.meshToEntry.clear();
    const namesSeen = new Map();
    let generated = 0;
    const visit = (object, parentEntry, depth) => {
      const indexable = !object.isCamera && !object.isLight;
      const meaningful = indexable && object !== this.modelRoot &&
        (object.name || object.isMesh || object.children.length > 1);
      let entry = parentEntry;
      if (meaningful) {
        const name = String(object.name || `${object.type} ${++generated}`);
        const seen = (namesSeen.get(name) || 0) + 1;
        namesSeen.set(name, seen);
        const key = seen === 1 ? name : `${name}#${seen}`;
        entry = {
          key,
          name,
          object,
          parentKey: parentEntry?.key || null,
          depth,
          kind: this.nodeKind(object, name),
          meshCount: 0,
          triangleCount: 0,
        };
        this.nodeEntries.push(entry);
        this.entryByKey.set(key, entry);
        this.entryByObject.set(object, entry);
        const sameName = this.entriesByName.get(name) || [];
        sameName.push(entry);
        this.entriesByName.set(name, sameName);
      }
      for (const child of object.children) {
        visit(child, entry, meaningful ? depth + 1 : depth);
      }
    };
    visit(this.modelRoot, null, 0);

    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      let current = object;
      let entry = null;
      while (current && current !== this.modelRoot) {
        entry = this.entryByObject.get(current);
        if (entry) break;
        current = current.parent;
      }
      if (!entry) return;
      this.meshToEntry.set(object, entry);
      entry.meshCount += 1;
      entry.triangleCount += this.objectTriangles(object);
    });
  }

  nodeKind(object, name) {
    const cadKind = String(cadIdentity(object).kind || "");
    if (cadKind) return cadKind;
    if (name.startsWith("occurrence-")) return "occurrence";
    if (name.startsWith("assembly-")) return "assembly";
    if (name.startsWith("part-")) return "part";
    if (object.isMesh) return "mesh";
    return "group";
  }

  indexSemantics() {
    this.semanticParts.clear();
    this.semanticAssemblies.clear();
    this.semanticOccurrences.clear();
    const index = this.modelIndex;

    for (const part of Array.isArray(index?.parts) ? index.parts : []) {
      const key = String(part?.key || part?.id || "");
      if (key) this.semanticParts.set(key, part);
    }
    for (
      const assembly of Array.isArray(index?.assemblies) ? index.assemblies : []
    ) {
      const key = String(assembly?.key || assembly?.id || "");
      if (key) this.semanticAssemblies.set(key, assembly);
      for (
        const occurrence of Array.isArray(assembly?.children)
          ? assembly.children
          : []
      ) {
        const occurrenceKey = String(
          occurrence?.key || occurrence?.occurrenceId || "",
        );
        if (occurrenceKey) {
          this.semanticOccurrences.set(occurrenceKey, {
            ...occurrence,
            parentAssemblyKey: key || null,
          });
        }
      }
    }
    for (
      const occurrence of Array.isArray(index?.occurrences)
        ? index.occurrences
        : []
    ) {
      const key = String(occurrence?.key || occurrence?.occurrenceId || "");
      if (key) this.semanticOccurrences.set(key, occurrence);
    }

    const mappings = objectValue(index?.nodeMappings) || {};
    for (const entry of this.nodeEntries) {
      const mapping = objectValue(mappings[entry.name]) || {};
      const identity = cadIdentity(entry.object);
      const identityKind = String(identity.kind || "");
      const identityObjectKey = String(identity.objectKey || "");
      const occurrenceKey = String(
        identity.occurrenceKey ||
          (identityKind === "occurrence" ? identityObjectKey : "") ||
          mapping.occurrenceKey ||
          (this.semanticOccurrences.has(entry.name) ? entry.name : ""),
      );
      const occurrence = this.semanticOccurrences.get(occurrenceKey);
      const definitionKey = String(
        identity.definitionKey ||
          (identityKind === "part" ? identityObjectKey : "") ||
          mapping.definitionKey || occurrence?.definitionKey ||
          occurrence?.objectId ||
          (this.semanticParts.has(entry.name) ? entry.name : ""),
      );
      const assemblyKey = String(
        identity.assemblyKey ||
          (identityKind === "assembly" ? identityObjectKey : "") ||
          mapping.assemblyKey ||
          (this.semanticAssemblies.has(entry.name) ? entry.name : ""),
      );
      const part = this.semanticParts.get(definitionKey);
      const assembly = this.semanticAssemblies.get(assemblyKey);
      entry.semantic = part
        ? this.partSemantic(part, definitionKey, occurrenceKey, occurrence)
        : assembly
        ? {
          assemblyKey,
          classification: "assembly",
          definitionKey: assemblyKey,
          displayName: String(assembly.name || assemblyKey),
          objectKey: identityObjectKey || assemblyKey,
          occurrenceKey: null,
        }
        : definitionKey || identityObjectKey
        ? {
          assemblyKey: assemblyKey || null,
          classification: String(identity.classification || "unclassified"),
          definitionKey: definitionKey || identityObjectKey,
          displayName: String(identity.displayName || entry.name),
          objectKey: identityObjectKey || occurrenceKey || definitionKey,
          occurrenceKey: occurrenceKey || null,
        }
        : null;
    }
  }

  ensureModelIndex() {
    if (!this.modelIndex) this.modelIndex = {};
    for (const field of ["parts", "assemblies", "occurrences"]) {
      if (!Array.isArray(this.modelIndex[field])) this.modelIndex[field] = [];
    }
    return this.modelIndex;
  }

  upsertCadObject(field, value, key) {
    key = String(key || value?.key || value?.objectKey || "");
    if (!key) return;
    const index = this.ensureModelIndex();
    const normalized = { ...value, key };
    const existing = index[field].findIndex((item) =>
      String(item?.key || item?.objectKey || "") === key
    );
    if (existing === -1) index[field].push(normalized);
    else index[field][existing] = { ...index[field][existing], ...normalized };
  }

  ingestCadInteraction(value) {
    const interaction = objectValue(value);
    if (!interaction) throw new Error("CAD interaction must be an object.");
    const action = objectValue(interaction.action) || {};
    const type = String(
      action.type || interaction.actionType || interaction.type || "",
    );
    const envelope = objectValue(interaction.response) || interaction;
    const result = objectValue(envelope.result) ||
      objectValue(interaction.result) || {};
    const index = this.ensureModelIndex();
    const cadModelVersion = envelope.cadModelVersion ??
      result.cadModelVersion ??
      result.modelVersion;
    if (cadModelVersion !== undefined) index.modelVersion = cadModelVersion;

    if (type === "get_summary") {
      const document = objectValue(result.document) || {};
      index.units = objectValue(result.units) || objectValue(document.units) ||
        index.units;
      index.summary = objectValue(result.summary) || index.summary;
      index.rootDefinitionKeys = Array.isArray(result.rootDefinitionKeys)
        ? result.rootDefinitionKeys
        : Array.isArray(result.rootObjectKeys)
        ? result.rootObjectKeys
        : Array.isArray(document.rootDefinitionKeys)
        ? document.rootDefinitionKeys
        : index.rootDefinitionKeys;
      return;
    }

    if (type === "list_bom") {
      const items = Array.isArray(result.items) ? result.items : [];
      const offset = finiteNumber(
        result.offset,
        finiteNumber(action.offset, 0),
      );
      if (offset === 0) index.parts = [];
      for (const item of items) {
        const key = item?.objectKey || item?.partKey || item?.key;
        this.upsertCadObject("parts", {
          ...item,
          occurrenceCount: finiteNumber(item?.quantity, item?.occurrenceCount),
        }, key);
      }
      this.cadBom = {
        hasMore: result.hasMore === true,
        total: Math.max(items.length, finiteNumber(result.total, items.length)),
      };
      return;
    }

    if (type === "list_children") {
      const children = Array.isArray(result.items)
        ? result.items
        : Array.isArray(result.children)
        ? result.children
        : [];
      const parentKey = String(
        result.objectKey || result.parentKey || action.objectKey ||
          action.key || "",
      );
      if (parentKey) {
        const offset = finiteNumber(
          result.offset,
          finiteNumber(action.offset, 0),
        );
        const existing = index.assemblies.find((item) =>
          String(item?.key || item?.objectKey || "") === parentKey
        );
        const priorChildren = offset > 0 && Array.isArray(existing?.children)
          ? existing.children
          : [];
        this.upsertCadObject("assemblies", {
          name: result.name || parentKey,
          children: [
            ...priorChildren,
            ...children.map((child) => ({
              ...child,
              key: child.occurrenceKey || child.objectKey || child.key,
            })),
          ],
        }, parentKey);
      }
      return;
    }

    if (type === "get_object") {
      const item = objectValue(result.object) || objectValue(result.item) ||
        result;
      const key = item.objectKey || item.key || action.objectKey || action.key;
      const kind = String(item.kind || item.objectKind || "part");
      const field = kind === "assembly"
        ? "assemblies"
        : kind === "occurrence"
        ? "occurrences"
        : "parts";
      this.upsertCadObject(field, item, key);
      return;
    }

    if (type === "list_occurrences") {
      const items = Array.isArray(result.items)
        ? result.items
        : Array.isArray(result.occurrences)
        ? result.occurrences
        : [];
      const definitionKey = String(
        result.definitionKey || action.definitionKey || action.objectKey ||
          action.key || "",
      );
      const offset = finiteNumber(
        result.offset,
        finiteNumber(action.offset, 0),
      );
      if (offset === 0 && definitionKey) {
        index.occurrences = index.occurrences.filter((item) =>
          String(item?.definitionKey || item?.objectId || "") !== definitionKey
        );
      }
      for (const item of items) {
        this.upsertCadObject("occurrences", {
          ...item,
          definitionKey: item.definitionKey || definitionKey,
        }, item.occurrenceKey || item.objectKey || item.key);
      }
    }
  }

  partSemantic(part, definitionKey, occurrenceKey, occurrence) {
    const interpretation = objectValue(
      part.interpretation || part.geometryInterpretation,
    );
    const catalog = Array.isArray(part.catalogMatches)
      ? part.catalogMatches[0]
      : null;
    const plate = objectValue(part.plateMatch);
    const material = objectValue(part.materialMatch);
    const features = objectValue(part.geometryFeatures);
    const units = objectValue(this.modelIndex?.units);
    const holes = Array.isArray(features?.holes) ? features.holes : [];
    const bevels = Array.isArray(features?.bevelCandidates)
      ? features.bevelCandidates
      : [];
    const classification = String(interpretation?.kind || "unclassified");
    return {
      bodyCount: Array.isArray(part.bodyKeys) ? part.bodyKeys.length : 0,
      classification,
      confidence: finiteNumber(
        classification === "plate" ? plate?.confidence : catalog?.confidence,
        null,
      ),
      definitionKey,
      depth: finiteNumber(interpretation?.depth, null),
      designation: String(
        (classification === "plate"
          ? plate?.designation
          : catalog?.designation) ||
          "",
      ) || null,
      displayName: String(part.name || definitionKey),
      holeCount: holes.length,
      bevelCount: bevels.length,
      length: finiteNumber(interpretation?.length, null),
      materialDesignation: String(material?.designation || "") || null,
      objectKey: occurrenceKey || definitionKey,
      occurrenceKey: occurrenceKey || null,
      parentAssemblyKey: occurrence?.parentAssemblyKey || null,
      scaleToMeters: finiteNumber(units?.scaleToMeters, 1),
      shapeType: String(catalog?.shapeType || catalog?.type || "") || null,
      sourceUnit: String(units?.name || units?.length || "source unit"),
      thickness: finiteNumber(interpretation?.thickness, null),
      width: finiteNumber(interpretation?.width, null),
    };
  }

  semanticCatalog() {
    const occurrenceCounts = new Map();
    for (const occurrence of this.semanticOccurrences.values()) {
      const definitionKey = String(
        occurrence?.definitionKey || occurrence?.objectId || "",
      );
      if (definitionKey) {
        occurrenceCounts.set(
          definitionKey,
          (occurrenceCounts.get(definitionKey) || 0) + 1,
        );
      }
    }
    return [...this.semanticParts.entries()].map(([definitionKey, part]) => ({
      ...this.partSemantic(part, definitionKey, null, null),
      occurrenceCount: occurrenceCounts.get(definitionKey) ||
        finiteNumber(part.occurrenceCount, 0),
    })).sort((left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      left.definitionKey.localeCompare(right.definitionKey)
    );
  }

  geometryTriangles(geometry) {
    if (!geometry) return 0;
    return geometry.index
      ? Math.floor(geometry.index.count / 3)
      : Math.floor((geometry.attributes.position?.count || 0) / 3);
  }

  objectTriangles(object) {
    return this.geometryTriangles(object?.geometry) *
      (object?.isInstancedMesh ? object.count : 1);
  }

  buildExplodeEntries() {
    const byObject = new Map();
    for (const [mesh, entry] of this.meshToEntry) {
      if (!byObject.has(entry.object)) byObject.set(entry.object, entry);
      if (!entry.object.userData.yolmMeshes) {
        entry.object.userData.yolmMeshes = [];
      }
      entry.object.userData.yolmMeshes.push(mesh);
    }
    this.modelRoot.updateMatrixWorld(true);
    this.explodeEntries = [...byObject.values()].map((entry) => {
      const bounds = new THREE.Box3();
      for (const mesh of entry.object.userData.yolmMeshes || []) {
        bounds.expandByObject(mesh);
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const direction = center.clone().sub(this.modelSphere.center);
      if (direction.lengthSq() < 1e-12) direction.set(1, 0, 0);
      direction.normalize().multiplyScalar(this.modelSphere.radius * 0.4);
      const parent = entry.object.parent;
      const parentOrigin = new THREE.Vector3();
      const parentOffset = new THREE.Vector3();
      if (parent) {
        parent.updateMatrixWorld(true);
        parentOrigin.copy(center);
        parentOffset.copy(center).add(direction);
        parent.worldToLocal(parentOrigin);
        parent.worldToLocal(parentOffset);
        direction.copy(parentOffset.sub(parentOrigin));
      }
      return {
        entry,
        originalPosition: entry.object.position.clone(),
        localOffset: direction,
      };
    });
  }

  sceneSummary() {
    let instanceCount = 0;
    let meshCount = 0;
    let triangleCount = 0;
    let materialCount = 0;
    const materials = new Set();
    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      meshCount += 1;
      instanceCount += object.isInstancedMesh ? object.count : 1;
      triangleCount += this.objectTriangles(object);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });
    materialCount = materials.size;
    const size = this.modelBounds.getSize(new THREE.Vector3());
    return {
      animationCount: this.animations?.length || 0,
      instanceCount,
      materialCount,
      meshCount,
      nodeCount: this.nodeEntries.length,
      triangleCount,
      bounds: {
        min: this.modelBounds.min.toArray(),
        max: this.modelBounds.max.toArray(),
        size: size.toArray(),
      },
    };
  }

  resize() {
    if (this.destroyed || !this.renderer) return;
    const width = Math.max(1, Math.floor(this.mount.clientWidth));
    const height = Math.max(1, Math.floor(this.mount.clientHeight));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthographicFrustum();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.selectionOutline.setSize(width, height);
    this.hoverOutline.setSize(width, height);
    this.requestRender(2);
  }

  updateOrthographicFrustum(halfHeight = this.orthographicHalfHeight || 1) {
    this.orthographicHalfHeight = Math.max(1e-9, halfHeight);
    const aspect = (this.width || 1) / (this.height || 1);
    this.orthographicCamera.left = -this.orthographicHalfHeight * aspect;
    this.orthographicCamera.right = this.orthographicHalfHeight * aspect;
    this.orthographicCamera.top = this.orthographicHalfHeight;
    this.orthographicCamera.bottom = -this.orthographicHalfHeight;
    this.orthographicCamera.updateProjectionMatrix();
  }

  requestRender(settleFrames = 0) {
    if (this.destroyed || this.contextLost) return;
    this.settleFrames = Math.max(this.settleFrames, settleFrames);
    if (this.renderRequest !== null) return;
    this.renderRequest = requestAnimationFrame(() => this.renderFrame());
  }

  renderFrame() {
    this.renderRequest = null;
    if (this.destroyed || this.contextLost || !this.visible) return;
    const changed = this.controls?.update() === true;
    this.composer.render();
    if (!this.firstRenderAt && this.ready) {
      this.firstRenderAt = performance.now();
    }
    if (this.settleFrames > 0) this.settleFrames -= 1;
    if (changed || this.settleFrames > 0) this.requestRender();
  }

  activeBounds(entry = null) {
    this.modelRoot.updateMatrixWorld(true);
    const bounds = entry
      ? new THREE.Box3().setFromObject(entry.object)
      : new THREE.Box3().setFromObject(this.modelRoot);
    return bounds.isEmpty() ? this.modelBounds.clone() : bounds;
  }

  fitAll(view = null) {
    if (!this.modelBounds) return;
    this.fitBounds(this.activeBounds(), view);
  }

  fitVisible() {
    const bounds = new THREE.Box3();
    this.modelRoot.updateMatrixWorld(true);
    this.modelRoot.traverse((object) => {
      if (!object.isMesh) return;
      let current = object;
      while (current && current !== this.modelRoot) {
        if (!current.visible) return;
        current = current.parent;
      }
      bounds.expandByObject(object);
    });
    this.fitBounds(bounds.isEmpty() ? this.activeBounds() : bounds);
  }

  fitEntry(entry) {
    this.fitBounds(this.activeBounds(entry));
  }

  selectionMeshes(includeHidden = false) {
    const meshes = new Set();
    for (const entry of this.selectedEntries) {
      for (const mesh of this.entryMeshes(entry, includeHidden)) {
        meshes.add(mesh);
      }
    }
    return [...meshes];
  }

  selectionBounds() {
    const bounds = new THREE.Box3();
    this.modelRoot.updateMatrixWorld(true);
    for (const mesh of this.selectionMeshes(true)) bounds.expandByObject(mesh);
    return bounds.isEmpty() ? this.activeBounds(this.selectedEntry) : bounds;
  }

  fitSelection() {
    if (this.selectedEntry) this.fitBounds(this.selectionBounds());
    else this.fitAll();
  }

  fitBounds(bounds, view = null) {
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1e-6);
    let direction;
    if (view && VIEW_DIRECTIONS[view]) {
      direction = VIEW_DIRECTIONS[view].clone().normalize();
      this.currentView = view;
    } else {
      direction = this.camera.position.clone().sub(this.controls.target);
      if (direction.lengthSq() < 1e-12) direction.set(1, 0.8, 1);
      direction.normalize();
    }
    const verticalFov = THREE.MathUtils.degToRad(this.perspectiveCamera.fov);
    const horizontalFov = 2 * Math.atan(
      Math.tan(verticalFov / 2) * this.perspectiveCamera.aspect,
    );
    const limitingFov = Math.max(
      0.01,
      Math.min(verticalFov, horizontalFov || verticalFov),
    );
    const distance = radius / Math.sin(limitingFov / 2) * 1.12;
    this.camera.position.copy(sphere.center).addScaledVector(
      direction,
      distance,
    );
    this.camera.up.set(0, 1, 0);
    if (Math.abs(direction.y) > 0.999) this.camera.up.set(0, 0, -1);
    this.controls.target.copy(sphere.center);
    this.perspectiveCamera.near = Math.max(distance / 10_000, radius / 100_000);
    this.perspectiveCamera.far = Math.max(distance * 100, radius * 1_000);
    this.perspectiveCamera.zoom = 1;
    this.perspectiveCamera.updateProjectionMatrix();
    this.orthographicCamera.near = Math.max(
      distance / 10_000,
      radius / 100_000,
    );
    this.orthographicCamera.far = Math.max(distance * 100, radius * 1_000);
    this.orthographicCamera.zoom = 1;
    this.updateOrthographicFrustum(radius * 1.12);
    this.orthographicCamera.position.copy(this.camera.position);
    this.orthographicCamera.up.copy(this.camera.up);
    this.orthographicCamera.lookAt(sphere.center);
    this.camera.lookAt(sphere.center);
    this.controls.update();
    this.requestRender(20);
    this.emitStateChanged();
  }

  setView(view) {
    if (!VIEW_DIRECTIONS[view]) {
      throw new Error(`Unknown model view: ${view}`);
    }
    this.fitBounds(
      this.selectedEntry
        ? this.selectionBounds()
        : this.recommendedFitBounds ?? this.activeBounds(),
      view,
    );
  }

  setProjection(projection) {
    if (projection !== "perspective" && projection !== "orthographic") {
      throw new Error(`Unknown camera projection: ${projection}`);
    }
    if (projection === this.projection) return;
    const target = this.controls.target.clone();
    const source = this.camera;
    const destination = projection === "orthographic"
      ? this.orthographicCamera
      : this.perspectiveCamera;
    destination.position.copy(source.position);
    destination.quaternion.copy(source.quaternion);
    destination.up.copy(source.up);
    this.projection = projection;
    this.camera = destination;
    this.renderPass.camera = destination;
    this.selectionOutline.renderCamera = destination;
    this.hoverOutline.renderCamera = destination;
    this.createControls(target);
    this.requestRender(6);
    this.emitStateChanged();
  }

  entryMeshes(entry, includeHidden = false) {
    const meshes = [];
    entry?.object.traverse((object) => {
      if (object.isMesh && (includeHidden || object.visible)) {
        meshes.push(object);
      }
    });
    return meshes;
  }

  pick(clientX, clientY) {
    if (!this.ready) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.modelRoot, true);
    for (const hit of hits) {
      if (!hit.object.isMesh || !hit.object.visible) continue;
      const entry = this.meshToEntry.get(hit.object);
      if (entry) return { entry, hit };
    }
    return null;
  }

  onPointerUp(event) {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
      return;
    }
    const picked = this.pick(event.clientX, event.clientY);
    if (this.measurementMode) {
      if (picked?.hit?.point) this.addMeasurementPoint(picked.hit.point);
      return;
    }
    this.setSelectedEntry(picked?.entry || null);
  }

  onPointerMove(event) {
    if (event.buttons || this.measurementMode || this.hoverRequest !== null) {
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    this.hoverRequest = requestAnimationFrame(() => {
      this.hoverRequest = null;
      this.setHoveredEntry(this.pick(x, y)?.entry || null);
    });
  }

  onKeyDown(event) {
    if (event.key === "Escape") {
      if (this.measurementMode && this.measurementPoints.length) {
        this.clearMeasurements();
      } else {
        this.setSelectedEntry(null);
      }
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (this.selectedEntry) this.fitSelection();
      else this.fitAll();
    } else if (event.key.toLowerCase() === "h" && this.selectedEntry) {
      event.preventDefault();
      this.hideSelection();
    } else if (event.key.toLowerCase() === "i" && this.selectedEntry) {
      event.preventDefault();
      this.isolateSelection();
    } else if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.showAll();
    }
  }

  resolveEntry(identifier) {
    if (!identifier) return null;
    return this.entryByKey.get(String(identifier)) ||
      this.entriesByName.get(String(identifier))?.[0] || null;
  }

  setSelectedEntry(entry) {
    this.setSelectedEntries(entry ? [entry] : []);
  }

  setSelectedEntries(entries, payloadOverride = null) {
    this.selectedEntries = [...new Set(entries)];
    this.selectedEntry = this.selectedEntries[0] || null;
    this.selectedPayloadOverride = payloadOverride;
    this.selectionOutline.selectedObjects = this.selectionMeshes();
    this.selectionOutline.enabled =
      this.selectionOutline.selectedObjects.length > 0;
    if (this.selectedEntries.includes(this.hoveredEntry)) {
      this.setHoveredEntry(null);
    }
    this.requestRender(3);
    emitEvent("selectionChanged", this.handle, {
      selected: this.selectedPayload(),
    });
    this.emitStateChanged();
  }

  selectedPayload() {
    return this.selectedPayloadOverride ||
      this.entryPayload(this.selectedEntry);
  }

  definitionEntries(definitionKey) {
    const candidates = this.nodeEntries.filter((entry) =>
      entry.semantic?.definitionKey === definitionKey && entry.meshCount > 0
    );
    const occurrences = candidates.filter((entry) =>
      entry.semantic?.occurrenceKey
    );
    return occurrences.length ? occurrences : candidates;
  }

  definitionPayload(definitionKey, entries) {
    const representative =
      entries.find((entry) => this.entryIsVisible(entry)) ||
      entries[0];
    const part = this.semanticParts.get(definitionKey);
    const semantic = part
      ? {
        ...this.partSemantic(part, definitionKey, null, null),
        occurrenceCount: entries.length,
      }
      : {
        ...representative.semantic,
        definitionKey,
        displayName: definitionKey,
        objectKey: definitionKey,
        occurrenceKey: null,
        occurrenceCount: entries.length,
      };
    const meshes = new Set();
    let triangleCount = 0;
    for (const entry of entries) {
      for (const mesh of this.entryMeshes(entry, true)) {
        if (meshes.has(mesh)) continue;
        meshes.add(mesh);
        triangleCount += this.objectTriangles(mesh);
      }
    }
    const bounds = new THREE.Box3();
    for (const mesh of meshes) bounds.expandByObject(mesh);
    return {
      key: definitionKey,
      name: semantic.displayName || representative.name || definitionKey,
      kind: "definition",
      parentKey: null,
      meshCount: meshes.size,
      triangleCount,
      visible: entries.some((entry) => this.entryIsVisible(entry)),
      semantic,
      bounds: {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        size: bounds.getSize(new THREE.Vector3()).toArray(),
      },
    };
  }

  selectDefinitionEntries(definitionKey, fit = false) {
    const entries = this.definitionEntries(definitionKey);
    if (!entries.length) {
      throw new Error(`Model definition not found: ${definitionKey}`);
    }
    this.setSelectedEntries(
      entries,
      this.definitionPayload(definitionKey, entries),
    );
    if (fit) this.fitSelection();
  }

  setHoveredEntry(entry) {
    if (this.selectedEntries.includes(entry)) entry = null;
    if (entry === this.hoveredEntry) return;
    this.hoveredEntry = entry;
    this.hoverOutline.selectedObjects = this.entryMeshes(entry);
    this.hoverOutline.enabled = this.hoverOutline.selectedObjects.length > 0;
    this.requestRender(2);
    emitEvent("hoverChanged", this.handle, {
      hovered: this.entryPayload(entry),
    });
  }

  entryPayload(entry) {
    if (!entry) return null;
    const bounds = this.activeBounds(entry);
    return {
      key: entry.key,
      name: entry.name,
      kind: entry.kind,
      parentKey: entry.parentKey,
      meshCount: entry.meshCount,
      triangleCount: entry.triangleCount,
      visible: this.entryIsVisible(entry),
      semantic: entry.semantic,
      bounds: {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        size: bounds.getSize(new THREE.Vector3()).toArray(),
      },
    };
  }

  selectNode(identifier) {
    const entry = this.resolveEntry(identifier);
    if (!entry) throw new Error(`Model node not found: ${identifier}`);
    this.setSelectedEntry(entry);
  }

  selectDefinition(definitionKey) {
    definitionKey = String(definitionKey || "");
    this.selectDefinitionEntries(definitionKey);
  }

  focusObject(objectKey) {
    objectKey = String(objectKey || "");
    if (this.definitionEntries(objectKey).length) {
      this.selectDefinitionEntries(objectKey, true);
      return;
    }
    const candidates = this.nodeEntries.filter((entry) =>
      entry.meshCount > 0 &&
      (entry.semantic?.objectKey === objectKey ||
        entry.semantic?.occurrenceKey === objectKey)
    );
    const entry =
      candidates.find((candidate) => this.entryIsVisible(candidate)) ||
      candidates[0] || this.resolveEntry(objectKey);
    if (!entry) throw new Error(`Model object not found: ${objectKey}`);
    this.setSelectedEntry(entry);
    this.fitEntry(entry);
  }

  entryIsVisible(entry) {
    let object = entry?.object;
    while (object && object !== this.modelRoot) {
      if (!object.visible) return false;
      object = object.parent;
    }
    return true;
  }

  setEntryVisibility(entry, visible) {
    if (!entry) return;
    entry.object.visible = visible;
    if (visible) this.hiddenEntries.delete(entry);
    else this.hiddenEntries.add(entry);
  }

  entriesForKeys(keys, definitionKeys) {
    const entries = new Set();
    for (const key of stringArray(keys, "keys")) {
      const entry = this.resolveEntry(key);
      if (entry) entries.add(entry);
    }
    const definitions = new Set(
      stringArray(definitionKeys, "definitionKeys"),
    );
    if (definitions.size) {
      for (const entry of this.nodeEntries) {
        if (definitions.has(entry.semantic?.definitionKey)) entries.add(entry);
      }
    }
    return entries;
  }

  setVisibility(options) {
    const visible = options.visible !== false;
    for (
      const entry of this.entriesForKeys(
        options.keys,
        options.definitionKeys,
      )
    ) {
      this.setEntryVisibility(entry, visible);
    }
    this.isolatedEntry = null;
    this.applySemanticFilter(false);
    this.requestRender(3);
    emitEvent("visibilityChanged", this.handle, this.visibilityPayload());
    this.emitStateChanged();
  }

  hideSelection() {
    if (!this.selectedEntry) return;
    for (const selected of this.selectedEntries) {
      this.setEntryVisibility(selected, false);
    }
    this.setSelectedEntry(null);
    this.isolatedEntry = null;
    this.requestRender(3);
    emitEvent("visibilityChanged", this.handle, this.visibilityPayload());
    this.emitStateChanged();
  }

  isolateSelection() {
    if (!this.selectedEntry) return;
    const selectedMeshes = new Set(this.selectionMeshes(true));
    this.modelRoot.traverse((object) => {
      object.visible = !object.isMesh || selectedMeshes.has(object);
    });
    this.isolatedEntry = this.selectedEntry;
    this.hiddenEntries.clear();
    this.requestRender(3);
    emitEvent("visibilityChanged", this.handle, this.visibilityPayload());
    this.emitStateChanged();
  }

  showAll() {
    this.clearSemanticFilter(false);
    this.modelRoot.traverse((object) => {
      object.visible = true;
    });
    this.hiddenEntries.clear();
    this.isolatedEntry = null;
    this.selectionOutline.selectedObjects = this.selectionMeshes();
    this.requestRender(3);
    emitEvent("visibilityChanged", this.handle, this.visibilityPayload());
    this.emitStateChanged();
  }

  visibilityPayload() {
    const hidden = new Set([
      ...this.hiddenEntries,
      ...this.filterHiddenEntries,
    ]);
    return {
      hiddenCount: hidden.size,
      isolated: this.entryPayload(this.isolatedEntry),
      filter: {
        active: this.semanticFilter.active,
        definitionCount: this.semanticFilter.definitionKeys.length,
        hiddenNodeCount: this.filterHiddenEntries.size,
        mode: this.semanticFilter.mode,
      },
    };
  }

  clearAppearance() {
    for (const [mesh, original] of this.appearanceOriginals) {
      mesh.material = original;
    }
    this.appearanceOriginals.clear();
    for (const material of this.appearanceMaterials) material.dispose();
    this.appearanceMaterials.clear();
  }

  styleMeshes(entries, style) {
    const meshes = new Set();
    for (const entry of entries) {
      for (const mesh of this.entryMeshes(entry, true)) meshes.add(mesh);
    }
    for (const mesh of meshes) {
      if (!this.appearanceOriginals.has(mesh)) {
        this.appearanceOriginals.set(mesh, mesh.material);
        const originals = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        const clones = originals.map((material) => {
          const clone = material.clone();
          this.appearanceMaterials.add(clone);
          return clone;
        });
        mesh.material = Array.isArray(mesh.material) ? clones : clones[0];
      }
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (style.color && material.color) material.color.set(style.color);
        if (style.opacity !== undefined) {
          material.opacity = clamp(finiteNumber(style.opacity, 1), 0.02, 1);
          material.transparent = material.opacity < 1;
          material.depthWrite = material.opacity >= 0.5;
        }
        material.needsUpdate = true;
      }
    }
  }

  setAppearance(options) {
    this.clearAppearance();
    for (const style of Array.isArray(options.styles) ? options.styles : []) {
      this.styleMeshes(
        this.entriesForKeys(style.keys, style.definitionKeys),
        style,
      );
    }
    this.requestRender(3);
    this.emitStateChanged();
  }

  setSemanticFilter(options, emitChange = true) {
    const definitionKeys = stringArray(
      options.definitionKeys,
      "definitionKeys",
    );
    const mode = options.mode === "ghost" ? "ghost" : "hide";
    this.semanticFilter = {
      active: options.active !== false,
      definitionKeys,
      mode,
    };
    this.applySemanticFilter(emitChange);
  }

  applySemanticFilter(emitChange = true) {
    for (const entry of this.filterHiddenEntries) {
      if (!this.hiddenEntries.has(entry)) entry.object.visible = true;
    }
    this.filterHiddenEntries.clear();
    this.clearAppearance();
    if (this.semanticFilter.active) {
      const matched = new Set(this.semanticFilter.definitionKeys);
      const unmatched = this.nodeEntries.filter((entry) =>
        entry.semantic?.definitionKey &&
        entry.semantic.classification !== "assembly" &&
        (entry.semantic.occurrenceKey ||
          entry.name === entry.semantic.definitionKey) &&
        !matched.has(entry.semantic.definitionKey)
      );
      if (this.semanticFilter.mode === "ghost") {
        this.styleMeshes(unmatched, { opacity: 0.12 });
      } else {
        for (const entry of unmatched) {
          entry.object.visible = false;
          this.filterHiddenEntries.add(entry);
        }
      }
    }
    if (
      this.selectedEntry &&
      !this.selectedEntries.some((entry) => this.entryIsVisible(entry))
    ) {
      this.setSelectedEntry(null);
    }
    this.requestRender(3);
    if (emitChange) {
      emitEvent("visibilityChanged", this.handle, this.visibilityPayload());
      this.emitStateChanged();
    }
  }

  clearSemanticFilter(emitChange = true) {
    this.semanticFilter = {
      active: false,
      definitionKeys: [],
      mode: "hide",
    };
    this.applySemanticFilter(emitChange);
  }

  setModelIndex(modelIndex, emitChange = true) {
    this.modelIndex = objectValue(modelIndex);
    this.cadBom = {
      hasMore: false,
      total: Array.isArray(this.modelIndex?.parts)
        ? this.modelIndex.parts.length
        : 0,
    };
    this.semanticFilter = {
      active: false,
      definitionKeys: [],
      mode: "hide",
    };
    this.indexSemantics();
    this.applySemanticFilter(false);
    if (emitChange) {
      emitEvent("semanticsChanged", this.handle, {
        assemblyCount: this.semanticAssemblies.size,
        catalogHasMore: this.cadBom.hasMore,
        catalogTotal: Math.max(this.cadBom.total, this.semanticParts.size),
        semanticCatalog: this.semanticCatalog(),
        occurrenceCount: this.semanticOccurrences.size,
        partCount: this.semanticParts.size,
      });
      this.emitStateChanged();
    }
  }

  applyCadInteraction(interaction, emitChange = true) {
    this.ingestCadInteraction(interaction);
    this.indexSemantics();
    this.applySemanticFilter(false);
    if (emitChange) {
      emitEvent("semanticsChanged", this.handle, {
        assemblyCount: this.semanticAssemblies.size,
        catalogHasMore: this.cadBom.hasMore,
        catalogTotal: Math.max(this.cadBom.total, this.semanticParts.size),
        semanticCatalog: this.semanticCatalog(),
        occurrenceCount: this.semanticOccurrences.size,
        partCount: this.semanticParts.size,
      });
      this.emitStateChanged();
    }
  }

  setCadInteractions(interactions, emitChange = true) {
    for (const interaction of arrayValue(interactions)) {
      this.ingestCadInteraction(interaction);
    }
    this.indexSemantics();
    this.applySemanticFilter(false);
    if (emitChange) {
      emitEvent("semanticsChanged", this.handle, {
        assemblyCount: this.semanticAssemblies.size,
        catalogHasMore: this.cadBom.hasMore,
        catalogTotal: Math.max(this.cadBom.total, this.semanticParts.size),
        semanticCatalog: this.semanticCatalog(),
        occurrenceCount: this.semanticOccurrences.size,
        partCount: this.semanticParts.size,
      });
      this.emitStateChanged();
    }
  }

  setEdges(enabled, emitState = true) {
    enabled = Boolean(enabled);
    if (
      enabled === this.edgesEnabled &&
      (enabled ? this.edgeObjects.length : true)
    ) {
      return;
    }
    this.disposeEdges();
    this.edgesEnabled = enabled;
    if (enabled) {
      this.edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x263442,
        opacity: 0.42,
        transparent: true,
        toneMapped: false,
      });
      this.edgeMaterial.clippingPlanes = this.section.enabled
        ? [this.sectionPlane]
        : [];
      const cache = new Map();
      this.modelRoot.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        let geometry = cache.get(object.geometry);
        if (!geometry) {
          geometry = new THREE.EdgesGeometry(object.geometry, 32);
          cache.set(object.geometry, geometry);
          this.edgeGeometries.add(geometry);
        }
        const instanceCount = object.isInstancedMesh ? object.count : 1;
        const instanceMatrix = new THREE.Matrix4();
        for (let index = 0; index < instanceCount; index++) {
          const edges = new THREE.LineSegments(geometry, this.edgeMaterial);
          edges.name = "yolm-glb-edges";
          edges.raycast = () => {};
          if (object.isInstancedMesh) {
            object.getMatrixAt(index, instanceMatrix);
            edges.applyMatrix4(instanceMatrix);
          }
          object.add(edges);
          this.edgeObjects.push(edges);
        }
      });
    }
    this.requestRender(3);
    if (emitState) this.emitStateChanged();
  }

  disposeEdges() {
    for (const edges of this.edgeObjects) edges.removeFromParent();
    this.edgeObjects = [];
    for (const geometry of this.edgeGeometries) geometry.dispose();
    this.edgeGeometries.clear();
    this.edgeMaterial?.dispose();
    this.edgeMaterial = null;
  }

  setSection(options) {
    const axis = ["x", "y", "z"].includes(options.axis)
      ? options.axis
      : this.section.axis;
    this.section = {
      enabled: options.enabled === undefined
        ? this.section.enabled
        : Boolean(options.enabled),
      axis,
      offset: clamp(
        finiteNumber(options.offset, this.section.offset),
        -1,
        1,
      ),
      reverse: options.reverse === undefined
        ? this.section.reverse
        : Boolean(options.reverse),
    };
    this.applySection();
    this.requestRender(3);
    emitEvent("sectionChanged", this.handle, { section: { ...this.section } });
    this.emitStateChanged();
  }

  applySection() {
    if (!this.modelBounds) return;
    const axisIndex = { x: 0, y: 1, z: 2 }[this.section.axis];
    const min = this.modelBounds.min.getComponent(axisIndex);
    const max = this.modelBounds.max.getComponent(axisIndex);
    const position = THREE.MathUtils.lerp(
      min,
      max,
      (this.section.offset + 1) / 2,
    );
    const normal = new THREE.Vector3();
    normal.setComponent(axisIndex, this.section.reverse ? -1 : 1);
    this.sectionPlane.set(normal, -normal.getComponent(axisIndex) * position);
    const clippingPlanes = this.section.enabled ? [this.sectionPlane] : [];
    forEachMaterial(this.modelRoot, (material) => {
      material.clippingPlanes = clippingPlanes;
      material.clipShadows = true;
      material.needsUpdate = true;
    });
    if (this.edgeMaterial) {
      this.edgeMaterial.clippingPlanes = clippingPlanes;
      this.edgeMaterial.needsUpdate = true;
    }
  }

  setExplode(factor) {
    this.explodeFactor = clamp(finiteNumber(factor, 0), 0, 1);
    this.applyExplode();
    this.requestRender(4);
    emitEvent("explodeChanged", this.handle, {
      factor: this.explodeFactor,
    });
    this.emitStateChanged();
  }

  applyExplode() {
    for (const item of this.explodeEntries) {
      item.entry.object.position.copy(item.originalPosition).addScaledVector(
        item.localOffset,
        this.explodeFactor,
      );
    }
    this.modelRoot.updateMatrixWorld(true);
  }

  setMeasurementMode(enabled) {
    this.measurementMode = Boolean(enabled);
    this.canvas.style.cursor = this.measurementMode ? "crosshair" : "";
    this.setHoveredEntry(null);
    if (!this.measurementMode && this.measurementPoints.length === 1) {
      this.clearMeasurements();
    }
    this.emitStateChanged();
  }

  addMeasurementPoint(point) {
    if (this.measurementPoints.length >= 2) this.clearMeasurements(false);
    this.measurementPoints.push(point.clone());
    if (this.measurementPoints.length === 2) {
      this.measurement = {
        start: this.measurementPoints[0].toArray(),
        end: this.measurementPoints[1].toArray(),
        distance: this.measurementPoints[0].distanceTo(
          this.measurementPoints[1],
        ),
        unit: "meter",
      };
    } else {
      this.measurement = null;
    }
    this.updateMeasurementVisual();
    emitEvent("measurementChanged", this.handle, {
      measurement: this.measurement,
      pendingPoint: this.measurementPoints.length === 1
        ? this.measurementPoints[0].toArray()
        : null,
    });
    this.emitStateChanged();
  }

  updateMeasurementVisual() {
    this.measurementVisual?.removeFromParent();
    if (this.measurementVisual) {
      this.measurementVisual.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
    }
    this.measurementVisual = null;
    if (!this.measurementPoints.length) {
      this.requestRender(2);
      return;
    }
    const group = new THREE.Group();
    const pointGeometry = new THREE.BufferGeometry().setFromPoints(
      this.measurementPoints,
    );
    const pointMaterial = new THREE.PointsMaterial({
      color: 0xff3b30,
      depthTest: false,
      size: Math.max(this.modelSphere.radius * 0.012, 0.002),
      sizeAttenuation: true,
      toneMapped: false,
    });
    group.add(new THREE.Points(pointGeometry, pointMaterial));
    if (this.measurementPoints.length === 2) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(
        this.measurementPoints,
      );
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0xff3b30,
        depthTest: false,
        toneMapped: false,
      });
      group.add(new THREE.Line(lineGeometry, lineMaterial));
    }
    group.renderOrder = 10_000;
    this.overlayRoot.add(group);
    this.measurementVisual = group;
    this.requestRender(2);
  }

  clearMeasurements(emitChange = true) {
    this.measurementPoints = [];
    this.measurement = null;
    this.updateMeasurementVisual();
    if (emitChange) {
      emitEvent("measurementChanged", this.handle, {
        measurement: null,
        pendingPoint: null,
      });
      this.emitStateChanged();
    }
  }

  graphPage(offset, limit) {
    offset = Math.max(0, Math.trunc(finiteNumber(offset, 0)));
    limit = clamp(
      Math.trunc(finiteNumber(limit, 500)),
      1,
      MAX_GRAPH_PAGE_SIZE,
    );
    return {
      offset,
      limit,
      total: this.nodeEntries.length,
      nodes: this.nodeEntries.slice(offset, offset + limit).map((entry) => ({
        definitionKey: entry.semantic?.definitionKey || null,
        displayName: entry.semantic?.displayName || entry.name,
        key: entry.key,
        objectKey: entry.semantic?.objectKey || null,
        name: entry.name,
        kind: entry.kind,
        classification: entry.semantic?.classification || null,
        parentKey: entry.parentKey,
        depth: entry.depth,
        meshCount: entry.meshCount,
        triangleCount: entry.triangleCount,
        visible: this.entryIsVisible(entry),
      })),
    };
  }

  statePayload(extra = {}) {
    return {
      ready: this.ready,
      fileName: this.fileName,
      projection: this.projection,
      view: this.currentView,
      edges: this.edgesEnabled,
      explodeFactor: this.explodeFactor,
      section: { ...this.section },
      measurementMode: this.measurementMode,
      measurement: this.measurement,
      semantics: {
        assemblyCount: this.semanticAssemblies.size,
        catalogHasMore: this.cadBom.hasMore,
        catalogTotal: Math.max(this.cadBom.total, this.semanticParts.size),
        modelVersion: this.modelIndex?.modelVersion ?? null,
        occurrenceCount: this.semanticOccurrences.size,
        partCount: this.semanticParts.size,
      },
      summary: this.modelSummary,
      selected: this.selectedPayload(),
      hovered: this.entryPayload(this.hoveredEntry),
      ...this.visibilityPayload(),
      ...extra,
    };
  }

  emitStateChanged() {
    if (this.destroyed) return;
    emitEvent("stateChanged", this.handle, this.statePayload());
  }

  diagnostics() {
    const info = this.renderer.info;
    return {
      ...this.statePayload({
        summary: this.modelBounds ? this.sceneSummary() : null,
      }),
      success: true,
      contextLost: this.contextLost,
      renderer: {
        width: this.width || 0,
        height: this.height || 0,
        pixelRatio: this.renderer.getPixelRatio(),
        calls: info.render.calls,
        lines: info.render.lines,
        points: info.render.points,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        webgl2: this.renderer.capabilities.isWebGL2,
      },
      technicalEdgeObjectCount: this.edgeObjects.length,
      timingMs: {
        download: this.downloadCompletedAt && this.loadStartedAt
          ? Math.round(this.downloadCompletedAt - this.loadStartedAt)
          : null,
        parseAndPrepare: this.parseCompletedAt && this.downloadCompletedAt
          ? Math.round(this.parseCompletedAt - this.downloadCompletedAt)
          : null,
        firstRender: this.firstRenderAt && this.loadStartedAt
          ? Math.round(this.firstRenderAt - this.loadStartedAt)
          : null,
      },
    };
  }

  download() {
    const anchor = document.createElement("a");
    anchor.href = this.fileUrl;
    anchor.download = this.fileName;
    anchor.rel = "noreferrer";
    anchor.click();
  }

  disposeModel() {
    this.setSelectedEntry(null);
    this.setHoveredEntry(null);
    this.disposeEdges();
    this.clearAppearance();
    this.clearMeasurements(false);
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    const disposedTextures = new Set();
    this.modelRoot?.traverse((object) => {
      if (object.geometry && !disposedGeometries.has(object.geometry)) {
        disposedGeometries.add(object.geometry);
        object.geometry.dispose();
      }
      if (!object.material) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!material || disposedMaterials.has(material)) continue;
        disposedMaterials.add(material);
        disposeMaterial(material, disposedTextures);
      }
    });
    this.modelRoot?.clear();
    this.nodeEntries = [];
    this.entryByKey.clear();
    this.entriesByName.clear();
    this.entryByObject.clear();
    this.meshToEntry.clear();
    this.hiddenEntries.clear();
    this.filterHiddenEntries.clear();
    this.isolatedEntry = null;
    this.explodeEntries = [];
    this.modelBounds = null;
    this.modelSphere = null;
    this.modelSummary = null;
    this.recommendedFitBounds = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    if (this.renderRequest !== null) cancelAnimationFrame(this.renderRequest);
    if (this.hoverRequest !== null) cancelAnimationFrame(this.hoverRequest);
    this.renderRequest = null;
    this.hoverRequest = null;
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.controls?.dispose();
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners = [];
    this.disposeModel();
    this.selectionOutline?.dispose();
    this.hoverOutline?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.environmentTarget?.dispose();
    this.dracoLoader?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.mount?.replaceChildren();
    if (this.mount && this.originalMountStyle) {
      Object.assign(this.mount.style, this.originalMountStyle);
    }
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args?.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const viewer = new GlbViewer({ ...data, handle });
    instances.set(handle, viewer);
    return await viewer.initialize();
  } catch (error) {
    const message = errorMessage(error);
    emitEvent("error", handle, { message });
    return moduleResult(handle, { error: message, success: false });
  }
}

async function setModel(args) {
  const data = parseArgs(args);
  const viewer = instanceFor(args);
  if (!viewer) {
    return moduleResult(data.handle, {
      error: "Viewer is not initialized",
      success: false,
    });
  }
  try {
    viewer.setModelIndex(data.modelIndex, false);
    viewer.setCadInteractions(data.cadInteractions, false);
    viewer.abortController.abort();
    viewer.abortController = new AbortController();
    viewer.loadStartedAt = performance.now();
    viewer.downloadCompletedAt = 0;
    viewer.parseCompletedAt = 0;
    viewer.firstRenderAt = 0;
    await viewer.loadModel(data.fileUrl, data.fileName);
    viewer.ready = true;
    viewer.fitBounds(
      viewer.recommendedFitBounds ?? viewer.activeBounds(),
      "isometric",
    );
    if (viewer.edgesEnabled) viewer.setEdges(true, false);
    emitEvent(
      "ready",
      viewer.handle,
      viewer.statePayload({
        semanticCatalog: viewer.semanticCatalog(),
        summary: viewer.sceneSummary(),
      }),
    );
    return moduleResult(viewer.handle, { success: true });
  } catch (error) {
    if (error?.name === "AbortError") {
      return moduleResult(viewer.handle, { aborted: true, success: false });
    }
    const message = errorMessage(error);
    emitEvent("error", viewer.handle, { message });
    return moduleResult(viewer.handle, { error: message, success: false });
  }
}

function command(args, callback) {
  const data = parseArgs(args);
  const handle = args?.handle || data.handle;
  const viewer = instances.get(handle);
  if (!viewer) {
    return moduleResult(handle, {
      error: "Viewer is not initialized",
      success: false,
    });
  }
  try {
    callback(viewer, data);
    return moduleResult(handle, { success: true, ...viewer.statePayload() });
  } catch (error) {
    const message = errorMessage(error);
    emitEvent("error", handle, { message });
    return moduleResult(handle, { error: message, success: false });
  }
}

function fit(args) {
  return command(args, (viewer) => viewer.fitAll());
}

function fitSelection(args) {
  return command(args, (viewer) => {
    viewer.fitSelection();
  });
}

function fitVisible(args) {
  return command(args, (viewer) => viewer.fitVisible());
}

function setView(args) {
  return command(args, (viewer, data) => viewer.setView(data.view));
}

function setProjection(args) {
  return command(args, (viewer, data) => viewer.setProjection(data.projection));
}

function setEdges(args) {
  return command(args, (viewer, data) => viewer.setEdges(data.enabled));
}

function selectNode(args) {
  return command(
    args,
    (viewer, data) => viewer.selectNode(data.key || data.name),
  );
}

function selectDefinition(args) {
  return command(
    args,
    (viewer, data) => viewer.selectDefinition(data.definitionKey),
  );
}

function focusObject(args) {
  return command(
    args,
    (viewer, data) => viewer.focusObject(data.objectKey),
  );
}

function clearSelection(args) {
  return command(args, (viewer) => viewer.setSelectedEntry(null));
}

function hideSelection(args) {
  return command(args, (viewer) => viewer.hideSelection());
}

function isolateSelection(args) {
  return command(args, (viewer) => viewer.isolateSelection());
}

function showAll(args) {
  return command(args, (viewer) => viewer.showAll());
}

function setVisibility(args) {
  return command(args, (viewer, data) => viewer.setVisibility(data));
}

function setAppearance(args) {
  return command(args, (viewer, data) => viewer.setAppearance(data));
}

function setFilter(args) {
  return command(args, (viewer, data) => viewer.setSemanticFilter(data));
}

function clearFilter(args) {
  return command(args, (viewer) => viewer.clearSemanticFilter());
}

function setModelIndex(args) {
  return command(args, (viewer, data) => viewer.setModelIndex(data.modelIndex));
}

function applyCadInteraction(args) {
  return command(
    args,
    (viewer, data) => viewer.applyCadInteraction(data.interaction),
  );
}

function setSection(args) {
  return command(args, (viewer, data) => viewer.setSection(data));
}

function setExplode(args) {
  return command(args, (viewer, data) => viewer.setExplode(data.factor));
}

function setMeasurementMode(args) {
  return command(
    args,
    (viewer, data) => viewer.setMeasurementMode(data.enabled),
  );
}

function clearMeasurements(args) {
  return command(args, (viewer) => viewer.clearMeasurements());
}

function getSceneGraph(args) {
  const data = parseArgs(args);
  const viewer = instanceFor(args);
  if (!viewer) {
    return moduleResult(data.handle, {
      error: "Viewer is not initialized",
      success: false,
    });
  }
  return moduleResult(viewer.handle, {
    success: true,
    ...viewer.graphPage(data.offset, data.limit),
  });
}

function getState(args) {
  const data = parseArgs(args);
  const viewer = instanceFor(args);
  return moduleResult(
    viewer?.handle || data.handle,
    viewer
      ? { success: true, ...viewer.statePayload() }
      : { error: "Viewer is not initialized", success: false },
  );
}

function getDiagnostics(args) {
  const data = parseArgs(args);
  const viewer = instanceFor(args);
  return moduleResult(
    viewer?.handle || data.handle,
    viewer
      ? viewer.diagnostics()
      : { error: "Viewer is not initialized", success: false },
  );
}

function download(args) {
  return command(args, (viewer) => viewer.download());
}

function cleanup(args) {
  const data = parseArgs(args);
  const handle = args?.handle || data.handle;
  instances.get(handle)?.destroy();
  instances.delete(handle);
}

registerModule({
  initialize,
  setModel,
  fit,
  fitSelection,
  fitVisible,
  setView,
  setProjection,
  setEdges,
  selectNode,
  selectDefinition,
  focusObject,
  clearSelection,
  hideSelection,
  isolateSelection,
  showAll,
  setVisibility,
  setAppearance,
  setFilter,
  clearFilter,
  setModelIndex,
  applyCadInteraction,
  setSection,
  setExplode,
  setMeasurementMode,
  clearMeasurements,
  getSceneGraph,
  getState,
  getDiagnostics,
  download,
  cleanup,
});
