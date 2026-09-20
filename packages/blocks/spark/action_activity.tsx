import {
  SparkActionResult,
  type SparkActionResultRenderer,
} from "./action_result";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { cssVar } from "std/style_utils";
import { Button } from "components/button";
import { Drawer } from "components/drawer";
import { Tabs } from "components/tabs";
import { IconButton } from "components/icon_button";
import { ActionButton } from "std/action_button";
import {
  reversibleSparkAction,
  sparkBulkUndo,
  type SparkUndoOptions,
} from "./bulk_undo";
import { SparkArtifactsPanel } from "./artifacts_panel";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { visibleConversationId } from "./helpers";

/** Labels derive from registered operations/results, never the assistant's prose. */
export function actionActivityTitle(name: Sql): Sql {
  return sql`initcap(replace(substr(${name}, position('.' in ${name}) + 1), '_', ' '))`;
}

export function actionActivitySubject(result: Sql, name: Sql): Sql {
  return sql`coalesce(nullif(${result}->>'title', ''), nullif(${result}->>'name', ''),
    case when ${result}->>'revision_id' is not null then 'Estimate ' || (${result}->>'revision_id') end,
    case when ${result}->>'dashboard_id' is not null then 'Dashboard ' || (${result}->>'dashboard_id') end,
    initcap(replace(split_part(${name}, '.', 1), '_', ' ')))`;
}

/** External work is inspectable as it happens, before an optional summary. */
export function ExternalActionRow(
  { renderers }: { renderers: SparkActionResultRenderer[] },
) {
  const rows = (
    <Each table="external_actions" recordName="external_action">
      <details
        className="my-1 border-b border-divider py-2 text-sm"
        data-external-action="true"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2">
          <MaterialIcon
            icon="ChevronRight"
            fontSize="sm"
            className="text-secondary"
          />
          <span className="font-medium">
            {actionActivityTitle(sql`external_action.action_name`)}
          </span>
          <span className="min-w-0 flex-1 truncate text-secondary">
            {actionActivitySubject(
              sql`external_action.result_json`,
              sql`external_action.action_name`,
            )}
          </span>
          <span className="text-xs text-secondary">
            {sql`case external_action.status::string when 'executed' then 'Completed' else initcap(external_action.status::string) end`}
          </span>
        </summary>
        <div className="pl-6 pt-2">
          <SparkActionResult
            renderers={renderers}
            actionName={sql`external_action.action_name`}
            result={sql`external_action.result_json`}
            status={sql`external_action.status`}
          />
          <Button
            size="sm"
            variant="plain"
            onClick={(s) => {
              s.setScalar(
                "changes_execution_id",
                sql`external_action.execution_event_id`,
              );
              s.setScalar("requested_artifact_id", sql`null`);
              s.setScalar("work_tab", sql.lit`changes`);
              s.setScalar("changes_panel_open", true);
            }}
          >
            Inspect changes
          </Button>
        </div>
      </details>
    </Each>
  );
  return (
    <Data
      watch={[sql`refresh_key`]}
      procedure={(s) => {
        s.defTable(
          "external_actions",
          sql`select id, action_name, result_json, status, execution_event_id
      from db.spark_action_log where spark_conversation_id = active_conversation_id
      and execution_event_id = (select execution_event_id from db.spark_action_log where id = event.action_id)
      and status in ('executed', 'undone', 'undo_requested') order by id`,
        );
      }}
    >
      <Show
        when={sql`event.action_id = (select min(id) from external_actions)`}
      >
        <Show
          when={sql`(select count(*) from external_actions) > 1`}
          fallback={rows}
        >
          <details
            className="my-2 rounded-lg border border-divider px-3 py-2 text-sm"
            data-external-batch="true"
          >
            <summary className="cursor-pointer font-medium">
              {sql`(select count(*)::string from external_actions) || ' actions'`}
            </summary>
            {rows}
          </details>
        </Show>
      </Show>
    </Data>
  );
}

