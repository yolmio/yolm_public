import { useJsModule } from "std/js_modules";
import { LogoutICtxKey } from "std/ictx";
import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import { Data } from "std/data";
import { system } from "std/system";
import { EventHandlers, Show, useOptionalICtx } from "std/ui";
import type { Node } from "std/ui";
import { ModalDialog } from "components/modal";
import { Typography } from "components/typography";
import { Button } from "components/button";
import { MaterialIcon } from "components/material_icon";
import { AuthBlock } from "./index";

export interface IdleTimeoutConfig {
  idleMinutes?: number;
  warningSeconds?: number;
  /**
   * Only report this app's activity to the shared session; never warn or log
   * out here. Use it in apps sharing a session cookie (same `cookieName` and
   * `cookieDomain`) with an idle-timeout app so working in them keeps the
   * session alive. Reports go out about once a minute; for idle timeouts under
   * four minutes, also set the enforcing app's `idleMinutes`.
   */
  reportOnly?: boolean;
}

// A failed end-of-idle check is retried before this tab locks itself.
const SYNC_ATTEMPTS = 3;
const SYNC_RETRY_SECONDS = 10;
// A server call still pending after this long is treated as lost.
const PENDING_SECONDS = 30;
// An idle gap counts against a tab that slept through it only while it is this
// recent, so a tab woken long after work resumed elsewhere does not log out.
const RECENT_GAP_SECONDS = 120;

