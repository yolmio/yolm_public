// deno-lint-ignore-file no-undef
import "@videojs/html/video/player";
import "@videojs/html/video/neutral-skin";

const instances = new Map();
// Position and play state of players that were just torn down, by handle. A
// host that re-renders remounts the player within a moment; restoring the
// same video's state keeps that from restarting it. Older state is a video
// the viewer closed, which should open fresh.
const resumeStates = new Map();
const RESUME_WINDOW_MS = 2000;
const MAX_CHAPTERS = 256;

function parseArgs(args) {
  if (!args) return {};
  const base = typeof args === "object" ? { ...args } : {};
  delete base.json;
  if (typeof args.json === "string") {
    try {
      return { ...base, ...JSON.parse(args.json) };
    } catch {
      return base;
    }
  }
  return { ...base, ...(args.json || {}) };
}

function moduleResult(handle, json) {
  return { handle, json };
}

function requiredMount(elementId) {
  const mount = document.getElementById(elementId);
  if (!mount) throw new Error("The video player mount is unavailable.");
  return mount;
}

function emitError(handle, error) {
  const message = error instanceof Error ? error.message : String(error);
  emit("error", { handle, json: { message } });
  return moduleResult(handle, { success: false, error: message });
}

/** Valid chapters sorted by start, as `{ startMs, title }`. */
function normalizeChapters(chapters) {
  if (!Array.isArray(chapters)) return [];
  return chapters
    .map((chapter) => ({
      startMs: Number(chapter?.timeMs),
      title: String(chapter?.title ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((chapter) =>
      Number.isFinite(chapter.startMs) && chapter.startMs >= 0 && chapter.title
    )
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, MAX_CHAPTERS);
}

class VideoPlayer {
  constructor({ handle, elementId, src, title, chapters, startMs }) {
    this.handle = handle;
    this.mount = requiredMount(elementId);
    this.chapters = normalizeChapters(chapters);
    const start = Number(startMs);
    this.startMs = Number.isFinite(start) && start > 0 ? start : null;
    this.src = src;
    const resume = resumeStates.get(handle);
    resumeStates.delete(handle);
    this.resume = resume?.src === src &&
        Date.now() - resume.at <= RESUME_WINDOW_MS
      ? resume
      : null;
    if (this.resume) {
      this.startMs = this.resume.timeMs > 0 ? this.resume.timeMs : null;
    }
    this.activeChapterMs = null;
    this.chaptersTrack = null;
    this.listeners = [];
    this.build(src, title);
  }

  build(src, title) {
    this.mount.innerHTML = "";
    // The mount sits inside the component's frame, which sizes itself from
    // this ratio. Start at 16:9 until the video reports its own proportions.
    this.frame = this.mount.parentElement;
    this.frame?.style.removeProperty("--video-aspect");
    const player = document.createElement("video-player");
    player.style.display = "block";
    player.style.height = "100%";
    const skin = document.createElement("video-neutral-skin");
    Object.assign(skin.style, {
      display: "block",
      height: "100%",
      width: "100%",
    });
    skin.style.setProperty(
      "--media-accent-color",
      "var(--palette-primary-500, #2563eb)",
    );
    skin.style.setProperty("--media-font-family", "inherit");
    skin.style.setProperty("--media-object-fit", "contain");
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.preload = "metadata";
    if (title) this.video.setAttribute("aria-label", title);
    skin.append(this.video);
    player.append(skin);
    this.mount.append(player);
    // Business videos never need casting; the skin has no option to omit it.
    if (skin.shadowRoot) {
      const hideCast = new CSSStyleSheet();
      hideCast.replaceSync("media-cast-button { display: none !important; }");
      skin.shadowRoot.adoptedStyleSheets = [
        ...skin.shadowRoot.adoptedStyleSheets,
        hideCast,
      ];
    }

    this.listen(this.video, "loadedmetadata", () => {
      const { videoWidth, videoHeight } = this.video;
      if (videoWidth > 0 && videoHeight > 0) {
        this.frame?.style.setProperty(
          "--video-aspect",
          String(videoWidth / videoHeight),
        );
      }
      const durationMs = Number.isFinite(this.video.duration)
        ? Math.round(this.video.duration * 1000)
        : null;
      // Chapter cues need an end time, so they are added once the duration is
      // known. Streamed recordings may not report one; the last chapter then
      // runs for an hour and the player clamps it. Cues are built in script
      // because app Content Security Policies block `blob:` track sources.
      if (this.chapters.length > 0 && !this.chaptersTrack) {
        const endMs = durationMs ?? this.chapters.at(-1).startMs + 3_600_000;
        const chapters = this.chapters.filter((chapter) =>
          chapter.startMs < endMs
        );
        this.chaptersTrack = this.video.addTextTrack("chapters", "Chapters");
        chapters.forEach((chapter, index) => {
          const nextMs = index + 1 < chapters.length
            ? chapters[index + 1].startMs
            : endMs;
          this.chaptersTrack.addCue(
            new VTTCue(chapter.startMs / 1000, nextMs / 1000, chapter.title),
          );
        });
        this.chaptersTrack.mode = "hidden";
      }
      this.updateActiveChapter();
      if (this.resume?.playing) this.video.play().catch(() => {});
      emit("ready", { handle: this.handle, json: { durationMs } });
    });
    this.listen(this.video, "timeupdate", () => this.updateActiveChapter());
    this.listen(this.video, "error", () => {
      // Only decode and unsupported-format failures mean the browser can't
      // play the file. Network failures are often transient on phones; the
      // skin's own error dialog covers them.
      const code = this.video.error?.code;
      if (
        code === MediaError.MEDIA_ERR_DECODE ||
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      ) {
        emit("unplayable", { handle: this.handle, json: { code } });
      }
    });
    // A media fragment opens at the requested position without starting
    // playback, and the browser applies it before the player reads the time.
    if (src) {
      this.video.src = this.startMs === null
        ? src
        : `${src}#t=${this.startMs / 1000}`;
    }
  }

  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push({ target, type, listener });
  }

  updateActiveChapter() {
    if (this.chapters.length === 0) return;
    const currentMs = this.video.currentTime * 1000;
    let active = null;
    for (const chapter of this.chapters) {
      if (chapter.startMs > currentMs) break;
      active = chapter.startMs;
    }
    if (active === this.activeChapterMs) return;
    this.activeChapterMs = active;
    emit("chapterChange", {
      handle: this.handle,
      json: { startMs: active },
    });
  }

  seek(ms) {
    const seconds = Number(ms) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.video.currentTime = seconds;
    this.video.play().catch(() => {});
  }

  destroy() {
    if (this.video.currentTime > 0 || !this.video.paused) {
      resumeStates.set(this.handle, {
        src: this.src,
        timeMs: this.video.currentTime * 1000,
        playing: !this.video.paused && !this.video.ended,
        at: Date.now(),
      });
    }
    for (const { target, type, listener } of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.listeners = [];
    this.video.pause();
    // Release the media connection before the element leaves the document.
    this.video.removeAttribute("src");
    this.video.load();
    this.mount.innerHTML = "";
  }
}

// Initialize requests still waiting for their mount element, by handle.
const pendingMounts = new Map();
const MOUNT_WAIT_FRAMES = 60;

function initialize(args) {
  const data = parseArgs(args);
  const handle = args.handle || data.handle;
  cancelAnimationFrame(pendingMounts.get(handle));
  pendingMounts.delete(handle);
  // A host can run this before it attaches the mount to the document, so
  // wait a few frames for it rather than leaving the player empty.
  const start = (framesLeft) => {
    pendingMounts.delete(handle);
    if (!document.getElementById(data.elementId) && framesLeft > 0) {
      pendingMounts.set(
        handle,
        requestAnimationFrame(() => start(framesLeft - 1)),
      );
      return;
    }
    try {
      instances.get(handle)?.destroy();
      instances.set(handle, new VideoPlayer({ ...data, handle }));
    } catch (error) {
      emitError(handle, error);
    }
  };
  start(MOUNT_WAIT_FRAMES);
  return moduleResult(handle, { success: true });
}

function seek(args) {
  const data = parseArgs(args);
  instances.get(args.handle || data.handle)?.seek(data.value);
}

function cleanup(args) {
  const handle = args.handle || parseArgs(args).handle;
  const instance = instances.get(handle);
  if (!instance) return;
  // A host that re-renders can deliver the old element's cleanup after the
  // new element's initialize for the same handle; initialize already replaced
  // the old player. Only tear down the current player once its element has
  // left the page.
  requestAnimationFrame(() => {
    if (instances.get(handle) !== instance || instance.mount.isConnected) {
      return;
    }
    instance.destroy();
    instances.delete(handle);
  });
}

registerModule({
  initialize,
  seek,
  cleanup,
});
