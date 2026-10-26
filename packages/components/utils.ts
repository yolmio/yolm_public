import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import { BasicStatements, DomStatements } from "std/statements";
import type { DomStatementsOrFn } from "std/statements";
import type { Style } from "std/style_types";
import { system } from "std/system";
import type { App } from "std/system";
import type { DynamicClass, ElementType, EmptyProps, Node } from "std/ui";
import { mergeFloatingOpts } from "std/ui";
import { SequentialIDGenerator } from "std/utils/sequential_id_generator";

/**
 * Loose shape for component props that expose a free-form `slots` map.
 * Most components use the typed {@link SlottedComponentBaseProps}
 * instead.
 */
export interface SlottedComponentOpts extends SingleElementComponentProps {
  slots?: Record<string, SingleElementComponentProps>;
}

/**
 * Stricter slotted-component prop shape parameterized by the set of
 * named slots. Used as a building block by interface declarations that
 * want to constrain the keys of `slots`.
 */
export type SlottedComponentWithSlotNames<T extends string> =
  & SingleElementComponentProps
  & {
    slots?: Partial<Record<T, SingleElementComponentProps>>;
  };

/** Minimum shape for a component that renders a single host element. */
export interface SingleElementComponentProps {
  /** Extra class names applied to the root element. */
  className?: string;
  /** Style overrides applied to the root element. */
  sx?: Style;
  /** Override the host element (e.g. swap `div` for `section`). */
  component?: ElementType;
}

/**
 * Base prop shape for components built from multiple named "slots".
 * Callers can swap out individual slot elements via `slots` and pass
 * per-slot props via `slotProps`. Used by every Joy-style component
 * (Button, Card, Input, etc.).
 */
export interface SlottedComponentBaseProps<
  T extends Record<string, ElementType>,
> {
  /** Override the root element type. */
  component?: ElementType;
  /** Style overrides for the root element. */
  sx?: Style;
  /** Extra class names for the root element. */
  className?: string;
  /** Per-slot element overrides. */
  slots?: Partial<Record<keyof T, ElementType>>;
  /** Per-slot prop overrides. */
  slotProps?: {
    [K in keyof T]?: SlotProps<T[K]>;
  };
}

/**
 * Internal representation of one named slot inside a slotted component
 * — its host element, its name, and the function that produces its
 * style. Returned by {@link createSlot}.
 */
export interface Slot<T> {
  type: ElementType;
  name: string;
  createStyles: (app: App, props: T) => Style;
}

/**
 * Factory for a named slot inside a slotted component. Returns a
 * function that, given the root props + slot props, yields
 * `[component, mergedProps]` ready to be passed to `createElement`.
 * Component authors use this to declare slots; application code rarely
 * needs it.
 */
export function createSlot<T>(
  name: string,
  createStyles: (app: App, props: T) => Style,
) {
  return createSlotImpl(name, createStyles, false);
}

/**
 * @internal
 * Component-package slot whose intrinsic projection is side-effect-free during
 * gather, including style creation, external prop access, and prop merging.
 */
export function createGatherSafeSlot<T>(
  name: string,
  createStyles: (app: App, props: T) => Style,
) {
  return createSlotImpl(name, createStyles, true);
}

function createSlotImpl<T>(
  name: string,
  createStyles: (app: App, props: T) => Style,
  skipIntrinsicGatherWork: boolean,
) {
  return (opts: {
    component: ElementType;
    rootProps: SlottedComponentBaseProps<Record<string, any>>;
    slotProps: T;
    internalProps?: AnyProps;
    externalProps?: AnyProps;
  }): [(props: AnyProps) => Node, AnyProps] => {
    const app = system.renderingApp;
    if (!app) {
      throw new Error(`No rendering app in slot creation for "${name}"`);
    }
    const slotType = opts.rootProps.slots?.[name] ??
      (name === "root" ? opts.rootProps.component : undefined) ??
      opts.component;
    const overrides = opts.rootProps.slotProps?.[name] ?? {};
    if (
      skipIntrinsicGatherWork &&
      app.renderPhase === "gather" &&
      typeof slotType === "string"
    ) {
      if (Object.prototype.hasOwnProperty.call(overrides, "children")) {
        return [slotType as any, { children: overrides.children } as AnyProps];
      }
      if (
        opts.externalProps &&
        Object.prototype.hasOwnProperty.call(opts.externalProps, "children")
      ) {
        return [
          slotType as any,
          { children: opts.externalProps.children } as AnyProps,
        ];
      }
      if (
        opts.internalProps &&
        Object.prototype.hasOwnProperty.call(opts.internalProps, "children")
      ) {
        return [
          slotType as any,
          { children: opts.internalProps.children } as AnyProps,
        ];
      }
      return [slotType as any, {} as AnyProps];
    }
    // deno-lint-ignore no-unused-vars
    const { sx, className, ...rest } = opts.externalProps ?? {};
    delete rest.component;
    if (name === "root") {
      rest.sx = opts.rootProps.sx;
    }
    if (name === "root") {
      rest.className = opts.rootProps.className;
    }
    const mergedProps = mergeProps(
      {
        ...opts.internalProps,
        sx: createStyles(app, opts.slotProps),
        className,
      } as AnyProps,
      rest,
    );
    if (typeof slotType === "string") {
      mergedProps.slotProps = undefined;
      mergedProps.slots = undefined;
    }
    return [slotType as any, mergeProps(mergedProps, overrides)];
  };
}

