---
title: Service Integrations
description: How to integrate third-party services like Calendly, HubSpot, Twilio, and other APIs into Yolm systems.
tags:
  - concepts
  - services
  - integrations
  - api
  - webhooks
---

# Service Integrations

Yolm provides pre-built integrations for popular third-party services. These integrations handle authentication, API calls, webhooks, and data synchronization.

## Available Service Modules

Import services from the `services/` directory:

```typescript
import { calendly } from "services/calendly";
import { hubspot } from "services/hubspot";
import { Twilio } from "services/twilio";
```

## Calendly Integration

### Webhook Setup

Set up Calendly webhooks to receive event notifications:

```typescript
const calendlyOrganization = "https://api.calendly.com/organizations/a423edd3-932d-4b69-a591-c83611768a7c";

// Add database table for webhook events
calendly.webhook.addDbTable();

// Handle invitee created events
calendly.webhook.inviteeCreated(sql.lit(calendlyOrganization), (s) => {
  s.defRecord(
    "contact",
    sql`select id, first_name, last_name from db.contacts where email = payload.email`
  );

  s.defScalar(
    "client_email",
    sql`(select user_email from scheduled_event_membership limit 1)`
  );

  s.defScalar(
    "campaign",
    sql`case
      when contains(tracking.utm_campaign, 'y_') then
        try_cast(substring(tracking.utm_campaign from 3) as bigint)
      else null
    end`
  );

  s.startTransaction();
  s.modify(
    sql`insert into db.calendly_appointments (contact_id, contact_email, contact_name, client_email, email_campaign_id, start_time, calendly_id)
    values (
      contact.id,
      case when contact.id is null then payload.email else null end,
      case when contact.id is null and name != '' then name else null end,
      client_email,
      campaign,
      scheduled_event.start_time,
      scheduled_event.uri
    )`
  );
  s.commitTransaction();
});
```

Use the Static Webhook Management page to register or de-register the Calendly
subscription. Deploying this declaration does not change the provider
subscription.

### Listing Event Types

Fetch all event types from Calendly:

```typescript
s.statements(
  calendly.eventTypes.listAll({
    organization: sql.lit(calendlyOrganization),
  })
);

// Merge into local database
s.modify(sql`merge into db.external_event_types eet
  using event_type
  on eet.calendly_uri = event_type.uri
  when matched then update set
    name = event_type.name,
    scheduling_url = event_type.scheduling_url,
    owner = event_type.profile_name,
    active = event_type.active
  when not matched then
    insert (name, calendly_uri, scheduling_url, active, owner)
    values (event_type.name, event_type.uri, event_type.scheduling_url, event_type.active, event_type.profile_name)`);
```

### Calendly Webhook Domain

Set the webhook domain for production:

```typescript
system.staticWebhookDomain = "webhook.example.com";
```

## HubSpot Integration

### Listing Contacts

Fetch all contacts from HubSpot:

```typescript
export function syncHubspotClients<T extends IServerBaseStatements>(s: T) {
  s.statements(
    hubspot.contacts.listAll({
      properties: [sql.lit`email`, sql.lit`hs_additional_emails`],
      archived: false,
    })
  );

  // Clean up invalid contacts
  s.modify(
    sql`delete from contact where (properties->>'email') is null or (properties->>'email') = ''`
  );

  // Extract emails
  s.defTable(
    "client_emails",
    sql`select
      (properties->>'email') as email,
      split.value as additional_email
    from contact
    left join string.split(properties->>'hs_additional_emails', ';') as split`
  );

  // Merge into database
  s.startTransaction();
  s.modify(sql`insert into db.clients
    select distinct email
    from client_emails
    where not exists (select 1 from db.clients where email = client_emails.email)`);

  s.modify(sql`insert into db.client_additional_emails
    select
      additional_email as email,
      (select id from db.clients where email = client_emails.email) as client_id
    from client_emails
    where not exists (
      select 1
      from db.client_additional_emails
      auto join db.clients
      where client_additional_emails.email = client_emails.additional_email
      and clients.email = client_emails.email
    )
    and additional_email is not null`);
  s.commitTransaction();
}
```

### Scheduled Sync

Set up a recurring job to sync HubSpot data:

```typescript
system.scheduledProc({
  name: "hubspot_clients_sync",
  schedule: "0 0 4 * * 1-5",  // 4 AM Monday-Friday
  procedure: (s) => {
    s.debugExpr(sql.lit`Running sync hubspot clients`);
    syncHubspotClients(s);
  },
});
```

