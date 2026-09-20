---
title: Email Templates with MJML
description: How to create responsive email templates using MJML in Yolm with dynamic content and variable substitution.
tags:
  - concepts
  - email
  - mjml
  - templates
  - notifications
---

# Email Templates with MJML

Yolm supports MJML (Mailjet Markup Language) for creating responsive email templates. MJML is converted to HTML that renders consistently across email clients.

## Basic MJML Template

```typescript
const emailTemplate = sql.lit`
<mjml>
  <mj-head>
    <mj-title>Welcome Email</mj-title>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>
          Hello {{name}},<br><br>
          Welcome to our platform!
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;
```

## Template with Variables

Use Mustache-style `{{variable}}` syntax for dynamic content:

```typescript
const userConfirmationEmail = sql.lit`
<mjml>
  <mj-head>
    <mj-title>Appointment Confirmation</mj-title>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>
          Hi {{agent_name}},<br><br>

          A new event has been scheduled.<br><br>

          <b>Event Type:</b><br>
          {{event_type_name}}<br><br>

          <b>Invitee:</b><br>
          {{invitee_name}}<br><br>

          <b>Invitee Email:</b><br>
          {{invitee_email}}<br><br>

          <b>Event Date/Time:</b><br>
          {{appointment_time}} - {{appointment_date}}<br><br>

          {{{location}}}

          {{{questions_and_answers}}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;
```

Note: Use triple braces `{{{variable}}}` for HTML content that shouldn't be escaped.

## Dynamic Template Generation

Generate templates programmatically with SQL concatenation:

```typescript
function emailTemplate<T extends IServerBaseStatements>(
  s: T,
  {
    appointmentRecord,
    body,
    title,
    standardFooter,
  }: {
    appointmentRecord: Sql;
    body: Sql;
    title: Sql;
    standardFooter: boolean;
  }
) {
  let footer: string | Sql = "";

  if (standardFooter) {
    s.defScalar(
      "scheduling_domain",
      sql`(select scheduling_domain from db.scheduling_event_types where id = ${appointmentRecord}.event_type_id)`
    );

    footer = SchedulingBlock.inviteeEmailFooter({
      icsUrl: sql.concat(
        "https://",
        sql`scheduling_domain`,
        "/api/appointments/",
        sql`${appointmentRecord}.public_id`,
        "/ics"
      ),
      rescheduleUrl: sql.concat(
        "https://",
        sql`scheduling_domain`,
        "/appointments/",
        sql`${appointmentRecord}.public_id`,
        "/reschedule"
      ),
      cancelUrl: sql.concat(
        "https://",
        sql`scheduling_domain`,
        "/appointments/",
        sql`${appointmentRecord}.public_id`,
        "/cancel"
      ),
    });
  }

  return sql.concatTemplate`
<mjml>
  <mj-head>
    <mj-title>Appointment ${title}</mj-title>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>
          ${body}
        </mj-text>
      </mj-column>
    </mj-section>
    ${footer}
  </mj-body>
</mjml>`;
}
```

## Setting Up Email Variables

Define variables that will be substituted in the template:

```typescript
function setupNotificationVariables<T extends IServerBaseStatements>(
  s: T,
  { appointmentRecord }: { appointmentRecord: Sql }
) {
  s.defScalar(
    "agent_name",
    sql`(select su.name from db.sys_users su auto join db.agents where su.id = ${appointmentRecord}.sys_user_id)`
  );

  s.defScalar(
    "invitee_name",
    sql`coalesce(${appointmentRecord}.invitee_name, 'Not provided')`
  );

  s.defScalar(
    "invitee_email",
    sql`coalesce(${appointmentRecord}.invitee_email, 'Not provided')`
  );

  s.defScalar(
    "invitee_phone",
    sql`coalesce(${appointmentRecord}.invitee_phone::string, 'Not provided')`
  );

  // Build complex HTML content for questions
  s.defScalar(
    "questions_and_answers",
    sql.concat(
      sql`case
        when ${appointmentRecord}.invitee_age is not null
        then '<b>Age</b><br>' || cast(${appointmentRecord}.invitee_age as string) || '<br><br>'
        else ''
      end`,
      sql`case
        when ${appointmentRecord}.invitee_phone is not null
        then '<b>Phone Number</b><br>' || cast(${appointmentRecord}.invitee_phone as string) || '<br><br>'
        else ''
      end`,
      sql`coalesce(
        (select string_agg(
          concat(
            '<b>',
            string.html_escape(etq.question),
            '</b><br>',
            coalesce(string.html_escape(aq.answer), 'No answer provided'),
            '<br><br>'
          ), '')
        from db.scheduling_appointment_questions aq
        auto join db.scheduling_event_type_questions etq
        where aq.appointment_id = ${appointmentRecord}.id),
        ''
      )`
    )
  );
}
```

