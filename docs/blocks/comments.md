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
any record: threads, flat replies, revision history, visible retractions,
close/reopen, record-level follow, inline images, and the `CommentsPanel` UI.
The system only defines the owning foreign keys on `comment_threads`.

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

Use nullable foreign keys for each kind of owning record. On `CommentsPanel`, `threadWhere` narrows a panel to a sub-scope (using
the `comment_thread` alias) and `newThreadValues` replaces the default
`{ [foreignKey]: recordId }` written to new threads, so include the panel's own
key. See `CommentsBlockOpts` and `CommentsPanelProps` in
`packages/blocks/comments/index.tsx` for the remaining options.

## Owned tables

`comment_threads`, `comments` (roots and flat replies), `comment_revisions`,
`comment_thread_subscriptions` (followers), and `comment_images`. All skip
auto-generated APIs, so writes go through the mutation helpers.

## Mutation helpers

Call these on the configured block inside a caller-owned transaction:
`createThread` (thread plus root comment), `reply` (rejects closed threads),
`edit` (records the previous body as a revision), `retract` (body stays visible
with retraction metadata), and `close` / `reopen` (root author only).

## Notifications

Configure `discussion` and include `comments.notificationSource()` in the
[`UserNotificationsBlock`](./user_notifications.md) sources, then mount
`<notifications.Routes />` inside each notification-host app's authenticated
routes. The packages own publication, permalinks, and read marking.

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

- `canWrite` is always constrained by `canRead`; mutation helpers enforce both
  on the server.
- Recipients are explicit record followers, mentions, the directly replied-to
  author, and `additionalRecipients`, deduplicated and excluding the actor.
  Posting or being mentioned does not auto-follow.
- Pass `notify: sql\`false\`` to `createThread` or `reply` for an audit entry
  whose workflow publishes its own event; this does not suppress
  `onCommentCreated`. Do not publish a second comment notification from
  `onCommentCreated` when automatic delivery is enabled.
- `/comments/<comment-id>` checks access and redirects (replacing history) to
  `parentHref` with a `comment` query parameter. The destination must render a
  `CommentsPanel` for that thread; the panel prioritizes the target thread in its
  100-thread window and scrolls to, focuses, and highlights the exact root or
  reply. Copy-link actions use the same permalink.

`<CommentRecordRail details={...} comments={<CommentsPanel ... />} />` is the
shared Details/Comments rail, selected by the `discussion` query parameter and
defaulting to Comments for a targeted link. CRM record pages use it; for CRM
threads use `crm.defineCommentThreadFields` and `crm.commentDiscussion`
(composed with a business adapter for custom thread fields). See
`examples/comment_notifications` for a complete setup.

## Inline images

`CommentsPanel` accepts pasted screenshots, mixed HTML, and an **Attach image**
picker for PNG, JPEG, GIF, and WebP files up to 10 MB, uploaded separately from
the comment JSON. Image-only comments are valid.

- Posting and saving stay disabled while an upload is pending or failed;
  Retry renews the upload without reselecting the file.
- Remote image URLs and inaccessible references (such as Outlook `cid:`) are
  never downloaded; matching clipboard file bytes are used when present.
- Pending uploads belong to the uploader until posting attaches them;
  abandoned uploads expire after one day. Images kept by revision history stay
  attached.
- `/api/comment-images/{uuid}` serves blobs only to users who can read the
  owning discussion. Each app with a `CommentsPanel` registers it automatically
  using the enclosing auth context. Local tests must set a real auth session
  cookie for this endpoint; dev page auto-login does not provide one.

## Migrating legacy comments

`legacyCommentsLatestStateProcess` (from `blocks/comments/transform`) maps a
legacy one-row-per-comment table into one thread and root comment per row,
preserving author, body, and timestamp.