## Twilio Integration

### Setup

```typescript
import { twilio } from "services/twilio";
```

The default instance reads `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
`TWILIO_FROM_NUMBER` static secrets. Use `new Twilio({ ... })` only when a
system needs different SQL expressions for those values.

### Sending SMS

```typescript
twilio.sendSms(s, {
  to: opts.to,
  body: sql.concat(
    "Your access code is: ",
    sql`code`
  ),
});
```

### In Authentication

Use Twilio for SMS-based authentication by wrapping your app UI:

```typescript
function TwilioAuth({ children, ...props }: { children: Node } & DefaultAuthComponentProps) {
  return (
    <AuthBlock.OTPAuth
      defaultChannel="email"
      channels={{
        email: {
          getEmailFromUserId: (userId) =>
            sql`(select email from db.users where sys_user_id = ${userId})`,
          fromEmail: sql.lit`notifications@example.com`,
        },
        sms: {
          getPhoneFromUserId: (userId) =>
            sql`(select phone::string from db.users where sys_user_id = ${userId})`,
          sendSms: (s, opts) => {
            twilio.sendSms(s, {
              to: opts.to,
              body: sql.concat("Your access code is: ", sql`code`),
            });
          },
        },
      }}
      identifier={{
        field: "email",
        getUserFromIdentifier: (email) =>
          sql`(select sys_user_id from db.users where email = ${email})`,
      }}
      {...props}
    >
      {children}
    </AuthBlock.OTPAuth>
  );
}

