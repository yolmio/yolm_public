import { Button } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { DeleteRecordIconButton } from "components/delete_record_dialog";
import { Divider } from "components/divider";
import { IconButton } from "components/icon_button";
import { LabelOnTopFormField } from "components/label_on_top_form_field";
import { List, ListItem } from "components/list";
import { ModalDialog } from "components/modal";
import { StateStatusSwitch } from "components/state_status_switch";
import { Typography } from "components/typography";
import { FormattedCellValue } from "pages/datagrid";
import type { DatagridBuilder } from "pages/datagrid";
import { useCellHelper } from "pages/datagrid_internals/shared";
import { CurrentRefetchICtxKey, UserLanguageICtxKey } from "std/ictx";
import { singularize } from "std/inflectors";
import { sql } from "std/sql_utils";
import { Data } from "std/data";
import { system, TableBlock } from "std/system";
import type { Table, TableBuilder } from "std/system";
import { Each, Show, useICtx, useOptionalICtx } from "std/ui";
import { Form } from "std/form";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { EnumFieldFormControl } from "components/field_form_control";

/** Options for {@link TranslationsTableBlock}. */
export interface TranslationsTableBlockOpts {
  /** Hook to add extra fields to the generated translations table during setup. */
  populate?: (table: TableBuilder) => void;
  /** Name of the string field that holds the translated value on the translations table. */
  displayField: string;
  /**
   * Language that already lives on the main record's own field, so it is
   * excluded from the translation-variant picker (no translation row is
   * created for it).
   */
  defaultLanguage?: string;
}

/**
 Add a related translations table to the given main table.

 This will automatically provide translated values for the display field when UserLanguageICtx is available.
 */
