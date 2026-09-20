---
title: Import Patterns
description: Complete guide to Yolm's import structure, paths, and best practices for building applications.
tags:
  - coding
  - imports
  - conventions
  - patterns
---

# Import Patterns

Understanding Yolm's import structure is essential for building applications correctly. This guide covers all import paths and when to use each.

## Import Path Aliases

Yolm uses path aliases to organize functionality:

```typescript
"std/*"        → "./packages/std/*"        // Core system functionality
"components/*" → "./packages/components/*"  // UI components
"blocks/*"     → "./packages/blocks/*"     // Feature blocks
"pages/*"      → "./packages/pages/*"      // Page components
"table_blocks/*" → "./packages/table_blocks/*" // Table-scoped blocks
"field_groups/*" → "./packages/field_groups/*" // Reusable field groups
"services/*"   → "./packages/services/*"   // Third-party integrations
"apps/*"       → "./packages/apps/*"       // Complete applications
"enums/*"      → "./packages/enums/*"      // Reusable enumerations
"vis/*"        → "./packages/vis/*"        // Visualization helpers
"utils/*"      → "./packages/utils/*"      // Shared utilities
```

## Core Imports (std/*)

Essential system functionality:

### std/system
The system object for defining your application:
```typescript
import { system } from "std/system";

const { db } = system;  // Database access
system.app({ ... });    // Define apps
system.api(...);        // Define APIs
```

### std/ui
Core UI components:
```typescript
import {
  Show,
  Each,
  Route,
  Routes,
  AppRoutes,
} from "std/ui";
```

### std/data
Data component for defining UI state:
```typescript
import { Data } from "std/data";
```

### std/form
Form component for insert/update operations:
```typescript
import { Form } from "std/form";
```

### std/sql_utils
SQL utilities and tagged templates:
```typescript
import { sql, Sql } from "std/sql_utils";

sql`expression`        // SQL expressions
sql.lit`literal`      // String literals
sql.concat(...)       // String concatenation
sql.ref(expr)         // Dynamic references
```

### std/services
Service helpers (secrets, query strings, signed requests):
```typescript
import { queryParamsString } from "std/services";

// Build query strings
queryParamsString({
  search: sql`search_term`,
  page: sql`current_page`
})
```

## UI Components (components/*)

Pre-built UI components following Joy UI patterns:

### Layout Components
```typescript
import { Sidebar } from "components/sidebar";
import { Card, CardHeader, CardContent } from "components/card";
import { Divider } from "components/divider";
```

### Form Components
```typescript
import { Button } from "components/button";
import { Input } from "components/input";
import { Select } from "components/select";
import { Checkbox } from "components/checkbox";
import { IconButton } from "components/icon_button";
```

### Display Components
```typescript
import { Typography } from "components/typography";
import { Chip } from "components/chip";
import { Alert } from "components/alert";
import { MaterialIcon } from "components/material_icon";
```

### Data Components
```typescript
import { DataTable } from "components/data_table";
import { List, ListItem } from "components/list";
import { Datagrid } from "std/ui";
```

## Blocks (blocks/*)

A large unit of reuse that spans multiple areas of the stack.
Can include database schema, UI, workflow (reactor), scheduled jobs and APIs:

### AuthBlock
Authentication and authorization:
```typescript
import { AuthBlock } from "blocks/auth";

// Components
<AuthBlock.DefaultEmailOtpAuth />
<AuthBlock.OTPAuth />
<AuthBlock.UserDetailPage />
<AuthBlock.RolePages />
<AuthBlock.PermissionCheck permission="admin" />

// Forms
<AuthBlock.UserForm />
<AuthBlock.UsersList />
```

### AiProvidersBlock
AI provider configuration:
```typescript
import { AiProvidersBlock } from "blocks/ai_providers";

<AiProvidersBlock.ConfigureAiProvidersPage />
<AiProvidersBlock.ConfigureAiProvidersPage withoutRoute />
```

## Page Components (pages/*)

Self-routing page components that include their own routes:

```typescript
import { DbManagement, DbManagementPage } from "pages/db_management";
import { UpdatePage } from "pages/update_page";
import { InsertPage } from "pages/insert_page";
import { RecordPage } from "pages/record_page";
import { DatagridPage } from "pages/datagrid";
```

**Important**: These components define their own routes. Never wrap them in `<Route>`:

