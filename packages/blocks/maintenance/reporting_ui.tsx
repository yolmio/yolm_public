import { Button } from "components/button";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { MaterialIcon } from "components/material_icon";
import { useJsModule } from "std/js_modules";
import { UserLanguageICtxKey } from "std/ictx";
import { type Sql, sql } from "std/sql_utils";
import { Each, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { getAssetUrl } from "std/yolm_gen_api";
import { useReportMessageApi } from "./reporting_api";
import type { MaintenanceReportingOptions } from "./reporting_options";
import { reportingText } from "./reporting_i18n";

/** The browser owns draft/media recovery only; SQL owns item and comment creation. */
export function ReportComposer(
  props: {
    options: MaintenanceReportingOptions;
    contextPicker?: (handle: Sql, state: Sql) => Node;
    equipmentId?: Sql;
    locationId?: Sql;
    issueId?: Sql;
    mobile?: boolean;
  },
) {
  const language = useOptionalICtx(UserLanguageICtxKey)?.currentLanguage ??
    sql.lit`en`;
  useReportMessageApi(props.options);
  useJsModule("maintenance_capture", {
    assetUrl: getAssetUrl("maintenance_capture.js"),
  });
  const followup = !!props.issueId;

  return (
    <Data
      noRefetch
      procedure={(s) => s.defScalar("capture_user_id", sql`current_user`)}
    >
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("capture_handle", sql`gen_random_uuid()`);
          s.defScalar("capture_state", sql`'{}'::json`);
          s.defScalar("capture_summary", sql.lit``);
          s.defScalar("confirm_discard", false);
          s.defScalar("show_all_files", false);
          s.defScalar("report_fixed", false);
        }}
      >
        <section
          className={props.mobile
            ? "flex flex-col gap-3"
            : "flex flex-col gap-3 sm:rounded-xl sm:border sm:border-divider sm:bg-surface sm:p-4"}
          onMount={(s) =>
            s.jsCall({
              module: "maintenance_capture",
              exportName: "initialize",
              handle: sql`capture_handle`,
              argJson:
                sql`json_build_object('handle', capture_handle, 'userId', capture_user_id, 'equipmentId', ${
                  props.equipmentId ?? sql`null`
                }, 'locationId', ${props.locationId ?? sql`null`}, 'issueId', ${
                  props.issueId ?? sql`null`
                }, 'optionalCondition', true, 'language', ${language})`,
            })}
          js={{
            handles: [{
              module: "maintenance_capture",
              handle: sql`capture_handle`,
              cleanup: "cleanup",
            }],
            on: {
              "maintenance_capture.changed": (s) => {
                s.setScalar("capture_state", sql`event.payload_json`);
                s.setScalar(
                  "capture_summary",
                  sql`coalesce(event.payload_json->>'summary', '')`,
                );
                s.if(
                  sql`event.payload_json->'received' is not null and json_typeof(event.payload_json->'received') <> 'null'`,
                  (s) => s.refetch(),
                );
              },
            },
          }}
        >
          <Show when={sql`capture_state->>'ready' is null`}>
            <Typography>{reportingText("openingDraft")}</Typography>
          </Show>
          <Show
            when={sql`capture_state->>'ready' = 'true' and coalesce(json_typeof(capture_state->'received'), 'null') = 'null'`}
          >
            <div>
              <Typography level="title-md">
                {followup
                  ? reportingText("addUpdate")
                  : reportingText("whatsHappening")}
              </Typography>
            </div>
            <Textarea
              minRows={2}
              value={sql`capture_summary`}
              aria-label={reportingText("whatsHappening")}
              placeholder={followup
                ? reportingText("updatePlaceholder")
                : reportingText("reportPlaceholder")}
              disabled={sql`capture_state->>'busy' = 'true'`}
              onInput={(s) => {
                s.setScalar("capture_summary", sql`target_value`);
                s.jsCall({
                  module: "maintenance_capture",
                  exportName: "update",
                  handle: sql`capture_handle`,
                  argJson:
                    sql`json_build_object('handle', capture_handle, 'summary', target_value)`,
                });
              }}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button
                variant="outlined"
                startIcon="PhotoLibrary"
                disabled={sql`capture_state->>'busy' = 'true'`}
                onClick={(s) =>
                  s.jsCall({
                    module: "maintenance_capture",
                    exportName: "pick",
                    handle: sql`capture_handle`,
                    argJson:
                      sql`json_build_object('handle', capture_handle, 'accept', 'image/*')`,
                  })}
              >
                {reportingText("photo")}
              </Button>
              <Button
                variant="outlined"
                startIcon="Videocam"
                disabled={sql`capture_state->>'busy' = 'true'`}
                onClick={(s) =>
                  s.jsCall({
                    module: "maintenance_capture",
                    exportName: "pick",
                    handle: sql`capture_handle`,
                    argJson:
                      sql`json_build_object('handle', capture_handle, 'accept', 'video/*')`,
                  })}
              >
                {reportingText("video")}
              </Button>
              <Button
                variant="outlined"
                startIcon="AttachFile"
                className="hidden sm:inline-flex"
                disabled={sql`capture_state->>'busy' = 'true'`}
                onClick={(s) =>
                  s.jsCall({
                    module: "maintenance_capture",
                    exportName: "pick",
                    handle: sql`capture_handle`,
                    argJson: sql`json_build_object('handle', capture_handle)`,
                  })}
              >
                {reportingText("file")}
              </Button>
            </div>
            <Data
              local
              watch={[sql`capture_state`]}
              procedure={(s) =>
                s.defTable(
                  "picked_files",
                  sql`select value, index from json.array_each(coalesce(capture_state->'files', '[]'::json))`,
                )}
            >
              <Show when={sql`exists(select 1 from picked_files)`}>
                <p className="mb-2 text-sm text-secondary">
                  {sql`(select count(*) from picked_files) || ' ' || ${
                    reportingText("attachments")
                  }`}
                </p>
              </Show>
              <div className="grid grid-cols-2 gap-2">
                <Each
                  table="picked_files"
                  recordName="picked"
                  where={sql`show_all_files or picked.index < 4`}
                  eachKey={sql`picked.value->>'id'`}
                >
                  <div className="rounded-lg border border-divider p-2">
                    <Show when={sql`picked.value->>'type' like 'image/%'`}>
                      <img
                        src={sql`picked.value->>'url'`}
                        alt={sql`picked.value->>'name'`}
                        className="h-28 w-full rounded object-contain"
                      />
                    </Show>
                    <Show when={sql`picked.value->>'type' like 'video/%'`}>
                      <video
                        src={sql`picked.value->>'url'`}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-28 w-full rounded"
                      />
                    </Show>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span
                        className="min-w-0 truncate text-sm"
                        title={sql`picked.value->>'name'`}
                      >
                        {sql`picked.value->>'name'`}
                      </span>
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        aria-label={sql`'Remove ' || (picked.value->>'name')`}
                        disabled={sql`capture_state->>'busy' = 'true'`}
                        onClick={(s) =>
                          s.jsCall({
                            module: "maintenance_capture",
                            exportName: "remove",
                            handle: sql`capture_handle`,
                            argJson:
                              sql`json_build_object('handle', capture_handle, 'id', picked.value->>'id')`,
                          })}
                      >
                        {reportingText("remove")}
                      </Button>
                    </div>
                    <Show when={sql`picked.value->>'uploaded' = 'true'`}>
                      <span className="text-xs text-secondary">
                        {reportingText("uploadedNotSent")}
                      </span>
                    </Show>
                  </div>
                </Each>
              </div>
              <Show when={sql`(select count(*) from picked_files) > 4`}>
                <Button
                  variant="plain"
                  onClick={(s) =>
                    s.setScalar("show_all_files", sql`not show_all_files`)}
                >
                  {sql`case when show_all_files then ${
                    reportingText("showFewer")
                  } else ${reportingText("showAllAttachments")} end`}
                </Button>
              </Show>
            </Data>
            {props.contextPicker?.(sql`capture_handle`, sql`capture_state`)}
            {!followup && (
              <Show
                when={sql`nullif(capture_state->>'equipmentId', '') is not null`}
              >
                <fieldset>
                  <legend className="mb-2 font-semibold">
                    {reportingText("equipmentNowOptional")}
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {([
                      {
                        value: "operational",
                        label: reportingText("running"),
                        color: "success",
                      },
                      {
                        value: "degraded",
                        label: reportingText("runningWithProblem"),
                        color: "warning",
                      },
                      {
                        value: "unavailable",
                        label: reportingText("stopped"),
                        color: "danger",
                      },
                    ] as const).map((choice) => (
                      <Button
                        variant="outlined"
                        color={choice.color}
                        aria-pressed={sql`capture_state->>'condition' = ${
                          sql.lit(choice.value)
                        }`}
                        className="min-h-12 whitespace-normal"
                        disabled={sql`capture_state->>'busy' = 'true'`}
                        onClick={(s) =>
                          s.jsCall({
                            module: "maintenance_capture",
                            exportName: "update",
                            handle: sql`capture_handle`,
                            argJson:
                              sql`json_build_object('handle', capture_handle, 'condition', ${
                                sql.lit(choice.value)
                              })`,
                          })}
                      >
                        <Show
                          when={sql`capture_state->>'condition' = ${
                            sql.lit(choice.value)
                          }`}
                        >
                          <span aria-hidden="true">✓</span>
                        </Show>
                        {choice.label}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-sm text-secondary">
                    {reportingText("runningReportHelp")}
                  </p>
                </fieldset>
              </Show>
            )}
            {!followup && props.options.fixedOnTheSpot && (
              <button
                type="button"
                aria-pressed={sql`report_fixed`}
                disabled={sql`capture_state->>'busy' = 'true'`}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-divider bg-surface px-4 text-left"
                sx={{
                  "&[aria-pressed=true]": {
                    borderColor: "success.600",
                    backgroundColor: "success.50",
                    color: "success.800",
                  },
                }}
                onClick={(s) =>
                  s.setScalar("report_fixed", sql`not report_fixed`)}
              >
                <MaterialIcon
                  icon="TaskAlt"
                  className="text-2xl"
                />
                <span className="flex flex-1 flex-col">
                  <span className="text-base font-semibold">
                    {reportingText("alreadyFixed")}
                  </span>
                  <span className="text-xs text-secondary">
                    {reportingText("alreadyFixedHelp")}
                  </span>
                </span>
                <Show when={sql`report_fixed`}>
                  <MaterialIcon icon="CheckCircle" className="text-2xl" />
                </Show>
              </button>
            )}
            <Show
              when={sql`trim(capture_summary) <> '' or capture_state->>'busy' = 'true' or nullif(capture_state->>'error', '') is not null or exists(select 1 from json.array_each(coalesce(capture_state->'files', '[]'::json)))`}
            >
              <div role="status" className="text-sm text-secondary">
                {sql`capture_state->>'status'`}
              </div>
            </Show>
            <Show when={sql`capture_state->>'busy' = 'true'`}>
              <progress
                aria-label={reportingText("currentUpload")}
                max={100}
                value={sql`cast(coalesce(capture_state->>'progress', '0') as int)`}
                className="w-full"
              />
              <p className="text-xs text-secondary">
                {reportingText("keepOpen")}
              </p>
            </Show>
            <Show when={sql`nullif(capture_state->>'error', '') is not null`}>
              <p role="alert" className="text-sm text-danger-700">
                {sql`capture_state->>'error'`}
              </p>
            </Show>
            <Button
              size="lg"
              startIcon="Send"
              disabled={sql`capture_state->>'busy' = 'true' or (trim(capture_summary) = '' and not exists(select 1 from json.array_each(coalesce(capture_state->'files', '[]'::json))))`}
              onClick={(s) =>
                s.jsCall({
                  module: "maintenance_capture",
                  exportName: "send",
                  handle: sql`capture_handle`,
                  argJson: sql`json_build_object('handle', capture_handle)`,
                })}
            >
              {sql`case when capture_state->>'busy' = 'true' then ${
                reportingText("sending")
              } when nullif(capture_state->>'error', '') is not null then ${
                reportingText("retrySend")
              } else ${
                followup
                  ? reportingText("sendUpdate")
                  : reportingText("sendReport")
              } end`}
            </Button>
            <Show
              when={sql`trim(capture_summary) <> '' or exists(select 1 from json.array_each(coalesce(capture_state->'files', '[]'::json)))`}
            >
              <div className="text-xs text-secondary">
                <Button
                  variant="plain"
                  size="sm"
                  color="danger"
                  disabled={sql`capture_state->>'busy' = 'true'`}
                  onClick={(s) => s.setScalar("confirm_discard", true)}
                >
                  {reportingText("discardDraft")}
                </Button>
                <Show when={sql`confirm_discard`}>
                  <p>{reportingText("discardQuestion")}</p>
                  <Button
                    color="danger"
                    onClick={(s) => {
                      s.setScalar("confirm_discard", false);
                      s.jsCall({
                        module: "maintenance_capture",
                        exportName: "discard",
                        handle: sql`capture_handle`,
                        argJson:
                          sql`json_build_object('handle', capture_handle)`,
                      });
                    }}
                  >
                    {reportingText("confirmDiscard")}
                  </Button>
                  <Button
                    variant="plain"
                    onClick={(s) => s.setScalar("confirm_discard", false)}
                  >
                    {reportingText("keepDraft")}
                  </Button>
                </Show>
              </div>
            </Show>
          </Show>
          <Show
            when={sql`capture_state->'received' is not null and json_typeof(capture_state->'received') <> 'null'`}
          >
            <Show
              when={sql`report_fixed and capture_state->'received'->>'issue_id' is not null`}
            >
              {/* Fixed on the spot: go close it out. */}
              <div
                className="hidden"
                onMount={(s) =>
                  s.navigate(
                    props.options.reportHref(
                      sql`capture_state->'received'->>'issue_id'`,
                    ),
                  )}
              />
            </Show>
            <Typography level="title-lg">
              {reportingText("received")}
            </Typography>
            <Typography>
              {reportingText("receivedHelp")}
            </Typography>
            <Show
              when={sql`capture_state->'received'->>'issue_id' is not null`}
            >
              <Button
                href={props.options.reportHref(
                  sql`capture_state->'received'->>'issue_id'`,
                )}
              >
                {reportingText("viewReport")}
              </Button>
            </Show>
            <Button
              variant="plain"
              onClick={(s) =>
                s.jsCall({
                  module: "maintenance_capture",
                  exportName: "discard",
                  handle: sql`capture_handle`,
                  argJson: sql`json_build_object('handle', capture_handle)`,
                })}
            >
              {followup
                ? reportingText("addAnotherUpdate")
                : reportingText("reportAnotherProblem")}
            </Button>
          </Show>
        </section>
      </Data>
    </Data>
  );
}

export function ReportDrafts() {
  const language = useOptionalICtx(UserLanguageICtxKey)?.currentLanguage ??
    sql.lit`en`;
  useJsModule("maintenance_capture", {
    assetUrl: getAssetUrl("maintenance_capture.js"),
  });
  return (
    <Data procedure={(s) => s.defScalar("draft_owner", sql`current_user`)}>
      <Data
        local
        procedure={(s) => {
          s.defScalar("draft_list_handle", sql`gen_random_uuid()`);
          s.defScalar("draft_list", sql`'{}'::json`);
        }}
      >
        <section
          onMount={(s) =>
            s.jsCall({
              module: "maintenance_capture",
              exportName: "listDrafts",
              handle: sql`draft_list_handle`,
              argJson:
                sql`json_build_object('handle', draft_list_handle, 'userId', draft_owner, 'language', ${language})`,
            })}
          js={{
            handles: [{
              module: "maintenance_capture",
              handle: sql`draft_list_handle`,
              cleanup: "cleanup",
            }],
            on: {
              "maintenance_capture.draftsListed": (s) =>
                s.setScalar("draft_list", sql`event.payload_json`),
            },
          }}
        >
          <Show when={sql`nullif(draft_list->>'error', '') is not null`}>
            <p role="alert">{sql`draft_list->>'error'`}</p>
          </Show>
          <Data
            local
            watch={[sql`draft_list`]}
            procedure={(s) =>
              s.defTable(
                "phone_drafts",
                sql`select value from json.array_each(coalesce(draft_list->'drafts','[]'::json))`,
              )}
          >
            <Show when={sql`exists(select 1 from phone_drafts)`}>
              <Typography level="title-md">
                {reportingText("unsentDrafts")}
              </Typography>
              <p className="mb-2 text-sm text-secondary">
                {reportingText("draftsHelp")}
              </p>
            </Show>
            <Each table="phone_drafts" recordName="draft">
              <Button
                variant="outlined"
                className="mb-2 w-full whitespace-normal text-left"
                href={sql`case when nullif(draft.value->>'issueId', '') is not null then '/maintenance/items/' || (draft.value->>'issueId') || '?draft_client_id=' || (draft.value->>'clientId') when nullif(draft.value->>'locationId', '') is not null then '/locations/' || (draft.value->>'locationId') || '/report' when nullif(draft.value->>'equipmentId', '') is not null then '/equipment/' || (draft.value->>'equipmentId') || '/report' else '/maintenance/report' end`}
              >
                {sql`substring(draft.value->>'summary' from 1 for 120) || ' · ' || (draft.value->>'fileCount') || ' ' || ${
                  reportingText("files")
                }`}
              </Button>
            </Each>
          </Data>
        </section>
      </Data>
    </Data>
  );
}
