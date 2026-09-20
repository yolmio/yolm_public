import type { Sql } from "../../std/sql_utils";
import { createStyles } from "std/style_utils";
import type { Node } from "std/ui";

export interface Opts {
  openScalar: Sql;
  buttonId: Sql;
  children: Node;
}

const styles = createStyles({
  popover: (app) => {
    return {
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      border: "1px solid",
      borderColor: "divider",
      zIndex: 1400,

      opacity: 0,
      transformOrigin: "top left",
      transform: "scale(0)",

      "&:popover-open": {
        opacity: 1,
        transform: "none",
        "@starting-style": {
          "&": {
            opacity: 0,
            transform: "scale(0)",
          },
        },
      },

      margin: 0,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
  },
  popoverInner: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    py: 4,
    px: 6,
  },
});

export function ToolbarPopover({ openScalar, buttonId, children }: Opts) {
  return (
    <div
      sx={styles.popover()}
      tabIndex={-1}
      popover="auto"
      yolmPopoverShowing={openScalar}
      floating={{
        anchorEl: buttonId,
        placement: "bottom-start",
        strategy: "fixed",
        shift: { mainAxis: true, crossAxis: true },
        offset: {
          mainAxis: 4,
          crossAxis: 0,
        },
        flip: { crossAxis: false, mainAxis: false },
      }}
      onToggleHide={(s) => {
        s.setScalar(openScalar, false);
      }}
    >
      <div sx={styles.popoverInner}>{children}</div>
    </div>
  );
}
