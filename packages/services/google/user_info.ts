import { GoogleAuth } from "services/google/auth";
import type { Oauth2TokenOpts } from "services/google/auth";
import { queryParamsString } from "std/services";
import { sql } from "../../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

export class GoogleUserInfo {
  auth = new GoogleAuth();

  getEmail<T extends IServerBaseStatements>(
    s: T,
    opts: Oauth2TokenOpts & {
      emailScalar?: string;
    },
  ) {
    const emailScalar = opts.emailScalar ?? "email";
    s.defScalar(emailScalar, {
      type: { type: "String", maxLength: 255 },
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: "GET",
        uri: sql.lit`https://www.googleapis.com/oauth2/v2/userinfo`,
        receiveJson: "user_info",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.defScalar(
            "error_message",
            sql`
                coalesce(user_info->'error'->>'message', user_info::string)
          `,
          );
          s.throwError(
            sql`'Failed to get user info: ' || response.status || ' - ' || error_message`,
          );
        });
        s.setScalar(opts.emailScalar ?? "email", sql`user_info->>'email'`);
      },
    });
  }

  getUserInfo<T extends IServerBaseStatements>(
    s: T,
    opts: Oauth2TokenOpts & {
      userInfoRecord: string;
    },
  ) {
    s.defRecord(opts.userInfoRecord, {
      fields: [
        { name: "email", type: { type: "String", maxLength: 500 } },
        { name: "id", type: { type: "String", maxLength: 1000 } },
        { name: "name", type: { type: "String", maxLength: 500 } },
        { name: "picture", type: { type: "String", maxLength: 500 } },
        { name: "locale", type: { type: "String", maxLength: 255 } },
        { name: "verified_email", type: { type: "Bool" } },
        { name: "hd", type: { type: "String", maxLength: 255 } },
        { name: "given_name", type: { type: "String", maxLength: 255 } },
        { name: "family_name", type: { type: "String", maxLength: 255 } },
      ],
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: "GET",
        uri: sql.lit`https://www.googleapis.com/oauth2/v2/userinfo`,
        receiveJson: "user_info",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.defScalar(
            "error_message",
            sql`
            coalesce(user_info->'error'->>'message', user_info::string)
      `,
          );
          s.throwError(
            sql`'Failed to get user info: ' || response.status || ' - ' || error_message`,
          );
        });
        s.modify(
          sql`insert into ${
            sql.ref(opts.userInfoRecord)
          } (email, id, name, picture, locale, verified_email, hd, given_name, family_name) values (
          user_info->>'email',
          user_info->>'id',
          user_info->>'name',
          user_info->>'picture',
          user_info->>'locale',
          try_cast(user_info->'verified_email' as bool),
          user_info->>'hd',
          user_info->>'given_name',
          user_info->>'family_name'
        )`,
        );
      },
    });
  }

  /*
  Added this to get the email, name, and family name without the picture, locale, verified_email, and hd. Picture was causing errors for some of the google workspace accounts
  */
  getUserEmailNameInfo<T extends IServerBaseStatements>(
    s: T,
    opts: Oauth2TokenOpts & {
      userEmailNameInfoRecord: string;
    },
  ) {
    s.defRecord(opts.userEmailNameInfoRecord, {
      fields: [
        { name: "email", type: { type: "String", maxLength: 500 } },
        { name: "id", type: { type: "String", maxLength: 1000 } },
        { name: "name", type: { type: "String", maxLength: 500 } },
        { name: "given_name", type: { type: "String", maxLength: 255 } },
        { name: "family_name", type: { type: "String", maxLength: 255 } },
      ],
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: "GET",
        uri: sql.lit`https://www.googleapis.com/oauth2/v2/userinfo`,
        receiveJson: "user_info",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.defScalar(
            "error_message",
            sql`
            coalesce(user_info->'error'->>'message', user_info::string)
      `,
          );
          s.throwError(
            sql`'Failed to get user info: ' || response.status || ' - ' || error_message`,
          );
        });
        s.modify(
          sql`insert into ${
            sql.ref(opts.userEmailNameInfoRecord)
          } (email, id, name, given_name, family_name) values (
          user_info->>'email',
          user_info->>'id',
          user_info->>'name',
          user_info->>'given_name',
          user_info->>'family_name'
        )`,
        );
      },
    });
  }

  getAliases<T extends IServerBaseStatements>(
    s: T,
    opts: Oauth2TokenOpts & {
      aliasTable: string;
    },
  ) {
    s.defTable(opts.aliasTable, {
      fields: [{ name: "email", type: { type: "String", maxLength: 255 } }],
    });
    this.auth.requestWithOauth(s, {
      oauthOpts: opts,
      requestOpts: {
        method: "GET",
        uri: sql.concat(
          sql.lit`https://people.googleapis.com/v1/people/me?`,
          queryParamsString({
            personFields: sql.lit`emailAddresses`,
          }),
        ),
        receiveJson: "user_alias_info",
        responseRecord: "response",
      },
      afterRequest: (s) => {
        s.if(sql`response.status not between 200 and 299`, (s) => {
          s.throwError(sql`'Failed to get user info: ' || response.status`);
        });
        s.modify(sql`insert into ${sql.ref(opts.aliasTable)} ( email) select
        value->>'value' as email
          from json.array_each(user_alias_info->'emailAddresses') as value`);
      },
    });
  }
}
