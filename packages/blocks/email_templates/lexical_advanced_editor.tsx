import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Menu } from "components/menu";
import { Select } from "components/select";
import { Sheet } from "components/sheet";
import { Snackbar } from "components/snackbar";
import { Tabs } from "components/tabs";
import { Typography } from "components/typography";

import { Sidebar } from "components/sidebar";
import { FormICtxKey, SidebarPresenceICtxKey } from "std/ictx";
import { useJsModule } from "std/js_modules";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type { DomStatements, IStatementsBase } from "std/statements";
import { flexGrowStyles, visuallyHiddenStyles } from "std/style_utils";
import { useBlockOptional } from "std/system";
import { EmailTemplatesBlock } from "./index";
import { generateAdvancedTemplateMjml } from "./advanced_template_mjml";
import {
  Conditional,
  Effect,
  Match,
  Show,
  Switch,
  useICtx,
  useOptionalICtx,
  usePhase,
  useUniqueId,
} from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { Form, useCursorHelper, useFieldHelper } from "std/form";
import type { Color } from "components/types";

// Helper function to execute Lexical editor commands via JS module
function execLexicalCmd(
  s: DomStatements,
  command: string,
  params?: Record<string, AnyExpr>,
  options?: { handle?: Sql; resultJsonScalar?: string },
) {
  const handle = options?.handle ?? sql`editor_handle`;
  let argJson: Sql;

  if (params && Object.keys(params).length > 0) {
    // Build the params part of json_build_object
    const paramParts = Object.entries(params)
      .map(([k, v]) => sql`${sql.lit(k)}, ${v}`)
      .reduce((acc, part, i) => (i === 0 ? part : sql`${acc}, ${part}`));
    argJson = sql`json_build_object('handle', ${handle}, 'command', ${
      sql.lit(command)
    }, ${paramParts})`;
  } else {
    argJson = sql`json_build_object('handle', ${handle}, 'command', ${
      sql.lit(command)
    })`;
  }

  s.jsCall({
    module: "lexical_editor",
    exportName: "executeCommand",
    handle,
    argJson,
    resultJsonScalar: options?.resultJsonScalar,
  });
}

// Helper for non-command JS calls (init, getContent, getEventData, etc.)
function callLexicalModule(
  s: DomStatements,
  exportName: string,
  handle: Sql,
  argJson: Sql,
  resultJsonScalar?: string,
) {
  s.jsCall({
    module: "lexical_editor",
    exportName,
    handle,
    argJson,
    resultJsonScalar,
  });
}

function createMjml<T extends IStatementsBase>(s: T) {
  generateAdvancedTemplateMjml(s, {
    prefix: "preview_",
    templateQuery: sql`select * from write_email_template`,
    sectionsQuery:
      sql`select *, write_ui_id as render_id from write_email_sections`,
    columnsQuery: sql`select *, write_ui_id as render_id,
      parent_write_ui_id as parent_render_id from write_email_columns`,
    blocksQuery:
      sql`select *, parent_write_ui_id as parent_render_id from write_email_blocks`,
  });
}

function TextContent() {
  const cursor = useCursorHelper();
  const containerId = sql.concat("editor_", cursor.recordUiId);

  return (
    <Data
      local
      watch={[cursor.field("text_content").value]}
      procedure={(s) => {
        s.defScalar("local_editor_handle", sql.lit``);
      }}
    >
      <div
        contentEditable
        sx={{
          cursor: "text",
          width: "100%",
          wordBreak: "break-word",
          fontSize: "13px",
          fontFamily: "Helvetica, Arial, sans-serif",
          my: "10px",
          mx: 0,
          letterSpacing: "normal",
          color: "#000000",
          lineHeight: "1",
          textAlign: "left",
          outline: "none",
          "& a": {
            pointerEvents: "none",
            textDecoration: "underline",
            color: "primary.main",
          },
          "& .lexical-paragraph": {
            margin: "0 0 0.5em 0",
          },
          "& .lexical-paragraph:last-child": {
            marginBottom: 0,
          },
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
          "& .lexical-quote, & blockquote": {
            border: "0 solid",
            borderColor: "divider",
            borderLeftWidth: "0.3em",
            marginLeft: "0.3em",
            paddingLeft: "0.6em",
            marginBottom: "0.5em",
          },
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
          "& .lexical-link": {
            color: "#0066cc",
            textDecoration: "underline",
          },
        }}
        id={containerId}
        onFocus={(s) => {
          s.setScalar("editor_handle", sql`local_editor_handle`);
        }}
        js={{
          handles: [{
            module: "lexical_editor",
            handle: sql`ui.local_editor_handle`,
            cleanup: "cleanup",
          }],
          on: {
            "lexical_editor.ready": (s) => {
              s.setScalar("editor_handle", sql`local_editor_handle`);
            },
            "lexical_editor.stateChanged": (s) => {
              // Sync UI state with actual editor formatting state from event payload
              s.modify(sql`update text_toolbar_state set
                is_bold = coalesce(event.payload_json->>'is_bold' = 'true', false),
                is_italic = coalesce(event.payload_json->>'is_italic' = 'true', false),
                is_underline = coalesce(event.payload_json->>'is_underline' = 'true', false),
                is_strikethrough = coalesce(event.payload_json->>'is_strikethrough' = 'true', false),
                is_superscript = coalesce(event.payload_json->>'is_superscript' = 'true', false),
                is_subscript = coalesce(event.payload_json->>'is_subscript' = 'true', false),
                alignment = coalesce(event.payload_json->>'alignment', 'left'),
                selected_block_type = coalesce(event.payload_json->>'selected_block_type', 'paragraph'),
                link_url = event.payload_json->>'link_url',
                can_undo = coalesce(event.payload_json->>'can_undo' = 'true', false),
                can_redo = coalesce(event.payload_json->>'can_redo' = 'true', false)
              `);
            },
          },
        }}
      >
        Text content
      </div>
      <Effect
        watch={[sql`local_editor_handle`]}
        triggerOnMount
        onChange={(s) => {
          s.if(sql`local_editor_handle = ''`, (s) => {
            s.setScalar("local_editor_handle", sql`random.uuid()`);
            s.setScalar("editor_handle", sql`local_editor_handle`);
            callLexicalModule(
              s,
              "init",
              sql`ui.local_editor_handle`,
              sql`json_build_object(
                'handle', ui.local_editor_handle,
                'containerId', ${containerId},
                'initialContent', ${cursor.field("text_content").value}
              )`,
            );
          });
        }}
      />
    </Data>
  );
}

function ButtonContent() {
  const cursor = useCursorHelper();
  return (
    <div
      style={{
        "justify-content": sql`case
          when ${cursor.field("button_align").value} = 'left' then 'flex-start'
          when ${cursor.field("button_align").value} = 'right' then 'flex-end'
          else 'center'
        end`,
      }}
      className="w-full flex"
    >
      <div
        style={{
          "background-color": sql`${
            cursor.field("button_background_color").value
          }`,
          "border-radius": sql`${
            cursor.field("button_border_radius").value
          } || 'px'`,
          width: sql`case when ${
            cursor.field("button_full_width").value
          } then '100%' else 'auto' end`,
          "padding-top": sql`${
            cursor.field("button_padding_top").value
          } || 'px'`,
          "padding-right": sql`${
            cursor.field("button_padding_right").value
          } || 'px'`,
          "padding-bottom": sql`${
            cursor.field("button_padding_bottom").value
          } || 'px'`,
          "padding-left": sql`${
            cursor.field("button_padding_left").value
          } || 'px'`,
          "border-style": sql`${cursor.field("button_border_style").value}`,
          "border-width": sql`${
            cursor.field("button_border_width").value
          } || 'px'`,
          "border-color": sql`${cursor.field("button_border_color").value}`,
          "font-family": sql`${cursor.field("button_font_family").value}`,
          "font-size": sql`${cursor.field("button_font_size").value} || 'px'`,
          color: sql`${cursor.field("button_font_color").value}`,
          "text-align": sql`${cursor.field("button_text_align").value}`,
        }}
        className="cursor-text"
      >
        {cursor.field("button_label").value}
      </div>
    </div>
  );
}

function DividerContent() {
  const cursor = useCursorHelper();
  return (
    <div
      sx={{
        mx: "auto",
        my: 0,
      }}
      style={{
        "border-top-width": sql`${
          cursor.field("divider_border_width").value
        } || 'px'`,
        "border-top-style": sql`${cursor.field("divider_border_style").value}`,
        "border-top-color": sql`${cursor.field("divider_border_color").value}`,
        width: sql`${cursor.field("divider_width").value} || '%'`,
      }}
    />
  );
}

function SpacerContent() {
  const cursor = useCursorHelper();
  return (
    <div
      sx={{
        minHeight: "10px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        position: "relative",
      }}
      style={{
        height: sql`${cursor.field("spacer_height").value} || 'px'`,
      }}
    />
  );
}

