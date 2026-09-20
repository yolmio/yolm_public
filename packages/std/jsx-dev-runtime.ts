import type {
  ChangeEventHandler,
  CheckboxEventHandler,
  ClipboardEventHandler,
  FileEventHandler,
  FocusEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
} from "./event_utils";
import type { BooleanExpr, NumericExpr, Sql } from "./sql_utils";
import type { GeneralServerStatementsOrFn } from "./statements";
import type { Style } from "./style_types";
import {
  type BuiltInType,
  type DynamicClass,
  Element as ElementClass,
  type ElementType,
  type FloatingOpts,
  type HelperEventHandler,
  type Node,
  setElementStatementSourceOrigin,
} from "./ui";
import {
  type JsxDevSource,
  statementSourceOriginFromJsxDev,
} from "./statement_source";

export type Booleanish = boolean | "true" | "false" | BooleanExpr;
export type EnumExpr<T extends string> = T | Sql;
type AnyString = string & Record<never, never>;
export type StringExpr = string | Sql;
export type CrossOrigin = EnumExpr<"anonymous" | "use-credentials" | "">;

export interface DOMAttributes {
  children?: Node;
  dangerouslySetInnerHTML?: StringExpr | undefined;
  /**
   * Server-side rendering statements for this element's children.
   * Use this to render HTML content on the server without JavaScript.
   */
  serverRenderChildren?: GeneralServerStatementsOrFn;
  dynamicClasses?: DynamicClass[];
  dynamicClass?: DynamicClass;
  scrollRestoration?: "route";
  sx?: Style;
  style?: Partial<Record<string, StringExpr>>;
  floating?: FloatingOpts;
  yolmPopoverShowing?: BooleanExpr;
  /** Extension point to integrate with JsModules */
  js?: {
    handles: {
      module: string;
      cleanup: string;
      handle: Sql;
    }[];
    /**
     * Event handlers for JsModules, format is module.event
     */
    on: {
      [event: string]: HelperEventHandler;
    };
  };
  popover?: EnumExpr<"auto" | "manual">;
  yolmFocusKey?: BooleanExpr;
  yolmModalShowing?: BooleanExpr;
  /**
       Tailwind compatible class names

       If you want actual class names, use `classes` instead.
       */
  className?: string;
  /**
       Tailwind compatible class names

       If you want actual class names, use `dynamicClasses` instead.
       */
  dynamicClassNames?: {
    condition: BooleanExpr;
    classNames: string;
  }[];
  classes?: string;
  xmlns?: StringExpr;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onClick?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDoubleClick?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseDown?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseUp?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseEnter?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseLeave?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseOver?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseOut?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onMouseMove?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDialogBackdropClick?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDrag?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDragStart?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDragEnter?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDragLeave?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDragOver?: MouseEventHandler;

  /**
       Adds event record to the context with fields:
       alt_key, button, buttons, client_x, client_y, ctrl_key, meta_key,
       movement_x, movement_y, offset_x, offset_y, page_x, page_y,
       screen_x, screen_y, shift_key
       */
  onDragEnd?: MouseEventHandler;
  onDrop?: MouseEventHandler;
  onFocus?: FocusEventHandler;
  onBlur?: FocusEventHandler;
  onFocusIn?: FocusEventHandler;
  onFocusOut?: FocusEventHandler;
  onFocusAway?: FocusEventHandler;
  onSubmit?: FormEventHandler;
  onClickAway?: MouseEventHandler;

  onMount?: HelperEventHandler;
  onScroll?: HelperEventHandler;
  onClose?: HelperEventHandler;
  onCancel?: HelperEventHandler;
  onToggleShow?: HelperEventHandler;
  onToggleHide?: HelperEventHandler;

  /**
       Keyboard key down event handler
       Adds keydown_event record to the context
       */
  onKeyDown?: KeyboardEventHandler;

  /**
       Keyboard key up event handler
       Adds keydown_event record to the context
       */
  onKeyUp?: KeyboardEventHandler;

  /**
       File input change event handler
       Adds file table to the context with fields:
       uuid, type, name, last_modified, size
       */
  onFileChange?: FileEventHandler;

  /**
       Input event handler
       Uses ChangeEventHandler which provides newValue parameter
       Adds target_value scalar to the context
       */
  onInput?: ChangeEventHandler;

  /**
       Change event handler
       Uses ChangeEventHandler which provides newValue parameter
       Adds target_value scalar to the context
       */
  onChange?: ChangeEventHandler;

  /**
       Checkbox change event handler
       Adds target_checked scalar to the context
       */
  onCheckboxChange?: CheckboxEventHandler;

  /**
       Paste event handler
       Adds pasted_text scalar to the context
       */
  onPaste?: ClipboardEventHandler;

  onVisibilityChange?: HelperEventHandler;
}

