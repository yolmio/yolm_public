# GLB viewer browser module

`glb_viewer` is the rendering and inspection engine for self-contained GLB 2.0
files. It deliberately owns no application toolbar, inspector DOM, or product
styling. A caller supplies a mount element and drives the viewer through module
commands and emitted state.

`packages/components/glb_viewer.tsx` provides the corresponding CAD workbench:
model browser, property inspector, fit and named-view controls, projection,
technical edges, sectioning, exploded view, measurement, visibility controls,
and download. `examples/glb_viewer` is the standalone interactive test surface.

The module creates one focusable canvas inside the mount. It uses Three.js,
WebGL 2, glTF PBR materials, AgX tone mapping, a local studio environment,
selection and hover outlines, and on-demand rendering. Meshopt- and
Draco-compressed GLB geometry are supported. External buffers and images are
rejected so opening a model cannot trigger arbitrary network requests.

The vendored `DRACOLoader` is the matching Three.js r185 loader with only its
`import.meta` default URLs removed. Yolm supplies the packaged decoder sidecar
URL explicitly so the browser bundle remains a classic CSP-compatible script.

Embedded images are decoded through a CSP-safe data-image path. This avoids the
temporary `blob:` fetches normally used by Three.js, so textured GLBs work under
Yolm's production Content Security Policy without weakening it.

## Initialize

`initialize` accepts:

- `handle`: unique viewer instance handle.
- `elementId`: existing mount element ID.
- `fileUrl`: authenticated or object URL for the GLB.
- `fileName`: accessible model label and download name.
- `dracoDecoderUrl`: URL of the packaged `draco_decoder.wasm` sidecar; the
  worker wrapper and JavaScript fallback must be served from the same directory.
- `maxBytes`: optional download ceiling; defaults to 512 MiB.
- `maxPixelRatio`: optional device-pixel-ratio ceiling; defaults to 2.
- `projection`: `perspective` (default) or `orthographic`.
- `backgroundColor`: canvas scene background; defaults to `#e9edf2`.
- `transparent`: render over the caller's background when true.
- `edges`: generate technical edges after load when true.
- `cadInteractions`: optional completed `cad_interact` action/result envelopes
  used to seed summary, BOM, structure, and object metadata.
- `modelIndex`: legacy eager metadata supported as a compatibility shim.

`setModel` replaces the active model without replacing the viewer instance.

## Commands

- Camera: `fit`, `fitSelection`, `fitVisible`, `setView`, `setProjection`.
- Selection: `selectNode`, `selectDefinition`, `focusObject`,
  `clearSelection`.
- Visibility: `hideSelection`, `isolateSelection`, `showAll`, `setVisibility`,
  `setFilter`, `clearFilter`.
- Semantics and appearance: `setModelIndex`, `setAppearance`.
- Inspection: `setEdges`, `setSection`, `setExplode`,
  `setMeasurementMode`, `clearMeasurements`.
- Data: `applyCadInteraction`, `getSceneGraph`, `getState`, `getDiagnostics`.
- Lifecycle: `download`, `cleanup`.

`setView` accepts `isometric`, `front`, `back`, `right`, `left`, `top`, or
`bottom`. `setSection` accepts `enabled`, axis `x`/`y`/`z`, normalized `offset`
from -1 to 1, and `reverse`. `setExplode.factor` is normalized from 0 to 1.
`getSceneGraph` accepts `offset` and `limit`; pages are capped at 2,000 nodes.

`applyCadInteraction` accepts one completed envelope containing `action` and
`result` (or a nested `response.result`). The viewer understands the v1 actions
`get_summary`, `list_bom`, `list_children`, `get_object`, and
`list_occurrences`; `convert` artifacts are loaded separately with `setModel`.
The cache hash remains application-owned and is never needed by the renderer.

Converted GLBs should identify addressable nodes through extras:

```json
{
  "yolmCad": {
    "objectKey": "occurrence-123",
    "definitionKey": "part-17",
    "kind": "occurrence"
  }
}
```

Names remain presentation text. Identity and definition-wide filtering use
these keys, so conversion profiles may rename or simplify nodes safely.
`focusObject` accepts any exact object, occurrence, or definition key, selects
the matching visible node, and frames it for evidence-review links.

Two measurement clicks return a distance in meters, matching glTF's coordinate
unit. Selection state also exposes source dimensions and units when a product
model index is present.

## Events

- Loading and lifecycle: `progress`, `ready`, `error`, `contextLost`,
  `contextRestored`.
- Interaction: `selectionChanged`, `hoverChanged`, `visibilityChanged`,
  `measurementChanged`.
- Inspection state: `sectionChanged`, `explodeChanged`, `semanticsChanged`,
  `stateChanged`.

Every event includes the viewer handle. `stateChanged` and `getState` expose the
same caller-facing state shape. `getDiagnostics` additionally reports scene
counts, renderer memory/call counters, canvas dimensions, WebGL capability, and
download/parse/first-render timings.

## Built-in interaction

- Left drag or one-finger drag: orbit.
- Right drag or two-finger drag: pan.
- Wheel or pinch: cursor-centered zoom.
- Click: select, or place a measurement point in measurement mode.
- Double-click: fit the selected node or complete model.
- `F`: fit, `H`: hide selected, `I`: isolate selected, `A`: show all,
  `Escape`: clear selection or a pending measurement.

All GPU resources, image bitmaps, observers, listeners, pending fetches, and the
WebGL context are released by `cleanup`.

## Real-model validation

The opt-in corpus uses checksum-pinned Khronos Sample Assets covering hierarchy,
PBR textures, transmission and volume, a 41 MiB multi-object scene, and GPU
instancing. Download and run it with:

```bash
bun js_modules/glb_viewer/download_real_models.js /tmp/yolm-glb-real-models
GLB_VIEWER_REAL_MODEL_DIR=/tmp/yolm-glb-real-models \
  bun test js_modules/glb_viewer/real_models.test.js
```

The normal synthetic browser suite remains network-independent. The example's
committed Toy Car and Simple Instancing fixtures are CC0 and exercise the actual
Yolm component, module asset delivery, and production CSP.
