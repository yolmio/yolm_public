---
title: Blocks
description: Yolm blocks are units of reuse across technology boundaries, bundling database tables, UI components, and API endpoints together.
tags:
  - concepts
  - blocks
  - reuse
---

# Blocks

A Yolm block is a unit of reuse across technology boundaries. A block may define a set of database tables, UI components, and an API - all bundled together.

## What Makes Blocks Special

Blocks are the superstars of reuse in Yolm. Unlike traditional frameworks where you reuse code at a single layer (UI components, database schemas, or API handlers separately), blocks bundle everything needed for a feature.

## Two Types of Blocks

Yolm has two types of blocks with different scopes and usage patterns:

### System Blocks

System blocks are not related to just a single table. They add capabilities to the entire system.

**Examples:** Auth, CRM, Scheduling, Glossary, Google Calendar Integration, Email Campaigns

**Usage:** Added via `system.addBlock(new BlockInstance())`

```typescript
import { AuthBlock } from "blocks/auth";
import { CrmBlock } from "blocks/crm";

system.addBlock(new AuthBlock({ /* config */ }));
system.addBlock(new CrmBlock({ type: "b2b" }));
```

### Table Blocks

Table blocks are related to a single database table. They add fields (physical or virtual) and/or dependent tables.

**Examples:** Address, Attachments, Notes List, Translations, and Synonyms

Audit fields are a schema pattern, not a table block. Add only the provenance
fields the workflow actually reads and writes.

**Usage:** Added via `table.addBlock(BlockClass)` inside a table definition

```typescript
import { AddressTableBlock } from "table_blocks/address";
import { AttachmentsTableBlock } from "table_blocks/attachments";
import { NotesListTableBlock } from "table_blocks/notes_list";

db.table("customers", (table) => {
  table.string("name", 100).notNull();
  table.addBlock(AddressTableBlock);        // Adds address fields
  table.addBlock(AttachmentsTableBlock);    // Creates customer_attachments table
  table.addBlock(NotesListTableBlock);      // Creates customer_notes table
});
```

Table blocks can accept configuration:

```typescript
db.table("invoices", (table) => {
  table.fk("customers").notNull();
  table.addBlock(AddressTableBlock, {
    prefix: "billing_",
    name: "billing_address",
    legacyCountry: true,
  });
});
```

## Examples of Blocks

- **Auth**: Authentication and authorization (system block)
- **CRM**: Customer relationship management (system block)
- **Scheduling**: Appointment and calendar management (system block)
- **Attachments**: File upload and management (table block)
- **Address**: Standard address fields (table block)
- **Notes List**: Comments/notes on records (table block)

## Using Blocks

```tsx
// Add block to system (calls initialize())
system.addBlock(new GlossaryBlock());

// Use block's components in your app
system.app({
  domain: "example.com",
  ui: (
    <AppRoutes>
      <Route path="/glossary">
        <GlossaryBlock.GlossaryPage />
      </Route>
    </AppRoutes>
  ),
});
```

After adding a block, you can use its components and access its tables throughout your system.

## Real-World Block Examples

### SchedulingBlock with Calendar Integration

Complex blocks can integrate multiple services and define extensive configuration:

```typescript
system.addBlock(
  new SchedulingBlock({
    calendarIntegrations: [
      {
        integration: GoogleCalendarIntegration,
        addToCalendar: true,
        checkForConflicts: true,
        eventIdField: "google_calendar_event_id",
      },
    ],
    devDefinedEventTypes: [
      {
        displayName: "Free Consultation",
        tableName: "booking_consultations",
        duration: 30,
        bufferBefore: 25,
        bufferAfter: 25,
        minNotice: 60 * 4,
        maxNotice: 60 * 24 * 60,
        timeSlotsInterval: 30,
        meetingLocation: "google_meet",
        schedulingDomain: "example.com",
        schedulingPath: "/consultation",
        defineFields: (table) => {
          table.string("invitee_first_name", 255).notNull();
          table.string("invitee_last_name", 255).notNull();
          table.string("invitee_email", 255).notNull();
          table.string("company_name", 255).notNull();
          table.string("reason", 500).multiline().notNull();
        },
        sysUserFilter: (userRecord) =>
          sql`(select does_consultations from db.sys_users su auto join db.employees where su.id = ${userRecord}.id)`,
        notifications: {
          confirmationEmail: {
            subject: () => sql.concatTemplate`Confirmed: Consultation`,
            body: (appointmentRecord) => {
              return SchedulingBlock.inviteeEmailWithFooter({
                title: sql.lit`Appointment Confirmation`,
                body: sql.htmlTemplate`
                  Your consultation is scheduled.
                  <br /><br />
                  Location: <a href="${sql`meeting_link`}">Join now</a>
                `,
                rescheduleUrl: sql.concat("https://example.com/", sql`${appointmentRecord}.public_id`, "/reschedule"),
                cancelUrl: sql.concat("https://example.com/", sql`${appointmentRecord}.public_id`, "/cancel"),
              });
            },
            from: `"Company" <notifications@example.com>`,
          },
        },
      },
    ],
  })
);
```

