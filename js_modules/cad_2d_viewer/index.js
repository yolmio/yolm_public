// deno-lint-ignore-file no-undef

const viewers = new Map();

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

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function point(value) {
  if (!Array.isArray(value)) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function point3(value, fallbackZ = 0) {
  if (!Array.isArray(value)) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = value.length > 2 ? Number(value[2]) : Number(fallbackZ);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? [x, y, z]
    : null;
}

function normalize3(value) {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > Number.EPSILON
    ? [value[0] / length, value[1] / length, value[2] / length]
    : [0, 0, 1];
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function ocsToWorld2(normalValue, value, fallbackZ = 0) {
  const normal = normalize3(point3(normalValue, 1) ?? [0, 0, 1]);
  const position = point3(value, fallbackZ);
  if (!position) return null;
  const reference = Math.abs(normal[0]) < 1 / 64 &&
      Math.abs(normal[1]) < 1 / 64
    ? [0, 1, 0]
    : [0, 0, 1];
  const xAxis = normalize3(cross3(reference, normal));
  const yAxis = normalize3(cross3(normal, xAxis));
  return [
    xAxis[0] * position[0] + yAxis[0] * position[1] +
    normal[0] * position[2],
    xAxis[1] * position[0] + yAxis[1] * position[1] +
    normal[1] * position[2],
  ];
}

function ocsVectorToWorld2(normalValue, value) {
  const origin = ocsToWorld2(normalValue, [0, 0, 0]);
  const end = ocsToWorld2(normalValue, value);
  return origin && end ? [end[0] - origin[0], end[1] - origin[1]] : null;
}

function displayGeometry(entity, type) {
  const geometry = entity.geometry ?? entity;
  if (
    geometry.coordinateSpace !== "ocs" ||
    !Array.isArray(geometry.normal)
  ) return geometry;
  const transformValue = (value, fallbackZ = 0) =>
    ocsToWorld2(geometry.normal, value, fallbackZ) ?? value;
  const transformVertex = (vertex) => {
    const source = vertex?.point ?? vertex;
    const transformed = transformValue(
      source,
      finite(geometry.elevation, 0),
    );
    return vertex?.point === undefined
      ? transformed
      : { ...vertex, point: transformed };
  };
  const result = { ...geometry };
  for (
    const key of [
      "start",
      "end",
      "center",
      "insertionPoint",
      "alignmentPoint",
      "textPosition",
      "position",
    ]
  ) {
    if (Array.isArray(result[key])) result[key] = transformValue(result[key]);
  }
  for (
    const key of [
      "vertices",
      "points",
      "corners",
      "controlPoints",
      "fitPoints",
    ]
  ) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map(transformVertex);
    }
  }
  result.ocsXAxis = ocsVectorToWorld2(geometry.normal, [1, 0, 0]);
  result.ocsYAxis = ocsVectorToWorld2(geometry.normal, [0, 1, 0]);
  if (!Array.isArray(result.xAxisDirection)) {
    result.xAxisDirection = result.ocsXAxis;
  }
  return result;
}

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

function transformPoint(transform, value) {
  return [
    transform.a * value[0] + transform.c * value[1] + transform.e,
    transform.b * value[0] + transform.d * value[1] + transform.f,
  ];
}

function insertTransform(geometry, basePoint, column, row) {
  const insertion = point(geometry.insertionPoint) ?? [0, 0];
  const base = point(basePoint) ?? [0, 0];
  const scale = Array.isArray(geometry.scale) ? geometry.scale : [1, 1];
  const scaleX = finite(scale[0], 1);
  const scaleY = finite(scale[1], 1);
  const authoredRotation = finite(geometry.rotation, 0);
  const rotation = geometry.angleUnit === "degrees"
    ? authoredRotation * Math.PI / 180
    : authoredRotation;
  const [sin, cos] = [Math.sin(rotation), Math.cos(rotation)];
  const offsetX = column * finite(geometry.columnSpacing, 0) - base[0];
  const offsetY = row * finite(geometry.rowSpacing, 0) - base[1];
  const ocsX = point(geometry.ocsXAxis) ?? [1, 0];
  const ocsY = point(geometry.ocsYAxis) ?? [0, 1];
  const rotatedX = [
    ocsX[0] * cos + ocsY[0] * sin,
    ocsX[1] * cos + ocsY[1] * sin,
  ];
  const rotatedY = [
    -ocsX[0] * sin + ocsY[0] * cos,
    -ocsX[1] * sin + ocsY[1] * cos,
  ];
  return {
    a: rotatedX[0] * scaleX,
    b: rotatedX[1] * scaleX,
    c: rotatedY[0] * scaleY,
    d: rotatedY[1] * scaleY,
    e: insertion[0] + rotatedX[0] * scaleX * offsetX +
      rotatedY[0] * scaleY * offsetY,
    f: insertion[1] + rotatedX[1] * scaleX * offsetX +
      rotatedY[1] * scaleY * offsetY,
  };
}

function entityKey(entity, index) {
  return String(
    entity.objectKey ?? entity.operationKey ?? entity.entityKey ??
      `entity-${index}`,
  );
}

function entityType(entity) {
  return String(entity.entityType ?? entity.type ?? entity.kind ?? "unknown")
    .toLowerCase();
}

function entityLayer(entity) {
  return String(entity.layer ?? entity.face ?? "0");
}

function effectiveEntityStyle(viewer, item) {
  const entity = item.entity;
  const layer = viewer.layerByName.get(item.layer ?? entity.__layer);
  const authoredLineType = String(entity.lineType ?? "BYLAYER");
  const lineTypeName = authoredLineType.toUpperCase() === "BYLAYER"
    ? String(layer?.lineType ?? "CONTINUOUS")
    : authoredLineType;
  const lineType = viewer.lineTypeByName.get(lineTypeName.toUpperCase());
  const entityWeight = finite(
    entity.lineWeightValue ?? entity.lineWeight,
    -1,
  );
  const lineWeight = entityWeight >= 0
    ? entityWeight
    : finite(layer?.lineWeight, -1);
  const color = Array.isArray(entity.color)
    ? entity.color
    : Array.isArray(layer?.color)
    ? layer.color
    : null;
  const transparency = finite(
    entity.transparency,
    finite(layer?.transparency, 0),
  );
  return { layer, lineType, lineTypeName, lineWeight, color, transparency };
}

