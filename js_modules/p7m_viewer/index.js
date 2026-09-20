// deno-lint-ignore-file no-undef

import { fromBER } from "asn1js";
import { Certificate, ContentInfo, SignedData } from "pkijs";
import {
  downloadUrl,
  fetchLimited,
  formatBytes,
  moduleResult,
  parseArgs,
  previewPart,
  requiredMount,
} from "../_drive_preview/common";

const MAX_P7M_BYTES = 128 * 1024 * 1024;
const SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const instances = new Map();

function base64Bytes(value) {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cmsBytes(source) {
  const bytes = new Uint8Array(source);
  if (bytes[0] === 0x30) return bytes;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const pem = text.match(
    /-----BEGIN (?:PKCS7|CMS)-----([\s\S]*?)-----END (?:PKCS7|CMS)-----/i,
  );
  if (pem) return base64Bytes(pem[1]);
  const mimeBody = text.split(/\r?\n\r?\n/).slice(1).join("\n\n");
  if (/content-transfer-encoding:\s*base64/i.test(text) && mimeBody) {
    const candidate = mimeBody.split(/^--/m)[0].trim();
    try {
      return base64Bytes(candidate);
    } catch {
      // Fall through to the structured parse error below.
    }
  }
  throw new Error(
    "This signed file could not be read. Try downloading it and opening it in your signing app.",
  );
}

function octetBytes(octetString) {
  if (!octetString) return null;
  const direct = octetString.valueBlock?.valueHexView;
  if (direct?.byteLength) return new Uint8Array(direct);
  const chunks = octetString.valueBlock?.value;
  if (!Array.isArray(chunks) || !chunks.length) return null;
  const values = chunks
    .map((chunk) => chunk.valueBlock?.valueHexView)
    .filter((chunk) => chunk?.byteLength)
    .map((chunk) => new Uint8Array(chunk));
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const value of values) {
    joined.set(value, offset);
    offset += value.byteLength;
  }
  return joined;
}

function distinguishedName(name) {
  if (!name?.typesAndValues) return "Unavailable";
  return name.typesAndValues.map((item) => {
    const label = ({
      "2.5.4.3": "Name",
      "2.5.4.6": "Country",
      "2.5.4.7": "City",
      "2.5.4.10": "Organization",
      "2.5.4.11": "Department",
    })[item.type] || item.type;
    const value = item.value?.valueBlock?.value ??
      item.value?.valueBlock?.valueHexView?.toString() ?? "";
    return `${label}=${value}`;
  }).join(", ");
}