// All the WAI-ARIA 1.1 attributes from https://www.w3.org/TR/wai-aria-1.1/
export interface AriaAttributes {
  /** Identifies the currently active element when DOM focus is on a composite widget, textbox, group, or application. */
  "aria-activedescendant"?: StringExpr;
  /** Indicates whether assistive technologies will present all, or only parts of, the changed region based on the change notifications defined by the aria-relevant attribute. */
  "aria-atomic"?: Booleanish;
  /**
       Indicates whether inputting text could trigger display of one or more predictions of the user's intended value for an input and specifies how predictions would be
       presented if they are made.
       */
  "aria-autocomplete"?: EnumExpr<"none" | "inline" | "list" | "both">;
  /** Indicates an element is being modified and that assistive technologies MAY want to wait until the modifications are complete before exposing them to the user. */
  "aria-busy"?: Booleanish;
  /**
       Indicates the current "checked" state of checkboxes, radio buttons, and other widgets.
       @see aria-pressed @see aria-selected.
       */
  "aria-checked"?: BooleanExpr | EnumExpr<"false" | "mixed" | "true">;
  /**
       Defines the total number of columns in a table, grid, or treegrid.
       @see aria-colindex.
       */
  "aria-colcount"?: NumericExpr;
  /**
       Defines an element's column index or position with respect to the total number of columns within a table, grid, or treegrid.
       @see aria-colcount @see aria-colspan.
       */
  "aria-colindex"?: NumericExpr;
  /**
       Defines the number of columns spanned by a cell or gridcell within a table, grid, or treegrid.
       @see aria-colindex @see aria-rowspan.
       */
  "aria-colspan"?: NumericExpr;
  /**
       Identifies the element (or elements) whose contents or presence are controlled by the current element.
       @see aria-owns.
       */
  "aria-controls"?: StringExpr;
  /** Indicates the element that represents the current item within a container or set of related elements. */
  "aria-current"?:
    | BooleanExpr
    | EnumExpr<
      "false" | "true" | "page" | "step" | "location" | "date" | "time"
    >;
  /**
       Identifies the element (or elements) that describes the object.
       @see aria-labelledby
       */
  "aria-describedby"?: StringExpr;
  /**
       Identifies the element that provides a detailed, extended description for the object.
       @see aria-describedby.
       */
  "aria-details"?: StringExpr;
  /**
       Indicates that the element is perceivable but disabled, so it is not editable or otherwise operable.
       @see aria-hidden @see aria-readonly.
       */
  "aria-disabled"?: Booleanish;
  /**
       Indicates what functions can be performed when a dragged object is released on the drop target.
       @deprecated in ARIA 1.1
       */
  "aria-dropeffect"?: EnumExpr<
    "none" | "copy" | "execute" | "link" | "move" | "popup"
  >;
  /**
       Identifies the element that provides an error message for the object.
       @see aria-invalid @see aria-describedby.
       */
  "aria-errormessage"?: StringExpr;
  /** Indicates whether the element, or another grouping element it controls, is currently expanded or collapsed. */
  "aria-expanded"?: Booleanish;
  /**
       Identifies the next element (or elements) in an alternate reading order of content which, at the user's discretion,
       allows assistive technology to override the general default of reading in document source order.
       */
  "aria-flowto"?: StringExpr;
  /**
       Indicates an element's "grabbed" state in a drag-and-drop operation.
       @deprecated in ARIA 1.1
       */
  "aria-grabbed"?: Booleanish;
  /** Indicates the availability and type of interactive popup element, such as menu or dialog, that can be triggered by an element. */
  "aria-haspopup"?:
    | BooleanExpr
    | EnumExpr<
      "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog"
    >;
  /**
       Indicates whether the element is exposed to an accessibility API.
       @see aria-disabled.
       */
  "aria-hidden"?: Booleanish;
  /**
       Indicates the entered value does not conform to the format expected by the application.
       @see aria-errormessage.
       */
  "aria-invalid"?:
    | BooleanExpr
    | EnumExpr<"false" | "true" | "grammar" | "spelling">;
  /** Indicates keyboard shortcuts that an author has implemented to activate or give focus to an element. */
  "aria-keyshortcuts"?: StringExpr;
  /**
       Defines a string value that labels the current element.
       @see aria-labelledby.
       */
  "aria-label"?: StringExpr;
  /**
       Identifies the element (or elements) that labels the current element.
       @see aria-describedby.
       */
  "aria-labelledby"?: StringExpr;
  /** Defines the hierarchical level of an element within a structure. */
  "aria-level"?: NumericExpr;
  /** Indicates that an element will be updated, and describes the types of updates the user agents, assistive technologies, and user can expect from the live region. */
  "aria-live"?: EnumExpr<"off" | "assertive" | "polite">;
  /** Indicates whether an element is modal when displayed. */
  "aria-modal"?: Booleanish;
  /** Indicates whether a text box accepts multiple lines of input or only a single line. */
  "aria-multiline"?: Booleanish;
  /** Indicates that the user may select more than one item from the current selectable descendants. */
  "aria-multiselectable"?: Booleanish;
  /** Indicates whether the element's orientation is horizontal, vertical, or unknown/ambiguous. */
  "aria-orientation"?: EnumExpr<"horizontal" | "vertical">;
  /**
       Identifies an element (or elements) in order to define a visual, functional, or contextual parent/child relationship
       between DOM elements where the DOM hierarchy cannot be used to represent the relationship.
       @see aria-controls.
       */
  "aria-owns"?: StringExpr;
  /**
       Defines a short hint (a word or short phrase) intended to aid the user with data entry when the control has no value.
       A hint could be a sample value or a brief description of the expected format.
       */
  "aria-placeholder"?: StringExpr;
  /**
       Defines an element's number or position in the current set of listitems or treeitems. Not required if all elements in the set are present in the DOM.
       @see aria-setsize.
       */
  "aria-posinset"?: NumericExpr;
  /**
       Indicates the current "pressed" state of toggle buttons.
       @see aria-checked @see aria-selected.
       */
  "aria-pressed"?: BooleanExpr | EnumExpr<"false" | "mixed" | "true">;
  /**
       Indicates that the element is not editable, but is otherwise operable.
       @see aria-disabled.
       */
  "aria-readonly"?: Booleanish;
  /**
       Indicates what notifications the user agent will trigger when the accessibility tree within a live region is modified.
       @see aria-atomic.
       */
  "aria-relevant"?: EnumExpr<
    | "additions"
    | "additions removals"
    | "additions text"
    | "all"
    | "removals"
    | "removals additions"
    | "removals text"
    | "text"
    | "text additions"
    | "text removals"
  >;
  /** Indicates that user input is required on the element before a form may be submitted. */
  "aria-required"?: Booleanish;
  /** Defines a human-readable, author-localized description for the role of an element. */
  "aria-roledescription"?: StringExpr;
  /**
       Defines the total number of rows in a table, grid, or treegrid.
       @see aria-rowindex.
       */
  "aria-rowcount"?: NumericExpr;
  /**
       Defines an element's row index or position with respect to the total number of rows within a table, grid, or treegrid.
       @see aria-rowcount @see aria-rowspan.
       */
  "aria-rowindex"?: NumericExpr;
  /**
       Defines the number of rows spanned by a cell or gridcell within a table, grid, or treegrid.
       @see aria-rowindex @see aria-colspan.
       */
  "aria-rowspan"?: NumericExpr;
  /**
       Indicates the current "selected" state of various widgets.
       @see aria-checked @see aria-pressed.
       */
  "aria-selected"?: Booleanish;
  /**
       Defines the number of items in the current set of listitems or treeitems. Not required if all elements in the set are present in the DOM.
       @see aria-posinset.
       */
  "aria-setsize"?: NumericExpr;
  /** Indicates if items in a table or grid are sorted in ascending or descending order. */
  "aria-sort"?: EnumExpr<"none" | "ascending" | "descending" | "other">;
  /** Defines the maximum allowed value for a range widget. */
  "aria-valuemax"?: NumericExpr;
  /** Defines the minimum allowed value for a range widget. */
  "aria-valuemin"?: NumericExpr;
  /**
       Defines the current value for a range widget.
       @see aria-valuetext.
       */
  "aria-valuenow"?: NumericExpr;
  /** Defines the human readable text alternative of aria-valuenow for a range widget. */
  "aria-valuetext"?: StringExpr;
}

// All the WAI-ARIA 1.1 role attribute values from https://www.w3.org/TR/wai-aria-1.1/#role_definitions
export type AriaRole = EnumExpr<
  | "alert"
  | "alertdialog"
  | "application"
  | "article"
  | "banner"
  | "button"
  | "cell"
  | "checkbox"
  | "columnheader"
  | "combobox"
  | "complementary"
  | "contentinfo"
  | "definition"
  | "dialog"
  | "directory"
  | "document"
  | "feed"
  | "figure"
  | "form"
  | "grid"
  | "gridcell"
  | "group"
  | "heading"
  | "img"
  | "link"
  | "list"
  | "listbox"
  | "listitem"
  | "log"
  | "main"
  | "marquee"
  | "math"
  | "menu"
  | "menubar"
  | "menuitem"
  | "menuitemcheckbox"
  | "menuitemradio"
  | "navigation"
  | "none"
  | "note"
  | "option"
  | "presentation"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "region"
  | "row"
  | "rowgroup"
  | "rowheader"
  | "scrollbar"
  | "search"
  | "searchbox"
  | "separator"
  | "slider"
  | "spinbutton"
  | "status"
  | "switch"
  | "tab"
  | "table"
  | "tablist"
  | "tabpanel"
  | "term"
  | "textbox"
  | "timer"
  | "toolbar"
  | "tooltip"
  | "tree"
  | "treegrid"
  | "treeitem"
  | AnyString
