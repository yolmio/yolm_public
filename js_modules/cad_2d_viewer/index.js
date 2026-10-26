// deno-lint-ignore-file no-undef

import {
  dstvFaceHeight,
  dstvFaceLabel,
  formatAngle,
  formatDecimal,
  formatLength,
  layerRole,
  markLabel,
  parseFabData,
  sourceUnitScale,
} from "./shop.js";

const viewers = new Map();

// AutoCAD Color Index palette from ezdxf DXF_DEFAULT_COLORS.
// Copyright (c) 2020-2023, Manfred Moitzi. MIT License.
// Index 7 is adjusted for the viewer background by cadColor.
const ACI_COLORS = [
  0x000000,
  0xff0000,
  0xffff00,
  0x00ff00,
  0x00ffff,
  0x0000ff,
  0xff00ff,
  0xffffff,
  0x808080,
  0xc0c0c0,
  0xff0000,
  0xff7f7f,
  0xa50000,
  0xa55252,
  0x7f0000,
  0x7f3f3f,
  0x4c0000,
  0x4c2626,
  0x260000,
  0x261313,
  0xff3f00,
  0xff9f7f,
  0xa52900,
  0xa56752,
  0x7f1f00,
  0x7f4f3f,
  0x4c1300,
  0x4c2f26,
  0x260900,
  0x261713,
  0xff7f00,
  0xffbf7f,
  0xa55200,
  0xa57c52,
  0x7f3f00,
  0x7f5f3f,
  0x4c2600,
  0x4c3926,
  0x261300,
  0x261c13,
  0xffbf00,
  0xffdf7f,
  0xa57c00,
  0xa59152,
  0x7f5f00,
  0x7f6f3f,
  0x4c3900,
  0x4c4226,
  0x261c00,
  0x262113,
  0xffff00,
  0xffff7f,
  0xa5a500,
  0xa5a552,
  0x7f7f00,
  0x7f7f3f,
  0x4c4c00,
  0x4c4c26,
  0x262600,
  0x262613,
  0xbfff00,
  0xdfff7f,
  0x7ca500,
  0x91a552,
  0x5f7f00,
  0x6f7f3f,
  0x394c00,
  0x424c26,
  0x1c2600,
  0x212613,
  0x7fff00,
  0xbfff7f,
  0x52a500,
  0x7ca552,
  0x3f7f00,
  0x5f7f3f,
  0x264c00,
  0x394c26,
  0x132600,
  0x1c2613,
  0x3fff00,
  0x9fff7f,
  0x29a500,
  0x67a552,
  0x1f7f00,
  0x4f7f3f,
  0x134c00,
  0x2f4c26,
  0x092600,
  0x172613,
  0x00ff00,
  0x7fff7f,
  0x00a500,
  0x52a552,
  0x007f00,
  0x3f7f3f,
  0x004c00,
  0x264c26,
  0x002600,
  0x132613,
  0x00ff3f,
  0x7fff9f,
  0x00a529,
  0x52a567,
  0x007f1f,
  0x3f7f4f,
  0x004c13,
  0x264c2f,
  0x002609,
  0x135817,
  0x00ff7f,
  0x7fffbf,
  0x00a552,
  0x52a57c,
  0x007f3f,
  0x3f7f5f,
  0x004c26,
  0x264c39,
  0x002613,
  0x13581c,
  0x00ffbf,
  0x7fffdf,
  0x00a57c,
  0x52a591,
  0x007f5f,
  0x3f7f6f,
  0x004c39,
  0x264c42,
  0x00261c,
  0x135858,
  0x00ffff,
  0x7fffff,
  0x00a5a5,
  0x52a5a5,
  0x007f7f,
  0x3f7f7f,
  0x004c4c,
  0x264c4c,
  0x002626,
  0x135858,
  0x00bfff,
  0x7fdfff,
  0x007ca5,
  0x5291a5,
  0x005f7f,
  0x3f6f7f,
  0x00394c,
  0x26427e,
  0x001c26,
  0x135858,
  0x007fff,
  0x7fbfff,
  0x0052a5,
  0x527ca5,
  0x003f7f,
  0x3f5f7f,
  0x00264c,
  0x26397e,
  0x001326,
  0x131c58,
  0x003fff,
  0x7f9fff,
  0x0029a5,
  0x5267a5,
  0x001f7f,
  0x3f4f7f,
  0x00134c,
  0x262f7e,
  0x000926,
  0x131758,
  0x0000ff,
  0x7f7fff,
  0x0000a5,
  0x5252a5,
  0x00007f,
  0x3f3f7f,
  0x00004c,
  0x26267e,
  0x000026,
  0x131358,
  0x3f00ff,
  0x9f7fff,
  0x2900a5,
  0x6752a5,
  0x1f007f,
  0x4f3f7f,
  0x13004c,
  0x2f267e,
  0x090026,
  0x171358,
  0x7f00ff,
  0xbf7fff,
  0x5200a5,
  0x7c52a5,
  0x3f007f,
  0x5f3f7f,
  0x26004c,
  0x39267e,
  0x130026,
  0x1c1358,
  0xbf00ff,
  0xdf7fff,
  0x7c00a5,
  0x9152a5,
  0x5f007f,
  0x6f3f7f,
  0x39004c,
  0x42264c,
  0x1c0026,
  0x581358,
  0xff00ff,
  0xff7fff,
  0xa500a5,
  0xa552a5,
  0x7f007f,
  0x7f3f7f,
  0x4c004c,
  0x4c264c,
  0x260026,
  0x581358,
  0xff00bf,
  0xff7fdf,
  0xa5007c,
  0xa55291,
  0x7f005f,
  0x7f3f6f,
  0x4c0039,
  0x4c2642,
  0x26001c,
  0x581358,
  0xff007f,
  0xff7fbf,
  0xa50052,
  0xa5527c,
  0x7f003f,
  0x7f3f5f,
  0x4c0026,
  0x4c2639,
  0x260013,
  0x58131c,
  0xff003f,
  0xff7f9f,
  0xa50029,
  0xa55267,
  0x7f001f,
  0x7f3f4f,
  0x4c0013,
  0x4c262f,
  0x260009,
  0x581317,
  0x000000,
  0x656565,
  0x666666,
  0x999999,
  0xcccccc,
  0xffffff,
];

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

