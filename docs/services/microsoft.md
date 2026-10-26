---
title: Microsoft Services
description: Yolm service client for Microsoft Graph (Outlook calendar) using managed OAuth credentials.
tags:
  - services
  - microsoft
  - outlook
  - oauth
---

# Microsoft Services

`services/microsoft/*` exposes managed-OAuth clients for Microsoft Graph
APIs.

## Outlook Calendar

```ts
import { AzureAD } from "services/microsoft/auth";
import { sql } from "std/sql_utils";

const outlook = new AzureAD();

outlook.events.listAllEvents(s, {
  calendarId: sql`outlook_calendar_id`, // Graph calendar id, e.g. from listCalendars
  saveToTable: "outlook_events",
  managedOauthCredentialId: sql`(select credential_id from db.user_outlook_accounts where sys_user_id = current_user)`,
  onReauthRequired: (s) => {
    // Mark the credential as needing re-auth
  },
});
```

`calendarId` is a Microsoft Graph calendar id; requests go to
`/me/calendars/{calendarId}/...`. Graph has no `primary` alias (that is a
Google Calendar convention), so read ids, including the default calendar
(`is_default_calendar`), with `outlook.calendars.listCalendars`. On a non-200
response, `listAllEvents` writes a row to `scheduling_integration_errors`
(from the scheduling block) before throwing.

Namespaces:

- `outlook.calendars` — `listCalendars`.
- `outlook.events` — `listAllEvents`, `create`, `getEvent`, `update`,
  `delete`, `watch`, and `stopWatch`.

## Outlook Mail

```ts
import { OutlookMail } from "services/microsoft/outlook_email";

const mail = new OutlookMail();

mail.messages.send(s, {
  managedOauthCredentialId: sql`microsoft_credential_id`,
  accountId: sql`outlook_account_id`,
  toTable: sql.lit`outlook_to`,
  ccTable: sql.lit`outlook_cc`,
  bccTable: sql.lit`outlook_bcc`,
  subject: sql`subject`,
  body: sql`html_body`,
});
```

`OutlookMail` exposes `messages.list`, `messages.get`, `messages.send`,
message update/delete/watch helpers, `attachments.get`, and `folders.list`.
Each method uses the same managed-OAuth options described below.

## User Info

`OutlookUserInfo` from `services/microsoft/user_info` reads profile data for a
managed OAuth credential.

## Auth

Pass OAuth token options to each Microsoft client call:

- `managedOauthCredentialId` selects the row in `managed_oauth_credentials`
  for the Outlook account being used.
- `onReauthRequired` handles expired or revoked Microsoft refresh tokens.
- `optIn`: see [External-Service Opt-In](./solution_services.md#external-service-opt-in).

## Prerequisites

- `OAuthCredentialsBlock` registered in core (provides
  `managed_oauth_credentials`).
- Provider configuration in the platform.

## Related

- Managed OAuth credentials are stored server-side.
- [Service integrations](../concepts/service_integrations.md)
