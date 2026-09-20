import type * as css from "csstype";
import type {
  PaletteCssVars,
  Tokens,
  TransitionDurations,
  TransitionEasings,
  TypographyKeys,
} from "./theme";

type SkipPalette<T extends string> = T extends `palette-${infer R}` ? R : T;
type AnyString = string & Record<never, never>;

/**
 * Palette CSS-variable names with the `palette-` prefix stripped, accepted
 * directly by color-taking style props (e.g. `"primary-500"` instead of
 * `"palette-primary-500"`).
 */
export type SimplifiedPaletteVars = SkipPalette<PaletteCssVars>;

/** All standard CSS properties, with fallback values allowed (string|number). */
export type StandardCSSProperties = css.PropertiesFallback<number | string>;

/**
 * Shorthand style aliases layered on top of standard CSS: spacing
 * (`m`/`p` and their directional/axis forms), `bgcolor`, `typography`,
 * `displayPrint`, and grid span helpers.
 */
export interface AliasesCSSProperties {
  /**
               The **`background-color`** CSS property sets the background color of an element.

               Initial value: `transparent`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/background-color
               */
  bgcolor?: SimplifiedPaletteVars | StandardCSSProperties["backgroundColor"];
  /**
       The **`margin`** CSS property sets the margin on all four sides of an element. It is a shorthand for `margin-top`, `margin-right`, `margin-bottom`, and `margin-left`.

       | Chrome | Firefox | Safari |  Edge  |  IE   |
       | :----: | :-----: | :----: | :----: | :---: |
       | **1**  |  **1**  | **1**  | **12** | **3** |

       @see https://developer.mozilla.org/docs/Web/CSS/margin
       */
  sql?: StandardCSSProperties["margin"];
  /**
               The **`margin-top`** CSS property sets the margin on the top of an element. A positive value places it farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-top
               */
  mt?: StandardCSSProperties["marginTop"];
  /**
               The **`margin-right`** CSS property sets the margin on the right side of an element. A positive value places it farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-right
               */
  mr?: StandardCSSProperties["marginRight"];
  /**
               The **`margin-bottom`** CSS property sets the margin on the bottom of an element. A positive value places it farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-bottom
               */
  mb?: StandardCSSProperties["marginBottom"];
  /**
               The **`margin-left`** CSS property sets the margin on the left side of an element. A positive value places it farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-left
               */
  ml?: StandardCSSProperties["marginLeft"];
  /**
               The **`mx`** property is shorthand for using both **`margin-left`** and **`margin-right`** CSS properties. They set the margin on the left and right side of an element. A positive value places it
               farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-left
               @see https://developer.mozilla.org/docs/Web/CSS/margin-right
               */
  mx?: StandardCSSProperties["marginLeft"];
  /**
               The **`marginX`** property is shorthand for using both **`margin-left`** and **`margin-right`** CSS properties. They set the margin on the left and right side of an element. A positive value
               places it farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-left
               @see https://developer.mozilla.org/docs/Web/CSS/margin-right
               */
  marginX?: StandardCSSProperties["marginLeft"];
  /**
               The **`my`** property is shorthand for using both **`margin-top`** and **`margin-bottom`** CSS properties. They set the margin on the top and bottom of an element. A positive value places it
               farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-top
               @see https://developer.mozilla.org/docs/Web/CSS/margin-bottom
               */
  my?: StandardCSSProperties["marginTop"];
  /**
               The **`marginY`** property is shorthand for using both **`margin-top`** and **`margin-bottom`** CSS properties. They set the margin on the top and bottom of an element. A positive value places
               it farther from its neighbors, while a negative value places it closer.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/margin-top
               @see https://developer.mozilla.org/docs/Web/CSS/margin-bottom
               */
  marginY?: StandardCSSProperties["marginTop"];
  /**
       The **`padding`** CSS property sets the padding on all four sides of an element. It is a shorthand for `padding-top`, `padding-right`, `padding-bottom`, and `padding-left`.

       | Chrome | Firefox | Safari |  Edge  |  IE   |
       | :----: | :-----: | :----: | :----: | :---: |
       | **1**  |  **1**  | **1**  | **12** | **4** |

       @see https://developer.mozilla.org/docs/Web/CSS/padding
       */
  p?: StandardCSSProperties["padding"];
  /**
               The **`padding-top`** CSS property sets the height of the padding at the top of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-top
               */
  pt?: StandardCSSProperties["paddingTop"];
  /**
               The **`padding-right`** CSS property sets the width of the padding at the right side of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-right
               */
  pr?: StandardCSSProperties["paddingRight"];
  /**
               The **`padding-bottom`** CSS property sets the height of the padding on the bottom of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-bottom
               */
  pb?: StandardCSSProperties["paddingBottom"];
  /**
               The **`padding-left`** CSS property sets the width of the padding at the left side of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-left
               */
  pl?: StandardCSSProperties["paddingLeft"];
  /**
               The **`px`** property is shorthand for the CSS properties **`padding-left`** and **`padding-right`**. They set the width of the padding at the left and right side of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-left
               @see https://developer.mozilla.org/docs/Web/CSS/padding-right
               */
  px?: StandardCSSProperties["paddingLeft"];
  /**
               The **`paddingX`** property is shorthand for the CSS properties **`padding-left`** and **`padding-right`**. They set the width of the padding at the left and right sides of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-left
               @see https://developer.mozilla.org/docs/Web/CSS/padding-right
               */
  paddingX?: StandardCSSProperties["paddingLeft"];
  /**
               The **`py`** property is shorthand for the CSS properties **`padding-top`** and **`padding-bottom`**. They set the width of the padding at the top and bottom of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-top
               @see https://developer.mozilla.org/docs/Web/CSS/padding-bottom
               */
  py?: StandardCSSProperties["paddingTop"];
  /**
               The **`paddingY`** property is shorthand for the CSS properties **`padding-top`** and **`padding-bottom`**. They set the width of the padding at the top and bottom of an element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/padding-top
               @see https://developer.mozilla.org/docs/Web/CSS/padding-bottom
               */
  paddingY?: StandardCSSProperties["paddingTop"];
  /**
               The **`typography`** property  is shorthand for the CSS properties **`font-family`**, **`font-weight`**, **`font-size`**, **`line-height`**, **`letter-spacing`** and **`text-transform``**.
               It takes the values defined under `theme.typography` and spreads them on the element.

               Initial value: `0`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **2**  |  **1**  | **1**  | **12** | **5.5** |

               @see https://developer.mozilla.org/docs/Web/CSS/font-family
               @see https://developer.mozilla.org/docs/Web/CSS/font-weight
               @see https://developer.mozilla.org/docs/Web/CSS/font-size
               @see https://developer.mozilla.org/docs/Web/CSS/line-height
               @see https://developer.mozilla.org/docs/Web/CSS/letter-spacing
               @see https://developer.mozilla.org/docs/Web/CSS/text-transform
               */
  typography?: TypographyKeys;
  /**
               The **`displayPrint`** property sets the display value for the element when the page is printed.

               Initial value: `inline`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/display
               */
  displayPrint?: StandardCSSProperties["display"];
  /**
       Makes the element span n-columns wide. It has no effect if its parent is not a grid container.
       "full" will take the full width of the grid container.
       */
  gridColumnSpan?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | "full";
  /**
       Makes the element span n-rows high. It has no effect if its parent is not a grid container.
       "full" will take the full height of the grid container.
       */
  gridRowSpan?: number | "full";
}

