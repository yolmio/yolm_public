---
title: Forge Session History and Review Links
description: Resume work and give users review links or useful timeline cards.
tags: [ai, forge, sessions]
---

# Session history and review links

Use `execRead` for reads and `exec` for publishing. Select the existing session in
the enclosing MCP call; version IDs are global IDs, not the session's v1/v2 label.
Read this guide with `readFile({path:"docs/ai/forge_session_history.md"})`.

```js
text(await getSessionHistory({ limit: 10 }));
text(await getSessionHistory({ beforeEventId: 456, limit: 10 }));
text(await getSessionHistory({ eventId: 123 }));
text(await getLinks({ versionId: 789 }));
text(await getLinks({ artifactId: "artifact-3" }));
text(await getLinks({ versionId: 789, domain: "app.example.com", path: "/orders/42" }));
```

History returns `sessionId`, `url`, chronological `entries`, `hasMore`, and
`nextBeforeEventId`. It selects the most recent page first; limits are 1–20.
Entries identify the event, author, message and attached version/artifact/preview.
List messages are bounded to 1,000 characters; `eventId` expands one to 30,000;
check `messageTruncated`. Read older pages only when needed to understand the work.

`getLinks` returns `sessionUrl`, and applicable `versionUrl`, `artifactUrl`,
`previewUrl`. Artifact IDs are public string IDs returned by artifact tools.
Versions/artifacts must belong to the selected session. Preview `domain` is the
canonical app domain from the selected version. Its preview must already have
resolved domains; `getLinks` does not start it. `path` must begin with a single `/`.
The resulting preview URL opens the actual app/page; version URLs open Forge review.

To publish a durable, useful outcome in the session timeline:

```js
text(await createMessage({ message: "Validated project-number editing in preview." }));
text(await showVersion({ versionId: 789, message: "Ready for review; validation passed." }));
text(await showArtifact({ artifactId: "artifact-3", message: "Demo of the change." }));
text(await showPreview({ versionId: 789, domain: "app.example.com", path: "/orders/42" }));
```

These operations require mutable `exec`, write access and a selected session.
`createMessage` accepts a nonempty message up to 10,000 characters. The show functions
publish timeline cards and return a review `url`; `showPreview` can configure/start
the preview and is not a read. Use `getLinks` to link existing work without creating
a card. Describe the outcome and give the most useful link in the user response;
avoid duplicate cards, repeated messages and tool-log transcripts.

Operational `getLinks({view,...})` is session-independent and is documented in
[Operational reads](forge_operations.md). Links grant no access, and preview or
transient evidence may become unavailable later.
