import { Button } from "components/button";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Typography } from "components/typography";
import { Form } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { Show } from "std/ui";
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

/**
 * Page frame shared by every training page: an optional back link above the
 * title, the page's primary actions beside it, then the page content. `narrow`
 * keeps reading/step pages to one comfortable column with the title aligned
 * to the content.
 */
export function PageShell(
  props: {
    title: Node;
    subtitle?: Node;
    back?: Node;
    actions?: Node;
    narrow?: boolean;
    children: Node;
  },
) {
  return (
    <div className="min-h-dvh bg-neutral-50 pb-8">
      <div
        className={`px-4 py-5 md:px-8 md:py-8 mx-auto flex flex-col gap-6 ${
          props.narrow ? "max-w-4xl" : "max-w-7xl"
        }`}
      >
        <div className="flex flex-col gap-2">
          {props.back ? <div className="-ml-2">{props.back}</div> : null}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <Typography level="h3" className="text-balance">
                {props.title}
              </Typography>
              <Show when={props.subtitle ? sql`true` : sql`false`}>
                <Typography
                  level="body-md"
                  className="text-neutral-600 max-w-3xl"
                >
                  {props.subtitle}
                </Typography>
              </Show>
            </div>
            {props.actions
              ? (
                <div className="flex flex-wrap items-center gap-2 md:shrink-0">
                  {props.actions}
                </div>
              )
              : null}
          </div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

/** Quiet text-style link back to the parent page, for `PageShell.back`. */
export function BackLink(props: { href: string | Sql; label: Node }) {
  return (
    <Button
      component="a"
      href={props.href}
      backLink
      variant="plain"
      color="neutral"
      size="sm"
      startIcon="ArrowBack"
    >
      {props.label}
    </Button>
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

export { SignaturePad } from "components/signature_pad";
