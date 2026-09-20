---
title: Meeting Integrations
description: MeetingIntegration interface plus the bundled Zoom integration for attaching provider meetings to scheduled appointments.
tags:
  - blocks
  - zoom
  - scheduling
  - meetings
  - oauth
related:
  - blocks/scheduling.md
  - blocks/oauth_credentials.md
  - blocks/solution_blocks.md
  - concepts/blocks.md
---

# Meeting Integrations

`blocks/meeting_integrations` defines the `MeetingIntegration` interface — the
contract every meeting-provider integration implements — and ships
`ZoomIntegration`, a ready-to-use Zoom implementation. Register an integration
as a system block and reference it from `SchedulingBlock.meetingIntegrations` so
that creating, editing, or deleting an appointment also creates, updates, or
deletes the provider meeting. Use this block instead of writing custom Zoom
OAuth + meeting schema by hand.

```tsx
import { ZoomIntegration } from "blocks/meeting_integrations/zoom";
import type { ZoomIntegrationExtensions } from "blocks/meeting_integrations/zoom";
import { iterateOverIntegrationsAndCreateMeeting } from "blocks/meeting_integrations";
import type {
  CreateMeetingOpts,
  DeleteAccountOpts,
  DeleteMeetingOpts,
  MeetingIntegration,
  MeetingIntegrationConstructor,
  UpdateMeetingOpts,
} from "blocks/meeting_integrations";
```

## Minimal Setup

`ZoomIntegration` stores per-user OAuth credentials via the managed OAuth
service, so it requires `OAuthCredentialsBlock` (which provides the
`managed_oauth_credentials` table whose id `user_zoom_accounts.credential_id`
holds). Register both blocks, then wire Zoom into `SchedulingBlock`.

```tsx
import { OAuthCredentialsBlock } from "blocks/oauth_credentials";
import { SchedulingBlock } from "blocks/scheduling";
import { ZoomIntegration } from "blocks/meeting_integrations/zoom";
import { sql } from "std/sql_utils";

system.addBlock(new OAuthCredentialsBlock());

system.addBlock(
  new ZoomIntegration({
    provider: "zoom_meeting",
    scopes: sql`json_build_array(
      'meeting:write:meeting',
      'meeting:delete:meeting',
      'meeting:update:meeting',
      'meeting:read:meeting',
      'meeting:read:list_meetings',
      'user:read:user'
    )`,
    redirectUri: sql
      .lit`https://yolmglobalapi.com/can-write/zoom-meeting-oauth-redirect`,
    verificationSecret: sql.lit`your-zoom-webhook-secret`,
  }),
);

