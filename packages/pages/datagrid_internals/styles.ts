import { createStyles } from "std/style_utils";

export const styles = createStyles({
  root: () => ({
    position: "relative",
    flexGrow: 1,
    height: "100%",
    backgroundColor: "background-body",
    border: "1px solid",
    borderColor: "divider",
  }),
  row: { display: "flex" },
  cell: ({ theme }) => {
    return {
      "&:focus-within": {
        "--focus-outline-offset": -1,
        ...theme.focus.default,
      },
      display: "flex",
      alignItems: "center",
      px: "10px",
      borderBottom: "1px solid",
      boxSizing: "border-box",
      cursor: "default",
      borderRight: "1px solid",
      borderColor: "divider",
      backgroundColor: "background-body",
    };
  },
  headerCell: ({ theme }) => {
    return {
      "&:focus-within": {
        "--focus-outline-offset": -1,
        ...theme.focus.default,
      },
      display: "flex",
      alignItems: "center",
      pl: "10px",
      pr: "4px",
      justifyContent: "space-between",
      borderBottom: "1px solid",
      boxSizing: "border-box",
      position: "relative",
      cursor: "default",
      borderRight: "1px solid",
      borderColor: "divider",
      backgroundColor: "background-level1",
    };
  },
  header: {
    display: "flex",
    position: "sticky",
    top: 0,
    zIndex: 2,
    backgroundColor: "background-body",
  },
  headerText: {
    display: "block",
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  popoverDivider: {
    mt: 2,
  },
  popoverButtons: {
    display: "flex",
    gap: 2,
  },
  ellipsisSpan: {
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  cellInput: {
    font: "inherit",
    letterSpacing: "inherit",
    color: "currentcolor",
    p: 0,
    border: 0,
    boxSizing: "content-box",
    background: "none",
    height: "100%",
    width: "100%",
    sql: 0,
    display: "block",
    outline: "none",
  },
  emptyGrid: {
    position: "relative",
    flexGrow: 1,
    height: "100%",
    backgroundColor: "background-body",
    border: "1px solid",
    borderColor: "divider",
  },
});
