// Browser-only capture and durable outbox. Business rules live in SQL endpoints.
const sessions = new Map();
const database = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("yolm-maintenance-outbox", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function storage(key, value, remove = false) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "drafts",
        value === undefined && !remove ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("drafts");
      const request = remove
        ? store.delete(key)
        : value === undefined
        ? store.get(key)
        : store.put(value, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function fresh() {
  return {
    client_id: crypto.randomUUID(),
    summary: "",
    condition: "",
    files: [],
    received: null,
  };
}
function notify(s) {
  if (!sessions.has(s.handle)) return;
  emit("changed", {
    handle: s.handle,
    json: {
      summary: s.draft.summary,
      condition: s.draft.condition,
      busy: s.busy,
      ready: true,
      error: s.error || "",
      status: s.status,
      durable: s.durable,
      progress: s.progress || 0,
      files: s.draft.files.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        size: f.blob.size,
        url: s.urls.get(f.id),
        uploaded: !!f.uploaded,
      })),
      received: s.draft.received,
    },
  });
}
async function persist(s) {
  // Serialize saves so an older keystroke cannot replace a newer draft.
  const revision = s.revision = (s.revision || 0) + 1;
  s.durable = false;
  const value = structuredClone(s.draft);
  s.saving = (s.saving || Promise.resolve()).catch(() => {}).then(() =>
    storage(s.key, value)
  );
  try {
    await s.saving;
    if (revision === s.revision) s.durable = true;
  } catch {
    s.durable = false;
    s.error =
      "This browser could not save the draft. Keep this page open until the report is received.";
  }
}
async function initialize(args) {
  const key = `${args.userId}:${args.equipmentId}:${args.issueId ?? ""}:${
    args.workId ?? ""
  }`;
  const s = {
    ...args,
    key,
    draft: fresh(),
    urls: new Map(),
    busy: false,
    durable: false,
    status: "Preparing draft…",
    error: "",
    disposed: false,
  };
  sessions.set(args.handle, s);
  try {
    s.draft = await storage(key) || fresh();
    s.durable = true;
  } catch {
    s.error =
      "Draft storage is unavailable. Keep this page open until the report is received.";
  }
  for (const f of s.draft.files) s.urls.set(f.id, URL.createObjectURL(f.blob));
  s.status = s.draft.received
    ? "Received by maintenance"
    : s.durable
    ? "Draft saved on this phone · not sent"
    : "Draft not saved on this phone";
  s.beforeUnload = (e) => {
    if (s.busy || (!s.durable && (s.draft.summary || s.draft.files.length))) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", s.beforeUnload);
  notify(s);
}
async function update(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy || s.draft.received) return;
  if (typeof args.summary === "string") {
    s.draft.summary = args.summary.slice(0, 4000);
  }
  if (typeof args.condition === "string") s.draft.condition = args.condition;
  await persist(s);
  s.status = s.durable
    ? "Draft saved on this phone · not sent"
    : "Draft not saved on this phone";
  notify(s);
}
function pick(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy || s.draft.received) return;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = !args.capture;
  input.accept = args.accept || "";
  if (args.capture) input.setAttribute("capture", "environment");
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("cancel", () => input.remove(), { once: true });
  input.addEventListener("change", async () => {
    s.error = "";
    for (const file of Array.from(input.files || [])) {
      if (
        s.draft.files.length >= 20 || file.size > 100 * 1024 * 1024 ||
        s.draft.files.reduce((sum, f) => sum + f.blob.size, 0) + file.size >
          300 * 1024 * 1024
      ) {
        s.error =
          `Could not add ${file.name}: maximum 100 MB per file, 20 files and 300 MB per report. Existing files are kept.`;
        continue;
      }
      const f = {
        id: crypto.randomUUID(),
        name: file.name.slice(0, 255),
        type: file.type || "application/octet-stream",
        blob: file,
        uploaded: false,
      };
      s.draft.files.push(f);
      s.urls.set(f.id, URL.createObjectURL(file));
    }
    input.remove();
    await persist(s);
    notify(s);
  }, { once: true });
  input.click();
}
async function remove(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy) return;
  s.draft.files = s.draft.files.filter((f) => f.id !== args.id);
  URL.revokeObjectURL(s.urls.get(args.id));
  s.urls.delete(args.id);
  await persist(s);
  notify(s);
}
async function jsonRequest(path, body, s) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: s.abort.signal,
  });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value) {
    throw Error(
      value?.error ||
        (response.status === 401
          ? "Sign in again, then reopen this report to retry."
          : "Could not send. Your draft is kept; retry when connected."),
    );
  }
  return value;
}
function upload(s, file, path) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    s.xhr = xhr;
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      s.progress = e.lengthComputable
        ? Math.round(e.loaded / e.total * 100)
        : 0;
      notify(s);
    };
    xhr.onload = () => {
      s.xhr = null;
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else {reject(
          Error(
            result?.error ||
              `Upload failed (${xhr.status}). Your draft is kept.`,
          ),
        );}
    };
    xhr.onerror = () =>
      reject(
        Error("Connection lost. Your draft is kept; retry when connected."),
      );
    xhr.onabort = () =>
      reject(Error("Upload paused. Reopen the report to retry."));
    xhr.send(file.blob);
  });
}
async function send(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy || s.draft.received) return;
  if (!s.draft.summary.trim() && !s.draft.files.length) {
    s.error = "Add a description, photo, video or file.";
    notify(s);
    return;
  }
  if (
    !s.issueId && !s.workId &&
    !["operational", "degraded", "unavailable", "unknown"].includes(
      s.draft.condition,
    )
  ) {
    s.error = "Choose the equipment condition, or Not sure.";
    notify(s);
    return;
  }
  s.busy = true;
  s.error = "";
  s.abort = new AbortController();
  s.status = "Sending report…";
  notify(s);
  await persist(s);
  try {
    const start = await jsonRequest("/api/problem-messages/start", {
      client_id: s.draft.client_id,
      equipment_id: s.equipmentId,
      issue_id: s.issueId,
      work_id: s.workId,
      summary: s.draft.summary,
      condition: s.draft.condition,
      files: s.draft.files.map((f) => f.id),
    }, s);
    let receipt = start;
    if (!start.received) {
      for (let i = 0; i < s.draft.files.length; i++) {
        const f = s.draft.files[i];
        if ((start.files || []).includes(f.id)) {
          f.uploaded = true;
          continue;
        }
        s.status = `Uploading ${i + 1} of ${s.draft.files.length}: ${f.name}`;
        s.progress = 0;
        notify(s);
        await upload(
          s,
          f,
          `/api/problem-messages/${start.id}/files/${f.id}?name=${
            encodeURIComponent(f.name)
          }&type=${encodeURIComponent(f.type)}`,
        );
        f.uploaded = true;
        await persist(s);
      }
      s.status = "Confirming receipt…";
      notify(s);
      receipt = await jsonRequest(`/api/problem-messages/${start.id}/send`, {
        files: s.draft.files.map((f) => f.id),
      }, s);
    }
    if (!receipt.received) {
      throw Error("Receipt was not confirmed. Retry to check delivery.");
    }
    s.draft.received = receipt;
    s.draft.files = [];
    await persist(s);
    s.status = "Received by maintenance";
    s.progress = 100;
    for (const url of s.urls.values()) URL.revokeObjectURL(url);
    s.urls.clear();
  } catch (e) {
    s.error = e.message;
    s.status = "Not confirmed · draft kept for retry";
  } finally {
    s.busy = false;
    notify(s);
  }
}
async function discard(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy) return;
  for (const url of s.urls.values()) URL.revokeObjectURL(url);
  s.urls.clear();
  s.draft = fresh();
  s.error = "";
  await persist(s);
  s.status = "Draft saved on this phone · not sent";
  notify(s);
}
function cleanup(args) {
  const s = sessions.get(args.handle);
  if (!s) return;
  s.disposed = true;
  s.abort?.abort();
  s.xhr?.abort();
  window.removeEventListener("beforeunload", s.beforeUnload);
  for (const url of s.urls.values()) URL.revokeObjectURL(url);
  sessions.delete(args.handle);
}
async function listDrafts(args) {
  try {
    const db = await database();
    const drafts = await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readonly");
      const store = tx.objectStore("drafts");
      const keys = store.getAllKeys(), values = store.getAll();
      tx.oncomplete = () =>
        resolve(keys.result.flatMap((key, index) => {
          const value = values.result[index];
          if (
            !String(key).startsWith(`${args.userId}:`) || value.received ||
            (!value.summary && !value.files.length)
          ) return [];
          const [, equipmentId, issueId, workId] = String(key).split(":");
          return [{
            equipmentId,
            issueId,
            workId,
            summary: value.summary || "Media report",
            fileCount: value.files.length,
          }];
        }));
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    emit("draftsListed", { handle: args.handle, json: { drafts } });
  } catch {
    emit("draftsListed", {
      handle: args.handle,
      json: {
        drafts: [],
        error: "Phone-local drafts could not be read in this browser.",
      },
    });
  }
}
registerModule({
  initialize,
  update,
  pick,
  remove,
  send,
  discard,
  cleanup,
  listDrafts,
});
