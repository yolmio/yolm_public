export function isPlainObject(
  item: unknown,
): item is Record<keyof any, unknown> {
  return (
    item !== null && typeof item === "object" && item.constructor === Object
  );
}

export function deepClone<T>(v: T): T {
  if (Array.isArray(v)) {
    return v.map(deepClone) as any;
  }
  if (isPlainObject(v)) {
    const output: any = {};
    for (const i of Object.keys(v)) {
      (output as any)[i] = deepClone((v as any)[i]);
    }
    return output as T;
  }
  return v;
}

export interface DeepmergeOptions {
  clone?: boolean;
}

export function deepmerge<T>(
  target: T,
  source: unknown,
  options: DeepmergeOptions = { clone: true },
): T {
  const output = options.clone ? deepClone(target) : target;
  if (isPlainObject(target) && isPlainObject(source)) {
    for (const key in source) {
      // Avoid prototype pollution
      if (key === "__proto__") {
        continue;
      }
      if (
        isPlainObject(source[key]) &&
        key in target &&
        isPlainObject(target[key])
      ) {
        // Since `output` is a clone of `target` and we have narrowed `target` in this block we can cast to the same type.
        (output as Record<keyof any, unknown>)[key] = deepmerge(
          target[key],
          source[key],
          options,
        );
      } else {
        (output as Record<keyof any, unknown>)[key] = source[key];
      }
    }
  }
  return output;
}
