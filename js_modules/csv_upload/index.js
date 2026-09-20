const __v2 = 1;
const eventDataStore = new Map();
const pendingUploads = new Map();

function getEventData(args) {
  const handle = args?.handle;
  if (!handle || !eventDataStore.has(handle)) {
    return null;
  }
  const data = eventDataStore.get(handle);
  eventDataStore.delete(handle);
  return data;
}

async function findCsvFiles(dirHandle, basePath = "") {
  const csvFiles = [];
  for await (const entry of dirHandle.values()) {
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".csv")) {
      const fileHandle = await dirHandle.getFileHandle(entry.name);
      csvFiles.push({ path, fileHandle });
    } else if (entry.kind === "directory") {
      const subDir = await dirHandle.getDirectoryHandle(entry.name);
      csvFiles.push(...await findCsvFiles(subDir, path));
    }
  }
  return csvFiles;
}

async function uploadToBackend(databaseName, files) {
  const formData = new FormData();
  formData.append("databaseName", databaseName);
  formData.append("delimiter", ",");
  formData.append("hasHeader", "true");
  formData.append("fileType", "csv");
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  const response = await fetch("/api/upload-source-data", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const body = await response.text();
    let payload = null;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      // Keep raw body fallback below.
    }
    throw new Error(payload?.error || body || "Upload failed");
  }
  return await response.json();
}

function normalizeTables(tablesPayload) {
  if (Array.isArray(tablesPayload)) {
    return tablesPayload.map((row) => ({
      tableName: row.tableName || row.name || "(unknown)",
      rowCount: row.rowCount ?? 0,
      columnCount: row.columnCount ?? 0,
    }));
  }
  return Object.entries(tablesPayload || {}).map(([tableName, info]) => ({
    tableName,
    rowCount: info?.rowCount ?? 0,
    columnCount: info?.columnCount ?? 0,
  }));
}

async function scanDirectory(args) {
  const handle = args?.handle;
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "read" });
    const csvFileEntries = await findCsvFiles(dirHandle);
    if (csvFileEntries.length === 0) {
      const errorData = { success: false, error: "No CSV files found in the selected directory" };
      eventDataStore.set(handle, errorData);
      emit("scanError", { handle, json: errorData });
      return;
    }
    let totalBytes = 0;
    const fileInfos = [];
    for (const { path, fileHandle } of csvFileEntries) {
      const file = await fileHandle.getFile();
      totalBytes += file.size;
      fileInfos.push({ name: file.name, size: file.size, path });
    }
    pendingUploads.set(handle, { dirHandle, csvFileEntries });
    const scanData = {
      success: true,
      folderName: dirHandle.name,
      fileCount: csvFileEntries.length,
      totalBytes,
      files: fileInfos,
    };
    eventDataStore.set(handle, scanData);
    emit("directoryScanned", { handle, json: scanData });
  } catch (err) {
    if (err.name === "AbortError") {
      const data = { success: false, cancelled: true };
      eventDataStore.set(handle, data);
      emit("scanError", { handle, json: data });
      return;
    }
    const errorData = { success: false, error: err.message || "Unknown error" };
    eventDataStore.set(handle, errorData);
    emit("scanError", { handle, json: errorData });
  }
}

async function confirmUpload(args) {
  const handle = args?.handle;
  const databaseName = args?.databaseName;
  const pending = pendingUploads.get(handle);
  if (!pending) {
    const errorData = { success: false, error: "No pending upload found. Please scan a directory first." };
    eventDataStore.set(handle, errorData);
    emit("uploadError", { handle, json: errorData });
    return;
  }
  try {
    const files = [];
    const pathMap = new Map();
    for (const { path, fileHandle } of pending.csvFileEntries) {
      const file = await fileHandle.getFile();
      files.push(file);
      pathMap.set(file.name.replace(/\.csv$/i, ""), path);
    }
    const backendResponse = await uploadToBackend(databaseName, files);
    if (!backendResponse.success) {
      const errorData = { success: false, error: backendResponse.error || "Upload failed" };
      eventDataStore.set(handle, errorData);
      emit("uploadError", { handle, json: errorData });
      return;
    }
    const tables = normalizeTables(backendResponse.tables).map((table) => ({
      tableName: table.tableName,
      rowCount: table.rowCount,
      columnCount: table.columnCount,
      path: pathMap.get(table.tableName) || table.tableName,
    }));
    const resultData = {
      success: true,
      databaseId: backendResponse.databaseId,
      databaseName: backendResponse.databaseName,
      contentHash: backendResponse.contentHash,
      wasDeduplicated: backendResponse.wasDeduplicated,
      origin: "csv_import",
      directoryName: pending.dirHandle.name,
      fileCount: files.length,
      successCount: tables.length,
      tables,
    };
    eventDataStore.set(handle, resultData);
    emit("filesUploaded", { handle, json: resultData });
  } catch (err) {
    const errorData = { success: false, error: err.message || "Unknown error" };
    eventDataStore.set(handle, errorData);
    emit("uploadError", { handle, json: errorData });
  } finally {
    pendingUploads.delete(handle);
  }
}

function cancelScan(args) {
  const handle = args?.handle;
  pendingUploads.delete(handle);
  eventDataStore.delete(handle);
}

function cleanup(handle) {
  pendingUploads.delete(handle);
  eventDataStore.delete(handle);
}

registerModule({
  scanDirectory,
  confirmUpload,
  cancelScan,
  getEventData,
  cleanup,
});