>;

export interface HTMLAttributes extends AriaAttributes, DOMAttributes {
  [key: `data-${string}`]: StringExpr | NumericExpr | BooleanExpr | undefined;

  // Standard HTML Attributes
  accessKey?: StringExpr;
  autoFocus?: BooleanExpr;
  contentEditable?: Booleanish | EnumExpr<"inherit">;
  contextMenu?: StringExpr;
  dir?: StringExpr;
  draggable?: Booleanish;
  enterKeyHint?: EnumExpr<
    "enter" | "done" | "go" | "next" | "previous" | "search" | "send"
  >;
  hidden?: BooleanExpr;
  id?: StringExpr;
  lang?: StringExpr;
  nonce?: StringExpr;
  placeholder?: StringExpr;
  slot?: StringExpr;
  spellCheck?: Booleanish;
  tabIndex?: NumericExpr;
  title?: StringExpr;
  translate?: EnumExpr<"yes" | "no">;

  // Unknown
  radioGroup?: StringExpr; // <command>, <menuitem>

  // WAI-ARIA
  role?: AriaRole;

  // RDFa Attributes
  about?: StringExpr;
  content?: StringExpr;
  datatype?: StringExpr;
  inlist?: any;
  prefix?: StringExpr;
  property?: StringExpr;
  rel?: StringExpr;
  resource?: StringExpr;
  rev?: StringExpr;
  typeof?: StringExpr;
  vocab?: StringExpr;

  // Non-standard Attributes
  autoCapitalize?: StringExpr;
  autoCorrect?: StringExpr;
  autoSave?: StringExpr;
  color?: StringExpr;
  itemProp?: StringExpr;
  itemScope?: BooleanExpr;
  itemType?: StringExpr;
  itemID?: StringExpr;
  itemRef?: StringExpr;
  results?: NumericExpr;
  security?: StringExpr;
  unselectable?: EnumExpr<"on" | "off">;

  // Living Standard
  /**
       Hints at the type of data that might be entered by the user while editing the element or its contents
       @see https://html.spec.whatwg.org/multipage/interaction.html#input-modalities:-the-inputmode-attribute
       */
  inputMode?: EnumExpr<
    "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"
  >;
  /**
       Specify that a standard HTML element should behave like a defined custom built-in element
       @see https://html.spec.whatwg.org/multipage/custom-elements.html#attr-is
       */
  is?: StringExpr;
}

// interface AllHTMLAttributes extends HTMLAttributes {
//   // Standard HTML Attributes
//   accept?: StringExpr;
//   acceptCharset?: StringExpr;
//   action?: StringExpr;
//   allowFullScreen?: BooleanExpr;
//   allowTransparency?: BooleanExpr;
//   alt?: StringExpr;
//   as?: StringExpr;
//   async?: BooleanExpr;
//   autoComplete?: StringExpr;
//   autoPlay?: BooleanExpr;
//   capture?: BooleanExpr | EnumExpr<"user" | "environment">;
//   cellPadding?: NumericExpr | StringExpr;
//   cellSpacing?: NumericExpr | StringExpr;
//   charSet?: StringExpr;
//   challenge?: StringExpr;
//   checked?: BooleanExpr;
//   cite?: StringExpr;
//   classID?: StringExpr;
//   cols?: NumericExpr;
//   colSpan?: NumericExpr;
//   controls?: BooleanExpr;
//   coords?: StringExpr;
//   crossOrigin?: CrossOrigin;
//   data?: StringExpr;
//   dateTime?: StringExpr;
//   default?: BooleanExpr;
//   defer?: BooleanExpr;
//   disabled?: BooleanExpr;
//   download?: any;
//   encType?: StringExpr;
//   form?: StringExpr;
//   formAction?: StringExpr;
//   formEncType?: StringExpr;
//   formMethod?: StringExpr;
//   formNoValidate?: BooleanExpr;
//   formTarget?: StringExpr;
//   frameBorder?: NumericExpr | StringExpr;
//   headers?: StringExpr;
//   height?: NumericExpr | StringExpr;
//   high?: NumericExpr;
//   href?: StringExpr;
//   hrefLang?: StringExpr;
//   htmlFor?: StringExpr;
//   httpEquiv?: StringExpr;
//   integrity?: StringExpr;
//   keyParams?: StringExpr;
//   keyType?: StringExpr;
//   kind?: StringExpr;
//   label?: StringExpr;
//   list?: StringExpr;
//   loop?: BooleanExpr;
//   low?: NumericExpr;
//   manifest?: StringExpr;
//   marginHeight?: NumericExpr;
//   marginWidth?: NumericExpr;
//   max?: NumericExpr | StringExpr;
//   maxLength?: NumericExpr;
//   media?: StringExpr;
//   mediaGroup?: StringExpr;
//   method?: StringExpr;
//   min?: NumericExpr | StringExpr;
//   minLength?: NumericExpr;
//   multiple?: BooleanExpr;
//   muted?: BooleanExpr;
//   name?: StringExpr;
//   noValidate?: BooleanExpr;
//   open?: BooleanExpr;
//   optimum?: NumericExpr;
//   pattern?: StringExpr;
//   placeholder?: StringExpr;
//   playsInline?: BooleanExpr;
//   poster?: StringExpr;
//   preload?: StringExpr;
//   readOnly?: BooleanExpr;
//   required?: BooleanExpr;
//   reversed?: BooleanExpr;
//   rows?: NumericExpr;
//   rowSpan?: NumericExpr;
//   sandbox?: StringExpr;
//   scope?: StringExpr;
//   scoped?: BooleanExpr;
//   scrolling?: StringExpr;
//   seamless?: BooleanExpr;
//   selected?: BooleanExpr;
//   shape?: StringExpr;
//   size?: NumericExpr;
//   sizes?: StringExpr;
//   span?: NumericExpr;
//   src?: StringExpr;
//   srcDoc?: StringExpr;
//   srcLang?: StringExpr;
//   srcSet?: StringExpr;
//   start?: NumericExpr;
//   step?: NumericExpr | StringExpr;
//   summary?: StringExpr;
//   target?: StringExpr;
//   type?: StringExpr;
//   useMap?: StringExpr;
//   value?: StringExpr | readonly StringExpr[] | NumericExpr;
//   width?: NumericExpr | StringExpr;
//   wmode?: StringExpr;
//   wrap?: StringExpr;
// }

export type HTMLAttributeReferrerPolicy = EnumExpr<
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url"
>;

