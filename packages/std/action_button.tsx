import { CurrentRefetchICtxKey } from "std/ictx";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Data } from "std/data";
import type {
  DomStatements,
  StateStatementsOrFn,
  UiServerStatements,
} from "std/statements";
import { Show, useOptionalICtx, useState, wrapCurrentComponent } from "std/ui";
import type { Node } from "std/ui";
import { Alert } from "components/alert";
import { Button } from "components/button";
import type { ButtonProps } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { Divider } from "components/divider";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { IconButton } from "components/icon_button";
import type { IconButtonProps } from "components/icon_button";
import { Menu } from "components/menu";
import { ModalDialog } from "components/modal";
import { Snackbar } from "components/snackbar";
import { Typography } from "components/typography";
import { flexGrowStyles, visuallyHiddenStyles } from "std/style_utils";
import { getUniqueUiId } from "components/utils";

export interface ActionButtonConfirm {
  description?: Node;
  confirmText?: Node;
  /** Load the facts being confirmed. Description and action share this scope.
   * Confirmation stays disabled until loading succeeds, including after errors.
   */
  prepare?: StateStatementsOrFn;
  disabled?: Sql;
}

export interface ActionButtonProps
  extends Omit<ButtonProps, "onClick" | "loading"> {
  action: (s: UiServerStatements) => void;
  successMessage?: string | Sql;
  errorDisplay?: "snackbar" | "inline" | "none";
  refetch?: boolean;
  preventDefault?: boolean;
  confirm?: ActionButtonConfirm;
  beforeActionClient?: (s: DomStatements) => void;
  onSuccess?: (s: UiServerStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
}

function successNode(successMessage: string | Sql, successScalar: string) {
  return (
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
        {typeof successMessage === "string"
          ? sql.lit(successMessage)
          : successMessage}
      </Snackbar>
    </Show>
  );
}

function errorSnackbarNode(errorScalar: string) {
  return (
    <Show when={sql.isNotNull(sql.ref(errorScalar))}>
      <Snackbar
        startIcon="Error"
        color="danger"
        variant="soft"
        onMount={(s) => {
          s.sleep(5000);
          s.setScalar(errorScalar, sql.null);
        }}
        anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
      >
        {sql.ref(errorScalar)}
      </Snackbar>
    </Show>
  );
}

function confirmModalNode(opts: {
  confirm: ActionButtonConfirm;
  openScalar: string;
  waitingScalar: string;
  errorScalar: string;
  successScalar: string | undefined;
  action: (s: UiServerStatements) => void;
  beforeActionClient?: (s: DomStatements) => void;
  onSuccess: ((s: UiServerStatements) => void) | undefined;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
  afterCloseClient?: (s: DomStatements) => void;
  refetch: boolean;
}) {
  const {
    confirm,
    openScalar,
    waitingScalar,
    errorScalar,
    successScalar,
    action,
    beforeActionClient,
    onSuccess,
    afterSuccessClient,
    onError,
    afterCloseClient,
    refetch,
  } = opts;
  const close = (s: DomStatements) => {
    s.setScalar(openScalar, false);
    afterCloseClient?.(s);
  };
  const controls = (ready: boolean) => (
    <div sx={{ display: "flex", gap: 2 }}>
      <div sx={flexGrowStyles} />
      <Button variant="plain" color="neutral" onClick={close}>Cancel</Button>
      <Button
        variant="solid"
        color="danger"
        disabled={ready ? confirm.disabled : true}
        loading={sql.ref(waitingScalar)}
        onClick={ready
          ? {
            detachedFromNode: true,
            procedure: (s: DomStatements) => {
              if (confirm.disabled) s.returnIf(confirm.disabled);
              s.statements(runWithTryServer({
                action,
                beforeActionClient,
                onSuccess,
                afterSuccessClient,
                onError: (s) => {
                  onError?.(s);
                  if (confirm.prepare) s.increment("confirmation_refresh");
                },
                refetch,
                waitingScalar,
                errorScalar,
                successScalar,
              }));
              s.if(sql.isNull(sql.ref(errorScalar)), close);
            },
          }
          : undefined}
      >
        {ready ? confirm.confirmText ?? sql.lit`Confirm` : sql.lit`Confirm`}
      </Button>
    </div>
  );
  const body = (
    <>
      <Typography component="div">
        {confirm.description ?? sql.lit`Are you sure you about that?`}
      </Typography>
      <Divider sx={{ my: 4 }} />
      {controls(true)}
    </>
  );
  return (
    <ModalDialog
      open={sql.ref(openScalar)}
      onClose={close}
      layout="center"
      role="alertdialog"
      className="p-5"
    >
      <Typography component="h2" level="inherit" startIcon="WarningRounded">
        Confirmation
      </Typography>
      <Show when={sql.isNotNull(sql.ref(errorScalar))}>
        <Alert color="danger" startIcon="ErrorRounded">
          {sql.ref(errorScalar)}
        </Alert>
      </Show>
      {confirm.prepare
        ? (
          <Show when={sql.ref(openScalar)}>
            <Data
              local
              noRefetch
              procedure={(s) => s.defScalar("confirmation_refresh", 0)}
            >
              <Data
                noRefetch
                autoWatch={false}
                watch={[sql`confirmation_refresh`]}
                procedure={confirm.prepare}
                statusScalar="confirmation_load_status"
                hasDataScalar="confirmation_has_data"
                pendingFallback={null}
                errorFallback={null}
              >
                <Show
                  when={sql`confirmation_has_data and confirmation_load_status = 'received'`}
                  fallback={
                    <>
                      <Show
                        when={sql`confirmation_load_status = 'failed'`}
                        fallback={
                          <p className="my-4 flex items-center gap-2">
                            <CircularProgress size="sm" />Loading confirmation…
                          </p>
                        }
                      >
                        <Alert color="danger">
                          Unable to load confirmation details.
                        </Alert>
                        <Button
                          variant="plain"
                          onClick={(s) => s.increment("confirmation_refresh")}
                        >
                          Retry
                        </Button>
                      </Show>
                      <Divider sx={{ my: 4 }} />
                      {controls(false)}
                    </>
                  }
                >
                  {body}
                </Show>
              </Data>
            </Data>
          </Show>
        )
        : body}
    </ModalDialog>
  );
}

function errorInlineNode(errorScalar: string) {
  return (
    <Show when={sql.isNotNull(sql.ref(errorScalar))}>
      <Alert color="danger" startIcon="Error">
        {sql.ref(errorScalar)}
      </Alert>
    </Show>
  );
}

function runWithTryServer(opts: {
  action: (s: UiServerStatements) => void;
  beforeActionClient?: (s: DomStatements) => void;
  onSuccess?: (s: UiServerStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  refetch: boolean;
  waitingScalar: string;
  errorScalar: string;
  successScalar: string | undefined;
  transferFiles?: Sql;
  onError?: (s: DomStatements) => void;
}) {
  return (s: DomStatements) => {
    s.returnIf(sql.ref(opts.waitingScalar));
    opts.beforeActionClient?.(s);
    s.setScalar(opts.waitingScalar, true);
    s.setScalar(opts.errorScalar, sql.null);
    if (opts.successScalar) s.setScalar(opts.successScalar, false);
    s.commitUiTreeChanges();
    s.tryServer({
      transferFiles: opts.transferFiles,
      body: (s) => {
        opts.action(s);
        if (opts.onSuccess) opts.onSuccess(s);
        if (opts.refetch) {
          useOptionalICtx(CurrentRefetchICtxKey)?.triggerRefetch(s);
        }
        if (opts.successScalar) s.setScalar(opts.successScalar, true);
      },
      errorName: "error",
      catch: (s) => {
        s.debugExpr(sql`error.type`);
        s.debugExpr(sql`error.message`);
        s.debugExpr(sql`error.description`);
        // Errors a procedure throws on purpose are written for people.
        s.setScalar(
          opts.errorScalar,
          sql`case when error.type = 'thrown_error' and nullif(error.message, '') is not null
            then error.message
            else ${
            sql.concat(sql`error.type`, ": ", sql`coalesce(error.message, '')`)
          } end`,
        );
        opts.onError?.(s);
      },
    });
    if (opts.afterSuccessClient) {
      s.if(sql.isNull(sql.ref(opts.errorScalar)), opts.afterSuccessClient);
    }
    s.setScalar(opts.waitingScalar, false);
  };
}

export interface FileAction {
  uuid: Sql;
  name: Sql;
  type: Sql;
  lastModified: Sql;
  size: Sql;
}

export interface FileActionButtonProps
  extends Omit<ButtonProps, "component" | "loading" | "onClick"> {
  action: (s: UiServerStatements, file: FileAction) => void;
  inputProps?: Omit<
    JSX.IntrinsicElements["input"],
    "children" | "onFileChange" | "sx" | "type"
  >;
  successMessage?: string | Sql;
  errorDisplay?: "snackbar" | "inline" | "none";
  refetch?: boolean;
  beforeActionClient?: (s: DomStatements) => void;
  onSuccess?: (s: UiServerStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
}

/**
 * File-input variant of ActionButton. Files are transferred to the server and
 * the same guarded loading, error, refetch, and success-only lifecycle is used.
 *
 * @category UI Component
 */
export function FileActionButton(props: FileActionButtonProps) {
  const {
    action,
    inputProps,
    successMessage,
    errorDisplay = "snackbar",
    refetch = true,
    beforeActionClient,
    onSuccess,
    afterSuccessClient,
    onError,
    ...buttonProps
  } = props;

  const waitingScalar = "file_action_waiting";
  const errorScalar = "file_action_error";
  const successScalar = "file_action_success";

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(waitingScalar, false);
        s.defScalar(errorScalar, { expr: sql.null, type: "String" });
        s.defScalar(successScalar, false);
      }}
    >
      <Button
        {...buttonProps}
        component="label"
        loading={sql.ref(waitingScalar)}
      >
        <input
          {...inputProps}
          type="file"
          sx={visuallyHiddenStyles}
          onFileChange={(s) => {
            s.defRecord("action_file", sql`select * from file limit 1`);
            s.statements(
              runWithTryServer({
                beforeActionClient,
                action: (s) =>
                  action(s, {
                    uuid: sql`action_file.uuid`,
                    name: sql`action_file.name`,
                    type: sql`action_file.type`,
                    lastModified: sql`action_file.last_modified`,
                    size: sql`action_file.size`,
                  }),
                onSuccess,
                afterSuccessClient,
                refetch,
                waitingScalar,
                errorScalar,
                successScalar: successMessage !== undefined
                  ? successScalar
                  : undefined,
                transferFiles: sql`select uuid from file`,
                onError,
              }),
            );
          }}
        />
        {props.children}
      </Button>
      {successMessage !== undefined &&
        successNode(successMessage, successScalar)}
      {errorDisplay === "snackbar" && errorSnackbarNode(errorScalar)}
      {errorDisplay === "inline" && errorInlineNode(errorScalar)}
    </Data>
  );
}

