import { getStaticSecret, queryParamsString } from "std/services";
import { sql } from "../std/sql_utils";
import type {
  BooleanExpr,
  JsonBuildObjectParam,
  NumericExpr,
  Sql,
} from "../std/sql_utils";
import { EndpointStatements } from "std/statements";
import type {
  EndpointStatementsOrFn,
  GenericServerStatementsFn,
  HelperProcField,
  IServerBaseStatements,
  RequestHeader,
} from "std/statements";
import { system } from "std/system";

const BASE_URL = "https://api.brevo.com/v3";

export interface BrevoOptions {
  apiKey?: Sql;
  webhookBaseName?: string;
}

interface BrevoInternalOptions {
  apiKey: Sql;
  webhookBaseName: string;
}

function authHeader(opts: BrevoInternalOptions): RequestHeader {
  return {
    name: sql.lit`api-key`,
    value: opts.apiKey,
  };
}

export class Brevo {
  #opts: BrevoInternalOptions;
  #webhook?: BrevoWebhook;
  contacts: BrevoContacts;
  emailTemplates: BrevoTemplates;
  emailCampaigns: BrevoEmailCampaigns;
  senders: BrevoSenders;

  constructor(opts: BrevoOptions = {}) {
    this.#opts = {
      apiKey: opts.apiKey ?? getStaticSecret(sql.lit`BREVO_API_KEY`),
      webhookBaseName: opts.webhookBaseName ?? "brevo",
    };
    // Delay webhook initialization to avoid forward reference
    // this.webhook will be initialized on first access
    this.contacts = new BrevoContacts(this.#opts);
    this.emailTemplates = new BrevoTemplates(this.#opts);
    this.emailCampaigns = new BrevoEmailCampaigns(this.#opts);
    this.senders = new BrevoSenders(this.#opts);
  }

  get webhook(): BrevoWebhook {
    if (!this.#webhook) {
      this.#webhook = new BrevoWebhook(this.#opts);
    }
    return this.#webhook;
  }
}

export class BrevoContacts {
  lists: BrevoContactsList;
  folders: BrevoContactsFolders;

  constructor(private opts: BrevoInternalOptions) {
    this.lists = new BrevoContactsList(opts);
    this.folders = new BrevoContactsFolders(opts);
  }

  campaignStats(opts: {
    contactEmail: Sql;
    hardBounceTable?: string;
    softBounceTable?: string;
    openTable?: string;
    userUnsubscriptionTable?: string;
    /** Required in preview/local-dev when external services mode is opt-in */
    optIn?: BooleanExpr;
  }): GenericServerStatementsFn {
    const hardBounceTable = opts.hardBounceTable ?? "hard_bounce";
    const softBounceTable = opts.softBounceTable ?? "soft_bounce";
    const openedTable = opts.openTable ?? "open";
    const userUnsubscription = opts.userUnsubscriptionTable ??
      "user_unsubscription";
    return (s) => {
      s.defTable(hardBounceTable, {
        fields: [
          { name: "campaign_id", type: "BigInt" },
          { name: "event_time", type: "Timestamp" },
        ],
      });
      s.defTable(softBounceTable, {
        fields: [
          { name: "campaign_id", type: "BigInt" },
          { name: "event_time", type: "Timestamp" },
        ],
      });
      s.defTable(openedTable, {
        fields: [
          { name: "campaign_id", type: "BigInt" },
          { name: "event_time", type: "Timestamp" },
        ],
      });
      s.defTable(userUnsubscription, {
        fields: [
          { name: "campaign_id", type: "BigInt" },
          { name: "event_time", type: "Timestamp" },
        ],
      });
      s.block((s) => {
        s.request({
          uri: sql.concat(
            `${BASE_URL}/contacts/`,
            sql`uri.encode_component(${opts.contactEmail})`,
            "/campaignStats",
          ),
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.throwErrorIf(
          sql`response.status != 200`,
          sql`'Received error status from get contact details call:' || response.status`,
        );
        s.modify(sql`insert into ${sql.ref(hardBounceTable)}
          select
            cast((value->'campaignId') as bigint) as campaign_id,
            cast((value->'eventTime') as timestamptz) as event_time
          from json.array_each(body->'hardBounces')`);
        s.modify(sql`insert into ${sql.ref(softBounceTable)}
          select
            cast((value->'campaignId') as bigint) as campaign_id,
            cast((value->'eventTime') as timestamptz) as event_time
          from json.array_each(body->'softBounces')`);
        s.modify(sql`insert into ${sql.ref(openedTable)}
          select
            cast((value->'campaignId') as bigint) as campaign_id,
            cast((value->'eventTime') as timestamptz) as event_time
          from json.array_each(body->'opened')`);
        s.modify(sql`insert into ${sql.ref(userUnsubscription)}
          select
            cast((value->'campaignId') as bigint) as campaign_id,
            cast((value->'eventTime') as timestamptz) as event_time
          from json.array_each((body->'unsubscriptions')->'userUnsubscription')`);
      });
    };
  }
}

export class BrevoContactsFolders {
  constructor(private opts: BrevoInternalOptions) {}

  get #resultFields(): HelperProcField[] {
    return [
      { name: "id", type: "BigInt" },
      {
        name: "name",
        type: { type: "String", maxLength: 65_000 },
      },
      { name: "total_blacklisted", type: "BigInt" },
      { name: "total_subscribers", type: "BigInt" },
      { name: "unique_subscribers", type: "BigInt" },
    ];
  }

  list(
    opts: {
      limit?: NumericExpr;
      offset?: NumericExpr;
      sort?: Sql;
      countScalar?: string;
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const countScalar = opts.countScalar ?? "folders_count";
    const resultTable = opts.resultTable ?? "folder";
    return (s) => {
      s.defScalar(countScalar, {
        type: "BigInt",
      });
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.request({
          uri: sql.concat(
            `${BASE_URL}/contacts/folders?`,
            queryParamsString({
              limit: opts.limit,
              offset: opts.offset,
              sort: opts.sort,
            }),
          ),
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.throwErrorIf(
          sql`response.status != 200`,
          sql`'Received error status from list folders:' || response.status`,
        );
        // brevo returns null if there are absolutely no templates for some reason
        s.setScalar(
          countScalar,
          sql`coalesce(cast((body->'count') as bigint), 0)`,
        );
        s.modify(sql`insert into ${sql.ref(resultTable)}
          select
            cast((value->'id') as bigint) as id,
            value->>'name' as name,
            cast((value->'totalBlacklisted') as bigint) as total_blacklisted,
            cast((value->'totalSubscribers') as bigint) as total_subscribers,
            cast((value->'uniqueSubscribers') as bigint) as unique_subscribers
          from json.array_each(body->'folders')`);
      });
    };
  }
}

export class BrevoContactsList {
  constructor(private opts: BrevoInternalOptions) {}

  #resultFields: HelperProcField[] = [
    { name: "id", type: "BigInt" },
    {
      name: "name",
      type: { type: "String", maxLength: 65_000 },
    },
    { name: "unique_subscribers", type: "BigInt" },
  ];

  create({
    listName,
    folderId,
    listIdScalar,
    optIn,
  }: CreateContactListOpts): GenericServerStatementsFn {
    const listScalar = listIdScalar ?? "list_id";
    return (s) => {
      s.defScalar(listScalar, {
        type: "BigInt",
      });
      s.block((s) => {
        s.request({
          uri: sql.lit`${BASE_URL}/contacts/lists`,
          json: { name: listName, folderId },
          method: "POST",
          optIn,
          headers: [authHeader(this.opts)],
          responseRecord: "response",
          receiveJson: "response_body",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 201`, (s) => {
          s.debugExpr(sql`response_body`);
          s.throwError(
            sql`'Received error status from list creation call:' || response.status`,
          );
        });
        s.setScalar(listScalar, sql`cast((response_body->'id') as bigint)`);
      });
    };
  }

  #getProcessInfo(
    processId: NumericExpr,
    optIn?: BooleanExpr,
  ): GenericServerStatementsFn {
    return (s) => {
      s.request({
        uri: sql.concat(`${BASE_URL}/processes/`, processId),
        optIn,
        headers: [authHeader(this.opts)],
        receiveJson: "body",
      });
      s.defScalar("status", sql`body->>'status'`);
    };
  }

  import(opts: ImportContactsOpts): GenericServerStatementsFn {
    return (s) => {
      s.block((s) => {
        s.request({
          uri: sql.lit`${BASE_URL}/contacts/import`,
          method: "POST",
          optIn: opts.optIn,
          json: {
            fileBody: opts.contactsCsv,
            listIds: sql.jsonBuildArray(opts.listId),
            emailBlacklist: opts.emailBlacklist ?? false,
            emptyContactsAttributes: opts.emptyContactsAttributes ?? false,
            updateExistingContacts: opts.updateExistingContacts ?? true,
          },
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 202`, (s) => {
          s.debugExpr(sql.lit`'Failed to import contacts'`);
          s.throwError(
            sql`'Received error status from import contacts call:' || response.status`,
          );
        });
        s.defScalar("process_id", sql`cast((body->>'processId') as bigint)`);
        s.loopN(300, (s) => {
          s.sleep(2000);
          s.statements(this.#getProcessInfo(sql`process_id`, opts.optIn));
          s.breakIf(sql`status = 'completed'`);
        });
      });
    };
  }

  list(
    opts: {
      limit?: NumericExpr;
      offset?: NumericExpr;
      sort?: Sql;
      countScalar?: string;
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const countScalar = opts.countScalar ?? "lists_count";
    const resultTable = opts.resultTable ?? "list";
    return (s) => {
      s.defScalar(countScalar, {
        type: "BigInt",
      });
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.request({
          uri: sql.concat(
            `${BASE_URL}/contacts/lists?`,
            queryParamsString({
              limit: opts.limit,
              offset: opts.offset,
              sort: opts.sort,
            }),
          ),
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from list lists call:' || response.status`,
          );
        });
        s.setScalar(
          countScalar,
          sql`coalesce(cast((body->'count') as bigint), 0)`,
        );
        s.modify(sql`insert into ${sql.ref(resultTable)}
          select
            cast((value->'id') as bigint) as id,
            value->>'name' as name,
            cast((value->'uniqueSubscribers') as bigint) as unique_subscribers
          from json.array_each(body->'lists')`);
      });
    };
  }

  listAll(
    opts: {
      sort?: Sql;
      countScalar?: string;
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const resultTable = opts.resultTable ?? "list";
    const countScalar = opts.countScalar ?? "lists_count";
    return (s) => {
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.defScalar("offset", 0);
        s.loop((s) => {
          s.statements(
            this.list({
              sort: opts.sort,
              offset: sql`offset`,
              limit: 50,
              countScalar,
              resultTable: "tmp_list",
              optIn: opts.optIn,
            }),
          );
          s.modify(
            sql`insert into ${sql.ref(resultTable)}
              select * from tmp_list`,
          );
          s.increment("offset", sql`(select count(*) from tmp_list)`);
          s.breakIf(sql`${sql.ref(countScalar)} <= offset`);
        });
      });
    };
  }

  delete(
    listId: NumericExpr,
    opts?: { optIn?: BooleanExpr },
  ): GenericServerStatementsFn {
    return (s) => {
      s.block((s) => {
        s.request({
          uri: sql.concat(`${BASE_URL}/contacts/lists/`, listId),
          method: "DELETE",
          optIn: opts?.optIn,
          headers: [authHeader(this.opts)],
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status not in (204, 404)`, (s) => {
          s.throwError(
            sql`'Received error status from delete list call:' || response.status`,
          );
        });
      });
    };
  }
}

export class BrevoTemplates {
  constructor(private opts: BrevoInternalOptions) {}

  get #resultFields(): HelperProcField[] {
    return [
      {
        name: "id",
        type: "BigInt",
      },
      {
        name: "name",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "subject",
        type: { type: "String", maxLength: 65_000 },
      },
      {
        name: "is_active",
        type: "Bool",
      },
    ];
  }

  list(
    opts: {
      limit?: NumericExpr;
      offset?: NumericExpr;
      sort?: Sql;
      countScalar?: string;
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const countScalar = opts.countScalar ?? "email_template_count";
    const resultTable = opts.resultTable ?? "email_template";
    return (s) => {
      s.defScalar(countScalar, {
        type: "BigInt",
      });
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.request({
          uri: sql.concat(
            `${BASE_URL}/smtp/templates?`,
            queryParamsString({
              limit: opts.limit,
              offset: opts.offset,
              sort: opts.sort,
            }),
          ),
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from list templates:' || response.status`,
          );
        });
        // brevo returns null if there are absolutely no templates for some reason
        s.setScalar(
          countScalar,
          sql`coalesce(cast((body->'count') as bigint), 0)`,
        );
        s.modify(sql`insert into ${sql.ref(resultTable)}
          select
            cast((value->'id') as bigint) as id,
            value->>'name' as name,
            value->>'subject' as subject,
            cast((value->>'isActive') as bool) as is_active
          from json.array_each(body->'templates')`);
      });
    };
  }

  listAll(
    opts: {
      sort?: Sql;
      countScalar?: string;
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const resultTable = opts.resultTable ?? "email_template";
    const countScalar = opts.countScalar ?? "email_template_count";
    return (s) => {
      s.defTable(resultTable, {
        fields: this.#resultFields,
      });
      s.block((s) => {
        s.defScalar("offset", 0);
        s.loop((s) => {
          s.statements(
            this.list({
              sort: opts.sort,
              offset: sql`offset`,
              limit: 1000,
              countScalar,
              resultTable: "tmp_email_template",
              optIn: opts.optIn,
            }),
          );
          s.modify(
            sql`insert into ${
              sql.ref(
                resultTable,
              )
            } select * from tmp_email_template`,
          );
          s.increment("offset", sql`(select count(*) from tmp_email_template)`);
          s.breakIf(sql`${sql.ref(countScalar)} <= offset`);
        });
      });
    };
  }
}

export class BrevoEmailCampaigns {
  constructor(private opts: BrevoInternalOptions) {}

  create(opts: SendCampaginEmailOpts): GenericServerStatementsFn {
    const campaignIdScalar = opts.campaignIdScalar ?? "campaign_id";
    return (s) => {
      s.defScalar(campaignIdScalar, {
        type: "BigInt",
      });
      s.block((s) => {
        s.request({
          method: "POST",
          uri: sql.lit`${BASE_URL}/emailCampaigns`,
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          json: {
            name: opts.name,
            templateId: opts.templateId,
            scheduledAt: opts.scheduledAt,
            subject: opts.subject,
            sender: sql.jsonBuildObject(opts.sender),
            utmCampaign: opts.utmCampaign,
            recipients: sql.jsonBuildObject({
              listIds: sql.jsonBuildArray(opts.listId),
            }),
            params: opts.params ? sql.jsonBuildObject(opts.params) : undefined,
          },
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 201`, (s) => {
          s.debugExpr(sql`body`);
          s.throwError(
            sql`'Received error status from import contacts call:' || response.status`,
          );
        });
        s.setScalar(campaignIdScalar, sql`cast((body->'id') as bigint)`);
      });
    };
  }

  updateStatus(opts: {
    campaignId: NumericExpr;
    status: Sql;
    /** Required in preview/local-dev when external services mode is opt-in */
    optIn?: BooleanExpr;
  }): GenericServerStatementsFn {
    return (s) => {
      s.block((s) => {
        s.request({
          method: "PUT",
          optIn: opts.optIn,
          uri: sql.concat(
            `${BASE_URL}/emailCampaigns/`,
            opts.campaignId,
            "/status",
          ),
          headers: [authHeader(this.opts)],
          json: { status: opts.status },
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 204`, (s) => {
          s.throwError(
            sql`'Received error status from update campaign status:' || response.status`,
          );
        });
      });
    };
  }
}

export class BrevoSenders {
  constructor(private opts: BrevoInternalOptions) {}

  list(
    opts: {
      resultTable?: string;
      /** Required in preview/local-dev when external services mode is opt-in */
      optIn?: BooleanExpr;
    } = {},
  ): GenericServerStatementsFn {
    const resultTable = opts.resultTable ?? "sender";
    return (s) => {
      s.defTable(resultTable, {
        fields: [
          {
            name: "id",
            type: "BigInt",
          },
          {
            name: "name",
            type: { type: "String", maxLength: 65_000 },
          },
          {
            name: "email",
            type: { type: "String", maxLength: 65_000 },
          },
          {
            name: "active",
            type: "Bool",
          },
        ],
      });
      s.block((s) => {
        s.request({
          uri: sql.lit`${BASE_URL}/senders`,
          optIn: opts.optIn,
          headers: [authHeader(this.opts)],
          receiveJson: "body",
          responseRecord: "response",
        });
        s.throwErrorIf(
          sql`response.status = 402`,
          sql.lit`Brevo needs payment`,
        );
        s.if(sql`response.status != 200`, (s) => {
          s.throwError(
            sql`'Received error status from list senders:' || response.status`,
          );
        });
        s.modify(sql`insert into ${sql.ref(resultTable)}
          select
            cast((value->'id') as bigint) as id,
            value->>'name' as name,
            value->>'email' as email,
            cast((value->>'active') as bool) as active
          from json.array_each(body->'senders')`);
      });
    };
  }
}

export const brevo = new Brevo();

export interface ImportContactsOpts {
  listId: NumericExpr;
  contactsCsv: Sql;
  emailBlacklist?: BooleanExpr;
  updateExistingContacts?: BooleanExpr;
  emptyContactsAttributes?: BooleanExpr;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

export interface CreateContactListOpts {
  listName: Sql;
  folderId: NumericExpr;
  listIdScalar?: string;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

export interface SendCampaginEmailOpts {
  sender: {
    name?: Sql;
    email?: Sql;
    id?: NumericExpr;
  };
  name: Sql;
  templateId: NumericExpr;
  scheduledAt: Sql;
  subject?: Sql;
  replyTo?: Sql;
  listId: NumericExpr;
  utmCampaign?: Sql;
  campaignIdScalar?: string;
  params?: JsonBuildObjectParam;
  /** Required in preview/local-dev when external services mode is opt-in */
  optIn?: BooleanExpr;
}

type WebhookEvent =
  | "spam"
  | "opened"
  | "click"
  | "hardBounce"
  | "softBounce"
  | "unsubscribed"
  | "listAddition"
  | "delivered";

function deregisterWebhook(apiKey: Sql, id: NumericExpr, optIn?: BooleanExpr) {
  return <T extends IServerBaseStatements>(s: T) => {
    s.request({
      uri: sql.concat(`${BASE_URL}/webhooks/`, id),
      method: sql.lit`DELETE`,
      optIn,
      headers: [
        {
          name: sql.lit`api-key`,
          value: apiKey,
        },
      ],
      responseRecord: "response",
    });
    //if the webhook id was not found (404) it was already deleted, we don't need to record an error
    // 403 is returned for forbidden, which can mean that the account is deleted
    s.if(
      sql`response.status != 204 and response.status != 404 and response.status != 403`,
      (s) =>
        s.throwError(
          sql`'Received error status from deregister webhook Status: ' || response.status`,
        ),
    );
  };
}

function registerWebhook(
  apiKey: Sql,
  event: WebhookEvent,
  callBackUrl: Sql,
  optIn?: BooleanExpr,
) {
  return <T extends IServerBaseStatements>(s: T) => {
    s.request({
      uri: sql.lit`${BASE_URL}/webhooks`,
      method: "POST",
      optIn,
      json: {
        events: [sql.lit(event)],
        url: callBackUrl,
        type: sql.lit`marketing`,
      },
      receiveJson: "register_response",
      headers: [
        {
          name: sql.lit`api-key`,
          value: apiKey,
        },
      ],
      responseRecord: "response",
    });
    s.if(sql`response.status != 201`, (s) =>
      s.throwError(
        sql`'Received error status from webhook registration. Status: ' || response.status`,
      ));
    s.defScalar("webhook_id", sql`(register_response->'id')::bigint`);
  };
}

function webhookHandlerPrefix() {
  const improvedHandler = new EndpointStatements();
  improvedHandler.defRecord("event", {
    fields: [
      { name: "email", type: { type: "String", maxLength: 2500 } },
      { name: "camp_id", type: "BigInt" },
    ],
  });
  improvedHandler.modify(
    sql`insert into event (email, camp_id) values (body->>'email', cast(body->'camp_id' as bigint))`,
  );
  // didn't work in production for some reason...
  // improvedHandler.getHeader(sql.lit`X-Forwarded-Ip`, "forwarded_ip");
  // improvedHandler.getHeader(sql.lit`Cf-Connecting-Ip`, "cf_connecting_ip");
  // improvedHandler.defScalar("ip", sql`coalesce(forwarded_ip, cf_connecting_ip)`);
  // improvedHandler.if(
  //   sql`ip is null or not net.ip_in_cidr(ip, '185.107.232.0/24') and not net.ip_in_cidr(ip, '1.179.112.0/20')`,
  //   (s) => {
  //     s.debugExpr(
  //       sql.concat(
  //         "Webhook handler received request from invalid ip address",
  //         sql`ip`,
  //       ),
  //     );
  //     s.setHttpStatus(403);
  //     s.return();
  //   },
  // );
  return improvedHandler;
}

export class BrevoWebhook {
  #opts: BrevoInternalOptions;

  constructor(opts: BrevoInternalOptions) {
    this.#opts = opts;
  }

  addDbTable() {
    system.db.table("brevo_webhook", (table) => {
      table.string("key", 200).notNull().unique();
      table.bigInt("webhook_id").notNull();
    });
  }

  #createWebHook(event: WebhookEvent, handler: EndpointStatementsOrFn) {
    if (!system.staticWebhookDomain) {
      throw new Error(
        "Please specify a webhook domain before registering webhooks",
      );
    }
    const improvedHandler = webhookHandlerPrefix();
    improvedHandler.statements(handler);
    const key = `${this.#opts.webhookBaseName}-${event}`;
    system.staticWebhook({
      key,
      handler: improvedHandler,
      jsonBodyScalar: "body",
      register: (callbackUrl) => (s) => {
        s.statements(registerWebhook(this.#opts.apiKey, event, callbackUrl));
        s.startTransaction();
        s.modify(
          sql`insert into brevo_webhook (key, webhook_id) values (${
            sql.lit(key)
          }, webhook_id)`,
        );
        s.commitTransaction();
      },
      deregister: (s) => {
        s.defScalar(
          "webhook_id",
          sql`(select webhook_id from brevo_webhook where key = ${
            sql.lit(key)
          })`,
        );
        s.unless(sql`webhook_id is null`, (s) => {
          deregisterWebhook(this.#opts.apiKey, sql`webhook_id`)(s);
          s.startTransaction();
          s.modify(sql`delete from brevo_webhook where key = ${sql.lit(key)}`);
          s.commitTransaction();
        });
      },
      webhookRegistered: sql`exists (select 1 from brevo_webhook where key = ${
        sql.lit(key)
      })`,
    });
  }

  spam(handler: EndpointStatementsOrFn) {
    this.#createWebHook("spam", handler);
  }

  opened(handler: EndpointStatementsOrFn) {
    this.#createWebHook("opened", handler);
  }

  click(handler: EndpointStatementsOrFn) {
    this.#createWebHook("click", handler);
  }

  hardBounce(handler: EndpointStatementsOrFn) {
    this.#createWebHook("hardBounce", handler);
  }

  softBounce(handler: EndpointStatementsOrFn) {
    this.#createWebHook("softBounce", handler);
  }

  unsubscribed(handler: EndpointStatementsOrFn) {
    this.#createWebHook("unsubscribed", handler);
  }

  listAddition(handler: EndpointStatementsOrFn) {
    this.#createWebHook("listAddition", handler);
  }

  delivered(handler: EndpointStatementsOrFn) {
    this.#createWebHook("delivered", handler);
  }
}

export class DynamicWebhooks {
  spam = new DynamicWebhook("spam");
  opened = new DynamicWebhook("opened");
  click = new DynamicWebhook("click");
  softBounce = new DynamicWebhook("softBounce");
  hardBounce = new DynamicWebhook("hardBounce");
  unsubscribed = new DynamicWebhook("unsubscribed");
  listAddition = new DynamicWebhook("listAddition");
  delivered = new DynamicWebhook("delivered");
}

export class DynamicWebhook {
  constructor(private event: WebhookEvent) {}

  /**
       Register a webhook for the given event.

       Sets a scalar webhook_id in the context of the statements, which can be used to deregister the webhook.
       */
  register(apiKey: Sql, url: Sql) {
    return registerWebhook(apiKey, this.event, url);
  }

  deregister(apiKey: Sql, brevoId: NumericExpr) {
    return deregisterWebhook(apiKey, brevoId);
  }

  handler(handler: EndpointStatementsOrFn) {
    const improvedHandler = webhookHandlerPrefix();
    improvedHandler.statements(handler);
    return improvedHandler;
  }
}

export const webhooks = new DynamicWebhooks();
