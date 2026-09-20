import { FormControlICtxKey } from "std/ictx";
import { cssVar } from "std/style_utils";
import type { Sql } from "../std/sql_utils";
import { useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface FormLabelOpts extends
  SlottedComponentBaseProps<{
    root: "label";
    asterisk: "span";
  }> {
  required?: boolean;
  htmlFor?: Sql | string;
  children: Node;
}

interface OwnerState {
  required: boolean;
}

const root = createGatherSafeSlot("root", () => ({
  WebkitTapHighlightColor: "transparent",
  alignSelf: "var(--form-label-align-self)",
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  userSelect: "none",
  fontFamily: cssVar("font-family-body"),
  fontSize: `var(--form-label-font-size, ${cssVar("text-sm")})`,
  fontWeight: cssVar("font-weight-medium"),
  lineHeight: cssVar("leading-normal"),
  color: `var(--form-label-color, ${cssVar("palette-text-primary")})`,
  marginRight: "var(--form-label-margin-right, 0px)",
  marginBottom: "var(--form-label-margin-bottom, 0px)",
}));

const asterisk = createGatherSafeSlot("asterisk", () => ({
  color: "var(--form-label-asterisk-color)",
}));

/**
 A component for rendering form labels with optional required asterisk.

 @category UI Component

 @param props.required
 @param props.htmlFor - The ID of the associated form control.
 @param props.children - The label text or content.

 @examples
 [Example](../table_blocks/notes_list/notes_list_card.tsx)
 */
export const FormLabel: OverridableComponent<{
  defaultComponent: "label";
  props: FormLabelOpts;
}> = (props: FormLabelOpts) => {
  const { required, htmlFor, children, ...other } = props;

  const ownerState: OwnerState = {
    required: required ?? false,
  };
  const formControlCtx = useOptionalICtx(FormControlICtxKey);
  const [RootSlot, rootProps] = root({
    component: "label",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
    internalProps: { htmlFor: htmlFor ?? formControlCtx?.id },
  });
  const [AsteriskSlot, asteriskProps] = asterisk({
    component: "span",
    rootProps: props,
    slotProps: { ownerState },
  });
  return (
    <RootSlot {...rootProps}>
      {children}
      {required && <AsteriskSlot {...asteriskProps}>&thinsp;*</AsteriskSlot>}
    </RootSlot>
  );
};
