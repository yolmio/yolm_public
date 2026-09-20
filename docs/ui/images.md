---
title: Image components
description: ExpandableImage, ImageGallery, EditableImageThumbnail and ImageDialog for viewing, browsing, and editing user-uploaded images.
tags:
  - ui
  - images
  - components
---

# Image components

Components in `packages/components` for showing and editing images:

- `ExpandableImage` — a single image thumbnail that opens to a full-size modal
  when clicked.
- `ImageGallery` — a generic gallery scope with prev/next modal navigation;
  you provide the thumbnail grid.
- `EditableImageThumbnail` — a thumbnail bound to an `image_set` field group on
  the current record, with upload/replace/remove controls.
- `ImageDialog` — the underlying view/replace/remove dialog for an `image_set`
  field group.

## ExpandableImage

```tsx
import { ExpandableImage } from "components/expandable_image";
import { sql } from "std/sql_utils";

<ExpandableImage src={sql`profile_image_url`} alt="Avatar" />
```

Click the thumbnail to enlarge it in a modal; the modal's backdrop
closes the preview.

### Props

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `src` | `Sql` | yes | Image source URL expression. |
| `alt` | `Sql \| string` | no | Accessible alt text. |
| `className` | `string` | no | Extra class names for the thumbnail. |
| `sx` | `Style` | no | Style overrides for the thumbnail. |

## ImageGallery

When you have multiple images and want a unified prev/next viewer:

```tsx
import { ImageGallery } from "components/image_gallery";
import { sql } from "std/sql_utils";
import { Each } from "std/ui";

<ImageGallery
  count={sql`(select count(*) from db.contact_photos where contact = current_id)`}
  getImageSource={(index) => sql`(select url from db.contact_photos where contact = current_id order by ordinal limit 1 offset ${index})`}
  alt="Contact photo"
>
  <Each
    table="contact_photos"
    recordName="photo"
    where={sql`contact = current_id`}
    orderBy={sql`ordinal`}
  >
    <button onClick={(s) => ImageGallery.open(s, sql`photo.iteration_index`)}>
      <img src={sql`photo.url`} alt="Contact photo" />
    </button>
  </Each>
</ImageGallery>
```

### Props

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `count` | `Sql` | yes | Total number of images (SQL expression). |
| `getImageSource` | `(index: Sql) => Sql` | yes | Returns the image URL for a given 0-based index. |
| `alt` | `Sql \| string` | no | Alt text for the modal image. |
| `children` | `Node` | yes | Thumbnail grid; rendered as-is inside the gallery scope. |

The component provides a `<Data>` scope with two scalars:

- `gallery_open` — whether the modal is open.
- `gallery_index` — current 0-based image index.

Call `ImageGallery.open(s, index)` from a thumbnail's `onClick` to open the
gallery at the right image.

## EditableImageThumbnail

A 128×128 thumbnail bound to an `image_set` field group on the current record.
Clicking it opens an [ImageDialog](#imagedialog) to replace or remove the image;
when the field group has no image yet it shows an upload placeholder.

```tsx
import { EditableImageThumbnail } from "components/editable_image_thumbnail";

<RecordPage table="contacts">
  {/* ... */}
  <EditableImageThumbnail />
</RecordPage>
```

It reads the current table, record, and refetch from context, so it must be
placed inside a record context (e.g. `RecordPage`). The table must define an
`image_set` field group (see `imageSetFieldGroup()` in `field_groups/image_set`).
The record is refetched after upload, replace, or remove.

### Props

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `group` | `string` | no | Name of the `image_set` field group to edit. Omit to use the table's only image set, or the one named `main_image` when several exist. |

## ImageDialog

A modal that shows the full-size image for an `image_set` field group with
Replace and Remove buttons. `EditableImageThumbnail` uses it internally; render
it directly when you want the dialog without the thumbnail.

```tsx
import { ImageDialog } from "components/image_dialog";

<ImageDialog
  bindScalar="dialog_open"
  group="main_image"
  afterReplace={(s) => s.refetch()}
  afterRemove={(s) => s.refetch()}
/>
```

### Props

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `group` | `string` | yes | Name of the `image_set` field group to view/edit. |
| `tableName` | `string` | no | Table containing the field group. Defaults to the current table from context. |
| `recordId` | `NumericExpr` | no | Record id. Defaults to the current record from context. |
| `afterReplace` | `UiServerStatementsOrFn` | no | Statements run after a successful replace. |
| `afterRemove` | `UiServerStatementsOrFn` | no | Statements run after a successful remove. |

Control open state with the standard `DialogBinding`: provide exactly one of
`bindScalar` (own a UI scalar), `bindRecordField` (a `record.field` open-state
field), or `open` + `onClose` (manual control).

## Related

- [Modal](./modal.md)
- [Form](./form.md)
- [Data](./data.md)
</content>
</invoke>
