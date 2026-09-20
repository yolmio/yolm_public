import type { StyleObject } from "std/style_types";
import { cssVar } from "std/style_utils";
import type { App } from "std/system";
import type { Node } from "std/ui";
import { Show, useApp } from "std/ui";
import type {
  DialogBinding,
  OverridableComponent,
  SingleElementComponentProps,
} from "./utils";
import { resolveDialogBinding, singleElementComponent } from "./utils";

type Direction = "left" | "right" | "top" | "bottom";

interface DrawerProps extends SingleElementComponentProps, DialogBinding {
  direction: Direction;
  children: Node;
}

function getDrawerOutOfViewTransform(direction: Direction) {
  switch (direction) {
    case "right":
      return "translate(100%, 0)";
    case "left":
      return "translate(-100%, 0)";
    case "top":
      return "translate(0, -100%)";
    case "bottom":
      return "translate(0, 100%)";
    default:
      return "translate(-100%, 0)";
  }
}

function drawerStyles(app: App, direction: Direction) {
  const enterAnimation = app.registerKeyframes({
    from: {
      transform: getDrawerOutOfViewTransform(direction),
    },
    to: {
      transform: "translate(0%, 0)",
    },
  });
  const transform = getDrawerOutOfViewTransform(direction);
  const exitAnimation = app.registerKeyframes({
    from: {
      transform: "translate(0%, 0)",
    },
    to: {
      transform,
    },
  });
  app.addGlobalStyle({
    [`::view-transition-new(drawer-${direction}):only-child`]: {
      animation: `300ms cubic-bezier(0, 0, 0.2, 1) both ${enterAnimation}`,
    },
    [`::view-transition-old(drawer-${direction}):only-child`]: {
      animation: `300ms cubic-bezier(0, 0, 0.2, 1) both ${exitAnimation}`,
    },
    [`::view-transition-group(drawer-${direction})`]: {
      zIndex: 5,
    },
  });
  const styles: StyleObject = {
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    position: "fixed",
    backgroundColor: "background-popup",
    p: 4,
    m: 0,
    transform: getDrawerOutOfViewTransform(direction),
    transition:
      `transform ${app.theme.transitionDurations.drawer} ${app.theme.transitionEasing.dialog}, display ${app.theme.transitionDurations.drawer} allow-discrete`,
    "&::backdrop": {
      backgroundColor: "background-backdrop",
      transition:
        `opacity ${app.theme.transitionDurations.drawer} ${app.theme.transitionEasing.dialog}, display ${app.theme.transitionDurations.drawer} allow-discrete`,
      opacity: 0,
    },
    "&[open]": {
      transform: "translate(0%, 0)",
      "&::backdrop": {
        opacity: 1,
      },
      "@starting-style": {
        transform: getDrawerOutOfViewTransform(direction),
        "&::backdrop": {
          opacity: 0,
        },
      },
    },
  };

  // Set position and dimensions based on direction
  if (direction === "left" || direction === "right") {
    styles.height = "100%";
    styles.minHeight = "100%";
    styles.top = 0;
    styles.minWidth = 300;

    if (direction === "right") {
      styles.right = 0;
      styles.ml = "auto";
      styles.borderLeft = "1px solid";
      styles.borderTopLeftRadius = cssVar("radius-md");
      styles.borderBottomLeftRadius = cssVar("radius-md");
    } else {
      styles.left = 0;
      styles.mr = "auto";
      styles.borderRight = "1px solid";
      styles.borderTopRightRadius = cssVar("radius-md");
      styles.borderBottomRightRadius = cssVar("radius-md");
    }
  } else {
    // For top and bottom drawers
    styles.width = "100%";
    styles.minWidth = "100%";
    styles.left = 0;
    styles.minHeight = 200;

    if (direction === "bottom") {
      styles.bottom = 0;
      styles.mt = "auto";
      styles.borderTop = "1px solid";
      styles.borderTopLeftRadius = cssVar("radius-md");
      styles.borderTopRightRadius = cssVar("radius-md");
    } else {
      styles.top = 0;
      styles.mb = "auto";
      styles.borderBottom = "1px solid";
      styles.borderBottomLeftRadius = cssVar("radius-md");
      styles.borderBottomRightRadius = cssVar("radius-md");
    }
  }

  styles.borderColor = "neutral-outlined-border";
  return styles;
}

/**
 A component that renders a drawer (a sliding panel) that can be opened and closed.

 @category UI Component

 @param opts.open - Whether the drawer is open.
 @param opts.onClose - Function to call when the drawer should close.
 @param opts.direction - The direction from which the drawer should appear ("left", "right", "top", or "bottom").
 @param opts.children - The content to be rendered inside the drawer.

 @examples
 [Example](./settings_drawer.tsx)
 */
export const Drawer: OverridableComponent<{
  defaultComponent: "dialog";
  props: DrawerProps;
}> = (props: DrawerProps) => {
  const { open, onClose } = resolveDialogBinding(props);
  if (open === null || open === undefined) {
    throw new Error("open must be specified");
  }
  const app = useApp();
  const {
    direction,
    component = "dialog",
    bindRecordField: _,
    bindScalar: __,
    open: ___,
    onClose: ____,
    ...rest
  } = props;
  const [RootSlot, rootProps] = singleElementComponent({
    component,
    sx: drawerStyles(app, direction),
    externalProps: rest,
    internalProps: {
      classes: "skip-harmonize",
      yolmModalShowing: open,
      onCancel: onClose,
      onClose: onClose,
      onDialogBackdropClick: onClose,
    },
  });
  return (
    <Show when={open}>
      <RootSlot {...rootProps}>{props.children}</RootSlot>
    </Show>
  );
};
