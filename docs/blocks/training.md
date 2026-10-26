---
title: Training Block
description: Courses, governed-content assignments, validation, notifications, assessments, and optional compliance features composed with Drive.
tags:
  - blocks
  - training
  - compliance
  - assignments
related:
  - blocks/drive.md
  - blocks/workforce.md
  - blocks/auth.md
  - concepts/blocks.md
  - procedures/patterns.md
---

# Training Block

`TrainingBlock` owns training obligations and evidence: audiences,
requirements, courses, assessments, assignments, tasks, acknowledgments,
essays, signatures, validation, notifications, and optional compliance
records. Content is a stable Drive file governed by `ControlledFileLifecycle`;
Training owns no document storage. Only one `TrainingBlock` may be constructed
in a system.

## Composition

Register Auth and Workforce, then Drive (native documents, optional external
links, controlled lifecycle, and `TrainingDriveExtension` on the same space
type), then User Notifications, then Training.

~~~tsx
import { AuthBlock } from "blocks/auth";
import { DriveBlock, type DriveSpaceType } from "blocks/drive";
import {
  ControlledFileLifecycle,
  sysUsersControlledFileActor,
} from "blocks/drive/controlled_lifecycle";
import { ExternalLinkExtension } from "blocks/drive/external_link";
import { NativeDocumentExtension } from "blocks/drive/native_document";
import {
  TrainingBlock,
  TrainingDriveExtension,
  trainingNotificationSourceConfig,
  trainingNotificationSourceKey,
} from "blocks/training";
import { UserNotificationsBlock } from "blocks/user_notifications";
import { WorkforceBlock } from "blocks/workforce";
import { sql } from "std/sql_utils";
import { system } from "std/system";

system.addBlock(new AuthBlock({
  permissions: [
    ...DriveBlock.permissions,
    ...ControlledFileLifecycle.permissions,
    ...TrainingBlock.permissions,
  ],
  appAuthTypes: ["email_password"],
}));

const workforce = new WorkforceBlock({ /* ... */ });
system.addBlock(workforce);

const nativeDocuments = new NativeDocumentExtension();
const externalLinks = new ExternalLinkExtension();
const control = new ControlledFileLifecycle({
  actor: sysUsersControlledFileActor(),
  languages: [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish", nativeName: "Español" },
  ],
  defaultLanguage: "en",
});
const trainingContent = new TrainingDriveExtension({
  control,
  nativeDocuments,
  externalLinks,
  appDomains: ["training-admin.example.com", "training.example.com"],
  routes: {
    adminBasePath: "/library",
    readerBasePath: "/knowledge",
  },
});
const policyLibrary: DriveSpaceType = {
  name: "policy_library",
  itemOrdering: "name",
  lifecycle: control,
  extensions: [nativeDocuments, externalLinks, trainingContent],
  access: {
    read: (_space, _binding, userId) => sql`${userId} is not null`,
    write: (_space, _binding, userId) =>
      AuthBlock.userHasPermission(sql.lit`can_manage_drive`, userId),
  },
};
const drive = new DriveBlock({ spaceTypes: [policyLibrary] });
system.addBlock(drive);

const notifications = new UserNotificationsBlock({
  identity: {
    isActive: (userId) => sql`exists (
      select 1 from db.sys_users
      where id = ${userId} and not disabled
    )`,
    email: (userId) => sql`(
      select person.email
      from db.workforce_people person
      where ${workforce.personSysUserId(sql`person`)} = ${userId}
    )`,
  },
  sources: [trainingNotificationSourceConfig({ workforce })],
  email: {
    domain: "training.example.com",
    from: "Training <training@example.com>",
    applicationName: "Training",
  },
});
system.addBlock(notifications);

const training = new TrainingBlock({
  content: trainingContent,
  notifications: notifications.source(trainingNotificationSourceKey),
  workforce,
  features: {
    inviteAccess: { enabled: false },
    compliance: { enabled: true },
  },
  retrainingSources: [{ code: "manual", name: "Manual" }],
  personnelDocumentTypes: [{ code: "other", name: "Other" }],
});
system.addBlock(training);
~~~

