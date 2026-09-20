import { sql } from "../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../std/sql_utils";
import type { DomStatements, IStatementsBase } from "std/statements";
import type { StyleObject } from "std/style_types";
import { cssVar } from "std/style_utils";
import { Effect, type Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface OneTimePasswordInputBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      input: "input";
    }> {
  digits: number;
  digitsRecord: string;
  error?: BooleanExpr;
  focusFirstImmediately?: boolean;
  onComplete?: (s: DomStatements, code: Sql) => void;
}

interface OwnerState {
  size: Size;
  color: Color;
  error: boolean;
  digits: number;
}

const root = createGatherSafeSlot("root", () => ({
  display: "flex",
  minWidth: 0,
  maxWidth: "100%",
  gap: "8px",
  justifyContent: "center",
}));

const input = createGatherSafeSlot(
  "input",
  (_, { ownerState }: { ownerState: OwnerState }) => {
    const { size, color, error } = ownerState;
    if (color === "harmonize") {
      throw new Error("harmonize color not supported");
    }
    const styles: StyleObject = {
      minWidth: 0,
      flexShrink: 1,
      width: size === "xs"
        ? "32px"
        : size === "sm"
        ? "40px"
        : size === "md"
        ? "48px"
        : "56px",
      height: size === "xs"
        ? "32px"
        : size === "sm"
        ? "40px"
        : size === "md"
        ? "48px"
        : "56px",
      fontSize: `calc(${
        size === "xs"
          ? "32px"
          : size === "sm"
          ? "40px"
          : size === "md"
          ? "48px"
          : "56px"
      } * 0.5)`,
      fontFamily: cssVar("font-family-code"),
      textAlign: "center",
      border: `1px solid ${cssVar("palette-divider")}`,
      borderRadius: cssVar("radius-sm"),
      backgroundColor: cssVar("palette-background-surface"),
      "&:focus": {
        outline: "none",
        borderColor: cssVar(`palette-${color}-500`),
        boxShadow: `0 0 0 2px ${cssVar(`palette-${color}-200`)}`,
      },
    };
    if (error) {
      styles["&.error"] = {
        borderColor: cssVar("palette-danger-500"),
        boxShadow: `0 0 0 2px ${cssVar("palette-danger-200")}`,
      };
    }
    return styles;
  },
);

export function otpDigits<T extends IStatementsBase>(
  s: T,
  name: string,
  digits: number,
) {
  const initialValues: Record<string, AnyExpr> = {};
  for (let i = 0; i < digits; i++) {
    initialValues[`digit_${i}`] = sql.null;
  }
  s.defRecord(name, {
    fields: Array.from({ length: digits }, (_, i) => ({
      name: `digit_${i}`,
      type: "TinyUint" as const,
    })),
    query: sql.fromArray([initialValues]),
  });
}

function concatOtpDigits(name: string, digits: number): Sql {
  return sql.concat(
    ...Array.from(
      { length: digits },
      (_, i) => sql`${sql.ref(name)}.digit_${i}`,
    ),
  );
}

