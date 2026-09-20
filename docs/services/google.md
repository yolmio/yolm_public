---
title: Google Services
description: Yolm service clients for Google Calendar and Gmail using managed OAuth credentials.
tags:
  - services
  - google
  - calendar
  - oauth
---

# Google Services

`services/google/calendar` and Gmail-related helpers use managed OAuth
credentials for per-user Google API calls. `services/google/index` exposes
service-account helpers for APIs such as Sheets and Drive.

## Google Calendar

```ts
import { GoogleCalendar } from "services/google/calendar";

const calendar = new GoogleCalendar();

calendar.events.list(s, {
  calendarId: sql`'primary'`,
  defaultTimeZone: sql`'UTC'`,
  managedOauthCredentialId: sql`(select credential_id from db.user_google_accounts where sys_user_id = current_user)`,
  onReauthRequired: (s) => {
    // Mark the credential as needing re-auth
  },
});
```

Available namespaces:

- `calendar.events` — `list`, `listAll`, `create`, `createWithMeet`,
  `update`, `delete`, `watch`, and `stopWatch`.
- `calendar.calendars` — `list`.

## Gmail

```ts
import { Gmail } from "services/google/gmail";

const gmail = new Gmail();

gmail.messages.send(s, {
  managedOauthCredentialId: sql`google_credential_id`,
  accountId: sql`gmail_account_id`,
  toTable: sql.lit`gmail_to`,
  ccTable: sql.lit`gmail_cc`,
  bccTable: sql.lit`gmail_bcc`,
  subject: sql`subject`,
  body: sql`html_body`,
  from: sql`from_email`,
});
```

`Gmail` exposes `messages.list`, `messages.get`, `messages.history`,
`messages.send`, watch/stop-watch helpers, and `attachments.get`. Each method
uses the same managed-OAuth options described below.

## Service Account APIs

```ts
import { Google } from "services/google";

const google = new Google({
  auth: {
    type: "ServiceAccount",
    clientEmail: sql`service_account_email`,
    privateKey: sql`private_key`,
  },
});
```

`Google` exposes service-account clients:

- `google.spreadsheets` and `google.spreadsheets.values` for Sheets metadata
  and values.
- `google.drive.files` and `google.drive.files.permissions` for Drive file and
  permission calls.

The service-account client selects the required Google scope per operation;
there is no top-level `scopes` option. Use a `Sql` expression for the client
email and private key so credentials remain server-side.

## User Info

`GoogleUserInfo` from `services/google/user_info` reads profile data for a
managed OAuth credential.

## Auth

Every Google client method that hits the API accepts OAuth token options:

- `managedOauthCredentialId` — credential row id in `managed_oauth_credentials`.
- `onReauthRequired` — runs when Yolm detects an expired/revoked refresh token.
- `optIn` — required in non-prod environments where external services are opt-in.

## Prerequisites

- `OAuthCredentialsBlock` registered in core (provides
  `managed_oauth_credentials`).
- Provider configuration in the platform (client id / secret / scopes).

## Related

- [OAuth credentials block](../blocks/oauth_credentials.md)
- [Gmail bulk email campaign provider](../blocks/gmail_campaign.md)
- [Service integrations](../concepts/service_integrations.md)
