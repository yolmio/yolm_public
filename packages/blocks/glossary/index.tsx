import { Alert } from "components/alert";
import { AutoInsertIconButton } from "components/auto_insert_dialog";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { ChipButton } from "components/chip_button";
import { DeleteRecordButton } from "components/delete_record_dialog";
import { FieldFormControl } from "components/field_form_control";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { DataTablePage } from "pages/data_table_page";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import { createStyles, cssVar } from "std/style_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import { Each, Route, Show, usePhase } from "std/ui";
import { Form, useCurrentTableHelper } from "std/form";

const styles = createStyles({
  contentWrapper: {
    minWidth: "100%",
    maxWidth: "100%",
    p: 4,
    md: {
      maxWidth: "90%",
      minWidth: "90%",
      p: 12,
    },
    lg: {
      maxWidth: "80%",
      minWidth: "80%",
      p: 16,
    },
    mx: "auto",
  },
});

function CategoryChipButtons() {
  if (usePhase() === "gather") {
    return null;
  }
  const helper = useCurrentTableHelper();
  const exists =
    sql`exists (select 1 from ${helper.tableIdent} where glossary_category_id = category_record.id)`;
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "category",
          sql`select id, name from glossary_categories order by name`,
        );
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Each table="category" recordName="category_record">
          <ChipButton
            checked={exists}
            label={sql`category_record.name`}
            color="primary"
            variant="outlined"
            size="sm"
            checkedVariation={{ color: "primary", variant: "soft" }}
            onClick={(s) => {
              s.conditional({
                condition: exists,
                then: (s) => {
                  s.modify(
                    sql`delete from write_glossary_category_words where glossary_category_id = category_record.id`,
                  );
                },
                else: (s) => {
                  helper.addRecord(s, {
                    glossary_category_id: sql`category_record.id`,
                  });
                },
              });
            }}
          />
        </Each>
      </div>
    </Data>
  );
}

function WordForm({ isEdit }: { isEdit: boolean }) {
  return (
    <div className="p-3 max-w-600 mx-auto gap-2 flex flex-col">
      <Typography level="h3">
        {isEdit ? "Edit Word" : "Add New Word"}
      </Typography>
      <Form.Field field="name">
        <FieldFormControl aria-label="Word" />
      </Form.Field>
      <Typography level="h4">Categories</Typography>
      <Form.Relation
        table="glossary_category_words"
        fields={["glossary_category_id"]}
        dontInitialize={!isEdit}
      >
        <CategoryChipButtons />
      </Form.Relation>
      <Typography level="h4">Definitions</Typography>
      <Form.Relation table="glossary_definitions" dontInitialize={!isEdit}>
        <Form.Each>
          <Card
            variant="outlined"
            className="mb-6 p-4 pt-12 flex flex-col gap-2 relative"
          >
            <Form.DeleteRecordIconButton
              icon="Close"
              aria-label="Delete Definition"
              variant="plain"
              color="neutral"
              size="sm"
              className="absolute top-2 right-2 z-10"
            />
            <Form.Field field="description">
              <FieldFormControl />
            </Form.Field>
            <Typography level="title-md" className="mt-2">
              Examples:
            </Typography>
            <Form.Relation table="glossary_examples">
              <Form.Each>
                <Form.Field field="text">
                  <FieldFormControl fullWidth />
                </Form.Field>
                <Form.DeleteRecordIconButton
                  icon="DeleteOutline"
                  aria-label="Delete Example"
                  variant="plain"
                  color="neutral"
                  size="sm"
                  className="ml-2"
                />
              </Form.Each>
              <Form.AddCurrentTableButton
                fields={{ text: sql.lit`` }}
                startIcon="Add"
                variant="outlined"
                color="primary"
                size="sm"
                className="mt-2"
              >
                Add Example
              </Form.AddCurrentTableButton>
            </Form.Relation>
          </Card>
        </Form.Each>
        <Form.AddCurrentTableButton
          fields={{ description: sql.lit`` }}
          startIcon="Add"
          variant="outlined"
          color="primary"
          size="sm"
          className="mt-2"
        >
          Add Definition
        </Form.AddCurrentTableButton>
      </Form.Relation>
      <Form.ErrorAlert />
      <div className="flex justify-end gap-4 mt-8">
        <Button
          variant="outlined"
          color="neutral"
          onClick={(s) => {
            s.setScalar(
              isEdit ? "edit_dialog_open" : "add_word_dialog_open",
              false,
            );
          }}
        >
          Cancel
        </Button>
        <Form.SubmitButton>
          {isEdit ? "Save Changes" : "Add Word"}
        </Form.SubmitButton>
      </div>
    </div>
  );
}