export interface FileActionIconButtonProps
  extends Omit<IconButtonProps, "component" | "onClick" | "children" | "icon"> {
  icon: IconName;
  action: (s: UiServerStatements, file: FileAction) => void;
  inputProps?: Omit<
    JSX.IntrinsicElements["input"],
    "children" | "onFileChange" | "sx" | "type"
  >;
  successMessage?: string | Sql;
  errorDisplay?: "snackbar" | "inline" | "none";
  refetch?: boolean;
  beforeActionClient?: (s: DomStatements) => void;
  onSuccess?: (s: UiServerStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
}

/**
 * Icon-button variant of FileActionButton.
 *
 * @category UI Component
 */
export function FileActionIconButton(props: FileActionIconButtonProps) {
  const {
    action,
    icon,
    inputProps,
    successMessage,
    errorDisplay = "snackbar",
    refetch = true,
    beforeActionClient,
    onSuccess,
    afterSuccessClient,
    onError,
    ...buttonProps
  } = props;

  const waitingScalar = "file_action_icon_waiting";
  const errorScalar = "file_action_icon_error";
  const successScalar = "file_action_icon_success";

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(waitingScalar, false);
        s.defScalar(errorScalar, { expr: sql.null, type: "String" });
        s.defScalar(successScalar, false);
      }}
    >
      <IconButton {...buttonProps} component="label">
        <input
          {...inputProps}
          type="file"
          sx={visuallyHiddenStyles}
          onFileChange={(s) => {
            s.defRecord("action_file", sql`select * from file limit 1`);
            s.statements(
              runWithTryServer({
                beforeActionClient,
                action: (s) =>
                  action(s, {
                    uuid: sql`action_file.uuid`,
                    name: sql`action_file.name`,
                    type: sql`action_file.type`,
                    lastModified: sql`action_file.last_modified`,
                    size: sql`action_file.size`,
                  }),
                onSuccess,
                afterSuccessClient,
                refetch,
                waitingScalar,
                errorScalar,
                successScalar: successMessage !== undefined
                  ? successScalar
                  : undefined,
                transferFiles: sql`select uuid from file`,
                onError,
              }),
            );
          }}
        />
        <Show when={sql.ref(waitingScalar)}>
          <CircularProgress size="sm" />
        </Show>
        <Show when={sql.not(sql.ref(waitingScalar))}>
          <MaterialIcon icon={icon} />
        </Show>
      </IconButton>
      {successMessage !== undefined &&
        successNode(successMessage, successScalar)}
      {errorDisplay === "snackbar" && errorSnackbarNode(errorScalar)}
      {errorDisplay === "inline" && errorInlineNode(errorScalar)}
    </Data>
  );
}

