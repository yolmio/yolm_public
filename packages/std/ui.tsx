import { getUniqueUiId } from "components/utils";
import { DefaultNotFoundPage } from "pages/default404";
import type { AllTags, StringExpr } from "std/jsx-dev-runtime";
import {
  AnalyzeQueryLocalCtx,
  AnalyzeQueryLocalICtxKey,
  DatagridICtxKey,
  EachICtxKey,
} from "./ictx";
import type { AnalyzeQueryLocalICtx, DatagridICtx, EachICtx } from "./ictx";
import { sql } from "./sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr } from "./sql_utils";
import type {
  AuthorizeStatementsOrFn,
  DomStatementsOrFn,
  StateStatements,
  StateStatementsOrFn,
} from "./statements";
import type { KeyFrames, Style } from "./style_types";
import { system } from "./system";
import type { HelperFieldType } from "./system";
import type * as yom from "./yom";
import type { Sql } from "./sql_utils";
import type { StatementSourceOrigin } from "./statement_source";

const ELEMENT_STATEMENT_SOURCE_ORIGIN = Symbol(
  "ELEMENT_STATEMENT_SOURCE_ORIGIN",
);
/**
 * A node in Yolm's virtual UI tree, produced by JSX. `type` is either a
 * component function, an HTML tag name, or one of the built-in control
 * symbols (Route, Show, Each, …); `props` carries that element's props.
 * You rarely construct this directly — write JSX or call a component.
 */
export class Element<T extends ElementType, P = any> {
  constructor(
    public type: T,
    public props: P,
  ) {}
}

type ElementWithStatementSourceOrigin = Element<any, any> & {
  [ELEMENT_STATEMENT_SOURCE_ORIGIN]?: StatementSourceOrigin;
};

/** @internal */
export function setElementStatementSourceOrigin(
  element: Element<any, any>,
  origin: StatementSourceOrigin,
): void {
  (element as ElementWithStatementSourceOrigin)[
    ELEMENT_STATEMENT_SOURCE_ORIGIN
  ] = origin;
}

/** @internal */
export function elementStatementSourceOrigin(
  element: Element<any, any>,
): StatementSourceOrigin | undefined {
  return (element as ElementWithStatementSourceOrigin)[
    ELEMENT_STATEMENT_SOURCE_ORIGIN
  ];
}

/**
 * Anything Yolm's renderer accepts as a child of a UI element.
 *
 * Includes JSX-style {@link Element} instances, plain strings/numbers
 * (rendered as text), {@link Sql} expressions (evaluated and rendered as
 * text at request time), arrays, and falsy bottoms (`undefined` / `false`)
 * for conditional rendering.
 *
 * Use this as the prop type when authoring components that take arbitrary
 * children: `children: Node` or `fallback?: Node`.
 */
export type Node =
  | Element<any, any>
  | Sql
  | AnyExpr
  | string
  | number
  | Node[]
  | undefined
  | false
  | null;
export type ElementType = Component | AllTags | BuiltInType;
export type BuiltInType =
  | typeof RouteSymbol
  | typeof RoutesSymbol
  | typeof ShowSymbol
  | typeof SwitchSymbol
  | typeof StateSymbol
  | typeof MatchSymbol
  | typeof EachSymbol
  | typeof EventHandlersSymbol
  | typeof AuthorizeSymbol
  | typeof QueryParamsSymbol
  | typeof SourceMapSymbol
  | typeof DatagridSymbol
  | typeof RecursiveSymbol
  | typeof RecurseSymbol
  | typeof ModeSymbol
  | typeof ListenSymbol
  | typeof EffectSymbol
  | typeof RedirectSymbol
  | typeof DynamicNodeSymbol;
export type PropsWithChildren<T> = T & { children?: Node };
/** Props type for a component that takes no props of its own. */
export type EmptyProps = Record<never, never>;
/**
 * A Yolm UI component: a function from props (plus optional `children`) to a
 * {@link Node}. Use this as the type when accepting or returning components.
 */
export type Component<T = EmptyProps> = (props: PropsWithChildren<T>) => Node;

