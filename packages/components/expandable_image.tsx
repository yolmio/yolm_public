import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { Style } from "std/style_types";
import type { DomStatements } from "std/statements";
import { Data } from "std/data";
import { IconButton } from "./icon_button";
import { ModalDialog } from "./modal";

/** Props for {@link ExpandableImage}. */
export interface ExpandableImageProps {
  /** Image source URL. */
  src: Sql;
  /** Accessible alt text. */
  alt?: Sql | string;
  /** Extra class names for the thumbnail. */
  className?: string;
  /** Style overrides for the thumbnail. */
  sx?: Style;
  /** Extra class names for the expanded image. */
  expandedClassName?: string;
  /** Style overrides for the expanded image. */
  expandedSx?: Style;
}

/**
 * Image thumbnail that opens to a full-size modal when clicked. Use for
 * any image where the user might want a closer look (avatars, file
 * previews, document attachments).
 */
export function ExpandableImage(props: ExpandableImageProps) {
  const { src, alt, className, sx, expandedClassName, expandedSx } = props;
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("img_expanded", false);
      }}
    >
      <img
        src={src}
        alt={alt}
        className={className}
        sx={[
          {
            cursor: "pointer",
            transition: "opacity 150ms ease",
            "&:hover": { opacity: 0.85 },
          },
          sx,
        ]}
        tabIndex={0}
        role="button"
        onClick={(s: DomStatements) => s.setScalar("img_expanded", sql`true`)}
        onKeyDown={(s: DomStatements) => {
          s.if(sql`event.key = 'Enter' or event.key = ' '`, (s) => {
            s.event.preventDefault();
            s.setScalar("img_expanded", sql`true`);
          });
        }}
      />
      <ModalDialog
        layout="center"
        open={sql`img_expanded`}
        onClose={(s) => s.setScalar("img_expanded", sql`false`)}
        sx={{
          background: "transparent",
          boxShadow: "none",
          padding: 0,
          maxWidth: "calc(100vw - 48px)",
          "--modal-dialog-padding": 0,
        }}
      >
        <div
          sx={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconButton
            icon="Close"
            aria-label="Close image preview"
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
            onClick={(s) => s.setScalar("img_expanded", sql`false`)}
          />
          <img
            src={src}
            alt={alt}
            className={expandedClassName}
            sx={[
              {
                maxWidth: "calc(100vw - 48px)",
                maxHeight: "calc(100vh - 48px)",
                objectFit: "contain",
                borderRadius: 2,
              },
              expandedSx,
            ]}
          />
        </div>
      </ModalDialog>
    </Data>
  );
}