/**
 * Helper for components that render a single host element with merged
 * internal/external props. Use inside a component implementation that
 * wraps a single tag (e.g. `Typography` over `<span>`).
 */
export function singleElementComponent(opts: {
  component: ElementType;
  sx: Style;
  externalProps: AnyProps;
  internalProps?: AnyProps;
}): [(props: AnyProps) => Node, AnyProps] {
  const { component = opts.component, ...externalProps } = opts.externalProps;
  const props = mergeProps(
    {
      ...(opts.internalProps ?? {}),
      sx: opts.sx,
    },
    externalProps,
  );
  return [component as any, props];
}

/**
 * Props accepted by one named slot inside a slotted component — the
 * slot element's native props plus an optional `component` override
 * and any caller-supplied overrides.
 */
export type SlotProps<
  TSlotComponent extends ElementType,
  TOverrides = EmptyProps,
> =
  & ComponentProps<TSlotComponent>
  & {
    component?: TSlotComponent;
  }
  & TOverrides
  & Record<string, unknown>;

/**
 * Signature for a component that supports the `component` prop to
 * override its host element type. Every Joy-style component
 * (Button, Card, Typography, …) is typed against this.
 */
export interface OverridableComponent<M extends OverridableTypeMap> {
  <C extends ElementType>(
    props: {
      component: C;
    } & OverrideProps<M, C>,
  ): Node;
  (props: DefaultComponentProps<M>): Node;
}

/** Distributive variant of `Omit` — applies `Omit` to each member of a union. */
export type DistributiveOmit<T, K extends keyof any> = T extends any
  ? Omit<T, K>
  : never;

/** Props for an {@link OverridableComponent} when `component={C}` is supplied. */
export type OverrideProps<
  M extends OverridableTypeMap,
  C extends ElementType,
> = BaseProps<M> & DistributiveOmit<ComponentProps<C>, keyof BaseProps<M>>;

/** Native props for any host element type or component function. */
export type ComponentProps<T extends ElementType> = T extends
  keyof JSX.IntrinsicElements ? JSX.IntrinsicElements[T]
  : T extends (props: infer P) => Node ? P
  : never;

/** Props for an {@link OverridableComponent} when no `component` override is supplied. */
export type DefaultComponentProps<M extends OverridableTypeMap> =
  & BaseProps<M>
  & DistributiveOmit<ComponentProps<M["defaultComponent"]>, keyof BaseProps<M>>;

/** Component-specific props (excluding the host element's native props). */
export type BaseProps<M extends OverridableTypeMap> = M["props"];

type AnyProps =
  & JSX.IntrinsicElements[keyof JSX.IntrinsicElements]
  & Record<string, any>;

/**
 * Merge two prop bags. Special-cases `sx` (deep-merges styles),
 * `style`, `className` (concatenates), `dynamicClasses`, and event
 * handlers (chains via {@link mergeEventHandler}). All other keys take
 * the external value when present.
 */
