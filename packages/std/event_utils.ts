import type { BasicStatements, DomStatements } from "./statements";
import type { DomStatementsOrFn } from "./statements";
import { sql } from "./sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "./sql_utils";
import type * as yom from "./yom";

// Event handler options that can be passed along with the handler
export interface EventHandlerOptions {
  detachedFromNode?: boolean;
  disableAutoUiCommit?: boolean;
}

// Direct EventHandlerObject format (like yom.EventHandlerObject but with DomStatementsOrFn)
export interface EventHandlerObjectDirect extends EventHandlerOptions {
  procedure: DomStatementsOrFn;
}

// Generic event handler type factory
type EventHandlerWithOptions<T extends (...args: any[]) => void> =
  | T
  | (Omit<yom.EventHandlerObject, "procedure"> & {
    procedure: DomStatementsOrFn;
  })
  | BasicStatements
  | DomStatements;

// Base event handler types
export type ChangeEventHandler = EventHandlerWithOptions<
  (s: DomStatements, newValue: AnyExpr) => void
>;
export type ChangeEventHandlerFn = (
  s: DomStatements,
  newValue: AnyExpr,
) => void;
// Specialized event handler types for better type safety
export type MouseEventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: MouseEventObject) => void
>;
export type KeyboardEventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: KeyboardEventObject) => void
>;
export type FocusEventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: FocusEventObject) => void
>;
export type ClipboardEventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: ClipboardEventObject) => void
>;
export type FileEventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: FileEventObject) => void
>;
export type FormEventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: FormEventObject) => void
>;
export type InputEventHandler = EventHandlerWithOptions<
  (s: DomStatements, newValue: AnyExpr) => void
>;
export type CheckboxEventHandler = EventHandlerWithOptions<
  (s: DomStatements, newValue: BooleanExpr) => void
>;

// Generic event handler (kept for backward compatibility)
export type EventHandler = EventHandlerWithOptions<
  (s: DomStatements, e: EventObject) => void
>;

/**
 * Base event object with common properties
 */
export interface BaseEventObject {
  // Common modifier keys
  readonly ctrlKey: BooleanExpr;
  readonly shiftKey: BooleanExpr;
  readonly altKey: BooleanExpr;
  readonly metaKey: BooleanExpr;
}

/**
 * Mouse event object with all mouse-related properties
 */
export interface MouseEventObject extends BaseEventObject {
  // Mouse position
  readonly clientX: NumericExpr;
  readonly clientY: NumericExpr;
  readonly pageX: NumericExpr;
  readonly pageY: NumericExpr;
  readonly screenX: NumericExpr;
  readonly screenY: NumericExpr;
  readonly offsetX: NumericExpr;
  readonly offsetY: NumericExpr;

  // Mouse buttons
  readonly button: NumericExpr;
  readonly buttons: NumericExpr;

  // Mouse movement (for drag events)
  readonly movementX: NumericExpr;
  readonly movementY: NumericExpr;
}

/**
 * Keyboard event object with keyboard-specific properties
 */
export interface KeyboardEventObject extends BaseEventObject {
  readonly key: Sql;
  readonly code: Sql;
  readonly repeat: BooleanExpr;
}

/**
 * Focus event object (minimal properties)
 */
export interface FocusEventObject extends BaseEventObject {
  // Focus events typically don't have additional properties
}

/**
 * Clipboard event object
 */
export interface ClipboardEventObject extends BaseEventObject {
  readonly pastedText: Sql;
}

/**
 * File event object for file input changes
 */
export interface FileEventObject extends BaseEventObject {
  // Access to the file table with fields: uuid, type, name, last_modified, size
  readonly files: Sql; // Reference to ui.file table
}

/**
 * Form event object
 */
export interface FormEventObject extends BaseEventObject {
  // Form events in Yolm don't have additional properties
}

/**
 * Input event object
 */
export interface InputEventObject extends BaseEventObject {
  readonly targetValue: Sql;
}

/**
 * Checkbox event object
 */
export interface CheckboxEventObject extends BaseEventObject {
  readonly targetChecked: BooleanExpr;
}

/**
 * General event object that includes all possible properties
 * Used when you need access to all event properties
 */
