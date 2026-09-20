const __v2 = 1;
// Set up a global event listener using capture phase to intercept file selections
// before Yolm processes them. This ensures we can capture the file reference.
document.addEventListener("change", (e) => {
  if (
    e.target && e.target.type === "file" && e.target.files &&
    e.target.files.length > 0
  ) {
    window._yolmSelectedFile = e.target.files[0];
  }
}, true); // true = capture phase, runs before other handlers

/**
 * Check if a file has been selected and is ready to read
 * @returns {Object} Result with success and file info if available
 */
function getSelectedFileInfo(args) {
  const file = window._yolmSelectedFile;
  if (!file) {
    return { success: false, hasFile: false, error: "No file selected" };
  }
  return {
    success: true,
    hasFile: true,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}

/**
 * Read the stored file and return raw bytes (Uint8Array)
 * Returns: { json: {success, filename, mimeType, size}, bytes: {content: Uint8Array} }
 * @returns {Promise<Object>} Result with json metadata and bytes content
 */
async function readFileAsBytes() {
  try {
    const file = window._yolmSelectedFile;

    if (!file) {
      return {
        json: {
          success: false,
          error: "No file selected. Select a file first..",
        },
      };
    }

    console.log("[file_reader] Reading file as bytes:", file.name);

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Clear the stored file reference after reading
    window._yolmSelectedFile = null;

    console.log("[file_reader] Successfully read file, size:", bytes.length);

    return {
      json: {
        success: true,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: bytes.length,
      },
      bytes: {
        content: bytes,
      },
    };
  } catch (err) {
    console.error("[file_reader] Error reading file:", err);
    return {
      json: { success: false, error: err.message },
    };
  }
}

/**
 * Clear the stored file reference
 */
function clearSelectedFile(args) {
  window._yolmSelectedFile = null;
  return { success: true };
}

registerModule({
  getSelectedFileInfo,
  readFileAsBytes,
  clearSelectedFile,
});
