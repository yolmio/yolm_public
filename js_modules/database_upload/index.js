const __v2 = 2;
const eventDataStore = new Map();
const pendingSelections = new Map();

function getEventData(args) {
  const handle = args?.handle;
  if (!handle || !eventDataStore.has(handle)) {
    return null;
  }
  const data = eventDataStore.get(handle);
  eventDataStore.delete(handle);
  return data;
}

function emitError(handle, eventName, payload) {
  eventDataStore.set(handle, payload);
  emit(eventName, { handle, json: payload });
}

function detectFileType(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  if (lower.endsWith(".parquet") || lower.endsWith(".pq")) {
    return "parquet";
  }
  if (lower.endsWith(".csv")) {
    return "csv";
  }
  if (lower.endsWith(".yolm-export")) {
    return "yolm_export";
  }
  if (lower === "manifest.json") {
    return "manifest";
  }
  if (lower === "mapping.json") {
    return "mapping";
  }
  if (
    lower === "data.db" ||
    lower === "wal" ||
    lower.endsWith(".wal") ||
    lower.endsWith(".db") ||
    lower.endsWith(".bin")
  ) {
    return "wal";
  }
  return "file";
}

function stripKnownExtension(name) {
  const lower = name.toLowerCase();
  const suffixes = [
    ".yolm-export",
    ".parquet",
    ".csv",
    ".json",
    ".zip",
    ".pq",
    ".wal",
    ".db",
    ".bin",
  ];
  for (const suffix of suffixes) {
    if (lower.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, name.length - suffix.length);
    }
  }
  return name;
}

function inferDefaultName(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return "";
  }
  const preferred = files.find((file) => {
    const type = detectFileType(file.name);
    return type !== "mapping" && type !== "manifest";
  }) || files[0];
  return stripKnownExtension(preferred.name);
}

function inferDetectedKind(files) {
  const types = new Set(files.map((file) => detectFileType(file.name)));
  const has = (type) => types.has(type);

  if (has("yolm_export")) {
    return {
      kind: "wal_export",
      origin: "wal_import",
      message: "Detected .yolm-export WAL archive",
    };
  }

  if (has("wal")) {
    if (!has("mapping")) {
      return {
        kind: "legacy_wal",
        origin: "wal_import",
        message: "Detected WAL-like file. mapping.json is required.",
      };
    }
    return {
      kind: "legacy_wal",
      origin: "wal_import",
      message: "Detected legacy WAL + mapping.json upload",
    };
  }

  if (has("manifest")) {
    if (has("mapping")) {
      return {
        kind: "export_with_mapping",
        origin: "export_import",
        message: "Detected export import with mapping.json",
      };
    }
    return {
      kind: "export_without_mapping",
      origin: "export_import",
      message: "Detected export import without mapping.json",
    };
  }

  if (has("zip") && files.length === 1) {
    return {
      kind: "zip_archive",
      origin: "",
      message: "Detected zip archive. Server will inspect contents.",
    };
  }

  if (has("csv") && has("parquet")) {
    return {
      kind: "ambiguous_source_format",
      origin: "",
      message: "Detected both CSV and Parquet files. Upload one format per import.",
    };
  }

  if (has("parquet")) {
    return {
      kind: "source_parquet",
      origin: "parquet_import",
      message: "Detected Parquet source import",
    };
  }

  if (has("csv")) {
    return {
      kind: "source_csv",
      origin: "csv_import",
      message: "Detected CSV source import",
    };
  }

  return {
    kind: "unknown",
    origin: "",
    message: "Server will detect the upload format",
  };
}

async function pickFilesWithOpenFilePicker() {
  const handles = await window.showOpenFilePicker({
    multiple: true,
    excludeAcceptAllOption: false,
    types: [
      {
        description: "Database import files",
        accept: {
          "application/octet-stream": [
            ".zip",
            ".parquet",
            ".pq",
            ".csv",
            ".wal",
            ".db",
            ".bin",
            ".json",
            ".yolm-export",
          ],
        },
      },
    ],
  });

  const files = [];
  for (const handle of handles) {
    files.push(await handle.getFile());
  }
  return files;
}

