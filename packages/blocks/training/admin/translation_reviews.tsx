import { Alert } from "components/alert";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Each, Show, useUniqueId } from "std/ui";
import type { TrainingBlock } from "../index";
import { BackLink, EmptyState, PageShell } from "../shared";
import { employeeName, employeeText, personTable } from "../helpers";
import {
  translationReviewAccessSql,
  translationReviewerEligibleSql,
  translationReviewerLanguageSql,
  translationReviewHref,
  translationReviewIdSql,
} from "../translation_reviews";
import type { TranslationReviewKind } from "../translation_reviews";
import { TranslationReviewContent } from "./translation_review_content";
import { PersonMultiSelect } from "./shared";

function reviewStateLabel(state: Sql, language: Sql = sql.lit`en`) {
  return sql`case ${state}
    when 'in_review' then ${
    employeeText(language, { en: "In review", es: "En revisión" })
  }
    when 'approved' then ${
    employeeText(language, { en: "Approved", es: "Aprobada" })
  }
    when 'changes_requested' then ${
    employeeText(language, {
      en: "Changes requested",
      es: "Cambios solicitados",
    })
  }
    when 'withdrawn' then ${
    employeeText(language, { en: "Withdrawn", es: "Retirada" })
  }
    else ${
    employeeText(language, { en: "Not submitted", es: "Sin enviar" })
  } end`;
}

