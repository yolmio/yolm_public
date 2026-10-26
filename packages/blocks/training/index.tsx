import {
  registerTranslationReviews,
  renderTranslationReviewFile,
  translationReviewAccessSql,
} from "./translation_reviews";
import { registerTrainingTranslationProcedures } from "./translations";
import {
  registerCourseIntroductionProcedures,
  renderCourseIntroductionImage,
} from "./course_introduction";
import { AuthBlock, userHasPermission } from "blocks/auth";
import type { UserNotificationSourceConfig } from "blocks/user_notifications";
import type { WorkforceProvider } from "blocks/workforce";
import { checkString, sql } from "std/sql_utils";
import { storedScheduledProc } from "std/scheduled_utils";
import type { Sql } from "std/sql_utils";
import type { EndpointStatements, ServerStatementsBase } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";
import { useApp } from "std/ui";
import { ensureLexicalRichTextFunctions } from "components/lexical/components/lexical_scalar_functions";

import type { TrainingBlockOpts } from "./types";
import { taskDerivedStateViewQuery } from "./assessment_helpers";
import { registerTrainingDocumentPublicationConsumer } from "./document_publication_consumer";
import { registerTrainingStoredProcedures } from "./stored_procedures";
import { registerCourseLifecycleStoredProcedures } from "./course_lifecycle";
import { TrainingAdminRoutes } from "./admin/routes";
import { registerCourseEditorStoredProcedures } from "./admin/course_editor";
import { registerAssignmentWorkspaceStoredProcedures } from "./admin/assignment_workspace";
import { registerNotificationStoredProcedures } from "./admin/notifications";
import {
  TrainingAccessRoutes,
  TrainingEmployeeRoutes,
  TrainingEmployeeSidebarMenuItems,
} from "./employee_portal_routes";
import {
  activeCourseVersionSql,
  activeVersionIdSql,
  assignableCourseItemCountSql,
  assignmentInviteLinkSql,
  assignmentLanguageSql,
  assignmentValidationStateViewQuery,
  audienceMatchesEmployeeSql,
  certificationAlertWhereSql,
  certificationTemplateApprovalLabelSql,
  certificationTemplateLogoPathSql,
  certificationTemplateOrganizationNameSql,
  certificationTemplateSealPathSql,
  completedTrainingAssignmentWhereSql,
  currentEmployeeId,
  employeeName,
  finalizeNewAssignmentsSql,
  formatDateSql,
  formatDateTimeSql,
  generatedCertificateHtmlSql,
  insertCertificationsForCompletedAssignmentsSql,
  insertCourseTasksForAssignmentSql,
  insertDocumentTasksForAssignmentBatchSql,
  missingActiveVersionCountSql,
  openTrainingAssignmentWhereSql,
  personEmailSql,
  personLanguageSql,
  personTable,
  personTrainingStatusViewQuery,
  retrainingSourceWithFallbackSql,
  revokeTrainingAccessTokensForClosedAssignmentSql,
  trainingFeatureEnabled,
  trainingPermissions,
  trainingPersonnelDocumentTypesQuery,
  trainingRetrainingSourcesQuery,
  trainingValidationLabels,
} from "./helpers";

const courseItemTypes = {
  essay: checkString("essay"),
  otherChecklist: checkString("other_checklist"),
  practical: checkString("practical"),
  signature: checkString("signature"),
  externalLink: checkString("external_link"),
  assessment: checkString("assessment"),
};

const assessmentAttemptStatuses = {
  complete: checkString("complete"),
  cancelled: checkString("cancelled"),
};

const assessmentItemTypes = {
  multipleChoice: checkString("multiple_choice"),
};

const assessmentScoringModes = {
  partialCredit: checkString("partial_credit"),
};

const assessmentSelectionModes = {
  single: checkString("single"),
  multiple: checkString("multiple"),
};

const taskStatuses = {
  completed: checkString("completed"),
  waived: checkString("waived"),
};

const notificationRuleEvents = {
  assignmentCreated: checkString("assignment_created"),
  reminder: checkString("reminder"),
  overdue: checkString("overdue"),
};

export const trainingNotificationSourceKey = "training.assignment";

export function trainingNotificationSourceConfig(
  args: { workforce: WorkforceProvider; resolveHref?: (href: Sql) => Sql },
): UserNotificationSourceConfig {
  return {
    key: trainingNotificationSourceKey,
    displayName: "Training",
    destination: {
      href: (notification) =>
        args.resolveHref?.(sql`${notification}.href`) ??
          sql`${notification}.href`,
    },
    canUserAccess: ({ userId, recordKey }) =>
      sql`(${
        translationReviewAccessSql(
          args.workforce,
          sql`case when ${recordKey} like 'translation-review:%' then try_cast(substring(${recordKey} from 20) as bigint) end`,
          userId,
        )
      }) or exists (
        select 1
        from db.training_assignments assignment
        join db.${sql.ref(args.workforce.personTable)} person
          on person.id = assignment.person_id
        where assignment.id = try_cast(${recordKey} as bigint)
          and ${args.workforce.personSysUserId(sql`person`)} = ${userId}
      )`,
    emailContext: (notification) =>
      sql`${notification}.payload->>'trainingModuleName'`,
    email: {
      delivery: "immediate",
      subject: (notification) => sql`${notification}.payload->>'emailSubject'`,
      htmlBody: (notification) =>
        sql`${notification}.payload->>'emailHtmlBody'`,
      textBody: (notification) => sql`${notification}.body`,
    },
  };
}

export interface TrainingEndpointsProps {
  training: TrainingBlock;
}

export class TrainingBlock implements Block {
  blockName = "TrainingBlock";
  /**
   * Training registers fixed schema, procedure, reactor, and API names, so a
   * system can contain only one instance. Keeping that invariant explicit also
   * makes the module-scoped date format registration safe.
   */
  static #hasInstance = false;

  /**
   * Installs the authenticated `/api/training/*` endpoints on the app
   * currently being rendered. Include it in every app that renders training
   * document, certificate, or employee-file URLs.
   */
  static Endpoints(props: TrainingEndpointsProps) {
    const app = useApp();
    props.training.registerAppEndpoints(app.domain);
    return [];
  }
  static permissions = [
    {
      name: "can_manage_training_document_settings",
      displayName: "Manage Training Document Settings",
      description: "Manage document-specific Training settings and audiences.",
      group: "Training",
    },
    {
      name: "can_assign_training",
      displayName: "Assign Training",
      description: "Assign training documents and courses to employees.",
      group: "Training",
    },
    {
      name: "can_validate_training",
      displayName: "Validate Training",
      description: "Approve employee training completions.",
      group: "Training",
    },
    {
      name: "can_sign_primary_training_validator",
      displayName: "Primary Training Validator Sign-Off",
      description: "Sign primary course and section validation attestations.",
      group: "Training",
    },
    {
      name: "can_sign_secondary_training_validator",
      displayName: "Secondary Training Validator Sign-Off",
      description: "Sign secondary course validation attestations.",
      group: "Training",
    },
    {
      name: "can_view_employee_training_files",
      displayName: "View Employee Training Files",
      description: "View employee training history and personnel documents.",
      group: "Training",
    },
    {
      name: "can_manage_employee_training_files",
      displayName: "Manage Employee Training Files",
      description:
        "Create and update employee compliance and personnel records.",
      group: "Training",
    },
    {
      name: "can_manage_training_notifications",
      displayName: "Manage Training Notifications",
      description: "Manage training notification templates and rules.",
      group: "Training",
    },
    {
      name: "can_manage_training_courses",
      displayName: "Manage Training Courses",
      description: "Create, version, and edit training courses.",
      group: "Training",
    },
    {
      name: "can_publish_training_courses",
      displayName: "Publish Training Courses",
      description: "Publish approved training course versions.",
      group: "Training",
    },
    {
      name: "can_manage_training_assessments",
      displayName: "Manage Training Assessments",
      description: "Create, edit, and version training assessments.",
      group: "Training",
    },
    {
      name: "can_publish_training_assessments",
      displayName: "Publish Training Assessments",
      description: "Publish training assessment versions.",
      group: "Training",
    },
    {
      name: "can_review_training_assessments",
      displayName: "Review Training Assessments",
      description: "Review submitted assessment attempts and responses.",
      group: "Training",
    },
    {
      name: "can_record_training_evaluations",
      displayName: "Record Training Evaluations",
      description: "Run and record trainer-recorded evaluations.",
      group: "Training",
    },
    {
      name: "can_override_assessment_outcomes",
      displayName: "Override Assessment Outcomes",
      description: "Override assessment attempt outcomes and retake policy.",
      group: "Training",
    },
  ];

  #endpointDomains = new Set<string>();

  constructor(public opts: TrainingBlockOpts) {
    if (TrainingBlock.#hasInstance) {
      throw new Error(
        "TrainingBlock supports a single instance per system. Construct it " +
          "once and reuse it across apps.",
      );
    }
    if (opts.notifications?.config.key !== trainingNotificationSourceKey) {
      throw new Error(
        `TrainingBlock requires the ${trainingNotificationSourceKey} user notification source.`,
      );
    }
    if (
      opts.completionAttestation !== undefined &&
      (
        opts.completionAttestation.trim().length === 0 ||
        opts.completionAttestation.length > 1000
      )
    ) {
      throw new Error(
        "TrainingBlock completionAttestation must contain 1 to 1000 characters.",
      );
    }
    if (trainingFeatureEnabled(opts, "compliance")) {
      if (!opts.retrainingSources?.length) {
        throw new Error(
          "TrainingBlock requires at least one retraining source when compliance is enabled.",
        );
      }
      if (
        new Set(opts.retrainingSources.map((source) => source.code)).size !==
          opts.retrainingSources.length
      ) {
        throw new Error(
          "TrainingBlock retraining source codes must be unique.",
        );
      }
      if (!opts.personnelDocumentTypes?.length) {
        throw new Error(
          "TrainingBlock requires at least one personnel document type when compliance is enabled.",
        );
      }
      if (
        new Set(opts.personnelDocumentTypes.map((type) => type.code)).size !==
          opts.personnelDocumentTypes.length
      ) {
        throw new Error(
          "TrainingBlock personnel document type codes must be unique.",
        );
      }
    }
    TrainingBlock.#hasInstance = true;
  }

  assertCanAssignTraining(s: ServerStatementsBase<any>) {
    s.throwErrorIf(
      sql`not ${
        userHasPermission(
          sql.lit(trainingPermissions.assignTraining),
          sql`current_user`,
        )
      }`,
      sql.lit`You do not have permission to assign Training.`,
    );
  }

  assertCanManageEmployeeFiles(s: ServerStatementsBase<any>) {
    s.throwErrorIf(
      sql`not ${
        userHasPermission(
          sql.lit(trainingPermissions.manageEmployeeFiles),
          sql`current_user`,
        )
      }`,
      sql.lit`You do not have permission to manage employee Training files.`,
    );
  }

  waiveDocumentTask(
    s: ServerStatementsBase<any>,
    args: { taskId: Sql; reason: Sql },
  ) {
    this.assertCanAssignTraining(s);
    s.throwErrorIf(
      sql`nullif(trim(${args.reason}), '') is null`,
      sql.lit`Enter a waiver reason.`,
    );
    s.defScalar(
      "waived_training_assignment_id",
      sql`(
        select assignment.id
        from db.training_employee_tasks task
        join db.training_assignments assignment
          on assignment.id = task.training_assignment_id
        where task.id = ${args.taskId}
          and task.status in ('assigned', 'in_progress')
          and assignment.document_id is not null
          and assignment.training_course_id is null
      )`,
    );
    s.throwErrorIf(
      sql`waived_training_assignment_id is null`,
      sql.lit`This document assignment is no longer open.`,
    );
    s.startTransaction();
    s.modify(sql`
      update db.training_employee_tasks
      set
        status = 'waived',
        waived_by_id = ${currentEmployeeId(this.opts)},
        waived_at = now(),
        waiver_reason = trim(${args.reason})
      where id = ${args.taskId}
        and training_assignment_id = waived_training_assignment_id
        and status in ('assigned', 'in_progress')
    `);
    s.modify(sql`
      update db.training_assignments
      set status = 'waived'
      where id = waived_training_assignment_id
        and not exists (
          select 1
          from db.training_employee_tasks remaining_task
          where remaining_task.training_assignment_id =
            waived_training_assignment_id
            and remaining_task.status != 'waived'
        )
    `);
    if (trainingFeatureEnabled(this.opts, "inviteAccess")) {
      s.modify(revokeTrainingAccessTokensForClosedAssignmentSql({
        opts: this.opts,
        assignmentId: sql`waived_training_assignment_id`,
      }));
    }
    s.commitTransaction();
  }

  /** Upserts a document's Training settings; the caller owns the transaction. */
  updateTrainingDocumentSettings(
    s: ServerStatementsBase<any>,
    args: {
      documentId: Sql;
      requiresEssay: Sql;
      defaultEssayPrompt?: Sql;
      dueWithinDays: Sql;
      reminderAfterDays: Sql;
      reminderRepeatEveryDays: Sql;
      overdueAfterDays: Sql;
      overdueRepeatEveryDays: Sql;
    },
  ) {
    s.throwErrorIf(
      sql`not ${
        userHasPermission(
          sql.lit`can_manage_training_document_settings`,
          sql`current_user`,
        )
      }`,
      sql.lit`You do not have permission to update Training settings.`,
    );
    s.throwErrorIf(
      sql`not exists (
        select 1 from db.training_content_documents
        where id = ${args.documentId} and is_active
          and ${
        this.opts.content.canReadDocument(args.documentId, sql`current_user`)
      }
      )`,
      sql.lit`Training settings can be changed only on an active document.`,
    );
    s.modify(sql`insert into db.training_document_settings
      (document_id, requires_essay, default_essay_prompt,
       due_within_days, reminder_after_days, reminder_repeat_every_days,
       overdue_after_days, overdue_repeat_every_days)
      values (
        ${args.documentId},
        ${args.requiresEssay},
        nullif(trim(coalesce(${args.defaultEssayPrompt ?? sql`null`}, '')), ''),
        ${args.dueWithinDays},
        ${args.reminderAfterDays},
        ${args.reminderRepeatEveryDays},
        ${args.overdueAfterDays},
        ${args.overdueRepeatEveryDays}
      )
      on conflict (document_id) do update set
        requires_essay = excluded.requires_essay,
        default_essay_prompt = excluded.default_essay_prompt,
        due_within_days = excluded.due_within_days,
        reminder_after_days = excluded.reminder_after_days,
        reminder_repeat_every_days = excluded.reminder_repeat_every_days,
        overdue_after_days = excluded.overdue_after_days,
        overdue_repeat_every_days = excluded.overdue_repeat_every_days`);
  }

