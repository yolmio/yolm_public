---
title: Field Groups (image sets, address, auth)
description: Reusable bundles of related table fields registered as a single named group, plus the bundled image_set and address field groups.
tags:
  - database
  - field-groups
  - images
  - schema
---

# Field Groups

A **field group** is a reusable bundle of related table fields registered
under a single name on a table. Use them when multiple fields always travel
together (an address, an image set, auth credentials) and you want generated
forms, datagrid columns, and lookup helpers to treat them as one unit.

The packages under `packages/field_groups/` ship a few bundled groups:

- `field_groups/address` — postal address with optional regions.
- `field_groups/auth` — auth credential storage.
- `field_groups/crm_field_group` — fields used by `blocks/crm`.
- `field_groups/image_set` — one or more variants of an uploaded image.

## Image set

`field_groups/image_set` adds bytes fields for one or more **variants**
of an image (full-size, thumbnail, etc.) plus a content-type field. It
also generates the HTTP endpoints that serve each variant by blob hash.

### Defining the group

For the standard "full + 180×180 thumb" pair:

```ts
import { simpleImageSetFieldGroup } from "field_groups/image_set";

db.table("contact", (t) => {
  t.string("name", 200).notNull();
  simpleImageSetFieldGroup(t);
});
```

For a custom set (e.g. an additional dialog-size variant):

```ts
import {
  imageSetFieldGroup,
  type ImageSetVariant,
} from "field_groups/image_set";

db.table("brands", (t) => {
  t.string("name", 200).notNull();
  imageSetFieldGroup(t, {
    groupName: "logo",
    variants: {
      logo_full: { usage: "general_full" },
      logo_thumb: {
        usage: "square_thumbnail",
        resize: { width: 96, height: 96, type: sql.lit`cover` },
      },
    },
  });
});
```

### Serving variants

Inside an app, register one HTTP endpoint per variant:

```ts
import {
  createImageSetEndpointsForCurrentApp,
  ImageSetFieldGroup,
} from "field_groups/image_set";

// In an app or page setup:
const group = system.db.tables["contact"].fieldGroups["image"] as ImageSetFieldGroup;
createImageSetEndpointsForCurrentApp("contact", group);
```

Build the URL on the client side with `imageVariantUrl`.

### Picking a variant by usage

Display components ask for a variant by its semantic usage rather than
its field name; `getVariantFromImageSet` resolves the lookup with
optional fallback ordering:

```ts
const fieldName = getVariantFromImageSet(group, "square_thumbnail", [
  "general_thumbnail",
]);
```

### Uploading

`uploadImageSet(tableName, recordId, group)` returns `{ upload, updateDb }`
helpers for an upload form: `upload` (UI server) reads the uploaded
file and creates one blob per variant; `updateDb` writes the resulting
hashes back to the row.

## Related

- [Field types](./field_types.md)
- [Image components](../ui/images.md)
- [Sample data](./sample_data.md)
