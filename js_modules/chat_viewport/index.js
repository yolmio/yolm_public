const __v2 = 1;
/**
 * Chat viewport support for mobile and streaming transcripts.
 *
 * - Mirrors the on-screen keyboard inset (via the VisualViewport API) into a
 *   `--keyboard-inset` CSS variable on `<html>` and toggles a `keyboard-open`
 *   root class. Layouts subtract the variable from their height so the
 *   composer sits directly above the keyboard on iOS Safari, which never
 *   resizes the layout viewport for the keyboard.
 * - Keeps a transcript scroll container pinned to the bottom while content
 *   streams in (ResizeObserver/MutationObserver based stick-to-bottom).
 *   Scrolling away from the bottom cancels stickiness; returning to the
 *   bottom re-engages it.
 * - Adds tap-to-copy buttons to `<pre>` code blocks inside the transcript.
 */

const NEAR_BOTTOM_PX = 120;

const instances = new Map();

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

function hasEditableFocus() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" ||
    el.isContentEditable === true;
}

function init(args) {
  const handle = args && args.handle;
  if (!handle || instances.has(handle)) return;

  const scrollContainerId = args.scrollContainerId || null;
  const enableCodeCopy = args.codeCopy !== false;
  const root = document.documentElement;
  const vv = window.visualViewport;

  const state = {
    disposed: false,
    stick: true,
    lastInset: 0,
    rafToken: 0,
    container: null,
    childObserver: null,
    mutationObserver: null,
    anchorRows: new WeakSet(),
    anchorsReady: false,
    pendingTallAnchor: null,
    tallAnchorRaf: 0,
    listeners: [],
  };

  function getContainer() {
    return scrollContainerId
      ? document.getElementById(scrollContainerId)
      : null;
  }

  function distanceFromBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function pinToBottom(el) {
    el.scrollTop = el.scrollHeight;
  }

  function rememberTallAnchors(container) {
    for (
      const row of container.querySelectorAll(
        '[data-chat-anchor-tall-start="true"]',
      )
    ) {
      state.anchorRows.add(row);
    }
  }

  function scheduleTallAnchor(row) {
    state.pendingTallAnchor = row;
    if (state.tallAnchorRaf) return;
    state.tallAnchorRaf = requestAnimationFrame(() => {
      state.tallAnchorRaf = requestAnimationFrame(() => {
        state.tallAnchorRaf = 0;
        const container = state.container;
        const target = state.pendingTallAnchor;
        state.pendingTallAnchor = null;
        if (state.disposed || !container || !target?.isConnected) return;

        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const availableHeight = Math.max(0, container.clientHeight - 32);
        if (targetRect.height <= availableHeight) {
          pinToBottom(container);
          return;
        }

        // A complete long answer arrives atomically. Showing its beginning is
        // more useful than preserving the former live-edge position, which
        // would land the reader in the middle or at the end of the answer.
        state.stick = false;
        if (pendingPin) {
          cancelAnimationFrame(pendingPin);
          pendingPin = 0;
        }
        container.scrollTop += targetRect.top - containerRect.top - 16;
      });
    });
  }

  function inspectAddedTallAnchors(records) {
    if (!state.anchorsReady || !state.stick) return;
    let latest = null;
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        const rows = [];
        if (added.matches('[data-chat-anchor-tall-start="true"]')) {
          rows.push(added);
        }
        rows.push(...added.querySelectorAll(
          '[data-chat-anchor-tall-start="true"]',
        ));
        for (const row of rows) {
          if (state.anchorRows.has(row)) continue;
          state.anchorRows.add(row);
          latest = row;
        }
      }
    }
    if (latest) scheduleTallAnchor(latest);
  }

  // ---- keyboard inset ----------------------------------------------------

  function applyInset() {
    if (state.disposed || !vv) return;
    let inset = Math.round(window.innerHeight - vv.height - vv.offsetTop);
    // iOS 26.0 can report a stale, slightly-short visualViewport height
    // after keyboard dismissal; only trust a non-zero inset while an
    // editable element is focused.
    if (inset < 0 || !hasEditableFocus()) inset = 0;
    if (inset === state.lastInset) return;

    const container = getContainer();
    const wasNearBottom = container
      ? distanceFromBottom(container) <= NEAR_BOTTOM_PX
      : false;
    const growing = inset > state.lastInset;
    state.lastInset = inset;
    root.style.setProperty("--keyboard-inset", inset + "px");
    root.classList.toggle("keyboard-open", inset > 0);
    // The container just shrank/grew with the layout; keep the latest
    // messages in view when the keyboard opens over a pinned transcript.
    if (growing && wasNearBottom && container) {
      requestAnimationFrame(() => {
        if (!state.disposed) pinToBottom(container);
      });
    }
  }

  function scheduleInset() {
    if (state.rafToken) return;
    state.rafToken = requestAnimationFrame(() => {
      state.rafToken = 0;
      applyInset();
    });
  }

  function onFocusChange() {
    // The keyboard animates in/out after focus changes; re-evaluate now and
    // once the visual viewport has had a chance to settle.
    scheduleInset();
    setTimeout(scheduleInset, 250);
  }

  function addListener(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    state.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  if (vv) {
    addListener(vv, "resize", scheduleInset);
    addListener(vv, "scroll", scheduleInset);
    addListener(window, "focusin", onFocusChange);
    addListener(window, "focusout", onFocusChange);
    applyInset();
  }

  // ---- stick-to-bottom ---------------------------------------------------

  let pendingPin = 0;
  function schedulePin() {
    if (pendingPin) return;
    pendingPin = requestAnimationFrame(() => {
      pendingPin = 0;
      if (state.disposed || !state.stick) return;
      const container = state.container;
      if (container) pinToBottom(container);
    });
  }

  function onContainerScroll() {
    const container = state.container;
    if (!container) return;
    state.stick = distanceFromBottom(container) <= NEAR_BOTTOM_PX;
  }

  function observeChildren(container) {
    if (state.childObserver) state.childObserver.disconnect();
    state.childObserver = new ResizeObserver(() => {
      if (state.stick) schedulePin();
    });
    state.childObserver.observe(container);
    for (const child of container.children) {
      state.childObserver.observe(child);
    }
  }

  function wireContainer() {
    const container = getContainer();
    if (container === state.container) return;
    state.container = container;
    if (!container) {
      if (state.childObserver) state.childObserver.disconnect();
      return;
    }
    state.stick = true;
    addListener(container, "scroll", onContainerScroll, { passive: true });
    observeChildren(container);
    rememberTallAnchors(container);
    state.anchorsReady = true;
    schedulePin();
  }

  // ---- code block copy buttons -------------------------------------------

  function enhanceCodeBlocks() {
    if (!enableCodeCopy || !state.container) return;
    const blocks = state.container.querySelectorAll(
      "pre:not([data-yolm-copy])",
    );
    for (const pre of blocks) {
      pre.dataset.yolmCopy = "1";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yolm-code-copy";
      button.setAttribute("aria-label", "Copy code");
      button.innerHTML = COPY_ICON;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const code = pre.querySelector("code");
        const text = (code || pre).innerText;
        // Must run synchronously inside the tap gesture for Safari.
        navigator.clipboard.writeText(text).then(() => {
          button.innerHTML = CHECK_ICON;
          button.classList.add("copied");
          setTimeout(() => {
            button.innerHTML = COPY_ICON;
            button.classList.remove("copied");
          }, 1500);
        }).catch(() => {});
      });
      pre.appendChild(button);
    }
  }

  // ---- DOM wiring ---------------------------------------------------------

  let pendingSync = 0;
  function scheduleSync(records) {
    if (records) inspectAddedTallAnchors(records);
    if (pendingSync) return;
    pendingSync = requestAnimationFrame(() => {
      pendingSync = 0;
      if (state.disposed) return;
      wireContainer();
      if (state.container) {
        observeChildren(state.container);
        rememberTallAnchors(state.container);
        enhanceCodeBlocks();
        if (state.stick && !state.pendingTallAnchor) schedulePin();
      }
    });
  }

  state.mutationObserver = new MutationObserver(scheduleSync);
  state.mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  scheduleSync();

  instances.set(handle, () => {
    state.disposed = true;
    if (state.rafToken) cancelAnimationFrame(state.rafToken);
    if (state.tallAnchorRaf) cancelAnimationFrame(state.tallAnchorRaf);
    if (pendingPin) cancelAnimationFrame(pendingPin);
    if (pendingSync) cancelAnimationFrame(pendingSync);
    if (state.childObserver) state.childObserver.disconnect();
    if (state.mutationObserver) state.mutationObserver.disconnect();
    for (const remove of state.listeners) remove();
    root.style.removeProperty("--keyboard-inset");
    root.classList.remove("keyboard-open");
  });
}

function cleanup(args) {
  const handle = args && args.handle;
  if (!handle) return;
  const dispose = instances.get(handle);
  if (dispose) {
    instances.delete(handle);
    dispose();
  }
}

registerModule({
  init,
  cleanup,
});