The Drive space type is the policy boundary; controlled workflow adds no
per-document ACLs. Proposal, review, and publication follow
[Drive's controlled lifecycle](drive.md).

## Admin and employee UI

The consumer composes Drive and Training surfaces explicitly:

~~~tsx
<DriveBlock.Endpoints files={drive} cookieName={sql.lit`y-t`} />

// Admin library and selected governed file
<DriveWorkspace files={drive} spaceId={sql`policy_space_id`} />
<ControlledFileWorkspace
  files={drive}
  control={control}
  fileItemId={sql`policy_file_item_id`}
  language={sql`policy_language`}
/>
<DriveTrainingDocumentAdmin
  documents={trainingContent}
  fileItemId={sql`policy_file_item_id`}
/>
<training.AdminRoutes />

// Employee knowledge and assignments
<ControlledFileLibrary
  files={drive}
  control={control}
  preferredLanguage={sql`employee_language`}
  fileHref={(itemId, language) =>
    sql`'/knowledge/' || cast(${itemId} as string) || '/' || ${language}`}
/>
<PublishedControlledFile
  files={drive}
  control={control}
  fileItemId={sql`policy_file_item_id`}
  language={sql`policy_language`}
  backHref="/knowledge"
/>
<training.EmployeeRoutes />
~~~

`DriveTrainingDocumentAdmin` renders Training-owned settings beside the
selected controlled file. External-link assignments open through
Training-owned authenticated or invite-token redirects, so the stored target is
never exposed before the assigned task and exact controlled revision are
authorized.

Course editors can use **Preview course** before publishing or assigning a
course. Preview loads the selected language's saved draft when available,
otherwise its published course. If neither exists, it shows “No Spanish version
found” (or the selected language) without showing another language's course.
Available previews use the learner's step and answer controls. Responses, quiz scores,
signatures, and progress exist only in the mounted preview; restarting, changing
language, or leaving clears them. Preview creates no assignments, training
evidence, notifications, or certificates.

Linked courses use their published versions. Assessments prefer their saved
draft and warn that it must be published separately before employees can receive
it. Supporting documents use the same published language resolution as an
assignment and retain Drive's access checks. Trainer review can be simulated
explicitly; preview does not send review requests or enforce real attempt
limits/cooldowns. Access requires the course-library management permission.

Enable `features.courseIntroduction.enabled` to let course editors add an
optional **Introduction** with formatted text and
images; the editor toolbar's **Insert image** button picks a published Company
Files image, inserted centered. The file title supplies alternative text
automatically. Select an inserted image and use the toolbar alignment buttons to
move it left, center, or right.
Learners first see the introduction, then **Begin course** opens the
steps. The **Course outline** beside the course lists **Introduction**, each
section with its steps and progress, and **Review and submit**. Finishing the last step keeps the assignment in
progress and its responses editable. Employees explicitly **Complete course**
or **Submit for verification** after reviewing; required final signatures are
collected in this submission step. Submission locks answers, and only completed
assignments can issue certificates. Standalone document acknowledgment still
completes its document assignment. One section shows at a time, with **Previous
section** and **Next section** buttons and no per-step gates; switching keeps
responses and drawn signatures. Returning to the introduction shows **Continue
course**. Preview uses the same flow. Courses without introduction content open
directly on their steps. Nested course introductions appear before that
course's steps. Reading an introduction does not create a task or require an
acknowledgment. The existing Purpose field is unchanged.

Course introductions default to disabled. Disabling the feature hides the editor,
introduction navigation, and nested introductions in learner and preview views;
courses open directly on their steps. Introduction saves and image endpoints are
also disabled. Existing introduction content and pinned images remain stored, so
re-enabling the feature restores them. The training example enables this feature
explicitly.

Introduction content belongs to `training_course_versions.introduction`. The
`training_course_introduction_images` relation pins exact file versions for
retention and authorized image delivery. Assignments snapshot the root course
version in `training_assignments.training_course_version_id`; open assignments
advance on publication, while completed and validation-pending assignments retain
their version. An introduction-only edit preserves existing tasks, answers,
signatures, document snapshots, and assessment attempts. These are additive schema
changes; existing assignments with no version snapshot do not gain a historical
introduction retroactively. Empty introductions are stored as null.

The course list defaults to **Active**, with **Archived** and **All courses**
status filters. Each course's actions menu offers **Archive course** or
**Restore course**. Archiving retains assignments and training history, while
preventing new direct or automatic assignments, including through a program.
Publishing also requires the course and every nested course in its draft to be
active, so publishing cannot assign new steps from an archived course. Restore
or remove archived nested courses before publishing. Restoring makes the course
available again and allows its existing assignment rules to resume. **Delete course** permanently removes a never-assigned course,
its versions, steps, and assignment rules after confirmation. Courses with
assignment history, training-history links, or references from another course
or stored section cannot be deleted. Supporting files and assessments are kept.

Administrators can withdraw an unsubmitted course assignment while it has
outstanding tasks. Withdrawal requires a reason, retains completed evidence, and
suppresses automatic reassignment of the same course version and language across
all matching rules until a later course completion. Manual assignments and new
course versions remain eligible. Assignments with all steps finished show
**Ready to submit**; submitted assignments awaiting validation show **Awaiting
verification**, and only completed assignments show **Completed**.

## Version and language behavior

Document training settings and audience links attach to the stable Drive file
item. Each assignment snapshots the exact published controlled revision for
the participant's preferred language, falling back to the default language.
Course assignments pin a published course version and supporting file revisions.
Assessment attempts pin the published assessment version when they start.
Company Files images and videos display their latest published language version
when the course or task is opened, including completed steps. The stored
assignment references remain unchanged for history. Introduction images also
resolve the latest published image while authorizing the recorded course link.
Previously published media revisions of the assigned file remain readable in
the assignment's language or default language, so another publication does not
interrupt an open player. Owner and invite access checks still apply; draft
revisions and unrelated files are not included in this access.

- Publishing a later translation moves an open fallback task to it, keeping
  the due date.
- Publishing a later same-language revision advances an open task, or creates
  a new obligation after an earlier completion.
- Completed tasks keep their original revision and language.

Courses and assessments keep one identity with independent draft/published
versions for each configured content language. A non-default-language draft
requires a published default-language source from the same course or assessment,
through both the editor and Spark. Later revisions retain that source link even
when a newer default-language publication archives the original. Unlinked
translations cannot be published. The admin editor's **Content
language** switch beside the back link chooses which version to edit; it is
hidden when only one language is configured. The pencil beside the title edits
that language's title and description. On wide screens the editor shows a
section-and-step outline, the course sections, and a side panel holding
**Course settings** or, after **Edit task**, the selected step's editor. Edit and save directly;
the editor creates or reuses an unpublished version automatically, without a
separate **Create draft** step. **Publish changes** makes saved course edits
available to training, and **Discard changes** restores the published content.
Opening the editor or switching languages does not create versions. If a
translation is missing, ask Spark to prepare it from the published default
language, then send it for review and publish it in the editor. Assignments and automatic
rules use the participant's assigned language, with default-language fallback
until that translation is published. Publishing a translation preserves the
default version and completed evidence. Reassignment rules still apply to new
language versions; source lineage does not imply equivalent training content.
Title/description-only course publications preserve open task and attempt state.

Spark prepares translations using the Training capability's
`get_translation_source` and `save_translation_draft` tools. Spark translates the
returned text; the save tool clones the published default-language version and
applies that text to a draft of the same course or assessment. It preserves
links, requirements, scoring, correct choices, images, and introduction
formatting. The training block makes no AI service calls itself.

Review and publish each translated course and linked assessment separately.
Existing drafts are never overwritten by translation creation. Incomplete text,
changed source versions, and competing drafts are rejected. Updated
default-language sources show a review warning on older translations. Files
retain their existing language resolution, and images are shared.

The language model adds `language`, `source_version_id`,
`localized_name`, and `localized_description` on each existing course/assessment
version table. Language defaults to the configured default language for existing
rows; the other fields are nullable.

### Translation approval

In a translated course or assessment, **Translation approval** lets a manager
choose active reviewers in order and **Send for review**. Reviewers need a login
and employee portal access; the assignment grants access to that review, without
course-editing or Drive-browsing permissions. **Translation reviews** is available
under both the configured admin and authenticated employee route prefixes.

The first reviewer receives a notification. Each approval notifies the next
reviewer; a request for changes requires a comment and notifies the requester.
After every reviewer approves, the requester is notified that publication is
available. Notifications use the configured Training source and its existing
inbox/email delivery settings. Review itself does not publish content.

The review page shows the exact recorded source and translation side by side,
including task prompts, assessment choices and explanations, metadata fields,
introductions and supporting files. Linked assessments, courses and supporting
documents retain their independent publication workflows. Supporting documents
show their current published language version with the usual fallback.
Employee review controls follow the reviewer's preferred language independently
of the source and translation content; administrative controls remain English.
When review starts, legacy versions with missing localized metadata capture the
currently displayed title and description in their existing version fields, so
later English publication cannot change the review history.

Pending and approved translations are locked against UI and Spark edits. Managers
can **Withdraw review** to change the wording or reviewer order; previous
approvals then cannot authorize publication. Editing a returned or withdrawn
translation archives the reviewed version and clones it into a new draft,
preserving its source link, content and review history. Discarding reviewed
changes also archives their evidence. Courses with review history are archived
instead of deleted. After publication, normal editing can start a new revision.

Both publication procedures require approval of the latest review round for a
non-default language. Existing publications remain available; default-language
publication is unchanged. Spark can publish an approved translation with an
ID, language and `publish: true`; it cannot change reviewed wording and publish
in the same request.

Translation reviews reuse Document Control's `controlled_file_reviewers` table
and `controlled_file_review_decision` enum (`approved`, `rejected`). The training
UI labels rejection as **Changes requested**. Resubmission prefills the previous
reviewers in order, excluding people who are no longer eligible.

| Schema change | Fields | Writer and readers |
| --- | --- | --- |
| New `training_translation_reviews` table | `training_course_version_id`, `training_assessment_version_id` (exactly one); `requested_by_id`, `requested_at`, `withdrawn_at` | Request/withdraw procedures; review pages, notifications, editing and publication guards |
| Extend `controlled_file_reviewers` | Add nullable `training_translation_review_id`; relax `controlled_file_revision_id` to nullable and require exactly one target; unique training target/step and training target/reviewer | Training request procedure writes the configured actor ID and order; both workflows use `controlled_file_record_review_decision`; their pages and notification routes read the decisions |

The existing reviewer fields (`reviewer_actor_id`, `step_number`, `decision`,
`notes`, `decided_at`) and policy identities remain unchanged. Review comments
share the existing 2,000-character limit. No training decision enum or separate
reviewer table is added. The `training_translation_reviewers` **view** scopes the
shared records and maps the configured actor identity to a user account; the
`training_translation_review_state` view derives status and next reviewer. No
course/assessment fields or stored approval totals are added. New request rows
and the nullable reference are additive; deployment compatibility must also
validate the relaxed nullability and ownership/uniqueness constraints.

Company resource spaces can use the same content extension with Drive's
`publishOnUpload` lifecycle option. Course resource selectors show the source
workspace and require Drive read access. Employees receive access only to the
exact revisions linked to their assigned tasks through Training's authorized
file endpoints; this does not grant workspace browsing. Linked JPEG, PNG, GIF,
and WebP images render inline beside the training instructions and response.
PDFs and videos resolve the participant's language with the existing default
fallback. Upload English and Spanish videos as language versions of the same
Company file, then choose it as a step's **Supporting file**. Videos play inline
in course previews, assigned courses, and individual tasks using `VideoPlayer`.
With Drive's `ExternalLinkExtension.videoSpaceTypes` enabled, each language
version can instead use a supported YouTube or Vimeo link. Company files offers
**Add video link** and per-language upload/link replacement; the same supporting
file stays linked to the course when its source changes. Provider players load
inside the course on **Play video**, without autoplay. Stored assignment
snapshots retain their version references under the existing publication rules,
while images and videos display the latest published media. The derived
`training_task_item_document_versions` view supplies the same displayed
revision to the course, task page, and authorized file endpoint.
Playback does not require opening another page or workspace access. Unsupported
browser codecs show the player's download fallback.

New external-link steps are no longer offered in section templates or accepted
by `save_course`; add the video or file to Company files instead. Historical
link steps remain readable, with their stored schema and evidence retained.
Stored sections containing retired link steps must be converted before they can
be appended to a course; a rejected append leaves the course unchanged.

## Configuration

| Option | Required | Meaning |
| --- | --- | --- |
| `content` | Yes | `TrainingDriveExtension` installed with its controlled lifecycle and native document extension on one or more Drive space types. |
| `notifications` | Yes | Configured `training.assignment` notification source. |
| `workforce` | Yes | Person roster, assignments, and audience facets. |
| `completionAttestation` | No | Statement snapshotted when a participant signs. |
| `routes` | No | Prefixes: `adminBasePath` (`/training-admin`), `employeeBasePath` and `accessBasePath` (`/training`). |
| `features.inviteAccess.enabled` | No | Adds login-free token schema/routes. Defaults to false. |
| `features.courseIntroduction.enabled` | No | Enables course introduction editing and display. Defaults to false; disabling preserves saved content. |
| `accessDomain` | With invite access | Domain used to build `https://<accessDomain><accessBasePath>/invite/<token>` links. |
| `features.compliance.enabled` | No | Adds certification, retraining, competency, and personnel-file schema. Defaults to false. |
| `retrainingSources` | With compliance | Immutable configured retraining source codes. |
| `personnelDocumentTypes` | With compliance | Immutable configured personnel-file type codes. |

The remaining options configure validation labels, date formats, course
defaults, certification presentation, and secondary-validator behavior. See
`TrainingBlockOpts` in `packages/blocks/training/types.ts`.

## Permission boundary

Register `DriveBlock.permissions`, `ControlledFileLifecycle.permissions`, and
`TrainingBlock.permissions` with Auth. Workflow permissions do not bypass Drive
access: participants read a task's snapshotted content through task-authorized
endpoints, while the policy library follows the space type's access predicates.

## Spark tools

`trainingSparkCapability(training)` from `blocks/training/spark` exposes
Training administration to Spark and MCP.

~~~tsx
import { trainingSparkCapability } from "blocks/training/spark";

new SparkBlock({ /* ... */ capabilities: [trainingSparkCapability(training)] });
~~~

- `get_course` / `save_course` and `get_assessment` / `save_assessment` read
  and write one JSON document per course or assessment. Optional `language`
  selects a language version (omitting it uses the default language).
  Name/description edits remain drafts until publication. Saving `sections`
  (and an assessment's `metadata_fields`) replaces the draft content; other
  fields update only when present. Course items return attachments as
  `documents: [{ document_id, label }]`; preserve those labels when saving,
  including translated or null labels. Legacy `document_ids` is also accepted
  for new attachments using document titles; do not supply both forms.
  `publish: true` publishes the draft.
- `get_translation_source` reads all text from a published default-language
  course or assessment. Spark supplies the translated text to
  `save_translation_draft`, which creates a linked draft without changing
  structure or publishing it. Both use `{ kind: 'course' | 'assessment', id }`;
  saving also takes `language`, `source_version_id`, and `translations`.
- `set_document_training` sets a governed document's essay and reminder
  settings, `assign` assigns a course or document to people, and `save_rule`
  creates or ends an ongoing audience rule.

Actions are reversible and check the same Training permissions as the admin
screens. Publication uses the same language-aware stored procedures as the admin
editors. The original `training_publish_course_draft` and
`training_publish_assessment_draft` procedures remain default-language wrappers.

Native-document image uploads expire if no save references them; saved
versions pin the exact images they use.

`examples/document_training` is the canonical end-to-end example.