export interface EventObject
  extends
    MouseEventObject,
    KeyboardEventObject,
    ClipboardEventObject,
    FormEventObject,
    InputEventObject,
    CheckboxEventObject {
  // File events have a different pattern (table instead of scalar)
  readonly files?: Sql;
}

/**
 * Helper to create base event object with modifier keys
 */
function createBaseEventObject(fromEvent = true): BaseEventObject {
  if (fromEvent) {
    return {
      ctrlKey: sql`event.ctrl_key`,
      shiftKey: sql`event.shift_key`,
      altKey: sql`event.alt_key`,
      metaKey: sql`event.meta_key`,
    };
  }
  return {
    ctrlKey: sql`false`,
    shiftKey: sql`false`,
    altKey: sql`false`,
    metaKey: sql`false`,
  };
}

/**
 * Creates a MouseEventObject instance with SQL expressions
 */
export function createMouseEventObject(): MouseEventObject {
  return {
    ...createBaseEventObject(true),

    // Mouse position
    clientX: sql`event.client_x`,
    clientY: sql`event.client_y`,
    pageX: sql`event.page_x`,
    pageY: sql`event.page_y`,
    screenX: sql`event.screen_x`,
    screenY: sql`event.screen_y`,
    offsetX: sql`event.offset_x`,
    offsetY: sql`event.offset_y`,

    // Mouse buttons
    button: sql`event.button`,
    buttons: sql`event.buttons`,

    // Mouse movement
    movementX: sql`event.movement_x`,
    movementY: sql`event.movement_y`,
  };
}

/**
 * Creates a KeyboardEventObject instance with SQL expressions
 */
export function createKeyboardEventObject(): KeyboardEventObject {
  return {
    ctrlKey: sql`event.ctrl_key`,
    shiftKey: sql`event.shift_key`,
    altKey: sql`event.alt_key`,
    metaKey: sql`event.meta_key`,
    key: sql`event.key`,
    code: sql`event.code`,
    repeat: sql`event.repeat`,
  };
}

/**
 * Creates a FocusEventObject instance
 */
export function createFocusEventObject(): FocusEventObject {
  return createBaseEventObject(false);
}

/**
 * Creates a ClipboardEventObject instance
 */
export function createClipboardEventObject(): ClipboardEventObject {
  return {
    ...createBaseEventObject(true),
    pastedText: sql`pasted_text`,
  };
}

/**
 * Creates a FileEventObject instance
 */
export function createFileEventObject(): FileEventObject {
  return {
    ...createBaseEventObject(false),
    files: sql`file`, // Reference to the file table
  };
}

/**
 * Creates a FormEventObject instance
 */
export function createFormEventObject(): FormEventObject {
  return createBaseEventObject(false);
}

/**
 * Creates an InputEventObject instance
 */
export function createInputEventObject(): InputEventObject {
  return {
    ...createBaseEventObject(false),
    targetValue: sql`target_value`,
  };
}

/**
 * Creates a CheckboxEventObject instance
 */
export function createCheckboxEventObject(): CheckboxEventObject {
  return {
    ...createBaseEventObject(false),
    targetChecked: sql`target_checked`,
  };
}

/**
 * Creates a general EventObject instance with all properties
 * This is mainly for backward compatibility
 */
export function createEventObject(): EventObject {
  return {
    // Keyboard event properties
    key: sql`event.key`,
    code: sql`event.code`,
    repeat: sql`event.repeat`,

    // Common modifier keys
    ctrlKey: sql`event.ctrl_key`,
    shiftKey: sql`event.shift_key`,
    altKey: sql`event.alt_key`,
    metaKey: sql`event.meta_key`,

    // Mouse event properties
    clientX: sql`event.client_x`,
    clientY: sql`event.client_y`,
    pageX: sql`event.page_x`,
    pageY: sql`event.page_y`,
    screenX: sql`event.screen_x`,
    screenY: sql`event.screen_y`,
    offsetX: sql`event.offset_x`,
    offsetY: sql`event.offset_y`,
    button: sql`event.button`,
    buttons: sql`event.buttons`,
    movementX: sql`event.movement_x`,
    movementY: sql`event.movement_y`,

    // Other event properties
    pastedText: sql`pasted_text`,
    targetValue: sql`target_value`,
    targetChecked: sql`target_checked`,
    files: sql`file`,
  };
}
