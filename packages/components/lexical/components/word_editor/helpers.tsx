import { Divider } from "components/divider";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";

/** Execute a simple editor command (no extra params) via JS module */
export function execCmd(s: DomStatements, command: string) {
  s.jsCall({
    module: "lexical_editor",
    exportName: "executeCommand",
    handle: sql`ui.editor_handle`,
    argJson: sql`json_build_object('handle', ui.editor_handle, 'command', ${
      sql.lit(command)
    })`,
  });
}

/** Ribbon group label shown below buttons */
export function RibbonGroupLabel({ label }: { label: string }) {
  return (
    <Typography
      level="body-xs"
      sx={{
        textAlign: "center",
        color: "text.tertiary",
        mt: "2px",
        userSelect: "none",
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {sql.lit(label)}
    </Typography>
  );
}

/** Ribbon group container with label */
export function RibbonGroup(
  { label, children }: { label: string; children: JSX.Element },
) {
  return (
    <div
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        px: 2,
      }}
    >
      <div
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          minHeight: "36px",
        }}
      >
        {children}
      </div>
      <RibbonGroupLabel label={label} />
    </div>
  );
}

/** Vertical separator between ribbon groups */
export function RibbonSep() {
  return (
    <Divider
      orientation="vertical"
      sx={{ alignSelf: "stretch", my: 1, mx: 1 }}
    />
  );
}
