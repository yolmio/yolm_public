import { blake3 } from "@noble/hashes/blake3.js";

const __v2 = 1;

const DIRECTORY_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const DIRECTORY_TEXT_BATCH_BYTES = 8 * 1024 * 1024;
const DIRECTORY_TEXT_REQUEST_MAX_BYTES = 96 * 1024 * 1024;
const DIRECTORY_MAX_FILES = 2000;
const DIRECTORY_MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024;
const DIRECTORY_MAX_TEXT_BYTES = 64 * 1024 * 1024;
const DIRECTORY_MAX_BINARY_FILE_BYTES = 256 * 1024 * 1024;
const DIRECTORY_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const directoryUploads = new Map();

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "txt",
  "csv",
  "svg",
  "xml",
  "html",
  "css",
  "yaml",
  "yml",
  "toml",
  "sql",
  "graphql",
  "env",
  "sh",
  "typ",
  "typst",
]);

const STANDARD_FOLDERS = new Map([
  ["apps", { allow: [".tsx", ".ts"], deny: [] }],
  ["apis", { allow: [".ts"], deny: [] }],
  ["shared", { allow: [".tsx", ".ts"], deny: [] }],
  ["components", { allow: [".tsx", ".ts"], deny: [] }],
  ["assets", { allow: [], deny: [".ts", ".tsx"] }],
  ["reactors", { allow: [".ts"], deny: [] }],
  ["scheduled", { allow: [".ts"], deny: [] }],
  ["pipelines", { allow: [".ts"], deny: [] }],
  ["transforms", { allow: [".ts"], deny: [] }],
  ["tests", { allow: [".ts"], deny: [] }],
  ["decision_tables", { allow: [".json"], deny: [] }],
  ["procedures", { allow: [".ts"], deny: [] }],
  ["templates", { allow: [".typ", ".json"], deny: [] }],
  ["translations", { allow: [".json"], deny: [] }],
]);

function isTextFile(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext ? TEXT_EXTENSIONS.has(ext) : false;
}

function validateUploadFile(path) {
  if (
    !path || path.length > 500 || path.startsWith("/") || path.endsWith("/") ||
    path.includes("//") || path.includes("\\") || path.includes("\0")
  ) {
    return "Invalid file path";
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "." || part === "..")) {
    return "Path traversal is not allowed";
  }
  if (parts.length === 1) {
    return path === "core.tsx" ? null : "Only core.tsx allowed at root";
  }
  const folder = parts[0];
  const rules = STANDARD_FOLDERS.get(folder);
  if (!rules) return `Unknown folder: ${folder}`;

  const ext = "." + path.split(".").pop()?.toLowerCase();
  if (rules.allow.length > 0) {
    if (!rules.allow.includes(ext)) {
      return `${ext} not allowed in ${folder}/ (expected ${
        rules.allow.join(", ")
      })`;
    }
  } else if (rules.deny.length > 0) {
    if (rules.deny.includes(ext)) {
      return `${ext} not allowed in ${folder}/`;
    }
  }
  return null;
}

function shouldIgnoreEntry(name) {
  return name === "data" || name === "doc.json" || name === "system.json";
}

