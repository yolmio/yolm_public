import { sql } from "../../std/sql_utils";
import type { BooleanExpr } from "../../std/sql_utils";
import type { GenericServerStatementsFn, TableDefOpts } from "std/statements";
import { authHeader, BASE_URL } from "./common";
import type { SendGridInternalOptions, SendGridOptions } from "./common";

/**
 * Procedure-scope table definition produced by
 * {@link SendGridContacts.add} for the rows it inserts. Pass to
 * `s.defTable(...)` if you want to declare the staging table yourself.
 */
export const addedContactsTable: TableDefOpts = {
  name: "added",
  fields: [{ name: "email", type: { type: "String", maxLength: 65_000 } }],
};

/**
 * Procedure-scope table definition produced by
 * {@link SendGridContacts.delete} for the rows it removes. Includes both
 * the email and SendGrid contact id.
 */
export const deletedContactsTable: TableDefOpts = {
  name: "deleted",
  fields: [
    { name: "email", type: { type: "String", maxLength: 65_000 } },
    { name: "contact_id", type: { type: "String", maxLength: 100 } },
  ],
};

/**
 * SendGrid v3 API client. Use the {@link sendGrid} singleton for the
 * default `sendgrid_api_key` static secret, or construct a new instance
 * with custom {@link SendGridOptions}.
 *
 * Currently exposes `.contacts` for managing marketing-campaign
 * contacts; extend as needed by adding more sub-clients.
 *
 * @category Service
 */
export class SendGrid {
  #opts: SendGridInternalOptions;
  /** Marketing-contact API helpers (`export`, `add`, `delete`). */
  contacts: SendGridContacts;

  constructor(opts: SendGridOptions = {}) {
    this.#opts = {
      apiKey: opts.apiKey ?? sql.lit`sendgrid_api_key`,
    };
    this.contacts = new SendGridContacts(this.#opts);
  }
}

/** Options for {@link SendGridContacts.export}. */
export interface ContactExportOpts {
  /** In-procedure table name to receive `{email, contact_id}` rows. */
  emailTableName?: string;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

/** Options for {@link SendGridContacts.add}. */
export interface AddContactOpts {
  /** In-procedure table name holding the emails to add. */
  emailTableName?: string;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

/** Options for {@link SendGridContacts.delete}. */
export interface DeleteContactOpts {
  /** In-procedure table name holding the SendGrid contact ids to delete. */
  contactIdTableName?: string;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

/**
 * Helpers for SendGrid's marketing-contacts API. Accessed via
 * `sendGrid.contacts.*`. Provides paged exports plus add/delete
 * operations that drive a server-procedure flow.
 *
 * @category Service
 */
export class SendGridContacts {
  constructor(private opts: SendGridInternalOptions) {}

  /**
   * Starts a SendGrid contact export, polls until the export is ready
   * (sleeping between attempts, up to ~10 retries), downloads the CSV
   * shards, and loads `{email, contact_id}` rows into a procedure-scope
   * table. Throws if the export never completes or returns no URLs.
   */
  export(opts: ContactExportOpts = {}): GenericServerStatementsFn {
    const emailTableName = opts.emailTableName ?? "sendgridEmail";
    return (s) => {
      s.defTable(emailTableName, {
        fields: [
          { name: "email", type: { type: "String", maxLength: 300 } },
          { name: "contact_id", type: { type: "String", maxLength: 300 } },
        ],
      });
      s.block((s) => {
        s.defScalar("export_id", {
          type: { type: "String", maxLength: 100 },
        });
        s.request({
          uri: sql.lit`${BASE_URL}/marketing/contacts/exports`,
          method: "POST",
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "export_body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 202`, (s) => {
          s.throwError(
            sql`'SendGrid export start failed; http_status=' || response.status`,
          );
        });
        s.setScalar("export_id", sql`export_body->>'id'`);
        s.defTable("url", {
          fields: [{ name: "url", type: { type: "String", maxLength: 3000 } }],
        });
        s.defScalar("i", 0);
        s.defScalar("poll_http_status", 0);
        s.defScalar("export_state", sql.lit`not_polled`);
        s.loop((s) => {
          s.if(sql`i > 10`, (s) => {
            s.throwError(
              sql`'SendGrid export polling exhausted; export_id=' || coalesce(export_id, '<missing>') || '; attempts=' || i || '; http_status=' || poll_http_status || '; state=' || left(export_state, 32) || '; polling_sleep_ms=' || (i * 5000)`,
            );
          });
          s.increment("i");
          s.sleep(5000);
          s.request({
            uri: sql.concat(
              `${BASE_URL}/marketing/contacts/exports/`,
              sql`export_id`,
            ),
            optIn: opts.optIn,
            headers: [authHeader(this.opts)],
            receiveJson: "poll_body",
            responseRecord: "response",
          });
          s.setScalar("poll_http_status", sql`response.status`);
          s.setScalar(
            "export_state",
            sql`case poll_body->>'status' when 'pending' then 'pending' when 'ready' then 'ready' when 'failure' then 'failure' else 'unknown' end`,
          );
          s.continueIf(sql`response.status >= 300`);
          s.continueIf(sql`export_state = 'pending'`);
          s.if(sql`export_state = 'ready'`, (s) => {
            s.modify(
              sql`insert into url select string.from_json_string(value) as url from json.array_each(poll_body->'urls')`,
            );
            s.break();
          });
          s.if(sql`export_state = 'failure'`, (s) => {
            s.throwError(
              sql`'SendGrid export failed; export_id=' || coalesce(export_id, '<missing>') || '; attempt=' || i || '; http_status=' || poll_http_status || '; state=failure'`,
            );
          });
          s.throwError(
            sql`'SendGrid export status malformed; export_id=' || coalesce(export_id, '<missing>') || '; attempt=' || i || '; http_status=' || poll_http_status || '; state=' || left(export_state, 32)`,
          );
        });
        s.if(sql`not exists (select 1 from url)`, (s) => {
          s.throwError(
            sql`'SendGrid ready export returned no urls; export_id=' || coalesce(export_id, '<missing>') || '; attempt=' || i || '; http_status=' || poll_http_status || '; state=ready'`,
          );
        });
        s.forEachTable("url", "url_record", (s) => {
          s.request({
            uri: sql`url_record.url`,
            optIn: opts.optIn,
            receiveText: "csv_body",
            responseRecord: "response",
          });
          s.if(sql`response.status >= 300`, (s) => {
            s.throwError(
              sql`'SendGrid CSV download failed; export_id=' || coalesce(export_id, '<missing>') || '; http_status=' || response.status`,
            );
          });
          s.debugExpr(sql.lit`'Received csv response'`);
          s.modify(
            sql`insert into ${
              sql.ref(
                emailTableName,
              )
            } select row.field_0 as email, row.field_17 as contact_id from csv.rows(trim(csv_body)) as row where not (row.field_0 = 'EMAIL' and row.field_17 = 'CONTACT_ID')`,
          );
        });
        s.debugExpr(
          sql`'Successfully exported ' || (select count(*) from ${
            sql.ref(
              emailTableName,
            )
          }) || ' contacts'`,
        );
      });
    };
  }