  getNotificationTemplateVariables() {
    return {
      employee_name: "Person display name",
      employee_email: "Person email address",
      employee_language: "Person preferred language",
      training_module_name: "Assigned document or course name",
      training_access_link:
        "Scoped link for a trainee to complete the assignment without a login",
      training_course_name: "Assigned course name, when applicable",
      document_title: "Assigned document title, when applicable",
      assignment_reason: "Assignment reason",
      due_date: "Assignment due date",
      assigned_at: "Assignment timestamp",
    };
  }

  private getNotificationTemplateScope() {
    return {
      employee_name: "employee_name",
      employee_email: "employee_email",
      employee_language: "employee_language",
      training_module_name: "training_module_name",
      training_access_link: "training_access_link",
      training_course_name: "training_course_name",
      document_title: "document_title",
      assignment_reason: "assignment_reason",
      due_date: "due_date",
      assigned_at: "assigned_at",
    };
  }

  private setupNotificationTemplateScope(
    s: ServerStatementsBase<any>,
    opts: { personRecord: Sql; assignmentRecord: Sql },
  ) {
    s.defScalar(
      "employee_name",
      employeeName(this.opts, opts.personRecord),
    );
    s.defScalar("employee_email", {
      expr: sql`coalesce(${personEmailSql(this.opts, opts.personRecord)}, '')`,
      allowNoRead: true,
    });
    s.defScalar("employee_language", {
      expr: sql`coalesce(${
        personLanguageSql(this.opts, opts.personRecord)
      }, '')`,
      allowNoRead: true,
    });
    s.defScalar(
      "training_module_name",
      sql`coalesce(
      (select name from db.training_courses
       where id = ${opts.assignmentRecord}.training_course_id),
      (select title from db.training_content_documents
       where id = ${opts.assignmentRecord}.document_id),
      'Training assignment'
    )`,
    );
    s.defScalar("training_access_link", {
      expr: sql`coalesce(${
        assignmentInviteLinkSql(
          this.opts,
          sql`${opts.assignmentRecord}.id`,
        )
      }, '')`,
      allowNoRead: true,
    });
    s.defScalar("training_course_name", {
      expr: sql`coalesce(
        (select name from db.training_courses
         where id = ${opts.assignmentRecord}.training_course_id),
        ''
      )`,
      allowNoRead: true,
    });
    s.defScalar("document_title", {
      expr: sql`coalesce(
        (select title from db.training_content_documents
         where id = ${opts.assignmentRecord}.document_id),
        ''
      )`,
      allowNoRead: true,
    });
    s.defScalar("assignment_reason", {
      expr: sql`coalesce(${opts.assignmentRecord}.reason, '')`,
      allowNoRead: true,
    });
    s.defScalar("due_date", {
      expr: sql`coalesce(${
        formatDateSql(sql`${opts.assignmentRecord}.due_date`)
      }, '')`,
      allowNoRead: true,
    });
    s.defScalar(
      "assigned_at",
      formatDateTimeSql(sql`${opts.assignmentRecord}.assigned_at`),
    );
  }

  private notificationHref(assignment: Sql) {
    const base = this.opts.routes?.employeeBasePath ?? "/training";
    return sql`case
      when ${assignment}.training_course_id is not null then
        ${sql.lit(`${base}/courses/`)} || ${assignment}.id::string
      else ${sql.lit(`${base}/tasks/`)} || (
        select min(task.id)::string
        from db.training_employee_tasks task
        where task.training_assignment_id = ${assignment}.id
      )
    end`;
  }

  private publishNotification(
    s: ServerStatementsBase<any>,
    args: {
      assignmentId: Sql;
      eventCode: Sql;
      templateId: Sql;
      ruleId?: Sql;
      message?: Sql;
    },
  ) {
    s.defRecord(
      "training_notification_assignment",
      sql`select *
        from db.training_assignments
        where id = ${args.assignmentId}`,
    );
    s.defRecord("training_notification_person", {
      query: sql`select *
        from db.${sql.ref(personTable(this.opts))}
        where id = training_notification_assignment.person_id`,
      allowNoRead: true,
    });
    s.defRecord("training_notification_template", {
      query: sql`select *
        from db.training_notification_templates
        where id = ${args.templateId}`,
      allowNoRead: true,
    });
    this.setupNotificationTemplateScope(s, {
      personRecord: sql.ref("training_notification_person"),
      assignmentRecord: sql.ref("training_notification_assignment"),
    });
    s.defScalar("rendered_training_notification_body", sql.lit``);
    s.renderTemplate({
      template: sql`coalesce(
        ${args.message ?? sql`cast(null as string)`},
        training_notification_template.portal_body,
        'A training item needs your attention.'
      )`,
      setOutputScalar: "rendered_training_notification_body",
      scope: this.getNotificationTemplateScope(),
      htmlEscaped: false,
    });
    s.renderTemplate({
      template: sql`coalesce(
        training_notification_template.email_subject,
        'Training: ' || training_module_name
      )`,
      defOutputScalar: "rendered_training_notification_email_subject",
      scope: this.getNotificationTemplateScope(),
      htmlEscaped: false,
    });
    s.renderTemplate({
      template: sql`coalesce(
        case
          when training_notification_template.email_body is not null then
            lexical_rich_text_to_html_email(
              training_notification_template.email_body
            )
        end,
        ${args.message ?? sql`cast(null as string)`},
        training_notification_template.portal_body,
        'A training item needs your attention.'
      )`,
      defOutputScalar: "rendered_training_notification_email_html",
      scope: this.getNotificationTemplateScope(),
      htmlEscaped: true,
    });
    this.opts.notifications.publish(s, {
      recordKey: args.assignmentId,
      recipientsQuery: sql`
        select ${
        this.opts.workforce.personSysUserId(sql`person`)
      } as recipient_user_id
        from db.${sql.ref(personTable(this.opts))} person
        where person.id = training_notification_assignment.person_id
      `,
      title: sql`training_module_name`,
      body: sql`rendered_training_notification_body`,
      href: this.notificationHref(sql`training_notification_assignment`),
      payload: sql`json_build_object(
        'eventCode', ${args.eventCode},
        'ruleId', ${args.ruleId ?? sql`null`},
        'trainingModuleName', training_module_name,
        'emailSubject', rendered_training_notification_email_subject,
        'emailHtmlBody', rendered_training_notification_email_html
      )`,
    });
  }

  /**
   * Registers `training_publish_assignment_notification`: the single
   * compiled body for the notification render + publish machinery. The
   * `p_notification_scope` input table carries one row per assignment/event
   * to publish. Rows marked `direct` publish exactly once with the given
   * template (nullable — `p_message` then carries the body) and rule id;
   * non-direct rows fan out to every active rule for their `event_code`
   * that has not already published for the assignment. The internal loop only runs inline statements, so the
   * cursor never suspends into a nested procedure call.
   */
  private registerNotificationPublicationProcedure() {
    system.storedProcedure({
      name: "training_publish_assignment_notification",
      transaction: "caller",
      inputScalars: [
        { name: "p_message", type: { type: "String", maxLength: 2000 } },
      ],
      inputTables: [
        {
          name: "p_notification_scope",
          fields: [
            { name: "assignment_id", type: "BigInt" },
            { name: "event_code", type: { type: "String", maxLength: 120 } },
            { name: "template_id", type: "BigInt" },
            { name: "rule_id", type: "BigInt" },
            { name: "direct", type: "Bool" },
          ],
        },
      ],
      procedure: (s) => {
        s.defTable("assignment_notification_candidates", {
          fields: [
            { name: "assignment_id", type: "BigInt", notNull: true },
            {
              name: "event_code",
              type: { type: "String", maxLength: 120 },
              notNull: true,
            },
            { name: "rule_id", type: "BigInt" },
            { name: "template_id", type: "BigInt" },
          ],
        });
        s.modify(sql`
          insert into assignment_notification_candidates
            (assignment_id, event_code, rule_id, template_id)
          select scope.assignment_id, scope.event_code, scope.rule_id,
                 scope.template_id
          from p_notification_scope scope
          where coalesce(scope.direct, false)
            and exists (
              select 1
              from db.training_assignments a
              where a.id = scope.assignment_id
            )
        `);
        s.modify(sql`
          insert into assignment_notification_candidates
            (assignment_id, event_code, rule_id, template_id)
          select scope.assignment_id, scope.event_code, rule.id,
                 rule.training_notification_template_id
          from p_notification_scope scope
          join db.training_notification_rules rule
            on rule.is_active
           and rule.event_code = scope.event_code
          join db.training_notification_templates template
            on template.id = rule.training_notification_template_id
           and template.is_active
          where not coalesce(scope.direct, false)
            and exists (
              select 1
              from db.training_assignments a
              where a.id = scope.assignment_id
            )
            and not exists (
              select 1
              from db.user_notifications existing
              where existing.source = ${
          sql.lit(this.opts.notifications.config.key)
        }
                and existing.record_key = scope.assignment_id::string
                and existing.payload->>'eventCode' = scope.event_code
                and try_cast(existing.payload->>'ruleId' as bigint) = rule.id
            )
        `);
        s.forEachTable(
          "assignment_notification_candidates",
          "assignment_notification_candidate",
          (s) => {
            this.publishNotification(s, {
              assignmentId:
                sql`assignment_notification_candidate.assignment_id`,
              eventCode: sql`assignment_notification_candidate.event_code`,
              templateId: sql`assignment_notification_candidate.template_id`,
              ruleId: sql`assignment_notification_candidate.rule_id`,
              message: sql`p_message`,
            });
          },
        );
      },
    });
  }

  /**
   * Emits a scope table + single `training_publish_assignment_notification`
   * call. Wrapped in a nested block so one procedure can publish several
   * times (the binding requires the caller table to carry the parameter
   * name), and callers never hold a cursor open across the procedure call.
   */
  private publishNotificationsForScope(
    s: ServerStatementsBase<any>,
    args: { scopeRowsSql: Sql; message?: Sql },
  ) {
    s.block((s) => {
      s.defTable("p_notification_scope", {
        fields: [
          { name: "assignment_id", type: "BigInt" },
          { name: "event_code", type: { type: "String", maxLength: 120 } },
          { name: "template_id", type: "BigInt" },
          { name: "rule_id", type: "BigInt" },
          { name: "direct", type: "Bool" },
        ],
      });
      s.modify(sql`
        insert into p_notification_scope
          (assignment_id, event_code, template_id, rule_id, direct)
        ${args.scopeRowsSql}
      `);
      s.callStoredProcedure("training_publish_assignment_notification", {
        inputScalars: {
          p_message: args.message ?? sql`null`,
        },
        inputTables: {
          p_notification_scope: "p_notification_scope",
        },
      });
    });
  }

  publishAssignmentCreatedNotifications(
    s: ServerStatementsBase<any>,
    args: {
      assignmentWhere: Sql;
    },
  ) {
    this.publishNotificationsForScope(s, {
      scopeRowsSql: sql`
        select a.id, 'assignment_created', null, null, false
        from db.training_assignments a
        where ${args.assignmentWhere}
      `,
    });
  }

  publishNudgeNotifications(
    s: ServerStatementsBase<any>,
    args: {
      assignmentsQuery: Sql;
      message: Sql;
      templateId: Sql;
    },
  ) {
    this.publishNotificationsForScope(s, {
      scopeRowsSql: sql`
        select distinct candidate.assignment_id, 'nudge',
               ${args.templateId}, null, true
        from (${args.assignmentsQuery}) candidate
      `,
      message: args.message,
    });
  }