export const RouteSymbol = Symbol("Route");
export const RoutesSymbol = Symbol("Routes");
export const ShowSymbol = Symbol("Show");
export const SwitchSymbol = Symbol("Switch");
export const MatchSymbol = Symbol("Match");
export const StateSymbol = Symbol("State");
export const EachSymbol = Symbol("Each");
export const EventHandlersSymbol = Symbol("EventHandlers");
export const AuthorizeSymbol = Symbol("Authorize");
export const QueryParamsSymbol = Symbol("QueryParams");
export const SourceMapSymbol = Symbol("SourceMap");
export const DatagridSymbol = Symbol("Datagrid");
export const RecursiveSymbol = Symbol("Recursive");
export const RecurseSymbol = Symbol("Recurse");
export const ModeSymbol = Symbol("Mode");
export const ListenSymbol = Symbol("Listen");
export const EffectSymbol = Symbol("Effect");
export const RedirectSymbol = Symbol("Redirect");
export const DynamicNodeSymbol = Symbol("DynamicNode");

/**
 * What any event-handler prop (`onClick`, `onChange`, …) accepts: either a
 * {@link DomStatementsOrFn} builder, or a {@link HelperEventHandlerObject}
 * when you also need handler options (debounce, capture, etc.).
 */
export type HelperEventHandler = DomStatementsOrFn | HelperEventHandlerObject;

/** Event-handler form that pairs a {@link DomStatementsOrFn} procedure with handler options. */
export interface HelperEventHandlerObject
  extends Omit<yom.EventHandlerObject, "procedure"> {
  procedure: DomStatementsOrFn;
}

/** A CSS class string applied only when `condition` evaluates true at runtime. */
export interface DynamicClass {
  classes: string;
  condition: BooleanExpr;
}

/**
 * A prop value that is either one of a fixed set of literal strings or a
 * {@link Sql} expression yielding one at runtime. Lets callers pass a static
 * choice or compute it dynamically.
 */
export type EnumExpr<T extends string> = T | Sql;

/**
 * Positioning options for a floating element (popover/tooltip/menu) relative
 * to an anchor, mirroring Floating UI's middleware: placement, strategy, and
 * optional offset / flip / shift / arrow tuning.
 */
export interface FloatingOpts {
  anchorEl: Sql;
  placement: EnumExpr<
    | "top"
    | "top-start"
    | "top-end"
    | "right"
    | "right-start"
    | "right-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end"
  >;
  strategy: EnumExpr<"absolute" | "fixed">;
  offset?: {
    mainAxis: NumericExpr;
    crossAxis: NumericExpr;
  };
  flip?: {
    mainAxis: BooleanExpr;
    crossAxis: BooleanExpr;
  };
  shift?: {
    mainAxis: BooleanExpr;
    crossAxis: BooleanExpr;
  };
  arrow?: { elementId: Sql };
}

/**
 * Merge two {@link FloatingOpts}, with `b` taking precedence over `a` field
 * by field. Returns whichever is defined when only one is given. Used to
 * layer caller overrides on top of a component's default positioning.
 */
export function mergeFloatingOpts(
  a: FloatingOpts | undefined,
  b: FloatingOpts | undefined,
): FloatingOpts | undefined {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return {
    anchorEl: b.anchorEl ?? a.anchorEl,
    placement: b.placement ?? a.placement,
    strategy: b.strategy ?? a.strategy,
    offset: a.offset || b.offset
      ? {
        mainAxis: (b.offset?.mainAxis ?? a.offset?.mainAxis)!,
        crossAxis: (b.offset?.crossAxis ?? a.offset?.crossAxis)!,
      }
      : undefined,
    flip: a.flip || b.flip
      ? {
        mainAxis: (b.flip?.mainAxis ?? a.flip?.mainAxis)!,
        crossAxis: (b.flip?.crossAxis ?? a.flip?.crossAxis)!,
      }
      : undefined,
    shift: a.shift || b.shift
      ? {
        mainAxis: (b.shift?.mainAxis ?? a.shift?.mainAxis)!,
        crossAxis: (b.shift?.crossAxis ?? a.shift?.crossAxis)!,
      }
      : undefined,
    arrow: b.arrow ?? a.arrow,
  };
}

/** Props for {@link Route}. */
export interface RouteProps {
  /** URL path matched by the route (e.g. `"/customers/{customer_id:id}"`). */
  path: string;
  /** Whether the path should match exactly or allow sub-paths. */
  exact?: boolean;
  /**
   * Document title while this route is active. The application name is
   * appended when {@link AppOpts.displayName} is configured.
   */
  title?: StringExpr;
  /** Content rendered when the route matches. */
  children: Node;
}

/**
 A component for defining a route in a routing system. A route is a URL path that can be matched to a component.

@category Routing Component
 */
export function Route(props: RouteProps) {
  return new Element(RouteSymbol, props);
}

Route.getSource = (props: { path: string }) => `Route path=${props.path}`;

/** Props for {@link DocumentTitle}. */
export interface DocumentTitleProps {
  /** Text placed before the application name. */
  children: StringExpr;
  /** Set to false when `children` is already a complete document title. */
  includeAppName?: boolean;
}