/**
 * CSS properties whose standard typings are widened to also accept Yolm
 * theme tokens — e.g. palette names for colors, shadow/fontWeight/transition
 * token keys. These override the matching {@link StandardCSSProperties}.
 */
export interface OverwriteCSSProperties {
  color?: css.Property.Color | SimplifiedPaletteVars;
  borderColor?: css.Property.Color | SimplifiedPaletteVars;
  backgroundColor?: css.Property.BackgroundColor | SimplifiedPaletteVars;
  /**
               The **`border`** CSS property is shorthand for the CSS properties **`border-width`**, **`border-style`**, and **`border-color`**. It sets an element's border.

               Initial value: `none`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **1**  |  **1**  | **1**  | **12** | **4** |

               @see https://developer.mozilla.org/docs/Web/CSS/border
               */
  border?: css.Property.Border | number;
  /**
               The **`box-shadow`** CSS property adds shadow effects around an element's frame. You can set multiple effects separated by commas. A box shadow is described by X and Y offsets relative to the
               element for blur and spread radii, and by its color.

               Initial value: `none`

               | Chrome  | Firefox | Safari  |  Edge  |  IE   |
               | :-----: | :-----: | :-----: | :----: | :---: |
               | **10**  |  **4**  | **5.1** | **12** | **9** |
               | 1 _-x-_ |         | 3 _-x-_ |        |       |

               @see https://developer.mozilla.org/docs/Web/CSS/box-shadow
               */
  boxShadow?: css.Property.BoxShadow | keyof Tokens["shadow"];
  /**
               The **`font-weight`** CSS property specifies the weight (or boldness) of the font. The font weights available to you will depend on the `font-family` you are using. Some fonts are only
               available in `normal` and `bold`.

               Initial value: `normal`

               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **2**  |  **1**  | **1**  | **12** | **3** |

               @see https://developer.mozilla.org/docs/Web/CSS/font-weight
               */
  fontWeight?: css.Property.FontWeight | keyof Tokens["fontWeight"];
  /**
               The **`transition-duration`** CSS property sets the length of time a transition animation should take to complete. By default, the value is `0s`, meaning that no animation will occur.

               Initial value: `0s`
               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **26** | **16**  | **9**  | **12** | **10**|
               */
  transitionDuration?:
    | css.Property.TransitionDuration
    | keyof TransitionDurations;
  /**
               The **`transition-timing-function`** CSS property sets how intermediate values are calculated for CSS properties being affected by a transition effect.

               Initial value: `ease`
               | Chrome | Firefox | Safari |  Edge  |  IE   |
               | :----: | :-----: | :----: | :----: | :---: |
               | **26** | **16**  | **9**  | **12** | **10**|
               */
  transitionTimingFunction?:
    | css.Property.TransitionTimingFunction
    | keyof TransitionEasings;
}

