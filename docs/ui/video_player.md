---
title: Video player
description: VideoPlayer plays uploaded or recorded videos with Video.js controls, chapter segments, and a download fallback.
tags:
  - ui
  - video
  - components
---

# Video player

`VideoPlayer` from `components/video_player` plays a video URL with Video.js
controls: play, seek, volume, playback speed, picture-in-picture, and
fullscreen. It loads the `video_player` JS module on demand.

```tsx
import { VideoPlayer } from "components/video_player";

<VideoPlayer
  src={sql`'/api/files/versions/' || version.id || '/content'`}
  title={sql`version.file_name`}
/>;
```

- `src` should be served with `returnBlob`, which answers HTTP range requests
  for chunked blobs, so seeking fetches only the needed bytes.
- `className` sizes the player. It defaults to a full-width 16:9 frame
  (`aspect-video w-full`); the video keeps its own proportions inside it.
- When the browser can't decode the file (for example, an HEVC `.mov`), the
  player offers a download instead.

## Chapters

Pass `chapters` as a JSON array of `{ timeMs, title }`. The player divides the
time slider into chapter segments. Invalid entries are ignored.

To drive the player from your own chapter list, give it a stable `handle`,
call `seekVideoPlayer`, and track the active chapter with `onChapterChange`:

```tsx
import { seekVideoPlayer, VideoPlayer } from "components/video_player";

const handle = sql.lit`walkthrough-video`;

<VideoPlayer
  handle={handle}
  src={src}
  title={title}
  chapters={sql`recording.timeline->'chapters'`}
  onChapterChange={(s, startMs) =>
    s.setScalar("active_chapter_ms", startMs)}
/>;
<button onClick={(s) => seekVideoPlayer(s, handle, sql`chapter.time_ms`)}>
  {sql`chapter.title`}
</button>;
```

`seekVideoPlayer` jumps to the time and starts playback. To open a video at a
chapter without starting it, pass `startMs` instead.

When rendering players in a list (`Each`), pass a `handle` that is unique per
row; the generated handle is shared by every row of the list.

## Drive

Add `VideoViewerExtension` from `blocks/drive` to a space type's `extensions`
to preview MP4, WebM, Ogg, and QuickTime files with this player.

`isPlayableVideoMime(contentType)` returns the same content-type check as SQL.

## Embedded video links

`EmbeddedVideo` from `components/embedded_video` accepts a supported HTTPS
YouTube or Vimeo `url` and a `title`. It derives a trusted iframe address via
`fn.video_embed_url`, preserves Vimeo unlisted hashes, and loads the provider
only after the viewer clicks Play. The `labels` prop localizes `play` and
`unavailable` text. Unsupported links never become iframe sources.

Apps that render embedded videos must allow the two player origins in their
Content-Security-Policy. Keep the rest of the default policy:

```tsx
import { embeddedVideoFrameSources } from "components/embedded_video";

system.app({
  securityHeaders: {
    contentSecurityPolicy: {
      additionalSources: { "frame-src": embeddedVideoFrameSources },
    },
    xFrameOptions: true,
  },
  // ... app configuration
});
```

Uploaded files continue to use `VideoPlayer`. Embedded provider players keep
their own controls and access restrictions; displaying one does not record
watch time or complete training.
