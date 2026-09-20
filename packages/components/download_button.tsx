import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import type { Node } from "std/ui";
import { Data } from "std/data";
import { Button } from "./button";
import type { ButtonProps } from "./button";

interface DownloadButtonProps {
  query: Sql;
  fileName: string | Sql;
  children?: Node;
}

/**
 A button component that triggers a download of a CSV file generated from a SQL query.

 @category UI Component

 @param props.query - The SQL query to execute for generating the CSV data.
 @param props.fileName - The name of the file to be downloaded.
 @param props.children - The content of the button. Defaults to "Download".

 */
export function DownloadButton(
  props:
    & DownloadButtonProps
    & Omit<ButtonProps, "children" | "onClick" | "startDecorator">,
) {
  const { query, fileName, children = "Download", ...rest } = props;
  const handleDownload = (s: DomStatements) => {
    const filename = typeof fileName === "string"
      ? sql.lit(fileName)
      : fileName;
    s.returnIf(sql`downloading`);
    s.setScalar("downloading", sql`true`);
    s.commitUiTreeChanges();
    s.downloadQueryCsv(filename, query);
    s.setScalar("downloading", sql`false`);
  };
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("downloading", sql`false`);
      }}
    >
      <Button
        variant="outlined"
        color="primary"
        size="md"
        startIcon="Download"
        onClick={handleDownload}
        loading={sql`downloading`}
        {...rest}
      >
        {children}
      </Button>
    </Data>
  );
}
