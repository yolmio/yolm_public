// Hardware barcode scanner support (Zebra, Honeywell, etc.)
//
// Detects rapid keystroke sequences (characteristic of hardware scanners)
// and emits scanDetected events. Configurable pattern matching per-system.

const instances = new Map();

function initialize(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts.handle || "hw-scanner";
  const pattern = opts.pattern ? new RegExp(opts.pattern) : null;
  const minLength = opts.minLength || 3;
  const maxTimeBetweenChars = opts.maxTimeBetweenChars || 30;

  // Clean up previous instance if any
  const prev = instances.get(handle);
  if (prev) {
    document.removeEventListener("keydown", prev.handler, true);
    instances.delete(handle);
  }

  let buffer = "";
  let lastKeyTime = 0;

  const handler = (e) => {
    const now = Date.now();

    // Reset buffer if too much time has passed since last keystroke
    if (buffer.length > 0 && now - lastKeyTime > maxTimeBetweenChars) {
      buffer = "";
    }

    if (e.key === "Enter") {
      if (buffer.length >= minLength && (!pattern || pattern.test(buffer))) {
        e.preventDefault();
        e.stopPropagation();
        emit("scanDetected", {
          handle,
          json: { data: buffer },
        });
      }
      buffer = "";
      lastKeyTime = 0;
      return;
    }

    // Only buffer printable single characters
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Don't intercept when a text input is focused
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        buffer = "";
        return;
      }

      if (buffer.length === 0) {
        lastKeyTime = now;
      }

      buffer += e.key;
      lastKeyTime = now;
      e.preventDefault();
    }
  };

  document.addEventListener("keydown", handler, true);
  instances.set(handle, { handler });
}

function cleanup(argJson) {
  const opts = typeof argJson === "string" ? JSON.parse(argJson) : argJson;
  const handle = opts?.handle || "hw-scanner";
  const inst = instances.get(handle);
  if (inst) {
    document.removeEventListener("keydown", inst.handler, true);
    instances.delete(handle);
  }
}

registerModule({ initialize, cleanup });
