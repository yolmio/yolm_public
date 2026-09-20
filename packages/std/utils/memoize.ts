import { system } from "../system";
import type { App } from "../system";

export type AppFunc = (app: App, ...args: any[]) => any;
export type RestOfAppFuncArgs<T extends AppFunc> = T extends (
  app: App,
  ...args: infer U
) => any ? U
  : never;

export function memoizePerApp<T extends AppFunc>(
  callback: T,
  resolver?: (...args: RestOfAppFuncArgs<T>) => string,
): (...args: RestOfAppFuncArgs<T>) => ReturnType<T>;
export function memoizePerApp(
  callback: AppFunc,
  resolver?: (app: App, ...args: any[]) => string,
) {
  if (typeof callback !== "function") {
    throw new Error("`callback` should be a function");
  }

  if (resolver !== undefined && typeof resolver !== "function") {
    throw new Error("`resolver` should be a function");
  }

  if (callback.length === 1) {
    return lazyPerApp(callback);
  }

  const perAppCache = new Map<App, Map<string, any>>();

  const memoized = function (...args: any[]) {
    if (!system.renderingApp) {
      throw new Error("No current app");
    }
    let cache = perAppCache.get(system.renderingApp);
    if (!cache) {
      cache = new Map<string, any>();
      perAppCache.set(system.renderingApp, cache);
    }
    const key = resolver
      // @ts-ignore: todo: fix this or explain why it's ok
      ? resolver.apply(this, args)
      : JSON.stringify(args);

    if (!cache.has(key)) {
      // @ts-ignore: todo: fix this or explain why it's ok
      cache.set(key, callback.call(this, system.renderingApp, ...args));
    }

    return cache.get(key);
  };
  return memoized;
}

export function lazyPerApp<T extends (app: App) => any>(
  f: T,
): () => ReturnType<T> {
  const results = new Map<App, ReturnType<T>>();
  return () => {
    if (!system.renderingApp) {
      throw new Error("No current app");
    }
    if (!results.has(system.renderingApp)) {
      results.set(system.renderingApp, f(system.renderingApp));
    }
    return results.get(system.renderingApp)!;
  };
}

type Func = (...args: any) => any;
export function memoize<T extends Func>(
  callback: T,
  resolver?: (...args: Parameters<T>) => string,
): T;
export function memoize(callback: Func, resolver?: (...args: any[]) => string) {
  if (typeof callback !== "function") {
    throw new Error("`callback` should be a function");
  }

  if (resolver !== undefined && typeof resolver !== "function") {
    throw new Error("`resolver` should be a function");
  }

  if (callback.length === 0) {
    return lazy(callback);
  }

  const cache = new Map<string, any>();

  const memoized = function (...args: any[]) {
    const key = resolver
      // @ts-ignore: todo: fix this or explain why it's ok
      ? resolver.apply(this, args)
      : JSON.stringify(args);

    if (!cache.has(key)) {
      // @ts-ignore: todo: fix this or explain why it's ok
      cache.set(key, callback.apply(this, args));
    }

    return cache.get(key);
  };
  return memoized;
}

export function lazy<T extends () => any>(f: T): T {
  let didRun = false;
  let result: ReturnType<T> | undefined;
  return (() => {
    if (!didRun) {
      didRun = true;
      result = f();
    }
    return result;
  }) as unknown as T;
}
