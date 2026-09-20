import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { Divider } from "components/divider";
import { EachSelect } from "components/each_select";
import { EnumSelect } from "components/enum_select";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { MaterialIcon } from "components/material_icon";
import { Radio } from "components/radio";
import { RadioGroup } from "components/radio_group";
import { Select } from "components/select";
import { Step, StepIndicator, Stepper } from "components/stepper";
import { SwitchControl } from "components/switch";
import { Table as TableComponent } from "components/table";
import { Typography } from "components/typography";
import { getUniqueUiId } from "components/utils";
import { Data } from "std/data";
import { downcaseFirst, pluralize } from "std/inflectors";
import {
  insertValueColumns,
  selectColumn,
  sql,
  updateAssignment,
  valuesRow,
} from "../std/sql_utils";
import type {
  AnyExpr,
  SelectColumn,
  Sql,
  UpdateAssignment,
} from "../std/sql_utils";
import type {
  DomStatements,
  HelperProcField,
  IStatementsBase,
  StateStatements,
  UiServerStatements,
} from "std/statements";
import {
  baseGridStyles,
  containerStyles,
  createStyles,
  cssVar,
  flexGrowStyles,
  visuallyHiddenStyles,
} from "std/style_utils";
import { system } from "std/system";
import type { Field, Table } from "std/system";
import type { Node } from "std/ui";
import { Each, Match, Route, Show, Switch, useState } from "std/ui";
import {
  defaultInitialValue,
  formFieldType,
  getDbValueFromFormValue,
} from "std/form";
import type { FormFieldHelper } from "std/form";

