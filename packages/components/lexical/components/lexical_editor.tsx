import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import type { Style } from "std/style_types";
import { createStyles, cssVar, getVariantStyle } from "std/style_utils";
import type { Variant } from "std/theme";
import { Data } from "std/data";
import { Each, Effect, Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import type { Color, Size } from "components/types";
import { useJsModule } from "std/js_modules";
import { system } from "std/system";
import { registerLexicalRichTextFunctions } from "./lexical_scalar_functions";

function ensureLexicalRichTextFunctions() {
  if (!system.scalarFunctions["lexical_rich_text_to_html"]) {
    registerLexicalRichTextFunctions(system);
  }
}

/**
 * Configuration for the @-mention typeahead picker.
 *
 * The caller provides the candidate source. When the user types the trigger
 * character (default `@`) followed by a query, the editor opens a popover
 * that lists matching candidates pulled from `query`. Selecting one inserts
 * a styled, atomic mention node carrying the candidate id.
 *
 * The query runs on every editor mount and on every keystroke that changes
 * the query string. For large source tables, guard the empty-query case
 * inside your query to skip the initial broad fetch:
 *
 * ```ts
 * query: (q) => sql`select id, name as label
 *                   from db.users
 *                   where ${q} != '' and contains(lower(name), lower(${q}))
 *                   limit 10`,
 * ```
 */
export interface MentionsConfig {
  /** Character(s) that open the typeahead. Defaults to `@`. */
  trigger?: string | string[];
  /**
   * Builds a SELECT statement returning the rows that should appear in the
   * popover. The query receives the current typed text after the trigger
   * and the active trigger (both `Sql` literals you can interpolate inline).
   * It must produce at least `id` and `label` columns. Additional columns are
   * reachable from {@link renderItem} via the row name `mention_record`.
   *
   * The query gets wrapped as `select * from (<your query>) as q limit N`,
   * so you can include `order by` and a smaller per-query `limit`; both are
   * preserved.
   */
  query: (queryText: Sql, trigger: Sql) => Sql;
  /**
   * If true, the candidate query runs on the client (useful when results
   * come from a UI table). Defaults to false (server-side execution).
   */
  localQuery?: boolean;
  /**
   * Override the row contents. The current row is exposed as
   * `mention_record` (e.g. `sql\`mention_record.label\``). The default row
   * renders as plain text from `mention_record.label`.
   */
  renderItem?: Node;
  /**
   * Called after the user picks a candidate and the mention node has been
   * inserted into the editor. The `id` matches the `id` column from your
   * query (whatever type that column has — BigInt, Uuid, String, etc.).
   */
  onInsert?: (s: DomStatements, id: Sql, trigger: Sql) => void;
  /**
   * Called when a previously inserted mention is clicked in the editor.
   * The `id` is a `String` (read from the DOM `data-mention-id` attribute)
   * regardless of the original column type, so cast it if you need to look
   * it up by a typed column (e.g. `cast(${id} as bigint)`).
   */
  onClick?: (s: DomStatements, id: Sql, trigger: Sql) => void;
  /**
   * Optionally stores a URL on the inserted node. Read-only rich text renders
   * nodes with a URL as links.
   */
  getUrl?: (id: Sql, trigger: Sql) => Sql;
  /**
   * Optionally classifies inserted nodes. The default `mention` kind is
   * returned by `lexical_extract_mention_ids`; other kinds are ignored.
   */
  getKind?: (trigger: Sql) => Sql;
  /**
   * Maximum number of results the popover will fetch. Used to wrap the
   * caller's query in `limit N`. Defaults to 50.
   */
  maxResults?: number;
}

interface RichTextSimpleEditorProps {
  size?: Size;
  variant?: Variant;
  color?: Color;
  sx?: Style;
  className?: string;
  id?: Sql | string;
  /** Caller-provided handle for issuing editor commands from nearby controls. */
  editorHandle?: Sql;
  style?: Partial<Record<string, Sql>>;
  value?: Sql;
  onChange?: (s: DomStatements, value: Sql) => void;
  onImageBlobHashesChange?: (s: DomStatements, imageBlobHashes: Sql) => void;
  /** A platform file input receiving each managed inline image upload. */
  imageUploadInputId?: Sql;
  onImageUploadStateChange?: (s: DomStatements, state: Sql) => void;
  /** Debounce editor change callbacks in milliseconds. Defaults to 50. */
  onChangeDebounceMs?: number;
  /** Show extended toolbar with underline, subscript, superscript, alignment, and clear formatting */
  extendedToolbar?: boolean;
  /** Preserve intentional inline styles already present in serialized JSON. */
  preserveStoredTextStyles?: boolean;
  /** Preserve inline CSS copied from external HTML. */
  preservePastedTextStyles?: boolean;
  /** Show the constrained font-family and point-size document controls. */
  documentFormatting?: boolean;
  /** Permit image insertion and paste. Defaults to true. */
  allowImages?: boolean;
  showVariables?: boolean;
  variables?: Record<string, string>;
  variableButtonLabel?: string;
  /** Enable mentions/references with a caller-supplied candidate source. */
  mentions?: MentionsConfig;
}

interface OwnerState {
  size: Size;
  variant: Variant;
  color: Color;
}

/** Browser presentation matching the shared native Lexical document renderer. */
export const lexicalDocumentFormattingStyles: Style = {
  fontFamily: "Noto Sans, sans-serif",
  fontSize: "10pt",
  lineHeight: 1.56,
  textAlign: "justify",
  "& .lexical-paragraph, & p": {
    marginTop: 0,
    marginX: 0,
    marginBottom: "6pt",
  },
  "& .lexical-paragraph:empty": {
    minHeight: "15.6pt",
  },
  "& .lexical-heading-h1, & h1": {
    fontSize: "15pt",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginTop: "4pt",
    marginX: 0,
    marginBottom: "6pt",
  },
  "& .lexical-heading-h2, & h2": {
    fontSize: "13pt",
    fontWeight: "bold",
    lineHeight: 1.2,
    marginTop: "4pt",
    marginX: 0,
    marginBottom: "6pt",
  },
  "& .lexical-heading-h3, & h3, & .lexical-heading-h4, & h4, & .lexical-heading-h5, & h5, & .lexical-heading-h6, & h6":
    {
      fontSize: "11pt",
      fontWeight: "bold",
      lineHeight: 1.2,
      marginTop: "4pt",
      marginX: 0,
      marginBottom: "6pt",
    },
  "& .lexical-quote, & blockquote": {
    borderLeftWidth: "2pt",
    marginTop: 0,
    marginX: 0,
    marginBottom: "6pt",
    paddingLeft: "10pt",
  },
  "& .lexical-list-ol, & .lexical-list-ul": {
    marginTop: 0,
    marginX: 0,
    marginBottom: "6pt",
    paddingLeft: "18pt",
  },
  "& .lexical-table, & table": {
    marginBottom: "6pt",
    border: "0.5pt solid #bebebe",
  },
  "& .lexical-table-cell, & .lexical-table-cell-header, & th, & td": {
    border: "0.5pt solid #bebebe",
    padding: "5pt",
  },
  "& hr": {
    marginTop: "4pt",
    marginX: 0,
    marginBottom: "6pt",
    borderWidth: "0.5pt 0 0 0",
  },
};

/** Read-only document surface at the proposal PDF's 6.8-inch text width. */
export const lexicalDocumentDisplayStyles: Style = {
  ...lexicalDocumentFormattingStyles,
  width: "100%",
  maxWidth: "6.8in",
  marginX: "auto",
};

const lexicalDocumentEditorStyles: Style = {
  ...lexicalDocumentFormattingStyles,
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "calc(6.8in + var(--editor-padding-x) + var(--editor-padding-x))",
  marginX: "auto",
};

const styles = createStyles({
  root: (_, { size, variant, color }: OwnerState) => ({
    "--editor-radius": cssVar("radius-sm"),
    "--editor-gap": "0.5rem",
    "--editor-placeholder-color": "inherit",
    "--editor-placeholder-opacity": "0.5",
    "--editor-focused-thickness": cssVar("focus-thickness"),
    "--editor-focused-highlight": color === "harmonize"
      ? cssVar("palette-focus-visible")
      : cssVar(`palette-${color === "neutral" ? "primary" : color}-500`),
    ...(size === "xs" && {
      "--editor-min-height": "1.5rem",
      "--editor-padding-y": "calc(0.25rem - var(--variant-border-width, 0px))",
      "--editor-padding-x": "0.375rem",
      "--editor-gap": "0.375rem",
    }),
    ...(size === "sm" && {
      "--editor-min-height": "2rem",
      "--editor-padding-y": "calc(0.5rem - var(--variant-border-width, 0px))",
      "--editor-padding-x": "0.5rem",
    }),
    ...(size === "md" && {
      "--editor-min-height": "2.5rem",
      "--editor-padding-y": "calc(0.5rem - var(--variant-border-width, 0px))",
      "--editor-padding-x": "0.75rem",
    }),
    ...(size === "lg" && {
      "--editor-min-height": "3rem",
      "--editor-padding-y": "calc(0.75rem - var(--variant-border-width, 0px))",
      "--editor-padding-x": "1rem",
      "--editor-gap": "0.75rem",
    }),
    boxSizing: "border-box",
    minWidth: 0,
    position: "relative",
    borderRadius: "var(--editor-radius)",
    ...getVariantStyle(variant, color),
    backgroundColor: variant === "plain" || variant === "outlined"
      ? cssVar("palette-background-surface")
      : (getVariantStyle(variant, color) as any).backgroundColor,
    "&:focus-within": {
      outlineColor: "var(--editor-focused-highlight)",
      outlineWidth: "var(--editor-focused-thickness)",
      outlineStyle: "solid",
    },
    "&:hover:not(:focus-within)": {
      ...getVariantStyle(variant, color, "hover"),
      backgroundColor: null,
    },
  }),
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 2,
    px: "var(--editor-padding-x)",
    py: 1,
  },
  editor: {
    cursor: "text",
    minHeight: "var(--editor-min-height)",
    paddingX: "var(--editor-padding-x)",
    paddingY: "var(--editor-padding-y)",
    lineHeight: 1.5,
    overflowWrap: "break-word",
    outline: "none",
    wordBreak: "break-word",
    "& *": {
      boxSizing: "border-box",
      margin: 0,
      padding: 0,
    },
    "& > *:last-child": {
      marginBottom: 0,
    },
    // Paragraph styles
    "& .lexical-paragraph": {
      margin: "0 0 0.5em 0",
    },
    "& .lexical-paragraph:last-child": {
      marginBottom: 0,
    },
    "& p": {
      marginBottom: "0.5em",
    },
    // Text formatting styles
    "& .lexical-text-bold, & .editor-bold": {
      fontWeight: "bold",
    },
    "& .lexical-text-italic, & .editor-italic": {
      fontStyle: "italic",
    },
    "& .lexical-text-underline": {
      textDecoration: "underline",
    },
    "& .lexical-text-strikethrough, & .editor-strikethrough": {
      textDecoration: "line-through",
    },
    "& .lexical-text-subscript": {
      fontSize: "0.8em",
      verticalAlign: "sub",
    },
    "& .lexical-text-superscript": {
      fontSize: "0.8em",
      verticalAlign: "super",
    },
    // Heading styles
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
    // Quote styles
    "& .lexical-quote, & blockquote": {
      border: "0 solid",
      borderColor: "divider",
      borderLeftWidth: "0.3em",
      marginLeft: "0.3em",
      paddingLeft: "0.6em",
      marginBottom: "0.5em",
    },
    // List styles
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
    "& .lexical-listitem": {
      margin: 0,
    },
    "& .lexical-nested-list-item, & .editor-nested-list-item": {
      listStyleType: "none",
    },
    "& li": {
      marginLeft: "1em",
    },
    // Link styles
    "& .lexical-link": {
      color: "#0066cc",
      textDecoration: "underline",
    },
    "& .lexical-table": {
      borderCollapse: "collapse",
      width: "100%",
      marginBottom: "1em",
      border: "1px solid #bbb",
    },
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
    // Mention styles
    "& .lexical-mention": {
      display: "inline-block",
      backgroundColor: cssVar("palette-primary-100"),
      color: cssVar("palette-primary-700"),
      borderRadius: "sm",
      px: "0.25rem",
      cursor: "pointer",
      fontWeight: 500,
    },
    "& .lexical-reference": {
      backgroundColor: "transparent",
      px: 0,
      textDecoration: "underline",
    },
  },
});

