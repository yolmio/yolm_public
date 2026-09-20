import { Card, CardHeader } from "components/card";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { CurrentTableICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { useICtx } from "std/ui";
import type { Node } from "std/ui";
import { AddressFieldGroup } from "../../field_groups/address";
import { AddressText } from "./address_text";

/** Props for {@link AddressesCard}. */
export interface Props {
  sx?: Style;
  /** Card title; defaults to the literal "Addresses". */
  header?: Node;
  /**
   * Address groups to render, in order. Each `name` must match an address
   * field group on the current table; `header` is the sub-heading shown above it.
   */
  groups: {
    name: string;
    header: Node;
  }[];
  className?: string;
}

const styles = createStyles({
  groupHeader: {
    my: 2,
    fontSize: "lg",
    fontWeight: "medium",
  },
});

/**
 A card component that displays multiple address field groups with headers.

 @category UI Component
 @param props.sx Additional styles to apply to the card
 @param props.header The header text to display at the top of the card
 @param props.groups Array of address field groups to display, each with a name and header
 @example

 [Example](../../../examples/kitchen_sink/apps/kitchen-sink.yolmstaging.net.tsx)
 */
export function AddressesCard(props: Props) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const groups: {
    header: Node;
    fieldGroup: AddressFieldGroup;
  }[] = [];
  for (const group of props.groups) {
    const fieldGroup = currentTable.fieldGroups[group.name];
    if (!(fieldGroup instanceof AddressFieldGroup)) {
      throw new Error("addressesCard expects groups of type address");
    }
    groups.push({ header: group.header, fieldGroup });
  }
  return (
    ////Example_Card_Start
    <Card variant="outlined" sx={props.sx} className={props.className}>
      <CardHeader className="mb-1">
        <Typography
          level="body-lg"
          startDecorator={<MaterialIcon icon="Business" />}
        >
          {props.header ?? sql.lit`Addresses`}
        </Typography>
      </CardHeader>
      {groups.map(({ header, fieldGroup }) => {
        return (
          <>
            <h6 sx={styles.groupHeader}>{header}</h6>
            <AddressText group={fieldGroup.name} />
          </>
        );
      })}
    </Card>
    ////Example_Card_End
  );
}
