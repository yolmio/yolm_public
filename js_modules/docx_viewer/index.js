// deno-lint-ignore-file no-undef

import DOMPurify from "dompurify";
import * as mammothModule from "mammoth";
import {
  downloadUrl,
  fetchLimited,
  moduleResult,
  parseArgs,
  previewPart,
  requiredMount,
} from "../_drive_preview/common";

const MAX_DOCX_BYTES = 100 * 1024 * 1024;
const instances = new Map();
const mammoth = mammothModule.default || mammothModule;

function safeDocumentHtml(html, documentCss) {
  const sanitized = DOMPurify.sanitize(html, {
    FORBID_ATTR: ["href", "srcset", "style"],
    FORBID_TAGS: ["embed", "form", "iframe", "object", "script", "style"],
  });
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  for (const image of parsed.querySelectorAll("img")) {
    if (!String(image.getAttribute("src") || "").startsWith("data:image/")) {
      image.removeAttribute("src");
    }
  }
  const body = parsed.body.innerHTML;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src 'unsafe-inline'"><style>${documentCss}</style></head><body>${body}</body></html>`;
}

class DocxViewer {
  constructor({ handle, elementId, fileUrl, fileName, documentCss }) {
    this.handle = handle;
    this.mount = requiredMount(elementId, "DOCX viewer");
    this.fileUrl = fileUrl;
    this.fileName = fileName || "document.docx";
    this.documentCss = documentCss;
    this.abortController = new AbortController();
    this.destroyed = false;
  }

  async initialize() {
    const buffer = await fetchLimited(
      this.fileUrl,
      MAX_DOCX_BYTES,
      this.abortController.signal,
      "This DOCX document",
    );
    if (this.destroyed) return;
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    if (this.destroyed) return;
    this.render(result);
    emit("ready", {
      handle: this.handle,
      json: { warningCount: result.messages?.length || 0 },
    });
  }

  render(result) {
    this.mount.innerHTML = "";
    previewPart(this.mount, "docx-mount");
    const frame = document.createElement("iframe");
    frame.title = `Preview of ${this.fileName}`;
    frame.setAttribute("sandbox", "");
    frame.referrerPolicy = "no-referrer";
    previewPart(frame, "docx-frame");
    frame.srcdoc = safeDocumentHtml(
      result.value || "",
      this.documentCss.replace(
        /var\((--[\w-]+)\)/g,
        (_, name) => getComputedStyle(this.mount).getPropertyValue(name),
      ),
    );
    this.mount.append(frame);
  }

  download() {
    downloadUrl(this.fileUrl, this.fileName);
  }

  destroy() {
    this.destroyed = true;
    this.abortController.abort();
    this.mount.innerHTML = "";
  }
}

async function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  try {
    instances.get(handle)?.destroy();
    const instance = new DocxViewer({ ...data, handle });
    instances.set(handle, instance);
    await instance.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
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