function ImageContent() {
  const cursor = useCursorHelper();
  return (
    <div
      style={{
        "justify-content": sql`case
          when ${cursor.field("image_align").value} = 'left' then 'flex-start'
          when ${cursor.field("image_align").value} = 'right' then 'flex-end'
          else 'center'
        end`,
      }}
      className="flex"
    >
      <div
        style={{
          "max-width": sql`${cursor.field("image_width").value} || 'px'`,
        }}
        className="w-full"
      >
        <img
          draggable={false}
          sx={{
            border: "none",
            outline: "none",
            display: "block",
            textDecoration: "none",
            height: "auto",
            width: "100%",
            minHeight: "20px",
          }}
          style={{
            "border-radius": sql`case
              when ${cursor.field("image_shape").value} = 'circle' then '50%'
              when ${cursor.field("image_shape").value} = 'rounded' then ${
              cursor.field("image_border_radius").value
            } || 'px'
              else '0'
            end`,
          }}
          src={sql`${cursor.field("image_src").value}`}
          alt={sql`${cursor.field("image_alt").value}`}
        />
      </div>
    </div>
  );
}

function RawContent() {
  const cursor = useCursorHelper();
  return (
    <div dangerouslySetInnerHTML={sql`${cursor.field("raw_html").value}`} />
  );
}

function Content() {
  if (usePhase() === "gather") {
    return;
  }
  const cursor = useCursorHelper();
  const type = cursor.field("type").value;
  return (
    <div
      draggable
      classes="content"
      className="relative"
      style={{
        "padding-top": sql`${cursor.field("padding_top").value} || 'px'`,
        "padding-right": sql`${cursor.field("padding_right").value} || 'px'`,
        "padding-bottom": sql`${cursor.field("padding_bottom").value} || 'px'`,
        "padding-left": sql`${cursor.field("padding_left").value} || 'px'`,
      }}
      onClick={(s) => {
        s.event.stopPropagation();
        s.setScalar("selected_content", cursor.recordUiId);
        s.setScalar("selected_section", sql.null);
        s.setScalar("selected_tab", sql.lit`edit`);
      }}
      id={sql.concat("content_", cursor.recordUiId)}
      onDragOver={(s) => {
        s.setScalar("drop_target_content", cursor.recordUiId);
        s.element(sql`'content_' || ${cursor.recordUiId}`)
          .getBoundingClientRect(
            "rect",
          );
        s.defScalar("midpoint", sql`rect.top + (rect.bottom - rect.top) / 2`);
        s.setScalar(
          "drop_target_location",
          sql`case
            when event.client_y <= midpoint then cast('top' as enums.drop_target_location)
            else cast('bottom' as enums.drop_target_location)
          end`,
        );
      }}
      onDragStart={(s) => {
        s.event.stopPropagation();
        s.setScalar("dragging_content", true);
      }}
      onDragEnd={(s) => {
        s.event.stopPropagation();
        s.setScalar("dragging_content", false);
        s.defScalar(
          "target_order",
          sql`(select order from write_email_blocks where write_ui_id = drop_target_content)`,
        );
        s.defScalar(
          "ordering_before",
          sql`(select max(order) from write_email_blocks where order < target_order and parent_write_ui_id = dragging_over_column)`,
        );
        s.defScalar(
          "ordering_after",
          sql`(select min(order) from write_email_blocks where order > target_order and parent_write_ui_id = dragging_over_column)`,
        );
        s.modify(sql`update write_email_blocks set order = case
            when target_order is not null and drop_target_location = 'top' then ordering.new(ordering_before, target_order)
            when target_order is not null and drop_target_location = 'bottom' then ordering.new(target_order, ordering_after)
            else case
              when (select max(order) from write_email_blocks where parent_write_ui_id = dragging_over_column) is null then ordering.n_after(0)
              else ordering.new((select max(order) from write_email_blocks where parent_write_ui_id = dragging_over_column))
            end
          end,
          parent_write_ui_id = dragging_over_column
          where write_ui_id = ${cursor.recordUiId}`);
      }}
    >
      <div
        sx={{
          pointerEvents: "none",
          position: "absolute",
          top: 0,
          left: 1,
          right: 1,
          bottom: 0,
          ".content:hover &:not(.selected)": {
            border: "1px solid",
            borderColor: "primary-200",
          },
          "&.selected": {
            border: "1px solid",
            borderColor: "primary-400",
          },
          "&.dragging-over-top": {
            borderTop: "2px solid",
            borderColor: "primary-400",
          },
          "&.dragging-over-bottom": {
            borderBottom: "2px solid",
            borderColor: "primary-400",
          },
        }}
        dynamicClasses={[
          {
            classes: "selected",
            condition: sql`selected_content = ${cursor.recordUiId}`,
          },
          {
            classes: "dragging-over-top",
            condition:
              sql`dragging_content and drop_target_content = ${cursor.recordUiId} and drop_target_location = 'top'`,
          },
          {
            classes: "dragging-over-bottom",
            condition:
              sql`dragging_content and drop_target_content = ${cursor.recordUiId} and drop_target_location = 'bottom'`,
          },
        ]}
      />
      <Show when={sql`selected_content = ${cursor.recordUiId}`}>
        {/*Example_ButtonGroup_Start*/}
        <ButtonGroup
          orientation="vertical"
          sx={{
            position: "absolute",
            top: 0,
            right: -42,
            bottom: 0,
            justifyContent: "center",
            zIndex: 1000,
          }}
          variant="soft"
          color="neutral"
          size="sm"
        >
          <IconButton
            aria-label="Delete section"
            icon="Delete"
            onClick={(s) => {
              s.setScalar("selected_content", sql.null);
              cursor.delete(s);
            }}
          />
          <IconButton
            aria-label="Duplicate section"
            icon="ContentCopy"
            onClick={(s) => {
              cursor.duplicate(s);
            }}
          />
        </ButtonGroup>
        {/*Example_ButtonGroup_End*/}
      </Show>
      <div>
        <Switch>
          <Match when={sql`${type} = 'text'`}>
            <TextContent />
          </Match>
          <Match when={sql`${type} = 'button'`}>
            <ButtonContent />
          </Match>
          <Match when={sql`${type} = 'divider'`}>
            <DividerContent />
          </Match>
          <Match when={sql`${type} = 'spacer'`}>
            <SpacerContent />
          </Match>
          <Match when={sql`${type} = 'image'`}>
            <ImageContent />
          </Match>
          <Match when={sql`${type} = 'sql'`}>
            <RawContent />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

interface ContentDraggableProps {
  contentFields: Record<string, AnyExpr>;
  children: Node;
}

function ContentDraggable({ contentFields, children }: ContentDraggableProps) {
  return (
    <Sheet
      variant="soft"
      color="primary"
      draggable
      harmonize
      sx={{
        borderRadius: "sm",
        cursor: "grab",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        border: "2px solid",
        borderColor: "primary-300",
        p: 4,
        transition: "transform 0.2s",
        "&:hover": {
          transform: "scale(1.02)",
        },
      }}
      onDragStart={(s) => {
        s.setScalar("dragging_content", true);
      }}
      onDragEnd={(s) => {
        s.setScalar("dragging_content", false);
        const ctx = useICtx(FormICtxKey);
        const content = ctx.table("email_blocks");
        s.defScalar(
          "target_order",
          sql`(select order from write_email_blocks where write_ui_id = drop_target_content)`,
        );
        s.defScalar(
          "ordering_before",
          sql`(select max(order) from write_email_blocks where order < target_order and parent_write_ui_id = dragging_over_column)`,
        );
        s.defScalar(
          "ordering_after",
          sql`(select min(order) from write_email_blocks where order > target_order and parent_write_ui_id = dragging_over_column)`,
        );
        content.addRecord(
          s,
          {
            ...contentFields,
            order: sql`case
              when target_order is not null and drop_target_location = 'top' then ordering.new(ordering_before, target_order)
              when target_order is not null and drop_target_location = 'bottom' then ordering.new(target_order, ordering_after)
              else case
                when (select max(order) from write_email_blocks where parent_write_ui_id = dragging_over_column) is null then ordering.n_after(0)
                else ordering.new((select max(order) from write_email_blocks where parent_write_ui_id = dragging_over_column))
              end
          end`,
          },
          sql`dragging_over_column`,
        );
      }}
    >
      {children}
    </Sheet>
  );
}

interface SectionDraggableProps {
  columnWidths: number[];
}

function SectionDraggable({ columnWidths }: SectionDraggableProps) {
  return (
    <div
      draggable
      sx={{
        cursor: "grab",
        height: 36,
        display: "flex",
        border: "2px solid",
        borderColor: "neutral-400",
        boxSizing: "border-box",
        borderRadius: "sm",
        transition: "transform 0.2s",
        "&:hover": {
          transform: "scale(1.02)",
        },
      }}
      onDragStart={(s) => {
        s.setScalar("dragging_section", true);
      }}
      onDragEnd={(s) => {
        s.setScalar("dragging_section", false);
        const ctx = useICtx(FormICtxKey);
        const section = ctx.table("email_sections");
        s.defScalar(
          "target_order",
          sql`(select order from write_email_sections where write_ui_id = drop_target_section)`,
        );
        s.defScalar(
          "ordering_before",
          sql`(select max(order) from write_email_sections where order < target_order)`,
        );
        s.defScalar(
          "ordering_after",
          sql`(select min(order) from write_email_sections where order > target_order)`,
        );
        section.addRecordWithRelations(
          s,
          {
            full_width: false,
            order: sql`case
            when target_order is not null and drop_target_location = 'top' then ordering.new(ordering_before, target_order)
            when target_order is not null and drop_target_location = 'bottom' then ordering.new(target_order, ordering_after)
            else case
              when (select max(order) from write_email_sections) is null then ordering.n_after(0)
              else ordering.new((select max(order) from write_email_sections))
            end
          end`,
          },
          {
            email_columns: columnWidths.map((width, i) => {
              return {
                width,
                order: sql`ordering.n_after(${i})`,
              };
            }),
          },
        );
      }}
    >
      {columnWidths.map((width) => {
        return (
          <div
            sx={{
              flexGrow: `${width}`,
              "&:not(:last-child)": {
                borderRight: "2px solid",
                borderColor: "neutral-500",
              },
              borderRadius: 0,
            }}
          />
        );
      })}
    </div>
  );
}

function EmptyColumn() {
  return (
    <div
      sx={{
        height: "100%",
        p: "2px",
        minHeight: "120px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        sx={{
          height: "100%",
          width: "100%",
          p: 3,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          border: "2px dashed",
          borderColor: "neutral-300",
          borderRadius: "md",
          backgroundColor: "background-level1",
        }}
      >
        <MaterialIcon
          icon="Add"
          fontSize="xl"
          className="mb-2 text-neutral-500"
        />
        <Typography level="body-sm" className="text-neutral-500">
          Drop a content block here
        </Typography>
      </div>
    </div>
  );
}

function Column() {
  return (
    <div
      style={{
        // yeahhhh
        "flex-basis": sql`case
          when write_email_column.width = '33' then '33.3333%'
          when write_email_column.width = '66' then '66.6666%'
          else write_email_column.width || '%'
        end`,
      }}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        position: "relative",
        "&.drag-over": {
          backgroundColor: "primary-50",
          transition: "background-color 0.2s",
          outline: "2px dashed",
          outlineColor: "primary-300",
          "& > *": {
            opacity: 0.6,
          },
        },
      }}
      dynamicClass={{
        classes: "drag-over",
        condition:
          sql`dragging_over_column = write_email_column.write_ui_id and dragging_content`,
      }}
      onDragOver={(s) => {
        s.setScalar(
          "dragging_over_column",
          sql`write_email_column.write_ui_id`,
        );
      }}
    >
      <Form.Relation table="email_blocks" fields={["text_content", "order"]}>
        <Form.Each orderBy={sql`order`} fallback={<EmptyColumn />}>
          <Content />
        </Form.Each>
      </Form.Relation>
    </div>
  );
}

