// deno-lint-ignore-file no-undef

const __v1 = 1;

const WORKER_URL = "/__yolm/web_push/service_worker.js";
const WORKER_SCOPE = "/__yolm/web_push/";
const PUBLIC_CONFIG_URL = "/__yolm/web_push/public_config";
const INSTALLATION_ID_KEY = "yolm.web_push.installation_id.v1";

function supported() {
  return "serviceWorker" in navigator &&
    "PushManager" in globalThis &&
    "Notification" in globalThis &&
    globalThis.isSecureContext;
}

function installationId() {
  let value = localStorage.getItem(INSTALLATION_ID_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_ID_KEY, value);
  }
  return value;
}

function base64urlBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function bytesBase64url(value) {
  const bytes = new Uint8Array(value);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function publicConfig() {
  const response = await fetch(PUBLIC_CONFIG_URL, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Web Push configuration unavailable (${response.status})`);
  }
  const config = await response.json();
  if (
    config.apiVersion !== 1 || typeof config.vapidKeyId !== "string" ||
    typeof config.vapidPublicKey !== "string"
  ) {
    throw new Error("Web Push configuration response is invalid");
  }
  return config;
}

async function waitForActiveWorker(registration) {
  if (!registration.active) {
    const worker = registration.installing || registration.waiting;
    if (!worker) throw new Error("Web Push service worker did not install");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener("statechange", onStateChange);
        reject(new Error("Timed out activating Web Push service worker"));
      }, 10_000);
      function onStateChange() {
        if (worker.state === "activated") {
          clearTimeout(timeout);
          worker.removeEventListener("statechange", onStateChange);
          resolve();
        } else if (worker.state === "redundant") {
          clearTimeout(timeout);
          worker.removeEventListener("statechange", onStateChange);
          reject(new Error("Web Push service worker became redundant"));
        }
      }
      worker.addEventListener("statechange", onStateChange);
      onStateChange();
    });
  }
  if (!registration.active) {
    throw new Error("Web Push service worker is not active");
  }
  return registration;
}

async function workerRegistration() {
  const registration = await navigator.serviceWorker.register(WORKER_URL, {
    scope: WORKER_SCOPE,
    type: "classic",
    updateViaCache: "none",
  });
  return await waitForActiveWorker(registration);
}

async function existingWorkerRegistration() {
  const registration = await navigator.serviceWorker.getRegistration(
    WORKER_SCOPE,
  );
  if (!registration) return null;
  try {
    await registration.update();
  } catch {
    // The active worker remains usable while offline.
  }
  return await waitForActiveWorker(registration);
}

function subscriptionResult(subscription, vapidKeyId, state = "enabled") {
  const json = subscription.toJSON();
  return {
    state,
    permission: globalThis.Notification.permission,
    installationId: installationId(),
    origin: location.origin,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    vapidKeyId,
  };
}

async function inspect() {
  if (!supported()) {
    return { state: "unsupported" };
  }
  try {
    const registration = await existingWorkerRegistration();
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    if (globalThis.Notification.permission === "denied") {
      if (subscription) await subscription.unsubscribe();
      return {
        state: "denied",
        permission: "denied",
        installationId: installationId(),
        origin: location.origin,
      };
    }
    if (!subscription) {
      return {
        state: "disabled",
        permission: globalThis.Notification.permission,
        installationId: installationId(),
        origin: location.origin,
      };
    }
    const config = await publicConfig();
    const currentKey = subscription.options.applicationServerKey
      ? bytesBase64url(subscription.options.applicationServerKey)
      : null;
    return subscriptionResult(
      subscription,
      currentKey === config.vapidPublicKey ? config.vapidKeyId : undefined,
      currentKey === config.vapidPublicKey ? "enabled" : "refresh_required",
    );
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function subscribe(args) {
  if (!supported()) {
    return { state: "unsupported" };
  }
  try {
    const requestPermission = args?.requestPermission === true;
    if (
      globalThis.Notification.permission === "default" && requestPermission
    ) {
      await globalThis.Notification.requestPermission();
    }
    if (globalThis.Notification.permission === "default") {
      return { state: "permission_required", permission: "default" };
    }
    if (globalThis.Notification.permission === "denied") {
      return {
        state: "denied",
        permission: "denied",
        installationId: installationId(),
        origin: location.origin,
      };
    }

    const config = await publicConfig();
    const registration = await workerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (subscription?.options.applicationServerKey) {
      const existingKey = bytesBase64url(
        subscription.options.applicationServerKey,
      );
      if (existingKey !== config.vapidPublicKey) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlBytes(config.vapidPublicKey),
      });
    }
    return subscriptionResult(subscription, config.vapidKeyId);
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function unsubscribe() {
  if (!supported()) {
    return { state: "unsupported" };
  }
  const result = {
    state: "disabled",
    permission: globalThis.Notification.permission,
    installationId: installationId(),
    origin: location.origin,
  };
  try {
    const registration = await existingWorkerRegistration();
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    if (subscription) await subscription.unsubscribe();
    return result;
  } catch (error) {
    return {
      ...result,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function beginSession(args) {
  return { handle: args?.handle };
}

async function endSession() {
  await unsubscribe();
}

registerModule({
  inspect,
  subscribe,
  unsubscribe,
  beginSession,
  endSession,
});