export function IdleTimeout(props: {
  config: IdleTimeoutConfig;
  cookieName: Sql;
  /** No session token exists (development auto-login): nothing is shared. */
  sessionless?: boolean;
  children: Node;
}) {
  const idleMinutes = props.config.idleMinutes ?? 15;
  const warningSeconds = props.config.warningSeconds ?? 60;
  const idleSeconds = Math.round(idleMinutes * 60);
  // Tabs report input at most this often; other tabs only consult the session
  // near their own deadline, which is always further away.
  const reportSeconds = Math.max(
    1,
    Math.min(60, Math.floor(idleSeconds / 4)),
  );
  // How far this tab's own not-yet-reported input can trail the session.
  const gapGraceSeconds = reportSeconds + 2;
  const logout = useOptionalICtx(LogoutICtxKey);

  if (!system.block(AuthBlock).opts.sessionActivity) {
    throw new Error(
      "idleTimeout requires `sessionActivity: true` on the AuthBlock so every tab and app on a session shares its activity.",
    );
  }
  if (props.config.reportOnly && props.sessionless) return props.children;

  useJsModule("timer_module");

  function defActivityScalars(s: StateStatements) {
    // Server rendering evaluates these with the server clock; `startTimer`
    // resets them from the browser clock that every handler compares against.
    s.defScalar("idle_timer_handle", sql.lit``);
    s.defScalar("idle_last_input_at", sql`now()`);
    s.defScalar("idle_reported_input_at", sql`idle_last_input_at`);
    s.defScalar("idle_next_report_at", sql`idle_last_input_at`);
    s.defScalar("idle_report_pending_until", sql`idle_last_input_at`);
  }

  function startTimer(s: DomStatements) {
    s.setScalar("idle_last_input_at", sql`now()`);
    // An enforcing tab counts its own load as activity.
    s.setScalar(
      "idle_reported_input_at",
      props.config.reportOnly
        ? sql`idle_last_input_at`
        : sql`date.add(second, -1, idle_last_input_at)`,
    );
    s.setScalar(
      "idle_next_report_at",
      sql`date.add(second, ${reportSeconds}, idle_last_input_at)`,
    );
    s.setScalar("idle_report_pending_until", sql`idle_last_input_at`);
    if (!props.config.reportOnly) {
      s.setScalar(
        "idle_expires_at",
        sql`date.add(second, ${idleSeconds}, idle_last_input_at)`,
      );
      s.setScalar("idle_sync_pending_until", sql`idle_last_input_at`);
      s.setScalar("idle_next_sync_at", sql`idle_last_input_at`);
    }
    s.setScalar("idle_timer_handle", sql`cast(random.uuid() as string)`);
    s.jsCall({
      module: "timer_module",
      exportName: "startTimer",
      handle: sql`idle_timer_handle`,
      argJson: sql`json_build_object()`,
    });
  }

  const timerHandles = [{
    module: "timer_module",
    cleanup: "stopTimer",
    handle: sql`idle_timer_handle`,
  }];

  // Sends this tab's latest unreported input to the shared session. Use its
  // age at dispatch so browser/server clock skew cannot move it into the future.
  function reportActivity(s: DomStatements) {
    if (props.sessionless) return;
    s.if(
      sql`now() >= idle_report_pending_until
        and idle_last_input_at > idle_reported_input_at
        and now() >= idle_next_report_at`,
      (s) => {
        s.setScalar(
          "idle_report_pending_until",
          sql`date.add(second, ${PENDING_SECONDS}, now())`,
        );
        s.setScalar(
          "idle_next_report_at",
          sql`date.add(second, ${reportSeconds}, now())`,
        );
        s.defScalar("idle_report_input_at", sql`idle_last_input_at`);
        s.defScalar(
          "idle_report_age_seconds",
          sql`date.diff(second, idle_last_input_at, now())`,
        );
        s.startTaskWithOpts({
          detached: true,
          procedure: (s) => {
            s.defScalar(
              "idle_report_request_until",
              sql`idle_report_pending_until`,
            );
            s.defScalar("idle_report_ok", false);
            s.tryServer({
              body: (s) => {
                s.getCookie(props.cookieName, "idle_report_cookie");
                s.defScalar(
                  "idle_report_token_id",
                  sql`try_cast(idle_report_cookie.value as uuid)`,
                );
                // Keep the longest idle gap of the last few minutes, so a tab
                // that slept through it can still expire the session.
                const keepNewGap = sql`(
                  target.idle_gap_to is null
                  or target.idle_gap_to < date.add(
                    second, ${-RECENT_GAP_SECONDS}, now()
                  )
                  or date.diff(
                    second, target.last_activity_at, source.activity_at
                  ) >= date.diff(
                    second, target.idle_gap_from, target.idle_gap_to
                  )
                )`;
                s.startTransaction();
                // Activity is never later than now nor earlier than the login.
                s.modify(sql`merge into auth_session_activity as target
                  using (
                    select
                      id as auth_session_token_id,
                      issued,
                      least(
                        now(),
                        greatest(
                          issued,
                          date.add(
                            second,
                            -greatest(0, idle_report_age_seconds),
                            now()
                          )
                        )
                      ) as activity_at
                    from auth_session_tokens
                    where public_id = idle_report_token_id
                  ) as source
                  on target.auth_session_token_id = source.auth_session_token_id
                  when matched
                    and source.activity_at > target.last_activity_at
                  then update set
                    last_activity_at = source.activity_at,
                    idle_gap_from = case when ${keepNewGap}
                      then target.last_activity_at
                      else target.idle_gap_from
                    end,
                    idle_gap_to = case when ${keepNewGap}
                      then source.activity_at
                      else target.idle_gap_to
                    end
                  when not matched then
                    insert (
                      auth_session_token_id,
                      last_activity_at,
                      idle_gap_from,
                      idle_gap_to
                    )
                    values (
                      source.auth_session_token_id,
                      source.activity_at,
                      source.issued,
                      source.activity_at
                    )`);
                s.commitTransaction();
                s.setScalar("idle_report_ok", true);
              },
              errorName: "idle_report_error",
              catch: (s) => {
                s.debugExpr(sql.lit`Failed to report session activity`);
              },
            });
            s.if(sql`idle_report_ok`, (s) => {
              s.setScalar(
                "idle_reported_input_at",
                sql`greatest(idle_reported_input_at, idle_report_input_at)`,
              );
            });
            s.if(
              sql`idle_report_pending_until = idle_report_request_until`,
              (s) => {
                s.setScalar("idle_report_pending_until", sql`now()`);
              },
            );
          },
        });
      },
    );
  }

  function noteInput(s: DomStatements) {
    s.setScalar("idle_last_input_at", sql`now()`);
  }

  if (props.config.reportOnly) {
    return (
      <>
        {props.children}
        <Data local procedure={defActivityScalars}>
          <EventHandlers
            document={{
              mouseMove: noteInput,
              mouseDown: noteInput,
              keydown: noteInput,
              click: noteInput,
              scroll: noteInput,
            }}
          />
          <div
            className="hidden"
            onMount={startTimer}
            js={{
              handles: timerHandles,
              on: { "timer_module.tick": reportActivity },
            }}
          />
        </Data>
      </>
    );
  }

  function stopTimer(s: DomStatements) {
    s.setScalar("show_warning", false);
    s.setScalar("logged_out", true);
    s.jsCall({
      module: "timer_module",
      exportName: "stopTimer",
      handle: sql`idle_timer_handle`,
    });
    s.setScalar("idle_timer_handle", sql.lit``);
  }

  function expireSession(s: DomStatements) {
    stopTimer(s);
    if (props.sessionless) return;
    // The checking transaction already revoked the token. A second logout
    // request could delete a replacement session created in another tab.
    s.startTaskWithOpts({
      detached: true,
      procedure: (s) => {
        logout?.runLogoutCleanups?.(s);
        s.clearLocalData();
      },
    });
  }

  // Asks the server how long the shared session has left, counting activity
  // from every tab and app. With `revoke`, none is left either when it is idle
  // now or when it went idle after this tab's own deadline while this tab
  // slept, even if activity elsewhere resumed it since; an expired session is
  // deleted in the same transaction, so concurrent activity either lands first
  // or finds it gone. Pending input is held back until the session is confirmed
  // alive, including input arriving while the check is in flight.
  function syncSession(s: DomStatements, revoke: boolean) {
    if (props.sessionless) {
      if (revoke) {
        expireSession(s);
      } else {
        s.setScalar("show_warning", true);
        s.setScalar(
          "countdown_seconds",
          sql`date.diff(second, now(), idle_expires_at)`,
        );
      }
      return;
    }
    if (revoke) {
      // Count attempts when sent: a request that never answers must consume
      // the same bounded budget as an explicit failure.
      s.if(sql`idle_sync_attempts >= ${SYNC_ATTEMPTS}`, (s) => {
        stopTimer(s);
        s.return();
      });
      s.setScalar("idle_sync_attempts", sql`idle_sync_attempts + 1`);
    }
    const remaining = sql`date.diff(
      second,
      now(),
      date.add(
        second,
        ${idleSeconds},
        coalesce(a.last_activity_at, t.issued)
      )
    )`;
    // Anchor the returned lifetime to dispatch, not arrival. Travel time must
    // not extend the session or make an already stale answer accept late input.
    const confirmedDeadline = sql`date.add(
      second,
      coalesce(idle_remaining_seconds, 0) - ${PENDING_SECONDS},
      idle_sync_request_until
    )`;
    const pendingInputConfirmed = sql`idle_remaining_seconds > 0
      and coalesce(idle_pending_input_from < ${confirmedDeadline}, false)`;
    const sleptThroughGap = sql`a.idle_gap_to >= date.add(
        second, ${-RECENT_GAP_SECONDS}, now()
      )
      and date.add(second, ${idleSeconds}, a.idle_gap_from) <= a.idle_gap_to
      and date.add(second, ${idleSeconds}, a.idle_gap_from) >= date.add(
        second,
        -(idle_deadline_age_seconds + ${gapGraceSeconds}),
        now()
      )`;
    s.setScalar(
      "idle_sync_pending_until",
      sql`date.add(second, ${PENDING_SECONDS}, now())`,
    );
    s.startTaskWithOpts({
      detached: true,
      procedure: (s) => {
        s.defScalar("idle_sync_request_until", sql`idle_sync_pending_until`);
        s.defScalar("idle_remaining_seconds", { type: "BigInt" });
        s.defScalar("idle_sync_failed", false);
        s.defScalar(
          "idle_deadline_age_seconds",
          sql`date.diff(second, idle_expires_at, now())`,
        );
        s.tryServer({
          body: (s) => {
            s.getCookie(props.cookieName, "idle_sync_cookie");
            s.defScalar(
              "idle_sync_token_id",
              sql`try_cast(idle_sync_cookie.value as uuid)`,
            );
            if (revoke) s.startTransaction();
            s.setScalar(
              "idle_remaining_seconds",
              sql`(
                select case when ${sleptThroughGap} then 0 else ${remaining} end
                from auth_session_tokens t
                left join auth_session_activity a
                  on a.auth_session_token_id = t.id
                where t.public_id = idle_sync_token_id
              )`,
            );
            if (revoke) {
              s.if(sql`coalesce(idle_remaining_seconds <= 0, true)`, (s) => {
                s.modify(
                  sql`delete from auth_session_tokens where public_id = idle_sync_token_id`,
                );
              });
              s.commitTransaction();
              s.if(sql`coalesce(idle_remaining_seconds <= 0, true)`, (s) => {
                s.removeCookie(props.cookieName);
              });
            }
          },
          errorName: "idle_sync_error",
          catch: (s) => {
            s.setScalar("idle_sync_failed", true);
          },
        });
        s.returnIf(sql`logged_out`);
        // A timed-out request may finish after its replacement. It no longer
        // owns the pending flag or the tab's deadline.
        s.returnUnless(sql`idle_sync_pending_until = idle_sync_request_until`);
        s.setScalar("idle_sync_pending_until", sql`now()`);
        if (revoke) {
          s.if(sql`idle_sync_failed`, (s) => {
            // Never delete a session another tab may still be using on an
            // unconfirmed answer: lock only this tab; its button reloads.
            s.if(
              sql`idle_sync_attempts >= ${SYNC_ATTEMPTS}`,
              stopTimer,
              (s) => {
                s.setScalar(
                  "idle_next_sync_at",
                  sql`date.add(second, ${SYNC_RETRY_SECONDS}, now())`,
                );
              },
            );
            s.return();
          });
          s.setScalar("idle_sync_attempts", sql`0`);
          s.if(sql`coalesce(idle_remaining_seconds <= 0, true)`, (s) => {
            expireSession(s);
            s.return();
          });
          // An aged answer can accept input that began while it was valid
          // and continued without an idle gap. Otherwise check again before
          // accepting input that only arrived after the confirmed deadline.
          s.returnIf(sql`now() >= ${confirmedDeadline}
            and not (${pendingInputConfirmed})`);
        } else {
          // Without an answer, warn from this tab's own deadline.
          s.if(sql`idle_sync_failed`, (s) => {
            s.setScalar("idle_remaining_seconds", sql`0`);
          });
          // Warning checks use the same activity/gap read, so a positive
          // answer can preserve input received while that check was pending.
          s.returnIf(sql`idle_pending_input_at is not null
            and not (${pendingInputConfirmed})`);
        }
        s.setScalar(
          "idle_expires_at",
          sql`greatest(idle_expires_at, ${confirmedDeadline})`,
        );
        s.if(pendingInputConfirmed, (s) => {
          s.setScalar(
            "idle_last_input_at",
            sql`greatest(idle_last_input_at, idle_pending_input_at)`,
          );
          s.setScalar(
            "idle_expires_at",
            sql`greatest(
              idle_expires_at,
              date.add(second, ${idleSeconds}, idle_last_input_at)
            )`,
          );
          s.setScalar("idle_pending_input_at", sql.null);
          s.setScalar("idle_pending_input_from", sql.null);
        });
        s.setScalar(
          "show_warning",
          sql`now() >= date.add(second, ${-warningSeconds}, idle_expires_at)`,
        );
        s.setScalar(
          "countdown_seconds",
          sql`greatest(0, date.diff(second, now(), idle_expires_at))`,
        );
      },
    });
  }

  const syncReady =
    sql`now() >= idle_sync_pending_until and now() >= idle_next_sync_at`;

  function checkTimeout(s: DomStatements) {
    s.returnIf(sql`logged_out`);
    reportActivity(s);
    s.returnUnless(syncReady);
    s.if(sql`now() >= idle_expires_at`, (s) => syncSession(s, true), (s) => {
      s.if(sql`show_warning`, (s) => {
        s.setScalar(
          "countdown_seconds",
          sql`date.diff(second, now(), idle_expires_at)`,
        );
      }, (s) => {
        // Activity in another tab or app may have kept the session alive.
        s.if(
          sql`now() >= date.add(second, ${-warningSeconds}, idle_expires_at)`,
          (s) => syncSession(s, false),
        );
      });
    });
  }

  function resetActivity(s: DomStatements) {
    s.returnIf(sql`logged_out`);
    // Activity after sleep must not revive an already expired session; only
    // the server knows whether another tab or app kept it alive meanwhile.
    s.if(sql`now() >= idle_expires_at`, (s) => {
      if (!props.sessionless) {
        s.if(
          sql`idle_pending_input_at is null
          or now() >= date.add(second, ${idleSeconds}, idle_pending_input_at)`,
          (s) => {
            s.setScalar("idle_pending_input_from", sql`now()`);
          },
        );
        s.setScalar("idle_pending_input_at", sql`now()`);
      }
      s.if(syncReady, (s) => syncSession(s, true));
      s.return();
    });
    noteInput(s);
    s.setScalar(
      "idle_expires_at",
      sql`date.add(second, ${idleSeconds}, now())`,
    );
    s.setScalar("show_warning", false);
    s.setScalar("countdown_seconds", sql`${warningSeconds}`);
  }

  return (
    <Data
      local
      procedure={(s) => {
        defActivityScalars(s);
        // Count elapsed time, not callbacks: background/suspended tabs skip ticks.
        s.defScalar(
          "idle_expires_at",
          sql`date.add(second, ${idleSeconds}, now())`,
        );
        s.defScalar("show_warning", false);
        s.defScalar("logged_out", false);
        s.defScalar("countdown_seconds", sql`${warningSeconds}`);
        s.defScalar("idle_sync_pending_until", sql`now()`);
        s.defScalar("idle_sync_attempts", sql`0`);
        s.defScalar("idle_pending_input_at", { type: "Timestamp" });
        s.defScalar("idle_pending_input_from", { type: "Timestamp" });
        s.defScalar("idle_next_sync_at", sql`now()`);
      }}
    >
      <EventHandlers
        document={{
          mouseMove: resetActivity,
          mouseDown: resetActivity,
          keydown: resetActivity,
          click: resetActivity,
          scroll: resetActivity,
          visibilityChange: checkTimeout,
        }}
        window={{ focus: checkTimeout }}
      />
      <div
        onMount={startTimer}
        js={{
          handles: timerHandles,
          on: {
            "timer_module.tick": checkTimeout,
          },
        }}
      >
        <ModalDialog
          open={sql`show_warning and not logged_out`}
          onClose={resetActivity}
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
              <Typography level="h3">
                {sql`case when idle_sync_attempts >= ${SYNC_ATTEMPTS}
                  then 'Session Locked' else 'Session Expired' end`}
              </Typography>
              <Typography level="body-md" className="text-secondary">
                {sql`case when idle_sync_attempts >= ${SYNC_ATTEMPTS}
                  then 'We could not confirm your session. Reconnect to continue.'
                  else 'You have been logged out due to inactivity.' end`}
              </Typography>
              <Button
                size="lg"
                fullWidth
                onClick={(s) => {
                  s.clearLocalData();
                }}
              >
                {sql`case when idle_sync_attempts >= ${SYNC_ATTEMPTS}
                  then 'Reconnect' else 'Log in again' end`}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={sql`not logged_out`}>
          {props.children}
        </Show>
      </div>
    </Data>
  );
}
