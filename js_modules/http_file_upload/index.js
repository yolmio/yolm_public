const __v1 = 1;

const selections = new Map();
const eventDataStore = new Map();
const latestEventByHandle = new Map();

function getHandle(args) {
  return typeof args === "string" ? args : args?.handle;
}

function eventPayload(handle, payload) {
  return { handle, json: payload };
}

function emitEvent(handle, eventName, payload) {
  let handleEvents = eventDataStore.get(handle);
  if (!handleEvents) {
    handleEvents = new Map();
    eventDataStore.set(handle, handleEvents);
  }
  handleEvents.set(eventName, payload);
  latestEventByHandle.set(handle, eventName);
  emit(eventName, eventPayload(handle, payload));
}

function getEventData(args) {
  const handle = getHandle(args);
  if (!handle) {
    return null;
  }
  const eventName = typeof args?.eventName === "string"
    ? args.eventName
    : latestEventByHandle.get(handle);
  const handleEvents = eventDataStore.get(handle);
  if (!eventName || !handleEvents?.has(eventName)) {
    return null;
  }
  const data = handleEvents.get(eventName);
  handleEvents.delete(eventName);
  if (handleEvents.size === 0) {
    eventDataStore.delete(handle);
  }
  if (latestEventByHandle.get(handle) === eventName) {
    latestEventByHandle.delete(handle);
  }
  return data;
}

function safeContentType(file) {
  return file.type || "application/octet-stream";
}

function selectedFileInfo(file) {
  return {
    name: file.name,
    type: safeContentType(file),
    size: file.size,
    lastModified: file.lastModified || null,
  };
}

