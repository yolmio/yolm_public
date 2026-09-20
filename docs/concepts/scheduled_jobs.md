---
title: Scheduled Jobs
description: How to define and configure scheduled jobs in Yolm for recurring tasks like reports, cleanup, and notifications.
tags:
  - concepts
  - scheduled-jobs
  - cron
---

# Scheduled Jobs

Scheduled jobs run procedures at specified intervals, similar to cron jobs.

## Basic Definition

```typescript
system.scheduledProc({
  name: "daily_report",
  schedule: "0 0 8 * * *",  // Daily at 8:00 AM
  procedure: (s) => {
    s.startTransaction();
    s.defScalar("report_data", sql`json_build_object('generated_at', now())`);
    s.modify(sql`
      insert into db.reports (type, data, generated_at)
      values ('daily', report_data, now())
    `);
    s.commitTransaction();
  },
});
```

## Cron Schedule Format

Yolm supports standard cron syntax for flexible scheduling:

```typescript
system.scheduledProc({
  name: "sendgrid_sync",
  schedule: "0 30 2 * * MON-FRI",  // Weekdays at 2:30 AM
  procedure: (s) => {
    s.debugExpr(sql.lit`Running SendGrid sync`);
    // Define these tables and a sync procedure for the application first.
    s.defTable("added_contacts", sql`select * from db.added_contacts`);
    s.defTable("deleted_contacts", sql`select * from db.deleted_contacts`);
    // s.statements(syncContactsWithSendGrid);
    s.debugExpr(sql.lit`Finished scheduled SendGrid sync`);
  },
});
```

### Cron Syntax

```
┌───────────── second (0 - 59)
│ ┌───────────── minute (0 - 59)
│ │ ┌───────────── hour (0 - 23)
│ │ │ ┌───────────── day of month (1 - 31)
│ │ │ │ ┌───────────── month (1 - 12 or JAN-DEC)
│ │ │ │ │ ┌───────────── day of week (0 - 6 or SUN-SAT)
│ │ │ │ │ │
│ │ │ │ │ │
* * * * * *
```

### Cron Examples

```typescript
// Every 30 minutes
"0 */30 * * * *"

// Every Monday at 5pm
"0 0 17 * * MON"

// Every Wednesday at 8:30pm
"0 30 20 * * WED"

// Daily at 9am
"0 0 9 * * *"

// Every weekday at 6am
"0 0 6 * * MON-FRI"

// First day of every month at midnight
"0 0 0 1 * *"
```

## Multiple Schedules

Pass an array when the same procedure should run on multiple cron schedules:

```typescript
system.scheduledProc({
  name: "business_hours_sync",
  schedule: [
    "0 0 9 * * MON-FRI",
    "0 0 13 * * MON-FRI",
    "0 0 17 * * MON-FRI",
  ],
  procedure: (s) => { ... },
});
```

## Procedure Statements

Scheduled procedures use `GeneralServerStatements`:

```typescript
system.scheduledProc({
  name: "send_reminders",
  schedule: "0 */30 * * * *",
  procedure: (s) => {
    // Query for pending reminders
    s.defTable("reminders", sql`
      select * from db.reminders
      where send_at <= now()
      and sent = false
    `);

    // Process each reminder
    s.forEachTable("reminders", "reminder", (s) => {
      // Send notification (via service integration)
      s.serviceRequest({
        serviceType: sql.lit`emailService`,
        operation: sql.lit`send`,
        requestJson: sql`json_build_object(
          'to', reminder.email,
          'subject', reminder.subject,
          'body', reminder.body
        )`,
        defResultJsonScalar: "send_result",
        defErrorJsonScalar: "send_error",
      });

      // Mark as sent
      s.modify(sql`
        update db.reminders
        set sent = true, sent_at = now()
        where id = reminder.id
      `);
    });
  },
});
```

## Common Use Cases

### Data Cleanup

```typescript
system.scheduledProc({
  name: "cleanup_expired_sessions",
  schedule: "0 0 * * * *",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      delete from db.sessions
      where expires_at < now()
    `);
    s.commitTransaction();
  },
});
```

### Aggregate Reports

```typescript
system.scheduledProc({
  name: "daily_stats",
  schedule: "0 5 0 * * *",
  procedure: (s) => {
    s.startTransaction();

    s.modify(sql`
      insert into db.daily_stats (date, orders_count, revenue)
      select
        current_date() - interval '1 day',
        count(*),
        sum(total)
      from db.orders
      where created_at >= current_date() - interval '1 day'
      and created_at < current_date()
    `);

    s.commitTransaction();
  },
});
```

### Data Synchronization

```typescript
system.scheduledProc({
  name: "sync_external_data",
  schedule: "0 */5 * * * *",
  procedure: (s) => {
    // Fetch from external API
    s.serviceRequest({
      serviceType: sql.lit`externalApi`,
      operation: sql.lit`GET /products`,
      requestJson: sql`json_build_object()`,
      defResultJsonScalar: "api_response",
      defErrorJsonScalar: "api_error",
    });

    // Update local data
    s.forEachQuery(
      sql`select * from json_array_elements(api_response)`,
      "product",
      (s) => {
        s.modify(sql`
          insert into db.external_products (external_id, data, synced_at)
          values (product->>'id', product, now())
          on conflict (external_id) do update set
            data = excluded.data,
            synced_at = excluded.synced_at
        `);
      }
    );
  },
});
```

### Email Notifications with Postmark

Send email notifications from scheduled jobs using the Postmark service with MJML templates:

```typescript
import { Postmark } from "services/postmark";

