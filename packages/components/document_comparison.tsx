import { Alert } from "./alert";
import { Button } from "./button";
import { IconButton } from "./icon_button";
import {
  lexicalDocumentDisplayStyles,
  LexicalRichTextDisplay,
} from "./lexical/components/lexical_editor";
import { Tabs } from "./tabs";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { createStyles, cssVar } from "std/style_utils";
import type { Style } from "std/style_types";
import type { DomStatements } from "std/statements";
import { Each, Effect, Match, Show, Switch, useUniqueId } from "std/ui";

const MAX_CHANGE_CARDS = 250;

export interface DocumentComparisonProps {
  /** Earlier Lexical document. Null means there is no earlier version. */
  previousDocument: Sql;
  /** Later Lexical document being presented for comparison. */
  currentDocument: Sql;
  /** Human-readable description of the earlier version. */
  previousLabel?: Sql | string;
  /** Human-readable description of the later version. */
  currentLabel?: Sql | string;
  /** Optional review-header eyebrow. */
  kicker?: Sql | string;
  /** Optional review heading. */
  title?: Sql | string;
  /** Optional explanation shown below the review heading. */
  subtitle?: Sql | string;
  className?: string;
  sx?: Style;
}

const styles = createStyles({
  root: {
    color: cssVar("palette-text-primary"),
    backgroundColor: cssVar("palette-background-surface"),
  },
  changeCard: {
    scrollMarginTop: "92px",
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-md"),
    backgroundColor: cssVar("palette-background-surface"),
    overflow: "hidden",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    "&[data-active='true']": {
      borderColor: cssVar("palette-primary-500"),
      boxShadow:
        "0 0 0 3px color-mix(in srgb, var(--palette-primary-500) 16%, transparent)",
    },
  },
  inline: {
    margin: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    "& del, & ins": {
      padding: "1px 2px",
      borderRadius: "3px",
      textDecorationThickness: "2px",
      textUnderlineOffset: "2px",
    },
    "& del": {
      color: cssVar("palette-danger-700"),
      backgroundColor: "var(--palette-danger-soft-bg)",
      textDecorationLine: "line-through",
    },
    "& ins": {
      color: cssVar("palette-primary-700"),
      backgroundColor: "var(--palette-primary-soft-bg)",
      textDecorationLine: "underline",
    },
    "& del + ins": {
      marginLeft: "0.25em",
    },
  },
  document: {
    ...lexicalDocumentDisplayStyles,
    color: cssVar("palette-text-primary"),
    "& > :first-child": { marginTop: 0 },
    "& > :last-child": { marginBottom: 0 },
  },
  versionPanel: {
    minWidth: 0,
    padding: "11px 12px",
    border: `1px solid ${cssVar("palette-divider")}`,
    borderRadius: cssVar("radius-sm"),
    overflowWrap: "anywhere",
    "&[data-version='before']": {
      borderLeft: `3px solid ${cssVar("palette-danger-500")}`,
      backgroundColor: "var(--palette-danger-soft-bg)",
    },
    "&[data-version='after']": {
      borderLeft: `3px solid ${cssVar("palette-primary-500")}`,
      backgroundColor: "var(--palette-primary-soft-bg)",
    },
  },
  redlineChange: {
    "&[data-changed='true']": {
      position: "relative",
      marginLeft: "-14px",
      paddingLeft: "11px",
      borderLeft:
        "3px solid color-mix(in srgb, var(--palette-primary-500) 42%, var(--palette-divider))",
      scrollMarginTop: "92px",
    },
    "&[data-changed='true'][data-active='true']": {
      borderLeftColor: cssVar("palette-primary-600"),
    },
  },
  passageMark: {
    display: "block",
    textDecorationThickness: "2px",
    textUnderlineOffset: "2px",
    "&[data-kind='removed']": {
      color: cssVar("palette-danger-700"),
      backgroundColor: "var(--palette-danger-soft-bg)",
      textDecorationLine: "line-through",
    },
    "&[data-kind='added']": {
      color: cssVar("palette-primary-700"),
      backgroundColor: "var(--palette-primary-soft-bg)",
      textDecorationLine: "underline",
    },
  },
});

