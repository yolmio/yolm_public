import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { ColorButton } from "components/lexical/components/lexical_editor";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { execCmd, RibbonGroup, RibbonSep } from "./helpers";
import { LinkPopover } from "./link_popover";
import { TableInsertButton } from "./table_popover";

// =============================================
// LINE SPACING MENU
// =============================================
function LineSpacingMenu() {
  return (
    <Menu>
      <Menu.Button
        variant="outlined"
        color="neutral"
        size="sm"
        sx={{ minWidth: "32px", px: 1 }}
        aria-label="Line Spacing"
      >
        <span sx={{ fontSize: "11px", fontWeight: 600, lineHeight: 1 }}>
          {sql.lit`\u2195`}
        </span>
      </Menu.Button>
      <Menu.Content>
        {["1", "1.15", "1.5", "2"].map((spacing) => (
          <Menu.Item
            onClick={(s) => {
              s.jsCall({
                module: "lexical_editor",
                exportName: "executeCommand",
                handle: sql`ui.editor_handle`,
                argJson:
                  sql`json_build_object('handle', ui.editor_handle, 'command', 'setLineSpacing', 'spacing', ${
                    sql.lit(spacing)
                  })`,
              });
            }}
          >
            {sql.lit(spacing)}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
}

// =============================================
// HOME TAB
// =============================================
function HomeTab(
  { standardFormatting = false }: { standardFormatting?: boolean },
) {
  return (
    <div
      sx={{
        display: "flex",
        alignItems: "flex-end",
        gap: 0,
        flexWrap: "wrap",
        px: 2,
        py: 1,
      }}
    >
      {/* Clipboard group */}
      <RibbonGroup label="Clipboard">
        <ButtonGroup variant="outlined" color="neutral" size="sm">
          <IconButton
            aria-label="Undo"
            tooltip="Undo (Ctrl+Z)"
            icon="Undo"
            disabled={sql`not can_undo`}
            onClick={(s) => execCmd(s, "undo")}
          />
          <IconButton
            aria-label="Redo"
            tooltip="Redo (Ctrl+Y)"
            icon="Redo"
            disabled={sql`not can_redo`}
            onClick={(s) => execCmd(s, "redo")}
          />
        </ButtonGroup>
      </RibbonGroup>

      <RibbonSep />

      {/* Font group */}
      <RibbonGroup label="Font">
        <div className="flex flex-col gap-1">
          {!standardFormatting && (
            <div className="flex gap-1 items-center">
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
                sx={{ width: "130px" }}
              >
                <Each table="fonts" recordName="font">
                  <Select.Option value={sql`font.name`}>
                    {sql`font.name`}
                  </Select.Option>
                </Each>
              </Select>

              <Input
                size="sm"
                sx={{
                  width: "80px",
                  "& input": { textAlign: "center" },
                  "& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button":
                    {
                      appearance: "none",
                      margin: 0,
                    },
                }}
                value={sql`coalesce(font_size, '11')`}
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
                          sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontSize', 'size', cast(coalesce(font_size::int, 11) - 1 as text))`,
                      });
                      s.setScalar(
                        "font_size",
                        sql`cast(coalesce(font_size::int, 11) - 1 as text)`,
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
                          sql`json_build_object('handle', ui.editor_handle, 'command', 'formatFontSize', 'size', cast(coalesce(font_size::int, 11) + 1 as text))`,
                      });
                      s.setScalar(
                        "font_size",
                        sql`cast(coalesce(font_size::int, 11) + 1 as text)`,
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
          )}
          <div className="flex gap-0.5 items-center">
            <ButtonGroup variant="outlined" color="neutral" size="sm">
              <IconButton
                aria-pressed={sql`is_bold`}
                aria-label="Bold"
                tooltip="Bold (Ctrl+B)"
                icon="FormatBold"
                onClick={(s) => execCmd(s, "formatBold")}
              />
              <IconButton
                aria-pressed={sql`is_italic`}
                aria-label="Italic"
                tooltip="Italic (Ctrl+I)"
                icon="FormatItalic"
                onClick={(s) => execCmd(s, "formatItalic")}
              />
              <IconButton
                aria-pressed={sql`is_underline`}
                aria-label="Underline"
                tooltip="Underline (Ctrl+U)"
                icon="FormatUnderlined"
                onClick={(s) => execCmd(s, "formatUnderline")}
              />
              <IconButton
                aria-pressed={sql`is_strikethrough`}
                aria-label="Strikethrough"
                tooltip="Strikethrough"
                icon="FormatStrikethrough"
                onClick={(s) => execCmd(s, "formatStrikethrough")}
              />
              <IconButton
                aria-pressed={sql`is_subscript`}
                aria-label="Subscript"
                tooltip="Subscript"
                icon="Subscript"
                onClick={(s) => execCmd(s, "formatSubscript")}
              />
              <IconButton
                aria-pressed={sql`is_superscript`}
                aria-label="Superscript"
                tooltip="Superscript"
                icon="Superscript"
                onClick={(s) => execCmd(s, "formatSuperscript")}
              />
            </ButtonGroup>
            {!standardFormatting && (
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
            )}
            {!standardFormatting && (
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
                label="Highlight color"
              />
            )}
          </div>
        </div>
      </RibbonGroup>

      <RibbonSep />

      {/* Paragraph group */}
      <RibbonGroup label="Paragraph">
        <div className="flex flex-col gap-1">
          <div className="flex gap-0.5 items-center">
            <ButtonGroup variant="outlined" color="neutral" size="sm">
              <IconButton
                aria-pressed={sql`alignment = 'left'`}
                aria-label="Align Left"
                tooltip="Align Left"
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
                tooltip="Align Center"
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
                tooltip="Align Right"
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
              <IconButton
                aria-pressed={sql`alignment = 'justify'`}
                aria-label="Justify"
                tooltip="Justify"
                icon="FormatAlignJustify"
                onClick={(s) => {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: sql`ui.editor_handle`,
                    argJson:
                      sql`json_build_object('handle', ui.editor_handle, 'command', 'formatAlignment', 'alignment', 'justify')`,
                  });
                }}
              />
            </ButtonGroup>
          </div>
          <div className="flex gap-0.5 items-center">
            <ButtonGroup variant="outlined" color="neutral" size="sm">
              <IconButton
                aria-pressed={sql`selected_block_type = 'bullet'`}
                aria-label="Bulleted List"
                tooltip="Bulleted List"
                icon="FormatListBulleted"
                onClick={(s) => {
                  s.conditional({
                    condition: sql`selected_block_type = 'bullet'`,
                    then: (s) => execCmd(s, "formatNormal"),
                    else: (s) => execCmd(s, "formatBulletedList"),
                  });
                }}
              />
              <IconButton
                aria-pressed={sql`selected_block_type = 'number'`}
                aria-label="Numbered List"
                tooltip="Numbered List"
                icon="FormatListNumbered"
                onClick={(s) => {
                  s.conditional({
                    condition: sql`selected_block_type = 'number'`,
                    then: (s) => execCmd(s, "formatNormal"),
                    else: (s) => execCmd(s, "formatNumberedList"),
                  });
                }}
              />
              <IconButton
                aria-label="Outdent"
                tooltip="Decrease Indent"
                icon="FormatIndentDecrease"
                onClick={(s) => execCmd(s, "outdent")}
              />
              <IconButton
                aria-label="Indent"
                tooltip="Increase Indent"
                icon="FormatIndentIncrease"
                onClick={(s) => execCmd(s, "indent")}
              />
            </ButtonGroup>
            {!standardFormatting && <LineSpacingMenu />}
          </div>
        </div>
      </RibbonGroup>

      <RibbonSep />

      {/* Styles group */}
      <RibbonGroup label="Styles">
        <Select
          size="sm"
          value={sql`selected_block_type`}
          onInput={(s) => {
            s.if(
              sql`target_value = 'paragraph' or target_value = 'normal'`,
              (s) => execCmd(s, "formatNormal"),
            );
            s.if(sql`target_value = 'h1'`, (s) => execCmd(s, "formatH1"));
            s.if(sql`target_value = 'h2'`, (s) => execCmd(s, "formatH2"));
            s.if(sql`target_value = 'h3'`, (s) => execCmd(s, "formatH3"));
            s.if(sql`target_value = 'h4'`, (s) => execCmd(s, "formatH4"));
            s.if(sql`target_value = 'h5'`, (s) => execCmd(s, "formatH5"));
            s.if(sql`target_value = 'h6'`, (s) => execCmd(s, "formatH6"));
            s.if(
              sql`target_value = 'quote'`,
              (s) => execCmd(s, "formatQuote"),
            );
            s.if(
              sql`target_value = 'bullet'`,
              (s) => execCmd(s, "formatBulletedList"),
            );
            s.if(
              sql`target_value = 'number'`,
              (s) => execCmd(s, "formatNumberedList"),
            );
            s.setScalar("selected_block_type", sql`target_value`);
          }}
          sx={{ width: "130px" }}
        >
          <Select.Option value="normal">Normal</Select.Option>
          <Select.Option value="h1">Heading 1</Select.Option>
          <Select.Option value="h2">Heading 2</Select.Option>
          <Select.Option value="h3">Heading 3</Select.Option>
          <Select.Option value="h4">Heading 4</Select.Option>
          <Select.Option value="h5">Heading 5</Select.Option>
          <Select.Option value="h6">Heading 6</Select.Option>
          <Select.Option value="quote">Quote</Select.Option>
        </Select>
      </RibbonGroup>

      <RibbonSep />

      {/* Editing group */}
      <RibbonGroup label="Editing">
        <IconButton
          aria-label="Clear Formatting"
          tooltip="Clear Formatting"
          icon="FormatClear"
          variant="outlined"
          color="neutral"
          size="sm"
          onClick={(s) => execCmd(s, "clearFormatting")}
        />
      </RibbonGroup>
    </div>
  );
}

