import { sql } from "std/sql_utils";
import { Data } from "std/data";
import { Effect } from "std/ui";
import { useJsModule } from "std/js_modules";
import { Ribbon } from "./ribbon";
import { EditorCanvas } from "./editor_canvas";
import { StatusBar } from "./status_bar";
import { Input } from "components/input";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";

export type WordEditorProps = {
  containerId?: string;
  imageInputId?: string;
  titleBar?: JSX.Element;
  pictureControl?: JSX.Element;
};

function DefaultTitleBar() {
  return (
    <Sheet
      variant="soft"
      color="primary"
      sx={{
        display: "flex",
        alignItems: "center",
        px: 3,
        py: 1,
        gap: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
        flexShrink: 0,
      }}
    >
      <Typography
        level="title-sm"
        sx={{ fontWeight: 700, color: "primary-solid" }}
      >
        {sql.lit`W`}
      </Typography>
      <Input
        size="sm"
        variant="plain"
        value={sql`doc_title`}
        onInput={(s) => s.setScalar("doc_title", sql`target_value`)}
        sx={{
          flex: 1,
          maxWidth: "300px",
          "& input": {
            fontWeight: 600,
            fontSize: "14px",
          },
        }}
      />
      <div sx={{ flex: 1 }} />
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        {sql`save_status`}
      </Typography>
    </Sheet>
  );
}

/** Main Word-like editor orchestrator */
export function WordEditor(props: WordEditorProps = {}) {
  useJsModule("lexical_editor");
  const containerId = props.containerId ?? "word-editor-container";

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        // Editor state
        s.defScalar("editor_handle", {
          type: "Uuid",
          expr: sql`random.uuid()`,
        });
        // Formatting state
        s.defScalar("is_bold", false);
        s.defScalar("is_italic", false);
        s.defScalar("is_underline", false);
        s.defScalar("is_strikethrough", false);
        s.defScalar("is_subscript", false);
        s.defScalar("is_superscript", false);
        // Style state
        s.defScalar("font_size", { type: "String" });
        s.defScalar("font_color", { type: "String" });
        s.defScalar("background_color", { type: "String" });
        s.defScalar("font_family", { type: "String" });
        s.defScalar("alignment", sql.lit`left`);
        // Link state
        s.defScalar("link_url", { type: "String" });
        // Block state
        s.defScalar("selected_block_type", sql.lit`normal`);
        // History state
        s.defScalar("can_undo", false);
        s.defScalar("can_redo", false);
        // Content tracking
        s.defScalar("word_count", sql`0`);
        s.defScalar("char_count", sql`0`);
        // Ribbon tab state
        s.defScalar("ribbon_tab", sql`0`);
        // Document title
        s.defScalar("doc_title", sql.lit`Untitled Document`);
        // Save state
        s.defScalar("save_status", sql.lit``);
        // Content for saving
        s.defScalar("saved_content", { type: "Json" });
        // onChange task handle
        s.defScalar("on_change_task", { type: "BigUint" });
        // Font families table for dynamic Select2 test
        s.defTable(
          "fonts",
          sql`select * from (values ('Arial'), ('Calibri'), ('Courier New'), ('Georgia'), ('Helvetica'), ('Times New Roman'), ('Verdana')) as t(name)`,
        );
      }}
    >
      <div
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          width: "100%",
          backgroundColor: "background-body",
          overflow: "hidden",
        }}
      >
        {props.titleBar ?? <DefaultTitleBar />}
        <Ribbon pictureControl={props.pictureControl} />
        <EditorCanvas containerId={containerId} />
        <StatusBar />
      </div>

      {/* Initialize editor on mount */}
      <Effect
        watch={[sql`editor_handle`]}
        triggerOnMount
        onChange={(s) => {
          s.sleep(1000);
          s.jsCall({
            module: "lexical_editor",
            exportName: "init",
            handle: sql`ui.editor_handle`,
            argJson:
              sql`json_build_object('handle', ui.editor_handle, 'containerId', ${
                sql.lit(containerId)
              }, 'externalImageInputId', ${
                props.imageInputId ? sql.lit(props.imageInputId) : sql.null
              })`,
          });
        }}
      />
    </Data>
  );
}