/**
 Map of all CSS pseudo selectors (`:hover`, `:focus`, ...).
 */
export type CSSPseudoSelectorProps = {
  [
    K in
      | css.Pseudos
      | "dark"
      | "light"
      | "hoverEnabled"
      | "sm"
      | "md"
      | "lg"
      | "xl"
      | "2xl"
  ]?: Style;
};

/**
 Map all nested selectors.
 */
export interface CSSSelectorObject {
  [cssSelector: string]: Style;
}

type CssVariableType = string | number;

/**
 Map all nested selectors and CSS variables.
 */
export interface CSSSelectorObjectOrCssVariables {
  [cssSelectorOrVariable: string]: Style | CssVariableType;
}

/**
 Map of all available CSS properties (including aliases) and their sql value.
 Only used internally to map CSS properties to input types (responsive value,
 theme function or nested) in `SystemCssProperties`.
 */
export interface AllSystemCSSProperties
  extends
    Omit<StandardCSSProperties, keyof OverwriteCSSProperties>,
    OverwriteCSSProperties,
    AliasesCSSProperties {}

/**
 * {@link AllSystemCSSProperties} where each value may also be a nested
 * {@link Style} (for responsive/conditional values or selectors).
 */
export type SystemCssProperties = {
  [K in keyof AllSystemCSSProperties]: AllSystemCSSProperties[K] | Style;
};

/**
 * A single style object: CSS properties + aliases, pseudo-selector blocks
 * (`":hover"`, breakpoint keys, `dark`/`light`), and nested selectors / CSS
 * variables. This is the object accepted by the `sx` prop.
 */
export type StyleObject =
  | SystemCssProperties
  | CSSPseudoSelectorProps
  | CSSSelectorObjectOrCssVariables;

/**
 * Anything assignable to `sx`: a {@link StyleObject}, an array of styles, or
 * a falsy value (for conditional styling). Arrays are merged in order.
 */
export type Style = StyleObject | null | false | undefined | Style[];

/** for anywhere we want just a simple css in js object */
export interface CSSObject
  extends
    css.StandardProperties<number | string>,
    css.SvgProperties<number | string> {}

