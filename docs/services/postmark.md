---
title: Postmark Email Service
description: How to send transactional emails using the Postmark service integration in Yolm.
tags:
  - services
  - email
  - postmark
  - notifications
---

# Postmark Email Service

The Postmark service provides transactional email sending via the [Postmark API](https://postmarkapp.com/). It handles authentication, error handling, and webhook management.

## Setup

### 1. Store Your API Token

Add a server-side static secret named `POSTMARK_SERVER_TOKEN` with your Postmark server token. This is done via the studio secrets management or system configuration.

### 2. Import

```typescript
import { Postmark } from "services/postmark";
import { getStaticSecret } from "std/services";
import { sql } from "std/sql_utils";
```

### 3. Create Instance

```typescript
// Uses POSTMARK_SERVER_TOKEN secret automatically
const postmark = new Postmark();

// Or read a different static secret (for example, a second Postmark server)
const marketingPostmark = new Postmark({
  serverToken: getStaticSecret(sql.lit`POSTMARK_MARKETING_TOKEN`),
});
```

You can also use the pre-created singleton:

```typescript
import { postmark } from "services/postmark";
```

## Sending Email

### Basic Email

```typescript
postmark.sendEmail(s, {
  from: "notifications@yourapp.com",
  to: sql`recipient_email`,
  subject: sql.lit`Your weekly report is ready`,
  htmlBody: sql`email_html`,
});
```

### Email with MJML Template

Render the body with `s.renderTemplate` and `s.renderMjml`, then pass the
resulting HTML scalar as `htmlBody`. See
[Rendering and Sending Emails](../concepts/email_templates.md#rendering-and-sending-emails)
for the full pattern.

### All sendEmail Options

```typescript
postmark.sendEmail(s, {
  // Required
  from: "Name <email@example.com>",  // String or Sql
  to: sql`recipient_email`,           // Sql expression
  subject: sql`email_subject`,        // Sql expression
  htmlBody: sql`html_content`,        // Sql expression (rendered HTML)

  // Optional
  textBody: sql`plain_text_version`,  // Plain text fallback
  cc: sql`cc_email`,                  // CC recipients
  replyTo: sql`reply_to_email`,       // Reply-to address
  tag: sql.lit`notification`,         // Tag for Postmark analytics
  messageStream: sql.lit`outbound`,   // Message stream (default: Postmark account default)
  optIn: sql.true,                    // See External-Service Opt-In (solution_services.md)

  // Tracking
  trackOpens: true,                   // Track email opens
  trackLinks: "HtmlAndText",          // "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly"

  // Error handling (every non-200 response throws; see Error Handling)
  emailIsCritical: sql`true`,         // 406 throws a "check the email address" message
  ifFails: (s) => {
    // Side effects to run before the error is thrown
  },

  // Custom email headers (Postmark JSON Headers, not HTTP request headers)
  headers: [
    { name: sql.lit`X-Custom-Header`, value: sql`header_value` },
  ],

  // Attachments
  attachments: [
    {
      Name: sql.lit`report.pdf`,
      Content: sql`base64_encoded_content`,
      ContentType: sql.lit`application/pdf`,
    },
  ],
});
```

## Complete Example: Scheduled Notification Email

A daily job that finds overdue items and emails the responsible person:

```typescript
import { Postmark } from "services/postmark";
import { sql } from "std/sql_utils";
import { system } from "std/system";

const postmark = new Postmark();

const overdueTemplate = sql.lit`
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-size="18px" font-weight="bold" color="#333">
          Overdue Items Alert
        </mj-text>
        <mj-text>
          Hi {{name}},<br><br>
          You have {{count}} overdue items that need attention.<br><br>
          {{{items_html}}}
        </mj-text>
        <mj-button href="https://app.example.com/dashboard">
          View Dashboard
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

system.scheduledProc({
  name: "overdue_notification",
  schedule: "0 0 9 * * MON-FRI",  // Weekdays at 9 AM
  procedure: (s) => {
    // Find users with overdue items
    s.defTable("users_with_overdue", sql`
      select
        e.id as employee_id,
        e.first_name || ' ' || e.last_name as name,
        e.email,
        count(*) as overdue_count
      from db.projects p
      join db.employees e on e.id = p.manager
      where p.due_date < current_date()
        and p.status not in ('completed', 'cancelled')
      group by e.id, e.first_name, e.last_name, e.email
    `);

    s.forEachTable("users_with_overdue", "user", (s) => {
      // Build HTML list of overdue items
      s.defScalar("items_html", sql`
        coalesce(
          (select string_agg(
            '<b>' || string.html_escape(p.name) || '</b> - Due: ' ||
            format.date(p.due_date, '%b %d, %Y') || '<br>',
            ''
          )
          from db.projects p
          where p.manager = user_record.employee_id
            and p.due_date < current_date()
            and p.status not in ('completed', 'cancelled')),
          ''
        )
      `);

      // Render template
      s.renderTemplate({
        template: overdueTemplate,
        scope: {
          name: "user_record.name",
          count: "user_record.overdue_count",
          items_html: "items_html",
        },
        htmlEscaped: true,
        defOutputScalar: "mjml_output",
      });

      s.renderMjml({
        mjml: sql`mjml_output`,
        defOutputScalar: "email_html",
      });

      // Send email
      postmark.sendEmail(s, {
        from: "notifications@yourapp.com",
        to: sql`user_record.email`,
        subject: sql`'You have ' || user_record.overdue_count || ' overdue projects'`,
        htmlBody: sql`email_html`,
        tag: sql.lit`overdue-notification`,
        trackOpens: true,
      });
    });
  },
});
```

## Webhook Management

Postmark can send webhooks for email events (bounces, opens, clicks, etc.).

### Create Webhook

```typescript
postmark.webhooks.create(s, {
  url: sql.lit`https://yourapp.com/api/postmark-webhook`,
  triggers: {
    bounce: { enabled: true, includeContent: true },
    spamComplaint: { enabled: true },
    open: { enabled: true, postFirstOpenOnly: true },
    click: { enabled: false },
    delivery: { enabled: false },
  },
  httpAuth: {
    username: sql.lit`webhook_user`,
    password: getStaticSecret(sql.lit`POSTMARK_WEBHOOK_PASSWORD`),
  },
  responseRecord: "webhook_result",
});
// webhook_result.id, webhook_result.url, webhook_result.message_stream
```

### List Webhooks

```typescript
postmark.webhooks.list(s, {
  messageStream: sql.lit`outbound`,
  webhooksTable: "existing_webhooks",
});
// Results in "existing_webhooks" table with id, url, bounce_enabled, etc.
```

### Delete Webhook

```typescript
postmark.webhooks.delete(s, sql`webhook_id`);
```

## Error Handling

The Postmark service handles errors automatically:

- **Status 406** (invalid email): Runs `ifFails` and throws. When
  `emailIsCritical` is true, the error message asks the user to check the
  email address; otherwise the generic send-failure error below is thrown.
  `emailIsCritical` defaults to false.
- **Other non-200 responses**: Runs `ifFails` and throws with the Postmark
  status and error message.
- **Custom handling**: Use the `ifFails` callback for failure-side effects.
  Every failure still throws afterward, so `sendEmail` never fails silently.

```typescript
postmark.sendEmail(s, {
  from: "noreply@example.com",
  to: sql`user_record.email`,
  subject: sql.lit`Important notification`,
  htmlBody: sql`email_html`,
  emailIsCritical: sql`user_record.is_admin`,  // Only throw for admin emails
  ifFails: (s) => {
    s.startTransaction();
    s.modify(sql`
      update db.notifications
      set delivery_status = 'failed'
      where id = notification_id
    `);
    s.commitTransaction();
  },
});
```

## See Also

- [External-Service Opt-In](./solution_services.md#external-service-opt-in) - `optIn` on `sendEmail` and webhook calls

- [Email Templates with MJML](../concepts/email_templates.md) - Template design patterns
- [Scheduled Jobs](../concepts/scheduled_jobs.md) - Running email jobs on a schedule
- [Server Statements](../procedures/server_statements.md) - `renderTemplate` and `renderMjml` reference
