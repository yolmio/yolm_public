import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import type { Node } from "std/ui";
import { createStyles, cssVar } from "std/style_utils";
import { agentModels } from "std/agent_models";
import { Menu } from "components/menu";
import { Select } from "components/select";

const styles = createStyles({
  aiMenuButton: {
    height: 32,
    minWidth: 72,
    maxWidth: 116,
    px: 1,
    color: cssVar("palette-text-tertiary"),
    fontSize: "0.875rem",
    fontWeight: 400,
    backgroundColor: "transparent",
    "&:hover": { backgroundColor: "transparent" },
    "&[aria-expanded='true']": { backgroundColor: "transparent" },
  },
  aiMenuContent: {
    width: 224,
    maxWidth: "calc(100vw - 24px)",
    p: 0,
    border: "1px solid #e5e5e5",
    outline: "none",
    borderRadius: 20,
    boxShadow: "0 10px 32px rgba(0, 0, 0, 0.12)",
  },
  aiReasoningRange: {
    width: "100%",
    height: 28,
    appearance: "none",
    WebkitAppearance: "none",
    background: "transparent",
    cursor: "pointer",
    "&::-webkit-slider-runnable-track": {
      height: 24,
      borderRadius: 999,
      background:
        "radial-gradient(circle at 10% 50%, rgba(255,255,255,.35) 0 2px, transparent 2.5px), radial-gradient(circle at 30% 50%, rgba(255,255,255,.35) 0 2px, transparent 2.5px), radial-gradient(circle at 50% 50%, rgba(255,255,255,.35) 0 2px, transparent 2.5px), radial-gradient(circle at 70% 50%, rgba(255,255,255,.35) 0 2px, transparent 2.5px), radial-gradient(circle at 90% 50%, rgba(120,120,120,.3) 0 2px, transparent 2.5px), linear-gradient(to right, var(--spark-range-color) 0 var(--spark-range-progress), #e5e5e5 var(--spark-range-progress) 100%)",
    },
    "&::-webkit-slider-thumb": {
      appearance: "none",
      WebkitAppearance: "none",
      width: 28,
      height: 28,
      mt: "-2px",
      borderRadius: "50%",
      border: "1px solid",
      borderColor: cssVar("palette-neutral-300"),
      backgroundColor: "#ffffff",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
    },
    "&::-moz-range-track": {
      height: 24,
      borderRadius: 999,
      backgroundColor: "#e5e5e5",
    },
    "&::-moz-range-progress": {
      height: 24,
      borderRadius: 999,
      backgroundColor: "var(--spark-range-color)",
    },
    "&::-moz-range-thumb": {
      width: 28,
      height: 28,
      borderRadius: "50%",
      border: "1px solid",
      borderColor: cssVar("palette-neutral-300"),
      backgroundColor: "#ffffff",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
    },
  },
});

/** Shared compact effort and model picker for Spark and Forge. */
export function AgentControls(props: {
  header?: boolean;
  children?: Node;
  effort: Sql;
  model: Sql;
  onEffortChange: (s: DomStatements, effort: Sql) => void;
  onModelChange: (s: DomStatements, model: Sql) => void;
}) {
  const minimum =
    sql`case when ${props.model} = 'gpt-6-astra' then 1 else 0 end`;
  const level = sql`case ${props.effort}
    when 'none' then 0 when 'low' then 1 when 'medium' then 2
    when 'high' then 3 when 'xhigh' then 4 else 5 end`;
  const label = sql`case ${props.effort}
    when 'low' then 'Low' when 'medium' then 'Medium'
    when 'high' then 'High' when 'xhigh' then 'Extra High'
    when 'max' then 'Maximum' else 'Instant' end`;
  const modelLabel = sql`case ${props.model}
    when 'gpt-5.6-terra' then 'Terra' when 'gpt-5.6-sol' then 'Sol'
    when 'gpt-6-astra' then 'Astra' else 'Luna' end`;
  return (
    <Menu>
      <Menu.Button
        variant="plain"
        color="neutral"
        size="sm"
        endIcon="ArrowDropDown"
        sx={[styles.aiMenuButton, props.header && { maxWidth: 200 }]}
      >
        <span className="truncate">
          {props.header
            ? sql`'AI: ' || ${modelLabel} || ' · ' || ${label}`
            : label}
        </span>
      </Menu.Button>
      <Menu.Content
        size="sm"
        floating={{ placement: props.header ? "bottom-end" : "top-end" }}
        sx={[styles.aiMenuContent, !!props.children && { width: 300 }]}
      >
        <div className="p-4 space-y-2">
          {props.header && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-secondary">Reasoning</span>
              <span>{label}</span>
            </div>
          )}
          <input
            type="range"
            min={minimum}
            max="5"
            step="1"
            aria-label="Reasoning effort"
            aria-valuetext={label}
            value={level}
            sx={styles.aiReasoningRange}
            style={{
              "--spark-range-progress":
                sql`(((${level} - ${minimum}) * 100) / (5 - ${minimum}))::string || '%'`,
              "--spark-range-color":
                sql`case when ${props.effort} = 'max' then '#7c3aed' else '#0d8cff' end`,
            }}
            onInput={(s) =>
              props.onEffortChange(
                s,
                sql`case try_cast(target_value as int)
              when 0 then 'none' when 1 then 'low' when 2 then 'medium'
              when 3 then 'high' when 4 then 'xhigh' else 'max' end`,
              )}
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-sm text-secondary">
              {props.header ? "Model" : "Advanced"}
            </span>
            <Select
              size="sm"
              value={props.model}
              aria-label="Model"
              onInput={(s) => props.onModelChange(s, sql`target_value`)}
              variant="plain"
              sx={{ width: 112 }}
            >
              {agentModels.map((model) => (
                <Select.Option value={model.id}>{model.label}</Select.Option>
              ))}
            </Select>
          </div>
        </div>
        {props.children && (
          <div className="border-t border-divider">{props.children}</div>
        )}
      </Menu.Content>
    </Menu>
  );
}
