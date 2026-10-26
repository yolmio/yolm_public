import { applyImageLayout, createImageFigure } from "./image_controls.js";
import { captureVideoThumbnail, VideoNode, videoSource } from "./video.js";
const __v2 = 2;
// Lexical Editor Module for Yolm
// This module provides a rich text editor using Lexical with full toolbar support

// Lexical modules - imported from dependencies
import * as lexical from "lexical";
import * as lexicalRichText from "@lexical/rich-text";
import * as lexicalHistory from "@lexical/history";
import * as lexicalList from "@lexical/list";
import * as lexicalLink from "@lexical/link";
import * as lexicalSelection from "@lexical/selection";
import * as lexicalHtml from "@lexical/html";
import * as lexicalTable from "@lexical/table";

// Store editor instances by handle
const editors = new Map();
const pendingCommands = new Map();
const readOnlyImageExpansions = new Map();

// Store last event data for retrieval via getEventData
const lastEventData = new Map();

// ============================================
// MentionNode — a TextNode subclass that renders a styled atomic mention.
// The visible text is stored as the TextNode text (e.g. "@Alice"). The
// stable id we hand back to Yolm lives in __mentionId. We mark the node
// as a text entity so cursor movement / delete treats it as one unit.
// ============================================
let MentionNode = null;
let $createMentionNode = null;
let ImageNode = null;
let $createImageNode = null;
let $isImageNode = null;

function ensureMentionNodeDefined() {
  if (MentionNode) return;
  const { TextNode } = lexical;
  if (!TextNode) return;

  class _MentionNode extends TextNode {
    static getType() {
      return "mention";
    }

    static clone(node) {
      return new _MentionNode(
        node.__mentionId,
        node.__text,
        node.__mentionTrigger,
        node.__mentionUrl,
        node.__mentionKind,
        node.__key,
      );
    }

    constructor(mentionId, text, mentionTrigger, mentionUrl, mentionKind, key) {
      super(text, key);
      this.__mentionId = mentionId;
      this.__mentionTrigger = mentionTrigger || "@";
      this.__mentionUrl = mentionUrl || null;
      this.__mentionKind = mentionKind || "mention";
    }

    getMentionId() {
      const self = this.getLatest();
      return self.__mentionId;
    }

    createDOM(config) {
      const dom = super.createDOM(config);
      dom.classList.add("lexical-mention");
      dom.setAttribute("data-mention-id", String(this.__mentionId ?? ""));
      dom.setAttribute("data-mention-trigger", this.__mentionTrigger);
      dom.setAttribute("data-mention-kind", this.__mentionKind);
      dom.setAttribute("data-lexical-mention", "true");
      if (this.__mentionUrl) {
        dom.classList.add("lexical-reference");
        dom.setAttribute("data-mention-url", this.__mentionUrl);
      }
      // Selecting the whole node on click is the canonical mention UX.
      dom.setAttribute("spellcheck", "false");
      return dom;
    }

    updateDOM(prevNode, dom, config) {
      const updated = super.updateDOM(prevNode, dom, config);
      if (prevNode.__mentionId !== this.__mentionId) {
        dom.setAttribute("data-mention-id", String(this.__mentionId ?? ""));
      }
      if (prevNode.__mentionTrigger !== this.__mentionTrigger) {
        dom.setAttribute("data-mention-trigger", this.__mentionTrigger);
      }
      if (prevNode.__mentionKind !== this.__mentionKind) {
        dom.setAttribute("data-mention-kind", this.__mentionKind);
      }
      if (prevNode.__mentionUrl !== this.__mentionUrl) {
        if (this.__mentionUrl) {
          dom.classList.add("lexical-reference");
          dom.setAttribute("data-mention-url", this.__mentionUrl);
        } else {
          dom.classList.remove("lexical-reference");
          dom.removeAttribute("data-mention-url");
        }
      }
      return updated;
    }

    static importJSON(serialized) {
      const node = $createMentionNode(
        serialized.mentionId ?? null,
        serialized.text ?? "",
        serialized.mentionTrigger ?? "@",
        serialized.mentionUrl ?? null,
        serialized.mentionKind ?? "mention",
      );
      node.setFormat(serialized.format ?? 0);
      node.setDetail(serialized.detail ?? 0);
      node.setMode(serialized.mode ?? "token");
      node.setStyle(serialized.style ?? "");
      return node;
    }

    exportJSON() {
      return {
        ...super.exportJSON(),
        type: "mention",
        version: 1,
        mentionId: this.__mentionId,
        mentionTrigger: this.__mentionTrigger,
        mentionUrl: this.__mentionUrl,
        mentionKind: this.__mentionKind,
      };
    }

    // Treat as atomic when moving the caret across it.
    isTextEntity() {
      return true;
    }

    // Don't let typing inside a mention silently mutate its text.
    canInsertTextBefore() {
      return false;
    }

    canInsertTextAfter() {
      return true;
    }
  }

  MentionNode = _MentionNode;
  $createMentionNode = (
    mentionId,
    text,
    mentionTrigger,
    mentionUrl,
    mentionKind,
  ) => {
    // "token" mode makes the node a single atomic unit for selection / delete.
    return new MentionNode(
      mentionId,
      text,
      mentionTrigger,
      mentionUrl,
      mentionKind,
    ).setMode("token");
  };
}

function ensureImageNodeDefined() {
  if (ImageNode) return;
  const { ElementNode } = lexical;
  if (!ElementNode) return;

  class _ImageNode extends ElementNode {
    static getType() {
      return "image";
    }

    static clone(node) {
      return new _ImageNode(
        node.__src,
        node.__altText,
        node.__width,
        node.__height,
        node.__align,
        node.__blobHash,
        node.__assetKey,
        node.__contentType,
        node.__key,
      );
    }

    constructor(
      src,
      altText,
      width,
      height,
      align,
      blobHash,
      assetKey,
      contentType,
      key,
    ) {
      super(key);
      this.__src = src;
      this.__altText = altText || "";
      this.__width = width || 480;
      this.__height = height || null;
      this.__align = align || "center";
      this.__blobHash = blobHash || null;
      this.__assetKey = assetKey || null;
      this.__contentType = contentType || null;
    }

    static importDOM() {
      return {
        img: (element) =>
          element.dataset.yolmUploadId
            ? {
              priority: 4,
              conversion: () => ({
                node: $createImageNode({
                  src: element.getAttribute("src") || "",
                  altText: element.getAttribute("alt") || "Pasted image",
                  assetKey: element.dataset.yolmUploadId,
                  width: 480,
                }),
              }),
            }
            : null,
      };
    }

    static importJSON(serialized) {
      return $createImageNode({
        src: serialized.src || "",
        altText: serialized.altText || "",
        width: serialized.width || 480,
        height: serialized.height || null,
        align: serialized.align || "center",
        blobHash: serialized.blobHash || null,
        assetKey: serialized.assetKey || null,
        contentType: serialized.contentType || null,
      });
    }

    exportJSON() {
      return {
        type: "image",
        version: 1,
        children: [],
        direction: null,
        format: "",
        indent: 0,
        src: this.__src,
        altText: this.__altText,
        width: this.__width,
        height: this.__height,
        align: this.__align,
        blobHash: this.__blobHash,
        assetKey: this.__assetKey,
        contentType: this.__contentType,
      };
    }

    createDOM() {
      return createImageFigure({
        key: this.getKey(),
        ...this.getImageData(),
      });
    }

    updateDOM(previousNode, figure) {
      const image = figure.querySelector("img");
      if (image) {
        if (previousNode.__src !== this.__src) image.src = this.__src;
        if (previousNode.__altText !== this.__altText) {
          image.alt = this.__altText;
        }
        if (previousNode.__width !== this.__width) {
          image.style.width = `${this.__width}px`;
        }
        if (previousNode.__height !== this.__height) {
          image.style.height = this.__height ? `${this.__height}px` : "auto";
        }
      }
      if (previousNode.__align !== this.__align) {
        applyImageLayout(figure, this.__align);
      }
      return false;
    }

    canBeEmpty() {
      return false;
    }

    isInline() {
      return false;
    }

    canInsertTextBefore() {
      return true;
    }

    canInsertTextAfter() {
      return true;
    }

    setWidth(width) {
      const writable = this.getWritable();
      writable.__width = Math.max(80, Math.min(720, Math.round(width)));
    }

    setAlign(align) {
      const writable = this.getWritable();
      writable.__align = ["left", "center", "right"].includes(align)
        ? align
        : "center";
    }

    getWidth() {
      return this.getLatest().__width;
    }

    getImageData() {
      const latest = this.getLatest();
      return {
        src: latest.__src,
        altText: latest.__altText,
        width: latest.__width,
        height: latest.__height,
        align: latest.__align,
        blobHash: latest.__blobHash,
        assetKey: latest.__assetKey,
        contentType: latest.__contentType,
      };
    }
  }

  ImageNode = _ImageNode;
  $createImageNode = (
    { src, altText, width, height, align, blobHash, assetKey, contentType },
  ) =>
    new ImageNode(
      src,
      altText,
      width,
      height,
      align,
      blobHash,
      assetKey,
      contentType,
    );
  $isImageNode = (node) => node instanceof ImageNode;
}

// ============================================
// Mention trigger state — one entry per editor instance, tracking an
// active @-typeahead session so we can grow/cancel the query as the user
// keeps typing, and replace the trigger text on insert.
// ============================================
function defaultMentionTrigger() {
  return "@";
}

function findTriggerMatch(textBeforeCaret, triggers) {
  // Match: start of text or whitespace, then the trigger, then a query
  // consisting of any non-whitespace chars that aren't the trigger itself.
  // Excluding the trigger char from the query prevents "@bob@alice" from
  // being read as a single 13-char query. Allowing any non-whitespace
  // (rather than \w) supports unicode names like "François" or "李".
  let bestMatch = null;
  for (const trigger of triggers) {
    const esc = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?:^|\\s)(" + esc + ")([^\\s" + esc + "]*)$");
    const match = textBeforeCaret.match(re);
    if (!match) continue;
    const candidate = {
      trigger: match[1],
      query: match[2],
      // Offset of the trigger char within textBeforeCaret.
      triggerOffset: match.index + (match[0].length - match[1].length -
        match[2].length),
    };
    if (!bestMatch || candidate.triggerOffset > bestMatch.triggerOffset) {
      bestMatch = candidate;
    }
  }
  return bestMatch;
}

function getTextBeforeCaret(selection) {
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!anchorNode || anchorNode.getType() !== "text") return null;
  const offset = anchor.offset;
  const text = anchorNode.getTextContent();
  return { node: anchorNode, offset, text: text.slice(0, offset) };
}

function emitMentionState(instance, payload) {
  emit("mention", { handle: instance.handle, json: payload });
}

