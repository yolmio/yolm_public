// deno-lint-ignore-file no-control-regex no-undef

import zip from "./zip.cjs";
import {
  downloadUrl,
  fetchLimited,
  formatBytes,
  moduleResult,
  parseArgs,
  previewPart,
  requiredMount,
} from "../_drive_preview/common";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const instances = new Map();
const { BlobReader, ZipReader } = zip;

function safePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/[\u0000-\u001f\u007f]/g, "�")
    .replace(/^\/+/, "") || "(unnamed)";
}

function buildRows(entries) {
  const folders = new Map();
  const rows = [];
  for (const entry of entries) {
    const path = safePath(entry.filename);
    const parts = path.split("/").filter(Boolean);
    const fileParts = entry.directory ? parts : parts.slice(0, -1);
    let parent = "";
    for (const part of fileParts) {
      const folderPath = `${parent}${part}/`;
      if (!folders.has(folderPath)) {
        const folder = {
          directory: true,
          depth: parent ? parent.split("/").filter(Boolean).length : 0,
          path: folderPath,
          name: part,
          synthetic: true,
        };
        folders.set(folderPath, folder);
        rows.push(folder);
      }
      parent = folderPath;
    }
    if (!entry.directory) {
      rows.push({
        compressedSize: entry.compressedSize,
        directory: false,
        depth: Math.max(0, parts.length - 1),
        encrypted: entry.encrypted,
        name: parts.at(-1) || path,
        path,
        uncompressedSize: entry.uncompressedSize,
      });
    }
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

class ArchiveViewer {
  constructor({ handle, elementId, fileUrl, fileName }) {
    this.handle = handle;
    this.mount = requiredMount(elementId, "ZIP viewer");
    this.fileUrl = fileUrl;
    this.fileName = fileName || "archive.zip";
    this.abortController = new AbortController();
    this.destroyed = false;
  }

  async initialize() {
    const buffer = await fetchLimited(
      this.fileUrl,
      MAX_ARCHIVE_BYTES,
      this.abortController.signal,
      "This ZIP archive",
    );
    if (this.destroyed) return;
    const reader = new ZipReader(new BlobReader(new Blob([buffer])), {
      useWebWorkers: false,
    });
    const entries = [];
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        if (entries.length >= MAX_ENTRIES) {
          throw new Error(
            `This ZIP has more than ${MAX_ENTRIES.toLocaleString()} entries and cannot be previewed safely.`,
          );
        }
        entries.push(entry);
      }
    } finally {
      await reader.close();
    }
    if (this.destroyed) return;
    this.rows = buildRows(entries);
    this.entryCount = entries.filter((entry) => !entry.directory).length;
    this.totalSize = entries.reduce(
      (sum, entry) => sum + Number(entry.uncompressedSize || 0),
      0,
    );
    this.encryptedCount = entries.filter((entry) => entry.encrypted).length;
    this.build();
    this.renderRows();
    emit("ready", {
      handle: this.handle,
      json: {
        entryCount: this.entryCount,
        summary: `${this.entryCount} files · ${
          formatBytes(this.totalSize)
        } total`,
      },
    });
  }

  build() {
    this.mount.innerHTML = "";
    previewPart(this.mount, "zip-mount");
    this.list = previewPart(document.createElement("div"), "zip-list");
    this.mount.append(this.list);
  }

  renderRows() {
    this.list.replaceChildren();
    const query = (this.filter || "").trim().toLowerCase();
    let rendered = 0;
    for (const row of this.rows) {
      if (query && !row.path.toLowerCase().includes(query)) continue;
      rendered++;
      const item = previewPart(document.createElement("div"), "zip-row");
      const name = document.createElement("div");
      name.textContent = `${row.directory ? "📁" : "📄"} ${row.name}`;
      name.title = row.path;
      previewPart(name, "zip-name");
      name.style.setProperty(
        "--preview-depth",
        String(Math.min(row.depth, 20)),
      );
      const size = document.createElement("div");
      size.textContent = row.directory
        ? "Folder"
        : formatBytes(row.uncompressedSize);
      previewPart(size, "zip-detail");
      const details = document.createElement("div");
      details.textContent = row.directory
        ? ""
        : row.encrypted
        ? "Encrypted"
        : `${formatBytes(row.compressedSize)} packed`;
      previewPart(details, "zip-detail");
      details.dataset.previewTone = row.encrypted ? "warning" : "neutral";
      item.append(name, size, details);
      this.list.append(item);
    }
    if (!rendered) {
      const empty = document.createElement("div");
      empty.textContent = query
        ? "No files or folders match your search."
        : "This ZIP is empty.";
      previewPart(empty, "zip-empty");
      this.list.append(empty);
    }
  }

  download() {
    downloadUrl(this.fileUrl, this.fileName);
  }

  destroy() {
    this.destroyed = true;
    this.abortController.abort();
    this.listeners = [];
    this.mount.innerHTML = "";
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const instance = new ArchiveViewer({ ...data, handle });
    instances.set(handle, instance);
    await instance.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function download(args) {
  instances.get(args.handle || parseArgs(args).handle)?.download();
}

function cleanup(args) {
  const handle = args.handle || parseArgs(args).handle;
  instances.get(handle)?.destroy();
  instances.delete(handle);
}

function filter(args) {
  const data = parseArgs(args);
  const v = instances.get(args.handle || data.handle);
  if (v?.list) {
    v.filter = String(data.value || "");
    v.renderRows();
  }
}
registerModule({ initialize, download, cleanup, filter });
