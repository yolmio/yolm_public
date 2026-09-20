import { getStaticSecret, queryParamsString } from "std/services";
import { sql } from "../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../std/sql_utils";
import type {
  GenericServerStatementsFn,
  HelperProcField,
  RequestHeader,
} from "std/statements";

const BASE_URL = "https://api.hubapi.com";

/** Options for instantiating a custom {@link Hubspot} client. */
export interface HubspotOptions {
  /** Override the API token (defaults to the `HUBSPOT_API_TOKEN` static secret). */
  apiToken?: Sql;
  /** Override the webhook base name (defaults to `"hubspot"`). */
  webhookBaseName?: string;
}

interface HubspotInternalOptions {
  apiToken: Sql;
  webhookBaseName: string;
}

function authHeader(opts: HubspotInternalOptions): RequestHeader {
  return {
    name: sql.lit`authorization`,
    value: sql.concat("Bearer ", opts.apiToken),
  };
}

/**
 * HubSpot CRM API client. Use the {@link hubspot} singleton for the
 * default configuration (`HUBSPOT_API_TOKEN` static secret) or construct
 * a new instance with custom options.
 *
 * Currently exposes only `.contacts` for syncing CRM contacts; extend
 * as needed by adding more sub-clients.
 *
 * @category Service
 */
export class Hubspot {
  #opts: HubspotInternalOptions;
  /** Contacts API helpers. */
  contacts: HubspotContacts;

  constructor(opts: HubspotOptions = {}) {
    this.#opts = {
      apiToken: opts.apiToken ?? getStaticSecret(sql.lit`HUBSPOT_API_TOKEN`),
      webhookBaseName: opts.webhookBaseName ?? "hubspot",
    };
    this.contacts = new HubspotContacts(this.#opts);
  }
}

/**
 * Helpers for HubSpot's Contacts API. Accessed via `hubspot.contacts.*`.
 * Provides typed cursors for paginating contacts plus single-record
 * fetch / upsert helpers.
 *
 * @category Service
 */
export class HubspotContacts {
  constructor(private opts: HubspotInternalOptions) {}

  get #resultFields(): HelperProcField[] {
    return [
      { name: "archived", type: "Bool" },
      {
        name: "id",
        type: { type: "String", maxLength: 65_000 },
      },
      { name: "created_at", type: "Timestamp" },
      { name: "updated_at", type: "Timestamp" },
      { name: "properties", type: "Json" },
    ];
  }

  /**
   * Fetches a single page of contacts into a procedure-scope table and a
   * pagination record. Pass `after` from the previous page's `next_after`
   * cursor to advance; use {@link HubspotContacts.listAll} to walk every
   * page automatically.
   */
  list(
    opts: {
      /** Contact properties to include on each returned record. */
      properties?: Sql[];
      /** When true, returns archived contacts instead of active ones. */
      archived?: BooleanExpr;
      /** Page size. */
      limit?: NumericExpr;
      /** Page cursor from the prior page's `pagination.next_after`. */
      after?: Sql;
      /** Procedure-scope record to receive paging cursors. Defaults to `pagination`. */
      paginationRecord?: string;
      /** Procedure-scope table to receive contact rows. Defaults to `contact`. */
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const paginationRecord = opts.paginationRecord ?? "pagination";
    const resultTable = opts.resultTable ?? "contact";
    return (s) => {
      s.defRecord(paginationRecord, {
        fields: [
          {
            name: "next_link",
            type: { type: "String", maxLength: 65_000 },
          },
          {
            name: "next_after",
            type: { type: "String", maxLength: 65_000 },
          },
        ],
      });
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.request({
          uri: sql.concat(
            `${BASE_URL}/crm/v3/objects/contacts?`,
            queryParamsString({
              properties: opts.properties,
              limit: opts.limit,
              after: opts.after,
              archived: opts.archived,
            }),
          ),
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from list hubspot contacts:' || response.status`,
          );
        });
        s.defScalar("pagination_json", sql`(body->'paging')->'next'`);
        s.modify(
          sql`insert into ${
            sql.ref(
              paginationRecord,
            )
          } (next_link, next_after) values (pagination_json->>'link', pagination_json->>'after')`,
        );
        s.modify(sql`insert into ${sql.ref(resultTable)}
          select
            cast((value->'archived') as bool) as archived,
            value->>'id' as id,
            cast((value->>'createdAt') as timestamptz) as created_at,
            cast((value->>'updatedAt') as timestamptz) as updated_at,
            value->'properties' as properties
          from json.array_each(body->'results') as value`);
      });
    };
  }

  /**
   * Loops {@link HubspotContacts.list} until all pages are consumed,
   * collecting every contact into one procedure-scope table.
   */
  listAll(
    opts: {
      /** Contact properties to include on each returned record. */
      properties?: Sql[];
      /** When true, returns archived contacts instead of active ones. */
      archived?: BooleanExpr;
      /** Procedure-scope table to receive all contact rows. Defaults to `contact`. */
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const resultTable = opts.resultTable ?? "contact";
    return (s) => {
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.defScalar("after", {
          type: { type: "String", maxLength: 200 },
        });
        s.loop((s) => {
          s.statements(
            this.list({
              properties: opts.properties,
              archived: opts.archived,
              after: sql`after`,
              resultTable: "tmp_contact",
              limit: 100,
              optIn: opts.optIn,
            }),
          );
          s.modify(
            sql`insert into ${sql.ref(resultTable)} select * from tmp_contact`,
          );
          s.setScalar("after", sql`pagination.next_after`);
          s.breakIf(sql`after is null`);
        });
      });
    };
  }
}

/**
 * Shared {@link Hubspot} client using the default `HUBSPOT_API_TOKEN`
 * static secret. Construct a fresh {@link Hubspot} when you need a
 * different token or webhook base name.
 *
 * @category Service
 */
export const hubspot = new Hubspot();