export type HTMLAttributeAnchorTarget =
  | EnumExpr<"_self" | "_blank" | "_parent" | "_top">
  | StringExpr;

export interface AnchorHTMLAttributes extends HTMLAttributes {
  download?: any;
  href?: StringExpr;
  hrefLang?: StringExpr;
  media?: StringExpr;
  ping?: StringExpr;
  target?: HTMLAttributeAnchorTarget;
  type?: StringExpr;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
}

export interface AudioHTMLAttributes extends MediaHTMLAttributes {}

export interface AreaHTMLAttributes extends HTMLAttributes {
  alt?: StringExpr;
  coords?: StringExpr;
  download?: any;
  href?: StringExpr;
  hrefLang?: StringExpr;
  media?: StringExpr;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
  shape?: StringExpr;
  target?: StringExpr;
}

export interface BaseHTMLAttributes extends HTMLAttributes {
  href?: StringExpr;
  target?: StringExpr;
}

export interface BlockquoteHTMLAttributes extends HTMLAttributes {
  cite?: StringExpr;
}

export interface ButtonHTMLAttributes extends HTMLAttributes {
  disabled?: BooleanExpr;
  form?: StringExpr;
  formAction?: StringExpr;
  formEncType?: StringExpr;
  formMethod?: StringExpr;
  formNoValidate?: BooleanExpr;
  formTarget?: StringExpr;
  name?: StringExpr;
  type?: EnumExpr<"submit" | "reset" | "button">;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface CanvasHTMLAttributes extends HTMLAttributes {
  height?: NumericExpr | StringExpr;
  width?: NumericExpr | StringExpr;
}

export interface ColHTMLAttributes extends HTMLAttributes {
  span?: NumericExpr;
  width?: NumericExpr | StringExpr;
}

export interface ColgroupHTMLAttributes extends HTMLAttributes {
  span?: NumericExpr;
}

export interface DataHTMLAttributes extends HTMLAttributes {
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface DetailsHTMLAttributes extends HTMLAttributes {
  open?: BooleanExpr;
  onToggle?: HelperEventHandler;
  name?: StringExpr;
}

export interface DelHTMLAttributes extends HTMLAttributes {
  cite?: StringExpr;
  dateTime?: StringExpr;
}

export interface DialogHTMLAttributes extends HTMLAttributes {
  onCancel?: HelperEventHandler;
  onClose?: HelperEventHandler;
  open?: BooleanExpr;
}

export interface EmbedHTMLAttributes extends HTMLAttributes {
  height?: NumericExpr | StringExpr;
  src?: StringExpr;
  type?: StringExpr;
  width?: NumericExpr | StringExpr;
}

export interface FieldsetHTMLAttributes extends HTMLAttributes {
  disabled?: BooleanExpr;
  form?: StringExpr;
  name?: StringExpr;
}

export interface FormHTMLAttributes extends HTMLAttributes {
  acceptCharset?: StringExpr;
  action?: StringExpr;
  autoComplete?: StringExpr;
  encType?: StringExpr;
  method?: StringExpr;
  name?: StringExpr;
  noValidate?: BooleanExpr;
  target?: StringExpr;
}

export interface HtmlHTMLAttributes extends HTMLAttributes {
  manifest?: StringExpr;
}

export interface IframeHTMLAttributes extends HTMLAttributes {
  allow?: StringExpr;
  allowFullScreen?: BooleanExpr;
  allowTransparency?: BooleanExpr;
  /** @deprecated */
  frameBorder?: NumericExpr | StringExpr;
  height?: NumericExpr | StringExpr;
  loading?: EnumExpr<"eager" | "lazy">;
  /** @deprecated */
  marginHeight?: NumericExpr;
  /** @deprecated */
  marginWidth?: NumericExpr;
  name?: StringExpr;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
  sandbox?: StringExpr;
  /** @deprecated */
  scrolling?: StringExpr;
  seamless?: BooleanExpr;
  src?: StringExpr;
  srcDoc?: StringExpr;
  width?: NumericExpr | StringExpr;
}

export interface ImgHTMLAttributes extends HTMLAttributes {
  alt?: StringExpr;
  crossOrigin?: CrossOrigin;
  decoding?: EnumExpr<"async" | "auto" | "sync">;
  height?: NumericExpr | StringExpr;
  loading?: EnumExpr<"eager" | "lazy">;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
  sizes?: StringExpr;
  src?: StringExpr;
  srcSet?: StringExpr;
  useMap?: StringExpr;
  width?: NumericExpr | StringExpr;
}

export interface InsHTMLAttributes extends HTMLAttributes {
  cite?: StringExpr;
  dateTime?: StringExpr;
}

type HTMLInputTypeAttribute =
  | EnumExpr<
    | "button"
    | "checkbox"
    | "color"
    | "date"
    | "datetime-local"
    | "email"
    | "file"
    | "hidden"
    | "image"
    | "month"
    | "number"
    | "password"
    | "radio"
    | "range"
    | "reset"
    | "search"
    | "submit"
    | "tel"
    | "text"
    | "time"
    | "url"
    | "week"
  >
  | StringExpr;

export interface InputHTMLAttributes extends HTMLAttributes {
  accept?: StringExpr;
  alt?: StringExpr;
  autoComplete?: StringExpr;
  capture?: BooleanExpr | EnumExpr<"user" | "environment">; // https://www.w3.org/TR/html-media-capture/#the-capture-attribute
  checked?: BooleanExpr;
  disabled?: BooleanExpr;
  form?: StringExpr;
  formAction?: StringExpr;
  formEncType?: StringExpr;
  formMethod?: StringExpr;
  formNoValidate?: BooleanExpr;
  formTarget?: StringExpr;
  height?: NumericExpr | StringExpr;
  list?: StringExpr;
  max?: NumericExpr | StringExpr;
  maxLength?: NumericExpr;
  min?: NumericExpr | StringExpr;
  minLength?: NumericExpr;
  multiple?: BooleanExpr;
  name?: StringExpr;
  pattern?: StringExpr;
  placeholder?: StringExpr;
  readOnly?: BooleanExpr;
  required?: BooleanExpr;
  size?: NumericExpr;
  src?: StringExpr;
  step?: NumericExpr | StringExpr;
  type?: HTMLInputTypeAttribute;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
  width?: NumericExpr | StringExpr;

