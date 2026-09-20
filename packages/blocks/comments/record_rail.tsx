import { Tabs } from "components/tabs";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { useCommentLinkTarget } from "./link_target";

/** Shared record-side discussion surface. Its selected tab survives navigation. */
export function CommentRecordRail(props: {
  details: Node;
  comments: Node;
  detailsTitle?: string;
}) {
  const panelId = useUniqueId();
  const targetCommentId = useCommentLinkTarget();
  return (
    <Data
      local
      noRefetch
      queryParams={{
        discussion: {
          type: { type: "String", maxLength: 20 },
          default: sql.lit``,
        },
      }}
      procedure={(s) => s.defScalar("discussion_viewport_width", 0)}
    >
      <Tabs
        selectedTabScalar="selected_discussion_tab"
        value={sql`case when discussion = 'comments' or (discussion = '' and ${targetCommentId} is not null) then 'comments' else 'details' end`}
        size="sm"
        className="flex min-h-[480px] flex-col xl:h-full xl:min-h-0"
      >
        <div className="border-b border-divider px-4">
          <Tabs.List className="grid h-11 grid-cols-2">
            <Tabs.Tab
              value="details"
              className="h-11 text-sm"
              onClick={(s) =>
                s.setQueryParam("discussion", sql.lit`details`, sql`true`)}
            >
              {props.detailsTitle ?? "Details"}
            </Tabs.Tab>
            <Tabs.Tab
              value="comments"
              className="h-11 text-sm"
              onClick={(s) =>
                s.setQueryParam("discussion", sql.lit`comments`, sql`true`)}
            >
              Comments
            </Tabs.Tab>
          </Tabs.List>
        </div>
        <Tabs.Panel value="details" className="min-h-0 flex-1 overflow-y-auto">
          {props.details}
        </Tabs.Panel>
        <Tabs.Panel
          value="comments"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <div
            id={panelId}
            onMount={(s) => {
              s.window.getInnerWidth("discussion_viewport_width");
              s.if(
                sql`discussion_viewport_width < 1280 and ${targetCommentId} is null`,
                (s) => {
                  s.element(panelId).scrollIntoView({ block: sql.lit`start` });
                },
              );
            }}
          >
            {props.comments}
          </div>
        </Tabs.Panel>
      </Tabs>
    </Data>
  );
}
