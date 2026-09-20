import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card } from "components/card";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { EachSelect } from "components/each_select";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { Table as TableComponent } from "components/table";
import { Typography } from "components/typography";
import {
  insertValueColumns,
  selectColumn,
  sql,
  updateAssignment,
  valuesRow,
} from "std/sql_utils";
import type {
  AnyExpr,
  SelectColumn,
  Sql,
  UpdateAssignment,
} from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { createStyles, visuallyHiddenStyles } from "std/style_utils";
import { system } from "std/system";
import type { Field } from "std/system";
import { Each, Match, Show, Switch, useState } from "std/ui";

interface WorkforceImportEnumValue {
  name: string;
  displayName: string;
}

interface WorkforceImportBlock {
  peopleTable: string;
  organizationsTable: string;
  workerRelationshipsTable: string;
  jobProfilesTable: string;
  assignmentsTable: string;
  orgUnitsTable?: string;
  locationsTable?: string;
  positionsTable?: string;
  authRoleMappingsTable?: string;
  workerTypes: WorkforceImportEnumValue[];
  personStatuses: WorkforceImportEnumValue[];
  relationshipStatuses: WorkforceImportEnumValue[];
  assignmentStatuses: WorkforceImportEnumValue[];
  activePersonStatus: string;
  activeRelationshipStatus: string;
  activeAssignmentStatus: string;
  sysUserLink: "person_field" | "sys_user_field";
  assertManagementSession(s: UiServerStatements): void;
  syncPersonLoginState(s: UiServerStatements, personId: Sql): void;
}

export interface WorkforcePeopleImportActionProps {
  workforce: WorkforceImportBlock;
  defaultLanguage?: Sql | string;
  defaultOrganization?: Sql | string;
  defaultHostOrganization?: Sql | string;
  defaultJobProfile?: Sql | string;
  afterImport?: (s: UiServerStatements) => void;
}

type WorkforceImportTarget = "person" | "relationship" | "assignment";

interface WorkforceImportField {
  name: string;
  label: string;
  target: WorkforceImportTarget;
  dbFieldName?: string;
  field?: Field;
  enumName?: string;
  enumValues?: WorkforceImportEnumValue[];
  referenceTable?: string;
  resolvedIdField?: string;
  castType?: "date";
  maxLength?: number;
  headerVariations?: string[];
}

const WORKFORCE_IMPORT_COL_COUNT = 150;
const WORKFORCE_IMPORT_TEXT_MAX_LENGTH = 10000000;
const WORKFORCE_IMPORT_PREVIEW_FIELDS = [
  "csv_row_index",
  "csv_ignore_import",
  "is_new_person",
  "person_id",
  "worker_relationship_id",
  "assignment_id",
  "organization_id",
  "host_organization_id",
  "job_profile_id",
  "org_unit_id",
  "location_id",
  "position_id",
];
const styles = createStyles({
  actionRow: {
    display: "flex",
    gap: 2,
    alignItems: "center",
    flexWrap: "wrap",
  },
  modalBody: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 2,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  fileSelect: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    py: 8,
  },
  mappingGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 2,
  },
  previewStats: {
    display: "flex",
    gap: 2,
    flexWrap: "wrap",
  },
  statCard: {
    minWidth: 140,
    flex: "1 1 140px",
    p: 2,
  },
  previewTableWrap: {
    overflowX: "auto",
    maxHeight: "52vh",
  },
  rowActions: {
    display: "flex",
    alignItems: "center",
    gap: 1,
  },
});

function sqlStringList(values: string[]) {
  return values.map((value) => sql.lit(value.toLowerCase()).toSQL()).join(",");
}

function fieldHeaderVariations(field: WorkforceImportField) {
  const variations = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    variations.add(normalized);
    variations.add(normalized.replaceAll("_", " "));
    variations.add(normalized.replaceAll("_", ""));
  };
  add(field.name);
  add(field.label);
  for (const variation of field.headerVariations ?? []) {
    add(variation);
  }
  return [...variations];
}

function fieldOrdinalScalar(field: WorkforceImportField) {
  return `workforce_import_${field.name}_csv_ordinal`;
}

function fieldHeaderOrdinalExpr(field: WorkforceImportField) {
  return sql`
    (
      select ordinal
      from workforce_import_header
      where lower(trim(value)) in (${
    sql(sqlStringList(fieldHeaderVariations(field)))
  })
      order by ordinal
      limit 1
    )
  `;
}

function rawFieldValue(
  field: WorkforceImportField,
  row: Sql = sql`import_row`,
) {
  return sql`${row}.${sql.ref(field.name)}`;
}

function trimmedFieldValue(
  field: WorkforceImportField,
  row: Sql = sql`import_row`,
) {
  return sql`nullif(trim(${rawFieldValue(field, row)}), '')`;
}

function trimmedValue(value: Sql) {
  return sql`nullif(trim(${value}), '')`;
}

function propToSql(value: Sql | string | undefined) {
  return typeof value === "string" ? sql.lit(value) : value;
}

interface WorkforceImportDefaultValues {
  organization?: Sql;
  hostOrganization?: Sql;
  jobProfile?: Sql;
}

function importDefaultValues(
  props: WorkforcePeopleImportActionProps,
): WorkforceImportDefaultValues {
  return {
    organization: propToSql(props.defaultOrganization),
    hostOrganization: propToSql(props.defaultHostOrganization),
    jobProfile: propToSql(props.defaultJobProfile),
  };
}

function configuredDefault(value: Sql | string | undefined) {
  return value !== undefined && (typeof value !== "string" || value.trim());
}

function rawNamedFieldValue(name: string, row: Sql = sql`import_row`) {
  return sql`${row}.${sql.ref(name)}`;
}

function trimmedNamedFieldValue(name: string, row: Sql = sql`import_row`) {
  return sql`nullif(trim(${rawNamedFieldValue(name, row)}), '')`;
}

function defaultValueForField(
  field: WorkforceImportField,
  defaults: WorkforceImportDefaultValues,
) {
  if (field.name === "organization") return defaults.organization;
  if (field.name === "host_organization") return defaults.hostOrganization;
  if (field.name === "job_profile") return defaults.jobProfile;
}

function effectiveFieldValue(
  field: WorkforceImportField,
  defaults: WorkforceImportDefaultValues,
  opts: {
    row?: Sql;
    workforce?: WorkforceImportBlock;
  } = {},
) {
  const row = opts.row ?? sql`import_row`;
  const value = trimmedFieldValue(field, row);
  const defaultValue = defaultValueForField(field, defaults);
  if (!defaultValue) return value;
  const defaultExpr = trimmedValue(defaultValue);
  if (field.name === "job_profile" && opts.workforce?.positionsTable) {
    return sql`coalesce(
      ${value},
      case
        when ${
      trimmedNamedFieldValue("position", row)
    } is null then ${defaultExpr}
        else null
      end
    )`;
  }
  return sql`coalesce(${value}, ${defaultExpr})`;
}

function enumValueExpr(
  enumName: string,
  values: WorkforceImportEnumValue[],
  value: Sql,
) {
  return sql.caseWhen({
    operand: sql`lower(trim(${value}))`,
    conditions: values.flatMap((enumValue) => [
      {
        condition: sql.lit(enumValue.name.toLowerCase()),
        expr: sql`cast(${sql.lit(enumValue.name)} as enums.${
          sql.ref(enumName)
        })`,
      },
      {
        condition: sql.lit(enumValue.displayName.toLowerCase()),
        expr: sql`cast(${sql.lit(enumValue.name)} as enums.${
          sql.ref(enumName)
        })`,
      },
    ]),
  });
}

