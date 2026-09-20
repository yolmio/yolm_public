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
import { CurrentRefetchICtxKey } from "std/ictx";
import { singularize } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import { Data } from "std/data";
import { system, TableBlock } from "std/system";
import type { Table, TableBuilder } from "std/system";
import { Each, Show, useICtx } from "std/ui";
import { Form } from "std/form";

/** Options for {@link SynonymsTableBlock}. */
interface SynonymsTableBlockOpts {
  /** Hook to add extra fields/constraints to the generated synonyms table during initialization. */
  populate?: (table: TableBuilder) => void;
}

/**
 Add a related synonyms table to the given main table.

 The synonyms table is named `${singularize(mainTable)}_synonyms`, with a
 foreign key to the main table and a `synonym` string field (unique per
 parent record). It hooks the main table's search config so a search matching
 a synonym also returns the associated main-table records.

 Adds a "Synonyms" datagrid column with an inline edit dialog (see
 {@link populateDatagrid}).

 @category Block
 */
export class SynonymsTableBlock extends TableBlock<SynonymsTableBlockOpts> {
  #tableName?: string;
  #table?: Table;

  constructor(tableName: string, opts: SynonymsTableBlockOpts = {}) {
    super(tableName, opts);
  }

  initialize(mainTable: TableBuilder) {
    this.#tableName = `${singularize(mainTable.name)}_synonyms`;
    system.db.table(this.#tableName, (table) => {
      table.fk(mainTable.name).notNull();
      table.string("synonym", 2000).notNull();
      this.opts.populate?.(table);
      table.unique(["synonym", `${singularize(mainTable.name)}_id`]);
    });
  }

  /** The generated `*_synonyms` table. */
  get table() {
    if (!this.#table) {
      this.#table = system.db.tables[this.#tableName!];
    }
    return this.#table!;
  }

  /** The foreign-key field on the synonyms table pointing back to the main table. */
  get fkField() {
    return Object.values(this.table.fields).find(
      (f) => f.type === "ForeignKey" && f.table === this.parentTableName,
    )!;
  }

  /**
   * Add a "Synonyms" column to the main table's datagrid showing the synonym
   * count, with an "Edit" button opening a dialog to list, add, and delete
   * synonyms for the row.
   */
  override populateDatagrid(builder: DatagridBuilder) {
    const table = this.table;
    const foreignKeyField = this.fkField;
    function DialogContent() {
      const cellHelper = useCellHelper();
      return (
        <>
          <div className="flex items-center gap-2 pb-4 sticky">
            <Typography level="h4">Synonyms</Typography>
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
                "synonyms",
                sql`select id, synonym from ${table.identWithDb} where ${foreignKeyField.ident} = ${cellHelper.recordId}`,
              );
              s.defScalar("total_count", sql`(select count(*) from synonyms)`);
            }}
          >
            <StateStatusSwitch
              errorMessage="Unable to load synonyms"
              fallback={<CircularProgress size="sm" />}
            >
              <Show
                when={sql`total_count > 0`}
                fallback={
                  <div className="p-6 bg-level1 my-4 mx-3 rounded-lg">
                    <Typography>No synonyms</Typography>
                  </div>
                }
              >
                <List>
                  <Each table="synonyms" recordName="synonym_record">
                    <ListItem
                      endAction={
                        <DeleteRecordIconButton
                          table={table.name}
                          recordId={sql`synonym_record.id`}
                          size="sm"
                          variant="plain"
                          color="neutral"
                        />
                      }
                    >
                      {sql`synonym_record.synonym`}
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
              <div className="flex gap-2 items-end px-3">
                <Form.Field field="synonym">
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
      storageName: `${table}_synonyms`,
      displayName: "Synonyms",
      expr: sql`(select count(*) from ${table.identWithDb} where ${
        foreignKeyField!.ident
      } = record.id)`,
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
              aria-label="Edit synonyms"
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

  /**
   * Extend the main table's search config to also search the synonyms table
   * (via the foreign-key relation). Throws if the main table has no search
   * config configured.
   */
  override finalizeBuilder(table: Table) {
    const prevGetSearchConfig = table.getSearchConfig.bind(table);
    table.getSearchConfig = () => {
      const searchConfig = prevGetSearchConfig();
      if (!searchConfig) {
        throw new Error(
          `SynonymsTableBlock requires a search config on table ${table.name}`,
        );
      }
      const relatedTables = searchConfig.relatedTables || [];
      relatedTables.push({
        relationField: `${this.table.name}.${this.fkField.name}`,
        table: this.table.name,
        fields: [{ field: "synonym", priority: 3 }],
      });
      return {
        ...searchConfig,
        relatedTables,
      };
    };
  }
}
