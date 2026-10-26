---
title: Templating
description: Yolm Template Language (YTL) - a SQL-powered templating engine inspired by Liquid.
tags:
  - ui
  - templating
  - sql
  - email
  - notifications
---

# Yolm Template Language (YTL)

YTL is a templating language modeled on
[Liquid](https://shopify.dev/docs/api/liquid), except that every expression,
condition, and loop source is standard SQL. Use it for emails, notifications,
and other generated text; UIs are built with TSX, not YTL.

Templates render with `s.renderTemplate` (see [below](#usage-in-code)).
Output can be HTML-escaped (`htmlEscaped: true`) or plain. With
`hasDbAccess: true` a template may query the system database; by default it
can only see the tables, records, and scalars passed in its `scope`.

## Syntax

### Expressions
Expressions are wrapped in double curly braces and can be any valid SQL expression.

```handlebars
{{ scalar_var }}
{{ record.field_name }}
{{ some_number + other_number }}
{{ (select count(*) from db.users where active = true) }}
```

### Raw HTML
With `htmlEscaped` set, triple braces output a value without escaping. Use
them only for trusted HTML, never for user-supplied text.

```handlebars
{{{ user_provided_html }}}
{{{ (select html_content from db.pages where id = 1) }}}
```

### Comments
Comments are wrapped in `{#` and `#}`:

```handlebars
{# This is a comment that won't appear in the output #}
```

### Control Statements
Control statements use `{% %}` syntax for logic.

#### If Statements
Standard SQL conditions are used for branching.

```handlebars
{% if user_record.is_admin %}
  Admin content
{% elsif user_record.role = 'editor' %}
  Editor content
{% else %}
  Regular content
{% endif %}
```

#### For Loops
Loops always iterate over the results of a SQL query.

```handlebars
{% for row in select * from db.users order by name %}
  {{ row.name }} ({{ row.email }})
{% endfor %}

{% for result in select * from db.orders where created_at > today() %}
  Order #{{ result.id }}: {{ result.total }}
{% endfor %}
```

### Whitespace Control
Use a minus sign (`-`) to trim whitespace around control statements or expressions. You can trim one side, both, or none.

```handlebars
Previous line:
{%- if show_header -%}
  <header>
    {{- header_content }}
  </header>
{%- endif %}
```

## Example

```html
<h1>Welcome {{ user_record.name }}</h1>

{% if (select count(*) from db.notifications where user_id = user_record.id and unread = true) > 0 %}
  <div class="notifications">
    {% for note in select * from db.notifications where user_id = user_record.id and unread = true %}
      <div class="notification">
        {{ note.message }}
      </div>
    {% endfor %}
  </div>
{% endif %}

{# Trusted, pre-sanitized HTML #}
<div class="content">
  {{{ user_record.bio_html }}}
</div>

<h2>Team Members</h2>
{% for member in select u.name, u.role, u.avatar_url
                 from db.users u
                 where u.team_id = user_record.team_id
                 order by u.name %}
  <div class="member">
    <h3>{{ member.name }}</h3>
    <p>Role: {{ member.role }}</p>
  </div>
{% endfor %}
```

## Usage in Code

`s.renderTemplate` renders a template in a procedure. `scope` maps each
template variable name to the name of a scalar, record, or table already in
the procedure's scope:

```typescript
s.defScalar("first_name", sql`user_record.first_name`);

s.renderTemplate({
  template: sql`Hello {{name}}!`,
  scope: {
    name: "first_name"
  },
  htmlEscaped: true,
  defOutputScalar: "rendered_body"
});
```

Write the output to a new scalar with `defOutputScalar`, or to an existing one
with `setOutputScalar` (`outputScalar` is deprecated). See
`RenderTemplateOpts` in `std/statements`.