export function TranslationReviewPanel(props: {
  block: TrainingBlock;
  kind: TranslationReviewKind;
  recordId: Sql;
  versionId: Sql;
}) {
  const { block, kind } = props;
  return (
    <Data
      watch={[props.versionId]}
      procedure={(s) => {
        s.defRecord(
          "translation_review",
          sql`select * from db.training_translation_review_state
          where id = ${translationReviewIdSql(kind, props.versionId)}`,
        );
        s.defScalar(
          "translation_draft",
          sql`exists (select 1 from db.${sql.ref(`training_${kind}_versions`)}
          where id = ${props.versionId} and status = 'draft')`,
        );
        s.defTable(
          "review_history",
          sql`select r.* from db.training_translation_review_state r
          join db.${sql.ref(`training_${kind}_versions`)} v on v.id = r.${
            sql.ref(`training_${kind}_version_id`)
          }
          where v.${
            sql.ref(`training_${kind}_id`)
          } = ${props.recordId} and v.language = ui.editor_language
          order by r.id desc`,
        );
        s.defScalar(
          "previous_reviewer_people",
          sql`(select string_agg(person.id::string, ',' order by reviewer.position)
            from db.training_translation_reviewers reviewer
            join db.sys_users previous_user on previous_user.id = reviewer.reviewer_id
            join db.${sql.ref(personTable(block.opts))} person on ${
            block.opts.workforce.personSysUserJoin(
              sql`person`,
              sql`previous_user`,
            )
          }
            where reviewer.training_translation_review_id = (select max(id) from review_history)
              and ${
            translationReviewerEligibleSql(
              block.opts.workforce,
              sql`previous_user.id`,
            )
          })`,
        );
      }}
    >
      <Show
        when={sql`ui.editor_language != ${
          sql.lit(block.opts.content.opts.defaultLanguage)
        }
        and (${props.versionId} is not null or exists (select 1 from review_history))`}
      >
        <section
          aria-label="Translation approval"
          className="rounded-md border border-divider p-4 my-3"
        >
          <div className="flex flex-wrap justify-between items-center gap-2">
            <Typography level="title-sm">Translation approval</Typography>
            <Typography level="body-sm">
              {reviewStateLabel(sql`translation_review.state`)}
            </Typography>
          </div>
          <Show
            when={sql`translation_draft and coalesce(translation_review.state in ('in_review', 'approved'), false)`}
          >
            <Typography level="body-sm" className="mt-2">
              {sql`case when translation_review.state = 'approved'
                then 'All reviewers approved. You can publish this translation.'
                else 'Reviewers approve in order. Editing is locked until the review is withdrawn or changes are requested.' end`}
            </Typography>
            <ActionButton
              size="sm"
              variant="outlined"
              color="neutral"
              className="mt-3"
              confirm={{
                description:
                  "Withdraw this review? Existing approvals will no longer allow publication.",
                confirmText: "Withdraw review",
              }}
              action={(s) => {
                s.startTransaction();
                s.callStoredProcedure("training_withdraw_translation_review", {
                  inputScalars: { p_review_id: sql`translation_review.id` },
                });
                s.commitTransaction();
              }}
            >
              Withdraw review
            </ActionButton>
          </Show>
          <Show
            when={sql`translation_draft and not coalesce(translation_review.state in ('in_review', 'approved'), false)`}
          >
            <Data
              local
              watch={[props.versionId, sql`translation_review.id`]}
              procedure={(s) =>
                s.defScalar(
                  "translation_reviewer_people",
                  sql`coalesce(previous_reviewer_people, '')`,
                )}
            >
              <Typography level="body-sm" className="mt-2 mb-3">
                Choose reviewers in approval order. Each receives a notification
                when it is their turn. All must approve before publication.
              </Typography>
              <div className="flex flex-wrap items-start gap-2">
                <PersonMultiSelect
                  block={block}
                  selectedIdsScalar="translation_reviewer_people"
                  preserveSelectionOrder
                  placeholder="Choose reviewers in order"
                  availableItemsQuery={sql`select person.id, ${
                    employeeName(block.opts, sql`person`)
                  } as name, cast(null as string) as description
                    from db.${sql.ref(personTable(block.opts))} person
                    where ${
                    translationReviewerEligibleSql(
                      block.opts.workforce,
                      block.opts.workforce.personSysUserId(sql`person`),
                    )
                  }`}
                />
                <ActionButton
                  size="sm"
                  disabled={sql`translation_reviewer_people = ''`}
                  action={(s) => {
                    s.startTransaction();
                    s.callStoredProcedure(
                      `training_request_${kind}_translation_review`,
                      {
                        inputScalars: {
                          p_version_id: props.versionId,
                          p_reviewer_ids: sql`(select string_agg(${
                            block.opts.workforce.personSysUserId(sql`person`)
                          }::string, ',' order by selected.ordinal)
                          from string.split(translation_reviewer_people, ',') selected
                          join db.${
                            sql.ref(personTable(block.opts))
                          } person on person.id = try_cast(selected.value as bigint))`,
                        },
                      },
                    );
                    s.commitTransaction();
                  }}
                >
                  {sql`case when exists (select 1 from review_history) then 'Resubmit for review' else 'Send for review' end`}
                </ActionButton>
              </div>
            </Data>
          </Show>
          <Show when={sql`exists (select 1 from review_history)`}>
            <div className="flex flex-col gap-1 mt-3">
              <Each table="review_history" recordName="past_review">
                <a
                  className="text-sm text-primary-600 underline"
                  href={translationReviewHref(
                    block.opts,
                    sql`past_review.id`,
                    true,
                  )}
                >
                  {sql`'Review · ' || ${
                    reviewStateLabel(sql`past_review.state`)
                  } || ' · ' || format.date(past_review.requested_at::date, '%b %-d, %Y')`}
                </a>
              </Each>
            </div>
          </Show>
        </section>
      </Show>
    </Data>
  );
}

