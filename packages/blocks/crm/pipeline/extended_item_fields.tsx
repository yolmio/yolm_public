import { Button } from "components/button";
import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { Input } from "components/input";
import { Select } from "components/select";
import { TableRecordSelect } from "components/table_record_select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { AnyExpr, NumericExpr, Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Show } from "std/ui";
import { Data } from "std/data";
import { Form } from "std/form";
import { CrmBlock } from "../index";
import type { PipelineConfig } from "./types";

/**
 * Labels for extended item fields. All are optional with sensible defaults.
 */
export interface ExtendedItemFieldLabels {
  /** Label for the item name field. Default: "Name" */
  name?: string;
  /** Label for the estimated value field. Default: "Estimated Value" */
  estimatedValue?: string;
  /** Label for the probability field. Default: "Probability %" */
  probability?: string;
  /** Label for the expected close date field. Default: "Expected Close Date" */
  expectedCloseDate?: string;
  /** Label for the risk level field. Default: "Risk Level" */
  riskLevel?: string;
  /** Label for the business case score field. Default: "Business Case Score (1-5)" */
  businessCaseScore?: string;
  /** Label for the pain points field. Default: "Notes" */
  notes?: string;
  /** Label for the success metrics field. Default: "Success Metrics Defined" */
  successMetrics?: string;
  /** Label for the competitive landscape field. Default: "Competitive Landscape" */
  competitiveLandscape?: string;
  /** Label for the partner field. Default: "Partner" */
  partner?: string;
}

const defaultLabels: Required<ExtendedItemFieldLabels> = {
  name: "Name",
  estimatedValue: "Estimated Value",
  probability: "Probability %",
  expectedCloseDate: "Expected Close Date",
  riskLevel: "Risk Level",
  businessCaseScore: "Business Case Score (1-5)",
  notes: "Notes",
  successMetrics: "Success Metrics Defined",
  competitiveLandscape: "Competitive Landscape",
  partner: "Partner",
};

interface ExtendedItemFieldsFormProps {
  hasQualification?: boolean;
  /** Whether to show the partner field */
  hasPartnerAttachment?: boolean;
  /** Whether to include the notes/pain points field */
  includeNotes?: boolean;
  /** Whether to hide the business case score field (e.g. in add dialogs) */
  hideBusinessCaseScore?: boolean;
  /** Custom labels for the fields */
  labels?: ExtendedItemFieldLabels;
  /** Initial values for the form fields (for edit mode) */
  initialValues?: {
    itemName?: AnyExpr;
    estimatedValue?: AnyExpr;
    probabilityPct?: AnyExpr;
    expectedCloseDate?: AnyExpr;
    riskLevel?: AnyExpr;
    successMetricsDefined?: AnyExpr;
    businessCaseScore?: AnyExpr;
    competitiveLandscape?: AnyExpr;
    partnerId?: AnyExpr;
    notes?: AnyExpr;
    useCaseCategory?: AnyExpr;
  };
}

/**
 * Shared Form.Field components for extended pipeline item fields.
 * Must be used within a Form.Temporary or Form.Update context.
 *
 * These fields are enabled when a pipeline has `opportunityFields: {}`.
 * The fields can be customized with labels for different use cases (sales opportunities,
 * deals, leads, etc.).
 */
