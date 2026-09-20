import type { Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import type { Node } from "std/ui";

export interface Props {
  logo?: {
    src: Sql;
    alt: string;
    sx?: Style;
    className?: string;
  };
  header: Node;
  subHeader?: Node;
}

const styles = createStyles({
  root: {
    gridColumnSpan: "full",
    display: "flex",
    flexDirection: "column",
  },
  rootWithLogo: {
    gridColumnSpan: "full",
    display: "flex",
  },
  headerWrapper: {
    display: "flex",
    flexDirection: "column",
  },
  header: {
    fontWeight: "medium",
    fontSize: "xl2",
    my: 0,
  },
  subHeader: {
    fontWeight: "medium",
    fontSize: "base",
    color: "text-secondary",
    my: 0,
  },
});

/**
 A component for displaying a dashboard header with optional logo, main header, and subheader.

@category UI Component

@param props.logo - logo configuration.
@param props.logo.src - The source URL for the logo image.
@param props.logo.alt - The alt text for the logo image.
@param [props.logo.sx] - Custom styles for the logo.
@param props.header
@param props.subHeader

@examples
[Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
 */
export function DashboardHeader(props: Props) {
  if (props.logo) {
    return (
      <div sx={styles.rootWithLogo}>
        <img
          src={props.logo.src}
          alt={props.logo.alt}
          sx={props.logo.sx}
          className={props.logo.className}
        />
        <div sx={styles.headerWrapper}>
          <h1 sx={styles.header}>{props.header}</h1>
          <h2 sx={styles.subHeader}>{props.subHeader}</h2>
        </div>
      </div>
    );
  }
  return (
    <div sx={styles.root}>
      <h1 sx={styles.header}>{props.header}</h1>
      <h2 sx={styles.subHeader}>{props.subHeader}</h2>
    </div>
  );
}