// Helper function to execute editor commands via JS module
function executeCommand(
  s: DomStatements,
  editorHandle: Sql,
  command: string,
  params: Record<string, Sql> = {},
) {
  const paramsJson = Object.entries(params).length > 0
    ? Object.entries(params).map(([k, v]) => `'${k}', ${v}`).join(", ")
    : "";

  s.jsCall({
    module: "lexical_editor",
    exportName: "executeCommand",
    handle: editorHandle,
    argJson: paramsJson
      ? sql`json_build_object('handle', ${editorHandle}, 'command', ${
        sql.lit(command)
      }, ${sql.lit(paramsJson)})`
      : sql`json_build_object('handle', ${editorHandle}, 'command', ${
        sql.lit(command)
      })`,
  });
}

/**
 * RichTextSimpleEditor - Rich text editor using Lexical via JS modules
 *
 * This component mirrors the SimpleEditor styling and toolbar but uses
 * the lexical_editor JS module instead of the Rust-compiled editor.
 *
 * @category UI Component
 */
export function RichTextSimpleEditor(props: RichTextSimpleEditorProps) {
  ensureLexicalRichTextFunctions();
  // Auto-register the lexical_editor JS module when this component is used
  useJsModule("lexical_editor");

  const {
    size = "md",
    variant = "outlined",
    color = "neutral",
    onChange,
    onChangeDebounceMs = 50,
    value,
    sx,
    style,
    id: idProp,
    className,
    extendedToolbar = false,
    showVariables = false,
    variables = {},
    variableButtonLabel,
    preserveStoredTextStyles: preserveStoredTextStylesProp,
    preservePastedTextStyles: preservePastedTextStylesProp,
    documentFormatting = false,
    allowImages = true,
  } = props;
  const preserveStoredTextStyles = preserveStoredTextStylesProp ?? true;
  const preservePastedTextStyles = preservePastedTextStylesProp ?? true;

  const ownerState: OwnerState = { size, variant, color };
  const containerId = idProp || useUniqueId();
  const generatedEditorHandle = useUniqueId();
  const editorHandle = props.editorHandle ?? generatedEditorHandle;
  const mentionAnchorBaseId = useUniqueId();
  const mentionAnchorId = sql.concat(mentionAnchorBaseId, "-mention-anchor");
  const mentionListId = sql.concat(mentionAnchorBaseId, "-mention-list");
  const mentionsEnabled = !!props.mentions;
  const mentionTriggerChars = Array.isArray(props.mentions?.trigger)
    ? props.mentions.trigger
    : [props.mentions?.trigger ?? "@"];
  const mentionMaxResults = props.mentions?.maxResults ?? 50;

  const toolbarSize = size === "xs" ? "xs" : size === "lg" ? "md" : "sm";

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        // Text formatting state
        s.defScalar("is_bold", false);
        s.defScalar("is_italic", false);
        s.defScalar("is_underline", { expr: false, allowNoRead: true });
        s.defScalar("is_strikethrough", false);
        s.defScalar("is_subscript", { expr: false, allowNoRead: true });
        s.defScalar("is_superscript", { expr: false, allowNoRead: true });
        if (mentionsEnabled) {
          // Mention typeahead state. Defined unconditionally inside this
          // branch so that referencing them is always type-safe.
          s.defScalar("mention_open", false);
          s.defScalar("mention_query", {
            type: "String",
            expr: sql.lit``,
            allowNoRead: true,
          });
          s.defScalar("mention_trigger", {
            type: "String",
            expr: sql.stringLiteral(mentionTriggerChars[0]),
            allowNoRead: true,
          });
          s.defScalar("mention_selected_index", {
            type: "BigInt",
            expr: sql`0`,
            allowNoRead: true,
          });
          s.defScalar("mention_anchor_left", {
            type: "Real",
            expr: sql`0`,
            allowNoRead: true,
          });
          s.defScalar("mention_anchor_top", {
            type: "Real",
            expr: sql`0`,
            allowNoRead: true,
          });
          s.defScalar("mention_anchor_bottom", {
            type: "Real",
            expr: sql`0`,
            allowNoRead: true,
          });
        }
        // Style state
        s.defScalar("font_size", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("font_color", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("background_color", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("font_family", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("alignment", {
          expr: sql.lit`left`,
          allowNoRead: true,
        });
        // Link state
        s.defScalar("link_url", { type: "String" });
        s.defScalar("link_title", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        // Block state
        s.defScalar("selected_block_type", sql.lit`normal`);
        // History state
        s.defScalar("can_undo", true);
        s.defScalar("can_redo", true);
        // Task handle
        s.defScalar("on_change_task", { type: "BigUint" });
      }}
    >
      <div sx={{ ...styles.root(ownerState), ...sx }} className={className}>
        {/* Toolbar */}
        <div sx={styles.toolbar}>
          {documentFormatting && (
            <>
              <Select
                size={toolbarSize}
                value={sql`coalesce(font_family, 'Noto Sans, sans-serif')`}
                onInput={(s) => {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'formatFontFamily', 'family', target_value)`,
                  });
                  s.setScalar("font_family", sql`target_value`);
                }}
                aria-label="Font family"
              >
                <Select.Option value="Noto Sans, sans-serif">
                  Noto Sans
                </Select.Option>
                <Select.Option value="Noto Serif, serif">
                  Noto Serif
                </Select.Option>
                <Select.Option value="Noto Sans Mono, monospace">
                  Noto Sans Mono
                </Select.Option>
              </Select>
              <Select
                size={toolbarSize}
                value={sql`coalesce(font_size, '10pt')`}
                onInput={(s) => {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'formatFontSize', 'size', target_value)`,
                  });
                  s.setScalar("font_size", sql`target_value`);
                }}
                aria-label="Font size"
              >
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((size) => (
                  <Select.Option value={`${size}pt`}>{size} pt</Select.Option>
                ))}
              </Select>
            </>
          )}
          {/* Text formatting group */}
          <ButtonGroup variant="outlined" color="neutral" size={toolbarSize}>
            <IconButton
              aria-pressed={sql`is_bold`}
              aria-label="Bold"
              tooltip="Bold"
              icon="FormatBold"
              onClick={(s) => executeCommand(s, editorHandle, "formatBold")}
            />
            <IconButton
              aria-pressed={sql`is_italic`}
              aria-label="Italic"
              tooltip="Italic"
              icon="FormatItalic"
              onClick={(s) => executeCommand(s, editorHandle, "formatItalic")}
            />
            {extendedToolbar && (
              <IconButton
                aria-pressed={sql`is_underline`}
                aria-label="Underline"
                tooltip="Underline"
                icon="FormatUnderlined"
                onClick={(s) =>
                  executeCommand(s, editorHandle, "formatUnderline")}
              />
            )}
            <IconButton
              aria-pressed={sql`is_strikethrough`}
              aria-label="Strikethrough"
              tooltip="Strikethrough"
              icon="FormatStrikethrough"
              onClick={(s) =>
                executeCommand(s, editorHandle, "formatStrikethrough")}
            />
            {extendedToolbar && (
              <>
                <IconButton
                  aria-pressed={sql`is_subscript`}
                  aria-label="Subscript"
                  tooltip="Subscript"
                  icon="Subscript"
                  onClick={(s) =>
                    executeCommand(s, editorHandle, "formatSubscript")}
                />
                <IconButton
                  aria-pressed={sql`is_superscript`}
                  aria-label="Superscript"
                  tooltip="Superscript"
                  icon="Superscript"
                  onClick={(s) =>
                    executeCommand(s, editorHandle, "formatSuperscript")}
                />
              </>
            )}
            <JsEditorLinkIconButton editorHandle={editorHandle} />
          </ButtonGroup>

          {/* Block formatting group */}
          <ButtonGroup variant="outlined" color="neutral" size={toolbarSize}>
            <IconButton
              aria-label="Title"
              tooltip="Title"
              aria-pressed={sql`selected_block_type = 'h1'`}
              icon="Title"
              onClick={(s) => {
                s.conditional({
                  condition: sql`selected_block_type = 'h1'`,
                  then: (s) => {
                    executeCommand(s, editorHandle, "formatNormal");
                    s.setScalar("selected_block_type", sql.lit`normal`);
                  },
                  else: (s) => {
                    executeCommand(s, editorHandle, "formatH1");
                    s.setScalar("selected_block_type", sql.lit`h1`);
                  },
                });
              }}
            />
            <IconButton
              aria-label="Quote"
              tooltip="Quote"
              aria-pressed={sql`selected_block_type = 'quote'`}
              icon="FormatQuote"
              onClick={(s) => {
                s.conditional({
                  condition: sql`selected_block_type = 'quote'`,
                  then: (s) => {
                    executeCommand(s, editorHandle, "formatNormal");
                    s.setScalar("selected_block_type", sql.lit`normal`);
                  },
                  else: (s) => {
                    executeCommand(s, editorHandle, "formatQuote");
                    s.setScalar("selected_block_type", sql.lit`quote`);
                  },
                });
              }}
            />
            <IconButton
              aria-label="Bulleted List"
              tooltip="Bulleted List"
              aria-pressed={sql`selected_block_type = 'bullet'`}
              icon="FormatListBulleted"
              onClick={(s) => {
                s.conditional({
                  condition: sql`selected_block_type = 'bullet'`,
                  then: (s) => {
                    executeCommand(s, editorHandle, "formatNormal");
                    s.setScalar("selected_block_type", sql.lit`normal`);
                  },
                  else: (s) => {
                    executeCommand(s, editorHandle, "formatBulletedList");
                    s.setScalar("selected_block_type", sql.lit`bullet`);
                  },
                });
              }}
            />
            <IconButton
              aria-label="Numbered List"
              tooltip="Numbered List"
              aria-pressed={sql`selected_block_type = 'number'`}
              icon="FormatListNumbered"
              onClick={(s) => {
                s.conditional({
                  condition: sql`selected_block_type = 'number'`,
                  then: (s) => {
                    executeCommand(s, editorHandle, "formatNormal");
                    s.setScalar("selected_block_type", sql.lit`normal`);
                  },
                  else: (s) => {
                    executeCommand(s, editorHandle, "formatNumberedList");
                    s.setScalar("selected_block_type", sql.lit`number`);
                  },
                });
              }}
            />
            <IconButton
              aria-label="Outdent"
              tooltip="Outdent"
              icon="FormatIndentDecrease"
              onClick={(s) => executeCommand(s, editorHandle, "outdent")}
            />
            <IconButton
              aria-label="Indent"
              tooltip="Indent"
              icon="FormatIndentIncrease"
              onClick={(s) => executeCommand(s, editorHandle, "indent")}
            />
            {showVariables && (
              <LexicalVariableInsertMenu
                variables={variables}
                label={variableButtonLabel}
                onClick={(s, key) => {
                  // Check if this is a block variable (triple braces) or inline (double braces)
                  const isBlockVariable = [
                    "questions_and_answers",
                    "invitation_links",
                    "event_type_description",
                    "location",
                  ].includes(key);
                  const textToInsert = isBlockVariable
                    ? `{{{${key}}}}`
                    : `{{${key}}}`;
                  // Focus editor first - clicking menu item moves focus away from editor
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "focus",
                    handle: editorHandle,
                    argJson: sql`json_build_object('handle', ${editorHandle})`,
                  });
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'insertText', 'text', ${
                        sql.lit(textToInsert)
                      })`,
                  });
                }}
              />
            )}
          </ButtonGroup>

          {/* Alignment group - only shown with extended toolbar */}
          {extendedToolbar && (
            <ButtonGroup variant="outlined" color="neutral" size={toolbarSize}>
              <IconButton
                aria-pressed={sql`alignment = 'left'`}
                aria-label="Align Left"
                tooltip="Align Left"
                icon="FormatAlignLeft"
                onClick={(s) => {
                  s.setScalar("alignment", sql.lit`left`);
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'formatAlignment', 'alignment', 'left')`,
                  });
                }}
              />
              <IconButton
                aria-pressed={sql`alignment = 'center'`}
                aria-label="Align Center"
                tooltip="Align Center"
                icon="FormatAlignCenter"
                onClick={(s) => {
                  s.setScalar("alignment", sql.lit`center`);
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'formatAlignment', 'alignment', 'center')`,
                  });
                }}
              />
              <IconButton
                aria-pressed={sql`alignment = 'right'`}
                aria-label="Align Right"
                tooltip="Align Right"
                icon="FormatAlignRight"
                onClick={(s) => {
                  s.setScalar("alignment", sql.lit`right`);
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'formatAlignment', 'alignment', 'right')`,
                  });
                }}
              />
              <IconButton
                aria-pressed={sql`alignment = 'justify'`}
                aria-label="Justify"
                tooltip="Justify"
                icon="FormatAlignJustify"
                onClick={(s) => {
                  s.setScalar("alignment", sql.lit`justify`);
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${editorHandle}, 'command', 'formatAlignment', 'alignment', 'justify')`,
                  });
                }}
              />
            </ButtonGroup>
          )}

          {/* Undo/Redo group */}
          <ButtonGroup variant="outlined" color="neutral" size={toolbarSize}>
            <IconButton
              aria-label="Undo"
              tooltip="Undo"
              icon="Undo"
              disabled={sql`not can_undo`}
              onClick={(s) => executeCommand(s, editorHandle, "undo")}
            />
            <IconButton
              aria-label="Redo"
              tooltip="Redo"
              icon="Redo"
              disabled={sql`not can_redo`}
              onClick={(s) => executeCommand(s, editorHandle, "redo")}
            />
            {extendedToolbar && (
              <IconButton
                aria-label="Clear Formatting"
                tooltip="Clear Formatting"
                icon="FormatClear"
                onClick={(s) =>
                  executeCommand(s, editorHandle, "clearFormatting")}
              />
            )}
          </ButtonGroup>
        </div>

        {
          /* Editor body. When mentions are enabled, wrap in an inner Data
            block so the event handlers + popover share access to a
            `mention_results` table backed by the caller's query. */
        }
        <EditorBody
          containerId={containerId}
          mentionAnchorId={mentionAnchorId}
          mentionListId={mentionListId}
          mentionTriggerChars={mentionTriggerChars}
          mentionMaxResults={mentionMaxResults}
          mentions={props.mentions}
          style={style}
          value={value}
          onChange={onChange}
          onImageBlobHashesChange={props.onImageBlobHashesChange}
          onChangeDebounceMs={onChangeDebounceMs}
          editorHandle={editorHandle}
          preserveStoredTextStyles={preserveStoredTextStyles}
          preservePastedTextStyles={preservePastedTextStyles}
          constrainTextStyles={documentFormatting}
          allowImages={allowImages}
          imageUploadInputId={props.imageUploadInputId}
          onImageUploadStateChange={props.onImageUploadStateChange}
        />
      </div>
    </Data>
  );
}

interface EditorBodyProps {
  containerId: Sql | string;
  mentionAnchorId: Sql;
  mentionListId: Sql;
  mentionTriggerChars: string[];
  mentionMaxResults: number;
  mentions?: MentionsConfig;
  style?: Partial<Record<string, Sql>>;
  value?: Sql;
  onChange?: (s: DomStatements, value: Sql) => void;
  onImageBlobHashesChange?: (
    s: DomStatements,
    imageBlobHashes: Sql,
  ) => void;
  onChangeDebounceMs: number;
  editorHandle: Sql;
  preserveStoredTextStyles: boolean;
  preservePastedTextStyles: boolean;
  constrainTextStyles: boolean;
  allowImages: boolean;
  imageUploadInputId?: Sql;
  onImageUploadStateChange?: (s: DomStatements, state: Sql) => void;
}

function EditorBody(props: EditorBodyProps) {
  const {
    containerId,
    mentionAnchorId,
    mentionListId,
    mentionTriggerChars,
    mentionMaxResults,
    mentions,
    style,
    value,
    onChange,
    onImageBlobHashesChange,
    onChangeDebounceMs,
    editorHandle,
    preserveStoredTextStyles,
    preservePastedTextStyles,
    constrainTextStyles,
    allowImages,
  } = props;
  const mentionsEnabled = !!mentions;

  const editorAndPopover = (editorHandle: Sql) => (
    <>
      <div
        contentEditable={false}
        id={containerId}
        sx={[
          styles.editor,
          constrainTextStyles ? lexicalDocumentEditorStyles : {},
        ]}
        style={style}
        onMount={(s) => {
          const triggerArg = mentionsEnabled
            ? sql`, 'mentionTriggers', ${
              sql.stringLiteral(JSON.stringify(mentionTriggerChars))
            }::json`
            : sql``;
          const storedStyleArg = preserveStoredTextStyles
            ? sql.true
            : sql.false;
          const pastedStyleArg = preservePastedTextStyles
            ? sql.true
            : sql.false;
          const allowImagesArg = allowImages ? sql.true : sql.false;
          const uploadArg = props.imageUploadInputId
            ? sql`, 'externalImageInputId', ${props.imageUploadInputId}, 'managedImageUploads', true`
            : sql``;
          const constrainTextStylesArg = constrainTextStyles
            ? sql.true
            : sql.false;
          s.jsCall({
            module: "lexical_editor",
            exportName: "init",
            handle: editorHandle,
            argJson: value
              ? sql`json_build_object('handle', ${editorHandle}, 'containerId', ${sql
                .lit`${containerId}`}, 'initialContent', ${value}, 'preserveStoredTextStyles', ${storedStyleArg}, 'preservePastedTextStyles', ${pastedStyleArg}, 'constrainTextStyles', ${constrainTextStylesArg}, 'allowImages', ${allowImagesArg}${triggerArg}${uploadArg})`
              : sql`json_build_object('handle', ${editorHandle}, 'containerId', ${sql
                .lit`${containerId}`}, 'preserveStoredTextStyles', ${storedStyleArg}, 'preservePastedTextStyles', ${pastedStyleArg}, 'constrainTextStyles', ${constrainTextStylesArg}, 'allowImages', ${allowImagesArg}${triggerArg}${uploadArg})`,
          });
        }}
        js={{
          handles: [{
            module: "lexical_editor",
            handle: editorHandle,
            cleanup: "cleanup",
          }],
          on: {
            "lexical_editor.stateChanged": (s) => {
              // Sync UI state with actual editor formatting state from event payload
              s.setScalar(
                "is_bold",
                sql`coalesce(event.payload_json->>'is_bold' = 'true', false)`,
              );
              s.setScalar(
                "is_italic",
                sql`coalesce(event.payload_json->>'is_italic' = 'true', false)`,
              );
              s.setScalar(
                "is_underline",
                sql`coalesce(event.payload_json->>'is_underline' = 'true', false)`,
              );
              s.setScalar(
                "is_strikethrough",
                sql`coalesce(event.payload_json->>'is_strikethrough' = 'true', false)`,
              );
              s.setScalar(
                "is_subscript",
                sql`coalesce(event.payload_json->>'is_subscript' = 'true', false)`,
              );
              s.setScalar(
                "is_superscript",
                sql`coalesce(event.payload_json->>'is_superscript' = 'true', false)`,
              );
              s.setScalar(
                "alignment",
                sql`coalesce(event.payload_json->>'alignment', 'left')`,
              );
              s.setScalar(
                "selected_block_type",
                sql`coalesce(event.payload_json->>'selected_block_type', 'normal')`,
              );
              s.setScalar(
                "font_size",
                sql`event.payload_json->>'font_size'`,
              );
              s.setScalar(
                "font_family",
                sql`event.payload_json->>'font_family'`,
              );
              s.setScalar("link_url", sql`event.payload_json->>'link_url'`);
              s.setScalar(
                "can_undo",
                sql`coalesce(event.payload_json->>'can_undo' = 'true', false)`,
              );
              s.setScalar(
                "can_redo",
                sql`coalesce(event.payload_json->>'can_redo' = 'true', false)`,
              );
            },
            ...(props.onImageUploadStateChange
              ? {
                "lexical_editor.imageUploadState": (s: DomStatements) =>
                  props.onImageUploadStateChange?.(s, sql`event.payload_json`),
              }
              : {}),
            "lexical_editor.contentChanged": (s) => {
              if (onChange) {
                s.jsCall({
                  module: "lexical_editor",
                  exportName: "getContent",
                  handle: editorHandle,
                  argJson: sql`json_build_object('handle', ${editorHandle})`,
                  resultJsonScalar: "content_data",
                });
                s.defScalar(
                  "content_value",
                  sql`content_data->>'editorState'`,
                );
                if (onImageBlobHashesChange) {
                  onImageBlobHashesChange(
                    s,
                    sql`coalesce(
                      event.payload_json->'imageBlobHashes',
                      json_build_array()
                    )`,
                  );
                }
                if (onChangeDebounceMs === 0) {
                  onChange(s, sql`content_value`);
                } else {
                  s.if(sql`on_change_task is not null`, (s) => {
                    s.cancelTask(sql`on_change_task`);
                  });
                  s.startTaskWithOpts({
                    detached: true,
                    procedure: (s) => {
                      s.sleep(onChangeDebounceMs);
                      onChange(s, sql`content_value`);
                    },
                    handleScalar: "task",
                  });
                  s.setScalar("on_change_task", sql`task`);
                }
              }
            },
            ...(mentionsEnabled
              ? {
                "lexical_editor.mention": (s: DomStatements) => {
                  s.defScalar(
                    "mention_action",
                    sql`event.payload_json->>'action'`,
                  );
                  s.if(sql`mention_action = 'opened'`, (s) => {
                    s.setScalar("mention_open", true);
                    s.setScalar(
                      "mention_trigger",
                      sql`coalesce(event.payload_json->>'trigger', mention_trigger)`,
                    );
                    s.setScalar(
                      "mention_query",
                      sql`coalesce(event.payload_json->>'query', '')`,
                    );
                    s.setScalar("mention_selected_index", sql`0`);
                    s.setScalar(
                      "mention_anchor_left",
                      sql`coalesce(cast(event.payload_json->>'anchor_left' as real), 0)`,
                    );
                    s.setScalar(
                      "mention_anchor_top",
                      sql`coalesce(cast(event.payload_json->>'anchor_top' as real), 0)`,
                    );
                    s.setScalar(
                      "mention_anchor_bottom",
                      sql`coalesce(cast(event.payload_json->>'anchor_bottom' as real), 0)`,
                    );
                  });
                  s.if(sql`mention_action = 'query_changed'`, (s) => {
                    s.setScalar(
                      "mention_trigger",
                      sql`coalesce(event.payload_json->>'trigger', mention_trigger)`,
                    );
                    s.setScalar(
                      "mention_query",
                      sql`coalesce(event.payload_json->>'query', '')`,
                    );
                    s.setScalar("mention_selected_index", sql`0`);
                  });
                  s.if(sql`mention_action = 'closed'`, (s) => {
                    s.setScalar("mention_open", false);
                  });
                  s.if(sql`mention_action = 'arrow_down'`, (s) => {
                    s.setScalar(
                      "mention_selected_index",
                      sql`case
                        when (select count(*) from ui.mention_results) = 0 then 0
                        when mention_selected_index >= (select count(*) from ui.mention_results) - 1 then 0
                        else mention_selected_index + 1 end`,
                    );
                  });
                  s.if(sql`mention_action = 'arrow_up'`, (s) => {
                    s.setScalar(
                      "mention_selected_index",
                      sql`case
                        when (select count(*) from ui.mention_results) = 0 then 0
                        when mention_selected_index <= 0 then (select count(*) from ui.mention_results) - 1
                        else mention_selected_index - 1 end`,
                    );
                  });
                  s.if(sql`mention_action = 'confirm'`, (s) => {
                    s.defScalar(
                      "mention_picked_id",
                      sql`(select id from ui.mention_results limit 1 offset mention_selected_index)`,
                    );
                    s.defScalar(
                      "mention_picked_label",
                      sql`(select label from ui.mention_results limit 1 offset mention_selected_index)`,
                    );
                    s.if(sql`mention_picked_id is not null`, (s) => {
                      const mentionUrl = mentions?.getUrl
                        ? mentions.getUrl(
                          sql`mention_picked_id`,
                          sql`mention_trigger`,
                        )
                        : sql.null;
                      const mentionKind = mentions?.getKind
                        ? mentions.getKind(sql`mention_trigger`)
                        : sql.lit`mention`;
                      s.jsCall({
                        module: "lexical_editor",
                        exportName: "executeCommand",
                        handle: editorHandle,
                        argJson:
                          sql`json_build_object('handle', ${editorHandle}, 'command', 'insertMention', 'id', mention_picked_id, 'label', mention_picked_label, 'trigger', mention_trigger, 'url', ${mentionUrl}, 'kind', ${mentionKind})`,
                      });
                      if (mentions?.onInsert) {
                        mentions.onInsert(
                          s,
                          sql`mention_picked_id`,
                          sql`mention_trigger`,
                        );
                      }
                    });
                  });
                },
                "lexical_editor.mentionClicked": (s: DomStatements) => {
                  if (mentions?.onClick) {
                    s.defScalar(
                      "mention_clicked_id",
                      sql`event.payload_json->>'mention_id'`,
                    );
                    s.defScalar(
                      "mention_clicked_trigger",
                      {
                        expr:
                          sql`coalesce(event.payload_json->>'mention_trigger', '@')`,
                        allowNoRead: true,
                      },
                    );
                    mentions.onClick(
                      s,
                      sql`mention_clicked_id`,
                      sql`mention_clicked_trigger`,
                    );
                  }
                },
              }
              : {}),
          },
        }}
      />
      {mentionsEnabled && (
        <MentionPopover
          anchorId={mentionAnchorId}
          listId={mentionListId}
          editorContainerId={containerId}
          mentions={mentions!}
          maxResults={mentionMaxResults}
          editorHandle={editorHandle}
        />
      )}
    </>
  );

  if (!mentionsEnabled) return editorAndPopover(editorHandle);

  const queryBuilder = mentions!.query;
  return (
    <Data
      local={mentions!.localQuery}
      watch={[sql`mention_query`, sql`mention_trigger`]}
      // Keep the last result visible while the next query is in flight so
      // the popover doesn't flicker through an empty state.
      acceptOldResponses
      procedure={(s: StateStatements) => {
        s.defTable(
          "mention_results",
          sql`select * from (${
            queryBuilder(sql`mention_query`, sql`mention_trigger`)
          }) as q limit ${mentionMaxResults}`,
        );
      }}
      pendingFallback={null}
      errorFallback={null}
    >
      {editorAndPopover(editorHandle)}
    </Data>
  );
}

// Link button component for the editor
function JsEditorLinkIconButton(props: { editorHandle: Sql }) {
  const id = useUniqueId();

  return (
    <Data
      local
      noRefetch
      watch={[sql`link_url`]}
      procedure={(s) => {
        s.defScalar("link_popover_open", false);
        s.defScalar("new_link_url", sql`link_url`);
      }}
    >
      <IconButton
        aria-pressed={sql`link_url is not null`}
        aria-label="Link"
        tooltip="Link"
        icon="Link"
        onClick={(s) => s.toggle("link_popover_open")}
        id={id}
      />
      <Show when={sql`link_popover_open`}>
        <Sheet
          variant="outlined"
          popover="auto"
          yolmPopoverShowing={sql`link_popover_open`}
          floating={{
            anchorEl: id,
            placement: "bottom",
            strategy: "fixed",
          }}
          sx={{
            mt: 1,
            mx: 0,
            mb: 0,
            p: 2,
            minWidth: "300px",
            boxShadow: "md",
            borderRadius: "md",
            backgroundColor: "background-surface",
          }}
          onToggleHide={(s) => {
            s.setScalar("link_popover_open", false);
          }}
        >
          <div className="flex flex-col gap-4">
            <Input
              size="sm"
              placeholder="https://yolm.ai"
              bindScalar="new_link_url"
              startIcon="Link"
            />
            <div className="flex gap-2 justify-end">
              <Show when={sql`link_url is not null`}>
                <Button
                  size="sm"
                  color="danger"
                  variant="soft"
                  onClick={(s) => {
                    executeCommand(s, props.editorHandle, "removeLink");
                    s.setScalar("link_popover_open", false);
                  }}
                >
                  Remove
                </Button>
              </Show>
              <Button
                size="sm"
                onClick={(s) => {
                  s.if(sql`new_link_url != ''`, (s) => {
                    s.jsCall({
                      module: "lexical_editor",
                      exportName: "executeCommand",
                      handle: props.editorHandle,
                      argJson:
                        sql`json_build_object('handle', ${props.editorHandle}, 'command', 'insertLink', 'url', new_link_url, 'title', new_link_url)`,
                    });
                  });
                  s.setScalar("link_popover_open", false);
                }}
              >
                {sql`case when link_url is null then 'Insert' else 'Update' end`}
              </Button>
            </div>
          </div>
        </Sheet>
      </Show>
    </Data>
  );
}

interface MentionPopoverProps {
  anchorId: Sql;
  listId: Sql;
  editorContainerId: Sql | string;
  mentions: MentionsConfig;
  maxResults: number;
  editorHandle: Sql;
}

function MentionPopover(props: MentionPopoverProps) {
  const { anchorId, listId, mentions } = props;
  return (
    <>
      {
        /* Zero-size anchor element positioned at the caret. The floating
          system anchors the popover to it. */
      }
      <div
        id={anchorId}
        style={{
          position: sql.lit`fixed`,
          left: sql`mention_anchor_left || 'px'`,
          top: sql`mention_anchor_bottom || 'px'`,
          width: sql.lit`0`,
          height: sql.lit`0`,
          "pointer-events": sql.lit`none`,
        }}
        aria-hidden="true"
      />
      <Show when={sql`mention_open`}>
        <Sheet
          id={listId}
          variant="outlined"
          popover="auto"
          yolmPopoverShowing={sql`mention_open`}
          floating={{
            anchorEl: anchorId,
            placement: "bottom-start",
            strategy: "fixed",
            offset: { mainAxis: 2, crossAxis: 0 },
            shift: { mainAxis: true, crossAxis: true },
            flip: { mainAxis: true, crossAxis: false },
          }}
          sx={{
            m: 0,
            py: 0.5,
            minWidth: "200px",
            maxHeight: "240px",
            overflowY: "auto",
            boxShadow: "lg",
            borderRadius: "md",
            backgroundColor: "background-surface",
            zIndex: 1000,
          }}
          onToggleHide={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: props.editorHandle,
              argJson:
                sql`json_build_object('handle', ${props.editorHandle}, 'command', 'cancelMention')`,
            });
          }}
        >
          <Show
            when={sql`exists (select 1 from ui.mention_results)`}
            fallback={
              <div
                sx={{
                  px: 1.5,
                  py: 1,
                  fontSize: "sm",
                  color: "text-tertiary",
                }}
              >
                No matches
              </div>
            }
          >
            <Each
              table="mention_results"
              recordName="mention_record"
              eachKey={sql`mention_record.id`}
            >
              <div
                role="option"
                sx={{
                  px: 1.5,
                  py: 0.75,
                  cursor: "pointer",
                  fontSize: "sm",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  "&[aria-selected='true']": getVariantStyle(
                    "soft",
                    "primary",
                    "active",
                  ),
                  "&:hover": getVariantStyle("soft", "primary", "hover"),
                }}
                aria-selected={sql`mention_record.iteration_index = mention_selected_index`}
                onMouseEnter={(s) => {
                  s.setScalar(
                    "mention_selected_index",
                    sql`mention_record.iteration_index`,
                  );
                }}
                onMouseDown={(s) => {
                  // Use mousedown (not click) so the editor doesn't lose
                  // focus before insertMention runs.
                  s.event.preventDefault();
                  const mentionUrl = mentions.getUrl
                    ? mentions.getUrl(
                      sql`mention_record.id`,
                      sql`mention_trigger`,
                    )
                    : sql.null;
                  const mentionKind = mentions.getKind
                    ? mentions.getKind(sql`mention_trigger`)
                    : sql.lit`mention`;
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: props.editorHandle,
                    argJson:
                      sql`json_build_object('handle', ${props.editorHandle}, 'command', 'insertMention', 'id', mention_record.id, 'label', mention_record.label, 'trigger', mention_trigger, 'url', ${mentionUrl}, 'kind', ${mentionKind})`,
                  });
                  if (mentions.onInsert) {
                    mentions.onInsert(
                      s,
                      sql`mention_record.id`,
                      sql`mention_trigger`,
                    );
                  }
                }}
              >
                {mentions.renderItem ?? sql`mention_record.label`}
              </div>
            </Each>
          </Show>
        </Sheet>
      </Show>
    </>
  );
}

// Variable insert menu component for the lexical editor
interface LexicalVariableInsertMenuProps {
  variables: Record<string, string>;
  onClick: (s: DomStatements, key: string) => void;
  variant?: Variant;
  label?: string;
}

function LexicalVariableInsertMenu(props: LexicalVariableInsertMenuProps) {
  const { variables, onClick, variant = "outlined", label } = props;
  const entries = Object.entries(variables);

  if (entries.length === 0) {
    return null;
  }

  return (
    <Menu>
      <Menu.Button
        variant={variant}
        color="neutral"
        className="w-fit self-end"
        aria-controls="variables-menu"
        aria-haspopup="true"
        size="sm"
      >
        <MaterialIcon icon="Add" />
        {label}
      </Menu.Button>
      <Menu.Content className="max-h-[200px] overflow-auto mr-4">
        {entries.map(([key, description]) => {
          const isBlockVariable = [
            "questions_and_answers",
            "invitation_links",
            "event_type_description",
            "location",
          ].includes(key);
          const displayKey = isBlockVariable ? `{{{${key}}}}` : `{{${key}}}`;

          return (
            <Menu.Item onClick={(s) => onClick(s, key)}>
              {sql.concat(
                sql.lit(displayKey),
                sql.lit`: `,
                sql.lit(description),
              )}
            </Menu.Item>
          );
        })}
      </Menu.Content>
    </Menu>
  );
}

// Color button component for color pickers
export function ColorButton({
  icon,
  value,
  onChange,
  label,
}: {
  icon: IconName;
  value: Sql;
  onChange: (s: DomStatements) => void;
  label: string;
}) {
  return (
    <Button
      component="label"
      size="sm"
      variant="outlined"
      color="neutral"
      startIcon={icon}
      sx={{
        position: "relative",
        minWidth: "32px",
        px: 1,
        "& input": {
          cursor: "pointer",
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
        },
      }}
      aria-label={label}
    >
      <div
        sx={{
          width: "16px",
          height: "16px",
          borderRadius: "sm",
          border: "1px solid",
          borderColor: "divider",
        }}
        style={{
          "background-color": value,
        }}
      />
      <input type="color" value={value} onChange={(s) => onChange(s)} />
    </Button>
  );
}

// Helper function to execute Lexical editor commands via JS module
function executeLexicalCommand(
  s: DomStatements,
  command: string,
  params: Record<string, Sql> = {},
) {
  const paramsEntries = Object.entries(params);
  let argJson: Sql;

  if (paramsEntries.length > 0) {
    const paramParts = paramsEntries.map(([k, v]) => `'${k}', ${v}`).join(", ");
    argJson = sql`json_build_object('handle', ui.editor_handle, 'command', ${
      sql.lit(command)
    }, ${sql.lit(paramParts)})`;
  } else {
    argJson = sql`json_build_object('handle', ui.editor_handle, 'command', ${
      sql.lit(command)
    })`;
  }

  s.jsCall({
    module: "lexical_editor",
    exportName: "executeCommand",
    handle: sql`ui.editor_handle`,
    argJson,
  });
}

// Link popover for the email editor toolbar
function EmailEditorLinkPopover() {
  const id = useUniqueId();

  return (
    <Data
      local
      noRefetch
      watch={[sql`link_url`]}
      procedure={(s) => {
        s.defScalar("link_popover_open", false);
        s.defScalar("new_link_url", sql`link_url`);
      }}
    >
      <IconButton
        aria-pressed={sql`link_url is not null`}
        aria-label="Link"
        tooltip="Link"
        icon="Link"
        variant="outlined"
        color="neutral"
        size="sm"
        onClick={(s) => s.toggle("link_popover_open")}
        id={id}
      />
      <Show when={sql`link_popover_open`}>
        <Sheet
          variant="outlined"
          popover="auto"
          yolmPopoverShowing={sql`link_popover_open`}
          floating={{
            anchorEl: id,
            placement: "bottom-end",
            strategy: "absolute",
          }}
          sx={{
            mt: 1,
            p: 2,
            minWidth: "300px",
            zIndex: 1000,
            boxShadow: "md",
            borderRadius: "md",
            backgroundColor: "background-surface",
          }}
          onToggleHide={(s) => {
            s.setScalar("link_popover_open", false);
          }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Typography level="body-sm">Add Link</Typography>
              <Input
                size="sm"
                placeholder="https://yolm.ai"
                value={sql`new_link_url`}
                startIcon="Link"
                onInput={(s) => s.setScalar("new_link_url", sql`target_value`)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Show when={sql`link_url is not null`}>
                <Button
                  size="sm"
                  color="danger"
                  variant="soft"
                  onClick={(s) => {
                    executeLexicalCommand(s, "removeLink");
                    s.setScalar("link_popover_open", false);
                  }}
                >
                  Remove
                </Button>
              </Show>
              <Button
                size="sm"
                onClick={(s) => {
                  s.if(sql`new_link_url != ''`, (s) => {
                    s.jsCall({
                      module: "lexical_editor",
                      exportName: "executeCommand",
                      handle: sql`ui.editor_handle`,
                      argJson:
                        sql`json_build_object('handle', ui.editor_handle, 'command', 'insertLink', 'url', new_link_url, 'title', new_link_url)`,
                    });
                  });
                  s.setScalar("link_popover_open", false);
                }}
              >
                {sql`case when link_url is null then 'Insert' else 'Update' end`}
              </Button>
            </div>
          </div>
        </Sheet>
      </Show>
    </Data>
  );
}

// Variable insert menu for email templates
function EmailVariableInsertMenu(props: {
  onClick?: (s: DomStatements, key: string) => void;
  variableType?: "recipient" | "link";
  variables?: Record<string, string>;
}) {
  const defaultVariables = props.variables || {
    email: "Recipient email address",
    name: "Recipient name",
  };

  const handleClick = props.onClick || ((s: DomStatements, key: string) => {
    s.jsCall({
      module: "lexical_editor",
      exportName: "focus",
      handle: sql`ui.editor_handle`,
      argJson: sql`json_build_object('handle', ui.editor_handle)`,
    });
    s.jsCall({
      module: "lexical_editor",
      exportName: "executeCommand",
      handle: sql`ui.editor_handle`,
      argJson:
        sql`json_build_object('handle', ui.editor_handle, 'command', 'insertText', 'text', ${
          sql.lit(`{{${key}}}`)
        })`,
    });
  });

  return (
    <Menu>
      <Menu.IconButton
        variant="outlined"
        color="neutral"
        size="sm"
        aria-controls="email-variables-menu"
        aria-haspopup="true"
        icon="Code"
      />
      <Menu.Content className="max-h-[200px] overflow-auto">
        {Object.entries(defaultVariables).map(([key, description]) => (
          <Menu.Item
            onClick={(s) => {
              handleClick(s, key);
            }}
          >
            {sql.concat(
              sql.lit`{{${key}}} - `,
              sql.lit(description),
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
}

// Rich text toolbar for the BasicEmailEditor
function BasicEmailRichTextToolbar(
  props: { showVariables: boolean; variables?: Record<string, string> },
) {
  return (
    <Sheet
      variant="soft"
      color="neutral"
      sx={{
        py: 3,
        px: 6,
        display: "flex",
        gap: 4,
        overflowX: "auto",
        borderBottom: "1px solid",
        borderColor: "divider",
        alignItems: "center",
        boxShadow: "sm",
        top: 0,
        zIndex: 10,
        flexWrap: "wrap",
        "&::-webkit-scrollbar": {
          height: "8px",
        },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "neutral-300",
          borderRadius: "md",
        },
        "&::-webkit-scrollbar-track": {
          backgroundColor: "transparent",
        },
      }}
    >
      <ButtonGroup variant="outlined" color="neutral" size="sm">
        <IconButton
          aria-label="Undo"
          icon="Undo"
          disabled={sql`not can_undo`}
          onClick={(s) => executeLexicalCommand(s, "undo")}
        />
        <IconButton
          aria-label="Redo"
          icon="Redo"
          disabled={sql`not can_redo`}
          onClick={(s) => executeLexicalCommand(s, "redo")}
        />
      </ButtonGroup>

      {/* Block type selector */}
      <div className="flex gap-2 items-center">
        <Select
          size="sm"
          value={sql`selected_block_type`}
          onInput={(s) => {
            s.if(
              sql`target_value = 'paragraph' or target_value = 'normal'`,
              (s) => {
                executeLexicalCommand(s, "formatNormal");
              },
            );
            s.if(sql`target_value = 'h1'`, (s) => {
              executeLexicalCommand(s, "formatH1");
            });
            s.if(sql`target_value = 'h2'`, (s) => {
              executeLexicalCommand(s, "formatH2");
            });
            s.if(sql`target_value = 'h3'`, (s) => {
              executeLexicalCommand(s, "formatH3");
            });
            s.if(sql`target_value = 'h4'`, (s) => {
              executeLexicalCommand(s, "formatH4");
            });
            s.if(sql`target_value = 'h5'`, (s) => {
              executeLexicalCommand(s, "formatH5");
            });
            s.if(sql`target_value = 'h6'`, (s) => {
              executeLexicalCommand(s, "formatH6");
            });
            s.if(sql`target_value = 'quote'`, (s) => {
              executeLexicalCommand(s, "formatQuote");
            });
            s.if(sql`target_value = 'bullet'`, (s) => {
              executeLexicalCommand(s, "formatBulletedList");
            });
            s.if(sql`target_value = 'number'`, (s) => {
              executeLexicalCommand(s, "formatNumberedList");
            });
            s.setScalar("selected_block_type", sql`target_value`);
          }}
          className="w-[150px]"
        >
          <Select.Option value="normal">Paragraph</Select.Option>
          <Select.Option value="h1">H1</Select.Option>
          <Select.Option value="h2">H2</Select.Option>
          <Select.Option value="h3">H3</Select.Option>
          <Select.Option value="h4">H4</Select.Option>
          <Select.Option value="h5">H5</Select.Option>
          <Select.Option value="h6">H6</Select.Option>
          <Select.Option value="quote">Quote</Select.Option>
          <Select.Option value="bullet">Bullet List</Select.Option>
          <Select.Option value="number">Numbered List</Select.Option>
        </Select>

        <Select
          size="sm"
          value={sql`coalesce(font_family, 'Arial')`}
          onInput={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: sql`ui.editor_handle`,
              argJson:
                sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontFamily', 'family', target_value)`,
            });
            s.setScalar("font_family", sql`target_value`);
          }}
          className="w-[160px]"
        >
          <Select.Option value="Arial">Arial</Select.Option>
          <Select.Option value="Courier New">Courier New</Select.Option>
          <Select.Option value="Georgia">Georgia</Select.Option>
          <Select.Option value="Helvetica">Helvetica</Select.Option>
          <Select.Option value="Times New Roman">
            Times New Roman
          </Select.Option>
          <Select.Option value="Trebuchet MS">Trebuchet MS</Select.Option>
          <Select.Option value="Verdana">Verdana</Select.Option>
        </Select>

        <Input
          size="sm"
          sx={{
            width: "92px",
            "& input": { textAlign: "center" },
            "& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button":
              {
                appearance: "none",
                margin: 0,
              },
            "& input[type='number']": {
              MozAppearance: "textfield",
            },
          }}
          value={sql`coalesce(font_size, '16')`}
          type="number"
          startDecorator={
            <IconButton
              aria-label="Decrease font size"
              icon="Remove"
              variant="plain"
              size="sm"
              color="neutral"
              onClick={(s) => {
                s.jsCall({
                  module: "lexical_editor",
                  exportName: "executeCommand",
                  handle: sql`ui.editor_handle`,
                  argJson:
                    sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontSize', 'size', cast(coalesce(font_size::int, 16) - 1 as text))`,
                });
                s.setScalar(
                  "font_size",
                  sql`cast(coalesce(font_size::int, 16) - 1 as text)`,
                );
              }}
            />
          }
          endDecorator={
            <IconButton
              aria-label="Increase font size"
              icon="Add"
              variant="plain"
              size="sm"
              color="neutral"
              onClick={(s) => {
                s.jsCall({
                  module: "lexical_editor",
                  exportName: "executeCommand",
                  handle: sql`ui.editor_handle`,
                  argJson:
                    sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontSize', 'size', cast(coalesce(font_size::int, 16) + 1 as text))`,
                });
                s.setScalar(
                  "font_size",
                  sql`cast(coalesce(font_size::int, 16) + 1 as text)`,
                );
              }}
            />
          }
          onInput={(s) => {
            s.if(sql`try_cast(target_value as int) is not null`, (s) => {
              s.jsCall({
                module: "lexical_editor",
                exportName: "executeCommand",
                handle: sql`ui.editor_handle`,
                argJson:
                  sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontSize', 'size', target_value)`,
              });
              s.setScalar("font_size", sql`target_value`);
            });
          }}
        />
      </div>

      {/* Text formatting */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-pressed={sql`is_bold`}
          aria-label="Bold"
          icon="FormatBold"
          onClick={(s) => executeLexicalCommand(s, "formatBold")}
        />
        <IconButton
          aria-pressed={sql`is_italic`}
          aria-label="Italic"
          icon="FormatItalic"
          onClick={(s) => executeLexicalCommand(s, "formatItalic")}
        />
        <IconButton
          aria-pressed={sql`is_underline`}
          aria-label="Underline"
          icon="FormatUnderlined"
          onClick={(s) => executeLexicalCommand(s, "formatUnderline")}
        />
        <IconButton
          aria-pressed={sql`is_strikethrough`}
          aria-label="Strikethrough"
          icon="FormatStrikethrough"
          onClick={(s) => executeLexicalCommand(s, "formatStrikethrough")}
        />
      </ButtonGroup>

      {/* Colors */}
      <div className="flex gap-2 items-center">
        <ColorButton
          icon="FormatColorText"
          value={sql`coalesce(font_color, '#000000')`}
          onChange={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: sql`ui.editor_handle`,
              argJson:
                sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontColor', 'color', target_value)`,
            });
            s.setScalar("font_color", sql`target_value`);
          }}
          label="Text color"
        />
        <ColorButton
          icon="FormatColorFill"
          value={sql`coalesce(background_color, '#ffffff')`}
          onChange={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: sql`ui.editor_handle`,
              argJson:
                sql`json_build_object('handle', ui.editor_handle, 'command', 'formatBackgroundColor', 'color', target_value)`,
            });
            s.setScalar("background_color", sql`target_value`);
          }}
          label="Background color"
        />
      </div>

      {/* Alignment */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-pressed={sql`alignment = 'left'`}
          aria-label="Align Left"
          icon="FormatAlignLeft"
          onClick={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: sql`ui.editor_handle`,
              argJson:
                sql`json_build_object('handle', ui.editor_handle, 'command', 'formatAlignment', 'alignment', 'left')`,
            });
          }}
        />
        <IconButton
          aria-pressed={sql`alignment = 'center'`}
          aria-label="Align Center"
          icon="FormatAlignCenter"
          onClick={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: sql`ui.editor_handle`,
              argJson:
                sql`json_build_object('handle', ui.editor_handle, 'command', 'formatAlignment', 'alignment', 'center')`,
            });
          }}
        />
        <IconButton
          aria-pressed={sql`alignment = 'right'`}
          aria-label="Align Right"
          icon="FormatAlignRight"
          onClick={(s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle: sql`ui.editor_handle`,
              argJson:
                sql`json_build_object('handle', ui.editor_handle, 'command', 'formatAlignment', 'alignment', 'right')`,
            });
          }}
        />
      </ButtonGroup>

      {/* Super/subscript */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-pressed={sql`is_superscript`}
          aria-label="Superscript"
          icon="Superscript"
          onClick={(s) => executeLexicalCommand(s, "formatSuperscript")}
        />
        <IconButton
          aria-pressed={sql`is_subscript`}
          aria-label="Subscript"
          icon="Subscript"
          onClick={(s) => executeLexicalCommand(s, "formatSubscript")}
        />
      </ButtonGroup>

      {/* Indentation */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-label="Outdent"
          icon="FormatIndentDecrease"
          onClick={(s) => executeLexicalCommand(s, "outdent")}
        />
        <IconButton
          aria-label="Indent"
          icon="FormatIndentIncrease"
          onClick={(s) => executeLexicalCommand(s, "indent")}
        />
      </ButtonGroup>

      {/* Link */}
      <EmailEditorLinkPopover />

      {/* Variables */}
      {props.showVariables && (
        <EmailVariableInsertMenu variables={props.variables} />
      )}
    </Sheet>
  );
}

