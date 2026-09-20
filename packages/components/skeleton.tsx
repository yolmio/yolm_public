import { sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { cssVar } from "std/style_utils";
import type { App } from "std/system";
import type { TypographyKeys } from "std/theme";
import { useApp } from "std/ui";
import type { Node } from "std/ui";
import { lazyPerApp } from "std/utils/memoize";
import { singleElementComponent } from "./utils";
import type {
  OverridableComponent,
  SingleElementComponentProps,
} from "./utils";

/** Shape of a {@link Skeleton} placeholder. */
export type SkeletonVariant = "rectangular" | "circular" | "text";
/** Loading animation style for a {@link Skeleton}. */
export type Animation = "pulse" | "wave";
type Level = TypographyKeys | "inherit";

/** Props for {@link Skeleton}. */
export interface SkeletonBaseProps extends SingleElementComponentProps {
  variant?: SkeletonVariant;
  animation?: Animation;
  /** Typography level the skeleton sizes itself to, matching real text. */
  level?: Level;
  children?: Node;
}

const pulseAnimation = lazyPerApp((app) =>
  app.registerKeyframes({
    "0%": { opacity: 1 },
    "50%": {
      opacity: 0.8,
      background: "var(--unstable-pulse-bg)",
    },
    "100%": { opacity: 1 },
  })
);

const waveAnimation = lazyPerApp((app) =>
  app.registerKeyframes({
    "0%": { transform: "translateX(-100%)" },
    "50%": { transform: "translateX(100%)" },
    "100%": { transform: "translateX(100%)" },
  })
);

function styles(
  app: App,
  props: {
    variant: SkeletonVariant;
    animation: Animation;
    level: Level;
  },
) {
  const { variant, animation, level } = props;
  const theme = app.theme;
  const styleBase: StyleObject = {
    display: "block",
    position: "relative",
    "--unstable-pseudo-z-index": "9",
    "--unstable-pulse-bg": cssVar("palette-background-level1"),
    overflow: "hidden",
    cursor: "default",
    color: "transparent",
    "& *": { visibility: "hidden" },
    "&::before": {
      display: "block",
      content: '" "',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: "var(--unstable-pseudo-z-index)",
      borderRadius: "inherit",
    },
    dark: {
      "--unstable-wave-bg": "rgba(255 255 255 / 0.1)",
    },
  };

  let variantStyles: StyleObject = {};
  switch (variant) {
    case "rectangular":
    case "circular": {
      variantStyles = {
        borderRadius: variant === "circular" ? "50%" : "min(0.15em, 6px)",
        height: variant === "circular" ? "100%" : "auto",
        width: "100%",
        "&::before": { position: "absolute" },
      };
      if (!animation) {
        variantStyles.backgroundColor = cssVar("palette-background-level3");
      }
      if (level !== "inherit") {
        Object.assign(variantStyles, theme.typography[level]);
      }
      break;
    }
    case "text":
      variantStyles = {
        borderRadius: "min(0.15em, 6px)",
        background: "transparent",
        width: "100%",
        height: "100%",
        ...(level !== "inherit" && {
          ...theme.typography[level],
          paddingBlockStart: `calc((${
            theme.typography[level]?.lineHeight || 1
          } - 1) * 0.56em)`,
          paddingBlockEnd: `calc((${
            theme.typography[level]?.lineHeight || 1
          } - 1) * 0.44em)`,
          "&::before": {
            height: "1em",
            ...theme.typography[level],
            ...(animation === "wave" && {
              backgroundColor: cssVar("palette-background-level3"),
            }),
            ...(animation ? {} : {
              backgroundColor: cssVar("palette-background-level3"),
            }),
          },
          "&::after": {
            height: "1em",
            top: `calc((${
              theme.typography[level]?.lineHeight || 1
            } - 1) * 0.56em)`,
            ...theme.typography[level],
          },
        }),
      };
      break;
  }

  let animationStyles: StyleObject | undefined;
  if (animation === "pulse") {
    animationStyles = {
      "&::before": {
        animation: `${pulseAnimation()} 2s ease-in-out 0.5s infinite`,
        background: cssVar("palette-background-level3"),
      },
    };
  } else if (animation === "wave") {
    animationStyles = {
      backgroundColor: cssVar("palette-background-level3"),
      "-webkit-mask-image": "-webkit-radial-gradient(white, black)",
      "&::after": {
        content: "' '",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: "var(--unstable-pseudo-z-index)",
        animation: `${waveAnimation()} 1.6s linear 0.5s infinite`,
        background: `linear-gradient(
          90deg,
          transparent,
          var(--unstable-wave-bg, rgba(0 0 0 / 0.08)),
          transparent
        )`,
        transform: "translateX(-100%)",
      },
    };
  }

  return [styleBase, variantStyles, animationStyles];
}

/**
 Skeleton component for displaying a placeholder while content is loading.

 A Skeleton is a placeholder preview of content before the data gets loaded,
 reducing load-time by providing a visual estimate of the content's layout.

 @category UI Component

 @param props.variant The shape of the skeleton. Can be 'rectangular', 'circular', or 'text'.
 @param props.animation The animation effect. Can be 'pulse' or 'wave'.
 @param props.level The typography level to match the text size.
 @param props.component The component used for the root node.
 @param props.children

 @examples
 [Example](../pages/search_card_page.tsx)
*/
export const Skeleton: OverridableComponent<{
  defaultComponent: "div";
  props: SkeletonBaseProps;
}> = (props: SkeletonBaseProps) => {
  const {
    variant = "rectangular",
    animation = "pulse",
    level = "inherit",
    component = "div",
    children,
    ...rest
  } = props;
  const app = useApp();
  const [Root, rootProps] = singleElementComponent({
    component,
    sx: styles(app, { variant, animation, level }),
    externalProps: rest,
    internalProps: {
      role: sql.lit`presentation`,
    },
  });
  return <Root {...rootProps}>{children}</Root>;
};
