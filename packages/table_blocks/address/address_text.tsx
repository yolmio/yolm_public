import { Button } from "components/button";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { AddressFieldGroup } from "field_groups/address";
import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
} from "std/ictx";
import { sql } from "std/sql_utils";
import { createStyles } from "std/style_utils";
import { Show, useICtx, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import { Form } from "std/form";
import { Data } from "std/data";

const styles = createStyles({
  popover: (app) => {
    return {
      viewTransitionName: "navbar-popover",
      backgroundColor: "background-popup",
      borderRadius: "md",
      boxShadow: "md",
      border: "1px solid",
      borderColor: "divider",
      opacity: 0,
      transform: "scaleY(0)",
      transformOrigin: "top",
      xs: {
        width: "100%",
      },
      md: {
        width: "30%",
      },
      "&:popover-open": {
        opacity: 1,
        transform: "none",
        "@starting-style": {
          "&": {
            opacity: 0,
            transform: "scaleY(0)",
          },
        },
      },
      margin: 0,
      padding: 4,
      transition:
        `opacity ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, transform ${app.theme.transitionDurations.popover} ${app.theme.transitionEasing.popover}, display ${app.theme.transitionDurations.popover} allow-discrete`,
    };
  },
  addressName: {
    fontWeight: "semibold",
  },
  addressLine: {
    color: "text-secondary",
  },
});

/** Props for {@link AddressText}. */
export interface AddressTextProps {
  /** Address field-group name on the current table. Defaults to `"address"`. */
  group?: string;
  /** Typography scale for the rendered address lines. Defaults to `"md"`. */
  size?: "sm" | "md" | "lg";
  /** Placement of the inline edit popover relative to the address. Defaults to `"left-start"`. */
  placement?:
    | "top"
    | "top-start"
    | "top-end"
    | "right"
    | "right-start"
    | "right-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end"
    | "left"
    | "left-start"
    | "left-end";
}

/**
 Conditionally displays an address.
If every address field is null, it displays "No address".
Otherwise, it displays the address fields.
Clicking the address opens an inline popover with a {@link Form} for editing
the group's fields, refetching the surrounding {@link Data} on save.
Expects to have a Read context on a record of a table with an address field group.
Usually used as part of an {@link AddressCard}.

 @category UI Component
  */
export function AddressText(props: AddressTextProps) {
  const size = props.size ?? "md";
  const typographySize = size === "sm"
    ? "body-sm"
    : size === "md"
    ? "body-md"
    : "body-lg";
  const table = useICtx(CurrentTableICtxKey).currentTable;
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const group = table.fieldGroups[props.group ?? "address"];
  if (!(group instanceof AddressFieldGroup)) {
    throw new Error(
      `addressText expects a field group of type address for table '${table.name}'`,
    );
  }
  const fields = Object.values(group.fields).filter(Boolean) as string[];
  const selectFields = fields.map((f) => sql`${table.fields[f].ident}`);
  const id = useUniqueId();

  function EditAddressWrapper(props: { children: Node }) {
    return (
      <div
        sx={{
          px: 2,
          py: 1,
          borderRadius: "md",
          cursor: "pointer",
          position: "relative",
          "&:hover": {
            backgroundColor: "background-level1",
          },
          "&:focus-within": {
            outline: "1px solid",
            outlineColor: "primary-500",
          },
        }}
        onClick={(s) => {
          s.setScalar("editing", true);
        }}
        tabIndex={0}
        onKeyDown={(s) => {
          s.if(sql`event.key = 'Enter'`, (s) => {
            s.setScalar("editing", true);
          });
        }}
        id={id}
      >
        {props.children}
        <div
          sx={{
            position: "absolute",
            right: 4,
            top: 0,
            height: "100%",
            display: "flex",
            alignItems: "center",
          }}
        >
          <MaterialIcon
            icon="Edit"
            fontSize="base"
            sx={{
              display: "none",
              ":hover > div > &": {
                display: "block",
              },
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("editing", false);
      }}
    >
      <Data
        procedure={(s) => {
          s.defRecord(
            "addr_rec",
            sql`select ${
              sql(selectFields.map((f) => f.toSQL()).join(", "))
            } from ${table.identWithDb} where ${table.primaryKeyIdent} = ${currentRecordId}`,
          );
        }}
      >
        {(() => {
          const getField = (fieldName: string) =>
            sql`addr_rec.${table.fields[fieldName].ident}`;
          const allIsNull = sql.and(
            ...fields.map((field) => sql`${getField(field)} is null`),
          );
          return (
            <>
              <Show
                when={sql.not(allIsNull)}
                fallback={
                  <EditAddressWrapper>
                    <Typography level="body-md" sx={styles.addressLine}>
                      No address
                    </Typography>
                  </EditAddressWrapper>
                }
              >
                <EditAddressWrapper>
                  {group.fields.name
                    ? (
                      <Typography
                        level={typographySize}
                        sx={styles.addressName}
                      >
                        {getField(group.fields.name!)}
                      </Typography>
                    )
                    : undefined}
                  <Typography level={typographySize} sx={styles.addressLine}>
                    {getField(group.fields.street1)}
                  </Typography>
                  {group.fields.street2
                    ? (
                      <Typography
                        level={typographySize}
                        sx={styles.addressLine}
                      >
                        {getField(group.fields.street2!)}
                      </Typography>
                    )
                    : undefined}
                  <Typography level={typographySize} sx={styles.addressLine}>
                    {sql`coalesce(${
                      getField(group.fields.city!)
                    } || ' ', '') || coalesce(${
                      getField(group.fields.region!)
                    } || ' ', '') || coalesce(${
                      getField(group.fields.country!)
                    } || ' ', '') || ' ' || coalesce(${
                      getField(group.fields.zip!)
                    }, '')`}
                  </Typography>
                </EditAddressWrapper>
              </Show>
              <Show when={sql`editing`}>
                <div
                  sx={styles.popover()}
                  tabIndex={-1}
                  popover="auto"
                  yolmPopoverShowing={sql`editing`}
                  classes="skip-harmonize"
                  id={sql.concat("views-popover")}
                  floating={{
                    anchorEl: id,
                    placement: props.placement ?? "left-start",
                    strategy: "fixed",
                    shift: { mainAxis: true, crossAxis: true },
                    offset: {
                      mainAxis: 4,
                      crossAxis: 0,
                    },
                    flip: { crossAxis: false, mainAxis: false },
                  }}
                  onClickAway={(s) => {
                    s.setScalar("editing", false);
                  }}
                >
                  <div className="flex flex-col gap-4">
                    <Form
                      defaultFieldComponent={LabelOnLeftFormField}
                      afterTransactionCommit={(s) => {
                        triggerRefetch(s);
                        s.setScalar("editing", false);
                      }}
                    >
                      <Form.Update
                        table={table.name}
                        where={sql`id = ${currentRecordId}`}
                      >
                        {group.fields.name
                          ? <Form.Field field={group.fields.name} />
                          : undefined}
                        <Form.Field field={group.fields.street1} />
                        {group.fields.street2
                          ? <Form.Field field={group.fields.street2} />
                          : undefined}
                        {group.fields.city
                          ? <Form.Field field={group.fields.city} />
                          : undefined}
                        {group.fields.region
                          ? <Form.Field field={group.fields.region} />
                          : undefined}
                        {group.fields.country
                          ? <Form.Field field={group.fields.country} />
                          : undefined}
                        {group.fields.zip
                          ? <Form.Field field={group.fields.zip} />
                          : undefined}
                      </Form.Update>
                      <Form.ErrorAlert />
                      <div className="flex justify-end gap-3">
                        <Button
                          variant="plain"
                          color="neutral"
                          onClick={(s) => {
                            s.setScalar("editing", false);
                          }}
                        >
                          Cancel
                        </Button>
                        <Form.SubmitButton>Save</Form.SubmitButton>
                      </div>
                    </Form>
                  </div>
                </div>
              </Show>
            </>
          );
        })()}
      </Data>
    </Data>
  );
}