function cadColor(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const channels = value.slice(0, 3).map((channel) =>
    Math.max(0, Math.min(255, Math.trunc(finite(channel, 0))))
  );
  const brightness = channels[0] + channels[1] + channels[2];
  if (brightness > 720 || brightness < 24) return fallback;
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function authoredDashPattern(viewer, item, style) {
  const pattern = style.lineType?.pattern;
  if (Array.isArray(pattern) && pattern.length > 0) {
    const transformScale = Math.max(
      Math.hypot(item.transform.a, item.transform.b),
      Math.hypot(item.transform.c, item.transform.d),
    );
    const scale = Math.max(
      1e-6,
      finite(item.entity.lineTypeScale, 1) * transformScale * viewer.scale,
    );
    return pattern.map((length) =>
      Math.max(1, Math.abs(finite(length, 0)) * scale)
    );
  }
  const name = style.lineTypeName.toUpperCase();
  const scale = Math.max(0.25, finite(item.entity.lineTypeScale, 1));
  return name.includes("PHANTOM")
    ? [12, 4, 2, 4, 2, 4].map((value) => value * scale)
    : name.includes("CENTER")
    ? [12, 4, 2, 4].map((value) => value * scale)
    : name.includes("HIDDEN") || name.includes("DASH")
    ? [6, 4].map((value) => value * scale)
    : [];
}

function isThreeDimensionalModelerEntity(entity) {
  return entity.__type.includes("3dsolid") || entity.__type === "body" ||
    entity.__type.includes("surface");
}

function plainCadText(value) {
  return String(value ?? "")
    .replace(
      /\\U\+([0-9A-F]{4})/gi,
      (_, code) => String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\\P/gi, "\n")
    .replace(/\\S([^;]+);/gi, (_, stack) => stack.replace(/[#^]/g, "/"))
    .replace(/\\~/g, " ")
    .replace(/\\[A-Za-z][^;{}]*;/g, "")
    .replace(/\\[LOKlo]/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%d/gi, "°")
    .replace(/%%p/gi, "±")
    .replace(/%%c/gi, "⌀");
}

function normalizedEntities(scene) {
  const source = Array.isArray(scene.entities)
    ? scene.entities
    : Array.isArray(scene.operations)
    ? scene.operations
    : [];
  return source.map((entity, index) => {
    const type = entityType(entity);
    return {
      ...entity,
      geometry: displayGeometry(entity, type),
      __key: entityKey(entity, index),
      __type: type,
      __layer: entityLayer(entity),
    };
  });
}

function normalizedBlockEntities(block) {
  return Array.isArray(block.entities)
    ? block.entities.map((entity, index) => {
      const type = entityType(entity);
      return {
        ...entity,
        geometry: displayGeometry(entity, type),
        __key: entityKey(entity, index),
        __type: type,
        __layer: entityLayer(entity),
      };
    })
    : [];
}

function geometryPoints(entity) {
  const geometry = entity.geometry ?? entity;
  const values = [];
  for (
    const candidate of [
      geometry.start,
      geometry.end,
      geometry.center,
      geometry.insertionPoint,
      geometry.textPosition,
    ]
  ) {
    const value = point(candidate);
    if (value) values.push(value);
  }
  for (const vertex of geometry.vertices ?? geometry.points ?? []) {
    const value = point(vertex.point ?? vertex);
    if (value) values.push(value);
  }
  for (const vertex of geometry.corners ?? geometry.fitPoints ?? []) {
    const value = point(vertex.point ?? vertex);
    if (value) values.push(value);
  }
  for (const loop of geometry.loops ?? []) {
    for (const vertex of loop ?? []) {
      const value = point(vertex?.point ?? vertex);
      if (value) values.push(value);
    }
  }
  const bounds = entity.bounds;
  if (bounds) {
    const min = point(bounds.min);
    const max = point(bounds.max);
    if (min) values.push(min);
    if (max) values.push(max);
  }
  const center = point(geometry.center);
  const radius = finite(geometry.radius, -1);
  if (center && radius > 0) {
    values.push([center[0] - radius, center[1] - radius]);
    values.push([center[0] + radius, center[1] + radius]);
  }
  return values;
}

function itemPoints(item) {
  return geometryPoints(item.entity).map((value) =>
    transformPoint(item.transform, value)
  );
}

function calculateBounds(items) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const clips = new Set();
  for (const item of items) {
    if (item.clip && !clips.has(item.clip.key)) {
      clips.add(item.clip.key);
      minX = Math.min(minX, item.clip.minX);
      minY = Math.min(minY, item.clip.minY);
      maxX = Math.max(maxX, item.clip.maxX);
      maxY = Math.max(maxY, item.clip.maxY);
      continue;
    }
    if (item.clip) continue;
    for (const [x, y] of itemPoints(item)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  }
  if (maxX === minX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (maxY === minY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  return { minX, minY, maxX, maxY };
}

function intersectsClip(entity, transform, clip) {
  if (!clip) return true;
  const bounds = entity.bounds;
  const min = point(bounds?.min);
  const max = point(bounds?.max);
  if (!min || !max) return true;
  const corners = [
    transformPoint(transform, min),
    transformPoint(transform, [min[0], max[1]]),
    transformPoint(transform, max),
    transformPoint(transform, [max[0], min[1]]),
  ];
  const minX = Math.min(...corners.map((value) => value[0]));
  const minY = Math.min(...corners.map((value) => value[1]));
  const maxX = Math.max(...corners.map((value) => value[0]));
  const maxY = Math.max(...corners.map((value) => value[1]));
  return maxX >= clip.minX && minX <= clip.maxX &&
    maxY >= clip.minY && minY <= clip.maxY;
}

function blockEntities(viewer, block) {
  if (Array.isArray(block?.__entities) && block.__entities.length > 0) {
    return block.__entities;
  }
  return (block?.entityKeys ?? [])
    .map((key) => viewer.entityByKey.get(String(key)))
    .filter(Boolean);
}

function isBlockReference(entity) {
  const geometry = entity.geometry ?? entity;
  return entity.__type.includes("insert") ||
    geometry.blockReference === true ||
    (entity.__type.includes("dimension") && geometry.blockName);
}

function expandEntity(
  viewer,
  entity,
  transform,
  clip,
  path,
  depth,
  output,
  inheritedLayer,
  viewportHiddenLayers,
) {
  if (!entity || entity.visible === false || depth > 24) return;
  const geometry = entity.geometry ?? entity;
  const effectiveLayer = entity.__layer === "0" && inheritedLayer
    ? inheritedLayer
    : entity.__layer;
  if (viewportHiddenLayers?.has(effectiveLayer)) return;
  if (isBlockReference(entity)) {
    const child = viewer.blockByName.get(String(geometry.blockName ?? ""));
    if (!child) {
      output.push({
        entity,
        transform,
        clip,
        path,
        layer: effectiveLayer,
        unresolvedBlock: String(geometry.blockName ?? ""),
      });
      return;
    }
    const columns = Math.max(1, Math.trunc(finite(geometry.columns, 1)));
    const rows = Math.max(1, Math.trunc(finite(geometry.rows, 1)));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        expandBlock(
          viewer,
          child,
          multiply(
            transform,
            insertTransform(geometry, child.basePoint, column, row),
          ),
          clip,
          `${path}/${entity.__key}-${row}-${column}`,
          depth + 1,
          output,
          effectiveLayer,
          viewportHiddenLayers,
        );
      }
    }
    return;
  }
  if (entity.__type.includes("viewport")) {
    if (entity.__key === viewer.paperViewportKey) return;
    const center = point(geometry.centerPaper);
    const viewCenter = point(geometry.viewCenter);
    const width = finite(geometry.widthPaper, 0);
    const height = finite(geometry.heightPaper, 0);
    const viewHeight = finite(geometry.viewHeight, 0);
    if (
      !center || !viewCenter || width <= 0 || height <= 0 || viewHeight <= 0
    ) {
      return;
    }
    const viewDirection = point3(geometry.viewDirection, 1) ?? [0, 0, 1];
    if (
      Math.hypot(viewDirection[0], viewDirection[1]) > 1e-8 ||
      Math.abs(viewDirection[2]) <= 1e-8
    ) {
      viewer.runtimeDiagnostics.add("perspective_or_oblique_viewport");
      return;
    }
    const scale = height / viewHeight;
    const rotation = -finite(geometry.twistAngle, 0);
    const [sin, cos] = [Math.sin(rotation), Math.cos(rotation)];
    const viewportTransform = {
      a: scale * cos,
      b: scale * sin,
      c: -scale * sin,
      d: scale * cos,
      e: center[0] - scale * (cos * viewCenter[0] - sin * viewCenter[1]),
      f: center[1] - scale * (sin * viewCenter[0] + cos * viewCenter[1]),
    };
    const placedCenter = transformPoint(transform, center);
    const halfWidth = width * Math.hypot(transform.a, transform.b) / 2;
    const halfHeight = height * Math.hypot(transform.c, transform.d) / 2;
    const clipHandle = Math.trunc(finite(geometry.clipBoundaryHandle, 0));
    const clipBoundary = clipHandle > 0
      ? viewer.entityByKey.get(
        `entity-${clipHandle.toString(16).toUpperCase()}`,
      )
      : null;
    const clipPolygon = clipBoundary
      ? geometryPoints(clipBoundary).map((value) =>
        transformPoint(transform, value)
      )
      : [];
    const clipXs = clipPolygon.map((value) => value[0]);
    const clipYs = clipPolygon.map((value) => value[1]);
    const viewportClip = {
      key: `${path}/${entity.__key}`,
      minX: clipPolygon.length >= 3
        ? Math.min(...clipXs)
        : placedCenter[0] - halfWidth,
      minY: clipPolygon.length >= 3
        ? Math.min(...clipYs)
        : placedCenter[1] - halfHeight,
      maxX: clipPolygon.length >= 3
        ? Math.max(...clipXs)
        : placedCenter[0] + halfWidth,
      maxY: clipPolygon.length >= 3
        ? Math.max(...clipYs)
        : placedCenter[1] + halfHeight,
      polygon: clipPolygon.length >= 3 ? clipPolygon : null,
    };
    const frozenLayers = new Set(
      (geometry.frozenLayerHandles ?? []).map((handle) =>
        viewer.layerNameByHandle.get(String(handle))
      ).filter(Boolean),
    );
    expandBlock(
      viewer,
      viewer.modelBlock,
      multiply(transform, viewportTransform),
      viewportClip,
      viewportClip.key,
      depth + 1,
      output,
      effectiveLayer,
      frozenLayers,
    );
    return;
  }
  if (isThreeDimensionalModelerEntity(entity)) return;
  if (intersectsClip(entity, transform, clip)) {
    output.push({
      entity,
      transform,
      clip,
      path,
      layer: effectiveLayer,
      viewportHiddenLayers,
    });
  }
}

function expandBlock(
  viewer,
  block,
  transform,
  clip,
  path,
  depth,
  output,
  inheritedLayer = null,
  viewportHiddenLayers = null,
) {
  if (!block || depth > 24) return;
  for (const entity of blockEntities(viewer, block)) {
    expandEntity(
      viewer,
      entity,
      transform,
      clip,
      `${path}/${entity.__key}`,
      depth,
      output,
      inheritedLayer,
      viewportHiddenLayers,
    );
  }
}

function buildItems(viewer) {
  const layout = viewer.viewKey
    ? viewer.layouts.find((candidate) => candidate.viewKey === viewer.viewKey)
    : null;
  if (layout?.viewKey?.startsWith("face:")) {
    return viewer.entities
      .filter((entity) => entity.__layer === layout.viewKey.slice(5))
      .map((entity) => ({ entity, transform: identity, clip: null }));
  }
  viewer.paperViewportKey = layout?.paperViewportKey ?? null;
  const output = [];
  if (Array.isArray(layout?.entityKeys)) {
    for (const key of layout.entityKeys) {
      expandEntity(
        viewer,
        viewer.entityByKey.get(String(key)),
        identity,
        null,
        `${layout.viewKey}/${key}`,
        0,
        output,
        null,
      );
    }
    return output;
  }
  const block = viewer.blockByKey.get(layout?.blockKey) ?? viewer.modelBlock;
  if (!block) {
    for (const entity of viewer.entities) {
      expandEntity(
        viewer,
        entity,
        identity,
        null,
        `${layout?.viewKey ?? "model"}/${entity.__key}`,
        0,
        output,
        null,
      );
    }
    return output;
  }
  expandBlock(
    viewer,
    block,
    identity,
    null,
    layout?.viewKey ?? "model",
    0,
    output,
  );
  return output;
}

function visibleItems(viewer) {
  return viewer.items.filter((item) =>
    viewer.visibleLayers.has(item.layer ?? item.entity.__layer)
  );
}

function worldToScreen(viewer, x, y) {
  return [
    viewer.viewportWidth / 2 + (x - viewer.centerX) * viewer.scale,
    viewer.viewportHeight / 2 - (y - viewer.centerY) * viewer.scale,
  ];
}

function screenToWorld(viewer, x, y) {
  return [
    (x - viewer.viewportWidth / 2) / viewer.scale + viewer.centerX,
    -(y - viewer.viewportHeight / 2) / viewer.scale + viewer.centerY,
  ];
}

function drawPolyline(context, viewer, transform, vertices, closed) {
  const values = (vertices ?? [])
    .map((vertex) => ({
      point: point(vertex?.point ?? vertex),
      bulge: finite(vertex?.bulge, 0),
    }))
    .filter((vertex) => vertex.point);
  if (values.length === 0) return;
  const first = transformPoint(transform, values[0].point);
  const firstScreen = worldToScreen(viewer, first[0], first[1]);
  context.moveTo(firstScreen[0], firstScreen[1]);
  const segmentCount = closed ? values.length : values.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = values[index];
    const end = values[(index + 1) % values.length];
    const dx = end.point[0] - start.point[0];
    const dy = end.point[1] - start.point[1];
    const chord = Math.hypot(dx, dy);
    if (Math.abs(start.bulge) < 1e-12 || chord < 1e-12) {
      const placed = transformPoint(transform, end.point);
      const screen = worldToScreen(viewer, placed[0], placed[1]);
      context.lineTo(screen[0], screen[1]);
      continue;
    }
    const sweep = 4 * Math.atan(start.bulge);
    const midpoint = [
      (start.point[0] + end.point[0]) / 2,
      (start.point[1] + end.point[1]) / 2,
    ];
    const centerDistance = chord * (1 - start.bulge * start.bulge) /
      (4 * start.bulge);
    const center = [
      midpoint[0] - dy / chord * centerDistance,
      midpoint[1] + dx / chord * centerDistance,
    ];
    const radius = Math.hypot(
      start.point[0] - center[0],
      start.point[1] - center[1],
    );
    const startAngle = Math.atan2(
      start.point[1] - center[1],
      start.point[0] - center[0],
    );
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
    for (let step = 1; step <= steps; step += 1) {
      const angle = startAngle + sweep * step / steps;
      const placed = transformPoint(transform, [
        center[0] + radius * Math.cos(angle),
        center[1] + radius * Math.sin(angle),
      ]);
      const screen = worldToScreen(viewer, placed[0], placed[1]);
      context.lineTo(screen[0], screen[1]);
    }
  }
  if (closed) context.closePath();
}

function evaluateNurbs(controlPoints, knots, weights, degree, parameter) {
  const controlCount = controlPoints.length;
  let span = controlCount - 1;
  if (parameter < knots[controlCount]) {
    span = -1;
    for (let index = degree; index < controlCount; index += 1) {
      if (parameter >= knots[index] && parameter < knots[index + 1]) {
        span = index;
        break;
      }
    }
    if (span < 0) return null;
  }
  const working = [];
  for (let index = 0; index <= degree; index += 1) {
    const controlIndex = span - degree + index;
    const weight = weights.length > 0 ? weights[controlIndex] : 1;
    working.push([
      controlPoints[controlIndex][0] * weight,
      controlPoints[controlIndex][1] * weight,
      weight,
    ]);
  }
  for (let level = 1; level <= degree; level += 1) {
    for (let index = degree; index >= level; index -= 1) {
      const knotIndex = span - degree + index;
      const denominator = knots[knotIndex + degree - level + 1] -
        knots[knotIndex];
      const alpha = Math.abs(denominator) <= Number.EPSILON
        ? 0
        : (parameter - knots[knotIndex]) / denominator;
      for (let coordinate = 0; coordinate < 3; coordinate += 1) {
        working[index][coordinate] =
          (1 - alpha) * working[index - 1][coordinate] +
          alpha * working[index][coordinate];
      }
    }
  }
  const result = working[degree];
  return Number.isFinite(result[2]) && Math.abs(result[2]) > Number.EPSILON
    ? [result[0] / result[2], result[1] / result[2]]
    : null;
}

function sampleSpline(geometry) {
  const degree = Math.trunc(finite(geometry.degree, 0));
  const controlPoints = (geometry.controlPoints ?? []).map(point).filter(
    Boolean,
  );
  const knots = (geometry.knots ?? []).map(Number);
  const weights = (geometry.weights ?? []).map(Number);
  const valid = degree > 0 && controlPoints.length > degree &&
    knots.length > controlPoints.length + degree &&
    knots.every(Number.isFinite) &&
    (weights.length === 0 ||
      weights.length === controlPoints.length &&
        weights.every(Number.isFinite));
  if (!valid) {
    const fitPoints = (geometry.fitPoints ?? []).map(point).filter(Boolean);
    return fitPoints.length > 1 ? fitPoints : controlPoints;
  }
  const start = knots[degree];
  const end = knots[controlPoints.length];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return controlPoints;
  }
  const sampleCount = Math.max(16, Math.min(2048, controlPoints.length * 32));
  const sampled = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const parameter = index === sampleCount
      ? end
      : start + (end - start) * index / sampleCount;
    const value = evaluateNurbs(
      controlPoints,
      knots,
      weights,
      degree,
      parameter,
    );
    if (value) sampled.push(value);
  }
  return sampled.length > 1 ? sampled : controlPoints;
}

function drawEllipse(
  context,
  viewer,
  transform,
  center,
  major,
  ratio,
  start,
  end,
) {
  const sweep = Math.abs(end - start) < 1e-12 ? Math.PI * 2 : end - start;
  const count = Math.max(12, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  const minor = [-major[1] * ratio, major[0] * ratio];
  const vertices = [];
  for (let index = 0; index <= count; index += 1) {
    const parameter = start + sweep * index / count;
    vertices.push([
      center[0] + major[0] * Math.cos(parameter) +
      minor[0] * Math.sin(parameter),
      center[1] + major[1] * Math.cos(parameter) +
      minor[1] * Math.sin(parameter),
    ]);
  }
  drawPolyline(
    context,
    viewer,
    transform,
    vertices,
    Math.abs(sweep) >= Math.PI * 2 - 1e-6,
  );
}

function drawProjectedCircle(
  context,
  viewer,
  transform,
  center,
  radius,
  xAxis,
  yAxis,
  start,
  end,
) {
  let sweep = end - start;
  if (Math.abs(sweep) < 1e-12) sweep = Math.PI * 2;
  if (sweep < 0) sweep += Math.PI * 2;
  const count = Math.max(12, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  const vertices = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = start + sweep * index / count;
    vertices.push([
      center[0] + radius *
        (xAxis[0] * Math.cos(angle) + yAxis[0] * Math.sin(angle)),
      center[1] + radius *
        (xAxis[1] * Math.cos(angle) + yAxis[1] * Math.sin(angle)),
    ]);
  }
  drawPolyline(
    context,
    viewer,
    transform,
    vertices,
    Math.abs(sweep) >= Math.PI * 2 - 1e-6,
  );
}

function drawHatch(context, viewer, transform, geometry, selected) {
  const loops = (geometry.loops ?? [])
    .map((loop) => (loop ?? []).map(point).filter(Boolean))
    .filter((loop) => loop.length >= 3);
  if (loops.length === 0) return;
  context.save();
  context.beginPath();
  for (const loop of loops) {
    for (const [index, value] of loop.entries()) {
      const placed = transformPoint(transform, value);
      const screen = worldToScreen(viewer, placed[0], placed[1]);
      if (index === 0) context.moveTo(screen[0], screen[1]);
      else context.lineTo(screen[0], screen[1]);
    }
    context.closePath();
  }
  if (geometry.solidFill === true) {
    context.fillStyle = selected
      ? "rgba(220, 38, 38, 0.25)"
      : "rgba(23, 32, 51, 0.15)";
    context.fill("evenodd");
  }
  context.clip("evenodd");
  const points = loops.flat();
  const minX = Math.min(...points.map((value) => value[0]));
  const minY = Math.min(...points.map((value) => value[1]));
  const maxX = Math.max(...points.map((value) => value[0]));
  const maxY = Math.max(...points.map((value) => value[1]));
  const diagonal = Math.max(1, Math.hypot(maxX - minX, maxY - minY));
  const patternScale = Math.max(
    1e-9,
    Math.abs(finite(geometry.patternScale, 1)),
  );
  const patternAngle = finite(geometry.patternAngle, 0);
  context.strokeStyle = selected ? "#dc2626" : "rgba(23, 32, 51, 0.6)";
  context.lineWidth = selected ? 1.5 : 0.8;
  for (const pattern of geometry.patternLines ?? []) {
    const angle = (finite(pattern.angle, 0) + patternAngle) * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const normal = [-direction[1], direction[0]];
    const base = point(pattern.base) ?? [0, 0];
    const authoredOffset = point(pattern.offset) ?? [0, 0];
    const offset = [
      authoredOffset[0] * patternScale,
      authoredOffset[1] * patternScale,
    ];
    const step = offset[0] * normal[0] + offset[1] * normal[1];
    const projections = [
      [minX, minY],
      [minX, maxY],
      [maxX, minY],
      [maxX, maxY],
    ].map((value) =>
      (value[0] - base[0]) * normal[0] + (value[1] - base[1]) * normal[1]
    );
    const minimum = Math.min(...projections);
    const maximum = Math.max(...projections);
    const first = Math.abs(step) <= 1e-12
      ? 0
      : Math.floor(Math.min(minimum / step, maximum / step)) - 2;
    const last = Math.abs(step) <= 1e-12
      ? 0
      : Math.ceil(Math.max(minimum / step, maximum / step)) + 2;
    const scale = Math.hypot(transform.a, transform.b) * viewer.scale;
    const dashes = (pattern.dashes ?? []).map((value) =>
      Math.max(0.5, Math.abs(finite(value, 0)) * patternScale * scale)
    );
    context.setLineDash(dashes);
    context.beginPath();
    for (let index = first; index <= last; index += 1) {
      const origin = [
        base[0] + offset[0] * index,
        base[1] + offset[1] * index,
      ];
      const center = [(minX + maxX) / 2, (minY + maxY) / 2];
      const tangentCenter = (center[0] - origin[0]) * direction[0] +
        (center[1] - origin[1]) * direction[1];
      const start = transformPoint(transform, [
        origin[0] + direction[0] * (tangentCenter - diagonal * 2),
        origin[1] + direction[1] * (tangentCenter - diagonal * 2),
      ]);
      const end = transformPoint(transform, [
        origin[0] + direction[0] * (tangentCenter + diagonal * 2),
        origin[1] + direction[1] * (tangentCenter + diagonal * 2),
      ]);
      const screenStart = worldToScreen(viewer, start[0], start[1]);
      const screenEnd = worldToScreen(viewer, end[0], end[1]);
      context.moveTo(screenStart[0], screenStart[1]);
      context.lineTo(screenEnd[0], screenEnd[1]);
    }
    context.stroke();
  }
  context.setLineDash([]);
  context.restore();
}

function drawLeaderGeometry(context, viewer, transform, geometry) {
  const lines = Array.isArray(geometry.leaderLines)
    ? geometry.leaderLines
    : [{ points: geometry.points ?? geometry.vertices ?? [] }];
  for (const line of lines) {
    const points = (line.points ?? []).map(point).filter(Boolean);
    if (points.length < 2) continue;
    context.beginPath();
    drawPolyline(context, viewer, transform, points, false);
    context.stroke();
  }
}

function drawTable(context, viewer, transform, geometry, selected) {
  const origin = point(geometry.insertionPoint);
  if (!origin) return;
  const rowHeights = (geometry.rowHeights ?? []).map((value) =>
    Math.max(0, finite(value, 0))
  );
  const columnWidths = (geometry.columnWidths ?? []).map((value) =>
    Math.max(0, finite(value, 0))
  );
  if (rowHeights.length === 0 || columnWidths.length === 0) return;
  const xCoordinates = [origin[0]];
  const yCoordinates = [origin[1]];
  for (const width of columnWidths) {
    xCoordinates.push(xCoordinates.at(-1) + width);
  }
  for (const height of rowHeights) {
    yCoordinates.push(yCoordinates.at(-1) - height);
  }
  context.strokeStyle = selected ? "#dc2626" : "#172033";
  context.fillStyle = selected ? "#dc2626" : "#111827";
  context.lineWidth = selected ? 2 : 1;
  for (const x of xCoordinates) {
    context.beginPath();
    drawPolyline(
      context,
      viewer,
      transform,
      [[x, yCoordinates[0]], [x, yCoordinates.at(-1)]],
      false,
    );
    context.stroke();
  }
  for (const y of yCoordinates) {
    context.beginPath();
    drawPolyline(
      context,
      viewer,
      transform,
      [[xCoordinates[0], y], [xCoordinates.at(-1), y]],
      false,
    );
    context.stroke();
  }
  for (const [rowIndex, row] of (geometry.rows ?? []).entries()) {
    if (rowIndex >= rowHeights.length) break;
    for (const [columnIndex, text] of (row ?? []).entries()) {
      if (columnIndex >= columnWidths.length || !text) continue;
      const location = transformPoint(transform, [
        xCoordinates[columnIndex] + columnWidths[columnIndex] * 0.05,
        yCoordinates[rowIndex] - rowHeights[rowIndex] * 0.75,
      ]);
      const screen = worldToScreen(viewer, location[0], location[1]);
      const size = Math.max(
        3,
        rowHeights[rowIndex] * 0.6 * viewer.scale,
      );
      context.font = `${size}px sans-serif`;
      context.fillText(plainCadText(String(text)), screen[0], screen[1]);
    }
  }
}

function drawEntity(context, viewer, item, selected) {
  const entity = item.entity;
  const transform = item.transform;
  const geometry = entity.geometry ?? entity;
  const type = entity.__type;
  const style = effectiveEntityStyle(viewer, item);
  if (item.clip) {
    context.save();
    context.beginPath();
    if (Array.isArray(item.clip.polygon) && item.clip.polygon.length >= 3) {
      item.clip.polygon.forEach((value, index) => {
        const screen = worldToScreen(viewer, value[0], value[1]);
        if (index === 0) context.moveTo(screen[0], screen[1]);
        else context.lineTo(screen[0], screen[1]);
      });
      context.closePath();
    } else {
      const min = worldToScreen(viewer, item.clip.minX, item.clip.minY);
      const max = worldToScreen(viewer, item.clip.maxX, item.clip.maxY);
      context.rect(min[0], max[1], max[0] - min[0], min[1] - max[1]);
    }
    context.clip();
  }
  if (type === "hatch") {
    drawHatch(context, viewer, transform, geometry, selected);
    if (item.clip) context.restore();
    return;
  }
  if (type.includes("multileader")) {
    context.strokeStyle = selected ? "#dc2626" : "#172033";
    context.lineWidth = selected ? 2 : 1.25;
    drawLeaderGeometry(context, viewer, transform, geometry);
  } else if (type === "leader") {
    context.strokeStyle = selected ? "#dc2626" : "#172033";
    context.lineWidth = selected ? 2 : 1.25;
    drawLeaderGeometry(context, viewer, transform, geometry);
    if (item.clip) context.restore();
    return;
  } else if (type === "table") {
    drawTable(context, viewer, transform, geometry, selected);
    if (item.clip) context.restore();
    return;
  } else if (type === "mesh") {
    const vertices = (geometry.vertices ?? []).map(point).filter(Boolean);
    context.strokeStyle = selected ? "#dc2626" : "#172033";
    context.lineWidth = selected ? 2 : 1;
    for (const face of geometry.faces ?? []) {
      const polygon = (face ?? []).map((index) => vertices[index]).filter(
        Boolean,
      );
      if (polygon.length < 2) continue;
      context.beginPath();
      drawPolyline(context, viewer, transform, polygon, true);
      context.stroke();
    }
    if (item.clip) context.restore();
    return;
  }
  context.beginPath();
  if (
    type.includes("line") && !type.includes("poly") &&
    !type.includes("leader")
  ) {
    const start = point(geometry.start);
    const end = point(geometry.end);
    if (!start || !end) {
      if (item.clip) context.restore();
      return;
    }
    const placedStart = transformPoint(transform, start);
    const placedEnd = transformPoint(transform, end);
    const a = worldToScreen(viewer, placedStart[0], placedStart[1]);
    const b = worldToScreen(viewer, placedEnd[0], placedEnd[1]);
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
  } else if (type.includes("circle") || type.includes("hole")) {
    const center = point(geometry.center ?? geometry.position);
    const radius = finite(
      geometry.radius,
      finite(geometry.diameter, 0) / 2,
    );
    if (!center || radius <= 0) {
      if (item.clip) context.restore();
      return;
    }
    const xAxis = point(geometry.ocsXAxis);
    const yAxis = point(geometry.ocsYAxis);
    if (xAxis && yAxis) {
      drawProjectedCircle(
        context,
        viewer,
        transform,
        center,
        radius,
        xAxis,
        yAxis,
        0,
        Math.PI * 2,
      );
    } else {
      drawEllipse(
        context,
        viewer,
        transform,
        center,
        [radius, 0],
        1,
        0,
        Math.PI * 2,
      );
    }
  } else if (type.includes("arc")) {
    const center = point(geometry.center);
    const radius = finite(geometry.radius, 0);
    if (!center || radius <= 0) {
      if (item.clip) context.restore();
      return;
    }
    const start = finite(
      geometry.startAngle ?? geometry.startAngleDegrees,
      0,
    );
    const end = finite(
      geometry.endAngle ?? geometry.endAngleDegrees,
      360,
    );
    const angleFactor = geometry.angleUnit === "radians" ? 1 : Math.PI / 180;
    const startRadians = start * angleFactor;
    let endRadians = end * angleFactor;
    if (endRadians < startRadians) endRadians += Math.PI * 2;
    const xAxis = point(geometry.ocsXAxis);
    const yAxis = point(geometry.ocsYAxis);
    if (xAxis && yAxis) {
      drawProjectedCircle(
        context,
        viewer,
        transform,
        center,
        radius,
        xAxis,
        yAxis,
        startRadians,
        endRadians,
      );
    } else {
      drawEllipse(
        context,
        viewer,
        transform,
        center,
        [radius, 0],
        1,
        startRadians,
        endRadians,
      );
    }
  } else if (type.includes("ellipse")) {
    const center = point(geometry.center);
    const major = point(geometry.majorAxis);
    const ratio = finite(geometry.minorAxisRatio, 0);
    if (!center || !major || ratio <= 0) {
      if (item.clip) context.restore();
      return;
    }
    drawEllipse(
      context,
      viewer,
      transform,
      center,
      major,
      ratio,
      finite(geometry.startParameter, 0),
      finite(geometry.endParameter, Math.PI * 2),
    );
  } else if (type.includes("slot")) {
    const center = point(geometry.center);
    const length = finite(geometry.length, 0);
    const width = finite(
      geometry.width,
      finite(geometry.diameter, 0),
    );
    if (!center || length <= 0 || width <= 0) {
      if (item.clip) context.restore();
      return;
    }
    const angle = finite(geometry.angle, 0) * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const normal = [-direction[1], direction[0]];
    const vertices = [
      [
        center[0] - direction[0] * length / 2 - normal[0] * width / 2,
        center[1] - direction[1] * length / 2 - normal[1] * width / 2,
      ],
      [
        center[0] + direction[0] * length / 2 - normal[0] * width / 2,
        center[1] + direction[1] * length / 2 - normal[1] * width / 2,
      ],
      [
        center[0] + direction[0] * length / 2 + normal[0] * width / 2,
        center[1] + direction[1] * length / 2 + normal[1] * width / 2,
      ],
      [
        center[0] - direction[0] * length / 2 + normal[0] * width / 2,
        center[1] - direction[1] * length / 2 + normal[1] * width / 2,
      ],
    ];
    drawPolyline(context, viewer, transform, vertices, true);
  } else if (type.includes("poly") || Array.isArray(geometry.vertices)) {
    drawPolyline(
      context,
      viewer,
      transform,
      geometry.vertices ?? geometry.points,
      geometry.closed,
    );
  } else if (type.includes("contour") && Array.isArray(geometry.points)) {
    drawPolyline(context, viewer, transform, geometry.points, true);
  } else if (Array.isArray(geometry.points)) {
    drawPolyline(context, viewer, transform, geometry.points, false);
  } else if (type.includes("spline")) {
    drawPolyline(
      context,
      viewer,
      transform,
      sampleSpline(geometry),
      geometry.closed,
    );
  } else if (Array.isArray(geometry.corners)) {
    drawPolyline(context, viewer, transform, geometry.corners, true);
  } else if (type.includes("text") || entity.text || geometry.text) {
    const position = point(
      geometry.insertionPoint ?? geometry.textPosition ?? geometry.position,
    );
    if (!position) {
      if (item.clip) context.restore();
      return;
    }
    const placed = transformPoint(transform, position);
    const screen = worldToScreen(viewer, placed[0], placed[1]);
    const textAxis = point(geometry.xAxisDirection);
    const authoredRotation = finite(geometry.rotation, 0);
    const rotation = textAxis
      ? Math.atan2(textAxis[1], textAxis[0])
      : geometry.angleUnit === "degrees"
      ? authoredRotation * Math.PI / 180
      : authoredRotation;
    const directionStart = transformPoint(transform, [0, 0]);
    const directionEnd = transformPoint(transform, [
      Math.cos(rotation),
      Math.sin(rotation),
    ]);
    const screenRotation = Math.atan2(
      -(directionEnd[1] - directionStart[1]),
      directionEnd[0] - directionStart[0],
    );
    context.save();
    context.translate(screen[0], screen[1]);
    context.rotate(screenRotation);
    context.fillStyle = selected ? "#dc2626" : cadColor(style.color, "#111827");
    const fontSize = Math.max(
      3,
      finite(geometry.height, 2) *
        Math.hypot(transform.c, transform.d) * viewer.scale,
    );
    const textStyle = viewer.textStyleByName.get(
      String(geometry.textStyle ?? "STANDARD").toUpperCase(),
    );
    const fontName = String(
      textStyle?.trueTypeFont ?? textStyle?.primaryFont ?? "",
    ).replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
    context.font = `${fontSize}px ${fontName || "sans-serif"}`;
    context.scale(
      Math.max(1e-6, finite(geometry.widthFactor, textStyle?.widthFactor ?? 1)),
      1,
    );
    for (
      const [index, line] of plainCadText(
        geometry.text ?? entity.text ?? "",
      ).split("\n").entries()
    ) {
      context.fillText(line, 0, index * fontSize * 1.15);
    }
    context.restore();
    if (item.clip) context.restore();
    return;
  } else {
    const bounds = entity.bounds;
    const min = point(bounds?.min);
    const max = point(bounds?.max);
    if (!min || !max) {
      if (item.clip) context.restore();
      return;
    }
    drawPolyline(
      context,
      viewer,
      transform,
      [min, [min[0], max[1]], max, [max[0], min[1]]],
      true,
    );
  }
  context.strokeStyle = selected ? "#dc2626" : cadColor(style.color, "#172033");
  context.fillStyle = type.includes("wipeout")
    ? viewer.backgroundColor
    : selected
    ? "#dc2626"
    : "#172033";
  context.setLineDash(authoredDashPattern(viewer, item, style));
  context.globalAlpha = Math.max(0, Math.min(1, 1 - style.transparency / 255));
  context.lineWidth = selected
    ? 3
    : style.lineWeight >= 0
    ? Math.max(0.5, style.lineWeight / 100 * 96 / 25.4)
    : 1.25;
  if (type === "solid" || type === "trace" || type.includes("wipeout")) {
    context.fill();
  }
  if (!type.includes("wipeout") || selected) context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  if (item.clip) context.restore();
}

function render(viewer) {
  const { canvas, context } = viewer;
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  viewer.viewportWidth = Math.max(1, canvas.clientWidth);
  viewer.viewportHeight = Math.max(1, canvas.clientHeight);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.fillStyle = viewer.backgroundColor;
  context.fillRect(0, 0, width, height);
  context.save();
  context.scale(ratio, ratio);
  const items = visibleItems(viewer);
  items.sort((left, right) =>
    Number(right.entity.__type === "hatch") -
    Number(left.entity.__type === "hatch")
  );
  for (const item of items) {
    drawEntity(
      context,
      viewer,
      item,
      item.entity.__key === viewer.selectedKey,
    );
  }
  context.restore();
}

function fitViewer(viewer, items = visibleItems(viewer)) {
  const bounds = calculateBounds(items);
  const width = Math.max(1, viewer.canvas.clientWidth);
  const height = Math.max(1, viewer.canvas.clientHeight);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  viewer.centerX = (bounds.minX + bounds.maxX) / 2;
  viewer.centerY = (bounds.minY + bounds.maxY) / 2;
  viewer.scale = Math.max(1e-9, Math.min(width / spanX, height / spanY) * 0.9);
  render(viewer);
}

function distanceToItem(item, world) {
  if (
    item.clip &&
    (world[0] < item.clip.minX || world[0] > item.clip.maxX ||
      world[1] < item.clip.minY || world[1] > item.clip.maxY)
  ) {
    return Infinity;
  }
  const points = itemPoints(item);
  let best = Infinity;
  for (const candidate of points) {
    best = Math.min(
      best,
      Math.hypot(candidate[0] - world[0], candidate[1] - world[1]),
    );
  }
  const geometry = item.entity.geometry ?? item.entity;
  const center = point(geometry.center);
  const radius = finite(geometry.radius, -1);
  if (center && radius > 0) {
    const placedCenter = transformPoint(item.transform, center);
    const placedRadius = radius *
      Math.hypot(item.transform.a, item.transform.b);
    best = Math.min(
      best,
      Math.abs(
        Math.hypot(placedCenter[0] - world[0], placedCenter[1] - world[1]) -
          placedRadius,
      ),
    );
  }
  return best;
}

function selectionPayload(viewer) {
  const entity = viewer.entityByKey.get(viewer.selectedKey);
  return {
    handle: viewer.handle,
    selected: entity
      ? {
        objectKey: entity.__key,
        type: entity.__type,
        layer: entity.__layer,
        text: entity.text ?? entity.geometry?.text ?? null,
      }
      : null,
  };
}

function bindInput(viewer) {
  let drag = null;
  viewer.canvas.addEventListener("pointerdown", (event) => {
    viewer.canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, moved: false };
  });
  viewer.canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    viewer.centerX -= dx / viewer.scale;
    viewer.centerY += dy / viewer.scale;
    drag.x = event.clientX;
    drag.y = event.clientY;
    render(viewer);
  });
  viewer.canvas.addEventListener("pointerup", (event) => {
    const previous = drag;
    drag = null;
    if (!previous || previous.moved) return;
    const rect = viewer.canvas.getBoundingClientRect();
    const world = screenToWorld(
      viewer,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    const tolerance = 10 / viewer.scale;
    let selected = null;
    let distance = tolerance;
    for (const item of visibleItems(viewer)) {
      const candidate = distanceToItem(item, world);
      if (candidate <= distance) {
        selected = item.entity;
        distance = candidate;
      }
    }
    viewer.selectedKey = selected?.__key ?? null;
    render(viewer);
    emit(
      "selectionChanged",
      moduleResult(viewer.handle, selectionPayload(viewer)),
    );
  });
  viewer.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = viewer.canvas.getBoundingClientRect();
    const before = screenToWorld(
      viewer,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    viewer.scale *= Math.exp(-event.deltaY * 0.001);
    viewer.scale = Math.min(1e9, Math.max(1e-9, viewer.scale));
    const after = screenToWorld(
      viewer,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    viewer.centerX += before[0] - after[0];
    viewer.centerY += before[1] - after[1];
    render(viewer);
  }, { passive: false });
}

