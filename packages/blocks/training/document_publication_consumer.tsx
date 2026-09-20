import { sql } from "std/sql_utils";
import type { ServerStatementsBase } from "std/statements";
import type { TrainingBlock } from "./index.tsx";
import type { TrainingContentPublicationEvent } from "./drive_documents.tsx";
import {
  finalizeNewAssignmentsSql,
  insertCurrentDocumentAssignmentTasksSql,
  insertDocumentTasksForAssignmentBatchSql,
  insertTaskItemDocumentSnapshotsSql,
  replaceOpenDocumentAssignmentTasksSql,
  replaceOpenTaskItemDocumentVersionsSql,
} from "./helpers";

function completedCourseDocumentReadersSql(
  block: TrainingBlock,
  event: TrainingContentPublicationEvent,
) {
  const resolvedVersionId = block.opts.content
    .resolveCourseSupportingDocumentVersion({
      documentId: event.documentId,
      assignmentLanguage: sql`assignment.training_language`,
    });
  return sql`
    with ranked_course_readers as (
      select assignment.person_id,
             assignment.training_language,
             date.add(
               day,
               coalesce(document_settings.due_within_days, 7),
               current_date()
             ) as due_date,
             row_number() over (
               partition by assignment.person_id
               order by task.completed_at desc, task.id desc
             ) as reader_rank
      from db.training_task_item_documents snapshot
      join db.training_employee_tasks task
        on task.id = snapshot.training_employee_task_id
      join db.training_assignments assignment
        on assignment.id = task.training_assignment_id
      join db.training_course_section_item_documents source_document
        on source_document.id =
          snapshot.training_course_section_item_document_id
      left join db.training_document_settings document_settings
        on document_settings.document_id = source_document.document_id
      where source_document.document_id = ${event.documentId}
        and task.status = 'completed'
        and snapshot.document_version_id != ${event.versionId}
        and (
          assignment.training_language = ${event.language}
          or exists (
            select 1
            from db.training_content_versions resolved_version
            join db.training_content_language_variants resolved_variant
              on resolved_variant.id =
                resolved_version.document_language_variant_id
            where resolved_version.id = ${resolvedVersionId}
              and resolved_variant.language = ${event.language}
          )
        )
        and not exists (
          select 1
          from db.training_assignments direct_assignment
          join db.training_employee_tasks direct_task
            on direct_task.training_assignment_id = direct_assignment.id
          where direct_assignment.person_id = assignment.person_id
            and direct_assignment.document_id = ${event.documentId}
            and direct_assignment.training_course_id is null
            and direct_task.status in ('assigned', 'in_progress')
        )
    )
    select person_id, training_language, due_date
    from ranked_course_readers
    where reader_rank = 1
  `;
}

function reassignCompletedCourseDocumentReaders(
  s: ServerStatementsBase<any>,
  block: TrainingBlock,
  event: TrainingContentPublicationEvent,
) {
  s.defTable(
    "policy_version_reassignment_candidates",
    completedCourseDocumentReadersSql(block, event),
  );
  s.defTable("policy_version_reassignment_created", {
    fields: [{ name: "assignment_id", type: "BigInt", notNull: true }],
  });
  s.forEachTable(
    "policy_version_reassignment_candidates",
    "policy_reader",
    (s) => {
      s.defScalar("policy_version_assignment_id", { type: "BigInt" });
      s.modify(sql`
        insert into db.training_assignments
          (person_id, document_id, training_language, due_date, reason,
           assignment_source)
        values
          (policy_reader.person_id, ${event.documentId},
           policy_reader.training_language, policy_reader.due_date,
           'Policy updated after course completion',
           'policy_version_reassignment')
        returning id into policy_version_assignment_id
      `);
      s.modify(insertDocumentTasksForAssignmentBatchSql({
        opts: block.opts,
        documentId: event.documentId,
        assignmentWhere: sql`a.id = policy_version_assignment_id`,
        dueDate: sql`policy_reader.due_date`,
      }));
      for (
        const statement of finalizeNewAssignmentsSql({
          opts: block.opts,
          assignmentWhere: sql`a.id = policy_version_assignment_id`,
          actorId: sql`null`,
        })
      ) {
        s.modify(statement);
      }
      s.modify(sql`
        insert into policy_version_reassignment_created (assignment_id)
        values (policy_version_assignment_id)
      `);
    },
  );
  block.publishAssignmentCreatedNotifications(s, {
    assignmentWhere: sql`exists (
      select 1
      from policy_version_reassignment_created created
      where created.assignment_id = a.id
    )`,
  });
}

/** Registers Training's synchronous rollout inside Documents publication. */
export function applyTrainingDocumentPublication(
  s: ServerStatementsBase<any>,
  block: TrainingBlock,
  event: TrainingContentPublicationEvent,
) {
  s.modify(replaceOpenDocumentAssignmentTasksSql({
    opts: block.opts,
    documentId: event.documentId,
    language: event.language,
    newDocumentVersionId: event.versionId,
  }));
  s.modify(insertCurrentDocumentAssignmentTasksSql({
    opts: block.opts,
    documentId: event.documentId,
    language: event.language,
    newDocumentVersionId: event.versionId,
  }));
  s.modify(replaceOpenTaskItemDocumentVersionsSql({
    opts: block.opts,
    documentId: event.documentId,
    newDocumentVersionId: event.versionId,
  }));
  s.modify(insertTaskItemDocumentSnapshotsSql(
    block.opts,
    sql`t.status in ('assigned', 'in_progress')`,
  ));
  s.if(
    sql`coalesce(${event.reassignCourseReaders ?? sql`false`}, false)`,
    (s) => reassignCompletedCourseDocumentReaders(s, block, event),
  );
  block.syncAutomaticAssignmentsForDocument(s, event.documentId);
}

export function registerTrainingDocumentPublicationConsumer(
  block: TrainingBlock,
) {
  block.opts.content.registerPublicationConsumer({
    name: "training",
    publicationConfirmation: (event) => {
      return {
        appliesWhen: sql`true`,
        query: sql`
          select
            affected_reader_count > 0 as required,
            affected_reader_count::string ||
            case when affected_reader_count = 1 then
              ' person completed course work containing the previous policy. '
            else
              ' people completed course work containing the previous policy. '
            end ||
            'You can give them a direct policy-reading assignment for this new revision without making them repeat the course.'
              as description
          from (
            select count(*) as affected_reader_count
            from (${
          completedCourseDocumentReadersSql(block, event)
        }) course_reader
          ) affected_readers
        `,
        title: "Reassign previous course readers?",
        confirmLabel: "Publish and reassign",
        skipLabel: "Publish without reassigning",
      };
    },
    afterVersionPublished: (s, event) =>
      applyTrainingDocumentPublication(s, block, event),
  });
}
