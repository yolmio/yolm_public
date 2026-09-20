/**
 * JS Modules Registry
 *
 * Module metadata is generated from js_modules/* sources. This file keeps the
 * runtime wiring and public helpers around that generated metadata.
 */

import type * as yom from "./yom";
import { getAssetUrl } from "./yolm_gen_api";
import {
  getModuleMetadata,
  hasModuleCdnHash,
  MODULES,
} from "./js_modules.generated";
import type { JsModuleDefinition, JsModuleId } from "./js_modules.generated";

let _useLocalAssets = false;

/** Force all JS modules to load from /assets/{id}.js instead of CDN */
export function setUseLocalAssets(value = true) {
  _useLocalAssets = value;
}

/** Simple config for app-level jsModules */
export interface JsModuleConfig {
  id: JsModuleId;
  /** Custom asset URL instead of CDN (for local dev). Example: `/assets/${id}.js` */
  assetUrl?: string;
}

/**
 * Convert simple config to full JsModule.
 * Used internally by App.generateYom().
 */
export function resolveJsModule(config: JsModuleConfig): yom.JsModule {
  const def = MODULES[config.id];

  let source: yom.JsModuleSource;
  if (config.assetUrl) {
    source = { kind: "External", path: config.assetUrl };
  } else if (_useLocalAssets || !def.hash) {
    source = { kind: "External", path: getAssetUrl(`${config.id}.js`) };
  } else {
    source = {
      kind: "External",
      path: `https://yolmcdn.net/js/${config.id}/${def.hash}.js`,
    };
  }

  return {
    id: config.id,
    source,
    events: [...def.events],
    exports: [...def.exports],
  };
}

export function getModuleFileUrl(
  id: JsModuleId,
  filePath: string,
): string {
  const def = MODULES[id];
  const hash = def.files[filePath];
  if (!_useLocalAssets && hash) {
    return `https://yolmcdn.net/js/${id}/${hash}/${
      encodeModuleFilePath(filePath)
    }`;
  }
  return getAssetUrl(`${id}/${filePath}`);
}

/**
 * Returns the URL prefix (with trailing slash) under which every sidecar
 * file in a module subdirectory is served. Files in a `files/<dir>/` subtree
 * share one tree hash (see scripts/js_module_helpers.ts), so consumers that
 * resolve sibling files by concatenating a base URL (e.g. pdf.js `wasmUrl`)
 * can use this prefix directly.
 *
 * Returns undefined when the directory has no entry in the CDN registry yet.
 * Falling back to getAssetUrl would fail studio check / deploy generation
 * (it validates against the system's uploaded assets), so callers must treat
 * undefined as "no URL available".
 */
export function getModuleDirUrl(
  id: JsModuleId,
  dirPath: string,
): string | undefined {
  const def = MODULES[id];
  const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
  if (_useLocalAssets) {
    return getAssetUrl(`${id}/${prefix}`);
  }
  const entry = Object.entries(def.files).find(([filePath]) =>
    filePath.startsWith(prefix)
  );
  if (!entry) {
    return undefined;
  }
  return `https://yolmcdn.net/js/${id}/${entry[1]}/${
    encodeModuleFilePath(prefix)
  }`;
}

function encodeModuleFilePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

// Lazy import to avoid circular dependency
let _system: typeof import("./system").system | null = null;
function getSystem() {
  if (!_system) {
    // deno-lint-ignore no-explicit-any
    _system = (globalThis as any).__yolm_system__;
  }
  return _system;
}

/**
 * Declares that the currently-rendering app needs a specific JS module
 * loaded in the browser. Idempotent — safe to call from every component
 * that depends on the module.
 *
 * Yolm registers the module on the surrounding app's `jsModuleConfigs`
 * so it ships only when something opted in. Pass `assetUrl` when the
 * module is hosted from a non-default location (CDN or per-tenant
 * override). Must be called during app rendering — calling outside
 * throws.
 *
 * @example
 * import { useJsModule } from "std/js_modules";
 *
 * function MyEditor() {
 *   useJsModule("lexical_editor");
 *   return <div>...</div>;
 * }
 */
export function useJsModule(
  id: JsModuleId,
  opts?: { assetUrl?: string },
): void {
  const system = getSystem();
  if (!system) {
    throw new Error(
      "useJsModule: system not initialized. This should only be called during app rendering.",
    );
  }

  const app = system.renderingApp;
  if (!app) {
    throw new Error("useJsModule must be called during app rendering");
  }

  if (app.jsModuleConfigs.some((moduleConfig) => moduleConfig.id === id)) {
    return;
  }

  app.jsModuleConfigs.push({ id, assetUrl: opts?.assetUrl });
}

/**
 * Re-exported helpers from the generated module registry.
 *
 * - `getModuleFileUrl(id, filePath)` — returns a hosted sidecar file URL.
 * - `getModuleMetadata(id)` — returns the static metadata for a JS module.
 * - `hasModuleCdnHash(id)` — whether the module has a CDN hash baked into
 *   the build (and is therefore loadable from the public CDN).
 */
export { getModuleMetadata, hasModuleCdnHash };
/**
 * Re-exported type definitions from the generated module registry.
 *
 * - `JsModuleDefinition` — the shape of a single module's metadata.
 * - `JsModuleId` — the union of every registered module's id, used as
 *   the parameter to {@link useJsModule}.
 */
export type { JsModuleDefinition, JsModuleId };