// Use in your app
system.app({
  domain: "myapp.com",
  ui: (
    <TwilioAuth requiredPermission="can_access_app">
      <MyApp />
    </TwilioAuth>
  ),
});
```

## Generic Service Requests

For services without pre-built modules, use `s.request()`:

```typescript
s.request({
  uri: sql.lit`https://api.example.com/data`,
  method: "GET",
  headers: [
    { name: sql.lit`Authorization`, value: sql`'Bearer ' || api_key` },
    { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
  ],
  defReceiveJson: "api_response",
  defResponseRecord: "response",
});

// Process response
s.defScalar("data", sql`api_response->'results'`);
```

### POST Request

```typescript
s.request({
  uri: sql.lit`https://api.example.com/v3/mail/send`,
  method: "POST",
  headers: [
    { name: sql.lit`Authorization`, value: sql`'Bearer ' || ${getStaticSecret(sql.lit`API_KEY`)}` },
    { name: sql.lit`Content-Type`, value: sql.lit`application/json` },
  ],
  json: {
    to: sql`recipient_email`,
    from: sql.lit`noreply@example.com`,
    subject: sql`email_subject`,
    html: sql`email_body`,
  },
  defReceiveJson: "send_response",
  defResponseRecord: "response",
});
```

## Static Secrets

Store API keys and credentials securely:

```typescript
import { getStaticSecret } from "std/services";

// Access secrets
const apiKey = getStaticSecret(sql.lit`MY_API_KEY`);
const clientSecret = getStaticSecret(sql.lit`OAUTH_CLIENT_SECRET`);
```

Secrets are configured outside the codebase and injected at runtime.

## Webhook Patterns

### Setting up a Webhook Table

```typescript
db.table("incoming_webhooks", (table) => {
  table.string("event_type", 100).notNull();
  table.json("payload").notNull();
  table.timestampUtc("received_at").notNull().default(sql`now()`);
  table.bool("processed").notNull().default(false);
});
```

### Processing Webhooks

```typescript
const api = system.api({ prefix: "/api", domain: "api.example.com" });

api.post("/webhooks/external-service", {
  jsonBodyScalar: "body",
  procedure: (s) => {
    s.defScalar("event_type", sql`body->>'event_type'`);
    s.defScalar("payload", sql`body->'payload'`);

    // Store webhook
    s.startTransaction();
    s.modify(sql`
      insert into db.incoming_webhooks (event_type, payload)
      values (event_type, payload)
    `);

    // Process based on event type
    s.if(sql`event_type = 'customer.created'`, (s) => {
      s.modify(sql`
        insert into db.customers (external_id, email, name)
        values (
          payload->>'id',
          payload->>'email',
          payload->>'name'
        )
        on conflict (external_id) do nothing
      `);
    });

    s.commitTransaction();
    s.return(sql`json_build_object('success', true)`);
  },
});
```

## OAuth Integrations

For services requiring OAuth (Google, Microsoft, etc.), use integration blocks:

```typescript
import { GoogleCalendarIntegration } from "blocks/calendar_integrations/google";
import { OutlookCalendarIntegration } from "blocks/calendar_integrations/outlook";

system.addBlock(
  new GoogleCalendarIntegration({
    notificationDomain: "calendar.example.com",
    provider: "google_calendar",
    scopes: sql`json_build_array(
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email'
    )`,
  })
);
```

## Scheduled Data Syncs

Automate regular data synchronization:

```typescript
system.scheduledProc({
  name: "sync_external_data",
  schedule: "0 0 */6 * * *",  // Every 6 hours
  procedure: (s) => {
    // Fetch data
    s.statements(hubspot.contacts.listAll({ archived: false }));

    // Transform and merge
    s.startTransaction();
    s.modify(sql`
      merge into db.contacts c
      using contact
      on c.external_id = contact.id
      when matched then update set
        email = contact.properties->>'email',
        updated_at = now()
      when not matched then insert
        (external_id, email, created_at)
      values
        (contact.id, contact.properties->>'email', now())
    `);
    s.commitTransaction();
  },
});
```

## Best Practices

1. **Use static secrets** - Never hardcode API keys
2. **Handle errors** - Wrap service calls in try/catch
3. **Store webhook data** - Log all incoming webhooks for debugging
4. **Idempotent operations** - Use `on conflict` or `merge` for upserts
5. **Schedule syncs wisely** - Balance freshness with API rate limits
6. **Opt in outbound requests where needed** - Use service/request opt-in settings for preview or local environments
7. **Parse JSON carefully** - Validate webhook payloads before processing
8. **Log debug info** - Use `s.debugExpr()` for troubleshooting

## Error Handling

```typescript
s.try({
  body: (s) => {
    s.serviceRequest({
      serviceType: sql.lit`external_api`,
      operation: sql.lit`GET /data`,
      requestJson: sql`json_build_object('url', 'https://api.example.com/data')`,
      defResultJsonScalar: "response",
      defErrorJsonScalar: "service_error",
    });

    s.defScalar("data", sql`response`);
  },
  errorName: "api_error",
  catch: (s) => {
    s.debugExpr(sql`api_error.message`);

    // Log error
    s.modify(sql`
      insert into db.api_errors (service, error_message, occurred_at)
      values ('external_api', api_error.message, now())
    `);

    // Set fallback data
    s.defScalar("data", sql`'{}'::json`);
  },
});
```

## Testing Integrations

Test scheduled integrations in a Forge preview with test credentials and an
explicitly enabled service capability. Preview isolation protects the preview
database, but a scheduled procedure declaration is not an outbound-service
safety boundary; a real provider call can still affect external data.

```typescript
system.scheduledProc({
  name: "test_sync",
  schedule: "0 0 * * * *",  // Hourly
  procedure: (s) => {
    s.debugExpr(sql.lit`Testing sync in a Forge preview`);
    // ... sync logic
  },
});
```

## Real-World Integration Example

Complete HubSpot contact sync with error handling:

```typescript
export function syncHubspotClients<T extends IServerBaseStatements>(s: T) {
  s.try({
    body: (s) => {
      s.statements(
        hubspot.contacts.listAll({
          properties: [sql.lit`email`, sql.lit`hs_additional_emails`],
          archived: false,
        })
      );

      s.modify(
        sql`delete from contact where (properties->>'email') is null or (properties->>'email') = ''`
      );

      s.defTable(
        "client_emails",
        sql`select (properties->>'email') as email, split.value as additional_email
            from contact left join string.split(properties->>'hs_additional_emails', ';') as split`
      );

      s.startTransaction();
      s.modify(sql`insert into db.clients
        select distinct email
        from client_emails
        where not exists (select 1 from db.clients where email = client_emails.email)`);

      s.modify(sql`insert into db.client_additional_emails
        select additional_email as email, (select id from db.clients where email = client_emails.email) as client_id
        from client_emails
        where not exists (
          select 1
          from db.client_additional_emails
          auto join db.clients
          where client_additional_emails.email = client_emails.additional_email and
          clients.email = client_emails.email
        ) and
        additional_email is not null`);
      s.commitTransaction();
    },
    errorName: "sync_error",
    catch: (s) => {
      s.debugExpr(sql.lit`HubSpot sync failed`);
      s.debugExpr(sql`sync_error.message`);
    },
  });
}
```