```typescript
// ✅ CORRECT - Page components handle their own routes
<DbManagementPage path="/db" />

// ❌ WRONG - Don't wrap in Route
<Route path="/db">
  <DbManagementPage />
</Route>

// ✅ CORRECT - Use the inner component when embedding inside an existing route
<Route path="/admin/database">
  <DbManagement />
</Route>
```

## Services (services/*)

Third-party service integrations:

```typescript
import { Postmark } from "services/postmark";
import { Twilio } from "services/twilio";
```

## Complete Apps (apps/*)

Pre-built app helpers you can include:

```typescript
import { adminApp } from "apps/admin";
```

## Project-Local Imports

Systems may define their own local aliases for reusable tables, shell layouts,
or helpers. These are project conventions, not built-in Yolm package aliases.

```typescript
import { ContactsTable } from "tables/contacts";
import { AddressesTable } from "tables/addresses";
```

## Enums (enums/*)

Reusable enumeration types:

```typescript
import { countryEnum } from "enums/country";
import { usStateEnum } from "enums/us_state";
```

## Import Best Practices

### 1. Group Related Imports

```typescript
// Core system imports
import { system } from "std/system";
import { sql } from "std/sql_utils";
import { Route, AppRoutes } from "std/ui";
import { Data } from "std/data";
import { Form } from "std/form";

// Component imports
import { Button } from "components/button";
import { Card, CardHeader, CardContent } from "components/card";
import { Typography } from "components/typography";

// Block imports
import { AuthBlock } from "blocks/auth";

// Page imports
import { DbManagementPage } from "pages/db_management";

// Local imports
import { MyComponent } from "./components/MyComponent";
```

### 2. Use Specific Imports

```typescript
// ✅ Good - Import only what you need
import { Button } from "components/button";
import { Each, Show } from "std/ui";
import { Data } from "std/data";

// ❌ Avoid - wildcard package paths are unsupported
// Import each symbol from its concrete package path instead.
```

### 3. Naming Conventions

- **Lower Case**: Standard HTML-like element components (e.g., `<div>`, `<span>`)
- **Capitalized**: Non-element components and custom components (e.g., `<DatagridPage>`, `<Routes>`)

### 4. Know Your Component Types

Before importing, understand the component type:
- **UI Components** (`components/*`): Basic building blocks
- **Page Components** (`pages/*`): Self-routing, complete pages
- **Blocks** (`blocks/*`): Feature bundles with DB schema
- **Apps** (`apps/*`): Complete applications

### 5. Check for Self-Routing

Always check if a component is self-routing before using:
```typescript
// Self-routing components (use directly)
<DbManagement />
<AuthBlock.RolePages />
<UpdatePage table="users" />

// Regular components (need Route wrapper)
<Route path="/dashboard">
  <Dashboard />
</Route>
```

### 6. Use Type Imports When Needed

```typescript
import type { Node } from "std/ui";
import type { Sql } from "std/sql_utils";

interface Props {
  children: Node;
  value: Sql;
}
```

## Common Import Patterns

### Basic App Structure
```typescript
import { system } from "std/system";
import { AppRoutes, Route } from "std/ui";
import { Data } from "std/data";
import { AuthBlock } from "blocks/auth";

const { db } = system;

function App() {
  return (
    <Data procedure={(s) => {...}}>
      <AppRoutes>
        <Route path="/">
          <Home />
        </Route>
        <AuthBlock.RolePages />
      </AppRoutes>
    </Data>
  );
}

system.app({
  domain: "myapp.com",
  ui: (
    <AuthBlock.DefaultEmailOtpAuth requiredPermission="view_app">
      <App />
    </AuthBlock.DefaultEmailOtpAuth>
  ),
});
```

### Component with Data
```typescript
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Button } from "components/button";
import { Card } from "components/card";

function MyComponent() {
  return (
    <Data procedure={(s) => {
      s.defScalar("count", 0);
    }}>
      <Card>
        <Button onClick={(s) => s.increment("count")}>
          Count: {sql`count`}
        </Button>
      </Card>
    </Data>
  );
}
```

## Troubleshooting Import Issues

### Module Not Found
- Check the import path matches the aliases exactly
- Verify the component exists in the expected package
- Remember: `std/*`, not `standard/*` or `stdlib/*`

### Self-Routing Conflicts
- If you see route conflicts, check if you're wrapping a self-routing component
- Look for `withoutRoute` prop to embed without routes

### Type Errors
- Use `type` imports for TypeScript types
- Import `Sql` type from `std/sql_utils`
- Import `Node` type from `std/ui`

Understanding these import patterns will help you structure your Yolm applications correctly and avoid common pitfalls.
