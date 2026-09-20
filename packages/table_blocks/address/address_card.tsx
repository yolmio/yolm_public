import { Card, CardHeader } from "components/card";
import { Typography } from "components/typography";
import { sql } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import { useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import { AddressText } from "./address_text";

/** Props for {@link AddressCard}. */
export interface Props {
  sx?: Style;
  className?: string;
  /** Header content; defaults to the literal "Address". */
  header?: Node;
  /** Address field-group name on the current table. Defaults to `"address"`. */
  group?: string;
}

/**
 Displays an address inside an outlined card, rendering the body via
 {@link AddressText}. Expects a Read context on a record whose table carries
 an address field group; enable {@link AddressTableBlock} for that table first.

 @category UI Component
 @example
[Example](../../../examples/legal/apps/legal.yolmstaging.net.tsx)
 */
export function AddressCard(props: Props) {
  useSourceMap("address_card");
  return (
    <Card variant="outlined" sx={props.sx} className={props.className}>
      <CardHeader className="mb-3">
        <Typography level="body-lg" startIcon="Business">
          {props.header ?? sql.lit`Address`}
        </Typography>
      </CardHeader>
      <AddressText group={props.group} />
    </Card>
  );
}
