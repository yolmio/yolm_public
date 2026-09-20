import { Button } from "components/button";
import { Divider } from "components/divider";
import { LabelOnLeftFormField } from "components/label_on_left_form_field";
import { ModalDialog } from "components/modal";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import type { TypographyOpts } from "components/typography";
import { getUniqueUiId } from "components/utils";
import { CurrentRefetchICtxKey, DynamicDatagridICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { DomStatementsOrFn, UiServerStatements } from "std/statements";
import type { Style } from "std/style_types";
import { Show, useICtx, useState, wrapCurrentComponent } from "std/ui";
import { Data } from "std/data";
import type { Component, Node } from "std/ui";

import { Form } from "std/form";

export interface DatagridActionDialogProps {
  // Dialog control
  open: Sql;
  onClose: DomStatementsOrFn;
  maxWidth?: "sm" | "md" | "lg";
  sx?: Style;
  // Dialog content
  title?: string | Sql;
  titleProps?: TypographyOpts;
  header?: Node;
  description?: Node;
  // Form configuration
  form?: Node;
  defaultFieldComponent?: Component<any>;
  /** Disables the confirm submit button while true. */
  confirmDisabled?: Sql;
  /** Brief confirmation shown after the form transaction succeeds. */
  successMessage?: string | Sql;
  // Action configuration
  action?: {
    beforeTransactionStart?: (
      s: UiServerStatements,
      tableWithSelectedIds: Sql,
    ) => unknown;
    afterTransactionStart?: (
      s: UiServerStatements,
      tableWithSelectedIds: Sql,
    ) => unknown;

    beforeTransactionCommit?: (
      s: UiServerStatements,
      tableWithSelectedIds: Sql,
    ) => unknown;
    afterTransactionCommit?: (
      s: UiServerStatements,
      tableWithSelectedIds: Sql,
    ) => unknown;
  };
}

// make this return a Sql for the table
function useSelectedIds(s: UiServerStatements): Sql {
  const ct = useICtx(DynamicDatagridICtxKey);
  s.dynamicQuery({
    query: ct.buildIdsQuery(s),
    columnCount: 1,
    resultTable: "selected_ids",
  });
  s.defTable("datagrid_ids", {
    fields: [{ name: "id", type: "BigInt" }],
    allowNoRead: true,
  });
  s.conditional({
    condition: sql`selected_all or not exists (select 1 from selected_row)`,
    then: (s) => {
      s.modify(
        sql`insert into datagrid_ids (id) select field_0::BigInt from selected_ids`,
      );
    },
    else: (s) => {
      s.modify(sql`insert into datagrid_ids (id) select id from selected_row`);
    },
  });
  return sql.ref("datagrid_ids");
}

export function WithTotalCount(props: {
  children: (totalCount: Sql) => Node;
}) {
  const ctx = useICtx(DynamicDatagridICtxKey);
  return (
    <Data
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar("total_count", { type: "BigUint" });
        s.conditional({
          condition:
            sql`selected_all or not exists (select 1 from selected_row)`,
          then: (s) => {
            s.dynamicQuery({
              query: ctx.buildCountQuery(s),
              columnCount: 1,
              resultTable: "total_count_query",
            });
            s.setScalar(
              "total_count",
              sql`(select field_0 from total_count_query)::bigint`,
            );
          },
          else: (s) => {
            s.setScalar(
              "total_count",
              sql`(select count(*) from selected_row)`,
            );
          },
        });
      }}
    >
      {props.children(sql`total_count`)}
    </Data>
  );
}

export function DatagridActionDialog(props: DatagridActionDialogProps) {
  const {
    form,
    open,
    onClose,
    title,
    description,
    action,
    defaultFieldComponent,
    sx,
    maxWidth,
  } = props;
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  const successScalar = props.successMessage === undefined
    ? undefined
    : `datagrid_action_dialog_${getUniqueUiId()}_success`;
  if (successScalar !== undefined && props.successMessage !== undefined) {
    useState((s) => {
      s.defScalar(successScalar, false);
    });
    wrapCurrentComponent((node) => (
      <>
        {node}
        <Show when={sql.ref(successScalar)}>
          <Snackbar
            startIcon="CheckCircle"
            color="success"
            variant="soft"
            onMount={(s) => {
              s.sleep(3500);
              s.setScalar(successScalar, false);
            }}
            anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          >
            {typeof props.successMessage === "string"
              ? sql.lit(props.successMessage)
              : props.successMessage}
          </Snackbar>
        </Show>
      </>
    ));
  }
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="lg"
      maxWidth={maxWidth}
      sx={sx}
    >
      {props.header || (
        <>
          <Typography level="h4" {...props.titleProps}>
            {title}
          </Typography>
          {description && <Typography>{description}</Typography>}
        </>
      )}
      <Divider className="my-2" />
      {/* Form Fields */}
      {form && (
        <Form
          beforeTransactionStart={(s) => {
            s.block((s) => {
              const selectedIds = useSelectedIds(s);
              action?.beforeTransactionStart?.(s, selectedIds);
            });
          }}
          afterTransactionStart={(s) => {
            s.block((s) => {
              const selectedIds = useSelectedIds(s);
              action?.afterTransactionStart?.(s, selectedIds);
            });
          }}
          beforeTransactionCommit={(s) => {
            s.block((s) => {
              const selectedIds = useSelectedIds(s);
              action?.beforeTransactionCommit?.(s, selectedIds);
            });
          }}
          afterTransactionCommit={(s) => {
            s.block((s) => {
              const selectedIds = useSelectedIds(s);
              triggerRefetch(s);
              action?.afterTransactionCommit?.(s, selectedIds);
            });
          }}
          afterSubmitClientSuccess={(s) => {
            if (successScalar !== undefined) {
              s.setScalar(successScalar, true);
            }
            s.statements(onClose);
          }}
          defaultFieldComponent={defaultFieldComponent ?? LabelOnLeftFormField}
        >
          {form}
          <div className="flex justify-end m-2 gap-2">
            <Button
              onClick={(s) => s.statements(onClose)}
              variant="plain"
              color="neutral"
            >
              Cancel
            </Button>
            <Form.SubmitButton disabled={props.confirmDisabled}>
              Confirm
            </Form.SubmitButton>
          </div>
        </Form>
      )}
    </ModalDialog>
  );
}