function dbValueForField(
  field: WorkforceImportField,
  opts: {
    row?: Sql;
    defaultExpr?: AnyExpr;
  } = {},
) {
  const row = opts.row ?? sql`import_row`;
  const value = trimmedFieldValue(field, row);
  let expr: Sql;
  if (field.resolvedIdField) {
    expr = sql`${row}.${sql.ref(field.resolvedIdField)}`;
  } else if (field.enumName && field.enumValues) {
    expr = enumValueExpr(field.enumName, field.enumValues, value);
  } else if (field.field) {
    if (field.field.type === "String") {
      expr = value;
    } else {
      expr = field.field.tryCastToType(value);
    }
  } else {
    expr = value;
  }
  return opts.defaultExpr ? sql`coalesce(${expr}, ${opts.defaultExpr})` : expr;
}

function importFieldValueOrExisting(
  field: WorkforceImportField,
  existingRecord: Sql,
  valueExpr: Sql,
) {
  return sql`case
    when ${trimmedFieldValue(field)} is null
      then ${existingRecord}.${sql.ref(field.dbFieldName ?? field.name)}
    else ${valueExpr}
  end`;
}

function supportedExtraPersonField(field: Field) {
  switch (field.type) {
    case "String":
    case "PhoneNumber":
    case "Bool":
    case "Date":
    case "Enum":
    case "TinyUint":
    case "TinyInt":
    case "SmallUint":
    case "SmallInt":
    case "Uint":
    case "Int":
    case "BigUint":
    case "BigInt":
    case "Real":
    case "Double":
    case "Decimal":
      return true;
    default:
      return false;
  }
}

function unsupportedRequiredExtraPersonField(field: Field) {
  return field.notNull && !field.default && !supportedExtraPersonField(field);
}

function getWorkforceImportFields(
  workforce: WorkforceImportBlock,
): WorkforceImportField[] {
  const peopleTable = system.db.tables[workforce.peopleTable];
  const fields: WorkforceImportField[] = [];
  const addPersonField = (
    name: string,
    label: string,
    options: Omit<WorkforceImportField, "name" | "label" | "target"> = {},
  ) => {
    const fieldName = options.dbFieldName ?? name;
    const field = peopleTable.fields[fieldName];
    if (!field) return;
    fields.push({
      name,
      label,
      target: "person",
      dbFieldName: fieldName,
      field,
      maxLength: field.type === "String" ? field.maxLength : undefined,
      ...options,
    });
  };

  addPersonField("display_name", "Display name", {
    headerVariations: ["name", "full name", "full_name"],
  });
  addPersonField("preferred_name", "Preferred name");
  addPersonField("email", "Email", {
    headerVariations: ["email address", "email_address"],
  });
  addPersonField("phone", "Phone", {
    headerVariations: ["phone number", "phone_number"],
  });
  addPersonField("preferred_language", "Preferred language", {
    headerVariations: ["language", "locale"],
  });
  addPersonField("person_status", "Person status", {
    dbFieldName: "status",
    enumName: "workforce_person_status",
    enumValues: workforce.personStatuses,
    headerVariations: ["status", "person status", "person_status"],
  });

  fields.push(
    {
      name: "organization",
      label: "Employer organization",
      target: "relationship",
      dbFieldName: "workforce_organization_id",
      referenceTable: workforce.organizationsTable,
      resolvedIdField: "organization_id",
      headerVariations: [
        "company",
        "employer",
        "employer company",
        "organization",
        "workforce organization",
      ],
    },
    {
      name: "host_organization",
      label: "Host organization",
      target: "assignment",
      dbFieldName: "host_workforce_organization_id",
      referenceTable: workforce.organizationsTable,
      resolvedIdField: "host_organization_id",
      headerVariations: ["host", "host company", "host organization"],
    },
    {
      name: "worker_type",
      label: "Worker type",
      target: "relationship",
      dbFieldName: "worker_type",
      enumName: "workforce_worker_type",
      enumValues: workforce.workerTypes,
    },
    {
      name: "relationship_status",
      label: "Relationship status",
      target: "relationship",
      dbFieldName: "status",
      enumName: "workforce_relationship_status",
      enumValues: workforce.relationshipStatuses,
    },
    {
      name: "external_worker_id",
      label: "External worker ID",
      target: "relationship",
      dbFieldName: "external_worker_id",
      maxLength: 100,
      headerVariations: ["employee id", "employee_id", "worker id"],
    },
    {
      name: "relationship_effective_from",
      label: "Relationship start date",
      target: "relationship",
      dbFieldName: "effective_from",
      castType: "date",
      headerVariations: [
        "hire date",
        "start date",
        "relationship effective from",
      ],
    },
    {
      name: "job_profile",
      label: "Job profile",
      target: "assignment",
      dbFieldName: "workforce_job_profile_id",
      referenceTable: workforce.jobProfilesTable,
      resolvedIdField: "job_profile_id",
      headerVariations: workforce.positionsTable
        ? ["job", "job profile", "job code"]
        : ["job", "job profile", "job position", "position", "job code"],
    },
    {
      name: "assignment_status",
      label: "Assignment status",
      target: "assignment",
      dbFieldName: "status",
      enumName: "workforce_assignment_status",
      enumValues: workforce.assignmentStatuses,
    },
    {
      name: "assignment_effective_from",
      label: "Assignment start date",
      target: "assignment",
      dbFieldName: "effective_from",
      castType: "date",
      headerVariations: ["assignment effective from", "assignment start date"],
    },
  );

  if (workforce.orgUnitsTable) {
    fields.push({
      name: "org_unit",
      label: "Org unit",
      target: "assignment",
      dbFieldName: "workforce_org_unit_id",
      referenceTable: workforce.orgUnitsTable,
      resolvedIdField: "org_unit_id",
      headerVariations: ["department", "team", "org unit", "org_unit"],
    });
  }
  if (workforce.locationsTable) {
    fields.push({
      name: "location",
      label: "Location",
      target: "assignment",
      dbFieldName: "workforce_location_id",
      referenceTable: workforce.locationsTable,
      resolvedIdField: "location_id",
      headerVariations: ["work location", "work_location", "site"],
    });
  }
  if (workforce.positionsTable) {
    fields.push({
      name: "position",
      label: "Position",
      target: "assignment",
      dbFieldName: "workforce_position_id",
      referenceTable: workforce.positionsTable,
      resolvedIdField: "position_id",
      headerVariations: ["job position", "job_position", "position code"],
    });
  }

  const reserved = new Set([
    "sys_user_id",
    "display_name",
    "preferred_name",
    "email",
    "phone",
    "preferred_language",
    "status",
    "created_at",
  ]);
  for (const field of Object.values(peopleTable.fields)) {
    if (reserved.has(field.name)) {
      continue;
    }
    if (unsupportedRequiredExtraPersonField(field)) {
      throw new Error(
        `Workforce people CSV import cannot import required person field "${field.name}" (${field.type}). Add a database default, make the field nullable, or add importer support for this field type.`,
      );
    }
    if (!supportedExtraPersonField(field)) {
      continue;
    }
    fields.push({
      name: field.name,
      label: field.displayName,
      target: "person",
      dbFieldName: field.name,
      field,
      enumName: field.type === "Enum" ? field.enum : undefined,
      maxLength: field.type === "String" ? field.maxLength : undefined,
    });
  }
  return fields;
}

