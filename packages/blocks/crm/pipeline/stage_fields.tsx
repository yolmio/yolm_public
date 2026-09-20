import { Alert } from "components/alert";
import { Button } from "components/button";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type {
  DomStatements,
  HelperProcField,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import { Show } from "std/ui";
import { Data } from "std/data";
import type { CrmBlock } from "../index";
import type {
  PipelineConfig,
  PipelineStageConfig,
  PipelineStageFieldConfig,
} from "./types";
import { toDisplayName } from "../helpers";

interface StageFieldsFormProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  stageName: Sql;
  onSave?: (s: UiServerStatements) => void;
  readOnly?: boolean;
}

export function StageFieldsForm(props: StageFieldsFormProps) {
  const { block, pipeline } = props;
  const stageDataTable = block.pipelineStageDataTableName;

  return (
    <Data
      procedure={(s) => {
        s.defScalar("edit_mode", false);
        s.defScalar("error", { type: "String" });

        s.defTable(
          "stage_field_values",
          sql`select * from db.${sql.ref(stageDataTable)}
              where pipeline_item_id = ${props.itemId}`,
        );
      }}
    >
      {pipeline.stages.map((stage) => (
        <Show when={sql`${props.stageName} = ${sql.lit(stage.name)}`}>
          <StageFieldsContent
            block={block}
            pipeline={pipeline}
            stage={stage}
            itemId={props.itemId}
            onSave={props.onSave}
            readOnly={props.readOnly}
          />
        </Show>
      ))}
    </Data>
  );
}

interface StageFieldsContentProps {
  block: CrmBlock;
  pipeline: PipelineConfig;
  stage: PipelineStageConfig;
  itemId: NumericExpr;
  onSave?: (s: UiServerStatements) => void;
  readOnly?: boolean;
}

function StageFieldsContent(props: StageFieldsContentProps) {
  const { block, pipeline, stage } = props;

  const fields = stage.fields ?? [];

  if (fields.length === 0) {
    return (
      <div className="text-center py-6 text-tertiary">
        <MaterialIcon icon="Notes" className="text-3xl mb-2 opacity-50" />
        <Typography level="body-sm">
          No fields configured for this stage
        </Typography>
      </div>
    );
  }

  return (
    <Data
      local
      procedure={(s) => {
        fields.forEach((field) => {
          const stringValueQuery = sql`(
            select string_value
            from stage_field_values
            where stage_name = ${sql.lit(stage.name)}
            and field_name = ${sql.lit(field.name)}
          )`;
          const numericValueQuery = sql`(
            select numeric_value
            from stage_field_values
            where stage_name = ${sql.lit(stage.name)}
            and field_name = ${sql.lit(field.name)}
          )`;
          const boolValueQuery = sql`(
            select bool_value
            from stage_field_values
            where stage_name = ${sql.lit(stage.name)}
            and field_name = ${sql.lit(field.name)}
          )`;
          const dateValueQuery = sql`(
            select date_value
            from stage_field_values
            where stage_name = ${sql.lit(stage.name)}
            and field_name = ${sql.lit(field.name)}
          )`;

          switch (field.type) {
            case "string":
            case "text":
            case "enum":
              s.defScalar(
                `field_${field.name}`,
                sql`coalesce(${stringValueQuery}, '')`,
              );
              break;
            case "number":
            case "decimal":
            case "score":
              s.defScalar(
                `field_${field.name}`,
                numericValueQuery,
              );
              break;
            case "bool":
              s.defScalar(`field_${field.name}`, { type: "Bool" });
              s.setScalar(`field_${field.name}`, boolValueQuery);
              break;
            case "date":
              s.defScalar(`field_${field.name}`, { type: "Date" });
              s.setScalar(`field_${field.name}`, dateValueQuery);
              break;
            case "fk":
              s.defScalar(`field_${field.name}`, { type: "BigInt" });
              s.setScalar(
                `field_${field.name}`,
                sql`cast(${numericValueQuery} as bigint)`,
              );
              break;
          }
        });
      }}
    >
      <Show
        when={sql`edit_mode`}
        fallback={
          <StageFieldsReadOnly
            fields={fields}
            stage={stage}
            onEdit={(s) => s.setScalar("edit_mode", true)}
            readOnly={props.readOnly}
          />
        }
      >
        <StageFieldsEdit
          fields={fields}
          stage={stage}
          block={block}
          pipeline={pipeline}
          itemId={props.itemId}
          onSave={props.onSave}
        />
      </Show>
    </Data>
  );
}

