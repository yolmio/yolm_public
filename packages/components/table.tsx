import { useDefaultColor } from "std/ictx";
import { createStyles, cssVar, getVariantStyle } from "std/style_utils";
import type { Node } from "std/ui";
import type { ComponentOpts, Size } from "./types";
import { singleElementComponent } from "./utils";
import type { SingleElementComponentProps } from "./utils";

/** Props for {@link Table}. */
export interface TableProps
  extends ComponentOpts<Size>, SingleElementComponentProps {
  /**
   * Which cell borders to draw. `x`/`y` border outer edges plus between cells;
   * the `Between` variants draw only the lines between cells. Defaults to `xBetween`.
   */
  borderAxis?:
    | "both"
    | "bothBetween"
    | "none"
    | "x"
    | "xBetween"
    | "y"
    | "yBetween";
  children: Node;
  /** Highlight a body row on hover. */
  hoverRow?: boolean;
  /** Truncate overflowing cell text with an ellipsis instead of wrapping. */
  noWrap?: boolean;
  /** Pin the `tfoot` to the bottom of a scrolling table. */
  stickyFooter?: boolean;
  /** Pin the `thead` to the top of a scrolling table. */
  stickyHeader?: boolean;
  /** Apply a zebra stripe background to odd or even body rows. */
  stripe?: "odd" | "even";
}

const tableSelector = {
  /**
       According to https://www.w3.org/TR/2014/REC-html5-20141028/tabular-data.html#the-tr-element,
       `tr` can only have `td | th` as children, so using :first-of-type is better than :first-child to prevent emotion SSR warning
       */
  getColumnExceptFirst() {
    return "& tr > *:not(:first-of-type), & tr > th + td, & tr > td + th";
  },
  /**
       Every cell in the table
       */
  getCell() {
    return "& th, & td";
  },
  /**
     `th` cell of the table (could exist in the body)
     */
  getHeadCell() {
    return "& th";
  },
  /**
     Only the cell of `thead`
     */
  getHeaderCell() {
    return "& thead th";
  },
  getHeaderCellOfRow(row: number | string) {
    return `& thead tr:nth-of-type(${row}) th`;
  },
  getBottomHeaderCell() {
    return "& thead th:not([colspan])";
  },
  getHeaderNestedFirstColumn() {
    return "& thead tr:not(:first-of-type) th:not([colspan]):first-of-type";
  },
  /**
     The body cell that contains data
     */
  getDataCell() {
    return "& td";
  },
  getDataCellExceptLastRow() {
    return "& tr:not(:last-of-type) > td";
  },
  /**
     The body cell either `td` or `th`
     */
  getBodyCellExceptLastRow() {
    return `${this.getDataCellExceptLastRow()}, & tr:not(:last-of-type) > th[scope="row"]`;
  },
  getBodyCellOfRow(row: number | string) {
    if (typeof row === "number" && row < 0) {
      return `& tbody tr:nth-last-of-type(${
        Math.abs(
          row,
        )
      }) td, & tbody tr:nth-last-of-type(${Math.abs(row)}) th[scope="row"]`;
    }
    return `& tbody tr:nth-of-type(${row}) td, & tbody tr:nth-of-type(${row}) th[scope="row"]`;
  },
  getBodyRow(row?: number | string) {
    if (row === undefined) {
      return "& tbody tr";
    }
    return `& tbody tr:nth-of-type(${row})`;
  },
  getFooterCell() {
    return "& tfoot th, & tfoot td";
  },
  getFooterFirstRowCell() {
    return "& tfoot tr:not(:last-of-type) th, & tfoot tr:not(:last-of-type) td";
  },
};