function prepareCsvTextFromBody(s: UiServerStatements) {
  s.defScalar("workforce_import_csv_text", {
    type: { type: "String", maxLength: WORKFORCE_IMPORT_TEXT_MAX_LENGTH },
  });
  s.setScalar("workforce_import_csv_text", sql`string.from_utf8(body)`);
}

function insertHeaderFromBody(
  s: UiServerStatements,
  fields: WorkforceImportField[],
) {
  prepareCsvTextFromBody(s);
  s.modify(sql`delete from workforce_import_header`);
  s.modify(sql`
    insert into workforce_import_header (value, ordinal)
    values ('Do not import', -1)
  `);
  s.modify(sql`
    insert into workforce_import_header
    select value, ordinal
    from string.split(
      trim(split_part(workforce_import_csv_text, chr(10), 1)),
      ','
    )
  `);
  for (const field of fields) {
    s.setScalar(fieldOrdinalScalar(field), fieldHeaderOrdinalExpr(field));
  }
}

function parseCsvIntoPreview(
  s: UiServerStatements,
  fields: WorkforceImportField[],
) {
  prepareCsvTextFromBody(s);
  s.modify(sql`delete from workforce_import_preview`);
  s.modify(sql`delete from workforce_import_validation_error`);
  const fieldSelect: SelectColumn[] = fields.map((field) =>
    selectColumn(
      sql`case
        when ${sql.ref(fieldOrdinalScalar(field))} is null
          or ${sql.ref(fieldOrdinalScalar(field))} < 0 then null
        else nullif(
          trim(dynamic_field(row, ${sql.ref(fieldOrdinalScalar(field))})),
          ''
        )
      end`,
      field.name,
    )
  );
  s.modify(sql`
    insert into workforce_import_preview ${
    insertValueColumns(
      ...WORKFORCE_IMPORT_PREVIEW_FIELDS,
      ...fields.map((field) => field.name),
    )
  }
    select
      row.ordinal + 2,
      false,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      ${fieldSelect}
    from csv.rows(
      workforce_import_csv_text,
      col_count => ${sql(String(WORKFORCE_IMPORT_COL_COUNT))}
    ) as row
  `);
}

function referenceMatch(tableAlias: Sql, value: Sql) {
  return sql`(
    lower(${tableAlias}.name) = lower(trim(${value}))
    or lower(coalesce(${tableAlias}.code, '')) = lower(trim(${value}))
  )`;
}

function referenceMatchCount(
  field: WorkforceImportField,
  workforce: WorkforceImportBlock,
  defaults: WorkforceImportDefaultValues,
) {
  const tableName = field.referenceTable!;
  const value = effectiveFieldValue(field, defaults, { workforce });
  let where = referenceMatch(sql`reference_record`, value);
  if (field.name === "org_unit" || field.name === "location") {
    where = sql`${where}
      and (
        import_row.organization_id is null
        or reference_record.workforce_organization_id = import_row.organization_id
      )`;
  }
  if (field.name === "position") {
    where = sql`${where}
      and (
        import_row.organization_id is null
        or reference_record.workforce_organization_id is null
        or reference_record.workforce_organization_id = import_row.organization_id
      )`;
  }
  return sql`(
    select count(*)
    from db.${sql.ref(tableName)} reference_record
    where ${where}
  )`;
}

function resolveReferences(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
  defaults: WorkforceImportDefaultValues,
) {
  const organizationField: WorkforceImportField = {
    name: "organization",
    label: "",
    target: "relationship",
  };
  const hostOrganizationField: WorkforceImportField = {
    name: "host_organization",
    label: "",
    target: "assignment",
  };
  const jobProfileField: WorkforceImportField = {
    name: "job_profile",
    label: "",
    target: "assignment",
  };
  const organizationValue = effectiveFieldValue(organizationField, defaults, {
    workforce,
  });
  const hostOrganizationValue = effectiveFieldValue(
    hostOrganizationField,
    defaults,
    { workforce },
  );
  const jobProfileValue = effectiveFieldValue(jobProfileField, defaults, {
    workforce,
  });
  s.modify(sql`
    update workforce_import_preview import_row
    set person_id = (
      select person.id
      from db.${sql.ref(workforce.peopleTable)} person
      where lower(person.email) = lower(trim(import_row.email))
      order by person.id
      limit 1
    )
  `);
  s.modify(sql`
    update workforce_import_preview
    set is_new_person = person_id is null
  `);
  s.modify(sql`
    update workforce_import_preview import_row
    set organization_id = (
      select org.id
      from db.${sql.ref(workforce.organizationsTable)} org
      where ${referenceMatch(sql`org`, organizationValue)}
      order by org.id
      limit 1
    )
    where ${organizationValue} is not null
  `);
  s.modify(sql`
    update workforce_import_preview import_row
    set host_organization_id = (
      select org.id
      from db.${sql.ref(workforce.organizationsTable)} org
      where ${referenceMatch(sql`org`, hostOrganizationValue)}
      order by org.id
      limit 1
    )
    where ${hostOrganizationValue} is not null
  `);
  s.modify(sql`
    update workforce_import_preview import_row
    set job_profile_id = (
      select job.id
      from db.${sql.ref(workforce.jobProfilesTable)} job
      where ${referenceMatch(sql`job`, jobProfileValue)}
      order by job.id
      limit 1
    )
    where ${jobProfileValue} is not null
  `);
  s.modify(sql`
    update workforce_import_preview import_row
    set worker_relationship_id = (
      select relationship.id
      from db.${sql.ref(workforce.workerRelationshipsTable)} relationship
      where relationship.person_id = import_row.person_id
        and relationship.effective_to is null
      order by
        case when relationship.effective_from <= current_date() then 0 else 1 end,
        relationship.effective_from desc,
        relationship.id desc
      limit 1
    )
    where import_row.person_id is not null
  `);
  s.modify(sql`
    update workforce_import_preview import_row
    set organization_id = (
      select relationship.workforce_organization_id
      from db.${sql.ref(workforce.workerRelationshipsTable)} relationship
      where relationship.id = import_row.worker_relationship_id
    )
    where nullif(trim(import_row.organization), '') is null
      and import_row.organization_id is null
      and import_row.worker_relationship_id is not null
  `);
  if (workforce.orgUnitsTable) {
    s.modify(sql`
      update workforce_import_preview import_row
      set org_unit_id = (
        select unit.id
        from db.${sql.ref(workforce.orgUnitsTable)} unit
        where ${referenceMatch(sql`unit`, sql`import_row.org_unit`)}
          and (
            import_row.organization_id is null
            or unit.workforce_organization_id = import_row.organization_id
          )
        order by unit.id
        limit 1
      )
      where nullif(trim(import_row.org_unit), '') is not null
    `);
  }
  if (workforce.locationsTable) {
    s.modify(sql`
      update workforce_import_preview import_row
      set location_id = (
        select location.id
        from db.${sql.ref(workforce.locationsTable)} location
        where ${referenceMatch(sql`location`, sql`import_row.location`)}
          and (
            import_row.organization_id is null
            or location.workforce_organization_id = import_row.organization_id
          )
        order by location.id
        limit 1
      )
      where nullif(trim(import_row.location), '') is not null
    `);
  }
  if (workforce.positionsTable) {
    s.modify(sql`
      update workforce_import_preview import_row
      set position_id = (
        select position.id
        from db.${sql.ref(workforce.positionsTable)} position
        where ${referenceMatch(sql`position`, sql`import_row.position`)}
          and (
            import_row.organization_id is null
            or position.workforce_organization_id is null
            or position.workforce_organization_id = import_row.organization_id
          )
        order by position.id
        limit 1
      )
      where nullif(trim(import_row.position), '') is not null
    `);
  }
  s.modify(sql`
    update workforce_import_preview import_row
    set assignment_id = (
      select assignment.id
      from db.${sql.ref(workforce.assignmentsTable)} assignment
      where assignment.worker_relationship_id = import_row.worker_relationship_id
        and assignment.is_primary
        and assignment.effective_to is null
      order by
        case when assignment.effective_from <= current_date() then 0 else 1 end,
        assignment.effective_from desc,
        assignment.id desc
      limit 1
    )
    where import_row.worker_relationship_id is not null
  `);
}

