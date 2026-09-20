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

async function findExportFiles(dirHandle) {
  let manifest = null;
  let mapping = null;
  const parquetFiles = new Map(); // hash -> fileHandle

  try {
    const manifestHandle = await dirHandle.getFileHandle("manifest.json");
    const manifestFile = await manifestHandle.getFile();
    manifest = JSON.parse(await manifestFile.text());
  } catch (e) {
    return { error: "No manifest.json found in selected directory" };
  }

  try {
    const mappingHandle = await dirHandle.getFileHandle("mapping.json");
    const mappingFile = await mappingHandle.getFile();
    mapping = JSON.parse(await mappingFile.text());
  } catch (e) {
    return {
      error:
        "No mapping.json found in selected directory. Select the extracted export_data folder.",
    };
  }

  // Look for parquet files in data/ subdirectory first, then root
  try {
    const dataDir = await dirHandle.getDirectoryHandle("data");
    for await (const entry of dataDir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".parquet")) {
        const hash = entry.name.replace(".parquet", "");
        parquetFiles.set(hash, await dataDir.getFileHandle(entry.name));
      }
    }
  } catch (e) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.endsWith(".parquet")) {
        const hash = entry.name.replace(".parquet", "");
        parquetFiles.set(hash, await dirHandle.getFileHandle(entry.name));
      }
    }
  }
  return { manifest, mapping, parquetFiles };
}

async function checkExistingChunks(hashes) {
  const response = await fetch("/api/check-chunks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hashes }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to check existing chunks");
  }
  return await response.json();
}

async function uploadExport(databaseName, manifest, mapping, parquetFiles, missingHashes) {
  const formData = new FormData();
  formData.append("sourceId", databaseName);
  formData.append("sourceName", databaseName);
  formData.append("manifest", JSON.stringify(manifest));
  formData.append("mapping", JSON.stringify(mapping));
  for (const hash of missingHashes) {
    const fileHandle = parquetFiles.get(hash);
    if (fileHandle) {
      formData.append(`chunk_${hash}`, await fileHandle.getFile());
    }
  }
  const response = await fetch("/api/upload-export", {
    method: "POST",
    body: formData,
  });
  const bodyText = await response.text();
  let payload = null;
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      if (!response.ok) {
        throw new Error(`Upload failed (${response.status}): ${bodyText}`);
      }
      throw new Error(`Upload returned invalid JSON: ${bodyText}`);
    }
  }
  if (!response.ok) {
    throw new Error(
      payload?.error || `Upload failed (${response.status}): ${response.statusText}`,
    );
  }
  return payload || {};
}

async function scanDirectory(args) {
  const handle = args?.handle;
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "read" });
    const { manifest, mapping, parquetFiles, error } = await findExportFiles(dirHandle);
    if (error) {
      const errorData = { success: false, error };
      eventDataStore.set(handle, errorData);
      emit("scanError", { handle, json: errorData });
      return;
    }
    const allHashSet = new Set();
    const manifestTables = [];
    for (const table of (manifest.tables || [])) {
      const tableName = table.outputName || table.name || "(unknown)";
      manifestTables.push({
        name: tableName,
        chunkCount: (table.chunks || []).length,
      });
      for (const chunk of (table.chunks || [])) {
        if (chunk.hash) {
          allHashSet.add(chunk.hash);
        }
      }
    }
    const allHashes = Array.from(allHashSet);
    const missingChunkFiles = allHashes.filter((hash) => !parquetFiles.has(hash));
    if (missingChunkFiles.length > 0) {
      const preview = missingChunkFiles.slice(0, 5).join(", ");
      const suffix = missingChunkFiles.length > 5 ? ", ..." : "";
      const errorData = {
        success: false,
        error: `Missing ${missingChunkFiles.length} chunk file(s): ${preview}${suffix}`,
      };
      eventDataStore.set(handle, errorData);
      emit("scanError", { handle, json: errorData });
      return;
    }

    let totalBytes = 0;
    const fileInfos = [];
    const manifestSize = JSON.stringify(manifest).length;
    const mappingSize = JSON.stringify(mapping).length;
    totalBytes += manifestSize + mappingSize;
    fileInfos.push({ name: "manifest.json", size: manifestSize, type: "manifest" });
    fileInfos.push({ name: "mapping.json", size: mappingSize, type: "mapping" });
    for (const [hash, fileHandle] of parquetFiles) {
      const file = await fileHandle.getFile();
      totalBytes += file.size;
      fileInfos.push({ name: file.name, size: file.size, hash, type: "chunk" });
    }
    pendingUploads.set(handle, {
      dirHandle,
      manifest,
      mapping,
      parquetFiles,
      allHashes,
    });
    const scanData = {
      success: true,
      folderName: dirHandle.name,
      fileCount: parquetFiles.size + 2,
      totalBytes,
      chunkCount: allHashes.length,
      tableCount: (manifest.tables || []).length,
      tables: manifestTables,
      exportId: manifest.exportId,
      source: manifest.source,
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
  if (!databaseName) {
    const errorData = { success: false, error: "Database name is required" };
    eventDataStore.set(handle, errorData);
    emit("uploadError", { handle, json: errorData });
    return;
  }
  try {
    emit("uploadProgress", { handle, json: {
      stage: "checking",
      message: `Checking ${pending.allHashes.length} chunks...`,
      totalChunks: pending.allHashes.length,
    }});
    const { existing, missing } = await checkExistingChunks(pending.allHashes);
    emit("uploadProgress", { handle, json: {
      stage: "uploading",
      message: `Uploading ${missing.length} chunks...`,
      existingChunks: existing.length,
      missingChunks: missing.length,
    }});
    const backendResponse = await uploadExport(
      databaseName,
      pending.manifest,
      pending.mapping,
      pending.parquetFiles,
      missing,
    );
    if (!backendResponse.success) {
      const errorData = { success: false, error: backendResponse.error || "Upload failed" };
      eventDataStore.set(handle, errorData);
      emit("uploadError", { handle, json: errorData });
      return;
    }
    const tables = (backendResponse.tables || []).map((t) => ({
      tableName: t.name,
      rowCount: t.rowCount,
      columnCount: t.columnCount,
    }));
    const resultData = {
      success: true,
      databaseId: backendResponse.databaseId,
      databaseName: backendResponse.databaseName,
      contentHash: backendResponse.contentHash,
      wasDeduplicated: backendResponse.wasDeduplicated,
      origin: "export_import",
      directoryName: pending.dirHandle.name,
      chunksProcessed: backendResponse.chunksProcessed,
      chunksSkipped: existing.length,
      totalChunks: pending.allHashes.length,
      tables,
      exportId: pending.manifest.exportId,
      source: pending.manifest.source,
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