const styles = createStyles({
  buttonScreen: () => ({
    ...containerStyles(),
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    my: 12,
    gap: 4,
  }),
  successScreen: () => ({
    ...containerStyles(),
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    my: 12,
  }),
  importScreen: () => ({
    ...containerStyles(),
    display: "flex",
    flexDirection: "column",
    py: 12,
  }),
  importHeader: {
    display: "flex",
    gap: 2,
    pb: 2,
  },
  field: {
    gridColumnSpan: 12,
    "&:not(:last-child)": {
      borderBottom: "1px solid",
      borderColor: "divider",
    },
    borderColor: "divider",
    gap: 4,
    pb: 3,
    ...baseGridStyles,
  },

  fieldInput: {
    gridColumnSpan: 3,
  },
  switchWrapper: {
    display: "flex",
    justifyContent: "start",
    pt: 1,
  },
  cardContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldContainer: {
    ...baseGridStyles,
    gap: 4,
  },
  previewStatsContainer: {
    display: "flex",
    justifyContent: "space-around",
    gap: 8,
    flexWrap: "wrap",
  },
  successCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  importCard: {
    gap: 4,
  },
  importHeaderTypography: {
    gridColumnSpan: 12,
  },
  stepper: {
    width: "100%",
    mb: 4,
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },

  fieldLabel: {
    gridColumnSpan: 2,
    fontFamily: cssVar("font-family-body"),
    fontSize: "base",
    fontWeight: "semibold",
    color: "text-primary",
    my: 0,
  },
  select: {
    width: "100%",
    minWidth: 0, // This allows the select to shrink below its minimum content size
  },
  selectOption: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

interface CsvImportConfig {
  headerVariations?: string[];
  initialTransform?: AnyExpr;
}

interface ImportField {
  field: Field;
  csvImport?: boolean | CsvImportConfig;
  constant?: boolean;
  neverUpdate?: boolean;
}

export interface BulkMergeImportMatchRule {
  /** Stable key referenced by matching strategies. */
  name: string;
  /** User-facing identifier label shown with candidate matches. */
  displayName: string;
  /** Imported field whose value is used to find candidates. */
  sourceField: string;
  /** Target-table field compared with the imported value. Defaults to sourceField. */
  targetField?: string;
  /** Normalize both imported and stored values before comparing them. */
  normalize?: (value: Sql) => Sql;
  /** Whether duplicate values within the file are errors. Defaults to true. */
  deduplicateRows?: boolean;
  /** Lower values are preferred. Lower-priority rules are fallback-only for each row. Defaults to 0. */
  priority?: number;
}

export interface BulkMergeImportMatchStrategy {
  /** Stable strategy key stored in UI state. */
  name: string;
  /** User-facing strategy label. */
  displayName: string;
  /** Optional explanation rendered below the strategy choice. */
  description?: string;
  /** Match-rule names enabled by this strategy. */
  rules: string[];
}

export interface BulkMergeImportMatchingConfig {
  /** Strategy selected when the import wizard opens. */
  defaultStrategy: string;
  strategies: BulkMergeImportMatchStrategy[];
  rules: BulkMergeImportMatchRule[];
}

function hasUniqueNameConstraint(table: Table) {
  return table.fields.name?.unique ||
    table.uniqueConstraints.some((constraint) =>
      constraint.fields.length === 1 && constraint.fields[0] === "name"
    );
}

function hasSingleFieldUniqueConstraint(table: Table, fieldName: string) {
  return table.fields[fieldName]?.unique ||
    table.uniqueConstraints.some((constraint) =>
      constraint.fields.length === 1 && constraint.fields[0] === fieldName
    );
}

// todo it would make sense to standardize these two concepts (table that can be auto inserted)
function canAutoInsertTable(tableName: string) {
  const table = system.db.tables[tableName];
  return (
    hasUniqueNameConstraint(table) &&
    !Object.values(table.fields).some((f) =>
      f.name !== "name" && f.notNull && f.default === undefined
    )
  );
}

function canAutoImportTable(tableName: string) {
  const table = system.db.tables[tableName];
  return hasUniqueNameConstraint(table) && table.fields.name.notNull;
}

function getImportFieldConfig(
  mergeField: string,
  field: Field,
  importFieldOpts: Omit<ImportField, "field">,
): ImportField {
  let csvImport: CsvImportConfig | true | undefined;
  if (importFieldOpts.csvImport) {
    csvImport = importFieldOpts.csvImport;
  } else if (
    importFieldOpts.csvImport !== false &&
    !(field.type === "ForeignKey" && !canAutoImportTable(field.table)) &&
    field.type !== "Ordering" &&
    field.type !== "Tx"
  ) {
    const headerVariations: string[] = [];
    if (field.name.includes("_")) {
      headerVariations.push(field.name.replaceAll("_", " "));
      headerVariations.push(field.name.replaceAll("_", ""));
    }
    let initialTransform: Sql | undefined;
    switch (field.name) {
      case "phone_number": {
        headerVariations.push("phone");
        break;
      }
      case "phone": {
        headerVariations.push("phone_number");
        headerVariations.push("phonenumber");
        headerVariations.push("phone number");
        break;
      }
      case "email": {
        headerVariations.push("email address");
        headerVariations.push("email_address");
        headerVariations.push("emailaddress");
        break;
      }
      case "first_name": {
        headerVariations.push("name");
        initialTransform = sql`(case
            when exists (select 1 from header where lower(trim(value)) in ('first_name', 'first name')) then 'none'
            else 'extract_first_name'
        end)`;
        break;
      }
      case "last_name": {
        headerVariations.push("name");
        initialTransform = sql`(case
            when exists (select 1 from header where lower(trim(value)) in ('last_name', 'last name')) then 'none'
            else 'extract_last_name'
        end)`;
        break;
      }
    }
    csvImport = { headerVariations, initialTransform };
  }
  const defaultConstant = mergeField !== field.name;
  return {
    field,
    csvImport,
    constant: importFieldOpts.constant ?? defaultConstant,
    neverUpdate: importFieldOpts.neverUpdate,
  };
}

function mappingState(fields: ImportField[]) {
  const stateFields: HelperProcField[] = [];
  const formFieldNames: string[] = [];
  const formFieldInitialValues: AnyExpr[] = [];
  const initScalars: HelperProcField[] = [];
  const initScalarValues: { name: string; expr: AnyExpr }[] = [];
  for (const config of fields) {
    stateFields.push({
      name: `${config.field.name}_error`,
      type: { type: "String", maxLength: 65000 },
    });
    if (config.constant) {
      stateFields.push({
        name: config.field.name,
        type: formFieldType(config.field),
      });
      formFieldNames.push(config.field.name);
      formFieldInitialValues.push(defaultInitialValue(config.field));
    }
    const importConfig = typeof config.csvImport !== "object"
      ? {}
      : config.csvImport;
    if (config.csvImport) {
      const headerVariations = [
        config.field.name,
        ...(importConfig.headerVariations ?? []),
      ]
        .map((v) => sql.lit(v).toSQL())
        .join(",");
      const ordinalName = `${config.field.name}_csv_ordinal`;
      stateFields.push({
        name: ordinalName,
        type: "Int",
      });
      formFieldNames.push(ordinalName);
      const bodyOrdinalExpr =
        sql`(select ordinal from header where lower(trim(value)) in (${
          sql(headerVariations)
        }) order by ordinal limit 1)`;
      const ordinalInitName = `__${config.field.name}_csv_ordinal_initial`;
      initScalars.push({ name: ordinalInitName, type: "Int" });
      initScalarValues.push({ name: ordinalInitName, expr: bodyOrdinalExpr });
      formFieldInitialValues.push(sql.ref(ordinalInitName));
      const transformName = `${config.field.name}_csv_transform`;
      stateFields.push({
        name: transformName,
        type: { type: "Enum", enum: "csv_import_source_transform" },
      });
      formFieldNames.push(transformName);
      const transformExpr = sql`cast(${
        importConfig.initialTransform ?? sql.lit`none`
      } as enums.csv_import_source_transform)`;
      const transformInitName = `__${config.field.name}_csv_transform_initial`;
      initScalars.push({
        name: transformInitName,
        type: { type: "Enum", enum: "csv_import_source_transform" },
      });
      initScalarValues.push({ name: transformInitName, expr: transformExpr });
      formFieldInitialValues.push(sql.ref(transformInitName));
    }
    const name = `${config.field.name}_import_source`;
    stateFields.push({
      name,
      type: { type: "Enum", enum: "csv_import_source_type" },
    });
    formFieldNames.push(name);
    const headerVariations = [
      config.field.name,
      ...(importConfig.headerVariations ?? []),
    ]
      .map((v) => sql.lit(v).toSQL())
      .join(",");
    if (config.csvImport) {
      const bodyImportSourceExpr =
        sql`cast(case when exists (select 1 from header where lower(trim(value)) in (${
          sql(headerVariations)
        })) then 'csv' else 'none' end as enums.csv_import_source_type)`;
      const importSourceInitName =
        `__${config.field.name}_import_source_initial`;
      initScalars.push({
        name: importSourceInitName,
        type: { type: "Enum", enum: "csv_import_source_type" },
      });
      initScalarValues.push({
        name: importSourceInitName,
        expr: bodyImportSourceExpr,
      });
      formFieldInitialValues.push(sql.ref(importSourceInitName));
    } else {
      formFieldInitialValues.push(
        sql`cast('none' as enums.csv_import_source_type)`,
      );
    }
  }
  return {
    defineRecord: (s: StateStatements) => {
      s.defRecord("form", {
        fields: stateFields,
      });
    },
    insertIntoRecord: <T extends IStatementsBase>(s: T) => {
      for (const initScalar of initScalars) {
        s.defScalar(initScalar.name, initScalar);
      }
      for (const initScalarValue of initScalarValues) {
        s.setScalar(initScalarValue.name, initScalarValue.expr);
      }
      s.modify(
        sql`insert into form ${insertValueColumns(...formFieldNames)} values ${
          valuesRow(formFieldInitialValues)
        }`,
      );
    },
  };
}

/**
 * Registers the enums and functions required by BulkMergeImportPage.
 * Must be called from core.tsx before using BulkMergeImportPage.
 */
export function addBulkMergeImportEnums() {
  if (system.enums.csv_import_source_transform) {
    return;
  }
  system.enum_({
    name: "csv_import_source_transform",
    values: ["none", "extract_first_name", "extract_last_name"],
  });
  system.enum_({
    name: "csv_import_source_type",
    values: ["csv", "constant", "none"],
  });
  ////Example_RulesFunction_Start
  system.rulesFunction({
    name: "apply_import_source_transform",
    parameters: [
      {
        name: "value",
        type: {
          type: "String",
          maxLength: 65000,
        },
      },
      {
        name: "transform",
        type: {
          type: "Enum",
          enum: "csv_import_source_transform",
        },
      },
    ],
    returnType: "String",
    rules: [
      [sql`input.transform`, sql`output`],
      [sql.lit`none`, sql`input.value`],
      [
        sql.lit`extract_first_name`,
        sql`case when contains(input.value, ' ') then left(input.value, position(' ' in input.value) - 1) else input.value end`,
      ],
      [
        sql.lit`extract_last_name`,
        sql`case when contains(input.value, ' ') then substring(input.value from position(' ' in input.value) + 1)  else input.value end`,
      ],
    ],
  });
  ////Example_RulesFunction_End
  system.enum_({
    name: "csv_import_validation_error_type",
    values: [
      "duplicate_row",
      "missing_merge_field",
      "missing_match_field",
      "ambiguous_match",
      "missing_required_field",
      "invalid_enum",
      "invalid_reference",
      "invalid_type",
      "too_long",
    ],
  });
  system.enum_({
    name: "csv_import_step",
    values: ["file_select", "mapping", "preview", "import"],
  });
  system.enum_({
    name: "csv_import_type",
    values: ["merge", "insert", "update"],
  });
  system.enum_({
    name: "csv_import_preview_filter",
    values: ["all", "error", "ignored", "accepted"],
  });
}

function fieldIsNotSetInCsv(field: Field) {
  return sql`csv_source.${field.ident} is null or csv_source.${field.ident} = ''`;
}

function getValueFromCsv(field: Field) {
  if (field.type === "Enum") {
    return field.tryCastToType(sql`lower(csv_source.${field.ident})`);
  }
  if (field.type === "String") {
    return sql`csv_source.${field.ident}`;
  }
  if (field.type === "ForeignKey") {
    const table = system.db.tables[field.table];
    return sql`(select id from ${table.identWithDb} where name = csv_source.${field.ident})`;
  }
  return field.tryCastToType(sql`csv_source.${field.ident}`);
}

function fieldIsNotSetInForm(field: Field) {
  return sql`form.${field.ident} is null or trim(form.${field.ident}) = ''`;
}

function isXlsxFile() {
  return sql`lower(file_name) like '%.xlsx' or lower(file_name) like '%.xls'`;
}

const IMPORT_COL_COUNT = 150;

function prepareCsvTextFromBody(
  s: UiServerStatements,
  _fields: ImportField[],
  _opts?: { headerOnly?: boolean },
) {
  s.defScalar("csv_text", {
    type: { type: "String", maxLength: 10000000 },
  });
  s.setScalar("csv_text", sql`string.from_utf8(body)`);
}

function insertHeaderFromBody(s: UiServerStatements, fields: ImportField[]) {
  s.if(isXlsxFile(), (s) => {
    s.modify(
      sql`insert into header
      select value, ordinal
      from xlsx.headers(
        body,
        selected_xlsx_sheet_ordinal,
        col_count => ${sql(String(IMPORT_COL_COUNT))}
      )`,
    );
  });
  s.if(sql`not (${isXlsxFile()})`, (s) => {
    prepareCsvTextFromBody(s, fields, { headerOnly: true });
    s.modify(
      sql`insert into header select value, ordinal from string.split(trim(split_part(csv_text, chr(10), 1)), ',')`,
    );
  });
}

function getMatchingRule(
  matching: BulkMergeImportMatchingConfig,
  ruleName: string,
) {
  const rule = matching.rules.find((candidate) => candidate.name === ruleName);
  if (!rule) {
    throw new Error(`Unknown bulk-import matching rule '${ruleName}'`);
  }
  return rule;
}

function normalizeMatchValue(
  rule: BulkMergeImportMatchRule,
  value: Sql,
) {
  return rule.normalize?.(value) ?? sql`nullif(trim(${value}), '')`;
}

function matchingSourceValueIsPresent(
  rule: BulkMergeImportMatchRule,
  record: Sql,
) {
  const value = normalizeMatchValue(
    rule,
    sql`${record}.${sql.ref(rule.sourceField)}`,
  );
  return sql`${value} is not null`;
}

function strategyRules(
  matching: BulkMergeImportMatchingConfig,
  strategy: BulkMergeImportMatchStrategy,
) {
  return strategy.rules.map((ruleName) => getMatchingRule(matching, ruleName));
}

function validateMatchingConfig(
  table: Table,
  matching: BulkMergeImportMatchingConfig,
) {
  if (
    !matching.strategies.some((strategy) =>
      strategy.name === matching.defaultStrategy
    )
  ) {
    throw new Error(
      `Unknown default bulk-import matching strategy '${matching.defaultStrategy}'`,
    );
  }
  for (const rule of matching.rules) {
    if (!table.fields[rule.sourceField]) {
      throw new Error(
        `Bulk-import matching source field '${rule.sourceField}' does not exist on table '${table.name}'`,
      );
    }
    const targetField = rule.targetField ?? rule.sourceField;
    if (!table.fields[targetField]) {
      throw new Error(
        `Bulk-import matching target field '${targetField}' does not exist on table '${table.name}'`,
      );
    }
  }
  for (const strategy of matching.strategies) {
    if (strategy.rules.length === 0) {
      throw new Error(
        `Bulk-import matching strategy '${strategy.name}' has no rules`,
      );
    }
    strategyRules(matching, strategy);
  }
}

// Set `preview.is_new_record` and `preview.target_record_id` based on whether
// each row's merge field exists in `target`.
function refreshIsNewRecordFromMergeField(
  s: UiServerStatements,
  table: Table,
  mergeField: string,
) {
  s.modify(sql`delete from target_match`);
  s.modify(
    sql`insert into target_match (csv_row_index, target_record_id)
      select preview.csv_row_index, ${table.identWithDb}.id
      from preview
      inner join ${table.identWithDb}
        on ${table.identWithDb}.${sql.ref(mergeField)} = preview.${
      sql.ref(mergeField)
    }`,
  );
  s.modify(
    sql`update preview set is_new_record = true, target_record_id = null`,
  );
  s.modify(
    sql`update preview set is_new_record = false,
      target_record_id = (
        select target_record_id from target_match
        where target_match.csv_row_index = preview.csv_row_index
        limit 1
      )
      where csv_row_index in (select csv_row_index from target_match)`,
  );
}

function refreshIdentityMatches(
  s: UiServerStatements,
  table: Table,
  matching: BulkMergeImportMatchingConfig,
) {
  s.modify(sql`delete from match_candidate`);
  s.modify(sql`delete from match_candidate_rule`);
  s.modify(sql`delete from match_selected_priority`);
  for (const strategy of matching.strategies) {
    s.if(sql`matching_strategy = ${sql.lit(strategy.name)}`, (s) => {
      const candidateQuery = (
        rule: BulkMergeImportMatchRule,
        preventsCreate: boolean,
        excludeExisting: boolean,
      ) => {
        const targetFieldName = rule.targetField ?? rule.sourceField;
        const importValue = normalizeMatchValue(
          rule,
          sql`import_row.${sql.ref(rule.sourceField)}`,
        );
        const targetValue = normalizeMatchValue(
          rule,
          sql`target_record.${sql.ref(targetFieldName)}`,
        );
        const candidateDisplayName = table.recordDisplayName
          ? table.getRecordDisplayNameExpr(sql`target_record`)
          : sql`target_record.${table.primaryKeyIdent}::string`;
        return sql`select
            import_row.csv_row_index,
            target_record.${table.primaryKeyIdent},
            ${rule.priority ?? 0},
            ${candidateDisplayName},
            ${sql.lit(rule.displayName)},
            ${preventsCreate ? 1 : 0}
          from preview import_row
          join ${table.identWithDb} target_record on
            ${importValue} = ${targetValue}
          where ${importValue} is not null
            and ${targetValue} is not null
            ${
          excludeExisting
            ? sql`and not exists (
                select 1
                from match_candidate_rule existing_candidate
                where existing_candidate.csv_row_index = import_row.csv_row_index
                  and existing_candidate.target_record_id =
                    target_record.${table.primaryKeyIdent}
                  and existing_candidate.match_priority <= ${rule.priority ?? 0}
              )`
            : sql``
        }
        `;
      };
      const rules = strategyRules(matching, strategy);
      const uniqueRules = rules.filter((rule) =>
        hasSingleFieldUniqueConstraint(
          table,
          rule.targetField ?? rule.sourceField,
        )
      );
      const nonUniqueRules = rules.filter((rule) =>
        !hasSingleFieldUniqueConstraint(
          table,
          rule.targetField ?? rule.sourceField,
        )
      );
      const insertCandidates = (
        candidateRules: BulkMergeImportMatchRule[],
        preventsCreate: boolean,
      ) => {
        if (candidateRules.length === 0) {
          return;
        }
        s.modify(sql`
            insert into match_candidate_rule (
              csv_row_index,
              target_record_id,
              match_priority,
              candidate_display_name,
              matched_field,
              prevents_create
            )
            ${
          sql.union(
            candidateRules.map((rule) =>
              candidateQuery(
                rule,
                preventsCreate,
                !preventsCreate,
              )
            ),
          )
        }
          `);
      };
      insertCandidates(uniqueRules, true);
      insertCandidates(nonUniqueRules, false);
    });
  }
  s.modify(sql`
    insert into match_selected_priority (csv_row_index, match_priority)
    select csv_row_index, min(match_priority)
    from match_candidate_rule
    group by csv_row_index
  `);
  s.modify(sql`delete from match_resolution`);
  s.modify(sql`
    insert into match_resolution (
      csv_row_index,
      candidate_count,
      target_record_id
    )
    select
      selected_candidate.csv_row_index,
      count(*),
      min(selected_candidate.target_record_id)
    from (
      select candidate.csv_row_index, candidate.target_record_id
      from match_candidate_rule candidate
      join match_selected_priority selected_priority
        on selected_priority.csv_row_index = candidate.csv_row_index
        and selected_priority.match_priority = candidate.match_priority
      group by candidate.csv_row_index, candidate.target_record_id
    ) selected_candidate
    group by selected_candidate.csv_row_index
  `);
  s.modify(
    sql`update preview set target_record_id = null, is_new_record = true`,
  );
  s.modify(sql`
    update preview
    set
      target_record_id = (
        select target_record_id
        from match_resolution resolution
        where resolution.csv_row_index = preview.csv_row_index
      ),
      is_new_record = false
    where csv_row_index in (
      select csv_row_index
      from match_resolution
      where candidate_count = 1
    )
  `);
  s.modify(sql`
    update preview
    set target_record_id = null, is_new_record = null
    where csv_row_index in (
      select csv_row_index
      from match_resolution
      where candidate_count > 1
    )
  `);
  s.modify(sql`
    insert into match_candidate (
      csv_row_index,
      target_record_id,
      candidate_display_name,
      matched_fields,
      prevents_create
    )
    select
      candidate.csv_row_index,
      candidate.target_record_id,
      min(candidate.candidate_display_name),
      string_agg(candidate.matched_field, ', ' order by candidate.matched_field),
      max(candidate.prevents_create)
    from match_candidate_rule candidate
    join match_selected_priority selected_priority
      on selected_priority.csv_row_index = candidate.csv_row_index
      and selected_priority.match_priority = candidate.match_priority
    where candidate.csv_row_index in (
      select preview_candidate.csv_row_index
      from match_candidate_rule preview_candidate
      join match_selected_priority preview_priority
        on preview_priority.csv_row_index = preview_candidate.csv_row_index
        and preview_priority.match_priority = preview_candidate.match_priority
      group by preview_candidate.csv_row_index
      order by preview_candidate.csv_row_index
      limit 100
    )
    group by candidate.csv_row_index, candidate.target_record_id
  `);
}

function refreshImportMatches(
  s: UiServerStatements,
  table: Table,
  props: BulkMergeImportProps,
) {
  if (props.matching) {
    refreshIdentityMatches(s, table, props.matching);
    return;
  }
  refreshIsNewRecordFromMergeField(s, table, props.mergeField);
}

function mergeStatements(
  table: Table,
  props: BulkMergeImportProps,
  fields: ImportField[],
  s: UiServerStatements,
) {
  if (!props.matching) {
    refreshIsNewRecordFromMergeField(s, table, props.mergeField);
  }
  const update: UpdateAssignment[] = [];
  const insertFields: string[] = [];
  const insertValues: AnyExpr[] = [];
  for (const config of fields) {
    const fieldName = config.field.name;
    const fieldIdent = config.field.ident;
    const fieldImportSource = sql`form.${sql(fieldName)}_import_source`;
    const fieldUnsetInCsv = fieldIsNotSetInCsv(config.field);
    const fieldUnsetInForm = fieldIsNotSetInForm(config.field);
    const csvValue = getValueFromCsv(config.field);
    const formValue = getDbValueFromFormValue(
      config.field,
      sql`form.${fieldIdent}`,
    );
    const canUpdateField = !config.neverUpdate &&
      (props.matching || fieldName !== props.mergeField);
    if (
      config.field.type === "ForeignKey" &&
      canAutoInsertTable(config.field.table) &&
      config.csvImport
    ) {
      const table = system.db.tables[config.field.table];
      s.if(sql`${fieldImportSource} = 'csv'`, (s) => {
        s.modify(sql`merge into ${table.identWithDb} as csv_target using (
            select distinct ${sql.ref(fieldName)} as name
            from preview as row where not csv_ignore_import and
              coalesce(trim(${sql.ref(fieldName)}), '') != ''
              and case
                when import_type = 'insert' then is_new_record
                when import_type = 'update' then not is_new_record
                else true
              end
          ) as csv_source
          on csv_source.name = csv_target.name
          when not matched then insert (name) values (csv_source.name)`);
      });
    }
    if (config.csvImport) {
      if (config.constant) {
        if (canUpdateField) {
          update.push(
            updateAssignment(
              fieldName,
              sql`case
              when
                  ${fieldImportSource} = 'none' or
                  (${fieldImportSource} = 'csv' and (${fieldUnsetInCsv})) or
                  (${fieldImportSource} = 'constant' and (${fieldUnsetInForm}))
              then csv_target.${fieldIdent}
              when ${fieldImportSource} = 'csv' then ${csvValue}
              else ${formValue}
          end`,
            ),
          );
        }
        insertFields.push(fieldName);
        insertValues.push(
          sql`case when ${fieldImportSource} = 'none' then null when ${fieldImportSource} = 'csv' then ${csvValue} else ${formValue} end`,
        );
      } else {
        if (canUpdateField) {
          update.push(
            updateAssignment(
              fieldName,
              sql`case when ${fieldUnsetInCsv} then csv_target.${fieldIdent} else ${csvValue} end`,
            ),
          );
        }
        insertFields.push(fieldName);
        insertValues.push(csvValue);
      }
    } else if (config.constant) {
      if (canUpdateField) {
        update.push(
          updateAssignment(
            fieldName,
            sql`case when ${fieldUnsetInForm} then csv_target.${fieldIdent} else ${formValue} end`,
          ),
        );
      }
      insertFields.push(fieldName);
      insertValues.push(formValue);
    }
  }
  // Keep merge/insert set-based, but drive update-only imports through
  // per-preview-row primary-key updates. That avoids scanning large targets for
  // update-only CSV imports where validation has already resolved target ids.
  const insertSelectList: SelectColumn[] = insertValues.map((expr, idx) =>
    selectColumn(expr, insertFields[idx])
  );
  const updateExisting = (s: UiServerStatements) => {
    if (update.length === 0) {
      return;
    }
    s.modify(sql`update ${table.identWithDb} as csv_target
      set ${update}
      from preview as csv_source
      where csv_source.target_record_id = csv_target.id
        and csv_source.target_record_id is not null
        and not csv_source.csv_ignore_import
        and not csv_source.is_new_record`);
  };
  const updateExistingByTargetId = (s: UiServerStatements) => {
    if (update.length === 0) {
      return;
    }
    s.forEachTable("preview", "csv_source", (s) => {
      s.if(
        sql`csv_source.target_record_id is not null
          and not csv_source.csv_ignore_import
          and not csv_source.is_new_record`,
        (s) => {
          s.modify(sql`update ${table.identWithDb} as csv_target
            set ${update}
            where csv_target.id = csv_source.target_record_id`);
        },
      );
    });
  };
  const insertNew = (s: UiServerStatements) => {
    s.modify(
      sql`insert into ${table.identWithDb} ${
        insertValueColumns(...insertFields)
      }
      select ${insertSelectList}
      from preview as csv_source
      where not csv_source.csv_ignore_import
        and csv_source.is_new_record`,
    );
  };
  s.if(sql`import_type = 'merge'`, (s) => {
    updateExisting(s);
    insertNew(s);
  });
  s.if(sql`import_type = 'insert'`, (s) => {
    insertNew(s);
  });
  s.if(sql`import_type = 'update'`, (s) => {
    updateExistingByTargetId(s);
  });
}

function ImportFieldCsvControl({ config }: { config: ImportField }) {
  const fieldName = sql(config.field.name);
  const csvColumnId = getUniqueUiId();
  const transformId = getUniqueUiId();
  return (
    <>
      <FormControl sx={styles.fieldInput}>
        <FormLabel htmlFor={csvColumnId}>File column</FormLabel>
        {/*Example_Select_Start*/}
        <EachSelect
          size="sm"
          value={sql`form.${fieldName}_csv_ordinal`}
          id={csvColumnId}
          table="header"
          findOnValue="value"
          optionLabel="value"
          optionValue="ordinal"
          onChange={(s) =>
            s.modify(
              sql`update form set ${fieldName}_csv_ordinal = cast(target_value as bigint)`,
            )}
        />
        {/*Example_Select_End*/}
      </FormControl>
      <FormControl sx={styles.fieldInput}>
        <FormLabel htmlFor={transformId}>Transform</FormLabel>
        {/*Example_EnumSelect_Start*/}
        <EnumSelect
          size="sm"
          value={sql`form.${fieldName}_csv_transform`}
          id={transformId}
          onChange={(s) =>
            s.modify(
              sql`update form set ${fieldName}_csv_transform = cast(target_value as enums.csv_import_source_transform)`,
            )}
          enum="csv_import_source_transform"
          sx={styles.select}
        />
        {/*Example_EnumSelect_End*/}
      </FormControl>
    </>
  );
}

function ImportFieldFormControl({ config }: { config: ImportField }) {
  const fieldName = config.field.name;
  const inputId = getUniqueUiId();
  const fieldHelper: FormFieldHelper = {
    value: sql`form.${sql.ref(fieldName)}`,
    setValue: (s, value) => {
      s.modify(sql`update form set ${sql.ref(fieldName)} = ${value}`);
    },
    error: sql`form.${sql(fieldName)}_error`,
    hasError: sql`form.${sql(fieldName)}_error is not null`,
    setError: (s, error) => {
      s.modify(sql`update form set ${sql(fieldName)}_error = ${error}`);
    },
    touched: sql.true,
    setTouched: () => {
      // Since we're always considering the field as touched,
      // we don't need to do anything here.
    },
  };
  let control: Node;
  if (config.field.type === "Bool" && !config.field.enumLike) {
    control = (
      <div sx={styles.switchWrapper}>
        <SwitchControl
          checked={fieldHelper.value}
          onCheckboxChange={(s) => {
            fieldHelper.setValue(s, sql`target_checked`);
          }}
        />
      </div>
    );
  } else {
    control = (
      <FieldFormControl
        size="sm"
        field={config.field}
        id={inputId}
        fieldHelper={fieldHelper}
      />
    );
  }
  return (
    <FormControl>
      <FormLabel htmlFor={inputId}>Value</FormLabel>
      {control}
    </FormControl>
  );
}

function ImportFieldControl({ config }: { config: ImportField }) {
  const fieldName = config.field.name;
  const importSourceSelectId = sql.lit(getUniqueUiId());
  const importSourceIdent = sql.ref(`${fieldName}_import_source`);
  let control: Node;
  if (config.csvImport) {
    if (config.constant) {
      control = (
        <>
          <Show when={sql`form.${importSourceIdent} = 'csv'`}>
            <ImportFieldCsvControl config={config} />
          </Show>
          <Show when={sql`form.${importSourceIdent} = 'constant'`}>
            <ImportFieldFormControl config={config} />
          </Show>
        </>
      );
    } else {
      control = <ImportFieldCsvControl config={config} />;
    }
  } else {
    control = <ImportFieldFormControl config={config} />;
  }
  return (
    <div
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        gridColumnSpan: 4,
        minHeight: 200,
      }}
    >
      <Typography level="body-sm" className="font-bold">
        {config.field.displayName}
      </Typography>
      <FormControl>
        <Select
          size="sm"
          value={sql`form.${importSourceIdent}::string`}
          id={importSourceSelectId}
          onChange={(s) =>
            s.modify(
              sql`update form set ${importSourceIdent} = cast(target_value as enums.csv_import_source_type)`,
            )}
          sx={styles.select}
        >
          {config.csvImport && (
            <Select.Option value="csv">From file</Select.Option>
          )}
          {config.constant && (
            <Select.Option value="constant">Constant</Select.Option>
          )}
          <Select.Option value="none">None</Select.Option>
        </Select>
      </FormControl>
      {control}
    </div>
  );
}