/**
 * Button that runs a server action with loading, error, and optional success
 * handling. Double-click protected; refetches the enclosing Data on success by
 * default; calls event.preventDefault() on click by default. Pass `confirm`
 * to gate the action on a confirmation dialog.
 *
 * @category UI Component
 */
export function ActionButton(props: ActionButtonProps) {
  const {
    action,
    successMessage,
    errorDisplay = "snackbar",
    refetch = true,
    preventDefault = true,
    confirm,
    onSuccess,
    afterSuccessClient,
    beforeActionClient,
    onError,
    ...buttonProps
  } = props;

  const waitingScalar = "action_waiting";
  const errorScalar = "action_error";
  const successScalar = "action_success";

  if (confirm) {
    return (
      <Data
        local
        noRefetch
        procedure={(s) => {
          s.defScalar("confirm_open", false);
          s.defScalar(waitingScalar, false);
          s.defScalar(errorScalar, { expr: sql.null, type: "String" });
          s.defScalar(successScalar, false);
          s.defScalar("action_redirect_url", {
            expr: sql.null,
            type: "String",
          });
        }}
      >
        <Button
          {...buttonProps}
          onClick={(s) => {
            if (preventDefault) s.event.preventDefault();
            s.setScalar("confirm_open", true);
          }}
        >
          {props.children}
        </Button>
        {confirmModalNode({
          confirm,
          openScalar: "confirm_open",
          waitingScalar,
          errorScalar,
          successScalar: successMessage !== undefined
            ? successScalar
            : undefined,
          action,
          beforeActionClient,
          onSuccess,
          afterSuccessClient,
          onError,
          refetch,
        })}
        {successMessage !== undefined &&
          successNode(successMessage, successScalar)}
      </Data>
    );
  }

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(waitingScalar, false);
        s.defScalar(errorScalar, { expr: sql.null, type: "String" });
        s.defScalar(successScalar, false);
        s.defScalar("action_redirect_url", { expr: sql.null, type: "String" });
      }}
    >
      <Button
        {...buttonProps}
        loading={sql.ref(waitingScalar)}
        onClick={(s) => {
          if (preventDefault) s.event.preventDefault();
          s.statements(
            runWithTryServer({
              beforeActionClient,
              action,
              onSuccess,
              afterSuccessClient,
              onError,
              refetch,
              waitingScalar,
              errorScalar,
              successScalar: successMessage !== undefined
                ? successScalar
                : undefined,
            }),
          );
        }}
      >
        {props.children}
      </Button>
      {successMessage !== undefined &&
        successNode(successMessage, successScalar)}
      {errorDisplay === "snackbar" && errorSnackbarNode(errorScalar)}
      {errorDisplay === "inline" && errorInlineNode(errorScalar)}
    </Data>
  );
}