function displayGeometry(entity) {
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

function xrefTransform(matrix) {
  if (
    !Array.isArray(matrix) || matrix.length !== 16 ||
    !matrix.every(Number.isFinite)
  ) return null;
  return {
    a: matrix[0],
    b: matrix[1],
    c: matrix[4],
    d: matrix[5],
    e: matrix[12],
    f: matrix[13],
  };
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

function packedCadColor(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function indexedCadColor(value) {
  const index = Math.abs(Number(value));
  return Number.isInteger(index) && index > 0 && index < ACI_COLORS.length
    ? packedCadColor(ACI_COLORS[index])
    : null;
}

function effectiveEntityStyle(viewer, item) {
  const entity = item.entity;
  const layer = viewer.layerByName.get(item.layer ?? entity.__layer);
  const blockStyle = item.blockStyle;
  const authoredLineType = String(entity.lineType ?? "BYLAYER");
  const lineTypeName = authoredLineType.toUpperCase() === "BYLAYER"
    ? String(layer?.lineType ?? "CONTINUOUS")
    : authoredLineType.toUpperCase() === "BYBLOCK"
    ? blockStyle?.lineTypeName ?? "CONTINUOUS"
    : authoredLineType;
  const lineType = viewer.lineTypeByName.get(lineTypeName.toUpperCase());
  const entityWeight = finite(
    entity.lineWeightValue ?? entity.lineWeight,
    -1,
  );
  const lineWeight = entityWeight >= 0
    ? entityWeight
    : entityWeight === -2 && blockStyle
    ? blockStyle.lineWeight
    : finite(layer?.lineWeight, -1);
  const colorByBlock = entity.colorByBlock === true ||
    (entity.colorIndex !== null && entity.colorIndex !== undefined &&
      Number(entity.colorIndex) === 0);
  const color = colorByBlock
    ? blockStyle?.color ?? packedCadColor(ACI_COLORS[7])
    : (Array.isArray(entity.color) ? entity.color : null) ??
      (Array.isArray(entity.trueColor)
        ? entity.trueColor
        : packedCadColor(entity.trueColor)) ??
      indexedCadColor(entity.colorIndex) ??
      (Array.isArray(layer?.color) ? layer.color : null) ??
      (Array.isArray(layer?.trueColor)
        ? layer.trueColor
        : packedCadColor(layer?.trueColor)) ??
      indexedCadColor(layer?.colorIndex);
  const transparency = finite(
    entity.transparency,
    finite(layer?.transparency, 0),
  );
  const roleColor = viewer.shop?.enabled ? ROLE_COLORS[item.role] : null;
  return {
    layer,
    lineType,
    lineTypeName,
    lineWeight,
    color: roleColor ?? color,
    transparency,
  };
}

function colorLuminance(channels) {
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function cadColor(value, fallback, background = "#f8fafc") {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const channels = value.slice(0, 3).map((channel) =>
    Math.max(0, Math.min(255, Math.trunc(finite(channel, 0))))
  );
  const authoredHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background)?.[1];
  const backgroundHex = authoredHex?.length === 3
    ? [...authoredHex].map((channel) => channel + channel).join("")
    : authoredHex ?? "f8fafc";
  const backgroundChannels = [0, 2, 4].map((offset) =>
    Number.parseInt(backgroundHex.slice(offset, offset + 2), 16)
  );
  const backgroundLuminance = colorLuminance(backgroundChannels);
  // ACI 7 and true white are the drawing foreground: black on light paper.
  if (backgroundLuminance >= 0.5 && channels.every((value) => value === 255)) {
    return "rgb(0, 0, 0)";
  }
  const luminance = colorLuminance(channels);
  const contrast = (Math.max(luminance, backgroundLuminance) + 0.05) /
    (Math.min(luminance, backgroundLuminance) + 0.05);
  if (contrast < 4.5) {
    const target = backgroundLuminance >= 0.5 ? 0 : 255;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 10; step += 1) {
      const blend = (low + high) / 2;
      const adjusted = channels.map((channel) =>
        Math.round(channel + (target - channel) * blend)
      );
      const adjustedLuminance = colorLuminance(adjusted);
      const adjustedContrast =
        (Math.max(adjustedLuminance, backgroundLuminance) + 0.05) /
        (Math.min(adjustedLuminance, backgroundLuminance) + 0.05);
      if (adjustedContrast >= 4.5) high = blend;
      else low = blend;
    }
    for (let index = 0; index < 3; index += 1) {
      channels[index] = Math.round(
        channels[index] +
          (target - channels[index]) * high,
      );
    }
  }
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

function isAttributeDefinition(type) {
  return type === "attdef" || type === "attribute_definition";
}

function isThreeDimensionalModelerEntity(entity) {
  return entity.__type.includes("3dsolid") || entity.__type === "body" ||
    entity.__type.includes("surface");
}

function cadSpecialCharacters(value) {
  return value
    .replace(/%%d/gi, "°")
    .replace(/%%p/gi, "±")
    .replace(/%%c/gi, "⌀")
    .replace(/%%[uo]/gi, "")
    .replace(/%%(\d{3})/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/%%%/g, "%");
}

function plainCadText(value) {
  return mtextLines(value, 1).map((line) => line.text).join("\n");
}

// Parses MTEXT inline formatting into display lines. Only codes that change
// what is visible or how tall it is are interpreted; font, color, tracking and
// paragraph codes are consumed so their arguments never render as text.
function mtextLines(value, baseHeight) {
  const text = String(value ?? "");
  const lines = [];
  const heights = [];
  let height = baseHeight;
  let line = { text: "", height: 0 };
  const append = (characters) => {
    line.text += characters;
    line.height = Math.max(line.height, height);
  };
  const finishLine = () => {
    lines.push({
      text: cadSpecialCharacters(line.text),
      height: line.height || height,
    });
    line = { text: "", height: 0 };
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") {
      heights.push(height);
    } else if (character === "}") {
      if (heights.length > 0) height = heights.pop();
    } else if (character === "\n") {
      finishLine();
    } else if (character !== "\\") {
      append(character);
    } else {
      const code = text[index + 1] ?? "";
      index += 1;
      if (code === "P" || code === "X") {
        finishLine();
      } else if (code === "~") {
        append(" ");
      } else if (code === "\\" || code === "{" || code === "}") {
        append(code);
      } else if (
        code === "U" && /^\+[0-9A-F]{4}/i.test(text.slice(index + 1))
      ) {
        append(
          String.fromCodePoint(
            Number.parseInt(text.slice(index + 2, index + 6), 16),
          ),
        );
        index += 5;
      } else if ("ACFHQSTWcfp".includes(code) && code !== "") {
        const end = text.indexOf(";", index + 1);
        const argument = text.slice(index + 1, end < 0 ? text.length : end);
        if (code === "H") {
          const match = /^(\d*\.?\d+)(x?)$/i.exec(argument.trim());
          const authored = Number(match?.[1]);
          if (authored > 0) height = match[2] ? height * authored : authored;
        } else if (code === "S") {
          append(argument.replace(/[#^]/g, "/"));
        }
        index = end < 0 ? text.length : end;
      }
    }
  }
  finishLine();
  return lines;
}

function normalizedAlignment(value, names) {
  if (typeof value === "number") return names[value] ?? names[0];
  const name = String(value ?? "").toLowerCase();
  return names.find((candidate) => candidate.toLowerCase() === name) ??
    names[0];
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
      geometry: displayGeometry(entity),
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
        geometry: displayGeometry(entity),
        __key: entityKey(entity, index),
        __type: type,
        __layer: entityLayer(entity),
      };
    })
    : [];
}

function rasterCorners(geometry) {
  const origin = point(geometry.insertionPoint);
  const u = point(geometry.uVector);
  const v = point(geometry.vVector);
  const size = point(geometry.pixelSize);
  if (!origin || !u || !v || !size || size[0] <= 0 || size[1] <= 0) {
    return null;
  }
  const across = [u[0] * size[0], u[1] * size[0]];
  const up = [v[0] * size[1], v[1] * size[1]];
  return [
    origin,
    [origin[0] + across[0], origin[1] + across[1]],
    [origin[0] + across[0] + up[0], origin[1] + across[1] + up[1]],
    [origin[0] + up[0], origin[1] + up[1]],
  ];
}

// Approximate footprint of a TEXT/MTEXT/ATTRIB so text near the drawing
// edge is inside the opening view. Glyph widths are estimated, not measured.
function textExtentCorners(entity, geometry) {
  const type = entity.__type ?? entityType(entity);
  const authored = isAttributeDefinition(type)
    ? geometry.tag ?? geometry.text
    : geometry.text ?? entity.text;
  const height = finite(geometry.height, 0);
  if (typeof authored !== "string" || !authored || !(height > 0)) return null;
  const multiline = type.includes("mtext") || type.includes("multileader");
  const lines = multiline
    ? mtextLines(authored, height)
    : [{ text: authored, height }];
  const spacing = 5 / 3 * finite(geometry.lineSpacingFactor, 1);
  const widthFactor = finite(geometry.widthFactor, 1);
  const referenceWidth = multiline ? finite(geometry.referenceWidth, 0) : 0;
  let width = 0;
  let total = 0;
  let first = true;
  for (const line of lines) {
    const lineWidth = line.text.length * line.height * widthFactor;
    // Paragraphs wider than the MTEXT box wrap onto extra lines.
    const rows = referenceWidth > 0
      ? Math.max(1, Math.ceil(lineWidth / referenceWidth))
      : 1;
    width = Math.max(
      width,
      referenceWidth > 0 ? Math.min(lineWidth, referenceWidth) : lineWidth,
    );
    for (let row = 0; row < rows; row += 1) {
      total += first ? line.height : Math.max(height, line.height) * spacing;
      first = false;
    }
  }
  const horizontal = normalizedAlignment(
    geometry.horizontalAlignment,
    TEXT_HORIZONTAL_ALIGNMENTS,
  );
  const vertical = normalizedAlignment(
    geometry.verticalAlignment,
    TEXT_VERTICAL_ALIGNMENTS,
  );
  const attachment = normalizedAlignment(
    geometry.attachmentPoint,
    MTEXT_ATTACHMENTS,
  );
  const alignment = point(geometry.alignmentPoint);
  const usesAlignment = !multiline && alignment &&
    (horizontal !== "Left" || vertical !== "Baseline");
  const anchor = usesAlignment ? alignment : point(
    geometry.insertionPoint ?? geometry.textPosition ?? geometry.position,
  );
  if (!anchor) return null;
  const alignX = multiline
    ? attachment.endsWith("Center") ? 0.5 : attachment.endsWith("Right") ? 1 : 0
    : horizontal === "Center" || horizontal === "Middle"
    ? 0.5
    : horizontal === "Right"
    ? 1
    : 0;
  const alignY = multiline
    ? attachment.startsWith("Middle")
      ? 0.5
      : attachment.startsWith("Bottom")
      ? 0
      : 1
    : vertical === "Top"
    ? 1
    : vertical === "Middle" || horizontal === "Middle"
    ? 0.5
    : 0;
  const axis = point(geometry.xAxisDirection);
  const ocsAxis = point(geometry.ocsXAxis);
  const authoredRotation = finite(geometry.rotation, 0) *
    (geometry.angleUnit === "degrees" ? Math.PI / 180 : 1);
  const rotation = axis
    ? Math.atan2(axis[1], axis[0])
    : (ocsAxis ? Math.atan2(ocsAxis[1], ocsAxis[0]) : 0) + authoredRotation;
  const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)];
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const x = (u - alignX) * width;
    const y = (v - alignY) * total;
    return [anchor[0] + x * cos - y * sin, anchor[1] + x * sin + y * cos];
  });
}

