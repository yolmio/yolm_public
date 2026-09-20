import { Sheet } from "components/sheet";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";

/** Bottom status bar showing word count, character count, language, zoom */
export function StatusBar() {
  return (
    <Sheet
      variant="outlined"
      sx={{
        display: "flex",
        alignItems: "center",
        px: 3,
        py: "4px",
        gap: 4,
        borderTop: "1px solid",
        borderColor: "divider",
        flexShrink: 0,
        minHeight: "28px",
      }}
    >
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        {sql`cast(word_count as text) || ' words'`}
      </Typography>
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        {sql`cast(char_count as text) || ' characters'`}
      </Typography>
      <div sx={{ flex: 1 }} />
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        English (US)
      </Typography>
      <Typography level="body-xs" sx={{ color: "text.tertiary" }}>
        100%
      </Typography>
    </Sheet>
  );
}