interface BasicEmailEditorProps {
  /** Unique ID for the editor container */
  id?: string;
  /** Initial content as JSON editor state */
  value?: Sql;
  /** Callback when content changes */
  onChange?: (s: DomStatements, value: Sql) => void;
  /** Debounce editor-to-state updates. Set to 0 for submit-critical forms. */
  onChangeDebounceMs?: number;
  /** Reload the editor from `value` whenever this expression changes. */
  resetKey?: Sql;
  /** Show variable insert menu */
  showVariables?: boolean;
  /** Variables available for insertion */
  variables?: Record<string, string>;
  /** Custom styles */
  sx?: Style;
}

/**
 * BasicEmailEditor - Full-featured rich text editor for email templates
 *
 * This component provides a comprehensive email editor with:
 * - Full text formatting (bold, italic, underline, strikethrough)
 * - Block formatting (headings, lists, quotes)
 * - Font family and size controls
 * - Text and background color pickers
 * - Text alignment
 * - Super/subscript
 * - Link insertion
 * - Variable insertion for email templates
 */
export function LexicalBasicEmailEditor(props: BasicEmailEditorProps) {
  // Auto-register the lexical_editor JS module when this component is used
  useJsModule("lexical_editor");

  const {
    id: idProp,
    value,
    onChange,
    onChangeDebounceMs = 50,
    resetKey,
    showVariables = true,
    variables,
    sx,
  } = props;

  const containerId = idProp || useUniqueId();

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("editor_handle", {
          type: "Uuid",
          expr: sql`random.uuid()`,
        });
        // Text formatting state
        s.defScalar("is_bold", false);
        s.defScalar("is_italic", false);
        s.defScalar("is_underline", { expr: false, allowNoRead: true });
        s.defScalar("is_strikethrough", false);
        s.defScalar("is_subscript", { expr: false, allowNoRead: true });
        s.defScalar("is_superscript", { expr: false, allowNoRead: true });
        // Style state
        s.defScalar("font_size", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("font_color", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("background_color", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("font_family", {
          type: "String",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("alignment", {
          expr: sql.lit`left`,
          allowNoRead: true,
        });
        // Link state
        s.defScalar("link_url", { type: "String" });
        // Block state
        s.defScalar("selected_block_type", sql.lit`normal`);
        // History state
        s.defScalar("can_undo", true);
        s.defScalar("can_redo", true);
        // Task handle
        s.defScalar("on_change_task", { type: "BigUint" });
      }}
    >
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          borderRadius: "md",
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
          ...sx,
        }}
      >
        {/* Toolbar */}
        <BasicEmailRichTextToolbar
          showVariables={showVariables}
          variables={variables}
        />

        {/* Editor container */}
        <div
          // The JS editor enables editing after initialization. Accepting input
          // before then loses that input when the initial content is loaded.
          contentEditable={false}
          id={containerId}
          sx={{
            ...styles.editor,
            width: "100%",
            p: 2,
            minHeight: "400px",
            fontSize: "14px",
            fontFamily: "Helvetica, Arial, sans-serif",
            letterSpacing: "normal",
            color: "text.primary",
            "& a": {
              pointerEvents: "none",
            },
          }}
          js={{
            handles: [{
              module: "lexical_editor",
              handle: sql`ui.editor_handle`,
              cleanup: "cleanup",
            }],
            on: {
              "lexical_editor.stateChanged": (s) => {
                // Sync UI state with actual editor formatting state from event payload
                s.setScalar(
                  "is_bold",
                  sql`coalesce(event.payload_json->>'is_bold' = 'true', false)`,
                );
                s.setScalar(
                  "is_italic",
                  sql`coalesce(event.payload_json->>'is_italic' = 'true', false)`,
                );
                s.setScalar(
                  "is_underline",
                  sql`coalesce(event.payload_json->>'is_underline' = 'true', false)`,
                );
                s.setScalar(
                  "is_strikethrough",
                  sql`coalesce(event.payload_json->>'is_strikethrough' = 'true', false)`,
                );
                s.setScalar(
                  "is_subscript",
                  sql`coalesce(event.payload_json->>'is_subscript' = 'true', false)`,
                );
                s.setScalar(
                  "is_superscript",
                  sql`coalesce(event.payload_json->>'is_superscript' = 'true', false)`,
                );
                s.setScalar(
                  "alignment",
                  sql`coalesce(event.payload_json->>'alignment', 'left')`,
                );
                s.setScalar(
                  "selected_block_type",
                  sql`coalesce(event.payload_json->>'selected_block_type', 'normal')`,
                );
                s.setScalar("link_url", sql`event.payload_json->>'link_url'`);
                // Strip 'px' suffix for integer parsing, handle null JSON value
                s.setScalar(
                  "font_size",
                  sql`case when event.payload_json->>'font_size' is null or event.payload_json->>'font_size' = 'null'
                    then null
                    else replace(event.payload_json->>'font_size', 'px', '')
                end`,
                );
                s.setScalar(
                  "font_color",
                  sql`event.payload_json->>'font_color'`,
                );
                s.setScalar(
                  "background_color",
                  sql`event.payload_json->>'background_color'`,
                );
                s.setScalar(
                  "font_family",
                  sql`event.payload_json->>'font_family'`,
                );
                s.setScalar(
                  "can_undo",
                  sql`coalesce(event.payload_json->>'can_undo' = 'true', false)`,
                );
                s.setScalar(
                  "can_redo",
                  sql`coalesce(event.payload_json->>'can_redo' = 'true', false)`,
                );
              },
              "lexical_editor.contentChanged": (s) => {
                if (onChange) {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "getContent",
                    handle: sql`ui.editor_handle`,
                    argJson: sql`json_build_object('handle', ui.editor_handle)`,
                    resultJsonScalar: "content_data",
                  });
                  s.defScalar(
                    "content_value",
                    sql`content_data->>'editorState'`,
                  );
                  if (onChangeDebounceMs <= 0) {
                    onChange(s, sql`content_value`);
                  } else {
                    s.if(sql`on_change_task is not null`, (s) => {
                      s.cancelTask(sql`on_change_task`);
                    });
                    s.startTaskWithOpts({
                      detached: true,
                      procedure: (s) => {
                        s.sleep(onChangeDebounceMs);
                        onChange(s, sql`content_value`);
                      },
                      handleScalar: "task",
                    });
                    s.setScalar("on_change_task", sql`task`);
                  }
                }
              },
            },
          }}
        />

        <Effect
          watch={[sql`editor_handle`]}
          triggerOnMount
          onChange={(s) => {
            s.sleep(1000);
            s.jsCall({
              module: "lexical_editor",
              exportName: "init",
              handle: sql`ui.editor_handle`,
              argJson: value
                ? sql`json_build_object('handle', ui.editor_handle, 'containerId', ${sql
                  .lit`${containerId}`}, 'initialContent', ${value})`
                : sql`json_build_object('handle', ui.editor_handle, 'containerId', ${sql
                  .lit`${containerId}`})`,
            });
          }}
        />
        {resetKey && value && (
          <Effect
            watch={[resetKey]}
            onChange={(s) => {
              s.if(sql`on_change_task is not null`, (s) => {
                s.cancelTask(sql`on_change_task`);
                s.setScalar("on_change_task", sql`null`);
              });
              s.conditional({
                condition: sql`${value} is null`,
                then: (s) => {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "setContent",
                    handle: sql`ui.editor_handle`,
                    argJson:
                      sql`json_build_object('handle', ui.editor_handle, 'text', '')`,
                  });
                },
                else: (s) => {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "setContentFromJson",
                    handle: sql`ui.editor_handle`,
                    argJson:
                      sql`json_build_object('handle', ui.editor_handle, 'editorState', ${value})`,
                  });
                },
              });
            }}
          />
        )}
      </div>
    </Data>
  );
}

