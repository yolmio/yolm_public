import type { CSSObject } from "./style_types";

/** Focus-ring styling: its thickness and the default outline CSS applied. */
export interface Focus {
  thickness: string;
  default: CSSObject;
}

/** The four font-family roles the theme exposes as `--font-family-*` vars. */
export interface FontFamily {
  body: string;
  display: string;
  code: string;
  fallback: string;
}

/** Named typography levels accepted by the `typography`/`level` props. */
export type TypographyKeys =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "title-lg"
  | "title-md"
  | "title-sm"
  | "body-lg"
  | "body-md"
  | "body-sm"
  | "body-xs";

export interface TypographySystem extends Record<TypographyKeys, CSSObject> {}

/**
 * The resolved color/background/border values for one palette color across
 * all four {@link Variant}s (`plain`/`outlined`/`soft`/`solid`) and their
 * hover/active/disabled states. Forms part of a {@link PaletteRange}.
 */
export interface PaletteVariant {
  plainColor: string;
  plainBg: string;
  // hover state
  plainHoverColor: string;
  plainHoverBg: string;
  // active state
  plainActiveColor: string;
  plainActiveBg: string;
  // disabled state
  plainDisabledColor: string;
  plainDisabledBg: string;

  outlinedColor: string;
  outlinedBorder: string;
  outlinedBg: string;
  // hover state
  outlinedHoverColor: string;
  outlinedHoverBorder: string;
  outlinedHoverBg: string;
  // active state
  outlinedActiveColor: string;
  outlinedActiveBorder: string;
  outlinedActiveBg: string;
  // disabled state
  outlinedDisabledColor: string;
  outlinedDisabledBorder: string;
  outlinedDisabledBg: string;

  softColor: string;
  softBg: string;
  // hover state
  softHoverColor: string;
  softHoverBg: string;
  // active state
  softActiveColor: string;
  softActiveBg: string;
  // disabled state
  softDisabledColor?: string;
  softDisabledBg: string;

  solidColor: string;
  solidBg: string;
  // hover state
  solidHoverColor: string;
  solidHoverBg: string;
  // active state
  solidActiveColor: string;
  solidActiveBg: string;
  // disabled state
  solidDisabledColor: string;
  solidDisabledBg: string;
}

export interface ColorScale {
  "50": string;
  "100": string;
  "200": string;
  "300": string;
  "400": string;
  "500": string;
  "600": string;
  "700": string;
  "800": string;
  "900": string;
  "950": string;
}

export type ColorScaleKey = keyof ColorScale;

/**
 * A full palette color: the 50–950 {@link ColorScale} steps, the per-variant
 * {@link PaletteVariant} values, plus `*Channel` RGB-channel strings used to
 * compose `rgba(... / alpha)` values.
 */
export interface PaletteRange
  extends Record<ColorScaleKey, string>, PaletteVariant {
  mainChannel: string;
  lightChannel: string;
  darkChannel: string;
}

export interface PaletteCommon {
  white: string;
  black: string;
}

export interface PaletteText {
  primary: string;
  secondary: string;
  tertiary: string;
  icon: string;
}

export interface PaletteBackground {
  body: string;
  surface: string;
  level1: string;
  level2: string;
  level3: string;
  tooltip: string;
  backdrop: string;
  popup: string;
}

/**
 * The semantic palette colors selectable via a component's `color` prop.
 * Each maps to a {@link PaletteRange} in the active {@link Palette}.
 */
export type ColorPaletteProp =
  | "primary"
  | "neutral"
  | "danger"
  | "success"
  | "warning";

/**
 * The complete set of colors for one color scheme: the five semantic
 * {@link PaletteRange}s plus common/text/background/divider/focus tokens.
 */
export interface Palette {
  primary: PaletteRange;
  neutral: PaletteRange;
  danger: PaletteRange;
  success: PaletteRange;
  warning: PaletteRange;
  common: PaletteCommon;
  text: PaletteText;
  background: PaletteBackground;
  divider: string;
  focusVisible: string;
}

/**
 * One of the four Joy-style visual treatments applied to themed components.
 *
 * - `solid` — filled background, high emphasis (primary CTAs).
 * - `soft`  — tinted background, lower emphasis (secondary actions).
 * - `outlined` — bordered, transparent background (tertiary actions).
 * - `plain` — no background or border, just colored text (links/links-as-buttons).
 *
 * Most themed components (`Button`, `Chip`, `Alert`, `IconButton`, …)
 * accept a `variant` prop of this type, paired with `color` and `size`.
 */
export type Variant = "soft" | "solid" | "outlined" | "plain";

type Kebab<
  T extends string,
  A extends string = "",
