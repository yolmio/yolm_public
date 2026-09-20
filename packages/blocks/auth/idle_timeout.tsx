import { useJsModule } from "std/js_modules";
import { LogoutICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { Data } from "std/data";
import { EventHandlers, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { Button } from "components/button";
import { MaterialIcon } from "components/material_icon";

export interface IdleTimeoutConfig {
  idleMinutes?: number;
  warningSeconds?: number;
}

export function IdleTimeout(props: {
  config: IdleTimeoutConfig;
  cookieName: Sql;
  children: Node;
}) {
  const idleMinutes = props.config.idleMinutes ?? 15;
  const warningSeconds = props.config.warningSeconds ?? 60;
  const idleThresholdSeconds = idleMinutes * 60 - warningSeconds;
  const logout = useOptionalICtx(LogoutICtxKey);

  useJsModule("timer_module");

  function resetActivity(s: import("std/statements").DomStatements) {
    s.returnIf(sql`logged_out`);
    s.setScalar("idle_ticks", sql`0`);
    s.if(sql`show_warning`, (s) => {
      s.setScalar("show_warning", false);
      s.setScalar("countdown_seconds", sql`${warningSeconds}`);
    });
  }

  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("idle_timer_handle", sql.lit``);
        s.defScalar("idle_ticks", sql`0`);
        s.defScalar("show_warning", false);
        s.defScalar("logged_out", false);
        s.defScalar("countdown_seconds", sql`${warningSeconds}`);
      }}
    >
      <EventHandlers
        document={{
          mouseMove: resetActivity,
          mouseDown: resetActivity,
          keydown: resetActivity,
          click: resetActivity,
          scroll: resetActivity,
        }}
      />
      <div
        onMount={(s) => {
          s.setScalar("idle_timer_handle", sql`cast(random.uuid() as string)`);
          s.jsCall({
            module: "timer_module",
            exportName: "startTimer",
            handle: sql`idle_timer_handle`,
            argJson: sql`json_build_object()`,
          });
        }}
        js={{
          handles: [{
            module: "timer_module",
            cleanup: "stopTimer",
            handle: sql`idle_timer_handle`,
          }],
          on: {
            "timer_module.tick": (s) => {
              s.returnIf(sql`logged_out`);
              s.conditional({
                condition: sql`show_warning`,
                then: (s) => {
                  s.setScalar(
                    "countdown_seconds",
                    sql`countdown_seconds - 1`,
                  );
                  s.if(sql`countdown_seconds <= 0`, (s) => {
                    s.setScalar("show_warning", false);
                    s.setScalar("logged_out", true);
                    s.jsCall({
                      module: "timer_module",
                      exportName: "stopTimer",
                      handle: sql`idle_timer_handle`,
                    });
                    s.setScalar("idle_timer_handle", sql.lit``);
                    logout?.runLogoutCleanups?.(s);
                    s.tryServer({
                      body: (s) => {
                        s.getCookie(props.cookieName, "idle_token_cookie");
                        s.defScalar(
                          "idle_token_id",
                          sql`try_cast(idle_token_cookie.value as uuid)`,
                        );
                        s.if(sql`idle_token_id is not null`, (s) => {
                          s.startTransaction();
                          s.modify(
                            sql`delete from auth_session_tokens where public_id = idle_token_id`,
                          );
                          s.commitTransaction();
                        });
                        s.removeCookie(props.cookieName);
                      },
                      errorName: "idle_logout_error",
                      catch: (s) => {
                        s.debugExpr(
                          sql
                            .lit`Failed to logout on server during idle timeout`,
                        );
                      },
                    });
                  });
                },
                else: (s) => {
                  s.setScalar("idle_ticks", sql`idle_ticks + 1`);
                  s.if(sql`idle_ticks >= ${idleThresholdSeconds}`, (s) => {
                    s.setScalar("show_warning", true);
                    s.setScalar("countdown_seconds", sql`${warningSeconds}`);
                  });
                },
              });
            },
          },
        }}
      >
        <ModalDialog
          open={sql`show_warning and not logged_out`}
          onClose={(s) => {
            s.setScalar("show_warning", false);
            s.setScalar("countdown_seconds", sql`${warningSeconds}`);
            s.setScalar("idle_ticks", sql`0`);
          }}
          size="sm"
          layout="center"
        >
          <div className="flex flex-col items-center p-6 gap-4">
            <MaterialIcon
              icon="Timer"
              className="text-warning-500"
              sx={{ fontSize: 48 }}
            />
            <Typography level="h4" className="text-center">
              Are you still there?
            </Typography>
            <Typography
              level="body-md"
              className="text-center text-secondary"
            >
              Your session will expire due to inactivity.
            </Typography>
            <Typography level="h3" className="text-center text-warning-600">
              {sql`countdown_seconds`}
            </Typography>
            <Typography
              level="body-sm"
              className="text-center text-tertiary"
            >
              seconds remaining
            </Typography>
          </div>
        </ModalDialog>

        <Show when={sql`logged_out`}>
          <div
            sx={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              bgcolor: "background-body",
            }}
          >
            <div className="flex flex-col items-center gap-4 max-w-sm text-center">
              <MaterialIcon
                icon="Lock"
                className="text-neutral-400"
                sx={{ fontSize: 64 }}
              />
              <Typography level="h3">Session Expired</Typography>
              <Typography level="body-md" className="text-secondary">
                You have been logged out due to inactivity.
              </Typography>
              <Button
                size="lg"
                fullWidth
                onClick={(s) => {
                  s.clearLocalData();
                }}
              >
                Log in again
              </Button>
            </div>
          </div>
        </Show>

        {props.children}
      </div>
    </Data>
  );
}
