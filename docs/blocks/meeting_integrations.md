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

`blocks/meeting_integrations` defines the `MeetingIntegration` contract for
meeting providers and ships `ZoomIntegration`. Reference a registered
integration from `SchedulingBlock.meetingIntegrations` so creating, editing, or
deleting an appointment also creates, updates, or deletes the provider meeting.

`ZoomIntegration` and `ZoomIntegrationExtensions` are imported from the
submodule `blocks/meeting_integrations/zoom`; the interface, opt types
(`CreateMeetingOpts`, `UpdateMeetingOpts`, `DeleteMeetingOpts`,
`DeleteAccountOpts`, `MeetingIntegrationConstructor`), and
`iterateOverIntegrationsAndCreateMeeting` come from `blocks/meeting_integrations`.

## Minimal Setup

`ZoomIntegration` stores per-user OAuth credentials through the managed OAuth
service, so managed OAuth must be configured for the system.

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

`meetingIdField` is required: `SchedulingBlock` adds that column plus
`<meetingIdField>_join_url` and `<meetingIdField>_password` to its appointment
table, calls `createMeeting` / `updateMeeting` / `deleteMeeting`, and renders
the per-user connect/disconnect card on its integrations page. Do not call
those methods or render that UI yourself.

## Configuration

`ZoomIntegration` constructor options (the options type is not exported):

| Option | Meaning |
| --- | --- |
| `provider` | Managed-OAuth provider key (e.g. `"zoom_meeting"`). |
| `scopes` | SQL expression yielding a JSON array of OAuth scopes. |
| `redirectUri` | Required by the type but currently not read; the callback URL is derived at runtime. |
| `verificationSecret` | Must equal the `authorization` header of `/zoom-deregister` requests; a mismatch returns 401, so never leave a placeholder. |
| `extensions` | Optional `ZoomIntegrationExtensions`. `onDeregisterReceived(s, { body })` runs with the raw request body when Zoom posts the deauthorization webhook, before the account is disconnected. |

## Owned schema

- `user_zoom_accounts` (also `ZoomIntegration.accountTable`): one connected
  Zoom account per user. `credential_id` stores the `managed_oauth_credentials`
  id returned by the managed OAuth service (not an enforced foreign key).
- `zoom_connection_status` enum: `active`, `reauth_required`.
  `ZoomIntegration.isActiveAccount` is the predicate `status = 'active'`.

## Endpoints

`addOauthRedirect(app)` (called by `SchedulingBlock` for each meeting
integration) registers:

| Method + Path | Scope | Purpose |
| --- | --- | --- |
| `GET /api/can-write/zoom-oauth-callback` | `app.domain` and every `app.domainAliases` | Completes the OAuth callback, upserts the account row, then 303-redirects to `/integrations`. |
| `GET /can-write/zoom-meeting-oauth-redirect` | global API | Resolves the original host and forwards the callback to the right app domain. |
| `POST /zoom-deregister` | global API | Verifies `verificationSecret`, disconnects the managed credential, and deletes the account row. |

## External Service Capabilities

`ZoomIntegration` gates its `managed_oauth` and meeting `serviceRequest` calls
on opt-in capabilities under block key `ZoomIntegration`: `oauth` (OAuth) and
`create_meetings` (Create and manage meetings).

## Provider authoring

For a custom provider, inspect the exported `MeetingIntegration` types and
follow the same capability, OAuth, callback, and scheduling contracts. Its
`integrationName` is not free-form: it must match the scheduling event type
location enum value, compared lower-cased (e.g. `Zoom` -> `zoom`).
