import { normalizeCase, upcaseFirst } from "std/inflectors";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, cssVar } from "std/style_utils";
import { Show, usePhase, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { useCurrentField, useFieldHelper, useFieldModel } from "std/form";
import { Checkbox } from "./checkbox";
import { FieldFormControl } from "./field_form_control";
import type { FieldFormControlProps } from "./field_form_control";
import { FormLabel } from "./form_label";

const styles = createStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    "--form-label-font-size": cssVar("text-sm"),
    "--form-label-margin-bottom": "0.25rem",
    sm: {
      "--form-label-margin-bottom": "0",
      "--form-label-font-size": cssVar("text-base"),
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
      gap: 2,
    },
  },
  controlWrapper: {
    display: "flex",
    flexDirection: "column",
  },
  errorText: {
    display: "flex",
    alignItems: "center",
    fontSize: "sm",
    lineHeight: "sm",
    color: "danger-500",
    marginTop: 0.75,
  },
});

interface LabelOnLeftFormFieldProps extends FieldFormControlProps {
  label?: Node;
}

/**
 A form field component that displays the label on the left side of the input.

 @category UI Component
 @param props.label - Custom label for the field. If not provided, uses the field's display name.
 @param props.field - Custom field model. If not provided, uses the current field model from context.
 @param props.id
 @param props.onChange

 @examples
 [Example](../blocks/email_templates/advanced_editor.tsx)
 */
export function LabelOnLeftFormField(props: LabelOnLeftFormFieldProps) {
  if (usePhase() === "gather") {
    return;
  }
  const fieldModel = props.field ?? useFieldModel();
  const id = props.id ?? useUniqueId();
  const helper = useFieldHelper();
  if (fieldModel.type === "Bool" && !fieldModel.enumLike) {
    return (
      <div sx={styles.root}>
        <FormLabel htmlFor={id}>
          {props.label ?? fieldModel.displayName}
        </FormLabel>
        <div sx={styles.controlWrapper}>
          <Checkbox
            variant="outlined"
            checked={helper.value}
            id={id}
            onCheckboxChange={(s) => {
              helper.setValue(s, sql`coalesce(${sql.not(helper.value)}, true)`);
              props.onChange?.(
                s,
                sql`coalesce(${sql.not(helper.value)}, true)`,
              );
            }}
          />
          <Show when={helper.hasError}>
            <div sx={styles.errorText}>{helper.error}</div>
          </Show>
        </div>
      </div>
    );
  }
  const control = <FieldFormControl {...props} id={id} sx={{}} />;
  if (!control) {
    throw new Error(
      `LabelOnLeftFormField does not handle field of type ${fieldModel.type}`,
    );
  }
  return (
    <LabelOnLeftFormFieldWrapper
      id={id}
      label={props.label ?? fieldModel.displayName}
      hasError={helper.hasError}
      error={helper.error}
      sx={props.sx}
    >
      {control}
    </LabelOnLeftFormFieldWrapper>
  );
}

interface LabelOnLeftFormFieldWrapperProps {
  id?: Sql | string;
  label?: Node;
  hasError?: BooleanExpr;
  error?: Sql;
  sx?: Style;
  children: Node;
}

/**
 * Layout-only label-on-left wrapper used by {@link LabelOnLeftFormField}.
 * Renders the label beside arbitrary `children` (the control) plus error
 * text, without owning the control itself. Reach for this when you need
 * the same left-label layout around a custom control; when label/error
 * are omitted they are pulled from the current field context.
 *
 * @category UI Component
 */
export function LabelOnLeftFormFieldWrapper(
  props: LabelOnLeftFormFieldWrapperProps,
) {
  if (usePhase() === "gather") {
    return [props.label, props.children];
  }
  const id = props.id ?? useUniqueId();
  let error = props.error;
  if (!error) {
    error = useFieldHelper().error;
  }
  let hasError = props.hasError;
  if (!hasError) {
    hasError = useFieldHelper().hasError;
  }
  let label = props.label;
  if (!label) {
    const field = useCurrentField();
    if (field.fieldModel) {
      label = field.fieldModel.displayName;
    } else {
      label = normalizeCase(field.field)
        .map((s, i) => (i === 0 ? upcaseFirst(s) : s))
        .join(" ");
    }
  }
  return (
    <div sx={props.sx ? [styles.root, props.sx] : styles.root}>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <div sx={styles.controlWrapper}>
        {props.children}
        <Show when={hasError}>
          <div sx={styles.errorText}>{error}</div>
        </Show>
      </div>
    </div>
  );
}