/**
 * Sets the browser document title while this node is mounted. By default the
 * current app's display name is appended as `Page | App`.
 *
 * Place data-backed titles inside the {@link Data} scope that owns the text.
 * When nested titles are active, the innermost/latest title takes precedence
 * and the previous title is restored when it unmounts.
 *
 * @category Page Component
 */
export function DocumentTitle(props: DocumentTitleProps) {
  const appName = useApp().displayName;
  const title = appName && props.includeAppName !== false
    ? sql.concat(props.children, " | ", appName)
    : props.children;
  return <title>{title}</title>;
}

/**
 Wraps the current component in a Route component.

@category Hook

 @param path - The path to the route.
 @param exact - Whether the path should match exactly or allow sub-paths.
 */
export function useRoute(path: string | { path: string; exact?: boolean }) {
  useApp().wrapCurrentComponent((node) => {
    if (typeof path === "string") {
      return <Route path={path}>{node}</Route>;
    }
    return <Route {...path}>{node}</Route>;
  });
}

/**
A component for grouping multiple Route components for specifying a list of routes/paths/urls that each can be matched to a component.
Routes must have one or more children of type Route or components that return a Route. It will reorder the routes based on the path.
So the longest path should be first and will only match one.

@category Routing Component
 */
export function Routes(props: { children: Node }) {
  return new Element(RoutesSymbol, props);
}

/**
 * Props for the {@link State} component, which manages a UI scope that can
 * declare scalars/tables, fetch data, and watch for changes.
 *
 * See {@link https://docs.yolm.io/ui/data_vs_form | Data vs Form}.
 */
export interface StateProps {
  /**
       Expressions to watch for changes, if any of these change, the state will be re-evaluated.

       Equality is as expected for most types, but null is considered equal to null.
       */
  watch?: AnyExpr[] | AnyExpr;
  hoistKey?: AnyExpr[] | AnyExpr;
  autoWatch?: boolean;
  procedure: StateStatementsOrFn;
  /** positive integer of miliseconds of delay */
  fallbackDelay?: NumericExpr;
  /** boolean, defaults to false */
  acceptOldResponses?: BooleanExpr;
  /** boolean, defaults to false */
  longRunning?: BooleanExpr;
  /**
       Indicates the status of the state. Accessible in `children` nodes.

       This creates a scalar of type `enums.sys_state_status` with the following values:

       received: means that this has successfully ran
       requested: means that we have tried to run this on the client, seen it needs something from the service
        and have requested it from the service.
       delayed: means that due to the debounce config, we have delayed running this.
       fallback_triggered: means that it has been requesting for longer than the fallbackDelay and we might want to show
        something else in the ui.
       failed: means that the state has failed to run.
       disallowed: means that the allow returned null or false
       */
  statusScalar?: string;
  /**
       Defines a scalar that is true if the state has data to display, even if we are refequesting it.
       */
  hasDataScalar?: string;
  /**
       Creates an error record accessible in `children` nodes if this state failed.

       It has the following fields:

       type: not null and a value of enums.sys_error_type
       message: nullable string
       description: nullable string
       */
  errorRecord?: string;
  debounce?: {
    /** positive integer of miliseconds of delay */
    wait: NumericExpr;
    /** boolean, defaults to false */
    noWaitOnFirst?: BooleanExpr;
    /** positive integer of miliseconds of delay */
    maxWait?: NumericExpr;
    /** boolean, defaults to false */
    leading?: BooleanExpr;
    /** boolean, defaults to true */
    trailing?: BooleanExpr;
  };
  children: Node;
}

export type StatePropsWithoutChildren = Omit<StateProps, "children">;

/**
A component for managing UI state in the application, including data retrieved from the database and UI only data, such as form values.

@category State Management Component

@param {StateProps} props - The properties for the State component.

@examples
[Example](../blocks/auth/roles.tsx)
 */
export function State(props: StateProps) {
  return new Element(StateSymbol, props);
}

/**
A component for conditionally rendering content.

@category Control Flow Component

@examples
[Example](../pages/search_card_page.tsx)
 */
export function Show(props: {
  when: AnyExpr;
  fallback?: Node;
  children: Node;
}) {
  return new Element(ShowSymbol, props);
}

export interface ListenProps {
  /**
   * The query to listen to has access to the database and ui state
   */
  query: Sql;
  /**
   * The event handler to run when the query results change. To get new results, use server, this is a regular event handler.
   */
  onChange: HelperEventHandler;
}