interface LexicalRichTextDisplayProps {
  /** The Lexical JSON value to display */
  value: Sql;
  /** Rewrite only image-node sources beginning with this prefix. */
  imageSrcPrefixRewrite?: {
    prefix: Sql;
    replacement: Sql;
  };
  sx?: Style;
  className?: string;
  id?: string;
  /** Open embedded images in a full-viewport viewer when clicked. */
  expandImages?: boolean;
  /** Use the browser presentation shared with native document rendering. */
  documentFormatting?: boolean;
}

/**
 * A read-only display component for Lexical rich text content.
 * Renders HTML on the server; no client-side Lexical module is required.
 */
export function LexicalRichTextDisplay(props: LexicalRichTextDisplayProps) {
  ensureLexicalRichTextFunctions();
  const { value, id: idProp, expandImages = false } = props;
  const renderedHtml = props.imageSrcPrefixRewrite
    ? sql`lexical_rich_text_to_html_with_image_src_prefix(
        ${value},
        ${props.imageSrcPrefixRewrite.prefix},
        ${props.imageSrcPrefixRewrite.replacement}
      )`
    : sql`lexical_rich_text_to_html(${value})`;
  if (expandImages) useJsModule("lexical_editor");
  const containerId = idProp || useUniqueId();
  const containerIdValue = typeof containerId === "string"
    ? sql.lit(containerId)
    : containerId;
  const expansionHandle = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("display_handle", {
          type: "Uuid",
          expr: sql.null,
          allowNoRead: true,
        });
        s.defScalar("display_ready", {
          expr: false,
          allowNoRead: true,
        });
      }}
    >
      <div
        id={containerId}
        className={props.className}
        sx={[
          styles.editor,
          props.documentFormatting ? lexicalDocumentDisplayStyles : {},
          props.sx,
          expandImages
            ? {
              "& .lexical-image img": {
                cursor: "zoom-in",
              },
            }
            : {},
        ]}
        onMount={expandImages
          ? (s) => {
            s.jsCall({
              module: "lexical_editor",
              exportName: "enableReadOnlyImageExpansion",
              handle: expansionHandle,
              argJson: sql`json_build_object(
                'handle', ${expansionHandle},
                'containerId', ${containerIdValue}
              )`,
            });
          }
          : undefined}
        js={expandImages
          ? {
            handles: [{
              module: "lexical_editor",
              cleanup: "cleanupReadOnlyImageExpansion",
              handle: expansionHandle,
            }],
            on: {},
          }
          : undefined}
        serverRenderChildren={(s) => {
          s.return(renderedHtml);
        }}
        dangerouslySetInnerHTML={renderedHtml}
      />
    </Data>
  );
}

export {
  registerLexicalRichTextFunctions,
  registerLexicalRichTextFunctions as lexicalRichTextToHtml,
};
