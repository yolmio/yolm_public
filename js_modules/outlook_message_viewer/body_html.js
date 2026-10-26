import { decompressRTF } from "@kenjiuno/decompressrtf";
import { decodeCodepage } from "./codepage";
import { rtfHtml } from "./rtf_html";

const MAX_RTF_BYTES = 16 * 1024 * 1024;
// The decompressor does not enforce the declared output length. Bound its
// input too, since an LZFu back-reference can expand two bytes into 17 bytes.
const MAX_COMPRESSED_RTF_BYTES = 2 * 1024 * 1024;

export function messageBodyHtml(message) {
  if (message.bodyHtml) return message.bodyHtml;
  if (message.html?.length) {
    const html = decodeCodepage(
      message.html,
      message.internetCodepage || message.messageCodepage || 1252,
    );
    if (html) return html;
  }
  if (!message.compressedRtf) return undefined;

  try {
    const compressed = message.compressedRtf;
    if (compressed.length < 16) return undefined;
    const header = new DataView(
      compressed.buffer,
      compressed.byteOffset,
      compressed.byteLength,
    );
    if (
      compressed.length > MAX_COMPRESSED_RTF_BYTES ||
      header.getUint32(0, true) + 4 !== compressed.length ||
      header.getUint32(4, true) > MAX_RTF_BYTES
    ) return undefined;

    const rtf = decompressRTF(compressed);
    if (rtf.length !== header.getUint32(4, true)) return undefined;
    return rtfHtml(rtf);
  } catch {
    // Unsupported or damaged RTF must not hide the plain-text body or the
    // downloadable attachments.
    return undefined;
  }
}