function Section() {
  return (
    <div
      draggable
      classes="section"
      sx={{
        position: "relative",
        ml: "2px",
        cursor: "grab",
        display: "flex",
        justifyContent: "center",
      }}
      onClick={(s) => {
        s.setScalar("selected_section", sql`write_email_section.write_ui_id`);
        s.setScalar("selected_content", sql.null);
        s.setScalar("selected_tab", sql.lit`edit`);
      }}
      id={sql.concat("section_", sql`write_email_section.write_ui_id`)}
      onDragOver={(s) => {
        s.setScalar(
          "drop_target_section",
          sql`write_email_section.write_ui_id`,
        );
        s.element(
          sql`'section_' || write_email_section.write_ui_id`,
        ).getBoundingClientRect("rect");
        s.defScalar("midpoint", sql`rect.top + (rect.bottom - rect.top) / 2`);
        s.setScalar(
          "drop_target_location",
          sql`case
            when event.client_y <= midpoint then cast('top' as enums.drop_target_location)
            else cast('bottom' as enums.drop_target_location)
          end`,
        );
      }}
      onDragStart={(s) => {
        s.setScalar("dragging_section", true);
      }}
      onDragEnd={(s) => {
        s.setScalar("dragging_section", false);
        s.defScalar(
          "target_order",
          sql`(select order from write_email_sections where write_ui_id = drop_target_section)`,
        );
        s.defScalar(
          "ordering_before",
          sql`(select max(order) from write_email_sections where order < target_order)`,
        );
        s.defScalar(
          "ordering_after",
          sql`(select min(order) from write_email_sections where order > target_order)`,
        );
        s.modify(sql`update write_email_sections
          set order = case
            when target_order is not null and drop_target_location = 'top' then ordering.new(ordering_before, target_order)
            when target_order is not null and drop_target_location = 'bottom' then ordering.new(target_order, ordering_after)
            else case
              when (select max(order) from write_email_sections) is null then ordering.n_after(0)
              else ordering.new((select max(order) from write_email_sections))
            end
          end
          where write_ui_id = write_email_section.write_ui_id`);
      }}
    >
      <div
        sx={{
          pointerEvents: "none",
          position: "absolute",
          top: 0,
          left: 1,
          right: 1,
          bottom: 0,
          ".section:hover &:not(.selected)": {
            border: "2px solid",
            borderColor: "primary-200",
          },
          "&.selected": {
            border: "2px solid",
            borderColor: "primary-400",
          },
          "&.dragging-over-top": {
            borderTop: "2px solid",
            borderColor: "primary-400",
          },
          "&.dragging-over-bottom": {
            borderBottom: "2px solid",
            borderColor: "primary-400",
          },
        }}
        dynamicClasses={[
          {
            classes: "selected",
            condition: sql`selected_section = write_email_section.write_ui_id`,
          },
          {
            classes: "dragging-over-top",
            condition:
              sql`dragging_section and drop_target_section = write_email_section.write_ui_id and drop_target_location = 'top'`,
          },
          {
            classes: "dragging-over-bottom",
            condition:
              sql`dragging_section and drop_target_section = write_email_section.write_ui_id and drop_target_location = 'bottom'`,
          },
        ]}
      />
      <Show when={sql`selected_section = write_email_section.write_ui_id`}>
        <ButtonGroup
          orientation="vertical"
          sx={{
            position: "absolute",
            top: 0,
            right: 6,
            bottom: 0,
            justifyContent: "center",
          }}
          variant="soft"
          color="neutral"
          size="sm"
        >
          <IconButton
            aria-label="Delete section"
            icon="Delete"
            onClick={(s) => {
              s.setScalar("selected_section", sql.null);
              useCursorHelper().delete(s);
            }}
          />
          <IconButton
            aria-label="Duplicate section"
            icon="ContentCopy"
            onClick={(s) => {
              useCursorHelper().duplicate(s);
            }}
          />
        </ButtonGroup>
      </Show>
      <div
        sx={{
          backgroundPosition: "top center",
          width: "600px",
          "&.full-width": { width: "100%" },
        }}
        dynamicClass={{
          classes: "full-width",
          condition: sql`write_email_section.full_width`,
        }}
        style={{
          "background-color":
            sql`case when write_email_section.background_type = 'color' then write_email_section.background_color else 'transparent' end`,
        }}
      >
        <div
          sx={{
            display: "flex",
            width: 600,
            mx: "auto",
            my: 0,
          }}
          style={{
            "padding-top": sql`write_email_section.padding_top || 'px'`,
            "padding-bottom": sql`write_email_section.padding_bottom || 'px'`,
            "padding-left": sql`write_email_section.padding_left || 'px'`,
            "padding-right": sql`write_email_section.padding_right || 'px'`,
            "border-width": sql`write_email_section.border_width || 'px'`,
            "border-style": sql`write_email_section.border_style`,
            "border-color": sql`write_email_section.border_color`,
          }}
        >
          <Form.Relation table="email_columns" fields={["width", "order"]}>
            <Form.Each orderBy={sql`order`}>
              <Column />
            </Form.Each>
          </Form.Relation>
        </div>
      </div>
    </div>
  );
}

