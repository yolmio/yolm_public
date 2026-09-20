import { cssVar } from "std/style_utils";
import type { Node } from "std/ui";
import { singleElementComponent } from "./utils";
import type { SingleElementComponentProps } from "./utils";
import type { OverridableComponent } from "./utils";

export interface FormHelperTextProps extends SingleElementComponentProps {
  children: Node;
}

const styles = {
  display: "flex",
  alignItems: "center",
  fontFamily: cssVar("font-family-body"),
  fontSize: `var(--form-helper-text-font-size, ${cssVar("text-sm")})`,
  lineHeight: cssVar("leading-snug"),
  color: `var(--form-helper-text-color, ${cssVar("palette-text-secondary")})`,
  marginTop: "var(--form-helper-text-margin-top, 0px)",
  "label + &": {
    "--form-helper-text-margin-top": "0px", // remove the margin if the helper text is next to the form label.
  },
};

/**
 * Small helper or error text rendered underneath a form control.
 *
 * Picks up color via the `--form-helper-text-color` CSS variable, which
 * the surrounding `FormControl` sets to the danger palette when its
 * `error` prop is truthy. Use for validation messages, format hints, or
 * character counters.
 *
 * @example
 * <FormControl error={sql`coalesce(error, '') <> ''`}>
 *   <FormLabel>Email</FormLabel>
 *   <Input bindRecordField="email" />
 *   <FormHelperText>
 *     {sql`coalesce(error, 'We will never share this')`}
 *   </FormHelperText>
 * </FormControl>
 */
export const FormHelperText: OverridableComponent<{
  defaultComponent: "div";
  props: FormHelperTextProps;
}> = (props: FormHelperTextProps) => {
  const { children, ...rest } = props;
  const [Root, rootProps] = singleElementComponent({
    component: "div",
    sx: styles,
    externalProps: rest,
  });
  return <Root {...rootProps}>{children}</Root>;
};