export async function initialize(args) {
  const data = parseArgs(args);
  const handle = args?.handle || data.handle;
  cleanup({ handle });
  const mount = globalThis.document.getElementById(data.elementId);
  if (!mount) throw new Error(`CAD 2D mount not found: ${data.elementId}`);
  const canvas = globalThis.document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  canvas.setAttribute("aria-label", "2D CAD drawing");
  mount.replaceChildren(canvas);
  const abort = new AbortController();
  const viewer = {
    handle,
    mount,
    canvas,
    context: canvas.getContext("2d"),
    abort,
    observer: null,
    entities: [],
    layers: [],
    blocks: [],
    layouts: [],
    entityByKey: new Map(),
    blockByKey: new Map(),
    blockByName: new Map(),
    layerNameByHandle: new Map(),
    layerByName: new Map(),
    lineTypeByName: new Map(),
    textStyleByName: new Map(),
    modelBlock: null,
    paperViewportKey: null,
    items: [],
    visibleLayers: new Set(),
    viewKey: data.viewKey ?? null,
    selectedKey: data.objectKey ?? null,
    centerX: 0,
    centerY: 0,
    scale: 1,
    viewportWidth: 1,
    viewportHeight: 1,
    backgroundColor: data.backgroundColor ?? "#f8fafc",
    fileName: data.fileName ?? "drawing",
    format: data.format ?? "cad",
    sourceCoverage: [],
    sourceDependencies: [],
    runtimeDiagnostics: new Set(),
  };
  if (!viewer.context) throw new Error("2D canvas is unavailable");
  viewers.set(args.handle, viewer);
  bindInput(viewer);
  viewer.observer = new ResizeObserver(() => render(viewer));
  viewer.observer.observe(mount);
  try {
    const response = await fetch(data.fileUrl, {
      credentials: "same-origin",
      signal: abort.signal,
    });
    if (!response.ok) {
      throw new Error(`Drawing request failed with HTTP ${response.status}`);
    }
    const scene = await response.json();
    if (scene.schemaVersion !== 1) {
      throw new Error(`Unsupported CAD scene schema: ${scene.schemaVersion}`);
    }
    viewer.entities = normalizedEntities(scene);
    viewer.layers = Array.isArray(scene.layers) ? scene.layers : [];
    viewer.blocks = Array.isArray(scene.blocks)
      ? scene.blocks.map((block) => ({
        ...block,
        __entities: normalizedBlockEntities(block),
      }))
      : [];
    viewer.layouts = Array.isArray(scene.layouts) ? scene.layouts : [];
    viewer.layerByName = new Map(
      viewer.layers.map((layer) => [
        String(layer.name ?? layer.layerKey),
        layer,
      ]),
    );
    viewer.lineTypeByName = new Map(
      (Array.isArray(scene.lineTypes) ? scene.lineTypes : []).map((
        lineType,
      ) => [
        String(lineType.name ?? "").toUpperCase(),
        lineType,
      ]),
    );
    viewer.textStyleByName = new Map(
      (Array.isArray(scene.textStyles) ? scene.textStyles : []).map((style) => [
        String(style.name ?? "").toUpperCase(),
        style,
      ]),
    );
    viewer.sourceCoverage = Array.isArray(scene.coverage) ? scene.coverage : [];
    viewer.sourceDependencies = Array.isArray(scene.dependencies)
      ? scene.dependencies
      : [];
    const indexedEntities = [
      ...viewer.entities,
      ...viewer.blocks.flatMap((block) => block.__entities),
    ];
    viewer.entityByKey = new Map(
      indexedEntities.map((entity) => [entity.__key, entity]),
    );
    viewer.blockByKey = new Map(
      viewer.blocks.map((block) => [String(block.blockKey), block]),
    );
    viewer.blockByName = new Map(
      viewer.blocks.map((block) => [String(block.name), block]),
    );
    viewer.layerNameByHandle = new Map(
      viewer.layers.flatMap((layer) => {
        const match = String(layer.layerKey ?? "").match(
          /^layer-([0-9a-f]+)$/i,
        );
        return match
          ? [[
            String(Number.parseInt(match[1], 16)),
            String(layer.name ?? layer.layerKey),
          ]]
          : [];
      }),
    );
    const modelLayout = viewer.layouts.find((layout) =>
      layout.kind === "model" || String(layout.name).toLowerCase() === "model"
    );
    viewer.modelBlock = viewer.blockByKey.get(modelLayout?.blockKey) ??
      viewer.blocks.find((block) =>
        String(block.name).toUpperCase().includes("MODEL_SPACE")
      ) ?? null;
    viewer.viewKey = data.viewKey ?? scene.defaultViewKey ??
      modelLayout?.viewKey ?? null;
    viewer.items = buildItems(viewer);
    const layerNames = new Set(indexedEntities.map((entity) => entity.__layer));
    for (const layer of viewer.layers) {
      layerNames.add(String(layer.name ?? layer.layerKey));
    }
    viewer.visibleLayers = new Set(
      [...layerNames].filter((name) => {
        const layer = viewer.layers.find((candidate) =>
          String(candidate.name ?? candidate.layerKey) === name
        );
        return layer?.visible !== false;
      }),
    );
    fitViewer(viewer);
    if (viewer.selectedKey) {
      focusObject({
        handle: viewer.handle,
        objectKey: viewer.selectedKey,
      });
    }
    emit(
      "ready",
      moduleResult(viewer.handle, {
        format: viewer.format,
        fileName: viewer.fileName,
        entityCount: viewer.entities.length,
        layers: [...layerNames].sort().map((name) => ({
          name,
          visible: viewer.visibleLayers.has(name),
        })),
        layouts: viewer.layouts,
        coverage: viewer.sourceCoverage,
        dependencies: viewer.sourceDependencies,
        diagnostics: [...viewer.runtimeDiagnostics].sort(),
        defaultViewKey: viewer.viewKey,
        selected: selectionPayload(viewer).selected,
      }),
    );
  } catch (error) {
    if (error?.name === "AbortError") return { json: { aborted: true } };
    emit(
      "error",
      moduleResult(viewer.handle, {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
  return { json: getState({ handle: viewer.handle }).json };
}

export function fit(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  fitViewer(viewer);
  return { json: getState(args).json };
}

export function zoom(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  viewer.scale *= finite(data.factor, 1);
  viewer.scale = Math.min(1e9, Math.max(1e-9, viewer.scale));
  render(viewer);
  return { json: getState(args).json };
}

export function setView(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  viewer.viewKey = data.viewKey || null;
  viewer.items = buildItems(viewer);
  fitViewer(viewer);
  emit("stateChanged", moduleResult(viewer.handle, getState(args).json));
  return { json: getState(args).json };
}

export function setLayerVisibility(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  if (data.visible) viewer.visibleLayers.add(String(data.layer));
  else viewer.visibleLayers.delete(String(data.layer));
  fitViewer(viewer);
  emit("stateChanged", moduleResult(viewer.handle, getState(args).json));
  return { json: getState(args).json };
}

export function setLayerVisibilityBatch(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  for (const layer of data.layers ?? []) {
    if (layer.visible) viewer.visibleLayers.add(String(layer.name));
    else viewer.visibleLayers.delete(String(layer.name));
  }
  fitViewer(viewer);
  emit("stateChanged", moduleResult(viewer.handle, getState(args).json));
  return { json: getState(args).json };
}

export function focusObject(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  const entity = viewer.entityByKey.get(String(data.objectKey));
  if (!entity) return { json: { found: false } };
  viewer.selectedKey = entity.__key;
  const matchingItems = viewer.items.filter((item) =>
    item.entity.__key === entity.__key
  );
  if (matchingItems.length === 0) {
    render(viewer);
    return { json: { found: true, ...selectionPayload(viewer) } };
  }
  const bounds = calculateBounds(matchingItems);
  viewer.centerX = (bounds.minX + bounds.maxX) / 2;
  viewer.centerY = (bounds.minY + bounds.maxY) / 2;
  render(viewer);
  emit(
    "selectionChanged",
    moduleResult(viewer.handle, selectionPayload(viewer)),
  );
  return { json: { found: true, ...selectionPayload(viewer) } };
}

export function getState(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  return moduleResult(viewer.handle, {
    handle: viewer.handle,
    format: viewer.format,
    fileName: viewer.fileName,
    viewKey: viewer.viewKey,
    entityCount: viewer.entities.length,
    selected: selectionPayload(viewer).selected,
    visibleLayers: [...viewer.visibleLayers].sort(),
  });
}

export function cleanup(args) {
  const data = parseArgs(args);
  const handle = args?.handle || data.handle;
  const viewer = viewers.get(handle);
  if (!viewer) return { json: { cleaned: false } };
  viewer.abort.abort();
  viewer.observer?.disconnect();
  viewer.mount.replaceChildren();
  viewers.delete(handle);
  return { json: { cleaned: true } };
}

registerModule({
  initialize,
  fit,
  zoom,
  setView,
  setLayerVisibility,
  setLayerVisibilityBatch,
  focusObject,
  getState,
  cleanup,
});

function requireViewer(handle) {
  const viewer = viewers.get(handle);
  if (!viewer) throw new Error(`CAD 2D viewer not initialized: ${handle}`);
  return viewer;
}