### CrmBlock with Custom Fields

Blocks can extend tables with custom fields and enums:

```typescript
system.enum_({
  name: "sales_pipeline_stage",
  values: [
    { name: "pr_brand_positioning", displayName: "PR: Brand Positioning" },
    { name: "marketing_campaign", displayName: "Marketing: Campaign" },
    { name: "sales_qualification", displayName: "Sales: Qualification" },
    { name: "close_contract", displayName: "Close: Contract Signing" },
  ],
});

system.addBlock(
  new CrmBlock({
    type: "b2b",
    organizations: {
      tableName: "organizations",
      define: (table) => {
        table.string("description", 255);
        table.uint("monthly_recurring_fee");
        table.bool("is_customer").notNull().default(sql`false`);
        table.enum("pipeline_stage", "sales_pipeline_stage");
      },
    },
    people: {
      tableName: "contacts",
      commentSection: true,
      disableDefaultFields: true,
      define: (table) => {
        table.string("first_name", 255);
        table.string("last_name", 255);
        table.email("email").notNull().unique();
        table.phoneNumber("phone");
        table.string("role", 255);
        table.addBlock(AttachmentsTableBlock);
        table.bool("podcasts_subscriber").notNull().default(sql`false`);
      },
    },
  })
);
```

### Managed Marketing Email Blocks

The application owns campaign and tracking state while the platform owns the
delivery provider and credentials:

```typescript
const delivery = new BulkEmailDeliveryBlock();
delivery.registerSource({ key: "client_alert" });
system.addBlock(delivery);
```

### GoogleCalendarIntegration Block

Service integration blocks encapsulate OAuth and API interactions:

```typescript
system.addBlock(
  new GoogleCalendarIntegration({
    notificationDomain: "example.com",
    provider: "google_calendar",
    scopes: sql`json_build_array(
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'email'
    )`,
  })
);
```

## Available Blocks

### System Blocks

```typescript
import { AuthBlock } from "blocks/auth";
import { CrmBlock } from "blocks/crm";
import { SchedulingBlock } from "blocks/scheduling";
import { GoogleCalendarIntegration } from "blocks/calendar_integrations/google";
import { BulkEmailDeliveryBlock } from "blocks/bulk_email_delivery";
import { MarketingEmailCampaignBlock } from "blocks/marketing_email_campaign";
import { EmailTemplatesBlock } from "blocks/email_templates";
import { GlossaryBlock } from "blocks/glossary";
import { DailyLogBlock } from "blocks/daily_log";
import { StaticSecretsBlock } from "blocks/static_secrets";

system.addBlock(new AuthBlock({ /* config */ }));
system.addBlock(new CrmBlock({ /* config */ }));
system.addBlock(new SchedulingBlock({ /* config */ }));
```

> **Note:** Add `StaticSecretsBlock` when code calls `getStaticSecret(...)`,
> such as Google login or external services that require stored API keys
> (email providers, Twilio, and similar integrations).

### Table Blocks

```typescript
import { AddressTableBlock } from "table_blocks/address";
import { AttachmentsTableBlock } from "table_blocks/attachments";
import { NotesListTableBlock } from "table_blocks/notes_list";
```

See the dedicated documentation for each block:

- [AuthBlock](../blocks/auth.md) - Complete authentication and authorization system
