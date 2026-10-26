import { LexicalRichTextDisplay } from "components/lexical/components/lexical_editor";
import { Typography } from "components/typography";
import { Data } from "std/data";
import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import { CourseStepDocument } from "../course_step_document";
import { introductionImagePrefix } from "../course_introduction";
import {
  activeVersionIdSql,
  employeeText,
  trainingFeatureEnabled,
} from "../helpers";
import type { TrainingBlock } from "../index";
import {
  translationReviewAccessSql,
  translationReviewFileHref,
} from "../translation_reviews";
import type { TranslationReviewKind } from "../translation_reviews";

/** Read only the two immutable versions named by the authorized review. */
export function TranslationReviewContent(props: {
  block: TrainingBlock;
  kind: TranslationReviewKind;
  source?: boolean;
  uiLanguage: Sql;
}) {
  const { block, kind } = props;
  const course = kind === "course";
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "review_content",
          sql`select v.*, coalesce(v.localized_name, parent.name) as title,
        case when v.localized_name is null then parent.description else v.localized_description end as description
        from db.training_translation_review_state request
        join db.${sql.ref(`training_${kind}_versions`)} v on v.id = request.${
            sql.ref(
              props.source
                ? "source_version_id"
                : `training_${kind}_version_id`,
            )
          }
        join db.${sql.ref(`training_${kind}s`)} parent on parent.id = v.${
            sql.ref(`training_${kind}_id`)
          }
        where request.id = ui.translation_review_id and ${
            translationReviewAccessSql(block.opts.workforce, sql`request.id`)
          }`,
        );
        s.defTable(
          "review_sections",
          sql`select * from db.${sql.ref(`training_${kind}_sections`)}
        where ${
            sql.ref(`training_${kind}_version_id`)
          } = review_content.id order by ordinal, id`,
        );
        s.defTable(
          "review_items",
          sql`select * from db.${
            sql.ref(
              course
                ? "training_course_section_items"
                : "training_assessment_items",
            )
          }
        where ${
            sql.ref(`training_${kind}_section_id`)
          } in (select id from review_sections)
        order by ${sql.ref(course ? "sort_order" : "ordinal")}, id`,
        );
        if (course) {
          s.defTable(
            "review_documents",
            sql`select link.training_course_section_item_id as item_id,
          link.label, coalesce(link.label, document.title) as title, version.*, revision.file_version_id
          from db.training_course_section_item_documents link
          join db.training_content_documents document on document.id = link.document_id
          left join db.training_content_versions version on version.id = ${
              activeVersionIdSql(
                sql`document.id`,
                sql`review_content.language`,
                block.opts,
              )
            }
          left join db.controlled_file_revisions revision on revision.id = version.id
          where link.training_course_section_item_id in (select id from review_items)
          order by link.sort_order, link.id`,
          );
        } else {
          s.defTable(
            "review_choices",
            sql`select * from db.training_assessment_item_choices
          where training_assessment_item_id in (select id from review_items) order by sort_order, id`,
          );
          s.defTable(
            "review_fields",
            sql`select * from db.training_assessment_metadata_fields
          where training_assessment_version_id = review_content.id order by ordinal, id`,
          );
          s.defTable(
            "review_field_choices",
            sql`select * from db.training_assessment_metadata_field_choices
          where training_assessment_metadata_field_id in (select id from review_fields) order by sort_order, id`,
          );
        }
      }}
    >
      <section
        aria-label={employeeText(
          props.uiLanguage,
          props.source
            ? { en: "Original language", es: "Idioma original" }
            : { en: "Translation", es: "Traducción" },
        )}
        className="min-w-0 border border-divider rounded-md p-4"
      >
        <Typography level="title-sm" className="mb-3">
          {employeeText(
            props.uiLanguage,
            props.source
              ? { en: "Original language", es: "Idioma original" }
              : { en: "Translation", es: "Traducción" },
          )}
        </Typography>
        <Typography level="h4">{sql`review_content.title`}</Typography>
        <p className="whitespace-pre-wrap text-sm mt-2">
          {sql`review_content.description`}
        </p>
        {course && trainingFeatureEnabled(block.opts, "courseIntroduction") && (
          <Show when={sql`review_content.introduction is not null`}>
            <div className="mt-4">
              <LexicalRichTextDisplay
                value={sql`review_content.introduction`}
                imageSrcPrefixRewrite={{
                  prefix: sql.lit(introductionImagePrefix),
                  replacement:
                    sql`'/api/training/translation-reviews/' || ui.translation_review_id::string || '/files/'`,
                }}
              />
            </div>
          </Show>
        )}
        {!course && (
          <Each table="review_fields" recordName="review_field">
            <div className="mt-4">
              <Typography level="title-sm">
                {sql`review_field.label`}
              </Typography>
              <p className="whitespace-pre-wrap text-sm">
                {sql`review_field.help_text`}
              </p>
              <ul className="list-disc pl-5">
                <Each
                  table="review_field_choices"
                  recordName="field_choice"
                  where={sql`training_assessment_metadata_field_id = review_field.id`}
                >
                  <li className="text-sm">{sql`field_choice.label`}</li>
                </Each>
              </ul>
            </div>
          </Each>
        )}
        <Each table="review_sections" recordName="review_section">
          <div className="mt-6">
            <Typography level="title-md">{sql`review_section.name`}</Typography>
            <p className="whitespace-pre-wrap text-sm mt-1">
              {sql`review_section.description`}
            </p>
            <ol className="list-decimal pl-5">
              <Each
                table="review_items"
                recordName="review_item"
                where={sql`${
                  sql.ref(`training_${kind}_section_id`)
                } = review_section.id`}
              >
                <li className="mt-4 pl-1">
                  <Typography level="title-sm" className="whitespace-pre-wrap">
                    {course
                      ? sql`review_item.content`
                      : sql`review_item.prompt`}
                  </Typography>
                  {course
                    ? (
                      <>
                        <Show when={sql`review_item.essay_prompt is not null`}>
                          <p className="text-sm whitespace-pre-wrap mt-2">
                            {sql`review_item.essay_prompt`}
                          </p>
                        </Show>
                        <Show
                          when={sql`review_item.external_title is not null or review_item.external_url is not null`}
                        >
                          <p className="text-sm break-words mt-2">
                            {sql`coalesce(review_item.external_title, '') || ' ' || coalesce(review_item.external_url, '')`}
                          </p>
                        </Show>
                        <Show
                          when={sql`review_item.other_course_id is not null or review_item.training_assessment_id is not null`}
                        >
                          <p className="text-sm mt-2">
                            {employeeText(props.uiLanguage, {
                              en: "Linked training is reviewed separately.",
                              es:
                                "La capacitación vinculada se revisa por separado.",
                            })}
                          </p>
                        </Show>
                        <Each
                          table="review_documents"
                          recordName="review_document"
                          where={sql`item_id = review_item.id`}
                        >
                          <div className="mt-3 flex flex-col gap-2">
                            <CourseStepDocument
                              document={sql`review_document`}
                              content={block.opts.content}
                              controlledRevisionId={sql`review_document.id`}
                              nativePdfHref={sql`'/api/training/translation-reviews/' || ui.translation_review_id::string || '/documents/' || review_document.id::string || '/pdf'`}
                              language={props.uiLanguage}
                              fileHref={translationReviewFileHref(
                                sql`ui.translation_review_id`,
                                sql`review_document.file_version_id`,
                              )}
                              externalHref={sql`review_document.external_url`}
                              imageSrcPrefixRewrite={{
                                prefix: sql.lit`/api/files/native-images/`,
                                replacement:
                                  sql`'/api/training/translation-reviews/' || ui.translation_review_id::string || '/documents/' || review_document.id::string || '/native-images/'`,
                              }}
                            />
                            <Show when={sql`review_document.id is null`}>
                              <p className="text-sm">
                                {employeeText(props.uiLanguage, {
                                  en:
                                    "This supporting document has no published version.",
                                  es:
                                    "Este documento de apoyo no tiene una versión publicada.",
                                })}
                              </p>
                            </Show>
                          </div>
                        </Each>
                      </>
                    )
                    : (
                      <>
                        <p className="text-sm whitespace-pre-wrap mt-2">
                          {sql`review_item.help_text`}
                        </p>
                        <ul className="list-disc pl-5">
                          <Each
                            table="review_choices"
                            recordName="review_choice"
                            where={sql`training_assessment_item_id = review_item.id`}
                          >
                            <li className="mt-2 text-sm">
                              <span>
                                {sql`review_choice.content || case when review_choice.is_correct then ${
                                  employeeText(props.uiLanguage, {
                                    en: " (correct)",
                                    es: " (correcta)",
                                  })
                                } else '' end`}
                              </span>
                              <p className="whitespace-pre-wrap">
                                {sql`review_choice.explanation`}
                              </p>
                            </li>
                          </Each>
                        </ul>
                        <Show when={sql`review_item.explanation is not null`}>
                          <p className="text-sm whitespace-pre-wrap mt-2">
                            {sql`${
                              employeeText(props.uiLanguage, {
                                en: "Explanation: ",
                                es: "Explicación: ",
                              })
                            } || review_item.explanation`}
                          </p>
                        </Show>
                        <Show
                          when={sql`review_item.remediation_text is not null`}
                        >
                          <p className="text-sm whitespace-pre-wrap mt-2">
                            {sql`${
                              employeeText(props.uiLanguage, {
                                en: "Remediation: ",
                                es: "Corrección: ",
                              })
                            } || review_item.remediation_text`}
                          </p>
                        </Show>
                      </>
                    )}
                </li>
              </Each>
            </ol>
          </div>
        </Each>
      </section>
    </Data>
  );
}
