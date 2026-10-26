import { Button } from "components/button";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { useUniqueId } from "std/ui";

/** Canvas signature capture; persistence and authorization belong to the caller. */
export interface SignaturePadProps {
  onSigned: (s: DomStatements, signatureData: Sql) => void;
  label: Sql | string;
  submitLabel?: Sql | string;
  submitDisabled?: BooleanExpr;
  /** Omit the signing guide from the exported image. Default false. */
  hideGuideInOutput?: boolean;
  canvasClassName?: string;
  onClear?: (s: DomStatements) => void;
}

/** Captures a signature as an image data URL using the shared browser module. */
export function SignaturePad(props: SignaturePadProps) {
  useJsModule("signature_pad");
  const signatureId = useUniqueId();
  const handle = sql.concat(signatureId, sql.lit`-signature-pad`);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("has_signature", sql`false`);
        s.defScalar("signature_data", sql.lit``);
        s.defScalar("canvas_id", sql`'signature-canvas-' || ${handle}`);
      }}
    >
      <div
        js={{
          handles: [
            {
              module: "signature_pad",
              cleanup: "cleanup",
              handle,
            },
          ],
          on: {
            "signature_pad.signatureChanged": (s) => {
              s.setScalar("has_signature", sql`true`);
            },
            "signature_pad.signatureCleared": (s) => {
              s.setScalar("has_signature", sql`false`);
              s.setScalar("signature_data", sql.lit``);
              props.onClear?.(s);
            },
          },
        }}
      >
        <div className="grid gap-2">
          <Typography level="title-sm">{props.label}</Typography>
          <canvas
            id={sql`canvas_id`}
            className={props.canvasClassName ??
              "w-full h-40 border border-divider rounded-md bg-white cursor-crosshair"}
            onMount={(s) => {
              s.jsCall({
                module: "signature_pad",
                exportName: "initializeCanvas",
                handle,
                argJson: sql`json_build_object(
                  'handle', ${handle},
                  'elementId', canvas_id
                )`,
              });
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="plain"
              color="neutral"
              size="sm"
              onClick={(s) => {
                s.jsCall({
                  module: "signature_pad",
                  exportName: "clearSignature",
                  handle,
                  argJson: sql`json_build_object('handle', ${handle})`,
                });
              }}
            >
              Clear
            </Button>
            <Button
              variant="solid"
              color="primary"
              size="sm"
              disabled={sql`not has_signature or ${
                props.submitDisabled ?? sql`false`
              }`}
              onClick={(s) => {
                s.jsCall({
                  module: "signature_pad",
                  exportName: props.hideGuideInOutput
                    ? "getCleanSignatureData"
                    : "getSignatureData",
                  handle,
                  argJson: sql`json_build_object('handle', ${handle})`,
                  resultJsonScalar: "signature_result",
                });
                s.setScalar(
                  "signature_data",
                  sql`signature_result->>'signature'`,
                );
                props.onSigned(s, sql`ui.signature_data`);
              }}
            >
              {props.submitLabel ?? "Save signature"}
            </Button>
          </div>
        </div>
      </div>
    </Data>
  );
}