async function hashBinaryFile(file, uploadState) {
  const hasher = blake3.create({});
  const reader = file.stream().getReader();
  try {
    while (true) {
      if (uploadState.cancelled) {
        await reader.cancel().catch(() => {});
        throw new DOMException("Directory upload cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Array.from(
    hasher.digest(),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function hashBytes(bytes) {
  return Array.from(
    blake3(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function scanDirectoryFiles(
  dirHandle,
  uploadState,
  manifest,
  basePath = "",
) {
  for await (const entry of dirHandle.values()) {
    if (uploadState.cancelled) {
      throw new DOMException("Directory upload cancelled", "AbortError");
    }
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (shouldIgnoreEntry(entry.name)) {
      manifest.ignored.push(path);
      continue;
    }
    if (
      entry.kind === "directory" && basePath === "" &&
      !STANDARD_FOLDERS.has(entry.name)
    ) {
      manifest.ignored.push(path);
      continue;
    }

    if (entry.kind === "file") {
      const reason = validateUploadFile(path);
      if (reason) {
        manifest.ignored.push(path);
        continue;
      }
      if (manifest.files.length >= DIRECTORY_MAX_FILES) {
        throw new Error("Directory contains more than 2,000 files");
      }
      const normalizedPath = path.toLowerCase();
      if (manifest.seenPaths.has(normalizedPath)) {
        throw new Error(
          `Directory contains paths that differ only by case: ${path}`,
        );
      }
      manifest.seenPaths.add(normalizedPath);
      try {
        const snapshot = await entry.getFile();
        if (isTextFile(entry.name)) {
          if (snapshot.size > DIRECTORY_MAX_TEXT_FILE_BYTES) {
            throw new Error("Text file exceeds the 16 MiB limit");
          }
          const sourceBytes = new Uint8Array(await snapshot.arrayBuffer());
          const content = new TextDecoder("utf-8", { fatal: true }).decode(
            sourceBytes,
          );
          const storedBytes = new TextEncoder().encode(content);
          const nextTextBytes = manifest.textBytes + storedBytes.byteLength;
          const nextTotalBytes = manifest.totalBytes + storedBytes.byteLength;
          if (nextTextBytes > DIRECTORY_MAX_TEXT_BYTES) {
            throw new Error(
              "Directory contains more than 64 MiB of text files",
            );
          }
          if (nextTotalBytes > DIRECTORY_MAX_TOTAL_BYTES) {
            throw new Error("Directory exceeds the 1 GiB upload limit");
          }
          manifest.textBytes = nextTextBytes;
          manifest.totalBytes = nextTotalBytes;
          manifest.files.push({
            path,
            kind: "text",
            content,
            contentHash: hashBytes(storedBytes),
            size: storedBytes.byteLength,
          });
        } else {
          if (snapshot.size > DIRECTORY_MAX_BINARY_FILE_BYTES) {
            throw new Error("Binary file exceeds the 256 MiB limit");
          }
          const nextTotalBytes = manifest.totalBytes + snapshot.size;
          if (nextTotalBytes > DIRECTORY_MAX_TOTAL_BYTES) {
            throw new Error("Directory exceeds the 1 GiB upload limit");
          }
          manifest.totalBytes = nextTotalBytes;
          manifest.files.push({
            path,
            kind: "binary",
            snapshot,
            contentHash: await hashBinaryFile(snapshot, uploadState),
            size: snapshot.size,
          });
        }
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        throw new Error(`${path}: ${err?.message || "Could not read file"}`);
      }
    } else if (entry.kind === "directory") {
      try {
        await scanDirectoryFiles(entry, uploadState, manifest, path);
      } catch (err) {
        if (
          err?.name === "AbortError" || err?.message?.startsWith(`${path}/`)
        ) {
          throw err;
        }
        throw new Error(
          `${path}: ${err?.message || "Could not read directory"}`,
        );
      }
    }
  }
}

async function buildDirectoryManifest(dirHandle, uploadState) {
  const manifest = {
    files: [],
    ignored: [],
    seenPaths: new Set(),
    textBytes: 0,
    totalBytes: 0,
  };
  await scanDirectoryFiles(dirHandle, uploadState, manifest);
  manifest.files.sort((left, right) =>
    left.path.localeCompare(right.path, "en")
  );
  return { files: manifest.files, ignored: manifest.ignored };
}

/**
 * Upload a single binary file via HTTP POST (lazy-reads content).
 */
async function uploadBinaryFile(bf, versionId) {
  try {
    const file = await bf.fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    const params = new URLSearchParams({
      version_id: String(versionId),
      path: bf.path,
      mime_type: bf.mimeType,
    });
    const resp = await fetch(`/api/upload-binary-asset?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: arrayBuffer,
    });
    if (resp.ok) {
      const data = await resp.json();
      return { path: bf.path, success: true, id: data.id };
    }
    return { path: bf.path, success: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { path: bf.path, success: false, error: err.message };
  }
}

/**
 * Upload binary files in parallel with concurrency limit.
 */
async function uploadBinariesParallel(binaryFiles, versionId, concurrency = 3) {
  const results = [];
  let i = 0;
  while (i < binaryFiles.length) {
    const batch = binaryFiles.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((bf) => uploadBinaryFile(bf, versionId)),
    );
    results.push(...batchResults);
    i += concurrency;
  }
  return results;
}

/**
 * Upload text files in batches via API endpoint.
 * First batch can include deleteOthers + keepPaths for replace mode.
 * Last batch includes bumpVersion=true.
 */
/**
 * Batch text files by total content size (max ~2MB per batch) to stay
 * under the server's request body limit.
 */
function batchBySize(textFiles, maxBytes = 2 * 1024 * 1024) {
  const batches = [];
  let current = [];
  let currentSize = 0;
  for (const f of textFiles) {
    const size = f.content.length * 2; // rough upper bound (UTF-16)
    if (current.length > 0 && currentSize + size > maxBytes) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(f);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function uploadTextFilesBatched(
  textFiles,
  versionId,
  { deleteOthers = false, keepPaths = null } = {},
) {
  const batches = batchBySize(textFiles);

  // If no text files, still send a request for delete/bump
  if (batches.length === 0) {
    const body = { versionId, files: [], bumpVersion: true };
    if (deleteOthers && keepPaths) {
      body.deleteOthers = true;
      body.keepPaths = keepPaths;
    }
    const resp = await fetch("/api/upload-text-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Upload failed: HTTP ${resp.status} ${text}`);
    }
    return;
  }

  for (let i = 0; i < batches.length; i++) {
    const isFirst = i === 0;
    const isLast = i === batches.length - 1;

    const body = {
      versionId,
      files: batches[i].map((f) => ({ path: f.path, content: f.content })),
      bumpVersion: isLast,
    };
    if (isFirst && deleteOthers && keepPaths) {
      body.deleteOthers = true;
      body.keepPaths = keepPaths;
    }

    const resp = await fetch("/api/upload-text-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Upload batch failed: HTTP ${resp.status} ${text}`);
    }
  }
}

function directoryManifestJson(files) {
  return files.map((file) => ({
    path: file.path,
    kind: file.kind,
    contentHash: file.contentHash,
    size: file.size,
  }));
}

async function postDirectoryJson(path, body, uploadState) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: uploadState.abortController.signal,
  });
  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Directory sync returned an invalid response (HTTP ${response.status})`,
      );
    }
  }
  if (!response.ok) {
    throw new Error(
      payload?.message || payload?.code || `HTTP ${response.status}`,
    );
  }
  return payload;
}

function requiredFiles(files, hashes, kind) {
  if (!Array.isArray(hashes)) {
    throw new Error(`Directory sync omitted required ${kind} hashes`);
  }
  const filesByHash = new Map();
  for (const file of files) {
    if (file.kind === kind && !filesByHash.has(file.contentHash)) {
      filesByHash.set(file.contentHash, file);
    }
  }
  return hashes.map((hash) => {
    const file = filesByHash.get(hash);
    if (!file) {
      throw new Error(`Server requested unknown ${kind} hash ${hash}`);
    }
    return file;
  });
}

async function uploadRequiredTextFiles(files, versionId, uploadState) {
  const encoder = new TextEncoder();
  const emptyBatchBytes = encoder.encode(JSON.stringify({
    versionId,
    files: [],
  })).byteLength;
  let batch = [];
  let batchBytes = emptyBatchBytes;

  async function sendBatch() {
    if (batch.length === 0) return;
    const body = {
      versionId,
      files: batch.map((file) => ({
        contentHash: file.contentHash,
        content: file.content,
      })),
    };
    if (batchBytes > DIRECTORY_TEXT_REQUEST_MAX_BYTES) {
      throw new Error("A changed text file exceeds the upload request limit");
    }
    await postDirectoryJson("/api/directory-sync/text", body, uploadState);
    batch = [];
    batchBytes = emptyBatchBytes;
  }

  for (const file of files) {
    const entry = {
      contentHash: file.contentHash,
      content: file.content,
    };
    const entryBytes = encoder.encode(JSON.stringify(entry)).byteLength;
    const separatorBytes = batch.length > 0 ? 1 : 0;
    if (
      batch.length > 0 &&
      batchBytes + separatorBytes + entryBytes > DIRECTORY_TEXT_BATCH_BYTES
    ) {
      await sendBatch();
    }
    batch.push(file);
    batchBytes += (batch.length > 1 ? 1 : 0) + entryBytes;
  }
  await sendBatch();
}

function getUploadTransport() {
  const transport = globalThis.YolmModules?.http_file_upload;
  if (typeof transport?.uploadProvidedFile !== "function") {
    throw new Error("Directory upload transport is unavailable");
  }
  return transport;
}

async function uploadRequiredBinaryFiles(files, versionId, uploadState) {
  const transport = getUploadTransport();
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (uploadState.cancelled) {
      throw new DOMException("Directory upload cancelled", "AbortError");
    }
    const endpoint = `/api/directory-sync/binary?${new URLSearchParams({
      version_id: String(versionId),
      expected_hash: file.contentHash,
      path: file.path,
    })}`;
    const result = await transport.uploadProvidedFile({
      endpoint,
      file: file.snapshot,
      handle: uploadState.handle,
      index,
      totalCount: files.length,
      selection: uploadState,
      chunkThreshold: DIRECTORY_UPLOAD_CHUNK_BYTES,
      chunkSize: DIRECTORY_UPLOAD_CHUNK_BYTES,
    });
    if (!result.ok) {
      if (result.cancelled) {
        throw new DOMException("Directory upload cancelled", "AbortError");
      }
      throw new Error(
        result.response?.message || result.response?.code || result.error ||
          (result.status ? `HTTP ${result.status}` : "Binary upload failed"),
      );
    }
  }
}

async function uploadDirectory(args) {
  const mode = args?.mode || "merge";
  const versionId = args?.versionId;
  const handle = args?.handle || globalThis.crypto.randomUUID();
  const uploadState = {
    handle,
    activeRequests: new Set(),
    abortController: new AbortController(),
    cancelled: false,
  };
  directoryUploads.set(handle, uploadState);

  try {
    if (mode !== "merge" && mode !== "replace") {
      throw new Error("Directory upload mode must be merge or replace");
    }
    if (
      versionId === null || versionId === undefined ||
      !Number.isSafeInteger(Number(versionId)) || Number(versionId) < 0
    ) {
      throw new Error("Directory upload requires a valid version");
    }
    if (!globalThis.showDirectoryPicker) {
      return {
        success: false,
        error:
          "File System Access API not supported. Please use Chrome or Edge.",
      };
    }

    const dirHandle = await globalThis.showDirectoryPicker({ mode: "read" });
    const { files, ignored } = await buildDirectoryManifest(
      dirHandle,
      uploadState,
    );
    if (
      mode === "replace" && files.length === 0 &&
      !globalThis.confirm(
        "This directory contains no uploadable files. Delete every saved file from this version?",
      )
    ) {
      return { success: false, cancelled: true };
    }
    const request = {
      versionId,
      mode,
      files: directoryManifestJson(files),
    };
    const plan = await postDirectoryJson(
      "/api/directory-sync/plan",
      request,
      uploadState,
    );
    if (typeof plan?.baseTreeHash !== "string") {
      throw new Error("Directory sync plan omitted the base tree hash");
    }
    const textFiles = requiredFiles(
      files,
      plan.requiredTextHashes,
      "text",
    );
    const binaryFiles = requiredFiles(
      files,
      plan.requiredBinaryHashes,
      "binary",
    );
    await uploadRequiredTextFiles(textFiles, versionId, uploadState);
    await uploadRequiredBinaryFiles(binaryFiles, versionId, uploadState);
    const finalized = await postDirectoryJson(
      "/api/directory-sync/finalize",
      { ...request, baseTreeHash: plan.baseTreeHash },
      uploadState,
    );
    if (
      finalized?.status !== "committed" &&
      finalized?.status !== "already_applied"
    ) {
      throw new Error("Directory sync did not commit");
    }

    return {
      success: true,
      changed: finalized.status === "committed",
      fileCount: files.length,
      skippedCount: ignored.length,
      directoryName: dirHandle.name,
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err?.message || "Directory upload failed" };
  } finally {
    if (directoryUploads.get(handle) === uploadState) {
      directoryUploads.delete(handle);
    }
  }
}

/**
 * Upload individual files into a target folder.
 */
async function uploadFiles(args) {
  const targetFolder = args?.targetFolder || "";
  const versionId = args?.versionId;

  try {
    if (!window.showOpenFilePicker) {
      return {
        success: false,
        error: "File System Access API not supported.",
      };
    }

    const handles = await window.showOpenFilePicker({ multiple: true });
    const textFiles = [];
    const binaryFiles = [];
    const skipped = [];

    for (const fh of handles) {
      const file = await fh.getFile();
      const path = targetFolder ? `${targetFolder}/${file.name}` : file.name;
      const reason = validateUploadFile(path);
      if (reason) {
        skipped.push({ path, reason });
        continue;
      }
      if (!isTextFile(file.name)) {
        binaryFiles.push({
          path,
          fileHandle: fh,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        });
      } else {
        const content = await file.text();
        textFiles.push({ path, content });
      }
    }

    await uploadBinariesParallel(binaryFiles, versionId);
    await uploadTextFilesBatched(textFiles, versionId);

    return {
      success: true,
      fileCount: textFiles.length + binaryFiles.length,
      skippedCount: skipped.length,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Upload a single file. Binary via HTTP, text via API.
 */
async function uploadFile(args) {
  const versionId = args?.versionId;
  const targetPath = args?.targetPath;

  try {
    const [fileHandle] = await window.showOpenFilePicker({ multiple: false });
    const file = await fileHandle.getFile();
    const binary = !isTextFile(file.name);
    const filePath = targetPath || (binary ? "assets/" + file.name : file.name);

    if (binary) {
      const arrayBuffer = await file.arrayBuffer();
      const mimeType = file.type || "application/octet-stream";
      const params = new URLSearchParams({
        version_id: String(versionId),
        path: filePath,
        mime_type: mimeType,
      });
      const resp = await fetch(`/api/upload-binary-asset?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: arrayBuffer,
      });
      if (!resp.ok) {
        return {
          success: false,
          error: `Upload failed: HTTP ${resp.status}`,
        };
      }
      return {
        success: true,
        filename: file.name,
        isBinary: true,
        path: filePath,
      };
    } else {
      const content = await file.text();
      await uploadTextFilesBatched(
        [{ path: filePath, content }],
        versionId,
      );
      return {
        success: true,
        filename: file.name,
        isBinary: false,
        path: filePath,
      };
    }
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Write files to a directory
 */
async function writeFilesToDirectory(dirHandle, files) {
  const results = [];
  for (const file of files) {
    try {
      const parts = file.path.split("/");
      const fileName = parts.pop();
      let currentDir = dirHandle;
      for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part, {
          create: true,
        });
      }
      const fh = await currentDir.getFileHandle(fileName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(file.content);
      await writable.close();
      results.push({ path: file.path, success: true });
    } catch (err) {
      results.push({ path: file.path, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * Recursively delete files/directories from disk that aren't in the DB
 */
async function deleteExtraFiles(dirHandle, dbFilePaths, basePath = "") {
  const deleted = [];
  for await (const entry of dirHandle.values()) {
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (shouldIgnoreEntry(entry.name)) continue;

    if (entry.kind === "file") {
      if (!dbFilePaths.has(path)) {
        try {
          await dirHandle.removeEntry(entry.name);
          deleted.push({ path, type: "file" });
        } catch (err) {
          console.error(`Error deleting file ${path}:`, err);
        }
      }
    } else if (entry.kind === "directory") {
      const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
      const subDeleted = await deleteExtraFiles(
        subDirHandle,
        dbFilePaths,
        path,
      );
      deleted.push(...subDeleted);
      try {
        let isEmpty = true;
        for await (const _ of subDirHandle.values()) {
          isEmpty = false;
          break;
        }
        if (isEmpty) {
          await dirHandle.removeEntry(entry.name);
          deleted.push({ path, type: "directory" });
        }
      } catch (_err) {
        // Directory not empty or error
      }
    }
  }
  return deleted;
}

/**
 * Show directory picker and download all files
 */
async function downloadDirectory(args) {
  try {
    if (!window.showDirectoryPicker) {
      return {
        success: false,
        error:
          "File System Access API not supported. Please use Chrome or Edge.",
      };
    }
    const files = args.files || [];
    if (files.length === 0) {
      return { success: false, error: "No files to download" };
    }
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const dbFilePaths = new Set(files.map((f) => f.path));
    const deleted = await deleteExtraFiles(dirHandle, dbFilePaths);
    const results = await writeFilesToDirectory(dirHandle, files);
    const failedFiles = results.filter((r) => !r.success);
    const successCount = results.filter((r) => r.success).length;
    if (failedFiles.length > 0) {
      return {
        success: false,
        partialSuccess: true,
        successCount,
        failedCount: failedFiles.length,
        deletedCount: deleted.length,
        error: `Failed to write ${failedFiles.length} file(s)`,
      };
    }
    return {
      success: true,
      fileCount: successCount,
      deletedCount: deleted.length,
      directoryName: dirHandle.name,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err.message };
  }
}

function cleanup(args) {
  const handle = typeof args === "string" ? args : args?.handle;
  const uploadState = directoryUploads.get(handle);
  if (!uploadState) return;
  uploadState.cancelled = true;
  uploadState.abortController.abort();
  for (const request of uploadState.activeRequests) {
    request.abort();
  }
  directoryUploads.delete(handle);
}

registerModule({
  uploadDirectory,
  uploadFiles,
  uploadFile,
  downloadDirectory,
  cleanup,
});
