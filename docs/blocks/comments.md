---
title: CommentsBlock
description: Record-attached discussion threads with replies, revisions, retractions, subscriptions, and a reusable UI.
tags:
  - blocks
  - comments
  - collaboration
related:
  - blocks/solution_blocks.md
  - blocks/crm.md
  - concepts/blocks.md
---

# CommentsBlock

`CommentsBlock` provides one shared discussion model for comments attached to
any record. A system defines the foreign keys on `comment_threads`; the block
owns comments, flat replies, revision history, visible retractions,
close/reopen state, subscriptions, and the `CommentsPanel` UI. Follow/unfollow
is a record-level control beside the panel title; close/reopen remains on the
root comment.

```tsx
import { CommentsBlock, CommentsPanel } from "blocks/comments";

const comments = new CommentsBlock({
  defineThread: (table) => {
    table.fk("project_id", "projects").onDelete("Cascade");
    table.fk("client_id", "clients").onDelete("Cascade");
  },
});
system.addBlock(comments);

<CommentsPanel foreignKey="project_id" recordId={sql`record.id`} />;
```

There is no context registry. Use nullable foreign keys for the records that
can own a thread. `threadWhere` can narrow a panel to a project sub-scope, and
`newThreadValues` supplies those extra foreign-key values when posting.

## Notifications

Configure `discussion` and include `comments.notificationSource()` in the
notification block's sources. Mount `<notifications.Routes />` inside each
notification-host app's authenticated routes. The packages own publication,
permalinks, exact comment highlighting/focus, and marking opened notifications read.

```tsx
const comments = new CommentsBlock({
  defineThread: (t) => t.fk("project_id", "projects").notNull(),
  discussion: {
    canRead: (thread, userId) => projectCanRead(thread, userId),
    canWrite: (thread, userId) => projectCanWrite(thread, userId),
    label: (thread) => sql`(select name from projects where id = ${thread}.project_id)`,
    parentHref: (thread) => sql`'/projects/' || cast(${thread}.project_id as string)`,
    additionalRecipients: (thread) => projectRecipients(thread),
  },
});
system.addBlock(comments);
const notifications = new UserNotificationsBlock({
  identity,
  sources: [comments.notificationSource()],
});
system.addBlock(notifications);
```

The discussion callbacks express business access and context; `canWrite` is
always constrained by `canRead`. Mutation helpers enforce those checks on the
server. Notification recipients include explicit record followers, mentions,
the directly replied-to author, and optional business recipients, deduplicated
and excluding the actor. Posting or being mentioned does not auto-follow.

`/comments/<comment-id>` checks access and redirects to `parentHref` with a
`comment` query parameter. The destination must render a `CommentsPanel` for
that thread. `CommentRecordRail` automatically selects Comments for a targeted
link unless `discussion` explicitly selects a tab. The panel prioritizes the
target thread within its 100-thread window, then shows recent threads; normal
record and `threadWhere` access constraints still apply. It scrolls to, focuses,
and highlights the exact root or reply. Closed and retracted content remains
legible; missing or inaccessible discussions show an unavailable message.
Copy-link actions use the same permalink without a recipient's notification ID.
Redirects replace the intermediate history entry, so Back returns to the inbox.

`onCommentCreated` remains an optional custom hook. Do not publish a second
comment notification there when automatic delivery is enabled. Pass
`notify: sql\`false\`` to `createThread` or `reply` for an audit entry whose
workflow already publishes its own event; this does not suppress custom hooks.

`<CommentRecordRail details={...} comments={<CommentsPanel ... />} />` provides
the shared Details/Comments rail with URL-backed selection (`discussion`). CRM
record pages use it automatically. Use `crm.defineCommentThreadFields` for the
CRM thread fields and `crm.commentDiscussion` for their context and access.
For custom thread fields, compose `crm.commentDiscussion`
with the system's business adapter, as System 6 does.

See `examples/comment_notifications` for a complete package-only setup.

## Mutation helpers

Use the configured block from server procedures:

- `createThread` creates a thread and its root comment.
- `reply` adds a flat reply and rejects closed threads.
- `edit` records the previous body in `comment_revisions` before updating.
- `retract` keeps the body visible with retraction metadata.
- `close` and `reopen` change discussion state for the root author.

All helpers are intended to run inside a caller-owned transaction. Comment
tables skip auto-generated APIs so writes go through these invariants.

## Migrating legacy comments

`blocks/comments/transform` exports `legacyCommentsLatestStateProcess`. A
new-schema transform can map a legacy one-row-per-comment table into one shared
thread and root per old row while preserving author, body, and timestamp.

## Inline images

`CommentsPanel` supports pasted screenshots, mixed HTML containing text, images
and tables, and an **Attach image** file picker. PNG, JPEG, GIF, and WebP files
up to 10 MB are uploaded separately from the comment JSON. Image-only comments
are valid. Posting and saving edits stay disabled while an image is uploading
or has failed; failed uploads offer Retry and Remove actions. Clipboard images
that contain only an inaccessible reference (for example an Outlook `cid:`
without file bytes) show an explanation and can be attached as files instead.
Remote image URLs are not downloaded automatically.
When clipboard files correspond to the HTML images, their bytes are used even
if the HTML references remote URLs.

The block adds the compatible `comment_images` table; no existing comment data
needs rewriting. Pending uploads belong to the uploader. Posting attaches them
to the comment, and `/api/comment-images/{uuid}` serves their private blobs only
to users allowed to read the owning discussion. Images retained by comment
revision history remain attached; abandoned uploads expire after one day.
Open editors retain image files in memory and offer Retry before pending uploads
expire. Retrying renews the upload without requiring another file selection.
Each app containing a `CommentsPanel` registers its byte endpoint automatically
using the enclosing authentication context. Local tests must set a real auth
session cookie when exercising byte endpoints, as dev page auto-login does not
provide one.