## Email Notification Configuration

Use with scheduling blocks or custom notification systems:

```typescript
const defaultEmailNotification: EmailNotificationConfig = {
  from: `"Acme Appointments" <notifications@example.com>`,
  replyTo: (appointmentRecord) =>
    sql`(select agents.email from db.sys_users su auto join db.agents where su.id = ${appointmentRecord}.sys_user_id)`,
  setupVariables: (s, { appointmentRecord }) => {
    setupNotificationVariables(s, { appointmentRecord });
  },
  variables: {
    invitee_name: "invitee_name",
    invitee_email: "invitee_email",
    invitee_phone: "invitee_phone",
    invitee_age: "invitee_age",
    agent_name: "agent_name",
  },
  template: (s, { appointmentRecord, body }) =>
    emailTemplate(s, {
      appointmentRecord,
      body,
      title: sql.lit`Appointment Confirmation`,
      standardFooter: true,
    }),
};
```

## Common MJML Components

### mj-text

Basic text content:

```xml
<mj-text font-size="16px" color="#333333" font-weight="bold">
  Welcome to our service!
</mj-text>
```

### mj-button

Call-to-action buttons:

```xml
<mj-button href="{{confirmation_url}}" background-color="#0066cc">
  Confirm Appointment
</mj-button>
```

### mj-image

Images and logos:

```xml
<mj-image src="https://example.com/logo.png" alt="Company Logo" width="200px" />
```

### mj-divider

Visual separators:

```xml
<mj-divider border-color="#cccccc" border-width="1px" />
```

### mj-spacer

Vertical spacing:

```xml
<mj-spacer height="20px" />
```

## Multi-Column Layouts

```xml
<mj-section>
  <mj-column width="50%">
    <mj-text>Left column content</mj-text>
  </mj-column>
  <mj-column width="50%">
    <mj-text>Right column content</mj-text>
  </mj-column>
</mj-section>
```

## Conditional Content

Use triple braces for optional HTML sections:

