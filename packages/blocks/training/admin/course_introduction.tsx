import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import {
  LexicalRichTextDisplay,
  RichTextSimpleEditor,
} from "components/lexical/components/lexical_editor";
import { QueryCombobox } from "components/query_combobox";
import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Show, useUniqueId } from "std/ui";
import type { TrainingBlock } from "../index";
import {
  introductionHasContentSql,
  introductionImagePrefix,
} from "../course_introduction";

export function CourseIntroductionEditor(
  props: { block: TrainingBlock; courseId: Sql; content: Sql },
) {
  const handle = useUniqueId();
  const editorId = useUniqueId();
  const hasContent = introductionHasContentSql(props.content);
  return (
    <Data local procedure={(s) => s.defScalar("edit_introduction", false)}>
      <section
        className="mb-6 rounded-md border border-divider"
        aria-label="Course introduction"
      >
        <div
          className="flex flex-col gap-2 rounded-t-md bg-neutral-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          dynamicClassNames={[{
            condition: sql`edit_introduction or ${hasContent}`,
            classNames: "border-b border-divider",
          }, {
            condition: sql`not edit_introduction and not (${hasContent})`,
            classNames: "rounded-b-md",
          }]}
        >
          <div>
            <Typography level="title-md">Introduction</Typography>
            <Typography level="body-sm" className="text-neutral-600">
              Shown to employees before they begin the course steps.
            </Typography>
          </div>
          <Show when={sql`not edit_introduction`}>
            <Button
              variant="outlined"
              color="neutral"
              size="sm"
              startIcon="Edit"
              onClick={(s) => s.setScalar("edit_introduction", true)}
              className="shrink-0"
            >
              {sql`case when ${hasContent} then 'Edit introduction' else 'Add introduction' end`}
            </Button>
          </Show>
        </div>
        <Show
          when={sql`edit_introduction`}
          fallback={
            <Show when={hasContent}>
              <div className="px-4 py-3">
                <LexicalRichTextDisplay value={props.content} />
              </div>
            </Show>
          }
        >
          <Data
            local
            noRefetch
            procedure={(s) => {
              s.defScalar("introduction_original", props.content);
              s.defScalar("introduction_content", props.content);
            }}
          >
            <div className="p-4">
              <RichTextSimpleEditor
                id={editorId}
                editorHandle={handle}
                value={sql`introduction_content`}
                onChange={(s, value) =>
                  s.setScalar("introduction_content", value)}
                onChangeDebounceMs={0}
                extendedToolbar
                toolbarItems={
                  <IntroductionImageButton
                    block={props.block}
                    handle={handle}
                  />
                }
                sx={{ minHeight: "220px" }}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="plain"
                  color="neutral"
                  onClick={(s) => s.setScalar("edit_introduction", false)}
                >
                  Cancel
                </Button>
                <ActionButton
                  startIcon="Save"
                  action={(s) => {
                    s.startTransaction();
                    s.callStoredProcedure(
                      "training_save_course_introduction_language",
                      {
                        inputScalars: {
                          p_course_id: props.courseId,
                          p_language: sql`ui.editor_language`,
                          p_introduction: sql`ui.introduction_content`,
                          p_previous_introduction:
                            sql`ui.introduction_original`,
                        },
                      },
                    );
                    s.commitTransaction();
                  }}
                  afterSuccessClient={(s) =>
                    s.setScalar("edit_introduction", false)}
                >
                  Save introduction
                </ActionButton>
              </div>
            </div>
          </Data>
        </Show>
      </section>
    </Data>
  );
}

