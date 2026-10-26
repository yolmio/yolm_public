// deno-lint-ignore-file no-undef
// Structured comparison engine for Lexical JSON business documents.

const MAX_ALIGNMENT_CELLS = 500_000;
const MAX_INLINE_CELLS = 500_000;
const ALIGNMENT_LOOKAHEAD = 24;
const INLINE_CONTEXT = 160;
const MAX_INLINE_TEXT = 800;
const INLINE_DIFF_TAGS = new Set([
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
]);

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

function normalizeText(text) {
  return String(text || "")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDocument(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !parsed || typeof parsed !== "object" ||
    !Array.isArray(parsed.root?.children)
  ) {
    throw new Error("The document comparison received invalid Lexical JSON.");
  }
  return parsed;
}

function nodeText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  if (node.type === "linebreak") return "\n";
  if (node.type === "image") {
    return `${node.altText || "Image"} ${node.src || ""}`;
  }
  if (node.type === "video") return String(node.url || "Video");
  return Array.isArray(node.children)
    ? node.children.map(nodeText).join("")
    : "";
}

function nodeTag(node) {
  if (node.type === "image" || node.type === "video") return "figure";
  if (node.type === "heading") return String(node.tag || "h2");
  if (node.type === "quote") return "blockquote";
  if (node.type === "list") return node.listType === "number" ? "ol" : "ul";
  if (node.type === "table") return "table";
  return "p";
}

function createBlock(node, section) {
  const rawText = nodeText(node);
  const text = normalizeText(rawText);
  return {
    node,
    signature: JSON.stringify(node),
    formattingSignature: JSON.stringify(
      node,
      (key, value) => key === "text" ? "" : value,
    ),
    section,
    tag: nodeTag(node),
    text,
    rawText,
    wordProfile: wordProfile(text),
  };
}

function blockElements(documentValue) {
  const document = parseDocument(documentValue);
  const blocks = [];
  let section = "Document beginning";
  for (const child of document.root.children) {
    const text = normalizeText(nodeText(child));
    if (child.type === "heading" && text) section = text;
    blocks.push(createBlock(child, section));
  }
  return blocks;
}

function words(text) {
  return normalizeText(text).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function wordProfile(text) {
  const values = words(text);
  const counts = new Map();
  for (const word of values) counts.set(word, (counts.get(word) || 0) + 1);
  return { counts, length: values.length };
}

function profileSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const counts = new Map(left.counts);
  let overlap = 0;
  for (const [word, rightCount] of right.counts) {
    overlap += Math.min(counts.get(word) || 0, rightCount);
  }
  return (2 * overlap) / (left.length + right.length);
}

function textSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const left = wordProfile(a);
  const right = wordProfile(b);
  if (!left.length || !right.length) {
    return a.toLocaleLowerCase() === b.toLocaleLowerCase() ? 1 : 0;
  }
  return profileSimilarity(left, right);
}

function pairedChange(before, after) {
  const formattingChanged =
    before.formattingSignature !== after.formattingSignature;
  return {
    before,
    after,
    formattingChanged,
    kind: before.text === after.text
      ? (before.signature === after.signature ? "unchanged" : "formatting")
      : "modified",
  };
}

function blockAnchor(block) {
  return block.text ? `${block.tag}\u0000${block.text}` : block.signature;
}

function findMatchingBlock(blocks, start, target) {
  const anchor = blockAnchor(target);
  const end = Math.min(blocks.length, start + ALIGNMENT_LOOKAHEAD);
  for (let index = start; index < end; index += 1) {
    if (blockAnchor(blocks[index]) === anchor) return index;
  }
  return -1;
}