export function TranslationReviewsPage(
  props: { block: TrainingBlock; admin?: boolean },
) {
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "review_ui_language",
          props.admin
            ? sql.lit`en`
            : translationReviewerLanguageSql(props.block.opts),
        );
        s.defTable(
          "translation_reviews",
          sql`select r.*, r.next_reviewer_id = current_user as is_my_turn from db.training_translation_review_state r
          where ${
            translationReviewAccessSql(props.block.opts.workforce, sql`r.id`)
          }
          order by (r.state = 'in_review' and r.next_reviewer_id = current_user) desc, r.id desc`,
        );
      }}
    >
      <PageShell
        title={employeeText(sql`review_ui_language`, {
          en: "Translation reviews",
          es: "Revisiones de traducción",
        })}
        subtitle={employeeText(sql`review_ui_language`, {
          en:
            "Review the source and translated wording, then approve or request changes.",
          es:
            "Compara el texto original con la traducción y luego aprueba o solicita cambios.",
        })}
      >
        <Show when={sql`not exists (select 1 from translation_reviews)`}>
          <EmptyState
            icon="Translate"
            title={employeeText(sql`review_ui_language`, {
              en: "No translation reviews",
              es: "No hay revisiones de traducción",
            })}
            body={employeeText(sql`review_ui_language`, {
              en: "Reviews assigned to you will appear here.",
              es: "Aquí aparecerán las revisiones que te asignen.",
            })}
          />
        </Show>
        <div className="divide-y divide-divider">
          <Each table="translation_reviews" recordName="review_row">
            <a
              className="flex flex-wrap justify-between gap-3 py-4 text-primary-600 hover:underline"
              href={translationReviewHref(
                props.block.opts,
                sql`review_row.id`,
                props.admin,
              )}
            >
              <span>
                {sql`review_row.name || ' · ' || upper(review_row.language)`}
              </span>
              <span>
                {sql`case when review_row.state = 'in_review' and review_row.is_my_turn
                then ${
                  employeeText(sql`review_ui_language`, {
                    en: "Your review is needed",
                    es: "Se necesita tu revisión",
                  })
                } else ${
                  reviewStateLabel(
                    sql`review_row.state`,
                    sql`review_ui_language`,
                  )
                } end`}
              </span>
            </a>
          </Each>
        </div>
      </PageShell>
    </Data>
  );
}

