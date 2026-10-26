---
title: HubSpot Service
description: Yolm service client for the HubSpot CRM API with typed contacts helpers.
tags:
  - services
  - hubspot
  - crm
  - integrations
---

# HubSpot Service

`services/hubspot` exports `Hubspot` (the API client class) and a default
`hubspot` singleton wired to the `HUBSPOT_API_TOKEN` static secret.

## Importing

```ts
import { hubspot } from "services/hubspot";
```

To customize the token or webhook base name, pass the token **value** as a
SQL expression (typically `getStaticSecret(...)`), not a secret name:

```ts
import { Hubspot } from "services/hubspot";
import { getStaticSecret } from "std/services";
import { sql } from "std/sql_utils";

const altHubspot = new Hubspot({
  apiToken: getStaticSecret(sql.lit`OTHER_HUBSPOT_TOKEN`),
  webhookBaseName: "hubspot_alt",
});
```

## Contacts

The `.contacts` accessor exposes typed helpers for HubSpot's
`/crm/v3/objects/contacts` endpoints:

```ts
s.statements(hubspot.contacts.list({ /* paging opts */ }));
s.statements(hubspot.contacts.listAll({ /* paging opts */ }));
```

Cursors expose paging state through a pagination record. Use `listAll` when
you want to walk every page into one procedure-scope table.

`list` writes contacts to `contact` by default and exposes a `pagination`
record. Override those names with `resultTable` and `paginationRecord`.
`listAll` writes all rows to `contact` (or its `resultTable` override) and
keeps its internal pagination state private.
Contact rows contain `archived`, `id`, `created_at`, `updated_at`, and the JSON
`properties` object returned for the requested properties. The pagination
record contains `next_link` and `next_after`.

```ts
s.statements(hubspot.contacts.listAll({
  properties: [sql.lit`email`, sql.lit`firstname`, sql.lit`lastname`],
  archived: sql.false,
  resultTable: "hubspot_contact",
  optIn: sql.true,
}));
```

`limit` and `after` control one page; `listAll` follows `next_after` for you.
For `optIn`, see
[External-Service Opt-In](./solution_services.md#external-service-opt-in).

## Prerequisites

- `StaticSecretsBlock` registered in core so the `HUBSPOT_API_TOKEN` static
  secret can be read.

## Related

- Store access tokens as server-side static secrets.
- [Service integrations](../concepts/service_integrations.md)