function supportsWebkitDirectoryInput() {
  if (typeof HTMLInputElement === "undefined") {
    return false;
  }
  return "webkitdirectory" in HTMLInputElement.prototype;
}

function pickFilesWithInput({ selectDirectory }) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (selectDirectory) {
      input.webkitdirectory = true;
      input.directory = true;
    } else {
      input.accept =
        ".zip,.parquet,.pq,.csv,.wal,.db,.bin,.json,.yolm-export";
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.width = "1px";
    input.style.height = "1px";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    });

    input.addEventListener("error", () => {
      input.remove();
      reject(new Error("Failed to read selected files"));
    });

    input.click();
  });
}

async function pickFiles(preferDirectory = true) {
  if (preferDirectory && supportsWebkitDirectoryInput()) {
    return pickFilesWithInput({ selectDirectory: true });
  }

  if (typeof window.showOpenFilePicker === "function") {
    try {
      return await pickFilesWithOpenFilePicker();
    } catch (err) {
      if (err?.name === "AbortError") {
        throw err;
      }
    }
  }
  return pickFilesWithInput({ selectDirectory: false });
}

function inferFolderName(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return "Selected files";
  }

  for (const file of files) {
    const relPath = file.webkitRelativePath;
    if (typeof relPath === "string" && relPath.length > 0) {
      const root = relPath.split("/")[0];
      if (root && root.length > 0) {
        return root;
      }
    }
  }

  return files.length === 1 ? files[0].name : "Selected files";
}

async function scanFiles(args) {
  const handle = args?.handle;
  try {
    const files = await pickFiles(args?.preferDirectory === true);
    if (!files || files.length === 0) {
      emitError(handle, "scanError", { success: false, cancelled: true });
      return;
    }

    let totalBytes = 0;
    const fileInfos = [];
    for (const file of files) {
      totalBytes += file.size;
      const relativePath = file.webkitRelativePath || file.name;
      fileInfos.push({
        name: file.name,
        displayName: relativePath,
        size: file.size,
        type: detectFileType(file.name),
      });
    }

    const inferred = inferDetectedKind(files);
    const defaultName = inferDefaultName(files);
    pendingSelections.set(handle, { files });

    const payload = {
      success: true,
      folderName: inferFolderName(files),
      fileCount: files.length,
      totalBytes,
      files: fileInfos,
      defaultName,
      detectedKind: inferred.kind,
      detectedOrigin: inferred.origin,
      message: inferred.message,
    };

    eventDataStore.set(handle, payload);
    emit("filesSelected", { handle, json: payload });
  } catch (err) {
    if (err?.name === "AbortError") {
      emitError(handle, "scanError", { success: false, cancelled: true });
      return;
    }

    emitError(handle, "scanError", {
      success: false,
      error: err?.message || "Failed to pick files",
    });
  }
}

function formatStructuredError(payload, status) {
  const fallback = `Upload failed${status ? ` (${status})` : ""}`;
  if (!payload) {
    return fallback;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (!payload.error || typeof payload.error !== "object") {
    return payload.message || fallback;
  }

  const code = payload.error.code ? `[${payload.error.code}] ` : "";
  const message = payload.error.message || fallback;
  const details = payload.error.details ? `\n${payload.error.details}` : "";
  const hints = Array.isArray(payload.error.hints) && payload.error.hints.length > 0
    ? `\nHints:\n- ${payload.error.hints.join("\n- ")}`
    : "";

  return `${code}${message}${details}${hints}`;
}

const CHUNK_THRESHOLD = 64 * 1024 * 1024; // 64MB
const CHUNK_UPLOAD_CONCURRENCY = 4;

async function uploadSingleRequest(handle, pending, databaseName) {
  const form = new FormData();
  if (databaseName.length > 0) {
    form.append("displayName", databaseName);
    form.append("databaseName", databaseName);
  }

  for (const file of pending.files) {
    form.append("files", file, file.webkitRelativePath || file.name);
  }

  const response = await fetch("/api/upload-database", {
    method: "POST",
    body: form,
  });

  return parseUploadResponse(response);
}

async function parseUploadResponse(response) {
  const bodyText = await response.text();
  let payload = null;
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }
  }
  return { response, payload };
}