export class TranslationsTableBlock
  extends TableBlock<TranslationsTableBlockOpts> {
  #tableName?: string;
  #table?: Table;

  constructor(tableName: string, opts: TranslationsTableBlockOpts) {
    super(tableName, opts);
  }

  initialize(mainTable: TableBuilder) {
    this.#tableName = `${singularize(mainTable.name)}_translations`;
    system.db.table(this.#tableName, (table) => {
      table.fk(mainTable.name).notNull();
      table.enum("language").notNull();
      table.string(this.opts.displayField, 2000).notNull();
      this.opts.populate?.(table);
      table.unique(["language", `${singularize(mainTable.name)}_id`]);
    });
    mainTable.recordDisplayName(
      ["id", this.opts.displayField],
      (id, displayField) => {
        const userLanguage = useOptionalICtx(UserLanguageICtxKey);
        if (userLanguage?.currentLanguage) {
          return sql`coalesce(
          (select ${sql.ref(this.opts.displayField)}
          from db.${sql.ref(this.#tableName!)}
          where language = ${userLanguage.currentLanguage}
          and ${sql.ref(singularize(mainTable.name) + "_id")} = ${id}
          limit 1),
          ${displayField}
        )`;
        }
        return displayField;
      },
    );
  }

  /** The generated translations table model (`${singularize(mainTable)}_translations`), resolved lazily. */
  get table() {
    if (!this.#table) {
      this.#table = system.db.tables[this.#tableName!];
    }
    return this.#table!;
  }

  /** The foreign-key field on the translations table pointing back to the parent table. */
  get fkField() {
    return Object.values(this.table.fields).find(
      (f) => f.type === "ForeignKey" && f.table === this.parentTableName,
    )!;
  }

  override populateDatagrid(builder: DatagridBuilder) {
    const table = this.table;
    const foreignKeyField = this.fkField;
    const displayField = this.opts.displayField;
    const defaultLanguage = this.opts.defaultLanguage;

    function DialogContent() {
      const cellHelper = useCellHelper();
      return (
        <>
          <div className="flex items-center gap-2 pb-4 sticky">
            <Typography level="h4">Translations</Typography>
            <div className="grow" />
            <IconButton
              aria-label="Close"
              icon="CloseRounded"
              variant="plain"
              color="neutral"
              onClick={(s) => {
                s.setScalar("show_association_dialog", false);
              }}
            />
          </div>
          <Divider />
          <Data
            statusScalar="status"
            hasDataScalar="has_data"
            procedure={(s) => {
              s.defTable(
                "translations",
                sql`select id, language, ${
                  sql.ref(displayField)
                } from ${table.identWithDb} where ${foreignKeyField.ident} = ${cellHelper.recordId}`,
              );
              s.defScalar(
                "total_count",
                sql`(select count(*) from translations)`,
              );
            }}
          >
            <StateStatusSwitch
              errorMessage="Unable to load translations"
              fallback={<CircularProgress size="sm" />}
            >
              <Show
                when={sql`total_count > 0`}
                fallback={
                  <div className="p-6 bg-level1 my-4 mx-3 rounded-lg">
                    <Typography>No translations</Typography>
                  </div>
                }
              >
                <List>
                  <Each table="translations" recordName="translation_record">
                    <ListItem
                      endAction={
                        <DeleteRecordIconButton
                          table={table.name}
                          recordId={sql`translation_record.id`}
                          size="sm"
                          variant="plain"
                          color="neutral"
                        />
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-secondary">
                          {sql`fn.display_language(translation_record.language)`}
                        </span>
                        - {sql`translation_record.${sql.ref(displayField)}`}
                      </div>
                    </ListItem>
                  </Each>
                </List>
              </Show>
            </StateStatusSwitch>
          </Data>
          <Form
            afterTransactionCommit={(s, ctx) => {
              useICtx(CurrentRefetchICtxKey).triggerRefetch(s);
              ctx.reset(s);
            }}
          >
            <Form.Insert
              table={table.name}
              values={{
                [foreignKeyField.name]: cellHelper.recordId,
              }}
            >
              <div className="flex gap-2 items-end justify-end px-3 w-full">
                <Form.Field field="language">
                  <FormControl>
                    <FormLabel>
                      Language
                    </FormLabel>
                    <EnumFieldFormControl
                      enumName="language"
                      filterVariants={(name) => name !== defaultLanguage}
                    />
                  </FormControl>
                </Form.Field>
                <Form.Field field={displayField}>
                  <LabelOnTopFormField fullWidth className="grow" />
                </Form.Field>
                <Form.SubmitButton>Add</Form.SubmitButton>
              </div>
              <Form.ErrorAlert />
            </Form.Insert>
          </Form>
        </>
      );
    }

    builder.virtualColumn({
      storageName: `${table.name}_translations`,
      displayName: "Translations",
      expr:
        sql`(select count(*) from ${table.identWithDb} where ${foreignKeyField.ident} = record.id)`,
      initiallyDisplaying: true,
      initialWidth: 150,
      cell: (
        <Data
          local
          procedure={(s) => {
            s.defScalar("show_association_dialog", false);
          }}
        >
          <div className="flex items-center gap-2 justify-between w-full">
            <FormattedCellValue
              format={(v) => sql`format.decimal(${v}::bigint)`}
            />
            <Button
              aria-label="Edit translations"
              size="sm"
              variant="plain"
              startIcon="Edit"
              onClick={(s) => {
                s.setScalar("show_association_dialog", true);
              }}
            >
              Edit
            </Button>
            <ModalDialog
              bindScalar="show_association_dialog"
              maxWidth="xs"
              onKeyDown={(s) => {
                // datagrid gets funky with this
                s.event.stopPropagation();
              }}
            >
              <DialogContent />
            </ModalDialog>
          </div>
        </Data>
      ),
      filter: { type: "number", notNull: true },
      sort: { type: "numeric" },
    });
  }

  override finalizeBuilder(table: Table) {
    const prevGetSearchConfig = table.getSearchConfig.bind(table);
    table.getSearchConfig = () => {
      const searchConfig = prevGetSearchConfig();
      if (!searchConfig) {
        throw new Error(
          `TranslationsTableBlock requires a search config on table ${table.name}`,
        );
      }
      const userLanguage = useOptionalICtx(UserLanguageICtxKey)
        ?.currentLanguage;
      if (!userLanguage) {
        return searchConfig;
      }
      const relatedTables = searchConfig.relatedTables || [];
      relatedTables.push({
        relationField: `${this.table.name}.${this.fkField.name}`,
        table: this.table.name,
        fields: [{ field: this.opts.displayField, priority: 1 }],
        filterExpr: sql`language = ${userLanguage}`,
      });
      return {
        ...searchConfig,
        relatedTables,
      };
    };
  }
}
