// deno-lint-ignore-file no-undef

export function parseArgs(args) {
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

export function moduleResult(handle, json) {
  return { handle, json };
}

export function requiredMount(elementId, viewerName) {
  const mount = document.getElementById(elementId);
  if (!mount) throw new Error(`The ${viewerName} mount is unavailable.`);
  return mount;
}

export async function fetchLimited(url, maxBytes, signal, label) {
  const response = await fetch(url, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) throw new Error(`${label} could not be downloaded.`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) {
    throw new Error(`${label} is too large to preview safely.`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error(`${label} is too large to preview safely.`);
  }
  return buffer;
}

export function downloadUrl(url, fileName) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  anchor.click();
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const amount = bytes / 1024 ** index;
  return `${
    amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)
  } ${units[index]}`;
}

export function previewPart(element, part) {
  element.dataset.previewPart = part;
  return element;
}