// =============================================
// INSERT TAB
// =============================================
function DefaultPictureControl() {
  return (
    <Button
      variant="outlined"
      color="neutral"
      size="sm"
      startIcon="Image"
      onClick={(s) => execCmd(s, "insertImageFromFile")}
    >
      Picture
    </Button>
  );
}

function InsertTab({ pictureControl }: { pictureControl?: JSX.Element }) {
  return (
    <div
      sx={{
        display: "flex",
        alignItems: "flex-end",
        gap: 0,
        flexWrap: "wrap",
        px: 2,
        py: 1,
      }}
    >
      <RibbonGroup label="Pictures">
        {pictureControl ?? <DefaultPictureControl />}
      </RibbonGroup>
      <RibbonSep />
      <RibbonGroup label="Tables">
        <TableInsertButton />
      </RibbonGroup>
      <RibbonSep />
      <RibbonGroup label="Links">
        <LinkPopover />
      </RibbonGroup>
    </div>
  );
}

// =============================================
// LAYOUT TAB
// =============================================
function LayoutTab() {
  return (
    <div
      sx={{
        display: "flex",
        alignItems: "flex-end",
        gap: 0,
        flexWrap: "wrap",
        px: 2,
        py: 1,
      }}
    >
      <RibbonGroup label="Spacing">
        <div className="flex gap-2 items-center">
          <Typography level="body-xs">Line Spacing:</Typography>
          <Select
            size="sm"
            value={sql.lit`1.15`}
            onInput={(s) => {
              s.jsCall({
                module: "lexical_editor",
                exportName: "executeCommand",
                handle: sql`ui.editor_handle`,
                argJson:
                  sql`json_build_object('handle', ui.editor_handle, 'command', 'setLineSpacing', 'spacing', target_value)`,
              });
            }}
            sx={{ width: "80px" }}
          >
            <Select.Option value="1">1.0</Select.Option>
            <Select.Option value="1.15">1.15</Select.Option>
            <Select.Option value="1.5">1.5</Select.Option>
            <Select.Option value="2">2.0</Select.Option>
            <Select.Option value="2.5">2.5</Select.Option>
            <Select.Option value="3">3.0</Select.Option>
          </Select>
        </div>
      </RibbonGroup>
      <RibbonSep />
      <RibbonGroup label="Margins">
        <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
          1 in (all sides)
        </Typography>
      </RibbonGroup>
      <RibbonSep />
      <RibbonGroup label="Orientation">
        <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
          Portrait - Letter (8.5" x 11")
        </Typography>
      </RibbonGroup>
    </div>
  );
}

