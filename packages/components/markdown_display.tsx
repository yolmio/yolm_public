import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles, cssVar } from "std/style_utils";

interface MarkdownDisplayProps {
  /** The markdown content to render (SQL expression that evaluates to a string) */
  content: Sql;
  /** Additional CSS class names */
  className?: string;
  /** Custom styles */
  sx?: Style;
}

const styles = createStyles({
  root: {
    lineHeight: 1.6,
    color: cssVar("palette-text-secondary"),
    "& h1": {
      fontSize: "1.5rem",
      fontWeight: 600,
      marginTop: "1.5rem",
      marginBottom: "0.75rem",
      color: cssVar("palette-text-primary"),
      "&:first-child": {
        marginTop: 0,
      },
    },
    "& h2": {
      fontSize: "1.25rem",
      fontWeight: 600,
      marginTop: "1.25rem",
      marginBottom: "0.5rem",
      color: cssVar("palette-text-primary"),
    },
    "& h3": {
      fontSize: "1.1rem",
      fontWeight: 600,
      marginTop: "1rem",
      marginBottom: "0.5rem",
      color: cssVar("palette-text-primary"),
    },
    "& h4, & h5, & h6": {
      fontSize: "1rem",
      fontWeight: 600,
      marginTop: "0.75rem",
      marginBottom: "0.25rem",
      color: cssVar("palette-text-primary"),
    },
    "& p": {
      marginTop: "0.5rem",
      marginBottom: "0.5rem",
    },
    "& ul, & ol": {
      marginTop: "0.5rem",
      marginBottom: "0.5rem",
      paddingLeft: "1.5rem",
    },
    "& li": {
      marginTop: "0.25rem",
      marginBottom: "0.25rem",
    },
    "& code": {
      backgroundColor: cssVar("palette-background-level2"),
      padding: "0.125rem 0.25rem",
      borderRadius: cssVar("radius-xs"),
      fontSize: "0.875em",
      fontFamily: "monospace",
    },
    "& pre": {
      backgroundColor: cssVar("palette-background-level2"),
      padding: "0.75rem 1rem",
      borderRadius: cssVar("radius-sm"),
      overflowX: "auto",
      marginTop: "0.75rem",
      marginBottom: "0.75rem",
      "& code": {
        backgroundColor: "transparent",
        padding: 0,
        borderRadius: 0,
      },
    },
    "& blockquote": {
      borderLeft: `3px solid ${cssVar("palette-divider")}`,
      paddingLeft: "1rem",
      marginLeft: 0,
      marginTop: "0.75rem",
      marginBottom: "0.75rem",
      color: cssVar("palette-text-tertiary"),
      fontStyle: "italic",
    },
    "& a": {
      color: cssVar("palette-primary-600"),
      textDecoration: "none",
      "&:hover": {
        textDecoration: "underline",
      },
    },
    "& hr": {
      border: "none",
      borderTop: `1px solid ${cssVar("palette-divider")}`,
      marginTop: "1rem",
      marginBottom: "1rem",
    },
    "& table": {
      borderCollapse: "collapse",
      width: "100%",
      marginTop: "0.75rem",
      marginBottom: "0.75rem",
    },
    "& th, & td": {
      border: `1px solid ${cssVar("palette-divider")}`,
      padding: "0.5rem 0.75rem",
      textAlign: "left",
    },
    "& th": {
      backgroundColor: cssVar("palette-background-level1"),
      fontWeight: 600,
    },
    "& strong": {
      fontWeight: 600,
    },
    "& em": {
      fontStyle: "italic",
    },
  },
});

/**
 * A component that renders markdown content as HTML.
 *
 * Uses the `markdown.to_html` SQL function to convert markdown to HTML.
 *
 * @example
 * ```tsx
 * <MarkdownDisplay content={sql`plan_data.content`} />
 * ```
 */
export function MarkdownDisplay(
  { content, className, sx }: MarkdownDisplayProps,
) {
  return (
    <div
      className={className}
      sx={[styles.root, sx]}
      dangerouslySetInnerHTML={sql`markdown.to_html(${content})`}
    />
  );
}