/**
 * A component for listening to a query and running an event handler when the query results change.
 *
 * @category Statement Management Component
 */
export function Listen(props: ListenProps) {
  return new Element(ListenSymbol, props);
}

export interface DynamicNodeProps {
  source?: Sql;
  entryPath?: Sql;
  appDomain?: Sql;
  accessPolicy?: DynamicTableFieldPolicy;
  meta?: Sql;
  /**
   * Statements that authorize every dynamic session request for this node.
   *
   * Required: the signed dynamic request context carries no user identity or
   * expiry, so this proc is the only per-request permission check. It runs
   * with the requester's cookies/headers and can read this node's metadata
   * via `dynamic_node.meta`. Return a boolean; `false` denies the session.
   * Ancestor `<Authorize>` nodes do NOT apply to dynamic session routes.
   */
  authorize: AuthorizeStatementsOrFn;
  onInternalEvent?: HelperEventHandler;
  /**
   * How the card's frame is sized in the host layout.
   *
   * - `"fit"` (default): the frame's height tracks its content. The frame is
   *   same-origin, so its content is measured directly and kept in sync as it
   *   changes — best for inline cards.
   * - `"fill"`: the frame fills its parent's height (`height: 100%`). Use for
   *   full-page / artifact mounts; the host must have a definite height.
   * - `"fixed"`: an explicit height from {@link DynamicNodeProps.height}.
   */
  sizing?: "fit" | "fill" | "fixed";
  /**
   * Explicit frame height when `sizing` is `"fixed"`. A bare number is treated
   * as pixels; any CSS length (e.g. `'60vh'`, `'400px'`) is used verbatim.
   */
  height?: Sql;
}

export interface DynamicTableFieldPolicy {
  tableWhitelist?: string[];
  tableBlacklist?: string[];
  viewWhitelist?: string[];
  viewBlacklist?: string[];
  fieldWhitelist?: DynamicTableFields[];
  fieldBlacklist?: DynamicTableFields[];
}

export interface DynamicTableFields {
  table: string;
  fields?: string[];
}

export function DynamicNode(props: DynamicNodeProps) {
  return new Element(DynamicNodeSymbol, props);
}

/**
A component for rendering content based on multiple conditions.

@category Control Flow Component

@param {object} props - The properties for the Switch component.
@param {Node} props.children - The content containing Match components.

@examples
[Example](../components/stat_row.tsx)
 */
export function Switch(props: { children: Node }) {
  return new Element(SwitchSymbol, props);
}

/**
A component for defining a condition within a Switch component.

@category Control Flow Component

@param {object} props - The properties for the Match component.
@param {BooleanExpr} props.when - The condition to determine if this match should be rendered.
@param {Node} props.children - The content to render when the condition is true.

 */
export function Match(props: { when: BooleanExpr; children: Node }) {
  return new Element(MatchSymbol, props);
}

/**
 * Returns the {@link App} currently being rendered. Must be called from
 * within an app's render or gather phase — throws otherwise.
 *
 * @category Hook
 */
export function useApp() {
  const app = system.renderingApp;
  if (!app) {
    throw new Error("useApp must be used within a rendering context");
  }
  return app;
}

/**
 * Returns the {@link Api} for the current app's domain, creating one on
 * the fly if no api has been registered. Use this when a component needs
 * to attach endpoints to its app's auto-api.
 *
 * @category Hook
 */
export function useApi() {
  const app = useApp();
  const existingApi = system.apis.find((api) => api.domain === app.domain);
  if (existingApi) {
    return existingApi;
  }
  return system.api({ prefix: "/api", domain: app.domain });
}

/**
 * Returns the current rendering phase — `"gather"` while the framework
 * is collecting context info from the tree, or `"render"` when actually
 * producing the YOM. Most components don't need this; it's used by
 * blocks that emit side effects only during one of the phases.
 *
 * @category Hook
 */
export function usePhase() {
  return useApp().renderPhase;
}

/**
Returns the theme for the current app.

@category Hook

@returns The theme for the current app.
 */
export function useTheme() {
  return useApp().theme;
}

/**
 * Run the gather phase over `node`'s children so their context
 * contributions are collected. Components that render children outside the
 * normal flow call this so context (Each, Datagrid, ICtx) still propagates.
 *
 * @category Hook
 */
export function gatherChildrenContextInfo(node: Node) {
  const app = useApp();
  app.gatherChildrenContextInfo(node);
}

/**
Wraps the current component in a State component.

@category Hook

@param f - The properties for the State component.
 */
