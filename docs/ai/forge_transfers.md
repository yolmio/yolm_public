---
title: Forge File Transfers
description: Signed upload and download links for Forge source, references, databases, and generated files.
tags:
  - ai
  - forge
  - files
related:
  - ai/forge_api.md
---

# Forge file transfers

Keep orchestration in `exec`, and emit compact results with `text()`/`image()`.
Use download links for complete files so their contents do not fill model
context. All links expire after 30 minutes. Use the exact returned URL; do not
append query parameters. A transfer does not run in the isolate: your client's
HTTP/file tools send or retrieve the bytes.

## Downloads

- `downloadFile({data, filename, mimeType?})`: export a generated UTF-8 string
  or Uint8Array, up to 16 MiB. Example:
  `text(await downloadFile({data:csv,filename:"estimate.csv"}))`.
- `downloadSourceFile({path})`: download a selected version's file; paths are
  relative to `src/`. An editable version can change before the URL is fetched.
- `downloadSourceZip()`: snapshot the selected version into a ZIP containing
  `src/` (at most 2,000 files and 256 MiB of source content).
- `downloadReferenceFile({id})`: retrieve a system reference file by ID.

These calls work through `execRead` without a session. Source calls need an
explicit `versionId` on the exec request. Generated files/ZIPs are temporary
blobs, not saved artifacts. Save an artifact separately for durable work.

## Source uploads

Select a session and editable version. Call
`prepareDirectoryUpload({binaryFiles:[{path,hash}]})`. It returns signed `plan`,
`text`, `finalize`, and per-file `binary` URLs for the existing directory-sync
protocol. Each binary hash is the BLAKE3 of the original bytes.

1. POST `plan` with `{versionId,mode:"merge"|"replace",files}`. Each file
   contains `{path,kind:"text"|"binary",contentHash,size}`. Paths are relative
   to `src/`.
2. For `requiredTextHashes`, POST `text` with
   `{versionId,files:[{contentHash,content}]}`.
3. For `requiredBinaryHashes`, POST raw bytes to each matching `binary[].url`.
4. POST `finalize` with the original manifest and `baseTreeHash` from the plan.
   Existing draft, immutable-version, and concurrent-edit checks remain active.

Use `merge` to preserve files absent from the manifest. `replace` also deletes
absent files; use it only when the user wants the complete version replaced.

## Reference uploads

`prepareReferenceUpload({filename,mimeType?,folderId?,description?})` returns a
POST URL accepting raw file bytes. The response identifies the reference record.
Reference files are system-wide rather than versioned source files.

## Database imports

`prepareDatabaseUpload()` returns a multipart POST URL for the existing database
importer. Send `files` parts and optional `displayName`.

For chunked uploads:

1. `prepareDatabaseUpload({operation:"init"})`; POST `{files:[{name,size}]}`.
2. Use the returned `sessionId` and `chunkSize`. For each chunk, call
   `prepareDatabaseUpload({operation:"chunk",uploadId:sessionId,fileIndex,chunkIndex})`
   and PUT the chunk bytes to its URL. Indices are zero-based.
3. `prepareDatabaseUpload({operation:"complete",uploadId:sessionId})`; POST
   `{displayName}`.

An HTTP 202 response means queued, not finished. Poll
`databaseUploadStatus({jobId})`; only `completed` establishes success. Inspect
`error` for failures. Use `devDatabaseInfo({databaseId})` for schema and
`queryDatabase({databaseId,query})` to verify imported records. These reuse the
existing Forge database tools. Retrying the entire import can create another
job; inspect the returned job before retrying.

Transfers acting as a user recheck that user's current application permissions.
A generated-blob URL directly grants access to those bytes until expiry. Upload
URLs authorize an operation, not a single use: a repeated upload may create
another file, revision, or import job.

## Transfer limits and streaming

Blob downloads authenticate into private temporary files before serving bytes.
Responses stream with backpressure; files are removed when the transfer closes.
The server prepares two downloads concurrently and limits each encrypted/plaintext
blob to 4 GiB. Serving a prepared file releases its preparation slot while retaining
a reservation for its actual temporary-file size. The shared download disk budget
is 16 GiB; each admission stage waits at most 30 seconds for capacity.

Reference uploads use the existing `/api/_blob-upload/init`, chunk, and complete
protocol for large files. Pass the signed upload URL's path and query as `path`
in init, with `method: "POST"` and the exact byte `size`. Use the same request
credentials for init, chunks, and complete. Binary references are limited to
256 MiB; text references to 16 MiB. The signed target is checked again at completion.

Database-upload init/completion JSON is limited to 1 MiB and 256 files. Multipart
names are limited to 4 KiB and manifests/mappings to 1 MiB. Multipart uploads
are limited to 64 MiB; use chunked uploads for larger databases (up to 32 GiB).
Chunked database uploads share a 32 GiB uploaded-byte budget and eight upload/import
slots. Reservations remain held during extraction, queued imports, and source cleanup.
Source ZIPs retain the 2,000-file/256 MiB limits: blob inputs stream, while the
finished archive is buffered under the runtime memory budget.
