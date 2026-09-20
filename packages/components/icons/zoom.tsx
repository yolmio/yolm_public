import { SvgIcon } from "components/svg_icon";
import type { SvgIconBaseProps } from "components/svg_icon";
import type { OverridableComponent } from "components/utils";

export const ZoomIcon: OverridableComponent<{
  defaultComponent: "svg";
  props: Omit<SvgIconBaseProps, "children">;
}> = (props: Omit<SvgIconBaseProps, "children">) => {
  return (
    <SvgIcon {...props} viewBox="0 0 32 32">
      <style>{".N{fill:none}.O{clip-path:url(#A)}.P{clip-rule:evenodd}"}</style>
      <defs>
        <clipPath id="A">
          <path d="M-200-175H800v562H-200z" classes="N" />
        </clipPath>
        <clipPath id="B">
          <path
            d="M370 89a24 24 0 1 1-34 0 24 24 0 0 1 34 0zm-17-23a40 40 0 1 1-.05 0zm101 23a24 24 0 1 1-34 0 24 24 0 0 1 34 0zm11.3-11.3A40 40 0 1 1 437 66a40 40 0 0 1 28.28 11.72zM253 145.8l4 .2h60l-.2-4c-.54-6.6-5.2-11.4-11.8-11.8l-4-.2h-36l48-48-.2-4A12.1 12.1 0 0 0 301 66.2l-4-.2h-60l.2 4A12.41 12.41 0 0 0 249 81.8l4 .2h36l-48 48 .2 4a12.23 12.23 0 0 0 11.8 11.8zM526.84 90a17.29 17.29 0 0 1 2 8l.2 4v28l.2 4A12.29 12.29 0 0 0 541 145.8l4 .2v-44l.2-4a17.44 17.44 0 0 1 2-8.05 16 16 0 0 1 27.69.05 17.54 17.54 0 0 1 1.94 8l.2 4v28l.2 4A12.24 12.24 0 0 0 589 145.8l4 .2V98a32 32 0 0 0-56-21.17 32 32 0 0 0-41.92-5.35C492 68 485 66 481 66v80l4-.2c6.68-.44 11.54-5.16 11.8-11.8l.2-4v-28l.2-4a17.45 17.45 0 0 1 2-8 16 16 0 0 1 27.68 0z"
            classes="N P"
          />
        </clipPath>
        <clipPath id="C">
          <circle cx="107" cy="106" r="102" classes="N" />
        </clipPath>
        <clipPath id="D">
          <circle cx="107" cy="106" r="100" classes="N" />
        </clipPath>
        <clipPath id="E">
          <circle cx="107" cy="106" r="92" classes="N" />
        </clipPath>
        <clipPath id="F">
          <path
            d="M135 94.06l26-19c2.27-1.85 4-1.42 4 2V135c0 3.84-2.16 3.4-4 2l-26-19zM47 77.2v43.2A17.69 17.69 0 0 0 64.77 138h63a3.22 3.22 0 0 0 3.23-3.2V91.6A17.69 17.69 0 0 0 113.23 74h-63A3.22 3.22 0 0 0 47 77.2z"
            classes="N P"
          />
        </clipPath>
      </defs>
      <g clipPath="url(#B)" transform="translate(0 -178)" classes="O">
        <path d="M232 61h366v90H232z" fill="#4a8cff" />
      </g>
      <g transform="matrix(.156863 0 0 .156863 -.784314 -.627496)" classes="O">
        <g clipPath="url(#C)">
          <path d="M0-1h214v214H0z" fill="#e5e5e4" />
        </g>
        <g clipPath="url(#D)">
          <path d="M2 1h210v210H2z" fill="#fff" />
        </g>
        <g clipPath="url(#E)">
          <path d="M10 9h194v194H10z" fill="#4a8cff" />
        </g>
        <g clipPath="url(#F)">
          <path d="M42 69h128v74H42z" fill="#fff" />
        </g>
      </g>
    </SvgIcon>
  );
};
