import { Button } from "components/button";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { PageHeader } from "components/page_header";
import { Radio } from "components/radio";
import { Typography } from "components/typography";
import type { Node } from "std/ui";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Each, Show } from "std/ui";
import { type Sql, sql } from "std/sql_utils";
import { cssVar } from "std/style_utils";
import type { StyleObject } from "std/style_types";
import { queryParamsString } from "std/services";
import {
  mcpHash,
  mcpPermission,
  mcpRandom,
  type TenantMcpOptions,
} from "./index";

export const mcpSettingsStyles = {
  root: {
    flex: 1,
    minHeight: 0,
    height: "100%",
    overflowY: "auto",
    backgroundColor: cssVar("palette-background-body"),
  },
  inner: {
    width: "100%",
    maxWidth: 760,
    mx: "auto",
    px: 2,
    py: 3,
    md: { px: 4, py: 5 },
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    md: { alignItems: "center" },
  },
  muted: { color: cssVar("palette-text-tertiary") },
  secondary: { color: cssVar("palette-text-secondary") },
  panel: {
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-lg"),
    backgroundColor: cssVar("palette-background-surface"),
    p: 2.5,
    md: { p: 3 },
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  consentPanel: {
    border: `1px solid ${cssVar("palette-primary-outlined-border")}`,
    borderRadius: cssVar("radius-lg"),
    backgroundColor: cssVar("palette-background-surface"),
    boxShadow: cssVar("shadow-md"),
    p: 2.5,
    md: { p: 3 },
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  steps: {
    m: 0,
    p: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 1,
    counterReset: "mcp-step",
  },
  step: {
    display: "flex",
    alignItems: "baseline",
    gap: 1.25,
    fontSize: cssVar("text-sm"),
    color: cssVar("palette-text-secondary"),
    counterIncrement: "mcp-step",
    "&::before": {
      content: "counter(mcp-step)",
      flexShrink: 0,
      width: 20,
      height: 20,
      borderRadius: "50%",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: cssVar("text-xs"),
      fontWeight: 600,
      color: cssVar("palette-primary-plain-color"),
      backgroundColor: cssVar("palette-primary-soft-bg"),
      transform: "translateY(-1px)",
    },
  },
  urlField: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    pl: 1.5,
    pr: 0.5,
    py: 0.5,
    minHeight: 44,
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-md"),
    backgroundColor: cssVar("palette-background-level1"),
  },
  urlText: {
    flex: 1,
    minWidth: 0,
    fontFamily: cssVar("font-family-code"),
    fontSize: cssVar("text-sm"),
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 2,
  },
  list: {
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-lg"),
    backgroundColor: cssVar("palette-background-surface"),
    overflow: "hidden",
    "& > * + *": { borderTop: `1px solid ${cssVar("palette-divider")}` },
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 1.5,
    px: 2,
    py: 1.75,
  },
  avatar: {
    flexShrink: 0,
    width: 36,
    height: 36,
    borderRadius: cssVar("radius-md"),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: cssVar("text-sm"),
    textTransform: "uppercase",
    color: cssVar("palette-primary-soft-color"),
    backgroundColor: cssVar("palette-primary-soft-bg"),
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 0.5,
  },
  rowTitle: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 0.75,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 0.5 },
  details: {
    mt: 0.5,
    "& > summary": {
      cursor: "pointer",
      width: "fit-content",
      fontSize: cssVar("text-sm"),
      color: cssVar("palette-text-secondary"),
      listStyle: "none",
      display: "inline-flex",
      alignItems: "center",
      gap: 0.25,
      userSelect: "none",
      whiteSpace: "nowrap",
    },
    "& > summary::-webkit-details-marker": { display: "none" },
    "& > summary:hover": { color: cssVar("palette-text-primary") },
    "& > summary > svg": { transition: "transform 150ms" },
    "&[open] > summary > svg": { transform: "rotate(90deg)" },
  },
  detailsBody: {
    mt: 1.25,
    display: "flex",
    flexDirection: "column",
    gap: 1.5,
  },
  subList: {
    display: "flex",
    flexDirection: "column",
    borderLeft: `2px solid ${cssVar("palette-divider")}`,
    pl: 1.5,
    gap: 0.75,
  },
  subRow: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    fontSize: cssVar("text-sm"),
    color: cssVar("palette-text-secondary"),
  },
  accessOption: {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: 1.5,
    p: 1.75,
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-md"),
    "&:has(input:checked)": {
      borderColor: cssVar("palette-primary-outlined-border"),
      backgroundColor: cssVar("palette-primary-soft-bg"),
    },
  },
  linkRow: {
    color: "inherit",
    textDecoration: "none",
    transition: "background-color 120ms",
    "&:hover": { backgroundColor: cssVar("palette-background-level1") },
  },
  empty: {
    border: `1px dashed ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-lg"),
    px: 2,
    py: 4,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 0.5,
    color: cssVar("palette-text-tertiary"),
  },
} satisfies Record<string, StyleObject>;

/** Short human time for a past timestamp, e.g. "5 min ago" or "Sep 12, 2026". */
export function mcpRelativeTime(ts: Sql): Sql {
  return sql`case
    when ${ts} is null then 'never'
    when date.diff(second, ${ts}, now()) < 60 then 'just now'
    when date.diff(second, ${ts}, now()) < 3600 then (date.diff(second, ${ts}, now()) / 60)::string || ' min ago'
    when date.diff(second, ${ts}, now()) < 86400 then (date.diff(second, ${ts}, now()) / 3600)::string || ' hr ago'
    when date.diff(second, ${ts}, now()) < 172800 then 'yesterday'
    when date.diff(second, ${ts}, now()) < 604800 then (date.diff(second, ${ts}, now()) / 86400)::string || ' days ago'
    else format.date(${ts}, '%b %-d, %Y')
  end`;
}

/** Render inside the application's existing authenticated route tree. */
export function McpSettings(
  { options, children, explainMissingPermission }: {
    options: TenantMcpOptions;
    children?: Node;
    /**
     * Expand the refusal shown to a user who lacks MCP permission into an
     * explanation of how it is granted. Off by default: the wording names an
     * administrator and the read/act split, which does not suit every
     * deployment. Opt in per application.
     */
    explainMissingPermission?: boolean;
  },
) {
  const label = options.surface === "forge" ? "Forge" : "Spark";
  const writeLabel = options.surface === "forge" ? "Develop" : "Read and act";
  const access = options.surface === "forge"
    ? "Inspect and edit application versions, query production, run validation and tests, use previews and permitted issue and Edge operations. Deployment is unavailable."
    : "Read your authorized Spark data and files, use skills and enabled functions, and execute registered reversible actions. Approval-required actions wait for review in Spark.";
  const mcpUrl =
    sql`case when regex.is_match(location.host, '^(localhost|127[.]0[.]0[.]1)(:[0-9]+)?$') then 'http://' else 'https://' end || location.host || ${
      sql.lit(options.path)
    }`;
  const labels = options.capabilityLabels;
  const labelCatalog = labels &&
    sql`json.array_each(${
      sql.lit(
        JSON.stringify(
          Object.entries(labels).map(([name, label]) => ({ name, label })),
        ),
      )
    }::json)`;
  const accessChip = (write: Sql) => (
    <>
      <Show when={write}>
        <Chip size="sm" variant="soft" color="primary">{writeLabel}</Chip>
      </Show>
      <Show when={sql`not (${write})`}>
        <Chip size="sm" variant="soft" color="neutral">Read only</Chip>
      </Show>
    </>
  );
  return (
    <Data
      queryParams={{
        request: {
          type: { type: "String", maxLength: 64 },
          default: sql.lit``,
        },
      }}
      procedure={(s) => {
        s.defScalar("mcp_callback_url", {
          type: { type: "String", maxLength: 4096 },
        });
        s.defScalar("mcp_url_copied", sql`false`);
        s.defScalar(
          "mcp_visible_capabilities",
          options.capabilities(sql`current_user`),
        );
        s.defScalar(
          "mcp_can_connect",
          sql`current_user is not null and (${
            mcpPermission(options, sql`current_user`, sql.lit`read`)
          })`,
        );
        s.defRecord(
          "pending_connection",
          sql`select a.id, a.resource, a.access, coalesce(a.gateway_client_name, c.name) as name, a.redirect_uri from db.mcp_connections a left join db.mcp_clients c on c.id = a.client_id where a.request_hash = ${
            mcpHash(sql`request`)
          } and a.surface = ${
            sql.lit(options.surface)
          } and a.revoked_at is null and a.expires_at > now() and a.sys_user_id is null and a.consumed_at is null`,
        );
        s.defScalar(
          "mcp_can_write",
          mcpPermission(options, sql`current_user`, sql.lit`write`),
        );
        s.defScalar("mcp_selected_access", sql`'read'`);
        s.defTable(
          "assistant_connections",
          sql`select c.id, coalesce(c.gateway_client_name, client.name, 'Unnamed assistant') as name, c.gateway_client_name is not null as via_gateway, c.created_at, c.last_used_at, c.resource, c.capabilities, c.access::string = 'write' as can_write from db.mcp_connections c left join db.mcp_clients client on client.id = c.client_id where c.sys_user_id = current_user and c.surface = ${
            sql.lit(options.surface)
          } and c.revoked_at is null and c.consumed_at is not null
            and ((c.access_hash is not null and c.access_expires_at > now())
              or (c.refresh_hash is not null and c.refresh_expires_at > now())
              or (c.gateway_control_hash is not null and c.gateway_access_hash is not null))
            order by c.created_at desc`,
        );
        s.defTable(
          "assistant_groups",
          sql`select * from (select name, count(*) as connection_count, max(created_at) as latest_created_at, max(last_used_at) as last_used_at, max(case when can_write then 1 else 0 end) = 1 as can_write, max(case when via_gateway then 1 else 0 end) = 1 as via_gateway from assistant_connections group by name) g order by coalesce(g.last_used_at, g.latest_created_at) desc`,
        );
        if (labelCatalog) {
          s.defTable(
            "assistant_capabilities",
            sql`select distinct c.name as group_name, known.index, known.value->>'label' as label from assistant_connections c join ${labelCatalog} known on c.capabilities @> json_build_array(known.value->>'name') order by known.index`,
          );
          s.defTable(
            "visible_capability_labels",
            sql`select known.index, known.value->>'label' as label from ${labelCatalog} known where mcp_visible_capabilities @> json_build_array(known.value->>'name') order by known.index`,
          );
        }
      }}
    >
      <main id="mcp-settings-page" sx={mcpSettingsStyles.root}>
        <div sx={mcpSettingsStyles.inner}>
          <div className="flex flex-col gap-1">
            <PageHeader sx={mcpSettingsStyles.header}>
              <Typography level="h3">Connected assistants</Typography>
            </PageHeader>
            <Typography level="body-md" sx={mcpSettingsStyles.secondary}>
              Let AI assistants such as Claude, ChatGPT and Codex work with{" "}
              {label} over MCP. Your permissions are checked on every request.
            </Typography>
          </div>
          <Show when={sql`not mcp_can_connect`}>
            <div sx={mcpSettingsStyles.panel}>
              {explainMissingPermission
                ? (
                  // Having an account here does not imply MCP access: it is
                  // granted separately, and read-only is a separate grant from
                  // letting an assistant act. Without this the refusal reads
                  // as a bug rather than as the control it is.
                  <Typography level="body-md">
                    You do not have permission to connect an assistant to this
                    application. MCP access is granted separately from your
                    other access here, so ask an administrator of this system to
                    grant it. Permission to connect read-only is separate from
                    permission to let an assistant perform actions.
                  </Typography>
                )
                : (
                  <Typography level="body-md">
                    You do not have access to connect this application.
                  </Typography>
                )}
            </div>
          </Show>
          <Show when={sql`mcp_can_connect`}>
            <Show when={sql`request != ''`}>
              <Show when={sql`pending_connection.id is null`}>
                <div sx={mcpSettingsStyles.panel}>
                  <Typography level="title-md" startIcon="LinkOff">
                    This request is no longer valid
                  </Typography>
                  <Typography level="body-sm" sx={mcpSettingsStyles.secondary}>
                    It expired or has already been handled. Start connecting
                    again from your assistant.
                  </Typography>
                </div>
              </Show>
              <Show when={sql`pending_connection.id is not null`}>
                <section sx={mcpSettingsStyles.consentPanel}>
                  <div>
                    <Typography level="title-lg">
                      Allow {sql`pending_connection.name`} to use {label}?
                    </Typography>
                    <Typography
                      level="body-sm"
                      sx={[mcpSettingsStyles.muted, {
                        wordBreak: "break-all",
                        mt: 0.5,
                      }]}
                    >
                      {sql`pending_connection.resource`}
                    </Typography>
                  </div>
                  <div
                    role="radiogroup"
                    aria-label="Access"
                    className="flex flex-col gap-2"
                  >
                    <label sx={mcpSettingsStyles.accessOption}>
                      <Radio
                        name={sql.lit`mcp_access`}
                        value={sql.lit`read`}
                        checked={sql`mcp_selected_access = 'read'`}
                        onClick={(s) =>
                          s.setScalar("mcp_selected_access", sql.lit`read`)}
                        aria-label="Read only"
                      />
                      <div>
                        <Typography level="title-sm">Read only</Typography>
                        <Typography
                          level="body-sm"
                          sx={mcpSettingsStyles.secondary}
                        >
                          Read permitted information. Cannot modify application
                          data, propose actions or save work.
                        </Typography>
                      </div>
                    </label>
                    <Show
                      when={sql`pending_connection.access = 'write' and mcp_can_write`}
                    >
                      <label sx={mcpSettingsStyles.accessOption}>
                        <Radio
                          name={sql.lit`mcp_access`}
                          value={sql.lit`write`}
                          checked={sql`mcp_selected_access = 'write'`}
                          onClick={(s) =>
                            s.setScalar("mcp_selected_access", sql.lit`write`)}
                          aria-label={writeLabel}
                        />
                        <div>
                          <Typography level="title-sm">{writeLabel}</Typography>
                          <Typography
                            level="body-sm"
                            sx={mcpSettingsStyles.secondary}
                          >
                            {access}
                          </Typography>
                        </div>
                      </label>
                    </Show>
                  </div>
                  <Typography
                    level="body-xs"
                    sx={[mcpSettingsStyles.muted, { wordBreak: "break-all" }]}
                  >
                    After you decide, you'll return to{" "}
                    {sql`pending_connection.redirect_uri`}. You can revoke
                    access here at any time.
                  </Typography>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      errorDisplay="inline"
                      refetch={false}
                      afterSuccessClient={(s) =>
                        s.location.assign(sql`mcp_callback_url`)}
                      action={(s) => {
                        s.if(
                          sql`current_user is null or not (${
                            mcpPermission(
                              options,
                              sql`current_user`,
                              sql.lit`read`,
                            )
                          })`,
                          (s) => s.throwError(sql.lit`Not authorized.`),
                        );
                        s.startTransaction();
                        s.defRecord(
                          "consent",
                          sql`select * from db.mcp_connections where request_hash = ${
                            mcpHash(sql`request`)
                          } and surface = ${
                            sql.lit(options.surface)
                          } and revoked_at is null and expires_at > now() and sys_user_id is null and consumed_at is null`,
                        );
                        s.if(sql`consent.id is null`, (s) =>
                          s.throwError(
                            sql
                              .lit`Connection request expired or already handled.`,
                          ));
                        s.if(
                          sql`mcp_selected_access not in ('read','write') or (mcp_selected_access = 'write' and consent.access != 'write') or not (${
                            mcpPermission(
                              options,
                              sql`current_user`,
                              sql`mcp_selected_access`,
                            )
                          })`,
                          (s) =>
                            s.throwError(
                              sql
                                .lit`You cannot grant this connection's requested access.`,
                            ),
                        );
                        s.defScalar("consent_code", mcpRandom());
                        s.modify(
                          sql`update db.mcp_connections set sys_user_id = current_user, access = mcp_selected_access, capabilities = ${
                            options.capabilities(sql`current_user`)
                          }, code_hash = ${
                            mcpHash(sql`consent_code`)
                          }, expires_at = date.add(minute, 2, now()) where id = consent.id`,
                        );
                        s.commitTransaction();
                        s.setScalar(
                          "mcp_callback_url",
                          sql`consent.redirect_uri || case when position('?' in consent.redirect_uri) > 0 then '&' else '?' end || ${
                            queryParamsString({
                              code: sql`consent_code`,
                              state: sql`consent.state`,
                            })
                          }`,
                        );
                      }}
                    >
                      Allow access
                    </ActionButton>
                    <ActionButton
                      variant="plain"
                      color="neutral"
                      refetch={false}
                      afterSuccessClient={(s) =>
                        s.location.assign(sql`mcp_callback_url`)}
                      action={(s) => {
                        s.startTransaction();
                        s.defRecord(
                          "cancel_consent",
                          sql`select * from db.mcp_connections where request_hash = ${
                            mcpHash(sql`request`)
                          } and surface = ${
                            sql.lit(options.surface)
                          } and revoked_at is null and expires_at > now() and sys_user_id is null and consumed_at is null`,
                        );
                        s.if(sql`cancel_consent.id is null`, (s) =>
                          s.throwError(
                            sql
                              .lit`Connection request expired or already handled.`,
                          ));
                        s.modify(
                          sql`update db.mcp_connections set consumed_at = now() where id = cancel_consent.id`,
                        );
                        s.commitTransaction();
                        s.setScalar(
                          "mcp_callback_url",
                          sql`cancel_consent.redirect_uri || case when position('?' in cancel_consent.redirect_uri) > 0 then '&' else '?' end || ${
                            queryParamsString({
                              error: sql.lit`access_denied`,
                              state: sql`cancel_consent.state`,
                            })
                          }`,
                        );
                      }}
                    >
                      Cancel
                    </ActionButton>
                  </div>
                </section>
              </Show>
            </Show>
            <Show when={sql`pending_connection.id is null`}>
              <section sx={mcpSettingsStyles.panel}>
                <div>
                  <Typography level="title-md">Connect an assistant</Typography>
                  <Typography
                    level="body-sm"
                    sx={[mcpSettingsStyles.secondary, { mt: 0.5 }]}
                  >
                    {access}
                  </Typography>
                </div>
                <ol sx={mcpSettingsStyles.steps}>
                  <li sx={mcpSettingsStyles.step}>
                    Add this URL as a custom MCP server or connector in your
                    assistant.
                  </li>
                  <li sx={mcpSettingsStyles.step}>
                    Sign in to {label} when the assistant asks.
                  </li>
                  <li sx={mcpSettingsStyles.step}>
                    Choose read-only or {writeLabel.toLowerCase()} access.
                  </li>
                </ol>
                <div sx={mcpSettingsStyles.urlField}>
                  <MaterialIcon
                    icon="Link"
                    sx={[mcpSettingsStyles.muted, { flexShrink: 0 }]}
                  />
                  <span sx={mcpSettingsStyles.urlText} title={mcpUrl}>
                    {mcpUrl}
                  </span>
                  <Button
                    size="sm"
                    variant="soft"
                    color="neutral"
                    startIcon="ContentCopy"
                    onClick={(s) => {
                      s.clipboard.writeText(mcpUrl);
                      s.setScalar("mcp_url_copied", sql`true`);
                      s.sleep(2000);
                      s.setScalar("mcp_url_copied", sql`false`);
                    }}
                    aria-label="Copy MCP URL"
                  >
                    <Show when={sql`mcp_url_copied`}>Copied</Show>
                    <Show when={sql`not mcp_url_copied`}>Copy</Show>
                  </Button>
                </div>
                {labels && (
                  <div className="flex flex-col gap-1">
                    <Typography level="body-xs" sx={mcpSettingsStyles.muted}>
                      Assistants can use
                    </Typography>
                    <div sx={mcpSettingsStyles.chips}>
                      <Each
                        table="visible_capability_labels"
                        recordName="visible_capability"
                      >
                        <Chip size="sm" variant="outlined" color="neutral">
                          {sql`visible_capability.label`}
                        </Chip>
                      </Each>
                    </div>
                  </div>
                )}
                <Typography level="body-xs" sx={mcpSettingsStyles.muted}>
                  This URL covers this{" "}
                  {options.surface === "forge" ? "Forge instance" : "system"}
                  {" "}
                  only. To reach several Yolm systems through one connection,
                  {" "}
                  <a
                    className="underline"
                    href={sql`'https://mcp.yolm.ai/connect?' || ${
                      queryParamsString({
                        domain: sql`location.host`,
                        surface: sql.lit(options.surface),
                      })
                    }`}
                  >
                    connect through Yolm MCP
                  </a>.
                </Typography>
              </section>
            </Show>
          </Show>
          <section className="flex flex-col gap-1.5">
            <div sx={mcpSettingsStyles.sectionHeader}>
              <Typography level="title-md">Your assistants</Typography>
              <Show when={sql`exists(select 1 from assistant_groups)`}>
                <Typography level="body-xs" sx={mcpSettingsStyles.muted}>
                  {sql`(select count(*) from assistant_groups)::string`}{" "}
                  connected
                </Typography>
              </Show>
            </div>
            <Show when={sql`not exists(select 1 from assistant_groups)`}>
              <div sx={mcpSettingsStyles.empty}>
                <MaterialIcon icon="SmartToy" fontSize="3xl" />
                <Typography level="title-sm" sx={mcpSettingsStyles.secondary}>
                  No assistants connected
                </Typography>
                <Typography level="body-sm">
                  Connected assistants will appear here.
                </Typography>
              </div>
            </Show>
            <Show when={sql`exists(select 1 from assistant_groups)`}>
              <div sx={[mcpSettingsStyles.list, { mt: 0.5 }]}>
                <Each table="assistant_groups" recordName="assistant_group">
                  <article sx={mcpSettingsStyles.row}>
                    <div sx={mcpSettingsStyles.avatar} aria-hidden="true">
                      <MaterialIcon icon="SmartToy" fontSize="lg" />
                    </div>
                    <div sx={mcpSettingsStyles.rowBody}>
                      <div sx={mcpSettingsStyles.rowTitle}>
                        <Typography level="title-sm">
                          {sql`assistant_group.name`}
                        </Typography>
                        {accessChip(sql`assistant_group.can_write`)}
                        <Show when={sql`assistant_group.via_gateway`}>
                          <Chip size="sm" variant="outlined" color="neutral">
                            via Yolm MCP
                          </Chip>
                        </Show>
                      </div>
                      <Typography level="body-sm" sx={mcpSettingsStyles.muted}>
                        Last used{" "}
                        {mcpRelativeTime(sql`assistant_group.last_used_at`)}
                        <Show when={sql`assistant_group.connection_count = 1`}>
                          {" · Connected "}
                          {mcpRelativeTime(
                            sql`assistant_group.latest_created_at`,
                          )}
                        </Show>
                      </Typography>
                      <Show
                        when={sql`assistant_group.connection_count > 1${
                          labels
                            ? sql` or exists(select 1 from assistant_capabilities where group_name = assistant_group.name)`
                            : sql``
                        }`}
                      >
                        <details sx={mcpSettingsStyles.details}>
                          <summary>
                            <MaterialIcon
                              icon="ChevronRight"
                              fontSize="base"
                            />
                            <Show
                              when={sql`assistant_group.connection_count > 1`}
                            >
                              {sql`assistant_group.connection_count::string`}
                              {" "}
                              connections
                              {labels ? " · " : ""}
                            </Show>
                            {labels &&
                              sql`(select count(*) from assistant_capabilities where group_name = assistant_group.name)::string || ' capabilities'`}
                          </summary>
                          <div sx={mcpSettingsStyles.detailsBody}>
                            {labels && (
                              <div sx={mcpSettingsStyles.chips}>
                                <Each
                                  table="assistant_capabilities"
                                  recordName="assistant_capability"
                                  where={sql`assistant_capability.group_name = assistant_group.name`}
                                >
                                  <Chip
                                    size="sm"
                                    variant="outlined"
                                    color="neutral"
                                  >
                                    {sql`assistant_capability.label`}
                                  </Chip>
                                </Each>
                              </div>
                            )}
                            <Show
                              when={sql`assistant_group.connection_count > 1`}
                            >
                              <div sx={mcpSettingsStyles.subList}>
                                <Each
                                  table="assistant_connections"
                                  recordName="assistant_connection"
                                  where={sql`assistant_connection.name = assistant_group.name`}
                                >
                                  <div sx={mcpSettingsStyles.subRow}>
                                    {accessChip(
                                      sql`assistant_connection.can_write`,
                                    )}
                                    <span className="flex-1 min-w-0">
                                      Connected {mcpRelativeTime(
                                        sql`assistant_connection.created_at`,
                                      )} · last used {mcpRelativeTime(
                                        sql`assistant_connection.last_used_at`,
                                      )}
                                    </span>
                                    <ActionButton
                                      size="sm"
                                      variant="plain"
                                      color="danger"
                                      confirm={{
                                        description: (
                                          <>
                                            This connection loses access
                                            immediately. Other{" "}
                                            {sql`assistant_group.name`}{" "}
                                            connections are unaffected.
                                          </>
                                        ),
                                        confirmText: "Revoke",
                                      }}
                                      action={(s) => {
                                        s.startTransaction();
                                        s.modify(
                                          sql`update db.mcp_connections set revoked_at = now() where id = assistant_connection.id and sys_user_id = current_user and surface = ${
                                            sql.lit(options.surface)
                                          }`,
                                        );
                                        s.commitTransaction();
                                      }}
                                    >
                                      Revoke
                                    </ActionButton>
                                  </div>
                                </Each>
                              </div>
                            </Show>
                          </div>
                        </details>
                      </Show>
                    </div>
                    <ActionButton
                      size="sm"
                      variant="outlined"
                      color="danger"
                      confirm={{
                        description: (
                          <>
                            <Show
                              when={sql`assistant_group.connection_count = 1`}
                            >
                              {sql`assistant_group.name`} loses access to{" "}
                              {label} immediately.
                            </Show>
                            <Show
                              when={sql`assistant_group.connection_count > 1`}
                            >
                              All{" "}
                              {sql`assistant_group.connection_count::string`}
                              {" "}
                              {sql`assistant_group.name`}{" "}
                              connections lose access to {label} immediately.
                            </Show>{" "}
                            You can reconnect from the assistant at any time.
                          </>
                        ),
                        confirmText: "Revoke",
                      }}
                      action={(s) => {
                        s.startTransaction();
                        s.modify(
                          sql`update db.mcp_connections set revoked_at = now() where sys_user_id = current_user and surface = ${
                            sql.lit(options.surface)
                          } and revoked_at is null and coalesce(gateway_client_name, (select mcp_client.name from db.mcp_clients mcp_client where mcp_client.id = mcp_connections.client_id), 'Unnamed assistant') = assistant_group.name`,
                        );
                        s.commitTransaction();
                      }}
                    >
                      <Show when={sql`assistant_group.connection_count = 1`}>
                        Revoke
                      </Show>
                      <Show when={sql`assistant_group.connection_count > 1`}>
                        Revoke all
                      </Show>
                    </ActionButton>
                  </article>
                </Each>
              </div>
            </Show>
          </section>
          {children}
        </div>
      </main>
    </Data>
  );
}
