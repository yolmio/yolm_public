import { ZoomIcon } from "components/icons/zoom";
import { ZoomAuth } from "services/zoom/auth";
import type { Oauth2TokenOpts } from "services/zoom/auth";
import { ZoomMeetings } from "services/zoom/meeting";
import { AuthApiICtxKey } from "std/ictx";
import {
  isLocalhostHost,
  localhostAwareScheme,
  queryParamsString,
} from "std/services";
import { sql } from "../../std/sql_utils";
import type { AnyExpr, BooleanExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  EndpointStatements,
  IServerBaseStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { system } from "std/system";
import type { App } from "std/system";
import { useOptionalICtx } from "std/ui";
import type { QueryParam } from "std/yom";
import { getCapabilities } from "std/yolm_gen_api";
import type {
  CreateMeetingOpts,
  DeleteAccountOpts,
  DeleteMeetingOpts,
  MeetingIntegration,
  UpdateMeetingOpts,
} from "./index";

interface ZoomIntegrationOptions {
  provider: string;
  scopes: Sql;
  redirectUri: Sql;
  verificationSecret: Sql;
  extensions?: ZoomIntegrationExtensions;
}

/**
 * Optional server-statement hooks for the Zoom integration. Pass via the
 * integration's `extensions` option to run extra logic without forking the
 * block.
 */
export interface ZoomIntegrationExtensions {
  /**
   * Runs when Zoom posts to the app-deauthorization (deregister) webhook,
   * before the account is disconnected. Receives the raw request body.
   */
  onDeregisterReceived?: <T extends IServerBaseStatements>(
    s: T,
    ctx: { body: Sql },
  ) => void;
}

/**
 * Zoom integration for the meeting-integrations system. Implements
 * {@link MeetingIntegration} to create Zoom meetings for scheduled
 * appointments and manage per-user Zoom OAuth accounts.
 *
 * Pass an instance to the meeting-integrations registration in
 * `core.tsx` to enable Zoom as a meeting provider.
 */
export class ZoomIntegration implements MeetingIntegration {
  accountTable = "user_zoom_accounts";
  integrationName = "Zoom";
  encryptionKey = "9rvldew3zgi";
  blockName = "ZoomIntegration";
  blockDisplayName = "Zoom";
  externalServiceOptions = [
    { optionKey: "oauth", optionLabel: "OAuth" },
    { optionKey: "create_meetings", optionLabel: "Create and manage meetings" },
  ];
  #caps = getCapabilities()?.blocks?.ZoomIntegration;
  isActiveAccount: BooleanExpr = sql`status = 'active'`;
  icon = ({ sx, className }: { sx?: Style; className?: string }) => (
    <ZoomIcon sx={sx} className={className} />
  );

  accountDisplay = <>{sql`account.email`}</>;

  auth: ZoomAuth;
  #zoomMeetings: ZoomMeetings;
  constructor(private opts: ZoomIntegrationOptions) {
    this.auth = new ZoomAuth({
      verificationSecret: opts.verificationSecret,
    });
    this.#zoomMeetings = new ZoomMeetings(this.auth);
  }

  initialize() {
    const db = system.db;
    system.enum_({
      name: "zoom_connection_status",
      values: ["active", "reauth_required"],
    });
    db.table("user_zoom_accounts", (table) => {
      table.fk("sys_users").notNull();
      table.bigUint("credential_id").notNull().unique();
      table.email("email");
      table.string("zoom_user_id", 255);
      table.string("granted_scopes", 1000);
      table.enum("status", "zoom_connection_status")
        .notNull()
        .default(sql`'active'`);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
    });
  }

  #getOauthOpts = (
    accountId: AnyExpr,
    optIn?: BooleanExpr,
  ): Oauth2TokenOpts => {
    return {
      managedOauthCredentialId:
        sql`(select credential_id from user_zoom_accounts where id = ${accountId})`,
      onReauthRequired: (s) => {
        s.startTransaction();
        s.modify(
          sql`update user_zoom_accounts set status = 'reauth_required' where id = ${accountId}`,
        );
        s.commitTransaction();
      },
      optIn,
    };
  };

  createMeeting<T extends IServerBaseStatements>(
    s: T,
    opts: CreateMeetingOpts,
  ): void {
    const condition = opts.eventTypeId
      ? sql`exists(select 1 from user_zoom_accounts where sys_user_id = ${opts.userId} and status = 'active')
      and exists(select 1 from db.scheduling_event_types sc where sc.id = ${opts.eventTypeId} and
      (
      location_type = 'zoom' or
      (location_type = 'agent_location' and (select location_type from scheduling_event_type_users su where su.sys_user_id = ${opts.userId} and su.event_type_id = ${opts.eventTypeId}) = 'zoom'))
      )`
      : sql`exists(select 1 from user_zoom_accounts where sys_user_id = ${opts.userId} and status = 'active')`;
    s.if(
      condition,
      (s) => {
        s.defRecord(
          "zoom_account",
          sql`select id as account_id
            from user_zoom_accounts
            where sys_user_id = ${opts.userId}
              and status = 'active'`,
        );

        const { topic, startTime, duration } = opts;

        this.#zoomMeetings.create(s, {
          topic,
          startTime,
          duration,
          timezone: opts.timeZone,
          meetingIdScalar: opts.meetingIdScalar,
          meetingUrlScalar: opts.meetingUrlScalar,
          meetingPasswordScalar: opts.meetingPasswordScalar,
          ...this.#getOauthOpts(
            sql`zoom_account.account_id`,
            !!this.#caps?.create_meetings,
          ),
        });
      },
    );
  }

  deleteMeeting<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteMeetingOpts,
  ): void {
    s.defRecord(
      "zoom_account",
      sql`select id as account_id
        from user_zoom_accounts
        where sys_user_id = ${opts.userId}
          and status = 'active'`,
    );
    s.if(sql`zoom_account.account_id is not null`, (s) => {
      this.#zoomMeetings.delete(s, {
        meetingId: opts.meetingId,
        ...this.#getOauthOpts(
          sql`zoom_account.account_id`,
          !!this.#caps?.create_meetings,
        ),
      });
    });
  }

  updateMeeting<T extends IServerBaseStatements>(
    s: T,
    opts: UpdateMeetingOpts,
  ): void {
    s.defRecord(
      "zoom_account",
      sql`select id as account_id
        from user_zoom_accounts
        where sys_user_id = ${opts.userId}
          and status = 'active'`,
    );
    s.if(sql`zoom_account.account_id is not null`, (s) => {
      this.#zoomMeetings.update(s, {
        topic: opts.topic,
        startTime: opts.startTime,
        duration: opts.duration,
        timezone: opts.timezone,
        meetingId: opts.meetingId,
        ...this.#getOauthOpts(
          sql`zoom_account.account_id`,
          !!this.#caps?.create_meetings,
        ),
      });
    });
  }

  addOauthRedirect(app: App): void {
    const queryParams = [
      { name: "code", type: { type: "String", maxLength: 8_000 } },
      { name: "state", type: { type: "String", maxLength: 8_000 } },
      { name: "error", type: { type: "String", maxLength: 8_000 } },
    ] as QueryParam[];

    const body = (s: EndpointStatements) => {
      const authCtx = useOptionalICtx(AuthApiICtxKey);
      if (authCtx) {
        authCtx.authenticate(s);
      } else {
        throw new Error("No auth context for api");
      }

      s.if(sql`error is not null and error != ''`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(
              concat('Zoom OAuth denied: ', coalesce(error, 'unknown_error'))
            )`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.if(sql`code is null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component('No auth code found in Zoom OAuth callback')`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.serviceRequest({
        serviceType: sql.lit`managed_oauth`,
        operation: sql.lit`complete_callback`,
        optIn: !!this.#caps?.oauth,
        requestJson: sql`json_build_object(
          'provider', ${sql.lit(this.opts.provider)},
          'code', code,
          'state', state
        )`,
        resultJsonScalar: "callback_result",
        errorJsonScalar: "callback_error",
      });
      s.if(sql`callback_error is not null`, (s) => {
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            "/oauth-error?error_msg=",
            sql`uri.encode_component(coalesce(callback_error->>'message', 'OAuth callback failed'))`,
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
        s.return();
      });
      s.startTransaction();
      s.modify(sql`
          merge into db.${sql.ref(this.accountTable)} as target using (
            select
              user_id as sys_user_id,
              (callback_result->>'credential_id')::bigint as credential_id,
              callback_result->>'provider_email' as email,
              callback_result->>'provider_subject' as zoom_user_id,
              callback_result->>'granted_scopes' as granted_scopes,
              'active' as status
          ) as source
          on target.sys_user_id = source.sys_user_id
          when matched then
            update set
              credential_id = source.credential_id,
              email = source.email,
              zoom_user_id = source.zoom_user_id,
              granted_scopes = source.granted_scopes,
              status = source.status
          when not matched then
            insert (sys_user_id, credential_id, email, zoom_user_id, granted_scopes, status)
            values (source.sys_user_id, source.credential_id, source.email, source.zoom_user_id, source.granted_scopes, source.status)
        `);
      s.commitTransaction();
      s.setHeader(sql.lit`Location`, sql.lit`/integrations`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHttpStatus(303);
    };

    system.api({ prefix: "/api", domain: app.domain }).get(
      "/can-write/zoom-oauth-callback",
      {
        query: queryParams,
        procedure: body,
      },
    );
    for (const alias of app.domainAliases) {
      system.api({ prefix: "/api", domain: alias }).get(
        "/can-write/zoom-oauth-callback",
        {
          query: queryParams,
          procedure: body,
        },
      );
    }

    system.globalApi.get("/can-write/zoom-meeting-oauth-redirect", {
      query: queryParams,
      procedure: (s) => {
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`resolve_callback_target`,
          optIn: !!this.#caps?.oauth,
          requestJson: sql`json_build_object(
            'provider', ${sql.lit(this.opts.provider)},
            'state', state
          )`,
          resultJsonScalar: "callback_target_result",
          errorJsonScalar: "callback_target_error",
        });
        s.if(sql`callback_target_error is not null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql.concat(
              "/oauth-error?error_msg=",
              sql`uri.encode_component(coalesce(callback_target_error->>'message', 'OAuth redirect callback resolution failed'))`,
            ),
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.defScalar(
          "original_host",
          sql`callback_target_result->>'original_host'`,
        );
        s.if(sql`original_host is null`, (s) => {
          s.setHeader(
            sql.lit`Location`,
            sql
              .lit`http://localhost:${
              3001 + system.appIndex(app)
            }/oauth-error?error_msg=no_original_host`,
          );
          s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
          s.setHttpStatus(303);
          s.return();
        });
        s.setHeader(
          sql.lit`Location`,
          sql.concat(
            localhostAwareScheme(sql`lower(original_host)`),
            sql`original_host`,
            "/api/can-write/zoom-oauth-callback?",
            queryParamsString({
              code: sql`code`,
              state: sql`state`,
              error: sql`error`,
            }),
          ),
        );
        s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
        s.setHttpStatus(303);
      },
    });

    system.globalApi.post("/zoom-deregister", {
      jsonBodyScalar: "body",
      procedure: (s) => {
        s.getHeader(sql.lit`authorization`, "authorization_header");
        s.if(
          sql`authorization_header is null or ${this.opts.verificationSecret} is null or authorization_header != ${this.opts.verificationSecret}`,
          (s) => {
            s.setHttpStatus(401);
            s.return();
          },
        );
        this.opts.extensions?.onDeregisterReceived?.(s, {
          body: sql`body`,
        });

        s.defScalar("user_id_scalar", sql`(body->'payload'->>'user_id')`);
        s.defRecord(
          "account_to_delete",
          sql`select * from user_zoom_accounts where zoom_user_id = user_id_scalar`,
        );
        s.if(sql`account_to_delete.id is not null`, (s) => {
          s.try({
            body: (s) => {
              s.serviceRequest({
                serviceType: sql.lit`managed_oauth`,
                operation: sql.lit`disconnect`,
                optIn: !!this.#caps?.oauth,
                requestJson: sql`json_build_object(
                  'credential_id', account_to_delete.credential_id
                )`,
                resultJsonScalar: "__zoom_disconnect_result",
                errorJsonScalar: "__zoom_disconnect_error",
              });
              s.if(sql`__zoom_disconnect_result is null`, () => {});
              s.if(sql`__zoom_disconnect_error is null`, () => {});
            },
            errorName: "disconnect_error",
            catch: () => {},
          });
          s.startTransaction();
          s.modify(
            sql`delete from user_zoom_accounts where id = account_to_delete.id`,
          );
          s.commitTransaction();
        });

        s.setHttpStatus(200);
      },
    });
  }

  navigateToOauth(s: DomStatements) {
    s.defScalar("oauth_start_error", {
      type: "String",
    });
    s.defScalar("authorize_url", {
      type: "String",
    });
    s.tryServer({
      body: (s) => {
        s.getHeader(sql.lit`yolm-origin-domain`, "oauth_origin_domain");
        s.defScalar(
          "oauth_origin_domain_lower",
          sql`lower(coalesce(oauth_origin_domain, ''))`,
        );
        s.defScalar(
          "oauth_redirect_uri",
          sql`case when ${
            isLocalhostHost(sql`oauth_origin_domain_lower`)
          } then 'http://localhost:3000/can-write/zoom-meeting-oauth-redirect' else 'https://yolmglobalapi.com/can-write/zoom-meeting-oauth-redirect' end`,
        );
        s.serviceRequest({
          serviceType: sql.lit`managed_oauth`,
          operation: sql.lit`start_flow`,
          optIn: !!this.#caps?.oauth,
          requestJson: sql`json_build_object(
            'provider', ${sql.lit(this.opts.provider)},
            'scopes', ${this.opts.scopes},
            'redirect_uri', oauth_redirect_uri
          )`,
          resultJsonScalar: "start_flow_result",
          errorJsonScalar: "start_flow_error",
        });
        s.if(sql`start_flow_error is not null`, (s) => {
          s.setScalar(
            "oauth_start_error",
            sql`coalesce(start_flow_error->>'message', 'Failed to start OAuth flow')`,
          );
          s.return();
        });
        s.setScalar("authorize_url", sql`start_flow_result->>'authorize_url'`);
      },
      errorName: "start_flow_proc_error",
      catch: (s) => {
        s.setScalar(
          "oauth_start_error",
          sql`coalesce(start_flow_proc_error.message, 'Failed to start OAuth flow')`,
        );
      },
    });
    s.if(sql`oauth_start_error is not null`, (s) => {
      s.location.assign(
        sql.concat(
          "/oauth-error?error_msg=",
          sql`uri.encode_component(oauth_start_error)`,
        ),
      );
    }, (s) => {
      s.location.assign(sql`authorize_url`);
    });
  }

  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteAccountOpts,
  ): void {
    s.defRecord(
      "account_to_delete",
      sql`select * from user_zoom_accounts where id = ${opts.accountId}`,
    );
    s.serviceRequest({
      serviceType: sql.lit`managed_oauth`,
      operation: sql.lit`disconnect`,
      optIn: !!this.#caps?.oauth,
      requestJson: sql`json_build_object(
        'credential_id', account_to_delete.credential_id
      )`,
      resultJsonScalar: "__zoom_disconnect_result",
      errorJsonScalar: "__zoom_disconnect_error",
    });
    s.if(sql`__zoom_disconnect_result is null`, () => {});
    s.if(sql`__zoom_disconnect_error is null`, () => {});
    s.startTransaction();
    s.modify(
      sql`delete from user_zoom_accounts where id = ${opts.accountId}`,
    );
    s.commitTransaction();
  }
}
