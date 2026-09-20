import { SvgIcon } from "components/svg_icon";
import type { SvgIconBaseProps } from "components/svg_icon";
import type { OverridableComponent } from "components/utils";

export const GeminiIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: Omit<SvgIconBaseProps, "children">;
}> = (props: Omit<SvgIconBaseProps, "children">) => {
  return (
    <SvgIcon {...props} viewBox="0 0 24 24">
      <defs>
        <linearGradient
          id="lobe-icons-gemini-fill"
          x1="0%"
          x2="68.73%"
          y1="100%"
          y2="30.395%"
        >
          <stop offset="0%" stopColor="#1C7DFF" />
          <stop offset="52.021%" stopColor="#1C69FF" />
          <stop offset="100%" stopColor="#F0DCD6" />
        </linearGradient>
      </defs>
      <path
        fill="url(#lobe-icons-gemini-fill)"
        fillRule="nonzero"
        d="M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12"
      />
    </SvgIcon>
  );
};