function insertValidationError(
  s: UiServerStatements,
  type: string,
  field: string,
  message: string,
) {
  s.modify(sql`
    insert into workforce_import_validation_error
      (type, field, row, message)
    values (
      ${sql.lit(type)},
      ${sql.lit(field)},
      import_row.csv_row_index,
      ${sql.lit(message)}
    )
  `);
}

function validateFieldValue(
  s: UiServerStatements,
  field: WorkforceImportField,
) {
  const value = trimmedFieldValue(field);
  if (field.maxLength) {
    s.if(
      sql`${value} is not null and char_length(${value}) > ${field.maxLength}`,
      (s) => {
        insertValidationError(
          s,
          "too_long",
          field.name,
          `Maximum length is ${field.maxLength} characters.`,
        );
      },
    );
  }
  if (field.enumName && field.enumValues) {
    s.if(
      sql`${value} is not null and ${
        enumValueExpr(field.enumName, field.enumValues, value)
      } is null`,
      (s) => {
        insertValidationError(
          s,
          "invalid_enum",
          field.name,
          `${field.label} does not match an allowed value.`,
        );
      },
    );
    return;
  }
  if (!field.field || field.field.type === "String") {
    if (field.castType === "date") {
      s.if(
        sql`${value} is not null and try_cast(${value} as date) is null`,
        (s) => {
          insertValidationError(
            s,
            "invalid_type",
            field.name,
            `${field.label} must be a valid date.`,
          );
        },
      );
    }
    return;
  }
  s.if(
    sql`${value} is not null and ${field.field.tryCastToType(value)} is null`,
    (s) => {
      insertValidationError(
        s,
        "invalid_type",
        field.name,
        `${field.label} cannot be converted to the field type.`,
      );
    },
  );
}

function validateReference(
  s: UiServerStatements,
  field: WorkforceImportField,
  workforce: WorkforceImportBlock,
  defaults: WorkforceImportDefaultValues,
) {
  const value = effectiveFieldValue(field, defaults, { workforce });
  const matchCount = referenceMatchCount(field, workforce, defaults);
  s.if(sql`${value} is not null and ${matchCount} = 0`, (s) => {
    insertValidationError(
      s,
      "invalid_reference",
      field.name,
      `${field.label} does not match an existing record by name or code.`,
    );
  });
  s.if(sql`${value} is not null and ${matchCount} > 1`, (s) => {
    insertValidationError(
      s,
      "invalid_reference",
      field.name,
      `${field.label} matches more than one record. Use a unique name or code.`,
    );
  });
}

function validateImportPreview(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
  fields: WorkforceImportField[],
  defaults: WorkforceImportDefaultValues,
) {
  s.modify(sql`delete from workforce_import_validation_error`);
  resolveReferences(s, workforce, defaults);
  const organizationField = fields.find((field) =>
    field.name === "organization"
  )!;
  const jobProfileField = fields.find((field) => field.name === "job_profile")!;
  s.forEachTable("workforce_import_preview", "import_row", (s) => {
    s.if(sql`nullif(trim(import_row.email), '') is null`, (s) => {
      insertValidationError(
        s,
        "missing_merge_field",
        "email",
        "Email is required and is used to match existing people.",
      );
    });
    s.if(
      sql`
        nullif(trim(import_row.email), '') is not null
        and exists (
          select 1
          from workforce_import_preview other_row
          where lower(trim(other_row.email)) = lower(trim(import_row.email))
            and other_row.csv_row_index < import_row.csv_row_index
        )
      `,
      (s) => {
        insertValidationError(
          s,
          "duplicate_row",
          "email",
          "Another row in the file uses the same email.",
        );
      },
    );
    s.if(
      sql`
        nullif(trim(import_row.email), '') is not null
        and (
          select count(*)
          from db.${sql.ref(workforce.peopleTable)} person
          where lower(person.email) = lower(trim(import_row.email))
        ) > 1
      `,
      (s) => {
        insertValidationError(
          s,
          "invalid_reference",
          "email",
          "More than one existing person uses this email.",
        );
      },
    );
    s.if(
      sql`import_row.is_new_person
        and nullif(trim(import_row.display_name), '') is null`,
      (s) => {
        insertValidationError(
          s,
          "missing_required_field",
          "display_name",
          "Display name is required for new people.",
        );
      },
    );
    s.if(
      sql`(import_row.is_new_person or import_row.worker_relationship_id is null)
        and ${
        effectiveFieldValue(organizationField, defaults, { workforce })
      } is null`,
      (s) => {
        insertValidationError(
          s,
          "missing_required_field",
          "organization",
          "Employer organization is required when creating a worker relationship.",
        );
      },
    );
    if (workforce.positionsTable) {
      s.if(
        sql`(import_row.is_new_person or import_row.assignment_id is null)
          and ${
          effectiveFieldValue(jobProfileField, defaults, { workforce })
        } is null
          and nullif(trim(import_row.position), '') is null`,
        (s) => {
          insertValidationError(
            s,
            "missing_required_field",
            "job_profile",
            "Job profile or position is required when creating an assignment.",
          );
        },
      );
      s.if(
        sql`
          import_row.job_profile_id is not null
          and import_row.position_id is not null
          and exists (
            select 1
            from db.${sql.ref(workforce.positionsTable)} position
            where position.id = import_row.position_id
              and position.workforce_job_profile_id is not null
              and position.workforce_job_profile_id != import_row.job_profile_id
          )
        `,
        (s) => {
          insertValidationError(
            s,
            "invalid_reference",
            "position",
            "Position does not belong to the selected job profile.",
          );
        },
      );
    } else {
      s.if(
        sql`(import_row.is_new_person or import_row.assignment_id is null)
          and ${
          effectiveFieldValue(jobProfileField, defaults, { workforce })
        } is null`,
        (s) => {
          insertValidationError(
            s,
            "missing_required_field",
            "job_profile",
            "Job profile is required when creating an assignment.",
          );
        },
      );
    }
    for (const field of fields) {
      if (
        field.target === "person" &&
        field.field?.notNull &&
        !field.field.default &&
        field.name !== "display_name" &&
        field.name !== "email"
      ) {
        s.if(
          sql`import_row.is_new_person and ${trimmedFieldValue(field)} is null`,
          (s) => {
            insertValidationError(
              s,
              "missing_required_field",
              field.name,
              `${field.label} is required for new people.`,
            );
          },
        );
      }
      validateFieldValue(s, field);
      if (field.referenceTable) {
        validateReference(s, field, workforce, defaults);
      }
    }
  });
}