system.addBlock(
  new SchedulingBlock({
    // ...other required SchedulingBlock options
    meetingIntegrations: [
      {
        integration: ZoomIntegration,
        addToMeeting: true,
        meetingIdField: "zoom_meeting_id",
      },
    ],
  }),
);
```

`SchedulingBlock` drives the rest: it adds the `<meetingIdField>`,
`<meetingIdField>_join_url`, and `<meetingIdField>_password` columns to its
appointment table, calls `createMeeting` / `updateMeeting` / `deleteMeeting`,
and renders the per-user account-connection card (icon, account display, connect
and disconnect buttons) on its integrations page. You do not call those methods
or render that UI directly in normal use.

## Configuration

`ZoomIntegration` constructor options (the options type itself is not exported):

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `provider` | `string` | yes | Managed-OAuth provider key passed to the `managed_oauth` service (e.g. `"zoom_meeting"`). |
| `scopes` | `Sql` | yes | SQL expression yielding a JSON array of requested OAuth scopes. |
| `redirectUri` | `Sql` | yes | OAuth redirect URI. Currently declared but not read by the block (the callback URL is derived at runtime); still required by the type. |
| `verificationSecret` | `Sql` | yes | Shared secret. Used to authorize the `/zoom-deregister` webhook — the request's `authorization` header must equal it. |
| `extensions` | `ZoomIntegrationExtensions` | no | Optional server-statement hooks (see below). |

### ZoomIntegrationExtensions

Exported from `blocks/meeting_integrations/zoom`. Pass via the `extensions`
option to run extra logic without forking the block.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `onDeregisterReceived` | `<T extends IServerBaseStatements>(s: T, ctx: { body: Sql }) => void` | no | Runs when Zoom posts to the app-deauthorization (deregister) webhook, before the account is disconnected. `ctx.body` is the raw request body. |

```tsx
new ZoomIntegration({
  provider: "zoom_meeting",
  scopes: sql`json_build_array('meeting:write:meeting')`,
  redirectUri: sql
    .lit`https://yolmglobalapi.com/can-write/zoom-meeting-oauth-redirect`,
  verificationSecret: sql.lit`your-zoom-webhook-secret`,
  extensions: {
    onDeregisterReceived: (s) => {
      s.captureExecution();
    },
  },
});
```

## Tables Created

`ZoomIntegration.initialize()` creates one enum and one table:

| Name | Purpose |
| --- | --- |
| enum `zoom_connection_status` | Values `active`, `reauth_required`. |
| table `user_zoom_accounts` | Per-user connected Zoom account. |

`user_zoom_accounts` columns:

| Column | Notes |
| --- | --- |
| `sys_user_id` | FK to `sys_users`, not null. |
| `credential_id` | `bigUint`, not null, unique. Holds the `managed_oauth_credentials.id` returned by the managed OAuth service (a stored id, not an enforced schema FK). |
| `email` | The connected Zoom account email. |
| `zoom_user_id` | `string(255)`, the Zoom user/subject id. |
| `granted_scopes` | `string(1000)`. |
| `status` | enum `zoom_connection_status`, not null, default `'active'`. |
| `created_at` | `timestampUtc`, not null, default `now()`. |

The account table name is also exposed as `ZoomIntegration.accountTable`
(`"user_zoom_accounts"`), and `ZoomIntegration.isActiveAccount` is the SQL
predicate `status = 'active'`.

## Endpoints

`addOauthRedirect(app)` (called by `SchedulingBlock` for each registered meeting
integration) registers:

| Method + Path | Scope | Purpose |
| --- | --- | --- |
| `GET /api/can-write/zoom-oauth-callback` | `app.domain` and every `app.domainAliases` | Completes the OAuth callback, upserts the `user_zoom_accounts` row, then 303-redirects to `/integrations`. |
| `GET /can-write/zoom-meeting-oauth-redirect` | global API | Resolves the original host and forwards the OAuth callback to the right app domain. |
| `POST /zoom-deregister` | global API | Zoom app-deauthorization webhook; verifies the `authorization` header against `verificationSecret`, disconnects the managed credential, and deletes the account row. |

## Provider authoring

Most solution developers only configure the bundled `ZoomIntegration` above;
`SchedulingBlock` owns provider calls and the connection UI. If a system needs
a custom provider, inspect the exported `MeetingIntegration` types in Forge and
follow the same capability, OAuth, callback, and scheduling contracts.

## External Service Capabilities

`ZoomIntegration` declares opt-in external-service capabilities (surfaced for
approval/capability gating) under block key `ZoomIntegration`:

| Capability key | Label |
| --- | --- |
| `oauth` | OAuth |
| `create_meetings` | Create and manage meetings |

The block gates its `managed_oauth` and meeting `serviceRequest` calls on these
capabilities.

## Common Mistakes

- Registering `ZoomIntegration` without `OAuthCredentialsBlock`. The
  `credential_id` column holds the id of a `managed_oauth_credentials` row;
  OAuth fails without that table.
- Importing `ZoomIntegration` from `blocks/meeting_integrations`. It lives in the
  submodule `blocks/meeting_integrations/zoom`; only the interface, opt types,
  and helper come from `blocks/meeting_integrations`.
- Calling `createMeeting` / `updateMeeting` / `deleteMeeting` or rendering the
  connect card yourself. `SchedulingBlock` invokes these and renders the account
  UI; you just register the block and list it in `meetingIntegrations`.
- Forgetting `meetingIdField` in the `SchedulingBlock.meetingIntegrations` entry.
  It names the appointment column (plus `_join_url` and `_password` companions)
  the integration writes to.
- Setting `verificationSecret` to a placeholder. It authorizes the
  `/zoom-deregister` webhook; an unmatched `authorization` header returns 401.
- Assuming `integrationName` is free-form. It must match the scheduling event
  type location enum value (compared lower-cased, e.g. `Zoom` -> `zoom`).