  /**
   * Body of `training_apply_automatic_assignments_from_scope`. The
   * requirement scope arrives as the `p_requirement_scope` input table
   * (requirement ids to reconcile): the nightly job passes every active
   * requirement, the publication/rule-change path passes only the requested
   * document's requirements, so the document-scoped plan keeps pruning on
   * the small scope instead of a runtime OR predicate.
   */
  private appendAutomaticAssignments(
    s: ServerStatementsBase<any>,
  ) {
    const opts = this.opts;
    // Audience membership is the expensive part of requirement matching.
    // Resolve it once per active audience instead of once per
    // requirement/person pair; requirements that apply to everyone still
    // produce their unavoidable requirement/person candidate rows below.
    s.defTable(
      "auto_assignment_audience_people",
      sql`
            select distinct audience.id as audience_id,
                   e.id as person_id,
                   ${personLanguageSql(opts, sql`e`)} as employee_language
            from db.training_audiences audience
            join db.${sql.ref(personTable(opts))} e on true
            where audience.is_active
              and ${audienceMatchesEmployeeSql(opts, sql`audience`, sql`e`)}
              and exists (
                select 1
                from db.training_requirement_audiences requirement_audience
                join db.training_requirements requirement
                  on requirement.id =
                    requirement_audience.training_requirement_id
                 and requirement.is_active
                where requirement_audience.training_audience_id = audience.id
                  and exists (
                    select 1
                    from p_requirement_scope scope
                    where scope.requirement_id = requirement.id
                  )
              )
          `,
    );
    // Explicit materialized candidate table: the loop below suspends into
    // stored procedure calls, which breaks cursors backed by lazy query
    // CTEs.
    s.defTable("auto_assignment_candidates", {
      fields: [
        { name: "person_id", type: "BigInt", notNull: true },
        { name: "document_id", type: "BigInt" },
        { name: "training_course_id", type: "BigInt" },
        {
          name: "assignment_language",
          type: { type: "Enum", enum: "controlled_file_language" },
          notNull: true,
        },
        { name: "requirement_id", type: "BigInt", notNull: true },
        { name: "due_date", type: "Date", notNull: true },
        {
          name: "assignment_reason_code",
          type: { type: "String", maxLength: 40 },
          notNull: true,
        },
        {
          name: "requirement_name",
          type: { type: "String", maxLength: 200 },
          notNull: true,
        },
      ],
    });
    s.modify(
      sql`
            insert into auto_assignment_candidates
              (person_id, document_id, training_course_id,
               assignment_language, requirement_id, due_date,
               assignment_reason_code, requirement_name)
            with requirement_audience_counts as (
              select requirement_audience.training_requirement_id,
                     count(*) as audience_count
              from db.training_requirement_audiences requirement_audience
              group by requirement_audience.training_requirement_id
            ),
            active_requirements as (
              select r.id as requirement_id, r.name as requirement_name,
                     r.document_id, r.training_course_id,
                     r.training_language,
                     coalesce(
                       document_settings.due_within_days,
                       course.due_within_days,
                       7
                     ) as due_within_days,
                     r.renewal_interval_days, r.expiration_warning_days,
                     r.requires_reassignment_on_new_version,
                     coalesce(audience_counts.audience_count, 0) as audience_count
              from db.training_requirements r
              left join requirement_audience_counts audience_counts
                on audience_counts.training_requirement_id = r.id
              left join db.training_document_settings document_settings
                on document_settings.document_id = r.document_id
              left join db.training_content_documents document
                on document.id = r.document_id
              left join db.training_courses course
                on course.id = r.training_course_id
              where r.is_active
                and (r.training_course_id is null or course.is_active)
                and exists (
                  select 1
                  from p_requirement_scope scope
                  where scope.requirement_id = r.id
                )
                and (
                  r.document_id is null
                  or document.is_active
                )
            ),
            requirement_people as (
              select r.requirement_id, r.requirement_name,
                     r.document_id, r.training_course_id,
                     r.training_language,
                     false as has_specific_audience,
                     r.audience_count, r.due_within_days,
                     r.renewal_interval_days, r.expiration_warning_days,
                     r.requires_reassignment_on_new_version,
                     e.id as person_id,
                     ${personLanguageSql(opts, sql`e`)} as employee_language
              from active_requirements r
              join db.${sql.ref(personTable(opts))} e on true
              where r.audience_count = 0

              union all

              select distinct r.requirement_id, r.requirement_name,
                     r.document_id, r.training_course_id,
                     r.training_language,
                     true as has_specific_audience,
                     r.audience_count, r.due_within_days,
                     r.renewal_interval_days, r.expiration_warning_days,
                     r.requires_reassignment_on_new_version,
                     audience_person.person_id,
                     audience_person.employee_language
              from active_requirements r
              join db.training_requirement_audiences requirement_audience
                on requirement_audience.training_requirement_id =
                  r.requirement_id
              join auto_assignment_audience_people audience_person
                on audience_person.audience_id =
                  requirement_audience.training_audience_id
              where r.audience_count > 0
            ),
            assignment_language_base as (
              select rp.*,
                     ${
        assignmentLanguageSql(
          opts,
          sql`coalesce(rp.training_language, rp.employee_language)`,
        )
      } as assignment_language
              from requirement_people rp
            ),
            assignment_base as (
              select language_base.*,
                     case
                       when language_base.document_id is not null then (
                         select max(t.completed_at)
                         from db.training_employee_tasks t
                         join db.training_assignments a
                           on a.id = t.training_assignment_id
                         where a.person_id = language_base.person_id
                           and a.document_id = language_base.document_id
                           and a.training_language = language_base.assignment_language
                           and ${completedTrainingAssignmentWhereSql(sql`a`)}
                           and t.status = 'completed'
                       )
                       else (
                         select max(t.completed_at)
                         from db.training_assignments a
                         join db.training_employee_tasks t
                           on t.training_assignment_id = a.id
                         where a.person_id = language_base.person_id
                           and a.training_course_id = language_base.training_course_id
                           and a.training_language = language_base.assignment_language
                           and a.assignment_source != 'policy_version_reassignment'
                           and ${completedTrainingAssignmentWhereSql(sql`a`)}
                           and t.status = 'completed'
                       )
                     end as last_completed_at,
                     exists (
                       select 1
                       from db.training_assignments a
                       where a.person_id = language_base.person_id
                         and ${openTrainingAssignmentWhereSql(sql`a`)}
                         and (
                           (language_base.document_id is not null
                            and a.document_id = language_base.document_id
                            and a.training_language = language_base.assignment_language)
                           or
                           (language_base.training_course_id is not null
                            and a.training_course_id = language_base.training_course_id
                            and a.training_language = language_base.assignment_language)
                         )
                     ) as has_open_assignment,
                     case
                       when language_base.document_id is null then null
                       else ${
        activeVersionIdSql(
          sql`language_base.document_id`,
          sql`language_base.assignment_language`,
          opts,
        )
      }
                     end as active_document_version_id,
                     case
                       when language_base.document_id is null then null
                       else (
                         select t.document_version_id
                         from db.training_employee_tasks t
                         join db.training_assignments a
                           on a.id = t.training_assignment_id
                         where a.person_id = language_base.person_id
                           and a.document_id = language_base.document_id
                           and a.training_language = language_base.assignment_language
                           and ${completedTrainingAssignmentWhereSql(sql`a`)}
                           and t.status = 'completed'
                         order by t.completed_at desc, t.id desc
                         limit 1
                       )
                     end as last_completed_version_id,
                     case
                       when language_base.training_course_id is null then null
                       else ${
        activeCourseVersionSql(
          sql`language_base.training_course_id`,
          sql`language_base.assignment_language`,
        )
      }
                     end as active_course_version_id,
                     case
                       when language_base.training_course_id is null then null
                       else (
                         select coalesce(a.training_course_version_id, root_section.training_course_version_id)
                         from db.training_assignments a
                         join db.training_employee_tasks root_task
                           on root_task.training_assignment_id = a.id
                         join db.training_course_section_items root_item
                           on root_item.id = root_task.training_course_section_item_id
                         join db.training_course_sections root_section
                           on root_section.id = root_item.training_course_section_id
                         join db.training_course_versions root_version
                           on root_version.id = root_section.training_course_version_id
                          and root_version.training_course_id = language_base.training_course_id
                         where a.person_id = language_base.person_id
                           and a.training_course_id = language_base.training_course_id
                           and a.training_language = language_base.assignment_language
                           and a.assignment_source != 'policy_version_reassignment'
                           and root_task.status = 'completed'
                           and not exists (
                             select 1
                             from db.training_employee_tasks missing_task
                             where missing_task.training_assignment_id = a.id
                               and missing_task.status in ('assigned', 'in_progress')
                           )
                         order by root_task.completed_at desc, root_task.id desc
                         limit 1
                       )
                     end as last_completed_course_version_id
              from assignment_language_base language_base
            ),
            assignment_status as (
              select *,
                     date.add(day, due_within_days, current_date()) as due_date,
                     case
                       when last_completed_at is null then 'missing'
                       when requires_reassignment_on_new_version
                            and document_id is not null
                            and active_document_version_id is not null
                            and active_document_version_id != coalesce(last_completed_version_id, 0)
                         then 'version_update'
                       when requires_reassignment_on_new_version
                            and training_course_id is not null
                            and active_course_version_id is not null
                            and active_course_version_id != coalesce(last_completed_course_version_id, 0)
                         then 'version_update'
                       when renewal_interval_days is not null
                            and date.add(day, renewal_interval_days, cast(last_completed_at as date))
                              <= date.add(day, expiration_warning_days, current_date())
                         then 'renewal'
                       else 'current'
                     end as assignment_reason_code
              from assignment_base
            ),
            assignment_candidates as (
              select *
              from assignment_status
              where not has_open_assignment
                and not exists (
                  select 1 from db.training_assignments withdrawn
                  where withdrawn.status = 'waived'
                    and withdrawn.person_id = assignment_status.person_id
                    and withdrawn.training_course_id = assignment_status.training_course_id
                    and withdrawn.training_language = assignment_status.assignment_language
                    and withdrawn.training_course_version_id = assignment_status.active_course_version_id
                    and (
                      assignment_status.last_completed_at is null
                      or coalesce((
                        select max(task.waived_at)
                        from db.training_employee_tasks task
                        where task.training_assignment_id = withdrawn.id
                      ), withdrawn.assigned_at) >= assignment_status.last_completed_at
                    )
                )
                and assignment_reason_code in ('missing', 'renewal', 'version_update')
                and (
                  (
                    document_id is not null
                    and active_document_version_id is not null
                  )
                  or
                  (
                    training_course_id is not null
                    and ${
        missingActiveVersionCountSql(
          sql`assignment_status.training_course_id`,
          sql`assignment_status.assignment_language`,
        )
      } = 0
                    and ${
        assignableCourseItemCountSql(
          sql`assignment_status.training_course_id`,
          sql`assignment_status.assignment_language`,
        )
      } > 0
                  )
                )
            ),
            ranked_assignment_candidates as (
              select *,
                     row_number() over (
                       partition by person_id,
                                    document_id,
                                    training_course_id,
                                    assignment_language
                       order by case when has_specific_audience then 0 else 1 end,
                                audience_count,
                                due_date,
                                case when requires_reassignment_on_new_version then 0 else 1 end,
                                case when renewal_interval_days is null then 1 else 0 end,
                                renewal_interval_days,
                                expiration_warning_days desc,
                                case assignment_reason_code
                                  when 'version_update' then 0
                                  when 'renewal' then 1
                                  when 'missing' then 2
                                  else 3
                                end,
                                requirement_name,
                                requirement_id
                     ) as candidate_rank
              from assignment_candidates
            )
            select person_id, document_id, training_course_id,
                   assignment_language, requirement_id, due_date,
                   assignment_reason_code, requirement_name
            from ranked_assignment_candidates
            where candidate_rank = 1
          `,
    );
    s.defTable("auto_created_assignments", {
      fields: [{ name: "assignment_id", type: "BigInt", notNull: true }],
    });
    s.forEachTable("auto_assignment_candidates", "candidate", (s) => {
      s.defScalar("auto_assignment_id", { type: "BigInt" });
      s.if(
        sql`candidate.document_id is not null`,
        (s) => {
          s.modify(sql`
                insert into db.training_assignments
                  (person_id, document_id,
                   training_language, training_requirement_id, due_date, reason,
                   assignment_source)
                values
                  (candidate.person_id, candidate.document_id,
                   candidate.assignment_language,
                   candidate.requirement_id, candidate.due_date,
                   'Automatic ' || candidate.assignment_reason_code || ': ' || candidate.requirement_name,
                   'automatic_' || candidate.assignment_reason_code)
                returning id into auto_assignment_id
              `);
          s.modify(insertDocumentTasksForAssignmentBatchSql({
            opts,
            documentId: sql`candidate.document_id`,
            assignmentWhere: sql`a.id = auto_assignment_id`,
            dueDate: sql`candidate.due_date`,
          }));
        },
        (s) => {
          s.modify(sql`
                insert into db.training_assignments
                  (person_id, training_course_id, training_course_version_id,
                   training_language, training_requirement_id, due_date, reason,
                   assignment_source)
                values
                  (candidate.person_id, candidate.training_course_id, ${
            activeCourseVersionSql(
              sql`candidate.training_course_id`,
              sql`candidate.assignment_language`,
            )
          },
                   candidate.assignment_language,
                   candidate.requirement_id, candidate.due_date,
                   'Automatic ' || candidate.assignment_reason_code || ': ' || candidate.requirement_name,
                   'automatic_' || candidate.assignment_reason_code)
                returning id into auto_assignment_id
              `);
          s.modify(insertCourseTasksForAssignmentSql({
            assignmentId: sql`auto_assignment_id`,
            courseId: sql`candidate.training_course_id`,
            dueDate: sql`candidate.due_date`,
          }));
        },
      );
      for (
        const statement of finalizeNewAssignmentsSql({
          opts,
          assignmentWhere: sql`a.id = auto_assignment_id`,
          actorId: sql`null`,
        })
      ) {
        s.modify(statement);
      }
      s.modify(sql`
        insert into auto_created_assignments (assignment_id)
        select auto_assignment_id
      `);
    });
    // Published after the loop so the candidate cursor never suspends into
    // a nested procedure call.
    this.publishNotificationsForScope(s, {
      scopeRowsSql: sql`
        select created.assignment_id, 'assignment_created', null, null, false
        from auto_created_assignments created
      `,
    });
  }

  syncAutomaticAssignmentsForDocument(
    s: ServerStatementsBase<any>,
    documentId: Sql,
  ) {
    s.callStoredProcedure("training_sync_document_assignments", {
      inputScalars: {
        p_document_id: documentId,
      },
    });
  }

