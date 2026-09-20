import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { Node } from "std/ui";
import { Show } from "std/ui";
import type { DomStatements } from "std/statements";
import { Data } from "std/data";
import { IconButton } from "./icon_button";
import { ModalDialog } from "./modal";

/** Props for {@link ImageGallery}. */
export interface ImageGalleryProps {
  /** Total number of images (SQL expression). */
  count: Sql;
  /** Returns the image URL for a given 0-based index (SQL expression). */
  getImageSource: (index: Sql) => Sql;
  /** Alt text for the modal image. */
  alt?: Sql | string;
  /** Children rendered as-is — consumer builds their own thumbnail grid. */
  children: Node;
}

/**
 * Generic image gallery: provides a `<Data>` scope with `gallery_open`
 * and `gallery_index` scalars plus a modal viewer with prev/next
 * navigation. The caller renders thumbnails as children and toggles the
 * gallery open with the standard scalar-setting statements.
 */
export function ImageGallery(props: ImageGalleryProps) {
  const { count, getImageSource, alt, children } = props;
  const imgSrc = getImageSource(sql`gallery_index`);
  const prevIndex =
    sql`case when gallery_index = 0 then ${count} - 1 else gallery_index - 1 end`;
  const nextIndex =
    sql`case when gallery_index >= ${count} - 1 then 0 else gallery_index + 1 end`;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("gallery_open", false);
        s.defScalar("gallery_index", sql`cast(0 as bigint)`);
      }}
    >
      {children}
      <ModalDialog
        layout="center"
        open={sql`gallery_open`}
        onClose={(s) => s.setScalar("gallery_open", sql`false`)}
        sx={{
          background: "transparent",
          boxShadow: "none",
          padding: 0,
          maxWidth: "calc(100vw - 48px)",
          "--modal-dialog-padding": 0,
        }}
      >
        <div
          tabIndex={0}
          onKeyDown={(s: DomStatements) => {
            s.if(sql`event.key = 'ArrowLeft'`, (s) => {
              s.setScalar("gallery_index", prevIndex);
            });
            s.if(sql`event.key = 'ArrowRight'`, (s) => {
              s.setScalar("gallery_index", nextIndex);
            });
          }}
          sx={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            outline: "none",
          }}
        >
          <IconButton
            icon="Close"
            size="sm"
            variant="solid"
            sx={{
              position: "absolute",
              top: 2,
              right: 2,
              zIndex: 1,
              color: "white",
              backgroundColor: "rgba(0,0,0,0.5)",
              "&:hover": { backgroundColor: "rgba(0,0,0,0.7)" },
            }}
            onClick={(s) => s.setScalar("gallery_open", sql`false`)}
          />
          <Show when={sql`${count} > 1`}>
            <IconButton
              icon="ChevronLeft"
              size="lg"
              variant="solid"
              sx={{
                position: "absolute",
                left: 2,
                zIndex: 1,
                color: "white",
                backgroundColor: "rgba(0,0,0,0.4)",
                "&:hover": { backgroundColor: "rgba(0,0,0,0.7)" },
              }}
              onClick={(s) => s.setScalar("gallery_index", prevIndex)}
            />
          </Show>
          <img
            src={imgSrc}
            alt={alt}
            sx={{
              maxWidth: "calc(100vw - 48px)",
              maxHeight: "calc(100vh - 48px)",
              objectFit: "contain",
              borderRadius: 2,
            }}
          />
          <Show when={sql`${count} > 1`}>
            <IconButton
              icon="ChevronRight"
              size="lg"
              variant="solid"
              sx={{
                position: "absolute",
                right: 2,
                zIndex: 1,
                color: "white",
                backgroundColor: "rgba(0,0,0,0.4)",
                "&:hover": { backgroundColor: "rgba(0,0,0,0.7)" },
              }}
              onClick={(s) => s.setScalar("gallery_index", nextIndex)}
            />
          </Show>
        </div>
      </ModalDialog>
    </Data>
  );
}

/**
 * Opens the gallery modal at the given 0-based image index. Call from a
 * thumbnail's event handler within an {@link ImageGallery} scope.
 */
ImageGallery.open = (s: DomStatements, index: Sql) => {
  s.setScalar("gallery_index", index);
  s.setScalar("gallery_open", sql`true`);
};
