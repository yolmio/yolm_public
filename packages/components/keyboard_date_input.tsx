import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import { Data } from "std/data";
import { Effect } from "std/ui";
import { system } from "std/system";
import { Input } from "./input";
import type { InputProps } from "./input";
import { getUniqueUiId, mergeEventHandler } from "./utils";

/** Display format written back into the input after a date is accepted. */
export const KEYBOARD_DATE_FORMAT = "%m/%d/%Y";

const SEPARATOR = String.raw`(?:\s*[/.-]\s*|\s+)`;

/**
 * Registers `fn.parse_keyboard_date(text)`, the lenient US-order date parser
 * behind {@link KeyboardDateInput}. Returns null for empty or invalid text.
 *
 * Accepted forms (month first, then day):
 * - `8/20/2021`, `08-20-21`, `8.20.21`, `8 20 2021` (any of `/ - .` or spaces)
 * - `8/20` and `0820` (current year)
 * - `082021` (MMDDYY) and `08202021` (MMDDYYYY)
 * - `2021-08-20` (ISO, year first)
 * - `t` or `today`, and `+N` / `-N` days from today
 *
 * Two-digit years resolve into the 100-year window ending 20 years after the
 * current year (`21` → 2021, `95` → 1995). Years before 1000, months outside
 * 1-12, and days past the end of the month are invalid.
 */
export function ensureKeyboardDateFns() {
  if (system.scalarFunctions["parse_keyboard_date"]) {
    return;
  }
  system.scalarFunction({
    name: "parse_keyboard_date",
    parameters: [{
      name: "value",
      type: { type: "String", maxLength: 65_000 },
    }],
    returnType: { type: "Date" },
    procedure: (s) => {
      s.defScalar("text", {
        type: { type: "String", maxLength: 65_000 },
        expr: sql`lower(trim(coalesce(input.value, '')))`,
      });
      s.defScalar("m", { type: "Int" });
      s.defScalar("d", { type: "Int" });
      s.defScalar("y", { type: "Int" });
      s.defScalar("year_text", { type: { type: "String", maxLength: 4 } });
      s.if(sql`text = ''`, (s) => s.return(sql.null));
      s.if(sql`text in ('t', 'today')`, (s) => s.return(sql`current_date()`));
      s.if(
        sql`regex.is_match(text, '^[+-][0-9]{1,5}$')`,
        (s) =>
          s.return(
            sql`date.add(day, (case when left(text, 1) = '-' then -1 else 1 end) * cast(substring(text, 2) as int), current_date())`,
          ),
      );
      const iso = String
        .raw`^([0-9]{4})${SEPARATOR}([0-9]{1,2})${SEPARATOR}([0-9]{1,2})$`;
      const monthDay = String
        .raw`^([0-9]{1,2})${SEPARATOR}([0-9]{1,2})(?:${SEPARATOR}([0-9]{2}|[0-9]{4}))?$`;
      s.if(sql`regex.is_match(text, ${sql.lit(iso)})`, (s) => {
        s.setScalar(
          "y",
          sql`cast(regex.capture(text, ${sql.lit(iso)}, 1) as int)`,
        );
        s.setScalar(
          "m",
          sql`cast(regex.capture(text, ${sql.lit(iso)}, 2) as int)`,
        );
        s.setScalar(
          "d",
          sql`cast(regex.capture(text, ${sql.lit(iso)}, 3) as int)`,
        );
      })
        .elseIf(sql`regex.is_match(text, ${sql.lit(monthDay)})`, (s) => {
          s.setScalar(
            "m",
            sql`cast(regex.capture(text, ${sql.lit(monthDay)}, 1) as int)`,
          );
          s.setScalar(
            "d",
            sql`cast(regex.capture(text, ${sql.lit(monthDay)}, 2) as int)`,
          );
          s.setScalar(
            "year_text",
            sql`regex.capture(text, ${sql.lit(monthDay)}, 3)`,
          );
        })
        .elseIf(
          sql`regex.is_match(text, '^[0-9]{4}$|^[0-9]{6}$|^[0-9]{8}$')`,
          (s) => {
            s.setScalar("m", sql`cast(substring(text, 1, 2) as int)`);
            s.setScalar("d", sql`cast(substring(text, 3, 2) as int)`);
            s.setScalar("year_text", sql`nullif(substring(text, 5), '')`);
          },
        )
        .else((s) => s.return(sql.null));
      s.defScalar("current_year", {
        type: "Int",
        expr: sql`cast(extract(year from current_date()) as int)`,
      });
      s.if(sql`y is null and year_text is null`, (s) => {
        s.setScalar("y", sql`current_year`);
      }).elseIf(sql`y is null and char_length(year_text) = 2`, (s) => {
        // Window: (current year - 80, current year + 20].
        s.setScalar(
          "y",
          sql`current_year / 100 * 100 + cast(year_text as int)`,
        );
        s.if(
          sql`y > current_year + 20`,
          (s) => s.setScalar("y", sql`y - 100`),
        ).elseIf(
          sql`y <= current_year - 80`,
          (s) => s.setScalar("y", sql`y + 100`),
        );
      }).elseIf(sql`y is null`, (s) => {
        s.setScalar("y", sql`cast(year_text as int)`);
      });
      s.if(
        sql`y < 1000 or m < 1 or m > 12 or d < 1`,
        (s) => s.return(sql.null),
      );
      s.if(
        sql`d > cast(extract(day from date.end_of_month(make_date(y, m, 1))) as int)`,
        (s) => s.return(sql.null),
      );
      s.return(sql`make_date(y, m, d)`);
    },
  });
}