function ContentDraggables() {
  return (
    <div
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 2,
        py: 1,
      }}
    >
      <ContentDraggable
        contentFields={{
          type: sql.lit`text`,
          padding_top: 0,
          padding_bottom: 0,
          padding_left: 25,
          padding_right: 25,
          text_content:
            sql`lexical_simple_paragraph('Click here to edit this text')`,
        }}
      >
        <svg viewBox="0 0 43 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Text</title>
          <path
            d="M26.4156 30.2998H15.7373V29.017C16.6769 28.9567 17.4538 28.8363 18.0681 28.6556C18.6945 28.4749 19.0076 28.2521 19.0076 27.9871C19.0076 27.8787 18.9956 27.7462 18.9715 27.5896C18.9474 27.433 18.9113 27.2945 18.8631 27.174L16.7311 21.4284H7.75122C7.41395 22.2715 7.1369 23.0063 6.92008 23.6327C6.71531 24.259 6.52861 24.8372 6.35997 25.3672C6.20338 25.8852 6.09497 26.3068 6.03475 26.632C5.97452 26.9572 5.94441 27.2222 5.94441 27.427C5.94441 27.9088 6.32384 28.2822 7.0827 28.5472C7.84156 28.8122 8.69678 28.9688 9.64837 29.017V30.2998H0V29.017C0.31318 28.9929 0.704656 28.9266 1.17443 28.8182C1.6442 28.6978 2.02965 28.5412 2.33079 28.3484C2.8126 28.0232 3.18601 27.686 3.45101 27.3366C3.71601 26.9753 3.97498 26.4814 4.22794 25.8551C5.51679 22.6389 6.93815 19.0253 8.49201 15.0142C10.0459 11.0031 11.4311 7.43161 12.6477 4.2998H14.0931L22.6393 26.4152C22.82 26.8849 23.0248 27.2644 23.2536 27.5535C23.4825 27.8425 23.8017 28.1256 24.2113 28.4027C24.4883 28.5713 24.8497 28.7158 25.2953 28.8363C25.741 28.9447 26.1144 29.0049 26.4156 29.017V30.2998ZM16.0806 19.8203L12.196 9.88285L8.3836 19.8203H16.0806Z"
            fill="currentColor"
          />
          <path
            d="M42 1V1C39.7909 1 38 2.79086 38 5V29C38 31.2091 39.7909 33 42 33V33"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M34 1V1C36.2091 1 38 2.79086 38 5V29C38 31.2091 36.2091 33 34 33V33"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M34 17H42"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <Typography level="title-md">Text</Typography>
      </ContentDraggable>

      <ContentDraggable
        contentFields={{
          type: sql.lit`button`,
          button_border_style: sql.lit`solid`,
          button_border_width: 0,
          button_border_color: sql.lit`#ffffff`,
          padding_top: 10,
          padding_bottom: 10,
          padding_left: 25,
          padding_right: 25,
          button_padding_top: 10,
          button_padding_bottom: 10,
          button_padding_left: 25,
          button_padding_right: 25,
          button_align: sql.lit`center`,
          button_border_radius: 3,
          button_background_color: sql.lit`#414141`,
          button_href: sql.lit`https://www.yolm.ai`,
          button_label: sql.lit`Click here`,
          button_text_align: sql.lit`center`,
          button_font_size: 14,
          button_font_color: sql.lit`#ffffff`,
          button_font_family: sql.lit`Arial`,
        }}
      >
        <svg viewBox="0 0 48 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Button</title>
          <path
            d="M42.1212 21H44C45.6569 21 47 19.6569 47 18V4C47 2.34315 45.6569 1 44 1H4C2.34315 1 1 2.34315 1 4V18C1 19.6569 2.34314 21 4 21H21.9242"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M36.5744 23.1392L27.8043 14.1081C27.4831 13.8454 27 14.0961 27 14.4891V26.8312C27 27.1073 27.2176 27.3315 27.4857 27.3315C27.612 27.3315 27.7331 27.2814 27.8024 27.2093L30.2322 25.0285L32.214 29.7978C32.2476 29.8792 32.3111 29.9433 32.3908 29.9767C32.4297 29.9919 32.4705 30 32.5112 30C32.5546 30 32.598 29.9906 32.6388 29.9726L34.7241 29.0519C34.8886 28.98 34.9651 28.7838 34.8945 28.6144L32.9762 23.9958H36.2286C36.4967 23.9958 36.7143 23.7716 36.7143 23.4954C36.7143 23.4147 36.6942 23.2933 36.5744 23.1392Z"
            fill="currentColor"
          />
          <circle cx="9" cy="11" r="4" fill="currentColor" />
          <rect
            x="16"
            y="10"
            width="25"
            height="2"
            rx="1"
            fill="currentColor"
          />
        </svg>
        <Typography level="title-md">Button</Typography>
      </ContentDraggable>

      <ContentDraggable
        contentFields={{
          type: sql.lit`divider`,
          divider_width: 100,
          divider_border_color: sql.lit`#E6E6E6`,
          divider_border_style: sql.lit`solid`,
          divider_border_width: 2,
          padding_top: 10,
          padding_bottom: 10,
          padding_left: 25,
          padding_right: 25,
        }}
      >
        <svg viewBox="0 0 60 29" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Divider</title>
          <path
            d="M0 14C0 13.4477 0.447715 13 1 13H26V15H1C0.447716 15 0 14.5523 0 14Z"
            fill="currentColor"
          />
          <path
            d="M34 13H59C59.5523 13 60 13.4477 60 14C60 14.5523 59.5523 15 59 15H34V13Z"
            fill="currentColor"
          />
          <path
            d="M30 0L35 6H31V23H35L30 29L25 23H29V6H25L30 0Z"
            fill="currentColor"
          />
        </svg>
        <Typography level="title-md">Divider</Typography>
      </ContentDraggable>

      <ContentDraggable
        contentFields={{
          type: sql.lit`spacer`,
          spacer_height: 20,
        }}
      >
        <svg viewBox="0 0 62 30" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Spacer</title>
          <path
            d="M38 19H58C59.6569 19 61 17.6569 61 16V4C61 2.34315 59.6569 1 58 1H4C2.34315 1 1 2.34315 1 4V16C1 17.6569 2.34315 19 4 19H24"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M31 8L36 14L32 14V24H36L31 30L26 24H30V14L26 14L31 8Z"
            fill="currentColor"
          />
        </svg>
        <Typography level="title-md">Spacer</Typography>
      </ContentDraggable>

      <ContentDraggable
        contentFields={{
          type: sql.lit`image`,
          image_shape: sql.lit`square`,
          image_align: sql.lit`center`,
          image_src: sql
            .lit`data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iMTUwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTVlN2ViIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5Y2EzYWYiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0Ij5JbWFnZTwvdGV4dD48L3N2Zz4=`,
          image_width: 150,
          padding_top: 0,
          padding_bottom: 0,
          padding_left: 0,
          padding_right: 0,
          image_border_radius: 0,
        }}
      >
        <svg viewBox="0 0 42 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>Image</title>
          <rect
            x="1"
            y="1"
            width="40"
            height="32"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M35 28H7C6.44772 28 6 27.5523 6 27V22.6667L9.68453 18.7365C10.4192 17.9528 11.6417 17.8895 12.4535 18.593L16 21.6667L24.5399 13.4115C25.3426 12.6355 26.6253 12.667 27.389 13.4816L36 22.6667V27C36 27.5523 35.5523 28 35 28Z"
            fill="currentColor"
          />
          <circle cx="10" cy="9" r="4" fill="currentColor" />
        </svg>
        <Typography level="title-md">Image</Typography>
      </ContentDraggable>

      <ContentDraggable
        contentFields={{
          type: sql.lit`sql`,
          raw_html: sql.lit`<em>This is <strong>Raw</strong> html</em>`,
        }}
      >
        <svg viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg">
          <title>HTML</title>
          <path
            d="M9.07104 7L3.99998 14.0711L9.07104 21.1421"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M31.1421 21L36.2132 13.9289L31.1421 6.85786"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M15.071 27L26.071 1"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <Typography level="title-md">HTML</Typography>
      </ContentDraggable>
    </div>
  );
}

// function BackgroundColorRadios() {
//   return (
//     <RadioGroup>
//       <Radio label="transparent" checked={sql`${table.field("background_color")} = 'transparent'`} />
//     </RadioGroup>
//   )
// }

function TextToolbar({ children }: { children: Node }) {
  return (
    <div
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        py: 2,
        px: 4,
        display: "flex",
        gap: 3,
        overflowX: "auto",
        backgroundColor: "background-surface",
        borderBottom: "1px solid",
        borderColor: "divider",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        alignItems: "center",
        boxShadow: "sm",
        "&::-webkit-scrollbar": {
          height: "6px",
        },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "neutral-200",
          borderRadius: "sm",
        },
        "&::-webkit-scrollbar-track": {
          backgroundColor: "transparent",
        },
      }}
    >
      {children}
    </div>
  );
}

// Component to wrap form fields with variable insertion capability
function FormFieldWithVariables(props: {
  children: Node;
  fieldName: string;
}) {
  if (usePhase() === "gather") {
    return props.children;
  }

  const fieldHelper = useFieldHelper();

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1">{props.children}</div>
      <VariableInsertMenu
        onClick={(s, key) => {
          const currentValue = fieldHelper.value || sql.lit``;
          s.if(sql`${currentValue} = '' or ${currentValue} is null`, (s) => {
            fieldHelper.setValue(s, sql.lit`{{${key}}}`);
          }).else((s) => {
            fieldHelper.setValue(
              s,
              sql.concat(currentValue, sql.lit` {{${key}}}`),
            );
          });
        }}
      />
    </div>
  );
}

