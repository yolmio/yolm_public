import { Typography } from "components/typography";
import { downcaseFirst } from "std/inflectors";
import type { AnyExpr } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { createStyles } from "std/style_utils";
import { usePhase } from "std/ui";
import type { Node } from "std/ui";
import { Form, useAddRecordToCurrentTable, useCurrentTable } from "std/form";
import type { FormAddRelationButtonProps } from "std/form";
import { Card } from "./card";
import { FieldFormControl } from "./field_form_control";
import { LabelOnLeftFormField } from "./label_on_left_form_field";

const styles = createStyles({
  grid: (_, columns: number) => {
    let templateColumns: Style = {};
    if (columns === 1) {
      templateColumns = {
        gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
      };
    } else if (columns === 2) {
      templateColumns = {
        gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
        lg: {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
      };
    } else if (columns === 3) {
      templateColumns = {
        gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
        lg: {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
        xl: {
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        },
      };
    }
    return {
      display: "grid",
      gap: 4,
      ...templateColumns,
      sm: {
        gap: 6,
      },
    };
  },
  card: {
    gridColumn: "span 1 / span 1",
    p: 4,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    sm: {
      p: 6,
    },
    dark: {
      backgroundColor: "neutral-800",
    },
  },
  cardFooterFields: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  addButtonWrapper: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    py: 8,
  },
  addButton: {
    backgroundColor: "transparent",
    display: "flex",
    alignItems: "center",
    borderColor: "neutral-400",
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: "lg",
    px: 12,
    py: 8,
    cursor: "pointer",
    "&:hover": {
      borderColor: "primary-600",
    },
  },
});

const AddButton = (props: FormAddRelationButtonProps) => {
  if (usePhase() === "gather") {
    return props.children;
  }
  const addRecord = useAddRecordToCurrentTable();
  const table = useCurrentTable();
  if (table.type === "temporary") {
    throw new Error(
      "You cannot use Form.AddCurrentTableButton on a temporary table",
    );
  }
  // deno-lint-ignore no-unused-vars
  const { fields, children, ...rest } = props;
  return (
    <div sx={styles.addButtonWrapper}>
      <button
        {...rest}
        sx={styles.addButton}
        onClick={(s) => {
          addRecord(s, fields ?? {});
        }}
      >
        <Typography level="body-md" startIcon="Add">
          Add another {downcaseFirst(table.table!.displayName)}
        </Typography>
      </button>
    </div>
  );
};

/** Props for {@link FormCards}. */
export interface FormCardsProps {
  sx?: Style;
  className?: string;
  /** Field values to pre-fill when the user adds a new card. */
  addFields?: Record<string, AnyExpr>;
  children: Node;
  /** Number of responsive grid columns. Defaults to 3. */
  columns?: 1 | 2 | 3;
}

/**
Renders a grid of form cards with a button to add new cards.

This component is used in the context of a Form component to display
and manage multiple related records and add data to the current table.

@category UI Component

@param children - The content to be rendered for each card
@param sx
@param addFields - Fields to be pre-filled when adding a new record

@examples
[Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function FormCards({
  children,
  columns,
  sx,
  addFields,
  className,
}: FormCardsProps) {
  if (usePhase() === "gather") {
    return <Form.Each>{children}</Form.Each>;
  }
  return (
    <div
      className={className}
      sx={sx ? [styles.grid(columns ?? 3), sx] : styles.grid(columns ?? 3)}
    >
      <Form.Each>{children}</Form.Each>
      <AddButton fields={addFields} />
    </div>
  );
}

/**
 * A single card in {@link FormCards}, with an optional footer row and a
 * built-in delete-record button.
 */
FormCards.Card = function FormCardsCard({
  children,
  footer,
}: {
  footer?: Node;
  children: Node;
}) {
  if (usePhase() === "gather") {
    return [children, footer];
  }
  return (
    <Card sx={styles.card} variant="outlined">
      {children}
      <div sx={styles.cardFooterFields}>
        {footer}
        <div className="grow" />
        <Form.DeleteRecordIconButton
          icon="Delete"
          variant="plain"
          color="danger"
          size="sm"
          aria-label="Delete this item"
        />
      </div>
    </Card>
  );
};

/** Renders a named field inside a card using a label-on-left layout. */
FormCards.Field = function CardField({ name }: { name: string }) {
  return (
    <Form.Field field={name}>
      <LabelOnLeftFormField />
    </Form.Field>
  );
};

/** Container for content placed in a card's footer row. */
FormCards.Footer = function Footer({ children }: { children: Node }) {
  return <div sx={styles.cardFooterFields}>{children}</div>;
};

/** Renders a named field inside a card's footer row. */
FormCards.FooterField = function FooterField({ name }: { name: string }) {
  return (
    <Form.Field field={name}>
      <FieldFormControl />
    </Form.Field>
  );
};