function lexicalNodeDocument(node: Sql) {
  return sql`json_build_object(
    'root', json_build_object(
      'type', 'root',
      'version', 1,
      'children', json_build_array(${node}),
      'direction', null,
      'format', '',
      'indent', 0
    )
  )`;
}

function stringSql(value: Sql | string | undefined, fallback: string) {
  if (value === undefined) return sql.lit(fallback);
  return typeof value === "string" ? sql.lit(value) : value;
}

function InlineOperations({ operations }: { operations: Sql }) {
  return (
    <Data
      local
      noRefetch
      watch={[operations]}
      procedure={(s) => {
        s.defTable(
          "document_comparison_operations",
          sql`
            select
              row.index as operation_index,
              row.value->>'kind' as kind,
              coalesce(row.value->>'text', '') as text,
              case
                when row.value->>'kind' = 'omitted' then ''
                else lexical_process_inline_node(
                  json_build_object(
                    'type', 'text',
                    'version', 1,
                    'text', coalesce(row.value->>'text', ''),
                    'format', coalesce(
                      try_cast(row.value->>'format' as bigint),
                      0
                    ),
                    'style', coalesce(row.value->>'style', ''),
                    'detail', 0,
                    'mode', 'normal'
                  ),
                  null,
                  null
                )
              end as html
            from json.array_each(
              coalesce(${operations}, json_build_array())
            ) row
            order by row.index
          `,
        );
      }}
    >
      <Each
        table="document_comparison_operations"
        recordName="comparison_operation"
      >
        <Show when={sql`comparison_operation.kind = 'unchanged'`}>
          <span dangerouslySetInnerHTML={sql`comparison_operation.html`} />
        </Show>
        <Show when={sql`comparison_operation.kind = 'removed'`}>
          <del aria-label="Removed text">
            <span dangerouslySetInnerHTML={sql`comparison_operation.html`} />
          </del>
        </Show>
        <Show when={sql`comparison_operation.kind = 'added'`}>
          <ins aria-label="Added text">
            <span dangerouslySetInnerHTML={sql`comparison_operation.html`} />
          </ins>
        </Show>
        <Show when={sql`comparison_operation.kind = 'omitted'`}>
          <span
            className="px-1 font-bold text-secondary"
            aria-label="Unchanged text omitted"
            title="Unchanged text omitted"
          >
            {sql`comparison_operation.text`}
          </span>
        </Show>
      </Each>
    </Data>
  );
}

function VersionPanel(props: {
  version: "before" | "after";
  label: Sql;
  html: Sql;
}) {
  return (
    <div sx={styles.versionPanel} data-version={props.version}>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
        {props.label}
      </div>
      <div dangerouslySetInnerHTML={props.html} />
    </div>
  );
}

