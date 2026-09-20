import { queryParamsString } from "std/services";
import type { NumericExpr, Sql } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type { DomStatements, IServerBaseStatements } from "std/statements";
import type { ZoomAuth } from "./auth";
import type { Oauth2TokenOpts } from "./auth";

export interface CreateMeetingOpts extends Oauth2TokenOpts {
  topic: Sql;
  startTime: Sql;
  duration?: NumericExpr; // Duration in minutes
  timezone?: Sql;
  agenda?: Sql;
  meetingIdScalar: string;
  meetingUrlScalar: string;
  meetingPasswordScalar: string;
}

export class ZoomMeetings {
  constructor(protected auth: ZoomAuth) {}

  create<T extends IServerBaseStatements>(s: T, opts: CreateMeetingOpts) {
    const requestJson = sql.jsonBuildObject({
      topic: opts.topic,
      type: 2,
      start_time: opts.startTime,
      duration: opts.duration,
      timezone: opts.timezone,
      agenda: opts.agenda,
    });
    this.auth.requestWithOauth(s, {
      requestOpts: {
        method: "POST",
        uri: sql.lit`https://api.zoom.us/v2/users/me/meetings`,
        headers: [
          {
            name: sql.lit`Content-Type`,
            value: sql.lit`application/json`,
          },
        ],
        json: requestJson,
        receiveJson: "zoom_response",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 201`, (s) => {
          s.throwError(
            sql`'Failed to create meeting (status ' || response.status || '): ' || coalesce(zoom_response->>'message', zoom_response::string, 'no response body')`,
          );
        });
        s.setScalar(opts.meetingIdScalar, sql`zoom_response->>'id'`);
        s.setScalar(opts.meetingUrlScalar, sql`zoom_response->>'join_url'`);
        s.setScalar(
          opts.meetingPasswordScalar,
          sql`zoom_response->>'password'`,
        );
      },
      oauthOpts: opts,
    });
  }

  get<T extends IServerBaseStatements>(
    s: T,
    opts: {
      meetingId: Sql;
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      requestOpts: {
        method: sql.lit`GET`,
        uri: sql.concat(
          sql.lit`https://api.zoom.us/v2/meetings/`,
          opts.meetingId,
        ),
        receiveJson: "meeting_info",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Failed to get meeting: ' || (meeting_info->>'message')`,
          );
        });
      },
      oauthOpts: opts,
    });
  }

  delete<T extends IServerBaseStatements>(
    s: T,
    opts: {
      meetingId: Sql;
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      requestOpts: {
        method: "DELETE",
        uri: sql.concat(
          sql.lit`https://api.zoom.us/v2/meetings/`,
          opts.meetingId,
        ),
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not in (204, 404)`, (s) => {
          s.throwError(sql`'Failed to delete meeting: ' || response.status`);
        });
      },
      oauthOpts: opts,
    });
  }

  update<T extends IServerBaseStatements>(
    s: T,
    opts: {
      meetingId: Sql;
      topic: Sql;
      startTime: Sql;
      duration: NumericExpr;
      timezone: Sql;
    } & Oauth2TokenOpts,
  ) {
    this.auth.requestWithOauth(s, {
      requestOpts: {
        method: "PATCH",
        uri: sql.concat(
          sql.lit`https://api.zoom.us/v2/meetings/`,
          opts.meetingId,
        ),
        headers: [
          {
            name: sql.lit`Content-Type`,
            value: sql.lit`application/json`,
          },
        ],
        json: sql.jsonBuildObject({
          topic: opts.topic,
          type: 2,
          start_time: opts.startTime,
          duration: opts.duration,
          timezone: opts.timezone,
        }),
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status != 204`, (s) => {
          s.throwError(sql`'Failed to update meeting: ' || response.status`);
        });
      },
      oauthOpts: opts,
    });
  }
}

export function getOauthUrl(opts: {
  s: DomStatements;
  clientId: Sql;
  redirectUri: Sql;
  scope: Sql;
}) {
  return sql.concat(
    sql.lit`https://zoom.us/oauth/authorize?`,
    queryParamsString({
      response_type: sql.lit`code`,
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      state:
        sql`json_build_object('systemId', info.system_id(), 'originalHost', location.host)::string`,
    }),
  );
}
