import { sql } from "../std/sql_utils";
import { createStyles } from "std/style_utils";
import { Show, usePhase, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { useFieldHelper, useFieldModel } from "std/form";
import { Checkbox } from "./checkbox";
import { FieldFormControl } from "./field_form_control";
import type { FieldFormControlProps } from "./field_form_control";
import { FormControl } from "./form_control";
import { FormHelperText } from "./form_helper_text";
import { FormLabel } from "./form_label";

const styles = createStyles({
  errorText: {
    display: "flex",
    alignItems: "center",
    fontSize: "sm",
    lineHeight: "sm",
    color: "danger-500",
    mt: 0.75,
  },
});

export interface LabelOnTopFormFieldProps extends FieldFormControlProps {
  label?: Node;
  helperText?: Node;
  errorTextColor?: string;
}

/**
 A form field component that displays the label on top of the input.

 @category UI Component
 @param props.label Custom label for the field. If not provided, uses the field's display name.
 @param props.field Custom field model. If not provided, uses the current field model from context.
 @param props.id
 @param props.onChange
 @param props.sx

 @examples
 [Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
 */
export function LabelOnTopFormField(props: LabelOnTopFormFieldProps) {
  if (usePhase() === "gather") {
    return;
  }
  const fieldModel = props.field ?? useFieldModel();
  const id = props.id ?? useUniqueId();
  const helper = useFieldHelper();
  if (fieldModel.type === "Bool" && !fieldModel.enumLike) {
    return (
      <FormControl sx={props.sx} inputId={id}>
        <FormLabel htmlFor={id} required={props.required}>
          {props.label ?? fieldModel.displayName}
        </FormLabel>
        <Checkbox
          variant="outlined"
          checked={helper.value}
          id={id}
          onCheckboxChange={(s) => {
            helper.setValue(s, sql`coalesce(${sql.not(helper.value)}, true)`);
            props.onChange?.(s, sql`coalesce(${sql.not(helper.value)}, true)`);
          }}
        />
        <Show when={helper.hasError}>
          <div
            sx={{
              ...styles.errorText,
              ...(props.errorTextColor ? { color: props.errorTextColor } : {}),
            }}
          >
            {helper.error}
          </div>
        </Show>
      </FormControl>
    );
  }
  const control = <FieldFormControl {...props} id={id} sx={{}} />;
  if (!control) {
    throw new Error(
      `LabelOnTopFormField does not handle field of type ${fieldModel.type}`,
    );
  }
  return (
    <FormControl sx={props.sx} inputId={id}>
      <FormLabel htmlFor={id} required={props.required}>
        {props.label ?? fieldModel.displayName}
      </FormLabel>
      {control}
      <Show when={helper.hasError}>
        <div
          sx={{
            ...styles.errorText,
            ...(props.errorTextColor ? { color: props.errorTextColor } : {}),
          }}
        >
          {helper.error}
        </div>
      </Show>
      {props.helperText && <FormHelperText>{props.helperText}</FormHelperText>}
    </FormControl>
  );
}