function AddWordDialog() {
  return (
    ////Example_ModalDialog_Start
    <ModalDialog
      open={sql`add_word_dialog_open`}
      onClose={(s) => {
        s.setScalar("add_word_dialog_open", false);
        s.increment("refresh_key");
      }}
    >
      <Form
        afterTransactionCommit={(s) => {
          s.setScalar("add_word_dialog_open", false);
          s.increment("refresh_key");
        }}
      >
        <Form.Insert table="glossary_words">
          <WordForm isEdit={false} />
        </Form.Insert>
      </Form>
    </ModalDialog>
    ////Example_ModalDialog_End
  );
}

function EditWordDialog() {
  return (
    <ModalDialog
      open={sql`edit_dialog_open`}
      onClose={(s) => {
        s.setScalar("edit_dialog_open", false);
        s.increment("refresh_key");
      }}
    >
      <Form
        afterTransactionCommit={(s) => {
          s.setScalar("edit_dialog_open", false);
          s.increment("refresh_key");
        }}
      >
        <Form.Update table="glossary_words" where={sql`word.id = id`}>
          <WordForm isEdit />
        </Form.Update>
      </Form>
    </ModalDialog>
  );
}

function WordIteration() {
  return (
    <Data
      local
      watch={[sql`refresh_key`]}
      procedure={(s) => {
        s.defScalar("edit_dialog_open", false);
      }}
    >
      <Card
        variant="outlined"
        className="w-full min-w-[1100px] flex flex-col justify-start items-stretch relative"
      >
        <Data
          procedure={(s) => {
            s.defRecord(
              "word_record",
              sql`select * from db.glossary_words where id = word.id`,
            );
            s.defTable(
              "word_definitions",
              sql`select * from db.glossary_definitions where glossary_word_id = word.id`,
            );
            s.defTable(
              "word_examples",
              sql`select * from db.glossary_examples where glossary_definition_id in (select id from word_definitions)`,
            );
            s.defTable(
              "word_categories",
              sql`select c.* from db.glossary_categories c join db.glossary_category_words cw on c.id = cw.glossary_category_id where cw.glossary_word_id = word.id`,
            );
          }}
          pendingFallback={null}
          errorFallback={null}
        >
          <div className="flex justify-between items-center mb-4">
            <Typography level="h3">
              {sql`word_record.name`}
            </Typography>
            <Menu>
              <Menu.IconButton icon="MoreVert" aria-label="Word options" />
              <Menu.Content>
                <Menu.Item
                  onClick={(s) => {
                    s.setScalar("edit_dialog_open", true);
                  }}
                >
                  <MaterialIcon icon="EditOutlined" />
                  Edit
                </Menu.Item>
                <div className="flex items-center">
                  <DeleteRecordButton
                    table="glossary_words"
                    startIcon="DeleteOutline"
                    aria-label="Delete Word"
                    recordId={sql`word.id`}
                    variant="plain"
                    color="neutral"
                    size="sm"
                    afterTransactionCommit={(s) => {
                      s.increment("refresh_key");
                    }}
                  >
                    <Typography level="body-md">Delete</Typography>
                  </DeleteRecordButton>
                </div>
              </Menu.Content>
            </Menu>
          </div>
          <Each table="word_definitions" recordName="definition">
            {sql`definition.description`}
            <Each
              table="word_examples"
              recordName="example"
              where={sql`example.glossary_definition_id = definition.id`}
            >
              <Typography
                level="body-sm"
                sx={{ color: "neutral", fontStyle: "italic", sql: 2, ml: 4 }}
              >
                Example: {sql`example.text`}
              </Typography>
            </Each>
          </Each>

          <div className="flex flex-wrap gap-2 m-4">
            <div className="flex flex-row gap-2">
              <Each table="word_categories" recordName="category">
                <Chip size="sm" variant="soft" color="neutral">
                  {sql`category.name`}
                </Chip>
              </Each>
            </div>
          </div>
        </Data>
        <EditWordDialog />
      </Card>
    </Data>
  );
}

/**
 Renders the Glossary page component.

 This component returns a page that displays a searchable and filterable list of glossary words.
 It includes functionality for searching words, filtering by categories,
 and adding new words.

 @category Page Component
 */
export function GlossaryPage(props: { path?: string }) {
  return (
    <>
      <Route path={props.path ?? "/glossary"}>
        <GlossaryPageInner />
      </Route>
      {/*Example_DataTablePage_Start*/}
      <DataTablePage
        table="glossary_categories"
        path="/glossary-categories"
        deletable
        sortable
        editable
        size="lg"
        toolbar={<AutoInsertIconButton size="sm" variant="soft" />}
      />
      {/*Example_DataTablePage_End*/}
    </>
  );
}

