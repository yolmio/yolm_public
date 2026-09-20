import { Button } from "components/button";
import { CircularProgress } from "components/circular_progress";
import { Divider } from "components/divider";
import { Drawer } from "components/drawer";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { getUniqueUiId, resolveDialogBinding } from "components/utils";
import type { DialogBinding } from "components/utils";
import { HarmonizeICtxKey, LogoutICtxKey } from "std/ictx";
import { system } from "std/system";
import { Data } from "std/data";
import { omitICtxs, useApp, useOptionalICtx } from "std/ui";
import { sql } from "../std/sql_utils";
import { createStyles, cssVar } from "../std/style_utils";

export interface SettingsDrawerProps extends DialogBinding {}

const styles = createStyles({
  settingsHeader: {
    display: "flex",
    justifyContent: "space-between",
    mb: 3,
  },
  colorModeWrapper: {
    my: 4,
  },
  colorModeSwitcher: {
    display: "flex",
    borderRadius: "md",
    width: "100%",
  },
  colorModeButton: ({ theme }) => {
    return {
      appearance: "none",
      "--icon-margin-top": "initial",
      "--icon-margin-right": "initial",
      "--icon-margin-bottom": "initial",
      "--icon-margin-left": "initial",
      WebkitTapHighlightColor: "transparent",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      fontFamily: cssVar("font-family-body"),
      fontWeight: "medium",
      lineHeight: 1,
      "&:focus-visible": theme.focus.default,
      "--icon-font-size": "1.25rem",
      minHeight: "2rem",
      fontSize: cssVar("text-base"),
      paddingY: 1.5,
      paddingX: 2,
      border: "1px solid",
      borderColor: "divider",
      backgroundColor: "transparent",
      "&:hover": {
        backgroundColor: "neutral-100",
        dark: {
          backgroundColor: "neutral-700",
        },
      },
      "&:first-child": {
        borderTopLeftRadius: cssVar("radius-md"),
        borderBottomLeftRadius: cssVar("radius-md"),
      },
      "&:last-child": {
        borderTopRightRadius: cssVar("radius-md"),
        borderBottomRightRadius: cssVar("radius-md"),
      },
      "&.selected": {
        borderColor: "primary-400",
        color: "primary-400",
        zIndex: 10,
      },
    };
  },
  colorModeIcon: {
    display: "inherit",
    marginRight: 1.5,
  },
});

export function ColorSchemeControl() {
  if (useApp().colorSchemeType !== "cookie") {
    return;
  }
  const colorSchemeRecord = `settings_color_scheme_${getUniqueUiId()}`;
  return (
    <Data
      local
      watch={[sql`color_scheme_refresh_key`]}
      procedure={(s) => {
        s.getCookie(sql.lit`color_scheme`, colorSchemeRecord);
      }}
    >
      <FormControl>
        <FormLabel>Color mode</FormLabel>
        <div sx={styles.colorModeSwitcher}>
          <button
            type="button"
            sx={styles.colorModeButton()}
            dynamicClass={{
              classes: "selected",
              condition: sql`${sql.ref(colorSchemeRecord)}.value = 'light'`,
            }}
            onClick={(s) => {
              s.setCookie(sql.lit`color_scheme`, sql.lit`light`, {
                expires: sql`date.add(year, 1, now())`,
              });
              s.increment("ui.color_scheme_refresh_key");
            }}
          >
            <span sx={styles.colorModeIcon}>
              <MaterialIcon icon="LightMode" />
            </span>
            Light
          </button>
          <button
            type="button"
            sx={styles.colorModeButton()}
            dynamicClass={{
              classes: "selected",
              condition: sql`${
                sql.ref(colorSchemeRecord)
              }.value = 'system' or ${
                sql.ref(colorSchemeRecord)
              }.value is null`,
            }}
            onClick={(s) => {
              s.removeCookie(sql.lit`color_scheme`);
              s.increment("ui.color_scheme_refresh_key");
            }}
          >
            <span sx={styles.colorModeIcon}>
              <MaterialIcon icon="SettingsBrightness" />
            </span>
            System
          </button>
          <button
            type="button"
            sx={styles.colorModeButton()}
            dynamicClass={{
              classes: "selected",
              condition: sql`${sql.ref(colorSchemeRecord)}.value = 'dark'`,
            }}
            onClick={(s) => {
              s.setCookie(sql.lit`color_scheme`, sql.lit`dark`, {
                expires: sql`date.add(year, 1, now())`,
              });
              s.increment("ui.color_scheme_refresh_key");
            }}
          >
            <span sx={styles.colorModeIcon}>
              <MaterialIcon icon="DarkModeOutlined" />
            </span>
            Dark
          </button>
        </div>
      </FormControl>
    </Data>
  );
}

export function DisplayCurrentUser() {
  const table = system.db.tables.sys_users;
  if (!table) {
    return;
  }
  if (table.fields.email) {
    return (
      <Data
        procedure={(s) => {
          s.defScalar(
            "email",
            sql`(select email from db.sys_users where id = current_user)`,
          );
        }}
      >
        <Typography level="body-md">
          Logged in as: <strong>{sql`coalesce(email, 'email')`}</strong>
        </Typography>
      </Data>
    );
  }
  if (table.fields.username) {
    return (
      <Data
        procedure={(s) => {
          s.defScalar(
            "username",
            sql`(select username from db.sys_users where id = current_user)`,
          );
        }}
        pendingFallback={<CircularProgress size="sm" />}
      >
        <Typography level="body-md">
          Logged in as: <strong>{sql`coalesce(username, 'username')`}</strong>
        </Typography>
      </Data>
    );
  }
}

/**
 SettingsDrawer component for displaying a drawer with application settings.

 This component renders a drawer that contains various settings options,
 including color scheme control and user display. It also includes a logout
 button if a logout context is provided.

 @category UI Component

 @param props.open
 @param props.onClose

*/
export function SettingsDrawer(props: SettingsDrawerProps) {
  const { open, onClose } = resolveDialogBinding(props);
  const logout = useOptionalICtx(LogoutICtxKey);
  omitICtxs([HarmonizeICtxKey]);
  return (
    ////Example_Drawer_Start
    <Drawer
      open={open}
      onClose={onClose}
      direction="right"
      className="max-w-[360px]"
    >
      <div className="flex justify-between mb-3">
        <Typography level="h4">Settings</Typography>
        <IconButton
          icon="Close"
          variant="plain"
          size="sm"
          aria-label="Close settings"
          onClick={onClose}
        />
      </div>
      <Divider />
      <ColorSchemeControl />
      <DisplayCurrentUser />
      {logout && (
        <div className="flex justify-end mt-2">
          <Button variant="soft" startIcon="Logout" onClick={logout.logout}>
            Log out
          </Button>
        </div>
      )}
    </Drawer>
    ////Example_Drawer_End
  );
}