function selectFiles(args) {
  const handle = getHandle(args);
  if (!handle) {
    return { success: false, error: "Missing upload handle" };
  }

  return new Promise((resolve) => {
    const input = globalThis.document.createElement("input");
    let settled = false;
    let armFocusFallbackToken = 0;
    let focusFallbackToken = 0;
    input.type = "file";
    input.multiple = args?.multiple !== false;
    if (typeof args?.accept === "string" && args.accept.length > 0) {
      input.accept = args.accept;
    }
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";
    input.style.width = "1px";
    input.style.height = "1px";
    globalThis.document.body.appendChild(input);

    function cleanupInput() {
      if (armFocusFallbackToken) {
        globalThis.clearTimeout(armFocusFallbackToken);
      }
      if (focusFallbackToken) {
        globalThis.clearTimeout(focusFallbackToken);
      }
      if (typeof globalThis.removeEventListener === "function") {
        globalThis.removeEventListener("focus", onWindowFocus);
      }
      input.remove();
    }

    function finishSelected(files) {
      if (settled) return;
      settled = true;
      cleanupInput();
      const payload = {
        success: true,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        files: files.map(selectedFileInfo),
      };
      selections.set(handle, {
        activeRequests: new Set(),
        cancelled: false,
        files,
      });
      emitEvent(handle, "filesSelected", payload);
      resolve(payload);
    }

    function finishCancelled() {
      if (settled) return;
      settled = true;
      cleanupInput();
      selections.delete(handle);
      const cancelled = { success: false, cancelled: true };
      emitEvent(handle, "selectionCancelled", cancelled);
      resolve(cancelled);
    }

    function onWindowFocus() {
      focusFallbackToken = globalThis.setTimeout(() => {
        if (settled) return;
        const files = Array.from(input.files || []);
        if (files.length === 0) {
          finishCancelled();
        } else {
          finishSelected(files);
        }
      }, 1000);
    }

    input.addEventListener("change", () => {
      if (settled) return;
      const files = Array.from(input.files || []);

      if (files.length === 0) {
        finishCancelled();
        return;
      }

      finishSelected(files);
    }, { once: true });
    input.addEventListener("cancel", finishCancelled, { once: true });

    armFocusFallbackToken = globalThis.setTimeout(() => {
      if (!settled && typeof globalThis.addEventListener === "function") {
        globalThis.addEventListener("focus", onWindowFocus, { once: true });
      }
    }, 0);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Capture sources: clipboard paste, drag-and-drop, and injected bytes.
// Captured files feed the same per-handle selection + "filesSelected" flow as
// selectFiles, so downstream upload wiring is source-agnostic.

const captures = new Map();

function parseAcceptMatchers(accept) {
  if (typeof accept !== "string") return null;
  const matchers = accept
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return matchers.length > 0 ? matchers : null;
}

function fileMatchesAccept(file, matchers) {
  if (!matchers) return true;
  const name = (file.name || "").toLowerCase();
  const type = safeContentType(file).toLowerCase();
  for (const matcher of matchers) {
    if (matcher.startsWith(".")) {
      if (name.endsWith(matcher)) return true;
    } else if (matcher.endsWith("/*")) {
      if (type.startsWith(matcher.slice(0, -1))) return true;
    } else if (type === matcher) {
      return true;
    }
  }
  return false;
}

// Append files to the handle's selection (creating one if none is open) and
// emit "filesSelected" describing the full selection. An in-flight upload
// holds its own reference to the previous selection, so a capture during an
// upload starts a fresh selection instead of mutating the one being sent.
function stashCapturedFiles(handle, opts, fileList, source, inline = false) {
  const all = Array.from(fileList || []);
  const accepted = all.filter((file) =>
    fileMatchesAccept(file, opts.acceptMatchers)
  );
  const rejected = all.length - accepted.length;
  if (rejected > 0) {
    emitEvent(handle, "filesRejected", {
      source,
      rejectedCount: rejected,
      rejectedFiles: all
        .filter((file) => !fileMatchesAccept(file, opts.acceptMatchers))
        .map(selectedFileInfo),
    });
  }
  if (accepted.length === 0) {
    return null;
  }
  const added = opts.multiple ? accepted : accepted.slice(0, 1);
  let selection = selections.get(handle);
  if (!selection || selection.cancelled || selection.activeRequests.size > 0) {
    selection = {
      activeRequests: new Set(),
      cancelled: false,
      files: [],
      source,
      inline,
    };
    selections.set(handle, selection);
  }
  if (!opts.multiple) {
    selection.files.length = 0;
  }
  selection.files.push(...added);
  selection.source = source;
  selection.inline = inline;
  const payload = {
    success: true,
    source,
    inline,
    addedCount: added.length,
    fileCount: selection.files.length,
    totalBytes: selection.files.reduce((sum, file) => sum + file.size, 0),
    files: selection.files.map(selectedFileInfo),
  };
  emitEvent(handle, "filesSelected", payload);
  return payload;
}

function setDragActive(handle, capture, active) {
  if (capture.dragActive === active) return;
  capture.dragActive = active;
  emitEvent(handle, "dragStateChanged", { active });
}

/**
 * Start capturing pasted and/or dropped files on a target element.
 * args: { handle, targetId, sources?: ("paste"|"drop")[], accept?, multiple? }
 * Captured files emit the same "filesSelected" event as selectFiles. Pastes
 * that carry no files (plain text) are left to native handling. Drop capture
 * additionally emits "dragStateChanged" {active} for dropzone highlighting.
 */
function enableCapture(args) {
  const handle = getHandle(args);
  if (!handle) {
    return { success: false, error: "Missing upload handle" };
  }
  const targetId = args?.targetId;
  const target = typeof targetId === "string" && targetId.length > 0
    ? globalThis.document.getElementById(targetId)
    : null;
  if (!target) {
    return { success: false, error: "Capture target element not found" };
  }
  disableCapture({ handle });
  const capture = {
    target,
    listeners: [],
    acceptMatchers: parseAcceptMatchers(args?.accept),
    multiple: args?.multiple !== false,
    dragDepth: 0,
    dragActive: false,
  };

  function listen(type, fn, options) {
    target.addEventListener(type, fn, options);
    capture.listeners.push([type, fn, options]);
  }

  const sources = Array.isArray(args?.sources)
    ? args.sources
    : ["paste", "drop"];

  if (sources.includes("paste")) {
    listen(
      "paste",
      (e) => {
        const files = e.clipboardData ? e.clipboardData.files : null;
        if (!files || files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        stashCapturedFiles(handle, capture, files, "paste", true);
      },
      true,
    );
  }

  if (sources.includes("drop")) {
    const hasFiles = (e) =>
      !!(e.dataTransfer &&
        Array.from(e.dataTransfer.types || []).includes("Files"));
    listen("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (capture.dragDepth === 0) {
        capture.dropInsideEditor = !!e.target?.closest?.(
          '[contenteditable="true"]',
        );
      }
      capture.dragDepth += 1;
      setDragActive(handle, capture, true);
    });
    listen("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    listen("dragleave", (e) => {
      if (!hasFiles(e)) return;
      capture.dragDepth = Math.max(0, capture.dragDepth - 1);
      if (capture.dragDepth === 0) {
        setDragActive(handle, capture, false);
      }
    });
    listen("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      capture.dragDepth = 0;
      setDragActive(handle, capture, false);
      const inline = capture.dropInsideEditor ||
        !!e.target?.closest?.('[contenteditable="true"]');
      capture.dropInsideEditor = false;
      stashCapturedFiles(
        handle,
        capture,
        e.dataTransfer.files,
        "drop",
        inline,
      );
    });
  }

  captures.set(handle, capture);
  return { success: true };
}