function personFields(fields: WorkforceImportField[]) {
  return fields.filter((field) => field.target === "person" && field.field);
}

function buildInsertColumnsAndValues(
  fields: WorkforceImportField[],
  opts: {
    defaultLanguage: Sql;
    workforce: WorkforceImportBlock;
  },
) {
  const columns: string[] = [];
  const values: Sql[] = [];
  for (const field of personFields(fields)) {
    if (field.name === "email") {
      columns.push(field.dbFieldName ?? field.name);
      values.push(sql`lower(trim(import_row.email))`);
      continue;
    }
    let defaultExpr: AnyExpr | undefined;
    if (field.name === "preferred_language") {
      defaultExpr = opts.defaultLanguage;
    } else if (field.name === "person_status") {
      defaultExpr = sql`cast(${
        sql.lit(opts.workforce.activePersonStatus)
      } as enums.workforce_person_status)`;
    } else if (field.field?.default) {
      defaultExpr = field.field.default;
    }
    columns.push(field.dbFieldName ?? field.name);
    values.push(dbValueForField(field, { defaultExpr }));
  }
  if (opts.workforce.sysUserLink === "person_field") {
    columns.push("sys_user_id");
    values.push(sql`workforce_import_sys_user_id`);
  }
  return { columns, values };
}

function insertSysUser(s: UiServerStatements) {
  s.modify(sql`
    insert into db.sys_users (created_at)
    values (current_timestamp())
    returning id into workforce_import_sys_user_id
  `);
}

function ensureExistingSysUser(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
) {
  if (workforce.sysUserLink === "person_field") {
    return;
  }
  s.defScalar(
    "workforce_import_existing_sys_user_id",
    sql`(
      select id
      from db.sys_users
      where workforce_person_id = import_row.person_id
      limit 1
    )`,
  );
  s.if(sql`workforce_import_existing_sys_user_id is null`, (s) => {
    insertSysUser(s);
    s.modify(sql`
      update db.sys_users
      set workforce_person_id = import_row.person_id
      where id = workforce_import_sys_user_id
    `);
  });
}

function insertPerson(
  s: UiServerStatements,
  fields: WorkforceImportField[],
  workforce: WorkforceImportBlock,
  defaultLanguage: Sql,
) {
  insertSysUser(s);
  const { columns, values } = buildInsertColumnsAndValues(fields, {
    defaultLanguage,
    workforce,
  });
  s.modify(sql`
    insert into db.${sql.ref(workforce.peopleTable)}
      ${insertValueColumns(...columns)}
    values ${valuesRow(values)}
    returning id into workforce_import_person_id
  `);
  s.modify(sql`update import_row set person_id = workforce_import_person_id`);
  if (workforce.sysUserLink === "sys_user_field") {
    s.modify(sql`
      update db.sys_users
      set workforce_person_id = workforce_import_person_id
      where id = workforce_import_sys_user_id
    `);
  }
}

function updatePerson(
  s: UiServerStatements,
  fields: WorkforceImportField[],
  workforce: WorkforceImportBlock,
) {
  const assignments: UpdateAssignment[] = [];
  for (const field of personFields(fields)) {
    if (field.name === "email") {
      continue;
    }
    assignments.push(
      updateAssignment(
        field.dbFieldName ?? field.name,
        importFieldValueOrExisting(
          field,
          sql`person_target`,
          dbValueForField(field),
        ),
      ),
    );
  }
  if (assignments.length === 0) {
    return;
  }
  s.modify(sql`
    update db.${sql.ref(workforce.peopleTable)} person_target
    set ${assignments}
    where person_target.id = import_row.person_id
  `);
}

function positionJobProfileExpr(workforce: WorkforceImportBlock) {
  return workforce.positionsTable
    ? sql`(
      select position.workforce_job_profile_id
      from db.${sql.ref(workforce.positionsTable)} position
      where position.id = import_row.position_id
    )`
    : sql`null`;
}

function insertRelationship(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
) {
  s.modify(sql`
    insert into db.${sql.ref(workforce.workerRelationshipsTable)}
      (
        person_id,
        workforce_organization_id,
        worker_type,
        status,
        effective_from,
        external_worker_id
      )
    values (
      import_row.person_id,
      import_row.organization_id,
      coalesce(
        ${
    enumValueExpr(
      "workforce_worker_type",
      workforce.workerTypes,
      sql`import_row.worker_type`,
    )
  },
        cast(${
    sql.lit(workforce.workerTypes[0].name)
  } as enums.workforce_worker_type)
      ),
      coalesce(
        ${
    enumValueExpr(
      "workforce_relationship_status",
      workforce.relationshipStatuses,
      sql`import_row.relationship_status`,
    )
  },
        cast(${
    sql.lit(workforce.activeRelationshipStatus)
  } as enums.workforce_relationship_status)
      ),
      coalesce(
        try_cast(import_row.relationship_effective_from as date),
        current_date()
      ),
      nullif(trim(import_row.external_worker_id), '')
    )
    returning id into workforce_import_relationship_id
  `);
  s.modify(
    sql`update import_row set worker_relationship_id = workforce_import_relationship_id`,
  );
}

function updateRelationship(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
) {
  s.modify(sql`
    update db.${sql.ref(workforce.workerRelationshipsTable)} relationship_target
    set workforce_organization_id = case
          when nullif(trim(import_row.organization), '') is null
            then relationship_target.workforce_organization_id
          else import_row.organization_id
        end,
        worker_type = case
          when nullif(trim(import_row.worker_type), '') is null
            then relationship_target.worker_type
          else ${
    enumValueExpr(
      "workforce_worker_type",
      workforce.workerTypes,
      sql`import_row.worker_type`,
    )
  }
        end,
        status = case
          when nullif(trim(import_row.relationship_status), '') is null
            then relationship_target.status
          else ${
    enumValueExpr(
      "workforce_relationship_status",
      workforce.relationshipStatuses,
      sql`import_row.relationship_status`,
    )
  }
        end,
        effective_from = case
          when nullif(trim(import_row.relationship_effective_from), '') is null
            then relationship_target.effective_from
          else try_cast(import_row.relationship_effective_from as date)
        end,
        external_worker_id = case
          when nullif(trim(import_row.external_worker_id), '') is null
            then relationship_target.external_worker_id
          else nullif(trim(import_row.external_worker_id), '')
        end
    where relationship_target.id = import_row.worker_relationship_id
  `);
}

function insertAssignment(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
) {
  let columns = sql`
    worker_relationship_id,
    host_workforce_organization_id,
    workforce_job_profile_id,
    is_primary,
    status,
    effective_from`;
  let values = sql`
    import_row.worker_relationship_id,
    import_row.host_organization_id,
    coalesce(import_row.job_profile_id, ${positionJobProfileExpr(workforce)}),
    true,
    coalesce(
      ${
    enumValueExpr(
      "workforce_assignment_status",
      workforce.assignmentStatuses,
      sql`import_row.assignment_status`,
    )
  },
      cast(${
    sql.lit(workforce.activeAssignmentStatus)
  } as enums.workforce_assignment_status)
    ),
    coalesce(try_cast(import_row.assignment_effective_from as date), current_date())`;
  if (workforce.orgUnitsTable) {
    columns = sql`${columns}, workforce_org_unit_id`;
    values = sql`${values}, import_row.org_unit_id`;
  }
  if (workforce.locationsTable) {
    columns = sql`${columns}, workforce_location_id`;
    values = sql`${values}, import_row.location_id`;
  }
  if (workforce.positionsTable) {
    columns = sql`${columns}, workforce_position_id`;
    values = sql`${values}, import_row.position_id`;
  }
  s.modify(sql`
    insert into db.${sql.ref(workforce.assignmentsTable)}
      (${columns})
    values (${values})
  `);
}

