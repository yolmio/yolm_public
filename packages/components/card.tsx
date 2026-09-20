import { HarmonizeCtx } from "std/ictx";
import type { StyleObject } from "std/style_types";
import {
  createHarmonizeVars as createHarmonizeVarsUtil,
  cssVar,
  getVariantStyle,
} from "std/style_utils";
import type { Variant } from "std/theme";
import { addCtx } from "std/ui";
import type { Node } from "std/ui";
import type { Color, ComponentOpts, Size } from "./types";
import {
  createGatherSafeSlot,
  type OverridableComponent,
  singleElementComponent,
  type SingleElementComponentProps,
} from "./utils";

type Orientation = "vertical" | "horizontal";

type HarmonizeVariant = "soft" | "solid";
type ColorPaletteProp = Exclude<Color, "harmonize">;

interface CardProps extends ComponentOpts<Size>, SingleElementComponentProps {
  /**
       The orientation of the card.
       @default "vertical"
       */
  orientation?: Orientation;
  /**
       Whether to harmonize the card's colors with its content.
       @default false
       */
  harmonize?: boolean;
  /**
       The content of the card.
       */
  children: Node;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
  orientation: Orientation;
  harmonize: boolean;
}

const root = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: OwnerState;
    },
  ) => {
    const { size, variant, color, orientation, harmonize } = ownerState;
    const styles: StyleObject = {
      // a context variable for any child component
      "--card-childRadius":
        "max((var(--card-radius) - var(--variant-border-width, 0px)) - var(--card-padding), min(var(--card-padding) / 2, (var(--card-radius) - var(--variant-border-width, 0px)) / 2))",
      // AspectRatio integration
      "--aspect-ratio-radius": "var(--card-childRadius)",
      // Link integration
      "--internal-action-margin": "calc(-1 * var(--variant-border-width, 0px))",
      // Link, Radio, Checkbox integration
      "--internal-action-radius": "var(--card-radius)",
      // CardCover integration
      "--card-cover-radius":
        "calc(var(--card-radius) - var(--variant-border-width, 0px))",
      // CardOverflow integration
      "--card-overflow-offset": "calc(-1 * var(--card-padding))",
      "--card-overflow-radius":
        "calc(var(--card-radius) - var(--variant-border-width, 0px))",
      // Divider integration
      "--divider-inset": "calc(-1 * var(--card-padding))",
      padding: "var(--card-padding)",
      borderRadius: "var(--card-radius)",
      boxShadow: cssVar("shadow-sm"),
      backgroundColor: cssVar("palette-background-surface"),
      fontFamily: cssVar("font-family-body"),
      position: "relative",
      display: "flex",
      flexDirection: orientation === "horizontal" ? "row" : "column",
      ...getVariantStyle(variant, color),
    };
    if (
      harmonize &&
      (variant === "soft" || variant === "solid") &&
      color !== "harmonize"
    ) {
      Object.assign(
        styles,
        createHarmonizeVarsUtil(
          variant as HarmonizeVariant,
          color as ColorPaletteProp,
        ),
      );
    }
    switch (size) {
      case "xs": {
        Object.assign(styles, {
          "--card-radius": cssVar("radius-xs"),
          "--card-padding": "0.375rem",
          fontSize: cssVar("text-sm"),
        });
        break;
      }
      case "sm": {
        Object.assign(styles, {
          "--card-radius": cssVar("radius-sm"),
          "--card-padding": "0.5rem",
        });
        break;
      }
      case "md": {
        Object.assign(styles, {
          "--card-radius": cssVar("radius-md"),
          "--card-padding": "1rem",
          fontSize: cssVar("text-base"),
        });
        break;
      }
      case "lg": {
        Object.assign(styles, {
          "--card-radius": cssVar("radius-lg"),
          "--card-padding": "1.5rem",
        });
        break;
      }
    }
    return styles;
  },
);

/**
 A versatile card component that can be used to display content in a contained format.

 @category UI Component

 @examples
 [Example](../table_blocks/address/addresses_card.tsx)
 */