export function mergeProps(
  internalProps: AnyProps,
  externalProps: AnyProps,
): AnyProps {
  const result = { ...internalProps } as AnyProps;
  for (const key in externalProps) {
    if (Object.prototype.hasOwnProperty.call(externalProps, key)) {
      const value = externalProps[key];
      if (key === "sx") {
        result.sx = mergeStyle(internalProps.sx, value as Style);
      } else if (key === "style") {
        result.style = {
          ...internalProps.style,
          ...(value as Record<string, any>),
        };
      } else if (key === "dynamicClasses") {
        result.dynamicClasses = [
          ...(internalProps.dynamicClasses || []),
          ...((value as DynamicClass[]) || []),
        ];
      } else if (key === "className") {
        result.className = internalProps.className
          ? `${internalProps.className} ${value}`
          : (value as string);
      } else if (key.startsWith("on")) {
        result[key] = mergeEventHandler(internalProps[key], value) as any;
      } else if (key === "floating") {
        result.floating = mergeFloatingOpts(internalProps.floating, value);
      } else {
        result[key] = value as any;
      }
    }
  }
  return result;
}

/**
 * Type-map shape parameterizing {@link OverridableComponent}. Pair a
 * component's own props with its default host element type.
 */
export interface OverridableTypeMap {
  props: EmptyProps;
  defaultComponent: ElementType;
}

/**
 * Two-way binding for a controlled dialog's open state. Pass exactly
 * one of: `bindScalar` (own a UI scalar), `bindRecordField` (own a
 * form-record field), or `open` + `onClose` (manual control). Used by
 * {@link ModalDialog}-based components throughout the package.
 */
export interface DialogBinding {
  /** Name of a UI scalar that becomes `true` when the dialog is open. */
  bindScalar?: string;
  /** Name of a form record field used as the open-state binding. */
  bindRecordField?: string;
  /** Manual open expression (paired with `onClose`). */
  open?: BooleanExpr;
  /** Manual close handler (paired with `open`). */
  onClose?: DomStatementsOrFn;
}

/**
 * Normalize a {@link DialogBinding} into the `{ open, onClose }` shape
 * a dialog implementation can consume. Throws when the caller passes
 * mutually-exclusive options together.
 */
export function resolveDialogBinding(opts: DialogBinding) {
  if ("bindScalar" in opts && typeof opts.bindScalar === "string") {
    if ("bindRecordField" in opts && typeof opts.bindRecordField === "string") {
      throw new Error("Cannot specify both bindScalar and bindRecordField");
    }
    if ("onClose" in opts && typeof opts.onClose === "function") {
      throw new Error("Cannot specify both onClose and bindScalar");
    }
    return {
      open: sql.ref(opts.bindScalar),
      onClose: (s: DomStatements) => {
        s.setScalar(opts.bindScalar!, false);
      },
    };
  }
  if ("bindRecordField" in opts && typeof opts.bindRecordField === "string") {
    const split = opts.bindRecordField.split(".");
    if (split.length < 2) {
      throw new Error(
        "bindRecordField must be a record.field or ui.record.field",
      );
    }
    if ("onClose" in opts && typeof opts.onClose === "function") {
      throw new Error("Cannot specify both onClose and bindRecordField");
    }
    return {
      open: sql.ref(opts.bindRecordField),
      onClose: (s: DomStatements) => {
        const record = sql.ref(...split.slice(0, -1));
        const field = sql.ref(split[split.length - 1]);
        s.modify(sql`update ${record} set ${field} = false`);
      },
    };
  }
  const fixedOpts = opts as { open: BooleanExpr; onClose: DomStatementsOrFn };
  return { open: fixedOpts.open, onClose: fixedOpts.onClose };
}

const mergeStyleCache = new WeakMap<object, WeakMap<object, Style>>();

function mergeStyle(
  base: Style | undefined,
  ovewrite: Style | undefined,
): Style | undefined {
  if (!base) {
    return ovewrite;
  }
  if (!ovewrite) {
    return base;
  }
  if (mergeStyleCache.has(base)) {
    const baseCache = mergeStyleCache.get(base)!;
    if (baseCache.has(ovewrite)) {
      return baseCache.get(ovewrite)!;
    }
    const merged = [base, ovewrite];
    baseCache.set(ovewrite, merged);
    return merged;
  }
  const merged = [base, ovewrite];
  const baseCache = new WeakMap<object, Style>();
  baseCache.set(ovewrite, merged);
  mergeStyleCache.set(base, baseCache);
  return merged;
}

function mergeEventHandlerProc(a: DomStatementsOrFn, b: DomStatementsOrFn) {
  return (s: DomStatements) => s.statements(a).statements(b);
}

// Event handler object type that includes procedure and options
interface EventHandlerObject {
  procedure: DomStatementsOrFn;
  detachedFromNode?: boolean;
  disableAutoUiCommit?: boolean;
}