function updateAssignmentRecord(
  s: UiServerStatements,
  workforce: WorkforceImportBlock,
) {
  let assignments = sql`
    host_workforce_organization_id = case
      when nullif(trim(import_row.host_organization), '') is null
        then assignment_target.host_workforce_organization_id
      else import_row.host_organization_id
    end,
    workforce_job_profile_id = case
      when nullif(trim(import_row.job_profile), '') is not null
        then import_row.job_profile_id
      when ${
    workforce.positionsTable
      ? sql`nullif(trim(import_row.position), '') is not null`
      : sql`false`
  }
        then ${positionJobProfileExpr(workforce)}
      else assignment_target.workforce_job_profile_id
    end,
    status = case
      when nullif(trim(import_row.assignment_status), '') is null
        then assignment_target.status
      else ${
    enumValueExpr(
      "workforce_assignment_status",
      workforce.assignmentStatuses,
      sql`import_row.assignment_status`,
    )
  }
    end,
    effective_from = case
      when nullif(trim(import_row.assignment_effective_from), '') is null
        then assignment_target.effective_from
      else try_cast(import_row.assignment_effective_from as date)
    end`;
  if (workforce.orgUnitsTable) {
    assignments = sql`${assignments},
      workforce_org_unit_id = case
        when nullif(trim(import_row.org_unit), '') is null
          then assignment_target.workforce_org_unit_id
        else import_row.org_unit_id
      end`;
  }
  if (workforce.locationsTable) {
    assignments = sql`${assignments},
      workforce_location_id = case
        when nullif(trim(import_row.location), '') is null
          then assignment_target.workforce_location_id
        else import_row.location_id
      end`;
  }
  if (workforce.positionsTable) {
    assignments = sql`${assignments},
      workforce_position_id = case
        when nullif(trim(import_row.position), '') is null
          then assignment_target.workforce_position_id
        else import_row.position_id
      end`;
  }
  s.modify(sql`
    update db.${sql.ref(workforce.assignmentsTable)} assignment_target
    set ${assignments}
    where assignment_target.id = import_row.assignment_id
  `);
}

function importRows(
  s: UiServerStatements,
  fields: WorkforceImportField[],
  props: WorkforcePeopleImportActionProps,
  defaultLanguage: Sql,
) {
  const workforce = props.workforce;
  s.setScalar(
    "workforce_import_add_count",
    sql`(
      select count(*)
      from workforce_import_preview import_row
      where import_row.is_new_person
        and not import_row.csv_ignore_import
        and not exists (
          select 1
          from workforce_import_validation_error error
          where error.row = import_row.csv_row_index
        )
    )`,
  );
  s.setScalar(
    "workforce_import_update_count",
    sql`(
      select count(*)
      from workforce_import_preview import_row
      where not import_row.is_new_person
        and not import_row.csv_ignore_import
        and not exists (
          select 1
          from workforce_import_validation_error error
          where error.row = import_row.csv_row_index
        )
    )`,
  );
  s.startTransaction();
  workforce.assertManagementSession(s);
  s.forEachTable("workforce_import_preview", "import_row", (s) => {
    s.continueIf(sql`import_row.csv_ignore_import`);
    s.continueIf(sql`exists (
      select 1
      from workforce_import_validation_error error
      where error.row = import_row.csv_row_index
    )`);
    s.if(sql`import_row.is_new_person`, (s) => {
      insertPerson(s, fields, workforce, defaultLanguage);
      insertRelationship(s, workforce);
      insertAssignment(s, workforce);
    });
    s.if(sql`not import_row.is_new_person`, (s) => {
      ensureExistingSysUser(s, workforce);
      updatePerson(s, fields, workforce);
      s.if(sql`import_row.worker_relationship_id is null`, (s) => {
        insertRelationship(s, workforce);
      });
      s.if(sql`import_row.worker_relationship_id is not null`, (s) => {
        updateRelationship(s, workforce);
      });
      s.if(sql`import_row.assignment_id is null`, (s) => {
        insertAssignment(s, workforce);
      });
      s.if(sql`import_row.assignment_id is not null`, (s) => {
        updateAssignmentRecord(s, workforce);
      });
    });
    workforce.syncPersonLoginState(s, sql`import_row.person_id`);
  });
  props.afterImport?.(s);
  s.commitTransaction();
}

function resetImportState(
  s: DomStatements | UiServerStatements,
  fields: WorkforceImportField[],
) {
  s.setScalar("workforce_import_step", sql.lit`file_select`);
  s.setScalar("workforce_import_error", sql.null);
  s.setScalar("workforce_import_waiting", false);
  s.setScalar("workforce_import_file_name", sql.lit``);
  s.setScalar("workforce_import_add_count", 0);
  s.setScalar("workforce_import_update_count", 0);
  s.modify(sql`delete from workforce_import_header`);
  s.modify(sql`delete from workforce_import_file`);
  s.modify(sql`delete from workforce_import_preview`);
  s.modify(sql`delete from workforce_import_validation_error`);
  for (const field of fields) {
    s.setScalar(fieldOrdinalScalar(field), sql.null);
  }
}

function MappingControl({ field }: { field: WorkforceImportField }) {
  return (
    <FormControl>
      <FormLabel>{field.label}</FormLabel>
      <EachSelect
        size="sm"
        value={sql.ref(fieldOrdinalScalar(field))}
        table="workforce_import_header"
        findOnValue="value"
        optionLabel="value"
        optionValue="ordinal"
        onChange={(s) => {
          s.setScalar(
            fieldOrdinalScalar(field),
            sql`try_cast(target_value as int)`,
          );
        }}
      />
    </FormControl>
  );
}

function PreviewStat(props: { label: string; value: Sql }) {
  return (
    <Card variant="outlined" sx={styles.statCard}>
      <Typography level="body-sm" className="text-neutral-600">
        {props.label}
      </Typography>
      <Typography level="h4">{props.value}</Typography>
    </Card>
  );
}

function PreviewStatusChip() {
  return (
    <Switch>
      <Match
        when={sql`exists (
        select 1
        from workforce_import_validation_error error
        where error.row = import_row.csv_row_index
      )`}
      >
        <Chip size="sm" color="danger" variant="soft">Error</Chip>
      </Match>
      <Match when={sql`import_row.csv_ignore_import`}>
        <Chip size="sm" color="neutral" variant="soft">Ignored</Chip>
      </Match>
      <Match when={sql`import_row.is_new_person`}>
        <Chip size="sm" color="success" variant="soft">New</Chip>
      </Match>
      <Match when={sql.true}>
        <Chip size="sm" color="primary" variant="soft">Update</Chip>
      </Match>
    </Switch>
  );
}

