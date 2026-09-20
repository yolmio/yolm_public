/** CSS styles for the editor content area (page-like appearance) */
export const editorContentStyles = {
  cursor: "text",
  outline: "none",
  lineHeight: 1.5,
  overflowWrap: "break-word" as const,
  wordBreak: "break-word" as const,
  fontSize: "11pt",
  fontFamily: "Calibri, Arial, sans-serif",
  color: "#000",
  "& *": { boxSizing: "border-box", margin: 0, padding: 0 },
  "& > *:last-child": { marginBottom: 0 },
  // Paragraphs
  "& .lexical-paragraph": { margin: "0 0 0.5em 0" },
  "& .lexical-paragraph:last-child": { marginBottom: 0 },
  "& p": { marginBottom: "0.5em" },
  // Text formatting
  "& .lexical-text-bold, & .editor-bold": { fontWeight: "bold" },
  "& .lexical-text-italic, & .editor-italic": { fontStyle: "italic" },
  "& .lexical-text-underline": { textDecoration: "underline" },
  "& .lexical-text-strikethrough, & .editor-strikethrough": {
    textDecoration: "line-through",
  },
  "& .lexical-text-subscript": { fontSize: "0.8em", verticalAlign: "sub" },
  "& .lexical-text-superscript": {
    fontSize: "0.8em",
    verticalAlign: "super",
  },
  // Headings
  "& .lexical-heading-h1, & h1": {
    fontSize: "2em",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginBottom: "0.5em",
  },
  "& .lexical-heading-h2": {
    fontSize: "1.5em",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginBottom: "0.5em",
  },
  "& .lexical-heading-h3": {
    fontSize: "1.17em",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginBottom: "0.5em",
  },
  "& .lexical-heading-h4": {
    fontSize: "1em",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginBottom: "0.5em",
  },
  "& .lexical-heading-h5": {
    fontSize: "0.83em",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginBottom: "0.5em",
  },
  "& .lexical-heading-h6": {
    fontSize: "0.67em",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginBottom: "0.5em",
  },
  // Quotes
  "& .lexical-quote, & blockquote": {
    border: "0 solid",
    borderColor: "#ccc",
    borderLeftWidth: "4px",
    marginLeft: "0",
    paddingLeft: "16px",
    marginBottom: "0.5em",
    color: "#555",
    fontStyle: "italic",
  },
  // Lists
  "& .lexical-list-ol": {
    listStyleType: "decimal",
    margin: "0 0 0.5em 0",
    paddingLeft: "1.5em",
  },
  "& .lexical-list-ul": {
    listStyleType: "disc",
    margin: "0 0 0.5em 0",
    paddingLeft: "1.5em",
  },
  "& .lexical-listitem": { margin: 0 },
  "& .lexical-nested-list-item, & .editor-nested-list-item": {
    listStyleType: "none",
  },
  "& li": { marginLeft: "1em" },
  // Links
  "& .lexical-link": { color: "#0563C1", textDecoration: "underline" },
  // Tables
  "& .lexical-table": {
    borderCollapse: "collapse",
    width: "100%",
    marginBottom: "1em",
    border: "1px solid #bbb",
  },
  "& .lexical-table-row": {},
  "& .lexical-table-cell": {
    border: "1px solid #bbb",
    padding: "6px 8px",
    minWidth: "40px",
    verticalAlign: "top",
  },
  "& .lexical-table-cell-header": {
    border: "1px solid #bbb",
    padding: "6px 8px",
    minWidth: "40px",
    verticalAlign: "top",
    backgroundColor: "#f0f0f0",
    fontWeight: "bold",
  },
  // General table fallback
  "& table": {
    borderCollapse: "collapse",
    width: "100%",
    marginBottom: "1em",
  },
  "& th, & td": {
    border: "1px solid #bbb",
    padding: "6px 8px",
    minWidth: "40px",
  },
  "& th": {
    backgroundColor: "#f0f0f0",
    fontWeight: "bold",
  },
  "& .lexical-image": {
    margin: "0 0 12px 0",
    userSelect: "none",
  },
  "& .lexical-image img": {
    maxWidth: "100%",
    height: "auto",
  },
  "& .lexical-image-selected img": {
    borderColor: "#2563eb !important",
    boxShadow: "0 0 0 2px rgba(37, 99, 235, 0.25)",
  },
};
