import { sql } from "std/sql_utils";
import { editorContentStyles } from "./editor_styles";

/** Continuous document canvas: gray background with centered white editor surface. */
export function EditorCanvas({ containerId }: { containerId: string }) {
  return (
    <div
      data-training-word-surface="true"
      sx={{
        flex: 1,
        overflow: "hidden",
        backgroundColor: "#e8e8e8",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        py: 4,
        px: 2,
      }}
    >
      <div
        sx={{
          width: "816px",
          maxWidth: "100%",
          height: "calc(100vh - 260px)",
          minHeight: "420px",
          backgroundColor: "#fff",
          overflow: "auto",
          filter:
            "drop-shadow(0 2px 8px rgba(0,0,0,0.15)) drop-shadow(0 0 1px rgba(0,0,0,0.12))",
          flexShrink: 0,
        }}
      >
        <div
          contentEditable
          id={containerId}
          sx={{
            ...editorContentStyles,
            padding: "96px",
            minHeight: "100%",
            boxSizing: "border-box",
            "& a": { pointerEvents: "none" },
          }}
          js={{
            handles: [{
              module: "lexical_editor",
              handle: sql`ui.editor_handle`,
              cleanup: "cleanup",
            }],
            on: {
              "lexical_editor.stateChanged": (s) => {
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
                  "link_url",
                  sql`event.payload_json->>'link_url'`,
                );
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
                s.setScalar(
                  "word_count",
                  sql`coalesce((event.payload_json->>'word_count')::int, 0)`,
                );
                s.setScalar(
                  "char_count",
                  sql`coalesce((event.payload_json->>'char_count')::int, 0)`,
                );
                s.defScalar(
                  "content_value",
                  sql`event.payload_json->'editorState'`,
                );
                s.if(sql`on_change_task is not null`, (s) => {
                  s.cancelTask(sql`on_change_task`);
                });
                s.startTaskWithOpts({
                  detached: true,
                  procedure: (s) => {
                    s.sleep(100);
                    s.setScalar("saved_content", sql`content_value`);
                    s.setScalar("save_status", sql.lit``);
                  },
                  handleScalar: "task",
                });
                s.setScalar("on_change_task", sql`task`);
              },
            },
          }}
        />
      </div>
    </div>
  );
}