// Type for all possible event handlers based on the new EventHandlerWithOptions pattern
type AnyEventHandler =
  | ((s: DomStatements, ...args: any[]) => void) // Handler functions (with or without event parameter)
  | EventHandlerObject // Object with procedure and optional flags
  | BasicStatements
  | DomStatements
  | undefined;

// Type guard for EventHandlerObject
function isEventHandlerObject(
  handler: NonNullable<AnyEventHandler>,
): handler is EventHandlerObject {
  return typeof handler === "object" &&
    handler !== null &&
    "procedure" in handler &&
    !("statements" in handler); // Exclude statement instances
}

// Type guard for function handlers
function isFunctionHandler(
  handler: NonNullable<AnyEventHandler>,
): handler is (s: DomStatements, ...args: any[]) => void {
  return typeof handler === "function";
}

// Type guard for statement instances
function isStatementInstance(
  handler: NonNullable<AnyEventHandler>,
): handler is BasicStatements | DomStatements {
  return handler instanceof BasicStatements || handler instanceof DomStatements;
}

/**
 * Props for an `href`-capable component that may act as a back link.
 */
export interface BackLinkOpts {
  /**
   * Return to the most recent earlier history entry for `href`'s path,
   * restoring that page's query string (filters, search, paging) and scroll.
   * Without such an entry it is a plain link to `href`. Use it on links that
   * return to a parent or list page.
   */
  backLink?: boolean;
}

/**
 * Anchor attributes that make a link to `href` a back link; see
 * {@link BackLinkOpts}.
 */
export function backLinkAttrs(
  href: Sql | string | undefined,
  backLink: boolean | undefined,
): { "data-yolm-back"?: Sql | string } {
  if (!backLink) {
    return {};
  }
  if (href === undefined) {
    throw new Error("backLink requires href");
  }
  return { "data-yolm-back": href };
}

/**
 * Combine two event handlers (statements instance, function, or full
 * event-handler object) into a single handler that runs both. Either
 * argument may be `undefined`. Used by {@link mergeProps} on any
 * `on…` key.
 */
export function mergeEventHandler<T extends AnyEventHandler>(
  a: T,
  b: T,
): T {
  if (!(a || b)) {
    return undefined as T;
  }
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }

  // Convert any handler to a DomStatementsOrFn
  const toProcedure = (
    handler: NonNullable<AnyEventHandler>,
  ): DomStatementsOrFn => {
    if (isStatementInstance(handler)) {
      return handler;
    }

    if (isFunctionHandler(handler)) {
      return handler as DomStatementsOrFn;
    }

    if (isEventHandlerObject(handler)) {
      return handler.procedure;
    }

    // This should be unreachable with proper typing
    throw new Error("Invalid event handler type");
  };

  // Convert both handlers to procedures
  const aProcedure = toProcedure(a as NonNullable<AnyEventHandler>);
  const bProcedure = toProcedure(b as NonNullable<AnyEventHandler>);

  // Merge the procedures
  const mergedProcedure = mergeEventHandlerProc(aProcedure, bProcedure);

  // If either handler has options, preserve them in the result
  const aHasOptions = a && isEventHandlerObject(a) &&
    ("detachedFromNode" in a || "disableAutoUiCommit" in a);
  const bHasOptions = b && isEventHandlerObject(b) &&
    ("detachedFromNode" in b || "disableAutoUiCommit" in b);

  if (aHasOptions || bHasOptions) {
    const result: EventHandlerObject = {
      procedure: mergedProcedure,
    };

    if (
      (aHasOptions && (a as EventHandlerObject).detachedFromNode) ||
      (bHasOptions && (b as EventHandlerObject).detachedFromNode)
    ) {
      result.detachedFromNode = true;
    }

    if (
      (aHasOptions && (a as EventHandlerObject).disableAutoUiCommit) ||
      (bHasOptions && (b as EventHandlerObject).disableAutoUiCommit)
    ) {
      result.disableAutoUiCommit = true;
    }

    return result as T;
  }

  // Otherwise return just the merged procedure
  return mergedProcedure as unknown as T;
}

const uniqueUiIdGenerator = new SequentialIDGenerator();

/**
 * Allocate a process-unique id string (`u<n>`). Used by components to
 * generate stable DOM ids for `aria-` attributes and focus management.
 * Prefer {@link useUniqueId} from `std/ui` inside renders — it's aware
 * of `Each` / `Datagrid` contexts.
 */
export function getUniqueUiId() {
  return uniqueUiIdGenerator.next();
}
