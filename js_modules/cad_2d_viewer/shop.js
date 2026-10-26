// Shop-floor reading of fabrication drawings: units, mark labels, layer roles.
// Pure helpers; geometry and drawing stay in index.js.

// DXF $INSUNITS codes to millimetres. 0 (unitless) is reported as assumed
// inches by the caller: plate files without units are authored in inches.
const DXF_UNIT_MM = {
  1: 25.4,
  2: 304.8,
  3: 1609344,
  4: 1,
  5: 10,
  6: 1000,
  8: 25.4e-6,
  9: 25.4e-3,
  10: 914.4,
  14: 100,
};

/** Millimetres per drawing unit, and whether the unit was assumed. */
export function sourceUnitScale(format, sourceUnitCode) {
  if (format === "dstv" || sourceUnitCode === "mm") {
    return { mmPerUnit: 1, assumed: false };
  }
  const scale = DXF_UNIT_MM[Number(sourceUnitCode)];
  return scale
    ? { mmPerUnit: scale, assumed: false }
    : { mmPerUnit: 25.4, assumed: true };
}

function fractionInches(inches) {
  const sixteenths = Math.round(Math.abs(inches) * 16);
  const whole = Math.floor(sixteenths / 16);
  let numerator = sixteenths % 16;
  let denominator = 16;
  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const fraction = numerator > 0 ? `${numerator}/${denominator}` : "";
  if (whole === 0 && fraction) return fraction;
  return fraction ? `${whole} ${fraction}` : String(whole);
}

/**
 * Shop length: fractional inches to 1/16 (feet-inches from 10 ft up), or
 * millimetres.
 */
export function formatLength(mm, unit = "in") {
  if (!Number.isFinite(mm)) return "";
  const sign = mm < 0 ? "-" : "";
  if (unit === "mm") {
    const value = Math.abs(mm);
    return `${sign}${
      value >= 1000 ? Math.round(value) : Number(value.toFixed(1))
    } mm`;
  }
  const inches = Math.abs(mm) / 25.4;
  if (inches >= 120) {
    const sixteenths = Math.round(inches * 16);
    const feet = Math.floor(sixteenths / (12 * 16));
    const rest = (sixteenths - feet * 12 * 16) / 16;
    return `${sign}${feet}'-${fractionInches(rest)}"`;
  }
  return `${sign}${fractionInches(inches)}"`;
}

/** Decimal companion for a fractional length, e.g. 13.375". */
export function formatDecimal(mm, unit = "in") {
  if (!Number.isFinite(mm)) return "";
  return unit === "mm"
    ? `${Number(mm.toFixed(2))} mm`
    : `${(mm / 25.4).toFixed(3)}"`;
}

export function formatAngle(degrees) {
  if (!Number.isFinite(degrees)) return "";
  return `${Number(degrees.toFixed(1))}°`;
}

/**
 * Semantic role of a fabrication layer. Covers the yolm-fab plate layers
 * (CUT_OUTER, ETCH, BEND, BEVEL, PART_ID) and common fabrication layer names.
 */
export function layerRole(name) {
  const value = String(name ?? "").toLowerCase();
  if (/bevel|weld.?prep/.test(value)) return "bevel";
  if (/bend|brake|fold/.test(value)) return "bend";
  if (/part.?id|piece.?mark/.test(value)) return "id";
  if (/scribe|etch|mark/.test(value)) return "etch";
  if (/plasma|laser|burn|cut|outer|inner|profile|contour/.test(value)) {
    return "cut";
  }
  return null;
}

/** YOLM_FAB XDATA items: `key=value` strings plus bare numbers in order. */
export function parseFabData(values) {
  const fields = {};
  const numbers = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === "number") {
      numbers.push(value);
      continue;
    }
    const match = /^\s*([a-z_]+)\s*=\s*(.*)$/i.exec(String(value));
    if (match) fields[match[1].toLowerCase()] = match[2].trim();
  }
  return { fields, numbers };
}

function lowerWord(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Callout for a bend or bevel mark from its XDATA, e.g.
 * "Bend up 21.9° · R 9 1/2"" or "Bevel 37.5° · far side".
 */
export function markLabel(role, fabData, mmPerUnit, unit) {
  const { fields, numbers } = parseFabData(fabData);
  const angle = Number(fields.angle ?? numbers[0]);
  const parts = [];
  if (role === "bend") {
    const direction = lowerWord(fields.direction);
    parts.push(direction ? `Bend ${direction}` : "Bend");
    if (Number.isFinite(angle)) parts[0] += ` ${formatAngle(angle)}`;
    const radius = Number(fields.inside_radius ?? fields.radius);
    if (Number.isFinite(radius) && radius > 0) {
      parts.push(`R ${formatLength(radius * mmPerUnit, unit)}`);
    }
  } else if (role === "bevel") {
    parts.push(
      Number.isFinite(angle) ? `Bevel ${formatAngle(angle)}` : "Bevel",
    );
    const side = lowerWord(fields.side);
    if (side) parts.push(`${side} side`);
    const land = Number(fields.land ?? fields.root_face);
    if (Number.isFinite(land) && land > 0) {
      parts.push(`land ${formatLength(land * mmPerUnit, unit)}`);
    }
  } else {
    return null;
  }
  return parts.join(" · ");
}

const DSTV_FACES = {
  v: "Front (web)",
  h: "Back",
  o: "Top flange",
  u: "Bottom flange",
};

export function dstvFaceLabel(face, profileCode) {
  const code = String(face ?? "").toLowerCase();
  // Plates (profile code B) have one face worth naming: the plate itself.
  const name = profileCode === "B" && code === "v" ? "Plate" : DSTV_FACES[code];
  return name ? `${name} · ${face}` : String(face ?? "");
}

/** Face height in mm for drawing a member face outline from its header. */
export function dstvFaceHeight(header, face) {
  const code = String(face ?? "").toLowerCase();
  const height = Number(header?.profileHeight);
  const width = Number(header?.flangeWidth);
  if (code === "o" || code === "u") return width > 0 ? width : null;
  if (code === "v" || code === "h") return height > 0 ? height : null;
  return null;
}
