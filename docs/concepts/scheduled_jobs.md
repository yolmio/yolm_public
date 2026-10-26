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

Schedules use standard cron semantics. Five fields are standard cron; a sixth
leading field adds seconds, and a seventh trailing field restricts the year.
Five-field schedules fire at second 0.

```
┌───────────── second (0 - 59, optional: present only in 6 and 7 field forms)
│ ┌───────────── minute (0 - 59)
│ │ ┌───────────── hour (0 - 23)
│ │ │ ┌───────────── day of month (1 - 31)
│ │ │ │ ┌───────────── month (1 - 12 or JAN-DEC)
│ │ │ │ │ ┌───────────── day of week (0 - 7 or SUN-SAT; 0 and 7 are Sunday)
│ │ │ │ │ │ ┌───────────── year (optional, 7 field form only)
│ │ │ │ │ │ │
* * * * * * *
```

- Fields accept `*`, single values, lists (`1,3,5`), ranges (`1-5`), and
  steps (`*/15`, `1-5/2`). Ranges do not wrap: write `5-7` or `FRI,SAT,SUN`
  rather than `5-0`.
- Day-of-week numbers follow standard cron: `0` and `7` are Sunday, `1` is
  Monday, and `6` is Saturday. Day names (`SUN`-`SAT`, any case) are often
  clearer.
- When both day of month and day of week are restricted (neither starts with
  `*`), the job fires on days matching **either** field. `0 9 1 * MON` runs at
  9:00 on the 1st of every month and on every Monday. A field starting with
  `*` (including steps such as `*/2`) does not restrict, so `0 9 */2 * MON`
  runs only on Mondays that fall on odd days of the month.
- Macros: `@yearly` / `@annually` (midnight January 1), `@monthly` (midnight on
  the 1st), `@weekly` (midnight Sunday), `@daily` / `@midnight`, and `@hourly`
  (top of every hour). `@reboot` is not supported.
- Schedule times are in the system's configured timezone. `yolm check` rejects
  invalid schedules.

### Cron Examples

```typescript
// Every 30 minutes
"*/30 * * * *"

// Every Monday at 5pm
"0 17 * * MON"

// Every Wednesday at 8:30pm
"30 20 * * WED"

// Daily at 9am
"0 9 * * *"

// Every weekday at 6am (1-5 is Monday-Friday)
"0 6 * * 1-5"

// First day of every month at midnight
"@monthly"

// Every 15 seconds (6 field form: seconds first)
"*/15 * * * * *"
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

### Reminder Emails

Enqueue reminders into an [email outbox](outbox.md) inside a transaction; the
outbox reactor sends them after commit and retries failures:

```typescript
// core.tsx: system.emailOutboxTable({ name: "invoice_reminder", fields: (table) => {
//   table.string("recipient_email", 254).notNull();
//   table.fk("invoice", "invoices").notNull();
// } });
system.scheduledProc({
  name: "enqueue_overdue_invoice_reminders",
  schedule: "0 0 8 * * *",
  procedure: (s) => {
    s.startTransaction();
    s.modify(sql`
      insert into db.invoice_reminder_outbox (recipient_email, invoice)
      select customers.email, invoices.id
      from db.invoices
      join db.customers on customers.id = invoices.customer
      where invoices.due_date < current_date()
        and invoices.paid_at is null
        and not exists (
          select 1 from db.invoice_reminder_outbox o where o.invoice = invoices.id
        )
    `);
    s.commitTransaction();
  },
});
```

Do not use scheduled jobs to store daily totals or other rollups; compute them
with queries, virtual fields, or views when they are read.

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

### Email Notifications

To render and send MJML emails from a scheduled job, see
[Email Templates with MJML](email_templates.md) and
[Postmark Email Service](../services/postmark.md).

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
        s.debugExpr(sql`'risky_job failed: ' || err.message`);
      },
    });
  },
});
```

Do not add job error or job run tables. Use `s.debugExpr` for diagnostics and
[transaction queries](../sql/transaction_queries.md) to see what a job changed.

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
4. **Use built-in history** - Rely on transaction queries and `s.debugExpr` output instead of job log tables
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