async function uploadChunked(handle, pending, databaseName) {
  const fileEntries = pending.files.map((f) => ({
    name: f.webkitRelativePath || f.name,
    size: f.size,
  }));

  const initResp = await fetch("/api/chunked-upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: fileEntries }),
  });
  const initData = await initResp.json();
  if (!initResp.ok || !initData.sessionId) {
    throw new Error(initData?.error?.message || "Failed to init chunked upload");
  }
  const { sessionId, chunkSize } = initData;

  const chunks = [];
  for (let fi = 0; fi < pending.files.length; fi++) {
    const file = pending.files[fi];
    const numChunks = file.size === 0 ? 1 : Math.ceil(file.size / chunkSize);
    for (let ci = 0; ci < numChunks; ci++) {
      chunks.push({ file, fi, ci });
    }
  }

  let nextChunk = 0;
  const uploadNextChunk = async () => {
    while (nextChunk < chunks.length) {
      const index = nextChunk++;
      const { file, fi, ci } = chunks[index];
      const offset = ci * chunkSize;
      const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
      const chunkResp = await fetch(
        `/api/chunked-upload/${sessionId}/${fi}/${ci}`,
        { method: "PUT", body: chunk },
      );
      if (!chunkResp.ok) {
        const errData = await chunkResp.json().catch(() => null);
        throw new Error(
          errData?.error?.message || `Chunk upload failed (file ${fi}, chunk ${ci})`,
        );
      }
    }
  };

  const workerCount = Math.min(CHUNK_UPLOAD_CONCURRENCY, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, uploadNextChunk));

  const completeBody = databaseName.length > 0
    ? JSON.stringify({ displayName: databaseName })
    : "{}";
  const completeResp = await fetch(
    `/api/chunked-upload/${sessionId}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: completeBody,
    },
  );

  return parseUploadResponse(completeResp);
}

async function confirmUpload(args) {
  const handle = args?.handle;
  const databaseName = (args?.databaseName || "").trim();
  const pending = pendingSelections.get(handle);

  if (!pending) {
    emitError(handle, "uploadError", {
      success: false,
      error: "No files selected. Select files first.",
    });
    return;
  }

  try {
    const totalSize = pending.files.reduce((sum, f) => sum + f.size, 0);

    const { response, payload } = totalSize <= CHUNK_THRESHOLD
      ? await uploadSingleRequest(handle, pending, databaseName)
      : await uploadChunked(handle, pending, databaseName);

    if (!response.ok || !payload?.success) {
      emitError(handle, "uploadError", {
        success: false,
        error: formatStructuredError(payload, response.status),
        message: payload?.error?.message || "Upload failed",
      });
      return;
    }

    eventDataStore.set(handle, payload);
    emit("filesUploaded", { handle, json: payload });
  } catch (err) {
    emitError(handle, "uploadError", {
      success: false,
      error: err?.message || "Upload failed",
    });
  } finally {
    pendingSelections.delete(handle);
  }
}

function cancelSelection(args) {
  const handle = args?.handle;
  pendingSelections.delete(handle);
  eventDataStore.delete(handle);
}

function cleanup(handle) {
  pendingSelections.delete(handle);
  eventDataStore.delete(handle);
}

registerModule({
  scanFiles,
  confirmUpload,
  cancelSelection,
  getEventData,
  cleanup,
});