export function SparkChangesPanel(
  { options, basePath, resultRenderers }: {
    options: SparkUndoOptions;
    basePath?: string;
    resultRenderers: SparkActionResultRenderer[];
  },
) {
  return (
    <Drawer
      open={sql`changes_panel_open`}
      onClose={(s) => s.setScalar("changes_panel_open", false)}
      direction="right"
      aria-label="Session changes"
      sx={{
        width: "min(600px, 100vw)",
        maxWidth: "100vw",
        p: 0,
        overflowY: "auto",
        "& [data-work-header]": {
          position: "sticky",
          top: 0,
          zIndex: 2,
          backgroundColor: "background-popup",
          px: 3,
          pt: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
        },
        "& [data-work-content]": { px: 3, py: 2.5 },
        "& [data-work-group]": {
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 10,
          overflow: "hidden",
          mb: 3,
        },
        "& [data-work-group-header]": {
          px: 2,
          py: 1.5,
          backgroundColor: "background-level1",
          borderBottom: "1px solid",
          borderColor: "divider",
        },
        "& [data-work-row]": {
          px: 2,
          py: 1.75,
          transition: "background 120ms",
          "& + [data-work-row]": {
            borderTop: "1px solid",
            borderColor: "divider",
          },
          "&:hover": { backgroundColor: "background-level1" },
          "&:has(input:checked)": {
            backgroundColor: cssVar("palette-primary-soft-bg"),
          },
        },
        "& [data-work-row] summary": {
          listStyle: "none",
          "&::-webkit-details-marker": { display: "none" },
        },
        "& [data-work-row] details[open] > summary [data-work-chevron]": {
          transform: "rotate(90deg)",
        },
        "& [data-work-chevron]": {
          transition: "transform 120ms",
          flexShrink: 0,
        },
        "& [data-work-detail]": {
          mt: 2,
          p: 2,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 8,
          backgroundColor: "background-surface",
        },
        "& [data-work-preview]": {
          my: 2,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 10,
          overflow: "hidden",
        },
        "& [data-work-file]": {
          display: "flex",
          alignItems: "flex-start",
          gap: 1.5,
          p: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          "&:last-child": { borderBottom: "none" },
        },
        "& [data-work-file-icon]": {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 44,
          borderRadius: 8,
          backgroundColor: "background-level1",
          color: "text-secondary",
          flexShrink: 0,
        },
      }}
    >
      <Data
        local
        watch={[sql`active_conversation_id`, sql`changes_execution_id`]}
        procedure={(s) => {
          s.defScalar("undo_preview", sql`null::json`);
          s.defTable("selected_changes", {
            fields: [{ name: "id", type: "BigInt", notNull: true }],
          });
        }}
      >
        <div data-work-header="true">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Session work</h2>
              <p className="mt-1 text-xs text-secondary">
                Changes and saved files
              </p>
            </div>
            <IconButton
              icon="Close"
              aria-label="Close changes"
              variant="plain"
              onClick={(s) => s.setScalar("changes_panel_open", false)}
            />
          </div>
          <Tabs
            value={sql`work_tab`}
            onValueChange={(s, value) => {
              s.setScalar("work_tab", value);
              s.setScalar("requested_artifact_id", sql`null`);
            }}
            className="mt-4"
          >
            <Tabs.List>
              <Tabs.Tab value="changes">Changes</Tabs.Tab>
              <Tabs.Tab value="artifacts">Artifacts</Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </div>
        <div data-work-content="true">
          <Show when={sql`work_tab = 'artifacts'`}>
            <SparkArtifactsPanel basePath={basePath} />
          </Show>
          <Show when={sql`work_tab = 'changes'`}>
            <p className="mb-4 text-sm text-secondary">
              Review the work in this session, or select changes to undo.
            </p>
            <Show when={sql`changes_execution_id is not null`}>
              <Button
                variant="plain"
                size="sm"
                onClick={(s) => s.setScalar("changes_execution_id", sql`null`)}
              >
                Show entire session
              </Button>
            </Show>
            <Data
              watch={[
                sql`refresh_key`,
                sql`active_conversation_id`,
                sql`changes_execution_id`,
              ]}
              procedure={(s) => {
                s.defTable(
                  "session_changes",
                  sql`select action.id, action.action_name, action.status, action.result_json,
              action.input_json, event.created_at, agent.id as execution_id,
              action.status = 'executed' and (${
                    reversibleSparkAction(options, sql`action.action_name`)
                  }) as reversible
              from db.spark_action_log action join db.spark_agent_events event on event.id = action.execution_event_id
              join db.spark_agents agent on agent.id = event.spark_agent_id
              where action.spark_conversation_id = ${
                    visibleConversationId(sql`active_conversation_id`)
                  }
              and (changes_execution_id is null
                or agent.id = (select spark_agent_id from db.spark_agent_events where id = changes_execution_id))
              order by action.id desc`,
                );
                s.defScalar(
                  "undo_session_busy",
                  sql`exists(select 1 from db.spark_agents where spark_conversation_id = active_conversation_id
                  and status in ('awaiting_plan', 'awaiting_execute', 'executing', 'failed_retrying_plan'))`,
                );
                s.defTable(
                  "executions",
                  sql`select execution_id, case when count(distinct action_name) = 1 then ${
                    actionActivityTitle(sql`min(action_name)`)
                  } else 'Mixed changes' end as group_title, count(*) as action_count, max(created_at) as created_at
              from session_changes group by execution_id order by max(id) desc`,
                );
              }}
            >
              <Show
                when={sql`active_conv_is_owner and exists(select 1 from session_changes where reversible)`}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    aria-label="Select all reversible actions"
                    onClick={(s) => {
                      s.modify(sql`delete from ui.selected_changes`);
                      s.modify(
                        sql`insert into ui.selected_changes select id from session_changes where reversible`,
                      );
                      s.setScalar("undo_preview", sql`null`);
                    }}
                  >
                    Select all
                  </Button>
                  <Button
                    size="sm"
                    variant="plain"
                    color="neutral"
                    aria-label="Clear selection"
                    onClick={(s) => {
                      s.modify(sql`delete from ui.selected_changes`);
                      s.setScalar("undo_preview", sql`null`);
                    }}
                  >
                    Clear
                  </Button>
                  <span className="ml-auto text-xs font-medium text-secondary">
                    {sql`(select count(*) from selected_changes)::string || ' selected'`}
                  </span>
                  <Show when={sql`undo_session_busy`}>
                    <p className="my-2 text-sm text-secondary">
                      Work is still running. Undo becomes available when it
                      finishes.
                    </p>
                  </Show>
                  <ActionButton
                    size="sm"
                    variant="outlined"
                    color="neutral"
                    startIcon="Undo"
                    disabled={sql`undo_session_busy or not exists(select 1 from selected_changes)`}
                    errorDisplay="inline"
                    refetch={false}
                    action={(s) => {
                      sparkBulkUndo(s, {
                        session: sql`active_conversation_id`,
                        user: sql`current_user`,
                        selection:
                          sql`(select json_array_agg(json_build_object('receiptId',id)) from ui.selected_changes)`,
                        execute: false,
                      }, "ui.undo_preview");
                    }}
                  >
                    Preview undo
                  </ActionButton>
                </div>
              </Show>
              <Show when={sql`undo_preview is not null`}>
                <div data-work-preview="true" className="p-4">
                  <div className="flex items-center gap-2">
                    <MaterialIcon icon="Undo" fontSize="sm" />
                    <h3 className="text-sm font-semibold">Undo preview</h3>
                    <IconButton
                      className="ml-auto"
                      icon="Close"
                      size="sm"
                      variant="plain"
                      color="neutral"
                      aria-label="Dismiss undo preview"
                      onClick={(s) => s.setScalar("undo_preview", sql`null`)}
                    />
                  </div>
                  <p className="my-2 text-sm">
                    {sql`case when (undo_preview->>'ready')::bool then 'These selected actions can be undone together. Saved artifacts remain available.' else 'Undo is blocked by later changes. Nothing has been changed.' end`}
                  </p>
                  <details className="my-3 text-sm text-secondary">
                    <summary className="cursor-pointer">
                      Conflict and transaction details
                    </summary>
                    <Data
                      watch={[sql`undo_preview`]}
                      procedure={(s) =>
                        s.defTable(
                          "preview_rows",
                          sql`select value from json.array_each(undo_preview->'analysis')`,
                        )}
                    >
                      <Each table="preview_rows" recordName="preview_row">
                        <p className="my-1 text-sm text-secondary">
                          {sql`'Transaction ' || (preview_row.value->>'transactionId') || ': ' || (preview_row.value->>'status') || ' · ' || (preview_row.value->>'affectedRecords') || ' records' || coalesce(' · ' || (preview_row.value->>'reason'), '')`}
                        </p>
                      </Each>
                    </Data>
                  </details>
                  <Show when={sql`(undo_preview->>'ready')::bool`}>
                    <ActionButton
                      color="danger"
                      size="sm"
                      errorDisplay="inline"
                      action={(s) => {
                        sparkBulkUndo(s, {
                          session: sql`active_conversation_id`,
                          user: sql`current_user`,
                          selection: sql`ui.undo_preview->'receipts'`,
                          execute: true,
                        }, "ui.undo_preview");
                      }}
                      onSuccess={(s) => {
                        s.setScalar("undo_preview", sql`null`);
                        s.modify(sql`delete from ui.selected_changes`);
                        s.increment("refresh_key");
                      }}
                      successMessage="Selected changes undone"
                    >
                      Undo selected changes
                    </ActionButton>
                  </Show>
                </div>
              </Show>
              <Show when={sql`not exists(select 1 from session_changes)`}>
                <p className="py-6 text-sm text-secondary">
                  No recorded actions yet.
                </p>
              </Show>
              <Each table="executions" recordName="group_row">
                <section data-work-group="true">
                  <div
                    data-work-group-header="true"
                    className="flex items-center justify-between gap-3"
                  >
                    <div>
                      <h3 className="text-sm font-semibold">
                        {sql`group_row.group_title || ' · ' || group_row.action_count::string || case when group_row.action_count = 1 then ' action' else ' actions' end`}
                      </h3>
                      <p className="mt-1 text-xs text-secondary">
                        {sql`format.date(group_row.created_at, '%b %d, %H:%M')`}
                      </p>
                    </div>
                    <Show
                      when={sql`active_conv_is_owner and exists(select 1 from session_changes where reversible and execution_id = group_row.execution_id)`}
                    >
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        onClick={(s) => {
                          s.modify(
                            sql`insert into ui.selected_changes select id from session_changes where reversible and execution_id = group_row.execution_id and id not in (select id from ui.selected_changes)`,
                          );
                          s.setScalar("undo_preview", sql`null`);
                        }}
                      >
                        Select group
                      </Button>
                    </Show>
                  </div>
                  <Data
                    procedure={(s) =>
                      s.defTable(
                        "group_changes",
                        sql`select * from session_changes where execution_id = group_row.execution_id order by id desc`,
                      )}
                  >
                    <Each table="group_changes" recordName="change">
                      <div
                        data-work-row="true"
                        className="flex items-start gap-3"
                      >
                        <Show
                          when={sql`active_conv_is_owner and change.reversible`}
                        >
                          <Checkbox
                            size="sm"
                            sx={{ mt: 0.25 }}
                            aria-label={sql`'Select action ' || change.id::string`}
                            checked={sql`exists(select 1 from selected_changes where id = change.id)`}
                            onChange={(s) => {
                              s.if(
                                sql`exists(select 1 from ui.selected_changes where id = change.id)`,
                                (s) =>
                                  s.modify(
                                    sql`delete from ui.selected_changes where id = change.id`,
                                  ),
                                (s) =>
                                  s.modify(
                                    sql`insert into ui.selected_changes values (change.id)`,
                                  ),
                              );
                              s.setScalar("undo_preview", sql`null`);
                            }}
                          />
                        </Show>
                        <Show
                          when={sql`not active_conv_is_owner or not change.reversible`}
                        >
                          <MaterialIcon
                            icon="History"
                            fontSize="sm"
                            className="mt-0.5 text-secondary"
                          />
                        </Show>
                        <details className="min-w-0 flex-1">
                          <summary className="flex cursor-pointer items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">
                                {actionActivityTitle(sql`change.action_name`)}
                              </span>
                              <span className="mt-1 block text-xs text-secondary">
                                {actionActivitySubject(
                                  sql`change.result_json`,
                                  sql`change.action_name`,
                                )}
                              </span>
                            </div>
                            <Chip
                              size="sm"
                              variant="soft"
                              color="neutral"
                              data-status={sql`change.status::string`}
                              sx={{
                                fontSize: "0.6875rem",
                                "&[data-status='executed']": {
                                  color: cssVar("palette-success-soft-color"),
                                  backgroundColor: cssVar(
                                    "palette-success-soft-bg",
                                  ),
                                },
                                "&[data-status='proposed']": {
                                  color: cssVar("palette-warning-soft-color"),
                                  backgroundColor: cssVar(
                                    "palette-warning-soft-bg",
                                  ),
                                },
                              }}
                            >
                              {sql`case change.status::string when 'executed' then 'Completed' when 'proposed' then 'Needs approval' else initcap(change.status::string) end`}
                            </Chip>
                            <MaterialIcon
                              icon="ChevronRight"
                              fontSize="sm"
                              data-work-chevron="true"
                              className="mt-0.5 text-secondary"
                            />
                          </summary>
                          <div data-work-detail="true">
                            <Show
                              when={sql`change.status = 'executed' and not change.reversible`}
                            >
                              <p className="my-2 text-sm text-secondary">
                                Not included in bulk undo. This action uses its
                                own undo workflow.
                              </p>
                            </Show>
                            <SparkActionResult
                              renderers={resultRenderers}
                              actionName={sql`change.action_name`}
                              result={sql`change.result_json`}
                              status={sql`change.status::string`}
                            />
                            <details className="mt-3 text-sm text-secondary">
                              <summary className="cursor-pointer">
                                Technical details
                              </summary>
                              <p className="my-2 break-all">
                                {sql`change.action_name`}
                              </p>
                              <p className="my-2">
                                {sql`'Execution ' || change.execution_id::string`}
                              </p>
                              <Show when={sql`change.input_json is not null`}>
                                <h3>Proposed input</h3>
                                <pre className="whitespace-pre-wrap break-all">{sql`change.input_json::string`}</pre>
                              </Show>
                              <Show when={sql`change.result_json is not null`}>
                                <h3>Recorded result</h3>
                                <pre className="whitespace-pre-wrap break-all">{sql`change.result_json::string`}</pre>
                              </Show>
                            </details>
                          </div>
                        </details>
                      </div>
                    </Each>
                  </Data>
                </section>
              </Each>
            </Data>
          </Show>
        </div>
      </Data>
    </Drawer>
  );
}