function hex(bytes) {
  return Array.from(bytes || [], (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function certificateFor(signedData, index) {
  const certificates = (signedData.certificates || []).filter((item) =>
    item instanceof Certificate
  );
  const signer = signedData.signerInfos[index];
  const serial = signer?.sid?.serialNumber?.valueBlock?.valueHexView;
  if (serial) {
    const expected = hex(serial);
    const match = certificates.find((certificate) =>
      hex(certificate.serialNumber?.valueBlock?.valueHexView) === expected &&
      certificate.issuer?.isEqual?.(signer.sid.issuer)
    );
    if (match) return match;
  }
  return certificates[index] || certificates[0] || null;
}

function payloadType(bytes) {
  if (!bytes?.length) return { kind: "none", mime: "application/octet-stream" };
  if (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return { kind: "pdf", mime: "application/pdf" };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return { kind: "zip", mime: "application/zip" };
  }
  const sample = new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.slice(0, 4096),
  );
  if (!sample.includes("\u0000") && /[\w\s]/.test(sample)) {
    return { kind: "text", mime: "text/plain;charset=utf-8" };
  }
  return { kind: "binary", mime: "application/octet-stream" };
}

function addField(container, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  previewPart(term, "signature-term");
  const detail = document.createElement("dd");
  detail.textContent = value || "Unavailable";
  previewPart(detail, "signature-detail");
  container.append(term, detail);
}

class P7mViewer {
  constructor({ handle, elementId, fileUrl, fileName }) {
    this.handle = handle;
    this.mount = requiredMount(elementId, "P7M viewer");
    this.fileUrl = fileUrl;
    this.fileName = fileName || "signed-file.p7m";
    this.abortController = new AbortController();
    this.objectUrls = [];
    this.destroyed = false;
  }

  async initialize() {
    const source = await fetchLimited(
      this.fileUrl,
      MAX_P7M_BYTES,
      this.abortController.signal,
      "This P7M file",
    );
    if (this.destroyed) return;
    const encoded = cmsBytes(source);
    const asn1 = fromBER(encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ));
    if (asn1.offset === -1) {
      throw new Error("This signed file is damaged or incomplete.");
    }
    const contentInfo = new ContentInfo({ schema: asn1.result });
    if (contentInfo.contentType !== SIGNED_DATA_OID) {
      throw new Error(
        "This file does not contain a supported digital signature.",
      );
    }
    this.signedData = new SignedData({ schema: contentInfo.content });
    this.payload = octetBytes(this.signedData.encapContentInfo.eContent);
    this.verifications = [];
    for (let index = 0; index < this.signedData.signerInfos.length; index++) {
      const certificate = certificateFor(this.signedData, index);
      if (!certificate) {
        this.verifications.push({
          ok: null,
          error: "The signer’s certificate is not included in this file.",
        });
        continue;
      }
      try {
        const result = await this.signedData.verify({
          checkChain: false,
          extendedMode: true,
          signer: index,
        });
        this.verifications.push({
          ok: typeof result === "boolean"
            ? result
            : result.signatureVerified === true
            ? true
            : result.signatureVerified === false
            ? false
            : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.verifications.push({
          ok: error?.signatureVerified === false ||
              (message.toLowerCase().includes("digest") &&
                message.toLowerCase().includes("match"))
            ? false
            : null,
          error:
            "The signature could not be checked here. Try opening the file in your signing app.",
        });
      }
    }
    if (this.destroyed) return;
    this.render();
    emit("ready", {
      handle: this.handle,
      json: {
        hasEmbeddedContent: Boolean(this.payload),
        signerCount: this.signedData.signerInfos.length,
      },
    });
  }

  render() {
    this.mount.innerHTML = "";
    previewPart(this.mount, "signature-mount");
    const card = previewPart(
      document.createElement("article"),
      "signature-card",
    );
    const status = previewPart(
      document.createElement("div"),
      "signature-status",
    );
    const allVerified = this.verifications.length > 0 &&
      this.verifications.every((verification) => verification.ok === true);
    const anyFailed = this.verifications.some((verification) =>
      verification.ok === false
    );
    status.append(
      this.statusBadge(
        "Signature check",
        allVerified ? "Verified" : anyFailed ? "Failed" : "Not verifiable",
        allVerified ? "success" : anyFailed ? "danger" : "warning",
      ),
      this.statusBadge(
        "Signer identity",
        "Not checked",
        "warning",
      ),
      this.statusBadge(
        "Included file",
        this.payload
          ? formatBytes(this.payload.byteLength)
          : "No file included",
        this.payload ? "primary" : "neutral",
      ),
    );
    card.append(status);
    const trustNotice = document.createElement("div");
    trustNotice.textContent =
      "This checks whether the file matches its signature. It does not confirm the signer’s identity or whether the signature is legally valid.";
    previewPart(trustNotice, "signature-notice");
    card.append(trustNotice);
    for (let index = 0; index < this.signedData.signerInfos.length; index++) {
      card.append(this.signerSection(index));
    }
    card.append(this.payloadSection());
    this.mount.append(card);
  }

  statusBadge(label, value, tone) {
    const badge = previewPart(document.createElement("div"), "signature-badge");
    const heading = document.createElement("div");
    heading.textContent = label;
    previewPart(heading, "signature-label");
    const result = document.createElement("div");
    result.textContent = value;
    previewPart(result, "signature-result");
    result.dataset.previewTone = tone;
    badge.append(heading, result);
    return badge;
  }

  signerSection(index) {
    const certificate = certificateFor(this.signedData, index);
    const section = previewPart(
      document.createElement("section"),
      "signature-section",
    );
    const heading = document.createElement("h2");
    heading.textContent = `Signer ${index + 1}`;
    previewPart(heading, "signature-heading");
    const fields = previewPart(
      document.createElement("dl"),
      "signature-fields",
    );
    addField(fields, "Signed by", distinguishedName(certificate?.subject));
    addField(
      fields,
      "Certificate issued by",
      distinguishedName(certificate?.issuer),
    );
    addField(
      fields,
      "Valid from",
      certificate?.notBefore?.value?.toLocaleString?.() || "Unavailable",
    );
    addField(
      fields,
      "Valid until",
      certificate?.notAfter?.value?.toLocaleString?.() || "Unavailable",
    );
    addField(
      fields,
      "Certificate number",
      hex(certificate?.serialNumber?.valueBlock?.valueHexView) || "Unavailable",
    );
    addField(
      fields,
      "Signature check",
      this.verifications[index]?.ok === true
        ? "Verified"
        : this.verifications[index]?.ok === false
        ? "Failed: the file does not match its signature."
        : this.verifications[index]?.error || "Not verifiable",
    );
    section.append(heading, fields);
    return section;
  }

  payloadSection() {
    const section = previewPart(
      document.createElement("section"),
      "signature-content",
    );
    const heading = document.createElement("h2");
    heading.textContent = "Signed content";
    previewPart(heading, "signature-content-heading");
    section.append(heading);
    if (!this.payload) {
      const empty = document.createElement("p");
      empty.textContent =
        "This signature does not include a file. You may need the original document to check it.";
      previewPart(empty, "signature-empty");
      section.append(empty);
      return section;
    }
    const type = payloadType(this.payload);
    const payloadName = this.fileName.replace(/\.p7m$/i, "") ||
      "signed-content.bin";
    const blob = new Blob([this.payload], { type: type.mime });
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    const actions = previewPart(
      document.createElement("div"),
      "signature-file",
    );
    this.payloadUrl = url;
    this.payloadName = payloadName;
    const details = document.createElement("span");
    details.textContent = `${payloadName} · ${
      formatBytes(this.payload.byteLength)
    }`;
    previewPart(details, "signature-file-detail");
    actions.append(details);
    section.append(actions);
    if (type.kind === "pdf") {
      const frame = document.createElement("iframe");
      frame.title = "Embedded signed PDF";
      frame.src = url;
      previewPart(frame, "signature-pdf");
      section.append(frame);
    } else if (type.kind === "text") {
      const text = document.createElement("pre");
      text.textContent = new TextDecoder("utf-8", { fatal: false }).decode(
        this.payload.slice(0, 1024 * 1024),
      );
      previewPart(text, "signature-text");
      section.append(text);
      if (this.payload.byteLength > 1024 * 1024) {
        const truncated = document.createElement("p");
        truncated.textContent = "Text preview limited to the first 1 MB.";
        previewPart(truncated, "signature-truncated");
        section.append(truncated);
      }
    }
    return section;
  }

  download() {
    downloadUrl(this.fileUrl, this.fileName);
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
    const instance = new P7mViewer({ ...data, handle });
    instances.set(handle, instance);
    await instance.initialize();
    return moduleResult(handle, { success: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      "This signed file could not be opened. Download it and try your signing app.";
    emit("error", { handle, json: { message, detail } });
    return moduleResult(handle, { success: false, error: detail });
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

function downloadContent(args) {
  const v = instances.get(args.handle || parseArgs(args).handle);
  if (v?.payloadUrl) downloadUrl(v.payloadUrl, v.payloadName);
}
registerModule({ initialize, download, cleanup, downloadContent });
