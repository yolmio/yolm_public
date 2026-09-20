import type { Style, StyleObject } from "std/style_types";
import { createStyles, cssVar } from "std/style_utils";
import type { Variant } from "std/theme";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import type { Size } from "./types";
import { resolveDialogBinding, singleElementComponent } from "./utils";
import type {
  DialogBinding,
  OverridableComponent,
  SingleElementComponentProps,
} from "./utils";

// First, let's define the maxWidth multipliers
const maxWidthMultipliers = {
  xs: 0.5, // Half of the default size
  sm: 0.75, // 75% of the default size
  md: 1, // Default size
  lg: 1.25, // 25% larger than default
  xl: 1.5, // 50% larger than default
};

/**
 * Style builders for {@link ModalDialog} (dialog surface + layout/backdrop
 * transitions, keyed by layout, size, and max width). Exported so callers
 * can reuse the dialog styling when composing a custom dialog element.
 */
export const styles = createStyles({
  modalLayoutStyles: (app, layout: DialogLayout, maxWidth?: MaxWidth) => {
    const styles: StyleObject = {
      "html:has(&[open])": {
        overflow: "hidden",
      },
      transition:
        `opacity ${app.theme.transitionDurations.dialog} ${app.theme.transitionEasing.dialog}, transform ${app.theme.transitionDurations.dialog} ${app.theme.transitionEasing.dialog}, display ${app.theme.transitionDurations.dialog} allow-discrete`,
      opacity: 0,
      maxWidth: "var(--modal-dialog-max-width)",
      "&::backdrop": {
        backgroundColor: "background-backdrop",
        transition:
          `opacity ${app.theme.transitionDurations.dialog} ${app.theme.transitionEasing.dialog}, display ${app.theme.transitionDurations.dialog} allow-discrete`,
        opacity: 0,
      },
    };

    // Get the multiplier based on maxWidth, defaulting to md (1)
    const multiplier = maxWidth ? maxWidthMultipliers[maxWidth] : 1;

    switch (layout) {
      case "center": {
        Object.assign(styles, {
          height: "max-content",
          margin: "auto",
          transform: "scale(0.33) translateY(-50%)",
          "&[open]": {
            opacity: 1,
            transform: "none",
            "&::backdrop": {
              opacity: 1,
            },
            "@starting-style": {
              "&": {
                opacity: 0,
                transform: "scale(0.33) translateY(-50%)",
              },
              "&::backdrop": {
                opacity: 0,
              },
            },
          },
          md: {
            "--modal-dialog-max-width":
              `calc(${app.theme.tokens.breakpoints.md} * ${multiplier})`,
          },
          lg: {
            "--modal-dialog-max-width":
              `calc(${app.theme.tokens.breakpoints.lg} * ${multiplier})`,
          },
          xl: {
            "--modal-dialog-max-width":
              `calc(${app.theme.tokens.breakpoints.xl} * ${multiplier})`,
          },
        } as StyleObject);
        break;
      }
      case "fullscreen": {
        Object.assign(styles, {
          borderRadius: 0,
          width: "100%",
          minWidth: "100%",
          minHeight: "100vh",
          margin: 0,
          flex: 1,
          transform: "scale(0.33)",
          "&[open]": {
            opacity: 1,
            transform: "none",
            "&::backdrop": {
              opacity: 1,
            },
            "@starting-style": {
              "&": {
                opacity: 0,
                transform: "scale(0.33)",
              },
              "&::backdrop": {
                opacity: 0,
              },
            },
          },
        } as StyleObject);
        break;
      }
      case "fullscreenOnMobile": {
        Object.assign(styles, {
          borderRadius: 0,
          width: "100%",
          minWidth: "100%",
          minHeight: "100vh",
          margin: 0,
          flex: 1,
          height: "auto",
          transform: "scale(0.33)",
          "&[open]": {
            opacity: 1,
            transform: "none",
            "&::backdrop": {
              opacity: 1,
            },
            "@starting-style": {
              "&": {
                opacity: 0,
                transform: "scale(0.33)",
              },
              "&::backdrop": {
                opacity: 0,
              },
            },
          },
          md: {
            margin: "auto",
            minHeight: "initial",
            minWidth: "var(--modal-dialog-min-width)",
            "--modal-dialog-max-width":
              `calc(${app.theme.tokens.breakpoints.md} * ${multiplier})`,
            height: "max-content",
            width: "unset",
            borderRadius: "var(--modal-dialog-radius)",
            flex: "unset",
            transform: "scale(0.33) translateY(-50%)",
            "&[open]": {
              opacity: 1,
              transform: "none",
              "&::backdrop": {
                opacity: 1,
              },
              "@starting-style": {
                "&": {
                  opacity: 0,
                  transform: "scale(0.33) translateY(-50%)",
                },
                "&::backdrop": {
                  opacity: 0,
                },
              },
            },
          },
          lg: {
            "--modal-dialog-max-width":
              `calc(${app.theme.tokens.breakpoints.lg} * ${multiplier})`,
          },
          xl: {
            "--modal-dialog-max-width":
              `calc(${app.theme.tokens.breakpoints.xl} * ${multiplier})`,
          },
        } as StyleObject);
        break;
      }
    }
    return styles;
  },
  dialog: (
    _app,
    size: Size,
    layout: DialogLayout,
    maxWidth?: MaxWidth,
  ): Style => {
    return [
      {
        "html:has(&[open])": {
          overflow: "hidden",
        },
        // Divider integration
        "--divider-inset": "calc(-1 * var(--modal-dialog-padding))",
        "--modal-close-radius":
          "max((var(--modal-dialog-radius) - var(--variant-border-width, 0px)) - var(--modal-close-inset), min(var(--modal-close-inset) / 2, (var(--modal-dialog-radius) - var(--variant-border-width, 0px)) / 2))",
        ...(size === "xs" && {
          "--modal-dialog-padding": 4,
          "--modal-dialog-radius": cssVar("radius-sm"),
          "--modal-close-inset": 1,
          fontSize: cssVar("text-sm"),
        }),
        ...(size === "sm" && {
          "--modal-dialog-padding": 5,
          "--modal-dialog-radius": cssVar("radius-sm"),
          "--modal-close-inset": 1.5,
          fontSize: cssVar("text-sm"),
        }),
        ...(size === "md" && {
          "--modal-dialog-padding": 8,
          "--modal-dialog-radius": cssVar("radius-md"),
          "--modal-close-inset": 2,
          fontSize: cssVar("text-base"),
        }),
        ...(size === "lg" && {
          "--modal-dialog-padding": 12,
          "--modal-dialog-radius": cssVar("radius-md"),
          "--modal-close-inset": 3,
          fontSize: cssVar("text-base"),
        }),
        boxSizing: "border-box",
        boxShadow: "md",
        borderRadius: "var(--modal-dialog-radius)",
        fontFamily: cssVar("font-family-body"),
        lineHeight: cssVar("text-base--line-height"),
        padding: "var(--modal-dialog-padding)",
        minWidth:
          "min(calc(100vw - 2 * var(--modal-dialog-padding)), var(--modal-dialog-min-width, 300px))",
        outline: 0,
        border: "none",
        background: cssVar("palette-background-body"),
      },
      styles.modalLayoutStyles(layout, maxWidth),
    ];
  },
});

