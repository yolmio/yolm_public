import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { Variant } from "std/theme";
import { useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import { Typography } from "./typography";
import { createGatherSafeSlot } from "./utils";
import type { OverridableComponent, SlottedComponentBaseProps } from "./utils";

interface SliderBaseProps
  extends
    ComponentOpts<Size>,
    SlottedComponentBaseProps<{
      root: "div";
      rail: "span";
      track: "span";
      thumb: "span";
      input: "input";
      valueLabel: "span";
    }> {
  min?: number | NumericExpr;
  max?: number | NumericExpr;
  step?: number | NumericExpr;
  value?: NumericExpr;
  defaultValue?: number;
  disabled?: BooleanExpr;
  showValueLabel?: boolean;
  valueLabelFormat?: (value: NumericExpr) => Node;
  bindScalar?: string;
  startAdornment?: Node;
  endAdornment?: Node;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  disabled: BooleanExpr;
  showValueLabel: boolean;
}

const input = createGatherSafeSlot("input", () => ({
  display: "none",
}));

export type SliderProps =
  & SliderBaseProps
  & Omit<JSX.IntrinsicElements["div"], "size">;

/**
 A customizable slider component that allows selecting a value from a range.

 @category UI Component
 @param props.size - Size of the slider. Options: "xs", "sm", "md", "lg". Defaults to "md".
 @param props.variant - Visual style variant. Options: "solid", "soft", "outlined". Defaults to "solid".
 @param props.color - Color theme for the slider. Defaults to "primary".
 @param props.min - Minimum value of the slider. Defaults to 0.
 @param props.max - Maximum value of the slider. Defaults to 100.
 @param props.step - Step increment between values. Defaults to 1.
 @param props.value - Current value of the slider.
 @param props.defaultValue - Initial value of the slider.
 @param props.disabled - Whether the slider is disabled.
 @param props.showValueLabel - Whether to show a label with the current value. Defaults to false.
 @param props.valueLabelFormat - Function to format the value label.
 @param props.bindScalar - Name of the scalar variable to bind to the slider value.
 @param props.startAdornment - Content to display before the slider.
 @param props.endAdornment - Content to display after the slider.
 */
export const Slider: OverridableComponent<{
  defaultComponent: "div";
  props: SliderBaseProps;
}> = (props: SliderProps) => {
  const sliderId = useUniqueId();

  let {
    size = "md",
    variant = "solid",
    color = "primary",
    min = 0,
    max = 100,
    step = 1,
    value,
    defaultValue = 0,
    disabled = sql`false`,
    showValueLabel = false,
    valueLabelFormat,
    bindScalar,
    startAdornment,
    endAdornment,
    ...other
  } = props;

  const ownerState: OwnerState = {
    size,
    variant,
    color,
    disabled,
    showValueLabel,
  };

  if (bindScalar) {
    if (value !== undefined) {
      throw new Error("Cannot specify both value and bindScalar");
    }

    value = sql`coalesce(${sql.ref(bindScalar)}, ${defaultValue})`;
  }

  if (value === undefined && !bindScalar) {
    throw new Error("When using defaultValue, bindScalar must be provided");
  }

  const valuePercent = sql`(${
    value ?? 0
  } - ${min}) * 100.0 / nullif(${max} - ${min}, 0)`;

  const handleSliderChange = (s: DomStatements) => {
    if (bindScalar) {
      s.unless(disabled, (s) => {
        s.element(sql.lit`${sliderId}`).getBoundingClientRect("slider_rect");

        // Calculate raw percent (may be outside 0-1 range)
        s.defScalar(
          "rawPercent",
          sql`(event.client_x - slider_rect.left) / slider_rect.width`,
        );

        // Clamp percent to 0-1 range using greatest/least
        s.defScalar(
          "percent",
          sql`least(1.0, greatest(0.0, rawPercent))`,
        );

        // Calculate the value based on percent and range
        s.defScalar(
          "rawValue",
          sql`${min} + percent * (${max} - ${min})`,
        );

        // Apply step if needed
        s.defScalar(
          "newValue",
          typeof step === "number" && step > 0
            ? sql`round(rawValue / ${step}) * ${step}`
            : sql`rawValue`,
        );

        s.setScalar(bindScalar, sql`newValue`);
      });
    }
  };

  const formattedValue = valueLabelFormat
    ? valueLabelFormat(value ?? sql`0`)
    : value;

  // Only InputSlot is used for the hidden input
  const [InputSlot, inputProps] = input({
    component: "input",
    rootProps: props,
    slotProps: { ownerState },
    internalProps: {
      type: "hidden",
      value,
      min,
      max,
      step,
      disabled,
    },
  });

  // Determine track height based on size
  let trackHeight: string;
  switch (size) {
    case "xs":
      trackHeight = "3px";
      break;
    case "sm":
      trackHeight = "4px";
      break;
    case "md":
      trackHeight = "6px";
      break;
    case "lg":
      trackHeight = "10px";
      break;
    default:
      trackHeight = "6px";
  }

  const thumbSize = size === "xs"
    ? "10px"
    : size === "sm"
    ? "12px"
    : size === "lg"
    ? "20px"
    : "14px";

  return (
    <div
      id={sliderId}
      className={other.className}
      style={{
        position: "relative",
        width: "100%",
        height: "32px",
        cursor: "pointer",
        touchAction: "none",
      }}
      onMouseDown={handleSliderChange}
      onMouseMove={(s: DomStatements) => {
        s.if(sql`(event.buttons & 1) = 1`, (s) => {
          handleSliderChange(s);
        });
      }}
    >
      {startAdornment && (
        <Typography
          level="body-sm"
          dynamicClasses={[{ classes: "disabled", condition: disabled }]}
          sx={{
            marginRight: 2,
            color: "text-secondary",
            "&.disabled": { color: "neutral-plain-disabled-color" },
          }}
        >
          {startAdornment}
        </Typography>
      )}

      {/* Rail - the background track */}
      <div
        className="absolute left-0 right-0 top-1/2 -translate-y-1/2 bg-neutral-200 rounded-full overflow-hidden"
        style={{
          height: trackHeight,
          pointerEvents: "none",
        }}
      >
        {/* Track - the filled portion */}
        <div
          className={`h-full rounded-full ${
            color === "primary"
              ? "bg-primary-500"
              : color === "neutral"
              ? "bg-neutral-500"
              : color === "danger"
              ? "bg-danger-500"
              : color === "success"
              ? "bg-success-500"
              : color === "warning"
              ? "bg-warning-500"
              : "bg-primary-500"
          }`}
          style={{
            width: sql`cast(coalesce(${valuePercent}, 0) as int) || '%'`,
          }}
        />
      </div>

      {/* Thumb */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded-full shadow-md ${
          color === "primary"
            ? "bg-primary-500"
            : color === "neutral"
            ? "bg-neutral-500"
            : color === "danger"
            ? "bg-danger-500"
            : color === "success"
            ? "bg-success-500"
            : color === "warning"
            ? "bg-warning-500"
            : "bg-primary-500"
        }`}
        style={{
          width: thumbSize,
          height: thumbSize,
          pointerEvents: "none",
          left: sql`cast(coalesce(${valuePercent}, 0) as int) || '%'`,
          marginLeft: `calc(${thumbSize} / -2)`,
        }}
      >
        {showValueLabel && (
          <span
            style={{
              position: "absolute",
              top: "-28px",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "4px 8px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--palette-neutral-500)",
              color: "white",
              fontSize: "var(--text-sm)",
              fontWeight: "medium",
              lineHeight: "1.2",
              whiteSpace: "nowrap",
            }}
          >
            {formattedValue ?? value}
          </span>
        )}
      </div>

      <InputSlot {...inputProps} />

      {endAdornment && (
        <Typography
          level="body-sm"
          dynamicClasses={[{ classes: "disabled", condition: disabled }]}
          sx={{
            marginLeft: 2,
            color: "text-secondary",
            "&.disabled": { color: "neutral-plain-disabled-color" },
          }}
        >
          {endAdornment}
        </Typography>
      )}
    </div>
  );
};