export function useState(
  f: ((s: StateStatements) => unknown) | Omit<StateProps, "children">,
) {
  const app = useApp();
  app.wrapCurrentComponent((node) => {
    if (typeof f === "function") {
      return <State procedure={f}>{node}</State>;
    }
    return <State {...f}>{node}</State>;
  });
}

/**
Registers a keyframes with the current app and returns the name of the keyframes.

@category Hook

@param keyframes - The keyframes to register.

@returns The name of the keyframes.
 */
export function useKeyframes(keyframes: KeyFrames) {
  const app = useApp();
  return app.registerKeyframes(keyframes);
}

/**
Wraps the current component in a SourceMap component.

@category Hook

@param source - The source to use for the SourceMap component.
 */
export function useSourceMap(source: string) {
  const app = useApp();
  app.wrapCurrentComponent((node) => {
    return <SourceMap source={source}>{node}</SourceMap>;
  });
}

/** Declaration of one URL query parameter for {@link QueryParams} / {@link useQueryParams}. */
export interface QueryParam {
  name: string;
  type: HelperFieldType;
  /** Initial value when the param is absent from the URL (note: `default`, not `expr`). */
  default?: Sql;
  allowNoRead?: boolean;
  /**
   * How writes update browser history. `"replace"` (default) updates the
   * current entry; `"push"` adds one so Back steps through changes.
   */
  history?: yom.QueryParamHistory;
}

/**
Wraps the current component in a QueryParams component.

@category Hook

@param params - The query params to use for the QueryParams component.
 */
export function useQueryParams(params: QueryParam[]) {
  const app = useApp();
  app.wrapCurrentComponent((node) => {
    return <QueryParams params={params}>{node}</QueryParams>;
  });
}

/**
Wraps the current component in a function that wraps the resulting node in a new node.

Other hooks like `useState` and `useQueryParams` use this to wrap the current component in the appropriate component.

@category Hook

@param f - The function to wrap the current component in.
 */
export function wrapCurrentComponent(f: (node: Node) => Node) {
  const app = useApp();
  app.wrapCurrentComponent(f);
}

/**
Wraps the current component in an EventHandlers component.

@category Hook

@param handlers - The handlers to use for the EventHandlers component.
 */
export function useEventHandlers(handlers: EventHandlersProps) {
  const app = useApp();
  app.wrapCurrentComponent((node) => {
    return (
      <>
        <EventHandlers {...handlers} />
        {node}
      </>
    );
  });
}

/**
 * Create a unique ICtx key. The `name` is used only for diagnostics; the
 * key's identity (not its name) is what matches providers to consumers.
 *
 * See {@link https://docs.yolm.io/ui/ictx | ICtx}.
 */
export function createICtxKey<T>(name: string): ICtxKey<T> {
  return { name };
}

/**
 * A typed ICtx key. Use {@link createICtxKey} to make one and
 * {@link useICtx} / {@link useOptionalICtx} to consume the provided value.
 */
export interface ICtxKey<T> {
  /** Identifier shown in error messages. */
  name: string;
  /** Phantom type for the value associated with this key. */
  __type?: T;
}

/**
 * Shape implemented by any value provided via {@link addCtx}. The
 * `implementICtxs` array tells the framework which keys this instance
 * satisfies.
 */
export interface ContextInstance {
  implementICtxs: ICtxKey<any>[];
}

/** Generic constructor type. */
export type Constructor<T> = new (...args: any[]) => T;

/**
 * Get (creating on first access) a per-app singleton of `ctor`. Useful
 * when two unrelated components in the same app need to share state
 * without threading it through context.
 *
 * @category Hook
 */
export function useSharedContext<T>(ctor: Constructor<T>): T {
  const app = useApp();
  return app.sharedContext(ctor);
}

/**
 * Read an ICtx value by key. Throws if no provider for `key` is in
 * scope. Use {@link useOptionalICtx} when the context is genuinely
 * optional.
 *
 * @category Hook
 */
export function useICtx<T>(key: ICtxKey<T>) {
  if (system.renderingApp) {
    return system.renderingApp.getContext(key);
  }
  return system.getContext(key);
}

/**
 * Read an ICtx (in-tree component context) by key, returning `undefined` if
 * no provider is in scope.
 *
 * Use this instead of {@link useICtx} when the context is genuinely
 * optional — e.g. a `Button` that picks up styling defaults from a
 * surrounding `ButtonGroup` if present, but works fine standalone.
 *
 * @category Hook
 */
export function useOptionalICtx<T>(key: ICtxKey<T>) {
  if (system.renderingApp) {
    return system.renderingApp.getContextOptional(key);
  }
  return system.getContextOptional(key);
}

