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

`createTranslator` (from `std/i18n`) turns nested JSON translation files into
a `t(key, params?)` function that returns a SQL string expression.
`setUserLanguage` (from `std/ictx`) makes `t()` switch languages at runtime.

## Setup

One JSON file per language, with the same nested keys:

```json
// translations/en.json
{
  "common": { "submit": "Submit", "cancel": "Cancel" },
  "auth": { "login": "Sign in", "email": "Email address" },
  "items": { "count": "You have {count} items" }
}
```

```json
// translations/es.json
{
  "common": { "submit": "Enviar", "cancel": "Cancelar" },
  "auth": { "login": "Iniciar sesión", "email": "Correo electrónico" },
  "items": { "count": "Tienes {count} artículos" }
}
```

Load them at generation time and create the translator:

```tsx
import { createTranslator } from "std/i18n";
import { loadSystemTextFile } from "std/yolm_gen_api";

function getLanguage(language: string): Record<string, any> {
  return JSON.parse(loadSystemTextFile(`translations/${language}.json`));
}

export const { t } = createTranslator({
  defaultLanguage: "en",
  languages: { en: getLanguage("en"), es: getLanguage("es") },
});
```

Keys are dot paths (`t("auth.login")`) and are type-checked against the
language objects. A key missing everywhere logs a warning and renders the key
itself; a key missing in one language falls back to the default language.

## How `t()` resolves

- With a `setUserLanguage(expr)` context in scope (and more than one language
  containing the key), `t()` compiles to a SQL `case` over `expr`, so the text
  switches at runtime.
- Without it, `t()` returns one static literal for `currentLanguage` (an
  optional static override in the config) or `defaultLanguage`.
- `params` are substituted into `{name}` placeholders **at generation time**,
  so they must be static values: `t("items.count", { count: 5 })`. For
  runtime values, concatenate in SQL:
  `sql.concat(t("auth.login"), " ", sql`user_name`)`.

## Runtime language switching

Store the preference in a language enum column, expose it as a UI scalar,
and call `setUserLanguage` with that scalar. The language codes in the enum
must match the keys of `languages`.

```tsx
import { setUserLanguage } from "std/ictx";

system.enum_({
  name: "language",
  values: [
    { name: "en", displayName: "English" },
    { name: "es", displayName: "Spanish" },
  ],
});

db.table("users", (table) => {
  table.string("name", 100);
  table.enum("language").default(sql`'en'::enums.language`);
});

function App() {
  setUserLanguage(sql`user_language`);

  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "user_language",
          sql`coalesce(
            (select language from db.users where id = current_user),
            'en'::enums.language
          )`,
        );
      }}
    >
      <Typography level="h2">{t("auth.login")}</Typography>
      <Input placeholder={t("auth.email")} />
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
    </Data>
  );
}
```

`setUserLanguage` only affects `t()` calls rendered beneath the component that
calls it, and the scalar it references must be in scope where those calls
render (here, declared by the `Data`).

## File organization

Group keys by feature, with a `shared` section for labels reused across
features (`shared.fields.*`, `shared.buttons.*`, `shared.errors.*`). Keep the
same structure in every language file so key types stay valid.
