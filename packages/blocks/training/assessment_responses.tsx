import { Alert } from "components/alert";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { NumericInput } from "components/numeric_input";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "./index.tsx";
import {
  employeeName,
  employeeText,
  formatDateSql,
  personTable,
} from "./helpers";
import {
  callSaveAssessmentMetadataResponse,
  callSaveAssessmentResponse,
  SignaturePad,
} from "./shared";

export function EmployeeAssessmentResponses(
  props: { block: TrainingBlock; accessToken?: Sql; preview?: boolean },
) {
  const saveResponse = (
    s: UiServerStatements,
    field: "textResponse" | "signatureName" | "signatureData",
    value: Sql,
  ) => {
    callSaveAssessmentResponse(s, {
      attemptId: sql`display_attempt.id`,
      itemId: sql`assessment_response.item_id`,
      field,
      value,
      accessToken: props.accessToken,
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <Each table="assessment_responses" recordName="assessment_response">
        <div className="border border-divider rounded-md p-4 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Typography level="body-sm" className="text-neutral-500">
                {sql`assessment_response.section_name`}
              </Typography>
              <Typography level="title-sm">
                {sql`assessment_response.prompt ||
                  case when assessment_response.is_required
                    then '' else ' (optional)' end`}
              </Typography>
              <Show when={sql`assessment_response.help_text is not null`}>
                <Typography level="body-sm" className="text-neutral-600">
                  {sql`assessment_response.help_text`}
                </Typography>
              </Show>
            </div>
            <Show
              when={sql`display_attempt.status = 'complete'
                and assessment_response.include_in_score
                and ${
                props.preview
                  ? sql`not display_attempt.approval_simulated`
                  : sql`true`
              }`}
            >
              <Chip size="sm" variant="soft" color="neutral">
                {sql`coalesce(assessment_response.points_awarded::string, '0')
                  || ' / ' ||
                  assessment_response.response_max_points::string || ' pts'`}
              </Chip>
            </Show>
          </div>
          <div className="mt-3">
            <Show when={sql`assessment_response.type = 'multiple_choice'`}>
              <div className="flex flex-col gap-1">
                <Each
                  table="assessment_choices"
                  recordName="assessment_choice"
                  where={sql`assessment_choice.item_id =
                    assessment_response.item_id`}
                >
                  <Show
                    when={sql`display_attempt.status = 'in_progress'
                      and assessment_task.execution_mode !=
                        'trainer_recorded'`}
                    fallback={
                      <div className="flex flex-col gap-1">
                        <Typography level="body-sm">
                          {sql`case when assessment_choice.selected
                            then '☑ ' else '☐ ' end ||
                            assessment_choice.content`}
                        </Typography>
                        <Show
                          when={sql`display_attempt.status = 'complete'
                            and display_attempt.show_correct_answers_after_submission`}
                        >
                          <Typography
                            level="body-xs"
                            className="text-neutral-500"
                          >
                            {sql`case
                              when assessment_choice.is_correct
                              then 'Correct answer'
                              else 'Incorrect choice'
                            end || coalesce(
                              ' · ' || assessment_choice.explanation,
                              ''
                            )`}
                          </Typography>
                        </Show>
                      </div>
                    }
                  >
                    <Checkbox
                      aria-label={sql`assessment_choice.content`}
                      checked={sql`assessment_choice.selected`}
                      label={sql`assessment_choice.content`}
                      onCheckboxChange={(s) => {
                        if (props.preview) {
                          s.modify(
                            sql`update ui.assessment_choices set selected = case
                            when id = assessment_choice.id then target_checked
                            when assessment_response.selection_mode = 'single' then false
                            else selected end where item_id = assessment_response.item_id`,
                          );
                          return;
                        }
                        s.setScalar("ui.assessment_error", sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.callStoredProcedure(
                              "training_toggle_assessment_choice",
                              {
                                inputScalars: {
                                  p_attempt_id: sql`display_attempt.id`,
                                  p_item_id: sql`assessment_response.item_id`,
                                  p_choice_id: sql`assessment_choice.id`,
                                  p_single_selection:
                                    sql`assessment_response.selection_mode = 'single'`,
                                  p_checked: sql`target_checked`,
                                },
                              },
                            );
                            s.commitTransaction();
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              "ui.assessment_error",
                              employeeText(
                                sql`assessment_task.employee_language`,
                                {
                                  en: "The answer could not be saved.",
                                  es: "No se pudo guardar la respuesta.",
                                },
                              ),
                            );
                          },
                        });
                      }}
                    />
                  </Show>
                </Each>
                <Show
                  when={sql`display_attempt.status = 'complete'
                    and display_attempt.show_correct_answers_after_submission
                    and nullif(trim(assessment_response.explanation), '')
                      is not null`}
                >
                  <Alert color="neutral" startIcon="Info" className="mt-3">
                    <Typography level="body-xs" className="font-medium">
                      {employeeText(
                        sql`assessment_task.employee_language`,
                        { en: "Explanation", es: "Explicación" },
                      )}
                    </Typography>
                    <Typography level="body-sm" className="whitespace-pre-wrap">
                      {sql`assessment_response.explanation`}
                    </Typography>
                  </Alert>
                </Show>
                <Show
                  when={sql`display_attempt.status = 'complete'
                    and display_attempt.show_correct_answers_after_submission
                    and assessment_response.is_correct = false
                    and nullif(trim(assessment_response.remediation_text), '')
                      is not null`}
                >
                  <Alert color="warning" startIcon="School" className="mt-3">
                    <Typography level="body-xs" className="font-medium">
                      {employeeText(
                        sql`assessment_task.employee_language`,
                        { en: "Review", es: "Repaso" },
                      )}
                    </Typography>
                    <Typography level="body-sm" className="whitespace-pre-wrap">
                      {sql`assessment_response.remediation_text`}
                    </Typography>
                  </Alert>
                </Show>
              </div>
            </Show>
            <Show when={sql`assessment_response.type = 'text_response'`}>
              <Show
                when={sql`display_attempt.status = 'in_progress'
                  and assessment_task.execution_mode != 'trainer_recorded'`}
                fallback={
                  <Typography level="body-sm" className="whitespace-pre-wrap">
                    {sql`coalesce(assessment_response.text_response,
                      'No response.')`}
                  </Typography>
                }
              >
                <Textarea
                  aria-label={sql`assessment_response.prompt`}
                  value={sql`coalesce(assessment_response.text_response, '')`}
                  minRows={4}
                  onInput={(s) => {
                    if (props.preview) {
                      s.modify(sql`update ui.assessment_responses
                        set text_response = target_value
                        where item_id = assessment_response.item_id`);
                      return;
                    }
                    s.tryServer({
                      body: (s) => {
                        saveResponse(s, "textResponse", sql`target_value`);
                      },
                    });
                  }}
                />
              </Show>
            </Show>
            <Show when={sql`assessment_response.type = 'signature'`}>
              <Show
                when={sql`display_attempt.status = 'in_progress'
                  and assessment_task.execution_mode != 'trainer_recorded'`}
                fallback={
                  <div>
                    <Typography level="body-sm">
                      {sql`coalesce('Signed: ' ||
                        assessment_response.signature_name, 'Not signed.')`}
                    </Typography>
                    <Show
                      when={sql`assessment_response.signature_data is not null`}
                    >
                      <img
                        src={sql`assessment_response.signature_data`}
                        alt="Signature"
                        className="mt-2 max-h-24 border border-divider rounded-md bg-white"
                      />
                    </Show>
                  </div>
                }
              >
                <SignaturePad
                  label={employeeText(sql`assessment_task.employee_language`, {
                    en: "Draw your signature",
                    es: "Dibuje su firma",
                  })}
                  onSigned={(s, signatureData) => {
                    if (props.preview) {
                      s.modify(sql`update ui.assessment_responses
                        set signature_name = 'Preview signature', signature_data = ${signatureData}
                        where item_id = assessment_response.item_id`);
                      return;
                    }
                    s.tryServer({
                      body: (s) => {
                        saveResponse(
                          s,
                          "signatureName",
                          sql`(
                            select ${
                            employeeName(
                              props.block.opts,
                              sql`signature_person`,
                            )
                          }
                            from db.${
                            sql.ref(personTable(props.block.opts))
                          } signature_person
                            where signature_person.id =
                              assessment_task.person_id
                          )`,
                        );
                        saveResponse(s, "signatureData", signatureData);
                        s.refetch();
                      },
                    });
                  }}
                />
              </Show>
            </Show>
            <Show
              when={sql`assessment_response.type =
                'practical_observation'`}
            >
              <Alert color="warning" startIcon="FactCheck">
                {employeeText(sql`assessment_task.employee_language`, {
                  en: "A trainer records this practical observation.",
                  es: "Un instructor registra esta observación práctica.",
                })}
              </Alert>
            </Show>
          </div>
        </div>
      </Each>
    </div>
  );
}