/** Toolbar control that inserts a published Company Files image. */
function IntroductionImageButton(props: { block: TrainingBlock; handle: Sql }) {
  const anchorId = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("introduction_image_open", false);
        s.defScalar("introduction_image_id", { type: "BigInt" });
        s.defScalar("introduction_image_alt", sql.lit``);
        s.defScalar("introduction_image_blob", { type: "String" });
      }}
    >
      <ButtonGroup variant="outlined" color="neutral" size="sm">
        <IconButton
          id={anchorId}
          icon="AddPhotoAlternate"
          aria-label="Insert image"
          tooltip="Insert image"
          aria-pressed={sql`introduction_image_open`}
          onClick={(s) => {
            s.setScalar("introduction_image_id", sql`null`);
            s.setScalar("introduction_image_blob", sql`null`);
            s.setScalar("introduction_image_alt", sql.lit``);
            s.toggle("introduction_image_open");
          }}
        />
      </ButtonGroup>
      <Show when={sql`introduction_image_open`}>
        <Sheet
          variant="outlined"
          popover="auto"
          yolmPopoverShowing={sql`introduction_image_open`}
          floating={{
            anchorEl: anchorId,
            placement: "bottom-end",
            strategy: "fixed",
            shift: { mainAxis: true, crossAxis: true },
          }}
          sx={{
            mt: 1,
            p: 2,
            width: "min(24rem, calc(100vw - 2rem))",
            boxShadow: "md",
            borderRadius: "md",
            backgroundColor: "background-surface",
          }}
          onToggleHide={(s) => s.setScalar("introduction_image_open", false)}
        >
          <div className="flex flex-col gap-3">
            <Typography level="title-sm">Insert image</Typography>
            <FormControl>
              <FormLabel>Image</FormLabel>
              <QueryCombobox
                placeholder="Search published images"
                clearOnSelect={false}
                resultTableInferQuery={sql`select '' as label, 0::bigint as index, 0::bigint as id, '' as blob_hash`}
                populateResultTable={(s, query, table) =>
                  s.modify(sql`
                  insert into ${table}
                  select document.title as label, rank() over () - 1 as index, version.id, bytes.to_hex(blob.blob_hash) as blob_hash
                  from db.training_content_documents document
                  join db.controlled_file_revisions revision on revision.id = ${
                    props.block.opts.content
                      .resolveCourseSupportingDocumentVersion({
                        documentId: sql`document.id`,
                        assignmentLanguage: sql.lit(
                          props.block.opts.content.opts.defaultLanguage,
                        ),
                      })
                  }
                  join db.file_versions version on version.id = revision.file_version_id
                  join db.file_version_blobs blob on blob.file_version_id = version.id
                  where document.is_active and revision.status = 'published'
                    and version.content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
                    and ${
                    props.block.opts.content.canReadDocument(
                      sql`document.id`,
                      sql`current_user`,
                    )
                  }
                    and (trim(${query}) = '' or fuzzy_match(${query}, document.title))
                  order by fuzzy_rank_key(${query}, document.title), document.title limit 20
                `)}
                onClear={(s) => s.setScalar("introduction_image_id", sql`null`)}
                onBlur={() => {}}
                onSelect={(s, record) => {
                  s.setScalar("introduction_image_id", sql`${record}.id`);
                  s.setScalar(
                    "introduction_image_blob",
                    sql`${record}.blob_hash`,
                  );
                  s.setScalar("introduction_image_alt", sql`${record}.label`);
                }}
              />
            </FormControl>
            <Typography level="body-xs" className="text-neutral-600">
              Choose from published images in Company Files. Upload new images
              there first.
            </Typography>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                onClick={(s) => s.setScalar("introduction_image_open", false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={sql`introduction_image_id is null`}
                onClick={(s) => {
                  s.jsCall({
                    module: "lexical_editor",
                    exportName: "executeCommand",
                    handle: props.handle,
                    argJson:
                      sql`json_build_object('handle', ${props.handle}, 'command', 'insertImage', 'src', ${
                        sql.lit(introductionImagePrefix)
                      } || introduction_image_id::string, 'altText', trim(introduction_image_alt), 'blobHash', introduction_image_blob, 'width', 560)`,
                  });
                  s.setScalar("introduction_image_open", false);
                }}
              >
                Insert
              </Button>
            </div>
          </div>
        </Sheet>
      </Show>
    </Data>
  );
}