const postmark = new Postmark();

const reminderTemplate = sql.lit`
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-family="Arial" font-size="16px">
          Hi {{name}},<br><br>
          You have tasks due tomorrow:<br><br>
          {{{task_list}}}
        </mj-text>
        <mj-button href="https://app.example.com/tasks">
          View Tasks
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

system.scheduledProc({
  name: "send_due_date_reminders",
  schedule: "0 0 9 * * *",  // Daily at 9 AM
  procedure: (s) => {
    // Find users with tasks due tomorrow
    s.defTable("users_with_due_tasks", sql`
      select
        u.id as user_id,
        u.first_name || ' ' || u.last_name as name,
        u.email,
        count(*) as task_count
      from db.tasks t
      join db.users u on u.id = t.assigned_to
      where t.due_date = current_date() + interval '1 day'
        and t.status != 'completed'
      group by u.id, u.first_name, u.last_name, u.email
    `);

    s.forEachTable("users_with_due_tasks", "user", (s) => {
      // Build HTML task list
      s.defScalar("task_list", sql`
        (select string_agg(
          '• <b>' || string.html_escape(t.title) || '</b><br>',
          ''
        )
        from db.tasks t
        where t.assigned_to = user.user_id
          and t.due_date = current_date() + interval '1 day'
          and t.status != 'completed')
      `);

      // Render MJML template with variables
      s.renderTemplate({
        template: reminderTemplate,
        scope: {
          name: "user.name",
          task_list: "task_list",
        },
        htmlEscaped: true,
        defOutputScalar: "mjml_output",
      });

      // Convert MJML to HTML
      s.renderMjml({
        mjml: sql`mjml_output`,
        defOutputScalar: "email_html",
      });

      // Send via Postmark
      postmark.sendEmail(s, {
        from: "notifications@yourapp.com",
        to: sql`user.email`,
        subject: sql`'Tasks due tomorrow (' || user.task_count || ')'`,
        htmlBody: sql`email_html`,
        tag: sql.lit`due-date-reminder`,
      });
    });
  },
});
```

For more on Postmark integration, see [Postmark Email Service](../services/postmark.md).
For MJML template design, see [Email Templates with MJML](email_templates.md).

## Error Handling

```typescript
system.scheduledProc({
  name: "risky_job",
  schedule: "0 0 * * * *",
  procedure: (s) => {
    s.try({
      body: (s) => {
        s.startTransaction();
        // Do risky work
        s.commitTransaction();
      },
      errorName: "err",
      catch: (s) => {
        s.rollbackTransaction();
        // Log the error
        s.modify(sql`
          insert into db.job_errors (job_name, error_message, occurred_at)
          values ('risky_job', err.message, now())
        `);
      },
    });
  },
});
```

## `storedScheduledProc` — Stored-Proc-Backed Scheduled Jobs

`storedScheduledProc` (from `std/scheduled_utils`) splits a scheduled
job into two registrations: the actual work is declared as a stored
procedure, and the schedule entry simply calls into it.

This is the right shape when you also want the job invokable manually
(for backfills, debugging, or tests).

```typescript
import { storedScheduledProc } from "std/scheduled_utils";
import { sql } from "std/sql_utils";

storedScheduledProc({
  name: "expire_pending_invites",
  schedule: "0 0 * * * *",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`update db.invites
                  set status = 'expired'
                  where status = 'pending'
                    and created_at < now() - interval '7 days'`);
    s.commitTransaction();
  },
});
```

The resulting stored procedure is named `${name}_impl` unless you pass
`storedName`. Pass an array to `schedule` for multiple firing rules.

## Best Practices

1. **Keep jobs fast** - Long-running jobs can affect system performance
2. **Use transactions** - Ensure data consistency
3. **Handle errors gracefully** - Don't let one failure crash the job
4. **Log important events** - Track job execution for debugging
5. **Consider time zones** - Schedule times are in the system's configured timezone
6. **Avoid overlapping** - Ensure job duration is less than the schedule interval

### Batch enrichment before bounded loops

A scheduled job can have a cheap candidate query and still be slow because its
loop executes several dependent queries for every candidate. Query setup and
selected-block work then grow with `candidate count × queries per candidate`.

When the job already has a bounded batch, materialize those IDs once, aggregate
dependent child data (for example notes, aliases, or messages) with set-based
queries restricted to that batch, and iterate the enriched procedure table.
Keep the original eligibility filters, ordering, limit, payload construction,
and transaction boundaries. Confirm parity with a functional scheduled-proc
test, then compare CPU, query setup, blocks used, and output cardinality on
production-shaped data.
