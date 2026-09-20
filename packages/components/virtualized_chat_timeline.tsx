import { Button } from "./button";
import { IconButton } from "./icon_button";
import { Input } from "./input";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import type { Style } from "std/style_types";
import { Each, EventHandlers, Show } from "std/ui";
import type { Node } from "std/ui";

export const CHAT_TIMELINE_PAGE_SIZE = 24;
export const CHAT_TIMELINE_MINIMAP_MARKERS = 96;
const CHAT_TIMELINE_NEAR_BOTTOM_PX = 120;

export interface VirtualizedChatTimelineProps {
  /**
   * A normalized query over the complete conversation. It must select `id`,
   * `event_type`, `message_content`, and `occurred_at`. Ordering is applied by
   * the component.
   */
  sourceQuery: Sql;
  /** Defines the bounded event table and any app-specific supporting data. */
  procedure: (s: StateStatements) => void;
  /** Name of the table defined by `procedure` (default: `chat_events`). */
  eventsTable?: string;
  /** Runtime record name exposed to event content (default: `event`). */
  eventRecordName?: string;
  /**
   * Event content. The event table must expose `id`, `turn_number`, and
   * `window_token` in addition to app fields.
   */
  children: Node;
  /** Optional content rendered before each event card. */
  beforeEvent?: Node;
  /** Non-visual listeners/effects mounted with the timeline data scope. */
  head?: Node;
  /** Optional live/streaming content rendered after the bounded event rows. */
  afterEvents?: Node;
  /**
   * Marks a complete, atomically inserted event whose beginning should remain
   * visible when it is taller than the viewport. Small events still pin to the
   * live edge. This is intended for complete final chat responses, not tokens
   * or incremental work updates.
   */
  anchorTallEventStart?: Sql;
  /** Additional values that should refetch the bounded event query. */
  watch?: Sql[];
  scrollContainerId: string;
  eventIdPrefix: string;
  searchInputId?: string;
  pageSize?: number;
  minimapMarkers?: number;
  /** Disable global Ctrl/Cmd+F and Ctrl/Cmd+J handlers for secondary panes. */
  keyboardShortcuts?: boolean;
  /** Hide the turn minimap for compact channel or thread layouts. */
  showMinimap?: boolean;
  showSearchButton?: boolean;
  enableCodeCopy?: boolean;
  conversationLabel?: string | Sql;
  searchPlaceholder?: string;
  jumpLatestLabel?: Node;
  newerMessagesLabel?: Node;
  rootClassName?: string;
  rootSx?: Style;
  scrollClassName?: string;
  scrollSx?: Style;
  eventsClassName?: string;
  eventsSx?: Style;
  jumpLatestSx?: Style;
}

/** Initial positioning for a virtualized conversation. */
export interface VirtualizedChatTimelineStateOptions {
  /** Opens the initial page ending at a permalink or unread-boundary event. */
  initialWindowEndEventId?: Sql;
}

/** Defines the local UI state consumed by {@link VirtualizedChatTimeline}. */
export function defineVirtualizedChatTimelineState(
  s: StateStatements,
  options: VirtualizedChatTimelineStateOptions = {},
) {
  s.defScalar("timeline_window_end_event_id", {
    type: "BigInt",
    ...(options.initialWindowEndEventId
      ? { expr: options.initialWindowEndEventId }
      : {}),
  });
  s.defScalar("timeline_expanded_activity_turn", { type: "BigInt" });
  s.defScalar("timeline_search_open", false);
  s.defScalar("timeline_search_draft", sql.lit``);
  s.defScalar("timeline_search_query", sql.lit``);
  s.defScalar("timeline_navigation_pending", false);
  s.defScalar("timeline_navigation_target_event_id", { type: "BigInt" });
  s.defScalar("timeline_live_edge_epoch", 0);
  s.defScalar("timeline_rearm_live_edge", false);
  s.defScalar(
    "timeline_navigation_alignment",
    options.initialWindowEndEventId ? sql.lit`end` : sql.lit`center`,
  );
  s.defScalar("timeline_show_jump_latest", false);
}

/**
 * Isolates one timeline's state and resets it when a channel/thread key in
 * `watch` changes. Use separate wrappers for a main channel and thread pane.
 */
export function VirtualizedChatTimelineState(props: {
  children: Node;
  watch?: Sql[];
  initialWindowEndEventId?: Sql;
}) {
  return (
    <Data
      local
      noRefetch
      autoWatch={false}
      watch={props.watch}
      procedure={(s) =>
        defineVirtualizedChatTimelineState(s, {
          initialWindowEndEventId: props.initialWindowEndEventId,
        })}
    >
      {props.children}
    </Data>
  );
}