function evaluateMentionTrigger(instance) {
  const { editor, mention } = instance;
  if (!mention || !mention.enabled) return;
  const { $getSelection, $isRangeSelection } = lexical;

  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      if (mention.active) {
        mention.active = false;
        emitMentionState(instance, { action: "closed" });
      }
      return;
    }

    const before = getTextBeforeCaret(selection);
    if (!before) {
      if (mention.active) {
        mention.active = false;
        emitMentionState(instance, { action: "closed" });
      }
      return;
    }

    const match = findTriggerMatch(before.text, mention.triggers);
    if (!match) {
      if (mention.active) {
        mention.active = false;
        emitMentionState(instance, { action: "closed" });
      }
      return;
    }

    // Record where the @-trigger lives so insertMention can replace it.
    mention.triggerNodeKey = before.node.getKey();
    mention.triggerOffset = match.triggerOffset;
    mention.queryEndOffset = before.offset;

    const wasActive = mention.active;
    const sameQuery = wasActive && mention.query === match.query &&
      mention.activeTrigger === match.trigger;
    mention.active = true;
    mention.query = match.query;
    mention.activeTrigger = match.trigger;

    if (sameQuery && wasActive) return;

    // Compute caret position for popover anchoring.
    let rect = { left: 0, top: 0, bottom: 0, right: 0 };
    try {
      const domSel = globalThis.getSelection();
      if (domSel && domSel.rangeCount > 0) {
        const range = domSel.getRangeAt(0).cloneRange();
        const rects = range.getClientRects();
        if (rects.length > 0) rect = rects[rects.length - 1];
        else {
          const fallback = range.getBoundingClientRect();
          if (fallback) rect = fallback;
        }
      }
    } catch (_e) {
      // Best-effort; popover will still show, just anchored at 0,0.
    }

    if (!wasActive) {
      emitMentionState(instance, {
        action: "opened",
        trigger: match.trigger,
        query: match.query,
        anchor_left: rect.left,
        anchor_top: rect.top,
        anchor_bottom: rect.bottom,
        anchor_right: rect.right,
      });
    } else {
      emitMentionState(instance, {
        action: "query_changed",
        trigger: match.trigger,
        query: match.query,
        anchor_left: rect.left,
        anchor_top: rect.top,
        anchor_bottom: rect.bottom,
        anchor_right: rect.right,
      });
    }
  });
}

function registerMentionPlugin(instance) {
  const { editor } = instance;
  const {
    KEY_ARROW_DOWN_COMMAND,
    KEY_ARROW_UP_COMMAND,
    KEY_ENTER_COMMAND,
    KEY_ESCAPE_COMMAND,
    KEY_TAB_COMMAND,
    COMMAND_PRIORITY_HIGH,
  } = lexical;

  // While a mention popover is open, intercept navigation keys and let
  // the Yolm side decide what to do with them.
  const swallow = (action) => (event) => {
    // A server-backed result refresh can briefly close/reopen the popover
    // while the trigger text and caret are still valid. Re-evaluate here so
    // Enter/Tab selection remains reliable across trigger changes.
    if (!instance.mention.active) {
      evaluateMentionTrigger(instance);
    }
    if (!instance.mention.active) return false;
    if (event && event.preventDefault) event.preventDefault();
    emitMentionState(instance, { action });
    return true;
  };

  if (KEY_ARROW_DOWN_COMMAND) {
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      swallow("arrow_down"),
      COMMAND_PRIORITY_HIGH,
    );
  }
  if (KEY_ARROW_UP_COMMAND) {
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      swallow("arrow_up"),
      COMMAND_PRIORITY_HIGH,
    );
  }
  if (KEY_ENTER_COMMAND) {
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      swallow("confirm"),
      COMMAND_PRIORITY_HIGH,
    );
  }
  if (KEY_TAB_COMMAND) {
    editor.registerCommand(
      KEY_TAB_COMMAND,
      swallow("confirm"),
      COMMAND_PRIORITY_HIGH,
    );
  }
  if (KEY_ESCAPE_COMMAND) {
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (!instance.mention.active) return false;
        if (event && event.preventDefault) event.preventDefault();
        instance.mention.active = false;
        emitMentionState(instance, { action: "closed" });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }

  // Click delegation: when a rendered mention is clicked, emit so Yolm
  // can route it to the caller's onClick. Works in both editable + read-only.
  const onContainerClick = (event) => {
    let el = event.target;
    while (el && el !== instance.container) {
      if (
        el.getAttribute && el.getAttribute("data-lexical-mention") === "true"
      ) {
        const mentionId = el.getAttribute("data-mention-id");
        emit("mentionClicked", {
          handle: instance.handle,
          json: {
            mention_id: mentionId,
            mention_trigger: el.getAttribute("data-mention-trigger") || "@",
            mention_url: el.getAttribute("data-mention-url"),
          },
        });
        return;
      }
      el = el.parentNode;
    }
  };
  instance.container.addEventListener("click", onContainerClick);
  instance.onContainerClick = onContainerClick;
}

function insertMentionAtTrigger(instance, args) {
  const { editor, mention } = instance;
  if (!mention || !mention.enabled) return false;
  if (!mention.active || !mention.triggerNodeKey) return false;

  const {
    $getNodeByKey,
    $createTextNode,
    $isTextNode,
    $getSelection,
    $isRangeSelection,
  } = lexical;

  let inserted = false;
  editor.update(() => {
    const node = $getNodeByKey(mention.triggerNodeKey);
    if (!$isTextNode(node)) return;

    const fullText = node.getTextContent();

    // Safety: the editor may have changed between trigger detection and
    // this update (rare, but possible if the user typed during an async
    // round-trip). Verify the recorded range still points at a
    // "<trigger><non-whitespace>" slice; if not, abort instead of
    // clobbering unrelated text.
    if (
      mention.triggerOffset < 0 ||
      mention.queryEndOffset > fullText.length ||
      mention.triggerOffset >= mention.queryEndOffset
    ) {
      return;
    }
    const triggerSlice = fullText.slice(
      mention.triggerOffset,
      mention.triggerOffset + mention.activeTrigger.length,
    );
    if (triggerSlice !== mention.activeTrigger) return;

    const before = fullText.slice(0, mention.triggerOffset);
    const after = fullText.slice(mention.queryEndOffset);

    // Build the visible label. We prefix with the trigger so "@" is part
    // of the rendered text.
    const visible = (args.trigger || mention.activeTrigger) +
      (args.label ?? "");

    // Split the original text node so we can replace just the trigger+query
    // range with a MentionNode while preserving surrounding formatting.
    const mentionNode = $createMentionNode(
      args.id ?? null,
      visible,
      args.trigger || mention.activeTrigger,
      args.url || null,
      args.kind || "mention",
    );
    const trailing = $createTextNode(" " + after);

    if (before.length === 0) {
      node.replace(mentionNode);
    } else {
      node.setTextContent(before);
      node.insertAfter(mentionNode);
    }
    mentionNode.insertAfter(trailing);

    // Place the caret right after the trailing space.
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      trailing.select(1, 1);
    }
    inserted = true;
  });

  mention.active = false;
  mention.triggerNodeKey = null;
  emitMentionState(instance, { action: "closed" });
  return inserted;
}

// Get last event data (called from Yolm to retrieve event payload)
function getEventData(args) {
  const { handle } = args;
  return lastEventData.get(handle) || {};
}

// Get current selection formatting state
function getSelectionState(editor) {
  const state = {
    is_bold: false,
    is_italic: false,
    is_underline: false,
    is_strikethrough: false,
    is_subscript: false,
    is_superscript: false,
    font_size: null,
    font_color: null,
    background_color: null,
    font_family: null,
    alignment: "left",
    link_url: null,
    link_title: null,
    selected_block_type: "normal",
    can_undo: false,
    can_redo: false,
  };

  editor.getEditorState().read(() => {
    const selection = lexical.$getSelection();
    if (!lexical.$isRangeSelection(selection)) {
      return;
    }

    // Text formatting
    state.is_bold = selection.hasFormat("bold");
    state.is_italic = selection.hasFormat("italic");
    state.is_underline = selection.hasFormat("underline");
    state.is_strikethrough = selection.hasFormat("strikethrough");
    state.is_subscript = selection.hasFormat("subscript");
    state.is_superscript = selection.hasFormat("superscript");

    // Get style properties using lexicalSelection
    if (lexicalSelection?.$getSelectionStyleValueForProperty) {
      state.font_size = lexicalSelection.$getSelectionStyleValueForProperty(
        selection,
        "font-size",
        null,
      );
      state.font_color = lexicalSelection.$getSelectionStyleValueForProperty(
        selection,
        "color",
        null,
      );
      state.background_color = lexicalSelection
        .$getSelectionStyleValueForProperty(
          selection,
          "background-color",
          null,
        );
      state.font_family = lexicalSelection.$getSelectionStyleValueForProperty(
        selection,
        "font-family",
        null,
      );
    }

    // Get anchor node for block type detection
    const anchorNode = selection.anchor.getNode();
    const element = anchorNode.getKey() === "root"
      ? anchorNode
      : anchorNode.getTopLevelElementOrThrow();

    const elementKey = element.getKey();
    const elementDOM = editor.getElementByKey(elementKey);

    // Detect block type
    if (elementDOM) {
      const type = element.getType();
      if (type === "heading") {
        // Get the actual heading tag (h1, h2, etc.)
        const tag = element.getTag?.();
        state.selected_block_type = tag || "h1";
      } else if (type === "quote") {
        state.selected_block_type = "quote";
      } else if (type === "listitem") {
        const parent = element.getParent();
        if (parent) {
          const listType = parent.getListType?.();
          state.selected_block_type = listType === "number"
            ? "number"
            : "bullet";
        }
      } else {
        state.selected_block_type = "normal";
      }

      // Get alignment from element format
      const format = element.getFormatType?.();
      if (format) {
        state.alignment = format;
      }
    }

    // Check for link
    const nodes = selection.getNodes();
    for (const node of nodes) {
      const parent = node.getParent();
      if (lexicalLink.$isLinkNode(parent)) {
        state.link_url = parent.getURL();
        state.link_title = parent.getTitle?.() || null;
        break;
      }
      if (lexicalLink.$isLinkNode(node)) {
        state.link_url = node.getURL();
        state.link_title = node.getTitle?.() || null;
        break;
      }
    }
  });

  // Note: can_undo and can_redo are set by the caller using command listeners
  return state;
}

// Helper function to check if Tab should indent or insert tab
function $indentOverTab(selection) {
  const {
    $isRangeSelection,
    $createRangeSelection,
    $normalizeSelection__EXPERIMENTAL,
  } = lexical;

  if (!$isRangeSelection(selection)) return false;

  const nodes = selection.getNodes();

  // Check if any nodes can be indented
  const canIndentBlockNodes = nodes.filter((node) => {
    if (node.canIndent?.()) {
      return true;
    }
    return false;
  });

  // 1. If selection spans across canIndent block nodes: indent
  if (canIndentBlockNodes.length > 0) {
    return true;
  }

  // 2. If first (anchor/focus) is at block start: indent
  const anchor = selection.anchor;
  const focus = selection.focus;
  const first = focus.isBefore(anchor) ? focus : anchor;
  const firstNode = first.getNode();

  // Get nearest block element
  let firstBlock = firstNode;
  while (firstBlock && !firstBlock.getTopLevelElement) {
    firstBlock = firstBlock.getParent?.();
  }
  if (firstBlock?.getTopLevelElement) {
    firstBlock = firstBlock.getTopLevelElement();
  }

  if (firstBlock?.canIndent?.()) {
    const firstBlockKey = firstBlock.getKey();
    let selectionAtStart = $createRangeSelection();
    selectionAtStart.anchor.set(firstBlockKey, 0, "element");
    selectionAtStart.focus.set(firstBlockKey, 0, "element");
    if ($normalizeSelection__EXPERIMENTAL) {
      selectionAtStart = $normalizeSelection__EXPERIMENTAL(selectionAtStart);
    }
    if (selectionAtStart.anchor.is(first)) {
      return true;
    }
  }

  // 3. Else: insert tab
  return false;
}

// Register TabIndent plugin
function registerTabIndent(editor) {
  const {
    KEY_TAB_COMMAND,
    INDENT_CONTENT_COMMAND,
    OUTDENT_CONTENT_COMMAND,
    INSERT_TAB_COMMAND,
    COMMAND_PRIORITY_EDITOR,
    $getSelection,
    $isRangeSelection,
  } = lexical;

  if (!KEY_TAB_COMMAND) {
    console.log("KEY_TAB_COMMAND not available");
    return;
  }

  return editor.registerCommand(
    KEY_TAB_COMMAND,
    (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return false;
      }

      event.preventDefault();
      const shouldIndent = $indentOverTab(selection);
      const command = shouldIndent
        ? (event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND)
        : INSERT_TAB_COMMAND;

      if (command) {
        return editor.dispatchCommand(command, undefined);
      }
      return false;
    },
    COMMAND_PRIORITY_EDITOR,
  );
}

