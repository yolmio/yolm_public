import { sql } from "../std/sql_utils";
import type { BooleanExpr } from "../std/sql_utils";
import type {
  DomStatements,
  DomStatementsOrFn,
  UiServerStatements,
} from "std/statements";
import { createStyles, flexGrowStyles } from "std/style_utils";
import { Show, useUniqueId } from "std/ui";
import { Data } from "std/data";
import type { Node } from "std/ui";
import { Alert } from "./alert";
import { Button } from "./button";
import { Divider } from "./divider";
import { ModalDialog } from "./modal";
import { Typography } from "./typography";
import { resolveDialogBinding } from "./utils";
import type { DialogBinding } from "./utils";
import { ActionButton } from "std/action_button";

interface ConfirmDangerDialogProps extends DialogBinding {
  onConfirm?: (s: DomStatements, close: DomStatementsOrFn) => unknown;
  action?: (s: UiServerStatements) => void;
  beforeActionClient?: (s: DomStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
  refetch?: boolean;
  description?: Node;
  confirmButtonText?: Node;
  disableConfirmButton?: BooleanExpr;
}

const styles = createStyles({
  title: {
    fontSize: "1.25em",
    mb: "0.25em",
  },
  description: {
    color: "text-tertiary",
    mb: 6,
  },
  divider: { my: 4 },
  footer: {
    display: "flex",
    gap: 2,
  },
});

/**
 A dialog component for confirming dangerous actions.

 @category Dialog Component

 @param {ConfirmDangerDialogProps} props - The options for the ConfirmDangerDialog.
 @param {boolean} props.open - Whether the dialog is open.
 @param {Function} props.onClose - Function to call when the dialog should close.
 @param {Function} props.onConfirm - Function to call when the user confirms the action.
 @param {Node} [props.description] - Custom description text for the dialog.
 @param {Node} [props.confirmButtonText] - Custom text for the confirm button.

 */
export function ConfirmDangerDialog(props: ConfirmDangerDialogProps) {
  const titleId = useUniqueId();
  const descriptionId = useUniqueId();
  const { disableConfirmButton } = props;
  const { open, onClose } = resolveDialogBinding(props);
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      layout="center"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="p-5"
    >
      <Typography
        component="h2"
        level="inherit"
        startIcon="WarningRounded"
        id={titleId}
      >
        Confirmation
      </Typography>
      <Typography component="div" id={descriptionId}>
        {props.description ?? sql.lit`Are you sure about that?`}
      </Typography>
      <Divider sx={styles.divider} />
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("dialog_waiting", false);
          s.defScalar("dialog_error", {
            type: { type: "String", maxLength: 2000 },
            expr: sql.null,
            allowNoRead: true,
          });
        }}
      >
        <div sx={styles.footer}>
          <Show when={sql`dialog_error is not null`}>
            <Alert
              color="danger"
              startIcon="ErrorRounded"
            >
              {sql`dialog_error`}
            </Alert>
          </Show>
          <div sx={flexGrowStyles} />
          <Button
            variant="plain"
            color="neutral"
            onClick={(s) => s.statements(onClose)}
          >
            Cancel
          </Button>
          {props.action
            ? (
              <ActionButton
                variant="solid"
                color="danger"
                disabled={disableConfirmButton ?? false}
                action={props.action}
                beforeActionClient={(s) => {
                  s.setScalar("dialog_error", sql.null);
                  props.beforeActionClient?.(s);
                }}
                refetch={props.refetch}
                errorDisplay="none"
                onError={(s) => {
                  s.setScalar("dialog_error", sql`error.message`);
                  props.onError?.(s);
                }}
                afterSuccessClient={(s) => {
                  s.statements(onClose);
                  props.afterSuccessClient?.(s);
                }}
              >
                {props.confirmButtonText ?? sql.lit`Confirm`}
              </ActionButton>
            )
            : (
              <Button
                variant="solid"
                color="danger"
                disabled={disableConfirmButton ?? false}
                loading={sql`dialog_waiting`}
                onClick={{
                  detachedFromNode: true,
                  procedure: (s) => {
                    s.returnIf(sql`dialog_waiting`);
                    props.onConfirm?.(s, onClose);
                  },
                }}
              >
                {props.confirmButtonText ?? sql.lit`Confirm`}
              </Button>
            )}
        </div>
      </Data>
    </ModalDialog>
  );
}

ConfirmDangerDialog.getSource = () => "ConfirmDangerDialog";