  onChange?: ChangeEventHandler;
}

export interface KeygenHTMLAttributes extends HTMLAttributes {
  challenge?: StringExpr;
  disabled?: BooleanExpr;
  form?: StringExpr;
  keyType?: StringExpr;
  keyParams?: StringExpr;
  name?: StringExpr;
}

export interface LabelHTMLAttributes extends HTMLAttributes {
  form?: StringExpr;
  htmlFor?: StringExpr;
}

export interface LiHTMLAttributes extends HTMLAttributes {
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface LinkHTMLAttributes extends HTMLAttributes {
  as?: StringExpr;
  crossOrigin?: CrossOrigin;
  fetchPriority?: EnumExpr<"high" | "low" | "auto">;
  href?: StringExpr;
  hrefLang?: StringExpr;
  integrity?: StringExpr;
  media?: StringExpr;
  imageSrcSet?: StringExpr;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
  sizes?: StringExpr;
  type?: StringExpr;
  charSet?: StringExpr;
}

export interface MapHTMLAttributes extends HTMLAttributes {
  name?: StringExpr;
}

export interface MenuHTMLAttributes extends HTMLAttributes {
  type?: StringExpr;
}

export interface MediaHTMLAttributes extends HTMLAttributes {
  autoPlay?: BooleanExpr;
  controls?: BooleanExpr;
  controlsList?: StringExpr;
  crossOrigin?: CrossOrigin;
  loop?: BooleanExpr;
  mediaGroup?: StringExpr;
  muted?: BooleanExpr;
  playsInline?: BooleanExpr;
  preload?: StringExpr;
  src?: StringExpr;
}

export interface MetaHTMLAttributes extends HTMLAttributes {
  charSet?: StringExpr;
  content?: StringExpr;
  httpEquiv?: StringExpr;
  media?: StringExpr;
  name?: StringExpr;
}

export interface MeterHTMLAttributes extends HTMLAttributes {
  form?: StringExpr;
  high?: NumericExpr;
  low?: NumericExpr;
  max?: NumericExpr | StringExpr;
  min?: NumericExpr | StringExpr;
  optimum?: NumericExpr;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface QuoteHTMLAttributes extends HTMLAttributes {
  cite?: StringExpr;
}

export interface ObjectHTMLAttributes extends HTMLAttributes {
  classID?: StringExpr;
  data?: StringExpr;
  form?: StringExpr;
  height?: NumericExpr | StringExpr;
  name?: StringExpr;
  type?: StringExpr;
  useMap?: StringExpr;
  width?: NumericExpr | StringExpr;
  wmode?: StringExpr;
}

export interface OlHTMLAttributes extends HTMLAttributes {
  reversed?: BooleanExpr;
  start?: NumericExpr;
  type?: EnumExpr<"1" | "a" | "A" | "i" | "I">;
}

export interface OptgroupHTMLAttributes extends HTMLAttributes {
  disabled?: BooleanExpr;
  label?: StringExpr;
}

export interface OptionHTMLAttributes extends HTMLAttributes {
  disabled?: BooleanExpr;
  label?: StringExpr;
  selected?: BooleanExpr;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface OutputHTMLAttributes extends HTMLAttributes {
  form?: StringExpr;
  htmlFor?: StringExpr;
  name?: StringExpr;
}

export interface ParamHTMLAttributes extends HTMLAttributes {
  name?: StringExpr;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface ProgressHTMLAttributes extends HTMLAttributes {
  max?: NumericExpr | StringExpr;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
}

export interface SlotHTMLAttributes extends HTMLAttributes {
  name?: StringExpr;
}

export interface ScriptHTMLAttributes extends HTMLAttributes {
  async?: BooleanExpr;
  /** @deprecated */
  charSet?: StringExpr;
  crossOrigin?: CrossOrigin;
  defer?: BooleanExpr;
  integrity?: StringExpr;
  noModule?: BooleanExpr;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
  src?: StringExpr;
  type?: StringExpr;
}

export interface SelectHTMLAttributes extends HTMLAttributes {
  autoComplete?: StringExpr;
  disabled?: BooleanExpr;
  form?: StringExpr;
  multiple?: BooleanExpr;
  name?: StringExpr;
  required?: BooleanExpr;
  size?: NumericExpr;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
  onChange?: ChangeEventHandler;
}

export interface SourceHTMLAttributes extends HTMLAttributes {
  height?: NumericExpr | StringExpr;
  media?: StringExpr;
  sizes?: StringExpr;
  src?: StringExpr;
  srcSet?: StringExpr;
  type?: StringExpr;
  width?: NumericExpr | StringExpr;
}

export interface StyleHTMLAttributes extends HTMLAttributes {
  media?: StringExpr;
  scoped?: BooleanExpr;
  type?: StringExpr;
}

export interface TableHTMLAttributes extends HTMLAttributes {
  cellPadding?: NumericExpr | StringExpr;
  cellSpacing?: NumericExpr | StringExpr;
  summary?: StringExpr;
  width?: NumericExpr | StringExpr;
}

export interface TextareaHTMLAttributes extends HTMLAttributes {
  autoComplete?: StringExpr;
  cols?: NumericExpr;
  dirName?: StringExpr;
  disabled?: BooleanExpr;
  form?: StringExpr;
  maxLength?: NumericExpr;
  minLength?: NumericExpr;
  name?: StringExpr;
  placeholder?: StringExpr;
  readOnly?: BooleanExpr;
  required?: BooleanExpr;
  rows?: NumericExpr;
  value?: StringExpr | readonly StringExpr[] | NumericExpr;
  wrap?: StringExpr;

  onChange?: ChangeEventHandler;
}

export interface TdHTMLAttributes extends HTMLAttributes {
  align?: EnumExpr<"left" | "center" | "right" | "justify" | "char">;
  colSpan?: NumericExpr;
  headers?: StringExpr;
  rowSpan?: NumericExpr;
  scope?: StringExpr;
  abbr?: StringExpr;
  height?: NumericExpr | StringExpr;
  width?: NumericExpr | StringExpr;
  valign?: EnumExpr<"top" | "middle" | "bottom" | "baseline">;
}

export interface ThHTMLAttributes extends HTMLAttributes {
  align?: EnumExpr<"left" | "center" | "right" | "justify" | "char">;
  colSpan?: NumericExpr;
  headers?: StringExpr;
  rowSpan?: NumericExpr;
  scope?: StringExpr;
  abbr?: StringExpr;
}

export interface TimeHTMLAttributes extends HTMLAttributes {
  dateTime?: StringExpr;
}

export interface TrackHTMLAttributes extends HTMLAttributes {
  default?: BooleanExpr;
  kind?: StringExpr;
  label?: StringExpr;
  src?: StringExpr;
  srcLang?: StringExpr;
}

export interface VideoHTMLAttributes extends MediaHTMLAttributes {
  height?: NumericExpr | StringExpr;
  playsInline?: BooleanExpr;
  poster?: StringExpr;
  width?: NumericExpr | StringExpr;
  disablePictureInPicture?: BooleanExpr;
  disableRemotePlayback?: BooleanExpr;
}

export interface WebViewHTMLAttributes extends HTMLAttributes {
  allowFullScreen?: BooleanExpr;
  allowpopups?: BooleanExpr;
  autosize?: BooleanExpr;
  blinkblocks?: StringExpr;
  disableblinkblocks?: StringExpr;
  disableguestresize?: BooleanExpr;
  disablewebsecurity?: BooleanExpr;
  guestinstance?: StringExpr;
  httpreferrer?: StringExpr;
  nodeintegration?: BooleanExpr;
  partition?: StringExpr;
  plugins?: BooleanExpr;
  preload?: StringExpr;
  src?: StringExpr;
  useragent?: StringExpr;
  webpreferences?: StringExpr;
}

export interface SVGAttributes extends AriaAttributes, DOMAttributes {
  color?: StringExpr;
  height?: NumericExpr | StringExpr;
  id?: StringExpr;
  lang?: StringExpr;
  max?: NumericExpr | StringExpr;
  media?: StringExpr;
  method?: StringExpr;
  min?: NumericExpr | StringExpr;
  name?: StringExpr;
  target?: StringExpr;
  type?: StringExpr;
  width?: NumericExpr | StringExpr;

