import { Alert } from "components/alert";
import { Button } from "components/button";
import { Chip } from "components/chip";
import { Divider } from "components/divider";
import { ModalDialog } from "components/modal";
import { Table } from "components/table";
import { Typography } from "components/typography";
import { CurrentRefetchICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { system } from "std/system";
import type { Field, Table as SystemTable } from "std/system";
import { Data } from "std/data";
import { Each, Show, useICtx } from "std/ui";
import type { Node } from "std/ui";

function mergeableFields(table: SystemTable): Field[] {
  return Object.values(table.fields).filter((field) =>
    !field.unique &&
    field.name !== table.primaryKeyFieldName &&
    field.name !== "created_at" &&
    field.name !== "last_modified_at" &&
    field.type !== "Bytes" &&
    field.type !== "Json" &&
    field.type !== "Ordering" &&
    field.type !== "Tx"
  );
}

function recordLabelExpr(table: SystemTable, alias: string): Sql {
  if (table.fields.name) {
    return sql`coalesce(${sql.ref(alias, "name")}, concat('#', ${
      sql.ref(alias, table.primaryKeyFieldName)
    }))`;
  }
  if (table.fields.first_name && table.fields.last_name) {
    return sql`coalesce(nullif(trim(concat(${
      sql.ref(alias, "first_name")
    }, ' ', ${sql.ref(alias, "last_name")})), ''), concat('#', ${
      sql.ref(alias, table.primaryKeyFieldName)
    }))`;
  }
  if (table.fields.email) {
    return sql`coalesce(${sql.ref(alias, "email")}, concat('#', ${
      sql.ref(alias, table.primaryKeyFieldName)
    }))`;
  }
  return sql`concat('#', ${sql.ref(alias, table.primaryKeyFieldName)})`;
}

function fieldValueExpr(field: Field, alias: string): Sql {
  if (field.type === "ForeignKey") {
    const fkTable = system.db.tables[field.table];
    if (!fkTable) {
      return sql`coalesce(cast(${
        sql.ref(alias, field.name)
      } as string), 'Blank')`;
    }
    return sql`case
      when ${sql.ref(alias, field.name)} is null then 'Blank'
      else coalesce(
        (
          select ${recordLabelExpr(fkTable, "fk_record")}
          from db.${sql.ref(fkTable.name)} as fk_record
          where fk_record.${fkTable.primaryKeyIdent} = ${
      sql.ref(alias, field.name)
    }
        ),
        concat('#', ${sql.ref(alias, field.name)})
      )
    end`;
  }
  return sql`coalesce(cast(${sql.ref(alias, field.name)} as string), 'Blank')`;
}

function uniqueConstraintFieldName(
  field: SystemTable["uniqueConstraints"][number]["fields"][number],
): string {
  return typeof field === "string" ? field : field.field;
}

function uniqueConstraintFieldDistinctNulls(
  constraint: SystemTable["uniqueConstraints"][number],
  field: SystemTable["uniqueConstraints"][number]["fields"][number],
): boolean {
  if (typeof field !== "string" && field.distinctNulls !== undefined) {
    return field.distinctNulls;
  }
  return constraint.distinctNulls ?? true;
}

function preflightInboundForeignKeyUpdate(
  s: UiServerStatements,
  sourceTable: SystemTable,
  field: Field,
  primaryId: NumericExpr,
) {
  for (const constraint of sourceTable.uniqueConstraints) {
    const constraintFields = constraint.fields.map(uniqueConstraintFieldName);
    if (!constraintFields.includes(field.name)) {
      continue;
    }
    const affectedLoserRows = sql`exists (
      select 1
      from db.${sql.ref(sourceTable.name)} as candidate
      where candidate.${sql.ref(field.name)} in (
        select id from ui.selected_row where id != ${primaryId}
      )
    )`;
    const notNullPredicates = constraint.fields
      .filter((constraintField) =>
        uniqueConstraintFieldDistinctNulls(
          constraint,
          constraintField,
        )
      )
      .map((constraintField) =>
        sql`${
          sql.ref(
            "candidate",
            uniqueConstraintFieldName(constraintField),
          )
        } is not null`
      );
    const notNullFilter = notNullPredicates.length
      ? sql`and ${sql.and(notNullPredicates)}`
      : sql``;
    const duplicateRows = sql`exists (
      select 1
      from db.${sql.ref(sourceTable.name)} as candidate
      where (
        candidate.${sql.ref(field.name)} = ${primaryId}
        or candidate.${sql.ref(field.name)} in (
          select id from ui.selected_row where id != ${primaryId}
        )
      )
      ${notNullFilter}
      group by ${
      constraintFields.map((constraintField) =>
        constraintField === field.name
          ? sql`${primaryId}`
          : sql.ref("candidate", constraintField)
      )
    }
      having count(*) > 1
    )`;
    s.throwErrorIf(
      constraint.where ? affectedLoserRows : duplicateRows,
      sql.lit(
        constraint.where
          ? `Cannot merge records because ${sourceTable.displayName} has a partial unique constraint involving ${field.displayName}.`
          : `Cannot merge records because it would create duplicate rows in ${sourceTable.displayName} (${
            constraintFields.join(", ")
          }). Merge or remove those related records first.`,
      ),
    );
  }
}

function updateInboundForeignKeys(
  s: UiServerStatements,
  table: SystemTable,
  primaryId: NumericExpr,
) {
  for (const sourceTable of Object.values(system.db.tables)) {
    for (const field of Object.values(sourceTable.fields)) {
      if (field.type !== "ForeignKey" || field.table !== table.name) {
        continue;
      }
      preflightInboundForeignKeyUpdate(s, sourceTable, field, primaryId);
      s.modify(
        sql`update db.${sql.ref(sourceTable.name)}
          set ${sql.ref(field.name)} = ${primaryId}
          where ${sql.ref(field.name)} in (
            select id from ui.selected_row where id != ${primaryId}
          )`,
      );
    }
  }
}

function mergeSelectedRecords(
  s: DomStatements,
  table: SystemTable,
  openScalar: string,
) {
  s.returnIf(sql`selected_all`);
  s.returnUnless(sql`(select count(*) from selected_row) >= 2`);
  s.setScalar("merge_error", sql.null);
  s.setScalar("merge_waiting", true);
  s.commitUiTreeChanges();
  s.tryServer({
    body: (s) => {
      s.startTransaction();
      for (const field of mergeableFields(table)) {
        s.modify(
          sql`update db.${sql.ref(table.name)}
            set ${sql.ref(field.name)} = (
              select source.${sql.ref(field.name)}
              from db.${sql.ref(table.name)} as source
              where source.${table.primaryKeyIdent} = (
                select source_id
                from ui.merge_field_choice
                where field_name = ${sql.lit(field.name)}
              )
            )
            where ${table.primaryKeyIdent} = ui.merge_primary_id`,
        );
      }
      if (table.fields.last_modified_at) {
        s.modify(
          sql`update db.${sql.ref(table.name)}
            set last_modified_at = now()
            where ${table.primaryKeyIdent} = ui.merge_primary_id`,
        );
      }
      updateInboundForeignKeys(s, table, sql`ui.merge_primary_id`);
      s.modify(
        sql`delete from db.${sql.ref(table.name)}
          where ${table.primaryKeyIdent} in (
            select id from ui.selected_row where id != ui.merge_primary_id
          )`,
      );
      s.commitTransaction();
      const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
      triggerRefetch(s);
    },
    errorName: "caught_error",
    catch: (s) => {
      s.setScalar(
        "merge_error",
        sql.concat(
          "Error merging records: ",
          sql`coalesce(caught_error.message, caught_error.description, caught_error.type)`,
        ),
      );
    },
    finally: (s) => {
      s.setScalar("merge_waiting", false);
    },
  });
  s.if(sql`merge_error is null`, (s) => {
    s.modify(sql`delete from selected_row`);
    s.setScalar(openScalar, false);
  });
}

function MergePrimaryPicker() {
  return (
    <div className="flex flex-wrap gap-2">
      <Each table="merge_records" recordName="merge_record">
        <Button
          size="sm"
          variant="outlined"
          color="neutral"
          aria-pressed={sql`merge_primary_id = merge_record.id`}
          onClick={(s) => {
            s.setScalar("merge_primary_id", sql`merge_record.id`);
            s.modify(
              sql`update merge_field_choice
                set source_id = merge_record.id
                where not manually_selected`,
            );
          }}
          sx={{
            "&[aria-pressed='true']": {
              backgroundColor: "var(--palette-primary-soft-bg)",
              color: "var(--palette-primary-soft-color)",
              borderColor: "var(--palette-primary-outlined-border)",
            },
          }}
        >
          {sql`merge_record.display_name`}
        </Button>
      </Each>
    </div>
  );
}

function MergePreviewTable(props: { table: SystemTable; fields: Field[] }) {
  return (
    <div
      className="overflow-auto border border-divider rounded-md"
      sx={{
        maxHeight: "min(62vh, 620px)",
      }}
    >
      <Table
        size="sm"
        borderAxis="bothBetween"
        stickyHeader
        sx={{
          width: "max-content",
          minWidth: "100%",
          tableLayout: "fixed",
          "& th, & td": {
            verticalAlign: "middle",
          },
        }}
      >
        <thead>
          <tr>
            <th style={{ width: "180px" }}>Field</th>
            <Each table="merge_records" recordName="merge_record_header">
              <th style={{ width: "160px" }}>
                {sql`merge_record_header.display_name`}
              </th>
            </Each>
            <th style={{ width: "240px" }}>Merged value</th>
          </tr>
        </thead>
        <tbody>
          {props.fields.map((field) => (
            <Show
              when={sql`exists (
                select 1
                from merge_records
                where ${sql.ref(`${field.name}_display`)} != 'Blank'
              )`}
            >
              <tr>
                <th scope="row">{field.displayName}</th>
                <Each table="merge_records" recordName="merge_record">
                  <td>
                    <Button
                      size="sm"
                      variant="plain"
                      color="neutral"
                      aria-pressed={sql`(select source_id from merge_field_choice where field_name = ${
                        sql.lit(field.name)
                      }) = merge_record.id`}
                      onClick={(s) => {
                        s.modify(
                          sql`update merge_field_choice
                            set source_id = merge_record.id,
                              manually_selected = true
                            where field_name = ${sql.lit(field.name)}`,
                        );
                      }}
                      sx={{
                        justifyContent: "flex-start",
                        minWidth: 0,
                        maxWidth: "100%",
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        lineHeight: 1.2,
                        "&[aria-pressed='true']": {
                          backgroundColor: "var(--palette-primary-soft-bg)",
                          color: "var(--palette-primary-soft-color)",
                        },
                      }}
                    >
                      {sql.ref("merge_record", `${field.name}_display`)}
                    </Button>
                  </td>
                </Each>
                <td>
                  <Data
                    local
                    watch={[
                      sql`(select source_id from merge_field_choice where field_name = ${
                        sql.lit(field.name)
                      })`,
                    ]}
                    procedure={(s) => {
                      s.defScalar(
                        "selected_value",
                        sql`(
                          select ${fieldValueExpr(field, "selected_source")}
                          from db.${
                          sql.ref(props.table.name)
                        } as selected_source
                          where selected_source.${props.table.primaryKeyIdent} = (
                            select source_id
                            from merge_field_choice
                            where field_name = ${sql.lit(field.name)}
                          )
                        )`,
                      );
                    }}
                  >
                    <Chip size="sm" variant="soft" color="primary">
                      {sql`selected_value`}
                    </Chip>
                  </Data>
                </td>
              </tr>
            </Show>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function RecordMergeDialog(props: {
  table: string;
  openScalar: string;
}) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const fields = mergeableFields(table);
  const selectedColumns = fields.map((field) =>
    sql`${fieldValueExpr(field, "record")} as ${
      sql.ref(`${field.name}_display`)
    }`
  );
  return (
    <ModalDialog
      open={sql.ref(props.openScalar)}
      onClose={(s) => s.setScalar(props.openScalar, false)}
      layout="center"
      maxWidth="xl"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        width: "min(1040px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 64px)",
        overflow: "auto",
      }}
    >
      <Data
        local
        procedure={(s) => {
          s.defScalar(
            "merge_primary_id",
            sql`(select min(id) from selected_row)`,
          );
          s.defScalar("merge_waiting", false);
          s.defScalar("merge_error", {
            type: { type: "String", maxLength: 2000 },
            expr: sql.null,
          });
          s.defTable("merge_field_choice", {
            fields: [
              { name: "field_name", type: { type: "String", maxLength: 255 } },
              { name: "source_id", type: "BigUint" },
              { name: "manually_selected", type: "Bool" },
            ],
          });
          for (const field of fields) {
            s.modify(
              sql`insert into merge_field_choice (field_name, source_id, manually_selected)
                values (${sql.lit(field.name)}, ui.merge_primary_id, false)`,
            );
          }
          s.defTable(
            "merge_records",
            sql`select record.${table.primaryKeyIdent} as id,
              ${recordLabelExpr(table, "record")} as display_name
              ${
              selectedColumns.length
                ? sql`, ${
                  sql(selectedColumns.map((c) => c.toSQL()).join(", "))
                }`
                : sql``
            }
            from db.${sql.ref(table.name)} as record
            where record.${table.primaryKeyIdent} in (select id from selected_row)
            order by record.${table.primaryKeyIdent}`,
          );
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Typography level="h4">
              Merge {table.displayName}
            </Typography>
            <Typography level="body-sm" className="text-secondary">
              Choose the surviving record and the field values to keep.
            </Typography>
          </div>
          <Chip variant="soft">
            {sql`(select count(*) from selected_row)`} selected
          </Chip>
        </div>

        <Show when={sql`selected_all`}>
          <Alert color="warning">
            Merge requires explicit row selection. Clear "select all" and choose
            the records to merge.
          </Alert>
        </Show>
        <Show
          when={sql`not selected_all and (select count(*) from selected_row) < 2`}
        >
          <Alert color="warning">
            Select at least two records before merging.
          </Alert>
        </Show>
        <Show when={sql`merge_error is not null`}>
          <Alert color="danger">{sql`merge_error`}</Alert>
        </Show>

        <Show
          when={sql`not selected_all and (select count(*) from selected_row) >= 2`}
        >
          <div className="flex flex-col gap-2">
            <Typography level="title-sm">Primary record</Typography>
            <MergePrimaryPicker />
          </div>
          <Divider />
          <MergePreviewTable table={table} fields={fields} />
        </Show>

        <div className="flex justify-end gap-2">
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.setScalar(props.openScalar, false)}
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            color="primary"
            startIcon="CallMerge"
            loading={sql`merge_waiting`}
            disabled={sql`selected_all or (select count(*) from selected_row) < 2`}
            onClick={(s) => mergeSelectedRecords(s, table, props.openScalar)}
          >
            Merge records
          </Button>
        </div>
      </Data>
    </ModalDialog>
  );
}

export function datagridRecordMergeBulkAction(table: string): {
  startIcon: "CallMerge";
  label: string;
  dialog: (props: { openScalar: string }) => Node;
} {
  return {
    startIcon: "CallMerge",
    label: "Merge",
    dialog: ({ openScalar }) => (
      <RecordMergeDialog table={table} openScalar={openScalar} />
    ),
  };
}
