import { Chip } from "components/chip";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import { Each, EventHandlers, Match, Show, Switch } from "std/ui";

const interactiveElementSelector = [
  `input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="color"]):not([type="image"])`,
  "textarea",
  "[contenteditable=true]",
  "[role=textbox]",
  "select",
].join(", ");

/**
 * A static action shown in the {@link CrmCommandPalette} (e.g. "New Contact").
 * Always-visible commands ranked ahead of record search results; matched by
 * fuzzy/substring search over `label`, `subtitle`, and `keywords`.
 */
export interface CrmCommandPaletteCommand {
  /** Stable identifier; used to build the palette result key. */
  id: string;
  label: string;
  /** Secondary line under the label. */
  subtitle?: string;
  /** Extra search terms (not displayed) to widen matching. */
  keywords?: string;
  /** Destination navigated to when the command is chosen. */
  href: string;
  icon: IconName;
}

/**
 * Props for {@link CrmCommandPalette}.
 */
export interface CrmCommandPaletteProps {
  /** Name of the boolean UI scalar that controls palette visibility; the
   * palette opens it on Cmd/Ctrl+K or `/` and closes it on selection/Escape. */
  openScalar: string;
  commands: CrmCommandPaletteCommand[];
  placeholder?: string;
  /** Optional hook to seed extra command-style results before the static
   * `commands`; receives the live `query` scalar expression. */
  commandsProcedure?: (s: StateStatements, query: Sql) => void;
  /** Optional hook to insert record search results (clients, contacts, etc.)
   * into `palette_result_raw`; receives the live `query` scalar expression. */
  searchProcedure?: (s: StateStatements, query: Sql) => void;
}

function resultFields() {
  return [
    {
      name: "result_key",
      type: { type: "String" as const, maxLength: 200 },
      notNull: true,
    },
    {
      name: "result_type",
      type: { type: "String" as const, maxLength: 40 },
      notNull: true,
    },
    {
      name: "label",
      type: { type: "String" as const, maxLength: 1000 },
      notNull: true,
    },
    {
      name: "subtitle",
      type: { type: "String" as const, maxLength: 1000 },
    },
    {
      name: "meta",
      type: { type: "String" as const, maxLength: 500 },
    },
    {
      name: "href",
      type: { type: "String" as const, maxLength: 1000 },
      notNull: true,
    },
    {
      name: "rank_key",
      type: { type: "BigInt" as const },
      notNull: true,
    },
  ];
}

function rowsValues(items: Sql[]): Sql {
  return sql(items.map((item) => `(${item.toSQL()})`).join(", "));
}

function commandRows(commands: CrmCommandPaletteCommand[]): Sql {
  return rowsValues(
    commands.map((command, index) =>
      sql`${sql.lit(`command:${command.id}`)}, 'command', ${
        sql.lit(command.label)
      }, ${sql.lit(command.subtitle ?? "")}, ${
        sql.lit(command.keywords ?? "")
      }, ${sql.lit(command.href)}, ${sql(String(index))}`
    ),
  );
}

function insertCommandResults(
  s: StateStatements,
  commands: CrmCommandPaletteCommand[],
) {
  if (commands.length === 0) return;
  s.modify(sql`
    insert into palette_result_raw (
      result_key,
      result_type,
      label,
      subtitle,
      meta,
      href,
      rank_key
    )
    select
      command_key,
      result_type,
      label,
      nullif(subtitle, ''),
      'Action',
      href,
      case
        when trim(query) = '' then 100000 + command_order
        else 400000 + fuzzy_rank_key(query, label || ' ' || subtitle || ' ' || keywords, null, command_order)
      end
    from (
      values ${commandRows(commands)}
    ) as command_values(command_key, result_type, label, subtitle, keywords, href, command_order)
    where trim(query) = ''
       or fuzzy_match(query, label || ' ' || subtitle || ' ' || keywords, null)
       or contains(lower(label || ' ' || subtitle || ' ' || keywords), lower(query))
  `);
}

function activateRankedResults(s: StateStatements) {
  s.modify(sql`
    insert into palette_result
    select
      result_key,
      result_type,
      label,
      subtitle,
      meta,
      href,
      rank_key,
      row_number() over (order by rank_key, label, result_key) as result_index,
      row_number() over (order by rank_key, label, result_key) = 1 as active
    from palette_result_raw
    order by rank_key, label, result_key
    limit 30
  `);
}

