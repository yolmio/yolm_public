import { Buffer } from "buffer";
import iconv from "iconv-lite";

const aliases = {
  1200: "utf16le",
  1201: "utf16be",
  10000: "macintosh",
  20127: "ascii",
  65000: "utf7",
  65001: "utf8",
};

export function decodeCodepage(bytes, codepage) {
  // Numeric aliases cover legacy pages (including Mac pages); `cp${page}`
  // does not. Unicode pages need the explicit decoder names above.
  const encoding = aliases[codepage] ?? String(codepage);
  if (!iconv.encodingExists(encoding)) return undefined;
  return iconv.decode(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    encoding,
  );
}
