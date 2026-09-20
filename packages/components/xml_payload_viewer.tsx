import { Button } from "./button";
import { MaterialIcon } from "./material_icon";
import { ModalDialog } from "./modal";
import { Typography } from "./typography";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import { Show } from "std/ui";
import type { Node } from "std/ui";

/**
 * Props for {@link XmlPayloadModal}.
 */
export interface XmlPayloadModalProps {
  /** Scalar that controls whether the modal is open. */
  bindScalar: string;
  /** SQL expression that returns the XML payload for the current selection. */
  payload: Sql;
  /** Scalars or expressions that should refresh the loaded payload. */
  watch?: Sql[];
  /** Modal heading. */
  title?: Node;
  /** Empty-state text when `payload` resolves to null. */
  emptyMessage?: Node;
  /** Prefix for internal scalar names when multiple viewers share a scope. */
  scalarPrefix?: string;
  /** Whether to show the browser-native XML tab button. Defaults to true. */
  openInBrowser?: boolean;
  /** Modal max width. Defaults to `xl`. */
  maxWidth?: "xs" | "sm" | "md" | "lg" | "xl";
}

/**
 * Modal for inspecting an XML string stored in a SQL expression.
 *
 * Place this inside a `Data` scope that owns the open/selected scalars, then
 * pass a `payload` expression that resolves from that state. The component
 * escapes XML for inline display and can also open the raw payload in a
 * browser tab via the shared `xml_viewer` JS module.
 */
export function XmlPayloadModal(props: XmlPayloadModalProps) {
  useJsModule("xml_viewer");
  const prefix = props.scalarPrefix ?? "xml_payload_modal";
  const contentScalar = `${prefix}_content`;
  const escapedScalar = `${prefix}_escaped`;
  const sizeScalar = `${prefix}_size`;
  const contentRef = sql.ref(contentScalar);
  const escapedRef = sql.ref(escapedScalar);
  const sizeRef = sql.ref(sizeScalar);

  return (
    <ModalDialog
      bindScalar={props.bindScalar}
      maxWidth={props.maxWidth ?? "xl"}
    >
      <Data
        watch={props.watch}
        procedure={(s) => {
          s.defScalar(contentScalar, props.payload);
          s.defScalar(
            escapedScalar,
            sql`string.html_escape(coalesce(${contentRef}, ''))`,
          );
          s.defScalar(sizeScalar, sql`length(coalesce(${contentRef}, ''))`);
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <Typography level="h4">
            <MaterialIcon icon="Code" className="mr-2" />
            {props.title ?? "XML Content"}
          </Typography>
          <div className="flex items-center gap-2">
            <Show when={props.openInBrowser ?? true}>
              <Button
                size="sm"
                variant="outlined"
                startIcon="OpenInNew"
                onClick={(s) => {
                  s.jsCall({
                    module: "xml_viewer",
                    exportName: "openInBrowser",
                    handle: sql.lit`xml-viewer`,
                    argJson:
                      sql`json_build_object('handle', 'xml-viewer', 'json', json_build_object('xml', ${contentRef}))`,
                  });
                }}
              >
                View in Browser
              </Button>
            </Show>
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar(props.bindScalar, sql`false`)}
            >
              Close
            </Button>
          </div>
        </div>
        <Show
          when={sql`${contentRef} is not null`}
          fallback={
            <div className="text-center py-12 text-tertiary">
              <MaterialIcon
                icon="Code"
                className="text-4xl mb-2 opacity-50"
              />
              <Typography level="body-sm">
                {props.emptyMessage ?? "No XML content available"}
              </Typography>
            </div>
          }
        >
          <div className="flex items-center gap-2 mb-2 text-xs text-tertiary">
            <span>{sql`format.decimal(${sizeRef}) || ' characters'`}</span>
          </div>
          <pre
            className="bg-level1 text-primary rounded-lg p-4 text-xs leading-relaxed overflow-auto"
            sx={{
              maxHeight: "65vh",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              fontFamily: "monospace",
            }}
            dangerouslySetInnerHTML={escapedRef}
          />
        </Show>
      </Data>
    </ModalDialog>
  );
}
