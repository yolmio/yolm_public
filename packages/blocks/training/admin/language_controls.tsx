import { TranslationReviewPanel } from "./translation_reviews";
import { adminAssessmentHref, adminCourseHref } from "./shared";
import { Alert } from "components/alert";
import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { StringFieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { Form } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { activeAssessmentVersionSql, activeCourseVersionSql } from "../helpers";
import type { TrainingBlock } from "../index";

/**
 * Segmented switch between the configured content languages. Renders nothing
 * when only one language is configured.
 */
export function TrainingLanguageSwitch(props: { block: TrainingBlock }) {
  const languages = props.block.opts.content.opts.languages;
  if (languages.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <Typography level="body-xs" className="text-neutral-600">
        Content language
      </Typography>
      <ButtonGroup size="sm" color="neutral">
        {languages.map((language) => (
          <Button
            aria-pressed={sql`ui.editor_language = ${sql.lit(language.code)}`}
            onClick={(s) =>
              s.setQueryParam("content_language", sql.lit(language.code))}
          >
            {language.name}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}

/**
 * Language-specific editor state: untranslated and stale-translation notices,
 * linked translations to review, and the title/description dialog bound to
 * the page's `language_details_open` scalar.
 */
export function TrainingLanguageControls(props: {
  block: TrainingBlock;
  kind: "course" | "assessment";
  recordId: Sql;
  versionId: Sql;
}) {
  const active = props.kind === "course"
    ? activeCourseVersionSql
    : activeAssessmentVersionSql;
  const versionTable = `training_${props.kind}_versions`;
  return (
    <Data
      watch={[sql`ui.editor_language`, props.versionId]}
      procedure={(s) => {
        s.defRecord(
          "language_version",
          sql`select v.*, parent.name as canonical_name, parent.description as canonical_description from db.${
            sql.ref(`training_${props.kind}s`)
          } parent left join db.${sql.ref(versionTable)} v on v.${
            sql.ref(`training_${props.kind}_id`)
          } = parent.id and v.id = ${props.versionId} where parent.id = ${props.recordId}`,
        );
        s.defScalar("translation_source_version", active(props.recordId));
        if (props.kind === "course") {
          s.defTable(
            "language_dependencies",
            sql`select distinct 'assessment' as kind, a.id, a.name,
        coalesce((select status::string from db.training_assessment_versions where training_assessment_id = a.id and language = ui.editor_language order by status = 'draft' desc, id desc limit 1), 'Not translated') as status
        from db.training_course_section_items i join db.training_course_sections section on section.id = i.training_course_section_id join db.training_assessments a on a.id = i.training_assessment_id
        where section.training_course_version_id = ${props.versionId}
        union
        select distinct 'course', c.id, c.name,
        coalesce((select status::string from db.training_course_versions where training_course_id = c.id and language = ui.editor_language order by status = 'draft' desc, id desc limit 1), 'Not translated')
        from db.training_course_section_items i join db.training_course_sections section on section.id = i.training_course_section_id join db.training_courses c on c.id = i.other_course_id
        where section.training_course_version_id = ${props.versionId}`,
          );
        }
      }}
    >
      <TranslationReviewPanel {...props} />
      {props.kind === "course" && (
        <Show
          when={sql`ui.editor_language != ${
            sql.lit(props.block.opts.content.opts.defaultLanguage)
          } and exists(select 1 from language_dependencies)`}
        >
          <div className="rounded-md border border-divider px-4 py-3">
            <Typography level="title-sm">Review linked translations</Typography>
            <Typography level="body-sm" className="text-neutral-600">
              Publish these separately after review. Until then, learners use
              their published version with default-language fallback.
            </Typography>
            <Each table="language_dependencies" recordName="dependency">
              <div className="mt-1">
                <a
                  className="text-sm text-primary-600 underline"
                  href={sql`(case when dependency.kind = 'assessment' then ${
                    adminAssessmentHref(props.block, sql`dependency.id`)
                  } else ${
                    adminCourseHref(props.block, sql`dependency.id`)
                  } end) || '?content_language=' || ui.editor_language`}
                >
                  {sql`dependency.name || ' · ' || dependency.status`}
                </a>
              </div>
            </Each>
          </div>
        </Show>
      )}
      <Show
        when={sql`language_version.id is null and ui.editor_language != ${
          sql.lit(props.block.opts.content.opts.defaultLanguage)
        }`}
      >
        <div className="rounded-md border border-dashed border-divider px-4 py-6 text-center">
          <Typography level="title-md">
            {sql`language_version.canonical_name`}
          </Typography>
          <Typography level="body-sm" className="text-neutral-600 mt-1">
            {sql`case when translation_source_version is null then ${
              sql.lit(
                `Publish the ${
                  props.block.opts.content.opts.languages.find((l) =>
                    l.code === props.block.opts.content.opts.defaultLanguage
                  )?.name ?? props.block.opts.content.opts.defaultLanguage
                } ${props.kind} first, then ask Spark to translate it. The translation will appear here for review.`,
              )
            } else 'Ask Spark to translate this ' || ${
              sql.lit(props.kind)
            } || '. The translation will appear here for review and publication.' end`}
          </Typography>
        </div>
      </Show>
      <Show
        when={sql`language_version.source_version_id is not null and language_version.source_version_id != translation_source_version`}
      >
        <Alert color="warning">
          The source course or assessment has changed since this translation.
          Review the changes before publishing.
        </Alert>
      </Show>
      <Show
        when={sql`language_version.id is not null or ui.editor_language = ${
          sql.lit(props.block.opts.content.opts.defaultLanguage)
        }`}
      >
        <ModalDialog bindScalar="language_details_open" maxWidth="sm">
          <Typography level="title-lg">Title and description</Typography>
          <Typography level="body-sm" className="text-neutral-600 mt-1 mb-4">
            Shown to employees for this language. Publish to make changes
            visible in training.
          </Typography>
          <Form
            watch={[sql`language_version.id`]}
            defaultFieldComponent={StringFieldFormControl}
            afterTransactionStart={(s) => {
              s.throwErrorIf(
                sql`nullif(trim(ui.language_metadata.localized_name), '') is null`,
                sql.lit`Enter a title before saving.`,
              );
              s.throwErrorUnless(
                sql`language_version.id is not distinct from coalesce(
                (select id from db.${sql.ref(versionTable)} where ${
                  sql.ref(`training_${props.kind}_id`)
                } = ${props.recordId} and language = ui.editor_language and status = 'draft' order by id desc limit 1),
                ${active(props.recordId, sql`ui.editor_language`, true)}
              )`,
                sql
                  .lit`This content has changed. Refresh the page before saving.`,
              );
              s.throwErrorUnless(
                sql`(language_version.id is null and ui.editor_language = ${
                  sql.lit(props.block.opts.content.opts.defaultLanguage)
                }) or exists (select 1 from db.${
                  sql.ref(versionTable)
                } where id = language_version.id and ${
                  sql.ref(`training_${props.kind}_id`)
                } = ${props.recordId} and status = language_version.status and language = ui.editor_language)`,
                sql
                  .lit`This content has changed. Refresh the page before saving.`,
              );
              s.callStoredProcedure(
                `training_ensure_${props.kind}_draft_language`,
                {
                  inputScalars: {
                    [`p_${props.kind}_id`]: props.recordId,
                    p_language: sql`ui.editor_language`,
                    p_source_version: sql`null`,
                  },
                  outputScalars: props.kind === "course"
                    ? {
                      draft_course_version_id: "editable_language_version_id",
                      source_course_version_id: "editable_language_source_id",
                    }
                    : {
                      draft_assessment_version_id:
                        "editable_language_version_id",
                    },
                },
              );
              s.modify(
                sql`update db.${
                  sql.ref(versionTable)
                } set localized_name = trim(ui.language_metadata.localized_name), localized_description = nullif(trim(ui.language_metadata.localized_description), '') where id = editable_language_version_id`,
              );
            }}
            afterSubmitClientSuccess={(s) =>
              s.setScalar("language_details_open", sql`false`)}
          >
            <Form.Temporary name="language_metadata">
              <div className="flex flex-col gap-3">
                <FormControl>
                  <FormLabel>Title</FormLabel>
                  <Form.Field
                    field="localized_name"
                    fieldType={{ type: "String", maxLength: 200 }}
                    required
                    initialValue={sql`coalesce(language_version.localized_name, language_version.canonical_name)`}
                  >
                    <StringFieldFormControl required />
                  </Form.Field>
                </FormControl>
                <FormControl>
                  <FormLabel>Description</FormLabel>
                  <Form.Field
                    field="localized_description"
                    fieldType={{ type: "String", maxLength: 2000 }}
                    initialValue={sql`case when language_version.localized_name is null then language_version.canonical_description else language_version.localized_description end`}
                  >
                    <StringFieldFormControl multiline />
                  </Form.Field>
                </FormControl>
                <Form.ErrorAlert mode="all" />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="plain"
                    color="neutral"
                    onClick={(s) =>
                      s.setScalar("language_details_open", sql`false`)}
                  >
                    Cancel
                  </Button>
                  <Form.SubmitButton>
                    Save title and description
                  </Form.SubmitButton>
                </div>
              </div>
            </Form.Temporary>
          </Form>
        </ModalDialog>
      </Show>
    </Data>
  );
}
