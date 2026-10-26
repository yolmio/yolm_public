import { Buffer } from "buffer";
import { decodeCodepage } from "./codepage";

const fontCodepages = {
  0: 1252,
  77: 10000,
  128: 932,
  129: 949,
  130: 1361,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
  254: 437,
  255: 850,
};
const ignoredDestinations = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "pntext",
  "fldinst",
  "header",
  "headerl",
  "headerr",
  "headerf",
  "footer",
  "footerl",
  "footerr",
  "footerf",
  "filetbl",
  "listtable",
  "listoverridetable",
]);
const characters = {
  par: "\r\n",
  line: "\r\n",
  tab: "\t",
  lquote: "\u2018",
  rquote: "\u2019",
  ldblquote: "\u201c",
  rdblquote: "\u201d",
  bullet: "\u2022",
  endash: "\u2013",
  emdash: "\u2014",
  "~": "\u00a0",
  "_": "\u2011",
  "-": "\u00ad",
};

// Extract the original HTML per MS-OXRTFEX, rather than rendering general RTF.
// Scan once, keep flat group state, and decode text runs instead of allocating
// stream tokens and walking prototype chains for every RTF control word.
export function rtfHtml(bytes) {
  // Avoid the browser Buffer polyfill's character-at-a-time latin1 conversion.
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.slice(offset, offset + 8192)));
  }
  const source = chunks.join("");
  if (!source.startsWith("{\\rtf1")) return undefined;
  const fonts = new Map();
  const output = [];
  let state = {
    skip: false,
    html: false,
    htmlRtf: false,
    fontTable: false,
    font: 0,
    uc: 1,
    start: true,
    optional: false,
  };
  const states = [state];
  let depth = 0;
  let codepage = 1252;
  let defaultFont = 0;
  let fromHtml = false;
  let fallback = 0;
  let pending = "";

  function emit(text) {
    if (!state.skip && !state.htmlRtf && fromHtml) {
      output.push(
        state.html ? text : text.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      );
    }
  }
  function flush() {
    if (!pending) return;
    if (!state.skip && !state.htmlRtf && fromHtml) {
      const font = fonts.get(state.font);
      const encoding = state.html
        ? codepage
        : font?.codepage ?? font?.charsetCodepage ?? codepage;
      emit(
        /[\x80-\xff]/.test(pending)
          // Unsupported pages (e.g. Johab) should lose only undecodable text,
          // not the whole body, its formatting, and its inline images.
          ? decodeCodepage(Buffer.from(pending, "latin1"), encoding) ??
            pending.replace(/[\x80-\xff]/g, "\ufffd")
          : pending,
      );
    }
    pending = "";
  }
  function append(text) {
    const skipped = Math.min(fallback, text.length);
    fallback -= skipped;
    if (!state.skip && !state.htmlRtf) pending += text.slice(skipped);
  }

  let offset = 0;
  while (offset < source.length) {
    const start = offset;
    const character = source.charCodeAt(offset++);
    if (character === 123 || character === 125) {
      flush();
      fallback = 0;
      if (character === 123) {
        if (depth >= 256) return undefined;
        // Reuse one snapshot per nesting depth instead of one per group.
        const child = states[++depth] ?? (states[depth] = { ...state });
        Object.assign(child, state);
        state = child;
        state.start = true;
        state.optional = false;
      } else {
        if (!depth) return undefined;
        state = states[--depth];
        if (!depth) {
          return fromHtml && /^[\s\0]*$/.test(source.slice(offset))
            ? output.join("")
            : undefined;
        }
      }
      continue;
    }
    if (character === 13 || character === 10) continue;
    if (character !== 92) {
      while (offset < source.length) {
        const next = source.charCodeAt(offset);
        if (
          next === 92 || next === 123 || next === 125 || next === 13 ||
          next === 10
        ) break;
        offset++;
      }
      state.start = false;
      append(source.slice(start, offset));
      continue;
    }
    if (offset >= source.length) return undefined;
    if (source[offset] === "'") {
      const hex = source.slice(offset + 1, offset + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) return undefined;
      offset += 3;
      state.start = false;
      append(String.fromCharCode(parseInt(hex, 16)));
      continue;
    }
    const controlStart = offset;
    while (offset < source.length) {
      const code = source.charCodeAt(offset) | 32;
      if (code < 97 || code > 122) break;
      offset++;
    }
    let control;
    let value;
    if (offset === controlStart) {
      control = source[offset++];
    } else {
      control = source.slice(controlStart, offset).toLowerCase();
      const numberStart = offset;
      if (source[offset] === "-") offset++;
      while (
        source.charCodeAt(offset) >= 48 && source.charCodeAt(offset) <= 57
      ) offset++;
      if (offset > numberStart) {
        value = Number(source.slice(numberStart, offset));
      }
      if (source[offset] === " ") offset++;
    }
    if (control === "bin") {
      if (
        !Number.isSafeInteger(value) || value < 0 ||
        offset + value > source.length
      ) return undefined;
      offset += value;
    }
    if (fallback) {
      fallback--;
      continue;
    }
    if (control === "\\" || control === "{" || control === "}") {
      append(control);
      continue;
    }
    flush();
    if (control === "*" && state.start) {
      state.optional = true;
      continue;
    }
    if (state.start) {
      if (control === "htmltag") state.html = true;
      else if (state.optional || ignoredDestinations.has(control)) {
        state.skip = true;
      }
      if (control === "fonttbl") state.fontTable = true;
    }
    state.start = false;
    switch (control) {
      case "fromhtml":
        if (depth !== 1 || value !== 1) return undefined;
        fromHtml = true;
        break;
      case "fromtext":
        return undefined;
      case "ansicpg":
        if (depth === 1 && value > 0) codepage = value;
        break;
      case "deff":
        defaultFont = value;
        state.font = value;
        break;
      case "f":
        state.font = value;
        break;
      case "fcharset":
        if (state.fontTable) {
          fonts.set(state.font, {
            ...fonts.get(state.font),
            charsetCodepage: fontCodepages[value] ?? codepage,
          });
        }
        break;
      case "cpg":
        if (state.fontTable) {
          fonts.set(state.font, { ...fonts.get(state.font), codepage: value });
        }
        break;
      case "plain":
        state.font = defaultFont;
        break;
      case "htmlrtf":
        state.htmlRtf = value !== 0;
        break;
      case "uc":
        if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
          return undefined;
        }
        state.uc = value;
        break;
      case "u":
        if (!Number.isInteger(value) || value < -32768 || value > 65535) {
          return undefined;
        }
        emit(String.fromCharCode(value & 0xffff));
        fallback = state.uc;
        break;
      default:
        if (Object.hasOwn(characters, control)) emit(characters[control]);
    }
  }
  return undefined; // Unclosed groups are malformed, not an HTML body.
}
