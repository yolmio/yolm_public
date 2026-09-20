import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { Data } from "std/data";
import { Show, useUniqueId } from "std/ui";

/** Table insert popover with rows/cols inputs */
export function TableInsertButton() {
  const id = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("table_popover_open", false);
        s.defScalar("table_rows", sql.lit`3`);
        s.defScalar("table_cols", sql.lit`3`);
      }}
    >
      <IconButton
        aria-label="Insert Table"
        tooltip="Insert Table"
        icon="GridOn"
        variant="outlined"
        color="neutral"
        size="sm"
        onClick={(s) => s.toggle("table_popover_open")}
        id={id}
      />
      <Show when={sql`table_popover_open`}>
        <Sheet
          variant="outlined"
          popover="auto"
          yolmPopoverShowing={sql`table_popover_open`}
          floating={{
            anchorEl: id,
            placement: "bottom-start",
            strategy: "absolute",
          }}
          sx={{
            mt: 1,
            p: 2,
            minWidth: "200px",
            zIndex: 1100,
            boxShadow: "md",
            borderRadius: "md",
            backgroundColor: "background-surface",
          }}
          onToggleHide={(s) => s.setScalar("table_popover_open", false)}
        >
          <div className="flex flex-col gap-3">
            <Typography level="body-sm">Insert Table</Typography>
            <div className="flex gap-2 items-center">
              <Typography level="body-xs" sx={{ minWidth: "36px" }}>
                Rows:
              </Typography>
              <Input
                size="sm"
                type="number"
                value={sql`table_rows`}
                onInput={(s) => s.setScalar("table_rows", sql`target_value`)}
                sx={{ width: "60px" }}
              />
            </div>
            <div className="flex gap-2 items-center">
              <Typography level="body-xs" sx={{ minWidth: "36px" }}>
                Cols:
              </Typography>
              <Input
                size="sm"
                type="number"
                value={sql`table_cols`}
                onInput={(s) => s.setScalar("table_cols", sql`target_value`)}
                sx={{ width: "60px" }}
              />
            </div>
            <Button
              size="sm"
              variant="solid"
              color="primary"
              onClick={(s) => {
                s.jsCall({
                  module: "lexical_editor",
                  exportName: "executeCommand",
                  handle: sql`ui.editor_handle`,
                  argJson:
                    sql`json_build_object('handle', ui.editor_handle, 'command', 'insertTable', 'rows', table_rows, 'cols', table_cols)`,
                });
                s.setScalar("table_popover_open", false);
              }}
            >
              Insert
            </Button>
          </div>
        </Sheet>
      </Show>
    </Data>
  );
}