export function EmployeeAssessmentMetadataResponses(
  props: { accessToken?: Sql; preview?: boolean },
) {
  const editable = sql`display_attempt.status = 'in_progress'
    and assessment_task.execution_mode != 'trainer_recorded'`;
  const saveMetadata = (
    s: DomStatements,
    field:
      | "textValue"
      | "numberValue"
      | "dateValue"
      | "selectedChoiceId",
    value: Sql,
  ) => {
    if (props.preview) {
      const column = {
        textValue: "text_value",
        numberValue: "number_value",
        dateValue: "date_value",
        selectedChoiceId: "selected_choice_id",
      }[field];
      s.modify(
        sql`update ui.assessment_metadata_responses set ${
          sql.ref(column)
        } = ${value} where field_id = metadata_response.field_id`,
      );
      return;
    }
    s.tryServer({
      body: (s) => {
        callSaveAssessmentMetadataResponse(s, {
          attemptId: sql`display_attempt.id`,
          fieldId: sql`metadata_response.field_id`,
          field,
          value,
          accessToken: props.accessToken,
        });
        if (field === "selectedChoiceId") s.refetch();
      },
    });
  };
  return (
    <Show when={sql`exists (select 1 from assessment_metadata_responses)`}>
      <div className="border border-divider rounded-md p-4 bg-neutral-50 mb-4">
        <Typography level="title-sm" className="mb-3">
          Assessment details
        </Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Each
            table="assessment_metadata_responses"
            recordName="metadata_response"
          >
            <FormControl>
              <FormLabel>
                {sql`metadata_response.label ||
                  case when metadata_response.required
                    then '' else ' (optional)' end`}
              </FormLabel>
              <Show when={sql`metadata_response.help_text is not null`}>
                <Typography level="body-xs" className="text-neutral-600 mb-1">
                  {sql`metadata_response.help_text`}
                </Typography>
              </Show>
              <Show
                when={editable}
                fallback={
                  <Typography level="body-sm">
                    {sql`case metadata_response.type::string
                      when 'text' then coalesce(
                        metadata_response.text_value, 'Not recorded')
                      when 'number' then coalesce(
                        metadata_response.number_value::string,
                        'Not recorded')
                      when 'date' then coalesce(
                        ${formatDateSql(sql`metadata_response.date_value`)},
                        'Not recorded')
                      else coalesce((
                        select choice.label
                        from assessment_metadata_choices choice
                        where choice.id =
                          metadata_response.selected_choice_id
                      ), 'Not recorded')
                    end`}
                  </Typography>
                }
              >
                <Show when={sql`metadata_response.type = 'text'`}>
                  <Input
                    aria-label={sql`metadata_response.label`}
                    value={sql`coalesce(metadata_response.text_value, '')`}
                    onInput={(s) => {
                      saveMetadata(s, "textValue", sql`target_value`);
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'number'`}>
                  {props.preview
                    ? (
                      <NumericInput
                        aria-label={sql`metadata_response.label`}
                        value={sql`metadata_response.number_text`}
                        onChange={(s, value) =>
                          s.modify(sql`update ui.assessment_metadata_responses
                      set number_text = ${value}, number_value = try_cast(${value} as double)
                      where field_id = metadata_response.field_id`)}
                      />
                    )
                    : (
                      <Input
                        aria-label={sql`metadata_response.label`}
                        type="number"
                        value={sql`coalesce(metadata_response.number_value::string, '')`}
                        onInput={(s) => {
                          saveMetadata(
                            s,
                            "numberValue",
                            sql`try_cast(target_value as double)`,
                          );
                        }}
                      />
                    )}
                </Show>
                <Show when={sql`metadata_response.type = 'date'`}>
                  <Input
                    aria-label={sql`metadata_response.label`}
                    type="date"
                    value={sql`coalesce(metadata_response.date_value::string, '')`}
                    onInput={(s) => {
                      saveMetadata(
                        s,
                        "dateValue",
                        sql`try_cast(target_value as date)`,
                      );
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'single_choice'`}>
                  <Select
                    aria-label={sql`metadata_response.label`}
                    className="w-full"
                    value={sql`coalesce(
                      metadata_response.selected_choice_id::string, '')`}
                    onInput={(s) => {
                      saveMetadata(
                        s,
                        "selectedChoiceId",
                        sql`case
                              when nullif(target_value, '') is null then null
                              else target_value::bigint
                            end`,
                      );
                    }}
                  >
                    <Select.Option value="">Not recorded</Select.Option>
                    <Each
                      table="assessment_metadata_choices"
                      recordName="metadata_choice"
                      where={sql`metadata_choice.field_id =
                        metadata_response.field_id`}
                    >
                      <Select.Option value={sql`metadata_choice.id::string`}>
                        {sql`metadata_choice.label`}
                      </Select.Option>
                    </Each>
                  </Select>
                </Show>
              </Show>
            </FormControl>
          </Each>
        </div>
      </div>
    </Show>
  );
}
