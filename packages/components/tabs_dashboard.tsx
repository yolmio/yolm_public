import type { Style } from "std/style_types";
import { baseGridStyles } from "std/style_utils";
import { containerStyles, createStyles } from "std/style_utils";
import type { Node } from "std/ui";
import { Tabs } from "./tabs";
import type { Color, Variant } from "./types";
import { getUniqueUiId } from "./utils";

export interface DashboardTabConfig {
  label: Node;
  value: string | number;
  content: Node;
  color?: Color;
}

interface TabsDashboardProps {
  tabs: DashboardTabConfig[];
  selectedTabScalar: string;
  sx?: Style;
  variant?: Variant;
  color?: Color;
  orientation?: "horizontal" | "vertical";
  idBase?: string;
}

const styles = createStyles({
  tabs: () => ({
    ...containerStyles(),
  }),
  root: () => ({
    ...baseGridStyles,
    py: 4,
    gap: 4,
    md: { gap: 8 },
  }),
});

export function TabsDashboard({
  tabs,
  selectedTabScalar,
  sx,
  variant = "plain",
  orientation = "horizontal",
  idBase = getUniqueUiId(),
  color = "primary",
}: TabsDashboardProps) {
  return (
    <Tabs
      selectedTabScalar={selectedTabScalar}
      sx={[styles.tabs(), sx]}
      idBase={idBase}
      orientation={orientation}
    >
      <Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Tab
            value={tab.value}
            selectedColor={tab.color || color}
            variant={variant}
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Panel value={tab.value}>
          <div sx={styles.root()}>{tab.content}</div>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