  // Other HTML properties supported by SVG elements in browsers
  role?: AriaRole;
  tabIndex?: NumericExpr;
  crossOrigin?: CrossOrigin;

  // SVG Specific attributes
  accentHeight?: NumericExpr | StringExpr;
  accumulate?: EnumExpr<"none" | "sum">;
  additive?: EnumExpr<"replace" | "sum">;
  alignmentBaseline?: EnumExpr<
    | "auto"
    | "baseline"
    | "before-edge"
    | "text-before-edge"
    | "middle"
    | "central"
    | "after-edge"
    | "text-after-edge"
    | "ideographic"
    | "alphabetic"
    | "hanging"
    | "mathematical"
    | "inherit"
  >;
  allowReorder?: EnumExpr<"no" | "yes">;
  alphabetic?: NumericExpr | StringExpr;
  amplitude?: NumericExpr | StringExpr;
  arabicForm?: EnumExpr<"initial" | "medial" | "terminal" | "isolated">;
  ascent?: NumericExpr | StringExpr;
  attributeName?: StringExpr;
  attributeType?: StringExpr;
  autoReverse?: Booleanish;
  azimuth?: NumericExpr | StringExpr;
  baseFrequency?: NumericExpr | StringExpr;
  baselineShift?: NumericExpr | StringExpr;
  baseProfile?: NumericExpr | StringExpr;
  bbox?: NumericExpr | StringExpr;
  begin?: NumericExpr | StringExpr;
  bias?: NumericExpr | StringExpr;
  by?: NumericExpr | StringExpr;
  calcMode?: NumericExpr | StringExpr;
  capHeight?: NumericExpr | StringExpr;
  clip?: NumericExpr | StringExpr;
  clipPath?: StringExpr;
  clipPathUnits?: NumericExpr | StringExpr;
  clipRule?: NumericExpr | StringExpr;
  colorInterpolation?: NumericExpr | StringExpr;
  colorInterpolationFilters?: EnumExpr<
    "auto" | "sRGB" | "linearRGB" | "inherit"
  >;
  colorProfile?: NumericExpr | StringExpr;
  colorRendering?: NumericExpr | StringExpr;
  contentScriptType?: NumericExpr | StringExpr;
  contentStyleType?: NumericExpr | StringExpr;
  cursor?: NumericExpr | StringExpr;
  cx?: NumericExpr | StringExpr;
  cy?: NumericExpr | StringExpr;
  d?: StringExpr;
  decelerate?: NumericExpr | StringExpr;
  descent?: NumericExpr | StringExpr;
  diffuseConstant?: NumericExpr | StringExpr;
  direction?: NumericExpr | StringExpr;
  display?: NumericExpr | StringExpr;
  divisor?: NumericExpr | StringExpr;
  dominantBaseline?: NumericExpr | StringExpr;
  dur?: NumericExpr | StringExpr;
  dx?: NumericExpr | StringExpr;
  dy?: NumericExpr | StringExpr;
  edgeMode?: NumericExpr | StringExpr;
  elevation?: NumericExpr | StringExpr;
  enableBackground?: NumericExpr | StringExpr;
  end?: NumericExpr | StringExpr;
  exponent?: NumericExpr | StringExpr;
  externalResourcesRequired?: Booleanish;
  fill?: StringExpr;
  fillOpacity?: NumericExpr | StringExpr;
  fillRule?: EnumExpr<"nonzero" | "evenodd" | "inherit">;
  filter?: StringExpr;
  filterRes?: NumericExpr | StringExpr;
  filterUnits?: NumericExpr | StringExpr;
  floodColor?: NumericExpr | StringExpr;
  floodOpacity?: NumericExpr | StringExpr;
  focusable?: Booleanish | EnumExpr<"auto">;
  fontFamily?: StringExpr;
  fontSize?: NumericExpr | StringExpr;
  fontSizeAdjust?: NumericExpr | StringExpr;
  fontStretch?: NumericExpr | StringExpr;
  fontStyle?: NumericExpr | StringExpr;
  fontVariant?: NumericExpr | StringExpr;
  fontWeight?: NumericExpr | StringExpr;
  format?: NumericExpr | StringExpr;
  fr?: NumericExpr | StringExpr;
  from?: NumericExpr | StringExpr;
  fx?: NumericExpr | StringExpr;
  fy?: NumericExpr | StringExpr;
  g1?: NumericExpr | StringExpr;
  g2?: NumericExpr | StringExpr;
  glyphName?: NumericExpr | StringExpr;
  glyphOrientationHorizontal?: NumericExpr | StringExpr;
  glyphOrientationVertical?: NumericExpr | StringExpr;
  glyphRef?: NumericExpr | StringExpr;
  gradientTransform?: StringExpr;
  gradientUnits?: StringExpr;
  hanging?: NumericExpr | StringExpr;
  horizAdvX?: NumericExpr | StringExpr;
  horizOriginX?: NumericExpr | StringExpr;
  href?: StringExpr;
  ideographic?: NumericExpr | StringExpr;
  imageRendering?: NumericExpr | StringExpr;
  in2?: NumericExpr | StringExpr;
  in?: StringExpr;
  intercept?: NumericExpr | StringExpr;
  k1?: NumericExpr | StringExpr;
  k2?: NumericExpr | StringExpr;
  k3?: NumericExpr | StringExpr;
  k4?: NumericExpr | StringExpr;
  k?: NumericExpr | StringExpr;
  kernelMatrix?: NumericExpr | StringExpr;
  kernelUnitLength?: NumericExpr | StringExpr;
  kerning?: NumericExpr | StringExpr;
  keyPoints?: NumericExpr | StringExpr;
  keySplines?: NumericExpr | StringExpr;
  keyTimes?: NumericExpr | StringExpr;
  lengthAdjust?: NumericExpr | StringExpr;
  letterSpacing?: NumericExpr | StringExpr;
  lightingColor?: NumericExpr | StringExpr;
  limitingConeAngle?: NumericExpr | StringExpr;
  local?: NumericExpr | StringExpr;
  markerEnd?: StringExpr;
  markerHeight?: NumericExpr | StringExpr;
  markerMid?: StringExpr;
  markerStart?: StringExpr;
  markerUnits?: NumericExpr | StringExpr;
  markerWidth?: NumericExpr | StringExpr;
  mask?: StringExpr;
  maskContentUnits?: NumericExpr | StringExpr;
  maskUnits?: NumericExpr | StringExpr;
  mathematical?: NumericExpr | StringExpr;
  mode?: NumericExpr | StringExpr;
  numOctaves?: NumericExpr | StringExpr;
  offset?: NumericExpr | StringExpr;
  opacity?: NumericExpr | StringExpr;
  operator?: NumericExpr | StringExpr;
  order?: NumericExpr | StringExpr;
  orient?: NumericExpr | StringExpr;
  orientation?: NumericExpr | StringExpr;
  origin?: NumericExpr | StringExpr;
  overflow?: NumericExpr | StringExpr;
  overlinePosition?: NumericExpr | StringExpr;
  overlineThickness?: NumericExpr | StringExpr;
  paintOrder?: NumericExpr | StringExpr;
  panose1?: NumericExpr | StringExpr;
  path?: StringExpr;
  pathLength?: NumericExpr | StringExpr;
  patternContentUnits?: StringExpr;
  patternTransform?: NumericExpr | StringExpr;
  patternUnits?: StringExpr;
  pointerEvents?: NumericExpr | StringExpr;
  points?: StringExpr;
  pointsAtX?: NumericExpr | StringExpr;
  pointsAtY?: NumericExpr | StringExpr;
  pointsAtZ?: NumericExpr | StringExpr;
  preserveAlpha?: Booleanish;
  preserveAspectRatio?: StringExpr;
  primitiveUnits?: NumericExpr | StringExpr;
  r?: NumericExpr | StringExpr;
  radius?: NumericExpr | StringExpr;
  refX?: NumericExpr | StringExpr;
  refY?: NumericExpr | StringExpr;
  renderingIntent?: NumericExpr | StringExpr;
  repeatCount?: NumericExpr | StringExpr;
  repeatDur?: NumericExpr | StringExpr;
  requiredExtensions?: NumericExpr | StringExpr;
  requiredBlocks?: NumericExpr | StringExpr;
  restart?: NumericExpr | StringExpr;
  result?: StringExpr;
  rotate?: NumericExpr | StringExpr;
  rx?: NumericExpr | StringExpr;
  ry?: NumericExpr | StringExpr;
  scale?: NumericExpr | StringExpr;
  seed?: NumericExpr | StringExpr;
  shapeRendering?: NumericExpr | StringExpr;
  slope?: NumericExpr | StringExpr;
  spacing?: NumericExpr | StringExpr;
  specularConstant?: NumericExpr | StringExpr;
  specularExponent?: NumericExpr | StringExpr;
  speed?: NumericExpr | StringExpr;
  spreadMethod?: StringExpr;
  startOffset?: NumericExpr | StringExpr;
  stdDeviation?: NumericExpr | StringExpr;
  stemh?: NumericExpr | StringExpr;
  stemv?: NumericExpr | StringExpr;
  stitchTiles?: NumericExpr | StringExpr;
  stopColor?: StringExpr;
  stopOpacity?: NumericExpr | StringExpr;
  strikethroughPosition?: NumericExpr | StringExpr;
  strikethroughThickness?: NumericExpr | StringExpr;
  string?: NumericExpr | StringExpr;
  stroke?: StringExpr;
  strokeDasharray?: StringExpr | NumericExpr;
  strokeDashoffset?: StringExpr | NumericExpr;
  strokeLinecap?: EnumExpr<"butt" | "round" | "square" | "inherit">;
  strokeLinejoin?: EnumExpr<"miter" | "round" | "bevel" | "inherit">;
  strokeMiterlimit?: NumericExpr | StringExpr;
  strokeOpacity?: NumericExpr | StringExpr;
  strokeWidth?: NumericExpr | StringExpr;
  surfaceScale?: NumericExpr | StringExpr;
  systemLanguage?: NumericExpr | StringExpr;
  tableValues?: NumericExpr | StringExpr;
  targetX?: NumericExpr | StringExpr;
  targetY?: NumericExpr | StringExpr;
  textAnchor?: StringExpr;
  textDecoration?: NumericExpr | StringExpr;
  textLength?: NumericExpr | StringExpr;
  textRendering?: NumericExpr | StringExpr;
  to?: NumericExpr | StringExpr;
  transform?: StringExpr;
  u1?: NumericExpr | StringExpr;
  u2?: NumericExpr | StringExpr;
  underlinePosition?: NumericExpr | StringExpr;
  underlineThickness?: NumericExpr | StringExpr;
  unicode?: NumericExpr | StringExpr;
  unicodeBidi?: NumericExpr | StringExpr;
  unicodeRange?: NumericExpr | StringExpr;
  unitsPerEm?: NumericExpr | StringExpr;
  vAlphabetic?: NumericExpr | StringExpr;
  values?: StringExpr;
  vectorEffect?: NumericExpr | StringExpr;
  version?: StringExpr;
  vertAdvY?: NumericExpr | StringExpr;
  vertOriginX?: NumericExpr | StringExpr;
  vertOriginY?: NumericExpr | StringExpr;
  vHanging?: NumericExpr | StringExpr;
  vIdeographic?: NumericExpr | StringExpr;
  viewBox?: StringExpr;
  viewTarget?: NumericExpr | StringExpr;
  visibility?: NumericExpr | StringExpr;
  vMathematical?: NumericExpr | StringExpr;
  widths?: NumericExpr | StringExpr;
  wordSpacing?: NumericExpr | StringExpr;
  writingMode?: NumericExpr | StringExpr;
  x1?: NumericExpr | StringExpr;
  x2?: NumericExpr | StringExpr;
  x?: NumericExpr | StringExpr;
  xChannelSelector?: StringExpr;
  xHeight?: NumericExpr | StringExpr;
  xlinkActuate?: StringExpr;
  xlinkArcrole?: StringExpr;
  xlinkHref?: StringExpr;
  xlinkRole?: StringExpr;
  xlinkShow?: StringExpr;
  xlinkTitle?: StringExpr;
  xlinkType?: StringExpr;
  xmlBase?: StringExpr;
  xmlLang?: StringExpr;
  xmlns?: StringExpr;
  xmlnsXlink?: StringExpr;
  xmlSpace?: StringExpr;
  y1?: NumericExpr | StringExpr;
  y2?: NumericExpr | StringExpr;
  y?: NumericExpr | StringExpr;
  yChannelSelector?: StringExpr;
  z?: NumericExpr | StringExpr;
  zoomAndPan?: StringExpr;
}

export interface HTMLTags {
  a: AnchorHTMLAttributes;
  abbr: HTMLAttributes;
  address: HTMLAttributes;
  area: AreaHTMLAttributes;
  article: HTMLAttributes;
  aside: HTMLAttributes;
  audio: AudioHTMLAttributes;
  b: HTMLAttributes;
  base: BaseHTMLAttributes;
  bdi: HTMLAttributes;
  bdo: HTMLAttributes;
  big: HTMLAttributes;
  blockquote: BlockquoteHTMLAttributes;
  body: HTMLAttributes;
  br: HTMLAttributes;
  button: ButtonHTMLAttributes;
  canvas: CanvasHTMLAttributes;
  caption: HTMLAttributes;
  cite: HTMLAttributes;
  code: HTMLAttributes;
  col: ColHTMLAttributes;
  colgroup: ColgroupHTMLAttributes;
  data: DataHTMLAttributes;
  datalist: HTMLAttributes;
  dd: HTMLAttributes;
  del: DelHTMLAttributes;
  details: DetailsHTMLAttributes;
  dfn: HTMLAttributes;
  dialog: DialogHTMLAttributes;
  div: HTMLAttributes;
  dl: HTMLAttributes;
  dt: HTMLAttributes;
  em: HTMLAttributes;
  embed: EmbedHTMLAttributes;
  fieldset: FieldsetHTMLAttributes;
  figcaption: HTMLAttributes;
  figure: HTMLAttributes;
  footer: HTMLAttributes;
  form: FormHTMLAttributes;
  h1: HTMLAttributes;
  h2: HTMLAttributes;
  h3: HTMLAttributes;
  h4: HTMLAttributes;
  h5: HTMLAttributes;
  h6: HTMLAttributes;
  head: HTMLAttributes;
  header: HTMLAttributes;
  hgroup: HTMLAttributes;
  hr: HTMLAttributes;
  html: HtmlHTMLAttributes;
  i: HTMLAttributes;
  iframe: IframeHTMLAttributes;
  img: ImgHTMLAttributes;
  input: InputHTMLAttributes;
  ins: InsHTMLAttributes;
  kbd: HTMLAttributes;
  keygen: KeygenHTMLAttributes;
  label: LabelHTMLAttributes;
  legend: HTMLAttributes;
  li: LiHTMLAttributes;
  link: LinkHTMLAttributes;
  main: HTMLAttributes;
  map: MapHTMLAttributes;
  mark: HTMLAttributes;
  menu: MenuHTMLAttributes;
  menuitem: HTMLAttributes;
  meta: MetaHTMLAttributes;
  meter: MeterHTMLAttributes;
  nav: HTMLAttributes;
  noscript: HTMLAttributes;
  object: ObjectHTMLAttributes;
  ol: OlHTMLAttributes;
  optgroup: OptgroupHTMLAttributes;
  option: OptionHTMLAttributes;
  output: OutputHTMLAttributes;
  p: HTMLAttributes;
  param: ParamHTMLAttributes;
  picture: HTMLAttributes;
  pre: HTMLAttributes;
  progress: ProgressHTMLAttributes;
  sql: QuoteHTMLAttributes;
  rp: HTMLAttributes;
  rt: HTMLAttributes;
  ruby: HTMLAttributes;
  s: HTMLAttributes;
  samp: HTMLAttributes;
  slot: SlotHTMLAttributes;
  script: ScriptHTMLAttributes;
  section: HTMLAttributes;
  select: SelectHTMLAttributes;
  small: HTMLAttributes;
  source: SourceHTMLAttributes;
  span: HTMLAttributes;
  strong: HTMLAttributes;
  style: StyleHTMLAttributes;
  sub: HTMLAttributes;
  summary: HTMLAttributes;
  sup: HTMLAttributes;
  table: TableHTMLAttributes;
  template: HTMLAttributes;
  tbody: HTMLAttributes;
  td: TdHTMLAttributes;
  textarea: TextareaHTMLAttributes;
  tfoot: HTMLAttributes;
  th: ThHTMLAttributes;
  thead: HTMLAttributes;
  time: TimeHTMLAttributes;
  title: HTMLAttributes;
  tr: HTMLAttributes;
  track: TrackHTMLAttributes;
  u: HTMLAttributes;
  ul: HTMLAttributes;
  var: HTMLAttributes;
  video: VideoHTMLAttributes;
  wbr: HTMLAttributes;
  webview: WebViewHTMLAttributes;
}

export interface SVGTags {
  animate: SVGAttributes;
  circle: SVGAttributes;
  clipPath: SVGAttributes;
  defs: SVGAttributes;
  desc: SVGAttributes;
  ellipse: SVGAttributes;
  feBlend: SVGAttributes;
  feColorMatrix: SVGAttributes;
  feComponentTransfer: SVGAttributes;
  feComposite: SVGAttributes;
  feConvolveMatrix: SVGAttributes;
  feDiffuseLighting: SVGAttributes;
  feDisplacementMap: SVGAttributes;
  feDistantLight: SVGAttributes;
  feDropShadow: SVGAttributes;
  feFlood: SVGAttributes;
  feFuncA: SVGAttributes;
  feFuncB: SVGAttributes;
  feFuncG: SVGAttributes;
  feFuncR: SVGAttributes;
  feGaussianBlur: SVGAttributes;
  feImage: SVGAttributes;
  feMerge: SVGAttributes;
  feMergeNode: SVGAttributes;
  feMorphology: SVGAttributes;
  feOffset: SVGAttributes;
  fePointLight: SVGAttributes;
  feSpecularLighting: SVGAttributes;
  feSpotLight: SVGAttributes;
  feTile: SVGAttributes;
  feTurbulence: SVGAttributes;
  filter: SVGAttributes;
  foreignObject: SVGAttributes;
  g: SVGAttributes;
  image: SVGAttributes;
  line: SVGAttributes;
  linearGradient: SVGAttributes;
  marker: SVGAttributes;
  mask: SVGAttributes;
  metadata: SVGAttributes;
  path: SVGAttributes;
  pattern: SVGAttributes;
  polygon: SVGAttributes;
  polyline: SVGAttributes;
  radialGradient: SVGAttributes;
  rect: SVGAttributes;
  stop: SVGAttributes;
  svg: SVGAttributes;
  switch: SVGAttributes;
  symbol: SVGAttributes;
  text: SVGAttributes;
  textPath: SVGAttributes;
  tspan: SVGAttributes;
  use: SVGAttributes;
  view: SVGAttributes;
}

// deno-lint-ignore no-implicit-declare-namespace-export -- JSX global namespace members must remain ambient.
declare global {
  namespace JSX {
    export type ElementType = ((props: any) => Node) | AllTags | BuiltInType;
    interface Element extends ElementClass<any, any> {}
    interface IntrinsicElements extends HTMLTags, SVGTags {}
    // deno-lint-ignore no-empty-interface
    interface IntrinsicAttributes {}
    type ElementChildrenAttribute = {
      children: Node;
    };
  }
}

export type AllTags = keyof HTMLTags | keyof SVGTags;

export function jsxDEV<T extends ElementType, P = any>(
  type: T,
  props: P,
  _key?: string | number,
  _isStaticChildren?: boolean,
  source?: JsxDevSource,
  _self?: unknown,
): ElementClass<T, P> {
  const element = new ElementClass(type, props);
  const statementSourceOrigin = statementSourceOriginFromJsxDev(source);
  if (statementSourceOrigin !== undefined) {
    setElementStatementSourceOrigin(element, statementSourceOrigin);
  }
  return element;
}

export function Fragment(props: { children?: Node }) {
  return props.children;
}
