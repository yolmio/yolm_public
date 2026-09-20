import { Button } from "components/button";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form } from "std/form";
import { useJsModule } from "std/js_modules";
import { sql } from "std/sql_utils";
import type { BooleanExpr, Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";

const assessmentResponseFieldCodes = {
  textResponse: "text_response",
  practicalResult: "practical_result",
  measuredValue: "measured_value",
  measuredUnit: "measured_unit",
  notes: "notes",
  signatureName: "signature_name",
  signatureData: "signature_data",
} as const;

/**
 * Saves one entered value of an assessment response through the
 * `training_save_assessment_response` stored procedure, which owns the
 * ownership/evaluator authorization checks and its own transaction.
 */
export function callSaveAssessmentResponse(
  s: UiServerStatements,
  args: {
    attemptId: Sql;
    itemId: Sql;
    field: keyof typeof assessmentResponseFieldCodes;
    value: Sql;
    accessToken?: Sql;
  },
) {
  s.callStoredProcedure("training_save_assessment_response", {
    inputScalars: {
      p_attempt_id: args.attemptId,
      p_item_id: args.itemId,
      p_field: sql.lit(assessmentResponseFieldCodes[args.field]),
      p_value: args.value,
      p_access_token: args.accessToken ?? sql`cast(null as string)`,
    },
  });
}

const assessmentMetadataFieldCodes = {
  textValue: "text",
  numberValue: "number",
  dateValue: "date",
  selectedChoiceId: "single_choice",
} as const;

/**
 * Saves one assessment detail (metadata) value through the
 * `training_save_assessment_metadata_response` stored procedure, which owns
 * the ownership/evaluator authorization checks and its own transaction.
 */
export function callSaveAssessmentMetadataResponse(
  s: UiServerStatements,
  args: {
    attemptId: Sql;
    fieldId: Sql;
    field: keyof typeof assessmentMetadataFieldCodes;
    value: Sql;
    accessToken?: Sql;
  },
) {
  s.callStoredProcedure("training_save_assessment_metadata_response", {
    inputScalars: {
      p_attempt_id: args.attemptId,
      p_metadata_field_id: args.fieldId,
      p_field: sql.lit(assessmentMetadataFieldCodes[args.field]),
      p_text_value: args.field === "textValue"
        ? args.value
        : sql`cast(null as string)`,
      p_number_value: args.field === "numberValue"
        ? args.value
        : sql`cast(null as double)`,
      p_date_value: args.field === "dateValue"
        ? args.value
        : sql`cast(null as date)`,
      p_choice_id: args.field === "selectedChoiceId"
        ? args.value
        : sql`cast(null as bigint)`,
      p_access_token: args.accessToken ?? sql`cast(null as string)`,
    },
  });
}

export function PageShell(
  props: { title: Node; subtitle?: Node; children: Node },
) {
  return (
    <div className="min-h-dvh bg-neutral-50 pb-8">
      <div className="px-4 py-5 md:px-8 md:py-8 max-w-7xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Typography level="h2" className="tracking-normal">
            {props.title}
          </Typography>
          <Show when={props.subtitle ? sql`true` : sql`false`}>
            <Typography level="body-md" className="text-neutral-600 max-w-3xl">
              {props.subtitle}
            </Typography>
          </Show>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function EmptyState(
  props: { icon: IconName; title: Node; body?: Node },
) {
  return (
    <div className="min-h-36 border border-dashed border-neutral-300 rounded-md bg-white flex flex-col items-center justify-center text-center p-6">
      <MaterialIcon icon={props.icon} className="text-3xl text-neutral-400" />
      <Typography level="title-sm" className="mt-2">{props.title}</Typography>
      <Show when={props.body ? sql`true` : sql`false`}>
        <Typography level="body-sm" className="text-neutral-600 mt-1 max-w-sm">
          {props.body}
        </Typography>
      </Show>
    </div>
  );
}

export function StatTile(
  props: { label: Node; value: Sql; icon: IconName; tone?: string },
) {
  return (
    <div className="bg-white border border-divider rounded-md p-4 flex items-center gap-3 shadow-sm">
      <div
        className={`h-10 w-10 rounded-md flex items-center justify-center ${
          props.tone ?? "bg-primary-50 text-primary-700"
        }`}
      >
        <MaterialIcon icon={props.icon} />
      </div>
      <div>
        <Typography level="body-sm" className="text-neutral-600">
          {props.label}
        </Typography>
        <Typography level="h4">{props.value}</Typography>
      </div>
    </div>
  );
}

export function FormFieldWithLabel(props: {
  field: string;
  label: Node;
  placeholder?: string;
  minRows?: number;
}) {
  return (
    <FormControl>
      <FormLabel>{props.label}</FormLabel>
      <Form.Field field={props.field}>
        <FieldFormControl
          placeholder={props.placeholder}
          minRows={props.minRows}
          fullWidth
        />
      </Form.Field>
    </FormControl>
  );
}

export function SignaturePad(props: {
  onSigned: (s: DomStatements, signatureData: Sql) => void;
  label: Sql | string;
  submitLabel?: Sql | string;
  submitDisabled?: BooleanExpr;
}) {
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
            },
          },
        }}
      >
        <div className="grid gap-2">
          <Typography level="title-sm">{props.label}</Typography>
          <canvas
            id={sql`canvas_id`}
            className="w-full h-40 border border-divider rounded-md bg-white cursor-crosshair"
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
                  exportName: "getSignatureData",
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
