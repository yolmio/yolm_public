import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import { EventHandlers } from "std/ui";

/**
 * Props for {@link PageKeyboardShortcuts}. Pass the DOM ids of the
 * page's search input, add button, and edit button so the helper can
 * wire `f`/`a`/`e` shortcuts to them.
 */
interface KeyboardShortcutsProps {
  /** DOM id of the page's primary search input. Maps the `f` key to focus it. */
  pageSearchInputId?: string | Sql;
  /** DOM id of the page's "add" button. Maps the `a` key to click it. */
  pageAddButtonId?: string | Sql;
  /** DOM id of the page's "edit" button. Maps the `e` key to click it. */
  pageEditButtonId?: string | Sql;
}

const interactiveElementSelector = [
  `input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="image"])`,
  "textarea",
  "[contenteditable=true]",
  "[role=textbox]",
  "select",
].join(", ");

/**
 * Page-level keyboard shortcuts handler. Mount once near the top of a
 * page and the helper attaches global `keydown` listeners that ignore
 * key presses inside text inputs, textareas, comboboxes, etc.
 *
 * Default bindings:
 *
 * - `f` → focus `pageSearchInputId`
 * - `a` → click `pageAddButtonId`
 * - `e` → click `pageEditButtonId`
 */
export function PageKeyboardShortcuts({
  pageSearchInputId,
  pageAddButtonId,
  pageEditButtonId,
}: KeyboardShortcutsProps) {
  const keys: string[] = [];
  if (pageSearchInputId) {
    keys.push("f");
  }
  if (pageAddButtonId) {
    keys.push("a");
  }
  if (pageEditButtonId) {
    keys.push("e");
  }
  return (
    <EventHandlers
      document={{
        keydown: (s) => {
          s.returnUnless(
            sql`${
              sql.inList(
                sql`event.key`,
                keys.map((k) => sql.lit(k)),
              )
            } and not event.ctrl_key and not event.meta_key and not event.shift_key`,
          );
          s.event.getTarget("target");
          s.element(sql`target`).matches(
            sql.lit(interactiveElementSelector),
            "is_interactive",
          );
          s.returnIf(sql`is_interactive`);
          if (pageSearchInputId) {
            s.if(sql`event.key = 'f'`, (s) => {
              s.event.preventDefault();
              s.element(
                typeof pageSearchInputId === "string"
                  ? sql.lit(pageSearchInputId)
                  : pageSearchInputId,
              ).focus();
            });
          }
          if (pageAddButtonId) {
            s.if(sql`event.key = 'a'`, (s) => {
              s.event.preventDefault();
              s.element(
                typeof pageAddButtonId === "string"
                  ? sql.lit(pageAddButtonId)
                  : pageAddButtonId,
              ).click();
            });
          }
          if (pageEditButtonId) {
            s.if(sql`event.key = 'e'`, (s) => {
              s.event.preventDefault();
              s.element(
                typeof pageEditButtonId === "string"
                  ? sql.lit(pageEditButtonId)
                  : pageEditButtonId,
              ).click();
            });
          }
        },
      }}
    />
  );
}