const styles = createStyles({
  root: (
    app,
    {
      size,
      variant,
      color,
      borderAxis,
      stickyHeader,
      stickyFooter,
      noWrap,
      hoverRow,
      stripe,
    }: Omit<TableProps, "children">,
  ) => {
    const variantStyle = getVariantStyle(variant!, color!);
    return {
      "--table-header-underline-thickness": "2px",
      "--table-cell-border-color": (variantStyle as any)?.borderColor ??
        cssVar("palette-divider"),
      "--table-cell-head-background": `var(--sheet-background, ${
        cssVar("palette-background-surface")
      })`,
      ...(size === "xs" && {
        "--table-cell-height": "var(--table-cell-height, 28px)",
        "--table-cell-padding-x": "0.1875rem",
        "--table-cell-padding-y": "0.1875rem",
      }),
      ...(size === "sm" && {
        "--table-cell-height": "var(--table-cell-height, 32px)",
        "--table-cell-padding-x": "0.25rem",
        "--table-cell-padding-y": "0.25rem",
      }),
      ...(size === "md" && {
        "--table-cell-height": "var(--table-cell-height, 40px)",
        "--table-cell-padding-x": "0.5rem",
        "--table-cell-padding-y": "0.375rem",
      }),
      ...(size === "lg" && {
        "--table-cell-height": "var(--table-cell-height, 48px)",
        "--table-cell-padding-x": "0.75rem",
        "--table-cell-padding-y": "0.5rem",
      }),
      tableLayout: "fixed",
      width: "100%",
      borderSpacing: "0px",
      borderCollapse: "separate",
      borderRadius: "var(--table-cell-corner-radius, var(--action-radius))",
      ...app.theme.typography[
        `body-${({ xs: "xs", sm: "sm", md: "md", lg: "lg" } as const)[size!]}`
      ],
      ...variantStyle,
      "& caption": {
        color: cssVar("palette-text-tertiary"),
        paddingY: "calc(2 * var(--table-cell-padding-y))",
        paddingX: "var(--table-cell-padding-x)",
      },
      [tableSelector.getDataCell()]: {
        paddingY: "var(--table-cell-padding-y)",
        paddingX: "var(--table-cell-padding-x)",
        height: "var(--table-cell-height)",
        borderColor: "var(--table-cell-border-color)",
        backgroundColor: "var(--table-cell-data-background)",
        ...(noWrap && {
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }),
      },
      [tableSelector.getHeadCell()]: {
        textAlign: "left",
        paddingY: "var(--table-cell-padding-y)",
        paddingX: "var(--table-cell-padding-x)",
        backgroundColor: "var(--table-cell-head-background)",
        height: "var(--table-cell-height)",
        fontWeight: cssVar("font-weight-semibold"),
        borderColor: "var(--table-cell-border-color)",
        color: cssVar("palette-text-secondary"),
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        overflow: "hidden",
      },
      [tableSelector.getHeaderCell()]: {
        verticalAlign: "bottom",
        "&:first-of-type": {
          borderTopLeftRadius:
            "var(--table-cell-corner-radius, var(--action-radius))",
        },
        "&:last-of-type": {
          borderTopRightRadius:
            "var(--table-cell-corner-radius, var(--action-radius))",
        },
      },
      "& tfoot tr > *": {
        backgroundColor: `var(--table-cell-foot-background, ${
          cssVar("palette-background-level1")
        })`,
        "&:first-of-type": {
          borderBottomLeftRadius:
            "var(--table-cell-corner-radius, var(--action-radius))",
        },
        "&:last-of-type": {
          borderBottomRightRadius:
            "var(--table-cell-corner-radius, var(--action-radius))",
        },
      },
      ...(borderAxis?.startsWith("x") || borderAxis?.startsWith("both")
        ? {
          [tableSelector.getHeaderCell()]: {
            borderBottomWidth: 1,
            borderBottomStyle: "solid",
          },
          [tableSelector.getBottomHeaderCell()]: {
            borderBottomWidth: "var(--table-header-underline-thickness)",
            borderBottomStyle: "solid",
          },
          [tableSelector.getBodyCellExceptLastRow()]: {
            borderBottomWidth: 1,
            borderBottomStyle: "solid",
          },
          [tableSelector.getFooterCell()]: {
            borderTopWidth: 1,
            borderTopStyle: "solid",
          },
        }
        : {}),
      ...(borderAxis?.startsWith("y") || borderAxis?.startsWith("both")
        ? {
          [`${tableSelector.getColumnExceptFirst()}, ${tableSelector.getHeaderNestedFirstColumn()}`]:
            {
              borderLeftWidth: 1,
              borderLeftStyle: "solid",
            },
        }
        : {}),
      ...(borderAxis === "x" || borderAxis === "both"
        ? {
          [tableSelector.getHeaderCellOfRow(1)]: {
            borderTopWidth: 1,
            borderTopStyle: "solid",
          },
          [tableSelector.getBodyCellOfRow(-1)]: {
            borderBottomWidth: 1,
            borderBottomStyle: "solid",
          },
          [tableSelector.getFooterCell()]: {
            borderBottomWidth: 1,
            borderBottomStyle: "solid",
          },
        }
        : {}),
      ...(borderAxis === "y" || borderAxis === "both"
        ? {
          "& tr > *:first-of-type": {
            borderLeftWidth: 1,
            borderLeftStyle: "solid",
          },
          "& tr > *:last-of-type:not(:first-of-type)": {
            borderRightWidth: 1,
            borderRightStyle: "solid",
          },
        }
        : {}),
      ...(stripe && {
        [tableSelector.getBodyRow(stripe)]: {
          background: `var(--table-row-stripe-background, ${
            cssVar("palette-background-level2")
          })`,
          color: cssVar("palette-text-primary"),
        },
      }),
      ...(hoverRow && {
        [tableSelector.getBodyRow()]: {
          "&:hover": {
            background: `var(--table-row-hover-background, ${
              cssVar("palette-background-level3")
            })`,
          },
        },
      }),
      ...(stickyHeader && {
        [tableSelector.getHeaderCell()]: {
          position: "sticky",
          top: 0,
          zIndex: 50,
        },
        [tableSelector.getHeaderCellOfRow(2)]: {
          top: "var(--table-cell-height)",
        },
      }),
      ...(stickyFooter && {
        "& tfoot > tr > th, & tfoot > tr > td": {
          position: "sticky",
          bottom: 0,
          zIndex: 50,
          color: cssVar("palette-text-secondary"),
          fontWeight: cssVar("font-weight-semibold"),
        },
        [tableSelector.getFooterFirstRowCell()]: {
          bottom: "var(--table-cell-height)",
        },
      }),
    };
  },
});

