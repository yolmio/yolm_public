import type { Parser } from "./types";
import { parseNumericValue } from "./utils";

// Flex basis parser
export const flexBasisParser: Parser = (className, theme) => {
  const match = className.match(/^basis-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const basis = parseNumericValue(value, theme, {
    scale: ["spacing", "flexBasis"],
    allowSpacingUnits: true,
    allowFractions: true,
    keywords: {
      auto: "auto",
      full: "100%",
    },
  });

  return basis ? { flexBasis: basis } : null;
};

// Flex grow parser
export const flexGrowParser: Parser = (className, theme) => {
  const match = className.match(/^grow-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const grow = parseNumericValue(value, theme, {
    scale: "flexGrow",
    defaultUnit: "",
  });

  return grow ? { flexGrow: grow } : null;
};

// Flex shrink parser
export const flexShrinkParser: Parser = (className, theme) => {
  const match = className.match(/^shrink-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const shrink = parseNumericValue(value, theme, {
    scale: "flexShrink",
    defaultUnit: "",
  });

  return shrink ? { flexShrink: shrink } : null;
};

// Order parser
export const orderParser: Parser = (className, theme) => {
  const match = className.match(/^-?order-(.+)$/);
  if (!match) return null;

  const isNegative = className.startsWith("-");
  const [, value] = match;
  const order = parseNumericValue(value, theme, {
    allowNegative: isNegative,
    scale: "order",
    defaultUnit: "",
  });

  return order ? { order: order } : null;
};
