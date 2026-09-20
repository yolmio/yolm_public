// deno-lint-ignore-file no-undef

import MsgReader from "@kenjiuno/msgreader";
import { findInlineAttachment } from "./inline_attachment";

const MAX_MSG_BYTES = 100 * 1024 * 1024;
const MsgReaderConstructor = typeof MsgReader === "function"
  ? MsgReader
  : MsgReader.default;
const instances = new Map();

function parseArgs(args) {
  if (!args) return {};
  const base = typeof args === "object" ? { ...args } : {};
  delete base.json;
  if (typeof args.json === "string") {
    try {
      return { ...base, ...JSON.parse(args.json) };
    } catch {
      return base;
    }
  }
  return { ...base, ...(args.json || {}) };
}

function moduleResult(handle, json) {
  return { handle, json };
}

function requiredMount(elementId) {
  const mount = document.getElementById(elementId);
  if (!mount) {
    throw new Error("The Outlook message viewer mount is unavailable.");
  }
  return mount;
}

function emitError(handle, error) {
  const message = error instanceof Error ? error.message : String(error);
  emit("error", { handle, json: { message } });
  return moduleResult(handle, { success: false, error: message });
}

function recipientText(recipients, type) {
  return (recipients || [])
    .filter((recipient) =>
      String(recipient.recipType || "to").toLowerCase() === type
    )
    .map((recipient) => recipient.name || recipient.email)
    .filter(Boolean)
    .join(", ");
}

function attachmentContentType(fileName) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase();
  return ({
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    pdf: "application/pdf",
    png: "image/png",
    txt: "text/plain",
    webp: "image/webp",
  })[extension] || "application/octet-stream";
}

function messageBodySrcdoc(reader, message, objectUrls) {
  const documentParser = new DOMParser();
  const bodyDocument = documentParser.parseFromString(
    message.bodyHtml,
    "text/html",
  );
  for (const element of bodyDocument.querySelectorAll("[src]")) {
    const source = element.getAttribute("src");
    const metadata = findInlineAttachment(message.attachments, source);
    if (!metadata) continue;
    try {
      const attachment = reader.getAttachment(metadata);
      if (!attachment?.content) continue;
      const name = attachment.fileName || metadata.fileName ||
        metadata.fileNameShort;
      const blob = new Blob([attachment.content], {
        type: metadata.attachMimeTag || attachmentContentType(name),
      });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      element.setAttribute("src", url);
    } catch {
      // A broken inline attachment should not prevent the rest of the email
      // from rendering.
    }
  }

  const charset = bodyDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const contentSecurityPolicy = bodyDocument.createElement("meta");
  contentSecurityPolicy.setAttribute(
    "http-equiv",
    "Content-Security-Policy",
  );
  contentSecurityPolicy.setAttribute(
    "content",
    "default-src 'none'; base-uri 'none'; form-action 'none'; img-src data: blob:; style-src 'unsafe-inline'",
  );
  const viewerStyle = bodyDocument.createElement("style");
  viewerStyle.textContent =
    "body{color:#101828;font:14px/1.5 system-ui,sans-serif;margin:0;padding:20px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}";
  bodyDocument.head.prepend(charset, contentSecurityPolicy, viewerStyle);
  return `<!doctype html>${bodyDocument.documentElement.outerHTML}`;
}

function addMessageField(container, label, value) {
  if (!value) return;
  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gap = "0.5rem";
  row.style.gridTemplateColumns = "4rem minmax(0, 1fr)";
  row.style.marginTop = "0.35rem";
  const key = document.createElement("span");
  key.textContent = label;
  key.style.color = "#667085";
  const content = document.createElement("span");
  content.textContent = value;
  content.style.overflowWrap = "anywhere";
  row.append(key, content);
  container.append(row);
}

class OutlookMessageViewer {
  constructor({ handle, elementId, fileUrl, fileName }) {
    this.handle = handle;
    this.mount = requiredMount(elementId);
    this.fileUrl = fileUrl;
    this.fileName = fileName || "message.msg";
    this.abortController = new AbortController();
    this.objectUrls = [];
    this.destroyed = false;
  }