/**
 * Provide a context value for the current component and its descendants.
 * The previous value is restored when the current component finishes
 * rendering. If called outside a render pass, the value is registered
 * system-wide instead.
 */
export function addCtx(instance: ContextInstance) {
  if (system.renderingApp) {
    system.renderingApp.setContext(instance);
  } else {
    system.addContext(instance);
  }
}

/** Remove the given ICtx keys from scope for the current component. */
export function omitICtxs(keys: ICtxKey<any>[]) {
  useApp().omitICtxs(keys);
}

/**
 * Utility component that removes the given ICtx keys from scope for its
 * children only.
 */
export function WithoutICtxs(props: { keys: ICtxKey<any>[]; children: Node }) {
  omitICtxs(props.keys);
  return props.children;
}

/**
 * Utility component that provides `context` to its children only.
 * Equivalent to calling {@link addCtx} at the top of a component.
 */
export function WithContext(props: {
  context: ContextInstance;
  children: Node;
}) {
  addCtx(props.context);
  return props.children;
}

/** ICtx provided by {@link Each} so descendants can resolve the iteration table and record. */
export class EachCtx implements EachICtx, ContextInstance {
  implementICtxs = [EachICtxKey];

  constructor(
    public eachTable: string,
    public eachRecordName: string,
  ) {}
}

/** ICtx provided by {@link Datagrid} so descendants can resolve the grid's table and record. */
export class DatagridCtx implements DatagridICtx, ContextInstance {
  implementICtxs = [DatagridICtxKey];

  constructor(
    public datagridName: string,
    public datagridRecordName: string,
  ) {}
}

/**
 Returns a unique id (expression) for the current component. Intelligently handles Each and Datagrid contexts.

 @category Hook
 */
export function useUniqueId() {
  const eachContext = useOptionalICtx(EachICtxKey);
  const datagridContext = useOptionalICtx(DatagridICtxKey);
  const baseId = getUniqueUiId();
  if (eachContext) {
    return sql.concat(
      sql.lit(baseId),
      "-",
      sql`${sql.ref(eachContext.eachRecordName)}.iteration_index`,
    );
  }
  if (datagridContext) {
    return sql.concat(
      sql.lit(baseId),
      "-",
      sql`${sql.ref(datagridContext.datagridRecordName)}.iteration_index`,
    );
  }
  return sql.lit(baseId);
}

/** Props for {@link Each}. */
export interface EachProps {
  /**
       The name of the table (ui only) to iterate over.
       */
  table: string;
  /**
       The name to use for each record in the iteration. This is how the children of the Each component will access the record.
       */
  recordName: string;
  /**
       Condition to filter the records.
       */
  where?: BooleanExpr;
  /**
       SQL to specify the order of records.
       */
  orderBy?: Sql;
  /**
       Unique key for each iteration.
       */
  eachKey?: Sql;
  children: Node;
}

class EachAnalyzeQueryLocalCtx extends AnalyzeQueryLocalCtx {
  #recordName: string;
  #tableName: string;
  #initialized = false;

  constructor(
    parent: AnalyzeQueryLocalICtx,
    recordName: string,
    tableName: string,
  ) {
    super(parent);
    this.#recordName = recordName;
    this.#tableName = tableName;
  }

  #ensureInitialized() {
    if (this.#initialized) return;
    this.#initialized = true;
    const table = this.parent?.findTable(this.#tableName);
    if (!table) return;
    this.addRecord(this.#recordName, [
      ...table.fields,
      { name: "iteration_index", type: { type: "BigInt" } },
    ]);
  }

  override findTable(name: string) {
    this.#ensureInitialized();
    return super.findTable(name);
  }

  override toLocalDatabases() {
    this.#ensureInitialized();
    return super.toLocalDatabases();
  }
}

/**
A component for iterating over records in a database table and renders content for each record.

@category Control Flow Component

@examples
[Example](../table_blocks/notes_list/notes_list_card.tsx)
 */
export function Each(props: EachProps) {
  // Register Each record in the query analysis context so child components
  // (e.g. DataTable) can resolve recordName references in their queries
  const parentAnalyzeCtx = useOptionalICtx(AnalyzeQueryLocalICtxKey);
  if (parentAnalyzeCtx) {
    addCtx(
      new EachAnalyzeQueryLocalCtx(
        parentAnalyzeCtx,
        props.recordName,
        props.table,
      ),
    );
  }
  addCtx(new EachCtx(props.table, props.recordName));
  return new Element(EachSymbol, props);
}

