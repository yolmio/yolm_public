// Listbox keyboard navigation module
//
// Manages keyboard navigation for any list of items (select dropdowns, menus, tabs).
// Reads the actual DOM via querySelectorAll so it naturally works with dynamic items
// (Each, Show, etc.).

const instances = new Map();

function initialize(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts.handle || "listbox";
  const rootId = opts.rootId;
  const itemSelector = opts.itemSelector || ".listbox-item";
  const horizontal = opts.horizontal || false;
  const letterSearch = opts.letterSearch !== false;
  const activateOnFocus = opts.activateOnFocus || false;
  const loop = opts.loop !== false;

  cleanup({ handle });

  let focusedIndex = -1;

  function getItems() {
    const root = document.getElementById(rootId);
    if (!root) return [];
    const all = root.querySelectorAll(itemSelector);
    return Array.from(all).filter(
      (el) => el.getAttribute("aria-disabled") !== "true",
    );
  }

  function focusItem(items, index) {
    if (index < 0 || index >= items.length) return;
    focusedIndex = index;
    const el = items[index];
    el.focus();
    if (activateOnFocus) {
      el.click();
    }
    const value = el.getAttribute("value") || "";
    emit("focus_change", {
      handle,
      json: { index, value },
    });
  }

  function handler(e) {
    const items = getItems();
    if (items.length === 0) return;

    const prevKey = horizontal ? "ArrowLeft" : "ArrowUp";
    const nextKey = horizontal ? "ArrowRight" : "ArrowDown";

    if (e.key === nextKey) {
      e.preventDefault();
      let next = focusedIndex + 1;
      if (next >= items.length) {
        next = loop ? 0 : items.length - 1;
      }
      focusItem(items, next);
      return;
    }

    if (e.key === prevKey) {
      e.preventDefault();
      let prev = focusedIndex - 1;
      if (prev < 0) {
        prev = loop ? items.length - 1 : 0;
      }
      focusItem(items, prev);
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      focusItem(items, 0);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      focusItem(items, items.length - 1);
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      if (
        !activateOnFocus && focusedIndex >= 0 && focusedIndex < items.length
      ) {
        e.preventDefault();
        items[focusedIndex].click();
      }
      return;
    }

    // Letter search
    if (
      letterSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey &&
      !e.altKey
    ) {
      const char = e.key.toLowerCase();
      const startIdx = focusedIndex + 1;

      // Search from current position to end
      for (let i = startIdx; i < items.length; i++) {
        const text = (
          items[i].getAttribute("aria-label") ||
          items[i].textContent ||
          ""
        ).toLowerCase();
        if (text.charAt(0) === char) {
          focusItem(items, i);
          return;
        }
      }
      // Wrap around from beginning
      for (let i = 0; i < startIdx; i++) {
        const text = (
          items[i].getAttribute("aria-label") ||
          items[i].textContent ||
          ""
        ).toLowerCase();
        if (text.charAt(0) === char) {
          focusItem(items, i);
          return;
        }
      }
    }
  }

  instances.set(handle, { handler, rootId, getItems, focusItem, get focusedIndex() { return focusedIndex; }, set focusedIndex(v) { focusedIndex = v; }, loop });
}

function focusNext(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const inst = instances.get(handle);
  if (!inst) return;
  const items = inst.getItems();
  if (items.length === 0) return;
  let next = inst.focusedIndex + 1;
  if (next >= items.length) {
    next = inst.loop ? 0 : items.length - 1;
  }
  inst.focusItem(items, next);
}

function focusPrev(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const inst = instances.get(handle);
  if (!inst) return;
  const items = inst.getItems();
  if (items.length === 0) return;
  let prev = inst.focusedIndex - 1;
  if (prev < 0) {
    prev = inst.loop ? items.length - 1 : 0;
  }
  inst.focusItem(items, prev);
}

function clickFocused(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const inst = instances.get(handle);
  if (!inst) return;
  const items = inst.getItems();
  if (inst.focusedIndex >= 0 && inst.focusedIndex < items.length) {
    items[inst.focusedIndex].click();
  }
}

function cleanup(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const inst = instances.get(handle);
  if (inst) {
    instances.delete(handle);
  }
}

function focusFirst(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const inst = instances.get(handle);
  if (!inst) return;
  const root = document.getElementById(inst.rootId);
  if (!root) return;
  const items = Array.from(
    root.querySelectorAll(opts?.itemSelector || ".listbox-item"),
  ).filter((el) => el.getAttribute("aria-disabled") !== "true");
  if (items.length > 0) {
    inst.focusedIndex = 0;
    items[0].focus();
  }
}

function focusByValue(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const value = opts?.value;
  const inst = instances.get(handle);
  if (!inst || value == null) return;
  const root = document.getElementById(inst.rootId);
  if (!root) return;
  const items = Array.from(
    root.querySelectorAll(opts?.itemSelector || ".listbox-item"),
  ).filter((el) => el.getAttribute("aria-disabled") !== "true");
  for (let i = 0; i < items.length; i++) {
    if (items[i].getAttribute("value") === String(value)) {
      inst.focusedIndex = i;
      items[i].focus();
      return;
    }
  }
}

function searchByLetter(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const char = (opts?.char || "").toLowerCase();
  if (!char) return;
  const inst = instances.get(handle);
  if (!inst) return;
  const items = inst.getItems();
  if (items.length === 0) return;

  const startIdx = inst.focusedIndex + 1;
  // Search from current position to end
  for (let i = startIdx; i < items.length; i++) {
    const text = (
      items[i].getAttribute("aria-label") ||
      items[i].textContent ||
      ""
    ).toLowerCase();
    if (text.charAt(0) === char) {
      inst.focusItem(items, i);
      return;
    }
  }
  // Wrap around from beginning
  for (let i = 0; i < startIdx; i++) {
    const text = (
      items[i].getAttribute("aria-label") ||
      items[i].textContent ||
      ""
    ).toLowerCase();
    if (text.charAt(0) === char) {
      inst.focusItem(items, i);
      return;
    }
  }
}

function getHandler(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "listbox";
  const inst = instances.get(handle);
  return inst ? inst.handler : null;
}

registerModule({ initialize, cleanup, focusFirst, focusNext, focusPrev, clickFocused, focusByValue, searchByLetter, getHandler });
