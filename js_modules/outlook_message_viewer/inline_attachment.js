export function normalizeContentId(value) {
  if (!value) return "";
  let normalized = String(value).trim().replace(/^cid:/i, "").trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original value when an email contains malformed URL escapes.
  }
  return normalized.replace(/^<|>$/g, "").trim().toLowerCase();
}

export function findInlineAttachment(attachments, source) {
  if (!/^cid:/i.test(source || "")) return undefined;
  const sourceContentId = normalizeContentId(source);
  return (attachments || []).find((attachment) =>
    normalizeContentId(attachment.pidContentId) === sourceContentId
  );
}
