import { Tabs } from "components/tabs";
import { Sidebar } from "components/sidebar";
import { SidebarPresenceICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import { useOptionalICtx, useQueryParams } from "std/ui";
import type { Node } from "std/ui";
import { RecordPage } from "./record_page";

export interface RecordWithTabsAndDetailContentProps {
  header: Node;
  tabs: {
    value?: string;
    header: Node;
    content: Node;
  }[];
  details: Node;
}

export interface RecordWithTabsAndDetailProps
  extends RecordWithTabsAndDetailContentProps {
  table: string;
  path?: string;
  wrapper?: (children: Node) => Node;
}

export function RecordWithTabsAndDetailContent(
  props: RecordWithTabsAndDetailContentProps,
) {
  const hasSidebar = useOptionalICtx(SidebarPresenceICtxKey);
  const defaultTabValue = props.tabs[0]?.value ?? "tab-0";
  useQueryParams([
    {
      name: "tab",
      type: { type: "String", maxLength: 32 },
      default: sql.lit(defaultTabValue),
      allowNoRead: true,
    },
  ]);
  return (
    <div className="w-full min-h-screen">
      <header className="px-4 py-4 sm:px-6 lg:px-8 flex items-center gap-3 border-b border-divider">
        {hasSidebar && <Sidebar.Trigger size="sm" />}
        {props.header}
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-12 min-h-[calc(100vh-96px)]">
        <div className="xl:col-span-8 flex flex-col min-w-0">
          <Tabs
            selectedTabScalar="selected_tab"
            value={sql`tab`}
            onValueChange={(s, value) => {
              s.setScalar("tab", value);
              s.setQueryParam("tab", sql`${value}`);
            }}
            size="sm"
            className="h-full flex flex-col min-h-0"
          >
            <div
              className="px-4 sm:px-6 lg:px-8 border-b border-divider overflow-x-auto overflow-y-hidden h-10"
              sx={{
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": {
                  display: "none",
                },
              }}
            >
              <Tabs.List className="whitespace-nowrap min-w-max h-10">
                {props.tabs.map((tab, i) => {
                  const tabValue = tab.value ?? "tab-" + i;
                  return (
                    <Tabs.Tab
                      value={tabValue}
                      className="h-10 min-h-10 px-4 text-sm flex-none"
                      selectedVariant="soft"
                      selectedColor="primary"
                    >
                      {tab.header}
                    </Tabs.Tab>
                  );
                })}
              </Tabs.List>
            </div>
            {props.tabs.map((tab, i) => (
              <Tabs.Panel
                value={tab.value ?? "tab-" + i}
                className="p-4 sm:p-5 lg:p-6"
              >
                {tab.content}
              </Tabs.Panel>
            ))}
          </Tabs>
        </div>
        <div className="xl:col-span-4 border-t xl:border-t-0 xl:border-l border-divider min-w-0">
          {props.details}
        </div>
      </div>
    </div>
  );
}

export function RecordWithTabsAndDetailPage(
  props: RecordWithTabsAndDetailProps,
) {
  return (
    <RecordPage
      table={props.table}
      path={props.path}
      wrapper={props.wrapper}
    >
      <RecordWithTabsAndDetailContent {...props} />
    </RecordPage>
  );
}