/**
 A customizable table component with various styling options.

 @category UI Component

 @param props.children - The content of the table.
 @param props.borderAxis - Determines the border style of the table. Default is "xBetween".
 @param props.hoverRow - Enables row hover effect. Default is false.
 @param props.noWrap - Prevents text wrapping in cells. Default is false.
 @param props.size
 @param props.variant
 @param props.color
 @param props.stripe - Enables striped rows. Can be "odd" or "even".
 @param props.stickyHeader - Makes the header stick to the top. Default is false.
 @param props.stickyFooter - Makes the footer stick to the bottom. Default is false.

 @examples
[Example](../../examples/northwind/apps/northwind.yolmstaging.net.tsx)

*/
export function Table(props: TableProps & JSX.IntrinsicElements["table"]) {
  const {
    children,
    borderAxis = "xBetween",
    hoverRow = false,
    noWrap = false,
    size = "md",
    variant = "plain",
    color = useDefaultColor("neutral"),
    stripe,
    stickyHeader = false,
    stickyFooter = false,
    ...other
  } = props;
  const [Root, rootProps] = singleElementComponent({
    component: "table",
    sx: styles.root({
      borderAxis,
      hoverRow,
      noWrap,
      size,
      variant,
      color,
      stripe,
      stickyHeader,
      stickyFooter,
    }),
    externalProps: other,
  });
  return <Root {...rootProps}>{children}</Root>;
}