// =============================================
// RIBBON COMPONENT
// =============================================
export function Ribbon(
  { pictureControl, standardFormatting = false }: {
    pictureControl?: JSX.Element;
    standardFormatting?: boolean;
  },
) {
  return (
    <Sheet
      variant="plain"
      sx={{
        borderBottom: "1px solid",
        borderColor: "divider",
        flexShrink: 0,
      }}
    >
      {/* Tabs */}
      <div
        sx={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        {(standardFormatting
          ? ["Home", "Insert"]
          : ["Home", "Insert", "Layout"]).map((label, index) => (
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              aria-pressed={sql`ribbon_tab = ${index}`}
              sx={{
                borderRadius: 0,
                px: 3,
                py: 1,
                fontWeight: 500,
                fontSize: "13px",
              }}
              onClick={(s) => s.setScalar("ribbon_tab", sql`${index}`)}
            >
              {sql.lit(label)}
            </Button>
          ))}
      </div>

      {/* Tab content */}
      <Show when={sql`ribbon_tab = 0`}>
        <HomeTab standardFormatting={standardFormatting} />
      </Show>
      <Show when={sql`ribbon_tab = 1`}>
        <InsertTab pictureControl={pictureControl} />
      </Show>
      <Show when={sql`ribbon_tab = 2`}>
        <LayoutTab />
      </Show>
    </Sheet>
  );
}
