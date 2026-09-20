// deno-lint-ignore-file no-undef
// Document comments module
//
// Google-Docs-style anchored comments over a read-only rendered document.
// The document body is server-rendered HTML; anchors are absolute character
// offsets into the container's text content. The rendered content of a
// version under review is immutable, so plain offsets are stable anchors.
//
// The module paints highlight spans for stored threads, shows a floating
// "Comment" button when the user selects text, and reports selections,
// comment requests and highlight clicks back to Yolm. All persistence and
// permission checks stay on the Yolm side.

const instances = new Map();
let stylesInjected = false;

const HIGHLIGHT_CLASS = "ym-doc-comment-highlight";
const RESOLVED_CLASS = "ym-doc-comment-resolved";
const ACTIVE_CLASS = "ym-doc-comment-active";
const ADD_BUTTON_CLASS = "ym-doc-comment-add-btn";
const MAX_QUOTE_LENGTH = 300;

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.${HIGHLIGHT_CLASS} {
  background-color: rgba(250, 204, 21, 0.35);
  border-bottom: 2px solid rgba(202, 138, 4, 0.7);
  cursor: pointer;
}
.${HIGHLIGHT_CLASS}.${RESOLVED_CLASS} {
  background-color: rgba(148, 163, 184, 0.18);
  border-bottom: 2px dashed rgba(100, 116, 139, 0.5);
}
.${HIGHLIGHT_CLASS}.${ACTIVE_CLASS} {
  background-color: rgba(250, 204, 21, 0.65);
  border-bottom: 2px solid rgba(161, 98, 7, 0.95);
}
.${ADD_BUTTON_CLASS} {
  position: absolute;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid rgba(15, 23, 42, 0.15);
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}
.${ADD_BUTTON_CLASS}:hover {
  background: #eff6ff;
}
`;
  document.head.appendChild(style);
}

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

function normalizeThreads(value) {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (raw && Array.isArray(raw.threads)) raw = raw.threads;
  if (!Array.isArray(raw)) return [];
  const threads = [];
  for (const item of raw) {
    if (!item) continue;
    const start = Number(item.start);
    const end = Number(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    threads.push({
      id: String(item.id),
      start,
      end,
      resolved: item.resolved === true,
    });
  }
  threads.sort((a, b) => a.start - b.start || a.end - b.end);
  return threads;
}

// Collect the container's text nodes with their absolute offsets, skipping
// anything inside the floating add button.
function buildTextIndex(container) {
  const entries = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (
          node.parentElement &&
          node.parentElement.closest(`.${ADD_BUTTON_CLASS}`)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let offset = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.nodeValue.length;
    entries.push({ node, start: offset, end: offset + length });
    offset += length;
    node = walker.nextNode();
  }
  return entries;
}

// Absolute character offset of a range boundary within the container. Uses
// Range.toString(), which concatenates exactly the text nodes buildTextIndex
// walks, so both sides of the anchor math agree.
function absoluteOffset(container, boundaryNode, boundaryOffset) {
  const range = document.createRange();
  range.setStart(container, 0);
  range.setEnd(boundaryNode, boundaryOffset);
  return range.toString().length;
}

function unpaint(instance) {
  const spans = instance.container.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  }
  instance.container.normalize();
}

function wrapThread(instance, thread) {
  const entries = buildTextIndex(instance.container);
  const targets = [];
  for (const entry of entries) {
    if (entry.end <= thread.start || entry.start >= thread.end) continue;
    targets.push({
      node: entry.node,
      localStart: Math.max(0, thread.start - entry.start),
      localEnd: Math.min(entry.node.nodeValue.length, thread.end - entry.start),
    });
  }
  for (const target of targets) {
    let node = target.node;
    if (target.localStart > 0) {
      node = node.splitText(target.localStart);
    }
    const sliceLength = target.localEnd - target.localStart;
    if (sliceLength < node.nodeValue.length) {
      node.splitText(sliceLength);
    }
    if (!node.nodeValue.length) continue;
    const span = document.createElement("span");
    span.className = HIGHLIGHT_CLASS;
    if (thread.resolved) span.classList.add(RESOLVED_CLASS);
    if (instance.activeThreadId === thread.id) span.classList.add(ACTIVE_CLASS);
    span.dataset.ymThreadId = thread.id;
    node.parentNode.insertBefore(span, node);
    span.appendChild(node);
  }
}

function paint(instance) {
  unpaint(instance);
  for (const thread of instance.threads) {
    wrapThread(instance, thread);
  }
}

function applyActiveClasses(instance) {
  const spans = instance.container.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  for (const span of spans) {
    span.classList.toggle(
      ACTIVE_CLASS,
      span.dataset.ymThreadId === instance.activeThreadId,
    );
  }
}

function hideAddButton(instance) {
  instance.addButton.style.display = "none";
}

function showAddButton(instance, range) {
  const rects = range.getClientRects();
  const rect = rects.length ? rects[rects.length - 1] : null;
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideAddButton(instance);
    return;
  }
  const containerRect = instance.container.getBoundingClientRect();
  const top = rect.bottom - containerRect.top + instance.container.scrollTop +
    6;
  const left = Math.min(
    Math.max(
      rect.right - containerRect.left + instance.container.scrollLeft,
      8,
    ),
    instance.container.clientWidth - 40,
  );
  instance.addButton.style.top = `${top}px`;
  instance.addButton.style.left = `${left}px`;
  instance.addButton.style.display = "inline-flex";
}

function clearPendingSelection(instance, emitChange) {
  hideAddButton(instance);
  if (instance.pendingSelection && emitChange) {
    emit("selectionChanged", {
      handle: instance.handle,
      json: { selected: false },
    });
  }
  instance.pendingSelection = null;
}

function handleSelectionChange(instance) {
  const selection = document.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    clearPendingSelection(instance, true);
    return;
  }
  const range = selection.getRangeAt(0);
  if (
    !instance.container.contains(range.startContainer) ||
    !instance.container.contains(range.endContainer)
  ) {
    clearPendingSelection(instance, true);
    return;
  }
  const start = absoluteOffset(
    instance.container,
    range.startContainer,
    range.startOffset,
  );
  const end = absoluteOffset(
    instance.container,
    range.endContainer,
    range.endOffset,
  );
  if (end <= start) {
    clearPendingSelection(instance, true);
    return;
  }
  let quote = range.toString().replace(/\s+/g, " ").trim();
  if (quote.length > MAX_QUOTE_LENGTH) {
    quote = quote.slice(0, MAX_QUOTE_LENGTH - 1) + "…";
  }
  instance.pendingSelection = { start, end, quote };
  if (instance.canComment) {
    showAddButton(instance, range);
  }
  emit("selectionChanged", {
    handle: instance.handle,
    json: { selected: true, start, end, quote },
  });
}

function handleContainerClick(instance, event) {
  if (event.target.closest(`.${ADD_BUTTON_CLASS}`)) return;
  const span = event.target.closest(`[data-ym-thread-id]`);
  if (!span || !instance.container.contains(span)) return;
  instance.activeThreadId = span.dataset.ymThreadId;
  applyActiveClasses(instance);
  emit("threadClicked", {
    handle: instance.handle,
    json: { id: span.dataset.ymThreadId },
  });
}

function handleAddButtonClick(instance, event) {
  event.preventDefault();
  event.stopPropagation();
  const pending = instance.pendingSelection;
  if (!pending) return;
  hideAddButton(instance);
  const selection = document.getSelection();
  if (selection) selection.removeAllRanges();
  instance.pendingSelection = null;
  emit("commentRequested", {
    handle: instance.handle,
    json: pending,
  });
}

function init(args) {
  const opts = parseArgs(args);
  const handle = opts.handle;
  const containerId = opts.containerId;
  try {
    const container = document.getElementById(containerId);
    if (!container) {
      emit("error", {
        handle,
        json: { message: "Container not found: " + containerId },
      });
      return moduleResult(handle, { success: false });
    }
    cleanup({ handle });
    ensureStyles();

    const computed = getComputedStyle(container);
    if (computed.position === "static") {
      container.style.position = "relative";
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = ADD_BUTTON_CLASS;
    addButton.textContent = "💬 Comment";
    addButton.style.display = "none";
    container.appendChild(addButton);

    const instance = {
      handle,
      container,
      addButton,
      threads: normalizeThreads(opts.threads),
      activeThreadId: null,
      canComment: opts.canComment === true,
      pendingSelection: null,
      onSelectionChange: null,
      onClick: null,
      onAddClick: null,
    };
    instance.onSelectionChange = () => handleSelectionChange(instance);
    instance.onClick = (event) => handleContainerClick(instance, event);
    instance.onAddClick = (event) => handleAddButtonClick(instance, event);
    document.addEventListener("selectionchange", instance.onSelectionChange);
    container.addEventListener("click", instance.onClick);
    // mousedown so the button acts before selectionchange clears the pending
    // selection on click.
    addButton.addEventListener("mousedown", instance.onAddClick);
    instances.set(handle, instance);

    paint(instance);
    emit("ready", { handle, json: { threadCount: instance.threads.length } });
    return moduleResult(handle, { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function setThreads(args) {
  const opts = parseArgs(args);
  const instance = instances.get(opts.handle);
  if (!instance) return moduleResult(opts.handle, { success: false });
  instance.threads = normalizeThreads(opts.threads);
  if (
    instance.activeThreadId &&
    !instance.threads.some((thread) => thread.id === instance.activeThreadId)
  ) {
    instance.activeThreadId = null;
  }
  paint(instance);
  return moduleResult(opts.handle, { success: true });
}

function setActiveThread(args) {
  const opts = parseArgs(args);
  const instance = instances.get(opts.handle);
  if (!instance) return moduleResult(opts.handle, { success: false });
  instance.activeThreadId = opts.id === null || opts.id === undefined
    ? null
    : String(opts.id);
  applyActiveClasses(instance);
  if (instance.activeThreadId) {
    const span = instance.container.querySelector(
      `[data-ym-thread-id="${instance.activeThreadId}"]`,
    );
    if (span) {
      span.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  return moduleResult(opts.handle, { success: true });
}

function clearSelection(args) {
  const opts = parseArgs(args);
  const instance = instances.get(opts.handle);
  if (!instance) return moduleResult(opts.handle, { success: false });
  clearPendingSelection(instance, false);
  const selection = document.getSelection();
  if (selection) selection.removeAllRanges();
  return moduleResult(opts.handle, { success: true });
}

function cleanup(args) {
  const opts = parseArgs(args);
  const instance = instances.get(opts.handle);
  if (!instance) return;
  document.removeEventListener("selectionchange", instance.onSelectionChange);
  instance.container.removeEventListener("click", instance.onClick);
  instance.addButton.removeEventListener("mousedown", instance.onAddClick);
  if (instance.addButton.parentNode) {
    instance.addButton.parentNode.removeChild(instance.addButton);
  }
  unpaint(instance);
  instances.delete(opts.handle);
}

registerModule({
  init,
  setThreads,
  setActiveThread,
  clearSelection,
  cleanup,
});