/** Props for {@link BulkMergeImportPage}. */
export interface BulkMergeImportProps {
  /** Route path the page is mounted at (defaults to `/<table base url>/import`). */
  path?: string;
  /** Document title. Defaults to `Import <table display name>`. */
  title?: string;
  /** Name of the table that rows will be merged into. */
  table: string;
  /** Field used as the merge key (typically a unique identifier). */
  mergeField: string;
  /** Optional candidate-based matching strategies. Omit to retain mergeField-only behavior. */
  matching?: BulkMergeImportMatchingConfig;
  /** Per-field config overrides keyed by field name. */
  fieldOverrides?: Record<string, Omit<ImportField, "field">>;
  /** Field names that should be excluded from the import UI. */
  ignoreFields?: string[];
  /** Optional server-side authorization hook run before loading, previewing, or importing. */
  authorize?: (s: StateStatements | UiServerStatements) => void;
  /** Optional hook run in the import transaction after target rows are merged. */
  afterMerge?: (s: UiServerStatements) => void;
}

function BulkMergeImportInner(props: BulkMergeImportProps) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table '${props.table}' does not exist`);
  }
  if (props.matching) {
    validateMatchingConfig(table, props.matching);
  }
  addBulkMergeImportEnums();
  const importFields: ImportField[] = [
    getImportFieldConfig(
      props.mergeField,
      table.fields[props.mergeField],
      props.fieldOverrides?.[props.mergeField] ?? {},
    ),
  ];
  for (const field of Object.values(table.fields)) {
    if (
      props.ignoreFields?.includes(field.name) ||
      props.mergeField === field.name ||
      field.type === "Bytes" ||
      field.type === "Json"
    ) {
      continue;
    }
    importFields.push(
      getImportFieldConfig(
        props.mergeField,
        field,
        props.fieldOverrides?.[field.name] ?? {},
      ),
    );
  }
  const pluralTableName = sql.lit(downcaseFirst(pluralize(table.displayName)));
  const { defineRecord, insertIntoRecord } = mappingState(importFields);
  useState((s) => {
    s.defScalar("refresh_key", 0);
  });
  useState({
    watch: [sql`refresh_key`],
    procedure: (s) => {
      s.defTable("header", {
        fields: [
          { name: "value", type: { type: "String", maxLength: 65000 } },
          { name: "ordinal", type: { type: "BigInt" } },
        ],
      });
      s.defScalar("file_name", sql.lit``);
      s.defScalar("selected_xlsx_sheet_ordinal", sql`0`);
      s.defScalar("first_row_is_header", true);
      s.defTable("xlsx_sheets", {
        fields: [
          { name: "name", type: { type: "String", maxLength: 255 } },
          { name: "ordinal", type: "Int" },
        ],
      });
      s.fileRefTable("csv_file");
      s.defScalar("imported", {
        expr: false,
        allowNoRead: true,
      });
      s.defScalar("add_count", 0);
      s.defScalar("update_count", 0);
      s.defScalar("step", sql`cast('file_select' as enums.csv_import_step)`);
      s.defScalar("error", {
        type: { type: "String", maxLength: 65000 },
      });
      s.defTable("validation_error", {
        fields: [
          {
            name: "type",
            type: { type: "Enum", enum: "csv_import_validation_error_type" },
            notNull: true,
          },
          { name: "field", type: "String" },
          { name: "message", type: "String" },
          { name: "row", type: "Int" },
        ],
      });
      s.defTable("preview", {
        fields: [
          { name: "csv_row_index", type: "Int", notNull: true },
          { name: "target_record_id", type: "Int" },
          { name: "is_new_record", type: "Bool" },
          { name: "csv_ignore_import", type: "Bool", notNull: true },
          { name: "csv_has_error", type: "Bool", notNull: true },
          ...importFields
            .filter((v) => v.csvImport)
            .map((v) => ({
              name: v.field.name,
              type: "String" as const,
            })),
        ],
      });
      s.defTable("target_match", {
        fields: [
          { name: "csv_row_index", type: "Int", notNull: true },
          { name: "target_record_id", type: "Int", notNull: true },
        ],
      });
      s.defTable("match_candidate", {
        fields: [
          { name: "csv_row_index", type: "Int", notNull: true },
          { name: "target_record_id", type: "Int", notNull: true },
          {
            name: "candidate_display_name",
            type: { type: "String", maxLength: 2000 },
            notNull: true,
          },
          {
            name: "matched_fields",
            type: { type: "String", maxLength: 2000 },
            notNull: true,
          },
          { name: "prevents_create", type: "Int", notNull: true },
        ],
      });
      s.defTable("match_candidate_rule", {
        fields: [
          { name: "csv_row_index", type: "Int", notNull: true },
          { name: "target_record_id", type: "Int", notNull: true },
          { name: "match_priority", type: "Int", notNull: true },
          {
            name: "candidate_display_name",
            type: { type: "String", maxLength: 2000 },
            notNull: true,
          },
          {
            name: "matched_field",
            type: { type: "String", maxLength: 255 },
            notNull: true,
          },
          { name: "prevents_create", type: "Int", notNull: true },
        ],
      });
      s.defTable("match_selected_priority", {
        fields: [
          { name: "csv_row_index", type: "Int", notNull: true },
          { name: "match_priority", type: "Int", notNull: true },
        ],
      });
      s.defTable("match_resolution", {
        fields: [
          { name: "csv_row_index", type: "Int", notNull: true },
          { name: "candidate_count", type: "Int", notNull: true },
          { name: "target_record_id", type: "Int", notNull: true },
        ],
      });
      s.defScalar("matching_strategy", {
        type: { type: "String", maxLength: 100 },
        expr: sql.lit(props.matching?.defaultStrategy ?? "merge_field"),
      });
      s.defScalar("waiting", false);
      s.defScalar("import_type", sql`cast('merge' as enums.csv_import_type)`);
      s.defScalar("preview_filter", {
        expr: sql`cast('error' as enums.csv_import_preview_filter)`,
        allowNoRead: true,
      });
      defineRecord(s);
    },
  });
  return (
    <div
      sx={{
        ...containerStyles(),
        display: "flex",
        flexDirection: "column",
        gap: 2,
        py: 4,
      }}
    >
      {/*Example_Stepper_Start*/}
      <Stepper sx={styles.stepper} size="lg">
        <Step
          activeLineColor="primary"
          dotted
          indicator={
            <StepIndicator color="primary" variant="soft" activeVariant="solid">
              <MaterialIcon icon="FilePresent" />
            </StepIndicator>
          }
          active={sql`step >= 'file_select'`}
        >
          Select File
        </Step>
        <Step
          activeLineColor="primary"
          dotted
          indicator={
            <StepIndicator color="primary" variant="soft" activeVariant="solid">
              <MaterialIcon icon="Edit" />
            </StepIndicator>
          }
          active={sql`step >= 'mapping'`}
        >
          Select fields
        </Step>
        <Step
          activeLineColor="primary"
          dotted
          indicator={
            <StepIndicator color="primary" variant="soft" activeVariant="solid">
              <MaterialIcon icon="Check" />
            </StepIndicator>
          }
          active={sql`step >= 'preview'`}
        >
          Preview
        </Step>
        <Step
          activeLineColor="primary"
          dotted
          indicator={
            <StepIndicator color="primary" variant="soft">
              <MaterialIcon icon="FileUpload" />
            </StepIndicator>
          }
          active={sql`step >= 'import'`}
        >
          Import
        </Step>
      </Stepper>
      {/*Example_Stepper_End*/}
      <Switch>
        <Match when={sql`step = 'import'`}>
          <SuccessStep pluralTableName={pluralTableName} />
        </Match>
        <Match when={sql`step = 'mapping'`}>
          <MappingStep
            pluralTableName={pluralTableName}
            importFields={importFields}
            opts={props}
            table={table}
            insertIntoRecord={insertIntoRecord}
          />
        </Match>
        <Match when={sql`step = 'file_select'`}>
          <SelectFileStep
            pluralTableName={pluralTableName}
            importFields={importFields}
            insertIntoRecord={insertIntoRecord}
          />
        </Match>
        <Match when={sql`step = 'preview'`}>
          <PreviewStep
            table={table}
            props={props}
            importFields={importFields}
          />
        </Match>
      </Switch>
    </div>
  );
}

/**
 Manages an import wizard that lets uses import CSV files into a table,
 inserting new records and updating existing records.

 @category Page Component

 @param props.path - Optional custom path for the import page. If not provided, it defaults to `/${table.getBaseUrl()}/import`.
 @param props.title - Optional document title. Defaults to `Import <table display name>`.
 @param props.table - The name of the table to import data into.
 @param props.mergeField - The field used to match existing records for updates.
 @param props.fieldOverrides - Optional object to override default import configurations for specific fields.
 @param props.ignoreFields - Optional array of field names to exclude from the import process.
 @param props.authorize - Optional server-side authorization hook run before loading, previewing, and importing.

  @examples
  [Example](../../examples/chinook/apps/chinook.yolmstaging.net.tsx)
 */
export function BulkMergeImportPage(props: BulkMergeImportProps) {
  const table = system.db.tables[props.table];
  const content = <BulkMergeImportInner {...props} />;
  return (
    <Route
      path={props.path ?? `/${table.getBaseUrl()}/import`}
      title={props.title ?? `Import ${table.displayName}`}
    >
      {props.authorize
        ? (
          <Data procedure={(s) => props.authorize?.(s)}>
            {content}
          </Data>
        )
        : content}
    </Route>
  );
}
interface PreviewStepProps {
  table: Table;
  props: BulkMergeImportProps;
  importFields: ImportField[];
}

function PreviewStep({
  table,
  props: opts,
  importFields,
}: PreviewStepProps): JSX.Element {
  const previewFieldNames = new Set(
    importFields.filter((field) => field.csvImport).map((field) =>
      field.field.name
    ),
  );
  function previewRecordDisplayName() {
    return table.recordDisplayName &&
        table.recordDisplayName.fields.every((field) =>
          previewFieldNames.has(field)
        )
      ? table.getRecordDisplayNameExpr(sql`row`)
      : sql`row.${sql.ref(opts.mergeField)}`;
  }

  function displayFieldValue(fieldName: Sql) {
    return sql.caseWhen({
      conditions: importFields
        .filter((importField) => importField.csvImport)
        .map((importField) => ({
          condition: sql`${fieldName} = ${sql.lit(importField.field.name)}`,
          expr: sql`row.${importField.field.ident}`,
        })),
    });
  }
  function statRow(label: string, expr: Sql): Node {
    return (
      <tr>
        <th scope="row">{label}</th>
        <td>{expr}</td>
      </tr>
    );
  }

  function importTypeSelection(): Node {
    return (
      <div>
        <Typography level="title-md" className="mb-2">
          Import Type:
        </Typography>
        <RadioGroup>
          {/*Example_Radio_Start*/}
          <Radio
            variant="soft"
            color="primary"
            checked={sql`import_type = 'merge'`}
            label="Create and update records"
            onChange={(s) => {
              s.setScalar(
                "import_type",
                sql`cast('merge' as enums.csv_import_type)`,
              );
            }}
          />
          {/*Example_Radio_End*/}
          <Radio
            variant="soft"
            color="primary"
            checked={sql`import_type = 'insert'`}
            label="Create new records only"
            onChange={(s) => {
              s.setScalar(
                "import_type",
                sql`cast('insert' as enums.csv_import_type)`,
              );
            }}
          />
          <Radio
            variant="soft"
            color="primary"
            checked={sql`import_type = 'update'`}
            label="Update existing records only"
            onChange={(s) => {
              s.setScalar(
                "import_type",
                sql`cast('update' as enums.csv_import_type)`,
              );
            }}
          />
        </RadioGroup>
      </div>
    );
  }

  function statsTable(): Node {
    return (
      <TableComponent
        variant="outlined"
        borderAxis="both"
        size="lg"
        className="w-auto h-min"
      >
        <tbody>
          {statRow(
            "New records",
            sql`format.decimal((select count(*) from preview where is_new_record))`,
          )}
          {statRow(
            "Existing records",
            sql`format.decimal((select count(*) from preview where not is_new_record))`,
          )}
          {opts.matching && statRow(
            "Match decisions needed",
            sql`format.decimal((select count(*) from preview where is_new_record is null and not csv_ignore_import))`,
          )}
          {statRow(
            "Records with errors",
            sql`format.decimal((select count(*) from preview where csv_has_error))`,
          )}
          {statRow(
            "Ignored records",
            sql`format.decimal((select count(*) from preview where csv_ignore_import or case when
              import_type = 'insert' then not is_new_record
              when import_type = 'update' then is_new_record
              else false
            end
            ))`,
          )}
          {statRow(
            "Remaining errors",
            sql`format.decimal((select count(*) from preview where csv_has_error and not (csv_ignore_import or
              case
                when import_type = 'insert' then not is_new_record
                when import_type = 'update' then is_new_record
                else false
              end)
              ))`,
          )}
          {statRow(
            "Accepted records",
            sql`format.decimal((select count(*) from preview where not csv_ignore_import and case when
              import_type = 'insert' then is_new_record
              when import_type = 'update' then not is_new_record
              else true
            end))`,
          )}
        </tbody>
      </TableComponent>
    );
  }

  function selectMatchCandidate(
    s: DomStatements,
    targetRecordId: Sql,
  ) {
    s.modify(sql`
      update preview
      set target_record_id = ${targetRecordId},
          is_new_record = false,
          csv_ignore_import = false
      where csv_row_index = row.csv_row_index
    `);
    s.modify(sql`
      delete from validation_error
      where row = row.csv_row_index
        and type in ('ambiguous_match', 'missing_required_field')
    `);
    s.modify(sql`update row set csv_has_error = exists (
      select 1 from validation_error where validation_error.row = row.csv_row_index
    )`);
  }

  function selectCreateNew(s: DomStatements) {
    s.modify(sql`
      update preview
      set target_record_id = null,
          is_new_record = true,
          csv_ignore_import = false
      where csv_row_index = row.csv_row_index
    `);
    s.modify(sql`
      delete from validation_error
      where row = row.csv_row_index
        and type in ('ambiguous_match', 'missing_required_field')
    `);
    for (const config of importFields) {
      if (
        !config.csvImport ||
        !config.field.notNull ||
        sql.isAnyExpr(config.field.default)
      ) {
        continue;
      }
      const fieldImportSource = sql`form.${
        sql(config.field.name)
      }_import_source`;
      const hasConstant = config.constant
        ? sql`${fieldImportSource} = 'constant' and not (${
          fieldIsNotSetInForm(config.field)
        })`
        : sql.false;
      s.if(
        sql`not (${hasConstant}) and (
          row.${sql.ref(config.field.name)} is null
          or row.${sql.ref(config.field.name)} = ''
        )`,
        (s) => {
          s.modify(
            sql`insert into validation_error (type, field, row) values (
              'missing_required_field',
              ${sql.lit(config.field.name)},
              row.csv_row_index
            )`,
          );
        },
      );
    }
    s.modify(sql`update row set csv_has_error = exists (
      select 1 from validation_error where validation_error.row = row.csv_row_index
    )`);
  }

  function MatchCandidateChoices(): Node {
    if (!opts.matching) {
      return null;
    }
    return (
      <div className="flex flex-col gap-2">
        <Typography level="title-sm">Matching existing records</Typography>
        <Each
          table="displayed_match_candidates"
          recordName="candidate"
          where={sql`candidate.csv_row_index = row.csv_row_index`}
        >
          <div className="flex items-center gap-3 rounded border border-divider px-3 py-2">
            <div className="min-w-0 flex-1">
              <Typography level="body-md">
                {sql`candidate.candidate_display_name`}
              </Typography>
              <Typography level="body-sm" className="text-secondary">
                {sql.concat("Matched on ", sql`candidate.matched_fields`)}
              </Typography>
            </div>
            <Show
              when={sql`row.target_record_id = candidate.target_record_id and not row.is_new_record`}
            >
              <Chip color="primary" variant="soft" size="sm">
                Selected
              </Chip>
            </Show>
            <Button
              size="sm"
              variant="soft"
              disabled={sql`row.target_record_id = candidate.target_record_id and not row.is_new_record and not row.csv_ignore_import`}
              onClick={(s) =>
                selectMatchCandidate(s, sql`candidate.target_record_id`)}
            >
              {sql`case when row.target_record_id = candidate.target_record_id and not row.is_new_record and not row.csv_ignore_import then 'Selected match' else 'Merge' end`}
            </Button>
          </div>
        </Each>
        <Show
          when={sql`not exists (select 1 from displayed_match_candidates candidate
            where candidate.csv_row_index = row.csv_row_index and candidate.prevents_create != 0)`}
          fallback={
            <Typography level="body-sm" className="text-secondary">
              Use an existing record or ignore this row to avoid creating a
              duplicate.
            </Typography>
          }
        >
          <div>
            <Button
              size="sm"
              variant="outlined"
              color="neutral"
              onClick={selectCreateNew}
            >
              Create new record
            </Button>
          </div>
        </Show>
      </div>
    );
  }

  function MatchRows({ multiple }: { multiple: boolean }): Node {
    const condition = multiple
      ? sql`candidate_count > 1`
      : sql`candidate_count = 1`;
    return (
      <Data local procedure={(s) => s.defScalar("match_rows_limit", 100)}>
        <Data
          autoWatch={false}
          watch={[sql`match_rows_limit`]}
          procedure={(s) => {
            s.defTable(
              "displayed_match_rows",
              sql`select csv_row_index from match_resolution
                where ${condition} order by csv_row_index limit match_rows_limit`,
            );
            // Validation's match_candidate table only covers its first 100 rows.
            // Use the full rule results for each review batch, including later conflicts.
            s.defTable(
              "displayed_match_candidates",
              sql`select candidate.csv_row_index, candidate.target_record_id,
                min(candidate.candidate_display_name) as candidate_display_name,
                string_agg(candidate.matched_field, ', ' order by candidate.matched_field) as matched_fields,
                max(candidate.prevents_create) as prevents_create
                from match_candidate_rule candidate
                join match_selected_priority selected_priority
                  on selected_priority.csv_row_index = candidate.csv_row_index
                  and selected_priority.match_priority = candidate.match_priority
                where candidate.csv_row_index in (select csv_row_index from displayed_match_rows)
                group by candidate.csv_row_index, candidate.target_record_id`,
            );
            s.defScalar(
              "match_rows_count",
              sql`(select count(*) from match_resolution where ${condition})`,
            );
          }}
        >
          <Each
            table="displayed_match_rows"
            recordName="match_row"
            orderBy={sql`match_row.csv_row_index`}
          >
            <Each
              table="preview"
              recordName="row"
              where={sql`row.csv_row_index = match_row.csv_row_index`}
            >
              <Card className="px-4 py-2 gap-2">
                <div sx={styles.rowHeader}>
                  <Typography level="body-md">
                    {previewRecordDisplayName()}
                  </Typography>
                  <Show when={sql`row.is_new_record`}>
                    <Chip color="success" variant="soft" size="sm">
                      New
                    </Chip>
                  </Show>
                  <Show when={sql`not row.is_new_record`}>
                    <Chip color="primary" variant="soft" size="sm">
                      Update
                    </Chip>
                  </Show>
                  <div sx={flexGrowStyles} />
                  <Checkbox
                    checked={sql`row.csv_ignore_import`}
                    label="Ignore this row"
                    variant="outlined"
                    size="sm"
                    onChange={(s) => {
                      s.modify(
                        sql`update preview set csv_ignore_import = not csv_ignore_import where csv_row_index = row.csv_row_index`,
                      );
                    }}
                    id={sql.concat(
                      "ignore_match_row_",
                      sql`row.csv_row_index`,
                    )}
                  />
                </div>
                <MatchCandidateChoices />
              </Card>
            </Each>
          </Each>
          <Show
            when={sql`match_rows_count > (select count(*) from displayed_match_rows)`}
          >
            <Button
              variant="outlined"
              color="neutral"
              onClick={(s) => {
                s.setScalar("match_rows_limit", sql`match_rows_limit + 100`);
              }}
            >
              Show more matches
            </Button>
          </Show>
        </Data>
      </Data>
    );
  }

  function PreviewErrors({ rowCondition }: { rowCondition: Sql }): Node {
    return (
      <Each table="preview" recordName="row" where={rowCondition}>
        <Card className="px-4 py-2 gap-2">
          <div sx={styles.rowHeader}>
            <Typography level="body-md">
              {previewRecordDisplayName()}
            </Typography>
            <Switch>
              <Match
                when={sql`exists (select 1 from validation_error where row = row.csv_row_index and type = 'duplicate_row')`}
              >
                <Chip color="danger" variant="soft" size="sm">
                  Duplicate
                </Chip>
              </Match>
              <Match when={sql`row.is_new_record`}>
                <Chip color="success" variant="soft" size="sm">
                  New
                </Chip>
              </Match>
              <Match when={sql`not row.is_new_record`}>
                <Chip color="primary" variant="soft" size="sm">
                  Update
                </Chip>
              </Match>
            </Switch>
            <div sx={flexGrowStyles} />
            <Checkbox
              checked={sql`row.csv_ignore_import`}
              label="Ignore this row"
              variant="outlined"
              size="sm"
              onChange={(s) => {
                s.modify(
                  sql`update preview set csv_ignore_import = not csv_ignore_import where csv_row_index = row.csv_row_index`,
                );
              }}
              id={sql.concat("ignore_row_", sql`row.csv_row_index`)}
            />
          </div>
          <TableComponent color="neutral" borderAxis="both">
            <thead>
              <tr>
                <th>Error</th>
                <th>Field</th>
                <th>Value</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              <Each
                table="validation_error"
                recordName="error"
                where={sql`error.row = row.csv_row_index`}
              >
                <tr>
                  <td>
                    {sql`fn.display_csv_import_validation_error_type(error.type)`}
                  </td>
                  <td>{sql`error.field`}</td>
                  <td className="overflow-x-hidden text-ellipsis">
                    {displayFieldValue(sql`error.field`)}
                  </td>
                  <td>{sql`error.message`}</td>
                </tr>
              </Each>
            </tbody>
          </TableComponent>
        </Card>
      </Each>
    );
  }
  return (
    <Card variant="outlined" sx={styles.importCard}>
      <div sx={styles.importHeader}>
        <Typography sx={styles.importHeaderTypography} level="h3">
          {sql.concat(
            "Import of '",
            sql`file_name`,
            "' into ",
            table.displayName,
          )}
        </Typography>
        <div sx={flexGrowStyles} />
        <Button
          variant="soft"
          color="neutral"
          onClick={(s) => {
            s.setScalar("step", sql`cast('mapping' as enums.csv_import_step)`);
          }}
        >
          Go back
        </Button>
        <Button
          loading={sql`waiting`}
          onClick={(s) => {
            s.if(
              sql`exists (select 1 from preview where csv_has_error and not (csv_ignore_import or
                case
                  when import_type = 'insert' then not is_new_record
                  when import_type = 'update' then is_new_record
                  else false
                end))`,
              (s) => {
                s.setScalar(
                  "error",
                  sql
                    .lit`Please fix or ignore the rows with errors before importing.`,
                );
                s.return();
              },
            );
            s.returnIf(sql`waiting`);
            s.setScalar("waiting", true);
            s.commitUiTreeChanges();
            s.tryServer({
              body: (s) => {
                opts.authorize?.(s);
                if (opts.matching) {
                  s.throwErrorUnless(
                    sql`not exists (
                      select 1
                      from preview import_row
                      where not import_row.csv_ignore_import
                        and (
                          import_row.is_new_record is null
                          or (
                            not import_row.is_new_record
                            and not exists (
                              select 1
                              from ${table.identWithDb} target_record
                              where target_record.${table.primaryKeyIdent} =
                                import_row.target_record_id
                            )
                          )
                        )
                    )`,
                    sql
                      .lit`One or more import matches are unresolved or no longer exist. Go back and preview the file again.`,
                  );
                }
                s.startTransaction();
                s.defScalar(
                  "prior_count",
                  sql`(select count(*) from ${table.identWithDb})`,
                );
                mergeStatements(table, opts, importFields, s);
                opts.afterMerge?.(s);
                s.defScalar(
                  "after_count",
                  sql`(select count(*) from ${table.identWithDb})`,
                );
                s.commitTransaction();
                s.defScalar(
                  "import_count",
                  sql`(
                    select count(*)
                    from preview
                    where not csv_ignore_import
                      and case
                        when import_type = 'insert' then is_new_record
                        when import_type = 'update' then not is_new_record
                        else true
                      end
                  )`,
                );
                s.setScalar("add_count", sql`after_count - prior_count`);
                s.setScalar("update_count", sql`import_count - add_count`);
                s.setScalar(
                  "step",
                  sql`cast('import' as enums.csv_import_step)`,
                );
              },
              errorName: "csv_import_error",
              catch: (s) => {
                s.setScalar(
                  "error",
                  sql.concat(
                    "Failed to import CSV: ",
                    sql`csv_import_error.type`,
                    " - ",
                    sql`coalesce(csv_import_error.message, '')`,
                  ),
                );
              },
              finally: (s) => {
                s.setScalar("waiting", false);
              },
            });
          }}
        >
          Do import
        </Button>
      </div>
      <Show when={sql`error is not null and error != ''`}>
        <Alert variant="soft" color="danger">
          {sql`error`}
        </Alert>
      </Show>
      <div sx={styles.previewStatsContainer}>
        {importTypeSelection()}
        <Divider orientation="vertical" />
        {statsTable()}
      </div>
      {opts.matching && (
        <Show when={sql`exists (select 1 from match_candidate)`}>
          <Show
            when={sql`exists (select 1 from match_resolution where candidate_count > 1)`}
          >
            <Typography level="title-lg">Match decisions</Typography>
            <Show
              when={sql`exists (select 1 from preview where is_new_record is null and not csv_ignore_import)`}
              fallback={
                <Alert variant="soft" color="success">
                  All match decisions are resolved or ignored.
                </Alert>
              }
            >
              <Alert variant="soft" color="warning">
                {sql`concat('Decisions needed: ', format.decimal((select count(*) from preview where is_new_record is null and not csv_ignore_import)), '. Choose an existing record to merge into, create a new record, or ignore the row.')`}
              </Alert>
            </Show>
            <MatchRows multiple />
          </Show>
          <Show
            when={sql`exists (select 1 from match_resolution where candidate_count = 1)`}
          >
            <Typography level="body-md">
              Selected matches will update existing records when imported. No
              additional Merge click is needed.
            </Typography>
            <details className="rounded border border-divider p-3">
              <summary className="cursor-pointer font-medium">
                {sql`concat('Selected matches (', format.decimal((select count(*) from match_resolution where candidate_count = 1)), ') — review details')`}
              </summary>
              <div className="flex flex-col gap-2 mt-3">
                <MatchRows multiple={false} />
              </div>
            </details>
          </Show>
        </Show>
      )}
      <Switch>
        <Match when={sql`exists (select 1 from validation_error)`}>
          <div className="flex items-center justify-between gap-4">
            <Typography level="title-lg">Errors:</Typography>
            <Checkbox
              checked={sql`not exists (
                select 1
                from preview
                where csv_has_error
                  and not csv_ignore_import
              )`}
              label="Ignore all errors"
              variant="outlined"
              size="sm"
              onCheckboxChange={(s) => {
                s.modify(sql`
                  update preview
                  set csv_ignore_import = target_checked
                  where csv_has_error
                `);
              }}
              id="ignore_all_errors"
            />
          </div>
          <Switch>
            <Match when={sql`(select count(*) from validation_error) > 100`}>
              <Alert
                variant="soft"
                color="danger"
                startDecorator={<MaterialIcon icon="Warning" />}
              >
                There are more than 100 errors in the file. Only showing the
                first 100.
              </Alert>
              <Data
                local
                autoWatch
                procedure={(s) => {
                  s.defTable(
                    "displayed_validation_errors",
                    sql`select row from validation_error order by row limit 100`,
                  );
                }}
              >
                <PreviewErrors
                  rowCondition={sql`csv_row_index in (select row from displayed_validation_errors)`}
                />
              </Data>
            </Match>
            <Match when={sql.true}>
              <PreviewErrors
                rowCondition={sql`row.csv_has_error`}
              />
            </Match>
          </Switch>
        </Match>
        <Match when={sql.true}>
          <Alert
            variant="soft"
            color="success"
            startDecorator={<MaterialIcon icon="Check" />}
          >
            No errors found in the file.
          </Alert>
        </Match>
      </Switch>
    </Card>
  );
}

interface SelectFileStepProps {
  pluralTableName: Sql;
  importFields: ImportField[];
  insertIntoRecord: <T extends IStatementsBase>(s: T) => void;
}

function SelectFileStep({
  pluralTableName,
  importFields,
  insertIntoRecord,
}: SelectFileStepProps): JSX.Element {
  return (
    <div sx={styles.buttonScreen()}>
      <Card variant="outlined" sx={styles.cardContainer}>
        <Typography level="h4">
          {sql.concat("Import a file into ", pluralTableName)}
        </Typography>
        <Button
          component="label"
          startDecorator={<MaterialIcon icon="FileOpen" />}
          variant="solid"
          color="primary"
        >
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            sx={visuallyHiddenStyles}
            onFileChange={(s) => {
              s.setScalar("error", sql.null);
              s.modify(sql`delete from csv_file`);
              s.modify(sql`insert into csv_file select uuid from file`);
              s.setScalar("file_name", sql`(select name from file)`);
              s.commitUiTreeChanges();
              s.tryServer({
                transferFiles: sql`select uuid from csv_file`,
                body: (s) => {
                  s.readDomFile(sql`(select uuid from file)`);
                  s.modify(sql`delete from header`);
                  s.modify(sql`delete from xlsx_sheets`);
                  s.if(isXlsxFile(), (s) => {
                    s.modify(
                      sql`insert into xlsx_sheets select name, cast(index as int) from xlsx.sheets(body)`,
                    );
                    s.setScalar(
                      "selected_xlsx_sheet_ordinal",
                      sql`coalesce((select ordinal from xlsx_sheets order by ordinal limit 1), 0)`,
                    );
                  });
                  s.setScalar("first_row_is_header", true);
                  insertHeaderFromBody(s, importFields);
                  insertIntoRecord(s);
                  s.setScalar(
                    "step",
                    sql`cast('mapping' as enums.csv_import_step)`,
                  );
                },
                errorName: "service_error",
                catch: (s) => {
                  s.setScalar(
                    "error",
                    sql`service_error.type || coalesce(service_error.message, '')`,
                  );
                },
              });
            }}
          />
          Select a CSV or Excel file
        </Button>
        <Show when={sql`error is not null`}>
          <Alert size="md" color="danger">
            {sql.concat("Unable to parse file: ", sql`error`)}
          </Alert>
        </Show>
      </Card>
    </div>
  );
}

function parseCsvIntoPreview(s: UiServerStatements, fields: ImportField[]) {
  s.modify(sql`delete from preview`);
  const fromCsvSelect: SelectColumn[] = [];
  const csvImportFieldNames: string[] = [];
  for (const config of fields) {
    const fieldName = config.field.name;
    const fieldImportSource = sql`form.${sql(fieldName)}_import_source`;
    const fieldCsvOrdinal = sql`form.${sql(fieldName)}_csv_ordinal`;
    const fieldCsvTransform = sql`form.${sql(fieldName)}_csv_transform`;
    if (config.csvImport) {
      csvImportFieldNames.push(fieldName);
      if (config.constant) {
        fromCsvSelect.push(
          selectColumn(
            sql`case
                when ${fieldImportSource} != 'csv' or ${fieldCsvOrdinal} is null then null
                when ${fieldCsvTransform} = 'none' then trim(dynamic_field(row, ${fieldCsvOrdinal}))
                else fn.apply_import_source_transform(trim(dynamic_field(row, ${fieldCsvOrdinal})), ${fieldCsvTransform})
            end`,
            fieldName,
          ),
        );
      } else {
        fromCsvSelect.push(
          selectColumn(
            sql`case
                when ${fieldCsvOrdinal} is null then null
                when ${fieldCsvTransform} = 'none' then trim(dynamic_field(row, ${fieldCsvOrdinal}))
                else fn.apply_import_source_transform(trim(dynamic_field(row, ${fieldCsvOrdinal})), ${fieldCsvTransform})
            end`,
            fieldName,
          ),
        );
      }
    }
  }
  s.if(isXlsxFile(), (s) => {
    s.modify(
      sql`insert into preview ${
        insertValueColumns(
          "csv_row_index",
          "is_new_record",
          "csv_ignore_import",
          "csv_has_error",
          ...csvImportFieldNames,
        )
      }
      select row.ordinal, null, false, false, ${fromCsvSelect}
      from xlsx.rows(
        body,
        selected_xlsx_sheet_ordinal,
        skip_rows => case when first_row_is_header then 1 else 0 end,
        col_count => ${sql(String(IMPORT_COL_COUNT))}
      ) as row`,
    );
  });
  s.if(sql`not (${isXlsxFile()})`, (s) => {
    prepareCsvTextFromBody(s, fields);
    s.modify(
      sql`insert into preview ${
        insertValueColumns(
          "csv_row_index",
          "is_new_record",
          "csv_ignore_import",
          "csv_has_error",
          ...csvImportFieldNames,
        )
      }
      select row.ordinal + 1, null, false, false, ${fromCsvSelect}
      from csv.rows(
        csv_text,
        col_count => ${sql(String(IMPORT_COL_COUNT))}
      ) as row`,
    );
  });
}

function validateCsv(
  s: UiServerStatements,
  props: BulkMergeImportProps,
  table: Table,
  fields: ImportField[],
) {
  s.modify(sql`delete from validation_error`);
  // Set-based is_new_record before the row loop. Avoids per-row scalar
  // NOT EXISTS over preview (a tmp-table source the platform planner
  // can't reliably hash), and drops validateCsv from ~70 s → ~1 s on
  // 3,270 × 5.36 M. Recomputed inside mergeStatements at Do import time
  // so any concurrent writes to target between here and Do import don't
  // produce a stale partition.
  refreshImportMatches(s, table, props);
  if (props.matching) {
    const missingMatchValue = sql.or(
      ...props.matching.strategies.map((strategy) => {
        const rules = strategyRules(props.matching!, strategy);
        return sql`matching_strategy = ${sql.lit(strategy.name)} and not (${
          sql.or(
            ...rules.map((rule) =>
              matchingSourceValueIsPresent(rule, sql`import_row`)
            ),
          )
        })`;
      }),
    );
    s.modify(sql`
      insert into validation_error (type, row, message)
      select
        'missing_match_field',
        import_row.csv_row_index,
        'At least one field used by the selected matching method is required'
      from preview import_row
      where ${missingMatchValue}
    `);
    for (const strategy of props.matching.strategies) {
      s.if(sql`matching_strategy = ${sql.lit(strategy.name)}`, (s) => {
        for (
          const rule of strategyRules(props.matching!, strategy).filter(
            (rule) => rule.deduplicateRows !== false,
          )
        ) {
          const importValue = normalizeMatchValue(
            rule,
            sql`import_row.${sql.ref(rule.sourceField)}`,
          );
          const groupedValue = normalizeMatchValue(
            rule,
            sql`duplicate_source.${sql.ref(rule.sourceField)}`,
          );
          s.modify(sql`
            insert into validation_error (type, row, message)
            select
              'duplicate_row',
              import_row.csv_row_index,
              'Another row in this file has the same matching identity'
            from preview import_row
            join (
              select
                ${groupedValue} as match_value,
                min(csv_row_index) as first_csv_row_index
              from preview duplicate_source
              where ${groupedValue} is not null
              group by ${groupedValue}
            ) duplicate_value on ${importValue} = duplicate_value.match_value
            where import_row.csv_row_index != duplicate_value.first_csv_row_index
              and not exists (
                select 1
                from validation_error existing_error
                where existing_error.row = import_row.csv_row_index
              )
          `);
        }
      });
    }
    s.modify(sql`
      insert into validation_error (type, row, message)
      select
        'ambiguous_match',
        import_row.csv_row_index,
        'More than one existing record matches this row; choose one or create a new record'
      from preview import_row
      where import_row.csv_row_index in (
        select resolution.csv_row_index
        from match_resolution resolution
        where resolution.candidate_count > 1
      )
        and import_row.csv_row_index not in (
          select row from validation_error
        )
    `);
  }
  s.forEachTable("preview", "row", (s) => {
    if (props.matching) {
      s.continueIf(
        sql`row.csv_row_index in (
          select validation_error.row from validation_error
        )`,
      );
    } else {
      s.if(
        sql`row.${sql.ref(props.mergeField)} is null or row.${
          sql.ref(props.mergeField)
        } = ''`,
        (s) => {
          s.modify(
            sql`insert into validation_error (type, field, row) values ('missing_merge_field', ${
              sql.lit(props.mergeField)
            }, row.csv_row_index)`,
          );
          s.continue();
        },
      );
      s.if(
        sql`exists (select 1 from preview where ${
          sql.ref(props.mergeField)
        } = row.${sql.ref(props.mergeField)}
          and row.csv_row_index > csv_row_index)`,
        (s) => {
          s.modify(
            sql`insert into validation_error (type, field, row) values ('duplicate_row', ${
              sql.lit(props.mergeField)
            }, row.csv_row_index)`,
          );
          s.modify(
            sql`update row set is_new_record = (select is_new_record from preview where ${
              sql.ref(props.mergeField)
            } = row.${sql.ref(props.mergeField)}
              and row.csv_row_index > csv_row_index)`,
          );
          s.continue();
        },
      );
    }
    // is_new_record set in bulk above the loop.
    s.defScalar("is_specified", {
      type: "Bool",
      expr: false,
      allowNoRead: true,
    });
    for (const config of fields) {
      if (!config.csvImport) {
        continue;
      }
      s.setScalar(
        "is_specified",
        sql`row.${sql.ref(config.field.name)} is not null and row.${
          sql.ref(config.field.name)
        } != ''`,
      );
      if (config.field.notNull && !sql.isAnyExpr(config.field.default)) {
        s.if(sql`row.is_new_record and not is_specified`, (s) => {
          if (props.mergeField !== config.field.name || props.matching) {
            const fieldImportSource = sql`form.${
              sql(config.field.name)
            }_import_source`;
            s.continueIf(
              sql`${fieldImportSource} = 'constant' and not (${
                fieldIsNotSetInForm(config.field)
              })`,
            );
          }
          s.modify(
            sql`insert into validation_error (type, field, row) values ('missing_required_field', ${
              sql.lit(config.field.name)
            }, row.csv_row_index)`,
          );
          s.continue();
        });
      }
      switch (config.field.type) {
        case "Enum": {
          s.if(
            sql`is_specified and ${
              config.field.tryCastToType(
                sql`lower(row.${sql.ref(config.field.name)})`,
              )
            } is null`,
            (s) => {
              s.modify(
                sql`insert into validation_error (type, field, row) values ('invalid_enum', ${
                  sql.lit(config.field.name)
                }, row.csv_row_index)`,
              );
              s.continue();
            },
          );
          break;
        }
        case "ForeignKey": {
          const table = system.db.tables[config.field.table];
          if (!canAutoInsertTable(table.name)) {
            s.if(
              sql`is_specified and not exists (select 1 from ${table.identWithDb} where name = row.${
                sql.ref(config.field.name)
              })`,
              (s) => {
                s.modify(
                  sql`insert into validation_error (type, field, row) values (
                  'invalid_reference',
                  ${sql.lit(config.field.name)},
                  row.csv_row_index
                )`,
                );
                s.continue();
              },
            );
          }
          break;
        }
        case "String": {
          const maxLength = config.field.maxLength ?? 255;
          s.if(
            sql`char_length(row.${sql.ref(config.field.name)}) > ${maxLength}`,
            (s) => {
              s.modify(
                sql`insert into validation_error (type, field, row, message) values (
                'too_long',
                ${sql.lit(config.field.name)},
                row.csv_row_index,
                ${sql.lit(`Maximum length is ${maxLength} characters`)}
              )`,
              );
              s.continue();
            },
          );
          break;
        }
        default: {
          s.if(
            sql`is_specified and ${
              config.field.tryCastToType(sql`row.${sql.ref(config.field.name)}`)
            } is null`,
            (s) => {
              s.modify(
                sql`insert into validation_error (type, field, row, message) values (
                  'invalid_type',
                  ${sql.lit(config.field.name)},
                  row.csv_row_index,
                  concat('Cannot convert value "', row.${
                  sql.ref(config.field.name)
                }, '" to correct type for field "', ${
                  sql.lit(config.field.displayName)
                }, '"')
                )`,
              );
              s.continue();
            },
          );
          break;
        }
      }
    }
  });
  // Compute membership once on the server: checking validation_error for every
  // preview row in browser-rendered counts and controls freezes large imports.
  s.modify(sql`update preview set csv_has_error = false`);
  s.modify(sql`update preview set csv_has_error = true
    where csv_row_index in (select row from validation_error)`);
}

interface MappingStepProps {
  pluralTableName: Sql;
  importFields: ImportField[];
  opts: BulkMergeImportProps;
  table: Table;
  insertIntoRecord: <T extends IStatementsBase>(s: T) => void;
}

function MappingStep({
  pluralTableName,
  importFields,
  opts,
  table,
  insertIntoRecord,
}: MappingStepProps): JSX.Element {
  return (
    <div sx={styles.importScreen()}>
      <Card variant="outlined" sx={styles.importCard}>
        <div sx={styles.importHeader}>
          <Typography level="h3" sx={styles.importHeaderTypography}>
            {sql.concat(
              "Import of '",
              sql`file_name`,
              "' into ",
              pluralTableName,
            )}
          </Typography>
          <div sx={flexGrowStyles} />
          <Button
            variant="soft"
            color="neutral"
            onClick={(s) => {
              s.setScalar(
                "step",
                sql`cast('file_select' as enums.csv_import_step)`,
              );
              s.modify(sql`delete from header`);
              s.modify(sql`delete from preview`);
              s.modify(sql`delete from validation_error`);
              s.modify(sql`delete from match_candidate`);
              s.modify(sql`delete from match_candidate_rule`);
              s.modify(sql`delete from match_selected_priority`);
              s.modify(sql`delete from match_resolution`);
              s.modify(sql`delete from csv_file`);
              s.modify(sql`delete from xlsx_sheets`);
              s.setScalar("waiting", false);
              s.setScalar("file_name", sql.null);
              s.setScalar("selected_xlsx_sheet_ordinal", sql`0`);
              s.setScalar("error", sql.null);
              // Originally it only updated the refresh key
              // s.increment("refresh_key");
            }}
          >
            Cancel
          </Button>
          <Button
            loading={sql`waiting`}
            onClick={(s) => {
              s.returnIf(sql`waiting`);
              s.setScalar("waiting", true);
              s.commitUiTreeChanges();
              s.tryServer({
                transferFiles: sql`select uuid from csv_file`,
                body: (s) => {
                  opts.authorize?.(s);
                  s.readDomFile(sql`(select uuid from csv_file)`);
                  parseCsvIntoPreview(s, importFields);
                  validateCsv(s, opts, table, importFields);
                  s.setScalar(
                    "step",
                    sql`cast('preview' as enums.csv_import_step)`,
                  );
                  s.setScalar("waiting", false);
                },
                errorName: "service_error",
                catch: (s) => {
                  s.setScalar(
                    "error",
                    sql.concat(
                      "Failed to validate ",
                      sql`service_error.type`,
                      " ",
                      sql`coalesce(service_error.message, '')`,
                    ),
                  );
                },
                finally: (s) => {
                  s.setScalar("waiting", false);
                },
              });
            }}
          >
            Next
          </Button>
        </div>
        <Show when={sql`error is not null`}>
          <Alert
            startDecorator={<MaterialIcon icon="Warning" />}
            color="danger"
            className="mb-6"
          >
            {sql`error`}
          </Alert>
        </Show>
        <Show when={sql`exists(select 1 from xlsx_sheets)`}>
          <div className="mb-6 flex max-w-sm flex-col gap-3">
            <FormControl>
              <FormLabel>Workbook sheet</FormLabel>
              <EachSelect
                size="sm"
                value={sql`selected_xlsx_sheet_ordinal`}
                table="xlsx_sheets"
                findOnValue="name"
                optionLabel="name"
                optionValue="ordinal"
                onChange={(s) => {
                  s.setScalar(
                    "selected_xlsx_sheet_ordinal",
                    sql`cast(target_value as int)`,
                  );
                  s.setScalar("waiting", true);
                  s.commitUiTreeChanges();
                  s.tryServer({
                    transferFiles: sql`select uuid from csv_file`,
                    body: (s) => {
                      s.readDomFile(sql`(select uuid from csv_file)`);
                      s.modify(sql`delete from header`);
                      insertHeaderFromBody(s, importFields);
                      s.modify(sql`delete from form`);
                      insertIntoRecord(s);
                      s.setScalar("waiting", false);
                    },
                    errorName: "service_error",
                    catch: (s) => {
                      s.setScalar(
                        "error",
                        sql.concat(
                          "Failed to read sheet ",
                          sql`service_error.type`,
                          " ",
                          sql`coalesce(service_error.message, '')`,
                        ),
                      );
                    },
                    finally: (s) => {
                      s.setScalar("waiting", false);
                    },
                  });
                }}
              />
            </FormControl>
            <Checkbox bindScalar="first_row_is_header">
              First row contains headers
            </Checkbox>
          </div>
        </Show>
        {opts.matching && (
          <div className="mb-6 flex max-w-xl flex-col gap-2">
            <Typography level="title-md">Matching method</Typography>
            <RadioGroup>
              {opts.matching.strategies.map((strategy) => (
                <Radio
                  variant="soft"
                  color="primary"
                  checked={sql`matching_strategy = ${sql.lit(strategy.name)}`}
                  label={strategy.displayName}
                  onChange={(s) => {
                    s.setScalar(
                      "matching_strategy",
                      sql.lit(strategy.name),
                    );
                  }}
                />
              ))}
            </RadioGroup>
            {opts.matching.strategies.map((strategy) =>
              strategy.description
                ? (
                  <Show
                    when={sql`matching_strategy = ${sql.lit(strategy.name)}`}
                  >
                    <Typography level="body-sm" className="text-secondary">
                      {strategy.description}
                    </Typography>
                  </Show>
                )
                : null
            )}
          </div>
        )}
        <div sx={styles.fieldContainer}>
          {importFields.map((config) => <ImportFieldControl config={config} />)}
        </div>
      </Card>
    </div>
  );
}

interface SuccessStepProps {
  pluralTableName: Sql;
}

function SuccessStep({ pluralTableName }: SuccessStepProps): JSX.Element {
  return (
    <div sx={styles.successScreen()}>
      <Card variant="outlined" sx={styles.successCard}>
        <MaterialIcon icon="Done" fontSize="4xl" />
        <Typography level="h4">
          {sql.concat("Imported csv into ", pluralTableName)}
        </Typography>
        <Typography level="body-lg">
          {sql.concat("Added ", sql`format.decimal(add_count)`)}
        </Typography>
        <Typography level="body-lg">
          {sql.concat("Updated ", sql`format.decimal(update_count)`)}
        </Typography>
        <Button
          variant="soft"
          color="success"
          onClick={(s) => {
            s.setScalar(
              "step",
              sql`cast('file_select' as enums.csv_import_step)`,
            );
            s.modify(sql`delete from header`);
            s.modify(sql`delete from preview`);
            s.modify(sql`delete from validation_error`);
            s.modify(sql`delete from match_candidate`);
            s.modify(sql`delete from match_candidate_rule`);
            s.modify(sql`delete from match_selected_priority`);
            s.modify(sql`delete from match_resolution`);
            s.setScalar("waiting", false);
            s.setScalar("file_name", sql.null);
            s.setScalar("error", sql.null);
            s.setScalar("imported", false);
            s.setScalar("add_count", 0);
            s.setScalar("update_count", 0);
          }}
        >
          Click here to import more
        </Button>
      </Card>
    </div>
  );
}