  /**
   * Upserts the emails in the named procedure-scope table into SendGrid's
   * marketing contacts (a no-op when the table is empty). SendGrid
   * processes the upsert asynchronously.
   */
  addContacts(opts?: AddContactOpts): GenericServerStatementsFn {
    const emailTableName = opts?.emailTableName ?? "added";
    return (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`About to add `,
          sql`((select count(*) from ${sql.ref(emailTableName)}))`,
          sql.lit` contacts`,
        ),
      );
      s.if(sql`exists(select 1 from ${sql.ref(emailTableName)})`, (s) => {
        s.defScalar(
          "contacts",
          sql`(select json_array_agg(json_build_object('email', email)) from ${
            sql.ref(emailTableName)
          })`,
        );
        s.defScalar(
          "payload",
          sql.jsonBuildObject({
            contacts: sql`contacts`,
          }),
        );
        s.request({
          uri: sql.lit`${BASE_URL}/marketing/contacts`,
          method: "PUT",
          optIn: opts?.optIn,
          headers: [authHeader(this.opts)],
          json: sql`payload`,
          receiveJson: "body",
          responseRecord: "response",
        });
        s.if(sql`response.status >= 300`, (s) => {
          s.debugExpr(sql`body`);
          s.throwError(
            sql`'Received error status from adding contacts call:' || response.status`,
          );
        });
      });
    };
  }

  /**
   * Deletes the SendGrid contacts whose ids are in the named
   * procedure-scope table (a no-op when the table is empty).
   */
  deleteContacts(opts?: DeleteContactOpts): GenericServerStatementsFn {
    const contactIdTableName = opts?.contactIdTableName ?? "deleted";
    return (s) => {
      s.debugExpr(
        sql.concat(
          sql.lit`About to delete `,
          sql`((select count(*) from ${
            sql.ref(contactIdTableName)
          } where contact_id is not null and contact_id != ''))`,
          sql.lit` contacts`,
        ),
      );
      s.if(
        sql`exists(select 1 from ${
          sql.ref(contactIdTableName)
        } where contact_id is not null and contact_id != '')`,
        (s) => {
          s.defScalar(
            "ids",
            {
              type: { type: "String", maxLength: 65_000 },
              expr: sql.lit``,
            },
          );
          s.defScalar("ids_count", 0);
          s.forEachTableWithOpts({
            table: contactIdTableName,
            cursorName: "contact_id_record",
            where: sql`contact_id is not null and contact_id != ''`,
            body: (s) => {
              s.if(
                sql`ids_count = 0`,
                (s) => s.setScalar("ids", sql`contact_id_record.contact_id`),
                (s) =>
                  s.setScalar(
                    "ids",
                    sql`ids || ',' || contact_id_record.contact_id`,
                  ),
              );
              s.increment("ids_count");
              s.if(sql`ids_count >= 100`, (s) => {
                s.request({
                  uri: sql.concat(
                    `${BASE_URL}/marketing/contacts?ids=`,
                    sql`ids`,
                  ),
                  method: "DELETE",
                  optIn: opts?.optIn,
                  headers: [authHeader(this.opts)],
                  responseRecord: "response",
                  receiveText: "body",
                });
                s.if(sql`response.status >= 300`, (s) => {
                  s.debugExpr(sql`body`);
                  s.throwError(
                    sql`'Received error status from deleting contacts call:' || response.status`,
                  );
                });
                s.setScalar("ids", sql.lit``);
                s.setScalar("ids_count", 0);
              });
            },
          });
          s.if(sql`ids_count > 0`, (s) => {
            s.request({
              uri: sql.concat(`${BASE_URL}/marketing/contacts?ids=`, sql`ids`),
              method: "DELETE",
              optIn: opts?.optIn,
              headers: [authHeader(this.opts)],
              responseRecord: "response",
              receiveText: "body",
            });
            s.if(sql`response.status >= 300`, (s) => {
              s.debugExpr(sql`body`);
              s.throwError(
                sql`'Received error status from deleting contacts call:' || response.status`,
              );
            });
          });
        },
      );
    };
  }
}

/**
 * Shared {@link SendGrid} client using the default `sendgrid_api_key`
 * static secret. Construct a fresh {@link SendGrid} only when you need a
 * non-default API key.
 *
 * @category Service
 */
export const sendGrid = new SendGrid();
