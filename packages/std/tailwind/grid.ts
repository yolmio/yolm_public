import type { Parser } from "./types";
import { getThemeToken } from "./utils";

// Grid template columns parser
export const gridTemplateColumnsParser: Parser = (className, theme) => {
  const match = className.match(/^grid-cols-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Check theme first
  const cols = getThemeToken(theme, "gridTemplateColumns", value);
  if (cols) {
    return { gridTemplateColumns: String(cols) };
  }

  // Handle numeric values
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return { gridTemplateColumns: `repeat(${num}, minmax(0, 1fr))` };
  }

  // Handle keywords
  const keywords: Record<string, string> = {
    none: "none",
    subgrid: "subgrid",
  };

  return keywords[value] ? { gridTemplateColumns: keywords[value] } : null;
};

// Grid template rows parser
export const gridTemplateRowsParser: Parser = (className, theme) => {
  const match = className.match(/^grid-rows-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Check theme first
  const rows = getThemeToken(theme, "gridTemplateRows", value);
  if (rows) {
    return { gridTemplateRows: String(rows) };
  }

  // Handle numeric values
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return { gridTemplateRows: `repeat(${num}, minmax(0, 1fr))` };
  }

  // Handle keywords
  const keywords: Record<string, string> = {
    none: "none",
    subgrid: "subgrid",
  };

  return keywords[value] ? { gridTemplateRows: keywords[value] } : null;
};

// Grid column span parser
export const gridColumnParser: Parser = (className, _theme) => {
  const match = className.match(/^col-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Check for span
  if (value.startsWith("span-")) {
    const span = value.slice(5);
    const num = parseFloat(span);

    if (span === "full") {
      return { gridColumn: "1 / -1" };
    } else if (!isNaN(num)) {
      return { gridColumn: `span ${num} / span ${num}` };
    }
  }

  // Check for start/end
  if (value.startsWith("start-")) {
    const start = value.slice(6);
    const num = parseFloat(start);

    if (start === "auto") {
      return { gridColumnStart: "auto" };
    } else if (!isNaN(num)) {
      return { gridColumnStart: start };
    }
  }

  if (value.startsWith("end-")) {
    const end = value.slice(4);
    const num = parseFloat(end);

    if (end === "auto") {
      return { gridColumnEnd: "auto" };
    } else if (!isNaN(num)) {
      return { gridColumnEnd: end };
    }
  }

  // Handle auto
  if (value === "auto") {
    return { gridColumn: "auto" };
  }

  return null;
};

// Grid row span parser
export const gridRowParser: Parser = (className, _theme) => {
  const match = className.match(/^row-(.+)$/);
  if (!match) return null;

  const [, value] = match;

  // Check for span
  if (value.startsWith("span-")) {
    const span = value.slice(5);
    const num = parseFloat(span);

    if (span === "full") {
      return { gridRow: "1 / -1" };
    } else if (!isNaN(num)) {
      return { gridRow: `span ${num} / span ${num}` };
    }
  }

  // Check for start/end
  if (value.startsWith("start-")) {
    const start = value.slice(6);
    const num = parseFloat(start);

    if (start === "auto") {
      return { gridRowStart: "auto" };
    } else if (!isNaN(num)) {
      return { gridRowStart: start };
    }
  }

  if (value.startsWith("end-")) {
    const end = value.slice(4);
    const num = parseFloat(end);

    if (end === "auto") {
      return { gridRowEnd: "auto" };
    } else if (!isNaN(num)) {
      return { gridRowEnd: end };
    }
  }

  // Handle auto
  if (value === "auto") {
    return { gridRow: "auto" };
  }

  return null;
};

// Grid auto columns parser
export const gridAutoColumnsParser: Parser = (className, theme) => {
  const match = className.match(/^auto-cols-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const cols = getThemeToken(theme, "gridAutoColumns", value);

  if (cols) {
    return { gridAutoColumns: String(cols) };
  }

  const keywords: Record<string, string> = {
    auto: "auto",
    min: "min-content",
    max: "max-content",
    fr: "minmax(0, 1fr)",
  };

  return keywords[value] ? { gridAutoColumns: keywords[value] } : null;
};

// Grid auto rows parser
export const gridAutoRowsParser: Parser = (className, theme) => {
  const match = className.match(/^auto-rows-(.+)$/);
  if (!match) return null;

  const [, value] = match;
  const rows = getThemeToken(theme, "gridAutoRows", value);

  if (rows) {
    return { gridAutoRows: String(rows) };
  }

  const keywords: Record<string, string> = {
    auto: "auto",
    min: "min-content",
    max: "max-content",
    fr: "minmax(0, 1fr)",
  };

  return keywords[value] ? { gridAutoRows: keywords[value] } : null;
};
