import { Button } from "components/button";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { Data } from "std/data";
import { Show, useUniqueId } from "std/ui";
import { execCmd } from "./helpers";

/** Link insert/edit popover for the ribbon */
export function LinkPopover() {
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
        tooltip="Insert Link"
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
            placement: "bottom-start",
            strategy: "absolute",
          }}
          sx={{
            mt: 1,
            p: 2,
            minWidth: "300px",
            zIndex: 1100,
            boxShadow: "md",
            borderRadius: "md",
            backgroundColor: "background-surface",
          }}
          onToggleHide={(s) => s.setScalar("link_popover_open", false)}
        >
          <div className="flex flex-col gap-3">
            <Typography level="body-sm">Insert Link</Typography>
            <Input
              size="sm"
              placeholder="https://example.com"
              value={sql`new_link_url`}
              startIcon="Link"
              onInput={(s) => s.setScalar("new_link_url", sql`target_value`)}
            />
            <div className="flex gap-2 justify-end">
              <Show when={sql`link_url is not null`}>
                <Button
                  size="sm"
                  color="danger"
                  variant="soft"
                  onClick={(s) => {
                    execCmd(s, "removeLink");
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