function getClipboardTextStyle(element) {
  const style = {};
  if (!element?.style) return style;
  for (
    const [cssProperty, styleProperty] of [
      ["color", "color"],
      ["background-color", "backgroundColor"],
      ["font-family", "fontFamily"],
      ["font-size", "fontSize"],
    ]
  ) {
    const value = element.style[styleProperty];
    if (value) style[cssProperty] = value;
  }
  return style;
}

function clipboardStyleFromDeclaration(declaration) {
  const style = {};
  for (
    const [cssProperty, styleProperty] of [
      ["color", "color"],
      ["background-color", "backgroundColor"],
      ["font-family", "fontFamily"],
      ["font-size", "fontSize"],
      ["font-weight", "fontWeight"],
      ["font-style", "fontStyle"],
      ["text-decoration", "textDecoration"],
      ["text-align", "textAlign"],
      ["vertical-align", "verticalAlign"],
      ["margin-left", "marginLeft"],
      ["padding-left", "paddingLeft"],
      ["text-indent", "textIndent"],
    ]
  ) {
    const value = declaration?.[styleProperty] ||
      declaration?.getPropertyValue?.(cssProperty);
    if (value) style[cssProperty] = value;
  }

  if (!style["background-color"]) {
    const wordHighlight = declaration?.getPropertyValue?.("mso-highlight");
    if (wordHighlight && wordHighlight !== "none") {
      style["background-color"] = wordHighlight;
    }
  }
  if (!style["font-weight"]) {
    const wordWeight = declaration?.getPropertyValue?.(
      "mso-bidi-font-weight",
    );
    if (wordWeight) style["font-weight"] = wordWeight;
  }
  if (!style["font-style"]) {
    const wordStyle = declaration?.getPropertyValue?.("mso-bidi-font-style");
    if (wordStyle) style["font-style"] = wordStyle;
  }
  if (!style["text-decoration"]) {
    const decorationLine = declaration?.textDecorationLine ||
      declaration?.getPropertyValue?.("text-decoration-line");
    if (decorationLine) style["text-decoration"] = decorationLine;
  }
  return style;
}

function collectClipboardCssRules(dom) {
  const rules = [];
  const collectRules = (cssRules) => {
    for (const rule of Array.from(cssRules || [])) {
      if (rule.selectorText && rule.style) {
        rules.push({
          selectors: rule.selectorText.split(",").map((selector) =>
            selector.trim()
          ).filter(Boolean),
          style: clipboardStyleFromDeclaration(rule.style),
        });
      }
      if (rule.cssRules) collectRules(rule.cssRules);
    }
  };

  for (const styleElement of dom.querySelectorAll("style")) {
    try {
      if (styleElement.sheet) {
        collectRules(styleElement.sheet.cssRules);
        continue;
      }
      if (typeof CSSStyleSheet !== "undefined") {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(styleElement.textContent || "");
        collectRules(sheet.cssRules);
      }
    } catch (_error) {
      // Ignore malformed or unsupported Office CSS. The inline-style and
      // semantic-tag import paths still preserve the usable content.
    }
  }
  return rules;
}

function normalizeClipboardFontWeight(value) {
  if (!value) return value;
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric >= 600 ? "bold" : value;
}

function materializeClipboardStyles(dom) {
  const rules = collectClipboardCssRules(dom);
  for (const element of dom.querySelectorAll("style, script, meta, link")) {
    element.remove();
  }
  const inheritedProperties = [
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-decoration",
    "vertical-align",
  ];

  const visit = (element, inheritedStyle) => {
    let matchedStyle = {};
    for (const rule of rules) {
      let matches = false;
      for (const selector of rule.selectors) {
        try {
          if (element.matches(selector)) {
            matches = true;
            break;
          }
        } catch (_error) {
          // Word occasionally emits selectors that browsers do not accept.
        }
      }
      if (matches) matchedStyle = { ...matchedStyle, ...rule.style };
    }

    const inlineStyle = clipboardStyleFromDeclaration(element.style);
    // Office exports paragraph alignment as an HTML attribute, sometimes
    // alongside a generic p { text-align: left } rule. Preserve the explicit
    // paragraph alignment unless an inline style overrides it.
    const alignment = element.getAttribute("align")?.toLowerCase();
    const alignmentStyle = /^(left|center|right|justify)$/.test(alignment || "")
      ? { "text-align": alignment }
      : {};
    const ownStyle = { ...matchedStyle, ...alignmentStyle, ...inlineStyle };
    const effectiveStyle = { ...inheritedStyle, ...ownStyle };
    if (effectiveStyle["font-weight"]) {
      effectiveStyle["font-weight"] = normalizeClipboardFontWeight(
        effectiveStyle["font-weight"],
      );
    }
    for (const [property, value] of Object.entries(effectiveStyle)) {
      if (value) element.style.setProperty(property, value);
    }

    const nextInheritedStyle = {};
    for (const property of inheritedProperties) {
      if (effectiveStyle[property]) {
        nextInheritedStyle[property] = effectiveStyle[property];
      }
    }
    if (ownStyle["background-color"]) {
      nextInheritedStyle["background-color"] = ownStyle["background-color"];
    }
    if (
      /^(P|DIV|LI|TD|TH|H[1-6]|BLOCKQUOTE)$/.test(element.tagName)
    ) {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) {
          continue;
        }
        const span = dom.createElement("span");
        for (const [property, value] of Object.entries(nextInheritedStyle)) {
          if (value) span.style.setProperty(property, value);
        }
        child.replaceWith(span);
        span.append(child);
      }
    }
    for (const child of element.children) {
      visit(child, nextInheritedStyle);
    }
  };

  for (const child of dom.body.children) visit(child, {});
}

function clipboardLengthToPixels(value) {
  const match = String(value || "").trim().match(
    /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|pt|in|cm|mm|pc|em|rem)?$/i,
  );
  if (!match) return 0;

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return 0;
  const pixelsPerUnit = {
    px: 1,
    pt: 96 / 72,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    pc: 16,
    em: 16,
    rem: 16,
  };
  return amount * (pixelsPerUnit[match[2]?.toLowerCase() || "px"] || 1);
}

function collectClipboardBlockIndents(root) {
  const blocks = [];
  for (
    const element of root.querySelectorAll(
      "p, h1, h2, h3, h4, h5, h6, blockquote",
    )
  ) {
    const leftOffset = clipboardLengthToPixels(element.style.marginLeft) +
      clipboardLengthToPixels(element.style.paddingLeft) +
      Math.max(0, clipboardLengthToPixels(element.style.textIndent));
    blocks.push(
      leftOffset >= 8
        ? Math.min(20, Math.max(1, Math.round(leftOffset / 40)))
        : 0,
    );
  }
  return blocks;
}

function applyClipboardBlockIndents(nodes, indents) {
  let blockIndex = 0;
  for (const node of nodes) {
    if (!lexical.$isElementNode(node)) continue;
    if (!["paragraph", "heading", "quote"].includes(node.getType())) continue;
    const indent = indents[blockIndex++] || 0;
    if (indent > node.getIndent()) node.setIndent(indent);
  }
}

function stringifyClipboardTextStyle(style) {
  return Object.entries(style)
    .filter(([, value]) => value)
    .map(([property, value]) => `${property}: ${value};`)
    .join(" ");
}

function convertClipboardTextNode(domNode) {
  const conversion = lexical.TextNode.importDOM()["#text"](domNode);
  const output = conversion.conversion(domNode);
  if (!output) return output;

  // Apply styles to the source text node during conversion. Raw HTML offsets
  // diverge from Lexical offsets when whitespace is collapsed or discarded.
  const style = stringifyClipboardTextStyle(
    getClipboardTextStyle(domNode.parentElement),
  );
  const nodes = Array.isArray(output.node) ? output.node : [output.node];
  for (const node of nodes) {
    if (lexical.$isTextNode(node) && style) node.setStyle(style);
  }
  return output;
}

function collectLexicalTextNodes(nodes) {
  const textNodes = [];

  const visit = (node) => {
    if (lexical.$isTextNode(node)) {
      textNodes.push(node);
      return;
    }
    if (lexical.$isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };

  for (const node of nodes) visit(node);
  return textNodes;
}

function stripSerializedTextStyles(value) {
  if (Array.isArray(value)) {
    return value.map(stripSerializedTextStyles);
  }
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      (value.type === "text" && key === "style") || key === "textStyle"
    ) {
      result[key] = "";
    } else {
      result[key] = stripSerializedTextStyles(child);
    }
  }
  return result;
}

function constrainedDocumentTextStyle(value) {
  const declarations = String(value || "")
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  let family = "";
  let size = "";

  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const rawValue = declaration.slice(separator + 1).trim();
    const normalizedValue = rawValue.toLowerCase();
    if (property === "font-family") {
      if (normalizedValue.includes("noto sans mono")) {
        family = "Noto Sans Mono, monospace";
      } else if (normalizedValue.includes("noto serif")) {
        family = "Noto Serif, serif";
      } else if (normalizedValue.includes("noto sans")) {
        family = "Noto Sans, sans-serif";
      }
    } else if (property === "font-size") {
      const match = rawValue.match(/^([0-9]+(?:\.[0-9]+)?)(pt|px)$/i);
      if (!match) continue;
      const numeric = Number(match[1]);
      const unit = match[2].toLowerCase();
      const points = unit === "px" ? numeric * 0.75 : numeric;
      if (points >= 7 && points <= 24) size = `${numeric}${unit}`;
    }
  }

  return [
    family ? `font-family: ${family}` : "",
    size ? `font-size: ${size}` : "",
  ].filter(Boolean).join("; ") + (family || size ? ";" : "");
}

function constrainSerializedDocumentTextStyles(value) {
  if (Array.isArray(value)) {
    return value.map(constrainSerializedDocumentTextStyles);
  }
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (value.type === "text" && key === "style") {
      result[key] = constrainedDocumentTextStyle(child);
    } else if (key === "textStyle") {
      result[key] = "";
    } else {
      result[key] = constrainSerializedDocumentTextStyles(child);
    }
  }
  return result;
}

function clearLexicalTextNodeStyles(nodes) {
  for (const node of collectLexicalTextNodes(nodes)) node.setStyle("");
}

function registerHtmlPaste(instance, preserveTextStyles) {
  const { editor } = instance;
  const {
    COMMAND_PRIORITY_LOW,
    PASTE_COMMAND,
    $getSelection,
    $isRangeSelection,
    $createParagraphNode,
    $createTextNode,
  } = lexical;

  if (!PASTE_COMMAND || !lexicalHtml?.$generateNodesFromDOM) return;

  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      // Let Lexical's native paste preserve our node JSON (including media).
      // HTML is only the fallback for content copied from other applications.
      const structured = event.clipboardData?.getData(
        "application/x-lexical-editor",
      );
      if (structured) {
        try {
          const payload = JSON.parse(structured);
          if (
            payload.namespace === "YolmLexicalEditor" &&
            Array.isArray(payload.nodes)
          ) {
            return false;
          }
        } catch {
          // Invalid clipboard JSON can still supply usable HTML/text.
        }
      }
      const html = event.clipboardData?.getData("text/html");
      if (!html) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text.includes("\n")) return false;
        event.preventDefault();
        const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(
          "\n",
        );
        const nodes = lines.map((line) => {
          const paragraph = $createParagraphNode();
          if (line.length > 0) {
            paragraph.append($createTextNode(line));
          }
          return paragraph;
        });
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertNodes(nodes);
        }
        return true;
      }

      event.preventDefault();
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      if (instance.managedImageUploads) {
        const files = Array.from(event.clipboardData?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        const images = Array.from(dom.querySelectorAll("img"));
        const fileImages = images.filter((img) =>
          !/^data:/i.test(img.getAttribute("src") || "")
        );
        // Clipboard bytes can accompany HTTPS references too. Only pair them
        // when there is one file per non-embedded image; never guess a match.
        for (const img of images) {
          const src = img.getAttribute("src") || "";
          const fileIndex = fileImages.indexOf(img);
          const source = files.length === fileImages.length && fileIndex >= 0
            ? files[fileIndex]
            : src;
          const image = addImageUpload(
            instance,
            source,
            img.getAttribute("alt"),
          );
          img.dataset.yolmUploadId = image.assetKey;
          img.setAttribute("src", image.src);
          img.setAttribute("alt", image.altText);
        }
        setTimeout(() => processImageUploads(instance), 0);
      }
      let blockIndents = [];
      if (preserveTextStyles) {
        materializeClipboardStyles(dom);
        blockIndents = collectClipboardBlockIndents(dom.body);
      }
      const nodes = lexicalHtml.$generateNodesFromDOM(editor, dom);
      if (preserveTextStyles) {
        applyClipboardBlockIndents(nodes, blockIndents);
      } else {
        clearLexicalTextNodeStyles(nodes);
      }
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertNodes(nodes);
      } else if (instance.managedImageUploads) {
        lexical.$getRoot().append(...nodes);
      }
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
}