export function TranslationReviewPage(
  props: { block: TrainingBlock; admin?: boolean },
) {
  const { block } = props;
  const commentsId = useUniqueId();
  return (
    <Data
      watch={[sql`ui.translation_review_id`]}
      procedure={(s) => {
        s.defScalar(
          "review_ui_language",
          props.admin
            ? sql.lit`en`
            : translationReviewerLanguageSql(props.block.opts),
        );
        s.defRecord(
          "review",
          sql`select requested_review.* from db.training_translation_review_state requested_review
          where requested_review.id = ui.translation_review_id and ${
            translationReviewAccessSql(
              block.opts.workforce,
              sql`requested_review.id`,
            )
          }`,
        );
        s.defScalar(
          "review_can_decide",
          sql`review.state = 'in_review' and review.version_status = 'draft' and review.next_reviewer_id = current_user`,
        );
        s.defTable(
          "reviewers",
          sql`select r.*, ${employeeName(block.opts, sql`person`)} as name
          from db.training_translation_reviewers r
          join db.sys_users review_user on review_user.id = r.reviewer_id
          join db.${sql.ref(personTable(block.opts))} person on ${
            block.opts.workforce.personSysUserJoin(
              sql`person`,
              sql`review_user`,
            )
          }
          where r.training_translation_review_id = review.id order by r.position`,
        );
      }}
    >
      <PageShell
        title={employeeText(sql`review_ui_language`, {
          en: "Translation review",
          es: "Revisión de traducción",
        })}
      >
        <BackLink
          href={translationReviewHref(block.opts, undefined, props.admin)}
          label={employeeText(sql`review_ui_language`, {
            en: "Translation reviews",
            es: "Revisiones de traducción",
          })}
        />
        <Show
          when={sql`review.id is null`}
          fallback={
            <div className="flex flex-col gap-5">
              <div>
                <Typography level="h3">{sql`review.name`}</Typography>
                <Typography level="body-sm">
                  {sql`upper(review.language) || ' · ' || ${
                    reviewStateLabel(sql`review.state`, sql`review_ui_language`)
                  }`}
                </Typography>
              </div>
              <section
                aria-label={employeeText(sql`review_ui_language`, {
                  en: "Approval route",
                  es: "Orden de aprobación",
                })}
                className="rounded-md border border-divider p-4"
              >
                <Typography level="title-sm">
                  {employeeText(sql`review_ui_language`, {
                    en: "Approval route",
                    es: "Orden de aprobación",
                  })}
                </Typography>
                <ol className="mt-2 flex flex-col gap-3 list-decimal pl-5">
                  <Each table="reviewers" recordName="reviewer">
                    <li>
                      <Typography level="body-sm">
                        {sql`reviewer.name || ' · ' || case when reviewer.decision = 'approved' then ${
                          employeeText(sql`review_ui_language`, {
                            en: "Approved",
                            es: "Aprobada",
                          })
                        }
                        when reviewer.decision = 'rejected' then ${
                          employeeText(sql`review_ui_language`, {
                            en: "Changes requested",
                            es: "Cambios solicitados",
                          })
                        }
                        when review.state = 'in_review' and reviewer.reviewer_id = review.next_reviewer_id then ${
                          employeeText(sql`review_ui_language`, {
                            en: "Awaiting review",
                            es: "Pendiente de revisión",
                          })
                        }
                        else ${
                          employeeText(sql`review_ui_language`, {
                            en: "Not reviewed",
                            es: "Sin revisar",
                          })
                        } end`}
                      </Typography>
                      <Show when={sql`reviewer.comments is not null`}>
                        <p className="text-sm whitespace-pre-wrap mt-1">
                          {sql`reviewer.comments`}
                        </p>
                      </Show>
                    </li>
                  </Each>
                </ol>
              </section>
              <Typography level="body-sm">
                {employeeText(sql`review_ui_language`, {
                  en:
                    "Compare the recorded source with this translation. Linked courses, assessments and supporting documents have their own publication and review.",
                  es:
                    "Compara el original registrado con esta traducción. Los cursos, evaluaciones y documentos vinculados se publican y revisan por separado.",
                })}
              </Typography>
              {(["course", "assessment"] as const).map((kind) => (
                <Show
                  when={sql`review.${
                    sql.ref(`training_${kind}_version_id`)
                  } is not null`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <TranslationReviewContent
                      block={block}
                      kind={kind}
                      uiLanguage={sql`review_ui_language`}
                      source
                    />
                    <TranslationReviewContent
                      block={block}
                      kind={kind}
                      uiLanguage={sql`review_ui_language`}
                    />
                  </div>
                </Show>
              ))}
              <Show
                when={sql`review_can_decide`}
              >
                <Data
                  local
                  watch={[sql`review.id`]}
                  procedure={(s) =>
                    s.defScalar("translation_review_comments", sql.lit``)}
                >
                  <div className="border-t border-divider pt-4">
                    <FormControl inputId={commentsId}>
                      <FormLabel>
                        {employeeText(sql`review_ui_language`, {
                          en: "Review comments",
                          es: "Comentarios de revisión",
                        })}
                      </FormLabel>
                      <Textarea
                        id={commentsId}
                        maxLength={2000}
                        value={sql`translation_review_comments`}
                        onChange={(s, value) =>
                          s.setScalar("translation_review_comments", value)}
                        placeholder={employeeText(sql`review_ui_language`, {
                          en: "Required when requesting changes",
                          es: "Obligatorio al solicitar cambios",
                        })}
                        minRows={3}
                      />
                    </FormControl>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {(["approved", "changes_requested"] as const).map((
                        decision,
                      ) => (
                        <ActionButton
                          variant={decision === "approved"
                            ? "solid"
                            : "outlined"}
                          color={decision === "approved"
                            ? "primary"
                            : "neutral"}
                          action={(s) => {
                            s.startTransaction();
                            s.callStoredProcedure(
                              "training_decide_translation_review",
                              {
                                inputScalars: {
                                  p_review_id: sql`review.id`,
                                  p_decision: sql.lit(decision),
                                  p_comments: sql`translation_review_comments`,
                                },
                              },
                            );
                            s.commitTransaction();
                          }}
                        >
                          {decision === "approved"
                            ? employeeText(sql`review_ui_language`, {
                              en: "Approve translation",
                              es: "Aprobar traducción",
                            })
                            : employeeText(sql`review_ui_language`, {
                              en: "Request changes",
                              es: "Solicitar cambios",
                            })}
                        </ActionButton>
                      ))}
                    </div>
                  </div>
                </Data>
              </Show>
            </div>
          }
        >
          <Alert color="warning">
            {employeeText(sql`review_ui_language`, {
              en: "This review is unavailable or you do not have access.",
              es: "Esta revisión no está disponible o no tienes acceso.",
            })}
          </Alert>
        </Show>
      </PageShell>
    </Data>
  );
}