/** Resets a mounted timeline to the live edge after a prompt is submitted. */
export function resetVirtualizedChatTimeline(
  s: DomStatements,
  scrollContainerId: string,
) {
  s.setScalar("timeline_window_end_event_id", sql`null`);
  s.setScalar("timeline_expanded_activity_turn", sql`null`);
  s.setScalar("timeline_navigation_pending", false);
  s.setScalar("timeline_navigation_target_event_id", sql`null`);
  s.setScalar("timeline_show_jump_latest", false);
  s.increment("timeline_live_edge_epoch");
  s.setScalar("timeline_rearm_live_edge", true);
  s.element(scrollContainerId).scrollTo({ left: 0, top: sql`999999` });
}

/**
 * A server-windowed chat transcript with full-conversation navigation.
 *
 * Only one turn window is present in UI state at a time. Browser-native
 * `content-visibility` skips layout and paint work for off-screen rows within
 * that window, while `chat_viewport` keeps streaming content pinned without
 * disturbing readers who have scrolled away from the live edge.
 *
 * Call {@link defineVirtualizedChatTimelineState} in a surrounding local
 * `Data` scope. The app-specific `procedure` should define the bounded events
 * table using `timeline_window_start_event_id` and
 * `timeline_window_after_event_id`; its rows are rendered through `children`.
 */
