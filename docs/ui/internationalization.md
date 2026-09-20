---
title: Internationalization (i18n)
description: How to implement multi-language support in Yolm applications using createTranslator and translation files.
tags:
  - ui
  - i18n
  - localization
  - translations
---

# Internationalization (i18n)

Yolm provides built-in support for internationalization through the `createTranslator` function and JSON translation files.

## Basic Setup

### 1. Create Translation Files

Create JSON files for each supported language:

```json
// translations/en.json
{
  "common": {
    "submit": "Submit",
    "cancel": "Cancel",
    "delete": "Delete"
  },
  "auth": {
    "login": "Sign in",
    "logout": "Sign out",
    "email": "Email address"
  }
}
```

```json
// translations/es.json
{
  "common": {
    "submit": "Enviar",
    "cancel": "Cancelar",
    "delete": "Eliminar"
  },
  "auth": {
    "login": "Iniciar sesión",
    "logout": "Cerrar sesión",
    "email": "Correo electrónico"
  }
}
```

### 2. Load Translation Files

Use `YolmGenApi.loadSystemTextFile` to load translations at generation time:

```tsx
import * as YolmGenApi from "std/yolm_gen_api";
import { createTranslator } from "std/i18n";

function getLanguage(language: string): Record<string, any> {
  const relativePath = `translations/${language}.json`;
  const text = YolmGenApi.loadSystemTextFile(relativePath);
  return JSON.parse(text);
}

const enTranslations = getLanguage("en");
const esTranslations = getLanguage("es");
const frTranslations = getLanguage("fr");
```

### 3. Create Translator

```tsx
const { t } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: enTranslations,
    es: esTranslations,
    fr: frTranslations,
  },
});
```

## Using Translations

### In UI Components

`t()` only switches languages at runtime when a user-language context is active (see [Setting User Language](#setting-user-language) and `setUserLanguage`). Without it, `t()` resolves to a single static string for the default (or configured) language.

```tsx
function LoginForm() {
  return (
    <Card>
      <Typography level="h3">{t("auth.login")}</Typography>

      <Input placeholder={t("auth.email")} />

      <Button>{t("common.submit")}</Button>
      <Button variant="plain">{t("common.cancel")}</Button>
    </Card>
  );
}
```

### With Interpolation

Translation files can contain placeholders:

```json
{
  "greeting": "Hello, {name}!",
  "itemCount": "You have {count} items"
}
```

For static values known at generation time, pass them as the second argument; `{placeholder}` tokens are substituted directly:

```tsx
<Typography>{t("itemCount", { count: 5 })}</Typography>
```

For runtime values (SQL-derived), interpolate with a `sql` expression or SQL concat, since `params` substitution happens at generation time:

```tsx
<Typography>
  {sql.concat(t("messages.welcome"), " ", sql`user_name`)}
</Typography>
```

## Setting User Language

### From Database

Store user language preference in the database:

```tsx
db.table("users", (table) => {
  table.enum("language").default(sql`'en'::enums.language`);
});
```

### Set Language Dynamically

Use `setUserLanguage` to change the active language:

```tsx
import { setUserLanguage } from "std/ictx";

function MyApp() {
  // Set the user's language for all translations
  setUserLanguage(sql`current_lang`);

  return (
    <Data procedure={(s) => {
      s.defScalar(
        "current_lang",
        sql`
          coalesce(
            (select language from db.members where id = current_member),
            'en'::enums.language
          )
        `,
      );
    }}>
      <div>{t("common.welcome")}</div>
    </Data>
  );
}
```

### Language Selector

Allow users to change language:

```tsx
function LanguageSelector() {
  return (
    <EnumSelect
      enum="language"
      value={sql`current_lang`}
      onChange={(s) => {
        s.setScalar("current_lang", sql`target_value`);
        s.server((s) => {
          s.startTransaction();
          s.modify(sql`
            update members
            set language = cast(current_lang as enums.language)
            where id = current_member
          `);
          s.commitTransaction();
        });
      }}
    />
  );
}
```

## Translation File Structure

### Nested Keys

Organize translations hierarchically:

```json
{
  "stats": {
    "fields": {
      "name": "Name",
      "email": "Email"
    },
    "errors": {
      "required": "This field is required",
      "invalidEmail": "Invalid email address"
    },
    "actions": {
      "save": "Save changes",
      "cancel": "Cancel"
    }
  }
}
```

Access with dot notation:

```tsx
t("stats.fields.name")
t("stats.errors.required")
t("stats.actions.save")
```

### Shared Translations

Create a `common` or `shared` section for reused text:

```json
{
  "shared": {
    "fields": {
      "name": "Name",
      "email": "Email",
      "phone": "Phone"
    },
    "buttons": {
      "save": "Save",
      "cancel": "Cancel",
      "delete": "Delete"
    }
  }
}
```

## Complete Example

```tsx
import * as YolmGenApi from "std/yolm_gen_api";
import { createTranslator } from "std/i18n";
import { setUserLanguage } from "std/ictx";
import { system } from "std/system";

// Load translation files
function getLanguage(language: string): Record<string, any> {
  const relativePath = `translations/${language}.json`;
  const text = YolmGenApi.loadSystemTextFile(relativePath);
  return JSON.parse(text);
}

const enTranslations = getLanguage("en");
const esTranslations = getLanguage("es");

// Create translator
const { t } = createTranslator({
  defaultLanguage: "en",
  languages: {
    en: enTranslations,
    es: esTranslations,
  },
});

// Define language enum
system.enum_({
  name: "language",
  values: [
    { name: "en", displayName: "English" },
    { name: "es", displayName: "Spanish" },
  ],
});

// User profile with language
db.table("users", (table) => {
  table.string("name", 100);
  table.enum("language").default(sql`'en'::enums.language`);
});

// App with i18n
function MyApp() {
  setUserLanguage(sql`user_language`);

  return (
    <Data procedure={(s) => {
      s.defScalar(
        "user_language",
        sql`(select language from db.users where id = current_user)`,
      );
    }}>
    <div>
      <Typography level="h2">{t("app.title")}</Typography>

      <EnumSelect
        enum="language"
        value={sql`user_language`}
        onChange={(s) => {
          s.setScalar("user_language", sql`target_value`);
          s.server((s) => {
            s.startTransaction();
            s.modify(sql`
              update db.users
              set language = cast(user_language as enums.language)
              where id = current_user
            `);
            s.commitTransaction();
          });
        }}
      />

      <Card>
        <Typography>{t("app.welcome")}</Typography>
        <Button>{t("common.getStarted")}</Button>
      </Card>
    </div>
    </Data>
  );
}
```

## Best Practices

1. **Organize by feature** - Group related translations together
2. **Use consistent keys** - Follow a naming pattern across languages
3. **Keep translations short** - UI space is limited
4. **Provide context** - Use descriptive key names
5. **Default language** - Always include a default language fallback
6. **Test all languages** - Ensure translations work in the UI
7. **Separate concerns** - Keep shared translations separate from feature-specific ones

## Translation File Best Practices

```json
{
  "shared": {
    "fields": { /* Common field labels */ },
    "buttons": { /* Common button text */ },
    "errors": { /* Common error messages */ },
    "placeholders": { /* Common input placeholders */ }
  },
  "featureName": {
    "title": "Feature Title",
    "description": "Feature description",
    "fields": { /* Feature-specific fields */ },
    "actions": { /* Feature-specific actions */ }
  }
}
```
