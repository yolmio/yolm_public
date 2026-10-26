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
- `downloadDriveFile({versionId})`: retrieve an exact Drive file version.

These calls work through `execRead` without a session. Source calls need an
explicit `versionId` on the exec request. Generated files/ZIPs are temporary
blobs, not saved artifacts. Save an artifact separately for durable work.

### Downloading a Drive archive to an Edge Windows host

A `/drive/files/<id>?version=<id>` link is a viewer, not binary content. First
resolve the exact version through `downloadDriveFile({versionId: 123})`, then
pass its returned download URL unchanged to the host. Prepare the URL and the
expected SHA-256 from the archive producer before requesting an Edge grant.
Never replace an expected hash with the hash of a failed download.

This Windows PowerShell example fails before extraction if the transfer is HTML,
corrupt, or the wrong bytes. Replace the two placeholders. It uses the built-in
ZIP assembly explicitly, including on Windows PowerShell 5.1:

```powershell
$ErrorActionPreference = 'Stop'
try {
    $downloadUrl = 'PASTE_EXACT_RETURNED_DOWNLOAD_URL'
    $expectedSha256 = 'PASTE_EXPECTED_SHA256'
    if ($expectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Expected SHA-256 is required' }
    $work = Join-Path ([IO.Path]::GetTempPath()) ('edge-transfer-' + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
    $archive = Join-Path $work 'download.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive -ErrorAction Stop
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    if ($actual -ine $expectedSha256) { throw "SHA-256 mismatch; received $actual" }
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try { $entryCount = $zip.Entries.Count } finally { $zip.Dispose() }
    $destination = Join-Path $work 'extracted'
    Expand-Archive -LiteralPath $archive -DestinationPath $destination -ErrorAction Stop
    [pscustomobject]@{ Sha256 = $actual; Entries = $entryCount; Directory = $destination } |
        ConvertTo-Json -Compress
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
```

Do not execute downloaded programs unless that action is part of the authorized
task. If substituting `curl.exe` or another native tool, explicitly check
`$LASTEXITCODE`; `$ErrorActionPreference` alone does not handle native failures in
Windows PowerShell. Keep binary data out of tool output: large Base64 responses
can be truncated even when the script exits successfully.

## Source uploads

Select a session and editable version. Call
`prepareDirectoryUpload({binaryFiles:[{path,hash}]})`. It returns signed `plan`,
`text`, `finalize`, and per-file `binary` URLs for the existing directory-sync
protocol. Every `contentHash` is the BLAKE3 of the file's original bytes, for
text and binary files alike.
Run `deno fmt` with the repository configuration before uploading source files;
directory uploads preserve the supplied bytes.

1. POST `plan` with `{versionId,mode:"merge"|"replace",files}`. Each file
   contains `{path,kind:"text"|"binary",contentHash,size}`. Paths are relative
   to `src/`.
2. For `requiredTextHashes`, POST `text` with
   `{versionId,files:[{contentHash,content}]}`.
3. For `requiredBinaryHashes`, POST raw bytes to each matching `binary[].url`.
4. POST `finalize` with the original manifest and `baseTreeHash` from the plan.
   `baseTreeHash` is the version's `treeHash` (`versionManifest`), so a client
   can also compute it locally.
   Existing draft, immutable-version, and concurrent-edit checks remain active.

Use `merge` to preserve files absent from the manifest. `replace` also deletes
absent files; use it only when the user wants the complete version replaced.

## Drive uploads

`prepareDriveUpload({spaceId,filename,mimeType?,parentId?,itemId?})` returns a
POST URL accepting raw file bytes. The response identifies the Drive item and
version. Use `listDriveFiles` to obtain the space ID. Drive files are system-wide,
separate from source versions; `itemId` uploads a new version of an existing file.

## Database imports

`prepareDatabaseUpload()` returns a multipart POST URL for the existing database
importer. Send `files` parts and optional `displayName`. Source files may be
CSV/TSV, JSON Lines, JSON arrays (text formats optionally gzipped), Parquet,
spreadsheets (xlsx, xls, ods), or SQLite databases,
mixed in one upload, with an optional `yolm-import.json`; see
[Source imports](../concepts/source_imports.md) for table naming, type rules,
and strict/lenient modes. Prefer JSON Lines for API extractions and Parquet
with microsecond timestamps for large tables.

For chunked uploads:

1. `prepareDatabaseUpload({operation:"init"})`; POST `{files:[{name,size}]}`.
2. Use the returned `sessionId` and `chunkSize`. For each chunk, call
   `prepareDatabaseUpload({operation:"chunk",uploadId:sessionId,fileIndex,chunkIndex})`
   and PUT the chunk bytes to its URL. Indices are zero-based.
3. `prepareDatabaseUpload({operation:"complete",uploadId:sessionId})`; POST
   `{displayName}`.

An HTTP 202 response means queued, not finished. Poll
`databaseUploadStatus({jobId})`; only `completed` establishes success. Inspect
`error` for failures. Source-file imports also return `report`: each table's
columns with their types and how they were chosen, renames, and rejected
values; a strict import that rejected values fails with the report attached. Use `devDatabaseInfo({databaseId})` for schema and
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

Drive uploads use the existing `/api/_blob-upload/init`, chunk, and complete
protocol for large files. Pass the signed upload URL's path and query as `path`
in init, with `method: "POST"` and the exact byte `size`. Use the same request
credentials for init, chunks, and complete. Drive's configured upload limits
apply. The signed target is checked again at completion.

Database-upload init/completion JSON is limited to 1 MiB and 256 files. Multipart
names are limited to 4 KiB and manifests/mappings to 1 MiB. Multipart uploads
are limited to 64 MiB; use chunked uploads for larger databases (up to 32 GiB).
Chunked database uploads share a 32 GiB uploaded-byte budget and eight upload/import
slots. Reservations remain held during extraction, queued imports, and source cleanup.
Source ZIPs retain the 2,000-file/256 MiB limits: blob inputs stream, while the
finished archive is buffered under the runtime memory budget.

## Raw blobs

Call `getRawBlobUploadLink()` in writable `exec` with a work session selected.
It returns `{url, method: "POST", expiresAt, maxSize}`. POST the file bytes to
that exact URL; a successful upload returns HTTP 201 with `{blobHash, size}`.
`blobHash` is the stored blob reference encoded as hexadecimal, not a promised
plaintext digest. Decode it to bytes when storing it in a blob field.

The limit is 2 GiB per file. Empty files are supported. For large files use
`/api/_blob-upload/init`, chunks, and complete as described for Drive uploads;
completion returns the same `{blobHash, size}` response. The signed link expires
in 30 minutes and current user edit permission is checked at upload admission
and completion. A link can be reused until expiry. After restart an unfinished
chunked upload must be started again.

This creates no Drive item, import job, or database row. The client handles
local directories or cloud-provider downloads and stores each returned blob
reference in its intended system records. Unreferenced S3 blob GC is planned
but is not currently implemented. Uploading does not itself modify production
records or grant download access to arbitrary blob hashes.