function moveActiveResult(s: DomStatements, direction: "next" | "previous") {
  s.event.preventDefault();
  s.returnIf(sql`not exists (select 1 from ui.palette_result)`);
  s.defScalar(
    "next_index",
    direction === "next"
      ? sql`(select result_index from ui.palette_result where active) + 1`
      : sql`(select result_index from ui.palette_result where active) - 1`,
  );
  s.modify(sql`update ui.palette_result set active = false`);
  s.conditional({
    condition:
      sql`exists (select 1 from ui.palette_result where result_index = next_index)`,
    then: (s) =>
      s.modify(
        sql`update ui.palette_result set active = true where result_index = next_index`,
      ),
    else: (s) =>
      s.modify(
        direction === "next"
          ? sql`update ui.palette_result set active = true where result_index = 1`
          : sql`update ui.palette_result set active = true where result_index = (select max(result_index) from ui.palette_result)`,
      ),
  });
}

function chooseActiveResult(s: DomStatements, closeScalar: string) {
  s.defScalar(
    "selected_href",
    sql`(select href from ui.palette_result where active)`,
  );
  s.if(sql`selected_href is not null`, (s) => {
    s.event.preventDefault();
    s.navigate(sql`selected_href`);
    s.setScalar("query", sql.lit``);
    s.setScalar(closeScalar, false);
  });
}

function makeActiveResult(s: DomStatements) {
  s.modify(sql`update ui.palette_result set active = false`);
  s.modify(
    sql`update ui.palette_result set active = true where result_key = result.result_key`,
  );
}

function closePalette(s: DomStatements, openScalar: string) {
  s.setScalar("query", sql.lit``);
  s.setScalar(openScalar, false);
}

function PaletteIcon(props: { resultType: Sql }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-divider bg-level1 text-secondary">
      <Switch>
        <Match when={sql`${props.resultType} = 'command'`}>
          <MaterialIcon icon="KeyboardCommandKey" className="text-[17px]" />
        </Match>
        <Match when={sql`${props.resultType} = 'client'`}>
          <MaterialIcon icon="Business" className="text-[17px]" />
        </Match>
        <Match when={sql`${props.resultType} = 'contact'`}>
          <MaterialIcon icon="Contacts" className="text-[17px]" />
        </Match>
        <Match when={sql`${props.resultType} = 'call'`}>
          <MaterialIcon icon="History" className="text-[17px]" />
        </Match>
        <Match when={sql`${props.resultType} = 'note'`}>
          <MaterialIcon icon="StickyNote2" className="text-[17px]" />
        </Match>
        <Match when={sql`${props.resultType} = 'task'`}>
          <MaterialIcon icon="TaskAlt" className="text-[17px]" />
        </Match>
        <Match when={sql`${props.resultType} = 'email'`}>
          <MaterialIcon icon="Mail" className="text-[17px]" />
        </Match>
        <Match when={sql`true`}>
          <MaterialIcon icon="Search" className="text-[17px]" />
        </Match>
      </Switch>
    </div>
  );
}

/**
 * Spotlight-style command palette for CRM apps. Renders a full-screen modal
 * (toggled by `openScalar`) with a search box that ranks static `commands`
 * plus any record results contributed by `searchProcedure`. Globally bound to
 * Cmd/Ctrl+K, and to `/` when focus is not in an input or editable element.
 *
 * @category UI Component
 */
