import { SvgIcon } from "components/svg_icon";
import type { SvgIconBaseProps } from "components/svg_icon";
import type { OverridableComponent } from "components/utils";

/**
 * Yolm brand icon. Stroke-based mark drawn with `currentColor`, so it
 * inherits the surrounding text color.
 *
 * @category UI Component
 */
export const YolmIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: Omit<SvgIconBaseProps, "children">;
}> = (props: Omit<SvgIconBaseProps, "children">) => {
  return (
    <SvgIcon {...props} viewBox="20 -10 80 100">
      <path
        d="M30,0 C35,30 75,15 90,0 C75,15 60,15 60,80"
        strokeWidth="8"
        stroke="currentColor"
        strokeLinecap="round"
        fill="none"
      />
    </SvgIcon>
  );
};