  async initialize() {
    this.mount.innerHTML = "";
    const loading = document.createElement("div");
    loading.textContent = "Opening Outlook message…";
    Object.assign(loading.style, {
      color: "#667085",
      padding: "2rem",
      textAlign: "center",
    });
    this.mount.append(loading);
    const response = await fetch(this.fileUrl, {
      credentials: "same-origin",
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error("The Outlook message could not be downloaded.");
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_MSG_BYTES) {
      throw new Error("This Outlook message is too large to preview safely.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_MSG_BYTES) {
      throw new Error("This Outlook message is too large to preview safely.");
    }
    if (this.destroyed) return;
    const reader = new MsgReaderConstructor(buffer);
    const message = reader.getFileData();
    if (message.error) throw new Error(String(message.error));
    this.render(reader, message);
    emit("ready", {
      handle: this.handle,
      json: { attachmentCount: message.attachments?.length || 0 },
    });
  }

  render(reader, message) {
    this.mount.innerHTML = "";
    Object.assign(this.mount.style, {
      background: "#f5f6f8",
      height: "100%",
      minHeight: "0",
      overflow: "auto",
      padding: "1rem",
    });
    const card = document.createElement("article");
    Object.assign(card.style, {
      background: "white",
      border: "1px solid #d0d5dd",
      borderRadius: "0.5rem",
      boxShadow: "0 1px 2px rgba(16, 24, 40, 0.06)",
      color: "#101828",
      margin: "0 auto",
      maxWidth: "72rem",
      minHeight: "calc(100% - 2px)",
      overflow: "hidden",
    });
    const header = document.createElement("header");
    Object.assign(header.style, {
      borderBottom: "1px solid #eaecf0",
      padding: "1rem 1.25rem",
    });
    const subject = document.createElement("h1");
    subject.textContent = message.subject || this.fileName;
    Object.assign(subject.style, {
      fontSize: "1.15rem",
      fontWeight: "650",
      margin: "0 0 0.75rem",
    });
    header.append(subject);
    const sender = [message.senderName, message.senderEmail]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" <")
      .replace(/<([^<>]+)$/, "<$1>");
    addMessageField(header, "From", sender);
    addMessageField(header, "To", recipientText(message.recipients, "to"));
    addMessageField(header, "Cc", recipientText(message.recipients, "cc"));
    addMessageField(
      header,
      "Date",
      message.messageDeliveryTime || message.clientSubmitTime ||
        message.creationTime,
    );
    card.append(header);

    if (message.attachments?.length) {
      const attachments = document.createElement("section");
      Object.assign(attachments.style, {
        borderBottom: "1px solid #eaecf0",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        padding: "0.75rem 1.25rem",
      });
      for (const metadata of message.attachments) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = metadata.fileName || metadata.fileNameShort ||
          "Attachment";
        Object.assign(button.style, {
          background: "#f9fafb",
          border: "1px solid #d0d5dd",
          borderRadius: "0.35rem",
          color: "#344054",
          cursor: "pointer",
          font: "inherit",
          fontSize: "0.82rem",
          padding: "0.4rem 0.65rem",
        });
        button.addEventListener("click", () => {
          try {
            const attachment = reader.getAttachment(metadata);
            if (!attachment?.content) {
              throw new Error("The attachment could not be read.");
            }
            const name = attachment.fileName || button.textContent;
            const blob = new Blob([attachment.content], {
              type: metadata.attachMimeTag || attachmentContentType(name),
            });
            const url = URL.createObjectURL(blob);
            this.objectUrls.push(url);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = name;
            anchor.click();
          } catch (error) {
            emit("error", {
              handle: this.handle,
              json: {
                message: error instanceof Error
                  ? error.message
                  : "The attachment could not be downloaded.",
              },
            });
          }
        });
        attachments.append(button);
      }
      card.append(attachments);
    }

    const body = document.createElement("section");
    body.style.minHeight = "20rem";
    if (message.bodyHtml) {
      const frame = document.createElement("iframe");
      frame.title = "Message body";
      // Blob URLs inherit the parent origin, so the sandbox must preserve that
      // origin for resolved inline images. Scripts remain disabled.
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.referrerPolicy = "no-referrer";
      Object.assign(frame.style, {
        border: "0",
        display: "block",
        minHeight: "32rem",
        width: "100%",
      });
      frame.srcdoc = messageBodySrcdoc(reader, message, this.objectUrls);
      body.append(frame);
    } else {
      const text = document.createElement("pre");
      text.textContent = message.body || "This message has no readable body.";
      Object.assign(text.style, {
        font: "14px/1.5 system-ui, sans-serif",
        margin: "0",
        overflowWrap: "anywhere",
        padding: "1.25rem",
        whiteSpace: "pre-wrap",
      });
      body.append(text);
    }
    card.append(body);
    this.mount.append(card);
  }

  download() {
    const anchor = document.createElement("a");
    anchor.href = this.fileUrl;
    anchor.download = this.fileName;
    anchor.rel = "noreferrer";
    anchor.click();
  }

  destroy() {
    this.destroyed = true;
    this.abortController.abort();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.mount.innerHTML = "";
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const instance = new OutlookMessageViewer({ ...data, handle });
    instances.set(handle, instance);
    await instance.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    if (error?.name === "AbortError") {
      return moduleResult(handle, { success: false, aborted: true });
    }
    return emitError(handle, error);
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

registerModule({ initialize, download, cleanup });
