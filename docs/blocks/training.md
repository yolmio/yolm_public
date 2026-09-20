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
records.

It does not own a second document system. Training content is a stable Drive
file governed by `ControlledFileLifecycle`; each assignment snapshots the
exact published controlled revision selected for the participant's language.
File identity, folders, tags, native or uploaded content, immutable technical
versions, review, and publication remain in Drive.

Only one `TrainingBlock` may be constructed in a system.

## Composition

Initialize the blocks in dependency order:

1. Auth and Workforce
2. Drive with native documents, optional external links, controlled lifecycle,
   and `TrainingDriveExtension` on the same space type
3. User Notifications
4. Training

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

const workforce = new WorkforceBlock({ /* ... */ });
system.addBlock(workforce);

system.addBlock(new AuthBlock({
  permissions: [
    ...DriveBlock.permissions,
    ...ControlledFileLifecycle.permissions,
    ...TrainingBlock.permissions,
  ],
  appAuthTypes: ["email_password"],
}));

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

The Drive space type is the policy boundary. In an organization space,
members may read published policies by default; switching the whole space to
restricted is available only when the type permits it. Controlled workflow
does not add per-document user ACLs.

Any signed-in controlled-file actor with space access can create and submit a
proposal. The proposer does not select approvers. A user with
`can_manage_controlled_files` validates the proposal, assigns the ordered
reviewers, starts review, and publishes the approved revision.

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
selected controlled file. The employee library and reader render the exact
published file version selected by the controlled revision; they never follow
an unrelated working head. External-link assignments open through
Training-owned authenticated or invite-token redirects, so the stored target
is never exposed without first authorizing the assigned task and exact
controlled revision.

## Version and language behavior

Drive technical versions and controlled revisions serve different purposes:

- every native save or uploaded replacement appends an immutable
  `file_versions` row;
- a language variant owns its controlled revision history;
- the draft revision points at an exact technical version and records prior
  draft checkpoints;
- publication moves only that language variant's published pointer;
- an assignment or course snapshot stores the exact controlled revision.

Training first resolves the participant's preferred language and then falls
back to the configured default language. Publishing a later translation moves
an open fallback task to the translation while preserving its due date.
Completed tasks keep their original revision and language. Publishing a later
same-language revision advances an open task or creates a new obligation after
an earlier completion.

Document training settings and audience links attach to the stable Drive file
item. Courses snapshot their sections, tasks, supporting file revision IDs,
and assessment versions when published.

## Configuration

| Option | Required | Meaning |
| --- | --- | --- |
| `content` | Yes | `TrainingDriveExtension` installed with its controlled lifecycle and native document extension on one or more Drive space types. |
| `notifications` | Yes | Configured `training.assignment` notification source. |
| `workforce` | Yes | Person roster, assignments, and audience facets. |
| `completionAttestation` | No | Statement snapshotted when a participant signs. |
| `routes` | No | Admin, employee, and login-free access prefixes. |
| `features.inviteAccess.enabled` | No | Adds login-free token schema/routes. Defaults to false. |
| `features.compliance.enabled` | No | Adds certification, retraining, competency, and personnel-file schema. Defaults to false. |
| `retrainingSources` | With compliance | Immutable configured retraining source codes. |
| `personnelDocumentTypes` | With compliance | Immutable configured personnel-file type codes. |

The remaining options configure validation labels, date formats, course
defaults, certification presentation, and secondary-validator behavior. See
`TrainingBlockOpts` for the public type.

## Permission boundary

Register all three permission arrays with Auth:

- `DriveBlock.permissions` administers organization-managed spaces and Drive
  grants;
- `ControlledFileLifecycle.permissions` assigns reviewers, reviews, and
  publishes governed files;
- `TrainingBlock.permissions` manages settings, audiences, assignments,
  courses, assessments, validation, notifications, and compliance work.

Workflow permissions do not bypass Drive access. Training participants read a
task's snapshotted content through task-authorized endpoints, while the
ordinary policy library still follows the space type's Drive access predicates.

## Uploads and embedded images

Uploaded policy files use Drive's direct/chunked blob protocol and immutable
`file_version_blobs`; large files are streamed in bounded browser chunks.
Native-document images use the same blob upload protocol. Pending image rows
expire if a save never references them, and saved versions pin the exact image
rows they use.

## Reference implementation

`examples/document_training` is the canonical end-to-end example. Its tests
cover publication-driven assignment, language fallback and rollout,
assessments, courses, compliance, notification behavior, exact-version
access, native-image cleanup, and completion evidence.