function ChangeCard(props: {
  handle: Sql;
  previousLabel: Sql;
  currentLabel: Sql;
}) {
  const change = sql`comparison_change`;
  return (
    <article
      id={sql`${props.handle} || '-change-' || cast(${change}.change_index as string)`}
      sx={styles.changeCard}
      data-layout={sql`case when ${change}.operations is null then 'stacked' else 'inline' end`}
      data-active={sql`${change}.change_index = document_comparison_active_change`}
      aria-current={sql`${change}.change_index = document_comparison_active_change`}
      aria-label={sql`${change}.title || ': ' || ${change}.kind_label`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-divider bg-level1 px-3 py-2.5">
        <h3 className="min-w-0 text-[13px] font-semibold">
          {sql`${change}.title`}
        </h3>
        <span className="shrink-0 rounded-full bg-level2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
          {sql`${change}.kind_label`}
        </span>
      </div>
      <div className="p-3 text-[15px] leading-relaxed sm:p-4">
        <Show
          when={sql`${change}.operations is not null`}
          fallback={
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionPanel
                version="before"
                label={props.previousLabel}
                html={sql`${change}.before_html`}
              />
              <VersionPanel
                version="after"
                label={props.currentLabel}
                html={sql`${change}.after_html`}
              />
            </div>
          }
        >
          <p sx={styles.inline}>
            <InlineOperations operations={sql`${change}.operations`} />
          </p>
          <Show when={sql`${change}.formatting_changed`}>
            <p className="mt-2 text-xs text-secondary">
              Formatting also changed; marked text retains the typography from
              its document version.
            </p>
          </Show>
        </Show>
      </div>
    </article>
  );
}

function InlineRedlineBlock({ block }: { block: Sql }) {
  const content = <InlineOperations operations={sql`${block}.operations`} />;
  return (
    <Switch>
      <Match when={sql`${block}.tag = 'h1'`}>
        <h1 sx={styles.inline}>{content}</h1>
      </Match>
      <Match when={sql`${block}.tag = 'h2'`}>
        <h2 sx={styles.inline}>{content}</h2>
      </Match>
      <Match when={sql`${block}.tag = 'h3'`}>
        <h3 sx={styles.inline}>{content}</h3>
      </Match>
      <Match when={sql`${block}.tag = 'h4'`}>
        <h4 sx={styles.inline}>{content}</h4>
      </Match>
      <Match when={sql`${block}.tag = 'h5'`}>
        <h5 sx={styles.inline}>{content}</h5>
      </Match>
      <Match when={sql`${block}.tag = 'h6'`}>
        <h6 sx={styles.inline}>{content}</h6>
      </Match>
      <Match when={sql`${block}.tag = 'blockquote'`}>
        <blockquote sx={styles.inline}>{content}</blockquote>
      </Match>
      <Match when={sql.true}>
        <p sx={styles.inline}>{content}</p>
      </Match>
    </Switch>
  );
}

function RedlineBlockContent(props: {
  previousLabel: Sql;
  currentLabel: Sql;
}) {
  const block = sql`comparison_redline_block`;
  return (
    <Switch>
      <Match when={sql`${block}.layout = 'document'`}>
        <div dangerouslySetInnerHTML={sql`${block}.html`} />
      </Match>
      <Match when={sql`${block}.layout = 'inline'`}>
        <InlineRedlineBlock block={block} />
      </Match>
      <Match when={sql`${block}.layout = 'added'`}>
        <ins
          sx={styles.passageMark}
          data-kind="added"
          aria-label="Added passage"
        >
          <div dangerouslySetInnerHTML={sql`${block}.after_html`} />
        </ins>
      </Match>
      <Match when={sql`${block}.layout = 'removed'`}>
        <del
          sx={styles.passageMark}
          data-kind="removed"
          aria-label="Removed passage"
        >
          <div dangerouslySetInnerHTML={sql`${block}.before_html`} />
        </del>
      </Match>
      <Match when={sql`${block}.layout = 'replacement'`}>
        <div className="grid gap-1.5">
          <VersionPanel
            version="before"
            label={props.previousLabel}
            html={sql`${block}.before_html`}
          />
          <VersionPanel
            version="after"
            label={props.currentLabel}
            html={sql`${block}.after_html`}
          />
        </div>
      </Match>
    </Switch>
  );
}

function RedlineBlock(props: {
  handle: Sql;
  previousLabel: Sql;
  currentLabel: Sql;
}) {
  const block = sql`comparison_redline_block`;
  const changed = sql`${block}.change_index is not null`;
  return (
    <Show
      when={changed}
      fallback={
        <div>
          <RedlineBlockContent
            previousLabel={props.previousLabel}
            currentLabel={props.currentLabel}
          />
        </div>
      }
    >
      <div
        id={sql`${props.handle} || '-change-' || cast(${block}.change_index as string)`}
        sx={styles.redlineChange}
        data-changed="true"
        data-active={sql`${block}.change_index = document_comparison_active_change`}
        aria-current={sql`${block}.change_index = document_comparison_active_change`}
        data-change-kind={sql`${block}.kind`}
      >
        <RedlineBlockContent
          previousLabel={props.previousLabel}
          currentLabel={props.currentLabel}
        />
      </div>
    </Show>
  );
}

function ChangesOnly(props: {
  handle: Sql;
  previousLabel: Sql;
  currentLabel: Sql;
  currentDocument: Sql;
}) {
  return (
    <Data
      local
      noRefetch
      watch={[sql`document_comparison_result`]}
      procedure={(s) => {
        s.defTable(
          "document_comparison_changes",
          sql`
            select
              cast(row.value->>'index' as bigint) as change_index,
              row.value->>'kind' as kind,
              row.value->>'kindLabel' as kind_label,
              row.value->>'title' as title,
              row.value->>'tag' as tag,
              coalesce(
                row.value->>'formattingChanged' = 'true',
                false
              ) as formatting_changed,
              row.value->'operations' as operations,
              case when row.value->'beforeNode' is null then '' else lexical_rich_text_to_html(${
            lexicalNodeDocument(sql`row.value->'beforeNode'`)
          }) end as before_html,
              case when row.value->'afterNode' is null then '' else lexical_rich_text_to_html(${
            lexicalNodeDocument(sql`row.value->'afterNode'`)
          }) end as after_html
            from json.array_each(
              coalesce(
                document_comparison_result->'changes',
                json_build_array()
              )
            ) row
            order by cast(row.value->>'index' as bigint)
          `,
        );
      }}
    >
      <Show
        when={sql`document_comparison_change_count = 0`}
        fallback={
          <Show
            when={sql`document_comparison_change_count <= ${MAX_CHANGE_CARDS}`}
            fallback={
              <div className="mx-auto mb-4 max-w-[820px] rounded-md border border-divider bg-level1 px-4 py-3 text-sm leading-relaxed text-secondary">
                <strong className="text-primary">
                  This document has many changes.
                </strong>{" "}
                Use Full redline to review every change in document context.
              </div>
            }
          >
            <div className="mx-auto grid max-w-[900px] gap-3.5">
              <Each
                table="document_comparison_changes"
                recordName="comparison_change"
              >
                <ChangeCard
                  handle={props.handle}
                  previousLabel={props.previousLabel}
                  currentLabel={props.currentLabel}
                />
              </Each>
            </div>
          </Show>
        }
      >
        <div className="mx-auto mb-4 max-w-[820px] rounded-md border border-divider bg-level1 px-4 py-3 text-sm leading-relaxed text-secondary">
          <strong className="text-primary">No content changes found.</strong>
          {" "}
          The two document versions match.
        </div>
        <LexicalRichTextDisplay
          value={props.currentDocument}
          sx={styles.document}
        />
      </Show>
    </Data>
  );
}

function FullRedline(props: {
  handle: Sql;
  previousLabel: Sql;
  currentLabel: Sql;
}) {
  return (
    <Data
      local
      noRefetch
      watch={[sql`document_comparison_result`]}
      procedure={(s) => {
        s.defTable(
          "document_comparison_redline",
          sql`
            select
              cast(row.value->>'index' as bigint) as block_index,
              try_cast(row.value->>'changeIndex' as bigint) as change_index,
              row.value->>'kind' as kind,
              row.value->>'layout' as layout,
              row.value->>'tag' as tag,
              row.value->'operations' as operations,
              case when row.value->'node' is null then '' else lexical_rich_text_to_html(${
            lexicalNodeDocument(sql`row.value->'node'`)
          }) end as html,
              case when row.value->'beforeNode' is null then '' else lexical_rich_text_to_html(${
            lexicalNodeDocument(sql`row.value->'beforeNode'`)
          }) end as before_html,
              case when row.value->'afterNode' is null then '' else lexical_rich_text_to_html(${
            lexicalNodeDocument(sql`row.value->'afterNode'`)
          }) end as after_html
            from json.array_each(
              coalesce(
                document_comparison_result->'redline',
                json_build_array()
              )
            ) row
            order by cast(row.value->>'index' as bigint)
          `,
        );
      }}
    >
      <div sx={styles.document}>
        <Each
          table="document_comparison_redline"
          recordName="comparison_redline_block"
        >
          <RedlineBlock
            handle={props.handle}
            previousLabel={props.previousLabel}
            currentLabel={props.currentLabel}
          />
        </Each>
      </div>
    </Data>
  );
}

/**
 * Compares two Lexical JSON business documents without exposing source diff
 * syntax. Yolm owns presentation; the browser module returns structured nodes
 * and token operations only.
 */
export function DocumentComparison(props: DocumentComparisonProps) {
  useJsModule("document_comparison");
  const id = useUniqueId();
  const handle = sql.concat(id, sql.lit`-document-comparison`);
  const hasPrevious = sql`${props.previousDocument} is not null`;
  const previousLabel = stringSql(props.previousLabel, "Previous version");
  const currentLabel = stringSql(props.currentLabel, "Current version");
  const kicker = sql`coalesce(
    nullif(${stringSql(props.kicker, "")}, ''),
    case when ${hasPrevious} then 'Version review' else 'Approval review' end
  )`;
  const title = sql`coalesce(
    nullif(${stringSql(props.title, "")}, ''),
    case
      when ${hasPrevious} then 'Review what changed'
      else 'Review the complete document'
    end
  )`;
  const subtitle = sql`coalesce(
    nullif(${stringSql(props.subtitle, "")}, ''),
    case
      when ${hasPrevious}
        then 'Changes are shown in context against the last approved version.'
      else 'This document has no previously approved version, so the complete submission is shown.'
    end
  )`;

  const initialize = (s: DomStatements) => {
    s.setScalar("document_comparison_status", sql.lit`loading`);
    s.setScalar("document_comparison_error", sql.null);
    s.commitUiTreeChanges();
    s.jsCall({
      module: "document_comparison",
      exportName: "initialize",
      handle,
      argJson: sql`json_build_object(
        'handle', ${handle},
        'previousDocument', ${props.previousDocument},
        'currentDocument', ${props.currentDocument}
      )`,
    });
  };

  const refresh = (s: DomStatements) => {
    s.if(hasPrevious, initialize).else((s) => {
      s.setScalar("document_comparison_status", sql.lit`ready`);
      s.setScalar("document_comparison_error", sql.null);
      s.setScalar("document_comparison_result", sql.null);
      s.setScalar("document_comparison_change_count", 0);
      s.setScalar("document_comparison_formatting_count", 0);
      s.setScalar("document_comparison_active_change", 0);
      s.commitUiTreeChanges();
    });
  };

  const visibleChangeCount = sql`case
    when document_comparison_view = 'changes'
      and document_comparison_change_count <= ${MAX_CHANGE_CARDS}
      then document_comparison_change_count
    when document_comparison_view = 'redline'
      then document_comparison_change_count
    else 0
  end`;

  const moveChange = (s: DomStatements, delta: 1 | -1) => {
    s.returnIf(sql`${visibleChangeCount} = 0`);
    s.setScalar(
      "document_comparison_active_change",
      sql`mod(
        document_comparison_active_change + ${delta} + ${visibleChangeCount},
        ${visibleChangeCount}
      )`,
    );
    s.commitUiTreeChanges();
    s.element(
      sql`${handle} || '-change-' || cast(document_comparison_active_change as string)`,
    ).scrollIntoView({ behavior: sql.lit`smooth`, block: sql.lit`center` });
  };

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(
          "document_comparison_status",
          sql`case when ${hasPrevious} then 'loading' else 'ready' end`,
        );
        s.defScalar("document_comparison_error", {
          type: { type: "String", maxLength: 500 },
        });
        s.defScalar("document_comparison_result", { type: "Json" });
        s.defScalar("document_comparison_change_count", 0);
        s.defScalar("document_comparison_formatting_count", 0);
        s.defScalar("document_comparison_view", sql.lit`changes`);
        s.defScalar("document_comparison_active_change", 0);
      }}
    >
      <section
        className={props.className}
        sx={[styles.root, props.sx]}
        role="region"
        aria-label="Document version comparison"
        aria-busy={sql`document_comparison_status = 'loading'`}
        js={{
          handles: [{
            module: "document_comparison",
            cleanup: "cleanup",
            handle,
          }],
          on: {
            "document_comparison.ready": (s) => {
              s.setScalar(
                "document_comparison_result",
                sql`event.payload_json`,
              );
              s.setScalar(
                "document_comparison_change_count",
                sql`coalesce(
                  try_cast(event.payload_json->>'changeCount' as bigint),
                  0
                )`,
              );
              s.setScalar(
                "document_comparison_formatting_count",
                sql`coalesce(
                  try_cast(event.payload_json->>'formattingCount' as bigint),
                  0
                )`,
              );
              s.setScalar("document_comparison_active_change", 0);
              s.setScalar("document_comparison_status", sql.lit`ready`);
              s.setScalar("document_comparison_error", sql.null);
              s.commitUiTreeChanges();
            },
            "document_comparison.error": (s) => {
              s.setScalar(
                "document_comparison_error",
                sql`coalesce(
                  event.payload_json->>'message',
                  'Unable to compare these document versions.'
                )`,
              );
              s.setScalar("document_comparison_status", sql.lit`error`);
              s.commitUiTreeChanges();
            },
          },
        }}
      >
        <header className="border-b border-divider bg-surface px-4 pb-3.5 pt-4 sm:px-5 sm:pt-[18px]">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-tertiary">
            {kicker}
          </p>
          <h2 className="text-xl font-semibold leading-snug">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-secondary">
            {subtitle}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-secondary">
            <Show when={hasPrevious}>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full bg-neutral-400" />
                {previousLabel}
              </span>
            </Show>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-primary-500" />
              {currentLabel}
            </span>
          </div>
        </header>

        <Show when={sql`document_comparison_status = 'loading'`}>
          <div className="px-5 py-7 text-center text-sm text-secondary">
            Preparing document comparison…
          </div>
        </Show>

        <Show when={sql`document_comparison_status = 'error'`}>
          <div className="p-4">
            <Alert
              color="danger"
              endDecorator={
                <Button size="sm" color="danger" onClick={initialize}>
                  Retry
                </Button>
              }
            >
              {sql`document_comparison_error`}
            </Alert>
          </div>
        </Show>

        <Show when={sql`document_comparison_status = 'ready'`}>
          <Show
            when={hasPrevious}
            fallback={
              <div className="p-3 sm:px-5 sm:pb-6 sm:pt-[18px]">
                <LexicalRichTextDisplay
                  value={props.currentDocument}
                  sx={styles.document}
                />
              </div>
            }
          >
            <Tabs
              value={sql`document_comparison_view`}
              onValueChange={(s, value) => {
                s.setScalar("document_comparison_view", value);
                s.setScalar("document_comparison_active_change", 0);
              }}
              size="sm"
            >
              <div className="sticky top-0 z-[4] flex flex-wrap items-center justify-between gap-2.5 border-b border-divider bg-surface/95 p-2.5 backdrop-blur">
                <Tabs.List
                  className="grid w-full grid-cols-2 sm:flex sm:w-auto"
                  aria-label="Document comparison view"
                >
                  <Tabs.Tab value="changes">Changes only</Tabs.Tab>
                  <Tabs.Tab value="redline">Full redline</Tabs.Tab>
                  <Tabs.Tab value="previous">Previous version</Tabs.Tab>
                  <Tabs.Tab value="current">Current version</Tabs.Tab>
                </Tabs.List>
                <div className="flex min-h-8 w-full items-center justify-between gap-2 sm:w-auto">
                  <IconButton
                    size="sm"
                    variant="outlined"
                    color="neutral"
                    icon="ChevronLeft"
                    aria-label="Previous change"
                    tooltip="Previous change"
                    disabled={sql`${visibleChangeCount} = 0`}
                    onClick={(s) => moveChange(s, -1)}
                  />
                  <span
                    className="min-w-[92px] text-center text-xs tabular-nums text-secondary"
                    aria-live="polite"
                  >
                    {sql`case
                      when ${visibleChangeCount} > 0
                        then 'Change ' ||
                          cast(document_comparison_active_change + 1 as string) ||
                          ' of ' || cast(${visibleChangeCount} as string)
                      when document_comparison_change_count = 0
                        then 'No changes'
                      when document_comparison_view = 'changes'
                        and document_comparison_change_count > ${MAX_CHANGE_CARDS}
                        then 'Use full redline'
                      else 'Clean view'
                    end`}
                  </span>
                  <IconButton
                    size="sm"
                    variant="outlined"
                    color="neutral"
                    icon="ChevronRight"
                    aria-label="Next change"
                    tooltip="Next change"
                    disabled={sql`${visibleChangeCount} = 0`}
                    onClick={(s) => moveChange(s, 1)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-divider bg-level1 px-4 py-3 text-[13px] text-secondary sm:px-5">
                <strong className="text-primary">
                  {sql`cast(document_comparison_change_count as string) ||
                    ' changed passage' ||
                    case when document_comparison_change_count = 1 then '' else 's' end`}
                </strong>
                <Show when={sql`document_comparison_formatting_count > 0`}>
                  <span className="text-tertiary">•</span>
                  <span>
                    {sql`cast(document_comparison_formatting_count as string) ||
                      ' with formatting'`}
                  </span>
                </Show>
                <span className="text-tertiary">•</span>
                <span>Red means removed; blue underlining means added</span>
              </div>

              <Tabs.Panel
                value="changes"
                className="p-3 sm:px-5 sm:pb-6 sm:pt-[18px]"
                aria-label="Changes only"
              >
                <ChangesOnly
                  handle={handle}
                  previousLabel={previousLabel}
                  currentLabel={currentLabel}
                  currentDocument={props.currentDocument}
                />
              </Tabs.Panel>
              <Tabs.Panel
                value="redline"
                className="p-3 sm:px-5 sm:pb-6 sm:pt-[18px]"
                aria-label="Full redline"
              >
                <FullRedline
                  handle={handle}
                  previousLabel={previousLabel}
                  currentLabel={currentLabel}
                />
              </Tabs.Panel>
              <Tabs.Panel
                value="previous"
                className="p-3 sm:px-5 sm:pb-6 sm:pt-[18px]"
                aria-label="Previous version"
              >
                <LexicalRichTextDisplay
                  value={props.previousDocument}
                  sx={styles.document}
                />
              </Tabs.Panel>
              <Tabs.Panel
                value="current"
                className="p-3 sm:px-5 sm:pb-6 sm:pt-[18px]"
                aria-label="Current version"
              >
                <LexicalRichTextDisplay
                  value={props.currentDocument}
                  sx={styles.document}
                />
              </Tabs.Panel>
            </Tabs>
          </Show>
        </Show>

        <Effect
          watch={[props.previousDocument, props.currentDocument]}
          triggerOnMount
          onChange={refresh}
        />
      </section>
    </Data>
  );
}