export type KeyboardDateInputProps =
  & Omit<
    InputProps,
    "value" | "bindScalar" | "bindRecordField" | "onInput" | "onChange" | "type"
  >
  & {
    /** The current `Date` value (or null). */
    value: Sql;
    /**
     * Called on every keystroke with the parsed `Date`, or null when the text
     * is empty or not yet a valid date. The caller must store it as `value`;
     * the typed text is kept only while `value` equals the last parsed date.
     */
    onChange: (s: DomStatements, value: Sql) => unknown;
    /**
     * Called on blur and Enter, after accepted text is rewritten to
     * `MM/DD/YYYY`. `invalid` is true when non-empty text could not be parsed.
     */
    onCommit?: (s: DomStatements, value: Sql, invalid: BooleanExpr) => unknown;
  };

/**
 * Keyboard-first date entry for people typing known dates (records, forms
 * transcribed from paper). A plain text input: backspace, selection and paste
 * behave normally, with no mask, segments or picker. Text is parsed with
 * {@link ensureKeyboardDateFns} rules on every keystroke and rewritten to
 * `MM/DD/YYYY` on blur or Enter. Invalid text is kept as typed, marked
 * `aria-invalid`, and shown as an error once committed.
 *
 * @category UI Component
 */
export function KeyboardDateInput(props: KeyboardDateInputProps) {
  ensureKeyboardDateFns();
  const { value, onChange, onCommit, error, onKeyDown, onBlur, ...inputProps } =
    props;
  const id = getUniqueUiId();
  const textName = `keyboard_date_text_${id}`;
  const parsedName = `keyboard_date_parsed_${id}`;
  const showInvalidName = `keyboard_date_show_invalid_${id}`;
  const text = sql.ref(`ui.${textName}`);
  const parsed = sql.ref(`ui.${parsedName}`);
  const showInvalid = sql.ref(`ui.${showInvalidName}`);
  const formatted = (date: Sql) =>
    sql`coalesce(format.date(${date}, ${sql.lit(KEYBOARD_DATE_FORMAT)}), '')`;
  // The typed text is shown while it still describes the external value;
  // any outside change (reset, programmatic set) shows the new value instead.
  const ownsText = sql`(${value} is not distinct from ${parsed})`;
  const invalid =
    sql`${ownsText} and trim(${text}) != '' and ${parsed} is null`;
  const commit = (s: DomStatements) => {
    s.if(
      ownsText,
      (s) => {
        s.if(
          sql`${parsed} is not null`,
          (s) => s.setScalar(`ui.${textName}`, formatted(parsed)),
        );
        s.setScalar(`ui.${showInvalidName}`, invalid);
      },
      (s) => {
        s.setScalar(`ui.${textName}`, formatted(value));
        s.setScalar(`ui.${parsedName}`, value);
        s.setScalar(`ui.${showInvalidName}`, false);
      },
    );
    onCommit?.(s, parsed, invalid);
  };
  const errorExpr = sql.or(sql`${showInvalid} and ${invalid}`, error ?? false);
  return (
    <Data
      local
      procedure={(s) => {
        // Must not read `value`: Data re-runs on watched changes, which
        // would reset the text on every keystroke. Until the first edit the
        // input shows the formatted `value` (see `ownsText`).
        s.defScalar(textName, {
          type: { type: "String", maxLength: 65_000 },
          expr: sql.lit``,
        });
        s.defScalar(parsedName, { type: "Date", expr: sql.null });
        s.defScalar(showInvalidName, false);
      }}
    >
      <Effect
        watch={value}
        onChange={(s) =>
          // Drop text left over from before an outside change, so a later
          // change back to a matching value cannot show it again.
          s.if(sql`not ${ownsText}`, (s) => {
            s.setScalar(`ui.${textName}`, formatted(value));
            s.setScalar(`ui.${parsedName}`, value);
            s.setScalar(`ui.${showInvalidName}`, false);
          })}
      />
      <Input
        placeholder="MM/DD/YYYY"
        autoComplete="off"
        {...inputProps}
        type="text"
        value={sql`case when ${ownsText} then ${text} else ${
          formatted(value)
        } end`}
        error={errorExpr}
        aria-invalid={sql`case when ${invalid} then 'true' else 'false' end`}
        onInput={(s) => {
          s.setScalar(`ui.${textName}`, sql`target_value`);
          s.setScalar(
            `ui.${parsedName}`,
            sql`fn.parse_keyboard_date(target_value)`,
          );
          s.setScalar(`ui.${showInvalidName}`, false);
          onChange(s, parsed);
        }}
        onKeyDown={mergeEventHandler(
          (s: DomStatements) =>
            s.if(
              sql`event.key = 'Enter' and not event.is_composing`,
              (s) => commit(s),
            ),
          onKeyDown,
        )}
        onBlur={mergeEventHandler(commit, onBlur)}
      />
    </Data>
  );
}