function updateSelectedImageDom(instance) {
  if (!instance?.container) return;
  for (const node of instance.container.querySelectorAll(".lexical-image")) {
    const selected = node.dataset.lexicalImageKey === instance.selectedImageKey;
    node.classList.toggle("lexical-image-selected", selected);
    const img = node.querySelector("img");
    if (img) {
      img.style.borderColor = selected ? "#2563eb" : "transparent";
      img.style.boxShadow = selected
        ? "0 0 0 2px rgba(37, 99, 235, 0.25)"
        : "none";
    }
    for (
      const handle of node.querySelectorAll(
        ".lexical-image-resize-handle",
      )
    ) {
      handle.style.display = selected ? "block" : "none";
    }
    const toolbar = node.querySelector(".lexical-image-alignment");
    if (toolbar) {
      toolbar.style.display = selected ? "flex" : "none";
      for (const button of toolbar.querySelectorAll("button")) {
        const active = button.dataset.imageAlign === node.style.textAlign;
        button.setAttribute("aria-pressed", String(active));
        button.style.background = active ? "#dbeafe" : "white";
        button.style.color = active ? "#1d4ed8" : "#374151";
      }
    }
  }
}

// Toolbar state; a selected image reports its own alignment.
function getEditorState(instance) {
  const state = getSelectionState(instance.editor);
  state.can_undo = instance.canUndo;
  state.can_redo = instance.canRedo;
  state.selected_image = !!instance.selectedImageKey;
  instance.editor.getEditorState().read(() => {
    const align = getSelectedImageNode(instance)?.getLatest().__align;
    if (align) state.alignment = align;
  });
  return state;
}

function setSelectedImage(instance, key) {
  instance.selectedImageKey = key || null;
  updateSelectedImageDom(instance);
  emit("stateChanged", {
    handle: instance.handle,
    json: getEditorState(instance),
  });
}

