import { Alert } from "components/alert";
import { Button } from "components/button";
import { PdfWorkspaceViewer } from "components/pdf_markup";
import { Tabs } from "components/tabs";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { Effect, Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";

export interface DocumentEditorWorkspaceTab {
  /** Stable tab key. "preview" is reserved for the PDF preview. */
  value: string;
  label: Node;
  content: Node;
  /** Hide the tab and its panel when false. */
  when?: BooleanExpr;
  /** Preserve internal panel state across tab switches. Default false. */
  keepMounted?: boolean;
}

export interface DocumentEditorWorkspacePreview {
  /** Unsaved document content; changing it schedules a new render. */
  value: Sql;
  /**
   * Emit a server procedure and return its PDF URL expression (including data URLs).
   * The value argument is captured before the debounce. Authorize access here;
   * this procedure should render only, without saving the document.
   */
  render: (s: UiServerStatements, value: Sql) => Sql;
  /** Whether this document supports preview; false selects an available information tab. */
  when?: BooleanExpr;
  /** Wait for the editor/form to load before rendering. Default true. */
  ready?: BooleanExpr;
  /** Pause rendering while media or other document dependencies are pending. */
  blocked?: BooleanExpr;
  /** Additional inputs that invalidate the PDF, such as a template or record ID. */
  watch?: Sql[];
  debounceMs?: number;
  label?: Node;
  title?: string;
  fileName?: string;
  errorMessage?: Node;
  height?: string;
}

export interface DocumentEditorWorkspaceProps {
  /** Editor, read-only document, or comparison view. Stays mounted when tabs change. */
  children: Node;
  preview: DocumentEditorWorkspacePreview;
  /** Additional information panels, in display order; lazy unless keepMounted. */
  tabs?: readonly DocumentEditorWorkspaceTab[];
  /** Initial tab key. Default "preview". Hidden tabs fall back to the first available tab. */
  defaultTab?: string;
  /** Desktop sidebar width in CSS units. Below xl the panes stack. Default "320px". */
  sidePanelWidth?: string;
  sidePanelLabel?: string;
  className?: string;
}

/** Document authoring with a live PDF and a sticky, tabbed information sidebar. */
export function DocumentEditorWorkspace(props: DocumentEditorWorkspaceProps) {
  const { preview } = props;
  const tabs = props.tabs ?? [];
  const keys = ["preview", ...tabs.map((tab) => tab.value)];
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "DocumentEditorWorkspace tab values must be unique; preview is reserved.",
    );
  }
  if (!keys.includes(props.defaultTab ?? "preview")) {
    throw new Error(
      "DocumentEditorWorkspace defaultTab must name an existing tab.",
    );
  }
  const availableTabs = [
    { value: "preview", when: preview.when ?? true },
    ...tabs.map((tab) => ({ value: tab.value, when: tab.when ?? true })),
  ];
  const fallback = availableTabs.reduceRight(
    (next, tab) =>
      sql`case when ${tab.when} then ${sql.lit(tab.value)} else ${next} end`,
    sql`null::string`,
  );
  const selectedTab = availableTabs.reduceRight(
    (next, tab) =>
      sql`case when document_workspace_tab = ${
        sql.lit(tab.value)
      } and ${tab.when}
      then ${sql.lit(tab.value)} else ${next} end`,
    fallback,
  );
  const blocked = preview.blocked ?? false;
  const ready = preview.ready ?? true;
  const handle = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(
          "document_workspace_tab",
          sql.lit(props.defaultTab ?? "preview"),
        );
        s.defScalar("document_preview_url", {
          type: { type: "String", maxLength: 500_000_000 },
          expr: sql.lit``,
        });
        s.defScalar("document_preview_busy", false);
        s.defScalar("document_preview_error", false);
        s.defScalar("document_preview_revision", 0);
        s.defScalar("document_preview_rendered_revision", 0);
        s.defScalar("document_preview_retry", 0);
        s.defScalar("document_preview_ready", false);
        s.defScalar("document_preview_page", 1);
        s.defScalar("document_preview_page_count", 0);
      }}
    >
      <Effect
        triggerOnMount
        watch={[
          preview.value,
          selectedTab,
          sql`${blocked}`,
          sql`${ready}`,
          ...(preview.watch ?? []),
          sql`document_preview_retry`,
        ]}
        onChange={(s) => {
          s.setScalar(
            "document_preview_revision",
            sql`document_preview_revision + 1`,
          );
          s.if(
            sql`(${selectedTab} is distinct from 'preview') or not (${ready})`,
            (s) => s.setScalar("document_preview_ready", false),
          );
          s.if(
            sql`${selectedTab} = 'preview' and ${ready} and not (${blocked})`,
            (s) => {
              s.defScalar(
                "preview_revision",
                sql`document_preview_revision`,
              );
              s.defScalar("preview_body", preview.value);
              s.setScalar("document_preview_busy", true);
              s.startTaskWithOpts({
                detached: true,
                procedure: (s) => {
                  s.sleep(preview.debounceMs ?? 800);
                  s.returnIf(
                    sql`preview_revision != document_preview_revision`,
                  );
                  s.defScalar("document_preview_result_url", {
                    type: { type: "String", maxLength: 500_000_000 },
                  });
                  s.tryServer({
                    body: (s) => {
                      s.setScalar(
                        "document_preview_result_url",
                        preview.render(s, sql`preview_body`),
                      );
                      s.throwErrorIf(
                        sql`coalesce(document_preview_result_url, '') = ''`,
                        sql.lit`The PDF renderer did not return a URL.`,
                      );
                    },
                    catch: (s) => {
                      s.if(
                        sql`preview_revision = document_preview_revision`,
                        (s) => {
                          s.setScalar("document_preview_ready", false);
                          s.setScalar("document_preview_error", true);
                        },
                      );
                    },
                  });
                  s.if(
                    sql`preview_revision = document_preview_revision`,
                    (s) => {
                      s.setScalar("document_preview_busy", false);
                      s.if(
                        sql`document_preview_result_url is not null`,
                        (s) => {
                          s.setScalar(
                            "document_preview_url",
                            sql`document_preview_result_url`,
                          );
                          s.setScalar(
                            "document_preview_rendered_revision",
                            sql`preview_revision`,
                          );
                          s.setScalar("document_preview_error", false);
                        },
                      );
                    },
                  );
                },
              });
            },
          );
        }}
      />
      <div
        className={"flex flex-col gap-5 xl:flex-row " + (props.className ?? "")}
      >
        <div className="min-w-0 flex-1">{props.children}</div>
        <Show when={sql`${selectedTab} is not null`}>
          <div
            className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[var(--document-workspace-sidebar-width)] xl:self-start"
            style={{
              "--document-workspace-sidebar-width": sql.lit(
                props.sidePanelWidth ?? "320px",
              ),
            }}
            aria-label={props.sidePanelLabel ?? "Document side panel"}
          >
            <Tabs
              size="sm"
              value={selectedTab}
              onValueChange={(s, value) => {
                s.if(
                  sql`${value} != 'preview'`,
                  (s) => s.setScalar("document_preview_ready", false),
                );
                s.setScalar("document_workspace_tab", value);
              }}
              aria-label={props.sidePanelLabel ?? "Document side panel"}
              sx={{ backgroundColor: "transparent" }}
            >
              <Tabs.List tabFlex="1" className="border-b border-divider">
                <Show when={preview.when ?? true}>
                  <Tabs.Tab
                    value="preview"
                    className="whitespace-nowrap text-sm"
                  >
                    {preview.label ?? "PDF preview"}
                  </Tabs.Tab>
                </Show>
                {tabs.map((tab) => (
                  <Show when={tab.when ?? true}>
                    <Tabs.Tab
                      value={tab.value}
                      className="whitespace-nowrap text-sm"
                    >
                      {tab.label}
                    </Tabs.Tab>
                  </Show>
                ))}
              </Tabs.List>
              <Tabs.Panel value="preview" className="px-0 pb-0 pt-3">
                <Show when={ready}>
                  <WorkspacePdfPreview preview={preview} handle={handle} />
                </Show>
              </Tabs.Panel>
              {tabs.map((tab) => (
                <Tabs.Panel
                  value={tab.value}
                  keepMounted={tab.keepMounted}
                  className="space-y-4 px-0 pb-0 pt-3"
                >
                  {tab.content}
                </Tabs.Panel>
              ))}
            </Tabs>
          </div>
        </Show>
      </div>
    </Data>
  );
}