function alignBlocksLinear(before, after) {
  const aligned = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (blockAnchor(before[i]) === blockAnchor(after[j])) {
      aligned.push(pairedChange(before[i++], after[j++]));
      continue;
    }
    const matchingAfter = findMatchingBlock(after, j + 1, before[i]);
    const matchingBefore = findMatchingBlock(before, i + 1, after[j]);
    const addDistance = matchingAfter < 0 ? Infinity : matchingAfter - j;
    const removeDistance = matchingBefore < 0 ? Infinity : matchingBefore - i;
    if (addDistance < removeDistance) {
      aligned.push({ before: null, after: after[j++], kind: "added" });
    } else if (removeDistance < Infinity) {
      aligned.push({ before: before[i++], after: null, kind: "removed" });
    } else {
      aligned.push(pairedChange(before[i++], after[j++]));
    }
  }
  while (i < before.length) {
    aligned.push({ before: before[i++], after: null, kind: "removed" });
  }
  while (j < after.length) {
    aligned.push({ before: null, after: after[j++], kind: "added" });
  }
  return aligned;
}

function substitutionCost(before, after) {
  if (before.text === after.text) return 0;
  const similarity = profileSimilarity(before.wordProfile, after.wordProfile);
  return similarity >= 0.18 ? 0.72 + (1 - similarity) * 0.72 : 2.05;
}

function alignBlocks(before, after) {
  const rows = before.length + 1;
  const cols = after.length + 1;
  if (rows * cols > MAX_ALIGNMENT_CELLS) {
    return { items: alignBlocksLinear(before, after), usedFallback: true };
  }
  const cost = Array.from({ length: rows }, () => Array(cols).fill(0));
  const move = Array.from({ length: rows }, () => Array(cols).fill(""));
  for (let i = 1; i < rows; i += 1) {
    cost[i][0] = i;
    move[i][0] = "remove";
  }
  for (let j = 1; j < cols; j += 1) {
    cost[0][j] = j;
    move[0][j] = "add";
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const replace = cost[i - 1][j - 1] + substitutionCost(
        before[i - 1],
        after[j - 1],
      );
      const remove = cost[i - 1][j] + 1;
      const add = cost[i][j - 1] + 1;
      if (replace <= remove && replace <= add) {
        cost[i][j] = replace;
        move[i][j] = "pair";
      } else if (remove <= add) {
        cost[i][j] = remove;
        move[i][j] = "remove";
      } else {
        cost[i][j] = add;
        move[i][j] = "add";
      }
    }
  }
  const aligned = [];
  let i = before.length;
  let j = after.length;
  while (i > 0 || j > 0) {
    if (move[i][j] === "pair") {
      aligned.push(pairedChange(before[--i], after[--j]));
    } else if (move[i][j] === "remove") {
      aligned.push({ before: before[--i], after: null, kind: "removed" });
    } else {
      aligned.push({ before: null, after: after[--j], kind: "added" });
    }
  }
  return { items: aligned.reverse(), usedFallback: false };
}

function textTokens(text, format = 0, style = "") {
  const source = String(text || "");
  const pattern =
    /\s+|\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}|\p{Sc}\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%|[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*|[^\s]/gu;
  const tokens = [];
  for (const match of source.matchAll(pattern)) {
    tokens.push({
      format,
      key: match[0],
      style,
      text: match[0],
    });
  }
  return tokens;
}

function semanticTokens(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "text") {
    return textTokens(
      node.text,
      Number.isFinite(Number(node.format)) ? Number(node.format) : 0,
      typeof node.style === "string" ? node.style : "",
    );
  }
  if (node.type === "linebreak") return textTokens("\n");
  return Array.isArray(node.children)
    ? node.children.flatMap(semanticTokens)
    : [];
}

function pushOperation(operations, kind, token) {
  const text = typeof token === "string" ? token : token?.text;
  if (!text) return;
  const format = typeof token === "string" ? 0 : token.format || 0;
  const style = typeof token === "string" ? "" : token.style || "";
  const last = operations[operations.length - 1];
  if (
    last?.kind === kind && last.format === format && last.style === style
  ) last.text += text;
  else operations.push({ kind, text, format, style });
}

function operationWithText(operation, text) {
  return { ...operation, text };
}