/**
 A component for inputting one-time passwords.

 This component renders a series of input fields for entering a one-time password.
 It handles pasting the one-time password, input validation, focus management, and completion callbacks.

 @category UI Component

 @param props.digits The number of digits in the one-time password
 @param props.digitsRecord The name of the record containing the digit values
 @param props.error Whether an error state should be displayed
 @param props.focusFirstImmediately Whether to focus the first input immediately
 @param props.onComplete
 @param props.color
 @param props.size

*/
export const OneTimePasswordInput: OverridableComponent<{
  defaultComponent: "div";
  props: OneTimePasswordInputBaseProps;
}> = (props: OneTimePasswordInputBaseProps) => {
  const {
    digits,
    digitsRecord,
    error,
    focusFirstImmediately,
    onComplete,
    color = "primary",
    size = "md",
    ...rest
  } = props;
  const ownerState: OwnerState = {
    size,
    color,
    error: Boolean(error),
    digits,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    slotProps: { ownerState },
    externalProps: rest,
  });
  const inputNodes: Node[] = [];
  const record = sql.ref(digitsRecord);
  const allIsFilled = sql.and(
    ...Array.from(
      { length: digits },
      (_, i) => sql`${record}.digit_${i} is not null`,
    ),
  );
  const completedCode = concatOtpDigits(digitsRecord, digits);
  function handleInput(s: DomStatements, i: number, value: Sql) {
    for (let j = i; j < digits; j++) {
      s.if(sql`char_length(${value}) > ${j - i}`, (s) => {
        s.modify(
          sql`update ${record} set digit_${j} = try_cast(substring(${value}, ${
            j - i + 1
          }, 1) as smallint)`,
        );
      });
    }
    s.if(sql`not (${allIsFilled})`, (s) => {
      s.element(
        sql.concat("code-input-", sql`char_length(${value}) + ${i}`),
      ).focus();
    });
  }
  for (let i = 0; i < digits; i++) {
    const nextInputId = sql.concat("code-input-", i + 1);
    const prevInputId = sql.concat("code-input-", i - 1);
    const isFirstInput = i === 0;
    const isLastInput = i === digits - 1;
    const [InputSlot, inputProps] = input({
      component: "input",
      rootProps: props,
      slotProps: { ownerState },
      externalProps: {
        type: sql.lit`text`,
        inputMode: sql.lit`numeric`,
        pattern: sql.lit`[0-9]*`,
        yolmFocusKey: focusFirstImmediately && i === 0 ? sql.true : sql.null,
        autoComplete: i === 0 ? sql.lit`one-time-code` : sql.lit`off`,
        // Android doesn't paste, instead for otp codes it will just trigger an input event
        // setting the value to the code... so we don't do maxLength 1
        maxLength: 6,
        id: sql.lit`code-input-${i}`,
        value: sql`${record}.digit_${i}`,
      },
      internalProps: {
        dynamicClasses: error
          ? [{ classes: "error", condition: error }]
          : undefined,
        onKeyDown: (s: DomStatements) => {
          s.switchKeyboardEvent({
            "backspace delete": (s) => {
              s.event.preventDefault();
              s.conditional({
                condition: sql`${record}.digit_${i} is not null`,
                then: (s) => {
                  s.modify(sql`update ${record} set digit_${i} = null`);
                  if (!isFirstInput) {
                    s.element(prevInputId).focus();
                  }
                },
                else: (s) => {
                  if (!isFirstInput) {
                    s.modify(
                      sql`update ${record} set digit_${i - 1} = null`,
                    );
                    s.element(prevInputId).focus();
                  }
                },
              });
            },
            "arrowright tab": (s) => {
              if (!isLastInput) {
                s.event.preventDefault();
                s.element(nextInputId).focus();
              }
            },
            "arrowleft shift+tab": (s) => {
              if (!isFirstInput) {
                s.event.preventDefault();
                s.element(prevInputId).focus();
              }
            },
            "regex:^[0-9]$": (s) => {
              // Always prevent default to avoid DOM value accumulation,
              // then handle the digit write manually
              s.event.preventDefault();
              s.conditional({
                condition: sql`${record}.digit_${i} is not null`,
                then: (s) => {
                  if (!isLastInput) {
                    handleInput(s, i + 1, sql`event.key`);
                  }
                },
                else: (s) => {
                  handleInput(s, i, sql`event.key`);
                },
              });
            },
            "not_regex:^[0-9]$": (s) => {
              s.event.preventDefault();
            },
          });
        },
        onInput: (s: DomStatements) => {
          handleInput(s, i, sql`target_value`);
        },
        onChange: (s: DomStatements) => {
          handleInput(s, i, sql`target_value`);
        },
        onPaste: (s: DomStatements) => {
          s.event.preventDefault();
          s.defScalar("actual_pasted_text", sql`pasted_text`);
          s.if(
            sql`actual_pasted_text is null or actual_pasted_text = ''`,
            (s) => {
              s.clipboard.readText("clipboard_text");
              s.setScalar("actual_pasted_text", sql`clipboard_text`);
            },
          );
          s.defScalar(
            "cleaned_text",
            sql`left(regex.replace_all(actual_pasted_text, '[^0-9]', ''), ${
              digits - i
            })`,
          );
          handleInput(s, i, sql`cleaned_text`);
        },
      },
    });
    inputNodes.push(<InputSlot {...inputProps} />);
  }
  return (
    <RootSlot {...rootProps}>
      {inputNodes}
      {onComplete && (
        <Effect
          watch={completedCode}
          onChange={(s) => {
            s.if(allIsFilled, (s) => onComplete(s, completedCode));
          }}
        />
      )}
    </RootSlot>
  );
};