  private registerAutomaticAssignmentProcedures() {
    // One compiled body owns the audience/candidate/write algorithm; the
    // thin wrappers below only build the requirement scope it operates on.
    system.storedProcedure({
      name: "training_apply_automatic_assignments_from_scope",
      transaction: "caller",
      inputTables: [
        {
          name: "p_requirement_scope",
          fields: [
            { name: "requirement_id", type: "BigInt" },
          ],
        },
      ],
      procedure: (s) => {
        this.appendAutomaticAssignments(s);
      },
    });
    system.storedProcedure({
      name: "training_sync_document_assignments",
      transaction: "caller",
      inputScalars: [
        { name: "p_document_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.defTable("p_requirement_scope", {
          fields: [{ name: "requirement_id", type: "BigInt" }],
        });
        s.modify(sql`
          insert into p_requirement_scope (requirement_id)
          select r.id
          from db.training_requirements r
          where r.is_active
            and r.document_id = p_document_id
        `);
        s.callStoredProcedure(
          "training_apply_automatic_assignments_from_scope",
          {
            inputTables: {
              p_requirement_scope: "p_requirement_scope",
            },
          },
        );
      },
    });
  }

  private registerAutoAssignmentJob() {
    storedScheduledProc({
      name: "training_auto_assignment",
      schedule: "0 0 6 * * *",
      description:
        "Creates missing, renewal, and version-change training assignments from active training requirements.",
      procedure: (s) => {
        s.startTransaction();
        s.defTable("p_requirement_scope", {
          fields: [{ name: "requirement_id", type: "BigInt" }],
        });
        s.modify(sql`
          insert into p_requirement_scope (requirement_id)
          select r.id
          from db.training_requirements r
          where r.is_active
        `);
        s.callStoredProcedure(
          "training_apply_automatic_assignments_from_scope",
          {
            inputTables: {
              p_requirement_scope: "p_requirement_scope",
            },
          },
        );
        s.commitTransaction();
      },
    });
  }

  private registerCertificationExpiryJob() {
    const opts = this.opts;
    const source = retrainingSourceWithFallbackSql(opts, "certification");
    storedScheduledProc({
      name: "training_certification_expiry",
      schedule: "0 30 6 * * *",
      description:
        "Opens retraining cases for approved certifications that are expired or expiring inside the warning window.",
      procedure: (s) => {
        s.startTransaction();
        s.modify(sql`
          insert into db.training_retraining_cases
            (person_id, training_retraining_source, source_id, reason,
             due_date)
          select c.person_id,
                 ${source},
                 c.id,
                 'Certification "' || c.name || '" ' ||
                   case
                     when c.expires_at < current_date() then 'expired on '
                     else 'expires on '
                   end ||
                   ${formatDateSql(sql`c.expires_at`)} || '.',
                 c.expires_at
          from db.training_certifications c
          where c.approval_status = 'approved'
            and ${certificationAlertWhereSql(opts, sql`c`)}
            and not exists (
              select 1
              from db.training_retraining_cases existing
              where existing.source_id = c.id
                and existing.training_retraining_source = ${source}
            )
        `);
        s.commitTransaction();
      },
    });
  }

  private registerCompletedCourseCertificationJob() {
    storedScheduledProc({
      name: "training_completed_course_certifications",
      schedule: "0 */10 * * * *",
      description:
        "Creates certificates for completed course assignments that do not have one yet.",
      procedure: (s) => {
        s.startTransaction();
        s.modify(insertCertificationsForCompletedAssignmentsSql({
          opts: this.opts,
          assignmentWhere: sql`true`,
        }));
        s.commitTransaction();
      },
    });
  }

  private registerNotificationAutomationJob() {
    storedScheduledProc({
      name: "training_notification_automation",
      schedule: "0 0 7 * * *",
      description: "Queues global reminder and overdue training notifications.",
      procedure: (s) => {
        s.startTransaction();
        s.defTable("automated_notification_candidates", {
          fields: [
            { name: "assignment_id", type: "BigInt", notNull: true },
            {
              name: "training_notification_template_id",
              type: "BigInt",
              notNull: true,
            },
            { name: "notification_rule_id", type: "BigInt", notNull: true },
            {
              name: "event_code",
              type: { type: "String", maxLength: 120 },
              notNull: true,
            },
          ],
        });
        s.modify(
          sql`
          insert into automated_notification_candidates
            (assignment_id, training_notification_template_id,
             notification_rule_id, event_code)
          with open_assignments as (
            select a.id as assignment_id,
                   a.person_id,
                   ${
            personLanguageSql(this.opts, sql`person`)
          } as person_language,
                   a.document_id,
                   a.training_course_id,
                   a.assigned_at,
                   coalesce(
                     a.due_date,
                     (
                       select min(t.due_date)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                         and t.status not in ('completed', 'waived')
                     )
                   ) as due_date,
                   coalesce(
                     (select p.name
                      from db.training_courses p
                      where p.id = a.training_course_id),
                     (select d.title
                      from db.training_content_documents d
                      where d.id = a.document_id),
                     'Training assignment'
                   ) as training_module_name
            from db.training_assignments a
            join db.${
            sql.ref(personTable(this.opts))
          } person on person.id = a.person_id
            where ${openTrainingAssignmentWhereSql(sql`a`)}
              and a.status in ('pending', 'in_progress')
              and (a.training_course_id is not null or exists (
                select 1
                from db.training_employee_tasks actionable_task
                where actionable_task.training_assignment_id = a.id
                  and actionable_task.status in ('assigned', 'in_progress')
              ))
          ),
          candidate_rules as (
            select a.assignment_id,
                   a.person_id,
                   a.person_language,
                   a.due_date,
                   a.assigned_at,
                   a.training_module_name,
                   r.id as notification_rule_id,
                   r.event_code,
                   r.training_notification_template_id,
                   coalesce(
                     nullif(course.reminder_after_days, 0),
                     nullif(document_settings.reminder_after_days, 0),
                     7
                   ) as reminder_after_days,
                   coalesce(
                     course.reminder_repeat_every_days,
                     document_settings.reminder_repeat_every_days
                   ) as reminder_repeat_every_days,
                   coalesce(
                     nullif(course.overdue_after_days, 0),
                     nullif(document_settings.overdue_after_days, 0),
                     1
                   ) as overdue_after_days,
                   coalesce(
                     course.overdue_repeat_every_days,
                     document_settings.overdue_repeat_every_days
                   ) as overdue_repeat_every_days
            from open_assignments a
            join db.training_notification_rules r
              on r.is_active
             and r.event_code in ('reminder', 'overdue')
            join db.training_notification_templates t
              on t.id = r.training_notification_template_id
             and t.is_active
            left join db.training_courses course
              on course.id = a.training_course_id
            left join db.training_document_settings document_settings
              on document_settings.document_id = a.document_id
            where (
              r.event_code = 'reminder'
              and date.add(
                day,
                coalesce(
                  nullif(course.reminder_after_days, 0),
                  nullif(document_settings.reminder_after_days, 0),
                  7
                ),
                cast(a.assigned_at as date)
              ) <= current_date()
            ) or (
              r.event_code = 'overdue'
              and a.due_date is not null
              and date.add(
                day,
                coalesce(
                  nullif(course.overdue_after_days, 0),
                  nullif(document_settings.overdue_after_days, 0),
                  1
                ),
                a.due_date
              ) <= current_date()
            )
          ),
          eligible_rules as (
            select c.*,
                   (
                     select count(*)
                     from db.user_notifications n
                     where n.source = ${
            sql.lit(this.opts.notifications.config.key)
          }
                       and n.record_key = c.assignment_id::string
                       and n.payload->>'eventCode' = c.event_code
                       and try_cast(n.payload->>'ruleId' as bigint) =
                         c.notification_rule_id
                       and cast(n.created_at as date) = current_date()
                   ) as send_count,
                   (
                     select max(n.created_at)
                     from db.user_notifications n
                     where n.source = ${
            sql.lit(this.opts.notifications.config.key)
          }
                       and n.record_key = c.assignment_id::string
                       and n.payload->>'eventCode' = c.event_code
                       and try_cast(n.payload->>'ruleId' as bigint) =
                         c.notification_rule_id
                   ) as last_requested_at
            from candidate_rules c
          )
          select assignment_id,
                 training_notification_template_id,
                 notification_rule_id,
                 event_code
          from eligible_rules
          where send_count = 0
            and (
              last_requested_at is null
              or (
                case
                  when event_code = 'reminder'
                    then reminder_repeat_every_days
                  else overdue_repeat_every_days
                end is not null
                and date.add(
                  day,
                  case
                    when event_code = 'reminder'
                      then reminder_repeat_every_days
                    else overdue_repeat_every_days
                  end,
                  cast(last_requested_at as date)
                ) <= current_date()
              )
            )
          `,
        );
        this.publishNotificationsForScope(s, {
          scopeRowsSql: sql`
            select candidate.assignment_id,
                   candidate.event_code,
                   candidate.training_notification_template_id,
                   candidate.notification_rule_id,
                   true
            from automated_notification_candidates candidate
          `,
        });
        s.commitTransaction();
      },
    });
  }

  initialize() {
    if (!system.db.tables[this.opts.content.documentTable]) {
      throw new Error(
        "The Drive training content extension must be initialized before TrainingBlock.",
      );
    }
    if (!system.db.tables.user_notifications) {
      throw new Error(
        "UserNotificationsBlock must be initialized before TrainingBlock.",
      );
    }
    registerTrainingDocumentPublicationConsumer(this);
    ensureLexicalRichTextFunctions(system);
    const complianceEnabled = trainingFeatureEnabled(this.opts, "compliance");
    const retrainingSources = this.opts.retrainingSources ?? [];
    const personnelDocumentTypes = this.opts.personnelDocumentTypes ?? [];
    system.enum_({
      name: "training_version_status",
      values: [
        "draft",
        "published",
        "archived",
      ],
    });
    system.enum_({
      name: "training_task_status",
      values: ["assigned", "in_progress", "completed", "waived"],
    });
    system.enum_({
      name: "training_assignment_status",
      values: [
        "pending",
        "in_progress",
        "completed",
        "validation_pending",
        "waived",
      ],
    });
    system.db.view(
      "training_content_documents",
      this.opts.content.trainingDocumentsQuery(),
      "Governed document identities normalized for Training.",
    );
    system.db.view(
      "training_readable_content_documents",
      sql`select document.* from db.training_content_documents document
        where ${
        this.opts.content.canReadDocument(sql`document.id`, sql`current_user`)
      }`,
      "Training resources readable by the current user.",
    );
    system.db.view(
      "training_content_language_variants",
      this.opts.content.trainingLanguageVariantsQuery(),
      "Governed document language variants normalized for Training.",
    );
    system.db.view(
      "training_content_versions",
      this.opts.content.trainingVersionsQuery(),
      "Published governed revisions normalized for Training.",
    );
    system.db.view(
      "training_content_languages",
      this.opts.content.trainingLanguagesQuery(),
      "Immutable governed-content language metadata used by Training.",
    );
    system.db.view(
      "training_task_item_document_versions",
      this.opts.content.courseSupportingDocumentDisplayVersionsQuery(),
      "Display revisions for linked course files; Company Files media follows its latest published language version.",
    );
    if (complianceEnabled) {
      system.enum_({
        name: "training_retraining_source_code",
        values: retrainingSources.map((source) => source.code),
      });
      system.enum_({
        name: "training_personnel_document_type_code",
        values: personnelDocumentTypes.map((type) => type.code),
      });
      system.enum_({
        name: "training_case_status",
        values: ["open", "completed", "cancelled"],
      });
      system.enum_({
        name: "training_certification_approval_status",
        values: ["pending", "approved", "rejected"],
      });
      system.enum_({
        name: "training_competency_result",
        values: ["pending", "pass", "fail", "needs_retrain"],
      });
    }
    system.enum_({
      name: "course_item_type",
      values: [
        "external_link",
        "essay",
        "other_checklist",
        "practical",
        "signature",
        "assessment",
      ],
    });
    system.enum_({
      name: "training_assessment_kind",
      values: ["test", "evaluation"],
    });
    system.enum_({
      name: "training_assessment_execution_mode",
      values: [
        "employee_attempt",
        "trainer_recorded",
        "employee_submission_with_review",
      ],
    });
    system.enum_({
      name: "training_assessment_item_type",
      values: [
        "multiple_choice",
        "text_response",
        "practical_observation",
        "signature",
      ],
    });
    system.enum_({
      name: "training_assessment_metadata_field_type",
      values: ["text", "number", "date", "single_choice"],
    });
    system.enum_({
      name: "training_assessment_selection_mode",
      values: ["single", "multiple"],
    });
    system.enum_({
      name: "training_assessment_scoring_mode",
      values: ["all_or_nothing", "partial_credit"],
    });
    system.enum_({
      name: "training_assessment_practical_result",
      values: ["pass", "fail", "not_observed", "not_applicable"],
    });
    system.enum_({
      name: "training_assessment_attempt_status",
      values: ["in_progress", "review_pending", "complete", "cancelled"],
    });
    system.enum_({
      name: "training_assessment_outcome",
      values: ["passed", "failed"],
    });
    system.enum_({
      name: "training_assessment_response_review_status",
      values: ["pending", "approved", "rejected", "changes_requested"],
    });
    system.enum_({
      name: "training_assessment_attempt_review_action",
      values: [
        "approve",
        "fail",
        "pass_override",
        "fail_override",
        "request_retake",
        "cancel",
      ],
    });
    system.enum_({
      name: "training_assessment_response_review_action",
      values: ["approve", "reject", "adjust_score", "request_changes"],
    });
    system.db.table("training_notification_templates", (table) => {
      table.string("code", 120).notNull().unique();
      table.string("name", 150).notNull();
      table.string("email_subject", 250);
      table.json("email_body");
      table.string("portal_body", 2000).multiline().notNull();
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
    });

    system.db.table("training_notification_rules", (table) => {
      table.string("event_code", 120).notNull();
      table.fk(
        "training_notification_template_id",
        "training_notification_templates",
      ).notNull().onDelete("Restrict");
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["event_code"]);
      table.check({
        fields: ["event_code"],
        errorMessage: () =>
          sql
            .lit`Notification rule event is not emitted by training automation.`,
        check: ([eventCode]) =>
          sql`${eventCode} in (
              ${notificationRuleEvents.assignmentCreated},
              ${notificationRuleEvents.reminder},
              ${notificationRuleEvents.overdue}
            )`,
      });
      table.searchConfig({
        fields: [
          { field: "event_code", priority: 1 },
        ],
      });
    });

    if (complianceEnabled) {
      system.db.view(
        "training_retraining_sources",
        trainingRetrainingSourcesQuery(this.opts),
        "Immutable retraining source metadata configured on TrainingBlock.",
      );
      system.db.view(
        "training_personnel_document_types",
        trainingPersonnelDocumentTypesQuery(this.opts),
        "Immutable personnel document type metadata configured on TrainingBlock.",
      );
    }

    system.db.table("training_document_settings", (table) => {
      table.fk("document_id", this.opts.content.documentTable).notNull()
        .unique().onDelete("Restrict");
      table.bool("requires_essay").notNull().default(sql`false`);
      table.string("default_essay_prompt", 1000).multiline();
      table.uint("due_within_days").notNull().default(sql`7`);
      table.uint("reminder_after_days").notNull().default(sql`7`);
      table.uint("reminder_repeat_every_days").default(sql`7`);
      table.uint("overdue_after_days").notNull().default(sql`1`);
      table.uint("overdue_repeat_every_days").default(sql`7`);
      table.skipAutoApi();
    });

    system.db.table("training_courses", (table) => {
      table.string("name", 200).notNull();
      table.string("description", 2000).multiline();
      table.uint("due_within_days").notNull().default(sql`7`);
      table.uint("reminder_after_days").notNull().default(sql`7`);
      table.uint("reminder_repeat_every_days").default(sql`7`);
      table.uint("overdue_after_days").notNull().default(sql`1`);
      table.uint("overdue_repeat_every_days").default(sql`7`);
      table.bool("requires_final_signature").notNull().default(
        this.opts.defaultCourseRequiresFinalSignature ? sql`true` : sql`false`,
      );
      table.bool("generates_certification").notNull().default(
        this.opts.defaultCourseGeneratesCertification ? sql`true` : sql`false`,
      );
      if (complianceEnabled) {
        table.uint("certification_expires_after_days");
      }
      table.fk(
        "current_training_course_version_id",
        "training_course_versions",
      ).onDelete("SetToNull");
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
    });

    system.db.table("training_course_section_templates", (table) => {
      table.string("name", 255).notNull().unique();
      table.string("description", 1000).multiline();
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
    });

    system.db.table("training_course_section_template_items", (table) => {
      table.fk(
        "training_course_section_template_id",
        "training_course_section_templates",
      ).notNull();
      table.string("content", 255).notNull().default(sql.lit`Task`);
      table.enum("type", "course_item_type").notNull().default(
        sql.lit`practical`,
      );
      // `fk("training_courses")` would derive `training_coursis_id` (the
      // shared inflector mis-singularizes "courses"), so the name is explicit.
      table.fk("training_course_id", "training_courses").onDelete("Restrict");
      table.fk("training_assessment_id", "training_assessments").onDelete(
        "Restrict",
      );
      table.string("external_url", 1000);
      table.string("external_title", 255);
      table.uint("sort_order").notNull().default(sql`0`);
      table.bool("requires_essay").notNull().default(sql`false`);
      table.string("essay_prompt", 1000).multiline();
      table.check({
        fields: [
          "type",
          "training_course_id",
          "external_url",
          "training_assessment_id",
        ],
        errorMessage: () =>
          sql.lit`Stored section item target must match its item type.`,
        check: ([type, otherCourseId, externalUrl, assessmentId]) =>
          sql`
            case
              when ${type}::string = ${courseItemTypes.otherChecklist} then
                ${otherCourseId} is not null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is null
                and ${assessmentId} is null
              when ${type}::string = ${courseItemTypes.externalLink} then
                ${otherCourseId} is null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is not null
                and ${assessmentId} is null
              when ${type}::string = ${courseItemTypes.assessment} then
                ${otherCourseId} is null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is null
                and ${assessmentId} is not null
              else
                ${otherCourseId} is null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is null
                and ${assessmentId} is null
            end
        `,
      });
      table.recordDisplayName(["content"]);
    });

    system.db.table("training_course_section_template_item_documents", (
      table,
    ) => {
      table.fk(
        "training_course_section_template_item_id",
        "training_course_section_template_items",
      ).notNull();
      table.fk("document_id", this.opts.content.documentTable).notNull()
        .onDelete("Restrict");
      table.uint("sort_order").notNull().default(sql`0`);
      table.string("label", 255);
    });

    system.db.table("training_course_versions", (table) => {
      table.enum("language", "controlled_file_language").notNull().default(
        sql.lit(this.opts.content.opts.defaultLanguage),
      );
      table.fk("source_version_id", "training_course_versions").onDelete(
        "Restrict",
      );
      table.string("localized_name", 200);
      table.string("localized_description", 2000).multiline();
      table.json("introduction");
      table.fk("training_course_id", "training_courses").notNull().onDelete(
        "Restrict",
      );
      table.string("version_label", 80).notNull();
      table.enum("status", "training_version_status").notNull().default(
        sql.lit`published`,
      );
      table.date("effective_at").notNull().default(sql`current_date()`);
      table.fk("created_by_id", personTable(this.opts)).onDelete("SetToNull");
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.fk("published_by_id", personTable(this.opts)).onDelete(
        "SetToNull",
      );
      table.timestampUtc("published_at");
      table.timestampUtc("archived_at");
    });

    system.db.table("training_course_introduction_images", (table) => {
      table.fk("training_course_version_id", "training_course_versions")
        .notNull().onDelete("Cascade");
      table.fk("file_version_id", "file_versions").notNull().onDelete(
        "Restrict",
      );
      table.unique(["training_course_version_id", "file_version_id"]);
    });

    system.db.table("training_course_sections", (table) => {
      table.fk("training_course_version_id", "training_course_versions")
        .notNull();
      table.fk(
        "training_course_section_template_id",
        "training_course_section_templates",
      ).onDelete("SetToNull");
      table.string("name", 255).notNull();
      table.string("description", 1000).multiline();
      table.int("ordinal").notNull();
      // Stable clone key: the section this row was copied from when a new
      // version was cloned. Soft reference (no FK) like
      // training_retraining_cases.source_id; null for sections created
      // directly and for rows created before this column existed.
      table.bigUint("source_section_id");
      table.recordDisplayName(["name"]);
    });

    system.db.table("training_course_section_items", (table) => {
      table.fk("training_course_section_id", "training_course_sections")
        .notNull();
      table.string("content", 255).notNull().default(sql.lit`Task`);
      table.enum("type", "course_item_type").notNull().default(
        sql.lit`practical`,
      );
      table.fk("other_course_id", "training_courses").onDelete("Restrict");
      table.fk("training_assessment_id", "training_assessments").onDelete(
        "Restrict",
      );
      table.string("external_url", 1000);
      table.string("external_title", 255);
      table.uint("sort_order").notNull().default(sql`0`);
      table.bool("requires_essay").notNull().default(sql`false`);
      table.string("essay_prompt", 1000).multiline();
      // Stable clone keys (soft references, no FK): the item this row was
      // copied from when a version was cloned, and the stored-section
      // template item it was instantiated from. Null for items created
      // directly and for rows created before these columns existed.
      table.bigUint("source_item_id");
      table.bigUint("source_template_item_id");
      table.check({
        fields: [
          "type",
          "other_course_id",
          "external_url",
          "training_assessment_id",
        ],
        errorMessage: () =>
          sql.lit`Course item target must match its item type.`,
        check: ([type, otherCourseId, externalUrl, assessmentId]) =>
          sql`
            case
              when ${type}::string = ${courseItemTypes.otherChecklist} then
                ${otherCourseId} is not null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is null
                and ${assessmentId} is null
              when ${type}::string = ${courseItemTypes.externalLink} then
                ${otherCourseId} is null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is not null
                and ${assessmentId} is null
              when ${type}::string = ${courseItemTypes.assessment} then
                ${otherCourseId} is null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is null
                and ${assessmentId} is not null
              else
                ${otherCourseId} is null
                and nullif(trim(coalesce(${externalUrl}, '')), '') is null
                and ${assessmentId} is null
            end
        `,
      });
    });

    system.db.table("training_course_section_item_documents", (table) => {
      table.fk(
        "training_course_section_item_id",
        "training_course_section_items",
      ).notNull();
      table.fk("document_id", this.opts.content.documentTable).notNull()
        .onDelete("Restrict");
      table.uint("sort_order").notNull().default(sql`0`);
      table.string("label", 255);
    });

    // Assessments are reusable, versioned training content. Attempts (below,
    // with the runtime tables) are execution evidence pinned to a published
    // version; training progress stays owned by training_employee_tasks and
    // training_assignments.
    system.db.table("training_assessments", (table) => {
      table.string("name", 200).notNull();
      table.string("description", 2000).multiline();
      table.enum("kind", "training_assessment_kind").notNull().default(
        sql.lit`test`,
      );
      table.enum("execution_mode", "training_assessment_execution_mode")
        .notNull().default(sql.lit`employee_attempt`);
      table.fk(
        "current_training_assessment_version_id",
        "training_assessment_versions",
      ).onDelete("SetToNull");
      table.bool("is_active").notNull().default(sql`true`);
      table.fk("created_by_id", personTable(this.opts)).onDelete("SetToNull");
      table.timestampUtc("archived_at");
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
    });

    system.db.table("training_assessment_versions", (table) => {
      table.enum("language", "controlled_file_language").notNull().default(
        sql.lit(this.opts.content.opts.defaultLanguage),
      );
      table.fk("source_version_id", "training_assessment_versions").onDelete(
        "Restrict",
      );
      table.string("localized_name", 200);
      table.string("localized_description", 2000).multiline();
      table.fk("training_assessment_id", "training_assessments").notNull()
        .onDelete("Restrict");
      table.string("version_label", 80).notNull();
      table.enum("status", "training_version_status").notNull().default(
        sql.lit`draft`,
      );
      table.uint("passing_score_percent").notNull().default(sql`100`);
      table.uint("max_attempts");
      table.uint("cooldown_minutes");
      table.bool("allow_retake_after_pass").notNull().default(sql`false`);
      table.bool("score_adjustment_allowed").notNull().default(sql`false`);
      table.bool("outcome_override_allowed").notNull().default(sql`false`);
      table.bool("show_correct_answers_after_submission").notNull().default(
        sql`false`,
      );
      table.bool("show_failed_attempts_to_employee").notNull().default(
        sql`true`,
      );
      table.fk("created_by_id", personTable(this.opts)).onDelete("SetToNull");
      table.fk("published_by_id", personTable(this.opts)).onDelete(
        "SetToNull",
      );
      table.timestampUtc("published_at");
      table.timestampUtc("archived_at");
      table.recordDisplayName(["version_label"]);
    });

    system.db.table("training_assessment_sections", (table) => {
      table.fk(
        "training_assessment_version_id",
        "training_assessment_versions",
      ).notNull();
      table.string("name", 255).notNull();
      table.string("description", 1000).multiline();
      table.int("ordinal").notNull().default(sql`0`);
      // Stable clone key (soft reference, no FK): the section this row was
      // copied from when the published version was cloned into a draft.
      // Null for sections created directly and for pre-existing rows.
      table.bigUint("source_section_id");
      table.recordDisplayName(["name"]);
    });

    system.db.table("training_assessment_items", (table) => {
      table.fk(
        "training_assessment_section_id",
        "training_assessment_sections",
      ).notNull();
      table.enum("type", "training_assessment_item_type").notNull().default(
        sql.lit`multiple_choice`,
      );
      table.string("prompt", 2000).multiline().notNull();
      table.string("help_text", 1000).multiline();
      table.int("ordinal").notNull().default(sql`0`);
      table.uint("points").notNull().default(sql`1`);
      table.bool("include_in_score").notNull().default(sql`true`);
      table.bool("is_required").notNull().default(sql`true`);
      table.bool("requires_review").notNull().default(sql`false`);
      // Multiple choice only.
      table.enum("selection_mode", "training_assessment_selection_mode");
      table.enum("scoring_mode", "training_assessment_scoring_mode")
        .notNull().default(sql.lit`all_or_nothing`);
      table.bool("shuffle_choices").notNull().default(sql`false`);
      table.string("explanation", 2000).multiline();
      table.string("remediation_text", 2000).multiline();
      // Practical observation only.
      table.bool("practical_result_required").notNull().default(sql`false`);
      table.bool("fail_result_fails_attempt").notNull().default(sql`false`);
      table.bool("not_observed_fails_attempt").notNull().default(sql`false`);
      table.bool("not_applicable_allowed").notNull().default(sql`false`);
      table.bool("reviewer_signature_required").notNull().default(sql`false`);
      // Stable clone key (soft reference, no FK): the item this row was
      // copied from when the published version was cloned into a draft.
      // Null for items created directly and for pre-existing rows.
      table.bigUint("source_item_id");
      table.recordDisplayName(["prompt"]);
      table.check({
        fields: ["type", "selection_mode"],
        errorMessage: () =>
          sql
            .lit`Selection mode is required for multiple choice items and only for them.`,
        check: ([type, selectionMode]) =>
          sql`(${type}::string = ${assessmentItemTypes.multipleChoice}) =
            (${selectionMode} is not null)`,
      });
      table.check({
        fields: ["scoring_mode", "type", "selection_mode"],
        errorMessage: () =>
          sql
            .lit`Partial credit is only available for multiple-answer multiple choice items.`,
        check: ([scoringMode, type, selectionMode]) =>
          sql`${scoringMode}::string != ${assessmentScoringModes.partialCredit}
            or (${type}::string = ${assessmentItemTypes.multipleChoice}
              and coalesce(${selectionMode}::string,
                ${assessmentSelectionModes.single}) =
                ${assessmentSelectionModes.multiple})`,
      });
    });

    system.db.table("training_assessment_metadata_fields", (table) => {
      table.fk(
        "training_assessment_version_id",
        "training_assessment_versions",
      ).notNull();
      table.string("key", 120).notNull();
      table.string("label", 255).notNull();
      table.enum("type", "training_assessment_metadata_field_type")
        .notNull();
      table.bool("required").notNull().default(sql`false`);
      table.int("ordinal").notNull().default(sql`0`);
      table.string("help_text", 1000).multiline();
      table.recordDisplayName(["label"]);
      table.unique(["training_assessment_version_id", "key"]);
    });

    system.db.table("training_assessment_metadata_field_choices", (table) => {
      table.fk(
        "training_assessment_metadata_field_id",
        "training_assessment_metadata_fields",
      ).notNull();
      table.string("label", 255).notNull();
      table.string("value", 255).notNull();
      table.uint("sort_order").notNull().default(sql`0`);
      table.recordDisplayName(["label"]);
      table.unique(["training_assessment_metadata_field_id", "value"]);
    });

    // Choices derive their assessment version through their item.
    system.db.table("training_assessment_item_choices", (table) => {
      table.fk(
        "training_assessment_item_id",
        "training_assessment_items",
      ).notNull();
      table.string("content", 1000).notNull();
      table.bool("is_correct").notNull().default(sql`false`);
      table.uint("sort_order").notNull().default(sql`0`);
      table.string("explanation", 1000).multiline();
      table.recordDisplayName(["content"]);
    });

    // Runtime evidence: attempts are always linked to a course task and
    // pinned to the published assessment version they were started against.
    // No attempt row means not started; submission either completes
    // synchronously or moves to review_pending.
    system.db.table("training_assessment_attempts", (table) => {
      table.fk(
        "training_assessment_version_id",
        "training_assessment_versions",
      ).notNull().onDelete("Restrict");
      table.fk(
        "training_employee_task_id",
        "training_employee_tasks",
      ).notNull().onDelete("Restrict");
      table.uint("attempt_number").notNull().default(sql`1`);
      table.enum("status", "training_assessment_attempt_status").notNull()
        .default(sql.lit`in_progress`);
      table.enum("outcome", "training_assessment_outcome");
      table.double("score_points");
      table.uint("max_points");
      table.double("score_percent");
      table.fk("started_by_id", personTable(this.opts)).onDelete("SetToNull");
      table.fk("submitted_by_id", personTable(this.opts)).onDelete(
        "SetToNull",
      );
      table.timestampUtc("started_at").notNull().default(sql`now()`);
      table.timestampUtc("submitted_at");
      table.timestampUtc("completed_at");
      table.timestampUtc("cancelled_at");
      table.fk("cancelled_by_id", personTable(this.opts)).onDelete(
        "SetToNull",
      );
      table.unique([
        "training_employee_task_id",
        "attempt_number",
      ]);
      table.check({
        fields: ["status", "outcome", "completed_at", "cancelled_at"],
        errorMessage: () =>
          sql
            .lit`Assessment attempt status, outcome, and timestamps must be consistent.`,
        check: ([status, outcome, completedAt, cancelledAt]) =>
          sql`
            (${status}::string != ${assessmentAttemptStatuses.complete}
              or (
                ${completedAt} is not null
                and ${outcome} is not null
              ))
            and (${status}::string != ${assessmentAttemptStatuses.cancelled}
              or ${cancelledAt} is not null)
            and (${outcome} is null
              or ${status}::string = ${assessmentAttemptStatuses.complete})
          `,
      });
      table.check({
        fields: ["score_percent", "max_points"],
        errorMessage: () =>
          sql
            .lit`Assessment attempt score percent requires a nonzero max points.`,
        check: ([scorePercent, maxPoints]) =>
          sql`${scorePercent} is null or coalesce(${maxPoints}, 0) > 0`,
      });
    });

    // Snapshot fields (max_points, include_in_score, requires_review)
    // protect historical attempts from later assessment version edits.
    system.db.table("training_assessment_responses", (table) => {
      table.fk(
        "training_assessment_attempt_id",
        "training_assessment_attempts",
      ).notNull().onDelete("Restrict");
      table.fk(
        "training_assessment_item_id",
        "training_assessment_items",
      ).notNull().onDelete("Restrict");
      table.string("text_response", 4000).multiline();
      table.enum(
        "practical_result",
        "training_assessment_practical_result",
      );
      table.string("measured_value", 200);
      table.string("measured_unit", 80);
      table.string("notes", 2000).multiline();
      table.string("signature_name", 200);
      table.text("signature_data", 1000000);
      table.bool("auto_graded").notNull().default(sql`false`);
      table.double("points_awarded");
      table.uint("max_points").notNull().default(sql`0`);
      table.bool("include_in_score").notNull().default(sql`true`);
      table.bool("is_correct");
      table.bool("requires_review").notNull().default(sql`false`);
      table.enum(
        "review_status",
        "training_assessment_response_review_status",
      );
      table.unique([
        "training_assessment_attempt_id",
        "training_assessment_item_id",
      ]);
    });

    // Append-only evidence for reviewer decisions and score changes. The
    // mutable attempt/response rows remain the current-state projection.
    system.db.table("training_assessment_attempt_reviews", (table) => {
      table.insertOnly();
      table.fk(
        "training_assessment_attempt_id",
        "training_assessment_attempts",
      ).notNull().onDelete("Restrict");
      table.fk("reviewed_by_id", personTable(this.opts)).notNull().onDelete(
        "Restrict",
      );
      table.enum(
        "review_action",
        "training_assessment_attempt_review_action",
      ).notNull();
      table.enum("outcome", "training_assessment_outcome");
      table.double("score_points");
      table.string("notes", 2000).multiline();
      table.string("override_reason", 1000).multiline();
      table.text("signature_data", 1000000);
      table.timestampUtc("reviewed_at").notNull().default(sql`now()`);
    });

    system.db.table("training_assessment_response_reviews", (table) => {
      table.insertOnly();
      table.fk(
        "training_assessment_response_id",
        "training_assessment_responses",
      ).notNull().onDelete("Restrict");
      table.fk("reviewed_by_id", personTable(this.opts)).notNull().onDelete(
        "Restrict",
      );
      table.enum(
        "review_action",
        "training_assessment_response_review_action",
      ).notNull();
      table.double("points_awarded");
      table.string("notes", 2000).multiline();
      table.string("override_reason", 1000).multiline();
      table.text("signature_data", 1000000);
      table.timestampUtc("reviewed_at").notNull().default(sql`now()`);
    });

    system.db.table(
      "training_assessment_response_selected_choices",
      (table) => {
        table.fk(
          "training_assessment_response_id",
          "training_assessment_responses",
        ).notNull();
        table.fk(
          "training_assessment_item_choice_id",
          "training_assessment_item_choices",
        ).notNull().onDelete("Restrict");
        table.unique([
          "training_assessment_response_id",
          "training_assessment_item_choice_id",
        ]);
      },
    );

    system.db.table("training_assessment_metadata_responses", (table) => {
      table.fk(
        "training_assessment_attempt_id",
        "training_assessment_attempts",
      ).notNull().onDelete("Restrict");
      table.fk(
        "training_assessment_metadata_field_id",
        "training_assessment_metadata_fields",
      ).notNull().onDelete("Restrict");
      table.string("text_value", 4000).multiline();
      table.double("number_value");
      table.date("date_value");
      table.fk(
        "selected_choice_id",
        "training_assessment_metadata_field_choices",
      ).onDelete("Restrict");
      table.unique([
        "training_assessment_attempt_id",
        "training_assessment_metadata_field_id",
      ]);
    });

    // Audience matching columns mirror the facets the workforce provider
    // advertises; audienceMatchSql only references the columns that exist.
    system.db.table("training_audiences", (table) => {
      table.string("name", 150).notNull();
      table.string("description", 1000).multiline();
      table.string("worker_type", 100);
      table.fk(
        "workforce_job_profile_id",
        this.opts.workforce.jobProfilesTable,
      ).onDelete("Restrict");
      if (this.opts.workforce.organizationsTable) {
        table.fk(
          "employer_workforce_organization_id",
          this.opts.workforce.organizationsTable,
        ).onDelete("Restrict");
        table.fk(
          "host_workforce_organization_id",
          this.opts.workforce.organizationsTable,
        ).onDelete("Restrict");
      }
      if (this.opts.workforce.orgUnitsTable) {
        table.fk("workforce_org_unit_id", this.opts.workforce.orgUnitsTable)
          .onDelete("Restrict");
      }
      if (this.opts.workforce.locationsTable) {
        table.fk("workforce_location_id", this.opts.workforce.locationsTable)
          .onDelete("Restrict");
      }
      if (this.opts.workforce.positionsTable) {
        table.fk("workforce_position_id", this.opts.workforce.positionsTable)
          .onDelete("Restrict");
      }
      table.string("relationship_status", 100);
      table.string("assignment_status", 100);
      table.enum("training_language", "controlled_file_language");
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
    });

    system.db.table("training_requirements", (table) => {
      table.string("name", 200).notNull();
      table.string("description", 1500).multiline();
      table.fk("document_id", this.opts.content.documentTable).onDelete(
        "Restrict",
      );
      table.fk("training_course_id", "training_courses").onDelete("Restrict");
      table.enum("training_language", "controlled_file_language");
      table.uint("renewal_interval_days");
      table.uint("expiration_warning_days").notNull().default(sql`45`);
      table.bool("requires_reassignment_on_new_version").notNull().default(
        sql`true`,
      );
      table.bool("is_active").notNull().default(sql`true`);
      table.recordDisplayName(["name"]);
      table.check({
        fields: ["document_id", "training_course_id"],
        errorMessage: () =>
          sql
            .lit`Training requirement must target exactly one document or course.`,
        check: ([documentId, courseId]) =>
          sql`(${documentId} is null) != (${courseId} is null)`,
      });
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
    });

    system.db.table("training_requirement_audiences", (table) => {
      table.fk("training_requirement_id", "training_requirements").notNull();
      table.fk("training_audience_id", "training_audiences").notNull()
        .onDelete("Restrict");
      table.unique(["training_requirement_id", "training_audience_id"]);
    });

    system.db.table("training_assignments", (table) => {
      table.fk("training_course_version_id", "training_course_versions")
        .onDelete("Restrict");
      table.fk("person_id", personTable(this.opts)).notNull().onDelete(
        "Restrict",
      );
      table.fk("training_course_id", "training_courses").onDelete("Restrict");
      table.fk("document_id", this.opts.content.documentTable).onDelete(
        "Restrict",
      );
      table.enum("training_language", "controlled_file_language").notNull();
      table.fk(
        "training_requirement_id",
        "training_requirements",
      ).onDelete("SetToNull");
      table.date("due_date");
      table.string("reason", 1000).multiline();
      table.string("assignment_source", 80).notNull().default(sql.lit`manual`);
      table.enum("status", "training_assignment_status").notNull().default(
        sql.lit`pending`,
      );
      table.fk("assigned_by_id", personTable(this.opts)).onDelete("SetToNull");
      table.timestampUtc("assigned_at").notNull().default(sql`now()`);
      table.fk("final_primary_validator_id", personTable(this.opts)).onDelete(
        "SetToNull",
      );
      table.fk("final_secondary_validator_id", personTable(this.opts)).onDelete(
        "SetToNull",
      );
      table.text("employee_final_signature_data", 1000000);
      table.timestampUtc("employee_final_signed_at");
      table.check({
        fields: ["document_id", "training_course_id"],
        errorMessage: () =>
          sql
            .lit`Training assignment must target exactly one document or course.`,
        check: ([documentId, courseId]) =>
          sql`(${documentId} is null) != (${courseId} is null)`,
      });
    });

    system.db.table("training_employee_tasks", (table) => {
      table.fk(
        "training_assignment_id",
        "training_assignments",
      ).notNull().onDelete("Restrict");
      table.fk(
        "training_course_section_item_id",
        "training_course_section_items",
      ).onDelete("Restrict");
      table.fk(
        "parent_training_course_section_item_id",
        "training_course_section_items",
      ).onDelete("Restrict");
      table.fk(
        "document_version_id",
        this.opts.content.versionTable,
      ).onDelete("Restrict");
      table.enum("status", "training_task_status").notNull()
        .default(sql.lit`assigned`);
      table.date("due_date");
      table.enum("training_language", "controlled_file_language");
      table.string("signature_name", 200);
      table.text("signature_data", 1000000);
      table.string("completion_attestation", 1000).multiline();
      table.string("essay_response", 4000).multiline();
      table.timestampUtc("completed_at");
      table.fk("waived_by_id", personTable(this.opts)).onDelete("Restrict");
      table.timestampUtc("waived_at");
      table.string("waiver_reason", 1000).multiline();
      table.check({
        fields: [
          "training_course_section_item_id",
          "parent_training_course_section_item_id",
          "document_version_id",
          "status",
          "training_language",
          "signature_name",
          "signature_data",
          "completion_attestation",
          "essay_response",
          "completed_at",
          "waived_by_id",
          "waived_at",
          "waiver_reason",
        ],
        errorMessage: () =>
          sql
            .lit`Training task target and completion evidence must be consistent.`,
        check: ([
          courseItemId,
          parentCourseItemId,
          documentVersionId,
          status,
          language,
          signatureName,
          signatureData,
          completionAttestation,
          _essayResponse,
          completedAt,
          waivedById,
          waivedAt,
          waiverReason,
        ]) =>
          sql`
            (
              (
                ${courseItemId} is null
                and ${parentCourseItemId} is null
                and ${documentVersionId} is not null
              )
              or (
                ${courseItemId} is not null
                and ${documentVersionId} is null
              )
            )
            and (
              (
	                ${status}::string = ${taskStatuses.completed}
	                and ${completedAt} is not null
	                and ${language} is not null
	                and (
	                  ${courseItemId} is not null
	                  or (
	                    nullif(trim(coalesce(${signatureName}, '')), '') is not null
	                    and ${signatureData} is not null
	                    and nullif(
	                      trim(coalesce(${completionAttestation}, '')),
	                      ''
	                    ) is not null
	                  )
	                )
	              )
              or (
                ${status}::string != ${taskStatuses.completed}
                and ${completedAt} is null
                and ${language} is null
                and nullif(trim(coalesce(${signatureName}, '')), '') is null
                and ${signatureData} is null
                and ${completionAttestation} is null
              )
            )
            and (
              (
                ${status}::string = ${taskStatuses.waived}
                and (
                  (
                    ${waivedById} is not null
                    and ${waivedAt} is not null
                    and nullif(
                      trim(coalesce(${waiverReason}, '')),
                      ''
                    ) is not null
                  )
                  or (
                    ${waivedById} is null
                    and ${waivedAt} is null
                    and ${waiverReason} is null
                  )
                )
              )
              or (
                ${status}::string != ${taskStatuses.waived}
                and ${waivedById} is null
                and ${waivedAt} is null
                and ${waiverReason} is null
              )
            )
        `,
      });
    });

    // Per-task snapshot of the documents linked to a course step, pinned to
    // the published version resolved at assignment time so a signed step
    // always records the exact revisions the employee saw. Open tasks are
    // re-pinned when a new version publishes; completed tasks keep theirs.
    system.db.table("training_task_item_documents", (table) => {
      table.fk(
        "training_employee_task_id",
        "training_employee_tasks",
      ).notNull();
      table.fk(
        "training_course_section_item_document_id",
        "training_course_section_item_documents",
      ).notNull().onDelete("Restrict");
      table.fk(
        "document_version_id",
        this.opts.content.versionTable,
      ).notNull().onDelete("Restrict");
      table.unique([
        "training_employee_task_id",
        "training_course_section_item_document_id",
      ]);
    });

    system.db.table("training_assignment_validations", (table) => {
      table.fk(
        "training_assignment_id",
        "training_assignments",
      ).notNull().onDelete("Restrict");
      table.string("validation_stage_code", 80).notNull();
      table.string("validation_stage_name", 160).notNull();
      table.fk("validated_by_id", personTable(this.opts)).notNull().onDelete(
        "Restrict",
      );
      table.string("validator_signature_name", 200).notNull();
      table.text("validator_signature_data", 1000000);
      table.timestampUtc("validated_at").notNull().default(sql`now()`);
      table.unique(["training_assignment_id", "validation_stage_code"]);
    });

    if (trainingFeatureEnabled(this.opts, "inviteAccess")) {
      system.db.table("training_access_tokens", (table) => {
        table.string("token", 120).notNull().unique();
        table.fk(
          "training_assignment_id",
          "training_assignments",
        ).notNull();
        table.timestampUtc("expires_at").notNull();
        table.timestampUtc("revoked_at");
        table.fk("created_by_id", personTable(this.opts)).onDelete(
          "SetToNull",
        );
        table.timestampUtc("created_at").notNull().default(sql`now()`);
      });
    }

    if (complianceEnabled) {
      system.db.table("training_retraining_cases", (table) => {
        table.fk("person_id", personTable(this.opts)).notNull().onDelete(
          "Restrict",
        );
        table.enum("status", "training_case_status").notNull()
          .default(sql.lit`open`);
        table.enum(
          "training_retraining_source",
          "training_retraining_source_code",
        ).notNull();
        table.bigUint("source_id");
        table.string("reason", 2000).multiline().notNull();
        table.fk("training_course_id", "training_courses").onDelete(
          "SetToNull",
        );
        // Set when the case's linked checklist is assigned; completing that
        // assignment closes the case.
        table.fk("training_assignment_id", "training_assignments").onDelete(
          "SetToNull",
        );
        table.date("due_date");
        table.fk("created_by_id", personTable(this.opts)).onDelete(
          "SetToNull",
        );
        table.timestampUtc("created_at").notNull().default(sql`now()`);
        table.timestampUtc("completed_at");
      });

      system.db.table("training_certifications", (table) => {
        table.fk("person_id", personTable(this.opts)).notNull().onDelete(
          "Restrict",
        );
        table.fk("training_assignment_id", "training_assignments").onDelete(
          "SetToNull",
        );
        table.fk("training_course_id", "training_courses").onDelete(
          "SetToNull",
        );
        table.string("access_token", 80).notNull().default(
          sql`bytes.to_hex(crypto.random_bytes(16))`,
        ).unique();
        table.string("name", 150).notNull();
        table.string("certification_number", 150);
        table.date("issued_at");
        table.date("expires_at");
        table.string("issuing_authority", 200);
        table.string("source", 150);
        table.enum("approval_status", "training_certification_approval_status")
          .notNull().default(sql.lit`pending`);
        table.fk("approved_by_id", personTable(this.opts)).onDelete(
          "SetToNull",
        );
        table.timestampUtc("approved_at");
        table.fk(
          "renewed_from_certification_id",
          "training_certifications",
        ).onDelete("Restrict");
        table.string("notes", 2000).multiline();
        table.blobRef("proof_blob_hash", 64);
        table.string("proof_file_name", 500);
        table.string("proof_content_type", 120);
        table.unique(["training_assignment_id"]);
        table.recordDisplayName(["name"]);
      });

      system.db.table("training_competency_checks", (table) => {
        table.fk("person_id", personTable(this.opts)).notNull().onDelete(
          "Restrict",
        );
        table.string("title", 200).notNull();
        table.fk("document_id", this.opts.content.documentTable).onDelete(
          "SetToNull",
        );
        table.fk(
          "training_certification_id",
          "training_certifications",
        ).onDelete("SetToNull");
        table.enum("result", "training_competency_result").notNull()
          .default(sql.lit`pending`);
        table.fk("observed_by_id", personTable(this.opts)).onDelete(
          "SetToNull",
        );
        table.timestampUtc("observed_at");
        table.date("recheck_due_date");
        table.string("notes", 3000).multiline();
        table.blobRef("evidence_blob_hash", 64);
        table.string("evidence_file_name", 500);
        table.string("evidence_content_type", 120);
        table.timestampUtc("created_at").notNull().default(sql`now()`);
        table.recordDisplayName(["title"]);
      });

      system.db.table("training_personnel_documents", (table) => {
        table.fk("person_id", personTable(this.opts)).notNull().onDelete(
          "Restrict",
        );
        table.enum(
          "training_personnel_document_type",
          "training_personnel_document_type_code",
        ).notNull();
        table.string("title", 200).notNull();
        table.string("notes", 3000).multiline();
        table.blobRef("blob_hash", 64);
        table.string("file_name", 500);
        table.string("content_type", 120);
        table.fk("created_by_id", personTable(this.opts)).onDelete(
          "SetToNull",
        );
        table.timestampUtc("created_at").notNull().default(sql`now()`);
      });
    }

    system.db.view(
      "training_person_training_status",
      personTrainingStatusViewQuery(this.opts),
      "Per-person training rollup counts for admin dashboards and portals.",
    );
    system.db.view(
      "training_assignment_validation_state",
      assignmentValidationStateViewQuery(this.opts),
      "Assignments pending validation with per-stage missing-sign-off flags.",
    );
    system.db.view(
      "training_task_derived_state",
      taskDerivedStateViewQuery(),
      "Derived assessment state per training task.",
    );

    this.registerContentProcedures();
    this.registerNotificationPublicationProcedure();
    this.registerAutomaticAssignmentProcedures();
    registerTranslationReviews(this.opts);
    registerTrainingStoredProcedures(this.opts);
    registerTrainingTranslationProcedures(this.opts);
    registerCourseIntroductionProcedures(this.opts);
    registerCourseLifecycleStoredProcedures(this.opts);
    registerCourseEditorStoredProcedures();
    registerAssignmentWorkspaceStoredProcedures(this.opts);
    registerNotificationStoredProcedures(this.opts);
    this.registerAutoAssignmentJob();
    if (complianceEnabled) {
      this.registerCompletedCourseCertificationJob();
      this.registerCertificationExpiryJob();
    }
    this.registerNotificationAutomationJob();
  }

  validate() {
    if (
      !system.db.tables[this.opts.content.documentTable] ||
      !system.db.tables[this.opts.content.versionTable]
    ) {
      throw new Error(
        "TrainingBlock requires its Drive content extension to be initialized first.",
      );
    }
    const configuredPermissions = new Set(
      Object.values(system.enums.auth_permission?.values ?? {}).map((value) =>
        value.name
      ),
    );
    for (const permission of TrainingBlock.permissions) {
      if (!configuredPermissions.has(permission.name)) {
        throw new Error(
          `TrainingBlock permission '${permission.name}' must be registered with AuthBlock.`,
        );
      }
    }
  }

  /**
   * Installs the `/api/training/*` endpoints on a domain. `Endpoints` calls
   * this with the rendering app's domain. System tests that exercise the
   * endpoints with `s.request` call it directly, because the tests pipeline
   * never renders app UIs. Repeat calls for a domain are no-ops.
   */
  registerAppEndpoints(domain: string) {
    if (this.#endpointDomains.has(domain)) return;
    this.#endpointDomains.add(domain);
    this.registerApi(domain);
  }

  private registerContentProcedures() {
    system.storedProcedure({
      name: "training_load_document_content",
      transaction: "caller",
      inputScalars: [
        { name: "p_task_id", type: "BigInt" },
        { name: "p_version_id", type: "BigInt" },
        { name: "p_user_id", type: "BigInt" },
        { name: "p_access_token", type: { type: "String", maxLength: 120 } },
      ],
      outputRecords: [{
        name: "training_document_content",
        fields: [
          { name: "blob_hash", type: { type: "Bytes", maxLength: 32 } },
          { name: "file_name", type: { type: "String", maxLength: 500 } },
          { name: "content_type", type: { type: "String", maxLength: 255 } },
          { name: "content_mode", type: { type: "String", maxLength: 40 } },
          { name: "external_url", type: "String" },
        ],
      }],
      procedure: (s) => {
        s.modify(sql`
          insert into training_document_content
          select version.blob_hash, version.file_name, version.content_type,
                 version.content_mode, version.external_url
          from db.training_employee_tasks task
          join db.training_assignments assignment
            on assignment.id = task.training_assignment_id
          join db.${sql.ref(personTable(this.opts))} person
            on person.id = assignment.person_id
          join db.training_content_versions version
            on version.id = p_version_id
          where task.id = p_task_id
            and task.status != 'waived'
            and (
              task.document_version_id = version.id
              or exists (
                select 1
                from db.training_task_item_documents snapshot
                where snapshot.training_employee_task_id = task.id
                  and snapshot.document_version_id = version.id
              )
              or ${
          this.opts.content.canReadCourseSupportingMediaVersion({
            taskId: sql`task.id`,
            versionId: sql`version.id`,
            language: sql`assignment.training_language`,
          })
        }
            )
            and (
              (p_user_id is not null
                and ${
          this.opts.workforce.personSysUserId(sql`person`)
        } = p_user_id)
              or ${
          trainingFeatureEnabled(this.opts, "inviteAccess")
            ? sql`exists (
                    select 1
                    from db.training_access_tokens token
                    where token.token = p_access_token
                      and token.training_assignment_id = assignment.id
                      and token.revoked_at is null
                      and token.expires_at > now()
                      and ${openTrainingAssignmentWhereSql(sql`assignment`)}
                  )`
            : sql`false`
        }
            )
        `);
      },
    });
    if (!trainingFeatureEnabled(this.opts, "compliance")) return;
    system.storedProcedure({
      name: "training_render_certificate",
      transaction: "caller",
      inputScalars: [{
        name: "p_access_token",
        type: { type: "String", maxLength: 120 },
      }],
      outputScalars: [
        { name: "certificate_id", type: "BigInt" },
        { name: "certificate_name", type: "String" },
        { name: "certificate_html", type: "String" },
      ],
      procedure: (s) => {
        s.defRecord(
          "certification",
          sql`select c.id,
                       c.name,
                       c.access_token,
                       c.issued_at,
                       c.issuing_authority,
                       ${employeeName(this.opts, sql`p`)} as employee_name,
                       ${
            certificationTemplateOrganizationNameSql(
              this.opts,
              sql`coalesce(
                  c.issuing_authority,
                  'Training'
                )`,
            )
          } as organization_name,
                       ${
            certificationTemplateApprovalLabelSql(
              this.opts,
              sql`${
                sql.lit(
                  trainingValidationLabels(this.opts)
                    .primaryStageDisplayName,
                )
              }`,
            )
          } as approval_label
                from db.training_certifications c
                join db.${sql.ref(personTable(this.opts))} p
                  on p.id = c.person_id
                where c.access_token = p_access_token
                  and c.approval_status = 'approved'
                limit 1`,
        );
        s.setScalar("certificate_id", sql`certification.id`);
        s.setScalar("certificate_name", sql`certification.name`);
        s.setScalar(
          "certificate_html",
          generatedCertificateHtmlSql({
            employeeName: sql`certification.employee_name`,
            courseName: sql`certification.name`,
            issuedAt: sql`certification.issued_at`,
            organizationName: sql`certification.organization_name`,
            approvalLabel: sql`certification.approval_label`,
            logoPath: certificationTemplateLogoPathSql(this.opts),
            sealPath: certificationTemplateSealPathSql(this.opts),
          }),
        );
      },
    });
  }

  private registerApi(domain: string) {
    const complianceEnabled = trainingFeatureEnabled(this.opts, "compliance");
    const api = system.api({ prefix: "/api", domain });
    api.get(
      "/training/translation-reviews/{review_id}/files/{file_version_id}",
      {
        procedure: (s) => renderTranslationReviewFile(s, this.opts),
      },
    );
    api.get(
      "/training/translation-reviews/{review_id}/documents/{version_id}/native-images/{image_file_item_id}/{hash_hex}",
      {
        procedure: (s) =>
          renderTranslationReviewFile(s, this.opts, "nativeImage"),
      },
    );

    if (this.opts.content.config.nativeDocuments.opts.renderAuthorizedPdf) {
      api.get(
        "/training/translation-reviews/{review_id}/documents/{version_id}/pdf",
        {
          procedure: (s) =>
            renderTranslationReviewFile(s, this.opts, "nativePdf"),
        },
      );
    }

    const loadTrainingDocument = (
      s: EndpointStatements,
      accessToken?: Sql,
    ) => {
      if (accessToken === undefined) {
        AuthBlock.validateApi(s, sql.lit`y-t`);
        s.defScalar(
          "training_document_api_user",
          sql`coalesce(auth_user_id, current_user)`,
        );
      }
      s.callStoredProcedure("training_load_document_content", {
        inputScalars: {
          p_task_id: sql`task_id::bigint`,
          p_version_id: sql`version_id::bigint`,
          p_user_id: accessToken === undefined
            ? sql`training_document_api_user`
            : sql.null,
          p_access_token: accessToken ?? sql.null,
        },
        outputRecords: {
          training_document_content: "training_document_content",
        },
      });
      s.if(sql`training_document_content.content_mode is null`, (s) => {
        s.setHttpStatus(404);
        s.return(sql.lit`Training document not found`);
      });
    };
    const renderTrainingDocumentFile = (
      s: EndpointStatements,
      accessToken?: Sql,
    ) => {
      loadTrainingDocument(s, accessToken);
      if (this.opts.content.config.nativeDocuments.opts.renderAuthorizedPdf) {
        s.if(
          sql`training_document_content.content_mode = 'native_yolm'`,
          (s) => {
            this.opts.content.renderAuthorizedDocumentPdf(
              s,
              sql`version_id::bigint`,
              "training_policy_pdf",
            );
            s.setHeader(sql.lit`Content-Type`, sql.lit`application/pdf`);
            s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
            s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
            s.return(sql`training_policy_pdf`);
          },
        );
      }
      s.if(
        sql`training_document_content.content_mode = 'external_link'
            and training_document_content.external_url is not null`,
        (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql`training_document_content.external_url`,
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
          s.setHttpStatus(303);
          s.return();
        },
      );
      s.if(
        sql`training_document_content.content_mode
                not in ('pdf_attachment', 'file_attachment')
            or training_document_content.blob_hash is null`,
        (s) => {
          s.setHttpStatus(404);
          s.return(sql.lit`Training file not found`);
        },
      );
      s.setHeader(
        sql.lit`Content-Type`,
        sql`coalesce(
            training_document_content.content_type,
            'application/octet-stream'
          )`,
      );
      s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
      s.setHeader(
        sql.lit`Content-Disposition`,
        sql`'inline; filename="' ||
            replace(replace(training_document_content.file_name, '"', ''),
              chr(10), '') || '"'`,
      );
      s.returnBlob(sql`training_document_content.blob_hash`);
    };
    const renderTrainingNativeImage = (
      s: EndpointStatements,
      accessToken?: Sql,
    ) => {
      loadTrainingDocument(s, accessToken);
      s.if(
        sql`training_document_content.content_mode != 'native_yolm'`,
        (s) => {
          s.setHttpStatus(404);
          s.return(sql.lit`Training native image not found`);
        },
      );
      s.defRecord(
        "training_native_image",
        this.opts.content.trainingNativeImageQuery({
          versionId: sql`version_id::bigint`,
          imageFileItemId: sql`image_file_item_id::bigint`,
          hashHex: sql`hash_hex`,
        }),
      );
      s.if(sql`training_native_image.blob_hash is null`, (s) => {
        s.setHttpStatus(404);
        s.return(sql.lit`Training native image not found`);
      });
      s.setHeader(
        sql.lit`Content-Type`,
        sql`training_native_image.content_type`,
      );
      s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
      s.returnBlob(sql`training_native_image.blob_hash`);
    };
    const redirectToTrainingExternalDocument = (
      s: EndpointStatements,
      accessToken?: Sql,
    ) => {
      loadTrainingDocument(s, accessToken);
      s.if(
        sql`
            training_document_content.content_mode != 'external_link'
            or training_document_content.external_url is null
          `,
        (s) => {
          s.setHttpStatus(404);
          s.return(sql.lit`Training external link not found`);
        },
      );
      s.setHeader(
        sql.lit`Location`,
        sql`training_document_content.external_url`,
      );
      s.setHeader(sql.lit`Cache-Control`, sql.lit`private, no-store`);
      s.setHttpStatus(303);
      s.return();
    };
    api.get("/training/introduction-images/{requested_file_version_id}", {
      procedure: (s) => renderCourseIntroductionImage(s, this.opts),
    });
    api.get(
      "/training/assignments/{assignment_id}/introduction-images/{requested_file_version_id}",
      {
        procedure: (s) =>
          renderCourseIntroductionImage(
            s,
            this.opts,
            sql`try_cast(assignment_id as bigint)`,
          ),
      },
    );
    if (trainingFeatureEnabled(this.opts, "inviteAccess")) {
      api.get(
        "/training/invite/{access_token}/assignments/{assignment_id}/introduction-images/{requested_file_version_id}",
        {
          procedure: (s) =>
            renderCourseIntroductionImage(
              s,
              this.opts,
              sql`try_cast(assignment_id as bigint)`,
              sql`access_token`,
            ),
        },
      );
    }
    api.get(
      "/training/tasks/{task_id}/documents/{version_id}/file",
      { procedure: (s) => renderTrainingDocumentFile(s) },
    );
    api.get(
      "/training/tasks/{task_id}/documents/{version_id}/external",
      { procedure: (s) => redirectToTrainingExternalDocument(s) },
    );
    api.get(
      "/training/tasks/{task_id}/documents/{version_id}/native-images/{image_file_item_id:id}/{hash_hex}",
      { procedure: (s) => renderTrainingNativeImage(s) },
    );
    if (trainingFeatureEnabled(this.opts, "inviteAccess")) {
      api.get(
        "/training/invite/{access_token}/tasks/{task_id}/documents/{version_id}/file",
        {
          procedure: (s) => renderTrainingDocumentFile(s, sql`access_token`),
        },
      );
      api.get(
        "/training/invite/{access_token}/tasks/{task_id}/documents/{version_id}/native-images/{image_file_item_id:id}/{hash_hex}",
        {
          procedure: (s) => renderTrainingNativeImage(s, sql`access_token`),
        },
      );
      api.get(
        "/training/invite/{access_token}/tasks/{task_id}/documents/{version_id}/external",
        {
          procedure: (s) =>
            redirectToTrainingExternalDocument(s, sql`access_token`),
        },
      );
    }
    if (complianceEnabled) {
      const renderCertificate = (s: EndpointStatements) => {
        s.callStoredProcedure("training_render_certificate", {
          inputScalars: { p_access_token: sql`certificate_access_token` },
          outputScalars: {
            certificate_id: "certificate_id",
            certificate_name: "certificate_name",
            certificate_html: "certificate_html",
          },
        });
        s.if(sql`certificate_id is null`, (s) => {
          s.setHttpStatus(404);
          s.return();
        });
      };
      api.get("/training/certificate/{certificate_access_token}", {
        procedure: (s) => {
          renderCertificate(s);
          s.setHeader(
            sql.lit`Content-Type`,
            sql.lit`text/html; charset=utf-8`,
          );
          s.setHeader(
            sql.lit`Content-Disposition`,
            sql`'inline; filename="' || replace(certificate_name, '"', '') || ' Certificate.html"'`,
          );
          s.return(sql`certificate_html`);
        },
      });
      api.get("/training/certificate-download/{certificate_access_token}", {
        procedure: (s) => {
          renderCertificate(s);
          s.setHeader(
            sql.lit`Content-Type`,
            sql.lit`text/html; charset=utf-8`,
          );
          s.setHeader(
            sql.lit`Content-Disposition`,
            sql`'attachment; filename="' || replace(certificate_name, '"', '') || ' Certificate.html"'`,
          );
          s.return(sql`certificate_html`);
        },
      });
      // Employee-file blobs are only served to the person the record
      // belongs to or a holder of the employee-file view permission —
      // knowing the blob hash is not authorization.
      const validateEmployeeFileApi = (s: EndpointStatements) => {
        AuthBlock.validateApi(s, sql.lit`y-t`);
        s.defScalar(
          "training_file_api_user",
          sql`coalesce(auth_user_id, current_user)`,
        );
      };
      const employeeFileAccessSql = (personRecord: Sql) =>
        sql`(
            ${this.opts.workforce.personSysUserId(personRecord)} =
              training_file_api_user
            or ${
          userHasPermission(
            sql.lit(trainingPermissions.viewEmployeeFiles),
            sql`training_file_api_user`,
          )
        }
          )`;
      api.get("/training/certification-proof/{hash_hex}", {
        procedure: (s) => {
          validateEmployeeFileApi(s);
          s.defRecord(
            "certification",
            sql`select c.proof_blob_hash, c.proof_content_type,
                    c.proof_file_name
                  from db.training_certifications c
                  join db.${sql.ref(personTable(this.opts))} p
                    on p.id = c.person_id
                  where c.proof_blob_hash = bytes.from_hex(hash_hex)
                    and ${employeeFileAccessSql(sql`p`)}
                  limit 1`,
          );
          s.if(sql`certification.proof_blob_hash is null`, (s) => {
            s.setHttpStatus(404);
            s.return();
          });
          s.setHeader(
            sql.lit`Content-Type`,
            sql`coalesce(certification.proof_content_type, 'application/octet-stream')`,
          );
          s.setHeader(
            sql.lit`Content-Disposition`,
            sql`'inline; filename="' || replace(coalesce(certification.proof_file_name, 'certification-proof'), '"', '') || '"'`,
          );
          s.returnBlob(sql`certification.proof_blob_hash`);
        },
      });
      api.get("/training/competency-evidence/{hash_hex}", {
        procedure: (s) => {
          validateEmployeeFileApi(s);
          s.defRecord(
            "competency_check",
            sql`select c.evidence_blob_hash, c.evidence_content_type,
                    c.evidence_file_name
                  from db.training_competency_checks c
                  join db.${sql.ref(personTable(this.opts))} p
                    on p.id = c.person_id
                  where c.evidence_blob_hash = bytes.from_hex(hash_hex)
                    and ${employeeFileAccessSql(sql`p`)}
                  limit 1`,
          );
          s.if(sql`competency_check.evidence_blob_hash is null`, (s) => {
            s.setHttpStatus(404);
            s.return();
          });
          s.setHeader(
            sql.lit`Content-Type`,
            sql`coalesce(competency_check.evidence_content_type, 'application/octet-stream')`,
          );
          s.setHeader(
            sql.lit`Content-Disposition`,
            sql`'inline; filename="' || replace(coalesce(competency_check.evidence_file_name, 'competency-evidence'), '"', '') || '"'`,
          );
          s.returnBlob(sql`competency_check.evidence_blob_hash`);
        },
      });
      api.get(
        "/training/personnel-document/{hash_hex}",
        {
          procedure: (s) => {
            validateEmployeeFileApi(s);
            s.defRecord(
              "personnel_document",
              sql`select d.blob_hash, d.content_type, d.file_name
                  from db.training_personnel_documents d
                  join db.${sql.ref(personTable(this.opts))} p
                    on p.id = d.person_id
                  where d.blob_hash = bytes.from_hex(hash_hex)
                    and ${employeeFileAccessSql(sql`p`)}
                  limit 1`,
            );
            s.if(sql`personnel_document.blob_hash is null`, (s) => {
              s.setHttpStatus(404);
              s.return();
            });
            s.setHeader(
              sql.lit`Content-Type`,
              sql`coalesce(personnel_document.content_type, 'application/octet-stream')`,
            );
            s.setHeader(
              sql.lit`Content-Disposition`,
              sql`'inline; filename="' || replace(coalesce(personnel_document.file_name, 'personnel-document'), '"', '') || '"'`,
            );
            s.returnBlob(sql`personnel_document.blob_hash`);
          },
        },
      );
    }
  }

  AdminRoutes = () => <TrainingAdminRoutes block={this} />;

  EmployeeRoutes = (props?: { showPortalNav?: boolean }) => {
    return (
      <TrainingEmployeeRoutes
        block={this}
        showPortalNav={props?.showPortalNav ?? false}
      />
    );
  };

  EmployeeSidebarMenuItems = (props: { shellLanguage: Sql }) => {
    return (
      <TrainingEmployeeSidebarMenuItems
        block={this}
        shellLanguage={props.shellLanguage}
      />
    );
  };

  AccessRoutes = () => <TrainingAccessRoutes block={this} />;
}

export type {
  TrainingBlockOpts,
  TrainingPersonnelDocumentTypeOpts,
  TrainingRetrainingSourceOpts,
  TrainingRouteOpts,
} from "./types";
export {
  DriveTrainingDocumentAdmin,
  TrainingDriveExtension,
} from "./drive_documents";
export type {
  TrainingContentPublicationConsumer,
  TrainingContentPublicationEvent,
  TrainingDriveExtensionOpts,
} from "./drive_documents.tsx";
