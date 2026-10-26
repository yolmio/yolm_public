---
title: Forge artifacts skill
description: Use to read user uploads, images, or PDFs, or to create and display generated artifacts and documents in Forge.
tags: [ai, forge, skill, artifacts, images]
---

# Forge artifacts skill

```ts
declare function listArtifacts(): Promise<Array<{ artifactId: string; type: "image" | "markdown" | "file"; mimeType: string | null; description: string | null }>>;
declare function readArtifact(artifactId: string): Promise<{ artifactId: string; type: string; mimeType: string | null; content?: string | null; bytesId?: number }>;
declare function readArtifactPdfText(options: { artifactId: string; page?: number }): Promise<unknown>;
declare function createArtifact(options: { type: "image" | "markdown"; content: string; description?: string }): Promise<{ artifactId: string }>;
declare function showArtifact(options: { artifactId: string; message?: string }): Promise<{ artifactId: string; url: string }>;
```

Use `readArtifact` for Markdown and in external Forge MCP `exec` when reading an
image artifact; forward its returned image content with `image(...)`. The
native Forge session executor also exposes `readImageArtifact` for image
artifacts. Use `readArtifactPdfText` for PDF text. Await `showArtifact` to
publish a card; it returns an absolute artifact-viewer URL through MCP and a
relative URL for native calls.
It does not pause the agent loop. Use `getLinks({artifactId})` in MCP execRead
with sessionId to retrieve an existing link without publishing another card.