```typescript
const template = sql.lit`
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>
          {{{optional_section}}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

// In setup
s.defScalar(
  "optional_section",
  sql`case
    when show_details
    then '<b>Details</b><br>' || details
    else ''
  end`
);
```

## Real-World Example: Appointment Notifications

Complete example with confirmation, cancellation, and reschedule emails:

```typescript
// Confirmation email
const userConfirmationEmail = sql.lit`
<mjml>
  <mj-head>
    <mj-title>Appointment Confirmation</mj-title>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>
          Hi {{agent_name}},<br><br>
          A new event has been scheduled.<br><br>
          <b>Event Type:</b><br>{{event_type_name}}<br><br>
          <b>Invitee:</b><br>{{invitee_name}}<br><br>
          <b>Event Date/Time:</b><br>{{appointment_time}} - {{appointment_date}}<br><br>
          {{{questions_and_answers}}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

// Cancellation email
const userCancellationEmail = sql.lit`
<mjml>
  <mj-head>
    <mj-title>Appointment Cancelled</mj-title>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>
          Hi {{agent_name}},<br><br>
          The following event has been cancelled.<br><br>
          <b>Event Type:</b><br>{{event_type_name}}<br><br>
          <b>Invitee:</b><br>{{invitee_name}}<br><br>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

// Usage in SchedulingBlock
system.addBlock(
  new SchedulingBlock({
    userConfirmationEmail: {
      from: `"Example App" <notifications@example.com>`,
      replyTo: (appointmentRecord) =>
        sql`(select agents.email from db.sys_users su auto join db.agents where su.id = ${appointmentRecord}.sys_user_id)`,
      setupVariables: setupNotificationVariables,
      variables: {
        invitee_name: "invitee_name",
        invitee_email: "invitee_email",
        agent_name: "agent_name",
      },
      getUserEmail: (appointmentRecord) =>
        sql`(select agents.email from db.sys_users su auto join db.agents where su.id = ${appointmentRecord}.sys_user_id)`,
      mjml: userConfirmationEmail,
      subject: sql.lit`New Event: {{invitee_name}} - {{appointment_time}} {{appointment_date}}`,
    },
    userCancellationEmail: {
      from: `"Example App" <notifications@example.com>`,
      mjml: userCancellationEmail,
      subject: sql.lit`Event Cancelled: {{invitee_name}}`,
      // ... other config
    },
  })
);
```

## Best Practices

1. **Use mj-head for global styles** - Define fonts and defaults once
2. **Test across email clients** - MJML handles most compatibility issues
3. **Keep templates simple** - Complex layouts may break in some clients
4. **Escape user content** - Use `{{variable}}` not `{{{variable}}}` for user input
5. **Use responsive widths** - Percentage-based widths work better than fixed pixels
6. **Include alt text** - Always add alt attributes to images
7. **Test variables** - Ensure all variables have fallback values
8. **Mobile-first** - Most emails are read on mobile devices

## Variable Escaping

```typescript
{{name}}        // HTML-escaped (safe for user input)
{{{html_content}}}  // Not escaped (use for trusted HTML)
```

## Testing Email Templates

```typescript
// In development, render the template then send the resulting HTML.
// The email service does NOT process MJML or {{variables}} — render first.
s.defScalar("user_name", sql.lit`Test User`);
s.renderTemplate({
  template: myMjmlTemplate,
  scope: { name: "user_name" },
  htmlEscaped: true,
  defOutputScalar: "rendered_mjml",
});
s.renderMjml({ mjml: sql`rendered_mjml`, defOutputScalar: "email_html" });
s.sendEmail({
  from: "notifications@example.com",
  to: sql.lit`test@example.com`,
  subject: sql.lit`Test Email`,
  htmlBody: sql`email_html`,
});
```

## Rendering and Sending Emails

To send MJML-based emails, you need three steps:

1. **Substitute variables** using `s.renderTemplate()`
2. **Convert MJML to HTML** using `s.renderMjml()`
3. **Send via email service** (e.g., Postmark)

```typescript
import { Postmark } from "services/postmark";

const postmark = new Postmark();

// In any server procedure (scheduled job, API handler, event handler with tryServer):

// Step 1: Substitute variables into MJML template
s.renderTemplate({
  template: myMjmlTemplate,       // Sql expression containing MJML with {{variables}}
  scope: {
    name: "user_name",            // Maps {{name}} to the scalar "user_name"
    amount: "invoice_total",      // Maps {{amount}} to the scalar "invoice_total"
    items: "items_html",          // Maps {{{items}}} to the scalar "items_html"
  },
  htmlEscaped: true,              // {{var}} is HTML-escaped, {{{var}}} is not
  defOutputScalar: "rendered_mjml",  // Output scalar name
});

// Step 2: Convert MJML to HTML
s.renderMjml({
  mjml: sql`rendered_mjml`,       // The rendered MJML from step 1
  defOutputScalar: "email_html",     // Output scalar name containing final HTML
});

// Step 3: Send via Postmark
postmark.sendEmail(s, {
  from: "notifications@example.com",
  to: sql`recipient_email`,
  subject: sql`email_subject`,
  htmlBody: sql`email_html`,      // The HTML from step 2
});
```

## Resources

- [Postmark Email Service](../services/postmark.md) - Sending emails via Postmark
- [Scheduled Jobs](scheduled_jobs.md) - Sending emails on a schedule
- [MJML Documentation](https://mjml.io/documentation/)
- [MJML Try It Live](https://mjml.io/try-it-live)
- Email client compatibility is handled automatically by MJML
