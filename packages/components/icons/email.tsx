import { SvgIcon } from "components/svg_icon";
import type { SvgIconBaseProps } from "components/svg_icon";
import type { OverridableComponent } from "components/utils";

export const EmailIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: Omit<SvgIconBaseProps, "children">;
}> = (props: Omit<SvgIconBaseProps, "children">) => {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
    </SvgIcon>
  );
};
