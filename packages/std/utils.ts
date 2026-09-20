export { dedent } from "./utils/string";

/**
 Decorator for any function that takes statements as the first argument.
 This will make it so compile errors will include the name of the method.

 Uses TC39 Stage 3 decorators (TypeScript 5.0+, Deno default).

 @category Helper Function
 */
export function sourceMap<This, Args extends any[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<
    This,
    (this: This, ...args: Args) => Return
  >,
): (this: This, ...args: Args) => Return;
export function sourceMap(
  target: any,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor;
export function sourceMap(
  target: any,
  propertyKeyOrContext?: any,
  descriptor?: PropertyDescriptor,
): any {
  // Legacy decorator support (experimentalDecorators: true)
  if (
    typeof propertyKeyOrContext === "string" ||
    typeof propertyKeyOrContext === "symbol"
  ) {
    const originalMethod = descriptor!.value;
    const methodName = String(propertyKeyOrContext);

    descriptor!.value = function (this: any, ...args: any[]) {
      // Check if first argument has pushSource/popSource methods
      if (
        args[0] && typeof args[0].pushSource === "function" &&
        typeof args[0].popSource === "function"
      ) {
        args[0].pushSource(`${this.constructor.name}.${methodName}`);
        const result = originalMethod.apply(this, args);
        args[0].popSource();
        return result;
      }
      // If not, just call the method normally
      return originalMethod.apply(this, args);
    };

    return descriptor!;
  }

  // New decorator API (Stage 3)
  const originalMethod = target;
  const context = propertyKeyOrContext as ClassMethodDecoratorContext;
  const methodName = String(context.name);

  return function (this: any, ...args: any[]) {
    // Check if first argument has pushSource/popSource methods
    if (
      args[0] && typeof args[0].pushSource === "function" &&
      typeof args[0].popSource === "function"
    ) {
      args[0].pushSource(`${this.constructor.name}.${methodName}`);
      const result = originalMethod.apply(this, args);
      args[0].popSource();
      return result;
    }
    // If not, just call the method normally
    return originalMethod.apply(this, args);
  };
}
