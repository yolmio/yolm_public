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

Add a static secret named `POSTMARK_SERVER_TOKEN` with your Postmark server token. This is done via the studio secrets management or system configuration.

### 2. Import

```typescript
import { Postmark } from "services/postmark";
```

### 3. Create Instance

```typescript
// Uses POSTMARK_SERVER_TOKEN secret automatically
const postmark = new Postmark();

// Or provide a custom token
const postmark = new Postmark({
  serverToken: sql`(select value from db.settings where key = 'postmark_token')`,
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

The typical pattern is: render an MJML template → substitute variables → send via Postmark.

```typescript
// 1. Define your MJML template
const template = sql.lit`
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-size="16px" font-family="Arial">
          Hi {{recipient_name}},
        </mj-text>
        <mj-text font-family="Arial">
          {{message_body}}
        </mj-text>
        <mj-button href="{{action_url}}">
          View Details
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

// 2. In your procedure, set up variables and render
s.defScalar("recipient_name", sql`user.first_name || ' ' || user.last_name`);
s.defScalar("message_body", sql.lit`Your project has a new update.`);
s.defScalar("action_url", sql.lit`https://app.example.com/projects`);

// 3. Render template with variable substitution
s.renderTemplate({
  template,
  scope: {
    recipient_name: "recipient_name",
    message_body: "message_body",
    action_url: "action_url",
  },
  htmlEscaped: true,
  defOutputScalar: "mjml_rendered",
});

// 4. Convert MJML to HTML
s.renderMjml({
  mjml: sql`mjml_rendered`,
  defOutputScalar: "email_html",
});

// 5. Send via Postmark
postmark.sendEmail(s, {
  from: "notifications@yourapp.com",
  to: sql`user.email`,
  subject: sql.lit`Project Update`,
  htmlBody: sql`email_html`,
});
```

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

  // Tracking
  trackOpens: true,                   // Track email opens
  trackLinks: "HtmlAndText",          // "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly"

  // Error handling
  emailIsCritical: sql`true`,         // Throw error on invalid email (default: false)
  ifFails: (s) => {
    // Custom error handling
    s.modify(sql`
      insert into db.email_errors (email, error, created_at)
      values (recipient_email, 'Send failed', now())
    `);
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
          where p.manager = user.employee_id
            and p.due_date < current_date()
            and p.status not in ('completed', 'cancelled')),
          ''
        )
      `);

      // Render template
      s.renderTemplate({
        template: overdueTemplate,
        scope: {
          name: "user.name",
          count: "user.overdue_count",
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
        to: sql`user.email`,
        subject: sql`'You have ' || user.overdue_count || ' overdue projects'`,
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
    password: sql`webhook_secret`,
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

- **Status 406** (Invalid email): Runs `ifFails` and results in an error.
  `emailIsCritical` controls whether the service throws a friendlier critical
  email error before the general non-200 error path.
- **Other errors**: Throws with the Postmark error message.
- **Custom handling**: Use `ifFails` callback for custom failure-side effects.

```typescript
postmark.sendEmail(s, {
  from: "noreply@example.com",
  to: sql`user.email`,
  subject: sql.lit`Important notification`,
  htmlBody: sql`email_html`,
  emailIsCritical: sql`user.is_admin`,  // Only throw for admin emails
  ifFails: (s) => {
    s.modify(sql`
      update db.notifications
      set delivery_status = 'failed', failed_at = now()
      where id = notification_id
    `);
  },
});
```

## See Also

- [Email Templates with MJML](../concepts/email_templates.md) - Template design patterns
- [Scheduled Jobs](../concepts/scheduled_jobs.md) - Running email jobs on a schedule
- [Server Statements](../procedures/server_statements.md) - `renderTemplate` and `renderMjml` reference
