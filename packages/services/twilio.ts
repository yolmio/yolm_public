import { getStaticSecret } from "std/services";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import type { IServerBaseStatements } from "std/statements";

const BASE_URL = "https://api.twilio.com/2010-04-01";

export interface TwilioOptions {
  accountSid?: Sql;
  authToken?: Sql;
  fromNumber?: Sql;
}

export class Twilio {
  #opts: Required<TwilioOptions>;

  constructor(opts: TwilioOptions = {}) {
    this.#opts = {
      accountSid: opts.accountSid ??
        getStaticSecret(sql.lit`TWILIO_ACCOUNT_SID`),
      authToken: opts.authToken ?? getStaticSecret(sql.lit`TWILIO_AUTH_TOKEN`),
      fromNumber: opts.fromNumber ??
        getStaticSecret(sql.lit`TWILIO_FROM_NUMBER`),
    };
  }

  /**
       Sends an SMS message using Twilio
       */
  sendSms<T extends IServerBaseStatements>(
    s: T,
    opts: {
      to: Sql;
      body: Sql;
      from?: Sql;
      optIn?: BooleanExpr;
    },
  ) {
    s.block((s) => {
      const url = sql.concat(
        sql.lit`${BASE_URL}/Accounts/`,
        this.#opts.accountSid,
        sql.lit`/Messages.json`,
      );
      s.request({
        method: "POST",
        uri: url,
        optIn: opts.optIn,
        headers: [
          {
            name: sql.lit`Authorization`,
            value: sql.concat(
              "Basic ",
              sql`bytes.to_base64(
                string.to_utf8(
                  ${
                sql.concat(this.#opts.accountSid, ":", this.#opts.authToken)
              }
                )
              )`,
            ),
          },
        ],
        multipart: [
          {
            name: sql.lit`Body`,
            string_value: opts.body,
          },
          {
            name: sql.lit`To`,
            string_value: opts.to,
          },
          {
            name: sql.lit`From`,
            string_value: opts.from ?? this.#opts.fromNumber,
          },
        ],
        receiveJson: "response_body",
        responseRecord: "response",
      });
      s.if(sql`response.status != 201`, (s) => {
        s.debugExpr(sql`response_body`);
        s.throwError(
          sql`'Failed to send SMS. Status: ' || response.status || '. Error: ' || (response_body->>'message')`,
        );
      });
    });
  }
}

// Export a default instance
export const twilio = new Twilio();