interface StageFieldsReadOnlyProps {
  fields: PipelineStageFieldConfig[];
  stage: PipelineStageConfig;
  onEdit: (s: DomStatements) => void;
  readOnly?: boolean;
}

function StageFieldsReadOnly(props: StageFieldsReadOnlyProps) {
  const { fields, stage } = props;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <Typography level="body-sm" className="text-tertiary">
          {stage.displayName ?? toDisplayName(stage.name)} Fields
        </Typography>
        <Show when={sql`${!props.readOnly}`}>
          <Button
            size="sm"
            variant="plain"
            color="primary"
            startIcon="Edit"
            onClick={props.onEdit}
          >
            Edit
          </Button>
        </Show>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((field) => (
          <div className="space-y-1">
            <Typography level="body-xs" className="text-tertiary">
              {field.displayName ?? toDisplayName(field.name)}
              {field.required && (
                <span className="text-danger-500 ml-1">
                  *
                </span>
              )}
            </Typography>
            <FieldValueDisplay field={field} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface FieldValueDisplayProps {
  field: PipelineStageFieldConfig;
}

function FieldValueDisplay(props: FieldValueDisplayProps) {
  const { field } = props;
  const fieldValue = sql`field_${sql.ref(field.name)}`;

  switch (field.type) {
    case "string":
    case "text":
      return (
        <Show
          when={sql`${fieldValue} is not null and ${fieldValue} != ''`}
          fallback={
            <Typography level="body-sm" className="text-tertiary italic">
              Not set
            </Typography>
          }
        >
          <Typography level="body-sm" className="whitespace-pre-wrap">
            {fieldValue}
          </Typography>
        </Show>
      );

    case "number":
    case "decimal":
      return (
        <Show
          when={sql`${fieldValue} is not null`}
          fallback={
            <Typography level="body-sm" className="text-tertiary italic">
              Not set
            </Typography>
          }
        >
          <Typography level="body-sm">{fieldValue}</Typography>
        </Show>
      );

    case "score": {
      const range = field.scoreRange ?? { min: 0, max: 100 };
      return (
        <Show
          when={sql`${fieldValue} is not null`}
          fallback={
            <Typography level="body-sm" className="text-tertiary italic">
              Not set
            </Typography>
          }
        >
          <Typography level="body-sm" className="font-medium">
            {fieldValue} / {range.max}
          </Typography>
        </Show>
      );
    }

    case "bool":
      return (
        <Show
          when={sql`${fieldValue} is not null`}
          fallback={
            <Typography level="body-sm" className="text-tertiary italic">
              Not set
            </Typography>
          }
        >
          <Show
            when={fieldValue}
            fallback={<Chip size="sm" color="neutral" variant="soft">No</Chip>}
          >
            <Chip size="sm" color="success" variant="soft">Yes</Chip>
          </Show>
        </Show>
      );

    case "date":
      return (
        <Show
          when={sql`${fieldValue} is not null`}
          fallback={
            <Typography level="body-sm" className="text-tertiary italic">
              Not set
            </Typography>
          }
        >
          <Typography level="body-sm">
            {sql`format.date(${fieldValue}, '%B %d, %Y')`}
          </Typography>
        </Show>
      );

    case "enum":
      return (
        <Show
          when={sql`${fieldValue} is not null and ${fieldValue} != ''`}
          fallback={
            <Typography level="body-sm" className="text-tertiary italic">
              Not set
            </Typography>
          }
        >
          <Chip size="sm" variant="soft" color="primary">
            {sql`string.capitalize(replace(${fieldValue}, '_', ' '))`}
          </Chip>
        </Show>
      );

    default:
      return (
        <Typography level="body-sm" className="text-tertiary italic">
          Unknown field type
        </Typography>
      );
  }
}

interface StageFieldsEditProps {
  fields: PipelineStageFieldConfig[];
  stage: PipelineStageConfig;
  block: CrmBlock;
  pipeline: PipelineConfig;
  itemId: NumericExpr;
  onSave?: (s: UiServerStatements) => void;
}

function StageFieldsEdit(props: StageFieldsEditProps) {
  const { fields, stage, block, pipeline, itemId } = props;

  function saveFields(s: DomStatements) {
    s.setScalar("error", sql.null);
    for (const field of fields) {
      const fieldValue = sql`field_${sql.ref(field.name)}`;
      const displayName = field.displayName ?? toDisplayName(field.name);
      if (field.required) {
        const missingValue = field.type === "string" ||
            field.type === "text" || field.type === "enum"
          ? sql`nullif(trim(${fieldValue}), '') is null`
          : sql`${fieldValue} is null`;
        s.if(missingValue, (s) => {
          s.setScalar("error", sql.lit`${displayName} is required.`);
          s.commitUiTreeChanges();
          s.return();
        });
      }
      if (field.type === "score") {
        const range = field.scoreRange ?? { min: 0, max: 100 };
        s.if(
          sql`${fieldValue} is not null and (${fieldValue} < ${
            sql(String(range.min))
          } or ${fieldValue} > ${sql(String(range.max))})`,
          (s) => {
            s.setScalar(
              "error",
              sql
                .lit`${displayName} must be between ${range.min} and ${range.max}.`,
            );
            s.commitUiTreeChanges();
            s.return();
          },
        );
      }
    }
    s.commitUiTreeChanges();

    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.callStoredProcedure(
          stageFieldSaveProcedureName(block, pipeline.name, stage.name),
          {
            inputScalars: {
              p_item_id: itemId,
              ...Object.fromEntries(
                fields.map((
                  field,
                ) => [`field_${field.name}`, sql.ref(`field_${field.name}`)]),
              ),
            },
          },
        );
        s.commitTransaction();

        s.setScalar("edit_mode", false);
        if (props.onSave) {
          props.onSave(s);
        }
      },
      catch: (s) => {
        s.setScalar("error", sql.lit`Failed to save fields`);
      },
    });
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <Typography level="body-sm" className="text-tertiary">
          {stage.displayName ?? toDisplayName(stage.name)} Fields
        </Typography>
      </div>

      <div className="space-y-4">
        {fields.map((field) => (
          <FieldInput field={field} stage={stage} pipeline={pipeline} />
        ))}
      </div>

      <Show when={sql`error is not null`}>
        <Alert color="danger" className="mt-4">{sql`error`}</Alert>
      </Show>

      <div className="flex justify-end gap-2 mt-4">
        <Button
          variant="plain"
          color="neutral"
          onClick={(s) => s.setScalar("edit_mode", false)}
        >
          Cancel
        </Button>
        <Button
          variant="solid"
          color="primary"
          onClick={saveFields}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}

interface FieldInputProps {
  field: PipelineStageFieldConfig;
  stage: PipelineStageConfig;
  pipeline: PipelineConfig;
}

function FieldInput(props: FieldInputProps) {
  const { field } = props;
  const fieldScalar = `field_${field.name}`;
  const displayName = field.displayName ?? toDisplayName(field.name);

  // Use generation-time branching to avoid all branches being validated
  function renderFieldInput() {
    switch (field.type) {
      case "string":
        return (
          <Input
            value={sql`${sql.ref(fieldScalar)}`}
            onInput={(s) => s.setScalar(fieldScalar, sql`target_value`)}
            placeholder={`Enter ${displayName.toLowerCase()}`}
          />
        );

      case "text":
        return (
          <Textarea
            value={sql`${sql.ref(fieldScalar)}`}
            onInput={(s) => s.setScalar(fieldScalar, sql`target_value`)}
            placeholder={`Enter ${displayName.toLowerCase()}`}
            minRows={3}
          />
        );

      case "number":
      case "decimal":
        return (
          <Input
            type="number"
            value={sql`${sql.ref(fieldScalar)}`}
            onInput={(s) =>
              s.setScalar(
                fieldScalar,
                sql`try_cast(nullif(target_value, '') as decimal)`,
              )}
            placeholder={`Enter ${displayName.toLowerCase()}`}
          />
        );

      case "score": {
        const range = field.scoreRange ?? { min: 0, max: 100 };
        return (
          <Input
            type="number"
            value={sql`${sql.ref(fieldScalar)}`}
            onInput={(s) =>
              s.setScalar(
                fieldScalar,
                sql`try_cast(nullif(target_value, '') as decimal)`,
              )}
            slotProps={{
              input: {
                min: range.min,
                max: range.max,
              },
            }}
            endDecorator={
              <Typography level="body-sm">/ {range.max}</Typography>
            }
          />
        );
      }

      case "bool":
        return (
          <Checkbox
            bindScalar={fieldScalar}
            label={displayName}
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={sql`cast(${sql.ref(fieldScalar)} as string)`}
            onInput={(s) =>
              s.setScalar(fieldScalar, sql`cast(target_value as date)`)}
          />
        );

      case "enum":
        return <EnumFieldSelect field={field} fieldScalar={fieldScalar} />;

      case "fk":
        // FK fields would need custom handling based on target table
        return (
          <Input
            type="number"
            value={sql`${sql.ref(fieldScalar)}`}
            onInput={(s) =>
              s.setScalar(
                fieldScalar,
                sql`try_cast(nullif(target_value, '') as bigint)`,
              )}
            placeholder={`Enter ID`}
          />
        );

      default:
        return (
          <Typography level="body-sm" className="text-tertiary">
            Unsupported field type: {field.type}
          </Typography>
        );
    }
  }

  return (
    <div>
      <Typography level="body-sm" className="mb-1 font-medium">
        {displayName}
        {field.required && <span className="text-danger-500 ml-1">*</span>}
      </Typography>
      {field.description && (
        <Typography level="body-xs" className="text-tertiary mb-2">
          {field.description}
        </Typography>
      )}
      {renderFieldInput()}
    </div>
  );
}

interface EnumFieldSelectProps {
  field: PipelineStageFieldConfig;
  fieldScalar: string;
}

function EnumFieldSelect(props: EnumFieldSelectProps) {
  const { field, fieldScalar } = props;

  const values = field.enumValues ??
    (field.enumName
      ? Object.values(system.enums[field.enumName]?.values ?? {})
      : []);

  return (
    <Select
      value={sql`${sql.ref(fieldScalar)}`}
      onChange={(s) => s.setScalar(fieldScalar, sql`target_value`)}
    >
      <Select.Option value="">Select...</Select.Option>
      {values.map((v) => (
        <Select.Option value={v.name}>
          {v.displayName ?? toDisplayName(v.name)}
        </Select.Option>
      ))}
    </Select>
  );
}

function stageFieldSaveProcedureName(
  block: CrmBlock,
  pipelineName: string,
  stageName: string,
) {
  return `${
    block.getPipelineStageEnumName(pipelineName)
  }_${stageName}_save_fields`;
}

/** Registers server validation and persistence once per configured stage. */
export function registerStageFieldSaveProcedure(
  block: CrmBlock,
  pipeline: PipelineConfig,
  stage: PipelineStageConfig,
) {
  const fields = stage.fields ?? [];
  const stageDataTable = block.pipelineStageDataTableName;
  const activityLogTable = block.pipelineActivityLogTableName;
  const hasActivityLog = block.hasPipelineActivityLogEnabled(pipeline.name);
  const inputs: HelperProcField[] = fields.map((field) => {
    let type: HelperProcField["type"];
    switch (field.type) {
      case "string":
      case "text":
      case "enum":
        type = { type: "String", maxLength: 10000 };
        break;
      case "number":
      case "decimal":
      case "score":
        type = { type: "Decimal", precision: 18, scale: 4, signed: true };
        break;
      case "bool":
        type = "Bool";
        break;
      case "date":
        type = "Date";
        break;
      case "fk":
        type = "BigInt";
        break;
    }
    return { name: `field_${field.name}`, type };
  });
  system.storedProcedure({
    name: stageFieldSaveProcedureName(block, pipeline.name, stage.name),
    transaction: "caller",
    inputScalars: [{ name: "p_item_id", type: "BigInt" }, ...inputs],
    procedure: (s) => {
      for (const field of fields) {
        const fieldValue = sql`field_${sql.ref(field.name)}`;
        const displayName = field.displayName ?? toDisplayName(field.name);
        if (field.required) {
          const missingValue = field.type === "string" ||
              field.type === "text" || field.type === "enum"
            ? sql`nullif(trim(${fieldValue}), '') is null`
            : sql`${fieldValue} is null`;
          s.throwErrorIf(
            missingValue,
            sql.lit`${displayName} is required.`,
          );
        }
        if (field.type === "score") {
          const range = field.scoreRange ?? { min: 0, max: 100 };
          s.throwErrorIf(
            sql`${fieldValue} is not null and (${fieldValue} < ${
              sql(String(range.min))
            } or ${fieldValue} > ${sql(String(range.max))})`,
            sql
              .lit`${displayName} must be between ${range.min} and ${range.max}.`,
          );
        }
      }

      fields.forEach((field) => {
        const fieldValue = sql`field_${sql.ref(field.name)}`;

        let stringValue: Sql = sql`null`;
        let numericValue: Sql = sql`null`;
        let boolValue: Sql = sql`null`;
        let dateValue: Sql = sql`null`;

        switch (field.type) {
          case "string":
          case "text":
          case "enum":
            stringValue = fieldValue;
            break;
          case "number":
          case "decimal":
          case "score":
            numericValue = fieldValue;
            break;
          case "bool":
            boolValue = fieldValue;
            break;
          case "date":
            dateValue = fieldValue;
            break;
          case "fk":
            numericValue = sql`cast(${fieldValue} as decimal)`;
            break;
        }

        // Delete existing then insert (upsert pattern)
        s.modify(sql`
            delete from db.${sql.ref(stageDataTable)}
            where pipeline_item_id = p_item_id
              and stage_name = ${sql.lit(stage.name)}
              and field_name = ${sql.lit(field.name)}
          `);
        s.modify(sql`
            insert into db.${sql.ref(stageDataTable)}
              (pipeline_item_id, stage_name, field_name, string_value, numeric_value, bool_value, date_value, created_at, last_modified_at)
            values
              (p_item_id, ${sql.lit(stage.name)}, ${
          sql.lit(field.name)
        }, ${stringValue}, ${numericValue}, ${boolValue}, ${dateValue}, now(), now())
          `);
      });

      s.modify(sql`
          update db.${sql.ref(block.pipelineItemsTableName)}
          set last_modified_at = now()
          where id = p_item_id
        `);

      if (hasActivityLog) {
        s.modify(sql`
            insert into db.${sql.ref(activityLogTable)}
              (pipeline_item_id, activity_type, description, sys_user_id, created_at)
            values
              (p_item_id, 'field_updated', 'Updated stage fields', current_user, now())
          `);
      }
    },
  });
}