// Component to insert variables into email templates
function VariableInsertMenu(props: {
  onClick?: (s: DomStatements, key: string) => void;
  variableType?: "recipient" | "link";
}) {
  let variables: Record<string, string> = {};

  try {
    const explicitVariables = props.variableType === "link"
      ? useBlockOptional(EmailTemplatesBlock)?.getLinkVariables()
      : useBlockOptional(EmailTemplatesBlock)?.getRecipientVariables();
    variables = explicitVariables ?? {};

    const handleClick = props.onClick || ((s: DomStatements, key: string) => {
      callLexicalModule(
        s,
        "focus",
        sql`editor_handle`,
        sql`json_build_object('handle', editor_handle)`,
      );
      execLexicalCmd(s, "insertText", { text: sql.lit(`{{${key}}}`) });
    });

    return (
      <Menu>
        <Menu.IconButton
          variant="outlined"
          color={"neutral" as Color}
          size="sm"
          aria-controls="email-variables-menu"
          aria-haspopup="true"
          icon="Code"
        />
        <Menu.Content className="max-h-[200px] overflow-auto">
          {Object.entries(variables).map(([key, description]) => (
            <Menu.Item
              onClick={(s) => {
                handleClick(s, key);
              }}
            >
              {sql.concat(
                sql.lit`{{${key}}} - `,
                sql.lit(description || key),
              )}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu>
    );
  } catch (_error) {
    // If variable lookup fails, show a basic set of variables.
    const defaultVariables = {
      email: "Recipient email address",
      name: "Recipient name",
    };

    const handleClick = props.onClick || ((s: DomStatements, key: string) => {
      callLexicalModule(
        s,
        "focus",
        sql`editor_handle`,
        sql`json_build_object('handle', editor_handle)`,
      );
      execLexicalCmd(s, "insertText", { text: sql.lit(`{{${key}}}`) });
    });

    return (
      <Menu>
        <Menu.IconButton
          variant="outlined"
          color={"neutral" as Color}
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
}

function FontSizeInput() {
  return (
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
      value={sql`text_toolbar_state.font_size`}
      type="number"
      startDecorator={
        <IconButton
          aria-label="Decrease font size"
          icon="Remove"
          variant="plain"
          size="sm"
          color="neutral"
          onClick={(s) => {
            execLexicalCmd(s, "formatFontSize", {
              size: sql`cast(text_toolbar_state.font_size - 1 as text)`,
            });
            s.modify(
              sql`update text_toolbar_state set font_size = cast(text_toolbar_state.font_size - 1 as int)`,
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
            execLexicalCmd(s, "formatFontSize", {
              size: sql`cast(text_toolbar_state.font_size + 1 as text)`,
            });
            s.modify(
              sql`update text_toolbar_state set font_size = cast(text_toolbar_state.font_size + 1 as int)`,
            );
          }}
        />
      }
      onInput={(s) => {
        s.if(sql`try_cast(target_value as int) is not null`, (s) => {
          execLexicalCmd(s, "formatFontSize", { size: sql`target_value` });
          s.modify(
            sql`update text_toolbar_state set font_size = cast(target_value as int)`,
          );
        });
      }}
    />
  );
}

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

function LinkPopover() {
  const id = useUniqueId();
  return (
    <Data
      local
      watch={[sql`text_toolbar_state.link_url`]}
      procedure={(s) => {
        s.defScalar("link_popover_open", false);
        s.defScalar("new_link_url", sql`text_toolbar_state.link_url`);
      }}
    >
      <IconButton
        aria-pressed={sql`text_toolbar_state.link_url is not null`}
        aria-label="Link"
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
              <Typography level="body-sm">
                Add Link
              </Typography>
              <Input
                size="sm"
                placeholder="https://yolm.ai"
                value={sql`new_link_url`}
                startIcon="Link"
                onInput={(s) => s.setScalar("new_link_url", sql`target_value`)}
              />
            </div>
            <div className="flex gap-2">
              <VariableInsertMenu
                variableType="link"
                onClick={(s, key) => {
                  const currentUrl = sql`new_link_url`;
                  s.if(
                    sql`${currentUrl} = '' or ${currentUrl} is null`,
                    (s) => {
                      s.setScalar("new_link_url", sql.lit`{{${key}}}`);
                    },
                  ).else((s) => {
                    s.setScalar(
                      "new_link_url",
                      sql.concat(currentUrl, sql.lit`{{${key}}}`),
                    );
                  });
                }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Show when={sql`text_toolbar_state.link_url is not null`}>
                <Button
                  size="sm"
                  color="danger"
                  variant="soft"
                  onClick={(s) => {
                    execLexicalCmd(s, "removeLink");
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
                    execLexicalCmd(s, "insertLink", {
                      url: sql`new_link_url`,
                      title: sql`new_link_url`,
                    });
                  });
                  s.setScalar("link_popover_open", false);
                }}
              >
                {sql`case when text_toolbar_state.link_url is null then 'Insert' else 'Update' end`}
              </Button>
            </div>
          </div>
        </Sheet>
      </Show>
    </Data>
  );
}

function RichTextToolbar() {
  return (
    <TextToolbar>
      {/* Group 1: Text style */}
      <div className="flex gap-2 items-center">
        <Select
          size="sm"
          value={sql`text_toolbar_state.selected_block_type`}
          onInput={(s) => {
            s.if(sql`target_value = 'paragraph'`, (s) => {
              execLexicalCmd(s, "formatNormal");
            });
            s.if(sql`target_value = 'h1'`, (s) => {
              execLexicalCmd(s, "formatH1");
            });
            s.if(sql`target_value = 'h2'`, (s) => {
              execLexicalCmd(s, "formatH2");
            });
            s.if(sql`target_value = 'h3'`, (s) => {
              execLexicalCmd(s, "formatH3");
            });
            s.if(sql`target_value = 'h4'`, (s) => {
              execLexicalCmd(s, "formatH4");
            });
            s.if(sql`target_value = 'h5'`, (s) => {
              execLexicalCmd(s, "formatH5");
            });
            s.if(sql`target_value = 'h6'`, (s) => {
              execLexicalCmd(s, "formatH6");
            });
            s.if(sql`target_value = 'quote'`, (s) => {
              execLexicalCmd(s, "formatQuote");
            });
            s.if(sql`target_value = 'bullet'`, (s) => {
              execLexicalCmd(s, "formatBulletedList");
            });
            s.if(sql`target_value = 'number'`, (s) => {
              execLexicalCmd(s, "formatNumberedList");
            });
          }}
          className="w-[150px]"
        >
          <Select.Option value="paragraph">Paragraph</Select.Option>
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
        {/*Example_Select_Start*/}
        <Select
          size="sm"
          value={sql`text_toolbar_state.font_family`}
          onInput={(s) =>
            execLexicalCmd(s, "formatFontFamily", {
              family: sql`target_value`,
            })}
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
        {/*Example_Select_End*/}
        <FontSizeInput />
      </div>

      {/* Group 2: Text formatting */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-pressed={sql`text_toolbar_state.is_bold`}
          aria-label="Bold"
          icon="FormatBold"
          onClick={(s) => execLexicalCmd(s, "formatBold")}
        />
        <IconButton
          aria-pressed={sql`text_toolbar_state.is_italic`}
          aria-label="Italic"
          icon="FormatItalic"
          onClick={(s) => execLexicalCmd(s, "formatItalic")}
        />
        <IconButton
          aria-pressed={sql`text_toolbar_state.is_underline`}
          aria-label="Underline"
          icon="FormatUnderlined"
          onClick={(s) => execLexicalCmd(s, "formatUnderline")}
        />
        <IconButton
          aria-pressed={sql`text_toolbar_state.is_strikethrough`}
          aria-label="Strikethrough"
          icon="FormatStrikethrough"
          onClick={(s) => execLexicalCmd(s, "formatStrikethrough")}
        />
      </ButtonGroup>

      {/* Group 3: Colors */}
      <div className="flex gap-2 items-center">
        <ColorButton
          icon="FormatColorText"
          value={sql`text_toolbar_state.font_color`}
          onChange={(s) => {
            execLexicalCmd(s, "formatFontColor", { color: sql`target_value` });
          }}
          label="Text color"
        />
        <ColorButton
          icon="FormatColorFill"
          value={sql`text_toolbar_state.background_color`}
          onChange={(s) => {
            execLexicalCmd(s, "formatBackgroundColor", {
              color: sql`target_value`,
            });
          }}
          label="Background color"
        />
      </div>

      {/* Group 4: Alignment */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-pressed={sql`text_toolbar_state.alignment = 'left'`}
          aria-label="Align Left"
          icon="FormatAlignLeft"
          onClick={(s) =>
            execLexicalCmd(s, "formatAlignment", { alignment: sql.lit`left` })}
        />
        <IconButton
          aria-pressed={sql`text_toolbar_state.alignment = 'center'`}
          aria-label="Align Center"
          icon="FormatAlignCenter"
          onClick={(s) =>
            execLexicalCmd(s, "formatAlignment", {
              alignment: sql.lit`center`,
            })}
        />
        <IconButton
          aria-pressed={sql`text_toolbar_state.alignment = 'right'`}
          aria-label="Align Right"
          icon="FormatAlignRight"
          onClick={(s) =>
            execLexicalCmd(s, "formatAlignment", { alignment: sql.lit`right` })}
        />
      </ButtonGroup>

      {/* Group 5: Super/subscript */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-pressed={sql`text_toolbar_state.is_superscript`}
          aria-label="Superscript"
          icon="Superscript"
          onClick={(s) => execLexicalCmd(s, "formatSuperscript")}
        />
        <IconButton
          aria-pressed={sql`text_toolbar_state.is_subscript`}
          aria-label="Subscript"
          icon="Subscript"
          onClick={(s) => execLexicalCmd(s, "formatSubscript")}
        />
      </ButtonGroup>

      {/* Group 6: Indentation */}
      <ButtonGroup variant="outlined" size="sm">
        <IconButton
          aria-label="Outdent"
          icon="FormatIndentDecrease"
          onClick={(s) => execLexicalCmd(s, "outdent")}
        />
        <IconButton
          aria-label="Indent"
          icon="FormatIndentIncrease"
          onClick={(s) => execLexicalCmd(s, "indent")}
        />
      </ButtonGroup>

      {/* Group 7: Link */}
      <LinkPopover />

      {/* Group 8: Variables */}
      <VariableInsertMenu />
    </TextToolbar>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: Node;
}) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <Typography
        level="title-md"
        sx={{
          pb: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        {title}
      </Typography>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function PaddingInput() {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  return (
    <Input
      size="sm"
      value={field.value}
      onInput={(s) => {
        s.if(sql`try_cast(target_value as int) is not null`, (s) => {
          field.setValue(s, sql`target_value`);
        });
      }}
      startDecorator={
        <IconButton
          aria-label="Decrease"
          icon="Remove"
          variant="plain"
          size="sm"
          color="neutral"
          onClick={(s) => {
            field.setValue(s, sql`try_cast(${field.value} as int) - 1`);
          }}
        />
      }
      endDecorator={
        <IconButton
          aria-label="Increase"
          icon="Add"
          color="neutral"
          variant="plain"
          size="sm"
          onClick={(s) => {
            field.setValue(s, sql`try_cast(${field.value} as int) + 1`);
          }}
        />
      }
      type="number"
      sx={{
        maxWidth: "92px",
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
    />
  );
}

function Padding() {
  return (
    <SettingsSection title="Padding">
      <div
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          rowGap: 2,
        }}
      >
        {/*Example_FormControl_Start*/}
        <Form.Field field="padding_top">
          <FormControl>
            <FormLabel>Top</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>
        {/*Example_FormControl_End*/}
        <Form.Field field="padding_bottom">
          <FormControl>
            <FormLabel>Bottom</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>
        <Form.Field field="padding_left">
          <FormControl>
            <FormLabel>Left</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>
        <Form.Field field="padding_right">
          <FormControl>
            <FormLabel>Right</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>
      </div>
    </SettingsSection>
  );
}

function Background() {
  return (
    <SettingsSection title="Background">
      <Form.RadioGroupEnumField field="background_type" nullVariant="None" />
      <Form.Switch operand="background_type">
        <Form.Match when={sql.lit`color`}>
          <Form.Field field="background_color">
            <LabelOnTopFormField label="Color" size="sm" />
          </Form.Field>
        </Form.Match>
        <Form.Match when={sql.lit`image`}>
          <Form.Field field="background_image_url">
            <LabelOnTopFormField label="Image URL" size="sm" />
          </Form.Field>
          <Form.Field field="background_behavior">
            <LabelOnTopFormField label="Behavior" size="sm" />
          </Form.Field>
        </Form.Match>
      </Form.Switch>
    </SettingsSection>
  );
}

function Border() {
  return (
    <SettingsSection title="Border">
      <Form.Field field="border_width">
        <FormControl>
          <FormLabel>Width</FormLabel>
          <PaddingInput />
        </FormControl>
      </Form.Field>
      <Form.Field field="border_style">
        <LabelOnTopFormField label="Style" size="sm" />
      </Form.Field>
      <Form.Field field="border_color">
        <LabelOnTopFormField label="Color" size="sm" />
      </Form.Field>
    </SettingsSection>
  );
}

function Alignment() {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  return (
    <FormControl>
      <FormLabel>Alignment</FormLabel>
      <ButtonGroup variant="outlined">
        <IconButton
          aria-pressed={sql`${field.value} = 'left'`}
          aria-label="Align Left"
          icon="FormatAlignLeft"
          onClick={(s) => {
            field.setValue(s, sql.lit`left`);
          }}
        />
        <IconButton
          aria-pressed={sql`${field.value} = 'center'`}
          aria-label="Align Center"
          icon="FormatAlignCenter"
          onClick={(s) => {
            field.setValue(s, sql.lit`center`);
          }}
        />
        <IconButton
          aria-pressed={sql`${field.value} = 'right'`}
          aria-label="Align Right"
          icon="FormatAlignRight"
          onClick={(s) => {
            field.setValue(s, sql.lit`right`);
          }}
        />
      </ButtonGroup>
    </FormControl>
  );
}

function FontFamilySelect() {
  if (usePhase() === "gather") {
    return null;
  }
  const field = useFieldHelper();
  return (
    <Select
      size="sm"
      value={field.value}
      onChange={(s) => {
        field.setValue(s, sql`target_value`);
      }}
    >
      <Select.Option value="Arial">Arial</Select.Option>
      <Select.Option value="Helvetica">Helvetica</Select.Option>
      <Select.Option value="Times New Roman">Times New Roman</Select.Option>
      <Select.Option value="Georgia">Georgia</Select.Option>
      <Select.Option value="Verdana">Verdana</Select.Option>
      <Select.Option value="Trebuchet MS">Trebuchet MS</Select.Option>
    </Select>
  );
}

function ButtonSettings() {
  return (
    <>
      <SettingsSection title="Button">
        <Form.Field field="button_label">
          <LabelOnTopFormField label="Label" size="sm" />
        </Form.Field>
        <Form.Field field="button_href">
          <LabelOnTopFormField label="Button URL" size="sm" />
        </Form.Field>
        <Form.Field field="button_align">
          <Alignment />
        </Form.Field>
        <Form.Field field="button_full_width">
          <LabelOnTopFormField label="Full Width" size="sm" />
        </Form.Field>
      </SettingsSection>

      <SettingsSection title="Button Style">
        <Form.Field field="button_background_color">
          <LabelOnTopFormField label="Background Color" size="sm" />
        </Form.Field>
        <Form.Field field="button_border_radius">
          <FormControl>
            <FormLabel>Border Radius</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>
      </SettingsSection>

      <SettingsSection title="Text Style">
        <Form.Field field="button_font_family">
          <FormControl>
            <FormLabel>Font Family</FormLabel>
            <FontFamilySelect />
          </FormControl>
        </Form.Field>

        <Form.Field field="button_font_size">
          <FormControl>
            <FormLabel>Font Size</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>

        <Form.Field field="button_font_color">
          <LabelOnTopFormField label="Font Color" size="sm" />
        </Form.Field>

        <Form.Field field="button_text_align">
          <Alignment />
        </Form.Field>
      </SettingsSection>

      <SettingsSection title="Button Padding">
        <div
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 2,
          }}
        >
          <Form.Field field="button_padding_top">
            <FormControl>
              <FormLabel>Top</FormLabel>
              <PaddingInput />
            </FormControl>
          </Form.Field>
          <Form.Field field="button_padding_bottom">
            <FormControl>
              <FormLabel>Bottom</FormLabel>
              <PaddingInput />
            </FormControl>
          </Form.Field>
          <Form.Field field="button_padding_left">
            <FormControl>
              <FormLabel>Left</FormLabel>
              <PaddingInput />
            </FormControl>
          </Form.Field>
          <Form.Field field="button_padding_right">
            <FormControl>
              <FormLabel>Right</FormLabel>
              <PaddingInput />
            </FormControl>
          </Form.Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Border">
        <Form.Field field="button_border_width">
          <FormControl>
            <FormLabel>Width</FormLabel>
            <PaddingInput />
          </FormControl>
        </Form.Field>
        <Form.Field field="button_border_style">
          <LabelOnTopFormField label="Style" size="sm" />
        </Form.Field>
        <Form.Field field="button_border_color">
          <LabelOnTopFormField label="Color" size="sm" />
        </Form.Field>
      </SettingsSection>
    </>
  );
}

function SpacerSettings() {
  return (
    <SettingsSection title="Spacer">
      <Form.Field field="spacer_height">
        <FormControl>
          <FormLabel>Height</FormLabel>
          <PaddingInput />
        </FormControl>
      </Form.Field>
    </SettingsSection>
  );
}

function ImageUploadButton({ uploadBasePath }: { uploadBasePath: string }) {
  const fieldHelper = useFieldHelper();
  return (
    <Button
      component="label"
      variant="outlined"
      color="neutral"
      size="sm"
      startDecorator={<MaterialIcon icon="Upload" fontSize="sm" />}
      sx={{ alignSelf: "flex-start", mt: 1 }}
    >
      Upload Image
      <input
        type="file"
        accept="image/*"
        sx={visuallyHiddenStyles}
        onFileChange={(s) => {
          s.defScalar("uploaded_hash_hex", {
            type: { type: "String", maxLength: 64 },
          });
          s.tryServer({
            transferFiles: sql`select uuid from file`,
            body: (s) => {
              s.forEachTable("file", "file", (s) => {
                s.readDomFile(sql`file.uuid`, "img_bytes");
                s.createBlob(sql`img_bytes`, "img_blob");
                s.startTransaction();
                s.modify(sql`
                  insert into db.email_template_images
                    (blob_hash, content_type)
                  values (img_blob, file.type)
                  on conflict (blob_hash) do nothing
                `);
                s.commitTransaction();
                s.setScalar("uploaded_hash_hex", sql`bytes.to_hex(img_blob)`);
              });
            },
          });
          s.if(sql`uploaded_hash_hex is not null`, (s) => {
            fieldHelper.setValue(
              s,
              sql.concat(sql.lit(uploadBasePath + "/"), sql`uploaded_hash_hex`),
            );
          });
        }}
      />
    </Button>
  );
}

function ImageSettings() {
  const uploadBasePath = useBlockOptional(EmailTemplatesBlock)?.imageBasePath;
  return (
    <>
      <SettingsSection title="Image">
        <Form.Field field="image_src">
          <>
            <LabelOnTopFormField label="Image URL" size="sm" />
            {uploadBasePath && (
              <ImageUploadButton uploadBasePath={uploadBasePath} />
            )}
          </>
        </Form.Field>
        <Form.Field field="image_alt">
          <LabelOnTopFormField label="Alt Text" size="sm" />
        </Form.Field>
        <Form.Field field="image_href">
          <LabelOnTopFormField label="Link URL" size="sm" />
        </Form.Field>
      </SettingsSection>

      <SettingsSection title="Display">
        <Form.Field field="image_align">
          <LabelOnTopFormField label="Alignment" size="sm" />
        </Form.Field>
        <Form.Field field="image_width">
          <LabelOnTopFormField label="Width" size="sm" />
        </Form.Field>
        <Form.Field field="image_shape">
          <LabelOnTopFormField label="Shape" size="sm" />
        </Form.Field>
        <Show
          when={sql`(select image_shape from write_email_blocks where write_ui_id = selected_content) = 'rounded'`}
        >
          <Form.Field field="image_border_radius">
            <FormControl>
              <FormLabel>Border Radius</FormLabel>
              <PaddingInput />
            </FormControl>
          </Form.Field>
        </Show>
        <Form.Field field="image_full_width_mobile">
          <LabelOnTopFormField label="Full Width on Mobile" size="sm" />
        </Form.Field>
      </SettingsSection>
    </>
  );
}

function RawSettings() {
  return (
    <SettingsSection title="HTML">
      <Form.Field field="raw_html">
        <LabelOnTopFormField label="Raw HTML" size="sm" />
      </Form.Field>
    </SettingsSection>
  );
}

interface AdvancedEmailEditorProps {
  recordId: NumericExpr;
}

export function AdvancedEmailEditorLexical(props: AdvancedEmailEditorProps) {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  // Auto-register the lexical_editor JS module when this component is used
  useJsModule("lexical_editor");

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("selected_tab", {
          type: { type: "String", maxLength: 32 },
          expr: sql.lit`add`,
          allowNoRead: true,
        });
        s.defScalar("dragging_content", false);
        s.defScalar("dragging_section", false);
        s.defScalar("drop_target_content", {
          type: "BigUint",
        });
        s.defScalar("drop_target_section", {
          type: "BigUint",
        });
        s.defScalar("drop_target_location", {
          type: { type: "Enum", enum: "drop_target_location" },
        });
        s.defScalar("dragging_over_column", {
          type: "BigUint",
        });
        s.defScalar("selected_content", {
          type: "BigUint",
        });
        s.defScalar("selected_section", {
          type: "BigUint",
        });
        // Editor handle for the currently active text editor (shared across components)
        s.defScalar("editor_handle", sql.lit``);
        s.defRecord("text_toolbar_state", {
          fields: [
            { name: "can_undo", type: "Bool" },
            { name: "can_redo", type: "Bool" },
            { name: "is_bold", type: "Bool" },
            { name: "is_italic", type: "Bool" },
            { name: "is_underline", type: "Bool" },
            { name: "is_strikethrough", type: "Bool" },
            { name: "is_superscript", type: "Bool" },
            { name: "is_subscript", type: "Bool" },
            { name: "alignment", type: "String" },
            { name: "font_size", type: "Int" },
            { name: "font_color", type: "String" },
            { name: "background_color", type: "String" },
            { name: "font_family", type: "String" },
            { name: "link_url", type: "String" },
            { name: "selected_block_type", type: "String" },
          ],
        });
        s.modify(
          sql`insert into text_toolbar_state (can_undo, can_redo, is_bold, is_italic, is_underline, is_strikethrough, is_superscript, is_subscript, alignment, font_size, font_color, font_family, link_url, selected_block_type) values (false, false, false, false, false, false, false, false, 'left', 12, '#000000', 'Arial', null, 'paragraph')`,
        );
        s.defScalar("showing_mobile_preview", false);
        s.defScalar("showing_desktop_preview", false);
        s.defScalar("editor_record_id", {
          type: "BigUint",
          expr: props.recordId,
        });
        s.defScalar("creating_new_template", sql`${props.recordId} is null`);
        s.defScalar("saved", false);
      }}
    >
      <Form
        defaultFieldComponent={LabelOnLeftFormField}
        keepHistory
        beforeTransactionCommit={(s) => {
          s.setScalar(
            "editor_record_id",
            sql`coalesce(editor_record_id, last_record_id(db.email_templates))`,
          );
          s.setScalar("saved", true);
        }}
        afterTransactionCommit={(s, ctx) => {
          s.if(sql`creating_new_template`, (s) => {
            ctx.reset(s);
          });
        }}
      >
        <Form.Merge
          table="email_templates"
          where={sql`id = editor_record_id`}
          values={{
            type: sql.lit`advanced`,
          }}
        >
          <div className="flex flex-col h-[calc(100vh - var(--page-header-height, 0px))]">
            <Sheet
              sx={{
                display: "flex",
                px: 2,
                py: 1.5,
                flexShrink: 0,
                borderBottom: "1px solid",
                borderColor: "primary-100",
                gap: 3,
                alignItems: "center",
                boxShadow: "sm",
              }}
            >
              <div className="flex items-center gap-4">
                {hasSidebar?.autoTrigger && <Sidebar.Trigger />}
                <ButtonGroup variant="outlined" size="sm">
                  <IconButton
                    icon="Undo"
                    aria-label="Undo"
                    onClick={(s) => {
                      useICtx(FormICtxKey).undo(s);
                    }}
                    disabled={sql.not(sql`write_can_undo`)}
                  />
                  <IconButton
                    icon="Redo"
                    aria-label="Redo"
                    onClick={(s) => {
                      useICtx(FormICtxKey).redo(s);
                    }}
                    disabled={sql.not(sql`undo_from_history_index is not null`)}
                  />
                </ButtonGroup>
              </div>

              <div className="flex items-center gap-4">
                <Typography level="body-sm">Preview:</Typography>
                <ButtonGroup variant="outlined" size="sm">
                  <IconButton
                    aria-pressed={sql`showing_desktop_preview`}
                    aria-label="Desktop preview"
                    icon="DesktopMac"
                    onClick={(s) => {
                      s.toggle("showing_desktop_preview");
                      s.setScalar("showing_mobile_preview", false);
                    }}
                  />
                  <IconButton
                    aria-pressed={sql`showing_mobile_preview`}
                    aria-label="Mobile preview"
                    icon="Smartphone"
                    onClick={(s) => {
                      s.toggle("showing_mobile_preview");
                      s.setScalar("showing_desktop_preview", false);
                    }}
                  />
                </ButtonGroup>
              </div>

              <div sx={flexGrowStyles} />

              <div className="flex gap-2">
                <Form.SubmitButton size="sm" startIcon="Save">
                  Save Changes
                </Form.SubmitButton>
              </div>
            </Sheet>

            <Show when={sql`showing_desktop_preview or showing_mobile_preview`}>
              <div sx={{ flex: 1, overflow: "auto" }}>
                <Data
                  procedure={(s) => {
                    createMjml(s);
                    s.renderMjml({
                      mjml: sql`preview_mjml`,
                      defOutputScalar: "html",
                    });
                  }}
                >
                  <Conditional
                    when={sql`showing_desktop_preview`}
                    then={
                      <iframe
                        sx={{
                          width: "100%",
                          height: "70vh",
                          border: "none",
                          gridColumnSpan: 12,
                        }}
                        title="Email preview"
                        srcDoc={sql`html`}
                      />
                    }
                    else={
                      <div
                        sx={{
                          mx: "auto",
                          my: 0,
                          backgroundColor: "white",
                          px: 2,
                          py: 1,
                          mt: 4,
                          borderRadius: "lg",
                          width: 375,
                          height: 667,
                          gridColumnSpan: 12,
                        }}
                      >
                        <iframe
                          sx={{
                            width: "100%",
                            height: "100%",
                            border: "3px solid",
                            color: "neutral-300",
                          }}
                          title="Email preview"
                          srcDoc={sql`html`}
                        />
                      </div>
                    }
                  />
                </Data>
              </div>
            </Show>

            <div
              sx={{
                display: "flex",
                flex: 1,
                overflow: "hidden",
                "&.hidden": { display: "none" },
              }}
              dynamicClass={{
                classes: "hidden",
                condition:
                  sql`showing_desktop_preview or showing_mobile_preview`,
              }}
            >
              <Tabs
                selectedTabScalar="selected_tab"
                defaultValue="add"
                sx={{
                  width: "324px",
                  borderRight: "1px solid",
                  borderColor: "divider",
                  flexShrink: 0,
                }}
              >
                <Tabs.List tabFlex={1}>
                  <Tabs.Tab
                    value="add"
                    selectedVariant="soft"
                    className="pt-3"
                  >
                    Add
                  </Tabs.Tab>
                  <Tabs.Tab
                    value="edit"
                    selectedVariant="soft"
                    className="pt-3"
                  >
                    Edit
                  </Tabs.Tab>
                  <Tabs.Tab
                    value="settings"
                    selectedVariant="soft"
                    className="pt-3"
                  >
                    Settings
                  </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="add" className="overflow-y-auto p-4">
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-4">
                      <Typography
                        level="title-lg"
                        sx={{
                          pb: 1,
                          borderBottom: "1px solid",
                          borderColor: "divider",
                        }}
                      >
                        Sections
                      </Typography>

                      <div className="flex flex-col gap-2">
                        <Typography level="title-md">1 Column</Typography>
                        <SectionDraggable columnWidths={[100]} />
                      </div>

                      <div className="flex flex-col gap-2">
                        <Typography
                          level="title-md"
                          className="text-neutral-600"
                        >
                          2 Columns
                        </Typography>
                        <div
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 1,
                          }}
                        >
                          <SectionDraggable columnWidths={[50, 50]} />
                          <SectionDraggable columnWidths={[25, 75]} />
                          <SectionDraggable columnWidths={[33, 66]} />
                          <SectionDraggable columnWidths={[66, 33]} />
                          <SectionDraggable columnWidths={[75, 25]} />
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Typography level="title-md">3 Columns</Typography>
                        <div
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 1,
                          }}
                        >
                          <SectionDraggable columnWidths={[33, 33, 33]} />
                          <SectionDraggable columnWidths={[25, 25, 50]} />
                          <SectionDraggable columnWidths={[25, 50, 25]} />
                          <SectionDraggable columnWidths={[50, 25, 25]} />
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Typography level="title-md">4 Columns</Typography>
                        <SectionDraggable columnWidths={[25, 25, 25, 25]} />
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      <Typography
                        level="title-lg"
                        sx={{
                          pb: 1,
                          borderBottom: "1px solid",
                          borderColor: "divider",
                        }}
                      >
                        Content Blocks
                      </Typography>
                      <ContentDraggables />
                    </div>
                  </div>
                </Tabs.Panel>
                <Tabs.Panel
                  value="edit"
                  className="overflow-y-auto bg-surface"
                >
                  <Show when={sql`selected_section is not null`}>
                    <Form.IndirectView
                      table="email_sections"
                      recordId={sql`selected_section`}
                    >
                      <SettingsSection title="Layout">
                        {/*Example_LabelOnLeftFormField_Start*/}
                        <Form.Field field="full_width">
                          <LabelOnLeftFormField label="Full Width" />
                        </Form.Field>
                        {/*Example_LabelOnLeftFormField_End*/}
                        <Form.Field field="vertical_align">
                          <LabelOnLeftFormField label="Vertical Align" />
                        </Form.Field>
                        <Form.Field field="mobile_display">
                          <LabelOnLeftFormField label="Mobile Display" />
                        </Form.Field>
                      </SettingsSection>
                      <Padding />
                      <Background />
                      <Border />
                    </Form.IndirectView>
                  </Show>
                  <Show when={sql`selected_content is not null`}>
                    <Form.IndirectView
                      table="email_blocks"
                      recordId={sql`selected_content`}
                    >
                      <Form.Switch operand="type">
                        <Form.Match when={sql.lit`text`}>
                          <Padding />
                          <Form.Field field="background_color">
                            <LabelOnTopFormField
                              label="Background Color"
                              size="sm"
                            />
                          </Form.Field>
                        </Form.Match>
                        <Form.Match when={sql.lit`button`}>
                          <ButtonSettings />
                        </Form.Match>
                        <Form.Match when={sql.lit`spacer`}>
                          <SpacerSettings />
                        </Form.Match>
                        <Form.Match when={sql.lit`image`}>
                          <ImageSettings />
                        </Form.Match>
                        <Form.Match when={sql.lit`sql`}>
                          <RawSettings />
                        </Form.Match>
                        <Form.Match when={sql.lit`divider`}>
                          <SettingsSection title="Divider">
                            <Form.Field field="divider_width">
                              <LabelOnTopFormField label="Width" size="sm" />
                            </Form.Field>
                            <Form.Field field="divider_border_width">
                              <FormControl>
                                <FormLabel>Line Width</FormLabel>
                                <PaddingInput />
                              </FormControl>
                            </Form.Field>
                            <Form.Field field="divider_border_style">
                              <LabelOnTopFormField label="Style" size="sm" />
                            </Form.Field>
                            <Form.Field field="divider_border_color">
                              <LabelOnTopFormField label="Color" size="sm" />
                            </Form.Field>
                          </SettingsSection>
                        </Form.Match>
                      </Form.Switch>
                    </Form.IndirectView>
                  </Show>
                  <Show
                    when={sql`selected_section is null and selected_content is null`}
                  >
                    <div>Select a section or content block to get started!</div>
                  </Show>
                </Tabs.Panel>

                <Tabs.Panel value="settings" className="p-4">
                  <SettingsSection title="Email Settings">
                    <Form.Field field="name">
                      <LabelOnTopFormField label="Template Name" size="sm" />
                    </Form.Field>
                    <Form.Field field="subject">
                      <FormFieldWithVariables fieldName="subject">
                        <LabelOnTopFormField label="Subject Line" size="sm" />
                      </FormFieldWithVariables>
                    </Form.Field>
                    <Form.Field field="preview_text">
                      <LabelOnTopFormField label="Preview Text" size="sm" />
                    </Form.Field>
                    <Form.Field field="background_color">
                      <LabelOnTopFormField
                        label="Email Background Color"
                        size="sm"
                      />
                    </Form.Field>
                  </SettingsSection>
                </Tabs.Panel>
              </Tabs>

              <div
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <Show
                  when={sql`(select type from write_email_blocks where write_ui_id = selected_content) = 'text'`}
                >
                  <RichTextToolbar />
                </Show>

                <div
                  sx={{
                    flex: 1,
                    overflow: "auto",
                    p: 4,
                    py: 8,
                    position: "relative",
                  }}
                  style={{
                    "background-color":
                      sql`write_email_template.background_color`,
                  }}
                >
                  <Form.Relation table="email_sections" fields={["order"]}>
                    <Form.Each
                      orderBy={sql`order`}
                      fallback={
                        <div>Drag and drop a section to get started!</div>
                      }
                    >
                      <Section />
                    </Form.Each>
                  </Form.Relation>
                </div>
              </div>
            </div>
          </div>
          <Show when={sql`saved`}>
            <Snackbar
              startIcon="CheckCircle"
              color="success"
              variant="soft"
              anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
              onMount={(s) => {
                s.sleep(3500);
                s.setScalar("saved", false);
              }}
            >
              Template Saved!
            </Snackbar>
          </Show>
        </Form.Merge>
      </Form>
    </Data>
  );
}
