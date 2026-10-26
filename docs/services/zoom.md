---
title: Zoom Services
description: Managed-OAuth helpers for creating, reading, updating, and deleting Zoom meetings.
tags:
  - services
  - zoom
  - meetings
  - oauth
related:
  - blocks/meeting_integrations.md
  - blocks/oauth_credentials.md
  - services/solution_services.md
---

# Zoom Services

Use `services/zoom/*` for custom Zoom flows. For normal meeting integration UI,
prefer `ZoomIntegration` from `blocks/meeting_integrations/zoom`.

```ts
import { ZoomAuth } from "services/zoom/auth";
import { getStaticSecret } from "std/services";
import { sql } from "std/sql_utils";

const zoom = new ZoomAuth({
  verificationSecret: getStaticSecret(sql.lit`ZOOM_WEBHOOK_SECRET`),
});

s.defScalar("zoom_meeting_id", { type: "String" });
s.defScalar("zoom_join_url", { type: "String" });
s.defScalar("zoom_password", { type: "String" });

zoom.meetings.create(s, {
  managedOauthCredentialId: sql`zoom_credential_id`,
  topic: sql`'Project review'`,
  startTime: sql`meeting_start_iso`,
  duration: 30,
  timezone: sql`'UTC'`,
  meetingIdScalar: "zoom_meeting_id",
  meetingUrlScalar: "zoom_join_url",
  meetingPasswordScalar: "zoom_password",
});
```

## Auth

Every API call takes `Oauth2TokenOpts`:

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `managedOauthCredentialId` | `Sql` | Yes | Row id in `managed_oauth_credentials`. |
| `onReauthRequired` | `(s) => void` | No | Called when the managed OAuth credential must be reauthorized. |
| `optIn` | `BooleanExpr` | No | See [External-Service Opt-In](./solution_services.md#external-service-opt-in). |

## Meetings

`new ZoomAuth(opts).meetings` exposes:

| Method | Purpose |
| --- | --- |
| `create(s, opts)` | Creates a scheduled meeting and assigns `meetingIdScalar`, `meetingUrlScalar`, and `meetingPasswordScalar` with `setScalar`, so declare those scalars first. |
| `get(s, opts)` | Fetches a meeting into `meeting_info`. |
| `update(s, opts)` | Updates topic, start time, duration, and timezone. |
| `delete(s, opts)` | Deletes a meeting. |

`getOauthUrl({ s, clientId, redirectUri, scope })` from
`services/zoom/meeting` builds a Zoom authorization URL for custom OAuth setup.
The current implementation does not add `scope` to the URL; scopes come from
the Zoom app configuration.