function geometryPoints(entity) {
  const geometry = entity.geometry ?? entity;
  // Rays and construction lines are unbounded; like AutoCAD's zoom extents,
  // only their base point contributes to the drawing extents.
  if (geometry.infinite && point(geometry.direction)) {
    const base = point(geometry.basePoint);
    return base ? [base] : [];
  }
  const values = [
    ...(rasterCorners(geometry) ?? []),
    ...(textExtentCorners(entity, geometry) ?? []),
  ];
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
  const chain = (geometry.vertices ?? geometry.points ?? []).map((vertex) => ({
    value: point(vertex?.point ?? vertex),
    bulge: finite(vertex?.bulge, 0),
  })).filter((vertex) => vertex.value);
  for (const [index, vertex] of chain.entries()) {
    values.push(vertex.value);
    const next = chain[index + 1] ?? (geometry.closed ? chain[0] : null);
    if (!next || Math.abs(vertex.bulge) < 1e-12) continue;
    // A bulged segment is an arc; include its apex and the points where it
    // is widest so full-circle "donut" polylines stay inside the view.
    const [x0, y0] = vertex.value;
    const [x1, y1] = next.value;
    const chord = Math.hypot(x1 - x0, y1 - y0);
    if (chord < 1e-12) continue;
    const sagitta = vertex.bulge * chord / 2;
    const normal = [(y1 - y0) / chord, -(x1 - x0) / chord];
    const middle = [(x0 + x1) / 2, (y0 + y1) / 2];
    const radius = chord * (1 + vertex.bulge * vertex.bulge) /
      (4 * Math.abs(vertex.bulge));
    const center = [
      middle[0] + normal[0] * (sagitta - Math.sign(vertex.bulge) * radius),
      middle[1] + normal[1] * (sagitta - Math.sign(vertex.bulge) * radius),
    ];
    values.push([
      middle[0] + normal[0] * sagitta,
      middle[1] + normal[1] * sagitta,
    ]);
    if (Math.abs(vertex.bulge) > 1 - 1e-9) {
      values.push(
        [center[0] - radius, center[1] - radius],
        [center[0] + radius, center[1] + radius],
      );
    }
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
  const major = point(geometry.majorAxis);
  const ratio = finite(geometry.minorAxisRatio, 0);
  if (center && major && ratio > 0) {
    const halfX = Math.hypot(major[0], major[1] * ratio);
    const halfY = Math.hypot(major[1], major[0] * ratio);
    values.push([center[0] - halfX, center[1] - halfY]);
    values.push([center[0] + halfX, center[1] + halfY]);
  }
  const radius = finite(geometry.radius, -1);
  const arc = center && radius > 0 && arcSweep(geometry);
  if (arc) {
    // An arc's extent is its end points plus the quadrant points it
    // passes; its center and full circle can lie far outside the drawing.
    const xAxis = point(geometry.ocsXAxis) ?? [1, 0];
    const yAxis = point(geometry.ocsYAxis) ?? [0, 1];
    const at = (angle) => [
      center[0] +
      radius * (xAxis[0] * Math.cos(angle) + yAxis[0] * Math.sin(angle)),
      center[1] +
      radius * (xAxis[1] * Math.cos(angle) + yAxis[1] * Math.sin(angle)),
    ];
    const centerIndex = values.findIndex((value) =>
      value[0] === center[0] && value[1] === center[1]
    );
    if (centerIndex >= 0) values.splice(centerIndex, 1);
    values.push(at(arc.start), at(arc.start + arc.sweep));
    for (
      let quadrant = Math.ceil(arc.start / (Math.PI / 2)) * (Math.PI / 2);
      quadrant < arc.start + arc.sweep;
      quadrant += Math.PI / 2
    ) values.push(at(quadrant));
  } else if (center && radius > 0) {
    values.push([center[0] - radius, center[1] - radius]);
    values.push([center[0] + radius, center[1] + radius]);
  }
  return values;
}

function arcSweep(geometry) {
  const start = Number(geometry.startAngle ?? geometry.startAngleDegrees);
  const end = Number(geometry.endAngle ?? geometry.endAngleDegrees);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const factor = geometry.angleUnit === "radians" ? 1 : Math.PI / 180;
  let sweep = (end - start) * factor;
  while (sweep <= 0) sweep += Math.PI * 2;
  return { start: start * factor, sweep: Math.min(sweep, Math.PI * 2) };
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
  blockStyle = null,
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
        blockStyle,
        unresolvedBlock: String(geometry.blockName ?? ""),
      });
      return;
    }
    const insertStyle = effectiveEntityStyle(viewer, {
      entity,
      layer: effectiveLayer,
      blockStyle,
    });
    const childBlockStyle = {
      color: insertStyle.color,
      lineTypeName: insertStyle.lineTypeName,
      lineWeight: insertStyle.lineWeight,
    };
    const columns = Math.max(1, Math.trunc(finite(geometry.columns, 1)));
    const rows = Math.max(1, Math.trunc(finite(geometry.rows, 1)));
    const clipBoundary = geometry.clipEnabled === false
      ? []
      : (geometry.clipBoundary ?? []).map(point).filter(Boolean);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const childTransform = multiply(
          transform,
          insertTransform(geometry, child.basePoint, column, row),
        );
        let childClip = clip;
        if (clipBoundary.length >= 3) {
          // XCLIP boundaries are stored in block coordinates.
          const polygon = clipBoundary.map((value) =>
            transformPoint(childTransform, value)
          );
          childClip = {
            key: `${path}/${entity.__key}-${row}-${column}/xclip`,
            minX: Math.min(...polygon.map((value) => value[0])),
            minY: Math.min(...polygon.map((value) => value[1])),
            maxX: Math.max(...polygon.map((value) => value[0])),
            maxY: Math.max(...polygon.map((value) => value[1])),
            polygon,
            parent: clip,
          };
          // AutoCAD shows the clip frame on screen by default (XCLIPFRAME 2).
          output.push({
            entity: {
              ...entity,
              __type: "lwpolyline",
              geometry: { closed: true, vertices: polygon },
            },
            transform: identity,
            clip,
            path: `${childClip.key}/frame`,
            layer: effectiveLayer,
            blockStyle,
          });
        }
        expandBlock(
          viewer,
          child,
          childTransform,
          childClip,
          `${path}/${entity.__key}-${row}-${column}`,
          depth + 1,
          output,
          effectiveLayer,
          viewportHiddenLayers,
          childBlockStyle,
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
  // Inserted blocks show their ATTRIB values, never the ATTDEF templates.
  if (
    geometry.invisible === true ||
    (blockStyle && isAttributeDefinition(entity.__type))
  ) return;
  if (intersectsClip(entity, transform, clip)) {
    output.push({
      entity,
      transform,
      clip,
      path,
      layer: effectiveLayer,
      viewportHiddenLayers,
      blockStyle,
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
  blockStyle = null,
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
      blockStyle,
    );
  }
}

function appendXrefItems(viewer, output) {
  for (const occurrence of viewer.xrefOccurrences) {
    if (
      occurrence.rootViewKey !== viewer.viewKey ||
      occurrence.directVisible === false
    ) continue;
    const entity = viewer.entityByKey.get(String(occurrence.sourceEntityKey));
    const transform = xrefTransform(occurrence.composedTransform);
    if (!entity || entity.visible === false || !transform) continue;
    output.push({
      entity,
      transform,
      clip: null,
      path: occurrence.occurrenceKey,
      layer: entity.__layer,
    });
  }
  return output;
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
    return appendXrefItems(viewer, output);
  }
  const block = viewer.blockByKey.get(layout?.blockKey) ?? viewer.modelBlock;
  if (!block) {
    for (const entity of viewer.entities) {
      if (!layout && entity.paperSpace === true) continue;
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
    return appendXrefItems(viewer, output);
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
  return appendXrefItems(viewer, output);
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

// Fills polyline segments that carry a width (constant or tapered start/end
// widths), sampling bulge arcs, the way AutoCAD draws wide polylines.
function fillWidePolyline(context, viewer, transform, geometry) {
  const constant = Math.max(0, finite(geometry.constantWidth, 0));
  const values = (geometry.vertices ?? [])
    .map((vertex) => ({
      point: point(vertex?.point ?? vertex),
      bulge: finite(vertex?.bulge, 0),
      start: Math.max(0, finite(vertex?.startWidth, 0)) || constant,
      end: Math.max(0, finite(vertex?.endWidth, 0)) ||
        (finite(vertex?.startWidth, 0) > 0 ? 0 : constant),
    }))
    .filter((vertex) => vertex.point);
  const segmentCount = geometry.closed ? values.length : values.length - 1;
  let filled = false;
  for (let index = 0; index < segmentCount; index += 1) {
    const from = values[index];
    const to = values[(index + 1) % values.length];
    if (from.start <= 0 && from.end <= 0) continue;
    const dx = to.point[0] - from.point[0];
    const dy = to.point[1] - from.point[1];
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-12) continue;
    const samples = [];
    if (Math.abs(from.bulge) < 1e-12) {
      samples.push(from.point, to.point);
    } else {
      const sweep = 4 * Math.atan(from.bulge);
      const offset = chord * (1 - from.bulge * from.bulge) / (4 * from.bulge);
      const center = [
        (from.point[0] + to.point[0]) / 2 - dy / chord * offset,
        (from.point[1] + to.point[1]) / 2 + dx / chord * offset,
      ];
      const radius = Math.hypot(
        from.point[0] - center[0],
        from.point[1] - center[1],
      );
      const startAngle = Math.atan2(
        from.point[1] - center[1],
        from.point[0] - center[0],
      );
      const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
      for (let step = 0; step <= steps; step += 1) {
        const angle = startAngle + sweep * step / steps;
        samples.push([
          center[0] + radius * Math.cos(angle),
          center[1] + radius * Math.sin(angle),
        ]);
      }
    }
    const left = [];
    const right = [];
    for (const [sampleIndex, sample] of samples.entries()) {
      const previous = samples[Math.max(0, sampleIndex - 1)];
      const next = samples[Math.min(samples.length - 1, sampleIndex + 1)];
      const tangent = [next[0] - previous[0], next[1] - previous[1]];
      const length = Math.hypot(tangent[0], tangent[1]) || 1;
      const half = (from.start +
        (from.end - from.start) * sampleIndex / (samples.length - 1)) / 2;
      const normal = [-tangent[1] / length * half, tangent[0] / length * half];
      left.push([sample[0] + normal[0], sample[1] + normal[1]]);
      right.push([sample[0] - normal[0], sample[1] - normal[1]]);
    }
    context.beginPath();
    for (
      const [vertexIndex, vertex] of [...left, ...right.reverse()]
        .entries()
    ) {
      const placed = transformPoint(transform, vertex);
      const screen = worldToScreen(viewer, placed[0], placed[1]);
      if (vertexIndex === 0) context.moveTo(screen[0], screen[1]);
      else context.lineTo(screen[0], screen[1]);
    }
    context.closePath();
    context.fill();
    filled = true;
  }
  return filled;
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

function drawHatch(context, viewer, transform, geometry, selected, style) {
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
      : cadColor(style.color, "#172033", viewer.backgroundColor);
    if (!selected) {
      context.globalAlpha = 1 - style.transparency / 255;
    }
    context.fill("evenodd");
    context.globalAlpha = 1;
  }
  context.clip("evenodd");
  const points = loops.flat();
  const minX = Math.min(...points.map((value) => value[0]));
  const minY = Math.min(...points.map((value) => value[1]));
  const maxX = Math.max(...points.map((value) => value[0]));
  const maxY = Math.max(...points.map((value) => value[1]));
  const diagonal = Math.max(1, Math.hypot(maxX - minX, maxY - minY));
  // HATCH entities store pattern lines already rotated by the pattern angle
  // and scaled by the pattern scale; applying either again distorts them.
  context.strokeStyle = selected
    ? "#dc2626"
    : cadColor(style.color, "#172033", viewer.backgroundColor);
  context.globalAlpha = selected ? 1 : 1 - style.transparency / 255;
  context.lineWidth = selected ? 1.5 : 1;
  for (const pattern of geometry.patternLines ?? []) {
    const angle = finite(pattern.angle, 0) * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const normal = [-direction[1], direction[0]];
    const base = point(pattern.base) ?? [0, 0];
    const authoredOffset = point(pattern.offset) ?? [0, 0];
    const offset = authoredOffset;
    const step = offset[0] * normal[0] + offset[1] * normal[1];
    const stationaryPattern = Math.abs(step) <=
      Math.max(1e-12, Math.hypot(...offset) * 1e-9);
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
    const first = stationaryPattern
      ? 0
      : Math.floor(Math.min(minimum / step, maximum / step)) - 2;
    const last = stationaryPattern
      ? 0
      : Math.ceil(Math.max(minimum / step, maximum / step)) + 2;
    const scale = Math.hypot(transform.a, transform.b) * viewer.scale;
    const dashes = (pattern.dashes ?? []).map((value) =>
      Math.max(0.5, Math.abs(finite(value, 0)) * scale)
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

// Catmull-Rom curve through a spline leader's vertices.
function smoothLeaderPath(points) {
  if (points.length < 3) return points;
  const output = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const t2 = t * t;
      const t3 = t2 * t;
      output.push(
        [0, 1].map((axis) =>
          0.5 * (2 * p1[axis] + (p2[axis] - p0[axis]) * t +
            (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
            (3 * p1[axis] - p0[axis] - 3 * p2[axis] + p3[axis]) * t3)
        ),
      );
    }
  }
  return output;
}

function drawLeaderGeometry(context, viewer, transform, geometry) {
  const lines = Array.isArray(geometry.leaderLines)
    ? geometry.leaderLines
    : [{ points: geometry.points ?? geometry.vertices ?? [] }];
  const spline = /spline/i.test(String(geometry.pathType ?? ""));
  const arrowSize = finite(geometry.arrowSize, 0);
  const arrows = (geometry.arrowEnabled === true ||
    geometry.useArrowheads === true) && arrowSize > 0;
  for (const line of lines) {
    const points = (line.points ?? []).map(point).filter(Boolean);
    if (points.length < 2) continue;
    context.beginPath();
    drawPolyline(
      context,
      viewer,
      transform,
      spline ? smoothLeaderPath(points) : points,
      false,
    );
    context.stroke();
    if (!arrows) continue;
    // Closed filled arrowhead (AutoCAD's default) at the first vertex.
    const [tip, next] = points;
    const length = Math.hypot(next[0] - tip[0], next[1] - tip[1]);
    if (length < 1e-12) continue;
    const direction = [
      (next[0] - tip[0]) / length,
      (next[1] - tip[1]) / length,
    ];
    const base = [
      tip[0] + direction[0] * arrowSize,
      tip[1] + direction[1] * arrowSize,
    ];
    const half = arrowSize / 6;
    context.beginPath();
    drawPolyline(context, viewer, transform, [
      tip,
      [base[0] - direction[1] * half, base[1] + direction[0] * half],
      [base[0] + direction[1] * half, base[1] - direction[0] * half],
    ], true);
    context.fillStyle = context.strokeStyle;
    context.fill();
  }
}

function drawTable(context, viewer, transform, geometry, selected, style) {
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
  context.strokeStyle = selected
    ? "#dc2626"
    : cadColor(style.color, "#172033", viewer.backgroundColor);
  context.fillStyle = context.strokeStyle;
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

const TEXT_HORIZONTAL_ALIGNMENTS = [
  "Left",
  "Center",
  "Right",
  "Aligned",
  "Middle",
  "Fit",
];
const TEXT_VERTICAL_ALIGNMENTS = ["Baseline", "Bottom", "Middle", "Top"];
const MTEXT_ATTACHMENTS = [
  "TopLeft",
  "TopLeft",
  "TopCenter",
  "TopRight",
  "MiddleLeft",
  "MiddleCenter",
  "MiddleRight",
  "BottomLeft",
  "BottomCenter",
  "BottomRight",
];

// CAD text height is the cap height; CSS font sizes are em sizes.
function capHeightRatio(viewer, context, family) {
  const cached = viewer.capHeightRatios.get(family);
  if (cached) return cached;
  context.font = `100px ${family}`;
  const measured = context.measureText("H").actualBoundingBoxAscent / 100;
  const ratio = Number.isFinite(measured) && measured > 0.4 && measured < 1
    ? measured
    : 0.72;
  viewer.capHeightRatios.set(family, ratio);
  return ratio;
}

function wrapTextLine(context, text, maxWidth) {
  if (!(maxWidth > 0) || context.measureText(text).width <= maxWidth) {
    return [text];
  }
  const wrapped = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  wrapped.push(current);
  return wrapped;
}

function drawCadText(context, viewer, item, geometry, type, style, selected) {
  const entity = item.entity;
  const transform = item.transform;
  const multiline = type.includes("mtext") || type.includes("multileader");
  const dimensionText = type.includes("dimension") &&
    !geometry.insertionPoint && Array.isArray(geometry.textPosition);
  const horizontal = normalizedAlignment(
    geometry.horizontalAlignment,
    TEXT_HORIZONTAL_ALIGNMENTS,
  );
  const vertical = normalizedAlignment(
    geometry.verticalAlignment,
    TEXT_VERTICAL_ALIGNMENTS,
  );
  const insertion = point(
    geometry.insertionPoint ?? geometry.textPosition ?? geometry.position,
  );
  const alignment = point(geometry.alignmentPoint);
  const usesAlignmentPoint = !multiline && alignment &&
    (horizontal !== "Left" || vertical !== "Baseline");
  const anchor = usesAlignmentPoint && horizontal !== "Aligned" &&
      horizontal !== "Fit"
    ? alignment
    : insertion;
  if (!anchor) return;
  const placed = transformPoint(transform, anchor);
  const screen = worldToScreen(viewer, placed[0], placed[1]);
  const textAxis = point(geometry.xAxisDirection);
  const ocsAxis = point(geometry.ocsXAxis);
  const ocsRotation = ocsAxis ? Math.atan2(ocsAxis[1], ocsAxis[0]) : 0;
  const authoredRotation = finite(geometry.rotation, 0);
  const stretched = usesAlignmentPoint &&
    (horizontal === "Aligned" || horizontal === "Fit") && insertion &&
    Math.hypot(alignment[0] - insertion[0], alignment[1] - insertion[1]) >
      1e-12;
  const rotation = stretched
    ? Math.atan2(alignment[1] - insertion[1], alignment[0] - insertion[0])
    : textAxis
    ? Math.atan2(textAxis[1], textAxis[0])
    : ocsRotation +
      (geometry.angleUnit === "degrees"
        ? authoredRotation * Math.PI / 180
        : authoredRotation);
  const directionStart = transformPoint(transform, [0, 0]);
  const directionEnd = transformPoint(transform, [
    Math.cos(rotation),
    Math.sin(rotation),
  ]);
  const screenRotation = Math.atan2(
    -(directionEnd[1] - directionStart[1]),
    directionEnd[0] - directionStart[0],
  );
  const textStyle = viewer.textStyleByName.get(
    String(geometry.textStyle ?? "STANDARD").toUpperCase(),
  );
  const fontName = String(
    textStyle?.trueTypeFont ?? textStyle?.primaryFont ?? "",
  ).replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/\u0022/g, "")
    .trim();
  const family = fontName ? `"${fontName}", sans-serif` : "sans-serif";
  const unitPixels = Math.hypot(transform.c, transform.d) * viewer.scale;
  const emPerCap = 1 / capHeightRatio(viewer, context, family);
  const widthFactor = Math.max(
    1e-6,
    finite(geometry.widthFactor, textStyle?.widthFactor ?? 1),
  );
  const authoredText = isAttributeDefinition(type)
    ? geometry.tag ?? geometry.text ?? ""
    : geometry.text ?? entity.text ?? "";
  const baseHeight = finite(geometry.height, 2);
  context.save();
  context.translate(screen[0], screen[1]);
  context.rotate(screenRotation);
  // A mirrored block reference, or text whose extrusion faces away from
  // the viewer, mirrors its glyphs: the baseline direction already follows
  // the transform, so flip the glyphs about it.
  const facesAway = finite(point3(geometry.normal, 1)?.[2], 1) < 0;
  if (
    (transform.a * transform.d - transform.b * transform.c < 0) !== facesAway
  ) {
    context.scale(1, -1);
  }
  context.fillStyle = selected
    ? "#dc2626"
    : cadColor(style.color, "#111827", viewer.backgroundColor);
  context.textBaseline = "alphabetic";
  const fontFor = (height) =>
    `${Math.max(3, height * unitPixels * emPerCap)}px ${family}`;
  if (!multiline) {
    const text = type === "text"
      ? cadSpecialCharacters(
        String(authoredText).replace(
          /\\U\+([0-9A-F]{4})/gi,
          (_, code) => String.fromCodePoint(Number.parseInt(code, 16)),
        ),
      )
      : mtextLines(authoredText, baseHeight).map((line) => line.text)
        .join(" ");
    let height = baseHeight;
    context.font = fontFor(height);
    let xScale = widthFactor;
    if (stretched) {
      const span = Math.hypot(
        alignment[0] - insertion[0],
        alignment[1] - insertion[1],
      ) * Math.hypot(transform.a, transform.b) * viewer.scale;
      const measured = Math.max(1e-6, context.measureText(text).width);
      if (horizontal === "Aligned") {
        height *= span / (measured * widthFactor);
        context.font = fontFor(height);
        xScale = span / Math.max(1e-6, context.measureText(text).width);
      } else {
        xScale = span / measured;
      }
    }
    const capPixels = height * unitPixels;
    context.textAlign = stretched || horizontal === "Left"
      ? "left"
      : horizontal === "Right"
      ? "right"
      : "center";
    const baselineY = dimensionText || horizontal === "Middle" ||
        vertical === "Middle"
      ? capPixels / 2
      : vertical === "Top"
      ? capPixels
      : vertical === "Bottom"
      ? -capPixels * 0.3
      : 0;
    context.scale(xScale, 1);
    context.fillText(text, 0, baselineY);
    context.restore();
    return;
  }
  const attachment = normalizedAlignment(
    geometry.attachmentPoint,
    MTEXT_ATTACHMENTS,
  );
  // AutoCAD pitches MTEXT lines at 5/3 of the initial text height; the
  // default "at least" style grows a line for taller inline heights.
  const spacing = 5 / 3 *
    Math.min(4, Math.max(0.25, finite(geometry.lineSpacingFactor, 1)));
  const exactSpacing = /exact|^2$/i.test(String(geometry.lineSpacingStyle));
  const wrapWidth = Math.max(0, finite(geometry.referenceWidth, 0)) *
    unitPixels / widthFactor;
  const lines = [];
  for (const line of mtextLines(authoredText, baseHeight)) {
    context.font = fontFor(line.height);
    for (const text of wrapTextLine(context, line.text, wrapWidth)) {
      lines.push({ text, height: line.height });
    }
  }
  while (lines.length > 1 && !lines.at(-1).text.trim()) lines.pop();
  const baselines = [];
  let baseline = 0;
  for (const [index, line] of lines.entries()) {
    baseline += index === 0
      ? line.height
      : (exactSpacing ? baseHeight : Math.max(baseHeight, line.height)) *
        spacing;
    baselines.push(baseline);
  }
  const top = attachment.startsWith("Middle")
    ? -baseline / 2
    : attachment.startsWith("Bottom")
    ? -baseline
    : 0;
  context.textAlign = attachment.endsWith("Center")
    ? "center"
    : attachment.endsWith("Right")
    ? "right"
    : "left";
  context.scale(widthFactor, 1);
  for (const [index, line] of lines.entries()) {
    context.font = fontFor(line.height);
    context.fillText(
      line.text,
      0,
      (top + baselines[index]) * unitPixels,
    );
  }
  context.restore();
}

function drawEntity(context, viewer, item, selected) {
  const entity = item.entity;
  const transform = item.transform;
  const geometry = entity.geometry ?? entity;
  const type = entity.__type;
  const style = effectiveEntityStyle(viewer, item);
  if (item.clip) {
    context.save();
    // Nested clips (an XCLIPped block seen through a paper viewport)
    // intersect: each clip() narrows the current clipping region.
    for (let clip = item.clip; clip; clip = clip.parent) {
      context.beginPath();
      if (Array.isArray(clip.polygon) && clip.polygon.length >= 3) {
        clip.polygon.forEach((value, index) => {
          const screen = worldToScreen(viewer, value[0], value[1]);
          if (index === 0) context.moveTo(screen[0], screen[1]);
          else context.lineTo(screen[0], screen[1]);
        });
        context.closePath();
      } else {
        const min = worldToScreen(viewer, clip.minX, clip.minY);
        const max = worldToScreen(viewer, clip.maxX, clip.maxY);
        context.rect(min[0], max[1], max[0] - min[0], min[1] - max[1]);
      }
      context.clip("evenodd");
    }
  }
  if (type === "hatch") {
    drawHatch(context, viewer, transform, geometry, selected, style);
    if (item.clip) context.restore();
    return;
  }
  if (type.includes("multileader")) {
    context.strokeStyle = selected
      ? "#dc2626"
      : cadColor(style.color, "#172033", viewer.backgroundColor);
    context.lineWidth = selected ? 2 : 1.25;
    drawLeaderGeometry(context, viewer, transform, geometry);
  } else if (type === "leader") {
    context.strokeStyle = selected
      ? "#dc2626"
      : cadColor(style.color, "#172033", viewer.backgroundColor);
    context.lineWidth = selected ? 2 : 1.25;
    drawLeaderGeometry(context, viewer, transform, geometry);
    if (item.clip) context.restore();
    return;
  } else if (rasterCorners(geometry)) {
    // Referenced rasters are not bundled with the drawing; show the frame
    // AutoCAD draws for an unloaded image, labeled with its file name.
    const corners = rasterCorners(geometry);
    context.strokeStyle = selected
      ? "#dc2626"
      : cadColor(style.color, "#172033", viewer.backgroundColor);
    context.lineWidth = selected ? 2 : 1;
    context.beginPath();
    drawPolyline(context, viewer, transform, corners, true);
    context.stroke();
    const name = String(geometry.filePath ?? "").split(/[\\/]/).pop();
    if (name) {
      const placed = transformPoint(transform, corners[3]);
      const screen = worldToScreen(viewer, placed[0], placed[1]);
      context.fillStyle = context.strokeStyle;
      context.font = "12px sans-serif";
      context.textBaseline = "top";
      context.fillText(name, screen[0] + 4, screen[1] + 4);
      context.textBaseline = "alphabetic";
    }
    if (item.clip) context.restore();
    return;
  } else if (type === "table") {
    drawTable(context, viewer, transform, geometry, selected, style);
    if (item.clip) context.restore();
    return;
  } else if (type === "mesh" || geometry.meshType === "polyface") {
    const vertices = (geometry.vertices ?? []).map(point);
    context.strokeStyle = selected
      ? "#dc2626"
      : cadColor(style.color, "#172033", viewer.backgroundColor);
    context.lineWidth = selected ? 2 : 1;
    for (const face of geometry.faces ?? []) {
      const indices = Array.isArray(face) ? face : face.indices ?? [];
      const polygon = indices.map((index) => vertices[index]).filter(
        Boolean,
      );
      if (polygon.length < 2) continue;
      context.beginPath();
      if (Array.isArray(face)) {
        drawPolyline(context, viewer, transform, polygon, true);
      } else {
        for (let index = 0; index < indices.length; index += 1) {
          if (face.visibleEdges?.[index] === false) continue;
          const start = vertices[indices[index]];
          const end = vertices[indices[(index + 1) % indices.length]];
          if (start && end) {
            drawPolyline(context, viewer, transform, [start, end], false);
          }
        }
      }
      context.stroke();
    }
    if (item.clip) context.restore();
    return;
  }
  context.beginPath();
  if (geometry.infinite && point(geometry.direction)) {
    const base = point(geometry.basePoint);
    const tip = base && transformPoint(transform, [
      base[0] + point(geometry.direction)[0],
      base[1] + point(geometry.direction)[1],
    ]);
    const origin = base && transformPoint(transform, base);
    const length = origin && Math.hypot(tip[0] - origin[0], tip[1] - origin[1]);
    if (!origin || !(length > 0)) {
      if (item.clip) context.restore();
      return;
    }
    const direction = [
      (tip[0] - origin[0]) / length,
      (tip[1] - origin[1]) / length,
    ];
    const reach =
      Math.hypot(origin[0] - viewer.centerX, origin[1] - viewer.centerY) +
      Math.hypot(viewer.viewportWidth, viewer.viewportHeight) / viewer.scale;
    const back = geometry.infinite === "both" ? reach : 0;
    const start = worldToScreen(
      viewer,
      origin[0] - direction[0] * back,
      origin[1] - direction[1] * back,
    );
    const end = worldToScreen(
      viewer,
      origin[0] + direction[0] * reach,
      origin[1] + direction[1] * reach,
    );
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
  } else if (type === "face3d" || type === "3dface") {
    const corners = (geometry.corners ?? geometry.vertices ?? []).map(point)
      .filter(Boolean);
    const hidden = Math.trunc(finite(geometry.invisibleEdgeFlags, 0));
    for (let index = 0; index < corners.length; index += 1) {
      if (hidden & (1 << index)) continue;
      drawPolyline(
        context,
        viewer,
        transform,
        [corners[index], corners[(index + 1) % corners.length]],
        false,
      );
    }
  } else if (
    type.includes("line") && !type.includes("poly") &&
    !type.includes("leader") && !type.includes("spline")
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
    const { length, width } = slotSize(geometry);
    if (!center || length <= 0 || width <= 0) {
      if (item.clip) context.restore();
      return;
    }
    // A stadium: straight sides with half-circle ends (bulge 1).
    const angle = finite(geometry.angle, 0) * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const normal = [-direction[1], direction[0]];
    const half = (length - width) / 2;
    const at = (along, across) => [
      center[0] + direction[0] * along + normal[0] * across,
      center[1] + direction[1] * along + normal[1] * across,
    ];
    const vertices = [
      { point: at(-half, -width / 2), bulge: 0 },
      { point: at(half, -width / 2), bulge: 1 },
      { point: at(half, width / 2), bulge: 0 },
      { point: at(-half, width / 2), bulge: 1 },
    ];
    drawPolyline(context, viewer, transform, vertices, true);
  } else if (type.includes("poly") || Array.isArray(geometry.vertices)) {
    context.fillStyle = selected
      ? "#dc2626"
      : cadColor(style.color, "#172033", viewer.backgroundColor);
    fillWidePolyline(context, viewer, transform, geometry);
    context.beginPath();
    drawPolyline(
      context,
      viewer,
      transform,
      geometry.vertices ?? geometry.points,
      geometry.closed,
    );
  } else if (type.includes("contour") && Array.isArray(geometry.points)) {
    // NC1 contours carry bulges for radiused corners and round plates.
    drawPolyline(
      context,
      viewer,
      transform,
      geometry.vertices ?? geometry.points,
      true,
    );
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
    drawCadText(context, viewer, item, geometry, type, style, selected);
    if (item.clip) context.restore();
    return;
  } else {
    // Unsupported entities (helixes, multilines, proxies) have no drawable
    // geometry; a bounding box would read as real linework.
    const bounds = entity.viewerDisposition === "unsupported"
      ? null
      : entity.bounds;
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
  context.strokeStyle = selected
    ? "#dc2626"
    : cadColor(style.color, "#172033", viewer.backgroundColor);
  context.fillStyle = type.includes("wipeout")
    ? viewer.backgroundColor
    : selected
    ? "#dc2626"
    : cadColor(style.color, "#172033", viewer.backgroundColor);
  context.setLineDash(authoredDashPattern(viewer, item, style));
  context.globalAlpha = Math.max(0, Math.min(1, 1 - style.transparency / 255));
  context.lineWidth = selected
    ? 3
    : style.lineWeight >= 0
    ? Math.max(1, style.lineWeight / 100 * 96 / 25.4)
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
      item.entity.__key === viewer.selectedKey ||
        viewer.highlightKeys.has(item.entity.__key),
    );
  }
  drawShopOverlay(context, viewer);
  context.restore();
}

function openingBounds(viewer, items) {
  const bounds = calculateBounds(items);
  const layout = viewer.layouts.find((candidate) =>
    candidate.viewKey === viewer.viewKey
  );
  if (layout?.kind === "paper") {
    const paperItems = items.filter((item) => !item.clip);
    if (paperItems.length >= 10) {
      const paperBounds = calculateBounds(paperItems);
      const viewport = viewer.entityByKey.get(layout.paperViewportKey);
      const viewportMin = point(viewport?.bounds?.min);
      const viewportMax = point(viewport?.bounds?.max);
      if (viewportMin && viewportMax) {
        const viewportBounds = {
          minX: viewportMin[0],
          minY: viewportMin[1],
          maxX: viewportMax[0],
          maxY: viewportMax[1],
        };
        const paperArea = (paperBounds.maxX - paperBounds.minX) *
          (paperBounds.maxY - paperBounds.minY);
        const viewportArea = (viewportBounds.maxX - viewportBounds.minX) *
          (viewportBounds.maxY - viewportBounds.minY);
        if (viewportArea > 0 && viewportArea < paperArea / 2) {
          return viewportBounds;
        }
      }
      return paperBounds;
    }
  }
  if (items.length < 100) return bounds;
  const centers = items.map((item) => {
    const points = item.clip
      ? [[item.clip.minX, item.clip.minY], [item.clip.maxX, item.clip.maxY]]
      : itemPoints(item);
    if (points.length === 0) return null;
    let left = Infinity;
    let right = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;
    for (const [x, y] of points) {
      left = Math.min(left, x);
      right = Math.max(right, x);
      bottom = Math.min(bottom, y);
      top = Math.max(top, y);
    }
    if (![left, right, bottom, top].every(Number.isFinite)) return null;
    return {
      item,
      x: (left + right) / 2,
      y: (bottom + top) / 2,
    };
  }).filter(Boolean);
  if (centers.length < 100) return bounds;
  const xs = centers.map((entry) => entry.x).sort((a, b) => a - b);
  const ys = centers.map((entry) => entry.y).sort((a, b) => a - b);
  const xLow = xs[Math.floor(xs.length / 4)];
  const xHigh = xs[Math.floor(xs.length * 3 / 4)];
  const yLow = ys[Math.floor(ys.length / 4)];
  const yHigh = ys[Math.floor(ys.length * 3 / 4)];
  const xPadding = Math.max((xHigh - xLow) * 3, 1e-9);
  const yPadding = Math.max((yHigh - yLow) * 3, 1e-9);
  const mainItems = centers.filter((entry) =>
    entry.x >= xLow - xPadding && entry.x <= xHigh + xPadding &&
    entry.y >= yLow - yPadding && entry.y <= yHigh + yPadding
  ).map((entry) => entry.item);
  if (mainItems.length < centers.length / 2) return bounds;
  const result = calculateBounds(mainItems);
  return bounds.maxX - bounds.minX > 4 * (result.maxX - result.minX) ||
      bounds.maxY - bounds.minY > 4 * (result.maxY - result.minY)
    ? result
    : bounds;
}

function fitViewer(viewer, items = visibleItems(viewer), opening = false) {
  const shopBounds = viewer.shop?.enabled ? viewer.shop.bounds : null;
  const bounds = shopBounds ??
    (opening ? openingBounds(viewer, items) : calculateBounds(items));
  // Shop dimensions sit outside the part; leave room for them.
  const margin = shopBounds && viewer.showDimensions ? 56 : 0;
  const width = Math.max(1, viewer.canvas.clientWidth - margin * 2);
  const height = Math.max(1, viewer.canvas.clientHeight - margin * 2);
  const spanX = Math.max(1e-9, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-9, bounds.maxY - bounds.minY);
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

// Shop view: fabrication parts (plate DXFs, NC1 members) get overall
// dimensions, hole callouts, bend/bevel callouts, and tap-to-measure. Other
// drawings keep the plain CAD view.

const ROLE_COLORS = {
  etch: [5, 150, 105],
  bend: [37, 99, 235],
  bevel: [219, 39, 119],
  id: [124, 58, 237],
};
const SHOP_ACCENT = "#dc2626";
const MEASURE_COLOR = "#0284c7";
const LABEL_FONT =
  "600 12px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * NC1 slot size as yolm-fab reads it: centered, `length` overall, and the
 * hole diameter as the width when no width is authored.
 */
function slotSize(geometry) {
  const width = finite(geometry.width, 0) > 0
    ? finite(geometry.width, 0)
    : finite(geometry.diameter, 0);
  return { width, length: Math.max(finite(geometry.length, 0), width) };
}

function isTextType(type) {
  return type.includes("text") || type === "attrib" || type === "attribute";
}

function itemRole(viewer, item) {
  const entity = item.entity;
  const type = entity.__type;
  if (viewer.format === "dstv") {
    if (type === "bend") return "bend";
    if (type === "marking_text" || type === "scribe") return "etch";
    if (
      type === "hole" || type === "slot" || type.includes("contour")
    ) return "cut";
    return null;
  }
  const { fields } = parseFabData(entity.yolmFab);
  if (fields.direction !== undefined) return "bend";
  if (fields.side !== undefined) return "bevel";
  return layerRole(item.layer ?? entity.__layer);
}

function shopUnits(viewer) {
  return viewer.displayUnit === "mm" ? "mm" : "in";
}

function toMm(viewer, value) {
  return value * (viewer.shop?.mmPerUnit ?? 1);
}

function lengthText(viewer, value) {
  return formatLength(toMm(viewer, value), shopUnits(viewer));
}

function placedRadius(item, radius) {
  return radius * Math.hypot(item.transform.a, item.transform.b);
}

function analyzeShop(viewer) {
  const items = visibleItems(viewer);
  for (const item of viewer.items) item.role = itemRole(viewer, item);
  const { mmPerUnit, assumed } = sourceUnitScale(
    viewer.format,
    viewer.sourceUnitCode,
  );
  const layout = viewer.layouts.find((candidate) =>
    candidate.viewKey === viewer.viewKey
  );
  const face = viewer.viewKey?.startsWith("face:")
    ? viewer.viewKey.slice(5)
    : null;
  const roles = new Set(items.map((item) => item.role).filter(Boolean));
  // Only fabrication files: NC1, or DXFs whose layers or YOLM_FAB data say
  // what gets cut, scribed, bent or beveled. General drawings stay plain.
  const enabled = items.length > 0 && layout?.kind !== "paper" &&
    (viewer.format === "dstv" || roles.size > 0);
  const shop = {
    enabled,
    mmPerUnit,
    assumedUnits: assumed && viewer.format !== "dstv",
    face,
    bounds: null,
    outline: null,
    holes: [],
    holeGroups: [],
    marks: [],
  };
  viewer.shop = shop;
  viewer.snapPoints = null;
  if (!enabled) return shop;
  const geometryItems = items.filter((item) => !isTextType(item.entity.__type));
  const cutItems = geometryItems.filter((item) => item.role === "cut");
  let bounds = calculateBounds(cutItems.length > 0 ? cutItems : geometryItems);
  const header = viewer.dstvHeader;
  if (viewer.format === "dstv" && header) {
    const height = dstvFaceHeight(header, face);
    const length = Number(header.length);
    const hasContour = items.some((item) =>
      item.entity.__type === "outer_contour"
    );
    if (!hasContour && height && length > 0) {
      shop.outline = { minX: 0, minY: 0, maxX: length, maxY: height };
      bounds = {
        minX: Math.min(0, bounds.minX),
        minY: Math.min(0, bounds.minY),
        maxX: Math.max(length, bounds.maxX),
        maxY: Math.max(height, bounds.maxY),
      };
      if (geometryItems.length === 0) bounds = { ...shop.outline };
    }
  }
  shop.bounds = bounds;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  for (const item of geometryItems) {
    if (item.role === "etch" || item.role === "bend" || item.role === "bevel") {
      continue;
    }
    const type = item.entity.__type;
    const geometry = item.entity.geometry ?? item.entity;
    const center = point(geometry.center ?? geometry.position);
    if (!center) continue;
    if (type === "circle" || type === "hole") {
      const radius = placedRadius(
        item,
        finite(geometry.radius, finite(geometry.diameter, 0) / 2),
      );
      // A circle as large as the part is its outline, not a hole.
      if (radius <= 0 || radius * 2 >= span * 0.95) continue;
      shop.holes.push({
        key: item.entity.__key,
        center: transformPoint(item.transform, center),
        diameter: radius * 2,
      });
    } else if (type === "slot") {
      const { length, width } = slotSize(geometry);
      shop.holes.push({
        key: item.entity.__key,
        center: transformPoint(item.transform, center),
        diameter: width,
        length,
      });
    }
  }
  const groups = new Map();
  for (const hole of shop.holes) {
    const key = `${Math.round(toMm(viewer, hole.diameter) * 10)}:${
      Math.round(toMm(viewer, hole.length ?? 0) * 10)
    }`;
    const group = groups.get(key) ??
      { diameter: hole.diameter, length: hole.length ?? 0, keys: [] };
    group.keys.push(hole.key);
    groups.set(key, group);
  }
  shop.holeGroups = [...groups.values()].sort((left, right) =>
    left.diameter - right.diameter || left.length - right.length
  );
  const texts = items.filter((item) =>
    isTextType(item.entity.__type) && item.role !== "cut"
  );
  for (const item of geometryItems) {
    if (item.role !== "bend" && item.role !== "bevel") continue;
    const geometry = item.entity.geometry ?? item.entity;
    const start = point(geometry.start);
    const end = point(geometry.end);
    if (!start || !end) continue;
    const a = transformPoint(item.transform, start);
    const b = transformPoint(item.transform, end);
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let fabData = item.entity.yolmFab;
    if (viewer.format === "dstv") {
      fabData = [
        `angle=${finite(geometry.angle, NaN)}`,
        `radius=${finite(geometry.radius, NaN)}`,
      ];
    }
    let label = Array.isArray(fabData) && fabData.length > 0
      ? markLabel(item.role, fabData, mmPerUnit, shopUnits(viewer))
      : null;
    if (!label || label === "Bend" || label === "Bevel") {
      let nearest = null;
      let distance = span * 0.15;
      for (const text of texts) {
        const textGeometry = text.entity.geometry ?? text.entity;
        const at = point(
          textGeometry.insertionPoint ?? textGeometry.position,
        );
        if (!at) continue;
        const placed = transformPoint(text.transform, at);
        const candidate = Math.hypot(
          placed[0] - middle[0],
          placed[1] - middle[1],
        );
        if (candidate < distance) {
          nearest = text;
          distance = candidate;
        }
      }
      const text = nearest
        ? plainCadText(
          String((nearest.entity.geometry ?? nearest.entity).text ?? ""),
        ).trim()
        : "";
      label = text || (item.role === "bend" ? "Bend line" : "Bevel edge");
    }
    shop.marks.push({
      key: item.entity.__key,
      role: item.role,
      start: a,
      end: b,
      length: Math.hypot(b[0] - a[0], b[1] - a[1]),
      label,
    });
  }
  return shop;
}

function holeLabel(viewer, group) {
  const units = shopUnits(viewer);
  const width = formatLength(toMm(viewer, group.diameter), units);
  return group.length > 0
    ? `Slot ${width} × ${formatLength(toMm(viewer, group.length), units)}`
    : `Ø ${width}`;
}

function shopFacts(viewer) {
  const shop = viewer.shop;
  const facts = [];
  const header = viewer.dstvHeader;
  if (viewer.format === "dstv" && header) {
    const push = (label, value) => {
      if (value !== null && value !== undefined && String(value).trim()) {
        facts.push({ label, value: String(value).trim() });
      }
    };
    push("Mark", header.pieceMark);
    push("Profile", header.profile);
    push("Grade", header.grade);
    push("Quantity", header.quantity);
    push("Length", formatLength(Number(header.length), shopUnits(viewer)));
    for (
      const [label, value] of [
        ["Web start cut", header.webStartAngle],
        ["Web end cut", header.webEndAngle],
        ["Flange start cut", header.flangeStartAngle],
        ["Flange end cut", header.flangeEndAngle],
      ]
    ) {
      if (Number(value)) push(label, formatAngle(Number(value)));
    }
    if (shop.face) push("Face", dstvFaceLabel(shop.face, header.profileCode));
  } else if (shop.bounds) {
    facts.push({
      label: "Size",
      value: `${lengthText(viewer, shop.bounds.maxX - shop.bounds.minX)} × ${
        lengthText(viewer, shop.bounds.maxY - shop.bounds.minY)
      }`,
    });
  }
  facts.push({
    label: shop.face ? "Holes on this face" : "Holes",
    value: String(shop.holes.length),
  });
  if (shop.assumedUnits) {
    facts.push({ label: "Units", value: "Not set in file · read as inches" });
  }
  return facts;
}

function selectedItem(viewer) {
  return visibleItems(viewer).find((item) =>
    item.entity.__key === viewer.selectedKey
  ) ?? viewer.items.find((item) => item.entity.__key === viewer.selectedKey);
}

function positionRows(viewer, at) {
  const bounds = viewer.shop?.bounds;
  if (!bounds || !at) return [];
  return [
    { label: "From left", value: lengthText(viewer, at[0] - bounds.minX) },
    { label: "From bottom", value: lengthText(viewer, at[1] - bounds.minY) },
  ];
}

function describeSelection(viewer) {
  const item = selectedItem(viewer);
  if (!item) return null;
  const entity = item.entity;
  const type = entity.__type;
  const geometry = entity.geometry ?? entity;
  const units = shopUnits(viewer);
  const rows = [];
  let title = type.replaceAll("_", " ");
  const mark = viewer.shop?.marks.find((candidate) =>
    candidate.key === entity.__key
  );
  const hole = viewer.shop?.holes.find((candidate) =>
    candidate.key === entity.__key
  );
  if (mark) {
    title = mark.label;
    rows.push({ label: "Length", value: lengthText(viewer, mark.length) });
    const { fields, numbers } = parseFabData(entity.yolmFab);
    const angle = Number(fields.angle ?? numbers[0] ?? geometry.angle);
    if (Number.isFinite(angle)) {
      rows.push({ label: "Angle", value: formatAngle(angle) });
    }
    if (fields.side) rows.push({ label: "Side", value: fields.side });
    if (fields.direction) {
      rows.push({ label: "Direction", value: fields.direction });
    }
    const radius = Number(fields.inside_radius ?? fields.radius ?? NaN);
    if (Number.isFinite(radius) && radius > 0) {
      rows.push({ label: "Inside radius", value: lengthText(viewer, radius) });
    }
  } else if (hole) {
    const group = viewer.shop.holeGroups.find((candidate) =>
      candidate.keys.includes(hole.key)
    );
    title = group ? holeLabel(viewer, group) : "Hole";
    rows.push({
      label: hole.length ? "Width" : "Diameter",
      value: `${lengthText(viewer, hole.diameter)} (${
        formatDecimal(toMm(viewer, hole.diameter), units)
      })`,
    });
    if (hole.length) {
      rows.push({ label: "Length", value: lengthText(viewer, hole.length) });
    }
    rows.push(...positionRows(viewer, hole.center));
    if (group && group.keys.length > 1) {
      rows.push({ label: "Same size", value: `${group.keys.length} holes` });
    }
  } else if (type === "line") {
    const start = point(geometry.start);
    const end = point(geometry.end);
    if (start && end) {
      const a = transformPoint(item.transform, start);
      const b = transformPoint(item.transform, end);
      title = "Edge";
      rows.push({
        label: "Length",
        value: lengthText(viewer, Math.hypot(b[0] - a[0], b[1] - a[1])),
      });
      rows.push({
        label: "Angle",
        value: formatAngle(
          (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 360) % 180,
        ),
      });
    }
  } else if (type === "arc") {
    const sweep = arcSweep(geometry);
    const radius = placedRadius(item, finite(geometry.radius, 0));
    title = "Arc";
    rows.push({ label: "Radius", value: lengthText(viewer, radius) });
    if (sweep) {
      rows.push({
        label: "Sweep",
        value: formatAngle(sweep.sweep * 180 / Math.PI),
      });
      rows.push({
        label: "Arc length",
        value: lengthText(viewer, radius * sweep.sweep),
      });
    }
  } else if (isTextType(type)) {
    title = "Text";
    rows.push({
      label: "Text",
      value: plainCadText(String(geometry.text ?? entity.text ?? "")),
    });
  } else {
    const points = itemPoints(item);
    if (points.length > 1) {
      const bounds = calculateBounds([item]);
      rows.push({
        label: "Extents",
        value: `${lengthText(viewer, bounds.maxX - bounds.minX)} × ${
          lengthText(viewer, bounds.maxY - bounds.minY)
        }`,
      });
    }
  }
  rows.push({
    label: viewer.format === "dstv" ? "Face" : "Layer",
    value: viewer.format === "dstv"
      ? dstvFaceLabel(item.layer ?? entity.__layer)
      : String(item.layer ?? entity.__layer),
  });
  return { title, rows };
}

function measureRows(viewer) {
  const [a, b] = viewer.measure.points;
  if (!a || !b) return null;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const distance = Math.hypot(dx, dy);
  const units = shopUnits(viewer);
  return {
    text: lengthText(viewer, distance),
    rows: [
      {
        label: "Distance",
        value: `${lengthText(viewer, distance)} (${
          formatDecimal(toMm(viewer, distance), units)
        })`,
      },
      { label: "Across (X)", value: lengthText(viewer, Math.abs(dx)) },
      { label: "Up (Y)", value: lengthText(viewer, Math.abs(dy)) },
      {
        label: "Angle",
        value: formatAngle((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 180),
      },
    ],
  };
}

function shopPayload(viewer) {
  const shop = viewer.shop ?? { enabled: false };
  const header = viewer.dstvHeader;
  return {
    enabled: Boolean(shop.enabled),
    title: viewer.format === "dstv" && header
      ? [header.pieceMark, header.profile].filter((value) =>
        String(value ?? "").trim()
      ).join(" · ")
      : viewer.fileName,
    facts: shop.enabled ? shopFacts(viewer) : [],
    holeGroups: shop.enabled
      ? shop.holeGroups.map((group) => ({
        label: holeLabel(viewer, group),
        count: group.keys.length,
        keys: group.keys,
      }))
      : [],
    marks: shop.enabled
      ? shop.marks.map((mark) => ({
        key: mark.key,
        role: mark.role,
        label: mark.label,
      }))
      : [],
    details: describeSelection(viewer),
    measure: viewer.measure.active ? measureRows(viewer) : null,
    display: {
      units: shopUnits(viewer),
      dimensions: viewer.showDimensions,
      measuring: viewer.measure.active,
      narrow: viewer.viewportWidth < 640,
    },
  };
}

function emitShop(viewer) {
  emit("shopChanged", moduleResult(viewer.handle, shopPayload(viewer)));
}

function collectSnapPoints(viewer) {
  const points = [];
  const add = (item, value, kind) => {
    const source = point(value);
    if (source) {
      points.push({ at: transformPoint(item.transform, source), kind });
    }
  };
  for (const item of visibleItems(viewer)) {
    const type = item.entity.__type;
    if (isTextType(type)) continue;
    const geometry = item.entity.geometry ?? item.entity;
    if (type === "line") {
      add(item, geometry.start, "end");
      add(item, geometry.end, "end");
      const start = point(geometry.start);
      const end = point(geometry.end);
      if (start && end) {
        add(item, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], "mid");
      }
      continue;
    }
    const center = point(geometry.center ?? geometry.position);
    if (
      center && (finite(geometry.radius, 0) > 0 || type === "hole" ||
        type === "slot")
    ) {
      add(item, center, "center");
    }
    const chain = (geometry.vertices ?? geometry.points ?? []).map((
      vertex,
    ) => ({
      value: point(vertex?.point ?? vertex),
      bulge: finite(vertex?.bulge, 0),
    })).filter((vertex) => vertex.value);
    for (const [index, vertex] of chain.entries()) {
      add(item, vertex.value, "end");
      const next = chain[index + 1] ?? (geometry.closed ? chain[0] : null);
      if (next && Math.abs(vertex.bulge) < 1e-9) {
        add(item, [
          (vertex.value[0] + next.value[0]) / 2,
          (vertex.value[1] + next.value[1]) / 2,
        ], "mid");
      }
    }
  }
  const outline = viewer.shop?.outline;
  if (outline) {
    for (const x of [outline.minX, outline.maxX]) {
      for (const y of [outline.minY, outline.maxY]) {
        points.push({ at: [x, y], kind: "end" });
      }
    }
  }
  return points;
}

function snapPoint(viewer, screenX, screenY, radius) {
  viewer.snapPoints ??= collectSnapPoints(viewer);
  let best = null;
  let distance = radius;
  for (const candidate of viewer.snapPoints) {
    const screen = worldToScreen(viewer, candidate.at[0], candidate.at[1]);
    const candidateDistance = Math.hypot(
      screen[0] - screenX,
      screen[1] - screenY,
    );
    // Centers win ties: a hole center is what people measure to.
    const weighted = candidate.kind === "center"
      ? candidateDistance * 0.8
      : candidateDistance;
    if (weighted < distance) {
      best = candidate;
      distance = weighted;
    }
  }
  return best
    ? { at: best.at, kind: best.kind }
    : { at: screenToWorld(viewer, screenX, screenY), kind: null };
}

function overlaps(left, right) {
  return left.x < right.x + right.w && left.x + left.w > right.x &&
    left.y < right.y + right.h && left.y + left.h > right.y;
}

function drawLabel(context, text, x, y, options = {}) {
  context.font = LABEL_FONT;
  const width = context.measureText(text).width + 10;
  const height = 18;
  const anchorX = options.align === "left"
    ? x
    : options.align === "right"
    ? x - width
    : x - width / 2;
  const rect = { x: anchorX, y: y - height / 2, w: width, h: height };
  if (options.placed) {
    if (options.placed.some((placed) => overlaps(placed, rect))) return false;
    options.placed.push(rect);
  }
  context.save();
  context.fillStyle = options.background ?? "rgba(255, 255, 255, 0.92)";
  context.strokeStyle = options.color ?? "#334155";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  context.fill();
  context.stroke();
  context.fillStyle = options.color ?? "#0f172a";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, rect.x + rect.w / 2, y + 0.5);
  context.restore();
  return true;
}

function drawArrow(context, from, to) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const size = 6;
  context.beginPath();
  context.moveTo(to[0], to[1]);
  context.lineTo(
    to[0] - size * Math.cos(angle - 0.4),
    to[1] - size * Math.sin(angle - 0.4),
  );
  context.lineTo(
    to[0] - size * Math.cos(angle + 0.4),
    to[1] - size * Math.sin(angle + 0.4),
  );
  context.closePath();
  context.fill();
}

function drawShopDimensions(context, viewer, placed) {
  const bounds = viewer.shop.bounds;
  const min = worldToScreen(viewer, bounds.minX, bounds.minY);
  const max = worldToScreen(viewer, bounds.maxX, bounds.maxY);
  const left = min[0];
  const right = max[0];
  const top = max[1];
  const bottom = min[1];
  if (right - left < 48 && bottom - top < 48) return;
  context.save();
  context.strokeStyle = "#475569";
  context.fillStyle = "#475569";
  context.lineWidth = 1;
  const offset = 22;
  const y = bottom + offset;
  context.beginPath();
  context.moveTo(left, bottom + 4);
  context.lineTo(left, y + 4);
  context.moveTo(right, bottom + 4);
  context.lineTo(right, y + 4);
  context.moveTo(left, y);
  context.lineTo(right, y);
  context.stroke();
  drawArrow(context, [right, y], [left, y]);
  drawArrow(context, [left, y], [right, y]);
  const x = left - offset;
  context.beginPath();
  context.moveTo(left - 4, top);
  context.lineTo(x - 4, top);
  context.moveTo(left - 4, bottom);
  context.lineTo(x - 4, bottom);
  context.moveTo(x, top);
  context.lineTo(x, bottom);
  context.stroke();
  drawArrow(context, [x, bottom], [x, top]);
  drawArrow(context, [x, top], [x, bottom]);
  context.restore();
  drawLabel(
    context,
    lengthText(viewer, bounds.maxX - bounds.minX),
    (left + right) / 2,
    y,
    { placed, color: "#0f172a" },
  );
  context.save();
  context.translate(x, (top + bottom) / 2);
  context.rotate(-Math.PI / 2);
  drawLabel(context, lengthText(viewer, bounds.maxY - bounds.minY), 0, 0, {
    color: "#0f172a",
  });
  context.restore();
  placed.push({ x: x - 10, y: top, w: 20, h: bottom - top });
}

function drawShopOverlay(context, viewer) {
  const shop = viewer.shop;
  const placed = [];
  const measured = viewer.measure.active && viewer.measure.points.length === 2
    ? viewer.measure.points.map((value) =>
      worldToScreen(viewer, value[0], value[1])
    )
    : null;
  if (measured) {
    // The measurement outranks hole and mark labels.
    placed.push({
      x: (measured[0][0] + measured[1][0]) / 2 - 50,
      y: (measured[0][1] + measured[1][1]) / 2 - 24,
      w: 100,
      h: 20,
    });
  }
  if (shop?.enabled) {
    if (shop.outline) {
      const min = worldToScreen(viewer, shop.outline.minX, shop.outline.minY);
      const max = worldToScreen(viewer, shop.outline.maxX, shop.outline.maxY);
      context.save();
      context.strokeStyle = "#1e293b";
      context.lineWidth = 1.5;
      context.strokeRect(min[0], max[1], max[0] - min[0], min[1] - max[1]);
      context.restore();
    }
    for (const hole of shop.holes) {
      const center = worldToScreen(viewer, hole.center[0], hole.center[1]);
      if (hole.diameter / 2 * viewer.scale < 2.5) {
        // Holes smaller than a few pixels still show where they are.
        context.save();
        context.strokeStyle = "#334155";
        context.lineWidth = 1.25;
        context.beginPath();
        context.arc(center[0], center[1], 2.5, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      if (!viewer.highlightKeys.has(hole.key)) continue;
      context.save();
      context.strokeStyle = SHOP_ACCENT;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(
        center[0],
        center[1],
        Math.max(6, hole.diameter / 2 * viewer.scale + 4),
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.restore();
    }
    for (const mark of shop.marks) {
      // Bends dash, bevels draw solid: both read at arm's length.
      const a = worldToScreen(viewer, mark.start[0], mark.start[1]);
      const b = worldToScreen(viewer, mark.end[0], mark.end[1]);
      context.save();
      context.strokeStyle = mark.role === "bevel" ? "#db2777" : "#2563eb";
      context.lineWidth = mark.role === "bevel" ? 3.5 : 2.5;
      context.setLineDash(mark.role === "bevel" ? [] : [9, 5]);
      context.beginPath();
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.stroke();
      context.restore();
    }
    if (viewer.showDimensions) {
      drawShopDimensions(context, viewer, placed);
      for (const mark of shop.marks) {
        const a = worldToScreen(viewer, mark.start[0], mark.start[1]);
        const b = worldToScreen(viewer, mark.end[0], mark.end[1]);
        const color = mark.role === "bevel" ? "#be185d" : "#1d4ed8";
        drawLabel(context, mark.label, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, {
          placed,
          color,
          background: "rgba(255, 255, 255, 0.96)",
        });
      }
      for (const group of shop.holeGroups) {
        const text = holeLabel(viewer, group);
        for (const key of group.keys) {
          const hole = shop.holes.find((candidate) => candidate.key === key);
          const radius = hole.diameter / 2 * viewer.scale;
          if (radius < 2) continue;
          const center = worldToScreen(viewer, hole.center[0], hole.center[1]);
          const reach = radius * Math.SQRT1_2 + 3;
          drawLabel(context, text, center[0] + reach, center[1] - reach - 9, {
            placed,
            align: "left",
            color: "#334155",
          });
        }
      }
    }
  }
  const measure = viewer.measure;
  if (measure.active) {
    const points = measure.points.map((value) =>
      worldToScreen(viewer, value[0], value[1])
    );
    context.save();
    context.strokeStyle = MEASURE_COLOR;
    context.fillStyle = MEASURE_COLOR;
    context.lineWidth = 2;
    if (points.length === 2) {
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      context.lineTo(points[1][0], points[1][1]);
      context.stroke();
    }
    for (const value of points) {
      context.beginPath();
      context.arc(value[0], value[1], 4.5, 0, Math.PI * 2);
      context.fill();
    }
    if (measure.hover) {
      const at = worldToScreen(
        viewer,
        measure.hover.at[0],
        measure.hover.at[1],
      );
      context.lineWidth = 1.5;
      if (measure.hover.kind) context.strokeRect(at[0] - 6, at[1] - 6, 12, 12);
      else {
        context.beginPath();
        context.moveTo(at[0] - 8, at[1]);
        context.lineTo(at[0] + 8, at[1]);
        context.moveTo(at[0], at[1] - 8);
        context.lineTo(at[0], at[1] + 8);
        context.stroke();
      }
    }
    context.restore();
    if (points.length === 2) {
      drawLabel(
        context,
        measureRows(viewer).text,
        (points[0][0] + points[1][0]) / 2,
        (points[0][1] + points[1][1]) / 2 - 14,
        { color: MEASURE_COLOR, background: "rgba(255, 255, 255, 0.97)" },
      );
    }
  }
}

function zoomAt(viewer, screenX, screenY, factor) {
  viewer.userMoved = true;
  const before = screenToWorld(viewer, screenX, screenY);
  viewer.scale = Math.min(1e9, Math.max(1e-9, viewer.scale * factor));
  const after = screenToWorld(viewer, screenX, screenY);
  viewer.centerX += before[0] - after[0];
  viewer.centerY += before[1] - after[1];
}

function selectAt(viewer, screenX, screenY, tolerancePx) {
  const world = screenToWorld(viewer, screenX, screenY);
  const tolerance = tolerancePx / viewer.scale;
  let selected = null;
  let distance = tolerance;
  for (const item of visibleItems(viewer)) {
    const candidate = distanceToItem(item, world);
    if (candidate <= distance) {
      selected = item.entity;
      distance = candidate;
    }
  }
  // Inside a hole counts as the hole: fingers land on the middle.
  if (!selected && viewer.shop?.enabled) {
    for (const hole of viewer.shop.holes) {
      const reach = Math.hypot(
        hole.center[0] - world[0],
        hole.center[1] - world[1],
      );
      if (reach <= hole.diameter / 2 + tolerance) {
        selected = viewer.entityByKey.get(hole.key) ?? null;
        break;
      }
    }
  }
  viewer.selectedKey = selected?.__key ?? null;
  viewer.highlightKeys = new Set();
  render(viewer);
  emit(
    "selectionChanged",
    moduleResult(viewer.handle, selectionPayload(viewer)),
  );
  emitShop(viewer);
}

function bindInput(viewer) {
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;
  const local = (event) => {
    const rect = viewer.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const touchLike = (event) => event.pointerType !== "mouse";
  const pinchState = () => {
    const [first, second] = [...pointers.values()];
    return {
      distance: Math.max(
        1,
        Math.hypot(second[0] - first[0], second[1] - first[1]),
      ),
      middle: [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2],
    };
  };
  viewer.canvas.addEventListener("pointerdown", (event) => {
    try {
      viewer.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) {
      const at = local(event);
      gesture = {
        mode: "pan",
        start: at,
        last: at,
        moved: false,
        touch: touchLike(event),
      };
    } else if (pointers.size === 2) {
      gesture = { mode: "pinch", ...pinchState(), moved: true };
    }
  });
  viewer.canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      if (viewer.measure.active && event.pointerType === "mouse") {
        const at = local(event);
        viewer.measure.hover = snapPoint(viewer, at[0], at[1], 14);
        render(viewer);
      }
      return;
    }
    pointers.set(event.pointerId, local(event));
    if (!gesture) return;
    if (gesture.mode === "pinch" && pointers.size >= 2) {
      const next = pinchState();
      zoomAt(
        viewer,
        gesture.middle[0],
        gesture.middle[1],
        next.distance / gesture.distance,
      );
      viewer.centerX -= (next.middle[0] - gesture.middle[0]) / viewer.scale;
      viewer.centerY += (next.middle[1] - gesture.middle[1]) / viewer.scale;
      gesture.distance = next.distance;
      gesture.middle = next.middle;
      render(viewer);
      return;
    }
    if (gesture.mode !== "pan") return;
    const at = local(event);
    if (
      Math.hypot(at[0] - gesture.start[0], at[1] - gesture.start[1]) >
        (gesture.touch ? 8 : 3)
    ) gesture.moved = true;
    if (!gesture.moved) return;
    viewer.userMoved = true;
    viewer.centerX -= (at[0] - gesture.last[0]) / viewer.scale;
    viewer.centerY += (at[1] - gesture.last[1]) / viewer.scale;
    gesture.last = at;
    render(viewer);
  });
  const release = (event, cancelled) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    const previous = gesture;
    if (pointers.size === 1 && previous?.mode === "pinch") {
      // Lifting one finger of a pinch continues as a pan, never a tap.
      const remaining = [...pointers.values()][0];
      gesture = {
        mode: "pan",
        start: remaining,
        last: remaining,
        moved: true,
        touch: true,
      };
      return;
    }
    if (pointers.size > 0) return;
    gesture = null;
    if (cancelled || !previous || previous.mode !== "pan" || previous.moved) {
      return;
    }
    const at = previous.start;
    const now = Date.now();
    if (
      previous.touch && !viewer.measure.active && lastTap &&
      now - lastTap.time < 320 &&
      Math.hypot(at[0] - lastTap.at[0], at[1] - lastTap.at[1]) < 30
    ) {
      lastTap = null;
      zoomAt(viewer, at[0], at[1], 2);
      render(viewer);
      return;
    }
    lastTap = { time: now, at };
    if (viewer.measure.active) {
      const snapped = snapPoint(viewer, at[0], at[1], previous.touch ? 28 : 14);
      viewer.measure.points = viewer.measure.points.length >= 2
        ? [snapped.at]
        : [...viewer.measure.points, snapped.at];
      viewer.measure.hover = snapped;
      render(viewer);
      emitShop(viewer);
      return;
    }
    selectAt(viewer, at[0], at[1], previous.touch ? 22 : 10);
  };
  viewer.canvas.addEventListener("pointerup", (event) => release(event, false));
  viewer.canvas.addEventListener(
    "pointercancel",
    (event) => release(event, true),
  );
  viewer.canvas.addEventListener("dblclick", (event) => {
    const at = local(event);
    zoomAt(viewer, at[0], at[1], 2);
    render(viewer);
  });
  viewer.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const at = local(event);
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const rate = event.ctrlKey ? 0.01 : 0.001;
    zoomAt(viewer, at[0], at[1], Math.exp(-event.deltaY * rate));
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
    capHeightRatios: new Map(),
    modelBlock: null,
    paperViewportKey: null,
    items: [],
    visibleLayers: new Set(),
    viewKey: data.viewKey ?? null,
    selectedKey: data.objectKey ?? null,
    highlightKeys: new Set(),
    displayUnit: data.displayUnit === "mm" ? "mm" : "in",
    showDimensions: data.dimensions !== false,
    measure: { active: false, points: [], hover: null },
    shop: null,
    snapPoints: null,
    userMoved: false,
    dstvHeader: null,
    sourceUnitCode: null,
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
  // Until someone pans or zooms, keep the part fitted as panels open and
  // phones rotate.
  viewer.observer = new ResizeObserver(() => {
    if (viewer.userMoved || viewer.items.length === 0) render(viewer);
    else fitViewer(viewer, visibleItems(viewer), true);
  });
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
    if (scene.schemaVersion !== 1 && scene.schemaVersion !== 2) {
      throw new Error(`Unsupported CAD scene schema: ${scene.schemaVersion}`);
    }
    viewer.entities = normalizedEntities(scene);
    viewer.xrefSourceEntities = Array.isArray(scene.xrefSourceEntities)
      ? normalizedEntities({ entities: scene.xrefSourceEntities })
      : [];
    viewer.xrefOccurrences = Array.isArray(scene.xrefEntityOccurrences)
      ? scene.xrefEntityOccurrences
      : [];
    viewer.layers = [
      ...(Array.isArray(scene.layers) ? scene.layers : []),
      ...(Array.isArray(scene.xrefLayers) ? scene.xrefLayers : []),
    ];
    viewer.blocks = Array.isArray(scene.blocks)
      ? scene.blocks.map((block) => ({
        ...block,
        __entities: normalizedBlockEntities(block),
      }))
      : [];
    viewer.layouts = Array.isArray(scene.layouts) ? scene.layouts : [];
    if (viewer.format === "dstv") {
      // NC1 faces read as shop names (Top flange · o) in the face menu.
      viewer.layouts = viewer.layouts.map((layout) =>
        String(layout.viewKey ?? "").startsWith("face:")
          ? {
            ...layout,
            name: dstvFaceLabel(
              layout.viewKey.slice(5),
              scene.header?.profileCode,
            ),
          }
          : layout
      );
    }
    viewer.dstvHeader = scene.header ?? null;
    viewer.sourceUnitCode = scene.sourceUnitCode ?? null;
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
      ...viewer.xrefSourceEntities,
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
    // R12 files have no layouts and an empty $MODEL_SPACE block; their
    // model entities are top-level only, so fall back to those.
    viewer.modelBlock = viewer.blockByKey.get(modelLayout?.blockKey) ??
      viewer.blocks.find((block) =>
        String(block.name).toUpperCase().includes("MODEL_SPACE") &&
        blockEntities(viewer, block).length > 0
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
    analyzeShop(viewer);
    fitViewer(viewer, visibleItems(viewer), true);
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
    emitShop(viewer);
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
  viewer.userMoved = false;
  fitViewer(viewer);
  return { json: getState(args).json };
}

export function zoom(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  viewer.userMoved = true;
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
  viewer.userMoved = false;
  viewer.measure.points = [];
  viewer.highlightKeys = new Set();
  analyzeShop(viewer);
  fitViewer(viewer, visibleItems(viewer), true);
  emit("stateChanged", moduleResult(viewer.handle, getState(args).json));
  emitShop(viewer);
  return { json: getState(args).json };
}

export function setLayerVisibility(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  if (data.visible) viewer.visibleLayers.add(String(data.layer));
  else viewer.visibleLayers.delete(String(data.layer));
  analyzeShop(viewer);
  fitViewer(viewer);
  emit("stateChanged", moduleResult(viewer.handle, getState(args).json));
  emitShop(viewer);
  return { json: getState(args).json };
}

export function setLayerVisibilityBatch(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  for (const layer of data.layers ?? []) {
    if (layer.visible) viewer.visibleLayers.add(String(layer.name));
    else viewer.visibleLayers.delete(String(layer.name));
  }
  analyzeShop(viewer);
  fitViewer(viewer);
  emit("stateChanged", moduleResult(viewer.handle, getState(args).json));
  emitShop(viewer);
  return { json: getState(args).json };
}

export function focusObject(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  const entity = viewer.entityByKey.get(String(data.objectKey));
  if (!entity) return { json: { found: false } };
  viewer.selectedKey = entity.__key;
  viewer.highlightKeys = new Set();
  const matchingItems = viewer.items.filter((item) =>
    item.entity.__key === entity.__key
  );
  if (matchingItems.length === 0) {
    render(viewer);
    return { json: { found: true, ...selectionPayload(viewer) } };
  }
  const bounds = calculateBounds(matchingItems);
  viewer.userMoved = true;
  viewer.centerX = (bounds.minX + bounds.maxX) / 2;
  viewer.centerY = (bounds.minY + bounds.maxY) / 2;
  render(viewer);
  emit(
    "selectionChanged",
    moduleResult(viewer.handle, selectionPayload(viewer)),
  );
  emitShop(viewer);
  return { json: { found: true, ...selectionPayload(viewer) } };
}

/** Units, shop dimensions and measuring; each field is optional. */
export function setDisplay(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  if (data.units === "in" || data.units === "mm") {
    viewer.displayUnit = data.units;
    analyzeShop(viewer);
  }
  if (typeof data.dimensions === "boolean") {
    viewer.showDimensions = data.dimensions;
  }
  if (typeof data.measuring === "boolean") {
    viewer.measure = { active: data.measuring, points: [], hover: null };
    if (data.measuring) {
      viewer.selectedKey = null;
      viewer.highlightKeys = new Set();
    }
    viewer.canvas.style.cursor = data.measuring ? "crosshair" : "";
  }
  render(viewer);
  emitShop(viewer);
  return { json: shopPayload(viewer) };
}

/** Selects a set of objects (a hole size group) and brings them into view. */
export function selectObjects(args) {
  const data = parseArgs(args);
  const viewer = requireViewer(args?.handle || data.handle);
  const keys = (Array.isArray(data.objectKeys) ? data.objectKeys : [])
    .map(String)
    .filter((key) => viewer.entityByKey.has(key));
  viewer.highlightKeys = new Set(keys);
  viewer.selectedKey = keys[0] ?? null;
  const matching = viewer.items.filter((item) =>
    viewer.highlightKeys.has(item.entity.__key)
  );
  if (matching.length > 0) {
    const bounds = calculateBounds(matching);
    const min = worldToScreen(viewer, bounds.minX, bounds.minY);
    const max = worldToScreen(viewer, bounds.maxX, bounds.maxY);
    const inside = min[0] >= 0 && max[0] <= viewer.viewportWidth &&
      max[1] >= 0 && min[1] <= viewer.viewportHeight;
    if (!inside) {
      viewer.userMoved = true;
      viewer.centerX = (bounds.minX + bounds.maxX) / 2;
      viewer.centerY = (bounds.minY + bounds.maxY) / 2;
    }
  }
  render(viewer);
  emit(
    "selectionChanged",
    moduleResult(viewer.handle, selectionPayload(viewer)),
  );
  emitShop(viewer);
  return { json: shopPayload(viewer) };
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
    scale: viewer.scale,
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
  setDisplay,
  selectObjects,
  getState,
  cleanup,
});

function requireViewer(handle) {
  const viewer = viewers.get(handle);
  if (!viewer) throw new Error(`CAD 2D viewer not initialized: ${handle}`);
  return viewer;
}