> = T extends `${infer F}${infer R}`
  ? Kebab<R, `${A}${F extends Lowercase<F> ? "" : "-"}${Lowercase<F>}`>
  : A;

/** These css vars are applied depending on the light/dark mode */
export type PaletteCssVars =
  | `shadow-ring`
  | `shadow-channel`
  | `shadow-opacity`
  | `palette-primary-${Kebab<keyof Palette["primary"]>}`
  | `palette-neutral-${Kebab<keyof Palette["neutral"]>}`
  | `palette-danger-${Kebab<keyof Palette["danger"]>}`
  | `palette-success-${Kebab<keyof Palette["success"]>}`
  | `palette-warning-${Kebab<keyof Palette["warning"]>}`
  | `palette-common-${Kebab<keyof Palette["common"]>}`
  | `palette-text-${Kebab<keyof Palette["text"]>}`
  | `palette-background-${Kebab<keyof Palette["background"]>}`
  | `palette-divider`
  | `palette-focus-visible`;

/** One light or dark color scheme: its {@link Palette} plus shadow tokens. */
export interface ColorScheme {
  palette: Palette;
  shadowRing: string;
  shadowChannel: string;
  shadowOpacity: string;
}

export interface TransitionEasings {
  navigation: string;
  popover: string;
  dialog: string;
  drawer: string;
}

export interface TransitionDurations {
  navigation: string;
  drawer: string;
  popover: string;
  dialog: string;
}

/** These are the variables declared at :root and don't change for the lifetime of the app */
export type ConstantCssVars =
  | `focus-thickness`
  | `font-family-${keyof FontFamily}`
  | `transition-easing-${Kebab<keyof TransitionEasings>}`
  | `transition-duration-${Kebab<keyof TransitionDurations>}`;

export interface ColorTokens {
  slate: ColorScale;
  gray: ColorScale;
  zinc: ColorScale;
  neutral: ColorScale;
  stone: ColorScale;
  red: ColorScale;
  orange: ColorScale;
  amber: ColorScale;
  yellow: ColorScale;
  lime: ColorScale;
  green: ColorScale;
  emerald: ColorScale;
  teal: ColorScale;
  cyan: ColorScale;
  sky: ColorScale;
  blue: ColorScale;
  indigo: ColorScale;
  violet: ColorScale;
  purple: ColorScale;
  fuchsia: ColorScale;
  pink: ColorScale;
  rose: ColorScale;
  [other: string]: string | ColorScale;
}

// Container tokens
export interface ContainerTokens {
  "3xs": string;
  "2xs": string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
  "4xl": string;
  "5xl": string;
  "6xl": string;
  "7xl": string;
}

// Font family tokens
export interface FontFamilyTokens {
  sans: string;
  serif: string;
  mono: string;
}

// Font size tokens
export interface FontSizeTokens {
  xs: string;
  sm: string;
  base: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
  "4xl": string;
  "5xl": string;
  "6xl": string;
  "7xl": string;
  "8xl": string;
  "9xl": string;
}

// Font weight tokens
export interface FontWeightTokens {
  thin: string;
  extralight: string;
  light: string;
  normal: string;
  medium: string;
  semibold: string;
  bold: string;
  extrabold: string;
  black: string;
}

// Letter spacing tokens
export interface LetterSpacingTokens {
  tighter: string;
  tight: string;
  normal: string;
  wide: string;
  wider: string;
  widest: string;
}

// Line height tokens
export interface LineHeightTokens {
  none: string;
  tight: string;
  snug: string;
  normal: string;
  relaxed: string;
  loose: string;
}

// Border radius tokens
export interface BorderRadiusTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
  "4xl": string;
  full: string;
}

// Shadow tokens
export interface ShadowTokens {
  "2xs": string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  inset: {
    "2xs": string;
    xs: string;
    sm: string;
  };
}

// Drop shadow tokens
export interface DropShadowTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
}

// Blur tokens
export interface BlurTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
}

// Perspective tokens
export interface PerspectiveTokens {
  dramatic: string;
  near: string;
  normal: string;
  midrange: string;
  distant: string;
}

// Aspect ratio tokens
export interface AspectRatioTokens {
  video: string;
}

// Easing tokens
export interface EasingTokens {
  in: string;
  out: string;
  inOut: string;
}

// Animation tokens
export interface AnimationTokens {
  spin: string;
  ping: string;
  pulse: string;
  bounce: string;
}

// Breakpoint tokens
export interface BreakpointTokens {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
}

/**
 * The Tailwind-style design-token scales (colors, spacing, typography,
 * radii, shadows, breakpoints, …) exposed on {@link Theme.tokens} and
 * surfaced as CSS variables (see {@link TokensCssVar}).
 */