function registerImageInteraction(instance) {
  const onContainerClick = (event) => {
    const image = event.target?.closest?.("[data-lexical-image-key]");
    if (!image || !instance.container.contains(image)) {
      setSelectedImage(instance, null);
      return;
    }
    if (event.target?.closest?.("a")) return;
    event.preventDefault();
    setSelectedImage(instance, image.dataset.lexicalImageKey);
    const alignment = event.target?.closest?.("[data-image-align]")?.dataset
      .imageAlign;
    if (alignment) {
      executeCommand({
        handle: instance.handle,
        command: "alignSelectedImage",
        align: alignment,
      });
    }
  };
  instance.container.addEventListener("click", onContainerClick);
  instance.onImageClick = onContainerClick;
  const onKeyDown = (event) => {
    if (event.target?.closest?.(".lexical-image-alignment")) return;
    if (
      instance.selectedImageKey &&
      (event.key.length === 1 ||
        [
          "Enter",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(event.key))
    ) {
      setSelectedImage(instance, null);
    }
    if (
      !instance.selectedImageKey ||
      (event.key !== "Backspace" && event.key !== "Delete")
    ) {
      return;
    }
    event.preventDefault();
    executeCommand({
      handle: instance.handle,
      command: "deleteSelectedImage",
    });
  };
  instance.container.addEventListener("keydown", onKeyDown);
  instance.onImageKeyDown = onKeyDown;

  const finishResize = (event, cancelled = false) => {
    const resize = instance.imageResize;
    if (!resize || (event && event.pointerId !== resize.pointerId)) return;
    instance.imageResize = null;
    if (resize.handle.hasPointerCapture?.(resize.pointerId)) {
      resize.handle.releasePointerCapture(resize.pointerId);
    }
    if (!cancelled && resize.width !== resize.startWidth) {
      instance.editor.update(() => {
        const node = getSelectedImageNode(instance);
        if (node) node.setWidth(resize.width);
      }, { tag: "history-push" });
    } else {
      resize.image.style.width = `${resize.startWidth}px`;
    }
    updateSelectedImageDom(instance);
  };
  const onPointerMove = (event) => {
    const resize = instance.imageResize;
    if (!resize || event.pointerId !== resize.pointerId) return;
    event.preventDefault();
    const direction = resize.corner.includes("e") ? 1 : -1;
    resize.width = Math.max(
      80,
      Math.min(
        720,
        Math.round(
          resize.startWidth +
            direction * (event.clientX - resize.startX) / resize.scale,
        ),
      ),
    );
    resize.image.style.width = `${resize.width}px`;
  };
  const onPointerUp = (event) => finishResize(event);
  const onPointerCancel = (event) => finishResize(event, true);
  const onPointerDown = (event) => {
    const handle = event.target?.closest?.(
      "[data-lexical-image-resize-corner]",
    );
    if (!handle || !instance.container.contains(handle)) return;
    const figure = handle.closest("[data-lexical-image-key]");
    const image = figure?.querySelector("img");
    if (!figure || !image) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedImage(instance, figure.dataset.lexicalImageKey);
    const startWidth = parseFloat(getComputedStyle(image).width);
    const scale = image.getBoundingClientRect().width / startWidth;
    instance.imageResize = {
      corner: handle.dataset.lexicalImageResizeCorner,
      handle,
      image,
      pointerId: event.pointerId,
      startWidth,
      scale,
      startX: event.clientX,
      width: startWidth,
    };
    handle.setPointerCapture?.(event.pointerId);
  };
  const onResizeHandleKeyDown = (event) => {
    const handle = event.target?.closest?.(
      "[data-lexical-image-resize-corner]",
    );
    if (!handle || !instance.container.contains(handle)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const figure = handle.closest("[data-lexical-image-key]");
    if (!figure) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedImage(instance, figure.dataset.lexicalImageKey);
    const direction = handle.dataset.lexicalImageResizeCorner.includes("e")
      ? 1
      : -1;
    const keyboardDelta = event.key === "ArrowRight" ? 16 : -16;
    instance.editor.update(() => {
      const node = getSelectedImageNode(instance);
      if (node) node.setWidth(node.getWidth() + direction * keyboardDelta);
    }, { tag: "history-push" });
    setTimeout(() => updateSelectedImageDom(instance), 0);
  };
  instance.container.addEventListener("pointerdown", onPointerDown);
  instance.container.addEventListener("keydown", onResizeHandleKeyDown);
  globalThis.document.addEventListener("pointermove", onPointerMove);
  globalThis.document.addEventListener("pointerup", onPointerUp);
  globalThis.document.addEventListener("pointercancel", onPointerCancel);
  instance.onImageResizePointerDown = onPointerDown;
  instance.onImageResizeKeyDown = onResizeHandleKeyDown;
  instance.onImageResizePointerMove = onPointerMove;
  instance.onImageResizePointerUp = onPointerUp;
  instance.onImageResizePointerCancel = onPointerCancel;
}

function enableReadOnlyImageExpansion(args) {
  const handle = args?.handle;
  const container = globalThis.document.getElementById(args?.containerId);
  if (!handle || !container) return false;
  cleanupReadOnlyImageExpansion({ handle });

  const onClick = (event) => {
    const image = event.target?.closest?.(".lexical-image img");
    if (!image || !container.contains(image)) return;
    event.preventDefault();

    const dialog = globalThis.document.createElement("dialog");
    dialog.setAttribute("aria-label", image.alt || "Expanded image");
    dialog.style.padding = "0";
    dialog.style.border = "0";
    dialog.style.background = "transparent";
    dialog.style.maxWidth = "calc(100vw - 2rem)";
    dialog.style.maxHeight = "calc(100vh - 2rem)";

    const expandedImage = globalThis.document.createElement("img");
    expandedImage.src = image.src;
    expandedImage.alt = image.alt;
    expandedImage.style.display = "block";
    expandedImage.style.maxWidth = "calc(100vw - 2rem)";
    expandedImage.style.maxHeight = "calc(100vh - 2rem)";
    expandedImage.style.objectFit = "contain";
    expandedImage.style.borderRadius = "0.5rem";
    expandedImage.style.background = "white";
    dialog.append(expandedImage);

    const close = globalThis.document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close expanded image");
    close.style.position = "fixed";
    close.style.top = "1rem";
    close.style.right = "1rem";
    close.style.padding = "0.5rem 0.75rem";
    close.style.border = "0";
    close.style.borderRadius = "0.375rem";
    close.style.background = "rgba(17, 24, 39, 0.9)";
    close.style.color = "white";
    close.style.cursor = "pointer";
    close.addEventListener("click", () => dialog.close());
    dialog.append(close);

    dialog.addEventListener("click", (dialogEvent) => {
      if (dialogEvent.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    globalThis.document.body.append(dialog);
    dialog.showModal();
  };

  container.addEventListener("click", onClick);
  readOnlyImageExpansions.set(handle, { container, onClick });
  return true;
}

function cleanupReadOnlyImageExpansion(args) {
  const handle = args?.handle;
  const expansion = readOnlyImageExpansions.get(handle);
  if (!expansion) return;
  expansion.container.removeEventListener("click", expansion.onClick);
  readOnlyImageExpansions.delete(handle);
}

// Managed inline uploads keep placeholders in the document while bytes are saved.
const emptyImagePreview =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const commentImageLimit = 10 * 1024 * 1024;
// Leave a margin before the server's one-day pending-upload expiration.

function visitImageNodes(node, visit) {
  if ($isImageNode(node)) visit(node);
  for (const child of node.getChildren?.() || []) visitImageNodes(child, visit);
}

function notifyImageUploads(instance) {
  if (!instance.managedImageUploads) return;
  const jobs = Array.from(instance.imageUploads.values()).filter((job) =>
    job.present !== false && job.status !== "done"
  );
  const pending = jobs.filter((job) => job.status !== "failed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const error = jobs.find((job) => job.status === "failed")?.error || "";
  const state = JSON.stringify({ pending, failed, error });
  if (instance.imageUploadState === state) return;
  instance.imageUploadState = state;
  emit("imageUploadState", {
    handle: instance.handle,
    json: { pending, failed, error },
  });
}

function addImageUpload(instance, source, name) {
  const id = crypto.randomUUID();
  const file = source instanceof File ? source : null;
  const preview = typeof source === "string" &&
      /^data:image\/(png|jpeg|gif|webp);base64,/i.test(source) &&
      source.length <= commentImageLimit * 1.4
    ? source
    : emptyImagePreview;
  instance.imageUploads.set(id, {
    id,
    source,
    file,
    preview,
    name: name || file?.name || "Pasted image",
    status: "queued",
  });
  if (
    file && file.size <= commentImageLimit &&
    /^image\/(png|jpeg|gif|webp)$/.test(file.type)
  ) {
    const reader = new FileReader();
    reader.onload = () => {
      if (
        editors.get(instance.handle) !== instance ||
        (!instance.imageUploads.has(id) ||
          instance.imageUploads.get(id).status === "done")
      ) return;
      instance.editor.update(
        () =>
          visitImageNodes(lexical.$getRoot(), (node) => {
            if (node.__assetKey === id) {
              node.getWritable().__src = reader.result;
            }
          }),
        { tag: lexical.HISTORY_MERGE_TAG },
      );
    };
    reader.readAsDataURL(file);
  }
  notifyImageUploads(instance);
  return {
    src: preview,
    altText: name || file?.name || "Pasted image",
    assetKey: id,
    width: 480,
  };
}

function insertImageFiles(instance, files, text = "") {
  if (!instance.editor.isEditable()) return;
  instance.editor.update(() => {
    const nodes = [];
    if (text) {
      for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
        const p = lexical.$createParagraphNode();
        if (line) p.append(lexical.$createTextNode(line));
        nodes.push(p);
      }
    }
    for (const file of files) {
      nodes.push($createImageNode(addImageUpload(instance, file)));
    }
    const nextParagraph = lexical.$createParagraphNode();
    nodes.push(nextParagraph);
    const selection = lexical.$getSelection();
    const rangeIsAttached = lexical.$isRangeSelection(selection) &&
      lexical.$getNodeByKey(selection.anchor.key) &&
      lexical.$getNodeByKey(selection.focus.key);
    if (rangeIsAttached) selection.insertNodes(nodes);
    else lexical.$getRoot().append(...nodes);
    nextParagraph.select();
  });
  setTimeout(() => processImageUploads(instance), 0);
}

async function processImageUploads(instance) {
  if (instance.imageUploadActive || editors.get(instance.handle) !== instance) {
    return;
  }
  const ids = new Set();
  instance.editor.getEditorState().read(() =>
    visitImageNodes(lexical.$getRoot(), (node) => ids.add(node.__assetKey))
  );
  for (const [id, job] of instance.imageUploads) {
    job.present = ids.has(id);
    if (
      job.status === "done" && job.retryAt != null && Date.now() >= job.retryAt
    ) {
      job.status = "failed";
      job.error =
        "This image upload has expired. Retry to keep it in your comment.";
    }
  }
  // Undo/redo may restore a pre-upload placeholder. Keep its completed upload.
  let needsRestore = false;
  instance.editor.getEditorState().read(() =>
    visitImageNodes(lexical.$getRoot(), (node) => {
      const result = instance.imageUploads.get(node.__assetKey)?.result;
      if (result && node.__src !== result.src) needsRestore = true;
    })
  );
  if (needsRestore) {
    instance.editor.update(() =>
      visitImageNodes(lexical.$getRoot(), (node) => {
        const result = instance.imageUploads.get(node.__assetKey)?.result;
        if (!result || node.__src === result.src) return;
        const writable = node.getWritable();
        writable.__src = result.src;
        writable.__blobHash = result.blobHash;
        writable.__contentType = result.contentType;
      }), { tag: lexical.HISTORY_MERGE_TAG });
  }
  const job = Array.from(instance.imageUploads.values()).find((job) =>
    job.present && job.status === "queued"
  );
  notifyImageUploads(instance);
  if (!job) return;
  instance.imageUploadActive = job.id;
  job.status = "uploading";
  job.uploadStartedAt = Date.now();
  try {
    if (!job.file) {
      if (!/^(https?:|data:image\/|\/)/i.test(job.source)) {
        throw new Error(
          "This image isn't available from the clipboard. Attach the image file instead.",
        );
      }
      if (/^data:image\//i.test(job.source)) {
        const comma = job.source.indexOf(",");
        const header = job.source.slice(5, comma);
        const encoded = job.source.slice(comma + 1);
        if (encoded.length > commentImageLimit * 1.4) {
          throw new Error("Images must be 10 MB or smaller.");
        }
        const decoded = /;base64$/i.test(header)
          ? atob(encoded)
          : decodeURIComponent(encoded);
        const bytes = Uint8Array.from(
          decoded,
          (character) => character.charCodeAt(0),
        );
        job.file = new File([bytes], job.name, { type: header.split(";")[0] });
      } else {
        const url = new URL(job.source, location.href);
        if (url.origin !== location.origin) {
          throw new Error(
            "This image isn't available from the clipboard. Attach the image file instead.",
          );
        }
        const response = await fetch(url, {
          signal: instance.imageUploadAbort.signal,
        });
        if (!response.ok) {
          throw new Error(
            "This image couldn't be copied. Attach the image file instead.",
          );
        }
        if (
          Number(response.headers.get("Content-Length")) > commentImageLimit
        ) throw new Error("Images must be 10 MB or smaller.");
        const blob = await response.blob();
        job.file = new File([blob], job.name, { type: blob.type });
      }
    }
    if (job.file.size > commentImageLimit) {
      throw new Error("Images must be 10 MB or smaller.");
    }
    if (!/^image\/(png|jpeg|gif|webp)$/.test(job.file.type)) {
      throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
    }
    if (
      editors.get(instance.handle) !== instance ||
      !instance.imageUploads.has(job.id)
    ) return;
    const input = document.getElementById(instance.externalImageInputId);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("The image upload control is unavailable.");
    }
    const transfer = new DataTransfer();
    transfer.items.add(job.file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (error) {
    finishImageUpload(instance, {
      id: job.id,
      error: error.message || "Image upload failed. Please retry.",
    });
  }
}

function finishImageUpload(instance, result) {
  const job = instance.imageUploads.get(result.id);
  if (!job) return;
  if (result.error) {
    job.status = "failed";
    job.error = result.error;
  } else {
    job.status = "done";
    job.result = result;
    // Keep the File while this editor is open so an expired draft can retry,
    // even after cleanup has removed the pending row and its blob.
    job.source = null;
    job.retryAt = result.retryAfterMs > 0
      ? job.uploadStartedAt + result.retryAfterMs
      : null;
    clearTimeout(job.retryTimer);
    if (job.retryAt != null) {
      job.retryTimer = setTimeout(
        () => processImageUploads(instance),
        Math.max(0, job.retryAt - Date.now()),
      );
    }
    instance.editor.update(() => {
      visitImageNodes(lexical.$getRoot(), (node) => {
        if (node.__assetKey !== job.id) return;
        const writable = node.getWritable();
        writable.__src = result.src;
        writable.__blobHash = result.blobHash;
        writable.__contentType = result.contentType;
      });
    }, { tag: lexical.HISTORY_MERGE_TAG });
    job.preview = null;
  }
  instance.imageUploadActive = null;
  notifyImageUploads(instance);
  setTimeout(() => processImageUploads(instance), 0);
}

function getPendingImageUpload({ handle }) {
  const instance = editors.get(handle);
  return { id: instance?.imageUploadActive };
}

function insertImageNode(instance, image) {
  ensureImageNodeDefined();
  if (!ImageNode) return false;
  const { editor } = instance;
  const {
    $getRoot,
    $getSelection,
    $isRangeSelection,
    $createParagraphNode,
  } = lexical;

  editor.update(() => {
    const imageNode = $createImageNode({
      src: image.src,
      altText: image.altText,
      width: image.width || 480,
      height: image.height || null,
      align: image.align || "center",
      blobHash: image.blobHash || null,
      assetKey: image.assetKey || null,
      contentType: image.contentType || null,
    });
    const nextParagraph = $createParagraphNode();
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertNodes([imageNode, nextParagraph]);
    } else {
      $getRoot().append(imageNode, nextParagraph);
    }
    nextParagraph.select();
  });
  return true;
}

function transferImageFile(instance, file) {
  const inputId = instance.externalImageInputId;
  if (!inputId) {
    emit("error", {
      handle: instance.handle,
      json: { message: "The image upload control is unavailable." },
    });
    return true;
  }
  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement) || input.type !== "file") {
    emit("error", {
      handle: instance.handle,
      json: { message: "The image upload control is unavailable." },
    });
    return true;
  }
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function chooseImageFile(instance) {
  if (instance.managedImageUploads) {
    instance.imageChooser ??= document.createElement("input");
    const chooser = instance.imageChooser;
    chooser.type = "file";
    chooser.accept = "image/png,image/jpeg,image/gif,image/webp";
    chooser.multiple = true;
    chooser.hidden = true;
    chooser.dataset.lexicalImagePicker = instance.handle;
    if (!chooser.isConnected) document.body.append(chooser);
    chooser.onchange = () => {
      insertImageFiles(instance, Array.from(chooser.files || []));
      chooser.value = "";
    };
    chooser.click();
    return;
  }
  if (instance.externalImageInputId) {
    const input = document.getElementById(instance.externalImageInputId);
    if (input instanceof HTMLInputElement && input.type === "file") {
      input.click();
      return;
    }
  }
  emit("error", {
    handle: instance.handle,
    json: { message: "The image upload control is unavailable." },
  });
}

function handleImagePaste(instance, event) {
  if (!instance.editor.isEditable()) return false;
  if (event.__yolmImageHandled) return true;
  if (!instance.externalImageInputId) return false;
  if (
    instance.managedImageUploads && event.clipboardData?.getData("text/html")
  ) return false;
  const files = Array.from(event.clipboardData?.files || []);
  const imageFile = files.find((file) => file.type?.startsWith("image/")) ||
    Array.from(event.clipboardData?.items || [])
      .find((item) => item.kind === "file" && item.type?.startsWith("image/"))
      ?.getAsFile();
  if (!imageFile) return false;
  event.__yolmImageHandled = true;
  event.preventDefault();
  if (instance.managedImageUploads) {
    insertImageFiles(
      instance,
      files.length
        ? files.filter((file) => file.type.startsWith("image/"))
        : [imageFile],
      event.clipboardData?.getData("text/plain") || "",
    );
  } else transferImageFile(instance, imageFile);
  return true;
}

function registerImagePaste(instance) {
  const onPaste = (event) => {
    if (handleImagePaste(instance, event)) event.stopPropagation();
  };
  instance.container.addEventListener("paste", onPaste, true);
  instance.onImagePaste = onPaste;

  const { COMMAND_PRIORITY_HIGH, PASTE_COMMAND } = lexical;
  if (!PASTE_COMMAND) return;
  return instance.editor.registerCommand(
    PASTE_COMMAND,
    (event) => handleImagePaste(instance, event),
    COMMAND_PRIORITY_HIGH,
  );
}

function registerImageDrop(instance) {
  const onDrop = (event) => {
    if (!instance.editor.isEditable()) return;
    if (!instance.externalImageInputId) return;
    const files = Array.from(event.dataTransfer?.files || []);
    const imageFile = files.find((file) => file.type?.startsWith("image/"));
    if (!imageFile) return;
    event.preventDefault();
    if (instance.managedImageUploads) {
      insertImageFiles(
        instance,
        files.filter((file) => file.type.startsWith("image/")),
      );
    } else transferImageFile(instance, imageFile);
  };
  const onDragOver = (event) => {
    if (!instance.externalImageInputId) return;
    const hasImage = Array.from(event.dataTransfer?.items || []).some((item) =>
      item.kind === "file" && item.type?.startsWith("image/")
    );
    if (!hasImage) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  instance.container.addEventListener("drop", onDrop);
  instance.container.addEventListener("dragover", onDragOver);
  instance.onImageDrop = onDrop;
  instance.onImageDragOver = onDragOver;
}

function registerTrainingWordControls(instance) {
  const commandByLabel = {
    Undo: { command: "undo" },
    Redo: { command: "redo" },
    Bold: { command: "formatBold" },
    Italic: { command: "formatItalic" },
    Underline: { command: "formatUnderline" },
    Strikethrough: { command: "formatStrikethrough" },
    Subscript: { command: "formatSubscript" },
    Superscript: { command: "formatSuperscript" },
    "Align Left": { command: "formatAlignment", alignment: "left" },
    "Align Center": { command: "formatAlignment", alignment: "center" },
    "Align Right": { command: "formatAlignment", alignment: "right" },
    Justify: { command: "formatAlignment", alignment: "justify" },
    "Bulleted List": { command: "formatBulletedList" },
    "Numbered List": { command: "formatNumberedList" },
    Outdent: { command: "outdent" },
    Indent: { command: "indent" },
    "Clear Formatting": { command: "clearFormatting" },
    "Smaller Picture": { command: "resizeSelectedImage", delta: -80 },
    "Larger Picture": { command: "resizeSelectedImage", delta: 80 },
    "Delete Picture": { command: "deleteSelectedImage" },
    "Align Picture Left": { command: "alignSelectedImage", align: "left" },
    "Align Picture Center": { command: "alignSelectedImage", align: "center" },
    "Align Picture Right": { command: "alignSelectedImage", align: "right" },
    Print: { command: "print" },
  };

  const editorRoot = instance.container;
  const shell = editorRoot.closest("[data-training-word-editor]");
  if (!shell) return;

  const onClick = (event) => {
    const button = event.target?.closest?.("[aria-label]");
    if (!button || !shell.contains(button)) return;
    if (button.closest("#training-word-editor-container")) return;
    const label = button.getAttribute("aria-label");
    const command = commandByLabel[label];
    if (!command) return;
    event.preventDefault();
    executeCommand({ handle: instance.handle, ...command });
  };

  const onInput = (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }
    if (!shell.contains(target)) return;
    const commandName = target.dataset.lexicalCommand;
    if (!commandName) return;
    const key = target.dataset.lexicalCommandValueKey || "value";
    executeCommand({
      handle: instance.handle,
      command: commandName,
      [key]: target.value,
    });
  };

  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onInput);
  instance.onTrainingWordControlClick = onClick;
  instance.onTrainingWordControlInput = onInput;
}

function getSelectedImageNode(instance) {
  const key = instance?.selectedImageKey;
  if (!key || !$isImageNode) return null;
  const node = lexical.$getNodeByKey(key);
  return $isImageNode(node) || node instanceof VideoNode ? node : null;
}

// Initialize the Lexical editor
function init(args) {
  const {
    handle,
    containerId = "lexical-editor-container",
    initialContent,
    mentionTrigger,
    mentionTriggers,
    externalImageInputId,
    managedImageUploads = false,
    preserveTextStyles,
    preserveStoredTextStyles = preserveTextStyles ?? true,
    preservePastedTextStyles = preserveTextStyles ?? true,
    constrainTextStyles = false,
    standardFormatting = false,
    allowImages = true,
  } = args;

  console.log("Lexical init called with handle:", handle);

  try {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error("Lexical editor container not found:", containerId);
      emit("error", {
        handle,
        json: { message: "Container not found: " + containerId },
      });
      return false;
    }
    const existingInstance = editors.get(handle);
    if (existingInstance && existingInstance.container === container) {
      return true;
    }

    ensureMentionNodeDefined();
    ensureImageNodeDefined();

    const {
      createEditor,
      $getRoot,
      $createParagraphNode,
    } = lexical;

    // Create the editor config with all necessary nodes
    const config = {
      namespace: "YolmLexicalEditor",
      html: {
        import: {
          "#text": () => ({
            conversion: convertClipboardTextNode,
            priority: 1,
          }),
        },
      },
      theme: {
        paragraph: "lexical-paragraph",
        heading: {
          h1: "lexical-heading-h1",
          h2: "lexical-heading-h2",
          h3: "lexical-heading-h3",
          h4: "lexical-heading-h4",
          h5: "lexical-heading-h5",
          h6: "lexical-heading-h6",
        },
        quote: "lexical-quote",
        list: {
          ol: "lexical-list-ol",
          ul: "lexical-list-ul",
          listitem: "lexical-listitem",
          nested: {
            listitem: "lexical-nested-list-item",
          },
        },
        link: "lexical-link",
        text: {
          bold: "lexical-text-bold editor-bold",
          italic: "lexical-text-italic editor-italic",
          underline: "lexical-text-underline",
          strikethrough: "lexical-text-strikethrough editor-strikethrough",
          subscript: "lexical-text-subscript",
          superscript: "lexical-text-superscript",
        },
        table: "lexical-table",
        tableRow: "lexical-table-row",
        tableCell: "lexical-table-cell",
        tableCellHeader: "lexical-table-cell-header",
        image: "lexical-image",
      },
      nodes: [
        lexicalRichText.HeadingNode,
        lexicalRichText.QuoteNode,
        lexicalList.ListNode,
        lexicalList.ListItemNode,
        lexicalLink.LinkNode,
        lexicalLink.AutoLinkNode,
        VideoNode,
        lexicalTable.TableNode,
        lexicalTable.TableRowNode,
        lexicalTable.TableCellNode,
        ...(ImageNode ? [ImageNode] : []),
        ...(MentionNode ? [MentionNode] : []),
      ],
      onError: (error) => {
        console.error("Lexical error:", error);
        emit("error", { handle, json: { message: error.message } });
      },
    };

    // Create the editor instance
    const editor = createEditor(config);

    // Set the root element
    container.setAttribute("contenteditable", "true");
    container.classList.add("lexical-editor");
    editor.setRootElement(container);

    // Register rich text plugin
    if (lexicalRichText?.registerRichText) {
      lexicalRichText.registerRichText(editor);
    }

    // Create and register history
    let historyState = null;
    if (
      lexicalHistory?.registerHistory && lexicalHistory?.createEmptyHistoryState
    ) {
      historyState = lexicalHistory.createEmptyHistoryState();
      lexicalHistory.registerHistory(editor, historyState, 1000);
    }

    // Register list plugin - this registers the list commands
    if (lexicalList?.registerList) {
      lexicalList.registerList(editor);
    }

    if (lexicalTable?.registerTable) {
      lexicalTable.registerTable(editor);
    }

    // Register TabIndent - handle Tab key for indentation
    registerTabIndent(editor);

    // Initialize with empty paragraph or initial content
    editor.update(() => {
      const root = $getRoot();
      if (root.getChildrenSize() === 0) {
        const paragraph = $createParagraphNode();
        root.append(paragraph);
      }
    });

    // If initial content provided as JSON, restore it
    if (initialContent && typeof initialContent === "object") {
      const editorState = editor.parseEditorState(
        !preserveStoredTextStyles
          ? stripSerializedTextStyles(initialContent)
          : constrainTextStyles
          ? constrainSerializedDocumentTextStyles(initialContent)
          : initialContent,
      );
      editor.setEditorState(editorState);
    }

    // Mentions are opt-in per editor instance: only when the caller passed
    // `mentionTrigger` do we wire up trigger detection, key-swallow
    // handlers, and click delegation. Editors without mentions configured
    // pay zero runtime cost beyond the MentionNode class being registered
    // (so existing mention nodes in saved content still render).
    const configuredMentionTriggers = Array.isArray(mentionTriggers)
      ? mentionTriggers.filter((trigger) =>
        typeof trigger === "string" && trigger.length > 0
      )
      : typeof mentionTrigger === "string" && mentionTrigger.length > 0
      ? [mentionTrigger]
      : [];
    const mentionsEnabled = configuredMentionTriggers.length > 0;

    const instance = {
      managedImageUploads,
      imageUploads: new Map(),
      imageUploadAbort: new AbortController(),
      editor,
      container,
      historyState,
      handle,
      canUndo: false,
      canRedo: false,
      selectedImageKey: null,
      externalImageInputId,
      mention: mentionsEnabled
        ? {
          enabled: true,
          active: false,
          triggers: configuredMentionTriggers,
          activeTrigger: configuredMentionTriggers[0],
          query: "",
          triggerNodeKey: null,
          triggerOffset: 0,
          queryEndOffset: 0,
        }
        : { enabled: false },
    };
    editors.set(handle, instance);
    if (constrainTextStyles && container.parentElement) {
      const surface = container.parentElement;
      const fitDocument = () => {
        if (!surface || !container.offsetWidth) return;
        container.style.zoom = String(
          Math.min(1, surface.clientWidth / container.offsetWidth),
        );
      };
      instance.documentResizeObserver = new ResizeObserver(fitDocument);
      instance.documentResizeObserver.observe(surface);
      fitDocument();
    }
    if (managedImageUploads) {
      instance.onImageUploadResume = () => processImageUploads(instance);
      globalThis.addEventListener("focus", instance.onImageUploadResume);
      document.addEventListener(
        "visibilitychange",
        instance.onImageUploadResume,
      );
    }
    const queuedCommands = pendingCommands.get(handle);
    if (queuedCommands) {
      pendingCommands.delete(handle);
      setTimeout(() => {
        for (const queuedCommand of queuedCommands) {
          executeCommand(queuedCommand);
        }
      }, 0);
    }

    if (MentionNode && mentionsEnabled) {
      registerMentionPlugin(instance);
    }
    registerImageInteraction(instance);
    registerHtmlPaste(instance, preservePastedTextStyles);
    if (standardFormatting) {
      editor.registerNodeTransform(lexical.TextNode, (node) => {
        if (node.getStyle()) node.setStyle("");
      });
      editor.registerNodeTransform(lexical.ParagraphNode, (node) => {
        if (node.getTextStyle()) node.setTextStyle("");
      });
      if (lexicalTable?.TableCellNode) {
        editor.registerNodeTransform(lexicalTable.TableCellNode, (node) => {
          if (node.getBackgroundColor()) node.setBackgroundColor(null);
        });
      }
    }
    if (allowImages) {
      registerImagePaste(instance);
      registerImageDrop(instance);
    }
    registerTrainingWordControls(instance);
    editor.registerCommand(lexical.PASTE_COMMAND, (event) => {
      if (event.clipboardData?.getData("text/html")) return false;
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text || !/^(https?:\/\/|mailto:)[^\s]+$/i.test(text)) return false;
      const selection = lexical.$getSelection();
      if (!lexical.$isRangeSelection(selection)) return false;
      event.preventDefault();
      const link = lexicalLink.$createLinkNode(text);
      link.append(lexical.$createTextNode(text));
      selection.insertNodes([link]);
      return true;
    }, lexical.COMMAND_PRIORITY_LOW);

    // Register undo/redo state listeners
    const { CAN_UNDO_COMMAND, CAN_REDO_COMMAND, COMMAND_PRIORITY_LOW } =
      lexical;
    if (CAN_UNDO_COMMAND) {
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          instance.canUndo = payload;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      );
    }
    if (CAN_REDO_COMMAND) {
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          instance.canRedo = payload;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      );
    }

    // Add selection change listener to emit state updates
    editor.registerUpdateListener(({ editorState, tags }) => {
      emit("stateChanged", { handle, json: getEditorState(instance) });

      if (instance.managedImageUploads) {
        setTimeout(() => processImageUploads(instance), 0);
      }
      // Also emit content changed
      editorState.read(() => {
        const root = $getRoot();
        const textContent = root.getTextContent();
        const serializedState = editorState.toJSON();
        const imageBlobHashes = collectImageBlobHashes(serializedState);
        emit("contentChanged", {
          handle,
          json: {
            content: textContent,
            editorState: serializedState,
            imageBlobHashes,
            word_count: textContent.trim()
              ? textContent.trim().split(/\s+/).length
              : 0,
            char_count: textContent.length,
          },
        });
      });

      // Evaluate the @-mention trigger against the current caret position.
      evaluateMentionTrigger(instance);
    });

    console.log("Lexical editor initialized with handle:", handle);
    return true;
  } catch (error) {
    console.error("Failed to initialize Lexical editor:", error);
    emit("error", { handle, json: { message: error.message } });
    return false;
  }
}

