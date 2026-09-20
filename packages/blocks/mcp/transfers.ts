import { type Sql, sql } from "std/sql_utils";
import { system } from "std/system";
import type { GeneralServerStatements } from "std/statements";

export const SIGNED_BLOB_PATH = "/api/mcp/download-blob";

export function signedBlobLink(blob: Sql, name: Sql, mime: Sql): Sql {
  return sql`http.sign_request('GET', (http.request_info()->>'origin') || ${
    sql.lit(SIGNED_BLOB_PATH)
  },
    json_build_object('blob', bytes.to_hex(${blob}), 'name', ${name}, 'type', ${mime}),
    now() + interval '30 minutes')`;
}

export function registerSignedBlobDownload(domain: string) {
  system.api({ domain, prefix: "/api" }).get("/mcp/download-blob", {
    procedure: (s) => {
      s.defScalar(
        "download_claims",
        sql`http.verify_signed_request(http.request_info()->>'method', http.request_info()->>'url')`,
      );
      s.if(sql`download_claims is null`, (s) => {
        s.setHttpStatus(403);
        s.return(sql.lit`Invalid or expired download link`);
      });
      s.setHeader("cache-control", sql.lit`private, no-store`);
      s.setHeader("x-content-type-options", sql.lit`nosniff`);
      s.setHeader("content-type", sql`download_claims->>'type'`);
      s.setHeader(
        "content-disposition",
        sql`'attachment; filename*=UTF-8' || chr(39) || chr(39) || uri.encode_component(download_claims->>'name')`,
      );
      s.returnBlob(sql`bytes.from_hex(download_claims->>'blob')`);
    },
  });
}

/** Preserve binary data inside the isolate's existing scratch-byte bridge. */
export const downloadFileJs = `async (input) => {
  if (!(input.data instanceof Uint8Array)) return await globalThis.downloadFile(input);
  if (input.data.byteLength > 16777216) throw new Error("Download data exceeds 16 MiB.");
  const {data, ...metadata} = input;
  const id = await yolm.bytes.set(data);
  try { return await globalThis.downloadFile({...metadata, bytesId: Number(id)}); }
  finally { yolm.bytes.drop(id); }
}`;

/** Only accepts bytes supplied by the caller; arbitrary blob hashes are not authority. */
export const generatedFileDownloadTool = {
  name: "downloadFile",
  statements: (s: GeneralServerStatements) => {
    s.defScalar("download_input", sql`tool_input->0`);
    s.if(
      sql`((json_typeof(download_input->'data') is distinct from 'string') and download_input->'bytesId' is null)
      or (json_typeof(download_input->'filename') is distinct from 'string')
      or length(download_input->>'filename') not between 1 and 255
      or regex.is_match(download_input->>'filename', '[\r\n/\\\\]')
      or octet_length(download_input->>'data') > 16777216`,
      (s) => {
        s.throwError(
          sql
            .lit`downloadFile requires string or Uint8Array data and a filename, at most 16 MiB.`,
        );
      },
    );
    s.defScalar(
      "download_mime",
      sql`coalesce(download_input->>'mimeType', 'application/octet-stream')`,
    );
    s.if(
      sql`not regex.is_match(download_mime, '^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$')`,
      (s) => {
        s.throwError(sql.lit`Invalid download MIME type.`);
      },
    );
    s.defScalar("download_bytes", sql`string.to_utf8(download_input->>'data')`);
    s.if(sql`download_input->'bytesId' is not null`, (s) => {
      s.getJsBytes(sql`try_cast(download_input->>'bytesId' as bigint)`, {
        setBytesScalar: "download_bytes",
      });
    });
    s.if(
      sql`octet_length(download_bytes) > 16777216`,
      (s) => s.throwError(sql.lit`Download data exceeds 16 MiB.`),
    );
    s.createBlob(sql`download_bytes`, { defHashScalar: "download_hash" });
    s.defScalar(
      "download_url",
      signedBlobLink(
        sql`download_hash`,
        sql`download_input->>'filename'`,
        sql`download_mime`,
      ),
    );
    s.if(
      sql`download_url is null`,
      (s) =>
        s.throwError(
          sql.lit`Unable to sign the download URL in this execution context.`,
        ),
    );
    s.return(
      sql`json_build_object('url', download_url, 'filename', download_input->>'filename', 'mimeType', download_mime, 'expiresAt', now() + interval '30 minutes')`,
    );
  },
};
