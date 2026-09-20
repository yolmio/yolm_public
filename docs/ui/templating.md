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

The Yolm Template Language is a powerful templating engine inspired by [Liquid](https://shopify.dev/docs/api/liquid), but with a key difference: all expressions and filters are standard SQL.

YTL is primarily intended for creating dynamic content like emails and notifications. While you can use it for other templating needs, it is not the primary way to build UIs in Yolm (which uses TSX).

## Overview

YTL can be used for both HTML and non-HTML output. When rendering, you can specify if the output should be HTML escaped.

You can also control database access via the `hasDbAccess` option on `renderTemplate`:
- **With DB access** (`hasDbAccess: true`): The template can run any SQL query against the system database.
- **Without DB access** (default): The template only has access to the tables, records, and scalars provided in its scope.

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
If the `htmlEscaped` flag is set, you can use triple braces to output raw HTML without escaping.

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
{% if user.is_admin %}
  Admin content
{% elsif user.role = 'editor' %}
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

## Example Usage

Here is a complete example of an email template using YTL:

```html
<h1>Welcome {{ user.name }}</h1>

{% if (select count(*) from db.notifications where user_id = user.id and unread = true) > 0 %}
  <div class="notifications">
    {% for note in select * from db.notifications where user_id = user.id and unread = true %}
      <div class="notification">
        {{ note.message }}
      </div>
    {% endfor %}
  </div>
{% endif %}

{# Display user-provided content with triple braces #}
<div class="content">
  {{{ user.bio }}}
</div>

<h2>Team Members</h2>
{% for member in select u.name, u.role, u.avatar_url
                 from db.users u
                 where u.team_id = user.team_id
                 order by u.name %}
  <div class="member">
    <h3>{{ member.name }}</h3>
    <p>Role: {{ member.role }}</p>
  </div>
{% endfor %}
```

## Usage in Code

To render a template from a procedure, use the `renderTemplate` statement. Note that the `scope` maps template variable names to the names of scalars or fields already defined in your procedure's scope:

```typescript
s.defScalar("first_name", sql`user.first_name`);

s.renderTemplate({
  template: sql`Hello {{name}}!`,
  scope: {
    name: "first_name"
  },
  htmlEscaped: true,
  defOutputScalar: "rendered_body"
});
```