// Execute editor commands
function executeCommand(args) {
  const { handle, command, ...params } = args;
  const instance = editors.get(handle);
  if (!instance) {
    if (handle) {
      const queuedCommands = pendingCommands.get(handle) || [];
      queuedCommands.push(args);
      pendingCommands.set(handle, queuedCommands);
      console.warn("Editor not ready; queued command for handle:", handle);
      return true;
    }
    console.warn("Editor not found for handle:", handle);
    return false;
  }

  const { editor } = instance;
  if (command === "setReadOnly") {
    const readOnly = Boolean(params.readOnly);
    if (readOnly) {
      instance.onImageResizePointerCancel?.();
      setSelectedImage(instance, null);
    }
    editor.setEditable(!readOnly);
    instance.container.contentEditable = String(!readOnly);
    // Inline media has its own DOM controls as well as Lexical commands.
    instance.container.inert = readOnly;
    // Custom toolbar widgets (such as comboboxes) are not native form controls.
    const controls = params.controlsContainerId &&
      document.getElementById(params.controlsContainerId);
    if (controls) controls.inert = readOnly;
    return true;
  }
  if (!editor.isEditable()) return false;
  const {
    FORMAT_TEXT_COMMAND,
    FORMAT_ELEMENT_COMMAND,
    UNDO_COMMAND,
    REDO_COMMAND,
    INDENT_CONTENT_COMMAND,
    OUTDENT_CONTENT_COMMAND,
    $getSelection,
    $isRangeSelection,
    $createParagraphNode,
    $isTextNode,
    $getRoot,
  } = lexical;

  console.log("Executing command:", command, params);

  switch (command) {
    case "formatBold":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
      break;

    case "formatItalic":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
      break;

    case "formatStrikethrough":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
      break;

    case "formatUnderline":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
      break;

    case "formatSubscript":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "subscript");
      break;

    case "formatSuperscript":
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "superscript");
      break;

    case "formatAlignment": {
      const { alignment } = params;
      if (instance?.selectedImageKey) {
        return executeCommand({
          handle,
          command: "alignSelectedImage",
          align: alignment === "justify" ? "center" : alignment,
        });
      }
      editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, alignment);
      break;
    }

    case "formatFontSize": {
      const { size } = params;
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$patchStyleText(selection, {
            "font-size": /\D/.test(size) ? size : `${size}px`,
          });
        }
      });
      break;
    }

    case "formatFontColor": {
      const { color } = params;
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$patchStyleText(selection, { color });
        }
      });
      break;
    }

    case "formatBackgroundColor": {
      const { color } = params;
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$patchStyleText(selection, {
            "background-color": color,
          });
        }
      });
      break;
    }

    case "formatFontFamily": {
      const { family } = params;
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$patchStyleText(selection, {
            "font-family": family,
          });
        }
      });
      break;
    }

    case "clearFormatting":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const anchor = selection.anchor;
          const focus = selection.focus;
          const nodes = selection.getNodes();

          if (anchor.key === focus.key && anchor.offset === focus.offset) {
            return;
          }

          nodes.forEach((node, idx) => {
            if ($isTextNode(node)) {
              let textNode = node;
              if (idx === 0 && anchor.offset !== 0) {
                textNode = textNode.splitText(anchor.offset)[1] || textNode;
              }
              if (idx === nodes.length - 1) {
                textNode = textNode.splitText(focus.offset)[0] || textNode;
              }

              if (textNode.__style !== "") {
                textNode.setStyle("");
              }
              if (textNode.__format !== 0) {
                textNode.setFormat(0);
              }
            } else if (
              lexicalRichText.$isHeadingNode?.(node) ||
              lexicalRichText.$isQuoteNode?.(node)
            ) {
              node.replace($createParagraphNode(), true);
            }
          });
        }
      });
      break;

    case "undo":
      editor.dispatchCommand(UNDO_COMMAND, undefined);
      break;

    case "redo":
      editor.dispatchCommand(REDO_COMMAND, undefined);
      break;

    case "indent":
      editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
      break;

    case "outdent":
      editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
      break;

    case "formatH1":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createHeadingNode("h1"),
          );
        }
      });
      break;

    case "formatH2":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createHeadingNode("h2"),
          );
        }
      });
      break;

    case "formatH3":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createHeadingNode("h3"),
          );
        }
      });
      break;

    case "formatH4":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createHeadingNode("h4"),
          );
        }
      });
      break;

    case "formatH5":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createHeadingNode("h5"),
          );
        }
      });
      break;

    case "formatH6":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createHeadingNode("h6"),
          );
        }
      });
      break;

    case "formatQuote":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => lexicalRichText.$createQuoteNode(),
          );
        }
      });
      break;

    case "formatBulletedList":
      editor.dispatchCommand(
        lexicalList.INSERT_UNORDERED_LIST_COMMAND,
        undefined,
      );
      break;

    case "formatNumberedList":
      editor.dispatchCommand(
        lexicalList.INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
      break;

    case "formatNormal":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          lexicalSelection.$setBlocksType(
            selection,
            () => $createParagraphNode(),
          );
        }
      });
      break;

    case "prepareLocalImage": {
      const job = instance.imageUploads.get(instance.imageUploadActive);
      const supplied = params.media;
      const id = supplied ? crypto.randomUUID() : job?.id;
      return (async () => {
        try {
          const file = supplied
            ? new File(
              [Uint8Array.from(atob(supplied.content), (c) => c.charCodeAt(0))],
              supplied.name,
              { type: supplied.contentType },
            )
            : job?.file;
          if (
            !file || !file.size || file.size > commentImageLimit ||
            !/^image\/(png|jpeg|gif|webp)$/.test(file.type)
          ) {
            throw new Error("Use a PNG, JPEG, GIF, or WebP image under 10 MB.");
          }
          const signature = Array.from(
            new Uint8Array(await file.slice(0, 12).arrayBuffer()),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          const signatures = {
            "image/png": /^89504e470d0a1a0a/,
            "image/jpeg": /^ffd8ff/,
            "image/gif": /^474946383[79]61/,
            "image/webp": /^52494646........57454250/,
          };
          if (!signatures[file.type].test(signature)) {
            throw new Error("The file is not a supported image.");
          }
          const content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = () =>
              reject(new Error("The image could not be read. Please retry."));
            reader.readAsDataURL(file);
          });
          const src = URL.createObjectURL(file);
          (instance.localMediaUrls ??= new Set()).add(src);
          return { id, src, content, contentType: file.type, name: file.name };
        } catch (error) {
          return {
            id,
            error: error.message ||
              "The image could not be read. Please retry.",
          };
        }
      })();
    }

    case "prepareVideo": {
      instance.videoInsertionSelection = editor.getEditorState().read(() =>
        $getSelection()?.clone()
      );
      const source = videoSource(params.url);
      if (source && !source.iframe) {
        return captureVideoThumbnail(source.url).then((thumbnailData) => ({
          ...source,
          thumbnailData,
        }));
      }
      return source || {};
    }

    case "insertVideo": {
      const source = videoSource(params.url);
      if (!source) {
        emit("error", {
          handle,
          json: {
            message: "Use a YouTube, Vimeo, or HTTPS .mp4/.webm video URL.",
          },
        });
        break;
      }
      editor.focus(() =>
        editor.update(() => {
          const saved = instance.videoInsertionSelection;
          if (
            $isRangeSelection(saved) &&
            lexical.$getNodeByKey(saved.anchor.key) &&
            lexical.$getNodeByKey(saved.focus.key)
          ) {
            lexical.$setSelection(saved.clone());
          }
          instance.videoInsertionSelection = null;
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          selection.insertNodes([
            new VideoNode(source.url, params.thumbnail),
            $createParagraphNode(),
          ]);
        })
      );
      break;
    }

    case "insertLink": {
      const { url, title } = params;
      console.log("Inserting link:", url, title);
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const linkNode = lexicalLink.$createLinkNode(url, { title });
          const textNode = lexical.$createTextNode(title || url);
          linkNode.append(textNode);
          selection.insertNodes([linkNode]);
        }
      });
      break;
    }

    case "removeLink":
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const nodes = selection.getNodes();
          for (const node of nodes) {
            const parent = node.getParent();
            if (lexicalLink.$isLinkNode(parent)) {
              const children = parent.getChildren();
              for (const child of children) {
                parent.insertBefore(child);
              }
              parent.remove();
            }
          }
        }
      });
      break;

    case "insertText":
      {
        const { text } = params;
        editor.focus(() => {
          editor.update(() => {
            let selection = $getSelection();
            if (!$isRangeSelection(selection)) {
              const root = $getRoot();
              root.selectEnd();
              selection = $getSelection();
            }
            if ($isRangeSelection(selection)) {
              selection.insertText(text);
            }
          });
        });
      }
      break;

    case "findText": {
      const text = (params.text || "").toString();
      if (!text) {
        return false;
      }
      editor.focus(() => {
        editor.update(() => {
          const needle = text.toLowerCase();
          const root = $getRoot();
          const textNodes = root.getAllTextNodes?.() ?? [];
          for (const node of textNodes) {
            const haystack = node.getTextContent().toLowerCase();
            const index = haystack.indexOf(needle);
            if (index !== -1) {
              node.select(index, index + text.length);
              return;
            }
          }
        });
      });
      break;
    }

    case "replaceAllText": {
      const find = (params.find || "").toString();
      const replacement = (params.replacement || "").toString();
      if (!find) {
        return false;
      }
      editor.update(() => {
        const pattern = new RegExp(
          find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "gi",
        );
        const root = $getRoot();
        const textNodes = root.getAllTextNodes?.() ?? [];
        for (const node of textNodes) {
          const textContent = node.getTextContent();
          const nextText = textContent.replace(pattern, replacement);
          if (nextText !== textContent) {
            node.setTextContent(nextText);
          }
        }
      });
      break;
    }

    case "print":
      window.print();
      break;

    case "insertTable": {
      const rows = parseInt(params.rows) || 3;
      const cols = parseInt(params.cols) || 3;
      editor.update(() => {
        if (lexicalTable?.$createTableNodeWithDimensions) {
          const tableNode = lexicalTable.$createTableNodeWithDimensions(
            rows,
            cols,
            true,
          );
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertNodes([tableNode]);
          } else {
            $getRoot().append(tableNode);
          }
        }
      });
      break;
    }

    case "completeImageUpload":
      finishImageUpload(instance, params);
      break;
    case "retryImageUploads":
      for (const job of instance.imageUploads.values()) {
        if (job.status === "failed") job.status = "queued";
      }
      notifyImageUploads(instance);
      processImageUploads(instance);
      break;
    case "removeFailedImages":
      {
        const failedKeys = new Set(
          Array.from(instance.imageUploads.values())
            .filter((job) => job.status === "failed")
            .map((job) => job.id),
        );
        if (failedKeys.has(instance.selectedImageKey)) {
          setSelectedImage(instance, null);
        }
        editor.update(() => {
          const root = lexical.$getRoot();
          visitImageNodes(root, (node) => {
            if (
              failedKeys.has(node.__assetKey)
            ) node.remove();
          });
          if (root.getChildrenSize() === 0) {
            root.append(lexical.$createParagraphNode());
          }
          root.selectEnd();
        });
      }
      break;
    case "insertImageFromFile":
      chooseImageFile(instance);
      break;

    case "insertImage": {
      if (!params.src || (!params.blobHash && !params.assetKey)) {
        emit("error", {
          handle: instance.handle,
          json: { message: "Images must be uploaded to blob storage first." },
        });
        return false;
      }
      insertImageNode(instance, {
        src: params.src,
        altText: params.altText || "Image",
        width: parseInt(params.width) || 480,
        height: parseInt(params.height) || null,
        align: params.align || "center",
        blobHash: params.blobHash || null,
        assetKey: params.assetKey || null,
        contentType: params.contentType || null,
      });
      break;
    }

    case "resizeSelectedImage": {
      const delta = parseInt(params.delta) || 0;
      editor.update(() => {
        const node = getSelectedImageNode(instance);
        if (!node) return;
        node.setWidth(node.getWidth() + delta);
      });
      setTimeout(() => updateSelectedImageDom(instance), 0);
      break;
    }

    case "alignSelectedImage": {
      const align = params.align || "center";
      editor.update(() => {
        const node = getSelectedImageNode(instance);
        if (!node) return;
        node.setAlign(align);
      }, { tag: "history-push" });
      setTimeout(() => updateSelectedImageDom(instance), 0);
      break;
    }

    case "deleteSelectedImage":
      editor.update(() => {
        const node = getSelectedImageNode(instance);
        if (!node) return;
        const paragraph = $createParagraphNode();
        node.replace(paragraph);
        paragraph.select();
        instance.selectedImageKey = null;
      });
      emit("stateChanged", { handle, json: getEditorState(instance) });
      break;

    case "insertMention": {
      // Caller passes { id, label, trigger? }. We replace the active
      // "@query" range with a MentionNode and clear trigger state.
      ensureMentionNodeDefined();
      insertMentionAtTrigger(instance, params);
      // Refocus the editor so the user keeps typing after the inserted node.
      try {
        editor.focus();
      } catch (_e) {
        // ignore
      }
      break;
    }

    case "cancelMention":
      if (instance.mention.active) {
        instance.mention.active = false;
        instance.mention.triggerNodeKey = null;
        emit("mention", { handle, json: { action: "closed" } });
      }
      break;

    default:
      console.warn("Unknown command:", command);
      return false;
  }

  return true;
}