function PreviewErrors() {
  return (
    <Each
      table="workforce_import_validation_error"
      recordName="error"
      where={sql`error.row = import_row.csv_row_index`}
    >
      <div>
        <Typography level="body-xs" className="font-semibold">
          {sql`error.field || ': ' || error.type`}
        </Typography>
        <Typography level="body-xs" className="text-neutral-600">
          {sql`error.message`}
        </Typography>
      </div>
    </Each>
  );
}

function SelectFileStep(
  props: {
    fields: WorkforceImportField[];
  },
) {
  return (
    <div sx={styles.fileSelect}>
      <MaterialIcon icon="UploadFile" fontSize="4xl" />
      <div className="text-center">
        <Typography level="h4">Import workforce people</Typography>
        <Typography level="body-sm" className="text-neutral-600">
          Select a CSV with a header row. Email is used to match existing
          people.
        </Typography>
      </div>
      <Button
        component="label"
        startDecorator={<MaterialIcon icon="FileOpen" />}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          sx={visuallyHiddenStyles}
          onFileChange={(s) => {
            s.setScalar("workforce_import_error", sql.null);
            s.modify(sql`delete from workforce_import_file`);
            s.modify(
              sql`insert into workforce_import_file select uuid from file`,
            );
            s.setScalar(
              "workforce_import_file_name",
              sql`(select name from file)`,
            );
            s.commitUiTreeChanges();
            s.tryServer({
              transferFiles: sql`select uuid from workforce_import_file`,
              body: (s) => {
                s.readDomFile(sql`(select uuid from workforce_import_file)`);
                insertHeaderFromBody(s, props.fields);
                s.setScalar("workforce_import_step", sql.lit`mapping`);
              },
              errorName: "service_error",
              catch: (s) => {
                s.setScalar(
                  "workforce_import_error",
                  sql.concat(
                    "Unable to read CSV: ",
                    sql`service_error.type`,
                    " ",
                    sql`coalesce(service_error.message, '')`,
                  ),
                );
              },
            });
          }}
        />
        Select CSV file
      </Button>
    </div>
  );
}

function MappingStep(
  props: {
    fields: WorkforceImportField[];
    importProps: WorkforcePeopleImportActionProps;
  },
) {
  const requiredColumns = ["Email", "Display name"];
  if (!configuredDefault(props.importProps.defaultOrganization)) {
    requiredColumns.push("Employer organization");
  }
  if (!configuredDefault(props.importProps.defaultJobProfile)) {
    requiredColumns.push(
      props.importProps.workforce.positionsTable
        ? "Job profile or Position"
        : "Job profile",
    );
  }
  return (
    <div sx={styles.modalBody}>
      <Typography level="title-md">
        {sql.concat("Map columns from ", sql`workforce_import_file_name`)}
      </Typography>
      <Alert color="neutral" variant="soft">
        {`Map at least ${
          requiredColumns.join(", ")
        } for new people. Blank mapped cells do not overwrite existing people.`}
      </Alert>
      <div sx={styles.mappingGrid}>
        {props.fields.map((field) => <MappingControl field={field} />)}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="plain"
          color="neutral"
          onClick={(s) => resetImportState(s, props.fields)}
        >
          Cancel
        </Button>
        <Button
          loading={sql`workforce_import_waiting`}
          onClick={(s) => {
            s.returnIf(sql`workforce_import_waiting`);
            s.setScalar("workforce_import_waiting", true);
            s.setScalar("workforce_import_error", sql.null);
            s.commitUiTreeChanges();
            s.tryServer({
              transferFiles: sql`select uuid from workforce_import_file`,
              body: (s) => {
                s.readDomFile(sql`(select uuid from workforce_import_file)`);
                parseCsvIntoPreview(s, props.fields);
                validateImportPreview(
                  s,
                  props.importProps.workforce,
                  props.fields,
                  importDefaultValues(props.importProps),
                );
                s.setScalar("workforce_import_step", sql.lit`preview`);
              },
              errorName: "service_error",
              catch: (s) => {
                s.setScalar(
                  "workforce_import_error",
                  sql.concat(
                    "Unable to preview CSV: ",
                    sql`service_error.type`,
                    " ",
                    sql`coalesce(service_error.message, '')`,
                  ),
                );
              },
              finally: (s) => {
                s.setScalar("workforce_import_waiting", false);
              },
            });
          }}
        >
          Preview import
        </Button>
      </div>
    </div>
  );
}

function PreviewStep(
  props: {
    fields: WorkforceImportField[];
    importProps: WorkforcePeopleImportActionProps;
    defaultLanguage: Sql;
  },
) {
  const defaults = importDefaultValues(props.importProps);
  const organizationField = props.fields.find((field) =>
    field.name === "organization"
  )!;
  const jobProfileField = props.fields.find((field) =>
    field.name === "job_profile"
  )!;
  const organizationValue = effectiveFieldValue(
    organizationField,
    defaults,
    { workforce: props.importProps.workforce },
  );
  const jobProfileValue = effectiveFieldValue(
    jobProfileField,
    defaults,
    { workforce: props.importProps.workforce },
  );
  const jobOrPosition = props.importProps.workforce.positionsTable
    ? sql`coalesce(
      ${jobProfileValue},
      nullif(import_row.position, ''),
      ''
    )`
    : sql`coalesce(${jobProfileValue}, '')`;
  return (
    <div sx={styles.modalBody}>
      <Typography level="title-md">
        {sql.concat("Preview import from ", sql`workforce_import_file_name`)}
      </Typography>
      <div sx={styles.previewStats}>
        <PreviewStat
          label="New people"
          value={sql`format.decimal((select count(*) from workforce_import_preview where is_new_person))`}
        />
        <PreviewStat
          label="Existing people"
          value={sql`format.decimal((select count(*) from workforce_import_preview where not is_new_person))`}
        />
        <PreviewStat
          label="Rows with errors"
          value={sql`format.decimal((select count(distinct row) from workforce_import_validation_error))`}
        />
        <PreviewStat
          label="Accepted rows"
          value={sql`format.decimal((
            select count(*)
            from workforce_import_preview import_row
            where not import_row.csv_ignore_import
              and not exists (
                select 1
                from workforce_import_validation_error error
                where error.row = import_row.csv_row_index
              )
          ))`}
        />
      </div>
      <Show
        when={sql`exists (select 1 from workforce_import_validation_error)`}
      >
        <Alert
          color="warning"
          variant="soft"
          startDecorator={<MaterialIcon icon="Warning" />}
        >
          Fix the CSV or ignore rows with errors before importing.
        </Alert>
      </Show>
      <div sx={styles.previewTableWrap}>
        <TableComponent
          stickyHeader
          hoverRow
          borderAxis="bothBetween"
          size="sm"
        >
          <thead>
            <tr>
              <th>Row</th>
              <th>Status</th>
              <th>Name</th>
              <th>Email</th>
              <th>Organization</th>
              <th>Job / Position</th>
              <th>Errors</th>
              <th>Import</th>
            </tr>
          </thead>
          <tbody>
            <Each
              table="workforce_import_preview"
              recordName="import_row"
              orderBy={sql`import_row.csv_row_index`}
              where={sql`import_row.csv_row_index <= 101 or exists (
                select 1
                from workforce_import_validation_error error
                where error.row = import_row.csv_row_index
              )`}
            >
              <tr>
                <td>{sql`import_row.csv_row_index`}</td>
                <td>
                  <PreviewStatusChip />
                </td>
                <td>{sql`coalesce(import_row.display_name, '')`}</td>
                <td>{sql`coalesce(import_row.email, '')`}</td>
                <td>{sql`coalesce(${organizationValue}, '')`}</td>
                <td>{jobOrPosition}</td>
                <td>
                  <PreviewErrors />
                </td>
                <td>
                  <div sx={styles.rowActions}>
                    <Checkbox
                      checked={sql`not import_row.csv_ignore_import`}
                      onChange={(s) => {
                        s.modify(sql`
                          update workforce_import_preview
                          set csv_ignore_import = not csv_ignore_import
                          where csv_row_index = import_row.csv_row_index
                        `);
                      }}
                    />
                  </div>
                </td>
              </tr>
            </Each>
          </tbody>
        </TableComponent>
      </div>
      <Show when={sql`(select count(*) from workforce_import_preview) > 100`}>
        <Typography level="body-xs" className="text-neutral-600">
          Showing the first 100 rows plus any row with errors.
        </Typography>
      </Show>
      <div className="flex justify-end gap-2">
        <Button
          variant="soft"
          color="neutral"
          onClick={(s) => {
            s.setScalar("workforce_import_step", sql.lit`mapping`);
          }}
        >
          Back
        </Button>
        <Button
          loading={sql`workforce_import_waiting`}
          onClick={(s) => {
            s.if(
              sql`exists (
                select 1
                from workforce_import_validation_error error
                join workforce_import_preview import_row
                  on import_row.csv_row_index = error.row
                where not import_row.csv_ignore_import
              )`,
              (s) => {
                s.setScalar(
                  "workforce_import_error",
                  sql.lit`Ignore or fix rows with errors before importing.`,
                );
                s.return();
              },
            );
            s.returnIf(sql`workforce_import_waiting`);
            s.setScalar("workforce_import_waiting", true);
            s.setScalar("workforce_import_error", sql.null);
            s.commitUiTreeChanges();
            s.tryServer({
              body: (s) => {
                importRows(
                  s,
                  props.fields,
                  props.importProps,
                  props.defaultLanguage,
                );
                s.setScalar("workforce_import_step", sql.lit`import`);
                s.refetch();
              },
              errorName: "service_error",
              catch: (s) => {
                s.setScalar(
                  "workforce_import_error",
                  sql.concat(
                    "Unable to import CSV: ",
                    sql`service_error.type`,
                    " ",
                    sql`coalesce(service_error.message, '')`,
                  ),
                );
              },
              finally: (s) => {
                s.setScalar("workforce_import_waiting", false);
              },
            });
          }}
        >
          Import accepted rows
        </Button>
      </div>
    </div>
  );
}