/** Props for {@link EventHandlers}. */
export interface EventHandlersProps {
  /** Event handlers attached to the browser `window`. */
  window?: Partial<Record<yom.EventHandlerName, HelperEventHandler>>;
  /** Event handlers attached to `document`. */
  document?: Partial<Record<yom.EventHandlerName, HelperEventHandler>>;
  /** Handler invoked once when the surrounding component mounts. */
  mount?: HelperEventHandler;
}

/**
 Lets you register global event handlers for the current app.

 @category Utility Component
 */
export function EventHandlers(props: EventHandlersProps) {
  return new Element(EventHandlersSymbol, props);
}

interface AuthorizeProps {
  /** Statements run to authorize the current request/render. */
  procedure: AuthorizeStatementsOrFn;
  /** Content rendered if the procedure authorizes the request. */
  children: Node;
  /** Optional content rendered if the procedure rejects. */
  unauthorized?: Node;
}

/**
 * Gate `children` behind an authorization procedure. Useful for wrapping
 * routes or sub-trees that require role / permission checks.
 *
 * @category Control Flow Component
 */
export function Authorize(props: AuthorizeProps) {
  return new Element(AuthorizeSymbol, props);
}

/** Props for {@link QueryParams}. */
export interface QueryParamsProps {
  /** Query parameter declarations injected into the surrounding scope. */
  params: QueryParam[];
  children: Node;
}

/**
 * Declare typed query parameters available to the children. Used when an
 * endpoint or page needs to read URL query parameters with type checking.
 */
export function QueryParams(props: QueryParamsProps) {
  return new Element(QueryParamsSymbol, props);
}

/** Props for {@link SourceMap}. */
export interface SourceMapProps {
  /** Source-map tag attached to the wrapped tree. */
  source: string;
  children: Node;
}
/**
A component that wraps the current component in a source map. This is useful for debugging.

@category Utility Component

@param props.source - The source to use for the source map.
@param props.children - The content to wrap in the source map.

 */
export function SourceMap(props: SourceMapProps) {
  return new Element(SourceMapSymbol, props);
}

/**
 * Props for the low-level {@link Datagrid} primitive. Most callers should
 * use the higher-level `DatagridPage` instead — see
 * {@link https://docs.yolm.io/ui/datagrid | Datagrid}.
 */
export interface DatagridProps {
  /** Table the grid is reading from. */
  table: string;
  /** Optional override for the row key expression. */
  tableKey?: Sql;
  /** Column definitions. */
  columns: DataGridColumn[];
  /** @internal Package-owned bulk source for dynamic column layout metadata. */
  columnMetadataSource?: DataGridColumnMetadataSource;
  /** Handler invoked on keyboard navigation. */
  onKeyboardNavigation: HelperEventHandler;
  /** Handler invoked when a cell is clicked. */
  onCellClick: HelperEventHandler;
  /** Handler invoked when a cell is double-clicked. */
  onCellDoubleClick?: HelperEventHandler;
  /** Handler invoked when a keydown event fires inside a cell. */
  onCellKeydown?: HelperEventHandler;
  /** Handler invoked when the grid needs more rows (infinite scroll). */
  onFetchMore?: HelperEventHandler;
  /** Iteration record name accessible to column expressions. */
  recordName: string;
  /** Header row height. */
  headerHeight: NumericExpr;
  /** Body row height. */
  rowHeight: NumericExpr;
  /** Row index of the focused cell. */
  focusedRow: NumericExpr;
  /** Column index of the focused cell. */
  focusedColumn: NumericExpr;
  /** Whether the grid should request focus on the current cell. */
  shouldFocusCell: BooleanExpr;
  /** Per-element style overrides. */
  sx?: DataGridStyles;
}

/** @internal Package-owned description of DataGrid column layout state. */
export interface DataGridColumnMetadataSource {
  table: string;
  columnIds: number[];
  idField: string;
  widthField: string;
  visibleField: string;
  orderingField: string;
  pinLeftField: string;
  pinRightField: string;
}

/** One column of a {@link DatagridProps.columns} list. */
export interface DataGridColumn {
  /** Header cell content. */
  header: Node;
  /** Body cell content (renders inside each row). */
  cell: Node;
  /** Column width (px). */
  width: NumericExpr;
  /** SQL ordering expression when sorting by this column. */
  ordering?: Sql;
  /** Whether the column is visible. */
  visible?: BooleanExpr;
  /** Whether the column is pinned to the left edge while horizontally scrolling. */
  pinLeft?: BooleanExpr;
  /** Whether the column is pinned to the right edge while horizontally scrolling. */
  pinRight?: BooleanExpr;
}