/**
 For animation keyframe definition
 */
export interface KeyFrames {
  [
    /** stuff like `from`, `to` or `10%` etc*/
    key: string
  ]: Style | undefined;
}

declare module "csstype" {
  // @ts-ignore — TypeScript 7 is stricter about augmentation compatibility with generic base interfaces
  export interface Properties {
    /**
     * The mix-blend-mode CSS property sets how an element's content should blend with the content of the element's parent and the element's background.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/mix-blend-mode
     */
    mixBlendMode?:
      | "normal"
      | "multiply"
      | "screen"
      | "overlay"
      | "darken"
      | "lighten"
      | "color-dodge"
      | "color-burn"
      | "hard-light"
      | "soft-light"
      | "difference"
      | "exclusion"
      | "hue"
      | "saturation"
      | "color"
      | "luminosity"
      | "plus-darker"
      | "plus-lighter"
      | AnyString;

    /**
     * The text-wrap CSS property controls how text inside an element is wrapped.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap
     */
    textWrap?: "wrap" | "nowrap" | "balance" | "pretty" | AnyString;

    /**
     * The box-decoration-break CSS property specifies how an element's fragments should be rendered when broken across multiple lines, columns, or pages.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/box-decoration-break
     */
    boxDecorationBreak?: "slice" | "clone" | AnyString;

    /**
     * The hyphens CSS property specifies how words should be hyphenated when text wraps across multiple lines.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/hyphens
     */
    hyphens?: "none" | "manual" | "auto" | AnyString;

    /**
     * The forced-color-adjust CSS property allows authors to opt certain elements out of forced colors mode.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/forced-color-adjust
     */
    forcedColorAdjust?: "auto" | "none" | AnyString;

    /**
     * Webkit-specific font smoothing property
     */
    WebkitFontSmoothing?:
      | "auto"
      | "none"
      | "antialiased"
      | "subpixel-antialiased"
      | AnyString;

    /**
     * Mozilla-specific font smoothing property
     */
    MozOsxFontSmoothing?:
      | "auto"
      | "inherit"
      | "unset"
      | "grayscale"
      | AnyString;

    /**
     * Webkit-specific background-clip property for text clipping
     */
    WebkitBackgroundClip?:
      | "border-box"
      | "padding-box"
      | "content-box"
      | "text"
      | AnyString;

    /**
     * The break-after CSS property sets how page, column, or region breaks should behave after a generated box.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/break-after
     */
    breakAfter?:
      | "auto"
      | "avoid"
      | "always"
      | "all"
      | "avoid-page"
      | "page"
      | "left"
      | "right"
      | "recto"
      | "verso"
      | "avoid-column"
      | "column"
      | "avoid-region"
      | "region"
      | AnyString;

    /**
     * The break-before CSS property sets how page, column, or region breaks should behave before a generated box.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/break-before
     */
    breakBefore?:
      | "auto"
      | "avoid"
      | "always"
      | "all"
      | "avoid-page"
      | "page"
      | "left"
      | "right"
      | "recto"
      | "verso"
      | "avoid-column"
      | "column"
      | "avoid-region"
      | "region"
      | AnyString;

    /**
     * The break-inside CSS property sets how page, column, or region breaks should behave inside a generated box.
     * https://developer.mozilla.org/en-US/docs/Web/CSS/break-inside
     */
    breakInside?:
      | "auto"
      | "avoid"
      | "avoid-page"
      | "avoid-column"
      | "avoid-region"
      | AnyString;

    /**
     * Logical border color properties
     */
    borderInlineStartColor?: string;
    borderInlineEndColor?: string;
    borderBlockStartColor?: string;
    borderBlockEndColor?: string;

    /**
     * Logical border width properties
     */
    borderInlineStartWidth?: string | number;
    borderInlineEndWidth?: string | number;
    borderBlockStartWidth?: string | number;
    borderBlockEndWidth?: string | number;

    /**
     * Logical border radius properties
     */
    borderStartStartRadius?: string | number;
    borderStartEndRadius?: string | number;
    borderEndStartRadius?: string | number;
    borderEndEndRadius?: string | number;
  }
}
