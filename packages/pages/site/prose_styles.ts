/**
 * Shared prose styling for static website content rendered from TSX content
 * modules.
 *
 * This style object is intentionally semantic: it references `--site-*`
 * tokens supplied by the consuming app, and it does not define a concrete
 * palette. Use it for long-form public content such as legal pages, articles,
 * and blog post bodies.
 */
export const siteProseStyles = {
  "& h1": {
    fontSize: "2.5rem",
    fontWeight: "800",
    lineHeight: "1.2",
    mb: 8,
    color: "var(--site-text)",
  },
  "& h2": {
    fontSize: "2rem",
    fontWeight: "bold",
    lineHeight: "1.3",
    mt: 12,
    mb: 6,
    color: "var(--site-text)",
  },
  "& h3": {
    fontSize: "1.5rem",
    fontWeight: "semibold",
    lineHeight: "1.4",
    mt: 10,
    mb: 4,
    color: "var(--site-text)",
  },
  "& p": {
    fontSize: "1.125rem",
    lineHeight: "1.7",
    mb: 8,
    color: "var(--site-text-body)",
  },
  "& a": {
    color: "var(--site-accent)",
    textDecoration: "none",
    "&:hover": {
      textDecoration: "underline",
    },
  },
  "& ul, & ol": {
    pl: 8,
    mb: 8,
  },
  "& li": {
    mb: 4,
    color: "var(--site-text-body)",
  },
  "& img": {
    maxWidth: "100%",
    height: "auto",
    borderRadius: "lg",
    mb: 8,
  },
  "& blockquote": {
    borderLeft: "4px solid",
    borderColor: "var(--site-shadow-brand)",
    pl: 8,
    py: 2,
    my: 8,
    color: "var(--site-text-body)",
    fontStyle: "italic",
  },
  "& pre": {
    bg: "var(--site-surface-alt)",
    p: 6,
    borderRadius: "md",
    overflowX: "auto",
    mb: 8,
  },
  "& code": {
    fontFamily: "var(--site-font-mono)",
    fontSize: "0.9em",
    bg: "var(--site-surface-alt)",
    px: 2,
    py: 1,
    borderRadius: "sm",
  },
} as const;