export function CrmCommandPalette(props: CrmCommandPaletteProps) {
  const resultsStale =
    sql`palette_status <> 'received' or palette_query is distinct from query`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("query", sql.lit``);
      }}
    >
      <ModalDialog
        open={sql.ref(props.openScalar)}
        onClose={(s) => closePalette(s, props.openScalar)}
        layout="fullscreenOnMobile"
        className="p-0 overflow-hidden md:max-w-[720px]"
      >
        <Data
          watch={[sql`query`]}
          debounce={{ wait: 300, noWaitOnFirst: true }}
          statusScalar="palette_status"
          procedure={(s) => {
            s.defScalar("palette_query", sql`query`);
            s.defTable("palette_result_raw", { fields: resultFields() });
            s.defTable("palette_result", {
              fields: [
                ...resultFields(),
                {
                  name: "result_index",
                  type: { type: "BigInt" },
                  notNull: true,
                },
                { name: "active", type: { type: "Bool" }, notNull: true },
              ],
            });
            props.commandsProcedure?.(s, sql`query`);
            insertCommandResults(s, props.commands);
            props.searchProcedure?.(s, sql`query`);
            activateRankedResults(s);
          }}
        >
          <div className="flex h-full flex-col bg-surface">
            <div className="flex min-h-14 items-center gap-3 border-b border-divider px-4">
              <MaterialIcon icon="Search" className="text-primary" />
              <input
                className="min-w-0 flex-1 bg-transparent text-base text-primary outline-none placeholder:text-tertiary"
                placeholder={props.placeholder ??
                  "Search clients, contacts, emails, notes, tasks..."}
                value={sql`query`}
                type="text"
                spellCheck="false"
                autoComplete="off"
                autoCapitalize="off"
                yolmFocusKey
                onInput={(s) => s.setScalar("ui.query", sql`target_value`)}
                onKeyDown={(s) => {
                  s.if(sql`event.key = 'Escape'`, (s) =>
                    closePalette(s, props.openScalar));
                  s.returnIf(
                    sql`event.is_composing or event.shift_key or event.meta_key or event.alt_key or event.ctrl_key or ${resultsStale}`,
                  );
                  s.if(sql`event.key = 'Enter'`, (s) =>
                    chooseActiveResult(s, props.openScalar));
                  s.if(sql`event.key = 'ArrowDown'`, (s) =>
                    moveActiveResult(s, "next"));
                  s.if(sql`event.key = 'ArrowUp'`, (s) =>
                    moveActiveResult(s, "previous"));
                }}
              />
              <IconButton
                variant="plain"
                color="neutral"
                size="sm"
                icon="Close"
                aria-label="Close search"
                onClick={(s) =>
                  closePalette(s, props.openScalar)}
              />
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-2">
              <Show when={sql`trim(query) = ''`}>
                <div className="px-2 pb-2 pt-1">
                  <Typography level="body-xs" className="text-tertiary">
                    Start with actions, or type to search records and CRM
                    context.
                  </Typography>
                </div>
              </Show>
              <div className="space-y-1">
                <Each
                  table="palette_result"
                  recordName="result"
                  eachKey={sql`result.result_key`}
                >
                  <a
                    href={sql`case when not (${resultsStale}) then result.href end`}
                    aria-disabled={resultsStale}
                    className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-level1"
                    dynamicClassNames={[
                      {
                        condition: sql`result.active`,
                        classNames: "bg-level1",
                      },
                    ]}
                    onClick={(s) => {
                      s.if(resultsStale, (s) => {
                        s.event.preventDefault();
                        s.return();
                      });
                      closePalette(s, props.openScalar);
                    }}
                    onMouseEnter={(s) => {
                      s.returnIf(resultsStale);
                      makeActiveResult(s);
                    }}
                  >
                    <PaletteIcon resultType={sql`result.result_type`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium text-primary">
                          {sql`result.label`}
                        </div>
                        <Show when={sql`result.meta is not null`}>
                          <Chip size="sm" variant="soft">
                            {sql`result.meta`}
                          </Chip>
                        </Show>
                      </div>
                      <Show when={sql`result.subtitle is not null`}>
                        <div className="mt-0.5 line-clamp-2 text-xs text-secondary">
                          {sql`result.subtitle`}
                        </div>
                      </Show>
                    </div>
                    <MaterialIcon
                      icon="KeyboardReturn"
                      className="mt-1 text-[16px] text-tertiary"
                    />
                  </a>
                </Each>
                <Show when={sql`not exists (select 1 from palette_result)`}>
                  <div className="rounded-md border border-divider bg-surface px-4 py-8 text-center text-sm text-secondary">
                    No results.
                  </div>
                </Show>
              </div>
            </div>
            <div className="hidden items-center justify-between border-t border-divider px-4 py-2 text-xs text-tertiary sm:flex">
              <div className="flex items-center gap-3">
                <span>↑↓ Navigate</span>
                <span>Enter Open</span>
              </div>
              <span>Esc Close</span>
            </div>
          </div>
        </Data>
      </ModalDialog>
      <EventHandlers
        document={{
          keydown: (s) => {
            s.if(
              sql`event.key = 'k' and (event.ctrl_key or event.meta_key)`,
              (s) => {
                s.event.preventDefault();
                s.setScalar(props.openScalar, true);
              },
            );
            s.if(
              sql`event.key = '/' and not event.ctrl_key and not event.meta_key and not event.alt_key`,
              (s) => {
                s.event.getTarget("target");
                s.element(sql`target`).matches(
                  sql.lit(interactiveElementSelector),
                  "is_interactive",
                );
                s.returnIf(sql`is_interactive`);
                s.event.preventDefault();
                s.setScalar(props.openScalar, true);
              },
            );
          },
        }}
      />
    </Data>
  );
}
