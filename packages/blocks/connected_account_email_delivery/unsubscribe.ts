import type { AnyExpr } from "std/sql_utils";
import { sql } from "std/sql_utils";
import { system } from "std/system";

const path = "/connected-account-email/unsubscribe";

export function connectedUnsubscribeUrl(token: AnyExpr) {
  return sql`${sql.lit(`https://yolmglobalapi.com${path}?yolm-system-id=`)}
    || info.system_id()::string || '&token=' || uri.encode_component(${token})`;
}

export function initializeConnectedUnsubscribe() {
  const query = [{
    name: "token",
    type: { type: "String" as const, maxLength: 200 },
  }];
  const recipientQuery = sql`select id, recipient_email
    from connected_account_email_recipient_outbox
    where regex.is_match(token, '^[0-9a-f]{64}$') and unsubscribe_token = token`;

  system.globalApi.get(path, {
    query,
    procedure: (s) => {
      s.setHeader(sql.lit`Content-Type`, sql.lit`text/html; charset=utf-8`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      s.setHeader(sql.lit`X-Robots-Tag`, sql.lit`noindex, nofollow`);
      s.if(sql`not exists(${recipientQuery})`, (s) => {
        s.setHttpStatus(404);
        s.return(
          sql
            .lit`<!doctype html><html><body><h1>Unsubscribe link unavailable</h1><p>This unsubscribe link is invalid or no longer available.</p></body></html>`,
        );
      });
      // GET is confirmation-only so link scanners cannot opt a recipient out.
      s.return(sql.concat(
        sql
          .lit`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:50px auto;text-align:center"><h1>Unsubscribe</h1><p>Confirm that you want to stop receiving bulk emails.</p><form method="post" action="`,
        connectedUnsubscribeUrl(sql`token`),
        sql
          .lit`"><button type="submit" style="padding:10px 18px">Unsubscribe</button></form></body></html>`,
      ));
    },
  });
  system.globalApi.post(path, {
    query,
    procedure: (s) => {
      s.startTransaction();
      s.defRecord("unsubscribe_recipient", recipientQuery);
      s.if(sql`unsubscribe_recipient.id is not null`, (s) => {
        s.modify(sql`insert into bulk_email_suppressions
            (email, reason, source_event_key, detail)
          values (lower(trim(unsubscribe_recipient.recipient_email)), 'unsubscribe',
            'connected-unsubscribe:' || unsubscribe_recipient.id::string,
            'Recipient requested bulk-email unsubscribe')
          on conflict (email) do nothing`);
        s.modify(sql`update connected_account_email_recipient_outbox
          set unsubscribed_at = coalesce(unsubscribed_at, now())
          where id = unsubscribe_recipient.id`);
      });
      s.commitTransaction();
      s.setHeader(sql.lit`Content-Type`, sql.lit`text/html; charset=utf-8`);
      s.setHeader(sql.lit`Cache-Control`, sql.lit`no-store`);
      // Uniform response does not disclose whether a token or address exists.
      s.return(
        sql
          .lit`<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:50px auto;text-align:center"><h1>Unsubscribe request received</h1><p>If the link was valid, you have been unsubscribed from bulk emails.</p></body></html>`,
      );
    },
  });
}
