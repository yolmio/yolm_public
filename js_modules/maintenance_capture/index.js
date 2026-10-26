// Browser-only capture and durable outbox. Business rules live in SQL endpoints.
const sessions = new Map();
const spanish = {
  draftSaveFailed:
    "Este navegador no pudo guardar el borrador. Mantenga esta página abierta hasta que se reciba el reporte.",
  preparingDraft: "Preparando borrador…",
  storageUnavailable:
    "El almacenamiento de borradores no está disponible. Mantenga esta página abierta hasta que se reciba el reporte.",
  received: "Recibido por mantenimiento",
  draftSaved: "Borrador guardado en este teléfono · no enviado",
  draftNotSaved: "Borrador no guardado en este teléfono",
  fileLimit:
    "No se pudo agregar {name}: máximo de 100 MB por archivo, 20 archivos y 300 MB por reporte. Se conservaron los archivos existentes.",
  signInAgain:
    "Inicie sesión otra vez y vuelva a abrir este reporte para reintentar.",
  sendFailed:
    "No se pudo enviar. Su borrador fue guardado; reintente cuando tenga conexión.",
  uploadFailed: "La carga falló ({status}). Su borrador fue guardado.",
  connectionLost:
    "Se perdió la conexión. Su borrador fue guardado; reintente cuando tenga conexión.",
  uploadPaused: "Carga pausada. Vuelva a abrir el reporte para reintentar.",
  addEvidence: "Agregue una descripción, foto, video o archivo.",
  chooseCondition: "Seleccione la condición del equipo o No estoy seguro.",
  sending: "Enviando reporte…",
  uploading: "Cargando {current} de {total}: {name}",
  confirming: "Confirmando recepción…",
  receiptNotConfirmed:
    "La recepción no fue confirmada. Reintente para verificar la entrega.",
  notConfirmed: "No confirmado · borrador guardado para reintentar",
  discardNotConfirmed:
    "El descarte no fue confirmado. Se conservó el borrador.",
  discardFailed: "Descarte no confirmado · borrador guardado para reintentar",
  mediaReport: "Reporte con archivos",
  draftsUnreadable:
    "No se pudieron leer los borradores locales de este teléfono.",
};
function message(language, key, english, values = {}) {
  let value = language === "es" ? spanish[key] || english : english;
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replace(`{${name}}`, replacement);
  }
  return value;
}
const sessionMessage = (s, key, english, values) =>
  message(s.language, key, english, values);
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
async function draftEntries() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readonly");
      const store = tx.objectStore("drafts");
      const keys = store.getAllKeys(), values = store.getAll();
      tx.oncomplete = () =>
        resolve(keys.result.map((key, i) => [key, values.result[i]]));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function draftContext(key) {
  const [userId, part, id, workId, locationId] = String(key).split(":");
  if (part === "issue" || part === "work") {
    return {
      userId,
      issueId: part === "issue" ? id : "",
      workId: part === "work" ? id : "",
    };
  }
  return { userId, equipmentId: part, issueId: id, workId, locationId };
}
function followupKey(args, draft) {
  return `${args.userId}:${args.issueId != null ? "issue" : "work"}:${
    args.issueId ?? args.workId
  }:${draft.client_id}`;
}
function fresh(args) {
  return {
    client_id: crypto.randomUUID(),
    summary: "",
    condition: args.optionalCondition ? "unknown" : "",
    equipmentId: args.equipmentId ?? null,
    locationId: args.locationId ?? null,
    sendAttempted: false,
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
      equipmentId: s.draft.equipmentId,
      locationId: s.draft.locationId,
      contextLocked: !!s.draft.sendAttempted,
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
    s.error = sessionMessage(
      s,
      "draftSaveFailed",
      "This browser could not save the draft. Keep this page open until the report is received.",
    );
  }
}
async function initialize(args) {
  const key = `${args.userId}:${args.equipmentId ?? ""}:${args.issueId ?? ""}:${
    args.workId ?? ""
  }${args.locationId != null ? `:${args.locationId}` : ""}`;
  const s = {
    ...args,
    key,
    draft: fresh(args),
    urls: new Map(),
    busy: false,
    durable: false,
    language: args.language === "es" ? "es" : "en",
    status: message(args.language, "preparingDraft", "Preparing draft…"),
    error: "",
    disposed: false,
  };
  sessions.set(args.handle, s);
  try {
    if (args.issueId != null || args.workId != null) {
      const requestedDraft = args.draftClientId ||
        new URL(window.location.href).searchParams.get("draft_client_id");
      const matches = (await draftEntries()).filter(([entryKey, value]) => {
        const context = draftContext(entryKey);
        return context.userId === String(args.userId) &&
          (args.issueId != null
            ? context.issueId === String(args.issueId)
            : !context.issueId && context.workId === String(args.workId)) &&
          (!requestedDraft || value.client_id === requestedDraft);
      });
      // Preserve every legacy draft. A recovery link selects an exact client ID.
      const selected = matches.find(([, value]) =>
        !value.received && (value.summary || value.files.length)
      ) || matches.at(-1);
      s.draft = selected?.[1] || fresh(args);
      s.key = followupKey(args, s.draft);
      if (selected && selected[0] !== s.key) {
        await storage(s.key, s.draft);
        await storage(selected[0], undefined, true);
      }
    } else {
      s.draft = await storage(key) || fresh(args);
    }
    if (!("equipmentId" in s.draft)) {
      s.draft.equipmentId = args.equipmentId ?? null;
    }
    if (!("locationId" in s.draft)) {
      s.draft.locationId = args.locationId ?? null;
    }
    if (args.issueId != null || args.workId != null) {
      s.draft.equipmentId = args.equipmentId ?? null;
      s.draft.locationId = args.locationId ?? null;
    }
    if (args.optionalCondition && !s.draft.condition) {
      s.draft.condition = "unknown";
    }
    s.durable = true;
  } catch {
    s.error = sessionMessage(
      s,
      "storageUnavailable",
      "Draft storage is unavailable. Keep this page open until the report is received.",
    );
  }
  for (const f of s.draft.files) s.urls.set(f.id, URL.createObjectURL(f.blob));
  s.status = s.draft.received
    ? sessionMessage(s, "received", "Received by maintenance")
    : s.durable
    ? sessionMessage(s, "draftSaved", "Draft saved on this phone · not sent")
    : sessionMessage(s, "draftNotSaved", "Draft not saved on this phone");
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
    ? sessionMessage(s, "draftSaved", "Draft saved on this phone · not sent")
    : sessionMessage(s, "draftNotSaved", "Draft not saved on this phone");
  notify(s);
}
async function setContext(args) {
  const s = sessions.get(args.handle);
  if (
    !s || s.busy || s.draft.received || s.draft.sendAttempted ||
    s.issueId != null || s.workId != null
  ) return;
  s.draft.equipmentId = args.equipmentId ?? null;
  s.draft.locationId = args.locationId ?? null;
  s.draft.condition = s.optionalCondition ? "unknown" : "";
  await persist(s);
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
        s.error = sessionMessage(
          s,
          "fileLimit",
          "Could not add {name}: maximum 100 MB per file, 20 files and 300 MB per report. Existing files are kept.",
          { name: file.name },
        );
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
          ? sessionMessage(
            s,
            "signInAgain",
            "Sign in again, then reopen this report to retry.",
          )
          : sessionMessage(
            s,
            "sendFailed",
            "Could not send. Your draft is kept; retry when connected.",
          )),
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
              sessionMessage(
                s,
                "uploadFailed",
                "Upload failed ({status}). Your draft is kept.",
                { status: String(xhr.status) },
              ),
          ),
        );}
    };
    xhr.onerror = () =>
      reject(
        Error(
          sessionMessage(
            s,
            "connectionLost",
            "Connection lost. Your draft is kept; retry when connected.",
          ),
        ),
      );
    xhr.onabort = () =>
      reject(
        Error(
          sessionMessage(
            s,
            "uploadPaused",
            "Upload paused. Reopen the report to retry.",
          ),
        ),
      );
    xhr.send(file.blob);
  });
}
async function send(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy || s.draft.received) return;
  if (!s.draft.summary.trim() && !s.draft.files.length) {
    s.error = sessionMessage(
      s,
      "addEvidence",
      "Add a description, photo, video or file.",
    );
    notify(s);
    return;
  }
  if (
    s.issueId == null && s.workId == null && s.draft.equipmentId != null &&
    !["operational", "degraded", "unavailable", "unknown"].includes(
      s.draft.condition,
    )
  ) {
    s.error = sessionMessage(
      s,
      "chooseCondition",
      "Choose the equipment condition, or Not sure.",
    );
    notify(s);
    return;
  }
  s.busy = true;
  s.draft.sendAttempted = true;
  s.error = "";
  s.abort = new AbortController();
  s.status = sessionMessage(s, "sending", "Sending report…");
  notify(s);
  await persist(s);
  try {
    const start = await jsonRequest("/api/problem-messages/start", {
      client_id: s.draft.client_id,
      equipment_id: s.draft.equipmentId,
      location_id: s.draft.locationId,
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
        s.status = sessionMessage(
          s,
          "uploading",
          "Uploading {current} of {total}: {name}",
          {
            current: String(i + 1),
            total: String(s.draft.files.length),
            name: f.name,
          },
        );
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
      s.status = sessionMessage(s, "confirming", "Confirming receipt…");
      notify(s);
      receipt = await jsonRequest(`/api/problem-messages/${start.id}/send`, {
        files: s.draft.files.map((f) => f.id),
      }, s);
    }
    if (!receipt.received) {
      throw Error(
        sessionMessage(
          s,
          "receiptNotConfirmed",
          "Receipt was not confirmed. Retry to check delivery.",
        ),
      );
    }
    s.draft.received = receipt;
    s.draft.files = [];
    await persist(s);
    s.status = sessionMessage(s, "received", "Received by maintenance");
    s.progress = 100;
    for (const url of s.urls.values()) URL.revokeObjectURL(url);
    s.urls.clear();
  } catch (e) {
    s.error = e.message;
    s.status = sessionMessage(
      s,
      "notConfirmed",
      "Not confirmed · draft kept for retry",
    );
  } finally {
    s.busy = false;
    notify(s);
  }
}
async function discard(args) {
  const s = sessions.get(args.handle);
  if (!s || s.busy) return;
  s.busy = true;
  s.error = "";
  s.abort = new AbortController();
  notify(s);
  try {
    if (s.draft.sendAttempted && !s.draft.received) {
      const result = await jsonRequest(
        `/api/problem-messages/${s.draft.client_id}/discard`,
        {},
        s,
      );
      if (result.received) {
        s.draft.received = result;
        s.draft.files = [];
        await persist(s);
        for (const url of s.urls.values()) URL.revokeObjectURL(url);
        s.urls.clear();
        s.status = sessionMessage(s, "received", "Received by maintenance");
        return;
      }
      if (!result.discarded) {
        throw Error(
          sessionMessage(
            s,
            "discardNotConfirmed",
            "Discard was not confirmed. Your draft is kept.",
          ),
        );
      }
    }
    const oldKey = s.key;
    const oldClientId = s.draft.client_id;
    for (const url of s.urls.values()) URL.revokeObjectURL(url);
    s.urls.clear();
    s.draft = fresh(s);
    if (s.issueId != null || s.workId != null) s.key = followupKey(s, s.draft);
    await persist(s);
    if (s.durable && oldKey !== s.key) {
      const url = new URL(window.location.href);
      if (url.searchParams.get("draft_client_id") === oldClientId) {
        url.searchParams.set("draft_client_id", s.draft.client_id);
        window.history.replaceState(window.history.state, "", url);
      }
      await storage(oldKey, undefined, true);
    }
    s.status = sessionMessage(
      s,
      "draftSaved",
      "Draft saved on this phone · not sent",
    );
  } catch (e) {
    s.error = e.message;
    s.status = sessionMessage(
      s,
      "discardFailed",
      "Discard not confirmed · draft kept for retry",
    );
  } finally {
    s.busy = false;
    notify(s);
  }
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
    const drafts = (await draftEntries()).flatMap(([key, value]) => {
      const context = draftContext(key);
      if (
        context.userId !== String(args.userId) || value.received ||
        (!value.summary && !value.files.length)
      ) return [];
      return [{
        ...context,
        clientId: value.client_id,
        summary: value.summary ||
          message(args.language, "mediaReport", "Media report"),
        fileCount: value.files.length,
      }];
    });
    emit("draftsListed", { handle: args.handle, json: { drafts } });
  } catch {
    emit("draftsListed", {
      handle: args.handle,
      json: {
        drafts: [],
        error: message(
          args.language,
          "draftsUnreadable",
          "Phone-local drafts could not be read in this browser.",
        ),
      },
    });
  }
}
registerModule({
  initialize,
  update,
  setContext,
  pick,
  remove,
  send,
  discard,
  cleanup,
  listDrafts,
});