export interface ActionIconButtonProps
  extends Omit<IconButtonProps, "onClick" | "children" | "icon"> {
  icon: IconName;
  action: (s: UiServerStatements) => void;
  successMessage?: string | Sql;
  errorDisplay?: "snackbar" | "inline" | "none";
  refetch?: boolean;
  preventDefault?: boolean;
  confirm?: ActionButtonConfirm;
  beforeActionClient?: (s: DomStatements) => void;
  onSuccess?: (s: UiServerStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
}

/**
 * Icon-button variant of ActionButton with the same guarded loading, error,
 * confirmation, refetch, and success-only lifecycle.
 *
 * @category UI Component
 */
export function ActionIconButton(props: ActionIconButtonProps) {
  const {
    action,
    icon,
    successMessage,
    errorDisplay = "snackbar",
    refetch = true,
    preventDefault = true,
    confirm,
    beforeActionClient,
    onSuccess,
    afterSuccessClient,
    onError,
    ...buttonProps
  } = props;

  const waitingScalar = "action_icon_waiting";
  const errorScalar = "action_icon_error";
  const successScalar = "action_icon_success";

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar(waitingScalar, false);
        s.defScalar(errorScalar, { expr: sql.null, type: "String" });
        s.defScalar(successScalar, false);
        if (confirm) s.defScalar("confirm_open", false);
      }}
    >
      <IconButton
        {...buttonProps}
        onClick={(s) => {
          if (preventDefault) s.event.preventDefault();
          if (confirm) {
            s.setScalar("confirm_open", true);
            return;
          }
          s.statements(
            runWithTryServer({
              beforeActionClient,
              action,
              onSuccess,
              afterSuccessClient,
              onError,
              refetch,
              waitingScalar,
              errorScalar,
              successScalar: successMessage !== undefined
                ? successScalar
                : undefined,
            }),
          );
        }}
      >
        <Show when={sql.ref(waitingScalar)}>
          <CircularProgress size="sm" />
        </Show>
        <Show when={sql.not(sql.ref(waitingScalar))}>
          <MaterialIcon icon={icon!} />
        </Show>
      </IconButton>
      {confirm && confirmModalNode({
        confirm,
        openScalar: "confirm_open",
        waitingScalar,
        errorScalar,
        successScalar: successMessage !== undefined ? successScalar : undefined,
        action,
        beforeActionClient,
        onSuccess,
        afterSuccessClient,
        onError,
        refetch,
      })}
      {successMessage !== undefined &&
        successNode(successMessage, successScalar)}
      {errorDisplay === "snackbar" && errorSnackbarNode(errorScalar)}
      {errorDisplay === "inline" && errorInlineNode(errorScalar)}
    </Data>
  );
}