function disableCapture(args) {
  const handle = getHandle(args);
  if (!handle) {
    return { success: false, error: "Missing upload handle" };
  }
  const capture = captures.get(handle);
  if (capture) {
    for (const [type, fn, options] of capture.listeners) {
      capture.target.removeEventListener(type, fn, options);
    }
    if (capture.dragActive) {
      emitEvent(handle, "dragStateChanged", { active: false });
    }
    captures.delete(handle);
  }
  return { success: true };
}

/**
 * Add a file to the handle's selection from raw bytes (jsCall argBytes
 * channel, key "content"). Lets other modules' output — e.g. a captured
 * screenshot — join the same selection + upload flow.
 * args: { handle, name, mimeType, bytes: { content: Uint8Array } }
 */
function addFileFromBytes(args) {
  const handle = getHandle(args);
  if (!handle) {
    return { success: false, error: "Missing upload handle" };
  }
  const bytes = args?.bytes?.content;
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { success: false, error: "Missing file bytes" };
  }
  const name = typeof args?.name === "string" && args.name.length > 0
    ? args.name
    : "file.bin";
  const mimeType =
    typeof args?.mimeType === "string" && args.mimeType.length > 0
      ? args.mimeType
      : "application/octet-stream";
  const file = new globalThis.File([bytes], name, { type: mimeType });
  const payload = stashCapturedFiles(
    handle,
    { acceptMatchers: null, multiple: true },
    [file],
    "bytes",
  );
  return payload || { success: false, error: "File was not added" };
}

function normalizeEndpoint(endpoint, file) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new Error("Missing upload endpoint");
  }
  const url = new URL(endpoint, globalThis.location.href);
  if (url.origin !== globalThis.location.origin) {
    throw new Error("Upload endpoint must be same-origin");
  }
  if (!url.pathname.startsWith("/api/")) {
    throw new Error("Upload endpoint must be under /api/");
  }
  url.searchParams.set("file_name", file.name);
  url.searchParams.set("content_type", safeContentType(file));
  url.searchParams.set("file_size", String(file.size));
  return url.toString();
}

function uploadOneFile(
  handle,
  selection,
  endpoint,
  file,
  index,
  totalCount,
  emitProgress = true,
) {
  return new Promise((resolve) => {
    let url;
    try {
      url = normalizeEndpoint(endpoint, file);
    } catch (err) {
      resolve({
        name: file.name,
        ok: false,
        error: err?.message || "Invalid upload endpoint",
      });
      return;
    }

    const xhr = new globalThis.XMLHttpRequest();
    selection.activeRequests.add(xhr);
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", safeContentType(file));

    xhr.upload.addEventListener("progress", (event) => {
      if (!emitProgress) return;
      emitEvent(handle, "uploadProgress", {
        currentFileIndex: index,
        currentFileName: file.name,
        currentFileLoaded: event.loaded,
        currentFileTotal: event.lengthComputable ? event.total : file.size,
        totalCount,
      });
    });

    xhr.addEventListener("load", () => {
      selection.activeRequests.delete(xhr);
      let response = null;
      if (xhr.responseText) {
        try {
          response = JSON.parse(xhr.responseText);
        } catch {
          response = xhr.responseText;
        }
      }
      resolve({
        name: file.name,
        ok: xhr.status >= 200 && xhr.status < 300,
        response,
        status: xhr.status,
      });
    });

    xhr.addEventListener("error", () => {
      selection.activeRequests.delete(xhr);
      resolve({
        name: file.name,
        ok: false,
        error: "Network error",
        status: xhr.status,
      });
    });

    xhr.addEventListener("abort", () => {
      selection.activeRequests.delete(xhr);
      resolve({
        name: file.name,
        ok: false,
        cancelled: true,
        error: "Upload cancelled",
        status: xhr.status,
      });
    });

    xhr.send(file);
  });
}

function normalizeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

// Platform chunked blob-upload protocol. Chunk size is capped server-side at
// 32 MiB; the default here stays well under the Cloudflare ~100 MB per-request
// body cap.
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CHUNK_SIZE = 32 * 1024 * 1024;
const CHUNK_UPLOAD_CONCURRENCY = 3;
// Per-chunk retry. Chunk writes are idempotent offset writes server-side, so
// a transient failure can be retried safely; the session stays alive for the
// idle TTL. Only network errors and transient server statuses are retried —
// terminal 4xx (bad chunk, forbidden, size) will not succeed on retry.
const CHUNK_MAX_ATTEMPTS = 4;
const CHUNK_RETRY_BASE_DELAY_MS = 300;
const CHUNK_RETRY_MAX_DELAY_MS = 5000;

function delay(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

// A network error surfaces as status 0; 429 and 5xx are transient. Everything
// else (2xx handled by caller, other 4xx) is terminal.
function isRetriableChunkStatus(status) {
  return status === 0 || status === 429 || (status >= 500 && status < 600);
}

function normalizeChunkThreshold(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function normalizeChunkSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHUNK_SIZE;
  return Math.max(1, Math.min(MAX_CHUNK_SIZE, Math.floor(parsed)));
}

function xhrRequest(selection, method, url, body, headers) {
  return new Promise((resolve) => {
    const xhr = new globalThis.XMLHttpRequest();
    selection.activeRequests.add(xhr);
    xhr.open(method, url);
    xhr.withCredentials = true;
    if (headers) {
      for (const name of Object.keys(headers)) {
        xhr.setRequestHeader(name, headers[name]);
      }
    }
    const finish = (result) => {
      selection.activeRequests.delete(xhr);
      resolve(result);
    };
    xhr.addEventListener("load", () => {
      let response = null;
      if (xhr.responseText) {
        try {
          response = JSON.parse(xhr.responseText);
        } catch {
          response = xhr.responseText;
        }
      }
      finish({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        response,
      });
    });
    xhr.addEventListener(
      "error",
      () => finish({ ok: false, status: xhr.status, error: "Network error" }),
    );
    xhr.addEventListener("abort", () =>
      finish({
        ok: false,
        status: xhr.status,
        cancelled: true,
        error: "Upload cancelled",
      }));
    xhr.send(body);
  });
}

// Uploads a single file via the platform chunked protocol
// (<api prefix>/_blob-upload/ init -> PUT chunks -> complete). The protocol
// routes always live under "/api/", the same origin+prefix the endpoint is
// validated against in normalizeEndpoint.
async function uploadOneFileChunked(
  handle,
  selection,
  endpoint,
  file,
  index,
  totalCount,
  chunkSize,
  emitProgress = true,
) {
  let targetUrl;
  try {
    targetUrl = new URL(normalizeEndpoint(endpoint, file));
  } catch (err) {
    return {
      name: file.name,
      ok: false,
      error: err?.message || "Invalid upload endpoint",
    };
  }
  const targetPath = targetUrl.pathname + targetUrl.search;
  const base = "/api/_blob-upload";

  const init = await xhrRequest(
    selection,
    "POST",
    base + "/init",
    JSON.stringify({ path: targetPath, size: file.size, chunkSize }),
    { "Content-Type": "application/json" },
  );
  if (selection.cancelled) {
    return {
      name: file.name,
      ok: false,
      cancelled: true,
      error: "Upload cancelled",
    };
  }
  if (
    !init.ok || !init.response || typeof init.response.sessionId !== "string"
  ) {
    return {
      name: file.name,
      ok: false,
      status: init.status,
      error: init.response?.message || init.response?.code ||
        init.response?.error || init.error || "Failed to start chunked upload",
    };
  }
  const sessionId = init.response.sessionId;
  const effectiveChunk = normalizeChunkSize(init.response.chunkSize);
  const chunkCount = Math.max(1, Math.ceil(file.size / effectiveChunk));

  // Upload one chunk, retrying transient failures with exponential backoff.
  async function putChunkWithRetry(chunkIndex, slice) {
    let result;
    for (let attempt = 0; attempt < CHUNK_MAX_ATTEMPTS; attempt++) {
      if (selection.cancelled) {
        return { ok: false, cancelled: true, error: "Upload cancelled" };
      }
      result = await xhrRequest(
        selection,
        "PUT",
        base + "/" + sessionId + "/" + chunkIndex,
        slice,
        { "Content-Type": "application/octet-stream" },
      );
      if (
        result.ok || result.cancelled ||
        !isRetriableChunkStatus(result.status)
      ) {
        return result;
      }
      if (attempt < CHUNK_MAX_ATTEMPTS - 1) {
        if (emitProgress) {
          emitEvent(handle, "uploadRetry", {
            currentFileIndex: index,
            currentFileName: file.name,
            chunkIndex,
            attempt: attempt + 1,
            totalCount,
          });
        }
        await delay(
          Math.min(
            CHUNK_RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
            CHUNK_RETRY_MAX_DELAY_MS,
          ),
        );
      }
    }
    return result;
  }

  let uploadedBytes = 0;
  let nextChunk = 0;
  let chunkError = null;
  async function chunkWorker() {
    while (
      !selection.cancelled && chunkError === null && nextChunk < chunkCount
    ) {
      const chunkIndex = nextChunk++;
      const start = chunkIndex * effectiveChunk;
      const end = Math.min(start + effectiveChunk, file.size);
      const result = await putChunkWithRetry(
        chunkIndex,
        file.slice(start, end),
      );
      if (!result.ok) {
        if (chunkError === null) {
          chunkError = {
            status: result.status,
            cancelled: result.cancelled,
            error: result.response?.message || result.response?.code ||
              result.response?.error || result.error || "Chunk upload failed",
          };
        }
        return;
      }
      uploadedBytes += end - start;
      if (emitProgress) {
        emitEvent(handle, "uploadProgress", {
          currentFileIndex: index,
          currentFileName: file.name,
          currentFileLoaded: uploadedBytes,
          currentFileTotal: file.size,
          totalCount,
        });
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(CHUNK_UPLOAD_CONCURRENCY, chunkCount) },
      chunkWorker,
    ),
  );

  if (selection.cancelled || chunkError) {
    return {
      name: file.name,
      ok: false,
      status: chunkError?.status,
      cancelled: selection.cancelled || chunkError?.cancelled || false,
      error: selection.cancelled ? "Upload cancelled" : chunkError.error,
    };
  }

  const complete = await xhrRequest(
    selection,
    "POST",
    base + "/" + sessionId + "/complete",
  );
  return {
    name: file.name,
    ok: complete.ok,
    status: complete.status,
    response: complete.response,
    error: complete.ok
      ? undefined
      : complete.response?.message || complete.response?.code ||
        complete.response?.error || complete.error ||
        "Failed to finalize upload",
  };
}

function failedUploadSummary(failedResults) {
  const firstFailure = failedResults[0];
  if (!firstFailure) return "Upload failed";
  const detail = [
    firstFailure.name,
    firstFailure.status ? `HTTP ${firstFailure.status}` : "",
    firstFailure.error || "",
  ].filter(Boolean).join(" - ");
  if (failedResults.length === 1) {
    return `Failed to upload ${detail}`;
  }
  return `Failed to upload ${failedResults.length} file(s). First failure: ${detail}`;
}

async function upload(args) {
  const handle = getHandle(args);
  if (!handle) {
    return { success: false, error: "Missing upload handle" };
  }

  const selection = selections.get(handle);
  if (!selection || selection.files.length === 0) {
    const payload = {
      success: false,
      error: "No files selected. Select files first.",
    };
    emitEvent(handle, "uploadError", payload);
    return payload;
  }

  const endpoint = args?.endpoint;
  const concurrency = normalizeConcurrency(args?.concurrency);
  // Opt-in: when chunkThreshold is set, files larger than it upload via the
  // chunked protocol (past the Cloudflare/per-request body caps). Smaller
  // files, and all files when unset, use a single POST as before.
  const chunkThreshold = normalizeChunkThreshold(args?.chunkThreshold);
  const chunkSize = normalizeChunkSize(args?.chunkSize);
  const results = [];
  let nextIndex = 0;
  let uploadedCount = 0;
  let failedCount = 0;
  const totalCount = selection.files.length;

  async function worker() {
    while (!selection.cancelled && nextIndex < totalCount) {
      const index = nextIndex++;
      const file = selection.files[index];
      emitEvent(handle, "uploadProgress", {
        currentFileIndex: index,
        currentFileName: file.name,
        uploadedCount,
        failedCount,
        totalCount,
      });
      const useChunked = chunkThreshold !== null && file.size > chunkThreshold;
      const result = useChunked
        ? await uploadOneFileChunked(
          handle,
          selection,
          endpoint,
          file,
          index,
          totalCount,
          chunkSize,
        )
        : await uploadOneFile(
          handle,
          selection,
          endpoint,
          file,
          index,
          totalCount,
        );
      results[index] = result;
      if (result.ok) {
        uploadedCount += 1;
      } else {
        failedCount += 1;
      }
      emitEvent(handle, "uploadProgress", {
        currentFileIndex: index,
        currentFileName: file.name,
        uploadedCount,
        failedCount,
        totalCount,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, totalCount) }, worker),
  );

  // A capture (paste/drop) during the upload starts a fresh selection for the
  // handle; only clear the map entry if it still points at this upload's
  // selection.
  if (selections.get(handle) === selection) {
    selections.delete(handle);
  }

  const failedResults = results.filter((result) => result && !result.ok);
  const payload = {
    success: failedCount === 0 && !selection.cancelled,
    cancelled: selection.cancelled,
    source: selection.source || null,
    inline: selection.inline || false,
    failedCount,
    failedFiles: failedResults.map((result) => ({
      error: result.error || null,
      name: result.name,
      status: result.status || null,
    })),
    results,
    totalCount,
    uploadedCount,
  };

  if (selection.cancelled || failedCount > 0) {
    emitEvent(handle, "uploadError", {
      ...payload,
      error: selection.cancelled
        ? "Upload cancelled"
        : failedUploadSummary(failedResults),
    });
  } else {
    emitEvent(handle, "filesUploaded", payload);
  }

  return payload;
}

async function uploadProvidedFile(args) {
  const file = args?.file;
  if (!(file instanceof globalThis.File)) {
    return { ok: false, error: "Missing file" };
  }
  const selection = args?.selection || {
    activeRequests: new Set(),
    cancelled: false,
  };
  if (!(selection.activeRequests instanceof Set)) {
    return { ok: false, error: "Invalid upload selection" };
  }
  const chunkThreshold = normalizeChunkThreshold(args?.chunkThreshold);
  const chunkSize = normalizeChunkSize(args?.chunkSize);
  const useChunked = chunkThreshold !== null && file.size > chunkThreshold;
  return useChunked
    ? await uploadOneFileChunked(
      args?.handle || "provided-file",
      selection,
      args?.endpoint,
      file,
      Number(args?.index) || 0,
      Number(args?.totalCount) || 1,
      chunkSize,
      false,
    )
    : await uploadOneFile(
      args?.handle || "provided-file",
      selection,
      args?.endpoint,
      file,
      Number(args?.index) || 0,
      Number(args?.totalCount) || 1,
      false,
    );
}

function cancel(args) {
  const handle = getHandle(args);
  if (!handle) return { success: false, error: "Missing upload handle" };
  const selection = selections.get(handle);
  if (selection) {
    selection.cancelled = true;
    for (const request of selection.activeRequests) {
      request.abort();
    }
  }
  selections.delete(handle);
  const payload = { success: true, cancelled: true };
  emitEvent(handle, "selectionCancelled", payload);
  return payload;
}

function cleanup(args) {
  const handle = getHandle(args);
  if (!handle) return;
  disableCapture({ handle });
  const selection = selections.get(handle);
  if (selection) {
    for (const request of selection.activeRequests) {
      request.abort();
    }
  }
  selections.delete(handle);
  eventDataStore.delete(handle);
  latestEventByHandle.delete(handle);
}

registerModule({
  selectFiles,
  upload,
  uploadProvidedFile,
  getEventData,
  cancel,
  cleanup,
  enableCapture,
  disableCapture,
  addFileFromBytes,
});
