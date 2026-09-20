const __v1 = 1;

function openInBrowser(args) {
  const handle = args.handle;
  try {
    const data = typeof args.json === "string"
      ? JSON.parse(args.json)
      : args.json;
    const xml = data?.xml;
    if (!xml) {
      return { handle, json: { success: false, error: "No XML content" } };
    }
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const newTab = window.open(url, "_blank");
    if (newTab) {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    return { handle, json: { success: true } };
  } catch (err) {
    return { handle, json: { success: false, error: err.message } };
  }
}

registerModule({
  openInBrowser,
});