type DialogLayout = "center" | "fullscreen" | "fullscreenOnMobile";
type MaxWidth = "xs" | "sm" | "md" | "lg" | "xl";

/**
 * Props for {@link ModalDialog}. Inherits {@link DialogBinding}, so the
 * open state is supplied via `open`/`onClose` or `bindScalar`/
 * `bindRecordField`.
 */
export interface ModalDialogProps
  extends DialogBinding, SingleElementComponentProps {
  /** How the dialog is positioned/sized on screen. Defaults to "fullscreenOnMobile". */
  layout?: DialogLayout;
  size?: Size;
  /** Caps the centered dialog width as a fraction/multiple of the breakpoint width. */
  maxWidth?: MaxWidth;
  variant?: Variant;
  children: Node;
}

/**
 A component that renders a modal dialog.

 @category Dialog Component

 @param props.layout - The layout of the modal dialog
 @param props.size
 @param props.variant
 @param props.children - The content of the modal dialog
 @param props.open - Whether the modal is open
 @param props.onClose - Function to call when the modal is closed
 @param props.bindScalar - Bind the open state to a scalar variable
 @param props.bindRecordField - Bind the open state to a record field
 @param props.component - The component to render as the root element

 @examples
 [Example](../blocks/glossary/index.tsx)
*/
export const ModalDialog: OverridableComponent<{
  defaultComponent: "dialog";
  props: ModalDialogProps;
}> = (props: ModalDialogProps) => {
  const {
    layout = "fullscreenOnMobile",
    size = "md",
    maxWidth,
    // deno-lint-ignore no-unused-vars
    variant,
    children,
    open,
    onClose,
    bindScalar,
    bindRecordField,
    component = "dialog",
    ...rest
  } = props;
  const { open: resolvedOpen, onClose: resolvedOnClose } = resolveDialogBinding(
    {
      open,
      onClose,
      bindScalar,
      bindRecordField,
    },
  );
  if (resolvedOpen === null || resolvedOpen === undefined) {
    throw new Error("open must be specified");
  }
  const [RootSlot, rootProps] = singleElementComponent({
    component,
    sx: styles.dialog(size, layout, maxWidth),
    externalProps: rest,
    internalProps: {
      classes: "skip-harmonize",
      yolmModalShowing: resolvedOpen,
      onCancel: resolvedOnClose,
      onClose: resolvedOnClose,
      onDialogBackdropClick: resolvedOnClose,
    },
  });
  return (
    <Show when={resolvedOpen}>
      <RootSlot {...rootProps}>{children}</RootSlot>
    </Show>
  );
};