function collectImageBlobHashes(serializedState) {
  const imageBlobHashes = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (
      value.type === "image" && typeof value.blobHash === "string" &&
      value.blobHash.length > 0
    ) {
      imageBlobHashes.push(value.blobHash);
    }
    if (Array.isArray(value.children)) {
      for (const child of value.children) visit(child);
    }
  };
  visit(serializedState.root);
  return [...new Set(imageBlobHashes)];
}

// Get the current content as plain text and editor state JSON
function getContent(args) {
  const { handle } = args;
  const instance = editors.get(handle);
  if (!instance) {
    console.warn("Editor not found for handle:", handle);
    return { content: "", editorState: null };
  }

  let content = "";
  const editorState = instance.editor.getEditorState();

  editorState.read(() => {
    const root = lexical.$getRoot();
    content = root.getTextContent();
  });

  // Get the full editor state as JSON
  const editorStateJson = editorState.toJSON();

  return {
    content,
    editorState: editorStateJson,
    imageBlobHashes: collectImageBlobHashes(editorStateJson),
  };
}

// Set content in the editor (plain text)
function setContent(args) {
  const { handle, text } = args;
  const instance = editors.get(handle);
  if (!instance) {
    console.warn("Editor not found for handle:", handle);
    return;
  }

  const { $getRoot, $createParagraphNode, $createTextNode } = lexical;

  instance.editor.update(() => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode(text || ""));
    root.append(paragraph);
  });
}