export interface ActionMenuItemProps {
  action: (s: UiServerStatements) => void;
  children: Node;
  icon?: IconName;
  successMessage?: string | Sql;
  errorDisplay?: "snackbar" | "none";
  refetch?: boolean;
  confirm?: ActionButtonConfirm;
  onSuccess?: (s: UiServerStatements) => void;
  afterSuccessClient?: (s: DomStatements) => void;
  onError?: (s: DomStatements) => void;
}

/**
 * Menu item variant of ActionButton. Confirmed actions keep the surrounding
 * menu mounted until their dialog closes.
 *
 * @category UI Component
 */
export function ActionMenuItem(props: ActionMenuItemProps) {
  const {
    action,
    icon,
    successMessage,
    errorDisplay = "snackbar",
    refetch = true,
    confirm,
    onSuccess,
    afterSuccessClient,
    onError,
  } = props;

  const id = getUniqueUiId();
  const waitingScalar = `action_menu_${id}_waiting`;
  const errorScalar = `action_menu_${id}_error`;
  const successScalar = `action_menu_${id}_success`;
  const confirmOpenScalar = `action_menu_${id}_confirm_open`;

  useState((s) => {
    s.defScalar(waitingScalar, false);
    s.defScalar(errorScalar, { expr: sql.null, type: "String" });
    s.defScalar(successScalar, false);
    if (confirm) s.defScalar(confirmOpenScalar, false);
  });

  wrapCurrentComponent((node) => (
    <>
      {node}
      {successMessage !== undefined &&
        successNode(successMessage, successScalar)}
      {errorDisplay === "snackbar" && errorSnackbarNode(errorScalar)}
      {confirm && confirmModalNode({
        confirm,
        openScalar: confirmOpenScalar,
        waitingScalar,
        errorScalar,
        successScalar: successMessage !== undefined ? successScalar : undefined,
        action,
        onSuccess,
        afterSuccessClient,
        onError,
        afterCloseClient: (s) => {
          s.setScalar("ui.showing_list", false);
        },
        refetch,
      })}
    </>
  ));

  return (
    <Menu.Item
      closeOnClick={!confirm}
      onClick={(s) => {
        if (confirm) {
          s.setScalar(confirmOpenScalar, true);
          return;
        }
        s.statements(
          runWithTryServer({
            action,
            onSuccess,
            afterSuccessClient,
            onError,
            refetch,
            waitingScalar,
            errorScalar,
            successScalar: successMessage !== undefined
              ? successScalar
              : undefined,
          }),
        );
      }}
    >
      {icon && (
        <>
          <Show when={sql.ref(waitingScalar)}>
            <CircularProgress size="sm" />
          </Show>
          <Show when={sql.not(sql.ref(waitingScalar))}>
            <MaterialIcon icon={icon} />
          </Show>
        </>
      )}
      {props.children}
    </Menu.Item>
  );
}
