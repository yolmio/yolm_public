import { Divider } from "components/divider";
import { Typography } from "components/typography";
import { baseGridStyles, containerStyles, createStyles } from "std/style_utils";
import type { Node } from "std/ui";

const styles = createStyles({
  root: () => [
    containerStyles(),
    {
      display: "flex",
      flexDirection: "column",
      gap: 7,
      my: 8,
      pb: 8,
      px: 8,
      md: {
        px: 16,
      },
      lg: {
        px: 24,
      },
    },
  ],
  section: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 7,
    md: {
      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
    },
    xl: {
      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 3fr)",
    },
  },
  partsWrapper: {
    ...baseGridStyles,
    rowGap: 7,
    columnGap: 4,
  },
  buttons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 3,
  },
});

interface TwoColumnFormLayoutProps {
  header?: Node;
  children: Node;
}

/**
 A layout component for two-column forms.
 Renders a header and children within a styled container.

 @category UI Component

 */
export function TwoColumnFormLayout({
  header,
  children,
}: TwoColumnFormLayoutProps) {
  return (
    <div sx={styles.root()}>
      <Typography level="h3">{header}</Typography>
      {children}
    </div>
  );
}

interface SectionProps {
  header: Node;
  description?: string;
  children: Node;
}

TwoColumnFormLayout.Section = function Section({
  header,
  children,
  description,
}: SectionProps) {
  return (
    <>
      <Divider />
      <div sx={styles.section}>
        <div>
          <Typography level="h4" className="mb-4">
            {header}
          </Typography>
          {description && <Typography level="body-md">{description}
          </Typography>}
        </div>
        <div sx={styles.partsWrapper}>{children}</div>
      </div>
    </>
  );
};

TwoColumnFormLayout.Buttons = function Buttons({
  children,
}: {
  children: Node;
}) {
  return <div sx={styles.buttons}>{children}</div>;
};