// Set content from JSON editor state
function setContentFromJson(args) {
  const { handle, editorState } = args;
  const instance = editors.get(handle);
  if (!instance) {
    console.warn("Editor not found for handle:", handle);
    return;
  }

  if (editorState && typeof editorState === "object") {
    const parsedState = instance.editor.parseEditorState(editorState);
    instance.editor.setEditorState(parsedState);
  }
}

// Clean up the editor instance
function cleanup(args) {
  const { handle } = args;

  if (!handle || handle === "") {
    console.log("Skipping cleanup - invalid handle");
    return;
  }

  const instance = editors.get(handle);
  if (instance) {
    instance.documentResizeObserver?.disconnect();
    instance.imageUploadAbort?.abort();
    globalThis.removeEventListener("focus", instance.onImageUploadResume);
    document.removeEventListener(
      "visibilitychange",
      instance.onImageUploadResume,
    );
    for (const job of instance.imageUploads?.values() || []) {
      clearTimeout(job.retryTimer);
      if (job.preview?.startsWith("blob:")) URL.revokeObjectURL(job.preview);
    }
    for (const url of instance.localMediaUrls || []) URL.revokeObjectURL(url);
    instance.imageChooser?.remove();
    if (instance.onImageClick && instance.container) {
      instance.container.removeEventListener(
        "click",
        instance.onImageClick,
      );
      instance.onImageClick = null;
    }
    if (instance.onImageKeyDown && instance.container) {
      instance.container.removeEventListener(
        "keydown",
        instance.onImageKeyDown,
      );
      instance.onImageKeyDown = null;
    }
    if (instance.onImageResizePointerDown && instance.container) {
      instance.container.removeEventListener(
        "pointerdown",
        instance.onImageResizePointerDown,
      );
      instance.onImageResizePointerDown = null;
    }
    if (instance.onImageResizeKeyDown && instance.container) {
      instance.container.removeEventListener(
        "keydown",
        instance.onImageResizeKeyDown,
      );
      instance.onImageResizeKeyDown = null;
    }
    if (instance.onImageResizePointerMove) {
      globalThis.document.removeEventListener(
        "pointermove",
        instance.onImageResizePointerMove,
      );
      instance.onImageResizePointerMove = null;
    }
    if (instance.onImageResizePointerUp) {
      globalThis.document.removeEventListener(
        "pointerup",
        instance.onImageResizePointerUp,
      );
      instance.onImageResizePointerUp = null;
    }
    if (instance.onImageResizePointerCancel) {
      globalThis.document.removeEventListener(
        "pointercancel",
        instance.onImageResizePointerCancel,
      );
      instance.onImageResizePointerCancel = null;
    }
    if (instance.onImageDrop && instance.container) {
      instance.container.removeEventListener("drop", instance.onImageDrop);
      instance.onImageDrop = null;
    }
    if (instance.onImagePaste && instance.container) {
      instance.container.removeEventListener(
        "paste",
        instance.onImagePaste,
        true,
      );
      instance.onImagePaste = null;
    }
    if (instance.onImageDragOver && instance.container) {
      instance.container.removeEventListener(
        "dragover",
        instance.onImageDragOver,
      );
      instance.onImageDragOver = null;
    }
    if (instance.onTrainingWordControlClick) {
      document.removeEventListener(
        "click",
        instance.onTrainingWordControlClick,
      );
      instance.onTrainingWordControlClick = null;
    }
    if (instance.onTrainingWordControlInput) {
      document.removeEventListener(
        "input",
        instance.onTrainingWordControlInput,
      );
      document.removeEventListener(
        "change",
        instance.onTrainingWordControlInput,
      );
      instance.onTrainingWordControlInput = null;
    }
    instance.editor.setRootElement(null);
    editors.delete(handle);
    pendingCommands.delete(handle);
    console.log("Lexical editor cleaned up for handle:", handle);
  }
}

// Format selected text (legacy API - use executeCommand instead)
function formatText(args) {
  const { handle, format } = args;
  return executeCommand({
    handle,
    command: "format" + format.charAt(0).toUpperCase() + format.slice(1),
  });
}

// Focus the editor
function focus(args) {
  const { handle } = args;
  const instance = editors.get(handle);
  if (!instance) {
    console.warn("Editor not found for handle:", handle);
    return;
  }
  instance.editor.focus();
}

// Initialize a read-only Lexical editor for display purposes
function initReadOnly(args) {
  const { handle, containerId, initialContent } = args;

  console.log("Lexical initReadOnly called with handle:", handle);

  try {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error("Lexical display container not found:", containerId);
      emit("error", {
        handle,
        json: { message: "Container not found: " + containerId },
      });
      return false;
    }

    ensureMentionNodeDefined();
    ensureImageNodeDefined();

    const { createEditor } = lexical;

    // Create the editor config with all necessary nodes
    const config = {
      namespace: "YolmLexicalDisplay",
      editable: false, // Read-only mode
      theme: {
        paragraph: "lexical-paragraph",
        heading: {
          h1: "lexical-heading-h1",
          h2: "lexical-heading-h2",
          h3: "lexical-heading-h3",
          h4: "lexical-heading-h4",
          h5: "lexical-heading-h5",
          h6: "lexical-heading-h6",
        },
        quote: "lexical-quote",
        list: {
          ol: "lexical-list-ol",
          ul: "lexical-list-ul",
          listitem: "lexical-listitem",
          nested: {
            listitem: "lexical-nested-list-item",
          },
        },
        link: "lexical-link",
        text: {
          bold: "lexical-text-bold",
          italic: "lexical-text-italic",
          underline: "lexical-text-underline",
          strikethrough: "lexical-text-strikethrough",
          subscript: "lexical-text-subscript",
          superscript: "lexical-text-superscript",
        },
        image: "lexical-image",
      },
      nodes: [
        lexicalRichText.HeadingNode,
        lexicalRichText.QuoteNode,
        lexicalList.ListNode,
        lexicalList.ListItemNode,
        lexicalLink.LinkNode,
        lexicalLink.AutoLinkNode,
        VideoNode,
        ...(ImageNode ? [ImageNode] : []),
        ...(MentionNode ? [MentionNode] : []),
      ],
      onError: (error) => {
        console.error("Lexical display error:", error);
        emit("error", { handle, json: { message: error.message } });
      },
    };

    // Create the editor instance
    const editor = createEditor(config);

    // Set the root element
    editor.setRootElement(container);

    // If initial content provided as JSON, restore it
    if (initialContent) {
      const content = typeof initialContent === "string"
        ? JSON.parse(initialContent)
        : initialContent;
      const editorState = editor.parseEditorState(content);
      editor.setEditorState(editorState);
    }

    // Store the editor instance
    const instance = {
      editor,
      container,
      handle,
      readOnly: true,
      mention: { active: false, trigger: defaultMentionTrigger() },
    };
    editors.set(handle, instance);

    // Wire click delegation so mention spans are clickable in read-only.
    const onContainerClick = (event) => {
      let el = event.target;
      while (el && el !== container) {
        if (
          el.getAttribute &&
          el.getAttribute("data-lexical-mention") === "true"
        ) {
          const mentionId = el.getAttribute("data-mention-id");
          emit("mentionClicked", {
            handle,
            json: { mention_id: mentionId },
          });
          return;
        }
        el = el.parentNode;
      }
    };
    container.addEventListener("click", onContainerClick);
    instance.onContainerClick = onContainerClick;

    console.log("Lexical read-only display initialized with handle:", handle);
    return true;
  } catch (error) {
    console.error("Failed to initialize Lexical display:", error);
    emit("error", { handle, json: { message: error.message } });
    return false;
  }
}

// Generate HTML from Lexical JSON state (for server-side rendering)
function generateHtml(args) {
  const { editorState } = args;

  try {
    ensureMentionNodeDefined();
    const { createEditor } = lexical;

    // Create a temporary editor to generate HTML
    const config = {
      namespace: "YolmLexicalHtmlGenerator",
      editable: false,
      nodes: [
        lexicalRichText.HeadingNode,
        lexicalRichText.QuoteNode,
        lexicalList.ListNode,
        lexicalList.ListItemNode,
        lexicalLink.LinkNode,
        lexicalLink.AutoLinkNode,
        VideoNode,
        ...(MentionNode ? [MentionNode] : []),
      ],
      onError: (error) => {
        console.error("Lexical HTML generator error:", error);
      },
    };

    const editor = createEditor(config);

    // Parse and set the editor state
    const content = typeof editorState === "string"
      ? JSON.parse(editorState)
      : editorState;
    const parsedState = editor.parseEditorState(content);
    editor.setEditorState(parsedState);

    // Generate HTML
    let html = "";
    editor.getEditorState().read(() => {
      html = lexicalHtml.$generateHtmlFromNodes(editor, null);
    });

    return { html };
  } catch (error) {
    console.error("Failed to generate HTML:", error);
    return { html: "" };
  }
}

registerModule({
  getPendingImageUpload,
  init,
  initReadOnly,
  executeCommand,
  enableReadOnlyImageExpansion,
  cleanupReadOnlyImageExpansion,
  getContent,
  setContent,
  setContentFromJson,
  cleanup,
  formatText,
  focus,
  getEventData,
  generateHtml,
});