function SuccessStep(props: { fields: WorkforceImportField[] }) {
  return (
    <div sx={styles.fileSelect}>
      <MaterialIcon icon="Done" fontSize="4xl" />
      <Typography level="h4">Import complete</Typography>
      <Typography level="body-lg">
        {sql.concat(
          "Added ",
          sql`format.decimal(workforce_import_add_count)`,
          " people",
        )}
      </Typography>
      <Typography level="body-lg">
        {sql.concat(
          "Updated ",
          sql`format.decimal(workforce_import_update_count)`,
          " people",
        )}
      </Typography>
      <Button
        variant="soft"
        color="success"
        onClick={(s) => resetImportState(s, props.fields)}
      >
        Import another CSV
      </Button>
    </div>
  );
}

export function WorkforcePeopleImportAction(
  props: WorkforcePeopleImportActionProps,
) {
  const fields = getWorkforceImportFields(props.workforce);
  const defaultLanguage = typeof props.defaultLanguage === "string"
    ? sql.lit(props.defaultLanguage)
    : props.defaultLanguage ?? sql.lit`en`;

  useState((s) => {
    s.defScalar("workforce_import_open", false);
    s.defScalar("workforce_import_step", sql.lit`file_select`);
    s.defScalar("workforce_import_file_name", sql.lit``);
    s.defScalar("workforce_import_waiting", false);
    s.defScalar("workforce_import_error", {
      type: { type: "String", maxLength: 65000 },
    });
    s.defScalar("workforce_import_add_count", 0);
    s.defScalar("workforce_import_update_count", 0);
    s.fileRefTable("workforce_import_file");
    s.defTable("workforce_import_header", {
      fields: [
        { name: "value", type: { type: "String", maxLength: 65000 } },
        { name: "ordinal", type: "Int" },
      ],
    });
    s.defTable("workforce_import_preview", {
      fields: [
        { name: "csv_row_index", type: "Int", notNull: true },
        { name: "csv_ignore_import", type: "Bool", notNull: true },
        { name: "is_new_person", type: "Bool" },
        { name: "person_id", type: "BigInt" },
        { name: "worker_relationship_id", type: "BigInt" },
        { name: "assignment_id", type: "BigInt" },
        { name: "organization_id", type: "BigInt" },
        { name: "host_organization_id", type: "BigInt" },
        { name: "job_profile_id", type: "BigInt" },
        { name: "org_unit_id", type: "BigInt" },
        { name: "location_id", type: "BigInt" },
        { name: "position_id", type: "BigInt" },
        ...fields.map((field) => ({
          name: field.name,
          type: { type: "String" as const, maxLength: 65000 },
        })),
      ],
    });
    s.defTable("workforce_import_validation_error", {
      fields: [
        { name: "type", type: { type: "String", maxLength: 100 } },
        { name: "field", type: { type: "String", maxLength: 100 } },
        { name: "row", type: "Int" },
        { name: "message", type: { type: "String", maxLength: 1000 } },
      ],
    });
    for (const field of fields) {
      s.defScalar(fieldOrdinalScalar(field), { type: "Int" });
    }
  });

  return (
    <>
      <Button
        startIcon="UploadFile"
        variant="outlined"
        onClick={(s) => {
          s.setScalar("workforce_import_error", sql.null);
          s.setScalar("workforce_import_open", true);
        }}
      >
        Import people
      </Button>
      <ModalDialog bindScalar="workforce_import_open" maxWidth="xl">
        <div sx={styles.header} className="mb-4">
          <div sx={styles.headerText}>
            <Typography level="title-lg" startIcon="UploadFile">
              Import People
            </Typography>
            <Typography level="body-sm" className="text-neutral-600 mt-1">
              Create or update workforce people, users, relationships, and
              primary assignments from a CSV.
            </Typography>
          </div>
          <IconButton
            icon="Close"
            aria-label="Close"
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar("workforce_import_open", false)}
          />
        </div>
        <Show when={sql`workforce_import_error is not null`}>
          <Alert color="danger" startIcon="Error" className="mb-4">
            {sql`workforce_import_error`}
          </Alert>
        </Show>
        <Switch>
          <Match when={sql`workforce_import_step = 'file_select'`}>
            <SelectFileStep fields={fields} />
          </Match>
          <Match when={sql`workforce_import_step = 'mapping'`}>
            <MappingStep fields={fields} importProps={props} />
          </Match>
          <Match when={sql`workforce_import_step = 'preview'`}>
            <PreviewStep
              fields={fields}
              importProps={props}
              defaultLanguage={defaultLanguage}
            />
          </Match>
          <Match when={sql`workforce_import_step = 'import'`}>
            <SuccessStep fields={fields} />
          </Match>
        </Switch>
      </ModalDialog>
    </>
  );
}