export function ExtendedItemFieldsForm(props: ExtendedItemFieldsFormProps) {
  const init = props.initialValues ?? {};
  const labels = { ...defaultLabels, ...props.labels };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Form.Field
            field="opportunity_name"
            fieldType={{ type: "String", maxLength: 200 }}
            initialValue={init.itemName ?? sql.lit``}
            required
          >
            {(helper) => (
              <>
                <Typography level="body-xs" className="text-tertiary mb-1">
                  {labels.name} *
                </Typography>
                <Input
                  placeholder={`Enter ${labels.name.toLowerCase()}`}
                  value={helper.value}
                  onInput={(s) => helper.setValue(s, sql`target_value`)}
                  error={helper.hasError}
                />
              </>
            )}
          </Form.Field>
        </div>

        <div>
          <Form.Field
            field="estimated_value"
            fieldType={{
              type: "Decimal",
              precision: 18,
              scale: 2,
              signed: true,
            }}
            initialValue={init.estimatedValue}
          >
            {(helper) => (
              <>
                <Typography level="body-xs" className="text-tertiary mb-1">
                  {labels.estimatedValue}
                </Typography>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={sql`cast(${helper.value} as string)`}
                  onInput={(s) =>
                    helper.setValue(
                      s,
                      sql`case when target_value = '' then null else try_cast(target_value as decimal) end`,
                    )}
                  startDecorator={<span className="text-tertiary">$</span>}
                />
              </>
            )}
          </Form.Field>
        </div>

        <div>
          <Form.Field
            field="probability_pct"
            fieldType="SmallUint"
            initialValue={init.probabilityPct}
          >
            {(helper) => (
              <>
                <Typography level="body-xs" className="text-tertiary mb-1">
                  {labels.probability}
                </Typography>
                <Input
                  type="number"
                  placeholder="0"
                  value={sql`cast(${helper.value} as string)`}
                  onInput={(s) =>
                    helper.setValue(
                      s,
                      sql`case when target_value = '' then null else try_cast(target_value as int) end`,
                    )}
                  endDecorator={<span className="text-tertiary">%</span>}
                />
              </>
            )}
          </Form.Field>
        </div>

        <div>
          <Form.Field
            field="expected_close_date"
            fieldType={{ type: "String", maxLength: 20 }}
            initialValue={init.expectedCloseDate ?? sql.lit``}
          >
            {(helper) => (
              <>
                <Typography level="body-xs" className="text-tertiary mb-1">
                  {labels.expectedCloseDate}
                </Typography>
                <Input
                  type="date"
                  value={helper.value}
                  onInput={(s) => helper.setValue(s, sql`target_value`)}
                />
              </>
            )}
          </Form.Field>
        </div>

        <div>
          <Form.Field
            field="risk_level"
            fieldType={{ type: "String", maxLength: 20 }}
            initialValue={init.riskLevel ?? sql.lit``}
          >
            {(helper) => (
              <>
                <Typography level="body-xs" className="text-tertiary mb-1">
                  {labels.riskLevel}
                </Typography>
                <Select
                  value={helper.value}
                  onChange={(s, value) => helper.setValue(s, value)}
                >
                  <Select.Option value="">Select risk level</Select.Option>
                  <Select.Option value="low">Low</Select.Option>
                  <Select.Option value="medium">Medium</Select.Option>
                  <Select.Option value="high">High</Select.Option>
                </Select>
              </>
            )}
          </Form.Field>
        </div>

        {props.hasQualification && (
          <Form.Field
            field="use_case_category"
            fieldType={{ type: "String", maxLength: 255 }}
            initialValue={init.useCaseCategory}
          >
            {(helper) => (
              <div>
                <Typography level="body-xs" className="text-tertiary mb-1">
                  Use Case Category
                </Typography>
                <Input
                  value={helper.value}
                  onInput={(s) => helper.setValue(s, sql`target_value`)}
                />
              </div>
            )}
          </Form.Field>
        )}
        {props.hasQualification && !props.hideBusinessCaseScore && (
          <div>
            <Form.Field
              field="business_case_score"
              fieldType="SmallUint"
              initialValue={init.businessCaseScore}
            >
              {(helper) => (
                <>
                  <Typography level="body-xs" className="text-tertiary mb-1">
                    {labels.businessCaseScore}
                  </Typography>
                  <Select
                    value={sql`cast(coalesce(${helper.value}, 0) as string)`}
                    onChange={(s, value) =>
                      helper.setValue(
                        s,
                        sql`case when ${value} = '' or ${value} = '0' then null else cast(${value} as int) end`,
                      )}
                  >
                    <Select.Option value="">Select score</Select.Option>
                    <Select.Option value="1">1 - Very Weak</Select.Option>
                    <Select.Option value="2">2 - Weak</Select.Option>
                    <Select.Option value="3">3 - Moderate</Select.Option>
                    <Select.Option value="4">4 - Strong</Select.Option>
                    <Select.Option value="5">5 - Very Strong</Select.Option>
                  </Select>
                </>
              )}
            </Form.Field>
          </div>
        )}

        {props.hasQualification && (
          <div className="md:col-span-2">
            <Form.Field
              field="competitive_landscape"
              fieldType={{ type: "String", maxLength: 2000 }}
              initialValue={init.competitiveLandscape ?? sql.lit``}
            >
              {(helper) => (
                <>
                  <Typography level="body-xs" className="text-tertiary mb-1">
                    {labels.competitiveLandscape}
                  </Typography>
                  <Textarea
                    placeholder="Describe competitive situation..."
                    minRows={2}
                    value={helper.value}
                    onInput={(s) => helper.setValue(s, sql`target_value`)}
                  />
                </>
              )}
            </Form.Field>
          </div>
        )}

        {props.hasQualification && (
          <div className="md:col-span-2">
            <Form.Field
              field="success_metrics_defined"
              fieldType="Bool"
              initialValue={init.successMetricsDefined ?? sql`false`}
            >
              {(helper) => (
                <>
                  <Typography level="body-xs" className="text-tertiary mb-1">
                    {labels.successMetrics}
                  </Typography>
                  <Select
                    value={sql`case when ${helper.value} then 'yes' else 'no' end`}
                    onChange={(s, value) =>
                      helper.setValue(s, sql`${value} = 'yes'`)}
                  >
                    <Select.Option value="no">No</Select.Option>
                    <Select.Option value="yes">Yes</Select.Option>
                  </Select>
                </>
              )}
            </Form.Field>
          </div>
        )}

        {props.includeNotes && (
          <div className="md:col-span-2">
            <Form.Field
              field="pain_points"
              fieldType={{ type: "String", maxLength: 2000 }}
              initialValue={init.notes ?? sql.lit``}
            >
              {(helper) => (
                <>
                  <Typography level="body-xs" className="text-tertiary mb-1">
                    {labels.notes}
                  </Typography>
                  <Textarea
                    placeholder={`Enter ${labels.notes.toLowerCase()}...`}
                    minRows={2}
                    value={helper.value}
                    onInput={(s) => helper.setValue(s, sql`target_value`)}
                  />
                </>
              )}
            </Form.Field>
          </div>
        )}

        {props.hasPartnerAttachment && (
          <div className="md:col-span-2">
            <Form.Field
              field="partner_id"
              fieldType="BigInt"
              initialValue={init.partnerId}
            >
              {(helper) => (
                <>
                  <Typography level="body-xs" className="text-tertiary mb-1">
                    {labels.partner}
                  </Typography>
                  <TableRecordSelect
                    tableName="crm_partners"
                    value={helper.value}
                    onSelectValue={(s, value) => helper.setValue(s, value)}
                    placeholder="Search partners..."
                  />
                </>
              )}
            </Form.Field>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Helper to get extended item field values from a Write table state.
 * Use this in Write hooks like afterTransactionStart.
 */
export function getExtendedItemFieldsFromWriteState(tableName: string): {
  itemName: Sql;
  estimatedValue: Sql;
  probabilityPct: Sql;
  expectedCloseDate: Sql;
  riskLevel: Sql;
  successMetricsDefined: Sql;
  businessCaseScore: Sql;
  competitiveLandscape: Sql;
  partnerId: Sql;
  notes: Sql;
  useCaseCategory: Sql;
} {
  const t = sql.ref(`ui.${tableName}`);
  return {
    itemName:
      sql`case when ${t}.opportunity_name = '' then null else ${t}.opportunity_name end`,
    estimatedValue: sql`${t}.estimated_value`,
    probabilityPct: sql`${t}.probability_pct`,
    expectedCloseDate:
      sql`case when ${t}.expected_close_date = '' then null else try_cast(${t}.expected_close_date as date) end`,
    riskLevel:
      sql`case when ${t}.risk_level = '' then null else ${t}.risk_level end`,
    successMetricsDefined: sql`${t}.success_metrics_defined`,
    businessCaseScore: sql`${t}.business_case_score`,
    competitiveLandscape:
      sql`case when ${t}.competitive_landscape = '' then null else ${t}.competitive_landscape end`,
    partnerId: sql`${t}.partner_id`,
    useCaseCategory: sql`nullif(${t}.use_case_category, '')`,
    notes:
      sql`case when ${t}.pain_points = '' then null else ${t}.pain_points end`,
  };
}

interface ExtendedItemDetailsCardProps {
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  /** Custom labels for the fields */
  labels?: ExtendedItemFieldLabels;
  /** Title for the card. Default: "Details" */
  cardTitle?: string;
  onSave?: (s: UiServerStatements) => void;
}

/**
 * Card component for displaying and editing extended pipeline item details.
 * Uses Data component for display and Form for editing.
 */
export function ExtendedItemDetailsCard(props: ExtendedItemDetailsCardProps) {
  const block = system.block(CrmBlock);
  const itemsTable = block.pipelineItemsTableName;
  const activityLogTable = block.pipelineActivityLogTableName;
  const hasActivityLog = block.hasPipelineActivityLogEnabled(
    props.pipeline.name,
  );
  const hasPartnerAttachment = props.pipeline.enablePartnerAttachment;
  const labels = { ...defaultLabels, ...props.labels };
  const cardTitle = props.cardTitle ?? "Details";

  return (
    <Card variant="outlined">
      <CardHeader>
        <Typography startIcon="TrendingUp" level="title-md">
          {cardTitle}
        </Typography>
      </CardHeader>
      <Data
        procedure={(s) => {
          s.defRecord(
            "item_ext",
            sql`select * from db.${
              sql.ref(itemsTable)
            } where id = ${props.itemId}`,
          );
          s.defScalar("editing", false);
        }}
      >
        <div className="p-4">
          <Show when={sql`not editing`}>
            <ExtendedItemReadView
              labels={labels}
              hasQualification={props.pipeline.opportunityFields?.qualification}
            />
          </Show>

          <Show when={sql`editing`}>
            <ExtendedItemEditForm
              pipeline={props.pipeline}
              itemId={props.itemId}
              itemsTable={itemsTable}
              activityLogTable={activityLogTable}
              hasActivityLog={hasActivityLog}
              hasPartnerAttachment={hasPartnerAttachment ?? false}
              labels={labels}
              onSave={props.onSave}
            />
          </Show>
        </div>
      </Data>
    </Card>
  );
}

function ExtendedItemReadView(
  props: {
    labels: Required<ExtendedItemFieldLabels>;
    hasQualification?: boolean;
  },
) {
  const { labels } = props;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Typography level="body-xs" className="text-tertiary">
          {labels.name}
        </Typography>
        <Button
          variant="plain"
          color="primary"
          size="sm"
          startIcon="Edit"
          onClick={(s) => s.setScalar("editing", true)}
        >
          Edit
        </Button>
      </div>

      <Show
        when={sql`item_ext.opportunity_name is not null`}
        fallback={
          <Typography level="body-sm" className="text-tertiary italic">
            Not set
          </Typography>
        }
      >
        <Typography level="body-md" className="font-medium">
          {sql`item_ext.opportunity_name`}
        </Typography>
      </Show>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Typography level="body-xs" className="text-tertiary">
            {labels.estimatedValue}
          </Typography>
          <Show
            when={sql`item_ext.estimated_value is not null`}
            fallback={
              <Typography level="body-sm" className="text-tertiary">
                -
              </Typography>
            }
          >
            <Typography level="body-sm">
              ${sql`format.decimal(item_ext.estimated_value)`}
            </Typography>
          </Show>
        </div>

        <div>
          <Typography level="body-xs" className="text-tertiary">
            {labels.probability}
          </Typography>
          <Show
            when={sql`item_ext.probability_pct is not null`}
            fallback={
              <Typography level="body-sm" className="text-tertiary">
                -
              </Typography>
            }
          >
            <Typography level="body-sm">
              {sql`item_ext.probability_pct`}%
            </Typography>
          </Show>
        </div>

        <div>
          <Typography level="body-xs" className="text-tertiary">
            {labels.expectedCloseDate}
          </Typography>
          <Show
            when={sql`item_ext.expected_close_date is not null`}
            fallback={
              <Typography level="body-sm" className="text-tertiary">
                -
              </Typography>
            }
          >
            <Typography level="body-sm">
              {sql`format.date(item_ext.expected_close_date, '%b %d, %Y')`}
            </Typography>
          </Show>
        </div>

        <div>
          <Typography level="body-xs" className="text-tertiary">
            {labels.riskLevel}
          </Typography>
          <Show
            when={sql`item_ext.risk_level is not null`}
            fallback={
              <Typography level="body-sm" className="text-tertiary">
                -
              </Typography>
            }
          >
            <Show when={sql`item_ext.risk_level = 'high'`}>
              <Chip size="sm" variant="soft" color="danger">High</Chip>
            </Show>
            <Show when={sql`item_ext.risk_level = 'medium'`}>
              <Chip size="sm" variant="soft" color="warning">Medium</Chip>
            </Show>
            <Show when={sql`item_ext.risk_level = 'low'`}>
              <Chip size="sm" variant="soft" color="success">Low</Chip>
            </Show>
          </Show>
        </div>

        {props.hasQualification && (
          <div>
            <Typography level="body-xs" className="text-tertiary">
              Use Case Category
            </Typography>
            <Typography level="body-sm">
              {sql`coalesce(item_ext.use_case_category, '-')`}
            </Typography>
          </div>
        )}

        {props.hasQualification && (
          <div>
            <Typography level="body-xs" className="text-tertiary">
              {labels.businessCaseScore}
            </Typography>
            <Show
              when={sql`item_ext.business_case_score is not null`}
              fallback={
                <Typography level="body-sm" className="text-tertiary">
                  -
                </Typography>
              }
            >
              <Typography level="body-sm">
                {sql`item_ext.business_case_score`}/5
              </Typography>
            </Show>
          </div>
        )}

        {props.hasQualification && (
          <div>
            <Typography level="body-xs" className="text-tertiary">
              {labels.successMetrics}
            </Typography>
            <Typography level="body-sm">
              {sql`case when item_ext.success_metrics_defined then 'Yes' else 'No' end`}
            </Typography>
          </div>
        )}
      </div>

      <Show when={sql`item_ext.pain_points is not null`}>
        <div>
          <Typography level="body-xs" className="text-tertiary">
            {labels.notes}
          </Typography>
          <Typography level="body-sm" className="whitespace-pre-wrap">
            {sql`item_ext.pain_points`}
          </Typography>
        </div>
      </Show>

      {props.hasQualification && (
        <Show when={sql`item_ext.competitive_landscape is not null`}>
          <div>
            <Typography level="body-xs" className="text-tertiary">
              {labels.competitiveLandscape}
            </Typography>
            <Typography level="body-sm" className="whitespace-pre-wrap">
              {sql`item_ext.competitive_landscape`}
            </Typography>
          </div>
        </Show>
      )}
    </div>
  );
}

interface ExtendedItemEditFormProps {
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  itemsTable: string;
  activityLogTable: string;
  hasActivityLog: boolean;
  hasPartnerAttachment: boolean;
  labels: Required<ExtendedItemFieldLabels>;
  onSave?: (s: UiServerStatements) => void;
}

function ExtendedItemEditForm(props: ExtendedItemEditFormProps) {
  const fields = getExtendedItemFieldsFromWriteState("item_ext_edit");

  return (
    <Form
      afterTransactionStart={(s) => {
        s.modify(sql`
          update db.${sql.ref(props.itemsTable)}
          set
            opportunity_name = ${fields.itemName},
            estimated_value = ${fields.estimatedValue},
            probability_pct = ${fields.probabilityPct},
            expected_close_date = ${fields.expectedCloseDate},
            risk_level = ${fields.riskLevel},
            pain_points = ${fields.notes},
            ${
          props.pipeline.opportunityFields?.qualification
            ? sql`
              use_case_category = ${fields.useCaseCategory},
              success_metrics_defined = ${fields.successMetricsDefined},
              business_case_score = ${fields.businessCaseScore},
              competitive_landscape = ${fields.competitiveLandscape},`
            : sql``
        }
            ${
          props.hasPartnerAttachment
            ? sql`partner_id = ${fields.partnerId}, partner_attached = case when ${fields.partnerId} is not null then true else false end,`
            : sql``
        }
            last_modified_at = now()
          where id = ${props.itemId}
        `);

        if (props.hasActivityLog) {
          s.modify(sql`
            insert into db.${sql.ref(props.activityLogTable)}
              (pipeline_item_id, activity_type, description, sys_user_id, created_at)
            values
              (${props.itemId}, 'field_updated', 'Updated item details', current_user, now())
          `);
        }

        s.increment("ui.refresh_key");

        if (props.onSave) {
          props.onSave(s);
        }
      }}
      afterSubmitClientSuccess={(s) => {
        s.setScalar("editing", false);
      }}
    >
      <Form.Temporary name="item_ext_edit">
        <ExtendedItemFieldsForm
          hasPartnerAttachment={props.hasPartnerAttachment}
          hasQualification={props.pipeline.opportunityFields?.qualification}
          includeNotes
          labels={props.labels}
          initialValues={{
            itemName: sql`coalesce(item_ext.opportunity_name, '')`,
            useCaseCategory: sql`item_ext.use_case_category`,
            estimatedValue: sql`item_ext.estimated_value`,
            probabilityPct: sql`item_ext.probability_pct`,
            expectedCloseDate:
              sql`coalesce(cast(item_ext.expected_close_date as string), '')`,
            riskLevel: sql`coalesce(item_ext.risk_level, '')`,
            notes: sql`coalesce(item_ext.pain_points, '')`,
            successMetricsDefined:
              sql`coalesce(item_ext.success_metrics_defined, false)`,
            businessCaseScore: sql`item_ext.business_case_score`,
            competitiveLandscape:
              sql`coalesce(item_ext.competitive_landscape, '')`,
            partnerId: sql`item_ext.partner_id`,
          }}
        />
      </Form.Temporary>

      <div className="flex justify-end gap-2 mt-6">
        <Button
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("editing", false)}
        >
          Cancel
        </Button>
        <Form.SubmitButton variant="solid" color="primary">
          Save
        </Form.SubmitButton>
      </div>
      <Form.ErrorAlert className="mt-3" mode="all" />
    </Form>
  );
}