function GlossaryPageInner() {
  const tableModel = system.db.tables.glossary_words;
  const searchConfig = tableModel.getSearchConfig();
  if (!searchConfig) {
    throw new Error("Table glossary_words does not have searchConfig");
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_word_dialog_open", false);
        s.defScalar("refresh_key", 0);
      }}
    >
      <Data
        local
        statusScalar="status"
        procedure={(s) => {
          s.defTable(
            "selected_categories",
            sql`select id, name, false as selected from glossary_categories`,
          );
        }}
      >
        <Data
          local
          statusScalar="words_status"
          procedure={(s) => {
            s.defScalar("search_query", sql.lit``);
          }}
        >
          <div sx={styles.contentWrapper}>
            <div className="flex flex-col gap-8 mb-8">
              <Show when={sql`status = 'failed' or words_status = 'failed'`}>
                <Alert
                  color="danger"
                  variant="soft"
                  startIcon="Report"
                  className="mb-6"
                >
                  Failed to load glossary
                </Alert>
              </Show>
              <div className="flex flex-col gap-2 m-auto w-[82%]">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="w-full flex justify-between flex-row">
                    <Input
                      placeholder={sql.lit`Search Glossary Words`}
                      bindScalar="search_query"
                      className="mb-4 md:w-[30%]"
                    />
                    <IconButton
                      aria-label="Add Word"
                      variant="plain"
                      color="neutral"
                      size="sm"
                      onClick={(s) => {
                        s.setScalar("add_word_dialog_open", true);
                      }}
                      icon="Add"
                    />
                  </div>

                  <Typography
                    level="title-md"
                    sx={{
                      color: cssVar("palette-text-secondary"),
                      fontWeight: "semibold",
                      mr: 2,
                    }}
                  >
                    Filter by categories:
                  </Typography>
                  <div className="flex flex-wrap gap-2">
                    <Each table="selected_categories" recordName="category">
                      <ChipButton
                        checked={sql`category.selected`}
                        label={sql`category.name`}
                        color="primary"
                        variant="outlined"
                        size="sm"
                        checkedVariation={{
                          color: "primary",
                          variant: "soft",
                        }}
                        onClick={(s) => {
                          s.modify(sql`
                        update selected_categories
                        set selected = not selected
                        where id = category.id
                      `);
                          s.increment("refresh_key");
                        }}
                      />
                    </Each>
                  </div>
                </div>
                <Show
                  when={sql`exists (select 1 from selected_categories where selected and not add_word_dialog_open)`}
                >
                  <Button
                    variant="outlined"
                    size="sm"
                    color="primary"
                    startIcon="FilterAltOff"
                    onClick={(s) => {
                      s.modify(
                        sql`update selected_categories set selected = false`,
                      );
                      s.increment("refresh_key");
                    }}
                    className="self-start mt-1"
                  >
                    Clear filters
                  </Button>
                </Show>
              </div>
            </div>

            {/* Word Cards */}
            <div className="flex flex-wrap justify-center gap-2 min-w-[1000px] max-w-[1200px] mx-auto p-1">
              <Data
                watch={[sql`refresh_key`, sql`search_query`]}
                procedure={(s) => {
                  s.defTable(
                    "words_list",
                    sql`select * from db.glossary_words where (id in (select glossary_word_id from glossary_category_words where glossary_category_id in (select id from selected_categories where selected)) or not exists (select 1 from selected_categories where selected)) and case when trim(search_query) != '' then fuzzy_match(search_query, coalesce(cast(glossary_words.name as string), '')) else true end`,
                  );
                }}
              >
                <Each table="words_list" recordName="word">
                  <WordIteration />
                </Each>
              </Data>
            </div>

            <AddWordDialog />
          </div>
        </Data>
      </Data>
    </Data>
  );
}

/**
 * Solution block that adds a shared glossary of terms and definitions
 * (the `glossary_words` table) plus ready-made admin pages for managing
 * it. Useful when an app needs a single source of truth for jargon
 * that other content references.
 *
 * Add to `core.tsx`:
 *
 * ```ts
 * system.addBlock(new GlossaryBlock());
 * ```
 */
export class GlossaryBlock implements Block {
  blockName = "GlossaryBlock";
  componentDependencies: string[] = [];
  description: string | undefined;
  initialize() {
    const { db } = system;

    db.table("glossary_words", (table) => {
      table.string("name", 100).notNull();
    });

    db.table("glossary_categories", (table) => {
      table.string("name", 50).notNull();
      table.string("description", 150).notNull();
    });

    db.table("glossary_category_words", (table) => {
      table.fk("glossary_words").notNull();
      table.fk("glossary_categories").notNull();
    });

    db.table("glossary_definitions", (table) => {
      table.fk("glossary_words").notNull();
      table.string("description", 200).notNull();
    });

    db.table("glossary_examples", (table) => {
      table.fk("glossary_definitions").notNull();
      table.string("text", 200).notNull();
    });
    this.componentDependencies = ["GlossaryPage"];
    this.description =
      "Provides a way to manage a glossary of words and definitions.";
  }

  static GlossaryPage = GlossaryPage;
}