export const Card: OverridableComponent<{
  defaultComponent: "div";
  props: CardProps;
}> = (props: CardProps) => {
  const {
    size = "md",
    variant = "plain",
    color = "neutral",
    orientation = "vertical",
    harmonize = false,
    ...other
  } = props;
  const ownerState: OwnerState = {
    size,
    variant,
    color,
    orientation,
    harmonize,
  };
  const [RootSlot, rootProps] = root({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  if (harmonize) {
    addCtx(new HarmonizeCtx(variant, color));
  }
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

interface CardOverflowProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  row?: boolean;
  children: Node;
  harmonize?: boolean;
}

interface CardOverflowOwnerState {
  variant: Variant;
  color: Color;
  row: boolean;
  harmonize: boolean;
}

const cardOverflowRoot = createGatherSafeSlot(
  "root",
  (
    _,
    {
      ownerState,
    }: {
      ownerState: CardOverflowOwnerState;
    },
  ) => {
    const {
      variant,
      color,
      row,
      harmonize: shouldCreateHarmonizeVars,
    } = ownerState;
    const childRadius =
      "calc(var(--card-overflow-radius) - var(--variant-border-width, 0px))";
    const styles: StyleObject = row
      ? {
        "--aspect-ratio-margin": "calc(-1 * var(--card-padding)) 0px",
        marginTop: "var(--card-overflow-offset)",
        marginBottom: "var(--card-overflow-offset)",
        paddingTop: "var(--card-padding)",
        paddingBottom: "var(--card-padding)",
        paddingLeft: "var(--card-padding)",
        borderRadius: "var(--card-overflow-radius)",
        position: "relative",
        "&:first-child": {
          "--aspect-ratio-radius": `${childRadius} 0 0 ${childRadius}`,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          marginLeft: "var(--card-overflow-offset)",
        },
        "&:last-child": {
          "--aspect-ratio-radius": `0 ${childRadius} ${childRadius} 0`,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          marginRight: "var(--card-overflow-offset)",
        },
      }
      : {
        "--aspect-ratio-margin": "0px calc(-1 * var(--card-padding))",
        marginLeft: "var(--card-overflow-offset)",
        marginRight: "var(--card-overflow-offset)",
        borderRadius: "var(--card-overflow-radius)",
        position: "relative",
        "&:first-child": {
          "--aspect-ratio-radius": `${childRadius} ${childRadius} 0 0`,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          marginTop: "var(--card-overflow-offset)",
        },
        "&:last-child": {
          "--aspect-ratio-radius": `0 0 ${childRadius} ${childRadius}`,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          marginBottom: "var(--card-overflow-offset)",
        },
      };
    Object.assign(styles, getVariantStyle(variant, color));
    if (
      shouldCreateHarmonizeVars &&
      (variant === "soft" || variant === "solid") &&
      color !== "harmonize"
    ) {
      Object.assign(
        styles,
        createHarmonizeVarsUtil(
          variant as HarmonizeVariant,
          color as ColorPaletteProp,
        ),
      );
    }
    return styles;
  },
);

/**
 * A `Card` child that bleeds to the card's edges (cancelling its
 * padding). Use to render full-bleed images, banners, or accent strips
 * inside an otherwise padded card. Pass `harmonize` to opt into
 * harmonized colors (text/background recolored to match the variant).
 */
export const CardOverflow: OverridableComponent<{
  defaultComponent: "div";
  props: CardOverflowProps;
}> = (props: CardOverflowProps) => {
  const {
    variant = "plain",
    color = "neutral",
    row = false,
    harmonize = false,
    ...other
  } = props;
  const ownerState: CardOverflowOwnerState = {
    variant,
    color,
    row,
    harmonize: harmonize,
  };
  const [RootSlot, rootProps] = cardOverflowRoot({
    component: "div",
    rootProps: props,
    externalProps: other,
    slotProps: { ownerState },
  });
  if (harmonize) {
    addCtx(new HarmonizeCtx(variant, color));
  }
  return <RootSlot {...rootProps}>{props.children}</RootSlot>;
};

const cardHeaderStyles: StyleObject = {
  display: "flex",
  px: "var(--card-padding)",
  pt: "calc(var(--card-padding) - 4px)",
  pb: 3,
  borderBottom: "1px solid var(--palette-divider)",
};

/**
 * Title slot for a `Card`. Renders inside a `CardOverflow` so it spans
 * the card's full width and is visually separated from `CardContent`
 * with a divider (suppress with `noDivider`).
 */
export function CardHeader(
  props: CardOverflowProps & {
    noDivider?: boolean;
  },
) {
  // deno-lint-ignore no-unused-vars
  const { noDivider, ...other } = props;
  const [Slot, slotProps] = singleElementComponent({
    component: CardOverflow as any,
    sx: props.noDivider
      ? { ...cardHeaderStyles, borderBottom: "none" }
      : cardHeaderStyles,
    internalProps: {},
    externalProps: other,
  });
  return <Slot {...slotProps}>{props.children}</Slot>;
}

interface CardContentProps extends SingleElementComponentProps {
  /**
       The orientation of the card content.
       @default "vertical"
       */
  orientation?: Orientation;
  /**
       The content of the card content.
       */
  children: Node;
}

interface CardContentOwnerState {
  orientation: Orientation;
}

const cardContentStyles = (ownerState: CardContentOwnerState): StyleObject => ({
  display: "flex",
  flexDirection: ownerState.orientation === "horizontal" ? "row" : "column",
  flexGrow: 9999,
  zIndex: 1,
  columnGap: "var(--card-padding)",
  rowGap: "max(2px, calc(0.1875 * var(--card-padding)))",
  padding: "var(--card-padding)",
});

/**
 A component to be used as a child of Card, CardOverflow, or other card-like structures
 to provide consistent padding and flex layout for the main content area.
 */
export const CardContent = (props: CardContentProps) => {
  const { orientation = "vertical", children, ...other } = props;
  const ownerState: CardContentOwnerState = {
    orientation,
  };

  const [Slot, slotProps] = singleElementComponent({
    component: "div",
    sx: cardContentStyles(ownerState),
    internalProps: {},
    externalProps: other,
  });

  return <Slot {...slotProps}>{children}</Slot>;
};
