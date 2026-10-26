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

- `ExpandableImage` - a thumbnail that opens a full-size modal.
- `ImageGallery` - a gallery scope with a prev/next modal viewer; you render
  the thumbnails.
- `EditableImageThumbnail` - a thumbnail bound to an `image_set` field group on
  the current record, with upload/replace/remove.
- `ImageDialog` - the view/replace/remove dialog for an `image_set` field
  group.

## ExpandableImage

```tsx
import { ExpandableImage } from "components/expandable_image";

<ExpandableImage src={sql`contact.profile_image_url`} alt="Avatar" />
```

The thumbnail is focusable (`role="button"`) and opens on click, Enter, or
Space; the modal closes from its close button, the backdrop, or Escape.
`src` is a SQL expression; `alt` may be static or SQL. `className` / `sx`
style the thumbnail and `expandedClassName` / `expandedSx` the enlarged
image. See `ExpandableImageProps` in `components/expandable_image`.

## ImageGallery

```tsx
import { ImageGallery } from "components/image_gallery";

<Data
  procedure={(s) => {
    s.defTable("photos", sql`
      select id, url, ordinal from db.contact_photos where contact = ${contactId}
    `);
  }}
>
  <ImageGallery
    count={sql`(select count(*) from photos)`}
    getImageSource={(index) =>
      sql`(select url from photos order by ordinal limit 1 offset ${index})`}
    alt="Contact photo"
  >
    <Each table="photos" recordName="photo" orderBy={sql`ordinal`}>
      <button onClick={(s) => ImageGallery.open(s, sql`photo.iteration_index`)}>
        <img src={sql`photo.url`} alt="Contact photo" />
      </button>
    </Each>
  </ImageGallery>
</Data>
```

- `count` (SQL) is the total number of images; `getImageSource(index)` returns
  a SQL expression for the URL at a 0-based index.
- The gallery wraps children in a local `Data` scope with `gallery_open` and
  `gallery_index` scalars. Open it with `ImageGallery.open(s, index)` from a
  thumbnail handler.
- In the viewer, ArrowLeft/ArrowRight and the prev/next buttons wrap around.

See `ImageGalleryProps` in `components/image_gallery`.

## EditableImageThumbnail

A 128x128 thumbnail for an `image_set` field group on the current record.
Clicking it opens an [ImageDialog](#imagedialog) to replace or remove the
image; with no image it shows an upload placeholder.

```tsx
import { EditableImageThumbnail } from "components/editable_image_thumbnail";

<RecordPage table="contacts">
  {/* ... */}
  <EditableImageThumbnail />
</RecordPage>
```

- It reads the current table, record id, and refetch from context, so place it
  inside a record context such as `RecordPage`; the thumbnail reads the
  record's image fields as `record.<field>`. The record is refetched after
  upload, replace, or remove.
- The table must define an `image_set` field group (see `imageSetFieldGroup()`
  in `field_groups/image_set`).
- `group` (optional) names the field group; omit it to use the table's only
  image set, or the one named `main_image` when several exist.

## ImageDialog

The modal behind `EditableImageThumbnail`: full-size image with Replace and
Remove buttons. Render it directly when you want the dialog without the
thumbnail.

```tsx
import { ImageDialog } from "components/image_dialog";

<ImageDialog
  bindScalar="dialog_open"
  group="main_image"
  afterReplace={(s) => s.refetch()}
  afterRemove={(s) => s.refetch()}
/>
```

- `group` (required) is the `image_set` field group.
- `tableName` and `recordId` default to the current table and record from
  context.
- `afterReplace` / `afterRemove` are server statements run after success.
- Open state uses `DialogBinding`, as in
  [ModalDialog](./modal.md#open-state).