export function VirtualizedChatTimeline(
  props: VirtualizedChatTimelineProps,
) {
  useJsModule("chat_viewport");
  const viewportHandle = sql.lit(
    `chat-viewport:${props.scrollContainerId}`,
  );
  const eventsTable = props.eventsTable ?? "chat_events";
  const eventRecordName = props.eventRecordName ?? "event";
  const pageSize = props.pageSize ?? CHAT_TIMELINE_PAGE_SIZE;
  const minimapMarkers = props.minimapMarkers ??
    CHAT_TIMELINE_MINIMAP_MARKERS;
  const searchInputId = props.searchInputId ??
    `${props.scrollContainerId}-search`;
  const jumpLatestLabel = props.jumpLatestLabel ?? "Jump to latest";
  const newerMessagesLabel = props.newerMessagesLabel ?? "Newer messages";
  const event = sql.ref(eventRecordName);

  const navigateTo = (
    s: DomStatements,
    eventId: Sql,
    alignment: "start" | "center" | "end",
  ) => {
    // Explicit navigation leaves the streaming edge. Moving the existing
    // viewport first disengages stick-to-bottom before the historical window
    // is mounted and its requested anchor is applied.
    s.element(props.scrollContainerId).scrollTo({ left: 0, top: 0 });
    s.setScalar("timeline_show_jump_latest", true);
    s.setScalar("timeline_navigation_pending", true);
    s.setScalar("timeline_navigation_alignment", sql.lit(alignment));
    s.setScalar("timeline_navigation_target_event_id", eventId);
    s.setScalar("timeline_window_end_event_id", eventId);
    s.setScalar("timeline_expanded_activity_turn", sql`null`);
    s.refetch();
  };

  const jumpToLatest = (s: DomStatements) => {
    resetVirtualizedChatTimeline(s, props.scrollContainerId);
    s.refetch();
  };

  const closeSearch = (s: DomStatements) => {
    s.setScalar("timeline_search_open", false);
    s.element(props.scrollContainerId).focus();
  };

  return (
    <div
      className={props.rootClassName}
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        ...props.rootSx,
      }}
      onMount={(s) => {
        s.jsCall({
          module: "chat_viewport",
          exportName: "init",
          handle: viewportHandle,
          argJson: sql`json_build_object(
            'handle', ${viewportHandle},
            'scrollContainerId', ${sql.lit(props.scrollContainerId)},
            'codeCopy', ${props.enableCodeCopy !== false})`,
        });
      }}
      js={{
        handles: [{
          module: "chat_viewport",
          cleanup: "cleanup",
          handle: viewportHandle,
        }],
        on: {},
      }}
    >
      {props.keyboardShortcuts !== false && (
        <EventHandlers
          document={{
            keydown: (s) => {
              s.if(
                sql`(event.ctrl_key or event.meta_key) and lower(event.key) = 'f'`,
                (s) => {
                  s.event.preventDefault();
                  s.setScalar("timeline_search_open", true);
                },
              );
              s.if(
                sql`(event.ctrl_key or event.meta_key) and lower(event.key) = 'j'`,
                (s) => {
                  s.event.preventDefault();
                  jumpToLatest(s);
                },
              );
              s.if(
                sql`event.key = 'Escape' and timeline_search_open`,
                closeSearch,
              );
            },
          }}
        />
      )}
      <Data
        watch={[
          sql`timeline_window_end_event_id`,
          sql`timeline_expanded_activity_turn`,
          sql`timeline_search_query`,
          sql`timeline_live_edge_epoch`,
          ...(props.watch ?? []),
        ]}
        procedure={(s) => {
          s.defScalar(
            "timeline_total_turns",
            sql`(select count(*) from (${props.sourceQuery}) source
              where source.event_type = 'user_message')`,
          );
          s.defScalar(
            "timeline_window_target_turn",
            sql`case
              when timeline_total_turns = 0 then 0
              when timeline_window_end_event_id is null then timeline_total_turns
              else coalesce((select numbered.turn_number from (
                select source.id,
                  row_number() over (order by source.occurred_at, source.id)
                    as turn_number
                from (${props.sourceQuery}) source
                where source.event_type = 'user_message'
              ) numbered
              where numbered.id = timeline_window_end_event_id),
                timeline_total_turns)
            end`,
          );
          s.defScalar(
            "timeline_window_end_turn",
            sql`case
              when timeline_window_end_event_id is not null
                and timeline_navigation_alignment = 'center'
              then least(
                timeline_total_turns,
                timeline_window_target_turn + ${Math.floor(pageSize / 2)}
              )
              else timeline_window_target_turn
            end`,
          );
          s.defScalar(
            "timeline_window_start_turn",
            sql`greatest(1, timeline_window_end_turn - ${pageSize - 1})`,
          );
          s.defRecord(
            "timeline_window_boundaries",
            sql`select
                max(case when turn_number = timeline_window_start_turn
                  then id end) as start_event_id,
                max(case when turn_number = timeline_window_end_turn + 1
                  then id end) as after_event_id,
                max(case when turn_number = timeline_window_end_turn
                  then id end) as end_event_id,
                max(case when turn_number = least(
                  timeline_total_turns, timeline_window_end_turn + ${
              pageSize - 1
            }
                ) then id end) as next_end_event_id
              from (
                select source.id,
                  row_number() over (order by source.occurred_at, source.id)
                    as turn_number
                from (${props.sourceQuery}) source
                where source.event_type = 'user_message'
              ) turn`,
          );
          s.defScalar(
            "timeline_window_start_event_id",
            sql`timeline_window_boundaries.start_event_id`,
          );
          s.defScalar(
            "timeline_window_after_event_id",
            sql`timeline_window_boundaries.after_event_id`,
          );
          s.defScalar(
            "timeline_window_end_boundary_event_id",
            sql`timeline_window_boundaries.end_event_id`,
          );
          s.defScalar(
            "timeline_next_window_end_event_id",
            sql`timeline_window_boundaries.next_end_event_id`,
          );
          if (props.showMinimap !== false) {
            s.defTable(
              "timeline_minimap_turns",
              sql`with turns as (
                select source.id, source.occurred_at, source.message_content,
                  row_number() over (order by source.occurred_at, source.id)
                    as turn_number,
                  count(*) over () as total_turns
                from (${props.sourceQuery}) source
                where source.event_type = 'user_message'
              ), sampled as (
                select *, greatest(1,
                  (total_turns + ${minimapMarkers - 1}) / ${minimapMarkers})
                    as sample_stride
                from turns
              )
              select id, occurred_at, message_content, turn_number, total_turns,
                turn_number between timeline_window_start_turn
                  and timeline_window_end_turn as in_window
              from sampled
              where mod(turn_number - 1, sample_stride) = 0
                or turn_number in (
                  timeline_window_start_turn,
                  timeline_window_end_turn,
                  total_turns
                )
              order by turn_number`,
            );
          }
          s.defTable(
            "timeline_search_results",
            sql`with numbered as (
                select source.id, source.event_type, source.message_content,
                  source.occurred_at,
                  sum(case when source.event_type = 'user_message'
                    then 1 else 0 end) over (
                      order by source.occurred_at, source.id
                      rows between unbounded preceding and current row
                    ) as turn_number
                from (${props.sourceQuery}) source
              )
              select
                min(case when event_type = 'user_message' then id end) as id,
                turn_number,
                max(occurred_at) as occurred_at,
                max(case when event_type = 'user_message'
                  then left(replace(coalesce(message_content, ''), chr(10), ' '), 180)
                  else null end) as prompt,
                max(case when contains(
                    lower(coalesce(message_content, '')),
                    lower(timeline_search_query)
                  ) then left(replace(coalesce(message_content, ''), chr(10), ' '), 180)
                  else null end) as matched_text
              from numbered
              where timeline_search_query != '' and turn_number > 0
              group by turn_number
              having max(case when contains(
                lower(coalesce(message_content, '')),
                lower(timeline_search_query)
              ) then 1 else 0 end) = 1
              order by turn_number desc
              limit 30`,
          );
          s.defTable(
            "timeline_window_mounts",
            sql`select coalesce(
              timeline_window_end_event_id::string,
              'tail'
            ) || ':' || timeline_live_edge_epoch::string as token`,
          );
          props.procedure(s);
        }}
      >
        {props.head}
        {props.showSearchButton !== false && (
          <div
            sx={{
              position: "absolute",
              right: "0.75rem",
              top: "0.5rem",
              zIndex: 30,
            }}
          >
            <IconButton
              icon="Search"
              variant="soft"
              color="neutral"
              size="sm"
              aria-label="Search conversation"
              aria-controls={`${searchInputId}-panel`}
              aria-expanded={sql`timeline_search_open`}
              onClick={(s) => s.setScalar("timeline_search_open", true)}
            />
          </div>
        )}
        <Show when={sql`timeline_search_open`}>
          <div
            id={`${searchInputId}-panel`}
            role="search"
            aria-label="Search conversation"
            sx={{
              position: "absolute",
              right: "0.75rem",
              top: "3rem",
              zIndex: 40,
              width: "min(26rem, calc(100% - 1.5rem))",
              maxHeight: "min(32rem, 70vh)",
              overflow: "hidden",
              borderRadius: "lg",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "surface",
              boxShadow: "lg",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              sx={{
                p: 1,
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Input
                id={searchInputId}
                autoFocus
                onMount={(s) => s.element(sql.lit(searchInputId)).focus()}
                placeholder={props.searchPlaceholder ??
                  "Search this conversation"}
                value={sql`timeline_search_draft`}
                onInput={(s) =>
                  s.setScalar("timeline_search_draft", sql`target_value`)}
                onKeyDown={(s) => {
                  s.if(sql`event.key = 'Enter'`, (s) => {
                    s.event.preventDefault();
                    s.setScalar(
                      "timeline_search_query",
                      sql`trim(timeline_search_draft)`,
                    );
                    s.refetch();
                  });
                }}
              />
              <IconButton
                icon="Search"
                variant="solid"
                color="primary"
                size="sm"
                aria-label="Run conversation search"
                onClick={(s) => {
                  s.setScalar(
                    "timeline_search_query",
                    sql`trim(timeline_search_draft)`,
                  );
                  s.refetch();
                }}
              />
              <IconButton
                icon="Close"
                variant="plain"
                color="neutral"
                size="sm"
                aria-label="Close conversation search"
                onClick={closeSearch}
              />
            </div>
            <div sx={{ overflowY: "auto", p: 0.5 }}>
              <Show
                when={sql`timeline_search_query != ''`}
                fallback={
                  <div
                    sx={{
                      px: 1.5,
                      py: 3,
                      fontSize: "sm",
                      color: "text-tertiary",
                      textAlign: "center",
                    }}
                  >
                    Search prompts, answers, and agent activity. Press Enter to
                    run the search.
                  </div>
                }
              >
                <Show
                  when={sql`(select count(*) from timeline_search_results) > 0`}
                  fallback={
                    <div
                      sx={{
                        px: 1.5,
                        py: 3,
                        fontSize: "sm",
                        color: "text-tertiary",
                        textAlign: "center",
                      }}
                    >
                      No matching turns
                    </div>
                  }
                >
                  <Each
                    table="timeline_search_results"
                    recordName="search_result"
                    eachKey={sql`id`}
                  >
                    <button
                      type="button"
                      sx={{
                        width: "100%",
                        textAlign: "left",
                        px: 1.5,
                        py: 1,
                        borderRadius: "md",
                        border: 0,
                        bgcolor: "transparent",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        "&:hover": { bgcolor: "background-body" },
                      }}
                      onClick={(s) => {
                        navigateTo(s, sql`search_result.id`, "center");
                        closeSearch(s);
                      }}
                    >
                      <span
                        sx={{
                          fontSize: "xs",
                          fontWeight: "medium",
                          color: "text-tertiary",
                          mb: 0.25,
                        }}
                      >
                        Turn {sql`search_result.turn_number`} of{" "}
                        {sql`timeline_total_turns`}
                      </span>
                      <span
                        sx={{
                          fontSize: "sm",
                          color: "text-primary",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {sql`coalesce(search_result.matched_text, search_result.prompt)`}
                      </span>
                    </button>
                  </Each>
                </Show>
              </Show>
            </div>
          </div>
        </Show>
        {props.showMinimap !== false && (
          <Show when={sql`timeline_total_turns > ${pageSize}`}>
            <nav
              aria-hidden="true"
              sx={{
                display: "none",
                position: "absolute",
                right: "0.375rem",
                top: "3.5rem",
                bottom: "7rem",
                zIndex: 20,
                width: "1.25rem",
                flexDirection: "column",
                justifyContent: "center",
                gap: "1px",
                alignItems: "flex-end",
                xl: { display: "flex" },
              }}
            >
              <Each
                table="timeline_minimap_turns"
                recordName="nav_turn"
                eachKey={sql`id`}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="timeline-minimap-marker"
                  title={sql`'Turn ' || nav_turn.turn_number || ': ' || left(coalesce(nav_turn.message_content, ''), 80)`}
                  sx={{
                    width: "20px",
                    height: "6px",
                    minHeight: "6px",
                    border: 0,
                    p: 0,
                    bgcolor: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                  }}
                  onClick={(s) =>
                    navigateTo(s, sql`nav_turn.id`, "center")}
                >
                  <span
                    sx={{
                      height: "2px",
                      borderRadius: "999px",
                      transition: "width 120ms ease",
                    }}
                    style={{
                      width:
                        sql`case when nav_turn.in_window then '16px' else '8px' end`,
                      opacity:
                        sql`case when nav_turn.in_window then '1' else '0.55' end`,
                      backgroundColor:
                        sql`case when nav_turn.in_window then 'var(--palette-primary-500)' else 'var(--palette-neutral-400)' end`,
                    }}
                  />
                </button>
              </Each>
            </nav>
          </Show>
        )}
        <div
          id={props.scrollContainerId}
          role="log"
          aria-label={props.conversationLabel ?? "Conversation messages"}
          aria-live={sql`case
            when timeline_window_end_turn = timeline_total_turns then 'polite'
            else 'off'
          end`}
          aria-relevant="additions text"
          tabIndex={0}
          data-chat-total-turns={sql`timeline_total_turns::string`}
          data-chat-window-start={sql`timeline_window_start_turn::string`}
          data-chat-window-end={sql`timeline_window_end_turn::string`}
          data-chat-navigation-pending={sql`timeline_navigation_pending::string`}
          data-chat-navigation-alignment={sql`timeline_navigation_alignment`}
          className={props.scrollClassName}
          sx={{
            flexGrow: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            touchAction: "pan-y",
            position: "relative",
            ...props.scrollSx,
          }}
          onScroll={(s) => {
            const scrollElement = s.element(props.scrollContainerId);
            scrollElement.getScrollTop("chat_timeline_scroll_top");
            scrollElement.getScrollHeight("chat_timeline_scroll_height");
            scrollElement.getBoundingClientRect("chat_timeline_client_rect");
            s.setScalar(
              "timeline_show_jump_latest",
              sql`timeline_window_end_event_id is not null
                or chat_timeline_scroll_height - chat_timeline_scroll_top
                  - chat_timeline_client_rect.height > ${CHAT_TIMELINE_NEAR_BOTTOM_PX}`,
            );
          }}
        >
          <Show when={sql`timeline_window_start_turn > 1`}>
            <div
              sx={{ display: "flex", justifyContent: "center", pb: 1.5 }}
            >
              <Button
                variant="soft"
                color="neutral"
                size="sm"
                startIcon="ArrowUpward"
                onClick={(s) =>
                  navigateTo(s, sql`timeline_window_start_event_id`, "end")}
              >
                Earlier messages · turns {sql`timeline_window_start_turn`}–
                {sql`timeline_window_end_turn`}
              </Button>
            </div>
          </Show>
          <div
            className={props.eventsClassName}
            sx={{ display: "flex", flexDirection: "column", ...props.eventsSx }}
          >
            <Each
              table={eventsTable}
              recordName={eventRecordName}
              eachKey={sql`${event}.id::string || ':' || ${event}.window_token`}
            >
              <div
                data-chat-event-id={sql`${event}.id::string`}
                data-chat-turn={sql`${event}.turn_number::string`}
                data-chat-anchor-tall-start={props.anchorTallEventStart
                  ? sql`case when ${props.anchorTallEventStart} then 'true' else null end`
                  : undefined}
                id={sql`${sql.lit(props.eventIdPrefix)} || ${event}.id`}
                style={{
                  "content-visibility": "auto",
                  "contain-intrinsic-size": "auto 120px",
                }}
              >
                {props.beforeEvent}
                {props.children}
              </div>
            </Each>
            <Each
              table="timeline_window_mounts"
              recordName="timeline_window_mount"
              eachKey={sql`token`}
            >
              <span
                aria-hidden="true"
                sx={{ display: "none" }}
                onMount={(s) => {
                  s.if(sql`timeline_rearm_live_edge`, (s) => {
                    // An explicit return to the tail can race with the
                    // historical-window refetch. Re-arm after this bounded
                    // window is mounted so subsequent streaming growth stays
                    // pinned instead of inheriting the reader-away state.
                    s.sleep(50);
                    s.jsCall({
                      module: "chat_viewport",
                      exportName: "cleanup",
                      handle: viewportHandle,
                      argJson:
                        sql`json_build_object('handle', ${viewportHandle})`,
                    });
                    s.jsCall({
                      module: "chat_viewport",
                      exportName: "init",
                      handle: viewportHandle,
                      argJson: sql`json_build_object(
                        'handle', ${viewportHandle},
                        'scrollContainerId', ${
                        sql.lit(props.scrollContainerId)
                      },
                        'codeCopy', ${props.enableCodeCopy !== false}
                      )`,
                    });
                    s.element(props.scrollContainerId).scrollTo({
                      left: 0,
                      top: sql`999999`,
                    });
                    s.setScalar("timeline_rearm_live_edge", false);
                  });
                  s.if(sql`timeline_navigation_pending`, (s) => {
                    // The streaming module reconciles DOM growth across two
                    // animation frames. Apply explicit history navigation
                    // afterward so the requested anchor is the final scroll.
                    s.sleep(50);
                    s.element(
                      sql`${
                        sql.lit(props.eventIdPrefix)
                      } || timeline_navigation_target_event_id`,
                    ).scrollIntoView({
                      behavior: sql.lit`auto`,
                      block: sql`timeline_navigation_alignment`,
                      inline: sql.lit`nearest`,
                    });
                    s.setScalar("timeline_navigation_pending", false);
                    s.setScalar(
                      "timeline_navigation_target_event_id",
                      sql`null`,
                    );
                  });
                }}
              />
            </Each>
            <Show when={sql`timeline_window_end_turn = timeline_total_turns`}>
              {props.afterEvents}
            </Show>
            <Show when={sql`timeline_window_end_turn < timeline_total_turns`}>
              <div
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  pt: 3,
                }}
              >
                <Button
                  variant="soft"
                  color="neutral"
                  size="sm"
                  endIcon="ArrowDownward"
                  onClick={(s) => {
                    s.setScalar("timeline_show_jump_latest", true);
                    s.setScalar("timeline_navigation_pending", true);
                    s.setScalar(
                      "timeline_navigation_alignment",
                      sql.lit`start`,
                    );
                    s.setScalar(
                      "timeline_navigation_target_event_id",
                      sql`timeline_window_end_boundary_event_id`,
                    );
                    s.setScalar(
                      "timeline_window_end_event_id",
                      sql`case
                        when timeline_window_end_turn + ${pageSize - 1}
                          >= timeline_total_turns then null
                        else timeline_next_window_end_event_id
                      end`,
                    );
                    s.setScalar("timeline_expanded_activity_turn", sql`null`);
                    s.refetch();
                  }}
                >
                  {newerMessagesLabel}
                </Button>
              </div>
            </Show>
          </div>
        </div>
        <Show when={sql`timeline_show_jump_latest`}>
          <div
            sx={{
              position: "absolute",
              left: "50%",
              bottom: "1rem",
              zIndex: 30,
              transform: "translateX(-50%)",
              ...props.jumpLatestSx,
            }}
          >
            <Button
              variant="solid"
              color="neutral"
              size="sm"
              startIcon="ArrowDownward"
              onClick={jumpToLatest}
            >
              {jumpLatestLabel}
            </Button>
          </div>
        </Show>
      </Data>
    </div>
  );
}
