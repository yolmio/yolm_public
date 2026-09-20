import { SvgIcon } from "components/svg_icon";
import type { SvgIconBaseProps } from "components/svg_icon";
import type { OverridableComponent } from "components/utils";

export const SidebarIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: Omit<SvgIconBaseProps, "children">;
}> = (props: Omit<SvgIconBaseProps, "children">) => {
  return (
    <SvgIcon {...props} viewBox="0 0 30 30">
      <path
        d="M5 4h20a2.5 2.5 0 0 1 2.5 2.5v17.5a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5V6.5A2.5 2.5 0 0 1 5 4z"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
      />
      <path d="M11 4v22" stroke="currentColor" strokeWidth="2.5" />
    </SvgIcon>
  );
};