function normalizeReplacementSpacing(operations) {
  const result = [];
  for (let index = 0; index < operations.length; index += 1) {
    const current = operations[index];
    const next = operations[index + 1];
    if (current.kind === "removed" && next?.kind === "added") {
      const oldSpace = current.text.match(/^\s+/)?.[0] || "";
      const newSpace = next.text.match(/^\s+/)?.[0] || "";
      if (oldSpace && oldSpace === newSpace) {
        pushOperation(result, "unchanged", oldSpace);
        pushOperation(
          result,
          "removed",
          operationWithText(current, current.text.slice(oldSpace.length)),
        );
        pushOperation(
          result,
          "added",
          operationWithText(next, next.text.slice(newSpace.length)),
        );
        index += 1;
        continue;
      }
    }
    pushOperation(result, current.kind, current);
  }
  return result;
}

function inlineOperations(beforeNode, afterNode) {
  const before = semanticTokens(beforeNode);
  const after = semanticTokens(afterNode);
  let prefix = 0;
  while (
    prefix < before.length && prefix < after.length &&
    before[prefix].key === after[prefix].key
  ) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1].key ===
      after[after.length - suffix - 1].key
  ) suffix += 1;
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);
  const operations = [];
  for (const token of after.slice(0, prefix)) {
    pushOperation(operations, "unchanged", token);
  }
  if (!oldMiddle.length || !newMiddle.length) {
    for (const token of oldMiddle) {
      pushOperation(operations, "removed", token);
    }
    for (const token of newMiddle) {
      pushOperation(operations, "added", token);
    }
  } else {
    if (oldMiddle.length * newMiddle.length > MAX_INLINE_CELLS) return null;
    const rows = oldMiddle.length + 1;
    const cols = newMiddle.length + 1;
    const lcs = Array.from({ length: rows }, () => new Uint16Array(cols));
    for (let i = oldMiddle.length - 1; i >= 0; i -= 1) {
      for (let j = newMiddle.length - 1; j >= 0; j -= 1) {
        lcs[i][j] = oldMiddle[i].key === newMiddle[j].key
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < oldMiddle.length || j < newMiddle.length) {
      if (
        i < oldMiddle.length && j < newMiddle.length &&
        oldMiddle[i].key === newMiddle[j].key
      ) {
        pushOperation(operations, "unchanged", newMiddle[j++]);
        i += 1;
      } else if (
        j < newMiddle.length &&
        (i >= oldMiddle.length || lcs[i][j + 1] > lcs[i + 1][j])
      ) {
        pushOperation(operations, "added", newMiddle[j++]);
      } else {
        pushOperation(operations, "removed", oldMiddle[i++]);
      }
    }
  }
  for (const token of after.slice(after.length - suffix)) {
    pushOperation(operations, "unchanged", token);
  }
  return normalizeReplacementSpacing(operations);
}

function contextStart(text) {
  if (text.length <= INLINE_CONTEXT) return text;
  const excerpt = text.slice(0, INLINE_CONTEXT);
  const boundary = excerpt.lastIndexOf(" ");
  return boundary > INLINE_CONTEXT / 2 ? excerpt.slice(0, boundary) : excerpt;
}

function contextEnd(text) {
  if (text.length <= INLINE_CONTEXT) return text;
  const excerpt = text.slice(-INLINE_CONTEXT);
  const boundary = excerpt.indexOf(" ");
  return boundary >= 0 && boundary < INLINE_CONTEXT / 2
    ? excerpt.slice(boundary + 1)
    : excerpt;
}

function compactOperations(operations) {
  const length = operations.reduce(
    (sum, operation) => sum + operation.text.length,
    0,
  );
  if (length <= MAX_INLINE_TEXT) return operations;
  const result = [];
  operations.forEach((operation, index) => {
    if (operation.kind !== "unchanged") {
      result.push(operation);
      return;
    }
    const first = index === 0;
    const last = index === operations.length - 1;
    if (first && operation.text.length > INLINE_CONTEXT) {
      result.push({ kind: "omitted", text: "…" });
      result.push(operationWithText(operation, contextEnd(operation.text)));
    } else if (last && operation.text.length > INLINE_CONTEXT) {
      result.push(operationWithText(operation, contextStart(operation.text)));
      result.push({ kind: "omitted", text: "…" });
    } else if (operation.text.length > INLINE_CONTEXT * 2) {
      result.push(operationWithText(operation, contextStart(operation.text)));
      result.push({ kind: "omitted", text: "…" });
      result.push(operationWithText(operation, contextEnd(operation.text)));
    } else result.push(operation);
  });
  return result;
}

