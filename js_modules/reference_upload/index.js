const __v1 = 1;

/**
 * Open a native file picker and upload the selected file to
 * POST /api/upload-reference-file?folder_id=...&name=...&mime_type=...
 *
 * The server-side endpoint auto-detects text vs binary by mime type and stores
 * accordingly (content column for text, asset_blobs + blob_hash for binary).
 *
 * @param {Object} args
 * @param {string|number|null} args.folderId - target folder id (or null for root)
 * @returns {Promise<Object>} { success, cancelled?, filename?, mimeType?, size?, error? }
 */
async function uploadFile(args) {
  try {
    if (!window.showOpenFilePicker) {
      return {
        success: false,
        error:
          "File System Access API not supported. Please use Chrome or Edge.",
      };
    }

    const folderId = args?.folderId ?? "";

    const [fileHandle] = await window.showOpenFilePicker({ multiple: false });
    const file = await fileHandle.getFile();
    const mimeType = file.type || "application/octet-stream";
    const arrayBuffer = await file.arrayBuffer();

    const params = new URLSearchParams({
      folder_id: folderId === null ? "" : String(folderId),
      name: file.name,
      mime_type: mimeType,
      description: "",
    });

    const resp = await fetch(`/api/upload-reference-file?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: arrayBuffer,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        success: false,
        error: `Upload failed: HTTP ${resp.status} ${text}`,
      };
    }

    const data = await resp.json().catch(() => ({}));
    return {
      success: true,
      filename: file.name,
      mimeType,
      size: arrayBuffer.byteLength,
      id: data.id,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Open a native directory picker and upload every file under it, preserving
 * the folder hierarchy. Each file is POSTed to /api/upload-reference-file with
 * `name` set to its path relative to the user's picked directory (including
 * the picked directory as the first segment). The server creates any missing
 * reference_folders rows under `folder_id` and places the file at the leaf.
 *
 * @param {Object} args
 * @param {string|number|null} args.folderId - parent folder id to nest under
 *   (or null for root)
 * @returns {Promise<Object>}
 */
async function uploadDirectory(args) {
  try {
    if (!window.showDirectoryPicker) {
      return {
        success: false,
        error:
          "File System Access API not supported. Please use Chrome or Edge.",
      };
    }

    const folderId = args?.folderId ?? "";
    const dirHandle = await window.showDirectoryPicker({ mode: "read" });

    const files = [];
    async function scan(dh, prefix) {
      for await (const entry of dh.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "file") {
          try {
            const fh = await dh.getFileHandle(entry.name);
            files.push({ path, fh });
          } catch (err) {
            console.error(`reference_upload: error reading ${path}:`, err);
          }
        } else if (entry.kind === "directory") {
          try {
            const sub = await dh.getDirectoryHandle(entry.name);
            await scan(sub, path);
          } catch (err) {
            console.error(`reference_upload: error reading dir ${path}:`, err);
          }
        }
      }
    }

    // Include the picked directory name as the first path segment so the
    // server creates <picked-dir> under the target folder_id.
    await scan(dirHandle, dirHandle.name);

    let uploadedCount = 0;
    let failedCount = 0;
    const failures = [];
    const concurrency = 3;
    let i = 0;
    while (i < files.length) {
      const batch = files.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (f) => {
          try {
            const file = await f.fh.getFile();
            const mimeType = file.type || "application/octet-stream";
            const arrayBuffer = await file.arrayBuffer();
            const params = new URLSearchParams({
              folder_id: folderId === null ? "" : String(folderId),
              name: f.path,
              mime_type: mimeType,
              description: "",
            });
            const resp = await fetch(
              `/api/upload-reference-file?${params}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/octet-stream" },
                body: arrayBuffer,
              },
            );
            return { path: f.path, ok: resp.ok, status: resp.status };
          } catch (err) {
            return { path: f.path, ok: false, error: err.message };
          }
        }),
      );
      for (const r of results) {
        if (r.ok) uploadedCount += 1;
        else {
          failedCount += 1;
          failures.push(r);
        }
      }
      i += concurrency;
    }

    return {
      success: failedCount === 0,
      fileCount: uploadedCount,
      failedCount,
      directoryName: dirHandle.name,
      failures: failures.slice(0, 10),
    };
  } catch (err) {
    if (err.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err.message };
  }
}

function cleanup(_handle) {}

registerModule({
  uploadFile,
  uploadDirectory,
  cleanup,
});
