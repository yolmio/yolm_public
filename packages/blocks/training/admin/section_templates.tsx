import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Checkbox } from "components/checkbox";
import { DataTable } from "components/data_table";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  adminCoursesHref,
  adminSelectClass,
  TrainingAdminFrame,
} from "./shared";

export function TrainingAdminSectionTemplatesPage(
  props: { block: TrainingBlock },
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_section_open", sql`false`);
        s.defScalar("add_section_item_open", sql`false`);
        s.defScalar("manage_section_items_open", sql`false`);
        s.defScalar("selected_section_template_id", sql.lit``);
        s.defScalar("selected_section_template_name", sql.lit``);
        s.defScalar("section_item_id", sql.lit``);
        s.defScalar("section_item_mode", sql.lit`add`);
        s.defScalar("section_template_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("section_item_template_id", sql.lit``);
        s.defScalar("section_item_type", sql.lit`practical`);
        s.defScalar("section_item_content", sql.lit``);
        s.defScalar("section_item_training_course_id", sql.lit``);
        s.defScalar("section_item_training_assessment_id", sql.lit``);
        s.defScalar("section_item_external_title", sql.lit``);
        s.defScalar("section_item_external_url", sql.lit``);
        s.defScalar("section_item_support_document_id", sql.lit``);
        s.defScalar("section_item_requires_essay", sql`false`);
        s.defScalar("section_item_essay_prompt", sql.lit``);
        s.defScalar("new_section_name", sql.lit``);
        s.defScalar("new_section_description", sql.lit``);
        s.defTable(
          "section_document_options",
          sql`select d.id, d.title
              from db.training_content_documents d
              where d.is_active
                and exists (
                  select 1
                  from db.training_content_language_variants active
                  join db.training_content_versions v
                    on v.id = active.current_document_version_id
                   and v.document_language_variant_id = active.id
                  where active.document_id = d.id
                    and v.published_at is not null
                )
              order by d.title`,
        );
        s.defTable(
          "section_course_options",
          sql`select c.id, c.name
              from db.training_courses c
              where c.is_active
                and exists (
                  select 1
                  from db.training_course_versions v
                  where v.id = c.current_training_course_version_id
                    and v.training_course_id = c.id
                    and v.status = 'published'
                )
              order by c.name`,
        );
        s.defTable(
          "section_assessment_options",
          sql`select assessment.id, assessment.name
              from db.training_assessments assessment
              where assessment.is_active
                and assessment.archived_at is null
              order by assessment.name`,
        );
      }}
    >
      <TrainingAdminFrame>
        <div className="flex flex-col gap-5">
          <div>
            <Button
              component="a"
              href={adminCoursesHref(props.block)}
              variant="plain"
              color="neutral"
              startIcon="ArrowBack"
            >
              Back to courses & programs
            </Button>
          </div>
          <Card variant="outlined">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
                <div>
                  <Typography level="title-lg" startIcon="ViewAgenda">
                    Stored Sections
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    Reusable section designs used when building course and
                    program versions.
                  </Typography>
                </div>
                <IconButton
                  icon="Add"
                  aria-label="Add stored section"
                  tooltip="Add stored section"
                  onClick={(s) => s.setScalar("add_section_open", sql`true`)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <Show when={sql`section_template_error is not null`}>
                <Alert color="danger" startIcon="Error" className="mb-4">
                  {sql`section_template_error`}
                </Alert>
              </Show>
              <DataTable
                query={sql`
                  select id, name, description,
                         (select count(*)
                          from db.training_course_section_template_items item
                          where item.training_course_section_template_id =
                            training_course_section_templates.id) as item_count,
                         case when is_active then 'Active' else 'Inactive' end as status
                  from db.training_course_section_templates
                  order by case when is_active then 0 else 1 end, name
                `}
                recordName="section_template"
                searchable={["name", "description", "status"]}
                columns={(b) => {
                  b.simpleColumn("name", "Section", { width: "30%" });
                  b.simpleColumn("description", "Description", {
                    width: "42%",
                  });
                  b.simpleColumn("item_count", "Items", { width: "8%" });
                  b.simpleColumn("status", "Status", { width: "12%" });
                }}
                actions={(b) => {
                  b.custom(
                    "Manage items",
                    { icon: "FormatListBulleted" },
                    (s) => {
                      s.setScalar("section_template_error", sql`null`);
                      s.setScalar(
                        "selected_section_template_id",
                        sql`section_template.id::string`,
                      );
                      s.setScalar(
                        "selected_section_template_name",
                        sql`section_template.name`,
                      );
                      s.setScalar("manage_section_items_open", sql`true`);
                    },
                  );
                  b.custom(
                    "Toggle active",
                    { icon: "PublishedWithChanges" },
                    (s) => {
                      s.tryServer({
                        body: (s) => {
                          s.startTransaction();
                          s.modify(sql`
                            update db.training_course_section_templates
                            set is_active = not is_active
                            where id = section_template.id
                          `);
                          s.commitTransaction();
                          s.refetch();
                        },
                      });
                    },
                  );
                }}
              />
            </CardContent>
          </Card>
          <ModalDialog bindScalar="add_section_open" maxWidth="sm">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Typography level="title-lg" startIcon="ViewAgenda">
                  Add Stored Section
                </Typography>
                <Typography level="body-sm" className="text-neutral-600 mt-1">
                  Name the reusable section, then add its items in the item
                  editor that opens next.
                </Typography>
              </div>
              <IconButton
                icon="Close"
                aria-label="Close"
                variant="plain"
                color="neutral"
                onClick={(s) => s.setScalar("add_section_open", sql`false`)}
              />
            </div>
            <div className="grid gap-3">
              <FormControl>
                <FormLabel>Section name</FormLabel>
                <Input
                  bindScalar="new_section_name"
                  placeholder="Safety Basics"
                />
              </FormControl>
              <FormControl>
                <FormLabel>Subtitle</FormLabel>
                <Textarea bindScalar="new_section_description" minRows={2} />
              </FormControl>
              <div className="flex justify-end gap-2">
                <Button
                  variant="plain"
                  color="neutral"
                  onClick={(s) => s.setScalar("add_section_open", sql`false`)}
                >
                  Cancel
                </Button>
                <Button
                  startIcon="Save"
                  onClick={(s) => {
                    s.setScalar("section_template_error", sql`null`);
                    s.if(
                      sql`nullif(trim(new_section_name), '') is null`,
                      (s) => {
                        s.setScalar(
                          "section_template_error",
                          sql.lit`Enter the section name before saving.`,
                        );
                        s.return();
                      },
                    );
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(sql`
                          insert into db.training_course_section_templates
                            (name, description)
                          values
                            (trim(new_section_name),
                             nullif(trim(new_section_description), ''))
                          returning id into new_section_template_id
                        `);
                        s.commitTransaction();
                        s.setScalar("add_section_open", sql`false`);
                        s.setScalar(
                          "selected_section_template_id",
                          sql`new_section_template_id::string`,
                        );
                        s.setScalar(
                          "selected_section_template_name",
                          sql`trim(new_section_name)`,
                        );
                        s.setScalar("new_section_name", sql.lit``);
                        s.setScalar("new_section_description", sql.lit``);
                        s.setScalar("manage_section_items_open", sql`true`);
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          "section_template_error",
                          sql
                            .lit`Stored section could not be saved. Check the name is not already used.`,
                        );
                      },
                    });
                  }}
                >
                  Create section
                </Button>
              </div>
            </div>
          </ModalDialog>
          <ModalDialog bindScalar="manage_section_items_open" maxWidth="lg">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Typography level="title-lg" startIcon="FormatListBulleted">
                  {sql`selected_section_template_name`}
                </Typography>
                <Typography level="body-sm" className="text-neutral-600 mt-1">
                  Manage the reusable steps copied with this stored section.
                </Typography>
              </div>
              <IconButton
                icon="Close"
                aria-label="Close"
                variant="plain"
                color="neutral"
                onClick={(s) =>
                  s.setScalar("manage_section_items_open", sql`false`)}
              />
            </div>
            <div className="flex justify-end mb-3">
              <Button
                startIcon="AddTask"
                onClick={(s) => {
                  s.setScalar("section_template_error", sql`null`);
                  s.setScalar("section_item_mode", sql.lit`add`);
                  s.setScalar("section_item_id", sql.lit``);
                  s.setScalar(
                    "section_item_template_id",
                    sql`selected_section_template_id`,
                  );
                  s.setScalar("section_item_type", sql.lit`practical`);
                  s.setScalar("section_item_content", sql.lit``);
                  s.setScalar("section_item_training_course_id", sql.lit``);
                  s.setScalar(
                    "section_item_training_assessment_id",
                    sql.lit``,
                  );
                  s.setScalar("section_item_external_title", sql.lit``);
                  s.setScalar("section_item_external_url", sql.lit``);
                  s.setScalar("section_item_requires_essay", sql`false`);
                  s.setScalar("section_item_essay_prompt", sql.lit``);
                  s.setScalar("add_section_item_open", sql`true`);
                }}
              >
                Add item
              </Button>
            </div>
            <DataTable
              query={sql`
                select item.id,
                       item.training_course_section_template_id,
                       item.content,
                       item.sort_order,
                       item.type,
                       item.training_course_id,
                       item.training_assessment_id,
                       item.external_url,
                       item.external_title,
                       item.requires_essay,
                       item.essay_prompt,
                       (
                         select count(*)
                         from db.training_course_section_template_item_documents doc
                         where doc.training_course_section_template_item_id =
                           item.id
                       ) as support_document_count,
                       case
                         when item.type = 'external_link' then 'External link'
                         when item.type = 'other_checklist' then 'Nested course'
                         when item.type = 'essay' then 'Essay'
                         when item.type = 'signature' then 'Signature'
                         when item.type = 'assessment' then 'Assessment'
                         else 'Practical'
                       end as item_type,
                       coalesce(c.name, item_assessment.name,
                         item.external_title, item.content) as target
                from db.training_course_section_template_items item
                left join db.training_courses c on c.id = item.training_course_id
                left join db.training_assessments item_assessment
                  on item_assessment.id = item.training_assessment_id
                where item.training_course_section_template_id =
                  nullif(selected_section_template_id, '')::bigint
                order by item.sort_order, item.id
              `}
              recordName="section_item"
              searchable={["content", "item_type", "target"]}
              columns={(b) => {
                b.simpleColumn("content", "Item", { width: "34%" });
                b.simpleColumn("item_type", "Type", { width: "16%" });
                b.simpleColumn("target", "Target", { width: "30%" });
                b.simpleColumn("support_document_count", "Docs", {
                  width: "8%",
                });
                b.simpleColumn("sort_order", "Order", { width: "8%" });
              }}
              actions={(b) => {
                b.custom("Edit", { icon: "Edit" }, (s) => {
                  s.setScalar("section_template_error", sql`null`);
                  s.setScalar("section_item_mode", sql.lit`edit`);
                  s.setScalar("section_item_id", sql`section_item.id::string`);
                  s.setScalar(
                    "section_item_template_id",
                    sql`section_item.training_course_section_template_id::string`,
                  );
                  s.setScalar("section_item_type", sql`section_item.type`);
                  s.setScalar(
                    "section_item_content",
                    sql`section_item.content`,
                  );
                  s.setScalar(
                    "section_item_training_course_id",
                    sql`coalesce(section_item.training_course_id::string, '')`,
                  );
                  s.setScalar(
                    "section_item_training_assessment_id",
                    sql`coalesce(section_item.training_assessment_id::string, '')`,
                  );
                  s.setScalar(
                    "section_item_external_title",
                    sql`coalesce(section_item.external_title, '')`,
                  );
                  s.setScalar(
                    "section_item_external_url",
                    sql`coalesce(section_item.external_url, '')`,
                  );
                  s.setScalar(
                    "section_item_requires_essay",
                    sql`section_item.requires_essay`,
                  );
                  s.setScalar(
                    "section_item_essay_prompt",
                    sql`coalesce(section_item.essay_prompt, '')`,
                  );
                  s.setScalar("section_item_support_document_id", sql.lit``);
                  s.setScalar("add_section_item_open", sql`true`);
                });
                b.custom("Remove", { icon: "Delete" }, (s) => {
                  s.setScalar("section_template_error", sql`null`);
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      s.modify(sql`
                        delete from db.training_course_section_template_items
                        where id = section_item.id
                      `);
                      s.commitTransaction();
                      s.refetch();
                    },
                    catch: (s) => {
                      s.setScalar(
                        "section_template_error",
                        sql.lit`Stored section item could not be removed.`,
                      );
                    },
                  });
                });
              }}
            />
            <div className="mt-4 border-t border-divider pt-4">
              <Typography level="title-sm" startIcon="AttachFile">
                Supporting documents
              </Typography>
              <DataTable
                query={sql`
                  select doc.id,
                         item.content as item_content,
                         coalesce(doc.label, d.title) as document_title,
                         doc.sort_order
                  from db.training_course_section_template_item_documents doc
                  join db.training_course_section_template_items item
                    on item.id =
                      doc.training_course_section_template_item_id
                  join db.training_content_documents d
                    on d.id = doc.document_id
                  where item.training_course_section_template_id =
                    nullif(selected_section_template_id, '')::bigint
                  order by item.sort_order, doc.sort_order, doc.id
                `}
                recordName="support_doc"
                searchable={["item_content", "document_title"]}
                columns={(b) => {
                  b.simpleColumn("item_content", "Item", { width: "45%" });
                  b.simpleColumn("document_title", "Document", {
                    width: "45%",
                  });
                }}
                actions={(b) => {
                  b.custom("Remove", { icon: "RemoveCircleOutline" }, (s) => {
                    s.setScalar("section_template_error", sql`null`);
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(sql`
                          delete from db.training_course_section_template_item_documents
                          where id = support_doc.id
                        `);
                        s.commitTransaction();
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          "section_template_error",
                          sql
                            .lit`Supporting document could not be removed.`,
                        );
                      },
                    });
                  });
                }}
              />
            </div>
          </ModalDialog>
          <ModalDialog bindScalar="add_section_item_open" maxWidth="md">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Typography level="title-lg" startIcon="FormatListBulleted">
                  {sql`case
                    when section_item_mode = 'edit' then 'Edit Stored Section Item'
                    else 'Add Stored Section Item'
                  end`}
                </Typography>
                <Typography level="body-sm" className="text-neutral-600 mt-1">
                  {sql`selected_section_template_name`}
                </Typography>
              </div>
              <IconButton
                icon="Close"
                aria-label="Close"
                variant="plain"
                color="neutral"
                onClick={(s) =>
                  s.setScalar("add_section_item_open", sql`false`)}
              />
            </div>
            <div className="grid gap-3">
              <FormControl>
                <FormLabel>Type</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`section_item_type`}
                  onInput={(s) => {
                    s.setScalar("section_item_type", sql`target_value`);
                    s.setScalar("section_item_training_course_id", sql.lit``);
                    s.setScalar(
                      "section_item_training_assessment_id",
                      sql.lit``,
                    );
                    s.setScalar("section_item_external_title", sql.lit``);
                    s.setScalar("section_item_external_url", sql.lit``);
                    s.if(sql`target_value = 'signature'`, (s) => {
                      s.setScalar(
                        "section_item_support_document_id",
                        sql.lit``,
                      );
                    });
                  }}
                >
                  <Select.Option value="other_checklist">
                    Nested course
                  </Select.Option>
                  <Select.Option value="external_link">
                    External link
                  </Select.Option>
                  <Select.Option value="essay">Essay</Select.Option>
                  <Select.Option value="signature">Signature</Select.Option>
                  <Select.Option value="practical">Practical</Select.Option>
                  <Select.Option value="assessment">Assessment</Select.Option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Item text</FormLabel>
                <Input
                  bindScalar="section_item_content"
                  placeholder="Describe the step"
                />
              </FormControl>
              <Show when={sql`section_item_type = 'other_checklist'`}>
                <FormControl>
                  <FormLabel>Nested course</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`section_item_training_course_id`}
                    onInput={(s) =>
                      s.setScalar(
                        "section_item_training_course_id",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">Choose course</Select.Option>
                    <Each table="section_course_options" recordName="course">
                      <Select.Option value={sql`course.id`}>
                        {sql`course.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
              </Show>
              <Show when={sql`section_item_type = 'assessment'`}>
                <FormControl>
                  <FormLabel>Assessment</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`section_item_training_assessment_id`}
                    onInput={(s) =>
                      s.setScalar(
                        "section_item_training_assessment_id",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">Choose assessment</Select.Option>
                    <Each
                      table="section_assessment_options"
                      recordName="assessment"
                    >
                      <Select.Option value={sql`assessment.id`}>
                        {sql`assessment.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
              </Show>
              <Show when={sql`section_item_type = 'external_link'`}>
                <FormControl>
                  <FormLabel>Link URL</FormLabel>
                  <Input
                    bindScalar="section_item_external_url"
                    placeholder="https://..."
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Link title</FormLabel>
                  <Input
                    bindScalar="section_item_external_title"
                    placeholder="Shown to the trainee"
                  />
                </FormControl>
              </Show>
              <Show when={sql`section_item_type = 'essay'`}>
                <FormControl>
                  <FormLabel>Essay prompt</FormLabel>
                  <Textarea
                    bindScalar="section_item_essay_prompt"
                    minRows={3}
                  />
                </FormControl>
              </Show>
              <Show when={sql`section_item_type != 'signature'`}>
                <FormControl>
                  <FormLabel>Supporting file or link</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`section_item_support_document_id`}
                    onInput={(s) =>
                      s.setScalar(
                        "section_item_support_document_id",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">None</Select.Option>
                    <Each
                      table="section_document_options"
                      recordName="document"
                    >
                      <Select.Option value={sql`document.id`}>
                        {sql`document.title`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
              </Show>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Checkbox
                  checked={sql`section_item_requires_essay`}
                  label="Requires essay"
                  onCheckboxChange={(s) =>
                    s.setScalar(
                      "section_item_requires_essay",
                      sql`target_checked`,
                    )}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="plain"
                  color="neutral"
                  onClick={(s) =>
                    s.setScalar("add_section_item_open", sql`false`)}
                >
                  Cancel
                </Button>
                <Button
                  startIcon="Save"
                  onClick={(s) => {
                    s.setScalar("section_template_error", sql`null`);
                    s.if(
                      sql`nullif(section_item_template_id, '') is null
                        or nullif(trim(section_item_content), '') is null
                        or (
                          section_item_type = 'other_checklist'
                          and nullif(section_item_training_course_id, '') is null
                        )
                        or (
                          section_item_type = 'assessment'
                          and nullif(section_item_training_assessment_id, '') is null
                        )
                        or (
                          section_item_type = 'external_link'
                          and nullif(trim(section_item_external_url), '') is null
                        )`,
                      (s) => {
                        s.setScalar(
                          "section_template_error",
                          sql
                            .lit`Choose the required section, item text, and target before saving.`,
                        );
                        s.return();
                      },
                    );
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.if(
                          sql`section_item_mode = 'edit'`,
                          (s) => {
                            s.modify(sql`
                              update db.training_course_section_template_items
                              set content = trim(section_item_content),
                                  type = section_item_type,
                                  training_course_id = case
                                    when section_item_type = 'other_checklist'
                                    then section_item_training_course_id::bigint
                                    else null
                                  end,
                                  training_assessment_id = case
                                    when section_item_type = 'assessment'
                                    then section_item_training_assessment_id::bigint
                                    else null
                                  end,
                                  external_url = case
                                    when section_item_type = 'external_link'
                                    then trim(section_item_external_url)
                                    else null
                                  end,
                                  external_title = case
                                    when section_item_type = 'external_link'
                                    then trim(section_item_external_title)
                                    else null
                                  end,
                                  requires_essay = section_item_requires_essay,
                                  essay_prompt = case
                                    when section_item_type = 'essay'
                                      or section_item_requires_essay
                                    then nullif(trim(section_item_essay_prompt), '')
                                    else null
                                  end
                              where id = section_item_id::bigint
                                and training_course_section_template_id =
                                  section_item_template_id::bigint
                            `);
                          },
                          (s) => {
                            s.modify(sql`
                              insert into db.training_course_section_template_items
                                (training_course_section_template_id, content,
                                 sort_order, type,
                                 training_course_id, training_assessment_id,
                                 external_url, external_title,
                                 requires_essay, essay_prompt)
                              values
                                (section_item_template_id::bigint,
                                 trim(section_item_content),
                                 (
                                   select coalesce(max(sort_order), 0) + 10
                                   from db.training_course_section_template_items
                                   where training_course_section_template_id =
                                     section_item_template_id::bigint
                                 ),
                                 section_item_type,
                                 case
                                   when section_item_type = 'other_checklist'
                                   then section_item_training_course_id::bigint
                                   else null
                                 end,
                                 case
                                   when section_item_type = 'assessment'
                                   then section_item_training_assessment_id::bigint
                                   else null
                                 end,
                                 case
                                   when section_item_type = 'external_link'
                                   then trim(section_item_external_url)
                                   else null
                                 end,
                                 case
                                   when section_item_type = 'external_link'
                                   then trim(section_item_external_title)
                                   else null
                                 end,
                                 section_item_requires_essay,
                                 case
                                   when section_item_type = 'essay'
                                        or section_item_requires_essay
                                   then nullif(trim(section_item_essay_prompt), '')
                                   else null
                                 end)
                            `);
                          },
                        );
                        s.if(
                          sql`section_item_mode = 'edit'
                            and section_item_type = 'signature'`,
                          (s) => {
                            s.modify(sql`
                              delete from db.training_course_section_template_item_documents
                              where training_course_section_template_item_id =
                                section_item_id::bigint
                            `);
                          },
                        );
                        s.if(
                          sql`section_item_type != 'signature'
                            and nullif(section_item_support_document_id, '') is not null`,
                          (s) => {
                            s.modify(sql`
                              insert into db.training_course_section_template_item_documents
                                (training_course_section_template_item_id,
                                 document_id, sort_order, label)
                              select case
                                       when section_item_mode = 'edit'
                                       then section_item_id::bigint
                                       else last_record_id(db.training_course_section_template_items)
                                     end,
                                     section_item_support_document_id::bigint,
                                     (
                                       select coalesce(max(sort_order), 0) + 10
                                       from db.training_course_section_template_item_documents
                                       where training_course_section_template_item_id =
                                         case
                                           when section_item_mode = 'edit'
                                           then section_item_id::bigint
                                           else last_record_id(db.training_course_section_template_items)
                                         end
                                     ),
                                     title
                              from db.training_content_documents
                              where id = section_item_support_document_id::bigint
                                and not exists (
                                  select 1
                                  from db.training_course_section_template_item_documents existing
                                  where existing.training_course_section_template_item_id =
                                    case
                                      when section_item_mode = 'edit'
                                      then section_item_id::bigint
                                      else last_record_id(db.training_course_section_template_items)
                                    end
                                    and existing.document_id =
                                      section_item_support_document_id::bigint
                                )
                            `);
                          },
                        );
                        s.commitTransaction();
                        s.setScalar("add_section_item_open", sql`false`);
                        s.setScalar("section_item_mode", sql.lit`add`);
                        s.setScalar("section_item_id", sql.lit``);
                        s.setScalar("section_item_content", sql.lit``);
                        s.setScalar(
                          "section_item_training_course_id",
                          sql.lit``,
                        );
                        s.setScalar(
                          "section_item_training_assessment_id",
                          sql.lit``,
                        );
                        s.setScalar("section_item_external_title", sql.lit``);
                        s.setScalar("section_item_external_url", sql.lit``);
                        s.setScalar(
                          "section_item_support_document_id",
                          sql.lit``,
                        );
                        s.setScalar("section_item_essay_prompt", sql.lit``);
                        s.refetch();
                      },
                      catch: (s) => {
                        s.setScalar(
                          "section_template_error",
                          sql
                            .lit`Stored section item could not be saved. Check the selected target for the item type.`,
                        );
                      },
                    });
                  }}
                >
                  Save item
                </Button>
              </div>
            </div>
          </ModalDialog>
        </div>
      </TrainingAdminFrame>
    </Data>
  );
}