function containsMedia(node) {
  return node && (node.type === "image" || node.type === "video" ||
    node.children?.some(containsMedia));
}

function operationsFor(change) {
  if (containsMedia(change.before?.node) || containsMedia(change.after?.node)) {
    return null;
  }
  if (change.kind === "added") {
    const operations = [];
    for (const token of semanticTokens(change.after.node)) {
      pushOperation(operations, "added", token);
    }
    return operations;
  }
  if (change.kind === "removed") {
    const operations = [];
    for (const token of semanticTokens(change.before.node)) {
      pushOperation(operations, "removed", token);
    }
    return operations;
  }
  if (change.kind === "formatting") return null;
  const tag = change.after?.tag || change.before?.tag;
  if (!INLINE_DIFF_TAGS.has(tag)) return null;
  if (textSimilarity(change.before.text, change.after.text) < 0.28) return null;
  return inlineOperations(change.before.node, change.after.node);
}

function changeTitle(change, index) {
  const section = change.after?.section || change.before?.section;
  return section && section !== "Document beginning"
    ? section
    : `Change ${index + 1}`;
}

function kindLabel(change) {
  if (change.kind === "added") return "Added";
  if (change.kind === "removed") return "Removed";
  if (change.kind === "formatting") return "Formatting";
  if (change.formattingChanged) return "Text + formatting";
  return "Changed";
}

function serializeChange(change, index) {
  const operations = operationsFor(change);
  return {
    index,
    kind: change.kind,
    kindLabel: kindLabel(change),
    formattingChanged: change.formattingChanged === true,
    title: changeTitle(change, index),
    tag: change.after?.tag || change.before?.tag || "p",
    operations: operations ? compactOperations(operations) : null,
    beforeNode: change.before?.node || null,
    afterNode: change.after?.node || null,
  };
}

function serializeRedline(item, index, changeIndex) {
  if (item.kind === "unchanged") {
    return {
      index,
      changeIndex: null,
      kind: item.kind,
      layout: "document",
      tag: item.after.tag,
      node: item.after.node,
      operations: null,
      beforeNode: null,
      afterNode: null,
    };
  }
  const operations = operationsFor(item);
  let layout = item.kind;
  if (item.kind === "modified") layout = operations ? "inline" : "replacement";
  if (item.kind === "formatting") layout = "replacement";
  return {
    index,
    changeIndex,
    kind: item.kind,
    layout,
    tag: item.after?.tag || item.before?.tag || "p",
    node: null,
    operations,
    beforeNode: item.before?.node || null,
    afterNode: item.after?.node || null,
  };
}

function compareDocuments(opts) {
  const alignment = alignBlocks(
    blockElements(opts.previousDocument),
    blockElements(opts.currentDocument),
  );
  const changes = alignment.items.filter((item) => item.kind !== "unchanged");
  let changeIndex = 0;
  const redline = alignment.items.map((item, index) => {
    const result = serializeRedline(item, index, changeIndex);
    if (item.kind !== "unchanged") changeIndex += 1;
    return result;
  });
  return {
    changeCount: changes.length,
    formattingCount:
      changes.filter((change) => change.formattingChanged === true).length,
    alignmentFallback: alignment.usedFallback,
    changes: changes.map(serializeChange),
    redline,
  };
}

function initialize(args) {
  const opts = parseArgs(args);
  const handle = String(opts.handle || "document-comparison");
  try {
    const result = compareDocuments(opts);
    emit("ready", { handle, json: result });
    return moduleResult(handle, { success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit("error", { handle, json: { message } });
    return moduleResult(handle, { success: false, error: message });
  }
}

function cleanup() {}

registerModule({ initialize, cleanup });