export interface Tokens {
  colors: ColorTokens;
  breakpoints: BreakpointTokens;
  containers: ContainerTokens;
  fontFamily: FontFamilyTokens;
  fontSize: FontSizeTokens;
  fontWeight: FontWeightTokens;
  letterSpacing: LetterSpacingTokens;
  lineHeight: LineHeightTokens;
  borderRadius: BorderRadiusTokens;
  shadow: ShadowTokens;
  dropShadow: DropShadowTokens;
  blur: BlurTokens;
  perspective: PerspectiveTokens;
  aspectRatio: AspectRatioTokens;
  easing: EasingTokens;
  animation: AnimationTokens;
}

/** CSS-variable names for every design token in {@link Tokens}. */
export type TokensCssVar =
  | "font-sans"
  | "font-serif"
  | "font-mono"
  | "spacing"
  | "breakpoint-sm"
  | "breakpoint-md"
  | "breakpoint-lg"
  | "breakpoint-xl"
  | "breakpoint-2xl"
  | "container-3xs"
  | "container-2xs"
  | "container-xs"
  | "container-sm"
  | "container-md"
  | "container-lg"
  | "container-xl"
  | "container-2xl"
  | "container-3xl"
  | "container-4xl"
  | "container-5xl"
  | "container-6xl"
  | "container-7xl"
  | "text-xs"
  | "text-xs--line-height"
  | "text-sm"
  | "text-sm--line-height"
  | "text-base"
  | "text-base--line-height"
  | "text-lg"
  | "text-lg--line-height"
  | "text-xl"
  | "text-xl--line-height"
  | "text-2xl"
  | "text-2xl--line-height"
  | "text-3xl"
  | "text-3xl--line-height"
  | "text-4xl"
  | "text-4xl--line-height"
  | "text-5xl"
  | "text-5xl--line-height"
  | "text-6xl"
  | "text-6xl--line-height"
  | "text-7xl"
  | "text-7xl--line-height"
  | "text-8xl"
  | "text-8xl--line-height"
  | "text-9xl"
  | "text-9xl--line-height"
  | "font-weight-thin"
  | "font-weight-extralight"
  | "font-weight-light"
  | "font-weight-normal"
  | "font-weight-medium"
  | "font-weight-semibold"
  | "font-weight-bold"
  | "font-weight-extrabold"
  | "font-weight-black"
  | "tracking-tighter"
  | "tracking-tight"
  | "tracking-normal"
  | "tracking-wide"
  | "tracking-wider"
  | "tracking-widest"
  | "leading-tight"
  | "leading-snug"
  | "leading-normal"
  | "leading-relaxed"
  | "leading-loose"
  | "radius-xs"
  | "radius-sm"
  | "radius-md"
  | "radius-lg"
  | "radius-xl"
  | "radius-2xl"
  | "radius-3xl"
  | "radius-4xl"
  | "shadow-2xs"
  | "shadow-xs"
  | "shadow-sm"
  | "shadow-md"
  | "shadow-lg"
  | "shadow-xl"
  | "shadow-2xl"
  | "inset-shadow-2xs"
  | "inset-shadow-xs"
  | "inset-shadow-sm"
  | "drop-shadow-xs"
  | "drop-shadow-sm"
  | "drop-shadow-md"
  | "drop-shadow-lg"
  | "drop-shadow-xl"
  | "drop-shadow-2xl"
  | "blur-xs"
  | "blur-sm"
  | "blur-md"
  | "blur-lg"
  | "blur-xl"
  | "blur-2xl"
  | "blur-3xl"
  | "perspective-dramatic"
  | "perspective-near"
  | "perspective-normal"
  | "perspective-midrange"
  | "perspective-distant"
  | "aspect-video"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "animate-spin"
  | "animate-ping"
  | "animate-pulse"
  | "animate-bounce";

/**
 * Every CSS-variable name Yolm registers on `:root` — constant vars, palette
 * vars, and token vars combined. This is the argument type of `cssVar`.
 */
export type CssVar = ConstantCssVars | PaletteCssVars | TokensCssVar;

/**
 * The resolved theme for an app: light/dark color schemes, typography, fonts,
 * the `spacing()` scale function, transition easings/durations, and the
 * design {@link Tokens}.
 */
export interface Theme {
  lightColorScheme: ColorScheme;
  darkColorScheme: ColorScheme;

  focus: Focus;
  typography: TypographySystem;
  fontFamily: FontFamily;

  spacing(num: number | "px" | "full"): string;

  transitionEasing: TransitionEasings;
  transitionDurations: TransitionDurations;

  tokens: Tokens;
}