/** Style overrides for the parts of a {@link Datagrid}. */
export interface DataGridStyles {
  root?: Style;
  row?: Style;
  cell?: Style;
  headerCell?: Style;
  header?: Style;
}

/**
 * Low-level virtualized data grid primitive. Most pages should use
 * `DatagridPage` from `pages/datagrid` — this primitive is what that
 * page builds on.
 */
export function Datagrid(props: DatagridProps) {
  addCtx(new DatagridCtx(props.table, props.recordName));
  return new Element(DatagridSymbol, props);
}

/**
 A component that conditionally renders content based on a boolean expression.
 @category Control Flow Component
 @examples
 [Example](../pages/db_management.tsx)

 */
export function Conditional(props: {
  when: AnyExpr;
  then: Node;
  else: Node;
}) {
  return new Element(ShowSymbol, {
    when: props.when,
    fallback: props.else,
    children: props.then,
  });
}

/**
 * Props for {@link Recursive}. Defines an iteration root over a table
 * whose children may render {@link Recurse} to dive into related rows.
 */
export interface RecursiveProps {
  /** Table being iterated. */
  table: string;
  /** Record name bound to each row. */
  recordName: string;
  /** Optional filter applied at this level. */
  where?: BooleanExpr;
  /** Optional ordering applied at this level. */
  orderBy?: Sql;
  /** Optional unique key for diffing iterations. */
  recursiveKey?: Sql;
  children: Node;
}

/**
 * Iterate over a table allowing children to {@link Recurse} into related
 * sub-rows of the same table — useful for tree-shaped data (org charts,
 * threaded comments, file folders).
 */
export function Recursive(props: RecursiveProps) {
  return new Element(RecursiveSymbol, props);
}

/** Props for {@link Recurse}: dives back into the enclosing {@link Recursive}. */
export interface RecurseProps {
  /** Filter applied to the sub-rows visited at this recursion step. */
  where: BooleanExpr;
  /** Record name bound to each sub-row. */
  recordName: string;
}

/**
 * Recurse into the enclosing {@link Recursive}. Calling `Recurse` inside
 * the children of a `Recursive` iterates over related rows of the same
 * table, allowing tree traversal.
 */
export function Recurse(props: RecurseProps) {
  return new Element(RecurseSymbol, props);
}

/**
 * Props for {@link Mode}: controls whether the wrapped subtree renders
 * immediately, lazily (on first display), or lazily on first encounter.
 */
export interface ModeProps {
  /** Rendering strategy for the subtree. */
  render: EnumExpr<"immediate" | "lazy" | "lazy_on_first">;
  children: Node;
}

/**
 * Override the rendering strategy of `children`. Use this around heavy
 * trees that should be evaluated lazily (e.g. tab panels that are off
 * screen on first paint).
 */
export function Mode(props: ModeProps) {
  return new Element(ModeSymbol, props);
}

/** Props for {@link Effect}: a side-effect that fires when watched values change. */
export interface EffectProps {
  /** SQL expressions to watch — `onChange` fires when any of them change. */
  watch: Sql[] | Sql;
  /** Handler invoked when a watched value changes. */
  onChange: HelperEventHandler;
  /** Also trigger `onChange` on mount. Defaults to `false`. */
  triggerOnMount?: boolean;
}

/**
 * Run `onChange` whenever any watched SQL value changes. The closest
 * analogue is React's `useEffect` with a dependency list. The handler
 * runs in the DOM/render scope.
 */
export function Effect(props: EffectProps) {
  return new Element(EffectSymbol, props);
}

/** Props for {@link Redirect}. */
export interface RedirectProps {
  /** App-local path or absolute HTTP(S) URL. */
  to: Sql | string;
  /** Replace the current browser history entry. Defaults to `true`. */
  replace?: BooleanExpr;
}

/**
 * Redirect when this node becomes active.
 *
 * Initial server renders return an HTTP 307 response. Client renders use
 * same-app navigation for app-local targets and document navigation for
 * absolute targets.
 */
export function Redirect(props: RedirectProps) {
  return new Element(RedirectSymbol, props);
}

/**
 A component that renders the primary routes for the app. and includes a default 404 page.
 Should be used for top level routes of an app instead of Routes, which are for nested routes.
 @category Routing Component, initial

 @examples
 [Example](../../examples/tutorial/apps/tutorial.yolmstaging.net.tsx)
 */
export function AppRoutes(props: { children: Node }) {
  return (
    <Routes>
      {props.children}
      <Route path="*">
        <DefaultNotFoundPage />
      </Route>
    </Routes>
  );
}