function WorkspacePdfPreview({ preview, handle }: {
  preview: DocumentEditorWorkspacePreview;
  handle: Sql;
}) {
  const blocked = preview.blocked ?? false;
  return (
    <section
      className="w-full min-w-0"
      aria-label="PDF layout preview"
      sx={{
        "& .ym-pdf-markup-document-header, & .ym-pdf-markup-document-footer": {
          display: "none",
        },
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {preview.title ?? "PDF layout"}
        </h3>
        <Show when={sql`document_preview_page_count > 0`}>
          <span
            className="text-xs text-secondary"
            aria-label="PDF page count"
          >
            {sql`document_preview_page_count::string || case when document_preview_page_count = 1 then ' page' else ' pages' end`}
          </span>
        </Show>
      </div>
      <p role="status" className="mb-2 mt-1 h-4 text-xs text-secondary">
        {sql`case when document_preview_busy or ${blocked} then 'Updating…' else 'Live preview' end`}
      </p>
      <Show when={sql`document_preview_error`}>
        <Alert color="danger">
          {preview.errorMessage ?? "The PDF could not be rendered. Try again."}
        </Alert>
        <Button
          type="button"
          onClick={(s) => {
            s.setScalar(
              "document_preview_retry",
              sql`document_preview_retry + 1`,
            );
          }}
        >
          Retry preview
        </Button>
      </Show>
      <Show
        when={sql`document_preview_url != '' and not document_preview_error`}
      >
        <PdfWorkspaceViewer
          handle={handle}
          initialPage={sql`document_preview_page`}
          onReady={(s, event) => {
            s.setScalar("document_preview_ready", true);
            s.setScalar("document_preview_page_count", event.pageCount);
          }}
          onPageChange={(s, event) => {
            s.setScalar("document_preview_page", event.page);
            s.setScalar("document_preview_page_count", event.pageCount);
          }}
          onDocumentChange={(s, event) => {
            s.setScalar("document_preview_page", event.page);
            s.setScalar("document_preview_page_count", event.pageCount);
          }}
          onError={(s) => {
            s.setScalar("document_preview_ready", false);
            s.setScalar("document_preview_error", true);
          }}
          documents={sql`json_build_array(json_build_object('key', 'preview', 'fileUrl', document_preview_url, 'fileName', ${
            sql.lit(preview.fileName ?? "Document.pdf")
          }))`}
          height={preview.height ?? "min(640px, calc(100vh - 10rem))"}
          showToolbar={false}
        />
        <Effect
          watch={[
            sql`document_preview_rendered_revision`,
            sql`document_preview_ready`,
          ]}
          onChange={(s) => {
            s.if(sql`document_preview_ready`, (s) => {
              s.jsCall({
                module: "pdf_markup",
                exportName: "setDocuments",
                handle,
                argJson:
                  sql`json_build_object('handle', ${handle}, 'pdfUrl', document_preview_url, 'page', document_preview_page)`,
              });
            });
          }}
        />
      </Show>
    </section>
  );
}
